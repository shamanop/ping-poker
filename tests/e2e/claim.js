// node tests/e2e/claim.js name1 name2 ...   signs up accounts (chris is claimed as admin) (pin 4321, room password ping) on E2E_BASE
const { io } = require('socket.io-client');
const names = process.argv.slice(2);
// the admin `chris` is claimable only with the server's ADMIN_CLAIM_PASSWORD (set it in the e2e server env, pass the same value here)
const ADMIN_CLAIM = process.env.ADMIN_CLAIM_PASSWORD || 'test-admin-claim-1008';
(async () => {
  for (const n of names) {
    await new Promise(res => {
      const s = io(process.env.E2E_BASE || 'http://127.0.0.1:3580', { transports: ['websocket'], forceNew: true });
      s.on('connect', () => s.emit(n === 'chris' ? 'auth_claim' : 'auth_signup', { name: n, pin: '4321', avatar: 'a01', roomPassword: n === 'chris' ? ADMIN_CLAIM : 'ping' }));
      s.on('auth_ok', () => { console.log('claimed', n); s.close(); res(); });
      s.on('auth_error', e => { console.log('claim', n, e && e.message); s.close(); res(); }); s.on('error', e => { console.log('claim', n, 'error', e && e.message); s.close(); res(); });
      setTimeout(() => { s.close(); res(); }, 4000);
    });
  }
})();
