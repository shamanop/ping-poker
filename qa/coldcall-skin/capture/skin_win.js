// real practice spins until a base win lands, capture while the hero is in the hype mood and the winning cells are lit
const { launch, base, shot, sleep } = require('./skin_lib');
(async () => {
  const b = await launch(); const { page, logs } = b;
  try {
    await page.goto(base + '?nosplash'); await page.waitForFunction(() => window.CC && CC.ready);
    for (let i = 0; i < 20; i++) {
      await page.click('#spin'); let got = false;
      for (let k = 0; k < 120 && !got; k++) { const s = await page.evaluate(() => ({ hit: document.querySelectorAll('.cell.hit').length, mood: CC.hero.cur(), busy: CC.core.st.busy })); if (s.hit) { await sleep(500); await shot(page, 'win'); console.log('win shot, mood', await page.evaluate(() => CC.hero.cur()), 'round', i + 1); got = true; } if (!s.busy && k > 3) break; await sleep(100); }
      if (got) break; await page.waitForFunction(() => !CC.core.st.busy, null, { timeout: 60000 });
    }
  } finally { console.log(logs.filter((l) => !/404/.test(l)).join('\n')); await b.browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
