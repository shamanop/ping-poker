const { authJoin } = require('../authjoin');
// Server restart (deploy): balances + chips on the table must come back as bank.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { io } = require(process.env.SIO_CLIENT || '/home/isabelle/.cache/node_modules/socket.io-client');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppps-'));
const PORT = 4781, ROOT = path.join(__dirname, '..', '..');
const env = { ...process.env, PORT: String(PORT), AUTO_START_MS: '600000', BANK_FILE: path.join(dir, 'bank.json'), LEDGER_FILE: path.join(dir, 'ledger.json') };
const boot = async () => { const p = spawn('node', ['server.js'], { cwd: ROOT, env }); for (let i = 0; i < 60; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await sleep(100); } } return p; };
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const join = async name => { const s = io(`http://localhost:${PORT}`, { forceNew: true }); let gs = null, bal = null; s.on('game_state', g => { gs = g; }); s.on('balance_data', d => { bal = d.balance; }); authJoin(s, { name, avatar: '🦊', password: 'ping' }); await sleep(500); return { s, gs: () => gs, bal: () => bal }; };
(async () => {
  let proc = await boot();
  try {
    const a = await join('Ann'), b = await join('Bo');
    a.s.emit('start_game', { roomId: 'POKERPING', blindInterval: 0 }); await sleep(800);
    a.s.emit('bank_set', { roomId: 'POKERPING', target: 'Ann', amount: 20000 }); await sleep(300);
    const sum = async () => { const r = await (await fetch(`http://localhost:${PORT}/api/bank-summary?password=ping`)).json(); return Object.fromEntries(r.players.map(p => [p.name.toLowerCase(), p.bank + p.atTable])); };
    const before = await sum();
    await sleep(2600);
    proc.kill('SIGKILL'); a.s.disconnect(); b.s.disconnect(); await sleep(300);
    proc = await boot();
    const after = await sum();
    ok(before.ann === after.ann && before.bo === after.bo, `restart keeps totals: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    const a2 = await join('Ann');
    ok(after.ann > 0 && a2.gs().players.find(p => p.name === 'Ann'), 'Ann rejoins after restart');
  } catch (e) { console.log('ERROR', e); fails++; }
  finally { proc.kill('SIGKILL'); console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0); }
})();
