// THE PULL wave 2, flow driver (builder A). Real clicks against a COLDCALL_TEST=1 server on CCPORT (default 4641: _scratch/start4641.sh, decision timer 30 s via a preload; the stock 20 s timer is shorter than the client's own animation until the server re-arms it on `ready`), this worktree's files.
//   node flow.js <scenario> [Play|chips]     scenarios: pick | picktimeout | moreearly | more | auto | callback | all
// Each scenario prints one JSON line {scenario, mode, ok, checks:{...}, notes}. A check is a thing that must hold after the round:
//   mismatch (CC.dbg.mismatch empty), err (no page error, no CC.pull error), win (WIN meter == totalWin), wallet (server wallet delta == totalWin + pot - cost, read over a
//   second socket, not from the UI), leftover (no floats / overlay / scene / stamp nodes), noscrim (no prompt left), notStuck (not busy).
const { launch } = require('./qalib');
const io = require('/home/frank/.openclaw/workspace/projects/ping-coldcall-pull/_scratch/sio/node_modules/socket.io-client');
const PORT = process.env.CCPORT || 4652;
const BASE = 'http://127.0.0.1:' + PORT + '/games/coldcall/index.html', OUT = '/home/frank/.openclaw/workspace/projects/ping-coldcall-fb1/_scratch/fb2fb3/w2flow';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PIN = '1234';

// ---- a second, independent view of the account: the server's own state over a socket
function sockSession(name) {
  return new Promise((resolve, reject) => {
    const s = io('http://127.0.0.1:' + PORT + '', { forceNew: true }); let tried = false;
    s.on('connect', () => s.emit('auth_login', { name, pin: PIN }));
    s.on('auth_error', () => { if (!tried) { tried = true; s.emit('auth_signup', { name, pin: PIN, avatar: 'a01' }); } else reject(new Error('auth')); });
    s.on('auth_ok', () => resolve(s)); setTimeout(() => reject(new Error('sock timeout')), 15000);
  });
}
const serverState = (s) => new Promise((res) => { s.once('g:coldcall:state', res); s.emit('g:coldcall:state', {}); });
async function serverWallet(name) { const s = await sockSession(name); const st = await serverState(s); s.close(); return st.wallet; }
// fill the lead list fast with autoplay spins (no decisions) until the Callback is armed; returns the final view or null
async function armCallback(name, mode, max = 600) {
  const s = await sockSession(name); const st = await serverState(s); const list = st.pull.list; let view = st.pull[mode], n = 0;
  const done = new Promise((res) => {
    const go = () => { if (view.cb || n >= max) return res(); n++; s.emit('g:coldcall:spin', { bet: 10, mode, auto: true }); };
    s.on('g:coldcall:result', (r) => { if (r.status === 'done') { view = r.pull.state; setTimeout(go, 170); } });
    s.on('error', (e) => { if (e.code === 'rate') setTimeout(go, 200); else { console.error('arm error', e.message); res(); } }); go();
  });
  await done; s.close(); return { view, spins: n, list };
}

async function open(name, mode, q = '') {
  const b = await launch(540, 960), { page } = b;
  await page.goto(`${BASE}?live=1&nosplash&name=${name}&pin=${PIN}${q}`);
  await page.waitForFunction(() => window.CC && CC.ready && CC.core.st.live, null, { timeout: 30000 });
  if (mode === 'chips') { await page.click('#modebar button[data-m=chips]'); await page.waitForFunction(() => CC.core.st.mode === 'chips'); }
  await page.waitForFunction(() => document.getElementById('bal').textContent !== '$0.00' || CC.core.money.wallet.chips > 0, null, { timeout: 10000 }).catch(() => {});
  return b;
}
// the same game inside the shell iframe (?bridge=1): sign in through the lobby form, open Cold Call from the shell; returns the frame (it has the page API we use)
async function openBridge(name, mode) {
  const b = await launch(1000, 1000), { page } = b;
  await page.goto('http://127.0.0.1:' + PORT + '/'); await page.waitForSelector('#lb-name', { timeout: 20000 });
  await page.fill('#lb-name', name); await page.fill('#lb-pin', PIN); await page.click('#lb-submit');
  await page.waitForFunction(() => window.Shell && Shell.isSignedIn && Shell.isSignedIn(), null, { timeout: 20000 });
  await sleep(2500);   // the shell's daily-streak calendar pops up after sign-in and would intercept every click: take it down (it is the shell's, not the game's)
  await page.evaluate(() => document.querySelectorAll('.pj-modal, .pj-scrim, .pj-backdrop, [class*=pj-overlay]').forEach((n) => n.remove()));
  await page.evaluate(() => Shell.openGame('coldcall'));
  let fr = null; for (let i = 0; i < 60 && !fr; i++) { fr = page.frames().find((f) => /games\/coldcall/.test(f.url())); await sleep(250); }
  if (!fr) throw new Error('no coldcall frame');
  await fr.waitForFunction(() => window.CC && CC.ready && CC.core.st.live, null, { timeout: 30000 });
  const sp = await fr.locator('#splash').count(); if (sp) await fr.evaluate(() => { const s = document.getElementById('splash'); if (s) s.remove(); });
  if (mode === 'chips') { await fr.click('#modebar button[data-m=chips]'); await fr.waitForFunction(() => CC.core.st.mode === 'chips'); }
  return { browser: b.browser, page: fr, top: page };
}
async function setBet(page, cents) {
  for (let i = 0; i < 40; i++) {
    const cur = await page.evaluate(() => CC.core.st.bets[CC.core.st.betIdx]);
    if (cur === cents) return true;
    await page.click(cur > cents ? '#betDn' : '#betUp'); await sleep(40);
  }
  return false;
}
async function buy(page, id) { await page.click('#buy'); await page.click('#buy_' + id); await page.click('#buy_confirm'); }
// a prompt of kind k is open (the game's own flag, set for whichever prompt is up: CC.pull's or the placeholder)
const open_ = (page, k) => page.evaluate((kk) => !!(CC.core.st.ctx && CC.core.st.ctx.promptOpen === kk), k);
// answer ONE MORE CALL with a real click on whichever prompt is on screen
async function clickMore(page, take) {
  await armedWait(page);
  const sel = (await page.locator('#pl_more').count()) ? (take ? '#pl_more' : '#pl_bank') : (take ? '#cc_more_take' : '#cc_more_bank');
  await page.click(sel);
}
// the intro dial is finished with its own tap hook (_finish): a Playwright click on the moving dial often times out, and the server's 20 s decision timer is already running
async function prompt(page, k, ms = 90000) {                  // the placeholder prompt (or CC.pull's once it exists): returns when it is on screen. Taps the intro dial on the way (a real tap).
  const t0 = Date.now();
  for (;;) {
    if (await open_(page, k)) return;
    if (await page.locator('.dial').count()) { await page.evaluate(() => { const d = document.querySelector('.dial'); if (d && d._finish) d._finish(); }).catch(() => {}); }
    if (Date.now() - t0 > ms) throw new Error('prompt ' + k + ' did not show');
    await sleep(250);
  }
}
// a prompt of kind k, or the end of the round (no decision was offered in this bonus): 'prompt' | 'done'
async function promptOrDone(page, k, n0, ms = 150000) {
  const t0 = Date.now();
  for (;;) {
    if (await open_(page, k)) return 'prompt';
    if (await page.evaluate((n) => CC.dbg.rounds.length > n && !CC.core.st.busy, n0)) return 'done';
    if (await page.locator('.dial').count()) { await page.evaluate(() => { const d = document.querySelector('.dial'); if (d && d._finish) d._finish(); }).catch(() => {}); }
    if (Date.now() - t0 > ms) throw new Error('neither prompt ' + k + ' nor end of round');
    await sleep(250);
  }
}
// buy a bonus1 until one offers a PICK (the first phone of the bonus needs >= 2 lit leads); returns the round's n0 and the server wallet before it
async function buyUntilPick(page, name, tries = 8) {
  for (let i = 0; i < tries; i++) {
    const n0 = (await summary(page)).rounds, w0 = await serverWallet(name);
    await buy(page, 'bonus1'); const r = await promptOrDone(page, 'pick', n0);
    if (r === 'prompt') return { n0, w0, skipped: i };
    await sleep(600);
  }
  throw new Error('no bonus offered a pick in ' + tries + ' buys');
}
// U1 (fix F1): a prompt takes no tap in its first 600 ms (and not one that started before it opened): wait out the arming window like a player would, then click
const armedWait = (page) => page.waitForFunction(() => { const c = CC.core.st.ctx; return !c || !c.promptOpenedAt || performance.now() - c.promptOpenedAt >= 700; }, null, { timeout: 5000 }).catch(() => {});
async function clickLit(page) {                              // a real mouse click on a lit square of the board
  await armedWait(page);
  const p = await page.evaluate(() => CC.board.hotList()[0]);
  await page.locator('#slots i').nth(p).click({ force: true, timeout: 5000 });   // force: Playwright's hit-test would stop at the symbol on top; the click itself is a real mouse click at the square's centre
  return p;
}
async function summary(page) {
  return page.evaluate(() => {
    const st = CC.core.st, rows = CC.dbg.rounds, row = rows[rows.length - 1] || {}, win = document.getElementById('win').textContent;
    const winC = st.mode === 'chips' ? Math.round(parseFloat(win.replace(/[,]/g, ''))) : Math.round(parseFloat(win.replace(/[$,]/g, '')) * 100);
    return { row, winText: win, winC, busy: st.busy, mismatch: CC.dbg.mismatch.slice(0, 6), err: CC.dbg.error || null, pullErr: CC.dbg.pull, rounds: rows.length, checked: CC.dbg.checked,
      left: document.querySelectorAll('#floats > *, #ov > *, #scene > *, .stamp, .accept, .banner, .fly, .flash').length, scrims: document.querySelectorAll('.scrim').length,
      spinLabel: document.getElementById('spin').textContent, betText: document.getElementById('bet').textContent, cap: document.getElementById('capT').textContent, stray: CC.dbg.stray || [] };
  });
}
async function waitDone(page, n0, ms = 240000) { await page.waitForFunction((n) => CC.dbg.rounds.length > n && !CC.core.st.busy, n0, { timeout: ms }); await sleep(500); }
function verify(sm, wBefore, wAfter, mode, extra = {}) {
  const r = sm.row, expect = (r.totalWin || 0) + (r.potWon || 0) - (r.cost || 0);
  const checks = {
    mismatch: sm.mismatch.length === 0, err: !sm.err && sm.pullErr.length === 0, win: sm.winC === r.totalWin, wallet: wAfter[mode] - wBefore[mode] === expect,
    leftover: sm.left === 0, noscrim: sm.scrims === 0, notStuck: !sm.busy, noAbort: !r.aborted, ...extra
  };
  return { ok: Object.values(checks).every(Boolean), checks, detail: { totalWin: r.totalWin, cost: r.cost, walletDelta: wAfter[mode] - wBefore[mode], expect, winText: sm.winText, decisions: r.decisions, auto: r.auto, tier: r.tier, mismatch: sm.mismatch, err: sm.err, pullErr: sm.pullErr, aborted: r.aborted } };
}

// ---- scenarios
const S = {};
S.bridge = async (name, mode) => {                            // the shell relay: pick clicked, ONE MORE CALL taken, all through public/shell.js (spin / decide / ready, results by roundId)
  await serverWallet(name);                                    // creates the account
  const b = await openBridge(name, mode), { page } = b; try {
    await setBet(page, 10); await page.click('#turbo'); const { n0, w0 } = await buyUntilPick(page, name); await clickLit(page);
    const more = (await promptOrDone(page, 'more', n0)) === 'prompt'; if (more) await clickMore(page, true);
    await waitDone(page, n0); const sm = await summary(page), w1 = await serverWallet(name);
    return { morePrompt: more, ...verify(sm, w0, w1, mode, { viaShell: await page.evaluate(() => CC.core.T.kind === 'bridge'), pickHow: sm.row.decisions && sm.row.decisions[0] === 'player', moreHow: !more || sm.row.decisions[1] === 'player' }) };
  } finally { await b.browser.close(); }
};
S.practice = async () => {                                    // no pull UI at all in practice: spins, a bought bonus, nothing but the old path
  const b = await launch(540, 960), { page } = b; try {
    await page.goto(BASE + '?nosplash'); await page.waitForFunction(() => window.CC && CC.ready, null, { timeout: 30000 });
    await page.click('#turbo'); await page.evaluate(() => { CC.core.st.auto = true; }); await page.click('#spin');
    await page.waitForFunction(() => CC.dbg.rounds.length >= 12, null, { timeout: 180000 }); await page.evaluate(() => { CC.core.st.auto = false; }); await page.waitForFunction(() => !CC.core.st.busy);
    const sm = await summary(page), live = await page.evaluate(() => ({ live: CC.core.st.live, ph: document.querySelectorAll('.scrim.ph').length, pending: CC.dbg.rounds.filter((r) => r.first === 'pending').length }));
    return { ok: sm.mismatch.length === 0 && !sm.err && live.pending === 0 && !live.live && sm.label !== 'CALLBACK', checks: { mismatch: sm.mismatch.length === 0, err: !sm.err, noPull: live.pending === 0, practice: !live.live }, detail: { rounds: sm.rounds } };
  } finally { await b.browser.close(); }
};
S.pick = async (name, mode) => {                              // bought bonus1: PICK taken by clicking a lit square, ONE MORE CALL banked
  const b = await open(name, mode), { page } = b; try {
    await setBet(page, 10); await page.click('#turbo'); const { n0, w0 } = await buyUntilPick(page, name); await page.screenshot({ path: OUT + '/pick_prompt_' + mode + '.png' });
    const p = await clickLit(page); await sleep(300);
    const row = await page.evaluate(() => CC.dbg.rounds[CC.dbg.rounds.length - 1]);
    // a bonus can end with W below the ONE MORE CALL minimum: then there is no prompt and the round just finishes
    const more = (await promptOrDone(page, 'more', n0)) === 'prompt';
    if (more) { await page.screenshot({ path: OUT + '/more_prompt_' + mode + '.png' }); await clickMore(page, false); }
    await waitDone(page, n0); const sm = await summary(page), w1 = await serverWallet(name);
    return { picked: p, morePrompt: more, ...verify(sm, w0, w1, mode, { pickHow: sm.row.decisions && sm.row.decisions[0] === 'player', bankHow: !more || sm.row.decisions[1] === 'player' }) };
  } finally { await b.browser.close(); }
};
S.picktimeout = async (name, mode) => {                       // PICK left alone: the timer runs out, TIME'S UP, the server's default arrives and the round finishes
  const b = await open(name, mode), { page } = b; try {
    await setBet(page, 10); await page.click('#turbo'); const { n0, w0 } = await buyUntilPick(page, name); const t0 = Date.now();
    const seen = await page.waitForFunction(() => /TIME'S UP/.test(document.getElementById('capT').textContent), null, { timeout: 60000 }).then(() => true).catch(() => false); const tUp = Date.now() - t0;
    await waitDone(page, n0); const sm = await summary(page), w1 = await serverWallet(name);
    return { timesUpAfterMs: tUp, ...verify(sm, w0, w1, mode, { timesUpCaption: seen, timeoutHow: sm.row.decisions && sm.row.decisions[0] === 'timeout', autoMark: sm.row.auto === 'timeout' }) };
  } finally { await b.browser.close(); }
};
S.moreearly = async (name, mode) => {                         // not turbo: the whole bonus animates for longer than the server timer, the default arrives mid-animation (no prompt)
  const b = await open(name, mode), { page } = b; try {
    await setBet(page, 10); const { n0, w0 } = await buyUntilPick(page, name); await clickLit(page);
    await waitDone(page, n0, 300000); const sm = await summary(page), w1 = await serverWallet(name);
    return verify(sm, w0, w1, mode, { moreHow: ['early', 'timeout', 'player', undefined].includes(sm.row.decisions && sm.row.decisions[1]) });
  } finally { await b.browser.close(); }
};
S.more = async (name, mode) => {                              // ONE MORE CALL taken, repeated until one win AND one loss were seen (up to 14 bonuses)
  const b = await open(name, mode), { page } = b; const seen = { won: 0, lost: 0, banked: 0 }, runs = []; try {
    await setBet(page, 10); await page.click('#turbo');
    for (let i = 0; i < 14 && !(seen.won && seen.lost); i++) {
      const { n0, w0 } = await buyUntilPick(page, name); await clickLit(page);
      const more = (await promptOrDone(page, 'more', n0)) === 'prompt';
      let samples = null;
      if (more) { await page.evaluate(() => { window.__w = []; window.__wi = setInterval(() => __w.push(document.getElementById('win').textContent), 50); }); await clickMore(page, true); }
      await waitDone(page, n0);
      if (more) samples = await page.evaluate(() => { clearInterval(window.__wi); return window.__w; });
      const sm = await summary(page), w1 = await serverWallet(name), v = verify(sm, w0, w1, mode);
      const dec = sm.row.decisions || []; const nums = (samples || []).map((t) => (mode === 'chips' ? parseFloat(t.replace(/,/g, '')) : parseFloat(t.replace(/[$,]/g, '')) * 100)).filter((x) => !Number.isNaN(x));
      const dropped = nums.some((x, k) => k && x < nums[k - 1]);
      const outcome = !more ? 'nomore' : (sm.row.more || 'banked'); if (outcome === 'won') seen.won++; else if (outcome === 'lost') seen.lost++; else seen.banked++;
      runs.push({ i, outcome, ok: v.ok, checks: v.checks, meterDropped: dropped, dec, totalWin: sm.row.totalWin, cost: sm.row.cost, walletDelta: w1[mode] - w0[mode], lostDropOk: outcome === 'lost' ? dropped : true });
    }
    const ok = runs.every((r) => r.ok && r.lostDropOk) && seen.won + seen.lost > 0;
    return { ok, checks: { allRounds: runs.every((r) => r.ok), lossMeterDrops: runs.every((r) => r.lostDropOk), sawWin: !!seen.won, sawLoss: !!seen.lost }, detail: { seen, runs } };
  } finally { await b.browser.close(); }
};
S.auto = async (name, mode) => {                               // autoplay: bought bonuses play through with no prompt at all, captions say what the default did
  const b = await open(name, mode), { page } = b; try {
    await setBet(page, 10); await page.click('#turbo'); const w0 = await serverWallet(name), n0 = (await summary(page)).rounds;
    await page.evaluate(() => { CC.core.st.auto = true; document.getElementById('auto').classList.add('on'); });   // flag only: the click on AUTO would start a base spin instead of the buy
    await buy(page, 'bonus1');
    const caps = []; const iv = setInterval(async () => { try { caps.push(await page.evaluate(() => document.getElementById('capT').textContent)); } catch {} }, 150);
    await page.waitForFunction((n) => CC.dbg.rounds.length > n, n0, { timeout: 240000 });
    const sawPrompt = await page.evaluate(() => document.querySelectorAll('.scrim').length > 0);
    await page.evaluate(() => { CC.core.st.auto = false; }); await waitDone(page, n0); clearInterval(iv);
    const sm = await summary(page), w1 = await serverWallet(name);
    return verify(sm, w0, w1, mode, { noPrompt: !sawPrompt, autoMarked: sm.row.auto === 'autoplay' || sm.row.decisions.length === 0, captionPick: caps.some((c) => /AUTO: first lead picked/.test(c)) });
  } finally { await b.browser.close(); }
};
S.callback = async (name, mode) => {                           // a Callback round: free, at cb.bet, base spin skipped, allowed with a low balance
  const arm = await armCallback(name, mode);
  if (!arm.view.cb) return { ok: false, skipped: true, notes: 'Callback not armed after ' + arm.spins + ' spins (list ' + arm.list + ')' };
  const b = await open(name, mode), { page } = b; try {
    const before = await summary(page), w0 = await serverWallet(name), n0 = before.rounds;
    const pre = await page.evaluate(() => ({ label: document.getElementById('spin').textContent, bet: document.getElementById('bet').textContent, cb: CC.core.pview().cb, bal: document.getElementById('bal').textContent, warm: CC.core.pview().warm, hot: document.querySelectorAll('#slots i.hot').length }));
    await page.click('#turbo'); await page.click('#spin');
    const balDuring = await page.evaluate(() => document.getElementById('bal').textContent);
    if ((await promptOrDone(page, 'pick', n0)) === 'prompt') await clickLit(page);
    const more = (await promptOrDone(page, 'more', n0)) === 'prompt';
    if (more) await clickMore(page, false);
    await waitDone(page, n0); const sm = await summary(page), w1 = await serverWallet(name);
    return { pre, balDuring, ...verify(sm, w0, w1, mode, { label: pre.label === 'CALLBACK', callbackFlag: sm.row.callback === true, free: sm.row.cost === 0, betShown: !!pre.cb && pre.bet.replace(/[$,]/g, '') !== '' , balHeld: balDuring === pre.bal, labelBack: sm.spinLabel === 'SPIN' || (await page.evaluate(() => !!CC.core.pview().cb)) }) };
  } finally { await b.browser.close(); }
};

(async () => {
  const sc = process.argv[2] || 'pick', mode = (process.argv[3] || 'play').toLowerCase() === 'chips' ? 'chips' : 'play';
  const list = sc === 'all' ? ['practice', 'pick', 'picktimeout', 'moreearly', 'more', 'auto', 'callback', 'bridge'] : [sc];
  for (const k of list) {
    const name = 'fl' + k.slice(0, 4) + mode[0] + Date.now().toString(36).slice(-4); let res;
    try { res = await S[k](name, mode); } catch (e) { res = { ok: false, error: String(e && e.stack || e).slice(0, 600) }; }
    console.log(JSON.stringify({ scenario: k, mode, name, ...res }));
  }
  process.exit(0);
})();
