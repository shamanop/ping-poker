'use strict';
// node tests/money-1008-cc-hook.js   (MONEY 1008 K4-3: the Cold Call QA `force` hook is Chips only, always)
// A Cash round (stored currency `play`) never honours `force`, whatever the environment says: not the pull spin, not the old stateless spin, not the Callback, not a buy,
// and the client is not told the hook exists for Cash. Chips keep the hook. A real ledger on a temp dir through tests/lib-coldcall-ledger.js; no network, no server.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-hook-'));
const H = require('./lib-coldcall-ledger.js');
const E = require('../games/coldcall-engine.js');

let pass = 0;
const test = async (name, fn) => { try { await fn(); pass++; console.log('ok   ' + name); } catch (e) { console.error('FAIL ' + name + '\n' + (e.stack || e)); process.exitCode = 1; } };
const withEnv = async (vars, fn) => {
  const old = {}; for (const k of Object.keys(vars)) { old[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; }
  try { await fn(); } finally { for (const k of Object.keys(old)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } }
};
const world = (o = {}) => H.world({ dir: fs.mkdtempSync(path.join(tmp, 'w')), potRng: () => 1, ...o });
const ON = { COLDCALL_TEST: '1', NODE_ENV: null };
const FORCES = E.FORCES;
// answer every decision with the defaults until the round is done
const finish = (w, s, r) => { for (let k = 0; r.status === 'pending' && k < 8; k++) r = H.decide(w, s, r, r.pending.k === 'pick' ? { k: 'pick', p: r.pending.choices[0] } : { k: 'more', take: false }); return r; };

(async () => {
  for (const pullOn of [true, false]) {
    const tag = pullOn ? 'pull on' : 'stateless';
    E.CFG.pull.on = pullOn;

    await test(`${tag}: hook on, a Cash spin with ANY force is an ordinary round (never forced, same rounds as an unforced mirror)`, async () => {
      await withEnv(ON, async () => {
        const w = world({ rng: E.rngFrom(71), roundRng: E.rngFrom(72) }); const s = w.sock('ann'); w.setBal('ann', 'play', 1e8);
        for (let i = 0; i < 21; i++) {
          const f = FORCES[i % FORCES.length];
          let r = H.spin(w, s, { bet: 200, mode: 'play', force: f });
          assert.ok(!r.error, JSON.stringify(r.error));
          r = finish(w, s, r);
          assert.strictEqual(r.forced, undefined, 'a Cash round must not be forced: ' + f);
          assert.strictEqual(r.buyBonus, null);
        }
        w.crash();
      });
    });

    await test(`${tag}: hook on, 'big' in Cash: 40 spins, no round re-rolled to 25x (Cash net not inflated: wins are the natural distribution)`, async () => {
      await withEnv(ON, async () => {
        const w = world({ rng: E.rngFrom(5), roundRng: E.rngFrom(6) }); const s = w.sock('ann'); w.setBal('ann', 'play', 1e8);
        // an unforced twin on the same rng stream must produce the same results spin for spin
        const mine = [], twin = [];
        for (let i = 0; i < 40; i++) {
          mine.push(finish(w, s, H.spin(w, s, { bet: 200, mode: 'play', force: 'big' })));
        }
        w.crash();
        const t = world({ rng: E.rngFrom(5), roundRng: E.rngFrom(6) }); const ts = t.sock('ann'); t.setBal('ann', 'play', 1e8);   // (one world at a time: games/coldcall.js is one module per process)
        for (let i = 0; i < 40; i++) twin.push(finish(t, ts, H.spin(t, ts, { bet: 200, mode: 'play' })));
        t.crash();
        assert.deepStrictEqual(mine.map((r) => r.totalWin), twin.map((r) => r.totalWin), 'a Cash spin with force:big pays exactly what the same spin without force pays');
        assert.ok(mine.every((r) => r.forced === undefined));
      });
    });

    await test(`${tag}: the client is not told the hook exists for Cash (state asked for Cash has no qaHook; the hook is listed for Chips only)`, async () => {
      await withEnv(ON, async () => {
        const w = world({ rng: E.rngFrom(3) }); const s = w.sock('ann');
        s.send('g:coldcall:state', { mode: 'play' });
        assert.ok(!H.last(s, 'g:coldcall:state').qaHook, 'no qaHook when the state is for Cash');
        assert.strictEqual(H.last(s, 'g:coldcall:state').qaHookModes, undefined);
        s.send('g:coldcall:state', {});
        const st = H.last(s, 'g:coldcall:state');
        assert.deepStrictEqual(st.qaHookModes, ['chips'], 'the hook is for Chips only');
        s.send('g:coldcall:state', { mode: 'chips' });
        assert.strictEqual(H.last(s, 'g:coldcall:state').qaHook, true);
        w.crash();
      });
    });

    await test(`${tag}: Chips still honour the hook (every force, forced result, normal paid round)`, async () => {
      await withEnv(ON, async () => {
        const w = world({ rng: E.rngFrom(79), roundRng: E.rngFrom(80) }); const s = w.sock('ann'); w.setBal('ann', 'chips', 1e8);
        for (const f of FORCES) {
          const r = finish(w, s, H.spin(w, s, { bet: 200, mode: 'chips', force: f }));
          assert.strictEqual(r.forced, f);
          if (f === 'big') assert.ok(r.totalWinMult >= 25);
        }
        w.crash();
      });
    });

    await test(`${tag}: hook off, force is ignored in both currencies (unchanged)`, async () => {
      await withEnv({ COLDCALL_TEST: null, NODE_ENV: null }, async () => {
        const w = world({ rng: E.rngFrom(81), roundRng: E.rngFrom(82) }); const s = w.sock('ann'); w.setBal('ann', 'play', 1e8); w.setBal('ann', 'chips', 1e8);
        for (const mode of ['play', 'chips']) for (const f of FORCES) assert.strictEqual(finish(w, s, H.spin(w, s, { bet: 200, mode, force: f })).forced, undefined);
        s.send('g:coldcall:state', {}); const st = H.last(s, 'g:coldcall:state'); assert.ok(!st.qaHook); assert.strictEqual(st.qaHookModes, undefined);
        w.crash();
      });
    });
  }

  // pull-only: the waiting Callback and the buys
  E.CFG.pull.on = true;
  await test('pull on: a Cash Callback waiting + hook on + force: the Callback plays (free), the force is not honoured', async () => {
    await withEnv(ON, async () => {
      const w = world({ rng: E.rngFrom(75) }); const s = w.sock('ann'); w.setBal('ann', 'play', 1e8);
      w.SRV._pull.store.setPlayer('ann', 'play', { ...E.newState(), cb: { bet: 100 }, lt: 100 });
      const b0 = w.bal('ann', 'play');
      const r = finish(w, s, H.spin(w, s, { bet: 200, mode: 'play', force: 'big' }));
      assert.strictEqual(r.forced, undefined); assert.strictEqual(r.callback, true, 'the armed Callback is played, not skipped for a forced paid round'); assert.strictEqual(r.cost, 0);
      assert.ok(w.bal('ann', 'play') >= b0, 'a free round costs nothing');
      w.crash();
    });
  });

  await test('pull on: a Cash buy with a force is an ordinary buy (cost = the bonus price, bonus kind = the one bought, never forced)', async () => {
    await withEnv(ON, async () => {
      const w = world({ rng: E.rngFrom(76) }); const s = w.sock('ann'); w.setBal('ann', 'play', 1e8);
      const r = finish(w, s, H.spin(w, s, { bet: 100, mode: 'play', buyBonus: 'bonus1', force: 'bonus3' }));
      assert.strictEqual(r.forced, undefined); assert.strictEqual(r.buyBonus, 'bonus1');
      w.crash();
    });
  });

  await test('pull on: a Cash spin with force:big for a player whose balance is too low is still refused (funds), the hook opens no door', async () => {
    await withEnv(ON, async () => {
      const w = world({ rng: E.rngFrom(77) }); const s = w.sock('bo'); w.setBal('bo', 'play', 10);
      const r = H.spin(w, s, { bet: 200, mode: 'play', force: 'big' });
      assert.strictEqual(r.error && r.error.code, 'funds'); assert.strictEqual(w.bal('bo', 'play'), 10);
      w.crash();
    });
  });

  // defense in depth: a stored Cash round that carries a force (a hand-edited or pre-fix file) is never replayed under it
  await test('boot: an open Cash record carrying a force is voided (the stake goes back in full), never replayed under the force', async () => {
    await withEnv(ON, async () => {
      const lines = []; const w = world({ rng: E.rngFrom(91), roundRng: E.rngFrom(92), log: (...a) => lines.push(a.join(' ')) }); const s = w.sock('ann'); w.setBal('ann', 'play', 1000000); w.setBal('ann', 'chips', 1000000);
      const r = H.toPending(w, s, 'pick', 'play', 100);              // a Cash buy waiting at a decision: its stake is in escrow
      assert.ok(w.bal('ann', 'play') < 1000000);
      w.flush(); const f = w.files.pull; const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      assert.ok(j.open['ann|play'], 'the open Cash record is on disk'); j.open['ann|play'].force = 'big'; fs.writeFileSync(f, JSON.stringify(j));
      w.crash(); w.boot();
      assert.strictEqual(w.bal('ann', 'play'), 1000000, 'the Cash stake came back in full'); assert.deepStrictEqual(w.escrows(), []);
      assert.ok(lines.some((l) => /cannot be rebuilt/.test(l) && /QA force on a Cash round/.test(l)), lines.join('\n'));
      assert.strictEqual(r.mode, 'play');
      w.crash();
    });
  });

  // K4-4: a `decide` whose message names another currency. The currency of a round is the STORED one (rec.mode), never the message's.
  await test('decide: a message that names another currency (mode: play on a Chips round, and the reverse) settles in the round\'s own currency; Cash never moves for a Chips round', async () => {
    const w = world({ rng: E.rngFrom(31), roundRng: E.rngFrom(32) }); const s = w.sock('ann'); w.setBal('ann', 'play', 5000000); w.setBal('ann', 'chips', 5000000);
    const other = (m) => (m === 'play' ? 'chips' : 'play');
    for (const mode of ['chips', 'play']) {
      // (1) a paid Chips / Cash round waiting at a decision
      const pend = H.toPending(w, s, 'more', mode, 100); const a0 = w.bal('ann', mode), o0 = w.bal('ann', other(mode));
      s.send('g:coldcall:decide', { roundId: pend.roundId, k: 'more', take: false, mode: other(mode), bet: 2500, cost: 1 });
      let r = H.last(s, 'g:coldcall:result');
      assert.strictEqual(r.status, 'done'); assert.strictEqual(r.mode, mode, 'the result is in the round\'s own currency');
      assert.strictEqual(w.bal('ann', mode), a0 + r.totalWin, 'paid in ' + mode); assert.strictEqual(w.bal('ann', other(mode)), o0, other(mode) + ' did not move');
      // (2) a Callback armed in this currency, played free, every decision answered with the OTHER currency in the message
      w.SRV._pull.store.setPlayer('ann', mode, { ...E.newState(), cb: { bet: 2500, id: 'cbmix' + mode }, lt: 100 }); w.flush();
      const b0 = w.bal('ann', mode), q0 = w.bal('ann', other(mode));
      r = H.spin(w, s, { bet: 10, mode }); assert.strictEqual(r.callback, true, 'the Callback plays'); assert.strictEqual(r.cost, 0);
      for (let i = 0; r.status === 'pending' && i < 8; i++) r = H.decide(w, s, r, { ...H.policy(i, r.pending), mode: other(mode) });
      assert.strictEqual(r.status, 'done'); assert.strictEqual(r.mode, mode);
      assert.strictEqual(w.bal('ann', mode), b0 + r.totalWin + (r.pot ? r.pot.amount : 0), 'the Callback is paid in ' + mode); assert.strictEqual(w.bal('ann', other(mode)), q0, other(mode) + ' did not move');
    }
    // every ledger line of the decisions above sits in one currency per ref: no ref was paid in a currency it was not opened in
    const byRef = new Map(); for (const e of w.lines((e) => /^coldcall:ann:/.test(e.ref))) { const set = byRef.get(e.ref) || new Set(); set.add(e.cur); byRef.set(e.ref, set); }
    for (const [ref, set] of byRef) assert.strictEqual(set.size, 1, ref + ' touched ' + [...set].join('+'));
    w.crash();
  });

  // boot line
  await test('boot: with the hook on the server prints ONE loud line saying so; with it off it prints nothing about the hook', async () => {
    for (const [vars, expect] of [[ON, 1], [{ COLDCALL_TEST: null, NODE_ENV: null }, 0], [{ COLDCALL_TEST: '1', NODE_ENV: 'production' }, 0]]) {
      await withEnv(vars, async () => {
        const lines = []; const w = world({ rng: E.rngFrom(8), log: (...a) => lines.push(a.join(' ')) });
        const loud = lines.filter((l) => /QA force hook/i.test(l));
        assert.strictEqual(loud.length, expect, JSON.stringify(vars) + ' -> ' + JSON.stringify(lines));
        if (expect) assert.ok(/CHIPS ONLY/.test(loud[0]) && /COLDCALL_TEST/.test(loud[0]));
        w.crash();
      });
    }
  });

  console.log(pass + ' passed' + (process.exitCode ? ', with failures' : ''));
  fs.rmSync(tmp, { recursive: true, force: true });
})();
