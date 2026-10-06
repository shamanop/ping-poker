'use strict';
// table_join, table_leave, sit_out, show_cards, rebuy, player_action, preselect. Parse, authorise, call the Table.
const { TableError } = require('../../tables/errors');

const ACTIONS = new Set(['fold', 'check', 'call', 'raise']);

function register(ctx, socket, on) {
  const { registry, views, auth, social } = ctx;
  const tableOf = id => { const t = registry.get(id); if (!t) throw new TableError('not_found'); return t; };
  const seatAt = (t, key) => { const s = t.seatOfKey(key); if (!s) throw new TableError('no_seat'); return s; };

  on('table_join', ({ tableId, buyIn, seat, fund } = {}) => {
    const key = auth.requireAuth(socket); if (!key) return;
    const t = tableOf(tableId);
    const amount = buyIn === undefined || buyIn === null ? t.buyIn.default : buyIn;
    t.sit(key, { amount, fund, seat: Number.isInteger(seat) ? seat : undefined, socketId: socket.id });
    try { social.onJoin(socket, { players: t.players().filter(s => s.connected).length }); } catch {}
  });

  on('table_leave', ({ tableId } = {}) => {
    const key = auth.requireAuth(socket); if (!key) return;
    const t = tableOf(tableId);
    if (!t.seatOfKey(key)) { socket.emit('table_left', { tableId: t.id, cashedOut: 0 }); return; }
    t.leave(key, 'leave');
  });

  on('sit_out', ({ roomId } = {}) => {
    const key = auth.requireAuth(socket); if (!key) return;
    const t = tableOf(roomId);
    seatAt(t, key);
    t.sitOut(key);
  });

  on('show_cards', ({ which, roomId } = {}) => {
    const key = auth.requireAuth(socket); if (!key) return;
    let t = roomId ? registry.get(roomId) : null;
    if (!t || !t.seatOfKey(key)) { const r = registry.seatOf(key); t = r ? registry.tables.get(r.tableId) : null; }
    const seat = t && t.seatOfKey(key);
    if (!seat || t.phase !== 'between' || !seat.dealt || !t.hand) return;
    const hole = t.hand.seats[seat.seat] && t.hand.seats[seat.seat].hole;
    if (!hole || hole.length !== 2) return;
    const slots = which === 'both' ? [0, 1] : (which === 0 || which === 1) ? [which] : [];
    if (!slots.length) return;
    if (t.shownHand !== t.handNo) { t.shown = {}; t.shownHand = t.handNo; }
    const rec = t.shown[key] || [false, false];
    for (const i of slots) rec[i] = true;
    t.shown[key] = rec;
    ctx.io.to(t.id).emit('cards_shown', { handNum: t.handNo - (t.nightHand0 || 0), name: views.nameOf(key), cards: hole.map((c, i) => (rec[i] ? c : null)) });
    t.pushLog(`${views.nameOf(key)} shows ${rec[0] && rec[1] ? 'both cards' : 'one card'}`);
  });

  on('rebuy', ({ roomId, tableId, amount, fund } = {}) => {
    const key = auth.requireAuth(socket); if (!key) return;
    tableOf(roomId || tableId).rebuy(key, { amount, fund });
  });

  on('player_action', ({ roomId, action, amount, to } = {}) => {
    const key = auth.requireAuth(socket); if (!key) return;
    const t = tableOf(roomId);
    const seat = seatAt(t, key);
    if (!t.handLive() || t.phase !== 'betting') throw new TableError('no_hand', {}, 'No hand in progress');
    if (t.paused) throw new TableError('paused', {}, 'Table is paused');
    if (!ACTIONS.has(action)) throw new TableError('bad_request', { field: 'action' }, 'Invalid action');
    t.act(key, { type: action, to: action === 'raise' ? (amount !== undefined ? amount : to) : undefined });
    void seat;
  });

  on('preselect', ({ roomId, mode, kind, amount } = {}) => {
    const key = auth.requireAuth(socket); if (!key) return;
    const t = tableOf(roomId);
    seatAt(t, key);
    t.preselect(key, mode === undefined ? kind : mode, typeof amount === 'number' ? amount : NaN);
  });
}

module.exports = { register };
