/* QA shot flag (loaded by game.js only when the URL has ?shot=NAME). Puts the game in a reproducible state for screenshots; changes no game rules.
   shot=splash                      splash stays up
   shot=idle                        splash removed
   shot=hype|shock|rage|win         hero mood held, matching caption
   shot=bigwin                      big-win overlay (x412, $412.00, MEGA), waits for a tap
   shot=buy | shot=info             buy modal -> confirm step | pay table
   shot=spin                        removes the splash and presses SPIN (combine with &force=rotary|quote|big)
   ?mock=6x5                        static 6x5 board mock (30 cells, current symbols, a lit cluster, no game logic) to judge symbol readability at ~78 px
   shot=quote_grand                 practice engine with respin landing chance 1 (every box fills) then plays a bought QUOTE round (PAYMENT ACCEPTED) */
(() => {
  const CC = window.CC, Q = new URLSearchParams(location.search), shot = Q.get('shot'), $ = (id) => document.getElementById(id);
  const MOOD = { hype: 'smallWin', shock: 'tease', rage: 'rage', win: 'bigWin' };
  const go = async () => {
    while (!CC.ready) await new Promise((r) => setTimeout(r, 50));
    if (shot !== 'splash') { const sp = $('splash'); if (sp) sp.remove(); }
    CC.qa = { shot };
    if (Q.get('mock') === '6x5') {   // layout only: the skin depends on --cols/--rows/--cell/--gap, nothing else
      const st = document.getElementById('stage').style; st.setProperty('--cols', 6); st.setProperty('--rows', 5); st.setProperty('--cell', '78px'); st.setProperty('--gap', '3px');
      const slots = $('slots'), reels = $('reels'), ids = ['cash', 'pile', 'rx', 'headset', 'can', 'mug', 'note', 'ball', 'closer', 'quote', 'phone', 'upsell'];
      slots.replaceChildren(...Array.from({ length: 30 }, () => document.createElement('i'))); reels.replaceChildren();
      const lit = new Set(['1,1', '1,2', '2,2', '2,3', '3,2']);   // an example winning cluster
      for (let c = 0; c < 6; c++) {
        const reel = document.createElement('div'); reel.className = 'reel'; reel.style.gridColumn = c + 1; const strip = document.createElement('div'); strip.className = 'strip';
        for (let r = 0; r < 5; r++) { const cell = CC.core.symNode(ids[(c * 5 + r * 3 + c) % ids.length]); const k = c + ',' + r; cell.classList.add(lit.has(k) ? 'hit' : 'dim'); if (!lit.has(k) && (c + r) % 3) cell.classList.remove('dim'); strip.appendChild(cell); }
        reel.appendChild(strip); reels.appendChild(reel);
      }
      CC.hero.set('hype', 0); CC.core.say('smallWin'); return;
    }
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
