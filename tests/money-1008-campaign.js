'use strict';
// Money 1008 hardening of CAMPAIGN TRAIL (plain node, exit 0 on pass, 1 on fail). Runs on the REAL ledger (tests/lib-campaign-ledger.js).
//   K2-Cdisk  a step whose outcome cannot be written to disk is never shown to the player: the step did not happen (error, run held), never a result that a restart forgets
//   K5-F  the QA `force` hook is Chips only: a Cash run (the STORED currency of the run) never honours it; one loud boot line when it is on
//   K5-2  an open run settles on the map it was started on: a deploy that moves a state to another tier or drops a border never changes what a run is worth at boot, and never hands a lost stake back
const assert = require('assert');
const fs = require('fs');
const H = require('./lib-campaign-ledger.js');
const { E, SRV } = H;

const eq = assert.strictEqual, deq = assert.deepStrictEqual, ok = assert.ok;
let pass = 0, fail = 0;
const todo = [];
const t = (name, fn) => todo.push([name, fn]);
const hook = (on) => { if (on) process.env.CAMPAIGN_TEST = '1'; else delete process.env.CAMPAIGN_TEST; };
const BIG = 3e9;
function world(keys = ['ann'], rng = () => 0.999999) {
  hook(false); delete process.env.CAMPAIGN_IDLE_MS; delete process.env.NODE_ENV;
  const w = H.world({ rng: () => rng(), keys });
  for (const k of keys) { w.fund(k, 'play', BIG); w.fund(k, 'chips', BIG); }
  return w;
}
const closeLines = (w, id0) => w.since(id0).filter((l) => /:close$/.test(l.ref));
const walk = (w, s, cur, bet, route) => {
  let run = H.start(w, s, cur, bet, route[0]).payload.run;
  for (const to of route.slice(1)) { const r = H.call(w, s, 'step', { roundId: run.roundId, n: run.steps + 1, to, force: 'survive' }); ok(r.ev === 'step', JSON.stringify(r.error)); run = r.payload.run; }
  return run;
};
const ROUTE = ['SC', 'NC', 'VA', 'KY', 'OH', 'PA', 'NY'];          // NC and PA swing, KY safe
const st = E.MAP.states;
const dropAir = () => { st.WA.adj = st.WA.adj.filter((x) => x !== 'AK'); st.AK.adj = st.AK.adj.filter((x) => x !== 'WA'); };
const putAir = () => { st.WA.adj.push('AK'); st.WA.adj.sort(); st.AK.adj.push('WA'); st.AK.adj.sort(); };
const CHANGES = [
  ['North Carolina swing -> lean', () => { st.NC.tier = 'lean'; }, () => { st.NC.tier = 'swing'; }, ROUTE],
  ['Kentucky safe -> lean (the new map would pay MORE)', () => { st.KY.tier = 'lean'; }, () => { st.KY.tier = 'safe'; }, ROUTE],
  ['the Alaska-Washington air link is dropped', dropAir, putAir, ['OR', 'WA', 'AK', 'HI']],
];

t('K5-2a: a map change between the crash and the boot: every open run (Cash and Chips) is paid stake x its own multiplier', () => {
  for (const cur of ['play', 'chips']) for (const [label, change, undo, route] of CHANGES) {
    const w = world(), s = w.sock('ann'); hook(true); const pre = w.bal('ann', cur), id0 = w.lastId();
    const run = walk(w, s, cur, 2500, route); ok(run.mx > 100);
    w.crash(); change();
    try { w.boot(); } finally { undo(); hook(false); }
    eq(closeLines(w, id0).map((l) => l.reason + ' ' + l.amount).join(','), `campaign:spend 2500,campaign:credit ${2500 * run.mx / 100}`, `${cur}: ${label}`);
    eq(w.bal('ann', cur), pre - 2500 + 2500 * run.mx / 100, label); eq(w.escrows().length, 0); eq(w.disk().open.ann, undefined, 'record dropped');
  }
});

t('K5-2b: a drawn scandal that was pended stays a loss when the map changes: the lost stake is never handed back', () => {
  for (const [label, change, undo] of CHANGES.slice(0, 2)) {
    let R = 0.999999; const w = world(['ann'], () => R), s = w.sock('ann'); hook(true); const pre = w.bal('ann', 'play');
    const run = walk(w, s, 'play', 2500, ROUTE); const id0 = w.lastId();
    R = 0; w.hooks.before.settle = () => { throw Object.assign(new Error('ledger busy'), { code: 'internal' }); };
    H.call(w, s, 'step', { roundId: run.roundId, n: run.steps + 1, to: run.options[0].to });
    ok(w.disk().open.ann.pend, 'the scandal is pended on disk');
    w.crash(); change();
    try { w.boot(); } finally { undo(); hook(false); }
    eq(w.bal('ann', 'play'), pre - 2500, label + ': the stake stays lost'); eq(closeLines(w, id0).map((l) => l.reason).join(','), 'campaign:spend'); eq(w.escrows().length, 0);
  }
});

t('K5-2c: the record carries the map it was started on; a run held open after a refused boot close keeps playing on that map', () => {
  const w = world(), s = w.sock('ann'); hook(true);
  const run = walk(w, s, 'play', 500, ['SC', 'NC']);
  const d = w.disk().open.ann; ok(d.map && d.map.states.NC.tier === 'swing' && d.map.states.NC.adj.includes('VA'), 'the record names the tier and the borders');
  w.crash(); st.NC.tier = 'lean'; st.VA.adj = st.VA.adj.filter((x) => x !== 'NC');
  try {
    w.hooks.before.settle = () => { throw Object.assign(new Error('busy'), { code: 'internal' }); };
    w.boot(); w.hooks.before = {};
    const rec = w.runs.get('ann'); ok(rec, 'held open');
    const opt = E.options(rec.run, rec.tiers, rec.map).find((o) => o.to === 'VA'); ok(opt, 'the dropped border still exists for this run');
    const s2 = w.sock('ann'); const r = H.call(w, s2, 'state', {}); const v = r.payload.run;
    eq(v.options.find((o) => o.to === 'VA').g100, 110, 'VA is its own tier'); eq(v.options.find((o) => o.to === 'TN').g100, 104);
    eq(rec.run.mx, run.mx);
  } finally { st.NC.tier = 'swing'; st.VA.adj.push('NC'); st.VA.adj.sort(); hook(false); }
});

t('K5-2d: a record from before the map was stored is checked on the current map; a damaged map is a refund, never a payment', () => {
  for (const how of ['no-map', 'bad-border', 'bad-tier', 'tampered-mx']) {
    const w = world(), s = w.sock('ann'); hook(true); const pre = w.bal('ann', 'play'), id0 = w.lastId();
    const run = walk(w, s, 'play', 500, ['GA', 'AL', 'MS']); w.crash();
    const d = JSON.parse(fs.readFileSync(w.files.store, 'utf8'));
    if (how === 'no-map') delete d.open.ann.map; if (how === 'bad-border') d.open.ann.map.states.GA.adj.push('ZZ'); if (how === 'bad-tier') d.open.ann.map.states.AL.tier = 'ultra'; if (how === 'tampered-mx') d.open.ann.run.mx += 1;
    fs.writeFileSync(w.files.store, JSON.stringify(d)); w.boot(); hook(false);
    if (how === 'no-map') eq(w.bal('ann', 'play'), pre - 500 + 5 * run.mx, 'paid at the stored multiplier'); else { eq(w.bal('ann', 'play'), pre, how + ': refunded'); ok(/campaign:void:unresolvable/.test(closeLines(w, id0)[0].reason)); }
  }
});

t('K5-2e: engine: snapshot() is a deep copy that mapOk accepts; mapOk refuses a damaged one; options / step / check on a snapshot do not follow later edits of E.MAP', () => {
  const snap = E.snapshot(); ok(E.mapOk(snap)); deq(Object.keys(snap.states), Object.keys(E.MAP.states));
  for (const bad of [null, [], {}, { ...snap, maxSteps: 0 }, { ...snap, states: {} }, { ...snap, landslideMx: 'x' }, { ...snap, states: { ...snap.states, GA: { tier: 'nope', adj: [] } } }, { ...snap, states: { ...snap.states, GA: { tier: 'safe', adj: ['ZZ'] } } }, { ...snap, states: { ...snap.states, GA: { tier: 'safe', adj: 'AL' } } }]) ok(!E.mapOk(bad), JSON.stringify(bad).slice(0, 60));
  let run = E.newRun('GA'); run = E.step(run, 'AL', () => 0.999999, E.TIERS, snap).run;
  st.AL.tier = 'swing'; st.GA.adj = st.GA.adj.filter((x) => x !== 'AL');
  try { eq(E.check(run, E.TIERS, snap), true); eq(E.options(run, E.TIERS, snap).length > 0, true); assert.throws(() => E.check(run), /bad_run|shape|derived|hop/); }
  finally { st.AL.tier = 'safe'; st.GA.adj.push('AL'); st.GA.adj.sort(); }
});

// ---- K2-Cdisk: a REAL disk fault (fs.writeSync throws ENOSPC for the ledger append, fs.writeFileSync(fd) for the Campaign file), on the same volume or on one of them
const fullDisk = (which) => {
  const ws = fs.writeSync, wf = fs.writeFileSync, enospc = () => Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' });
  if (which.ledger) fs.writeSync = () => { throw enospc(); };
  if (which.store) fs.writeFileSync = function (f, ...a) { if (typeof f === 'number') throw enospc(); return wf.call(this, f, ...a); };
  return () => { fs.writeSync = ws; fs.writeFileSync = wf; };
};
function diskScene(which, after) {
  let u = 0.999999; const w = world(['ann'], () => u), s = w.sock('ann'); hook(true); w.fund('ann', 'play', 100000);
  let r = H.start(w, s, 'play', 2500, 'TX'); const id = r.payload.run.roundId;
  for (let n = 1; n <= 3; n++) r = H.call(w, s, 'step', { roundId: id, n, to: r.payload.run.options[0].to });
  const run = r.payload.run, before = w.bal('ann', 'play'), to = run.options[0].to; u = 0;                // the next step draws a SCANDAL
  const heal = fullDisk(which); let x; try { x = H.call(w, s, 'step', { roundId: id, n: run.steps + 1, to }); } finally { heal(); }
  return { w, s, id, run, before, to, x, set: (v) => { u = v; } };
}
t('K2-Cdisk-a: the disk is full for the ledger AND the Campaign file: the scandal is not shown and not kept anywhere a restart forgets: the step did not happen', () => {
  const { w, s, id, run, before, to, x } = diskScene({ ledger: true, store: true });
  ok(x.error && x.error.code === 'internal', 'an error to the client'); eq(H.all(s, 'g:campaign:end').length, 0, 'no result shown'); eq(H.all(s, 'g:campaign:step').length, 3);
  const rec = w.runs.get('ann'); ok(rec && !rec.pend, 'no result held in memory'); eq(rec.run.steps, run.steps, 'the run is where it was'); eq(w.disk().open.ann.run.steps, run.steps, 'disk = memory');
  w.flush(); ok(!w.disk().open.ann.pend, 'a later write cannot persist the lost step');
  w.reboot(); eq(w.bal('ann', 'play') - before, 2500 * run.mx / 100, 'the restart pays the run as it stood (the step never happened), the scandal was never shown to anybody');
});
t('K2-Cdisk-b: after that error the same step again gets the SAME draw (a scandal): the failure is no re-roll', () => {
  const { w, s, id, run, before, to, set } = diskScene({ ledger: true, store: true });
  set(0.999999);                                                                    // a fresh draw would survive; the memo must win
  w.clock.advance(1000);                                                            // a refused step is answered once a second (R2D-2)
  const r = H.call(w, s, 'step', { roundId: id, n: run.steps + 1, to }); eq(r.ev, 'end'); eq(r.payload.reason, 'scandal'); eq(r.payload.win, 0); eq(w.bal('ann', 'play') - before, 0); eq(w.escrows().length, 0);
});
t('K2-Cdisk-c: only the Campaign file is full (the ledger works): the record write is the one probe of a step (R2D-2), so the scandal is NOT settled and not shown: same refusal as a survive, the ledger is not asked; the same step a second later lands as drawn', () => {
  const { w, s, id, run, before, to, x, set } = diskScene({ store: true });
  ok(x.error && x.error.code === 'internal', 'an error, no result'); eq(H.all(s, 'g:campaign:end').length, 0); eq(w.escrows().length, 1, 'the ledger was not asked: the stake is still in escrow');
  set(0.999999); w.clock.advance(1000);                                              // a fresh draw would survive; the kept draw wins; the disk is back
  const r = H.call(w, s, 'step', { roundId: id, n: run.steps + 1, to }); eq(r.ev, 'end'); eq(r.payload.reason, 'scandal'); eq(r.payload.win, 0); eq(w.escrows().length, 0); eq(w.bal('ann', 'play') - before, 0, 'the scandal costs the stake once');
  w.reboot(); eq(w.bal('ann', 'play') - before, 0, 'a restart forgets nothing the ledger has'); eq(w.escrows().length, 0); eq(w.audit().openRounds.length, 0);
});
t('K2-Cdisk-d: only the ledger is full (the Campaign file works): the scandal is pended on disk, a restart closes it as drawn (a loss)', () => {
  const { w, s, id, run, before, x } = diskScene({ ledger: true });
  ok(x.error, 'an error, no result'); ok(w.disk().open.ann.pend, 'the drawn scandal is on disk'); w.reboot(); eq(w.bal('ann', 'play') - before, 0); eq(w.escrows().length, 0);
});
t('K2-Cdisk-e: a surviving step on a full disk: error, the step did not happen, restart pays the stored multiplier, the same step gets the same draw', () => {
  let u = 0.999999; const w = world(['ann'], () => u), s = w.sock('ann'); hook(true);
  let r = H.start(w, s, 'play', 2500, 'TX'); const id = r.payload.run.roundId; r = H.call(w, s, 'step', { roundId: id, n: 1, to: r.payload.run.options[0].to });
  const run = r.payload.run, to = run.options[0].to, heal = fullDisk({ ledger: true, store: true }); let x; try { x = H.call(w, s, 'step', { roundId: id, n: 2, to }); } finally { heal(); }
  ok(x.error); eq(w.runs.get('ann').run.steps, 1); u = 0; w.clock.advance(1000); const y = H.call(w, s, 'step', { roundId: id, n: 2, to }); eq(y.ev, 'step', 'the memo of the surviving draw'); eq(y.payload.run.steps, 2);
});

// ---- K5-F
const raw = (w, s, ev, p) => { w.clock.advance(200); const n = s.out.length; s.send('g:campaign:' + ev, p); return s.out.slice(n); };     // no force shim: the message goes to the server as it is
const lastOf = (got) => got.filter((o) => o[0].startsWith('g:campaign:')).map((o) => ({ ev: o[0].slice(11), payload: o[1] })).pop() || { ev: null };
function forceWorld(rngv, logs) { hook(true); delete process.env.NODE_ENV; const w = H.world({ rng: () => (typeof rngv === 'function' ? rngv() : rngv), keys: ['ann', 'bob'], log: (...a) => logs.push(a.join(' ')) }); for (const k of ['ann', 'bob']) { w.fund(k, 'play', BIG); w.fund(k, 'chips', BIG); } return w; }
t('K5-F-a: with the hook ON a Cash run ignores force (survive AND scandal), pays what the unforced twin pays, and is told so in the log; a Chips run is still forced', () => {
  for (const [force, rngv, want] of [['survive', 0, 'end'], ['scandal', 0.999999, 'step']]) {                                  // rng 0 fails every step; rng 0.999999 survives every step
    const logs = [], w = forceWorld(rngv, logs), s = w.sock('ann'); const pre = w.bal('ann', 'play');
    const run = H.start(w, s, 'play', 2500, 'TX').payload.run, to = (run.options.find((o) => !o.deadEnd) || run.options[0]).to;
    const r = lastOf(raw(w, s, 'step', { roundId: run.roundId, n: 1, to, force }));
    eq(r.ev, want, 'Cash + force ' + force + ': the step is the unforced one'); if (want === 'end') { eq(r.payload.reason, 'scandal'); eq(w.bal('ann', 'play'), pre - 2500); }
    ok(logs.some((l) => /QA force .* refused on a Cash run/.test(l)), 'a line says the force was refused: ' + logs.join(' | ').slice(0, 300));
    const c = w.sock('bob'); const rc = H.start(w, c, 'chips', 2500, 'TX'); const cr = rc.payload.run;
    const forced = lastOf(raw(w, c, 'step', { roundId: cr.roundId, n: 1, to: (cr.options.find((o) => !o.deadEnd) || cr.options[0]).to, force })); eq(forced.ev, force === 'survive' ? 'step' : 'end', 'Chips is forced'); w.crash();
  }
});
t('K5-F-b: the currency is the STORED run\'s: a Cash run whose step message says mode:chips is still Cash; a run restored after a restart is Cash too', () => {
  const logs = [], w = forceWorld(0, logs), s = w.sock('ann'); const pre = w.bal('ann', 'play');
  const run = H.start(w, s, 'play', 500, 'TX').payload.run, to = (run.options.find((o) => !o.deadEnd) || run.options[0]).to;
  const r = lastOf(raw(w, s, 'step', { roundId: run.roundId, n: 1, to, force: 'survive', mode: 'chips', cur: 'chips', currency: 'chips' })); eq(r.ev, 'end'); eq(w.bal('ann', 'play'), pre - 500); w.crash();
  // a restart in between: the run comes back from the record, still a Cash run
  let R = 0.999999; const w2 = forceWorld(() => R, logs), s2 = w2.sock('ann'); const pre2 = w2.bal('ann', 'play');
  let r2 = H.start(w2, s2, 'play', 500, 'TX').payload.run; r2 = H.call(w2, s2, 'step', { roundId: r2.roundId, n: 1, to: (r2.options.find((o) => !o.deadEnd) || r2.options[0]).to }).payload.run;
  w2.crash(); w2.boot(); eq(w2.bal('ann', 'play'), pre2 - 500 + 500 * r2.mx / 100, 'a restart is a cash-out'); const s3 = w2.sock('ann');
  r2 = H.start(w2, s3, 'play', 500, 'TX').payload.run; const r3 = lastOf(raw(w2, s3, 'step', { roundId: r2.roundId, n: 1, to: (r2.options.find((o) => !o.deadEnd) || r2.options[0]).to, force: 'scandal' })); eq(r3.ev, 'step', 'force scandal on a Cash run (rng survives) does not fail it'); w2.crash();
});
t('K5-F-c: one loud boot line when the hook is on (to the log hook, or stderr when none is set); none when it is off or under production', () => {
  const count = (setup) => { const logs = []; setup(); const w = H.world({ rng: () => 0.5, keys: ['ann'], log: (...a) => logs.push(a.join(' ')) }); w.crash(); return logs.filter((l) => /QA FORCE HOOK IS ON/.test(l)).length; };
  eq(count(() => { hook(true); delete process.env.NODE_ENV; }), 1); eq(count(() => { hook(false); delete process.env.NODE_ENV; }), 0); eq(count(() => { hook(true); process.env.NODE_ENV = 'production'; }), 0); eq(count(() => { hook(true); process.env.NODE_ENV = 'test'; }), 1);
  delete process.env.NODE_ENV; hook(false);
  const w = H.world({ rng: () => 0.5, keys: ['ann'], log: (...a) => { throw new Error('boom'); } }); w.crash();                           // a log hook is never what hides the line from stderr when it is absent:
  const errs = []; const ce = console.error; console.error = (...a) => errs.push(a.join(' ')); const SRVm = H.SRV; const keep = SRVm.log;
  try { hook(true); const w2 = H.world({ rng: () => 0.5, keys: ['ann'] }); SRVm.log = undefined; SRVm.init({ rng: () => 0.5, files: {} }); } finally { console.error = ce; SRVm.log = keep; hook(false); }
  eq(errs.filter((l) => /QA FORCE HOOK IS ON/.test(l)).length, 1, 'stderr gets it when no log hook is set');
});
t('K5-F-d: the refusal line is printed for the first 5 only', () => {
  const logs = [], w = forceWorld(0.999999, logs), s = w.sock('ann'); w.fund('ann', 'play', BIG);
  let run = H.start(w, s, 'play', 100, 'TX').payload.run;
  for (let i = 0; i < 8; i++) { const r = lastOf(raw(w, s, 'step', { roundId: run.roundId, n: run.steps + 1, to: (run.options.find((o) => !o.deadEnd) || run.options[0]).to, force: 'scandal' })); if (r.ev === 'step') run = r.payload.run; else break; }
  const n = logs.filter((l) => /QA force .* refused/.test(l)).length; ok(n >= 1 && n <= 5, 'lines: ' + n);
});

(async () => {
  const only = process.argv[2];
  for (const [name, fn] of todo) {
    if (only && !name.includes(only)) continue;
    try { await fn(); pass++; console.log('ok   ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n     ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n     ')); }
  }
  console.log(`\nmoney-1008-campaign: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
