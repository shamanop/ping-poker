'use strict';
// D2 window tests: suspended generators across appends and trims, findLast leg order, cold entriesOf, stats, the cold-scan log,
// multi-chunk journals, and "normal play does no cold scan" through the real service.
const L = require('./money-d2-lib');
const { New, Ref, eq, deq, ok, fs, path } = L;
const run = L.makeRunner('money-d2-misc');
const t = run.t;
const root = L.mkdir('money-d2-misc-');
let n = 0;
const now = () => 1000;
const file = () => path.join(root, 'm' + (++n) + '.jsonl');
const OPEN = (f, o = {}) => { const log = L.logger(); const led = New.open(f, { now, fsync: 'none', log, ckptEvery: 0, ckptVerify: false, ...o }); led.logs = log.lines; return led; };
const REFOPEN = (f) => Ref.open(f, { now, fsync: 'none', log: () => {} });
const tr = (led, i, extra = {}) => led.transfer(extra.from || 'mint:signup', extra.to || 'bank:a', 1 + (i % 5), 'chips', extra.reason || 'x', (extra.tag || 'r') + i);

t('a generator suspended while lines are appended and trimmed (window 2) gives every line once, in order', () => {
  const led = OPEN(file(), { window: 2 });
  for (let i = 0; i < 30; i++) tr(led, i);
  const g = led.entries();
  const got = [];
  for (let i = 0; i < 3; i++) got.push(g.next().value);
  for (let i = 30; i < 50; i++) tr(led, i);          // trims several times while g is suspended in the cold part
  for (let r = g.next(); !r.done; r = g.next()) got.push(r.value);
  deq(got.map(e => e.id), Array.from({ length: 50 }, (_, i) => i + 1));
  deq(got, [...led.entries()]);
  // suspended inside the in-memory part, then trimmed past it
  const h = led.entries(); const first = [h.next().value, h.next().value];
  for (let i = 50; i < 90; i++) tr(led, i);
  const rest = [...h]; deq([...first, ...rest].map(e => e.id), Array.from({ length: 90 }, (_, i) => i + 1));
  // two interleaved generators, afterId in the cold part
  const a = led.entries(null, 10), b = led.entries(e => e.id % 2 === 0, 40);
  const ia = [], ib = [];
  for (let k = 0; k < 100; k++) { const x = a.next(); if (!x.done) ia.push(x.value.id); const y = b.next(); if (!y.done) ib.push(y.value.id); if (k % 10 === 0) tr(led, 1000 + k); }
  deq(ia, Array.from({ length: led.lastId - 10 }, (_, i) => i + 11).slice(0, ia.length)); ok(ia.length >= 80);
  ok(ib.every(x => x % 2 === 0 && x > 40) && ib.length >= 25);
  led.close();
});

t('a generator suspended across a batch: the legs of one batch are not split or repeated by a trim', () => {
  const led = OPEN(file(), { window: 1 });
  led.transfer('mint:signup', 'bank:a', 1000, 'chips', 'x', 'seed');
  for (let i = 0; i < 6; i++) led.batch([{ from: 'bank:a', to: 'seat:T:a', amount: 2, cur: 'chips', reason: 'buyin:chips' }, { from: 'seat:T:a', to: 'bank:b', amount: 1, cur: 'chips', reason: 'cashout:chips' }, { from: 'bank:b', to: 'bank:a', amount: 1, cur: 'chips', reason: 'back' }], 'b' + i, 'hand');
  const g = led.entries(); const got = [g.next().value, g.next().value, g.next().value, g.next().value];   // seed + two legs of batch 0
  for (let i = 6; i < 12; i++) led.batch([{ from: 'bank:a', to: 'seat:T:a', amount: 2, cur: 'chips', reason: 'buyin:chips' }], 'b' + i, 'hand');
  for (const e of g) got.push(e);
  const want = [...led.entries()]; deq(got, want); eq(want.length, 1 + 6 * 3 + 6);
  led.close();
});

t('findLast: exactly the last of `for (const e of entries(f)) r = e`, same leg inside one batch, in the window and cold', () => {
  const f = file();
  const led = OPEN(f, { window: 1 });
  led.transfer('mint:signup', 'bank:a', 1000, 'chips', 'x', 'seed');
  led.batch([{ from: 'bank:a', to: 'seat:T:a', amount: 5, cur: 'chips', reason: 'buyin:chips' }, { from: 'bank:a', to: 'seat:T:a', amount: 7, cur: 'chips', reason: 'buyin:play' }, { from: 'seat:T:a', to: 'bank:a', amount: 1, cur: 'chips', reason: 'cashout:chips' }], 'bt', 'hand');
  const isBuy = (e) => e.to === 'seat:T:a' && e.reason.startsWith('buyin:');
  const last = (l, fn) => { let r = null; for (const e of l.entries(fn)) r = e; return r; };
  const mk = (l, fn) => { const a = l.findLast(fn), b = last(l, fn); deq(a, b); return a; };
  let before = led.stats().coldScans;
  eq(mk(led, isBuy).reason, 'buyin:play', 'the later of the two matching legs');
  for (let i = 0; i < 5; i++) tr(led, i);              // the batch is cold now (window 1)
  ok(led.stats().inMemory <= 2);
  eq(mk(led, isBuy).amount, 7); ok(led.stats().coldScans > before, 'cold scan counted');
  mk(led, null); mk(led, (e) => false); mk(led, (e) => e.ref === 'seed'); mk(led, (e) => e.cur === 'chips');
  eq(led.findLast(() => false), null);
  led.close();
  const l2 = OPEN(f, { window: 1 }); mk(l2, isBuy); l2.close();
});

t('entriesOf: from memory inside the window (no cold lookup), one positioned read when the line is cold, [] for an unknown ref', () => {
  const led = OPEN(file(), { window: 3 });
  for (let i = 0; i < 20; i++) tr(led, i);
  led.batch([{ from: 'mint:signup', to: 'bank:b', amount: 4, cur: 'chips', reason: 'x' }, { from: 'bank:b', to: 'bank:a', amount: 2, cur: 'chips', reason: 'y' }], 'batch1', 'hand');
  for (let i = 20; i < 40; i++) tr(led, i);
  const s0 = led.stats(); eq(s0.coldLookups, 0);
  deq(led.entriesOf('r39').map(e => e.id), [led.lastId - 0]); eq(led.stats().coldLookups, 0, 'newest ref served from memory');
  const old = led.entriesOf('r0'); eq(old.length, 1); eq(old[0].ref, 'r0'); eq(led.stats().coldLookups, 1);
  const b = led.entriesOf('batch1'); eq(b.length, 2); eq(b[0].batchRef, 'batch1'); eq(b[1].reason, 'y'); eq(led.stats().coldLookups, 2);
  deq(led.entriesOf('nope'), []); deq(led.entriesOf(null), []); deq(led.entriesOf(5), []); eq(led.stats().coldLookups, 2);
  eq(led.stats().coldScans, 0, 'no stream was used');
  led.close();
});

t('window bounds and refs: at least W and at most 2W lines in memory, every ref kept for ever (idempotency, conflicts)', () => {
  for (const W of [1, 2, 7, 50]) {
    const led = OPEN(file(), { window: W });
    for (let i = 0; i < 400; i++) {
      tr(led, i);
      const st = led.stats(); ok(st.inMemory <= 2 * W && st.inMemory >= Math.min(W, st.lines), `W${W} i${i} inMemory ${st.inMemory}`);
    }
    eq(led.stats().lines, 400);
    ok(led.has('r0') && led.has('r399')); deq(led.transfer('mint:signup', 'bank:a', 1, 'chips', 'x', 'r0'), { id: 1, dup: true });
    try { led.transfer('mint:signup', 'bank:a', 99, 'chips', 'x', 'r0'); ok(false); } catch (e) { eq(e.code, 'ref_conflict'); eq(e.id, 1); }
    led.close();
  }
  const l0 = OPEN(file(), { window: 0 }); for (let i = 0; i < 60; i++) tr(l0, i); eq(l0.stats().inMemory, 60); eq(l0.stats().window, 0); l0.close();
  const keep = process.env.LEDGER_WINDOW; delete process.env.LEDGER_WINDOW;
  try { const d = OPEN(file()); eq(d.stats().window, 20000); d.close(); } finally { if (keep != null) process.env.LEDGER_WINDOW = keep; }
  process.env.LEDGER_WINDOW = '9'; try { const e = OPEN(file()); eq(e.stats().window, 9); e.close(); } finally { if (keep != null) process.env.LEDGER_WINDOW = keep; else delete process.env.LEDGER_WINDOW; }
});

t('stats(): { lines, inMemory, window, coldScans, coldScanMs, coldLookups, ckpt }', () => {
  const led = OPEN(file(), { window: 4 });
  for (let i = 0; i < 20; i++) tr(led, i);
  const s = led.stats(); deq(Object.keys(s), ['lines', 'inMemory', 'window', 'coldScans', 'coldScanMs', 'coldLookups', 'ckpt']);
  eq(s.lines, 20); eq(s.window, 4); for (const k of ['used', 'bytes', 'lastId', 'tailLines', 'mismatch', 'written']) ok(k in s.ckpt, k);
  [...led.entries()]; eq(led.stats().coldScans, 1); ok(led.stats().coldScanMs >= 0);
  [...led.entries(null, led.lastId - 1)]; eq(led.stats().coldScans, 1, 'a recent afterId needs no cold scan');
  led.close();
});

t('a cold scan slower than the limit logs ONE line with its ms and the caller file:line', () => {
  const led = OPEN(file(), { window: 2, coldLogMs: -1 });
  for (let i = 0; i < 30; i++) tr(led, i);
  [...led.entries()];
  const lines = led.logs.filter(l => /cold scan/.test(l)); eq(lines.length, 1, JSON.stringify(led.logs));
  ok(/\d+ ms/.test(lines[0]) && /money-d2-misc\.js:\d+/.test(lines[0]), lines[0]);
  led.findLast(e => e.ref === 'r1'); eq(led.logs.filter(l => /cold scan/.test(l)).length, 2);
  const quiet = OPEN(file(), { window: 2 }); for (let i = 0; i < 30; i++) tr(quiet, i); [...quiet.entries()]; eq(quiet.logs.filter(l => /cold scan/.test(l)).length, 0);
  led.close(); quiet.close();
});

t('multi-chunk journal (> 1 MB), a line larger than a chunk, afterId through the sparse index: equal to the pre-D2 ledger', () => {
  const f = file(), g = file();
  const a = OPEN(f, { window: 5 }), b = REFOPEN(g);
  const both = (fn) => { fn(a); fn(b); };
  both(l => l.transfer('mint:signup', 'bank:a', 1e9, 'chips', 'x', 'seed'));
  for (let i = 0; i < 4300; i++) both(l => { if (i % 4 === 0) l.batch([{ from: 'bank:a', to: 'bank:b', amount: 1 + (i % 7), cur: 'chips', reason: 'filler-reason-text-' + i }], 'b' + i, 'hand'); else tr(l, i); });
  both(l => l.transfer('bank:a', 'bank:b', 3, 'chips', 'x'.repeat(1.6e6), 'huge'));        // one line longer than a read chunk
  for (let i = 5000; i < 5400; i++) both(l => tr(l, i, { from: 'bank:a', to: 'bank:b' }));
  ok(fs.statSync(f).size > 2e6, String(fs.statSync(f).size));
  deq([...a.entries()], [...b.entries()]);
  for (const after of [0, 1, 1023, 1024, 1025, 2047, 3000, 4000, 4300, 4700, 4701, 4702, 5000, 99999]) deq([...a.entries(e => e.amount !== 4, after)].map(e => e.id), [...b.entries(e => e.amount !== 4, after)].map(e => e.id), 'afterId ' + after);
  for (const r of ['seed', 'b0', 'b4', 'r1', 'r4299', 'huge', 'r5000', 'r5399']) deq(a.entriesOf(r), [...b.entries(e => e.ref === r)], r);
  for (const fn of [(e) => e.ref === 'b12', (e) => e.reason === 'x', (e) => e.id === 2, (e) => e.amount === 3 && e.reason.length > 100, (e) => e.to === 'bank:b']) { let w = null; for (const e of b.entries(fn)) w = e; deq(a.findLast(fn), w); }
  a.checkpoint(); a.close(); b.close();
  const a2 = OPEN(f, { window: 5 }); ok(a2.stats().ckpt.used); deq([...a2.entries()], [...REFOPEN(g).entries()]); a2.close();
});

t('normal play through the service does no cold scan after boot: buy-in, cash-out, dup retries, seatFund, topUp, closeOf, night summary', () => {
  const { createService } = require('../../money/service');
  const led = OPEN(file(), { window: 50 });
  const svc = createService(led, { now });
  for (let i = 0; i < 60; i++) led.transfer('mint:signup', 'bank:filler' + (i % 3), 1 + i, 'chips', 'noise', 'noise' + i);
  svc.mint('bonus', 'ann', 1000, 'chips', 'sign-ann');
  svc.balances('ann');                                    // first refresh (boot-time work, cold is allowed here)
  const c0 = led.stats().coldScans;
  svc.buyIn('ann', 'T', 100, 'chips', 'chips', 'bi1');
  svc.nightSummary('T'); svc.nightSummary('T', { fromId: 3 });       // the first call per (table, fromId) may scan: that is boot-time work
  const c1 = led.stats().coldScans;
  for (let i = 60; i < 80; i++) led.transfer('mint:signup', 'bank:filler' + (i % 3), 1 + i, 'chips', 'noise', 'noise' + i);   // later lines, buy-in still in the window
  eq(svc.seatFund('T', 'ann', 'chips'), 'chips');
  svc.buyIn('ann', 'T', 100, 'chips', 'chips', 'bi1');       // dup retry (entriesOf)
  svc.cashOut('ann', 'T', 40, 'chips', null, 'co1');
  svc.cashOut('ann', 'T', 40, 'chips', null, 'co1');         // dup retry infers the fund from the stored entry
  svc.nightSummary('T'); svc.nightSummary('T', { fromId: 3 }); svc.balances('ann');
  eq(led.stats().coldScans - c1, 0, 'cold scans in normal play');
  eq(led.stats().coldLookups, 0, 'the dup retries were served from the window');
  for (let i = 80; i < 200; i++) led.transfer('mint:signup', 'bank:filler' + (i % 3), 1 + i, 'chips', 'noise', 'noise' + i);   // now the buy-in is cold
  const c2 = led.stats().coldScans;
  eq(svc.seatFund('T', 'ann', 'chips'), 'chips'); eq(led.stats().coldScans - c2, 1, 'a seatFund whose buy-in is cold is one backward scan');
  svc.cashOut('ann', 'T', 40, 'chips', null, 'co1'); ok(led.stats().coldLookups >= 1, 'a dup retry of a cold ref is one positioned read'); eq(led.stats().coldScans - c2, 1);
  led.close();
});

fs.rmSync(root, { recursive: true, force: true });
run.done();
