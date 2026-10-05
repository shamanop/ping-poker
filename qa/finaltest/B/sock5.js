const { io } = require('/home/isabelle/.cache/node_modules/socket.io-client');
const s = io('http://127.0.0.1:3112', { transports: ['websocket'] });
let got = [];
s.onAny((e, d) => got.push(e));
s.on('connect', async () => {
  s.emit('get_bank_summary', { roomId: 'POKERPING' });
  s.emit('get_bank_summary', { roomId: 'NOPE' });
  s.emit('get_bank_summary', null);
  s.emit('get_bank_summary', { roomId: {} });
  s.emit('check_balance', { name: 'Ann' });
  await new Promise(r => setTimeout(r, 800));
  console.log('events received by non-member socket:', got);
  process.exit(0);
});
