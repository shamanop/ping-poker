// builder B: CC.pull against the REAL 4640 server (real transport by builder A). node live.js [force] [take|bank] [mode]
// Spins with ?force=<force> until a PICK / ONE MORE CALL prompt shows (my selectors), screenshots it, taps, finishes the round, then checks for leftovers.
const { launch } = require('../capture/qalib'); const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FORCE = process.argv[2] || 'bonus1', TAKE = process.argv[3] || 'take', MODE = process.argv[4] || 'play', OUT = __dirname;
(async () => {
  const { browser, page, logs } = await launch(540, 960);
  await page.goto(`http://127.0.0.1:4640/games/coldcall/index.html?live=1&nosplash&name=plb${MODE}&pin=1234`);
  await page.waitForFunction(() => window.CC && CC.ready && CC.core.st.live, null, { timeout: 30000 });
  if (MODE === 'chips') { await page.click('#modebar button[data-m=chips]'); await sleep(300); }
  await sleep(800); await page.screenshot({ path: `${OUT}/live_idle.png` });
  const seen = []; let shots = 0;
  const t0 = Date.now(); let rounds = 0, started = false;
  while (Date.now() - t0 < 170000) {
    if (!started) { await page.click('#buy'); await page.click('#buy_' + FORCE); await page.click('#buy_confirm'); started = true; rounds++; await sleep(600); }
    const st = await page.evaluate(() => ({ busy: CC.core.st.busy, pick: !!document.querySelector('.slots i.pick'), more: !!document.getElementById('pl_more'), dial: !!document.querySelector('.dial') }));
    if (process.env.TRACE) console.log(((Date.now() - t0) / 1000).toFixed(1), JSON.stringify(st));
    if (st.dial) await page.locator('.dial').click({ timeout: 1500 }).catch(() => {});
    if (st.pick) { seen.push('pick'); await sleep(500); await page.screenshot({ path: `${OUT}/live_pick.png` }); await page.locator('.slots i.pick').first().click({ force: true }); await sleep(800); }
    else if (st.more) { seen.push('more'); await sleep(500); await page.screenshot({ path: `${OUT}/live_more.png` }); await page.click(TAKE === 'take' ? '#pl_more' : '#pl_bank'); await sleep(900); await page.screenshot({ path: `${OUT}/live_after_more.png` }); }
    else if (!st.busy && started) { if (seen.length >= 2 || rounds >= 14) break; started = false; }
    await sleep(200);
  }
  await sleep(1500);
  const res = await page.evaluate(() => ({ mismatch: CC.dbg.mismatch, pullErr: CC.dbg.pull, rounds: CC.dbg.rounds.map((r) => ({ id: r.id, bonus: r.bonus, decisions: r.decisions, more: r.more, win: r.win })), left: ['plmo', 'plpot'].filter((i) => document.getElementById(i)).concat(document.querySelector('.dec2') ? ['dec2'] : [], document.querySelector('#ribbon.ask') ? ['ribbon.ask'] : [], document.querySelector('#hud.dec') ? ['hud.dec'] : [], document.querySelector('#head > .stamp') ? ['head.stamp'] : []), busy: CC.core.st.busy, win: document.getElementById('win').textContent }));
  console.log(JSON.stringify({ force: FORCE, take: TAKE, mode: MODE, seen, ...res, logs: logs.filter((l) => !/404/.test(l)) }, null, 1));
  await page.screenshot({ path: `${OUT}/live_end.png` }); await browser.close();
})();
