/* QA shot flag (loaded by game.js only when the URL has ?shot=NAME). Puts the game in a reproducible state for screenshots; changes no game rules.
   shot=splash                      splash stays up
   shot=idle                        splash removed
   shot=hype|shock|rage|win         hero mood held, matching caption
   shot=bigwin                      big-win overlay (x412, $412.00, MEGA), waits for a tap
   shot=buy | shot=info             buy modal -> confirm step | pay table
   shot=spin                        removes the splash and presses SPIN (combine with &force=rotary|quote|big)
   shot=quote_grand                 practice engine with respin landing chance 1 (every box fills) then plays a bought QUOTE round (PAYMENT ACCEPTED) */
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
    else if (shot === 'buy') { $('buy').click(); await new Promise((r) => setTimeout(r, 300)); const b = $('buy_rotary'); if (b) b.click(); }
    else if (shot === 'spin') $('spin').click();
    else if (shot === 'quote_grand') {
      const E = ColdCallEngine, eng = E.createEngine({ ...JSON.parse(JSON.stringify(E.CFG)), landP: 1, upsellP: 0.15 });
      E.resolveRound = (rng, buy) => { const r = eng.round(rng, buy, { script: true }); return { round: r, buy: r.buy, costTenths: r.costTenths, winTenths: r.winTenths, winX: r.winX, capped: r.capped, tier: r.tier, script: r.script }; };
      CC.core.play('quote');
    }
  };
  go();
})();
