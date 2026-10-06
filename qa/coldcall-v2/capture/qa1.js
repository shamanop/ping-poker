// QA r1 driver: REAL mouse clicks on the real spin / buy / mode buttons, live server wallet read fresh from a second socket after every round.
//   node qa1.js <wide|narrow|docked> <play|chips> [quick]
// wide = 1440x900 standalone page, narrow = 540x960 standalone page, docked = real shell (1280x800) with Cold Call docked 360 px wide, iframe bridge.
// Per round it checks: WIN meter text == credited (server wallet delta == totalWin - cost, to the unit), other purse unchanged, game balance == server wallet,
// (docked) shell wallet == game balance, game self-check mismatch list empty, no stuck round. Samples the WIN meter vs the bonus HUD total every 100 ms.
const { launch, sleep } = require('./qalib'); const { openProbe } = require('./probe'); const fs = require('fs');
const [size = 'narrow', cur = 'play', quick] = process.argv.slice(2);
const SIZES = { wide: [1440, 900], narrow: [540, 960], docked: [1280, 800] };
const BASE = 'http://127.0.0.1:4610';
const OUT = '/home/frank/.openclaw/workspace/projects/ping-coldcall/qa/coldcall-v2/qa1'; fs.mkdirSync(OUT, { recursive: true });
const TAG = `${size}-${cur}`;
const num = (t) => { const m = String(t).replace(/[,$\s]/g, ''); return cur === 'play' ? Math.round(parseFloat(m) * 100) : Math.round(parseFloat(m)); };
const R = { tag: TAG, rounds: [], checks: [], fails: [], notes: [] };
const fail = (what, d) => { R.fails.push({ what, ...d }); console.log('FAIL', what, JSON.stringify(d)); };
let page, fr, probe, name = 'qa' + Date.now().toString(36).slice(-6), docked = size === 'docked';
let lastSrv = null;

const G = (fn, arg) => fr.evaluate(fn, arg);                                   // run in the game frame
const bb = async (sel) => { const b = await fr.locator(sel).boundingBox(); if (!b) throw new Error('no box ' + sel); return b; };
const mclick = async (sel, o = {}) => { const b = await bb(sel); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, o); };
const stState = () => G(() => { const c = CC.core.st; return { busy: c.busy, modal: c.modal, mode: c.mode, live: c.live, started: CC.dbg.started || 0, checked: CC.dbg.checked || 0, spins: (window.__spins || []).length, bal: document.getElementById('bal').textContent, win: document.getElementById('win').textContent, bet: document.getElementById('bet').textContent, mis: CC.dbg.mismatch.length, err: CC.dbg.error || null, rounds: CC.dbg.rounds.length }; });

async function setup() {
  const [w, h] = SIZES[size]; const b = await launch(w, h); page = b.page; R.logs = b.logs; R.browser = b.browser;
  if (!docked) {
    await page.goto(`${BASE}/games/coldcall/index.html?nosplash&live=1&name=${name}&pin=1234`); await page.waitForFunction(() => window.CC && CC.ready && CC.core.st.live, null, { timeout: 40000 }); fr = page.mainFrame();
    await G(() => { const s = CC.core.T.sock, o = s.emit.bind(s); s.emit = (ev, ...a) => { if (ev === 'g:coldcall:spin' && window.__qaForce) { a[0] = { ...a[0], force: window.__qaForce }; window.__qaForce = null; } return o(ev, ...a); }; });
  } else {
    await page.goto(BASE + '/'); await page.waitForFunction(() => window.PingSocket && window.Shell, null, { timeout: 20000 });
    await page.evaluate((name) => { PingSocket.once('auth_error', () => PingSocket.emit('auth_signup', { name, pin: '1234', avatar: 'a01' })); PingSocket.emit('auth_login', { name, pin: '1234' }); }, name);
    await page.waitForFunction(() => Shell.isSignedIn(), null, { timeout: 15000 }); await sleep(1500); await page.keyboard.press('Escape'); await sleep(300);
    if (await page.locator('.pj-modal.open').count()) { await page.evaluate(() => document.querySelector('.pj-modal.open button').click()); await sleep(500); }
    await page.evaluate(() => { const o = PingSocket.emit.bind(PingSocket); PingSocket.emit = (ev, ...a) => { if (ev === 'g:coldcall:spin' && window.__qaForce) { a[0] = { ...a[0], force: window.__qaForce }; window.__qaForce = null; } return o(ev, ...a); }; });
    await page.evaluate(() => Shell.openGame('coldcall')); await page.waitForSelector('.sh-win[data-game=coldcall] iframe', { timeout: 10000 });
    await page.waitForFunction(() => { const f = document.querySelector('.sh-win[data-game=coldcall] iframe'); return f.contentWindow.CC && f.contentWindow.CC.ready; }, null, { timeout: 20000 });
    fr = page.frames().find((f) => /games\/coldcall/.test(f.url()));
    await fr.locator('#go').click(); await sleep(900);
    await page.waitForFunction(() => document.querySelector('.sh-win[data-game=coldcall] iframe').contentWindow.CC.core.st.live, null, { timeout: 15000 });
    await page.evaluate(() => { const g = Shell.state().games.coldcall; g.w = 360 / 1280; Shell.dock('coldcall', 'right'); Shell.layout(); }); await sleep(1200);
    R.dock = await page.evaluate(() => { const r = document.querySelector('.sh-win[data-game=coldcall]').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  }
  await G(() => { const T = CC.core.T, o = T.spin; T.spin = async (...a) => { const r = await o.apply(T, a); (window.__spins = window.__spins || []).push({ args: a.slice(0, 3), id: r.roundId, cost: r.cost, win: r.totalWin, tier: r.tier, forced: r.forced || null, wallet: r.wallet || r.balances || null, script: r.script }); return r; };
    window.__samp = []; setInterval(() => { const bh = document.getElementById('bh'), t = document.querySelector('#tier .amt'); __samp.push([Date.now(), CC.core.st.busy ? 1 : 0, document.getElementById('win').textContent, bh && !bh.hidden ? document.getElementById('bhTot').textContent : null, t ? t.textContent : null, document.getElementById('bhTotL') ? document.getElementById('bhTotL').textContent : '']); }, 100); });
  probe = await openProbe(R.browser, name, '1234');
  // currency: a real click on the real mode button
  await mclick(`#modebar button[data-m=${cur}]`); await sleep(500);
  const m = await G(() => CC.core.st.mode); if (m !== cur) throw new Error('mode ' + m);
  // bet: $1.00 in Play $, 10 chips in Chips (the 10,000-chip purse has to pay for a 12-spin buy)
  const want = cur === 'play' ? 100 : 10;
  for (let i = 0; i < 6; i++) { const b = await G(() => CC.core.st.bets[CC.core.st.betIdx]); if (b === want) break; await mclick(b > want ? '#betDn' : '#betUp'); await sleep(150); }
  R.bet = await G(() => CC.core.st.bets[CC.core.st.betIdx]); lastSrv = await probe.read(); R.start = lastSrv.wallet;
}

// ---- driver helpers
async function tapper(t0) {                                                    // real click on the big-win overlay / bonus cards so a wait does not sit out its timer
  const el = await G(() => !!document.querySelector('#tier .amt, .scn .tap, .scn.rot')); if (!el) return;
  const sel = await G(() => (document.querySelector('#tier') ? '#tier' : '.scn')); const b = await fr.locator(sel).first().boundingBox().catch(() => null); if (!b) return;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2).catch(() => {});
}
async function waitRound(before, label, opts = {}) {
  const t0 = Date.now(), lim = opts.limit || 300000; let lastTap = 0;
  while (true) {
    const s = await stState();
    if (s.err) { fail('page error', { label, err: s.err }); return s; }
    if (s.spins > before && !s.busy && s.checked >= s.spins) return s;
    if (Date.now() - t0 > lim) { const dump = await G(() => ({ busy: CC.core.st.busy, modal: CC.core.st.modal, ov: document.getElementById('ov') ? document.getElementById('ov').innerHTML.slice(0, 300) : null, rounds: CC.dbg.rounds.length })); fail('stuck round', { label, dump, s }); return s; }
    if (Date.now() - lastTap > 1500 && !opts.notap) { lastTap = Date.now(); await tapper(t0); }
    await sleep(300);
  }
}
async function verify(label, before, extra = {}) {
  const s = await stState(); const sp = await G((i) => window.__spins[i], before); await sleep(docked ? 1500 : 800);
  const after = await probe.read(); const was = lastSrv; lastSrv = after;
  const purse = cur, other = cur === 'play' ? 'chips' : 'play';
  const win = sp.win, cost = sp.cost, dS = after.wallet[purse] - was.wallet[purse], dO = after.wallet[other] - was.wallet[other];
  const g = await G(() => ({ bal: document.getElementById('bal').textContent, win: document.getElementById('win').textContent, bh: document.getElementById('bh').hidden, nOv: document.getElementById('ov').children.length, mis: CC.dbg.mismatch.slice(), busy: CC.core.st.busy }));
  const shell = docked ? await page.evaluate(() => ({ play: document.getElementById('sh-play').textContent, chips: document.getElementById('sh-chips').textContent })) : null;
  const rec = { label, id: sp.id, forced: sp.forced, tier: sp.tier, cost, win, winMeter: num(g.win), balShown: num(g.bal), serverBal: after.wallet[purse], delta: dS, expect: win - cost, otherDelta: dO };
  if (shell) { rec.shellPlay = shell.play; rec.shellChips = shell.chips; }
  R.rounds.push(rec); R.checks.push(rec);
  if (num(g.win) !== win) fail('WIN meter != totalWin', rec);
  if (dS !== win - cost) fail('wallet delta != win - cost', rec);
  if (dO !== 0) fail('other purse moved', rec);
  if (num(g.bal) !== after.wallet[purse]) fail('game balance != server wallet', rec);
  if (shell) { const sv = cur === 'play' ? num(shell.play.match(/\$[\d,]+\.\d\d/)[0]) : parseInt(shell.chips.replace(/[^0-9]/g, ''), 10); if (sv !== after.wallet[purse]) fail('shell wallet != server wallet', { ...rec, shell }); }
  if (g.mis.length > (verify.seenMis || 0)) { verify.seenMis = g.mis.length; fail('game self-check mismatch', { label, mis: g.mis.slice(-3) }); fs.writeFileSync(`${OUT}/script-${TAG}-${sp.id}.json`, JSON.stringify(await G((i) => window.__spins[i], before))); }
  if (g.nOv) fail('leftover overlay nodes', { label, n: g.nOv }); if (g.busy) fail('still busy', { label });
  return rec;
}
// one real click on the spin button, then wait + verify
async function spin(label, o = {}) {
  const before = (await stState()).spins; await mclick('#spin'); const s = await waitRound(before, label, o); if (s.spins <= before) return null; return verify(label, before);
}
async function forced(f, label) { await page.evaluate((f) => { window.__qaForce = f; }, f); return spin(label || 'force:' + f); }
async function buy(id, label) {
  const before = (await stState()).spins;
  await mclick('#buy'); await sleep(500); await mclick('#buy_' + id); await sleep(500); await mclick('#buy_confirm');
  const s = await waitRound(before, label || 'buy:' + id); if (s.spins <= before) { fail('buy did not run', { id }); return null; } return verify(label || 'buy:' + id, before);
}
const turbo = async (on) => { const cur = await G(() => CC.core.st.turbo); if (!!cur !== on) { await mclick('#turbo'); await sleep(200); } };

// ---- fast-click tests
async function fastClicks() {
  const T = [];
  // 1. real double click on an idle button
  let s0 = await stState(); let w0 = lastSrv.wallet[cur];
  { const bx = await bb('#spin'); await page.mouse.dblclick(bx.x + bx.width / 2, bx.y + bx.height / 2); }
  let s = await waitRound(s0.spins, 'dbl'); await sleep(300); let s1 = await stState();
  T.push({ t: 'double click (clickCount 2)', started: s1.started - s0.started, results: s1.spins - s0.spins }); if (s1.spins - s0.spins !== 1) fail('double click made ' + (s1.spins - s0.spins) + ' rounds', {});
  await verify('dbl', s0.spins);
  // 2. rapid triple click, 20 ms apart, three separate mouse clicks
  s0 = await stState(); const b = await bb('#spin');
  for (let i = 0; i < 3; i++) { await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); await sleep(20); }
  s = await waitRound(s0.spins, 'triple'); await sleep(300); s1 = await stState();
  T.push({ t: 'triple click 20 ms apart', started: s1.started - s0.started, results: s1.spins - s0.spins }); if (s1.spins - s0.spins !== 1) fail('triple click made ' + (s1.spins - s0.spins) + ' rounds', {});
  await verify('triple', s0.spins);
  // 3. click during a cascade (forced phone round: several cascade steps + the call)
  s0 = await stState(); await page.evaluate(() => { window.__qaForce = 'phone'; }); await mclick('#spin');
  const t0 = Date.now(); let hit = false; while (Date.now() - t0 < 25000) { hit = await G(() => !!document.querySelector('.cell.hit, .rv')); if (hit) break; await sleep(60); }
  for (let i = 0; i < 4; i++) { await mclick('#spin'); await sleep(120); }
  s = await waitRound(s0.spins, 'during-cascade'); await sleep(300); s1 = await stState();
  T.push({ t: 'clicks during a cascade (4 real clicks)', sawCascade: hit, started: s1.started - s0.started, results: s1.spins - s0.spins }); if (s1.spins - s0.spins !== 1) fail('clicks during cascade made ' + (s1.spins - s0.spins) + ' rounds', {});
  await verify('during-cascade', s0.spins);
  // 4. click during a bonus (free spins), normal speed
  s0 = await stState(); await page.evaluate(() => { window.__qaForce = 'bonus1'; }); await mclick('#spin');
  const t1 = Date.now(); let inb = false; let lt = 0; while (Date.now() - t1 < 90000) { inb = await G(() => !document.getElementById('bh').hidden); if (inb) break; if (Date.now() - lt > 1500) { lt = Date.now(); await tapper(); } await sleep(150); }
  for (let i = 0; i < 5; i++) { await mclick('#spin'); await sleep(900); }
  s = await waitRound(s0.spins, 'during-bonus', { limit: 400000 }); await sleep(300); s1 = await stState();
  T.push({ t: 'clicks during bonus free spins (5 real clicks)', sawBonus: inb, started: s1.started - s0.started, results: s1.spins - s0.spins }); if (s1.spins - s0.spins !== 1) fail('clicks during bonus made ' + (s1.spins - s0.spins) + ' rounds', {});
  await verify('during-bonus', s0.spins);
  R.fast = T;
}

(async () => {
  const t0 = Date.now();
  try {
    await setup(); console.log(TAG, 'ready', JSON.stringify({ bet: R.bet, start: R.start, dock: R.dock }));
    await turbo(false);
    await fastClicks();
    await turbo(true);
    const n = quick ? 2 : 16; for (let i = 0; i < n; i++) await spin('spin ' + (i + 1));
    for (const f of ['bonus1', 'bonus2', 'bonus3', 'phone', 'close', 'big', 'tease']) { await forced(f); if (f === 'bonus2' || f === 'bonus3') await spin('plain after ' + f); }
    for (const id of ['call', 'bonus1', 'bonus2', 'hunt']) await buy(id);
    // the WIN meter vs the bonus HUD total / big-win amount, 100 ms samples
    const samp = await G(() => window.__samp); let bhN = 0, bhEq = 0, maxRun = 0, run = 0, runStart = 0, bigN = 0, bigEq = 0; const lbls = {};
    samp.forEach(([t, busy, win, bh, big, lbl]) => { if (bh != null) { bhN++; lbls[lbl] = (lbls[lbl] || 0) + 1; if (bh === win) { bhEq++; run = 0; } else { if (!run) runStart = t; run = t - runStart + 100; if (run > maxRun) maxRun = run; } } if (big != null) { bigN++; if (big === win) bigEq++; } });
    R.hud = { samples: samp.length, bonusHudSamples: bhN, equalToWin: bhEq, longestDisagreeMs: maxRun, labels: lbls, bigWinSamples: bigN, bigEqualToWin: bigEq };
    if (maxRun > 700) fail('bonus HUD total disagrees with WIN for ' + maxRun + ' ms', R.hud);
    const fin = await stState(); R.final = { ...fin, rounds: R.rounds.length, secs: Math.round((Date.now() - t0) / 1000) };
    if (fin.mis) fail('final mismatch count', { n: fin.mis });
  } catch (e) { fail('harness exception', { e: String(e && e.stack || e) }); }
  finally { R.logs = (R.logs || []).filter((l) => !/404/.test(l)); const br = R.browser; delete R.browser; fs.writeFileSync(`${OUT}/${TAG}.json`, JSON.stringify(R, null, 1)); console.log(JSON.stringify({ tag: TAG, rounds: R.rounds.length, fails: R.fails.length, fast: R.fast, hud: R.hud, logs: R.logs.slice(0, 5), secs: Math.round((Date.now() - t0) / 1000) })); if (br) await br.close(); }
})();
