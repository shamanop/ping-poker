const { launch, ready, shot, sleep } = require('./lib');
(async () => {
  const b = await launch(); const { page, logs } = b;
  try {
    await ready(page, '?nosplash&shot=idle'); await sleep(800); await shot(page, 'idle');
    console.log(await page.evaluate(() => JSON.stringify(CC.board.state())));
    await page.click('#spin'); await page.waitForFunction(() => !CC.core.st.busy, null, { timeout: 60000 });
    await sleep(300); await shot(page, '_smoke_after');
    console.log(JSON.stringify(await page.evaluate(() => ({ mis: CC.dbg.mismatch, checked: CC.dbg.checked, err: CC.dbg.error, rounds: CC.dbg.rounds }))));
  } finally { console.log(logs.join('\n')); await b.browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
