'use strict';
// CAMPAIGN TRAIL: the game's own file (state, not money). One JSON file next to money.jsonl (debounced writes are not used for the open runs: callers flush).
//   { v: 1, open: { <account key>: record } }
// record = { roundId, key, cur, bet, run, startedAt, lastAt }: the one open run of an account. The stake itself is the ledger's escrow:campaign:<key>:<roundId>; `bet` here is only what the run was
// opened for (recover() settles it against the escrow it finds and refuses a mismatch). flush() throws when the write failed: the caller decides what that means for the money flow.
// MONEY 1008 K2-3c / K5-1: a run's multiplier, its pended scandal and its map live ONLY here (the ledger holds just the stake), so the file is treated like a ledger (the Cold Call store, K4-2, is the pattern):
//   - a write is temp file + fsync + (<file>.bak gets the same new bytes as its own file, before the main file is replaced) + rename + fsync of the directory; a crash leaves the old file or the new one, never a torn one;
//   - a file that exists but cannot be used (torn, truncated, empty, not a state file) is NEVER read as "no open runs" without a trace and NEVER overwritten: it is renamed to <file>.damaged-<UTC stamp> (kept),
//     one loud line says so, and the state is restored from <file>.bak when that one is good; with no good copy the store starts empty and the loud line says exactly that and where the damaged bytes are;
//   - when the damaged bytes cannot be kept the store is BLOCKED: it loads nothing, every write throws (so a start is refused and its stake goes back) and it never touches the file;
//     recover() then leaves every escrow alone and audit() throws, so the registry's sweep refunds nothing either;
//   - a missing file next to a good .bak is restored from it (loudly); a missing file with no .bak is a fresh data dir and a quiet start;
//   - one bad record drops that record only, with a line that names it.
const fs = require('fs');

const flushers = new Set();
process.on('exit', () => { for (const f of flushers) { try { f(); } catch {} } });

const path = require('path');

const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
// keyed by account name: NO prototype, so an account called __proto__ or constructor is a plain entry
const dict = (src) => { const m = Object.create(null); if (isObj(src)) for (const k of Object.keys(src)) m[k] = src[k]; return m; };
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
  if (!isObj(j) || !isObj(j.open)) return { err: new Error('valid JSON but not a Campaign state file') };
  return { j };
}

function createStore(file, opts = {}) {
  const say = opts.log || (() => {});
  const alarm = opts.alarm || ((...a) => (opts.log ? opts.log(...a) : console.error(...a)));   // the lines that must be seen (damage, restore)
  const step = typeof opts.step === 'function' ? opts.step : () => {};                          // tests: called at each step of a write, so a test can kill -9 the process there
  const bak = file && file + '.bak';
  let data = { v: 1, open: dict() };
  let blocked = null, lost = null, mustRestore = false;

  // keep the bytes of a file that cannot be used under a dated name; returns the new path, or null when they could not be kept
  function keep(f) {
    const base = f + '.damaged-' + stamp(); let dst = base;
    for (let i = 1; fs.existsSync(dst) && i < 100; i++) dst = base + '-' + i;
    try { fs.renameSync(f, dst); try { fsyncPath(path.dirname(f)); } catch {} return dst; } catch {}
    try { fs.copyFileSync(f, dst, fs.constants.COPYFILE_EXCL); return dst; } catch { return null; }
  }
  function fromJson(j) {
    const d = { v: 1, open: dict(j.open) };
    for (const k of Object.keys(d.open)) if (!isObj(d.open[k])) { alarm('campaign: store: the open run of ' + JSON.stringify(k) + ' is not an object, dropped (' + preview(d.open[k]) + ')'); delete d.open[k]; }
    return d;
  }
  if (file) {
    const r = readFile(file);
    if (r.j) data = fromJson(r.j);
    else {
      const b = readFile(bak);
      if (r.missing && b.missing) { /* a fresh data dir: a normal quiet start */ }
      else {
        let kept = null;
        if (!r.missing) {
          kept = keep(file);
          if (!kept) {
            blocked = 'the damaged file ' + file + ' could not be kept under another name';
            alarm('campaign: store: *** ' + file + ' cannot be used (' + r.err.message + ') and its bytes could not be kept. The Campaign store is BLOCKED: nothing is loaded and nothing is written; no run is settled or refunded and no new run starts; open runs and their stakes are safe in the ledger and on disk until a person fixes this. ***');
          }
        }
        if (!blocked) {
          if (b.j) {
            data = fromJson(b.j); mustRestore = true;
            alarm('campaign: store: *** ' + (r.missing ? file + ' is missing' : file + ' cannot be used (' + r.err.message + '), kept as ' + kept) + '. Restored the Campaign state from ' + bak + ' (the last version written). ***');
          } else {
            let keptBak = null;
            if (!b.missing) keptBak = keep(bak);
            lost = (r.missing ? file + ' was missing' : file + ' could not be used (' + r.err.message + '), kept as ' + kept) + '; ' + (b.missing ? 'there was no backup' : bak + ' could not be used either (' + b.err.message + '), kept as ' + keptBak);
            alarm('campaign: store: *** ' + lost + '. Started with an EMPTY Campaign state: every open run is gone; the stake of a run that has a stake in the ledger is refunded at 1.00x at this boot, its multiplier is lost. ***');
          }
        }
      }
    }
  }

  let timer = null, dirty = false;
  // temp file + fsync, then the same bytes as <file>.bak (own file, fsync, rename), then rename over main, then fsync of the directory. A crash at any point leaves a whole old or a whole new main file.
  function writeNow() {                       // throws when the disk refuses; `dirty` stays set then
    if (!file) { dirty = false; return; }
    if (blocked) throw new Error('campaign store blocked: ' + blocked);
    const tmp = file + '.tmp', dir = path.dirname(file), txt = JSON.stringify(data);
    const put = (f) => { const fd = fs.openSync(f, 'w'); try { fs.writeFileSync(fd, txt); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } };
    try {
      put(tmp);
      step('tmp-written');
      const bt = bak + '.tmp';                // the backup is its own file with the SAME new bytes (not a link: damage to the main file in place must not reach it), in place before the main file is replaced
      try { put(bt); fs.renameSync(bt, bak); } catch (e) { try { fs.rmSync(bt, { force: true }); } catch {} say('campaign: store: could not write the backup ' + bak + ':', e && e.message); }
      step('backup-kept');
      fs.renameSync(tmp, file);
      step('renamed');
      try { fsyncPath(dir); } catch (e) { say('campaign: store: directory fsync failed:', e && e.message); }
    } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch {} throw e; }
    dirty = false;
  }
  if (mustRestore) { try { writeNow(); } catch (e) { dirty = true; alarm('campaign: store: restored state could not be written to ' + file + ':', e && e.message); } }
  function arm(ms) { if (blocked) return; if (!timer) { timer = setTimeout(() => { timer = null; try { writeNow(); } catch (e) { say('campaign: store write failed, will retry:', e && e.message); arm(RETRY_MS); } }, ms); if (timer.unref) timer.unref(); } }
  function save() { dirty = true; arm(50); }
  function flush() { if (timer) { clearTimeout(timer); timer = null; } if (dirty) { try { writeNow(); } catch (e) { arm(RETRY_MS); throw e; } } return true; }
  // close(true) abandons what was not written (a test's "crash"); a plain close writes it
  function close(discard) { if (discard) dirty = false; else { try { flush(); } catch {} } flushers.delete(flush); if (timer) { clearTimeout(timer); timer = null; } }
  flushers.add(flush);

  return {
    file, flush, close, blocked: () => blocked, lost: () => lost,
    putOpen(rec) { if (blocked) throw new Error('campaign store blocked: ' + blocked); data.open[rec.key] = rec; save(); },        // replaces the entry (never edits one in place), so a failed flush can put the old one back
    delOpen(key) { const had = delete data.open[key]; save(); return had; },
    getOpen(key) { return data.open[key] || null; },
    allOpen() { return Object.values(data.open); },
    _data: () => data,
  };
}

module.exports = { createStore };
