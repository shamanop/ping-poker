const { chromium } = require('/usr/lib/node_modules/openclaw/node_modules/playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome', headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const p = await (await b.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 })).newPage();
  await p.goto('file://' + __dirname + '/comp.html'); await p.waitForTimeout(1200);
  await p.screenshot({ path: __dirname + '/comp.png' }); await b.close();
})();
