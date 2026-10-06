// U5 (stuck): the countdown must never be raised by a repeated timer message. 
//   part 1 (second ready): PICK open; 9 s later a 2nd socket of the same account sends `ready` (what a second tab adopting the round does); the server answers every socket with
//          the SAME expiresAt. PASS = the clock does not go up (after <= before + 400 ms) and tracks the server (|clock - (expiresAt - now)| < 1.5 s).
//   part 2 (adopt): a second page of the account adopts the open PICK round a few seconds in; ITS prompt must start from what the server has left, not from 0:20.
//   node f1_timer.js <1|2> <play|chips>
const L = require('./f1lib');
const clock = (p) => p.evaluate(() => { const c = CC.core.st.ctx; return c ? { shown: document.getElementById('ribR').textContent, left: c.timer.left(), srv: c.p.expiresAt, now: Date.now(), prompt: c.promptOpen, id: c.p.roundId } : null; });
(async () => {
  const part = process.argv[2] || '1', md = process.argv[3] || 'play';
  const { browser, ctx } = await L.launch(); const name = L.uniq('f1t'); const p = await L.page(ctx, name); await L.mode(p, md); await L.setBet(p, 10); await p.click('#turbo');
  if (part === '1') {
    if (!(await L.reach(p, 'pick'))) throw new Error('no pick prompt');
    const t0 = Date.now(); await L.sleep(700); const c0 = await clock(p); const s = await L.sock(name); const timers = []; s.on('g:coldcall:timer', (m) => timers.push(m.expiresAt));
    await L.sleep(9000 - (Date.now() - t0)); const before = await clock(p);
    s.emit('g:coldcall:ready', { roundId: c0.id }); await L.sleep(600); const after = await clock(p);
    const srvLeft = (timers[timers.length - 1] || c0.srv) - Date.now();
    const ok = after.left <= before.left + 400 && Math.abs(after.left - srvLeft) < 1500;
    L.out({ scenario: 'U5 second-ready', mode: md, ok, beforeLeftMs: before.left, afterLeftMs: after.left, serverLeftMs: srvLeft, shown: [before.shown, after.shown] }); s.close();
  } else {
    if (!(await L.reach(p, 'pick'))) throw new Error('no pick prompt');   // PICK: the adopted replay is short (only what was seen), so its prompt is up while the server's 20 s run
    const t0 = Date.now(); await L.sleep(500); const c0 = await clock(p);
    const p2 = await L.page(ctx, name); await p2.click('#turbo'); await p2.evaluate(() => { window.__first = null; });
    // tap = skip: the adopted bonus replays about 3x faster, so its prompt is up while the server's 20 s are still running
    let c2 = null; for (let i = 0; i < 400 && !c2; i++) { await L.tapDial(p2); if (await p2.evaluate(() => CC.core.st.busy)) await p2.click('#spin').catch(() => {});
      const k = await L.promptOpen(p2).catch(() => null); if (k === 'pick') c2 = await clock(p2); else await L.sleep(60); }
    // the server's truth: a third socket sends `ready` and reads the expiresAt it is answered with (the round's re-arm is spent, so it is the live one)
    const s3 = await L.sock(name); const exp = await new Promise((res) => { s3.once('g:coldcall:timer', (m) => res(m.expiresAt)); s3.emit('g:coldcall:ready', { roundId: c2 ? c2.id : 'x' }); setTimeout(() => res(null), 3000); }); s3.close();
    const srvLeft = exp ? exp - Date.now() : null; await L.sleep(300); const c1 = await clock(p);
    L.out({ scenario: 'U5 adopt', mode: md, ok: !!c2 && srvLeft != null && Math.abs(c2.left - srvLeft) < 1500 && (!c1 || Math.abs(c1.left - srvLeft) < 1500), serverLeftMs: srvLeft, tab1LeftMs: c1 && c1.left, adoptedPromptLeftMs: c2 && c2.left, openedAfterMs: Date.now() - t0 });
  }
  await browser.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
