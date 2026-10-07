// FB1 driver (chris 10-06 FB1): node fb1.js PORT LABEL [spins]   (run under flock _scratch/locks/chrome.lock; exit 1 if any check fails)
//  accept     : spamming SPIN from the moment the round is over (st.rounds++) starts the next spin within ACCEPT_MS (baseline: ~700 ms, the leads wait)
//  money      : after N hammered spins the shown balance == the page wallet == the server wallet (second socket), and wallet delta == sum(totalWin + pot - cost) of the rounds
//  settled    : no spin ever starts before the previous round's done result (client rows) and the server holds no open round at the end
//  leads      : the note ends on the server's leads; every number the note showed was a server-sent one; overlapping leadGain calls happened (supersede exercised)
//  ghost      : SPIN clicked while the would-have-closed stamp is up starts the spin and leaves no stamp / plg / under / hot squares behind; a ghost left alone cleans up and the warm squares come back
const fs = require('fs'), L = require('./lib');
const PORT = +process.argv[2] || 4651, LABEL = process.argv[3] || 'after', N = +process.argv[4] || 30, ACCEPT_MS = 150;
const res = { port: PORT, label: LABEL, when: new Date().toISOString(), checks: {}, detail: {} };
const chk = (k, ok, d) => { res.checks[k] = !!ok; if (d !== undefined) res.detail[k] = d; console.log((ok ? 'PASS ' : 'FAIL ') + k + (d !== undefined ? '  ' + JSON.stringify(d).slice(0, 300) : '')); };
(async () => {
  const name = L.uniq('fb1d'), w0 = await L.wallet(PORT, name);
  const b = await L.open(PORT, name), { page } = b;
  await page.evaluate(L.REC);
  if (process.env.TURBO) await page.evaluate(() => document.getElementById('turbo').click());   // TURBO=1: rounds shorter than the leads note, so a newer leadGain starts while the older one still runs
  await page.evaluate(() => {   // sampler: every distinct leads number the note shows, every frame
    const seen = (window.__seen = { n: new Set(), gainShown: 0 }); const tick = () => { const n = document.getElementById('plN'); if (n) seen.n.add(parseInt(n.textContent.replace(/,/g, ''), 10)); if (!document.getElementById('plGain').hidden) seen.gainShown++; requestAnimationFrame(tick); }; tick();
    window.__sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // spin once, then for every following round spam SPIN from the instant it is over until the next spin starts; returns per-round accept latency
    window.__hammer = async (n) => {
      const st = CC.core.st, out = []; const click = () => document.getElementById('spin').click();
      let s = CC.dbg.started || 0; click(); while ((CC.dbg.started || 0) === s) await __sleep(5);
      for (let i = 0; i < n; i++) {
        const r0 = st.rounds, t00 = performance.now(); while (st.rounds === r0) { if (performance.now() - t00 > 150000) return out; await __sleep(2); }
        const tR = performance.now(), s1 = CC.dbg.started || 0; let clicks = 0;
        while ((CC.dbg.started || 0) === s1) { click(); clicks++; await __sleep(20); if (performance.now() - tR > 8000) break; }
        out.push({ acceptMs: Math.round(performance.now() - tR - 20), clicks, started: (CC.dbg.started || 0) > s1 });
      }
      return out;
    };
  });
  const before = await page.evaluate(() => CC.core.st.rounds);
  const hm = await page.evaluate((n) => __hammer(n), N);
  await L.idle(page, 150000); await L.sleep(1500);
  const rows = await L.rows(page), dr = await page.evaluate(() => CC.dbg.rounds.map((r) => ({ id: r.id, cost: r.cost, totalWin: r.totalWin, potWon: r.potWon, aborted: r.aborted || null }))), srv = await (async () => { const s = await L.sock(PORT, name); const st = await L.sstate(s); s.close(); return st; })();
  const pg = await page.evaluate(() => ({ bal: CC.core.st.bal, wallet: CC.core.money.wallet.play, plN: document.getElementById('plN').textContent, plOf: document.getElementById('plOf').textContent, plBar: getComputedStyle(document.getElementById('plBar')).getPropertyValue('--w').trim(), gainHidden: document.getElementById('plGain').hidden, mismatch: CC.dbg.mismatch, err: CC.dbg.error || null, pullErr: CC.dbg.pull, seen: [...__seen.n], gainShown: __seen.gainShown, left: document.querySelectorAll('#floats > *, #ov > *, #scene > *, .stamp, .accept, .banner, .fly, .flash, .plgh').length, plg: document.querySelectorAll('#head.plg, .slots i.plg').length, under: document.querySelectorAll('#reels .under').length, bn: document.getElementById('plBn') && !document.getElementById('plBn').hidden }));
  // accept
  const acc = hm.map((h) => h.acceptMs).sort((a, c) => a - c), med = acc[acc.length >> 1], max = acc[acc.length - 1];
  const armedRows = rows.filter((r) => r.p && r.p.armed).length;
  chk('accept: every next spin starts within ' + ACCEPT_MS + ' ms of the round being over', hm.length >= N - 2 && hm.every((h) => h.started && h.acceptMs <= ACCEPT_MS), { n: hm.length, med, max, p: acc });
  // money
  const sum = dr.reduce((a, r) => a + (r.totalWin || 0) + (r.potWon || 0) - (r.cost || 0), 0), dW = srv.wallet.play - w0.play;
  chk('money: shown balance == page wallet == server wallet', pg.bal === pg.wallet && pg.wallet === srv.wallet.play, { shown: pg.bal, page: pg.wallet, server: srv.wallet.play });
  chk('money: server wallet delta == sum(win + pot - cost) over the rounds', dW === sum && dr.length >= N && dr.every((r) => !r.aborted && r.cost != null), { delta: dW, sum, rounds: dr.length });
  chk('money: no mismatch / error / pull error', !pg.mismatch.length && !pg.err && !pg.pullErr.length, { mm: pg.mismatch.slice(0, 3), err: pg.err, pe: pg.pullErr });
  // settled
  let okSet = rows.length >= N; for (let i = 1; i < rows.length; i++) if (rows[i - 1].tDone == null || rows[i].tStart < rows[i - 1].tDone) okSet = false;
  chk('settled: no spin started before the previous round was done on the server', okSet && !srv.open && !(srv.opens && srv.opens.length), { open: !!srv.open });
  // leads
  const sv = srv.pull.play, sent = new Set([sv.leads]); for (const r of rows) for (const e of r.fx) if (e.arg && e.arg.before != null) for (let x = Math.floor(e.arg.before / 10); x <= Math.floor(e.arg.after / 10); x++) sent.add(x);   // the count-up walks the integers between two server-sent values (as it always did)
  sent.add(0);   // the account starts at 0 leads
  const stray = pg.seen.filter((x) => !Number.isNaN(x) && !sent.has(x));
  const ov = (() => { const f = rows.flatMap((r) => r.fx.filter((e) => e.n === 'leadGain')); let o = 0; for (let i = 1; i < f.length; i++) if (f[i - 1].t1 == null || f[i - 1].t1 > f[i].t0) o++; return o; })();
  const wantBar = Math.max(0, Math.min(100, (sv.leads / Math.max(1, sv.list)) * 100)).toFixed(1) + '%';
  chk('leads: note count == server leads, bar == leads/list, +N label hidden, no banner left', parseInt(pg.plN.replace(/,/g, ''), 10) === sv.leads && pg.plBar === wantBar && pg.gainHidden && !pg.bn, { note: pg.plN, server: sv.leads, bar: pg.plBar, wantBar, gainHidden: pg.gainHidden });
  chk('leads: every number the note showed lies in a server-sent from..to range', stray.length === 0, { shown: pg.seen, sent: [...sent], stray });
  res.detail.naturalLeadGainOverlaps = ov;   // informational: natural flow only overlaps on long banners; the forced supersede check below is the proof
  chk('cleanup: nothing left on screen (stamps, plg, under)', pg.left === 0 && pg.plg === 0 && pg.under === 0, { left: pg.left, plg: pg.plg, under: pg.under });
  res.detail.hammer = hm; res.detail.armedRows = armedRows;

  // supersede, forced: two leadGain calls 100 ms apart (UI-only check with a copy of the live view; the second range starts where the first ends). The older one must not draw after the newer started, nor hide the +N label / redraw the note early.
  const sup = await page.evaluate(async () => {
    const S = CC.pull._S, v0 = S.view; CC.pull.setView({ ...v0, leads: 15, lt: 150, list: 450, cb: null }, 'play'); const note = () => parseInt(document.getElementById('plN').textContent, 10), gain = document.getElementById('plGain');
    const w = 700 * CC.core.speed(), lo = []; let t2 = null, mid = null; const iv = setInterval(() => { if (t2 != null && performance.now() - t2 > 60) lo.push(note()); }, 8);   // waits scale with speed() (turbo), so does this test
    CC.pull.leadGain({ leadsBefore: 100, leadsAfter: 130, filled: 30, leaked: 0, armed: false });
    await __sleep(100); t2 = performance.now(); const second = CC.pull.leadGain({ leadsBefore: 130, leadsAfter: 150, filled: 20, leaked: 0, armed: false });
    await __sleep(w - 40); mid = { gainHidden: gain.hidden, n: note() };   // 760 ms after the first call: the first one has finished its own 700 ms wait, the second has not
    await second; clearInterval(iv); const end = { n: note(), gainHidden: gain.hidden, bn: !document.getElementById('plBn').hidden };
    CC.pull.setView(v0, 'play'); return { below13: lo.filter((x) => x < 13).length, samples: lo.length, mid, end };
  });
  chk('leads supersede: the older leadGain draws nothing after the newer started, the +N label survives until the newer ends, the note ends on the view', sup.below13 === 0 && sup.samples > 20 && sup.mid.gainHidden === false && sup.end.n === 15 && sup.end.gainHidden && !sup.end.bn, sup);
  if (process.env.TURBO || process.env.NOGHOST) { const okT = Object.values(res.checks).every(Boolean); res.ok = okT; fs.writeFileSync(__dirname + '/fb1_' + LABEL + '.json', JSON.stringify(res, null, 1)); console.log(okT ? 'ALL PASS' : 'SOME FAIL'); await b.browser.close(); process.exit(okT ? 0 : 1); }
  // ghost: click while the stamp is up
  let g1 = null;
  for (let i = 0; i < 80 && !g1; i++) {
    await page.evaluate(() => document.getElementById('spin').click()); await L.sleep(150); await L.idle(page, 150000);
    const up = await page.evaluate(() => !!document.querySelector('.plgh') || document.getElementById('head').classList.contains('plg'));
    if (up) { g1 = await page.evaluate(async () => { const s0 = CC.dbg.started; document.getElementById('spin').click(); await __sleep(120); return { started: CC.dbg.started > s0, busy: CC.core.st.busy, stamp: document.querySelectorAll('.plgh').length, plg: document.querySelectorAll('#head.plg, .slots i.plg').length, under: document.querySelectorAll('#reels .under').length }; }); await L.idle(page, 150000); await L.sleep(800); }
    else await L.sleep(3600);   // lets the round-end / an unshown ghost finish
  }
  await page.waitForFunction(() => !CC.pull._S.gh, null, { timeout: 8000 }).catch(() => {});   // the spin after the click may itself end on a ghost: let that one finish
  const gEnd = await page.evaluate(() => ({ mm: CC.dbg.mismatch.length, left: document.querySelectorAll('#floats > *, #ov > *, #scene > *, .stamp, .accept, .banner, .fly, .flash, .plgh').length, plg: document.querySelectorAll('#head.plg, .slots i.plg').length, under: document.querySelectorAll('#reels .under').length, err: CC.dbg.error || null }));
  chk('ghost: SPIN clicked over the stamp starts the spin and clears the stamp, plg, under', g1 && g1.started && g1.busy && g1.stamp === 0 && g1.plg === 0 && g1.under === 0 && !gEnd.mm && !gEnd.left && !gEnd.plg && !gEnd.under && !gEnd.err, { g1, gEnd });
  // ghost left alone: cleans up, warm squares back
  let g2 = null;
  for (let i = 0; i < 80 && !g2; i++) {
    await page.evaluate(() => { window.__gseen = false; document.getElementById('spin').click(); }); await L.sleep(150); await L.idle(page, 150000);
    const up = await page.evaluate(() => !!document.querySelector('.plgh') || document.getElementById('head').classList.contains('plg'));
    if (up) { await L.sleep(4500); g2 = await page.evaluate(() => { const v = CC.core.st.pv.play, want = v && v.warm && v.warm.length && v.warmBet === CC.core.st.bets[CC.core.st.betIdx] ? v.warm.slice().sort((a, c) => a - c) : [], hot = CC.board.hotList().slice().sort((a, c) => a - c); return { stamp: document.querySelectorAll('.plgh').length, plg: document.querySelectorAll('#head.plg, .slots i.plg').length, under: document.querySelectorAll('#reels .under').length, hot, want, mm: CC.dbg.mismatch.length }; }); }
    else await L.sleep(3600);
  }
  chk('ghost: left alone it ends itself and the warm squares are back', g2 && g2.stamp === 0 && g2.plg === 0 && g2.under === 0 && JSON.stringify(g2.hot) === JSON.stringify(g2.want) && !g2.mm, g2);
  const ok = Object.values(res.checks).every(Boolean); res.ok = ok;
  fs.writeFileSync(__dirname + '/fb1_' + LABEL + '.json', JSON.stringify(res, null, 1)); console.log(ok ? 'ALL PASS' : 'SOME FAIL'); await b.browser.close(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
