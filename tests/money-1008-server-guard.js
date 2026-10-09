'use strict';
// node tests/money-1008-server-guard.js   (about 30 s; boots the real server.js six times as a child process on V2_PORT_BASE..+5, default 4880)
// MONEY HARDENING 1008, SVC-1a + FOUND-1: two env switches that must never act in production.
//  - SIGNUP_PLAY_CENTS gives every new signup Cash (real money): honoured only when NODE_ENV !== 'production' AND the value is a safe integer >= 0; otherwise 0 and one loud log line.
//  - RIG=1 registers __rig (next decks) and __audit (every balance and seat) with no sign-in: never created when NODE_ENV === 'production', one loud log line.
const fs = require('fs'), os = require('os'), path = require('path'), net = require('net'), assert = require('assert');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const ROOT = path.join(__dirname, '..');
const BASE = Number(process.env.V2_PORT_BASE) || 4880;
const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'server-guard-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PROCS = new Set();
process.on('exit', () => { for (const p of PROCS) try { p.kill('SIGKILL'); } catch {} });
const portOpen = port => new Promise(res => { const s = net.connect(port, '127.0.0.1'); s.once('connect', () => { s.destroy(); res(true); }); s.once('error', () => res(false)); });

let SEQ = 0;
async function boot(n, env) {
  const port = BASE + n, dir = path.join(TMP, 'run' + (++SEQ)); fs.mkdirSync(dir, { recursive: true });   // a fresh data dir per boot (the port numbers cycle, the dirs must not)
  const f = x => path.join(dir, x);
  fs.writeFileSync(f('b.json'), '{}'); fs.writeFileSync(f('l.json'), '[]');
  const e = { ...process.env, PORT: String(port), DATA_DIR: dir, BANK_FILE: f('b.json'), LEDGER_FILE: f('l.json'), ACCOUNTS_FILE: f('a.json'), TABLES_FILE: f('t.json'), WALLET_FILE: f('w.json'), STACKS_FILE: f('s.json'),
    BIGWINS_FILE: f('bw.json'), MONEY_FILE: f('money.jsonl'), AUTH_SIGNUP_LIMIT: '100000', COLDCALL_TEST: '', ...env };
  for (const k of ['NODE_OPTIONS', 'SIGNUP_PLAY_CENTS', 'RIG', 'NODE_ENV', 'AUTH_CLOCK_SKEW', 'RAILWAY_ENVIRONMENT', 'RAILWAY_ENVIRONMENT_NAME', 'RAILWAY_VOLUME_MOUNT_PATH', 'RAILWAY_SERVICE_ID']) if (!(k in env)) delete e[k];
  const out = fs.openSync(f('server.log'), 'a');
  const proc = spawn('node', ['server.js'], { cwd: ROOT, stdio: ['ignore', out, out], env: e }); PROCS.add(proc);
  let up = false;
  for (let i = 0; i < 1600 && proc.exitCode === null; i++) { if (await portOpen(port)) { up = true; break; } await sleep(25); }   // up to 40 s: the box can be loaded
  if (!up) { try { proc.kill('SIGKILL'); } catch {} throw new Error('server did not start on ' + port); }
  await sleep(150);
  return { port, dir, log: () => fs.readFileSync(f('server.log'), 'utf8'), stop: async () => { proc.kill('SIGTERM'); for (let i = 0; i < 100 && proc.exitCode === null; i++) await sleep(50); if (proc.exitCode === null) proc.kill('SIGKILL'); PROCS.delete(proc); } };
}
const connect = srv => new Promise((res, rej) => { const s = io(`http://127.0.0.1:${srv.port}`, { transports: ['websocket'], forceNew: true, reconnection: false }); s.once('connect', () => res(s)); s.once('connect_error', rej); });
const ask = (s, ev, data, reply, ms) => new Promise(res => { const t = setTimeout(() => res(null), ms); s.once(reply, d => { clearTimeout(t); res(d); }); s.emit(ev, data); });

// signs a fresh player up and returns the Cash lines the ledger holds for it from mint:signup
async function signupCash(srv, name) {
  const s = await connect(srv);
  const r = await ask(s, 'auth_signup', { name, pin: '1234', avatar: 'a01' }, 'auth_ok', 8000);
  assert.ok(r && r.account, 'signup worked: ' + JSON.stringify(r));
  await sleep(300); s.close();
  const file = path.join(srv.dir, 'money.jsonl');
  const lines = (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '').split('\n').filter(Boolean).map(x => JSON.parse(x));
  return lines.filter(e => e.cur === 'play' && e.from === 'mint:signup' && e.to === 'play:' + name.toLowerCase()).reduce((n, e) => n + e.amount, 0);
}
// an unauthenticated socket sends __audit and __rig; returns which were answered
async function rigAnswers(srv) {
  const s = await connect(srv);
  const [audit, rig] = await Promise.all([ask(s, '__audit', {}, '__audit', 2500), ask(s, '__rig', { decks: [] }, '__rig_ok', 2500)]);
  s.close();
  return { audit: !!audit, rig: !!rig, auditKeys: audit ? Object.keys(audit).length : 0 };
}

// an unauthenticated socket sends __test_skew; returns whether it was answered
async function skewAnswered(srv) { const s = await connect(srv); const r = await ask(s, '__test_skew', { ms: 0 }, 'ok', 2000); s.close(); return !!(r && r.what === 'skew'); }

const results = [];
async function run(label, fn) { const t = Date.now(); try { await fn(); results.push([label, true]); console.log('ok   ' + label + ' (' + (Date.now() - t) + ' ms)'); } catch (e) { results.push([label, false]); console.log('FAIL ' + label + ': ' + (e && e.message)); } }
const ignoredLine = (log, name) => log.split('\n').filter(l => l.includes(name) && /ignored/i.test(l));

(async () => {
  let n = 0;
  await run('production: SIGNUP_PLAY_CENTS=1000000 mints no Cash on signup, one loud line', async () => {
    const srv = await boot(n++ % 10, { NODE_ENV: 'production', SIGNUP_PLAY_CENTS: '1000000' });
    try { const cash = await signupCash(srv, 'Stranger'); const l = ignoredLine(srv.log(), 'SIGNUP_PLAY_CENTS'); await srv.stop();
      assert.strictEqual(cash, 0, 'Cash minted at signup in production: ' + cash); assert.strictEqual(l.length, 1, 'one log line that says SIGNUP_PLAY_CENTS was ignored: ' + JSON.stringify(l)); } finally { await srv.stop(); }
  });
  await run('production: RIG=1 answers neither __audit nor __rig to an unauthenticated socket, one loud line', async () => {
    const srv = await boot(n++ % 10, { NODE_ENV: 'production', RIG: '1' });
    try { const a = await rigAnswers(srv); const l = ignoredLine(srv.log(), 'RIG'); await srv.stop();
      assert.ok(!a.audit, '__audit answered (' + a.auditKeys + ' fields: every balance and seat) in production'); assert.ok(!a.rig, '__rig answered (next decks queued) in production');
      assert.strictEqual(l.length, 1, 'one log line that says RIG was ignored: ' + JSON.stringify(l)); } finally { await srv.stop(); }
  });
  await run('outside production: SIGNUP_PLAY_CENTS=250000 is honoured (the v2 fixtures keep working), no ignore line', async () => {
    const srv = await boot(n++ % 10, { SIGNUP_PLAY_CENTS: '250000' });
    try { const cash = await signupCash(srv, 'Fixture'); const l = ignoredLine(srv.log(), 'SIGNUP_PLAY_CENTS'); await srv.stop();
      assert.strictEqual(cash, 250000, 'fixture Cash at signup: ' + cash); assert.strictEqual(l.length, 0, 'no ignore line: ' + JSON.stringify(l)); } finally { await srv.stop(); }
  });
  await run('outside production: RIG=1 still answers __audit and __rig (the v2 suites need it), no ignore line', async () => {
    const srv = await boot(n++ % 10, { NODE_ENV: 'test', RIG: '1' });
    try { const a = await rigAnswers(srv); const l = ignoredLine(srv.log(), 'RIG'); await srv.stop();
      assert.ok(a.audit && a.rig, 'rig answered: ' + JSON.stringify(a)); assert.strictEqual(l.length, 0, 'no ignore line: ' + JSON.stringify(l)); } finally { await srv.stop(); }
  });
  for (const bad of ['-5', '1.5', 'abc', '1e3', '9007199254740993', '']) {
    await run('outside production: bad SIGNUP_PLAY_CENTS=' + JSON.stringify(bad) + ' gives 0 Cash and one loud line', async () => {
      const srv = await boot(n++ % 10, { SIGNUP_PLAY_CENTS: bad });
      try { const cash = await signupCash(srv, 'Badval'); const l = ignoredLine(srv.log(), 'SIGNUP_PLAY_CENTS'); await srv.stop();
        assert.strictEqual(cash, 0, 'Cash minted from a bad value: ' + cash); assert.strictEqual(l.length, 1, 'one ignore line: ' + JSON.stringify(l)); } finally { await srv.stop(); }
    });
  }
  // REV-SG-1: the guards fail CLOSED. One helper, isProduction(env): NODE_ENV trimmed + lower-cased is "production", OR any Railway variable is present.
  const guardedBoot = async (label, env) => run('production (' + label + '): SIGNUP_PLAY_CENTS, RIG and AUTH_CLOCK_SKEW are all ignored in ONE boot', async () => {
    const srv = await boot(n++ % 10, { SIGNUP_PLAY_CENTS: '1000000', RIG: '1', AUTH_CLOCK_SKEW: '0', ...env });
    try { const cash = await signupCash(srv, 'Stranger'); const a = await rigAnswers(srv); const sk = await skewAnswered(srv); const log = srv.log(); await srv.stop();
      assert.strictEqual(cash, 0, 'Cash minted at signup: ' + cash); assert.ok(!a.audit && !a.rig, 'rig answered: ' + JSON.stringify(a)); assert.ok(!sk, '__test_skew answered');
      assert.strictEqual(ignoredLine(log, 'SIGNUP_PLAY_CENTS').length, 1, 'one SIGNUP_PLAY_CENTS line'); assert.strictEqual(ignoredLine(log, 'RIG').length, 1, 'one RIG line'); } finally { await srv.stop(); }
  });
  await guardedBoot('NODE_ENV=production', { NODE_ENV: 'production' });
  await guardedBoot('NODE_ENV=" Production " (case and spaces)', { NODE_ENV: ' Production ' });
  await guardedBoot('NODE_ENV misspelled "prod" + RAILWAY_ENVIRONMENT', { NODE_ENV: 'prod', RAILWAY_ENVIRONMENT: 'production' });
  await guardedBoot('NODE_ENV=test + RAILWAY_SERVICE_ID', { NODE_ENV: 'test', RAILWAY_SERVICE_ID: 'abc' });
  for (const v of ['RAILWAY_ENVIRONMENT', 'RAILWAY_ENVIRONMENT_NAME', 'RAILWAY_VOLUME_MOUNT_PATH', 'RAILWAY_SERVICE_ID']) await guardedBoot('NODE_ENV not set, only ' + v, { [v]: v === 'RAILWAY_VOLUME_MOUNT_PATH' ? path.join(TMP, 'vol') : 'x' });
  await run('outside production: AUTH_CLOCK_SKEW=0 still registers __test_skew (tests/accounts.js, profile.js, tables.js need it)', async () => {
    const srv = await boot(n++ % 10, { AUTH_CLOCK_SKEW: '0' });
    try { const sk = await skewAnswered(srv); await srv.stop(); assert.ok(sk, '__test_skew not answered'); } finally { await srv.stop(); }
  });
  const failed = results.filter(r => !r[1]);
  console.log(`money-1008-server-guard: ${results.length - failed.length}/${results.length} passed`);
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(2); });
