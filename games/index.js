'use strict';
// Game registry. A module = {id, name, kind, init(ctx), handlers:{event:(socket,payload,ctx)=>...}, onDisconnect?(socket)}.
// Handlers are registered as `g:<id>:<event>` and require a signed-in socket (socket.data.acct).
const crypto = require('crypto');
const { createWallet } = require('../wallet.js');

const MODULES = ['./bender.js', './coldcall.js', './campaign.js']; // add new game modules here; poker.js (adapter) is optional and wired by server.js

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
  // ctx.money (transport/game-money.js, optional) is a factory: every module gets its OWN ctx with money bound to its id.
  const forGame = ctx.money && typeof ctx.money.forGame === 'function' ? ctx.money.forGame : null;
  delete full.money;
  const service = ctx.service; delete full.service;   // the boot sweep needs it; a module must not (ctx.money is its only way to the ledger)

  const mods = (ctx.modules || MODULES.map((m) => require(m)));
  // With ctx.money, only Bender keeps ctx.wallet (the old spend/credit path): it writes any ref and any game's house, so another module would bypass ctx.money.
  const modCtx = (m) => { if (!forGame) return full; const c = { ...full, money: forGame(m.id) }; if (m.id !== 'bender') delete c.wallet; return c; };
  const ctxOf = new Map(mods.map((m) => [m, modCtx(m)]));
  for (const m of mods) if (m.init) m.init(ctxOf.get(m));

  function guard(socket, fn) {
    return (payload) => {
      if (!acctKey(socket)) return socket.emit('error', { message: 'Sign in first', code: 'auth' });
      try { fn(payload); } catch (e) { socket.emit('error', { message: 'Server error', code: 'internal' }); }
    };
  }

  function onConnection(socket) {
    socket.on('wallet_get', guard(socket, () => socket.emit('wallet', wallet.get(acctKey(socket)))));
    // Cash is real money (Chris 10/7): no free Cash top-up. Only the admin sets Cash.
    socket.on('wallet_topup', guard(socket, () => socket.emit('error', { message: 'Cash is set by the admin', code: 'topup_off' })));
    for (const m of mods) {
      for (const [ev, fn] of Object.entries(m.handlers || {})) {
        socket.on(`g:${m.id}:${ev}`, guard(socket, (payload) => fn.call(m, socket, payload, ctxOf.get(m))));
      }
      if (m.onDisconnect) socket.on('disconnect', () => { try { m.onDisconnect(socket); } catch {} });
    }
  }

  if (ctx.io && typeof ctx.io.on === 'function') ctx.io.on('connection', onConnection);
  // { <id>: m.audit() } for the modules that have one (a throw becomes { error }), as transport/rig.js reports it.
  function audit() {
    const out = {};
    for (const m of mods) if (typeof m.audit === 'function') { try { out[m.id] = m.audit(); } catch (e) { out[m.id] = { error: String(e && e.message) }; } }
    return out;
  }

  // Boot, before the server listens (ADD-A-GAME.md section 3): each game settles or voids its own open rounds in recover(rounds, ctx),
  // then claims the ones it keeps in audit().openRounds; service.sweepEscrows voids every other escrow (also of game ids with no
  // module). A game whose recover throws does not stop the others; a game whose audit throws is not known to hold nothing, so its
  // escrows are left alone and the error is reported. -> { games: { <id>: { found, settledOrVoidedByGame, kept } }, voided, errors }
  function recover() {
    const report = { games: {}, voided: [], errors: [] };
    const claimed = new Map(), unknown = new Set();
    const err = (game, what, e) => report.errors.push({ game, what, code: (e && e.code) || 'error', message: String(e && e.message) });
    const rk = (r) => `${String(r.key).toLowerCase().trim()}|${r.cur}|${r.roundId}`;
    // recover and audit are synchronous: a thenable cannot be waited for before listen, so its game's claim is unknown (escrows left alone).
    const thenable = (v) => { const is = !!v && typeof v.then === 'function'; if (is) Promise.resolve(v).catch(() => {}); return is; };
    for (const m of mods) {
      if (service && Array.isArray(service.GAMES) && !service.GAMES.includes(m.id)) continue;  // not a money game: nothing to recover
      const mctx = ctxOf.get(m), g = report.games[m.id] = { found: 0, settledOrVoidedByGame: 0, kept: 0 };
      const rounds = () => (mctx.money ? mctx.money.openRounds() : []);
      let before = [];
      try { before = rounds(); g.found = before.length; } catch (e) { err(m.id, 'openRounds', e); }
      let async = false;
      if (typeof m.recover === 'function') {
        try { if (thenable(m.recover(before, mctx))) { async = true; err(m.id, 'recover', { code: 'async', message: 'recover() returned a thenable; it must be synchronous' }); } } catch (e) { err(m.id, 'recover', e); }
      }
      try { g.settledOrVoidedByGame = Math.max(0, before.length - rounds().length); } catch (e) { err(m.id, 'openRounds', e); }
      const set = new Set();
      claimed.set(m.id, set);
      if (async) { unknown.add(m.id); continue; }
      if (typeof m.audit !== 'function') continue;
      try {
        const a = m.audit();
        if (thenable(a)) throw Object.assign(new Error('audit() returned a thenable; it must be synchronous'), { code: 'async' });
        for (const r of (a || {}).openRounds || []) set.add(rk(r));
      } catch (e) { unknown.add(m.id); err(m.id, 'audit', e); }
    }
    if (!service || typeof service.sweepEscrows !== 'function') { report.errors.push({ game: null, what: 'sweep', code: 'no_service', message: 'ctx.service.sweepEscrows missing: escrows were not swept' }); return report; }
    const sweep = service.sweepEscrows((r) => unknown.has(r.game) || (claimed.has(r.game) && claimed.get(r.game).has(rk(r))));
    report.voided = sweep.voided;
    report.errors.push(...sweep.errors.map((e) => ({ game: null, ...e })));
    for (const r of sweep.kept) if (report.games[r.game]) report.games[r.game].kept++;
    return report;
  }

  return { wallet, modules: mods, onConnection, pushWallet, recover, audit };
};
module.exports.MODULES = MODULES;   // read by tests/game-kit.js (--all)
