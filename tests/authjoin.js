// table_join needs a signed-in account: sign up / log in / claim as `name`, then sit at POKERPING (v2: join_game is deleted).
const once = (s, evs, ms = 3000) => new Promise(res => { const t = setTimeout(() => done(['timeout']), ms); const hs = evs.map(e => [e, d => done([e, d])]); function done(r) { clearTimeout(t); hs.forEach(([e, h]) => s.off(e, h)); res(r); } hs.forEach(([e, h]) => s.on(e, h)); });
// The admin account `chris` is claimable only with ADMIN_CLAIM_PASSWORD (never the room word). Servers spawned by tests that load this file inherit it from process.env.
const ADMIN_CLAIM = process.env.ADMIN_CLAIM_PASSWORD || (process.env.ADMIN_CLAIM_PASSWORD = 'test-admin-claim-1008');
async function authAs(s, name, pin = '1234') {
  const claimWord = String(name).trim().toLowerCase() === 'chris' ? ADMIN_CLAIM : 'ping';
  for (const [ev, extra] of [['auth_login', {}], ['auth_signup', { avatar: 'a01' }], ['auth_claim', { avatar: 'a01', roomPassword: claimWord }]]) {
    const w = once(s, ['auth_ok', 'auth_error']);
    s.emit(ev, { name, pin, ...extra });
    const [e] = await w;
    if (e === 'auth_ok') return true;
  }
  return false;
}
async function authJoin(s, payload) { await authAs(s, payload.name); s.emit('table_join', { tableId: 'POKERPING' }); }
module.exports = { authAs, authJoin, ADMIN_CLAIM };
