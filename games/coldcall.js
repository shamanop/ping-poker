'use strict';
// COLD CALL: server-authoritative slot. Math lives in coldcall-engine.js (same file the client copy uses, for animation only).
const crypto = require('crypto');
const path = require('path');
const Eng = require('./coldcall-engine.js');
const { createStore } = require('./coldcall-store.js');

const BET_LEVELS = Eng.BET_LEVELS;
const BUYS = Eng.BUYS;   // call, bonus1, bonus2, hunt (prices in Eng.CFG.buyCost, tenths of the bet)
const RATE_MS = 150;
const HISTORY_MAX = 20;
const RTP_LABEL = '97.93% (long-run, 450M-spin stratified sim, +-0.11)';

// QA hook: forces a feature so the front end can be driven by a test. It runs ONLY when the server process was started
// with COLDCALL_TEST=1 (and NODE_ENV is not 'production'); otherwise `force` in a spin payload is ignored. Forced rounds are paid and
// charged through the normal wallet path, with real engine rounds (bells placed, or whole rounds re-rolled until the condition holds; no hand-made scripts).
//   bonus1 / bonus2 / bonus3 = 3 / 4 / 5 bells land; phone = phone feature with >= 4 hot leads; close = phone feature with a close and a second reveal round;
//   big = round pays >= 25x; tease = exactly 2 bells, no bonus.
const FORCES = Eng.FORCES;
const testHookOn = () => process.env.COLDCALL_TEST === '1' && process.env.NODE_ENV !== 'production';
const resolveForced = (rng, force) => Eng.resolveRound(rng, null, { force });

function cryptoRng() {
  return () => crypto.randomBytes(6).readUIntBE(0, 6) / 281474976710656; // 48-bit uniform in [0,1)
}

const history = new Map(); // account key -> last rounds (memory only)
const keyOf = (socket) => { const a = socket.data && socket.data.acct; return String(a && typeof a === 'object' ? a.key : a || ''); };
const nkey = (k) => String(k).toLowerCase().trim();   // same normalisation as wallet.js
const whoOf = (socket) => { const a = socket.data && socket.data.acct; return String((a && typeof a === 'object' ? (a.display || a.key) : a) || ''); };
const clone = (o) => JSON.parse(JSON.stringify(o));

function err(socket, code, message, extra) { socket.emit('error', { message, code, game: 'coldcall', ...(extra || {}) }); }

function walletErr(socket, e) {
  if (e && e.code === 'funds') return err(socket, 'funds', e.message);
  return err(socket, 'bad_request', 'Could not place that bet');
}

// ---------------------------------------------------------------------------------------------------------------- THE PULL
// Player state, the pot, decisions, feed. See cold-call/PULL-ENGINE.md section 4. Everything that moves money in one spin or one settlement
// runs in one synchronous block (no await), so concurrent callers cannot interleave.
const pullOn = () => { const c = Eng.CFG.pull; return !!(c && c.on !== false); };
let C = null;                 // the games ctx from init (io, wallet, now)
let store = null;
const open = new Map();       // roundId -> open record (memory: tape, state snapshot, timer, owning socket)
const openByKey = new Map();  // "<nkey>|<mode>" -> open record
let feed = [], feedSeq = 0;   // ring buffer (50), memory only
const FEED_MAX = 50, FEED_STATE = 20;

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' });
const chicagoDay = (ms) => dayFmt.format(new Date(ms));
const pullCfg = () => Eng.CFG.pull;
const logf = (...a) => { const f = module.exports.log; if (f) f(...a); };

function clearTimers() { for (const rec of open.values()) if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; } }

// the player's state as the engine should see it (clone, cold clock applied)
const loadState = (nk, mode, now) => Eng.tickState(clone(store.player(nk, mode) || Eng.newState()), now);

function stateView(state, now, day) {
  return {
    leads: Math.floor(state.lt / 10), lt: state.lt, list: pullCfg().list, cb: state.cb, warm: state.warm,
    cold: Eng.coldInfo(state, now), daily: { claimed: state.day === day, streak: state.streak },
  };
}
const potView = (mode) => { const p = store.pot(mode, pullCfg().pot.seed); return { bal: p.bal, last: p.last }; };
const potsView = () => ({ play: potView('play'), chips: potView('chips') });

function broadcast(ev, payload) {
  const m = C && C.io && C.io.sockets && C.io.sockets.sockets;
  if (!m) return;
  for (const s of m.values()) if (s.data && s.data.acct) { try { s.emit(ev, payload); } catch {} }
}
function pushFeed(kind, rec, x, amount, bonus) {
  const ev = { id: ++feedSeq, t: C.now(), game: 'coldcall', kind, who: rec.who, x, amount, mode: rec.mode };
  if (bonus) ev.bonus = bonus;
  feed.push(ev); if (feed.length > FEED_MAX) feed.shift();
  broadcast('floor:feed', ev);
}

// a recording rng over the module rng: replays the tape first, then draws (and records) fresh values
function runRound(rec, decisions, auto) {
  const base = module.exports.rng || cryptoRng();
  let i = 0;
  const rng = () => { if (i < rec.tape.length) return rec.tape[i++]; const v = base(); rec.tape.push(v); i++; return v; };
  const len = rec.tape.length;
  try {
    return Eng.playRound(rng, { buy: rec.buy, bet: rec.bet, state: clone(rec.state), now: rec.now, day: rec.day, script: true, auto: !!auto, ...(rec.force ? { force: rec.force } : {}) }, decisions);
  } catch (e) { rec.tape.length = len; throw e; }
}

function pendingView(rec) {
  return {
    roundId: rec.id, status: 'pending', pending: rec.pending, partial: rec.partial, mode: rec.mode, bet: rec.betCents, betCents: rec.betCents,
    cost: rec.cost, costTenths: rec.costTenths, buyBonus: rec.buy, callback: rec.callback, timeoutMs: rec.timeoutMs, expiresAt: rec.expiresAt,
    pull: { state: stateView(rec.state, rec.now, rec.day) }, pot: null,
  };
}

function armTimer(rec) {
  if (rec.timer) clearTimeout(rec.timer);
  rec.timeoutMs = pullCfg().decision.timeoutMs;
  rec.expiresAt = C.now() + rec.timeoutMs;
  rec.timer = setTimeout(() => { rec.timer = null; autoSettle(rec, 'timeout'); }, rec.timeoutMs);
  if (rec.timer.unref) rec.timer.unref();
}

function dropOpen(rec) {
  if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
  open.delete(rec.id); openByKey.delete(rec.nk + '|' + rec.mode);
}

// Settle a round (status done). One synchronous block: record dropped, pot, state, wallet credits. A round that was open is flushed in the order
// store (record gone) then wallet (win credited), so a crash can lose a win but never pay a round twice.
function settle(rec, r, autoWhy, extraSocket) {
  if (rec.settled) return null;
  rec.settled = true;
  const wasOpen = open.has(rec.id);
  if (wasOpen) { dropOpen(rec); store.delOpen(rec.nk, rec.mode); }
  const mode = rec.mode, key = rec.key, cfg = pullCfg();
  const betCents = r.betCents != null ? r.betCents : rec.betCents;
  const cost = rec.cost;
  const winCents = Eng.cents(r.winTenths, betCents);
  const ref = { game: 'coldcall', round: rec.id };

  // pot: slice of every paid spin, one hit roll, award (never on a Callback)
  let potWon = null, potMoved = false;
  const pot = store.pot(mode, cfg.pot.seed);
  if (cost > 0) {
    const s = Eng.potSlice(cfg.pot.feedBps, cost, pot.rem);
    pot.rem = s.rem; pot.bal += s.slice; pot.fed += s.slice; potMoved = s.slice > 0;
    const u = (module.exports.potRng || cryptoRng())();
    if (u < Eng.potHitChance(cfg, cost) && pot.bal >= cfg.pot.minBal && pot.bal > 0) {
      const prize = Math.min(pot.bal, cfg.pot.maxPayX * betCents);
      pot.paid += prize; pot.bal -= prize;
      if (cfg.pot.seed > 0) { pot.bal += cfg.pot.seed; pot.seeded += cfg.pot.seed; }
      pot.last = { who: rec.who, amount: prize, at: C.now() };
      potWon = { won: true, amount: prize, who: rec.who }; potMoved = true;
    }
    store.potChanged();
  }
  store.setPlayer(rec.nk, mode, r.newState);
  if (wasOpen) store.flush();

  let w;
  try { w = C.wallet.credit(key, mode, winCents, ref); } catch (e) { logf('coldcall: win credit failed', rec.id, e && e.message); w = C.wallet.get(key); }
  if (potWon) { try { w = C.wallet.credit(key, mode, potWon.amount, { ...ref, pot: true }); } catch (e) { logf('coldcall: pot credit failed', rec.id, e && e.message); w = C.wallet.get(key); } }
  if (wasOpen && C.wallet.flush) C.wallet.flush();

  const callback = r.callback != null ? !!r.callback : !!rec.callback;
  const auto = autoWhy || null;
  const h = history.get(rec.key) || [];
  h.unshift({ roundId: rec.id, t: rec.t, bet: betCents, cost, mode, buy: rec.buy, totalWin: winCents, tier: r.tier, callback, auto, pot: potWon });
  if (h.length > HISTORY_MAX) h.length = HISTORY_MAX;
  history.set(rec.key, h);

  const day = rec.day;
  const result = {
    roundId: rec.id, status: 'done', pending: null, resolved: wasOpen, auto, bet: betCents, betCents, cost, mode, buyBonus: rec.buy, callback,
    script: r.script, costTenths: r.costTenths, totalWinTenths: r.winTenths, totalWinMult: r.winX, totalWin: winCents, tier: r.tier, maxed: r.capped,
    wallet: w, balances: w,
    pull: { ...(r.pull || {}), state: stateView(r.newState, rec.now, day) }, pot: potWon,
    ...(rec.forced ? { forced: rec.forced } : {}),
  };
  for (const s of new Set([rec.socket, extraSocket])) if (s) { try { s.emit('g:coldcall:result', result); } catch {} }

  // feed + floor
  const bonusKind = r.script && r.script.bonus && r.script.bonus.kind;
  if (bonusKind) pushFeed('bonus', rec, r.winX, winCents, bonusKind);
  if (r.winX >= cfg.feed.minWinX) pushFeed('win', rec, r.winX, winCents, bonusKind || undefined);
  if (r.pull && r.pull.armed) pushFeed('callback', rec, 0, 0);
  if (potWon) pushFeed('pot', rec, potWon.amount / betCents, potWon.amount);
  if (potMoved) broadcast('floor:pot', { mode, bal: pot.bal });
  return result;
}

// Refund an open round (restart, or a round the engine could not default). Record dropped first, then the cost credited once.
function voidRound(rec, why) {
  if (rec.settled) return;
  rec.settled = true;
  dropOpen(rec); store.delOpen(rec.nk, rec.mode); store.flush();
  let w = null;
  try { w = C.wallet.credit(rec.key, rec.mode, rec.cost, { game: 'coldcall', round: rec.id, void: why }); } catch (e) { logf('coldcall: refund failed', rec.id, e && e.message); }
  if (C.wallet.flush) C.wallet.flush();
  logf('coldcall: voided round', rec.id, why, 'refund', rec.cost, rec.mode);
  if (rec.socket) { try { rec.socket.emit('g:coldcall:voided', { roundId: rec.id, mode: rec.mode, refund: rec.cost, reason: why, wallet: w }); } catch {} }
}

// take the safe default for every remaining decision of an open round and settle it
function autoSettle(rec, why) {
  if (rec.settled || !open.has(rec.id)) return;
  let r = null;
  try { r = runRound(rec, rec.decisions, true); } catch (e) { r = null; }
  if (!r || r.status !== 'done') return voidRound(rec, 'unresolvable');
  settle(rec, r, why);
}

// restart: every open round from the last run is refunded exactly once
function voidStored() {
  for (const o of store.allOpen()) {
    store.delOpen(o.key, o.mode); store.flush();
    try { C.wallet.credit(o.key, o.mode, o.cost, { game: 'coldcall', round: o.roundId, void: 'restart' }); } catch (e) { logf('coldcall: refund failed', o.roundId, e && e.message); }
    logf('coldcall: voided round at restart', o.roundId, 'refund', o.cost, o.mode, o.key);
  }
  if (C.wallet.flush) C.wallet.flush();
}

function pullSpin(socket, p, buy, now) {
  const key = keyOf(socket), nk = nkey(key), mode = p.mode;
  const ok = nk + '|' + mode;
  const o = openByKey.get(ok);
  if (o) return err(socket, 'decision_open', 'Finish your open decision first', { open: pendingView(o) });
  const day = chicagoDay(now);
  const state = loadState(nk, mode, now);
  const callback = buy === null && !!state.cb;
  const force = testHookOn() && buy === null && FORCES.includes(p.force) ? p.force : null;
  const rec = {
    id: crypto.randomBytes(6).toString('hex'), key, nk, mode, who: whoOf(socket), socket, buy, bet: p.bet,
    betCents: callback ? state.cb.bet : p.bet, callback, state, now, day, t: now, tape: [], decisions: [], force, forced: force,
  };
  const auto = p.auto === true;
  let r, cost;
  try {
    r = runRound(rec, [], auto);
    if (r.betCents != null) rec.betCents = r.betCents;
    rec.costTenths = r.costTenths;
    cost = r.costTenths ? Eng.cents(r.costTenths, rec.betCents) : 0;
  } catch (e) { return err(socket, 'bad_request', 'Could not place that bet'); }
  rec.cost = cost;
  if (cost > 0) { try { C.wallet.spend(key, mode, cost, { game: 'coldcall', round: rec.id }); } catch (e) { return walletErr(socket, e); } }

  if (r.status === 'pending') {
    rec.pending = r.pending; rec.partial = r.partial;
    open.set(rec.id, rec); openByKey.set(ok, rec);
    store.putOpen({ roundId: rec.id, key: nk, mode, cost, bet: rec.betCents, buy, t: now });
    armTimer(rec);
    if (C.wallet.flush) C.wallet.flush();
    store.flush();
    socket.emit('g:coldcall:result', pendingView(rec));
    return;
  }
  const autoHit = auto && r.pull && ((r.pull.pick && r.pull.pick.auto) || (r.pull.more && r.pull.more.auto));
  settle(rec, r, autoHit ? 'autoplay' : null);
}

module.exports = {
  id: 'coldcall',
  name: 'Cold Call',
  kind: 'solo',
  betLevels: BET_LEVELS,
  RTP_LABEL,
  init(ctx) {
    this.rng = ctx.rng || cryptoRng();
    clearTimers(); open.clear(); openByKey.clear();
    if (store) store.close();
    C = ctx; feed = []; feedSeq = 0;
    const file = process.env.COLDCALL_PULL_FILE || (ctx.wallet && ctx.wallet.file ? path.join(path.dirname(ctx.wallet.file), 'coldcall-pull.json') : null);
    store = createStore(file);
    voidStored();
  },
  onDisconnect(socket) {
    if (socket.data) delete socket.data.coldcallLast;
    for (const rec of [...open.values()]) if (rec.socket === socket) { try { autoSettle(rec, 'disconnect'); } catch {} }
  },
  handlers: {
    state(socket, payload, ctx) {
      const w = ctx.wallet.get(keyOf(socket));
      const extra = {};
      if (pullOn() && store) {
        const now = ctx.now(), day = chicagoDay(now), nk = nkey(keyOf(socket));
        const opens = ['play', 'chips'].map((m) => openByKey.get(nk + '|' + m)).filter(Boolean).map(pendingView);
        extra.pull = { on: true, list: pullCfg().list, decisionMs: pullCfg().decision.timeoutMs, play: stateView(loadState(nk, 'play', now), now, day), chips: stateView(loadState(nk, 'chips', now), now, day) };
        extra.pot = potsView(); extra.feed = feed.slice(-FEED_STATE); extra.open = opens[0] || null; extra.opens = opens;
      }
      socket.emit('g:coldcall:state', {
        engine: 2, grid: { cols: Eng.COLS, rows: Eng.ROWS },
        betLevels: BET_LEVELS, modes: ['play', 'chips'], rtp: RTP_LABEL, maxWinX: Eng.MAX_WIN_X,
        buyCostX: Object.fromEntries(BUYS.map((b) => [b, Eng.CFG.buyCost[b] / 10])),
        wallet: w, balances: w, bets: BET_LEVELS,
        ...(testHookOn() ? { qaHook: true } : {}),
        ...extra,
      });
    },
    history(socket) {
      socket.emit('g:coldcall:history', { rounds: history.get(keyOf(socket)) || [] });
    },
    floor(socket) {
      if (!store) return;
      socket.emit('g:coldcall:floor', { pot: potsView(), feed: feed.slice(-FEED_STATE) });
    },
    decide(socket, payload) {
      const p = payload && typeof payload === 'object' ? payload : {};
      const rec = open.get(String(p.roundId));
      if (!rec) return err(socket, 'no_round', 'No open decision');
      if (rec.nk !== nkey(keyOf(socket))) return err(socket, 'forbidden', 'Not your round');
      const pend = rec.pending;
      if (p.k !== pend.k) return err(socket, 'bad_request', 'Wrong decision');
      let d;
      if (pend.k === 'pick') {
        if (!Number.isSafeInteger(p.p) || !pend.choices.includes(p.p)) return err(socket, 'bad_request', 'Pick one of the marked squares');
        d = { k: 'pick', p: p.p };
      } else {
        if (typeof p.take !== 'boolean') return err(socket, 'bad_request', 'Take it or bank it');
        d = { k: 'more', take: p.take };
      }
      const decisions = rec.decisions.concat([d]);
      let r;
      try { r = runRound(rec, decisions, false); } catch (e) { return err(socket, 'bad_request', 'Invalid decision'); }
      rec.decisions = decisions;
      if (r.status === 'pending') {
        rec.pending = r.pending; rec.partial = r.partial;
        armTimer(rec);
        const v = pendingView(rec);
        for (const s of new Set([rec.socket, socket])) if (s) { try { s.emit('g:coldcall:result', v); } catch {} }
        return;
      }
      settle(rec, r, null, socket);
    },
    spin(socket, payload, ctx) {
      const t = ctx.now();
      if (socket.data.coldcallLast != null && t - socket.data.coldcallLast < RATE_MS) return err(socket, 'rate', 'Slow down');
      socket.data.coldcallLast = t;
      const p = payload && typeof payload === 'object' ? payload : {};
      if (!Number.isSafeInteger(p.bet) || !BET_LEVELS.includes(p.bet)) return err(socket, 'bad_bet', 'Pick a listed bet');
      if (p.mode !== 'play' && p.mode !== 'chips') return err(socket, 'bad_mode', 'Pick Play $ or Chips');
      const buy = p.buyBonus == null || p.buyBonus === false ? null : p.buyBonus;
      if (buy !== null && !BUYS.includes(buy)) return err(socket, 'bad_request', 'Bad bonus');
      if (pullOn() && store) return pullSpin(socket, p, buy, t);

      const key = keyOf(socket);
      const rng = module.exports.rng || cryptoRng();
      const roundId = crypto.randomBytes(6).toString('hex');
      const force = testHookOn() && buy === null && FORCES.includes(p.force) ? p.force : null;
      const r = force ? resolveForced(rng, force) : Eng.resolveRound(rng, buy);   // pure; nothing touched yet
      let cost, totalWin;
      try { cost = Eng.cents(r.costTenths, p.bet); totalWin = Eng.cents(r.winTenths, p.bet); } catch (e) { return err(socket, 'bad_request', 'Could not place that bet'); }
      const ref = { game: 'coldcall', round: roundId };
      let w;
      try { ctx.wallet.spend(key, p.mode, cost, ref); } catch (e) { return walletErr(socket, e); }
      try { w = ctx.wallet.credit(key, p.mode, totalWin, ref); } catch (e) { w = ctx.wallet.get(key); }

      const h = history.get(key) || [];
      h.unshift({ roundId, t, bet: p.bet, cost, mode: p.mode, buy, totalWin, tier: r.tier });
      if (h.length > HISTORY_MAX) h.length = HISTORY_MAX;
      history.set(key, h);

      socket.emit('g:coldcall:result', {
        roundId, bet: p.bet, cost, mode: p.mode, buyBonus: buy,
        script: r.script, costTenths: r.costTenths, totalWinTenths: r.winTenths, totalWinMult: r.winX, totalWin, tier: r.tier, maxed: r.capped,
        wallet: w, balances: w,
        ...(force ? { forced: force } : {}),
      });
    },
  },
  _history: history,
  _pull: { open, get store() { return store; } },
};
