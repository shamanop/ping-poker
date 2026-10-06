const { launch, ready, sleep } = require('./lib');
const force = process.argv[2] || 'big';
(async () => {
  const b = await launch(540, 960); const { page, logs } = b;
  try {
    await ready(page, `?nosplash&force=${force}`);
    const bx = await page.locator('#spin').boundingBox(); await page.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2);
    if (process.argv[3]) { await sleep(+process.argv[3]); for (let k = 0; k < 4; k++) { await page.mouse.click(bx.x + bx.width / 2, bx.y + bx.height / 2); await sleep(150); } }
    for (let t = 0; t < 30; t++) { await sleep(5000);
      const s = await page.evaluate(() => ({ busy: CC.core.st.busy, modal: CC.core.st.modal, skip: CC.core.st.skip, rounds: CC.dbg.rounds.length, last: CC.dbg.rounds[CC.dbg.rounds.length - 1], ovl: [...document.querySelectorAll('#ov > *, #scene > *')].map((n) => n.id || n.className), tier: !!document.getElementById('tier'), ribL: document.getElementById('ribL').textContent, win: document.getElementById('win').textContent, err: CC.dbg.error, mis: CC.dbg.mismatch.length }));
      console.log(t * 5 + 5, JSON.stringify(s)); if (!s.busy && s.rounds) break; }
  } finally { console.log(logs.filter((l) => !/404/.test(l)).join('\n')); await b.browser.close(); }
})();
