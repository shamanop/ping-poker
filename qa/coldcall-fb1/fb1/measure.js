// node measure.js PORT OUT.json [spins]  -> passive in-page timing of every spin (no click during the old blocked window), grouped by what the round was.
const fs = require('fs'), L = require('./lib');
const PORT = +process.argv[2] || 4650, OUT = process.argv[3] || __dirname + '/before.json', N = +process.argv[4] || 40;
(async () => {
  const name = L.uniq('fb1m'); await L.wallet(PORT, name);
  const b = await L.open(PORT, name), { page } = b; await page.evaluate(L.REC); await L.sleep(300);
  for (let i = 0; i < N; i++) { await page.evaluate(() => document.getElementById('spin').click()); await L.sleep(200); await L.idle(page, 90000); await L.sleep(250); }
  const rows = await L.rows(page), err = await page.evaluate(() => ({ mismatch: CC.dbg.mismatch, err: CC.dbg.error || null, pull: CC.dbg.pull }));
  const R = rows.map((r) => {
    const ms = (a, c) => (a != null && c != null ? Math.round(c - a) : null), p = r.p || {}, lg = r.fx.find((f) => f.n === 'leadGain'), gh = r.fx.find((f) => f.n === 'ghost'), pot = r.fx.find((f) => f.n === 'potWin');
    const kind = p.armed ? 'armed' : p.bonus ? 'bonus' : p.pot ? 'pot' : p.ghost && gh ? 'ghost' : p.totalWin === 0 ? 'dead' : p.tier && p.tier !== 'none' && !['small', 'win', 'low'].includes(p.tier) ? 'tier:' + p.tier : 'win';
    return { id: p.id, kind, tier: p.tier, totalWin: p.totalWin, filled: p.filled, daily: p.daily, leaked: p.leaked, armed: p.armed, total: ms(r.tStart, r.tOff), resultToRounds: ms(r.tDone, r.tRounds), winToOff: ms(r.tWin, r.tOff), roundsToOff: ms(r.tRounds, r.tOff), leadGainMs: lg ? ms(lg.t0, lg.t1) : null, ghostMs: gh ? ms(gh.t0, gh.t1) : null, potMs: pot ? ms(pot.t0, pot.t1) : null, gainShown: r.gainText, cold: r.cold };
  });
  const by = {}; for (const r of R) (by[r.kind] = by[r.kind] || []).push(r);
  const st = (a) => { const v = a.filter((x) => x != null).sort((x, y) => x - y); return v.length ? { n: v.length, min: v[0], med: v[v.length >> 1], max: v[v.length - 1] } : null; };
  const summary = {}; for (const k in by) summary[k] = { n: by[k].length, roundsToOff: st(by[k].map((r) => r.roundsToOff)), winToOff: st(by[k].map((r) => r.winToOff)), leadGainMs: st(by[k].map((r) => r.leadGainMs)) };
  const out = { port: PORT, spins: N, when: new Date().toISOString(), note: 'roundsToOff = ms from st.rounds++ (every post-win animation done, win counted) to st.busy=false (SPIN takes a click): the leads wait. winToOff = from the WIN meter on its final amount (wins only). All headless software GL.', summary, rounds: R, err };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1)); console.log(JSON.stringify(summary, null, 1)); console.log('err', JSON.stringify(err).slice(0, 300));
  await b.browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
