'use strict';
// P6 w3b: one leg of the functional chain for COLD CALL on the ledger build, through the Ping shell, real clicks only.
//   node leg.js --base URL --data DIR --export EXPORTDIR --viewport 540x960 --mode play|chips --name <leg> [--docked]
// Server: COLDCALL_TEST=1, fresh data dir. The shell's bridge has no force parameter: the driver wraps the shell page's PingSocket.emit so that the NEXT
// g:coldcall:spin payload carries force:<name>. The click on SPIN is a real click and the client is the real one. No product code is touched.
// Checks after EVERY round come from the ledger (replay of money.jsonl), not from the screen alone. Writes qa/p6-w3b/out/<name>.json.
const L = require('./lib');
const { fs, path, sleep } = L;
const BASE = L.argOf('--base'), DATA = L.argOf('--data'), EXPORT = L.argOf('--export'), NAME = L.argOf('--name', 'leg');
const [W, H] = L.argOf('--viewport', '540x960').split('x').map(Number), MODE = L.argOf('--mode', 'play') === 'chips' ? 'chips' : 'play', DOCKED = L.hasFlag('--docked');
const MINROUNDS = Number(L.argOf('--rounds', 33)), QUICK = L.hasFlag('--quick');   // --quick: a short plan to test the driver, never used for the final numbers
const V = require(EXPORT + '/tests/v2/lib.js'), io = require(EXPORT + '/node_modules/socket.io-client');
const OUT = path.join(__dirname, 'out', NAME + '.json'), SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.mkdirSync(SHOTS, { recursive: true });
const res = { leg: NAME, viewport: `${W}x${H}`, mode: MODE, docked: DOCKED, started: new Date().toISOString(), rounds: [], fails: [], notes: [], cases: {}, forced: {}, decisions: { pick: 0, take: 0, hang: 0, timeout: 0 }, buys: [], big: null, finished: null };
const save = () => fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
const note = (s) => { res.notes.push(s); console.log('NOTE ' + s); };
let page, fr, key, store, rn = 0, shotN = 0, bot = null, logs = [], bad = [];
const led = () => L.readLedger(DATA);
const bal = () => led().get(store, MODE);
async function shot(name) {
  if (shotN >= 5) return; const f = path.join(SHOTS, NAME + '_' + name + '.jpg'); shotN++;
  try { for (const q of [55, 40, 28]) { await page.screenshot({ path: f, type: 'jpeg', quality: q }); if (fs.statSync(f).size < 120 * 1024) break; } } catch (e) { /* page gone */ }
}
async function fail(what, extra = {}) { res.fails.push({ round: rn, what, ...extra }); console.log('FAIL', NAME, 'round', rn, what, JSON.stringify(extra).slice(0, 400)); await shot('fail' + res.fails.length); save(); }

// ---- the one-shot force: the next g:coldcall:spin the shell emits carries force:<name>
const installForce = () => page.evaluate(() => {
  const s = window.PingSocket, orig = s.emit.bind(s); window.__force = null; window.__forceUsed = [];
  s.emit = function (ev, ...a) { if (ev === 'g:coldcall:spin' && window.__force && a[0] && typeof a[0] === 'object') { a[0] = { ...a[0], force: window.__force }; window.__forceUsed.push(window.__force); window.__force = null; } return orig(ev, ...a); };
});
const setForce = (n) => page.evaluate((x) => { window.__force = x; }, n);
const installToasts = () => fr.evaluate(() => { window.__toasts = []; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); }).observe(document.body, { childList: true, subtree: true }); });
const toastsFrom = (i) => fr.evaluate((k) => window.__toasts.slice(k), i);
const toastLen = () => fr.evaluate(() => window.__toasts.length);
// any BIG WIN overlay a player could see: #tier / #tierbg in any document of the slot, computed style + box
const tierProbe = () => fr.evaluate(() => [...document.querySelectorAll('#tier, #tierbg')].map((e) => { const cs = getComputedStyle(e), r = e.getBoundingClientRect(); let o = 1, n = e; while (n && n.nodeType === 1) { o *= parseFloat(getComputedStyle(n).opacity); n = n.parentElement; }
  const vis = cs.display !== 'none' && cs.visibility !== 'hidden' && o > 0.05 && r.width > 4 && r.height > 4 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight; return { id: e.id, parent: e.parentElement && (e.parentElement.id || e.parentElement.className), vis, opacity: +o.toFixed(3), display: cs.display, visibility: cs.visibility, box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }; }));

// ---- driving one round: answers every prompt by a real click according to the policy. pol = { more: 'take'|'hang'|'timeout', pick: 'click'|'timeout', onPrompt }
async function drive(n0, pol = {}) {
  const t0 = Date.now(), did = { pick: 0, take: 0, hang: 0, timeout: 0, dial: 0 }; let lastDial = 0, lastOpened = -1; const tiers = [];
  for (;;) {
    const s = await L.frState(fr).catch(() => null); if (!s) { await sleep(200); continue; }
    if (s.rounds > n0 && !s.busy && !s.prompt) { await sleep(600); const s2 = await L.frState(fr); if (!s2.busy && !s2.prompt) return { did, tiers, ms: Date.now() - t0 }; }
    if (s.prompt) {
      const opened = await fr.evaluate(() => (CC.core.st.ctx && CC.core.st.ctx.promptOpenedAt) || 0);
      if (pol.onPrompt && opened !== lastOpened) { lastOpened = opened; await pol.onPrompt(s.prompt); }
      if (s.prompt === 'pick' && pol.pick !== 'timeout') { try { await L.clickLit(fr); did.pick++; } catch (e) { did.retry = (did.retry || 0) + 1; if (did.retry > 6) throw e; } await sleep(500); }
      else if (s.prompt === 'more' && pol.more !== 'timeout') { const take = pol.more === 'take'; try { await L.clickMore(fr, take); did[take ? 'take' : 'hang']++; } catch (e) { did.retry = (did.retry || 0) + 1; if (did.retry > 6) throw e; } await sleep(500); }
      else if (opened !== -2) {   // timeout policy: leave it; count once per prompt
        if (!did['seen' + opened]) { did['seen' + opened] = 1; did.timeout++; }
        if (Date.now() - t0 > 90000) throw new Error('decision left to timeout did not close in 90 s: ' + JSON.stringify(s));
      }
    } else if (Date.now() - lastDial > 1500 && (await L.tapDial(page, fr))) { lastDial = Date.now(); did.dial++; }
    if (did.take) { const p = await tierProbe().catch(() => []); if (p.length) tiers.push(...p.map((x) => ({ ...x, t: Date.now() - t0 }))); }
    if (Date.now() - t0 > (pol.ms || 300000)) throw new Error('round did not end in time: ' + JSON.stringify(s));
    await sleep(120);
  }
}
const spinXY = async () => { const bb = await fr.locator('#spin').boundingBox(); return { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 }; };
const spinReady = () => fr.evaluate(() => { const b = document.getElementById('spin'); if (!b) return 'nospin'; const r = b.getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); if (CC.core.st.busy) return 'busy'; if (b.disabled) return 'disabled'; if (!(e === b || b.contains(e))) return 'covered by ' + (e && (e.id || e.className || e.tagName)); return 'ready'; });
async function waitReady(ms = 15000) { const t0 = Date.now(); for (;;) { const w = await spinReady(); if (w === 'ready') return; if (Date.now() - t0 > ms) throw new Error('SPIN not ready: ' + w); await sleep(60); } }
async function realClick(burst) { const { x, y } = await spinXY(); await page.mouse.click(x, y, { clickCount: burst, delay: burst > 1 ? 30 : 0 }); }
// a real multi-click: `n` separate down/up pairs 40 ms apart with increasing clickCount (what a double / triple click is)
async function multiClick(x, y, n) { for (let i = 1; i <= n; i++) { await page.mouse.move(x, y); await page.mouse.down({ clickCount: i }); await page.mouse.up({ clickCount: i }); await sleep(40); } }

// ---- the full check of one action. kind: 'spin' | 'buy:<id>' ; o = { force, burst, pol, label, expect: [min,max] rounds, act: custom async action }
async function round(kind, o = {}) {
  rn++; const T0 = Date.now(); const rec = { i: rn, kind, label: o.label || null, force: o.force || null, mode: MODE, burst: o.burst || 1 };
  await fr.waitForFunction(() => !CC.core.st.busy && !CC.core.st.ctx?.promptOpen, null, { timeout: 120000 }).catch(() => {});
  const s0 = await L.frState(fr), before = bal(), n0 = s0.rounds, tap0 = (await L.tapRes(page)).length, errs0 = (await L.tapErr(page)).length, tl0 = await toastLen(), led0 = led().reasons.length;
  rec.bet = s0.bet; rec.before = before; rec.screenBefore = L.toUnits(s0.bal, MODE);
  if (rec.screenBefore !== before) await fail('meter before the round != ledger balance', { screen: rec.screenBefore, ledger: before });
  try {
    if (o.force) await setForce(o.force);
    if (o.act) await o.act(rec);
    else if (kind === 'spin') { await waitReady(); await realClick(o.burst || 1); }
    else { await L.buyBonus(fr, kind.split(':')[1]); }
  } catch (e) { rec.clickErr = e.message.split('\n')[0]; await fail('click did not land (' + kind + ')', { err: rec.clickErr }); if (o.force) await setForce(null); res.rounds.push(rec); save(); return rec; }
  let dr;
  const expect = o.expect || [1, 1];
  // zero-round outcome (refused): the screen never goes busy / never adds a round
  try { dr = await drive(n0, { ...(o.pol || {}), ms: expect[0] === 0 ? 75000 : 300000 }); } catch (e) { dr = { err: e.message.slice(0, 200), did: {}, tiers: [] }; }
  if (dr.err) {
    if (expect[0] === 0 && (await L.frState(fr)).rounds === n0) dr = { did: {}, tiers: [] }; else { rec.driveErr = dr.err; await fail('round did not finish', { err: dr.err }); res.rounds.push(rec); save(); return rec; }
  }
  rec.did = dr.did; rec.tiers = dr.tiers.length ? dr.tiers.slice(0, 6) : undefined;
  // ledger settles: poll until it equals the expected value (the server pays at the end of the round)
  const results = await L.tapRes(page), done = L.doneRounds(results, MODE, tap0), sm = L.sums(done);
  const expected = before - sm.cost + sm.win + sm.pot; let after = bal(); for (let i = 0; i < 40 && after !== expected; i++) { await sleep(150); after = bal(); }
  const used = await page.evaluate(() => window.__forceUsed.slice());
  const s1 = await L.frState(fr); const winTxt = await fr.evaluate(() => document.getElementById('win').textContent);
  let meter = L.toUnits(s1.bal, MODE); for (let i = 0; i < 30 && meter !== after; i++) { await sleep(150); meter = L.toUnits((await L.frState(fr)).bal, MODE); }
  const roundsScreen = s1.rounds - n0, ids = new Set(led().reasons.slice(led0).filter((r) => String(r.ref || '').startsWith('coldcall:' + key + ':')).map((r) => String(r.ref).split(':')[2]));
  const lastDone = done[done.length - 1]; const toasts = await toastsFrom(tl0), errs = (await L.tapErr(page)).slice(errs0);
  Object.assign(rec, { cost: sm.cost, win: sm.win, pot: sm.pot, after, ledgerExpected: expected, meter, screenWinTxt: winTxt, serverRounds: done.length, screenRounds: roundsScreen, ledgerRounds: ids.size, forceUsed: used[used.length - 1] || null, toasts, errs: errs.map((e) => e && e.code), tier: lastDone && lastDone.tier, wallet: lastDone && lastDone.wallet && lastDone.wallet[MODE], forcedEcho: lastDone && (lastDone.forced || (lastDone.script && lastDone.script.forced) || null), pullMore: lastDone && lastDone.pull && lastDone.pull.more, buyBonus: lastDone && lastDone.buyBonus, callback: lastDone && lastDone.callback, ledgerLines: led().reasons.length - led0 });
  if (lastDone && lastDone.id !== undefined) rec.roundId = lastDone.roundId; if (lastDone) rec.roundId = lastDone.roundId;
  const checks = {
    arith: before - sm.cost + sm.win + sm.pot === after, meterEqLedger: meter === after, walletEqLedger: !lastDone || !lastDone.wallet || lastDone.wallet[MODE] === after,
    rounds: done.length >= expect[0] && done.length <= expect[1] && roundsScreen === done.length && ids.size === done.length, noEscrow: led().escrows.length === 0,
    noMismatch: s1.mismatch.length === 0 && !s1.aborted && !s1.error, unlocked: !s1.busy && !s1.prompt && s1.scrims === 0, noToast: toasts.length === 0 && errs.length === 0,
  };
  if (o.force) checks.forceTaken = rec.forceUsed === o.force;
  rec.checks = checks; const badk = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  if (badk.length) await fail('checks failed: ' + badk.join(','), { kind, label: o.label, bet: rec.bet, before, cost: sm.cost, win: sm.win, pot: sm.pot, after, expected, meter, serverRounds: done.length, screenRounds: roundsScreen, ledgerRounds: ids.size, toasts, errs, mismatch: s1.mismatch, error: s1.error, aborted: s1.aborted, busy: s1.busy, prompt: s1.prompt, scrims: s1.scrims });
  for (const k of ['pick', 'take', 'hang', 'timeout']) res.decisions[k] += dr.did[k] || 0;
  if (o.force) { const f = (res.forced[o.force] = res.forced[o.force] || { n: 0, decisions: [], tiers: [] }); f.n++; f.decisions.push(dr.did); if (rec.tier) f.tiers.push(rec.tier); }
  console.log(`r${rn} ${((Date.now() - T0) / 1000).toFixed(0)}s ${kind}${o.force ? '/' + o.force : ''}${o.label ? ' [' + o.label + ']' : ''} bet ${rec.bet} cost ${sm.cost} win ${sm.win}${sm.pot ? ' pot ' + sm.pot : ''} ${before} -> ${after} ${badk.length ? 'FAIL ' + badk : 'ok'} did ${JSON.stringify(dr.did)}`);
  rec.ms = Date.now() - T0; res.rounds.push(rec); save(); return rec;
}

const pickBet = (bets, t) => bets.reduce((a, c) => (Math.abs(c - t) < Math.abs(a - t) ? c : a));
const MORE = ['take', 'hang'];
async function buyIds() {   // what the menu offers at the current bet (read from the page, then closed with "Not now")
  await fr.locator('#buy').click({ timeout: 15000 }); await sleep(500);
  const ids = await fr.evaluate(() => [...document.querySelectorAll('#ov .buyopt')].map((b) => ({ id: b.dataset.buy, disabled: b.disabled })));
  await fr.locator('#ov [data-v=x]').click({ timeout: 8000 }); await sleep(400); return ids;
}
async function dockedInfo() {
  return page.evaluate(() => { const w = document.querySelector('.sh-win[data-game=coldcall]'); if (!w) return null; const r = w.getBoundingClientRect(), f = w.querySelector('iframe'), fb = f && f.getBoundingClientRect(); const sp = f && f.contentDocument && f.contentDocument.getElementById('spin'), sb = sp && sp.getBoundingClientRect(), fo = f && f.getBoundingClientRect();
    return { cls: w.className, rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], frame: fb && [Math.round(fb.width), Math.round(fb.height)], spinInViewport: !!sb && sb.left + fo.left >= 0 && sb.right + fo.left <= innerWidth && sb.top + fo.top >= 0 && sb.bottom + fo.top <= innerHeight, vw: innerWidth, vh: innerHeight }; });
}

(async () => {
  const b = await L.launch(W, H); page = b.page; logs = b.logs; bad = b.bad;
  try {
    const name = ('w3b' + (DOCKED ? 'd' : '') + MODE[0] + W + Date.now().toString(36).slice(-4)).slice(0, 18);
    const su = await L.signUp(page, BASE, name); key = await page.evaluate(() => Lobby.user().key); store = L.storeOf(key, MODE);
    note(`account ${name} (key ${key}); daily bonus claimed by a real click: ${su.claimed}; funding = sign-up grant + daily bonus`);
    await L.installTap(page); await installForce();
    if (DOCKED) {   // a seat at a poker table first, then the slot is opened the way the shell opens it from the dock
      bot = await new V.Bot({ port: Number(new URL(BASE).port), clients: [] }, 'w3bb' + Date.now().toString(36).slice(-5)).connect(); await bot.signup();
      const c = await bot.req('table_create', { settings: { name: 'W3B', mode: 'chips', buyIn: { min: 500, max: 5000, default: 2000 }, blinds: { sb: 25, bb: 50 }, autoStart: false, actionTimerSec: 0 } }, 'table_created');
      if (c.__err) throw new Error('table_create ' + c.__err); const id = c.table.id; const sit = await bot.sit(id, 2000); if (sit.__err) throw new Error('bot sit ' + sit.__err);
      await page.fill('#lb-code', id); await page.click('#lb-join-btn'); await page.locator('#lb-sit').click({ timeout: 15000 }); await sleep(1500);
      res.seat = { table: id, seatedStack: led().seats(key, 'chips') }; note('page seated at POKERPING table ' + id + ' with ' + res.seat.seatedStack + ' chips');
      await shot('poker_seat');
    }
    fr = await L.openColdCall(page); await installToasts(); await sleep(500);
    if (DOCKED) { res.dockInfo = await dockedInfo(); note('slot window after opening from the dock button at ' + W + 'x' + H + ': ' + JSON.stringify(res.dockInfo)); if (!res.dockInfo.spinInViewport) await fail('SPIN not fully inside the viewport in the docked slot', res.dockInfo); }
    const st0 = await L.frState(fr); if (!(st0.live && st0.kind === 'bridge')) await fail('slot is not live on the bridge', { live: st0.live, kind: st0.kind });
    if (MODE === 'chips') { await fr.locator('#modebar button[data-m=chips]').click({ timeout: 15000 }); await fr.waitForFunction(() => CC.core.st.mode === 'chips', null, { timeout: 15000 }); await sleep(600); }
    const s = await L.frState(fr); const bets = s.bets; res.bets = bets; res.startBalance = { ledger: bal(), screen: L.toUnits(s.bal, MODE) }; await shot('open');
    const low = bets[0], b5 = pickBet(bets, 5), b10 = pickBet(bets, 10), b20 = pickBet(bets, 20), b50 = pickBet(bets, 50), b100 = pickBet(bets, 100);
    const cbp = () => fr.evaluate(() => CC.core.st.cbBet != null);
    const spinsAt = async (bet, n, extra) => { await L.setBet(fr, bet); for (let i = 0; i < n; i++) await round('spin', extra); };
    // 1. plain spins at several bet levels
    await spinsAt(low, QUICK ? 1 : 2); if (!QUICK) { await spinsAt(b10, 1); await spinsAt(b20, 1); await spinsAt(b50, 1); await spinsAt(b100, 1); } await fr.locator('#turbo').click({ timeout: 8000 }).catch(() => {});
    // 2. every forced bonus in E.FORCES, a real decision click where it has one (HANG UP / ONE MORE CALL alternate, both at least once; one left to its timeout below)
    await L.setBet(fr, b5);
    const FORCES = await fr.evaluate(() => (window.CC && CC.E && CC.E.FORCES) || null); res.engineForces = FORCES || ['bonus1', 'bonus2', 'bonus3', 'phone', 'close', 'big', 'tease'];
    let mi = 0;
    for (const f of (QUICK ? ['big'] : res.engineForces)) { const r = await round('spin', { force: f, pol: { more: MORE[mi++ % 2] } }); if (f === 'big') res.big = { tier: r.tier, win: r.win, cost: r.cost, bet: r.bet }; }
    // 3. every buy the menu offers, at the lowest bet where all are affordable
    await L.setBet(fr, b5); const menu = await buyIds(); res.buyMenu = menu; note('buy menu at bet ' + b5 + ': ' + JSON.stringify(menu));
    for (const m of menu.filter((x) => !x.disabled && (!QUICK || x.id === 'hunt'))) { if (await cbp()) await round('spin', { label: 'callback played before the buy' }); const r = await round('buy:' + m.id, { pol: { more: MORE[mi++ % 2] } }); res.buys.push({ id: m.id, cost: r.cost, win: r.win, ok: Object.values(r.checks || {}).every(Boolean) }); }
    // 4. decisions: HANG UP and ONE MORE CALL at least once each, and one decision left to its timeout (20 s)
    const need = () => ({ take: res.decisions.take < 1, hang: res.decisions.hang < 1, timeout: res.decisions.timeout < 1 });
    for (let k = 0; !QUICK && k < 14 && Object.values(need()).some(Boolean); k++) {
      // forced rounds are stateless paid spins and never open a prompt; the PICK / ONE MORE CALL prompts come from bought (and natural) bonuses
      const n = need();
      if (await cbp()) await round('spin', { label: 'callback played before the buy' });
      await round('buy:' + (k % 3 === 2 ? 'bonus2' : 'bonus1'), { label: 'decision top-up (' + Object.keys(n).filter((x) => n[x]).join('+') + ')', pol: { more: n.take ? 'take' : n.hang ? 'hang' : 'timeout', pick: 'click' } });
    }
    if (!QUICK && Object.values(need()).some(Boolean)) await fail('not reached: ' + JSON.stringify(need()) + ' (no prompt of that kind appeared)', { decisions: res.decisions });
    // 5. the four fast-click cases
    await L.setBet(fr, b10);
    { const r = await round('spin', { burst: 2, label: 'fast: double click on SPIN', act: async () => { await waitReady(); const { x, y } = await spinXY(); await multiClick(x, y, 2); } }); res.cases.dbl = { rounds: r.serverRounds, ledger: r.ledgerRounds, ok: r.serverRounds === 1 && r.ledgerRounds === 1 && Object.values(r.checks || {}).every(Boolean) }; }
    { const r = await round('spin', { burst: 3, label: 'fast: triple click on SPIN', act: async () => { await waitReady(); const { x, y } = await spinXY(); await multiClick(x, y, 3); } }); res.cases.triple = { rounds: r.serverRounds, ledger: r.ledgerRounds, ok: r.serverRounds === 1 && r.ledgerRounds === 1 && Object.values(r.checks || {}).every(Boolean) }; }
    { let hit = null, clicked = 0, r = null; const sp0 = await spinXY();   // a click on SPIN while a PICK decision is open: a real click where the SPIN button sits when idle (the ONE MORE CALL keys cover that spot, so only the PICK prompt makes a clean case)
      for (let t = 0; t < 5 && !clicked; t++) {
        if (await cbp()) await round('spin', { label: 'callback played before the buy' });
        r = await round('buy:bonus1', { label: 'fast: click on SPIN while a decision is open' + (t ? ' (retry ' + t + ', no PICK in the first buy)' : ''), pol: { more: 'hang', onPrompt: async (k) => { if (k !== 'pick' || clicked) return; await sleep(900); const { x, y } = sp0; const fe = await (await fr.frameElement()).boundingBox(); hit = await fr.evaluate(([px, py]) => { const e = document.elementFromPoint(px, py); return e && (e.id || e.className || e.tagName); }, [x - fe.x, y - fe.y]).catch(() => null); await page.mouse.click(x, y); await sleep(200); await page.mouse.click(x, y); clicked = 2; } } });
      }
      res.cases.spinWhileDecision = { clicked, rounds: r.serverRounds, ledger: r.ledgerRounds, decisions: r.did, elementUnderSpinCentre: hit, ok: !!clicked && r.serverRounds === 1 && r.ledgerRounds === 1 && Object.values(r.checks || {}).every(Boolean) };
      if (!clicked) await fail('click on SPIN while a decision is open: no PICK prompt appeared in 5 buys, case not exercised', {}); }
    { const cheap = (res.buyMenu.filter((x) => !x.disabled).map((x) => x.id)).includes('hunt') ? 'hunt' : (res.buyMenu.find((x) => !x.disabled) || {}).id; let trace = [];
      const r = await round('buy:' + cheap, { label: 'fast: double click on a buy button', expect: [0, 1], pol: { more: 'hang' }, act: async () => {
        await fr.locator('#buy').click({ timeout: 15000 }); await sleep(500); const bb = await fr.locator('#buy_' + cheap).boundingBox(); await multiClick(bb.x + bb.width / 2, bb.y + bb.height / 2, 2); await sleep(600);
        const cf = fr.locator('#buy_confirm'); const hasCf = await cf.count(); trace.push('after double click on the option: confirm card ' + (hasCf ? 'up' : 'not up (menu closed or dismissed)'));
        if (hasCf) { const cb = await cf.boundingBox(); await multiClick(cb.x + cb.width / 2, cb.y + cb.height / 2, 2); trace.push('double click on the confirm button'); } } });
      res.cases.dblBuy = { buy: cheap, trace, rounds: r.serverRounds, ledger: r.ledgerRounds, outcome: r.serverRounds === 1 ? 'exactly one round' : r.serverRounds === 0 ? 'zero rounds (refused / dismissed)' : 'MORE THAN ONE', ok: r.serverRounds <= 1 && r.ledgerRounds === r.serverRounds && Object.values(r.checks || {}).every(Boolean) }; note('double click on buy: ' + JSON.stringify(res.cases.dblBuy)); }
    { const cheap = res.cases.dblBuy.buy;   // the same, through the confirm card: one click on the option, then a double click on CONFIRM
      const r = await round('buy:' + cheap, { label: 'fast: double click on the CONFIRM button of a buy', pol: { more: 'hang' }, act: async () => {
        await fr.locator('#buy').click({ timeout: 15000 }); await sleep(500); await fr.locator('#buy_' + cheap).click({ timeout: 8000 }); await sleep(600);
        const cb = await fr.locator('#buy_confirm').boundingBox(); await multiClick(cb.x + cb.width / 2, cb.y + cb.height / 2, 2); } });
      res.cases.dblConfirm = { buy: cheap, rounds: r.serverRounds, ledger: r.ledgerRounds, ok: r.serverRounds === 1 && r.ledgerRounds === 1 && Object.values(r.checks || {}).every(Boolean) }; }
    // 6. fill up to the minimum round count: second pass of forces at another bet and plain spins, bets mixed
    await L.setBet(fr, b20); const second = ['bonus2', 'phone', 'close', 'big', 'tease', 'bonus3'];
    for (let k = 0; !QUICK && res.rounds.filter((r) => r.serverRounds >= 1).length < MINROUNDS && k < 40; k++) { if (cbp && (await cbp()) && k > 0) { /* a waiting callback is played by the next plain spin */ }
      if (k % 3 === 0 && k / 3 < second.length) await round('spin', { force: second[k / 3], pol: { more: MORE[mi++ % 2] }, label: 'second pass' }); else await round('spin', { label: 'fill' }); }
    // ---- end of leg
    await sleep(1500); const l = led(), finalBal = bal();
    const sumBy = {}; for (const [k, v] of l.bal) { const c = k.split('|')[1]; sumBy[c] = (sumBy[c] || 0) + v; }
    const pool = [...l.bal].filter(([k]) => k.startsWith('pool:coldcall:office|')).map(([k, v]) => ({ k, v }));
    const sock = await new Promise((resolve, reject) => { const x = io(BASE, { forceNew: true }); x.on('connect', () => x.emit('auth_login', { name, pin: '1234' })); x.on('auth_ok', () => resolve(x)); x.on('auth_error', (e) => reject(new Error('auth ' + JSON.stringify(e)))); setTimeout(() => reject(new Error('sock timeout')), 15000); });
    const wallet = await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('wallet_get timeout')), 8000); sock.once('wallet', (w) => { clearTimeout(t); resolve(w); }); sock.emit('wallet_get'); }); sock.close();
    const scr = L.toUnits((await L.frState(fr)).bal, MODE), plate = L.toUnits(MODE === 'chips' ? (await L.plates(page)).chips : (await L.plates(page)).play, MODE);
    const plateWant = finalBal + (MODE === 'chips' ? l.seats(key, 'chips') : 0);
    res.end = { sumByCurrency: sumBy, escrowsNonZero: l.escrows, pool, screen: scr, wallet_get: wallet[MODE], ledger: finalBal, plate, plateWant, startBalance: res.startBalance.ledger };
    if (Object.values(sumBy).some((v) => v !== 0)) await fail('sum over all accounts is not 0', { sumBy });
    if (l.escrows.length) await fail('an escrow account is non-zero at the end', { escrows: l.escrows });
    if (pool.some((p) => p.v < 0)) await fail('pool:coldcall:office is negative', { pool });
    if (!(scr === wallet[MODE] && wallet[MODE] === finalBal)) await fail('screen != wallet_get != ledger at the end', res.end);
    if (plate !== plateWant) await fail('shell plate != ledger (+ table stacks)', res.end);
    res.juice = await fr.evaluate(() => (window.CC && CC.juice ? { on: CC.juice.on, landed: CC.juice.landed, puffs: CC.juice.puffs, nudges: CC.juice.nudges } : null)).catch((e) => 'eval failed: ' + e.message);   // (w3c lead) the fb1 motion layer: loaded and firing on this line? Not a pass / fail condition.
    res.consoleErrors = logs.filter((x) => !/favicon/.test(x)); res.badResponses = bad.filter((x) => !/favicon/.test(x));
    if (res.consoleErrors.length) await fail('console / page errors during the leg', { logs: res.consoleErrors.slice(0, 6) });
    await shot('end');
  } catch (e) { res.fatal = String((e && e.stack) || e).slice(0, 1200); console.log('FATAL', res.fatal); try { await fail('fatal: ' + String(e.message).split('\n')[0]); } catch (e2) { /* ignore */ } }
  finally { res.finished = new Date().toISOString(); res.counts = { rounds: res.rounds.filter((r) => r.serverRounds >= 1).length, actions: res.rounds.length, fails: res.fails.length }; res.pass = !QUICK && !res.fatal && res.fails.length === 0 && res.counts.rounds >= MINROUNDS; res.quick = QUICK; save(); if (bot) try { bot.close(); } catch (e) { /* ignore */ } await L.closeBrowser(b); }
  console.log(`LEG ${res.pass ? 'PASS' : 'FAIL'} ${NAME} rounds ${res.counts.rounds} actions ${res.counts.actions} fails ${res.fails.length}`); process.exit(res.pass ? 0 : 1);
})();
