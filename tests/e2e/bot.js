// node tests/e2e/bot.js <name> [table=POKERPING] [buyIn=2000]   signs in (pin 4321), sits, and calls/checks every turn. Runs until killed.
const { io } = require('socket.io-client');
const [name, table = 'POKERPING', buyIn = '2000'] = process.argv.slice(2);
const s = io(process.env.E2E_BASE || 'http://127.0.0.1:3580', { transports: ['websocket'], forceNew: true });
let room = null, me = null;
s.on('connect', () => s.emit('auth_login', { name, pin: '4321' }));
s.on('auth_ok', () => s.emit('table_join', { tableId: table, buyIn: Number(buyIn) }));
s.on('table_joined', t => { room = t.roomId || t.tableId || table; });
s.on('game_state', gs => {
  if (!room) room = gs.roomId || table;
  const i = gs.players.findIndex(p => p.name === name);
  if (i < 0 || gs.currentPlayerIdx !== i) return;
  const toCall = gs.currentBet - (gs.players[i].roundBet || 0);
  setTimeout(() => s.emit('player_action', { roomId: room, action: toCall > 0 ? 'call' : 'check' }), 400);
});
s.on('error', e => console.log('bot error', e && e.message));
console.log('bot', name, 'up');
