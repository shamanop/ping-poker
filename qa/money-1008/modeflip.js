'use strict';
// MONEY HARDENING 2026-10-08, builder M, item 1: mode flip. Real server (fresh data dir, own port), real headless browser, real shell, real clicks.
// For Ballot Bender, Cold Call and Campaign Trail, in CHIPS mode: reload (between rounds / mid round), reload during a held feature, socket drop + reconnect, close + reopen the dock window,
// game A in Chips while game B goes to Cash and back, a second tab of the account in the other mode, the "show chips as dollars" preference on and off, a fresh account's first spin.
// After each one it reads (1) the game's own mode, (2) the shell's wmode (Shell.wmode()), (3) the currency of the NEXT ledger line the server writes (money.jsonl), after a real spin.
// A FLIP = the ledger currency differs from the mode the game screen showed, or the shell's mode differs from the game's, or the game's mode moved with nobody touching it.
// usage: node qa/money-1008/modeflip.js --out <scratch dir> [--port 4830] [--games bender,coldcall,campaign] [--only a1,b]    exit 1 on any flip
const M = require('./mlib.js');
const { sleep, path, fs } = M;
const OUT = M.argOf('--out', path.join(M.ROOT, '_scratch', 'money', 'client', 'modeflip')), PORT = Number(M.argOf('--port', '4830'));
const GAMESET = M.argOf('--games', 'bender,coldcall,campaign').split(','), ONLY = M.argOf('--only', '').split(',').filter(Boolean);
const DATA = path.join(OUT, 'data'), BASE = 'http://127.0.0.1:' + PORT;
fs.mkdirSync(OUT, { recursive: true });
const ck = M.checks(); const notes = [];
const note = (s) => { notes.push(s); console.log('INFO ' + s); };
const other = (g) => (g === 'bender' ? 'coldcall' : 'bender');

let B = null;       // { b: browser bundle, page, acct:{name,pin}, key }
let nAcct = 0;
const newName = () => 'mf' + Date.now().toString(36).slice(-5) + (++nAcct);

// ---- one real spin per game, cheapest bet, finished (prompts answered, scrims closed). Returns when idle.
async function spinOnce(page, fr, game) {
  if (game === 'bender') {
    await page.evaluate(() => { if (!window.__bt) { window.__bt = { n: 0 }; PingSocket.on('g:bender:result', () => { window.__bt.n++; }); } });
    const n0 = await page.evaluate(() => window.__bt.n);
    for (let i = 0; i < 12; i++) { const down = fr.locator('#betDn'); if (!(await down.count())) break; const dis = await down.evaluate((e) => e.disabled || e.classList.contains('off')).catch(() => true); if (dis) break; await down.click({ timeout: 4000 }).catch(() => {}); await sleep(40); }
    await fr.locator('#spin').click({ timeout: 15000 });
    await page.waitForFunction((n) => window.__bt.n > n, n0, { timeout: 20000 });
    await settleBender(fr);
  } else if (game === 'coldcall') {
    const st = await M.frState(fr); const n0 = st.rounds;
    await M.setBet(fr, st.bets[0]); await M.clickSpin(page, fr); await M.finishRound(page, fr, n0, { take: false, ms: 120000 });
  } else throw new Error('spinOnce is not for campaign');
}
async function settleBender(fr, ms = 90000) {
  const t0 = Date.now();
  for (;;) {
    const busy = await fr.evaluate(() => !!BENDER.st.busy);
    const hasSc = (await fr.locator('#ov .scrim').count()) > 0; const sc = (await fr.locator('#ov .scrim button').count()) ? fr.locator('#ov .scrim button') : fr.locator('#ov .scrim');   // a button, or "TAP TO START" anywhere on the scrim
    if (!busy && !hasSc) { await sleep(400); const b2 = await fr.evaluate(() => !!BENDER.st.busy || !!document.querySelector('#ov .scrim')); if (!b2) return; }
    if (hasSc) await sc.first().click({ timeout: 3000, force: true }).catch(() => {});
    if (Date.now() - t0 > ms) throw new Error('bender did not settle');
    await sleep(300);
  }
}

// answer whatever prompt a Cold Call round left (after a reload the page has no round count to wait for): idle for 2.5 s = done
async function drainCC(page, fr, ms = 150000) {
  const t0 = Date.now(); let idleSince = 0, lastDial = 0;
  for (;;) {
    const s = await M.frState(fr);
    if (s.prompt === 'pick') { await M.clickLit(fr); idleSince = 0; await sleep(500); continue; }
    if (s.prompt === 'more') { await M.clickMore(fr, false); idleSince = 0; await sleep(500); continue; }
    if (s.busy && Date.now() - lastDial > 1500 && (await M.tapDial(page, fr))) lastDial = Date.now();
    if (!s.busy && !s.prompt) { if (!idleSince) idleSince = Date.now(); if (Date.now() - idleSince > 2500) return; } else idleSince = 0;
    if (Date.now() - t0 > ms) throw new Error('cold call did not go idle: ' + JSON.stringify(s).slice(0, 200));
    await sleep(250);
  }
}

// ---- campaign: start a run (cheapest stake), return the run's ledger currency; withdraw ends it
async function campStart(page, fr, homeQ = 'Texas') {
  const v = await M.viewOf(fr);
  if (v === 'ended') { await fr.locator('#cta').click(); await M.waitView(fr, 'run'); return; }
  if (v !== 'setup') throw new Error('campaign view is ' + v);
  const home = await fr.evaluate(() => !!window.__campaign.home);
  if (!home) await M.pickHomeSearch(fr, homeQ, new RegExp(homeQ));
  await fr.locator('.segb[data-b]').first().click(); await sleep(150);
  await fr.locator('#cta').click(); await M.waitView(fr, 'run'); await sleep(500);
}
async function campEnd(fr) { const v = await M.viewOf(fr); if (v === 'run') { await fr.locator('#cta').click(); await M.waitView(fr, 'ended'); await sleep(400); } }

// ---- the probe: read the three things, spend one real spin, read the ledger
async function probe(tag, game, intended, opts = {}) {
  const page = opts.page || B.page; const fr = opts.fr || M.frameFor(page, game);
  const gm = await M.gameMode(fr, game), wm = await M.shellMode(page, game);
  const key = opts.key || B.key;
  const n0 = M.ledgerLines(DATA, game, key).length;
  if (game === 'campaign') { await campStart(page, fr); } else await spinOnce(page, fr, game);
  await sleep(500);
  const gm2 = await M.gameMode(fr, game);
  const lines = M.ledgerLines(DATA, game, key).slice(n0), curs = [...new Set(lines.map((l) => l.cur))];
  const res = { tag, game, gameMode: gm, shellMode: wm, ledger: curs };
  console.log('  ' + JSON.stringify(res));
  ck.ok(tag + ' | ledger wrote a line', lines.length > 0, lines.length);
  ck.eq(tag + ' | ledger currency == the mode the screen showed', curs, [gm]);
  ck.eq(tag + ' | game mode unchanged by the spin', gm2, gm);
  ck.ok(tag + ' | shell wmode == game mode (' + gm + ')', wm === gm, wm);
  if (intended) ck.eq(tag + ' | mode is the one the player chose (' + intended + ')', gm, intended);
  else if (gm !== 'chips') note(tag + ': page came back in ' + gm + ' (the player was in chips); consistent with the ledger, but a reset to Cash');
  if (game === 'campaign') await campEnd(fr);
  return res;
}

// ---- common setup: be in the game, in chips, shell and game agreeing
async function toChips(game, page = B.page) {
  let fr = await M.openGame(page, game);
  if ((await M.gameMode(fr, game)) !== 'chips') await M.setMode(fr, game, 'chips');
  const gm = await M.gameMode(fr, game), wm = await M.shellMode(page, game);
  if (gm !== 'chips' || wm !== 'chips') note('setup: after clicking Chips in ' + game + ' game=' + gm + ' shell=' + wm);
  return fr;
}
async function reloadPage(page) { await page.reload({ waitUntil: 'domcontentloaded' }); await M.waitSignedIn(page, B.acct); }
async function dropSocket(page) {
  await page.evaluate(() => { try { PingSocket.io.engine.close(); } catch (e) { PingSocket.disconnect(); PingSocket.connect(); } });
  await page.waitForFunction(() => window.PingSocket && PingSocket.connected, null, { timeout: 30000 }).catch(() => {});
  await M.waitSignedIn(page, B.acct); await sleep(3000);
}
async function reacquire(game) { const fr = await M.openGame(B.page, game); await sleep(800); return fr; }

// the box is shared and chrome has been OOM-killed under it: start a new browser, log the same account in
async function relaunch() {
  note('browser was gone: relaunched'); await M.closeBrowser(B.b).catch(() => {});
  B.b = await M.launch(1280, 900); B.page = B.b.page; await B.page.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await M.waitSignedIn(B.page, B.acct);
}
// every scenario starts from a clean page: extra tabs closed, game windows closed, page reloaded
async function reset() {
  for (const p of B.b.ctx.pages()) if (p !== B.page) await p.close().catch(() => {});
  await B.page.evaluate(() => { for (const g of ['bender', 'coldcall', 'campaign']) { try { Shell.close(g); } catch (e) { /* not open */ } } }).catch(() => {});
  await sleep(400); await reloadPage(B.page);
}

// ---- scenarios. Each returns after its probe(s).
const SC = {
  async a1(game) {   // reload between rounds
    await toChips(game); if (game === 'campaign') { /* setup view, no run yet */ }
    await reloadPage(B.page); await reacquire(game); await probe('a1 reload between rounds [' + game + ']', game, 'chips');
  },
  async a2(game) {   // reload mid round
    const fr = await toChips(game);
    if (game === 'campaign') { await campStart(B.page, fr); }
    else if (game === 'bender') { await B.page.evaluate(() => { if (!window.__bt) { window.__bt = { n: 0 }; PingSocket.on('g:bender:result', () => { window.__bt.n++; }); } }); await fr.locator('#spin').click(); await sleep(600); }
    else { await fr.locator('#spin').click(); await sleep(900); }
    await reloadPage(B.page); const fr2 = await reacquire(game);
    if (game === 'campaign') { const gm = await M.gameMode(fr2, game); ck.eq('a2 campaign run survives reload in chips: game', gm, 'chips'); ck.eq('a2 campaign shell wmode', await M.shellMode(B.page, game), 'chips'); await M.waitView(fr2, 'run', 8000).catch(() => {}); await campEnd(fr2); }
    else { if (game === 'coldcall') await drainCC(B.page, fr2).catch((e) => note('a2 drain: ' + e.message.slice(0, 80))); await sleep(1500); }
    await probe('a2 reload mid round [' + game + ']', game, 'chips');
  },
  async b(game) {    // reload during a held feature
    const fr = await toChips(game);
    if (game === 'campaign') return note('b: Campaign has no held feature besides the open run (covered by a2)');
    if (game === 'bender') {
      await fr.locator('#buy').click(); await fr.locator('.buyopt[data-v="buy-election"]').click({ timeout: 8000 }); await sleep(2500);
    } else {
      const st = await M.frState(fr); await M.setBet(fr, st.bets[0]); await M.buyBonus(fr, 'bonus1'); await sleep(2500);
    }
    const busy = await M.busyOf(fr, game); if (!busy) note('b [' + game + ']: feature already over before the reload (the round may be too short)');
    await reloadPage(B.page); const fr2 = await reacquire(game);
    if (game === 'coldcall') await drainCC(B.page, fr2).catch((e) => note('b drain: ' + e.message.slice(0, 80)));
    await sleep(1500); await probe('b reload during held feature [' + game + ']', game, 'chips');
  },
  async c(game) {    // socket drop and reconnect
    await toChips(game); await dropSocket(B.page); await reacquire(game); await probe('c socket drop + reconnect [' + game + ']', game, 'chips');
  },
  async c2(game) {   // socket drop while a held feature / run is open
    const fr = await toChips(game);
    if (game === 'campaign') await campStart(B.page, fr);
    else if (game === 'bender') { await fr.locator('#buy').click(); await fr.locator('.buyopt[data-v="buy-election"]').click({ timeout: 8000 }); await sleep(1500); }
    else { await fr.locator('#spin').click(); await sleep(900); }
    await dropSocket(B.page); const fr2 = await reacquire(game);
    const gm = await M.gameMode(fr2, game); ck.eq('c2 drop during a round [' + game + '] game mode still chips', gm, 'chips'); ck.eq('c2 shell wmode', await M.shellMode(B.page, game), 'chips');
    if (game === 'campaign') await campEnd(fr2); else if (game === 'coldcall') await drainCC(B.page, fr2).catch(() => {}); else await settleBender(fr2).catch(() => {});
    await probe('c2 after drop in a round [' + game + ']', game, 'chips');
  },
  async d(game) {    // close and reopen the dock window
    await toChips(game);
    await B.page.evaluate((g) => Shell.close(g), game); await sleep(900);
    const fr = await reacquire(game); await probe('d close + reopen window [' + game + ']', game, 'chips');
    void fr;
  },
  async e(game) {    // A in Chips, B to Cash, back to A
    if (game === 'campaign') return note('e: Campaign checked as A against Bender as B');
    const o = other(game);
    await toChips(game);
    const fo = await M.openGame(B.page, o); await M.setMode(fo, o, 'play'); await sleep(500);
    ck.eq('e setup: ' + o + ' now shows Cash', await M.gameMode(fo, o), 'play');
    await B.page.locator('button.sh-di', { hasText: M.GAMES[game].dock }).click().catch(() => {}); await sleep(600);
    const fa = await reacquire(game);
    await probe('e A=' + game + ' chips, B=' + o + ' to Cash, back to A', game, 'chips', { fr: fa });
    // the stale shell mode meets a resync: a socket drop re-asks state and the shell answers with its wmode
    await dropSocket(B.page); const fa2 = await reacquire(game);
    await probe('e2 same, then socket drop [' + game + ']', game, 'chips', { fr: fa2 });
    const fo2 = await reacquire(o); ck.eq('e3 other game ' + o + ' still shows Cash', await M.gameMode(fo2, o), 'play');
    await M.setMode(fo2, o, 'chips');   // leave B in chips for the next scenarios
  },
  async eCamp() {    // Campaign A (chips run open), Bender B to Cash, back
    const fr = await toChips('campaign'); await campStart(B.page, fr);
    const fo = await M.openGame(B.page, 'bender'); await M.setMode(fo, 'bender', 'play'); await sleep(400);
    await B.page.locator('button.sh-di', { hasText: 'Campaign Trail' }).click().catch(() => {}); await sleep(500);
    await dropSocket(B.page); const fr2 = await reacquire('campaign');
    ck.eq('eCamp campaign run still chips after Bender went Cash + drop', await M.gameMode(fr2, 'campaign'), 'chips');
    await campEnd(fr2); await probe('eCamp play again [campaign]', 'campaign', 'chips'); const fo2 = await reacquire('bender'); await M.setMode(fo2, 'bender', 'chips');
  },
  async f(game) {    // a second tab of the same account in the other mode
    const fr = await toChips(game);
    const p2 = await B.b.ctx.newPage(); await p2.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await M.waitSignedIn(p2, B.acct);
    const fr2 = await M.openGame(p2, game); await M.setMode(fr2, game, 'play'); await sleep(500);
    await p2.close(); await B.page.bringToFront(); await sleep(500);
    await probe('f tab 2 set Cash, tab 1 stays chips [' + game + ']', game, 'chips', { fr });
    void fr2;
  },
  async f2(game) {   // the second tab spins in Cash while tab 1 is open in chips; tab 1's next spin
    if (game === 'campaign') return;
    const fr = await toChips(game);
    const p2 = await B.b.ctx.newPage(); await p2.goto(BASE + '/', { waitUntil: 'domcontentloaded' }); await M.waitSignedIn(p2, B.acct);
    const fr2 = await M.openGame(p2, game); await M.setMode(fr2, game, 'play'); await sleep(300);
    try { await probe('f2 tab 2 spins in Cash [' + game + ']', game, 'play', { page: p2, fr: fr2 }); } catch (e) { await M.shot(p2, OUT, 'err_f2_tab2_' + game).catch(() => {}); throw e; }
    await p2.close(); await B.page.bringToFront(); await sleep(800);
    await probe('f2 then tab 1 spins in chips [' + game + ']', game, 'chips', { fr });
  },
  async g(game) {    // show chips as dollars on and off
    await toChips(game);
    for (const pref of ['usd', 'chips']) {
      await B.page.evaluate((p) => Money.setPref(p, true), pref); await sleep(900);
      const fr = await reacquire(game); await probe('g pref=' + pref + ' [' + game + ']', game, 'chips', { fr });
    }
  },
  async h(game) {    // a fresh account whose first spin is in Chips
    const acct = { name: newName(), pin: '1234' }; const old = B.acct, oldKey = B.key;
    await B.b.ctx.clearCookies(); await B.page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) { /* ignore */ } });
    await M.signUp(B.page, BASE, acct.name, acct.pin); B.acct = acct; B.key = await B.page.evaluate(() => Lobby.user().key);
    await toChips(game); await probe('h fresh account first spin in chips [' + game + ']', game, 'chips');
    void old; void oldKey;
  },
};
const ORDER = ['a1', 'a2', 'b', 'c', 'c2', 'd', 'e', 'f', 'f2', 'g', 'h'];

(async () => {
  let srv = null; B = { b: null };
  try {
    srv = await M.startServer(PORT, DATA, path.join(OUT, 'server.log'));
    B.b = await M.launch(1280, 900); B.page = B.b.page;
    B.acct = { name: newName(), pin: '1234' };
    await M.signUp(B.page, BASE, B.acct.name, B.acct.pin); B.key = await B.page.evaluate(() => Lobby.user().key);
    console.log('server pid ' + srv.pid + ' port ' + PORT + ' account ' + B.key + ' shell.wmode handle: ' + (await M.shellMode(B.page, 'bender')));
    for (const game of GAMESET) {
      for (const id of ORDER) {
        if (ONLY.length && !ONLY.includes(id)) continue;
        const key = id === 'h' ? 'h' : id; const label = id + ' [' + game + ']'; console.log('--- ' + label);
        try { await reset(); } catch (e) { note('reset before ' + label + ' failed: ' + String(e.message).slice(0, 100)); if (/closed|crash/i.test(e.message)) await relaunch(); }
        try { await SC[key](game); } catch (e) { ck.add('SCENARIO ERROR ' + label, false, 'no error', String(e && e.message || e).slice(0, 200)); await M.shot(B.page, OUT, 'err_' + id + '_' + game).catch(() => {}); try { const f = M.frameFor(B.page, game); console.log('  diag ' + JSON.stringify(await f.evaluate((g) => g === 'bender' ? { busy: BENDER.st.busy, scrim: (document.querySelector('#ov .scrim') || {}).innerText, spin: document.getElementById('spin').className, mode: document.getElementById('modebar').dataset.state } : { scrim: (document.querySelector('#ov .scrim') || {}).innerText }, game)).slice(0, 400)); } catch (e2) { /* no frame */ } }
        // keep the next scenario's account healthy: if h switched accounts, stay on it (cash/chips exist on the new account)
      }
      if (game === 'campaign' && (!ONLY.length || ONLY.includes('eCamp'))) { try { await SC.eCamp(); } catch (e) { ck.add('SCENARIO ERROR eCamp', false, 'no error', String(e && e.message || e).slice(0, 200)); } }
    }
  } catch (e) { ck.add('DRIVER ERROR', false, 'no error', String(e && e.stack || e).slice(0, 400)); }
  finally {
    await M.closeBrowser(B.b); M.stopServer(srv);
    const bad = ck.rows.filter((r) => !r.pass);
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ passed: ck.passed, failed: ck.failed, fails: bad, notes }, null, 1));
    console.log('\nmodeflip: ' + ck.passed + ' passed, ' + ck.failed + ' FAILED' + (bad.length ? ' (flips / errors above)' : ''));
    process.exit(ck.failed ? 1 : 0);
  }
})();
