// builder B: real-server base spins until the pull extras show: ghost stamp, warm stamps, lead gain banner, Callback. node live2.js [mode] [maxSpins]
const { launch } = require('../capture/qalib'); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODE = process.argv[2] || 'play', MAX = +process.argv[3] || 120, OUT = __dirname;
(async () => {
  const { browser, page, logs } = await launch(540, 960);
  await page.goto(`http://127.0.0.1:4640/games/coldcall/index.html?live=1&nosplash&name=plc${MODE}&pin=1234`);
  await page.waitForFunction(() => window.CC && CC.ready && CC.core.st.live, null, { timeout: 30000 });
  if (MODE === 'chips') { await page.click('#modebar button[data-m=chips]'); await sleep(300); }
  const got = {}; let n = 0;
  const snap = async (k) => { if (got[k]) return; got[k] = n; await page.screenshot({ path: `${OUT}/live_${k}.png` }); };
  while (n < MAX) {
    await page.click('#spin'); n++;
    for (let i = 0; i < 400; i++) {
      const s = await page.evaluate(() => ({ busy: CC.core.st.busy, ghost: !!document.querySelector('#head .plgh'), bn: !document.getElementById('plBn').hidden, wst: document.querySelectorAll('.wst').length, gain: !document.getElementById('plGain').hidden, dial: !!document.querySelector('.dial'), pick: !!document.querySelector('.slots i.pick'), more: !!document.getElementById('pl_more'), cb: document.getElementById('spin').classList.contains('cb') }));
      if (s.ghost) { await sleep(300); await snap('ghost'); }
      if (s.bn) await snap('banner'); if (s.gain) await snap('gain'); if (s.wst) await snap('warm'); if (s.cb && !s.busy) await snap('callback');
      if (s.dial) await page.locator('.dial').click({ timeout: 1000 }).catch(() => {});
      if (s.pick) await page.locator('.slots i.pick').first().click({ force: true }).catch(() => {});
      if (s.more) await page.click('#pl_bank').catch(() => {});
      if (!s.busy) break; if (i > 3) await page.click('#spin').catch(() => {}); await sleep(120);
    }
    if (got.ghost && got.warm && got.banner && got.gain) break;
  }
  const res = await page.evaluate(() => ({ mismatch: CC.dbg.mismatch.slice(0, 5), pullErr: CC.dbg.pull, feed: CC.pull._S.feed.length, view: CC.pull._S.view && { leads: CC.pull._S.view.leads, cb: CC.pull._S.view.cb, warm: CC.pull._S.view.warm, cold: CC.pull._S.view.cold } }));
  console.log(JSON.stringify({ spins: n, got, ...res, logs: logs.filter((l) => !/404/.test(l)) }, null, 1));
  await page.screenshot({ path: `${OUT}/live_end2.png` }); await browser.close();
})();
