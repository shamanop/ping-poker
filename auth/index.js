'use strict';
// Identity and permission checks. Identity is socket.data.acct (the account key) only, never a display name.
// accounts.js stays at the repo root and is wrapped, not edited.

function createAuth({ accounts, registry }) {
  // A signed-in key, or null after telling the socket (contract section 5: error { code: 'auth' }).
  function requireAuth(socket) {
    const key = socket.data && socket.data.acct;
    if (!key) { socket.emit('error', { message: 'Sign in first', code: 'auth' }); return null; }
    return key;
  }
  // Admin only. Answers on admin_result (the admin console reads that event), like the old adminOnly().
  function requireAdmin(socket) {
    const key = socket.data && socket.data.acct;
    if (key && accounts.isAdmin(key)) return key;
    socket.emit('admin_result', { ok: false, code: 'auth', message: 'Admin only' });
    return null;
  }
  // K6b-1: sign these sockets out NOW (a PIN change / reset must not leave an old socket holding the account). The socket loses its identity first, then a seat it holds
  // follows the normal disconnect rule (the hand is not voided; the stack goes back by the grace path), then it leaves the table rooms and gets ONE auth_out.
  function signOutSockets(sockets, code, message) {
    let n = 0;
    for (const socket of sockets || []) {
      if (!socket || !socket.data || !socket.data.acct) continue;
      socket.data.acct = null; socket.data.sessionH = null; n++;
      if (registry && registry.tables) {
        for (const t of registry.tables.values()) {
          try { if (t.seatBySocket(socket.id)) t.disconnect(socket.id); } catch (e) { console.error('[auth] sign-out disconnect failed:', e && e.message); }
          try { socket.leave(t.id); } catch {}
        }
      }
      socket.emit('auth_out', { code, message });
    }
    return n;
  }
  const isAdmin = key => accounts.isAdmin(key);
  const canHost = (table, key) => registry.canHost(table, key);
  return { requireAuth, requireAdmin, signOutSockets, isAdmin, canHost };
}

module.exports = { createAuth };
