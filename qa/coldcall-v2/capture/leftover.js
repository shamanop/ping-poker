// repro: forced phone round, real clicks on #spin during the cascade; at the end of each round list any node the self-check counts as a leftover
const { launch, ready, sleep } = require('./lib');
const N = +process.argv[2] || 8, force = process.argv[3] || 'phone';
(async () => {
  const b = await launch(540, 960); const { page, logs } = b;
  try {
    await ready(page, `?nosplash&force=${force}`); await page.evaluate(() => { window.__added = []; new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1 && /stamp|accept|banner|fly|flash/.test(n.className + '')) __added.push([Date.now(), n.className + '', n.parentElement && (n.parentElement.id || n.parentElement.className)]); }))).observe(document.body, { childList: true, subtree: true }); });
    for (let i = 0; i < N; i++) {
      const s0 = await page.evaluate(() => CC.dbg.rounds.length);
      const bx = await page.locator('#spin').boundingBox(); await page.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2);
      await sleep(300 + i * 220); for (let k = 0; k < 4; k++) { await page.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2); await sleep(150); }
      await page.waitForFunction((n) => CC.dbg.rounds.length > n && !CC.core.st.busy, s0, { timeout: 120000 }); await sleep(300);
      const left = await page.evaluate(() => { const st = document.getElementById('stage') || document.body; const q = [...document.querySelectorAll('#floats > *, #ov > *, #scene > *, .stamp, .accept, .banner, .fly, .flash')]; return q.map((n) => n.outerHTML.slice(0, 160)); });
      const mis = await page.evaluate(() => CC.dbg.mismatch.filter((m) => m.what === 'leftover nodes' || m.what).slice(-2));
      console.log(i, left.length ? 'LEFT ' + JSON.stringify(left) : 'clean', JSON.stringify(mis));
    }
  } finally { console.log(logs.join('\n')); await b.browser.close(); }
})();
