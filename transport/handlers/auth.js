'use strict';
// auth_*, profile_*, pin_change, account_reset_pin, get_leaderboard (server.js:1250-1293, 1482 at 9440541).
const crypto = require('crypto');

function register(ctx, socket, on) {
  const { accounts, social, views, auth } = ctx;
  const ctxOf = () => ({ ip: String(socket.handshake.headers['x-forwarded-for'] || socket.handshake.address || '?').split(',')[0].trim(), ua: socket.handshake.headers['user-agent'] });
  const authFail = r => { console.log(`auth fail ${r.code} ip=${ctxOf().ip} ua=${String(ctxOf().ua || '').slice(0, 50)}`); socket.emit('auth_error', { code: r.code, message: r.message, ...(r.retryMs ? { retryMs: r.retryMs } : {}) }); };
  const authOk = (r, withToken) => {
    const a = r.account;
    ctx.service.ensureAccount(a.key);
    if (socket.data.acct !== a.key) auth.releaseSeats(socket, a.key);   // R2B-5: the seats of the account this socket was signed in as go with that sign-in
    socket.data.acct = a.key;
    socket.data.sessionH = r.sessionH || crypto.createHash('sha256').update(r.token).digest('hex');
    socket.emit('auth_ok', withToken ? { account: accounts.publicAccount(a), token: r.token } : { account: accounts.publicAccount(a) });
    accounts.emit('auth', socket, a.key);
    try { socket.emit('money', views.moneyView(a.key)); } catch {}
    try { socket.emit('account:stats', social.statsView(a.key)); socket.emit('achv:state', social.achvView(a.key)); } catch {}
  };

  on('auth_signup', ({ name, pin, avatar } = {}) => { const r = accounts.signup(name, pin, avatar, ctxOf()); r.ok ? authOk(r, true) : authFail(r); });
  on('auth_claim', ({ name, pin, avatar, roomPassword } = {}) => { const r = accounts.claim(name, pin, avatar, roomPassword, ctxOf()); r.ok ? authOk(r, true) : authFail(r); });
  on('auth_login', ({ name, pin } = {}) => { const r = accounts.login(name, pin, ctxOf()); r.ok ? authOk(r, true) : authFail(r); });
  on('auth_resume', ({ key, token } = {}) => { const r = accounts.resume(key, token); r.ok ? authOk(r, false) : authFail(r); });
  on('auth_logout', () => {
    if (socket.data.acct) accounts.logoutHash(socket.data.acct, socket.data.sessionH);
    socket.data.acct = null; socket.data.sessionH = null;
    auth.releaseSeats(socket, null);   // R2B-5
    socket.emit('auth_out', {});
  });

  on('profile_get', ({ key } = {}) => {
    const me = auth.requireAuth(socket); if (!me) return;
    const k = typeof key === 'string' && key ? accounts.keyOf(key) : me;
    const a = accounts.get(k);
    if (!a) { socket.emit('error', { message: 'No such player', code: 'not_found' }); return; }
    socket.emit('profile', views.profile(a, k === me));
  });
  on('profile_update', ({ avatar, prefs, display, avatarPic } = {}) => {
    const me = auth.requireAuth(socket); if (!me) return;
    const fail = (field, message) => socket.emit('profile_error', { field, message });
    let changed = false;
    if (display !== undefined) { const r = accounts.rename(me, display); if (!r.ok) fail('display', r.message); else if (r.changed) changed = true; }
    if (avatarPic !== undefined) {
      if (avatarPic && !accounts.validAvatarPic(avatarPic)) fail('avatarPic', 'That picture is not allowed. Use a JPEG, PNG or WebP under 40 KB.');
      else { accounts.setAvatarPic(me, avatarPic || null); changed = true; }
    }
    const before = accounts.get(me) && accounts.get(me).avatar;
    const a = accounts.updateProfile(me, { avatar, prefs });
    if (a.avatar !== before) changed = true;
    socket.emit('profile', views.profile(a, true));
    if (changed) ctx.announceAccount(me);
  });
  on('pin_change', ({ oldPin, newPin } = {}) => {
    const me = auth.requireAuth(socket); if (!me) return;
    const r = accounts.pinChange(me, oldPin, newPin, { ...ctxOf(), sessionH: socket.data.sessionH });
    if (!r.ok) { authFail(r); return; }
    // K6b-1: the account's other sockets are signed out at once; this one carries on, on a fresh session token
    auth.signOutSockets(ctx.socketsOf(me).filter(s => s !== socket), 'pin_changed', 'Your PIN was changed on another device. Sign in again with the new PIN.');
    auth.releaseStraySeats(me, ctx.allSockets());   // R2B-5
    socket.data.sessionH = crypto.createHash('sha256').update(r.token).digest('hex');
    socket.emit('ok', { what: 'pin' });
    socket.emit('auth_ok', { account: accounts.publicAccount(r.account), token: r.token });
  });
  on('account_reset_pin', ({ key, newPin } = {}) => {
    const me = auth.requireAuth(socket); if (!me) return;
    const r = accounts.resetPin(me, key, newPin);
    if (!r.ok) { authFail(r); return; }
    auth.signOutSockets(ctx.socketsOf(accounts.keyOf(key)), 'pin_reset', 'Your PIN was reset by the admin. Sign in again with the new PIN.');
    auth.releaseStraySeats(accounts.keyOf(key), ctx.allSockets());   // R2B-5
    socket.emit('ok', { what: 'pin_reset' });
  });
  on('get_leaderboard', () => { socket.emit('leaderboard_data', views.leaderboard(socket.data.acct)); });
  if (!ctx.production && process.env.AUTH_CLOCK_SKEW !== undefined) on('__test_skew', ({ ms } = {}) => { accounts.setSkew(ms); socket.emit('ok', { what: 'skew' }); });
}

module.exports = { register };
