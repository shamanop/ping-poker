// node tests/e2e/bot.js <name> [table=POKERPING] [buyIn=2000]   signs in (pin 4321), sits, and calls/checks every turn. Runs until killed.
const { io } = require('socket.io-client');
const [name, table = 'POKERPING', buyIn = '2000'] = process.argv.slice(2);
const s = io(process.env.E2E_BASE || 'http://127.0.0.1:3580', { transports: ['websocket'], forceNew: true });
let room = null, me = null, bot_rebuying = false;
s.on('connect', () => s.emit('auth_login', { name, pin: '4321' }));
s.on('auth_ok', () => s.emit('table_join', { tableId: table, buyIn: Number(buyIn) }));
s.on('table_joined', t => { room = t.roomId || t.tableId || table; });
s.on('game_state', gs => {
  if (!room) room = gs.roomId || table;
  const i = gs.players.findIndex(p => p.name === name);
  if (i >= 0 && gs.players[i].chips === 0 && gs.status !== 'playing' && !bot_rebuying) { bot_rebuying = true; s.emit('rebuy', { roomId: room, amount: Number(buyIn) }); setTimeout(() => { bot_rebuying = false; }, 3000); }   // a busted bot buys back in so the next test still has an opponent
  if (i < 0 || gs.currentPlayerIdx !== i) return;
  const toCall = gs.currentBet - (gs.players[i].roundBet || 0);
  setTimeout(() => s.emit('player_action', { roomId: room, action: toCall > 0 ? 'call' : 'check' }), 400);
});
s.on('error', e => console.log('bot error', e && e.message));
console.log('bot', name, 'up'); s.onAny((ev, d) => { if (ev === 'error') console.log('bot error event', JSON.stringify(d)); });
// leave the table when stopped (one seat per account on the v2 server), then exit
process.on('SIGTERM', () => { s.emit('table_leave', { tableId: room || table }); setTimeout(() => process.exit(0), 500); });
