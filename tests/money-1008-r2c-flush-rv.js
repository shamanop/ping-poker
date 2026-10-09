'use strict';
// node tests/money-1008-r2c-flush-rv.js   (MONEY 1008 R2C-5 review rows RV-1 .. RV-7: what a journal line must never do, and what a store that cannot be written must refuse)
// RV-1 a settle the ledger refused leaves nothing that boot replays; RV-2 a line of the wrong shape never throws at boot; RV-3 / RV-4 every unusable line is one log line with its reason, loud when it
// names a round the ledger holds, and the good lines after a bad one are applied; RV-6 the journal has an upper bound while checkpoints fail; RV-7 a spin whose state cannot be written does not happen.
process.env.COLDCALL_JOURNAL = '1';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-rv-'));
const H = require('./lib-coldcall-ledger.js');
const E = require('../games/coldcall-engine.js');
const { createStore } = require('../games/coldcall-store.js');

setTimeout(() => { console.error('FAIL watchdog: the test did not finish in 240 s'); process.exit(1); }, 240000).unref();
let n = 0, passed = 0;
const test = async (name, fn) => { try { await fn(); console.log('ok   ' + name); passed++; } catch (e) { console.error('FAIL ' + name + '\n' + (e.stack || e)); process.exitCode = 1; } };
const world = (o = {}) => H.world({ dir: fs.mkdtempSync(path.join(tmp, 'w' + ++n + '-')), potRng: () => 1, ...o });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (o) => JSON.parse(JSON.stringify(o));
const sum8 = (t) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 8);
const mkline = (obj) => { const j = JSON.stringify(obj); return sum8(j) + '\t' + j + '\n'; };
const st = (lt) => Object.assign(E.newState(), { lt });
const dirOf = () => fs.mkdtempSync(path.join(tmp, 'd' + ++n + '-'));
const openStore = (file, extra = {}) => { const alarms = [], logs = []; const s = createStore(file, { journal: true, log: (...a) => logs.push(a.join(' ')), alarm: (...a) => alarms.push(a.join(' ')), ...extra }); return { s, alarms, logs }; };

// send a spin (decisions answered by the policy) and wait for the first of: a done result, an error, a voided notice; or 'timeout'
function drive(w, s, payload, i = 0) {
  return new Promise((resolve) => {
    const push = s.out.push.bind(s.out); let k = 0; const t = setTimeout(() => { s.out.push = push; resolve({ timeout: true }); }, 8000);
    const end = (v) => { clearTimeout(t); s.out.push = push; resolve(v); };
    s.out.push = (e) => {
      const r = push(e);
      if (e[0] === 'error') end({ error: e[1] });
      else if (e[0] === 'g:coldcall:voided') end({ voided: e[1] });
      else if (e[0] === 'g:coldcall:result') {
        if (e[1].status === 'pending') setImmediate(() => { w.clock.advance(5); s.send('g:coldcall:decide', { roundId: e[1].roundId, ...H.policy(i + k++, e[1].pending) }); });
        else end(e[1]);
      }
      return r;
    };
    w.clock.advance(200); s.send('g:coldcall:spin', payload);
  });
}
const mismatch = () => Object.assign(new Error('stake mismatch (test)'), { code: 'stake_mismatch' });
const spends = (w) => w.lines((e) => e.reason === 'coldcall:spend').length;

(async () => {
  // ---------------------------------------------------------------- RV-1
  await test('RV-1 a paid buy round whose settle the ledger refuses (stake_mismatch -> voided) is not replayed by a restart: refunded, no state', async () => {
    const w = world({ rng: E.rngFrom(24), roundRng: E.rngFrom(25) }); const s = w.sock('ann'); w.fund('ann', 'play', 1e9);
    const bal0 = w.bal('ann', 'play'); w.hooks.before.settle = () => { throw mismatch(); };
    let r = null; for (let i = 0; i < 40 && !(r && r.voided); i++) { r = await drive(w, s, { bet: 10, mode: 'play', buyBonus: 'bonus1' }, i); assert.ok(!r.timeout && !r.error, JSON.stringify(r)); }
    assert.ok(r.voided, 'the round was voided'); assert.strictEqual(w.bal('ann', 'play'), bal0, 'the stake went back');
    assert.strictEqual(w.store().player('ann', 'play'), null, 'memory holds no state of the voided round');
    w.reboot();
    assert.strictEqual(w.store().player('ann', 'play'), null, 'after the restart the voided round left no state either'); assert.strictEqual(w.bal('ann', 'play'), bal0); assert.strictEqual(w.escrows('play').length, 0); w.crash();
  });

  await test('RV-1 a Callback round (free, 0 win) whose settle is refused and voided keeps the Callback armed across a restart', async () => {
    let tried = 0, hit = 0;
    for (let seed = 40; seed < 70 && hit < 2; seed++) {
      const w = world({ rng: E.rngFrom(seed), roundRng: E.rngFrom(seed + 100) }); const s = w.sock('ann'); w.fund('ann', 'chips', 1e8);
      w.store().setPlayer('ann', 'chips', Object.assign(E.newState(), { cb: { bet: 100, id: 'cbrv' + seed }, lt: 4400, avg: 100 })); w.store().flush();
      w.hooks.before.settle = () => { throw mismatch(); };
      const r = await drive(w, s, { bet: 100, mode: 'chips' }, 0); tried++;
      assert.ok(r.voided || r.error, 'the refused settle did not give a result: ' + JSON.stringify(r).slice(0, 120));
      const mem = w.store().player('ann', 'chips'); assert.ok(mem && mem.cb, 'the Callback is still armed in memory');
      w.reboot();
      const after = w.store().player('ann', 'chips'); assert.ok(after && after.cb && after.cb.id === 'cbrv' + seed, 'after the restart the Callback is still armed (seed ' + seed + '): ' + JSON.stringify(after && after.cb));
      assert.strictEqual(after.rounds, 0, 'and the round it would have played was not counted'); hit++; w.crash();
    }
    assert.ok(hit >= 2, 'ran ' + hit + ' of ' + tried);
  });

  await test('RV-1 a settle the ledger refuses with a plain error (the round stays open): a restart does not apply its line either; the round is then settled once from its record', async () => {
    const w = world({ rng: E.rngFrom(24), roundRng: E.rngFrom(25) }); const s = w.sock('ann'); w.fund('ann', 'play', 1e9);
    w.hooks.before.settle = () => { throw Object.assign(new Error('ledger said no (test)'), { code: 'internal' }); };
    let r = null; for (let i = 0; i < 40 && !(r && r.error); i++) { r = await drive(w, s, { bet: 10, mode: 'play', buyBonus: 'bonus1' }, i); assert.ok(!r.timeout, 'timeout'); if (r.voided) throw new Error('voided'); }
    assert.ok(r.error, 'the client was told an error'); assert.strictEqual(w.store().player('ann', 'play'), null);
    assert.ok(/"x":\d+/.test(fs.readFileSync(w.files.pull + '.journal', 'utf8')), 'the refused call is cancelled in the journal');
    w.hooks.before.settle = null; w.reboot();                       // recover(): the record is still there, the escrow too: settled once
    assert.strictEqual(w.escrows('play').length, 0, 'settled at boot'); assert.strictEqual(spends(w), 1, 'exactly one stake'); w.crash();
  });

  // ---------------------------------------------------------------- RV-2 / RV-3 / RV-4
  const goodLine = (s, key, lt, extra = {}) => mkline({ s, p: [[key, 'chips', st(lt)]], ...extra });
  await test('RV-2 a checksummed line of the wrong shape never throws at boot: one loud line with the reason, the good lines around it are applied, the bytes are kept', async () => {
    for (const bad of [{ p: [5] }, { p: 'x' }, { o: 3 }, { o: [[1, null]] }, { t: [['chips', 7]] }, { c: 5 }, { c: { k: 1, i: 2 } }, { x: 'a' }, { p: [['a', 'nomode', {}]] }]) {
      const dir = dirOf(), file = path.join(dir, 'coldcall-pull.json');
      fs.writeFileSync(file + '.journal', goodLine(1, 'a', 11) + mkline({ s: 2, ...bad }) + goodLine(3, 'b', 33));
      let o; assert.doesNotThrow(() => { o = openStore(file); }, JSON.stringify(bad));
      assert.strictEqual(o.s.player('a', 'chips').lt, 11); assert.strictEqual(o.s.player('b', 'chips').lt, 33, 'the good line after it is applied');
      assert.strictEqual(o.alarms.filter((a) => /journal line 2 .*wrong shape/.test(a)).length, 1, JSON.stringify(bad) + ' -> ' + o.alarms.join(' | '));
      assert.strictEqual(fs.readdirSync(dir).filter((f) => f.includes('.journal.damaged-')).length, 1); o.s.close();
    }
  });

  await test('RV-3 a torn last line is one log line with the reason; it is LOUD when it names a round the ledger holds, quiet-but-worded when the ledger does not hold it; boot never throws', async () => {
    const torn = (id) => '12345678\t{"s":3,"c":{"k":"ann","i":"' + id + '"},"p":[["ann","chips",{"v":1,"lt":9999';
    for (const [held, id] of [[true, 'heldround'], [false, 'ghostround']]) {
      const dir = dirOf(), file = path.join(dir, 'coldcall-pull.json');
      fs.writeFileSync(file + '.journal', goodLine(1, 'a', 11) + goodLine(2, 'b', 22) + torn(id));
      const o = openStore(file, { confirm: (k, i) => (i === 'heldround') });
      assert.strictEqual(o.s.player('b', 'chips').lt, 22);
      const all = o.alarms.concat(o.logs).filter((l) => /journal line 3/.test(l)); assert.strictEqual(all.length, 1, 'one line about it: ' + all.join(' | ')); assert.ok(/never completed/.test(all[0]), all[0]);
      assert.strictEqual(o.alarms.some((a) => /LEDGER HOLDS/.test(a)), held, 'loud exactly when the ledger holds the round: ' + o.alarms.join(' | ')); o.s.close();
    }
    const dir = dirOf(), file = path.join(dir, 'coldcall-pull.json'); fs.writeFileSync(file + '.journal', goodLine(1, 'a', 11) + 'zz'); assert.doesNotThrow(() => openStore(file, { confirm: () => { throw new Error('ledger down'); } }).s.close());
  });

  await test('RV-4 a bad checksum in the middle drops that line only: the good lines after it are applied (each line is absolute), loud, bytes kept, next boot quiet', async () => {
    const dir = dirOf(), file = path.join(dir, 'coldcall-pull.json');
    const ls = [goodLine(1, 'p1', 1), goodLine(2, 'p2', 2), goodLine(3, 'p3', 3), goodLine(4, 'p4', 4)]; ls[1] = ls[1].slice(0, 20) + 'X' + ls[1].slice(21);
    fs.writeFileSync(file + '.journal', ls.join(''));
    const o = openStore(file);
    assert.deepStrictEqual([1, 2, 3, 4].map((i) => o.s.player('p' + i, 'chips') && o.s.player('p' + i, 'chips').lt), [1, null, 3, 4]);
    assert.strictEqual(o.alarms.filter((a) => /journal line 2 .*checksum/.test(a)).length, 1, o.alarms.join(' | ')); assert.ok(o.alarms.some((a) => /3 good line\(s\) were applied/.test(a)));
    assert.strictEqual(fs.readdirSync(dir).filter((f) => f.includes('.journal.damaged-')).length, 1); o.s.close();
    const o2 = openStore(file); assert.deepStrictEqual(o2.alarms, [], 'the next boot is quiet'); assert.strictEqual(o2.s.player('p4', 'chips').lt, 4); o2.s.close();
  });

  // ---------------------------------------------------------------- RV-6
  await test('RV-6 while the checkpoint keeps failing the journal has an upper bound (maxJournal): over it a line is refused; a checkpoint that works again lets spins through', async () => {
    const dir = dirOf(), file = path.join(dir, 'coldcall-pull.json'); const o = openStore(file, { maxJournal: 3000 });
    const ren = fs.renameSync; fs.renameSync = (a, b) => { if (String(b).endsWith('coldcall-pull.json')) throw Object.assign(new Error('no space (test)'), { code: 'ENOSPC' }); return ren(a, b); };
    let accepted = 0, refused = 0;
    try { for (let i = 0; i < 60; i++) { try { o.s.intent({ ref: { key: 'a', id: 'r' + i }, player: ['a', 'chips', st(i)] }); accepted++; } catch { refused++; } } }
    finally { fs.renameSync = ren; }
    assert.ok(accepted > 3 && accepted < 40 && refused > 0, 'accepted ' + accepted + ', refused ' + refused); assert.ok(fs.statSync(file + '.journal').size < 3000 + 600, 'the journal stopped growing near the bound: ' + fs.statSync(file + '.journal').size);
    await sleep(1100); assert.doesNotThrow(() => o.s.intent({ ref: { key: 'a', id: 'again' }, player: ['a', 'chips', st(99)] }), 'a checkpoint that works again opens it'); o.s.close(true);
  });

  await test('RV-6 a failed timer checkpoint is retried after 5 s (not only at the next line)', async () => {
    const dir = dirOf(), file = path.join(dir, 'coldcall-pull.json'); const o = openStore(file);
    const sto = global.setTimeout; const armed = []; global.setTimeout = (fn, ms, ...r) => { const t = sto(fn, ms, ...r); armed.push({ fn, ms }); return t; };
    const ren = fs.renameSync; let fail = true; fs.renameSync = (a, b) => { if (fail && String(b).endsWith('coldcall-pull.json')) throw new Error('nope'); return ren(a, b); };
    try {
      o.s.intent({ ref: { key: 'a', id: 'x' }, player: ['a', 'chips', st(1)] });
      const first = armed.find((t) => t.ms === 10000); assert.ok(first, 'the first line arms the checkpoint timer');
      first.fn();                                                                       // the timer fires and the checkpoint fails
      const retry = armed.filter((t) => t.ms === 5000); assert.strictEqual(retry.length, 1, 'a retry is armed'); assert.ok(o.logs.some((l) => /checkpoint failed, will retry/.test(l)));
      fail = false; retry[0].fn(); assert.strictEqual(fs.statSync(file + '.journal').size, 0, 'the retry succeeded and emptied the journal'); assert.ok(fs.existsSync(file));
    } finally { fs.renameSync = ren; global.setTimeout = sto; }
    o.s.close(true);
  });

  // ---------------------------------------------------------------- RV-7
  await test('RV-7 the journal line cannot be written (ENOSPC): the spin does not happen: same error whatever was drawn, no stake, no state; when the disk is back the next spin works', async () => {
    const w = world({ rng: E.rngFrom(61), roundRng: E.rngFrom(62) }); const s = w.sock('ann'); w.fund('ann', 'chips', 1e8); w.fund('ann', 'play', 1e8);
    await drive(w, s, { bet: 10, mode: 'chips' }, 0);                                    // one spin on a healthy store (opens the journal)
    const before = { chips: w.bal('ann', 'chips'), play: w.bal('ann', 'play'), lines: w.lines().length, st: clone(w.store().player('ann', 'chips')) };
    const ws = fs.writeSync; fs.writeSync = (fd, ...a) => { if (fd === jfd(w)) throw Object.assign(new Error('ENOSPC: no space left (test)'), { code: 'ENOSPC' }); return ws(fd, ...a); };
    const answers = [];
    try { for (const [mode, bet] of [['chips', 10], ['chips', 100], ['play', 10], ['play', 500], ['chips', 1], ['play', 100]]) answers.push(await drive(w, s, { bet, mode }, 3)); }
    finally { fs.writeSync = ws; }
    for (const a of answers) assert.ok(a.error && a.error.code === 'internal', 'every refused spin got the same error: ' + JSON.stringify(a).slice(0, 150));
    assert.strictEqual(new Set(answers.map((a) => JSON.stringify({ c: a.error.code, m: a.error.message }))).size, 1, 'the same answer whatever the bet or the draw');
    assert.deepStrictEqual({ chips: w.bal('ann', 'chips'), play: w.bal('ann', 'play'), lines: w.lines().length }, { chips: before.chips, play: before.play, lines: before.lines }, 'no stake was taken, no ledger line written');
    assert.deepStrictEqual(w.store().player('ann', 'chips'), before.st, 'the state did not advance');
    const ok = await drive(w, s, { bet: 10, mode: 'chips' }, 5); assert.strictEqual(ok.status, 'done', 'the disk is back: ' + JSON.stringify(ok).slice(0, 100)); w.crash();
  });

  await test('RV-7 the journal fsync fails: the spin that was already played is answered (the ledger holds it), the next ones are refused while the checkpoint fails too, and accepted again when it works', async () => {
    const w = world({ rng: E.rngFrom(63), roundRng: E.rngFrom(64) }); const s = w.sock('ann'); w.fund('ann', 'chips', 1e8);
    await drive(w, s, { bet: 10, mode: 'chips' }, 0);
    const fd = fs.fdatasync, ren = fs.renameSync; fs.fdatasync = (f, cb) => setImmediate(() => cb(Object.assign(new Error('EIO (test)'), { code: 'EIO' })));
    fs.renameSync = (a, b) => { if (String(b).endsWith('coldcall-pull.json')) throw new Error('checkpoint fails (test)'); return ren(a, b); };
    let first, second, lines2, bal2;
    try { first = await drive(w, s, { bet: 10, mode: 'chips' }, 1); lines2 = w.lines().length; bal2 = w.bal('ann', 'chips'); second = await drive(w, s, { bet: 10, mode: 'chips' }, 2); }
    finally { fs.fdatasync = fd; }
    assert.strictEqual(first.status, 'done', 'the played spin is answered'); assert.ok(second.error && second.error.code === 'internal', 'the next spin is refused: ' + JSON.stringify(second).slice(0, 120));
    assert.strictEqual(w.lines().length, lines2); assert.strictEqual(w.bal('ann', 'chips'), bal2, 'no stake for the refused spin');
    fs.renameSync = ren; await sleep(1100);
    const third = await drive(w, s, { bet: 10, mode: 'chips' }, 3); assert.strictEqual(third.status, 'done', 'after a checkpoint that works the spin is accepted: ' + JSON.stringify(third).slice(0, 100)); w.crash();
  });
  // the fd of the open journal of a world (the store keeps it private: find it the way the OS does)
  function jfd(w) { const target = fs.realpathSync(w.files.pull + '.journal'); for (const f of fs.readdirSync('/proc/self/fd')) { try { if (fs.readlinkSync('/proc/self/fd/' + f) === target) return Number(f); } catch {} } return -1; }

  console.log(passed + ' passed');
  process.exit(process.exitCode || 0);
})();
