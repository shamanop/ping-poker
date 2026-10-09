'use strict';
// COLD CALL, THE PULL: the game's own file (state, not money). One JSON file next to money.jsonl (atomic temp+rename, debounced 50 ms, flushed on exit).
//   { v: 1, players: { <key>: { play: state, chips: state } }, pot: { play: pot, chips: pot }, open: { "<key>|<mode>": record } }
// pot = { bal, fed, paid, rem, last: { who, amount, at } | null } in cents. P6: the office pot is the ledger account pool:coldcall:office; `bal` here is only a mirror of it (audit() reads it,
// no decision does), `fed` / `paid` are running statistics, `rem` (the sub-cent remainder, 1/10,000 of a cent) and `last` are game state. A `seeded` field of an old file is dropped.
// An `open` record holds everything needed to finish the round after a restart (see games/coldcall.js openRecord): ids, key, mode, cost, bet, buy, clock, the pre-round state, the tapes,
// the decisions, and the whole config snapshot the round runs on.
// flush() throws when the write failed (the caller decides what a failed write means: the money flows depend on it). A debounced write that fails keeps the data dirty and tries again.
// MONEY 1008 R2C-5 (journal mode, opts.journal, on under server.js): a whole-file write + fsync per spin held the event loop (20 accounts took 91-98% of it). In journal mode the main file is only a
//   checkpoint; every change is an APPEND-ONLY line in <file>.journal ("<sha256/8>\t<json>\n", O_APPEND, one write, delta only, so its cost does not depend on the number of players):
//   - intent(line): the line of a paid spin is written BEFORE the ledger call (one write(2), no fsync: it survives kill -9); it names the round ref. Boot applies such a line only when the LEDGER
//     holds that round (opts.confirm(key, ref)); a spin killed between the line and the ledger call leaves neither stake nor leads, a spin killed after it keeps both;
//   - durable(cb): fdatasync of the journal off the event loop (fs.fdatasync), one sync for every line written meanwhile (group commit); cb runs when it returned, so the game sends the result then;
//   - flush(): (paths that wait for the disk synchronously: open records, decisions) the dirty delta as one unconditional line + fdatasyncSync: small, not the whole file;
//   - compaction (size / idle timer, never per spin): the existing whole-file write (tmp + fsync + .bak + rename + dir fsync) with `jseq` = the last journal line it contains, then the journal is emptied;
//   - boot: the journal is ALWAYS replayed on top of the main file (also when journal mode is off), lines with seq <= jseq are skipped; a torn LAST line was never acknowledged and is dropped; a bad line with
//     lines after it is damage: loud, the bytes kept as <journal>.damaged-<stamp>, the lines before it applied; when the bytes cannot be kept, or the journal cannot be read, the store is BLOCKED.
// MONEY 1008 K4-2: an armed Callback and the leads toward the next one are Cash value that lives ONLY here, so the file is treated like a ledger:
//   - a write is temp file + fsync + (the previous version kept as <file>.bak, a hard link: one write behind) + rename + fsync of the directory; a crash leaves the old file or the new one, never a torn one;
//   - a file that exists but cannot be used (torn, truncated, empty, not a state file) is NEVER treated as empty without a trace and NEVER overwritten: it is renamed to <file>.damaged-<UTC stamp> (kept),
//     one loud line says so, and the state is restored from <file>.bak when that one is good; with no good copy the store starts empty and the loud line says exactly that and where the damaged bytes are;
//   - when the damaged bytes cannot be kept the store is BLOCKED: it loads nothing, every write throws (so the game refuses bets that need a flush) and it never touches the file;
//   - a missing file next to a good .bak is restored from it (loudly); a missing file with no .bak is a fresh data dir and a quiet start;
//   - one bad player entry drops that entry only, with a log line that names it (a bad FIELD of a state is reset by games/coldcall.js normState, per field, with a log line).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
const COMPACT_BYTES = 1 << 20, COMPACT_MS = 10000;        // journal mode: a checkpoint (whole-file write) when the journal is 1 MB, or 10 s after the first line since the last one
const sum8 = (t) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 8);
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
  let jseq = 0;                                              // journal mode: the last journal line the main file already contains
  const jfile = file && file + '.journal';

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
    if (r.j) { data = fromJson(r.j); mainGood = true; jseq = Number.isSafeInteger(r.j.jseq) && r.j.jseq > 0 ? r.j.jseq : 0; }
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
            data = fromJson(b.j); mustRestore = true; jseq = Number.isSafeInteger(b.j.jseq) && b.j.jseq > 0 ? b.j.jseq : 0;
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
      try { fs.writeFileSync(fd, JSON.stringify(jlast > 0 || jseq > 0 ? { ...data, jseq: Math.max(jseq, jlast) } : data)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
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
    mainGood = true; dirty = false; jseq = Math.max(jseq, jlast);
  }
  let jlast = 0;                                              // the seq of the last journal line written (journal mode)
  if (mustRestore) { try { writeNow(); } catch (e) { dirty = true; alarm('coldcall: store: restored state could not be written to ' + file + ':', e && e.message); } }
  function arm(ms) { if (blocked) return; if (!timer) { timer = setTimeout(() => { timer = null; if (jmode) { try { appendDelta(); durable(() => {}); } catch (e) { say('coldcall: store journal write failed, will retry:', e && e.message); arm(RETRY_MS); } return; } try { writeNow(); } catch (e) { say('coldcall: store write failed, will retry:', e && e.message); arm(RETRY_MS); } }, ms); if (timer.unref) timer.unref(); } }
  function save() { dirty = true; arm(50); }
  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (jmode) { try { if (appendDelta()) syncNow(); } catch (e) { arm(RETRY_MS); throw e; } return true; }
    if (dirty) { try { writeNow(); } catch (e) { arm(RETRY_MS); throw e; } } return true;
  }
  // ---- journal mode ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  let jmode = false, jfd = null, jbytes = 0, jtimer = null, syncing = false, waiters = [];
  const dirtyP = new Set(), dirtyO = new Set(), dirtyT = new Set();             // not yet in a journal line: player "key\0mode", open "key|mode", pot mode
  const markPots = (mode) => { for (const m of mode ? [mode] : MODES) if (data.pot[m]) dirtyT.add(m); };
  function jopen() { if (jfd == null) jfd = fs.openSync(jfile, 'a'); return jfd; }
  function jwrite(obj) {                                                          // one line, one write(2) (no fsync): survives kill -9. Throws when the disk refuses.
    if (blocked) throw new Error('coldcall store blocked: ' + blocked);
    const seq = jlast + 1, json = JSON.stringify({ s: seq, ...obj }), buf = Buffer.from(sum8(json) + '\t' + json + '\n');
    const fd = jopen(); let off = 0;
    while (off < buf.length) off += fs.writeSync(fd, buf, off, buf.length - off);
    jlast = seq; jbytes += buf.length; step('journal-written');
    if (!jtimer) { jtimer = setTimeout(() => { jtimer = null; try { compact(); } catch (e) { say('coldcall: store checkpoint failed, will retry:', e && e.message); } }, COMPACT_MS); if (jtimer.unref) jtimer.unref(); }
    return seq;
  }
  // the delta of everything marked dirty, as the arrays a line carries
  function takeDelta() {
    const p = [], o = [], t = [];
    for (const k of dirtyP) { const i = k.indexOf('\0'), key = k.slice(0, i), mode = k.slice(i + 1), pl = data.players[key]; if (pl && pl[mode]) p.push([key, mode, pl[mode]]); }
    for (const k of dirtyO) o.push([k, data.open[k] || null]);
    for (const m of dirtyT) if (data.pot[m]) t.push([m, data.pot[m]]);
    dirtyP.clear(); dirtyO.clear(); dirtyT.clear();
    return { p, o, t };
  }
  function appendDelta() { if (!dirtyP.size && !dirtyO.size && !dirtyT.size) return false; const d = takeDelta(); try { jwrite(d); } catch (e) { for (const x of d.p) dirtyP.add(x[0] + '\0' + x[1]); for (const x of d.o) dirtyO.add(x[0]); for (const x of d.t) dirtyT.add(x[0]); throw e; } return true; }
  function syncNow() { const fd = jopen(); fs.fdatasyncSync(fd); step('journal-synced'); }
  // cb runs once every line written so far is fsynced; the fsync runs on the thread pool (the event loop is free), and lines written while one is in flight share the next (group commit)
  function durable(cb) {
    if (!jmode) { try { flush(); cb(null); } catch (e) { cb(e); } return; }
    waiters.push(cb); if (!syncing) startSync();
  }
  function startSync() {
    syncing = true; const mine = waiters; waiters = [];
    let fd; try { fd = jopen(); } catch (e) { return done(e); }
    fs.fdatasync(fd, done);
    function done(e) {
      syncing = false;
      if (e) alarm('coldcall: store: *** the journal could not be fsynced: ' + (e && e.message) + ' ***');
      for (const cb of mine) { try { cb(e || null); } catch (x) { say('coldcall: store: durable callback threw:', x && x.message); } }
      if (waiters.length) startSync();
      else if (jbytes >= COMPACT_BYTES && !blocked) { try { compact(); } catch (x) { say('coldcall: store checkpoint failed, will retry:', x && x.message); } }
    }
  }
  // the checkpoint: the whole main file (jseq says which lines it contains), then the journal is emptied. Never on the per-spin path. Anything written to the journal is in `data` already (the line is
  // written before the ledger call, the memory is changed in the same tick), and a line waiting for its fsync is covered by the checkpoint's own fsync.
  function compact() {
    if (jtimer) { clearTimeout(jtimer); jtimer = null; }
    if (blocked || !jmode) return;
    writeNow();
    if (jfd != null) { fs.ftruncateSync(jfd, 0); jbytes = 0; }
  }
  function journaled() { return jmode && !blocked; }
  // the line of a paid spin, BEFORE its ledger call. line = { ref: { key, id }, player: [key, mode, state], open: [openKey]|undefined (to delete), pot: [mode, record]|undefined }
  function intent(line) {
    if (!jmode || blocked) throw new Error('coldcall store: no journal');
    const o = { c: { k: line.ref.key, i: line.ref.id }, p: [], o: [], t: [] }; if (line.free) o.z = 1;
    if (line.player) o.p.push(line.player);
    if (line.del) o.o.push([line.del, null]);
    if (line.pot) o.t.push(line.pot);
    return jwrite(o);
  }
  // after the ledger call and the memory changes of a spin the intent line covered: those marks are not dirty any more
  function covered(key, mode, delKey, potMode) { dirtyP.delete(key + '\0' + mode); if (delKey) dirtyO.delete(delKey); if (potMode) dirtyT.delete(potMode); }
  // close(true) abandons what was not written (a test's "crash"); a plain close writes it
  function close(discard) {
    if (discard) { dirty = false; dirtyP.clear(); dirtyO.clear(); dirtyT.clear(); waiters = []; } else { try { flush(); } catch {} }
    flushers.delete(flushAll);
    if (timer) { clearTimeout(timer); timer = null; }
    if (jtimer) { clearTimeout(jtimer); jtimer = null; }
    if (jfd != null) { try { fs.closeSync(jfd); } catch {} jfd = null; }
  }
  const flushAll = () => flush();
  flushers.add(flushAll);

  // ---- boot: the journal is replayed on top of the main file, whatever mode this process runs in ----------------------------------------------------------------------------------------------
  function applyLine(j) {
    if (Array.isArray(j.p)) for (const [key, mode, st] of j.p) if (typeof key === 'string' && MODES.includes(mode) && isObj(st)) (data.players[key] = isObj(data.players[key]) ? data.players[key] : dict())[mode] = st;
    if (Array.isArray(j.o)) for (const [k, rec] of j.o) if (typeof k === 'string') { if (rec === null) delete data.open[k]; else if (isObj(rec)) data.open[k] = rec; }
    if (Array.isArray(j.t)) for (const [m, pt] of j.t) if (MODES.includes(m) && validPot({ ...pt, seeded: undefined })) data.pot[m] = pt;
  }
  function replay() {
    let txt;
    try { txt = fs.readFileSync(jfile, 'utf8'); } catch (e) {
      if (e && e.code === 'ENOENT') return;
      blocked = 'the journal ' + jfile + ' cannot be read (' + (e && e.message) + ')';
      alarm('coldcall: store: *** ' + blocked + '. The Cold Call store is BLOCKED: nothing is written; Callbacks and leads are safe on disk until a person fixes this. ***'); return;
    }
    if (!txt.length) return;
    const parts = txt.split('\n'); const tail = parts.pop();                      // the text after the last newline: a line that was never completed (never acknowledged)
    const lines = [];                                                            // [{ j }|{ bad: why }]
    for (const ln of parts) {
      if (!ln) { lines.push({ bad: 'an empty line' }); continue; }
      const tab = ln.indexOf('\t'); const sum = tab === 8 ? ln.slice(0, 8) : '', json = tab === 8 ? ln.slice(9) : '';
      let j = null; if (sum && sum === sum8(json)) { try { j = JSON.parse(json); } catch {} }
      lines.push(isObj(j) && Number.isSafeInteger(j.s) && j.s > 0 ? { j } : { bad: 'checksum or JSON does not match' });
    }
    let badAt = lines.findIndex((l) => l.bad);
    let torn = tail.length > 0, damaged = false;
    if (badAt >= 0) {
      if (badAt === lines.length - 1 && !tail.length) torn = true;               // the last line only: written, never acknowledged
      else damaged = true;
    }
    const good = badAt >= 0 ? lines.slice(0, badAt) : lines;
    let applied = 0, skipped = 0, dropped = 0, maxSeq = jseq;
    for (const { j } of good) {
      if (j.s > maxSeq) maxSeq = j.s;
      if (j.s <= jseq) { skipped++; continue; }
      if (j.c && !j.z) {                                                          // a paid spin: applied only when the ledger holds the round (a kill between the line and the ledger call leaves nothing)
        let yes;
        try { yes = typeof opts.confirm === 'function' ? !!opts.confirm(j.c.k, j.c.i) : true; }
        catch (e) { blocked = 'the ledger could not be asked about round ' + JSON.stringify(j.c.i) + ' (' + (e && e.message) + ')'; alarm('coldcall: store: *** ' + blocked + '. The Cold Call store is BLOCKED: nothing is written. ***'); return; }
        if (!yes) { dropped++; continue; }
      }
      applyLine(j); applied++;
    }
    jlast = maxSeq;
    if (damaged) {
      const kept = keep(jfile);
      if (!kept) { blocked = 'the damaged journal ' + jfile + ' could not be kept under another name'; alarm('coldcall: store: *** ' + jfile + ' has a bad line (line ' + (badAt + 1) + ') and its bytes could not be kept. The Cold Call store is BLOCKED: nothing is loaded from it and nothing is written. ***'); return; }
      alarm('coldcall: store: *** the journal ' + jfile + ' has a bad line (line ' + (badAt + 1) + ' of ' + (lines.length + (tail ? 1 : 0)) + '; ' + lines[badAt].bad + '), kept as ' + kept + '. The ' + good.length + ' lines before it were applied; the lines after it were NOT (' + (lines.length - badAt - 1) + (tail ? ' + an unfinished one' : '') + '): leads / Callbacks of those spins may be gone. ***');
    } else if (torn) say('coldcall: store: the last journal line was never completed (a crash during a spin that was not answered), dropped');
    if (dropped) say('coldcall: store: ' + dropped + ' journal line(s) of rounds the ledger does not hold (killed before the ledger call), dropped');
    // whatever the journal added is checkpointed at once; the journal starts empty (and an unfinished tail is gone with it)
    if (applied || damaged || torn || skipped || dropped) {
      try { writeNow(); fs.writeFileSync(jfile, ''); jbytes = 0; }
      catch (e) { dirty = true; alarm('coldcall: store: the replayed journal could not be checkpointed to ' + file + ':', e && e.message); }
    }
  }
  jlast = Math.max(jlast, jseq);                                // numbering goes on after the checkpoint even when the journal is empty (a new line must never be numbered <= jseq: boot would skip it)
  if (file && !blocked) replay();
  jmode = !!(file && opts.journal && !blocked);
  if (jmode) { try { jopen(); const st = fs.fstatSync(jfd); jbytes = st.size; } catch (e) { jmode = false; alarm('coldcall: store: the journal ' + jfile + ' cannot be opened (' + (e && e.message) + '): whole-file writes only'); } }

  const checkMode = (mode) => { if (!MODES.includes(mode)) throw new Error('bad mode'); };
  const openKey = (key, mode) => key + '|' + mode;

  return {
    file, save, flush, close, blocked: () => blocked, journaled, intent, durable, covered, compact, openKey,
    // player state (a stored object or null; callers clone before handing it to the engine)
    player(key, mode) { checkMode(mode); const p = data.players[key]; return (p && p[mode]) || null; },
    setPlayer(key, mode, state) { checkMode(mode); (data.players[key] = data.players[key] || dict())[mode] = state; dirtyP.add(key + '\0' + mode); save(); },
    // the pot record of a currency (mirror + statistics + remainder); created empty on first use. The pot's MONEY is the ledger's pool account.
    pot(mode) {
      checkMode(mode);
      let p = data.pot[mode];
      if (!validPot(p)) { p = data.pot[mode] = { bal: 0, fed: 0, paid: 0, rem: 0, last: null }; dirtyT.add(mode); save(); }
      return p;
    },
    // the pot record if there is one (never creates it): a game that never ran a pot leaves no pot in its file
    peekPot(mode) { checkMode(mode); const p = data.pot[mode]; return validPot(p) ? p : null; },
    potChanged(mode) { markPots(mode); save(); },
    // open rounds (a decision pending, or a Callback in flight)
    putOpen(rec) { checkMode(rec.mode); data.open[openKey(rec.key, rec.mode)] = rec; dirtyO.add(openKey(rec.key, rec.mode)); save(); },
    delOpen(key, mode) { const had = delete data.open[openKey(key, mode)]; dirtyO.add(openKey(key, mode)); save(); return had; },
    getOpen(key, mode) { return data.open[openKey(key, mode)] || null; },
    allOpen() { return Object.values(data.open); },
    _data: () => data,
  };
}

module.exports = { createStore, MODES };
