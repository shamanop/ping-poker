'use strict';
// Accounts: username + PIN (scrypt), sessions, rate limits, legacy migration. Persisted to ACCOUNTS_FILE.
const fs = require('fs');
const crypto = require('crypto');

const KDF = { alg: 'scrypt', N: 16384, r: 8, p: 1, len: 32 };
const SESSION_TTL = 90 * 24 * 3600 * 1000;
const MAX_SESSIONS = 5;
const NAME_RE = /^[A-Za-z0-9 _.\-']+$/;
const PIN_RE = /^\d{4,6}$/;
const AVATAR_RE = /^a(0[1-9]|1[0-2])$/;
const BOT_NAME_RE = /^(bot|demo|test)/i;

const cleanName = n => String(n == null ? '' : n).trim().replace(/\s+/g, ' ');
const keyOf = n => cleanName(n).toLowerCase();
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const emptyStats = () => ({ hands: 0, handsWon: 0, netCents: 0, netChips: 0, biggestPot: 0, nights: 0, bestNightCents: 0 });

function scrypt(pin, saltHex) {
  return crypto.scryptSync(String(pin), Buffer.from(saltHex, 'hex'), KDF.len, { N: KDF.N, r: KDF.r, p: KDF.p });
}

function createAccounts({ file, roomPassword = 'ping' }) {
  let skew = Number(process.env.AUTH_CLOCK_SKEW) || 0;
  const now = () => Date.now() + skew;
  const signupLimit = Number(process.env.AUTH_SIGNUP_LIMIT) || 5;
  const adminClaim = process.env.ADMIN_CLAIM_PASSWORD || null;
  const listeners = { auth: [] };

  let db = { version: 1, accounts: {} };
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j && typeof j === 'object' && j.accounts) db = j;
  } catch { /* fresh */ }
  const fileExisted = fs.existsSync(file);
  if (!db.version) db.version = 1;

  let timer = null;
  function writeNow() {
    try {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, file);
    } catch (e) { console.error('accounts save failed:', e.message); }
  }
  function save() {
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
  const get = key => db.accounts[key] || null;
  const isAdmin = key => !!(key && db.accounts[key] && db.accounts[key].isAdmin);
  const displayOf = key => (db.accounts[key] ? db.accounts[key].display : key);
  const publicAccount = a => ({ key: a.key, display: a.display, avatar: a.avatar, isAdmin: !!a.isAdmin, claimed: !!a.claimed, prefs: a.prefs, stats: a.stats });

  function setPin(a, pin) {
    a.salt = crypto.randomBytes(16).toString('hex');
    a.kdf = { ...KDF };
    a.pinHash = scrypt(pin, a.salt).toString('hex');
    a.claimed = true;
  }
  function pinOk(a, pin) {
    if (!a.claimed || !a.pinHash || !PIN_RE.test(String(pin))) { burn(pin); return false; }
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
    return n.length >= 2 && n.length <= 16 && NAME_RE.test(n) ? n : null;
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
    recent.push(t); signups.set(ip, recent);
    const key = n.toLowerCase();
    const ex = db.accounts[key];
    if (ex) return ex.claimed ? err('name_taken', 'That name is taken') : err('claim_required', 'This name belongs to an existing player. Claim it with the table password.');
    const a = blank(key, n);
    if (AVATAR_RE.test(String(avatar))) a.avatar = avatar;
    setPin(a, pin);
    db.accounts[key] = a;
    const token = newSession(a, ctx.ua);
    save();
    return { ok: true, account: a, token };
  }

  function claim(name, pin, avatar, password, ctx = {}) {
    const key = keyOf(name);
    const ids = idsFor(ctx.ip, key);
    const ms = lockedMs(ids);
    if (ms) return limited(ms);
    if (!PIN_RE.test(String(pin))) return err('bad_pin', 'PIN is 4-6 digits');
    const a = db.accounts[key];
    if (!a) return err('bad_name', 'No such player to claim');
    if (a.claimed) return err('name_taken', 'That name is taken');
    const need = (a.isAdmin && adminClaim) ? adminClaim : roomPassword;
    if (String(password) !== need) { recordFail(ids); const m = lockedMs(ids); return m ? limited(m) : err('bad_login', 'Wrong table password'); }
    recordOk(ids);
    if (AVATAR_RE.test(String(avatar))) a.avatar = avatar;
    setPin(a, pin);
    const token = newSession(a, ctx.ua);
    save();
    return { ok: true, account: a, token };
  }

  function login(name, pin, ctx = {}) {
    const key = keyOf(name);
    const ids = idsFor(ctx.ip, key);
    const ms = lockedMs(ids);
    if (ms) return limited(ms);
    const a = db.accounts[key];
    let good = false;
    if (a) good = pinOk(a, pin); else burn(pin);
    if (good) { recordOk(ids); const token = newSession(a, ctx.ua); save(); return { ok: true, account: a, token }; }
    if (a && !a.claimed) return err('claim_required', 'This name belongs to an existing player. Claim it with the table password.');
    recordFail(ids);
    const m = lockedMs(ids);
    return m ? limited(m) : err('bad_login', 'Wrong name or PIN');
  }

  function resume(key, token) {
    const a = db.accounts[String(key || '').toLowerCase()];
    if (!a || typeof token !== 'string') return err('bad_session', 'Session expired');
    const h = sha(token), t = now();
    const s = (a.sessions || []).find(x => x.h === h);
    if (!s || t - s.lastSeen > SESSION_TTL) return err('bad_session', 'Session expired');
    s.lastSeen = t;
    save();
    return { ok: true, account: a, sessionH: h };
  }

  function logout(key, token) {
    const a = db.accounts[key];
    if (!a || typeof token !== 'string') return;
    const h = sha(token);
    a.sessions = (a.sessions || []).filter(s => s.h !== h);
    save();
  }
  function logoutHash(key, h) {
    const a = db.accounts[key];
    if (!a || !h) return;
    a.sessions = (a.sessions || []).filter(s => s.h !== h);
    save();
  }

  function updateProfile(key, { avatar, prefs } = {}) {
    const a = db.accounts[key];
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
    const a = db.accounts[key];
    const ids = idsFor(ctx.ip, key);
    const ms = lockedMs(ids);
    if (ms) return limited(ms);
    if (!a || !pinOk(a, oldPin)) { recordFail(ids); const m = lockedMs(ids); return m ? limited(m) : err('bad_login', 'Wrong PIN'); }
    if (!PIN_RE.test(String(newPin))) return err('bad_pin', 'PIN is 4-6 digits');
    recordOk(ids);
    setPin(a, newPin);
    a.sessions = (a.sessions || []).filter(s => s.h === ctx.sessionH);
    save();
    return { ok: true };
  }

  function resetPin(adminKey, key, newPin) {
    if (!isAdmin(adminKey)) return err('auth', 'Admin only');
    const a = db.accounts[String(key || '').toLowerCase()];
    if (!a) return err('bad_name', 'No such account');
    if (!PIN_RE.test(String(newPin))) return err('bad_pin', 'PIN is 4-6 digits');
    setPin(a, newPin);
    a.sessions = [];
    fails.delete(a.key);
    save();
    return { ok: true };
  }

  // ── stats ─────────────────────────────────────────────────────────────────
  function recordHand(key, { won, pot } = {}) {
    const a = db.accounts[key];
    if (!a) return;
    a.stats.hands++;
    if (won) a.stats.handsWon++;
    if (Number.isFinite(pot) && pot > a.stats.biggestPot) a.stats.biggestPot = pot;
    save();
  }
  function social(key, mutate) {
    const a = db.accounts[key];
    if (!a) return null;
    if (!a.social || typeof a.social !== 'object') a.social = {};
    if (mutate) { mutate(a.social); save(); }
    return a.social;
  }
  function recordNight(key, { mode, net } = {}) {
    const a = db.accounts[key];
    if (!a || !Number.isSafeInteger(net)) return;
    a.stats.nights++;
    if (mode === 'chips') a.stats.netChips += net;
    else { a.stats.netCents += net; if (net > a.stats.bestNightCents) a.stats.bestNightCents = net; }
    save();
  }
  function rebuildStats(entries) {
    const net = {};
    for (const e of entries) {
      if (!e.name || !['buyin', 'rebuy', 'cashout'].includes(e.type)) continue;
      const k = (e.key || String(e.name).toLowerCase().trim());
      const m = e.mode === 'cents' ? 'cents' : 'chips';
      const n = (net[k] ||= { cents: 0, chips: 0 });
      n[m] += e.type === 'cashout' ? e.amount : -e.amount;
    }
    for (const a of Object.values(db.accounts)) {
      const n = net[a.key];
      if (n) { a.stats.netCents = n.cents; a.stats.netChips = n.chips; }
    }
    save();
  }

  // ── legacy migration (idempotent) ─────────────────────────────────────────
  function migrateLegacy({ bank = {}, ledgerEntries = [] } = {}) {
    const groups = new Map(); // key -> { display, t, raw[] }
    const seen = (raw) => { const k = raw.trim().toLowerCase(); if (!k || BOT_NAME_RE.test(k)) return null; if (!groups.has(k)) groups.set(k, { display: null, t: Infinity, raw: new Set() }); groups.get(k).raw.add(raw); return groups.get(k); };
    const bankRaw = {};
    for (const raw of Object.keys(bank)) { const g = seen(String(raw)); if (g) bankRaw[raw.trim().toLowerCase()] = (bankRaw[raw.trim().toLowerCase()] || 0) + 1; }
    for (const e of ledgerEntries) {
      if (!e || typeof e.name !== 'string') continue;
      const g = seen(e.name);
      if (g && e.type !== 'bank-start' && (e.t || 0) < g.t) { g.t = e.t || 0; g.display = e.name.trim(); }
    }
    let created = 0, merged = 0;
    for (const [k, g] of groups) {
      merged += Math.max(0, (bankRaw[k] || 0) - 1);
      if (db.accounts[k]) continue;
      let display = cleanName(g.display || (k.charAt(0).toUpperCase() + k.slice(1))).replace(/[^A-Za-z0-9 _.\-']/g, '').slice(0, 16).trim();
      if (display.length < 2) continue;
      db.accounts[k] = { ...blank(k, display), key: k };
      created++;
    }
    if (!db.accounts.chris) { db.accounts.chris = blank('chris', 'Chris'); created++; }
    if (created) { flush(); console.log(`migrated ${created} accounts, merged ${merged} duplicates`); }
    return { created, merged };
  }

  const on = (ev, fn) => { (listeners[ev] ||= []).push(fn); };
  const emit = (ev, ...a) => { for (const fn of listeners[ev] || []) { try { fn(...a); } catch (e) { console.error('accounts listener', e); } } };

  return {
    signup, claim, login, resume, logout, logoutHash, get, isAdmin, displayOf, publicAccount, updateProfile,
    pinChange, resetPin, recordHand, recordNight, social, rebuildStats, migrateLegacy, flush, on, emit,
    setSkew: ms => { skew = Number(ms) || 0; }, keyOf, cleanName, fileExisted, all: () => db.accounts,
  };
}

module.exports = { createAccounts, keyOf, cleanName };
