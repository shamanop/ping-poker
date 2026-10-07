// Fix builder F1 (client flow) driver lib: real page, real clicks, the dev server on 4640 (never 4610). BEFORE=1 serves the pre-fix client files (git show 0beccf3) through
// Playwright routes, so the same driver can FAIL before and PASS after without touching the tree. Output under qa/coldcall-v2/pull/f1_*.png (shots) and one JSON line per scenario.
const { chromium } = require('/usr/lib/node_modules/openclaw/node_modules/playwright-core');
const { execSync } = require('child_process');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..', '..');
const io = require('/home/frank/.openclaw/workspace/projects/ping-coldcall-pull/_scratch/sio/node_modules/socket.io-client');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const PORT = +(process.env.CCPORT || 4651), PIN = '1234', BASE = 'http://127.0.0.1:' + PORT + '/games/coldcall/index.html';
const BEFORE = !!process.env.BEFORE, OLD = '0beccf3', OUT = path.join(ROOT, '_scratch', 'fb1c', 'f1out');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FILES = ['game.js', 'board.js', 'bonus.js', 'pull.js', 'pull.css', 'phone.js'];
async function launch(w = 540, h = 960) {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  if (BEFORE) for (const f of FILES) { const body = execSync(`git show ${OLD}:public/games/coldcall/${f}`, { cwd: ROOT, maxBuffer: 1 << 26 }); await ctx.route('**/games/coldcall/' + f + '*', (r) => r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : 'application/javascript', body })); }
  if (BEFORE) { const body = execSync(`git show ${OLD}:public/shell.js`, { cwd: ROOT, maxBuffer: 1 << 26 }); await ctx.route('**/shell.js*', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body })); }
  return { browser, ctx };
}
async function page(ctx, name, q = '') {
  const p = await ctx.newPage(); p.logs = [];
  p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) p.logs.push(m.type() + ': ' + m.text()); }); p.on('pageerror', (e) => p.logs.push('PAGEERROR: ' + e.message));
  await p.goto(`${BASE}?live=1&nosplash&name=${name}&pin=${PIN}${q}`);
  await p.waitForFunction(() => window.CC && CC.ready && CC.core.st.live, null, { timeout: 30000 });
  await sleep(400); return p;
}
const mode = async (p, m) => { if (m === 'chips') { await p.click('#modebar button[data-m=chips]'); await p.waitForFunction(() => CC.core.st.mode === 'chips'); await sleep(300); } };
async function setBet(p, cents) { for (let i = 0; i < 40; i++) { const cur = await p.evaluate(() => CC.core.st.bets[CC.core.st.betIdx]); if (cur === cents) return true; await p.click(cur > cents ? '#betDn' : '#betUp'); await sleep(40); } return false; }
async function buy(p, id) { await p.click('#buy'); await p.click('#buy_' + id); await p.click('#buy_confirm'); }
const promptOpen = (p) => p.evaluate(() => (CC.core.st.ctx && CC.core.st.ctx.promptOpen) || null);
const tapDial = (p) => p.evaluate(() => { const d = document.querySelector('.dial'); if (d && d._finish) { d._finish(); return true; } return false; }).catch(() => false);
const idle = (p, ms = 240000) => p.waitForFunction(() => !CC.core.st.busy, null, { timeout: ms });
const uniq = (t) => t + (Date.now() % 1e6).toString(36) + Math.random().toString(36).slice(2, 4);
function sock(name) { return new Promise((resolve, reject) => { const s = io('http://127.0.0.1:' + PORT, { forceNew: true }); let tried = false; s.on('connect', () => s.emit('auth_login', { name, pin: PIN })); s.on('auth_error', () => { if (!tried) { tried = true; s.emit('auth_signup', { name, pin: PIN, avatar: 'a01' }); } else reject(new Error('auth')); }); s.on('auth_ok', () => resolve(s)); setTimeout(() => reject(new Error('sock timeout')), 15000); }); }
const sstate = (s) => new Promise((res) => { s.once('g:coldcall:state', res); s.emit('g:coldcall:state', {}); });
const shist = (s) => new Promise((res) => { s.once('g:coldcall:history', res); s.emit('g:coldcall:history', {}); });
// walk a round on the page to a prompt kind ('pick' | 'more'); answers a PICK with a tap on a lit square when going for 'more'. null if the round ended without it.
async function toPrompt(p, want, maxMs = 150000) {
  const t0 = Date.now();
  for (;;) {
    await tapDial(p); const k = await promptOpen(p).catch(() => null); if (k === want) return true;
    if (k === 'pick' && want === 'more') { await sleep(800); const c = await p.evaluate(() => { const s = document.querySelector('.slots i.pick'); if (!s) return null; const r = s.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }); if (c) { await p.mouse.click(c[0], c[1]); await sleep(300); } }
    if (!(await p.evaluate(() => CC.core.st.busy)) && Date.now() - t0 > 2500) return false; if (Date.now() - t0 > maxMs) return false; await sleep(100);
  }
}
async function reach(p, want, tries = 8) { for (let i = 0; i < tries; i++) { await buy(p, 'bonus1'); if (await toPrompt(p, want)) return true; await idle(p).catch(() => {}); await sleep(3200); } return false; }
const out = (o) => console.log(JSON.stringify({ build: BEFORE ? 'BEFORE' : 'AFTER', ...o }));
module.exports = { launch, page, mode, setBet, buy, promptOpen, tapDial, idle, sleep, sock, sstate, shist, toPrompt, reach, uniq, out, PORT, PIN, BASE, BEFORE, OUT, ROOT };
