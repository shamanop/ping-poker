/* COLD CALL engine: pure math, no DOM, no node-only APIs. One file, used by the server (games/coldcall.js), the sim
   and (byte-identical copy at public/games/coldcall/engine.js) the browser for animation only.
   A paid round is a pure function of (rng, buy): it returns the win as a whole number of TENTHS of the bet plus a
   replayable script. win cents = winTenths * bet / 10 is an exact integer at every bet level (all multiples of 10 cents).
   Money is never rounded anywhere: every pay, quote amount, field prize and multiplier below is an integer. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ColdCallEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const COLS = 5, ROWS = 3, MAX_WIN_X = 10000, MAX_WIN_T = MAX_WIN_X * 10;
  const BET_LEVELS = [10, 20, 50, 100, 200, 500, 1000, 2500];
  // symbol ids: regular 0..7, then closer (wild, reels 2-4), phone (scatter, reels 1-3-5), quote (cash bubble)
  const SYM = ['cash', 'pile', 'rx', 'headset', 'can', 'mug', 'note', 'ball', 'closer', 'phone', 'quote'];
  const NREG = 8, CLOSER = 8, PHONE = 9, QUOTE = 10;
  const PHONE_REELS = [0, 2, 4], WILD_REELS = [1, 2, 3];
  // checkout form: 18 boxes. CVV 0-2, EXPIRY 3-6, NAME 7-11, CARD 12-17
  const FIELDS = [{ id: 'cvv', name: 'CVV', size: 3, tier: 'mini', from: 0 }, { id: 'expiry', name: 'EXPIRY', size: 4, tier: 'minor', from: 3 },
    { id: 'name', name: 'NAME', size: 5, tier: 'major', from: 7 }, { id: 'card', name: 'CARD', size: 6, tier: 'mega', from: 12 }];
  const BOXES = 18, QUOTE_TRIGGER = 6;
  const FIELD_OF = []; FIELDS.forEach((f, i) => { for (let b = f.from; b < f.from + f.size; b++) FIELD_OF[b] = i; });

  /* ---------------------------------------------------------------- LEVERS (tune here) ---------------------------------
     All money numbers are integers in TENTHS of the bet (10 = 1.0x bet). */
  const CFG = {
    // base game symbol weights per reel: [cash, pile, rx, headset, can, mug, note, ball, closer]. closer only counts on reels 2-4.
    reelWeights: [
      [3, 4, 5, 7, 8, 9, 10, 10, 0],
      [3, 4, 5, 7, 8, 9, 10, 10, 3],
      [3, 4, 5, 7, 8, 9, 10, 10, 3],
      [3, 4, 5, 7, 8, 9, 10, 10, 3],
      [3, 4, 5, 7, 8, 9, 10, 10, 0],
    ],
    phoneW: 4.4,          // phone weight on reels 1-3-5 (base game); ROTARY needs one on each of the three
    quoteW: 7.65,         // quote bubble weight on every reel (base game); 6+ in view = QUOTE ACCEPTED
    // free spins (ROTARY) use their own strips: same symbols, no quote bubbles
    freeReelWeights: [
      [3, 4, 5, 7, 8, 9, 10, 10, 0],
      [3, 4, 5, 7, 8, 9, 10, 10, 3],
      [3, 4, 5, 7, 8, 9, 10, 10, 3],
      [3, 4, 5, 7, 8, 9, 10, 10, 3],
      [3, 4, 5, 7, 8, 9, 10, 10, 0],
    ],
    freePhoneW: 4.4, freeQuoteW: 0,
    payScale: 1,          // multiplies the pay table once, at engine build; the product is rounded to whole tenths there
    // tenths of the bet per WAY for 3 / 4 / 5 of a kind, left to right (a way = one path of cells, wilds included)
    pay: {
      cash: [25, 100, 400], pile: [20, 70, 250], rx: [12, 45, 140], headset: [6, 18, 55],
      can: [4, 10, 24], mug: [3, 7, 12], note: [2, 5, 9], ball: [2, 4, 7],
    },
    // ROTARY dial: the two finger-stops. [value, weight]. Hole index = position in the list.
    dialSpins: [[5, 14], [6, 14], [7, 13], [8, 12], [10, 12], [12, 10], [14, 9], [16, 7], [18, 5], [20, 4]],
    dialMult: [[1, 55], [2, 28], [3, 11], [4, 4], [5, 2]],
    maxFreeSpins: 30,     // total free spins in one ROTARY (start + callbacks)
    // QUOTE ACCEPTED
    quoteTable: [[5, 30], [10, 28], [20, 18], [30, 10], [50, 7], [100, 4], [250, 2], [500, 0.8], [1000, 0.2]], // amounts, tenths
    landP: 0.047,          // chance an empty box gets a bubble on a respin (per box, per respin)
    upsellP: 0.02,        // a landed bubble is an UPSELL (carries no amount, doubles its field) with this chance
    maxUpsellDoubles: 3,  // at most x8 on one field
    respins: 3,
    fieldPrize: { cvv: 50, expiry: 150, name: 500, card: 2000 }, // mini / minor / major / mega, tenths
    grandPrize: 20000,    // all four fields filled = PAYMENT ACCEPTED
    // buy prices, tenths of the bet. Set from the measured average bonus value / 0.98.
    buyCost: { rotary: 368, quote: 426 },
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

  const clone = (o) => JSON.parse(JSON.stringify(o));

  function pickWeighted(rng, list) { // list of [value, weight]; returns index
    let tot = 0; for (let i = 0; i < list.length; i++) tot += list[i][1];
    let x = rng() * tot;
    for (let i = 0; i < list.length; i++) { x -= list[i][1]; if (x < 0) return i; }
    return list.length - 1;
  }

  function createEngine(cfgIn) {
    const cfg = cfgIn || CFG;
    const capT = cfg.maxWinTenths;
    // pay table as integer tenths (payScale applied once here, never at play time)
    const PAY = [];
    for (let s = 0; s < NREG; s++) PAY.push(cfg.pay[SYM[s]].map((v) => Math.round(v * cfg.payScale)));

    function makeStrip(weights, phoneW, quoteW) {
      return weights.map((row, c) => {
        const syms = [], w = [];
        for (let s = 0; s <= CLOSER; s++) if (row[s] > 0 && (s !== CLOSER || WILD_REELS.includes(c))) { syms.push(s); w.push(row[s]); }
        if (phoneW > 0 && PHONE_REELS.includes(c)) { syms.push(PHONE); w.push(phoneW); }
        if (quoteW > 0) { syms.push(QUOTE); w.push(quoteW); }
        const tot = w.reduce((a, b) => a + b, 0); const cum = new Float64Array(w.length); let acc = 0;
        for (let i = 0; i < w.length; i++) { acc += w[i] / tot; cum[i] = acc; }
        cum[cum.length - 1] = 1.0000001;
        return { syms: Int8Array.from(syms), cum, pQuote: quoteW > 0 ? quoteW / tot : 0, pPhone: phoneW > 0 && PHONE_REELS.includes(c) ? phoneW / tot : 0 };
      });
    }
    const BASE = makeStrip(cfg.reelWeights, cfg.phoneW, cfg.quoteW);
    const FREE = makeStrip(cfg.freeReelWeights, cfg.freePhoneW, cfg.freeQuoteW);

    // distribution of quote bubbles in view (Poisson-binomial over the 15 cells) -> used for QUOTE buys and for reporting
    const quoteCountDist = (() => {
      let d = [1];
      for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
        const p = BASE[c].pQuote, nd = new Array(d.length + 1).fill(0);
        for (let k = 0; k < d.length; k++) { nd[k] += d[k] * (1 - p); nd[k + 1] += d[k] * p; }
        d = nd;
      }
      return d;
    })();
    const triggerCdf = (() => {
      const tail = quoteCountDist.slice(QUOTE_TRIGGER); const tot = tail.reduce((a, b) => a + b, 0); let acc = 0;
      return { tot, cum: tail.map((p) => (acc += p / tot)) };
    })();
    function drawStartQuotes(rng) { const x = rng(); let i = 0; while (i < triggerCdf.cum.length - 1 && x >= triggerCdf.cum[i]) i++; return QUOTE_TRIGGER + i; }

    const grid = new Int8Array(COLS * ROWS);           // grid[c*3 + r], r = 0 top
    const cnt = new Int8Array(COLS * NREG), wild = new Int8Array(COLS);
    let phoneMask = 0, phoneCount = 0, quoteCount = 0;

    function fill(rng, strip) {
      phoneMask = 0; phoneCount = 0; quoteCount = 0;
      for (let c = 0; c < COLS; c++) {
        const st = strip[c], cum = st.cum, syms = st.syms, last = cum.length - 1;
        for (let r = 0; r < ROWS; r++) {
          const x = rng(); let i = 0; while (i < last && x >= cum[i]) i++;
          const s = syms[i]; grid[c * ROWS + r] = s;
          if (s === PHONE) { phoneMask |= 1 << c; phoneCount++; } else if (s === QUOTE) quoteCount++;
        }
      }
    }

    // ways evaluation of the current grid. Returns total tenths (x mult). wins collected only when `out` is given.
    function evalWays(mult, out) {
      cnt.fill(0); wild.fill(0);
      for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
        const s = grid[c * ROWS + r];
        if (s < NREG) cnt[c * NREG + s]++; else if (s === CLOSER) wild[c]++;
      }
      let total = 0;
      for (let s = 0; s < NREG; s++) {
        let ways = 1, len = 0;
        for (let c = 0; c < COLS; c++) { const n = cnt[c * NREG + s] + wild[c]; if (n === 0) break; ways *= n; len++; }
        if (len < 3) continue;
        const pay = PAY[s][len - 3], win = pay * ways * mult;
        total += win;
        if (out) {
          const rows = [];
          for (let c = 0; c < len; c++) { const rr = []; for (let r = 0; r < ROWS; r++) { const g = grid[c * ROWS + r]; if (g === s || g === CLOSER) rr.push(r); } rows.push(rr); }
          out.push({ sym: SYM[s], len, ways, pay, mult, win, rows });
        }
      }
      return total;
    }
    const gridOut = () => { const g = []; for (let c = 0; c < COLS; c++) { const col = []; for (let r = 0; r < ROWS; r++) col.push(SYM[grid[c * ROWS + r]]); g.push(col); } return g; };
    const cellsOf = (sym) => { const o = []; for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) if (grid[c * ROWS + r] === sym) o.push({ c, r }); return o; };

    function drawQuoteAmt(rng) { return cfg.quoteTable[pickWeighted(rng, cfg.quoteTable)][0]; }

    /* ROTARY. capLeft = tenths still payable under the round cap. Returns {total, ...script}. */
    function playRotary(rng, S, capLeft) {
      const si = pickWeighted(rng, cfg.dialSpins), mi = pickWeighted(rng, cfg.dialMult);
      const startSpins = cfg.dialSpins[si][0], mult = cfg.dialMult[mi][0];
      const out = S ? { kind: 'rotary', dial: { spins: { hole: si, value: startSpins }, mult: { hole: mi, value: mult } }, startSpins, mult, spins: [] } : null;
      let left = startSpins, awarded = startSpins, total = 0, played = 0, capped = false;
      if (capLeft <= 0) capped = true;
      while (!capped && left > 0 && played < cfg.maxFreeSpins + 1) {
        left--; played++;
        fill(rng, FREE);
        const wins = S ? [] : null;
        const raw = evalWays(1, wins);
        let win = raw * mult, cut = false;
        if (win >= capLeft) { win = capLeft; cut = true; }
        let add = 0;
        if (phoneCount > 0 && awarded < cfg.maxFreeSpins) { add = Math.min(phoneCount, cfg.maxFreeSpins - awarded); awarded += add; left += add; }
        total += win; capLeft -= win;
        if (S) out.spins.push({ n: played, grid: gridOut(), wins, rawTenths: raw, winTenths: win, mult, phones: phoneCount, added: add, left, capped: cut });
        if (cut) capped = true;
      }
      if (S) { out.totalSpins = awarded; out.added = awarded - startSpins; out.totalTenths = total; out.capped = capped; }
      return { total, capped, script: out };
    }

    /* QUOTE ACCEPTED. start = number of bubbles that dropped into the form. */
    function playQuote(rng, S, capLeft, start) {
      const amt = new Array(BOXES).fill(0), ups = new Array(BOXES).fill(0), full = new Array(BOXES).fill(false);
      const order = []; for (let i = 0; i < BOXES; i++) order.push(i);
      const startBoxes = [];
      for (let i = 0; i < start; i++) { const j = i + Math.floor(rng() * (BOXES - i)); const t = order[i]; order[i] = order[j]; order[j] = t; }
      for (let i = 0; i < start; i++) { const b = order[i]; amt[b] = drawQuoteAmt(rng); full[b] = true; if (S) startBoxes.push({ box: b, amt: amt[b] }); }
      let filled = start, left = cfg.respins;
      const respins = S ? [] : null;
      while (left > 0 && filled < BOXES) {
        const landed = [];
        for (let b = 0; b < BOXES; b++) {
          if (full[b] || rng() >= cfg.landP) continue;
          full[b] = true; filled++;
          if (rng() < cfg.upsellP) { ups[b] = 1; landed.push({ box: b, upsell: true }); }
          else { amt[b] = drawQuoteAmt(rng); landed.push({ box: b, amt: amt[b] }); }
        }
        if (landed.length) left = cfg.respins; else left--;
        if (S) respins.push({ n: respins.length + 1, landed, left, reset: landed.length > 0 });
      }
      let total = 0, allFull = true; const fields = S ? [] : null;
      for (let f = 0; f < FIELDS.length; f++) {
        const F = FIELDS[f]; let sum = 0, u = 0, n = 0;
        for (let b = F.from; b < F.from + F.size; b++) { sum += amt[b]; u += ups[b]; if (full[b]) n++; }
        const doubles = Math.min(u, cfg.maxUpsellDoubles), m = 1 << doubles;
        const done = n === F.size; if (!done) allFull = false;
        const prize = done ? cfg.fieldPrize[F.id] : 0, fieldTotal = sum * m + prize;
        total += fieldTotal;
        if (S) fields.push({ id: F.id, name: F.name, tier: F.tier, size: F.size, filled: n, done, sum, upsells: u, mult: m, prize, total: fieldTotal });
      }
      const grand = allFull ? cfg.grandPrize : 0; total += grand;
      let capped = false;
      if (total >= capLeft) { total = Math.max(0, capLeft); capped = true; }
      return { total, capped, grand: allFull, script: S ? { kind: 'quote', start: startBoxes, startCount: start, respins, fields, grand: allFull, grandPrize: grand, totalTenths: total, capped } : null };
    }

    /* One paid round. buy: null | 'rotary' | 'quote'. opts: {script:bool, force:'rotary'|'quote'|'both'} (force is a QA hook that rerolls the base
       spin until it triggers; never used by the server). Wins and costs are tenths of the bet. */
    function round(rng, buy, opts) {
      const S = !!(opts && opts.script), force = opts && opts.force;
      const res = { buy: buy || null, costTenths: buy ? cfg.buyCost[buy] : 10, winTenths: 0, baseTenths: 0, rotaryTenths: 0, quoteTenths: 0, rotary: false, quote: false, capped: false, grand: false, script: null };
      const features = S ? [] : null;
      let capLeft = capT;
      if (!buy) {
        let tries = 0, wins;
        for (;;) {
          fill(rng, BASE);
          wins = S ? [] : null;
          res.baseTenths = evalWays(1, wins);
          const hasR = phoneMask === 21, hasQ = quoteCount >= QUOTE_TRIGGER;
          if (!force || tries++ > 200000 || (force === 'rotary' ? hasR : force === 'quote' ? hasQ : hasR && hasQ)) break;
        }
        res.rotary = phoneMask === 21; res.quote = quoteCount >= QUOTE_TRIGGER;
        if (res.baseTenths >= capLeft) { res.baseTenths = capLeft; res.capped = true; res.rotary = res.quote = false; }
        capLeft -= res.baseTenths;
        if (S) res.script = { v: 1, buy: null, base: { grid: gridOut(), wins, winTenths: res.baseTenths, phones: cellsOf(PHONE), quotes: cellsOf(QUOTE), tease: (phoneMask & 5) === 5, triggers: [res.quote ? 'quote' : null, res.rotary ? 'rotary' : null].filter(Boolean) }, features };
        const nq = quoteCount;
        if (res.quote) { const q = playQuote(rng, S, capLeft, nq); res.quoteTenths = q.total; capLeft -= q.total; if (q.capped) res.capped = true; if (q.grand) res.grand = true; if (S) features.push(q.script); }
        if (res.rotary) { const r = playRotary(rng, S, capLeft); res.rotaryTenths = r.total; capLeft -= r.total; if (r.capped) res.capped = true; if (S) features.push(r.script); }
      } else {
        if (S) res.script = { v: 1, buy, base: null, features };
        if (buy === 'rotary') { res.rotary = true; const r = playRotary(rng, S, capLeft); res.rotaryTenths = r.total; if (r.capped) res.capped = true; if (S) features.push(r.script); }
        else { res.quote = true; const q = playQuote(rng, S, capLeft, drawStartQuotes(rng)); res.quoteTenths = q.total; if (q.capped) res.capped = true; if (q.grand) res.grand = true; if (S) features.push(q.script); }
      }
      res.winTenths = res.baseTenths + res.rotaryTenths + res.quoteTenths;
      if (res.winTenths >= capT) { res.winTenths = capT; res.capped = true; }
      res.winX = res.winTenths / 10; res.tier = winTier(res.winX);
      if (S) { res.script.winTenths = res.winTenths; res.script.costTenths = res.costTenths; res.script.tier = res.tier; res.script.capped = res.capped; res.script.maxWinTenths = capT; }
      return res;
    }

    return { round, playRotary, playQuote, cfg, PAY, quoteCountDist, triggerP: triggerCdf.tot, strips: { BASE, FREE } };
  }

  // whole cents for a tenths amount at a bet level; throws if it would not be an exact integer (it always is for BET_LEVELS)
  function cents(tenths, bet) {
    const c = tenths * bet / 10;
    if (!Number.isSafeInteger(tenths) || !Number.isSafeInteger(bet) || bet % 10 !== 0 || !Number.isSafeInteger(c)) throw new Error('not whole cents');
    return c;
  }

  const engine = createEngine();
  // Resolves one full paid round with the injected rng (() => [0,1)). buy: null | 'rotary' | 'quote'.
  function resolveRound(rng, buy, opts) {
    const r = engine.round(rng, buy, { script: true, ...(opts || {}) });
    return { round: r, buy: r.buy, costTenths: r.costTenths, winTenths: r.winTenths, winX: r.winX, capped: r.capped, tier: r.tier, script: r.script };
  }

  return { createEngine, engine, resolveRound, rngFrom, winTier, cents, TIERS, CFG, SYM, FIELDS, FIELD_OF, BET_LEVELS, COLS, ROWS, BOXES, QUOTE_TRIGGER, MAX_WIN_X, MAX_WIN_T, NREG };
});
