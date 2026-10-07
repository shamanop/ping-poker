'use strict';
// table_start, table_pause, table_kick, table_update, table_end_night (tables.js:455-541 at 9440541). Host or admin only.
const { TableError } = require('../../tables/errors');
const { validateSettings } = require('../../tables/settings');

const ALLOWED = ['name', 'blinds', 'actionTimerSec', 'rebuys', 'rebuyLimit', 'isPrivate', 'blindIncrease', 'autoStart', 'buyIn', 'look'];

function register(ctx, socket, on) {
  const { registry, views, auth, accounts } = ctx;
  const hostFor = id => {
    const key = auth.requireAuth(socket); if (!key) return {};
    const t = registry.get(id); if (!t) throw new TableError('not_found');
    if (!registry.canHost(t, key)) throw new TableError('not_host');
    return { key, t };
  };
  const live = t => t.phase === 'betting' || t.phase === 'runout';

  on('table_start', ({ tableId } = {}) => {
    const { t } = hostFor(tableId); if (!t) return;
    if (t.phase === 'ended') throw new TableError('ended');
    if (t.paused) throw new TableError('paused', {}, 'Table is paused');
    if (t.phase !== 'waiting') throw new TableError('hand_live');
    if (t.eligible().length < 2) throw new TableError('not_enough_players');
    t.startHand();
    ctx.tableEvent(t, 'started', {});
  });

  on('table_pause', ({ tableId, paused } = {}) => {
    const { key, t } = hostFor(tableId); if (!t) return;
    if (t.phase === 'ended') throw new TableError('ended');
    t.pausedBy = views.nameOf(key);
    if (paused !== false) t.pause(); else t.resume();
    registry.save(); registry.pushLobby();
  });

  on('table_kick', ({ tableId, key: target } = {}) => {
    const { key, t } = hostFor(tableId); if (!t) return;
    t.kick(key, accounts.keyOf(String(target || '')), registry.canHost(t, key) && ctx.auth.isAdmin(key));
  });

  on('table_update', ({ tableId, patch } = {}) => {
    const { key, t } = hostFor(tableId); if (!t) return;
    if (t.phase === 'ended') throw new TableError('ended');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TableError('bad_request', {}, 'Nothing to update');
    for (const k of Object.keys(patch)) {
      if (!ALLOWED.includes(k)) throw new TableError('forbidden', { field: k });
      if (k === 'buyIn' && t.handNo - (t.nightHand0 || 0) > 0) throw new TableError('locked', {}, 'Buy-in limits are locked once a hand has been dealt');
    }
    const blindsOnly = Object.keys(patch).every(k => k === 'blinds' || k === 'look');   // the look is cosmetic: allowed mid-hand
    if (live(t) && !t.paused && !blindsOnly) throw new TableError('paused', {}, 'Change settings between hands');
    const v = validateSettings({ ...registry.recOf(t), ...patch });
    if (!v.ok) { const { code, field, message, ...rest } = v; throw new TableError(code === 'range' ? 'range' : 'bad_request', { field, ...rest }, message); }
    let pending = null;
    for (const k of Object.keys(patch)) {
      if (k === 'blinds') {
        if (t.phase === 'waiting') { t.blinds = { ...v.value.blinds }; t.pendingBlinds = null; if (t.blindIncrease && t.blindIncrease.enabled) { t.blindStartAt = 0; t.blindLevelSeen = 0; } }
        else { t.pendingBlinds = { ...v.value.blinds }; pending = t.pendingBlinds; }
      } else {
        t[k] = v.value[k];
        if (k === 'blindIncrease') { t.blindStartAt = 0; t.blindLevelSeen = 0; }
      }
    }
    if (t.mode === 'chips' || t.mode === 'play') { /* mode/unit are not patchable */ }
    t.pushLog(`${views.nameOf(key)} changed the table settings`);
    t.checkAutostart();
    registry.save(); registry.pushLobby();
    ctx.out.state(t);
    ctx.tableEvent(t, 'updated', { table: views.publicTable(t), ...(pending ? { pendingBlinds: pending } : {}) });
  });

  on('table_end_night', ({ tableId } = {}) => {
    const { key, t } = hostFor(tableId); if (!t) return;
    if (t.phase === 'ended') throw new TableError('ended');
    const r = t.endNight('host');
    if (r === 'pending') {
      t.pushLog(`${views.nameOf(key)} is ending the night after this hand`);
      ctx.tableEvent(t, 'ending', { by: views.nameOf(key) });
      ctx.out.state(t);
    }
    registry.save(); registry.pushLobby();
  });
}

module.exports = { register };
