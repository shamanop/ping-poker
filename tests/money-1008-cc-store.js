'use strict';
// node tests/money-1008-cc-store.js   (MONEY 1008 K4-2: coldcall-pull.json holds Cash value that is not in the ledger: armed Callbacks and leads)
// A file that cannot be read is never overwritten and never treated as empty without a trace; it is kept under a dated name, a loud line says so, the last good copy is restored (one is kept);
// writes are temp + fsync + rename + directory fsync; one bad field resets that field of that player only, with a log line. Plain node, a real ledger world for the game-level cases.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { spawnSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-store-'));
const H = require('./lib-coldcall-ledger.js');
const E = require('../games/coldcall-engine.js');
const { createStore } = require('../games/coldcall-store.js');
const STORE_JS = path.join(__dirname, '../games/coldcall-store.js');

let pass = 0, n = 0;
const test = async (name, fn) => { try { await fn(); pass++; console.log('ok   ' + name); } catch (e) { console.error('FAIL ' + name + '\n' + (e.stack || e)); process.exitCode = 1; } };
const dirOf = () => fs.mkdtempSync(path.join(tmp, 'd' + ++n + '-'));
const stateWith = (extra) => Object.assign(E.newState(), extra);
const CB = (id, bet = 2500) => stateWith({ cb: { bet, id }, lt: 4400, avg: bet });
// a store with its loud lines collected; the quiet log collected apart
function open(file, extra = {}) { const alarms = [], logs = []; const s = createStore(file, { log: (...a) => logs.push(a.join(' ')), alarm: (...a) => alarms.push(a.join(' ')), ...extra }); return { s, alarms, logs }; }
const damaged = (dir, base = 'coldcall-pull.json') => fs.readdirSync(dir).filter((f) => f.startsWith(base + '.damaged-'));
const parses = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// a store with two writes behind it: main = ann + bob, .bak = ann only
function twoWrites(dir) {
  const file = path.join(dir, 'coldcall-pull.json'); const { s } = open(file);
  s.setPlayer('ann', 'play', CB('cbann1')); s.flush();
  s.setPlayer('bob', 'chips', CB('cbbob1', 100)); s.flush();
  s.close();
  return file;
}
const tear = (file, frac = 0.5) => { const b = fs.readFileSync(file); const t = b.subarray(0, Math.floor(b.length * frac)); fs.writeFileSync(file, t); return t; };

(async () => {
  await test('fresh data dir: a quiet start (no loud line, no extra file); the first save creates the file, no .bak yet', async () => {
    const dir = dirOf(), file = path.join(dir, 'coldcall-pull.json'); const { s, alarms, logs } = open(file);
    assert.deepStrictEqual([alarms, logs], [[], []]); assert.deepStrictEqual(fs.readdirSync(dir), []);
    s.setPlayer('ann', 'play', CB('c1')); s.flush(); s.close();
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['coldcall-pull.json']); assert.ok(parses(file).players.ann);
  });

  await test('writes keep exactly one previous version as .bak (the version before the last write), no .tmp is left', async () => {
    const dir = dirOf(), file = twoWrites(dir);
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['coldcall-pull.json', 'coldcall-pull.json.bak']);
    assert.deepStrictEqual(Object.keys(parses(file).players).sort(), ['ann', 'bob']); assert.deepStrictEqual(Object.keys(parses(file + '.bak').players), ['ann']);
  });

  await test('a torn file (half of it) with a good .bak: kept under a dated name, ONE loud line, restored from .bak, main rewritten whole; the next boot is quiet', async () => {
    const dir = dirOf(), file = twoWrites(dir); const torn = tear(file);
    const { s, alarms } = open(file);
    assert.strictEqual(alarms.length, 1, alarms.join('\n')); assert.ok(/Restored the Cold Call state from/.test(alarms[0]) && /cannot be used/.test(alarms[0]) && alarms[0].includes('.damaged-'), alarms[0]);
    const d = damaged(dir); assert.strictEqual(d.length, 1); assert.ok(fs.readFileSync(path.join(dir, d[0])).equals(torn), 'the damaged bytes are kept exactly');
    assert.strictEqual(s.player('ann', 'play').cb.id, 'cbann1'); assert.strictEqual(s.player('bob', 'chips'), null, 'the .bak is one write behind');
    assert.ok(parses(file), 'main was written whole at boot'); s.close();
    const again = open(file); assert.deepStrictEqual(again.alarms, []); assert.strictEqual(again.s.player('ann', 'play').cb.id, 'cbann1'); again.s.close();
    assert.strictEqual(damaged(dir).length, 1);
  });

  await test('a torn file with NO .bak: starts empty but loud (says EMPTY and where the bytes are), the damaged bytes stay, the first save does not touch them', async () => {
    const dir = dirOf(), file = path.join(dir, 'coldcall-pull.json'); const w = open(file); w.s.setPlayer('ann', 'play', CB('c1')); w.s.flush(); w.s.close();
    assert.ok(!fs.existsSync(file + '.bak')); const torn = tear(file);
    const { s, alarms } = open(file);
    assert.strictEqual(alarms.length, 1); assert.ok(/EMPTY/.test(alarms[0]) && /no backup/.test(alarms[0]) && alarms[0].includes('.damaged-'), alarms[0]);
    assert.strictEqual(s.player('ann', 'play'), null);
    s.setPlayer('cat', 'play', CB('c2')); s.flush(); s.close();
    const d = damaged(dir); assert.strictEqual(d.length, 1); assert.ok(fs.readFileSync(path.join(dir, d[0])).equals(torn)); assert.ok(parses(file).players.cat);
  });

  await test('an empty file (0 bytes): damaged, kept, loud; with a good .bak the state comes back', async () => {
    const dir = dirOf(), file = twoWrites(dir); fs.writeFileSync(file, '');
    const { s, alarms } = open(file);
    assert.strictEqual(alarms.length, 1); assert.ok(/empty/.test(alarms[0]) && /Restored/.test(alarms[0]), alarms[0]); assert.strictEqual(damaged(dir).length, 1);
    assert.strictEqual(s.player('ann', 'play').cb.id, 'cbann1'); s.close();
    const d2 = dirOf(), f2 = path.join(d2, 'coldcall-pull.json'); fs.writeFileSync(f2, '');
    const e = open(f2); assert.strictEqual(e.alarms.length, 1); assert.strictEqual(damaged(d2).length, 1); assert.strictEqual(fs.readFileSync(path.join(d2, damaged(d2)[0])).length, 0); e.s.close();
  });

  await test('a truncated file at every kind of cut (1 byte, a quarter, half, all but 5, all but 1): each is detected, kept byte for byte, loud, never read as empty silently', async () => {
    const dir0 = dirOf(), good = fs.readFileSync(twoWrites(dir0));
    for (const cut of [1, 7, Math.floor(good.length / 4), Math.floor(good.length / 2), good.length - 5, good.length - 1]) {
      const dir = dirOf(), file = path.join(dir, 'coldcall-pull.json'); fs.writeFileSync(file, good.subarray(0, cut));
      const { s, alarms } = open(file);
      assert.strictEqual(alarms.length, 1, 'cut ' + cut); assert.strictEqual(damaged(dir).length, 1, 'cut ' + cut);
      assert.ok(fs.readFileSync(path.join(dir, damaged(dir)[0])).equals(good.subarray(0, cut)), 'cut ' + cut); s.close();
    }
  });

  await test('valid JSON that is not a state file ([], null, 42, {}, players not an object, open not an object) is damaged too', async () => {
    for (const text of ['[]', 'null', '42', '"x"', '{}', '{"v":1,"players":[]}', '{"v":1,"players":{},"open":5}', '{"v":1,"players":{},"pot":"x"}']) {
      const dir = dirOf(), file = path.join(dir, 'coldcall-pull.json'); fs.writeFileSync(file, text);
      const { s, alarms } = open(file); assert.strictEqual(alarms.length, 1, text); assert.strictEqual(damaged(dir).length, 1, text); s.close();
    }
  });

  await test('main missing but a good .bak beside it: restored loudly (a fresh dir has no .bak, so this is never a fresh start)', async () => {
    const dir = dirOf(), file = twoWrites(dir); fs.rmSync(file);
    const { s, alarms } = open(file); assert.strictEqual(alarms.length, 1); assert.ok(/is missing/.test(alarms[0]) && /Restored/.test(alarms[0]), alarms[0]);
    assert.strictEqual(s.player('ann', 'play').cb.id, 'cbann1'); assert.ok(parses(file)); assert.strictEqual(damaged(dir).length, 0); s.close();
  });

  await test('a damaged main AND a damaged .bak: both kept, one loud line, empty start', async () => {
    const dir = dirOf(), file = twoWrites(dir); tear(file); tear(file + '.bak');
    const { s, alarms } = open(file); assert.strictEqual(alarms.length, 1); assert.ok(/EMPTY/.test(alarms[0]) && /cannot be used either/.test(alarms[0]), alarms[0]);
    assert.strictEqual(damaged(dir).length, 1); assert.strictEqual(damaged(dir, 'coldcall-pull.json.bak').length, 1); s.close();
  });

  await test('the damaged bytes cannot be kept: the store is BLOCKED, loud, loads nothing, every write throws, the damaged file is never touched', async () => {
    const dir = dirOf(), file = twoWrites(dir); const torn = tear(file);
    const r0 = fs.renameSync, c0 = fs.copyFileSync;
    fs.renameSync = (a, b) => { if (String(b).includes('.damaged-')) throw Object.assign(new Error('EROFS'), { code: 'EROFS' }); return r0(a, b); };
    fs.copyFileSync = (a, b, f) => { if (String(b).includes('.damaged-')) throw Object.assign(new Error('EROFS'), { code: 'EROFS' }); return c0(a, b, f); };
    let o; try { o = open(file); } finally { fs.renameSync = r0; fs.copyFileSync = c0; }
    assert.strictEqual(o.alarms.length, 1); assert.ok(/BLOCKED/.test(o.alarms[0]), o.alarms[0]); assert.ok(o.s.blocked());
    assert.strictEqual(o.s.player('ann', 'play'), null);
    o.s.setPlayer('x', 'play', CB('cx')); assert.throws(() => o.s.flush(), /blocked/);
    o.s.close(true); assert.ok(fs.readFileSync(file).equals(torn), 'the damaged file is untouched'); assert.strictEqual(damaged(dir).length, 0);
  });

  await test('one bad player entry drops that entry only, with a line that names the player; the others are intact; no damaged file', async () => {
    const dir = dirOf(), file = path.join(dir, 'coldcall-pull.json');
    fs.writeFileSync(file, JSON.stringify({ v: 1, players: { ann: { play: CB('cbann1') }, bob: 'junk', cat: 5, dan: { chips: CB('cbdan1', 100) } }, pot: {}, open: {} }));
    const { s, alarms } = open(file);
    assert.strictEqual(alarms.length, 2); assert.ok(alarms.some((l) => /"bob"/.test(l)) && alarms.some((l) => /"cat"/.test(l)), alarms.join('\n'));
    assert.strictEqual(s.player('ann', 'play').cb.id, 'cbann1'); assert.strictEqual(s.player('dan', 'chips').cb.id, 'cbdan1'); assert.strictEqual(s.player('bob', 'play'), null);
    assert.strictEqual(damaged(dir).length, 0); s.close();
  });

  await test('a write is temp + fsync, previous version kept, rename, directory fsync, in that order', async () => {
    const dir = dirOf(), file = path.join(dir, 'coldcall-pull.json'); const { s } = open(file);
    s.setPlayer('ann', 'play', CB('c1')); s.flush();
    const ev = [], f0 = fs.fsyncSync, r0 = fs.renameSync, fds = new Map(), o0 = fs.openSync;
    fs.openSync = (p, ...a) => { const fd = o0(p, ...a); fds.set(fd, String(p)); return fd; };
    fs.fsyncSync = (fd) => { ev.push('fsync:' + path.basename(fds.get(fd) || '?')); return f0(fd); };
    fs.renameSync = (a, b) => { ev.push('rename:' + path.basename(a) + '>' + path.basename(b)); return r0(a, b); };
    try { s.setPlayer('bob', 'play', CB('c2')); s.flush(); } finally { fs.fsyncSync = f0; fs.renameSync = r0; fs.openSync = o0; }
    s.close();
    const i = ev.indexOf('fsync:coldcall-pull.json.tmp'), j = ev.indexOf('rename:coldcall-pull.json.tmp>coldcall-pull.json'), k = ev.lastIndexOf('fsync:' + path.basename(dir));
    assert.ok(i >= 0 && j > i, 'the temp file is fsynced before the rename: ' + ev.join(' | ')); assert.ok(k > j, 'the directory is fsynced after the rename: ' + ev.join(' | '));
    assert.ok(ev.indexOf('rename:coldcall-pull.json.bak.tmp>coldcall-pull.json.bak') > i && ev.indexOf('rename:coldcall-pull.json.bak.tmp>coldcall-pull.json.bak') < j, 'the previous version is kept between them');
  });

  await test('a failed rename keeps the old file whole and the data dirty; the next flush writes it', async () => {
    const dir = dirOf(), file = path.join(dir, 'coldcall-pull.json'); const { s } = open(file);
    s.setPlayer('ann', 'play', CB('c1')); s.flush(); const before = fs.readFileSync(file);
    const r0 = fs.renameSync; fs.renameSync = (a, b) => { if (b === file) throw Object.assign(new Error('EIO'), { code: 'EIO' }); return r0(a, b); };
    s.setPlayer('bob', 'play', CB('c2'));
    try { assert.throws(() => s.flush(), /EIO/); } finally { fs.renameSync = r0; }
    assert.ok(fs.readFileSync(file).equals(before)); assert.ok(!fs.existsSync(file + '.tmp'));
    s.flush(); assert.ok(parses(file).players.bob); s.close();
  });

  // kill -9 between write and rename: a child writes a new version and is SIGKILLed at a chosen step
  for (const at of ['tmp-written', 'backup-kept', 'renamed']) {
    await test(`kill -9 at step "${at}": the file is whole afterwards (${at === 'renamed' ? 'the new version' : 'the old version'}), no damage, no loud line, the next save works`, async () => {
      const dir = dirOf(), file = twoWrites(dir);                  // main = ann+bob (A), .bak = ann
      const script = `const { createStore } = require(${JSON.stringify(STORE_JS)});
        const s = createStore(${JSON.stringify(file)}, { log() {}, alarm() {}, step: (x) => { if (x === ${JSON.stringify(at)}) process.kill(process.pid, 'SIGKILL'); } });
        s.setPlayer('eve', 'play', { v: 1, lt: 1 }); s.flush(); console.log('SURVIVED');`;
      const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 60000 });
      assert.strictEqual(r.signal, 'SIGKILL', 'the child was killed: ' + r.stdout + r.stderr);
      const { s, alarms, logs } = open(file);
      assert.deepStrictEqual(alarms, []); assert.strictEqual(damaged(dir).length, 0);
      assert.strictEqual(!!s.player('eve', 'play'), at === 'renamed', 'new version only after the rename');
      assert.strictEqual(s.player('ann', 'play').cb.id, 'cbann1'); assert.strictEqual(s.player('bob', 'chips').cb.id, 'cbbob1');
      s.setPlayer('fay', 'play', CB('c9')); s.flush(); s.close(); assert.ok(parses(file).players.fay); assert.ok(!fs.existsSync(file + '.tmp'));
    });
  }

  // ---- the game on top: a real ledger world
  const worldOn = (dir, extra = {}) => { const lines = []; const w = H.world({ dir, rng: E.rngFrom(61), roundRng: E.rngFrom(62), potRng: () => 1, log: (...a) => lines.push(a.join(' ')), ...extra }); return { w, lines }; };
  const prep = (dir, build) => { const f = path.join(dir, 'coldcall-pull.json'); const o = open(f); build(o.s); o.s.close(); return f; };

  await test('game: a torn file + a .bak that has the armed Callback: boot keeps the Callback, the next $25 spin is the FREE Callback, a loud line and the damaged file are there', async () => {
    const dir = dirOf();
    const file = prep(dir, (s) => { s.setPlayer('ann', 'play', CB('cbreset1')); s.flush(); s.setPlayer('zed', 'chips', CB('cbz', 100)); s.flush(); });
    tear(file);
    const { w, lines } = worldOn(dir); w.setBal('ann', 'play', 1000000);
    assert.ok(lines.some((l) => /Restored the Cold Call state/.test(l)), lines.join('\n')); assert.strictEqual(damaged(dir).length, 1);
    const r = H.spin(w, w.sock('ann'), { bet: 2500, mode: 'play' });
    assert.ok(!r.error, JSON.stringify(r.error)); assert.strictEqual(r.callback, true, 'the armed Callback is played'); assert.strictEqual(r.cost, 0);
    w.crash();
  });

  await test('game: a torn file with no copy: the next spin is a normal paid spin, but the loud line and the damaged file exist (nothing silent)', async () => {
    const dir = dirOf(); const file = prep(dir, (s) => { s.setPlayer('ann', 'play', CB('cbreset1')); s.flush(); }); tear(file);
    const { w, lines } = worldOn(dir); w.setBal('ann', 'play', 1000000);
    assert.ok(lines.some((l) => /EMPTY/.test(l)), lines.join('\n')); assert.strictEqual(damaged(dir).length, 1);
    const r = H.spin(w, w.sock('ann'), { bet: 2500, mode: 'play' }); assert.strictEqual(r.callback, false); w.crash();
    assert.strictEqual(damaged(dir).length, 1);
  });

  await test('game: one bad field of one player resets THAT field only, with a log line (lt: kept Callback, avg, warm); a state that is not version 1 reads as new, also logged', async () => {
    const dir = dirOf();
    prep(dir, (s) => {
      s.setPlayer('dan', 'play', { ...CB('cbdan1'), lt: 'lots', warm: [3, 4, 99] });          // lt and warm are damaged; the Callback, avg are fine
      s.setPlayer('eve', 'play', { ...CB('cbeve1', 500), cb: { bet: 0 } });                    // the Callback itself is damaged, the leads are fine
      s.setPlayer('fay', 'play', { v: 7, cb: { bet: 2500, id: 'cbfay' } });                      // not a version-1 state at all
      s.setPlayer('gus', 'play', CB('cbgus1'));                                               // untouched
      s.flush();
    });
    const { w, lines } = worldOn(dir); const mk = (n) => { const s = w.sock(n); s.send('g:coldcall:state', {}); return H.last(s, 'g:coldcall:state').pull.play; };
    const dan = mk('dan'), eve = mk('eve'), fay = mk('fay'), gus = mk('gus');
    assert.deepStrictEqual(dan.cb, { bet: 2500 }, 'dan keeps the Callback'); assert.strictEqual(dan.lt, 0); assert.deepStrictEqual(dan.warm, []);
    assert.strictEqual(eve.cb, null); assert.strictEqual(eve.lt, 4400, 'eve keeps her leads'); assert.strictEqual(fay.cb, null); assert.deepStrictEqual(gus.cb, { bet: 2500 }); assert.strictEqual(gus.lt, 4400);
    const need = [/state of dan\|play: field lt is damaged .*"lots"/, /state of dan\|play: field warm is damaged/, /state of eve\|play: field cb is damaged/, /state of fay\|play: the whole state is not a version-1/];
    for (const re of need) assert.ok(lines.some((l) => re.test(l)), String(re) + '\n' + lines.join('\n'));
    assert.ok(!lines.some((l) => /gus\|play/.test(l)), 'a good state logs nothing');
    const before = lines.length; mk('dan'); mk('dan'); assert.strictEqual(lines.length, before, 'the same damage is logged once, not on every read');
    const r = H.spin(w, w.sock('dan'), { bet: 100, mode: 'play' }); assert.strictEqual(r.callback, true, 'dan\'s Callback still plays');
    w.crash();
  });

  console.log(pass + ' passed' + (process.exitCode ? ', with failures' : ''));
  fs.rmSync(tmp, { recursive: true, force: true });
})();
