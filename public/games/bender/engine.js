/* BALLOT BENDER engine (derived from Swing State): pure math, no DOM. Used by the browser game and by sim/rtp.js.
   A spin is resolved up front into a "script" (steps the UI replays), like a real casino game server does.
   Grid g[c][r]: 6 columns x 5 rows, r=0 is the top row. Cell = {id, s, m}. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SwingEngine = root.BenderEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const COLS = 6, ROWS = 5, MIN_CLUSTER = 5, MAX_WIN_X = 10000;
  const REG = ['pen', 'stk', 'bal', 'yrd', 'meg', 'cap', 'phn', 'seal'];

  const CFG = {
    // cell weights for regular symbols; W and S added on top
    weights: { pen: 18, stk: 16, bal: 14, yrd: 12, meg: 8.5, cap: 6.5, phn: 4.5, seal: 3.0 },
    wildW: 1.1, scatterW: 2.0, bonusScatterW: 1.4,
    bonusWildW: 0.085,               // wild weight during free spins
    wildTable: [[2, 40], [3, 26], [4, 14], [5, 9], [8, 5], [10, 2], [15, 0.6]],
    bonusWildTable: [[2, 60], [3, 24], [4, 10], [6, 4], [8, 1.6], [12, 0.4]],
    guaranteeP: 0.083, maxSticky: 3, growCap: 6,   // a guaranteed sticky wild on ~1 in 12 bonus spins, at most 3 on the board; sticky wilds double 2>4>6 (maxSticky 4 made 10,000x too common and RTP lumpy)
    // payout x bet by cluster size bucket: 5,6,7,8,9,10-11,12-14,15-19,20+
    pay: {
      pen : [0.197, 0.301, 0.509, 0.8, 1.21, 2.02, 4.02, 13.9, 54.2],
      stk : [0.239, 0.364, 0.603, 0.997, 1.61, 2.41, 5.03, 18.9, 68.1],
      bal : [0.301, 0.436, 0.8, 1.31, 2.02, 3.22, 7.03, 27.7, 94.6],
      yrd : [0.405, 0.603, 1.1, 1.82, 2.82, 4.82, 10.3, 40.4, 136],
      meg : [0.603, 0.997, 1.82, 3.01, 5.03, 8.04, 17.8, 80.8, 271],
      cap : [0.904, 1.61, 3.01, 5.03, 8.04, 14, 31.8, 136, 488],
      phn : [1.4, 2.41, 5.03, 9.04, 14, 24.3, 59.8, 271, 949],
      seal: [2.41, 4.82, 10.3, 17.8, 29.9, 59.8, 151, 679, 2710],
    },
    scatterPay: { 3: 3.12, 4: 10.4, 5: 51.9, 6: 208 },
    spinsFor: { 3: 6, 4: 8, 5: 12, 6: 20 },
    retrigger: { 3: 3, 4: 5, 5: 8 }, maxSpins: 40,
    landslideStart: [[2]],   // pre-placed sticky wilds in LANDSLIDE (UI copy: starts with 1 wild planted)
    buyCost: { election: 5.4, landslide: 39.5 },   // 'election' = RECOUNT in the UI
    maxTumbles: 14,   // hard tumble cap per spin: sticky wilds wall the board and would otherwise chain 40 tumbles (tail variance)
  };
  const TIERS = [[100, 'worldisyours'], [50, 'megalandslide'], [25, 'ballotbender'], [10, 'closeenough'], [5, 'tasty'], [2, 'nice']];
  function winTier(winX) { for (const [x, name] of TIERS) if (winX >= x) return name; return 'none'; }
  const bucket = (n) => (n >= 20 ? 8 : n >= 15 ? 7 : n >= 12 ? 6 : n >= 10 ? 5 : n - 5);

  function rngFrom(seed) { // mulberry32
    let a = seed >>> 0;
    return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  function makeTables(cfg, bonus) {
    const syms = REG.slice(), w = REG.map((s) => cfg.weights[s]);
    syms.push('W', 'S'); w.push(bonus ? cfg.bonusWildW : cfg.wildW, bonus && cfg.bonusScatterW != null ? cfg.bonusScatterW : cfg.scatterW);
    const tot = w.reduce((a, b) => a + b, 0); const cum = []; let c = 0;
    for (let i = 0; i < w.length; i++) { c += w[i] / tot; cum.push(c); }
    const wt = bonus ? cfg.bonusWildTable : cfg.wildTable; const wtot = wt.reduce((a, b) => a + b[1], 0);
    return { syms, cum, wt, wtot };
  }

  function createEngine(cfg = CFG) {
    const T = { base: makeTables(cfg, false), bonus: makeTables(cfg, true) };
    let nextId = 1;

    function drawWildMult(rng, tb) { let x = rng() * tb.wtot; for (const [m, w] of tb.wt) { x -= w; if (x <= 0) return m; } return tb.wt[0][0]; }
    function drawCell(rng, tb, noScatter) {
      let r = rng(); let i = 0; while (i < tb.cum.length - 1 && r > tb.cum[i]) i++;
      let s = tb.syms[i];
      if (s === 'S' && noScatter) s = REG[Math.floor(rng() * 4)];
      return { id: nextId++, s, m: s === 'W' ? drawWildMult(rng, tb) : 0 };
    }

    function findClusters(g) {
      const out = [];
      for (const sym of REG) {
        const seen = Array.from({ length: COLS }, () => new Uint8Array(ROWS));
        for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
          if (seen[c][r] || g[c][r].s !== sym) continue;
          const stack = [[c, r]], cells = []; seen[c][r] = 1;
          while (stack.length) {
            const [x, y] = stack.pop(); cells.push([x, y]);
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || seen[nx][ny]) continue;
              const s = g[nx][ny].s; if (s !== sym && s !== 'W') continue;
              seen[nx][ny] = 1; stack.push([nx, ny]);
            }
          }
          if (cells.length < MIN_CLUSTER) continue;
          let wm = 0; for (const [x, y] of cells) if (g[x][y].s === 'W') wm += g[x][y].m;
          const mult = wm || 1;
          const base = cfg.pay[sym][bucket(cells.length)];
          out.push({ sym, cells, size: cells.length, mult, base, win: base * mult });
        }
      }
      return out;
    }

    // One spin: initial fill (keeping fixed wilds), then tumble until no cluster pays.
    // `fixed` = Map "c,r" -> wild cell that sticks (bonus). Returns script + the wild board for the next spin.
    function playSpin(rng, opts) {
      const bonus = !!opts.bonus, tb = bonus ? T.bonus : T.base, sticky = bonus;
      const g = Array.from({ length: COLS }, () => new Array(ROWS));
      const fixedIn = opts.fixed || [];
      let stuck = fixedIn.length;
      const draw = () => { const x = drawCell(rng, tb, false); if (sticky && x.s === 'W' && stuck < (cfg.maxSticky || 99)) { x.stick = true; stuck++; } return x; };
      for (const w of fixedIn) { w.cell.grew = false; w.cell.stick = true; g[w.c][w.r] = w.cell; }
      if (sticky && cfg.guaranteeP && stuck < (cfg.maxSticky || 99) && rng() < cfg.guaranteeP) {
        const free = []; for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) if (!g[c][r]) free.push([c, r]);
        const [c, r] = free[Math.floor(rng() * free.length)];
        g[c][r] = { id: nextId++, s: 'W', m: drawWildMult(rng, tb), stick: true }; stuck++;
      }
      const initial = [];
      for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) if (!g[c][r]) g[c][r] = draw();
      const snap = () => g.map((col) => col.map((x) => ({ ...x })));
      const script = { initial: snap(), steps: [], win: 0 };
      let capLeft = opts.capLeft == null ? Infinity : opts.capLeft;
      for (let t = 0; t < cfg.maxTumbles; t++) {
        const clusters = findClusters(g);
        if (!clusters.length) break;
        const stepWin = clusters.reduce((a, k) => a + k.win, 0);
        const kill = new Set(); const grow = new Set();
        for (const k of clusters) for (const [c, r] of k.cells) {
          if (g[c][r].stick) grow.add(c + ',' + r); else kill.add(c + ',' + r);
        }
        // sticky wilds in a paying cluster double after it pays
        const grown = [];
        for (const key of grow) { const [c, r] = key.split(',').map(Number); const w = g[c][r]; if (w.grew) continue; w.grew = true; const to = Math.max(w.m, Math.min(w.m * 2, cfg.growCap || 512)); if (to !== w.m) { grown.push({ c, r, from: w.m, to }); w.m = to; } }
        // gravity per column, treating sticky wilds as walls
        const fall = [], spawn = [];
        for (let c = 0; c < COLS; c++) {
          let r = ROWS - 1;
          while (r >= 0) {
            if (g[c][r].stick) { r--; continue; }
            let top = r; while (top - 1 >= 0 && !g[c][top - 1].stick) top--;
            // segment top..r
            const keep = []; for (let y = r; y >= top; y--) if (!kill.has(c + ',' + y)) keep.push({ cell: g[c][y], from: y });
            const need = r - top + 1 - keep.length;
            const newCells = []; for (let i = 0; i < need; i++) newCells.push(draw());
            let y = r;
            for (const k of keep) { if (k.from !== y) fall.push({ id: k.cell.id, c, from: k.from, to: y }); g[c][y] = k.cell; y--; }
            const above = top === 0;
            for (let i = 0; i < newCells.length; i++, y--) { g[c][y] = newCells[i]; spawn.push({ c, r: y, cell: { ...newCells[i] }, fromTop: above, order: i }); }
            r = top - 1;
          }
        }
        const win = Math.min(stepWin, capLeft);
        capLeft -= win; script.win += win;
        script.steps.push({ clusters: clusters.map((k) => ({ sym: k.sym, cells: k.cells, size: k.size, mult: k.mult, base: k.base, win: k.win })), stepWin: win, uncapped: stepWin, killed: [...kill], grown, fall, spawn, grid: snap() });
        if (capLeft <= 0) { script.capped = true; break; }
      }
      script.final = snap();
      let sc = 0; for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) if (g[c][r].s === 'S') sc++;
      script.scatters = sc;
      script.wilds = []; for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) if (g[c][r].stick) script.wilds.push({ c, r, cell: g[c][r] });
      return script;
    }

    function playBonus(rng, kind, scatters, capLeft) {
      let spins = cfg.spinsFor[Math.min(Math.max(scatters, 3), 6)];
      if (kind === 'landslide' && scatters < 4) spins = cfg.spinsFor[4];
      const out = { kind, spins: [], total: 0, startSpins: spins };
      capLeft = Math.max(0, capLeft);
      if (capLeft <= 0) { out.capped = true; out.startWilds = []; return out; }
      let fixed = [];
      if (kind === 'landslide') {
        const cells = []; for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) cells.push([c, r]);
        for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
        fixed = cfg.landslideStart.map(([m], i) => ({ c: cells[i][0], r: cells[i][1], cell: { id: nextId++, s: 'W', m } }));
      }
      out.startWilds = fixed.map((w) => ({ c: w.c, r: w.r, cell: { ...w.cell } }));
      let left = spins, i = 0;
      while (left > 0 && i < 80) {
        left--; i++;
        const s = playSpin(rng, { bonus: true, fixed, capLeft });
        s.spinLeft = left;
        fixed = s.wilds;
        out.total += s.win; capLeft -= s.win; out.spins.push(s);
        if (s.scatters >= 3 && out.startSpins + (out.added || 0) < cfg.maxSpins) {
          const add = cfg.retrigger[Math.min(s.scatters, 5)]; left += add; out.added = (out.added || 0) + add; s.retrigger = add;
        }
        if (capLeft <= 0) { out.capped = true; break; }
      }
      return out;
    }

    // Full paid round. mode: 'spin' | 'buy-election' | 'buy-landslide'. All wins in x bet.
    function round(rng, mode, force) {
      const res = { mode, cost: 1, win: 0, base: null, bonus: null, scatterPay: 0 };
      if (mode === 'buy-election' || mode === 'buy-landslide') {
        const kind = mode === 'buy-election' ? 'election' : 'landslide';
        res.cost = cfg.buyCost[kind];
        res.bonus = playBonus(rng, kind, 3, MAX_WIN_X);
        res.win = res.bonus.total; res.maxed = !!res.bonus.capped; return res;
      }
      let base = playSpin(rng, { bonus: false, capLeft: MAX_WIN_X });
      if (force === 'bonus' && base.scatters < 3) {
        // demo/QA hook: re-roll until the spin lands a bonus (never used by real play)
        for (let k = 0; k < 4000 && base.scatters < 3; k++) base = playSpin(rng, { bonus: false, capLeft: MAX_WIN_X });
      }
      res.base = base; res.win = base.win;
      if (base.scatters >= 3) {
        const n = Math.min(base.scatters, 6);
        res.scatterPay = cfg.scatterPay[n]; res.win += res.scatterPay;
        const left = MAX_WIN_X - res.win;   // already at the cap after base + scatter pay: no bonus is played (UI sees no bonus, round is maxed)
        if (left > 0) { res.bonus = playBonus(rng, n >= 4 ? 'landslide' : 'election', n, left); res.win += res.bonus.total; }
      }
      if (res.win >= MAX_WIN_X) { res.win = MAX_WIN_X; res.maxed = true; }
      return res;
    }

    return { round, playSpin, playBonus, findClusters, cfg, REG };
  }

  return { createEngine, rngFrom, winTier, TIERS, CFG, COLS, ROWS, REG, MIN_CLUSTER, MAX_WIN_X };
});
