/* COLD CALL "pick a number" (chris 10-06 FB3). Replaces the rotary dial of the bonus intro (it did not answer a mouse drag on a PC).
   It is a REVEAL, not a choice: the script already holds the digit (1, 2 or 3 = the bonus). Whatever key the player presses lights and shows the script's digit;
   the other keys are never shown as anything else. Nobody touching it for 25 s: it presses the script's key itself; AUTO: 0.7 s; the SPIN button / Space (CC.bonus.poke) too.
   Hooks kept for the drivers: root class .dial and el._finish() (same path as a tap). Keyboard: 0-9 press that key, Enter presses the focused key (or places the call).
   All HTML/CSS, no rAF, no image; the art slots are CSS variables in ui.css. Sound: the existing SFX click / stop (audio.js is synthesized and stays untouched). */
(() => {
  const CC = (window.CC = window.CC || {});
  const IDLE_MS = 25000, AUTO_MS = 700;                              // (chris 10-06 FB3) same timings as the dial had
  const LAYOUT = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];                       // desk phone: 1-9, then 0 under the 8
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function make(ctx) {
    const el = document.createElement('div'); el.className = 'dial hint'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Pick a number. The number is already set; any key places the call.');
    el.innerHTML = '<div class="lcd" aria-live="polite"><small>THE NUMBER</small><b>_</b></div><div class="keys"></div>';
    const keys = el.querySelector('.keys'), lcd = el.querySelector('.lcd b'), byK = {};
    LAYOUT.forEach((v) => {
      const k = document.createElement('button'); k.type = 'button'; k.className = 'key' + (v === 0 ? ' zero' : ''); k.dataset.k = v; k.setAttribute('aria-label', 'Number ' + v);
      k.innerHTML = '<b>' + v + '</b>'; keys.appendChild(k); byK[v] = k;
    });
    const sp_ = () => (ctx.st.skip ? 0.3 : ctx.st.turbo ? 0.5 : 1);
    // digit: the script's digit. Resolves after the digit has landed and been shown for a beat.
    function spin(digit) {
      return new Promise((resolve) => {
        let done = false, autoT = 0; const poke = () => finish(null);
        const finish = async (pressed) => {
          if (done) return; done = true; clearTimeout(autoT); if (CC.bonus.poke === poke) CC.bonus.poke = null;
          document.removeEventListener('keydown', onKey, true); el.removeEventListener('click', onClick);
          const k = pressed && pressed.classList && pressed.classList.contains('key') ? pressed : byK[digit];   // nobody pressed one (timer, SPIN, Enter): the script's own key
          el.classList.remove('hint'); el.classList.add('done'); el.querySelectorAll('.key').forEach((b) => { b.tabIndex = -1; });
          k.classList.add('lit'); ctx.SFX.click(); ctx.SFX.dialStop();
          setTimeout(() => { k.querySelector('b').textContent = digit; lcd.textContent = digit; lcd.classList.add('land'); }, reduce() ? 0 : 110 * sp_());   // the face turns over to the script's digit
          await ctx.wait(reduce() ? 500 : 800);
          resolve();
        };
        const onClick = (e) => { const k = e.target.closest && e.target.closest('.key'); finish(k || null); };   // a tap on the plate between the keys places the call too
        const onKey = (e) => {
          if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
          if (/^[0-9]$/.test(e.key)) { e.preventDefault(); e.stopPropagation(); finish(byK[e.key]); }
          else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); const f = document.activeElement; finish(f && f.classList && f.classList.contains('key') && el.contains(f) ? f : null); }
        };
        el.addEventListener('click', onClick); document.addEventListener('keydown', onKey, true);
        autoT = setTimeout(() => finish(null), ctx.st.auto ? AUTO_MS : IDLE_MS);   // nobody touching it: it places the call itself, the round never waits forever
        CC.bonus.poke = poke;                                                         // the SPIN button / Space during the intro places the call too
        el._finish = () => finish(null);                                              // test / accessibility hook: same path as a tap
      });
    }
    return { el, spin };
  }

  // the info screen says it in plain words (the info card is built in game.js; this adds one paragraph after it opens, so game.js stays untouched)
  const INFO = '<p><b>Pick a number.</b> At the start of a bonus you press a number key to place the call. The number is set before you press: any key shows the same number, and it decides nothing.</p>';
  const ov = document.getElementById('ov');
  if (ov) new MutationObserver((ms) => {
    for (const m of ms) for (const n of m.addedNodes) {
      const c = n.nodeType === 1 && n.querySelector && n.querySelector('.card.info'); if (!c || c.querySelector('.padinfo')) continue;
      const tl = c.querySelector('p.tl'), box = document.createElement('div'); box.className = 'padinfo'; box.innerHTML = INFO; if (tl) c.insertBefore(box, tl); else c.insertBefore(box, c.lastElementChild);
    }
  }).observe(ov, { childList: true });

  CC.keypad = { make, INFO };
})();
