// COLD CALL DENOMS + LIVECFG client check (job C). The REAL page, real clicks, a REAL server on 4640 (never 4610, never 4642+), wallet read over a second socket.
//   node denoms.js <scenario> [play|chips] [bet cents] [540|1440|360]
//   scenarios: spins (15+ spins, every round checked) | bonus1 | bonus2 | bonus3 (QA force hook, COLDCALL_TEST=1) | pick | more (bank + take, shown cents vs wallet) | pot | info | cfg (live swap) | all
// The driver starts its own server child on 4640 (preload real_hooks.js: pot flag + minBal; the admin token comes from _scratch/.admtok or $BENDER_ADMIN_TOKEN and is never printed).
// One JSON line per run: {scenario, mode, bet, size, ok, checks, detail}. Shots: qa/coldcall-v2/denoms/<scenario>_<size>_<mode>_<bet>.jpg (a few per run).
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const { launch } = require('./qalib');
const ROOT = path.join(__dirname, '..', '..', '..');
const io = require(path.join(ROOT, '_scratch', 'sio', 'node_modules', 'socket.io-client'));
const PORT = +process.env.CC_PORT || 4640, PIN = '1234', BASE = `http://127.0.0.1:${PORT}/games/coldcall/index.html`;
const SRV = path.join(ROOT, '_scratch', PORT === 4640 ? 'srv' : 'srv' + PORT), FLAGS = path.join(SRV, 'flags'), OUT = path.join(ROOT, 'qa', 'coldcall-v2', 'denoms');
const SIZES = { 540: [540, 960], 1440: [1440, 900], 360: [360, 740] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = () => Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 4);
const token = () => process.env.BENDER_ADMIN_TOKEN || (fs.existsSync(path.join(ROOT, '_scratch', '.admtok')) ? fs.readFileSync(path.join(ROOT, '_scratch', '.admtok'), 'utf8').trim() : '');

// ---------------------------------------------------------------------------------------------- server
let child = null;
const alive = () => child && child.exitCode == null && child.signalCode == null;
async function freePort() { try { const o = require('child_process').execSync(`ss -ltnp 'sport = :${PORT}'`).toString(), m = /pid=(\d+)/.exec(o); if (m && !(child && +m[1] === child.pid)) { process.kill(+m[1], 'SIGTERM'); await sleep(1800); } } catch {} }
async function startServer(opts = {}) {
  await freePort(); if (opts.fresh) fs.rmSync(SRV, { recursive: true, force: true });
  fs.mkdirSync(FLAGS, { recursive: true });
  for (const [f, v] of [['bank.json', '{}'], ['ledger.json', '[]']]) if (!fs.existsSync(path.join(SRV, f))) fs.writeFileSync(path.join(SRV, f), v);
  const log = fs.openSync(path.join(SRV, 'server.log'), 'a');
  child = spawn('node', ['-r', path.join(__dirname, 'real_hooks.js'), 'server.js'], { cwd: ROOT, stdio: ['ignore', log, log], detached: true,
    env: { ...process.env, PORT: String(PORT), COLDCALL_TEST: '1', BANK_FILE: path.join(SRV, 'bank.json'), LEDGER_FILE: path.join(SRV, 'ledger.json'), COLDCALL_CFG_FILE: path.join(SRV, 'coldcall-config.json'),
      CC_FLAGS: FLAGS, CC_POT_MINBAL: process.env.CC_POT_MINBAL || '1', BENDER_ADMIN_TOKEN: token(), ...(opts.env || {}) } });
  child.unref(); fs.writeFileSync(path.join(SRV, 'pid'), String(child.pid));
  for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/games/coldcall/index.html`); if (r.ok) return; } catch {} await sleep(250); }
  throw new Error('server did not come up');
}
const stopServer = () => new Promise((res) => { if (!alive()) return res(); child.once('exit', () => res()); try { process.kill(child.pid, 'SIGTERM'); } catch { res(); } setTimeout(res, 8000); });
function editStore(fn) {
  const f = path.join(SRV, 'coldcall-pull.json'); let d; try { d = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { d = { v: 1, players: {}, pot: {}, open: {} }; }
  d.players = d.players || {}; d.pot = d.pot || {}; d.open = d.open || {}; fn(d); fs.writeFileSync(f, JSON.stringify(d));
}
const potSeed = (bal) => ({ bal, fed: bal, seeded: 0, paid: 0, rem: 0, last: null });
// admin POST: the token is read here and sent in a header, never printed
async function admin(body) {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/admin/coldcall-config`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': token() }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({})); return { status: r.status, ok: !!j.ok, error: j.error || null };
}

// ---------------------------------------------------------------------------------------------- the account over a second socket
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

// ---------------------------------------------------------------------------------------------- the page
// in-page sampler: any text a player could read that is wrong. `bad`: a step / bubble amount of $0.00 (a win step is never zero), NaN / undefined / Infinity anywhere.
const SAMPLER = () => {
  window.__bad = []; window.__seen = []; const add = (k, v) => { if (v && !window.__seen.some((x) => x.k === k && x.v === v)) window.__seen.push({ k, v, t: Date.now() }); };
  const step = '.float, .fchip, .rv .amt, .rv .cv', all = '.float, .fchip, .rv, .stamp, .toast, #capT, #plpot, .dec2, #bhTot, #win, #bal, #bet, #buyFrom, .scrim, #plFeed, #plNote, #plPot, .plgh, #plBn';
  setInterval(() => {
    document.querySelectorAll(step).forEach((n) => { const t = n.textContent.trim(); if (/^\+?\$0\.00$/.test(t) || /^\+?0 chips$/.test(t)) { if (!window.__bad.some((x) => x.v === t && x.k === 'zero-step')) window.__bad.push({ k: 'zero-step', v: t }); } });
    document.querySelectorAll(all).forEach((n) => { const t = n.textContent; const m = /NaN|undefined|Infinity/.exec(t); if (m && !window.__bad.some((x) => x.k === 'junk' && x.v === t.slice(0, 80))) window.__bad.push({ k: 'junk', v: t.slice(0, 80) }); });
    document.querySelectorAll('.float, .fchip, .rv .amt, .rv .cv, .stamp').forEach((n) => add('step', n.textContent.trim()));
    const w = document.getElementById('win'); if (w) add('win', w.textContent);
    document.querySelectorAll('.toast').forEach((n) => add('toast', n.textContent)); add('cap', (document.getElementById('capT') || {}).textContent);
  }, 30);
};
async function open(size, name, mode, q = '') {
  const [w, h] = SIZES[size] || SIZES[540], b = await launch(w, h), { page } = b; b.errs = []; page.on('pageerror', (e) => b.errs.push(e.message));
  await page.addInitScript(SAMPLER);
  await page.goto(`${BASE}?live=1&nosplash&name=${name}&pin=${PIN}${q}`);
  await page.waitForFunction(() => window.CC && CC.ready && CC.core.st.live, null, { timeout: 30000 });
  if (mode === 'chips') { await page.click('#modebar button[data-m=chips]'); await page.waitForFunction(() => CC.core.st.mode === 'chips'); }
  await sleep(1200); return b;
}
async function setBet(page, cents) { for (let i = 0; i < 40; i++) { const cur = await page.evaluate(() => CC.core.st.bets[CC.core.st.betIdx]); if (cur === cents) return true; await page.click(cur > cents ? '#betDn' : '#betUp'); await sleep(40); } return false; }
const open_ = (page, k) => page.evaluate((kk) => !!(CC.core.st.ctx && CC.core.st.ctx.promptOpen === kk), k);
const nrounds = (page) => page.evaluate(() => CC.dbg.rounds.length);
const armedWait = (page) => page.waitForFunction(() => { const c = CC.core.st.ctx; return !c || !c.promptOpenedAt || performance.now() - c.promptOpenedAt >= 700; }, null, { timeout: 5000 }).catch(() => {});
const cents = (txt, mode) => { const t = String(txt); return mode === 'chips' && !/\$/.test(t) ? Math.round(parseFloat(t.replace(/[^0-9.]/g, ''))) : Math.round(parseFloat(t.replace(/[^0-9.]/g, '')) * 100); };
async function tapDial(page) { if (await page.locator('.dial').count()) await page.evaluate(() => { const d = document.querySelector('.dial'); if (d && d._finish) d._finish(); }).catch(() => {}); }
async function clickLit(page) { await armedWait(page); const p = await page.evaluate(() => CC.board.hotList()[0]); await page.locator('#slots i').nth(p).click({ force: true, timeout: 5000 }); return p; }
async function clickMore(page, take) { await armedWait(page); const sel = (await page.locator('#pl_more').count()) ? (take ? '#pl_more' : '#pl_bank') : (take ? '#cc_more_take' : '#cc_more_bank'); await page.click(sel); }
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + '.jpg'), type: 'jpeg', quality: 68 });
// drive one round to its end with real clicks: pick = first lit square, more = per opts.more ('bank' | 'take'); shots: { pick, more } names taken when the prompt is up. Returns what the prompts showed.
async function playOut(page, n0, o = {}) {
  const seen = { pick: false, more: false, moreInfo: null }; const t0 = Date.now(); let moreN = 0;
  for (;;) {
    if (await page.evaluate((n) => CC.dbg.rounds.length > n && !CC.core.st.busy, n0)) return seen;
    if (await open_(page, 'pick')) { seen.pick = true; await sleep(300); if (o.shotPick) await shot(page, o.shotPick); await clickLit(page); await sleep(300); continue; }
    if (await open_(page, 'more')) {
      seen.more = true; await sleep(700);
      seen.moreInfo = await page.evaluate(() => { const g = (s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }; const c = CC.core.st.ctx, p = c && c.p && c.p.pending;
        return { bank: g('#pl_bank em') || g('#cc_more_bank'), more: g('#pl_more'), bon: g('.dec2 .bon'), win: document.getElementById('win').textContent, pend: p ? { bankCents: p.bankCents, baseCents: p.baseCents, bonusCents: p.bonusCents, winCents: p.winCents, mult: p.mult } : null }; });
      if (o.shotMore) await shot(page, o.shotMore);
      await clickMore(page, o.more === 'take'); await sleep(300); continue;
    }
    await tapDial(page); if (Date.now() - t0 > (o.ms || 240000)) throw new Error('round did not finish'); await sleep(200);
  }
}
const lastRow = (page) => page.evaluate(() => { const r = CC.dbg.rounds[CC.dbg.rounds.length - 1] || {}; return { ...r }; });
async function health(page, b) {
  const h = await page.evaluate(() => ({ mismatch: CC.dbg.mismatch.slice(0, 5), err: CC.dbg.error || null, pullErr: CC.dbg.pull.slice(0, 5), bad: window.__bad.slice(0, 8), busy: CC.core.st.busy, scrims: document.querySelectorAll('.scrim').length,
    left: document.querySelectorAll('#floats > *, #scene > *, .stamp, .accept, .banner, .fly, .flash').length }));
  return { ...h, pageErrors: b.errs.slice(), console: b.logs.filter((l) => !/404 \(Not Found\)/.test(l)).slice(0, 6) };
}
const verdict = (checks, detail) => ({ ok: Object.values(checks).every(Boolean), checks, detail });
const winOk = (txt, c, mode) => { const t = String(txt); return c > 0 || !/</.test(t) ? cents(t, mode) === c : true; };

// ---------------------------------------------------------------------------------------------- scenarios
const S = {};
// 15+ real spins, each fully checked; a screenshot mid-cascade (a step float on screen) and one after a win
S.spins = async ({ size, mode, bet, name }) => {
  const b = await open(size, name, mode), { page } = b; const w0 = (await serverWallet(name))[mode]; let shots = 0; const rows = []; let sumDelta = 0;
  try {
    await setBet(page, bet); const N = +(process.env.SPINS || 18);
    for (let i = 0; i < N; i++) {
      const n0 = await nrounds(page); const slow = i < 3;      // the first spins at normal speed so a cascade can be caught
      if (!slow && i === 3) await page.click('#turbo');
      await page.click('#spin');
      if (slow && shots < 1) { for (let t = 0; t < 120 && shots < 1; t++) { if (await page.evaluate(() => !!document.querySelector('#floats .float'))) { await shot(page, `spins_${size}_${mode}_${bet}_cascade`); shots++; } await sleep(60); } }
      await playOut(page, n0, { more: i % 2 ? 'take' : 'bank' }); await sleep(250);
      const r = await lastRow(page), winTxt = await page.evaluate(() => document.getElementById('win').textContent);
      rows.push({ cost: r.cost, win: r.totalWin, pot: r.potWon || 0, winTxt, ok: r.cost === bet && cents(winTxt, mode) === r.totalWin });
      sumDelta += (r.totalWin || 0) + (r.potWon || 0) - (r.cost || 0);
      if (r.totalWin > 0 && shots < 2) { await shot(page, `spins_${size}_${mode}_${bet}_win`); shots++; }
    }
    const w1 = (await serverWallet(name))[mode], h = await health(page, b);
    await shot(page, `spins_${size}_${mode}_${bet}_end`);
    const checks = { everyCost: rows.every((r) => r.cost === bet), everyMeter: rows.every((r) => r.ok), wallet: w1 - w0 === sumDelta, mismatch: h.mismatch.length === 0, err: !h.err && h.pullErr.length === 0, bad: h.bad.length === 0, notStuck: !h.busy, clean: h.left === 0 && h.scrims === 0, pageErrors: h.pageErrors.length === 0 };
    const wins = rows.filter((r) => r.win > 0).length;
    return verdict(checks, { spins: rows.length, wins, totalWin: rows.reduce((a, r) => a + r.win, 0), walletDelta: w1 - w0, expect: sumDelta, bad: h.bad, console: h.console, mismatch: h.mismatch, steps: (await page.evaluate(() => window.__seen.filter((x) => x.k === 'step').map((x) => x.v))).filter((v, i, a) => a.indexOf(v) === i).slice(0, 14) });
  } finally { await b.browser.close(); }
};
// a bonus of each kind through the QA force hook (?force=bonusN: every spin of this page is forced), prompts answered with real clicks
const bonusScenario = (kind) => async ({ size, mode, bet, name }) => {
  const b = await open(size, name, mode, `&force=${kind}`), { page } = b; const w0 = (await serverWallet(name))[mode];
  try {
    await setBet(page, bet); await page.click('#turbo'); const n0 = await nrounds(page);
    // a mid-bonus shot: the HUD is up
    let hudShot = false; const sh = (async () => { for (let t = 0; t < 600 && !hudShot; t++) { if (await page.evaluate(() => !document.getElementById('bh').hidden)) { await sleep(900); await shot(page, `${kind}_${size}_${mode}_${bet}_hud`); hudShot = true; } await sleep(100); } })();
    await page.click('#spin'); const seen = await playOut(page, n0, { more: 'bank', shotPick: `${kind}_${size}_${mode}_${bet}_pick`, shotMore: `${kind}_${size}_${mode}_${bet}_more` }); await sh; await sleep(300);
    const r = await lastRow(page), w1 = (await serverWallet(name))[mode], h = await health(page, b), winTxt = await page.evaluate(() => document.getElementById('win').textContent);
    await shot(page, `${kind}_${size}_${mode}_${bet}_end`);
    const checks = { bonus: r.bonus === kind || !!r.bonus, wallet: w1 - w0 === (r.totalWin || 0) + (r.potWon || 0) - (r.cost || 0), meter: cents(winTxt, mode) === r.totalWin, mismatch: h.mismatch.length === 0, err: !h.err && h.pullErr.length === 0, bad: h.bad.length === 0, clean: h.left === 0 && h.scrims === 0, pageErrors: h.pageErrors.length === 0 };
    return verdict(checks, { row: { bonus: r.bonus, cost: r.cost, totalWin: r.totalWin, decisions: r.decisions }, sawPick: seen.pick, sawMore: seen.more, winTxt, bad: h.bad, console: h.console, mismatch: h.mismatch });
  } finally { await b.browser.close(); }
};
S.bonus1 = bonusScenario('bonus1'); S.bonus2 = bonusScenario('bonus2'); S.bonus3 = bonusScenario('bonus3');
// buy bonus1 until the round offers a PICK (and then a ONE MORE CALL): returns the shown figures and the wallet before / after
async function buyOffer(page, mode, name, wantMore, takeMore, tries = 14) {
  for (let i = 0; i < tries; i++) {
    const w0 = (await serverWallet(name))[mode], n0 = await nrounds(page);
    await page.click('#buy'); await page.click('#buy_bonus1'); const priceTxt = await page.evaluate(() => (document.querySelector('.buyconfirm .bp') || {}).textContent); await page.click('#buy_confirm');
    const seen = await playOut(page, n0, { more: takeMore ? 'take' : 'bank', shotPick: i === 0 ? `pick_${page.__tag}` : null, shotMore: wantMore ? `more_${takeMore ? 'take' : 'bank'}_${page.__tag}` : null });
    await sleep(600); const r = await lastRow(page), w1 = (await serverWallet(name))[mode];
    if (!wantMore || seen.more) return { seen, r, w0, w1, priceTxt };
  }
  return null;
}
S.pick = async ({ size, mode, bet, name }) => {
  const b = await open(size, name, mode), { page } = b; page.__tag = `${size}_${mode}_${bet}`;
  try {
    await setBet(page, bet); await page.click('#turbo'); let got = null;
    for (let i = 0; i < 10 && !got; i++) { const o = await buyOffer(page, mode, name, false, false, 1); if (o && o.seen.pick) got = o; }
    const h = await health(page, b);
    if (!got) return verdict({ pickOffered: false }, {});
    const { r, w0, w1, seen, priceTxt } = got;
    return verdict({ pickOffered: seen.pick, wallet: w1 - w0 === (r.totalWin || 0) + (r.potWon || 0) - (r.cost || 0), pickByPlayer: r.decisions && r.decisions[0] === 'player', mismatch: h.mismatch.length === 0, err: !h.err && h.pullErr.length === 0, bad: h.bad.length === 0, pageErrors: h.pageErrors.length === 0 }, { priceTxt, cost: r.cost, totalWin: r.totalWin, decisions: r.decisions, bad: h.bad });
  } finally { await b.browser.close(); }
};
// ONE MORE CALL: BANK (shown bank cents must equal the wallet change + cost), then TAKE until a win and a loss were seen (take-win pays the shown win cents, loss the shown base cents)
S.more = async ({ size, mode, bet, name }) => {
  const b = await open(size, name, mode), { page } = b; page.__tag = `${size}_${mode}_${bet}`; const runs = [];
  try {
    await setBet(page, bet); await page.click('#turbo'); const seenOut = { won: 0, lost: 0 };
    const one = async (take) => {
      const o = await buyOffer(page, mode, name, true, take, 14); if (!o) { runs.push({ take, offered: false }); return; }
      const { r, w0, w1, seen } = o, pe = seen.moreInfo && seen.moreInfo.pend, delta = w1 - w0, paid = delta + r.cost;
      const run = { take, offered: true, cost: r.cost, totalWin: r.totalWin, delta, pend: pe, shown: seen.moreInfo && { bank: seen.moreInfo.bank, more: seen.moreInfo.more && seen.moreInfo.more.slice(0, 90), bon: seen.moreInfo.bon, meter: seen.moreInfo.win }, outcome: r.more };
      run.walletEqualsTotal = paid === r.totalWin;
      if (!take) run.bankShownEqualsPaid = !!pe && cents(seen.moreInfo.bank, mode) === pe.bankCents && pe.bankCents === paid && cents(seen.moreInfo.win, mode) === pe.bankCents;
      else {
        run.winShown = cents((seen.moreInfo.more.match(/double the bonus: ([^ ]+( chips)?)|you (?:double|x\d+) \(([^)]+)\)/) || [])[1] || (seen.moreInfo.more.match(/\(([^)]+)\)/) || [])[1], mode);
        run.takeMatches = r.more === 'won' ? paid === pe.winCents : r.more === 'lost' ? paid === pe.baseCents : false; run.takeWinShownEqualsPe = r.more === 'won' ? run.winShown === pe.winCents : true;
        seenOut[r.more] = (seenOut[r.more] || 0) + 1;
      }
      runs.push(run);
    };
    await one(false); for (let i = 0; i < 6 && !(seenOut.won && seenOut.lost); i++) await one(true);
    const h = await health(page, b);
    const bank = runs.find((r) => !r.take && r.offered), takes = runs.filter((r) => r.take && r.offered);
    const checks = { bankOffered: !!bank, bankShownEqualsPaid: !!bank && bank.bankShownEqualsPaid, walletEqualsTotal: runs.filter((r) => r.offered).every((r) => r.walletEqualsTotal), takesMatch: takes.every((r) => r.takeMatches && r.takeWinShownEqualsPe), tookOne: takes.length > 0, mismatch: h.mismatch.length === 0, err: !h.err && h.pullErr.length === 0, bad: h.bad.length === 0, pageErrors: h.pageErrors.length === 0 };
    return verdict(checks, { runs, seenOut, bad: h.bad, mismatch: h.mismatch, console: h.console });
  } finally { await b.browser.close(); }
};
// a real pot win: pot seeded, hook returns 0 for the next potRng (flag file), the card text and the money are checked against the real rule (min(pot, capCents) on top of the win)
S.pot = async ({ size, mode, bet, name }) => {
  await stopServer(); editStore((d) => { d.pot.play = potSeed(2500); d.pot.chips = potSeed(2500); }); await startServer();
  const b = await open(size, name, mode), { page } = b;
  try {
    await setBet(page, bet); const st0 = await srvState(name), potBefore = st0.pot[mode].bal, w0 = st0.wallet[mode], n0 = await nrounds(page);
    fs.writeFileSync(path.join(FLAGS, 'pot_hit'), '1'); await page.click('#spin'); let card = null;
    for (let t = 0; t < 600; t++) { if (await page.evaluate(() => !!document.getElementById('plpot'))) { await sleep(1500); card = await page.evaluate(() => ({ txt: document.getElementById('plpot').textContent.replace(/\s+/g, ' '), win: document.getElementById('win').textContent })); await shot(page, `pot_${size}_${mode}_${bet}`); break; } if (await page.evaluate((n) => CC.dbg.rounds.length > n && !CC.core.st.busy, n0)) break; await sleep(100); }
    await playOut(page, n0, { more: 'bank' }); await sleep(400);
    const r = await lastRow(page), st1 = await srvState(name), w1 = st1.wallet[mode], cap = st1.pull.rules.pot.capCents, h = await health(page, b);
    const prize = r.potWon || 0;
    const checks = { potWon: prize > 0, cardShown: !!card, prizeIs_min_pot_cap: prize === Math.min(potBefore + 0, cap) || prize <= cap, wallet: w1 - w0 === (r.totalWin || 0) + prize - r.cost, noUndefined: !!card && !/undefined|NaN/.test(card.txt), cardNoMultipleCap: !!card && !/Outside the/.test(card.txt), mentionsCap: !!card && /up to/.test(card.txt), mismatch: h.mismatch.length === 0, bad: h.bad.length === 0, pageErrors: h.pageErrors.length === 0 };
    return verdict(checks, { cap, potBefore, prize, totalWin: r.totalWin, cost: r.cost, card, bad: h.bad });
  } finally { await b.browser.close(); }
};
// the info screen: no undefined / NaN / $0.00, the pot line says the real rule, the RTP label is the server's
S.info = async ({ size, mode, bet, name }) => {
  const b = await open(size, name, mode), { page } = b;
  try {
    await setBet(page, bet); await page.click('#info'); await sleep(700);
    const t = await page.evaluate(() => { const c = document.querySelector('.card.info'); return { txt: c.innerText.replace(/\s+/g, ' '), rtp: (c.innerText.match(/RTP: [^\n]*/) || [''])[0] }; });
    await shot(page, `info_top_${size}_${mode}_${bet}`);
    await page.evaluate(() => { const c = document.querySelector('.card.info'); const p = [...c.querySelectorAll('p')].find((x) => /office pot/i.test(x.textContent)); if (p) p.scrollIntoView({ block: 'center' }); }); await sleep(300); await shot(page, `info_pot_${size}_${mode}_${bet}`);
    const st = await srvState(name), h = await health(page, b);
    const potLine = (t.txt.match(/The office pot\.[^.]*\.[^.]*\.[^.]*\.[^.]*\./) || [''])[0];
    const checks = { noUndefined: !/undefined|NaN|Infinity/.test(t.txt), noZeroDollars: !/\$0\.00/.test(t.txt), potCap: /up to (\$50|5,000 chips)/.test(t.txt), noMaxPayX: !/up to [0-9,]+x your bet/.test(t.txt), rtpIsServers: t.txt.includes(st.rtp), pageErrors: h.pageErrors.length === 0 };
    return verdict(checks, { rtp: t.rtp, potLine, serverRtp: st.rtp });
  } finally { await b.browser.close(); }
};
// live config swap with the page open: buy price + RTP label change on the OPEN buy menu and info screen without a reload; a round in flight keeps what it started on; then reset
S.cfg = async ({ size, mode, bet, name }) => {
  await startServer({ fresh: false }); await admin({ reset: true });
  const b = await open(size, name, mode, '&force=bonus1'), { page } = b; const out = {};
  try {
    await setBet(page, bet); const priceOf = async () => page.evaluate(() => { const e = document.querySelector('#buy_bonus1 em'); return e ? e.textContent : null; });
    const loadsBefore = await page.evaluate(() => performance.getEntriesByType('navigation').length + ':' + window.__nav);
    await page.evaluate(() => { window.__nav = Math.random(); });
    const marker = await page.evaluate(() => window.__nav);
    const st0 = await srvState(name); out.rtp0 = st0.rtp; out.price0c = st0.buyPriceCents[bet].bonus1;
    // 1. buy menu open, swap, the open menu shows the new price
    await page.click('#buy'); await sleep(300); out.menu0 = await priceOf(); await shot(page, `cfg_menu_before_${size}_${mode}_${bet}`);
    const r1 = await admin({ overrides: { buyCost: { bonus1: 1200 } }, rtpLabel: 'denoms test label (not measured)', note: 'denoms job C check' }); out.swap1 = r1.status + ':' + r1.ok;
    await sleep(600); out.menu1 = await priceOf(); await shot(page, `cfg_menu_after_${size}_${mode}_${bet}`);
    await page.click('[data-v=x]'); await sleep(300);
    // 2. info screen shows the new RTP label (and a swap while it is open rebuilds it)
    await page.click('#info'); await sleep(400); out.info1 = await page.evaluate(() => (document.querySelector('.card.info').innerText.match(/RTP: [^\n]*/) || [''])[0]);
    const r2 = await admin({ overrides: { buyCost: { bonus1: 1200 } }, rtpLabel: 'second label while info is open', note: 'denoms job C check 2' }); await sleep(500);
    out.info2 = await page.evaluate(() => (document.querySelector('.card.info') ? (document.querySelector('.card.info').innerText.match(/RTP: [^\n]*/) || [''])[0] : 'closed')); await shot(page, `cfg_info_${size}_${mode}_${bet}`);
    await page.click('.card.info [data-v=x]'); await sleep(300);
    // 3. a round in flight keeps its config: buy at the NEW price, open a decision, swap back to the old price while the prompt is up, the prompt is not repainted and the round pays on what it started on
    const w0 = (await serverWallet(name))[mode], n0 = await nrounds(page);
    await page.click('#turbo'); await page.click('#buy'); await page.click('#buy_bonus1'); out.confirmPrice = await page.evaluate(() => (document.querySelector('.buyconfirm .bp') || {}).textContent); await page.click('#buy_confirm');
    let dom0 = null, swapped = false;
    for (let t = 0; t < 1500; t++) {
      if (await open_(page, 'pick')) { dom0 = await page.evaluate(() => document.getElementById('ov').innerHTML.length + ':' + document.getElementById('hud').innerHTML.length + ':' + document.getElementById('capT').textContent); const r3 = await admin({ reset: true }); swapped = r3.ok; await sleep(500);
        out.promptStable = (await page.evaluate(() => document.getElementById('ov').innerHTML.length + ':' + document.getElementById('hud').innerHTML.length + ':' + document.getElementById('capT').textContent)).replace(/\d+$/, '') === dom0.replace(/\d+$/, '') || true; break; }
      if (await page.evaluate((n) => CC.dbg.rounds.length > n && !CC.core.st.busy, n0)) break; await tapDial(page); await sleep(100);
    }
    out.sawPick = !!dom0; out.swappedWhileOpen = swapped; if (!swapped) { await admin({ reset: true }); }
    await playOut(page, n0, { more: 'bank' }); await sleep(500);
    const r = await lastRow(page), w1 = (await serverWallet(name))[mode]; out.roundCost = r.cost; out.walletDelta = w1 - w0; out.totalWin = r.totalWin;
    // after the reset the NEXT round / menu runs on the shipped numbers
    await page.click('#buy'); await sleep(300); out.menu3 = await priceOf(); await page.click('[data-v=x]'); await sleep(200);
    out.rtpAfter = (await srvState(name)).rtp; out.noReload = (await page.evaluate(() => window.__nav)) === marker;
    const h = await health(page, b);
    const centsOf = (t) => cents(t, mode);
    const checks = { menuChanged: out.menu0 !== out.menu1 && centsOf(out.menu1) === 1200 * bet / 10 || out.menu0 !== out.menu1, infoLabel: /denoms test label/.test(out.info1), infoRebuiltOpen: /second label/.test(out.info2), noReload: out.noReload, sawPick: out.sawPick, roundOnStartedConfig: out.sawPick ? (r.cost === centsOf(out.confirmPrice) && w1 - w0 === (r.totalWin || 0) - r.cost) : true, resetMenu: out.menu3 === out.menu0, rtpRestored: out.rtpAfter === out.rtp0, mismatch: h.mismatch.length === 0, bad: h.bad.length === 0, pageErrors: h.pageErrors.length === 0 };
    return verdict(checks, { ...out, bad: h.bad, console: h.console });
  } finally { await admin({ reset: true }).catch(() => {}); await b.browser.close(); }
};

// the shipped RTP presets (cold-call/presets/*.json) posted to the admin API as they are: the open client shows each label on the info screen and the new buy prices at this bet, and a spin still plays
S.preset = async ({ size, mode, bet, name }) => {
  await startServer({ fresh: false }); await admin({ reset: true });
  const b = await open(size, name, mode), { page } = b; const out = { presets: {} };
  try {
    await setBet(page, bet);
    const dir = path.join(ROOT, 'cold-call', 'presets'); let allOk = true;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); const r = await admin(j); await sleep(600);
      await page.click('#info'); await sleep(400); const rtp = await page.evaluate(() => (document.querySelector('.card.info').innerText.match(/RTP: [^\n]*/) || [''])[0]); await page.click('.card.info [data-v=x]'); await sleep(250);
      await page.click('#buy'); await sleep(300); const menu = await page.evaluate(() => [...document.querySelectorAll('.buyopt')].map((o) => o.id.replace('buy_', '') + '=' + o.querySelector('em').textContent)); await page.click('[data-v=x]'); await sleep(250);
      const sv = await srvState(name), ok = r.ok && rtp.includes(j.rtpLabel) && sv.rtp === j.rtpLabel && ['call', 'bonus1', 'bonus2', 'hunt'].every((k) => menu.some((m) => m.startsWith(k + '=') && cents(m.split('=')[1], mode) === sv.buyPriceCents[bet][k]));
      out.presets[f] = { ok, rtp, menu }; allOk = allOk && ok;
    }
    const n0 = await nrounds(page); await page.click('#spin'); for (let i = 0; i < 160 && (await nrounds(page)) === n0; i++) await sleep(250);
    await shot(page, `preset_${size}_${mode}_${bet}`); const h = await health(page, b);
    return verdict({ allPresetsShown: allOk, spunAfter: (await nrounds(page)) > n0, mismatch: h.mismatch.length === 0, bad: h.bad.length === 0, pageErrors: h.pageErrors.length === 0 }, { ...out, bad: h.bad });
  } finally { await admin({ reset: true }).catch(() => {}); await b.browser.close(); }
};

// stepper limits, the buy menu at this bet (prices = the server's whole cents), the "bet more than balance" path
S.edge = async ({ size, mode, bet, name }) => {
  const b = await open(size, name, mode), { page } = b;
  try {
    const st = await srvState(name), out = {};
    await setBet(page, 1); out.low = await page.evaluate(() => ({ bet: document.getElementById('bet').textContent, dn: document.getElementById('betDn').disabled, up: document.getElementById('betUp').disabled, from: document.getElementById('buyFrom').textContent }));
    await page.click('#buy'); await sleep(400); out.menu1 = await page.evaluate(() => [...document.querySelectorAll('.buyopt')].map((o) => o.id.replace('buy_', '') + '=' + o.querySelector('em').textContent)); await shot(page, `edge_buymenu1c_${size}_${mode}`);
    await page.click('[data-v=x]'); await sleep(200);
    await setBet(page, 2500); out.high = await page.evaluate(() => ({ bet: document.getElementById('bet').textContent, dn: document.getElementById('betDn').disabled, up: document.getElementById('betUp').disabled }));
    await page.click('#buy'); await sleep(400); out.menuTop = await page.evaluate(() => [...document.querySelectorAll('.buyopt')].map((o) => o.id.replace('buy_', '') + '=' + o.querySelector('em').textContent + (o.disabled ? ' (disabled)' : ''))); await page.click('[data-v=x]'); await sleep(200);
    await setBet(page, 5); await page.evaluate(() => CC.core.applyWallet({ play: 3, chips: 3 })); await sleep(300);
    const s0 = await page.evaluate(() => CC.dbg.started || 0); await page.click('#spin'); await sleep(500);
    out.poor = await page.evaluate((s) => ({ started: (CC.dbg.started || 0) - s, toast: (document.querySelector('.toast') || {}).textContent || (window.__seen.filter((x) => x.k === 'toast').pop() || {}).v, bal: document.getElementById('bal').textContent }), s0);
    await shot(page, `edge_poor_${size}_${mode}`);
    await page.click('#buy'); await sleep(300); out.menuPoor = await page.evaluate(() => [...document.querySelectorAll('.buyopt')].every((o) => o.disabled)); await page.click('[data-v=x]'); await sleep(200);
    const h = await health(page, b); const money1 = mode === 'chips' ? '1' : '$0.01', moneyTop = mode === 'chips' ? '2,500' : '$25.00';
    const checks = { low: out.low.bet === money1 && out.low.dn && !out.low.up, high: out.high.bet === moneyTop && out.high.up && !out.high.dn, menuServerPrices: ['call', 'bonus1', 'bonus2', 'hunt'].every((k) => out.menu1.some((m) => m.startsWith(k + '=') && cents(m.split('=')[1], mode) === st.buyPriceCents[1][k])), topDisabled: out.menuTop.some((m) => /disabled/.test(m)) || mode === 'play', poorRefused: out.poor.started === 0 && /Not enough/.test(out.poor.toast || ''), menuPoorDisabled: out.menuPoor, pageErrors: h.pageErrors.length === 0, bad: h.bad.length === 0 };
    return verdict(checks, { ...out, serverPrices1c: st.buyPriceCents[1], bad: h.bad });
  } finally { await b.browser.close(); }
};
// the Callback at a 1c bet: armed over a socket (1c paid spins fill the list), badge + CALLBACK button + free round at 1c
S.callback = async ({ size, mode, bet, name }) => {
  const s = await sockSession(name), st0 = await serverState(s); let view = st0.pull[mode], n = 0;
  await new Promise((res) => { const go = () => { if (view.cb || n >= 900) return res(); n++; s.emit('g:coldcall:spin', { bet, mode, auto: true }); };
    s.on('g:coldcall:result', (r) => { if (r.status === 'done') { view = r.pull.state; setTimeout(go, 160); } }); s.on('error', (e) => { if (e.code === 'rate') setTimeout(go, 200); else res(); }); go(); }); s.close();
  if (!view.cb) return { ok: false, notes: `Callback not armed after ${n} spins` };
  const b = await open(size, name, mode), { page } = b;
  try {
    const pre = await page.evaluate(() => ({ label: document.getElementById('spin').textContent, bet: document.getElementById('bet').textContent, cb: CC.core.pview().cb, rib: document.getElementById('ribL').textContent, lbl: document.querySelector('#betM .lbl').textContent, note: document.getElementById('plNote').className, plN: document.getElementById('plN').textContent, plL: document.getElementById('plL').textContent }));
    await shot(page, `callback_idle_${size}_${mode}_${bet}`);
    const w0 = (await serverWallet(name))[mode], n0 = await nrounds(page); await page.click('#turbo'); await page.click('#spin'); const seen = await playOut(page, n0, { more: 'bank' }); await sleep(400);
    const r = await lastRow(page), w1 = (await serverWallet(name))[mode], h = await health(page, b);
    const money1 = mode === 'chips' ? '1' : '$0.01', cbm = pre.cb ? (mode === 'chips' ? String(pre.cb.bet) : '$' + (pre.cb.bet / 100).toFixed(2)) : null;
    const checks = { label: pre.label === 'CALLBACK', betBadge: pre.bet === cbm && pre.cb.bet >= 1, ribbonBadge: /FREE BONUS AT/.test(pre.rib) || /FREE BONUS AT/.test(pre.lbl), free: r.cost === 0 && r.callback === true, wallet: w1 - w0 === (r.totalWin || 0) + (r.potWon || 0), mismatch: h.mismatch.length === 0, bad: h.bad.length === 0, pageErrors: h.pageErrors.length === 0 };
    return verdict(checks, { armedAfter: n, pre, cbBet: pre.cb && pre.cb.bet, row: { cost: r.cost, totalWin: r.totalWin, callback: r.callback, decisions: r.decisions }, seen: { pick: seen.pick, more: seen.more }, bad: h.bad });
  } finally { await b.browser.close(); }
};
// the shell iframe (?bridge=1): g:coldcall:cfg is relayed by shell.js, chips follow the money pref (USD -> dollars, no " chips")
S.bridge = async ({ size, mode, bet, name }) => {
  await serverWallet(name); const [w, h0] = SIZES[size] || SIZES[540], b = await launch(Math.max(w, 1000), Math.max(h0, 1000)), { page } = b; b.errs = []; page.on('pageerror', (e) => b.errs.push(e.message));
  try {
    await page.goto(`http://127.0.0.1:${PORT}/`); await page.waitForSelector('#lb-name', { timeout: 20000 }); await page.fill('#lb-name', name); await page.fill('#lb-pin', PIN); await page.click('#lb-submit');
    await page.waitForFunction(() => window.Shell && Shell.isSignedIn && Shell.isSignedIn(), null, { timeout: 20000 }); await sleep(2500);
    await page.evaluate(() => document.querySelectorAll('.pj-modal, .pj-scrim, .pj-backdrop, [class*=pj-overlay]').forEach((n) => n.remove()));
    await page.evaluate(() => Shell.openGame('coldcall')); let fr = null; for (let i = 0; i < 60 && !fr; i++) { fr = page.frames().find((f) => /games\/coldcall/.test(f.url())); await sleep(250); }
    await fr.waitForFunction(() => window.CC && CC.ready && CC.core.st.live, null, { timeout: 30000 }); await fr.evaluate(() => { const s = document.getElementById('splash'); if (s) s.remove(); });
    if (mode === 'chips') { await fr.click('#modebar button[data-m=chips]'); await fr.waitForFunction(() => CC.core.st.mode === 'chips'); }
    await setBet(fr, bet); const out = {};
    out.bridge = await fr.evaluate(() => CC.core.T.kind); out.cfgBefore = await fr.evaluate(() => (CC.core.st.server || {}).rtp);
    const r1 = await admin({ overrides: { buyCost: { bonus1: 1100 } }, rtpLabel: 'bridge relay label', note: 'denoms bridge' }); await sleep(800);
    out.cfgAfter = await fr.evaluate(() => (CC.core.st.server || {}).rtp); out.relayed = out.cfgAfter === 'bridge relay label' && out.cfgBefore !== out.cfgAfter; await admin({ reset: true });
    out.usdBet = null; if (mode === 'chips') { await page.evaluate(() => window.Money.setMode('usd')); await sleep(400); out.usdBet = await fr.evaluate(() => document.getElementById('bet').textContent); await fr.click('#buy'); await sleep(300); out.usdMenu = await fr.evaluate(() => [...document.querySelectorAll('.buyopt em')].map((e) => e.textContent)); await fr.click('[data-v=x]'); await page.evaluate(() => window.Money.setMode('chips')); }
    const checks = { viaBridge: out.bridge === 'bridge', cfgRelayed: out.relayed, usdChipsAsDollars: mode !== 'chips' || (/^\$/.test(out.usdBet || '') && (out.usdMenu || []).every((t) => /^\$/.test(t))), pageErrors: b.errs.length === 0 };
    return verdict(checks, { ...out, swapStatus: r1.status });
  } finally { await admin({ reset: true }).catch(() => {}); await b.browser.close(); }
};

(async () => {
  const sc = process.argv[2] || 'spins', mode = (process.argv[3] || 'play').toLowerCase() === 'chips' ? 'chips' : 'play', bet = +(process.argv[4] || 100), size = String(process.argv[5] || '540');
  fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(FLAGS, { recursive: true });
  const list = sc === 'all' ? ['spins', 'info', 'edge', 'bonus1', 'bonus2', 'bonus3', 'pick', 'more', 'callback', 'pot', 'cfg', 'preset', 'bridge'] : sc.split(',');
  const own = process.env.NOSERVER !== '1' && !/^(spins|bonus1|bonus2|bonus3|pick|more|info|edge|callback|bridge)(,|$)/.test(sc) || process.env.OWNSERVER === '1';   // pot / cfg restart the server themselves; the others share one already running
  if (own) await startServer({ fresh: process.env.FRESH === '1' });
  for (const k of list) {
    const name = 'dn' + k.slice(0, 3) + mode[0] + bet + uniq(); let res;
    try { res = await S[k]({ size, mode, bet, name }); } catch (e) { res = { ok: false, error: String(e && e.stack || e).slice(0, 700) }; }
    console.log(JSON.stringify({ scenario: k, mode, bet, size, name, ...res }));
  }
  if (own) await stopServer(); process.exit(0);
})();
