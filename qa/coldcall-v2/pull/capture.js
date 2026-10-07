// THE PULL look layer (builder B): ?mock=pull states in the real page on 4640. node capture.js [state ...]  -> qa/coldcall-v2/pull/<state>_<540|360|1440>.png
const { launch } = require('../capture/qalib');
const OUT = __dirname, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STATES = process.argv.slice(2).length ? process.argv.slice(2) : ['idle', 'callback', 'pick', 'more', 'ghost', 'pot', 'gain', 'more_won', 'more_lost', 'idle_chips'];
const SIZES = [[540, 960, '540'], [360, 780, '360'], [1440, 900, '1440']];
(async () => {
  for (const [w, h, tag] of SIZES) {
    const { browser, page, logs } = await launch(w, h);
    for (const st of STATES) {
      const chips = st.endsWith('_chips'), base = chips ? st.replace('_chips', '') : st;
      await page.goto(`http://127.0.0.1:4640/games/coldcall/index.html?mock=pull&state=${base}&mode=${chips ? 'chips' : 'play'}`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.CC && CC.ready, null, { timeout: 20000 }); await sleep(base === 'gain' ? 700 : 2600);
      await page.screenshot({ path: `${OUT}/${st}_${tag}.png` });
    }
    console.log(tag, JSON.stringify(logs.filter((l) => !/favicon|audio/i.test(l)).slice(0, 8)));
    await browser.close();
  }
})();
