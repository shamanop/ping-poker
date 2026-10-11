'use strict';
// node tests/bender.js  (self-contained: the wallet.js unit tests on a temp WALLET_FILE, the engine tests, and the Ballot Bender socket tests on a REAL ledger (money/ledger.js +
// money/service.js + ctx.money + the games registry) on a temp dir, fake io. Bender plays only through ctx.money: there is no wallet in its ctx.)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const EventEmitter = require('events');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bender-'));
process.env.WALLET_FILE = path.join(tmp, 'wallet.json');
const { createWallet } = require('../wallet.js');
const games = require('../games');
const { open: openLedger } = require('../money/ledger');
const { createService } = require('../money/service');
const { createGameMoney } = require('../transport/game-money');
const { createWalletAdapter } = require('../transport/wallet-adapter');
const E = require('../games/bender-engine.js');

let pass = 0;
const test = async (name, fn) => { try { await fn(); pass++; console.log('ok   ' + name); } catch (e) { console.error('FAIL ' + name + '\n' + (e.stack || e)); process.exitCode = 1; } };
const tick = () => new Promise((r) => setImmediate(r));

function makeSocket(io, acct) {
  const s = new EventEmitter();
  s.data = acct ? { acct: { key: acct } } : {};
  s.out = [];
  const emit = s.emit.bind(s);
  s.send = (ev, p) => emit(ev, p);             // client -> server
  s.emit = (ev, p) => { if (ev in { error: 1, wallet: 1 } || ev.startsWith('g:')) { s.out.push([ev, p]); return true; } return emit(ev, p); };
  io.sockets.sockets.set(String(Math.random()), s);
  io.emit('connection', s);
  return s;
}
const last = (s, ev) => { for (let i = s.out.length - 1; i >= 0; i--) if (s.out[i][0] === ev) return s.out[i][1]; return null; };
const all = (s, ev) => s.out.filter((o) => o[0] === ev).map((o) => o[1]);

// A ledger-backed world for the Bender socket tests: everything real except the socket layer. A new account gets the signup mint (10,000.00 Cash, 10,000 chips) like on the site.
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
  const wallet = createWalletAdapter({ service, ledger, onChange, log: () => {} });
  reg = games({ io, wallet, money, service, now: clock.now, rng: opts.rng, accounts: {}, tables: {}, rooms: {}, ledger: { log: () => {} } });
  const bal = (k, c) => ledger.balance((c === 'chips' ? 'bank:' : 'play:') + k, c);
  const w = (k) => ({ play: bal(k, 'play'), chips: bal(k, 'chips') });
  const setBal = (k, c, v) => { service.ensureAccount(k); const d = v - bal(k, c); if (d) service.adminAdjust(k, d, c, 'test', 'test:' + (++wn)); };
  return { io, clock, ledger, service, g: reg, bal, w, setBal, lines: (fn) => [...ledger.entries(fn || null)], sock: (a) => { if (a) service.ensureAccount(a); return makeSocket(io, a); } };
}

function setup(opts = {}) {
  const io = new EventEmitter(); io.sockets = { sockets: new Map() };
  const rows = [];
  const ledger = { log: (...a) => { rows.push(a); } };
  let t = 1000000;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const file = path.join(tmp, 'w' + Math.random().toString(36).slice(2) + '.json');
  const hook = { push: () => {} };
  const bank = new Map();
  const chips = { get: (k) => (bank.has(k) ? bank.get(k) : 10000), add: (k, d) => { bank.set(k, Math.max(0, chips.get(k) + d)); hook.push(k); } };
  const wallet = createWallet({ file, ledger, chips, now: clock.now, onChange: (k) => hook.push(k), logPlay: !!opts.logPlay });
  const g = games({ io, ledger, now: clock.now, rng: opts.rng, accounts: {}, tables: {}, rooms: {}, wallet, chips });
  hook.push = g.pushWallet;
  return { io, rows, clock, wallet, g, file, bank, chips, sock: (a) => makeSocket(io, a) };
}

(async () => {
  await test('wallet: new account starts at 10,000.00 Cash and the chips bank balance', () => {
    const { wallet } = setup();
    assert.deepStrictEqual(wallet.get('ann'), { play: 1000000, chips: 10000 });
  });

  await test('wallet: spend/credit math + stats', () => {
    const { wallet } = setup();
    wallet.spend('ann', 'play', 100, { game: 'bender', round: 'r1' });
    wallet.credit('ann', 'play', 250, { game: 'bender', round: 'r1' });
    assert.strictEqual(wallet.get('ann').play, 1000000 - 100 + 250);
    wallet.spend('ann', 'chips', 500, { game: 'bender', round: 'r2' });
    assert.strictEqual(wallet.get('ann').chips, 9500);
    wallet.credit('ann', 'chips', 1500, { game: 'bender', round: 'r2' });
    assert.strictEqual(wallet.get('ann').chips, 11000);
    const st = wallet.stats('ann').bender;
    assert.deepStrictEqual(st.play, { rounds: 1, wagered: 100, won: 250 });
    assert.deepStrictEqual(st.chips, { rounds: 1, wagered: 500, won: 1500 });
  });

  await test('wallet: rejects negative, fractional, NaN, string, Infinity, bad mode', () => {
    const { wallet } = setup();
    for (const bad of [-1, 1.5, NaN, Infinity, '10', null, undefined, 2 ** 60]) {
      assert.throws(() => wallet.spend('ann', 'play', bad), (e) => e.code === 'amount', 'spend ' + String(bad));
      assert.throws(() => wallet.credit('ann', 'play', bad), (e) => e.code === 'amount', 'credit ' + String(bad));
    }
    assert.throws(() => wallet.spend('ann', 'ledger', 10), (e) => e.code === 'mode');
    assert.throws(() => wallet.spend('ann', 'play', 0), (e) => e.code === 'amount');
    assert.deepStrictEqual(wallet.get('ann'), { play: 1000000, chips: 10000 });
  });

  await test('wallet: play funds check, never negative', () => {
    const { wallet } = setup();
    wallet.spend('bo', 'play', 999950, { game: 'x' });
    assert.throws(() => wallet.spend('bo', 'play', 100), (e) => e.code === 'funds');
    assert.strictEqual(wallet.get('bo').play, 50);
    wallet.spend('bo', 'play', 50);
    assert.strictEqual(wallet.get('bo').play, 0);
  });

  await test('wallet: chips funds check against the bank, never negative', () => {
    const { wallet, chips } = setup();
    wallet.spend('cy', 'chips', 9990);
    assert.throws(() => wallet.spend('cy', 'chips', 20), (e) => e.code === 'funds' && /chips/.test(e.message));
    assert.strictEqual(chips.get('cy'), 10);
    wallet.spend('cy', 'chips', 10);
    assert.strictEqual(chips.get('cy'), 0);
    assert.throws(() => createWallet({ file: path.join(tmp, 'nochips.json') }).spend('cy', 'chips', 1), (e) => e.code === 'mode');
  });

  await test('wallet: top-up flow', () => {
    const { wallet, clock } = setup();
    wallet.spend('di', 'play', 995000);                // 50.00 left (< 100.00) -> allowed
    clock.advance(0);
    const w1 = wallet.topUp('di');
    assert.strictEqual(w1.play, 1000000);
    wallet.spend('di', 'play', 995000);
    assert.throws(() => wallet.topUp('di'), (e) => e.code === 'cooldown' && e.retryMs > 0);
    clock.advance(3600000);
    assert.strictEqual(wallet.topUp('di').play, 1000000);
  });

  await test('wallet: atomic file persists across reload, no stray tmp', () => {
    const { wallet, file } = setup();
    wallet.spend('ed', 'play', 1234, { game: 'bender' }); wallet.flush();
    assert.ok(fs.existsSync(file) && !fs.existsSync(file + '.tmp'));
    const again = createWallet({ file });
    assert.strictEqual(again.get('ed').play, 1000000 - 1234);
  });

  await test('wallet: chips spins write no wallet ledger rows (the bank logs those); logger failure swallowed', () => {
    const s = setup();
    s.wallet.spend('fy', 'chips', 100, { game: 'bender', round: 'abc' });
    assert.strictEqual(s.rows.length, 0);
    const bad = createWallet({ file: path.join(tmp, 'bad.json'), chips: s.chips, logPlay: true, ledger: { log() { throw new Error('boom'); } } });
    bad.spend('fy', 'play', 100);
    assert.strictEqual(bad.get('fy').play, 1000000 - 100);
  });

  await test('engine: resolveRound is deterministic for a seed and returns the documented shape', () => {
    const a = E.resolveRound(E.rngFrom(9)), b = E.resolveRound(E.rngFrom(9));
    assert.strictEqual(a.totalWinMult, b.totalWinMult);
    for (const k of ['grid', 'cascades', 'bonus', 'totalWinMult', 'steps']) assert.ok(k in a, k);
    assert.strictEqual(a.grid.length, 6); assert.strictEqual(a.grid[0].length, 5);
  });

  await test('engine: browser copy matches server engine (math source and 300 seeded rounds incl. buys)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../public/games/bender/engine.js'), 'utf8');
    const srv = fs.readFileSync(path.join(__dirname, '../games/bender-engine.js'), 'utf8');
    assert.ok(srv.startsWith(src), 'public/games/bender/engine.js must equal the shared head of games/bender-engine.js');
    const B = new Function('module', 'self', src + '; return this.BenderEngine || self.BenderEngine;')(undefined, {});
    const sa = E.createEngine(), sb = B.createEngine();
    assert.deepStrictEqual(sb.cfg, sa.cfg);
    for (let seed = 1; seed <= 300; seed++) {
      const mode = seed % 7 === 0 ? 'buy-election' : seed % 11 === 0 ? 'buy-landslide' : 'spin';
      const a = sa.round(E.rngFrom(seed), mode, seed % 5 === 0 ? 'bonus' : undefined), b = sb.round(B.rngFrom(seed), mode, seed % 5 === 0 ? 'bonus' : undefined);
      assert.strictEqual(b.win, a.win, 'seed ' + seed); assert.strictEqual(b.cost, a.cost);
      assert.strictEqual(!!b.bonus, !!a.bonus);
    }
  });

  // bonus growth (10/11 fix, config B; 10/11 multi-grow): a sticky wild doubles EVERY tumble step it is part of a win, up to growCap (was 6: 2>4>6, then stuck; then once per spin)
  const growthOf = (cfg, kind, seeds) => {   // every growth event of `seeds` bonuses, with the chain of each wild (by board cell, sticky wilds never move)
    const eng = E.createEngine(cfg), ev = [], chains = [];
    for (let seed = 1; seed <= seeds; seed++) {
      const b = eng.playBonus(E.rngFrom(seed), kind, kind === 'landslide' ? 4 : 3, E.MAX_WIN_X), at = new Map();
      for (const w of b.startWilds) at.set(w.c + ',' + w.r, [w.cell.m]);
      for (const sp of b.spins) for (const st of sp.steps) for (const g of st.grown) { ev.push(g); const k = g.c + ',' + g.r; if (!at.has(k)) at.set(k, [g.from]); at.get(k).push(g.to); }
      for (const ch of at.values()) chains.push(ch);
      if (b.startWilds.length) { assert.strictEqual(b.startWilds.length, (kind === 'landslide' ? cfg.landslideStart : cfg.electionStart).length); }
    }
    return { ev, chains };
  };
  const has = (chains, seq) => chains.some((ch) => ('>' + ch.join('>') + '>').includes('>' + seq.join('>') + '>'));
  await test('engine: shipped bonus math is multi-grow (per-step doubling; Recount and Landslide plant a 1x wild, the only sticky one; growCap 128, no guarantee)', () => {
    const C = E.DEFAULT_CFG;
    assert.deepStrictEqual(C.electionStart, [[1]]); assert.deepStrictEqual(C.landslideStart, [[1]]); assert.strictEqual(C.growPerStep, true);
    assert.strictEqual(C.growCap, 128); assert.strictEqual(C.maxSticky, 1); assert.strictEqual(C.guaranteeP, 0); assert.strictEqual(C.bonusWildW, 0.04);
  });
  await test('engine: sticky wilds really double, 2>4>8>16, every growth is x2 up to growCap 128', () => {
    const cfg = { ...E.DEFAULT_CFG, landslideStart: [[2]] }, { ev, chains } = growthOf(cfg, 'landslide', 400);
    assert.ok(ev.length > 200, 'growth events ' + ev.length);
    for (const g of ev) assert.strictEqual(g.to, Math.min(g.from * 2, 128), g.from + 'x -> ' + g.to + 'x');
    assert.ok(has(chains, [2, 4, 8, 16]), 'a 2x wild went 2>4>8>16');
    const { ev: ev2 } = growthOf({ ...E.DEFAULT_CFG }, 'landslide', 400);
    assert.ok(ev2.some((g) => g.from === 1 && g.to === 2) && ev2.some((g) => g.from === 64 && g.to === 128), 'the planted 1x grows, all the way to the 128x cap');
  });
  // walks every tumble step of `seeds` bonuses: the board a step's clusters were found on is the spin's first board or the previous step's grid (sticky wilds never move)
  const stepsOf = (cfg, kind, seeds, fn) => {
    const eng = E.createEngine(cfg);
    for (let seed = 1; seed <= seeds; seed++) {
      const b = eng.playBonus(E.rngFrom(seed), kind, kind === 'landslide' ? 4 : 3, E.MAX_WIN_X);
      b.spins.forEach((sp, si) => sp.steps.forEach((st, i) => fn({ seed, si, i, sp, st, pre: i ? sp.steps[i - 1].grid : sp.initial })));
    }
  };
  await test('engine: per step: a sticky wild doubles in EVERY step it is part of a win (paid at the old multiplier, the new one counts from the next step), up to growCap, in both bonuses', () => {
    for (const kind of ['election', 'landslide']) {
      let grows = 0, paidOld = 0;
      stepsOf(E.DEFAULT_CFG, kind, 300, ({ st, pre, seed }) => {
        const want = new Map();
        for (const k of st.clusters) {
          let wm = 0;
          for (const [c, r] of k.cells) { const x = pre[c][r]; if (x.s === 'W') wm += x.m; if (x.stick && x.m < 128) want.set(c + ',' + r, { from: x.m, to: Math.min(x.m * 2, 128) }); }
          assert.strictEqual(k.mult, wm || 1, 'seed ' + seed + ': a cluster is paid with the multipliers on the board BEFORE the step grows them');
          if (k.cells.some(([c, r]) => pre[c][r].stick)) paidOld++;
        }
        const got = new Map(st.grown.map((g) => [g.c + ',' + g.r, { from: g.from, to: g.to }]));
        assert.deepStrictEqual(got, want, kind + ' seed ' + seed + ': every winning sticky wild under the cap doubles in this step, nothing else');
        for (const g of st.grown) { assert.ok(g.to <= 128); assert.strictEqual(st.grid[g.c][g.r].m, g.to, 'the grid after the step shows the new multiplier'); }
        grows += st.grown.length;
      });
      assert.ok(grows > 100 && paidOld > 100, kind + ': ' + grows + ' growths');
    }
  });
  await test('engine: one spin with 3+ winning steps doubles a wild 3+ times (1>2>4>8 or 2>4>8>16 inside ONE spin), Recount and Landslide; growCap still caps it inside a spin', () => {
    for (const kind of ['election', 'landslide']) {
      let best = null;
      stepsOf(E.DEFAULT_CFG, kind, 400, ({ seed, si, sp, i }) => {
        if (i) return;
        const at = new Map();
        for (const st of sp.steps) for (const g of st.grown) { const k = g.c + ',' + g.r; if (!at.has(k)) at.set(k, [g.from]); at.get(k).push(g.to); }
        for (const ch of at.values()) if (!best || ch.length > best.ch.length) best = { seed, si, ch };
      });
      assert.ok(best && best.ch.length >= 4, kind + ': longest chain inside one spin ' + JSON.stringify(best));
      for (let j = 1; j < best.ch.length; j++) assert.strictEqual(best.ch[j], Math.min(best.ch[j - 1] * 2, 128));
    }
    // a 2x wild that wins 3 steps in a row in one spin: 2>4>8>16 (Landslide planted 2x)
    let three = false;
    stepsOf({ ...E.DEFAULT_CFG, landslideStart: [[2]] }, 'landslide', 400, ({ sp, i }) => {
      if (i || three) return;
      const at = new Map();
      for (const st of sp.steps) for (const g of st.grown) { const k = g.c + ',' + g.r; if (!at.has(k)) at.set(k, [g.from]); at.get(k).push(g.to); }
      for (const ch of at.values()) if (ch.join('>').startsWith('2>4>8>16')) three = true;
    });
    assert.ok(three, 'a 2x wild went 2>4>8>16 inside one spin');
    // the cap inside one spin: cap 8, a planted 2x goes 2>4>8 and then stays 8 while it keeps winning in the same spin (no growth event at the cap)
    let stuckAtCap = 0;
    stepsOf({ ...E.DEFAULT_CFG, landslideStart: [[2]], growCap: 8 }, 'landslide', 300, ({ st, pre }) => {
      for (const g of st.grown) assert.ok(g.to <= 8 && g.from < 8, JSON.stringify(g));
      for (const k of st.clusters) for (const [c, r] of k.cells) if (pre[c][r].stick && pre[c][r].m === 8) { stuckAtCap++; assert.ok(!st.grown.some((g) => g.c === c && g.r === r)); }
    });
    assert.ok(stuckAtCap > 20, 'wins at the cap: ' + stuckAtCap);
  });
  await test('engine: growPerStep false is the old rule (at most one doubling per wild per spin); the shipped rule doubles more than once in a spin', () => {
    const per = (cfg) => { let most = 0; stepsOf(cfg, 'landslide', 200, ({ sp, i }) => { if (i) return; const n = new Map(); for (const st of sp.steps) for (const g of st.grown) n.set(g.c + ',' + g.r, (n.get(g.c + ',' + g.r) || 0) + 1); for (const v of n.values()) most = Math.max(most, v); }); return most; };
    assert.strictEqual(per({ ...E.DEFAULT_CFG, growPerStep: false }), 1);
    assert.ok(per(E.DEFAULT_CFG) >= 3);
  });
  await test('engine: a wild born at 8x grows (8x -> 16x); growCap caps the double; growCap 1 means no growth (`??`, not `||`)', () => {
    const { ev } = growthOf({ ...E.DEFAULT_CFG, landslideStart: [[8]] }, 'landslide', 300);
    assert.ok(ev.some((g) => g.from === 8 && g.to === 16), 'an 8x wild grew to 16x');
    const capped = growthOf({ ...E.DEFAULT_CFG, landslideStart: [[8]], growCap: 12 }, 'landslide', 300).ev;
    assert.ok(capped.length && capped.every((g) => g.to <= 12) && capped.some((g) => g.from === 8 && g.to === 12), 'cap 12: 8x -> 12x, never above');
    assert.strictEqual(growthOf({ ...E.DEFAULT_CFG, growCap: 1 }, 'landslide', 200).ev.length, 0, 'growCap 1: no wild grows');
    assert.strictEqual(growthOf({ ...E.DEFAULT_CFG, growCap: 0 }, 'landslide', 200).ev.length, 0, 'growCap 0 is no growth (it used to fall back to 512)');
  });
  await test('engine: the Recount and the Landslide each plant one sticky 1x wild (electionStart, landslideStart), on both copies of the engine', () => {
    const eng = E.createEngine();
    for (let seed = 1; seed <= 50; seed++) {
      const e = eng.playBonus(E.rngFrom(seed), 'election', 3, E.MAX_WIN_X), l = eng.playBonus(E.rngFrom(seed), 'landslide', 4, E.MAX_WIN_X);
      assert.strictEqual(e.startWilds.length, 1); assert.strictEqual(e.startWilds[0].cell.s, 'W'); assert.strictEqual(e.startWilds[0].cell.m, 1);
      assert.strictEqual(l.startWilds.length, 1); assert.strictEqual(l.startWilds[0].cell.m, 1);
      const w = e.startWilds[0]; assert.ok(e.spins[0].initial[w.c][w.r].s === 'W', 'the planted wild is on the first board');
    }
    const r = eng.round(E.rngFrom(3), 'buy-election'); assert.strictEqual(r.bonus.startWilds.length, 1); assert.strictEqual(r.cost, 16.1);
    const two = E.createEngine({ ...E.DEFAULT_CFG, electionStart: [[2], [3]] }).playBonus(E.rngFrom(1), 'election', 3, E.MAX_WIN_X);
    assert.deepStrictEqual(two.startWilds.map((w) => w.cell.m), [2, 3]); assert.notStrictEqual(two.startWilds[0].c + ',' + two.startWilds[0].r, two.startWilds[1].c + ',' + two.startWilds[1].r);
  });
  await test('engine: RANGES accept the shipped bonus keys and their bounds, refuse 0, too big, bad shapes and more planted wilds than maxSticky', () => {
    for (const over of [{}, { growCap: 1 }, { growCap: 256 }, { growCap: 1024 }, { maxSticky: 1, electionStart: [[1]], landslideStart: [[4]] }, { maxSticky: 30 }, { growPerStep: false }, { growPerStep: true }, { electionStart: [[64]] }, { electionStart: [[2]] }, { landslideStart: [[1]] }, { landslideStart: [[64]] }, { landslideStart: [[2], [2]], maxSticky: 2 }, { electionStart: [[1], [1]], maxSticky: 2 }])
      assert.doesNotThrow(() => E.validateConfig(over, { skipSmoke: true }), JSON.stringify(over));
    assert.ok(E.validateConfig({ electionStart: [[8]], growCap: 512 }));   // with the 300-round smoke test
    for (const [over, re] of [[{ growCap: 0 }, /growCap: must be between 1 and 1024/], [{ growCap: 1025 }, /must be between 1 and 1024/], [{ growCap: '256' }, /growCap/], [{ growPerStep: 1 }, /growPerStep: must be true or false/], [{ growPerStep: 'false' }, /growPerStep/], [{ maxSticky: 0 }, /maxSticky: must be between 1 and 30/], [{ maxSticky: 31 }, /must be between 1 and 30/],
      [{ electionStart: [[0]] }, /electionStart: must be between 1 and 64/], [{ electionStart: [[65]] }, /must be between 1 and 64/], [{ electionStart: [] }, /non-empty list/], [{ electionStart: [1] }, /shaped like the default/], [{ electionStart: [[1, 2]] }, /shaped like the default/], [{ electionStart: 1 }, /electionStart/], [{ electionStart: [[-1]] }, /electionStart/], [{ electionStart: [[NaN]] }, /electionStart/],
      [{ electionStart: [[1], [1]] }, /electionStart: at most maxSticky \(1\)/], [{ electionStart: [[1], [1], [1]], maxSticky: 2 }, /electionStart: at most maxSticky \(2\)/], [{ landslideStart: [[0]] }, /landslideStart: must be between 1 and 64/], [{ landslideStart: [[65]] }, /landslideStart/], [{ landslideStart: Array.from({ length: 31 }, () => [2]), maxSticky: 30 }, /landslideStart: at most maxSticky/]])
      assert.throws(() => E.validateConfig(over, { skipSmoke: true }), re, JSON.stringify(over));
  });

  await test('engine: tuned to 98% RTP (buy costs equal measured bonus EV; bonus about 1 in 100)', () => {
    const C = E.CFG; assert.ok(C.buyCost.election === 16.1 && C.buyCost.landslide === 32.7, 'buy costs');
    const eng = E.createEngine(), rng = E.rngFrom(424242); let bonus = 0; const N = 300000;
    for (let i = 0; i < N; i++) if (eng.round(rng, 'spin').bonus) bonus++;
    const one = N / bonus; assert.ok(one > 85 && one < 115, 'bonus 1 in ' + one.toFixed(0));
  });

  await test('bender: unsigned socket gets auth error, ledger untouched', async () => {
    const s = setupL(); const u = s.sock(null);
    u.send('g:bender:spin', { bet: 10, mode: 'play' }); u.send('wallet_get'); u.send('g:bender:state');
    assert.strictEqual(all(u, 'error').length, 3);
    assert.ok(all(u, 'error').every((e) => e.code === 'auth' && e.message === 'Sign in first'));
    assert.strictEqual(all(u, 'g:bender:result').length, 0);
    assert.strictEqual(s.lines().length, 0);
  });

  await test('bender: play spin debits bet, credits win, chips untouched, result shape, ONE ledger batch bender:<key>:<roundId>', async () => {
    const s = setupL({ rng: E.rngFrom(5) }); const a = s.sock('ann');
    const id0 = s.ledger.lastId;
    a.send('g:bender:spin', { bet: 100, mode: 'play' }); await tick();
    const r = last(a, 'g:bender:result');
    assert.ok(r, 'result'); assert.strictEqual(r.mode, 'play'); assert.strictEqual(r.bet, 100);
    for (const k of ['roundId', 'grid', 'cascades', 'bonus', 'totalWin', 'wallet']) assert.ok(k in r, k);
    assert.ok(Number.isSafeInteger(r.totalWin) && r.totalWin >= 0);
    assert.strictEqual(r.wallet.play, 1000000 - 100 + r.totalWin);
    assert.strictEqual(r.wallet.chips, 10000);
    assert.deepStrictEqual(s.w('ann'), r.wallet);
    const w = last(a, 'wallet'); assert.deepStrictEqual(w, r.wallet);        // pushed once with final state
    assert.strictEqual(all(a, 'wallet').length, 1);
    const ls = [...s.ledger.entries(null, id0)];
    assert.ok(ls.length >= 1 && ls.every((l) => l.ref === 'bender:ann:' + r.roundId && l.cur === 'play'), 'one ref, one currency');
    assert.strictEqual(s.ledger.balance('house:bender', 'play'), 100 - r.totalWin);
  });

  await test('bender: chips spin moves only the chips bank', async () => {
    const s = setupL({ rng: E.rngFrom(6) }); const a = s.sock('ann');
    a.send('g:bender:spin', { bet: 200, mode: 'chips' }); await tick();
    const r = last(a, 'g:bender:result');
    assert.strictEqual(r.mode, 'chips');
    assert.strictEqual(r.wallet.play, 1000000);
    assert.strictEqual(r.wallet.chips, 10000 - 200 + r.totalWin);
    assert.strictEqual(s.bal('ann', 'chips'), r.wallet.chips);
  });

  await test('bender: short chips stop spins with a chips message; no negative balances', async () => {
    const s = setupL({ rng: E.rngFrom(7) }); const a = s.sock('ann');
    s.setBal('ann', 'chips', 100);
    for (let i = 0; i < 30; i++) { s.clock.advance(200); a.send('g:bender:spin', { bet: 1000, mode: 'chips' }); }
    const e = all(a, 'error').find((x) => x.code === 'funds');
    assert.ok(e && /chips/.test(e.message));
    assert.ok(s.bal('ann', 'chips') >= 0);
    const b = s.sock('bo'); s.setBal('bo', 'play', 100);
    s.clock.advance(200); b.send('g:bender:spin', { bet: 500, mode: 'play' });
    assert.strictEqual(last(b, 'error').code, 'funds');
    assert.strictEqual(s.bal('bo', 'play'), 100);
  });

  await test('bender: bad bets and modes rejected without a ledger line', async () => {
    const s = setupL(); const a = s.sock('ann');
    const id0 = s.ledger.lastId;
    const bad = [{ bet: 0, mode: 'play' }, { bet: -10, mode: 'play' }, { bet: 15, mode: 'play' }, { bet: 1.5, mode: 'play' }, { bet: NaN, mode: 'play' },
      { bet: '100', mode: 'play' }, { bet: 100, mode: 'ledger' }, { bet: 100 }, { mode: 'play' }, null, 'x', { bet: 100, mode: 'play', buyBonus: 'nope' }];
    for (const p of bad) { s.clock.advance(200); a.send('g:bender:spin', p); }
    assert.strictEqual(all(a, 'error').length, bad.length);
    assert.strictEqual(all(a, 'g:bender:result').length, 0);
    assert.strictEqual(s.ledger.lastId, id0);
    assert.deepStrictEqual(s.w('ann'), { play: 1000000, chips: 10000 });
  });

  await test('bender: a refused ledger write is an error, never a result (fenced ledger)', async () => {
    const s = setupL({ rng: E.rngFrom(21) }); const a = s.sock('ann');
    s.clock.advance(200); a.send('g:bender:spin', { bet: 100, mode: 'play' });
    assert.strictEqual(all(a, 'g:bender:result').length, 1);
    const before = s.w('ann'), id0 = s.ledger.lastId;
    fs.appendFileSync(path.join(tmp, 'm' + wn + '.jsonl'), '\n');                 // one foreign byte: the ledger refuses every write from now on
    for (let i = 0; i < 3; i++) { s.clock.advance(200); a.send('g:bender:spin', { bet: 100, mode: 'play' }); }
    assert.strictEqual(all(a, 'g:bender:result').length, 1, 'no result for a refused write');
    assert.ok(all(a, 'error').length >= 3);
    assert.strictEqual(s.ledger.lastId, id0);
    assert.deepStrictEqual(s.w('ann'), before);
  });

  await test('bender: rate limit 150ms per socket', async () => {
    const s = setupL({ rng: E.rngFrom(8) }); const a = s.sock('ann'), b = s.sock('bo');
    a.send('g:bender:spin', { bet: 10, mode: 'play' });
    s.clock.advance(100);
    a.send('g:bender:spin', { bet: 10, mode: 'play' });
    assert.strictEqual(last(a, 'error').code, 'rate');
    b.send('g:bender:spin', { bet: 10, mode: 'play' });               // other socket not limited
    assert.strictEqual(all(b, 'g:bender:result').length, 1);
    s.clock.advance(150);
    a.send('g:bender:spin', { bet: 10, mode: 'play' });
    assert.strictEqual(all(a, 'g:bender:result').length, 2);
  });

  await test('bender: concurrent spins from many sockets/accounts keep exact accounting', async () => {
    const s = setupL({ rng: E.rngFrom(11) });
    const socks = [s.sock('ann'), s.sock('ann'), s.sock('bo'), s.sock('bo')];     // two tabs per account
    for (let i = 0; i < 40; i++) { s.clock.advance(200); for (const k of socks) k.send('g:bender:spin', { bet: 50, mode: i % 2 ? 'play' : 'chips' }); }
    await tick();
    for (const key of ['ann', 'bo']) {
      const mine = socks.filter((k) => k.data.acct.key === key);
      const results = mine.flatMap((k) => all(k, 'g:bender:result'));
      const play = results.filter((r) => r.mode === 'play'), led = results.filter((r) => r.mode === 'chips');
      const w = s.w(key);
      assert.strictEqual(w.play, 1000000 - play.length * 50 + play.reduce((a, r) => a + r.totalWin, 0));
      assert.strictEqual(w.chips, 10000 - led.length * 50 + led.reduce((a, r) => a + r.totalWin, 0));
      assert.ok(w.play >= 0 && w.chips >= 0);
      for (const k of mine) assert.deepStrictEqual(last(k, 'wallet'), w);         // both tabs get the final wallet
    }
  });

  await test('bender: state + history (last 20) + wallet_get + topup over the socket', async () => {
    const s = setupL({ rng: E.rngFrom(13) }); const a = s.sock('ann');
    a.send('g:bender:state'); const st = last(a, 'g:bender:state');
    assert.deepStrictEqual(st.betLevels, [1, 2, 10, 20, 50, 100, 200, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000]);
    assert.deepStrictEqual(st.wallet, { play: 1000000, chips: 10000 }); assert.deepStrictEqual(st.balances, st.wallet);
    for (let i = 0; i < 25; i++) { s.clock.advance(200); a.send('g:bender:spin', { bet: 10, mode: 'play' }); }
    a.send('g:bender:history'); const h = last(a, 'g:bender:history');
    assert.strictEqual(h.rounds.length, 20);
    assert.strictEqual(h.rounds[0].roundId, all(a, 'g:bender:result').slice(-1)[0].roundId);
    a.send('wallet_topup'); assert.strictEqual(last(a, 'error').code, 'topup_off');   // no free Cash since 10/7
    a.send('wallet_get'); assert.strictEqual(last(a, 'wallet').play, s.w('ann').play);
  });

  await test('bender: no wallet in the game ctx (ctx.money is the only way to money)', async () => {
    const BM = require('../games/bender.js');
    let seen = null; const orig = BM.init;
    BM.init = function (c) { seen = c; return orig.call(this, c); };
    try { setupL(); } finally { BM.init = orig; }
    assert.ok(seen && seen.money && typeof seen.money.round === 'function');
    assert.ok(!('wallet' in seen), 'ctx.wallet must not exist for Ballot Bender');
    assert.ok(!/ctx\.wallet/.test(fs.readFileSync(path.join(__dirname, '../games/bender.js'), 'utf8')), 'games/bender.js must not mention ctx.wallet');
  });

  console.log(pass + ' passed' + (process.exitCode ? ', with failures' : ''));
  fs.rmSync(tmp, { recursive: true, force: true });
})();
