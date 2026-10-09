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
  // R2B-5: a socket holds a seat only while it is signed in as that seat's account. Every seat on this socket whose key is not `keepKey` (null = nobody) is released
  // exactly as if the socket had disconnected (the tables' own disconnect entry point: connected false, the grace rule, no more your_cards), and the socket leaves that table's room.
  function releaseSeats(socket, keepKey) {
    let n = 0;
    if (!socket || !registry || !registry.tables) return n;
    for (const t of registry.tables.values()) {
      let seat = null;
      try { seat = t.seatBySocket(socket.id); } catch { seat = null; }
      if (!seat || (keepKey && seat.key === keepKey)) continue;
      try { t.disconnect(socket.id); n++; } catch (e) { console.error('[auth] seat release failed:', e && e.message); }
      try { socket.leave(t.id); } catch {}
    }
    return n;
  }
  // R2B-5: after a PIN change / admin PIN reset, any seat of `key` bound to a socket that is not signed in as `key` is released (the seat's socket may be gone, or signed in as someone else).
  function releaseStraySeats(key, sockets) {
    const byId = new Map(); for (const s of sockets || []) byId.set(s.id, s);
    let n = 0;
    if (!key || !registry || !registry.tables) return n;
    for (const t of registry.tables.values()) {
      let seat = null;
      try { seat = t.seatOfKey(key); } catch { seat = null; }
      if (!seat || !seat.socketId) continue;
      const sock = byId.get(seat.socketId);
      if (sock && sock.data && sock.data.acct === key) continue;
      try { t.disconnect(seat.socketId); n++; } catch (e) { console.error('[auth] stray seat release failed:', e && e.message); }
      if (sock) { try { sock.leave(t.id); } catch {} }
    }
    return n;
  }
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
  return { requireAuth, requireAdmin, signOutSockets, releaseSeats, releaseStraySeats, isAdmin, canHost };
}

module.exports = { createAuth };
