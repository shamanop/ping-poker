'use strict';
// Browser-leg helper: two house tables (one chips, one Play $) each hosted and seated by a bot that calls / checks and now and then raises.
// Usage: node qa/port-recap/bots.js <port> <outfile.json>   (the server runs with RIG=1 SIGNUP_PLAY_CENTS=1000000)
const fs = require('fs');
const { io } = require('socket.io-client');
const port = Number(process.argv[2]), out = process.argv[3];
const tables = {};
function bot(name, settings, label) {
  const s = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true });
  let gs = null, tid = null, last = '', cards = [];
  s.on('game_state', g => { gs = g; act(); });
  s.on('your_cards', d => { cards = d.cards; });
  s.on('error', e => console.error(name, 'error', JSON.stringify(e)));
  function act() {
    if (!gs || !tid || gs.status !== 'playing' || gs.paused) return;
    const me = gs.players.findIndex(p => p.name === name);
    if (me < 0 || gs.currentPlayerIdx !== me) return;
    const sig = `${gs.handNum}|${gs.street}|${gs.currentBet}|${gs.pot}`; if (sig === last) return; last = sig;
    const toCall = gs.currentBet - gs.players[me].roundBet;
    const n = gs.handNum || 0;
    const raise = gs.street === 'preflop' && toCall <= gs.bb && n % 3 === 1 && gs.players[me].chips > gs.bb * 6;
    setTimeout(() => s.emit('player_action', raise ? { roomId: tid, action: 'raise', amount: gs.bb * 4 } : { roomId: tid, action: toCall > 0 ? 'call' : 'check' }), 350);
  }
  s.on('connect', () => s.emit('auth_signup', { name, pin: '1234', avatar: 'a0' + (label === 'chips' ? 3 : 4) }));
  s.on('auth_ok', () => s.emit('table_create', { settings }));
  s.on('table_created', d => { tid = d.table.id; tables[label] = { id: tid, nightId: d.table.nightId, host: name }; s.emit('table_join', { tableId: tid, buyIn: settings.buyIn.default }); });
  s.on('table_joined', () => { fs.writeFileSync(out, JSON.stringify(tables)); });
}
bot('Bo', { name: 'Friday chips', mode: 'chips', unit: 'chips', buyIn: { min: 500, max: 8000, default: 3000 }, blinds: { sb: 25, bb: 50 }, seats: 6, actionTimerSec: 0, rebuys: true, isPrivate: false, autoStart: true }, 'chips');
bot('Cy', { name: 'Friday Play $', mode: 'play', unit: 'cents', buyIn: { min: 2000, max: 100000, default: 20000 }, blinds: { sb: 25, bb: 50 }, seats: 6, actionTimerSec: 0, rebuys: true, isPrivate: false, autoStart: true }, 'play');
