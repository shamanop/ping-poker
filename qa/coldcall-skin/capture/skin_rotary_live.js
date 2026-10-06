const { launch, url, shot, sleep } = require('./skin_lib');
(async () => {
  const b = await launch(); const { page, logs } = b;
  try {
    await page.goto(url('&name=qa3&pin=4321&nosplash&force=rotary')); await page.waitForFunction(() => window.CC && CC.ready && CC.core.st.live, null, { timeout: 15000 });
    await page.evaluate(() => { window.__s = []; setInterval(() => { const w = document.getElementById('win'); window.__s.push([CC.dbg.started, w.textContent]); }, 100); });
    const attemptShots = {}; let shotWin = false, shotEnd = false, server = null, stop1 = null, stop2 = null; const rounds = [];
    for (let attempt = 0; attempt < 6 && !shotEnd; attempt++) {
    await page.click('#spin');
    await page.waitForSelector('.dial', { timeout: 30000 }); await sleep(600); if (!attemptShots.dial) { await shot(page, 'rotary_dial'); attemptShots.dial = 1; }
    const box = await page.locator('.dial').boundingBox(); const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx - 80, cy + 10); await page.mouse.down(); for (let a = 0; a <= 120; a += 10) { const th = (200 + a) * Math.PI / 180; await page.mouse.move(cx + 80 * Math.cos(th), cy + 80 * Math.sin(th)); await sleep(30); }
    if (!attemptShots.drag) { await shot(page, 'rotary_dial_dragging'); attemptShots.drag = 1; } await page.mouse.up();
    await page.waitForFunction(() => document.querySelector('#chS.set'), null, { timeout: 15000 }); await sleep(300);
        stop1 = await page.evaluate(() => document.querySelector('#chS b').textContent);
    await page.waitForFunction(() => document.querySelector('#rSub').textContent.includes('multiplier'), null, { timeout: 8000 }); await sleep(500);
    if (!attemptShots.mult) { await shot(page, 'rotary_dial_multiplier'); attemptShots.mult = 1; }
    await page.locator('.dial').click();
    await page.waitForFunction(() => document.querySelector('#chM.set'), null, { timeout: 15000 });
    stop2 = await page.evaluate(() => document.querySelector('#chM b').textContent);
    await page.waitForFunction(() => document.querySelector('#stage.bonus'), null, { timeout: 15000 });
    await sleep(1200); if (!attemptShots.fs) { await shot(page, 'rotary_freespins'); attemptShots.fs = 1; }
    
    for (let i = 0; i < 600; i++) {
      const s = await page.evaluate(() => ({ hit: document.querySelectorAll('.cell.hit').length, end: [...document.querySelectorAll('.scn .chip small')].some((x) => x.textContent === 'TOTAL WIN'), tier: !!document.querySelector('#tier'), busy: CC.core.st.busy }));
      if (s.hit && !shotWin) { await sleep(500); await shot(page, 'rotary_freespins_win'); shotWin = true; }
      if (s.end && !shotEnd) { await sleep(500); await shot(page, 'rotary_complete'); shotEnd = true; }
      if (s.end || s.tier) await page.mouse.click(270, 400);
      if (!s.busy && i > 20) break; await sleep(150);
    }
    server = await page.evaluate(() => CC.dbg.rounds.slice(-1)[0]); rounds.push(server);
    }
    await sleep(500); await shot(page, 'rotary_after');
    const res = await page.evaluate(() => ({ s: window.__s, dbg: { mm: CC.dbg.mismatch, err: CC.dbg.error, r: CC.dbg.rounds }, win: document.getElementById('win').textContent, raf: { max: __raf.max, srcs: __raf.srcs }, left: [...document.querySelectorAll('#ov > *, .fly, .banner, .float, .stamp, .toast, #scene > *')].length }));
    let dec = 0, blank = 0; const last = {}; for (const [r, t] of res.s) { if (!t || !/\d/.test(t)) blank++; const v = Math.round(parseFloat(t.replace(/[$,]/g, '')) * 100); if (last[r] != null && v < last[r]) dec++; last[r] = v; }
    // the server's dial values vs what the dial showed
    console.log(JSON.stringify({ rounds, shown: { stop1, stop2 }, shotWin, shotEnd, samples: res.s.length, blank, decreasesWithinRound: dec, final: res.win, dbg: res.dbg, raf: res.raf, leftoverNodes: res.left }));
  } finally { console.log(logs.filter((l) => !/404/.test(l)).join('\n')); await b.browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
