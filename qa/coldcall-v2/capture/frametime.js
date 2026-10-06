// CPU/GPU cost probe: per-frame rAF time idle, during the big-win overlay and during play, for four CSS variants (current, no will-change, no sym shadow, both). Run: node frametime.js (practice, needs force=big). Software-GL numbers only; not a real-GPU result.
const { launch, ready, sleep } = require('./lib');
const variants = { current: '', nowillchange: '.cell{will-change:auto !important}', noshadow: '.cell img.sym{filter:none !important}', both: '.cell{will-change:auto !important}.cell img.sym{filter:none !important}' };
(async () => {
  const b = await launch(); const { page } = b;
  try {
    for (const [name, css] of Object.entries(variants)) {
      await ready(page, '?nosplash&force=big');
      await page.evaluate((css) => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); window.__ft = []; let last = performance.now(); const f = (t) => { __ft.push([t - last, document.getElementById('tier') ? 1 : 0]); last = t; requestAnimationFrame(f); }; requestAnimationFrame(f); }, css);
      await sleep(3000); const idle = await page.evaluate(() => { const a = __ft.slice(-20).map((x) => x[0]); return a.reduce((x, y) => x + y, 0) / a.length; });
      await page.evaluate(() => { CC.core.st.turbo = true; document.getElementById('spin').click(); });
      await page.waitForFunction(() => document.getElementById('tier'), null, { timeout: 120000 }); await sleep(2500);
      const r = await page.evaluate(() => { const o = __ft.filter((x) => x[1]).map((x) => x[0]), p = __ft.filter((x) => !x[1]).slice(20).map((x) => x[0]); const avg = (a) => (a.reduce((x, y) => x + y, 0) / Math.max(1, a.length)) | 0; return { overlayFrames: o.length, overlayAvgMs: avg(o), playAvgMs: avg(p) }; });
      console.log(name, 'idleAvgMs', idle | 0, JSON.stringify(r));
      await page.evaluate(() => { CC.core.st.tap++; }); await page.waitForFunction(() => !CC.core.st.busy, null, { timeout: 120000 });
    }
  } finally { await b.browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
