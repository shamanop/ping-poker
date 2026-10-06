'use strict';
// lobby_list, tables_mine, table_create, table_preview, table_clone, night_get (tables.js:352-372, 543-561 at 9440541).
const { TableError } = require('../../tables/errors');

function register(ctx, socket, on) {
  const { registry, views, auth, social } = ctx;
  const tableOf = id => { const t = registry.get(id); if (!t) throw new TableError('not_found'); return t; };

  on('lobby_list', () => {
    const key = auth.requireAuth(socket); if (!key) return;
    socket.join('lobby');
    socket.emit('lobby_tables', { tables: registry.listFor(key) });
  });
  on('tables_mine', () => {
    const key = auth.requireAuth(socket); if (!key) return;
    socket.emit('tables_mine', registry.mineFor(key));
  });
  on('table_create', ({ settings } = {}) => {
    const key = auth.requireAuth(socket); if (!key) return;
    const t = registry.create(key, settings);
    socket.emit('table_created', { table: views.publicTable(t) });
    try { social.onAction(socket, 'host'); } catch {}
  });
  on('table_preview', ({ code } = {}) => {
    const key = auth.requireAuth(socket); if (!key) return;
    socket.emit('table_info', views.tableInfo(tableOf(code), key));
  });
  on('table_clone', ({ tableId } = {}) => {
    const key = auth.requireAuth(socket); if (!key) return;
    const t = tableOf(tableId);
    if (!registry.isParticipant(t, key)) throw new TableError('not_host', {}, 'Only people from that night can clone it');
    const n = registry.create(key, registry.recOf(t));
    socket.emit('table_created', { table: views.publicTable(n) });
  });
  on('night_get', ({ nightId } = {}) => {
    const key = auth.requireAuth(socket); if (!key) return;
    const t = [...registry.tables.values()].find(x => x.nightId === String(nightId || ''));
    if (!t || !registry.isParticipant(t, key)) throw new TableError('not_found', {}, 'No such night');
    socket.emit('settle_up', registry.nightPayload(t));
  });
}

module.exports = { register };
