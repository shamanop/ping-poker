'use strict';
// Money 1008 R2D-2 (Campaign Trail): on a full disk (ledger + campaign.json refuse writes) a refused step must not do different WORK for a kept scandal and a kept survive. Before: every ask of a kept scandal ran the
// store flush try AND a whole ledger settle try (through closeRun), a kept survive ran the store flush try only; the answer of a kept scandal came later, the draw is kept, and the 150 ms rate limit allowed ~6 asks a second, so
// a player timed each option and, once the disk was back, played one that timed as a survive. This test does NOT measure wall time (flaky): it COUNTS the work of one ask: ledger calls (every ctx.money write, counted
// before it runs), store calls (putOpen / flush), and every fs call the process makes (by name). Rule: while a step is refused the work of the ask is the same whatever was drawn; the settle of a kept scandal is tried
// only after the one probe (the store flush try) succeeded; a step that is being refused for a write fault is answered at most once per second per account (an early ask: same refusal, no work at all).
// Plain node, exit 0 on pass, 1 on fail. Runs on the REAL ledger (tests/lib-campaign-ledger.js).
const assert = require('assert');
const fs = require('fs');
const H = require('./lib-campaign-ledger.js');

const eq = assert.strictEqual, deq = assert.deepStrictEqual, ok = assert.ok;
let pass = 0, fail = 0;
const todo = [];
const t = (name, fn) => todo.push([name, fn]);
const SURVIVE = 0.999999, SCANDAL = 0;
const ENOSPC = () => { const e = new Error('ENOSPC: no space left on device, write'); e.code = 'ENOSPC'; return e; };
// a REAL full disk for both files: the ledger appends with fs.writeSync, the Campaign store writes with fs.writeFileSync(fd)
function diskFull() {
  const a = fs.writeSync, b = fs.writeFileSync;
  fs.writeSync = () => { throw ENOSPC(); };
  fs.writeFileSync = function (f, ...x) { if (typeof f === 'number') throw ENOSPC(); return b.call(this, f, ...x); };
  return () => { fs.writeSync = a; fs.writeFileSync = b; };
}
// count every call of these fs functions by name (the whole vector is compared, so a ledger lock read, fstat, write or ftruncate shows up whatever it is)
const FS_NAMES = ['openSync', 'closeSync', 'readSync', 'readFileSync', 'writeSync', 'writeFileSync', 'fstatSync', 'statSync', 'lstatSync', 'ftruncateSync', 'fsyncSync', 'renameSync', 'existsSync', 'copyFileSync', 'unlinkSync', 'mkdirSync', 'appendFileSync', 'flockSync'];
// fs.rmSync loads node's rimraf lazily on its first call and that module keeps the fs functions it finds at that moment: load it BEFORE any wrapper exists, or the first wrapper would stay inside it for good
try { fs.rmSync(require('path').join(require('os').tmpdir(), 'no-such-file-r2d-2'), { force: true }); } catch {}
function fsCounter() {
  const orig = {}, n = {};
  for (const k of FS_NAMES) { if (typeof fs[k] !== 'function') continue; const f = fs[k]; orig[k] = f; fs[k] = function (...a) { n[k] = (n[k] || 0) + 1; return f.apply(this, a); }; }
  return { n, stop() { for (const k of Object.keys(orig)) fs[k] = orig[k]; } };
}
// a world whose draws come from a script: queue.shift() per draw, 0.999999 (survive) when the queue is empty; `draws` counts every draw
function world(cur) {
  delete process.env.CAMPAIGN_TEST; delete process.env.CAMPAIGN_IDLE_MS; delete process.env.NODE_ENV;
  const q = [], c = { draws: 0, ledger: 0, store: 0 };
  const w = H.world({ rng: () => { c.draws++; return q.length ? q.shift() : SURVIVE; }, keys: ['ann'] });
  w.fund('ann', 'play', 3e9); w.fund('ann', 'chips', 3e9);
  w.q = q; w.c = c;
  for (const name of ['open', 'settle', 'void']) w.hooks.before[name] = () => { c.ledger++; };
  // a run on TN (8 borders: always two live options), one surviving step taken, the next step is n = 2 with two live options
  const s = w.sock('ann'), s2 = w.sock('ann');
  let run = H.start(w, s, cur, 2500, 'TN').payload.run;
  const o1 = run.options.find((o) => !o.deadEnd && !o.landslide);
  run = H.call(w, s, 'step', { roundId: run.roundId, n: 1, to: o1.to }).payload.run;
  const opts = run.options.filter((o) => !o.deadEnd && !o.landslide).slice(0, 2);
  ok(opts.length === 2, 'two live options at step 2');
  const st = w.store();
  for (const m of ['putOpen', 'delOpen', 'flush']) { const f = st[m].bind(st); st[m] = (...a) => { c.store++; return f(...a); }; }
  return { w, s, s2, run, A: opts[0].to, B: opts[1].to, n: run.steps + 1, id: run.roundId };
}
// ask a step WITHOUT the helper's 200 ms advance; `gap` ms pass first. Returns the work of the ask and what came back.
function ask(x, to, gap, ev, payload) {
  const { w, s, s2 } = x, c = w.c;
  w.clock.advance(gap);
  const before = { draws: c.draws, ledger: c.ledger, store: c.store };
  const o0 = s.out.length, o2 = s2.out.length, exp = () => (w.runs.get('ann') || {}).expiresAt, exp0 = exp();
  const f = fsCounter();
  try { s.send('g:campaign:' + (ev || 'step'), payload || { roundId: x.id, n: x.n, to }); } finally { f.stop(); }
  const got = s.out.slice(o0), e = got.filter((o) => o[0] === 'error').pop();
  return {
    work: { draws: c.draws - before.draws, ledger: c.ledger - before.ledger, store: c.store - before.store, fs: f.n },
    err: e ? { code: e[1].code, message: e[1].message } : got.map((o) => o[0]),
    other: s2.out.slice(o2).map((o) => [o[0], o[1] && o[1].code]),
    expMoved: exp() !== exp0,
  };
}

for (const cur of ['play', 'chips']) {
  t(`R2D-2a [${cur}]: a refused ask does the same work for a kept scandal and a kept survive (ledger, store, every fs call), first ask and every repeat`, () => {
    const out = {};
    for (const [label, pin] of [['scandal', SCANDAL], ['survive', SURVIVE]]) {
      const x = world(cur); x.w.q.push(pin);
      const restore = diskFull();
      try {
        const first = ask(x, x.A, 1000);
        const again = [ask(x, x.A, 1000), ask(x, x.A, 1000), ask(x, x.A, 2500)];     // the draw is kept: three more asks of the same state
        out[label] = [first, ...again];
      } finally { restore(); }
      for (const r of out[label]) ok(r.err && r.err.code, label + ': the step is an error');
    }
    deq(out.scandal.map((r) => r.work), out.survive.map((r) => r.work), 'the work of a refused ask depends on what was drawn: ' + JSON.stringify([out.scandal.map((r) => r.work), out.survive.map((r) => r.work)]));
    deq(out.scandal.map((r) => [r.err, r.other, r.expMoved]), out.survive.map((r) => [r.err, r.other, r.expMoved]));
    // and the settle is NOT tried at all while the probe fails: no ledger call, for either outcome
    for (const label of ['scandal', 'survive']) for (const r of out[label]) eq(r.work.ledger, 0, label + ': a refused ask made a ledger call');
    // the other state (a second kept draw) is no different
    for (const [label, pins] of [['scandal', [SURVIVE, SCANDAL]], ['survive', [SURVIVE, SURVIVE]]]) {
      const x = world(cur); x.w.q.push(...pins);
      const restore = diskFull();
      try { ask(x, x.A, 1000); out[label] = [ask(x, x.B, 1000), ask(x, x.B, 1000)]; } finally { restore(); }
    }
    deq(out.scandal.map((r) => r.work), out.survive.map((r) => r.work), 'the other state: the work depends on what was drawn');
  });

  t(`R2D-2b [${cur}]: a kept scandal is settled only AFTER the probe succeeds: disk back = ONE flush and ONE ledger settle, the scandal lands and costs the stake`, () => {
    const x = world(cur), { w } = x; w.q.push(SCANDAL);
    const restore = diskFull();
    try { for (let i = 0; i < 3; i++) ok(ask(x, x.A, 1000).err.code); } finally { restore(); }
    const bal0 = w.bal('ann', cur), d0 = w.c.draws;
    const r = ask(x, x.A, 1000);
    ok(r.err.length && r.err.includes('g:campaign:end'), 'the drawn scandal lands: ' + JSON.stringify(r.err));
    eq(r.work.ledger, 1, 'one ledger settle');
    eq(w.c.draws - d0, 0, 'no new draw');
    eq(w.bal('ann', cur), bal0, 'a scandal pays nothing back: the stake stays with the house');
    eq(w.escrowSum(cur), 0); eq(w.conservation(cur).everything, 0);
  });

  t(`R2D-2c [${cur}]: a step that is being refused is answered at most once per second per account: an early ask gets the same refusal and NO work (no draw, no store, no ledger, no fs call)`, () => {
    const x = world(cur), { w } = x; w.q.push(SCANDAL, SURVIVE);
    const restore = diskFull();
    let first, early = [], late;
    try {
      first = ask(x, x.A, 1000);
      ok(first.work.store >= 1, 'the first ask does the probe');
      for (const [to, gap] of [[x.A, 200], [x.B, 200], [x.A, 200], [x.B, 300]]) early.push(ask(x, to, gap));     // 200-700 ms after the refused ask, same state and the other one
      late = ask(x, x.B, 1000);
    } finally { restore(); }
    for (const r of early) {
      deq(r.work, { draws: 0, ledger: 0, store: 0, fs: {} }, 'an early ask did work: ' + JSON.stringify(r.work));
      deq(r.err, first.err, 'the early answer is the same refusal');
      deq(r.other, first.other); eq(r.expMoved, first.expMoved);
    }
    eq(late.work.draws, 1, 'a second after the last answered ask the step is worked again (B is drawn now)');
    ok(late.work.store >= 1);
  });

  t(`R2D-2d [${cur}]: the cap is per account and lifts with the clock; once the disk is back a step plays (after the second), the draws are the kept ones`, () => {
    const x = world(cur), { w } = x; w.q.push(SURVIVE);
    const restore = diskFull();
    try { ok(ask(x, x.A, 1000).err.code); } finally { restore(); }
    const d0 = w.c.draws;
    const early = ask(x, x.A, 300);                                    // disk is back but the account was refused 300 ms ago: the same refusal, nothing done
    ok(early.err.code, 'early ask refused'); deq(early.work, { draws: 0, ledger: 0, store: 0, fs: {} });
    const r = ask(x, x.A, 1000);
    ok(r.err.includes('g:campaign:step'), 'the step plays: ' + JSON.stringify(r.err));
    eq(w.c.draws - d0, 0, 'the kept draw is the one played');
    // a durable step drops the cap with the refusal: the next step (new n) is not held back by the old fault
    const run = H.last(x.s, 'g:campaign:step').run, nx = run.options.find((q) => !q.deadEnd && !q.landslide);
    const r2 = ask(x, nx.to, 200, 'step', { roundId: x.id, n: x.n + 1, to: nx.to });
    ok(r2.err.includes('g:campaign:step'), 'the next step is not held back by the old fault: ' + JSON.stringify(r2.err));
  });
}

(async () => {
  for (const [name, fn] of todo) {
    try { fn(); pass++; console.log('ok   ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n     ' + String(e && e.message).split('\n')[0]); }
  }
  console.log(`\nmoney-1008-campaign-timing: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
