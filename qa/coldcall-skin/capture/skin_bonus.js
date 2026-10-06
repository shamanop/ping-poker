const { launch, base, shot, sleep } = require('./skin_lib');
const which = process.argv[2] || 'rotary';
(async () => {
  const b = await launch(); const { page, logs } = b;
  try {
    if (which === 'rotary') {
      await page.goto(base + '?force=rotary&shot=spin'); const got = {}; const t0 = Date.now();
      await page.waitForFunction(() => window.CC && CC.ready);
      while (Date.now() - t0 < 90000) {
        const s = await page.evaluate(() => ({ dial: !!document.querySelector('.dial'), chips: [...document.querySelectorAll('.chip.set')].length, rib: document.getElementById('ribL').textContent, hits: document.querySelectorAll('.cell.hit').length, end: [...document.querySelectorAll('.scn .chip small')].some((x) => x.textContent === 'TOTAL WIN'), busy: CC.core.st.busy, stamp: !!document.querySelector('.stamp'), mood: CC.hero.cur() }));
        if (s.stamp && !got.trig) { await sleep(400); await shot(page, 'rotary_trigger'); got.trig = s.mood; }
        if (s.dial && !got.dial) { await sleep(500); await shot(page, 'rotary_dial'); got.dial = 1; }
        if (s.dial && got.dial) await page.evaluate(() => { const d = document.querySelector('.dial'); if (d && d._finish && !window.__fin1) { window.__fin1 = 1; d._finish(); } });
        if (s.dial && s.chips === 1 && !got.second) { await sleep(900); await shot(page, 'rotary_dial_mult'); got.second = 1; await page.evaluate(() => { const d = document.querySelector('.dial'); if (d && d._finish) d._finish(); }); }
        if (s.dial && s.chips === 1 && got.second) await page.evaluate(() => { const d = document.querySelector('.dial'); if (d && d._finish) d._finish(); });
        if (/FREE SPIN/.test(s.rib) && s.hits && !got.free) { await sleep(450); await shot(page, 'rotary_freespins'); got.free = 1; }
        if (s.end && !got.end) { await sleep(500); await shot(page, 'rotary_complete'); got.end = s.mood; await page.mouse.click(270, 400); }
        if (s.end || await page.evaluate(() => !!document.querySelector('#tier'))) await page.mouse.click(270, 400);
        if (!s.busy && Date.now() - t0 > 4000) break; await sleep(120);
      }
      console.log('rotary', JSON.stringify(got));
    } else if (which === 'quote') {
      const url = process.argv[3] === 'grand' ? '?shot=quote_grand' : '?force=quote&shot=spin'; const tag = process.argv[3] === 'grand' ? 'quote_g' : 'quote';
      await page.goto(base + url); const got = {}; const t0 = Date.now();
      await page.waitForFunction(() => window.CC && CC.ready);
      while (Date.now() - t0 < 100000) {
        const s = await page.evaluate(() => ({ amt: document.querySelectorAll('.cell .amt').length, full: document.querySelectorAll('.fbox.full').length, spin: document.querySelectorAll('.fbox.spinning').length, done: document.querySelectorAll('.frow.done').length, banner: !!document.querySelector('.banner'), end: [...document.querySelectorAll('.scn .chip small')].some((x) => x.textContent === 'TOTAL WIN'), tier: !!document.querySelector('#tier'), busy: CC.core.st.busy, mood: CC.hero.cur() }));
        if (s.amt && !got.trigger) { await sleep(700); await shot(page, tag + '_trigger'); got.trigger = s.mood; }
        if (s.full >= 5 && !got.fill) { await sleep(100); await shot(page, tag + '_midfill'); got.fill = 1; }
        if (s.done && !got.field) { await sleep(450); await shot(page, tag + '_field_prize'); got.field = 1; }
        if (s.banner && !got.banner) { await sleep(900); await shot(page, tag + '_payment_accepted'); got.banner = 1; }
        if (s.end && !got.end) { await sleep(500); await shot(page, tag + '_complete'); got.end = s.mood; }
        if (s.end || s.tier) await page.mouse.click(270, 400);
        if (!s.busy && Date.now() - t0 > 4000) break; await sleep(120);
      }
      console.log('quote', JSON.stringify(got));
    }
  } finally { console.log(logs.filter((l) => !/404/.test(l)).join('\n')); await b.browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
