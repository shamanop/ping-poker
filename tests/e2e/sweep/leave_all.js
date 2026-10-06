// node leave_all.js [names...]  -> every named account (default: all seated keys) logs in (pin 4321) and leaves the table it sits at (cash-out). Uses __audit to find seats.
const { io } = require('socket.io-client'); const base = process.env.E2E_BASE || 'http://127.0.0.1:4700';
const mk = () => io(base, { transports: ['websocket'], forceNew: true });
const a0 = mk(); a0.on('connect', () => a0.emit('__audit', {}));
a0.on('__audit', async (a) => {
  a0.close(); const want = process.argv.slice(2); const seats = [];
  for (const r of a.rooms) for (const p of r.players) if (!want.length || want.includes(p.key)) seats.push([p.key, r.id]);
  for (const [key, tid] of seats) await new Promise(res => { const s = mk(); const t = setTimeout(() => { s.close(); res(); }, 4000);
    s.on('connect', () => s.emit('auth_login', { name: key, pin: '4321' })); s.on('auth_ok', () => s.emit('table_leave', { tableId: tid }));
    s.on('table_left', () => { clearTimeout(t); s.close(); res(); }); s.on('auth_error', () => { clearTimeout(t); s.close(); res(); }); });
  console.log('left', seats.length); process.exit(0);
});
setTimeout(() => process.exit(1), 60000);
