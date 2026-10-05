'use strict';
// Two scripted opponents (Rex, Sly) for the browser run + chip-conservation observer. Usage: node bots.js <expectedTotal>
const fs = require('fs'), path = require('path');
const { io } = require('/home/isabelle/.cache/node_modules/socket.io-client');
const EXPECTED = Number(process.argv[2]);
const BANK = path.join(__dirname, 'bank.json');
const OUT = fs.createWriteStream(path.join(__dirname, 'bots.log'));
const t0 = Date.now();
const log = (...a) => { const s = `[${((Date.now() - t0) / 1000).toFixed(1)}s] ` + a.join(' '); OUT.write(s + '\n'); };
const readBank = () => { for (let i = 0; i < 5; i++) { try { return JSON.parse(fs.readFileSync(BANK, 'utf8')); } catch {} } return {}; };
function mk(name, policy, observe) {
  const s = io('http://127.0.0.1:3111', { transports: ['websocket'], forceNew: true, reconnection: false });
  let lastKey = '', baseline = null, curHand = 0, lastSig = '';
  s.on('connect', () => s.emit('join_game', { name, avatar: 'x', password: 'ping' }));
  s.on('room_joined', d => log(name, 'joined', JSON.stringify(d)));
  s.on('error', e => log(name, 'ERROR', e && e.message));
  s.on('game_state', gs => {
    if (observe) {
      const sig = JSON.stringify(gs); if (sig !== lastSig) {
        lastSig = sig;
        const sum = gs.players.reduce((a, p) => a + p.chips, 0) + gs.pot;
        if (gs.status === 'playing') {
          if (gs.handNum !== curHand) { curHand = gs.handNum; baseline = sum; log('HAND', gs.handNum, 'start stacks+pot =', sum, gs.players.map(p => p.name + ':' + (p.chips + p.roundBet)).join(' ')); }
          else if (sum !== baseline) { log('CONSERVATION-BREAK in hand', gs.handNum, 'sum', sum, 'baseline', baseline); baseline = sum; }
        }
        if (gs.status === 'waiting_next') {
          const bank = Object.values(readBank()).reduce((a, b) => a + b, 0);
          const total = bank + sum;
          log('HAND-END', gs.handNum, 'bank', bank, '+ stacks', sum - gs.pot, '+ pot', gs.pot, '=', total, total === EXPECTED ? 'OK' : `MISMATCH expected ${EXPECTED}`, '| stacks', gs.players.map(p => p.name + ':' + p.chips).join(' '), '| log', JSON.stringify(gs.log.slice(-3)));
        }
      }
    }
    const idx = gs.players.findIndex(p => p.name === name);
    if (gs.status !== 'playing' || idx < 0 || gs.currentPlayerIdx !== idx) return;
    const me = gs.players[idx];
    const key = [gs.handNum, gs.street, gs.currentBet, gs.pot, me.chips].join('|'); if (key === lastKey) return; lastKey = key;
    const tc = gs.currentBet - me.roundBet, r = Math.random();
    const d = policy(gs, me, tc, r);
    setTimeout(() => s.emit('player_action', { roomId: 'POKERPING', action: d.action, amount: d.amount }), 700 + Math.random() * 500);
  });
  return s;
}
const call = (gs, me, tc) => ({ action: tc > 0 ? 'call' : 'check' });
const mixed = (gs, me, tc, r) => {
  if (tc > 0 && r < 0.2) return { action: 'fold' };
  if (r < 0.55) return call(gs, me, tc);
  if (r < 0.9) return { action: 'raise', amount: gs.currentBet + gs.bb * 3 };
  return { action: 'raise', amount: 1e9 };
};
mk('Rex', call, true);
mk('Sly', mixed, false);
process.on('SIGTERM', () => { log('bots exit'); OUT.end(() => process.exit(0)); });
setInterval(() => {}, 1000);
