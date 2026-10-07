'use strict';
// admin_overview, admin_bank_summary, admin_set_play, admin_reset_pin, admin_adjust. Every event re-checks isAdmin server-side.
function register(ctx, socket, on) {
  const { accounts, auth, adm, views, presLedger } = ctx;
  const keyArg = key => (typeof key === 'string' ? accounts.keyOf(key) : '');
  const touched = k => { ctx.afterWrite([k]); };

  on('admin_overview', () => { if (!auth.requireAdmin(socket)) return; socket.emit('admin_overview', adm.overview()); });
  on('admin_bank_summary', ({ view } = {}) => { if (!auth.requireAdmin(socket)) return; socket.emit('bank_summary', views.bankSummary('POKERPING', view === 'play' ? 'play' : 'chips')); });

  on('admin_set_play', ({ key, cents, opId } = {}) => {
    const me = auth.requireAdmin(socket); if (!me) return;
    const k = keyArg(key);
    if (!k || !accounts.get(k)) { socket.emit('admin_result', { op: 'set_play', ok: false, message: 'Unknown player', code: 'unknown_player' }); return; }
    const r = adm.setPlay(k, Math.round(Number(cents)), opId);
    const echo = opId == null ? {} : { opId };
    if (!r.ok) { socket.emit('admin_result', { op: 'set_play', key: k, ok: false, code: r.code, message: r.code === 'range' ? 'Enter a Play amount in range' : 'Could not set Play', ...echo }); return; }
    touched(k);
    if (!r.dup) console.log(`admin ${accounts.displayOf(me)} set Play for ${k}`);
    socket.emit('admin_result', { op: 'set_play', key: k, ok: true, message: 'Play set', ...echo });
  });

  on('admin_adjust', ({ key, delta, cur, reason, opId } = {}) => {
    const me = auth.requireAdmin(socket); if (!me) return;
    const k = keyArg(key);
    const r = adm.adjust(k, delta, cur, reason, opId);
    const echo = opId == null ? {} : { opId };
    if (r.ok) {
      touched(k);
      if (cur === 'chips' && !r.dup) { try { presLedger.log('adjust', accounts.displayOf(k), Math.abs(delta), views.bankOf(k), null, null, 'POKERPING', { delta }); } catch {} }
      if (!r.dup) console.log(`admin ${accounts.displayOf(me)} adjusted ${k} ${cur}`);
    }
    socket.emit('admin_result', { op: 'adjust', key: k, ok: !!r.ok, ...(r.ok ? { message: 'Adjusted' } : { code: r.code, message: r.code === 'insufficient' ? 'Not enough to remove' : 'Could not adjust' }), ...echo });
  });

  on('admin_reset_pin', ({ key, newPin } = {}) => {
    const me = auth.requireAdmin(socket); if (!me) return;
    const k = keyArg(key);
    const r = accounts.resetPin(me, k, typeof newPin === 'string' || typeof newPin === 'number' ? String(newPin) : '');
    if (r.ok) console.log(`admin ${me} reset PIN for ${k}`);
    socket.emit('admin_result', { op: 'reset_pin', key: k, ok: !!r.ok, code: r.code, message: r.ok ? 'PIN reset. Their other sessions were signed out.' : r.message });
  });
}

module.exports = { register };
