/* QA shot flag (loaded by game.js only when the URL has ?shot=NAME). Puts the game in a reproducible state for screenshots; changes no game rules.
   shot=splash                      splash stays up
   shot=idle                        splash removed
   shot=hype|shock|rage|win         hero mood held, matching caption
   shot=bigwin                      big-win overlay (x412, $412.00, MEGA), waits for a tap
   shot=buy (&step=confirm) | shot=info   buy menu (or its confirm step) | info modal
   shot=spin                        removes the splash and presses SPIN (combine with &force=bonus1|bonus2|bonus3|phone|close|big|tease; practice rounds use the local engine,
                                    a live server needs COLDCALL_TEST=1) */
(() => {
  const CC = window.CC, Q = new URLSearchParams(location.search), shot = Q.get('shot'), $ = (id) => document.getElementById(id);
  const MOOD = { hype: 'smallWin', shock: 'tease', rage: 'rage', win: 'bigWin' };
  const go = async () => {
    while (!CC.ready) await new Promise((r) => setTimeout(r, 50));
    if (shot !== 'splash') { const sp = $('splash'); if (sp) sp.remove(); }
    CC.qa = { shot };
    if (MOOD[shot]) { CC.hero.set(shot, 0); CC.core.say(MOOD[shot]); }
    else if (shot === 'bigwin') CC.core.bigWin(412, 41200, 'mega');
    else if (shot === 'info') $('info').click();
    else if (shot === 'buy') { $('buy').click(); await new Promise((r) => setTimeout(r, 300)); if (Q.get('step') === 'confirm') { const b = $('buy_bonus1'); if (b) b.click(); } }
    else if (shot === 'spin') $('spin').click();
  };
  go();
})();
