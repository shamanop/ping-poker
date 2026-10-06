// node tests/e2e/sweep/audit.js  -> prints the server's own __audit (RIG=1) as JSON on stdout. E2E_BASE selects the server.
const { io } = require('socket.io-client');
const s = io(process.env.E2E_BASE || 'http://127.0.0.1:4700', { transports: ['websocket'], forceNew: true });
s.on('connect', () => s.emit('__audit', {}));
s.on('__audit', (a) => { console.log(JSON.stringify(a)); s.close(); process.exit(0); });
setTimeout(() => { console.log('{"error":"timeout"}'); process.exit(1); }, 8000);
