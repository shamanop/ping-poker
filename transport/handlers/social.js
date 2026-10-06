'use strict';
// chat_message, emote, throw_item, drop_sticker (server.js:1690-1737 at 9440541). The sender must hold a seat at that table.
const EMOTE_IDS = ['thumbs', 'laugh', 'mindblown', 'sweat', 'clap', 'tilt'];

function register(ctx, socket, on) {
  const { registry, auth, views, io, social } = ctx;
  let lastEmoteAt = 0;
  // table + seat of the caller, or null (silently: nothing to say to a spectator)
  const seated = roomId => {
    const key = auth.requireAuth(socket); if (!key) return null;
    const t = registry.get(roomId); const seat = t && t.seatOfKey(key);
    return seat ? { t, seat, key } : null;
  };

  on('drop_sticker', ({ roomId, emoji } = {}) => {
    const s = seated(roomId); if (!s) return;
    try { social.onAction(socket, 'sticker'); } catch {}
    io.to(s.t.id).emit('sticker_dropped', { emoji: String(emoji || '').slice(0, 8), fromName: views.nameOf(s.key) });
  });
  on('emote', ({ roomId, id } = {}) => {
    const s = seated(roomId); if (!s) return;
    if (typeof id !== 'string' || !EMOTE_IDS.includes(id)) return;
    const now = Date.now();
    if (now - lastEmoteAt < 3000) return;
    lastEmoteAt = now;
    try { social.onAction(socket, 'sticker'); } catch {}
    io.to(s.t.id).emit('emote', { idx: s.t.denseIndex(s.key), id, name: views.nameOf(s.key) });
  });
  on('throw_item', ({ roomId, targetIdx, item } = {}) => {
    const s = seated(roomId); if (!s) return;
    const fromIdx = s.t.denseIndex(s.key), n = s.t.players().length;
    if (typeof targetIdx !== 'number' || !Number.isInteger(targetIdx) || targetIdx < 0 || targetIdx >= n || targetIdx === fromIdx) return;
    try { social.onAction(socket, 'throw'); } catch {}
    io.to(s.t.id).emit('item_thrown', { fromIdx, targetIdx, item: String(item || '').slice(0, 8), fromName: views.nameOf(s.key) });
  });
  on('chat_message', ({ roomId, text } = {}) => {
    const s = seated(roomId); if (!s) return;
    const safe = String(text || '').slice(0, 120).trim();
    if (!safe) return;
    io.to(s.t.id).emit('chat_message', { name: views.nameOf(s.key), text: safe });
  });
}

module.exports = { register, EMOTE_IDS };
