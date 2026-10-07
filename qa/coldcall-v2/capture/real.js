// THE PULL wave 2, real-server coverage (builder V). The real page, real clicks, a REAL server on 4640 (never 4610, no other port) started by this driver with the
// preload real_hooks.js (potRng / minBal / decision timer from env and flag files; games/* untouched), data in _scratch/srv.
//   node real.js <ghost|pot|cold|void|all> [play|chips|both] [540|360|both]
// Output: qa/coldcall-v2/pull/real_<item>_<size>_<mode>.png, one JSON line per (item, size, mode): {item, size, mode, verdict: PASS|FAIL|NOT_REACHABLE, checks, detail}.
// Independent evidence: every socket.io frame the page receives is recorded (page.on('websocket')), and the wallet is read over a second socket. Nothing is read from the UI to judge the UI.
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const { launch } = require('./qalib');
const ROOT = path.join(__dirname, '..', '..', '..');
const io = require(path.join(ROOT, '_scratch', 'sio', 'node_modules', 'socket.io-client'));
const PORT = 4640, PIN = '1234', BASE = `http://127.0.0.1:${PORT}/games/coldcall/index.html`;
const SRV = path.join(ROOT, '_scratch', 'srv'), FLAGS = path.join(SRV, 'flags'), OUT = path.join(ROOT, 'qa', 'coldcall-v2', 'pull');
const SIZES = [[540, 960, '540'], [360, 740, '360']];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = () => Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 4);

// ------------------------------------------------------------------------------------------------ the server (own child process, 4640)
let child = null;
const alive = () => child && child.exitCode == null && child.signalCode == null;
function freePort() {                                         // 4640 only: whatever stock server holds it is replaced by ours (the stock one is restored by _scratch/start4640.sh at the end)
  try { const o = require('child_process').execSync(`ss -ltnp 'sport = :${PORT}'`).toString(), m = /pid=(\d+)/.exec(o); if (m && !(child && +m[1] === child.pid)) { process.kill(+m[1], 'SIGTERM'); require('child_process').execSync('sleep 1.5'); } } catch {}
}
function startServer(opts = {}) {
  freePort();
  if (opts.fresh) { fs.rmSync(SRV, { recursive: true, force: true }); }
  fs.mkdirSync(FLAGS, { recursive: true });
  if (!fs.existsSync(path.join(SRV, 'bank.json'))) fs.writeFileSync(path.join(SRV, 'bank.json'), '{}');
  if (!fs.existsSync(path.join(SRV, 'ledger.json'))) fs.writeFileSync(path.join(SRV, 'ledger.json'), '[]');
  const log = fs.openSync(path.join(SRV, 'server.log'), 'a');
  child = spawn('node', ['-r', path.join(__dirname, 'real_hooks.js'), 'server.js'], {
    cwd: ROOT, stdio: ['ignore', log, log], detached: true,
    env: { ...process.env, PORT: String(PORT), COLDCALL_TEST: '1', BANK_FILE: path.join(SRV, 'bank.json'), LEDGER_FILE: path.join(SRV, 'ledger.json'), CC_FLAGS: FLAGS, CC_POT_MINBAL: process.env.CC_POT_MINBAL || '1', ...(opts.env || {}) },
  });
  child.unref(); fs.writeFileSync(path.join(SRV, 'pid'), String(child.pid));
  return waitUp();
}
async function waitUp() { for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/games/coldcall/index.html`); if (r.ok) return; } catch {} await sleep(250); } throw new Error('server did not come up'); }
function stopServer(sig = 'SIGTERM') {
  return new Promise((res) => { if (!alive()) return res(); child.once('exit', () => res()); try { process.kill(child.pid, sig); } catch { res(); } setTimeout(res, 8000); });
}
async function killAll() { await stopServer('SIGTERM'); }   // graceful: the store, wallet and bank are flushed on exit
const logText = () => { try { return fs.readFileSync(path.join(SRV, 'server.log'), 'utf8'); } catch { return ''; } };
const nk = (n) => String(n).toLowerCase().trim();
const E = require(path.join(ROOT, 'games', 'coldcall-engine.js'));
function editStore(fn) {                                      // only while the server is stopped
  const f = path.join(SRV, 'coldcall-pull.json'); let d; try { d = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { d = { v: 1, players: {}, pot: {}, open: {} }; }
  d.players = d.players || {}; d.pot = d.pot || {}; d.open = d.open || {}; fn(d); fs.writeFileSync(f, JSON.stringify(d));
}
const potSeed = (bal) => ({ bal, fed: bal, seeded: 0, paid: 0, rem: 0, last: null });

// ------------------------------------------------------------------------------------------------ the account as the server has it (second socket)
function sockSession(name) {
  return new Promise((resolve, reject) => {
    const s = io(`http://127.0.0.1:${PORT}`, { forceNew: true }); let tried = false;
    s.on('connect', () => s.emit('auth_login', { name, pin: PIN }));
    s.on('auth_error', () => { if (!tried) { tried = true; s.emit('auth_signup', { name, pin: PIN, avatar: 'a01' }); } else reject(new Error('auth')); });
    s.on('auth_ok', () => resolve(s)); setTimeout(() => reject(new Error('sock timeout')), 15000);
  });
}
const serverState = (s) => new Promise((res) => { s.once('g:coldcall:state', res); s.emit('g:coldcall:state', {}); });
async function srvState(name) { const s = await sockSession(name); const st = await serverState(s); s.close(); return st; }
const serverWallet = async (name) => (await srvState(name)).wallet;
const createAccount = async (name) => { await serverWallet(name); };

// ------------------------------------------------------------------------------------------------ the page
// every frame received: { t, ev, d }
function tapFrames(page, frames) {
  page.on('websocket', (ws) => ws.on('framereceived', (f) => {
    const s = typeof f.payload === 'string' ? f.payload : ''; if (!/^4\d\[/.test(s)) return;
    try { const a = JSON.parse(s.slice(s.indexOf('['))); frames.push({ t: Date.now(), ev: a[0], d: a[1] }); } catch {}
  }));
}
// in-page sampler: every distinct caption / toast / stamp text the screen showed, with time
const SAMPLER = () => {
  window.__seen = []; const add = (k, v) => { if (v && !window.__seen.some((x) => x.k === k && x.v === v)) window.__seen.push({ k, v, t: Date.now() }); };
  setInterval(() => {
    document.querySelectorAll('.toast').forEach((n) => add('toast', n.textContent)); add('cap', (document.getElementById('capT') || {}).textContent);
    const g = document.querySelector('.plgh'); if (g) add('ghost', g.textContent.replace(/\s+/g, ' '));
    const f = document.getElementById('plFeed'); if (f && !f.hidden) add('feed', f.textContent);
    const p = document.getElementById('plpot'); if (p) add('potcard', p.textContent.replace(/\s+/g, ' '));
    const bn = document.getElementById('plBn'); if (bn && !bn.hidden && bn.textContent) add('banner', bn.textContent.replace(/\s+/g, ' '));
    const w = document.getElementById('win'); if (w) add('win', w.textContent);
  }, 40);
};
async function open(w, h, name, mode, frames) {
  const b = await launch(w, h), { page } = b; b.errs = []; page.on('pageerror', (e) => b.errs.push(e.message)); tapFrames(page, frames || []);
  await page.addInitScript(SAMPLER);
  await page.goto(`${BASE}?live=1&nosplash&name=${name}&pin=${PIN}`);
  await page.waitForFunction(() => window.CC && CC.ready && CC.core.st.live, null, { timeout: 30000 });
  if (mode === 'chips') { await page.click('#modebar button[data-m=chips]'); await page.waitForFunction(() => CC.core.st.mode === 'chips'); }
  await sleep(1200); return b;
}
async function setBet(page, cents) { for (let i = 0; i < 40; i++) { const cur = await page.evaluate(() => CC.core.st.bets[CC.core.st.betIdx]); if (cur === cents) return true; await page.click(cur > cents ? '#betDn' : '#betUp'); await sleep(40); } return false; }
const open_ = (page, k) => page.evaluate((kk) => !!(CC.core.st.ctx && CC.core.st.ctx.promptOpen === kk), k);
const nrounds = (page) => page.evaluate(() => CC.dbg.rounds.length);
const cents = (txt, mode) => (mode === 'chips' ? Math.round(parseFloat(String(txt).replace(/[, a-z]/gi, ''))) : Math.round(parseFloat(String(txt).replace(/[$,]/g, '')) * 100));
const text = (page, id) => page.evaluate((i) => (document.getElementById(i) || {}).textContent, id);
const money = (c, mode) => (mode === 'chips' ? Math.round(c).toLocaleString('en-US') : '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
async function tapDial(page) { if (await page.locator('.dial').count()) await page.evaluate(() => { const d = document.querySelector('.dial'); if (d && d._finish) d._finish(); }).catch(() => {}); }
async function clickLit(page) { const p = await page.evaluate(() => CC.board.hotList()[0]); await page.locator('#slots i').nth(p).click({ force: true, timeout: 5000 }); return p; }
const clickBank = async (page) => page.click((await page.locator('#pl_bank').count()) ? '#pl_bank' : '#cc_more_bank');
async function buyBonus(page) { await page.click('#buy'); await page.click('#buy_bonus1'); await page.click('#buy_confirm'); }
async function buyUntilPick(page, tries = 10) {           // returns n0 once a PICK prompt is up (a bonus whose first phone has < 2 leads has none: buy again)
  for (let i = 0; i < tries; i++) {
    const n0 = await nrounds(page); await buyBonus(page);
    for (let t0 = Date.now(); ;) {
      if (await open_(page, 'pick')) return n0;
      if (await page.evaluate((n) => CC.dbg.rounds.length > n && !CC.core.st.busy, n0)) break;
      await tapDial(page); if (Date.now() - t0 > 150000) throw new Error('no pick prompt'); await sleep(250);
    }
    await sleep(600);
  }
  throw new Error('no bonus offered a pick');
}
// drive a round to its end with real clicks on whatever prompt comes (pick: first lit square, more: bank); onTick(page) every 60 ms; stops at the end of the round or when stop() is true
async function playOut(page, n0, { onTick, stop, ms = 240000 } = {}) {
  for (const t0 = Date.now(); ;) {
    if (stop && stop()) return 'stop';
    if (await page.evaluate((n) => CC.dbg.rounds.length > n && !CC.core.st.busy, n0)) return 'done';
    if (await open_(page, 'pick')) { await clickLit(page); await sleep(300); }
    else if (await open_(page, 'more')) { await clickBank(page); await sleep(300); }
    await tapDial(page); if (onTick) await onTick(page);
    if (Date.now() - t0 > ms) throw new Error('round did not end'); await sleep(60);
  }
}
const lastDone = (frames, after = 0) => { for (let i = frames.length - 1; i >= 0; i--) { const f = frames[i]; if (f.ev === 'g:coldcall:result' && f.d && f.d.status === 'done' && f.t >= after) return f; } return null; };
const verdict = (checks, extra = {}) => ({ verdict: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL', checks, ...extra });
const xTxt = (x) => (x >= 100 ? Math.round(x).toLocaleString('en-US') : String(+Number(x).toFixed(1))) + 'x';
const dur = (ms) => { const m = Math.max(1, Math.ceil(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60; return d ? d + ' d ' + h + ' h' : h ? h + ' h ' + mm + ' m' : mm + ' m'; };

// ================================================================================================ 1. a REAL ghost
async function ghost(size, mode) {
  const [w, h, tag] = size, name = 'rg' + uniq(), frames = []; await createAccount(name);
  const b = await open(w, h, name, mode, frames), { page } = b; const file = `${OUT}/real_ghost_${tag}_${mode}.png`;
  try {
    const minT = (E.CFG.pull.ghost || {}).minTenths || 50; let prevWallet = (await serverWallet(name))[mode], shot = null, spins = 0, missed = [], walletBad = [];
    await setBet(page, 10); if (await page.evaluate(() => CC.core.st.turbo)) await page.click('#turbo');   // a ghost is never shown in turbo
    for (; spins < 400 && !shot; spins++) {
      const n0 = await nrounds(page), t0 = Date.now(); await page.click('#spin');
      let atShot = null;
      await playOut(page, n0, { onTick: async () => {
        if (!atShot && (await page.evaluate(() => !!document.querySelector('.plgh')))) {
          await sleep(550);   // the stamp's own slam-in is 300 ms
          if (await page.evaluate(() => !!document.querySelector('.plgh'))) {
            atShot = await page.evaluate(() => { const s = document.querySelector('.plgh'); return { title: s.querySelector('.t').textContent, v: s.querySelector('.v').textContent, sub: s.querySelector('small').innerText.replace(/\n/g, ' / '), win: document.getElementById('win').textContent, bal: document.getElementById('bal').textContent }; });
            await page.screenshot({ path: file });
          }
        }
      } });
      await sleep(500);
      const r = lastDone(frames, t0 - 50); if (!r) continue; const d = r.d, g = d.pull && d.pull.ghost, hadBonus = !!(d.script && d.script.bonus);
      const delta = d.wallet[mode] - prevWallet; if (delta !== d.totalWin - d.cost) walletBad.push({ round: d.roundId, delta, expect: d.totalWin - d.cost }); prevWallet = d.wallet[mode];
      const seenStamp = await page.evaluate((id) => (window.__seen || []).some((x) => x.k === 'ghost'), null);
      if (g && g.pay >= minT && !hadBonus && !atShot) missed.push({ round: d.roundId, pay: g.pay });
      if (atShot) shot = { r, d, g, atShot, winAfter: await text(page, 'win'), balAfter: await text(page, 'bal') };
      void seenStamp;
    }
    if (!shot) return { verdict: 'NOT_REACHABLE', checks: {}, detail: { spins, note: 'no ghost in ' + spins + ' real spins', walletBad } };
    const { d, g, atShot } = shot, bet = d.betCents, wFinal = await serverWallet(name);
    const expectX = xTxt(g.pay / 10), betCents = d.bet;
    const checks = {
      multipleEqualsPay: atShot.v === expectX, titleOk: /IF A PHONE HAD LANDED/.test(atShot.title), notPaidLine: /Not paid/.test(atShot.sub), payAtOrAboveMin: g.pay >= minT,
      winIsSubOneX: d.totalWinMult < 1, ghostNotInWin: d.totalWin === Math.floor(d.totalWinTenths * betCents / 10) || d.totalWin === Math.round(d.totalWinTenths * betCents / 10), meterIsTotalWin: cents(shot.winAfter, mode) === d.totalWin && cents(atShot.win, mode) <= d.totalWin,
      walletDeltaIsWinMinusCost: walletBad.length === 0, balanceMeterIsWallet: cents(shot.balAfter, mode) === wFinal[mode], noMissedGhost: missed.length === 0, noPageError: b.errs.length === 0,
    };
    return verdict(checks, { detail: { spins: spins, round: d.roundId, ghostPay: g.pay, shownMultiple: atShot.v, expectX, sub: atShot.sub, bet: betCents, cost: d.cost, totalWin: d.totalWin, totalWinMult: d.totalWinMult, winMeterAtStamp: atShot.win, winMeterAfter: shot.winAfter, balAtStamp: atShot.bal, balAfter: shot.balAfter, serverWallet: wFinal[mode], missed, walletBad, pageErrors: b.errs.slice(0, 3), shot: path.relative(ROOT, file) } });
  } finally { await b.browser.close(); }
}

// ================================================================================================ 2. a REAL pot win
async function pot(size, mode) {
  const [w, h, tag] = size, name = 'rp' + uniq(), frames = []; await createAccount(name);
  await stopServer(); editStore((d) => { d.pot.play = potSeed(2500); d.pot.chips = potSeed(2500); }); await startServer();
  const b = await open(w, h, name, mode, frames), { page } = b; const file = `${OUT}/real_pot_${tag}_${mode}.png`;
  try {
    await setBet(page, 100); const potBefore = (await srvState(name)).pot[mode].bal, w0 = (await serverWallet(name))[mode];
    const meterBefore = await page.evaluate(() => (document.querySelector('#plPot b') || {}).textContent || null);
    fs.writeFileSync(path.join(FLAGS, 'pot_hit'), '1'); const n0 = await nrounds(page), t0 = Date.now(); await page.click('#spin');
    let at = null, tPot = null;
    await playOut(page, n0, { onTick: async () => {
      if (!at && (await page.evaluate(() => !!document.getElementById('plpot')))) {
        tPot = Date.now(); await sleep(1500);   // the amount counts up for 1.1 s
        at = await page.evaluate(() => { const p = document.getElementById('plpot'); return p ? { txt: p.textContent.replace(/\s+/g, ' '), em: p.querySelector('em').textContent, win: document.getElementById('win').textContent, bal: document.getElementById('bal').textContent } : null; });
        if (at) await page.screenshot({ path: file });
      }
    } });
    // after the celebration: let the feed ticker run through its beats, then read the end state
    const potWait = Date.now(); let feedDom = null; while (Date.now() - potWait < 9000 && !feedDom) { feedDom = await page.evaluate(() => { const x = (window.__seen || []).filter((s) => s.k === 'feed' && /POT/.test(s.v)); return x.length ? x[0].v : null; }); await sleep(250); }
    await sleep(300);
    const r = lastDone(frames, t0 - 50), d = r && r.d; if (!d || !d.pot || !d.pot.won) return { verdict: 'FAIL', checks: { potWon: false }, detail: { note: 'pot hook did not produce a pot win', result: d && { pot: d.pot, totalWin: d.totalWin } } };
    const st = await srvState(name), wAfter = st.wallet[mode], prize = d.pot.amount;
    const feedFrame = frames.find((f) => f.ev === 'floor:feed' && f.d && f.d.kind === 'pot' && f.d.mode === mode), potFrame = frames.filter((f) => f.ev === 'floor:pot' && f.d.mode === mode).pop();
    const meterAfter = await page.evaluate(() => (document.querySelector('#plPot b') || {}).textContent || null), win = await text(page, 'win'), bal = await text(page, 'bal');
    const checks = {
      celebrationShown: !!at, celebrationAmount: !!at && at.em.replace(/[ ,a-z$]/gi, '') === String(mode === 'chips' ? prize : (prize / 100).toFixed(2)).replace(/[,]/g, '') || (!!at && cents(at.em, mode) === prize),
      winMeterIsTotalWin: cents(win, mode) === d.totalWin && (!at || cents(at.win, mode) <= d.totalWin), potNotInWinMeter: cents(win, mode) === d.totalWin,
      walletDelta: wAfter - w0 === d.totalWin + prize - d.cost, balanceMeterIsWallet: cents(bal, mode) === wAfter,
      feedFrameHasPot: !!feedFrame && feedFrame.d.amount === prize && feedFrame.d.who === name, feedLineOnScreen: !!feedDom,
      potMeterReset: st.pot[mode].bal === (potFrame ? potFrame.d.bal : -1) && cents(meterAfter, mode) === st.pot[mode].bal && st.pot[mode].bal < potBefore, noPageError: b.errs.length === 0,
      potPrizeUnderCap: prize <= E.CFG.pull.pot.maxPayX * d.betCents,
    };
    return verdict(checks, { detail: { bet: d.betCents, cost: d.cost, totalWin: d.totalWin, prize, walletBefore: w0, walletAfter: wAfter, expectDelta: d.totalWin + prize - d.cost, delta: wAfter - w0, potBefore, potAfterServer: st.pot[mode].bal, meterBefore, meterAfter, celebration: at, winMeter: win, balMeter: bal, feedLine: feedDom, pageErrors: b.errs.slice(0, 3), shot: path.relative(ROOT, file) } });
  } finally { await b.browser.close(); }
}

// ================================================================================================ 3. the cold line of a long-idle account
const HOUR = 3600e3;
async function cold(size, mode) {
  const [w, h, tag] = size, id = uniq(), cases = { A: 'rcA' + id, B: 'rcB' + id, D: 'rcD' + id, N: 'rcN' + id }, frames = [];
  for (const n of Object.values(cases)) await createAccount(n);
  await stopServer();
  const t = Date.now();
  const mk = (lt, coldAt, warm = []) => ({ ...E.newState(), lt, coldAt, warm, warmBet: warm.length ? 10 : 0 });
  editStore((d) => {
    const fl = Math.round(E.CFG.pull.cold.floor * 10);
    for (const m of ['play', 'chips']) {
      (d.players[nk(cases.A)] = d.players[nk(cases.A)] || {})[m] = mk(fl + 600, t + 2 * HOUR + 12 * 60e3 + 40e3, [3, 8]);   // above the floor, 2 warm squares, coldAt ahead (about 2 h 12 m 40 s at page load)
      (d.players[nk(cases.B)] = d.players[nk(cases.B)] || {})[m] = mk(fl + 600, t - 5 * HOUR);                              // long idle: coldAt 5 h in the PAST, one event already happened
      (d.players[nk(cases.D)] = d.players[nk(cases.D)] || {})[m] = mk(fl + 10, t + 40 * 60e3);                              // one lead above the floor ("goes")
    }
  });
  await startServer();
  const file = (k) => `${OUT}/real_cold${k === 'A' ? '' : k}_${tag}_${mode}.png`, res = {}; let allOk = true; const detail = {};
  for (const k of ['A', 'B', 'D', 'N']) {
    const fr = [], bb = await open(w, h, cases[k], mode, fr), { page } = bb;
    try {
      const sf = fr.filter((f) => f.ev === 'g:coldcall:state').pop(); if (!sf) { res[k] = { noState: false }; allOk = false; continue; }
      const view = sf.d.pull[mode], c = view.cold, at = sf.t;
      const exp = (nowMs) => { if (!c) return null; const left = c.inMs - (nowMs - at), n = c.leads, wm = c.warm | 0; const subj = n ? `${n} ${n === 1 ? 'lead' : 'leads'}` + (wm ? ` + ${wm} warm` : '') : `${wm} warm ${wm === 1 ? 'lead' : 'leads'}`; return `${subj} ${n + wm === 1 ? 'goes' : 'go'} cold ${left <= 0 ? 'now' : 'in ' + dur(left)}`; };
      const dom = () => page.evaluate(() => { const e = document.getElementById('plCold'), n = document.getElementById('plNote'); return { line: e ? e.textContent : null, hidden: !n || n.hidden || n.classList.contains('nocold') || getComputedStyle(n).display === 'none', leads: (document.getElementById('plN') || {}).textContent, of: (document.getElementById('plOf') || {}).textContent }; });
      await sleep(1500); const d0 = await dom(); await page.screenshot({ path: file(k) });
      const okNow = (s) => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16].some((lag) => s === exp(Date.now() - lag * 1000));   // the line redraws every 15 s
      const r = { view: { leads: view.leads, lt: view.lt, cold: c }, shown: d0, expected: exp(Date.now()), expectedNum: String(view.leads) };
      r.checks = { lineMatchesView: c ? d0.line === exp(Date.now()) || okNow(d0.line) : d0.hidden, leadsNumber: d0.leads === String(view.leads), ofList: d0.of === '/ ' + E.CFG.pull.list };
      if (k === 'A' || k === 'B') {
        r.checks.cameFromSeed = !!c && c.leads === 8 && c.warm === (k === 'A' ? 2 : 0) && (k === 'A' ? c.inMs > 2 * HOUR : c.inMs > 6 * HOUR && c.inMs < 7 * HOUR + 60e3);
        if (k === 'B') r.checks.leakAppliedAtView = view.lt === E.CFG.pull.cold.floor * 10 + 600 - Math.round(E.CFG.pull.cold.batch * 10);
      }
      if (k === 'D') r.checks.oneLeadGrammar = !!c && c.leads === 1 && / goes cold /.test(d0.line || '');
      if (k === 'N') r.checks.noColdLineWhenNothingGoesCold = !c && d0.hidden;
      if (k === 'A' && mode === 'play') {   // counts down: wait past the minute step (+15 s redraw) and compare again
        const first = d0.line; await sleep(78000); const d1 = await dom(); r.afterWait = d1.line; r.checks.countsDown = d1.line !== first && okNow(d1.line);
        await page.screenshot({ path: file('A').replace('.png', '_later.png') });
      }
      r.pageErrors = bb.errs.slice(0, 3); r.checks.noPageError = bb.errs.length === 0;
      if (k === 'B') {   // a real spin from the long-idle account: the engine's own leak report vs the banner
        await setBet(page, 10); const n0 = await nrounds(page), t0 = Date.now(); await page.click('#turbo'); await page.click('#spin'); await playOut(page, n0); await sleep(500);
        const dd = lastDone(fr, t0 - 50); r.spin = { leaked: dd && dd.d.pull.leaked, banner: await page.evaluate(() => (window.__seen || []).filter((x) => x.k === 'banner').map((x) => x.v)) };
      }
      res[k] = r; for (const v of Object.values(r.checks)) if (!v) allOk = false;
    } finally { await bb.browser.close(); }
  }
  return { verdict: allOk ? 'PASS' : 'FAIL', checks: Object.fromEntries(Object.entries(res).map(([k, v]) => [k, v.checks ? Object.values(v.checks).every(Boolean) : false])), detail: res, shots: Object.keys(cases).map((k) => path.relative(ROOT, file(k))) };
}

// ================================================================================================ 4. a REAL voided round
async function void_(size, mode) {
  const [w, h, tag] = size, name = 'rv' + uniq(), frames = []; await createAccount(name);
  await stopServer(); await startServer();   // clean process, the account exists
  const out = { restart: null, connected: null };
  // ---- 4a: the server restarts (kill -9) while a PICK prompt is on screen
  {
    const b = await open(w, h, name, mode, frames), { page } = b; const file = `${OUT}/real_void_${tag}_${mode}.png`;
    try {
      await setBet(page, 10); await page.click('#turbo'); const w0 = (await serverWallet(name))[mode];
      const n0 = await buyUntilPick(page), id = await page.evaluate(() => CC.core.st.ctx.p.roundId); await sleep(400);
      const open1 = (await srvState(name)).open, cost = open1 && open1.cost, wMid = (await serverWallet(name))[mode];
      await page.screenshot({ path: file.replace('.png', '_prompt.png') });
      await stopServer('SIGKILL'); const tKill = Date.now(); await sleep(1200); await startServer(); const tUp = Date.now();
      const t0 = Date.now(); let recovered = null; const seen = [];
      while (Date.now() - t0 < 90000) { const s = await page.evaluate(() => ({ busy: CC.core.st.busy, scrims: document.querySelectorAll('.scrim').length, prompt: !!(CC.core.st.ctx && CC.core.st.ctx.promptOpen), hot: document.querySelectorAll('#slots i.pick').length, cap: document.getElementById('capT').textContent })); if (!s.busy && !s.scrims && !s.prompt) { recovered = Date.now() - tUp; break; } await sleep(300); }
      await sleep(700); await page.screenshot({ path: file });
      const wRef = (await serverWallet(name))[mode], st2 = await srvState(name), ui = await page.evaluate(() => ({ busy: CC.core.st.busy, scrims: document.querySelectorAll('.scrim, .plbar, #pl_bank, #pl_more').length, picks: document.querySelectorAll('#slots i.pick').length, left: document.querySelectorAll('#floats > *, #ov > *, #scene > *, .stamp').length, bal: document.getElementById('bal').textContent, cap: document.getElementById('capT').textContent, toasts: (window.__seen || []).filter((x) => x.k === 'toast').map((x) => x.v), caps: (window.__seen || []).filter((x) => x.k === 'cap').map((x) => x.v), aborted: (CC.dbg.rounds[CC.dbg.rounds.length - 1] || {}).aborted, mismatch: CC.dbg.mismatch.length, pull: CC.dbg.pull.length, err: CC.dbg.error || null }));
      // second restart: nothing is refunded again
      await stopServer('SIGKILL'); await sleep(800); await startServer(); const wTwice = (await serverWallet(name))[mode];
      // reload the page: no stuck round, no leftover prompt, a spin works
      await page.reload(); await page.waitForFunction(() => window.CC && CC.ready && CC.core.st.live, null, { timeout: 30000 }); await sleep(1500);
      if (mode === 'chips') { await page.click('#modebar button[data-m=chips]'); await sleep(300); }
      const afterReload = await page.evaluate(() => ({ busy: CC.core.st.busy, scrims: document.querySelectorAll('.scrim, #pl_bank, #pl_more').length, adopted: CC.dbg.adopted || 0, picks: document.querySelectorAll('#slots i.pick').length }));
      await setBet(page, 10); const nn = await nrounds(page); await page.click('#turbo'); await page.click('#spin'); await playOut(page, nn); const spinOk = (await nrounds(page)) === nn + 1;
      const openLeft = (() => { try { return Object.keys(JSON.parse(fs.readFileSync(path.join(SRV, 'coldcall-pull.json'), 'utf8')).open || {}).length; } catch { return -1; } })();   // the server does not log (no module.log): the store's open table is the record
      const checks = {
        costWasCharged: !!cost && wMid === w0 - cost, serverOpenWasOnRecord: !!open1 && open1.roundId === id, storeOpenTableEmpty: openLeft === 0,
        refundExactlyOnce: wRef === w0 && wTwice === w0, noOpenAfterRestart: !st2.open && (st2.opens || []).length === 0,
        uiRecovered: recovered != null && ui.busy === false, recoveredWithin10s: recovered != null && recovered < 10000, captionNotTimesUp: !ui.caps.some((c) => /TIME'S UP/.test(c)), toastSaysRefund: ui.toasts.some((x) => /cancelled|refund/i.test(x)), noLeftoverPrompt: ui.scrims === 0 && ui.picks === 0 && ui.left === 0, balanceMeterIsWallet: cents(ui.bal, mode) === wRef,
        cleanAfterReload: !afterReload.busy && afterReload.scrims === 0 && afterReload.picks === 0 && afterReload.adopted === 0, spinWorksAfter: spinOk,
        noMismatch: ui.mismatch === 0 && ui.pull === 0 && !ui.err,
      };
      out.restart = { checks, detail: { roundId: id, cost, w0, wMid, wAfterRestart: wRef, wAfterSecondRestart: wTwice, recoveredAfterMsFromServerUp: recovered, killToUpMs: tUp - tKill, ui, afterReload, spinOk, storeOpenAfter: openLeft, shot: path.relative(ROOT, file) } };
    } finally { await b.browser.close(); }
  }
  // ---- 4b: voided while the page is connected (settle throws once through the potRng hook: reason settle_error)
  {
    const fr = [], b = await open(w, h, name, mode, fr), { page } = b; const file = `${OUT}/real_voidlive_${tag}_${mode}.png`;
    try {
      await setBet(page, 10); await page.click('#turbo'); const w0 = (await serverWallet(name))[mode];
      const n0 = await buyUntilPick(page), cost = ((await srvState(name)).open || {}).cost; fs.writeFileSync(path.join(FLAGS, 'void_next'), '1');
      const t0 = Date.now(); let voided = null;
      await playOut(page, n0, { stop: () => !!fr.find((f) => f.ev === 'g:coldcall:voided' && f.t >= t0 - 50) || false });
      for (let i = 0; i < 40 && !voided; i++) { voided = fr.find((f) => f.ev === 'g:coldcall:voided' && f.t >= t0 - 50); await sleep(100); }
      let shot = false; for (let i = 0; i < 50; i++) { const hasToast = await page.evaluate(() => !!document.querySelector('.toast')); if (hasToast) { await sleep(150); await page.screenshot({ path: file }); shot = true; break; } await sleep(60); }
      await page.waitForFunction(() => !CC.core.st.busy, null, { timeout: 30000 }).catch(() => {}); await sleep(900); if (!shot) await page.screenshot({ path: file });
      const wRef = (await serverWallet(name))[mode], st = await srvState(name), ui = await page.evaluate(() => ({ busy: CC.core.st.busy, scrims: document.querySelectorAll('.scrim, .plbar, #pl_bank, #pl_more').length, picks: document.querySelectorAll('#slots i.pick').length, left: document.querySelectorAll('#floats > *, #ov > *, #scene > *, .stamp').length, bal: document.getElementById('bal').textContent, cap: document.getElementById('capT').textContent, toasts: (window.__seen || []).filter((x) => x.k === 'toast').map((x) => x.v), row: CC.dbg.rounds[CC.dbg.rounds.length - 1], mismatch: CC.dbg.mismatch.length, pull: CC.dbg.pull.length, err: CC.dbg.error || null }));
      const nn = await nrounds(page); await page.click('#spin'); await playOut(page, nn); const spinOk = (await nrounds(page)) === nn + 1;
      const checks = {
        voidedEventArrived: !!voided && voided.d.reason === 'settle_error' && voided.d.refund === cost && voided.d.roundId === (ui.row && ui.row.id || voided.d.roundId), refundExactlyOnce: wRef === w0, noOpenOnServer: !st.open,
        uiAborted: ui.row && ui.row.aborted === 'voided', toastSane: ui.toasts.some((x) => /cancelled/i.test(x) && /refund/i.test(x)), uiRecovered: ui.busy === false, noLeftoverPrompt: ui.scrims === 0 && ui.picks === 0 && ui.left === 0,
        balanceMeterIsWallet: cents(ui.bal, mode) === wRef, spinWorksAfter: spinOk, noPageError: b.errs.length === 0 && !ui.err,
      };
      out.connected = { checks, detail: { cost, w0, wAfter: wRef, voidedEvent: voided && voided.d, ui, spinOk, shot: path.relative(ROOT, file) } };
    } finally { await b.browser.close(); }
  }
  const all = { ...Object.fromEntries(Object.entries(out.restart.checks).map(([k, v]) => ['restart_' + k, v])), ...Object.fromEntries(Object.entries(out.connected.checks).map(([k, v]) => ['live_' + k, v])) };
  return verdict(all, { detail: out });
}

// ================================================================================================ main
(async () => {
  const item = process.argv[2] || 'all', mm = process.argv[3] || 'both', sz = process.argv[4] || 'both';
  const modes = mm === 'both' ? ['play', 'chips'] : [mm], sizes = SIZES.filter((s) => sz === 'both' || s[2] === sz);
  const items = item === 'all' ? ['ghost', 'pot', 'cold', 'void'] : item.split(','), fns = { ghost, pot, cold, void: void_ };
  if (!process.env.KEEP_SERVER) await startServer({ fresh: true }); else await startServer();
  fs.mkdirSync(OUT, { recursive: true });
  for (const it of items) for (const size of sizes) for (const mode of modes) {
    let res; const t0 = Date.now();
    try { res = await fns[it](size, mode); } catch (e) { res = { verdict: 'FAIL', checks: {}, error: String(e && e.stack || e).slice(0, 800) }; }
    console.log(JSON.stringify({ item: it, size: size[2], mode, seconds: Math.round((Date.now() - t0) / 1000), ...res }));
  }
  await killAll(); process.exit(0);
})();
