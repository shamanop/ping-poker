// Ballot Bender reference shots + clip (practice mode, pinned seeds). node refs_bender.js <baseUrl> [outDir]
// seeds (BenderEngine, first spin): 3 = dead, 7 = 2.5x, 1 = 22x; ?buy=election = bonus start.
const { chromium } = require('/usr/lib/node_modules/openclaw/node_modules/playwright-core');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const BASE = (process.argv[2] || 'http://127.0.0.1:4651').replace(/\/$/, '') + '/games/bender/index.html';
const OUT = path.resolve(process.argv[3] || path.join(__dirname, 'refs/bender')), PNG = path.resolve(__dirname, '../../_scratch/fb1-png/refs-bender');
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(PNG, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = [[540, 960], [360, 740], [1440, 900]];
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'];
const save = async (page, name) => { const png = path.join(PNG, name + '.png'); await page.screenshot({ path: png }); execFileSync('python3', ['-c', 'import sys;from PIL import Image;Image.open(sys.argv[1]).convert("RGB").save(sys.argv[2],quality=85)', png, path.join(OUT, name + '.jpg')]); };
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ARGS }); const log = [];
  for (const [w, h] of SIZES) {
    const mk = async (q, video) => { const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, ...(video ? { recordVideo: { dir: path.join(PNG, 'vid'), size: { width: w, height: h } } } : {}) }); const page = await ctx.newPage(); await page.goto(BASE + '?nosplash&' + q); await sleep(2500); return { ctx, page }; };
    const sz = `${w}x${h}`;
    let c = await mk('seed=7'); await save(c.page, `bender_idle_${sz}`);
    await c.page.evaluate(() => document.getElementById('spin').click()); await sleep(500); await save(c.page, `bender_spin_${sz}`);
    await c.page.waitForFunction(() => !document.getElementById('spin').classList.contains('run'), null, { timeout: 60000 }); await sleep(600); await save(c.page, `bender_win_${sz}`); await c.ctx.close();
    c = await mk('seed=1&buy=election');   // ?buy=election plays the bought bonus 400 ms after load: bonus intro card ('.scene' in the overlay)
    await c.page.waitForSelector('.scene .tap', { timeout: 60000 }); await sleep(1400); await save(c.page, `bender_bonus_${sz}`); await c.ctx.close();
    log.push(sz);
  }
  // clip 540x960: one context, spin (seed 7, 2.5x) -> win -> bought bonus card; timestamps logged, cut with ffmpeg (<= 8 s)
  const w = 540, h = 960, vdir = path.join(PNG, 'vid'); fs.rmSync(vdir, { recursive: true, force: true });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, recordVideo: { dir: vdir, size: { width: w, height: h } } }); const page = await ctx.newPage(); const T0 = Date.now(), t = () => (Date.now() - T0) / 1000, ev = {};
  await page.goto(BASE + '?nosplash&seed=1'); await sleep(2000); ev.spin = t(); await page.evaluate(() => document.getElementById('spin').click());
  await page.waitForFunction(() => !document.getElementById('spin').classList.contains('run'), null, { timeout: 60000 }); ev.win = t(); await sleep(800);
  await page.evaluate(() => document.getElementById('buy').click()); await sleep(900); await page.evaluate(() => document.querySelector('[data-v=buy-election]').click()); ev.buy = t();
  await page.waitForSelector('.scene .tap', { timeout: 60000 }); ev.bonus = t(); await sleep(2500); await ctx.close();
  const vf = fs.readdirSync(vdir).find((f) => f.endsWith('.webm')); console.log('events', JSON.stringify(ev));
  fs.writeFileSync(path.join(PNG, 'bender_clip_events.json'), JSON.stringify({ ev, vf }));
  await browser.close(); console.log('done', log);
})();
