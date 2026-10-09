'use strict';
// node tests/money-1008-r2c-flush-rw.js   (MONEY 1008 R2C-5 review rows RW-1, RW-2, RW-3, RW-6)
// RW-1: a store that cannot take journal lines refuses EVERY draw the same way, BEFORE the draw. The probe used to sit in settle() only, so the draws that settle at once were refused for free and the draws that
// stop at a decision (stake in escrow, record flushed) were taken and paid after the heal: a filter on the draw, in Cash. Three faults: (a) a journal fsync that failed and a checkpoint that fails, appends work;
// (b) the journal over its bound (COLDCALL_JOURNAL_MAX) and a checkpoint that fails, no fsync fault; (c) ENOSPC on the journal. In each: plain spins AND buys of bonus1: every answer `internal`, no escrow, no
// open record, no ledger line, no state; after the heal play goes on. RW-3: the bound also stops record lines (flush). RW-6: a half-written line is cut off again.
process.env.COLDCALL_JOURNAL = '1';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-rw-'));
const H = require('./lib-coldcall-ledger.js');
const E = require('../games/coldcall-engine.js');
const { createStore } = require('../games/coldcall-store.js');

setTimeout(() => { console.error('FAIL watchdog: the test did not finish in 240 s'); process.exit(1); }, 240000).unref();
let n = 0, passed = 0;
const test = async (name, fn) => { try { await fn(); console.log('ok   ' + name); passed++; } catch (e) { console.error('FAIL ' + name + '\n' + (e.stack || e)); process.exitCode = 1; } };
const world = (o = {}) => H.world({ dir: fs.mkdtempSync(path.join(tmp, 'w' + ++n + '-')), potRng: () => 1, ...o });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = (lt) => Object.assign(E.newState(), { lt });

function drive(w, s, payload, i = 0) {
  return new Promise((resolve) => {
    const push = s.out.push.bind(s.out); let k = 0; const t = setTimeout(() => { s.out.push = push; resolve({ timeout: true }); }, 8000);
    const end = (v) => { clearTimeout(t); s.out.push = push; resolve(v); };
    s.out.push = (e) => {
      const r = push(e);
      if (e[0] === 'error') end({ error: e[1] });
      else if (e[0] === 'g:coldcall:voided') end({ voided: e[1] });
      else if (e[0] === 'g:coldcall:result') {
        if (e[1].status === 'pending') end({ pending: e[1] });          // a draw that reached a decision: that is the fault of RW-1, whatever happens next
        else end(e[1]);
      }
      return r;
    };
    w.clock.advance(200); s.send('g:coldcall:spin', payload);
  });
}
function jfd(w) { const target = fs.realpathSync(w.files.pull + '.journal'); for (const f of fs.readdirSync('/proc/self/fd')) { try { if (fs.readlinkSync('/proc/self/fd/' + f) === target) return Number(f); } catch {} } return -1; }
const failRename = () => { const ren = fs.renameSync; fs.renameSync = (a, b) => { if (String(b).endsWith('coldcall-pull.json')) throw Object.assign(new Error('checkpoint fails (test)'), { code: 'ENOSPC' }); return ren(a, b); }; return () => { fs.renameSync = ren; }; };

// the fault is installed by `fault(w, s)` -> a heal function. Then N plain spins and N buys must all be refused with the same error and leave nothing.
async function faulted(label, opts, fault) {
  if (opts.max) process.env.COLDCALL_JOURNAL_MAX = String(opts.max);
  let w; try { w = world({ rng: E.rngFrom(71), roundRng: E.rngFrom(72) }); } finally { delete process.env.COLDCALL_JOURNAL_MAX; }
  const s = w.sock('ann'); w.fund('ann', 'play', 1e10);
  const ok0 = await drive(w, s, { bet: 100, mode: 'play' }, 0); assert.strictEqual(ok0.status, 'done', 'a healthy store plays: ' + JSON.stringify(ok0).slice(0, 100));
  const heal = await fault(w, s);
  let healed = false; const healOnce = async () => { if (!healed) { healed = true; await heal(); } };
  try {
  const base = { lines: w.lines().length, bal: w.bal('ann', 'play'), st: JSON.stringify(w.store().player('ann', 'play')) };
  const answers = [];
  for (let i = 0; i < 12; i++) answers.push(await drive(w, s, { bet: 100, mode: 'play' }, i));
  for (let i = 0; i < 12; i++) answers.push(await drive(w, s, { bet: 10, mode: 'play', buyBonus: i % 2 ? 'bonus2' : 'bonus1' }, i));
  const bad = answers.filter((a) => !(a.error && a.error.code === 'internal' && a.error.message === 'Server error'));
  assert.strictEqual(bad.length, 0, label + ': ' + bad.length + ' of ' + answers.length + ' spins were not refused with the same error, e.g. ' + String(JSON.stringify(bad[0])).slice(0, 160));
  assert.strictEqual(w.escrows().length, 0, 'no stake in escrow'); assert.strictEqual(w.store().allOpen().length, 0, 'no open record');
  assert.deepStrictEqual({ lines: w.lines().length, bal: w.bal('ann', 'play'), st: JSON.stringify(w.store().player('ann', 'play')) }, base, 'no ledger line, no balance change, no state change');
  } catch (e) { await healOnce(); throw e; }      // a failed assertion must not leave a fault shim installed for the next test
  await healOnce(); const back = await drive(w, s, { bet: 100, mode: 'play' }, 99);
  assert.ok(back.status === 'done' || back.pending, 'after the heal play goes on: ' + JSON.stringify(back).slice(0, 120)); w.crash();
}

(async () => {
  await test('RW-1 (a) a journal fsync failed and the checkpoint fails (appends work): every plain spin and every buy is refused before the draw, none taken', async () => {
    await faulted('a', {}, async (w, s) => {
      const fd = fs.fdatasync; fs.fdatasync = (f, cb) => setImmediate(() => cb(Object.assign(new Error('EIO (test)'), { code: 'EIO' })));
      let r; try { r = await drive(w, s, { bet: 100, mode: 'play' }, 1); await sleep(30); } finally { fs.fdatasync = fd; }      // this spin is already played: answered; the store remembers the fault
      assert.ok(r.status === 'done' || r.pending);
      if (r.pending) { w.reboot(); w.sock('ann'); }                                                                         // a pending draw: settle it at boot, keep the test simple
      const unrename = failRename(); return async () => { unrename(); await sleep(1100); };
    });
  });

  await test('RW-1 (b) the journal is over its bound and the checkpoint fails (no fsync fault): every plain spin and every buy is refused before the draw', async () => {
    await faulted('b', { max: 5000 }, async (w, s) => {
      const unrename = failRename(); let refused = false;
      for (let i = 0; i < 60 && !refused; i++) { const r = await drive(w, s, { bet: 100, mode: 'play' }, i); if (r.error) refused = true; else if (r.pending) { for (let k = 0; k < 8; k++) { const o = [...(w.store().allOpen())][0]; if (!o) break; w.clock.advance(200000); await sleep(5); } } }
      assert.ok(refused, 'the bound was reached');
      return async () => { unrename(); await sleep(1100); };
    });
  });

  await test('RW-1 / RW-2 (c) ENOSPC on the journal: every plain spin and every buy gets the same answer, none taken (a buy used to be voided after an open + void in the ledger)', async () => {
    await faulted('c', {}, async (w) => {
      const fd0 = jfd(w), ws = fs.writeSync; fs.writeSync = (fd, ...a) => { if (fd === fd0) throw Object.assign(new Error('ENOSPC: no space left (test)'), { code: 'ENOSPC' }); return ws(fd, ...a); };
      return async () => { fs.writeSync = ws; };
    });
  });

  await test('RW-3 the bound also stops the lines of records (flush): over it a record line is refused and the journal stops growing', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'd' + ++n + '-')), file = path.join(dir, 'coldcall-pull.json');
    const s = createStore(file, { journal: true, maxJournal: 3000, log: () => {}, alarm: () => {} }); const unrename = failRename();
    let accepted = 0, refused = 0;
    try { for (let i = 0; i < 80; i++) { try { s.putOpen({ key: 'a' + i, mode: 'play', roundId: 'r' + i, pad: 'x'.repeat(200) }); s.flush(); accepted++; } catch { refused++; } } } finally { unrename(); }
    assert.ok(accepted > 2 && refused > 0, 'accepted ' + accepted + ', refused ' + refused); assert.ok(fs.statSync(file + '.journal').size < 3000 + 1200, 'the journal stopped near the bound: ' + fs.statSync(file + '.journal').size); s.close(true);
  });

  await test('RW-6 a half-written line (the disk fills in the middle of a write) is cut off again: the journal is byte for byte what it was, and the next boot has no bad line', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'h' + ++n + '-')), file = path.join(dir, 'coldcall-pull.json'), alarms = [], logs = [];
    const s = createStore(file, { journal: true, log: (...a) => logs.push(a.join(' ')), alarm: (...a) => alarms.push(a.join(' ')) });
    s.intent({ ref: { key: 'a', id: 'one' }, player: ['a', 'chips', st(1)] });
    const before = fs.readFileSync(file + '.journal');
    const ws = fs.writeSync; let calls = 0; fs.writeSync = (fd, buf, off, len, ...r) => { calls++; if (calls === 1) return ws(fd, buf, off, 20);            // the disk takes 20 bytes of the line ...
      if (calls === 2) throw Object.assign(new Error('ENOSPC (test)'), { code: 'ENOSPC' });                                  // ... and refuses the rest
      return ws(fd, buf, off, len, ...r); };
    try { assert.throws(() => s.intent({ ref: { key: 'a', id: 'two' }, player: ['a', 'chips', st(2)] })); } finally { fs.writeSync = ws; }
    assert.ok(fs.readFileSync(file + '.journal').equals(before), 'the half line is gone');
    s.intent({ ref: { key: 'a', id: 'three' }, player: ['a', 'chips', st(3)] }); s.close(true);
    const t = createStore(file, { journal: true, log: (...a) => logs.push(a.join(' ')), alarm: (...a) => alarms.push(a.join(' ')), confirm: () => true });
    assert.deepStrictEqual(alarms, [], 'no bad line at boot'); assert.strictEqual(t.player('a', 'chips').lt, 3); t.close();
  });

  console.log(passed + ' passed');
  process.exit(process.exitCode || 0);
})();
