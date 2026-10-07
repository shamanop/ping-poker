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
const diskHas = (s, key = 'ann|play') => !!((s.disk() || {}).open || {})[key];       // the open record as the NEXT boot would read it (the game's file, not memory)
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
    await test(`CRASH 3: killed after \`settle\` and before the state flush (the player ${take ? 'took the gamble' : 'banked'}): boot replays the player\'s own answer, so the ledger answers dup (never round_closed), nothing is paid twice, the record is gone`, async () => {
      const logs = []; const s = setup({ rng: E.rngFrom(PEND.seed), roundRng: E.rngFrom(5), log: (...x) => logs.push(x.join(' ')) }); const a = s.sock('ann'); const before = s.bal('ann', 'play');
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
      assert.strictEqual(s.disk().open['ann|play'].decisions.slice(-1)[0].k, 'more', 'the record holds the final answer'); assert.strictEqual(s.disk().open['ann|play'].decisions.slice(-1)[0].take, take);
      logs.length = 0; s.reboot();
      assert.ok(!logs.some((l) => /already played/.test(l)), 'boot got a dup, not a round_closed: ' + logs.join(' | '));
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

  // ---------------------------------------------------------------- P6 W3b slot (a): a LIVE stake_mismatch is voided once, as boot does
  // The escrow of an open round is tampered with (a part of it moved back to the player by a line the slot did not write), so settle(stake: cost) answers stake_mismatch. Retrying can never fix that.
  const tamper = (s, id, n = 5) => s.ledger.transfer(`escrow:coldcall:ann:${id}`, 'play:ann', n, 'play', 'test:tamper', 'tamper:' + id);
  for (const via of ['timeout', 'decision']) {
    await test(`W3B (a): a live stake_mismatch on the ${via} voids the round ONCE: the escrow goes back, g:coldcall:voided is sent, no timer is left, no result, and the next spin works`, async () => {
      const s = setup({ rng: E.rngFrom(PEND.seed), roundRng: E.rngFrom(5) }); const a = s.sock('ann'); const before = s.bal('ann', 'play');
      E.CFG.pull.decision.timeoutMs = 40;
      const r = spin(s, a, { bet: 100, mode: 'play', buyBonus: 'bonus1' }); assert.strictEqual(r.status, 'pending'); const cost = r.cost;
      tamper(s, r.roundId); const kept = s.escrowSum('play'); assert.strictEqual(kept, cost - 5, 'the escrow no longer holds the stake');
      let settles = 0;
      s.hooks.before.settle = () => { settles++; };
      const id0 = s.lastId();
      if (via === 'timeout') { s.clock.advance(200); a.send('g:coldcall:ready', { roundId: r.roundId }); await sleep(150); }
      else a.send('g:coldcall:decide', { roundId: r.roundId, ...(r.pending.k === 'pick' ? { k: 'pick', p: r.pending.choices[0] } : { k: 'more', take: false }) });
      // a decision that keeps the round open (a PICK followed by ONE MORE CALL) is answered by the next prompt: finish it the same way until the settle is refused
      let guard = 0; while (!all(a, 'g:coldcall:voided').length && s.open.size && guard++ < 4) { const rs = all(a, 'g:coldcall:result'); const p = rs[rs.length - 1]; if (!p || p.status !== 'pending') break; a.send('g:coldcall:decide', { roundId: r.roundId, ...(p.pending.k === 'pick' ? { k: 'pick', p: p.pending.choices[0] } : { k: 'more', take: false }) }); }
      await sleep(150);
      const vs = all(a, 'g:coldcall:voided'); assert.strictEqual(vs.length, 1, 'g:coldcall:voided was sent once: ' + JSON.stringify(vs)); assert.strictEqual(vs[0].roundId, r.roundId); assert.strictEqual(vs[0].reason, 'unresolvable'); assert.strictEqual(vs[0].refund, kept, 'refund = what the ledger returned (the escrow as it was, not the recorded cost)');
      assert.strictEqual(all(a, 'g:coldcall:result').filter((x) => x.status === 'done').length, 0, 'no result for a round the ledger refused to settle');
      assert.deepStrictEqual(s.escrows(), [], 'the escrow is back with the player'); assert.strictEqual(s.bal('ann', 'play'), before, 'whole stake back (the 5 moved by hand included)');
      assert.strictEqual(s.open.size, 0, 'the round is gone'); assert.strictEqual(s.store().allOpen().length, 0, 'its record is gone'); assert.strictEqual(s.disk() && Object.keys(s.disk().open || {}).length, 0);
      assert.strictEqual(closeLines(s, r.roundId).filter((e) => e.reason === 'coldcall:void:unresolvable' || /void/.test(e.reason)).reduce((n, e) => n + e.amount, 0), kept, 'ONE void line returned the escrow');
      const idAfter = s.lastId(), settlesAfter = settles; await sleep(200);
      assert.strictEqual(s.lastId(), idAfter, 'no later retry wrote anything'); assert.strictEqual(settles, settlesAfter, 'and nothing asked the ledger to settle it again: the timer is gone');
      assert.strictEqual(all(a, 'g:coldcall:voided').length, 1, 'still one voided'); assert.ok(id0 <= idAfter);
      const n = spin(s, a, { bet: 100, mode: 'play', auto: true }); assert.strictEqual(n.status, 'done', 'the next spin works'); auditMatches(s);
    });
  }
  await test('W3B (a): any OTHER money error on a live settle (disk, fence) keeps the round open with its timer, as before; only stake_mismatch voids', async () => {
    for (const code of ['internal', 'io_error', 'fence']) {
      const s = setup({ rng: E.rngFrom(PEND.seed), roundRng: E.rngFrom(5) }); const a = s.sock('ann');
      E.CFG.pull.decision.timeoutMs = 40;
      const r = spin(s, a, { bet: 100, mode: 'play', buyBonus: 'bonus1' }); assert.strictEqual(r.status, 'pending'); const cost = r.cost;
      let n = 0; s.hooks.before.settle = () => { n++; throw Object.assign(new Error('refused'), { code }); };
      s.clock.advance(200); a.send('g:coldcall:ready', { roundId: r.roundId }); await sleep(150);
      assert.ok(n >= 2, code + ': it keeps trying as a timeout (' + n + ' tries)'); assert.strictEqual(all(a, 'g:coldcall:voided').length, 0, code + ': not voided');
      assert.strictEqual(s.open.size, 1, code + ': still open'); assert.strictEqual(s.escrowSum('play'), cost, code + ': stake still in escrow'); assert.ok(s.open.get(r.roundId).timer, code + ': timer armed');
      delete s.hooks.before.settle; await sleep(120);
      assert.strictEqual(all(a, 'g:coldcall:result').filter((x) => x.status === 'done').length, 1, code + ': once the ledger works it settles'); assert.strictEqual(s.open.size, 0); assert.strictEqual(s.escrowSum('play'), 0);
    }
  });

  // ---------------------------------------------------------------- P6 W3b slot (b): g:coldcall:voided.refund is what the ledger returned
  await test('W3B (b): refund is the escrow the ledger gave back for an open paid round, and 0 for an instant round that was never charged and for a Callback; payload shape unchanged', async () => {
    const SHAPE = ['mode', 'reason', 'refund', 'roundId', 'wallet'];
    // an open paid round voided (the record cannot be written: open_error): the whole stake comes back, refund = the stake
    { const s = setup({ rng: E.rngFrom(PEND.seed), roundRng: E.rngFrom(5) }); const a = s.sock('ann'); const before = s.bal('ann', 'play');
      const st = s.store(); st.putOpen = () => { throw new Error('disk gone'); };
      s.clock.advance(200); a.send('g:coldcall:spin', { bet: 100, mode: 'play', buyBonus: 'bonus1' });
      const v = last(a, 'g:coldcall:voided'); assert.ok(v && v.reason === 'open_error', 'voided: ' + JSON.stringify(v));
      const cost = 100 * E.CFG.buyCost.bonus1 / 10; assert.strictEqual(cost, s.lines((e) => e.reason === 'coldcall:void:open_error' || /void/.test(e.reason)).reduce((n, e) => n + e.amount, 0), 'the ledger returned the stake');
      assert.strictEqual(v.refund, cost, 'refund = the escrowed stake'); assert.strictEqual(s.bal('ann', 'play'), before); assert.deepStrictEqual(Object.keys(v).sort(), SHAPE.slice().sort()); }
    // an instant paid round that dies before the ledger (settle_error): never charged, nothing returned: refund 0, no ledger line, the balance untouched
    { const s = setup({ rng: E.rngFrom(82) }); const a = s.sock('ann'); const before = s.bal('ann', 'play'), id = s.lastId();
      delete E.CFG.pull.pot;
      s.clock.advance(200); a.send('g:coldcall:spin', { bet: 2500, mode: 'play' });
      const v = last(a, 'g:coldcall:voided'); assert.ok(v && v.reason === 'settle_error', 'voided: ' + JSON.stringify(v));
      assert.strictEqual(v.refund, 0, 'nothing was charged, nothing was returned'); assert.strictEqual(s.lastId(), id, 'no ledger line'); assert.strictEqual(s.bal('ann', 'play'), before); assert.deepStrictEqual(Object.keys(v).sort(), SHAPE.slice().sort()); }
    // a Callback voided (settle_error on its own settle): it has no escrow, refund 0, the entitlement stays armed
    { const s = setup({ rng: E.rngFrom(82) }); const a = s.sock('ann'); const before = s.balances('ann');
      s.store().setPlayer('ann', 'chips', { ...E.newState(), cb: { bet: 100, id: 'cbvoid1' } }); s.flush();
      delete E.CFG.pull.feed; const id = s.lastId();
      s.clock.advance(200); a.send('g:coldcall:spin', { bet: 100, mode: 'chips', auto: true });
      const v = last(a, 'g:coldcall:voided'); assert.ok(v && v.reason === 'settle_error' && v.roundId === 'cbvoid1', 'voided: ' + JSON.stringify(v));
      assert.strictEqual(v.refund, 0, 'a Callback has no stake'); assert.strictEqual(s.lastId(), id, 'no ledger line'); assert.deepStrictEqual(s.balances('ann'), before); assert.ok(s.store().player('ann', 'chips').cb, 'still armed'); assert.deepStrictEqual(Object.keys(v).sort(), SHAPE.slice().sort()); }
  });

  // ---------------------------------------------------------------- the game's own file
  await test('FILE: a store write that fails is told to the caller (audit finding 14): a paid round that cannot flush its record is voided (stake back), a Callback that cannot flush its record plays nothing and stays armed', async () => {
    const s = setup({ rng: E.rngFrom(PEND.seed), roundRng: E.rngFrom(5) }); const a = s.sock('ann'); const before = s.bal('ann', 'play');
    s.store().setPlayer('ann', 'chips', { ...E.newState(), cb: { bet: 100, id: 'cbtest1' } }); s.flush();
    fs.mkdirSync(s.files.pull + '.tmp');                              // the disk refuses every write from here on
    s.store().potChanged(); assert.throws(() => s.flush(), 'flush() throws when the write failed'); assert.throws(() => s.flush(), 'and keeps throwing until a write succeeds');
    s.clock.advance(200); a.send('g:coldcall:spin', { bet: 100, mode: 'play', buyBonus: 'bonus1' }); let r;
    assert.strictEqual(all(a, 'g:coldcall:result').length, 0, 'no pending result without a record on disk'); const v = last(a, 'g:coldcall:voided'); assert.ok(v && v.reason === 'open_error', 'voided: ' + JSON.stringify(v));
    assert.strictEqual(s.bal('ann', 'play'), before, 'the stake is back'); assert.deepStrictEqual(s.escrows(), []); assert.strictEqual(s.open.size, 0);
    const id = s.lastId(), draws = []; r = spin(s, a, { bet: 100, mode: 'chips', auto: true });
    assert.ok(r.error, 'the Callback is not played when its record cannot be written'); assert.strictEqual(all(a, 'g:coldcall:result').length, 0); assert.strictEqual(s.lastId(), id, 'and no ledger line was written'); assert.ok(s.store().player('ann', 'chips').cb, 'the entitlement is still armed'); assert.strictEqual(s.store().allOpen().length, 0); void draws;
    fs.rmdirSync(s.files.pull + '.tmp');
    const ok = spin(s, a, { bet: 100, mode: 'chips', auto: true }); assert.strictEqual(ok.status, 'done'); assert.strictEqual(ok.callback, true, 'once the disk works the Callback plays'); assert.strictEqual(ok.roundId, 'cbtest1');
  });

  await test('FILE: a corrupt or missing game file loses state, never money: the open stake comes back by the registry sweep, the pool (a ledger balance) is untouched', async () => {
    const s = setup({ rng: E.rngFrom(PEND.seed), roundRng: E.rngFrom(5) }); const a = s.sock('ann'); s.seedPool('play', 4000); const before = s.bal('ann', 'play'), pool = s.pool('play');
    const r = spin(s, a, { bet: 100, mode: 'play', buyBonus: 'bonus1' }); assert.strictEqual(r.status, 'pending'); assert.strictEqual(s.escrowSum('play'), r.cost);
    s.crash(); fs.writeFileSync(s.files.pull, '{ not json'); s.boot();
    assert.strictEqual(s.report.voided.length, 1, 'the registry returned the stake whose record was lost'); assert.strictEqual(s.bal('ann', 'play'), before, 'back to what it was before the spin'); assert.deepStrictEqual(s.escrows(), []); assert.strictEqual(s.pool('play'), pool, 'the pool is a ledger balance');
    assert.strictEqual(s.potOf('play').bal, pool, 'and the mirror is re-read from it'); auditMatches(s);
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

  // T1 (Opus re-check of FIX M1): an OPEN plain paid round takes its pot feed and its roll chance from its OWN snapshot, not from the live config
  await test('SNAPSHOT (T1): a plain paid round with a decision pending keeps its own feedBps and hit chance when the live config is swapped; the feed leg of its ledger batch and its roll are the snapshot\'s; the next new round uses the new numbers', async () => {
    const PLAIN = findSeed({ buy: null, bet: 2500, auto: false }, (r) => r.status === 'pending');
    let u = 0.02;                                                   // between the old chance (25 / 3000 = 0.0083) and the new one (25 / 400 = 0.0625)
    const s = setup({ rng: E.rngFrom(PLAIN.seed), roundRng: E.rngFrom(5), potRng: () => u }); const a = s.sock('ann'); s.rich('ann', 'play'); s.seedPool('play', 7000);
    const P = E.CFG.pull.pot; Object.assign(P, { feedBps: 100, oneInPerDollar: 3000, capCents: 5000, minBal: 1000 });            // the numbers the round is spun under
    const feedOld = Math.floor(2500 * 100 / 10000), feedNew = Math.floor(2500 * 20 / 10000);
    let r = spin(s, a, { bet: 2500, mode: 'play' }); assert.strictEqual(r.status, 'pending', 'a plain paid round stopped at a decision'); assert.strictEqual(r.buyBonus, null);
    SRV.setLiveConfig({ overrides: { pull: { pot: { feedBps: 20, oneInPerDollar: 400, capCents: 500 } } }, note: 'T1 mid-round' });
    assert.strictEqual(E.CFG.pull.pot.feedBps, 20); assert.strictEqual(E.CFG.pull.pot.oneInPerDollar, 400); assert.strictEqual(s.open.size, 1, 'the swap did not touch the open round');
    let guard = 0; while (r.status === 'pending' && guard++ < 6) r = decide(s, a, r, r.pending.k === 'pick' ? { k: 'pick', p: r.pending.choices[0] } : { k: 'more', take: false });
    assert.strictEqual(r.status, 'done'); assert.strictEqual(r.pot, null, 'its own hit chance (25 / 3000) is below u = 0.02: no prize; the live chance (25 / 400) would have hit');
    const lines = s.lines((e) => e.ref === `coldcall:ann:${r.roundId}:close`);
    assert.strictEqual(sum(lines, 'coldcall:feed'), feedOld, 'the feed leg is the snapshot\'s feedBps (100), not the live 20'); assert.strictEqual(sum(lines, 'coldcall:prize'), 0);
    // the next NEW round runs on the new numbers
    const q = spin(s, a, { bet: 2500, mode: 'play', auto: true }); assert.strictEqual(q.status, 'done');
    const ql = s.lines((e) => e.ref === `coldcall:ann:${q.roundId}`);
    assert.strictEqual(sum(ql, 'coldcall:feed'), feedNew, 'a new round feeds at the live feedBps (20)'); assert.ok(q.pot && q.pot.won && q.pot.amount === 500, 'and rolls at the live chance (25 / 400 > 0.02) for the live cap: ' + JSON.stringify(q.pot));
    SRV.setLiveConfig({ overrides: {} });
  });

  // ---------------------------------------------------------------- P6 W3b fix round 1 (the Opus money critic of the slot): C1, C2, C3, C5, C6, C7, C9, C10
  const R1_BET = 2500, R1_FULL = () => Math.round(E.CFG.pull.list * 10);
  const NEAR = () => ({ ...E.newState(), lt: R1_FULL() - 5, avg: R1_BET });           // one fill short of a full list: a replay of a plain $25 round that finishes would arm a Callback
  const pick0 = (p) => ({ k: 'pick', p: p.choices[0] });
  // the mirror engine walks a round to the first prompt of the wanted kind (every pick answered with the first square); the server sees the same draws
  function toKind(input, kind, from = 1) {
    for (let seed = from; seed < from + 6000; seed++) {
      const decs = []; let r = E.playRound(E.rngFrom(seed), { script: false, now: 1000200, day: '1970-01-01', rnd: E.rngFrom(5), ...input, state: input.state ? clone(input.state) : E.newState() }, decs), g = 0;
      while (r.status === 'pending' && r.pending.k !== kind && g++ < 6) { decs.push(pick0(r.pending)); r = E.playRound(E.rngFrom(seed), { script: false, now: 1000200, day: '1970-01-01', rnd: E.rngFrom(5), ...input, state: input.state ? clone(input.state) : E.newState() }, decs); }
      if (r.status === 'pending' && r.pending.k === kind) return { seed, decs };
    }
    throw new Error('no seed reaches a ' + kind + ' prompt');
  }
  const answerTo = (s, a, r, kind) => { let g = 0; while (r.status === 'pending' && r.pending.k !== kind && g++ < 6) r = decide(s, a, r, pick0(r.pending)); return r; };

  // C1: the round the ledger closed by a VOID is not replayed at boot
  for (const crash of [true, false]) {
    await test(`C1: a round the ledger VOIDED (stake back) and whose record was not dropped (${crash ? 'the process died right after the void' : 'the drop could not be written, later restart'}) gives nothing at boot: no ledger line, no state advance, no Callback armed, record dropped; the record was still on disk when the void was written (ledger first)`, async () => {
      const { seed } = findSeed({ buy: null, bet: R1_BET, state: NEAR(), auto: false }, (r) => r.status === 'pending');
      const s = setup({ rng: E.rngFrom(seed), roundRng: E.rngFrom(5) }); const a = s.sock('ann');
      s.store().setPlayer('ann', 'play', NEAR()); s.flush();
      const before = s.bal('ann', 'play'), st0 = clone(s.disk().players.ann.play);
      let thrown = false, onDiskAtVoid = null; const emit = a.emit;
      a.emit = (ev, p) => { if (ev === 'g:coldcall:result' && p && p.status === 'pending' && !thrown) { thrown = true; if (!crash) fs.mkdirSync(s.files.pull + '.tmp'); throw new Error('socket write failed'); } return emit(ev, p); };   // the pending prompt cannot be sent once: the slot voids the round (open_error)
      s.hooks.before.void = () => { onDiskAtVoid = diskHas(s); };
      if (crash) s.hooks.after.void = () => { throw new H.Crash(); };
      s.clock.advance(200); a.send('g:coldcall:spin', { bet: R1_BET, mode: 'play' });
      assert.ok(thrown, 'the round stopped at a decision'); assert.strictEqual(onDiskAtVoid, true, 'ledger first: the record was still on disk when the void was written');
      const id = s.disk().open['ann|play'].roundId, voidLines = closeLines(s, id);
      assert.deepStrictEqual(voidLines.map((e) => [e.reason, e.amount]), [['coldcall:void:open_error', R1_BET]], 'the ledger closed the round by one void line'); assert.strictEqual(s.bal('ann', 'play'), before); assert.ok(diskHas(s), 'and the record is still on disk');
      if (crash) s.reboot(); else { s.crash(); fs.rmdirSync(s.files.pull + '.tmp'); s.boot(); }
      assert.deepStrictEqual(closeLines(s, id).map((e) => e.id), voidLines.map((e) => e.id), 'boot wrote no ledger line for it'); assert.strictEqual(s.bal('ann', 'play'), before, 'the stake is back, nothing else moved');
      assert.deepStrictEqual(s.escrows(), []); assert.strictEqual(s.store().allOpen().length, 0, 'the record is gone'); assert.ok(!diskHas(s), 'also on the disk');
      const st = s.store().player('ann', 'play'); assert.strictEqual(st.cb, null, 'no Callback armed from a refunded round'); assert.strictEqual(st.lt, st0.lt, 'no leads from a refunded round'); assert.strictEqual(st.rounds, st0.rounds, 'no state advance'); assert.deepStrictEqual(st, st0);
      const b = s.sock('ann'), h0 = s.house('play'), q = spin(s, b, { bet: 1, mode: 'play', auto: true }); assert.strictEqual(q.callback, false, 'the next spin is a paid spin, not a free Callback'); assert.strictEqual(q.cost, 1);
      assert.strictEqual(s.lines((e) => /^coldcall:ann:cb/.test(e.ref)).length, 0, 'no Callback round was ever played'); void h0;
    });
  }

  // C1 control: a round the ledger closed by a SETTLE is still replayed (state advances, nothing paid), and the probe that tells the two apart writes nothing
  await test('C1 control: a round the ledger SETTLED, record not dropped: boot answers round_closed / dup through the replay, the state advances, the void probe wrote no line, nothing is paid twice', async () => {
    const { seed } = toKind({ buy: null, bet: R1_BET, state: NEAR(), auto: false }, 'more');
    const s = setup({ rng: E.rngFrom(seed), roundRng: E.rngFrom(5) }); const a = s.sock('ann'); s.store().setPlayer('ann', 'play', NEAR()); s.flush();
    const before = s.bal('ann', 'play'), st0 = clone(s.disk().players.ann.play);
    let r = answerTo(s, a, spin(s, a, { bet: R1_BET, mode: 'play' }), 'more'); assert.strictEqual(r.pending.k, 'more');
    s.hooks.after.settle = () => { throw new H.Crash(); };
    a.send('g:coldcall:decide', { roundId: r.roundId, k: 'more', take: false });
    const paid = sum(closeLines(s, r.roundId), 'coldcall:credit'), id0 = s.lastId(); assert.ok(diskHas(s), 'the record is on disk');
    s.reboot();
    assert.strictEqual(s.lastId(), id0, 'boot wrote nothing'); assert.strictEqual(s.bal('ann', 'play'), before - r.cost + paid); assert.strictEqual(s.store().allOpen().length, 0);
    const st = s.store().player('ann', 'play'); assert.ok(st.rounds > st0.rounds, 'the state advanced from the replay of the player\'s choices: ' + st.rounds + ' > ' + st0.rounds);
  });

  // C2: the player's answer is in the stored record BEFORE the result of that answer reaches the client
  const CBG = () => ({ ...E.newState(), cb: { bet: 2500, id: 'cbfeedc0ffee01' } });
  // a seed whose Callback reaches ONE MORE CALL and whose taken gamble pays 0 in total while banking pays W > 0 (mirror engine: take, then bank, the same draws)
  function gambleSeed() {
    for (let seed = 1; seed < 6000; seed++) {
      const mk = (decs) => E.playRound(E.rngFrom(seed), { buy: null, bet: 100, state: CBG(), now: 1000200, day: '1970-01-01', script: false, auto: false, rnd: E.rngFrom(5) }, decs);
      const decs = []; let r = mk(decs), g = 0; while (r.status === 'pending' && r.pending.k !== 'more' && g++ < 6) { decs.push(pick0(r.pending)); r = mk(decs); }
      if (r.status !== 'pending' || r.pending.k !== 'more') continue;
      const take = mk(decs.concat([{ k: 'more', take: true }])), bank = mk(decs.concat([{ k: 'more', take: false }]));
      if (take.status === 'done' && take.pay.win === 0 && bank.status === 'done' && bank.pay.win > 0) return { seed, bankWin: bank.pay.win };
    }
    throw new Error('no seed: a Callback whose taken gamble pays 0');
  }
  for (const variant of ['A the process dies after the money call', 'B the game file cannot be written after the money call (the loss is shown), later restart']) {
    await test(`C2 ${variant}: a Callback gamble that pays 0 writes no ledger line, yet boot replays the TAKEN gamble: it pays 0 (not the banked amount), the Callback is consumed`, async () => {
      const { seed, bankWin } = gambleSeed();
      const s = setup({ rng: E.rngFrom(seed), roundRng: E.rngFrom(5) }); const a = s.sock('ann'); s.store().setPlayer('ann', 'play', CBG()); s.flush();
      const before = s.bal('ann', 'play'); let r = answerTo(s, a, spin(s, a, { bet: 100, mode: 'play', auto: false }), 'more'); assert.strictEqual(r.pending.k, 'more'); assert.strictEqual(r.cost, 0); assert.strictEqual(r.callback, true);
      const id = r.roundId, id0 = s.lastId(); let seen = null;
      s.hooks.before.settle = () => { seen = clone(s.disk().open['ann|play']); if (variant[0] === 'B') fs.mkdirSync(s.files.pull + '.tmp'); };
      if (variant[0] === 'A') s.hooks.after.settle = () => { throw new H.Crash(); };
      a.send('g:coldcall:decide', { roundId: id, k: 'more', take: true });
      assert.ok(seen && seen.decisions.length >= 1 && JSON.stringify(seen.decisions[seen.decisions.length - 1]) === JSON.stringify({ k: 'more', take: true }), 'the taken gamble was in the stored record BEFORE the money call: ' + JSON.stringify(seen && seen.decisions));
      assert.strictEqual(s.lastId(), id0, 'a free round that pays 0 leaves no ledger line');
      const done = all(a, 'g:coldcall:result').filter((x) => x.status === 'done');
      if (variant[0] === 'A') assert.strictEqual(done.length, 0, 'no result reached the client'); else { assert.strictEqual(done.length, 1); assert.strictEqual(done[0].totalWin, 0, 'the client was shown the loss'); assert.ok(diskHas(s), 'the record is still on disk'); }
      if (variant[0] === 'A') s.reboot(); else { s.crash(); fs.rmdirSync(s.files.pull + '.tmp'); s.boot(); }
      assert.strictEqual(s.lastId(), id0, 'boot wrote nothing: not the banked ' + bankWin); assert.strictEqual(s.bal('ann', 'play'), before, 'balance unchanged'); assert.strictEqual(closeLines(s, id).length, 0);
      assert.strictEqual(s.store().player('ann', 'play').cb, null, 'the Callback is consumed'); assert.strictEqual(s.store().allOpen().length, 0);
      const h = (SRV._history.get('ann') || []).find((x) => x.roundId === id); assert.ok(h && h.totalWin === 0 && h.auto === 'restart', 'the boot settlement is the taken gamble: ' + JSON.stringify(h));
    });
  }
  await test('C2 order: on a paid round the final answer is in the stored record before the money call, and a final answer that cannot be stored is REFUSED (error, no result, no ledger line, the round stays open and can be answered again)', async () => {
    const PE = findSeed({ buy: 'bonus1', bet: 100, auto: false }, (r) => r.status === 'pending');
    const s = setup({ rng: E.rngFrom(PE.seed), roundRng: E.rngFrom(5) }); const a = s.sock('ann'); const before = s.bal('ann', 'play');
    let r = answerTo(s, a, spin(s, a, { bet: 100, mode: 'play', buyBonus: 'bonus1' }), 'more'); assert.strictEqual(r.pending.k, 'more'); const cost = r.cost, id = r.roundId;
    // the disk refuses the write of the final answer
    fs.mkdirSync(s.files.pull + '.tmp'); const n = all(a, 'error').length, id0 = s.lastId();
    a.send('g:coldcall:decide', { roundId: id, k: 'more', take: true });
    assert.strictEqual(all(a, 'error').length, n + 1); assert.strictEqual(last(a, 'error').code, 'internal'); assert.strictEqual(all(a, 'g:coldcall:result').filter((x) => x.status === 'done').length, 0, 'no result');
    assert.strictEqual(s.lastId(), id0, 'no ledger line'); assert.strictEqual(s.escrowSum('play'), cost, 'the stake is still in escrow'); assert.strictEqual(s.open.size, 1, 'the round is still open'); assert.deepStrictEqual(s.open.get(id).decisions.filter((d) => d.k === 'more'), [], 'the refused answer is not kept');
    fs.rmdirSync(s.files.pull + '.tmp');
    let seen = null; s.hooks.before.settle = () => { seen = clone(s.disk().open['ann|play']); };
    a.send('g:coldcall:decide', { roundId: id, k: 'more', take: true });
    const done = all(a, 'g:coldcall:result').filter((x) => x.status === 'done'); assert.strictEqual(done.length, 1, 'once the disk works the same round can be answered: ' + JSON.stringify(last(a, 'error')));
    assert.deepStrictEqual(seen.decisions[seen.decisions.length - 1], { k: 'more', take: true }, 'the final answer was on disk before the money call');
    assert.strictEqual(s.bal('ann', 'play'), before - cost + done[0].totalWin); assert.deepStrictEqual(s.escrows(), []); assert.ok(!diskHas(s), 'the record is dropped with the state');
  });

  // C3: killed after the ledger call of a plain paid round, before the flush: the pot's numbers and the player's state after boot match what the ledger paid
  const sc3 = (finalTake, firstRoll, bootRoll, poolSize = 7000) => {
    const { seed } = toKind({ buy: null, bet: R1_BET, auto: false }, 'more'); let seq = [];
    const s = setup({ rng: E.rngFrom(seed), roundRng: E.rngFrom(5), potRng: () => (seq.length ? seq.shift() : 1) }); const a = s.sock('ann'); s.seedPool('play', poolSize); E.CFG.pull.pot.capCents = 5000;
    const r = answerTo(s, a, spin(s, a, { bet: R1_BET, mode: 'play' }), 'more'); assert.strictEqual(r.pending.k, 'more'); const id = r.roundId, pool0 = s.pool('play'), pot0 = clone(s.potOf('play')), st0 = clone(s.disk().players.ann ? s.disk().players.ann.play : E.newState());
    s.hooks.after.settle = () => { throw new H.Crash(); }; seq = [firstRoll];
    a.send('g:coldcall:decide', { roundId: id, k: 'more', take: finalTake });
    const L = closeLines(s, id), feed = sum(L, 'coldcall:feed'), prize = sum(L, 'coldcall:prize'), win = sum(L, 'coldcall:credit'), bal = s.bal('ann', 'play'), id0 = s.lastId();
    seq = [bootRoll]; s.reboot();
    return { s, id, L, feed, prize, win, bal, id0, pool0, pot0, st0, pot: s.potOf('play'), st: s.store().player('ann', 'play') };
  };
  for (const [label, take, first, boot, kind, poolSize] of [['bank, the first roll hit, the boot roll hits too, and the pool is big enough that the capped prize is the same (dup)', false, 0, 0, 'dup', 20000], ['bank, the first roll hit, the boot roll hits too: the pool is drained, so its prize differs (round_closed)', false, 0, 0, 'closed'], ['bank, no prize either time (dup)', false, 1, 1, 'dup'], ['take, the first roll hit, the boot roll misses (round_closed)', true, 0, 1, 'closed'], ['bank, the first roll missed, the boot roll hits (round_closed, a prize that was never paid stays unpaid)', false, 1, 0, 'closed']]) {
    await test(`C3: killed after the settle of a plain paid round (${label}): the ledger is paid once and not again, the pool is the ledger's, the pot's rem and fed count the batch${kind === 'dup' ? ', paid and last too (fed = paid + bal)' : ' (paid and last are left: the roll that paid is not known)'}, the player state advanced, no Callback, record gone`, async () => {
      const x = sc3(take, first, boot, poolSize), { s, id, pot, st } = x;
      assert.strictEqual(s.lastId(), x.id0, 'boot wrote no ledger line'); assert.strictEqual(new Set(closeLines(s, id).map((e) => e.id)).size, 1, 'one :close batch'); assert.strictEqual(s.bal('ann', 'play'), x.bal, 'the balance is what the first call made it');
      assert.strictEqual(s.pool('play'), x.pool0 + x.feed - x.prize, 'the pool is the ledger\'s'); assert.strictEqual(pot.bal, s.pool('play'), 'the mirror follows it'); assert.ok(x.feed > 0, 'the batch fed the pot');
      assert.strictEqual(pot.fed, x.pot0.fed + x.feed, 'fed counts the batch the ledger holds'); assert.strictEqual(pot.rem, E.potSlice(E.CFG.pull.pot.feedBps, R1_BET, x.pot0.rem).rem, 'rem advanced by this round');
      if (kind === 'dup') { assert.strictEqual(pot.paid, x.pot0.paid + x.prize, 'paid counts the prize of the batch'); assert.strictEqual(pot.fed, pot.paid + pot.bal, 'fed = paid + bal'); if (first === 0) { assert.ok(x.prize > 0, 'the batch paid a prize'); assert.strictEqual(pot.last && pot.last.amount, x.prize, 'last is the prize the ledger paid'); } }
      else assert.strictEqual(pot.paid, x.pot0.paid, 'paid is not touched on a round_closed');
      assert.ok(st.rounds > (x.st0.rounds || 0), 'the player state advanced from the replay'); assert.strictEqual(s.store().allOpen().length, 0); assert.ok(!diskHas(s));
      const id2 = s.lastId(); s.reboot(); assert.strictEqual(s.lastId(), id2, 'a second boot writes nothing'); assert.deepStrictEqual(s.potOf('play'), pot, 'and the pot does not move again');
    });
  }


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
