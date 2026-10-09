'use strict';
// Money 1008 K5-3: five guards of the Campaign money fixes that no test held (mutants N2, N7, N8, N13, N14 of the K5 critic survived tests/campaign.js + campaign-money.js + campaign-engine.js). Plain node, exit 0 on pass.
//   G1 (N2) a cash-out sent to a run whose result is already drawn (pend), with the ledger WORKING again, must close it as drawn: a scandal pays 0, a drawn win pays the drawn multiplier.
//           (tests/campaign-money.js F1 sends that cash while the ledger still refuses every settle, so "cash refused" is true with or without the guard.)
//   G2 (N7) a run that stays open across a boot (the ledger refused the close at boot) keeps the growth table AND the map it was opened with (Money 1008 K5-2), not those of the new build; since R2D-3 it is closed to STEPS
//        (its kept draws died with the old process), so what is checked is the stored snapshot it is shown and paid on, and that the step is refused.
//   G3 (N8) a record whose pend does not pair with its run (another home / trail) is not paid as drawn.
//   G4 (N13) a surviving step whose flush failed is not on disk after another account's write and a crash.
//   G5 (N14) the store's OWN write error reaches the caller (flush() throws): the step is answered with an error and did not happen.
// usage: [TMPDIR=<scratch tmp>] node tests/money-1008-campaign-gaps.js
const fs = require('fs');
delete process.env.CAMPAIGN_TEST; delete process.env.NODE_ENV;
const H = require('./lib-campaign-ledger.js');
const { E } = H;
let R = () => 0.999999, bad = 0;
const say = (ok, what, d) => { if (!ok) bad++; console.log((ok ? 'ok    ' : 'FAIL  ') + what + (ok ? '' : '  ' + JSON.stringify(d).slice(0, 400))); };
const refuse = () => { throw Object.assign(new Error('ledger busy'), { code: 'internal' }); };
const fresh = () => { R = () => 0.999999; const w = H.world({ rng: () => R(), keys: ['ann'] }); w.fund('ann', 'play', 1e7); return w; };
const stepTo = (w, s, run, to) => H.call(w, s, 'step', { roundId: run.roundId, n: run.steps + 1, to: to || run.options.find((o) => !o.deadEnd).to });

// G1a: drawn scandal, settle refused once, ledger back, then CASH
{
  const w = fresh(), s = w.sock('ann'), pre = w.bal('ann', 'play');
  let run = H.start(w, s, 'play', 2500, 'OH').payload.run; run = stepTo(w, s, run).payload.run; run = stepTo(w, s, run).payload.run;
  R = () => 0; w.hooks.before.settle = refuse; stepTo(w, s, run); w.hooks.before = {};
  const r = H.call(w, s, 'cash', { roundId: run.roundId }), end = H.last(s, 'g:campaign:end');
  say(end && end.reason === 'scandal' && end.win === 0 && w.bal('ann', 'play') === pre - 2500 && w.escrows().length === 0, 'G1a a cash-out on a run with a drawn scandal (ledger working again) closes it as the loss it was', { r: r.error || r.payload, net: w.bal('ann', 'play') - pre });
}
// G1b: drawn dead-end win (NH -> ME), settle refused once, ledger back, then CASH: the drawn multiplier, not the one before
{
  const w = fresh(), s = w.sock('ann'), pre = w.bal('ann', 'play');
  let run = H.start(w, s, 'play', 2500, 'VT').payload.run; run = stepTo(w, s, run, 'NH').payload.run;
  const me = run.options.find((o) => o.to === 'ME');
  w.hooks.before.settle = refuse; stepTo(w, s, run, 'ME'); w.hooks.before = {};
  H.call(w, s, 'cash', { roundId: run.roundId }); const end = H.last(s, 'g:campaign:end');
  say(me && me.deadEnd && end && end.reason === 'deadend' && end.win === me.nextCashout && w.bal('ann', 'play') === pre - 2500 + me.nextCashout, 'G1b a cash-out on a run with a drawn dead-end win pays the drawn multiplier', { end, want: me && me.nextCashout, net: w.bal('ann', 'play') - pre });
}
// G2: a run kept open across a boot keeps its own growth table (R2D-3: it takes no step; its cash-out is paid at the stored multiplier)
{
  const w = fresh(), s0 = w.sock('ann');
  let run = H.start(w, s0, 'play', 2500, 'OH').payload.run; run = stepTo(w, s0, run).payload.run;
  w.crash(); w.hooks.before.settle = refuse;
  const was = E.TIERS.safe.g100; E.TIERS.safe.g100 = 150; E.TIERS.lean.g100 = 150; E.TIERS.swing.g100 = 150;       // the new build grows everything x1.50
  let st = null, kept = null;
  try {
    w.boot(); w.hooks.before = {};
    kept = w.runs.get('ann');
    if (kept) { const s = w.sock('ann'); const o = E.options(kept.run, kept.tiers, kept.map).find((x) => !x.deadEnd); st = H.call(w, s, 'step', { roundId: kept.roundId, n: kept.run.steps + 1, to: o.to }); st.want = Math.floor(run.mx * ({ safe: 104, lean: 110, swing: 130 })[o.tier] / 100); st.o = o; st.snap = kept.tiers.safe.g100; st.cash = H.call(w, s, 'cash', { roundId: kept.roundId }); }
  } finally { E.TIERS.safe.g100 = was; E.TIERS.lean.g100 = 110; E.TIERS.swing.g100 = 130; }
  say(kept && st && st.snap === 104 && st.o.nextMx === st.want && st.error && st.error.code === 'internal' && st.cash.ev === 'end' && st.cash.payload.win === Math.floor(2500 * run.mx / 100), 'G2 a run kept open across a boot keeps the growth table it was opened with (shown and paid on it), takes no step', { kept: !!kept, snap: st && st.snap, nextMx: st && st.o && st.o.nextMx, want: st && st.want, err: st && st.error, cash: st && st.cash && (st.cash.error || st.cash.payload.win) });
}
// G2b (N7 on the map): the same, for the MAP (K5-2): after a boot that left the run open, the build's map changes (TN safe -> swing, the NC-VA border is dropped); the run still steps on its own
{
  const w = fresh(), s0 = w.sock('ann'); const st = E.MAP.states;
  let run = H.start(w, s0, 'play', 2500, 'SC').payload.run; run = stepTo(w, s0, run, 'NC').payload.run;
  w.crash(); w.hooks.before.settle = refuse;
  st.TN.tier = 'swing'; st.NC.adj = st.NC.adj.filter((x) => x !== 'VA'); st.VA.adj = st.VA.adj.filter((x) => x !== 'NC');
  let kept = null, a = null, b = null;
  try {
    w.boot(); w.hooks.before = {}; kept = w.runs.get('ann');
    if (kept) { const s = w.sock('ann'); a = E.options(kept.run, kept.tiers, kept.map); b = H.call(w, s, 'step', { roundId: kept.roundId, n: kept.run.steps + 1, to: 'TN' }); b.tn = a.find((o) => o.to === 'TN'); b.cash = H.call(w, s, 'cash', { roundId: kept.roundId }); }
  } finally { st.TN.tier = 'safe'; st.NC.adj.push('VA'); st.NC.adj.sort(); st.VA.adj.push('NC'); st.VA.adj.sort(); }
  say(kept && a.some((o) => o.to === 'VA') && b && b.tn && b.tn.tier === 'safe' && b.tn.nextMx === Math.floor(run.mx * 104 / 100) && b.error && b.error.code === 'internal' && b.cash.ev === 'end' && b.cash.payload.win === Math.floor(2500 * run.mx / 100), 'G2b a run kept open across a boot keeps the map it was opened with (the dropped border still exists, TN keeps its tier), takes no step', { kept: !!kept, va: a && a.some((o) => o.to === 'VA'), tn: b && b.tn, err: b && b.error, cash: b && b.cash && (b.cash.error || b.cash.payload.win) });
}
// G3: a pend that belongs to another run (another home) is not paid
{
  const w = fresh(), s = w.sock('ann'), pre = w.bal('ann', 'play');
  let run = H.start(w, s, 'play', 2500, 'OH').payload.run; run = stepTo(w, s, run).payload.run;
  w.crash();
  const j = JSON.parse(fs.readFileSync(w.files.store, 'utf8'));
  let alien = E.newRun('VT'); alien = E.step(alien, 'NH', () => 0.999999).run; alien = E.step(alien, 'ME', () => 0.999999).run;      // a valid dead-end win of some other run: VT-NH-ME
  j.open.ann.pend = { run: alien, reason: 'deadend' }; fs.writeFileSync(w.files.store, JSON.stringify(j));
  w.boot();
  const net = w.bal('ann', 'play') - pre;
  say(alien.done === 'deadend' && net <= 0 && w.escrows().length === 0, 'G3 a record whose pend is another run\'s result is not paid as drawn', { net, alienMx: alien.mx });
}
// G4 (N13): a surviving step whose flush failed "did not happen": whatever writes the store next (here bob's start), a crash after it must pay ann the multiplier BEFORE that step
{
  R = () => 0.999999; const w = H.world({ rng: () => R(), keys: ['ann', 'bob'] }); w.fund('ann', 'play', 1e7); w.fund('bob', 'play', 1e7);
  const s = w.sock('ann'), sb = w.sock('bob'), pre = w.bal('ann', 'play');
  let run = H.start(w, s, 'play', 2500, 'OH').payload.run; run = stepTo(w, s, run).payload.run;
  const store = w.store(), real = store.flush; let n = 1; store.flush = () => { if (n-- > 0) throw new Error('disk full'); return real(); };
  const f = stepTo(w, s, run);                                             // survives, flush fails: the client is told "Server error"
  H.start(w, sb, 'play', 100, 'KY');                                       // another account's start flushes the whole store
  store.flush = real; w.reboot();
  const net = w.bal('ann', 'play') - pre, want = 2500 * run.mx / 100 - 2500;
  say(f.error && net === want, 'G4 a surviving step whose flush failed is not on disk after another write and a crash (the boot pays the multiplier before it)', { net, want, f: f.error || f.ev });
}
// G5 (N14): the store's OWN write fails (not a stubbed flush): flush() must throw, so a surviving step is answered with an error and does not advance; the tests only ever replace store.flush
{
  const w = fresh(), s = w.sock('ann');
  let run = H.start(w, s, 'play', 2500, 'OH').payload.run; run = stepTo(w, s, run).payload.run;
  const tmp = w.files.store + '.tmp'; fs.mkdirSync(tmp);                    // the tmp file of the atomic write cannot be opened (EISDIR): a real write error
  let f; try { f = stepTo(w, s, run); } finally { fs.rmdirSync(tmp); }
  const disk = w.disk().open.ann.run.steps, mem = w.runs.get('ann').run.steps;
  say(f.error && f.error.code === 'internal' && mem === 1 && disk === 1, 'G5 a real write error of campaign.json: the surviving step is answered with an error and did not happen (memory and disk at the step before)', { f: f.error || f.ev, mem, disk });
}
console.log(bad ? `\n${bad} FAILED` : '\nall ok');
process.exit(bad ? 1 : 0);
