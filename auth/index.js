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
  const isAdmin = key => accounts.isAdmin(key);
  const canHost = (table, key) => registry.canHost(table, key);
  return { requireAuth, requireAdmin, isAdmin, canHost };
}

module.exports = { createAuth };
