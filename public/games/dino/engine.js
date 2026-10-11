/* DINO engine (pay-anywhere tumble slot, forked from the Ballot Bender engine structure): pure math, no DOM. Used by the browser game and by sim/rtp.
   A spin is resolved up front into a "script" (steps the UI replays). Payload format: _dino/SCRIPT-FORMAT.md.
   Grid g[c][r]: 6 columns x 5 rows, r=0 is the top row. Cell = {id, s, m} (m = bomb multiplier on a 'B' cell, else 0). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DinoEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const COLS = 6, ROWS = 5, MIN_PAY = 8, MAX_WIN_X = 10000;
  const REG = ['h1', 'h2', 'h3', 'h4', 'l1', 'l2', 'l3', 'l4', 'l5'];   // ranked, h1 highest

  const CFG = {
    // cell weights for regular symbols; S (and B in free spins) added on top
    weights: { h1: 5, h2: 6, h3: 7, h4: 8, l1: 10, l2: 11, l3: 13, l4: 15, l5: 17 },
    bonusWeights: { h1: 5, h2: 6, h3: 7, h4: 8, l1: 10, l2: 12, l3: 15, l4: 18, l5: 22 },   // free-spin board: lows heavier, so more tumble chains under the bombs
    scatterW: 1.615, anteScatterW: 1.975, bonusScatterW: 1.0,
    bombW: 1.84,                                  // bomb weight per cell draw, free spins only
    bombTable: [[2, 80], [3, 62], [4, 52], [5, 46], [7, 42], [9, 38], [11, 34], [14, 30], [18, 26], [22, 22], [30, 18], [45, 12], [75, 7], [100, 5]],   // [value, weight]: our own set, 2x-100x
    // payout x total bet by count bucket: 8-9, 10-11, 12+
    pay: {
      h1: [16, 40, 450], h2: [8, 20, 230], h3: [5, 12, 140], h4: [3.2, 8, 80],
      l1: [2.4, 5, 45], l2: [1.8, 3.6, 32], l3: [1.2, 2.8, 22], l4: [0.9, 2.2, 16], l5: [0.6, 1.6, 11],
    },
    scatterPay: { 4: 2.5, 5: 6, 6: 60 },          // 4+ scatters anywhere at the end of a spin's tumbles
    fsScatterPay: true,                           // scatter pays also apply in free spins (not multiplied by bombs)
    freeSpins: 10, retriggerMin: 3, retriggerAdd: 5, maxSpins: 100,
    buyCost: 100, buyScatters: [[4, 85], [5, 13], [6, 2]],
    anteCost: 1.25,
    maxTumbles: 60,                               // safety stop; pay-anywhere chains end long before this
  };
  // big-win banner tiers by total round win in x bet (placeholder names)
  const TIERS = [[100, 'epic'], [50, 'mega'], [25, 'huge'], [10, 'big'], [5, 'great'], [2, 'nice']];
  function winTier(winX) { for (const [x, name] of TIERS) if (winX >= x) return name; return 'none'; }
  const bucket = (n) => (n >= 12 ? 2 : n >= 10 ? 1 : 0);

  function rngFrom(seed) { // mulberry32
    let a = seed >>> 0;
    return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // kind: 'base' | 'ante' | 'bonus' | 'fill' (regular symbols only: the buy's first board before its scatters are placed)
  function makeTable(cfg, kind) {
    const syms = REG.slice(), w = REG.map((s) => (kind === 'bonus' ? cfg.bonusWeights : cfg.weights)[s]);
    if (kind !== 'fill') { syms.push('S'); w.push(kind === 'ante' ? cfg.anteScatterW : kind === 'bonus' ? cfg.bonusScatterW : cfg.scatterW); }
    if (kind === 'bonus') { syms.push('B'); w.push(cfg.bombW); }
    const tot = w.reduce((a, b) => a + b, 0); const cum = []; let c = 0;
    for (let i = 0; i < w.length; i++) { c += w[i] / tot; cum.push(c); }
    cum[cum.length - 1] = 1;
    return { syms, cum };
  }
  const tableTotal = (t) => t.reduce((a, b) => a + b[1], 0);
  function pickWeighted(rng, t, tot) { let x = rng() * tot; for (const [v, w] of t) { x -= w; if (x < 0) return v; } return t[t.length - 1][0]; }

  function createEngine(cfg = CFG) {
    const T = { base: makeTable(cfg, 'base'), ante: makeTable(cfg, 'ante'), bonus: makeTable(cfg, 'bonus'), fill: makeTable(cfg, 'fill') };
    const bombTot = tableTotal(cfg.bombTable), buyScTot = tableTotal(cfg.buyScatters);
    let nextId = 1;

    function drawCell(rng, tb) {
      const r = rng(); let i = 0; while (i < tb.cum.length - 1 && r >= tb.cum[i]) i++;
      const s = tb.syms[i];
      return { id: nextId++, s, m: s === 'B' ? pickWeighted(rng, cfg.bombTable, bombTot) : 0 };
    }

    // pay anywhere: every regular symbol with MIN_PAY+ cells on the board pays by its count bucket
    function findWins(g) {
      const cells = {};
      for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) { const s = g[c][r].s; (cells[s] || (cells[s] = [])).push([c, r]); }
      const out = [];
      for (const s of REG) { const k = cells[s]; if (k && k.length >= MIN_PAY) out.push({ s, count: k.length, cells: k, pay: cfg.pay[s][bucket(k.length)] }); }
      return out;
    }
    const snap = (g) => g.map((col) => col.map((x) => ({ id: x.id, s: x.s, m: x.m })));
    const listOf = (g, sym) => { const o = []; for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) if (g[c][r].s === sym) o.push({ c, r, id: g[c][r].id, m: g[c][r].m }); return o; };

    // One spin: fill the board, tumble until no symbol pays. opts: { kind: 'base'|'ante'|'bonus', scatters?: n (buy: place exactly n), capLeft }
    function playSpin(rng, opts) {
      const kind = opts.kind || 'base', tb = T[kind], bonus = kind === 'bonus';
      const g = Array.from({ length: COLS }, () => new Array(ROWS));
      if (opts.scatters) {
        for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) g[c][r] = drawCell(rng, T.fill);
        const pos = []; for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) pos.push([c, r]);
        for (let i = 0; i < opts.scatters; i++) { const j = i + Math.floor(rng() * (pos.length - i)); [pos[i], pos[j]] = [pos[j], pos[i]]; const [c, r] = pos[i]; g[c][r].s = 'S'; }
      } else for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) g[c][r] = drawCell(rng, tb);
      const script = { kind, initial: snap(g), steps: [], winBeforeBombs: 0 };
      let wbb = 0;
      for (let t = 0; t < cfg.maxTumbles; t++) {
        const wins = findWins(g);
        if (!wins.length) break;
        const stepWin = wins.reduce((a, w) => a + w.pay, 0);
        const kill = new Set(); for (const w of wins) for (const [c, r] of w.cells) kill.add(c * ROWS + r);
        const fall = [], spawn = [];
        for (let c = 0; c < COLS; c++) {
          const keep = []; for (let r = ROWS - 1; r >= 0; r--) if (!kill.has(c * ROWS + r)) keep.push({ cell: g[c][r], from: r });
          let y = ROWS - 1;
          for (const k of keep) { if (k.from !== y) fall.push({ id: k.cell.id, c, from: k.from, to: y }); g[c][y] = k.cell; y--; }
          const need = y + 1;
          for (let i = 0; i < need; i++) { const x = drawCell(rng, tb); g[c][y] = x; spawn.push({ c, r: y, cell: { id: x.id, s: x.s, m: x.m } }); y--; }
        }
        wbb += stepWin;
        script.steps.push({ wins, removed: [...kill].map((k) => [Math.floor(k / ROWS), k % ROWS]), fall, spawn, stepWin, bombs: bonus ? listOf(g, 'B') : [], grid: snap(g) });
      }
      script.final = snap(g);
      const sc = listOf(g, 'S');
      script.scatters = sc.length; script.scatterCells = sc.map((x) => [x.c, x.r]);
      script.winBeforeBombs = wbb;
      const bombs = bonus ? listOf(g, 'B') : [];
      script.bombs = bombs;
      script.bombSum = bombs.reduce((a, b) => a + b.m, 0);
      script.bombApplied = bonus && wbb > 0 && script.bombSum > 0;
      let win = script.bombApplied ? wbb * script.bombSum : wbb;
      const capLeft = opts.capLeft == null ? Infinity : opts.capLeft;
      if (win > capLeft) { win = capLeft; script.capped = true; }
      script.spinWin = win;
      return script;
    }

    function scatterPayFor(n) { return n >= 4 ? cfg.scatterPay[Math.min(n, 6)] : 0; }

    function playBonus(rng, capLeft) {
      const out = { startSpins: cfg.freeSpins, spins: [], retriggers: 0, added: 0, total: 0 };
      capLeft = Math.max(0, capLeft);
      if (capLeft <= 0) { out.capped = true; return out; }
      let left = cfg.freeSpins, i = 0;
      while (left > 0 && i < cfg.maxSpins) {
        left--; i++;
        const s = playSpin(rng, { kind: 'bonus', capLeft });
        let spinTotal = s.spinWin; capLeft -= s.spinWin;
        s.scatterPay = 0;
        if (cfg.fsScatterPay && s.scatters >= 4 && capLeft > 0) { s.scatterPay = Math.min(scatterPayFor(s.scatters), capLeft); capLeft -= s.scatterPay; spinTotal += s.scatterPay; }
        s.total = spinTotal;
        out.total += spinTotal;
        if (s.scatters >= cfg.retriggerMin && cfg.freeSpins + out.added < cfg.maxSpins) {
          const add = Math.min(cfg.retriggerAdd, cfg.maxSpins - cfg.freeSpins - out.added);
          left += add; out.added += add; out.retriggers++; s.retrigger = add;
        }
        s.spinsLeft = left;
        out.spins.push(s);
        if (capLeft <= 0) { out.capped = true; break; }
      }
      return out;
    }

    // Full paid round. mode: 'spin' | 'ante' | 'buy'. All wins in x bet; cost in x bet.
    function round(rng, mode) {
      nextId = 1;
      const res = { mode, cost: mode === 'buy' ? cfg.buyCost : mode === 'ante' ? cfg.anteCost : 1, win: 0, base: null, scatterPay: 0, bonus: null };
      const base = mode === 'buy'
        ? playSpin(rng, { kind: 'base', scatters: pickWeighted(rng, cfg.buyScatters, buyScTot), capLeft: MAX_WIN_X })
        : playSpin(rng, { kind: mode === 'ante' ? 'ante' : 'base', capLeft: MAX_WIN_X });
      res.base = base; res.win = base.spinWin;
      if (base.scatters >= 4) {
        res.scatterPay = Math.min(scatterPayFor(base.scatters), MAX_WIN_X - res.win); res.win += res.scatterPay;
        const left = MAX_WIN_X - res.win;
        if (left > 0) { res.bonus = playBonus(rng, left); res.win += res.bonus.total; }
      }
      if (res.win >= MAX_WIN_X) { res.win = MAX_WIN_X; res.maxed = true; } else res.maxed = false;
      return res;
    }

    return { round, playSpin, playBonus, findWins, cfg, REG };
  }

  return { createEngine, rngFrom, winTier, TIERS, CFG, COLS, ROWS, REG, MIN_PAY, MAX_WIN_X };
});
