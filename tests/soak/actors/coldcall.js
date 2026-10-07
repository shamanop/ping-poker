'use strict';
// Actor: the slot COLD CALL (games/coldcall.js, money through ctx.money). Both currencies, every bet level, plain spins, every buy, QA-forced rounds, decisions (answered, left to their timer,
// or left open across a kill), the free Callback, the office pot, a live config change while a round is open, a socket dropped while a round is open, spins the player cannot afford,
// spins sent back to back.
// Actor interface (all actors): { name, weight, init(W)?, afterRestart(W)?, step(W) -> record | null }. This one also exports attach / listen / adoptUnheard / reconcile / ops, used by soak.js and chaos.js.
//
// What the harness believes (model.js SlotBook): only what the client was told (g:coldcall:result pending / done, g:coldcall:voided), plus, where a kill or a dropped socket kept the client from
// hearing, ONE close line per round that was open (a settle whose stake is the escrow, or a void that returns it). The ledger side (cost, win, pot prize, feed, escrow) is judged in invariants.js checkSlot.
const { sleep } = require('../lib/bot');

const BUYS = ['call', 'bonus1', 'bonus2', 'hunt'];
const FORCES = ['bonus1', 'bonus2', 'bonus3', 'phone', 'close', 'big', 'tease'];
const ADMIN_TOKEN = 'soak-admin-token';
// the live config the soak plays on: a Callback after a handful of spins, a pot that is fed 1.5% and hit often (the validator caps a hit at capCents x 3 <= oneInPerDollar x 5), decisions that default after 3 s, ONE MORE CALL offered from a 1x bonus up
const SETUP_CFG = { pull: { list: 4, pot: { feedBps: 150, oneInPerDollar: 30, minBal: 20, capCents: 50 }, decision: { timeoutMs: 3000 }, more: { minTenths: 10 } } };
const k2 = (key, cur) => `${key}|${cur}`;
const acct = (key, cur) => (cur === 'chips' ? 'bank:' : 'play:') + key;

function attach(W) {
  W.slot = { betLevels: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2500], buyPrice: {}, feedBps: null, inflight: new Map(), epoch: 0, epochEnds: [], c: { plain: 0, buy: 0, forced: 0, decided: 0, readyLeft: 0, funds: 0, rate: 0, busy: 0, drops: 0, cfg: 0, potWon: 0, callbacks: 0, pending: 0, voided: 0, unacked: 0, errors: 0 } };
}

// ---------------- what the client is told ----------------
function violate(W, msg, accounts, expected, got) { W.violate('I7', msg, accounts, expected, got); }
function priceOf(W, bet, buy) { const t = W.slot.buyPrice[bet]; return t && buy ? t[buy] : undefined; }

function listen(W, bot) {
  bot.on('g:coldcall:result', d => onResult(W, bot, d));
  bot.on('g:coldcall:voided', d => onVoided(W, bot, d));
  bot.on('g:coldcall:state', d => { if (d && d.buyPriceCents) { W.slot.buyPrice = d.buyPriceCents; if (d.betLevels) W.slot.betLevels = d.betLevels; } });
}
function inflightOf(S, key, cur) { return S.inflight.get(k2(key, cur)) || []; }
function dropInflight(S, key, cur) { const l = inflightOf(S, key, cur); const r = l.shift(); if (!l.length) S.inflight.delete(k2(key, cur)); return r; }

function onResult(W, bot, d) {
  if (W.mute.slot) return;
  const S = W.slot, B = W.model.slot, M = W.model;
  if (!d || typeof d.roundId !== 'string' || !M.hasPlayer(bot.key)) return;
  const key = bot.key, cur = d.mode, rid = d.roundId, id = `${key}:${rid}`, ak = k2(key, cur);
  const who = { key, roundId: rid };
  if (cur !== 'play' && cur !== 'chips') return violate(W, `slot result with mode ${JSON.stringify(cur)}`, who, 'play|chips', cur);
  if (d.status !== 'pending' && d.status !== 'done') return violate(W, `slot result with status ${JSON.stringify(d.status)}`, who, 'pending|done', d.status);
  const buy = d.buyBonus || null, callback = !!d.callback;
  const sent = dropInflight(S, key, cur);
  // the price: a Callback is free; a plain spin costs its bet; a buy costs the table price at that bet
  let want;
  if (callback) {
    want = 0;
    if (!rid.startsWith('cb')) violate(W, `a Callback result with round id ${rid} (a Callback id is cb + the id of the round that armed it)`, who, 'cb...', rid);
    if (buy) violate(W, `a Callback that is also a buy (${buy})`, who, 'no buy', buy);
    if (!B.armed.has(ak) && !B.unsure.has(ak)) violate(W, `${key} was paid a free Callback in ${cur} that no result had armed`, who, 'an armed Callback', 'none armed');
    if (sent && (sent.buy || sent.force)) violate(W, `a ${sent.buy ? 'buy' : 'forced round'} played the waiting Callback`, who, 'a stateless paid round', 'Callback');
  } else {
    if (!S.betLevels.includes(d.bet)) violate(W, `slot result at bet ${d.bet}, not a listed bet`, who, S.betLevels.join(','), d.bet);
    want = buy ? priceOf(W, d.bet, buy) : d.bet;
    if (want === undefined) violate(W, `slot result with buy ${buy} at bet ${d.bet}: no such price`, who, 'a priced buy', buy);
    if (sent) {
      if (sent.bet !== d.bet || (sent.buy || null) !== buy) violate(W, `slot result is not the round that was asked for: asked bet ${sent.bet} buy ${sent.buy}, got bet ${d.bet} buy ${buy}`, who, `bet ${sent.bet} buy ${sent.buy}`, `bet ${d.bet} buy ${buy}`);
      if (!sent.buy && !sent.force && B.armed.has(ak) && !B.unsure.has(ak) && !B.openOf(key, cur)) violate(W, `${key} has a waiting Callback in ${cur} (armed by an earlier result) and a plain spin did not play it`, who, 'the Callback', 'a paid round');
    }
  }
  if (want !== undefined && d.cost !== want) violate(W, `slot result is not priced as asked: cost ${d.cost} (want ${want}), bet ${d.bet}, buy ${buy}, callback ${callback}`, who, `cost ${want}`, `cost ${d.cost}`);
  const cost = want === undefined ? d.cost : want, plain = !callback && !buy && cost > 0;
  if (d.status === 'pending') {
    if (!d.pending || (d.pending.k !== 'pick' && d.pending.k !== 'more')) return violate(W, 'a pending slot round with no decision point', who, 'pick|more', JSON.stringify(d.pending));
    if (B.rounds.has(id)) return;                        // a late copy of a prompt for a round that is closed already
    const o = B.open.get(id);
    if (o) { if (o.cost !== cost) violate(W, `an open round's stake changed from ${o.cost} to ${cost}`, who, o.cost, cost); o.pending = d.pending; return; }
    B.open.set(id, { key, cur, rid, cost, buy, callback, plain, gen: bot.gen, epoch: S.epoch, pending: d.pending, since: Date.now() });
    S.c.pending++;
    return;
  }
  // done
  const win = d.totalWin, prize = d.pot && d.pot.won ? d.pot.amount : 0;
  if (!Number.isSafeInteger(win) || win < 0 || !Number.isSafeInteger(prize) || prize < 0) return violate(W, `slot result with win ${win} / pot prize ${prize}`, who, 'whole cents >= 0', `${win} / ${prize}`);
  if (prize > 0 && !plain) violate(W, `the pot was paid on a round that is not a plain paid spin (cost ${cost}, buy ${buy}, callback ${callback})`, who, 'RULE 1: only a plain paid spin wins the pot', `prize ${prize}`);
  const wasOpen = B.open.has(id);
  const r = { key, cur, rid, cost, win, prize, buy, callback, plain, escrowed: wasOpen && cost > 0, via: 'client', void: false, epoch: S.epoch };
  const prev = B.rounds.get(id);
  if (prev) {
    if (prev.cost !== cost || prev.win !== win || prev.prize !== prize || prev.void) violate(W, `two different results for slot round ${id}`, who, `cost ${prev.cost} win ${prev.win} prize ${prev.prize}${prev.void ? ' (void)' : ''}`, `cost ${cost} win ${win} prize ${prize}`);
    return;
  }
  W.model.applySlot(r);
  if (prize > 0) S.c.potWon++;
  if (callback) { S.c.callbacks++; B.armed.delete(ak); B.unsure.delete(ak); }
  if (d.pull && d.pull.armed) { B.armed.add(ak); B.unsure.delete(ak); }
  if (!callback && !buy) S.c.plain++; else if (buy) S.c.buy++;
  if (d.forced) S.c.forced++;
}

function onVoided(W, bot, d) {
  if (W.mute.slot) return;
  const S = W.slot, B = W.model.slot;
  if (!d || typeof d.roundId !== 'string' || !W.model.hasPlayer(bot.key)) return;
  const key = bot.key, id = `${key}:${d.roundId}`;
  dropInflight(S, key, d.mode);
  S.c.voided++;
  if (B.rounds.has(id)) return;
  const o = B.open.get(id);
  W.model.applySlot({ key, cur: d.mode, rid: d.roundId, cost: o ? o.cost : 0, win: 0, prize: 0, buy: o ? o.buy : null, callback: o ? o.callback : false, plain: false, escrowed: !!o && o.cost > 0, via: 'client', void: true, epoch: S.epoch });
}

// ---------------- a round the client could not hear the end of: one close line from the ledger ----------------
// open: the model's entry; L: the ledger line that closed it. Returns an error message or null.
function adoptClose(W, o, L, via) {
  const B = W.model.slot, s = L.slot, id = `${o.key}:${o.rid}`;
  if (s.cur !== o.cur) return `round ${id} was open in ${o.cur} and closed in ${s.cur}`;
  if (s.voided) {
    if (o.cost > 0 && s.voided !== o.cost) return `round ${id} (stake ${o.cost}) was voided with ${s.voided} returned`;
    W.model.applySlot({ key: o.key, cur: o.cur, rid: o.rid, cost: o.cost, win: 0, prize: 0, buy: o.buy, callback: o.callback, plain: false, escrowed: o.cost > 0, via, void: true, epoch: o.epoch });
  } else {
    if (s.spend !== o.cost) return `round ${id} was open with a stake of ${o.cost} and settled with a stake of ${s.spend}`;
    W.model.applySlot({ key: o.key, cur: o.cur, rid: o.rid, cost: o.cost, win: s.credit, prize: s.prize, buy: o.buy, callback: o.callback, plain: o.plain, escrowed: o.cost > 0, via, void: false, epoch: o.epoch });
  }
  W.slot.c.unacked++;
  return null;
}
// each check pass: a round whose client has since lost its socket (or a kill came) and that the ledger closed. A round with a client that WAS listening must be told (checkSlot flags it).
function adoptUnheard(W) {
  const C = W.checker, B = W.model.slot, S = W.slot, now = Date.now();
  for (const [id, o] of [...B.open]) {
    const bot = W.bots.get(o.key);
    const gone = !bot || bot.gen !== o.gen || o.epoch !== S.epoch || W.mute.slot;
    if (!gone) continue;
    if (!o.goneAt) o.goneAt = now;
    const e = C.slotRounds.get(id) || {};
    if (e.close) {
      if (now - e.close.seenAt < 1200) continue;
      const bad = adoptClose(W, o, e.close, 'unacked');
      if (bad) W.violate('I7', bad, { round: id }, 'one close line that matches the open round', e.close.ref);
    } else if (o.cost === 0 && now - o.goneAt > 1800) {      // a free round that paid nothing leaves no line: its decision defaulted when the socket went (see games/coldcall.js onDisconnect / recover)
      W.model.applySlot({ key: o.key, cur: o.cur, rid: o.rid, cost: 0, win: 0, prize: 0, buy: null, callback: true, plain: false, escrowed: false, via: 'unacked', void: false, epoch: o.epoch });
      S.c.unacked++;
    }
  }
}

// ---------------- after a kill ----------------
// sent: the slot spins that were in flight (no answer) when the server died. cls: checker.classifyRestart(). Returns violations.
function reconcile(W, cls, sent) {
  const C = W.checker, B = W.model.slot, S = W.slot, bad = [];
  const v = (message, accounts, expected, got) => bad.push({ step: W.stepNo, id: 'I9', message, accounts: accounts || {}, expected, got });
  const pool = sent.slice();
  const take = (key, cur, cost) => {                                        // the spin in flight that can explain a line
    let i = pool.findIndex(x => x.key === key && x.mode === cur && (x.buy ? priceOf(W, x.bet, x.buy) : x.bet) === cost);
    if (i < 0) i = pool.findIndex(x => x.key === key && x.mode === cur && !x.buy && !x.force);          // may have played the Callback (cost 0 at its own bet)
    if (i < 0) return null;
    return pool.splice(i, 1)[0];
  };
  const seen = new Set();
  for (const L of cls.racing) {
    const s = L.slot; if (!s) continue;
    const id = `${s.key}:${s.rid}`;
    if (B.rounds.has(id)) continue;
    if (s.suffix === 'open') {
      if (B.open.has(id)) continue;
      const x = take(s.key, s.cur, s.open);
      if (!x) { v(`ledger has an open Cold Call round ${L.ref} (stake ${s.open}) that no spin in flight at the kill explains`, { ref: L.ref }, 'a spin sent and not answered', `stake ${s.open}`); continue; }
      B.open.set(id, { key: s.key, cur: s.cur, rid: s.rid, cost: s.open, buy: x.buy || null, callback: false, plain: !x.buy, gen: -1, epoch: S.epoch, pending: null, since: Date.now() });
      seen.add(s.key + '|' + s.cur);
    } else {
      let o = B.open.get(id);
      if (!o) {
        const x = take(s.key, s.cur, s.spend);
        const cb = s.rid.startsWith('cb');
        if (!x) { v(`ledger has a Cold Call line ${L.ref} (stake ${s.spend}, win ${s.credit}) that no spin in flight at the kill explains`, { ref: L.ref }, 'a spin sent and not answered', `stake ${s.spend}`); continue; }
        o = { key: s.key, cur: s.cur, rid: s.rid, cost: cb ? 0 : s.spend, buy: cb ? null : x.buy || null, callback: cb, plain: !cb && !x.buy && s.spend > 0, gen: -1, epoch: S.epoch, pending: null, since: Date.now() };
        seen.add(s.key + '|' + s.cur);
      }
      const err = adoptClose(W, o, L, 'unacked');
      if (err) v(err, { ref: L.ref }, 'the close line of the open round', L.ref);
    }
  }
  for (const L of cls.bootSlot) {
    const s = L.slot, id = `${s.key}:${s.rid}`;
    if (B.rounds.has(id)) { v(`boot recovery closed ${id} a second time`, { ref: L.ref }, 'one close', L.ref); continue; }
    let o = B.open.get(id);
    if (!o) {
      const cb = s.rid.startsWith('cb'), x = cb ? take(s.key, s.cur, 0) : null;
      if (!cb || !x) { v(`boot recovery closed a round (${L.ref}) that the harness never saw open`, { ref: L.ref }, 'a round that was open at the kill', L.ref); continue; }
      o = { key: s.key, cur: s.cur, rid: s.rid, cost: 0, buy: null, callback: true, plain: false, gen: -1, epoch: S.epoch, pending: null, since: Date.now() };
      seen.add(s.key + '|' + s.cur);
    }
    const err = adoptClose(W, o, L, 'boot');
    if (err) v(err, { ref: L.ref }, 'the close line of the open round', L.ref);
  }
  for (const [id, o] of [...B.open]) {
    if (o.cost > 0) v(`round ${id} (stake ${o.cost}) was still open after the restart: boot recovery wrote no close line for it`, { round: id }, 'settle or void', 'nothing');
    else { W.model.applySlot({ key: o.key, cur: o.cur, rid: o.rid, cost: 0, win: 0, prize: 0, buy: null, callback: true, plain: false, escrowed: false, via: 'unacked', void: false, epoch: o.epoch }); S.c.unacked++; }
  }
  // the state file is at most one round behind the ledger after a crash (D3): a Callback may or may not still be waiting
  for (const k of B.armed) B.unsure.add(k);
  for (const k of seen) B.unsure.add(k);
  for (const x of sent) B.unsure.add(k2(x.key, x.mode));
  B.armed.clear();
  return bad;
}
function afterRestart(W) {
  const S = W.slot;
  S.inflight = new Map();
  S.epoch++;
  S.epochEnds.push(W.checker.killMark && W.checker.killMark.dead != null ? W.checker.killMark.dead : W.checker.lines.length);
}
function inflightList(W) { const out = []; for (const l of W.slot.inflight.values()) out.push(...l); return out; }
function hasOpen(W, key) { return !!(W.model && W.model.slot.hasOpen(key)); }

// ---------------- server side switches ----------------
async function postCfg(W, body) {
  const res = await fetch(`http://127.0.0.1:${W.port}/api/admin/coldcall-config`, { method: 'POST', headers: { 'x-admin-token': ADMIN_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  if (res.status !== 200) throw new Error(`coldcall-config answered ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function init(W) {
  const S = W.slot;
  await postCfg(W, { overrides: SETUP_CFG, note: 'soak setup' });
  const bot = W.admin;
  const st = await bot.req('g:coldcall:state', {}, 'g:coldcall:state', 4000);
  if (!st.data) throw new Error('no g:coldcall:state: ' + JSON.stringify(st.error || st));
  if (!st.data.qaHook) throw new Error('the server did not switch the COLDCALL_TEST hook on (g:coldcall:state has no qaHook)');
  S.buyPrice = st.data.buyPriceCents; S.betLevels = st.data.betLevels;
  const pot = st.data.pull && st.data.pull.rules && st.data.pull.rules.pot;
  if (!pot || pot.feedBps !== SETUP_CFG.pull.pot.feedBps) throw new Error('the live config did not take: pot ' + JSON.stringify(pot));
  S.feedBps = pot.feedBps;
}

// ---------------- operations ----------------
const pace = async (bot) => { const w = 165 - (Date.now() - (bot.lastSlotAt || 0)); if (w > 0) await sleep(w); bot.lastSlotAt = Date.now(); };
const have = (W, bot, cur) => { W.checker.poll(); return W.checker.balance(cur, acct(bot.key, cur)); };
const costFor = (W, bet, buy) => (buy ? priceOf(W, bet, buy) : bet);

function pickBet(W, bot, cur, buy) {
  const h = have(W, bot, cur), L = W.slot.betLevels;
  const ok = L.filter(b => costFor(W, b, buy) <= h);
  if (!ok.length) return null;
  // big bets matter: they feed the pot more and hit it more often
  return W.rng.weighted(ok.map(b => [b >= 100 ? 2.5 : b >= 20 ? 2 : 1, b]));
}

// One spin with its answer awaited. Returns { kind: 'result'|'refused'|'timeout', code? }.
async function spinOnce(W, bot, { mode, bet, buy, force }) {
  const S = W.slot, key = bot.key;
  await pace(bot);
  W.checker.poll();
  const rec = { key, mode, bet, buy: buy || null, force: force || null, cost: costFor(W, bet, buy) };
  const l = inflightOf(S, key, mode); l.push(rec); S.inflight.set(k2(key, mode), l);
  bot.spinsInFlight++;
  const r = await bot.req('g:coldcall:spin', { bet, mode, buyBonus: buy || null, ...(force ? { force } : {}) }, 'g:coldcall:result', 6000, { pred: d => d.mode === mode });
  bot.spinsInFlight--;
  const i = inflightOf(S, key, mode).indexOf(rec); if (i >= 0) { const ll = inflightOf(S, key, mode); ll.splice(i, 1); if (!ll.length) S.inflight.delete(k2(key, mode)); }
  if (r.timeout) throw new Error(`no answer to a Cold Call spin from ${key} within 6 s (harness problem, not a money disagreement)`);
  if (r.error) {
    const code = r.error.code;
    S.c.errors++;
    if (code === 'funds') {
      S.c.funds++;
      const now = have(W, bot, mode);
      if (now >= rec.cost && !(W.model.slot.openOf(key, mode))) W.warn('slot_refused_affordable', `${key} ${mode} had ${now}, cost ${rec.cost}`);
    } else if (code === 'rate') S.c.rate++;
    else if (code === 'decision_open') { S.c.busy++; await syncOpen(W, bot); }
    else W.warn('slot_error_' + code, `${key} ${mode} bet ${bet} buy ${buy}: ${r.error.message}`);
    return { kind: 'refused', code, cost: rec.cost };
  }
  return { kind: 'result', status: r.data.status, cost: rec.cost };
}

// The server says a decision is open that the model does not know: ask for the state and take its list (the ledger checks then judge it).
async function syncOpen(W, bot) {
  const B = W.model.slot, S = W.slot;
  const st = await bot.req('g:coldcall:state', {}, 'g:coldcall:state', 4000);
  const opens = st.data && st.data.opens;
  if (!Array.isArray(opens)) return;
  for (const p of opens) {
    const id = `${bot.key}:${p.roundId}`;
    if (B.open.has(id) || B.rounds.has(id)) continue;
    W.warn('slot_open_unannounced', `${id} is open on the server and the client never got its prompt`);
    B.open.set(id, { key: bot.key, cur: p.mode, rid: p.roundId, cost: p.cost, buy: p.buyBonus || null, callback: !!p.callback, plain: !p.buyBonus && !p.callback && p.cost > 0, gen: bot.gen, epoch: S.epoch, pending: p.pending, since: Date.now() });
  }
}

async function decide(W, bot, o) {
  const pend = o.pending;
  if (!pend) return { what: 'decide_skip', who: bot.key, note: 'prompt unknown' };
  const payload = pend.k === 'pick' ? { roundId: o.rid, k: 'pick', p: W.rng.pick(pend.choices) } : { roundId: o.rid, k: 'more', take: W.rng.chance(0.5) };
  bot.spinsInFlight++;
  const r = await bot.req('g:coldcall:decide', payload, 'g:coldcall:result', 5000, { pred: d => d.roundId === o.rid });
  bot.spinsInFlight--;
  W.slot.c.decided++;
  if (r.timeout) throw new Error(`no answer to a Cold Call decision from ${bot.key} within 5 s (harness problem)`);
  if (r.error) { W.warn('slot_decide_' + r.error.code, `${bot.key} ${o.rid}: ${r.error.message}`); return { what: 'decide', who: bot.key, answer: r.error.code }; }
  return { what: 'decide', who: bot.key, k: pend.k, answer: r.data.status };
}

// Gets a bot to hold an open decision: buys until one prompts (bonus rounds with ONE MORE CALL or PICK). -> the open entry or null.
async function openDecision(W, bot, mode, tries = 6) {
  const B = W.model.slot;
  for (let i = 0; i < tries; i++) {
    const have0 = B.openOf(bot.key, mode); if (have0) return have0;
    const buy = W.rng.pick(['bonus1', 'bonus1', 'bonus2']);
    const bet = pickBetFor(W, bot, mode, buy);
    if (!bet) return null;
    const r = await spinOnce(W, bot, { mode, bet, buy });
    if (r.kind === 'refused' && r.code !== 'rate') return B.openOf(bot.key, mode);
    const o = B.openOf(bot.key, mode); if (o) return o;
  }
  return null;
}
function pickBetFor(W, bot, cur, buy) {
  const h = have(W, bot, cur), L = W.slot.betLevels.filter(b => costFor(W, b, buy) <= h);
  return L.length ? W.rng.pick(L.slice(0, Math.max(1, L.length - 2))) : null;       // not the dearest: the stake is the player's money
}

async function cfgStep(W) {
  const S = W.slot, bot = W.rng.pick(W.connectedBots());
  const mode = W.rng.chance(0.5) ? 'play' : 'chips';
  let o = W.model.slot.openOf(bot.key, mode);
  if (!o && W.rng.chance(0.7)) o = await openDecision(W, bot, mode, 4);
  const scale = W.rng.pick([0.8, 0.9, 1, 1.1, 1.25]);
  await postCfg(W, { overrides: { ...SETUP_CFG, payScale: scale }, note: `soak payScale ${scale}` });      // a POST REPLACES the override set: send the soak's own knobs again
  S.c.cfg++;
  let after = '';
  if (o && W.rng.chance(0.6) && W.model.slot.open.has(`${o.key}:${o.rid}`)) { const r = await decide(W, bot, o); after = ' then ' + r.what + ' ' + (r.answer || ''); }
  return { actor: 'coldcall', what: 'cfg', who: bot.key, scale, open: o ? o.rid : null, note: 'config swapped' + (o ? ' with a round open' : '') + after };
}

module.exports = {
  name: 'coldcall', weight: 24,
  attach, listen, init, afterRestart, adoptUnheard, reconcile, inflightList, hasOpen, postCfg, spinOnce, openDecision, ADMIN_TOKEN, FORCES, BUYS,
  ops: { openDecision, spinOnce, pickBet, pickBetFor, decideAny: decide },
  async step(W) {
    const S = W.slot, B = W.model.slot;
    const bots = W.connectedBots();
    if (!bots.length) return null;
    const kind = W.rng.weighted([[36, 'plain'], [11, 'buy'], [8, 'forced'], [14, 'decide'], [5, 'ready'], [6, 'unaffordable'], [4, 'double'], [2, 'probe'], [3, 'cfg'], [4, 'poolrace'], [2, 'drop']]);
    const mode = W.rng.chance(0.5) ? 'play' : 'chips';
    const open = [...B.open.values()].filter(o => bots.some(b => b.key === o.key));
    if (kind === 'decide' || kind === 'ready') {
      if (!open.length) return null;
      const o = W.rng.pick(open), bot = W.bots.get(o.key);
      if (kind === 'ready') {
        bot.emit('g:coldcall:ready', { roundId: o.rid }); S.c.readyLeft++;
        return { actor: 'coldcall', what: 'ready', who: bot.key, round: o.rid, note: 'left to its timer' };
      }
      return { actor: 'coldcall', ...(await decide(W, bot, o)) };
    }
    if (kind === 'cfg') return cfgStep(W);
    if (kind === 'drop') {                    // a socket that goes while a round is open: the server settles it at the disconnect, the client hears nothing
      const o = open.find(x => x.cost > 0) || open[0]; if (!o) return null;
      const bot = W.bots.get(o.key);
      if (bot.tableId) return null;           // not a seated player: the poker actor owns that reconnect
      bot.close(); S.c.drops++;
      await sleep(W.rng.range(120, 500));
      await bot.connect();
      const a = await bot.resume();
      if (!a.data) throw new Error(`${bot.key} could not resume after dropping its socket: ${JSON.stringify(a.error || a)}`);
      return { actor: 'coldcall', what: 'drop', who: bot.key, round: o.rid, note: 'socket dropped with a decision open' };
    }
    if (kind === 'poolrace') {                // the office pot is won while another player's round is open
      const a = W.rng.pick(bots);
      const o = await openDecision(W, a, mode, 4);
      const others = bots.filter(b => b.key !== a.key);
      let hit = null;
      if (others.length) {
        const b = W.rng.pick(others), bet = [1000, 500, 200, 100].find(x => x <= have(W, b, mode));
        if (bet) { const r = await spinOnce(W, b, { mode, bet }); hit = `${b.key} spun ${bet}: ${r.kind}`; }
      }
      return { actor: 'coldcall', what: 'poolrace', who: a.key, round: o ? o.rid : null, mode, note: hit };
    }
    const bot = W.rng.pick(bots);
    if (B.openOf(bot.key, mode)) {            // one open decision per player and currency: a spin now is refused (decision_open), and nothing may move
      if (kind !== 'probe' && W.rng.chance(0.8)) return null;
      const r = await spinOnce(W, bot, { mode, bet: S.betLevels[0] });
      return { actor: 'coldcall', what: 'spin_while_open', who: bot.key, mode, answer: r.kind === 'refused' ? r.code : r.status };
    }
    if (kind === 'unaffordable') {
      const h = have(W, bot, mode);
      let found = null;
      for (const b of [...S.betLevels].reverse()) for (const by of ['bonus2', 'bonus1', 'call', null]) if (!found && costFor(W, b, by) > h) found = { bet: b, buy: by };
      if (!found) return null;
      const r = await spinOnce(W, bot, { mode, ...found });
      return { actor: 'coldcall', what: 'spin_big', who: bot.key, mode, ...found, answer: r.kind === 'refused' ? r.code : r.status };
    }
    if (kind === 'double') {
      // two spins back to back: the second may be refused (rate limit), or find the first one's decision open; whatever results come back are what counts
      const bet = pickBet(W, bot, mode, null); if (!bet) return null;
      await pace(bot);
      const recs = [0, 1].map(() => ({ key: bot.key, mode, bet, buy: null, force: null, cost: bet }));
      const l = inflightOf(S, bot.key, mode); l.push(...recs); S.inflight.set(k2(bot.key, mode), l);
      bot.spinsInFlight += 2;
      const got = await bot.collect(['g:coldcall:result'], 2, 6000, () => { for (let i = 0; i < 2; i++) bot.emit('g:coldcall:spin', { bet, mode, buyBonus: null }); });
      bot.spinsInFlight -= 2;
      const ll = inflightOf(S, bot.key, mode); for (const r of recs) { const i = ll.indexOf(r); if (i >= 0) ll.splice(i, 1); } if (!ll.length) S.inflight.delete(k2(bot.key, mode));
      if (got.length < 2) throw new Error(`a double Cold Call spin from ${bot.key} got ${got.length} answers in 6 s (harness problem)`);
      for (const g of got) if (g.error) { S.c.errors++; if (g.error.code !== 'rate' && g.error.code !== 'funds' && g.error.code !== 'decision_open') W.warn('slot_error_' + g.error.code, g.error.message); else if (g.error.code === 'rate') S.c.rate++; else if (g.error.code === 'decision_open') S.c.busy++; }
      return { actor: 'coldcall', what: 'spin2', who: bot.key, mode, bet, answers: got.map(g => (g.error ? g.error.code : g.data.status)) };
    }
    const buy = kind === 'buy' ? W.rng.pick(BUYS) : null;
    const force = kind === 'forced' ? W.rng.pick(FORCES) : null;
    const bet = pickBet(W, bot, mode, buy);
    if (!bet) return null;
    const r = await spinOnce(W, bot, { mode, bet, buy, force });
    return { actor: 'coldcall', what: kind === 'plain' ? 'spin' : kind, who: bot.key, mode, bet, buy, force, answer: r.kind === 'refused' ? r.code : r.status };
  },
};
