'use strict';
// COLD CALL, THE PULL: the game's own file (state, not money). One JSON file next to money.jsonl (atomic temp+rename, debounced 50 ms, flushed on exit).
//   { v: 1, players: { <key>: { play: state, chips: state } }, pot: { play: pot, chips: pot }, open: { "<key>|<mode>": record } }
// pot = { bal, fed, paid, rem, last: { who, amount, at } | null } in cents. P6: the office pot is the ledger account pool:coldcall:office; `bal` here is only a mirror of it (audit() reads it,
// no decision does), `fed` / `paid` are running statistics, `rem` (the sub-cent remainder, 1/10,000 of a cent) and `last` are game state. A `seeded` field of an old file is dropped.
// An `open` record holds everything needed to finish the round after a restart (see games/coldcall.js openRecord): ids, key, mode, cost, bet, buy, clock, the pre-round state, the tapes,
// the decisions, and the whole config snapshot the round runs on.
// flush() throws when the write failed (the caller decides what a failed write means: the money flows depend on it). A debounced write that fails keeps the data dirty and tries again.
// MONEY 1008 K4-2: an armed Callback and the leads toward the next one are Cash value that lives ONLY here, so the file is treated like a ledger:
//   - a write is temp file + fsync + (the previous version kept as <file>.bak, a hard link: one write behind) + rename + fsync of the directory; a crash leaves the old file or the new one, never a torn one;
//   - a file that exists but cannot be used (torn, truncated, empty, not a state file) is NEVER treated as empty without a trace and NEVER overwritten: it is renamed to <file>.damaged-<UTC stamp> (kept),
//     one loud line says so, and the state is restored from <file>.bak when that one is good; with no good copy the store starts empty and the loud line says exactly that and where the damaged bytes are;
//   - when the damaged bytes cannot be kept the store is BLOCKED: it loads nothing, every write throws (so the game refuses bets that need a flush) and it never touches the file;
//   - a missing file next to a good .bak is restored from it (loudly); a missing file with no .bak is a fresh data dir and a quiet start;
//   - one bad player entry drops that entry only, with a log line that names it (a bad FIELD of a state is reset by games/coldcall.js normState, per field, with a log line).
const fs = require('fs');
const path = require('path');

const MODES = ['play', 'chips'];
const flushers = new Set();
process.on('exit', () => { for (const f of flushers) { try { f(); } catch {} } });

const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
// maps keyed by account name or "<name>|<mode>" have NO prototype: a key like __proto__ or constructor is a plain entry, never Object.prototype
const dict = (src) => { const m = Object.create(null); if (isObj(src)) for (const k of Object.keys(src)) m[k] = src[k]; return m; };
// a stored pot is four safe non-negative integers and a `last` that is null or { who, amount, at }; anything else is a fresh pot (W1B N5: one bad entry must not take the cost of every spin)
const POT_INTS = ['bal', 'fed', 'paid', 'rem'];
const validPot = (p) => isObj(p) && POT_INTS.every((k) => Number.isSafeInteger(p[k]) && p[k] >= 0) && (p.last === null || (isObj(p.last) && typeof p.last.who === 'string' && Number.isSafeInteger(p.last.amount) && Number.isFinite(p.last.at)));
const emptyData = () => ({ v: 1, players: dict(), pot: dict(), open: dict() });
const RETRY_MS = 1000;
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('.', '');   // 20261008T221500123Z
function fsyncPath(p) { const fd = fs.openSync(p, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
const preview = (v) => { let t; try { t = JSON.stringify(v); } catch { t = String(v); } t = String(t); return t.length > 300 ? t.slice(0, 300) + '...(' + t.length + ' chars)' : t; };
// { j } (a usable file), { missing: true }, or { err } (exists, cannot be used)
function readFile(f) {
  let txt;
  try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { return e && e.code === 'ENOENT' ? { missing: true } : { err: e }; }
  if (!txt.trim()) return { err: new Error('the file is empty (' + Buffer.byteLength(txt) + ' bytes)') };
  let j; try { j = JSON.parse(txt); } catch (e) { return { err: new Error('not valid JSON: ' + (e && e.message)) }; }
  if (!isObj(j) || !isObj(j.players) || (j.open !== undefined && !isObj(j.open)) || (j.pot !== undefined && !isObj(j.pot))) return { err: new Error('valid JSON but not a Cold Call state file') };
  return { j };
}

function createStore(file, opts = {}) {
  const say = opts.log || (() => {});
  const alarm = opts.alarm || ((...a) => (opts.log ? opts.log(...a) : console.error(...a)));   // the lines that must be seen (damage, restore)
  const step = typeof opts.step === 'function' ? opts.step : () => {};                          // tests: called at each step of a write, so a test can kill -9 the process there
  const bak = file && file + '.bak';
  let data = emptyData();
  let blocked = null, mustRestore = false, mainGood = false;

  // keep the bytes of a file that cannot be used under a dated name; returns the new path, or null when they could not be kept
  function keep(f) {
    const base = f + '.damaged-' + stamp(); let dst = base;
    for (let i = 1; fs.existsSync(dst) && i < 100; i++) dst = base + '-' + i;
    try { fs.renameSync(f, dst); try { fsyncPath(path.dirname(f)); } catch {} return dst; } catch {}
    try { fs.copyFileSync(f, dst, fs.constants.COPYFILE_EXCL); return dst; } catch { return null; }
  }
  function fromJson(j) {
    const d = { v: 1, players: dict(j.players), pot: dict(j.pot), open: dict(j.open) };
    for (const k of Object.keys(d.players)) if (!isObj(d.players[k])) { alarm('coldcall: store: the entry of player ' + JSON.stringify(k) + ' is not an object, dropped (' + preview(d.players[k]) + ')'); delete d.players[k]; }   // an account entry is an object of per-currency states, or it is gone
    for (const k of Object.keys(d.pot)) {
      if (!MODES.includes(k) || !validPot({ ...d.pot[k], seeded: undefined })) { say('coldcall: store: pot entry ' + JSON.stringify(k) + ' is not valid, recreated fresh (' + preview(d.pot[k]) + ')'); delete d.pot[k]; continue; }   // recreated fresh on first use
      if (isObj(d.pot[k]) && 'seeded' in d.pot[k]) { if (d.pot[k].seeded > 0) say('coldcall: ignoring a stored pot seed of', d.pot[k].seeded, k); delete d.pot[k].seeded; }
    }
    return d;
  }
  if (file) {
    const r = readFile(file);
    if (r.j) { data = fromJson(r.j); mainGood = true; }
    else {
      const b = readFile(bak);
      if (r.missing && b.missing) { /* a fresh data dir: a normal quiet start */ }
      else {
        let kept = null;
        if (!r.missing) {
          kept = keep(file);
          if (!kept) {
            blocked = 'the damaged file ' + file + ' could not be kept under another name';
            alarm('coldcall: store: *** ' + file + ' cannot be used (' + r.err.message + ') and its bytes could not be kept. The Cold Call store is BLOCKED: nothing is loaded and nothing is written; Callbacks and leads are safe on disk until a person fixes this. ***');
          }
        }
        if (!blocked) {
          if (b.j) {
            data = fromJson(b.j); mustRestore = true;
            alarm('coldcall: store: *** ' + (r.missing ? file + ' is missing' : file + ' cannot be used (' + r.err.message + '), kept as ' + kept) + '. Restored the Cold Call state from ' + bak + ' (the version before the last write). ***');
          } else {
            let keptBak = null;
            if (!b.missing) keptBak = keep(bak);
            alarm('coldcall: store: *** ' + (r.missing ? file + ' is missing' : file + ' cannot be used (' + r.err.message + '), kept as ' + kept) + '; ' + (b.missing ? 'there is no backup' : bak + ' cannot be used either (' + b.err.message + '), kept as ' + keptBak) + '. Started with an EMPTY Cold Call state: every armed Callback and every lead is gone. ***');
          }
        }
      }
    }
  }

  let timer = null, dirty = false;
  // temp file + fsync, then the previous main is kept as .bak (a hard link: the old inode is never written again), then rename over main, then fsync of the directory. A crash at any point leaves a whole old or a whole new file.
  function writeNow() {                       // throws when the disk refuses; `dirty` stays set then
    if (!file) { dirty = false; return; }
    if (blocked) throw new Error('coldcall store blocked: ' + blocked);
    const tmp = file + '.tmp', dir = path.dirname(file);
    try {
      const fd = fs.openSync(tmp, 'w');
      try { fs.writeFileSync(fd, JSON.stringify(data)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      step('tmp-written');
      if (mainGood) {
        const bt = bak + '.tmp';
        try {
          try { fs.rmSync(bt, { force: true }); } catch {}
          try { fs.linkSync(file, bt); } catch { fs.copyFileSync(file, bt); }
          fs.renameSync(bt, bak);
        } catch (e) { try { fs.rmSync(bt, { force: true }); } catch {} say('coldcall: store: could not keep the previous version as ' + bak + ':', e && e.message); }
      }
      step('backup-kept');
      fs.renameSync(tmp, file);
      step('renamed');
      try { fsyncPath(dir); } catch (e) { say('coldcall: store: directory fsync failed:', e && e.message); }
    } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch {} throw e; }
    mainGood = true; dirty = false;
  }
  if (mustRestore) { try { writeNow(); } catch (e) { dirty = true; alarm('coldcall: store: restored state could not be written to ' + file + ':', e && e.message); } }
  function arm(ms) { if (blocked) return; if (!timer) { timer = setTimeout(() => { timer = null; try { writeNow(); } catch (e) { say('coldcall: store write failed, will retry:', e && e.message); arm(RETRY_MS); } }, ms); if (timer.unref) timer.unref(); } }
  function save() { dirty = true; arm(50); }
  function flush() { if (timer) { clearTimeout(timer); timer = null; } if (dirty) { try { writeNow(); } catch (e) { arm(RETRY_MS); throw e; } } return true; }
  // close(true) abandons what was not written (a test's "crash"); a plain close writes it
  function close(discard) { if (discard) dirty = false; else { try { flush(); } catch {} } flushers.delete(flush); if (timer) { clearTimeout(timer); timer = null; } }
  flushers.add(flush);

  const checkMode = (mode) => { if (!MODES.includes(mode)) throw new Error('bad mode'); };
  const openKey = (key, mode) => key + '|' + mode;

  return {
    file, save, flush, close, blocked: () => blocked,
    // player state (a stored object or null; callers clone before handing it to the engine)
    player(key, mode) { checkMode(mode); const p = data.players[key]; return (p && p[mode]) || null; },
    setPlayer(key, mode, state) { checkMode(mode); (data.players[key] = data.players[key] || dict())[mode] = state; save(); },
    // the pot record of a currency (mirror + statistics + remainder); created empty on first use. The pot's MONEY is the ledger's pool account.
    pot(mode) {
      checkMode(mode);
      let p = data.pot[mode];
      if (!validPot(p)) { p = data.pot[mode] = { bal: 0, fed: 0, paid: 0, rem: 0, last: null }; save(); }
      return p;
    },
    // the pot record if there is one (never creates it): a game that never ran a pot leaves no pot in its file
    peekPot(mode) { checkMode(mode); const p = data.pot[mode]; return validPot(p) ? p : null; },
    potChanged: save,
    // open rounds (a decision pending, or a Callback in flight)
    putOpen(rec) { checkMode(rec.mode); data.open[openKey(rec.key, rec.mode)] = rec; save(); },
    delOpen(key, mode) { const had = delete data.open[openKey(key, mode)]; save(); return had; },
    getOpen(key, mode) { return data.open[openKey(key, mode)] || null; },
    allOpen() { return Object.values(data.open); },
    _data: () => data,
  };
}

module.exports = { createStore, MODES };
