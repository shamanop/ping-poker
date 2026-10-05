const { io } = require('/home/isabelle/.cache/node_modules/socket.io-client');
const s = io(process.argv[2], { transports: ['websocket'], timeout: 8000 });
s.on('connect', () => { console.log('ws connected', s.id); s.close(); process.exit(0); });
s.on('connect_error', e => { console.log('ws error', e.message); process.exit(1); });
setTimeout(() => { console.log('timeout'); process.exit(2); }, 10000);
