/* COLD CALL bonuses: DIALING FOR DOLLARS (bonus1), ALWAYS BE CLOSING (bonus2), QUOTE ACCEPTED (bonus3).
   The intro dial is a REVEAL only: the player drags or taps it "to place the call" and it lands on the digit the script already says
   (1, 2 or 3 = the bonus). Then the free spins replay in order with a HUD (spins left, bonus total, +N SPINS, upgrade), then the finale card.
   Dial is all HTML/CSS (no image); drag = pointer events (no rAF). */
(() => {
  const CC = (window.CC = window.CC || {});
  const K = () => CC.core, $ = (id) => document.getElementById(id);
  const NAME = { bonus1: 'DIALING FOR DOLLARS', bonus2: 'ALWAYS BE CLOSING', bonus3: 'QUOTE ACCEPTED' };
  const STEP = 28, STOP = 135, R = 100;                       // degrees between holes; finger stop at 135 deg clockwise from 12 o'clock; hole ring radius px
  const holeAngle = (i) => STOP - (i + 1) * STEP;             // hole i sits (i+1) steps counter-clockwise of the stop; drag it clockwise to the stop

  function makeDial(values, label, ctx) {
    const el = document.createElement('div'); el.className = 'dial hint'; el.setAttribute('role', 'button'); el.tabIndex = 0; el.setAttribute('aria-label', 'Rotary dial. Drag or tap to place the call.');
    el.innerHTML = '<div class="ring"></div><div class="plate"></div><div class="hub"></div><div class="stop"></div>';
    const plate = el.querySelector('.plate'), hub = el.querySelector('.hub'), stop = el.querySelector('.stop');
    values.forEach((v, i) => { const h = document.createElement('div'); h.className = 'hole'; h.style.transform = `rotate(${holeAngle(i)}deg) translateY(-${R}px)`; const sp = document.createElement('span'); sp.style.transform = `rotate(${-holeAngle(i)}deg)`; sp.textContent = label(v); h.appendChild(sp); plate.appendChild(h); });
    stop.style.transform = `rotate(${STOP}deg) translateY(-${R + 42}px)`; hub.textContent = 'CALL';
    let rot = 0;
    const setRot = (d) => { rot = d; plate.style.transform = `rotate(${d}deg)`; };
    const sp_ = () => (ctx.st.skip ? 0.3 : ctx.st.turbo ? 0.5 : 1);
    const turn = async (from, to, ms, easing) => { const a = plate.animate([{ transform: `rotate(${from}deg)` }, { transform: `rotate(${to}deg)` }], { duration: Math.max(1, ms * sp_()), easing, fill: 'forwards' }); await a.finished.catch(() => {}); setRot(to); a.cancel(); };
    // idx: index of the script's digit. Resolves after the dial has returned home.
    function spin(idx) {
      const target = (idx + 1) * STEP;
      return new Promise((resolve) => {
        let drag = null, done = false, autoT = 0;
        const angle = (e) => { const r = el.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180 / Math.PI; };
        const finish = async () => {
          if (done) return; done = true; clearTimeout(autoT);
          el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); el.removeEventListener('keydown', key);
          el.classList.remove('hint'); hub.textContent = '...';
          const rest = Math.max(0, target - rot);
          ctx.SFX.dialWhirr(300 + rest * 5); await turn(rot, target, 260 + rest * 4, 'cubic-bezier(.3,.6,.4,1)');   // forward to the finger stop
          ctx.SFX.dialStop(); hub.textContent = 'STOP'; await ctx.wait(320);
          const back = 700 + target * 4;                                                                          // spring home, clicking past each hole
          for (let i = 0; i < idx + 1; i++) setTimeout(() => ctx.SFX.dialTick(), (back * (i + 0.5) / (idx + 1)) * sp_());
          await turn(target, 0, back, 'linear'); hub.textContent = 'CALL'; resolve();
        };
        const down = (e) => { if (done) return; drag = { a0: angle(e), last: 0, moved: false }; el.setPointerCapture(e.pointerId); el.classList.remove('hint'); };
        const move = (e) => {
          if (!drag || done) return; let d = angle(e) - drag.a0; while (d - drag.last > 180) d -= 360; while (d - drag.last < -180) d += 360; drag.last = d;
          if (Math.abs(d) > 6) drag.moved = true; const r = Math.max(0, Math.min(target, d)); if (Math.floor(r / STEP) !== Math.floor(rot / STEP)) ctx.SFX.dialTick(); setRot(r);
        };
        const up = () => { if (drag) { drag = null; finish(); } };
        const key = (e) => { if (e.code === 'Space' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(); } };
        el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('keydown', key);
        el.focus({ preventScroll: true });
        if (ctx.st.auto) autoT = setTimeout(finish, 700);
        el._finish = finish;                                    // test / accessibility hook: same path as a tap
      });
    }
    return { el, spin };
  }

  async function intro(b, ctx) {
    const digit = { bonus1: 1, bonus2: 2, bonus3: 3 }[b.kind];
    ctx.SFX.bonusIntro(); CC.hero.mood('hype', 1800); ctx.say(b.kind);
    const scn = document.createElement('div'); scn.className = 'scn rot';
    scn.innerHTML = '<div class="hd"><i></i><h2>PLACE THE CALL</h2><i></i></div><p class="sub" id="bSub">Drag the dial to the stop, or tap it</p><div id="bHost"></div><div class="chips"><div class="chip nm" id="chN"><small>YOU DIALED</small><b>-</b></div><div class="chip" id="chS"><small>FREE SPINS</small><b>-</b></div></div>';
    ctx.sceneEl.replaceChildren(scn);
    const d = makeDial([1, 2, 3, 4, 5, 6, 7, 8, 9, 0], (v) => String(v), ctx); scn.querySelector('#bHost').replaceChildren(d.el);
    await d.spin(digit - 1);                                     // the dial lands on the script's digit, whatever the player did
    const set = (id, t) => { const c = scn.querySelector(id); c.querySelector('b').textContent = t; c.classList.add('set'); };
    set('#chN', NAME[b.kind]); ctx.SFX.register(); ctx.FX.burst(...ctx.stagePt(scn.querySelector('#chN')), { n: 14, speed: 260 }); await ctx.wait(500);
    set('#chS', b.startSpins); ctx.SFX.register(); ctx.FX.burst(...ctx.stagePt(scn.querySelector('#chS')), { n: 14, speed: 260 });
    scn.querySelector('#bSub').textContent = 'The call connects. ' + b.startSpins + ' free spins.';
    await ctx.wait(1300);
  }

  async function run(b, ctx) {
    const hud = $('bh'), L = $('bhLeft'), T = $('bhTot'), run0 = ctx.run.t, lbl = run0 > 0 ? 'ROUND TOTAL' : 'BONUS TOTAL';
    // trigger flourish (the bells that landed ring)
    ctx.SFX.sting(); CC.board.pulse('bell'); ctx.stamp('BONUS!', NAME[b.kind], 1500, $('head')); ctx.FX.shake(6, 350); await ctx.wait(1500); CC.board.pulse('bell', false);
    await intro(b, ctx);
    ctx.sceneEl.replaceChildren(); ctx.bonusOn(); ctx.st.pace = 0.8; hud.hidden = false; L.textContent = b.startSpins; $('bhTotL').textContent = lbl;
    // the HUD total is the WIN meter's own number (same running total, same moments); a bonus after a paying trigger spin reads ROUND TOTAL
    let cur = ctx.cents(run0), tw = 0; T.textContent = ctx.dollars(cur);
    const hudTo = (to, ms) => { const id = ++tw, from = cur; ctx.tween(from, to, ms, (x) => { if (id === tw) { cur = Math.round(x); T.textContent = ctx.dollars(cur); } }).then(() => { if (id === tw) { cur = to; T.textContent = ctx.dollars(to); } }); };
    ctx.onAdd = (add, ms) => hudTo(ctx.cents(ctx.run.t), ms);
    for (const sp of b.spins) {
      ctx.modeName = NAME[sp.mode]; (CC.dbg.spinT = CC.dbg.spinT || []).push(performance.now() | 0); ctx.rib(ctx.modeName, 'SPIN ' + sp.n); if (sp.n === 1 || Math.random() < 0.25) ctx.say('freeSpin');
      await ctx.playSpin(sp, { bonus: true });
      if (!b.capped && ctx.run.t - run0 !== sp.bonusTotal) CC.dbg.mismatch.push({ what: 'bonus HUD total', spin: sp.n, shown: ctx.run.t - run0, script: sp.bonusTotal });
      hudTo(ctx.cents(ctx.run.t), 200);
      L.textContent = sp.left; ctx.anim(L, [{ transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' }], { duration: 300 });
      if (sp.added > 0) { ctx.stamp('+' + sp.added + ' SPINS', 'THE BELLS RING', 1100); ctx.SFX.spinsAdded(sp.added); ctx.say('added'); await ctx.wait(900); }
      if (sp.upgrade) { ctx.stamp('UPGRADED!', NAME.bonus2, 1500, null, 'hi'); ctx.SFX.upgrade(); CC.hero.mood('hype', 1800); await ctx.wait(1250); }
    }
    const got = ctx.run.t - run0; if (!b.capped && got !== b.winTenths) CC.dbg.mismatch.push({ what: 'bonus total', shown: got, script: b.winTenths });
    // finale
    ctx.onAdd = null; ctx.sceneEl.replaceChildren(); hud.hidden = true; ctx.st.pace = 1; (CC.dbg.spinT = CC.dbg.spinT || []).push(-(performance.now() | 0));
    if (ctx.willBig) { ctx.SFX.accepted(); CC.hero.mood('win', 3000); await ctx.wait(500); }   // the big-win overlay is the celebration; no second card before it
    else {
      ctx.SFX.accepted(); ctx.FX.coins(40); ctx.FX.confetti(25); CC.hero.mood('win', 3000);
      const end = document.createElement('div'); end.className = 'scn';
      end.innerHTML = '<h2></h2><div class="chips"><div class="chip set"><small>SPINS PLAYED</small><b></b></div><div class="chip set nm"><small>MODE</small><b></b></div></div><div class="chip set" style="width:100%"><small></small><b></b></div><div class="tap">TAP TO CONTINUE</div>';
      end.querySelector('h2').innerHTML = 'BONUS<br>COMPLETE'; const bs = end.querySelectorAll('b');
      bs[0].textContent = b.spins.length; bs[1].textContent = NAME[b.spins.length ? b.spins[b.spins.length - 1].mode : b.kind]; bs[2].textContent = ctx.dollars(ctx.cents(ctx.run.t)); end.querySelector('.chip[style] small').textContent = lbl;
      end.prepend(CC.hero.img('win', 'fin-hero')); ctx.sceneEl.replaceChildren(end); await ctx.waitTap(7000); ctx.FX.clear();
    }
    ctx.sceneEl.replaceChildren(); ctx.modeName = null; ctx.bonusOff();
  }

  CC.bonus = { run, makeDial, NAME };
})();
