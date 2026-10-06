/* COLD CALL engine v2 (Le Bandit rules, Cold Call names): pure math, no DOM, no node-only APIs. Used by the server
   (games/coldcall.js), the sim, and (byte-identical copy at public/games/coldcall/engine.js) the browser for animation only.
   A paid round is a pure function of (rng, buy): it resolves the whole round (base spin, cascades, hot leads, phone feature,
   bonuses) into a win in whole TENTHS of the bet plus a replayable script. The contract is cold-call/ENGINE-V2.md.
   win cents = winTenths * bet / 10 is an exact integer at every bet level (all multiples of 10 cents).
   Money is never rounded: every pay, bubble value, multiplier and close value is an integer number of tenths.
   Grid: 6 columns x 5 rows, flat array of 30, pos = row * 6 + col, row 0 on top. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ColdCallEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const COLS = 6, ROWS = 5, N = 30, MIN_CLUSTER = 5, MAX_WIN_X = 10000, MAX_WIN_T = MAX_WIN_X * 10;
  const BET_LEVELS = [10, 20, 50, 100, 200, 500, 1000, 2500];
  // symbol ids: regular 0..9 (low 0-4, high 5-9), then closer (wild), bell (scatter), phone ("the call connects")
  const SYM = ['mug', 'note', 'ball', 'can', 'cups', 'headset', 'rx', 'pile', 'cashwad', 'cash', 'closer', 'bell', 'phone'];
  const NREG = 10, WILD = 10, BELL = 11, PHONE = 12, NSYM = 13;
  const MODES = ['base', 'bonus1', 'bonus2', 'bonus3'];
  const BUYS = ['call', 'bonus1', 'bonus2', 'hunt'];
  const FORCES = ['bonus1', 'bonus2', 'bonus3', 'phone', 'close', 'big', 'tease'];
  const TIER_NAMES = ['bronze', 'silver', 'gold'];

  /* ---------------------------------------------------------------- LEVERS (tune here) ---------------------------------
     All money numbers are integers in TENTHS of the bet (10 = 1.0x bet). */
  const CFG = {
    // cell weights of the 10 regular symbols (order = SYM): mug note ball can cups headset rx pile cashwad cash
    weights: [29.925, 25.552, 20.828, 17.21, 13.464, 10.034, 8.159, 6.436, 5.001, 3.79],
    // closer (wild), bell (scatter) and phone weights per cell, per mode (a phone is also guaranteed on every bonus3 spin and on a 'call' buy)
    extra: {
      base: { wild: 1, bell: 1.52, phone: 0.208 },
      bonus1: { wild: 5, bell: 1.567, phone: 4.5 },
      bonus2: { wild: 3, bell: 1.567, phone: 4.5 },
      bonus3: { wild: 2, bell: 1.567, phone: 3 },
    },
    // cluster pay in tenths of the bet by cluster size: 5, 6, 7, 8, 9, 10, 11, 12, 13+  (5 pays 1x to 1.8x so no cluster win is under 1x; 13+ pays 130x to 715x)
    pay: {
      mug:     [10, 10, 12, 15, 24, 50, 140, 450, 1300],
      note:    [10, 10, 13, 17, 26, 55, 154, 495, 1430],
      ball:    [10, 10, 14, 18, 29, 60, 168, 540, 1560],
      can:     [10, 10, 16, 20, 32, 68, 189, 608, 1755],
      cups:    [10, 10, 18, 23, 37, 78, 217, 698, 2015],
      headset: [11, 11, 21, 28, 44, 93, 259, 833, 2405],
      rx:      [12, 12, 26, 35, 55, 115, 322, 1035, 2990],
      pile:    [13, 13, 35, 45, 72, 150, 420, 1350, 3900],
      cashwad: [15, 15, 46, 60, 96, 200, 560, 1800, 5200],
      cash   : [18, 18, 63, 83, 132, 275, 770, 2475, 7150],
    },
    payScale: 1,   // applied once when the engine is built (rounded to integer tenths, min 1); 1 = the table as written
    // hot lead reveals: tier weights per mode (bonus3 has no bronze), optional per-mode value weights (bubbles), values in tenths of the bet
    reveal: {
      base: { bronze: 100, silver: 2.5, gold: 0.2, upsell: 6, close: 0.6 },
      bonus1: { bronze: 100, silver: 19, gold: 1.9, upsell: 9, close: 0.6 },
      bonus2: { bronze: 100, silver: 11, gold: 0.9, upsell: 9, close: 0.2 },
      bonus3: { bronze: 0, silver: 5.5, gold: 0.05, upsell: 0.5, close: 0.004,
        bubbles: { silver: [[50, 75], [100, 15], [150, 7], [200, 3]], gold: [[250, 60], [500, 25], [1000, 10], [2500, 4], [5000, 1]] } },
    },
    bubbles: {
      bronze: [[2, 30], [5, 28], [10, 20], [20, 10], [30, 7], [40, 5]],           // 0.2 0.5 1 2 3 4 x bet
      silver: [[50, 40], [100, 30], [150, 18], [200, 12]],                         // 5 10 15 20 x
      gold: [[250, 45], [500, 30], [1000, 17], [2500, 6], [5000, 2]],              // 25 50 100 250 500 x
    },
    upsell: [[2, 40], [3, 28], [4, 17], [5, 10], [10, 5]],                         // multiplier, weight
    adjacency: 4,                // upsell reaches this many neighbours (4 = up/down/left/right; 8 adds the diagonals, tail too hot: see ENGINE-V2.md)
    spins: { bonus1: 8, bonus2: 12, bonus3: 12 },
    retrigger: { two: 2, three: 4, upgrade: 4 },   // 2 bells +2 spins, 3 bells +4, 4 bells in bonus1 = upgrade to bonus2 +4
    maxSpins: 40,                // cap on the total free spins of one bonus (start + added)
    maxCascades: 40,             // hard cap on cascade steps in one spin
    maxRevealRounds: 30,         // hard cap on the reveal / close repeat loop (it cannot pass the number of hot leads anyway)
    // buy prices, tenths of the bet. Set from the measured average value / 0.98 (rounded to a whole tenth), then re-simulated.
    buyCost: { call: 29, bonus1: 856, bonus2: 2834, hunt: 35 },
    hunt: { bellMult: 1.85 },     // 'hunt': one spin whose bell weight is multiplied (base game otherwise)
    maxWinTenths: MAX_WIN_T,
  };
  const TIERS = [[100, 'legend'], [50, 'mega'], [25, 'huge'], [10, 'big'], [5, 'sweet'], [2, 'nice']];
  function winTier(winX) { for (const [x, name] of TIERS) if (winX >= x) return name; return 'none'; }

  // sfc32 seeded through splitmix32: 128-bit state, so streams from different seeds do not overlap in any sim
  function rngFrom(seed) {
    let s = seed >>> 0;
    const sm = () => { s = (s + 0x9E3779B9) | 0; let z = s; z = Math.imul(z ^ (z >>> 16), 0x85EBCA6B); z = Math.imul(z ^ (z >>> 13), 0xC2B2AE35); return (z ^ (z >>> 16)) >>> 0; };
    let a = sm(), b = sm(), c = sm(), d = sm();
    for (let i = 0; i < 12; i++) { const t = (a + b | 0) + d | 0; d = d + 1 | 0; a = b ^ (b >>> 9); b = c + (c << 3) | 0; c = (c << 21 | c >>> 11) + t | 0; }
    return function () { const t = (a + b | 0) + d | 0; d = d + 1 | 0; a = b ^ (b >>> 9); b = c + (c << 3) | 0; c = (c << 21 | c >>> 11) + t | 0; return (t >>> 0) / 4294967296; };
  }

  // neighbour tables (flat positions)
  const NB4 = [], NB8 = [];
  for (let p = 0; p < N; p++) {
    const r = (p / COLS) | 0, c = p % COLS, a = [], b = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= ROWS || cc >= COLS) continue;
      b.push(rr * COLS + cc); if (!dr || !dc) a.push(rr * COLS + cc);
    }
    NB4.push(a); NB8.push(b);
  }
  const bucket = (n) => (n >= 13 ? 8 : n - 5);

  // cumulative table over [value, weight] outcomes
  function cumOf(ws) { const tot = ws.reduce((a, b) => a + b, 0); const cum = []; let c = 0; for (const w of ws) { c += w / tot; cum.push(c); } cum[cum.length - 1] = 1; return cum; }
  function pickCum(rng, cum) { const x = rng(); let i = 0; while (x >= cum[i] && i < cum.length - 1) i++; return i; }

  function createEngine(cfgIn) {
    const cfg = cfgIn || CFG;
    const capT = cfg.maxWinTenths;
    const NB = cfg.adjacency === 4 ? NB4 : NB8;
    const PAY = [];
    for (let s = 0; s < NREG; s++) PAY.push(cfg.pay[SYM[s]].map((v) => Math.max(1, Math.round(v * cfg.payScale))));

    // symbol draw tables per mode: noBell variant (QA force) and bell-boosted variant (hunt)
    function makeSymTable(mode, bellMult, noBell) {
      const x = cfg.extra[mode]; const w = cfg.weights.slice(); w.push(x.wild, noBell ? 0 : x.bell * bellMult, x.phone);
      return cumOf(w);
    }
    const SYMT = MODES.map((m) => makeSymTable(m, 1, false));
    const SYMT_NB = MODES.map((m) => makeSymTable(m, 1, true));
    const SYMT_HUNT = makeSymTable('base', cfg.hunt.bellMult, false);
    // reveal tables per mode: outcomes = 15 bubbles, 5 upsells, 1 close
    const REV = MODES.map((m) => {
      const r = cfg.reveal[m], out = [], ws = [];
      TIER_NAMES.forEach((tn, ti) => {
        const list = (r.bubbles && r.bubbles[tn]) || cfg.bubbles[tn], tot = list.reduce((a, b) => a + b[1], 0);   // r.bubbles: optional per-mode value weights
        for (const [v, w] of list) { out.push({ k: 'b', v, t: ti }); ws.push(r[tn] * w / tot); }
      });
      const ut = cfg.upsell.reduce((a, b) => a + b[1], 0);
      for (const [v, w] of cfg.upsell) { out.push({ k: 'u', v, t: 0 }); ws.push(r.upsell * w / ut); }
      out.push({ k: 'c', v: 0, t: 0 }); ws.push(r.close);
      return { out, cum: cumOf(ws) };
    });

    const drawSym = (rng, cum) => { const x = rng(); let i = 0; while (x >= cum[i] && i < NSYM - 1) i++; return i; };

    // ---- clusters on a grid: [{sym, cells, pay}] (wild joins every symbol it touches; a cluster needs 5+ cells incl. wilds)
    const cnt = new Uint8Array(NSYM), seen = new Uint8Array(N), stack = new Uint8Array(N);
    function findClusters(g) {
      cnt.fill(0); for (let p = 0; p < N; p++) cnt[g[p]]++;
      const wc = cnt[WILD]; let out = null;
      for (let s = 0; s < NREG; s++) {
        if (!cnt[s] || cnt[s] + wc < MIN_CLUSTER) continue;
        seen.fill(0);
        for (let p0 = 0; p0 < N; p0++) {
          if (g[p0] !== s || seen[p0]) continue;
          let sp = 0, cells = []; stack[sp++] = p0; seen[p0] = 1;
          while (sp) {
            const p = stack[--sp]; cells.push(p);
            const nb = NB4[p];
            for (let i = 0; i < nb.length; i++) { const q = nb[i]; if (seen[q]) continue; const t = g[q]; if (t !== s && t !== WILD) continue; seen[q] = 1; stack[sp++] = q; }
          }
          if (cells.length < MIN_CLUSTER) continue;
          cells.sort((a, b) => a - b);
          (out || (out = [])).push({ sym: s, cells, pay: PAY[s][bucket(cells.length)] });
        }
      }
      return out;
    }

    // ---- phone feature: every hot lead reveals; upsells; closes collect; repeat on the non-close leads until no new close
    function phoneFeature(rng, mi, hot, S, capLeft) {
      const rv = REV[mi];
      const leads = []; for (let p = 0; p < N; p++) if (hot[p]) leads.push(p);
      const kind = new Uint8Array(N);              // 0 empty, 1 bubble, 2 upsell, 3 close
      const val = new Array(N).fill(0), pm = new Array(N).fill(1), done = new Uint8Array(N), tier = new Uint8Array(N);
      const rounds = S ? [] : null;
      let active = leads, nRounds = 0, nClose = 0;
      while (active.length && nRounds < cfg.maxRevealRounds) {
        const rr = S ? { reveals: [], upsells: [], collects: [] } : null;
        for (const p of active) {
          const o = rv.out[pickCum(rng, rv.cum)];
          kind[p] = o.k === 'b' ? 1 : o.k === 'u' ? 2 : 3; val[p] = o.k === 'c' ? 0 : o.v; tier[p] = o.t; pm[p] = 1; done[p] = 0;
          if (S) rr.reveals.push(o.k === 'b' ? { p, k: 'b', v: o.v, t: o.t } : o.k === 'u' ? { p, k: 'u', v: o.v } : { p, k: 'c', v: 0 });
        }
        for (const p of active) {                   // upsells apply first, top to bottom, left to right (leads are in position order)
          if (kind[p] !== 2) continue;
          const m = val[p], hits = S ? [] : null;
          for (const q of NB[p]) {
            if (!hot[q]) continue;
            if (kind[q] === 1) { const b = val[q]; val[q] = Math.min(b * m, capT); if (S) hits.push({ p: q, k: 'b', before: b, after: val[q] }); }
            else if (kind[q] === 3) {
              if (done[q]) { const b = val[q]; val[q] = Math.min(b * m, capT); if (S) hits.push({ p: q, k: 'c', before: b, after: val[q] }); }
              else { const b = pm[q]; pm[q] = Math.min(b * m, capT); if (S) hits.push({ p: q, k: 'c', pend: 1, before: b, after: pm[q] }); }
            }
          }
          if (S) rr.upsells.push({ p, m, hits });
        }
        let fresh = 0;
        for (const p of active) {                   // closes collect in order; each takes every bubble and every other close
          if (kind[p] !== 3) continue;
          let took = 0; for (const q of leads) if (q !== p && (kind[q] === 1 || (kind[q] === 3 && done[q]))) took += val[q];
          took = Math.min(took, capT);
          val[p] = Math.min(took * pm[p], capT); done[p] = 1; fresh++;
          if (S) { let run = 0; for (const q of leads) if (kind[q] === 1 || kind[q] === 3) run += val[q]; rr.collects.push({ p, m: pm[p], took, value: val[p], run }); }
        }
        if (S) rounds.push(rr);
        nRounds++; nClose += fresh;
        if (!fresh) break;
        active = leads.filter((q) => kind[q] !== 3);
      }
      let pay = 0; for (const p of leads) if (kind[p] === 1 || kind[p] === 3) pay += val[p];
      let capped = false;
      if (pay >= capLeft) { pay = capLeft; capped = true; }
      return { pay, capped, closes: nClose, rounds: nRounds, leads: leads.length, script: S ? { leads, rounds, pay, capped } : null };
    }

    // ---- one spin: fill, super cascade until no win, then the phone feature. hot (Uint8Array 30) carries between bonus spins.
    // o: { guarantee, noBell, bellsAt (force: exact bells), hunt, capLeft }
    function playSpin(rng, mi, hot, S, o) {
      const tab = o.hunt ? SYMT_HUNT : o.noBell ? SYMT_NB[mi] : SYMT[mi];
      const refill = o.noBell ? SYMT_NB[mi] : tab;
      const g = new Uint8Array(N);
      if (o.grid) g.set(o.grid); else for (let p = 0; p < N; p++) g[p] = drawSym(rng, tab);   // o.grid: test hook (a fixed start grid)
      let gp = -1;
      if (o.bellsAt) {                               // QA force: exactly this many bells land at once
        const cells = []; for (let p = 0; p < N; p++) cells.push(p);
        for (let i = 0; i < o.bellsAt; i++) { const j = i + Math.floor(rng() * (N - i)); const t = cells[i]; cells[i] = cells[j]; cells[j] = t; g[cells[i]] = BELL; }
      }
      if (o.guarantee) {
        let has = false; for (let p = 0; p < N; p++) if (g[p] === PHONE) { has = true; break; }
        if (!has) {
          const cand = []; for (let p = 0; p < N; p++) if (g[p] !== BELL) cand.push(p);
          gp = cand[Math.floor(rng() * cand.length)]; g[gp] = PHONE;
        }
      }
      const res = { win: 0, cluster: 0, phone: 0, bells: 0, phones: 0, cascades: 0, capped: false, closes: 0, leads: 0, fired: false, script: null };
      const hotIn = S ? hotList(hot) : null;
      const steps = S ? [] : null;
      let capLeft = o.capLeft;
      const sc = S ? { grid: Array.from(g), gp, hotIn, steps, bells: 0, phones: 0, phone: null, hotOut: null, cluster: 0, win: 0, capped: false } : null;
      const typeWin = new Uint8Array(NSYM), rem = new Uint8Array(N);
      for (;;) {
        const cl = findClusters(g);
        if (!cl) break;
        let stepPay = 0; for (const k of cl) stepPay += k.pay;
        const paid = Math.min(stepPay, capLeft); capLeft -= paid; res.cluster += paid; res.cascades++;
        typeWin.fill(0); rem.fill(0);
        for (const k of cl) { typeWin[k.sym] = 1; for (const p of k.cells) { rem[p] = 1; hot[p] = 1; } }
        for (let p = 0; p < N; p++) if (typeWin[g[p]]) rem[p] = 1;      // super cascade: every symbol of a winning type goes
        const removed = S ? [] : null; if (S) for (let p = 0; p < N; p++) if (rem[p]) removed.push(p);
        const falls = S ? [] : null, fresh = S ? [] : null;
        for (let c = 0; c < COLS; c++) {
          let w = ROWS - 1;
          for (let r = ROWS - 1; r >= 0; r--) {
            const p = r * COLS + c; if (rem[p]) continue;
            if (w !== r) { g[w * COLS + c] = g[p]; if (S) falls.push([p, w * COLS + c]); }
            w--;
          }
          for (; w >= 0; w--) { const s = drawSym(rng, refill); g[w * COLS + c] = s; if (S) fresh.push([w * COLS + c, s]); }
        }
        const lastStep = capLeft <= 0 || res.cascades >= cfg.maxCascades;
        if (capLeft <= 0) res.capped = true;
        if (S) steps.push({ wins: cl.map((k) => ({ sym: k.sym, pos: k.cells, pay: k.pay })), pay: paid, removed, falls, fresh, grid: Array.from(g), hot: hotList(hot), ...(capLeft <= 0 ? { capped: true } : {}) });
        if (lastStep) break;
      }
      for (let p = 0; p < N; p++) { if (g[p] === BELL) res.bells++; else if (g[p] === PHONE) res.phones++; }
      let nHot = 0; for (let p = 0; p < N; p++) nHot += hot[p];
      if (!res.capped && res.phones > 0 && nHot > 0) {
        const f = phoneFeature(rng, mi, hot, S, capLeft);
        res.phone = f.pay; capLeft -= f.pay; res.closes = f.closes; res.leads = f.leads; res.fired = true; res.revealRounds = f.rounds;
        if (f.capped) res.capped = true;
        if (S) sc.phone = f.script;
        if (mi <= 1) hot.fill(0);                    // base spin clears; bonus1 clears once a phone has used them
      }
      if (mi === 0) hot.fill(0);
      res.win = res.cluster + res.phone;
      if (S) { sc.bells = res.bells; sc.phones = res.phones; sc.cluster = res.cluster; sc.phoneTenths = res.phone; sc.win = res.win; sc.capped = res.capped; sc.hotOut = hotList(hot); sc.mode = MODES[mi]; res.script = sc; }
      return res;
    }
    const hotList = (hot) => { const a = []; for (let p = 0; p < N; p++) if (hot[p]) a.push(p); return a; };

    // ---- bonus: start 1 (DIALING FOR DOLLARS), 2 (ALWAYS BE CLOSING) or 3 (QUOTE ACCEPTED)
    function playBonus(rng, start, S, capLeft, o) {
      const startKind = MODES[start];
      let mi = start, left = cfg.spins[startKind], awarded = left, upgraded = false;
      const hot = new Uint8Array(N);
      const out = { total: 0, cluster: 0, phone: 0, spins: 0, added: 0, upgraded: false, capped: false, cascades: 0, fired: 0, closes: 0, script: null };
      const spins = S ? [] : null;
      const hardCap = cfg.maxSpins + 2;
      while (left > 0 && out.spins < hardCap) {
        left--; out.spins++;
        const sp = playSpin(rng, mi, hot, S, { guarantee: mi === 3, capLeft: capLeft - out.total });
        out.total += sp.win; out.cluster += sp.cluster; out.phone += sp.phone; out.cascades += sp.cascades; out.fired += sp.fired ? 1 : 0; out.closes += sp.closes;
        const b = sp.bells; let add = 0, up = false;
        if (mi === 1) { if (b >= 4) { add = cfg.retrigger.upgrade; up = true; mi = 2; upgraded = true; } else if (b === 3) add = cfg.retrigger.three; else if (b === 2) add = cfg.retrigger.two; }
        else if (b >= 3) add = cfg.retrigger.three; else if (b === 2) add = cfg.retrigger.two;
        add = Math.max(0, Math.min(add, cfg.maxSpins - awarded)); awarded += add; left += add; out.added += add;
        if (S) { const s = sp.script; s.n = out.spins; s.added = add; s.upgrade = up; s.left = left; s.bonusTotal = Math.min(out.total, capLeft); spins.push(s); }
        if (sp.capped || out.total >= capLeft) { out.capped = true; out.total = Math.min(out.total, capLeft); break; }
      }
      out.upgraded = upgraded;
      if (S) out.script = { kind: startKind, startSpins: cfg.spins[startKind], spins, totalSpins: awarded, upgraded, winTenths: out.total, capped: out.capped };
      return out;
    }

    // ---- full paid round. buy: null | 'call' | 'bonus1' | 'bonus2' | 'hunt'. opts: { script, force }
    function roundOnce(rng, buy, S, force) {
      const res = { buy: buy || null, costTenths: buy ? cfg.buyCost[buy] : 10, winTenths: 0, clusterTenths: 0, phoneTenths: 0, bonusTenths: 0, bonusKind: 0, upgraded: false,
        capped: false, script: null, bells: 0, phoneFired: false, closes: 0, cascades: 0, baseCascades: 0, bonusSpins: 0, bonusCluster: 0, bonusPhone: 0, leads: 0, revealRounds: 0 };
      let capLeft = capT, spin = null;
      if (buy === 'bonus1' || buy === 'bonus2') {
        res.bonusKind = buy === 'bonus1' ? 1 : 2;
      } else {
        const so = { guarantee: buy === 'call', hunt: buy === 'hunt', capLeft };
        if (force === 'bonus1' || force === 'bonus2' || force === 'bonus3') { so.noBell = true; so.bellsAt = force === 'bonus1' ? 3 : force === 'bonus2' ? 4 : 5; }
        else if (force === 'tease') { so.noBell = true; so.bellsAt = 2; }
        spin = playSpin(rng, 0, new Uint8Array(N), S, so);
        res.clusterTenths = spin.cluster; res.phoneTenths = spin.phone; res.bells = spin.bells; res.phoneFired = spin.fired; res.closes = spin.closes; res.cascades = spin.cascades; res.baseCascades = spin.cascades;
        res.leads = spin.leads; res.revealRounds = spin.revealRounds || 0;
        capLeft -= spin.win; if (spin.capped || capLeft <= 0) { res.capped = true; capLeft = 0; }
        if (!res.capped && spin.bells >= 3) res.bonusKind = spin.bells >= 5 ? 3 : spin.bells === 4 ? 2 : 1;
      }
      let bonus = null;
      if (res.bonusKind && !res.capped) {
        bonus = playBonus(rng, res.bonusKind, S, capLeft, null);
        res.bonusTenths = bonus.total; res.upgraded = bonus.upgraded; res.bonusSpins = bonus.spins; res.bonusCluster = bonus.cluster; res.bonusPhone = bonus.phone;
        res.cascades += bonus.cascades; res.closes += bonus.closes; if (bonus.capped) res.capped = true;
      }
      res.winTenths = Math.min(res.clusterTenths + res.phoneTenths + res.bonusTenths, capT);
      if (res.winTenths >= capT) res.capped = true;
      res.winX = res.winTenths / 10; res.tier = winTier(res.winX);
      if (S) res.script = { v: 2, buy: res.buy, costTenths: res.costTenths, winTenths: res.winTenths, tier: res.tier, capped: res.capped, maxWinTenths: capT,
        parts: { cluster: res.clusterTenths, phone: res.phoneTenths, bonus: res.bonusTenths }, spin: spin ? spin.script : null, bonus: bonus ? bonus.script : null };
      return res;
    }
    // QA forces that cannot be steered by placement are conditioned by re-rolling whole rounds (bounded)
    function round(rng, buy, opts) {
      const S = !!(opts && opts.script), force = opts && opts.force;
      if (buy || !(force === 'phone' || force === 'close' || force === 'big')) return roundOnce(rng, buy, S, force);
      let r;
      for (let i = 0; i < 200000; i++) {
        r = roundOnce(rng, null, S, null);
        if (force === 'phone' ? r.phoneFired && r.leads >= 4 : force === 'close' ? r.closes >= 1 && r.revealRounds >= 2 : r.winTenths >= 250) break;
      }
      return r;
    }

    return { round, playSpin, playBonus, phoneFeature, findClusters, cfg, PAY, REV, SYMT };
  }

  // whole cents for a tenths amount at a bet level; throws if it would not be an exact integer (it always is for BET_LEVELS)
  function cents(tenths, bet) {
    const c = tenths * bet / 10;
    if (!Number.isSafeInteger(tenths) || !Number.isSafeInteger(bet) || bet % 10 !== 0 || !Number.isSafeInteger(c)) throw new Error('not whole cents');
    return c;
  }

  const engine = createEngine();
  // Resolves one full paid round with the injected rng (() => [0,1)). buy: null | 'call' | 'bonus1' | 'bonus2' | 'hunt'. opts.force: QA only.
  function resolveRound(rng, buy, opts) {
    const r = engine.round(rng, buy, { script: true, ...(opts || {}) });
    return { round: r, buy: r.buy, costTenths: r.costTenths, winTenths: r.winTenths, winX: r.winX, capped: r.capped, tier: r.tier, script: r.script };
  }

  return { createEngine, engine, resolveRound, rngFrom, winTier, cents, TIERS, CFG, SYM, MODES, BUYS, FORCES, TIER_NAMES, BET_LEVELS, COLS, ROWS, N, NREG, WILD, BELL, PHONE, MIN_CLUSTER, MAX_WIN_X, MAX_WIN_T };
});
