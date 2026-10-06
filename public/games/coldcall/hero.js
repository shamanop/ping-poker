/* Hero moods. The hero image is always the same 434 px square canvas (feet on the same baseline), so swapping the src never moves the box;
   only the mouth point changes, and the speech tail is refitted to it. All mood art is decoded in the splash (assets.js), the swap is instant.
   set(mood, ms): show a mood and fall back to idle after ms (ms = 0 stays; a later call wins). */
(() => {
  const CC = (window.CC = window.CC || {});
  let cur = 'idle', t = 0;
  const show = (m) => {
    const el = document.getElementById('hero'); if (!el || !CC.assets || !CC.assets.ready) return;
    cur = m; el.src = CC.assets.moodUrl(m); el.dataset.mood = m; if (CC.caption) CC.caption.fit();
  };
  function set(m, ms = 1600) { clearTimeout(t); if (CC.dbg && m !== 'idle') (CC.dbg.moods = CC.dbg.moods || []).push({ r: CC.dbg.started || 0, m }); show(m); if (m !== 'idle' && ms > 0) t = setTimeout(() => show('idle'), ms); }
  function img(m, cls) { const im = document.createElement('img'); im.src = CC.assets.moodUrl(m); im.alt = ''; im.draggable = false; im.decoding = 'sync'; if (cls) im.className = cls; return im; }
  const HOLD = { idle: 0, hype: 2000, shock: 2200, rage: 2400, win: 3000 };
  // one call for the game/board code: CC.hero.mood('shock') (default hold per mood, or pass ms)
  const mood = (m, ms) => set(m, ms == null ? HOLD[m] : ms);
  CC.hero = { set, mood, img, cur: () => cur };
})();
