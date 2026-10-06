const { launch, url, shot, sleep } = require('./skin_lib');
const mode = process.argv[2] || 'live';
(async () => {
  const b = await launch(); const { page, logs } = b; const tag = mode === 'live' ? 'quote' : 'quoteGrand';
  try {
    if (mode === 'live') await page.goto(url('&name=qa4&pin=4321&nosplash&force=quote'));
    else {   // practice page; the round is built by the REAL engine with respin landing chance 1 so every box fills => PAYMENT ACCEPTED
      await page.goto(`http://127.0.0.1:4610/games/coldcall/index.html?nosplash`); await page.waitForFunction(() => window.CC && CC.ready, null, { timeout: 15000 });
      await page.evaluate(() => { const E = ColdCallEngine, eng = E.createEngine({ ...JSON.parse(JSON.stringify(E.CFG)), landP: 1, upsellP: 0.15 }); E.resolveRound = (rng, buy) => { const r = eng.round(rng, buy, { script: true }); return { round: r, buy: r.buy, costTenths: r.costTenths, winTenths: r.winTenths, winX: r.winX, capped: r.capped, tier: r.tier, script: r.script }; }; });
    }
    await page.waitForFunction(() => window.CC && CC.ready, null, { timeout: 15000 });
    if (mode === 'live') await page.waitForFunction(() => CC.core.st.live, null, { timeout: 8000 });
    await page.evaluate(() => { window.__s = []; setInterval(() => { const w = document.getElementById('win'); window.__s.push([CC.dbg.started, w.textContent]); }, 100); });
    const got = {}; const rounds = [];
    for (let attempt = 0; attempt < (mode === 'live' ? 8 : 1) && !(mode === 'live' && got.field); attempt++) {
      if (mode === 'live') await page.click('#spin'); else await page.evaluate(() => { CC.core.play('quote'); });
      const t0 = Date.now();
      while (Date.now() - t0 < 100000) {
        const s = await page.evaluate(() => ({ amt: document.querySelectorAll('.cell .amt').length, full: document.querySelectorAll('.fbox.full').length, spin: document.querySelectorAll('.fbox.spinning').length, done: document.querySelectorAll('.frow.done').length, banner: !!document.querySelector('.banner'), end: [...document.querySelectorAll('.scn .chip small')].some((x) => x.textContent === 'TOTAL WIN'), tier: !!document.querySelector('#tier'), busy: CC.core.st.busy }));
        if (s.amt && !got.trigger) { await sleep(700); await shot(page, tag + '_trigger'); got.trigger = 1; }
        if (s.full >= 5 && !got.fill) { await sleep(100); await shot(page, tag + '_form_midfill'); got.fill = 1; }
        if (s.spin && s.full >= 6 && !got.respin) { await shot(page, tag + '_respin'); got.respin = 1; }
        if (s.done && !got.field) { await sleep(350); await shot(page, tag + '_field_prize'); got.field = 1; }
        if (s.banner && !got.banner) { await sleep(900); await shot(page, tag + '_payment_accepted'); got.banner = 1; }
        if (s.end && !got.end) { await sleep(400); await shot(page, tag + '_end'); got.end = 1; }
        if (s.end || s.tier) await page.mouse.click(270, 400);
        if (!s.busy && s.full === 0 && Date.now() - t0 > 3000) break; await sleep(120);
      }
      rounds.push(await page.evaluate(() => CC.dbg.rounds.slice(-1)[0]));
    }
    await sleep(500); await shot(page, tag + '_after');
    const res = await page.evaluate(() => ({ s: window.__s, dbg: { mm: CC.dbg.mismatch, err: CC.dbg.error }, raf: { max: __raf.max, srcs: __raf.srcs }, left: [...document.querySelectorAll('#ov > *, .fly, .banner, .float, .stamp, .toast, #scene > *')].length, fxRun: CC.fx.running() }));
    let dec = 0, blank = 0; const last = {}; for (const [r, t] of res.s) { if (!t || !/\d/.test(t)) blank++; const v = Math.round(parseFloat(t.replace(/[$,]/g, '')) * 100); if (last[r] != null && v < last[r]) dec++; last[r] = v; }
    console.log(tag, JSON.stringify({ got, rounds, samples: res.s.length, blank, decreasesWithinRound: dec, dbg: res.dbg, raf: res.raf, leftoverNodes: res.left, fxRunning: res.fxRun }));
  } finally { console.log(logs.filter((l) => !/404/.test(l)).join('\n')); await b.browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
