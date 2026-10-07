/* COLD CALL bonuses: DIALING FOR DOLLARS (bonus1), ALWAYS BE CLOSING (bonus2), QUOTE ACCEPTED (bonus3).
   The intro "pick a number" keypad (keypad.js, chris 10-06 FB3; it replaced the rotary dial) is a REVEAL only: the player presses any key "to place the call" and it shows the digit
   the script already says (1, 2 or 3 = the bonus). Then the free spins replay in order with a HUD (spins left, bonus total, +N SPINS, upgrade), then the finale card. */
(() => {
  const CC = (window.CC = window.CC || {});
  const K = () => CC.core, $ = (id) => document.getElementById(id);
  const NAME = { bonus1: 'DIALING FOR DOLLARS', bonus2: 'ALWAYS BE CLOSING', bonus3: 'QUOTE ACCEPTED' };
  async function intro(b, ctx) {
    const digit = { bonus1: 1, bonus2: 2, bonus3: 3 }[b.kind];
    ctx.SFX.bonusIntro(); CC.hero.mood('hype', 1800); ctx.say(b.kind);
    const scn = document.createElement('div'); scn.className = 'scn rot';
    scn.innerHTML = '<div class="hd"><i></i><h2>PICK A NUMBER</h2><i></i></div><p class="sub" id="bSub">The number is already set. Press any key to place the call.</p><div id="bHost"></div><div class="chips"><div class="chip nm" id="chN"><small>YOU DIALED</small><b>-</b></div><div class="chip" id="chS"><small>FREE SPINS</small><b>-</b></div></div>';
    ctx.sceneEl.replaceChildren(scn);
    const d = CC.keypad.make(ctx); scn.querySelector('#bHost').replaceChildren(d.el);   // (chris 10-06 FB3) pick a number, not a rotary dial
    await d.spin(digit);                                         // the pressed key shows the script's digit, whatever the player pressed
    const set = (id, t) => { const c = scn.querySelector(id); c.querySelector('b').textContent = t; c.classList.add('set'); };
    set('#chN', NAME[b.kind]); ctx.SFX.register(); ctx.FX.burst(...ctx.stagePt(scn.querySelector('#chN')), { n: 14, speed: 260 }); await ctx.wait(500);
    set('#chS', b.startSpins); ctx.SFX.register(); ctx.FX.burst(...ctx.stagePt(scn.querySelector('#chS')), { n: 14, speed: 260 });
    scn.querySelector('#bSub').textContent = 'The call connects. ' + b.startSpins + ' free spins.';
    await ctx.wait(1300);
  }

  // The bonus of ONE round. ctx.script.bonus grows while the player decides: the first result of a PICK / ONE MORE CALL round carries only what has been seen,
  // every later result carries more. The loop below always reads the newest ctx.script.bonus and keeps its own position (i), so nothing replays.
  //   pick:  the decision spin (spin.pickPending) plays its drop and cascades (playSpin hold), the PICK prompt, then the same spin's phone feature only (resume).
  //   more:  every spin plays, then the ONE MORE CALL prompt, then the outcome (won / lost / banked), then the finale.
  async function run(ctx) {
    const hud = $('bh'), L = $('bhLeft'), T = $('bhTot');
    let b = ctx.script.bonus; const run0 = ctx.run.t, lbl = run0 > 0 ? 'ROUND TOTAL' : 'BONUS TOTAL', pl = () => (ctx.p.pull || {});
    // trigger flourish (the bells that landed ring)
    ctx.SFX.sting(); CC.board.pulse('bell'); ctx.stamp('BONUS!', NAME[b.kind], 1500, $('head')); ctx.FX.shake(6, 350); await ctx.wait(1500); CC.board.pulse('bell', false);
    await intro(b, ctx); ctx.cur.intro = true;
    ctx.sceneEl.replaceChildren(); ctx.bonusOn(); ctx.st.pace = 0.8; hud.hidden = false; L.textContent = b.startSpins; $('bhTotL').textContent = lbl;
    // the HUD total is the WIN meter's own number (same running total, same moments); a bonus after a paying trigger spin reads ROUND TOTAL
    T.textContent = ctx.meterTxt(ctx.cents(run0)); ctx.st.mirror = (t) => { T.textContent = t; };
    for (let i = 0; ; i++) {
      b = ctx.script.bonus; if (i >= b.spins.length) break;
      let sp = b.spins[i];
      ctx.modeName = NAME[sp.mode]; (CC.dbg.spinT = CC.dbg.spinT || []).push(performance.now() | 0); ctx.rib(ctx.modeName, 'SPIN ' + sp.n); if (sp.n === 1 || Math.random() < 0.25) ctx.say('freeSpin');
      if (sp.pickPending) {
        await ctx.playSpin(sp, { bonus: true, hold: true });                          // the cascades; the lit squares are the choices
        const pend = ctx.p.pending, lit = CC.board.hotList().join();
        if (pend && lit !== pend.choices.join()) CC.dbg.mismatch.push({ what: 'pick choices', shown: lit, script: pend.choices });
        ctx.rib(ctx.modeName, 'PICK A LEAD'); ctx.say('phone');
        await ctx.decide.pick(pend);                                                   // returns once the round has its next result (player, server default, or already settled)
        b = ctx.script.bonus; sp = b.spins[i];
        if (!sp || sp.pickPending) throw new Error('pick: the spin is still open after the decision');
        if (ctx.p.auto === 'autoplay' && pl().pick) ctx.say('idle', 'AUTO: first lead picked');   // U16: AUTO is autoplay only
        await ctx.playSpin(sp, { bonus: true, resume: true });                         // the phone feature of that spin only
      } else {
        const pk = pl().pick; if (ctx.p.auto === 'autoplay' && pk && pk.spin === sp.n && sp.phone) ctx.say('idle', 'AUTO: first lead picked');
        await ctx.playSpin(sp, { bonus: true });
      }
      ctx.cur.spins = i + 1;
      if (!b.capped && ctx.run.t - run0 !== sp.bonusTotal) CC.dbg.mismatch.push({ what: 'bonus HUD total', spin: sp.n, shown: ctx.run.t - run0, script: sp.bonusTotal });
      L.textContent = sp.left; ctx.anim(L, [{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 300 });
      if (sp.added > 0) { ctx.stamp('+' + sp.added + ' SPINS', 'THE BELLS RING', 1100); ctx.SFX.spinsAdded(sp.added); ctx.say('added'); await ctx.wait(900); }
      if (sp.upgrade) { ctx.stamp('UPGRADED!', NAME.bonus2, 1500, null, 'hi'); ctx.SFX.upgrade(); CC.hero.mood('hype', 1800); await ctx.wait(1250); }
    }
    b = ctx.script.bonus;
    const got = ctx.run.t - run0; if (!b.capped && got !== b.winTenths) CC.dbg.mismatch.push({ what: 'bonus total', shown: got, script: b.winTenths });   // winTenths = the bonus as played, before ONE MORE CALL
    // ONE MORE CALL: the whole bonus is on screen; keep it, or call once more
    if (ctx.p.status === 'pending' && ctx.p.pending && ctx.p.pending.k === 'more') {
      ctx.rib(NAME[b.kind], 'ONE MORE CALL?'); ctx.say('bigWin');
      await ctx.decide.more(ctx.p.pending);
      await ctx.moreOutcome();
    } else if (ctx.p.auto === 'autoplay' && pl().more) ctx.say('idle', 'AUTO: banked');
    // finale
    ctx.st.mirror = null; ctx.sceneEl.replaceChildren(); hud.hidden = true; ctx.st.pace = 1; (CC.dbg.spinT = CC.dbg.spinT || []).push(-(performance.now() | 0));
    if (ctx.willBig) { ctx.SFX.accepted(); CC.hero.mood('win', 3000); await ctx.wait(500); }   // the big-win overlay is the celebration; no second card before it
    else {
      ctx.SFX.accepted(); ctx.FX.coins(40); ctx.FX.confetti(25); CC.hero.mood('win', 3000);
      const end = document.createElement('div'); end.className = 'scn';
      end.innerHTML = '<h2></h2><div class="chips"><div class="chip set"><small>SPINS PLAYED</small><b></b></div><div class="chip set nm"><small>MODE</small><b></b></div></div><div class="chip set" style="width:100%"><small></small><b></b></div><div class="tap">TAP TO CONTINUE</div>';
      end.querySelector('h2').innerHTML = 'BONUS<br>COMPLETE'; const bs = end.querySelectorAll('b');
      bs[0].textContent = b.spins.length; bs[1].textContent = NAME[b.spins.length ? b.spins[b.spins.length - 1].mode : b.kind]; bs[2].textContent = ctx.p.status === 'done' && Number.isFinite(ctx.p.totalWin) ? ctx.dollars(ctx.p.totalWin) : ctx.meterTxt(ctx.cents(ctx.run.t)); end.querySelector('.chip[style] small').textContent = lbl;   // the round total the server paid (the card comes after ONE MORE CALL is settled)
      end.prepend(CC.hero.img('win', 'fin-hero')); ctx.sceneEl.replaceChildren(end); await ctx.waitTap(7000); ctx.FX.clear();
    }
    ctx.sceneEl.replaceChildren(); ctx.modeName = null; ctx.bonusOff();
  }

  CC.bonus = { run, NAME };
})();
