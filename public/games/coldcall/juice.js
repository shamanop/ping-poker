/* COLD CALL FB6 juice: the parts of the motion CSS cannot reach (chris 10-06 FB6). Loaded by boot.js after ready (skipped with ?nojuice), changes no game file and no game state:
   it OBSERVES the DOM the game already builds (cells added to #reels, hit / sweep / pulse classes, #scene and #ov children, the big-win count-up) and adds effects that run ALONGSIDE the
   game's own animations. Nothing here is awaited by the game, so no spin, turbo spin or setBusy(false) gets longer. Effects are transform / opacity (Web Animations) and the existing
   CC.fx particle canvas (CC.fx.puff is the one new helper, fx.js). Reduced motion: no effects. TURBO / tap-to-skip: no dust, no board nudge, shorter squash.
     1 landing   squash + stretch of the symbol about its base when its drop ends, dust at the bottom row, a board nudge (Bender: landFx / bounce); phone and bell land heavy
     2 pop       smoke puffs where winning symbols vanish (Le Bandit's poof)
     3 bells     a ring + sparks the moment bells start to pulse (bonus trigger / tease)
     4 big win   the banner's impact (ring + shake) 300 ms in, the amount jitters while it counts (Bender: amtshake)
     5 bonus     flash + ring + sparks when the bonus intro card opens
     6 (r1)      idle fist-pump pose every ~3.4 s; ring at the winning cluster; pop shards + shake + smoke; big-win coin fountains + final slam
   Debug: CC.juice.on = false stops every effect at once. */
(() => {
  const CC = (window.CC = window.CC || {});
  if (CC.juice) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (id) => document.getElementById(id);
  const J = (CC.juice = { on: !reduce, landed: 0, puffs: 0, nudges: 0 });
  const K = () => CC.core, FX = () => CC.fx;
  const COLS = ColdCallEngine.COLS;
  const quick = () => { const s = K().st; return !!(s.turbo || s.skip); };   // turbo / tap-to-skip: the light version
  const ready = () => J.on && K() && FX();

  // ---------------------------------------------------------------- 1 landing
  const KF = {   // squash about the base (the pivot comes from .jland): wide + flat on impact, stretch up, settle (Bender landFx, scaled to a 64 px cell)
    light: [{ transform: 'scale(1.14,.8)' }, { transform: 'translateY(-5px) scale(.96,1.07)', offset: 0.4 }, { transform: 'scale(1.03,.98)', offset: 0.7 }, { transform: 'none' }],
    heavy: [{ transform: 'scale(1.26,.66)' }, { transform: 'translateY(-12px) scale(.92,1.14)', offset: 0.38 }, { transform: 'scale(1.07,.94)', offset: 0.66 }, { transform: 'none' }],
  };
  let lastNudge = 0;
  function nudge(px, force) {   // the whole board drops a few px and comes back (Bender bounce); throttled so a 6 column drop gives 2 or 3 nudges
    const now = performance.now(), b = $('board'); if (!b || (!force && now - lastNudge < 110)) return; lastNudge = now; J.nudges++;
    b.animate([{ transform: 'translateY(0)' }, { transform: `translateY(${px}px)`, offset: 0.35 }, { transform: 'translateY(0)' }], { duration: 200, composite: 'add', easing: 'ease-out' });
  }
  function land(el) {
    if (!ready() || !el.isConnected) return;
    const p = +el.dataset.p, row = Math.floor(p / COLS), heavy = el.dataset.s === 'phone' || el.dataset.s === 'bell', fast = quick();
    const img = el.querySelector('img.sym'); J.landed++;
    if (img) { img.classList.add('jland'); const a = img.animate(heavy ? KF.heavy : KF.light, { duration: (heavy ? 420 : 280) * (fast ? 0.5 : 1), easing: 'ease-out' }); a.finished.then(() => img.classList.remove('jland'), () => img.classList.remove('jland')); }
    if (fast || !FX().puff) return;
    if (heavy || row === 4) { const [x, y] = K().stagePt(el); FX().puff(x, y + 26, { n: heavy ? 4 : 2, spread: heavy ? 30 : 22, speed: heavy ? 110 : 70, r0: heavy ? 9 : 7, r1: heavy ? 26 : 19, c: '#d8ccb4', life: 0.45 }); if (heavy) FX().ring(x, y + 8, { n: 1, r1: 70, w: 8 }); }
    if (heavy) nudge(7, true); else if (row === 4) nudge(3);
  }
  const seen = new WeakSet();
  function watch(el) {   // a cell that starts to fall (spin drop, cascade refill, cascade shift): squash when that animation ends
    if (!el.classList || !el.classList.contains('cell') || !el.dataset.p) return;
    const own = el.getAnimations().filter((a) => !('animationName' in a) && !('transitionProperty' in a)); if (!own.length) return;
    const a = own[own.length - 1]; if (seen.has(a)) return; seen.add(a);
    a.addEventListener('finish', () => land(el), { once: true });
  }

  // ---------------------------------------------------------------- reels observer: 1 landing + 2 pop + 3 bells
  function reelsWatch(reels) {
    const mo = new MutationObserver((recs) => {
      if (!ready()) return;
      const pops = [], rings = [], hits = [];
      for (const m of recs) {
        if (m.type === 'childList') { m.addedNodes.forEach(watch); m.removedNodes.forEach((n) => { if (n.classList && (n.classList.contains('hit') || n.classList.contains('sweep'))) pops.push(n); }); }
        else if (m.type === 'attributes' && m.attributeName === 'style') watch(m.target);
        else if (m.type === 'attributes' && m.attributeName === 'class') { const t = m.target; if (t.classList.contains('hit') && !/\bhit\b/.test(m.oldValue || '')) hits.push(t); if (t.classList.contains('pulse') && !/\bpulse\b/.test(m.oldValue || '')) rings.push(t); }
      }
      if (hits.length && !quick()) hitRing(hits);
      if (pops.length && !quick()) popPuffs(reels, pops);
      if (rings.length) bellRings(rings);
    });
    mo.observe(reels, { childList: true, attributes: true, attributeFilter: ['style', 'class'], attributeOldValue: true, subtree: true });
  }
  // (r1) judge r0: 'it has glow, swell, popup and mascot reaction, but no ring, no dimming of losers, no counter punch.' (chris 10-06 FB6): a gold ring + stars from the middle of the winning cluster
  function hitRing(cells) {
    let sx = 0, sy = 0; for (const c of cells) { const [x, y] = K().stagePt(c); sx += x; sy += y; } const x = sx / cells.length, y = sy / cells.length;
    // (money-client item 4) a 2-3 cell win threw a 150 px ring (2nd ring 210 px) over most of the 540 px stage: the ring grows with the cluster, one thin ring for a small one
    const small = cells.length <= 4;
    FX().ring(x, y, { n: small ? 1 : 2, r1: 60 + Math.min(100, cells.length * 9), w: small ? 8 : 14 }); FX().burst(x, y, { n: 7, speed: 260, size: 8, shape: 'star', life: 0.7 });
  }
  function popPuffs(reels, nodes) {   // the popped cells are already out of the DOM: place the smoke from their left / top (relative to #reels) and #reels' own position on the stage
    const st = K().st, r = reels.getBoundingClientRect(), sr = K().stage.getBoundingClientRect(), ox = (r.left - sr.left) / st.s, oy = (r.top - sr.top) / st.s, half = 32;
    const step = Math.max(1, Math.ceil(nodes.length / 12));
    // (r1) judge r0: 'the sibling shakes then bursts into flying shards; the office game swaps to flat tiles and fades. The smoke puffs did not show in any frame.' (chris 10-06 FB6): the smoke is denser (a .34), and each popped cell throws 3 shards (<= 36), the board shakes with the size of the pop
    for (let i = 0; i < nodes.length; i += step) { const n = nodes[i]; const x = ox + (parseFloat(n.style.left) || 0) + half, y = oy + (parseFloat(n.style.top) || 0) + half; FX().puff(x, y, { n: 2, spread: 12, speed: 90, r0: 12, r1: 38, life: 0.6, a: 0.34, c: '#f6eedc' }); FX().burst(x, y, { n: 3, speed: 340, size: 10, life: 0.8, up: 120 }); J.puffs++; }
    FX().shake(Math.min(6, 2 + nodes.length / 4), 240);
  }
  function bellRings(cells) {
    const part = cells.slice(0, 6);
    for (const c of part) { const [x, y] = K().stagePt(c); FX().ring(x, y, { n: 1, r1: 80, w: 8 }); FX().burst(x, y, { n: 5, speed: 220, size: 6, shape: 'star' }); }
  }

  // ---------------------------------------------------------------- 4 big win + 5 bonus intro: #ov / #scene children
  function bigWinWatch(tier) {
    const t = setTimeout(() => { if (ready() && tier.isConnected) { FX().ring(270, 430, { n: 2, r1: 330, w: 20 }); FX().shake(8, 320); } }, 300 * (quick() ? 0.5 : 1));
    const a = tier.querySelector('.amt'); if (!a) return; let off = 0;
    // (r1) judge r0: 'after 0.4 s only the number changes, while the sibling keeps slamming, ringing and raining coins' (chris 10-06 FB6): while the number counts, a coin fountain + ring every 0.55 s (6 coins x 6 pulses = 36, under the 40 + 25 of the bonus-end burst);
    // when the count stops, one last ring + shake slams
    let pulses = 0, build = 0, slam = 0;
    if (!quick()) build = setInterval(() => { if (!ready() || !tier.isConnected || ++pulses > 6) { clearInterval(build); return; } FX().coins(6, { x: 270, y: 560, up: true }); FX().ring(270, 520, { n: 1, r1: 200 + pulses * 18, w: 12 }); FX().shake(3, 160); }, 550);
    const mo = new MutationObserver(() => { if (!J.on) return; a.classList.add('jshk'); clearTimeout(off); off = setTimeout(() => a.classList.remove('jshk'), 140); clearTimeout(slam); slam = setTimeout(() => { if (ready() && tier.isConnected && !quick()) { FX().ring(270, 520, { n: 2, r1: 340, w: 22 }); FX().shake(10, 400); } }, 160); });
    mo.observe(a, { childList: true, characterData: true, subtree: true });
    const gone = new MutationObserver(() => { if (!tier.isConnected) { clearTimeout(t); clearTimeout(off); clearTimeout(slam); clearInterval(build); mo.disconnect(); gone.disconnect(); } });
    gone.observe($('ov'), { childList: true });
  }
  function ovWatch() {
    new MutationObserver((recs) => { if (!ready()) return; for (const m of recs) m.addedNodes.forEach((n) => { if (n.id === 'tier') bigWinWatch(n); }); }).observe($('ov'), { childList: true });
    new MutationObserver((recs) => {
      if (!ready()) return;
      for (const m of recs) m.addedNodes.forEach((n) => { if (n.classList && n.classList.contains('scn') && n.classList.contains('rot')) { FX().flash(140, '#ffe9a8', 0.4); FX().ring(270, 430, { n: 2, r1: 300, w: 16 }); FX().burst(270, 430, { n: 16, speed: 520, size: 8 }); } });
    }).observe($('scene'), { childList: true });
  }

  // (r1) judge r0: 'the sibling mascot drinks and its bubble fades; the office game is frozen for 3 s.' (chris 10-06 FB6): a timed fist-pump pose for ~1.1 s about every 3.4 s, ONLY while nothing is going on
  // (no round, no card, not calm after 8 s of nobody there, turbo off); the pose says nothing about a result, and it never replaces a pose the game set
  function idlePose() {
    const s = K().st, app = $('app'); if (!ready() || !CC.hero || s.busy || s.modal || s.turbo || s.auto || app.classList.contains('calm') || document.hidden || CC.hero.cur() !== 'idle') return;
    CC.hero.mood('hype', 1100);
  }
  setTimeout(() => { idlePose(); setInterval(idlePose, 3400); }, 2000);

  const reels = $('reels'); if (!reels) return;
  reelsWatch(reels); ovWatch();
})();
