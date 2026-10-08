// Money 1008 K1-1: the admin account can never be claimed with the public room word.
// Exit 1 while the fault exists (an anonymous socket claims `chris` with "ping" and mints Cash), exit 0 when fixed.
// Boots server.js on a fresh temp data dir per case, ports 4880..4885 (override with ADMINCLAIM_PORT_BASE).
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
const { io } = require(path.join(ROOT, 'node_modules', 'socket.io-client'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const BASE = Number(process.env.ADMINCLAIM_PORT_BASE) || 4880;
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const PROCS = new Set();
process.on('exit', () => { for (const p of PROCS) try { p.kill('SIGKILL'); } catch {} });

async function boot(port, env = {}, dir) {
  dir = dir || fs.mkdtempSync(path.join(os.tmpdir(), 'ppadm-'));
  const f = n => path.join(dir, n);
  if (!fs.existsSync(f('b.json'))) { fs.writeFileSync(f('b.json'), '{}'); fs.writeFileSync(f('l.json'), '[]'); }
  const e = { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), DATA_DIR: dir, BANK_FILE: f('b.json'), LEDGER_FILE: f('l.json'), ACCOUNTS_FILE: f('a.json'),
    TABLES_FILE: f('t.json'), WALLET_FILE: f('w.json'), STACKS_FILE: f('s.json'), BIGWINS_FILE: f('bw.json'), BENDER_CFG_FILE: f('bc.json'), MONEY_FILE: f('money.jsonl'),
    CAMPAIGN_FILE: f('c.json'), AUTO_START_MS: '600000', AUTH_SIGNUP_LIMIT: '100000', ...env };
  const proc = spawn('node', ['server.js'], { cwd: ROOT, env: e, stdio: ['ignore', fs.openSync(f('server.log'), 'a'), fs.openSync(f('server.log'), 'a')] });
  PROCS.add(proc);
  for (let i = 0; i < 200; i++) { try { await fetch(`http://127.0.0.1:${port}/`); break; } catch { await sleep(50); } }
  await sleep(100);
  return { port, dir, proc, log: () => fs.readFileSync(f('server.log'), 'utf8'), accounts: () => JSON.parse(fs.readFileSync(f('a.json'), 'utf8')).accounts,
    async stop() { proc.kill('SIGKILL'); await new Promise(r => { proc.once('exit', r); setTimeout(r, 2000); }); PROCS.delete(proc); } };
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
const claimChris = (c, pw, pin = '9999') => c.req('auth_claim', { name: 'chris', pin, roomPassword: pw }, ...AUTH);
const refused = r => r.ev === 'auth_error' && !!r.p && r.p.code !== 'rate_limited';
const LOUD = /ADMIN_CLAIM_PASSWORD/;

// Admin ops from a socket that holds no admin session must all fail.
async function noAdminOps(c, label) {
  const a = await c.req('admin_set_play', { key: 'mallory', cents: 5000000, opId: 'k11' }, 'admin_result', 'error');
  ok(a.ev === 'admin_result' && a.p.ok === false && a.p.code === 'auth', label + ': admin_set_play refused (' + JSON.stringify(a.p) + ')');
  const b = await c.req('admin_reset_pin', { key: 'chris', newPin: '1111' }, 'admin_result', 'error');
  ok(b.ev === 'admin_result' && b.p.ok === false, label + ': admin_reset_pin refused');
  const d = await c.req('account_reset_pin', { key: 'chris', newPin: '1111' }, 'ok', 'auth_error', 'error');
  ok(d.ev !== 'ok', label + ': account_reset_pin refused (' + d.ev + ')');
}

(async () => {
  try {
    // ── A. defaults: ADMIN_CLAIM_PASSWORD unset ───────────────────────────────────────────────────────
    let srv = await boot(BASE);
    ok(!srv.accounts().chris.claimed && srv.accounts().chris.isAdmin, 'A: fresh data dir has chris unclaimed + admin');
    ok(LOUD.test(srv.log()), 'A: boot logs a loud line naming ADMIN_CLAIM_PASSWORD when an admin is unclaimed and it is unset');
    ok(srv.log().split('\n').filter(l => LOUD.test(l)).length === 1, 'A: exactly one such boot line');
    const anon = await client(srv.port);
    let r = await claimChris(anon, 'ping');
    ok(refused(r), 'A: claim chris with the room word is refused (' + r.ev + ' ' + JSON.stringify(r.p && r.p.code) + ')');
    ok(r.ev !== 'auth_ok', 'A: ...and never auth_ok');
    for (const pw of ['PING', ' ping ', '', null, undefined]) { r = await claimChris(anon, pw); ok(r.ev !== 'auth_ok', 'A: claim chris with ' + JSON.stringify(pw) + ' refused'); }
    ok(!srv.accounts().chris.claimed, 'A: chris still unclaimed after the attempts');
    await noAdminOps(anon, 'A');
    // the refusal counts against the same rate limit
    const flood = await client(srv.port);
    let lim = false;
    for (let i = 0; i < 12 && !lim; i++) { const x = await claimChris(flood, 'ping'); lim = x.p && x.p.code === 'rate_limited'; }
    ok(lim, 'A: repeated admin claims hit rate_limited (same limiter as a wrong password)');
    // other ways in: signup / login with the admin name in other spellings
    const s2 = await client(srv.port);
    for (const nm of ['chris', 'CHRIS', 'Chris', ' chris ', 'cHrIs', 'chris\t']) {
      const x = await s2.req('auth_signup', { name: nm, pin: '2222' }, ...AUTH);
      ok(x.ev === 'auth_error', 'A: signup as ' + JSON.stringify(nm) + ' -> ' + (x.p && x.p.code));
    }
    for (const nm of ['сhris', 'chгis', 'ｃｈｒｉｓ', 'chris​', 'chrıs', 'ch ris', 'chriṡ', 'Kris']) {
      const x = await s2.req('auth_signup', { name: nm, pin: '2222' }, ...AUTH);
      const mallory = srv.accounts();
      const adminKeys = Object.values(mallory).filter(a => a.isAdmin).map(a => a.key);
      ok(adminKeys.join() === 'chris', 'A: signup ' + JSON.stringify(nm) + ' (' + (x.ev === 'auth_ok' ? 'ok as non-admin' : x.p && x.p.code) + ') leaves chris as the only admin');
      if (x.ev === 'auth_ok') ok(x.p.account.isAdmin === false && x.p.account.key !== 'chris', 'A: ...and that account is not admin');
    }
    const lg = await (await client(srv.port)).req('auth_login', { name: 'chris', pin: '9999' }, ...AUTH);
    ok(lg.ev === 'auth_error', 'A: login chris with a guessed PIN while unclaimed -> ' + (lg.p && lg.p.code));
    ok(!srv.accounts().chris.claimed, 'A: chris still unclaimed at the end of A');
    await srv.stop();

    // ── B. ADMIN_CLAIM_PASSWORD equal to the room word, too short, or blank = treated as unset ───────
    let port = BASE + 1;
    for (const [label, pw] of [['equal to room word', 'ping'], ['room word, other case', 'PING'], ['room word padded', '  Ping  '], ['7 chars', 'abc1234'], ['1 char', 'x'], ['blank', ''], ['spaces', '        ']]) {
      srv = await boot(port, { ADMIN_CLAIM_PASSWORD: pw });
      const c = await client(srv.port);
      for (const guess of ['ping', pw]) {
        r = await claimChris(c, guess);
        ok(r.ev !== 'auth_ok', 'B(' + label + '): claim chris with ' + JSON.stringify(guess) + ' refused');
      }
      ok(!srv.accounts().chris.claimed, 'B(' + label + '): chris still unclaimed');
      ok(LOUD.test(srv.log()), 'B(' + label + '): loud boot line');
      await srv.stop();
    }

    // ── C. a real ADMIN_CLAIM_PASSWORD (>= 8 chars, not the room word): only it claims ───────────────
    const SECRET = 'Tr0ub4dor&3x';
    srv = await boot(port, { ADMIN_CLAIM_PASSWORD: SECRET });
    ok(!/ADMIN_CLAIM_PASSWORD/.test(srv.log()), 'C: no loud boot line when a valid ADMIN_CLAIM_PASSWORD is set');
    const c1 = await client(srv.port);
    r = await claimChris(c1, 'ping'); ok(refused(r), 'C: room word refused');
    r = await claimChris(c1, SECRET.toLowerCase()); ok(refused(r), 'C: wrong case of the admin secret refused (case-sensitive)');
    r = await claimChris(c1, SECRET.slice(0, -1)); ok(refused(r), 'C: truncated admin secret refused');
    ok(!srv.accounts().chris.claimed, 'C: still unclaimed after wrong tries');
    const c2 = await client(srv.port);
    r = await claimChris(c2, SECRET);
    ok(r.ev === 'auth_ok' && r.p.account.isAdmin === true && r.p.account.key === 'chris', 'C: the real admin secret claims chris as admin');
    const mal = await client(srv.port);
    const ms = await mal.req('auth_signup', { name: 'Mallory', pin: '1234' }, ...AUTH);
    ok(ms.ev === 'auth_ok', 'C: Mallory signs up');
    const set = await c2.req('admin_set_play', { key: 'mallory', cents: 1000, opId: 'c1' }, 'admin_result', 'error');
    ok(set.ev === 'admin_result' && set.p.ok === true, 'C: the real admin can still set Cash');
    // a second claim after the first, with the secret or the room word, is a name_taken
    r = await claimChris(await client(srv.port), SECRET, '5555'); ok(r.ev === 'auth_error' && r.p.code === 'name_taken', 'C: second claim -> name_taken');
    r = await claimChris(await client(srv.port), 'ping', '5555'); ok(r.ev === 'auth_error', 'C: room word after claim refused');
    // non-admin accounts still claim with the room word (legacy players)
    await srv.stop();

    // ── D. restart with the secret removed after chris is claimed: nothing opens, no loud line ──────
    srv = await boot(port, {}, srv.dir);
    ok(srv.accounts().chris.claimed, 'D: chris stays claimed across a restart');
    r = await claimChris(await client(srv.port), 'ping'); ok(r.ev === 'auth_error', 'D: room word still refused');
    await srv.stop();

    // ── E. non-admin legacy accounts still claim with the room word ──────────────────────────────────
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppadm-'));
    fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify({ mike: 300 })); fs.writeFileSync(path.join(dir, 'l.json'), '[]');
    srv = await boot(port, {}, dir);
    r = await claimChris(await client(srv.port), 'ping');
    ok(r.ev === 'auth_error', 'E: admin still refused in a data dir that also has a legacy player');
    r = await (await client(srv.port)).req('auth_claim', { name: 'mike', pin: '1234', roomPassword: 'ping' }, ...AUTH);
    ok(r.ev === 'auth_ok' && r.p.account.isAdmin === false, 'E: legacy player `mike` still claims with the room word, not admin');
    await srv.stop();
  } catch (e) { console.log('FAIL harness error', e && e.stack || e); fails++; }
  console.log(`\n${checks - fails}/${checks} passed${fails ? ', ' + fails + ' FAILED' : ''}`);
  process.exit(fails ? 1 : 0);
})();
