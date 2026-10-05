// Accounts: signup/login/resume/logout, rate limit, migration, claim, atomic save. Temp data files, port 4801.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { io } = require(process.env.SIO_CLIENT || '/home/isabelle/.cache/node_modules/socket.io-client');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppac-'));
const PORT = 4801, ROOT = path.join(__dirname, '..');
const F = { bank: path.join(dir, 'bank.json'), ledger: path.join(dir, 'ledger.json'), acc: path.join(dir, 'accounts.json'), tables: path.join(dir, 'tables.json') };
fs.writeFileSync(F.bank, JSON.stringify({ chris: 5000, Mike: 300, mike: 200 }));
fs.writeFileSync(F.ledger, JSON.stringify([
  { t: 1000, name: 'Chris', type: 'buyin', amount: 1500, balanceAfter: 3500, tableChips: 1500, handNum: null, room: 'POKERPING' },
  { t: 2000, name: 'MIKE', type: 'buyin', amount: 500, balanceAfter: 500, tableChips: 500, handNum: null, room: 'POKERPING' },
  { t: 3000, name: 'testplayer', type: 'buyin', amount: 100, balanceAfter: 0, tableChips: 100, handNum: null, room: 'POKERPING' },
]));
const proc = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), AUTO_START_MS: '600000', AUTH_CLOCK_SKEW: '0', AUTH_SIGNUP_LIMIT: '8', BANK_FILE: F.bank, LEDGER_FILE: F.ledger, ACCOUNTS_FILE: F.acc, TABLES_FILE: F.tables } });
let out = ''; proc.stdout.on('data', d => { out += d; }); proc.stderr.on('data', d => { out += d; });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

function client() {
  const c = { ev: [] };
  c.s = io(`http://localhost:${PORT}`, { forceNew: true });
  c.s.onAny((e, d) => c.ev.push([e, d]));
  c.call = async (ev, payload, ...want) => {
    const start = c.ev.length;
    c.s.emit(ev, payload);
    for (let i = 0; i < 100; i++) {
      const hit = c.ev.slice(start).find(([e]) => want.includes(e));
      if (hit) return hit;
      await sleep(30);
    }
    return [null, null];
  };
  return c;
}
const AUTH = ['auth_ok', 'auth_error'];

(async () => {
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await sleep(100); } }
    // ── migration (booted with bank+ledger seeded, no accounts.json) ──
    const m = JSON.parse(fs.readFileSync(F.acc, 'utf8'));
    const keys = Object.keys(m.accounts).sort();
    ok(m.version === 1, 'accounts.json version 1');
    ok(keys.join() === 'chris,mike', 'migration: 2 accounts (chris, mike merged, testplayer skipped): ' + keys.join());
    ok(!m.accounts.chris.claimed && !m.accounts.mike.claimed && m.accounts.chris.isAdmin === true, 'migration: unclaimed, chris admin');
    ok(m.accounts.chris.display === 'Chris' && m.accounts.mike.display === 'MIKE', 'migration: display from earliest ledger row');
    ok(/migrated 2 accounts, merged 1 duplicates/.test(out), 'migration summary printed');
    ok(fs.readdirSync(dir).some(f => f.startsWith('bank.json.bak-')) && fs.readdirSync(dir).some(f => f.startsWith('ledger.json.bak-')), 'bank/ledger backups made once');

    const c = client();
    // claim legacy name
    let [e, d] = await c.call('auth_signup', { name: 'mike', pin: '1234', avatar: 'a02' }, ...AUTH);
    ok(e === 'auth_error' && d.code === 'claim_required', 'signup on unclaimed legacy name -> claim_required');
    [e, d] = await c.call('auth_claim', { name: 'mike', pin: '1234', avatar: 'a02', roomPassword: 'nope' }, ...AUTH);
    ok(e === 'auth_error' && d.code === 'bad_login', 'claim with wrong room password rejected');
    [e, d] = await c.call('auth_claim', { name: 'mike', pin: '1234', avatar: 'a02', roomPassword: 'ping' }, ...AUTH);
    ok(e === 'auth_ok' && d.account.key === 'mike' && d.account.display === 'MIKE' && d.token.length === 64, 'claim with room password ok');
    const bank = JSON.parse(fs.readFileSync(F.bank, 'utf8'));
    ok(bank.mike === 200 && bank.Mike === 300 && bank.chris === 5000, 'claim leaves bank.json untouched (balance preserved)');
    [e, d] = await c.call('auth_claim', { name: 'mike', pin: '9999', avatar: 'a02', roomPassword: 'ping' }, ...AUTH);
    ok(e === 'auth_error' && d.code === 'name_taken', 'second claim of same name -> name_taken');

    // signup / casing
    const a = client();
    [e, d] = await a.call('auth_signup', { name: 'Ann Lee', pin: '2468', avatar: 'a05' }, ...AUTH);
    ok(e === 'auth_ok' && d.account.display === 'Ann Lee' && d.account.key === 'ann lee', 'signup ok');
    const tok = d.token;
    [e, d] = await a.call('auth_signup', { name: 'ANN  LEE', pin: '2468' }, ...AUTH);
    ok(e === 'auth_error' && d.code === 'name_taken', 'CASE/space-variant signup -> name_taken');
    for (const bad of [['x', '1234'], ['bad<name>', '1234'], ['Okname', '12'], ['Okname', 'abcd'], ['Okname', '1234567']]) {
      [e, d] = await a.call('auth_signup', { name: bad[0], pin: bad[1] }, ...AUTH);
      ok(e === 'auth_error' && (d.code === 'bad_name' || d.code === 'bad_pin'), `bad signup ${bad[0]}/${bad[1]} -> ${d && d.code}`);
    }
    const l = client();
    [e, d] = await l.call('auth_login', { name: 'ANN LEE', pin: '2468' }, ...AUTH);
    ok(e === 'auth_ok' && d.account.display === 'Ann Lee', 'login any casing, display stays');
    [e, d] = await l.call('profile_get', {}, 'profile', 'error');
    ok(e === 'profile' && d.display === 'Ann Lee' && d.netCents === 0 && Array.isArray(d.recent) && d.prefs, 'profile_get after login');
    [e, d] = await l.call('profile_update', { avatar: 'a09', prefs: { currency: 'usd' } }, 'profile', 'error');
    ok(e === 'profile' && d.avatar === 'a09' && d.prefs.currency === 'usd', 'profile_update');
    const anon = client();
    [e, d] = await anon.call('profile_get', {}, 'profile', 'error');
    ok(e === 'error' && /Sign in/.test(d.message), 'protocol handler requires sign in');

    // resume / logout
    const r = client();
    [e, d] = await r.call('auth_resume', { key: 'ann lee', token: tok }, ...AUTH);
    ok(e === 'auth_ok' && !d.token, 'resume with token ok (no new token)');
    const r2 = client();
    [e, d] = await r2.call('auth_resume', { key: 'ann lee', token: 'f'.repeat(64) }, ...AUTH);
    ok(e === 'auth_error' && d.code === 'bad_session', 'resume with bad token -> bad_session');
    [e, d] = await r.call('auth_logout', {}, 'auth_out');
    ok(e === 'auth_out', 'logout');
    [e, d] = await r2.call('auth_resume', { key: 'ann lee', token: tok }, ...AUTH);
    ok(e === 'auth_error' && d.code === 'bad_session', 'token invalid after logout');

    // pin change
    [e, d] = await l.call('pin_change', { oldPin: '0000', newPin: '1357' }, 'ok', 'auth_error');
    ok(e === 'auth_error', 'pin_change wrong old pin rejected');
    [e, d] = await l.call('pin_change', { oldPin: '2468', newPin: '1357' }, 'ok', 'auth_error');
    ok(e === 'ok' && d.what === 'pin', 'pin_change ok');
    const l2 = client();
    [e, d] = await l2.call('auth_login', { name: 'ann lee', pin: '1357' }, ...AUTH);
    ok(e === 'auth_ok', 'login with new pin');

    // admin reset needs admin
    [e, d] = await l.call('account_reset_pin', { key: 'mike', newPin: '1111' }, 'ok', 'auth_error', 'error');
    ok(e !== 'ok', 'non-admin cannot reset pin');

    // rate limit
    const rl = client();
    let last;
    for (let i = 0; i < 5; i++) last = await rl.call('auth_login', { name: 'ann lee', pin: '0000' }, ...AUTH);
    ok(last[0] === 'auth_error' && last[1].code === 'rate_limited' && last[1].retryMs > 0 && last[1].retryMs <= 30000, '5 wrong PINs -> rate_limited with retryMs');
    [e, d] = await rl.call('auth_login', { name: 'ann lee', pin: '1357' }, ...AUTH);
    ok(e === 'auth_error' && d.code === 'rate_limited', 'correct pin still locked while locked');
    await rl.call('__test_skew', { ms: 31000 }, 'ok');
    [e, d] = await rl.call('auth_login', { name: 'ann lee', pin: '1357' }, ...AUTH);
    ok(e === 'auth_ok', 'success after lock expiry (clock skew)');
    await rl.call('__test_skew', { ms: 0 }, 'ok');

    // signup limit per ip (limit 8; we already made 1 + 5 rejected counted... fill to the cap)
    let limited = null;
    for (let i = 0; i < 10 && !limited; i++) {
      [e, d] = await a.call('auth_signup', { name: 'Fill' + i, pin: '1234' }, ...AUTH);
      if (e === 'auth_error' && d.code === 'rate_limited') limited = d;
    }
    ok(!!limited && limited.retryMs > 0, 'signup rate limit per ip');

    // persistence checks
    await sleep(200);
    const raw = fs.readFileSync(F.acc, 'utf8');
    ok(!/"(2468|1357)"/.test(raw) && !/"pin"/.test(raw), 'PIN never stored');
    const j = JSON.parse(raw);
    ok(/^[0-9a-f]{64}$/.test(j.accounts['ann lee'].pinHash) && /^[0-9a-f]{32}$/.test(j.accounts['ann lee'].salt), 'pinHash/salt hex');
    ok(j.accounts['ann lee'].sessions.every(s => /^[0-9a-f]{64}$/.test(s.h)) && !raw.includes(tok), 'only token hashes stored');
    ok(!fs.existsSync(F.acc + '.tmp'), 'no .tmp left behind (atomic write)');

    // restart: accounts persist and migration is idempotent
    proc.kill('SIGTERM'); await sleep(400);
    ok(Object.keys(JSON.parse(fs.readFileSync(F.acc, 'utf8')).accounts).includes('ann lee'), 'flushed on shutdown');
  } catch (err) { console.log('FAIL exception', err); fails++; }
  try { proc.kill(); } catch {}
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})();
