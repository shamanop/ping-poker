'use strict';
// node tests/coldcall.js  (self-contained: a real ledger on a temp dir through tests/lib-coldcall-ledger.js, fake io, no network, no server)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const EventEmitter = require('events');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coldcall-'));
const H = require('./lib-coldcall-ledger.js');
const E = require('../games/coldcall-engine.js');
E.CFG.pull.on = false;   // these tests script the rng through the old stateless path; THE PULL has its own files (run at the end)

let pass = 0;
const test = async (name, fn) => { try { await fn(); pass++; console.log('ok   ' + name); } catch (e) { console.error('FAIL ' + name + '\n' + (e.stack || e)); process.exitCode = 1; } };
const tick = () => new Promise((r) => setImmediate(r));
const clone = (o) => JSON.parse(JSON.stringify(o));
const cfgWith = (patch) => Object.assign(clone(E.CFG), patch);

const last = H.last, all = H.all;

// one world per test: a real ledger, ctx.money, the games registry (boot recovery included) and games/coldcall.js, all on a temp dir (tests/lib-coldcall-ledger.js)
function setup(opts = {}) { return H.world({ rng: opts.rng, dir: fs.mkdtempSync(path.join(tmp, 'w')) }); }

// ---------------------------------------------------------------- test helpers
function payTable(cfg) { return E.SYM.slice(0, 10).map((n) => cfg.pay[n].map((v) => Math.max(1, Math.round(v * cfg.payScale)))); }
const midOfCum = (cum, i) => ((i ? cum[i - 1] : 0) + cum[i]) / 2;
const symVal = (e, mi, s) => midOfCum(e.SYMT[mi], s);                       // an rng value that makes the engine draw symbol s in mode mi
const symsVals = (e, mi, list) => list.map((s) => symVal(e, mi, s));
function revealIdx(e, mi, k, v) {                                           // an rng value that makes the engine reveal outcome (k = 'b' | 'u' | 'c', value v)
  const out = e.REV[mi].out; const i = out.findIndex((x) => x.k === k && (k === 'c' || x.v === v));
  assert.ok(i >= 0, 'no reveal outcome ' + k + v); return midOfCum(e.REV[mi].cum, i);
}
// scripted rng: returns the given values in order; afterwards it cycles safe symbols (notes, balls, cans, cups) so unscripted refills never win. left() = scripted values not yet used.
function Q(e, mi, vals) { let i = 0, t = 0; const f = () => (i < vals.length ? vals[i++] : symVal(e, mi, 1 + (t++ % 4))); f.left = () => vals.length - i; return f; }
const symQueue = (e, mi, list) => Q(e, mi, symsVals(e, mi, list));

// ---- independent replayer: written from the rules and the script contract only (no engine internals)
const orth = (p) => { const r = Math.floor(p / 6), c = p % 6, o = []; if (r > 0) o.push(p - 6); if (c > 0) o.push(p - 1); if (c < 5) o.push(p + 1); if (r < 4) o.push(p + 6); return o; };
const near = (p, n) => { if (n === 4) return orth(p); const r = Math.floor(p / 6), c = p % 6, o = []; for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { if (!dr && !dc) continue; const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < 5 && cc >= 0 && cc < 6) o.push(rr * 6 + cc); } return o; };
function clustersOf(g, pay) {
  const out = [];
  for (let s = 0; s < 10; s++) {
    const seen = new Set();
    for (let p = 0; p < 30; p++) {
      if (g[p] !== s || seen.has(p)) continue;
      const comp = [p]; seen.add(p);
      for (let i = 0; i < comp.length; i++) for (const q of orth(comp[i])) if (!seen.has(q) && (g[q] === s || g[q] === 10)) { seen.add(q); comp.push(q); }
      if (comp.length >= 5) out.push({ sym: s, pos: comp.sort((a, b) => a - b), pay: pay[s][Math.min(comp.length, 13) - 5] });
    }
  }
  return out;
}
function replayPhone(ph, cfg, mi, leads, capLeft) {
  const mode = E.MODES[mi], rv = cfg.reveal[mode], capT = cfg.maxWinTenths;
  assert.deepStrictEqual(ph.leads, leads);
  const kind = {}, val = {}, pm = {}, done = {}; let active = leads.slice(), closes = 0, r = 0;
  for (;; r++) {
    const rd = ph.rounds[r]; assert.ok(rd, 'round ' + r + ' missing');
    assert.deepStrictEqual(rd.reveals.map((x) => x.p), active, 'reveal squares of round ' + r);
    for (const x of rd.reveals) {
      if (x.k === 'b') {
        const tn = E.TIER_NAMES[x.t]; assert.ok(tn, 'tier'); assert.ok(rv[tn] > 0, 'tier weight > 0 (' + mode + ' ' + tn + ')');
        assert.ok(((rv.bubbles && rv.bubbles[tn]) || cfg.bubbles[tn]).some((b) => b[0] === x.v), 'bubble value ' + x.v); kind[x.p] = 'b'; val[x.p] = x.v;
      } else if (x.k === 'u') { assert.ok(cfg.upsell.some((u) => u[0] === x.v)); kind[x.p] = 'u'; val[x.p] = x.v; } else { assert.strictEqual(x.k, 'c'); assert.strictEqual(x.v, 0); kind[x.p] = 'c'; val[x.p] = 0; pm[x.p] = 1; done[x.p] = false; }
    }
    const ups = [];
    for (const x of rd.reveals) {
      if (x.k !== 'u') continue; const hits = [];
      for (const q of near(x.p, cfg.adjacency)) {
        if (!leads.includes(q)) continue;
        if (kind[q] === 'b') { const b = val[q]; val[q] = Math.min(b * x.v, capT); hits.push({ p: q, k: 'b', before: b, after: val[q] }); }
        else if (kind[q] === 'c') { if (done[q]) { const b = val[q]; val[q] = Math.min(b * x.v, capT); hits.push({ p: q, k: 'c', before: b, after: val[q] }); } else { const b = pm[q]; pm[q] = Math.min(b * x.v, capT); hits.push({ p: q, k: 'c', pend: 1, before: b, after: pm[q] }); } }
      }
      ups.push({ p: x.p, m: x.v, hits });
    }
    assert.deepStrictEqual(rd.upsells, ups, 'upsells round ' + r);
    const cols = [];
    for (const x of rd.reveals) {
      if (x.k !== 'c') continue; let took = 0;
      for (const q of leads) if (q !== x.p && (kind[q] === 'b' || (kind[q] === 'c' && done[q]))) took += val[q];
      took = Math.min(took, capT); val[x.p] = Math.min(took * pm[x.p], capT); done[x.p] = true;
      let run = 0; for (const q of leads) if (kind[q] === 'b' || kind[q] === 'c') run += val[q];
      cols.push({ p: x.p, m: pm[x.p], took, value: val[x.p], run });
    }
    assert.deepStrictEqual(rd.collects, cols, 'collects round ' + r); closes += cols.length;
    if (!cols.length) break;
    active = leads.filter((q) => kind[q] !== 'c');
    if (!active.length || r + 1 >= cfg.maxRevealRounds) break;
  }
  assert.strictEqual(ph.rounds.length, r + 1, 'number of reveal rounds');
  let pay = 0; for (const q of leads) if (kind[q] === 'b' || kind[q] === 'c') pay += val[q];
  const capped = pay >= capLeft; if (capped) pay = capLeft;
  assert.strictEqual(ph.pay, pay); assert.strictEqual(!!ph.capped, capped);
  return { pay, capped, closes };
}
function replaySpin(sp, cfg, mi, carryIn, capLeft) {
  const pay = payTable(cfg); const g = sp.grid.slice(); assert.strictEqual(g.length, 30); for (const s of g) assert.ok(Number.isInteger(s) && s >= 0 && s <= 12);
  assert.deepStrictEqual(sp.hotIn, carryIn); assert.strictEqual(sp.mode, E.MODES[mi]);
  if (sp.gp >= 0) assert.strictEqual(g[sp.gp], 12);
  const hot = new Set(carryIn); let cluster = 0, left = capLeft, capped = false;
  sp.steps.forEach((st, si) => {
    const cl = clustersOf(g, pay); assert.ok(cl.length, 'a step needs a win');
    assert.deepStrictEqual(st.wins, cl.map((c) => ({ sym: c.sym, pos: c.pos, pay: c.pay })));
    const sum = cl.reduce((a, c) => a + c.pay, 0), paid = Math.min(sum, left); assert.strictEqual(st.pay, paid); left -= paid; cluster += paid;
    const types = new Set(cl.map((c) => c.sym)), rem = new Set();
    for (const c of cl) for (const p of c.pos) { rem.add(p); hot.add(p); }
    for (let p = 0; p < 30; p++) if (types.has(g[p])) rem.add(p);                              // super cascade sweep (wilds are type 10, never swept)
    assert.deepStrictEqual(st.removed, [...rem].sort((a, b) => a - b));
    assert.deepStrictEqual(st.hot, [...hot].sort((a, b) => a - b));
    const next = g.slice(), falls = [], freshPos = [];
    for (let c = 0; c < 6; c++) {
      const keep = []; for (let r = 4; r >= 0; r--) if (!rem.has(r * 6 + c)) keep.push(r);
      keep.forEach((r, i) => { const to = 4 - i; if (to !== r) falls.push([r * 6 + c, to * 6 + c]); next[to * 6 + c] = g[r * 6 + c]; });
      for (let r = 4 - keep.length; r >= 0; r--) freshPos.push(r * 6 + c);
    }
    assert.deepStrictEqual(st.falls.slice().sort((a, b) => a[0] - b[0]), falls.sort((a, b) => a[0] - b[0]), 'falls');
    assert.deepStrictEqual(st.fresh.map((f) => f[0]).sort((a, b) => a - b), freshPos.sort((a, b) => a - b), 'fresh squares');
    for (const [p, s] of st.fresh) { assert.ok(Number.isInteger(s) && s >= 0 && s <= 12); next[p] = s; }
    assert.deepStrictEqual(st.grid, next, 'grid after the drop'); for (let p = 0; p < 30; p++) g[p] = next[p];
    if (left <= 0) { capped = true; assert.strictEqual(st.capped, true); assert.strictEqual(si, sp.steps.length - 1, 'a capped spin stops'); } else assert.ok(!st.capped);
  });
  if (!capped && sp.steps.length < cfg.maxCascades) assert.strictEqual(clustersOf(g, pay).length, 0, 'the cascade ended on a grid with no win');
  assert.ok(sp.steps.length <= cfg.maxCascades);
  const bells = g.filter((s) => s === 11).length, phones = g.filter((s) => s === 12).length; assert.strictEqual(sp.bells, bells); assert.strictEqual(sp.phones, phones);
  const fire = !capped && phones > 0 && hot.size > 0; assert.strictEqual(sp.phone !== null, fire, 'phone feature fires iff a phone and a hot lead are on the board');
  let phoneTenths = 0, closes = 0;
  if (fire) { const f = replayPhone(sp.phone, cfg, mi, [...hot].sort((a, b) => a - b), left); phoneTenths = f.pay; closes = f.closes; left -= f.pay; if (f.capped) capped = true; }
  const hotOut = mi === 0 ? [] : mi === 1 ? (fire ? [] : [...hot].sort((a, b) => a - b)) : [...hot].sort((a, b) => a - b);
  assert.deepStrictEqual(sp.hotOut, hotOut, 'hot leads carried out of the spin');
  assert.strictEqual(sp.cluster, cluster); assert.strictEqual(sp.phoneTenths, phoneTenths); assert.strictEqual(sp.win, cluster + phoneTenths); assert.strictEqual(!!sp.capped, capped);
  return { win: cluster + phoneTenths, capped, hotOut, closes, phone: fire, bells, phones };
}
function replayBonus(b, cfg, start, capLeft) {
  let mode = start, spinsLeft = cfg.spins[E.MODES[start]], awarded = spinsLeft, carry = [], total = 0, closes = 0, capped = false;
  assert.strictEqual(b.kind, E.MODES[start]); assert.strictEqual(b.startSpins, spinsLeft);
  b.spins.forEach((sp, n) => {
    assert.ok(!capped, 'no spin after the cap'); assert.strictEqual(sp.n, n + 1); spinsLeft--;
    const r = replaySpin(sp, cfg, mode, carry, capLeft - total); total += r.win; closes += r.closes;
    if (mode === 3) assert.ok(r.phones >= 1, 'bonus3 phone every spin');
    let add = 0, up = false;
    if (mode === 1) { if (r.bells >= 4) { add = cfg.retrigger.upgrade; up = true; } else if (r.bells === 3) add = cfg.retrigger.three; else if (r.bells === 2) add = cfg.retrigger.two; }
    else if (r.bells >= 3) add = cfg.retrigger.three; else if (r.bells === 2) add = cfg.retrigger.two;
    add = Math.max(0, Math.min(add, cfg.maxSpins - awarded)); awarded += add; spinsLeft += add;
    assert.strictEqual(sp.added, add); assert.strictEqual(!!sp.upgrade, up); assert.strictEqual(sp.left, spinsLeft); assert.strictEqual(sp.bonusTotal, Math.min(total, capLeft));
    if (up) mode = 2; carry = r.hotOut; if (r.capped) capped = true;
  });
  if (!capped) assert.strictEqual(spinsLeft, 0); assert.strictEqual(b.totalSpins, awarded); assert.strictEqual(!!b.capped, capped);
  total = Math.min(total, capLeft); assert.strictEqual(b.winTenths, total); assert.strictEqual(b.upgraded, mode !== start);
  return { win: total, capped, closes };
}
function replayRound(s, cfg) {
  assert.strictEqual(s.v, 2); assert.strictEqual(s.maxWinTenths, cfg.maxWinTenths);
  let left = s.maxWinTenths, win = 0, phones = 0, closes = 0, capped = false, startKind = 0;
  if (s.spin) {
    const r = replaySpin(s.spin, cfg, 0, [], left); win += r.win; left -= r.win; phones += r.phone ? 1 : 0; closes += r.closes; capped = r.capped;
    if (!capped && r.bells >= 3) startKind = r.bells >= 5 ? 3 : r.bells === 4 ? 2 : 1;
    assert.strictEqual(s.parts.cluster + s.parts.phone, r.win);
  } else startKind = s.buy === 'bonus1' ? 1 : 2;
  assert.strictEqual(s.bonus !== null, !!startKind, 'a bonus plays iff the bells say so');
  let bonusWin = 0;
  if (s.bonus) { const b = replayBonus(s.bonus, cfg, startKind, left); win += b.win; bonusWin = b.win; closes += b.closes; capped = capped || b.capped; }
  assert.strictEqual(s.parts.bonus, bonusWin);
  win = Math.min(win, s.maxWinTenths); assert.strictEqual(s.winTenths, win); assert.strictEqual(!!s.capped, win >= s.maxWinTenths);
  return { win, phones, closes, bonus: !!s.bonus };
}

(async () => {
  await test('ledger: a new account starts at 10,000.00 Play $ and the chips bank balance', () => {
    const w = setup(); w.addKey('ann');
    assert.deepStrictEqual(w.balances('ann'), { play: 1000000, chips: 10000 });
    assert.strictEqual(w.money.balance('ann', 'play'), 1000000); assert.strictEqual(w.money.balance('ann', 'chips'), 10000);   // ctx.money reads the same ledger accounts
  });

  await test('ctx.money: one round = one batch, spend/win math and the house result in both currencies (replaces the wallet.js stats test)', () => {
    const w = setup(); w.addKey('ann'); const m = w.money;
    m.round('ann', 'play', 'r1', { cost: 100, win: 250 });
    assert.strictEqual(w.bal('ann', 'play'), 1000000 - 100 + 250);
    m.round('ann', 'chips', 'r2', { cost: 500, win: 1500 });
    assert.strictEqual(w.bal('ann', 'chips'), 9500 + 1500);
    // the old per-game stats {rounds, wagered, won} are ledger facts now: one batch line per round, house:coldcall = wagered - won
    const spent = (cur) => w.lines((e) => e.cur === cur && e.reason === 'coldcall:spend').reduce((n, e) => n + e.amount, 0);
    const paid = (cur) => w.lines((e) => e.cur === cur && e.reason === 'coldcall:credit').reduce((n, e) => n + e.amount, 0);
    assert.deepStrictEqual([w.lines((e) => e.ref === 'coldcall:ann:r1').length, spent('play'), paid('play'), w.house('play')], [2, 100, 250, 100 - 250]);
    assert.deepStrictEqual([w.lines((e) => e.ref === 'coldcall:ann:r2').length, spent('chips'), paid('chips'), w.house('chips')], [2, 500, 1500, 500 - 1500]);
  });

  await test('ctx.money: float, negative, NaN, string, Infinity, huge amounts and a bad mode are rejected, nothing moves', () => {
    const w = setup(); w.addKey('ann'); const m = w.money, id = w.lastId();
    for (const bad of [-1, 1.5, 0.1 + 0.2, NaN, Infinity, '10', 2 ** 60, 1e21]) {
      assert.throws(() => m.round('ann', 'play', 'x' + String(bad).replace(/\W/g, ''), { cost: bad }), (e) => e.code === 'amount', 'cost ' + String(bad));
      assert.throws(() => m.round('ann', 'play', 'y' + String(bad).replace(/\W/g, ''), { cost: 1, win: bad }), (e) => e.code === 'amount', 'win ' + String(bad));
    }
    assert.throws(() => m.round('ann', 'ledger', 'z1', { cost: 10 }), (e) => e.code === 'mode');
    assert.strictEqual(w.lastId(), id); assert.deepStrictEqual(w.balances('ann'), { play: 1000000, chips: 10000 });
  });

  await test('ctx.money: insufficient funds are exact in both purses, chips never go negative', () => {
    const w = setup(); w.addKey('bo'); w.addKey('cy'); const m = w.money;
    w.setBal('bo', 'play', 50);
    assert.throws(() => m.round('bo', 'play', 'a1', { cost: 100 }), (e) => e.code === 'funds');
    assert.strictEqual(w.bal('bo', 'play'), 50);
    m.round('cy', 'chips', 'a2', { cost: 10000 });
    assert.throws(() => m.round('cy', 'chips', 'a3', { cost: 10 }), (e) => e.code === 'funds');
    assert.strictEqual(w.bal('cy', 'chips'), 0);
  });

  // ---------------------------------------------------------------- engine (v2: 6x5 clusters, super cascade, hot leads, three bonuses)
  const eng = E.engine, CFG = E.CFG, PAYT = payTable(CFG);
  const SYMN = E.SYM, MAXT = E.MAX_WIN_T;
  const FILL = (p) => 1 + ((2 * Math.floor(p / 6) + (p % 6)) % 4);   // symbols 1-4 in a pattern where no two neighbours match: no cluster can form on it
  const fillGrid = () => Array.from({ length: 30 }, (_, p) => FILL(p));
  const ids = (o, p = 'x') => { if (typeof o === 'number') assert.ok(Number.isInteger(o), 'non-integer at ' + p + ' = ' + o); else if (o && typeof o === 'object') for (const k of Object.keys(o)) ids(o[k], p + '.' + k); };

  await test('engine: constants match the rules (grid 6x5, 10 symbols + closer + bell + phone, cap 10,000x, bet levels, spins)', () => {
    assert.strictEqual(E.COLS, 6); assert.strictEqual(E.ROWS, 5); assert.strictEqual(E.N, 30); assert.strictEqual(E.MIN_CLUSTER, 5);
    assert.deepStrictEqual(E.SYM, ['mug', 'note', 'ball', 'can', 'cups', 'headset', 'rx', 'pile', 'cashwad', 'cash', 'closer', 'bell', 'phone']);
    assert.strictEqual(E.MAX_WIN_X, 10000); assert.strictEqual(CFG.maxWinTenths, 100000);
    assert.deepStrictEqual(E.BET_LEVELS, [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2500]);   // DENOMS: 1c / 2c / 5c
    assert.deepStrictEqual(CFG.spins, { bonus1: 8, bonus2: 12, bonus3: 12 });
    assert.deepStrictEqual(CFG.retrigger, { two: 2, three: 4, upgrade: 4 });
    assert.deepStrictEqual(CFG.bubbles.bronze.map((b) => b[0]), [2, 5, 10, 20, 30, 40]);
    assert.deepStrictEqual(CFG.bubbles.silver.map((b) => b[0]), [50, 100, 150, 200]);
    assert.deepStrictEqual(CFG.bubbles.gold.map((b) => b[0]), [250, 500, 1000, 2500, 5000]);
    assert.deepStrictEqual(CFG.upsell.map((b) => b[0]), [2, 3, 4, 5, 10]);
    // pay shape: a mug 5-cluster pays 0.3x (the only win under 1x at size 5), every other 5-cluster 1x..1.8x, 13+ pays 130x..715x
    assert.strictEqual(PAYT[0][0], 3); for (let s = 1; s < 10; s++) assert.ok(PAYT[s][0] >= 10); assert.strictEqual(PAYT[9][0], 18); assert.strictEqual(PAYT[0][8], 1300); assert.strictEqual(PAYT[9][8], 7150);
    for (let s = 0; s < 10; s++) for (let i = 1; i < 9; i++) assert.ok(PAYT[s][i] >= PAYT[s][i - 1], 'pay rises with size');
    for (let i = 0; i < 9; i++) for (let s = 1; s < 10; s++) assert.ok(PAYT[s][i] >= PAYT[s - 1][i], 'pay rises with symbol');
  });

  await test('clusters: 5+ connected up/down/left/right pay; 4 do not; diagonals do not connect; each size pays its table value', () => {
    const g = fillGrid(); for (const p of [0, 1, 2, 3]) g[p] = 0;
    assert.strictEqual(eng.findClusters(Uint8Array.from(g)), null);               // 4 mugs: nothing
    g[4] = 0; let cl = eng.findClusters(Uint8Array.from(g));
    assert.deepStrictEqual(cl.map((c) => [c.sym, c.cells, c.pay]), [[0, [0, 1, 2, 3, 4], PAYT[0][0]]]);
    const d = fillGrid(); for (const p of [0, 7, 14, 21, 28]) d[p] = 0;           // a diagonal of 5
    assert.strictEqual(eng.findClusters(Uint8Array.from(d)), null);
    const L = fillGrid(); for (const p of [0, 1, 2, 8, 14]) L[p] = 5;             // an L shape of 5
    assert.deepStrictEqual(eng.findClusters(Uint8Array.from(L)).map((c) => [c.sym, c.cells.length]), [[5, 5]]);
    for (let size = 5; size <= 17; size++) {
      const x = Array.from({ length: 30 }, () => 9); for (let p = size; p < 30; p++) x[p] = FILL(p);   // the first `size` cells of the top rows: a connected blob
      const k = eng.findClusters(Uint8Array.from(x)).find((c) => c.sym === 9);
      assert.ok(k && k.cells.length >= size); if (k.cells.length === size) assert.strictEqual(k.pay, PAYT[9][Math.min(size, 13) - 5]);
    }
    const all13 = Array.from({ length: 30 }, () => 6); assert.strictEqual(eng.findClusters(Uint8Array.from(all13))[0].pay, PAYT[6][8]);
  });

  await test('wild: closer substitutes for any regular symbol, joins two groups, and can stand in two clusters at once; bell/phone never form or join clusters', () => {
    const g = fillGrid(); for (const p of [0, 1, 3, 4]) g[p] = 0; g[2] = 10;   // mug mug WILD mug mug
    let cl = eng.findClusters(Uint8Array.from(g)); assert.strictEqual(cl.length, 1); assert.strictEqual(cl[0].cells.length, 5); assert.deepStrictEqual(cl[0].cells, [0, 1, 2, 3, 4]);
    const w = fillGrid(); for (const p of [0, 1, 3, 4]) w[p] = 0; w[2] = 11;       // a bell in the gap: no cluster
    assert.strictEqual(eng.findClusters(Uint8Array.from(w)), null);
    w[2] = 12; assert.strictEqual(eng.findClusters(Uint8Array.from(w)), null);
    const two = fillGrid(); two[8] = 10;                                            // wild at 8 touches 2 (up), 7 (left), 9 (right), 14 (down)
    for (const p of [2, 3, 4, 1]) two[p] = 0;                                       // row 0: cols 1..4 mug; wild below col 2 makes 5
    for (const p of [7, 6, 12, 13]) two[p] = 1; two[0] = 3;                         // note group touching the wild from the left: 7, 6, 12, 13 + wild = 5 (pos 0 changed so it does not join)
    cl = eng.findClusters(Uint8Array.from(two)).map((c) => [c.sym, c.cells.length]).sort();
    assert.deepStrictEqual(cl, [[0, 5], [1, 5]]);
    const only = Array.from({ length: 30 }, () => 11); for (const p of [0, 1, 2, 3, 4]) only[p] = 10; assert.strictEqual(eng.findClusters(Uint8Array.from(only)), null);   // five wilds with no symbol are not a cluster
  });

  await test('super cascade: a win removes its cluster AND every other symbol of that type; a wild outside the cluster stays, a wild inside goes; bells/phones stay and fall', () => {
    const g = fillGrid(); for (const p of [0, 1, 3, 4]) g[p] = 0; g[2] = 10;     // mug cluster with a wild
    g[20] = 0; g[27] = 0;                                                         // two lone mugs elsewhere (not touching the cluster)
    g[16] = 10;                                                                   // a wild that is not in the cluster
    g[14] = 11; g[8] = 12;                                                        // a bell and a phone above the removed cell at 20: they must fall, not be removed
    const q = symQueue(eng, 0, [1, 2, 3, 4, 1, 2, 3]);                            // the 7 refills, column by column
    const sp = eng.playSpin(q, 0, new Uint8Array(30), true, { grid: g, capLeft: 1e9 });
    const st = sp.script.steps[0];
    assert.deepStrictEqual(st.removed, [0, 1, 2, 3, 4, 20, 27]);
    assert.ok(!st.removed.includes(16), 'outside wild stays'); assert.ok(!st.removed.includes(14) && !st.removed.includes(8), 'bell and phone stay');
    assert.deepStrictEqual(st.wins[0].pos, [0, 1, 2, 3, 4]);
    assert.strictEqual(st.pay, PAYT[0][0]);
    // the wild at 16 stays; the bell (14) and phone (8) dropped one square each because the cell below them in their column (20) was removed
    const after = st.grid; assert.strictEqual(after[16], 10); assert.strictEqual(after[20], 11); assert.strictEqual(after[14], 12);
    assert.deepStrictEqual(st.falls.filter(([a]) => a === 14 || a === 8).sort((x, y) => x[0] - y[0]), [[8, 14], [14, 20]]);
    assert.strictEqual(q.left(), 0, 'every scripted refill was used by the first step');
  });

  await test('hot leads: marked exactly on the winning positions (cluster cells incl. wilds), not on same-type symbols swept off-cluster; they stay on squares while symbols fall', () => {
    const g = fillGrid(); for (const p of [0, 1, 3, 4]) g[p] = 0; g[2] = 10; g[27] = 0;
    const q = symQueue(eng, 0, [1, 2, 3, 4, 1, 2]);
    const sp = eng.playSpin(q, 0, new Uint8Array(30), true, { grid: g, capLeft: 1e9 });
    const st = sp.script.steps[0];
    assert.deepStrictEqual(st.removed, [0, 1, 2, 3, 4, 27]); assert.deepStrictEqual(st.hot, [0, 1, 2, 3, 4]); assert.ok(!st.hot.includes(27));
    assert.deepStrictEqual(sp.script.hotIn, []);
    assert.deepStrictEqual(sp.script.hotOut, [], 'base spin clears its hot leads');
    // two cascade steps: a second win adds to the hot set, and the set survives the drop
    const h2 = fillGrid(); for (const p of [0, 1, 2, 3, 4]) h2[p] = 0; for (const p of [18, 19, 20, 21, 22]) h2[p] = 7;
    const sp2 = eng.playSpin(symQueue(eng, 0, [1, 2, 3, 4, 1, 2, 3, 4, 1, 2]), 0, new Uint8Array(30), true, { grid: h2, capLeft: 1e9 });
    assert.deepStrictEqual(sp2.script.steps[0].hot, [0, 1, 2, 3, 4, 18, 19, 20, 21, 22]); assert.strictEqual(sp2.script.steps[0].wins.length, 2);
    assert.ok(sp2.script.steps.every((x, i) => i === 0 || x.hot.length >= sp2.script.steps[i - 1].hot.length), 'the hot set only grows inside a spin');
  });

  await test('cascade loop: wins repeat until none; a refill that makes a new win is a second step and its leads join the set', () => {
    const g = fillGrid(); for (const p of [0, 1, 2, 3, 4]) g[p] = 0;
    // refill row 0 with 5 cash: they connect (positions 0-4 are one row): a second step wins on cash, then a quiet refill ends it
    const syms = [9, 9, 9, 9, 9].concat(Array.from({ length: 5 }, (_, i) => FILL(i)));
    const q = symQueue(eng, 0, syms);
    const sp = eng.playSpin(q, 0, new Uint8Array(30), true, { grid: g, capLeft: 1e9 });
    assert.strictEqual(sp.script.steps.length, 2); assert.strictEqual(q.left(), 0);
    assert.deepStrictEqual(sp.script.steps[0].hot, [0, 1, 2, 3, 4]); assert.deepStrictEqual(sp.script.steps[1].hot, [0, 1, 2, 3, 4]);
    assert.strictEqual(sp.script.steps[1].wins[0].sym, 9); assert.strictEqual(sp.cluster, PAYT[0][0] + PAYT[9][0]); assert.strictEqual(sp.cascades, 2);
    assert.strictEqual(sp.script.hotOut.length, 0);
  });

  await test('no phone = no reveal: a winning spin without a phone pays clusters only; a phone without hot leads does nothing', () => {
    const g = fillGrid(); for (const p of [0, 1, 2, 3, 4]) g[p] = 0;
    const sp = eng.playSpin(symQueue(eng, 0, Array.from({ length: 5 }, (_, i) => FILL(i))), 0, new Uint8Array(30), true, { grid: g, capLeft: 1e9 });
    assert.strictEqual(sp.script.phone, null); assert.strictEqual(sp.phone, 0); assert.strictEqual(sp.win, PAYT[0][0]); assert.strictEqual(sp.fired, false);
    const h = fillGrid(); h[29] = 12;                                              // phone, but nothing wins: no hot leads
    const sp2 = eng.playSpin(symQueue(eng, 0, []), 0, new Uint8Array(30), true, { grid: h, capLeft: 1e9 });
    assert.strictEqual(sp2.script.phone, null); assert.strictEqual(sp2.win, 0); assert.strictEqual(sp2.phones, 1);
  });

  await test('phone feature: every hot lead reveals (bubble / upsell / close), pay = bubbles + closes, with the squares and values in the script', () => {
    const g = fillGrid(); for (const p of [0, 1, 3, 4]) g[p] = 0; g[2] = 10; g[29] = 12;
    const rv = (k, v) => revealIdx(eng, 0, k, v);
    // after the cluster: 5 refills, then reveals for leads 0..4: upsell x3 @0, bubble 1.0x @1, close @2, bubble 2.0x @3, bubble 0.5x @4; round 2 (non-close leads 0,1,3,4): four 0.2x bubbles
    const q = Q(eng, 0, [].concat(symsVals(eng, 0, Array.from({ length: 5 }, (_, i) => FILL(i))), [rv('u', 3), rv('b', 10), rv('c'), rv('b', 20), rv('b', 5)], [rv('b', 2), rv('b', 2), rv('b', 2), rv('b', 2)]));
    const sp = eng.playSpin(q, 0, new Uint8Array(30), true, { grid: g, capLeft: 1e9 });
    const ph = sp.script.phone; assert.deepStrictEqual(ph.leads, [0, 1, 2, 3, 4]);
    assert.deepStrictEqual(ph.rounds[0].reveals.map((r) => [r.p, r.k, r.v]), [[0, 'u', 3], [1, 'b', 10], [2, 'c', 0], [3, 'b', 20], [4, 'b', 5]]);
    assert.deepStrictEqual(ph.rounds[0].upsells, [{ p: 0, m: 3, hits: [{ p: 1, k: 'b', before: 10, after: 30 }] }]);   // 4-neighbour: only the square to the right is hot and a bubble
    assert.deepStrictEqual(ph.rounds[0].collects, [{ p: 2, m: 1, took: 55, value: 55, run: 110 }]);                  // 30 + 20 + 5; run = board total after the collect (55 bubbles + 55 close)
    assert.strictEqual(ph.rounds.length, 2); assert.deepStrictEqual(ph.rounds[1].reveals.map((r) => r.p), [0, 1, 3, 4]);
    assert.strictEqual(ph.pay, 55 + 8); assert.strictEqual(sp.phone, 63); assert.strictEqual(sp.win, PAYT[0][0] + 63); assert.strictEqual(q.left(), 0);
  });

  await test('upsell: multiplies adjacent bubbles and closes (4 neighbours by default, 8 as a lever), stacks by multiplication, never touches upsells or empty squares, applies before closes collect', () => {
    const rv = (e, k, v) => revealIdx(e, 0, k, v);
    const leads = [7, 8, 9, 13, 14];                                      // 7 upsell; 8 right of it, 13 below it, 14 diagonal below-right
    const hot = new Uint8Array(30); for (const p of leads) hot[p] = 1;
    const run = (cfg, plan) => { const e = E.createEngine(cfg); return e.phoneFeature(Q(e, 0, plan(e)), 0, hot, true, 1e9); };
    const plan = (e) => [rv(e, 'u', 2), rv(e, 'b', 10), rv(e, 'b', 10), rv(e, 'b', 10), rv(e, 'b', 10)];
    let f = run(cfgWith({ adjacency: 4 }), plan);
    assert.deepStrictEqual(f.script.rounds[0].upsells[0].hits.map((h) => [h.p, h.before, h.after]), [[8, 10, 20], [13, 10, 20]]);   // 14 is diagonal: not reached
    assert.strictEqual(f.pay, 20 + 20 + 10 + 10);                         // 9 and 14 are not adjacent; the upsell itself pays nothing
    f = run(cfgWith({ adjacency: 8 }), plan);
    assert.deepStrictEqual(f.script.rounds[0].upsells[0].hits.map((h) => [h.p, h.after]), [[8, 20], [13, 20], [14, 20]]);
    // stacking: two upsells next to one bubble multiply (2 x 3 = 6); an upsell next to an upsell does nothing; a non-hot neighbour is ignored
    const h2 = new Uint8Array(30); for (const p of [6, 7, 8, 12]) h2[p] = 1;   // 7 is a bubble between upsells 6 and 8; 12 is below 6 and is an upsell too
    const e2 = E.createEngine(cfgWith({ adjacency: 4 }));
    f = e2.phoneFeature(Q(e2, 0, [rv(e2, 'u', 2), rv(e2, 'b', 10), rv(e2, 'u', 3), rv(e2, 'u', 5)]), 0, h2, true, 1e9);
    assert.deepStrictEqual(f.script.rounds[0].upsells.map((u) => [u.p, u.m, u.hits.map((h) => [h.p, h.before, h.after])]), [[6, 2, [[7, 10, 20]]], [8, 3, [[7, 20, 60]]], [12, 5, []]]);
    assert.strictEqual(f.pay, 60);
    // an upsell next to a close multiplies what the close collects (applied before the close collects)
    const h3 = new Uint8Array(30); for (const p of [7, 8, 9]) h3[p] = 1;
    const e3 = E.createEngine(cfgWith({ adjacency: 4 }));
    f = e3.phoneFeature(Q(e3, 0, [rv(e3, 'u', 4), rv(e3, 'c'), rv(e3, 'b', 10), rv(e3, 'b', 2), rv(e3, 'b', 2)]), 0, h3, true, 1e9);
    const r0 = f.script.rounds[0]; assert.deepStrictEqual(r0.upsells[0].hits[0], { p: 8, k: 'c', pend: 1, before: 1, after: 4 });
    assert.deepStrictEqual(r0.collects, [{ p: 8, m: 4, took: 10, value: 40, run: 50 }]);   // wait: bubble at 9 is the only bubble in round 1 (10): took 10, x4 = 40
  });

  await test('close: collects in reading order (top to bottom, left to right); each takes all bubbles and all other closes already collected; the loop repeats on the non-close leads until a round gives no new close', () => {
    const rv = (e, k, v) => revealIdx(e, 0, k, v);
    const leads = [3, 9, 12, 20, 21]; const hot = new Uint8Array(30); for (const p of leads) hot[p] = 1;
    const e = eng;
    // round 1: close@3, bubble 1.0x@9, bubble 2.0x@12, close@20, bubble 0.5x@21 -> close@3 takes 35, close@20 takes 35 + 35 = 70
    // round 2 (leads 9,12,21 re-reveal): close@9?? no: keep it simple: three 0.2x bubbles, no close -> stop
    let f = e.phoneFeature(Q(e, 0, [rv(e, 'c'), rv(e, 'b', 10), rv(e, 'b', 20), rv(e, 'c'), rv(e, 'b', 5), rv(e, 'b', 2), rv(e, 'b', 2), rv(e, 'b', 2)]), 0, hot, true, 1e9);
    assert.deepStrictEqual(f.script.rounds[0].collects.map((c) => [c.p, c.took, c.value]), [[3, 35, 35], [20, 70, 70]]);
    assert.strictEqual(f.script.rounds.length, 2); assert.strictEqual(f.pay, 35 + 70 + 6);
    // repeat: round 2 reveals a NEW close @12 which takes the three new bubbles + both old closes; round 3 ends
    f = e.phoneFeature(Q(e, 0, [rv(e, 'c'), rv(e, 'b', 10), rv(e, 'b', 20), rv(e, 'c'), rv(e, 'b', 5),                   // round 1
      rv(e, 'b', 40), rv(e, 'c'), rv(e, 'b', 30),                                                                         // round 2 (9, 12, 21)
      rv(e, 'b', 2), rv(e, 'b', 2)]), 0, hot, true, 1e9);                                                                 // round 3 (9, 21)
    assert.strictEqual(f.script.rounds.length, 3);
    assert.deepStrictEqual(f.script.rounds[1].reveals.map((r) => r.p), [9, 12, 21]);
    assert.deepStrictEqual(f.script.rounds[1].collects.map((c) => [c.p, c.took, c.value]), [[12, 40 + 30 + 35 + 70, 175]]);   // new bubbles 40+30, closes 35 and 70
    assert.strictEqual(f.pay, 35 + 70 + 175 + 4);
    assert.deepStrictEqual(f.script.rounds[2].reveals.map((r) => r.p), [9, 21]); assert.deepStrictEqual(f.script.rounds[2].collects, []);
    // the loop is capped
    const e2 = E.createEngine(cfgWith({ maxRevealRounds: 2 }));
    f = e2.phoneFeature(Q(e2, 0, [rv(e2, 'c'), rv(e2, 'b', 10), rv(e2, 'b', 20), rv(e2, 'c'), rv(e2, 'b', 5), rv(e2, 'b', 40), rv(e2, 'c'), rv(e2, 'b', 30)]), 0, hot, true, 1e9);
    assert.strictEqual(f.script.rounds.length, 2); assert.strictEqual(f.script.rounds[1].collects.length, 1);
    // all-close config terminates by itself (every round turns leads into closes; no non-close leads left ends it)
    const e3 = E.createEngine(cfgWith({ reveal: { base: { bronze: 0, silver: 0, gold: 0, upsell: 0, close: 1 }, bonus1: CFG.reveal.bonus1, bonus2: CFG.reveal.bonus2, bonus3: CFG.reveal.bonus3 } }));
    f = e3.phoneFeature(E.rngFrom(1), 0, hot, true, 1e9); assert.strictEqual(f.script.rounds.length, 1); assert.strictEqual(f.pay, 0);
  });

  await test('bonus rules over 4,000 simulated bonuses: hot lead carry (bonus1 until a phone uses them, bonus2/3 for the whole bonus), bonus3 phone every spin and no bronze, retriggers, upgrade, spin cap', () => {
    const rng = E.rngFrom(31); const seen = { up: 0, add2: 0, add4: 0, b3: 0, kept1: 0, cleared1: 0, capSpins: 0 };
    for (let i = 0; i < 4000; i++) {
      const kind = 1 + (i % 3); const b = eng.playBonus(rng, kind, true, 1e9, null).script;
      assert.strictEqual(b.kind, E.MODES[kind]); assert.strictEqual(b.startSpins, CFG.spins[E.MODES[kind]]);
      let left = b.startSpins, awarded = b.startSpins, mode = E.MODES[kind], carry = [];
      assert.deepStrictEqual(b.spins[0].hotIn, []);
      b.spins.forEach((s, n) => {
        assert.strictEqual(s.n, n + 1); assert.strictEqual(s.mode, mode); assert.deepStrictEqual(s.hotIn, carry);
        const hotAll = s.steps.length ? s.steps[s.steps.length - 1].hot : s.hotIn;
        left--; let add = 0, up = false;
        if (mode === 'bonus1') { if (s.bells >= 4) { add = CFG.retrigger.upgrade; up = true; } else if (s.bells === 3) add = CFG.retrigger.three; else if (s.bells === 2) add = CFG.retrigger.two; }
        else if (s.bells >= 3) add = CFG.retrigger.three; else if (s.bells === 2) add = CFG.retrigger.two;
        add = Math.min(add, CFG.maxSpins - awarded); awarded += add; left += add;
        assert.strictEqual(s.added, add); assert.strictEqual(!!s.upgrade, up); assert.strictEqual(s.left, left);
        if (add === 2) seen.add2++; if (add === 4) seen.add4++;
        if (mode === 'bonus1') {
          if (s.phone) { assert.deepStrictEqual(s.hotOut, []); seen.cleared1++; } else { assert.deepStrictEqual(s.hotOut, hotAll); if (hotAll.length) seen.kept1++; }
        } else assert.deepStrictEqual(s.hotOut, hotAll, mode + ' keeps every hot lead, even after a phone used them');
        if (mode === 'bonus3') { assert.ok(s.phones >= 1, 'bonus3: a phone on every spin'); seen.b3++; if (s.phone) for (const r of s.phone.rounds) for (const x of r.reveals) if (x.k === 'b') assert.notStrictEqual(x.t, 0, 'no bronze in bonus3'); }
        if (up) { mode = 'bonus2'; seen.up++; }
        carry = s.hotOut;
      });
      assert.strictEqual(b.totalSpins, awarded); assert.ok(awarded <= CFG.maxSpins); assert.strictEqual(left, 0, 'every awarded spin was played');
      assert.strictEqual(b.spins.length, awarded);
      assert.strictEqual(b.upgraded, kind === 1 && b.spins.some((s) => s.upgrade));
      if (awarded === CFG.maxSpins) seen.capSpins++;
    }
    assert.ok(seen.up > 0 && seen.add2 > 100 && seen.add4 > 20 && seen.b3 > 1000 && seen.kept1 > 0 && seen.cleared1 > 0, JSON.stringify(seen));
  });

  await test('bonus rules: bonus 1 hot leads clear when a phone activates them; bonus2 keeps them after activation (scripted spin)', () => {
    const g = fillGrid(); for (const p of [0, 1, 2, 3, 4]) g[p] = 0; g[29] = 12;
    for (const [mi, expectOut] of [[0, []], [1, []], [2, [0, 1, 2, 3, 4]], [3, [0, 1, 2, 3, 4]]]) {
      const hot = new Uint8Array(30);
      const q = Q(eng, mi, [].concat(symsVals(eng, mi, Array.from({ length: 5 }, (_, i) => FILL(i))), Array.from({ length: 5 }, () => revealIdx(eng, mi, 'b', mi === 3 ? 50 : 10))));
      const sp = eng.playSpin(q, mi, hot, true, { grid: g, capLeft: 1e9 });
      assert.ok(sp.script.phone, 'phone fired in mode ' + mi); assert.deepStrictEqual(sp.script.hotOut, expectOut, 'mode ' + mi); assert.strictEqual(q.left(), 0);
      assert.deepStrictEqual(Array.from(hot).flatMap((v, p) => (v ? [p] : [])), expectOut);
    }
    // no phone: bonus1 keeps its leads for the next spin, base clears them
    const g2 = fillGrid(); for (const p of [0, 1, 2, 3, 4]) g2[p] = 0;
    for (const [mi, expectOut] of [[0, []], [1, [0, 1, 2, 3, 4]], [2, [0, 1, 2, 3, 4]], [3, [0, 1, 2, 3, 4]]]) {
      const hot = new Uint8Array(30);
      const sp = eng.playSpin(symQueue(eng, mi, Array.from({ length: 5 }, (_, i) => FILL(i))), mi, hot, true, { grid: g2, capLeft: 1e9 });
      assert.strictEqual(sp.script.phone, null); assert.deepStrictEqual(sp.script.hotOut, expectOut, 'no phone, mode ' + mi);
    }
    // carried leads from an earlier spin reveal when a phone lands on a spin with no win
    const carried = new Uint8Array(30); carried[10] = 1; carried[11] = 1;
    const g3 = fillGrid(); g3[29] = 12;
    const sp3 = eng.playSpin(Q(eng, 1, [revealIdx(eng, 1, 'b', 10), revealIdx(eng, 1, 'b', 20)]), 1, carried, true, { grid: g3, capLeft: 1e9 });
    assert.deepStrictEqual(sp3.script.hotIn, [10, 11]); assert.strictEqual(sp3.phone, 30); assert.deepStrictEqual(sp3.script.hotOut, []);
  });

  await test('bonus 3 and the call buy: a phone is guaranteed on every spin (random grids, 3,000 spins each)', () => {
    const rng = E.rngFrom(5);
    for (let i = 0; i < 3000; i++) {
      const sp = eng.playSpin(rng, 3, new Uint8Array(30), true, { guarantee: true, capLeft: 1e9 }); assert.ok(sp.phones >= 1); assert.ok(sp.script.grid.includes(12));
      const r = E.resolveRound(rng, 'call'); assert.ok(r.script.spin.grid.includes(12));
    }
  });

  await test('bells: 3 bells start bonus1, 4 bonus2, 5+ bonus3; 2 bells is a tease with no bonus; the QA forces place exactly that many', () => {
    for (const [force, bells, kind] of [['bonus1', 3, 'bonus1'], ['bonus2', 4, 'bonus2'], ['bonus3', 5, 'bonus3']]) for (let s = 1; s <= 25; s++) {
      const r = E.resolveRound(E.rngFrom(s), null, { force });
      assert.strictEqual(r.script.spin.bells, bells); assert.strictEqual(r.script.bonus.kind, kind); assert.strictEqual(r.script.buy, null);
    }
    for (let s = 1; s <= 25; s++) { const r = E.resolveRound(E.rngFrom(s), null, { force: 'tease' }); assert.strictEqual(r.script.spin.bells, 2); assert.strictEqual(r.script.bonus, null); }
    // natural: bonus kind always follows the bell count of the base spin
    const rng = E.rngFrom(12); let n3 = 0, n4 = 0;
    for (let i = 0; i < 400000; i++) { const r = eng.round(rng, null); const b = r.bells; assert.strictEqual(r.bonusKind, r.capped && !r.bonusKind ? 0 : b >= 5 ? 3 : b === 4 ? 2 : b === 3 ? 1 : 0); if (b === 3) n3++; if (b === 4) n4++; }
    assert.ok(n3 > 500 && n4 > 20);
  });

  await test('bonus buys start the bonus directly: bonus1 / bonus2 have no base spin, cost the configured price, and call is a base spin with a phone', () => {
    for (const [buy, kind] of [['bonus1', 'bonus1'], ['bonus2', 'bonus2']]) {
      const r = E.resolveRound(E.rngFrom(3), buy); assert.strictEqual(r.script.spin, null); assert.strictEqual(r.script.bonus.kind, kind); assert.strictEqual(r.costTenths, CFG.buyCost[buy]); assert.strictEqual(r.script.buy, buy);
    }
    const c = E.resolveRound(E.rngFrom(3), 'call'); assert.strictEqual(c.costTenths, CFG.buyCost.call); assert.ok(c.script.spin.grid.includes(12));
  });

  await test('cap: win never exceeds 10,000x; a low cap clamps every path, stops the round and flags it in the script', () => {
    const rng = E.rngFrom(77);
    for (let i = 0; i < 100000; i++) { const r = eng.round(rng, i % 7 === 0 ? 'bonus2' : i % 11 === 0 ? 'bonus1' : null); assert.ok(r.winTenths >= 0 && r.winTenths <= MAXT); }
    for (let s = 1; s <= 60; s++) { const r = E.resolveRound(E.rngFrom(s), null, { force: 'bonus3' }); assert.ok(r.winTenths <= MAXT); assert.strictEqual(r.capped, r.winTenths === MAXT); assert.strictEqual(r.script.capped, r.capped); }
    const low = E.createEngine(cfgWith({ maxWinTenths: 300 })), r2 = E.rngFrom(5); const capped = {};
    for (let i = 0; i < 30000; i++) for (const buy of [null, 'call', 'bonus1', 'bonus2']) {
      const r = low.round(r2, buy, { script: true });
      assert.ok(r.winTenths <= 300, buy + ' ' + r.winTenths);
      assert.strictEqual(r.script.winTenths, r.winTenths);
      if (r.winTenths === 300) { assert.strictEqual(r.capped, true); assert.strictEqual(r.script.capped, true); capped[buy] = (capped[buy] || 0) + 1; }
      else assert.strictEqual(r.capped, false);
      const parts = r.clusterTenths + r.phoneTenths + r.bonusTenths; assert.strictEqual(r.winTenths, Math.min(parts, 300));
    }
    assert.ok(capped.null > 0 && capped.call > 0 && capped.bonus1 > 0 && capped.bonus2 > 0, JSON.stringify(capped));
    // a capped bonus stops: the last spin is flagged and no spin follows it
    const rr = E.createEngine(cfgWith({ maxWinTenths: 300 })).round(E.rngFrom(9), 'bonus2', { script: true });
    const sp = rr.script.bonus.spins; if (rr.script.bonus.capped) assert.ok(sp[sp.length - 1].capped);
  });

  await test('hard caps: constant and adversarial rng streams terminate (cascades, reveal loop, free spins)', () => {
    for (const v of [0, 0.5, 0.999999999, 0.0001]) {
      const rng = () => v; const t0 = Date.now();
      for (const buy of [null, 'call', 'bonus1', 'bonus2']) { const r = E.resolveRound(rng, buy); assert.ok(r.winTenths <= MAXT); }
      assert.ok(Date.now() - t0 < 5000);
    }
    const e = E.createEngine(cfgWith({ maxCascades: 3 }));
    const sp = e.playSpin(() => 0, 0, new Uint8Array(30), true, { capLeft: 1e9 });                // all mugs forever: would cascade without end
    assert.strictEqual(sp.script.steps.length, 3);
    const e2 = E.createEngine(cfgWith({ retrigger: { two: 50, three: 50, upgrade: 50 }, maxSpins: 14 }));
    for (let s = 1; s <= 200; s++) { const b = e2.playBonus(E.rngFrom(s), 1 + (s % 3), true, 1e9, null); assert.ok(b.script.totalSpins <= 14 && b.script.spins.length <= 14); }
  });

  await test('engine: same seed gives the same round (script included), another seed differs; lean mode and script mode agree', () => {
    for (const buy of [null, 'call', 'bonus1', 'bonus2']) {
      const a = E.resolveRound(E.rngFrom(42), buy), b = E.resolveRound(E.rngFrom(42), buy), c = E.resolveRound(E.rngFrom(43), buy);
      assert.deepStrictEqual(a, b); assert.notDeepStrictEqual(a.script, c.script);
    }
    for (const buy of [null, 'call', 'bonus1', 'bonus2']) for (let s = 1; s <= 600; s++) {
      const a = eng.round(E.rngFrom(s), buy, { script: true }), b = eng.round(E.rngFrom(s), buy);
      assert.strictEqual(a.winTenths, b.winTenths); assert.strictEqual(a.bonusKind, b.bonusKind); assert.strictEqual(a.capped, b.capped); assert.strictEqual(a.clusterTenths, b.clusterTenths); assert.strictEqual(a.phoneTenths, b.phoneTenths);
    }
  });

  await test('engine: integer tenths everywhere; the script parts add up to the round win; every pay has an integer cents value at every bet level (30,000 rounds, property test)', () => {
    for (const b of E.BET_LEVELS) assert.ok(b % 10 === 0 || [1, 2, 5].includes(b));      // whole tenths of a bet are whole cents from 10c up; at 1c / 2c / 5c wins are rounded (roundCents)
    for (const v of Object.values(PAYT).flat()) assert.ok(Number.isInteger(v) && v > 0);
    const rng = E.rngFrom(9);
    for (let i = 0; i < 30000; i++) {
      const buy = [null, null, null, 'call', 'bonus1', 'bonus2'][i % 6];
      const r = E.resolveRound(rng, buy, !buy && i % 50 === 7 ? { force: E.FORCES[(i / 50 | 0) % 4] } : undefined);
      ids(r.script, 'script'); assert.ok(Number.isInteger(r.winTenths) && Number.isInteger(r.costTenths));
      const s = r.script;
      const spinWin = s.spin ? s.spin.cluster + s.spin.phoneTenths : 0, bonusWin = s.bonus ? s.bonus.winTenths : 0;
      assert.strictEqual(s.parts.cluster + s.parts.phone, spinWin); assert.strictEqual(s.parts.bonus, bonusWin);
      assert.strictEqual(s.winTenths, Math.min(spinWin + bonusWin, MAXT)); assert.strictEqual(r.winTenths, s.winTenths);
      if (s.spin) { assert.strictEqual(s.spin.steps.reduce((a, x) => a + x.pay, 0), s.spin.cluster); assert.strictEqual(s.spin.win, spinWin); }
      if (s.bonus) assert.strictEqual(s.bonus.spins.reduce((a, x) => a + x.win, 0) >= s.bonus.winTenths, true);
      for (const bet of E.BET_LEVELS.filter((x) => x % 10 === 0)) { const win = E.cents(r.winTenths, bet), cost = E.cents(r.costTenths, bet); assert.strictEqual(win * 10, r.winTenths * bet); assert.strictEqual(cost * 10, r.costTenths * bet); }
      if (i % 7 === 0) for (const bet of [1, 2, 5]) { const p = E.payRound(r.round, bet, rng); assert.ok(Number.isInteger(p.win) && Number.isInteger(p.price) && p.price >= 1 && Math.abs(p.win - r.winTenths * p.num / p.den) < 2); }
    }
    assert.throws(() => E.cents(1.5, 10)); assert.throws(() => E.cents(5, 15)); assert.throws(() => E.cents(5, 1.5)); assert.throws(() => E.cents(NaN, 10));
  });

  await test('replay: an independent replayer walks the script of 20,000 rounds (clusters, removals, gravity, hot leads, reveals, upsells, closes, bonus bookkeeping) and lands on the same total', () => {
    const rng = E.rngFrom(2027); let phoneRounds = 0, bonuses = 0, closes = 0;
    for (let i = 0; i < 20000; i++) {
      const buy = [null, null, null, null, 'call', 'bonus1', 'bonus2'][i % 7];
      const force = !buy && i % 97 === 5 ? E.FORCES[(i / 97 | 0) % 7] : null;
      const r = E.resolveRound(rng, buy, force ? { force } : undefined);
      const t = replayRound(r.script, CFG); assert.strictEqual(t.win, r.winTenths, 'round ' + i);
      phoneRounds += t.phones; bonuses += t.bonus ? 1 : 0; closes += t.closes;
    }
    assert.ok(phoneRounds > 300 && bonuses > 100 && closes > 20, [phoneRounds, bonuses, closes].join());
  });

  await test('replay: the replayer catches a tampered script (changed pay, hot square, collect, grid, bonus total)', () => {
    const base = E.resolveRound(E.rngFrom(7), null, { force: 'close' }).script;
    assert.doesNotThrow(() => replayRound(base, CFG));
    const mut = (fn) => { const s = clone(base); fn(s); return s; };
    for (const fn of [(s) => { s.spin.steps[0].pay += 1; }, (s) => { s.spin.steps[0].hot.pop(); }, (s) => { s.spin.phone.rounds[0].collects[0].value += 1; }, (s) => { s.spin.steps[0].grid[0] = (s.spin.steps[0].grid[0] + 1) % 10; },
      (s) => { s.spin.phone.pay += 1; }, (s) => { s.spin.phone.rounds[0].reveals[0].v += 100; }, (s) => { s.winTenths += 1; }]) assert.throws(() => replayRound(mut(fn), CFG));
    const bz = E.resolveRound(E.rngFrom(8), 'bonus2').script; assert.doesNotThrow(() => replayRound(bz, CFG));
    const z = clone(bz); z.bonus.spins[2].added += 1; assert.throws(() => replayRound(z, CFG));
    const y = clone(bz); y.bonus.winTenths += 1; y.winTenths += 1; assert.throws(() => replayRound(y, CFG));
  });

  await test('QA forces (engine): phone >= 4 hot leads, close with a second reveal round, big >= 25x, tease exactly 2 bells and no bonus, bonus1/2/3', () => {
    for (let s = 1; s <= 12; s++) {
      let r = E.resolveRound(E.rngFrom(s), null, { force: 'phone' }); assert.ok(r.script.spin.phone && r.script.spin.phone.leads.length >= 4);
      r = E.resolveRound(E.rngFrom(s), null, { force: 'close' }); const ph = r.script.spin.phone; assert.ok(ph.rounds.length >= 2 && ph.rounds[0].collects.length >= 1);
      r = E.resolveRound(E.rngFrom(s), null, { force: 'big' }); assert.ok(r.winX >= 25, 'big ' + r.winX);
    }
  });

  await test('engine: short sanity band (2M spins, fixed seed): hit rate 18-26%, natural bonus 1 in 300-600, RTP 60-130 (the tight figure is the sim)', () => {
    // re-pinned at 265dd33 (levers values, LEVERS.md 8): this is the STATELESS base game (pull.on = false: no Callback, warm squares, PICK or pot), so it is the full game minus about 28 points:
    // natural bonus 1 in 420 (was 207; the Callback adds the rest, any bonus stays 1 in 208), measured 1 in 417, hit 20.48%, RTP 67.6% (full game 97.96 less Callback 22.4, warm 4.3, pot 1.0, PICK edge)
    const rng = E.rngFrom(2026); const N = 2000000; let sum = 0, hit = 0, bonus = 0, tot = 0;
    for (let i = 0; i < N; i++) { const r = eng.round(rng, null); sum += r.winTenths; if (r.clusterTenths > 0) hit++; if (r.bonusKind) bonus++; }
    const rtp = sum / N / 10 * 100, hr = hit / N * 100;
    assert.ok(hr > 18 && hr < 26, 'hit ' + hr.toFixed(2)); assert.ok(N / bonus > 300 && N / bonus < 600, 'bonus 1 in ' + N / bonus); assert.ok(rtp > 60 && rtp < 130, 'rtp ' + rtp.toFixed(2));
  });

  await test('engine: buys priced near 98% each (bonus buys 60k runs, call 400k; wide band, the tight figure is the sim)', () => {
    const rng = E.rngFrom(8);
    for (const [buy, n] of [['call', 400000], ['bonus1', 60000], ['bonus2', 60000]]) {
      let sum = 0; for (let i = 0; i < n; i++) sum += eng.round(rng, buy).winTenths;
      const rtp = sum / n / CFG.buyCost[buy] * 100;
      assert.ok(rtp > 85 && rtp < 112, buy + ' buy rtp ' + rtp.toFixed(2));
    }
  });

  await test('engine: the browser copy is byte-identical to the server engine', () => {
    assert.ok(fs.readFileSync(path.join(__dirname, '..', 'games', 'coldcall-engine.js')).equals(fs.readFileSync(path.join(__dirname, '..', 'public', 'games', 'coldcall', 'engine.js'))));
  });


  // ---------------------------------------------------------------- server module
  await test('registry: coldcall is registered next to bender', () => {
    const s = setup(); assert.ok(s.g.modules.some((m) => m.id === 'coldcall' && m.kind === 'solo' && typeof m.handlers.spin === 'function'));
  });

  await test('coldcall: unsigned socket gets auth error, ledger untouched', async () => {
    const s = setup(); const u = s.sock(null);
    u.send('g:coldcall:spin', { bet: 10, mode: 'play' }); u.send('g:coldcall:state');
    assert.strictEqual(all(u, 'error').length, 2);
    assert.ok(all(u, 'error').every((e) => e.code === 'auth'));
    assert.strictEqual(all(u, 'g:coldcall:result').length, 0);
  });

  await test('coldcall: play spin pays exactly what the engine resolves (cost bet, win winTenths*bet/10), result shape', async () => {
    const s = setup({ rng: E.rngFrom(5) }); const a = s.sock('ann'); const mirror = E.rngFrom(5);
    let expect = 1000000;
    for (let i = 0; i < 60; i++) {
      s.clock.advance(200); const bet = E.BET_LEVELS[i % E.BET_LEVELS.length];
      a.send('g:coldcall:spin', { bet, mode: 'play' });
      const r = last(a, 'g:coldcall:result'); const m = E.resolveRound(mirror, null);
      assert.strictEqual(r.bet, bet); assert.strictEqual(r.cost, bet); if (bet % 10 === 0) assert.strictEqual(r.totalWin, m.winTenths * bet / 10); else assert.ok(Math.abs(r.totalWin - m.winTenths * bet / 10) < 2, 'rounded win at ' + bet + 'c'); assert.strictEqual(r.totalWinTenths, m.winTenths);
      assert.deepStrictEqual(r.script, m.script);
      expect += -bet + r.totalWin; assert.strictEqual(r.wallet.play, expect); assert.strictEqual(r.wallet.chips, 10000);
      for (const k of ['roundId', 'script', 'totalWin', 'tier', 'wallet']) assert.ok(k in r, k);
    }
    assert.deepStrictEqual(s.bal('ann', 'play'), expect);
    await tick(); assert.strictEqual(last(a, 'wallet').play, expect);
  });

  await test('coldcall: chips spin moves only the chips bank', async () => {
    const s = setup({ rng: E.rngFrom(6) }); const a = s.sock('ann');
    a.send('g:coldcall:spin', { bet: 200, mode: 'chips' }); await tick();
    const r = last(a, 'g:coldcall:result');
    assert.strictEqual(r.mode, 'chips');
    assert.strictEqual(r.wallet.play, 1000000); assert.strictEqual(r.wallet.chips, 10000 - 200 + r.totalWin);
    assert.strictEqual(s.bal('ann', 'chips'), r.wallet.chips);
  });

  await test('coldcall: buys charge costTenths*bet/10, play the chosen bonus, and the engine win is paid exactly', async () => {
    const s = setup({ rng: E.rngFrom(12) }); const a = s.sock('ann'); const mirror = E.rngFrom(12); let bal = 1000000;
    for (const buy of ['call', 'bonus1', 'bonus2', 'call']) for (const bet of [10, 50, 2500]) {
      s.clock.advance(200); a.send('g:coldcall:spin', { bet, mode: 'play', buyBonus: buy });
      const r = last(a, 'g:coldcall:result'); const m = E.resolveRound(mirror, buy);
      assert.strictEqual(r.buyBonus, buy); assert.strictEqual(r.cost, E.CFG.buyCost[buy] * bet / 10); assert.strictEqual(r.costTenths, E.CFG.buyCost[buy]);
      if (buy === 'call') assert.ok(r.script.spin.grid.includes(12)); else { assert.strictEqual(r.script.spin, null); assert.strictEqual(r.script.bonus.kind, buy); }
      assert.deepStrictEqual(r.script, m.script); assert.strictEqual(r.totalWin, m.winTenths * bet / 10);
      bal += -r.cost + r.totalWin; assert.strictEqual(r.wallet.play, bal);
    }
    a.send('g:coldcall:state'); const st = last(a, 'g:coldcall:state');
    assert.deepStrictEqual(st.betLevels, E.BET_LEVELS); assert.deepStrictEqual(st.buyCostX, Object.fromEntries(E.BUYS.map((b) => [b, E.CFG.buyCost[b] / 10])));
  });

  await test('coldcall: a buy the player cannot afford is refused with funds and nothing moves', async () => {
    const s = setup({ rng: E.rngFrom(14) }); const a = s.sock('ann');
    s.setBal('ann', 'play', 1000);                          // 10.00 left; a bonus2 buy at a 25.00 bet costs far more
    a.send('g:coldcall:spin', { bet: 2500, mode: 'play', buyBonus: 'bonus2' });
    assert.strictEqual(last(a, 'error').code, 'funds'); assert.strictEqual(all(a, 'g:coldcall:result').length, 0);
    assert.strictEqual(s.bal('ann', 'play'), 1000);
    s.clock.advance(200); a.send('g:coldcall:spin', { bet: 1000, mode: 'play' });   // exactly the balance: allowed
    assert.strictEqual(all(a, 'g:coldcall:result').length, 1);
    assert.ok(s.bal('ann', 'play') >= 0);
  });

  await test('coldcall: an empty chips bank stops spins, no negative play, balances never go below zero', async () => {
    const s = setup({ rng: E.rngFrom(7) }); const a = s.sock('ann');
    s.setBal('ann', 'chips', 100);
    for (let i = 0; i < 40; i++) { s.clock.advance(200); a.send('g:coldcall:spin', { bet: 1000, mode: 'chips' }); }
    const e = all(a, 'error').find((x) => x.code === 'funds');
    assert.ok(e && /chips/.test(e.message));
    assert.ok(s.bal('ann', 'chips') >= 0);
    const b = s.sock('bo'); s.setBal('bo', 'play', 100);
    s.clock.advance(200); b.send('g:coldcall:spin', { bet: 500, mode: 'play' });
    assert.strictEqual(last(b, 'error').code, 'funds'); assert.strictEqual(s.bal('bo', 'play'), 100);
  });

  await test('coldcall: bad bets, modes, buys and payload shapes are rejected without touching the ledger', async () => {
    const s = setup(); const a = s.sock('ann');
    const bad = [{ bet: 0, mode: 'play' }, { bet: -10, mode: 'play' }, { bet: 15, mode: 'play' }, { bet: 1.5, mode: 'play' }, { bet: NaN, mode: 'play' }, { bet: Infinity, mode: 'play' },
      { bet: 1e21, mode: 'play' }, { bet: 2 ** 60, mode: 'play' }, { bet: Number.MAX_SAFE_INTEGER, mode: 'play' }, { bet: 5000, mode: 'play' }, { bet: [100], mode: 'play' },
      { bet: '100', mode: 'play' }, { bet: 100, mode: 'ledger' }, { bet: 100, mode: 'PLAY' }, { bet: 100, mode: ['play'] }, { bet: 100 }, { mode: 'play' }, null, 'x', 7, [],
      { bet: 100, mode: 'play', buyBonus: 'nope' }, { bet: 100, mode: 'play', buyBonus: 'election' }, { bet: 100, mode: 'play', buyBonus: 'rotary' }, { bet: 100, mode: 'play', buyBonus: 'quote' }, { bet: 100, mode: 'play', buyBonus: 'Bonus1' }, { bet: 100, mode: 'play', buyBonus: 1 }, { bet: 100, mode: 'play', buyBonus: true },
      { bet: 100, mode: 'play', buyBonus: {} }, { bet: 100, mode: 'play', buyBonus: ['bonus1'] }, { bet: 100, mode: 'play', buyBonus: 'BONUS2' }];
    for (const p of bad) { s.clock.advance(200); a.send('g:coldcall:spin', p); }
    assert.strictEqual(all(a, 'error').length, bad.length);
    assert.strictEqual(all(a, 'g:coldcall:result').length, 0);
    assert.deepStrictEqual(s.balances('ann'), { play: 1000000, chips: 10000 });
  });

  await test('coldcall: client-sent amounts are ignored (win, cost, amount fields in the payload change nothing)', async () => {
    const s = setup({ rng: E.rngFrom(15) }); const a = s.sock('ann'); const mirror = E.rngFrom(15);
    a.send('g:coldcall:spin', { bet: 100, mode: 'play', win: 999999, totalWin: 999999, cost: 1, amount: -5, costTenths: 0, winTenths: 99999999 });
    const r = last(a, 'g:coldcall:result'), m = E.resolveRound(mirror, null);
    assert.strictEqual(r.cost, 100); assert.strictEqual(r.totalWin, m.winTenths * 10); assert.strictEqual(r.wallet.play, 1000000 - 100 + r.totalWin);
  });

  await test('coldcall: rate limit 150ms per socket', async () => {
    const s = setup({ rng: E.rngFrom(8) }); const a = s.sock('ann'), b = s.sock('bo');
    a.send('g:coldcall:spin', { bet: 10, mode: 'play' });
    s.clock.advance(100); a.send('g:coldcall:spin', { bet: 10, mode: 'play' });
    assert.strictEqual(last(a, 'error').code, 'rate'); assert.strictEqual(all(a, 'g:coldcall:result').length, 1);
    b.send('g:coldcall:spin', { bet: 10, mode: 'play' });
    assert.strictEqual(all(b, 'g:coldcall:result').length, 1);
    s.clock.advance(150); a.send('g:coldcall:spin', { bet: 10, mode: 'play' });
    assert.strictEqual(all(a, 'g:coldcall:result').length, 2);
  });

  await test('coldcall: concurrent spins and buys from many sockets keep exact accounting', async () => {
    const s = setup({ rng: E.rngFrom(11) });
    const socks = [s.sock('ann'), s.sock('ann'), s.sock('bo'), s.sock('bo')];
    for (let i = 0; i < 40; i++) { s.clock.advance(200); for (const k of socks) k.send('g:coldcall:spin', { bet: 50, mode: i % 2 ? 'play' : 'chips', buyBonus: i % 10 === 3 ? 'bonus1' : i % 10 === 7 ? 'call' : null }); }
    await tick();
    for (const key of ['ann', 'bo']) {
      const mine = socks.filter((k) => k.data.acct.key === key);
      const results = mine.flatMap((k) => all(k, 'g:coldcall:result'));
      const play = results.filter((r) => r.mode === 'play'), led = results.filter((r) => r.mode === 'chips');
      const w = s.balances(key);
      assert.strictEqual(w.play, 1000000 - play.reduce((a, r) => a + r.cost, 0) + play.reduce((a, r) => a + r.totalWin, 0));
      assert.strictEqual(w.chips, 10000 - led.reduce((a, r) => a + r.cost, 0) + led.reduce((a, r) => a + r.totalWin, 0));
      for (const k of mine) assert.deepStrictEqual(last(k, 'wallet'), w);
    }
  });

  await test('settlement, Play $ and Chips: on every spin and buy at every bet level balance before - cost + win = balance after, whole units only, the other purse never moves, the wallet push equals the result, a fast double click is charged once', async () => {
    const plays = [null, null, null, null, null, 'call', null, 'hunt', 'bonus1', 'bonus2'];
    for (const mode of ['play', 'chips']) {
      const other = mode === 'play' ? 'chips' : 'play';
      const s = setup({ rng: E.rngFrom(mode === 'play' ? 21 : 22) }); const a = s.sock('ann');
      s.setBal('ann', mode, 1000000000);
      const start = s.balances('ann'); let bal = start[mode], n = 0, paid = 0, bought = 0;
      for (let i = 0; i < 480; i++) {
        const bet = E.BET_LEVELS[i % E.BET_LEVELS.length], buy = plays[(i / E.BET_LEVELS.length | 0) % plays.length];
        s.clock.advance(200);
        assert.strictEqual(s.bal('ann', mode), bal);
        a.send('g:coldcall:spin', { bet, mode, buyBonus: buy });
        a.send('g:coldcall:spin', { bet, mode, buyBonus: buy });                    // the double click, same instant: refused, not charged
        assert.strictEqual(last(a, 'error').code, 'rate');
        const res = all(a, 'g:coldcall:result'); assert.strictEqual(res.length, ++n, 'exactly one round per click pair');
        const r = res[n - 1], cost = buy ? E.buyPrice(E.CFG.buyCost[buy], bet) : bet;
        assert.strictEqual(r.mode, mode); assert.strictEqual(r.cost, cost); if (bet % 10 === 0) assert.strictEqual(r.totalWin, r.totalWinTenths * bet / 10); else assert.ok(r.totalWin >= 0 && Math.abs(r.totalWin - r.pay.win) === 0 && Math.abs(r.totalWin - r.totalWinTenths * r.pay.num / r.pay.den) < 2);
        for (const v of [r.cost, r.totalWin, r.wallet.play, r.wallet.chips]) assert.ok(Number.isSafeInteger(v) && v >= 0, 'whole units: ' + v);
        assert.ok(r.totalWin <= E.MAX_WIN_X * bet, 'cap');
        bal += -cost + r.totalWin; if (r.totalWin) paid++; if (buy) bought++;
        assert.strictEqual(r.wallet[mode], bal, mode + ' round ' + i + ': before - cost + win = after');
        assert.strictEqual(r.wallet[other], start[other]);
        assert.deepStrictEqual(s.balances('ann'), r.wallet);
        assert.strictEqual(s.bal('ann', mode), bal);
        await tick(); assert.deepStrictEqual(last(a, 'wallet'), r.wallet, 'the pushed wallet is the settled one');
      }
      assert.ok(paid > 60 && bought > 150, 'the run covered wins and buys: ' + paid + ' / ' + bought);
      // wallet stats {rounds, wagered, won} are ledger facts: one batch per round, and what the house holds is exactly what the player lost
      assert.strictEqual(s.lines((e) => e.cur === mode && e.reason === 'coldcall:round' && e.ref.startsWith('coldcall:ann:')).length, 0);   // a batch is one line per leg
      assert.strictEqual(new Set(s.lines((e) => e.cur === mode && /^coldcall:ann:/.test(e.ref)).map((e) => e.ref)).size, n, 'one ledger ref per round');
      assert.strictEqual(s.house(mode), start[mode] - bal); assert.strictEqual(s.pool(mode), 0);
    }
  });

  await test('coldcall: history keeps the last 20 and wallet_get still works', async () => {
    const s = setup({ rng: E.rngFrom(13) }); const a = s.sock('ann');
    for (let i = 0; i < 25; i++) { s.clock.advance(200); a.send('g:coldcall:spin', { bet: 10, mode: 'play' }); }
    a.send('g:coldcall:history'); const h = last(a, 'g:coldcall:history');
    assert.strictEqual(h.rounds.length, 20); assert.strictEqual(h.rounds[0].roundId, all(a, 'g:coldcall:result').slice(-1)[0].roundId);
    a.send('wallet_get'); assert.strictEqual(last(a, 'wallet').play, s.bal('ann', 'play'));
  });

  // ---------------------------------------------------------------- QA hook (COLDCALL_TEST)
  const withEnv = async (vars, fn) => {
    const old = {}; for (const k of Object.keys(vars)) { old[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; }
    try { await fn(); } finally { for (const k of Object.keys(old)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } }
  };
  const FORCE_CASES = ['bonus1', 'bonus2', 'bonus3', 'phone', 'close', 'big', 'tease'];

  await test('coldcall QA hook: the force list is exactly the documented one', () => { assert.deepStrictEqual(E.FORCES, FORCE_CASES); });

  await test('coldcall QA hook: without COLDCALL_TEST the force field is ignored (same rounds as an unforced mirror, no qaHook, no forced flag)', async () => {
    await withEnv({ COLDCALL_TEST: null, NODE_ENV: null }, async () => {
      const s = setup({ rng: E.rngFrom(77) }); const a = s.sock('ann'); const mirror = E.rngFrom(77);
      a.send('g:coldcall:state'); assert.strictEqual(last(a, 'g:coldcall:state').qaHook, undefined);
      for (let i = 0; i < 28; i++) {
        s.clock.advance(200); a.send('g:coldcall:spin', { bet: 100, mode: 'play', force: FORCE_CASES[i % 7] });
        const r = last(a, 'g:coldcall:result'), m = E.resolveRound(mirror, null);
        assert.strictEqual(r.forced, undefined); assert.strictEqual(r.totalWin, m.winTenths * 10);
        assert.deepStrictEqual(r.script, m.script);
      }
    });
  });

  await test('coldcall QA hook: COLDCALL_TEST=1 is not enough in production (NODE_ENV=production keeps it off), and COLDCALL_TEST=0/true/yes do nothing', async () => {
    for (const vars of [{ COLDCALL_TEST: '1', NODE_ENV: 'production' }, { COLDCALL_TEST: '0', NODE_ENV: null }, { COLDCALL_TEST: 'true', NODE_ENV: null }, { COLDCALL_TEST: 'yes', NODE_ENV: null }]) {
      await withEnv(vars, async () => {
        const s = setup({ rng: E.rngFrom(78) }); const a = s.sock('ann'); const mirror = E.rngFrom(78);
        a.send('g:coldcall:state'); assert.strictEqual(last(a, 'g:coldcall:state').qaHook, undefined, JSON.stringify(vars));
        for (const f of FORCE_CASES) {
          s.clock.advance(200); a.send('g:coldcall:spin', { bet: 100, mode: 'play', force: f });
          const r = last(a, 'g:coldcall:result'), m = E.resolveRound(mirror, null);
          assert.strictEqual(r.forced, undefined, JSON.stringify(vars)); assert.deepStrictEqual(r.script, m.script);
        }
      });
    }
  });

  await test('coldcall QA hook: with COLDCALL_TEST=1 each force plays that feature, through the normal ledger path (ctx.money.round), in both purses', async () => {
    await withEnv({ COLDCALL_TEST: '1', NODE_ENV: null }, async () => {
      const s = setup({ rng: E.rngFrom(79) }); const a = s.sock('ann'); let bal = 1000000;
      a.send('g:coldcall:state'); assert.strictEqual(last(a, 'g:coldcall:state').qaHook, true);
      for (const f of FORCE_CASES) for (const mode of ['play', 'chips']) {
        s.clock.advance(200); a.send('g:coldcall:spin', { bet: 200, mode, force: f });
        const r = last(a, 'g:coldcall:result'); assert.strictEqual(r.forced, f); assert.strictEqual(r.buyBonus, null);
        const sc = r.script;
        if (f === 'bonus1' || f === 'bonus2' || f === 'bonus3') { assert.strictEqual(sc.bonus.kind, f); assert.strictEqual(sc.spin.bells, { bonus1: 3, bonus2: 4, bonus3: 5 }[f]); }
        if (f === 'phone') assert.ok(sc.spin.phone && sc.spin.phone.leads.length >= 4);
        if (f === 'close') assert.ok(sc.spin.phone.rounds.length >= 2 && sc.spin.phone.rounds[0].collects.length >= 1);
        if (f === 'big') assert.ok(r.totalWinMult >= 25, 'big win ' + r.totalWinMult);
        if (f === 'tease') { assert.strictEqual(sc.spin.bells, 2); assert.strictEqual(sc.bonus, null); }
        assert.strictEqual(r.cost, 200); assert.strictEqual(r.totalWin, r.totalWinTenths * 200 / 10);
        const w = s.balances('ann');
        if (mode === 'play') { bal += -r.cost + r.totalWin; assert.strictEqual(w.play, bal); assert.strictEqual(r.wallet.play, bal); }
        else assert.strictEqual(w.chips, r.wallet.chips);
      }
      assert.strictEqual(new Set(s.lines((e) => e.cur === 'play' && /^coldcall:ann:/.test(e.ref)).map((e) => e.ref)).size, 7, 'seven forced Play $ rounds, one ledger ref each');
    });
  });

  await test('coldcall QA hook: a force is dropped when the spin is a buy, and a refused spin (no funds) still moves nothing', async () => {
    await withEnv({ COLDCALL_TEST: '1', NODE_ENV: null }, async () => {
      const s = setup({ rng: E.rngFrom(80) }); const a = s.sock('ann');
      s.clock.advance(200); a.send('g:coldcall:spin', { bet: 100, mode: 'play', buyBonus: 'bonus1', force: 'bonus3' });
      const r = last(a, 'g:coldcall:result'); assert.strictEqual(r.forced, undefined); assert.strictEqual(r.script.bonus.kind, 'bonus1'); assert.strictEqual(r.cost, E.CFG.buyCost.bonus1 * 10);
      const b = s.sock('bo'); s.setBal('bo', 'play', 10);
      s.clock.advance(200); b.send('g:coldcall:spin', { bet: 100, mode: 'play', force: 'big' });
      assert.strictEqual(last(b, 'error').code, 'funds'); assert.strictEqual(s.bal('bo', 'play'), 10);
      s.clock.advance(200); b.send('g:coldcall:spin', { bet: 100, mode: 'play', force: 'bogus' }); // unknown force: normal paid spin path (here: funds)
      assert.strictEqual(last(b, 'error').code, 'funds');
    });
  });

  console.log(pass + ' passed' + (process.exitCode ? ', with failures' : ''));
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const f of ['coldcall-pull-engine.js', 'coldcall-pull-server.js', 'coldcall-livecfg.js', 'coldcall-presets.js', 'coldcall-money.js']) {   // THE PULL + LIVECFG: separate processes (own module state, pull.on = true)
    const r = require('child_process').spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', env: process.env });
    const m = /(\d+) passed/.exec(r.stdout || '');
    console.log(f + ': ' + (m ? m[1] + ' passed' : 'NO RESULT') + (r.status ? ', FAILED (exit ' + r.status + ')' : ''));
    if (r.status) { process.exitCode = 1; console.error((r.stdout || '').split('\n').filter((l) => /^FAIL/.test(l)).join('\n') + (r.stderr || '')); }
  }
})();
