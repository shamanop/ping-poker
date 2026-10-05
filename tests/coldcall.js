'use strict';
// node tests/coldcall.js  (self-contained: temp WALLET_FILE, fake io, no network, no server)
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const EventEmitter = require('events');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coldcall-'));
process.env.WALLET_FILE = path.join(tmp, 'wallet.json');
const { createWallet } = require('../wallet.js');
const games = require('../games');
const E = require('../games/coldcall-engine.js');

let pass = 0;
const test = async (name, fn) => { try { await fn(); pass++; console.log('ok   ' + name); } catch (e) { console.error('FAIL ' + name + '\n' + (e.stack || e)); process.exitCode = 1; } };
const tick = () => new Promise((r) => setImmediate(r));
const clone = (o) => JSON.parse(JSON.stringify(o));
const cfgWith = (patch) => Object.assign(clone(E.CFG), patch);

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
  const wallet = createWallet({ file, ledger, now: clock.now, onChange: (k) => hook.push(k), logPlay: !!opts.logPlay });
  const g = games({ io, ledger, now: clock.now, rng: opts.rng, accounts: {}, tables: {}, rooms: {}, wallet });
  hook.push = g.pushWallet;
  return { io, rows, clock, wallet, g, file, sock: (a) => makeSocket(io, a) };
}

// independent ways evaluator (written from the rules, not from the engine): returns total tenths for a named grid
function waysTotal(grid, pay, mult) {
  const REG = ['cash', 'pile', 'rx', 'headset', 'can', 'mug', 'note', 'ball'];
  let total = 0; const wins = [];
  for (const s of REG) {
    let ways = 1, len = 0;
    for (let c = 0; c < 5; c++) {
      const n = grid[c].filter((x) => x === s || (x === 'closer' && c >= 1 && c <= 3)).length;
      if (!n) break; ways *= n; len++;
    }
    if (len >= 3) { const w = pay[s][len - 3] * ways * mult; total += w; wins.push({ sym: s, len, ways, win: w }); }
  }
  return { total, wins };
}
const flat = (g) => g.flat();
const eng = E.engine;
const payOf = (cfg) => { const o = {}; for (const k of Object.keys(cfg.pay)) o[k] = cfg.pay[k].map((v) => Math.round(v * cfg.payScale)); return o; };
const PAY = payOf(E.CFG);

(async () => {
  await test('wallet: new account starts at 10,000.00 play, 0 ledger, -500 limit', () => {
    const { wallet } = setup();
    assert.deepStrictEqual(wallet.get('ann'), { play: 1000000, ledgerNet: 0, ledgerLimit: -50000 });
  });

  await test('wallet: spend/credit math + per-game stats for coldcall', () => {
    const { wallet } = setup();
    wallet.spend('ann', 'play', 100, { game: 'coldcall', round: 'r1' });
    wallet.credit('ann', 'play', 250, { game: 'coldcall', round: 'r1' });
    assert.strictEqual(wallet.get('ann').play, 1000000 - 100 + 250);
    wallet.spend('ann', 'ledger', 500, { game: 'coldcall', round: 'r2' });
    wallet.credit('ann', 'ledger', 1500, { game: 'coldcall', round: 'r2' });
    assert.strictEqual(wallet.get('ann').ledgerNet, 1000);
    const st = wallet.stats('ann').coldcall;
    assert.deepStrictEqual(st.play, { rounds: 1, wagered: 100, won: 250 });
    assert.deepStrictEqual(st.ledger, { rounds: 1, wagered: 500, won: 1500 });
  });

  await test('wallet: float, negative, NaN, string, Infinity, huge amounts and bad mode are rejected, nothing moves', () => {
    const { wallet } = setup();
    for (const bad of [-1, 1.5, 0.1 + 0.2, NaN, Infinity, '10', null, undefined, 2 ** 60, 1e21]) {
      assert.throws(() => wallet.spend('ann', 'play', bad), (e) => e.code === 'amount', 'spend ' + String(bad));
      assert.throws(() => wallet.credit('ann', 'play', bad), (e) => e.code === 'amount', 'credit ' + String(bad));
    }
    assert.throws(() => wallet.spend('ann', 'chips', 10), (e) => e.code === 'mode');
    assert.deepStrictEqual(wallet.get('ann'), { play: 1000000, ledgerNet: 0, ledgerLimit: -50000 });
  });

  await test('wallet: insufficient funds and ledger limit are exact', () => {
    const { wallet } = setup();
    wallet.spend('bo', 'play', 999950, { game: 'coldcall' });
    assert.throws(() => wallet.spend('bo', 'play', 100), (e) => e.code === 'funds');
    assert.strictEqual(wallet.get('bo').play, 50);
    wallet.spend('cy', 'ledger', 50000);
    assert.throws(() => wallet.spend('cy', 'ledger', 10), (e) => e.code === 'limit');
    assert.strictEqual(wallet.get('cy').ledgerNet, -50000);
  });

  // ---------------------------------------------------------------- engine
  await test('engine: same seed gives the same round (script included), another seed differs', () => {
    for (const buy of [null, 'rotary', 'quote']) {
      const a = E.resolveRound(E.rngFrom(42), buy), b = E.resolveRound(E.rngFrom(42), buy), c = E.resolveRound(E.rngFrom(43), buy);
      assert.deepStrictEqual(a, b);
      assert.notDeepStrictEqual(a.script, c.script);
    }
    let diff = 0; for (let s = 1; s <= 50; s++) if (E.resolveRound(E.rngFrom(s)).winTenths !== E.resolveRound(E.rngFrom(s + 1000)).winTenths) diff++;
    assert.ok(diff > 5);
  });

  await test('engine: script mode and lean mode consume the rng identically (same result)', () => {
    for (const buy of [null, 'rotary', 'quote']) for (let s = 1; s <= 300; s++) {
      const a = eng.round(E.rngFrom(s), buy, { script: true }), b = eng.round(E.rngFrom(s), buy);
      assert.strictEqual(a.winTenths, b.winTenths); assert.strictEqual(a.rotary, b.rotary); assert.strictEqual(a.quote, b.quote);
    }
  });

  await test('engine: ways pays match an independent evaluator (base game, 60k spins)', () => {
    const rng = E.rngFrom(1);
    for (let i = 0; i < 60000; i++) {
      const r = eng.round(rng, null, { script: true }); const b = r.script.base;
      const ev = waysTotal(b.grid, PAY, 1);
      if (!r.capped) assert.strictEqual(b.winTenths, ev.total, 'spin ' + i);
      assert.deepStrictEqual(b.wins.map((w) => [w.sym, w.len, w.ways, w.win]), ev.wins.map((w) => [w.sym, w.len, w.ways, w.win]));
      assert.strictEqual(b.grid.length, 5); for (const col of b.grid) assert.strictEqual(col.length, 3);
      for (let c = 0; c < 5; c++) for (const s of b.grid[c]) {
        assert.ok(E.SYM.includes(s));
        if (s === 'closer') assert.ok(c >= 1 && c <= 3, 'closer only on reels 2-4');
        if (s === 'phone') assert.ok(c % 2 === 0, 'phone only on reels 1-3-5');
      }
    }
  });

  await test('engine: win never exceeds the 10,000x cap; a low cap clamps every path and flags it', () => {
    const rng = E.rngFrom(77);
    for (let i = 0; i < 200000; i++) { const r = eng.round(rng, i % 5 === 0 ? 'rotary' : i % 7 === 0 ? 'quote' : null); assert.ok(r.winTenths >= 0 && r.winTenths <= E.MAX_WIN_T); }
    assert.strictEqual(E.MAX_WIN_X, 10000); assert.strictEqual(E.CFG.maxWinTenths, 100000);
    const low = E.createEngine(cfgWith({ maxWinTenths: 300 })), r2 = E.rngFrom(5);
    let capped = { null: 0, rotary: 0, quote: 0 };
    for (let i = 0; i < 20000; i++) for (const buy of [null, 'rotary', 'quote']) {
      const r = low.round(r2, buy, { script: true });
      assert.ok(r.winTenths <= 300, buy + ' ' + r.winTenths);
      if (r.winTenths === 300) { assert.strictEqual(r.capped, true); capped[buy]++; }
      const parts = r.baseTenths + r.rotaryTenths + r.quoteTenths; assert.strictEqual(r.winTenths, Math.min(parts, 300));
    }
    assert.ok(capped.null > 0 && capped.rotary > 0 && capped.quote > 0, JSON.stringify(capped));
  });

  await test('engine: every pay is an integer number of tenths; cents are exact at every bet level (no rounding anywhere)', () => {
    assert.deepStrictEqual(E.BET_LEVELS, [10, 20, 50, 100, 200, 500, 1000, 2500]);
    for (const b of E.BET_LEVELS) assert.strictEqual(b % 10, 0);
    for (const v of Object.values(PAY).flat()) assert.ok(Number.isInteger(v) && v > 0);
    for (const v of [E.CFG.buyCost.rotary, E.CFG.buyCost.quote, E.CFG.grandPrize, ...Object.values(E.CFG.fieldPrize), ...E.CFG.quoteTable.map((q) => q[0])]) assert.ok(Number.isInteger(v) && v > 0);
    const rng = E.rngFrom(9);
    const ints = (o, p) => { if (typeof o === 'number') assert.ok(Number.isInteger(o), 'non-integer at ' + p + ' = ' + o); else if (o && typeof o === 'object') for (const k of Object.keys(o)) ints(o[k], p + '.' + k); };
    for (let i = 0; i < 30000; i++) {
      const buy = i % 4 === 1 ? 'rotary' : i % 4 === 2 ? 'quote' : null;
      const r = E.resolveRound(rng, buy);
      ints(r.script, 'script');
      assert.ok(Number.isInteger(r.winTenths) && Number.isInteger(r.costTenths));
      for (const bet of E.BET_LEVELS) {
        const win = E.cents(r.winTenths, bet), cost = E.cents(r.costTenths, bet);
        assert.ok(Number.isSafeInteger(win) && Number.isSafeInteger(cost));
        assert.strictEqual(win * 10, r.winTenths * bet);             // exact: win cents * 10 === tenths * bet, no rounding
        assert.strictEqual(cost * 10, r.costTenths * bet);
      }
    }
    assert.throws(() => E.cents(1.5, 10)); assert.throws(() => E.cents(5, 15)); assert.throws(() => E.cents(5, 1.5)); assert.throws(() => E.cents(NaN, 10));
  });

  await test('engine: ROTARY (bought) replays: dial picks the spins and the multiplier, callbacks add spins (capped), spin wins add up', () => {
    const rng = E.rngFrom(21); let sawAdd = 0, sawMult5 = false, maxSpins = 0;
    const spinVals = E.CFG.dialSpins.map((d) => d[0]), multVals = E.CFG.dialMult.map((d) => d[0]);
    for (let i = 0; i < 4000; i++) {
      const r = E.resolveRound(rng, 'rotary'); assert.strictEqual(r.costTenths, E.CFG.buyCost.rotary);
      const f = r.script.features; assert.strictEqual(f.length, 1); const x = f[0]; assert.strictEqual(x.kind, 'rotary'); assert.strictEqual(r.script.base, null);
      assert.ok(spinVals.includes(x.dial.spins.value) && multVals.includes(x.dial.mult.value));
      assert.strictEqual(x.startSpins, x.dial.spins.value); assert.strictEqual(x.mult, x.dial.mult.value);
      assert.strictEqual(E.CFG.dialSpins[x.dial.spins.hole][0], x.startSpins); assert.strictEqual(E.CFG.dialMult[x.dial.mult.hole][0], x.mult);
      let left = x.startSpins, total = 0, awarded = x.startSpins;
      for (const s of x.spins) {
        left--; assert.strictEqual(s.n, x.spins.indexOf(s) + 1);
        const ev = waysTotal(s.grid, PAY, 1); assert.strictEqual(s.rawTenths, ev.total);
        assert.strictEqual(s.winTenths, s.rawTenths * x.mult);
        const phones = flat(s.grid).filter((g) => g === 'phone').length; assert.strictEqual(s.phones, phones);
        assert.ok(!flat(s.grid).includes('quote'), 'no quote bubbles in free spins');
        const add = Math.min(phones, E.CFG.maxFreeSpins - awarded); assert.strictEqual(s.added, add); awarded += add; left += add; sawAdd += add ? 1 : 0;
        assert.strictEqual(s.left, left); total += s.winTenths;
      }
      assert.strictEqual(left, 0); assert.strictEqual(x.spins.length, awarded); assert.strictEqual(x.totalSpins, awarded); assert.ok(awarded <= E.CFG.maxFreeSpins);
      assert.strictEqual(x.totalTenths, total); assert.strictEqual(r.winTenths, Math.min(total, E.MAX_WIN_T));
      if (x.mult === 5) sawMult5 = true; maxSpins = Math.max(maxSpins, awarded);
    }
    assert.ok(sawAdd > 20 && sawMult5 && maxSpins > 15);
  });

  await test('engine: QUOTE ACCEPTED (bought) replays: >=6 start bubbles, 18 boxes, respins reset on landing, fields and grand add up', () => {
    const rng = E.rngFrom(31); const amts = E.CFG.quoteTable.map((q) => q[0]); let sawReset = 0, sawFieldDone = 0, sawUpsell = 0, sawFull = 0;
    // a hot config so a full form and the grand are reachable in a test
    const hot = E.createEngine(cfgWith({ landP: 0.6, upsellP: 0.1 }));
    for (const [en, n] of [[eng, 6000], [hot, 4000]]) for (let i = 0; i < n; i++) {
      const r = en.round(rng, 'quote', { script: true }); const x = r.script.features[0]; assert.strictEqual(x.kind, 'quote');
      assert.ok(x.startCount >= 6 && x.startCount <= 15 && x.start.length === x.startCount);
      const amt = new Array(18).fill(0), ups = new Array(18).fill(0), used = new Array(18).fill(false);
      for (const s of x.start) { assert.ok(!used[s.box] && s.box >= 0 && s.box < 18); used[s.box] = true; amt[s.box] = s.amt; assert.ok(amts.includes(s.amt)); }
      let filled = x.startCount, left = 3;
      for (const rs of x.respins) {
        assert.ok(left > 0 && filled < 18, 'respin played while it should have ended');
        for (const l of rs.landed) { assert.ok(!used[l.box], 'landed on a full box'); used[l.box] = true; filled++; if (l.upsell) { ups[l.box] = 1; sawUpsell++; } else { amt[l.box] = l.amt; assert.ok(amts.includes(l.amt)); } }
        if (rs.landed.length) { left = 3; sawReset++; } else left--;
        assert.strictEqual(rs.left, left);
      }
      assert.ok(left === 0 || filled === 18);
      let total = 0, all4 = true;
      for (const F of E.FIELDS) {
        const f = x.fields.find((q) => q.id === F.id); let sum = 0, u = 0, n = 0;
        for (let b = F.from; b < F.from + F.size; b++) { sum += amt[b]; u += ups[b]; n += used[b] ? 1 : 0; }
        const done = n === F.size; if (!done) all4 = false; else sawFieldDone++;
        const m = 1 << Math.min(u, E.CFG.maxUpsellDoubles);
        assert.strictEqual(f.mult, m); assert.strictEqual(f.sum, sum); assert.strictEqual(f.done, done);
        assert.strictEqual(f.total, sum * m + (done ? E.CFG.fieldPrize[F.id] : 0)); total += f.total;
      }
      if (all4) { total += E.CFG.grandPrize; sawFull++; }
      assert.strictEqual(x.grand, all4); assert.strictEqual(x.totalTenths, Math.min(total, E.MAX_WIN_T)); assert.strictEqual(r.winTenths, x.totalTenths);
    }
    assert.ok(sawReset > 100 && sawFieldDone > 100 && sawUpsell > 5 && sawFull > 5, [sawReset, sawFieldDone, sawUpsell, sawFull].join(','));
  });

  await test('engine: natural triggers: phones on reels 1-3-5 start ROTARY, 6+ bubbles start QUOTE, both play QUOTE first', () => {
    let r = E.resolveRound(E.rngFrom(1), null, { force: 'rotary' });
    let b = r.script.base; assert.ok(b.triggers.includes('rotary')); for (const c of [0, 2, 4]) assert.ok(b.grid[c].includes('phone'));
    assert.strictEqual(r.script.features.at(-1).kind, 'rotary');
    r = E.resolveRound(E.rngFrom(2), null, { force: 'quote' }); b = r.script.base;
    assert.ok(flat(b.grid).filter((g) => g === 'quote').length >= 6 && b.triggers.includes('quote'));
    const f = r.script.features.find((q) => q.kind === 'quote'); assert.strictEqual(f.startCount, flat(b.grid).filter((g) => g === 'quote').length);
    assert.strictEqual(b.quotes.length, f.startCount);
    // both at once, using a config where both are all but certain
    const both = E.createEngine(cfgWith({ phoneW: 1e6, quoteW: 1e6 })); let seen = 0;
    for (let s = 1; s <= 200 && !seen; s++) {
      const q = both.round(E.rngFrom(s), null, { script: true });
      if (q.rotary && q.quote) { seen++; assert.deepStrictEqual(q.script.features.map((x) => x.kind), ['quote', 'rotary']); assert.deepStrictEqual(q.script.base.triggers, ['quote', 'rotary']); assert.strictEqual(q.winTenths, Math.min(q.baseTenths + q.quoteTenths + q.rotaryTenths, E.MAX_WIN_T)); }
    }
    assert.ok(seen, 'a spin with both triggers was found');
    // a miss with two phones on reels 1 and 3 is a tease for reel 5
    let tease = 0; const rng = E.rngFrom(3);
    for (let i = 0; i < 20000 && !tease; i++) { const q = eng.round(rng, null, { script: true }); if (q.script.base.tease && !q.rotary) tease++; }
    assert.ok(tease);
  });

  await test('engine: short RTP sanity band (3M spins, fixed seed): 98% +-4, hit rate 28-34%, bonus rates near plan', () => {
    const rng = E.rngFrom(2026); const N = 3000000;
    let sum = 0, hit = 0, rot = 0, quo = 0, any = 0;
    for (let i = 0; i < N; i++) { const r = eng.round(rng, null); sum += r.winTenths; if (r.baseTenths > 0) hit++; if (r.rotary) rot++; if (r.quote) quo++; if (r.rotary || r.quote) any++; }
    const rtp = sum / N / 10 * 100, hr = hit / N * 100;
    assert.ok(rtp > 94 && rtp < 102, 'rtp ' + rtp.toFixed(2));
    assert.ok(hr > 28 && hr < 34, 'hit ' + hr.toFixed(2));
    assert.ok(N / rot > 140 && N / rot < 210, 'rotary 1 in ' + N / rot);
    assert.ok(N / quo > 190 && N / quo < 300, 'quote 1 in ' + N / quo);
    assert.ok(N / any > 80 && N / any < 125, 'any 1 in ' + N / any);
  });

  await test('engine: buy prices land each buy near 98% (400k buys each, +-4)', () => {
    const rng = E.rngFrom(8);
    for (const buy of ['rotary', 'quote']) {
      let sum = 0; const n = 400000; for (let i = 0; i < n; i++) sum += eng.round(rng, buy).winTenths;
      const rtp = sum / n / E.CFG.buyCost[buy] * 100;
      assert.ok(rtp > 94 && rtp < 102, buy + ' buy rtp ' + rtp.toFixed(2));
    }
  });

  await test('engine: the browser copy is byte-identical to the server engine', () => {
    assert.ok(fs.readFileSync(path.join(__dirname, '..', 'games', 'coldcall-engine.js')).equals(fs.readFileSync(path.join(__dirname, '..', 'public', 'games', 'coldcall', 'engine.js'))));
  });

  // ---------------------------------------------------------------- server module
  await test('registry: coldcall is registered next to bender', () => {
    const s = setup(); assert.ok(s.g.modules.some((m) => m.id === 'coldcall' && m.kind === 'solo' && typeof m.handlers.spin === 'function'));
  });

  await test('coldcall: unsigned socket gets auth error, wallet untouched', async () => {
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
      assert.strictEqual(r.bet, bet); assert.strictEqual(r.cost, bet); assert.strictEqual(r.totalWin, m.winTenths * bet / 10); assert.strictEqual(r.totalWinTenths, m.winTenths);
      assert.deepStrictEqual(r.script, m.script);
      expect += -bet + r.totalWin; assert.strictEqual(r.wallet.play, expect); assert.strictEqual(r.wallet.ledgerNet, 0);
      for (const k of ['roundId', 'script', 'totalWin', 'tier', 'wallet']) assert.ok(k in r, k);
    }
    assert.deepStrictEqual(s.wallet.get('ann').play, expect);
    await tick(); assert.strictEqual(last(a, 'wallet').play, expect);
  });

  await test('coldcall: ledger spin moves only the ledger purse and writes ledger rows', async () => {
    const s = setup({ rng: E.rngFrom(6) }); const a = s.sock('ann');
    a.send('g:coldcall:spin', { bet: 200, mode: 'ledger' });
    const r = last(a, 'g:coldcall:result');
    assert.strictEqual(r.wallet.play, 1000000); assert.strictEqual(r.wallet.ledgerNet, -200 + r.totalWin);
    assert.ok(s.rows.length >= 1 && s.rows.every((x) => x[0] === 'game'));
  });

  await test('coldcall: buys charge costTenths*bet/10, play the chosen bonus, and the engine win is paid exactly', async () => {
    const s = setup({ rng: E.rngFrom(12) }); const a = s.sock('ann'); const mirror = E.rngFrom(12); let bal = 1000000;
    for (const buy of ['rotary', 'quote', 'rotary', 'quote']) for (const bet of [10, 50, 2500]) {
      s.clock.advance(200); a.send('g:coldcall:spin', { bet, mode: 'play', buyBonus: buy });
      const r = last(a, 'g:coldcall:result'); const m = E.resolveRound(mirror, buy);
      assert.strictEqual(r.buyBonus, buy); assert.strictEqual(r.cost, E.CFG.buyCost[buy] * bet / 10); assert.strictEqual(r.costTenths, E.CFG.buyCost[buy]);
      assert.strictEqual(r.script.features[0].kind, buy); assert.strictEqual(r.totalWin, m.winTenths * bet / 10);
      bal += -r.cost + r.totalWin; assert.strictEqual(r.wallet.play, bal);
    }
    a.send('g:coldcall:state'); const st = last(a, 'g:coldcall:state');
    assert.deepStrictEqual(st.betLevels, E.BET_LEVELS); assert.deepStrictEqual(st.buyCostX, { rotary: E.CFG.buyCost.rotary / 10, quote: E.CFG.buyCost.quote / 10 });
  });

  await test('coldcall: a buy the player cannot afford is refused with funds and nothing moves', async () => {
    const s = setup({ rng: E.rngFrom(14) }); const a = s.sock('ann');
    s.wallet.spend('ann', 'play', 1000000 - 1000);       // 10.00 left; rotary buy at 25.00 bet costs 92.00
    a.send('g:coldcall:spin', { bet: 2500, mode: 'play', buyBonus: 'rotary' });
    assert.strictEqual(last(a, 'error').code, 'funds'); assert.strictEqual(all(a, 'g:coldcall:result').length, 0);
    assert.strictEqual(s.wallet.get('ann').play, 1000);
    s.clock.advance(200); a.send('g:coldcall:spin', { bet: 1000, mode: 'play' });   // exactly the balance: allowed
    assert.strictEqual(all(a, 'g:coldcall:result').length, 1);
    assert.ok(s.wallet.get('ann').play >= 0);
  });

  await test('coldcall: ledger limit stops spins, no negative play, balances never go below the floor', async () => {
    const s = setup({ rng: E.rngFrom(7) }); const a = s.sock('ann');
    s.wallet.spend('ann', 'ledger', 49900);
    for (let i = 0; i < 40; i++) { s.clock.advance(200); a.send('g:coldcall:spin', { bet: 1000, mode: 'ledger' }); }
    assert.ok(all(a, 'error').some((e) => e.code === 'limit'));
    assert.ok(s.wallet.get('ann').ledgerNet >= -50000);
    const b = s.sock('bo'); s.wallet.spend('bo', 'play', 999900);
    s.clock.advance(200); b.send('g:coldcall:spin', { bet: 500, mode: 'play' });
    assert.strictEqual(last(b, 'error').code, 'funds'); assert.strictEqual(s.wallet.get('bo').play, 100);
  });

  await test('coldcall: bad bets, modes, buys and payload shapes are rejected without touching the wallet', async () => {
    const s = setup(); const a = s.sock('ann');
    const bad = [{ bet: 0, mode: 'play' }, { bet: -10, mode: 'play' }, { bet: 15, mode: 'play' }, { bet: 1.5, mode: 'play' }, { bet: NaN, mode: 'play' }, { bet: Infinity, mode: 'play' },
      { bet: 1e21, mode: 'play' }, { bet: 2 ** 60, mode: 'play' }, { bet: Number.MAX_SAFE_INTEGER, mode: 'play' }, { bet: 5000, mode: 'play' }, { bet: [100], mode: 'play' },
      { bet: '100', mode: 'play' }, { bet: 100, mode: 'chips' }, { bet: 100, mode: 'PLAY' }, { bet: 100, mode: ['play'] }, { bet: 100 }, { mode: 'play' }, null, 'x', 7, [],
      { bet: 100, mode: 'play', buyBonus: 'nope' }, { bet: 100, mode: 'play', buyBonus: 'election' }, { bet: 100, mode: 'play', buyBonus: 1 }, { bet: 100, mode: 'play', buyBonus: true },
      { bet: 100, mode: 'play', buyBonus: {} }, { bet: 100, mode: 'play', buyBonus: ['rotary'] }, { bet: 100, mode: 'play', buyBonus: 'ROTARY' }];
    for (const p of bad) { s.clock.advance(200); a.send('g:coldcall:spin', p); }
    assert.strictEqual(all(a, 'error').length, bad.length);
    assert.strictEqual(all(a, 'g:coldcall:result').length, 0);
    assert.deepStrictEqual(s.wallet.get('ann'), { play: 1000000, ledgerNet: 0, ledgerLimit: -50000 });
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
    for (let i = 0; i < 40; i++) { s.clock.advance(200); for (const k of socks) k.send('g:coldcall:spin', { bet: 50, mode: i % 2 ? 'play' : 'ledger', buyBonus: i % 10 === 3 ? 'quote' : null }); }
    await tick();
    for (const key of ['ann', 'bo']) {
      const mine = socks.filter((k) => k.data.acct.key === key);
      const results = mine.flatMap((k) => all(k, 'g:coldcall:result'));
      const play = results.filter((r) => r.mode === 'play'), led = results.filter((r) => r.mode === 'ledger');
      const w = s.wallet.get(key);
      assert.strictEqual(w.play, 1000000 - play.reduce((a, r) => a + r.cost, 0) + play.reduce((a, r) => a + r.totalWin, 0));
      assert.strictEqual(w.ledgerNet, -led.reduce((a, r) => a + r.cost, 0) + led.reduce((a, r) => a + r.totalWin, 0));
      for (const k of mine) assert.deepStrictEqual(last(k, 'wallet'), w);
    }
  });

  await test('coldcall: history keeps the last 20 and wallet_get still works', async () => {
    const s = setup({ rng: E.rngFrom(13) }); const a = s.sock('ann');
    for (let i = 0; i < 25; i++) { s.clock.advance(200); a.send('g:coldcall:spin', { bet: 10, mode: 'play' }); }
    a.send('g:coldcall:history'); const h = last(a, 'g:coldcall:history');
    assert.strictEqual(h.rounds.length, 20); assert.strictEqual(h.rounds[0].roundId, all(a, 'g:coldcall:result').slice(-1)[0].roundId);
    a.send('wallet_get'); assert.strictEqual(last(a, 'wallet').play, s.wallet.get('ann').play);
  });

  console.log(pass + ' passed' + (process.exitCode ? ', with failures' : ''));
  fs.rmSync(tmp, { recursive: true, force: true });
})();
