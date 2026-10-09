'use strict';
// node tests/money-1008-r2c-flush.js   (MONEY 1008 R2C-5: a Cold Call spin must not rewrite + fsync the whole store file on the event loop)
// Journal mode (on under server.js; here COLDCALL_JOURNAL=1): a paid spin appends ONE small line to <store>.journal BEFORE its ledger call (a write(2), no fsync), and the result is held until an
// fsync of the journal returned (fs.fdatasync, off the event loop; spins finishing meanwhile share it). K2-5 holds: no result before what the spin earned is on disk. Boot applies a line only when
// the ledger holds the round, so a kill at any point keeps stake AND leads, or neither. Plain node; the real game + real ledger + real store (tests/lib-coldcall-ledger.js).
process.env.COLDCALL_JOURNAL = '1';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-flush-'));
const H = require('./lib-coldcall-ledger.js');
const E = require('../games/coldcall-engine.js');
const { createStore } = require('../games/coldcall-store.js');

let n = 0, passed = 0;
const test = async (name, fn) => { try { await fn(); console.log('ok   ' + name); passed++; } catch (e) { console.error('FAIL ' + name + '\n' + (e.stack || e)); process.exitCode = 1; } };
const world = (o = {}) => H.world({ dir: fs.mkdtempSync(path.join(tmp, 'w' + ++n + '-')), potRng: () => 1, ...o });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const JF = (w) => w.files.pull + '.journal';
const jlines = (w) => fs.readFileSync(JF(w), 'utf8').split('\n').filter(Boolean);
const inJournal = (w, k) => { let l = []; try { l = jlines(w); } catch {} assert.ok(l.length >= k, 'the spins went through the journal: ' + l.length + ' lines, wanted ' + k); };
const clone = (o) => JSON.parse(JSON.stringify(o));

// send one spin and wait for its end: the result (decisions answered by the policy) or an error
function spinWait(w, s, payload, i = 0) {
  return new Promise((resolve) => {
    const push = s.out.push.bind(s.out); let k = 0;
    s.out.push = (e) => {
      const r = push(e);
      if (e[0] === 'error') { s.out.push = push; resolve({ error: e[1] }); }
      else if (e[0] === 'g:coldcall:result') {
        if (e[1].status === 'pending') setImmediate(() => { w.clock.advance(5); s.send('g:coldcall:decide', { roundId: e[1].roundId, ...H.policy(i + k++, e[1].pending) }); });
        else { s.out.push = push; resolve(e[1]); }
      }
      return r;
    };
    w.clock.advance(200); s.send('g:coldcall:spin', payload);
  });
}
// the invariant of a store after a restart: the rounds the state counts are the paid rounds the ledger holds (rounds - callbacks = distinct stakes), per currency
function invariant(w, key) {
  const out = {};
  for (const cur of ['chips', 'play']) {
    const st = w.store().player(key, cur) || { rounds: 0, callbacks: 0 };
    const stakes = new Set(w.lines((e) => e.cur === cur && e.reason === 'coldcall:spend' && (e.from === (cur === 'chips' ? 'bank:' : 'play:') + key || e.from.startsWith('escrow:coldcall:' + key + ':'))).map((e) => e.batchRef || e.ref)).size;
    out[cur] = { paidRounds: st.rounds - st.callbacks, stakes };
  }
  return out;
}
const same = (w, key) => { const v = invariant(w, key); for (const c of ['chips', 'play']) assert.strictEqual(v[c].paidRounds, v[c].stakes, c + ': rounds in the state ' + v[c].paidRounds + ' vs stakes in the ledger ' + v[c].stakes); return v; };
// what a booted store would hold, from COPIES of the files (nothing of the live world is touched): the ledger decides which lines count
function bootCopy(w) {
  const d = fs.mkdtempSync(path.join(tmp, 'c' + ++n + '-')), f = path.join(d, 'coldcall-pull.json');
  for (const x of ['', '.journal']) { try { fs.copyFileSync(w.files.pull + x, f + x); } catch {} }
  return createStore(f, { journal: false, log: () => {}, alarm: () => {}, confirm: (k, id) => w.service.roundClosed('coldcall', k, id) });
}

(async () => {
  await test('a paid spin appends one small journal line and rewrites no file: 300 spins on a store with 5,000 players, 0 renames of the main file, no big write', async () => {
    const keys = Array.from({ length: 20 }, (_, i) => 'bot' + i);
    const w = world({ keys, rng: E.rngFrom(5), roundRng: E.rngFrom(6) }); for (const k of keys) w.fund(k, 'chips', 1e9);
    const st = w.store(); for (let i = 0; i < 5000; i++) st.setPlayer('filler' + i, i % 2 ? 'play' : 'chips', Object.assign(E.newState(), { lt: 1000 + i % 3000, avg: 100 })); st.flush(); if (st.compact) st.compact();
    const size = fs.statSync(w.files.pull).size; assert.ok(size > 500000, 'the store file is big: ' + size);
    const socks = keys.map((k) => w.sock(k));
    const ren = fs.renameSync, wf = fs.writeFileSync; let renames = 0, big = 0;
    fs.renameSync = (a, b) => { if (String(b).endsWith('coldcall-pull.json')) renames++; return ren(a, b); };
    fs.writeFileSync = (f, d, ...r) => { if (d && d.length > 100000) big++; return wf(f, d, ...r); };
    let done;
    try { done = (await Promise.all(socks.map(async (sk, a) => { const out = []; for (let i = 0; i < 15; i++) out.push(await spinWait(w, sk, { bet: 1, mode: 'chips' }, a * 15 + i)); return out; }))).flat(); }
    finally { fs.renameSync = ren; fs.writeFileSync = wf; }
    assert.ok(done.every((r) => r && r.status === 'done'), 'every spin ended in a result: ' + JSON.stringify(done.find((r) => !r || r.status !== 'done')));
    assert.strictEqual(renames, 0, 'main file renamed during the spins'); assert.strictEqual(big, 0, 'a whole-file sized write happened during the spins');
    const lines = jlines(w); assert.ok(lines.length >= 300 && lines.length < 400, 'one line per spin: ' + lines.length); assert.ok(Math.max(...lines.map((l) => l.length)) < size / 10, 'a line is small, whatever the store holds: ' + Math.max(...lines.map((l) => l.length)) + ' bytes vs a store of ' + size); assert.ok(lines.filter((l) => l.length < 1500).length >= 0.9 * lines.length, 'the lines of instant spins are about 300-600 bytes');
    w.crash();
  });

  await test('K2-5 holds: the result is NOT sent before the journal fsync returned; at that moment a store booted from the files holds the state and the leads', async () => {
    const w = world({ rng: E.rngFrom(7), roundRng: E.rngFrom(8) }); const s = w.sock('ann'); w.fund('ann', 'chips', 1e8); w.fund('ann', 'play', 1e8);
    const fd = fs.fdatasync; let calls = 0, finished = 0;
    fs.fdatasync = (f, cb) => { calls++; setTimeout(() => { fd(f, (e) => { finished++; cb(e); }); }, 40); };      // a slow disk
    try {
      for (const mode of ['chips', 'play']) for (let i = 0; i < 6; i++) {
        let seen = null; const push = s.out.push.bind(s.out);
        s.out.push = (e) => { if (e[0] === 'g:coldcall:result' && e[1].status === 'done') seen = { finished, mem: clone(w.store().player('ann', mode)), booted: bootCopy(w).player('ann', mode) }; return push(e); };
        const p = spinWait(w, s, { bet: 100, mode }, i); await sleep(5);
        assert.strictEqual(seen, null, 'no result while the fsync is still running');
        const r = await p; s.out.push = push; assert.strictEqual(r.status, 'done'); assert.ok(seen, 'the result went out');
        assert.ok(seen.finished >= 1, 'an fsync returned before the result'); assert.deepStrictEqual(seen.booted, seen.mem, 'at the moment of the result a boot from the files holds the state of the spin');
      }
    } finally { fs.fdatasync = fd; }
    assert.ok(calls >= 12); same(w, 'ann'); w.crash();
  });

  await test('group commit: 20 spins started in the same tick share fsyncs (fewer fdatasync calls than spins), every result still waits for an fsync', async () => {
    const keys = Array.from({ length: 20 }, (_, i) => 'g' + i);
    const w = world({ keys, rng: E.rngFrom(9), roundRng: E.rngFrom(10) }); for (const k of keys) w.fund(k, 'chips', 1e8);
    const socks = keys.map((k) => w.sock(k)); const fd = fs.fdatasync; let calls = 0;
    fs.fdatasync = (f, cb) => { calls++; setTimeout(() => fd(f, cb), 15); };
    try { const rs = await Promise.all(socks.map((s, i) => spinWait(w, s, { bet: 1, mode: 'chips' }, i))); assert.ok(rs.every((r) => r.status === 'done')); }
    finally { fs.fdatasync = fd; }
    assert.ok(calls >= 1 && calls < 10, 'fdatasync calls for 20 spins: ' + calls); w.crash();
  });

  await test('kill right after the last answered spin (no pause): a restart keeps the leads of every spin, both currencies, stakes == rounds', async () => {
    const w = world({ rng: E.rngFrom(11), roundRng: E.rngFrom(12) }); const s = w.sock('ann'); w.fund('ann', 'chips', 1e8); w.fund('ann', 'play', 1e8);
    for (let i = 0; i < 30; i++) { const r = await spinWait(w, s, { bet: i % 2 ? 100 : 10, mode: i % 2 ? 'play' : 'chips' }, i); assert.ok(!r.error, JSON.stringify(r.error)); }
    inJournal(w, 30); const mem = { chips: clone(w.store().player('ann', 'chips')), play: clone(w.store().player('ann', 'play')) };
    assert.ok(mem.chips.lt > 0 && mem.play.lt > 0);
    w.reboot(); assert.deepStrictEqual({ chips: w.store().player('ann', 'chips'), play: w.store().player('ann', 'play') }, mem); same(w, 'ann'); w.crash();
  });

  await test('kill AFTER the ledger call and BEFORE the fsync returned (no result was sent): stake and leads are both there after the restart', async () => {
    const w = world({ rng: E.rngFrom(13), roundRng: E.rngFrom(14) }); const s = w.sock('ann'); w.fund('ann', 'chips', 1e8);
    const fd = fs.fdatasync; fs.fdatasync = () => {};                       // the fsync never returns: the process is killed first
    let results = 0; const push = s.out.push.bind(s.out); s.out.push = (e) => { if (e[0] === 'g:coldcall:result') results++; return push(e); };
    try { w.clock.advance(200); s.send('g:coldcall:spin', { bet: 100, mode: 'chips' }); await sleep(30); } finally { fs.fdatasync = fd; }
    assert.strictEqual(results, 0, 'no result went out'); assert.strictEqual(w.lines((e) => e.cur === 'chips' && e.reason === 'coldcall:spend').length, 1, 'the stake is in the ledger');
    w.reboot(); const v = same(w, 'ann'); assert.strictEqual(v.chips.stakes, 1); assert.strictEqual(w.store().player('ann', 'chips').rounds, 1); w.crash();
  });

  await test('kill AFTER the journal line and BEFORE the ledger call: neither a stake nor leads after the restart (the line is not applied: the ledger does not hold the round)', async () => {
    const w = world({ rng: E.rngFrom(15), roundRng: E.rngFrom(16) }); const s = w.sock('ann'); w.fund('ann', 'chips', 1e8); w.fund('ann', 'play', 1e8);
    for (let i = 0; i < 4; i++) await spinWait(w, s, { bet: 10, mode: 'chips' }, i);
    const snap = fs.mkdtempSync(path.join(tmp, 's' + ++n + '-')); let took = false;
    w.hooks.before.round = () => { if (took) return; took = true; for (const f of fs.readdirSync(w.dir)) if (!f.endsWith('.tmp')) fs.copyFileSync(path.join(w.dir, f), path.join(snap, f)); throw new H.Crash(); };   // the files as they are at that instant
    w.clock.advance(200); s.send('g:coldcall:spin', { bet: 100, mode: 'chips' }); await sleep(20); assert.ok(took);
    const lastLine = JSON.parse(fs.readFileSync(path.join(snap, 'coldcall-pull.json.journal'), 'utf8').trim().split('\n').pop().split('\t')[1]);
    assert.ok(lastLine.c && lastLine.p.length === 1, 'the snapshot holds the line of the spin that never reached the ledger');
    w.crash();
    const w2 = H.world({ dir: snap, potRng: () => 1, keys: ['ann'] });
    const st = w2.store().player('ann', 'chips'); assert.strictEqual(st.rounds, 4, 'the state does not count the spin that was never charged'); same(w2, 'ann'); w2.crash();
  });

  await test('chips spins write no Cash line', async () => {
    const w = world({ rng: E.rngFrom(17), roundRng: E.rngFrom(18) }); const s = w.sock('bob'); w.fund('bob', 'chips', 1e8);
    const cash0 = w.lines((e) => e.cur === 'play').length;
    for (let i = 0; i < 25; i++) await spinWait(w, s, { bet: 10, mode: 'chips' }, i);
    inJournal(w, 25); assert.strictEqual(w.lines((e) => e.cur === 'play').length, cash0); w.crash();
  });

  await test('boot replay: lines at or below `jseq` are skipped; a journal restored over a newer checkpoint does not regress the state', async () => {
    const w = world({ rng: E.rngFrom(19), roundRng: E.rngFrom(20) }); const s = w.sock('ann'); w.fund('ann', 'chips', 1e8);
    for (let i = 0; i < 8; i++) await spinWait(w, s, { bet: 10, mode: 'chips' }, i);
    const oldJournal = fs.readFileSync(JF(w)); w.store().compact(); assert.strictEqual(fs.statSync(JF(w)).size, 0, 'the checkpoint emptied the journal'); assert.ok(JSON.parse(fs.readFileSync(w.files.pull, 'utf8')).jseq >= 8);
    for (let i = 0; i < 3; i++) await spinWait(w, s, { bet: 10, mode: 'chips' }, 8 + i);
    w.store().compact(); const mem = clone(w.store().player('ann', 'chips'));
    w.crash(); fs.writeFileSync(JF(w), oldJournal);                  // a kill between the rename of the checkpoint and the emptying of the journal leaves exactly this
    const w2 = H.world({ dir: w.dir, potRng: () => 1, keys: ['ann'] }); assert.deepStrictEqual(w2.store().player('ann', 'chips'), mem); same(w2, 'ann'); w2.crash();
  });

  await test('line numbers go on after a checkpoint: spins after a restart with an EMPTY journal and a checkpoint at seq N survive the next restart (found by the kill loop)', async () => {
    const w = world({ rng: E.rngFrom(31), roundRng: E.rngFrom(32) }); const s = w.sock('ann'); w.fund('ann', 'chips', 1e8);
    for (let i = 0; i < 6; i++) await spinWait(w, s, { bet: 10, mode: 'chips' }, i);
    w.store().compact(); assert.strictEqual(fs.statSync(JF(w)).size, 0);
    w.reboot();                                                                           // boots on a checkpoint with jseq >= 6 and an empty journal
    const s2 = w.sock('ann'); for (let i = 0; i < 4; i++) await spinWait(w, s2, { bet: 10, mode: 'chips' }, 6 + i);
    const mem = clone(w.store().player('ann', 'chips')); assert.strictEqual(mem.rounds, 10);
    w.reboot(); assert.deepStrictEqual(w.store().player('ann', 'chips'), mem, 'the 4 spins after the restart are still there after the next one'); same(w, 'ann'); w.crash();
  });

  await test('a torn last line (never acknowledged) is dropped; the lines before it are applied', async () => {
    const w = world({ rng: E.rngFrom(21), roundRng: E.rngFrom(22) }); const s = w.sock('ann'); w.fund('ann', 'chips', 1e8);
    for (let i = 0; i < 5; i++) await spinWait(w, s, { bet: 10, mode: 'chips' }, i);
    inJournal(w, 5); const mem = clone(w.store().player('ann', 'chips')); w.crash();
    fs.appendFileSync(JF(w), 'deadbeef\t{"s":99,"c":{"k":"ann","i":"x"},"p":[["ann","chips",{"v":1,"lt":9999');          // cut mid-line
    const w2 = H.world({ dir: w.dir, potRng: () => 1, keys: ['ann'] });
    assert.deepStrictEqual(w2.store().player('ann', 'chips'), mem); same(w2, 'ann'); w2.crash();
  });

  await test('a bad line with lines after it is damage: loud, bytes kept, the lines before it applied, nothing read as empty', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'j' + ++n + '-')), file = path.join(dir, 'coldcall-pull.json'), alarms = [];
    const a = createStore(file, { journal: true, log: () => {}, alarm: () => {} });
    for (let i = 1; i <= 4; i++) { a.setPlayer('p' + i, 'chips', Object.assign(E.newState(), { lt: i })); a.flush(); }
    a.close(true);
    const ls = fs.readFileSync(file + '.journal', 'utf8').split('\n').filter(Boolean); assert.strictEqual(ls.length, 4);
    ls[1] = ls[1].slice(0, 20) + 'X' + ls[1].slice(21);                                  // bit rot in line 2 with two good lines after it
    fs.writeFileSync(file + '.journal', ls.join('\n') + '\n');
    const b = createStore(file, { journal: true, log: () => {}, alarm: (...x) => alarms.push(x.join(' ')) });
    assert.strictEqual(alarms.length, 1); assert.ok(/bad line \(line 2 of 4/.test(alarms[0]) && /were NOT/.test(alarms[0]), alarms[0]);
    assert.strictEqual(b.player('p1', 'chips').lt, 1); assert.strictEqual(b.player('p3', 'chips'), null);
    assert.strictEqual(fs.readdirSync(dir).filter((f) => f.includes('.journal.damaged-')).length, 1, 'the damaged bytes are kept');
    b.close(); const c = createStore(file, { journal: true, log: () => {}, alarm: (...x) => alarms.push(x.join(' ')) }); assert.strictEqual(alarms.length, 1, 'the next boot is quiet'); assert.strictEqual(c.player('p1', 'chips').lt, 1); c.close();
  });

  await test('a journal that cannot be read blocks the store (fail closed): every write throws and the main file is not touched', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'u' + ++n + '-')), file = path.join(dir, 'coldcall-pull.json'), alarms = [];
    fs.mkdirSync(file + '.journal');                                                       // reading a directory fails with EISDIR
    const s = createStore(file, { journal: true, log: () => {}, alarm: (...x) => alarms.push(x.join(' ')) });
    assert.ok(s.blocked(), 'blocked'); assert.ok(/BLOCKED/.test(alarms.join('|'))); assert.throws(() => { s.setPlayer('a', 'play', E.newState()); s.flush(); }); assert.strictEqual(fs.existsSync(file), false);
  });

  await test('a buy-bonus spin (open record, decisions) is journaled too: a restart in the middle of the decisions settles the open round once and the state matches the ledger', async () => {
    const w = world({ rng: E.rngFrom(24), roundRng: E.rngFrom(25) }); const s = w.sock('ann'); w.fund('ann', 'play', 1e9);
    let r = null;
    for (let i = 0; i < 600 && !r; i++) { const x = await new Promise((res) => { const push = s.out.push.bind(s.out); s.out.push = (e) => { const q = push(e); if (e[0] === 'g:coldcall:result' || e[0] === 'error') { s.out.push = push; res(e[1]); } return q; }; w.clock.advance(200); s.send('g:coldcall:spin', { bet: 10, mode: 'play', buyBonus: 'bonus1' }); }); if (x.status === 'pending') r = x; else if (x.error) throw new Error(JSON.stringify(x.error)); }
    assert.ok(r, 'a buy stopped at a decision'); assert.strictEqual(w.escrows('play').length, 1); inJournal(w, 1);
    w.reboot();                                                                            // recover(): the stored record is replayed with the safe defaults and settled in ONE ledger call
    assert.strictEqual(w.escrows('play').length, 0, 'no escrow left'); assert.strictEqual(w.lines((e) => e.reason === 'coldcall:spend').length, 1, 'settled once'); assert.ok(!w.store().getOpen('ann', 'play'), 'the open record is gone'); w.reboot(); assert.ok(!w.store().getOpen('ann', 'play') && w.escrows('play').length === 0, 'and stays gone after a second restart'); w.crash();
  });

  console.log(passed + ' passed');
  process.exit(process.exitCode || 0);
})();
