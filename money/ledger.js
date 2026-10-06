'use strict';
// money/ledger.js: one append-only JSONL ledger of transfers. See V2-DESIGN.md "money/".
// Every write is transfer() or batch(); memory is updated only after the line is on disk.
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

function open(file, opts = {}) {
  const now = opts.now || Date.now;
  // 'all' (default): every transfer and batch is fsynced. 'batch': batches only. 'none': tests and bulk loads.
  const fsyncMode = opts.fsync || 'all';
  const log = opts.log || ((m) => console.error('[money] ' + m));
  // Writer fence (no blocking lock, so a stale lock can never stop a boot): the newest opener writes its token to
  // <file>.lock and wins. Every append re-reads the lock and the file size; a writer that lost either is refused for good.
  const lockFile = file + '.lock';
  const token = crypto.randomBytes(16).toString('hex');
  const readLock = () => { try { return fs.readFileSync(lockFile, 'utf8').trim(); } catch { return null; } };
  const prevLock = readLock();
  if (prevLock) log(`replaced a lock held by another opener (${prevLock.slice(0, 8)}) on ${file}`);
  fs.writeFileSync(lockFile, token + '\n');
  let refused = null;                   // 'lost_lock' | 'foreign_write' once fenced out

  const bal = { chips: new Map(), play: new Map() };
  const refs = new Map();   // ref -> { id, sig }
  const lines = [];         // parsed lines, in order (transfer or batch)
  let lastId = 0;

  const get = (cur, account) => bal[cur].get(account) || 0;

  // Validates items in order against projected balances (a scratch copy of the touched accounts).
  // Player accounts are checked at every step, so order inside a batch matters (seat -> pot before pot -> seat).
  function validate(items) {
    const scratch = { chips: new Map(), play: new Map() };
    const cur = (c, a) => (scratch[c].has(a) ? scratch[c].get(a) : get(c, a));
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

  function commitMemory(scratch) {
    for (const c of CURS) for (const [a, v] of scratch[c]) { if (v === 0) bal[c].delete(a); else bal[c].set(a, v); }
  }

  // Applies one stored line or throws MoneyError('quarantine', { why }) with nothing changed. ids must only increase
  // (a gap is allowed: a lost line then only costs the lines that depend on it, not every line after it).
  function replayLine(rec) {
    const no = (why) => new MoneyError('quarantine', { why });
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) throw no('not a record');
    if (!Number.isSafeInteger(rec.id) || rec.id <= lastId) throw no(`id ${JSON.stringify(rec.id)} is not after ${lastId}`);
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
      if (refs.has(rec.ref)) throw no('duplicate ref ' + rec.ref);
      scratch = validate(items);
    } catch (e) {
      if (e instanceof MoneyError && e.code === 'quarantine') throw e;
      const d = e.details || {};
      throw no(e.code === 'insufficient' ? `insufficient: ${d.account} has ${d.have}, needs ${d.need}` : (e.code || e.message));
    }
    commitMemory(scratch);
    refs.set(rec.ref, { id: rec.id, sig });
    lines.push(rec);
    lastId = rec.id;
  }

  function releaseLock() { if (readLock() === token) { try { fs.unlinkSync(lockFile); } catch {} } }

  // ---- load + replay ----
  // A line that does not parse or does not validate is NOT applied: it is recorded in <file>.quarantine (once) and
  // reported, and the ledger opens on the valid lines. The file itself is never rewritten here. Only the torn tail
  // (no trailing newline) is truncated, as before.
  const quarantineFile = file + '.quarantine';
  const quarantined = [];               // [{ line, lineNo, reason }] for this open
  let raw = Buffer.alloc(0);
  try { raw = fs.readFileSync(file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  let good = 0;                         // byte length of the complete lines
  try {
    let lineNo = 0;
    for (let pos = 0; ;) {
      const nl = raw.indexOf(10, pos);
      if (nl < 0) break;
      lineNo++;
      const ln = raw.toString('utf8', pos, nl);
      pos = nl + 1; good = pos;
      if (ln.trim() === '') continue;
      try {
        let rec;
        try { rec = JSON.parse(ln); } catch { throw new MoneyError('quarantine', { why: 'unparseable' }); }
        replayLine(rec);
      } catch (e) { quarantined.push({ line: ln, lineNo, reason: e.details && e.details.why ? e.details.why : e.message }); }
    }
    if (good < raw.length) fs.truncateSync(file, good);
  } catch (e) { releaseLock(); throw e; }
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
  let closed = false;

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
    size += buf.length;
  }

  function refCheck(ref, sig) {
    if (typeof ref !== 'string' || !ref) throw new MoneyError('bad_ref', { ref });
    const prev = refs.get(ref);
    if (!prev) return null;
    if (prev.sig !== sig) throw new MoneyError('ref_conflict', { ref, id: prev.id });
    return { id: prev.id, dup: true };
  }

  function write(rec, items, sig, doSync, scratch) {
    append(rec, doSync);
    commitMemory(scratch);
    refs.set(rec.ref, { id: rec.id, sig });
    lines.push(rec);
    lastId = rec.id;
    return { id: rec.id, dup: false };
  }

  function transfer(from, to, amount, cur, reason, ref) {
    const item = normItem({ from, to, amount, cur, reason });
    const sig = sigOf(item);
    const dup = refCheck(ref, sig);
    if (dup) return dup;
    const scratch = validate([item]);
    const rec = { id: lastId + 1, ts: now(), ...item, ref };
    return write(rec, [item], sig, fsyncMode === 'all', scratch);
  }

  function batch(items, ref, reason) {
    if (!Array.isArray(items) || items.length === 0) throw new MoneyError('empty_batch');
    const norm = items.map(it => normItem(it, reason));
    const sig = JSON.stringify(['batch', reason || null, norm.map(sigOf)]);
    const dup = refCheck(ref, sig);
    if (dup) return dup;
    const scratch = validate(norm);
    const rec = { id: lastId + 1, ts: now(), batch: norm, ref };
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
    for (const [account, balance] of bal[cur]) if (balance !== 0 && account.startsWith(prefix)) out.push({ account, balance });
    out.sort((a, b) => (a.account < b.account ? -1 : a.account > b.account ? 1 : 0));
    return out;
  }

  const has = (ref) => refs.has(ref);

  // afterId (optional, extra to the contract): only lines with id > afterId.
  function* entries(filterFn, afterId = 0) {
    let lo = 0, hi = lines.length;      // first line with id > afterId (ids increase but may have gaps)
    while (lo < hi) { const mid = (lo + hi) >> 1; if (lines[mid].id <= afterId) lo = mid + 1; else hi = mid; }
    for (let i = lo; i < lines.length; i++) {
      const rec = lines[i];
      if (Array.isArray(rec.batch)) {
        for (const it of rec.batch) {
          const e = { id: rec.id, ts: rec.ts, from: it.from, to: it.to, amount: it.amount, cur: it.cur, reason: it.reason, ref: rec.ref, batchRef: rec.ref };
          if (!filterFn || filterFn(e)) yield e;
        }
      } else {
        const e = { id: rec.id, ts: rec.ts, from: rec.from, to: rec.to, amount: rec.amount, cur: rec.cur, reason: rec.reason, ref: rec.ref, batchRef: null };
        if (!filterFn || filterFn(e)) yield e;
      }
    }
  }

  function check() {
    const out = {};
    for (const c of CURS) {
      let players = 0, sources = 0;
      for (const [a, v] of bal[c]) { if (classify(a).player) players += v; else sources += v; }
      out[c] = { players, sources, ok: players + sources === 0 };
    }
    out.quarantined = quarantined.length;   // lines left out at open; separate from ok (the books balance without them)
    return out;
  }

  function sync() { if (!closed) fs.fsyncSync(fd); }
  function close() { if (!closed) { closed = true; try { fs.closeSync(fd); } catch {} releaseLock(); } }

  return { transfer, batch, balance, list, has, entries, check, sync, close, file, quarantined, quarantineFile, get size() { return size; }, get lastId() { return lastId; } };
}

module.exports = { open, MoneyError, SOURCE_ACCOUNTS, CURS };
