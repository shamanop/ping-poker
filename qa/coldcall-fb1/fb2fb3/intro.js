// FB3 shots + checks of the bonus intro. node intro.js PORT LABEL [check]   (run under flock). Practice engine, forced bonus1, in-page spin click.
const { chromium } = require('/usr/lib/node_modules/openclaw/node_modules/playwright-core');
const fs = require('fs'), path = require('path');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const PORT = process.argv[2] || '4650', LABEL = process.argv[3] || 'before', CHECK = process.argv[4] === 'check', OUT = __dirname;
const SIZES = [[360, 740], [540, 960], [1440, 900]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function reach(page, kind = 'bonus1') {
  await page.goto(`http://127.0.0.1:${PORT}/games/coldcall/index.html?nosplash&force=${kind}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.CC && CC.ready && !CC.core.st.busy, null, { timeout: 60000 }); await sleep(500);
  await page.evaluate(() => document.getElementById('spin').click());
  await page.waitForSelector('.dial', { timeout: 120000 }); await sleep(700);
}
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'] });
  const out = {};
  for (const [w, h] of SIZES) for (const touch of (CHECK ? [false, true] : [false])) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: touch, isMobile: touch }); const page = await ctx.newPage(); const logs = [];
    page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
    await reach(page);
    const tag = `${LABEL}_${w}${touch ? '_touch' : ''}`;
    await page.screenshot({ path: path.join(OUT, `${tag}_intro.png`) });
    const geo = await page.evaluate(() => { const d = document.querySelector('.dial').getBoundingClientRect(), s = document.getElementById('scene').getBoundingClientRect(), keys = [...document.querySelectorAll('.dial .key')].map((k) => { const b = k.getBoundingClientRect(); return [k.textContent.trim(), +b.width.toFixed(1), +b.height.toFixed(1)]; }); const sc = document.getElementById('stage').getBoundingClientRect().width / 540; return { dial: [d.x, d.y, d.width, d.height].map((v) => +v.toFixed(1)), scene: [s.x, s.y, s.width, s.height].map((v) => +v.toFixed(1)), scale: +sc.toFixed(3), keys }; });
    out[tag] = { geo, logs };
    if (CHECK) {
      // a real pointer press on a key that is NOT the script's digit: the script's digit lands, the pressed key lights
      const t0 = Date.now();
      const k7 = page.locator('.dial .key', { hasText: /^7$/ }).first();
      if (touch) await k7.tap(); else await k7.click();
      await sleep(250);
      const lit = await page.evaluate(() => ({ lit: [...document.querySelectorAll('.dial .key.lit')].map((k) => k.dataset.k + ':' + k.textContent.trim()), lcd: (document.querySelector('.dial .lcd') || {}).textContent, done: document.querySelector('.dial').classList.contains('done') }));
      await page.screenshot({ path: path.join(OUT, `${tag}_pressed.png`) });
      out[tag].lit = lit; out[tag].youDialed = await page.waitForFunction(() => { const b = document.querySelector('#chN.set b'); return b ? b.textContent : null; }, null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => 'not seen'); out[tag].chipAfterMs = Date.now() - t0;
          }
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, `${LABEL}_intro.json`), JSON.stringify(out, null, 1)); console.log(JSON.stringify(out, null, 1)); await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
