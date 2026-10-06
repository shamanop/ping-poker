// Self-check harness. The game compares the screen with the script after every round (CC.dbg.mismatch, see selfCheck() in game.js);
// this driver plays many rounds, samples the WIN readout every 100 ms, and (live) compares the balance with the server's own wallet.
//   node selfcheck.js practice <N> [force]       practice engine (local), turbo + auto
//   node selfcheck.js live <N> [force] [buy]     real server on 4610 (needs COLDCALL_TEST=1 for force), turbo + auto, name from env CCNAME
const { launch, ready, sleep } = require('./lib');
const [mode, Ns, force = '', buy = ''] = process.argv.slice(2); const N = +Ns || 50;
const cents = (t) => (/^-?\$[\d,]+\.\d\d$/.test(t) ? Math.round(parseFloat(t.replace(/[$,]/g, '')) * 100) : NaN);
(async () => {
  const name = process.env.CCNAME || 'chk' + Date.now().toString(36).slice(-5);
  const b = await launch(); const { page, logs } = b; const t0 = Date.now();
  try {
    const qs = '?nosplash' + (mode === 'live' ? `&live=1&name=${name}&pin=1234` : '') + (force && force !== '-' ? '&force=' + force : '');
    await ready(page, qs);
    if (mode === 'live') await page.waitForFunction(() => CC.core.st.live, null, { timeout: 30000 });
    await page.evaluate(() => { window.__samp = []; setInterval(() => { const w = document.getElementById('win'); __samp.push([CC.dbg.started || 0, CC.core.st.busy ? 1 : 0, w.textContent, CC.fx.running() ? 1 : 0]); }, 100); });
    await page.evaluate(({ buy }) => { CC.core.st.turbo = true; CC.core.st.auto = true; if (buy) CC.core.play(buy); else document.getElementById('spin').click(); }, { buy });
    let last = 0;
    while (true) {
      const r = await page.evaluate(() => ({ n: CC.dbg.rounds.length, busy: CC.core.st.busy, err: CC.dbg.error || null }));
      if (r.n !== last) { last = r.n; if (last % 25 === 0 || N <= 30) console.log('rounds', last, ((Date.now() - t0) / 1000).toFixed(0) + 's'); }
      if (r.err) { console.log('PAGE ERROR', r.err); break; }
      if (r.n >= N) {                      // the Nth round: keep auto on until its intro dial (if any) has been dialled, then stop further rounds
        const bonus = await page.evaluate(() => CC.dbg.rounds[CC.dbg.rounds.length - 1].bonus);
        while (bonus && !(await page.evaluate(() => CC.core.st.pace < 1 || !CC.core.st.busy))) await sleep(300);
        await page.evaluate(() => { CC.core.st.auto = false; }); break;
      }
      if (Date.now() - t0 > 3 * 3600e3) { console.log('time limit'); break; }
      await sleep(500);
    }
    await page.waitForFunction(() => !CC.core.st.busy, null, { timeout: 600000 });
    await sleep(900);
    const out = await page.evaluate(() => ({ mis: CC.dbg.mismatch, checked: CC.dbg.checked, rounds: CC.dbg.rounds, samp: window.__samp, bal: document.getElementById('bal').textContent, err: CC.dbg.error || null, rafMax: window.__raf ? window.__raf.max : null, audio: document.querySelectorAll('audio').length, moods: CC.dbg.moods || [] }));
    // sampler analysis: per round (dbg.started), the WIN readout never blank, never decreases (except the reset to $0.00 when the next round starts)
    let blank = 0, dec = 0, maxLen = 0; const groups = new Map(); out.samp.forEach(([g, busy, txt, fx]) => { if (!groups.has(g)) groups.set(g, []); groups.get(g).push(txt); });
    for (const [g, arr] of groups) { let prev = -1, idx = 0; for (const t of arr) { const c = cents(t); if (Number.isNaN(c)) blank++; else { if (c < prev && !(c === 0 && idx <= 1)) dec++; prev = c; } idx++; } maxLen = Math.max(maxLen, arr.length); }
    const kinds = {}; out.rounds.forEach((r) => { const k = (r.bonus || 'base') + (r.phone ? '+phone' : '') + (r.kind !== 'spin' ? '[' + r.kind + ']' : ''); kinds[k] = (kinds[k] || 0) + 1; });
    const tiers = {}; out.rounds.forEach((r) => { tiers[r.tier] = (tiers[r.tier] || 0) + 1; });
    // mood audit: the map in the brief, per round (a round's moods are the ones set while dbg.started === its index)
    const mv = []; let streak = 0;
    out.rounds.forEach((r, i) => {
      const m = new Set(out.moods.filter((x) => x.r === i + 1).map((x) => x.m)), need = (c, why) => { if (c && !m.has(c.mood)) mv.push({ round: i + 1, missing: c.mood, why }); };
      if (r.tease) need({ mood: 'shock' }, 'tease'); if (r.cluster > 0) need({ mood: 'hype' }, 'cluster win'); if (r.bonus) { need({ mood: 'hype' }, 'bonus trigger'); need({ mood: 'win' }, 'bonus total'); }
      if (['big', 'huge', 'mega', 'legend'].includes(r.tier)) need({ mood: 'win' }, 'big win'); if (r.bigClose) need({ mood: 'win' }, 'close >= 25x');
      if (m.has('win') && !(r.bonus || r.bigClose || ['big', 'huge', 'mega', 'legend'].includes(r.tier))) mv.push({ round: i + 1, extra: 'win', why: 'no cause' });
      if (m.has('shock') && !r.tease) mv.push({ round: i + 1, extra: 'shock', why: 'no tease' });
      const dead = r.kind === 'spin' && r.win === 0; streak = r.kind !== 'spin' || r.win > 0 ? 0 : streak + 1;
      if (dead && streak >= 4) { need({ mood: 'rage' }, 'dead streak 4'); streak = 0; } else if (m.has('rage')) mv.push({ round: i + 1, extra: 'rage', why: 'streak ' + streak });
    });
    let balCheck = null;
    if (mode === 'live') balCheck = await page.evaluate(() => new Promise((res) => { CC.core.T.sock.once('g:coldcall:state', (s) => res({ server: s.wallet.play, shown: document.getElementById('bal').textContent })); CC.core.T.sock.emit('g:coldcall:state', {}); }));
    if (balCheck) balCheck.match = cents(balCheck.shown) === balCheck.server;
    console.log(JSON.stringify({ mode, force, buy, moodViolations: mv.length, moodSample: mv.slice(0, 4), rounds: out.rounds.length, checkedByGame: out.checked, mismatches: out.mis.length, mismatchSample: out.mis.slice(0, 5), samples: out.samp.length, blank, decreases: dec, kinds, tiers, balCheck, rafMax: out.rafMax, audioEls: out.audio, err: out.err, secs: Math.round((Date.now() - t0) / 1000) }));
  } finally { console.log(logs.filter((l) => !/404/.test(l)).join('\n')); await b.browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
