'use strict';
// node tests/money-1008-cfg-notoken.js   (a few seconds)
// MONEY HARDENING 1008, R2C-6: a POST to the live-config routes without the admin token is refused (403) and changes nothing. The token travels in the x-admin-token HEADER only:
// no token, a wrong token, and the right token in the query string (or in the body) all get 403. The routes are the Ballot Bender one (server.js: app.post('/api/admin/bender-config')) and Cold Call's.
// The right-token POST is not sent: it would start a payback measurement (tests/money-1008-cfg-bender.js and -cfg-coldcall.js cover that).
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert'), http = require('http'), crypto = require('crypto');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-notoken-'));
fs.writeFileSync(path.join(dir, 'bank.json'), '{}'); fs.writeFileSync(path.join(dir, 'ledger.json'), '[]');
const TOKEN = crypto.randomBytes(18).toString('hex'), WRONG = crypto.randomBytes(18).toString('hex');
for (const k of ['DATA_DIR', 'RAILWAY_VOLUME_MOUNT_PATH', 'COLDCALL_PULL_FILE', 'ADMIN_WRONG_TOKEN_MAX', 'ADMIN_WRONG_TOKEN_WINDOW_MS']) delete process.env[k];
Object.assign(process.env, { BANK_FILE: path.join(dir, 'bank.json'), LEDGER_FILE: path.join(dir, 'ledger.json'), PORT: '0', BENDER_ADMIN_TOKEN: TOKEN, ADMIN_WRONG_TOKEN_MAX: '100', COLDCALL_CFG_FILE: path.join(dir, 'cc.json'), BENDER_CFG_FILE: path.join(dir, 'b.json') });
const logs = []; const orig = console.log; console.log = (...x) => logs.push(x.join(' '));
const srv = require('../server.js').start(process.env);
const call = (method, p, token, body) => new Promise((resolve, reject) => {
  const data = body === undefined ? null : JSON.stringify(body);
  const headers = {}; if (token) headers['x-admin-token'] = token; if (data) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(data); }
  const rq = http.request({ host: '127.0.0.1', port: srv.server.address().port, path: p, method, headers }, (res) => { let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => resolve({ status: res.statusCode, text: t })); });
  rq.on('error', reject); rq.end(data);
});
let n = 0;
(async () => {
  try {
    await new Promise((res, rej) => { if (srv.server.listening) return res(); srv.server.once('error', rej); srv.server.once('listening', res); });
    for (const route of ['/api/admin/bender-config', '/api/admin/coldcall-config']) {
      const before = (await call('GET', route, TOKEN)).text; assert.ok(before.length > 2, route + ': the right token reads the config');
      const q = `?x-admin-token=${TOKEN}&token=${TOKEN}&admin_token=${TOKEN}&adminToken=${TOKEN}`;
      // a body that, if it got through, would change the live math (reset) or start a measurement (overrides)
      const tries = [
        ['no token', route, '', { reset: true, note: 'notoken' }],
        ['a wrong token', route, WRONG, { reset: true, note: 'wrong' }],
        ['a wrong token, overrides', route, WRONG, { overrides: { payScale: 0.5 }, note: 'wrong' }],
        ['the right token in the query string', route + q, '', { reset: true, note: 'query' }],
        ['the right token in the query string, overrides', route + q, '', { overrides: { payScale: 0.5 }, note: 'query' }],
        ['the right token in the body', route, '', { reset: true, note: 'body', token: TOKEN, 'x-admin-token': TOKEN }],
      ];
      for (const [what, p, tok, body] of tries) {
        const r = await call('POST', p, tok, body);
        assert.strictEqual(r.status, 403, `${route}: POST with ${what} answered ${r.status} ${r.text.slice(0, 120)}`);
        assert.ok(!/"ok":true/.test(r.text), `${route}: POST with ${what} was accepted: ${r.text.slice(0, 120)}`);
        n++;
      }
      assert.strictEqual((await call('GET', route, TOKEN)).text, before, route + ': the refused POSTs changed the live config');
      assert.strictEqual((await call('GET', route + '?x-admin-token=' + TOKEN, '')).status, 403, route + ': a GET with the token in the query string is refused too');
    }
    assert.ok(!logs.some((l) => l.includes(TOKEN) || l.includes(WRONG)), 'no token in the log');
    assert.ok(logs.filter((l) => /\[admin\] refused \(403\)/.test(l)).length >= n, 'one log line per refused try');
    assert.ok(!fs.existsSync(path.join(dir, 'b.json')) && !fs.existsSync(path.join(dir, 'cc.json')), 'no config file was written');
    orig(`money-1008-cfg-notoken: ok (${n} POSTs refused)`);
  } catch (e) { orig(e); process.exitCode = 1; }
  finally { console.log = orig; await new Promise((r) => srv.server.close(r)); try { srv.ctx.ledger.close(); } catch {} fs.rmSync(dir, { recursive: true, force: true }); process.exit(process.exitCode || 0); }
})();
