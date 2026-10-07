'use strict';
// money/ledger.js: one append-only JSONL ledger of transfers. See V2-DESIGN.md "money/".
// Every write is transfer() or batch(); memory is updated only after the line is on disk.
//
// D2 (P6 wave 3c): the journal file is unchanged, byte for byte, and is never rewritten, rotated or compacted.
//  - Memory window: only the newest `window` applied lines (at most 2x, trimmed in blocks) stay parsed in RAM. `refs` keeps
//    every ref for ever as ref -> { id, sig (128 bits of sha256 of the old signature string), off, len } so idempotency is
//    unchanged and an old line can be read back with one positioned read. Older lines are streamed from the file.
//  - Checkpoint <file>.ckpt: a verified shortcut for boot (balances + refs + counts + sha256 of the covered journal bytes).
//    It is only ever believed when the journal bytes it covers hash to its sha256; any doubt means the full replay.
const fs = require('fs');
const crypto = require('crypto');

class MoneyError extends Error {
  constructor(code, details) {
    super(code);
    this.name = 'MoneyError';
    this.code = code;
    this.details = details || {};
    Object.assign(this, this.details);
  }
}

const CURS = ['chips', 'play'];
// Player-facing accounts can never go below zero. `bank` is chips only, `play` is Play $ only.
// `escrow:<game>:<key>:<roundId>` holds one open round's stake, `pool:<game>:<name>` a game's shared pot; both hold either currency.
const PLAYER_KINDS = { bank: 2, play: 2, seat: 3, pot: 3, orphan: 2, escrow: 4, pool: 3 };
const SOURCE_ACCOUNTS = new Set([
  'mint:signup', 'mint:bonus', 'mint:achv', 'mint:topup', 'mint:migration',
  'house:bender', 'house:coldcall', 'admin:adjust', 'fx:chips', 'fx:play',
]);
const ONLY_CUR = { bank: 'chips', play: 'play', 'fx:chips': 'chips', 'fx:play': 'play' };

const isAmount = (n) => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;

// -> { player: bool } or throws bad_account
function classify(account) {
  if (typeof account !== 'string') throw new MoneyError('bad_account', { account });
  if (SOURCE_ACCOUNTS.has(account)) return { player: false };
  const parts = account.split(':');
  const need = PLAYER_KINDS[parts[0]];
  // orphan names are free text (they came from old name-keyed bank rows), so everything after the prefix is the name.
  if (parts[0] === 'orphan' && parts.length >= 2 && account.length > 7) return { player: true };
  if (need && parts.length === need && parts.every(p => p.length > 0)) return { player: true };
  throw new MoneyError('bad_account', { account });
}

function normItem(it, defReason) {
  if (!it || typeof it !== 'object') throw new MoneyError('bad_item', { item: it });
  const { from, to, amount, cur } = it;
  const reason = it.reason != null ? it.reason : defReason;
  if (!CURS.includes(cur)) throw new MoneyError('bad_cur', { cur });
  if (!isAmount(amount)) throw new MoneyError('bad_amount', { amount });
  classify(from); classify(to);
  if (from === to) throw new MoneyError('bad_account', { account: from, why: 'from equals to' });
  for (const a of [from, to]) {
    const only = ONLY_CUR[a.split(':')[0]] || ONLY_CUR[a];
    if (only && only !== cur) throw new MoneyError('bad_account', { account: a, cur, why: 'wrong currency' });
  }
  if (typeof reason !== 'string' || !reason) throw new MoneyError('bad_reason', { reason });
  return { from, to, amount, cur, reason };
}

const sigOf = (item) => JSON.stringify([item.from, item.to, item.amount, item.cur, item.reason]);
// 128 bits of sha256 of the old signature string: the ref index keeps this instead of the string.
const sigHash = typeof crypto.hash === 'function'      // one-shot (node >= 21.7) is about twice as fast as createHash per line
  ? (sig) => crypto.hash('sha256', sig, 'hex').slice(0, 32)
  : (sig) => crypto.createHash('sha256').update(sig).digest('hex').slice(0, 32);

// A checkpoint is only believed by the code whose rules wrote it. RULES is set by hand (bump it when a rule changes in a way the
// source hash would not show, e.g. a dependency); SRC_SHA is the sha256 of this very file, read once at load, so ANY change here
// (a new source account, a new check, a new game) makes every older sidecar be refused: one full replay on the first boot of each
// deploy that touches money/ledger.js, on purpose.
const RULES = 1;
const SRC_SHA = crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex');
const RULES_ID = `${RULES}:${SRC_SHA}`;
// The exported rule objects are mutable (SOURCE_ACCOUNTS is a Set another file could .add() to at run time, CURS an array): their LIVE
// content is part of the fingerprint. Untouched, rulesId() is exactly RULES_ID; changed, it differs, so a sidecar written under one
// content is refused under the other (and vice versa).
const liveRules = () => JSON.stringify([[...SOURCE_ACCOUNTS].sort(), CURS]);
const LOAD_RULES = liveRules();
const rulesId = () => { const x = liveRules(); return x === LOAD_RULES ? RULES_ID : `${RULES_ID}+${crypto.createHash('sha256').update(x).digest('hex')}`; };
const CKPT_BLOCK = 5000;      // refs / balance pairs per sidecar line

const CHUNK = 1 << 20;        // read size for every streamed read of the journal
const IXK = 1024;             // sparse index: id + file offset of every IXK-th applied line (start points for cold streams)
const COLD_LOG_MS = 250;      // a cold scan slower than this logs one line with its caller
const EMPTY = Buffer.alloc(0);

// ---- state: everything a replay builds (also built a second time, separately, by ckptVerify) ----
function newState(window) {
  return {
    window,
    bal: { chips: new Map(), play: new Map() },
    refs: new Map(),            // ref -> { id, sig, off, len }   (off/len: where the line is in the journal, len without the newline)
    lines: [],                  // parsed applied lines, oldest first; lines[i] has absolute sequence base + i
    base: 0,                    // absolute sequence (count of applied lines before it) of lines[0]
    applied: 0,                 // applied lines in total
    lastId: 0,
    raw: 0,                     // complete lines of the journal covered (blank and not applied ones included)
    quarantined: [],            // [{ line, lineNo, reason }]
    hash: crypto.createHash('sha256'),   // running sha256 of every complete journal line replayed or appended
    ixId: [], ixOff: [],        // sparse index, entry k is the applied line with sequence k * IXK
  };
}

// Validates items in order against projected balances (a scratch copy of the touched accounts).
// Player accounts are checked at every step, so order inside a batch matters (seat -> pot before pot -> seat).
function validateItems(bal, items) {
  const scratch = { chips: new Map(), play: new Map() };
  const cur = (c, a) => (scratch[c].has(a) ? scratch[c].get(a) : (bal[c].get(a) || 0));
  for (const it of items) {
    if (classify(it.from).player) {
      const h = cur(it.cur, it.from);
      if (h < it.amount) throw new MoneyError('insufficient', { account: it.from, have: h, need: it.amount, cur: it.cur });
    }
    scratch[it.cur].set(it.from, cur(it.cur, it.from) - it.amount);
    scratch[it.cur].set(it.to, cur(it.cur, it.to) + it.amount);
  }
  return scratch;
}

function commitBal(bal, scratch) {
  for (const c of CURS) for (const [a, v] of scratch[c]) { if (v === 0) bal[c].delete(a); else bal[c].set(a, v); }
}

// An applied line enters the state: refs, sparse index, window (trimmed in blocks: at most 2x window, at least window).
function recordLine(S, rec, sig, off, len) {
  S.refs.set(rec.ref, { id: rec.id, sig, off, len });
  if (S.applied % IXK === 0) { S.ixId.push(rec.id); S.ixOff.push(off); }
  S.applied++;
  S.lines.push(rec);
  S.lastId = rec.id;
  if (S.window > 0 && S.lines.length >= 2 * S.window) {
    const drop = S.lines.length - S.window;
    S.lines.splice(0, drop);
    S.base += drop;
  }
}

// Applies one stored line or throws MoneyError('quarantine', { why }) with nothing changed. ids must only increase
// (a gap is allowed: a lost line then only costs the lines that depend on it, not every line after it).
function replayLine(S, rec, off, len) {
  const no = (why) => new MoneyError('quarantine', { why });
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) throw no('not a record');
  if (!Number.isSafeInteger(rec.id) || rec.id <= S.lastId) throw no(`id ${JSON.stringify(rec.id)} is not after ${S.lastId}`);
  let items, sig, scratch;
  try {
    if (Array.isArray(rec.batch)) {
      items = rec.batch.map(it => normItem(it, rec.reason));
      sig = JSON.stringify(['batch', rec.reason || null, items.map(sigOf)]);
    } else {
      items = [normItem(rec)];
      sig = sigOf(items[0]);
    }
    if (typeof rec.ref !== 'string' || !rec.ref) throw new MoneyError('bad_ref', { ref: rec.ref });
    if (S.refs.has(rec.ref)) throw no('duplicate ref ' + rec.ref);
    scratch = validateItems(S.bal, items);
  } catch (e) {
    if (e instanceof MoneyError && e.code === 'quarantine') throw e;
    const d = e.details || {};
    throw no(e.code === 'insufficient' ? `insufficient: ${d.account} has ${d.have}, needs ${d.need}` : (e.code || e.message));
  }
  commitBal(S.bal, scratch);
  recordLine(S, rec, sigHash(sig), off, len);
}

// ---- journal readers (synchronous, chunked; the journal is never read into one Buffer) ----
function readFull(fd, buf, pos, want) {
  let got = 0;
  while (got < want) { const n = fs.readSync(fd, buf, got, want - got, pos + got); if (!n) break; got += n; }
  return got;
}

// Forward line reader over journal bytes [from, to): next() -> { off, buf, s, e } (line = buf[s, e), buf[e] is the newline) or null.
// A last piece without a newline is not a line (torn tail).
function lineReader(readAt, from, to) {
  let pos = from, buf = EMPTY, bufOff = from, p = 0;
  return {
    next() {
      for (;;) {
        const nl = buf.indexOf(10, p);
        if (nl >= 0) { const o = { off: bufOff + p, buf, s: p, e: nl }; p = nl + 1; return o; }
        const want = Math.min(CHUNK, to - pos);
        if (want <= 0) return null;
        const chunk = Buffer.allocUnsafe(want);
        const n = readAt(chunk, pos, want);
        if (!n) return null;
        pos += n;
        const rest = p < buf.length ? buf.subarray(p) : EMPTY;
        bufOff += p; p = 0;
        buf = rest.length ? Buffer.concat([rest, chunk.subarray(0, n)]) : chunk.subarray(0, n);
      }
    },
  };
}

// Backward line reader: lines that end before byte `end` (the byte before `end` is a newline, or end is 0), newest first.
function revReader(readAt, end) {
  let buf = EMPTY, bufOff = end, hi = 0;   // buf[0, hi) is the part not handed out yet; buf[0] is journal byte bufOff
  return {
    next() {
      for (;;) {
        if (hi > 0) {
          const prev = hi >= 2 ? buf.lastIndexOf(10, hi - 2) : -1;
          if (prev >= 0 || bufOff === 0) { const s = prev + 1; const o = { off: bufOff + s, buf, s, e: hi - 1 }; hi = s; return o; }
        } else if (bufOff === 0) return null;
        const n = Math.min(CHUNK, bufOff);
        const chunk = Buffer.allocUnsafe(n);
        if (readAt(chunk, bufOff - n, n) !== n) throw new MoneyError('journal_mismatch', { why: 'short read', at: bufOff - n });
        buf = Buffer.concat([chunk, buf.subarray(0, hi)]);
        bufOff -= n; hi = buf.length;
      }
    },
  };
}

const legOf = (rec, it) => (it
  ? { id: rec.id, ts: rec.ts, from: it.from, to: it.to, amount: it.amount, cur: it.cur, reason: it.reason, ref: rec.ref, batchRef: rec.ref }
  : { id: rec.id, ts: rec.ts, from: rec.from, to: rec.to, amount: rec.amount, cur: rec.cur, reason: rec.reason, ref: rec.ref, batchRef: null });

function callerOf() {
  for (const f of (new Error().stack || '').split('\n').slice(1)) {
    if (f.includes(__filename) || f.includes('node:internal')) continue;
    const m = f.match(/([^()\s]+:\d+):\d+\)?\s*$/);
    if (m) return m[1];
  }
  return '?';
}

const intOk = (n) => Number.isSafeInteger(n) && n >= 0;

// What differs between two states ('' = nothing). Used by ckptVerify: the checkpointed boot against the full replay.
function diffStates(a, b) {
  const out = [];
  if (a.lastId !== b.lastId) out.push(`lastId ${a.lastId} vs ${b.lastId}`);
  if (a.applied !== b.applied) out.push(`applied ${a.applied} vs ${b.applied}`);
  if (a.raw !== b.raw) out.push(`raw lines ${a.raw} vs ${b.raw}`);
  for (const c of CURS) {
    const x = a.bal[c], y = b.bal[c];
    const bad = [];
    for (const [k, v] of x) if ((y.get(k) || 0) !== v) bad.push(`${k}: ${v} vs ${y.get(k) || 0}`);
    for (const [k, v] of y) if (!x.has(k)) bad.push(`${k}: 0 vs ${v}`);
    if (bad.length) out.push(`${c} balances (${bad.length}) ${bad.slice(0, 3).join('; ')}`);
  }
  if (a.refs.size !== b.refs.size) out.push(`refs ${a.refs.size} vs ${b.refs.size}`);
  else {
    let bad = 0, first = '';
    for (const [k, v] of a.refs) {
      const w = b.refs.get(k);
      if (!w || w.id !== v.id || w.sig !== v.sig || w.off !== v.off || w.len !== v.len) { bad++; if (!first) first = k; }
    }
    if (bad) out.push(`refs differ (${bad}, first ${first})`);
  }
  if (JSON.stringify(a.quarantined) !== JSON.stringify(b.quarantined)) out.push(`quarantined ${a.quarantined.length} vs ${b.quarantined.length}`);
  return out.join(', ');
}

function open(file, opts = {}) {
  const now = opts.now || Date.now;
  // 'all' (default): every transfer and batch is fsynced. 'batch': batches only. 'none': tests and bulk loads.
  const fsyncMode = opts.fsync || 'all';
  const log = opts.log || ((m) => console.error('[money] ' + m));
  const env = process.env;
  const numOpt = (v, envv, def) => { const x = v != null ? Number(v) : (envv != null && envv !== '' ? Number(envv) : def); return Number.isInteger(x) && x >= 0 ? x : def; };
  const window0 = numOpt(opts.window, env.LEDGER_WINDOW, 20000);
  const window = window0 === 1 ? 2 : window0;      // a window of 1 would leave the window at every append (a cold scan each): 2 is the smallest
  if (window0 === 1) log('window 1 raised to 2 (a window of 1 reads the journal back on every append)');
  const ckptOn = opts.ckpt != null ? !!opts.ckpt && String(opts.ckpt) !== '0' : !["0", "false", "off", "no"].includes(String(env.LEDGER_CKPT).toLowerCase());
  const ckptEvery = numOpt(opts.ckptEvery, env.LEDGER_CKPT_EVERY, 0);
  const ckptVerify = opts.ckptVerify != null ? !!opts.ckptVerify && String(opts.ckptVerify) !== '0' : env.LEDGER_CKPT_VERIFY === '1';
  const ckptFile = file + '.ckpt';
  const coldLogMs = opts.coldLogMs != null ? opts.coldLogMs : COLD_LOG_MS;   // (tests lower it)

  // Writer fence (no blocking lock, so a stale lock can never stop a boot): the newest opener writes its token to
  // <file>.lock and wins. Every append re-reads the lock and the file size; a writer that lost either is refused for good.
  const lockFile = file + '.lock';
  const token = crypto.randomBytes(16).toString('hex');
  const readLock = () => { try { return fs.readFileSync(lockFile, 'utf8').trim(); } catch { return null; } };
  const prevLock = readLock();
  if (prevLock) log(`replaced a lock held by another opener (${prevLock.slice(0, 8)}) on ${file}`);
  fs.writeFileSync(lockFile, token + '\n');
  let refused = null;                   // 'lost_lock' | 'foreign_write' once fenced out

  const stats = { coldScans: 0, coldScanMs: 0, coldLookups: 0 };
  const ck = { enabled: ckptOn, used: false, bytes: 0, lastId: 0, tailLines: 0, ignored: null, mismatch: false, written: 0, lastMs: 0, lastOk: null };

  function releaseLock() { if (readLock() === token) { try { fs.unlinkSync(lockFile); } catch {} } }

  // Positioned read of the journal: through the long-lived read fd, or a throwaway one after close().
  let rfd = null;
  try { rfd = fs.openSync(file, 'r'); } catch (e) { if (e.code !== 'ENOENT') { releaseLock(); throw e; } }
  const readAt = (buf, pos, want) => {
    if (rfd != null) return readFull(rfd, buf, pos, want);
    let t;
    try { t = fs.openSync(file, 'r'); return readFull(t, buf, pos, want); } catch (e) { if (e.code === 'ENOENT') return 0; throw e; } finally { if (t != null) try { fs.closeSync(t); } catch {} }
  };
  const closeRfd = () => { if (rfd != null) { try { fs.closeSync(rfd); } catch {} rfd = null; } };

  // Replays journal bytes [from, to) into S: today's validation, quarantine and torn-tail rule. Returns the byte length of the complete lines.
  function replayRange(S, from, to) {
    const rd = lineReader(readAt, from, to);
    let good = from;
    for (let l; (l = rd.next());) {
      S.raw++;
      good = l.off + (l.e - l.s) + 1;
      S.hash.update(l.buf.subarray(l.s, l.e + 1));
      const ln = l.buf.toString('utf8', l.s, l.e);
      if (ln.trim() === '') continue;
      try {
        let rec;
        try { rec = JSON.parse(ln); } catch { throw new MoneyError('quarantine', { why: 'unparseable' }); }
        replayLine(S, rec, l.off, l.e - l.s);
      } catch (e) { S.quarantined.push({ line: ln, lineNo: S.raw, reason: e.details && e.details.why ? e.details.why : e.message }); }
    }
    return good;
  }

  function hashRange(to) {
    const h = crypto.createHash('sha256');
    const buf = Buffer.allocUnsafe(CHUNK);
    for (let pos = 0; pos < to;) {
      const want = Math.min(CHUNK, to - pos);
      if (readAt(buf, pos, want) !== want) throw new Error('journal is shorter than the checkpoint says');
      h.update(buf.subarray(0, want));
      pos += want;
    }
    return h;
  }

  // Reads and checks <file>.ckpt against the journal (jsize bytes), restores the state it covers, then replays the tail.
  // Throws Error(why) on any doubt; the caller then ignores the checkpoint and replays everything.
  // Sidecar format v2: line 1 = header object, then one JSON array per line: ["bc", [acct, n, ...]] ["bp", ...] ["q", {quarantined}]
  // ["r", [ref, id, sig, off, len, ...]] (blocks of CKPT_BLOCK), last line ["end"]. Read and written line by line, never as one string.
  function readCkptLines(fn) {
    let cfd = null;
    try {
      cfd = fs.openSync(ckptFile, 'r');
      const csize = fs.fstatSync(cfd).size;
      const pre = Buffer.alloc(7);
      if (readFull(cfd, pre, 0, 7) !== 7) throw new Error('not readable JSON');
      if (pre.toString('latin1') !== '{"v":2,') {
        const m = /^\{"v":(\d+)/.exec(pre.toString('latin1'));
        throw new Error(m ? 'version ' + m[1] : 'not readable JSON');
      }
      const rd = lineReader((b, pos, want) => readFull(cfd, b, pos, want), 0, csize);
      let n = 0;
      for (let l; (l = rd.next());) {
        let v;
        try { v = JSON.parse(l.buf.toString('utf8', l.s, l.e)); } catch { throw new Error('not readable JSON'); }
        fn(v, n++);
      }
      if (rd.next() !== null) throw new Error('wrong shape');
      return csize;
    } finally { if (cfd != null) try { fs.closeSync(cfd); } catch {} }
  }

  function loadCheckpoint(jsize) {
    let c = null, ended = false, nBc = 0, nBp = 0, nQ = 0, nR = 0;
    const bal = { chips: [], play: [] }, quar = [], refsFlat = [];
    readCkptLines((v, i) => {
      if (i === 0) { c = v; if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('wrong shape'); return; }
      if (ended || !Array.isArray(v)) throw new Error('wrong shape');
      if (v[0] === 'bc' || v[0] === 'bp') { if (!Array.isArray(v[1])) throw new Error('wrong shape'); const t = bal[v[0] === 'bc' ? 'chips' : 'play']; for (const x of v[1]) t.push(x); }
      else if (v[0] === 'q') quar.push(v[1]);
      else if (v[0] === 'r') { if (!Array.isArray(v[1])) throw new Error('wrong shape'); refsFlat.push(v[1]); }
      else if (v[0] === 'end') ended = true;
      else throw new Error('wrong shape');
    });
    if (!c) throw new Error('not readable JSON');
    if (c.v !== 2) throw new Error('version ' + JSON.stringify(c.v));
    if (c.rules !== rulesId()) throw new Error('rules changed');
    if (!ended) throw new Error('wrong shape (no end line)');
    if (!intOk(c.bytes) || !intOk(c.lastId) || !intOk(c.rawLines) || !intOk(c.applied) || typeof c.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(c.sha256)) throw new Error('wrong shape');
    if (c.nbc !== bal.chips.length / 2 || c.nbp !== bal.play.length / 2 || c.nq !== quar.length) throw new Error('wrong shape (counts)');
    c.bal = bal; c.quarantined = quar; c.refs = null;
    if (c.bytes > jsize) throw new Error(`covers ${c.bytes} bytes but the journal has ${jsize}`);
    if (c.bytes > 0) {
      const one = Buffer.alloc(1);
      if (readAt(one, c.bytes - 1, 1) !== 1 || one[0] !== 10) throw new Error('covered part does not end at a line end');
    }
    const h = hashRange(c.bytes);
    if (h.copy().digest('hex') !== c.sha256) throw new Error('sha256 of the covered journal differs');

    const S = newState(window);
    S.hash = h;
    for (const cur of CURS) {
      const flat = c.bal[cur];
      if (flat.length % 2) throw new Error('wrong shape (balances)');
      for (let i = 0; i < flat.length; i += 2) {
        if (typeof flat[i] !== 'string' || typeof flat[i + 1] !== 'number' || !Number.isFinite(flat[i + 1])) throw new Error('wrong shape (balances)');
        S.bal[cur].set(flat[i], flat[i + 1]);
      }
    }
    let nflat = 0;
    for (const b of refsFlat) { if (b.length % 5) throw new Error('wrong shape (refs)'); nflat += b.length / 5; }
    const n = nflat;
    if (n !== c.applied) throw new Error(`refs ${n} but applied ${c.applied}`);
    let prevId = 0, prevEnd = 0, i = 0;
    const offAt = [];                    // offset of every ref in order, for the window start
    for (const fr of refsFlat) {
      for (let j = 0; j < fr.length; j += 5, i++) {
        const ref = fr[j], id = fr[j + 1], sig = fr[j + 2], off = fr[j + 3], len = fr[j + 4];
        if (typeof ref !== 'string' || !ref || !Number.isSafeInteger(id) || id <= prevId || typeof sig !== 'string' || sig.length !== 32
          || !intOk(off) || !intOk(len) || off < prevEnd || off + len + 1 > c.bytes) throw new Error('wrong shape (refs)');
        if (S.refs.has(ref)) throw new Error('duplicate ref in checkpoint');
        S.refs.set(ref, { id, sig, off, len });
        if (i % IXK === 0) { S.ixId.push(id); S.ixOff.push(off); }
        prevId = id; prevEnd = off + len + 1;
        if (S.window === 0 || i >= n - S.window) { if (offAt.length === 0) offAt.push(off); }
      }
    }
    if (c.lastId !== prevId) throw new Error('lastId does not match the refs');
    for (const q of c.quarantined) if (!q || typeof q.line !== 'string' || !intOk(q.lineNo) || typeof q.reason !== 'string') throw new Error('wrong shape (quarantined)');
    if (c.applied + c.quarantined.length > c.rawLines) throw new Error('counts are inconsistent');
    S.applied = n; S.raw = c.rawLines; S.lastId = c.lastId; S.quarantined = c.quarantined.slice();

    // the window: the newest `window` applied lines, read back from the covered part (one contiguous read)
    const want = S.window === 0 ? n : Math.min(n, S.window);
    if (want > 0) {
      const from = offAt[0];
      const rd = lineReader(readAt, from, c.bytes);
      for (let l; (l = rd.next());) {
        let rec;
        try { rec = JSON.parse(l.buf.toString('utf8', l.s, l.e)); } catch { continue; }
        const r = rec && typeof rec.ref === 'string' ? S.refs.get(rec.ref) : null;
        if (r && r.off === l.off) S.lines.push(rec);
      }
      if (S.lines.length !== want) throw new Error('the covered journal does not match the checkpoint refs');
      S.base = n - want;
    }
    const good = replayRange(S, c.bytes, jsize);
    return { S, good, tailLines: S.raw - c.rawLines, lastId: c.lastId, bytes: c.bytes };
  }

  function ckptBad(why) {
    ck.ignored = why;
    log(`checkpoint ignored: ${why}`);
    try { fs.renameSync(ckptFile, ckptFile + '.bad'); } catch {}
  }

  // ---- load + replay ----
  // A line that does not parse or does not validate is NOT applied: it is recorded in <file>.quarantine (once) and
  // reported, and the ledger opens on the valid lines. The file itself is never rewritten here. Only the torn tail
  // (no trailing newline) is truncated, as before.
  const quarantineFile = file + '.quarantine';
  let S, good = 0;
  try {
    const jsize = rfd != null ? fs.fstatSync(rfd).size : 0;
    let fromCkpt = null;
    if (ckptOn && fs.existsSync(ckptFile)) {
      const t0 = Date.now();
      try { fromCkpt = loadCheckpoint(jsize); fromCkpt.ms = Date.now() - t0; } catch (e) { ckptBad(e.message); fromCkpt = null; }
    }
    if (fromCkpt && ckptVerify) {
      const full = newState(window);
      const fgood = replayRange(full, 0, jsize);
      const d = diffStates(fromCkpt.S, full) + (fgood !== fromCkpt.good ? `, good ${fromCkpt.good} vs ${fgood}` : '');
      if (d) {
        log(`CHECKPOINT MISMATCH: the checkpoint disagrees with the full replay: ${d}. Using the full replay.`);
        ck.mismatch = true; ck.ignored = 'mismatch';
        try { fs.renameSync(ckptFile, ckptFile + '.bad'); } catch {}
        fromCkpt = null; S = full; good = fgood;
      }
    }
    if (fromCkpt) {
      S = fromCkpt.S; good = fromCkpt.good;
      ck.used = true; ck.bytes = fromCkpt.bytes; ck.lastId = fromCkpt.lastId; ck.tailLines = fromCkpt.tailLines;
      log(`checkpoint id ${fromCkpt.lastId} at ${fromCkpt.bytes} bytes, ${fromCkpt.tailLines} tail lines replayed, ${fromCkpt.ms} ms`);
    } else if (!S) {
      S = newState(window);
      good = replayRange(S, 0, jsize);
    }
    if (good < jsize) fs.truncateSync(file, good);
  } catch (e) { closeRfd(); releaseLock(); throw e; }
  const quarantined = S.quarantined;    // [{ line, lineNo, reason }] for this open
  if (quarantined.length) {
    const seen = new Set();
    try { for (const l of fs.readFileSync(quarantineFile, 'utf8').split('\n')) { if (l) try { seen.add(JSON.parse(l).line); } catch {} } } catch {}
    const fresh = quarantined.filter(q => !seen.has(q.line));
    try {
      if (fresh.length) fs.appendFileSync(quarantineFile, fresh.map(q => JSON.stringify({ ts: now(), lineNo: q.lineNo, reason: q.reason, line: q.line })).join('\n') + '\n');
    } catch (e) { log(`could not write ${quarantineFile}: ${e.message}`); }
    log(`QUARANTINED ${quarantined.length} line(s) of ${file} (${fresh.length} new, see ${quarantineFile}). They were NOT applied: balances may be short by those lines and need an admin look. ` +
      quarantined.slice(0, 3).map(q => `line ${q.lineNo}: ${q.reason}`).join('; '));
  }
  let size = good;
  const fd = fs.openSync(file, 'a');
  if (rfd == null) { try { rfd = fs.openSync(file, 'r'); } catch {} }
  let closed = false;
  let sinceCkpt = 0;

  const get = (cur, account) => S.bal[cur].get(account) || 0;

  // Runs before every append. Not atomic with the append itself: a second opener landing between this check and the
  // write can still get one line in; the next open then quarantines the duplicate-id line (see money/PROGRESS.md).
  function fence() {
    if (refused) throw new MoneyError(refused);
    if (readLock() !== token) { refused = 'lost_lock'; throw new MoneyError('lost_lock', { file }); }
    const have = fs.fstatSync(fd).size;
    if (have !== size) { refused = 'foreign_write'; throw new MoneyError('foreign_write', { file, expected: size, have }); }
  }

  function append(rec, doSync) {
    if (closed) throw new MoneyError('closed');
    fence();
    const buf = Buffer.from(JSON.stringify(rec) + '\n');
    try {
      let off = 0;
      while (off < buf.length) off += fs.writeSync(fd, buf, off);
      if (doSync) fs.fsyncSync(fd);
    } catch (e) {
      try { fs.ftruncateSync(fd, size); } catch {}
      throw new MoneyError('write_failed', { cause: e.message });
    }
    const at = size;
    size += buf.length;
    S.hash.update(buf);
    S.raw++;
    return { off: at, len: buf.length - 1 };
  }

  function refCheck(ref, sig) {
    if (typeof ref !== 'string' || !ref) throw new MoneyError('bad_ref', { ref });
    const prev = S.refs.get(ref);
    if (!prev) return null;
    if (prev.sig !== sig) throw new MoneyError('ref_conflict', { ref, id: prev.id });
    return { id: prev.id, dup: true };
  }

  // onLine(fn): fn() runs after every applied append (the line is already in memory and on disk). The service keeps its indexes up to date this way.
  const listeners = [];
  const onLine = (fn) => { listeners.push(fn); };

  function write(rec, items, sig, doSync, scratch) {
    const at = append(rec, doSync);
    commitBal(S.bal, scratch);
    recordLine(S, rec, sig, at.off, at.len);
    for (const fn of listeners) { try { fn(); } catch (e) { log(`onLine listener failed: ${e.message}`); } }
    if (ckptEvery > 0 && ++sinceCkpt >= ckptEvery) { sinceCkpt = 0; checkpoint(); }
    return { id: rec.id, dup: false };
  }

  function transfer(from, to, amount, cur, reason, ref) {
    const item = normItem({ from, to, amount, cur, reason });
    const sig = sigHash(sigOf(item));
    const dup = refCheck(ref, sig);
    if (dup) return dup;
    const scratch = validateItems(S.bal, [item]);
    const rec = { id: S.lastId + 1, ts: now(), ...item, ref };
    return write(rec, [item], sig, fsyncMode === 'all', scratch);
  }

  function batch(items, ref, reason) {
    if (!Array.isArray(items) || items.length === 0) throw new MoneyError('empty_batch');
    const norm = items.map(it => normItem(it, reason));
    const sig = sigHash(JSON.stringify(['batch', reason || null, norm.map(sigOf)]));
    const dup = refCheck(ref, sig);
    if (dup) return dup;
    const scratch = validateItems(S.bal, norm);
    const rec = { id: S.lastId + 1, ts: now(), batch: norm, ref };
    if (reason) rec.reason = reason;
    return write(rec, norm, sig, fsyncMode !== 'none', scratch);
  }

  function balance(account, cur) {
    if (!CURS.includes(cur)) throw new MoneyError('bad_cur', { cur });
    return get(cur, account);
  }

  function list(prefix, cur) {
    if (!CURS.includes(cur)) throw new MoneyError('bad_cur', { cur });
    const out = [];
    for (const [account, balance] of S.bal[cur]) if (balance !== 0 && account.startsWith(prefix)) out.push({ account, balance });
    out.sort((a, b) => (a.account < b.account ? -1 : a.account > b.account ? 1 : 0));
    return out;
  }

  const has = (ref) => S.refs.has(ref);

  // ---- reading lines back: memory window first, the journal file for older ones ----
  // What a cold line is: the applied line the ref index points at (-> rec), a line that was legitimately not applied (blank, or one of
  // the quarantined lines of this open: -> null), or anything else = the journal is not what the index says -> MoneyError, never a skip.
  let qSet = null;
  function coldLine(l) {
    const ln = l.buf.toString('utf8', l.s, l.e);
    if (ln.trim() === '') return null;
    let rec = null;
    try { rec = JSON.parse(ln); } catch {}
    const r = rec && typeof rec.ref === 'string' ? S.refs.get(rec.ref) : null;
    if (r && r.off === l.off) {
      if (r.id !== rec.id) throw new MoneyError('journal_mismatch', { why: 'id differs from the index', at: l.off });
      return rec;
    }
    if (!qSet) qSet = new Set(S.quarantined.map(q => q.line));
    if (qSet.has(ln)) return null;
    throw new MoneyError('journal_mismatch', { why: 'line is neither applied nor quarantined', at: l.off });
  }
  // A cold stream: applied lines in order from the journal, starting at the sparse index point at or before applied-line `seq`.
  function coldOpen(seq) {
    const k = Math.min(Math.floor(seq / IXK), S.ixOff.length - 1);
    const c = { seq: k < 0 ? 0 : k * IXK, t0: Date.now(), lines: 0, caller: callerOf(), rd: null };
    c.rd = lineReader(readAt, k < 0 ? 0 : S.ixOff[k], Number.MAX_SAFE_INTEGER);   // no end: lines appended (and trimmed) meanwhile are read too
    stats.coldScans++;
    return c;
  }
  function coldNext(c) {                // the next applied line (c.seq advances), or null at the end of the file
    for (let l; (l = c.rd.next());) {
      c.lines++;
      const rec = coldLine(l);
      if (rec) {
        // a cold line must lie before the first in-window line: past it the stream has lost one on the way
        const first = S.lines.length ? S.refs.get(S.lines[0].ref).off : size;
        if (l.off >= first) throw new MoneyError('journal_mismatch', { why: 'a cold line is missing', at: l.off });
        c.seq++; return rec;
      }
    }
    return null;
  }
  function coldDone(c) {
    const ms = Date.now() - c.t0;
    stats.coldScanMs += ms;
    if (ms > coldLogMs) log(`cold scan of ${file}: ${ms} ms, ${c.lines} journal lines read, called from ${c.caller}`);
  }

  // afterId (optional, extra to the contract): only lines with id > afterId.
  // The position is an absolute applied-line sequence, so a generator suspended while lines are appended or trimmed still
  // gives every line once and in order.
  function* entries(filterFn, afterId = 0) {
    let seq, cold = null;
    if (afterId >= S.lastId) return;
    const L = S.lines;
    if (L.length && L[0].id <= afterId) {
      let lo = 0, hi = L.length;        // first line with id > afterId (ids increase but may have gaps)
      while (lo < hi) { const mid = (lo + hi) >> 1; if (L[mid].id <= afterId) lo = mid + 1; else hi = mid; }
      seq = S.base + lo;
    } else if (S.base === 0) {
      seq = 0;
    } else {                            // the start is in the cold part: begin at the sparse index point at or before afterId
      let lo = 0, hi = S.ixId.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (S.ixId[mid] <= afterId) lo = mid + 1; else hi = mid; }
      seq = lo > 0 ? (lo - 1) * IXK : 0;
    }
    try {
      for (;;) {
        if (seq >= S.base + S.lines.length) return;
        let rec;
        if (seq >= S.base) {
          if (cold) { coldDone(cold); cold = null; }
          rec = S.lines[seq - S.base];
        } else {
          if (!cold || cold.seq > seq) { if (cold) coldDone(cold); cold = coldOpen(seq); }
          do { rec = coldNext(cold); } while (rec && cold.seq <= seq);
          if (!rec) throw new MoneyError('journal_mismatch', { why: `the journal has no applied line ${seq}`, file });
        }
        seq++;
        if (rec.id <= afterId) continue;
        if (Array.isArray(rec.batch)) {
          for (const it of rec.batch) { const e = legOf(rec, it); if (!filterFn || filterFn(e)) yield e; }
        } else {
          const e = legOf(rec, null);
          if (!filterFn || filterFn(e)) yield e;
        }
      }
    } finally { if (cold) coldDone(cold); }
  }

  const expand = (rec) => (Array.isArray(rec.batch) ? rec.batch.map(it => legOf(rec, it)) : [legOf(rec, null)]);

  // The entries of the one line that holds `ref` ([] if none): from memory if in the window, else one positioned read.
  function entriesOf(ref) {
    const r = typeof ref === 'string' ? S.refs.get(ref) : undefined;
    if (!r) return [];
    const L = S.lines;
    let lo = 0, hi = L.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (L[mid].id < r.id) lo = mid + 1; else hi = mid; }
    if (lo < L.length && L[lo].id === r.id) return expand(L[lo]);
    stats.coldLookups++;
    const buf = Buffer.allocUnsafe(r.len);
    if (readAt(buf, r.off, r.len) !== r.len) throw new MoneyError('journal_mismatch', { why: 'shorter than its index', file, at: r.off });
    let rec = null;
    try { rec = JSON.parse(buf.toString('utf8')); } catch {}
    if (!rec || rec.ref !== ref || rec.id !== r.id) throw new MoneyError('journal_mismatch', { why: 'does not match its index', file, at: r.off });
    return expand(rec);
  }

  // The newest entry for which filterFn is true, or null: what `let r = null; for (const e of entries(filterFn)) r = e;` returns.
  function findLast(filterFn) {
    const L = S.lines;
    for (let i = L.length - 1; i >= 0; i--) {
      const rec = L[i];
      if (Array.isArray(rec.batch)) {
        for (let j = rec.batch.length - 1; j >= 0; j--) { const e = legOf(rec, rec.batch[j]); if (!filterFn || filterFn(e)) return e; }
      } else {
        const e = legOf(rec, null);
        if (!filterFn || filterFn(e)) return e;
      }
    }
    if (S.base === 0) return null;
    const end = L.length ? S.refs.get(L[0].ref).off : size;
    const c = { t0: Date.now(), lines: 0, caller: callerOf() };
    stats.coldScans++;
    try {
      const rd = revReader(readAt, end);
      for (let l; (l = rd.next());) {
        c.lines++;
        const rec = coldLine(l);
        if (!rec) continue;
        if (Array.isArray(rec.batch)) {
          for (let j = rec.batch.length - 1; j >= 0; j--) { const e = legOf(rec, rec.batch[j]); if (!filterFn || filterFn(e)) return e; }
        } else {
          const e = legOf(rec, null);
          if (!filterFn || filterFn(e)) return e;
        }
      }
      return null;
    } finally { coldDone(c); }
  }

  function check() {
    const out = {};
    for (const c of CURS) {
      let players = 0, sources = 0;
      for (const [a, v] of S.bal[c]) { if (classify(a).player) players += v; else sources += v; }
      out[c] = { players, sources, ok: players + sources === 0 };
    }
    out.quarantined = quarantined.length;   // lines left out at open; separate from ok (the books balance without them)
    return out;
  }

  // ---- checkpoint: <file>.ckpt, written as .ckpt.tmp + fsync + rename. Never throws, never touches the journal. ----
  function checkpoint() {
    const t0 = Date.now();
    const tmp = ckptFile + '.tmp';
    let wfd = null;
    try {
      if (!ckptOn) return { ok: false, why: 'disabled' };
      if (closed) return { ok: false, why: 'closed' };
      try { fence(); } catch (e) { return { ok: false, why: e.code || e.message }; }
      fs.fsyncSync(fd);                 // the journal bytes the checkpoint covers are on disk before it says so
      wfd = fs.openSync(tmp, 'w');
      const put = (s) => { const b = Buffer.from(s + '\n'); let o = 0; while (o < b.length) o += fs.writeSync(wfd, b, o); };
      const head = JSON.stringify({
        v: 2, rules: rulesId(), bytes: size, sha256: S.hash.copy().digest('hex'), lastId: S.lastId, rawLines: S.raw, applied: S.applied,
        nbc: S.bal.chips.size, nbp: S.bal.play.size, nq: S.quarantined.length, ts: now(),
      });
      put(head);
      for (const [tag, m] of [['bc', S.bal.chips], ['bp', S.bal.play]]) {
        let blk = [];
        for (const [k, v] of m) { blk.push(k, v); if (blk.length >= 2 * CKPT_BLOCK) { put(JSON.stringify([tag, blk])); blk = []; } }
        if (blk.length) put(JSON.stringify([tag, blk]));
      }
      for (const q of S.quarantined) put(JSON.stringify(['q', q]));
      let blk = [];
      for (const [ref, r] of S.refs) { blk.push(ref, r.id, r.sig, r.off, r.len); if (blk.length >= 5 * CKPT_BLOCK) { put(JSON.stringify(['r', blk])); blk = []; } }
      if (blk.length) put(JSON.stringify(['r', blk]));
      put('["end"]');
      fs.fsyncSync(wfd); fs.closeSync(wfd); wfd = null;
      fs.renameSync(tmp, ckptFile);
      const ms = Date.now() - t0;
      ck.written++; ck.lastMs = ms; ck.lastOk = { bytes: size, lastId: S.lastId };
      return { ok: true, bytes: size, lastId: S.lastId, refs: S.refs.size, ms };
    } catch (e) {
      if (wfd != null) try { fs.closeSync(wfd); } catch {}
      try { fs.unlinkSync(tmp); } catch {}
      log(`checkpoint failed: ${e.message}`);
      return { ok: false, why: e.message };
    }
  }

  function statsOut() {
    return { lines: S.applied, inMemory: S.lines.length, window, coldScans: stats.coldScans, coldScanMs: stats.coldScanMs, coldLookups: stats.coldLookups, ckpt: { ...ck } };
  }

  function sync() { if (!closed) fs.fsyncSync(fd); }
  function close() { if (!closed) { closed = true; try { fs.closeSync(fd); } catch {} closeRfd(); releaseLock(); } }

  return { transfer, batch, balance, list, has, entries, entriesOf, findLast, onLine, check, sync, close, checkpoint, stats: statsOut, file, quarantined, quarantineFile, get size() { return size; }, get lastId() { return S.lastId; } };
}

module.exports = { open, MoneyError, SOURCE_ACCOUNTS, CURS };
