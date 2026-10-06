// base-game and phone shots (practice engine, one browser). node shots1.js [names...]
const F = require('./freeze'); const { launch, ready, shot, sleep } = F; const fs = require('fs');
const only = process.argv.slice(2), want = (n) => !only.length || only.includes(n);
const Q = (s) => `document.querySelectorAll('${s}').length`;
(async () => {
  const b = await launch(); const { page, logs } = b;
  const go = async (name, qs, opts) => {
    if (!want(name)) return; await ready(page, '?nosplash' + qs); await sleep(400);
    const ok = await F.chase(page, opts); console.log(name, ok ? 'frozen' : 'NOT FOUND');
    if (ok) await shot(page, name); await F.thaw(page);
    await page.waitForFunction(() => !CC.core.st.busy, null, { timeout: 240000 }).catch(() => {});
  };
  try {
    await go('cascade_win', '', { cond: `() => document.querySelectorAll('.cell.hit').length >= 5`, delay: 120, tries: 20 });
    await go('sweep', '&force=phone', { cond: `() => document.querySelectorAll('.cell.sweep').length >= 2`, delay: 60, tries: 12 });
    await go('hot_leads', '&force=phone', { cond: `() => !!document.querySelector('.stamp') && /CALL CONNECTED/.test(document.querySelector('.stamp').textContent)`, delay: 350, tries: 4 });
    await go('phone_reveal', '&force=phone', { cond: `() => document.querySelectorAll('.rv.b').length >= 4 && document.querySelectorAll('.rv.u').length >= 1`, delay: 520, tries: 8 });
    await go('upsell', '&force=phone', { cond: `() => document.querySelectorAll('.zap').length >= 1`, delay: 140, tries: 10 });
    await go('close_collect', '&force=close', { cond: `() => document.querySelectorAll('.fchip').length >= 3`, delay: 150, tries: 6 });
    await go('payment_accepted', '&force=close', { cond: `() => !!document.querySelector('.accept')`, delay: 380, tries: 6 });
    await go('second_round', '&force=close', { cond: `() => { if (document.querySelector('.accept')) window.__sawAcc = 1; return window.__sawAcc && !document.querySelector('.accept') && document.querySelectorAll('.rv.b').length >= 2 && document.querySelector('.rv.c.done'); }`, delay: 380, tries: 6 });
    await go('tease', '&force=tease', { cond: `() => document.querySelectorAll('.cell.pulse').length >= 2`, delay: 350, tries: 4 });
  } finally { console.log(logs.filter((l) => !/404/.test(l)).join('\n')); console.log(JSON.stringify(await page.evaluate(() => CC.dbg.mismatch))); await b.browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
