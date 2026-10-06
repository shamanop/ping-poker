// bonus shots (practice engine, forced bonuses). node shots2.js [names...]
const F = require('./freeze'); const { launch, ready, shot, sleep } = F;
const only = process.argv.slice(2), want = (n) => !only.length || only.includes(n);
const hot = `document.querySelectorAll('.slots i.hot').length`, bh = `!document.getElementById('bh').hidden`, spinN = `+((/SPIN (\\d+)/.exec(document.getElementById('ribR').textContent) || [0, 0])[1])`;
(async () => {
  const b = await launch(); const { page, logs } = b;
  const go = async (name, qs, opts, after) => {
    if (!want(name)) return; await ready(page, '?nosplash' + qs); await sleep(400);
    const ok = await F.chase(page, opts); console.log(name, ok ? 'frozen' : 'NOT FOUND');
    if (ok) { await shot(page, name); if (after) await after(); }
    await F.thaw(page); console.log(' finished', await F.finish(page), JSON.stringify(await page.evaluate(() => CC.dbg.rounds.map((r) => r.tier + ':' + r.win))));
  };
  try {
    await go('bonus_intro_dial', '&force=bonus1', { cond: `() => !!document.querySelector('.dial')`, delay: 450, tries: 3, noPoke: true });
    await go('bonus1_spin', '&force=bonus1', { cond: `() => { return ${bh} && ${hot} >= 3 && ${spinN} >= 2 && !document.querySelector('.rv') && !document.querySelector('.cell.hit') && !document.querySelector('.cell.sweep'); }`, delay: 1400, tries: 3 });
    await go('bonus2_spin', '&force=bonus2', { cond: `() => ${bh} && document.querySelectorAll('.rv.b').length >= 5`, delay: 520, tries: 3 });
    await go('bonus3_spin', '&force=bonus3', { cond: `() => ${bh} && document.querySelectorAll('.rv.b').length >= 3`, delay: 520, tries: 3 });
    await go('spins_added', '&force=bonus2', { cond: `() => { const s = document.querySelector('.stamp'); return !!s && /\\+\\d SPIN/.test(s.textContent); }`, delay: 400, tries: 3 });
    await go('bonus_total', '&force=bonus1', { cond: `() => !!document.querySelector('.fin-hero')`, delay: 700, tries: 6 });
  } finally { console.log(logs.filter((l) => !/404/.test(l)).join('\n')); console.log(JSON.stringify(await page.evaluate(() => ({ mis: CC.dbg.mismatch, err: CC.dbg.error, n: CC.dbg.checked })))); await b.browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
