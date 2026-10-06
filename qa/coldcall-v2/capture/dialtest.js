// the intro dial with a real mouse: one round by TAP, one by DRAG; it must land on the script's bonus and spins either way
const { launch, ready, sleep } = require('./lib');
(async () => {
  const b = await launch(); const { page, logs } = b; const out = [];
  try {
    for (const force of ['bonus1', 'bonus2', 'bonus3']) {
      for (const how of ['tap', 'drag']) {
        if (force === 'bonus2' && how === 'drag') continue; if (force === 'bonus3' && how === 'tap') continue;
        await ready(page, '?nosplash&force=' + force); await page.evaluate(() => { CC.core.st.turbo = true; document.getElementById('spin').click(); });
        await page.waitForSelector('.dial', { timeout: 120000 }); await sleep(600);
        const bb = await (await page.$('.dial')).boundingBox(); const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
        if (how === 'tap') { await page.mouse.click(cx + 90, cy - 30); }
        else { // grab the plate near the "1" hole side and sweep clockwise through a quarter turn
          const a0 = -Math.PI / 4, r = 100; await page.mouse.move(cx + r * Math.cos(a0), cy + r * Math.sin(a0)); await page.mouse.down();
          for (let i = 1; i <= 24; i++) { const a = a0 + (i / 24) * (Math.PI * 0.9); await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a)); await sleep(30); } await page.mouse.up(); }
        await page.waitForFunction(() => document.querySelector('#chS b') && document.querySelector('#chS b').textContent !== '-', null, { timeout: 60000 });
        const r = await page.evaluate(() => ({ name: document.querySelector('#chN b').textContent, spins: document.querySelector('#chS b').textContent, kind: CC.dbg.rounds[CC.dbg.rounds.length - 1].bonus, cfg: ColdCallEngine.CFG.spins }));
        out.push({ force, how, shown: r.name + ' / ' + r.spins, script: r.kind, startSpins: r.cfg[r.kind] }); await sleep(300);
        await page.waitForFunction(() => !document.querySelector('.dial') || true); await page.evaluate(() => { CC.core.st.auto = true; }); await page.waitForFunction(() => !CC.core.st.busy, null, { timeout: 600000 }); await page.evaluate(() => { CC.core.st.auto = false; });
      }
    }
  } finally { console.log(logs.filter((l) => !/404/.test(l)).join('\n')); console.log(JSON.stringify(out, null, 1)); console.log(JSON.stringify(await page.evaluate(() => CC.dbg.mismatch))); await b.browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
