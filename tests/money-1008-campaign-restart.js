'use strict';
// Money 1008 R2D-3 + R2D-4 (Campaign Trail).
// R2D-3: the kept draw of a refused step lives in memory only. A restart while the disk still refuses writes re-opened the run (boot could not close it: the ledger refused) with no kept draw, so the same step and state was
// drawn AGAIN. Now a run that boot could not close is closed to steps (cash-out and the idle close still work and pay the stored multiplier): no second draw after a restart, whatever was drawn the first time.
// R2D-4: a refused step is told to EVERY socket of the account and re-arms the idle timer, for a scandal and a survive alike (the redraw test only compared the two; a build that told neither passed).
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
function diskFull() {
  const a = fs.writeSync, b = fs.writeFileSync;
  fs.writeSync = () => { throw ENOSPC(); };
  fs.writeFileSync = function (f, ...x) { if (typeof f === 'number') throw ENOSPC(); return b.call(this, f, ...x); };
  return () => { fs.writeSync = a; fs.writeFileSync = b; };
}
// steps = 1: one surviving step taken, the next is n = 2 with two live options; steps = 0: the first step is the one asked
function world(cur, steps) {
  delete process.env.CAMPAIGN_TEST; delete process.env.CAMPAIGN_IDLE_MS; delete process.env.NODE_ENV;
  const q = [], c = { draws: 0 };
  const w = H.world({ rng: () => { c.draws++; return q.length ? q.shift() : SURVIVE; }, keys: ['ann'] });
  w.fund('ann', 'play', 3e9); w.fund('ann', 'chips', 3e9);
  w.q = q; w.c = c;
  let s = w.sock('ann');
  let run = H.start(w, s, cur, 2500, 'TN').payload.run;
  if (steps) run = H.call(w, s, 'step', { roundId: run.roundId, n: 1, to: run.options.find((o) => !o.deadEnd && !o.landslide).to }).payload.run;
  const A = run.options.find((o) => !o.deadEnd && !o.landslide).to;
  return { w, s, run, A, n: run.steps + 1, id: run.roundId, shown: 2500 * run.mx / 100 };
}

for (const cur of ['play', 'chips']) for (const steps of [1, 0]) for (const [label, pin] of [['scandal', SCANDAL], ['survive', SURVIVE]]) {
  t(`R2D-3 [${cur}, ${steps} step(s) taken, kept ${label}]: a restart on a still-full disk gives NO second draw; the run takes no step until it is closed; cash-out pays the stored multiplier`, () => {
    const x = world(cur, steps), { w } = x; w.q.push(pin, 1 - pin);                // a second draw would be the opposite
    const bal0 = w.bal('ann', cur) + 2500, d0 = w.c.draws;
    let restore = diskFull();
    try {
      w.clock.advance(1000); ok(H.call(w, x.s, 'step', { roundId: x.id, n: x.n, to: x.A }).error, 'the step is refused on a full disk');
      eq(w.c.draws - d0, 1, 'one draw so far');
      w.reboot();                                                                  // restart while the disk still refuses: boot cannot close the run
      ok(w.runs.get('ann'), 'the run is open again (the close was refused)');
      const s2 = w.sock('ann');
      w.clock.advance(1000); ok(H.call(w, s2, 'step', { roundId: x.id, n: x.n, to: x.A }).error, 'a step on the full disk is refused');
    } finally { restore(); }
    const s3 = w.sock('ann');
    for (const to of [x.A, null]) {                                                // the disk is back: still no step (not the state that was drawn, not another)
      const other = to || (H.last(s3, 'g:campaign:state') || { run: { options: [] } }).run.options.map((o) => o.to).find((q) => q !== x.A);
      w.clock.advance(1000);
      const r = H.call(w, s3, 'step', { roundId: x.id, n: x.n, to: other || x.A });
      ok(r.error, 'a run kept open by boot takes no step: ' + JSON.stringify(r.ev));
    }
    eq(w.c.draws - d0, 1, 'a restart never hands out a second draw for the step');
    w.clock.advance(1000);
    const r = H.call(w, s3, 'cash', { roundId: x.id });
    eq(r.ev, 'end', 'cash-out works once the disk is back: ' + JSON.stringify(r.error));
    eq(r.payload.win, steps ? x.shown : 2500, 'paid at the stored multiplier (a refund at 0 steps)');
    eq(w.bal('ann', cur) - bal0 + 2500, steps ? x.shown : 2500);
    eq(w.escrowSum(cur), 0); eq(w.conservation(cur).everything, 0); eq(w.runs.size, 0);
  });
}

t('R2D-3 [play]: the idle close of a run kept open by boot pays the stored multiplier once the disk is back (no step needed)', () => {
  const x = world('play', 1), { w } = x; w.q.push(SCANDAL);
  const bal0 = w.bal('ann', 'play') + 2500;
  let restore = diskFull();
  try { w.clock.advance(1000); ok(H.call(w, x.s, 'step', { roundId: x.id, n: x.n, to: x.A }).error); w.reboot(); } finally { restore(); }
  const rec = w.runs.get('ann'); ok(rec, 'open after the boot');
  w.SRV._test.autoClose(rec, 'timeout');
  eq(w.runs.size, 0, 'closed by the idle path');
  eq(w.bal('ann', 'play') - bal0 + 2500, x.shown);
  eq(w.escrowSum('play'), 0); eq(w.conservation('play').everything, 0);
});

t('R2D-3 [chips]: the disk back at boot is unchanged: the run is cashed out at the stored multiplier at once, the kept draw is gone', () => {
  const x = world('chips', 1), { w } = x; w.q.push(SCANDAL);
  const bal0 = w.bal('ann', 'chips') + 2500;
  let restore = diskFull();
  try { w.clock.advance(1000); ok(H.call(w, x.s, 'step', { roundId: x.id, n: x.n, to: x.A }).error); } finally { restore(); }
  w.reboot();
  eq(w.runs.size, 0); eq(w.bal('ann', 'chips') - bal0 + 2500, x.shown); eq(w.escrowSum('chips'), 0);
});

for (const cur of ['play', 'chips']) {
  t(`R2D-4 [${cur}]: a refused step is told to the OTHER sockets of the account and re-arms the idle timer, scandal and survive alike (both, not just equal)`, () => {
    for (const [label, pin] of [['scandal', SCANDAL], ['survive', SURVIVE]]) {
      const x = world(cur, 1), { w } = x, s2 = w.sock('ann'); w.q.push(pin);
      const e2 = s2.out.length, exp0 = w.runs.get('ann').expiresAt, e1 = x.s.out.length;
      const restore = diskFull();
      try { w.clock.advance(1000); H.call(w, x.s, 'step', { roundId: x.id, n: x.n, to: x.A }); } finally { restore(); }
      const got2 = s2.out.slice(e2).filter((o) => o[0] === 'error').map((o) => o[1] && o[1].code);
      deq(got2, ['internal'], label + ': the second socket is told of the refused step');
      ok(x.s.out.slice(e1).some((o) => o[0] === 'error' && o[1].code === 'internal'), label + ': the stepping socket too');
      ok(w.runs.get('ann').expiresAt > exp0, label + ': the idle timer was armed again');
    }
  });
}

(async () => {
  for (const [name, fn] of todo) {
    try { fn(); pass++; console.log('ok   ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n     ' + String(e && e.message).split('\n')[0]); }
  }
  console.log(`\nmoney-1008-campaign-restart: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
