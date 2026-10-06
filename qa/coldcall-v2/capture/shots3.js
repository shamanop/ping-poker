// modals, big win, 10c bubbles. node shots3.js [names...]
const F = require('./freeze'); const { launch, ready, shot, sleep } = F;
const only = process.argv.slice(2), want = (n) => !only.length || only.includes(n);
(async () => {
  const b = await launch(); const { page, logs } = b;
  try {
    if (want('buy_menu')) { await ready(page, '?nosplash&shot=buy'); await sleep(900); await shot(page, 'buy_menu'); await ready(page, '?nosplash&shot=buy&step=confirm'); await sleep(900); await shot(page, 'buy_confirm'); }
    if (want('info_modal')) { await ready(page, '?nosplash&shot=info'); await sleep(900); await shot(page, 'info_modal'); await page.evaluate(() => { const c = document.querySelector('.card.info'); c.scrollTop = c.scrollHeight; }); await sleep(300); await shot(page, 'info_modal_pay'); }
    if (want('bubbles_10c')) {
      await ready(page, '?nosplash&force=phone'); await page.evaluate(() => { CC.core.st.betIdx = 0; document.getElementById('bet').textContent = CC.core.dollars(10); });
      const ok = await F.chase(page, { cond: `() => document.querySelectorAll('.rv.b').length >= 6`, delay: 520, tries: 4 }); console.log('bubbles_10c', ok); if (ok) await shot(page, 'bubbles_10c'); await F.thaw(page); await F.finish(page);
    }
    if (want('bigwin')) {
      await ready(page, '?nosplash&force=big');
      const ok = await F.chase(page, { cond: `() => { const a = document.querySelector('#tier .amt'); return !!a; }`, delay: 3800, tries: 3 }); console.log('bigwin', ok);
      if (ok) await shot(page, 'bigwin_overlay'); await F.thaw(page);
      await page.evaluate(() => { CC.core.st.tap++; }); await page.waitForFunction(() => !document.getElementById('tier') && !CC.core.st.busy, null, { timeout: 120000 }); await sleep(600); await shot(page, 'bigwin_closed');
    }
  } finally { console.log(logs.filter((l) => !/404/.test(l)).join('\n')); console.log(JSON.stringify(await page.evaluate(() => ({ mis: CC.dbg.mismatch, err: CC.dbg.error })))); await b.browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
