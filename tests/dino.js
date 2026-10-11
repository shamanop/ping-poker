'use strict';
// node tests/dino.js  (self-contained: the Dino engine invariants, the browser-copy check, and the socket tests on a REAL ledger (money/ledger.js + money/service.js
// + ctx.money + the games registry) on a temp dir, fake io. Dino plays only through ctx.money.)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const EventEmitter = require('events');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dino-'));
const games = require('../games');
const { open: openLedger } = require('../money/ledger');
const { createService } = require('../money/service');
const { createGameMoney } = require('../transport/game-money');
const { createWalletAdapter } = require('../transport/wallet-adapter');
const E = require('../games/dino-engine.js');
const { COLS, ROWS, MAX_WIN_X } = E;

let pass = 0;
const test = async (name, fn) => { try { await fn(); pass++; console.log('ok   ' + name); } catch (e) { console.error('FAIL ' + name + '\n' + (e.stack || e)); process.exitCode = 1; } };
const tick = () => new Promise((r) => setImmediate(r));

function makeSocket(io, acct) {
  const s = new EventEmitter();
  s.data = acct ? { acct: { key: acct } } : {};
  s.out = [];
  const emit = s.emit.bind(s);
  s.send = (ev, p) => emit(ev, p);
  s.emit = (ev, p) => { if (ev in { error: 1, wallet: 1 } || ev.startsWith('g:')) { s.out.push([ev, p]); return true; } return emit(ev, p); };
  io.sockets.sockets.set(String(Math.random()), s);
  io.emit('connection', s);
  return s;
}
const last = (s, ev) => { for (let i = s.out.length - 1; i >= 0; i--) if (s.out[i][0] === ev) return s.out[i][1]; return null; };
const all = (s, ev) => s.out.filter((o) => o[0] === ev).map((o) => o[1]);

let wn = 0;
function setupL(opts = {}) {
  const io = new EventEmitter(); io.sockets = { sockets: new Map() };
  let t = 1000000;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const file = path.join(tmp, 'm' + (++wn) + '.jsonl');
  const ledger = openLedger(file, { fsync: 'none', log: () => {} });
  const service = createService(ledger, { signupPlay: 1000000 });
  let reg = null;
  const onChange = (k) => { if (reg) reg.pushWallet(k); };
  const money = createGameMoney({ service, ledger, onChange, log: () => {} });
  const calls = [];                                           // every ctx.money call Dino makes: [method, ...args]
  const forGame = money.forGame;
  money.forGame = (id) => { const m = forGame(id); if (id !== 'dino') return m; const w = {}; for (const k of Object.keys(m)) w[k] = (...a) => { if (k !== 'balance') calls.push([k, ...a]); return m[k](...a); }; return w; };
  const wallet = createWalletAdapter({ service, ledger, onChange, log: () => {} });
  const social = { spins: 0, onSpin() { social.spins++; } };
  reg = games({ io, wallet, money, service, social, now: clock.now, rng: opts.rng, accounts: {}, tables: {}, rooms: {}, ledger: { log: () => {} } });
  const bal = (k, c) => ledger.balance((c === 'chips' ? 'bank:' : 'play:') + k, c);
  const w = (k) => ({ play: bal(k, 'play'), chips: bal(k, 'chips') });
  const setBal = (k, c, v) => { service.ensureAccount(k); const d = v - bal(k, c); if (d) service.adminAdjust(k, d, c, 'test', 'test:' + (++wn)); };
  return { io, clock, ledger, service, file, calls, social, g: reg, bal, w, setBal, sock: (a) => { if (a) service.ensureAccount(a); return makeSocket(io, a); } };
}

// a grid from a 6x5 picture: rows top to bottom, one token per cell
const gridOf = (rows) => { const g = Array.from({ length: COLS }, () => new Array(ROWS)); let id = 1; rows.forEach((row, r) => row.split(/\s+/).forEach((s, c) => { g[c][r] = { id: id++, s, m: s === 'B' ? 2 : 0 }; })); return g; };
const cellsOf = (g) => { const m = new Map(); for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) m.set(g[c][r].id, { c, r, ...g[c][r] }); return m; };
const allSpins = (rd) => [rd.base, ...(rd.bonus ? rd.bonus.spins : [])];

// replays one SPIN's steps from its initial board and checks every invariant of the script format
function checkSpin(sp, eng) {
  let g = sp.initial.map((col) => col.map((x) => ({ ...x })));
  assert.strictEqual(g.length, COLS); assert.ok(g.every((col) => col.length === ROWS));
  let wbb = 0;
  for (const st of sp.steps) {
    const wins = eng.findWins(g);
    assert.deepStrictEqual(st.wins.map((w) => [w.s, w.count, w.pay]), wins.map((w) => [w.s, w.count, w.pay]), 'step wins = the board\'s pay-anywhere wins');
    const before = cellsOf(g), removed = new Set(st.removed.map(([c, r]) => c * ROWS + r));
    for (const [c, r] of st.removed) assert.ok(g[c][r].s !== 'S' && g[c][r].s !== 'B', 'scatters and bombs are never removed');
    assert.strictEqual(removed.size, wins.reduce((a, w) => a + w.count, 0), 'every cell of a winning symbol is removed');
    // gravity: apply fall + spawn to the board and compare with the step's grid
    const ng = Array.from({ length: COLS }, () => new Array(ROWS));
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) if (!removed.has(c * ROWS + r)) {
      const f = st.fall.find((x) => x.id === g[c][r].id);
      const to = f ? f.to : r; assert.ok(!f || (f.c === c && f.from === r && f.to > r), 'falls go down in their column');
      assert.ok(!ng[c][to]); ng[c][to] = g[c][r];
    }
    for (const sp2 of st.spawn) { assert.ok(!ng[sp2.c][sp2.r], 'spawn into an empty cell'); ng[sp2.c][sp2.r] = sp2.cell; }
    assert.ok(ng.every((col) => col.every(Boolean)), 'the board is full after a tumble');
    assert.deepStrictEqual(ng, st.grid, 'fall + spawn give the step grid');
    for (const [id, x] of before) if (x.s === 'S' || x.s === 'B') assert.ok([...cellsOf(ng).values()].some((y) => y.id === id && y.s === x.s && y.m === x.m), 'a scatter / bomb survives the tumble');
    assert.deepStrictEqual(st.bombs.map((b) => b.id).sort(), [...cellsOf(ng).values()].filter((x) => x.s === 'B').map((x) => x.id).sort(), 'step bombs = bombs on the board');
    wbb += st.stepWin;
    g = ng;
  }
  assert.deepStrictEqual(g, sp.final);
  assert.strictEqual(eng.findWins(g).length, 0, 'the tumbles end on a board with no win');
  assert.ok(Math.abs(wbb - sp.winBeforeBombs) < 1e-9);
  const sc = [...cellsOf(g).values()].filter((x) => x.s === 'S').length;
  assert.strictEqual(sp.scatters, sc);
  const bombs = [...cellsOf(g).values()].filter((x) => x.s === 'B');
  if (sp.kind !== 'bonus') assert.strictEqual(bombs.length + [sp.initial, ...sp.steps.map((s) => s.grid)].flat(2).filter((x) => x.s === 'B').length, 0, 'no bombs outside free spins');
  assert.strictEqual(sp.bombSum, bombs.reduce((a, b) => a + b.m, 0));
  const scRaw = sp.kind === 'bonus' && E.CFG.fsScatterPay && sp.scatters >= 4 ? E.CFG.scatterPay[Math.min(6, sp.scatters)] : 0;
  assert.strictEqual(sp.bombApplied, sp.kind === 'bonus' && sp.winBeforeBombs + scRaw > 0 && sp.bombSum > 0, 'bombs apply only on a free spin with a prize (tumble wins or scatter pay)');
  const want = sp.bombApplied ? sp.winBeforeBombs * sp.bombSum : sp.winBeforeBombs;
  if (sp.capped) assert.ok(sp.spinWin < want); else assert.ok(Math.abs(sp.spinWin - want) < 1e-9);
  return g;
}

(async () => {
  await test('engine: resolveRound is deterministic for a seed and returns the documented shape', () => {
    const a = E.resolveRound(E.rngFrom(9)), b = E.resolveRound(E.rngFrom(9));
    assert.deepStrictEqual(a, b);
    for (const k of ['round', 'mode', 'costMult', 'totalWinMult', 'maxed', 'tier']) assert.ok(k in a, k);
    for (const k of ['mode', 'cost', 'win', 'base', 'scatterPay', 'bonus', 'maxed']) assert.ok(k in a.round, k);
    assert.strictEqual(a.round.base.initial.length, 6); assert.strictEqual(a.round.base.initial[0].length, 5);
  });

  await test('engine: browser copy public/games/dino/engine.js is byte-identical to the head of games/dino-engine.js, and plays the same rounds', () => {
    const src = fs.readFileSync(path.join(__dirname, '../public/games/dino/engine.js'), 'utf8');
    const srv = fs.readFileSync(path.join(__dirname, '../games/dino-engine.js'), 'utf8');
    assert.strictEqual(src, srv.slice(0, srv.indexOf('\n/* ---- SERVER ADDITIONS')), 'public/games/dino/engine.js must equal the part of games/dino-engine.js above the SERVER ADDITIONS marker');
    const B = new Function('module', 'self', src + '; return self.DinoEngine;')(undefined, {});
    const sa = E.createEngine(), sb = B.createEngine();
    assert.deepStrictEqual(sb.cfg, sa.cfg);
    for (let seed = 1; seed <= 300; seed++) {
      const mode = seed % 7 === 0 ? 'buy' : seed % 3 === 0 ? 'ante' : 'spin';
      assert.deepStrictEqual(sb.round(B.rngFrom(seed), mode), sa.round(E.rngFrom(seed), mode), 'seed ' + seed);
    }
  });

  await test('engine: pay anywhere counts symbols anywhere on the board (8+), by count bucket 8-9 / 10-11 / 12+', () => {
    const eng = E.createEngine(), P = E.CFG.pay;
    const g7 = gridOf(['l5 h1 l5 h2 l5 h3', 'h4 l5 l1 l5 l2 l3', 'l5 l4 l1 h1 h2 h3', 'h4 l1 l2 l3 l4 l5', 'h1 h2 h3 h4 l1 l5']);
    assert.strictEqual(g7.flat().filter((x) => x.s === 'l5').length, 8);
    let w = eng.findWins(g7); assert.deepStrictEqual(w.map((x) => [x.s, x.count, x.pay]), [['l5', 8, P.l5[0]]], '8 apart pay');
    g7[5][4].s = 'h1'; g7[0][0].s = 'h1';     // l5 -> 7, h1 -> 5
    assert.strictEqual(eng.findWins(g7).length, 0, '7 do not pay');
    const g = gridOf(['h1 h1 h1 h1 h1 h1', 'h1 h1 h1 h1 l5 l5', 'l5 l5 l5 l5 l5 l5', 'l5 l5 S B h2 h2', 'h2 h3 h4 l1 l2 l3']);
    w = eng.findWins(g);
    assert.deepStrictEqual(w.map((x) => [x.s, x.count, x.pay]), [['h1', 10, P.h1[1]], ['l5', 10, P.l5[1]]]);
    for (let c = 0; c < 6; c++) g[c][4].s = 'h1';
    assert.deepStrictEqual(eng.findWins(g).map((x) => [x.s, x.count, x.pay]), [['h1', 16, P.h1[2]], ['l5', 10, P.l5[1]]], '12+ bucket');
    assert.ok(eng.findWins(g).every((x) => x.s !== 'S' && x.s !== 'B'), 'S and B never pay as symbols');
  });

  await test('engine: 3000 seeded rounds (spin, ante, buy): tumbles end, S/B never removed, fall+spawn = grid, bombs only in free spins and only on winning spins, totals add up', () => {
    const eng = E.createEngine();
    let bonuses = 0, applied = 0, unapplied = 0;
    for (let seed = 1; seed <= 3000; seed++) {
      const mode = seed % 5 === 0 ? 'buy' : seed % 2 ? 'spin' : 'ante';
      const rd = eng.round(E.rngFrom(seed * 7919), mode);
      for (const sp of allSpins(rd)) { checkSpin(sp, eng); if (sp.kind === 'bonus' && sp.bombs.length) { if (sp.bombApplied) applied++; else unapplied++; } }
      assert.strictEqual(rd.base.kind, mode === 'ante' ? 'ante' : 'base');
      if (mode === 'buy') { const sc = rd.base.initial.flat().filter((x) => x.s === 'S').length; assert.strictEqual(sc, 4, 'a buy places exactly 4 scatters on the first board'); assert.ok(rd.base.scatters >= 4, 'and still triggers after the tumbles'); assert.ok(rd.bonus, 'a buy always gets the bonus'); assert.strictEqual(rd.cost, 100); }
      assert.strictEqual(!!rd.bonus, rd.base.scatters >= 4, 'bonus iff 4+ scatters');
      const sp4 = rd.base.scatters >= 4 ? E.CFG.scatterPay[Math.min(6, rd.base.scatters)] : 0;
      assert.strictEqual(rd.scatterPay, sp4);
      if (rd.bonus) {
        bonuses++;
        const b = rd.bonus;
        assert.strictEqual(b.spins.length, b.startSpins + b.added, 'spins played = 10 + added');
        assert.strictEqual(b.added, b.spins.reduce((a, s) => a + (s.retrigger || 0), 0));
        for (const s of b.spins) { if (s.scatters >= 3 && !(b.capped && s === b.spins[b.spins.length - 1])) assert.ok(s.retrigger > 0 || b.startSpins + b.added >= E.CFG.maxSpins); else assert.ok(!s.retrigger); }
        for (const s of b.spins) { const m = s.bombApplied ? s.bombSum : 1; const raw = s.scatters >= 4 ? E.CFG.scatterPay[Math.min(6, s.scatters)] * m : 0; if (!b.capped) assert.ok(Math.abs(s.scatterPay - raw) < 1e-9, 'FS scatter pay x the spin\'s bombs'); }
        assert.ok(Math.abs(b.total - b.spins.reduce((a, s) => a + s.total, 0)) < 1e-6);
      }
      const sum = rd.base.spinWin + rd.scatterPay + (rd.bonus ? rd.bonus.total : 0);
      assert.ok(Math.abs(rd.win - Math.min(sum, MAX_WIN_X)) < 1e-6, 'round win = spin + scatter pay + bonus');
      assert.ok(rd.win <= MAX_WIN_X);
    }
    assert.ok(bonuses > 600 && applied > 100 && unapplied > 100, `coverage: ${bonuses} bonuses, ${applied} spins with bombs applied, ${unapplied} with bombs that did nothing`);
  });

  await test('engine: retrigger adds 5 spins on 3+ scatters, capped at maxSpins 1000 in total (safety stop only)', () => {
    const cfg = JSON.parse(JSON.stringify(E.CFG)); cfg.bonusScatterW = 40; cfg.fsScatterPay = false; cfg.bombW = 0;   // scatters everywhere: retrigger every spin (no scatter pay / bombs, so 1000 spins never reach the 10,000x cap)
    const eng = E.createEngine(cfg);
    const b = eng.playBonus(E.rngFrom(3), MAX_WIN_X);
    assert.strictEqual(E.CFG.maxSpins, 1000);
    assert.strictEqual(b.startSpins + b.added, 1000); assert.strictEqual(b.spins.length, 1000);
    assert.ok(b.spins[0].retrigger === 5 && b.retriggers >= 18);
    const e2 = E.createEngine();
    let seen = 0;
    for (let s = 1; s < 4000 && !seen; s++) { const x = e2.playBonus(E.rngFrom(s), MAX_WIN_X); if (x.retriggers) { seen++; assert.strictEqual(x.added, 5 * x.retriggers); assert.strictEqual(x.spins.length, 10 + x.added); } }
    assert.ok(seen, 'the shipped numbers retrigger');
  });

  await test('engine: the 10,000x cap holds in the base spin, after the scatter pay and inside the bonus', () => {
    const cfg = JSON.parse(JSON.stringify(E.CFG));
    for (const s of Object.keys(cfg.pay)) cfg.pay[s] = [3000, 3000, 3000];
    const eng = E.createEngine(cfg);
    let maxedBase = 0, maxedBonus = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const rd = eng.round(E.rngFrom(seed), seed % 2 ? 'buy' : 'spin');
      assert.ok(rd.win <= MAX_WIN_X);
      const sum = rd.base.winBeforeBombs + rd.scatterPay + (rd.bonus ? rd.bonus.total : 0);
      assert.strictEqual(rd.maxed, sum >= MAX_WIN_X - 1e-9 || !!rd.base.capped || !!(rd.bonus && rd.bonus.capped)); assert.ok(Math.abs(rd.win - Math.min(rd.base.spinWin + rd.scatterPay + (rd.bonus ? rd.bonus.total : 0), MAX_WIN_X)) < 1e-6);
      if (rd.maxed) assert.strictEqual(rd.win, MAX_WIN_X, 'a capped round pays exactly 10,000x (no float drift)');
      if (rd.base.winBeforeBombs >= MAX_WIN_X) { assert.strictEqual(rd.base.spinWin, MAX_WIN_X); assert.ok(rd.maxed && rd.base.capped && !rd.bonus); maxedBase++; }
      if (rd.bonus && rd.bonus.capped) { assert.strictEqual(rd.win, MAX_WIN_X); assert.ok(rd.maxed && rd.bonus.spins.length < rd.bonus.startSpins + rd.bonus.added + 1); assert.ok(rd.bonus.spins[rd.bonus.spins.length - 1].capped || rd.bonus.spins[rd.bonus.spins.length - 1].scatterPay > 0); maxedBonus++; }
    }
    assert.ok(maxedBase > 0 && maxedBonus > 0);
  });

  await test('engine: the free spin that reaches the cap gets no retrigger, spinsLeft 0; capped rounds are maxed at exactly 10,000x', () => {
    const cfg = JSON.parse(JSON.stringify(E.CFG));
    for (const s of Object.keys(cfg.pay)) cfg.pay[s] = cfg.pay[s].map((x) => x * 6);
    cfg.bombW = 6; cfg.bombTable = [[20, 1], [50, 1], [100, 1]]; cfg.bonusScatterW = 3;
    const eng = E.createEngine(cfg);
    let capped = 0, cappedWith3 = 0;
    for (let seed = 1; seed <= 1500; seed++) {
      const rd = eng.round(E.rngFrom(seed * 31), 'buy');
      if (!rd.bonus || !rd.bonus.capped) { assert.ok(!rd.maxed || rd.win === MAX_WIN_X); continue; }
      capped++;
      const last = rd.bonus.spins[rd.bonus.spins.length - 1];
      assert.ok(!last.retrigger && last.spinsLeft === 0, 'no +5 on the capping spin');
      if (last.scatters >= 3) cappedWith3++;
      assert.strictEqual(rd.bonus.added, rd.bonus.spins.reduce((a, x) => a + (x.retrigger || 0), 0));
      assert.ok(rd.maxed && rd.win === MAX_WIN_X, 'capped bonus -> maxed, win exactly 10000 (got ' + rd.win + ')');
    }
    assert.ok(capped > 20 && cappedWith3 > 0, `coverage: ${capped} capped, ${cappedWith3} capping spins with 3+ scatters`);
  });

  await test('engine: bombs use the Sweet Bonanza value set 2-100x (100x ~1% of bombs, mean ~11)', () => {
    assert.deepStrictEqual(E.CFG.bombTable.map((x) => x[0]), [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 50, 100]);
    const W = E.CFG.bombTable.reduce((a, b) => a + b[1], 0), mean = E.CFG.bombTable.reduce((a, b) => a + b[0] * b[1], 0) / W, p100 = E.CFG.bombTable[12][1] / W;
    assert.ok(mean > 10 && mean < 12.5 && p100 > 0.007 && p100 < 0.014, 'mean ' + mean + ', 100x ' + p100);
  });

  await test('engine: ante levels are the bets where 1.25 x bet is whole; ante + buy refused; config ranges checked', () => {
    assert.deepStrictEqual(E.anteLevels(), [20, 100, 200, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000]);
    assert.throws(() => E.resolveRound(E.rngFrom(1), { ante: true, buy: true }), /ante and buy/);
    assert.strictEqual(E.resolveRound(E.rngFrom(1), { ante: true }).costMult, 1.25);
    assert.strictEqual(E.resolveRound(E.rngFrom(1), { buy: true }).costMult, 100);
    assert.throws(() => E.validateConfig({ bombW: -1 }), /between/);
    assert.throws(() => E.validateConfig({ nope: 1 }), /unknown/);
    assert.throws(() => E.validateConfig({ pay: { h1: [1, 2] } }), /3 entries/);
    assert.ok(E.validateConfig({ bombW: 2 }));
    assert.deepStrictEqual(E.currentConfig(), E.DEFAULT_CFG);
  });

  await test('engine: trigger rates in range (400k seeded spins each: plain 1 in 350-450, ante 1 in 170-230, ante about 2x plain)', () => {
    const eng = E.createEngine(), got = {};
    for (const [kind, lo, hi] of [['base', 350, 450], ['ante', 170, 230]]) {
      const rng = E.rngFrom(424242); let n = 0; const N = 400000;
      for (let i = 0; i < N; i++) if (eng.playSpin(rng, { kind }).scatters >= 4) n++;
      got[kind] = N / n;
      assert.ok(N / n > lo && N / n < hi, kind + ' trigger 1 in ' + (N / n).toFixed(0));
    }
    const ratio = got.base / got.ante;
    assert.ok(ratio > 1.8 && ratio < 2.3, 'ante about doubles the trigger: x' + ratio.toFixed(2));
  });

  await test('engine: pay table is flat (12+ pays about 5x the 8-9 tier, top 12+ at most 100x), base hit rate 40-45%, buy lands exactly 4 scatters', () => {
    const P = E.CFG.pay;
    for (const s of E.REG) { assert.ok(P[s][0] < P[s][1] && P[s][1] < P[s][2], s + ' tiers rise'); const r = P[s][2] / P[s][0]; assert.ok(r >= 4.5 && r <= 5.5, s + ' 12+/8-9 ratio ' + r); assert.ok(P[s][2] <= 100, s + ' top pay'); }
    assert.ok(Math.max(...E.REG.map((s) => P[s][2])) >= 50, 'top symbol 12+ pays 50-100x');
    assert.deepStrictEqual(E.CFG.buyScatters, [[4, 1]]);
    const eng = E.createEngine(), rng = E.rngFrom(777); let hit = 0; const N = 100000;
    for (let i = 0; i < N; i++) if (eng.playSpin(rng, { kind: 'base' }).winBeforeBombs > 0) hit++;
    assert.ok(hit / N > 0.40 && hit / N < 0.45, 'hit rate ' + (hit / N * 100).toFixed(1) + '%');
  });

  await test('dino: unsigned socket gets auth error, ledger untouched', async () => {
    const s = setupL(); const u = s.sock(null);
    u.send('g:dino:spin', { bet: 10, mode: 'play' }); u.send('g:dino:state');
    assert.ok(all(u, 'error').length === 2 && all(u, 'error').every((e) => e.code === 'auth'));
    assert.strictEqual([...s.ledger.entries(null)].length, 0);
  });

  await test('dino: plain, ante and buy spins: cost 1x / 1.25x / 100x, ONE ctx.money.round each, one ref dino:<key>:<roundId>, one currency', async () => {
    const s = setupL({ rng: E.rngFrom(5) }); const a = s.sock('ann');
    let bal = 1000000;
    for (const [p, cost] of [[{}, 100], [{ ante: true }, 125], [{ buy: true }, 10000], [{ ante: false, buy: null }, 100]]) {
      s.clock.advance(200);
      const id0 = s.ledger.lastId, c0 = s.calls.length;
      a.send('g:dino:spin', { bet: 100, mode: 'play', ...p }); await tick();
      const r = last(a, 'g:dino:result');
      assert.ok(r && r.cost === cost, 'cost ' + cost);
      assert.strictEqual(r.ante, !!p.ante); assert.strictEqual(r.buy, !!p.buy);
      assert.deepStrictEqual(s.calls.slice(c0).map((x) => x[0]), ['round'], 'exactly one money call, a round');
      assert.deepStrictEqual(s.calls[c0].slice(1), ['ann', 'play', r.roundId, { cost, win: r.totalWin }]);
      const ls = [...s.ledger.entries(null, id0)];
      assert.ok(ls.length >= 1 && ls.every((l) => l.ref === 'dino:ann:' + r.roundId && l.cur === 'play'));
      bal += r.totalWin - cost;
      assert.strictEqual(r.wallet.play, bal); assert.deepStrictEqual(s.w('ann'), r.wallet);
      assert.ok(Number.isSafeInteger(r.totalWin) && Math.abs(r.totalWin - r.totalWinMult * 100) < 1);
      assert.strictEqual(r.round.mode, p.buy ? 'buy' : p.ante ? 'ante' : 'spin');
      if (p.buy) assert.ok(r.round.bonus);
    }
    assert.strictEqual(s.ledger.balance('house:dino', 'play'), 1000000 - bal);
    assert.strictEqual(s.social.spins, 0, 'Dino does not report to ctx.social (it would count as Ballot Bender spins)');
  });

  await test('dino: chips spin moves only the chips bank', async () => {
    const s = setupL({ rng: E.rngFrom(6) }); const a = s.sock('ann');
    a.send('g:dino:spin', { bet: 200, mode: 'chips', ante: true }); await tick();
    const r = last(a, 'g:dino:result');
    assert.strictEqual(r.cost, 250); assert.strictEqual(r.wallet.play, 1000000);
    assert.strictEqual(r.wallet.chips, 10000 - 250 + r.totalWin);
  });

  await test('dino: bad inputs refused with no ledger line (bets, modes, flags, ante at a non-whole level, ante + buy)', async () => {
    const s = setupL(); const a = s.sock('ann');
    const id0 = s.ledger.lastId;
    const bad = [[{ bet: 0, mode: 'play' }, 'bad_bet'], [{ bet: -10, mode: 'play' }, 'bad_bet'], [{ bet: 15, mode: 'play' }, 'bad_bet'], [{ bet: 1.5, mode: 'play' }, 'bad_bet'],
      [{ bet: NaN, mode: 'play' }, 'bad_bet'], [{ bet: '100', mode: 'play' }, 'bad_bet'], [{ bet: 100, mode: 'ledger' }, 'bad_mode'], [{ bet: 100 }, 'bad_mode'], [{ mode: 'play' }, 'bad_bet'],
      [null, 'bad_bet'], ['x', 'bad_bet'], [[100, 'play'], 'bad_bet'], [{ bet: 100, mode: 'play', ante: 'yes' }, 'bad_request'], [{ bet: 100, mode: 'play', buy: 1 }, 'bad_request'],
      [{ bet: 100, mode: 'play', ante: true, buy: true }, 'ante_buy'], [{ bet: 10, mode: 'play', ante: true }, 'ante_level'], [{ bet: 1, mode: 'chips', ante: true }, 'ante_level'], [{ bet: 50, mode: 'play', ante: true }, 'ante_level']];
    for (const [p, code] of bad) { s.clock.advance(200); a.send('g:dino:spin', p); const e = last(a, 'error'); assert.strictEqual(e.code, code, JSON.stringify(p)); assert.strictEqual(e.game, 'dino'); a.out.length = 0; }
    assert.strictEqual(s.ledger.lastId, id0);
    assert.deepStrictEqual(s.w('ann'), { play: 1000000, chips: 10000 });
    assert.strictEqual(s.calls.length, 0);
  });

  await test('dino: rate limit 150 ms per ACCOUNT (a second tab does not bypass it)', async () => {
    const s = setupL({ rng: E.rngFrom(8) }); const a = s.sock('ann'), a2 = s.sock('ann'), b = s.sock('bo');
    a.send('g:dino:spin', { bet: 10, mode: 'play' });
    s.clock.advance(100);
    a2.send('g:dino:spin', { bet: 10, mode: 'play' });
    assert.strictEqual(last(a2, 'error').code, 'rate');
    b.send('g:dino:spin', { bet: 10, mode: 'play' });
    assert.strictEqual(all(b, 'g:dino:result').length, 1, 'another account is not limited');
    s.clock.advance(60);
    a2.send('g:dino:spin', { bet: 10, mode: 'play' });
    assert.strictEqual(all(a2, 'g:dino:result').length, 1);
  });

  await test('dino: short funds refuse with no line; a refused ledger write is an error, never a result (fenced ledger)', async () => {
    const s = setupL({ rng: E.rngFrom(21) }); const a = s.sock('ann');
    s.setBal('ann', 'chips', 5000);
    a.send('g:dino:spin', { bet: 100, mode: 'chips', buy: true });
    assert.strictEqual(last(a, 'error').code, 'funds'); assert.strictEqual(s.bal('ann', 'chips'), 5000);
    s.clock.advance(200); a.send('g:dino:spin', { bet: 100, mode: 'play' });
    assert.strictEqual(all(a, 'g:dino:result').length, 1);
    const before = s.w('ann'), id0 = s.ledger.lastId;
    fs.appendFileSync(s.file, '\n');
    for (let i = 0; i < 3; i++) { s.clock.advance(200); a.send('g:dino:spin', { bet: 100, mode: 'play' }); }
    assert.strictEqual(all(a, 'g:dino:result').length, 1, 'no result for a refused write');
    assert.strictEqual(s.ledger.lastId, id0);
    assert.deepStrictEqual(s.w('ann'), before);
  });

  await test('dino: state + history over the socket; audit holds nothing; no ctx.wallet', async () => {
    const s = setupL({ rng: E.rngFrom(13) }); const a = s.sock('ann');
    a.send('g:dino:state'); const st = last(a, 'g:dino:state');
    assert.deepStrictEqual(st.betLevels, E.BET_LEVELS); assert.deepStrictEqual(st.anteLevels, E.anteLevels());
    assert.strictEqual(st.buyCostX, 100); assert.strictEqual(st.anteCost, 1.25); assert.strictEqual(st.maxWinX, 10000);
    assert.deepStrictEqual(st.wallet, { play: 1000000, chips: 10000 });
    for (let i = 0; i < 22; i++) { s.clock.advance(200); a.send('g:dino:spin', { bet: 20, mode: 'play', ante: i % 2 === 0 }); }
    a.send('g:dino:history'); const h = last(a, 'g:dino:history');
    assert.strictEqual(h.rounds.length, 20);
    assert.strictEqual(h.rounds[0].roundId, all(a, 'g:dino:result').slice(-1)[0].roundId);
    const DM = require('../games/dino.js');
    assert.deepStrictEqual(DM.audit(), { openRounds: [], pools: {} });
    assert.ok(!/ctx\.wallet/.test(fs.readFileSync(path.join(__dirname, '../games/dino.js'), 'utf8')));
  });

  console.log(pass + ' passed' + (process.exitCode ? ', with failures' : ''));
  fs.rmSync(tmp, { recursive: true, force: true });
})();
