// Same-name rejoin checks. Spawns a throwaway server on PORT 4777 with temp bank/ledger.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { io } = require(process.env.SIO_CLIENT || '/home/isabelle/.cache/node_modules/socket.io-client');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pprj-'));
const PORT = 4777, ROOT = path.join(__dirname, '..');
const proc = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), BANK_FILE: path.join(dir, 'bank.json'), LEDGER_FILE: path.join(dir, 'ledger.json') } });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
function client(name) {
  const c = { name, gs: null, errors: [], joined: null, cards: null };
  c.s = io(`http://localhost:${PORT}`, { forceNew: true });
  c.s.on('game_state', g => { c.gs = g; });
  c.s.on('error', e => c.errors.push(e.message));
  c.s.on('room_joined', d => { c.joined = d; });
  c.s.on('your_cards', d => { c.cards = d.cards; });
  c.join = async () => { c.joined = null; c.s.emit('join_game', { name, avatar: '🦊', password: 'ping' }); for (let i = 0; i < 40 && !c.joined && !c.errors.length; i++) await sleep(50); await sleep(150); return c.joined; };
  return c;
}
const seats = (c, n) => c.gs.players.filter(p => p.name === n);
(async () => {
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await sleep(100); } }
    const a = client('Ann'), b = client('Bo'), c = client('Cy');
    await a.join(); await b.join(); await c.join();
    // 1. drop and rejoin while waiting
    b.s.disconnect(); await sleep(300);
    ok(a.gs.players.length === 2, 'waiting: dropped player leaves table');
    const b2 = client('bo'); const r1 = await b2.join();
    ok(r1 && seats(a, 'Bo').length + seats(a, 'bo').length === 1 && a.gs.players.length === 3, 'waiting: same name (any case) rejoins, one seat');
    ok(a.gs.players.find(p => p.name.toLowerCase() === 'bo').chips === 1500, 'waiting: rejoin gets prior stack (1500)');
    // 2. refresh/takeover while connected
    const a2 = client('Ann'); await a2.join();
    ok(a.errors.some(e => /taken over/.test(e)), 'takeover: old connection told');
    ok(a2.gs.players.filter(p => p.name === 'Ann').length === 1 && a2.gs.players.length === 3, 'takeover: still one Ann seat');
    ok(a2.gs.hostName === 'Ann', 'takeover: host kept');
    // 3. start, drop mid-hand, rejoin
    a2.s.emit('start_game', { roomId: 'POKERPING', blindInterval: 0 }); await sleep(600);
    ok(a2.gs.status === 'playing', 'hand started');
    c.s.disconnect(); await sleep(300);
    const zc = a2.gs.players.find(p => p.name === 'Cy');
    ok(zc && !zc.connected, 'mid-hand: dropped player marked offline');
    const c2 = client('Cy'); const r3 = await c2.join();
    ok(r3, 'mid-hand: rejoin accepted (' + JSON.stringify(c2.errors) + ')');
    ok(a2.gs.players.filter(p => p.name === 'Cy').length === 1 && a2.gs.players.length === 3, 'mid-hand: one Cy seat, 3 players');
    const nc = a2.gs.players.find(p => p.name === 'Cy');
    ok(nc.connected && nc.chips > 0, 'mid-hand: Cy online with chips ' + nc.chips);
    ok(c2.gs.players[c2.joined.playerIdx].name === 'Cy', 'mid-hand: playerIdx points at Cy');
    // 4. next hand: Cy dealt in; bank + table chips conserved
    const hn = a2.gs.handNum; let dealt = false;
    // everybody checks/calls around
    const all = [a2, b2, c2];
    const t0 = Date.now();
    while (Date.now() - t0 < 90000) {
      for (const cl of all) {
        const g = cl.gs; if (!g || g.status !== 'playing') continue;
        const my = g.players.findIndex(p => p.name.toLowerCase() === cl.name.toLowerCase());
        if (g.currentPlayerIdx === my) cl.s.emit('player_action', { roomId: 'POKERPING', action: g.currentBet - g.players[my].roundBet > 0 ? 'call' : 'check' });
      }
      const g = a2.gs;
      if (g.handNum > hn && g.players.find(p => p.name === 'Cy').cardCount > 0) { dealt = true; break; }
      await sleep(250);
    }
    ok(dealt, 'next hand: rejoined player is dealt in');
    const bank = JSON.parse(fs.readFileSync(path.join(dir, 'bank.json'), 'utf8'));
    const bal = Object.values(bank).reduce((x, y) => x + y, 0);
    const table = a2.gs.players.reduce((x, p) => x + p.chips, 0) + a2.gs.pot;
    ok(bal + table === 30000, `conservation: bank ${bal} + table ${table} = 30000`);
  } catch (e) { console.log('ERROR', e); fails++; }
  finally { proc.kill('SIGKILL'); console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0); }
})();
