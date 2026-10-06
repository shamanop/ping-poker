/* node capture.js [A|B|C ...]  -> <X>/<state>_<540|360>.png. Needs a static server for the repo root on 4641 (python3 -m http.server 4641). One browser at a time, software GL. */
const { chromium } = require('/usr/lib/node_modules/openclaw/node_modules/playwright-core');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const STATES = ['idle', 'callback', 'pick', 'more', 'ghost', 'pot'], SIZES = [[540, 960], [360, 780]];
(async () => {
  const which = process.argv.slice(2).filter((a) => /^[ABC]$/.test(a)), list = which.length ? which : ['A', 'B', 'C'];
  const only = process.argv.slice(2).filter((a) => STATES.includes(a));
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] });
  for (const X of list) for (const [w, h] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 }), page = await ctx.newPage(), logs = [];
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.text()); }); page.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
    for (const s of (only.length ? only : STATES)) {
      await page.goto(`http://127.0.0.1:4641/qa/coldcall-v2/concepts/${X}/index.html?state=${s}`);
      await page.waitForSelector('body[data-ready="1"]', { timeout: 20000 }); await page.waitForTimeout(250);
      await page.screenshot({ path: `${__dirname}/${X}/${s}_${w}.png` });
    }
    if (logs.length) console.log(X, w, logs.join(' | '));
    await ctx.close();
  }
  await browser.close(); console.log('done', list.join(','));
})();
