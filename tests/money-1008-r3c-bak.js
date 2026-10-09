'use strict';
// node tests/money-1008-r3c-bak.js   (MONEY 1008 R3C-2: a restore from <file>.bak in journal mode must give the state as of the LAST DURABLE JOURNAL LINE, never an older one)
// In journal mode the main file is written only at a checkpoint, so the .bak is one CHECKPOINT behind and the journal used to hold nothing older than the last checkpoint: a restore from the .bak lost
// everything between the last two checkpoints (a Callback played for 0 came back ARMED and was played and paid again; leads and a Callback armed in that window were gone).
// Fix: a checkpoint keeps the segment it folded into the main file as <file>.journal.prev; boot restores from the .bak and replays prev + journal; one alarm line says so.
// Store level (createStore, no game) and game level (real game + ledger, tests/lib-coldcall-ledger.js). Plain node, exit 0 / 1.
process.env.COLDCALL_JOURNAL = '1';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-r3c-bak-'));
const H = require('./lib-coldcall-ledger.js');
const E = require('../games/coldcall-engine.js');
const { createStore } = require('../games/coldcall-store.js');

setTimeout(() => { console.error('FAIL watchdog: the test did not finish in 240 s'); process.exit(1); }, 240000).unref();
let n = 0, passed = 0;
const test = async (name, fn) => { try { await fn(); console.log('ok   ' + name); passed++; } catch (e) { console.error('FAIL ' + name + '\n' + (e.stack || e)); process.exitCode = 1; } };
const clone = (o) => JSON.parse(JSON.stringify(o));
const TORN = '{"v":1,"players":{"a":{"pl';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- store level
function mk(file, o = {}) { const alarms = []; const s = createStore(file, { journal: true, log: () => {}, alarm: (...a) => alarms.push(a.join(' ')), confirm: () => true, ...o }); return { s, alarms }; }
const st = (lt, extra) => Object.assign(E.newState(), { lt, avg: 100 }, extra || {});
// one journal line for a player (the way a paid spin writes it: free = nothing to ask the ledger about)
const line = (s, key, state, id) => { const q = s.intent({ ref: { key, id: id || 'r-' + key + '-' + (++n) }, player: [key, 'play', state], free: true }); s.setPlayer(key, 'play', state); s.covered(key, 'play', null, null); return q; };   // the line, then the memory (the game's order), the line covers the mark
const fresh = () => path.join(fs.mkdtempSync(path.join(tmp, 's' + ++n + '-')), 'coldcall-pull.json');
const snap = (s, keys) => JSON.stringify(keys.map((k) => s.player(k, 'play')));

(async () => {
  await test('store: leads earned and a Callback armed between two checkpoints survive a restore from the .bak', async () => {
    const f = fresh(), { s } = mk(f);
    s.setPlayer('a', 'play', st(100)); s.flush(); s.compact();                      // checkpoint 1
    line(s, 'a', st(4300)); s.flush();                                              // between checkpoint 1 and 2: leads
    s.compact();                                                                    // checkpoint 2
    line(s, 'b', st(0, { cb: { bet: 500, id: 'cbB' } })); line(s, 'a', st(4310)); s.flush();   // between 2 and 3: a Callback armed for b, more leads for a
    s.compact();                                                                    // checkpoint 3: main = 3, .bak = 2
    line(s, 'c', st(77)); s.flush();                                                // after the last checkpoint: the current journal
    const want = snap(s, ['a', 'b', 'c']); s.close(true);
    assert.ok(fs.existsSync(f + '.bak') && fs.existsSync(f + '.journal.prev'), 'a .bak and a kept segment exist');
    fs.writeFileSync(f, TORN);                                                      // the main file is torn on disk
    const { s: r, alarms } = mk(f);
    assert.strictEqual(snap(r, ['a', 'b', 'c']), want, 'the restore gives the state of the last durable line, not the .bak');
    assert.strictEqual(r.player('b', 'play').cb.id, 'cbB', 'the Callback armed between the two checkpoints is there');
    assert.ok(alarms.some((a) => /restored from .*\.bak and replayed \d+ journal line/.test(a) && /last durable journal line/.test(a)), 'one loud line says so: ' + alarms.map((x) => x.slice(0, 120)).join(' | '));
    assert.ok(!alarms.some((a) => /not on disk/.test(a)), 'no gap');
    r.close(true);
  });

  await test('store: a second damage right after a restore loses nothing either (the kept segment still covers the .bak)', async () => {
    const f = fresh(), { s } = mk(f);
    s.setPlayer('a', 'play', st(1)); s.flush(); s.compact();
    line(s, 'a', st(2)); s.flush(); s.compact();
    line(s, 'b', st(3)); s.flush(); s.compact();
    line(s, 'c', st(4)); s.flush(); const want = snap(s, ['a', 'b', 'c']); s.close(true);
    fs.writeFileSync(f, TORN);
    const { s: r1 } = mk(f); assert.strictEqual(snap(r1, ['a', 'b', 'c']), want); r1.close(true);     // restored (and checkpointed)
    fs.writeFileSync(f, TORN);                                                                         // damaged again, nothing written in between
    const { s: r2 } = mk(f); assert.strictEqual(snap(r2, ['a', 'b', 'c']), want, 'the second restore gives the same state'); r2.close(true);
    // and after a restore the store goes on: new lines, a checkpoint, a third damage
    const { s: r3 } = mk(f); line(r3, 'd', st(9)); r3.flush(); r3.compact(); line(r3, 'e', st(10)); r3.flush(); const want3 = snap(r3, ['a', 'b', 'c', 'd', 'e']); r3.close(true);
    fs.writeFileSync(f, TORN);
    const { s: r4 } = mk(f); assert.strictEqual(snap(r4, ['a', 'b', 'c', 'd', 'e']), want3, 'a third restore after more work'); r4.close(true);
  });

  await test('store: a missing main file next to a good .bak is restored the same way', async () => {
    const f = fresh(), { s } = mk(f);
    s.setPlayer('a', 'play', st(1)); s.flush(); s.compact(); line(s, 'b', st(2)); s.flush(); s.compact(); line(s, 'c', st(3)); s.flush(); const want = snap(s, ['a', 'b', 'c']); s.close(true);
    fs.rmSync(f);
    const { s: r, alarms } = mk(f); assert.strictEqual(snap(r, ['a', 'b', 'c']), want); assert.ok(alarms.some((a) => /Restored the Cold Call state/.test(a)) && alarms.some((a) => /replayed/.test(a))); r.close(true);
  });

  await test('store: a torn tail of the journal at a plain boot is not carried into the kept segment (a later restore still reads clean lines)', async () => {
    const f = fresh(), { s } = mk(f);
    s.setPlayer('a', 'play', st(1)); s.flush(); s.compact(); line(s, 'b', st(2)); s.flush(); const want = snap(s, ['a', 'b']); s.close(true);
    fs.appendFileSync(f + '.journal', 'deadbeef\t{"s":99,"p":[["z","play"');           // a line that was never completed
    const { s: r1, alarms: a1 } = mk(f); assert.strictEqual(snap(r1, ['a', 'b']), want); r1.close(true);
    const prev = fs.readFileSync(f + '.journal.prev', 'utf8'); assert.ok(prev.endsWith('\n') && !prev.includes('deadbeef'), 'kept segment: complete lines only');
    fs.writeFileSync(f, TORN);
    const { s: r2, alarms: a2 } = mk(f); assert.strictEqual(snap(r2, ['a', 'b']), want); assert.ok(!a2.some((x) => /bad line|not used/.test(x) && /\*\*\*/.test(x)), 'no damage alarm: ' + a2.map((x) => x.slice(0, 100)).join('|')); r2.close(true);
  });

  await test('store: an old .bak with no kept segment (the store from before this fix) says loudly what it cannot restore', async () => {
    const f = fresh(), { s } = mk(f);
    s.setPlayer('a', 'play', st(1)); s.flush(); s.compact(); line(s, 'b', st(2)); s.flush(); s.compact(); line(s, 'c', st(3)); s.flush(); s.close(true);
    fs.rmSync(f + '.journal.prev'); fs.writeFileSync(f, TORN);                      // as the old code left it: no kept segment
    const { s: r, alarms } = mk(f);
    assert.ok(alarms.some((a) => /are not on disk/.test(a) && /NOT restored/.test(a)), 'the gap is named: ' + alarms.map((x) => x.slice(0, 100)).join('|')); r.close(true);
  });

  await test('store: disk bound: after many checkpoints there are two segments (journal, journal.prev), nothing else grows', async () => {
    const f = fresh(), { s } = mk(f);
    for (let i = 0; i < 12; i++) { line(s, 'a', st(i)); s.flush(); s.compact(); }
    line(s, 'a', st(99)); s.flush();
    const names = fs.readdirSync(path.dirname(f)).sort(); assert.deepStrictEqual(names, ['coldcall-pull.json', 'coldcall-pull.json.bak', 'coldcall-pull.json.journal', 'coldcall-pull.json.journal.prev'], names.join(','));
    assert.strictEqual(fs.readFileSync(f + '.journal.prev', 'utf8').split('\n').filter(Boolean).length, 1, 'the kept segment is the last interval only'); s.close(true);
  });

  await test('store: whole-file mode (no journal) is unchanged: a restore gives the .bak, one write behind', async () => {
    const f = fresh(), s = createStore(f, { journal: false, log: () => {}, alarm: () => {} });
    s.setPlayer('a', 'play', st(1)); s.flush(); s.setPlayer('a', 'play', st(2)); s.flush(); s.close();
    assert.ok(!fs.existsSync(f + '.journal.prev'), 'no kept segment in whole-file mode');
    fs.writeFileSync(f, TORN);
    const r = createStore(f, { journal: false, log: () => {}, alarm: () => {} }); assert.strictEqual(r.player('a', 'play').lt, 1, 'the .bak is one write behind, as before'); r.close(true);
  });

  // ---- game level: the finding itself (seam-bak.js): a Callback played for 0, a checkpoint, more spins of another player, the main file torn, boot
  function drive(w, s, payload, i = 0) {
    return new Promise((resolve) => {
      const push = s.out.push.bind(s.out); let k = 0; const t = setTimeout(() => { s.out.push = push; resolve({ kind: 'timeout' }); }, 8000);
      const end = (v) => { clearTimeout(t); s.out.push = push; resolve(v); };
      s.out.push = (e) => {
        const r = push(e);
        if (e[0] === 'error') end({ kind: 'error', code: e[1].code });
        else if (e[0] === 'g:coldcall:result') { if (e[1].status === 'pending') setImmediate(() => { w.clock.advance(5); s.send('g:coldcall:decide', { roundId: e[1].roundId, ...H.policy(i + k++, e[1].pending) }); }); else end({ kind: 'done', win: e[1].totalWin, cost: e[1].cost, callback: !!e[1].callback, id: e[1].roundId }); }
        return r;
      };
      w.clock.advance(200); s.send('g:coldcall:spin', payload);
    });
  }
  for (const seed of [9500, 9508]) {       // 9500: the Callback pays 0 (no ledger line, nothing else stops a second play), 9508: it pays money
    await test('game: a Callback played (seed ' + seed + ') is NOT armed again by a restore from the .bak, and is not paid twice', async () => {
      const alarms = [];
      const w = H.world({ dir: fs.mkdtempSync(path.join(tmp, 'g' + ++n + '-')), rng: E.rngFrom(seed), roundRng: E.rngFrom(seed + 1), potRng: () => 1, log: (...a) => { const t = a.join(' '); if (t.includes('***')) alarms.push(t); } });
      let ann = w.sock('ann'), bob = w.sock('bob'); w.fund('ann', 'play', 1e8); w.fund('bob', 'play', 1e8);
      const stt = (k) => w.store().player(k, 'play');
      w.store().setPlayer('ann', 'play', Object.assign(E.newState(), { lt: 4480, avg: 2500 })); w.store().flush(); w.store().compact();            // checkpoint 1
      let k = 0; while (!(stt('ann') && stt('ann').cb) && k < 80) { await drive(w, ann, { bet: 2500, mode: 'play' }, k); k++; }
      assert.ok(stt('ann').cb, 'a Callback is armed');
      await sleep(30); w.store().compact();                                                                                                        // checkpoint 2: the armed Callback
      const cb = await drive(w, ann, { bet: 2500, mode: 'play' }, 100); assert.ok(cb.callback, 'the Callback is played');
      await sleep(30); w.store().compact();                                                                                                        // checkpoint 3: the played Callback (main); .bak = checkpoint 2
      for (let i = 0; i < 6; i++) await drive(w, bob, { bet: 2500, mode: 'play' }, 200 + i);
      const annMem = clone(stt('ann')), bobMem = JSON.stringify(stt('bob')), refs = () => w.lines().filter((l) => JSON.stringify(l).includes(String(cb.id))).length, before = refs();
      await sleep(30); w.crash(); fs.writeFileSync(w.files.pull, TORN);
      w.boot(); ann = w.sock('ann'); bob = w.sock('bob');
      const boot = clone(stt('ann')); assert.strictEqual(boot.cb, null, 'the played Callback is not armed again'); assert.strictEqual(boot.callbacks, annMem.callbacks); assert.strictEqual(boot.lt, annMem.lt); assert.strictEqual(JSON.stringify(stt('bob')), bobMem);
      assert.ok(alarms.some((a) => /restored from .*\.bak and replayed/.test(a)), 'the restore is loud');
      const b2 = w.bal('ann', 'play'), again = await drive(w, ann, { bet: 2500, mode: 'play' }, 300);
      assert.strictEqual(again.kind, 'done'); assert.ok(!again.callback, 'her next spin is a paid one, not that Callback again'); assert.strictEqual(again.cost, 2500);
      assert.strictEqual(refs(), before, 'the ledger holds the Callback round once'); assert.strictEqual(w.conservation('play').everything, 0);
      void b2;
    });
  }
  console.log('\n' + passed + ' passed' + (process.exitCode ? ', FAILED' : ''));
  process.exit(process.exitCode || 0);
})();
