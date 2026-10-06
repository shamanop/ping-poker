// node end_tables.js [name=chris]  -> ends every open non-permanent table the account hosts (frees the 5-open-tables-per-host limit between proofs).
const { io } = require('socket.io-client'); const s = io(process.env.E2E_BASE || 'http://127.0.0.1:4700', { transports: ['websocket'], forceNew: true });
s.on('connect', () => s.emit('auth_login', { name: process.argv[2] || 'chris', pin: '4321' }));
s.on('auth_ok', () => s.emit('tables_mine', {}));
s.on('tables_mine', (r) => { const l = (r && (r.tables || r)) || []; let n = 0; for (const t of (Array.isArray(l) ? l : [])) if (!t.permanent && t.id !== 'POKERPING' && t.state !== 'ended' && t.hostKey !== undefined ? true : (!t.permanent && t.id !== 'POKERPING' && t.state !== 'ended')) { s.emit('table_end_night', { tableId: t.id }); n++; }
  setTimeout(() => { console.log('ended', n); process.exit(0); }, 1500); });
setTimeout(() => process.exit(1), 15000);
