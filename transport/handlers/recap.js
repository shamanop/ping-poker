'use strict';
// recap_get -> recap_data (night recap overlay). Parse, authorise, call the recorder's build(); the access rule lives there.
// Errors are the fixed sentence 'No such night' (no digits, no '$'), code 'recap'.

function register(ctx, socket, on) {
  on('recap_get', d => {
    const key = ctx.auth.requireAuth(socket); if (!key) return;
    if (!ctx.recap) return;
    // The recap is presentation only: nothing it does may reach the safety wrapper, which treats an unknown throw as a table bug and voids
    // the caller's live hand (critic r1 #1: a deeply nested `start` made Number() throw). So: plain inputs only, and every throw ends here.
    const str = v => (typeof v === 'string' && v.length <= 64 ? v : null);
    const start = typeof d.start === 'number' && Number.isFinite(d.start) ? d.start : (typeof d.start === 'string' && /^\d{1,16}$/.test(d.start) ? Number(d.start) : null);
    let out;
    try { out = ctx.recap.build({ viewerKey: key, tableId: str(d.tableId), nightId: str(d.nightId), start }); }
    catch (e) { console.error('[v2] recap build:', e && e.message); out = { error: 'No such night' }; }
    if (!out || out.error) socket.emit('error', { message: (out && out.error) || 'No such night', code: 'recap' }); else socket.emit('recap_data', out);
  });
}

module.exports = { register };
