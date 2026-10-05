const { io } = require('/home/isabelle/.cache/node_modules/socket.io-client');
for (const [n,a] of [['Dolly','🦊'],['Vic','🐻']]) {
  let roomId='';
  const s = io('http://localhost:4461', { forceNew: true });
  s.on('connect', () => s.emit('join_game', { name: n, avatar: a, password: 'ping' }));
  s.on('room_joined', d => roomId=d.roomId);
  s.on('game_state', g => {
    if (g.status==='playing' && g.players[g.currentPlayerIdx]?.name === n)
      setTimeout(()=>s.emit('player_action', { roomId, action: Math.random()<.15?'fold':'call' }), 700);
  });
  s.on('error', e => {});
}
setTimeout(()=>process.exit(0), 900000);
