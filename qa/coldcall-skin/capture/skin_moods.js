// Real practice rounds (local engine): log which hero mood showed during each round and check it against the mood map.
const { launch, base, sleep } = require('./skin_lib');
const N = +process.argv[2] || 70;
(async () => {
  const b = await launch(); const { page, logs } = b;
  try {
    await page.goto(base + '?nosplash'); await page.waitForFunction(() => window.CC && CC.ready);
    await page.evaluate(() => {
      const T = CC.core.T, o = T.spin.bind(T); window.__rounds = []; window.__cur = null;
      T.spin = async (...a) => { const p = await o(...a); const S = p.script, bs = S.base || {}; window.__cur = { n: window.__rounds.length + 1, feat: (S.features || []).map((f) => f.kind), baseWin: bs.winTenths || 0, tease: !!bs.tease, phones: (bs.phones || []).length, total: p.totalWinTenths, tier: p.tier, moods: [] }; window.__rounds.push(window.__cur); return p; };
      new MutationObserver(() => { if (window.__cur) window.__cur.moods.push(document.getElementById('hero').dataset.mood); }).observe(document.getElementById('hero'), { attributes: true, attributeFilter: ['data-mood'] });
      CC.hero.set('idle');
    });
    await page.click('#turbo');
    for (let i = 0; i < N; i++) {
      await page.click('#spin');
      for (let k = 0; k < 900; k++) {
        const s = await page.evaluate(() => { const d = document.querySelector('.dial'); if (d && d._finish) d._finish(); return { busy: CC.core.st.busy, tap: !!document.querySelector('#tier') || [...document.querySelectorAll('.scn .chip small')].some((x) => x.textContent === 'TOTAL WIN') }; });
        if (s.tap) await page.mouse.click(270, 400);
        if (!s.busy && k > 1) break; await sleep(60);
      }
      await sleep(150);
    }
    const out = await page.evaluate(() => window.__rounds); let bad = [];
    const has = (r, m) => r.moods.includes(m);
    let dead = 0;
    for (const r of out) {
      const bonus = r.feat.length > 0, nearMissNoFeat = (r.tease || r.phones === 2) && !bonus;
      if ((r.baseWin > 0 || bonus) && !has(r, 'hype')) bad.push(['no hype on win/bonus', r.n]);
      if (r.baseWin === 0 && !bonus && has(r, 'hype')) bad.push(['hype without win', r.n]);
      if (nearMissNoFeat && r.baseWin === 0 && !has(r, 'shock')) bad.push(['no shock on near miss', r.n]);
      if (has(r, 'shock') && !nearMissNoFeat) bad.push(['shock without near miss', r.n]);
      dead = r.total === 0 ? dead + 1 : 0; const rageExpected = dead >= 4; if (rageExpected) dead = 0;
      if (rageExpected && !has(r, 'rage')) bad.push(['no rage at dead streak 4', r.n]);
      if (!rageExpected && has(r, 'rage')) bad.push(['rage off-streak', r.n]);
      if ((r.tier === 'big' || r.tier === 'huge' || r.tier === 'mega' || r.tier === 'legend' || (bonus && r.total > 0)) && !has(r, 'win')) bad.push(['no win mood on big/bonus', r.n, r.tier]);
    }
    const c = (f) => out.filter(f).length;
    console.log(JSON.stringify({ rounds: out.length, withWin: c((r) => r.baseWin > 0), nearMiss: c((r) => (r.tease || r.phones === 2) && !r.feat.length), bonus: c((r) => r.feat.length), shockRounds: c((r) => has(r, 'shock')), rageRounds: c((r) => has(r, 'rage')), winMoodRounds: c((r) => has(r, 'win')), bad }));
    console.log(out.filter((r) => r.moods.length).slice(0, 12).map((r) => `${r.n}:${r.feat.join('+') || '-'}/w${r.baseWin}/${r.moods.join('>')}`).join('  '));
  } finally { console.log(logs.filter((l) => !/404/.test(l)).join('\n')); await b.browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
