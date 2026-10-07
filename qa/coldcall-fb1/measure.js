// Leads strip (#plNote) height and covered monitor area, mock idle state. node measure.js <baseUrl> <out.json>
const { chromium } = require('/usr/lib/node_modules/openclaw/node_modules/playwright-core');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
(async () => {
  const base = (process.argv[2] || 'http://127.0.0.1:4650').replace(/\/$/, ''), out = {};
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  for (const [w, h] of [[540, 960], [360, 740], [1440, 900]]) for (const state of ['idle', 'callback']) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
    await page.goto(`${base}/games/coldcall/index.html?mock=pull&nosplash&state=${state}&mode=play`); await page.waitForFunction(() => window.CC && CC.ready); await new Promise((r) => setTimeout(r, 1800));
    out[`${w}x${h}_${state}`] = await page.evaluate(() => {
      const r = (e) => { const b = e.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
      const note = document.getElementById('plNote'), board = document.getElementById('board'), slots = document.getElementById('slots');
      const n = r(note), b = r(board), s = r(slots), cold = document.getElementById('plCold');
      const x0 = Math.max(n.x, b.x), x1 = Math.min(n.x + n.w, b.x + b.w), y0 = Math.max(n.y, b.y), y1 = Math.min(n.y + n.h, b.y + b.h);
      const sy = Math.max(0, Math.min(n.y + n.h, s.y + s.h) - Math.max(n.y, s.y)) * Math.max(0, Math.min(n.x + n.w, s.x + s.w) - Math.max(n.x, s.x));
      const first = document.querySelector('#slots i') && r(document.querySelector('#slots i'));
      return { note: n, board: b, symbolGrid: s, noteHeightPx: n.h, noteWidthPx: n.w, coldLineShown: !!cold && !note.classList.contains('nocold'), noteAreaOverBoardPx2: Math.round(Math.max(0, x1 - x0) * Math.max(0, y1 - y0)), noteAreaOverSymbolGridPx2: Math.round(sy), noteBottomMinusGridTopPx: +(n.y + n.h - s.y).toFixed(1), noteAsPctOfBoardHeight: +(100 * n.h / b.h).toFixed(1), noteAsPctOfBoardWidth: +(100 * n.w / b.w).toFixed(1) };
    });
    await page.context().close();
  }
  await browser.close(); require('fs').writeFileSync(process.argv[3] || 'measure.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify(out, null, 1));
})();
