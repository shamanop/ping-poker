'use strict';
// CAMPAIGN TRAIL engine tests. Plain node script: exit 0 on pass, 1 on fail. Run: node tests/campaign-engine.js
// Maths: CAMPAIGN-MATH.md. Exact checks use BigInt rationals (no floats); the only floats are the engine's own `opt.pFail`, compared to 1e-12.
const E = require('../games/campaign-engine.js');
const { mulberry32 } = require('./soak/lib/prng.js');
const M = E.MAP;
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '-', e.message); } }
const eq = (a, b, m) => { if (a !== b) throw new Error((m || '') + ' got ' + a + ' want ' + b); };
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion'); };
const throwsCode = (fn, code) => { try { fn(); } catch (e) { if (e.code === code && e.name === 'EngineError') return; throw new Error('wrong error ' + e.name + ' ' + e.code); } throw new Error('did not throw ' + code); };
const SURVIVE = () => 0.999999, FAIL = () => 0;
const WITNESS = 'ME NH VT MA RI CT NY NJ DE MD PA WV OH MI IN IL WI MN ND MT SD IA NE KS CO WY UT ID WA AK HI CA OR NV AZ NM OK TX LA AR MO KY VA NC SC GA FL AL MS TN'.split(' ');

// ---------------------------------------------------------------- exact rationals (BigInt)
const gcd = (a, b) => { a = a < 0n ? -a : a; while (b) { [a, b] = [b, a % b]; } return a; };
const fr = (n, d = 1n) => { n = BigInt(n); d = BigInt(d); const g = gcd(n, d) || 1n; return { n: n / g, d: d / g }; };
const mul = (a, b) => fr(a.n * b.n, a.d * b.d);
const sub = (a, b) => fr(a.n * b.d - b.n * a.d, a.d * b.d);
const ONE = fr(1);
const toNum = (a) => Number(a.n) / Number(a.d);
const floorMx = (mxPrev, g100) => (BigInt(mxPrev) * BigInt(g100)) / 100n;     // BigInt division floors for positives
/* the contract written out independently of the engine: R(1) = 96/100, R(n>=2) = 1, pFail = 1 - R * mxPrev / mxNext */
const pFailRat = (n, mxPrev, mxNext) => sub(ONE, mul(n === 1 ? fr(96, 100) : ONE, fr(mxPrev, mxNext)));

// ---------------------------------------------------------------- map
const NAMES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
/* Land-border degree of each of the 48 contiguous states, typed separately from the map (Four Corners diagonals out, DE-NJ in: it is a river boundary). */
const LAND_DEG = { AL: 4, AZ: 4, AR: 6, CA: 3, CO: 6, CT: 3, DE: 3, FL: 2, GA: 5, ID: 6, IL: 5, IN: 4, IA: 6, KS: 4, KY: 7, LA: 3, ME: 1, MD: 4, MA: 5, MI: 3, MN: 4, MS: 4, MO: 8, MT: 4, NE: 6, NV: 5, NH: 3, NJ: 3, NM: 4, NY: 5, NC: 4, ND: 3, OH: 5, OK: 6, OR: 4, PA: 6, RI: 2, SC: 2, SD: 6, TN: 8, TX: 4, UT: 5, VT: 3, VA: 5, WA: 2, WV: 5, WI: 4, WY: 6 };
const isAir = (a, b) => M.air.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
const landAdj = (c) => M.states[c].adj.filter((a) => !isAir(c, a));
let EDGES = 0, LAND_EDGES = 0;

t('map: 50 states, codes and names valid', () => {
  eq(Object.keys(M.states).length, 50); eq(M.codes.length, 50);
  ok(!('DC' in M.states), 'no DC');
  for (const c of M.codes) { ok(/^[A-Z]{2}$/.test(c), c); eq(M.states[c].name, NAMES[c], c); }
  eq(Object.keys(NAMES).length, 50);
  eq(new Set(M.codes.map((c) => M.states[c].name)).size, 50);
  eq(M.codes.join(','), M.codes.slice().sort().join(','), 'codes in alphabetical = map order');
});
t('map: adjacency symmetric, no self-links, no duplicate links, only valid codes', () => {
  for (const c of M.codes) {
    const adj = M.states[c].adj;
    eq(new Set(adj).size, adj.length, c + ' duplicate');
    for (const a of adj) { ok(a !== c, 'self ' + c); ok(M.states[a], 'unknown ' + a); ok(M.states[a].adj.includes(c), 'asym ' + c + '-' + a); }
  }
});
t('map: connected (with and without the air links)', () => {
  const reach = (adjOf) => { const seen = new Set(['OH']); const q = ['OH']; while (q.length) for (const a of adjOf(q.pop())) if (!seen.has(a)) { seen.add(a); q.push(a); } return seen.size; };
  eq(reach((c) => M.states[c].adj), 50);
  eq(reach(landAdj), 48, 'land borders alone leave exactly AK and HI out');
});
t('map: edge count printed and asserted; borders checked two ways', () => {
  EDGES = M.codes.reduce((n, c) => n + M.states[c].adj.length, 0) / 2;
  LAND_EDGES = M.codes.reduce((n, c) => n + landAdj(c).length, 0) / 2;
  console.log('map edges: ' + EDGES + ' total = ' + LAND_EDGES + ' land + ' + M.air.length + ' air');
  eq(LAND_EDGES, 105, 'standard 48-state land border count (107 with DC: MD-DC, VA-DC)');
  eq(EDGES, 108);
  for (const c of Object.keys(LAND_DEG)) eq(landAdj(c).length, LAND_DEG[c], 'degree ' + c);   // way 1: every degree
  eq(M.states.TN.adj.length, 8); eq(M.states.MO.adj.length, 8); eq(M.states.ME.adj.length, 1); eq(M.states.KY.adj.length, 7);
  eq(Object.values(LAND_DEG).reduce((a, b) => a + b, 0), 210);                         // way 2: handshake sum
  eq(Object.keys(LAND_DEG).filter((c) => LAND_DEG[c] === 2).sort().join(), 'FL,RI,SC,WA');
  ok(!M.states.AZ.adj.includes('CO') && !M.states.NM.adj.includes('UT'), 'Four Corners diagonals out');
  ok(!M.states.MI.adj.includes('MN') && !M.states.NY.adj.includes('RI'), 'water-only borders out');
});
t('map: exactly three air links, flagged, and only AK/HI/WA/CA use them', () => {
  eq(M.air.length, 3);
  eq(M.air.map((p) => p.slice().sort().join('-')).sort().join(), 'AK-HI,AK-WA,CA-HI');
  eq(M.states.AK.adj.slice().sort().join(), 'HI,WA'); eq(M.states.HI.adj.slice().sort().join(), 'AK,CA');
  for (const [a, b] of M.air) ok(M.states[a].adj.includes(b) && M.states[b].adj.includes(a));
});
t('map: tier lists exactly as the contract (7 / 18 / 25) and party set', () => {
  const by = (tier) => M.codes.filter((c) => M.states[c].tier === tier);
  eq(by('swing').sort().join(' '), 'PA GA AZ WI MI NV NC'.split(' ').sort().join(' '));
  eq(by('lean').sort().join(' '), 'NH MN NJ VA NM ME CO NY IL OR DE CT RI FL TX OH IA AK'.split(' ').sort().join(' '));
  eq(by('swing').length, 7); eq(by('lean').length, 18); eq(by('safe').length, 25);
  for (const c of M.codes) { ok(['R', 'D', 'S'].includes(M.states[c].party), c); eq(M.states[c].party === 'S', M.states[c].tier === 'swing', c); }
  eq(M.codes.filter((c) => M.states[c].party === 'R').length, 24); eq(M.codes.filter((c) => M.states[c].party === 'D').length, 19);
  eq(JSON.stringify(E.TIERS), JSON.stringify({ safe: { g100: 104 }, lean: { g100: 110 }, swing: { g100: 130 } }));
});

// ---------------------------------------------------------------- constants and the walker used by the exact tests
t('constants', () => {
  eq(E.RTP_BPS, 9600); eq(E.LANDSLIDE_MX, 100000); eq(E.CAP_MX, 1000000); eq(E.MAX_STEPS, 49); eq(E.BET_LEVELS.join(), '100,200,500,1000,2500');
  ok(E.VERSION >= 1); eq(typeof E.EngineError, 'function');
});

/* checks one option taken from `run` at step n = run.steps + 1 against the independent exact contract; returns the survive probability factor */
function checkOption(run, o, P) {
  const n = run.steps + 1;
  const mxNext = n === 49 ? 100000n : floorMx(run.mx, E.TIERS[M.states[o.to].tier].g100);
  eq(BigInt(o.nextMx), mxNext, 'nextMx ' + run.trail.join('') + o.to);
  ok(o.nextMx > run.mx, 'mx must grow');
  const f = pFailRat(n, run.mx, o.nextMx);
  ok(f.n > 0n && f.n < f.d, 'exact 0 < pFail < 1');
  ok(o.pFail > 0 && o.pFail < 1, 'float 0 < pFail < 1');
  ok(Math.abs(o.pFail - toNum(f)) < 1e-12, 'float pFail vs rational: ' + o.pFail + ' ' + toNum(f));
  ok(o.pFail < 0.999999, 'rng 0.999999 must always survive');
  const P2 = mul(P, sub(ONE, f));
  eq(P2.n * BigInt(o.nextMx), 96n * P2.d, 'P(survive) * mx == 96 at ' + run.trail.join('') + '>' + o.to);
  return P2;
}
let nodesChecked = 0;
function enumerate(run, P, depth) {
  if (depth === 0 || run.done) return;
  for (const o of E.options(run)) {
    const P2 = checkOption(run, o, P); nodesChecked++;
    enumerate(E.step(run, o.to, SURVIVE).run, P2, depth - 1);
  }
}
t('RTP identity, EXACT: all routes to depth 5 from 12 homes (swing, lean, safe, ME, AK, HI)', () => {
  const homes = ['PA', 'GA', 'WI', 'OH', 'TX', 'NH', 'WY', 'MO', 'TN', 'ME', 'AK', 'HI', 'RI', 'FL'];
  nodesChecked = 0;
  for (const h of homes) enumerate(E.newRun(h), ONE, 5);
  const named = nodesChecked;
  for (const h of M.codes) enumerate(E.newRun(h), ONE, 5);   // and every state as a home
  console.log('enumerated prefixes checked exactly: ' + named + ' from ' + homes.length + ' named homes, ' + (nodesChecked - named) + ' more from all 50 homes (depth 5)');
  ok(named > 10000 && nodesChecked > 50000);
});
t('RTP identity, EXACT: 20,000 seeded random routes of random length (to the end of the run)', () => {
  const rng = mulberry32(20261007); let prefixes = 0, lmax = 0, fullLen = 0;
  for (let i = 0; i < 20000; i++) {
    let run = E.newRun(rng.pick(M.codes)), P = ONE;
    const len = rng.range(1, 49);
    while (!run.done && run.steps < len) {
      const opts = E.options(run), o = opts[rng.int(opts.length)];
      P = checkOption(run, o, P); prefixes++;
      run = E.step(run, o.to, SURVIVE).run;
      if (run.mx > lmax && run.done !== 'landslide') lmax = run.mx;
    }
    if (run.steps >= 40) fullLen++;
  }
  console.log('random route prefixes checked exactly: ' + prefixes + ' (routes reaching 40+ steps: ' + fullLen + ', largest mx before a landslide seen: ' + lmax + ')');
});

// ---------------------------------------------------------------- bounds
t('floor always grows; 0 < pFail < 1 for every reachable mxPrev, every tier, first step and later steps', () => {
  for (const tier of Object.keys(E.TIERS)) for (let mx = 100; mx < 100000; mx++) {
    const nx = Number(floorMx(mx, E.TIERS[tier].g100));
    if (nx <= mx) throw new Error('no growth ' + tier + ' ' + mx);
    const f = E.pFail(mx, nx, 2); if (!(f > 0 && f < 1)) throw new Error('later ' + tier + ' ' + mx);
  }
  for (const tier of Object.keys(E.TIERS)) { const nx = E.TIERS[tier].g100; const f = E.pFail(100, nx, 1); ok(f > 0 && f < 1, tier); eq(Number(floorMx(100, nx)), nx); }
  eq(Number(floorMx(100, 104)), 104);
  for (let mx = 100; mx < 100000; mx++) { const f = E.pFail(mx, 100000, 49); if (!(f > 0 && f < 1)) throw new Error('landslide ' + mx); }
});
t('bound: largest mx before step 49 is below LANDSLIDE_MX; nothing exceeds CAP_MX', () => {
  // 48 steps before the 49th, home and the last state are outside the product. Worst case: all 7 swing, all 18 lean, 23 safe (home and last are safe).
  const worst = 100 * Math.pow(1.3, 7) * Math.pow(1.1, 18) * Math.pow(1.04, 23);
  console.log('worst-case mx before the landslide step: ' + worst.toFixed(1) + ' (' + (worst / 100).toFixed(2) + 'x), floors only lower it');
  ok(worst < 10000, 'under 100x'); ok(worst < E.LANDSLIDE_MX); ok(E.LANDSLIDE_MX <= E.CAP_MX);
  // exact version with floors: swing first (floors lose least at high mx), then lean, then safe, and the reverse; both are below the real-number bound
  for (const order of [[['swing', 7], ['lean', 18], ['safe', 23]], [['safe', 23], ['lean', 18], ['swing', 7]]]) {
    let mx = 100; for (const [tier, k] of order) for (let i = 0; i < k; i++) mx = Number(floorMx(mx, E.TIERS[tier].g100));
    ok(mx <= worst && mx < E.LANDSLIDE_MX, 'ordered product ' + mx);
  }
  // pFail of the landslide step on the witness
  let r = E.newRun(WITNESS[0]); for (const to of WITNESS.slice(1, 49)) r = E.step(r, to, SURVIVE).run;
  eq(r.steps, 48); const last = E.options(r)[0]; eq(last.nextMx, 100000); ok(Math.abs(last.pFail - (1 - r.mx / 100000)) < 1e-12);
  console.log('witness: mx after 48 steps = ' + r.mx + ', landslide step pFail = ' + last.pFail.toFixed(6) + ' (1 in ' + (1 / (1 - last.pFail)).toFixed(1) + ' to win)');
});

// ---------------------------------------------------------------- LANDSLIDE witness
t('LANDSLIDE witness: a stored route through all 50 states, ME at an end, walks to 1000x and pays bet * 1000', () => {
  eq(WITNESS.length, 50); eq(new Set(WITNESS).size, 50);
  ok(WITNESS[0] === 'ME' || WITNESS[49] === 'ME', 'Maine is an end');
  for (let i = 1; i < 50; i++) ok(M.states[WITNESS[i - 1]].adj.includes(WITNESS[i]), 'hop ' + WITNESS[i - 1] + WITNESS[i]);
  let r = E.newRun(WITNESS[0]), n = 0;
  const rng = () => { n++; return 0.999999; };
  for (const to of WITNESS.slice(1)) { ok(!r.done); const s = E.step(r, to, rng); ok(s.ok); r = s.run; }
  eq(n, 49); eq(r.done, 'landslide'); eq(r.mx, 100000); eq(r.steps, 49); eq(r.trail.length, 50); eq(E.options(r).length, 0);
  for (const b of E.BET_LEVELS) eq(E.payout(r, b), b * 1000);
  eq(E.payout(r, 2500), 2500000); E.check(JSON.parse(JSON.stringify(r)));
  // forcing a scandal on the last step loses
  let q = E.newRun(WITNESS[0]); for (const to of WITNESS.slice(1, 49)) q = E.step(q, to, SURVIVE).run;
  const lost = E.step(q, WITNESS[49], FAIL); eq(lost.ok, false); eq(lost.run.done, 'scandal'); eq(E.payout(lost.run, 100), 0);
  // the same route reversed (ME last) is also a witness
  const rev = WITNESS.slice().reverse(); let v = E.newRun(rev[0]); for (const to of rev.slice(1)) v = E.step(v, to, SURVIVE).run; eq(v.done, 'landslide');
});

// ---------------------------------------------------------------- step()
function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; }
t('step(): exactly one rng draw, never mutates (deep-frozen input), no aliasing', () => {
  const rng = mulberry32(5); let draws = 0; const counted = () => { draws++; return rng(); };
  let run = E.newRun('OH');
  for (let i = 0; i < 200; i++) {
    if (run.done) run = E.newRun(rng.pick(M.codes));
    deepFreeze(run); const before = JSON.stringify(run), opts = E.options(run), d0 = draws;
    eq(JSON.stringify(opts), JSON.stringify(E.options(run)), 'options is pure');
    const s = E.step(run, opts[rng.int(opts.length)].to, counted);
    eq(draws - d0, 1, 'one draw'); eq(JSON.stringify(run), before, 'input untouched');
    ok(s.run !== run && s.run.trail !== run.trail, 'new objects');
    run = s.run;
  }
});
t('step(): scandal leaves at / trail / mx unchanged and sets failedAt; success advances', () => {
  const run = deepFreeze(E.newRun('GA')); const s = E.step(run, 'AL', FAIL);
  eq(s.ok, false); eq(s.run.done, 'scandal'); eq(s.run.failedAt, 'AL'); eq(s.run.at, 'GA'); eq(s.run.mx, 100); eq(s.run.steps, 0);
  eq(s.run.trail.join(), 'GA'); eq(s.opt.to, 'AL');
  const w = E.step(run, 'AL', SURVIVE); eq(w.ok, true); eq(w.run.at, 'AL'); eq(w.run.trail.join(), 'GA,AL'); eq(w.run.mx, 104); eq(w.run.steps, 1); eq(w.run.failedAt, undefined);
  eq(w.opt.nextMx, 104);
});
t('step(): named errors, no rng draw on an error', () => {
  let draws = 0; const rng = () => { draws++; return 0.5; };
  const run = E.newRun('OH'), after = E.step(run, 'IN', SURVIVE).run, dead = E.step(run, 'IN', FAIL).run;
  throwsCode(() => E.step(run, 'TX', rng), 'bad_step');        // not a neighbour
  throwsCode(() => E.step(run, 'OH', rng), 'bad_step');        // itself
  throwsCode(() => E.step(after, 'OH', rng), 'bad_step');      // visited state
  throwsCode(() => E.step(dead, 'KY', rng), 'bad_step');       // done run
  throwsCode(() => E.step(run, 'XX', rng), 'bad_step'); throwsCode(() => E.step(run, undefined, rng), 'bad_step'); throwsCode(() => E.step(run, 'constructor', rng), 'bad_step');
  throwsCode(() => E.newRun('XX'), 'bad_home'); throwsCode(() => E.newRun('DC'), 'bad_home'); throwsCode(() => E.newRun(), 'bad_home');
  throwsCode(() => E.newRun('toString'), 'bad_home'); throwsCode(() => E.newRun('__proto__'), 'bad_home'); throwsCode(() => E.newRun(['OH']), 'bad_home');
  eq(draws, 0);
});
t('dead end: option marked before, run done afterwards, auto cash-out value', () => {
  const run = E.newRun('NH'); const me = E.options(run).find((o) => o.to === 'ME');
  eq(me.deadEnd, true); eq(E.options(run).filter((o) => o.deadEnd).length, 1);
  const s = E.step(run, 'ME', SURVIVE); eq(s.run.done, 'deadend'); eq(s.run.mx, 110);   // ME is lean
  eq(E.options(s.run).length, 0); eq(E.payout(s.run, 500), 550); E.check(s.run);
  throwsCode(() => E.step(s.run, 'NH', SURVIVE), 'bad_step');
  // a dead end that is made by the trail, not by the map: RI after CT and MA are visited
  let r = E.newRun('CT'); r = E.step(r, 'MA', SURVIVE).run; const ri = E.options(r).find((o) => o.to === 'RI'); eq(ri.deadEnd, true); eq(E.step(r, 'RI', SURVIVE).run.done, 'deadend');
  eq(E.options(E.newRun('CT')).find((o) => o.to === 'RI').deadEnd, false);
  // landslide step is not flagged deadEnd
  let q = E.newRun(WITNESS[0]); for (const to of WITNESS.slice(1, 49)) q = E.step(q, to, SURVIVE).run;
  const l = E.options(q)[0]; eq(l.landslide, true); eq(l.deadEnd, false);
});
t('options(): unvisited neighbours in map order, empty when done; flags consistent', () => {
  const rng = mulberry32(77); let ends = 0, deadends = 0;
  for (let i = 0; i < 3000; i++) {
    let run = E.newRun(rng.pick(M.codes));
    while (!run.done) {
      const opts = E.options(run), want = M.states[run.at].adj.filter((a) => !run.trail.includes(a));
      eq(opts.map((o) => o.to).join(), want.join()); ok(opts.length >= 1);
      const o = opts[rng.int(opts.length)], s = E.step(run, o.to, SURVIVE).run;
      eq(s.done === 'deadend', o.deadEnd); eq(s.done === 'landslide', o.landslide); if (o.deadEnd) { deadends++; eq(E.options(s).length, 0); }
      if (!s.done) ok(E.options(s).length > 0, 'a live run always has an option');
      run = s;
    }
    eq(E.options(run).length, 0); ends++;
  }
  console.log('random walks: ' + ends + ' ran to the end, ' + deadends + ' dead ends flagged beforehand');
});

// ---------------------------------------------------------------- payout, check, threshold
t('payout(): exact for every bet level, throws at 0 steps, 0 on a scandal, always a safe integer', () => {
  const rng = mulberry32(99);
  for (let i = 0; i < 3000; i++) {
    let run = E.newRun(rng.pick(M.codes)); const k = rng.range(1, 30);
    while (!run.done && run.steps < k) { const o = E.options(run); run = E.step(run, o[rng.int(o.length)].to, SURVIVE).run; }
    for (const b of E.BET_LEVELS) { const p = E.payout(run, b); ok(Number.isSafeInteger(p)); eq(BigInt(p) * 100n, BigInt(b) * BigInt(run.mx), 'exact'); }
    const o = E.options(run); if (o.length) { const lost = E.step(run, o[0].to, FAIL).run; for (const b of E.BET_LEVELS) eq(E.payout(lost, b), 0); }
  }
  for (const b of E.BET_LEVELS) throwsCode(() => E.payout(E.newRun('OH'), b), 'bad_run');
  eq(E.payout(E.step(E.newRun('OH'), 'IN', SURVIVE).run, 100), 104); eq(E.payout(E.step(E.newRun('OH'), 'IN', SURVIVE).run, 2500), 2600);
  const first = E.step(E.newRun('OH'), 'IN', FAIL).run; eq(E.payout(first, 100), 0);
  throwsCode(() => E.payout(E.step(E.newRun('OH'), 'IN', SURVIVE).run, 1), 'bad_bet');   // 1 * 104 / 100 is not whole units
});
t('check(): accepts every engine-made run (JSON round trip), rejects tampering', () => {
  const rng = mulberry32(31337); let n = 0;
  for (let i = 0; i < 4000; i++) {
    let run = E.newRun(rng.pick(M.codes)); const k = rng.range(0, 49);
    while (!run.done && run.steps < k) { const o = E.options(run); run = E.step(run, o[rng.int(o.length)].to, rng.chance(0.97) ? SURVIVE : FAIL).run; }
    eq(E.check(JSON.parse(JSON.stringify(run))), true); n++;
  }
  const good = JSON.parse(JSON.stringify(E.step(E.step(E.newRun('OH'), 'IN', SURVIVE).run, 'IL', SURVIVE).run));
  eq(E.check(good), true);
  const mut = (f) => { const r = JSON.parse(JSON.stringify(good)); f(r); return r; };
  throwsCode(() => E.check(mut((r) => { r.mx += 1; })), 'bad_run');                 // tampered mx
  throwsCode(() => E.check(mut((r) => { r.mx = 100000; })), 'bad_run');
  throwsCode(() => E.check(mut((r) => { r.trail[2] = 'WY'; r.at = 'WY'; })), 'bad_run');   // non-border hop
  throwsCode(() => E.check(mut((r) => { r.trail[2] = 'OH'; r.at = 'OH'; })), 'bad_run');   // repeated state
  throwsCode(() => E.check(mut((r) => { r.steps = 3; })), 'bad_run');               // wrong steps
  throwsCode(() => E.check(mut((r) => { r.steps = 1; })), 'bad_run');
  throwsCode(() => E.check(mut((r) => { r.at = 'IN'; })), 'bad_run');
  throwsCode(() => E.check(mut((r) => { r.home = 'IN'; })), 'bad_run');
  throwsCode(() => E.check(mut((r) => { r.done = 'landslide'; })), 'bad_run');      // claims a landslide at 2 steps
  throwsCode(() => E.check(mut((r) => { r.done = 'deadend'; })), 'bad_run');
  throwsCode(() => E.check(mut((r) => { r.done = 'cashout'; })), 'bad_run');
  throwsCode(() => E.check(mut((r) => { r.done = 'scandal'; })), 'bad_run');        // scandal without failedAt
  throwsCode(() => E.check(mut((r) => { r.trail = 'OH,IN,IL'; })), 'bad_run');
  throwsCode(() => E.check(mut((r) => { r.trail = []; })), 'bad_run');
  throwsCode(() => E.check(mut((r) => { r.trail.push('XX'); r.steps = 3; })), 'bad_run');
  throwsCode(() => E.check(mut((r) => { r.v = 99; })), 'bad_run');
  throwsCode(() => E.check(null), 'bad_run'); throwsCode(() => E.check({}), 'bad_run'); throwsCode(() => E.check('x'), 'bad_run');
  const sc = JSON.parse(JSON.stringify(E.step(E.newRun('OH'), 'IN', FAIL).run)); eq(E.check(sc), true);
  throwsCode(() => E.check({ ...sc, failedAt: 'TX' }), 'bad_run'); throwsCode(() => E.check({ ...sc, failedAt: 'OH' }), 'bad_run');
  // a live run whose options are exhausted must have been closed
  let dead = E.newRun('NH'); dead = JSON.parse(JSON.stringify(E.step(dead, 'ME', SURVIVE).run)); eq(E.check(dead), true);
  throwsCode(() => E.check({ ...dead, done: null }), 'bad_run');
  console.log('check() accepted ' + n + ' engine-made runs');
});
t('outcome threshold: rng() < pFail fails, rng() === pFail survives, 0 always fails, 0.999999 always survives', () => {
  const rng = mulberry32(2); let seen = 0;
  for (let i = 0; i < 3000; i++) {
    const run = E.newRun(rng.pick(M.codes));
    for (const o of E.options(run)) {
      eq(E.step(run, o.to, () => o.pFail).ok, true, 'equal survives');
      eq(E.step(run, o.to, () => Math.max(0, o.pFail - 1e-9)).ok, false, 'just below fails');
      eq(E.step(run, o.to, () => 0).ok, false); eq(E.step(run, o.to, () => 0.999999).ok, true); seen++;
    }
  }
  // later steps and the landslide step as well
  let r = E.newRun(WITNESS[0]);
  for (const to of WITNESS.slice(1)) { const o = E.options(r).find((x) => x.to === to); eq(E.step(r, to, () => o.pFail).ok, true); eq(E.step(r, to, () => 0).ok, false); r = E.step(r, to, SURVIVE).run; }
});

// ---------------------------------------------------------------- statistics
t('z-test: scandal frequency per tier and step class over 200,000 seeded steps matches pFail', () => {
  const rng = mulberry32(424242), cls = {};
  let steps = 0;
  while (steps < 200000) {
    let run = E.newRun(rng.pick(M.codes));
    while (!run.done && steps < 200000) {
      const opts = E.options(run), o = opts[rng.int(opts.length)];
      const s = E.step(run, o.to, rng); steps++;
      const key = o.tier + (run.steps === 0 ? ' first' : o.landslide ? ' landslide' : ' later'), c = cls[key] || (cls[key] = { n: 0, fails: 0, e: 0, v: 0 });
      c.n++; c.e += o.pFail; c.v += o.pFail * (1 - o.pFail); if (!s.ok) c.fails++;
      run = s.run;
    }
  }
  for (const key of Object.keys(cls).sort()) {
    const c = cls[key]; if (c.n < 200) { console.log('  ' + key + ': n=' + c.n + ' (too few for a z-test)'); continue; }
    const z = (c.fails - c.e) / Math.sqrt(c.v);
    console.log('  ' + key.padEnd(13) + ' n=' + String(c.n).padStart(6) + ' scandals ' + String(c.fails).padStart(6) + ' expected ' + c.e.toFixed(1).padStart(8) + ' z=' + z.toFixed(2));
    ok(Math.abs(z) < 4, key + ' z=' + z);
  }
});

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
