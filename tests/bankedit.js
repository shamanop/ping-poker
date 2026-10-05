// Bank edit permission + auto-start checks. Throwaway server on PORT 4778.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { io } = require(process.env.SIO_CLIENT || '/home/isabelle/.cache/node_modules/socket.io-client');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppbe-'));
const PORT = 4778, ROOT = path.join(__dirname, '..');
const bankFile = path.join(dir, 'bank.json');
const proc = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BANK_FILE: bankFile, LEDGER_FILE: path.join(dir, 'ledger.json') } });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
function client(name) {
  const c = { name, gs: null, errors: [], joined: null, bal: null, sum: null };
  c.s = io(`http://localhost:${PORT}`, { forceNew: true });
  c.s.on('game_state', g => { c.gs = g; });
  c.s.on('error', e => c.errors.push(e.message));
  c.s.on('room_joined', d => { c.joined = d; });
  c.s.on('balance_data', d => { c.bal = d.balance; });
  c.s.on('bank_summary', d => { c.sum = d; });
  c.join = async () => { c.joined = null; c.s.emit('join_game', { name, avatar: '🦊', password: 'ping' }); for (let i = 0; i < 40 && !c.joined && !c.errors.length; i++) await sleep(50); await sleep(150); return c.joined; };
  return c;
}
(async () => {
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await sleep(100); } }
    const bob = client('Bob'); await bob.join();
    ok(bob.gs.status === 'waiting', 'one player: still waiting');
    bob.s.emit('bank_set', { name: 'Bob', balance: 999999 }); await sleep(300);
    ok(bob.errors.some(e => /Only Chris/.test(e)), 'non-chris edit rejected');
    ok(JSON.parse(fs.readFileSync(bankFile)).bob !== 999999, 'non-chris edit did not change bank');
    const chris = client('chris'); await chris.join();
    ok(chris.gs.status === 'waiting', 'two joined: not started instantly');
    await sleep(2600);
    ok(chris.gs.status === 'playing', 'two players: auto-started within ~2s');
    chris.s.emit('bank_set', { name: 'Bob', balance: 12345 }); await sleep(400);
    const stackOf = (c, n) => { const p = c.gs.players.find(x => x.name === n); return p ? p.chips : 0; };
    ok(JSON.parse(fs.readFileSync(bankFile)).bob + stackOf(chris, 'Bob') === 12345, 'chris edit set Bob total (bank + stack) to 12345');
    ok(bob.bal === 12345 - stackOf(chris, 'Bob'), 'Bob got balance_data update');
    ok(chris.sum && chris.sum.players.find(p => p.name === 'Bob').bank === 12345 - stackOf(chris, 'Bob'), 'bank summary reflects edit');
    chris.s.emit('bank_set', { name: 'Bob', balance: -5 }); await sleep(300);
    ok(chris.errors.some(e => /0 to 100,000,000/.test(e)), 'negative amount rejected');
    chris.s.emit('bank_set', { name: '', balance: 5 }); await sleep(300);
    ok(chris.errors.some(e => /Unknown player/.test(e)), 'blank player name rejected');
    chris.s.emit('bank_set', { name: 'chris', balance: 50000 }); await sleep(300);
    ok(JSON.parse(fs.readFileSync(bankFile)).chris + stackOf(chris, 'chris') === 50000, 'chris can edit own total');
  } finally { proc.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
  console.log(fails ? `FAILED ${fails}` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
