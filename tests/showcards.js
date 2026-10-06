// Show cards works on created tables (not only the legacy room). Throwaway server, port 4881.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { io } = require(process.env.SIO_CLIENT || '/home/isabelle/.cache/node_modules/socket.io-client');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppsc-'));
const PORT = Number(process.env.TEST_PORT || 4881), ROOT = path.join(__dirname, '..');
const env = { ...process.env, PORT: String(PORT), BANK_FILE: path.join(dir, 'bank.json'), LEDGER_FILE: path.join(dir, 'ledger.json'), ACCOUNTS_FILE: path.join(dir, 'acc.json'), TABLES_FILE: path.join(dir, 'tables.json'), WALLET_FILE: path.join(dir, 'wallet.json'), AUTO_START_MS: '500', HAND_DELAY_MS: '8000' };
const proc = spawn('node', ['server.js'], { cwd: ROOT, env, stdio: 'ignore' });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const cl = () => { const c = { ev: [] }; c.s = io(`http://localhost:${PORT}`, { forceNew: true }); c.s.onAny((e, d) => c.ev.push([e, d])); c.last = e => { const h = c.ev.filter(x => x[0] === e); return h.length ? h[h.length - 1][1] : undefined; }; return c; };
(async () => {
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await sleep(100); } }
    const a = cl(), b = cl(); await sleep(300);
    a.s.emit('auth_signup', { name: 'Alice', pin: '1234', avatar: 'x' });
    b.s.emit('auth_signup', { name: 'Bob', pin: '1234', avatar: 'x' }); await sleep(400);
    a.s.emit('table_create', { settings: { name: 'Show night', mode: 'play', unit: 'cents', buyIn: { min: 500, max: 50000, default: 2000 }, blinds: { sb: 25, bb: 50 } } }); await sleep(400);
    const id = a.last('table_created').table.id;
    a.s.emit('table_join', { tableId: id, buyIn: 2000 }); b.s.emit('table_join', { tableId: id, buyIn: 2000 }); await sleep(1500);
    let gs = a.last('game_state'); ok(gs && gs.status === 'playing', 'hand dealt on created table');
    // whoever is to act folds; the hand ends
    for (let i = 0; i < 20 && a.last('game_state').status === 'playing'; i++) {
      gs = a.last('game_state'); const actor = gs.players[gs.currentPlayerIdx ?? gs.actionIdx]?.name;
      (actor === 'Bob' ? b : a).s.emit('player_action', { roomId: id, action: 'fold' }); await sleep(300);
    }
    ok(a.last('game_state').status === 'waiting_next', 'hand over, waiting for next');
    const mine = a.last('your_cards').cards; b.ev.length = 0;
    a.s.emit('show_cards', { roomId: id, which: 0 }); await sleep(300);
    let cs = b.last('cards_shown'); ok(cs && cs.name === 'Alice' && cs.cards[0] && cs.cards[0].rank === mine[0].rank && cs.cards[1] === null, 'Bob sees Alice show her left card');
    b.ev.length = 0; a.s.emit('show_cards', { which: 'both' }); await sleep(300);
    cs = b.last('cards_shown'); ok(cs && cs.cards[0] && cs.cards[1], 'show both works without a roomId too');
  } finally { proc.kill(); setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} process.exit(fails ? 1 : 0); }, 400); }
  console.log(fails ? `FAILED ${fails}` : 'ALL PASS');
})();
