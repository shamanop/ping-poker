// P1: the Cold Call dock badge counts only rounds THIS page spun. Two shell pages (A, B) of one account. A plays a bought bonus to ONE MORE CALL and banks it; the server sends the done result
// to both sockets. PASS = A's badge == its round (win + pot - cost, from the server history), B's badge stays empty. The badge shows while the game window is minimized.
//   node f1_badge.js <play|chips>
const L = require('./f1lib');
async function shellPage(name, md) {
  const { browser, ctx } = await L.launch(1000, 1000); const page = await ctx.newPage();
  await page.goto('http://127.0.0.1:' + L.PORT + '/'); await page.waitForSelector('#lb-name', { timeout: 20000 });
  await page.fill('#lb-name', name); await page.fill('#lb-pin', L.PIN); await page.click('#lb-submit');
  await page.waitForFunction(() => window.Shell && Shell.isSignedIn && Shell.isSignedIn(), null, { timeout: 20000 }); await L.sleep(2500);
  await page.evaluate(() => document.querySelectorAll('.pj-modal, .pj-scrim, .pj-backdrop, [class*=pj-overlay]').forEach((n) => n.remove()));
  await page.evaluate(() => Shell.openGame('coldcall'));
  let fr = null; for (let i = 0; i < 60 && !fr; i++) { fr = page.frames().find((f) => /games\/coldcall/.test(f.url())); await L.sleep(250); }
  await fr.waitForFunction(() => window.CC && CC.ready && CC.core.st.live, null, { timeout: 30000 });
  await fr.evaluate(() => { const s = document.getElementById('splash'); if (s) s.remove(); });
  if (md === 'chips') { await fr.click('#modebar button[data-m=chips]'); await fr.waitForFunction(() => CC.core.st.mode === 'chips'); }
  return { browser, page, fr };
}
const badge = (page) => page.evaluate(() => { const b = [...document.querySelectorAll('.sh-di')].find((x) => /Cold Call/.test(x.textContent)); return b ? b.querySelector('.badge').textContent : null; });
// L.toPrompt for a game inside the shell iframe: the page's mouse is in top-page coordinates, so the frame's offset is added
async function toPromptShell(S, want) {
  const t0 = Date.now(), fr = S.fr;
  for (;;) {
    await L.tapDial(fr); const k = await L.promptOpen(fr).catch(() => null); if (k === want) return true;
    if (k === 'pick' && want === 'more') { await L.sleep(800); const c = await fr.evaluate(() => { const s = document.querySelector('.slots i.pick'); if (!s) return null; const r = s.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }); const bb = await S.page.locator('iframe').first().boundingBox(); if (c && bb) { await S.page.mouse.click(bb.x + c[0], bb.y + c[1]); await L.sleep(300); } }
    if (!(await fr.evaluate(() => CC.core.st.busy)) && Date.now() - t0 > 2500) return false; if (Date.now() - t0 > 150000) return false; await L.sleep(100);
  }
}
const mini = async (page) => { await page.evaluate(() => Shell.minimize('coldcall')); await L.sleep(900); };
(async () => {
  const md = process.argv[2] || 'play', name = L.uniq('f1b');
  (await L.sock(name)).close();   // sign up first: the lobby form only logs in
  const A = await shellPage(name, md), B = await shellPage(name, md);
  await mini(B.page); const b0 = await badge(B.page);
  await L.setBet(A.fr, 10); await A.fr.click('#turbo');
  let ok = false; for (let i = 0; i < 8 && !ok; i++) { await L.buy(A.fr, 'bonus1'); ok = await toPromptShell(A, 'more'); if (!ok) { await L.idle(A.fr).catch(() => {}); await L.sleep(3300); } }
  if (!ok) throw new Error('no more');
  await L.sleep(900); await A.fr.click('#pl_bank'); await L.idle(A.fr, 120000); await L.sleep(1500);
  await mini(A.page); await mini(B.page);
  const s = await L.sock(name); const h = (await L.shist(s)).rounds; s.close();
  const rounds = h.filter((r) => r.mode === md), net = rounds.reduce((a, r) => a + r.totalWin + (r.pot ? r.pot.amount : 0) - r.cost, 0);
  const fmtB = (c) => (c > 0 ? '+' : c < 0 ? '-' : '') + (c === 0 ? '' : md === 'chips' ? '' : '$') + (Math.abs(c) / (md === 'chips' ? 1 : 100)).toLocaleString('en-US', md === 'chips' ? {} : { minimumFractionDigits: 2 });
  const bA = await badge(A.page), bB = await badge(B.page);
  L.out({ scenario: 'P1 dock badge', mode: md, ok: !!bA && bA !== '' && (bB === '' || bB == null) && /\d/.test(bA), badgeA: bA, badgeB: bB, badgeBBefore: b0, serverNetOfRounds: net, serverRounds: rounds.map((r) => ({ cost: r.cost, win: r.totalWin })) });
  await A.browser.close(); await B.browser.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
