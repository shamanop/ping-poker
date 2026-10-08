'use strict';
// recap_get -> recap_data (night recap overlay). Parse, authorise, call the recorder's build(); the access rule lives there.
// Errors are the fixed sentence 'No such night' (no digits, no '$'), code 'recap'.

// (r2) critic r1 #8: one build per socket per MIN_MS. A request that comes sooner is not refused: it is coalesced, the newest one waits and is answered
// when the window opens (the overlay polls every 10 s, so a legitimate client never notices; a flood costs one build per window, not one per frame).
const MIN_MS = 800;
// (r3) critic r2 MAJOR: 'recap_get on a large legacy table starves the event loop ... The 800 ms coalescing caps each socket ... but builds serialize
// on the one thread' (3 sockets took a bystander's round-trip from 1 ms to 324 ms). So there is ONE budget for the whole server: after an answer that
// took c ms (build + encode) nobody is answered for c * DUTY ms, i.e. recap work stays under ~1/(DUTY+1) of the loop however many sockets ask.
// Waiting sockets are served first come first served, one request each (the newest). recap.js bounds c itself (RECAP_HANDS).
const DUTY = 9;

function register(ctx, socket, on) {
  const G = ctx.recapBudget || (ctx.recapBudget = { freeAt: 0, q: [], timer: null });
  const st = { lastAt: 0, queued: null, waiting: false, run: null };
  const str = v => (typeof v === 'string' && v.length <= 64 ? v : null);

  // The recap is presentation only: nothing it does may reach the safety wrapper, which treats an unknown throw as a table bug and voids
  // the caller's live hand (critic r1 #1: a deeply nested `start` made Number() throw). So: plain inputs only, and every throw ends here.
  function answer(q) {
    const t0 = Date.now();
    let out;
    try { out = ctx.recap.build(q); }
    catch (e) { console.error('[v2] recap build:', e && e.message); out = { error: 'No such night' }; }
    try {
      if (!out || out.error) socket.emit('error', { message: (out && out.error) || 'No such night', code: 'recap' }); else socket.emit('recap_data', out);
    } catch (e) { console.error('[v2] recap emit:', e && e.message); }
    const t1 = Date.now(); G.freeAt = t1 + (t1 - t0) * DUTY;
  }
  st.run = () => {
    const job = st.queued; st.queued = null; if (!job) return;
    if (!socket.data || socket.data.acct !== job.q.viewerKey) return;     // signed out or switched account while it waited
    st.lastAt = Date.now();
    answer(job.q);
  };
  function arm(ms) { G.timer = setTimeout(pump, Math.max(1, Math.min(ms, 60000))); if (G.timer.unref) G.timer.unref(); }
  function pump() {
    if (G.timer) { clearTimeout(G.timer); G.timer = null; }
    const now = Date.now();
    if (now < G.freeAt) { if (G.q.length) arm(G.freeAt - now); return; }
    let next = Infinity, served = false;
    for (let i = 0; i < G.q.length; i++) {
      const w = G.q[i];
      if (!w.queued) { w.waiting = false; G.q.splice(i--, 1); continue; }
      const at = w.lastAt + MIN_MS;
      if (at > now) { if (at < next) next = at; continue; }               // its own window is still closed: the next one in line goes first
      w.waiting = false; G.q.splice(i, 1); w.run(); served = true; break;
    }
    if (G.q.length) arm(served ? G.freeAt - Date.now() : next - now);
  }
  socket.on('disconnect', () => { st.queued = null; });                   // pump() drops the empty waiter

  on('recap_get', d => {
    const key = ctx.auth.requireAuth(socket); if (!key) return;
    if (!ctx.recap) return;
    // (r2) critic r1 #1: EVERY field is reduced to a plain value here (payload is {} for a missing / array / non-object frame, see transport/safe.js).
    const p = d && typeof d === 'object' && !Array.isArray(d) ? d : {};
    const start = typeof p.start === 'number' && Number.isFinite(p.start) ? p.start : (typeof p.start === 'string' && /^\d{1,16}$/.test(p.start) ? Number(p.start) : null);
    st.queued = { q: { viewerKey: key, tableId: str(p.tableId), nightId: str(p.nightId), start, have: str(p.have) } };   // only the newest request of a socket is kept
    if (!st.waiting) { st.waiting = true; G.q.push(st); }
    pump();                                                               // answered right now when the server budget and this socket's window are both open
  });
}

module.exports = { register, MIN_MS, DUTY };
