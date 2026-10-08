'use strict';
// Socket layer: the `out` interface the tables talk through, the push helpers (money, wallet, bank summary, lobby) and
// io.on('connection'). No rules live here (contract section 1): handlers parse, authorise and call a Table / registry / service.

const HANDLERS = ['auth', 'lobby', 'seat', 'host', 'social', 'admin', 'bank', 'recap'].map(n => require('./handlers/' + n));

function createTransport(ctx) {
  const { io, views } = ctx;
  const allSockets = () => [...io.sockets.sockets.values()];
  const socketsOf = key => allSockets().filter(s => s.data && s.data.acct === key);
  const inRoom = (t, key) => socketsOf(key).filter(s => s.rooms.has(t.id));
  const sockOfSeat = seat => (seat && seat.socketId ? io.sockets.sockets.get(seat.socketId) || null : null);

  // ---- pushes --------------------------------------------------------------------------------------------------
  function pushMoney(key) { if (!key) return; let v = null; for (const s of socketsOf(key)) { v = v || views.moneyView(key); s.emit('money', v); } }
  function pushWallet(key) { if (ctx.games && ctx.games.pushWallet) ctx.games.pushWallet(key); }
  let bankTimer = null;
  function pushBank() {
    if (bankTimer) return;
    bankTimer = setTimeout(() => {
      bankTimer = null;
      for (const t of ctx.registry.tables.values()) if (t.players().some(s => s.connected)) { try { io.to(t.id).emit('bank_summary', views.bankSummary(t.id)); } catch (e) { console.error('[v2] bank push failed:', e && e.message); } }
    }, 250);
    if (bankTimer.unref) bankTimer.unref();
  }
  // Called by the money port after every write, and by anything that writes money outside it (admin, games).
  function afterWrite(keys) { for (const k of keys || []) { pushMoney(k); pushWallet(k); } pushBank(); }
  function pushLobby() {
    const room = io.sockets.adapter.rooms.get('lobby');
    if (!room) return;
    for (const sid of room) { const s = io.sockets.sockets.get(sid); if (s && s.data.acct) s.emit('lobby_tables', { tables: ctx.registry.listFor(s.data.acct) }); }
  }
  function announceAccount(key) {
    const a = ctx.accounts.get(key);
    if (!a) return;
    const view = { key, display: a.display, avatar: a.avatar, pic: ctx.accounts.picUrl(a) };
    for (const s of socketsOf(key)) s.emit('self_changed', { ...view, account: ctx.accounts.publicAccount(a) });
    for (const t of ctx.registry.tables.values()) if (t.seatOfKey(key)) { out.event(t, 'room', {}); out.state(t); }
    ctx.registry.pushLobby();
    io.emit('account_changed', view);
  }

  // ---- table events ---------------------------------------------------------------------------------------------
  function tableEvent(t, kind, extra) { io.to(t.id).emit('table_event', { tableId: t.id, kind, ...(extra || {}) }); }

  function settleUp(t, reason) {
    if (reason === 'shutdown') return;
    const payload = ctx.registry.nightPayload(t), who = ctx.registry.participants(t);
    for (const s of allSockets()) if (s.data && s.data.acct && who.has(s.data.acct)) s.emit('settle_up', payload);
  }

  const out = {
    state(t) {
      for (const s of t.players()) {
        const sock = sockOfSeat(s);
        if (!sock || !s.connected) continue;
        sock.emit('game_state', views.gameState(t, s.key));
        sock.emit('your_cards', views.yourCards(t, s));
      }
    },
    event(t, kind, data, toKey) {
      data = data || {};
      switch (kind) {
        case 'joined': {
          const seat = t.seatOfKey(data.key), sock = sockOfSeat(seat);
          t.emptySince = null;
          if (!sock) return;
          sock.join(t.id);
          sock.emit('table_joined', { tableId: t.id, playerIdx: t.denseIndex(data.key), stack: data.stack, table: views.publicTable(t), you: { key: data.key, display: views.nameOf(data.key) } });
          return;
        }
        case 'rebuy': for (const s of inRoom(t, data.key)) { if (t.mode === 'chips') s.emit('balance_update', { balance: views.bankOf(data.key) }); } return;
        case 'left':
          for (const s of inRoom(t, toKey || data.key)) { s.emit('table_left', { tableId: t.id, cashedOut: data.cashedOut, ...(data.reason && data.reason !== 'leave' ? { reason: data.reason } : {}) }); s.leave(t.id); }
          return;
        case 'room': io.to(t.id).emit('room_update', views.roomUpdate(t)); return;
        case 'money': for (const k of data.keys || []) { pushMoney(k); pushWallet(k); } pushBank(); return;
        case 'table_event': {
          const x = { ...data }; const k = x.kind; delete x.kind;
          if (k === 'paused' || k === 'resumed') { x.paused = k === 'paused'; x.by = t.pausedBy || 'server'; x.table = views.publicTable(t); }
          tableEvent(t, k, x); return;
        }
        case 'taken_over': { const s = io.sockets.sockets.get(data.socketId); if (s) { s.emit('error', { message: 'Your seat was taken over by another session', code: 'taken_over' }); s.leave(t.id); } return; }
        case 'blinds_up': io.to(t.id).emit('blinds_up', { level: data.level, sb: data.sb, bb: data.bb, ...views.modeFields(t) }); return;
        case 'hand_start': return;
        case 'hand_end': if (data.result) io.to(t.id).emit('showdown_result', views.showdownResult(data.result)); return;
        case 'bust': { const seat = t.seatOfKey(data.key); for (const s of inRoom(t, data.key)) s.emit('bust_out', views.bustOut(t, seat || { key: data.key, fund: t.cur })); return; }
        case 'void': io.to(t.id).emit('error', { message: 'Hand voided', code: 'hand_void' }); tableEvent(t, 'void', {}); return;
        case 'night_end': settleUp(t, data.reason); io.in(t.id).socketsLeave(t.id); return;
        default: return;
      }
    },
  };

  // ---- connections -----------------------------------------------------------------------------------------------
  function onConnection(socket) {
    const on = (ev, fn) => ctx.safe.onEvent(socket, ev, fn);
    for (const h of HANDLERS) h.register(ctx, socket, on);
    if (ctx.rig) ctx.rig.register(socket, on);
    socket.on('disconnect', () => {
      for (const t of ctx.registry.tables.values()) {
        if (!t.seatBySocket(socket.id)) continue;
        try { t.disconnect(socket.id); } catch (e) { ctx.safe.onError(e, 'disconnect', t); }
        break;
      }
    });
  }
  function start() { io.on('connection', onConnection); }

  const helpers = { out, pushMoney, pushWallet, pushBank, pushLobby, afterWrite, announceAccount, tableEvent, socketsOf, inRoom, allSockets, start, onConnection };
  Object.assign(ctx, helpers);
  return helpers;
}

module.exports = { createTransport };
