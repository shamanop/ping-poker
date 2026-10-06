// FB3: every way of placing the call. node intro_inputs.js PORT   (run under flock). Practice engine, forced bonus1.
const { chromium } = require('/usr/lib/node_modules/openclaw/node_modules/playwright-core');
const fs = require('fs'), path = require('path');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const PORT = process.argv[2] || '4652', ONLY = (process.argv[3] || '').split(',').filter(Boolean), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CASES = {
  key_digit5: async (p) => { await p.keyboard.press('5'); },
  key_enter_nofocus: async (p) => { await p.keyboard.press('Enter'); },
  key_enter_focused_9: async (p) => { await p.focus('.dial .key[data-k="9"]'); await p.keyboard.press('Enter'); },
  plate_click: async (p) => { await p.click('.dial .lcd'); },
  space_poke: async (p) => { await p.keyboard.press('Space'); },     // the game's Space handler calls CC.bonus.poke (the SPIN button itself only sets skip: unchanged from the dial build)
  hook_finish: async (p) => { await p.evaluate(() => document.querySelector('.dial')._finish()); },
  auto_0_7s: async (p) => { await p.evaluate(() => { CC.core.st.auto = true; }); },     // armed AFTER the keypad is up: the timer was set at open, so this case checks the open-time value separately
  idle_25s: async () => {},
  reduced_motion_click: async (p) => { await p.click('.dial .key[data-k="3"]'); },
};
(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'] });
  const out = {};
  for (const [name, act] of Object.entries(CASES)) {
    if (ONLY.length && !ONLY.includes(name)) continue;
    const reduced = name === 'reduced_motion_click';
    const ctx = await browser.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 1, reducedMotion: reduced ? 'reduce' : 'no-preference' }); const p = await ctx.newPage(); const logs = [];
    p.on('pageerror', (e) => logs.push('PAGEERROR ' + e.message));
    await p.goto(`http://127.0.0.1:${PORT}/games/coldcall/index.html?nosplash&force=bonus1`, { waitUntil: 'load' });
    await p.waitForFunction(() => window.CC && CC.ready && !CC.core.st.busy, null, { timeout: 60000 }); await sleep(400);
    if (name === 'auto_0_7s') await p.evaluate(() => { CC.core.st.auto = true; });          // autoplay on BEFORE the spin: the intro must place the call in 0.7 s
    await p.evaluate(() => document.getElementById('spin').click());
    await p.waitForSelector('.dial', { timeout: 120000 }); const t0 = Date.now(); await sleep(name === 'auto_0_7s' ? 0 : 700);
    if (name !== 'auto_0_7s') await act(p);
    await p.waitForFunction(() => document.querySelector('.dial.done'), null, { timeout: 40000 }); const tDone = Date.now() - t0; await sleep(400);
    const st = await p.evaluate(() => ({ lit: [...document.querySelectorAll('.dial .key.lit')].map((k) => k.dataset.k + ':' + k.textContent.trim()), lcd: document.querySelector('.dial .lcd b').textContent, anim: document.getAnimations().filter((a) => /keyflip|padpop|padhint/.test(a.animationName || '')).length }));
    const dialed = await p.waitForFunction(() => { const b = document.querySelector('#chN.set b'); return b ? b.textContent : null; }, null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => 'not seen');
    await p.waitForFunction(() => !document.querySelector('.dial'), null, { timeout: 15000 });
    await p.waitForFunction(() => document.getElementById('bh') && !document.getElementById('bh').hidden, null, { timeout: 20000 }).catch(() => {});
    out[name] = { doneAfterMs: tDone, ...st, youDialed: dialed, bonusStarted: await p.evaluate(() => !document.getElementById('bh').hidden), logs };
    console.log(name, JSON.stringify(out[name])); await ctx.close();
  }
  fs.writeFileSync(path.join(__dirname, (ONLY.length ? 'after_inputs_' + ONLY.join('_') : 'after_inputs') + '.json'), JSON.stringify(out, null, 1)); await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
