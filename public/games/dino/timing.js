/* DINO animation timing (ms unless noted). Every phase the client replays reads its duration from here.
   Source: _dino/TIMING.md (reference measured on a public demo). Tags: [M] measured in TIMING.md, [E] estimated / our choice.
   "Row" names below are the TIMING.md summary-table rows. game.js reads DINO_T.normal / DINO_T.turbo; fx.js has its own DinoFX.T
   (overlay timings, set at the bottom of this file). Quick mode (0.6-0.72 s drop, ~1.5 s tumble) has no UI toggle, so it has no set. */
window.DINO_T = {
  normal: {
    // Row "Press to first grid motion" ~150-300 ms [M]: the server round-trip. Standalone adds this lead; in the bridge the real latency counts toward it.
    pressLead: 250,
    // MOTION (clip-measured, _dino/qa-motion/motion-measure.md; the clip wins over TIMING.md where they differ)
    // Old symbols fall out: ~300 ms per tile, gravity ease-in, diagonal stagger: ~58 ms per column and ~62 ms per row, bottom row first [clip: "out"]
    outDur: 300,
    outColStagger: 58,
    outRowStagger: 62,
    // Gap from a column's last old tile leaving to its first new tile starting: ~140 ms [clip: "out end to in start"] (TIMING.md "Gap" 150-200)
    outInGap: 140,
    // New symbols: ~52 ms per column, ~55 ms per row (bottom first); 240 ms fall + 170 ms ringing tail [clip: "in"] (TIMING.md "480-560 in")
    inColStagger: 52,
    inRowStagger: 55,
    inFall: 240,
    // Every new tile falls this many cells (the column queues above the board; tiles are ~2.4 cells apart in flight in the clip) [clip: "in"]
    inDist: 6,
    inTail: 170,
    // Tail shape, % of one cell: contact, then +14 down, -3 back, +2, rest [clip: overshoot +14/-3/+2]
    overshoot: 15,
    ring1: -3.5,
    ring2: 2.4,
    // Squash/stretch at contact and at the overshoot peak (scaleX, scaleY) [E, polish]
    stretch: [0.965, 1.06],
    squash: [1.05, 0.93],
    // Wobble starts ~80 ms after the last contact, i.e. this many ms before the tail ends [clip: "wobble +80 ms after landing"]
    landEarly: 90,
    // Row "Land to winning-symbol highlight" 280-480 ms [M] -> the clip puts the wobble 80 ms after landing, the pop 840 ms after it
    landSettle: 0,
    // Wobble + glow until the pop starts: last contact to pop onset = 840 ms [clip] = (inTail - landEarly) + landSettle + hlDur
    hlDur: 760,
    // Pop ~270 ms (bubble swell, frost, falling shards) [clip: "pop"] (TIMING.md 250-320)
    popDur: 270,
    // Hole hold ~250 ms [clip] (TIMING.md 350-400)
    holeHold: 230,
    // Refill: survivors fall 230 + 22 ms per row travelled, then the same ringing tail; columns start ~55 ms apart, left to right [clip: "refill"]
    // (TIMING.md said "all columns together, no column stagger": the clip shows a stagger)
    fallBase: 230,
    fallPerRow: 22,
    refillColStagger: 55,
    // Win label rises at the pop and floats through the hold [M] (frames)
    popupLife: 900,
    // Row "No-win end to collect request" ~0-200 ms [M]
    endHold: 150,
    // Row "Free spin with no win, spin to spin" 2.26-2.29 s [M]: pressLead + full drop + fsGap = ~2.27 s (the board has also landed by then)
    fsGap: 550,
    // Landing emphasis on a scatter / bomb. Does not delay anything (bombs land like normal symbols: Row "Bomb landing") [E]
    scatterLand: 420,
    // Row "Win box count per tumble": the box counts while the cells pop and refill, so it adds no time [E]
    countStep: 400,
    // Row "Sequence end to bombs start flying" ~1.2 s, bombs glow [M]
    bombGlow: 1200,
    // Row "Bomb flies into TUMBLE WIN plaque" 0.6-0.75 s per bomb, one after another [M]; the flight itself is DinoFX.T.bombFly
    bombFly: 650,
    // Row "Plaque shows the multiplied total" ~0.7 s slam [M]
    slamDur: 700,
    // Row "FS trigger: scatter celebration + move to intro" ~4.8 s [M]
    triggerCelebrate: 4800,
    // Row "Intro click to first FS drop" ~0.7 s transition [M]; counts from the click, the card fade is part of it
    introOut: 700,
    // Row "Last FS to outro card": last spin settles (~fsGap) then ~0.5 s card transition [M]; "Outro click to base game" ~1.0 s [M]
    outroIn: 500,
    outroOut: 1000,
    // Autoplay screens: the card closes by itself after this long (clicks always work) [E, TIMING.md "Proposed dino defaults": 8 s]
    cardAuto: 8000,
    // Row "Banner close after skip/finish" ~1.0-1.5 s fade is DinoFX.T.bigClose/bigHold
    toast: 2200
  },
  turbo: {
    // Rows "Full drop" 0.56-0.64 s and "Column stagger: none, all columns together" [M]; motion shape as normal, full drop (first motion to last contact) ~0.6 s
    pressLead: 120, outDur: 240, outColStagger: 0, outRowStagger: 8, outInGap: 70, inColStagger: 0, inRowStagger: 8, inFall: 235, inDist: 6, inTail: 90,
    overshoot: 10, ring1: -2, ring2: 1, stretch: [0.975, 1.04], squash: [1.035, 0.955], landEarly: 45,
    // Row "One whole tumble step" 1.20-1.37 s [M]: (tail-landEarly)+landSettle+hlDur+popDur+holeHold+fall+tail ~ 1.3 s
    landSettle: 150, hlDur: 330, popDur: 180, holeHold: 200, fallBase: 190, fallPerRow: 18, refillColStagger: 0, popupLife: 600,
    endHold: 100, fsGap: 250, scatterLand: 220, countStep: 250,
    bombGlow: 700, bombFly: 400, slamDur: 450, triggerCelebrate: 2000, introOut: 400, outroIn: 300, outroOut: 600, cardAuto: 5000, toast: 1600
  },

  // Win count-up (Row "Big-win count-up": the reference counts ~1.5-2x bet per second, near linear, which takes minutes on big wins) [E]
  // Banner wins: ms = clamp(winX / rate * 1000, min, max), linear count, click skips. Our tier banners escalate as the shown value crosses
  // the server's state.tiers thresholds (fx.js bigWin). Example at rate 1.8: 10x -> 5.6 s, 25x -> 12 s (cap), 500x -> 12 s.
  count: {
    normal: { rate: 1.8, min: 1500, max: 12000 },
    turbo: { rate: 4, min: 900, max: 5000 }
  },
  // Wins below the banner threshold: ms = clamp(base + perX * winX, min, max) -> 0.5 to 1.2 s [E]
  smallCount: { base: 450, perX: 80, min: 500, max: 1200 },
  // Banner threshold: the lowest tier (our names, thresholds come from the server's state.tiers) that gets a full-screen banner [E]
  bannerFrom: 'big',

  skip: 0.2,            // duration multiplier once the player taps to speed up [E]
  reduced: 0.7          // duration multiplier under prefers-reduced-motion [E]
};

/* Helpers so game.js has no timing math of its own. */
window.DINO_T.countMs = function (winX, turbo) {
  var c = window.DINO_T.count[turbo ? 'turbo' : 'normal'];
  return Math.round(Math.min(c.max, Math.max(c.min, winX / c.rate * 1000)));
};
window.DINO_T.smallMs = function (winX) {
  var s = window.DINO_T.smallCount;
  return Math.round(Math.min(s.max, Math.max(s.min, s.base + s.perX * winX)));
};

/* DinoFX overlay timings: fx.js reads these when it loads (it falls back to its own defaults if timing.js is missing). */
window.DINO_FX_T = {
  bombFly: 650,         // default flight; game.js passes the per-mode value (normal.bombFly / turbo.bombFly)
  bombPunch: 225,       // same row: hit flash ~200-250 ms [M]
  bigHold: 1200,        // Row "Banner close after skip/finish" ~1.0-1.5 s incl. fade [M]
  bigClose: 300,
  skipGuard: 160,       // ignore a click this soon after a banner opens (accidental double tap) [E]
  fade: 260,            // card fade-out [E]
  cardIn: 500,          // Row "Last FS to outro card" ~0.5 s card transition [M]
  retrigger: 1200       // [E]
};
