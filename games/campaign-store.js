'use strict';
// CAMPAIGN TRAIL: the game's own file (state, not money). One JSON file next to money.jsonl (atomic: tmp + fsync + rename, debounced writes are not used for the open runs: callers flush).
//   { v: 1, open: { <account key>: record } }
// record = { roundId, key, cur, bet, run, startedAt, lastAt }: the one open run of an account. The stake itself is the ledger's escrow:campaign:<key>:<roundId>; `bet` here is only what the run was
// opened for (recover() settles it against the escrow it finds and refuses a mismatch). flush() throws when the write failed: the caller decides what that means for the money flow.
const fs = require('fs');

const flushers = new Set();
process.on('exit', () => { for (const f of flushers) { try { f(); } catch {} } });

const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
// keyed by account name: NO prototype, so an account called __proto__ or constructor is a plain entry
const dict = (src) => { const m = Object.create(null); if (isObj(src)) for (const k of Object.keys(src)) m[k] = src[k]; return m; };
const RETRY_MS = 1000;

function createStore(file, opts = {}) {
  const say = opts.log || (() => {});
  let data = { v: 1, open: dict() };
  if (file) {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (isObj(j)) data = { v: 1, open: dict(j.open) };
    } catch { data = { v: 1, open: dict() }; }
  }
  for (const k of Object.keys(data.open)) if (!isObj(data.open[k])) delete data.open[k];

  let timer = null, dirty = false;
  function writeNow() {                       // throws when the disk refuses; `dirty` stays set then
    if (!file) { dirty = false; return; }
    const tmp = file + '.tmp';
    let fd = null;
    try {
      fd = fs.openSync(tmp, 'w');
      fs.writeSync(fd, JSON.stringify(data));
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = null;
      fs.renameSync(tmp, file);
    } catch (e) { if (fd != null) { try { fs.closeSync(fd); } catch {} } try { fs.rmSync(tmp, { force: true }); } catch {} throw e; }
    dirty = false;
  }
  function arm(ms) { if (!timer) { timer = setTimeout(() => { timer = null; try { writeNow(); } catch (e) { say('campaign: store write failed, will retry:', e && e.message); arm(RETRY_MS); } }, ms); if (timer.unref) timer.unref(); } }
  function save() { dirty = true; arm(50); }
  function flush() { if (timer) { clearTimeout(timer); timer = null; } if (dirty) { try { writeNow(); } catch (e) { arm(RETRY_MS); throw e; } } return true; }
  // close(true) abandons what was not written (a test's "crash"); a plain close writes it
  function close(discard) { if (discard) dirty = false; else { try { flush(); } catch {} } flushers.delete(flush); if (timer) { clearTimeout(timer); timer = null; } }
  flushers.add(flush);

  return {
    file, flush, close,
    putOpen(rec) { data.open[rec.key] = rec; save(); },        // replaces the entry (never edits one in place), so a failed flush can put the old one back
    delOpen(key) { const had = delete data.open[key]; save(); return had; },
    getOpen(key) { return data.open[key] || null; },
    allOpen() { return Object.values(data.open); },
    _data: () => data,
  };
}

module.exports = { createStore };
