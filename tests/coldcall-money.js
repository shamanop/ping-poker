'use strict';
// node tests/coldcall-money.js  (self-contained: a real ledger on a temp dir through tests/lib-coldcall-ledger.js, fake io, no network, no server)
// P6 W2-d: COLD CALL on the one money system (ctx.money). Each test below is named for the rule it proves:
//   RULE 1  only a PLAIN paid spin feeds, rolls for or wins the office pot (a buy and a Callback never pass a pool field and never draw potRng)
//   RULE 2  a Callback that pays 0, then a crash, cannot be rolled again (the tape is on disk before anything else happens; recover() replays THAT tape)
//   CRASH   a paid round with a decision open, killed at each point between the ledger calls and the state flush
//   THROW   a money call that throws never produces a result; the round stays open when the ledger said `internal`
//   POT     the prize is pool -> player in the batch of the stake; the pool is never asked for more than it holds; conservation over a mixed run
//   NO WALLET  the slot's source has no wallet and no direct ledger / service call
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coldcall-money-'));
delete process.env.COLDCALL_PULL_FILE;
const H = require('./lib-coldcall-ledger.js');
const E = require('../games/coldcall-engine.js');
require('./lib-pull-pin.js').pin(E);   // mechanism tests run on fixed knob numbers
const SRV = require('../games/coldcall.js');

const clone = (o) => JSON.parse(JSON.stringify(o));
const BASE = clone(E.CFG.pull); BASE.on = true;
const resetCfg = () => { for (const k of Object.keys(E.CFG.pull)) delete E.CFG.pull[k]; Object.assign(E.CFG.pull, clone(BASE)); };
const last = H.last, all = H.all, spin = H.spin, decide = H.decide, play = H.play, toPending = H.toPending;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function setup(opts = {}) { resetCfg(); SRV._history.clear(); return H.world({ dir: opts.dir || fs.mkdtempSync(path.join(tmp, 's')), rng: opts.rng, roundRng: opts.roundRng, potRng: opts.potRng, log: opts.log, t: opts.t }); }

let pass = 0;
const test = async (name, fn) => { try { await fn(); pass++; console.log('ok   ' + name); } catch (e) { console.error('FAIL ' + name + '\n' + (e.stack || e)); process.exitCode = 1; } };

// a seed whose first round, on a mirror engine, satisfies pred (the mirror sees what the server will: same engine, same config, same first draws)
function findSeed(input, pred, from = 1) {
  for (let seed = from; seed < from + 4000; seed++) {
    const r = E.playRound(E.rngFrom(seed), { script: false, now: 1000200, day: '1970-01-01', rnd: E.rngFrom(5), ...input, state: input.state ? clone(input.state) : E.newState() }, []);
    if (pred(r)) return { seed, r };
  }
  throw new Error('no seed found');
}
const CB = (bet) => ({ ...E.newState(), cb: { bet } });
const countingRng = (seed) => { const base = E.rngFrom(seed); const f = () => { f.draws++; return base(); }; f.draws = 0; return f; };
const closeLines = (s, id, key = 'ann') => s.lines((e) => e.ref === `coldcall:${key}:${id}:close`);
const sum = (lines, reason) => lines.filter((e) => e.reason === reason).reduce((n, e) => n + e.amount, 0);
// audit() (the slot's own state) against the ledger: every escrow listed, every listed round escrowed, the pool numbers equal
function auditMatches(s) {
  const a = s.audit(), key = (r) => `${r.key}|${r.cur}|${r.roundId}|${r.amount}`;
  const ledger = s.escrows().map((x) => { const [, , key, roundId] = x.account.split(':'); return { key, cur: x.cur, roundId, amount: x.balance }; });
  assert.deepStrictEqual(a.openRounds.map(key).sort(), ledger.map(key).sort(), 'audit().openRounds = the escrows in the ledger');
  assert.deepStrictEqual(a.pools, { office: { chips: s.pool('chips'), play: s.pool('play') } }, 'audit().pools = the pool balances in the ledger');
}

(async () => {
  // ---------------------------------------------------------------- RULE 1
  await test('RULE 1: every buy kind and a Callback, at 1c / $1 / $25 in both currencies, with the pot roll forced to hit on a funded pool: the ledger batch has no pool leg, pool:coldcall:office does not move, potRng is not drawn; a plain paid spin on the same setup feeds and wins', async () => {
    let checked = 0;
    for (const mode of ['play', 'chips']) for (const bet of [1, 100, 2500]) for (const kind of ['call', 'bonus1', 'bonus2', 'hunt', 'callback']) {
      let draws = 0;
      const s = setup({ rng: E.rngFrom(900 + bet + checked), potRng: () => { draws++; return 0; }, roundRng: E.rngFrom(bet + 31) }); const a = s.sock('ann');
      s.rich('ann', mode); s.seedPool(mode, 7000); E.CFG.pull.pot.capCents = 5000;
      const pool0 = s.pool(mode), tag = `${mode} ${kind} ${bet}c`;
      let r;
      if (kind === 'callback') { s.store().setPlayer('ann', mode, CB(bet)); r = play(s, a, { bet: 10, mode }); assert.strictEqual(r.callback, true, tag); assert.strictEqual(r.cost, 0, tag); }
      else { r = play(s, a, { bet, mode, buyBonus: kind }); assert.strictEqual(r.buyBonus, kind, tag); assert.ok(r.cost > 0, tag); }
      assert.strictEqual(r.status, 'done', tag); assert.strictEqual(r.pot, null, tag + ': no pot in the result');
      const lines = s.lines((e) => e.ref.startsWith(`coldcall:ann:${r.roundId}`));
      assert.ok(lines.length >= 1 || r.totalWin === 0 && kind === 'callback', tag + ': the round is in the ledger');
      assert.ok(lines.every((e) => !/feed|prize/.test(e.reason) && !e.from.startsWith('pool:') && !e.to.startsWith('pool:')), tag + ': no pool leg in the batch: ' + JSON.stringify(lines.map((e) => [e.reason, e.from, e.to])));
      assert.strictEqual(s.pool(mode), pool0, tag + ': the pool did not move'); assert.strictEqual(draws, 0, tag + ': potRng was not drawn');
      assert.strictEqual(s.potOf(mode).paid, 0); assert.strictEqual(s.potOf(mode).fed, 7000, tag + ': statistics did not move either');
      // the same setup, a plain paid spin: it feeds and it wins (guard against over-fixing)
      const q = play(s, a, { bet, mode, auto: true });
      assert.strictEqual(q.callback, false, tag + ' control'); assert.ok(q.pot && q.pot.won && q.pot.amount === 5000, tag + ' control: the plain spin won the capped pot ' + JSON.stringify(q.pot)); assert.ok(draws >= 1, 'potRng drawn by the plain spin');
      const ql = s.lines((e) => e.ref === `coldcall:ann:${q.roundId}`); const feed = sum(ql, 'coldcall:feed'), prize = sum(ql, 'coldcall:prize');
      assert.strictEqual(prize, 5000); assert.strictEqual(feed, Math.floor(q.cost * E.CFG.pull.pot.feedBps / 10000), tag + ' control: it fed its slice (the remainder stays in the game file)'); assert.strictEqual(s.pool(mode), pool0 + feed - prize);
      checked++;
    }
    assert.strictEqual(checked, 30);
  });

  // ---------------------------------------------------------------- RULE 2
  const CASES = [{ name: 'pays 0', want: (r) => r.status === 'done' && r.pay.win === 0 }, { name: 'pays W > 0', want: (r) => r.status === 'done' && r.pay.win > 0 }];
  for (const c of CASES) for (const point of ['before', 'after']) {
    await test(`RULE 2: a Callback that ${c.name}, crash ${point === 'before' ? '(a) after the record flush and before the money call' : '(b) after the money call and before the state flush'}: the reboot draws nothing from the module rng, consumes the Callback, ${c.name === 'pays 0' ? 'balance unchanged, the next spin is a paid spin' : 'pays W exactly once (one :close)'}`, async () => {
      const { seed, r: mirror } = findSeed({ buy: null, bet: 100, state: CB(100), auto: true }, c.want), W = mirror.pay.win;
      const rng = countingRng(seed);
      const s = setup({ rng, roundRng: E.rngFrom(5) }); const a = s.sock('ann');
      s.store().setPlayer('ann', 'play', CB(100)); s.flush();
      const before = s.bal('ann', 'play');
      if (point === 'before') s.hooks.before.settle = () => { throw new H.Crash(); }; else s.hooks.after.settle = () => { throw new H.Crash(); };
      const r = spin(s, a, { bet: 100, mode: 'play', auto: true });
      assert.ok(r.error, 'the module saw its money call fail: no result for the player'); assert.strictEqual(all(a, 'g:coldcall:result').length, 0);
      const rolled = rng.draws; assert.ok(rolled > 0, 'the Callback was rolled');
      const rec = s.disk().open['ann|play']; assert.ok(rec && rec.callback === true && rec.cost === 0, 'the open record is on disk before anything else happened'); assert.strictEqual(rec.tape.length, rolled, 'with the whole tape of what was rolled');
      const id = rec.roundId; assert.ok(/^cb/.test(id), 'a Callback round id is cb + the id of the arming round: ' + id);
      s.reboot();
      assert.strictEqual(rng.draws, rolled, 'recover() replayed the stored tape and drew nothing new from the module rng');
      assert.strictEqual(s.store().player('ann', 'play').cb, null, 'the Callback is consumed'); assert.strictEqual(s.store().allOpen().length, 0, 'the record is gone');
      const paid = sum(closeLines(s, id), 'coldcall:credit');
      if (W === 0) { assert.strictEqual(s.bal('ann', 'play'), before); assert.strictEqual(closeLines(s, id).length, 0, 'a free round that paid 0 leaves no ledger line'); }
      else { assert.strictEqual(paid, W, 'W paid exactly once'); assert.strictEqual(new Set(closeLines(s, id).map((e) => e.id)).size, 1, 'one :close batch'); assert.strictEqual(s.bal('ann', 'play'), before + W); }
      const n = spin(s, s.sock('ann'), { bet: 100, mode: 'play', auto: true }); assert.strictEqual(n.callback, false, 'the next spin is a paid spin'); assert.strictEqual(n.cost, 100);
      const id2 = s.lastId(); s.reboot(); assert.strictEqual(s.lastId(), id2, 'a second reboot writes nothing'); assert.strictEqual(rng.draws, rng.draws);
    });
  }

  await test('RULE 2: record and state lost but the ledger paid (the record deleted, the old state restored): the replay answers round_closed (or dup), pays nothing, consumes the Callback', async () => {
    const { seed, r: mirror } = findSeed({ buy: null, bet: 100, state: CB(100), auto: true }, (r) => r.status === 'done' && r.pay.win > 0), W = mirror.pay.win;
    const rng = countingRng(seed);
    const s = setup({ rng, roundRng: E.rngFrom(5) }); const a = s.sock('ann');
    s.store().setPlayer('ann', 'play', CB(100)); s.flush();
    const before = s.bal('ann', 'play');
    s.hooks.after.settle = () => { throw new H.Crash(); };
    spin(s, a, { bet: 100, mode: 'play', auto: true });
    const disk = s.disk(), id = disk.open['ann|play'].roundId;
    assert.strictEqual(s.bal('ann', 'play'), before + W, 'the ledger paid');
    s.crash();
    delete disk.open['ann|play']; disk.players.ann.play = { ...CB(100), cb: { bet: 100, id } };      // the record and the new state never reached the disk: the old state, with the Callback armed under the same id
    fs.writeFileSync(s.files.pull, JSON.stringify(disk));
    s.boot();
    assert.strictEqual(s.store().player('ann', 'play').cb.id, id, 'the Callback is armed again, same id');
    const b = s.sock('ann'), r = spin(s, b, { bet: 100, mode: 'play', auto: true });
    if (r.error) assert.strictEqual(r.error.code, 'round_closed'); else assert.strictEqual(r.totalWin, W, 'an identical roll is a dup: the same result');
    assert.strictEqual(s.bal('ann', 'play'), before + W, 'nothing was paid a second time'); assert.strictEqual(sum(closeLines(s, id), 'coldcall:credit'), W); assert.strictEqual(new Set(closeLines(s, id).map((e) => e.id)).size, 1);
    assert.strictEqual(s.store().player('ann', 'play').cb, null, 'the Callback is consumed'); assert.strictEqual(s.store().allOpen().length, 0);
    const n = spin(s, b, { bet: 100, mode: 'play', auto: true }); assert.strictEqual(n.callback, false, 'and the next spin is a paid spin');
  });

  await test('RULE 2: the Callback id is on the entitlement: written when the round arms it, flushed with the state, never in a client view; an old state without an id is given one and flushed before the Callback may be played', async () => {
    const s = setup({ rng: E.rngFrom(66), roundRng: E.rngFrom(67) }); const a = s.sock('ann'); s.rich('ann', 'play');
    E.CFG.pull.list = 5;
    let armed = null, round = null;
    for (let i = 0; i < 60 && !armed; i++) { const r = spin(s, a, { bet: 100, mode: 'play', auto: true }); assert.ok(!r.error); if (r.pull.armed) { armed = r; round = r.roundId; } }
    assert.ok(armed, 'a spin armed the Callback'); s.flush();
    const st = s.disk().players.ann.play; assert.strictEqual(st.cb.id, 'cb' + round, 'cb.id = cb + the id of the round that armed it, on disk with the state');
    assert.deepStrictEqual(armed.pull.state.cb, { bet: 100 }, 'the result view has no id'); a.send('g:coldcall:state'); assert.deepStrictEqual(last(a, 'g:coldcall:state').pull.play.cb, { bet: 100 });
    assert.ok(!JSON.stringify(all(a, 'g:coldcall:result')).includes('"cb' + round), 'no payload carries the id');
    const cbr = spin(s, a, { bet: 10, mode: 'play', auto: true }); assert.strictEqual(cbr.callback, true); assert.strictEqual(cbr.roundId, 'cb' + round, 'the Callback is played under that id');
    assert.ok(s.has(`coldcall:ann:cb${round}:close`) || cbr.totalWin === 0, 'its win (if any) is under that round id');
    // an old file: cb without an id
    const s2 = setup({ rng: E.rngFrom(68), roundRng: E.rngFrom(69) }); const b = s2.sock('bo'); s2.rich('bo', 'play');
    s2.store().setPlayer('bo', 'play', CB(100)); assert.strictEqual(s2.store().player('bo', 'play').cb.id, undefined);
    const r = spin(s2, b, { bet: 10, mode: 'play', auto: true }); assert.strictEqual(r.callback, true); assert.ok(/^cb[0-9a-f]{12}$/.test(r.roundId), 'a new id: ' + r.roundId);
  });

  // ---------------------------------------------------------------- CRASH WALK on a paid round with a decision open
  const PEND = findSeed({ buy: 'bonus1', bet: 100, auto: false }, (r) => r.status === 'pending');
  const wantWin = findSeed({ buy: 'bonus1', bet: 100, auto: true }, () => true, PEND.seed);   // the default-settle of the same seed: the numbers a timeout pays
  const defaultWin = E.playRound(E.rngFrom(PEND.seed), { buy: 'bonus1', bet: 100, state: E.newState(), now: 1000200, day: '1970-01-01', script: false, auto: true, rnd: E.rngFrom(5) }, []).pay.win;
  void wantWin;
  const afterEach = (s, tag, before, cost, win) => {
    assert.deepStrictEqual(s.escrows(), [], tag + ': every escrow of the game is 0'); auditMatches(s);
    assert.strictEqual(s.bal('ann', 'play'), before - cost + win, tag + ': balance'); assert.strictEqual(s.store().allOpen().length, 0, tag + ': no record left');
    const id = s.lastId(); s.reboot(); assert.strictEqual(s.lastId(), id, tag + ': a second boot writes no ledger line'); assert.deepStrictEqual(s.escrows(), []);
  };
  await test('CRASH 1: killed after `open` and before the record flush: boot has an escrow and no record, the registry voids it (the stake is back), nothing else moves', async () => {
    const s = setup({ rng: E.rngFrom(PEND.seed), roundRng: E.rngFrom(5) }); const a = s.sock('ann'); const before = s.bal('ann', 'play');
    s.hooks.after.open = () => { throw new H.Crash(); };
    const r = spin(s, a, { bet: 100, mode: 'play', buyBonus: 'bonus1' }); assert.ok(r.error, 'the client got an error, never a pending result'); assert.strictEqual(all(a, 'g:coldcall:result').length, 0);
    assert.strictEqual(s.escrowSum('play'), 100 * E.CFG.buyCost.bonus1 / 10, 'the stake is in escrow'); assert.ok(!s.disk() || Object.keys(s.disk().open).length === 0, 'and no record reached the disk');
    s.reboot();
    assert.strictEqual(s.report.voided.length, 1, 'the registry voided the orphan escrow'); assert.strictEqual(s.bal('ann', 'play'), before, 'stake back');
    afterEach(s, 'CRASH 1', before, 0, 0);
  });
  await test('CRASH 2: killed after the record flush (a decision is open): boot settles it as the timeout would, the default win is paid ONCE (D1)', async () => {
    const s = setup({ rng: E.rngFrom(PEND.seed), roundRng: E.rngFrom(5) }); const a = s.sock('ann'); const before = s.bal('ann', 'play');
    const r = spin(s, a, { bet: 100, mode: 'play', buyBonus: 'bonus1' }); assert.strictEqual(r.status, 'pending'); const cost = r.cost; auditMatches(s);
    assert.strictEqual(s.escrowSum('play'), cost);
    s.reboot();
    assert.strictEqual(s.report.games.coldcall.settledOrVoidedByGame, 1); assert.deepStrictEqual(s.report.voided, []);
    assert.strictEqual(closeLines(s, r.roundId).filter((e) => e.reason === 'coldcall:credit').reduce((n, e) => n + e.amount, 0), defaultWin, 'the default win, in one :close batch');
    afterEach(s, 'CRASH 2', before, cost, defaultWin);
  });
  for (const take of [false, true]) {
    await test(`CRASH 3: killed after \`settle\` and before the state flush (the player ${take ? 'took the gamble' : 'banked'}): boot answers ${take ? 'round_closed' : 'dup'}, nothing is paid twice, the record is gone`, async () => {
      const s = setup({ rng: E.rngFrom(PEND.seed), roundRng: E.rngFrom(5) }); const a = s.sock('ann'); const before = s.bal('ann', 'play');
      let r = spin(s, a, { bet: 100, mode: 'play', buyBonus: 'bonus1' }); assert.strictEqual(r.status, 'pending'); const cost = r.cost;
      // answer every decision with the default (first square, bank), except the last one, which is the player's: taken or banked
      let settled = null; s.hooks.after.settle = (args, res) => { settled = args[3]; throw new H.Crash(); };
      let guard = 0;
      while (r.status === 'pending' && guard++ < 6) {
        const d = r.pending.k === 'pick' ? { k: 'pick', p: r.pending.choices[0] } : { k: 'more', take };
        a.send('g:coldcall:decide', { roundId: r.roundId, ...d });
        const rs = all(a, 'g:coldcall:result'); r = rs[rs.length - 1];
        if (settled) break;
      }
      assert.ok(settled, 'the ledger call was made'); const paid = settled.win;
      assert.strictEqual(s.bal('ann', 'play'), before - cost + paid, 'the ledger holds the player\'s choice'); assert.strictEqual(all(a, 'g:coldcall:result').filter((x) => x.status === 'done').length, 0, 'but no result reached the client');
      assert.strictEqual(Object.keys(s.disk().open).length, 1, 'the record is still on disk');
      s.reboot();
      assert.strictEqual(new Set(closeLines(s, r.roundId).map((e) => e.id)).size, 1, 'one :close batch, never two');
      assert.strictEqual(s.bal('ann', 'play'), before - cost + paid, 'the balance is what the first settle made it');
      afterEach(s, 'CRASH 3', before, cost, paid);
    });
  }

  // ---------------------------------------------------------------- a money call that throws
  await test('THROW: a money call that throws (funds, and a forced internal) never produces a g:coldcall:result; the round stays open on `internal` and finishes as a timeout', async () => {
    const funds = () => Object.assign(new Error('Not enough funds'), { code: 'funds' }), internal = () => Object.assign(new Error('Server error'), { code: 'internal' });
    // funds on the instant round, funds on open: an error, no result, no record, nothing moved
    for (const [call, payload] of [['round', { bet: 100, mode: 'play', auto: true }], ['open', { bet: 100, mode: 'play', buyBonus: 'bonus1' }]]) {
      const s = setup({ rng: E.rngFrom(PEND.seed), roundRng: E.rngFrom(5) }); const a = s.sock('ann'); const before = s.balances('ann'), id = s.lastId();
      s.hooks.before[call] = () => { throw funds(); };
      const r = spin(s, a, payload); assert.strictEqual(r.error.code, 'funds', call); assert.strictEqual(all(a, 'g:coldcall:result').length, 0, call + ': no result');
      assert.deepStrictEqual(s.balances('ann'), before); assert.strictEqual(s.lastId(), id); assert.strictEqual(s.open.size, 0); assert.strictEqual(s.store().allOpen().length, 0);
    }
    // internal on the settle of a decision: error, no result, the round is still open (record, escrow, timer), and the timeout settles it
    const s = setup({ rng: E.rngFrom(PEND.seed), roundRng: E.rngFrom(5) }); const a = s.sock('ann'); const before = s.bal('ann', 'play');
    E.CFG.pull.decision.timeoutMs = 40;
    let r = spin(s, a, { bet: 100, mode: 'play', buyBonus: 'bonus1' }); assert.strictEqual(r.status, 'pending'); const cost = r.cost;
    let fail = true; s.hooks.before.settle = () => { if (fail) throw internal(); };
    let guard = 0, errs = all(a, 'error').length;
    while (r.status === 'pending' && guard++ < 6 && all(a, 'error').length === errs) {
      const d = r.pending.k === 'pick' ? { k: 'pick', p: r.pending.choices[0] } : { k: 'more', take: false };
      a.send('g:coldcall:decide', { roundId: r.roundId, ...d }); const rs = all(a, 'g:coldcall:result'); r = rs[rs.length - 1];
    }
    assert.strictEqual(last(a, 'error').code, 'internal'); assert.strictEqual(all(a, 'g:coldcall:result').filter((x) => x.status === 'done').length, 0, 'no result for a round the ledger refused');
    assert.strictEqual(s.open.size, 1, 'the round is still open'); assert.strictEqual(s.store().allOpen().length, 1, 'its record is still stored'); assert.strictEqual(s.escrowSum('play'), cost, 'and its stake is still in escrow');
    assert.ok(s.open.get(r.roundId).timer, 'the timer is armed again');
    fail = false; await sleep(150);
    const done = all(a, 'g:coldcall:result').filter((x) => x.status === 'done'); assert.strictEqual(done.length, 1, 'the retry settled it once'); assert.strictEqual(done[0].auto, 'timeout');
    assert.strictEqual(s.bal('ann', 'play'), before - cost + done[0].totalWin); assert.deepStrictEqual(s.escrows(), []); assert.strictEqual(s.open.size, 0);
  });

  // ---------------------------------------------------------------- the pot
  await test('POT: the prize is pool -> player in the SAME batch as the stake; a prize can never exceed the pool (pool_short is not reachable from the slot\'s own arithmetic over a fuzz of pot states and knobs)', async () => {
    const rnd = E.rngFrom(4242); let hits = 0, spins = 0, empty = 0;
    for (const mode of ['play', 'chips']) {
      const s = setup({ rng: E.rngFrom(88), roundRng: E.rngFrom(89), potRng: () => (rnd() < 0.5 ? 0 : 1) }); const a = s.sock('ann'); s.rich('ann', mode);
      for (let i = 0; i < 500; i++) {
        const P = E.CFG.pull.pot;
        P.feedBps = [0, 1, 50, 100, 5000, 10000][rnd() * 6 | 0]; P.minBal = [0, 1, 1000, 1e6][rnd() * 4 | 0]; P.capCents = [0, 1, 300, 5000, 1e8][rnd() * 5 | 0]; P.oneInPerDollar = [0, 0.01, 1, 40, 3000][rnd() * 5 | 0];
        if (rnd() < 0.3) s.seedPool(mode, 1 + (rnd() * [10, 1000, 100000][rnd() * 3 | 0] | 0));
        const pool0 = s.pool(mode), bet = E.BET_LEVELS[rnd() * E.BET_LEVELS.length | 0];
        const r = spin(s, a, { bet, mode, auto: true });
        assert.ok(!r.error, `spin ${i} ${mode}: ${JSON.stringify(r.error)} (pool ${pool0}, knobs ${JSON.stringify(P)})`); assert.strictEqual(r.status, 'done'); spins++;
        const lines = s.lines((e) => e.ref === `coldcall:ann:${r.roundId}`); assert.strictEqual(new Set(lines.map((e) => e.id)).size, lines.length ? 1 : 0, 'one batch');
        const feed = sum(lines, 'coldcall:feed'), prize = sum(lines, 'coldcall:prize');
        assert.ok(prize <= pool0 + feed, 'the prize ' + prize + ' is within the pool ' + pool0 + ' after this batch\'s own feed ' + feed); assert.strictEqual(s.pool(mode), pool0 + feed - prize); assert.ok(s.pool(mode) >= 0);
        if (prize) { hits++; assert.strictEqual(r.pot.amount, prize); assert.ok(lines.find((e) => e.reason === 'coldcall:prize').from === 'pool:coldcall:office'); assert.strictEqual(sum(lines, 'coldcall:spend'), r.cost, 'the stake is in the same batch'); }
        if (pool0 === 0) empty++;
        assert.strictEqual(s.potOf(mode).bal, s.pool(mode), 'the mirror follows the ledger');
      }
    }
    assert.ok(hits >= 100 && empty >= 20, `the fuzz exercised prizes and empty pools: ${hits} / ${empty} of ${spins}`);
  });

  await test('POT: conservation over a mixed run of spins, buys, Callbacks, decisions, timeouts, disconnects and voids in both currencies: sum of all accounts per currency = 0 (mints on the other side), players + escrows + pool + house never changes, house + pool = what the players lost, every escrow back to 0', async () => {
    const s = setup({ rng: E.rngFrom(5150), roundRng: E.rngFrom(5151), potRng: E.rngFrom(5152) }); E.CFG.pull.pot.oneInPerDollar = 30; E.CFG.pull.pot.minBal = 1;
    const socks = { ann: s.sock('ann'), bo: s.sock('bo') }; const keys = ['ann', 'bo'];
    for (const k of keys) for (const m of ['play', 'chips']) s.fund(k, m, 50000);
    const held0 = { play: s.conservation('play').held, chips: s.conservation('chips').held }, players0 = { play: s.conservation('play').players, chips: s.conservation('chips').players };
    let steps = 0, voids = 0, callbacks = 0, timeouts = 0, disconnects = 0, decisions = 0;
    const BASEFEED = clone(E.CFG.pull.feed);
    for (let i = 0; i < 300; i++) {
      const k = keys[i % 2], sock = socks[k], mode = i % 3 === 0 ? 'chips' : 'play', bet = [1, 10, 100][i % 3];
      const kind = i % 10;
      if (kind === 3) { s.store().setPlayer(k, mode, CB(bet)); }
      if (kind === 5) E.CFG.pull.decision.timeoutMs = 30;
      if (kind === 7) delete E.CFG.pull.feed;                      // a snapshot with no feed block: the settle throws and the round is voided (the stake comes back, a Callback stays armed)
      let r;
      if (kind === 7) {                                            // the void path emits g:coldcall:voided (not a result): drive it by hand
        const nv = all(sock, 'g:coldcall:voided').length; s.clock.advance(200); sock.send('g:coldcall:spin', { bet, mode, buyBonus: i % 20 === 7 ? 'bonus1' : undefined });
        for (let j = 0; j < 6; j++) { const p = last(sock, 'g:coldcall:result'); if (all(sock, 'g:coldcall:voided').length > nv || !p || p.status !== 'pending' || s.open.size === 0) break; sock.send('g:coldcall:decide', { roundId: p.roundId, ...(p.pending.k === 'pick' ? { k: 'pick', p: p.pending.choices[0] } : { k: 'more', take: false }) }); }
        if (all(sock, 'g:coldcall:voided').length > nv) voids++;
        E.CFG.pull.feed = clone(BASEFEED); steps++;
        for (const m of ['play', 'chips']) { const c = s.conservation(m); assert.strictEqual(c.held, held0[m], `step ${i}: constant after a void (${m})`); }
        continue;
      }
      r = spin(s, sock, { bet, mode, buyBonus: kind % 4 === 1 ? 'bonus1' : kind === 6 ? 'bonus2' : undefined });
      if (r.error) { assert.ok(['rate', 'funds', 'decision_open'].includes(r.error.code), JSON.stringify(r.error)); continue; }
      if (r.callback) callbacks++;
      const n = all(sock, 'g:coldcall:voided').length;
      if (r.status === 'pending') {
        if (kind === 5) { s.clock.advance(100); sock.send('g:coldcall:ready', { roundId: r.roundId }); await sleep(80); timeouts++; }
        else if (kind === 9) { sock.send('disconnect'); disconnects++; }
        else { let j = 0; while (r.status === 'pending') { r = decide(s, sock, r, H.policy(i + j++, r.pending)); decisions++; if (r.status !== 'pending') break; } }
      }
      if (all(sock, 'g:coldcall:voided').length > n) voids++;
      if (kind === 7) E.CFG.pull.feed = clone(BASEFEED);
      if (kind === 5) E.CFG.pull.decision.timeoutMs = BASE.decision.timeoutMs;
      steps++;
      for (const m of ['play', 'chips']) { const c = s.conservation(m); assert.strictEqual(c.held, held0[m], `step ${i}: players + escrows + pool + house is constant (${m})`); assert.strictEqual(c.everything, 0); }
    }
    for (const sock of Object.values(socks)) sock.send('disconnect');
    await sleep(60);
    for (const m of ['play', 'chips']) {
      const c = s.conservation(m);
      assert.strictEqual(c.escrows, 0, m + ': every escrow is back to 0'); assert.strictEqual(c.held, held0[m]); assert.strictEqual(c.house + c.pool + (c.players - players0[m]), 0, m + ': house + pool = what the players lost');
      assert.strictEqual(s.potOf(m).bal, s.pool(m), m + ': the mirror is the ledger pool');
    }
    auditMatches(s);
    assert.ok(steps > 200 && voids >= 3 && callbacks >= 5 && timeouts >= 5 && disconnects >= 5 && decisions >= 10, [steps, voids, callbacks, timeouts, disconnects, decisions].join());
  });

  // ---------------------------------------------------------------- no wallet
  await test('NO WALLET: the slot\'s ctx has no wallet, and games/coldcall.js makes no wallet call and no direct ledger / service call', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'games', 'coldcall.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/\/\/.*$/gm, '');
    assert.ok(!/wallet\.spend|wallet\.credit|ctx\.wallet|C\.wallet/.test(src), 'a wallet call is left in games/coldcall.js');
    assert.ok(!/\b(ledger|service)\s*\.\s*\w+\s*\(/.test(src), 'a direct ledger / service call is left in games/coldcall.js');
    assert.ok(!/require\([^)]*(wallet|ledger|money)/.test(src), 'the slot requires no wallet / ledger / money module');
    const s = setup({ rng: E.rngFrom(1) }); let seen = null;
    const probe = { id: 'coldcall', name: 'probe', kind: 'solo', init(ctx) { seen = ctx; }, handlers: {} };
    require('../games')({ io: null, wallet: s.wallet, money: { forGame: () => s.money }, service: s.service, modules: [probe] });
    assert.ok(seen && seen.money, 'the module got ctx.money'); assert.ok(!('wallet' in seen), 'no ctx.wallet for a game that is not Bender'); assert.ok(!('service' in seen), 'and not the raw service: ' + Object.keys(seen).join());
  });

  console.log(pass + ' passed' + (process.exitCode ? ', with failures' : ''));
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
})();
