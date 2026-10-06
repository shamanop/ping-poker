/* COLD CALL board: the 6x5 grid and the cascade replay. It ANIMATES a SpinScript (cold-call/ENGINE-V2.md) and decides nothing:
   every symbol, position, hot lead and amount comes from the script. Cells are absolutely placed (left/top set once, never animated);
   all motion is transform/opacity (Web Animations). Hot leads are sticky-note squares under the symbols (the 30 `.slots i`): a mark belongs to
   the square, so it stays while symbols fall. Everything a step creates is removed when the step ends. */
(() => {
  const CC = (window.CC = window.CC || {});
  const E = ColdCallEngine, COLS = E.COLS, ROWS = E.ROWS, N = E.N, SYM = E.SYM;
  const $ = (id) => document.getElementById(id);
  const css = getComputedStyle(document.documentElement);
  const num = (v, d) => { const n = parseFloat(css.getPropertyValue(v)); return Number.isFinite(n) ? n : d; };
  const CELL = num('--cell', 78), GAP = num('--gap', 3), PITCH = CELL + GAP, PAD = num('--pad', 8);
  const K = () => CC.core, SFX = () => K().SFX;
  const cells = new Array(N).fill(null), hot = new Set();
  let slots, reelsEl, ovl;
  const xy = (p) => [PAD + (p % COLS) * PITCH, PAD + ((p / COLS) | 0) * PITCH];
  const col = (p) => p % COLS;
  const A = (el, kf, o) => { const a = el.animate(kf, { fill: 'none', ...o, duration: (o.duration || 300) * K().speed(), delay: (o.delay || 0) * K().speed() }); return a.finished.catch(() => {}); };

  function mk(id) { const c = document.createElement('div'); c.className = 'cell'; c.dataset.s = SYM[id]; c.appendChild(CC.assets.img(SYM[id], 'sym')); return c; }
  function put(el, p) { const [x, y] = xy(p); el.style.left = x + 'px'; el.style.top = y + 'px'; el.dataset.p = p; cells[p] = el; }

  function build() {
    slots = $('slots'); reelsEl = $('reels'); ovl = $('ovl');
    slots.replaceChildren(...Array.from({ length: N }, (_, p) => { const i = document.createElement('i'); i.style.setProperty('--rot', ((p * 7) % 5 - 2) * 0.9 + 'deg'); return i; }));
    reelsEl.replaceChildren(); ovl.replaceChildren(); cells.fill(null); hot.clear();
  }
  function show(grid) { reelsEl.replaceChildren(); cells.fill(null); grid.forEach((id, p) => { const el = mk(id); put(el, p); reelsEl.appendChild(el); }); }
  function idle() {                                           // decorative start grid: regular symbols only
    const g = []; for (let p = 0; p < N; p++) g.push((Math.random() * E.NREG) | 0); show(g);
  }

  // ------------------------------------------------------------------ hot leads (sticky-note squares)
  function lightHot(p, delay = 0) { if (hot.has(p)) return; hot.add(p); const s = slots.children[p]; s.style.setProperty('--d', delay + 'ms'); s.classList.add('hot'); }
  function dropHot(p) { if (!hot.delete(p)) return; const s = slots.children[p]; s.classList.remove('hot'); s.classList.add('cool'); setTimeout(() => s.classList.remove('cool'), 320 * K().speed()); }
  // make the lit squares exactly `list` (no animation of the ones that stay)
  function setHot(list, quiet) { const want = new Set(list); [...hot].forEach((p) => { if (!want.has(p)) dropHot(p); }); list.forEach((p) => { if (!hot.has(p)) { if (quiet) { hot.add(p); slots.children[p].classList.add('hot', 'still'); } else lightHot(p); } }); }
  function clearHot() { [...hot].forEach(dropHot); }
  const hotList = () => [...hot].sort((a, b) => a - b);

  // ------------------------------------------------------------------ the spin-in: old symbols fall out, new ones drop in, column by column
  async function drop(grid, o = {}) {
    const old = cells.slice(), fast = o.fast ? 0.8 : 1, ps = [];
    cells.fill(null);
    for (let c = 0; c < COLS; c++) {
      const d = c * 70 * fast, heavy = [];
      for (let r = 0; r < ROWS; r++) {
        const p = r * COLS + c, ol = old[p];
        if (ol) { ps.push(A(ol, [{ transform: 'none', opacity: 1 }, { transform: `translateY(${(ROWS + 1) * PITCH}px)`, opacity: 0 }], { duration: 230 * fast, delay: d, easing: 'cubic-bezier(.5,0,.9,.5)' }).then(() => ol.remove())); }
        const el = mk(grid[p]); put(el, p); reelsEl.appendChild(el);
        if (grid[p] === E.PHONE || grid[p] === E.BELL) heavy.push(p);
        ps.push(A(el, [{ transform: `translateY(${-(ROWS + 1) * PITCH}px)`, opacity: 1 }, { transform: 'translateY(5px)', offset: 0.82, opacity: 1 }, { transform: 'none', opacity: 1 }], { duration: 300 * fast, delay: d + 90 * fast + (ROWS - 1 - r) * 26 * fast, fill: 'backwards', easing: 'cubic-bezier(.3,.7,.4,1)' }));
      }
      setTimeout(() => { SFX().land(heavy.length > 0); if (heavy.length) SFX().thunk(); }, (d + 90 * fast + 4 * 26 * fast + 300 * fast) * K().speed());
    }
    await Promise.all(ps);
    [...reelsEl.children].forEach((n) => { if (!cells.includes(n)) n.remove(); });
  }

  // ------------------------------------------------------------------ one cascade step
  const centre = (el) => K().localPt(el, K().board);
  async function step(s, i, ctx) {
    const win = new Set(); s.wins.forEach((w) => w.pos.forEach((p) => win.add(p)));
    const fresh = s.hot.filter((p) => !hot.has(p));
    // 1. pulse the clusters, show their pay, light the new hot leads
    win.forEach((p) => cells[p].classList.add('hit'));
    fresh.forEach((p, k) => lightHot(p, Math.min(k * 28, 420)));
    SFX().clusterPop(i); if (fresh.length) setTimeout(() => SFX().hot(fresh.length), 120 * K().speed());
    for (const w of s.wins) {
      let sx = 0, sy = 0; w.pos.forEach((p) => { const [x, y] = centre(cells[p]); sx += x; sy += y; });
      K().floatAt(Math.min(430, Math.max(90, sx / w.pos.length)), sy / w.pos.length, `<span>+${K().dollars(ctx.cents(w.pay))}</span>`);
    }
    await K().wait(220);
    // 2. the cluster pops; the same-type sweep is flagged and goes a beat later
    const sweepP = s.removed.filter((p) => !win.has(p)), gone = [];
    const addP = ctx.addWin(s.pay, 380);
    win.forEach((p) => { const el = cells[p]; cells[p] = null; gone.push(A(el, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.22)', opacity: 1, offset: 0.3 }, { transform: 'scale(.1)', opacity: 0 }], { duration: 160, easing: 'ease-in' }).then(() => el.remove())); const [x, y] = K().stagePt(el); if (i % 2 === 0 || win.size < 9) K().FX.burst(x, y, { n: 3, speed: 200, size: 6, life: 0.5 }); });
    if (sweepP.length) {
      sweepP.forEach((p) => cells[p].classList.add('sweep')); SFX().sweep(); await K().wait(170);
      sweepP.forEach((p, k) => { const el = cells[p]; cells[p] = null; gone.push(A(el, [{ transform: 'none', opacity: 1 }, { transform: 'translateY(-10px) rotate(-14deg) scale(1.1)', opacity: 1, offset: 0.35 }, { transform: 'translateY(-20px) rotate(24deg) scale(.1)', opacity: 0 }], { duration: 190, delay: Math.min(k * 12, 120), easing: 'ease-in' }).then(() => el.remove())); });
    }
    await Promise.all(gone);
    // 3. what is left falls, new symbols drop in from the top
    const moved = s.falls.map(([f, t]) => [cells[f], f, t]); moved.forEach(([, f]) => { cells[f] = null; });
    const ps = [], nf = new Array(COLS).fill(0); s.fresh.forEach(([p]) => nf[col(p)]++);
    for (const [el, f, t] of moved) { put(el, t); const dy = ((t - f) / COLS) * PITCH; ps.push(A(el, [{ transform: `translateY(${-dy}px)` }, { transform: 'translateY(3px)', offset: 0.85 }, { transform: 'none' }], { duration: 110 + 36 * ((t - f) / COLS), easing: 'cubic-bezier(.4,.1,.6,1)' })); }
    for (const [p, id] of s.fresh) { const el = mk(id); put(el, p); reelsEl.appendChild(el); const dy = nf[col(p)] * PITCH; ps.push(A(el, [{ transform: `translateY(${-dy}px)`, opacity: 1 }, { transform: 'translateY(3px)', offset: 0.85, opacity: 1 }, { transform: 'none', opacity: 1 }], { duration: 130 + 36 * nf[col(p)], fill: 'backwards', easing: 'cubic-bezier(.4,.1,.6,1)' })); }
    SFX().fall();
    await Promise.all([...ps, addP]);
    // the screen must now equal the script
    const dom = domGrid(); for (let p = 0; p < N; p++) if (dom[p] !== SYM[s.grid[p]]) { CC.dbg.mismatch.push({ what: 'step grid', step: i, p, shown: dom[p], script: SYM[s.grid[p]] }); break; }
    const hl = hotList(); if (hl.join() !== s.hot.join()) CC.dbg.mismatch.push({ what: 'step hot', step: i, shown: hl, script: s.hot });
  }

  const domGrid = () => cells.map((el) => (el ? el.dataset.s : null));
  const cellsOf = (name) => cells.map((el, p) => (el && el.dataset.s === name ? p : -1)).filter((p) => p >= 0);
  const el = (p) => cells[p];
  function pulse(name, on = true) { cellsOf(name).forEach((p) => cells[p].classList.toggle('pulse', on)); }
  function clean() {                                          // after a round: exactly 30 cells, nothing else
    ovl.replaceChildren(); [...reelsEl.children].forEach((n) => { if (!cells.includes(n)) n.remove(); });
    cells.forEach((c) => c && c.classList.remove('hit', 'dim', 'pulse', 'sweep', 'under')); clearHot();
    slots.querySelectorAll('i').forEach((s) => s.classList.remove('hot', 'cool', 'still'));
  }
  const state = () => ({ cells: reelsEl.children.length, ovl: ovl.children.length, hot: slots.querySelectorAll('i.hot').length });

  CC.board = { build, show, idle, drop, step, setHot, clearHot, hotList, cellsOf, el, pulse, clean, state, domGrid, xy, A, ovl: () => ovl, CELL, PITCH, PAD };
})();
