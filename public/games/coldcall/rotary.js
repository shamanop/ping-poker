/* ROTARY bonus (free spins). The server already chose the free-spin count and the multiplier; the dial only REVEALS them: whatever the
   player drags or taps, the dial stops where the script says. Dial is all HTML/CSS (no image); drag = pointer events (no rAF). */
(() => {
  const CC = (window.CC = window.CC || {});
  const STEP = 28, STOP = 135, R = 100;                       // degrees between holes; finger stop at 135 deg clockwise from 12 o'clock; hole ring radius px
  const holeAngle = (i) => STOP - (i + 1) * STEP;             // hole i sits (i+1) steps counter-clockwise of the stop; drag it clockwise to the stop

  function makeDial(values, label, ctx) {
    const el = document.createElement('div'); el.className = 'dial hint'; el.setAttribute('role', 'button'); el.tabIndex = 0; el.setAttribute('aria-label', 'Rotary dial. Drag or tap to spin.');
    el.innerHTML = '<div class="ring"></div><div class="plate"></div><div class="hub"></div><div class="stop"></div>';
    const plate = el.querySelector('.plate'), hub = el.querySelector('.hub'), stop = el.querySelector('.stop');
    values.forEach((v, i) => { const h = document.createElement('div'); h.className = 'hole'; h.style.transform = `rotate(${holeAngle(i)}deg) translateY(-${R}px)`; const sp = document.createElement('span'); sp.style.transform = `rotate(${-holeAngle(i)}deg)`; sp.textContent = label(v); h.appendChild(sp); plate.appendChild(h); });
    stop.style.transform = `rotate(${STOP}deg) translateY(-${R + 42}px)`; hub.textContent = 'CALL';
    let rot = 0;
    const setRot = (d) => { rot = d; plate.style.transform = `rotate(${d}deg)`; };
    const turn = async (from, to, ms, easing) => { const a = plate.animate([{ transform: `rotate(${from}deg)` }, { transform: `rotate(${to}deg)` }], { duration: Math.max(1, ms * (ctx.st.skip ? 0.3 : ctx.st.turbo ? 0.5 : 1)), easing, fill: 'forwards' }); await a.finished.catch(() => {}); setRot(to); a.cancel(); };
    // idx: index of the server's value. Resolves after the dial has returned home.
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
          for (let i = 0; i < idx + 1; i++) setTimeout(() => ctx.SFX.dialTick(), (back * (i + 0.5) / (idx + 1)) * (ctx.st.skip ? 0.3 : ctx.st.turbo ? 0.5 : 1));
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

  async function run(f, ctx) {
    const E = ctx.E, { bet } = ctx;
    // 1. trigger: the three phones ring
    ctx.say('rotary'); ctx.SFX.sting(); ctx.SFX.ringing();
    for (let c = 0; c < E.COLS; c++) for (let r = 0; r < E.ROWS; r++) { const el = ctx.cellEl(c, r); if (el && el.dataset.s === 'phone') el.classList.add('pulse'); }
    ctx.stamp('CALLBACK!', 'ROTARY', 1500); ctx.FX.shake(6, 350); await ctx.wait(1500); ctx.clearHits();
    // 2. the dial scene: two stops
    const scn = document.createElement('div'); scn.className = 'scn rot';
    scn.innerHTML = '<h2>ROTARY</h2><p class="sub" id="rSub"></p><div id="rHost"></div><div class="chips"><div class="chip" id="chS"><small>FREE SPINS</small><b>-</b></div><div class="chip" id="chM"><small>MULTIPLIER</small><b>-</b></div></div><div class="tap" id="rTap"></div>';
    ctx.sceneEl.replaceChildren(scn);
    const sub = scn.querySelector('#rSub'), host = scn.querySelector('#rHost'), tap = scn.querySelector('#rTap');
    const stops = [
      { vals: E.CFG.dialSpins.map((x) => x[0]), want: f.dial.spins, chip: scn.querySelector('#chS'), label: (v) => String(v), text: 'Drag the dial to the stop, or tap it', unit: '' },
      { vals: E.CFG.dialMult.map((x) => x[0]), want: f.dial.mult, chip: scn.querySelector('#chM'), label: (v) => 'x' + v, text: 'Once more for the multiplier', unit: 'x' }
    ];
    for (const s of stops) {
      sub.textContent = s.text; tap.textContent = 'SPIN THE DIAL';
      let idx = s.vals.indexOf(s.want.value); if (idx < 0) idx = Math.max(0, Math.min(s.vals.length - 1, s.want.hole));   // the script's value wins
      const d = makeDial(s.vals, s.label, ctx); host.replaceChildren(d.el);
      await d.spin(idx);
      const b = s.chip.querySelector('b'); b.textContent = (s.unit || '') + s.want.value; s.chip.classList.add('set'); ctx.SFX.register(); ctx.FX.burst(...ctx.stagePt(s.chip), { n: 14, speed: 260 });
      tap.textContent = ''; await ctx.wait(900);
    }
    sub.textContent = `${f.startSpins} free spins at x${f.mult}`; tap.textContent = ''; await ctx.wait(1100);
    // 3. free spins
    ctx.sceneEl.replaceChildren(); ctx.bonusOn();
    let total = f.startSpins, leftBefore = f.startSpins;
    for (const sp of f.spins) {
      ctx.rib(`FREE SPIN ${sp.n}/${total}`, `x${f.mult}  |  ${leftBefore} left`); ctx.SFX.spin(); if (sp.n === 1 || Math.random() < 0.3) ctx.say('freeSpin');
      await ctx.spinGrid(sp.grid, {});
      if (sp.winTenths > 0 || (sp.wins && sp.wins.length)) {
        await ctx.presentWins(sp.wins, f.mult, ctx); await ctx.addWin(sp.winTenths, 450); await ctx.wait(650); ctx.clearHits();
      } else await ctx.wait(250);
      if (sp.added > 0) {
        total += sp.added; ctx.stamp(`+${sp.added} SPIN${sp.added > 1 ? 'S' : ''}`, 'CALLBACK', 1100); ctx.SFX.chime(4); ctx.SFX.phone(0);
        ctx.rib(`FREE SPIN ${sp.n}/${total}`, `x${f.mult}  |  ${sp.left} left`); await ctx.wait(1000);
      }
      ctx.clearHits(); leftBefore = sp.left;
    }
    // 4. finale
    if (!(ctx.willBig && ctx.isLast)) {
      ctx.SFX.accepted(); ctx.FX.coins(40); ctx.FX.confetti(25);
      const end = document.createElement('div'); end.className = 'scn';
      end.innerHTML = '<h2>ROTARY<br>COMPLETE</h2><div class="chips"><div class="chip set"><small>SPINS PLAYED</small><b></b></div><div class="chip set"><small>MULTIPLIER</small><b></b></div></div><div class="chip set" style="width:100%"><small>TOTAL WIN</small><b></b></div><div class="tap">TAP TO CONTINUE</div>';
      const bs = end.querySelectorAll('b'); bs[0].textContent = total; bs[1].textContent = 'x' + f.mult; bs[2].textContent = ctx.dollars(ctx.cents(ctx.run.t));
      ctx.sceneEl.replaceChildren(end); await ctx.waitTap(7000); CC.fx.clear();
    }
    ctx.sceneEl.replaceChildren(); ctx.bonusOff(); ctx.rib('3+ in a row, left to right', 'MAX ' + E.MAX_WIN_X.toLocaleString('en-US') + 'x');
  }
  CC.rotary = { run, makeDial };
})();
