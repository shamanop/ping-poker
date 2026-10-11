/* DINO: UI controller. The server resolves a round into a script (see _dino/SCRIPT-FORMAT.md); this file only REPLAYS it.
   Two modes: bridge (?bridge=1 inside the shell, server-authoritative) and standalone (local demo with DinoEngine and a fake balance; ?seed=N, ?force=bonus, ?bet=N). */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const Q = new URLSearchParams(location.search);
  const COLS = 6, ROWS = 5;
  const RANK = ['none', 'nice', 'great', 'big', 'huge', 'mega', 'epic'];
  const BRIDGE = Q.get('bridge') === '1' && window.parent !== window;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const SYM = window.DinoSymbols || {
    svg: (s, m) => `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#667"/><text x="50" y="62" font-size="34" text-anchor="middle" fill="#fff">${s === 'B' ? 'x' + m : s}</text></svg>`,
    name: (s) => s, color: () => '#aab'
  };
  const A = window.DinoAudio || null;
  const FX = Object.assign({
    init() {}, burst() {}, popBurst() {}, shake() {}, flash() {}, confetti() {}, clear() {},
    bigWin: () => Promise.resolve(), bombFly: () => Promise.resolve(), fsIntro: () => Promise.resolve(), fsOutro: () => Promise.resolve(), retrigger: () => Promise.resolve(),
    countUp(el, from, to, ms, f) { el.textContent = f(to); return Promise.resolve(); }
  }, window.DinoFX || {});

  const stageEl = $('stage'), boardEl = $('board'), cellsEl = $('cells'), popsEl = $('pops'), ov = $('ov');
  const winEl = $('win'), multEl = $('mult');

  // ---------- state ----------
  const st = { bal: 0, shown: 0, betIdx: 0, ante: false, turbo: Q.get('turbo') === '1', auto: 0, busy: false, skip: false, free: false, last: null };
  let S = null;                       // state in the server's shape (betLevels, anteLevels, cfg, tiers, ...)
  const money = { live: false, mode: 'play', modeTaken: false, wallet: { play: 0, chips: 0 } };
  const E = window.DinoEngine || null;
  const seed = Q.has('seed') ? Number(Q.get('seed')) >>> 0 : (crypto.getRandomValues(new Uint32Array(1))[0]);
  const rng = E ? E.rngFrom(seed) : null;
  const engine = E ? E.createEngine(E.CFG) : null;

  const bets = () => (S && S.betLevels) || [100];
  const bet = () => bets()[st.betIdx] || bets()[0];
  const inAnte = (b) => !!(S && S.anteLevels && S.anteLevels.includes(b));
  const anteCost = (b) => Math.round(b * ((S && S.anteCost) || 1.25));
  const buyCost = (b) => Math.round(b * ((S && S.buyCostX) || 100));
  const u = (x, b) => Math.round(x * (b == null ? bet() : b));      // x bet -> whole units, display only

  // ---------- money formatting ----------
  const dollars = (n) => { const c = Math.round(n), a = Math.abs(c); return (c < 0 ? '-' : '') + '$' + Math.floor(a / 100).toLocaleString('en-US') + '.' + String(a % 100).padStart(2, '0'); };
  const P = (() => { try { return window.parent && window.parent !== window && window.parent.Money ? window.parent : window; } catch (e) { return window; } })();
  const wUnit = () => (money.mode === 'chips' ? 'chips' : 'cents');
  let fmt = dollars;
  const liveFmt = () => (P.Money && P.Money.format ? (n) => P.Money.format(Math.round(n), P.Money.modeFor(P.Money.pref, wUnit())) : (money.mode === 'chips' ? (n) => Math.round(n).toLocaleString('en-US') : dollars));
  const walletBal = () => (money.mode === 'chips' ? money.wallet.chips : money.wallet.play);
  const avail = () => (money.live ? walletBal() : st.bal);

  // ---------- timing / skip ----------
  const TT = () => window.DINO_T[st.turbo ? 'turbo' : 'normal'];
  const dur = (ms) => ms * (st.skip ? window.DINO_T.skip : 1) * (reduce ? window.DINO_T.reduced : 1);
  const tt = (k) => dur(TT()[k]);
  const trace = (phase) => { if (window.DINO_TRACE) window.DINO_TRACE.push({ t: performance.now(), phase }); };
  const active = new Set(), waiters = new Set();
  function wait(k) {
    return new Promise((res) => { const w = { res }; w.t = setTimeout(() => { waiters.delete(w); res(); }, typeof k === 'number' ? dur(k) : tt(k)); waiters.add(w); });
  }
  function anim(el, kf, o) {
    const a = el.animate(kf, Object.assign({ fill: 'backwards' }, o));
    if (st.skip) a.playbackRate = 6;
    active.add(a);
    const done = () => active.delete(a);
    a.finished.then(done, done);
    return a.finished.catch(() => {});
  }
  function skipNow() {
    if (!st.busy || st.skip) return;
    st.skip = true;
    for (const a of active) { try { a.playbackRate = 6; } catch (e) { /* finished */ } }
    for (const w of [...waiters]) { clearTimeout(w.t); waiters.delete(w); w.res(); }
  }

  // ---------- messages / small UI ----------
  let msgT = 0;
  function msg(text, o) {
    const el = $('msg'); el.textContent = text || ''; el.classList.toggle('err', !!(o && o.err));
    clearTimeout(msgT); if (text && !(o && o.hold)) msgT = setTimeout(() => { el.textContent = ''; }, (o && o.ms) || 2600);
  }
  function punch(el) { el.classList.remove('punch'); void el.offsetWidth; el.classList.add('punch'); }
  function setBal(n) { st.shown = n; $('bal').textContent = fmt(n); }
  function drawBet() {
    const b = bet();
    $('bet').textContent = fmt(b);
    $('cost').textContent = st.ante ? 'Total ' + fmt(anteCost(b)) : '';
    const ok = inAnte(b);
    const ante = $('ante');
    ante.setAttribute('aria-checked', st.ante ? 'true' : 'false');
    ante.disabled = st.busy || !ok;
    $('anteSub').textContent = ok ? (st.ante ? 'ON  +25% cost' : 'x' + ((S && S.anteCost) || 1.25) + ' bet') : 'Not at this bet';
    ante.title = ok ? 'Pay a little more per spin for better scatter odds' : 'Ante is only offered at bets where 1.25x is a whole amount';
    const buy = $('buy');
    buy.disabled = st.busy || st.ante;
    $('buyPrice').textContent = st.ante ? 'Off with ante' : fmt(buyCost(b));
    buy.title = st.ante ? 'Turn ante off to buy the feature' : 'Buy the free spins feature';
    $('betDn').disabled = st.busy || st.betIdx <= 0;
    $('betUp').disabled = st.busy || st.betIdx >= bets().length - 1;
    $('turbo').classList.toggle('on', st.turbo); $('turbo').setAttribute('aria-pressed', st.turbo);
    $('auto').classList.toggle('on', st.auto > 0); $('auto').textContent = st.auto > 0 ? 'Stop ' + st.auto : 'Auto';
  }
  function setBusy(b) {
    st.busy = b; $('spin').classList.toggle('busy', b);
    if (!b) { st.skip = false; }
    drawBet(); $('info').disabled = b;
  }

  // ---------- board ----------
  const els = new Map();          // cell id -> { el, c, r, cell }
  let cur = null;                 // current grid of cell objects [c][r]
  const place = (el, c, r) => { el.style.left = (c * 100 / COLS) + '%'; el.style.top = (r * 100 / ROWS) + '%'; };
  function mkCell(cell, c, r) {
    const el = document.createElement('div');
    el.className = 'cell s-' + cell.s; el.style.setProperty('--c', SYM.color(cell.s));
    el.innerHTML = SYM.svg(cell.s, cell.m); place(el, c, r); cellsEl.appendChild(el);
    const rec = { el, c, r, cell }; els.set(cell.id, rec); return rec;
  }
  // One tile falling in: gravity ease-in for fallMs (contact), then a downward overshoot that rings out over inTail
  // (+overshoot %, ring1, ring2, rest; motion-measure.md "in"), stretching at contact and squashing at the peak. Transforms/opacity only.
  const GRAV = 'cubic-bezier(.35,.15,.8,.65)';   // the clip's fall is close to constant speed with a mild acceleration (motion-measure.md "fall profile")
  function dropKF(dist, fallMs) {
    const T = TT(), D = fallMs + T.inTail, f = (ms) => +(ms / D).toFixed(4);
    const tf = (y, sx, sy) => `translateY(${y}%) scale(${sx}, ${sy})`;
    return [
      { transform: tf(-dist * 100, 1, 1), offset: 0, easing: GRAV },
      { transform: tf(0, T.stretch[0], T.stretch[1]), offset: f(fallMs), easing: 'cubic-bezier(.2,.65,.4,1)' },
      { transform: tf(T.overshoot, T.squash[0], T.squash[1]), offset: f(fallMs + T.inTail * 0.3), easing: 'ease-in-out' },
      { transform: tf(T.ring1, 1.01, 0.99), offset: f(fallMs + T.inTail * 0.62), easing: 'ease-in-out' },
      { transform: tf(T.ring2, 1, 1), offset: f(fallMs + T.inTail * 0.85), easing: 'ease-in-out' },
      { transform: tf(0, 1, 1), offset: 1 }
    ];
  }
  // Soft contact shadow under a landing tile (the .cell::after pseudo-element, opacity only)
  function landShadow(el, delayMs, fallMs) {
    const T = TT();
    // created at contact time, not up front, so the 30 tiles of a board drop do not all pay for it in one task
    setTimeout(() => {
      if (!el.isConnected) return;
      try { anim(el, [{ opacity: 0, transform: 'scaleX(.6)' }, { opacity: 0.55, transform: 'scaleX(1.1)', offset: 0.25 }, { opacity: 0, transform: 'scaleX(1)' }], { duration: dur(T.inTail + 90), easing: 'ease-out', pseudoElement: '::after' }); } catch (e) { /* pseudo-element animations unsupported: no shadow */ }
    }, dur(delayMs + fallMs - 20));
  }
  function stagePt(c, r) {
    const sr = stageEl.getBoundingClientRect(), br = boardEl.getBoundingClientRect();
    return [br.left - sr.left + (c + 0.5) / COLS * br.width, br.top - sr.top + (r + 0.5) / ROWS * br.height];
  }
  function fillIdle() {
    const pool = ['h1', 'h2', 'h3', 'h4', 'l1', 'l2', 'l3', 'l4', 'l5'];
    cur = []; let n = 0;
    for (let c = 0; c < COLS; c++) { cur[c] = []; for (let r = 0; r < ROWS; r++) { const cell = { id: 'i' + (++n), s: pool[Math.floor(Math.random() * pool.length)], m: 0 }; cur[c][r] = cell; mkCell(cell, c, r); } }
  }
  // Old board falls out tile by tile (bottom-left first), a short gap, then the new board drops in with the same diagonal stagger.
  // Resolves landEarly ms before the last tile's tail ends (the win wobble starts ~80 ms after contact); the tails keep ringing.
  async function dropBoard(grid) {
    const T = TT(), olds = [...els.values()], outs = [], ins = [];
    const inBase = olds.length ? T.outDur + (ROWS - 1) * T.outRowStagger + T.outInGap : 0;
    els.clear();
    trace('dropStart');
    for (const o of olds) {
      outs.push(anim(o.el, [{ transform: 'translateY(0)' }, { transform: `translateY(${(ROWS + 1 - o.r) * 100}%)` }],
        { duration: tt('outDur'), delay: dur(o.c * T.outColStagger + (ROWS - 1 - o.r) * T.outRowStagger), easing: GRAV, fill: 'forwards' }));
    }
    Promise.all(outs).then(() => olds.forEach((o) => o.el.remove()));
    let contact = 0;
    const sndCol = [], sndSpecial = [];
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
      // Every new tile falls the same distance (they queue up above the board, ~2.4 cells apart in flight as in the clip); the stagger is in the start times
      const rec = mkCell(grid[c][r], c, r), delay = inBase + c * T.inColStagger + (ROWS - 1 - r) * T.inRowStagger, hit = delay + T.inFall, f = T.inFall;
      ins.push(anim(rec.el, dropKF(T.inDist, f), { duration: dur(f + T.inTail), delay: dur(delay) }));
      landShadow(rec.el, delay, f);
      contact = Math.max(contact, hit);
      if (r === ROWS - 1) sndCol.push([hit, c]);
      if (grid[c][r].s === 'S' || grid[c][r].s === 'B') sndSpecial.push([hit, grid[c][r]]);
    }
    if (A) {
      sndCol.forEach(([t, c]) => setTimeout(() => A.land(c), dur(t)));
      let nSc = 0;
      sndSpecial.sort((a, b) => a[0] - b[0]).forEach(([t, cell]) => setTimeout(() => {
        if (cell.s === 'S') A.scatterLand(++nSc); else A.bombLand(A.bombTier(cell.m));
      }, dur(t)));
    }
    await Promise.race([wait(contact + T.inTail - T.landEarly), Promise.all(ins)]);
    cur = grid;
    trace('landed');
  }
  function emphasize(rec) {
    anim(rec.el, [{ transform: 'scale(1)' }, { transform: 'scale(1.35)', offset: 0.4 }, { transform: 'scale(1)' }], { duration: tt('scatterLand'), easing: 'ease-out', composite: 'add' });
    const [x, y] = stagePt(rec.c, rec.r); FX.burst(x, y, SYM.color(rec.cell.s), 10);
  }
  function landEmphasis(filter) {
    for (const rec of els.values()) if ((rec.cell.s === 'S' || rec.cell.s === 'B') && (!filter || filter(rec))) emphasize(rec);
  }
  function markScatters() {
    const sc = [...els.values()].filter((r) => r.cell.s === 'S');
    sc.forEach((r) => r.el.classList.toggle('sc', sc.length >= 3));
    return sc;
  }
  function popup(text, cx, cy, color) {
    const el = document.createElement('div'); el.className = 'pop'; el.textContent = text; el.style.setProperty('--c', color || '#fff');
    el.style.left = Math.max(14, Math.min(86, (cx + 0.5) / COLS * 100)) + '%'; el.style.top = Math.max(8, Math.min(92, (cy + 0.5) / ROWS * 100)) + '%';
    popsEl.appendChild(el);
    const life = dur(TT().popupLife);
    anim(el, [{ transform: 'translate(-50%,-50%) scale(.4)', opacity: 0 }, { transform: 'translate(-50%,-70%) scale(1.15)', opacity: 1, offset: 0.2 }, { transform: 'translate(-50%,-110%) scale(1)', opacity: 1, offset: 0.75 }, { transform: 'translate(-50%,-150%) scale(1)', opacity: 0 }], { duration: life, easing: 'ease-out', fill: 'both' }).then(() => el.remove());
  }

  // ---------- win counter ----------
  function setWin(to, ms) {
    const from = st.shown2 == null ? 0 : st.shown2; st.shown2 = to;
    if (!ms || ms < 30) { winEl.textContent = fmt(to); return Promise.resolve(); }
    return FX.countUp(winEl, from, to, ms, fmt);
  }
  const resetWin = () => { st.shown2 = 0; winEl.textContent = fmt(0); };
  function setMult(v, hit) { multEl.textContent = 'x' + v; if (hit) punch(multEl); }

  // ---------- replay: one tumble step ----------
  async function playStep(step, o) {
    const T = TT();
    await wait('landSettle');
    const hl = step.removed.map(([c, r]) => els.get(cur[c][r].id)).filter(Boolean);
    hl.forEach((rec) => { rec.el.classList.add('hl'); });
    trace('hl');
    await wait('hlDur');
    trace('pop');
    for (const w of step.wins) {
      let cx = 0, cy = 0; for (const [c, r] of w.cells) { cx += c; cy += r; } cx /= w.cells.length; cy /= w.cells.length;
      popup('+' + fmt(u(w.pay, o.bet)), cx, cy, SYM.color(w.s));
    }
    o.acc += step.stepWin;
    A && A.pop(++o.stepN, step.wins.map((w) => w.s));
    const counting = setWin(u(o.base + o.acc, o.bet), tt('countStep'));
    // pop: bubble swells, frosts and fades while shards drop (motion-measure.md "pop")
    const sz = boardEl.getBoundingClientRect().height / ROWS;
    await Promise.all(hl.map((rec) => {
      rec.el.classList.remove('hl');
      const [x, y] = stagePt(rec.c, rec.r);
      setTimeout(() => FX.popBurst(x, y, SYM.color(rec.cell.s), sz), dur(T.popDur * 0.3));
      return anim(rec.el, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(1.15)', opacity: 1, offset: 0.35 }, { transform: 'scale(1.24)', opacity: 0.55, offset: 0.7 }, { transform: 'scale(1.3)', opacity: 0 }], { duration: tt('popDur'), easing: 'ease-out', fill: 'forwards' });
    }));
    hl.forEach((rec) => { rec.el.remove(); els.delete(rec.cell.id); });
    trace('popEnd');
    await wait('holeHold');
    trace('fallStart');
    A && setTimeout(() => A.refill(), dur(T.fallBase));
    const list = [], perCol = {};
    const fallMs = (d) => T.fallBase + T.fallPerRow * d;
    let contact = 0;
    const drop = (rec, d) => {
      const delay = rec.c * T.refillColStagger, f = fallMs(d);
      list.push(anim(rec.el, dropKF(d, f), { duration: dur(f + T.inTail), delay: dur(delay) }));
      landShadow(rec.el, delay, f);
      contact = Math.max(contact, delay + f);
    };
    for (const f of step.fall) {
      const rec = els.get(f.id); if (!rec) continue;
      rec.r = f.to; place(rec.el, rec.c, f.to);
      drop(rec, f.to - f.from);
    }
    for (const sp of step.spawn) perCol[sp.c] = (perCol[sp.c] || 0) + 1;
    const fresh = [];
    for (const sp of step.spawn) {
      const k = perCol[sp.c], rec = mkCell(sp.cell, sp.c, sp.r); fresh.push(rec);
      drop(rec, k + 1);
    }
    await Promise.race([wait(contact + T.inTail - T.landEarly), Promise.all(list)]);
    cur = step.grid;
    trace('refilled');
    if (A) fresh.forEach((rec) => { if (rec.cell.s === 'S') A.scatterLand([...els.values()].filter((x) => x.cell.s === 'S').length); else if (rec.cell.s === 'B') A.bombLand(A.bombTier(rec.cell.m)); });
    landEmphasis((rec) => fresh.includes(rec));
    markScatters();
    await counting;
  }

  // mascot poses (mascot.js); a no-op when the layer is missing
  const mascot = (pose, opts) => { if (window.DinoMascot) window.DinoMascot.set(pose, opts); };

  // ---------- replay: one spin (base or free) ----------
  // o = { bet, base (x bet already in the round total), free }
  async function playSpin(sp, o) {
    o.acc = 0;
    o.stepN = 0;
    const t0 = o.t0 || performance.now();
    trace(o.free ? 'fsSpin' : 'spin');
    A && A.spinStart(!!o.free);
    setMult(0); $('multbox').hidden = !o.free;
    popsEl.textContent = '';
    if (o.lead !== false) await wait(Math.max(0, TT().pressLead - (performance.now() - t0)));
    await dropBoard(sp.initial);
    landEmphasis(); markScatters();
    if (!o.free && window.DinoMascot) {
      let n = 0; for (const col of sp.initial) for (const x of col) if (x && x.s === 'S') n++;
      if (n === Math.min(...Object.keys(S.cfg.scatterPay).map(Number)) - 1) mascot('shock', { holdMs: 900 }); // one scatter short of the feature
    }
    for (const step of sp.steps) await playStep(step, o);
    const b = o.bet;
    // bombs: collected at the end of a winning spin
    const bombRecs = sp.bombs.map((bb) => els.get(bb.id)).filter(Boolean);
    if (sp.bombApplied) {
      bombRecs.forEach((rec) => rec.el.classList.add('hl'));
      trace('bombGlow');
      await wait('bombGlow');
      let sum = 0;
      for (const bb of sp.bombs) {
        const rec = els.get(bb.id);
        trace('bombFly');
        A && A.bombFly();
        const fly = FX.bombFly(rec ? rec.el : null, multEl, 'x' + bb.m, tt('bombFly'));
        if (rec) { rec.el.classList.remove('hl'); anim(rec.el, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.3)', opacity: 0 }], { duration: dur(180), easing: 'ease-in', fill: 'forwards' }); }
        await fly;
        sum += bb.m; setMult(sum, true);
        A && A.bombCollect(sum);
        if (bb.m >= 50 && window.DinoMascot) mascot('shock', { holdMs: 700 });
        trace('bombHit');
      }
      trace('slam');
      A && A.slam();
      st.shown2 = u(o.base + sp.spinWin, b);
      winEl.textContent = fmt(st.shown2);
      FX.flash('#35d0ba', 200);
      anim(winEl, [{ transform: 'scale(2)', color: '#35d0ba' }, { transform: 'scale(1)' }], { duration: tt('slamDur'), easing: 'cubic-bezier(.2,.9,.3,1.15)' });
      await wait('slamDur');
      trace('slamEnd');
    } else if (bombRecs.length) bombRecs.forEach((rec) => rec.el.classList.add('dim'));
    if (sp.scatterPay > 0) {
      popup('SCATTER +' + fmt(u(sp.scatterPay, b)), 2.5, 2, '#ffc21a');
      await setWin(u(o.base + sp.total, b), tt('countStep'));
    }
    trace('spinEnd');
    return sp.total != null ? sp.total : sp.spinWin;
  }

  // ---------- replay: whole round ----------
  async function replay(p) {
    const R = p.round, b = p.bet;
    A && A.round({ win: p.totalWin, stake: p.cost != null ? p.cost : p.bet });
    resetWin(); popsEl.textContent = '';
    setFree(false);
    const o = { bet: b, base: 0, free: false, t0: st.pressT };
    await playSpin(R.base, o);
    let run = R.base.spinWin;
    if (R.bonus && R.base.scatters >= 4) {
      const sc = [...els.values()].filter((r) => r.cell.s === 'S');
      sc.forEach((r) => { r.el.classList.add('sc'); });
      FX.flash('#ffc21a', 260); if (!reduce) FX.shake(380, 5);
      msg(R.base.scatters + ' SCATTERS', { hold: true });
      trace('trigger');
      A && A.fsTrigger();
      window.DinoMascot && mascot('celebrate');
      let counting = null;
      if (R.scatterPay > 0) { popup('SCATTER +' + fmt(u(R.scatterPay, b)), 2.5, 2, '#ffc21a'); run += R.scatterPay; counting = setWin(u(run, b), tt('countStep')); }
      const celeb = TT().triggerCelebrate, pulses = Math.max(1, Math.round(celeb / 800));
      for (let k = 0; k < pulses; k++) { if (k) sc.forEach((r) => emphasize(r)); await wait(celeb / pulses); }
      await counting;
      msg('');
      trace('introOpen');
      A && A.fsIntro();
      await FX.fsIntro(R.bonus.startSpins, st.auto > 0 ? TT().cardAuto : 0);
      window.DinoMascot && mascot('idle');
      trace('introClosed');
      FX.clear();
      await wait(Math.max(0, TT().introOut - FX.T.fade));
      await runBonus(R, p, run);
    } else if (R.bonus) { /* base alone hit the cap: no bonus */ }
    // the last number is the server's total
    await finishRound(p);
  }
  async function runBonus(R, p, run0) {
    const b = p.bet, B = R.bonus;
    setFree(true);
    let run = run0, bonusTot = 0, total = B.startSpins;
    $('bonusTot').hidden = false; $('bonusTot').querySelector('b').textContent = fmt(0);
    for (let i = 0; i < B.spins.length; i++) {
      const sp = B.spins[i];
      $('fsCount').textContent = 'FREE SPINS ' + (i + 1) + '/' + total; punch($('fsCount'));
      const o = { bet: b, base: run, free: true, lead: i > 0 };
      const t = await playSpin(sp, o);
      run += t; bonusTot += t;
      await setWin(u(run, b), tt('countStep'));
      $('bonusTot').querySelector('b').textContent = fmt(u(bonusTot, b));
      // a spin that hits the max-win cap ends the round: never show its +spins
      const lastSpin = i === B.spins.length - 1;
      if (sp.retrigger && !sp.capped && !(lastSpin && (p.maxed || B.capped))) {
        markScatters().forEach((r) => r.el.classList.add('sc'));
        A && A.retrigger();
        await FX.retrigger(sp.retrigger);
        total += sp.retrigger; $('fsCount').textContent = 'FREE SPINS ' + (i + 1) + '/' + total; punch($('fsCount'));
      }
      await wait('fsGap');
    }
    trace('outroOpen');
    A && A.fsOutro();
    window.DinoMascot && mascot('dance');
    await FX.fsOutro(fmt(p.totalWin), st.auto > 0 ? TT().cardAuto : 0);
    trace('outroClosed');
    window.DinoMascot && mascot('idle');
    FX.clear();
    await wait(Math.max(0, TT().outroOut - FX.T.fade));
    setFree(false);
  }
  function setFree(on) {
    st.free = on; stageEl.classList.toggle('free', on);
    $('fsCount').hidden = !on; $('hint').hidden = on; $('multbox').hidden = !on; $('bonusTot').hidden = !on;
  }
  async function finishRound(p) {
    const tier = p.tier || 'none', winX = p.totalWinMult != null ? p.totalWinMult : (p.bet ? p.totalWin / p.bet : 0);
    const banner = RANK.indexOf(tier) >= RANK.indexOf(window.DINO_T.bannerFrom);
    trace('finish');
    if (banner) {
      winEl.textContent = fmt(st.shown2 || 0);
      const dance = tier !== 'nice' && tier !== 'great';
      if (dance && window.DinoMascot) mascot('dance');
      await FX.bigWin(tier, p.totalWin, fmt, dur(window.DINO_T.countMs(winX, st.turbo)), { tiers: S && S.tiers, winX, from: window.DINO_T.bannerFrom });
      if (dance && window.DinoMascot) mascot('idle');
      FX.clear();
    } else if (p.totalWin > 0) {
      const ms = dur(window.DINO_T.smallMs(winX));
      A && A.countStart(ms, { end: false });
      await setWin(p.totalWin, ms);
      A && A.win(tier, winX);
      if (tier === 'great') FX.confetti(1);
    }
    st.shown2 = p.totalWin; winEl.textContent = fmt(p.totalWin);
    if (p.totalWin > 0) punch(winEl);
    if (p.maxed) msg('MAX WIN', { ms: 3500 });
    await wait('endHold');
    trace('roundEnd');
  }

  // ---------- rounds: local (standalone) or server (bridge) ----------
  const pend = new Map(); let reqSeq = 0;
  const toParent = (m) => { if (BRIDGE) window.parent.postMessage(m, '*'); };
  function localRound(b, ante, buy) {
    const res = engine.round(rng, buy ? 'buy' : ante ? 'ante' : 'spin');
    const cost = buy ? buyCost(b) : ante ? anteCost(b) : b;
    return { roundId: 'local' + (++reqSeq), bet: b, mode: 'play', ante, buy, cost, totalWinMult: res.win, totalWin: Math.round(res.win * b), tier: E.winTier(res.win), maxed: !!res.maxed, round: res };
  }
  function serverRound(b, ante, buy) {
    return new Promise((resolve, reject) => {
      const id = ++reqSeq;
      const t = setTimeout(() => { pend.delete(id); reject(new Error('The server did not answer. Try again.')); }, 10000);
      pend.set(id, { ok: (p) => { clearTimeout(t); resolve(p); }, err: (e) => { clearTimeout(t); reject(e); } });
      toParent({ type: 'spin', reqId: id, bet: b, mode: money.mode, ante: ante ? true : false, buy: buy ? true : false });
    });
  }
  function onResult(m) {
    const w = pend.get(m.reqId); if (!w) return; pend.delete(m.reqId);
    if (m.type === 'error') { w.err(Object.assign(new Error(m.message || 'Spin refused.'), { server: true, code: m.code })); return; }
    const p = m.payload; if (!p || !p.round) { w.err(new Error('Bad result from the server.')); return; }
    w.ok(p);
  }

  async function play(kind) {
    if (st.busy) { skipNow(); return; }
    if (!S || (BRIDGE && !money.live)) { msg(BRIDGE ? 'Connecting...' : 'Not ready', { err: true }); return; }
    const b = bet(), buy = kind === 'buy', ante = st.ante && !buy;
    if (ante && !inAnte(b)) { st.ante = false; drawBet(); return; }
    const cost = buy ? buyCost(b) : ante ? anteCost(b) : b;
    if (avail() < cost) { msg('Not enough balance for this bet.', { err: true }); stopAuto(); return; }
    setBusy(true);
    st.pressT = performance.now(); trace('press');
    FX.clear(); msg('');
    const before = avail();
    let p;
    try {
      p = money.live || BRIDGE ? await serverRound(b, ante, buy) : localRound(b, ante, buy);
    } catch (e) {
      setBusy(false); msg(e.message || 'Spin refused.', { err: true }); stopAuto(); if (money.live) setBal(walletBal()); return;
    }
    if (!money.live) st.bal -= cost; setBal(money.live ? before - cost : st.bal);
    st.last = p;
    try { await replay(p); }
    catch (e) { console.error(e); FX.clear(); setFree(false); st.shown2 = p.totalWin; winEl.textContent = fmt(p.totalWin); }
    if (money.live) { applyWallet(p.balances || p.wallet); setBal(walletBal()); } else { st.bal += p.totalWin; setBal(st.bal); }
    toParent({ type: 'round', win: p.totalWin, tier: p.tier, bet: p.bet });
    setBusy(false);
    if (st.auto > 0) {
      st.auto--;
      if (p.round.bonus || st.auto <= 0) { st.auto = 0; drawBet(); if (p.round.bonus) msg('Autoplay stopped: feature played', { ms: 3000 }); }
      else { drawBet(); setTimeout(() => { if (st.auto > 0 && !st.busy) play('spin'); }, 250); }
    }
  }
  function stopAuto() { if (st.auto) { st.auto = 0; drawBet(); } }

  // ---------- wallet / bridge ----------
  function applyWallet(w) {
    if (!w) return;
    if (typeof w.play === 'number') money.wallet.play = w.play;
    if (typeof w.chips === 'number') money.wallet.chips = w.chips;
    if (money.live && !st.busy) setBal(walletBal());
  }
  function modeUi() {
    const bar = $('modebar'); bar.hidden = !money.live;
    bar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', money.live && b.dataset.m === money.mode));
    $('balLbl').textContent = !money.live ? 'DEMO' : money.mode === 'chips' ? 'CHIPS' : 'BALANCE';
    $('fine').textContent = !money.live ? 'Demo play. No wallet, no real money.' : money.mode === 'chips' ? 'Chips have no cash value.' : '';
  }
  function applyState(s) {
    S = s;
    const lv = bets(); const keep = lv.indexOf(bet());
    const want = Q.has('bet') ? Number(Q.get('bet')) : 100;
    st.betIdx = keep >= 0 && S && st.configured ? keep : Math.max(0, lv.reduce((bi, x, i) => (Math.abs(x - want) < Math.abs(lv[bi] - want) ? i : bi), 0));
    st.configured = true;
    if (!inAnte(bet())) st.ante = false;
    drawBet();
  }
  function goLive(m) {
    const s = m.state || m;
    if (!money.live) money.live = true;
    if (m.mode === 'play' || m.mode === 'chips') {
      if (!money.modeTaken) { money.mode = m.mode; money.modeTaken = true; }
      else if (m.mode !== money.mode) toParent({ type: 'mode', mode: money.mode });
    }
    fmt = liveFmt();
    applyState(s);
    applyWallet(m.wallet || s.balances || s.wallet);
    modeUi(); if (!st.busy) setBal(walletBal()); drawBet();
  }
  if (P.Money && P.Money.onPrefChange) P.Money.onPrefChange(() => { if (money.live) fmt = liveFmt(); if (!st.busy) setBal(avail()); st.shown2 = st.shown2 || 0; drawBet(); });
  function initBridge() {
    $('modebar').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || !money.live || st.busy) return;
      money.mode = b.dataset.m; money.modeTaken = true; fmt = liveFmt(); setBal(walletBal()); modeUi(); drawBet(); toParent({ type: 'mode', mode: money.mode });
    });
    addEventListener('message', (ev) => {
      if (ev.source !== window.parent) return; const m = ev.data || {};
      if (m.type === 'init') goLive(m);
      else if (m.type === 'wallet') { if (money.live) applyWallet(m.wallet || m); }
      else if (m.type === 'result' || m.type === 'error') onResult(m);
    });
    addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ov.firstChild) toParent({ type: 'esc' }); });
    msg('Connecting...', { hold: true });
    let tries = 0; toParent({ type: 'hello' });
    const iv = setInterval(() => { if (money.live || ++tries > 6) { clearInterval(iv); if (!money.live) msg('Could not reach the server. Reopen this window.', { err: true, hold: true }); else msg(''); return; } toParent({ type: 'hello' }); }, 2000);
  }

  // ---------- standalone state ----------
  function localState() {
    const C = E.CFG, levels = [10, 20, 50, 100, 200, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
    return {
      betLevels: levels, anteLevels: levels.filter((x) => Number.isInteger(x * C.anteCost)), anteCost: C.anteCost, buyCostX: C.buyCost, maxWinX: E.MAX_WIN_X,
      modes: ['play'], rtp: 'Demo build', tiers: E.TIERS,
      cfg: { symbols: E.REG, pay: C.pay, payBuckets: [[8, 9], [10, 11], [12, 30]], scatterPay: C.scatterPay, freeSpins: C.freeSpins, retriggerMin: C.retriggerMin, retriggerAdd: C.retriggerAdd, maxSpins: C.maxSpins, bombValues: C.bombTable.map((x) => x[0]) }
    };
  }

  // ---------- modal helpers ----------
  function modal(html) {
    return new Promise((resolve) => {
      const sc = document.createElement('div'); sc.className = 'scrim'; sc.innerHTML = '<div class="card" role="dialog" aria-modal="true">' + html + '</div>';
      const close = (v) => { sc.remove(); removeEventListener('keydown', onKey, true); resolve(v); };
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close('x'); } };
      sc.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) { A && A.click(); close(b.dataset.v); } else if (e.target === sc) close('x'); });
      addEventListener('keydown', onKey, true);
      ov.appendChild(sc); const f = sc.querySelector('.go') || sc.querySelector('button'); if (f) f.focus();
    });
  }
  async function buyDialog() {
    const b = bet(), cost = buyCost(b), C = S.cfg;
    const ok = avail() >= cost;
    const v = await modal(`<h2>BUY FEATURE</h2><p>Start ${C.freeSpins} free spins right away. Multiplier bombs can land during free spins.</p>
      <p>Price</p><div class="big">${fmt(cost)}</div><p>${(S.buyCostX || 100)}x your bet of ${fmt(b)}.${ok ? '' : ' Your balance is too low.'}</p>
      <div class="row"><button data-v="x" type="button">Cancel</button><button class="go" data-v="buy" type="button" ${ok ? '' : 'disabled'}>Buy</button></div>`);
    if (v === 'buy') { A && A.buyConfirm(); play('buy'); }
  }
  async function autoDialog() {
    const v = await modal(`<h2>AUTOPLAY</h2><p>Number of spins. Autoplay stops when a feature starts or your balance runs low.</p>
      <div class="autoopts">${[10, 25, 50, 100].map((n) => `<button data-v="${n}" type="button">${n}</button>`).join('')}</div>
      <div class="row"><button data-v="x" type="button">Cancel</button></div>`);
    if (+v > 0) { st.auto = +v; drawBet(); play('spin'); }
  }
  function infoDialog() {
    if (!S) return;
    const C = S.cfg, b = bet();
    const hdr = C.payBuckets.map(([lo, hi]) => `<span class="h">${hi >= 20 ? lo + '+' : lo + '-' + hi}</span>`).join('');
    const rows = C.symbols.map((s) => `<span>${SYM.svg(s)}</span>` + C.pay[s].map((x) => `<span>${x}x<br><span class="x">${fmt(u(x, b))}</span></span>`).join('')).join('');
    const sp = Object.keys(C.scatterPay).map((k) => `${k}${+k === Math.max(...Object.keys(C.scatterPay).map(Number)) ? '+' : ''} scatters pay ${C.scatterPay[k]}x`).join(', ');
    const bv = C.bombValues, tiers = (S.tiers || []).slice().reverse().map(([x, n]) => `${n.toUpperCase()} ${x}x`).join(', ');
    return modal(`<h2>HOW IT WORKS</h2>
      <div class="pt"><span class="h"></span>${hdr}${rows}</div>
      <p>Symbols pay anywhere on the board: land ${C.payBuckets[0][0]} or more of the same symbol. Pays shown are multiples of your bet (and the amount at your current bet of ${fmt(b)}).</p>
      <p>Winning symbols pop and the rest fall down. New symbols drop in and the board keeps tumbling while it keeps paying. Every tumble adds to the spin's win.</p>
      <p>Scatters pay anywhere (${sp}). ${Math.min(...Object.keys(C.scatterPay).map(Number))}+ scatters start ${C.freeSpins} free spins. During free spins, ${C.retriggerMin}+ scatters add ${C.retriggerAdd} more spins (up to ${C.maxSpins} in total).</p>
      <p>Multiplier bombs land only in free spins, worth ${Math.min(...bv)}x to ${Math.max(...bv)}x. When a spin that won something finishes tumbling, every bomb on the board is added together and the spin's win is multiplied by the sum.</p>
      <p>Ante bet: costs ${S.anteCost || 1.25}x your bet per spin and makes scatters about twice as likely. Offered only at bets where that cost is a whole amount. The feature buy is switched off while ante is on.</p>
      <p>Buy feature: ${S.buyCostX || 100}x your bet starts the free spins at once.</p>
      <p>Big win banners: ${tiers}. Max win ${(S.maxWinX || 10000).toLocaleString('en-US')}x your bet; a round ends when it is reached.</p>
      <p>${S.rtp ? 'Return to player: ' + S.rtp : ''}</p>
      <div class="row"><button class="go" data-v="x" type="button">Close</button></div>`);
  }

  // ---------- controls ----------
  $('spin').addEventListener('click', () => play('spin'));
  $('betDn').addEventListener('click', () => { A && A.click(); if (st.busy) return; st.betIdx = Math.max(0, st.betIdx - 1); if (!inAnte(bet())) st.ante = false; drawBet(); });
  $('betUp').addEventListener('click', () => { A && A.click(); if (st.busy) return; st.betIdx = Math.min(bets().length - 1, st.betIdx + 1); if (!inAnte(bet())) st.ante = false; drawBet(); });
  $('ante').addEventListener('click', () => {
    if (st.busy) return;
    if (!inAnte(bet())) { msg('Ante is not offered at this bet.', { err: true }); return; }
    st.ante = !st.ante; drawBet();
    A && A.anteToggle(st.ante);
  });
  $('buy').addEventListener('click', () => { if (st.busy || st.ante || !S) return; buyDialog(); });
  $('turbo').addEventListener('click', () => { A && A.click(); st.turbo = !st.turbo; drawBet(); });
  $('auto').addEventListener('click', () => { A && A.click(); if (st.auto > 0) { stopAuto(); return; } if (st.busy || !S) return; autoDialog(); });
  $('info').addEventListener('click', () => { A && A.click(); if (!st.busy) infoDialog(); });
  const sndUi = () => { $('snd').classList.toggle('off', !(A && A.isOn())); $('snd').setAttribute('aria-pressed', A && A.isOn() ? 'true' : 'false'); };
  const musUi = () => { $('mus').classList.toggle('off', !(A && A.isMusicOn())); $('mus').setAttribute('aria-pressed', A && A.isMusicOn() ? 'true' : 'false'); };
  $('snd').addEventListener('click', () => { if (!A) return; A.init(); A.toggle(); sndUi(); A.click(); });
  $('mus').addEventListener('click', () => { if (!A) return; A.init(); A.toggleMusic(); musUi(); });
  sndUi(); musUi();
  boardEl.addEventListener('pointerdown', skipNow);
  addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat || ov.firstChild) return;
    e.preventDefault(); play('spin');
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) skipNow(); });

  // ---------- boot ----------
  function boot() {
    FX.init(stageEl);
    fillIdle();
    resetWin();
    $('fine').textContent = '';
    if (BRIDGE) { fmt = dollars; setBal(0); initBridge(); modeUi(); }
    else {
      if (!E) { msg('Engine failed to load.', { err: true, hold: true }); return; }
      st.bal = 500000; fmt = dollars; applyState(localState()); setBal(st.bal); modeUi();
      if (Q.get('force') === 'bonus') setTimeout(() => play('buy'), 300);
    }
    drawBet();
  }
  window.DINO = { st, play, get last() { return st.last; }, get state() { return S; }, seed, fmt: (n) => fmt(n), money };
  boot();
})();
