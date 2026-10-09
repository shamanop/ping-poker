'use strict';
// admin_overview, admin_bank_summary, admin_set_play, admin_reset_pin, admin_adjust. Every event re-checks isAdmin server-side.
function register(ctx, socket, on) {
  const { accounts, auth, adm, views, presLedger } = ctx;
  const keyArg = key => (typeof key === 'string' ? accounts.keyOf(key) : '');
  const touched = k => { ctx.afterWrite([k]); };
  // R2B-2: an amount is a raw JSON number that is a safe integer, checked BEFORE any conversion (Number() turns null, '', [], false into 0 and '1e3' into 1000). -0 is refused too.
  const rawAmount = v => typeof v === 'number' && Number.isSafeInteger(v) && !Object.is(v, -0);
  const BAD_AMOUNT = 'The amount must be a whole number of cents. Nothing was changed.';
  // K1-3: the admin object may say where the Cash sits (wallet / atTable / inRound / total) and why it refused (message); pass on what is there, nothing else.
  const where = r => { const o = {}; for (const f of ['wallet', 'atTable', 'inRound', 'total']) if (Number.isFinite(r[f])) o[f] = r[f]; return o; };

  on('admin_overview', () => { if (!auth.requireAdmin(socket)) return; socket.emit('admin_overview', adm.overview()); });
  on('admin_bank_summary', ({ view } = {}) => { if (!auth.requireAdmin(socket)) return; socket.emit('bank_summary', views.bankSummary('POKERPING', view === 'play' ? 'play' : 'chips')); });

  on('admin_set_play', ({ key, cents, opId } = {}) => {
    const me = auth.requireAdmin(socket); if (!me) return;
    const k = keyArg(key);
    if (!k || !accounts.get(k)) { socket.emit('admin_result', { op: 'set_play', ok: false, message: 'Unknown player', code: 'unknown_player' }); return; }
    const echo = opId == null ? {} : { opId };
    if (!rawAmount(cents)) { socket.emit('admin_result', { op: 'set_play', key: k, ok: false, code: 'bad_amount', message: BAD_AMOUNT, ...echo }); return; }
    const r = adm.setPlay(k, cents, opId);
    if (!r.ok) { socket.emit('admin_result', { op: 'set_play', key: k, ok: false, code: r.code, message: r.message || (r.code === 'range' ? 'Enter a Play amount in range' : 'Could not set Play'), ...where(r), ...echo }); return; }
    touched(k);
    if (!r.dup) console.log(`admin ${accounts.displayOf(me)} set Play for ${k}`);
    socket.emit('admin_result', { op: 'set_play', key: k, ok: true, message: 'Play set', ...where(r), ...echo });
  });

  on('admin_adjust', ({ key, delta, cur, reason, opId } = {}) => {
    const me = auth.requireAdmin(socket); if (!me) return;
    const k = keyArg(key);
    const echo = opId == null ? {} : { opId };
    if (!rawAmount(delta)) { socket.emit('admin_result', { op: 'adjust', key: k, ok: false, code: 'bad_amount', message: BAD_AMOUNT, ...echo }); return; }
    const r = adm.adjust(k, delta, cur, reason, opId);
    if (r.ok) {
      touched(k);
      if (cur === 'chips' && !r.dup) { try { presLedger.log('adjust', accounts.displayOf(k), Math.abs(delta), views.bankOf(k), null, null, 'POKERPING', { delta }); } catch {} }
      if (!r.dup) console.log(`admin ${accounts.displayOf(me)} adjusted ${k} ${cur}`);
    }
    socket.emit('admin_result', { op: 'adjust', key: k, ok: !!r.ok, ...(r.ok ? { message: 'Adjusted' } : { code: r.code, message: r.message || (r.code === 'insufficient' ? 'Not enough to remove' : r.code === 'bad_amount' ? BAD_AMOUNT : 'Could not adjust') }), ...echo });
  });

  on('admin_reset_pin', ({ key, newPin } = {}) => {
    const me = auth.requireAdmin(socket); if (!me) return;
    const k = keyArg(key);
    const r = accounts.resetPin(me, k, typeof newPin === 'string' || typeof newPin === 'number' ? String(newPin) : '');
    // K6b-1: stored sessions are gone (accounts.resetPin); the sockets that are signed in right now go too, so the message below is true
    const n = r.ok ? auth.signOutSockets(ctx.socketsOf(k), 'pin_reset', 'Your PIN was reset by the admin. Sign in again with the new PIN.') : 0;
    if (r.ok) console.log(`admin ${me} reset PIN for ${k} (${n} live socket${n === 1 ? '' : 's'} signed out)`);
    socket.emit('admin_result', { op: 'reset_pin', key: k, ok: !!r.ok, code: r.code, message: r.ok ? `PIN reset. All their sessions were signed out${n ? ` (${n} open now)` : ''}.` : r.message });
  });
}

module.exports = { register };
