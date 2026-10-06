// FB3: the info screen says the number is set before the pick. node info.js PORT   (run under flock)
const { chromium } = require('/usr/lib/node_modules/openclaw/node_modules/playwright-core');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const PORT = process.argv[2] || '4652', sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 1 }); const p = await ctx.newPage();
  await p.goto(`http://127.0.0.1:${PORT}/games/coldcall/index.html?nosplash`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.CC && CC.ready, null, { timeout: 60000 }); await sleep(400);
  await p.click('#info'); await p.waitForSelector('.card.info .padinfo', { timeout: 5000 }); await sleep(400);
  const txt = await p.evaluate(() => { const e = document.querySelector('.card.info .padinfo'); e.scrollIntoView({ block: 'center' }); return e.textContent; });
  await sleep(300); await p.screenshot({ path: __dirname + '/after_540_info.png' }); console.log(JSON.stringify({ padinfo: txt, count: await p.evaluate(() => document.querySelectorAll('.card.info .padinfo').length) }));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
