// join_game now needs a signed-in account: sign up / log in / claim as `name`, then send join_game.
const once = (s, evs, ms = 3000) => new Promise(res => { const t = setTimeout(() => done(['timeout']), ms); const hs = evs.map(e => [e, d => done([e, d])]); function done(r) { clearTimeout(t); hs.forEach(([e, h]) => s.off(e, h)); res(r); } hs.forEach(([e, h]) => s.on(e, h)); });
async function authAs(s, name, pin = '1234') {
  for (const [ev, extra] of [['auth_login', {}], ['auth_signup', { avatar: 'a01' }], ['auth_claim', { avatar: 'a01', roomPassword: 'ping' }]]) {
    const w = once(s, ['auth_ok', 'auth_error']);
    s.emit(ev, { name, pin, ...extra });
    const [e] = await w;
    if (e === 'auth_ok') return true;
  }
  return false;
}
async function authJoin(s, payload) { await authAs(s, payload.name); s.emit('join_game', payload); }
module.exports = { authAs, authJoin };
