// small checks: buy menu with a missing price, max-win message (UI path only: a real round with capped:true set on the result), pace at normal speed
const F = require('./freeze'); const { launch, ready, shot, sleep } = F;
(async () => {
  const b = await launch(); const { page, logs } = b; const out = {}; const mark = (m) => console.log(new Date().toISOString().slice(11, 19), m);
  try {
    mark('start');
    // 1. buy menu: only buys the server state prices are shown
    await ready(page, '?nosplash'); await page.evaluate(() => { CC.core.st.live = true; CC.core.st.server = { buyCostX: { call: 4.9, bonus1: 55.3 } }; CC.core.money.wallet.play = 100000; CC.core.st.betIdx = 3; });
    await page.evaluate(() => document.getElementById('buy').click()); await sleep(500);
    out.buyPartial = await page.evaluate(() => [...document.querySelectorAll('.buyopt')].map((e) => e.dataset.buy + ' ' + e.querySelector('em').textContent));
    await page.evaluate(() => document.querySelector('.scrim [data-v=x]').click()); await sleep(300);
    await page.evaluate(() => { CC.core.st.server = { buyCostX: {} }; CC.core.st.betIdx = 3; }); await page.evaluate(() => { document.getElementById('buy').click(); }); await sleep(300);
    out.buyNone = await page.evaluate(() => ({ opts: document.querySelectorAll('.buyopt').length, modal: CC.core.st.modal, disabled: document.getElementById('buy').disabled }));
    mark('buy checks done');
    // 2. max win message
    await ready(page, '?nosplash');
    await page.evaluate(() => { const E = ColdCallEngine; CC.core.T.spin = (b) => { const r = E.resolveRound(E.rngFrom(12345), null, { force: 'phone' }); return Promise.resolve({ roundId: 'cap', script: Object.assign(r.script, { capped: true }), costTenths: r.costTenths, totalWinTenths: r.winTenths, totalWinMult: r.winX, cost: E.cents(r.costTenths, b), totalWin: E.cents(r.winTenths, b), tier: r.tier, maxed: true }); }; });
    const ok = await F.chase(page, { cond: `() => { const s = document.querySelector('.stamp'); return !!s && /MAX WIN/.test(s.textContent); }`, delay: 450, tries: 1 }); out.maxWinStamp = ok;
    if (ok) await shot(page, 'max_win'); await F.thaw(page); await F.finish(page);
    mark('max win round finished');
    out.maxMismatch = await page.evaluate(() => CC.dbg.mismatch);
    mark('pace start');
    // 3. pace at normal speed (this box is loaded, so these are upper bounds): ms from SPIN to idle for dead spins, and for the first cascade step
    await ready(page, '?nosplash'); const times = [];
    for (let i = 0; i < 14; i++) {
      const t = await page.evaluate(() => new Promise((res) => { const t0 = performance.now(); CC.core.st.turbo = false; document.getElementById('spin').click(); const iv = setInterval(() => { if (!CC.core.st.busy) { clearInterval(iv); const r = CC.dbg.rounds[CC.dbg.rounds.length - 1]; res({ ms: Math.round(performance.now() - t0), win: r.win, bonus: r.bonus, phone: r.phone }); } }, 20); }));
      times.push(t); await sleep(250);
    }
    out.dead = times.filter((t) => t.win === 0).map((t) => t.ms); out.wins = times.filter((t) => t.win > 0).map((t) => t.ms + ':' + t.win);
  } finally { console.log(logs.filter((l) => !/404/.test(l)).join('\n')); console.log(JSON.stringify(out)); await b.browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
