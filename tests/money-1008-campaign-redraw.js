'use strict';
// Money 1008 R2D-1 (Campaign Trail): a step whose result cannot be written (full disk: ledger + campaign.json) is drawn at most ONCE per target state and run, and what the client can see of a refused
// step is the same whatever was drawn. Before: the draw memo held only the last (n, to), so A-B-A drew three times, and a drawn scandal told every socket of the account (error + idle timer re-armed)
// while a drawn survive answered the stepping socket only: the player re-drew until the tell said "survived". Plain node, exit 0 on pass, 1 on fail. Runs on the REAL ledger (tests/lib-campaign-ledger.js).
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
// a world whose draws come from a script: queue.shift() per draw, 0.999999 (survive) when the queue is empty; `draws` counts every draw
function world(cur) {
  delete process.env.CAMPAIGN_TEST; delete process.env.CAMPAIGN_IDLE_MS; delete process.env.NODE_ENV;
  const q = [], c = { draws: 0 };
  const w = H.world({ rng: () => { c.draws++; return q.length ? q.shift() : SURVIVE; }, keys: ['ann'] });
  w.fund('ann', 'play', 3e9); w.fund('ann', 'chips', 3e9);
  w.q = q; w.c = c;
  // a run on TN (8 borders: always two live options), one surviving step taken, the next step is n = 2 with two live options
  const s = w.sock('ann'), s2 = w.sock('ann');
  let run = H.start(w, s, cur, 2500, 'TN').payload.run;
  const o1 = run.options.find((o) => !o.deadEnd && !o.landslide);
  run = H.call(w, s, 'step', { roundId: run.roundId, n: 1, to: o1.to }).payload.run;
  const opts = run.options.filter((o) => !o.deadEnd && !o.landslide).slice(0, 2);
  ok(opts.length === 2, 'two live options at step 2');
  return { w, s, s2, run, A: opts[0].to, B: opts[1].to, n: run.steps + 1, id: run.roundId };
}
const step = (x, to, who) => H.call(x.w, who || x.s, 'step', { roundId: x.id, n: x.n, to });
// what a client can see of one refused step: the answer, who else was told, whether the idle timer moved, what `state` says
function seen(x, to) {
  const { w, s, s2 } = x;
  const e2 = s2.out.length, exp0 = w.runs.get('ann').expiresAt;
  const r = step(x, to);
  const st = (w.clock.advance(200), s.send('g:campaign:state'), H.last(s, 'g:campaign:state'));
  return { err: r.error ? { code: r.error.code, message: r.error.message, game: r.error.game } : r.ev, other: s2.out.slice(e2).map((o) => [o[0], o[1] && o[1].code]), expMoved: st.run.expiresAt !== exp0, steps: st.run.steps, mx: st.run.mx, trail: st.run.trail.join(',') };
}

for (const cur of ['play', 'chips']) {
  t(`R2D-1a [${cur}]: A, B, A on a full disk = ONE draw per state (2 draws, not 3); the disk back, A plays the draw it had`, () => {
    const x = world(cur), { w } = x;
    w.q.push(SCANDAL, SURVIVE, SURVIVE);                     // 1st draw (A) = scandal; a third draw would be a survive
    const d0 = w.c.draws, restore = diskFull();
    try { for (const to of [x.A, x.B, x.A, x.B, x.A]) ok(step(x, to).error, 'refused'); } finally { restore(); }
    eq(w.c.draws - d0, 2, 'one draw for A and one for B, however often they are asked');
    const r = step(x, x.A);
    eq(r.ev, 'end', 'the scandal drawn for A is the one that lands: ' + JSON.stringify(r.error)); eq(r.payload.reason, 'scandal');
    eq(w.c.draws - d0, 2, 'playing it needs no new draw');
    eq(w.escrowSum(cur), 0); eq(w.conservation(cur).everything, 0);
  });

  t(`R2D-1b [${cur}]: a refused step looks the same to the client whether it drew a scandal or a survive (second socket, idle timer, state)`, () => {
    const out = {};
    for (const [label, pin] of [['scandal', SCANDAL], ['survive', SURVIVE]]) {
      const x = world(cur); x.w.q.push(pin);
      const restore = diskFull();
      try { out[label] = seen(x, x.A); } finally { restore(); }
      ok(out[label].err && out[label].err.code, label + ': the step is an error');
    }
    deq(out.scandal, out.survive);
    // and again for the SECOND ask of the same state and for the other state (every refused step, not just the first)
    for (const [label, pin] of [['scandal', SCANDAL], ['survive', SURVIVE]]) {
      const x = world(cur); x.w.q.push(pin, SURVIVE);
      const restore = diskFull();
      try { out[label] = [seen(x, x.A), seen(x, x.A), seen(x, x.B)]; } finally { restore(); }
    }
    deq(out.scandal, out.survive);
  });

  t(`R2D-1c [${cur}]: K2-Cdisk still holds: the same state on retry gets the SAME draw (scandal and survive), once the disk is back it is played as drawn`, () => {
    for (const [label, pin, ev] of [['scandal', SCANDAL, 'end'], ['survive', SURVIVE, 'step']]) {
      const x = world(cur), { w } = x; w.q.push(pin, 1 - pin);   // a second draw would be the opposite
      const d0 = w.c.draws, restore = diskFull();
      try { ok(step(x, x.A).error); ok(step(x, x.A).error); } finally { restore(); }
      eq(w.c.draws - d0, 1, label + ': one draw for two asks');
      const r = step(x, x.A);
      eq(r.ev, ev, label + ': ' + JSON.stringify(r.error));
      eq(w.c.draws - d0, 1);
    }
  });

  t(`R2D-1d [${cur}]: the kept draws die with the step: once a step is on disk, the next step draws fresh`, () => {
    const x = world(cur), { w } = x; w.q.push(SURVIVE);
    const restore = diskFull();
    try { ok(step(x, x.A).error); ok(step(x, x.B).error); } finally { restore(); }
    const d1 = w.c.draws;
    const r = step(x, x.A); eq(r.ev, 'step'); eq(w.runs.get('ann').memo == null || (w.runs.get('ann').memo.size === 0), true, 'nothing kept after a durable step');
    const o = r.payload.run.options.find((q) => !q.deadEnd && !q.landslide);
    const r2 = H.call(w, x.s, 'step', { roundId: x.id, n: x.n + 1, to: o.to }); eq(r2.ev, 'step');
    ok(w.c.draws - d1 >= 1, 'step n+1 is a new draw');
  });
}

(async () => {
  for (const [name, fn] of todo) {
    try { fn(); pass++; console.log('ok   ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n     ' + String(e && e.message).split('\n')[0]); }
  }
  console.log(`\nmoney-1008-campaign-redraw: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
