'use strict';
// CAMPAIGN TRAIL server module: events, error codes, hostile payloads, rate limit, one run per account, reconnect, end to every socket, idle timer, QA hook.
// Real ledger, real registry (tests/lib-campaign-ledger.js); only the socket is fake. Exit 0 on pass, 1 on fail.
const assert = require('assert');
const H = require('./lib-campaign-ledger.js');
const { E, SRV } = H;

let pass = 0, fail = 0;
const todo = [];
const t = (name, fn) => todo.push([name, fn]);
const eq = assert.strictEqual, deq = assert.deepStrictEqual, ok = assert.ok;
const hook = (on) => { if (on) process.env.CAMPAIGN_TEST = '1'; else delete process.env.CAMPAIGN_TEST; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WITNESS = 'ME NH VT MA RI CT NY NJ DE MD PA WV OH MI IN IL WI MN ND MT SD IA NE KS CO WY UT ID WA AK HI CA OR NV AZ NM OK TX LA AR MO KY VA NC SC GA FL AL MS TN'.split(' ');

// a fresh world with ann (rich in both currencies) and bob; RNG.v is what a non-forced draw gets
function setup(opts = {}) {
  hook(false); delete process.env.CAMPAIGN_IDLE_MS; delete process.env.NODE_ENV;
  const RNG = { v: 0.999999 };
  const w = H.world({ rng: () => RNG.v, keys: ['ann', 'bob'], ...opts });
  for (const k of ['ann', 'bob']) { w.fund(k, 'play', 1e9); w.fund(k, 'chips', 1e9); }
  w.RNG = RNG;
  return w;
}
const lastEnd = (s) => H.last(s, 'g:campaign:end');
const lines = (w) => w.campaignLines().length;
const open = (w, s, mode = 'play', bet = 500, home = 'OH') => { const r = H.start(w, s, mode, bet, home); ok(r.ev === 'run', 'start: ' + JSON.stringify(r.error || r.ev)); return r.payload.run; };
const step = (w, s, run, to, force) => H.call(w, s, 'step', { roundId: run.roundId, n: run.steps + 1, to, ...(force ? { force } : {}) });
const firstOpt = (run, pred) => run.options.find(pred || (() => true));
const noEffect = (w, before) => { eq(lines(w), before.lines); eq(w.escrowSum('play'), before.esc); };
const snap = (w) => ({ lines: lines(w), esc: w.escrowSum('play') });

t('state: shape, bet levels, map, balances, no run', () => {
  const w = setup(), s = w.sock('ann');
  const r = H.call(w, s, 'state', {});
  eq(r.ev, 'state'); const p = r.payload;
  deq(p.betLevels, [100, 200, 500, 1000, 2500]); deq(p.modes, ['play', 'chips']); eq(p.rtp, '96.0%'); eq(p.maxWinX, 1000); eq(p.capX, 10000); eq(p.idleMs, 60000);
  eq(Object.keys(p.map.states).length, 50); ok(p.map.tiers && p.map.tiers.swing, 'tier table in the map'); eq(p.run, null);
  eq(p.balances.play, w.bal('ann', 'play')); eq(p.balances.chips, w.bal('ann', 'chips'));
  eq(lines(w), 0, 'state writes nothing'); eq(w.lines().filter((l) => /^campaign/.test(String(l.ref || ''))).length, 0);
});

t('start: runView fields, escrow, ledger lines, balances', () => {
  const w = setup(), s = w.sock('ann');
  const b0 = w.bal('ann', 'play');
  const r = H.start(w, s, 'play', 500, 'OH'); eq(r.ev, 'run');
  const run = r.payload.run, ids = Object.keys(run).sort();
  deq(ids, ['at', 'bet', 'canCash', 'cashout', 'expiresAt', 'home', 'idleMs', 'mode', 'mx', 'options', 'roundId', 'steps', 'trail']);
  ok(/^[0-9a-f]{16}$/.test(run.roundId) && !run.roundId.includes(':'));
  eq(run.mode, 'play'); eq(run.bet, 500); eq(run.home, 'OH'); eq(run.at, 'OH'); deq(run.trail, ['OH']); eq(run.steps, 0); eq(run.mx, 100); eq(run.cashout, 500); eq(run.canCash, true); eq(run.idleMs, 60000);
  eq(run.expiresAt, w.clock.now() + 60000);
  deq(run.options.map((o) => o.to), E.options(E.newRun('OH')).map((o) => o.to));
  for (const o of run.options) { deq(Object.keys(o).sort(), ['deadEnd', 'g100', 'landslide', 'name', 'nextCashout', 'nextMx', 'pFail', 'tier', 'to']); eq(o.nextCashout, 5 * o.nextMx); eq(o.pFail, Math.round(o.pFail * 10000) / 10000); eq(typeof o.name, 'string'); }
  eq(r.payload.balances.play, b0 - 500); eq(w.bal('ann', 'play'), b0 - 500);
  const es = w.escrows('play'); eq(es.length, 1); eq(es[0].account, `escrow:campaign:ann:${run.roundId}`); eq(es[0].balance, 500);
  deq(w.campaignLines().map((l) => l.ref), [`campaign:ann:${run.roundId}:open`]);
  eq(w.audit().openRounds.length, 1); deq(w.audit().openRounds[0], { key: 'ann', cur: 'play', roundId: run.roundId, amount: 500 });
  const d = w.disk(); ok(d && d.open.ann && d.open.ann.roundId === run.roundId && d.open.ann.cur === 'play' && d.open.ann.bet === 500, 'record is on disk before the answer');
});

t('start: every bet level in both currencies', () => {
  const w = setup(), s = w.sock('ann');
  for (const cur of ['play', 'chips']) for (const bet of E.BET_LEVELS) {
    const b0 = w.bal('ann', cur), o = w.bal('ann', cur === 'play' ? 'chips' : 'play');
    const run = open(w, s, cur, bet, 'TX');
    eq(w.bal('ann', cur), b0 - bet); eq(w.bal('ann', cur === 'play' ? 'chips' : 'play'), o);
    const r = H.call(w, s, 'cash', { roundId: run.roundId }); eq(r.ev, 'end'); eq(r.payload.reason, 'withdrawn'); eq(r.payload.win, bet); eq(w.bal('ann', cur), b0);
  }
});

t('start: hostile mode / bet / home / payload', () => {
  const w = setup(), s = w.sock('ann'); const b = snap(w);
  const bad = (p, code) => { const r = H.call(w, s, 'start', p); eq(r.error && r.error.code, code, JSON.stringify(p) + ' -> ' + JSON.stringify(r.error || r.ev)); eq(r.error.game, 'campaign'); noEffect(w, b); eq(w.runs.size, 0); };
  for (const m of ['PLAY', 'Chips', '', 1, null, undefined, {}, [], '__proto__', 'play ', ['play']]) bad({ mode: m, bet: 500, home: 'OH' }, 'bad_mode');
  for (const v of ['500', 500.5, -100, 0, 99, 101, 300, 5e12, 1e300, NaN, Infinity, -Infinity, null, undefined, [500], { v: 500 }, true, '__proto__', 2501, 10000000]) bad({ mode: 'play', bet: v, home: 'OH' }, 'bad_bet');
  for (const v of ['ZZ', 'oh', 'Oh', 'DC', '', ' OH', 'OH ', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'states', 5, null, undefined, ['OH'], { a: 1 }, true]) bad({ mode: 'play', bet: 500, home: v }, 'bad_home');
  for (const p of [null, undefined, 'start', 5, [], true]) bad(p, 'bad_mode');
  bad({ mode: 'play', bet: 500 }, 'bad_home'); bad({ mode: 'play', home: 'OH' }, 'bad_bet'); bad({ bet: 500, home: 'OH' }, 'bad_mode');
  bad(Object.assign(Object.create({ mode: 'play' }), { bet: 500, home: 'OH' }), 'bad_mode');   // a `mode` that only the PROTOTYPE has does not count (own bet and home are there)
  eq(Object.getPrototypeOf(JSON.parse('{"__proto__":{"mode":"play"},"bet":500,"home":"OH"}')), Object.prototype, 'JSON.parse makes __proto__ an own field, which is why the real prototype case is built by hand above');
  const proto = Object.create({ mode: 'play', bet: 500, home: 'OH' }); bad(proto, 'bad_mode');
  const good = open(w, s, 'play', 500, 'OH'); eq(good.steps, 0);   // extra unknown fields are ignored, not trusted
});

t('start: unaffordable (funds) writes nothing; the other currency does not pay', () => {
  const w = setup(), s = w.sock('ann'); w.setBal('ann', 'play', 400); const b = snap(w);
  let r = H.start(w, s, 'play', 500, 'OH'); eq(r.error.code, 'funds'); eq(r.error.message, 'Not enough Play $'); noEffect(w, b); eq(w.runs.size, 0); eq(w.bal('ann', 'play'), 400); eq(Object.keys((w.disk() || { open: {} }).open).length, 0);
  w.setBal('ann', 'chips', 99); r = H.start(w, s, 'chips', 100, 'OH'); eq(r.error.code, 'funds'); eq(r.error.message, 'Not enough chips'); eq(w.bal('ann', 'play'), 400);
  w.setBal('ann', 'play', 500); r = H.start(w, s, 'play', 500, 'OH'); eq(r.ev, 'run'); eq(w.bal('ann', 'play'), 0);
});

t('start: a second start while a run is open -> run_open with the runView, nothing moves', () => {
  const w = setup(), s = w.sock('ann'), s2 = w.sock('ann');
  const run = open(w, s); const b = snap(w);
  let r = H.start(w, s, 'play', 500, 'TX'); eq(r.error.code, 'run_open'); deq(r.error.run, run); noEffect(w, b);
  r = H.start(w, s2, 'chips', 100, 'TX'); eq(r.error.code, 'run_open'); eq(r.error.run.roundId, run.roundId); noEffect(w, b); eq(w.escrows().length, 1);
  r = H.start(w, w.sock('bob'), 'play', 500, 'OH'); eq(r.ev, 'run', 'another account may start');
});

t('rate limit: 150 ms per account and event; one effect for a double start / step / cash', () => {
  const w = setup(), s = w.sock('ann');
  // same tick: the second start is refused (rate)
  s.send('g:campaign:start', { mode: 'play', bet: 500, home: 'OH' }); s.send('g:campaign:start', { mode: 'play', bet: 500, home: 'OH' });
  eq(H.all(s, 'g:campaign:run').length, 1); eq(H.last(s, 'error').code, 'rate'); eq(w.escrows().length, 1);
  const run = H.last(s, 'g:campaign:run').run; w.clock.advance(1);
  s.send('g:campaign:start', { mode: 'play', bet: 500, home: 'OH' });   // 1 ms later: rate again (still inside 150 ms)
  eq(H.last(s, 'error').code, 'rate'); eq(w.escrows().length, 1);
  w.clock.advance(200);
  const o = run.options[0].to;
  s.send('g:campaign:step', { roundId: run.roundId, n: 1, to: o }); w.clock.advance(1); s.send('g:campaign:step', { roundId: run.roundId, n: 1, to: o });
  eq(H.all(s, 'g:campaign:step').length, 1, 'one step answer'); eq(H.last(s, 'error').code, 'rate');
  w.clock.advance(200);
  s.send('g:campaign:cash', { roundId: run.roundId }); s.send('g:campaign:cash', { roundId: run.roundId }); w.clock.advance(1); s.send('g:campaign:cash', { roundId: run.roundId });
  eq(H.all(s, 'g:campaign:end').length, 1, 'one end'); eq(w.campaignLines().length, 3, 'open + the one close (2 legs)');
  eq(w.escrows().length, 0);
  w.clock.advance(200); s.send('g:campaign:state', {}); s.send('g:campaign:state', {}); eq(H.last(s, 'error').code, 'rate');
  const w2 = setup(); const a = w2.sock('ann'), b = w2.sock('bob'); a.send('g:campaign:state', {}); b.send('g:campaign:state', {}); eq(H.all(b, 'error').length, 0, 'the limit is per account');
});

t('step: survived — payload, no ledger line, record flushed before the answer, mx from the engine', () => {
  const w = setup(), s = w.sock('ann'); const run = open(w, s); const b = snap(w);
  const o = firstOpt(run); const r = step(w, s, run, o.to);
  eq(r.ev, 'step'); const p = r.payload; eq(p.roundId, run.roundId); eq(p.n, 1); eq(p.to, o.to); eq(p.tier, o.tier); eq(p.run.steps, 1); eq(p.run.mx, o.nextMx); eq(p.run.at, o.to); deq(p.run.trail, ['OH', o.to]); eq(p.run.cashout, 5 * o.nextMx);
  noEffect(w, b); eq(p.run.options.every((x) => !p.run.trail.includes(x.to)), true, 'no visited state is offered');
  const d = w.disk().open.ann; eq(d.run.steps, 1); eq(d.run.mx, o.nextMx); eq(d.run.at, o.to); ok(d.lastAt >= d.startedAt);
  eq(p.run.expiresAt, w.clock.now() + 60000, 'the idle clock restarts on an accepted pick');
});

t('step: hostile n / to / roundId, wrong run, no run — nothing moves', () => {
  const w = setup(), s = w.sock('ann'), sb = w.sock('bob');
  let r = H.call(w, s, 'step', { roundId: 'x', n: 1, to: 'IN' }); eq(r.error.code, 'no_run');
  r = H.call(w, s, 'cash', { roundId: 'x' }); eq(r.error.code, 'no_run');
  const run = open(w, s), bobRun = open(w, sb, 'play', 500, 'TX'); const b = snap(w); const to = run.options[0].to;
  const bad = (p, code) => { const r = H.call(w, s, 'step', p); eq(r.error && r.error.code, code, JSON.stringify(p) + ' -> ' + JSON.stringify(r.error || r.ev)); noEffect(w, b); eq(w.disk().open.ann.run.steps, 0); };
  for (const n of [0, 2, -1, 1.5, '1', null, undefined, NaN, Infinity, 1e300, [1], { n: 1 }, true]) bad({ roundId: run.roundId, n, to }, 'bad_step');
  for (const x of ['OH', 'ZZ', 'CA', '', '__proto__', 'constructor', 'toString', 5, null, undefined, ['IN'], { a: 1 }, 'in', ' IN']) bad({ roundId: run.roundId, n: 1, to: x }, 'bad_step');
  for (const id of [bobRun.roundId, 'nope', '', 5, null, undefined, [run.roundId], { id: run.roundId }]) bad({ roundId: id, n: 1, to }, 'bad_step');
  for (const p of [null, undefined, 'step', 5, [], {}]) bad(p, 'bad_step');
  eq(H.call(w, sb, 'cash', { roundId: run.roundId }).error.code, 'no_run', "another account's roundId cannot cash this run"); eq(w.runs.size, 2); eq(w.escrows().length, 2);
  // an option of the run, but not from the current state's neighbours (a non-border): refused
  const far = Object.keys(E.MAP.states).find((c) => c !== 'OH' && !run.options.some((o) => o.to === c)); bad({ roundId: run.roundId, n: 1, to: far }, 'bad_step');
  // a visited state after a step
  const r1 = step(w, s, run, to); eq(r1.ev, 'step'); const run1 = r1.payload.run; const b1 = snap(w);
  r = H.call(w, s, 'step', { roundId: run.roundId, n: 2, to: 'OH' }); eq(r.error.code, 'bad_step', 'a visited state'); noEffect(w, b1);
  r = H.call(w, s, 'step', { roundId: run.roundId, n: 1, to: run1.options[0].to }); eq(r.error.code, 'bad_step', 'a stale n'); noEffect(w, b1);
});

t('client-sent win / mx / force are ignored without the QA hook (and under production)', () => {
  const w = setup(), s = w.sock('ann'); w.RNG.v = 0.999999;   // a normal draw survives
  const run = open(w, s); const to = run.options[0].to;
  let r = step(w, s, run, to, 'scandal'); eq(r.ev, 'step', 'force ignored when CAMPAIGN_TEST is not 1');
  r = H.call(w, s, 'step', { roundId: run.roundId, n: 2, to: r.payload.run.options[0].to, win: 1e9, mx: 100000, bet: 2500, amount: 5, force: 'scandal', cashout: 1 }); eq(r.ev, 'step'); ok(r.payload.run.mx < 200, 'mx is the engine\'s');
  hook(true); process.env.NODE_ENV = 'production';
  r = H.call(w, s, 'step', { roundId: run.roundId, n: 3, to: r.payload.run.options[0].to, force: 'scandal' }); eq(r.ev, 'step', 'force ignored under NODE_ENV=production even with CAMPAIGN_TEST=1');
  delete process.env.NODE_ENV;
  const w2 = setup(); w2.RNG.v = 0; const s2 = w2.sock('ann'); const run2 = open(w2, s2);   // a normal draw of 0 fails; force:'survive' without the hook does not rescue it
  r = step(w2, s2, run2, run2.options[0].to, 'survive'); eq(r.ev, 'end'); eq(r.payload.reason, 'scandal');
  hook(false);
});

t('QA hook (CAMPAIGN_TEST=1): force survive / scandal run the normal money path; other values ignored', () => {
  const w = setup(), s = w.sock('ann'); hook(true); w.RNG.v = 0;   // the normal rng would fail every step
  let run = open(w, s); let r = step(w, s, run, run.options[0].to, 'survive'); eq(r.ev, 'step', 'forced survive'); run = r.payload.run;
  r = step(w, s, run, run.options[0].to, 'junk'); eq(r.ev, 'end', 'an unknown force value is ignored: the normal rng (0) fails the step'); eq(r.payload.reason, 'scandal');
  w.RNG.v = 0.999999; run = open(w, s); r = step(w, s, run, run.options[0].to, 'scandal'); eq(r.ev, 'end'); eq(r.payload.reason, 'scandal'); eq(r.payload.win, 0);
  run = open(w, s); r = step(w, s, run, run.options[0].to, { x: 1 }); eq(r.ev, 'step', 'a non-string force is ignored');
  r = step(w, s, r.payload.run, r.payload.run.options[0].to, '__proto__'); eq(r.ev, 'step', '__proto__ as force is ignored');
  r = step(w, s, r.payload.run, r.payload.run.options[0].to, 'toString'); eq(r.ev, 'step', 'toString as force is ignored');
  hook(false);
});

t('scandal: win 0, stake to the house, end carries the failed state, record gone; at step 0 and later', () => {
  const w = setup(), s = w.sock('ann'); hook(true);
  for (const pre of [0, 2]) {
    let run = open(w, s, 'play', 1000, 'OH'); const b0 = w.bal('ann', 'play') + 1000;
    for (let i = 0; i < pre; i++) run = step(w, s, run, run.options[0].to, 'survive').payload.run;
    const to = run.options[0].to; const r = step(w, s, run, to, 'scandal');
    eq(r.ev, 'end'); const e = r.payload;
    eq(e.reason, 'scandal'); eq(e.win, 0); eq(e.bet, 1000); eq(e.mode, 'play'); eq(e.failedAt, to); eq(e.steps, pre); eq(e.mx, run.mx); eq(e.at, run.at); deq(e.trail, run.trail); eq(e.roundId, run.roundId);
    eq(e.balances.play, b0 - 1000); eq(w.bal('ann', 'play'), b0 - 1000); eq(w.escrows().length, 0); eq(w.runs.size, 0); eq(w.disk().open.ann, undefined);
    const rr = H.call(w, s, 'cash', { roundId: run.roundId }); eq(rr.error.code, 'no_run');
  }
  hook(false);
});

t('cash: >= 1 step pays stake x multiplier, 0 steps is a refund (withdrawn); fields of end', () => {
  const w = setup(), s = w.sock('ann'); hook(true);
  let run = open(w, s, 'chips', 2500, 'TX'); const b0 = w.bal('ann', 'chips') + 2500;
  let r = H.call(w, s, 'cash', { roundId: run.roundId }); eq(r.ev, 'end');
  deq(Object.keys(r.payload).sort(), ['at', 'balances', 'bet', 'failedAt', 'mode', 'mx', 'reason', 'roundId', 'steps', 'trail', 'win']);
  eq(r.payload.reason, 'withdrawn'); eq(r.payload.win, 2500); eq(r.payload.steps, 0); eq(r.payload.mx, 100); eq(w.bal('ann', 'chips'), b0); eq(w.house('chips'), 0);
  const refs = w.campaignLines().map((l) => l.ref); ok(refs.every((x) => x.startsWith('campaign:ann:')));
  run = open(w, s, 'chips', 2500, 'TX');
  for (let i = 0; i < 3; i++) run = step(w, s, run, run.options[0].to, 'survive').payload.run;
  const mx = run.mx; r = H.call(w, s, 'cash', { roundId: run.roundId });
  eq(r.payload.reason, 'cashout'); eq(r.payload.mx, mx); eq(r.payload.win, 25 * mx); eq(r.payload.win, E.payout({ ...E.newRun('TX'), steps: 3, mx }, 2500)); eq(r.payload.steps, 3); eq(r.payload.balances.chips, b0 - 2500 + 25 * mx - 0);
  eq(w.bal('ann', 'chips'), b0 + 25 * mx - 2500); eq(w.house('chips'), -(25 * mx - 2500)); eq(w.escrows().length, 0); eq(w.disk().open.ann, undefined);
  hook(false);
});

t('dead end (Maine) and LANDSLIDE end the run with an automatic cash-out at the new multiplier', () => {
  const w = setup(), s = w.sock('ann'); hook(true);
  let run = open(w, s, 'play', 500, 'NH'); const me = run.options.find((o) => o.to === 'ME'); ok(me && me.deadEnd, 'ME is marked deadEnd before the pick');
  let r = step(w, s, run, 'ME', 'survive'); eq(r.ev, 'end'); eq(r.payload.reason, 'deadend'); eq(r.payload.steps, 1); eq(r.payload.win, 5 * me.nextMx); eq(w.escrows().length, 0); eq(w.runs.size, 0);
  w.fund('ann', 'chips', 3e6);
  run = open(w, s, 'chips', 2500, WITNESS[0]);
  for (let i = 1; i < 49; i++) { r = step(w, s, run, WITNESS[i], 'survive'); eq(r.ev, 'step', 'hop ' + i); run = r.payload.run; }
  const last = run.options.find((o) => o.to === WITNESS[49]); ok(last && last.landslide, 'the 50th state is marked landslide'); eq(last.nextMx, 100000); eq(last.nextCashout, 2500 * 1000);
  const b0 = w.bal('ann', 'chips');
  r = step(w, s, run, WITNESS[49], 'survive'); eq(r.ev, 'end'); eq(r.payload.reason, 'landslide'); eq(r.payload.win, 2500000); eq(r.payload.mx, 100000); eq(r.payload.steps, 49); eq(w.bal('ann', 'chips'), b0 + 2500000); eq(w.escrows().length, 0);
  hook(false);
});

t('reconnect: state returns the run; end reaches every socket of the account and no other', () => {
  const w = setup(), s = w.sock('ann'), s2 = w.sock('ann'), sb = w.sock('bob'); hook(true);
  let run = open(w, s); run = step(w, s, run, run.options[0].to, 'survive').payload.run;
  s.out.length = 0; s.send('disconnect'); w.io.sockets.sockets.forEach((x, k) => { if (x === s) w.io.sockets.sockets.delete(k); });
  const s3 = w.sock('ann'); const r = H.call(w, s3, 'state', {}); deq(r.payload.run, run); eq(w.escrows().length, 1, 'a disconnect changes nothing');
  const e = H.call(w, s3, 'cash', { roundId: run.roundId }); eq(e.ev, 'end');
  eq(H.all(s2, 'g:campaign:end').length, 1, 'the other tab hears it'); eq(H.all(s3, 'g:campaign:end').length, 1); eq(H.all(sb, 'g:campaign:end').length, 0); deq(H.last(s2, 'g:campaign:end'), e.payload);
  const sb2 = w.sock('bob'); const bRun = open(w, sb, 'play', 500, 'TX'); eq(H.all(sb2, 'g:campaign:run').length, 0, 'run goes to the asker');
  hook(false);
});

t('auth: a socket that is not signed in is refused by the registry', () => {
  const w = setup(), s = w.sock(null);
  s.send('g:campaign:start', { mode: 'play', bet: 500, home: 'OH' }); eq(H.last(s, 'error').code, 'auth'); eq(w.runs.size, 0); eq(w.escrows().length, 0);
});

t('idle: 0 steps -> refund (timeout), >= 1 step -> cash-out (timeout); end to every socket; step restarts the clock', async () => {
  const w = setup(), s = w.sock('ann'), s2 = w.sock('ann'); hook(true); process.env.CAMPAIGN_IDLE_MS = '60';
  eq(SRV._test.idleMs(), 60);
  let run = open(w, s, 'play', 500, 'OH'); eq(run.idleMs, 60); const b0 = w.bal('ann', 'play') + 500;
  await sleep(150);
  let e = lastEnd(s2); ok(e, 'timeout end reached the other socket'); eq(e.reason, 'timeout'); eq(e.win, 500); eq(e.steps, 0); eq(w.bal('ann', 'play'), b0); eq(w.escrows().length, 0); eq(w.runs.size, 0); eq(w.disk().open.ann, undefined);
  ok(w.campaignLines().some((l) => /:close$/.test(l.ref)), 'closed');
  process.env.CAMPAIGN_IDLE_MS = '300';
  run = open(w, s, 'play', 500, 'OH'); await sleep(200);
  let r = step(w, s, run, run.options[0].to, 'survive'); eq(r.ev, 'step'); run = r.payload.run; eq(run.expiresAt, w.clock.now() + 300);
  await sleep(200); eq(w.runs.size, 1, 'the pick restarted the clock: still open');
  r = step(w, s, run, run.options[0].to, 'survive'); run = r.payload.run;
  process.env.CAMPAIGN_IDLE_MS = '60'; await sleep(450);
  e = lastEnd(s); eq(e.reason, 'timeout'); eq(e.steps, 2); eq(e.win, 5 * run.mx); eq(e.mx, run.mx); eq(w.escrows().length, 0); eq(w.bal('ann', 'play'), b0 + 5 * run.mx - 500 + 0 - 0 + (0));
  hook(false);
});

t('idle: CAMPAIGN_IDLE_MS is ignored without the hook / under production', () => {
  const w = setup(); process.env.CAMPAIGN_IDLE_MS = '5'; eq(SRV._test.idleMs(), 60000); hook(true); eq(SRV._test.idleMs(), 5);
  process.env.NODE_ENV = 'production'; eq(SRV._test.idleMs(), 60000); delete process.env.NODE_ENV; hook(false); delete process.env.CAMPAIGN_IDLE_MS;
  for (const v of ['0', '-5', 'abc', '1.5', '']) { hook(true); process.env.CAMPAIGN_IDLE_MS = v; eq(SRV._test.idleMs(), 60000, v); }
  hook(false); delete process.env.CAMPAIGN_IDLE_MS;
});

t('a cash racing the idle timer closes once; a stale timer after the close does nothing', () => {
  const w = setup(), s = w.sock('ann'); hook(true);
  let run = open(w, s); run = step(w, s, run, run.options[0].to, 'survive').payload.run; const rec = w.runs.get('ann');
  const r = H.call(w, s, 'cash', { roundId: run.roundId }); eq(r.ev, 'end'); const n = lines(w);
  SRV._test.autoClose(rec, 'timeout'); SRV._test.autoClose(rec, 'timeout'); eq(lines(w), n, 'no second close'); eq(H.all(s, 'g:campaign:end').length, 1);
  // and the other order: the timer closes first, a cash right behind it finds no run
  run = open(w, s); const rec2 = w.runs.get('ann'); SRV._test.autoClose(rec2, 'timeout'); const r2 = H.call(w, s, 'cash', { roundId: run.roundId }); eq(r2.error.code, 'no_run'); eq(w.escrows().length, 0);
  hook(false);
});

t('money error: an error and no result, the run stays open, a retry closes it once (never a re-draw of a scandal)', () => {
  const w = setup(), s = w.sock('ann'); hook(true);
  let run = open(w, s); run = step(w, s, run, run.options[0].to, 'survive').payload.run; const b = snap(w);
  w.hooks.before.settle = () => { throw Object.assign(new Error('disk'), { code: 'internal' }); };
  let r = H.call(w, s, 'cash', { roundId: run.roundId }); eq(r.error.code, 'internal'); eq(H.all(s, 'g:campaign:end').length, 0, 'no result'); noEffect(w, b); eq(w.runs.size, 1); ok(w.disk().open.ann, 'record kept');
  w.hooks.before = {}; r = H.call(w, s, 'cash', { roundId: run.roundId }); eq(r.ev, 'end'); eq(r.payload.reason, 'cashout'); eq(w.escrows().length, 0);
  // a scandal draw whose settle fails stays a scandal
  run = open(w, s); w.hooks.before.settle = () => { throw Object.assign(new Error('disk'), { code: 'internal' }); };
  r = step(w, s, run, run.options[0].to, 'scandal'); eq(r.error.code, 'internal'); eq(w.runs.size, 1); w.hooks.before = {};
  w.RNG.v = 0.999999;                                                                       // a NEW draw would survive: the step below must not draw at all
  r = H.call(w, s, 'step', { roundId: run.roundId, n: run.steps + 1, to: run.options[0].to }); eq(r.ev, 'end', 'the step retried the close, it did not draw'); eq(r.payload.reason, 'scandal'); eq(r.payload.win, 0); eq(w.escrows().length, 0);
  // the open call failing leaves nothing
  w.hooks.before.open = () => { throw Object.assign(new Error('disk'), { code: 'internal' }); }; const b2 = snap(w);
  r = H.start(w, s, 'play', 500, 'OH'); eq(r.error.code, 'internal'); noEffect(w, b2); eq(w.runs.size, 0);
  hook(false);
});

t('round_closed from the ledger: record dropped, nothing paid, the client gets an error and a fresh state', () => {
  const w = setup(), s = w.sock('ann'); let run = open(w, s); run = step(w, s, run, run.options[0].to, undefined).payload.run;
  w.money.settle('ann', 'play', run.roundId, { win: 1, stake: 500 });   // someone else closed the round
  const n = lines(w), b = w.bal('ann', 'play'); const r = H.call(w, s, 'cash', { roundId: run.roundId });
  eq(r.error.code, 'round_closed'); eq(lines(w), n); eq(w.bal('ann', 'play'), b); eq(w.runs.size, 0); eq(w.disk().open.ann, undefined); eq(H.last(s, 'g:campaign:state').run, null); eq(H.all(s, 'g:campaign:end').length, 0);
});

t('a failed record flush at start refunds the stake; a failed flush at a step means the step did not happen', () => {
  const w = setup(), s = w.sock('ann'); const b0 = w.bal('ann', 'play'); const store = w.store(), real = store.flush; let boom = 1;
  store.flush = () => { if (boom-- > 0) throw new Error('disk full'); return real(); };
  let r = H.start(w, s, 'play', 500, 'OH'); eq(r.error.code, 'internal'); eq(w.bal('ann', 'play'), b0, 'refunded'); eq(w.escrows().length, 0); eq(w.runs.size, 0); eq((w.disk() || { open: {} }).open.ann, undefined);
  ok(w.campaignLines().some((l) => /:close$/.test(l.ref)));
  store.flush = real; hook(true); const run = open(w, s); boom = 1; store.flush = () => { if (boom-- > 0) throw new Error('disk full'); return real(); };
  r = step(w, s, run, run.options[0].to, 'survive'); eq(r.error.code, 'internal'); eq(H.all(s, 'g:campaign:step').length, 0); eq(w.runs.get('ann').run.steps, 0); eq(w.disk().open.ann.run.steps, 0);
  store.flush = real; r = step(w, s, run, run.options[0].to, 'survive'); eq(r.ev, 'step'); eq(w.disk().open.ann.run.steps, 1);
  hook(false);
});

t('mixed-case and odd account keys use the ledger key; __proto__ is just an account', () => {
  const w = setup({ keys: ['ann', 'bob', 'constructor'] }); const s = w.sock({ key: 'ANN' }); w.fund('constructor', 'play', 1e6);
  const run = open(w, s); ok(w.escrows()[0].account.startsWith('escrow:campaign:ann:'));
  const sc = w.sock({ key: 'constructor' }); const r = H.start(w, sc, 'play', 500, 'OH'); eq(r.ev, 'run'); eq(w.disk().open.constructor.roundId, r.payload.run.roundId);
  eq(H.call(w, s, 'cash', { roundId: run.roundId }).ev, 'end');
});

t('runView: cashout and nextCashout are the server\'s whole units at every bet level; pFail has 4 decimals', () => {
  const w = setup(), s = w.sock('ann'); hook(true);
  for (const bet of E.BET_LEVELS) {
    let run = open(w, s, 'play', bet, 'GA');
    for (let i = 0; i < 4; i++) {
      eq(run.cashout, bet * run.mx / 100); ok(Number.isSafeInteger(run.cashout));
      for (const o of run.options) { eq(o.nextCashout, bet * o.nextMx / 100); ok(Number.isSafeInteger(o.nextCashout)); ok(/^\d(\.\d{1,4})?$/.test(String(o.pFail))); }
      if (i > 0) { const rr = { ...E.newRun(run.home), trail: run.trail, at: run.at, steps: run.steps, mx: run.mx }; E.check(rr); eq(run.cashout, E.payout(rr, bet)); }
      const st = step(w, s, run, run.options.find((o) => !o.deadEnd).to, 'survive'); ok(st.ev === 'step', JSON.stringify(st.error || st.payload)); run = st.payload.run;
    }
    eq(H.call(w, s, 'cash', { roundId: run.roundId }).ev, 'end');
  }
  hook(false);
});

t('init: a reload of the module drops live timers and runs; audit is from the game\'s own records', () => {
  const w = setup(), s = w.sock('ann'); open(w, s); const a = w.audit(); eq(a.openRounds.length, 1); deq(a.pools, {});
  w.reboot(); eq(w.runs.size, 0, 'a restart cashed the run out (refund at 0 steps)'); eq(w.audit().openRounds.length, 0); eq(w.escrows().length, 0);
});

// ---- fix round 1 (CRITIC-R1 C3, C5, C6) -------------------------------------------------------------------------------------------------------------------------------------
t('C5: a step sent to a doomed run (after a money error) is refused, draws nothing, and closes the run as the scandal it was', () => {
  const w = setup(), s = w.sock('ann'); hook(true); const pre = w.bal('ann', 'play');
  let run = open(w, s); run = step(w, s, run, run.options[0].to, 'survive').payload.run;
  w.hooks.before.settle = () => { throw Object.assign(new Error('disk'), { code: 'internal' }); };
  let r = step(w, s, run, run.options[0].to, 'scandal'); eq(r.error.code, 'internal'); w.hooks.before = {};
  let draws = 0; const was = w.RNG; SRV.rng = () => { draws++; return 0.999999; };
  const trail = w.runs.get('ann').run.trail.slice();
  r = step(w, s, run, run.options[0].to, 'survive');                                          // even a forced survive must not draw: the result is already drawn
  eq(draws, 0, 'no draw'); eq(r.ev, 'end'); eq(r.payload.reason, 'scandal'); eq(r.payload.win, 0); eq(w.bal('ann', 'play'), pre - 500); eq(w.runs.size, 0);
  hook(false);
});

t('C3: a surviving step whose record flush failed: the retry of the same step returns the SAME draw (no second roll)', () => {
  const w = setup(), s = w.sock('ann'); const store = w.store(), real = store.flush;
  const run = open(w, s, 'play', 500, 'GA'), to = run.options.find((o) => o.tier === 'swing').to;
  let boom = 1; store.flush = () => { if (boom-- > 0) throw new Error('disk full'); return real(); };
  w.RNG.v = 0.999999; let r = step(w, s, run, to); eq(r.error.code, 'internal'); eq(w.runs.get('ann').run.steps, 0, 'the step did not happen yet');
  w.RNG.v = 0;                                                                                 // a fresh draw would be a scandal
  r = step(w, s, run, to); eq(r.ev, 'step', 'the retry gets the draw that was made: a survive'); eq(r.payload.run.steps, 1); eq(w.runs.get('ann').run.steps, 1);
  ok(w.disk().open.ann.run.steps === 1, 'durable now'); eq(w.runs.get('ann').memo, null);
  // a different step after a failed flush is a new decision: it draws
  const run2 = r.payload.run, to2 = run2.options.find((o) => !o.deadEnd).to; boom = 1; w.RNG.v = 0.999999; r = step(w, s, run2, to2); eq(r.error.code, 'internal');
  w.RNG.v = 0; const other = run2.options.find((o) => o.to !== to2 && !o.deadEnd); r = step(w, s, run2, other.to); eq(r.ev, 'end', 'another destination draws afresh'); eq(r.payload.reason, 'scandal');
  store.flush = real;
});

t('C3: one failed flush on the first attempt does not change a step\'s odds (seeded, 800 runs, swing first step)', () => {
  const R = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const rng = R(2026), w = setup(), s = w.sock('ann'); const store = w.store(), real = store.flush; w.RNG.v = null;
  hook(false); SRV.rng = rng; let surv = 0, N = 800, design = 0;
  for (let i = 0; i < N; i++) {
    w.clock.advance(300);
    const run = open(w, s, 'play', 100, 'GA'), o = run.options.find((x) => x.tier === 'swing'); design = 1 - o.pFail;
    let boom = 1; store.flush = () => { if (boom-- > 0) throw new Error('disk full'); return real(); };
    let r = step(w, s, run, o.to);
    if (r.error) r = step(w, s, run, o.to);                                                    // the client retries the same message
    store.flush = real;
    if (r.ev === 'step') { surv++; H.call(w, s, 'cash', { roundId: run.roundId }); }
  }
  const p = surv / N, sd = Math.sqrt(design * (1 - design) / N);
  ok(Math.abs(p - design) < 4 * sd, `survival ${p.toFixed(3)} vs design ${design.toFixed(3)} (4 sd = ${(4 * sd).toFixed(3)})`);
});

(async () => {
  const only = process.argv[2];
  for (const [name, fn] of todo) {
    if (only && !name.includes(only)) continue;
    try { await fn(); pass++; console.log('ok   ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n     ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n     ')); }
  }
  console.log(`\ncampaign: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
