'use strict';
// Game registry. A module = {id, name, kind, init(ctx), handlers:{event:(socket,payload,ctx)=>...}, onDisconnect?(socket)}.
// Handlers are registered as `g:<id>:<event>` and require a signed-in socket (socket.data.acct).
const crypto = require('crypto');
const { createWallet } = require('../wallet.js');

const MODULES = ['./bender.js', './coldcall.js']; // add new game modules here; poker.js (adapter) is optional and wired by server.js

module.exports = function games(ctx) {
  const sockets = () => (ctx.io && ctx.io.sockets && ctx.io.sockets.sockets ? [...ctx.io.sockets.sockets.values()] : []);
  const acctKey = (s) => { const a = s.data && s.data.acct; return a ? String(typeof a === 'object' ? a.key : a) : null; };

  const pending = new Set();
  function pushWallet(key) {
    if (pending.has(key)) return;
    pending.add(key);
    queueMicrotask(() => {
      pending.delete(key);
      const v = wallet.get(key);
      for (const s of sockets()) if (acctKey(s) === key) s.emit('wallet', v);
    });
  }

  const wallet = ctx.wallet || createWallet({ ledger: ctx.ledger, chips: ctx.chips, now: ctx.now, onChange: pushWallet, logPlay: false });
  const full = { ...ctx, wallet, now: ctx.now || Date.now, rng: ctx.rng || undefined };
  if (!full.rng) delete full.rng;

  const mods = (ctx.modules || MODULES.map((m) => require(m)));
  for (const m of mods) if (m.init) m.init(full);

  function guard(socket, fn) {
    return (payload) => {
      if (!acctKey(socket)) return socket.emit('error', { message: 'Sign in first', code: 'auth' });
      try { fn(payload); } catch (e) { socket.emit('error', { message: 'Server error', code: 'internal' }); }
    };
  }

  function onConnection(socket) {
    socket.on('wallet_get', guard(socket, () => socket.emit('wallet', wallet.get(acctKey(socket)))));
    socket.on('wallet_topup', guard(socket, () => {
      try { wallet.topUp(acctKey(socket)); }
      catch (e) {
        if (e.code === 'cooldown' || e.code === 'not_needed') return socket.emit('error', { message: e.message, code: e.code, retryMs: e.retryMs });
        throw e;
      }
      pushWallet(acctKey(socket));
    }));
    for (const m of mods) {
      for (const [ev, fn] of Object.entries(m.handlers || {})) {
        socket.on(`g:${m.id}:${ev}`, guard(socket, (payload) => fn.call(m, socket, payload, full)));
      }
      if (m.onDisconnect) socket.on('disconnect', () => { try { m.onDisconnect(socket); } catch {} });
    }
  }

  if (ctx.io && typeof ctx.io.on === 'function') ctx.io.on('connection', onConnection);
  return { wallet, modules: mods, onConnection, pushWallet };
};
