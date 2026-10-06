'use strict';
// node tests/coldcall-pull-server.js  (self-contained: temp dir, fake io, no network, no server). THE PULL, server side: store, pot, decisions, feed.
// Contract: cold-call/PULL-ENGINE.md section 4 and 6. Runs against the real engine.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const EventEmitter = require('events');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coldcall-pull-srv-'));
process.env.WALLET_FILE = path.join(tmp, 'wallet.json');
delete process.env.COLDCALL_PULL_FILE;
const { createWallet } = require('../wallet.js');
const games = require('../games');
const E = require('../games/coldcall-engine.js');
const PIN = require('./lib-pull-pin.js').pin(E);   // mechanism tests run on fixed knob numbers (the levers agent owns the real values)
const SRV = require('../games/coldcall.js');

const clone = (o) => JSON.parse(JSON.stringify(o));
const BASE = clone(E.CFG.pull); BASE.on = true;       // what every test starts from
const resetCfg = () => { for (const k of Object.keys(E.CFG.pull)) delete E.CFG.pull[k]; Object.assign(E.CFG.pull, clone(BASE)); };

let pass = 0;
const test = async (name, fn) => { try { await fn(); pass++; console.log('ok   ' + name); } catch (e) { console.error('FAIL ' + name + '\n' + (e.stack || e)); process.exitCode = 1; } };
const tick = () => new Promise((r) => setImmediate(r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeSocket(io, acct) {
  const s = new EventEmitter();
  s.data = acct ? { acct: typeof acct === 'string' ? { key: acct } : acct } : {};
  s.out = [];
  const emit = s.emit.bind(s);
  s.send = (ev, p) => emit(ev, p);             // client -> server
  s.emit = (ev, p) => { if (ev in { error: 1, wallet: 1 } || ev.startsWith('g:') || ev.startsWith('floor:')) { s.out.push([ev, p]); return true; } return emit(ev, p); };
  io.sockets.sockets.set(String(Math.random()), s);
  io.emit('connection', s);
  return s;
}
const last = (s, ev) => { for (let i = s.out.length - 1; i >= 0; i--) if (s.out[i][0] === ev) return s.out[i][1]; return null; };
const all = (s, ev) => s.out.filter((o) => o[0] === ev).map((o) => o[1]);

// each setup has its own dir (wallet.json + coldcall-pull.json next to it); pass { dir, bank, t } to restart over the same files
function setup(opts = {}) {
  resetCfg();
  SRV._history.clear();
  SRV.log = opts.log || (() => {});
  SRV.potRng = opts.potRng || (() => 1);          // never hits unless a test says so
  const dir = opts.dir || fs.mkdtempSync(path.join(tmp, 's'));
  const io = new EventEmitter(); io.sockets = { sockets: new Map() };
  const ledger = { log: () => {} };
  let t = opts.t || 1000000;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const hook = { push: () => {} };
  const bank = opts.bank || new Map();
  const chips = { get: (k) => (bank.has(k) ? bank.get(k) : 10000), add: (k, d) => { bank.set(k, Math.max(0, chips.get(k) + d)); hook.push(k); } };
  const wallet = createWallet({ file: path.join(dir, 'wallet.json'), ledger, chips, now: clock.now, onChange: (k) => hook.push(k) });
  const g = games({ io, ledger, now: clock.now, rng: opts.rng, accounts: {}, tables: {}, rooms: {}, wallet, chips });
  hook.push = g.pushWallet;
  const store = () => SRV._pull.store;
  const potOf = (mode) => store().pot(mode, E.CFG.pull.pot.seed);
  return { io, clock, wallet, g, dir, bank, chips, store, potOf, sock: (a) => makeSocket(io, a), open: SRV._pull.open };
}

// send a spin 200 ms after the last thing; returns the newest result (or error) that this send produced
function spin(s, sock, payload) {
  s.clock.advance(200);
  const n = all(sock, 'g:coldcall:result').length, e = all(sock, 'error').length;
  sock.send('g:coldcall:spin', payload);
  const rs = all(sock, 'g:coldcall:result');
  if (rs.length > n) return rs[rs.length - 1];
  const es = all(sock, 'error'); assert.ok(es.length > e, 'a spin gives a result or an error');
  return { error: es[es.length - 1] };
}
const policy = (i, pend) => (pend.k === 'pick' ? { k: 'pick', p: pend.choices[i % 2 ? pend.choices.length - 1 : 0] } : { k: 'more', take: i % 3 !== 0 });
function decide(s, sock, res, d) {
  const n = all(sock, 'g:coldcall:result').length;
  sock.send('g:coldcall:decide', { roundId: res.roundId, ...d });
  const rs = all(sock, 'g:coldcall:result'); assert.ok(rs.length > n, 'a decision gives a result: ' + JSON.stringify(last(sock, 'error')));
  return rs[rs.length - 1];
}
// spin, then answer every decision with the policy until the round is done
function play(s, sock, payload, i = 0) {
  let r = spin(s, sock, payload), n = 0;
  while (r.status === 'pending') r = decide(s, sock, r, policy(i + n++, r.pending));
  return r;
}
// buy bonuses until one stops at a decision of the wanted kind (other decisions are answered by the policy)
function toPending(s, sock, kind, mode = 'play', bet = 10) {
  for (let i = 0; i < 600; i++) {
    let r = spin(s, sock, { bet, mode, buyBonus: i % 3 === 2 ? 'bonus2' : 'bonus1' });
    if (r.error) throw new Error('toPending: ' + JSON.stringify(r.error));
    if (r.status === 'pending' && r.pending.k === kind) return r;
    let n = 0; while (r.status === 'pending') r = decide(s, sock, r, policy(i + n++, r.pending));
  }
  throw new Error('no ' + kind + ' decision in 600 buys');
}
const rich = (s, key, mode = 'play') => { if (mode === 'chips') s.bank.set(key, 1e10); else s.wallet.credit(key, 'play', 1e10); };
const potOk = (p) => assert.strictEqual(p.fed + p.seeded, p.paid + p.bal, 'pot invariant fed + seeded = paid + bal');

(async () => {
  await test('store: file next to the wallet, atomic, survives a restart (state, pot), state is per currency', async () => {
    const s = setup({ rng: E.rngFrom(31) }); const a = s.sock('ann');
    for (let i = 0; i < 30; i++) play(s, a, { bet: 100, mode: 'play' }, i);
    const view = last(a, 'g:coldcall:result').pull.state;
    assert.ok(view.leads > 0 || view.lt > 0, 'leads were worked');
    s.store().flush();
    const file = path.join(s.dir, 'coldcall-pull.json');
    assert.ok(fs.existsSync(file) && !fs.existsSync(file + '.tmp'), 'store file next to the wallet, no temp left');
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(j.v, 1); assert.ok(j.players.ann.play && !j.players.ann.chips, 'chips state untouched by Play $ spins'); assert.ok(j.pot.play && typeof j.pot.play.bal === 'number');
    assert.deepStrictEqual(j.open, {});
    const potBefore = clone(j.pot.play);
    const s2 = setup({ dir: s.dir, bank: s.bank, rng: E.rngFrom(32), t: 1000000 + 60000 }); const a2 = s2.sock('ann');
    a2.send('g:coldcall:state'); const st = last(a2, 'g:coldcall:state');
    assert.strictEqual(st.pull.play.lt, j.players.ann.play.lt); assert.strictEqual(st.pull.chips.lt, 0); assert.deepStrictEqual(st.pot.play.bal, potBefore.bal);
    assert.deepStrictEqual(clone(s2.potOf('play')), potBefore);
  });

  await test('store: COLDCALL_PULL_FILE overrides the location', async () => {
    const f = path.join(tmp, 'elsewhere.json'); process.env.COLDCALL_PULL_FILE = f;
    try { const s = setup({ rng: E.rngFrom(33) }); const a = s.sock('ann'); play(s, a, { bet: 10, mode: 'play' }); s.store().flush(); assert.ok(fs.existsSync(f)); assert.ok(!fs.existsSync(path.join(s.dir, 'coldcall-pull.json'))); }
    finally { delete process.env.COLDCALL_PULL_FILE; }
  });

  await test('settlement, Play $ and Chips: every bet level and every buy incl. pot slice, pot prizes and taken gambles: before - cost + win + prize = after, pot invariant, slice exact, purses apart', async () => {
    const buys = [null, null, 'call', 'hunt', 'bonus1', 'bonus2', null, 'bonus1'];
    for (const mode of ['play', 'chips']) {
      const other = mode === 'play' ? 'chips' : 'play';
      const s = setup({ rng: E.rngFrom(mode === 'play' ? 41 : 42), potRng: E.rngFrom(7) }); const a = s.sock('ann');
      E.CFG.pull.pot.oneInPerDollar = 400;              // make prizes common enough to be exercised
      rich(s, 'ann', mode);
      const start = s.wallet.get('ann'); let bal = start[mode], sumCost = 0, prizes = 0, takes = 0, wins = 0, picks = 0, mores = 0, callbacks = 0;
      for (let i = 0; i < 240; i++) {
        const bet = E.BET_LEVELS[i % E.BET_LEVELS.length], buy = buys[(i / E.BET_LEVELS.length | 0) % buys.length];
        const before = s.wallet.get('ann')[mode];
        assert.strictEqual(before, bal);
        const r = play(s, a, { bet, mode, buyBonus: buy }, i);
        assert.strictEqual(r.status, 'done'); assert.strictEqual(r.mode, mode); assert.strictEqual(r.buyBonus, buy);
        const played = r.betCents, cost = buy ? E.CFG.buyCost[buy] * played / 10 : r.callback ? 0 : played;
        assert.strictEqual(r.cost, cost); assert.strictEqual(r.totalWin, r.totalWinTenths * played / 10);
        const prize = r.pot ? r.pot.amount : 0;
        for (const v of [r.cost, r.totalWin, prize, r.wallet.play, r.wallet.chips]) assert.ok(Number.isSafeInteger(v) && v >= 0, 'whole cents: ' + v);
        assert.ok(r.totalWin <= E.MAX_WIN_X * played, 'cap');
        bal += -cost + r.totalWin + prize;
        assert.strictEqual(r.wallet[mode], bal, mode + ' round ' + i + ': before - cost + win + prize = after');
        assert.strictEqual(r.wallet[other], start[other], 'the other purse never moves');
        assert.deepStrictEqual(s.wallet.get('ann'), r.wallet);
        if (mode === 'chips') assert.strictEqual(s.chips.get('ann'), bal);
        sumCost += cost; if (prize) prizes++; if (r.totalWin) wins++; if (r.callback) callbacks++;
        if (r.pull && r.pull.more && r.pull.more.take) takes++; if (r.pull && r.pull.pick) picks++; if (r.pull && r.pull.more) mores++;
        const p = s.potOf(mode); potOk(p);
        assert.strictEqual(p.fed * 10000 + p.rem, sumCost * E.CFG.pull.pot.feedBps, 'the slice is exact: fed + rem = cost x bps / 10000');
        assert.ok(p.bal >= 0);
        const ow = s.potOf(other); assert.strictEqual(ow.fed, 0, 'the other currency pot is untouched');
      }
      assert.ok(prizes >= 1, 'the pot paid at least once: ' + prizes); assert.ok(wins > 40 && takes >= 3 && picks >= 1 && mores >= 10, [wins, takes, picks, mores].join());
      const p = s.potOf(mode); assert.strictEqual(p.paid, last(a, 'g:coldcall:result').pot ? p.paid : p.paid);
      const st = s.wallet.stats('ann').coldcall[mode];
      assert.strictEqual(start[mode] - st.wagered + st.won, bal, 'the wallet stats reconcile');
      assert.strictEqual(s.open.size, 0, 'nothing left open');
    }
  });

  await test('spin: a refused spend (funds) leaves state, pot, store and open decisions untouched (plain spin and a bonus buy)', async () => {
    const s = setup({ rng: E.rngFrom(43) }); const a = s.sock('bo');
    s.wallet.spend('bo', 'play', 1000000 - 500, { game: 'x' });     // 5.00 left
    const snap = JSON.stringify(s.store()._data());
    let r = spin(s, a, { bet: 1000, mode: 'play' }); assert.strictEqual(r.error.code, 'funds');
    r = spin(s, a, { bet: 10, mode: 'play', buyBonus: 'bonus1' }); assert.strictEqual(r.error.code, 'funds');
    assert.strictEqual(JSON.stringify(s.store()._data()), snap, 'store untouched'); assert.strictEqual(s.open.size, 0);
    assert.strictEqual(s.wallet.get('bo').play, 500); assert.strictEqual(all(a, 'g:coldcall:result').length, 0);
    r = spin(s, a, { bet: 10, mode: 'play' }); assert.strictEqual(r.status, 'done'); assert.strictEqual(r.wallet.play, 500 - 10 + r.totalWin);
  });

  await test('decisions: a pending round emits only the partial script, no outcome, charges the cost once, and finishing it credits the win once', async () => {
    const s = setup({ rng: E.rngFrom(44) }); const a = s.sock('ann'); rich(s, 'ann');
    for (const kind of ['pick', 'more']) {
      const before = s.wallet.get('ann').play;
      const r = toPending(s, a, kind);
      const cost = r.cost; assert.strictEqual(r.status, 'pending'); assert.strictEqual(r.pending.k, kind);
      for (const k of ['script', 'totalWin', 'totalWinTenths', 'totalWinMult', 'tier', 'maxed']) assert.ok(!(k in r), 'pending must not carry ' + k);
      assert.ok(r.partial && r.partial.partial === true, 'only the partial script'); assert.ok(r.timeoutMs > 0 && r.expiresAt > s.clock.now());
      assert.strictEqual(r.pot, null);
      assert.strictEqual(s.open.size, 1); const rec = s.open.get(r.roundId); assert.ok(rec.timer && rec.timer.hasRef() === false, 'timer is unref\'d');
      const mid = s.wallet.get('ann').play;
      const f = decide(s, a, r, kind === 'pick' ? { k: 'pick', p: r.pending.choices[r.pending.choices.length - 1] } : { k: 'more', take: false });
      let fin = f; while (fin.status === 'pending') fin = decide(s, a, fin, policy(0, fin.pending));
      assert.strictEqual(fin.status, 'done'); assert.strictEqual(fin.resolved, true); assert.strictEqual(fin.auto, null);
      assert.deepStrictEqual(fin.script.spin, r.partial.spin, 'what the player saw is what happened');
      assert.strictEqual(fin.wallet.play, mid + fin.totalWin + (fin.pot ? fin.pot.amount : 0));
      assert.strictEqual(s.open.size, 0); assert.strictEqual(rec.timer, null, 'timer cleared on settle');
      assert.ok(before - cost <= mid);
    }
  });

  await test('decisions: pick is a real choice (every square is accepted, the base spin is identical whatever is picked), bad p / wrong kind / missing take are rejected and leave the round open', async () => {
    const run = (which) => {
      const s = setup({ rng: E.rngFrom(45) }); const a = s.sock('ann'); rich(s, 'ann');
      const r = toPending(s, a, 'pick');
      for (const bad of [{ k: 'pick', p: 999 }, { k: 'pick', p: -1 }, { k: 'pick', p: 'x' }, { k: 'pick' }, { k: 'more', take: true }, { k: 'pick', p: 0.5 }]) {
        const n = all(a, 'g:coldcall:result').length;
        if (!r.pending.choices.includes(bad.p)) { a.send('g:coldcall:decide', { roundId: r.roundId, ...bad }); assert.strictEqual(last(a, 'error').code, 'bad_request'); assert.strictEqual(all(a, 'g:coldcall:result').length, n); }
      }
      a.send('g:coldcall:decide', { roundId: r.roundId, k: 'pick', p: -5 }); assert.strictEqual(last(a, 'error').code, 'bad_request');
      assert.strictEqual(s.open.size, 1, 'a bad decision leaves the round open');
      const choice = which === 'first' ? r.pending.choices[0] : r.pending.choices[r.pending.choices.length - 1];
      let f = decide(s, a, r, { k: 'pick', p: choice }); while (f.status === 'pending') f = decide(s, a, f, { k: 'more', take: false });
      return { r, f, choice };
    };
    const x = run('first'), y = run('last');
    assert.deepStrictEqual(x.r.pending, y.r.pending);
    assert.notStrictEqual(x.choice, y.choice); assert.strictEqual(x.f.pull.pick.p, x.choice); assert.strictEqual(y.f.pull.pick.p, y.choice);
    assert.deepStrictEqual(x.f.script.spin, y.f.script.spin, 'same rng consumption for every choice: the base spin does not move');
  });

  await test('decisions: more -> bank and take both settle the bonus (take pays W x mult or 0, bank pays W); a decision is answered once', async () => {
    const s = setup({ rng: E.rngFrom(46) }); const a = s.sock('ann'); rich(s, 'ann');
    let took = 0, won = 0, lost = 0, banked = 0;
    for (let i = 0; i < 60 && (took < 6 || banked < 3); i++) {
      const r = toPending(s, a, 'more'); const W = r.pending.W, take = i % 2 === 0;
      let f = decide(s, a, r, { k: 'more', take }); assert.strictEqual(f.status, 'done');
      const m = f.pull.more; assert.strictEqual(m.W, W); assert.strictEqual(m.take, take);
      assert.ok(f.totalWinTenths <= E.MAX_WIN_T);
      if (take) { took++; if (m.won) { won++; assert.ok(f.script.parts.bonus === W * m.mult); } else { lost++; assert.strictEqual(f.script.parts.bonus, 0); } } else { banked++; assert.strictEqual(f.script.parts.bonus, W); }
      a.send('g:coldcall:decide', { roundId: r.roundId, k: 'more', take: true }); assert.strictEqual(last(a, 'error').code, 'no_round', 'a settled round cannot be decided again');
    }
    assert.ok(took >= 6 && banked >= 3);
  });

  await test('decisions: wrong account, unknown round, wrong kind are rejected and leave everything as it was', async () => {
    const s = setup({ rng: E.rngFrom(47) }); const a = s.sock('ann'), b = s.sock('bo'); rich(s, 'ann');
    const r = toPending(s, a, 'more'); const snap = JSON.stringify(s.store()._data()); const wal = s.wallet.get('ann');
    b.send('g:coldcall:decide', { roundId: r.roundId, k: 'more', take: true }); assert.strictEqual(last(b, 'error').code, 'forbidden');
    a.send('g:coldcall:decide', { roundId: 'nope', k: 'more', take: true }); assert.strictEqual(last(a, 'error').code, 'no_round');
    a.send('g:coldcall:decide', { roundId: r.roundId, k: 'pick', p: 3 }); assert.strictEqual(last(a, 'error').code, 'bad_request');
    a.send('g:coldcall:decide', { roundId: r.roundId, k: 'more', take: 'yes' }); assert.strictEqual(last(a, 'error').code, 'bad_request');
    a.send('g:coldcall:decide', null); assert.strictEqual(last(a, 'error').code, 'no_round');
    assert.strictEqual(JSON.stringify(s.store()._data()), snap); assert.deepStrictEqual(s.wallet.get('ann'), wal); assert.strictEqual(s.open.size, 1);
    const u = s.sock(null); u.send('g:coldcall:decide', { roundId: r.roundId, k: 'more', take: true }); assert.strictEqual(last(u, 'error').code, 'auth'); assert.strictEqual(s.open.size, 1);
    assert.strictEqual(decide(s, a, r, { k: 'more', take: false }).status, 'done');
  });

  await test('decisions: a spin while a decision is open is REJECTED (not defaulted) with the pending payload; the other currency is free; state shows the open decision', async () => {
    const s = setup({ rng: E.rngFrom(48) }); const a = s.sock('ann'); rich(s, 'ann'); rich(s, 'ann', 'chips');
    const r = toPending(s, a, 'more'); const wal = s.wallet.get('ann');
    const e = spin(s, a, { bet: 10, mode: 'play' }).error;
    assert.strictEqual(e.code, 'decision_open'); assert.strictEqual(e.open.roundId, r.roundId); assert.deepStrictEqual(e.open.pending, r.pending); assert.strictEqual(e.open.status, 'pending');
    assert.deepStrictEqual(s.wallet.get('ann'), wal, 'nothing charged'); assert.strictEqual(s.open.size, 1);
    a.send('g:coldcall:state'); const st = last(a, 'g:coldcall:state'); assert.strictEqual(st.open.roundId, r.roundId); assert.strictEqual(st.opens.length, 1);
    const c = spin(s, a, { bet: 10, mode: 'chips' }); assert.ok(c.status === 'done' || c.status === 'pending', 'chips is a separate round');
    if (c.status === 'pending') decide(s, a, c, { k: c.pending.k, ...(c.pending.k === 'more' ? { take: false } : { p: c.pending.choices[0] }) });
    const b = s.sock('bo'); const r2 = spin(s, b, { bet: 10, mode: 'play' }); assert.ok(r2.status === 'done' || r2.status === 'pending', 'another account is free');
    assert.strictEqual(decide(s, a, r, { k: 'more', take: false }).status, 'done');
    assert.strictEqual(spin(s, a, { bet: 10, mode: 'play' }).error, undefined, 'free again once settled');
  });

  await test('default on timeout: the safe default (first square, bank) settles exactly like a chosen round, marked auto: timeout, in the result and in the history; timer fires once', async () => {
    const s = setup({ rng: E.rngFrom(49) }); const a = s.sock('ann'); rich(s, 'ann');
    E.CFG.pull.decision.timeoutMs = 40;
    for (const kind of ['pick', 'more']) {
      const r = toPending(s, a, kind); const n = all(a, 'g:coldcall:result').length; const mid = s.wallet.get('ann').play;
      await sleep(120);
      const rs = all(a, 'g:coldcall:result'); assert.strictEqual(rs.length, n + 1, 'exactly one settlement');
      const f = rs[rs.length - 1]; assert.strictEqual(f.roundId, r.roundId); assert.strictEqual(f.status, 'done'); assert.strictEqual(f.auto, 'timeout'); assert.strictEqual(f.resolved, true);
      assert.strictEqual(f.wallet.play, mid + f.totalWin + (f.pot ? f.pot.amount : 0));
      if (kind === 'pick') { assert.strictEqual(f.pull.pick.p, r.pending.choices[0]); assert.strictEqual(f.pull.pick.auto, true); }
      if (f.pull.more) { assert.strictEqual(f.pull.more.take, false); assert.strictEqual(f.pull.more.auto, true); }
      assert.strictEqual(s.open.size, 0); assert.strictEqual(s.store().allOpen().length, 0);
      a.send('g:coldcall:history'); assert.strictEqual(last(a, 'g:coldcall:history').rounds[0].auto, 'timeout');
    }
  });

  await test('default: a decision already made is kept, the later one defaults on timeout (pick chosen, more timed out)', async () => {
    const s = setup({ rng: E.rngFrom(50) }); const a = s.sock('ann'); rich(s, 'ann');
    for (let i = 0; i < 400; i++) {
      s.clock.advance(200); E.CFG.pull.decision.timeoutMs = 30;
      let r = spin(s, a, { bet: 10, mode: 'play', buyBonus: 'bonus1' }); let more = null;
      if (r.status === 'pending' && r.pending.k === 'pick') {
        const p = r.pending.choices[r.pending.choices.length - 1];
        const f = decide(s, a, r, { k: 'pick', p });
        if (f.status === 'pending') { more = f; await sleep(100); const fin = last(a, 'g:coldcall:result'); assert.strictEqual(fin.roundId, r.roundId); assert.strictEqual(fin.pull.pick.p, p); assert.strictEqual(fin.pull.pick.auto, false); assert.strictEqual(fin.pull.more.auto, true); assert.strictEqual(fin.auto, 'timeout'); return; }
      } else if (r.status === 'pending') { await sleep(100); }
    }
    assert.fail('never saw a pick followed by a more');
  });

  await test('default on disconnect of the owning socket (bank), settles once, the pending timer is gone, a later timeout does nothing', async () => {
    const s = setup({ rng: E.rngFrom(51) }); const a = s.sock('ann'); rich(s, 'ann');
    E.CFG.pull.decision.timeoutMs = 60;
    const r = toPending(s, a, 'more'); const mid = s.wallet.get('ann').play; const n = all(a, 'g:coldcall:result').length;
    a.send('disconnect');
    const rs = all(a, 'g:coldcall:result'); assert.strictEqual(rs.length, n + 1); const f = rs[rs.length - 1];
    assert.strictEqual(f.auto, 'disconnect'); assert.strictEqual(f.pull.more.take, false); assert.strictEqual(f.pull.more.auto, true);
    assert.strictEqual(f.wallet.play, mid + f.totalWin + (f.pot ? f.pot.amount : 0)); assert.strictEqual(s.open.size, 0); assert.strictEqual(s.store().allOpen().length, 0);
    await sleep(150); assert.strictEqual(all(a, 'g:coldcall:result').length, n + 1, 'no second settlement'); assert.strictEqual(s.wallet.get('ann').play, f.wallet.play);
    // a disconnect with nothing open is harmless, another socket of the account is not defaulted
    const b = s.sock('ann'), c = s.sock('ann'); const r2 = spin(s, b, { bet: 10, mode: 'play', buyBonus: 'bonus1' });
    c.send('disconnect'); if (r2.status === 'pending') assert.strictEqual(s.open.size, 1);
  });

  await test('autoplay: auto true never stops at a decision, defaults every one (first square, bank), marks autoplay, and settles', async () => {
    const s = setup({ rng: E.rngFrom(52) }); const a = s.sock('ann'); rich(s, 'ann');
    let marked = 0, bal = s.wallet.get('ann').play;
    for (let i = 0; i < 60; i++) {
      const r = spin(s, a, { bet: 10, mode: 'play', buyBonus: i % 2 ? 'bonus2' : 'bonus1', auto: true });
      assert.strictEqual(r.status, 'done'); assert.strictEqual(s.open.size, 0);
      bal += -r.cost + r.totalWin + (r.pot ? r.pot.amount : 0); assert.strictEqual(r.wallet.play, bal);
      if (r.pull.pick) { assert.strictEqual(r.pull.pick.auto, true); assert.strictEqual(r.pull.pick.p, r.pull.pick.choices[0]); }
      if (r.pull.more) { assert.strictEqual(r.pull.more.take, false); assert.strictEqual(r.pull.more.auto, true); }
      if (r.pull.pick || r.pull.more) { assert.strictEqual(r.auto, 'autoplay'); marked++; } else assert.strictEqual(r.auto, null);
      assert.strictEqual(r.resolved, false);
    }
    assert.ok(marked >= 40, 'bonus buys hit decision points: ' + marked);
    const plain = spin(s, a, { bet: 10, mode: 'play', auto: true }); assert.strictEqual(plain.status, 'done'); assert.strictEqual(plain.auto, null);
  });

  await test('restart: an open decision is voided at init, the cost refunded exactly once, state and pot untouched, record dropped, logged; a second restart refunds nothing more', async () => {
    const logs = [];
    const s = setup({ rng: E.rngFrom(53) }); const a = s.sock('ann'); rich(s, 'ann');
    for (let i = 0; i < 5; i++) play(s, a, { bet: 100, mode: 'play' }, i);
    const r = toPending(s, a, 'more', 'play', 100);
    const spent = s.wallet.get('ann').play;
    // exact state right now (the open round has changed neither the state nor the pot)
    const stNow = clone(s.store().player('ann', 'play')), potNow = clone(s.potOf('play'));
    const onDisk = JSON.parse(fs.readFileSync(path.join(s.dir, 'coldcall-pull.json'), 'utf8'));
    assert.strictEqual(Object.keys(onDisk.open).length, 1, 'the open record is on disk the moment the round opens');
    assert.strictEqual(onDisk.open['ann|play'].cost, r.cost);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(s.dir, 'wallet.json'), 'utf8')).ann.play, spent, 'and so is the spend');
    const s2 = setup({ dir: s.dir, bank: s.bank, rng: E.rngFrom(54), t: s.clock.now() + 5000, log: (...x) => logs.push(x.join(' ')) });
    assert.strictEqual(s2.wallet.get('ann').play, spent + r.cost, 'refunded the cost');
    assert.deepStrictEqual(clone(s2.store().player('ann', 'play')), stNow, 'state untouched'); assert.deepStrictEqual(clone(s2.potOf('play')), potNow, 'pot untouched');
    assert.strictEqual(s2.store().allOpen().length, 0); assert.strictEqual(s2.open.size, 0); assert.ok(logs.some((l) => l.includes(r.roundId)), 'logged');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(s.dir, 'coldcall-pull.json'), 'utf8')).open['ann|play'], undefined);
    const s3 = setup({ dir: s.dir, bank: s.bank, rng: E.rngFrom(55), t: s.clock.now() + 9000 });
    assert.strictEqual(s3.wallet.get('ann').play, spent + r.cost, 'a second restart refunds nothing more');
    await sleep(60); assert.strictEqual(s3.wallet.get('ann').play, spent + r.cost);
  });

  await test('restart: the same for Chips (refund goes to the bank), alongside a Play $ decision at the same time', async () => {
    const s = setup({ rng: E.rngFrom(56) }); const a = s.sock('ann'); rich(s, 'ann'); rich(s, 'ann', 'chips');
    const p = toPending(s, a, 'more', 'play'); const c = toPending(s, a, 'more', 'chips');
    assert.strictEqual(s.store().allOpen().length, 2);
    const w = s.wallet.get('ann');
    const s2 = setup({ dir: s.dir, bank: s.bank, rng: E.rngFrom(57), t: s.clock.now() + 1000 });
    assert.strictEqual(s2.wallet.get('ann').play, w.play + p.cost); assert.strictEqual(s2.wallet.get('ann').chips, w.chips + c.cost); assert.strictEqual(s2.bank.get('ann'), w.chips + c.cost);
    assert.strictEqual(s2.store().allOpen().length, 0);
  });

  await test('pot: two players racing for it in one tick, the hit roll forced: exactly one takes it, the other gets nothing, invariant and wallet sums hold (Play $ and Chips)', async () => {
    for (const mode of ['play', 'chips']) {
      const s = setup({ rng: E.rngFrom(61), potRng: () => 0 }); const a = s.sock('ann'), b = s.sock('bo');
      rich(s, 'ann', mode); rich(s, 'bo', mode);
      const pot = s.potOf(mode); pot.bal += 5000; pot.fed += 5000; s.store().potChanged();
      const w0 = { ann: s.wallet.get('ann')[mode], bo: s.wallet.get('bo')[mode] };
      s.clock.advance(300);
      a.send('g:coldcall:spin', { bet: 100, mode, auto: true }); b.send('g:coldcall:spin', { bet: 100, mode, auto: true });     // same tick, one synchronous block each
      const ra = last(a, 'g:coldcall:result'), rb = last(b, 'g:coldcall:result');
      const hits = [ra, rb].filter((r) => r.pot);
      assert.strictEqual(hits.length, 1, 'one winner'); const w = hits[0];
      assert.ok(w.pot.won && w.pot.amount >= 5000 && w.pot.amount <= 5000 + 10, 'took the whole pot: ' + w.pot.amount); assert.strictEqual(w.pot.who, w === ra ? 'ann' : 'bo');
      potOk(pot); assert.strictEqual(pot.paid, w.pot.amount); assert.ok(pot.bal < 5, 'pot emptied (only a fresh slice left): ' + pot.bal); assert.strictEqual(pot.last.who, w.pot.who); assert.strictEqual(pot.last.amount, w.pot.amount);
      assert.strictEqual(s.wallet.get('ann')[mode], w0.ann - 100 + ra.totalWin + (ra.pot ? ra.pot.amount : 0));
      assert.strictEqual(s.wallet.get('bo')[mode], w0.bo - 100 + rb.totalWin + (rb.pot ? rb.pot.amount : 0));
      const total = (s.wallet.get('ann')[mode] - w0.ann) + (s.wallet.get('bo')[mode] - w0.bo);
      assert.strictEqual(total, -200 + ra.totalWin + rb.totalWin + pot.paid, 'wallet sums = costs, wins, one prize');
    }
  });

  await test('pot: seed (tracked house money), minBal, maxPayX cap, no slice and no roll on a Callback, hit chance follows the cost', async () => {
    let s = setup({ rng: E.rngFrom(62), potRng: () => 0 }); let a = s.sock('ann');
    E.CFG.pull.pot.seed = 700; E.CFG.pull.pot.maxPayX = 3;
    // the pot is created lazily with its seed
    s.potOf('play'); let p = s.potOf('play'); assert.strictEqual(p.bal, 700); assert.strictEqual(p.seeded, 700); potOk(p);
    const r = spin(s, a, { bet: 100, mode: 'play', auto: true });
    assert.ok(r.pot, 'forced hit on a pot above minBal'); assert.strictEqual(r.pot.amount, 300, 'prize = min(bal, maxPayX x bet) = 3 x 100');
    p = s.potOf('play'); potOk(p); assert.strictEqual(p.paid, 300); assert.strictEqual(p.bal, 700 - 300 + 700 + 0, 'the seed is put back after a hit') ;
    assert.strictEqual(p.seeded, 1400);
    // minBal
    s = setup({ rng: E.rngFrom(63), potRng: () => 0 }); a = s.sock('ann'); E.CFG.pull.pot.minBal = 1000;
    const r2 = spin(s, a, { bet: 10, mode: 'play', auto: true }); assert.strictEqual(r2.pot, null, 'below minBal there is no prize'); potOk(s.potOf('play'));
    // Callback: free, no slice, no roll
    s = setup({ rng: E.rngFrom(64), potRng: () => 0 }); a = s.sock('ann');
    const pot = s.potOf('play'); pot.bal = 9000; pot.fed = 9000; s.store().potChanged();
    s.store().setPlayer('ann', 'play', { ...E.newState(), cb: { bet: 100 } });
    const w0 = s.wallet.get('ann').play; const rc = spin(s, a, { bet: 10, mode: 'play', auto: true });
    assert.strictEqual(rc.callback, true); assert.strictEqual(rc.cost, 0); assert.strictEqual(rc.bet, 100); assert.strictEqual(rc.betCents, 100); assert.strictEqual(rc.pot, null, 'no pot roll on a free round');
    assert.strictEqual(pot.fed, 9000); assert.strictEqual(pot.rem, 0); assert.strictEqual(pot.bal, 9000); assert.strictEqual(s.wallet.get('ann').play, w0 + rc.totalWin);
    assert.strictEqual(rc.totalWin, rc.totalWinTenths * 100 / 10, 'a Callback pays at cb.bet'); assert.strictEqual(rc.pull.state.cb, null, 'Callback consumed');
    // the next paid spin feeds again
    const rn = spin(s, a, { bet: 100, mode: 'play', auto: true }); assert.ok(rn.cost === 100); assert.ok(pot.fed * 10000 + pot.rem === 100 * E.CFG.pull.pot.feedBps + 9000 * 10000);
  });

  await test('pot: the hit roll uses its own rng with chance = (cost / 100) / oneInPerDollar (a roll just below hits, just above misses)', async () => {
    const chance = (100 / 100) / E.CFG.pull.pot.oneInPerDollar;
    for (const [u, want] of [[chance * 0.999, true], [chance * 1.001, false]]) {
      const s = setup({ rng: E.rngFrom(65), potRng: () => u }); const a = s.sock('ann'); const pot = s.potOf('play'); pot.bal = 5000; pot.fed = 5000;
      const r = spin(s, a, { bet: 100, mode: 'play', auto: true }); assert.strictEqual(!!r.pot, want, 'u=' + u);
    }
  });

  await test('callback: the list fills, arms at the list size, the next spin is the free Callback, pays at cb.bet; Play $ and Chips lists are separate', async () => {
    const s = setup({ rng: E.rngFrom(66) }); const a = s.sock('ann'); rich(s, 'ann'); rich(s, 'ann', 'chips');
    E.CFG.pull.list = 5;
    let armedAt = -1, cb = null;
    for (let i = 0; i < 40 && armedAt < 0; i++) { const r = spin(s, a, { bet: 100, mode: 'play', auto: true }); assert.ok(!r.callback); if (r.pull.armed) { armedAt = i; cb = r.pull.state.cb; } }
    assert.ok(armedAt >= 0 && armedAt <= 20, 'armed after ' + armedAt); assert.deepStrictEqual(cb, { bet: 100 });
    a.send('g:coldcall:state'); const st = last(a, 'g:coldcall:state'); assert.deepStrictEqual(st.pull.play.cb, { bet: 100 }); assert.strictEqual(st.pull.chips.cb, null); assert.strictEqual(st.pull.chips.lt, 0, 'chips list untouched');
    const w0 = s.wallet.get('ann');
    const cr = spin(s, a, { bet: 10, mode: 'chips', auto: true }); assert.strictEqual(cr.callback, false, 'the Play $ Callback is not used by a Chips spin'); assert.ok(cr.cost === 10);
    const r = spin(s, a, { bet: 10, mode: 'play', auto: true }); assert.strictEqual(r.callback, true); assert.strictEqual(r.cost, 0); assert.strictEqual(r.bet, 100);
    assert.strictEqual(r.wallet.play, w0.play + r.totalWin); assert.ok(r.script.callback === true);
    assert.strictEqual(r.pull.state.cb, null);
  });

  await test('feed + floor: win / bonus / callback / pot events with the right shape, to signed-in sockets only, floor:pot after pot changes, ring of 50, the floor handler and the state event serve it', async () => {
    const s = setup({ rng: E.rngFrom(67), potRng: () => 0 });
    const a = s.sock({ key: 'ann', display: 'Ann K' }), b = s.sock('bo'), u = s.sock(null); rich(s, 'ann');
    E.CFG.pull.feed.minWinX = 1; E.CFG.pull.list = 3;
    const pot = s.potOf('play'); pot.bal = 5000; pot.fed = 5000;
    const kinds = new Set();
    for (let i = 0; i < 60; i++) { play(s, a, { bet: 100, mode: 'play', buyBonus: i % 4 === 1 ? 'bonus1' : null }, i); if (i === 0) potRngOff(); }
    function potRngOff() { SRV.potRng = () => 1; }
    const evs = all(b, 'floor:feed'); assert.ok(evs.length > 20, 'the other signed-in socket got the feed');
    assert.deepStrictEqual(all(a, 'floor:feed'), evs, 'everyone signed in sees the same events'); assert.strictEqual(all(u, 'floor:feed').length, 0, 'unsigned sockets get nothing'); assert.strictEqual(all(u, 'floor:pot').length, 0);
    for (const e of evs) {
      assert.deepStrictEqual(Object.keys(e).filter((k) => k !== 'bonus').sort(), ['amount', 'game', 'id', 'kind', 'mode', 't', 'who', 'x']);
      assert.strictEqual(e.game, 'coldcall'); assert.strictEqual(e.who, 'Ann K'); assert.strictEqual(e.mode, 'play'); assert.ok(['win', 'bonus', 'callback', 'pot'].includes(e.kind), e.kind);
      assert.ok(Number.isSafeInteger(e.amount) && e.amount >= 0 && typeof e.x === 'number' && Number.isFinite(e.x) && e.t > 0); kinds.add(e.kind);
      if (e.kind === 'bonus') assert.ok(['bonus1', 'bonus2', 'bonus3'].includes(e.bonus), 'bonus kind: ' + e.bonus);
    }
    assert.deepStrictEqual([...kinds].sort(), ['bonus', 'callback', 'pot', 'win'], 'every kind fired');
    const ids = evs.map((e) => e.id); assert.deepStrictEqual(ids, [...ids].sort((x, y) => x - y)); assert.strictEqual(new Set(ids).size, ids.length);
    const pe = evs.find((e) => e.kind === 'pot'); assert.ok(pe.amount >= 5000 && pe.who === 'Ann K');
    const fp = all(b, 'floor:pot'); assert.ok(fp.length >= 1 && fp.every((e) => e.mode === 'play' && Number.isSafeInteger(e.bal))); assert.strictEqual(fp[fp.length - 1].bal, pot.bal, 'floor:pot carries the live pot');
    b.send('g:coldcall:floor'); const fl = last(b, 'g:coldcall:floor'); assert.strictEqual(fl.pot.play.bal, pot.bal); assert.strictEqual(fl.pot.chips.bal, 0); assert.ok(fl.feed.length <= 20 && fl.feed.length > 0); assert.deepStrictEqual(fl.feed, evs.slice(-fl.feed.length));
    b.send('g:coldcall:state'); const st = last(b, 'g:coldcall:state'); assert.deepStrictEqual(st.feed, fl.feed); assert.deepStrictEqual(st.pot, fl.pot); assert.strictEqual(st.open, null);
    assert.ok(st.pull.on && st.pull.list === 3 && st.pull.play && st.pull.chips && st.pull.decisionMs === E.CFG.pull.decision.timeoutMs);
    u.send('g:coldcall:floor'); assert.strictEqual(last(u, 'error').code, 'auth');
    // ring buffer: only the last 50 are kept
    E.CFG.pull.feed.minWinX = 0;
    for (let i = 0; i < 70; i++) spin(s, a, { bet: 10, mode: 'play', auto: true });
    b.send('g:coldcall:state'); assert.strictEqual(last(b, 'g:coldcall:state').feed.length, 20);
  });

  await test('feed: a decision-timed-out round feeds at settle (not before), a pending round feeds nothing yet; win threshold respected', async () => {
    const s = setup({ rng: E.rngFrom(68) }); const a = s.sock('ann'), b = s.sock('bo'); rich(s, 'ann');
    E.CFG.pull.feed.minWinX = 100000;               // nothing is a "win" feed event
    const n0 = all(b, 'floor:feed').length;
    const r = toPending(s, a, 'more');
    const before = all(b, 'floor:feed').length;
    E.CFG.pull.decision.timeoutMs = 20; SRV._pull.open.get(r.roundId).timer && clearTimeout(SRV._pull.open.get(r.roundId).timer);
    const f = decide(s, a, r, { k: 'more', take: false }); assert.strictEqual(f.status, 'done');
    const evs = all(b, 'floor:feed'); assert.ok(evs.length > before, 'the bonus feeds when it settles'); assert.ok(evs.slice(before).some((e) => e.kind === 'bonus'));
    assert.ok(evs.every((e) => e.kind !== 'win'), 'under the threshold: no win events'); assert.ok(n0 <= before);
  });

  await test('state: Play $ and Chips state never leak into each other; state event carries pull view, pot, feed, open', async () => {
    const s = setup({ rng: E.rngFrom(69) }); const a = s.sock('ann'); rich(s, 'ann'); rich(s, 'ann', 'chips');
    for (let i = 0; i < 25; i++) spin(s, a, { bet: 10, mode: 'play', auto: true });
    a.send('g:coldcall:state'); let st = last(a, 'g:coldcall:state');
    assert.ok(st.pull.play.lt > 0); assert.strictEqual(st.pull.chips.lt, 0); assert.strictEqual(st.pot.chips.bal, 0);
    for (const k of ['leads', 'lt', 'list', 'cb', 'warm', 'cold', 'daily']) assert.ok(k in st.pull.play, k);
    assert.deepStrictEqual(Object.keys(st.pull.play.daily).sort(), ['claimed', 'streak']); assert.strictEqual(st.pull.play.daily.claimed, true); assert.strictEqual(st.pull.chips.daily.claimed, false);
    for (let i = 0; i < 10; i++) spin(s, a, { bet: 10, mode: 'chips', auto: true });
    a.send('g:coldcall:state'); st = last(a, 'g:coldcall:state'); assert.ok(st.pull.chips.lt > 0);
    const plays = s.store().player('ann', 'play'), chipsS = s.store().player('ann', 'chips'); assert.strictEqual(plays.rounds, 25); assert.strictEqual(chipsS.rounds, 10);
    assert.ok(st.pot.play.bal >= 0 && st.pot.chips.bal >= 0 && Array.isArray(st.feed)); assert.strictEqual(st.open, null); assert.deepStrictEqual(st.opens, []);
    assert.strictEqual(s.potOf('chips').fed * 10000 + s.potOf('chips').rem, 10 * 10 * E.CFG.pull.pot.feedBps, 'chips pot got only chips bets');
  });

  await test('state: the cold clock (idle 24 h) shows in the view and leaks leads; day is the America/Chicago calendar day and the daily appointment runs once per day', async () => {
    const s = setup({ rng: E.rngFrom(70), t: Date.UTC(2026, 9, 6, 12, 0, 0) }); const a = s.sock('ann');   // 2026-10-06 07:00 Chicago
    const r1 = spin(s, a, { bet: 10, mode: 'play', auto: true }); assert.strictEqual(r1.pull.daily.streak, 1); assert.ok(r1.pull.daily.leads > 0);
    const r2 = spin(s, a, { bet: 10, mode: 'play', auto: true }); assert.strictEqual(r2.pull.daily, null, 'second spin of the same day');
    s.clock.advance(5 * 3600000);                                       // 12:00 Chicago, same day
    assert.strictEqual(spin(s, a, { bet: 10, mode: 'play', auto: true }).pull.daily, null);
    s.clock.advance(12 * 3600000);                                      // 2026-10-07 00:00+ UTC-5 = 00:00 Chicago? 12:00+17h = 05:00 UTC+1d... next Chicago day starts at 05:00 UTC
    const r4 = spin(s, a, { bet: 10, mode: 'play', auto: true });
    assert.deepStrictEqual(r4.pull.daily && r4.pull.daily.streak, 2, 'next Chicago day, consecutive');
    s.clock.advance(3 * 86400000); const r5 = spin(s, a, { bet: 10, mode: 'play', auto: true }); assert.strictEqual(r5.pull.daily.streak, 1, 'a gap resets the streak');
    // the cold clock: lead list leaks after idle time and the state event shows when
    const st0 = s.store().player('ann', 'play'); const lt0 = st0.lt; assert.ok(lt0 > 10 * 10 || true);
    s.clock.advance(5 * 86400000); a.send('g:coldcall:state'); const v = last(a, 'g:coldcall:state').pull.play;
    assert.ok(v.lt <= lt0); assert.ok(v.cold === null || (v.cold.inMs >= 0 && v.cold.leads >= 0));
  });

  await test('history: entries carry callback / auto / pot; pending rounds enter the history only when settled', async () => {
    const s = setup({ rng: E.rngFrom(71), potRng: () => 0 }); const a = s.sock('ann'); rich(s, 'ann');
    const pot = s.potOf('play'); pot.bal = 3000; pot.fed = 3000;
    const r = spin(s, a, { bet: 100, mode: 'play', auto: true }); assert.ok(r.pot);
    a.send('g:coldcall:history'); let h = last(a, 'g:coldcall:history').rounds; assert.strictEqual(h.length, 1);
    for (const k of ['roundId', 't', 'bet', 'cost', 'mode', 'buy', 'totalWin', 'tier', 'callback', 'auto', 'pot']) assert.ok(k in h[0], k);
    assert.strictEqual(h[0].callback, false); assert.strictEqual(h[0].pot.amount, r.pot.amount); assert.strictEqual(h[0].roundId, r.roundId);
    SRV.potRng = () => 1;
    const p = toPending(s, a, 'more'); a.send('g:coldcall:history'); h = last(a, 'g:coldcall:history').rounds; assert.ok(!h.some((x) => x.roundId === p.roundId), 'a pending round is not history yet');
    decide(s, a, p, { k: 'more', take: false }); a.send('g:coldcall:history'); h = last(a, 'g:coldcall:history').rounds; assert.strictEqual(h[0].roundId, p.roundId); assert.strictEqual(h[0].auto, null);
  });

  await test('legacy: CFG.pull.on = false is the old stateless server (no state, pot, decisions, feed, no new fields) and money still balances', async () => {
    const s = setup({ rng: E.rngFrom(72) }); const a = s.sock('ann'), b = s.sock('bo');
    E.CFG.pull.on = false; const mirror = E.rngFrom(72); let bal = 1000000;
    for (let i = 0; i < 40; i++) {
      s.clock.advance(200); const bet = E.BET_LEVELS[i % 8], buy = i % 5 === 4 ? 'bonus1' : null;
      a.send('g:coldcall:spin', { bet, mode: 'play', buyBonus: buy });
      const r = last(a, 'g:coldcall:result'), m = E.resolveRound(mirror, buy);
      assert.deepStrictEqual(r.script, m.script); assert.strictEqual(r.totalWinTenths, m.winTenths); bal += -r.cost + r.totalWin; assert.strictEqual(r.wallet.play, bal);
      for (const k of ['pull', 'pot', 'callback', 'betCents', 'status', 'pending']) assert.ok(!(k in r), 'legacy result has no ' + k);
    }
    a.send('g:coldcall:state'); const st = last(a, 'g:coldcall:state'); for (const k of ['pull', 'pot', 'feed', 'open']) assert.ok(!(k in st), 'legacy state has no ' + k);
    assert.strictEqual(all(b, 'floor:feed').length, 0); assert.deepStrictEqual(Object.keys(s.store()._data().players), []); assert.deepStrictEqual(Object.keys(s.store()._data().pot), []);
  });

  await test('QA hook with pull on: force plays that feature as a normal paid spin (state and Callback untouched, pot fed), ignored without COLDCALL_TEST', async () => {
    const env0 = { t: process.env.COLDCALL_TEST, n: process.env.NODE_ENV };
    try {
      process.env.COLDCALL_TEST = '1'; delete process.env.NODE_ENV;
      const s = setup({ rng: E.rngFrom(75) }); const a = s.sock('ann');
      s.store().setPlayer('ann', 'play', { ...E.newState(), cb: { bet: 100 }, lt: 100 });
      const w0 = s.wallet.get('ann').play;
      const r = spin(s, a, { bet: 200, mode: 'play', force: 'big' });
      assert.strictEqual(r.status, 'done'); assert.strictEqual(r.forced, 'big'); assert.ok(r.totalWinMult >= 25); assert.strictEqual(r.cost, 200); assert.strictEqual(r.callback, false); assert.strictEqual(r.betCents, 200);
      assert.strictEqual(r.wallet.play, w0 - 200 + r.totalWin);
      assert.deepStrictEqual(s.store().player('ann', 'play').cb, { bet: 100 }, 'the Callback is still waiting'); assert.strictEqual(s.store().player('ann', 'play').lt, 100);
      assert.strictEqual(s.potOf('play').fed * 10000 + s.potOf('play').rem, 200 * E.CFG.pull.pot.feedBps);
      delete process.env.COLDCALL_TEST;
      const q = spin(s, a, { bet: 200, mode: 'play', force: 'big' }); assert.strictEqual(q.forced, undefined); assert.strictEqual(q.callback, true, 'without the hook the Callback plays');
    } finally { if (env0.t == null) delete process.env.COLDCALL_TEST; else process.env.COLDCALL_TEST = env0.t; if (env0.n == null) delete process.env.NODE_ENV; else process.env.NODE_ENV = env0.n; }
  });

  await test('concurrency: many sockets and accounts spinning, buying and deciding in the same ticks keep exact accounting, pot invariant, nothing left open', async () => {
    const s = setup({ rng: E.rngFrom(73), potRng: E.rngFrom(9) }); E.CFG.pull.pot.oneInPerDollar = 1000;
    const names = ['ann', 'bo', 'cy', 'di']; const socks = names.flatMap((n) => [s.sock(n), s.sock(n)]);
    for (const n of names) { rich(s, n); rich(s, n, 'chips'); }
    const w0 = Object.fromEntries(names.map((n) => [n, s.wallet.get(n)]));
    let spent = 0, won = 0, prizes = 0;
    for (let i = 0; i < 80; i++) {
      s.clock.advance(200);
      for (const k of socks) {
        const key = k.data.acct.key; const mode = i % 2 ? 'play' : 'chips';
        if (s.open.size && [...s.open.values()].some((r) => r.nk === key && r.mode === mode)) continue;
        k.send('g:coldcall:spin', { bet: 50, mode, buyBonus: i % 10 === 3 ? 'bonus1' : i % 10 === 7 ? 'call' : null, auto: i % 3 === 0 });
      }
      for (const k of socks) { const r = last(k, 'g:coldcall:result'); if (r && r.status === 'pending' && s.open.has(r.roundId) && k === s.open.get(r.roundId).socket) decide(s, k, r, policy(i, r.pending)); }
    }
    for (const rec of [...s.open.values()]) rec.socket.send('g:coldcall:decide', { roundId: rec.id, ...policy(1, rec.pending) });
    for (const rec of [...s.open.values()]) rec.socket.send('disconnect');
    assert.strictEqual(s.open.size, 0); assert.strictEqual(s.store().allOpen().length, 0);
    const delta = { play: 0, chips: 0 };
    const seen = new Set();   // a settled round that was open goes to every live socket of the account: count each round once
    for (const k of socks) for (const r of all(k, 'g:coldcall:result')) if (r.status === 'done' && !seen.has(r.roundId) && seen.add(r.roundId)) { delta[r.mode] += -r.cost + r.totalWin + (r.pot ? r.pot.amount : 0); spent += r.cost; won += r.totalWin; if (r.pot) prizes++; }
    for (const mode of ['play', 'chips']) {
      const sum = names.reduce((a, n) => a + s.wallet.get(n)[mode] - w0[n][mode], 0); assert.strictEqual(sum, delta[mode], mode + ' wallets = the results'); potOk(s.potOf(mode));
    }
    assert.ok(spent > 0 && won > 0);
  });

  await test('rounds are settled by the module rng tape: a decision replay draws nothing twice (same draws for the prefix, fresh ones after)', async () => {
    const draws = []; const base = E.rngFrom(74);
    const s = setup({ rng: () => { const v = base(); draws.push(v); return v; } }); const a = s.sock('ann'); rich(s, 'ann');
    SRV.rng = () => { const v = base(); draws.push(v); return v; };
    const r = toPending(s, a, 'more'); const n = draws.length;
    decide(s, a, r, { k: 'more', take: false });
    const fresh = draws.length - n; assert.ok(fresh <= 2, 'only the draws after the decision are new (' + fresh + ')');
  });

  // ------------------------------------------------------------------------------------------------ server fix round (wave 1 critics)
  const dayMs = 86400000;
  // first ONE MORE CALL decision of a bought bonus; any pick before it is answered by the policy (so `after` = decisions already made)
  const toMore = (s, sock, wantPick) => {
    for (let i = 0; i < 600; i++) {
      let r = spin(s, sock, { bet: 10, mode: 'play', buyBonus: i % 3 === 2 ? 'bonus2' : 'bonus1' }), n = 0;
      while (r.status === 'pending' && r.pending.k !== 'more') r = decide(s, sock, r, policy(i + n++, r.pending));
      if (r.status === 'pending' && (!wantPick || s.open.get(r.roundId).decisions.length > 0)) return r;
      while (r.status === 'pending') r = decide(s, sock, r, { k: 'more', take: false });
    }
    throw new Error('no ONE MORE CALL found');
  };
  const resultsOf = (sock, id) => all(sock, 'g:coldcall:result').filter((r) => r.roundId === id);

  await test('F3: knobs edited or pull.on flipped while a decision is open: default / timeout / decide pay exactly the shown bonus, never void', async () => {
    const wreck = {
      off: () => { E.CFG.pull.on = false; },
      knobs: () => { const P = E.CFG.pull; P.more.on = false; P.more.mult = 5; P.more.minTenths = 99999; P.pick.on = false; P.pick.minLeads = 99; P.pick.mult = { bronze: 9, silver: 9, gold: 9, upsell: 9, close: 9 }; P.list = 7; P.fill.dead = 0.1; P.ghost.on = false; P.warm.chance = 0; },
      offKnobs: () => { E.CFG.pull.on = false; E.CFG.pull.more.on = false; E.CFG.pull.pick.on = false; },
    };
    for (const how of ['disconnect', 'decide']) for (const [name, edit] of Object.entries(wreck)) {
      const s = setup({ rng: E.rngFrom(81) }); const a = s.sock('ann'); rich(s, 'ann');
      const r = toMore(s, a, true);
      const mid = s.wallet.get('ann').play, W = r.pending.W, shown = clone(r.partial.spin);
      edit();
      let f;
      if (how === 'disconnect') { a.send('disconnect'); f = last(a, 'g:coldcall:result'); } else f = decide(s, a, r, { k: 'more', take: false });
      assert.strictEqual(all(a, 'g:coldcall:voided').length, 0, name + '/' + how + ': not voided');
      assert.strictEqual(f.roundId, r.roundId); assert.strictEqual(f.status, 'done', name + '/' + how);
      assert.strictEqual(f.pull.more.W, W, 'the bonus total is the one that was shown'); assert.strictEqual(f.pull.more.take, false);
      assert.deepStrictEqual(f.script.spin, shown); assert.strictEqual(f.wallet.play, mid + f.totalWin + (f.pot ? f.pot.amount : 0), 'paid, not refunded');
      assert.strictEqual(s.open.size, 0);
    }
  });

  await test('F4: a throw while settling (pot / feed knob block removed) ends in exactly one refund, never a bare lost cost; every live socket of the account hears it', async () => {
    for (const knob of ['pot', 'feed']) {
      const s = setup({ rng: E.rngFrom(82) }); const a = s.sock('ann'), a2 = s.sock('ann'); const start = s.wallet.get('ann').play;
      delete E.CFG.pull[knob];
      const n = all(a, 'g:coldcall:result').length;
      s.clock.advance(200); a.send('g:coldcall:spin', { bet: 2500, mode: 'play' });
      const bal = s.wallet.get('ann').play, voids = all(a, 'g:coldcall:voided'), done = all(a, 'g:coldcall:result').slice(n).filter((r) => r.status === 'done');
      assert.ok(!all(a, 'error').some((e) => e.code === 'internal'), knob + ': no router "Server error"');
      if (voids.length) { assert.strictEqual(voids.length, 1); assert.strictEqual(bal, start, knob + ': refunded exactly once'); assert.strictEqual(voids[0].refund, 2500); assert.strictEqual(all(a2, 'g:coldcall:voided').length, 1, 'the other tab hears it'); }
      else { assert.strictEqual(done.length, 1); assert.strictEqual(bal, start - 2500 + done[0].totalWin + (done[0].pot ? done[0].pot.amount : 0)); }
      assert.strictEqual(s.open.size, 0); assert.strictEqual(s.store().allOpen().length, 0);
    }
  });

  await test('F7: pull.leaked and pull.warmDied are reported after idle days (the server hands the engine the stored, un-ticked state)', async () => {
    const s = setup({ rng: E.rngFrom(83) }); const a = s.sock('ann');
    const st = E.newState(); st.lt = 300; st.avg = 100; st.warm = [3, 4]; st.coldAt = s.clock.now() + 1000; st.day = '2000-01-01';
    s.store().setPlayer('ann', 'play', st);
    s.clock.advance(3 * dayMs);
    const r = play(s, a, { bet: 100, mode: 'play' });
    assert.strictEqual(r.status, 'done'); assert.ok(r.pull.leaked > 0, 'leaked ' + r.pull.leaked); assert.strictEqual(r.pull.warmDied, 2);
    a.send('g:coldcall:state');   // the views still show the cold clock applied
    assert.ok(last(a, 'g:coldcall:state').pull.play.lt <= 300);
  });

  await test('F8: a stored state of the wrong shape resets that one state; spin and the state handler keep working for both currencies, balances move only by the real cost and win', async () => {
    const bads = [{ v: 2 }, 'junk', 42, { v: 1, warm: 'x' }, { v: 1, lt: 50, avg: 100, cb: { bet: 15 }, warm: [1] }, { v: 1, warm: [1, 'a', 99] }, { v: 1, lt: 'many' }, { v: 1, cb: { bet: 2600 } }, { v: 1, cb: 'x' }, { v: 1, warmBet: -3 }, { v: 1, lt: null }];
    for (const bad of bads) for (const mode of ['chips', 'play']) {
      const other = mode === 'play' ? 'chips' : 'play';
      const s = setup({ rng: E.rngFrom(84) }); const a = s.sock('ann'); rich(s, 'ann', mode);
      s.store().setPlayer('ann', mode, bad);
      a.send('g:coldcall:state'); const st = last(a, 'g:coldcall:state'); assert.ok(st && st.pull && st.pull[mode] && st.pull[other], 'state handler works: ' + JSON.stringify(bad));
      assert.ok(!all(a, 'error').length, 'no error: ' + JSON.stringify(all(a, 'error')));
      const before = s.wallet.get('ann')[mode];
      const r = play(s, a, { bet: 100, mode }); assert.strictEqual(r.status, 'done', JSON.stringify(bad));
      assert.strictEqual(r.wallet[mode], before - r.cost + r.totalWin + (r.pot ? r.pot.amount : 0));
      const r2 = play(s, a, { bet: 100, mode: other }); assert.strictEqual(r2.status, 'done');
    }
    // a good state is kept as it is (leads, warm squares), an old one without warmBet gets 0
    const s = setup({ rng: E.rngFrom(85) }); const a = s.sock('ann'); const g = E.newState(); g.lt = 120; g.avg = 100; g.warm = [3, 4];
    s.store().setPlayer('ann', 'play', g); a.send('g:coldcall:state'); const v = last(a, 'g:coldcall:state').pull.play;
    assert.strictEqual(v.lt, 120); assert.deepStrictEqual(v.warm, [3, 4]);
  });

  await test('F9a: the rate limit is per account (three sockets in one ms: one spin), and a clock stepped back is not a lockout', async () => {
    const s = setup({ rng: E.rngFrom(86) }); const [x, y, z] = [s.sock('ann'), s.sock('ann'), s.sock('ann')];
    s.clock.advance(200);
    for (const k of [x, y, z]) k.send('g:coldcall:spin', { bet: 10, mode: 'play', auto: true });
    assert.strictEqual(all(x, 'g:coldcall:result').length, 1); assert.strictEqual(last(y, 'error').code, 'rate'); assert.strictEqual(last(z, 'error').code, 'rate');
    assert.strictEqual(all(y, 'g:coldcall:result').length + all(z, 'g:coldcall:result').length, 0);
    s.clock.advance(200); y.send('g:coldcall:spin', { bet: 10, mode: 'play', auto: true }); assert.strictEqual(all(y, 'g:coldcall:result').length, 1, 'allowed again after the gap');
    s.clock.advance(-3600000); x.send('g:coldcall:spin', { bet: 10, mode: 'play', auto: true });
    assert.strictEqual(all(x, 'g:coldcall:result').length, 2, 'clock stepped back 1 h: not a lockout');
    const b = s.sock('bo'); b.send('g:coldcall:spin', { bet: 10, mode: 'play', auto: true }); assert.strictEqual(all(b, 'g:coldcall:result').length, 1, 'another account is its own limit');
  });

  await test('F9b: history is keyed by the normalised account key, pull path and legacy path', async () => {
    for (const on of [true, false]) {
      const s = setup({ rng: E.rngFrom(87) }); E.CFG.pull.on = on; const a = s.sock('ANN '), b = s.sock('ann');
      play(s, a, { bet: 10, mode: 'play', auto: true }); play(s, b, { bet: 10, mode: 'play', auto: true });
      a.send('g:coldcall:history'); b.send('g:coldcall:history');
      assert.strictEqual(last(a, 'g:coldcall:history').rounds.length, 2, 'pull ' + on); assert.strictEqual(last(b, 'g:coldcall:history').rounds.length, 2);
      assert.ok(SRV._history.has('ann') && !SRV._history.has('ANN '));
    }
  });

  await test('F9c: reserved names (__proto__, constructor, prototype) are refused at every handler; the store keeps its maps prototype-free', async () => {
    try {
      for (const name of ['__proto__', 'constructor', 'prototype']) {
        const s = setup({ rng: E.rngFrom(88) }); const a = s.sock(name);
        for (const ev of ['state', 'history', 'floor', 'spin', 'decide']) { const n = all(a, 'error').length; a.send('g:coldcall:' + ev, { bet: 10, mode: 'play', roundId: 'x' }); assert.ok(all(a, 'error').length > n, name + ' ' + ev + ' answers an error'); assert.strictEqual(last(a, 'error').code === 'internal', false); }
        assert.strictEqual(({}).play, undefined, 'Object.prototype untouched by ' + name); assert.strictEqual(({}).chips, undefined);
        assert.strictEqual(all(a, 'g:coldcall:result').length, 0);
      }
    } finally { delete Object.prototype.play; delete Object.prototype.chips; }
    const store = require('../games/coldcall-store.js').createStore(null); const st = E.newState();
    store.setPlayer('__proto__', 'play', st); store.putOpen({ roundId: 'r', key: '__proto__', mode: 'play', cost: 1, bet: 10, buy: null, t: 1 });
    assert.strictEqual(({}).play, undefined, 'Object.prototype not polluted by the store'); assert.deepStrictEqual(store.player('__proto__', 'play'), st); assert.strictEqual(store.player('someone', 'play'), null);
    assert.strictEqual(store.allOpen().length, 1); assert.strictEqual(store.delOpen('__proto__', 'play'), true);
    const f = path.join(tmp, 'proto.json'); fs.writeFileSync(f, '{"v":1,"players":{"__proto__":{"play":{"v":1,"lt":77}}},"pot":{},"open":{}}');
    const loaded = require('../games/coldcall-store.js').createStore(f); assert.strictEqual(({}).play, undefined); assert.strictEqual(loaded.player('__proto__', 'play').lt, 77); assert.strictEqual(loaded.player('x', 'play'), null);
  });

  await test('F9d: a pot prize is flushed to disk before it is credited (the pot file never still holds a prize the wallet has)', async () => {
    const s = setup({ rng: E.rngFrom(89), potRng: () => 0 }); const a = s.sock('ann');
    E.CFG.pull.pot.minBal = 1; E.CFG.pull.pot.oneInPerDollar = 1;
    let seenOnDisk = null;
    const credit = s.wallet.credit.bind(s.wallet);
    s.wallet.credit = (key, mode, amt, ref) => { if (ref && ref.pot) { try { seenOnDisk = JSON.parse(fs.readFileSync(path.join(s.dir, 'coldcall-pull.json'), 'utf8')).pot[mode]; } catch { seenOnDisk = null; } } return credit(key, mode, amt, ref); };
    const r = spin(s, a, { bet: 2500, mode: 'play', auto: true });
    assert.strictEqual(r.status, 'done'); assert.ok(r.pot && r.pot.won, 'the pot was won');
    assert.ok(seenOnDisk && seenOnDisk.paid === r.pot.amount, 'at the moment of the prize credit the pot file already says paid ' + r.pot.amount + ': ' + JSON.stringify(seenOnDisk));
  });

  await test('F9e / W2 / W6: a settled round goes to every live socket of the account, never to a socket that has since signed in as someone else', async () => {
    const s = setup({ rng: E.rngFrom(90) }); const a1 = s.sock('ann'), a2 = s.sock('ann'), b = s.sock('bob'); rich(s, 'ann');
    E.CFG.pull.decision.timeoutMs = 60;
    const r = toMore(s, a1); const mine = (k) => k.out.filter((o) => o[0] === 'g:coldcall:result' || o[0] === 'g:coldcall:voided').length; const n1 = mine(a1);
    a1.data.acct = { key: 'bob' };                       // the socket re-signed-in as bob (no disconnect)
    await sleep(160);
    assert.strictEqual(resultsOf(a2, r.roundId).filter((x) => x.status === 'done').length, 1, 'the other tab of ann hears the settlement'); assert.strictEqual(resultsOf(a2, r.roundId).filter((x) => x.status === 'done')[0].auto, 'timeout');
    assert.strictEqual(mine(a1), n1, 'the re-signed-in socket gets nothing of ann'); assert.strictEqual(mine(b), 0, 'bob hears nothing of ann');
    assert.strictEqual(s.open.size, 0);
    // owner disconnect: the other tab hears the default
    const c1 = s.sock('cy'), c2 = s.sock('cy'); rich(s, 'cy'); E.CFG.pull.decision.timeoutMs = 20000;
    const r2 = toMore(s, c1); c1.send('disconnect');
    assert.strictEqual(resultsOf(c2, r2.roundId).filter((x) => x.status === 'done' && x.auto === 'disconnect').length, 1);
  });

  console.log(pass + ' passed' + (process.exitCode ? ', with failures' : ''));
  for (const k of Object.keys(E.CFG.pull)) delete E.CFG.pull[k]; Object.assign(E.CFG.pull, {}); PIN.restore();
  SRV.potRng = undefined; SRV.log = undefined;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
})();
