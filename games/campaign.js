'use strict';
// CAMPAIGN TRAIL: a solo step game on the US map (CAMPAIGN-DESIGN.md section 3). Math lives in campaign-engine.js (pure); this module is the money flow and the socket layer.
// Every unit of money is a balance in the ledger and every movement is ONE ctx.money call (ADD-A-GAME.md sections 3-5). The only money that ever moves is the stake (open) and the payout
// (settle / void): a surviving step moves nothing. The module keeps its own state (the one open run of an account) in campaign.json; none of it is money.
//   start : validate -> ledger open (stake into escrow) -> record on disk (flushed) -> emit
//   step  : validate -> E.step with the server rng -> scandal / run done: the drawn result is written into the record (`pend`, flushed) FIRST, then ledger settle -> drop the record -> emit end;
//           survived and going on: record updated, FLUSHED, emit (no ledger line). A drawn result is final: a refused settle never un-draws it (retry, idle timer and boot close at the pended result),
//           and every draw of a step that could not be written is remembered (`memo`, one per step + target state) so a retry returns the same draw, whatever state is asked.
//   cash  : steps >= 1 settle at stake x multiplier;  steps === 0 void (a refund: nothing was risked)
//   idle  : 60 s with no accepted pick = the same as a cash-out (reason 'timeout')
//   boot  : recover() cashes out every stored run at its stored multiplier (decision D1: a restart is an automatic cash-out) on the growth table the run was opened with, refunds a 0-step run,
//           closes a pended result as drawn (a scandal = loss, stake kept), voids an escrow that has no record.
const crypto = require('crypto');
const E = require('./campaign-engine.js');
const { createStore } = require('./campaign-store.js');

const RATE_MS = 150;
const IDLE_MS = Number.isSafeInteger(E.IDLE_MS) && E.IDLE_MS > 0 ? E.IDLE_MS : 60000;
const MODES = ['play', 'chips'];
const RTP_LABEL = '96.0%';
const MAX_WIN_X = E.LANDSLIDE_MX / 100;
const CAP_X = E.CAP_MX / 100;

// QA hook: a step payload may carry force: 'survive' | 'scandal'. It runs ONLY when the server process was started with CAMPAIGN_TEST=1 and NODE_ENV is not 'production', and ONLY on a CHIPS run
// (Money 1008 K5-F: a run whose stored currency is Cash, real money, never honours `force`, whatever the environment says; forceFor below is the only reader of a step's `force`);
// otherwise `force` (and every other unknown field) is ignored. The engine has no force code: the hook only hands E.step a fixed rng (0 always fails a step, 0.999999 always survives it).
// CAMPAIGN_IDLE_MS (a shorter idle timer for the tests) honours the same switch.
const testHookOn = () => process.env.CAMPAIGN_TEST === '1' && process.env.NODE_ENV !== 'production';
const idleMs = () => {
  if (testHookOn()) { const v = Number(process.env.CAMPAIGN_IDLE_MS); if (Number.isSafeInteger(v) && v >= 1) return v; }
  return IDLE_MS;
};
const FORCE_RNG = { survive: () => 0.999999, scandal: () => 0 };
let cashForceSeen = 0;
// the force a step may carry: hook on AND the STORED run's currency is Chips (never the client's say), else null. A Cash run that asks for one is played as an ordinary run and a line is printed (the first 5 per boot).
function forceFor(rec, payload) {
  const f = field(payload, 'force');
  if (!testHookOn() || typeof f !== 'string' || !own(FORCE_RNG, f)) return null;
  if (rec.cur !== 'chips') { if (cashForceSeen++ < 5) alarm('campaign: QA force ' + JSON.stringify(f) + ' refused on a ' + (rec.cur === 'play' ? 'Cash' : String(rec.cur)) + ' run: the hook is Chips only, the step is played as an ordinary one'); return null; }
  return f;
}

const cryptoRng = () => crypto.randomBytes(6).readUIntBE(0, 6) / 281474976710656;   // 48-bit uniform in [0,1)
const nkey = (k) => String(k).toLowerCase().trim();                                  // same normalisation as ctx.money
const keyOf = (socket) => { const a = socket.data && socket.data.acct; return nkey(a && typeof a === 'object' ? a.key : a || ''); };
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const field = (p, k) => (p && typeof p === 'object' && own(p, k) ? p[k] : undefined);   // own fields only: a payload with a prototype cannot smuggle `force`
const isInt = (n) => Number.isSafeInteger(n);
// the growth table a run is opened with, stored in its record: an open run is paid on the numbers it was opened with, whatever a later deploy changes (ADD-A-GAME.md section 4)
const tiersNow = () => { const t = {}; for (const k of Object.keys(E.TIERS)) t[k] = { g100: E.TIERS[k].g100 }; return t; };
const tiersOk = (t) => !!t && typeof t === 'object' && Object.keys(E.TIERS).every((k) => own(t, k) && t[k] && isInt(t[k].g100) && t[k].g100 >= 100 && t[k].g100 <= 1000);
const tiersOf = (o) => (o.tiers == null ? E.TIERS : tiersOk(o.tiers) ? o.tiers : null);   // a record from before the snapshot existed uses the current table; an unusable snapshot = null
// the map a run is opened with (borders, every state's tier, step limit, LANDSLIDE, cap): stored with the run like the growth table, so a deploy that moves a state to another tier or drops a border
// never changes what an open run is worth (Money 1008 K5-2). A record from before the snapshot existed uses the current map; a stored map that is not usable = null (the record cannot be vouched for).
const mapOf = (o, tiers) => (o.map == null ? E.CUR : tiers && E.mapOk(o.map, tiers) ? o.map : null);
const validId = (x) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x);
const logf = (...a) => { const f = module.exports.log; if (f) f(...a); };
const alarm = (...a) => { const f = module.exports.log; (f || console.error)(...a); };      // the lines that must be seen: to the log hook if one is set, else stderr (server.js sets none)

let C = null;                    // the games ctx from init (io, money, now, rng)
let fenced = null;               // the ledger code once a money call showed the ledger refuses writes for good (foreign_write | lost_lock | closed); init() clears it. Poker pauses on this (server.js onFence), the game port has no such hook.
const FENCE_CODES = ['foreign_write', 'lost_lock', 'closed'];
let store = null;
const runs = new Map();          // account key -> live record { ...stored record, nk, timer, expiresAt }: the account's ONE open run
const rateLast = new Map();      // "<account>|<event>" -> time of the last accepted event: the 150 ms limit is per account and event, not per socket
const M = () => C.money;
const now = () => C.now();
const rngOf = () => (module.exports.rng || cryptoRng);

function err(socket, code, message, extra) { socket.emit('error', { message, code, game: 'campaign', ...(extra || {}) }); }
const MONEY_DOWN = 'Money is unavailable right now, please try again later';
const fundsMsg = (cur) => (cur === 'chips' ? 'Not enough chips' : 'Not enough Cash');
const balances = (nk) => ({ play: M().balance(nk, 'play'), chips: M().balance(nk, 'chips') });
const safeBalances = (nk) => { try { return balances(nk); } catch { return null; } };

// every live socket of an account (plus `extra`): an end that comes from a timer, or from a second tab, reaches all of them and never a socket signed in as somebody else
function emitAcct(nk, ev, payload, extra) {
  const to = new Set();
  const m = C && C.io && C.io.sockets && C.io.sockets.sockets;
  if (m) for (const s of m.values()) if (s.data && s.data.acct && keyOf(s) === nk) to.add(s);
  if (extra && extra.data && extra.data.acct && keyOf(extra) === nk) to.add(extra);
  for (const s of to) { try { s.emit(ev, payload); } catch {} }
}

// ---------------------------------------------------------------------------------------------------------------- views (every money number here is computed by the server)
const units = (bet, mx) => (bet / 100) * mx;                         // whole units: bet levels are multiples of 100, so no rounding exists
const round4 = (x) => Math.round(x * 10000) / 10000;
function runView(rec) {
  const run = rec.run, name = (c) => E.MAP.states[c].name;
  return {
    roundId: rec.roundId, mode: rec.cur, bet: rec.bet, home: run.home, at: run.at, trail: run.trail.slice(), steps: run.steps, mx: run.mx,
    cashout: units(rec.bet, run.mx), canCash: true,                  // at 0 steps cashout = the stake: it is a refund (void), not a win
    options: E.options(run, rec.tiers, rec.map).map((o) => ({ to: o.to, name: name(o.to), tier: o.tier, g100: o.g100, nextMx: o.nextMx, nextCashout: units(rec.bet, o.nextMx), pFail: round4(o.pFail), deadEnd: !!o.deadEnd, landslide: !!o.landslide })),
    idleMs: rec.idleMs, expiresAt: rec.expiresAt,
  };
}
function stateView(nk) {
  const rec = runs.get(nk);
  return { betLevels: E.BET_LEVELS.slice(), modes: MODES.slice(), rtp: RTP_LABEL, maxWinX: MAX_WIN_X, capX: CAP_X, idleMs: idleMs(), map: { ...E.MAP, tiers: E.MAP.tiers || E.TIERS }, balances: safeBalances(nk), run: rec ? runView(rec) : null };
}
function endView(rec, run, reason, win, failedAt) {
  return { roundId: rec.roundId, reason, mode: rec.cur, bet: rec.bet, mx: run.mx, win, at: run.at, failedAt: failedAt || null, trail: run.trail.slice(), steps: run.steps, balances: safeBalances(rec.nk) };
}

// ---------------------------------------------------------------------------------------------------------------- the open run: record, timer
const toStored = (rec) => {
  const o = { roundId: rec.roundId, key: rec.nk, cur: rec.cur, bet: rec.bet, run: rec.run, startedAt: rec.startedAt, lastAt: rec.lastAt };
  if (rec.tiers) o.tiers = rec.tiers;
  if (rec.map) o.map = rec.map;
  if (rec.pend) o.pend = rec.pend;                                    // the drawn result of a terminal step (scandal / dead end / LANDSLIDE) whose settle is not done yet: final, durable
  return o;
};
function clearTimer(rec) { if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; } }
function armIdle(rec, ms) {
  clearTimer(rec);
  rec.idleMs = ms; rec.expiresAt = now() + ms;
  rec.timer = setTimeout(() => {
    rec.timer = null;
    try { autoClose(rec, 'timeout'); } catch (e) { logf('campaign: idle close threw', rec.roundId, e && e.message); }   // never an uncaught throw in a timer
  }, ms);
  if (rec.timer.unref) rec.timer.unref();
}
function forget(rec) { clearTimer(rec); rec.closed = true; if (runs.get(rec.nk) === rec) runs.delete(rec.nk); }

// A money call that failed for a reason the game cannot act on: the run is NOT closed, its record stays, the client is told (an error, never a result), and the idle timer is armed again so the close is tried once more.
function noteFence(e) {
  const c = e && ((e.cause && e.cause.code) || e.code);
  if (FENCE_CODES.includes(c) && !fenced) { fenced = c; logf('campaign: the ledger refuses writes for good, no new step is drawn until a restart', c); }
}
// What the client sees of ANY step or close that could not be written: an `error` to every socket of the account (and the stepping one), and the idle timer armed again. One function for every refused step, so a drawn scandal and a drawn survive
// cannot be told apart before the result is on disk (Money 1008 R2D-1).
function refused(rec, payload, extraSocket) {
  if (runs.get(rec.nk) === rec && !rec.closed) { emitAcct(rec.nk, 'error', payload, extraSocket); armIdle(rec, rec.idleMs || idleMs()); }
}
const INTERNAL = () => ({ message: 'Server error', code: 'internal', game: 'campaign' });
function moneyFailed(rec, e, where, extraSocket) {
  noteFence(e);
  logf('campaign: money call failed, the run stays open', rec.roundId, where, e && e.code, e && e.message);
  refused(rec, e && e.code === 'funds' ? { message: fundsMsg(rec.cur), code: 'funds', game: 'campaign' } : INTERNAL(), extraSocket);
  return null;
}

// Close a run: the ONE ledger call, then the record is dropped and flushed, then the client hears it. `run` is the run state being closed (a scandal carries done:'scandal').
// A run with 0 steps that did not fail is a REFUND (void); every other close is a settle at E.payout (0 on a scandal). -> true when the run is closed, false when the ledger refused (the run stays open, see moneyFailed)
function closeRun(rec, run, reason, failedAt, extraSocket) {
  if (rec.closed) return false;
  const refund = run.steps === 0 && run.done !== 'scandal';
  let win;
  try {
    if (refund) { win = rec.bet; M().void(rec.nk, rec.cur, rec.roundId, reason === 'timeout' ? 'timeout' : reason === 'boot' ? 'boot' : 'withdrawn'); }
    else { win = run.done === 'scandal' ? 0 : E.payout(run, rec.bet); M().settle(rec.nk, rec.cur, rec.roundId, { win, stake: rec.bet }); }      // `dup` (an identical close is already in the ledger) is a normal answer: same numbers
  } catch (e) {
    if (e && e.code === 'round_closed') return alreadyPlayed(rec, extraSocket);
    if (e && e.code === 'stake_mismatch' && !refund) return unresolvable(rec, extraSocket);
    return moneyFailed(rec, e, refund ? 'void' : 'settle', extraSocket);
  }
  forget(rec);
  try { store.delOpen(rec.nk); store.flush(); } catch (e) { logf('campaign: store flush failed after the ledger call (the ledger is the truth; recover() drops a record with no escrow)', rec.roundId, e && e.message); }
  emitAcct(rec.nk, 'g:campaign:end', endView(rec, run, reason, win, failedAt), extraSocket);
  return true;
}
// The ledger says this round was played already (another close is in the file): drop the record, pay nothing, and tell the client the run is over by an error and a fresh state (no result for numbers we cannot vouch for).
function alreadyPlayed(rec, extraSocket) {
  logf('campaign: run was already closed in the ledger, record dropped, nothing paid', rec.roundId);
  forget(rec);
  try { store.delOpen(rec.nk); store.flush(); } catch (e) { logf('campaign: record of a closed run not dropped', rec.roundId, e && e.message); }
  emitAcct(rec.nk, 'error', { message: 'That run was already settled', code: 'round_closed', game: 'campaign' }, extraSocket);
  emitAcct(rec.nk, 'g:campaign:state', stateView(rec.nk), extraSocket);
  return true;
}
// An escrow that is not the stake the record names cannot be settled by retrying: give back what the escrow holds.
function unresolvable(rec, extraSocket) {
  try { M().void(rec.nk, rec.cur, rec.roundId, 'unresolvable'); } catch (e) { return e && e.code === 'round_closed' ? alreadyPlayed(rec, extraSocket) : moneyFailed(rec, e, 'void', extraSocket); }
  logf('campaign: settle refused, the escrow is not the stake the record names: voided', rec.roundId);
  forget(rec);
  try { store.delOpen(rec.nk); store.flush(); } catch {}
  emitAcct(rec.nk, 'error', { message: 'Server error', code: 'internal', game: 'campaign' }, extraSocket);
  emitAcct(rec.nk, 'g:campaign:state', stateView(rec.nk), extraSocket);
  return true;
}
// idle: a cash-out at the current multiplier (a refund at 0 steps)
function autoClose(rec, reason) {
  if (rec.closed || runs.get(rec.nk) !== rec) return;
  if (rec.pend) return void closeRun(rec, rec.pend.run, rec.pend.reason, rec.pend.run.failedAt || null);   // a drawn result is closed as drawn, never re-drawn, never turned into a cash-out
  closeRun(rec, rec.run, reason, null);
}

// ---------------------------------------------------------------------------------------------------------------- boot: recover(rounds) (decision D1)
// Synchronous, called by the games registry before the server listens. `rounds` = this game's non-zero escrows read from the ledger.
//   record + escrow (check ok on the run's OWN growth table, escrow = bet) -> steps >= 1: settle at the STORED multiplier;  steps === 0: void (refund)
//   record with a pended result (a drawn scandal / dead end / LANDSLIDE whose settle was refused) -> settle as drawn: a scandal = loss (win 0, stake kept), a win at its drawn multiplier
//   record + escrow, check fails / bet is not the escrow -> void (a record we cannot vouch for is never paid)
//   record, no escrow                            -> stale: dropped, nothing paid
//   escrow, no record                            -> void (the crash fell between the ledger open and the record: no step was taken)
// A ledger call that is refused for another reason keeps the record and the run (audit() lists it, an idle timer tries again).
// A pend pairs with its run: same home, same trail up to the last live step, one step further for a win, the same step count for a scandal.
function pendOk(p, run, tiers, map) {
  if (!p || typeof p !== 'object' || !p.run || typeof p.run !== 'object') return false;
  const r = p.run;
  try { E.check(r, tiers, map); } catch { return false; }
  if (r.done !== p.reason || !['scandal', 'deadend', 'landslide'].includes(r.done)) return false;
  if (r.home !== run.home || !run.trail.every((x, i) => r.trail[i] === x)) return false;
  return r.done === 'scandal' ? r.steps === run.steps : r.steps === run.steps + 1;
}
function recoverOne(o, escrows) {
  const nk = o && typeof o.key === 'string' ? nkey(o.key) : '';
  const tiers = o ? tiersOf(o) : null, map = o ? mapOf(o, tiers) : null;
  const rec = o && { roundId: o.roundId, nk, cur: o.cur, bet: o.bet, run: o.run, startedAt: o.startedAt, lastAt: o.lastAt, tiers: tiers || undefined, map: o.map != null && map ? map : undefined, pend: o.pend || undefined, timer: null, closed: false };
  const dropIt = () => { try { store.delOpen(o && o.key); store.flush(); } catch (e) { logf('campaign: recover: record not dropped', o && o.roundId, e && e.message); } };
  if (!rec || !nk || !validId(rec.roundId) || !MODES.includes(rec.cur)) { logf('campaign: recover: unusable record dropped', o && o.roundId); return dropIt(); }
  const esc = escrows.get(`${nk}|${rec.cur}|${rec.roundId}`);
  if (esc == null) { logf('campaign: recover: stale record (no escrow), dropped, nothing paid', rec.roundId); return dropIt(); }
  let valid = !!tiers && !!map;                                                  // the run is consistent with the growth table and the map it was opened with (not those of this build)
  if (valid) { try { E.check(rec.run, tiers, map); } catch { valid = false; } }
  if (valid && rec.run.done) valid = false;                                      // a stored live run is never a finished one (a finished one is the `pend`)
  if (valid && o.pend != null && !pendOk(o.pend, rec.run, tiers, map)) valid = false;
  const good = valid && isInt(rec.bet) && rec.bet === esc;
  if (!good) {
    logf('campaign: recover: record fails its check or does not match the escrow, voiding it', rec.roundId);
    try { M().void(nk, rec.cur, rec.roundId, 'unresolvable'); } catch (e) { if (!(e && e.code === 'round_closed')) { logf('campaign: recover: void refused, record kept', rec.roundId, e && e.message); return keepOpen(rec, valid); } }
    return dropIt();
  }
  const pend = rec.pend || null, refund = !pend && rec.run.steps === 0;
  try {
    if (refund) M().void(nk, rec.cur, rec.roundId, 'boot');
    else M().settle(nk, rec.cur, rec.roundId, { win: E.payout(pend ? pend.run : rec.run, rec.bet), stake: rec.bet });
  } catch (e) {
    if (e && e.code === 'round_closed') { logf('campaign: recover: the ledger closed this run already, record dropped', rec.roundId); return dropIt(); }
    if (e && e.code === 'stake_mismatch') { try { M().void(nk, rec.cur, rec.roundId, 'unresolvable'); return dropIt(); } catch {} }
    noteFence(e);
    logf('campaign: recover: close refused, the run stays open', rec.roundId, e && e.code, e && e.message);
    return keepOpen(rec, true);
  }
  logf('campaign: recover:', refund ? 'refunded' : pend ? `closed as drawn (${pend.reason})` : 'cashed out at the stored multiplier', rec.roundId, 'steps', rec.run.steps, 'mx', (pend ? pend.run : rec.run).mx);
  dropIt();
}
// the run stays open in memory with an idle timer that retries the close (the record is on disk; audit() lists it). A record that failed its check is not held in memory: it cannot be played.
function keepOpen(rec, usable) {
  if (!usable) return;
  runs.set(rec.nk, rec); armIdle(rec, idleMs());
}
function recover(rounds) {
  if (!store) return;
  if (store.blocked()) { alarm('campaign: recover: the store is BLOCKED (see the line above): no open run is settled, no escrow is refunded, every stake stays in the ledger until a person fixes the file'); return; }
  const escrows = new Map();
  for (const r of rounds || []) escrows.set(`${nkey(r.key)}|${r.cur}|${r.roundId}`, r.amount);
  const seen = new Set();
  for (const o of store.allOpen().slice()) {
    try { recoverOne(o, escrows); } catch (e) { logf('campaign: recover threw on a record', o && o.roundId, e && e.message); }
    if (o && typeof o.key === 'string') seen.add(`${nkey(o.key)}|${o.cur}|${o.roundId}`);
  }
  for (const r of rounds || []) {                                              // an escrow with no record: no step was ever taken, give the stake back
    if (seen.has(`${nkey(r.key)}|${r.cur}|${r.roundId}`)) continue;
    try { M().void(nkey(r.key), r.cur, r.roundId, 'boot'); (store.lost() ? alarm : logf)('campaign: recover: escrow with no record, refunded at the stake' + (store.lost() ? ' (the state file was lost: this run\'s multiplier is unknown)' : ''), r.roundId, nkey(r.key), r.cur, r.amount); }
    catch (e) { if (!(e && e.code === 'round_closed')) logf('campaign: recover: refund of an escrow with no record refused', r.roundId, e && e.message); }
  }
  try { store.flush(); } catch (e) { logf('campaign: store flush failed after recover', e && e.message); }
}
// from the game's OWN records: every open run with a stake. The soak compares it with the ledger.
function audit() {
  const openRounds = [];
  if (store && store.blocked()) throw Object.assign(new Error('campaign store blocked: the open runs are unknown'), { code: 'store_blocked' });   // the registry then leaves this game's escrows alone
  if (store) for (const o of store.allOpen()) if (o && isInt(o.bet) && o.bet > 0 && typeof o.key === 'string' && validId(o.roundId) && MODES.includes(o.cur)) openRounds.push({ key: nkey(o.key), cur: o.cur, roundId: o.roundId, amount: o.bet });
  return { openRounds, pools: {} };
}

// ---------------------------------------------------------------------------------------------------------------- handlers
// 150 ms per account and event; the clock is the injected one so a test can drive it
function limited(socket, nk, ev) {
  const k = nk + '|' + ev, t = now(), last = rateLast.get(k);
  if (last != null && t >= last && t - last < RATE_MS) { err(socket, 'rate', 'Too fast'); return true; }
  rateLast.set(k, t);
  return false;
}

function start(socket, payload) {
  const nk = keyOf(socket);
  if (limited(socket, nk, 'start')) return;
  const cur = field(payload, 'mode'), bet = field(payload, 'bet'), home = field(payload, 'home');
  if (cur !== 'play' && cur !== 'chips') return err(socket, 'bad_mode', 'Pick Cash or chips');
  if (typeof bet !== 'number' || !E.BET_LEVELS.includes(bet)) return err(socket, 'bad_bet', 'Pick a bet level');
  if (typeof home !== 'string' || !own(E.MAP.states, home)) return err(socket, 'bad_home', 'Pick a home state');
  const open = runs.get(nk);
  if (open) return err(socket, 'run_open', 'You have a run open', { run: runView(open) });
  if (fenced) return err(socket, 'money_down', MONEY_DOWN);
  let run;
  try { run = E.newRun(home); } catch { return err(socket, 'bad_home', 'Pick a home state'); }
  try { if (M().balance(nk, cur) < bet) return err(socket, 'funds', fundsMsg(cur)); } catch { return err(socket, 'internal', 'Server error'); }
  const roundId = crypto.randomBytes(8).toString('hex');
  // ---- the ledger first: the stake goes into escrow (ONE transfer). Nothing below may await, or a second start could interleave.
  try { M().open(nk, cur, roundId, bet); }
  catch (e) { noteFence(e); return e && e.code === 'funds' ? err(socket, 'funds', fundsMsg(cur)) : err(socket, 'internal', 'Server error'); }
  // ---- state second: the record is on disk before the client hears of the run. A crash between the two leaves an escrow with no record: recover() refunds it (no step was taken).
  const t = now();
  const rec = { roundId, nk, cur, bet, run, tiers: tiersNow(), map: E.snapshot(), startedAt: t, lastAt: t, timer: null, closed: false, idleMs: 0, expiresAt: 0 };
  try { store.putOpen(toStored(rec)); store.flush(); }
  catch (e) {
    logf('campaign: record not flushed, refunding the stake', roundId, e && e.message);
    try { store.delOpen(nk); } catch {}
    try { M().void(nk, cur, roundId, 'open_error'); } catch (e2) { logf('campaign: refund after a failed record refused (boot recovery refunds it)', roundId, e2 && e2.message); }
    return err(socket, 'internal', 'Server error');
  }
  runs.set(nk, rec); armIdle(rec, idleMs());
  socket.emit('g:campaign:run', { run: runView(rec), balances: safeBalances(nk) });
}

// the account's open run for an event that names a roundId: no run = no_run; another round id = bad_step (a client with a stale id resyncs through `state`)
function runFor(socket, nk, payload, ev) {
  const rec = runs.get(nk);
  if (!rec || rec.closed) { err(socket, 'no_run', 'No run is open'); return null; }
  const id = field(payload, 'roundId');
  if (typeof id !== 'string' || id !== rec.roundId) { err(socket, ev === 'step' ? 'bad_step' : 'no_run', ev === 'step' ? 'That is not your open run' : 'No run is open'); return null; }
  return rec;
}

function step(socket, payload) {
  const nk = keyOf(socket);
  if (limited(socket, nk, 'step')) return;
  const rec = runFor(socket, nk, payload, 'step');
  if (!rec) return;
  if (rec.pend) return void autoClose(rec, 'timeout');                                    // a result is already drawn for this run: close it as drawn (retry the ledger), never draw again
  if (fenced) return err(socket, 'money_down', MONEY_DOWN);                               // the ledger refuses writes for good: nothing is drawn against a dead ledger
  const n = field(payload, 'n'), to = field(payload, 'to');
  if (!isInt(n) || n !== rec.run.steps + 1) return err(socket, 'bad_step', 'That step is not next');
  if (typeof to !== 'string' || !E.options(rec.run, rec.tiers, rec.map).some((o) => o.to === to)) return err(socket, 'bad_step', 'You cannot go there');
  // One draw per (step, target state) for the life of the run in memory, until a result is durably written: a refused step, asked again for this or any other state, never draws again (Money 1008 K2-Cdisk, R2D-1).
  const mk = `${n}|${to}`;
  let res = rec.memo && rec.memo.get(mk);
  if (!res) {
    const force = forceFor(rec, payload);
    const rng = force ? FORCE_RNG[force] : rngOf();
    try { res = E.step(rec.run, to, rng, rec.tiers, rec.map); } catch (e) { return err(socket, e && e.code === 'bad_step' ? 'bad_step' : 'internal', e && e.code === 'bad_step' ? 'You cannot go there' : 'Server error'); }
    (rec.memo || (rec.memo = new Map())).set(mk, res);
  }
  const next = res.run;
  if (!res.ok || next.done) {                                                             // scandal (settle with win 0: the stake goes to the house) or landslide / dead end (an automatic cash-out at the new multiplier)
    const old = toStored(rec);
    rec.pend = { run: next, reason: next.done };                                          // the drawn result is final from here: written to the record BEFORE the ledger is asked, so a refused settle,
    let durable = false;                                                                  // a restart or a flush error can never turn it into a cash-out, a better result or a new draw
    try { store.putOpen(toStored(rec)); store.flush(); durable = true; rec.memo = null; }
    catch (e) { logf('campaign: pended result not flushed (the ledger settle is tried; if that fails too the step did not happen)', rec.roundId, e && e.message); try { store.putOpen(old); } catch {} }
    if (closeRun(rec, next, next.done, next.failedAt || null, socket) || durable || rec.closed || runs.get(rec.nk) !== rec) return;   // closed; or refused with the drawn result on disk: rec.pend stays, a retry / the idle timer / boot close it as drawn
    // refused AND the result is on neither disk: the client was told an error (closeRun -> moneyFailed), never the result, and a restart would forget it. The step did not happen: the run is back at the step before (disk = memory),
    // and the retry of this step gets the SAME draw (rec.memo keeps every draw of it), so the failure is no re-roll. Record first, client last.
    rec.pend = null;
    return;
  }
  // survived and the run goes on: the new record is flushed BEFORE the client hears of the step; a crash before the flush = the step never happened. No ledger line (nothing moved).
  const old = toStored(rec), t = now();
  const fresh = { ...old, run: next, lastAt: t };
  try { store.putOpen(fresh); store.flush(); }
  catch (e) {
    logf('campaign: step not flushed, the step did not happen yet (the retry of this step gets the same draw)', rec.roundId, e && e.message);
    try { store.putOpen(old); } catch {}
    return void refused(rec, INTERNAL(), socket);                                          // the SAME answer, sockets and timer as a drawn scandal that could not be written (moneyFailed)
  }
  rec.memo = null; rec.run = next; rec.lastAt = t;
  armIdle(rec, idleMs());
  socket.emit('g:campaign:step', { roundId: rec.roundId, n, to, tier: res.opt.tier, run: runView(rec) });
}

function cash(socket, payload) {
  const nk = keyOf(socket);
  if (limited(socket, nk, 'cash')) return;
  const rec = runFor(socket, nk, payload, 'cash');
  if (!rec) return;
  if (rec.pend) return void autoClose(rec, 'timeout');
  closeRun(rec, rec.run, rec.run.steps === 0 ? 'withdrawn' : 'cashout', null, socket);
}

function state(socket) {
  const nk = keyOf(socket);
  if (limited(socket, nk, 'state')) return;
  socket.emit('g:campaign:state', stateView(nk));
}

module.exports = {
  id: 'campaign',
  name: 'Campaign Trail',
  kind: 'solo',
  betLevels: E.BET_LEVELS,
  // init loads the store and moves NO money (boot settles / voids open runs in recover()). ctx.files (from server.js) says where the game's file lives.
  init(ctx) {
    this.rng = ctx.rng || cryptoRng;
    for (const rec of runs.values()) clearTimer(rec);
    runs.clear(); rateLast.clear(); fenced = null;
    if (store) store.close();
    C = ctx; cashForceSeen = 0;
    if (testHookOn()) alarm('campaign: *** QA FORCE HOOK IS ON (CAMPAIGN_TEST=1, NODE_ENV=' + (process.env.NODE_ENV || '(unset)') + '): any signed-in player can force Campaign steps in CHIPS ONLY; Cash runs ignore it. Never set CAMPAIGN_TEST on a real server. ***');
    const files = ctx.files || {};
    store = createStore(process.env.CAMPAIGN_FILE || files.campaign || null, { log: logf, alarm });
  },
  recover, audit,
  handlers: { state, start, step, cash },
  _test: { runs, get store() { return store; }, idleMs, autoClose },
};
