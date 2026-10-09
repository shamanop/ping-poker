'use strict';
// Accounts: username + PIN (scrypt), sessions, rate limits, legacy migration. Persisted to ACCOUNTS_FILE.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KDF = { alg: 'scrypt', N: 16384, r: 8, p: 1, len: 32 };
const SESSION_TTL = 90 * 24 * 3600 * 1000;
const MAX_SESSIONS = 5;
const NAME_RE = /^[A-Za-z0-9 _.\-']+$/;
const PIN_RE = /^\d{4,6}$/;
const AVATAR_RE = /^a(0[1-9]|1[0-2])$/;
const BOT_NAME_RE = /^(bot|demo|test)/i;
const PIC_MAX = 40 * 1024;
const PIC_RE = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+\/]+={0,2})$/;
const RENAME_GAP_MS = 30000;

// Data URL -> clean string or null. Raster only (no SVG/GIF), <=40KB, magic bytes must match the declared type.
function validAvatarPic(pic) {
  if (typeof pic !== 'string' || pic.length > PIC_MAX) return null;
  const m = PIC_RE.exec(pic);
  if (!m) return null;
  let b;
  try { b = Buffer.from(m[2], 'base64'); } catch { return null; }
  if (b.length < 16) return null;
  const ok = m[1] === 'jpeg' ? (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    : m[1] === 'png' ? b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    : (b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP');
  return ok ? pic : null;
}

const cleanName = n => String(n == null ? '' : n).trim().replace(/\s+/g, ' ');
const keyOf = n => cleanName(n).toLowerCase();
// R2B-1: a client-chosen name must never reach an inherited key. Every Object.prototype member name (any case) plus `prototype` is refused as a name,
// and the account map is a null-prototype map read with own keys only.
const RESERVED_NAMES = new Set(['prototype', ...Object.getOwnPropertyNames(Object.prototype)].map(n => n.toLowerCase()));
const isReservedName = n => RESERVED_NAMES.has(String(n == null ? '' : n).trim().toLowerCase());
const hasOwn = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
const ownMap = (src, skip) => { const m = Object.create(null); if (src && typeof src === 'object') for (const k of Object.keys(src)) if (!(skip && isReservedName(k))) m[k] = src[k]; return m; };
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const emptyStats = () => ({ hands: 0, handsWon: 0, netCents: 0, netChips: 0, biggestPot: 0, nights: 0, bestNightCents: 0 });

function scrypt(pin, saltHex) {
  return crypto.scryptSync(String(pin), Buffer.from(saltHex, 'hex'), KDF.len, { N: KDF.N, r: KDF.r, p: KDF.p });
}

function createAccounts({ file, roomPassword = 'ping' }) {
  let skew = Number(process.env.AUTH_CLOCK_SKEW) || 0;
  const now = () => Date.now() + skew;
  const signupLimit = Number(process.env.AUTH_SIGNUP_LIMIT) || 40;
  // Admin accounts are claimable ONLY with ADMIN_CLAIM_PASSWORD, never with the public room word. Unset, blank, shorter than
  // ADMIN_CLAIM_MIN, or equal to the room word (any case, trimmed) = treated as unset = admin claim refused (fail closed).
  const ADMIN_CLAIM_MIN = 8;
  const rawAdminClaim = process.env.ADMIN_CLAIM_PASSWORD == null ? '' : String(process.env.ADMIN_CLAIM_PASSWORD).trim();
  const adminClaim = rawAdminClaim.length >= ADMIN_CLAIM_MIN && rawAdminClaim.toLowerCase() !== String(roomPassword).trim().toLowerCase() ? rawAdminClaim : null;
  const sameSecret = (a, b) => { const x = sha(a), y = sha(b); return crypto.timingSafeEqual(Buffer.from(x), Buffer.from(y)); };
  const listeners = { auth: [] };

  // R2B-4: the accounts file holds every PIN hash and every claimed flag, and the money ledger holds each key's Cash. A file that exists but does not parse is NEVER read as "no accounts"
  // (the names would come back unclaimed and the public room word would take their Cash). Rules:
  //   - a save is temp file + fsync + the previous good file kept as <file>.bak (hard link) + rename + fsync of the directory;
  //   - main unusable and .bak good: the damaged bytes are kept as <file>.damaged-<UTC stamp>, ONE loud line, the state is restored from .bak;
  //   - main missing and .bak good: restored, loud; main missing and no .bak: a fresh data dir, quiet;
  //   - neither usable: the loader THROWS (the server does not start); the damaged bytes are copied (main is left in place, so the next boot fails the same way until a person restores a file).
  const bakFile = file + '.bak';
  const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('.', '');
  const fsyncPath = p => { const fd = fs.openSync(p, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } };
  const readDb = f => {   // { j } usable, { missing: true }, or { err }
    let txt;
    try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { return e && e.code === 'ENOENT' ? { missing: true } : { err: e }; }
    if (!txt.trim()) return { err: new Error('the file is empty (' + Buffer.byteLength(txt) + ' bytes)') };
    let j; try { j = JSON.parse(txt); } catch (e) { return { err: new Error('not valid JSON: ' + (e && e.message)) }; }
    if (!j || typeof j !== 'object' || Array.isArray(j) || !j.accounts || typeof j.accounts !== 'object' || Array.isArray(j.accounts)) return { err: new Error('valid JSON but not an accounts file') };
    return { j };
  };
  // keep the bytes of an unusable file under a dated name; rename = true moves it (main is about to be rewritten), false copies it (main stays). Returns the path or null.
  const keepBytes = (f, rename) => {
    let dst;
    try {
      const sum = sha(fs.readFileSync(f)).slice(0, 8);
      const have = fs.readdirSync(path.dirname(f)).find(n => n.startsWith(path.basename(f) + '.damaged-') && n.endsWith('-' + sum));
      dst = path.join(path.dirname(f), path.basename(f) + '.damaged-' + stamp() + '-' + sum);
      if (have && !rename) return path.join(path.dirname(f), have);
    } catch { return null; }
    try { if (rename) { fs.renameSync(f, dst); try { fsyncPath(path.dirname(f)); } catch {} } else fs.copyFileSync(f, dst, fs.constants.COPYFILE_EXCL); return dst; } catch {}
    if (rename) { try { fs.copyFileSync(f, dst, fs.constants.COPYFILE_EXCL); return dst; } catch {} }
    return null;
  };
  let db = { version: 1, accounts: Object.create(null) };
  let mainGood = false, mustRestore = false;
  {
    const r = readDb(file);
    if (r.j) { db = r.j; mainGood = true; }
    else {
      const b = readDb(bakFile);
      if (r.missing && b.missing) { /* a fresh data dir: a normal quiet start */ }
      else if (b.j) {
        let kept = null;
        if (!r.missing) {
          kept = keepBytes(file, true);
          if (!kept) throw new Error(`accounts: ${file} cannot be used (${r.err.message}) and its bytes could not be kept under another name; the server does NOT start. Fix the data directory and restart.`);
        }
        db = b.j; mustRestore = true;
        console.error(`[SECURITY] accounts: *** ${r.missing ? file + ' is missing' : file + ' cannot be used (' + r.err.message + '), kept as ' + kept}. Restored the accounts from ${bakFile} (the version before the last save: a PIN set or a signup since then is lost). ***`);
      } else {
        const keptMain = r.missing ? null : keepBytes(file, false), keptBak = b.missing ? null : keepBytes(bakFile, false);
        const why = [r.missing ? `${file} is missing` : `${file} cannot be used (${r.err.message})${keptMain ? ', copied to ' + keptMain : ''}`,
          b.missing ? `there is no ${bakFile}` : `${bakFile} cannot be used either (${b.err.message})${keptBak ? ', copied to ' + keptBak : ''}`].join('; ');
        const msg = `accounts: *** ${why}. The server does NOT start (real money: no guessing). Restore a good accounts file (${file}, or ${bakFile} renamed to ${path.basename(file)}) from a backup into ${path.dirname(file)} and start again. ***`;
        console.error('[SECURITY] ' + msg);
        throw new Error(msg);
      }
    }
  }
  // The map is rebuilt as a null-prototype map; a stored account under a reserved key is dropped (loud), never served.
  const dropped = Object.keys(db.accounts).filter(isReservedName);
  if (dropped.length) console.error(`[SECURITY] accounts file holds account(s) under reserved key(s) [${dropped.join(', ')}]: not loaded.`);
  db.accounts = ownMap(db.accounts, true);
  const fileExisted = fs.existsSync(file);
  if (!db.version) db.version = 1;

  let timer = null;
  // temp file + fsync, the previous good file kept as .bak (hard link of the old inode: one write behind, never written again), rename over main, fsync of the directory.
  // A crash at any point leaves a whole old or a whole new file. A refused write keeps the data dirty (the next save / flush tries again).
  function writeNow() {
    const tmp = file + '.tmp';
    try {
      const fd = fs.openSync(tmp, 'w');
      try { fs.writeFileSync(fd, JSON.stringify(db)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      if (mainGood) {
        const bt = bakFile + '.tmp';
        try {
          try { fs.rmSync(bt, { force: true }); } catch {}
          try { fs.linkSync(file, bt); } catch { fs.copyFileSync(file, bt); }
          fs.renameSync(bt, bakFile);
        } catch (e) { try { fs.rmSync(bt, { force: true }); } catch {} console.error('accounts: could not keep the previous version as ' + bakFile + ':', e && e.message); }
      }
      fs.renameSync(tmp, file);
      try { fsyncPath(path.dirname(file)); } catch (e) { console.error('accounts: directory fsync failed:', e && e.message); }
      mainGood = true;
    } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch {} console.error('accounts save failed:', e.message); }
  }
  if (mustRestore) writeNow();
  function save() {
    dispIdx = null;
    if (timer) return;
    timer = setTimeout(() => { timer = null; writeNow(); }, 50);
    if (timer.unref) timer.unref();
  }
  function flush() { if (timer) { clearTimeout(timer); timer = null; } writeNow(); }

  // ── rate limiting ─────────────────────────────────────────────────────────
  const fails = new Map();   // id -> { n, until }
  const signups = new Map(); // ip -> [timestamps]
  const lockedMs = ids => ids.reduce((m, id) => { const f = fails.get(id); return f && f.until > now() ? Math.max(m, f.until - now()) : m; }, 0);
  function recordFail(ids) {
    for (const id of ids) {
      const f = fails.get(id) || { n: 0, until: 0 };
      f.n++;
      if (f.n >= 5) f.until = now() + Math.min(15 * 60000, 30000 * 2 ** (f.n - 5));
      fails.set(id, f);
    }
    if (fails.size > 5000) for (const [id, f] of fails) if (f.until < now() && f.n < 5) fails.delete(id);
  }
  const recordOk = ids => ids.forEach(id => fails.delete(id));
  const idsFor = (ip, key) => [`${ip || '?'}|${key}`, key];
  const err = (code, message, extra) => ({ ok: false, code, message: message || code, ...(extra || {}) });
  const limited = ms => err('rate_limited', 'Too many tries. Wait a moment.', { retryMs: ms });

  const DUMMY_SALT = crypto.randomBytes(16).toString('hex');
  const burn = pin => { try { scrypt(PIN_RE.test(String(pin)) ? pin : '0000', DUMMY_SALT); } catch { /* ignore */ } };

  // ── helpers ───────────────────────────────────────────────────────────────
  const get = key => (typeof key === 'string' && !isReservedName(key) && hasOwn(db.accounts, key) ? db.accounts[key] : null);
  const isAdmin = key => { const a = get(key); return !!(a && hasOwn(a, 'isAdmin') && a.isAdmin); };
  const displayOf = key => { const a = get(key); return a ? a.display : key; };
  let dispIdx = null;
  // Lowercased name (an account key or any current display) -> account key. Unknown names pass through unchanged.
  function keyForName(name) {
    const l = String(name == null ? '' : name).trim().toLowerCase();
    if (get(l)) return l;
    if (!dispIdx) { dispIdx = new Map(); for (const a of Object.values(db.accounts)) dispIdx.set(String(a.display).toLowerCase(), a.key); }
    return dispIdx.get(l) || l;
  }
  const picVer = a => (a.avatarPic ? crypto.createHash('sha1').update(a.avatarPic).digest('hex').slice(0, 10) : null);
  const picUrl = a => (a && a.avatarPic ? '/apic/' + encodeURIComponent(a.key) + '/' + picVer(a) : null);
  const lastRename = new Map();
  const publicAccount = a => ({ key: a.key, display: a.display, avatar: a.avatar, pic: picUrl(a), isAdmin: !!a.isAdmin, claimed: !!a.claimed, prefs: a.prefs, stats: a.stats });

  function setPin(a, pin) {
    a.salt = crypto.randomBytes(16).toString('hex');
    a.kdf = { ...KDF };
    a.pinHash = scrypt(pin, a.salt).toString('hex');
    a.claimed = true;
  }
  // Own properties only: an inherited claimed / pinHash / salt never opens an account.
  const ownClaimed = a => hasOwn(a, 'claimed') && a.claimed === true;
  // R2B-4(d): an account the boot re-made for a key whose ledger Cash is above 0 is LOCKED: the public room word does not claim it, signup is refused, only the admin PIN reset opens it.
  // Own property only; admin accounts are exempt (their claim never takes the room word, only ADMIN_CLAIM_PASSWORD).
  const isLocked = a => hasOwn(a, 'locked') && a.locked === true && !(hasOwn(a, 'isAdmin') && a.isAdmin);
  const lockedErr = () => err('account_locked', 'This account is locked. Ask the admin to reset its PIN.');
  function pinOk(a, pin) {
    if (!ownClaimed(a) || !hasOwn(a, 'pinHash') || typeof a.pinHash !== 'string' || !a.pinHash || !hasOwn(a, 'salt') || typeof a.salt !== 'string' || !PIN_RE.test(String(pin))) { burn(pin); return false; }
    const got = scrypt(pin, a.salt);
    const want = Buffer.from(a.pinHash, 'hex');
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  }
  function newSession(a, ua) {
    const token = crypto.randomBytes(32).toString('hex');
    const t = now();
    a.sessions = (a.sessions || []).filter(s => t - s.lastSeen < SESSION_TTL);
    a.sessions.push({ h: sha(token), created: t, lastSeen: t, ua: String(ua || '').slice(0, 60) });
    while (a.sessions.length > MAX_SESSIONS) a.sessions.shift();
    a.lastLoginAt = t;
    return token;
  }
  function blank(key, display) {
    return {
      id: 'a_' + crypto.randomBytes(4).toString('hex'), key, display, avatar: 'a01',
      kdf: null, salt: null, pinHash: null, claimed: false, isAdmin: key === 'chris',
      createdAt: now(), lastLoginAt: 0, prefs: { currency: 'auto', sound: true },
      stats: emptyStats(), sessions: [], legacy: { bankKey: key },
    };
  }
  function validName(name) {
    const n = cleanName(name);
    return n.length >= 2 && n.length <= 16 && NAME_RE.test(n) && !isReservedName(n) ? n : null;
  }

  // ── flows ─────────────────────────────────────────────────────────────────
  function signup(name, pin, avatar, ctx = {}) {
    const n = validName(name);
    if (!n) return err('bad_name', 'Names are 2-16 letters, numbers, spaces, . _ - \'');
    if (!PIN_RE.test(String(pin))) return err('bad_pin', 'PIN is 4-6 digits');
    const t = now();
    const ip = ctx.ip || '?';
    const recent = (signups.get(ip) || []).filter(x => t - x < 3600000);
    if (recent.length >= signupLimit) { signups.set(ip, recent); return limited(Math.max(1000, 3600000 - (t - recent[0]))); }
    const key = n.toLowerCase();
    const ex = get(key);
    if (!ex && keyForName(key) !== key) return err('name_taken', 'That name is taken');
    if (ex) return ownClaimed(ex) ? err('name_taken', 'That name is taken') : isLocked(ex) ? lockedErr() : err('claim_required', 'This name belongs to an existing player. Claim it with the table password.');
    recent.push(t); signups.set(ip, recent);
    const a = blank(key, n);
    if (AVATAR_RE.test(String(avatar))) a.avatar = avatar;
    setPin(a, pin);
    db.accounts[key] = a;
    const token = newSession(a, ctx.ua);
    save();
    return { ok: true, account: a, token };
  }

  function claim(name, pin, avatar, password, ctx = {}) {
    if (isReservedName(name)) return err('bad_name', 'No such player to claim');
    const key = keyForName(keyOf(name));
    const ids = idsFor(ctx.ip, key);
    const ms = lockedMs(ids);
    if (ms) return limited(ms);
    if (!PIN_RE.test(String(pin))) return err('bad_pin', 'PIN is 4-6 digits');
    const a = get(key);
    if (!a) return err('bad_name', 'No such player to claim');
    if (ownClaimed(a)) return err('name_taken', 'That name is taken');
    if (isLocked(a)) return lockedErr();
    const given = String(password == null ? '' : password).trim();
    const fail = (code, message) => { recordFail(ids); const m = lockedMs(ids); return m ? limited(m) : err(code, message); };
    if (isAdmin(key)) {
      // never the room word; with no valid ADMIN_CLAIM_PASSWORD an admin account cannot be claimed at all. Counted by the same limiter.
      if (!adminClaim) { burn(pin); return fail('admin_claim_disabled', 'This account cannot be claimed here. The server operator must set ADMIN_CLAIM_PASSWORD.'); }
      if (!sameSecret(given, adminClaim)) return fail('bad_login', 'Wrong table password');
    } else if (given.toLowerCase() !== String(roomPassword).trim().toLowerCase()) return fail('bad_login', 'Wrong table password');
    recordOk(ids);
    if (AVATAR_RE.test(String(avatar))) a.avatar = avatar;
    setPin(a, pin);
    const token = newSession(a, ctx.ua);
    save();
    return { ok: true, account: a, token };
  }

  function login(name, pin, ctx = {}) {
    if (isReservedName(name)) { burn(pin); return err('bad_login', 'Wrong name or PIN'); }
    const key = keyForName(keyOf(name));
    const ids = idsFor(ctx.ip, key);
    const ms = lockedMs(ids);
    if (ms) return limited(ms);
    const a = get(key);
    let good = false;
    if (a) good = pinOk(a, pin); else burn(pin);
    if (good) { recordOk(ids); const token = newSession(a, ctx.ua); save(); return { ok: true, account: a, token }; }
    if (a && !ownClaimed(a) && isLocked(a)) return lockedErr();
    if (a && !ownClaimed(a)) return err('claim_required', 'This name belongs to an existing player. Claim it with the table password.');
    recordFail(ids);
    const m = lockedMs(ids);
    return m ? limited(m) : err('bad_login', 'Wrong name or PIN');
  }

  function resume(key, token) {
    const a = get(String(key || '').toLowerCase());
    if (!a || typeof token !== 'string') return err('bad_session', 'Session expired');
    const h = sha(token), t = now();
    const s = (a.sessions || []).find(x => x.h === h);
    if (!s || t - s.lastSeen > SESSION_TTL) return err('bad_session', 'Session expired');
    s.lastSeen = t;
    save();
    return { ok: true, account: a, sessionH: h };
  }

  function logout(key, token) {
    const a = get(key);
    if (!a || typeof token !== 'string') return;
    const h = sha(token);
    a.sessions = (a.sessions || []).filter(s => s.h !== h);
    save();
  }
  function logoutHash(key, h) {
    const a = get(key);
    if (!a || !h) return;
    a.sessions = (a.sessions || []).filter(s => s.h !== h);
    save();
  }

  function rename(key, name) {
    const a = get(key);
    if (!a) return err('bad_session', 'Session expired');
    const n = validName(name);
    if (!n) return err('bad_name', 'Names are 2-16 letters, numbers, spaces, . _ - \'');
    if (n === a.display) return { ok: true, account: a, changed: false };
    const l = n.toLowerCase();
    for (const o of Object.values(db.accounts)) {
      if (o.key !== key && (o.key === l || String(o.display).toLowerCase() === l)) return err('name_taken', 'That name is taken');
    }
    const t = now(), last = lastRename.get(key) || 0;
    if (last && t - last < RENAME_GAP_MS) { const ms = RENAME_GAP_MS - (t - last); return err('rate_limited', 'You can change your name again in ' + Math.ceil(ms / 1000) + ' seconds', { retryMs: ms }); }
    lastRename.set(key, t);
    a.display = n;
    save();
    return { ok: true, account: a, changed: true };
  }

  // avatarPic: undefined = leave alone, null/'' = remove, string = set (caller validates first; invalid strings are ignored)
  function setAvatarPic(key, pic) {
    const a = get(key);
    if (!a) return null;
    if (pic === null || pic === '') delete a.avatarPic;
    else { const ok = validAvatarPic(pic); if (!ok) return null; a.avatarPic = ok; }
    save();
    return a;
  }

  function updateProfile(key, { avatar, prefs } = {}) {
    const a = get(key);
    if (!a) return null;
    if (AVATAR_RE.test(String(avatar))) a.avatar = avatar;
    if (prefs && typeof prefs === 'object') {
      if (['auto', 'usd', 'chips'].includes(prefs.currency)) a.prefs.currency = prefs.currency;
      if (typeof prefs.sound === 'boolean') a.prefs.sound = prefs.sound;
      if (prefs.layout && typeof prefs.layout === 'object' && JSON.stringify(prefs.layout).length < 2000) a.prefs.layout = prefs.layout;
    }
    save();
    return a;
  }

  function pinChange(key, oldPin, newPin, ctx = {}) {
    const a = get(key);
    const ids = idsFor(ctx.ip, key);
    const ms = lockedMs(ids);
    if (ms) return limited(ms);
    if (!a || !pinOk(a, oldPin)) { recordFail(ids); const m = lockedMs(ids); return m ? limited(m) : err('bad_login', 'Wrong PIN'); }
    if (!PIN_RE.test(String(newPin))) return err('bad_pin', 'PIN is 4-6 digits');
    recordOk(ids);
    setPin(a, newPin);
    // K6b-1: every stored session goes, the changing socket gets a fresh one (the caller signs the account's OTHER sockets out)
    a.sessions = [];
    const token = newSession(a, ctx.ua);
    save();
    return { ok: true, account: a, token };
  }

  function resetPin(adminKey, key, newPin) {
    if (!isAdmin(adminKey)) return err('auth', 'Admin only');
    if (isReservedName(key)) return err('bad_name', 'No such account');
    const a = get(String(key || '').toLowerCase());
    if (!a) return err('bad_name', 'No such account');
    if (!PIN_RE.test(String(newPin))) return err('bad_pin', 'PIN is 4-6 digits');
    setPin(a, newPin);
    delete a.locked;
    a.sessions = [];
    fails.delete(a.key);
    save();
    return { ok: true };
  }

  // ── stats ─────────────────────────────────────────────────────────────────
  function recordHand(key, { won, pot } = {}) {
    const a = get(key);
    if (!a) return;
    a.stats.hands++;
    if (won) a.stats.handsWon++;
    if (Number.isFinite(pot) && pot > a.stats.biggestPot) a.stats.biggestPot = pot;
    save();
  }
  function social(key, mutate) {
    const a = get(key);
    if (!a) return null;
    if (!a.social || typeof a.social !== 'object') a.social = {};
    if (mutate) { mutate(a.social); save(); }
    return a.social;
  }
  function recordNight(key, { mode, net } = {}) {
    const a = get(key);
    if (!a || !Number.isSafeInteger(net)) return;
    a.stats.nights++;
    if (mode === 'chips') a.stats.netChips += net;
    else { a.stats.netCents += net; if (net > a.stats.bestNightCents) a.stats.bestNightCents = net; }
    save();
    emit('night', key, { mode, net });
  }
  function rebuildStats(entries) {
    const net = Object.create(null);
    for (const e of entries) {
      if (!e.name || !['buyin', 'rebuy', 'cashout'].includes(e.type)) continue;
      const k = (e.key || String(e.name).toLowerCase().trim());
      const m = e.mode === 'cents' ? 'cents' : 'chips';
      const n = (net[k] ||= { cents: 0, chips: 0 });
      n[m] += e.type === 'cashout' ? e.amount : -e.amount;
    }
    for (const a of Object.values(db.accounts)) {
      const n = net[a.key];   // net is a null-prototype map
      if (n) { a.stats.netCents = n.cents; a.stats.netChips = n.chips; }
    }
    save();
  }

  // One loud line at boot when an admin account is unclaimed and nobody can claim it (so the operator sees why the admin cannot sign in).
  function warnAdminClaim() {
    if (adminClaim) return false;
    const open = Object.values(db.accounts).filter(a => a.isAdmin && !a.claimed).map(a => a.key);
    if (!open.length) return false;
    const why = process.env.ADMIN_CLAIM_PASSWORD ? `the value set is ignored (it must be at least ${ADMIN_CLAIM_MIN} characters and not the room word)` : 'it is not set';
    console.error(`[SECURITY] Admin account(s) [${open.join(', ')}] are UNCLAIMED and ADMIN_CLAIM_PASSWORD ${why}: admin claim is DISABLED (fail closed). Set ADMIN_CLAIM_PASSWORD (>= ${ADMIN_CLAIM_MIN} chars, not the room word) and restart to claim the admin account.`);
    return true;
  }

  // ── legacy migration (idempotent) ─────────────────────────────────────────
  function migrateLegacy({ bank = {}, ledgerEntries = [], cash = {} } = {}) {
    const groups = new Map(); // key -> { display, t, raw[] }
    const seen = (raw) => { const k = raw.trim().toLowerCase(); if (!k || BOT_NAME_RE.test(k) || isReservedName(k)) return null; if (!groups.has(k)) groups.set(k, { display: null, t: Infinity, raw: new Set() }); groups.get(k).raw.add(raw); return groups.get(k); };
    const bankRaw = Object.create(null);
    for (const raw of Object.keys(bank)) { const g = seen(String(raw)); if (g) bankRaw[raw.trim().toLowerCase()] = (bankRaw[raw.trim().toLowerCase()] || 0) + 1; }
    for (const e of ledgerEntries) {
      if (!e || typeof e.name !== 'string') continue;
      const g = seen(e.name);
      if (g && e.type !== 'bank-start' && (e.t || 0) < g.t) { g.t = e.t || 0; g.display = e.name.trim(); }
    }
    // R2B-4(d): keys whose ledger wallet (play:<key>) holds Cash are known even when no old store names them
    const cashKeys = Object.keys(cash || {}).filter(k => Number(cash[k]) > 0);
    for (const k of cashKeys) seen(String(k));
    const cashOf = k => (hasOwn(cash, k) ? Number(cash[k]) : 0);
    let created = 0, merged = 0, locked = 0;
    for (const [k, g] of groups) {
      merged += Math.max(0, (bankRaw[k] || 0) - 1);
      if (get(k)) continue;
      let display = cleanName(g.display || (k.charAt(0).toUpperCase() + k.slice(1))).replace(/[^A-Za-z0-9 _.\-']/g, '').slice(0, 16).trim();
      if (display.length < 2) continue;
      db.accounts[k] = { ...blank(k, display), key: k };
      if (cashOf(k) > 0 && !db.accounts[k].isAdmin) { db.accounts[k].locked = true; locked++; }
      created++;
    }
    if (!get('chris')) { db.accounts.chris = blank('chris', 'Chris'); created++; }
    if (created) { flush(); console.log(`migrated ${created} accounts, merged ${merged} duplicates`); }
    if (locked) console.error(`[SECURITY] accounts: ${locked} account(s) were re-made UNCLAIMED for keys that hold Cash and are LOCKED (the room word does not claim them): the admin must reset each PIN (Admin > Players > reset PIN). Was accounts.json lost or damaged?`);
    warnAdminClaim();
    return { created, merged };
  }

  const on = (ev, fn) => { (listeners[ev] ||= []).push(fn); };
  const emit = (ev, ...a) => { for (const fn of listeners[ev] || []) { try { fn(...a); } catch (e) { console.error('accounts listener', e); } } };

  return {
    signup, claim, login, resume, logout, logoutHash, get, isAdmin, displayOf, publicAccount, updateProfile, rename, setAvatarPic, keyForName, picUrl, validAvatarPic,
    pinChange, resetPin, recordHand, recordNight, social, rebuildStats, migrateLegacy, flush, on, emit,
    setSkew: ms => { skew = Number(ms) || 0; }, keyOf, cleanName, fileExisted, all: () => db.accounts,
  };
}

module.exports = { createAccounts, keyOf, cleanName };
