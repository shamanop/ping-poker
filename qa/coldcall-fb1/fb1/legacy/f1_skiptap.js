// U1 (money): a skip tap must never answer a decision. Spam taps (the game's own skip gesture) at the SPIN centre or the board centre during bought bonuses, no turbo.
//   node f1_skiptap.js <spin|board> <play|chips> [rounds]   PASS = 0 decisions answered inside 600 ms of the prompt opening (probe, 10 ms resolution)
const L = require('./f1lib');
(async () => {
  const variant = process.argv[2] || 'spin', md = process.argv[3] || 'play', n = +(process.argv[4] || 3);
  const { browser, ctx } = await L.launch(); const p = await L.page(ctx, L.uniq('f1s')); await L.mode(p, md); await L.setBet(p, 10);
  const pt = await p.evaluate((v) => { const r = document.getElementById(v === 'spin' ? 'spin' : 'board').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }, variant);
  await p.evaluate(() => { window.__pr = []; window.__dec = []; let last = null; setInterval(() => { const c = CC.core.st.ctx, k = (c && c.promptOpen) || null; if (k !== last) { window.__pr.push({ t: (c && c.promptOpenedAt) || performance.now(), k }); last = k; } }, 10);   // the game's own open stamp when it has one (the 10 ms poll lags on a busy main thread)
    addEventListener('click', (e) => { window.__ck = e.timeStamp; }, true);   // registered after the game's gate: a blocked click never gets here
    const d0 = CC.core.T.decide.bind(CC.core.T); CC.core.T.decide = (id, k, v) => { window.__dec.push({ t: window.__ck || performance.now(), k }); d0(id, k, v); }; });
  let prompts = 0, fast = 0; const rows = [];
  for (let i = 0; i < 10 && (i < n || prompts < 3); i++) {
    await p.evaluate(() => { window.__pr.length = 0; window.__dec.length = 0; }); await L.buy(p, 'bonus1'); let done = false; L.idle(p, 300000).then(() => { done = true; }).catch(() => { done = true; });
    await L.sleep(500);
    while (!done) {
      await L.tapDial(p); await p.mouse.click(pt[0], pt[1]).catch(() => {});
      const k = await L.promptOpen(p).catch(() => null);
      if (k === 'pick' && variant === 'spin') { const c = await p.evaluate(() => { const s = document.querySelector('.slots i.pick'); if (!s) return null; const r = s.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }); if (c) await p.mouse.click(c[0], c[1]); }
      await L.sleep(110);
    }
    const r = await p.evaluate(() => ({ pr: window.__pr.slice(), dec: window.__dec.slice() }));
    for (const d of r.dec) { const o = [...r.pr].reverse().find((x) => x.k && x.t <= d.t); if (!o) continue; prompts++; const ms = Math.round(d.t - o.t); rows.push({ k: d.k, answeredAfterMs: ms }); if (ms < 600) fast++; }
    await L.sleep(4200);
  }
  L.out({ scenario: 'U1 skiptap ' + variant, mode: md, ok: prompts >= 2 && fast === 0, prompts, answeredUnder600ms: fast, rows });
  await browser.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
