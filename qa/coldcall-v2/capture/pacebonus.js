// normal-speed (not turbo) timing of forced bonuses: ms per free spin and for the whole bonus, from CC.dbg.spinT (bonus.js stamps each spin start; a negative stamp = end)
const { launch, ready, sleep } = require('./lib');
(async () => {
  const b = await launch(); const { page } = b; const out = [];
  try {
    for (const force of ['bonus1', 'bonus1', 'bonus2', 'bonus3']) {
      await ready(page, '?nosplash&force=' + force);
      await page.evaluate(() => { CC.core.st.turbo = false; CC.core.st.auto = true; document.getElementById('spin').click(); });
      await page.waitForFunction(() => CC.dbg.rounds.length >= 1, null, { timeout: 60000 });
      await page.evaluate(() => { const iv = setInterval(() => { if (CC.dbg.spinT && CC.dbg.spinT.some((x) => x < 0)) { CC.core.st.auto = false; clearInterval(iv); } }, 200); });
      await page.waitForFunction(() => CC.dbg.spinT && CC.dbg.spinT.some((x) => x < 0), null, { timeout: 900000 });
      const t = await page.evaluate(() => CC.dbg.spinT.slice()); const starts = t.filter((x) => x > 0), end = -t.find((x) => x < 0);
      const gaps = starts.slice(1).map((x, i) => x - starts[i]).concat([end - starts[starts.length - 1]]);
      out.push({ force, spins: starts.length, totalS: Math.round((end - starts[0]) / 100) / 10, perSpinS: Math.round(gaps.reduce((a, c) => a + c, 0) / gaps.length / 100) / 10, minS: Math.round(Math.min(...gaps) / 100) / 10, maxS: Math.round(Math.max(...gaps) / 100) / 10 });
      console.log(JSON.stringify(out[out.length - 1])); await page.waitForFunction(() => !CC.core.st.busy, null, { timeout: 120000 });
    }
  } finally { await b.browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
