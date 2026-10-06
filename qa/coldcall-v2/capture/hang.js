// diagnose a stuck round: play forced rounds with auto + turbo, every 4 s dump where it is
const { launch, ready, sleep } = require('./lib');
const [force = 'bonus1', rounds = '3', buy = ''] = process.argv.slice(2);
(async () => {
  const b = await launch(); const { page, logs } = b;
  try {
    await ready(page, '?nosplash&force=' + force);
    await page.evaluate(({ buy }) => { CC.core.st.turbo = true; CC.core.st.auto = true; (buy ? CC.core.play(buy) : document.getElementById('spin').click()); }, { buy });
    const t0 = Date.now(); let lastSig = '', same = 0, hang_last;
    while (Date.now() - t0 < 900000) {
      await sleep(4000);
      const d = await page.evaluate(() => ({ n: CC.dbg.rounds.length, busy: CC.core.st.busy, ribL: document.getElementById('ribL').textContent, ribR: document.getElementById('ribR').textContent, scene: document.getElementById('scene').children.length, anims: document.getAnimations().length, running: document.getAnimations().filter((a) => a.playState === 'running').length, board: CC.board.state(), win: document.getElementById('win').textContent, err: CC.dbg.error || null, mis: CC.dbg.mismatch.length, spinT: (CC.dbg.spinT || []).length, ovl: [...document.getElementById('ovl').children].map((e) => e.className).slice(0, 6), stamp: [...document.querySelectorAll('.stamp,.accept')].map((e) => e.textContent.slice(0, 20)), modal: CC.core.st.modal, tap: CC.core.st.tap }));
      if (d.n !== (hang_last = typeof hang_last === 'undefined' ? -1 : hang_last) ) { console.log(((Date.now() - t0) / 1000 | 0) + 's rounds', d.n); }
      hang_last = d.n; if (same >= 3) console.log(((Date.now() - t0) / 1000 | 0) + 's', JSON.stringify(d));
      const sig = JSON.stringify([d.n, d.ribL, d.ribR, d.win, d.board]); same = sig === lastSig ? same + 1 : 0; lastSig = sig;
      if (d.err) break; if (d.n >= +rounds && !d.busy) break; if (same >= 6) { console.log('STUCK'); break; }
    }
  } finally { console.log(logs.filter((l) => !/404/.test(l)).join('\n')); await b.browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
