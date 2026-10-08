'use strict';
// CAMPAIGN TRAIL money test: Cash and Chips, every bet level, on the REAL ledger (tests/lib-campaign-ledger.js). Exit 0 on pass, 1 on fail.
//   A  >= 400 seeded runs per currency: balance before - stake + win = balance after; the win in `end` = what the ledger credited; the other currency never moves; no ledger line between :open and :close;
//      exact ledger shape; house:campaign = minus the players' net; audit() = the ledger at every point; a forced run for every `reason`
//   B  a fast double start / step / cash (same tick and 1 ms apart) = one effect; a cash against the idle timer = one close; `funds` and `state` write nothing
//   C  the ledger file replayed from disk gives the same balances
//   D  crash points (open before record / record / a surviving step's flush / settle before the record is dropped / void before the drop) -> exactly one close, the right amount, record gone, audit() = ledger;
//      a record that fails E.check is voided, never paid; a stale record with no escrow pays nothing
const assert = require('assert');
const fs = require('fs');
const H = require('./lib-campaign-ledger.js');
const { open: openLedger } = require('../money/ledger');
const { E, SRV } = H;

const eq = assert.strictEqual, deq = assert.deepStrictEqual, ok = assert.ok;
let pass = 0, fail = 0;
const todo = [];
const t = (name, fn) => todo.push([name, fn]);
const hook = (on) => { if (on) process.env.CAMPAIGN_TEST = '1'; else delete process.env.CAMPAIGN_TEST; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
const other = (c) => (c === 'play' ? 'chips' : 'play');
const acctOf = (k, c) => (c === 'chips' ? 'bank:' : 'play:') + k;
const BIG = 3e9;

function world(seed = 1, keys = ['ann', 'bob']) {
  hook(false); delete process.env.CAMPAIGN_IDLE_MS; delete process.env.NODE_ENV;
  const R = mulberry(seed), RNG = { fn: R };
  const w = H.world({ rng: () => RNG.fn(), keys });
  for (const k of keys) { w.fund(k, 'play', BIG); w.fund(k, 'chips', BIG); }
  w.RNG = RNG; book.play = 0; book.chips = 0;
  return w;
}
const book = { play: 0, chips: 0 };    // the players' net per currency, from the `end` events only (the harness' own book)

// ledger lines of one round, in order
const roundLines = (w, roundId) => w.lines((l) => typeof l.ref === 'string' && l.ref.includes(':' + roundId + ':'));
const credited = (lines, k, cur) => lines.filter((l) => l.to === acctOf(k, cur) && /:close$/.test(l.ref)).reduce((n, l) => n + l.amount, 0);
function checkShape(w, k, cur, roundId, bet, win, kind) {
  const ls = roundLines(w, roundId); const ref = (s) => `campaign:${k}:${roundId}:${s}`; const esc = `escrow:campaign:${k}:${roundId}`;
  eq(ls[0].ref, ref('open')); eq(ls[0].from, acctOf(k, cur)); eq(ls[0].to, esc); eq(ls[0].amount, bet); eq(ls[0].cur, cur); eq(ls[0].reason, 'campaign:open');
  if (kind === 'void') {
    eq(ls.length, 2); eq(ls[1].ref, ref('close')); eq(ls[1].from, esc); eq(ls[1].to, acctOf(k, cur)); eq(ls[1].amount, bet); ok(/^campaign:void:/.test(ls[1].reason));
  } else {
    eq(ls.length, win > 0 ? 3 : 2); eq(ls[1].ref, ref('close')); eq(ls[1].from, esc); eq(ls[1].to, 'house:campaign'); eq(ls[1].amount, bet); eq(ls[1].reason, 'campaign:spend');
    if (win > 0) { eq(ls[2].ref, ref('close')); eq(ls[2].from, 'house:campaign'); eq(ls[2].to, acctOf(k, cur)); eq(ls[2].amount, win); eq(ls[2].reason, 'campaign:credit'); eq(ls[2].id, ls[1].id, 'one batch'); }
  }
  for (const l of ls) eq(l.cur, cur);
}
function auditMatchesLedger(w) {
  const a = w.audit().openRounds.map((r) => `${r.key}|${r.cur}|${r.roundId}|${r.amount}`).sort();
  const l = w.money.openRounds().map((r) => `${r.key}|${r.cur}|${r.roundId}|${r.amount}`).sort();
  deq(a, l, 'audit() = the ledger');
}

// play one run to its end and check every money rule on the way. policy = { k: stop after k surviving steps, pick: fn(options) -> option, force: 'survive'|'scandal'|undefined (for the LAST step) }
function playRun(w, s, k, cur, bet, home, pol) {
  const o = other(cur), pre = w.balances(k), id0 = w.lastId(), esc0 = w.escrowSum(cur), eo0 = w.escrowSum(o);
  const st = H.start(w, s, cur, bet, home); ok(st.ev === 'run', 'start ' + JSON.stringify(st.error));
  let run = st.payload.run; const roundId = run.roundId;
  eq(w.since(id0).length, 1, 'only the open line so far'); eq(w.bal(k, cur), pre[cur] - bet); eq(w.balances(k)[o], pre[o]); eq(w.escrowSum(cur), esc0 + bet); eq(st.payload.balances[cur], pre[cur] - bet);
  auditMatchesLedger(w);
  let end = null;
  for (let i = 0; ; i++) {
    if (i >= pol.k) { const r = H.call(w, s, 'cash', { roundId }); ok(r.ev === 'end', JSON.stringify(r.error)); end = r.payload; break; }
    const opts = run.options; ok(opts.length > 0, 'a run with no options is over');
    const pick = pol.pick(opts);
    const last = i === pol.k - 1, f = pol.force === 'scandal' ? (last ? 'scandal' : 'survive') : pol.force;   // 'scandal' = survive until the last pick, then fail; 'survive' = every pick
    const r = H.call(w, s, 'step', { roundId, n: run.steps + 1, to: pick.to, ...(f ? { force: f } : {}) });
    if (r.ev === 'end') { end = r.payload; break; }
    ok(r.ev === 'step', JSON.stringify(r.error));
    eq(w.since(id0).length, 1, 'a surviving step writes no ledger line'); eq(w.bal(k, cur), pre[cur] - bet, 'nothing is credited mid-run'); eq(w.balances(k)[o], pre[o]); eq(w.escrowSum(cur), esc0 + bet);
    run = r.payload.run; eq(r.payload.run.cashout, bet * run.mx / 100);
    auditMatchesLedger(w);
  }
  // ---- the close
  const win = end.win, refund = end.reason === 'withdrawn' || (end.reason === 'timeout' && end.steps === 0);
  eq(end.roundId, roundId); eq(end.bet, bet); eq(end.mode, cur);
  eq(w.bal(k, cur), pre[cur] - bet + win, 'balance before - stake + win = balance after'); eq(w.balances(k)[o], pre[o], 'the other currency never moves'); eq(end.balances[cur], w.bal(k, cur));
  const ls = w.since(id0); const cl = ls.filter((l) => /:close$/.test(l.ref)); ok(cl.length >= 1);
  eq(credited(ls, k, cur), win, 'the win in `end` = what the ledger credited'); eq(w.escrowSum(cur), esc0); eq(w.escrowSum(o), eo0); eq(w.runs.has(k), false);
  if (end.reason === 'scandal') eq(win, 0); else if (refund) eq(win, bet); else eq(win, bet * end.mx / 100);
  eq(ls.length, 1 + (refund ? 1 : win > 0 ? 3 - 1 + 0 : 1) + (refund ? 0 : 0) , 'open + close legs');
  checkShape(w, k, cur, roundId, bet, win, refund ? 'void' : 'settle');
  book[cur] += win - bet; eq(w.house(cur), 0 - book[cur], 'house:campaign = minus the players\' net');
  eq(w.disk().open[k], undefined, 'record gone'); auditMatchesLedger(w);
  return end;
}

// ---- A: the sweep -----------------------------------------------------------------------------------------------------------------------------------------------------------------
t('A: 450 seeded runs per currency at every bet level (real draws): conservation, credited = told, no line mid-run, shape, house = minus net', () => {
  const w = world(11), s = w.sock('ann'), P = mulberry(99); const reasons = {}; const stats = { play: { staked: 0, won: 0, runs: 0 }, chips: { staked: 0, won: 0, runs: 0 } };
  hook(false); book.play = 0; book.chips = 0;
  for (const cur of ['play', 'chips']) {
    for (let n = 0; n < 450; n++) {
      const bet = E.BET_LEVELS[n % E.BET_LEVELS.length], home = Object.keys(E.MAP.states)[Math.floor(P() * 50)];
      const kStop = Math.floor(P() * P() * 9);                                      // 0 .. 8 steps, biased low
      const pol = { k: kStop, pick: (opts) => opts[Math.floor(P() * opts.length)] };
      w.clock.advance(300);
      const end = playRun(w, s, 'ann', cur, bet, home, pol);
      reasons[end.reason] = (reasons[end.reason] || 0) + 1; stats[cur].staked += bet; stats[cur].won += end.win; stats[cur].runs++;
    }
  }
  console.log('     reasons seen:', JSON.stringify(reasons), ' return play', (stats.play.won / stats.play.staked).toFixed(3), 'chips', (stats.chips.won / stats.chips.staked).toFixed(3));
  ok(reasons.scandal > 20 && reasons.cashout > 20 && reasons.withdrawn > 5, 'the sweep reached the main reasons');
  eq(w.house('play'), 0 - book.play); eq(w.house('chips'), 0 - book.chips); eq(w.escrows().length, 0);
  for (const c of ['play', 'chips']) { const cv = w.conservation(c); eq(cv.everything, 0, 'all accounts sum to 0'); eq(cv.escrows, 0); }
});

t('A: forced runs for every reason (scandal / cashout / withdrawn / timeout 0 and >= 1 steps / deadend / landslide / boot), both currencies, every bet level', () => {
  const w = world(12), s = w.sock('ann'); hook(true); book.play = 0; book.chips = 0; const seen = new Set();
  const WIT = 'ME NH VT MA RI CT NY NJ DE MD PA WV OH MI IN IL WI MN ND MT SD IA NE KS CO WY UT ID WA AK HI CA OR NV AZ NM OK TX LA AR MO KY VA NC SC GA FL AL MS TN'.split(' ');
  const first = (o) => o[0], safe = (o) => o.find((x) => !x.deadEnd) || o[0];
  for (const cur of ['play', 'chips']) for (const bet of E.BET_LEVELS) {
    w.clock.advance(300);
    for (const [k, pick, force] of [[1, first, 'scandal'], [0, first, undefined], [3, safe, 'survive'], [2, safe, 'scandal']]) {
      w.clock.advance(300); const e = playRun(w, s, 'ann', cur, bet, 'GA', { k, pick, force }); seen.add(e.reason);
      if (k === 3) eq(e.reason, 'cashout'); if (k === 0) eq(e.reason, 'withdrawn'); if (force === 'scandal') eq(e.reason, 'scandal');
    }
    // dead end: NH -> ME
    w.clock.advance(300); let e = playRun(w, s, 'ann', cur, bet, 'NH', { k: 1, pick: (o) => o.find((x) => x.to === 'ME'), force: 'survive' }); eq(e.reason, 'deadend'); seen.add(e.reason);
    // timeout: at 0 steps (refund) and at >= 1 step (cash-out): start by hand, close through the idle path
    for (const steps of [0, 2]) {
      w.clock.advance(300); const pre = w.bal('ann', cur), id0 = w.lastId(); const st = H.start(w, s, cur, bet, 'GA'); let run = st.payload.run;
      for (let i = 0; i < steps; i++) { w.clock.advance(300); run = H.call(w, s, 'step', { roundId: run.roundId, n: run.steps + 1, to: run.options.find((x) => !x.deadEnd).to, force: 'survive' }).payload.run; }
      SRV._test.autoClose(w.runs.get('ann'), 'timeout'); const end = H.last(s, 'g:campaign:end');
      eq(end.reason, 'timeout'); eq(end.win, steps ? bet * run.mx / 100 : bet); eq(w.bal('ann', cur), pre - bet + end.win); book[cur] += end.win - bet; seen.add('timeout'); eq(w.escrows().length, 0);
      checkShape(w, 'ann', cur, run.roundId, bet, end.win, steps ? 'settle' : 'void'); eq(w.house(cur), 0 - book[cur]);
    }
  }
  // LANDSLIDE on the witness route (49 forced survivals): 1,000x of the stake, both currencies, every bet level
  for (const cur of ['play', 'chips']) for (const bet of E.BET_LEVELS) {
    w.clock.advance(300); const pre = w.bal('ann', cur); w.fund('ann', cur, 3e6);
    let r = H.start(w, s, cur, bet, WIT[0]); let run = r.payload.run;
    for (let i = 1; i < 49; i++) { w.clock.advance(300); run = H.call(w, s, 'step', { roundId: run.roundId, n: i, to: WIT[i], force: 'survive' }).payload.run; }
    w.clock.advance(300); r = H.call(w, s, 'step', { roundId: run.roundId, n: 49, to: WIT[49], force: 'survive' }); eq(r.ev, 'end'); eq(r.payload.reason, 'landslide'); eq(r.payload.win, bet * 1000); eq(r.payload.steps, 49);
    eq(w.bal('ann', cur), pre + 3e6 - bet + bet * 1000); book[cur] += bet * 1000 - bet; seen.add('landslide'); checkShape(w, 'ann', cur, run.roundId, bet, bet * 1000, 'settle');
    eq(w.house(cur), 0 - book[cur]);
  }
  hook(false);
  for (const cur of ['play', 'chips']) { eq(w.conservation(cur).everything, 0); eq(w.escrowSum(cur), 0); }
  ok(['scandal', 'cashout', 'withdrawn', 'timeout', 'deadend', 'landslide'].every((x) => seen.has(x)), [...seen].join(','));
  // boot: a run open at 0 steps (refund) and at >= 1 step (cash-out at the stored multiplier) in each currency, closed by recover()
  seen.clear(); hook(true);
  for (const cur of ['play', 'chips']) for (const steps of [0, 1, 4]) {
    w.clock.advance(300); const pre = w.bal('ann', cur); let r = H.start(w, s, cur, 1000, 'TX'); let run = r.payload.run;
    for (let i = 0; i < steps; i++) { w.clock.advance(300); run = H.call(w, s, 'step', { roundId: run.roundId, n: run.steps + 1, to: run.options.find((x) => !x.deadEnd).to, force: 'survive' }).payload.run; }
    const id0 = w.lastId(); w.reboot(); const lines = w.since(id0);
    const want = steps ? 10 * run.mx : 1000; eq(w.bal('ann', cur), pre - 1000 + want, `boot ${cur} ${steps} steps`); eq(credited(lines, 'ann', cur), want);
    ok(lines.every((l) => /:close$/.test(l.ref) && l.ref.includes(run.roundId)), 'only that round\'s close lines'); eq(w.escrows().length, 0); eq(w.audit().openRounds.length, 0); book[cur] += want - 1000;
    s.out.length = 0;
  }
  hook(false);
});

// ---- B: doubles, races, writes-nothing ------------------------------------------------------------------------------------------------------------------------------------------
t('B: a fast double start / step / cash = one effect (same tick and 1 ms apart)', () => {
  for (const gap of [0, 1]) for (const cur of ['play', 'chips']) {
    const w = world(20 + gap), s = w.sock('ann'); hook(true); const id0 = w.lastId(), B0 = w.bal('ann', cur); w.clock.advance(300);
    s.send('g:campaign:start', { mode: cur, bet: 500, home: 'OH' }); w.clock.advance(gap); s.send('g:campaign:start', { mode: cur, bet: 500, home: 'OH' });
    const runs = H.all(s, 'g:campaign:run'); eq(runs.length, 1); eq(w.since(id0).length, 1); eq(w.escrowSum(cur), 500); eq(w.bal('ann', cur), B0 - 500, 'one stake taken');
    let run = runs[0].run; w.clock.advance(300);
    const to = run.options.find((o) => !o.deadEnd).to;
    s.send('g:campaign:step', { roundId: run.roundId, n: 1, to, force: 'survive' }); w.clock.advance(gap); s.send('g:campaign:step', { roundId: run.roundId, n: 1, to, force: 'survive' });
    eq(H.all(s, 'g:campaign:step').length, 1); eq(w.since(id0).length, 1); eq(w.runs.get('ann').run.steps, 1);
    w.clock.advance(300);
    s.send('g:campaign:cash', { roundId: run.roundId }); w.clock.advance(gap); s.send('g:campaign:cash', { roundId: run.roundId });
    eq(H.all(s, 'g:campaign:end').length, 1); const cl = w.since(id0).filter((l) => /:close$/.test(l.ref)); eq(new Set(cl.map((l) => l.id)).size, 1, 'one close batch'); eq(w.escrowSum(cur), 0);
    const e = H.last(s, 'g:campaign:end'); eq(w.bal('ann', cur), B0 - 500 + e.win);
    // the same two sockets of one account racing: also one effect
    w.clock.advance(300); const s2 = w.sock('ann'); const id1 = w.lastId();
    s.send('g:campaign:start', { mode: cur, bet: 200, home: 'OH' }); s2.send('g:campaign:start', { mode: cur, bet: 200, home: 'OH' });
    eq(w.since(id1).length, 1, 'two tabs, one run'); eq(H.last(s2, 'error').code, 'rate');
    hook(false);
  }
});

t('B: `funds` and `state` write nothing; a refused start leaves balances alone', () => {
  const w = world(30), s = w.sock('ann'); w.setBal('ann', 'play', 50); w.setBal('ann', 'chips', 50);
  for (const cur of ['play', 'chips']) { const id0 = w.lastId(); w.clock.advance(300); const r = H.start(w, s, cur, 100, 'OH'); eq(r.error.code, 'funds'); eq(w.lastId(), id0); eq(w.bal('ann', cur), 50); }
  const id0 = w.lastId(); for (let i = 0; i < 5; i++) H.call(w, s, 'state', {}); eq(w.lastId(), id0);
  for (const bad of [{ mode: 'play', bet: 100.5, home: 'OH' }, { mode: 'play', bet: -100, home: 'OH' }, { mode: 'play', bet: 1e300, home: 'OH' }, { mode: 'gold', bet: 100, home: 'OH' }]) { H.call(w, s, 'start', bad); eq(w.lastId(), id0); }
  eq(w.escrows().length, 0);
});

t('B: a cash against the idle timer closes once (real timer), in both orders', async () => {
  const w = world(31), s = w.sock('ann'); hook(true); process.env.CAMPAIGN_IDLE_MS = '40';
  for (const order of ['cash-then-timer', 'timer-then-cash']) for (const mode of ['play', 'chips']) {
    w.clock.advance(300); const pre = w.bal('ann', mode); const id0 = w.lastId();
    let run = H.start(w, s, mode, 500, 'OH').payload.run; run = H.call(w, s, 'step', { roundId: run.roundId, n: 1, to: run.options.find((o) => !o.deadEnd).to, force: 'survive' }).payload.run;
    const nEnd = H.all(s, 'g:campaign:end').length;
    if (order === 'cash-then-timer') {
      w.clock.advance(300); s.send('g:campaign:cash', { roundId: run.roundId }); eq(H.all(s, 'g:campaign:end').length, nEnd + 1, 'the cash closed it'); await sleep(120);        // the timer was cleared by the close
    } else {
      await sleep(120); eq(H.all(s, 'g:campaign:end').length, nEnd + 1, 'the idle timer closed it'); eq(H.last(s, 'g:campaign:end').reason, 'timeout');
      w.clock.advance(300); const n = s.out.length; s.send('g:campaign:cash', { roundId: run.roundId }); const late = s.out.slice(n).find((o) => o[0] === 'error'); eq(late && late[1].code, 'no_run', 'a cash behind the timer finds no run');
    }
    const cl = w.since(id0).filter((l) => /:close$/.test(l.ref)); eq(new Set(cl.map((l) => l.id)).size, 1, order + ' ' + mode + ': exactly one close'); eq(w.escrows().length, 0); eq(w.bal('ann', mode), pre - 500 + 5 * run.mx);
    eq(H.all(s, 'g:campaign:end').filter((e) => e.roundId === run.roundId).length, 1);
  }
  hook(false); delete process.env.CAMPAIGN_IDLE_MS;
});

// ---- C: replay --------------------------------------------------------------------------------------------------------------------------------------------------------------------
t('C: replaying money.jsonl from disk gives the same balances; conservation holds', () => {
  const w = world(40), s = w.sock('ann'), sb = w.sock('bob'); hook(true); const P = mulberry(5);
  for (let i = 0; i < 80; i++) {
    const so = i % 2 ? s : sb, k = i % 2 ? 'ann' : 'bob', cur = i % 3 ? 'play' : 'chips'; w.clock.advance(300);
    playRun(w, so, k, cur, E.BET_LEVELS[i % 5], Object.keys(E.MAP.states)[(i * 7) % 50], { k: i % 5, pick: (o) => o[Math.floor(P() * o.length)] });
  }
  const live = {}; for (const c of ['play', 'chips']) for (const a of w.ledger.list('', c)) live[c + '|' + a.account] = a.balance;
  w.crash(); const copy = openLedger(w.files.money, { fsync: 'none', log: () => {} });
  for (const c of ['play', 'chips']) { for (const a of copy.list('', c)) eq(a.balance, live[c + '|' + a.account] || 0, a.account); }
  for (const key of Object.keys(live)) { const [c, a] = key.split('|'); eq(copy.balance(a, c), live[key], key); }
  eq([].concat(copy.quarantined || []).length, 0, 'nothing quarantined'); copy.close(); w.boot(); hook(false);
  for (const c of ['play', 'chips']) eq(w.conservation(c).everything, 0);
});

// ---- D: crash points ---------------------------------------------------------------------------------------------------------------------------------------------------------------
class Crash extends Error {}
const closeLines = (w, id0) => w.since(id0).filter((l) => /:close$/.test(l.ref));
const closeBatches = (w, id0) => new Set(closeLines(w, id0).map((l) => l.id)).size;
const settleTo = (w, id0, k, cur) => credited(w.since(id0), k, cur);
function expectClosed(w, k, cur, roundId, id0, wantWin, pre, bet) {
  eq(closeBatches(w, id0), 1, 'exactly one close'); eq(settleTo(w, id0, k, cur), wantWin, 'the right amount'); eq(w.bal(k, cur), pre - bet + wantWin); eq(w.escrows().length, 0, 'no escrow left');
  eq(w.audit().openRounds.length, 0); ok(!w.disk() || w.disk().open[k] === undefined, 'record gone'); eq(w.runs.size, 0); auditMatchesLedger(w);
  const again = w.lastId(); w.reboot(); eq(w.lastId(), again, 'a second boot writes nothing'); eq(w.bal(k, cur), pre - bet + wantWin);
}

for (const cur of ['play', 'chips']) {
  t(`D1 ${cur}: crash after the ledger open, before the record -> boot refunds the escrow (one close)`, () => {
    const w = world(50), s = w.sock('ann'); const pre = w.bal('ann', cur), id0 = w.lastId();
    w.hooks.after.open = () => { throw new Crash('after open'); };
    const r = H.start(w, s, cur, 2500, 'OH'); ok(r.error, 'the start did not answer with a run'); eq(w.escrows().length, 1); eq(w.audit().openRounds.length, 0);
    const roundId = w.escrows()[0].account.split(':')[3];
    w.reboot(); eq(w.lastId() > id0, true);
    expectClosed(w, 'ann', cur, roundId, id0 + 0, 2500, pre, 2500);
    const cl = closeLines(w, id0); ok(/campaign:void:boot/.test(cl[0].reason));
  });

  t(`D2 ${cur}: crash after the record at 0 steps -> boot refunds; after a surviving step's flush -> cash-out at the stored multiplier`, () => {
    for (const steps of [0, 1, 3]) {
      const w = world(51 + steps), s = w.sock('ann'); hook(true); const pre = w.bal('ann', cur), id0 = w.lastId();
      let run = H.start(w, s, cur, 1000, 'GA').payload.run;
      for (let i = 0; i < steps; i++) { w.clock.advance(300); run = H.call(w, s, 'step', { roundId: run.roundId, n: run.steps + 1, to: run.options.find((o) => !o.deadEnd).to, force: 'survive' }).payload.run; }
      eq(w.disk().open.ann.run.steps, steps, 'the surviving step is on disk');
      w.reboot(); hook(false);
      expectClosed(w, 'ann', cur, run.roundId, id0, steps ? 10 * run.mx : 1000, pre, 1000);
      const cl = closeLines(w, id0); if (!steps) ok(/campaign:void:boot/.test(cl[0].reason), cl[0].reason); else ok(cl[0].reason === 'campaign:spend');
    }
  });

  t(`D3 ${cur}: a step whose flush never reached the disk did not happen -> boot pays the previous multiplier`, () => {
    const w = world(60), s = w.sock('ann'); hook(true); const pre = w.bal('ann', cur), id0 = w.lastId();
    let run = H.start(w, s, cur, 500, 'GA').payload.run; w.clock.advance(300); run = H.call(w, s, 'step', { roundId: run.roundId, n: 1, to: run.options.find((o) => !o.deadEnd).to, force: 'survive' }).payload.run;
    const real = w.store().flush; w.store().flush = () => { throw new Crash('disk'); };
    w.clock.advance(300); const r = H.call(w, s, 'step', { roundId: run.roundId, n: 2, to: run.options.find((o) => !o.deadEnd).to, force: 'survive' }); eq(r.error.code, 'internal');
    w.store().flush = real; w.reboot(); hook(false);
    expectClosed(w, 'ann', cur, run.roundId, id0, 5 * run.mx, pre, 500);
  });

  t(`D4 ${cur}: crash after the settle, before the record is dropped -> boot drops the stale record, pays nothing more`, () => {
    for (const how of ['cash', 'scandal']) {
      const w = world(61), s = w.sock('ann'); hook(true); const pre = w.bal('ann', cur), id0 = w.lastId();
      let run = H.start(w, s, cur, 500, 'GA').payload.run; w.clock.advance(300); run = H.call(w, s, 'step', { roundId: run.roundId, n: 1, to: run.options.find((o) => !o.deadEnd).to, force: 'survive' }).payload.run;
      w.hooks.after.settle = () => { throw new Crash('after settle'); }; w.clock.advance(300);
      if (how === 'cash') H.call(w, s, 'cash', { roundId: run.roundId }); else H.call(w, s, 'step', { roundId: run.roundId, n: 2, to: run.options.find((o) => !o.deadEnd).to, force: 'scandal' });
      ok(w.disk().open.ann, 'the record is still on disk'); eq(w.escrows().length, 0, 'the ledger closed it');
      const win = how === 'cash' ? 5 * run.mx : 0;
      w.reboot(); hook(false);
      eq(closeBatches(w, id0), 1); eq(settleTo(w, id0, 'ann', cur), win); eq(w.bal('ann', cur), pre - 500 + win); eq(w.disk().open.ann, undefined); eq(w.audit().openRounds.length, 0); auditMatchesLedger(w);
    }
  });

  t(`D5 ${cur}: crash after the void, before the record is dropped -> boot drops the record, no second refund`, () => {
    const w = world(62), s = w.sock('ann'); const pre = w.bal('ann', cur), id0 = w.lastId();
    const run = H.start(w, s, cur, 500, 'GA').payload.run; w.hooks.after.void = () => { throw new Crash('after void'); }; w.clock.advance(300);
    H.call(w, s, 'cash', { roundId: run.roundId }); ok(w.disk().open.ann); eq(w.escrows().length, 0); eq(w.bal('ann', cur), pre);
    w.reboot(); eq(closeBatches(w, id0), 1); eq(w.bal('ann', cur), pre); eq(w.disk().open.ann, undefined); eq(w.audit().openRounds.length, 0);
  });
}

t('D6: a record whose E.check fails is voided, never paid; a bet that is not the escrow is voided; unusable records are dropped', () => {
  for (const tamper of ['mx', 'trail', 'at', 'bet', 'run-missing', 'roundId']) {
    const w = world(70), s = w.sock('ann'); hook(true); const cur = 'play', pre = w.bal('ann', cur), id0 = w.lastId();
    let run = H.start(w, s, cur, 500, 'GA').payload.run;
    for (let i = 0; i < 2; i++) { w.clock.advance(300); run = H.call(w, s, 'step', { roundId: run.roundId, n: run.steps + 1, to: run.options.find((o) => !o.deadEnd).to, force: 'survive' }).payload.run; }
    w.crash(); const d = JSON.parse(fs.readFileSync(w.files.store, 'utf8')), rec = d.open.ann;
    if (tamper === 'mx') rec.run.mx = 100000; if (tamper === 'trail') rec.run.trail = ['GA', 'CA', 'OR']; if (tamper === 'at') rec.run.at = 'AK'; if (tamper === 'bet') rec.bet = 2500;
    if (tamper === 'run-missing') delete rec.run; if (tamper === 'roundId') rec.roundId = 'x:y';
    fs.writeFileSync(w.files.store, JSON.stringify(d)); w.boot(); hook(false);
    eq(w.bal('ann', cur), pre, tamper + ': the stake is back, not a win'); eq(w.escrows().length, 0); eq(w.disk().open.ann, undefined); eq(w.audit().openRounds.length, 0);
    const cl = closeLines(w, id0); if (tamper !== 'roundId') { eq(closeBatches(w, id0), 1, tamper); ok(/campaign:void:unresolvable/.test(cl[0].reason), cl[0] && cl[0].reason); } else { eq(closeBatches(w, id0), 1, 'the escrow is refunded once, by the sweep or recover'); ok(/campaign:void:/.test(cl[0].reason), cl[0] && cl[0].reason); }
  }
});

t('D7: a stale record with no escrow pays nothing (closed round, and a round the ledger never saw)', () => {
  for (const mode of ['closed', 'never-seen']) {
    const w = world(71), s = w.sock('ann'); hook(true); const cur = 'chips';
    let run = H.start(w, s, cur, 500, 'GA').payload.run; w.clock.advance(300); run = H.call(w, s, 'step', { roundId: run.roundId, n: 1, to: run.options.find((o) => !o.deadEnd).to, force: 'survive' }).payload.run;
    const stale = JSON.parse(JSON.stringify(w.disk().open.ann));
    if (mode === 'closed') { w.clock.advance(300); H.call(w, s, 'cash', { roundId: run.roundId }); } else { w.crash(); w.boot(); stale.roundId = 'feedfacefeedface'; }
    const pre = w.balances('ann'), id0 = w.lastId(); w.crash();
    fs.writeFileSync(w.files.store, JSON.stringify({ v: 1, open: { ann: stale } })); w.boot(); hook(false);
    eq(w.lastId(), id0, mode + ': no ledger line'); deq(w.balances('ann'), pre); eq(w.disk().open.ann, undefined); eq(w.audit().openRounds.length, 0);
  }
});

t('D8: a damaged store file boots empty; the escrow it forgot is refunded by recover; a record for another currency than the escrow is not paid', () => {
  const w = world(72), s = w.sock('ann'); hook(true); const pre = w.bal('ann', 'play'), id0 = w.lastId();
  H.start(w, s, 'play', 500, 'GA'); w.crash(); fs.writeFileSync(w.files.store, '{not json'); w.boot(); hook(false);
  eq(w.bal('ann', 'play'), pre); eq(w.escrows().length, 0); eq(closeBatches(w, id0), 1);
  // a record that claims chips while the escrow is play
  const w2 = world(73), s2 = w2.sock('ann'); hook(true); const preP = w2.bal('ann', 'play'), preC = w2.bal('ann', 'chips'), idb = w2.lastId();
  H.start(w2, s2, 'play', 500, 'GA'); w2.crash(); const d = JSON.parse(fs.readFileSync(w2.files.store, 'utf8')); d.open.ann.cur = 'chips'; fs.writeFileSync(w2.files.store, JSON.stringify(d)); w2.boot(); hook(false);
  eq(w2.bal('ann', 'play'), preP); eq(w2.bal('ann', 'chips'), preC); eq(w2.escrows().length, 0);
});

// ---- F: fix round 1 (CRITIC-R1 C1-C7): a drawn result is final, an open run is paid on its own numbers ---------------------------------------------------------------------------
const WITNESS = 'ME NH VT MA RI CT NY NJ DE MD PA WV OH MI IN IL WI MN ND MT SD IA NE KS CO WY UT ID WA AK HI CA OR NV AZ NM OK TX LA AR MO KY VA NC SC GA FL AL MS TN'.split(' ');
const refuse = () => { throw Object.assign(new Error('write_failed'), { code: 'internal' }); };
const fence = (w) => fs.appendFileSync(w.files.money, '\n');                       // one foreign byte: the REAL ledger latches `foreign_write` on its next append, for the life of the process
// n surviving steps (QA hook, no ledger line) from `home`, along the first non-dead-end option (or the 50-state witness route when route is true)
function advance(w, s, run, n, route) {
  for (let i = 0; i < n; i++) {
    const to = route ? WITNESS[run.steps + 1] : run.options.find((o) => !o.deadEnd && !o.landslide).to;
    const r = H.call(w, s, 'step', { roundId: run.roundId, n: run.steps + 1, to, force: 'survive' }); ok(r.ev === 'step', 'survive ' + JSON.stringify(r.error || r.ev)); run = r.payload.run;
  }
  return run;
}
const stepOf = (run, to, force) => ({ roundId: run.roundId, n: run.steps + 1, to, force });

for (const cur of ['chips', 'play']) for (const k of [0, 3]) {
  t(`F1 ${cur}, ${k} steps: the ledger refuses writes, a scandal is drawn, the server restarts -> a LOSS (stake kept, no credit leg), never a cash-out or a refund`, () => {
    const w = world(80 + k), s = w.sock('ann'); hook(true); const pre = w.bal('ann', cur);
    let run = advance(w, s, H.start(w, s, cur, 2500, 'OH').payload.run, k);
    fence(w);
    const r = H.call(w, s, 'step', stepOf(run, run.options[0].to, 'scandal')); eq(r.error && r.error.code, 'internal'); eq(H.all(s, 'g:campaign:end').length, 0, 'no result reached the client');
    const rec = w.runs.get('ann'); ok(rec && rec.pend && rec.pend.reason === 'scandal', 'the drawn scandal is pended in memory');
    ok(w.disk().open.ann.pend && w.disk().open.ann.pend.reason === 'scandal', 'and in the record on disk');
    const id0 = w.lastId(); w.reboot(); hook(false);
    const cl = closeLines(w, id0); eq(cl.length, 1, 'one leg: the stake to the house'); eq(cl.filter((l) => l.reason === 'campaign:credit').length, 0, 'no credit leg');
    eq(cl.find((l) => l.reason === 'campaign:spend').amount, 2500); eq(w.bal('ann', cur), pre - 2500, 'the stake is lost'); eq(w.escrows().length, 0); eq(w.disk().open.ann, undefined); eq(w.audit().openRounds.length, 0);
  });
}

t('F1: a fenced ledger -> no new step is drawn (an error, no rng use), no new start; a pended run refuses another step', () => {
  const w = world(84, ['ann', 'bob']), s = w.sock('ann'), sb = w.sock('bob'); hook(true);
  const runA = advance(w, s, H.start(w, s, 'chips', 500, 'OH').payload.run, 1);
  const runB = advance(w, sb, H.start(w, sb, 'chips', 500, 'TX').payload.run, 1);
  fence(w); let draws = 0; w.RNG.fn = () => { draws++; return 0.999999; };
  H.call(w, s, 'step', stepOf(runA, runA.options[0].to, 'scandal'));                          // the first refused write shows the fence
  const e1 = H.call(w, sb, 'step', { roundId: runB.roundId, n: runB.steps + 1, to: runB.options[0].to }); eq(e1.error && e1.error.code, 'money_down'); eq(draws, 0, 'nothing was drawn against a dead ledger');
  const e1f = H.call(w, sb, 'step', stepOf(runB, runB.options[0].to, 'survive')); eq(e1f.error && e1f.error.code, 'money_down'); eq(w.runs.get('bob').run.steps, runB.steps, 'the run did not move');
  const e2 = H.call(w, sb, 'start', { mode: 'play', bet: 100, home: 'OH' }); ok(e2.error, 'no start on a fenced ledger');
  const e3 = H.call(w, s, 'step', { roundId: runA.roundId, n: runA.steps + 1, to: runA.options[0].to }); ok(e3.error, 'a step on the pended run is refused'); eq(draws, 0);
});

t('F1: the settle is refused, the record is on disk -> the drawn scandal is pended on disk, step / cash on that run are refused and never pay; the idle path closes it as a loss', () => {
  const w = world(85), s = w.sock('ann'); hook(true); const pre = w.bal('ann', 'play');
  let run = advance(w, s, H.start(w, s, 'play', 500, 'OH').payload.run, 2);
  w.hooks.before.settle = refuse;
  H.call(w, s, 'step', stepOf(run, run.options[0].to, 'scandal')); const rec = w.runs.get('ann'); ok(rec.pend, 'pended in memory'); ok(w.disk().open.ann.pend, 'and on disk');
  let draws = 0; w.RNG.fn = () => { draws++; return 0.999999; };
  const a = H.call(w, s, 'step', stepOf(run, run.options[0].to, 'survive')); ok(a.error, 'step refused'); const b = H.call(w, s, 'cash', { roundId: run.roundId }); ok(b.error, 'cash refused'); eq(draws, 0);
  eq(w.escrows().length, 1, 'the stake is still in escrow, nothing was paid'); eq(H.all(s, 'g:campaign:end').length, 0);
  w.hooks.before = {}; SRV._test.autoClose(rec, 'timeout');
  const e = H.last(s, 'g:campaign:end'); eq(e.reason, 'scandal'); eq(e.win, 0); eq(w.bal('ann', 'play'), pre - 500); eq(w.escrows().length, 0);
});

t('F1b: the record flush fails too (nothing durable) -> the step did not happen: error, no result, run and record unchanged; the same step again gets the SAME draw; a restart pays the run as it stood', () => {
  for (const via of ['retry', 'cash', 'restart']) {
    const w = world(85), s = w.sock('ann'); hook(true); const pre = w.bal('ann', 'play');
    let run = advance(w, s, H.start(w, s, 'play', 500, 'OH').payload.run, 2); const diskBefore = JSON.stringify(w.disk().open.ann);
    const store = w.store(), realFlush = store.flush; store.flush = () => { throw new Error('disk full'); }; w.hooks.before.settle = refuse;
    const x = H.call(w, s, 'step', stepOf(run, run.options[0].to, 'scandal')); ok(x.error && x.error.code === 'internal', 'an error, not a result'); eq(H.all(s, 'g:campaign:end').length, 0);
    const rec = w.runs.get('ann'); ok(rec && !rec.pend, 'nothing pended in memory'); eq(rec.run.steps, run.steps, 'the run did not move'); eq(w.escrows().length, 1);
    store.flush = realFlush; w.hooks.before = {}; deq(JSON.parse(JSON.stringify(store._data().open.ann.run)), JSON.parse(diskBefore).run, 'the store holds the step before');
    ok(!store._data().open.ann.pend, 'a later write cannot persist the lost step');
    if (via === 'retry') {                                                             // the same step again: the SAME draw (a scandal), not a second one
      let draws = 0; w.RNG.fn = () => { draws++; return 0.999999; };
      const r = H.call(w, s, 'step', { roundId: run.roundId, n: run.steps + 1, to: run.options[0].to }); eq(r.ev, 'end'); eq(r.payload.reason, 'scandal'); eq(r.payload.win, 0); eq(draws, 0); eq(w.bal('ann', 'play'), pre - 500);
    } else if (via === 'cash') { const r = H.call(w, s, 'cash', { roundId: run.roundId }); eq(r.ev, 'end'); eq(r.payload.win, 500 * run.mx / 100); eq(w.bal('ann', 'play'), pre - 500 + 500 * run.mx / 100); }
    else { w.reboot(); eq(w.bal('ann', 'play'), pre - 500 + 500 * run.mx / 100, 'cashed out at the stored multiplier'); }
    eq(w.escrows().length, 0);
  }
});

for (const mode of ['landslide', 'deadend']) {
  t(`F2 ${mode}: a drawn win whose settle is refused is pended with its multiplier; the retry, the idle timer and the boot each pay THAT multiplier once, never a new draw`, () => {
    for (const via of ['retry', 'timer', 'boot']) {
      const w = world(90), s = w.sock('ann'); hook(true); const pre = w.bal('ann', 'chips');
      let run, final, to;
      if (mode === 'landslide') { run = advance(w, s, H.start(w, s, 'chips', 2500, WITNESS[0]).payload.run, 48, true); to = WITNESS[49]; final = 100000; }
      else { run = H.start(w, s, 'chips', 2500, 'ME').payload.run; run = advance(w, s, run, 1); to = null; }
      if (mode === 'deadend') {                                                          // walk to a state whose onward options are all deadEnd flagged: step along the options until one is deadEnd
        let guard = 0; while (!run.options.some((o) => o.deadEnd) && guard++ < 60) run = advance(w, s, run, 1);
        ok(run.options.some((o) => o.deadEnd), 'a dead end is reachable'); to = run.options.find((o) => o.deadEnd).to; final = run.options.find((o) => o.deadEnd).nextMx;
      }
      const owed = 2500 * final / 100;
      w.hooks.before.settle = refuse; const r = H.call(w, s, 'step', stepOf(run, to, 'survive')); eq(r.error && r.error.code, 'internal'); eq(H.all(s, 'g:campaign:end').length, 0);
      const rec = w.runs.get('ann'); ok(rec.pend && rec.pend.reason === mode && rec.pend.run.mx === final, 'pended at the drawn multiplier'); eq(w.disk().open.ann.pend.run.mx, final, 'durable');
      let draws = 0; w.RNG.fn = () => { draws++; return 0; };                                   // a re-draw would be a scandal
      w.hooks.before = {}; const id0 = w.lastId();
      if (via === 'retry') { const r2 = H.call(w, s, 'step', stepOf(run, to, 'scandal')); eq(r2.ev, 'end'); eq(r2.payload.reason, mode); eq(r2.payload.win, owed); }
      else if (via === 'timer') { SRV._test.autoClose(rec, 'timeout'); const e = H.last(s, 'g:campaign:end'); eq(e.reason, mode); eq(e.win, owed); }
      else { w.crash(); w.boot(); }
      eq(draws, 0, via + ': no draw'); eq(closeBatches(w, id0), 1, via + ': one close'); eq(w.bal('ann', 'chips'), pre - 2500 + owed, via + ': the drawn multiplier is paid'); eq(w.escrows().length, 0); eq(w.disk().open.ann, undefined);
      const again = H.call(w, s, 'cash', { roundId: run.roundId }); ok(again.error, 'nothing left to close'); eq(closeBatches(w, id0), 1);
    }
  });
}

t('F4: an open run is paid on the numbers it was opened with: the growth table changes between the run and the boot', () => {
  const was = E.TIERS.safe.g100;
  try {
    for (const g of [105, 103, 110]) for (const k of [1, 12]) {
      E.TIERS.safe.g100 = was;
      const w = world(95), s = w.sock('ann'); hook(true); const pre = w.bal('ann', 'play');
      let run = advance(w, s, H.start(w, s, 'play', 2500, 'GA').payload.run, k); const id0 = w.lastId();
      w.crash(); E.TIERS.safe.g100 = g; w.boot(); hook(false);                                 // the new build
      const cl = closeLines(w, id0); eq(cl.map((l) => l.reason + ' ' + l.amount).join(','), `campaign:spend 2500,campaign:credit ${2500 * run.mx / 100}`, `safe x${g / 100}, ${k} steps`);
      eq(w.bal('ann', 'play'), pre - 2500 + 2500 * run.mx / 100); eq(w.escrows().length, 0);
    }
    // a record from before the snapshot existed is checked on the current table; a truly corrupt snapshot or a tampered mx is still a refund
    E.TIERS.safe.g100 = was;
    for (const how of ['no-snapshot', 'bad-snapshot', 'tampered-mx']) {
      const w = world(96), s = w.sock('ann'); hook(true); const pre = w.bal('ann', 'play'), id0 = w.lastId();
      const run = advance(w, s, H.start(w, s, 'play', 500, 'GA').payload.run, 4); w.crash();
      const d = JSON.parse(fs.readFileSync(w.files.store, 'utf8')); ok(d.open.ann.tiers, 'the record carries the growth table it was opened with');
      if (how === 'no-snapshot') delete d.open.ann.tiers; if (how === 'bad-snapshot') d.open.ann.tiers.safe.g100 = 'x'; if (how === 'tampered-mx') d.open.ann.run.mx += 1;
      fs.writeFileSync(w.files.store, JSON.stringify(d)); w.boot(); hook(false);
      if (how === 'no-snapshot') eq(w.bal('ann', 'play'), pre - 500 + 5 * run.mx, 'paid at the stored multiplier'); else { eq(w.bal('ann', 'play'), pre, how + ': refunded'); ok(/campaign:void:unresolvable/.test(closeLines(w, id0)[0].reason)); }
    }
  } finally { E.TIERS.safe.g100 = was; }
});

t('F6: the idle timer retries a close the ledger refused (real timer: it fires, is refused, fires again and closes)', async () => {
  const w = world(97), s = w.sock('ann'); hook(true); process.env.CAMPAIGN_IDLE_MS = '40'; const pre = w.bal('ann', 'play');
  let run = advance(w, s, H.start(w, s, 'play', 500, 'OH').payload.run, 2);
  let tries = 0; w.hooks.before.settle = () => { tries++; refuse(); };
  await sleep(110); ok(tries >= 1, 'the idle timer tried the close'); eq(H.all(s, 'g:campaign:end').length, 0, 'refused: no result'); eq(w.escrows().length, 1); eq(w.runs.size, 1, 'the run stays open');
  const t1 = tries; w.hooks.before = {};
  await sleep(150); const e = H.last(s, 'g:campaign:end'); ok(e && e.reason === 'timeout', 'the timer was re-armed after the refusal and closed it'); ok(t1 >= 1);
  eq(w.bal('ann', 'play'), pre - 500 + 5 * run.mx); eq(w.escrows().length, 0); eq(w.runs.size, 0);
  hook(false); delete process.env.CAMPAIGN_IDLE_MS;
});

t('F6: a close the ledger refuses at boot keeps the run open (record, escrow, timer); a later close pays the stored multiplier', () => {
  const w = world(98), s = w.sock('ann'); hook(true); const pre = w.bal('ann', 'play');
  let run = advance(w, s, H.start(w, s, 'play', 500, 'OH').payload.run, 3); w.crash(); w.hooks.before.settle = refuse; w.boot(); hook(false);
  const rec = w.runs.get('ann'); ok(rec && rec.timer, 'held in memory with a timer'); ok(w.disk().open.ann, 'record kept'); eq(w.escrows().length, 1); eq(w.audit().openRounds.length, 1);
  w.hooks.before = {}; SRV._test.autoClose(rec, 'timeout'); eq(w.bal('ann', 'play'), pre - 500 + 5 * run.mx); eq(w.escrows().length, 0); eq(w.disk().open.ann, undefined);
});

t('F7: each stake guard alone: the live close, the boot close and the boot bet check', () => {
  hook(true);
  { const w = world(99), s = w.sock('ann'); const seen = []; let run = advance(w, s, H.start(w, s, 'play', 500, 'OH').payload.run, 2);
    w.hooks.before.settle = (a) => seen.push(a[3]); w.clock.advance(300); H.call(w, s, 'cash', { roundId: run.roundId }); eq(seen.length, 1); eq(seen[0].stake, 500, 'the live close names the stake'); }
  { const w = world(99), s = w.sock('ann'); const seen = []; let run = advance(w, s, H.start(w, s, 'chips', 500, 'OH').payload.run, 2);
    w.hooks.before.settle = (a) => seen.push(a[3]); w.crash(); w.hooks.before.settle = (a) => seen.push(a[3]); w.boot(); eq(seen.length, 1); eq(seen[0].stake, 500, 'the boot close names the stake'); }
  { const w = world(99), s = w.sock('ann'); const pre = w.bal('ann', 'play'); let run = advance(w, s, H.start(w, s, 'play', 2500, 'OH').payload.run, 2); w.crash();
    const d = JSON.parse(fs.readFileSync(w.files.store, 'utf8')); d.open.ann.bet = 100; fs.writeFileSync(w.files.store, JSON.stringify(d));     // the record says 100, the escrow holds 2500
    let attempts = 0; w.hooks.before.settle = () => { attempts++; }; w.boot(); eq(attempts, 0, 'a bet that is not the escrow is refused before any payment is tried'); eq(w.bal('ann', 'play'), pre, 'the escrow is given back'); }
  { const w = world(99), s = w.sock('ann'); const pre = w.bal('ann', 'play'); let run = advance(w, s, H.start(w, s, 'play', 500, 'OH').payload.run, 2);
    w.runs.get('ann').bet = 2500;                                                                                                                  // the in-memory run disagrees with the escrow (500)
    w.clock.advance(300); const id0 = w.lastId(); const r = H.call(w, s, 'cash', { roundId: run.roundId }); ok(r.error, 'refused'); eq(w.bal('ann', 'play'), pre, 'the escrow is returned, no win is paid on a stake that was never in'); ok(/void:unresolvable/.test(closeLines(w, id0)[0].reason)); }
  hook(false);
});

(async () => {
  const only = process.argv[2];
  for (const [name, fn] of todo) {
    if (only && !name.includes(only)) continue;
    try { await fn(); pass++; console.log('ok   ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n     ' + String(e && e.stack || e).split('\n').slice(0, 5).join('\n     ')); }
  }
  console.log(`\ncampaign-money: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
