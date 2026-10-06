const { launch, shot, sleep, OUT } = require('./lib');
(async () => {
  const b = await launch(1280, 800); const { page, logs } = b; const out = {};
  try {
    await page.goto('http://127.0.0.1:4610/'); await page.waitForFunction(() => window.PingSocket && window.Shell, null, { timeout: 15000 });
    await page.evaluate(() => { PingSocket.once('auth_error', () => PingSocket.emit('auth_signup', { name: 'qashell', pin: '4321', avatar: 'a01' })); PingSocket.emit('auth_login', { name: 'qashell', pin: '4321' }); });
    await page.waitForFunction(() => Shell.isSignedIn(), null, { timeout: 8000 }); await sleep(1200); await page.keyboard.press('Escape'); await sleep(300); if (await page.locator('.pj-modal.open').count()) { await page.evaluate(() => document.querySelector('.pj-modal.open button').click()); await sleep(500); }
    out.dock = await page.evaluate(() => [...document.querySelectorAll('.sh-di')].map((d) => d.dataset.game + (d.disabled ? '(off)' : '')));
    await page.evaluate(() => Shell.openGame('coldcall')); await page.waitForSelector('.sh-win[data-game=coldcall] iframe', { timeout: 8000 });
    const fr = page.frameLocator('.sh-win[data-game=coldcall] iframe');
    await fr.locator('#go').waitFor({ timeout: 10000 }); await page.waitForFunction(() => { const f = document.querySelector('.sh-win[data-game=coldcall] iframe'); return f.contentWindow.CC && f.contentWindow.CC.ready; }, null, { timeout: 15000 });
    await fr.locator('#go').click(); await sleep(900);
    await page.waitForFunction(() => document.querySelector('.sh-win[data-game=coldcall] iframe').contentWindow.CC.core.st.live, null, { timeout: 8000 });
    out.live = await page.evaluate(() => { const c = document.querySelector('.sh-win[data-game=coldcall] iframe').contentWindow.CC.core; return { kind: c.T.kind, bets: c.st.bets, mode: c.st.mode }; });
    const walletBefore = await page.evaluate(() => document.getElementById('sh-play').textContent);
    for (let i = 0; i < 2; i++) { await fr.locator('#spin').click(); await page.waitForFunction(() => !document.querySelector('.sh-win[data-game=coldcall] iframe').contentWindow.CC.core.st.busy, null, { timeout: 40000 }); }
    await sleep(1300); out.wallet = { before: walletBefore, after: await page.evaluate(() => document.getElementById('sh-play').textContent), game: await fr.locator('#bal').textContent() };
    
    // docked narrow
    await page.evaluate(() => { const g = Shell.state().games.coldcall; g.w = 360 / 1280; Shell.dock('coldcall', 'right'); Shell.layout(); }); await sleep(900);
    out.docked = await page.evaluate(() => { const w = document.querySelector('.sh-win[data-game=coldcall]'); return { w: w.offsetWidth, h: w.offsetHeight, cls: w.className }; });
    const bb = await page.evaluate(() => { const r = document.querySelector('.sh-win[data-game=coldcall]').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }); out.bb = bb; await page.screenshot({ path: require('./lib').OUT + '/docked_360.jpg', type: 'jpeg', quality: 74, clip: bb });
    out.errors = await page.evaluate(() => { const c = document.querySelector('.sh-win[data-game=coldcall] iframe').contentWindow.CC; return { mm: c.dbg.mismatch, err: c.dbg.error }; });
    console.log(JSON.stringify(out));
  } finally { console.log(logs.filter((l) => !/404/.test(l)).join('\n')); await b.browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
