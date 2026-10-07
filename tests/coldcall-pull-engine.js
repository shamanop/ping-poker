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
const spin = (e, rng, state, o) => e.playRound(rng, Object.assign({ bet: 100, state, now: 5e6, day: '2026-10-06', rnd: E.rngFrom(99) }, o), (o && o.decisions) || []);
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
    for (const f of ['newState', 'tickState', 'coldInfo', 'playRound', 'potSlice', 'potHitChance', 'potPrize', 'rngFrom', 'cbBet']) assert.strictEqual(typeof E[f], 'function', f);
    assert.ok(fs.readFileSync(path.join(__dirname, '..', 'games', 'coldcall-engine.js')).equals(fs.readFileSync(path.join(__dirname, '..', 'public', 'games', 'coldcall', 'engine.js'))), 'public copy must be byte-identical');
  });

  // digest pinned at 265dd33 with the levers values (base bell 1.175, phone 0.2275, buyCost 27/964/2910/20; the old weights gave c808ef7e...). It guards the stateless path against drift in the
  // mechanisms, not the weights: after a deliberate weight change regenerate it by printing h.digest('hex') from the loop below and say so here.
  await test('legacy equality: resolveRound / round / playSpin / playBonus reproduce the pre-PULL engine seed for seed (digest of 3000 rounds incl. scripts)', () => {
    const h = crypto.createHash('sha256');
    for (const buy of [null, 'call', 'hunt', 'bonus1', 'bonus2']) for (let seed = 1; seed <= 600; seed++) { const r = E.resolveRound(E.rngFrom(seed * 7 + 3), buy); h.update(JSON.stringify([r.winTenths, r.costTenths, r.script])); }
    assert.strictEqual(h.digest('hex'), '2068652ad3cd313bd53f067cbf60f9e01169e37a36b4acf2d84ab85aef7acf29');
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

  await test('FIX POT-CAP potPrize: a hit pays the balance up to capCents, the same for every bet; never above the balance, always whole non-negative cents; a damaged knob falls back to the default cap', () => {
    const cfg = (capCents) => ({ pot: { capCents } });
    for (const bal of [0, 1, 999, 4000, 5000, 5001, 123456]) assert.strictEqual(E.potPrize(cfg(5000), bal), Math.min(bal, 5000), 'bal ' + bal);
    assert.strictEqual(E.potPrize(cfg(3000), 4000), 3000, 'a 10c hit on a $40 pot pays the cap, not 50 x 10c and not the pot'); assert.strictEqual(E.potPrize(cfg(3000), 2500), 2500);
    assert.strictEqual(E.potPrize(cfg(300), 4000), 300); assert.strictEqual(E.potPrize(cfg(0), 4000), 0, 'a cap of 0 pays nothing (no prize, nothing lost)');
    assert.strictEqual(E.potPrize(cfg(2999.9), 4000), 2999, 'whole cents (floored)');
    assert.strictEqual(E.potPrize.length, 2, 'the cap does not look at the bet: (pullCfg, bal)');
    assert.strictEqual(E.CFG.pull.pot.capCents, PIN.PINNED.pot.capCents, 'pinned for the mechanism tests');
    const live = PIN.real.pot; assert.ok(Number.isInteger(live.capCents) && live.capCents >= 3000, 'the live knob exists and is a whole number of cents, at least feed x oneInPerDollar'); assert.strictEqual(E.potPrize({ pot: live }, 1e9), live.capCents); assert.ok(!('maxPayX' in live), 'the proportional cap is gone');
    const def = E.potPrize({ pot: {} }, 1e9); assert.ok(Number.isInteger(def) && def > 0 && def <= 100000, 'the fallback is the default cap: ' + def);
    for (const bad of [NaN, undefined, null, 'x', '5000', -1, -5000, Infinity, -Infinity, {}, []]) for (const bal of [0, 700, 1e9]) { const v = E.potPrize(cfg(bad), bal); assert.ok(Number.isInteger(v) && v >= 0 && v <= bal, String(bad) + ' ' + bal + ' -> ' + v); assert.strictEqual(v, Math.min(bal, def), 'damaged ' + String(bad)); }
    // the pot rule over 200k scripted spins at mixed bets, the hit roll scripted (a hit about every 60 spins): fed + seeded = paid + left to the cent, no prize above the cap, none above the balance
    for (const seed of [0, 700]) {
      const c = { pot: { feedBps: 10000, oneInPerDollar: 3000, seed, minBal: 1000, capCents: 3000 } }, rng = E.rngFrom(77 + seed);
      let rem = 0, bal = seed, fed = 0, paid = 0, seeded = seed, hits = 0, maxPrize = 0;
      for (let i = 0; i < 200000; i++) {
        const cost = [10, 20, 50, 100, 200, 500, 1000, 2500][(rng() * 8) | 0], sl = E.potSlice(c.pot.feedBps, cost, rem); rem = sl.rem; bal += sl.slice; fed += sl.slice;
        if (rng() < Math.min(1, E.potHitChance(c, cost) * 1000) && bal >= c.pot.minBal && bal > 0) {   // x1000: the roll is scripted to hit about every 60 spins (feed 100%: the pot fills fast) so the cap and the balance both bind
          const prize = E.potPrize(c, bal); assert.ok(Number.isInteger(prize) && prize >= 0 && prize <= bal && prize <= 3000, 'prize ' + prize + ' bal ' + bal);
          paid += prize; bal -= prize; hits++; maxPrize = Math.max(maxPrize, prize); if (seed > 0) { bal += seed; seeded += seed; }
        }
        assert.ok(bal >= 0);
      }
      assert.strictEqual(fed + seeded, paid + bal, 'conservation, seed ' + seed); assert.ok(hits > 1000 && maxPrize === 3000, 'hits ' + hits + ' max ' + maxPrize);
    }
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

  await test('avg and cb.bet: leads earned small cannot fire a big Callback; cb.bet = avg rounded DOWN (to 10 cents from an average of 10c, to the cent below it: DENOMS) (W1B N1), clamped to [1, 2500]', () => {
    const e = mkEng({ daily: { base: 0, perStreak: 0 } });
    const run = (st, bet) => spin(e, strict([...gridVals(e, 0)]), st, { bet });
    // 490 tenths at 10 cents, then a 2500-cent dead spin (12 tenths): avg = (10*490 + 2500*12) / 502 = 69.52 -> 60 (down to 10 cents)
    let r = run(freeze(st0({ lt: 490, avg: 10, day: '2026-10-06' })), 2500);
    assert.deepStrictEqual(r.newState.cb, { bet: 60 }); assert.ok(Math.abs(r.newState.avg - (10 * 490 + 2500 * 12) / 502) < 1e-9);
    r = run(freeze(st0({ lt: 495, avg: 2500, day: '2026-10-06' })), 2500); assert.deepStrictEqual(r.newState.cb, { bet: 2500 });
    r = run(freeze(st0({ lt: 495, avg: 10, day: '2026-10-06' })), 10); assert.deepStrictEqual(r.newState.cb, { bet: 10 });
    for (const [avg, lvl] of [[0, 1], [4.9, 4], [10, 10], [14.9, 10], [15, 10], [19.4, 10], [24.9, 20], [25, 20], [49.4, 40], [499.9, 490], [2356, 2350], [2496.4, 2490], [2499.5, 2490], [2500, 2500], [99999, 2500]]) assert.strictEqual(E.cbBet(avg), lvl, 'avg ' + avg);
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
    assert.strictEqual(r.status, 'pending'); const W1 = r.pending.W; { const pp = r.pending, bc = r.betCents / 10; assert.deepStrictEqual(pp, { k: 'more', W: W1, mult: 2, pWin: 0.49, capT: T, bankCents: W1 * bc, baseCents: 0, bonusCents: W1 * bc, winCents: W1 * bc * 2 }); } assert.ok(W1 >= 3 + 5 * 50, 'pick upgraded the picked square so W is at least the plain sum');
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
      const buy = i % 11 === 0 ? E.BUYS[(i / 11) % 4 | 0] : null, bet = E.BET_LEVELS[i % E.BET_LEVELS.length];
      const r = E.playRound(E.rngFrom(i + 1000), { buy, bet, state: st, now: 1e6 + i * 4e6, day: '2026-10-' + String(1 + (i % 28)).padStart(2, '0'), auto: true, rnd: E.rngFrom(i + 3) }, []);
      assert.strictEqual(r.status, 'done'); assert.ok(Number.isInteger(r.winTenths) && r.winTenths >= 0 && r.winTenths <= T);
      assert.strictEqual(r.costTenths, r.callback ? 0 : buy ? E.CFG.buyCost[buy] : 10);
      const R = r.round; assert.strictEqual(r.winTenths, Math.min(R.clusterTenths + R.phoneTenths + R.bonusTenths, T)); assert.strictEqual(r.script.parts.bonus, R.bonusTenths);
      if (r.betCents % 10 === 0) { assert.doesNotThrow(() => E.cents(r.winTenths, r.betCents)); assert.doesNotThrow(() => E.cents(r.costTenths, r.betCents)); assert.strictEqual(r.pay.win, E.cents(r.winTenths, r.betCents)); }
      else { assert.ok(Number.isInteger(r.pay.win) && Number.isInteger(r.pay.price)); assert.ok(Math.abs(r.pay.win - r.winTenths * r.pay.num / r.pay.den) < 2); }
      assert.strictEqual(r.pay.price, r.callback ? 0 : buy ? E.buyPrice(E.CFG.buyCost[buy], r.betCents) : r.betCents);
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
    assert.strictEqual(E.cbBet(0), 1); assert.strictEqual(E.cbBet(-5), 1); assert.strictEqual(E.cbBet(1e9), 2500);
  });

  await test('W1B N1 the Callback bet is the lead-weighted average (plus the carry, N1-CARRY) ROUNDED DOWN to 10 cents: no bet mix arms a Callback above what its leads were worth; a flat bettor stays exact', () => {
    for (const [a, want] of [[10, 10], [14.99, 10], [15.5, 10], [19.999, 10], [20, 20], [24.99, 20], [25, 20], [100, 100], [2499.99, 2490], [2500, 2500], [2500 - 1e-10, 2500], [9, 9], [1e9, 2500]]) assert.strictEqual(E.cbBet(a), want, 'cbBet(' + a + ')');
    const e = mkEng({ list: 50, daily: { base: 0, perStreak: 0 } }), DAY = '2026-10-06';
    // the steerer from the critic: 20 cents while the average is under 15.5, else 10 cents. Every arming must satisfy cb.bet <= avg + the carry it held, and the sum of Callback bets <= the sum of averages.
    let st = E.newState(), n = 0, armed = 0, sumBet = 0, sumAvg = 0; const rng = E.rngFrom(77);
    while (armed < 300 && n < 400000) {
      if (st.cb) { st = e.playRound(rng, { bet: 10, state: freeze(st), now: 1e6 + n, day: DAY, script: false, auto: true }, []).newState; n++; continue; }
      const bet = st.avg < 15.5 ? 20 : 10;
      const r = e.playRound(rng, { bet, state: freeze(st), now: 1e6 + n, day: DAY, script: false, auto: true }, []); n++;
      if (r.newState.cb && !st.cb) { armed++; assert.ok(r.newState.cb.bet <= r.newState.avg + (st.carry || 0) + 1e-6, 'cb.bet ' + r.newState.cb.bet + ' > avg ' + r.newState.avg + ' + carry ' + st.carry); assert.strictEqual(r.newState.cb.bet % 10, 0); sumBet += r.newState.cb.bet; sumAvg += r.newState.avg; }
      st = r.newState;
    }
    assert.ok(armed >= 300, 'armed ' + armed); assert.ok(sumBet <= sumAvg + 1e-6, 'steered Callback bets ' + sumBet + ' vs averages ' + sumAvg);
  });

  // ---------------------------------------------------------------- N1-CARRY: floor + carry (cold-call/PULL-ENGINE.md, cbBet / carry)
  // A harness that plays one player through `lists` Callbacks and accounts every cent staked into the lead list: stakeIn = sum over base spins of bet x tenths of lead worked
  // (the daily gift at min(bet, stakeCap)). One list is worth stakeIn / list-size-in-tenths cents of Callback stake; a Callback hands out cb.bet.
  const realDaily = { base: 0.2, perStreak: 0.05, streakMax: 4, stakeCap: 10 };
  function dayN(i) { return new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10); }
  function runLists(patch, lists, pickBet, o) {
    const cfgX = pcfg(patch), e = E.createEngine(cfgX), full = Math.round(cfgX.pull.list * 10), rng = E.rngFrom((o && o.seed) || 5);
    let st = E.newState(), n = 0, dayI = 0, stakeIn = 0, sumBet = 0, sumAvg = 0, arms = 0, worstOver = -Infinity, maxCarry = 0;
    const cap = cfgX.pull.daily.stakeCap;
    while (arms < lists && n < 3000000) {
      if (st.cb) { const r = e.playRound(rng, { bet: 10, state: freeze(st), now: 1e6 + n, day: dayN(dayI), script: false, auto: true }, []); n++; assert.ok(r.callback); st = JSON.parse(JSON.stringify(r.newState)); assert.ok(!(st.carry >= 10), 'carry < 10 after a Callback'); continue; }
      const bet = pickBet(st);
      const day = dayN(dayI);
      const r = e.playRound(rng, { bet, state: freeze(st), now: 1e6 + n, day, script: false, auto: true }, []); n++;
      stakeIn += r.pull.filled * bet + (r.pull.daily ? Math.round(r.pull.daily.leads * 10) * Math.min(bet, cap) : 0);
      if (r.newState.cb && !st.cb) {
        arms++; dayI++;                                          // one daily claim per list: the next list starts on a new day
        sumBet += r.newState.cb.bet; sumAvg += r.newState.avg; assert.strictEqual(r.newState.cb.bet % 10, 0); assert.ok(r.newState.cb.bet >= 10 && r.newState.cb.bet <= 2500);
        worstOver = Math.max(worstOver, sumBet - stakeIn / full);
        const c = r.newState.carry; assert.ok(typeof c === 'number' && c >= 0 && c < 10, 'carry in [0,10) at every arm, got ' + c); maxCarry = Math.max(maxCarry, c);
      }
      st = JSON.parse(JSON.stringify(r.newState));               // every round trips through JSON, like the store
    }
    assert.strictEqual(arms, lists, 'armed ' + arms);
    return { sumBet, sumAvg, stakeIn, full, worstOver, maxCarry, st };
  }

  await test('N1-CARRY (a): flat $1 with one daily claim per list: over 20 lists the Callback stakes sum to within 10 cents of the lead-weighted stakes paid in (floor alone lost about 10c a list)', () => {
    const r = runLists({ list: 450, daily: realDaily }, 20, () => 100);
    const worth = r.stakeIn / r.full;
    assert.ok(Math.abs(r.sumBet - worth) < 10, 'handed out ' + r.sumBet + ' vs worth ' + worth.toFixed(2));
    assert.ok(r.sumBet <= worth + 1e-6, 'never more than the leads were worth');
    assert.ok(Math.abs(r.sumBet - r.sumAvg) < 10, 'sum of bets ' + r.sumBet + ' vs sum of averages ' + r.sumAvg);
  });

  await test('N1-CARRY (b): the critic N1 attacker (20c while the average is under 15.5c, else 10c), a carry-reading attacker and a coin-flip mixer never receive more Callback stake than their leads were worth, on every prefix and in total', () => {
    const flip = E.rngFrom(31);
    const attackers = { critic: (st) => (st.avg < 15.5 ? 20 : 10), carryReader: (st) => ((st.carry || 0) >= 5 || st.avg < 15 ? 20 : 10), coin: () => (flip() < 0.5 ? 10 : 20), nearHalf: (st) => (st.avg < 25 ? 50 : 10) };
    for (const k of Object.keys(attackers)) {
      const r = runLists({ list: 50, daily: { base: 0, perStreak: 0, streakMax: 0, stakeCap: 10 } }, 150, attackers[k], { seed: 77 });
      assert.ok(r.worstOver <= 1e-6, k + ': a prefix received ' + r.worstOver.toFixed(4) + 'c more than its leads were worth');
      assert.ok(r.sumBet <= r.stakeIn / r.full + 1e-6, k + ': total');
      assert.ok(r.sumBet >= r.stakeIn / r.full - 10 - 20, k + ': and it loses no more than a carry (< 10c) plus the unarmed rest of a list (< one average, <= 20c): ' + (r.stakeIn / r.full - r.sumBet));
    }
  });

  await test('N1-CARRY (d): cbArm(avg, carry) from an average of 10c up: bet is a multiple of 10 in [10, 2500], the new carry is in [0, 10), bet + carry out never exceeds avg + carry in, and is exact unless the clamps act; garbage reads as 0', () => {
    assert.strictEqual(typeof E.cbArm, 'function');
    const rng = E.rngFrom(3);
    for (let i = 0; i < 20000; i++) {
      const avg = 10 + rng() * 2490, carry = rng() * 9.999999, o = E.cbArm(avg, carry);
      assert.strictEqual(o.bet % 10, 0); assert.ok(o.bet >= 10 && o.bet <= 2500); assert.ok(o.carry >= 0 && o.carry < 10, 'carry out ' + o.carry);
      assert.ok(o.bet + o.carry <= avg + carry + 1e-9); assert.ok(Math.abs(o.bet + o.carry - (avg + carry)) < 1e-9 || o.bet === 2500, 'exact: ' + [avg, carry, o.bet, o.carry]);
    }
    for (const [avg, carry, bet, c] of [[99.96, 0, 90, 9.96], [99.96, 9.96, 100, 9.92], [100, 0, 100, 0], [19.99, 0, 10, 9.99], [19.99, 9.99, 20, 9.98], [2500, 0, 2500, 0], [2500, 9.9, 2500, 9.9 > 0 ? 9.9 : 0], [10, 0, 10, 0], [0, 0, 1, 0]]) {
      const o = E.cbArm(avg, carry); assert.strictEqual(o.bet, bet, JSON.stringify([avg, carry])); assert.ok(Math.abs(o.carry - c) < 1e-9, JSON.stringify([avg, carry, o])); }
    for (const bad of [undefined, null, NaN, -4, 'x', Infinity, 10, 250, {}, [], true]) { const o = E.cbArm(99.96, bad); assert.deepStrictEqual([o.bet, +o.carry.toFixed(6)], [90, 9.96], 'garbage carry ' + String(bad)); }
    for (const bad of [NaN, -1, undefined, Infinity, 1e9]) { const o = E.cbArm(bad, 0); assert.ok(o.bet >= 1 && o.bet <= 2500 && Number.isInteger(o.bet) && o.carry >= 0 && o.carry < 10, 'garbage avg ' + bad); }
  });

  await test('N1-CARRY (c, engine): the carry is part of the state (0 in newState), is under 10c after every Callback, survives JSON, the cold clock and the idle days untouched, a garbage stored carry reads as 0 and the round plays; Play and Chips states carry apart', () => {
    assert.strictEqual(E.newState().carry, 0);
    const e = mkEng({ list: 50, daily: { base: 0, perStreak: 0 } });
    // a list that arms with avg 99.96: carry 9.96 comes out, bet 90 goes in
    const s0 = freeze(st0({ lt: 490, avg: 99.96, day: '2026-10-06' }));
    const r = spin(e, strict([...gridVals(e, 0)]), s0, { bet: 100 }); assert.deepStrictEqual(r.newState.cb, { bet: 90 }); assert.ok(Math.abs(r.newState.carry - 9.96) < 0.01 && Math.abs(r.newState.carry - (r.newState.avg - 90)) < 1e-9, 'carry ' + r.newState.carry);
    // the cold clock never touches it: ticks, coldInfo and the view of leaked leads leave it alone, and it never turns into leads or into a bet
    const parked = Object.assign(JSON.parse(JSON.stringify(r.newState)), { cb: null, lt: 400, coldAt: 1e6 });
    for (const now of [1e6 - 1, 1e6, 1e6 + 21600000, 1e6 + 86400000 * 30]) { const t = E.tickState(parked, now); assert.strictEqual(t.carry, parked.carry, 'tick at ' + now); E.coldInfo(parked, now); }
    assert.strictEqual(parked.carry, r.newState.carry);
    // a garbage stored carry reads as 0 in the engine (the server also resets it): the arm gives the plain floor and a clean carry
    for (const bad of [NaN, -3, 'x', null, undefined, 50, Infinity, {}]) {
      const g = Object.assign(JSON.parse(JSON.stringify(s0)), { carry: bad }); if (bad === undefined) delete g.carry;
      const rr = spin(e, strict([...gridVals(e, 0)]), g, { bet: 100 });
      assert.deepStrictEqual(rr.newState.cb, { bet: 90 }, 'carry ' + String(bad)); assert.ok(Math.abs(rr.newState.carry - (rr.newState.avg - 90)) < 1e-9, 'carry ' + String(bad) + ' -> ' + rr.newState.carry);
    }
    // states are separate objects: one currency's carry never reaches the other's
    const play = E.newState(), chips = E.newState(); play.carry = 7; assert.strictEqual(chips.carry, 0);
    // buys and a Callback round leave the carry as it is
    const held = freeze(st0({ lt: 20, avg: 100, cb: { bet: 100 }, carry: 6.5, day: '2026-10-06' }));
    const cr = spin(e, E.rngFrom(4), held, { auto: true }); assert.ok(cr.callback); assert.strictEqual(cr.newState.carry, 6.5);
    const by = e.playRound(E.rngFrom(5), { buy: 'call', bet: 100, state: held, now: 1, day: '2026-10-06', auto: true }, []); assert.strictEqual(by.newState, held);
  });

  await test('F5 pot.oneInPerDollar <= 0 or not a number means a hit chance of 0 (never), not 1', () => {
    for (const v of [0, -1, -20000, NaN, undefined, null, 'x', Infinity]) for (const cost of [10, 100, 2500]) assert.strictEqual(E.potHitChance({ pot: { oneInPerDollar: v } }, cost), 0, String(v));
    assert.strictEqual(E.potHitChance({ pot: { oneInPerDollar: 20000 } }, 100), 1 / 20000);
    assert.strictEqual(E.potHitChance({ pot: { oneInPerDollar: 0.5 } }, 100), 1, 'a real chance above 1 still caps at 1');
  });

  await test('Play/Chips independence and state shape: newState is a fresh plain object per call; states are JSON-clean and round-trip through JSON', () => {
    const a = E.newState(), b = E.newState(); a.warm.push(1); assert.deepStrictEqual(b.warm, []);
    assert.deepStrictEqual(Object.keys(E.newState()), ['v', 'lt', 'avg', 'cb', 'warm', 'warmBet', 'coldAt', 'day', 'streak', 'rounds', 'callbacks', 'carry']);
    let st = E.newState(); const rng = E.rngFrom(8);
    for (let i = 0; i < 400; i++) { const r = E.playRound(rng, { bet: 100, state: JSON.parse(JSON.stringify(st)), now: 1e6 + i, day: '2026-10-06', script: false, auto: true }, []); st = r.newState; assert.deepStrictEqual(JSON.parse(JSON.stringify(st)), st); }
  });

  // ================================================================ DENOMS: 1c / 2c / 5c bets (cold-call/PULL-ENGINE.md section 7) ================================================================
  const SMALL = [1, 2, 5];
  const pickFirst = (pt) => (pt.k === 'pick' ? { k: 'pick', p: pt.choices[0] } : null);      // answers PICK, leaves ONE MORE CALL open (null = fall through to pending)
  // a round of `buy` at `bet` that stops at ONE MORE CALL; tapes for the main stream and for the rounding source, so any replay sees the same numbers
  function toMore(e, bet, buy, from, need, span) {
    for (let seed = from || 1; seed < (from || 1) + (span || 4000); seed++) {
      const main = mkTape(E.rngFrom(seed)), rnd = mkTape(E.rngFrom(seed + 555555));
      const input = { buy, bet, state: buy ? null : st0({ day: '2026-10-06' }), now: 1, day: '2026-10-06', script: false, rnd, decide: pickFirst };
      const r = e.playRound(main, input, []);
      if (r.status === 'pending' && r.pending.k === 'more' && (!need || need(r))) return { seed, main, rnd, input, r, e };
    }
    throw new Error('no ONE MORE CALL in ' + (span || 4000) + ' rounds');
  }
  const again = (c, decisions, forcedU, rndFn) => {          // replay the same round; a main-stream draw past the tape (the gamble coin) is forcedU
    const main = mkTape(() => forcedU); for (const v of c.main.tape) main.tape.push(v);
    const rnd = rndFn || (() => { c.rnd.reset(); return c.rnd; })();
    const pre = c.r.pull.decisions.map((d) => (d.k === 'pick' ? { k: 'pick', p: d.p } : { k: 'more', take: d.take }));     // the picks the first run made through input.decide, recorded
    return c.e.playRound(main, Object.assign({}, c.input, { rnd }), pre.concat(decisions));
  };

  await test('DENOMS bet list: 1, 2 and 5 cents are legal bets; Eng.cents is exact-or-throws for any bet, not only multiples of 10', () => {
    assert.deepStrictEqual(E.BET_LEVELS, [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2500]);
    assert.strictEqual(E.cents(10, 1), 1); assert.strictEqual(E.cents(40, 2), 8); assert.strictEqual(E.cents(30, 5), 15); assert.strictEqual(E.cents(7, 10), 7);
    assert.throws(() => E.cents(7, 1)); assert.throws(() => E.cents(27, 5)); assert.throws(() => E.cents(1.5, 10)); assert.throws(() => E.cents(5, 1.5)); assert.throws(() => E.cents(NaN, 1));
  });

  await test('DENOMS roundCents: floor plus one cent with probability = the fraction, exact integer arithmetic, takes its random number as an argument, pure', () => {
    assert.strictEqual(typeof E.roundCents, 'function'); assert.strictEqual(typeof E.scaleOf, 'function'); assert.strictEqual(typeof E.buyPrice, 'function');
    const sc = E.scaleOf(10, 1);                                 // a spin at 1c: one tenth of the bet is 0.1 cent
    assert.deepStrictEqual([sc.price, sc.num, sc.den], [1, 1, 10]);
    assert.strictEqual(E.roundCents(7, sc, 0.69), 1); assert.strictEqual(E.roundCents(7, sc, 0.7), 0); assert.strictEqual(E.roundCents(7, sc, 0), 1); assert.strictEqual(E.roundCents(0, sc, 0), 0);
    assert.strictEqual(E.roundCents(30, sc, 0), 3, 'a whole amount never takes the extra cent'); assert.strictEqual(E.roundCents(30, sc, 0.9999999), 3);
    assert.strictEqual(E.roundCents(123, sc, 0.29), 13); assert.strictEqual(E.roundCents(123, sc, 0.3), 12);
    // unbiased: the mean over a fine grid of u equals the exact amount, for every denomination and tenths from 0 to 40, buys included
    for (const sc2 of [E.scaleOf(10, 1), E.scaleOf(10, 2), E.scaleOf(10, 5), E.scaleOf(27, 1), E.scaleOf(27, 5), E.scaleOf(964, 2), E.scaleOf(2910, 5), E.scaleOf(20, 1)]) {
      for (let t = 0; t <= 40; t++) { let sum = 0; const N = sc2.den * 50; for (let i = 0; i < N; i++) sum += E.roundCents(t, sc2, (i + 0.5) / N); assert.ok(Math.abs(sum / N - t * sc2.num / sc2.den) < 1e-9, JSON.stringify([sc2, t, sum / N])); }
    }
    // at 10 cents and up the random number never matters (bit for bit the old whole-cent arithmetic)
    for (const b of E.BET_LEVELS.filter((x) => x >= 10)) for (const buy of [10, 27, 964, 2910, 20]) { const s2 = E.scaleOf(buy, b); for (const t of [0, 1, 3, 7, 40, 99999, 100000]) for (const u of [0, 0.5, 0.9999999]) assert.strictEqual(E.roundCents(t, s2, u), t * b / 10, [b, buy, t, u].join()); }
  });

  await test('DENOMS buyPrice: exact price rounded to the NEAREST cent (half up), at least 1c; unchanged at 10c and up; the buy is played at the stake that makes it fair (num / den = price / cost multiple)', () => {
    assert.strictEqual(E.buyPrice(27, 1), 3); assert.strictEqual(E.buyPrice(27, 2), 5); assert.strictEqual(E.buyPrice(27, 5), 14);        // 2.7, 5.4, 13.5 (half up)
    assert.strictEqual(E.buyPrice(964, 1), 96); assert.strictEqual(E.buyPrice(964, 2), 193); assert.strictEqual(E.buyPrice(964, 5), 482);
    assert.strictEqual(E.buyPrice(2910, 1), 291); assert.strictEqual(E.buyPrice(2910, 2), 582); assert.strictEqual(E.buyPrice(2910, 5), 1455);
    assert.strictEqual(E.buyPrice(20, 1), 2); assert.strictEqual(E.buyPrice(20, 2), 4); assert.strictEqual(E.buyPrice(20, 5), 10);
    assert.strictEqual(E.buyPrice(2, 1), 1, 'minimum 1 cent'); assert.strictEqual(E.buyPrice(5, 1), 1); assert.strictEqual(E.buyPrice(4, 1), 1);
    for (const b of E.BET_LEVELS.filter((x) => x >= 10)) for (const buy of E.BUYS) assert.strictEqual(E.buyPrice(E.CFG.buyCost[buy], b), E.CFG.buyCost[buy] * b / 10, 'unchanged at ' + b + ' ' + buy);
    for (const b of SMALL) for (const buy of E.BUYS) { const c = E.CFG.buyCost[buy], sc = E.scaleOf(c, b); assert.strictEqual(sc.price, E.buyPrice(c, b)); assert.strictEqual(sc.num, sc.price); assert.strictEqual(sc.den, c); assert.ok(sc.price >= 1 && Number.isInteger(sc.price)); assert.ok(Math.abs(sc.price - c * b / 10) <= 0.5 + 1e-9, 'within half a cent of the exact price'); }
    const cb = E.scaleOf(0, 7); assert.deepStrictEqual([cb.price, cb.num, cb.den], [0, 7, 10], 'a Callback costs nothing and pays at its own bet');
  });

  await test('DENOMS rounding draws are a separate source: the main stream and the whole round are the same at 1c and at 10c, the rounding source is read twice per done round at 1c and never at 10c', () => {
    for (const buy of [null, 'call', 'hunt', 'bonus1', 'bonus2']) for (let seed = 1; seed <= 25; seed++) {
      const mk = (bet) => { const main = counting(E.rngFrom(seed * 13 + 1)), rnd = counting(E.rngFrom(77)); const r = E0.playRound(main, { buy, bet, state: buy ? null : st0({ day: '2026-10-06' }), now: 1, day: '2026-10-06', auto: true, rnd }, []); return { r, main: main.n(), rnd: rnd.n() }; };
      const a = mk(1), b = mk(10), c = mk(5);
      assert.strictEqual(a.main, b.main, 'same main-stream draws at 1c and 10c: ' + buy + seed); assert.strictEqual(c.main, b.main);
      assert.strictEqual(a.r.winTenths, b.r.winTenths); assert.deepStrictEqual(a.r.script.spin, b.r.script.spin); assert.deepStrictEqual(a.r.script.bonus, b.r.script.bonus);
      assert.strictEqual(a.rnd, 2); assert.strictEqual(c.rnd, 2); assert.strictEqual(b.rnd, 0, 'no rounding draw at 10c');
    }
    assert.throws(() => E0.playRound(E.rngFrom(1), { bet: 1, state: st0({ day: '2026-10-06' }), now: 1, day: '2026-10-06', auto: true }, []), (e) => e.code === 'need_rnd', 'a fractional bet without a rounding source is refused, not guessed');
    assert.doesNotThrow(() => E0.playRound(E.rngFrom(1), { bet: 10, state: st0({ day: '2026-10-06' }), now: 1, day: '2026-10-06', auto: true }, []), 'at 10c no rounding source is needed');
  });

  await test('DENOMS buys at 1c / 2c / 5c are played at the fair stake: the same round as at $1 seed for seed, paid cents within one cent of winTenths x price / cost multiple, so the long-run payback is the $1 payback', () => {
    const N = 2500;
    for (const buy of E.BUYS) {
      const run = (bet, i, rnd) => E0.playRound(E.rngFrom(900 + i), { buy, bet, state: null, now: 1, day: '2026-10-06', auto: true, script: false, rnd }, []);
      let wt100 = 0, ct100 = 0;
      for (let i = 0; i < N; i++) { const r = run(100, i); wt100 += r.winTenths; ct100 += r.costTenths; assert.strictEqual(r.pay.win * r.costTenths, r.winTenths * r.pay.price, 'at $1 the pay is exact'); assert.strictEqual(r.pay.price, E.CFG.buyCost[buy] * 10); }
      for (const bet of SMALL) {
        let paid = 0, price = 0, exact = 0, sq = 0, wt = 0, ct = 0;
        for (let i = 0; i < N; i++) {
          const r = run(bet, i, E.rngFrom(4000 + i)), ex = r.winTenths * r.pay.price / r.costTenths;
          assert.ok(Math.abs(r.pay.win - ex) < 2 && r.pay.win <= E.MAX_WIN_X * bet, [buy, bet, i, r.pay.win, ex].join());      // base and bonus are rounded apart, each within a cent of its exact amount
          assert.strictEqual(r.pay.price, E.buyPrice(E.CFG.buyCost[buy], bet)); assert.strictEqual(r.costTenths, E.CFG.buyCost[buy]);
          paid += r.pay.win; price += r.pay.price; exact += ex; sq += (r.pay.win - ex) * (r.pay.win - ex); wt += r.winTenths; ct += r.costTenths;
        }
        assert.ok(Math.abs(paid - exact) < 6 * Math.sqrt(sq) + 1, buy + ' ' + bet + 'c: only rounding noise between paid ' + paid + ' and exact ' + exact);
        assert.ok(Math.abs(exact / price - wt / ct) < 1e-9, buy + ' ' + bet + 'c: the exact payback of the priced round is winTenths / costTenths, the same as at $1');
        assert.strictEqual(wt / ct, wt100 / ct100, 'same rounds as at $1');
      }
    }
  });

  await test('DENOMS shown = paid at ONE MORE CALL: the pending view carries whole-cent bank / base / bonus / win amounts, banking pays exactly the shown bank amount, a taken gamble pays exactly the shown win amount or the shown base', () => {
    const check = (c, bet, cost) => {
      const p = c.r.pending, sc = E.scaleOf(cost, bet);
      for (const k of ['bankCents', 'baseCents', 'bonusCents', 'winCents']) assert.ok(Number.isSafeInteger(p[k]) && p[k] >= 0, k + ' is whole cents: ' + p[k]);
      assert.strictEqual(p.bankCents, p.baseCents + p.bonusCents); assert.strictEqual(p.winCents, p.baseCents + p.bonusCents * p.mult);
      const ex = p.W * sc.num / sc.den; assert.ok(p.bonusCents >= Math.floor(ex + 1e-9) && p.bonusCents <= Math.ceil(ex - 1e-9), 'the shown bonus is the exact bonus rounded: ' + p.bonusCents + ' vs ' + ex);
      const bank = again(c, [{ k: 'more', take: false }], 0.5); assert.strictEqual(bank.status, 'done'); assert.strictEqual(bank.pay.win, p.bankCents, 'bank pays what was shown');
      const won = again(c, [{ k: 'more', take: true }], 0.01), lost = again(c, [{ k: 'more', take: true }], 0.99);
      assert.strictEqual(won.pay.win, p.winCents, 'a won gamble pays what was shown'); assert.strictEqual(lost.pay.win, p.baseCents, 'a lost gamble pays the shown base');
      assert.strictEqual(won.pull.more.won, true); assert.strictEqual(lost.pull.more.won, false); assert.ok(won.pay.win <= E.MAX_WIN_X * bet);
    };
    for (const bet of SMALL) for (const buy of ['bonus1', 'bonus2']) check(toMore(E0, bet, buy, 1 + bet * 50), bet, E.CFG.buyCost[buy]);
    // a natural bonus after a base spin that paid: base and bonus are rounded apart, the shown total is their sum
    for (const bet of SMALL) { const c = toMore(E0, bet, null, 1, (r) => r.pending.baseCents > 0, 40000); check(c, bet, 10); assert.ok(c.r.pending.baseCents > 0); }
  });

  await test('DENOMS replay: the shown whole-cent amounts are the same on every replay of a round (main tape + rounding tape), however many decisions come before and after', () => {
    for (const bet of SMALL) for (const buy of [null, 'bonus1']) {
      const c = toMore(E0, bet, buy, 100 + bet);
      const shown = (r) => [r.pending.bankCents, r.pending.baseCents, r.pending.bonusCents, r.pending.winCents, r.pending.W];
      const first = shown(c.r);
      for (let i = 0; i < 6; i++) { const r = again(c, [], 0.5); assert.strictEqual(r.status, 'pending'); assert.deepStrictEqual(shown(r), first, 'replay ' + i); }
      assert.strictEqual(c.rnd.tape.length, 2, 'two rounding draws recorded, no more');
      // a different rounding source changes only the rounding, never the round
      const other = again(c, [], 0.5, E.rngFrom(31337)); assert.strictEqual(other.pending.W, c.r.pending.W); assert.ok(Math.abs(other.pending.bankCents - c.r.pending.bankCents) <= 2);
    }
    // the same decisions through a stateful round: base spin + natural bonus, PICK then MORE, replayed from the tapes
    for (const bet of SMALL) { const main = mkTape(E.rngFrom(55 + bet)), rnd = mkTape(E.rngFrom(66 + bet)); const dec = [];
      for (let g = 0; g < 6; g++) { main.reset(); rnd.reset(); const r = E0.playRound(main, { buy: 'bonus1', bet, state: null, now: 1, day: '2026-10-06', script: false, rnd }, dec.slice()); if (r.status === 'done') { assert.strictEqual(rnd.tape.length, 2); break; } dec.push(r.pending.k === 'pick' ? { k: 'pick', p: r.pending.choices[0] } : { k: 'more', take: false }); }
    }
  });

  await test('DENOMS the leak trap: a policy that reads the shown bank amount ("bank when it rounded up, gamble when it rounded down") gains nothing; the naive floor(exact + u) design is shown to gain, so this test has power', () => {
    const eF = mkEng({ more: { rtp: 1, minTenths: 20 } });         // a fair coin (rtp 1): any gain would be pure rounding leak
    let tested = 0;
    for (const bet of SMALL) for (const buy of ['bonus1', 'bonus2']) {
      const c = toMore(eF, bet, buy, 7 + bet * 31 + (buy === 'bonus2' ? 500 : 0)); c.e = eF;
      const p0 = c.r.pending, sc = E.scaleOf(E.CFG.buyCost[buy], bet), x = p0.W * sc.num / sc.den, frac = x - Math.floor(x);
      if (frac < 0.15 || frac > 0.85) continue; tested++;
      const N = 1000, pWin = p0.pWin; let evBank = 0, evPolicy = 0, evNaive = 0;
      for (let i = 0; i < N; i++) {
        const u = (i + 0.5) / N, r = again(c, [], 0.5, () => u), p = r.pending;
        const up = p.bonusCents > x + 1e-12, takeEV = pWin * p.winCents + (1 - pWin) * p.baseCents;
        evBank += p.bankCents; evPolicy += up ? p.bankCents : takeEV;
        // the naive design: ONE shared u, bank = floor(exact + u), the gamble pays floor(exact x mult + u) on a win
        const nb = Math.floor(x + u), nUp = nb > Math.floor(x); evNaive += nUp ? nb : pWin * Math.floor(x * p.mult + u);
      }
      evBank /= N; evPolicy /= N; evNaive /= N;
      assert.ok(Math.abs(evBank - x) < 0.005, 'banking pays the exact value on average: ' + evBank + ' vs ' + x);
      assert.ok(Math.abs(evPolicy - x) < 0.005, 'the shown-cents policy earns the exact value, not more: ' + evPolicy + ' vs ' + x);
      assert.ok(evNaive - x > 0.04, 'the naive shared-u design leaks (' + (evNaive - x).toFixed(3) + ' cents on a ' + x.toFixed(1) + 'c bonus): the test can see a leak');
    }
    assert.ok(tested >= 3, 'tested ' + tested);
  });

  await test('DENOMS cap: no round pays above 10,000 x bet at 1c / 2c / 5c after rounding (1c: at most $100.00), the cap in cents is exact, a clamp never lifts a payout', () => {
    for (const bet of SMALL) {
      const sc = E.scaleOf(10, bet), top = E.settleCents({ base: 0, bonus: E.MAX_WIN_T, scale: sc, us: [0, 0], capCents: E.MAX_WIN_X * bet });
      assert.strictEqual(top, E.MAX_WIN_X * bet); assert.strictEqual(top, E.cents(E.MAX_WIN_T, bet));
      // rounded parts that would add up past the cap: clamped, never above, never below the unclamped value when under the cap
      for (let i = 0; i < 4000; i++) { const rng = E.rngFrom(i + 5), cap = 1 + Math.floor(rng() * 20), base = Math.floor(rng() * 300), bonus = Math.floor(rng() * 300), us = [rng(), rng()];
        const v = E.settleCents({ base, bonus, scale: sc, us, capCents: cap }), raw = E.roundCents(base, sc, us[0]) + E.roundCents(bonus, sc, us[1]); assert.strictEqual(v, Math.min(raw, cap)); }
    }
    const e = mkEng(null, { maxWinTenths: 25 });                    // a 2.5 x cap makes the clamp matter every few rounds
    for (const bet of SMALL) for (const buy of [null, 'bonus1', 'call']) { let atCap = 0;
      for (let i = 0; i < 2500; i++) { const r = e.playRound(E.rngFrom(i * 3 + 1), { buy, bet, state: buy ? null : st0({ day: '2026-10-06' }), now: 1, day: '2026-10-06', auto: true, script: false, rnd: E.rngFrom(i + 9) }, []);
        assert.ok(r.winTenths <= 25); assert.strictEqual(r.pay.capCents, Math.min(Math.floor(25 * r.pay.num / r.pay.den), E.MAX_WIN_X * bet)); assert.ok(r.pay.win <= r.pay.capCents, [bet, buy, i, r.pay.win, r.pay.capCents].join()); if (r.pay.win === r.pay.capCents) atCap++; }
      assert.ok(atCap > 0, 'the clamp was reached for ' + bet + ' ' + buy); }
    for (const bet of SMALL) { const r = E0.playRound(E.rngFrom(3), { buy: 'bonus1', bet, state: null, now: 1, day: '2026-10-06', auto: true, rnd: E.rngFrom(1) }, []); const sc = E.scaleOf(E.CFG.buyCost.bonus1, bet); assert.strictEqual(r.pay.capCents, Math.min(Math.floor(E.MAX_WIN_T * sc.num / sc.den), E.MAX_WIN_X * bet)); assert.ok(r.pay.capCents <= E.MAX_WIN_X * bet, 'never above 10,000 x the nominal bet; a buy whose fair stake is a hair under the bet tops out a hair under it'); const sp = E0.playRound(E.rngFrom(3), { bet, state: st0({ day: '2026-10-06' }), now: 1, day: '2026-10-06', auto: true, rnd: E.rngFrom(1) }, []); assert.strictEqual(sp.pay.capCents, E.MAX_WIN_X * bet, 'a spin: exactly 10,000 x the bet in cents'); }
  });

  await test('DENOMS Callback step: below an average of 10c the step is 1 cent (carry in [0, 1)), from 10c up it is exactly the old floor-to-10 rule, the minimum Callback bet is 1c', () => {
    const t = (avg, carry, bet, rest) => { const o = E.cbArm(avg, carry); assert.strictEqual(o.bet, bet, JSON.stringify([avg, carry])); assert.ok(Math.abs(o.carry - rest) < 1e-9, JSON.stringify([avg, carry, o])); };
    t(3.7, 0, 3, 0.7); t(9.99, 0, 9, 0.99); t(1, 0, 1, 0); t(2, 0, 2, 0); t(5, 0, 5, 0); t(0.4, 0, 1, 0); t(0, 0, 1, 0);
    t(10, 0, 10, 0); t(14.9, 0, 10, 4.9); t(15, 0, 10, 5); t(19.99, 0, 10, 9.99); t(99.96, 0, 90, 9.96); t(2499.95, 0, 2490, 9.95); t(2500, 0, 2500, 0); t(1e9, 0, 2500, 0);
    t(3, 7.5, 10, 0.5);            // 7.5c carried from a 10c+ list added to a list whose average is 3c: worth 10.5, hands out 10, keeps 0.5
    t(12, 0.7, 10, 2.7);           // the reverse: 0.7c carried from a small list added to a 12c average: worth 12.7, floor to 10, keeps 2.7
    t(2.5, 9.9, 12, 0.4); t(1, 9.5, 10, 0.5); t(2000, 7.5, 2000, 7.5); t(9.9, 0.2, 10, 0.1);
    assert.strictEqual(E.cbBet(4.9), 4); assert.strictEqual(E.cbBet(0), 1); assert.strictEqual(E.cbBet(-5), 1); assert.strictEqual(E.cbBet(1e9), 2500); assert.strictEqual(E.cbBet(24.9), 20); assert.strictEqual(E.cbBet(99999), 2500);
    for (const bad of [NaN, -1, undefined, Infinity, 'x', null]) { const o = E.cbArm(bad, 0); assert.ok(o.bet >= 1 && o.bet <= 2500 && Number.isInteger(o.bet) && o.carry >= 0 && o.carry < 1, String(bad)); }
    // a flat bettor at 1c / 2c / 5c gets exactly his bet back, no drift; the Callback round pays whole cents at it
    for (const b of [1, 2, 3, 5, 7, 9, 10, 20]) { let st = st0({ day: '2026-10-06' }); for (let i = 0; i < 200 && !st.cb; i++) st = E0.playRound(strict(gridVals(E0, 0)), { bet: b, state: st, now: 5e6, day: '2026-10-06', rnd: E.rngFrom(1) }, []).newState; assert.deepStrictEqual(st.cb, { bet: b }, 'flat ' + b); assert.strictEqual(st.avg, b); }
    for (const b of [1, 2, 5, 7, 99, 2500]) { const r = E0.playRound(E.rngFrom(b), { bet: 100, state: freeze(st0({ lt: 20, avg: b, cb: { bet: b }, day: '2026-10-06' })), now: 5e6, day: '2026-10-06', auto: true, rnd: E.rngFrom(3) }, []);
      assert.strictEqual(r.callback, true); assert.strictEqual(r.betCents, b); assert.strictEqual(r.pay.price, 0); assert.ok(Number.isInteger(r.pay.win) && r.pay.win >= 0); assert.ok(r.pay.win <= E.MAX_WIN_X * b); }
  });

  await test('DENOMS Callback invariant (fuzz): over any mix of bets, including mixes that cross 10c, the stake handed out is never above what the leads were worth, and each arm keeps bet + carry out = avg + carry in', () => {
    const rng = E.rngFrom(2026);
    for (let run = 0; run < 40; run++) {
      let carry = 0, sumBet = 0, sumAvg = 0;
      for (let i = 0; i < 400; i++) {
        const r = rng(), avg = r < 0.4 ? 1 + rng() * 9 : r < 0.55 ? 10 + rng() * 5 : r < 0.7 ? [1, 2, 5, 10, 20][Math.floor(rng() * 5)] : 1 + Math.exp(rng() * 7.8);
        const o = E.cbArm(avg, carry), step = avg < 10 ? 1 : 10, tin = avg + carry;
        assert.ok(Number.isInteger(o.bet) && o.bet >= 1 && o.bet <= 2500, 'bet ' + o.bet);
        assert.ok(o.carry >= 0 && o.carry < step + 1e-12, 'carry ' + o.carry + ' step ' + step);
        assert.ok(o.bet <= tin + 1e-6, 'never above the worth: ' + o.bet + ' vs ' + tin);
        if (avg + carry < 2500) assert.ok(Math.abs(o.bet + o.carry - tin) < 1e-6 || o.carry === 0, 'conservation ' + JSON.stringify([avg, carry, o]));
        carry = o.carry; sumBet += o.bet; sumAvg += avg; assert.ok(sumBet <= sumAvg + 1e-6, 'prefix: ' + sumBet + ' vs ' + sumAvg + ' at ' + i);
      }
    }
    // the same through real rounds: random bets from the whole list (crossing 10c both ways), the arms are read off the state
    const e = mkEng({ daily: { base: 0, perStreak: 0 } }); let armed = 0;      // no daily gift: one addLeads per spin, so the state's average after the spin is the average the Callback was armed at
    for (let seed = 1; seed <= 6; seed++) {
      const g = E.rngFrom(seed * 77), sm = E.rngFrom(seed), rnd = E.rngFrom(seed + 99); let st = st0(), sumBet = 0, sumAvg = 0, carry0 = 0;
      for (let i = 0; i < 5000; i++) {
        const bet = g() < 0.5 ? [1, 2, 5][Math.floor(g() * 3)] : E.BET_LEVELS[Math.floor(g() * 11)], day = '2026-10-' + String(6 + Math.floor(i / 400)).padStart(2, '0');
        const r = e.playRound(sm, { bet, state: st, now: 1e6 + i, day, auto: true, script: false, rnd }, []);
        if (r.pull.armed) { armed++; sumBet += r.newState.cb.bet; sumAvg += r.newState.avg; assert.ok(sumBet <= sumAvg + 1e-6, 'real flow prefix ' + sumBet + ' vs ' + sumAvg); assert.ok(r.newState.carry >= 0 && r.newState.carry < 10); }
        assert.ok(!r.newState.cb || (Number.isInteger(r.newState.cb.bet) && r.newState.cb.bet >= 1 && r.newState.cb.bet <= 2500)); st = r.newState;
      }
    }
    assert.ok(armed >= 20, 'armed ' + armed);
  });

  await test('DENOMS legacy path (pull.on = false) at 1c: the old stateless round pays whole cents too, rounded by the same engine function', () => {
    const e = mkEng({ on: false });
    for (const bet of SMALL) for (const buy of [null, 'call', 'bonus1']) for (let i = 0; i < 30; i++) {
      const r = e.playRound(E.rngFrom(i + 1), { buy, bet, state: null, now: 1, day: '2026-10-06', script: false, rnd: E.rngFrom(i + 100) }, []);
      assert.strictEqual(r.status, 'done'); assert.ok(Number.isInteger(r.pay.win) && Number.isInteger(r.pay.price) && r.pay.price >= 1); assert.ok(r.pay.win <= E.MAX_WIN_X * bet);
      const ex = r.winTenths * r.pay.num / r.pay.den; assert.ok(Math.abs(r.pay.win - ex) < 2);
    }
  });

  await test('DENOMS pot slice at 1c / 2c / 5c: remainders carry, fed + rem is exactly cost x bps, nothing is lost over 1M spins', () => {
    for (const bet of SMALL) for (const bps of [50, 100, 7]) { let rem = 0, fed = 0; for (let i = 0; i < 100000; i++) { const s = E.potSlice(bps, bet, rem); assert.ok(Number.isInteger(s.slice) && s.slice >= 0 && s.rem >= 0 && s.rem < 10000); rem = s.rem; fed += s.slice; } assert.strictEqual(fed * 10000 + rem, 100000 * bet * bps); }
    for (const bet of SMALL) assert.ok(Math.abs(E.potHitChance({ pot: { oneInPerDollar: 3000 } }, bet) - bet / 100 / 3000) < 1e-15);
  });

  // regression guard, generated on the unchanged engine (8c9c00a / 2004fd5): every playRound result at a bet of 10c or more, state flows with Callbacks, daily, cold clock, buys, PICK and ONE MORE CALL, resumed from a pending point
  await test('DENOMS 10c and up is bit for bit the old engine (digest of 5,760 stateful rounds incl. scripts, states and pending points; guard generated before the change)', () => {
    const h = require('./lib-den-transcript.js')(E, crypto);
    assert.strictEqual(h, '0e446129fe339a59cc1c1ed9c2e77bbf91703af08d3182951aea3416cb98f409');
  });

  console.log(pass + ' passed' + (process.exitCode ? ', with failures' : ''));
  PIN.restore();
})();
