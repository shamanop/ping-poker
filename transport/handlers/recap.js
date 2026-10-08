'use strict';
// recap_get -> recap_data (night recap overlay). Parse, authorise, call the recorder's build(); the access rule lives there.
// Errors are the fixed sentence 'No such night' (no digits, no '$'), code 'recap'.

// (r2) critic r1 #8: one build per socket per MIN_MS. A request that comes sooner is not refused: it is coalesced, the newest one waits and is answered
// when the window opens (the overlay polls every 10 s, so a legitimate client never notices; a flood costs one build per window, not one per frame).
const MIN_MS = 800;

function register(ctx, socket, on) {
  let lastAt = 0, timer = null, queued = null;
  const str = v => (typeof v === 'string' && v.length <= 64 ? v : null);

  // The recap is presentation only: nothing it does may reach the safety wrapper, which treats an unknown throw as a table bug and voids
  // the caller's live hand (critic r1 #1: a deeply nested `start` made Number() throw). So: plain inputs only, and every throw ends here.
  function answer(q) {
    let out;
    try { out = ctx.recap.build(q); }
    catch (e) { console.error('[v2] recap build:', e && e.message); out = { error: 'No such night' }; }
    try {
      if (!out || out.error) socket.emit('error', { message: (out && out.error) || 'No such night', code: 'recap' }); else socket.emit('recap_data', out);
    } catch (e) { console.error('[v2] recap emit:', e && e.message); }
  }
  function fire() {
    timer = null;
    const job = queued; queued = null; if (!job) return;
    if (!socket.data || socket.data.acct !== job.q.viewerKey) return;     // signed out or switched account while it waited
    lastAt = Date.now();
    answer(job.q);
  }
  socket.on('disconnect', () => { if (timer) clearTimeout(timer); timer = null; queued = null; });

  on('recap_get', d => {
    const key = ctx.auth.requireAuth(socket); if (!key) return;
    if (!ctx.recap) return;
    // (r2) critic r1 #1: EVERY field is reduced to a plain value here (payload is {} for a missing / array / non-object frame, see transport/safe.js).
    const p = d && typeof d === 'object' && !Array.isArray(d) ? d : {};
    const start = typeof p.start === 'number' && Number.isFinite(p.start) ? p.start : (typeof p.start === 'string' && /^\d{1,16}$/.test(p.start) ? Number(p.start) : null);
    const q = { viewerKey: key, tableId: str(p.tableId), nightId: str(p.nightId), start, have: str(p.have) };
    const wait = lastAt + MIN_MS - Date.now();
    if (timer || wait > 0) {                                              // inside the window: keep only the newest request
      queued = { q };
      if (!timer) { timer = setTimeout(fire, Math.max(1, wait)); if (timer.unref) timer.unref(); }
      return;
    }
    lastAt = Date.now();
    answer(q);
  });
}

module.exports = { register, MIN_MS };
