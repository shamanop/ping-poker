'use strict';
// Shared pieces of the P6 w3a drivers (smoke.js, errors.js). Headless Chromium through the same playwright-core / executable as qa/coldcall-fb1/fb2fb3/drivers/qalib.js.
// Reads money from the data dir's money.jsonl (the ledger itself), never from the screen.
const fs = require('fs'), path = require('path');
const { chromium } = require('/usr/lib/node_modules/openclaw/node_modules/playwright-core');
const EXE = process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argOf = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : d; };
const hasFlag = (f) => process.argv.includes(f);

// ---- check collector: one row per check { name, pass, expected, got }
function checks() {
  const rows = [];
  const add = (name, pass, expected, got) => { rows.push({ name, pass: !!pass, expected, got }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (pass ? '' : '  expected=' + JSON.stringify(expected) + ' got=' + JSON.stringify(got))); return !!pass; };
  return { rows, add, eq: (name, got, expected) => add(name, JSON.stringify(got) === JSON.stringify(expected), expected, got), ok: (name, cond, got) => add(name, cond, true, got === undefined ? !!cond : got),
    get passed() { return rows.filter((r) => r.pass).length; }, get failed() { return rows.filter((r) => !r.pass).length; } };
}

// ---- browser (one process; killed by PID on exit even when the script dies)
let LIVE = null;
const { execSync } = require('child_process');
// playwright-core has no browser.process(): the browser is our direct child, so its PID is the chrome child of this node process
function childChrome() { try { return Number(execSync('pgrep -P ' + process.pid + ' -f chrome', { encoding: 'utf8' }).trim().split('\n')[0]) || null; } catch (e) { return null; } }
async function launch(w = 540, h = 960) {
  const browser = await chromium.launch({ executablePath: EXE, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage'] });
  const pid = childChrome(); LIVE = pid;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const logs = [], bad = [];
  page.on('console', (m) => { if (m.type() === 'error') logs.push('console.error: ' + m.text().slice(0, 240) + ' @' + (m.location().url || '').slice(-60)); });
  page.on('pageerror', (e) => logs.push('pageerror: ' + String(e.message).slice(0, 240)));
  page.on('response', (r) => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(-80)); });
  return { browser, ctx, page, logs, bad, pid };
}
process.on('exit', () => { if (LIVE) { try { process.kill(LIVE, 'SIGKILL'); } catch (e) { /* gone */ } } });
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => process.exit(130));
async function closeBrowser(b) { if (!b) return; try { await b.browser.close(); } catch (e) { /* ignore */ } if (b.pid) { try { process.kill(b.pid, 0); await sleep(300); process.kill(b.pid, 'SIGKILL'); } catch (e) { /* already gone */ } } LIVE = null; }

// ---- the ledger: replay money.jsonl (transfers and batches) into balances
function readLedger(dataDir) {
  const bal = new Map(), reasons = []; let txt = '';
  try { txt = fs.readFileSync(path.join(dataDir, 'money.jsonl'), 'utf8'); } catch (e) { /* not there yet */ }
  const add = (a, cur, n) => bal.set(a + '|' + cur, (bal.get(a + '|' + cur) || 0) + n);
  for (const l of txt.split('\n')) {
    if (!l.trim()) continue; let r; try { r = JSON.parse(l); } catch (e) { continue; }   // a half-written last line
    const items = Array.isArray(r.batch) ? r.batch : [r];
    for (const it of items) { const cur = it.cur || r.cur; add(it.from, cur, -it.amount); add(it.to, cur, it.amount); reasons.push({ id: r.id, reason: it.reason || r.reason, ref: r.ref, from: it.from, to: it.to, amount: it.amount, cur }); }
  }
  return { get: (acct, cur) => bal.get(acct + '|' + cur) || 0, bal, reasons,
    // seats(): what this account has on tables (the shell's Chips plate is bank + table stacks)
    seats: (key, cur) => [...bal].filter(([k]) => k.startsWith('seat:') && k.endsWith(':' + key + '|' + cur)).reduce((n, [, v]) => n + v, 0),
     escrows: [...bal].filter(([k, v]) => /^escrow:/.test(k) && v !== 0).map(([k, v]) => k + '=' + v) };
}
const storeOf = (key, mode) => (mode === 'chips' ? 'bank:' + key : 'play:' + key);

// ---- screen number parsing: Play $ = "$1,234.56" -> cents, Chips = "1,234" -> chips
const toUnits = (txt, mode) => { const t = String(txt || '').replace(/[^0-9.\-]/g, ''); if (t === '') return NaN; return mode === 'chips' ? Math.round(parseFloat(t)) : Math.round(parseFloat(t) * 100); };

// ---- the shell: sign up (a real form), claim the daily bonus (a real click), open Cold Call from the dock
async function signUp(page, base, name, pin = '1234') {
  await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#lb-name', { timeout: 60000 });
  await page.click('button:has-text("New account")'); await page.fill('#lb-name', name); await page.fill('#lb-pin', pin); await page.click('#lb-submit');
  await page.waitForFunction(() => window.Shell && Shell.isSignedIn && Shell.isSignedIn(), null, { timeout: 60000 });
  const claim = page.locator('button.claim'); let claimed = false;
  try { await claim.waitFor({ state: 'visible', timeout: 6000 }); await claim.click(); claimed = true; await claim.waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {}); } catch (e) { /* no daily modal */ }
  await sleep(800);
  return { claimed };
}
const frameOf = (page) => page.frames().find((f) => /games\/coldcall/.test(f.url()));
async function openColdCall(page) {
  await page.locator('button.sh-di', { hasText: 'Cold Call' }).click();
  let fr = null; for (let i = 0; i < 120 && !fr; i++) { fr = frameOf(page); if (!fr) await sleep(250); }
  if (!fr) throw new Error('no Cold Call frame after clicking the dock button');
  await fr.waitForFunction(() => window.CC && CC.ready, null, { timeout: 120000 });
  const go = fr.locator('#go'); if (await go.count()) { await go.click({ timeout: 20000 }); await sleep(900); }
  await fr.waitForFunction(() => CC.core.st.live, null, { timeout: 60000 });
  return fr;
}

// ---- reading state (evaluate reads only)
const frState = (fr) => fr.evaluate(() => {
  const st = CC.core.st, rows = CC.dbg.rounds;
  return { live: st.live, kind: CC.core.T.kind, mode: st.mode, busy: st.busy, bal: document.getElementById('bal').textContent, spinLabel: document.getElementById('spin').textContent, rounds: rows.length,
    prompt: (st.ctx && st.ctx.promptOpen) || null, scrims: document.querySelectorAll('#ov .scrim').length, mismatch: CC.dbg.mismatch.slice(0, 6), aborted: CC.dbg.aborted || 0, error: CC.dbg.error || null,
    bet: st.bets[st.betIdx], bets: st.bets.slice() };
});
const plates = (page) => page.evaluate(() => ({ play: (document.querySelector('#sh-play .plate__value') || {}).textContent, chips: (document.querySelector('#sh-chips .plate__value') || {}).textContent }));

// a tap on the shell's socket: every g:coldcall:result / error the server sent this page (read only)
async function installTap(page) {
  await page.evaluate(() => { window.__tap = { res: [], err: [] }; PingSocket.on('g:coldcall:result', (p) => window.__tap.res.push(p)); PingSocket.on('error', (e) => window.__tap.err.push(e)); });
}
const tapRes = (page) => page.evaluate(() => window.__tap.res.slice());
const tapErr = (page) => page.evaluate(() => window.__tap.err.slice());

// ---- player actions (real pointer clicks)
async function setBet(fr, cents) {
  for (let i = 0; i < 40; i++) {
    const cur = await fr.evaluate(() => CC.core.st.bets[CC.core.st.betIdx]); if (cur === cents) return true;
    await fr.locator(cur > cents ? '#betDn' : '#betUp').click({ timeout: 15000 }); await sleep(40);
  }
  return false;
}
const armedWait = (fr) => fr.waitForFunction(() => { const c = CC.core.st.ctx; return !c || !c.promptOpenedAt || performance.now() - c.promptOpenedAt >= 800; }, null, { timeout: 8000 }).catch(() => {});
async function clickLit(fr) {                      // a lit square of the board: a real mouse click at its centre
  await armedWait(fr); const p = await fr.evaluate(() => CC.board.hotList()[0]);
  await fr.locator('#slots i').nth(p).click({ force: true, timeout: 8000 }); return p;
}
async function clickMore(fr, take) {
  await armedWait(fr);
  const sel = (await fr.locator('#pl_more').count()) ? (take ? '#pl_more' : '#pl_bank') : (take ? '#cc_more_take' : '#cc_more_bank');
  await fr.locator(sel).click({ timeout: 8000 });
}
async function tapDial(page, fr) {                 // the intro dial of a bonus waits for a tap: a real click on its centre
  const d = fr.locator('.dial'); if (!(await d.count())) return false;
  const bb = await d.first().boundingBox().catch(() => null); if (!bb) return false;
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); return true;
}
// Wait for the round that started at `n0` rounds to end (screen idle and a new round row), answering every prompt by a real click.
// opts.take: answer ONE MORE CALL with take (true) or HANG UP (false). Returns { answered: {pick, more, hang}, ms }
async function finishRound(page, fr, n0, opts = {}) {
  const t0 = Date.now(), ans = { pick: 0, more: 0, hang: 0 }, lim = opts.ms || 300000; let lastDial = 0;
  for (;;) {
    const s = await frState(fr);
    if (s.rounds > n0 && !s.busy && !s.prompt) { await sleep(500); const s2 = await frState(fr); if (!s2.busy && !s2.prompt) return { answered: ans, ms: Date.now() - t0 }; }
    if (s.prompt === 'pick') { await clickLit(fr); ans.pick++; await sleep(500); }
    else if (s.prompt === 'more') { const take = opts.take !== undefined ? opts.take : false; await clickMore(fr, take); if (take) ans.more++; else ans.hang++; await sleep(500); }
    else if (Date.now() - lastDial > 1500 && (await tapDial(page, fr))) lastDial = Date.now();
    if (Date.now() - t0 > lim) throw new Error('round did not end in ' + lim + ' ms: ' + JSON.stringify(s));
    await sleep(250);
  }
}
async function clickSpin(page, fr) { await fr.locator('#spin').click({ timeout: 20000 }); }
async function buyBonus(fr, id) { await fr.locator('#buy').click({ timeout: 15000 }); await fr.locator('#buy_' + id).click({ timeout: 15000 }); await fr.locator('#buy_confirm').click({ timeout: 15000 }); }

// ---- sums over the server's own results: done results, one per roundId
function doneRounds(results, mode, from = 0) {
  const seen = new Map();
  for (const p of results.slice(from)) if (p && p.status === 'done' && (!mode || p.mode === mode)) seen.set(p.roundId, p);
  return [...seen.values()];
}
const sums = (rows) => ({ n: rows.length, cost: rows.reduce((n, p) => n + (p.cost || 0), 0), win: rows.reduce((n, p) => n + (p.totalWin || 0), 0), pot: rows.reduce((n, p) => n + (p.pot && p.pot.won ? p.pot.amount || 0 : 0), 0) });

module.exports = { fs, path, sleep, argOf, hasFlag, checks, launch, closeBrowser, readLedger, storeOf, toUnits, signUp, openColdCall, frameOf, frState, plates, installTap, tapRes, tapErr,
  setBet, clickLit, clickMore, tapDial, finishRound, clickSpin, buyBonus, doneRounds, sums, armedWait };
