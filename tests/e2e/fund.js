// node tests/e2e/fund.js <amount> name1 name2 ...   signs in as chris (admin) and gives each name <amount> bank chips via admin_adjust (v2 server).
const { io } = require('socket.io-client');
const [amount, ...names] = process.argv.slice(2);
const s = io(process.env.E2E_BASE || 'http://127.0.0.1:3581', { transports: ['websocket'], forceNew: true });
let i = 0;
s.on('connect', () => s.emit('auth_login', { name: 'chris', pin: '4321' }));
s.on('auth_ok', () => next());
s.on('admin_result', r => { console.log(r.key, r.ok ? 'ok' : (r.code || r.message)); next(); });
function next() { if (i >= names.length) { s.close(); return; } s.emit('admin_adjust', { key: names[i++], delta: Number(amount), cur: 'chips', reason: 'e2e funding' }); }
setTimeout(() => { s.close(); process.exit(0); }, 15000);
