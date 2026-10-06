// node frames.js <force|-> <buy|-> <outdir> [intervalMs] [maxFrames]  : plays one practice round, screenshots every interval, prints a sampled timeline of the WIN readout
const { launch, ready, sleep } = require('./lib'); const fs = require('fs');
const [force, buy, dir, iv = '450', maxF = '60'] = process.argv.slice(2);
(async () => {
  fs.mkdirSync(dir, { recursive: true }); const b = await launch(); const { page, logs } = b;
  try {
    await ready(page, '?nosplash' + (force !== '-' ? '&force=' + force : '')); await sleep(500);
    await page.evaluate((buy) => { window.__t0 = performance.now(); (buy && buy !== '-') ? CC.core.play(buy) : document.getElementById('spin').click(); }, buy);
    let i = 0; const t0 = Date.now();
    while (i < +maxF) {
      const busy = await page.evaluate(() => CC.core.st.busy); if (!busy && i > 3) break;
      const d = await page.evaluate(() => { const s = document.getElementById('scene'); const dial = document.querySelector('.dial'); if (dial && dial._finish && !dial._fin) { dial._fin = 1; setTimeout(() => dial._finish(), 400); } return 1; });
      await page.screenshot({ path: `${dir}/f${String(i).padStart(3, '0')}.jpg`, type: 'jpeg', quality: 60 }); i++; await sleep(+iv);
    }
    console.log('frames', i, 'secs', ((Date.now() - t0) / 1000).toFixed(1));
    console.log(JSON.stringify(await page.evaluate(() => ({ mis: CC.dbg.mismatch, checked: CC.dbg.checked, err: CC.dbg.error, r: CC.dbg.rounds.slice(-1) }))));
  } finally { console.log(logs.filter((l) => !/404/.test(l)).join('\n')); await b.browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
