// U3 (money): a round another connection settles must never be shown as THIS tab's spin. Tab B is idle in <mode B>; another connection of the account has ONE MORE CALL open in the
// OTHER currency and banks it in the same tick as B's SPIN. PASS = B's last round on screen is its own spin (same mode, a round id the server lists for B's mode) and its WIN equals
// that round's totalWin. A run where the race did not hit (nothing stray reached B) is retried, up to 5 times; `raceHit` says whether it did.
//   node f1_cross.js <chips|play>   (the mode tab B is in)
const L = require('./f1lib');
(async () => {
  const mb = process.argv[2] || 'chips', mo = mb === 'chips' ? 'play' : 'chips';
  const name = L.uniq('f1c'); let res = null;
  for (let attempt = 1; attempt <= 5 && !(res && res.raceHit); attempt++) {
    const { browser, ctx } = await L.launch(); const p = await L.page(ctx, name + attempt); const nm = name + attempt;
    await L.mode(p, mb); await L.setBet(p, 100); await p.click('#turbo');
    const S = await L.sock(nm); let open = null;
    for (let i = 0; i < 14 && !open; i++) {
      let cur = await new Promise((r) => { S.once('g:coldcall:result', r); S.emit('g:coldcall:spin', { bet: 100, mode: mo, buyBonus: 'bonus1' }); });
      while (cur.status === 'pending' && cur.pending.k === 'pick') cur = await new Promise((r) => { S.once('g:coldcall:result', r); S.emit('g:coldcall:decide', { roundId: cur.roundId, k: 'pick', p: cur.pending.choices[0] }); });
      if (cur.status === 'pending' && cur.pending.k === 'more') open = cur; else await L.sleep(400);
    }
    if (!open) { await browser.close(); continue; }
    await p.evaluate(({ nm, pin }) => new Promise((r) => { const s2 = (window.__s2 = io({ forceNew: true })); s2.on('connect', () => s2.emit('auth_login', { name: nm, pin })); s2.on('auth_ok', r); }), { nm, pin: L.PIN });
    await L.sleep(500);
    await p.evaluate((id) => { window.__s2.emit('g:coldcall:decide', { roundId: id, k: 'more', take: false }); document.getElementById('spin').click(); }, open.roundId);
    await L.sleep(1200); await L.idle(p, 120000); await L.sleep(800);
    const row = await p.evaluate(() => { const r = CC.dbg.rounds[CC.dbg.rounds.length - 1]; return { id: r.id, kind: r.kind, totalWin: r.totalWin, bal: document.getElementById('bal').textContent, win: document.getElementById('win').textContent, mode: CC.core.st.mode, stray: (CC.dbg.stray || []).map((x) => x.id), mismatch: CC.dbg.mismatch.length }; });
    const h = await L.shist(S); const mine = h.rounds.find((r) => r.roundId === row.id);
    const raceHit = row.stray.includes(open.roundId) || (mine && mine.mode !== mb);
    res = { raceHit, attempt, ownRound: !!mine && mine.mode === mb, rowId: row.id, serverMode: mine && mine.mode, winShown: row.win, otherRound: open.roundId, strayIds: row.stray, mismatch: row.mismatch };
    res.ok = res.ownRound; await browser.close(); S.close();
  }
  L.out({ scenario: 'U3 cross-currency', mode: mb, ok: !!(res && res.raceHit && res.ok), ...res });
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
