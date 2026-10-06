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
    // slot: Play $ and Chips modes, nothing else
    a.ev.length = 0; a.s.emit('wallet_get'); await sleep(300);
    const w0 = a.last('wallet'); ok(typeof w0.play === 'number' && typeof w0.chips === 'number' && w0.ledgerNet === undefined, 'wallet view is { play, chips } only');
    a.ev.length = 0; a.s.emit('g:bender:spin', { bet: 100, mode: 'chips' }); await sleep(500);
    const rc = a.last('g:bender:result'); ok(rc && rc.mode === 'chips' && rc.wallet.chips === w0.chips - 100 + rc.totalWin && rc.wallet.play === w0.play, 'slot chips spin settles against the chips bank');
    const mv = a.last('money'); ok(mv && mv.bank === rc.wallet.chips, 'money event pushed after a chips spin (bank ' + (mv && mv.bank) + ')');
    a.ev.length = 0; await sleep(200); a.s.emit('g:bender:spin', { bet: 100, mode: 'play' }); await sleep(500);
    const rp = a.last('g:bender:result'); ok(rp && rp.mode === 'play' && rp.wallet.chips === rc.wallet.chips && rp.wallet.play === rc.wallet.play - 100 + rp.totalWin, 'slot Play $ spin leaves chips alone');
    a.ev.length = 0; await sleep(200); a.s.emit('g:bender:spin', { bet: 100, mode: 'ledger' }); await sleep(300);
    ok(a.last('error') && a.last('error').code === 'bad_mode' && !a.has('g:bender:result'), 'ledger mode refused');
    a.ev.length = 0; a.s.emit('table_create', { settings: { name: 'Old school', mode: 'friends', buyIn: { min: 500, max: 5000, default: 1000 }, blinds: { sb: 5, bb: 10 } } }); await sleep(300);
    ok(a.last('error') && !a.has('table_created'), 'Friends $ tables can no longer be created');
    // choose the funding source on the buy-in: chips table paid with Play $, Play $ table paid with chips, each cashes back to its source
    a.ev.length = 0; a.s.emit('table_create', { settings: { name: 'Chips night', mode: 'chips', unit: 'chips', buyIn: { min: 500, max: 5000, default: 1500 }, blinds: { sb: 10, bb: 20 } } }); await sleep(400);
    const ct = a.last('table_created'); ok(ct && ct.table.mode === 'chips', 'chips table created');
    a.ev.length = 0; a.s.emit('wallet_get'); await sleep(300); const f0 = a.last('wallet');
    a.ev.length = 0; a.s.emit('table_join', { tableId: ct.table.id, buyIn: 1500, fund: 'play' }); await sleep(500);
    a.s.emit('wallet_get'); await sleep(300); const f1 = a.last('wallet');
    ok(a.has('table_joined') && f1.play === f0.play - 1500 && f1.chips === f0.chips, 'chips table paid with Play $: play -1500, bank untouched (' + f0.play + '/' + f0.chips + ' -> ' + f1.play + '/' + f1.chips + ')');
    a.s.emit('table_leave', { tableId: ct.table.id }); await sleep(500); a.s.emit('wallet_get'); await sleep(300); const f2 = a.last('wallet');
    ok(f2.play === f0.play && f2.chips === f0.chips, 'cash-out returned to Play $ (' + f2.play + '/' + f2.chips + ')');
    a.ev.length = 0; a.s.emit('table_join', { tableId: id, buyIn: 2000, fund: 'chips' }); await sleep(500);
    a.s.emit('wallet_get'); await sleep(300); const f3 = a.last('wallet');
    ok(a.has('table_joined') && f3.chips === f0.chips - 2000 && f3.play === f0.play, 'Play $ table paid with chips: bank -2000, Play $ untouched (' + f3.play + '/' + f3.chips + ')');
    a.s.emit('table_leave', { tableId: id }); await sleep(500); a.s.emit('wallet_get'); await sleep(300); const f4 = a.last('wallet');
    ok(f4.play === f0.play && f4.chips === f0.chips, 'cash-out returned to the chips bank (' + f4.play + '/' + f4.chips + ')');
  } finally { proc.kill(); setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} process.exit(fails ? 1 : 0); }, 400); }
  console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
})();
