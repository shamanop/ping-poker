'use strict';
// node tests/money-1008-cfg-admin-token.js   (a few seconds)
// MONEY HARDENING 1008, K2 admin-token note: after 5 wrong tokens from one address in 10 minutes the admin routes answer 429 until the window ends, one log line per refused try, the token is never logged.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), http = require('http'), crypto = require('crypto');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-token-'));
fs.writeFileSync(path.join(dir, 'bank.json'), '{}'); fs.writeFileSync(path.join(dir, 'ledger.json'), '[]');
const TOKEN = crypto.randomBytes(18).toString('hex'), WRONG = crypto.randomBytes(18).toString('hex');
for (const k of ['DATA_DIR', 'RAILWAY_VOLUME_MOUNT_PATH', 'COLDCALL_PULL_FILE', 'ADMIN_WRONG_TOKEN_MAX']) delete process.env[k];
Object.assign(process.env, { BANK_FILE: path.join(dir, 'bank.json'), LEDGER_FILE: path.join(dir, 'ledger.json'), PORT: '0', BENDER_ADMIN_TOKEN: TOKEN, ADMIN_WRONG_TOKEN_WINDOW_MS: '2000', COLDCALL_CFG_FILE: path.join(dir, 'cc.json'), BENDER_CFG_FILE: path.join(dir, 'b.json') });
const logs = []; const orig = console.log; console.log = (...x) => logs.push(x.join(' '));
const srv = require('../server.js').start(process.env);
const call = (method, p, token) => new Promise((resolve, reject) => {
  const rq = http.request({ host: '127.0.0.1', port: srv.server.address().port, path: p, method, headers: token ? { 'x-admin-token': token } : {} }, (res) => { let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => resolve({ status: res.statusCode, retry: res.headers['retry-after'], text: t })); });
  rq.on('error', reject); rq.end();
});
(async () => {
  try {
    await new Promise((res, rej) => { if (srv.server.listening) return res(); srv.server.once('error', rej); srv.server.once('listening', res); });
    const routes = ['/api/admin/bender-config', '/api/admin/coldcall-config'];
    assert.strictEqual((await call('GET', routes[0], TOKEN)).status, 200, 'the right token works before any failure');
    const got = [];
    for (let i = 0; i < 5; i++) got.push((await call('GET', routes[i % 2], i % 2 ? WRONG : '')).status);
    assert.deepStrictEqual(got, [403, 403, 403, 403, 403], 'five wrong tries are answered 403');
    for (const r of routes) { const x = await call('GET', r, WRONG); assert.strictEqual(x.status, 429, r); assert.ok(Number(x.retry) >= 1); }
    const good = await call('GET', routes[0], TOKEN); assert.strictEqual(good.status, 429, 'even the right token waits while the window is full');
    assert.strictEqual((await call('POST', routes[1], TOKEN)).status, 429);
    const refused = logs.filter((l) => /\[admin\] refused/.test(l)); assert.strictEqual(refused.length, 5 + 2 + 1 + 1, 'one log line per refused try: ' + refused.length);
    assert.ok(!logs.some((l) => l.includes(TOKEN) || l.includes(WRONG)), 'no token in the log');
    await new Promise((r) => setTimeout(r, 2200));
    assert.strictEqual((await call('GET', routes[0], TOKEN)).status, 200, 'the window ended: the right token works again');
    orig('money-1008-cfg-admin-token: ok');
  } catch (e) { orig(e); process.exitCode = 1; }
  finally { console.log = orig; await new Promise((r) => srv.server.close(r)); try { srv.ctx.ledger.close(); } catch {} fs.rmSync(dir, { recursive: true, force: true }); process.exit(process.exitCode || 0); }
})();
