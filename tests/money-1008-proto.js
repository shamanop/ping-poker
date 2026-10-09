// Money 1008 R2B-1: no client-chosen name may reach an inherited key of the account map.
// Exit 1 while the fault exists (an unauthenticated auth_claim {name:"__proto__"} writes PIN fields onto Object.prototype of the server), exit 0 when fixed.
// Part A: accounts.js directly. Part B: a booted server.js (one port, PROTO_PORT or 4890). Plain node script like tests/money-1008-adminclaim.js.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
const { createAccounts } = require(path.join(ROOT, 'accounts.js'));
const { io } = require(path.join(ROOT, 'node_modules', 'socket.io-client'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = Number(process.env.PROTO_PORT) || 4890;
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const RESERVED = ['__proto__', 'constructor', 'prototype', 'hasOwnProperty', 'toString', 'valueOf', '__Proto__', 'CONSTRUCTOR', 'isPrototypeOf', 'toLocaleString', '__defineGetter__'];
const POLLUTION = ['salt', 'kdf', 'pinHash', 'claimed', 'sessions', 'lastLoginAt', 'avatar'];
const dirty = () => POLLUTION.filter(k => k in Object.prototype);
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ppproto-'));
const rec = (k, extra) => ({ id: 'a_' + k, key: k, display: k, avatar: 'a01', isAdmin: false, createdAt: 1, lastLoginAt: 0, prefs: { currency: 'auto', sound: true }, stats: { hands: 0, handsWon: 0, netCents: 0, netChips: 0, biggestPot: 0, nights: 0, bestNightCents: 0 }, sessions: [], legacy: { bankKey: k }, ...extra });
const CTX = { ip: '9.9.9.9', ua: 't' };

// ── A. accounts.js ───────────────────────────────────────────────────────────────────────────────
function partA() {
  const file = path.join(TMP, 'a.json');
  // alice: unclaimed, full record. legacyadmin: an admin record with NO own pin fields (an old-format file).
  fs.writeFileSync(file, JSON.stringify({ version: 1, accounts: { alice: rec('alice', { kdf: null, salt: null, pinHash: null, claimed: false }), legacyadmin: rec('legacyadmin', { isAdmin: true }) } }));
  const acc = createAccounts({ file });
  acc.migrateLegacy({ bank: {}, ledgerEntries: [] });
  const mk = createAccounts({ file: path.join(TMP, 'b.json') });
  const n0 = Object.keys(acc.all()).length;
  for (const name of RESERVED) {
    const c = acc.claim(name, '1234', 'a01', 'ping', CTX);
    ok(!c.ok && dirty().length === 0, `A claim ${name}: refused (${c.code}), Object.prototype clean`);
    const s = acc.signup(name, '1234', 'a01', CTX);
    ok(!s.ok && s.code === 'bad_name' && dirty().length === 0, `A signup ${name}: refused (${s.code})`);
    const l = acc.login(name, '1234', CTX);
    ok(!l.ok && dirty().length === 0, `A login ${name}: refused (${l.code})`);
    ok(acc.get(name.toLowerCase()) === null && acc.get(name) === null, `A get ${name}: no account (own lookup only)`);
    ok(acc.resume(name, 'x'.repeat(64)).ok === false, `A resume ${name}: refused`);
    const adm = acc.signup('Adm' + RESERVED.indexOf(name), '1234', 'a01', CTX);   // a normal player cannot reset anything; admin path below
    ok(adm.ok, `A control signup for ${name} round`);
  }
  ok(Object.keys(acc.all()).length === n0 + RESERVED.length, 'A: no account was created for a reserved name');
  // reset PIN as an admin: needs an admin session in the account map. legacyadmin is isAdmin; its own pin fields are absent, so it is "unclaimed" and cannot log in.
  for (const name of RESERVED) {
    const r = acc.resetPin('legacyadmin', name, '5555');
    ok(!r.ok && dirty().length === 0, `A resetPin ${name}: refused (${r.code})`);
  }
  // rename to a reserved name
  const p = acc.signup('Renamer', '1234', 'a01', CTX);
  for (const name of RESERVED) { const r = acc.rename('renamer', name); ok(!r.ok && r.code === 'bad_name', `A rename to ${name}: refused`); }
  // pin reads are own-property only: an inherited pin never opens an account
  Object.prototype.__probe = 1; delete Object.prototype.__probe;
  ok(acc.login('legacyadmin', '1234', CTX).ok === false, 'A: a record with no own pin fields cannot be logged in with any PIN');
  ok(acc.login('alice', '1234', CTX).code === 'claim_required', 'A: unclaimed alice stays unclaimed (claim_required)');
  // the proof case, then the world after it
  acc.claim('__proto__', '1234', 'a01', 'ping', CTX);
  ok(acc.login('legacyadmin', '1234', CTX).ok === false && acc.login('alice', '1234', CTX).ok === false && acc.login('chris', '1234', CTX).ok === false, 'A: after the proof case no account takes the attacker PIN');
  ok(acc.signup('salt', '1234', 'a01', { ip: '8.8.8.8' }).ok, 'A: "salt" is still a usable name after the proof case');
  // the file on disk holding an own "__proto__" key is dropped on load, never served
  fs.writeFileSync(path.join(TMP, 'c.json'), '{"version":1,"accounts":{"__proto__":' + JSON.stringify(rec('__proto__', { claimed: true })) + ',"bob":' + JSON.stringify(rec('bob', { claimed: false })) + '}}');
  const c = createAccounts({ file: path.join(TMP, 'c.json') });
  ok(c.get('__proto__') === null && c.get('bob') !== null, 'A: a stored "__proto__" account is not loaded');
  // legacy names from bank / ledger never become accounts under a reserved key
  const m = createAccounts({ file: path.join(TMP, 'd.json') });
  m.migrateLegacy({ bank: { constructor: 5, '__proto__': 1, Zed: 2 }, ledgerEntries: [{ name: 'toString', type: 'buyin', amount: 5, mode: 'chips' }, { name: 'valueOf', type: 'cashout', amount: 5, mode: 'cents' }] });
  ok(Object.keys(m.all()).sort().join() === 'chris,zed', `A: migrateLegacy skips reserved names (${Object.keys(m.all()).sort().join()})`);
  m.rebuildStats([{ name: 'constructor', type: 'buyin', amount: 5, mode: 'chips' }]);
  ok(dirty().length === 0 && m.get('zed').stats.netChips === 0, 'A: rebuildStats with a reserved name changes nothing');
}

// ── B. the server ───────────────────────────────────────────────────────────────────────────────
async function boot(port) {
  const dir = path.join(TMP, 'srv'); fs.mkdirSync(dir, { recursive: true });
  const f = n => path.join(dir, n);
  fs.writeFileSync(f('b.json'), '{}'); fs.writeFileSync(f('l.json'), '[]');
  fs.writeFileSync(f('a.json'), JSON.stringify({ version: 1, accounts: { legacyadmin: rec('legacyadmin', { isAdmin: true }) } }));
  const e = { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), DATA_DIR: dir, BANK_FILE: f('b.json'), LEDGER_FILE: f('l.json'), ACCOUNTS_FILE: f('a.json'),
    TABLES_FILE: f('t.json'), WALLET_FILE: f('w.json'), STACKS_FILE: f('s.json'), BIGWINS_FILE: f('bw.json'), BENDER_CFG_FILE: f('bc.json'), MONEY_FILE: f('money.jsonl'),
    CAMPAIGN_FILE: f('c.json'), AUTO_START_MS: '600000', AUTH_SIGNUP_LIMIT: '100000', SIGNUP_PLAY_CENTS: '0', ADMIN_CLAIM_PASSWORD: 'test-admin-claim-1008' };
  const proc = spawn('node', ['server.js'], { cwd: ROOT, env: e, stdio: ['ignore', fs.openSync(f('server.log'), 'a'), fs.openSync(f('server.log'), 'a')] });
  process.on('exit', () => { try { proc.kill('SIGKILL'); } catch {} });
  for (let i = 0; i < 200; i++) { try { await fetch(`http://127.0.0.1:${port}/`); break; } catch { await sleep(50); } }
  await sleep(100);
  return { proc, log: () => fs.readFileSync(f('server.log'), 'utf8'), accounts: () => JSON.parse(fs.readFileSync(f('a.json'), 'utf8')).accounts,
    async stop() { proc.kill('SIGKILL'); await new Promise(r => { proc.once('exit', r); setTimeout(r, 2000); }); } };
}
function client(port) {
  const s = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true, reconnection: false });
  const got = [];
  s.onAny((ev, p) => got.push([ev, p]));
  const c = { s, got, async req(ev, p, ...want) {
    const n = got.length; s.emit(ev, p);
    for (let i = 0; i < 200; i++) { const h = got.slice(n).find(([e]) => want.includes(e)); if (h) return { ev: h[0], p: h[1] }; await sleep(15); }
    return { ev: null, p: null };
  } };
  return new Promise((res, rej) => { s.on('connect', () => res(c)); s.on('connect_error', rej); });
}
const AUTH = ['auth_ok', 'auth_error'];

async function partB() {
  const srv = await boot(PORT);
  try {
    // a probe: account "probe" signs up, and from that session we can ask the server what its prototype looks like only through behaviour
    const a = await client(PORT);
    const r = await a.req('auth_claim', { name: '__proto__', pin: '1234', avatar: 'a05', roomPassword: 'ping' }, ...AUTH);
    ok(r.ev === 'auth_error' && r.p && r.p.code === 'bad_name', 'B claim __proto__ with the room word: auth_error bad_name (' + JSON.stringify(r.p).slice(0, 100) + ')');
    const s1 = await (await client(PORT)).req('auth_signup', { name: 'salt', pin: '1234', avatar: 'a01' }, ...AUTH);
    ok(s1.ev === 'auth_ok', 'B signup "salt" after the proof case: ok (' + s1.ev + ')');
    const k = await (await client(PORT)).req('auth_login', { name: 'kdf', pin: '1234' }, ...AUTH, 'error');
    ok(k.ev === 'auth_error' && k.p.code === 'bad_login', 'B login "kdf" after the proof case: plain bad_login (' + k.ev + ' ' + JSON.stringify(k.p).slice(0, 80) + ')');
    const la = await (await client(PORT)).req('auth_login', { name: 'legacyadmin', pin: '1234' }, ...AUTH, 'error');
    ok(la.ev === 'auth_error', 'B login legacyadmin (no own pin fields) with the attacker PIN: refused (' + la.ev + ')');
    const ch = await (await client(PORT)).req('auth_login', { name: 'chris', pin: '1234' }, ...AUTH, 'error');
    ok(ch.ev === 'auth_error', 'B login chris with the attacker PIN: refused (' + ch.ev + ')');
    for (const name of RESERVED.filter(n => n !== '__proto__')) {
      const c = await client(PORT);
      const x = await c.req('auth_claim', { name, pin: '1234', roomPassword: 'ping' }, ...AUTH, 'error');
      const y = await c.req('auth_signup', { name, pin: '1234' }, ...AUTH, 'error');
      const z = await c.req('auth_login', { name, pin: '1234' }, ...AUTH, 'error');
      ok(x.ev === 'auth_error' && y.ev === 'auth_error' && z.ev === 'auth_error', `B ${name}: claim / signup / login all auth_error`);
      c.s.close();
    }
    // PIN reset of a reserved name by a real admin
    const ad = await client(PORT);
    const adm = await ad.req('auth_claim', { name: 'chris', pin: '4321', roomPassword: 'test-admin-claim-1008' }, ...AUTH);
    ok(adm.ev === 'auth_ok', 'B control: admin claim with ADMIN_CLAIM_PASSWORD still works');
    for (const name of ['__proto__', 'constructor', 'hasOwnProperty']) {
      const rr = await ad.req('account_reset_pin', { key: name, newPin: '5555' }, 'ok', 'auth_error', 'error');
      ok(rr.ev === 'auth_error', `B account_reset_pin ${name}: auth_error (${rr.ev})`);
    }
    await sleep(200);
    ok(!/MoneyError|TypeError|bad_key/.test(srv.log()), 'B: no server error in the log (' + (srv.log().match(/MoneyError|TypeError|bad_key/) || ['none'])[0] + ')');
    ok(srv.proc.exitCode === null, 'B: server still alive');
    ok(!('__proto__' in srv.accounts()) || Object.keys(srv.accounts()).indexOf('__proto__') < 0, 'B: accounts.json has no "__proto__" account');
    // control: a normal player works end to end
    const z = await (await client(PORT)).req('auth_signup', { name: 'Zed', pin: '1234', avatar: 'a01' }, ...AUTH);
    ok(z.ev === 'auth_ok', 'B control: normal signup ok');
  } finally { await srv.stop(); }
}

(async () => {
  try { partA(); await partB(); } catch (e) { ok(false, 'threw: ' + (e && e.stack || e)); }
  console.log(`\n${checks - fails}/${checks} pass`);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  process.exit(fails ? 1 : 0);
})();
