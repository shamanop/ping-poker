const { chromium } = require('/usr/lib/node_modules/openclaw/node_modules/playwright-core');
const fs = require('fs');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const OUT = '/home/frank/.openclaw/workspace/projects/ping-coldcall/qa/coldcall-m4';
async function launch(w = 540, h = 960) {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const logs = []; page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text()); }); page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));
  await page.addInitScript(() => {
    // counts pending rAF callbacks requested from the game's own scripts only (Playwright's screenshot code also uses rAF)
    const orig = window.requestAnimationFrame.bind(window), ocancel = window.cancelAnimationFrame.bind(window), live = new Set(), by = {};
    window.__raf = { max: 0, total: 0, srcs: by, now: () => live.size };
    window.requestAnimationFrame = (cb) => {
      const mine = /games\/coldcall/.test(new Error().stack || ''); const src = mine ? (/(\w+)\.js/.exec((new Error().stack.split('\n').find((l) => /games\/coldcall/.test(l)) || '')) || [0, '?'])[1] : null;
      const id = orig((t) => { live.delete(id); cb(t); });
      if (mine) { live.add(id); window.__raf.total++; by[src] = (by[src] || 0) + 1; if (live.size > window.__raf.max) window.__raf.max = live.size; }
      return id;
    };
    window.cancelAnimationFrame = (id) => { live.delete(id); ocancel(id); };
  });
  return { browser, ctx, page, logs };
}
const url = (q = '') => `http://127.0.0.1:4610/games/coldcall/index.html?live=1${q}`;
async function shot(page, name) { const p = `${OUT}/${name}.jpg`; await page.screenshot({ path: p, type: 'jpeg', quality: 72 }); return p; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
module.exports = { launch, url, shot, sleep, OUT };
