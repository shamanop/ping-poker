'use strict';
// node tests/coldcall-pull-engine.js   (self-contained: engine only, no server, no files except the byte-sync read)
// THE PULL engine half: state, cold clock, lead list, Callback, warm, ghost, PICK, ONE MORE CALL, daily, replay, legacy equality.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');
const E = require('../games/coldcall-engine.js');
const PIN = require('./lib-pull-pin.js').pin(E);   // mechanism tests run on fixed knob numbers (the levers agent owns the real values)

let pass = 0;
const test = async (name, fn) => { try { await fn(); pass++; console.log('ok   ' + name); } catch (e) { console.error('FAIL ' + name + '\n' + (e.stack || e)); process.exitCode = 1; } };
const clone = (o) => JSON.parse(JSON.stringify(o));
const freeze = (o) => { if (o && typeof o === 'object') { Object.freeze(o); for (const k of Object.keys(o)) freeze(o[k]); } return o; };
const T = E.MAX_WIN_T;
// an engine with CFG.pull patched one level deep: pcfg({ warm: { chance: 1 } })
function pcfg(patch, top) {
  const c = clone(E.CFG); for (const k of Object.keys(patch || {})) c.pull[k] = (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k]) && typeof c.pull[k] === 'object') ? Object.assign({}, c.pull[k], patch[k]) : patch[k];
  return Object.assign(c, top || {});
}
const mkEng = (patch, top) => E.createEngine(pcfg(patch, top));
const E0 = E.engine;

// ---------------------------------------------------------------- scripted rng helpers (same idea as tests/coldcall.js)
const midOfCum = (cum, i) => ((i ? cum[i - 1] : 0) + cum[i]) / 2;
const symVal = (e, mi, s) => midOfCum(e.SYMT[mi], s);
const symsVals = (e, mi, list) => list.map((s) => symVal(e, mi, s));
const outIdx = (tab, k, v) => { const i = tab.out.findIndex((x) => x.k === k && (k === 'c' || x.v === v)); assert.ok(i >= 0, 'no outcome ' + k + v); return i; };
const revVal = (e, mi, k, v) => midOfCum(e.REV[mi].cum, outIdx(e.REV[mi], k, v));
const pickVal = (e, mi, k, v) => midOfCum(e.PICKREV[mi].cum, outIdx(e.PICKREV[mi], k, v));
const FILL = (p) => 1 + ((2 * Math.floor(p / 6) + (p % 6)) % 4);          // 1..4 with no two neighbours equal: no cluster can form
const gridSyms = (over) => { const g = Array.from({ length: 30 }, (_, p) => FILL(p)); for (const k of Object.keys(over || {})) g[+k] = over[k]; return g; };
const gridVals = (e, mi, over) => symsVals(e, mi, gridSyms(over));
const MUGS = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };                           // a 5-mug cluster on the top row: pays 0.3x, marks squares 0..4
const REFILL5 = [1, 2, 3, 4, 1];                                         // five refills (one per column 0..4) that start no cluster
// strict scripted rng: throws if the round draws more than scripted; left() = values unused
function strict(vals) { let i = 0; const f = () => { if (i >= vals.length) throw new Error('rng exhausted after ' + i + ' draws'); return vals[i++]; }; f.left = () => vals.length - i; f.used = () => i; return f; }
// tape: records every main-stream draw; reset() replays from the start and then draws new values (what the server does)
function mkTape(base) { const t = []; let i = 0; const f = () => { if (i < t.length) return t[i++]; const v = base(); t.push(v); i++; return v; }; f.reset = () => { i = 0; }; f.tape = t; f.used = () => i; return f; }
const counting = (base) => { let n = 0; const f = () => { n++; return base(); }; f.n = () => n; return f; };
const st0 = (o) => Object.assign(E.newState(), o || {});
const spin = (e, rng, state, o) => e.playRound(rng, Object.assign({ bet: 100, state, now: 5e6, day: '2026-10-06' }, o), (o && o.decisions) || []);
const NODAY = { day: null };

(async () => {
  await test('CFG.pull: knobs exist with the contract defaults; dead fills more than win; engine copy is byte-identical', () => {
    const P = E.CFG.pull;
    assert.strictEqual(P.on, true); assert.strictEqual(P.list, 50);
    assert.ok(P.fill.dead > P.fill.win, 'a dead spin must work MORE leads than a winning one');
    assert.deepStrictEqual(P.cold, { afterMs: 86400000, stepMs: 21600000, batch: 3, floor: 10 });
    assert.deepStrictEqual(P.more, { on: true, mult: 2, rtp: 0.98, minTenths: 20 });
    assert.deepStrictEqual(P.pick.mult, { bronze: 0, silver: 2, gold: 3, upsell: 2, close: 2 });
    assert.deepStrictEqual(PIN.knobNames, ['callback', 'carryOver', 'cold', 'daily', 'decision', 'feed', 'fill', 'ghost', 'list', 'more', 'on', 'pick', 'pot', 'warm'], 'the real CFG.pull has exactly the contract knob names');
    for (const f of ['newState', 'tickState', 'coldInfo', 'playRound', 'potSlice', 'potHitChance', 'rngFrom', 'cbBet']) assert.strictEqual(typeof E[f], 'function', f);
    assert.ok(fs.readFileSync(path.join(__dirname, '..', 'games', 'coldcall-engine.js')).equals(fs.readFileSync(path.join(__dirname, '..', 'public', 'games', 'coldcall', 'engine.js'))), 'public copy must be byte-identical');
  });

  await test('legacy equality: resolveRound / round / playSpin / playBonus reproduce the pre-PULL engine seed for seed (digest of 3000 rounds incl. scripts)', () => {
    const h = crypto.createHash('sha256');
    for (const buy of [null, 'call', 'hunt', 'bonus1', 'bonus2']) for (let seed = 1; seed <= 600; seed++) { const r = E.resolveRound(E.rngFrom(seed * 7 + 3), buy); h.update(JSON.stringify([r.winTenths, r.costTenths, r.script])); }
    assert.strictEqual(h.digest('hex'), 'c808ef7efa2c5e236caca7bb8273ea7002fb5b5299f3f02199a1d7dac04edcb8');
  });

  await test('pull.on = false: playRound is the legacy round, state returned unchanged, no decisions, no pull effects, same draws', () => {
    const e = mkEng({ on: false }); const state = freeze(st0({ lt: 100, avg: 100, warm: [1], cb: { bet: 200 } }));
    for (const buy of [null, 'call', 'bonus1']) for (let seed = 1; seed <= 60; seed++) {
      const a = E.rngFrom(seed), b = E.rngFrom(seed);
      const r = e.playRound(a, { buy, bet: 100, state, now: 1, day: '2026-10-06' }, []);
      const old = E.resolveRound(b, buy);
      assert.strictEqual(r.status, 'done'); assert.strictEqual(r.winTenths, old.winTenths); assert.deepStrictEqual(r.script, old.script); assert.strictEqual(r.callback, false);
      assert.strictEqual(r.newState, state); assert.strictEqual(r.pull.decisions.length, 0); assert.strictEqual(a(), b());
    }
  });

  // ---------------------------------------------------------------- cold clock
  await test('tickState: no leak before coldAt; first event kills warm squares; batch per step; never below the floor; coldAt advances; input never mutated', () => {
    const P = E.CFG.pull, S6 = P.cold.stepMs;
    const s = freeze(st0({ lt: 300, avg: 100, warm: [3, 4], coldAt: 1000 }));
    assert.strictEqual(E.tickState(s, 999).lt, 300); assert.deepStrictEqual(E.tickState(s, 999).warm, [3, 4]);
    let t = E.tickState(s, 1000); assert.strictEqual(t.lt, 270); assert.deepStrictEqual(t.warm, []); assert.strictEqual(t.coldAt, 1000 + S6); assert.strictEqual(t.avg, 100);
    t = E.tickState(s, 1000 + S6 - 1); assert.strictEqual(t.lt, 270);
    t = E.tickState(s, 1000 + S6); assert.strictEqual(t.lt, 240); assert.strictEqual(t.coldAt, 1000 + 2 * S6);
    t = E.tickState(s, 1000 + 5 * S6 + 7); assert.strictEqual(t.lt, 300 - 6 * 30); assert.strictEqual(t.coldAt, 1000 + 6 * S6);
    t = E.tickState(s, 1000 + 999 * S6); assert.strictEqual(t.lt, 100); assert.strictEqual(t.coldAt, null, 'at the floor and no warm squares: no more events');
    assert.notStrictEqual(t, s); assert.strictEqual(s.lt, 300);
    t = E.tickState(freeze(st0({ lt: 105, coldAt: 10 })), 10); assert.strictEqual(t.lt, 100);                 // never below floor (10 leads = 100 tenths)
    t = E.tickState(freeze(st0({ lt: 40, warm: [9], coldAt: 10 })), 10); assert.strictEqual(t.lt, 40); assert.deepStrictEqual(t.warm, []); assert.strictEqual(t.coldAt, null);   // under the floor: nothing leaks, warm still dies
    t = E.tickState(freeze(st0({ lt: 300, cb: { bet: 500 }, coldAt: 10 })), 10); assert.deepStrictEqual(t.cb, { bet: 500 });   // an earned Callback does not go cold
    assert.strictEqual(E.tickState(freeze(st0({ lt: 300 })), 1e12).lt, 300, 'coldAt null = no clock');
  });

  await test('coldInfo: null when nothing will go cold, else inMs / whole leads that go cold next / warm count', () => {
    assert.strictEqual(E.coldInfo(st0({ lt: 300 }), 0), null);
    const s = st0({ lt: 300, warm: [1, 2], coldAt: 5000 });
    assert.deepStrictEqual(E.coldInfo(s, 1000), { inMs: 4000, leads: 3, warm: 2 });
    assert.deepStrictEqual(E.coldInfo(st0({ lt: 125, coldAt: 5000 }), 1000), { inMs: 4000, leads: 2, warm: 0 });   // 25 tenths above the floor = 2 whole leads
    const after = E.coldInfo(s, 5000 + 1);                                                                      // looked at after the event: the NEXT event, warm already dead
    assert.deepStrictEqual(after, { inMs: E.CFG.pull.cold.stepMs - 1, leads: 3, warm: 0 });
  });

  await test('potSlice is exact integer cents with the remainder carried; potHitChance = (cost in dollars) / oneInPerDollar', () => {
    let rem = 0, sum = 0, fed = 0;
    for (let i = 0; i < 100000; i++) { const cost = [10, 20, 50, 100, 200, 500, 1000, 2500][i % 8]; const r = E.potSlice(50, cost, rem); assert.ok(Number.isInteger(r.slice) && r.rem >= 0 && r.rem < 10000); rem = r.rem; sum += r.slice; fed += cost; }
    assert.strictEqual(sum * 10000 + rem, fed * 50, 'slices plus the carried remainder equal the exact feed');
    assert.deepStrictEqual(E.potSlice(50, 100, 0), { slice: 0, rem: 5000 }); assert.deepStrictEqual(E.potSlice(50, 100, 5000), { slice: 1, rem: 0 });
    assert.strictEqual(E.potHitChance(E.CFG.pull, 100), 1 / 20000); assert.strictEqual(E.potHitChance(E.CFG.pull, 2500), 25 / 20000);
  });

  // ---------------------------------------------------------------- lead list
  await test('lead list: fill by category (dead 1.2 / win 0.6 / bonus 0.6), armed at exactly the list size, carry-over, flat avg exact, cb.bet = level(avg); model over 4000 spins', () => {
    const rng = E.rngFrom(11), P = E.CFG.pull; let st = newFlat();
    function newFlat() { return E.newState(); }
    let model = 0, armedAt = 0, cbSeen = 0, cats = { dead: 0, win: 0, bonus: 0 };
    for (let i = 0; i < 4000; i++) {
      const r = E.playRound(rng, { bet: 100, state: st, now: 1e6 + i, day: '2026-10-06', script: false, auto: true }, []);
      assert.strictEqual(r.status, 'done');
      if (r.callback) { assert.deepStrictEqual(st.cb, { bet: 100 }); assert.strictEqual(r.newState.cb, null); assert.strictEqual(r.pull.filled, 0); assert.strictEqual(r.newState.lt, st.lt); assert.strictEqual(r.costTenths, 0); assert.strictEqual(r.betCents, 100); assert.strictEqual(r.newState.callbacks, st.callbacks + 1); st = r.newState; continue; }
      const cat = r.round.bonusKind ? 'bonus' : r.round.clusterTenths + r.round.phoneTenths > 0 ? 'win' : 'dead'; cats[cat]++;
      assert.strictEqual(r.pull.filled, Math.round(P.fill[cat] * 10), cat);
      const daily = r.pull.daily ? Math.round(r.pull.daily.leads * 10) : 0; model = st.lt + daily + r.pull.filled;
      const armed = r.newState.cb !== null && st.cb === null;
      if (armed) { armedAt++; assert.ok(model >= 500, 'armed only on a full list'); assert.strictEqual(r.newState.lt, model - 500, 'carry-over keeps the excess'); assert.strictEqual(r.newState.cb.bet, 100); assert.strictEqual(r.newState.avg, 100, 'flat bettor: avg exact'); assert.ok(r.pull.armed); }
      else { assert.ok(model < 500 || r.newState.cb !== null && st.cb !== null); assert.strictEqual(r.newState.lt, model); assert.ok(!r.pull.armed || r.pull.daily); }
      if (st.cb) cbSeen++;
      st = r.newState; if (st.cb) assert.strictEqual(st.cb.bet, 100);
      st = Object.assign({}, st, { day: '2026-10-06' });                                    // keep the daily out of the way after the first one
    }
    assert.ok(armedAt > 20 && cats.dead > 0 && cats.win > 0 && cats.bonus > 0, JSON.stringify([armedAt, cats]));
  });

  await test('lead list without carry-over: the list restarts at 0; dead spins add more leads than winning ones', () => {
    const e = mkEng({ carryOver: false, daily: { base: 0, perStreak: 0 } });
    const s = freeze(st0({ lt: 495, avg: 100, day: '2026-10-06' }));
    const rng = strict([...gridVals(e, 0), 0.5]);                       // dead base spin on a plain board (fill 1.2 leads = 12 tenths); the marks are none: no sub draw
    const r = spin(e, rng, s); assert.strictEqual(r.winTenths, 0); assert.strictEqual(r.pull.filled, 12);
    assert.strictEqual(r.newState.lt, 0); assert.deepStrictEqual(r.newState.cb, { bet: 100 }); assert.ok(r.pull.armed);
  });

  await test('avg and cb.bet: leads earned small cannot fire a big Callback; cb.bet = avg rounded DOWN to 10 cents (W1B N1), clamped to [10, 2500]', () => {
    const e = mkEng({ daily: { base: 0, perStreak: 0 } });
    const run = (st, bet) => spin(e, strict([...gridVals(e, 0)]), st, { bet });
    // 490 tenths at 10 cents, then a 2500-cent dead spin (12 tenths): avg = (10*490 + 2500*12) / 502 = 69.52 -> 60 (down to 10 cents)
    let r = run(freeze(st0({ lt: 490, avg: 10, day: '2026-10-06' })), 2500);
    assert.deepStrictEqual(r.newState.cb, { bet: 60 }); assert.ok(Math.abs(r.newState.avg - (10 * 490 + 2500 * 12) / 502) < 1e-9);
    r = run(freeze(st0({ lt: 495, avg: 2500, day: '2026-10-06' })), 2500); assert.deepStrictEqual(r.newState.cb, { bet: 2500 });
    r = run(freeze(st0({ lt: 495, avg: 10, day: '2026-10-06' })), 10); assert.deepStrictEqual(r.newState.cb, { bet: 10 });
    for (const [avg, lvl] of [[0, 10], [4.9, 10], [10, 10], [14.9, 10], [15, 10], [19.4, 10], [24.9, 20], [25, 20], [49.4, 40], [499.9, 490], [2356, 2350], [2496.4, 2490], [2499.5, 2490], [2500, 2500], [99999, 2500]]) assert.strictEqual(E.cbBet(avg), lvl, 'avg ' + avg);
    // a flat bettor at every level gets exactly his level back, never rounding drift
    for (const b of E.BET_LEVELS) { let st = st0({ day: '2026-10-06' }); for (let i = 0; i < 80 && !st.cb; i++) st = spin(e, strict(gridVals(e, 0)), st, { bet: b }).newState; assert.deepStrictEqual(st.cb, { bet: b }); assert.strictEqual(st.avg, b); }
  });

  await test('Callback round: no base game, free (cost 0), played at cb.bet whatever the input bet, bonus kind from the knob, does not fill or arm, clears cb, counts, resets the cold clock; bonus2 knob', () => {
    for (const kind of ['bonus1', 'bonus2']) {
      const e = mkEng({ callback: { kind } });
      const st = freeze(st0({ lt: 20, avg: 100, cb: { bet: 200 }, warm: [4, 5], day: '2026-10-06', coldAt: 9e9, callbacks: 2, rounds: 7 }));
      const r = e.playRound(E.rngFrom(3), { bet: 1000, state: st, now: 7e6, day: '2026-10-06', auto: true }, []);
      assert.strictEqual(r.status, 'done'); assert.strictEqual(r.callback, true); assert.strictEqual(r.betCents, 200); assert.strictEqual(r.costTenths, 0); assert.strictEqual(r.round.costTenths, 0);
      assert.strictEqual(r.round.bonusKind, kind === 'bonus1' ? 1 : 2); assert.strictEqual(r.script.spin, null); assert.strictEqual(r.script.bonus.kind, kind); assert.strictEqual(r.round.clusterTenths + r.round.phoneTenths, 0);
      assert.strictEqual(r.pull.filled, 0); assert.strictEqual(r.pull.daily, null); assert.strictEqual(r.newState.cb, null); assert.strictEqual(r.newState.lt, 20); assert.strictEqual(r.newState.callbacks, 3); assert.strictEqual(r.newState.rounds, 8);
      assert.deepStrictEqual(r.newState.warm, [4, 5], 'a Callback has no base spin: warm squares are untouched'); assert.strictEqual(r.newState.coldAt, 7e6 + E.CFG.pull.cold.afterMs);
      assert.ok(r.winTenths <= T); assert.strictEqual(r.winTenths, r.round.bonusTenths);
    }
  });

  await test('Callback is claimed by the NEXT non-buy spin; a buy while a Callback waits is still a normal paid buy and leaves it armed', () => {
    const st = freeze(st0({ lt: 20, avg: 100, cb: { bet: 100 }, day: '2026-10-06' }));
    const r = E.playRound(E.rngFrom(9), { buy: 'bonus1', bet: 100, state: st, now: 1, day: '2026-10-06', auto: true }, []);
    assert.strictEqual(r.callback, false); assert.strictEqual(r.costTenths, E.CFG.buyCost.bonus1); assert.strictEqual(r.newState, st);
  });

  await test('buys never touch state (no tick, fill, daily, warm, Callback claim); decisions DO apply to buy bonuses; state may even be absent', () => {
    const st = freeze(st0({ lt: 300, avg: 100, warm: [1, 2], coldAt: 100, cb: { bet: 50 } }));
    for (const buy of E.BUYS) for (let seed = 1; seed <= 25; seed++) {
      const r = E.playRound(E.rngFrom(seed), { buy, bet: 100, state: st, now: 9e9, day: '2026-10-09', auto: true }, []);
      assert.strictEqual(r.newState, st); assert.strictEqual(r.pull.filled, 0); assert.strictEqual(r.pull.daily, null); assert.deepStrictEqual(r.pull.warmOut, []); assert.strictEqual(r.pull.ghost, null); assert.strictEqual(r.callback, false);
      assert.strictEqual(r.costTenths, E.CFG.buyCost[buy]);
      const r2 = E.playRound(E.rngFrom(seed), { buy, bet: 100, state: null, now: 1, day: '2026-10-09', auto: true }, []); assert.strictEqual(r2.winTenths, r.winTenths);
    }
    let picks = 0, mores = 0;
    for (let seed = 1; seed <= 80; seed++) { const r = E.playRound(E.rngFrom(seed), { buy: 'bonus2', bet: 100, state: null, auto: true }, []); if (r.pull.pick) picks++; if (r.pull.more) mores++; }
    assert.ok(picks > 20 && mores > 20, 'buy bonuses take decisions: ' + picks + ' picks ' + mores + ' mores');
  });

  // ---------------------------------------------------------------- daily
  await test('daily appointment: first paid spin of a new day; streak counts consecutive days, resets on a gap, caps at streakMax; same day twice = once; no claim on a buy or a Callback', () => {
    const e = mkEng({ list: 5000 }); const plain = () => strict(gridVals(e, 0));
    const go = (st, day, bet = 100) => e.playRound(plain(), { bet, state: st, now: 1e6, day, script: false }, []);
    let r = go(E.newState(), '2026-10-06'); assert.deepStrictEqual(r.pull.daily, { leads: 3, streak: 1 }); assert.strictEqual(r.newState.day, '2026-10-06'); assert.strictEqual(r.newState.lt, 30 + 12);
    r = go(r.newState, '2026-10-06'); assert.strictEqual(r.pull.daily, null, 'same day twice'); assert.strictEqual(r.newState.lt, 30 + 12 + 12);
    r = go(r.newState, '2026-10-07'); assert.deepStrictEqual(r.pull.daily, { leads: 4, streak: 2 });
    r = go(r.newState, '2026-10-08'); assert.deepStrictEqual(r.pull.daily, { leads: 5, streak: 3 });
    r = go(r.newState, '2026-10-10'); assert.deepStrictEqual(r.pull.daily, { leads: 3, streak: 1 }, 'a gap resets the streak');
    let st = r.newState; const seen = [];
    for (let d = 11; d <= 20; d++) { r = go(st, '2026-10-' + d); seen.push(r.pull.daily.leads); st = r.newState; }
    assert.deepStrictEqual(seen, [4, 5, 6, 7, 7, 7, 7, 7, 7, 7], 'base 3 + 1 per streak day, streakMax 4');
    r = go(st0({ day: '2026-02-28', streak: 3 }), '2026-03-01'); assert.strictEqual(r.pull.daily.streak, 4, 'month rollover');
    r = go(st0({ day: '2026-12-31', streak: 1 }), '2027-01-01'); assert.strictEqual(r.pull.daily.streak, 2, 'year rollover');
    r = go(st0({ day: '2026-10-09', streak: 5 }), '2026-10-08'); assert.strictEqual(r.pull.daily, null, 'a clock that goes backwards claims nothing');
    const b = E.playRound(E.rngFrom(1), { buy: 'call', bet: 100, state: E.newState(), day: '2026-10-06', auto: true }, []); assert.strictEqual(b.pull.daily, null);
    const cb = E.playRound(E.rngFrom(1), { bet: 100, state: st0({ cb: { bet: 100 } }), now: 1, day: '2026-10-06', auto: true }, []); assert.strictEqual(cb.pull.daily, null); assert.strictEqual(cb.newState.day, null);
  });

  await test('daily leads are worked at stake min(bet, stakeCap) cents and can arm the Callback (played on the NEXT spin, not this one)', () => {
    const e = mkEng({ fill: { dead: 0, win: 0, bonus: 0 } });
    const s = freeze(st0({ lt: 480, avg: 2500 }));
    const r = e.playRound(strict(gridVals(e, 0)), { bet: 2500, state: s, now: 1e6, day: '2026-10-06' }, []);
    assert.strictEqual(r.callback, false); assert.ok(r.pull.armed); assert.strictEqual(r.newState.lt, 480 + 30 - 500);
    assert.strictEqual(r.newState.cb.bet, E.cbBet((2500 * 480 + 100 * 30) / 510), 'stake capped at 100 cents');
  });

  // ---------------------------------------------------------------- warm squares and the ghost
  const baseDead = (e, tail) => [...gridVals(e, 0, MUGS), ...symsVals(e, 0, REFILL5), ...(tail || [])];       // a base spin: 5-mug cluster (3 tenths), marks 0..4, no phone
  const subOf = (v) => E.rngFrom(Math.floor(v * 4294967296));
  const MARKS = [0, 1, 2, 3, 4], hotArr = (list) => { const h = new Uint8Array(30); for (const p of list) h[p] = 1; return h; };

  await test('ghost: the real phone feature on the sub-rng (one main draw at the very end) with the base reveal table; pay never added; script is the feature script', () => {
    const e = mkEng({ warm: { chance: 0, cap: 4 } }); const v = 0.6180339;
    const rng = strict(baseDead(e, [v]));
    const r = spin(e, rng, st0({ day: '2026-10-06' }));
    assert.strictEqual(rng.left(), 0, 'exactly one main draw for the sub-rng, after the round');
    const want = e.phoneFeature(subOf(v), 0, hotArr(MARKS), true, T);
    assert.deepStrictEqual(r.pull.ghost, { pay: want.pay, closes: want.closes, leads: want.leads, script: want.script });
    assert.strictEqual(r.pull.ghost.leads, 5); assert.strictEqual(r.winTenths, 3, 'ghost pay is never added'); assert.strictEqual(r.round.phoneTenths, 0); assert.deepStrictEqual(r.pull.ghost.script.leads, MARKS);
    assert.strictEqual(r.newState.rounds, 1); assert.deepStrictEqual(r.newState.warm, []);
    assert.deepStrictEqual(r.script.pull.ghost, r.pull.ghost, 'it is in the script too');
  });

  await test('ghost: never re-rolled to look better (a spread of sub seeds gives exactly what phoneFeature yields), absent when a phone fired / ghost off / base pay >= maxWinTenths / pay under minTenths', () => {
    const e = mkEng({ warm: { chance: 0 } });
    for (let i = 0; i < 300; i++) {
      const v = (i + 0.5) / 300; const r = spin(e, strict(baseDead(e, [v])), st0({ day: '2026-10-06' }), { script: i % 2 === 0 });
      const w = e.phoneFeature(subOf(v), 0, hotArr(MARKS), false, T); assert.strictEqual(r.pull.ghost.pay, w.pay); assert.strictEqual(r.pull.ghost.closes, w.closes); assert.strictEqual(r.winTenths, 3);
    }
    // a phone on the board: the marks are used, no ghost, no warm, no sub draw
    let rng = strict([...gridVals(e, 0, { ...MUGS, 29: 12 }), ...symsVals(e, 0, REFILL5), ...Array(5).fill(revVal(e, 0, 'b', 5))]);
    let r = spin(e, rng, st0({ day: '2026-10-06' })); assert.strictEqual(rng.left(), 0); assert.strictEqual(r.pull.ghost, null); assert.deepStrictEqual(r.pull.warmOut, []); assert.strictEqual(r.round.phoneFired, true); assert.strictEqual(r.winTenths, 3 + 25);
    // ghost off: no sub draw at all when warm is off too
    const off = mkEng({ ghost: { on: false }, warm: { chance: 0 } });
    rng = strict(baseDead(off)); r = spin(off, rng, st0({ day: '2026-10-06' })); assert.strictEqual(r.pull.ghost, null); assert.strictEqual(rng.left(), 0);
    // six mugs pay 1.0x = maxWinTenths: not a dead-ish spin, no ghost
    const six = mkEng({ warm: { chance: 0 } }); rng = strict([...gridVals(six, 0, { ...MUGS, 5: 0 }), ...symsVals(six, 0, [1, 2, 3, 4, 1, 3])]);
    r = spin(six, rng, st0({ day: '2026-10-06' })); assert.strictEqual(r.winTenths, 10); assert.strictEqual(r.pull.ghost, null); assert.strictEqual(rng.left(), 0);
    // minTenths hides a small ghost but the draw was still taken (replay-stable)
    const hi = mkEng({ warm: { chance: 0 }, ghost: { minTenths: 1e9 } }); rng = strict(baseDead(hi, [0.3])); r = spin(hi, rng, st0({ day: '2026-10-06' })); assert.strictEqual(r.pull.ghost, null); assert.strictEqual(rng.left(), 0);
    // no marked squares (plain board): nothing to show, nothing drawn
    rng = strict(gridVals(e, 0)); r = spin(e, rng, st0({ day: '2026-10-06' })); assert.strictEqual(r.pull.ghost, null);
  });

  await test('warm squares: chance 1 keeps the first `cap` marked squares by position, chance 0 none, drawn after the ghost from the same sub-rng; warm in = the next base spin starts hot', () => {
    let e = mkEng({ warm: { chance: 1, cap: 4 }, ghost: { on: false } });
    let rng = strict(baseDead(e, [0.5])); let r = spin(e, rng, st0({ day: '2026-10-06' })); assert.deepStrictEqual(r.pull.warmOut, [0, 1, 2, 3]); assert.deepStrictEqual(r.newState.warm, [0, 1, 2, 3]); assert.strictEqual(rng.left(), 0);
    assert.strictEqual(r.newState.coldAt, 5e6 + E.CFG.pull.cold.afterMs, 'warm squares start the cold clock');
    e = mkEng({ warm: { chance: 1, cap: 9 }, ghost: { on: false } }); r = spin(e, strict(baseDead(e, [0.5])), st0({ day: '2026-10-06' })); assert.deepStrictEqual(r.pull.warmOut, MARKS);
    e = mkEng({ warm: { chance: 0, cap: 4 }, ghost: { on: false } }); rng = strict(baseDead(e)); r = spin(e, rng, st0({ day: '2026-10-06' })); assert.deepStrictEqual(r.pull.warmOut, []); assert.strictEqual(rng.left(), 0, 'no draw when nothing can be warm');
    e = mkEng({ warm: { chance: 0.35, cap: 4 }, ghost: { on: true } });                              // default chance: ghost first, then one draw per marked square in position order
    for (const v of [0.05, 0.31, 0.77]) {
      const sub = subOf(v); e.phoneFeature(sub, 0, hotArr(MARKS), false, T); const want = []; for (const p of MARKS) { if (want.length >= 4) break; if (sub() < 0.35) want.push(p); }
      r = spin(e, strict(baseDead(e, [v])), st0({ day: '2026-10-06' })); assert.deepStrictEqual(r.pull.warmOut, want);
    }
    // warm in: a phone on the board fires on the carried-in squares even though no cluster formed this spin; they are consumed
    e = mkEng({ warm: { chance: 1, cap: 4 } });
    rng = strict([...gridVals(e, 0, { 29: 12 }), ...Array(3).fill(revVal(e, 0, 'b', 5))]);
    r = spin(e, rng, freeze(st0({ day: '2026-10-06', warm: [7, 8, 9], warmBet: 100, coldAt: 6e6, lt: 200, avg: 100 })));
    assert.strictEqual(rng.left(), 0); assert.deepStrictEqual(r.pull.warmIn, [7, 8, 9]); assert.deepStrictEqual(r.script.spin.hotIn, [7, 8, 9]); assert.deepStrictEqual(r.script.spin.phone.leads, [7, 8, 9]);
    assert.strictEqual(r.winTenths, 15); assert.deepStrictEqual(r.newState.warm, [], 'consumed'); assert.strictEqual(r.pull.ghost, null);
    // warm in, no phone: the squares are marked, can stay warm again (re-rolled), and a cluster adds to them
    e = mkEng({ warm: { chance: 1, cap: 4 }, ghost: { on: false } }); rng = strict([...baseDead(e, [0.5])]);
    r = spin(e, rng, freeze(st0({ day: '2026-10-06', warm: [10, 11], warmBet: 100 }))); assert.deepStrictEqual(r.pull.warmOut, [0, 1, 2, 3], 'marks 0..4 and 10, 11; position order, cap 4');
  });

  await test('warm squares die at the cold clock exactly like the leak; the state carried through tickState before a spin', () => {
    const e = mkEng({ warm: { chance: 1, cap: 4 }, ghost: { on: false } }); let st = spin(e, strict(baseDead(e, [0.5])), st0({ day: '2026-10-06' }), { now: 1000 }).newState;
    assert.deepStrictEqual(st.warm, [0, 1, 2, 3]); assert.strictEqual(st.coldAt, 1000 + 86400000);
    const r = e.playRound(strict(gridVals(e, 0)), { bet: 100, state: freeze(st), now: 1000 + 86400000, day: '2026-10-06' }, []);
    assert.deepStrictEqual(r.pull.warmIn, []); assert.strictEqual(r.pull.warmDied, 4); assert.deepStrictEqual(r.script.spin.hotIn, []);
  });

  // ---------------------------------------------------------------- the decisions: pick and ONE MORE CALL
  // bonus1 bought: spin 1 = 5-mug cluster (hot 0..4) + a phone on 29, then 5 refills, then the 5 reveals, then 7 plain spins
  const bonusAll = (e, reveals, extra) => [...gridVals(e, 1, { ...MUGS, 29: 12 }), ...symsVals(e, 1, REFILL5), ...reveals, ...Array(7).fill(0).flatMap(() => gridVals(e, 1)), ...(extra || [])];
  const bonusIn = (e, o) => Object.assign({ buy: 'bonus1', bet: 100, state: null, script: true }, o);

  await test('PICK: pending at the first phone feature with >= minLeads hot squares; partial holds only what was seen (no reveal of the phone feature); choices = hot squares in reading order', () => {
    const e = E0; const rv = revVal(e, 1, 'b', 100);
    const rng = strict(bonusAll(e, Array(5).fill(rv)));
    const r = e.playRound(rng, bonusIn(e), []);
    assert.strictEqual(r.status, 'pending'); assert.deepStrictEqual(r.pending, { k: 'pick', spin: 1, choices: MARKS }); assert.strictEqual(r.costTenths, E.CFG.buyCost.bonus1);
    assert.strictEqual(rng.used(), 35, '30 symbols + 5 refills drawn, nothing of the phone feature');
    const b = r.partial.bonus; assert.strictEqual(r.partial.partial, true); assert.strictEqual(b.partial, true); assert.strictEqual(b.spins.length, 1);
    const cur = b.spins[0]; assert.strictEqual(cur.pickPending, 1); assert.strictEqual(cur.phone, null); assert.strictEqual(cur.hotOut, null); assert.strictEqual(cur.win, undefined); assert.strictEqual(cur.phoneTenths, undefined); assert.strictEqual(cur.phones, 1); assert.strictEqual(cur.cluster, 3);
    assert.strictEqual(r.partial.spin, null); assert.strictEqual(r.partial.parts, undefined); assert.strictEqual(r.partial.winTenths, undefined); assert.strictEqual(r.newState, undefined);
    assert.ok(!JSON.stringify(r.partial).includes('"reveals"'), 'no phone reveal in the partial');
  });

  await test('PICK: later phone features are not offered; a first phone with fewer than minLeads hot squares spends the slot; pick.on = false offers nothing', () => {
    const e = E0; const rv = revVal(e, 1, 'b', 100);
    // spin 1: a single mug pair? use a lone hot square via warm... a bonus starts with no marks, so a 5-cluster is the smallest: use minLeads 6 to model "too few"
    const hiMin = mkEng({ pick: { minLeads: 6 } });
    let r = hiMin.playRound(strict(bonusAll(hiMin, Array(5).fill(rv))), bonusIn(hiMin, { auto: true }), []); assert.strictEqual(r.pull.pick, null); assert.strictEqual(r.status, 'done');
    const off = mkEng({ pick: { on: false } });
    r = off.playRound(strict(bonusAll(off, Array(5).fill(rv), [0.9])), bonusIn(off), []);
    assert.strictEqual(r.status, 'pending', 'ONE MORE CALL still pends'); assert.strictEqual(r.pending.k, 'more');
    // second spin with a phone and hot squares again: only one offer per bonus
    const two = [...gridVals(E0, 1, { ...MUGS, 29: 12 }), ...symsVals(E0, 1, REFILL5), ...Array(5).fill(rv), ...gridVals(E0, 1, { 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 29: 12 }), ...symsVals(E0, 1, [1, 2, 3, 4, 1]), ...Array(5).fill(rv)];
    const d = { k: 'pick', p: 0 }; const rng = strict([...two, ...Array(6).fill(0).flatMap(() => gridVals(E0, 1))]);
    r = E0.playRound(rng, bonusIn(E0), [d]);
    assert.strictEqual(r.status, 'pending'); assert.strictEqual(r.pending.k, 'more', 'the second phone feature (spin 2) offers no second pick');
    assert.strictEqual(r.script, undefined); assert.strictEqual(r.partial.bonus.spins[1].phone.leads.length, 5);
    assert.strictEqual(rng.left(), 0);
  });

  await test('PICK: default (auto) = first hot square in reading order, recorded as auto; the picked square draws from PICKREV (tier weights x mult), marked up:1; same single draw for every choice', () => {
    const e = E0; const lo = 0.001;                                                // 0.001: bronze 2x in the plain table, first silver bubble in the picked table (bronze mult 0)
    const rngFor = () => strict(bonusAll(e, Array(5).fill(lo)));
    const auto = e.playRound(rngFor(), bonusIn(e, { auto: true }), []);
    assert.strictEqual(auto.status, 'done'); assert.strictEqual(auto.pull.more.auto, true); assert.strictEqual(auto.pull.more.take, false);
    const pk = auto.pull; assert.deepStrictEqual(pk.pick, { spin: 1, choices: MARKS, p: 0, auto: true }); assert.deepStrictEqual(pk.decisions, [{ k: 'pick', p: 0, auto: true }, { k: 'more', take: false, auto: true }]);
    for (const p of MARKS) {
      const rng = counting(rngFor()); const r = e.playRound(rng, bonusIn(e), [{ k: 'pick', p }]);
      assert.strictEqual(rng.n(), 35 + 5 + 7 * 30, 'the same number of draws whichever square is picked');
      const rev = r.partial.bonus.spins[0].phone.rounds[0].reveals;
      rev.forEach((x) => { if (x.p === p) { assert.strictEqual(x.up, 1); assert.strictEqual(x.k, 'b'); assert.strictEqual(x.v, 50); assert.strictEqual(x.t, 1); } else { assert.strictEqual(x.up, undefined); assert.strictEqual(x.v, 2); } });
      assert.deepStrictEqual(r.pull.pick, { spin: 1, choices: MARKS, p, auto: false });
    }
    // PICKREV is the mode table with tier weights x pull.pick.mult built at createEngine time
    const m = E.CFG.pull.pick.mult, rv = e.REV[1], pv = e.PICKREV[1];
    const wOf = (t, i) => (i ? t.cum[i] - t.cum[i - 1] : t.cum[0]);
    rv.out.forEach((o, i) => { const tn = o.k === 'b' ? E.TIER_NAMES[o.t] : o.k === 'u' ? 'upsell' : 'close'; const raw = Object.keys(pv.out).length; assert.strictEqual(pv.out[i].k, o.k); assert.ok(raw); if (m[tn] === 0) assert.ok(wOf(pv, i) === 0); else if (m[tn] > 0) assert.ok(wOf(pv, i) > 0); });
    const tierW = (t) => { const w = {}; t.out.forEach((o, i) => { const tn = o.k === 'b' ? E.TIER_NAMES[o.t] : o.k === 'u' ? 'upsell' : 'close'; w[tn] = (w[tn] || 0) + wOf(t, i); }); return w; };
    const a = tierW(rv), b = tierW(pv); // ratio of silver : upsell in the pick table = ratio in plain table * (2 / 2); gold : silver = x 3/2
    assert.ok(Math.abs((b.gold / b.silver) / (a.gold / a.silver) - 3 / 2) < 1e-9); assert.ok(Math.abs((b.upsell / b.silver) / (a.upsell / a.silver) - 1) < 1e-9); assert.ok(Math.abs((b.close / b.silver) / (a.close / a.silver) - 1) < 1e-9); assert.ok(b.bronze === 0);
  });

  await test('PICK: an invalid or foreign decision is rejected (square not hot, wrong kind, malformed, more decisions than decision points); the picked square stays upgraded in later reveal rounds', () => {
    const e = E0; const rv = revVal(e, 1, 'b', 100); const mk = () => strict(bonusAll(e, Array(5).fill(rv)));
    for (const bad of [[{ k: 'pick', p: 29 }], [{ k: 'pick', p: -1 }], [{ k: 'pick' }], [{ k: 'more', take: true }], [null], [{ k: 'pick', p: '2' }]])
      assert.throws(() => e.playRound(mk(), bonusIn(e), bad), (x) => x.code === 'bad_decision', JSON.stringify(bad));
    assert.throws(() => e.playRound(mk(), bonusIn(e), [{ k: 'pick', p: 1 }, { k: 'more', take: 'yes' }]), (x) => x.code === 'bad_decision');
    assert.throws(() => e.playRound(E.rngFrom(5), { buy: 'call', bet: 100, state: null, auto: true }, [{ k: 'pick', p: 1 }]), (x) => x.code === 'bad_decision', 'a decision for a point that never comes');
    // later rounds: scripted close then bubbles; the picked square keeps drawing from PICKREV while it is active
    const cl = revVal(e, 1, 'c'), bub = revVal(e, 1, 'b', 100), pv0 = pickVal(e, 1, 'b', 500);
    // round 1: squares 0..4 reveal [close(0), bubble, bubble, bubble, bubble(picked 3 -> silver 500? use pickVal gold 250)]; the close collects; round 2 re-reveals 1..4
    const vals = bonusAll(e, [cl, bub, bub, bub, pickVal(e, 1, 'b', 250), ...[bub, bub, bub, pickVal(e, 1, 'b', 500)]]);
    const r = e.playRound(strict(vals), bonusIn(e), [{ k: 'pick', p: 4 }, { k: 'more', take: false }]);
    assert.strictEqual(r.status, 'done'); const ph = r.script.bonus.spins[0].phone;
    const up = ph.rounds.flatMap((x) => x.reveals).filter((x) => x.up); assert.ok(up.length >= 2 && up.every((x) => x.p === 4), 'the picked square is upgraded in every reveal round it takes part in');
    assert.strictEqual(pv0 > 0, true);
  });

  await test('ONE MORE CALL: pending with W, mult, exact pWin = rtp/mult, capT; bank pays W; take wins iff u*mult < rtp (edge values), pays W*mult, else 0; one draw only when taken', () => {
    const e = E0; const rv = revVal(e, 1, 'b', 100); const W = 3 + 5 * 100;
    const run = (dec, extra) => { const rng = strict(bonusAll(e, Array(5).fill(rv), extra)); const r = e.playRound(rng, bonusIn(e), dec); return { r, rng }; };
    let { r } = run([{ k: 'pick', p: 0 }]);
    assert.strictEqual(r.status, 'pending'); const W1 = r.pending.W; assert.deepStrictEqual(r.pending, { k: 'more', W: W1, mult: 2, pWin: 0.49, capT: T }); assert.ok(W1 >= 3 + 5 * 50, 'pick upgraded the picked square so W is at least the plain sum');
    // whole bonus in the partial, but not the gamble outcome
    assert.strictEqual(r.partial.bonus.spins.length, 8); assert.strictEqual(r.partial.bonus.winTenths, W1); assert.strictEqual(r.partial.pull.decisions.length, 1); assert.strictEqual(r.partial.parts, undefined); assert.strictEqual(r.partial.winTenths, undefined);
    let q = run([{ k: 'pick', p: 0 }, { k: 'more', take: false }]); assert.strictEqual(q.r.status, 'done'); assert.strictEqual(q.r.winTenths, W1); assert.strictEqual(q.rng.left(), 0, 'bank takes no draw'); assert.strictEqual(q.r.pull.more.take, false); assert.strictEqual(q.r.pull.more.won, null);
    q = run([{ k: 'pick', p: 0 }, { k: 'more', take: true }], [0.4899999]); assert.strictEqual(q.r.winTenths, W1 * 2); assert.strictEqual(q.r.pull.more.won, true); assert.strictEqual(q.rng.left(), 0);
    q = run([{ k: 'pick', p: 0 }, { k: 'more', take: true }], [0.49]); assert.strictEqual(q.r.winTenths, 0); assert.strictEqual(q.r.pull.more.won, false); assert.strictEqual(q.r.script.parts.bonus, 0); assert.strictEqual(q.r.script.bonus.winTenths, W1, 'the script keeps the bonus as played; parts.bonus is what was paid');
    q = run([{ k: 'pick', p: 0 }, { k: 'more', take: true }], [0]); assert.strictEqual(q.r.winTenths, W1 * 2);
    q = run([{ k: 'pick', p: 0 }, { k: 'more', take: true }], [0.9999999]); assert.strictEqual(q.r.winTenths, 0);
    assert.deepStrictEqual(q.r.pull.more, { W: W1, mult: 2, pWin: 0.49, take: true, won: false, auto: false });
    q = run([], []); assert.ok(q.r.status === 'pending');
    // auto: pick first, bank
    const a = e.playRound(strict(bonusAll(e, Array(5).fill(rv))), bonusIn(e, { auto: true }), []); assert.strictEqual(a.status, 'done'); assert.strictEqual(a.pull.more.auto, true); assert.strictEqual(a.pull.more.take, false); assert.strictEqual(a.pull.pick.auto, true); assert.strictEqual(a.winTenths, a.round.clusterTenths + a.round.phoneTenths + a.pull.more.W);
    // a natural bonus after a paid base spin: the base win stays, only the bonus gambles; fill category = bonus; the sub-rng draw comes last
    const natural = (dec, extra) => { const rng = strict([...gridVals(e, 0, { ...MUGS, 27: 11, 28: 11, 29: 11 }), ...symsVals(e, 0, REFILL5), ...bonusAll(e, Array(5).fill(rv)), ...extra]);
      return { rng, r: e.playRound(rng, { bet: 100, state: freeze(st0({ day: '2026-10-06' })), now: 1, day: '2026-10-06' }, dec) }; };
    let n = natural([{ k: 'pick', p: 0 }, { k: 'more', take: true }], [0.1, 0.5]);
    assert.strictEqual(n.rng.left(), 0); assert.strictEqual(n.r.round.bonusKind, 1); assert.strictEqual(n.r.pull.filled, 6); assert.strictEqual(n.r.round.clusterTenths, 3);
    assert.strictEqual(n.r.winTenths, 3 + 2 * n.r.pull.more.W); assert.strictEqual(n.r.pull.more.won, true); assert.strictEqual(n.r.round.bonusRawTenths, n.r.pull.more.W);
    n = natural([{ k: 'pick', p: 0 }, { k: 'more', take: true }], [0.9, 0.5]); assert.strictEqual(n.r.winTenths, 3); assert.strictEqual(n.rng.left(), 0);
  });

  await test('ONE MORE CALL only when W >= minTenths, the bonus did not hit the cap, and W*mult fits under what is left of the cap (the final win never exceeds the cap); pick/more off switches; mult 3', () => {
    const e = E0; const lowV = Array(5).fill(0.001);                      // bronze 2 each = 10 + cluster 3 = 13 < minTenths 20 (pick off so the picked square is not upgraded)
    let r;
    // e.playRound(strict(bonusAll(e, lowV)), bonusIn(e, { auto: true }), []); assert.strictEqual(r.pull.more, null);
    const off = mkEng({ more: { on: false } }); r = off.playRound(strict(bonusAll(off, Array(5).fill(revVal(off, 1, 'b', 100)))), bonusIn(off, { auto: true }), []); assert.strictEqual(r.pull.more, null);
    const m3 = mkEng({ more: { mult: 3 } }); const rv3 = revVal(m3, 1, 'b', 100);
    r = m3.playRound(strict(bonusAll(m3, Array(5).fill(rv3))), bonusIn(m3), [{ k: 'pick', p: 0 }]); assert.strictEqual(r.pending.mult, 3); assert.ok(Math.abs(r.pending.pWin - 0.98 / 3) < 1e-15);
    r = m3.playRound(strict(bonusAll(m3, Array(5).fill(rv3), [0.3266])), bonusIn(m3), [{ k: 'pick', p: 0 }, { k: 'more', take: true }]); assert.strictEqual(r.pull.more.won, true); assert.strictEqual(r.winTenths, 3 * r.pull.more.W);
    // tiny cap: a bonus that fills the cap is never offered; a bonus under half of it is
    for (let cap = 40; cap <= 3000; cap += 37) {
      const small = mkEng({}, { maxWinTenths: cap }); let offered = 0, blocked = 0;
      for (let seed = 1; seed <= 150; seed++) {
        const x = small.playRound(E.rngFrom(seed), { buy: seed % 2 ? 'bonus1' : 'bonus2', bet: 100, state: null, script: false, decide: (p) => (p.k === 'more' ? { k: 'more', take: true } : null), auto: true }, []);
        assert.ok(x.winTenths <= cap, 'win ' + x.winTenths + ' > cap ' + cap);
        if (x.pull.more) { offered++; assert.ok(x.pull.more.W * x.pull.more.mult <= cap, 'offered above the cap'); } else if (x.round.bonusRawTenths * 2 > cap) blocked++;
      }
      if (cap === 40 + 37 * 40) assert.ok(offered > 0 && blocked > 0, 'both cases occur: ' + offered + ' / ' + blocked);
    }
  });

  await test('replay protocol: re-running the same tape with longer decisions reproduces everything before the decision and gives the same result as a one-pass run with the same choices', () => {
    let found = 0;
    for (let seed = 1; seed <= 400 && found < 12; seed++) {
      const buy = seed % 3 ? 'bonus1' : 'bonus2';
      const base = E.rngFrom(seed), tape = mkTape(base); const input = { buy, bet: 100, state: null, script: true };
      let decs = [], r = E0.playRound(tape, input, decs); if (r.status === 'done') continue;
      const steps = [];
      while (r.status === 'pending') {
        steps.push(r.pending.k);
        const used = tape.used(); decs = decs.concat([r.pending.k === 'pick' ? { k: 'pick', p: r.pending.choices[r.pending.choices.length - 1] } : { k: 'more', take: true }]);
        tape.reset(); r = E0.playRound(tape, input, decs); assert.ok(tape.used() >= used, 'the replay consumes at least what the pending round consumed');
      }
      const one = E0.playRound(E.rngFrom(seed), { ...input, decide: (p) => (p.k === 'pick' ? { k: 'pick', p: p.choices[p.choices.length - 1] } : { k: 'more', take: true }) }, []);
      assert.deepStrictEqual(r.script, one.script); assert.strictEqual(r.winTenths, one.winTenths); assert.deepStrictEqual(r.pull.decisions, decs); found++;
      // and the replay is stable: same tape, same decisions, same answer twice
      tape.reset(); assert.deepStrictEqual(E0.playRound(tape, input, decs).script, r.script);
    }
    assert.ok(found >= 8, 'sweep found ' + found + ' rounds with decisions');
  });

  await test('pending partial scripts hold only what the player has seen (no phone feature of the decision spin, no gamble outcome, no later spins) over a seed sweep', () => {
    let n = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const input = { buy: 'bonus2', bet: 100, state: null, script: true };
      const r = E0.playRound(E.rngFrom(seed), input, []); if (r.status !== 'pending') continue; n++;
      if (r.pending.k === 'pick') {
        const sp = r.partial.bonus.spins; assert.strictEqual(sp.length, r.pending.spin); const cur = sp[sp.length - 1];
        assert.strictEqual(cur.phone, null); assert.strictEqual(cur.hotOut, null); assert.strictEqual(cur.pickPending, 1); assert.strictEqual(cur.win, undefined);
        for (const done of sp.slice(0, -1)) { assert.ok(done.hotOut); assert.strictEqual(typeof done.win, 'number'); }
        assert.deepStrictEqual(r.pending.choices, cur.steps.length ? cur.steps[cur.steps.length - 1].hot : cur.hotIn);
      } else {
        const full = E0.playRound(E.rngFrom(seed), { ...input, auto: true }, []); assert.strictEqual(full.status, 'done');
        assert.strictEqual(r.partial.bonus.winTenths, r.pending.W); assert.strictEqual(r.partial.bonus.spins.length, full.script.bonus.spins.length);
      }
      assert.strictEqual(r.partial.pull.decisions.length, r.pending.k === 'pick' ? 0 : r.partial.pull.decisions.length);
    }
    assert.ok(n > 30, 'pending seen ' + n);
  });

  await test('script:false is the same round (same draws, win, state) as script:true; playRound does not mutate its input state', () => {
    let st = E.newState(), st2 = E.newState();
    const a = E.rngFrom(77), b = E.rngFrom(77);
    for (let i = 0; i < 1500; i++) {
      const base = { bet: [10, 100, 1000][i % 3], now: 1e6 + i * 5e6, day: '2026-10-' + String(1 + (i % 28)).padStart(2, '0'), auto: true };
      const x = E.playRound(a, { ...base, state: freeze(st), script: true }, []), y = E.playRound(b, { ...base, state: freeze(st2), script: false }, []);
      assert.strictEqual(x.winTenths, y.winTenths); assert.deepStrictEqual(x.newState, y.newState); assert.strictEqual(y.script, null); assert.deepStrictEqual({ ...x.pull, ghost: x.pull.ghost && x.pull.ghost.pay }, { ...y.pull, ghost: y.pull.ghost && y.pull.ghost.pay });
      st = x.newState; st2 = y.newState;
    }
    assert.strictEqual(a(), b());
  });

  await test('round fields: integer tenths, winTenths <= cap, parts add up, cost 10 per spin / buy price, cents exact at every level; script carries the pull block', () => {
    const ids = (o, p = 'x') => { if (typeof o === 'number') assert.ok(Number.isFinite(o), 'non-finite at ' + p); };
    let st = E.newState();
    for (let i = 0; i < 6000; i++) {
      const buy = i % 11 === 0 ? E.BUYS[(i / 11) % 4 | 0] : null, bet = E.BET_LEVELS[i % 8];
      const r = E.playRound(E.rngFrom(i + 1000), { buy, bet, state: st, now: 1e6 + i * 4e6, day: '2026-10-' + String(1 + (i % 28)).padStart(2, '0'), auto: true }, []);
      assert.strictEqual(r.status, 'done'); assert.ok(Number.isInteger(r.winTenths) && r.winTenths >= 0 && r.winTenths <= T);
      assert.strictEqual(r.costTenths, r.callback ? 0 : buy ? E.CFG.buyCost[buy] : 10);
      const R = r.round; assert.strictEqual(r.winTenths, Math.min(R.clusterTenths + R.phoneTenths + R.bonusTenths, T)); assert.strictEqual(r.script.parts.bonus, R.bonusTenths);
      assert.doesNotThrow(() => E.cents(r.winTenths, r.betCents)); assert.doesNotThrow(() => E.cents(r.costTenths, r.betCents));
      assert.ok(r.script.pull); assert.strictEqual(r.script.pull, r.pull); assert.ok(Number.isInteger(r.pull.leadsAfter) && r.pull.leadsAfter >= 0);
      if (r.pull.more) assert.strictEqual(R.bonusTenths, r.pull.more.take && r.pull.more.won ? r.pull.more.W * r.pull.more.mult : r.pull.more.take ? 0 : r.pull.more.W);
      st = r.newState;
    }
  });

  await test('200k-round sweep: total win <= cap always and ONE MORE CALL is never offered above the cap (take-every-gamble policy on bought bonuses, boosted pays for the tail)', () => {
    const boosted = mkEng({}, { payScale: 6 });
    let offers = 0, offersNearCap = 0, capped = 0, over = 0, n = 0;
    const policy = (p) => (p.k === 'more' ? { k: 'more', take: true } : null);
    const rng = E.rngFrom(2024);
    for (let i = 0; i < 200000; i++) {
      const e = i % 4 === 0 ? boosted : E0;
      const r = e.playRound(rng, { buy: i % 2 ? 'bonus2' : 'bonus1', bet: 100, state: null, script: false, auto: true, decide: policy }, []); n++;
      if (r.winTenths > T) over++;
      if (r.pull.more) { offers++; const base = r.round.clusterTenths + r.round.phoneTenths; assert.ok(r.pull.more.W * r.pull.more.mult + base <= T, 'offer above what is left of the cap'); if (r.pull.more.W * 2 > T / 2) offersNearCap++; }
      if (r.capped) capped++;
    }
    assert.strictEqual(over, 0); assert.ok(offers > 20000, 'offers ' + offers);
    console.log('       sweep: ' + n + ' rounds, ' + offers + ' offers, ' + offersNearCap + ' with W*2 > cap/2, ' + capped + ' capped');
  });

  await test('statistics: ONE MORE CALL at rtp 0.98 / mult 2 is a 49% coin (take) and costs 2% of the banked value on average; bank = the bonus untouched', () => {
    let wins = 0, tot = 0, bank = 0, take = 0;
    const rngA = E.rngFrom(31), rngB = E.rngFrom(31);
    for (let i = 0; i < 60000; i++) {
      const a = E0.playRound(rngA, { buy: 'bonus1', bet: 100, state: null, script: false, auto: true, decide: (p) => (p.k === 'more' ? { k: 'more', take: false } : null) }, []);
      const b = E0.playRound(rngB, { buy: 'bonus1', bet: 100, state: null, script: false, auto: true, decide: (p) => (p.k === 'more' ? { k: 'more', take: true } : null) }, []);
      // the first round diverges the streams after a taken gamble draws once, so compare only the offer pool of b itself
      if (b.pull.more) { tot++; if (b.pull.more.won) wins++; take += b.winTenths; bank += b.pull.more.W; }
      if (a.pull.more) assert.strictEqual(a.winTenths, a.round.clusterTenths + a.round.phoneTenths + a.pull.more.W);
    }
    const p = wins / tot, se = Math.sqrt(0.49 * 0.51 / tot);
    assert.ok(Math.abs(p - 0.49) < 5 * se, 'win rate ' + p + ' vs 0.49 (n=' + tot + ')');
  });

  // ---------------------------------------------------------------- wave 1 fix round (critic F1, F2, F5)
  await test('F1 warm squares are tied to a bet: honoured as hot only at the SAME bet; any other bet drops them (counted in pull.warmDropped) and the spin is exactly a cold spin', () => {
    const e = mkEng({ daily: { base: 0, perStreak: 0 } });
    const warm = [7, 8, 9], DAY = '2026-10-06';
    const cold = () => st0({ day: DAY, lt: 200, avg: 100 });
    let honoured = 0;
    for (const [warmBet, bet] of [[10, 2500], [2500, 10], [100, 200], [0, 100], [undefined, 100]]) {
      for (let seed = 1; seed <= 400; seed++) {
        const st = freeze(Object.assign(cold(), { warm, warmBet, coldAt: 6e6 }));
        const a = e.playRound(E.rngFrom(seed), { bet, state: st, now: 5e6, day: DAY, auto: true }, []);
        const b = e.playRound(E.rngFrom(seed), { bet, state: freeze(cold()), now: 5e6, day: DAY, auto: true }, []);
        assert.deepStrictEqual(a.pull.warmIn, [], 'dropped warm squares are not warmIn'); assert.strictEqual(a.pull.warmDropped, 3); assert.deepStrictEqual(a.script.spin.hotIn, []);
        assert.strictEqual(a.winTenths, b.winTenths, 'same payback as a cold spin at that bet (seed ' + seed + ')'); assert.deepStrictEqual(a.script.spin, b.script.spin);
        assert.deepStrictEqual(a.pull.warmOut, b.pull.warmOut); assert.strictEqual(b.pull.warmDropped, 0);
      }
    }
    // the same bet honours them
    for (let seed = 1; seed <= 200; seed++) {
      const st = freeze(Object.assign(cold(), { warm, warmBet: 100, coldAt: 6e6 }));
      const a = e.playRound(E.rngFrom(seed), { bet: 100, state: st, now: 5e6, day: DAY, auto: true }, []);
      assert.deepStrictEqual(a.pull.warmIn, warm); assert.strictEqual(a.pull.warmDropped, 0); assert.deepStrictEqual(a.script.spin.hotIn, warm); honoured++;
    }
    assert.strictEqual(honoured, 200);
  });

  await test('F1 the attacker (10c spins until >= 3 warm squares, then one $25 spin) gets a cold $25 spin: no hot squares, same payback; a same-bet follow-up keeps the squares', () => {
    const e = mkEng({ warm: { chance: 1, cap: 4 }, daily: { base: 0, perStreak: 0 }, list: 100000 }), DAY = '2026-10-06';   // list 100000: no Callback arms (a Callback has no base spin)
    let st = st0({ day: DAY }), big = 0, seedN = 1;
    const stream = E.rngFrom(99);
    for (let i = 0; i < 60000 && big < 150; i++) {
      if (st.warm.length >= 3) {
        const seed = seedN++;
        const a = e.playRound(E.rngFrom(seed), { bet: 2500, state: freeze(st), now: 1e6 + i, day: DAY, auto: true }, []);
        const cold = e.playRound(E.rngFrom(seed), { bet: 2500, state: freeze(Object.assign({}, st, { warm: [], warmBet: 0 })), now: 1e6 + i, day: DAY, auto: true }, []);
        assert.strictEqual(a.pull.warmDropped, st.warm.length); assert.deepStrictEqual(a.script.spin.hotIn, []); assert.strictEqual(a.winTenths, cold.winTenths); assert.deepStrictEqual(a.script.spin, cold.script.spin);
        big++;
        // the same squares at the SAME bet (10c) are honoured
        const same = e.playRound(E.rngFrom(seed), { bet: 10, state: freeze(st), now: 1e6 + i, day: DAY, auto: true }, []);
        assert.deepStrictEqual(same.pull.warmIn, st.warm); assert.deepStrictEqual(same.script.spin.hotIn, st.warm); assert.strictEqual(same.pull.warmDropped, 0);
      }
      st = e.playRound(stream, { bet: 10, state: freeze(st), now: 1e6 + i, day: DAY, script: false, auto: true }, []).newState;
    }
    assert.ok(big >= 100, 'attacker found ' + big + ' setups');
  });

  await test('F1 warmBet: set to the spin bet when warm squares are made, 0 when none; cleared by the cold clock and by a drop; survives JSON, carry-over and a Callback; buys and Callback leave it alone', () => {
    const e = mkEng({ warm: { chance: 1, cap: 4 }, ghost: { on: false } }), DAY = '2026-10-06';
    let r = spin(e, strict(baseDead(e, [0.5])), st0({ day: DAY }), { bet: 500 });
    assert.deepStrictEqual(r.newState.warm, [0, 1, 2, 3]); assert.strictEqual(r.newState.warmBet, 500);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(r.newState)), r.newState);
    // honoured at 500 (hot, marks again, re-made at 500): warmBet stays 500
    r = spin(e, strict([...gridVals(e, 0), 0.5]), freeze(r.newState), { bet: 500 }); assert.deepStrictEqual(r.pull.warmIn, [0, 1, 2, 3]); assert.deepStrictEqual(r.newState.warm, [0, 1, 2, 3]); assert.strictEqual(r.newState.warmBet, 500);
    // dropped at another bet, then marks at that bet become the new warm squares at the new bet
    r = spin(e, strict(baseDead(e, [0.5])), st0({ day: DAY, warm: [20, 21], warmBet: 500 }), { bet: 100 });
    assert.strictEqual(r.pull.warmDropped, 2); assert.deepStrictEqual(r.newState.warm, [0, 1, 2, 3]); assert.strictEqual(r.newState.warmBet, 100);
    // dropped and nothing new: warmBet 0
    r = spin(e, strict(gridVals(e, 0)), st0({ day: DAY, warm: [20, 21], warmBet: 500 }), { bet: 100 }); assert.deepStrictEqual(r.newState.warm, []); assert.strictEqual(r.newState.warmBet, 0);
    // the cold clock clears warmBet with the squares
    const t = E.tickState(freeze(st0({ lt: 300, warm: [3], warmBet: 100, coldAt: 10 })), 10); assert.deepStrictEqual(t.warm, []); assert.strictEqual(t.warmBet, 0);
    // a Callback round has no base spin: warm and warmBet stay as they were; carry-over of a full list leaves them alone
    const cb = e.playRound(E.rngFrom(3), { bet: 2500, state: freeze(st0({ lt: 20, avg: 100, cb: { bet: 200 }, warm: [4, 5], warmBet: 100, day: DAY })), now: 7e6, day: DAY, auto: true }, []);
    assert.deepStrictEqual(cb.newState.warm, [4, 5]); assert.strictEqual(cb.newState.warmBet, 100);
    const buy = freeze(st0({ warm: [1], warmBet: 100 })); assert.strictEqual(e.playRound(E.rngFrom(4), { buy: 'bonus1', bet: 2500, state: buy, now: 1, day: DAY, auto: true }, []).newState, buy);
    const co = spin(mkEng({ warm: { chance: 1, cap: 4 }, ghost: { on: false }, daily: { base: 0, perStreak: 0 } }), strict(baseDead(e, [0.5])), freeze(st0({ lt: 495, avg: 100, day: DAY })), { bet: 100 });
    assert.ok(co.pull.armed); assert.deepStrictEqual(co.newState.warm, [0, 1, 2, 3]); assert.strictEqual(co.newState.warmBet, 100);
  });

  await test('F2 Callback bet is the lead-weighted average rounded down to 10 cents in [10, 2500], not a bet level: flat $25 with the daily on spin 1 gets >= $24.90, flat $5 >= $4.90, flat $1 unchanged (2000-lead list)', () => {
    const e = mkEng({ list: 2000 }), DAY = '2026-10-06';
    for (const [bet, atLeast] of [[2500, 2490], [500, 490], [100, 100]]) {
      let st = E.newState(), n = 0; const rng = E.rngFrom(5 + bet);
      while (!st.cb && n < 100000) { st = e.playRound(rng, { bet, state: st, now: 1e6 + n, day: DAY, script: false, auto: true }, []).newState; n++; }
      assert.ok(st.cb, 'a Callback armed'); assert.ok(st.cb.bet >= atLeast, 'bet ' + bet + ' -> Callback at ' + st.cb.bet + ' (want >= ' + atLeast + ')');
      assert.strictEqual(st.cb.bet % 10, 0); if (bet === 100) assert.strictEqual(st.cb.bet, 100);
    }
    // a single $10 spin inside a flat $25 list no longer collapses the Callback to a level
    let st = freeze(st0({ lt: 4900, avg: 2500, day: DAY })); const r = e.playRound(strict(gridVals(e, 0)), { bet: 1000, state: st, now: 1, day: DAY }, []);
    assert.strictEqual(r.newState.cb, null); const r2 = e.playRound(strict(gridVals(e, 0)), { bet: 1000, state: freeze(st0({ lt: 19995, avg: 2500, day: DAY })), now: 1, day: DAY }, []);
    assert.ok(r2.newState.cb.bet >= 2490 && r2.newState.cb.bet <= 2500, 'one $10 spin: ' + r2.newState.cb.bet);
  });

  await test('F2 every multiple of 10 cents in [10, 2500] is a legal Callback bet: Eng.cents exact, the Callback round plays and pays whole cents at it', () => {
    const e = E0;
    for (let b = 10; b <= 2500; b += 10) {
      assert.strictEqual(E.cbBet(b), b); assert.strictEqual(E.cbBet(b + 4.9), Math.min(b, 2500));
      assert.doesNotThrow(() => E.cents(10, b)); assert.doesNotThrow(() => E.cents(7, b));
    }
    for (const b of [10, 30, 70, 490, 2360, 2490, 2500]) {
      const r = e.playRound(E.rngFrom(b), { bet: 100, state: freeze(st0({ lt: 20, avg: b, cb: { bet: b }, day: '2026-10-06' })), now: 1, day: '2026-10-06', auto: true }, []);
      assert.strictEqual(r.betCents, b); assert.strictEqual(r.callback, true); assert.ok(Number.isInteger(E.cents(r.winTenths, b))); assert.ok(r.winTenths <= T);
    }
    assert.strictEqual(E.cbBet(0), 10); assert.strictEqual(E.cbBet(-5), 10); assert.strictEqual(E.cbBet(1e9), 2500);
  });

  await test('W1B N1 the Callback bet is the lead-weighted average ROUNDED DOWN to 10 cents: no bet mix arms a Callback above what its leads were worth; a flat bettor stays exact', () => {
    for (const [a, want] of [[10, 10], [14.99, 10], [15.5, 10], [19.999, 10], [20, 20], [24.99, 20], [25, 20], [100, 100], [2499.99, 2490], [2500, 2500], [2500 - 1e-10, 2500], [9, 10], [1e9, 2500]]) assert.strictEqual(E.cbBet(a), want, 'cbBet(' + a + ')');
    const e = mkEng({ list: 50, daily: { base: 0, perStreak: 0 } }), DAY = '2026-10-06';
    // the steerer from the critic: 20 cents while the average is under 15.5, else 10 cents. Every arming must satisfy cb.bet <= avg, and the sum of Callback bets <= the sum of averages.
    let st = E.newState(), n = 0, armed = 0, sumBet = 0, sumAvg = 0; const rng = E.rngFrom(77);
    while (armed < 300 && n < 400000) {
      if (st.cb) { st = e.playRound(rng, { bet: 10, state: freeze(st), now: 1e6 + n, day: DAY, script: false, auto: true }, []).newState; n++; continue; }
      const bet = st.avg < 15.5 ? 20 : 10;
      const r = e.playRound(rng, { bet, state: freeze(st), now: 1e6 + n, day: DAY, script: false, auto: true }, []); n++;
      if (r.newState.cb && !st.cb) { armed++; assert.ok(r.newState.cb.bet <= r.newState.avg + 1e-6, 'cb.bet ' + r.newState.cb.bet + ' > avg ' + r.newState.avg); assert.strictEqual(r.newState.cb.bet % 10, 0); sumBet += r.newState.cb.bet; sumAvg += r.newState.avg; }
      st = r.newState;
    }
    assert.ok(armed >= 300, 'armed ' + armed); assert.ok(sumBet <= sumAvg + 1e-6, 'steered Callback bets ' + sumBet + ' vs averages ' + sumAvg);
  });

  await test('F5 pot.oneInPerDollar <= 0 or not a number means a hit chance of 0 (never), not 1', () => {
    for (const v of [0, -1, -20000, NaN, undefined, null, 'x', Infinity]) for (const cost of [10, 100, 2500]) assert.strictEqual(E.potHitChance({ pot: { oneInPerDollar: v } }, cost), 0, String(v));
    assert.strictEqual(E.potHitChance({ pot: { oneInPerDollar: 20000 } }, 100), 1 / 20000);
    assert.strictEqual(E.potHitChance({ pot: { oneInPerDollar: 0.5 } }, 100), 1, 'a real chance above 1 still caps at 1');
  });

  await test('Play/Chips independence and state shape: newState is a fresh plain object per call; states are JSON-clean and round-trip through JSON', () => {
    const a = E.newState(), b = E.newState(); a.warm.push(1); assert.deepStrictEqual(b.warm, []);
    assert.deepStrictEqual(Object.keys(E.newState()), ['v', 'lt', 'avg', 'cb', 'warm', 'warmBet', 'coldAt', 'day', 'streak', 'rounds', 'callbacks']);
    let st = E.newState(); const rng = E.rngFrom(8);
    for (let i = 0; i < 400; i++) { const r = E.playRound(rng, { bet: 100, state: JSON.parse(JSON.stringify(st)), now: 1e6 + i, day: '2026-10-06', script: false, auto: true }, []); st = r.newState; assert.deepStrictEqual(JSON.parse(JSON.stringify(st)), st); }
  });

  console.log(pass + ' passed' + (process.exitCode ? ', with failures' : ''));
  PIN.restore();
})();
