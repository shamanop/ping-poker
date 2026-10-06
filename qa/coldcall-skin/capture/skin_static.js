const { launch, base, shot, sleep } = require('./skin_lib');
const only = process.argv.slice(2);
(async () => {
  const b = await launch(); const { page, logs } = b;
  const ready = async (u) => { await page.goto(base + u); await page.waitForFunction(() => window.CC && CC.ready, null, { timeout: 15000 }); };
  const want = (n) => !only.length || only.includes(n);
  try {
    if (want('splash')) { await ready('?shot=splash'); await sleep(900); await shot(page, 'splash'); }
    if (want('idle')) { await ready('?shot=idle'); await sleep(900); await shot(page, 'idle'); }
    for (const m of ['hype', 'shock', 'rage', 'win']) if (want(m)) { await ready('?shot=' + m); await sleep(700); await shot(page, { hype: 'win', shock: 'near_miss', rage: 'rage', win: 'mood_win' }[m]); }
    if (want('bigwin')) { await ready('?shot=bigwin'); await sleep(6500); await shot(page, 'bigwin_overlay'); await page.mouse.click(270, 400); await sleep(2800); await shot(page, 'bigwin_closed'); }
    if (want('buy')) { await ready('?shot=buy'); await sleep(900); await shot(page, 'buy_confirm'); }
    if (want('info')) { await ready('?shot=info'); await sleep(900); await shot(page, 'info_modal'); }
    console.log('done');
  } finally { console.log(logs.filter((l) => !/404/.test(l)).join('\n')); await b.browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
