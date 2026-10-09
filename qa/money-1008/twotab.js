'use strict';
// MONEY HARDENING 2026-10-08, builder M, item 2: a second tab of the same account must follow a balance change within a second, without a spin of its own.
// Two tabs (one browser context = one account), the same game open in both, the same mode. Tab 1 spends (Bender / Cold Call: one spin; Campaign: opens a run = the stake leaves the wallet).
// Tab 2 is only read: the game's own balance and the shell's top-bar plate must show the ledger balance of that mode within 1000 ms (the poll runs 4000 ms so the late case is measured too).
// usage: node qa/money-1008/twotab.js --out <scratch dir> [--port 4832] [--games bender,coldcall,campaign] [--modes chips,play]     exit 1 on any stale tab
const M = require('./mlib.js');
const { sleep, path, fs } = M;
const OUT = M.argOf('--out', path.join(M.ROOT, '_scratch', 'money', 'client', 'twotab')), PORT = Number(M.argOf('--port', '4832'));
const GAMESET = M.argOf('--games', 'bender,coldcall,campaign').split(','), MODES = M.argOf('--modes', 'chips,play').split(',');
const DATA = path.join(OUT, 'data'), BASE = 'http://127.0.0.1:' + PORT, LIMIT_MS = 1000;
fs.mkdirSync(OUT, { recursive: true });
const ck = M.checks();
const lastNum = (t) => { const m = String(t || '').match(/\$?[\d,]+(\.\d+)?/g); return m ? m[m.length - 1] : ''; };

async function spend(page, fr, game) {   // tab 1: one real spend
  if (game === 'bender') {
    await page.evaluate(() => { if (!window.__bt) { window.__bt = { n: 0 }; PingSocket.on('g:bender:result', () => { window.__bt.n++; }); } });
    const n0 = await page.evaluate(() => window.__bt.n);
    await fr.locator('#spin').click({ timeout: 15000 }); await page.waitForFunction((n) => window.__bt.n > n, n0, { timeout: 20000 });
    for (let i = 0; i < 60; i++) { if (await fr.evaluate(() => !BENDER.st.busy && !document.querySelector('#ov .scrim'))) break; const sc = fr.locator('#ov .scrim'); if (await sc.count()) await sc.first().click({ force: true, timeout: 2000 }).catch(() => {}); await sleep(300); }
  } else if (game === 'coldcall') {
    const st = await M.frState(fr); await M.setBet(fr, st.bets[0]); await M.clickSpin(page, fr); await M.finishRound(page, fr, st.rounds, { take: false, ms: 120000 });
  } else {
    if (!(await fr.evaluate(() => !!window.__campaign.home))) await M.pickHomeSearch(fr, 'Texas', /Texas/);
    await fr.locator('.segb[data-b]').first().click(); await sleep(150); await fr.locator('#cta').click(); await M.waitView(fr, 'run'); await sleep(300);
  }
}
async function endRun(fr) { if ((await M.viewOf(fr)) === 'run') { await fr.locator('#cta').click(); await M.waitView(fr, 'ended'); } }

async function oneCase(b, acct, game, mode) {
  const tag = 'twotab ' + game + ' ' + mode;
  const p1 = b.page, p2 = await b.ctx.newPage();
  await p2.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await M.waitSignedIn(p2, acct);
  const f1 = await M.openGame(p1, game), f2 = await M.openGame(p2, game);
  if ((await M.gameMode(f1, game)) !== mode) await M.setMode(f1, game, mode);
  if ((await M.gameMode(f2, game)) !== mode) await M.setMode(f2, game, mode);
  await sleep(600); await p1.bringToFront();
  const key = await p1.evaluate(() => Lobby.user().key), cur = mode;
  const before2 = { game: lastNum(await M.gameBalTxt(f2, game)), plate: (await M.plates(p2))[mode === 'chips' ? 'chips' : 'play'] };
  await spend(p1, f1, game);
  const t0 = Date.now(); let ok = null, last = null;
  while (Date.now() - t0 < 4000) {
    const l = M.readLedger(DATA), want = l.get(M.storeOf(key, cur), cur);
    const g2 = lastNum(await M.gameBalTxt(f2, game)), pl2 = (await M.plates(p2))[mode === 'chips' ? 'chips' : 'play'];
    const gu = M.toUnits(g2, mode), pu = M.toUnits(pl2, mode);
    last = { want, g2, pl2, gu, pu };
    // Chips plate = bank + table stacks (none here), so the bank balance is the number; the game shows the same wallet figure
    if (gu === want && pu === want && ok == null) { ok = Date.now() - t0; break; }
    await sleep(100);
  }
  console.log('  ' + JSON.stringify({ tag, before2, tab2After: last, convergedMs: ok }));
  ck.ok(tag + ' | tab 2 game balance + plate follow tab 1 within ' + LIMIT_MS + ' ms', ok != null && ok <= LIMIT_MS, { convergedMs: ok, last });
  if (game === 'campaign') await endRun(f1);
  await p2.close(); await p1.bringToFront();
}

// Cold Call with a decision: tab 1 spins until a round waits for a decision (PICK YOUR LEAD / ONE MORE CALL). Tab 2 mirrors that round (busy, no prompt). Tab 1 answers; the round settles.
// Tab 2's balance must then follow within LIMIT_MS (a busy tab used to ignore the wallet push and keep the old number until its own next spin).
async function ccDecisionCase(b, acct, mode) {
  const tag = 'twotab coldcall-decision' + (M.hasFlag('--late') ? '-late ' : ' ') + mode;
  const LATE = M.hasFlag('--late');   // --late: tab 2 is opened WHILE the decision is open (it opens busy, no prompt: the qa/p6-w3b extra 3 case)
  const p1 = b.page; let p2 = null, f2 = null;
  const f1 = await M.openGame(p1, 'coldcall');
  const openTab2 = async () => { p2 = await b.ctx.newPage(); await p2.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await M.waitSignedIn(p2, acct); f2 = await M.openGame(p2, 'coldcall'); if ((await M.gameMode(f2, 'coldcall')) !== mode) await M.setMode(f2, 'coldcall', mode); await sleep(600); await p1.bringToFront(); };
  if ((await M.gameMode(f1, 'coldcall')) !== mode) await M.setMode(f1, 'coldcall', mode);
  if (!LATE) await openTab2();
  const key = await p1.evaluate(() => Lobby.user().key);
  let prompt = null, spins = 0;
  for (; spins < 8 && !prompt; spins++) {   // buy a bonus until a PICK / MORE prompt is up (the recipe of qa/p6-w3b/extras.js)
    const st = await M.frState(f1); await M.setBet(f1, st.bets[0]); await M.buyBonus(f1, 'bonus1'); let keyed = 0; const t0 = Date.now();
    while (Date.now() - t0 < 120000) { const s = await M.frState(f1); if (s.prompt) { prompt = s.prompt; break; } if (s.rounds > st.rounds && !s.busy) break; if (Date.now() - keyed > 1500 && (await M.tapDial(p1, f1))) keyed = Date.now(); await sleep(150); }
  }
  if (!prompt) { ck.add(tag + ' | a round with a decision turned up in 8 bonus buys', false, 'a prompt', 'none'); if (p2) await p2.close(); return; }
  if (LATE) await openTab2();
  await sleep(1200);
  const mid2 = await M.frState(f2);
  // answer in tab 1 until idle, then time tab 2
  let t0 = 0; const tEnd = Date.now() + 90000;
  for (;;) {
    const s = await M.frState(f1);
    if (s.prompt === 'pick') { await M.clickLit(f1); await sleep(400); } else if (s.prompt === 'more') { await M.clickMore(f1, false); await sleep(400); }
    else if (!s.busy) { t0 = Date.now(); break; } else { await M.tapDial(p1, f1); await sleep(250); }
    if (Date.now() > tEnd) throw new Error('tab 1 never went idle');
  }
  let ok = null, last = null; const trace = [];
  while (Date.now() - t0 < Number(M.argOf('--wait', '6000'))) {
    const want = M.readLedger(DATA).get(M.storeOf(key, mode), mode);
    const s2 = await M.frState(f2), g2 = lastNum(await M.gameBalTxt(f2, 'coldcall')), pl2 = (await M.plates(p2))[mode === 'chips' ? 'chips' : 'play'];
    last = { want, g2, pl2, busy2: s2.busy, prompt2: s2.prompt };
    if (s2.busy && (!trace.length || Date.now() - trace[trace.length - 1].t > 1000)) trace.push({ t: Date.now(), dt: Date.now() - t0, ...(await f2.evaluate(() => { const c = CC.core, x = c.st.ctx; return { ff: c.st.ff, skip: c.st.skip, ctx: !!x, status: x && x.p.status, modal: c.st.modal, dec: x && x.decisions && x.decisions.length, prompt: x && x.promptOpen, rl: c.st.live, ov: document.querySelector('#ov') && document.querySelector('#ov').children.length, rib: (document.querySelector('#ribL') || {}).textContent, err: CC.dbg && CC.dbg.error }; }).catch((e) => ({ e: String(e) }))) }); last.trace = trace.slice(-25);
    if (M.toUnits(g2, mode) === want && M.toUnits(pl2, mode) === want) { ok = Date.now() - t0; break; }
    await sleep(100);
  }
  console.log('  ' + JSON.stringify({ tag, spinsToDecision: spins, tab2WhileOpen: { busy: mid2.busy, prompt: mid2.prompt, bal: mid2.bal }, tab2After: last, convergedMs: ok }));
  ck.ok(tag + ' | tab 2 game balance + plate follow tab 1 within ' + LIMIT_MS + ' ms of the round closing', ok != null && ok <= LIMIT_MS, { convergedMs: ok, last });
  await p2.close(); await p1.bringToFront();
}

(async () => {
  let srv = null, b = null;
  try {
    srv = await M.startServer(PORT, DATA, path.join(OUT, 'server.log')); b = await M.launch(1280, 900);
    const acct = { name: 'tt' + Date.now().toString(36).slice(-5), pin: '1234' };
    await M.signUp(b.page, BASE, acct.name, acct.pin);
    console.log('server pid ' + srv.pid + ' port ' + PORT);
    for (const game of GAMESET) for (const mode of MODES) {
      if (game === 'coldcall-decision') { console.log('--- coldcall decision ' + mode); try { await b.page.evaluate(() => { for (const g of ['bender', 'coldcall', 'campaign']) { try { Shell.close(g); } catch (e) { /* not open */ } } }); await sleep(300); await b.page.reload({ waitUntil: 'domcontentloaded' }); await M.waitSignedIn(b.page, acct); await ccDecisionCase(b, acct, mode); } catch (e) { ck.add('SCENARIO ERROR coldcall-decision ' + mode, false, 'no error', String(e && e.message || e).slice(0, 220)); for (const p of b.ctx.pages()) if (p !== b.page) await p.close().catch(() => {}); } continue; }
      console.log('--- ' + game + ' ' + mode);
      try { await b.page.evaluate(() => { for (const g of ['bender', 'coldcall', 'campaign']) { try { Shell.close(g); } catch (e) { /* not open */ } } }); await sleep(300); await b.page.reload({ waitUntil: 'domcontentloaded' }); await M.waitSignedIn(b.page, acct); await oneCase(b, acct, game, mode); }
      catch (e) { ck.add('SCENARIO ERROR ' + game + ' ' + mode, false, 'no error', String(e && e.message || e).slice(0, 220)); await M.shot(b.page, OUT, 'err_' + game + '_' + mode).catch(() => {}); for (const p of b.ctx.pages()) if (p !== b.page) await p.close().catch(() => {}); }
    }
  } catch (e) { ck.add('DRIVER ERROR', false, 'no error', String(e && e.stack || e).slice(0, 400)); }
  finally {
    await M.closeBrowser(b); M.stopServer(srv);
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ passed: ck.passed, failed: ck.failed, fails: ck.rows.filter((r) => !r.pass) }, null, 1));
    console.log('\ntwotab: ' + ck.passed + ' passed, ' + ck.failed + ' FAILED'); process.exit(ck.failed ? 1 : 0);
  }
})();
