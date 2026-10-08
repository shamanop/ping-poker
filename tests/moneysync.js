// Money sync: admin edits reach the player's live sockets (chips bank + Cash). Throwaway server, port 4872.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { io } = require(process.env.SIO_CLIENT || '/home/isabelle/.cache/node_modules/socket.io-client');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppms-'));
const PORT = Number(process.env.TEST_PORT || 4872), ROOT = path.join(__dirname, '..');
const env = { ...process.env, PORT: String(PORT), BANK_FILE: path.join(dir, 'bank.json'), LEDGER_FILE: path.join(dir, 'ledger.json'), ACCOUNTS_FILE: path.join(dir, 'acc.json'), TABLES_FILE: path.join(dir, 'tables.json'), WALLET_FILE: path.join(dir, 'wallet.json'), AUTO_START_MS: '600000' };
const proc = spawn('node', ['server.js'], { cwd: ROOT, env, stdio: 'ignore' });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const cl = () => { const c = { ev: [] }; c.s = io(`http://localhost:${PORT}`, { forceNew: true }); c.s.onAny((e, d) => c.ev.push([e, d])); c.last = e => { const h = c.ev.filter(x => x[0] === e); return h.length ? h[h.length - 1][1] : undefined; }; c.has = e => c.ev.some(x => x[0] === e); return c; };
(async () => {
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await sleep(100); } }
    const a1 = cl(), a2 = cl(), ch = cl(); await sleep(300);
    a1.s.emit('auth_signup', { name: 'Alice', pin: '1234', avatar: 'x' }); await sleep(400);
    a2.s.emit('auth_login', { name: 'Alice', pin: '1234' }); await sleep(400);
    ch.s.emit('auth_claim', { name: 'chris', pin: '4321', avatar: 'x', roomPassword: 'ping' }); await sleep(500);
    ok(a1.has('money') && a1.last('money').wallet && a1.last('money').wallet.play === 1000000, 'player gets money view on sign-in');
    ch.ev.length = 0; a1.ev.length = 0; a2.ev.length = 0;
    ch.s.emit('bank_set', { name: 'Alice', balance: 7777 }); await sleep(500);
    ok(a1.last('money') && a1.last('money').chips === 7777 && a1.last('money').bank === 7777, 'chips edit pushed to player socket 1');
    ok(a2.last('money') && a2.last('money').chips === 7777, 'chips edit pushed to player socket 2 (second device)');
    ch.ev.length = 0; a1.ev.length = 0;
    ch.s.emit('admin_set_play', { key: 'alice', cents: 250000 }); await sleep(500);
    ok(a1.last('wallet') && a1.last('wallet').play === 250000, 'Cash edit pushed as wallet event');
    ok(a1.last('money') && a1.last('money').wallet.play === 250000 && a1.last('money').chips === 7777, 'money event carries both chips and Cash');
    ok(ch.last('admin_result') && ch.last('admin_result').ok, 'admin told it worked');
    ch.s.emit('admin_overview'); await sleep(300);
    const row = ch.last('admin_overview').accounts.find(r => r.key === 'alice');
    ok(row && row.play === 250000 && row.balance === 7777, 'admin overview shows both numbers');
    a1.ev.length = 0;
    a1.s.emit('admin_set_play', { key: 'alice', cents: 99999999 }); await sleep(300);
    ok(a1.last('admin_result') && a1.last('admin_result').ok === false, 'non-admin cannot set Cash');
    ch.s.emit('admin_set_play', { key: 'alice', cents: -5 }); await sleep(300);
    ok(ch.last('admin_result') && ch.last('admin_result').ok === false, 'negative Cash rejected');
  } finally { proc.kill(); setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} process.exit(fails ? 1 : 0); }, 400); }
  console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
})();
