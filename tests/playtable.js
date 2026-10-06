// Play $ tables draw buy-ins from and cash out to the Play $ wallet. Throwaway server, port 4873.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { io } = require(process.env.SIO_CLIENT || '/home/isabelle/.cache/node_modules/socket.io-client');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppms-'));
const PORT = Number(process.env.TEST_PORT || 4873), ROOT = path.join(__dirname, '..');
const env = { ...process.env, PORT: String(PORT), BANK_FILE: path.join(dir, 'bank.json'), LEDGER_FILE: path.join(dir, 'ledger.json'), ACCOUNTS_FILE: path.join(dir, 'acc.json'), TABLES_FILE: path.join(dir, 'tables.json'), WALLET_FILE: path.join(dir, 'wallet.json'), AUTO_START_MS: '600000' };
const proc = spawn('node', ['server.js'], { cwd: ROOT, env, stdio: 'ignore' });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const cl = () => { const c = { ev: [] }; c.s = io(`http://localhost:${PORT}`, { forceNew: true }); c.s.onAny((e, d) => c.ev.push([e, d])); c.last = e => { const h = c.ev.filter(x => x[0] === e); return h.length ? h[h.length - 1][1] : undefined; }; c.has = e => c.ev.some(x => x[0] === e); return c; };
(async () => {
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await sleep(100); } }
    const a = cl(); await sleep(300);
    a.s.emit('auth_signup', { name: 'Alice', pin: '1234', avatar: 'x' }); await sleep(400);
    a.s.emit('table_create', { settings: { name: 'Play night', mode: 'play', unit: 'cents', buyIn: { min: 500, max: 50000, default: 2000 }, blinds: { sb: 25, bb: 50 } } }); await sleep(400);
    const t = a.last('table_created'); ok(t && t.table.mode === 'play', 'play table created');
    const id = t.table.id;
    a.s.emit('wallet_get'); await sleep(300); const p0 = a.last('wallet').play; a.ev.length = 0;
    a.s.emit('table_join', { tableId: id, buyIn: 2000 }); await sleep(500);
    const spent = a.ev.filter(x => x[0] === 'wallet').map(x => x[1].play);
    ok(a.has('table_joined'), 'joined with $20');
    ok(spent.includes(p0 - 2000), 'Play $ dropped by $20 (' + p0 + ' -> ' + spent.join(',') + ')');
    const pIn = a.last('wallet').play;
    a.ev.length = 0;
    a.s.emit('table_leave', { tableId: id }); await sleep(500);
    a.s.emit('wallet_get'); await sleep(300);
    ok(a.last('wallet').play === pIn + 2000, 'cash-out returned $20 to Play $ (' + pIn + ' -> ' + a.last('wallet').play + ')');
    const b = cl(), ch = cl(); await sleep(300);
    b.s.emit('auth_signup', { name: 'Bob', pin: '1234', avatar: 'x' }); await sleep(400);
    ch.s.emit('auth_claim', { name: 'chris', pin: '4321', avatar: 'x', roomPassword: 'ping' }); await sleep(500);
    ch.s.emit('admin_set_play', { key: 'bob', cents: 1000 }); await sleep(300);
    b.ev.length = 0;
    b.s.emit('table_join', { tableId: id, buyIn: 5000 }); await sleep(400);
    ok(b.last('error') && /Play \$/.test(b.last('error').message) && !b.has('table_joined'), 'cannot buy in for more than Play $ balance');
  } finally { proc.kill(); setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} process.exit(fails ? 1 : 0); }, 400); }
  console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
})();
