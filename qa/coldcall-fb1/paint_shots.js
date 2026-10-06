// COLD CALL FB4 painted-UI shots: ONE chromium for the whole run, A/B with and without paint.css (the unpainted version = the same build with paint.css blanked by a route).
//   flock _scratch/locks/chrome.lock node qa/coldcall-fb1/paint_shots.js <baseUrl> <outDir> <states csv> <sizes csv e.g. 540,360,1440> [modes play,chips] [paint,nopaint]
// Writes <outDir>/<state>_<w>x<h>[_chips]_<paint|nopaint>.jpg and rects_<...>.json (layout boxes of the key elements: used to prove no layout shift).
const { chromium } = require('/usr/lib/node_modules/openclaw/node_modules/playwright-core');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const BASE = process.argv[2].replace(/\/$/, ''), OUT = path.resolve(process.argv[3]), STATES = process.argv[4].split(','), SZ = process.argv[5].split(',');
const MODES = (process.argv[6] || 'play').split(','), VARS = (process.argv[7] || 'paint,nopaint').split(',');
const SIZES = { 540: [540, 960], 360: [360, 740], 1440: [1440, 900] };
const GAME = BASE + '/games/coldcall/index.html'; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = path.resolve(__dirname, '../../_scratch/paint-png', path.basename(OUT)); fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(PNG, { recursive: true });
const SEED = { dead: 1, small: 31, big: 547, bonus: 1 };
const settled = (page, n) => page.waitForFunction((k) => CC.dbg.rounds.length >= k && !CC.core.st.busy, n || 1, { timeout: 60000 });
const clickIn = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel);
const mock = (state, mode) => `mock=pull&nosplash&state=${state}&mode=${mode || 'play'}`;
const BUYX = { call: 25, bonus1: 100, bonus2: 250, hunt: 40 };
const buyStub = (page) => page.evaluate((x) => { const s = CC.core.st; if (!s.server || !s.server.buyCostX) s.server = Object.assign(s.server || {}, { buyCostX: x }); CC.core.syncView && CC.core.syncView(); }, BUYX);
const S = {
  idle: { q: 'shot=idle', run: async (p) => { await sleep(900); } },
  small_win: { q: 'shot=spin', seed: SEED.small, run: async (p) => { await settled(p); await sleep(900); } },
  big_win: { q: 'shot=bigwin', run: async (p) => { await sleep(1800); } },
  keypad: { q: 'shot=spin&force=bonus1', seed: SEED.bonus, run: async (p) => { await p.waitForSelector('.dial', { timeout: 60000 }); await sleep(1200); } },
  keypad_lit: { q: 'shot=spin&force=bonus1', seed: SEED.bonus, run: async (p) => { await p.waitForSelector('.dial', { timeout: 60000 }); await sleep(800); await p.evaluate(() => document.querySelector('.dial .key[data-k="5"]').click()); await sleep(500); } },
  pick: { q: mock('pick'), chips: 1, run: async (p) => { await sleep(1500); } },
  more: { q: mock('more'), chips: 1, run: async (p) => { await sleep(1500); } },
  buy_menu: { q: 'shot=buy', chips: 1, run: async (p, m) => { if (m === 'chips') { await buyStub(p); await clickIn(p, '#buy'); } await sleep(1500); } },
  buy_confirm: { q: 'shot=buy&step=confirm', chips: 1, run: async (p, m) => { if (m === 'chips') { await buyStub(p); await clickIn(p, '#buy'); await sleep(500); await clickIn(p, '#buy_bonus1'); } await p.waitForSelector('#buy_confirm', { timeout: 20000 }); await sleep(1500); } },
  info: { q: 'shot=info', chips: 1, run: async (p, m) => { if (m === 'chips') await clickIn(p, '#info'); await sleep(1200); } },
  bonus_mid: { q: 'shot=spin&force=bonus1', seed: SEED.bonus, run: async (p) => { await p.waitForSelector('.dial', { timeout: 60000 }); await sleep(800); await p.evaluate(() => { const d = document.querySelector('.dial'); if (d && d._finish) d._finish(); });
      await p.waitForFunction(() => { const e = document.getElementById('bhLeft'); return e && e.textContent !== '' && +e.textContent <= 4 && +e.textContent > 0; }, null, { timeout: 90000 }); await sleep(250); } },
  hot_leads: { q: mock('idle'), chips: 1, run: async (p) => { await sleep(1200); } },
  callback: { q: mock('callback'), chips: 1, run: async (p) => { await sleep(1200); } },
  gain: { q: mock('gain'), chips: 1, run: async (p) => { await sleep(700); } },
  ghost: { q: mock('ghost'), chips: 1, run: async (p) => { await sleep(1200); } },
  pot: { q: mock('pot'), chips: 1, run: async (p) => { await sleep(1200); } },
  disabled: { q: 'shot=idle', run: async (p) => { await sleep(600); await p.evaluate(() => { document.querySelectorAll('#hud button,.btns button').forEach((b) => { if (b.id !== 'spin') b.disabled = true; }); }); await sleep(300); } },
  pressed: { q: 'shot=idle', run: async (p) => { await sleep(600); await p.evaluate(() => { document.querySelectorAll('.btns button,.sq').forEach((b) => b.classList.add('fakepress')); }); await sleep(200); } }
};
const KEYS = ['#ribbon', '#plNote', '#cap', '#winbox', '#plLeaf', '#plPot', '#hud', '#buy', '#auto', '#turbo', '#info', '#sfxBtn', '#musicBtn', '#betDn', '#betUp', '#spin', '#modebar', '.mb', '#bh', '.dec2 .hang', '.dec2 .more', '.buyopt', '.dial', '.dial .key', '.dial .lcd', '#plBn', '#plmo', '.card', '.toast', '.chip'];
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'] });
  const rep = [];
  for (const v of VARS) for (const st of STATES) { const def = S[st]; if (!def) { console.log('no state', st); continue; }
    for (const mode of def.chips ? MODES : ['play']) for (const w of SZ) {
      const size = SIZES[w]; const file = `${st}_${size[0]}x${size[1]}${mode === 'chips' ? '_chips' : ''}_${v}`; let ctx;
      try {
        ctx = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 }); const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
        if (v === 'nopaint') await page.route('**/paint.css*', (r) => r.fulfill({ body: '', contentType: 'text/css' }));
        if (def.seed != null) await page.addInitScript((s) => { const o = crypto.getRandomValues.bind(crypto); crypto.getRandomValues = (a) => (a instanceof Uint32Array && a.length === 1 ? ((a[0] = s), a) : o(a)); }, def.seed);
        const q = def.q.includes('mock=pull') ? def.q.replace(/mode=\w+/, 'mode=' + mode) : def.q + (mode === 'chips' ? '&mode=chips' : '');
        const useQ = def.q.includes('mock=pull') || mode === 'play' ? q : mock('idle', 'chips');
        await page.goto(GAME + '?' + useQ); await page.waitForFunction(() => window.CC && CC.ready, null, { timeout: 30000 });
        if (mode === 'chips' && !def.q.includes('mock=pull')) await sleep(1500);
        await def.run(page, mode);
        const rects = await page.evaluate((ks) => { const o = {}; ks.forEach((k) => { const e = document.querySelector(k); if (e) { const r = e.getBoundingClientRect(); o[k] = [r.left, r.top, r.width, r.height].map((x) => +x.toFixed(1)); } }); return o; }, KEYS);
        fs.writeFileSync(path.join(OUT, file + '.json'), JSON.stringify({ rects, errs }));
        const png = path.join(PNG, file + '.png'); await page.screenshot({ path: png });
        execFileSync('python3', ['-c', 'import sys;from PIL import Image;Image.open(sys.argv[1]).convert("RGB").save(sys.argv[2],quality=86)', png, path.join(OUT, file + '.jpg')]); rep.push(file + (errs.length ? ' ERR ' + errs[0] : ''));
      } catch (e) { rep.push(file + ' FAIL ' + String(e.message).split('\n')[0]); } finally { if (ctx) await ctx.close(); }
    } }
  await browser.close(); console.log(rep.join('\n'));
})();
