// F1 small items, one scenario per run:   node f1_misc.js <u8|u14|u15|u16> <play|chips>
//  u8   a `ready` sent twice (the server answers the 2nd with code 'rate'): the prompt must stay up and answerable; 0 aborts. PASS = prompt open >= 3 s, 0 aborts, answered by the player.
//  u14  switching mode resets the WIN meter: Chips shows no dollar sign. PASS = #win reads '0' in Chips (and '$0.00' back in Play $) even after a Play $ win.
//  u15  a Callback armed: the buy button is disabled and reads "Callback first" (prices would follow a bet the screen no longer shows). The view is injected (a real Callback needs 450 leads).
//  u16  two tabs of one account on one bonus. B picks: A must say what happened ("... picked on your other screen"), never "TIME'S UP: first lead picked"; then both time out on
//       ONE MORE CALL: "TIME'S UP: banked" and no "AUTO:" line anywhere (autoplay is the only AUTO).
const L = require('./f1lib');
const logCaps = (p) => p.evaluate(() => { window.__caps = []; const s0 = CC.caption.say; CC.caption.say = (g, t) => { if (t) window.__caps.push(t); return s0(g, t); };
  window.__toasts = []; new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); }))).observe(document.getElementById('stage'), { childList: true }); });
(async () => {
  const sc = process.argv[2] || 'u8', md = process.argv[3] || 'play';
  const { browser, ctx } = await L.launch(); const name = L.uniq('f1m'); const p = await L.page(ctx, name); await L.mode(p, md); await L.setBet(p, 10);
  if (sc === 'u8') {
    await p.click('#turbo'); await p.evaluate(() => { const T = CC.core.T, r0 = T.ready.bind(T); T.ready = (id) => { r0(id); r0(id); }; window.__op = []; let last = null; setInterval(() => { const c = CC.core.st.ctx, k = (c && c.promptOpen) || null; if (k !== last) { window.__op.push({ t: performance.now(), k }); last = k; } }, 20); });
    let ok = false; for (let t = 0; t < 8 && !ok; t++) {   // watch the in-page prompt log (a BEFORE build aborts the prompt within ~120 ms, a poll from here would miss it)
      await L.buy(p, 'bonus1'); const t0 = Date.now();
      while (Date.now() - t0 < 150000) { await L.tapDial(p); if (await p.evaluate(() => window.__op.some((e) => e.k === 'pick'))) { ok = true; break; } if (!(await p.evaluate(() => CC.core.st.busy)) && Date.now() - t0 > 2500) break; await L.sleep(60); }
      if (!ok) { await L.idle(p).catch(() => {}); await L.sleep(3200); await p.evaluate(() => { window.__op.length = 0; }); }
    }
    if (!ok) throw new Error('no pick');
    await L.sleep(3200); const still = await L.promptOpen(p), ab = await p.evaluate(() => CC.dbg.aborted || 0);
    if (still !== 'pick' || ab > 0) { L.out({ scenario: 'U8 rate-on-ready', mode: md, ok: false, promptStillOpenAt3s: still, abortsAt3s: ab, note: 'the round was aborted by the rate error on ready' }); await browser.close(); return; }
    // answer it with a tap on a lit square
    const c = await p.evaluate(() => { const s = document.querySelector('.slots i.pick'); if (!s) return null; const r = s.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    if (c) await p.mouse.click(c[0], c[1]);
    for (let i = 0; i < 400; i++) { await L.tapDial(p); const k = await L.promptOpen(p).catch(() => null); if (k === 'more') { await L.sleep(900); await p.click('#pl_bank').catch(() => {}); break; } if (!(await p.evaluate(() => CC.core.st.busy))) break; await L.sleep(100); }
    await L.idle(p, 120000); await L.sleep(500);
    const row = await p.evaluate(() => ({ aborted: CC.dbg.aborted || 0, rounds: CC.dbg.rounds.map((r) => ({ first: r.first, decisions: r.decisions, aborted: r.aborted || null })) }));
    L.out({ scenario: 'U8 rate-on-ready', mode: md, ok: still === 'pick' && ab === 0 && row.aborted === 0 && !!c, promptStillOpenAt3s: still, abortsAt3s: ab, final: row });
  } else if (sc === 'u14') {
    await L.setBet(p, 10); await p.click('#turbo'); const w0 = await p.evaluate(() => document.getElementById('win').textContent);
    // a Play $ win first (spins until one pays), then the switch
    const other = md === 'chips' ? 'play' : 'chips'; await L.mode(p, other); await p.click('#modebar button[data-m=' + other + ']').catch(() => {});
    let won = false; for (let i = 0; i < 25 && !won; i++) { await p.click('#spin'); await L.idle(p, 60000); await L.sleep(1500); won = await p.evaluate(() => CC.core.st.winTarget > 0); if (!won) await L.sleep(300); }
    const mid = await p.evaluate(() => document.getElementById('win').textContent);
    await p.click('#modebar button[data-m=' + md + ']'); await L.sleep(500);
    const shown = await p.evaluate(() => document.getElementById('win').textContent);
    await p.click('#modebar button[data-m=' + (md === 'chips' ? 'play' : 'chips') + ']'); await L.sleep(400); const back = await p.evaluate(() => document.getElementById('win').textContent);
    const want = md === 'chips' ? '0' : '$0.00', wantBack = md === 'chips' ? '$0.00' : '0';
    L.out({ scenario: 'U14 win-reset', mode: md, ok: shown === want && back === wantBack, wonBeforeSwitch: won, winBeforeSwitch: mid, winAfterSwitch: shown, winAfterSwitchBack: back });
  } else if (sc === 'u15') {
    const r = await p.evaluate(() => { const st = CC.core.st, v = st.pv[st.mode] || {}; st.pv[st.mode] = { ...v, cb: { bet: 130 }, warm: [], cold: null }; CC.core.syncView();
      const b = document.getElementById('buy'); const dis = b.disabled, lab = document.getElementById('buyFrom').textContent, spin = document.getElementById('spin').firstElementChild.textContent; b.click(); const modal = document.querySelectorAll('.scrim').length;
      const toast = [...document.querySelectorAll('.toast')].map((x) => x.textContent); return { dis, lab, spin, modalOpenedByClick: modal, toast, betShown: document.getElementById('bet').textContent }; });
    await p.screenshot({ path: L.OUT + '/f1_u15_' + md + '.png' });
    L.out({ scenario: 'U15 callback-buy', mode: md, ok: r.dis && /callback first/i.test(r.lab) && r.modalOpenedByClick === 0, ...r });
  } else if (sc === 'u16') {
    await p.click('#turbo'); await logCaps(p);
    if (!(await L.reach(p, 'pick'))) throw new Error('no pick');                      // tab A is at PICK; tab B (loaded now) adopts the open round from state.open
    const p2 = await L.page(ctx, name); await p2.click('#turbo'); await logCaps(p2); await L.mode(p2, md);
    let ok = false; for (let i = 0; i < 400 && !ok; i++) { await L.tapDial(p2); if ((await L.promptOpen(p2).catch(() => null)) === 'pick') ok = true; else await L.sleep(60); }
    if (!ok) throw new Error('tab B never reached pick');
    await L.sleep(900); await p2.bringToFront(); const c = await p2.evaluate(() => { const s = document.querySelector('.slots i.pick'); const r = s.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }); await p2.mouse.click(c[0], c[1]);
    await L.sleep(1500); const capsA1 = await p.evaluate(() => window.__caps.slice());
    // now both wait for ONE MORE CALL and let it time out
    let more = false; for (let i = 0; i < 600 && !more; i++) { await L.tapDial(p); await L.tapDial(p2); const a = await L.promptOpen(p).catch(() => null); if (a === 'more') more = true; else if (!(await p.evaluate(() => CC.core.st.busy))) break; else await L.sleep(100); }
    if (more) { for (let i = 0; i < 400; i++) { const a = await p.evaluate(() => CC.core.st.busy); if (!a) break; await L.sleep(150); } }
    await L.idle(p2, 120000).catch(() => {}); await L.sleep(800);
    const A = await p.evaluate(() => window.__caps.slice()), B = await p2.evaluate(() => window.__caps.slice());
    const ok1 = !A.some((t) => /TIME'S UP: first lead/.test(t)) && A.some((t) => /picked on your other screen/.test(t));
    const ok2 = more ? !A.concat(B).some((t) => /^AUTO:/.test(t)) && A.some((t) => /TIME'S UP: banked/.test(t)) : null;
    L.out({ scenario: 'U16 captions', mode: md, ok: ok1 && ok2 !== false, otherTabPick: ok1, timeoutCaptions: ok2, tabA: A, tabB: B });
  }
  await browser.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
