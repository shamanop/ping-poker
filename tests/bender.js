'use strict';
// node tests/bender.js  (self-contained: temp WALLET_FILE, stub accounts, fake io)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const EventEmitter = require('events');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bender-'));
process.env.WALLET_FILE = path.join(tmp, 'wallet.json');
const { createWallet } = require('../wallet.js');
const games = require('../games');
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
  await test('wallet: new account starts at 10,000.00 Play $ and the chips bank balance', () => {
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

  await test('engine: tuned to 98% RTP (buy costs equal measured bonus EV; bonus about 1 in 100)', () => {
    const C = E.CFG; assert.ok(C.buyCost.election === 10.91 && C.buyCost.landslide === 77.21, 'buy costs');
    const eng = E.createEngine(), rng = E.rngFrom(424242); let bonus = 0; const N = 300000;
    for (let i = 0; i < N; i++) if (eng.round(rng, 'spin').bonus) bonus++;
    const one = N / bonus; assert.ok(one > 85 && one < 115, 'bonus 1 in ' + one.toFixed(0));
  });

  await test('bender: unsigned socket gets auth error, wallet untouched', async () => {
    const s = setup(); const u = s.sock(null);
    u.send('g:bender:spin', { bet: 10, mode: 'play' }); u.send('wallet_get'); u.send('g:bender:state');
    assert.strictEqual(all(u, 'error').length, 3);
    assert.ok(all(u, 'error').every((e) => e.code === 'auth' && e.message === 'Sign in first'));
    assert.strictEqual(all(u, 'g:bender:result').length, 0);
  });

  await test('bender: play spin debits bet, credits win, chips untouched, result shape', async () => {
    const s = setup({ rng: E.rngFrom(5) }); const a = s.sock('ann');
    a.send('g:bender:spin', { bet: 100, mode: 'play' }); await tick();
    const r = last(a, 'g:bender:result');
    assert.ok(r, 'result'); assert.strictEqual(r.mode, 'play'); assert.strictEqual(r.bet, 100);
    for (const k of ['roundId', 'grid', 'cascades', 'bonus', 'totalWin', 'wallet']) assert.ok(k in r, k);
    assert.ok(Number.isSafeInteger(r.totalWin) && r.totalWin >= 0);
    assert.strictEqual(r.wallet.play, 1000000 - 100 + r.totalWin);
    assert.strictEqual(r.wallet.chips, 10000);
    assert.deepStrictEqual(s.wallet.get('ann'), r.wallet);
    const w = last(a, 'wallet'); assert.deepStrictEqual(w, r.wallet);        // pushed once with final state
    assert.strictEqual(all(a, 'wallet').length, 1);
  });

  await test('bender: chips spin moves only the chips bank', async () => {
    const s = setup({ rng: E.rngFrom(6) }); const a = s.sock('ann');
    a.send('g:bender:spin', { bet: 200, mode: 'chips' }); await tick();
    const r = last(a, 'g:bender:result');
    assert.strictEqual(r.mode, 'chips');
    assert.strictEqual(r.wallet.play, 1000000);
    assert.strictEqual(r.wallet.chips, 10000 - 200 + r.totalWin);
    assert.strictEqual(s.chips.get('ann'), r.wallet.chips);
  });

  await test('bender: short chips stop spins with a chips message; no negative balances', async () => {
    const s = setup({ rng: E.rngFrom(7) }); const a = s.sock('ann');
    s.wallet.spend('ann', 'chips', 9900);
    for (let i = 0; i < 30; i++) { s.clock.advance(200); a.send('g:bender:spin', { bet: 1000, mode: 'chips' }); }
    const e = all(a, 'error').find((x) => x.code === 'funds');
    assert.ok(e && /chips/.test(e.message));
    assert.ok(s.chips.get('ann') >= 0);
    const b = s.sock('bo'); s.wallet.spend('bo', 'play', 999900);
    s.clock.advance(200); b.send('g:bender:spin', { bet: 500, mode: 'play' });
    assert.strictEqual(last(b, 'error').code, 'funds');
    assert.strictEqual(s.wallet.get('bo').play, 100);
  });

  await test('bender: bad bets and modes rejected without touching wallet', async () => {
    const s = setup(); const a = s.sock('ann');
    const bad = [{ bet: 0, mode: 'play' }, { bet: -10, mode: 'play' }, { bet: 15, mode: 'play' }, { bet: 1.5, mode: 'play' }, { bet: NaN, mode: 'play' },
      { bet: '100', mode: 'play' }, { bet: 100, mode: 'ledger' }, { bet: 100 }, { mode: 'play' }, null, 'x', { bet: 100, mode: 'play', buyBonus: 'nope' }];
    for (const p of bad) { s.clock.advance(200); a.send('g:bender:spin', p); }
    assert.strictEqual(all(a, 'error').length, bad.length);
    assert.strictEqual(all(a, 'g:bender:result').length, 0);
    assert.deepStrictEqual(s.wallet.get('ann'), { play: 1000000, chips: 10000 });
  });

  await test('bender: rate limit 150ms per socket', async () => {
    const s = setup({ rng: E.rngFrom(8) }); const a = s.sock('ann'), b = s.sock('bo');
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
    const s = setup({ rng: E.rngFrom(11) });
    const socks = [s.sock('ann'), s.sock('ann'), s.sock('bo'), s.sock('bo')];     // two tabs per account
    for (let i = 0; i < 40; i++) { s.clock.advance(200); for (const k of socks) k.send('g:bender:spin', { bet: 50, mode: i % 2 ? 'play' : 'chips' }); }
    await tick();
    for (const key of ['ann', 'bo']) {
      const mine = socks.filter((k) => k.data.acct.key === key);
      const results = mine.flatMap((k) => all(k, 'g:bender:result'));
      const play = results.filter((r) => r.mode === 'play'), led = results.filter((r) => r.mode === 'chips');
      const w = s.wallet.get(key);
      assert.strictEqual(w.play, 1000000 - play.length * 50 + play.reduce((a, r) => a + r.totalWin, 0));
      assert.strictEqual(w.chips, 10000 - led.length * 50 + led.reduce((a, r) => a + r.totalWin, 0));
      assert.ok(w.play >= 0 && w.chips >= 0);
      for (const k of mine) assert.deepStrictEqual(last(k, 'wallet'), w);         // both tabs get the final wallet
    }
  });

  await test('bender: state + history (last 20) + wallet_get + topup over the socket', async () => {
    const s = setup({ rng: E.rngFrom(13) }); const a = s.sock('ann');
    a.send('g:bender:state'); const st = last(a, 'g:bender:state');
    assert.deepStrictEqual(st.betLevels, [1, 2, 10, 20, 50, 100, 200, 500, 1000, 2500]);
    for (let i = 0; i < 25; i++) { s.clock.advance(200); a.send('g:bender:spin', { bet: 10, mode: 'play' }); }
    a.send('g:bender:history'); const h = last(a, 'g:bender:history');
    assert.strictEqual(h.rounds.length, 20);
    assert.strictEqual(h.rounds[0].roundId, all(a, 'g:bender:result').slice(-1)[0].roundId);
    a.send('wallet_topup'); assert.strictEqual(last(a, 'error').code, 'topup_off');   // no free Play $ since 10/7
    a.send('wallet_get'); assert.strictEqual(last(a, 'wallet').play, s.wallet.get('ann').play);
  });

  console.log(pass + ' passed' + (process.exitCode ? ', with failures' : ''));
  fs.rmSync(tmp, { recursive: true, force: true });
})();
