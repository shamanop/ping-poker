// COLD CALL FB1: deterministic named shots. One command re-shoots the same states against any server.
//   flock _scratch/locks/chrome.lock node qa/coldcall-fb1/shots.js <baseUrl> <outDir> [filter]
//   baseUrl  e.g. http://127.0.0.1:4650   (the server must run with COLDCALL_TEST=1; practice shots need no account)
//   outDir   JPGs (q85) are written here as <state>_<w>x<h>[_chips].jpg; PNG masters go to _scratch/fb1-png/<basename(outDir)>/
//   filter   '--index' writes <outDir>/INDEX.md (file -> exact URL / driver steps) and exits; otherwise an optional regex on the shot name (e.g. "^pick|keypad")
// Practice shots (Play $) pin the round seed: crypto.getRandomValues(Uint32Array(1)) returns a fixed seed (game.js localRound is its only caller), so the same
// seed gives the same board and the same cascades on every build with the same engine. Mock shots use ?mock=pull (CC.pull.demo(state, mode)); Chips mode only
// exists there (practice has no wallet). No game file is touched; this driver only reads the DOM and calls the game's own hooks.
const { chromium } = require('/usr/lib/node_modules/openclaw/node_modules/playwright-core');
const fs = require('fs'), path = require('path');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const BASE = (process.argv[2] || 'http://127.0.0.1:4650').replace(/\/$/, ''), OUT = path.resolve(process.argv[3] || 'qa/coldcall-fb1/after'), INDEX = process.argv[4] === '--index', FILTER = process.argv[4] && !INDEX ? new RegExp(process.argv[4]) : null;
const PNG = path.resolve(__dirname, '../../_scratch/fb1-png', path.basename(OUT));
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(PNG, { recursive: true });
const SIZES = [[540, 960], [360, 740], [1440, 900]];
const GAME = BASE + '/games/coldcall/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// seeds found offline with the engine at f20c3ff (cluster-only rounds, bet 10c): 1 = dead, 31 = 2x in two cascade steps, 240 = 11.7x big, 547 = 13.3x big in two steps, 1 + force=bonus1 = 39.3x bonus
const SEED = { dead: 1, small: 31, big: 547, bonus: 1 };
const BUYX = { call: 25, bonus1: 100, bonus2: 250, hunt: 40 };   // only used where the page has no server state (mock): stand-in prices so the buy menu has cards

async function open(size, q, seed) {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  if (seed != null) await page.addInitScript((s) => { const o = crypto.getRandomValues.bind(crypto); crypto.getRandomValues = (a) => (a instanceof Uint32Array && a.length === 1 ? ((a[0] = s), a) : o(a)); }, seed);
  await page.goto(GAME + '?' + q);
  await page.waitForFunction(() => window.CC && CC.ready, null, { timeout: 30000 });
  return { browser, page, errs };
}
const settled = (page, n) => page.waitForFunction((k) => CC.dbg.rounds.length >= k && !CC.core.st.busy, n || 1, { timeout: 60000 });
const clickIn = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel);   // in-page click (Playwright page.click adds ~7 s on SPIN)
const mock = (state, mode) => `mock=pull&nosplash&state=${state}&mode=${mode || 'play'}`;

// name -> { q (query), seed, chips (also shoot Chips mode), run(page, mode) = steps after load, before the screenshot }
const SHOTS = {
  idle:         { q: 'shot=idle', run: async (p) => { await sleep(900); } },
  dead:         { q: 'shot=spin', seed: SEED.dead, run: async (p) => { await settled(p); await sleep(900); } },
  small_win:    { q: 'shot=spin', seed: SEED.small, run: async (p) => { await settled(p); await sleep(900); } },
  big_win:      { q: 'shot=bigwin', run: async (p) => { await sleep(1800); } },                        // the big-win card (x412, MEGA) held by qa.js
  big_win_spin: { q: 'shot=spin', seed: SEED.big, run: async (p) => { await p.waitForSelector('#tier, .scn, .bigwin', { timeout: 60000 }).catch(() => {}); await sleep(3500); } },
  keypad:       { q: 'shot=spin&force=bonus1', seed: SEED.bonus, run: async (p) => { await p.waitForSelector('.dial', { timeout: 60000 }); await sleep(1200); } },   // the intro dial = the current keypad slot
  pick:         { q: mock('pick'), chips: true, run: async (p) => { await sleep(1500); } },             // PICK YOUR LEAD, countdown running
  more:         { q: mock('more'), chips: true, run: async (p) => { await sleep(1500); } },             // ONE MORE CALL
  buy_menu:     { q: 'shot=buy', chips: true, run: async (p, m) => { if (m === 'chips') { await buyStub(p); await clickIn(p, '#buy'); } await sleep(1500); } },
  buy_confirm:  { q: 'shot=buy&step=confirm', chips: true, run: async (p, m) => { if (m === 'chips') { await buyStub(p); await clickIn(p, '#buy'); await sleep(500); await clickIn(p, '#buy_bonus1'); } await p.waitForSelector('#buy_confirm', { timeout: 20000 }); await sleep(1500); } },
  info:         { q: 'shot=info', chips: true, run: async (p, m) => { if (m === 'chips') await clickIn(p, '#info'); await sleep(1200); } },
  bonus_mid:    { q: 'shot=spin&force=bonus1', seed: SEED.bonus, run: async (p) => {                    // free spins running, 4 left or fewer
      await p.waitForSelector('.dial', { timeout: 60000 }); await sleep(800); await p.evaluate(() => { const d = document.querySelector('.dial'); if (d && d._finish) d._finish(); });
      await p.waitForFunction(() => { const e = document.getElementById('bhLeft'); return e && e.textContent !== '' && +e.textContent <= 4 && +e.textContent > 0; }, null, { timeout: 90000 }); await sleep(250); } },
  hot_leads:    { q: mock('idle'), chips: true, run: async (p) => { await sleep(1200); } },             // leads strip with count (312 / list), warm leads lit, ribbon feed
  callback:     { q: mock('callback'), chips: true, run: async (p) => { await sleep(1200); } },         // strip FULL, Callback armed
  gain:         { q: mock('gain'), chips: true, run: async (p) => { await sleep(700); } },              // +N LEADS banner
  ghost:        { q: mock('ghost'), chips: true, run: async (p) => { await sleep(1200); } },            // dead spin that lit leads
  pot:          { q: mock('pot'), chips: true, run: async (p) => { await sleep(1200); } }               // pot win card
};
async function buyStub(page) { await page.evaluate((x) => { const s = CC.core.st; if (!s.server || !s.server.buyCostX) s.server = Object.assign(s.server || {}, { buyCostX: x }); CC.core.syncView && CC.core.syncView(); }, BUYX); }

const WHAT = { idle: 'Practice, Play $, nothing pressed: the empty board, no leads strip (practice has no pull state)', dead: 'Practice spin, seed 1: dead spin, settled, 0.9 s after busy clears', small_win: 'Practice spin, seed 31: 2x in two cascade steps, settled', big_win: 'Big-win card (x412, MEGA) held by qa.js, 1.8 s in', big_win_spin: 'Practice spin, seed 547: 13.3x big win in two steps, 3.5 s after the card element shows (count-up finished)', keypad: 'Practice force=bonus1 seed 1: the bonus intro dial (the slot the keypad replaces), 1.2 s after .dial exists', pick: 'PICK YOUR LEAD with the countdown running (bonus HUD up)', more: 'ONE MORE CALL prompt', buy_menu: 'Buy-bonus menu, 1.5 s after open (fade finished)', buy_confirm: 'Buy confirm step (DIALING FOR DOLLARS), 1.5 s after open', info: 'Info modal (top of the scroll)', bonus_mid: 'Practice force=bonus1 seed 1: free spins running, first frame with 4 or fewer spins left', hot_leads: 'Leads strip with a count (312 / 450, 8 leads + 4 warm go cold in 3 h 12 m), 4 warm leads lit, ribbon feed line', callback: 'Leads strip FULL (Callback armed)', gain: '+N LEADS banner (3120 -> 3245, 12 filled): mock idle, then leadGain called with CC.core.wait parked so it stays up', ghost: 'Dead spin that lit three leads (script reveals)', pot: 'Pot win card' };
function writeIndex() {
  const L = ['# ' + path.basename(OUT) + ' shots', '', 'Re-shoot every state: `flock _scratch/locks/chrome.lock node qa/coldcall-fb1/shots.js <baseUrl> <outDir>` (server needs COLDCALL_TEST=1; add a regex as 4th argument to shoot a subset). Sizes 540x960, 360x740, 1440x900. File: `<state>_<w>x<h>[_chips].jpg`. All URLs below are relative to `<baseUrl>/games/coldcall/index.html`.', '', 'Seeds: the driver pins `crypto.getRandomValues(Uint32Array(1))` (init script) so practice rounds are the same on every build with the same engine. Chips mode exists only on `?mock=pull` pages (practice has no wallet): for shots that are not mock pages, the Chips variant opens `mock=pull&state=idle&mode=chips` and presses the real button (#buy, #buy_bonus1, #info). Buy prices in those Chips pages are stubbed (`CC.core.st.server.buyCostX = {call:25, bonus1:100, bonus2:250, hunt:40}`) because a mock page has no server state.', '', '| state | Play $ URL (after `?`) | seed | Chips variant | extra driver step | what it shows |', '|---|---|---|---|---|---|'];
  for (const [name, d] of Object.entries(SHOTS)) {
    const extra = { dead: 'wait CC.dbg.rounds.length>=1 && !st.busy, +900 ms', small_win: 'same as dead', big_win: '+1800 ms', big_win_spin: 'wait #tier/.scn/.bigwin, +3500 ms', keypad: 'wait .dial, +1200 ms', bonus_mid: 'wait .dial, +800 ms, dial._finish(), wait #bhLeft in 1..4, +250 ms', buy_menu: 'practice: shot=buy opens it. chips: stub prices, in-page click #buy. +1500 ms', buy_confirm: 'chips: stub prices, click #buy, +500 ms, click #buy_bonus1, +1500 ms', info: 'chips: in-page click #info, +1200 ms', pick: '+1500 ms (countdown running)', more: '+1500 ms', idle: '+900 ms' }[name] || '+1200 ms';
    L.push(`| ${name} | \`?${d.q}\` | ${d.seed != null ? d.seed : '-'} | ${d.chips ? '`' + (d.q.includes('mock=pull') ? '?' + d.q.replace(/mode=\w+/, 'mode=chips') : '?' + mock('idle', 'chips')) + '`' : 'no'} | ${extra} | ${WHAT[name] || ''} |`);
  }
  L.push('', 'Mock pages equal driver call `CC.pull.demo(state, mode)` (bet 100 unless `&bet=`). `hot_leads` = `demo(\'idle\')`. Mock pages show Play $ amounts as dollars and Chips as whole chips; the wallet is 100000 either way.', '', '## Files', '', fs.readdirSync(OUT).filter((f) => f.endsWith('.jpg')).sort().map((f) => '- ' + f).join('\n'), '');
  fs.writeFileSync(path.join(OUT, 'INDEX.md'), L.join('\n')); console.log('wrote INDEX.md');
}
if (INDEX) { writeIndex(); process.exit(0); }
(async () => {
  const report = []; let n = 0;
  for (const [name, def] of Object.entries(SHOTS)) {
    if (FILTER && !FILTER.test(name)) continue;
    for (const mode of def.chips ? ['play', 'chips'] : ['play']) for (const size of SIZES) {
      const file = `${name}_${size[0]}x${size[1]}${mode === 'chips' ? '_chips' : ''}`;
      const q = def.q.includes('mock=pull') ? def.q.replace(/mode=\w+/, 'mode=' + mode) : def.q + (mode === 'chips' ? '&mode=chips' : '');
      let b; try {
        // chips outside mock: open the same mock-free page, then switch mode through the mode bar once the wallet exists (practice has no wallet), so those use a mock idle + the real button
        const useQ = def.q.includes('mock=pull') || mode === 'play' ? q : mock('idle', 'chips');
        b = await open(size, useQ, def.seed);
        if (mode === 'chips' && !def.q.includes('mock=pull')) await sleep(1500);
        await def.run(b.page, mode);
        const png = path.join(PNG, file + '.png'); await b.page.screenshot({ path: png });
        const { execFileSync } = require('child_process'); execFileSync('python3', ['-c', 'import sys;from PIL import Image;Image.open(sys.argv[1]).convert("RGB").save(sys.argv[2],quality=85)', png, path.join(OUT, file + '.jpg')]);
        report.push({ file, ok: true, errs: b.errs }); n++;
      } catch (e) { report.push({ file, ok: false, err: String(e.message).split('\n')[0] }); }
      finally { if (b) await b.browser.close(); }
    }
  }
  console.log(JSON.stringify({ shots: n, failed: report.filter((r) => !r.ok), errs: report.filter((r) => r.errs && r.errs.length) }, null, 1));
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
})();
