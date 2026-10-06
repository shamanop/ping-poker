/* BALLOT BENDER: UI controller. Resolves each round up front with the engine, then replays the script. */
(() => {
  const $ = (id) => document.getElementById(id);
  const Q = new URLSearchParams(location.search);
  const E = BenderEngine, COLS = E.COLS, ROWS = E.ROWS;
  const HOLE = { x: 101, y: 118, w: 800, h: 594 }, PX = HOLE.w / COLS, PY = HOLE.h / ROWS, SZ = 130;
  const L = window.BENDER_LINES || {};
  const BETS = [10, 20, 50, 100, 200, 500, 1000];
  const NAMES = { pen: 'Hot Dog', stk: 'I Voted', bal: 'Ballot', yrd: 'Who? Me?', meg: 'Megaphone', cap: 'Approved', phn: 'Beer Mug', seal: 'Cash Bag' };
  const SYMCOL = { pen: ['#3A7CC4', '#FDFBF7'], stk: ['#C8352B', '#FDFBF7'], bal: ['#FDFBF7', '#F5B942'], yrd: ['#C8352B', '#F5B942'], meg: ['#F5B942', '#FDFBF7'], cap: ['#3A7CC4', '#F5B942'], phn: ['#F5B942', '#3A7CC4'], seal: ['#F5B942', '#C8352B'], W: ['#F5B942', '#FDFBF7'], S: ['#F5B942', '#FDFBF7'] };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cfg = () => E.CFG;
  // anchor of the torso (px at 640px art height) per pose: poses are drawn at natural aspect and shifted so the body never jumps
  const POSE_X = { idle: 230.2, drink: 226.9, hype: 215.9, shock: 223.6, cheer: 203.4, pass: 216.2 };

  const engine = E.createEngine(E.CFG);
  const seed = Q.has('seed') ? Number(Q.get('seed')) >>> 0 : (crypto.getRandomValues(new Uint32Array(1))[0]);
  const rng = E.rngFrom(seed);

  const nearestBet = (v) => BETS.reduce((bi, x, i) => (Math.abs(x - v) < Math.abs(BETS[bi] - v) ? i : bi), 0);
  const st = { streak: 0, losses: 0, bal: 50000, betIdx: Q.has('bet') && Number(Q.get('bet')) > 0 ? nearestBet(Number(Q.get('bet'))) : 3, turbo: false, auto: false, busy: false, skip: false, tap: 0, win: 0, balShown: 50000, last: null, queued: null, lastLose: false, poseRot: 0 };
  const bet = () => BETS[st.betIdx];
  const fx = (n) => Math.round(n).toLocaleString('en-US');
  const dollars = (n) => { const c = Math.round(n), a = Math.abs(c); return (c < 0 ? '-' : '') + '$' + Math.floor(a / 100).toLocaleString('en-US') + '.' + String(a % 100).padStart(2, '0'); };
  let fmt = fx;
  // ---------- shell bridge (iframe ?bridge=1): server-authoritative rounds, wallet in cents ----------
  const BRIDGE = Q.get('bridge') === '1' && window.parent !== window;
  const DEFAULT_BETS = BETS.slice();
  const money = { live: false, mode: 'play', wallet: { play: 0, chips: 0 } };
  const pend = new Map(); let reqSeq = 0;
  const toParent = (m) => { if (BRIDGE) window.parent.postMessage(m, '*'); };
  const P = (() => { try { return window.parent && window.parent !== window && window.parent.AmountInput && window.parent.Money ? window.parent : window; } catch (e) { return window; } })();
  const wUnit = () => (money.mode === 'chips' ? 'chips' : 'cents');
  const chipsFmt = (n) => { try { const M = window.parent && window.parent !== window ? window.parent.Money : null; if (M && M.format && M.pref === 'usd') return M.format(n, 'usd'); } catch (e) {} return Math.round(n).toLocaleString('en-US'); };
  // amounts follow the player's pref per wallet unit (S3-11); dollars() is only the fallback when Money did not load
  const liveFmt = () => (P.Money && P.Money.format ? (n) => P.Money.format(n, P.Money.modeFor(P.Money.pref, wUnit())) : (money.mode === 'chips' ? chipsFmt : dollars));
  const walletBal = () => (money.mode === 'chips' ? money.wallet.chips : money.wallet.play);
  const avail = () => (money.live ? walletBal() : st.bal);
  const fmtBal = (n) => fmt(n);
  const unitWord = () => (money.live ? (money.mode === 'chips' ? 'chips' : 'Play $') : 'VOTES');

  const stage = $('stage'), cellsEl = $('cells'), floatsEl = $('floats'), ov = $('ov'), boardEl = $('board'), mascot = $('mascot'), mimg = $('mimg'), dump = $('dump');
  const els = new Map();
  let cur = null; // current grid of cell objects [c][r]

  // ---------- layout ----------
  function fit() {
    const H = Math.max(1920, Math.min(2250, Math.round(1080 * innerHeight / innerWidth)));
    const sc = Math.min(innerWidth / 1080, innerHeight / H);
    stage.style.setProperty('--H', H + 'px'); stage.style.setProperty('--s', sc); document.documentElement.style.setProperty('--s', sc);
    for (const id of ['fx', 'fxb']) { const cv = $(id); if (cv.height !== H / 2) { cv.width = 540; cv.height = Math.round(H / 2); } }
  }
  // stage-space point of a cell centre / an element (offset chain, unaffected by shake transforms)
  const sOff = (el) => { let x = 0, y = 0; for (let e = el; e && e !== stage; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; } return [x, y]; };
  const cellPt = (c, r) => { const [bx, by] = sOff(boardEl); return [bx + HOLE.x + c * PX + PX / 2, by + HOLE.y + r * PY + PY / 2]; };
  addEventListener('resize', fit); fit();

  // ---------- timing ----------
  const speed = () => (st.turbo ? 0.45 : st.skip ? 0.3 : 1);
  const wait = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms * speed())));
  const anim = (el, kf, o) => { const a = el.animate(kf, { fill: 'none', ...o, duration: (o.duration || 300) * speed() }); return a.finished.catch(() => {}); };

  // ---------- slots grid ----------
  const slots = $('slots'); slots.className = 'slots'; for (let i = 0; i < COLS * ROWS; i++) slots.appendChild(document.createElement('i'));

  // ---------- images ----------
  const PRE = [];
  ['pen', 'stk', 'bal', 'yrd', 'meg', 'cap', 'phn', 'seal', 'W', 'S'].forEach((s) => PRE.push(`assets/img/sym/${s}.webp`));
  ['idle', 'drink', 'hype', 'shock', 'cheer', 'pass'].forEach((p) => PRE.push(`assets/img/mascot_${p}.webp`));
  ['banner_closeenough', 'banner_ballotbender', 'banner_megalandslide', 'banner_worldisyours', 'dumpster_erupt', 'title_stack', 'bal'].forEach((p) => PRE.push(`assets/img/${p}.webp`));
  // decode off the first-spin path (decode() also fills the decoded-image cache so first paint does not hitch); in-DOM art is decoded too
  const preDecoded = [];
  const preDecode = () => {
    const urls = new Set(PRE); for (const im of document.images) if (im.src) urls.add(im.getAttribute('src'));
    for (const u of urls) { const im = new Image(); im.src = u; preDecoded.push(im); if (im.decode) im.decode().catch(() => {}); }
  };
  preDecode();

  // ---------- mascot: pose + caption bubble ----------
  let poseT = 0, curPose = 'idle', lastLine = '';
  function pose(name, ms, o) {
    o = o || {};
    clearTimeout(poseT); curPose = name;
    mimg.src = `assets/img/mascot_${name}.webp`; mimg.className = 'p-' + name; mimg.style.left = ((POSE_X.idle - POSE_X[name]) / 640 * mascot.offsetHeight).toFixed(1) + 'px'; mascot.className = name === 'idle' || name === 'drink' || name === 'hype' ? '' : name;
    if (bub.classList.contains('on') && !bub.classList.contains('out')) bubblePlace();
    const er = !!o.erupt, was = dump.src.includes('erupt');
    if (er !== was) { dump.src = `assets/img/dumpster_${er ? 'erupt' : 'back'}.webp`; if (er) { dump.classList.remove('erupt'); void dump.offsetWidth; dump.classList.add('erupt'); } }
    if (name !== 'idle' && ms !== 0) poseT = setTimeout(() => pose('idle'), ms || 1500);
  }
  // tail target per pose (px at 640px art height): the face edge beside the mouth, so the tail always points at it
  const MOUTH = { idle: [172, 140], drink: [105, 120], hype: [160, 165], shock: [192, 150], cheer: [172, 232], pass: [203, 132] };
  const bub = $('bubble'), bubT = $('bubbleT'), bpath = $('bpath'), headEl = $('head');
  let bubTimer = 0, bubOut = 0, bubText = '';
  function bubbleFit(text, maxW) {
    const p = bubT; p.textContent = text; p.style.height = 'auto'; p.style.left = '0px'; p.style.top = '0px';
    let fs = 28, lines = 9, lh = 1.1;
    for (; fs >= 17; fs -= 1) {
      p.style.fontSize = fs + 'px'; p.style.width = maxW + 'px';
      lines = Math.round(p.scrollHeight / (fs * lh));
      if (lines <= 3 && p.scrollWidth <= maxW) break;
    }
    let lo = 60, hi = maxW;
    while (hi - lo > 2) { const mid = (lo + hi) >> 1; p.style.width = mid + 'px'; if (Math.round(p.scrollHeight / (fs * lh)) <= lines && p.scrollWidth <= mid) hi = mid; else lo = mid; }
    p.style.width = hi + 'px';
    return [hi, p.scrollHeight];
  }
  function bubblePath(x0, y0, x1, y1, r, tx, ty) {
    const hw = 15, onBottom = ty > y1 + 6;
    let d = `M${x0 + r} ${y0}H${x1 - r}A${r} ${r} 0 0 1 ${x1} ${y0 + r}`;
    if (!onBottom) { const c = Math.min(Math.max(ty, y0 + r + hw + 4), y1 - r - hw - 4); d += `V${c - hw}L${tx} ${ty}L${x1} ${c + hw}`; }
    d += `V${y1 - r}A${r} ${r} 0 0 1 ${x1 - r} ${y1}`;
    if (onBottom) { const c = Math.min(Math.max(tx - 22, x0 + r + hw + 4), x1 - r - hw - 4); d += `H${c + hw}L${tx} ${ty}L${c - hw} ${y1}`; }
    return d + `H${x0 + r}A${r} ${r} 0 0 1 ${x0} ${y1 - r}V${y0 + r}A${r} ${r} 0 0 1 ${x0 + r} ${y0}Z`;
  }
  function bubblePlace() {
    if (!bubText) return;
    const hw = headEl.clientWidth, hh = headEl.clientHeight, k = mimg.offsetHeight / 640, m = MOUTH[curPose] || MOUTH.idle;
    const tx = mascot.offsetLeft + mimg.offsetLeft + m[0] * k, ty = mascot.offsetTop + mimg.offsetTop + m[1] * k;
    const PADX = 24, PADY = 15, LEFT = 432, TOP = 66, GAP = 34;
    const maxW = Math.floor(Math.max(120, Math.min(300, tx - GAP - LEFT - 2 * PADX)));
    const [tw, th] = bubbleFit(bubText, maxW);
    const bw = tw + 2 * PADX, bh = th + 2 * PADY;
    const x1 = Math.max(LEFT + bw, tx - GAP), x0 = x1 - bw;
    const y0 = Math.max(TOP, Math.min(ty - bh * 0.62, hh - 22 - bh)), y1 = y0 + bh;
    bubT.style.left = (x0 + PADX) + 'px'; bubT.style.top = (y0 + PADY) + 'px';
    bpath.setAttribute('d', bubblePath(x0, y0, x1, y1, 26, tx, ty));
    bub.style.transformOrigin = tx + 'px ' + ty + 'px';
    bub.dataset.box = [x0, y0, bw, bh, tx, ty].map((v) => Math.round(v)).join(',');
  }
  function bubbleHide() {
    clearTimeout(bubTimer); if (!bub.classList.contains('on')) return;
    bub.classList.remove('pop'); bub.classList.add('out');
    bubOut = setTimeout(() => { bub.classList.remove('on', 'out'); }, 280);
  }
  function bubbleShow(text) {
    clearTimeout(bubTimer); clearTimeout(bubOut);
    bubText = text; bub.classList.remove('out', 'pop'); bubblePlace();
    bub.classList.add('on'); void bub.offsetWidth; bub.classList.add('pop');
    bubTimer = setTimeout(bubbleHide, 2800 + 65 * text.length);
  }
  function say(group) {
    const pool = L[group]; if (!pool || !pool.length) return;
    let t; for (let i = 0; i < 6; i++) { t = pool[(Math.random() * pool.length) | 0]; if (t !== lastLine) break; }
    lastLine = t; SFX.talk(t.length); bubbleShow(t);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (bub.classList.contains('on')) bubblePlace(); });
  addEventListener('resize', () => { if (bub.classList.contains('on')) bubblePlace(); });

  // ---------- cell DOM ----------
  const pos = (c, r) => [c * PX + (PX - SZ) / 2, r * PY + (PY - SZ) / 2];
  const tf = (c, r) => { const [x, y] = pos(c, r); return `translate(${x.toFixed(2)}px,${y.toFixed(2)}px)`; };
  function setMult(el, cell) {
    let m = el.querySelector('.mult');
    if (cell.s !== 'W') { if (m) m.remove(); return; }
    if (!m) { m = document.createElement('span'); m.className = 'mult'; el.appendChild(m); }
    m.textContent = cell.m + 'x'; el.classList.toggle('big', cell.m >= 10);
  }
  function mk(cell, c, r) {
    const el = document.createElement('div'); el.className = 'cell'; el.dataset.id = cell.id;
    const img = document.createElement('img'); img.src = `assets/img/sym/${cell.s}.webp`; img.alt = ''; el.appendChild(img);
    setMult(el, cell); el.classList.toggle('stick', !!cell.stick);
    el.style.transform = tf(c, r); cellsEl.appendChild(el); els.set(cell.id, el);
    if (cell.stick && stage.classList.contains('bonus')) lockIn(el, c, r);
    return el;
  }
  function lockIn(el, c, r) {
    setTimeout(() => {
      if (!el.isConnected) return;
      el.classList.add('lockin'); setTimeout(() => el.classList.remove('lockin'), 700);
      FX.ring(...cellPt(c, r), { n: 2, r1: 200 }); FX.burst(...cellPt(c, r), { n: 10, speed: 420, size: 12, cols: SYMCOL.W, g: 300 });
      dust(c, r, true); FX.flash(100, '#FFF4CF', 0.4); shk(10, 300); bounce(7, true); sfxSlam(2);
    }, 520 * speed());
  }
  // COUNTED: the stamp drops from above, hits the ballot with an ink splat, holds, then fades
  function votedStamp() {
    const d = document.createElement('div'); d.className = 'votedstamp'; d.innerHTML = '<b>COUNTED</b><i>100% LEGIT</i>'; stage.appendChild(d);
    const T = 2400, B = 'translate(-50%,-50%)', R = 'rotate(-9deg)';
    const kf = reduce
      ? [{ transform: `${B} ${R}`, opacity: 0 }, { transform: `${B} ${R}`, opacity: 1, offset: 0.12 }, { transform: `${B} ${R}`, opacity: 1, offset: 0.85 }, { transform: `${B} ${R}`, opacity: 0 }]
      : [{ transform: `${B} translateY(-1000px) scale(2.4) rotate(-22deg)`, opacity: 1, easing: 'cubic-bezier(.55,0,.9,.5)' },
        { transform: `${B} translateY(0) scale(1.12,.84) ${R}`, opacity: 1, offset: 0.16, easing: 'ease-out' },
        { transform: `${B} translateY(-34px) scale(.96,1.05) ${R}`, opacity: 1, offset: 0.24, easing: 'ease-in' },
        { transform: `${B} translateY(0) scale(1) ${R}`, opacity: 1, offset: 0.32 },
        { transform: `${B} scale(1) ${R}`, opacity: 1, offset: 0.85 },
        { transform: `${B} scale(1.1) ${R}`, opacity: 0 }];
    const p = anim(d, kf, { duration: T, easing: 'linear' }), cx = d.offsetLeft, cy = d.offsetTop;
    setTimeout(() => {
      if (!d.isConnected) return;
      FX.shake(20 * lite(), 420, { big: true }); FX.flash(110, '#fff', 0.55); FX.ring(cx, cy, { n: 2, r1: 520, w: 22, c: '#C8352B', dur: 0.5 });
      FX.burst(cx, cy, { n: 30, speed: 900, size: 16, shape: 'ballot', cols: ['#FDFBF7', '#C8352B'], g: 900, up: 200, life: 1 });
      bounce(10, true); sfxSlam(3); SFX.stamp();
    }, 0.16 * T * speed());
    const gone = () => d.remove(); p.then(gone); setTimeout(gone, T * speed() + 600);
  }
  function reconcile(grid) {
    const keep = new Set();
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
      const cell = grid[c][r]; keep.add(cell.id);
      let el = els.get(cell.id);
      if (!el) el = mk(cell, c, r);
      el.style.transform = tf(c, r); setMult(el, cell); el.classList.toggle('stick', !!cell.stick); el.classList.toggle('scat', cell.s === 'S');
      el.classList.remove('dim', 'hit', 'tease', 'oneshort');
    }
    for (const [id, el] of els) if (!keep.has(id)) { el.remove(); els.delete(id); }
    cur = grid;
  }
  const clearFx = () => { for (const el of els.values()) el.classList.remove('dim', 'hit', 'tease', 'oneshort'); };
  // drop any .cell node the els map no longer tracks (and map entries whose node left the DOM)
  function sweepCells() {
    const live = new Set(els.values());
    for (const n of cellsEl.querySelectorAll('.cell')) if (!live.has(n)) n.remove();
    for (const [id, el] of els) if (!el.isConnected) els.delete(id);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !st.busy) sweepCells(); });

  // ---------- readouts ----------
  let countTok = 0;
  function countTo(el, from, to, ms, f = fmt, after) {
    const tok = ++countTok; const t0 = performance.now(); ms = Math.max(1, ms * speed());
    return new Promise((res) => {
      const tick = (now) => {
        if (tok !== countTok && el === $('win')) return res();
        const k = Math.max(0, Math.min(1, (now - t0) / ms)), e = 1 - Math.pow(1 - k, 3);
        el.textContent = f(from + (to - from) * e);
        if (k < 1) requestAnimationFrame(tick); else { if (after) after(); res(); }
      };
      requestAnimationFrame(tick);
    });
  }
  function setWin(x, animate, ms = 380) {
    const from = st.win; st.win = x;
    const w = $('win');
    if (animate && x > from) {
      if (!reduce) anim(w, [{ transform: 'scale(1.75)' }, { transform: 'scale(.9)', offset: 0.38 }, { transform: 'scale(1.07)', offset: 0.68 }, { transform: 'scale(1)' }], { duration: 440, easing: 'ease-out' });
      return countTo(w, from, x, ms);
    }
    countTok++; w.textContent = fmt(x); return Promise.resolve();
  }
  function setBal(v, animate) {
    const from = st.balShown; st.bal = v; st.balShown = v;
    if (animate && from !== v) { const el = $('bal'); const t0 = performance.now(), ms = 700 * speed(); const tick = (now) => { const k = Math.max(0, Math.min(1, (now - t0) / ms)); el.textContent = fmtBal(from + (v - from) * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(tick); else el.textContent = fmtBal(v); }; requestAnimationFrame(tick); }
    else $('bal').textContent = fmtBal(v);
  }
  const HC = [];
  function hcRecord(net) {
    HC.push(net); if (HC.length > 10) HC.shift();
    const el = $('hc'), sum = HC.reduce((x, y) => x + y, 0);
    if (!el) return;
    if (HC.length < 3 || sum === 0) { el.className = 'hc'; el.textContent = ''; return; }
    const hot = sum > 0;
    el.className = 'hc ' + (hot ? 'hot' : 'cold');
    el.textContent = (hot ? 'HOT +' : 'COLD -') + fmt(Math.abs(sum));
    el.title = 'Last ' + HC.length + ' spins';
  }
  // The bet is a number from the server's ladder (BETS); the text box is a view of it. Typed values must be listed or they are
  // refused with a message (never rounded to a neighbour) and play() will not spin on an invalid box.
  let betField = null, betKey = '';
  function betChrome() { $('betDn').disabled = st.busy || st.betIdx === 0; $('betUp').disabled = st.busy || st.betIdx === BETS.length - 1; $('buy').disabled = st.busy; $('buyFrom').textContent = 'from ' + fmt(bet() * E.CFG.buyCost.election); }
  function drawBet() {
    const live = money.live, key = (live ? wUnit() : 'votes') + '|' + BETS.join(',');
    if (!betField || betKey !== key) {
      if (betField) betField.destroy();
      betKey = key;
      betField = P.AmountInput({ units: bet(), min: BETS[0], max: BETS[BETS.length - 1], unit: live ? wUnit() : 'chips', fixedMode: live ? undefined : 'chips', scale: 'ladder', compact: true,
        allowed: BETS.slice(), label: 'Bet', rangeLabel: 'Bet', doc: document,
        onChange: (v) => { if (v !== null && BETS.includes(v) && BETS.indexOf(v) !== st.betIdx) { st.betIdx = BETS.indexOf(v); betChrome(); } } });
      betField.input.id = 'betIn';
      $('bet').replaceChildren(betField.el);
    } else betField.set(bet(), { source: 'stepper' });
    betField.input.disabled = st.busy;
    betChrome();
  }
  function setBusy(b) {
    st.busy = b; $('spin').classList.toggle('run', b); $('spin').classList.toggle('idle', !b); drawBet();
    poke();
  }

  // ---------- animation power: all CSS loops pause when hidden/offscreen/docked-away; the desktop side art also pauses after 8 s with no spin or input ----------
  const vpEl = $('vp'); let calmT = 0, shown = true;
  function calmNow() { calmT = 0; if (!st.busy && !document.hidden && shown) vpEl.classList.add('calm'); }
  function poke() { vpEl.classList.remove('calm'); clearTimeout(calmT); if (!st.busy) calmT = setTimeout(calmNow, 8000); }
  function visState() { vpEl.classList.toggle('paused', document.hidden || !shown); if (document.hidden || !shown) { clearTimeout(calmT); } else poke(); }
  document.addEventListener('visibilitychange', visState);
  let lastPoke = 0;
  ['pointerdown', 'pointermove', 'keydown', 'touchstart'].forEach((e) => addEventListener(e, () => { const n = performance.now(); if (n - lastPoke > 400 && !st.busy && !document.hidden && shown) { lastPoke = n; poke(); } }, { passive: true, capture: true }));
  if (typeof IntersectionObserver === 'function') new IntersectionObserver((es) => { shown = es[es.length - 1].isIntersecting; visState(); }).observe(vpEl);
  poke();

  // ---------- floats / stamps ----------
  function floatAt(x, y, html, cls) {
    const f = document.createElement('div'); f.className = 'float ' + (cls || ''); f.innerHTML = html; f.style.left = x + 'px'; f.style.top = y + 'px'; floatsEl.appendChild(f);
    const T = 'translate(-50%,-50%)';
    const kf = reduce
      ? [{ transform: T, opacity: 0 }, { transform: T, opacity: 1, offset: 0.15 }, { transform: 'translate(-50%,-70%)', opacity: 1, offset: 0.7 }, { transform: 'translate(-50%,-130%)', opacity: 0 }]
      : [{ transform: `${T} scale(2.6)`, opacity: 0 }, { transform: `${T} scale(.86)`, opacity: 1, offset: 0.12 }, { transform: `${T} scale(1.18)`, opacity: 1, offset: 0.22 }, { transform: `${T} scale(1)`, opacity: 1, offset: 0.32 }, { transform: 'translate(-50%,-70%) scale(1)', opacity: 1, offset: 0.7 }, { transform: 'translate(-50%,-130%) scale(1)', opacity: 0 }];
    const gone = () => f.remove(); anim(f, kf, { duration: 1100, easing: 'ease-out' }).then(gone); setTimeout(gone, 1100 * speed() + 600);
  }
  const toast = (t, ms = 1600) => { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; stage.appendChild(d); setTimeout(() => d.remove(), ms); };
  const STAMP_AMP = { nice: 9, tasty: 13 };
  // small-tier banner: drops from above, squashes on impact, rebounds, settles, then lifts away
  function stamp(text, cls, ms = 1500, sub) {
    const d = document.createElement('div'); d.className = 'stamp ' + cls; d.innerHTML = `<b>${text}</b>${sub ? `<i>${sub}</i>` : ''}`; boardEl.appendChild(d);
    const B = 'translate(-50%,-50%)', R = 'rotate(-6deg)';
    const kf = reduce
      ? [{ transform: `${B} ${R}`, opacity: 0 }, { transform: `${B} ${R}`, opacity: 1, offset: 0.15 }, { transform: `${B} ${R}`, opacity: 1, offset: 0.8 }, { transform: `${B} ${R}`, opacity: 0 }]
      : [{ transform: `translate(-50%,-380%) scale(1.5) rotate(-16deg)`, opacity: 1, easing: 'cubic-bezier(.55,0,.9,.5)' },
        { transform: `${B} scale(1.1,.86) ${R}`, opacity: 1, offset: 0.16, easing: 'ease-out' },
        { transform: `translate(-50%,-60%) scale(.97,1.04) ${R}`, opacity: 1, offset: 0.24, easing: 'ease-in' },
        { transform: `${B} scale(1) ${R}`, opacity: 1, offset: 0.32 },
        { transform: `${B} scale(1) ${R}`, opacity: 1, offset: 0.8 },
        { transform: `translate(-50%,-64%) scale(1) ${R}`, opacity: 0 }];
    const p = anim(d, kf, { duration: ms, easing: 'linear' });
    const amp = STAMP_AMP[cls] || 0;
    if (amp) setTimeout(() => {
      if (!d.isConnected) return;
      const [bx, by] = sOff(boardEl), cx = bx + d.offsetLeft, cy = by + d.offsetTop;
      shk(amp, 300); FX.ring(cx, cy, { n: 1, r1: 300, w: 16, dur: 0.4 }); sfxSlam(cls === 'tasty' ? 2 : 1); bounce(amp * 0.5, true);
      FX.burst(cx, cy + 30, { n: cls === 'tasty' ? 16 : 10, speed: 700, size: 14, shape: 'ballot', cols: ['#FDFBF7'], g: 900, up: 150, life: 0.9 });
    }, 0.16 * ms * speed());
    const gone = () => d.remove(); p.then(gone); setTimeout(gone, ms * speed() + 600);
  }
  const pick = (a) => a[(Math.random() * a.length) | 0];

  // ---------- win tiers (names and thresholds come from the engine) ----------
  const TIER = { worldisyours: { n: 'THE WORLD IS YOURS', lvl: 4 }, megalandslide: { n: 'MEGA LANDSLIDE', lvl: 3 }, ballotbender: { n: 'BALLOT BENDER', lvl: 2 }, closeenough: { n: 'CLOSE ENOUGH', lvl: 1 } };
  const MINI = { tasty: ['TASTY!', 'SNACK MONEY!', 'HIC-TASTIC!'], nice: ['NICE!', 'NICE ONE!', 'NOT BAD!'] };
  const TIER_LABEL = { nice: 'Nice', tasty: 'Tasty', closeenough: 'Close Enough', ballotbender: 'Ballot Bender', megalandslide: 'Mega Landslide', worldisyours: 'The World Is Yours' };
  const tierName = (x) => E.winTier(x);
  const tierOf = (x) => { const k = tierName(x), t = TIER[k]; return t ? { n: t.n, img: k, lvl: t.lvl } : null; };
  const xFmt = (x) => (x >= 100 ? Math.round(x) : x.toFixed(1).replace(/\.0$/, ''));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- slam helpers (turbo = lighter, reduced motion = no shake/flash/squash) ----------
  const lite = () => (st.turbo ? 0.55 : 1);
  const sfxSlam = (n) => { if (window.SFX && SFX.slam) SFX.slam(n); };
  const shk = (amp, dur, o) => FX.shake(amp * lite(), dur * (st.turbo ? 0.6 : 1), o);
  const SQ = (sx, sy, y) => `translateY(${y || 0}px) scale(${sx},${sy})`;
  let lastBounce = 0;
  function bounce(px, force) {
    const now = performance.now();
    if (reduce || (!force && now - lastBounce < 80 * speed())) return;
    lastBounce = now;
    anim(boardEl, [{ transform: 'translateY(0)' }, { transform: `translateY(${(px * lite()).toFixed(1)}px)`, offset: 0.35 }, { transform: 'translateY(0)' }], { duration: 200, composite: 'add' });
  }
  function dust(c, r, heavy) {
    const [x, y] = cellPt(c, r), by = y + PY / 2 - 14, n = (heavy ? 5 : 3) * (st.turbo ? 0.6 : 1);
    const o = { n, speed: heavy ? 340 : 240, size: heavy ? 15 : 10, up: 10, g: 120, drag: 3, life: 0.42, shape: 'foam', cols: ['#FDFBF7', '#DDD5C4'], spread: 0.3 };
    FX.burst(x - 36, by, { ...o, ang: Math.PI }); FX.burst(x + 36, by, { ...o, ang: 0 });
  }
  // a symbol hits its cell: overshoot + squash/stretch on the image, dust puffs at its base; scatter/wild land heavier
  function landFx(el, c, r, o = {}) {
    const heavy = !!o.heavy;
    dust(c, r, heavy);
    if (heavy) { FX.ring(...cellPt(c, r), { n: 1, r1: 230, w: 18, c: '#FDFBF7', dur: 0.45 }); FX.flash(90, '#FFF4CF', 0.3); shk(8, 340); sfxSlam(2); bounce(9, true); }
    const img = el.isConnected && el.querySelector('img'); if (reduce || !img) return;
    const O = { transformOrigin: '50% 100%' };
    anim(img, heavy
      ? [{ ...O, transform: SQ(1.3, 0.6) }, { ...O, transform: SQ(0.9, 1.18, -26), offset: 0.38 }, { ...O, transform: SQ(1.08, 0.94), offset: 0.66 }, { ...O, transform: 'none' }]
      : [{ ...O, transform: SQ(1.16, 0.76) }, { ...O, transform: SQ(0.96, 1.08, -12), offset: 0.4 }, { ...O, transform: SQ(1.03, 0.98), offset: 0.7 }, { ...O, transform: 'none' }], { duration: heavy ? 420 : 300, easing: 'ease-out' });
  }
  // freeze frame: pause running animations (not the camera shake or flashes), then resume
  function freeze(ms) {
    if (reduce) return;
    const anims = stage.getAnimations({ subtree: true }).filter((a) => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.id !== 'shake' && !a.effect.target.classList.contains('flash'));
    anims.forEach((a) => a.pause());
    setTimeout(() => anims.forEach((a) => { try { a.play(); } catch (e) { /* gone */ } }), Math.max(30, ms * speed()));
  }

  // ---------- drop an initial grid ----------
  function hitStop(ms) {
    const anims = cellsEl.getAnimations({ subtree: true }).filter((a) => a.playState === 'running');
    anims.forEach((a) => a.pause());
    FX.flash(140, '#fff', 0.9); SFX.drop(); stage.classList.add('hitstop');
    setTimeout(() => { stage.classList.remove('hitstop'); anims.forEach((a) => { try { a.play(); } catch (e) { /* gone */ } }); FX.shake(22, 700); }, ms * speed());
  }
  async function dropInitial(script, isBonus) {
    const grid = script.initial, keepIds = new Set();
    // sticky wilds from the previous spin stay put
    if (cur && isBonus) for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) { const x = grid[c][r]; if (x.stick && els.has(x.id)) keepIds.add(x.id); }
    const outs = [];
    for (const [id, el] of els) if (!keepIds.has(id)) {
      const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(el.style.transform); const x = +m[1], y = +m[2];
      outs.push(anim(el, [{ transform: `translate(${x}px,${y}px)`, opacity: 1 }, { transform: `translate(${x}px,${y + 700}px)`, opacity: 0 }], { duration: 300, delay: (x / PX) * 18 + (4 - y / PY) * 14, easing: 'cubic-bezier(.5,0,.9,.6)' }).then(() => { el.remove(); if (els.get(id) === el) els.delete(id); }));
    }
    // the old board is still falling away while the new symbols already start to drop in
    if (outs.length) await wait(140);
    // anticipation: slow the columns after a 2nd scatter lands
    let sc = 0, extra = 0, anticipated = false; const colDelay = [], teaseIds = [];
    for (let c = 0; c < COLS; c++) {
      if (sc === 2 && c < COLS) { extra += 650; if (!anticipated) anticipated = c; }
      colDelay[c] = c * 70 + extra;
      for (let r = 0; r < ROWS; r++) if (grid[c][r].s === 'S') { sc++; if (sc <= 2) teaseIds.push(grid[c][r].id); }
    }
    const landings = [];
    let scSeen = 0, wildLanded = false;
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const cell = grid[c][r]; if (keepIds.has(cell.id)) continue;
        const el = mk(cell, c, r), [x, y] = pos(c, r), y0 = -(ROWS - r) * PY - 120;
        el.style.opacity = 0;
        const dur = 380, delay = colDelay[c] + (ROWS - 1 - r) * 28;
        landings.push(anim(el, [{ transform: `translate(${x}px,${y0}px)`, opacity: 1 }, { transform: `translate(${x}px,${y}px)`, opacity: 1 }], { duration: dur, delay, easing: 'cubic-bezier(.5,0,.9,.55)', fill: 'backwards' }).then(() => {
          el.style.opacity = ''; if (cell.s === 'S') { el.classList.add('scat'); FX.burst(...cellPt(c, r), { n: 8, speed: 380, size: 12, cols: SYMCOL.S, g: 300, life: .7, shape: 'star' }); }
          landFx(el, c, r, { heavy: cell.s === 'S' || cell.s === 'W' });
        }));
      }
    }
    // sound + anticipation choreography
    for (let c = 0; c < COLS; c++) {
      setTimeout(() => SFX.colDrop(c), colDelay[c] * speed());
      setTimeout(() => {
        let heavy = false; const before = scSeen; for (let r = 0; r < ROWS; r++) if (grid[c][r].s === 'S') { heavy = true; scSeen++; SFX.scatter(scSeen); }
        SFX.land(heavy, c);
        bounce(heavy ? 8 : 3.5, heavy);
        if (before < 3 && scSeen >= 3) { for (let cc = 0; cc < COLS; cc++) for (let rr = 0; rr < ROWS; rr++) if (grid[cc][rr].s === 'S') FX.ring(...cellPt(cc, rr), { n: 2, r1: 280 }); hitStop(250); }
        for (let r = 0; r < ROWS; r++) if (grid[c][r].s === 'W' && !keepIds.has(grid[c][r].id)) { if (!wildLanded) { wildLanded = true; SFX.wild(); } }
      }, (colDelay[c] + 380 + 40) * speed());
    }
    if (anticipated !== false && anticipated < COLS) {
      setTimeout(() => {
        stage.classList.add('anticip'); SFX.anticip(); pose('shock', 1700); say('tease');
        for (const id of teaseIds) els.get(id)?.classList.add('tease');
      }, (colDelay[anticipated] - 400) * speed() + 10);
    }
    await Promise.all([...landings, ...outs]);
    stage.classList.remove('anticip'); for (const id of teaseIds) els.get(id)?.classList.remove('tease');
    reconcile(grid);
    if (!isBonus && script.scatters === 2) { pose('shock', 1500); say('nearMiss'); if (PJ) SFX.nearMiss(); }
  }

  // ---------- a step (one tumble) ----------
  const chain = (cells) => { // greedy nearest-neighbour path through cell centres
    const left = cells.slice(), out = [left.shift()];
    while (left.length) { const [lc, lr] = out[out.length - 1]; let bi = 0, bd = 1e9; left.forEach(([c, r], i) => { const d = (c - lc) ** 2 + (r - lr) ** 2; if (d < bd) { bd = d; bi = i; } }); out.push(left.splice(bi, 1)[0]); }
    return out.map(([c, r]) => cellPt(c, r));
  };
  async function playStep(step, idx, runWin, isBonus) {
    const inCl = new Set(); for (const k of step.clusters) for (const [c, r] of k.cells) inCl.add(c + ',' + r);
    // winners punch together in a stamp-slam, losers dim
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
      const el = els.get(cur[c][r].id); if (!el) continue; const hit = inCl.has(c + ',' + r);
      el.classList.add(hit ? 'hit' : 'dim');
      if (hit && !reduce) anim(el.querySelector('img'), [{ transform: 'scale(1)' }, { transform: 'scale(1.38) rotate(-3deg)', offset: 0.2 }, { transform: 'scale(.88) rotate(1.5deg)', offset: 0.44 }, { transform: 'scale(1.16)', offset: 0.68 }, { transform: 'scale(1.08)' }], { duration: 420, easing: 'ease-out' });
    }
    SFX.chime(idx);
    const sw = step.stepWin, b = bet(), nHit = inCl.size;
    shk(Math.min(16, 4 + nHit * 0.5), 300); bounce(4 + Math.min(4, sw), true); sfxSlam(sw >= 10 ? 3 : sw >= 2 ? 2 : 1);
    for (const k of step.clusters) {
      let sx = 0, sy = 0; for (const [c, r] of k.cells) { sx += c; sy += r; }
      const x = (sx / k.cells.length + .5) * PX, y = (sy / k.cells.length + .5) * PY;
      FX.ring(x + HOLE.x + sOff(boardEl)[0], y + HOLE.y + sOff(boardEl)[1], { n: 1, r1: 110 + k.cells.length * 14, w: 14, c: '#FFE9A8', dur: 0.4 });
      floatAt(Math.min(HOLE.w - 100, Math.max(100, x)), y, `<span>+${fmt(k.win * b)}</span>${k.mult > 1 ? `<b>x${k.mult}</b>` : ''}`);
      for (const [c, r] of k.cells.slice(0, 3)) FX.burst(...cellPt(c, r), { n: 3, speed: 260, size: 11, cols: SYMCOL[k.sym], g: 400, life: .6 });
      if ((runWin.lvl || 0) >= 2 || sw >= 10) FX.lightning(chain(k.cells));
    }
    if ((runWin.lvl || 0) >= 2 || sw >= 10) { FX.flash(110, '#FFE9A8', 0.4); SFX.clink(idx); }
    runWin.x += sw;
    const wp = runWin.hold ? Promise.resolve() : setWin(runWin.x * b, true, sw >= 2 ? 900 : 380);
    if (sw >= 5) pose('hype', 1400);
    await wait(sw < 1 ? 300 : sw < 10 ? 520 : 760);
    // kills
    SFX.pop();
    const dead = [];
    for (const key of step.killed) {
      const [c, r] = key.split(',').map(Number), cell = cur[c][r], el = els.get(cell.id); if (!el) continue;
      FX.burst(...cellPt(c, r), { n: 6, speed: 560, size: 15, cols: SYMCOL[cell.s] || SYMCOL.W, up: 160 });
      FX.burst(...cellPt(c, r), { n: st.turbo ? 3 : 6, speed: 520, size: 17, shape: 'ballot', cols: ['#FDFBF7'], g: 800, up: 220, life: 0.95, drag: 1.4 });
      const t0 = el.style.transform;
      dead.push(anim(el, [{ transform: `${t0} scale(1) rotate(0deg)`, opacity: 1 }, { transform: `${t0} scale(1.32) rotate(5deg)`, opacity: 1, offset: .3 }, { transform: `${t0} scale(0) rotate(-16deg)`, opacity: 0 }], { duration: 280, easing: 'ease-in' }).then(() => { el.remove(); if (els.get(cell.id) === el) els.delete(cell.id); }));
    }
    // growth
    for (const g of step.grown) {
      const el = els.get(cur[g.c][g.r].id); if (!el) continue;
      const m = el.querySelector('.mult'); if (m) m.textContent = g.to + 'x'; el.classList.toggle('big', g.to >= 10);
      SFX.grow(); FX.burst(...cellPt(g.c, g.r), { n: 14, speed: 640, size: 16, cols: SYMCOL.W });
      if (isBonus) {
        FX.ring(...cellPt(g.c, g.r), { n: 3, r1: 260, w: 18 });
        const k = step.clusters.find((q) => q.cells.some(([cc, rr]) => cc === g.c && rr === g.r));
        if (k) for (const [cc, rr] of k.cells.filter(([cc, rr]) => cc !== g.c || rr !== g.r).slice(0, 7)) FX.lightning([cellPt(g.c, g.r), cellPt(cc, rr)], { w: 6, jit: 12 });
        floatAt(Math.min(HOLE.w - 100, Math.max(100, (g.c + .5) * PX)), (g.r + .5) * PY - 40, `<b>${g.from}x \u2192 ${g.to}x</b>`);
        FX.flash(90, '#FFE9A8', 0.35);
      }
      shk(isBonus ? 9 : 6, 260); sfxSlam(2); FX.ring(...cellPt(g.c, g.r), { n: 1, r1: 200, w: 16, dur: 0.45 });
      if (!reduce) anim(el.querySelector('img'), [{ transform: 'scale(1)' }, { transform: 'scale(1.7) rotate(-6deg)', offset: .3 }, { transform: 'scale(.88)', offset: .56 }, { transform: 'scale(1.1)', offset: .78 }, { transform: 'scale(1)' }], { duration: 560, easing: 'ease-out' });
      anim(m, [{ transform: 'translate(-50%,-50%) scale(1)' }, { transform: 'translate(-50%,-50%) scale(1.7)', offset: .35 }, { transform: 'translate(-50%,-50%) scale(1)' }], { duration: 480 });
    }
    clearFx();
    // falls + spawns start while the last of the kill animation plays out
    await wait(120);
    const moves = []; const cnt = {};
    for (const s of step.spawn) if (s.fromTop) cnt[s.c] = (cnt[s.c] || 0) + 1;
    for (const f of step.fall) {
      const el = els.get(f.id); if (!el) continue;
      const [x, y0] = pos(f.c, f.from), [, y1] = pos(f.c, f.to);
      el.style.transform = tf(f.c, f.to);
      const sy = step.grid[f.c][f.to].s;
      moves.push(anim(el, [{ transform: `translate(${x}px,${y0}px)` }, { transform: `translate(${x}px,${y1}px)` }], { duration: 150 + 55 * (f.to - f.from), easing: 'cubic-bezier(.5,0,.9,.6)' }).then(() => { landFx(el, f.c, f.to, { heavy: sy === 'S' || sy === 'W' }); bounce(3); }));
    }
    for (const s of step.spawn) {
      const el = mk(s.cell, s.c, s.r), [x, y] = pos(s.c, s.r);
      if (s.fromTop) {
        const n = cnt[s.c], y0 = (s.r - n) * PY - 20;
        moves.push(anim(el, [{ transform: `translate(${x}px,${y0}px)` }, { transform: `translate(${x}px,${y}px)` }], { duration: 170 + 55 * n, delay: s.order * 22, easing: 'cubic-bezier(.5,0,.9,.6)', fill: 'backwards' }).then(() => { landFx(el, s.c, s.r, { heavy: s.cell.s === 'S' || s.cell.s === 'W' }); bounce(3); }));
      } else {
        moves.push(anim(el, [{ transform: `translate(${x}px,${y}px) scale(.2)`, opacity: 0 }, { transform: `translate(${x}px,${y}px) scale(1)`, opacity: 1 }], { duration: 260, easing: 'ease-out', fill: 'backwards' }));
      }
    }
    await Promise.all([...moves, ...dead, wp]);
    SFX.land(false);
    reconcile(step.grid);
    await wait(100);
  }

  // ---------- one spin script ----------
  async function replay(script, runWin, isBonus) {
    FX.settle(0.35);
    await dropInitial(script, isBonus);
    await wait(100);
    for (let i = 0; i < script.steps.length; i++) await playStep(script.steps[i], i, runWin, isBonus);
    if (script.capped) { toast('MAX WIN 10,000x'); await wait(900); }
  }

  // ---------- modals ----------
  function modal(html, o = {}) {
    return new Promise((res) => {
      const sc = document.createElement('div'); sc.className = 'scrim'; sc.innerHTML = html; ov.appendChild(sc);
      const done = (v) => { sc.remove(); res(v); };
      sc.addEventListener('click', (e) => { const t = e.target.closest('[data-v]'); if (t) { SFX.click(); done(t.dataset.v); } else if (o.anywhere || (o.backdrop && e.target === sc)) done('x'); });
      if (o.auto) setTimeout(() => sc.isConnected && done('x'), o.auto);
      sc._done = done;
    });
  }

  async function bonusIntro(kind, spins) {
    const Ls = kind === 'landslide';
    SFX.bonusStart(); FX.ballots(90); FX.ring(540, 760, { n: 3, r1: 520, w: 22 }); pose('shock', 3000); say('bonusStart');
    const p = modal(`<div class="scene"><img class="ttl" src="assets/img/title_stack.webp" alt="">
      <h2 ${Ls ? 'class="sm"' : ''}>${Ls ? 'Landslide' : 'Recount'}</h2><h3><b class="n">${spins}</b> free spins</h3>
      <p>${Ls ? 'A wild is already planted. Wilds stick and double every time they win.' : 'Wilds stick to the board and double every time they win. Dump & Count boxes add spins.'}</p>
      <img class="mas" src="assets/img/mascot_shock.webp" alt="">
      <div class="tap">TAP TO START</div></div>`, { anywhere: true, auto: st.auto ? 2600 : 0 });
    setTimeout(() => { FX.shake(14, 400); SFX.drop(); FX.flash(100, '#fff', 0.5); }, 450);
    await p;
  }

  // ---------- PingJuice win tiers ----------
  const PJ = window.PingJuice;
  if (PJ) { PJ.config.stage = '#stage'; PJ.sfx = () => false; } // one audio engine: SFX owns every sound in this game
  if (!window.PingFmt) window.PingFmt = (n) => fmt(n);
  function juiceTier(x, maxed) { return maxed || x >= 1000 ? 'jackpot' : x >= 100 ? 'mega' : x >= 20 ? 'big' : x >= 5 ? 'nice' : null; }
  function juiceWin(x, amt, maxed) {
    const t = juiceTier(x, maxed); if (!PJ || !t) return null;
    if (t === 'big' || t === 'mega' || t === 'jackpot') PJ.screenShake(t === 'big' ? 0.7 : 1.2, 450);
    setTimeout(() => PJ.winCelebration(t, $('board'), amt), 250);
    return t;
  }
  // ---------- big-win overlay ----------
  const mugPt = () => { const [mx, my] = sOff(mascot); return [mx + mascot.offsetWidth * 0.2, my + mascot.offsetHeight * 0.13]; };
  function holdUntilTap(ms, minMs) {
    return new Promise((res) => { const s0 = performance.now(), t0 = st.tap; const iv = setInterval(() => { const d = performance.now() - s0; if (d > ms || (d > minMs && st.tap !== t0)) { clearInterval(iv); res(); } }, 40); });
  }
  async function bigWin(totalX, o = {}) {
    const t = tierOf(totalX); if (!t) return;
    const fast = !!o.fast, amt = o.to != null ? Math.round(o.to) : Math.round(totalX * bet()), from = o.from != null ? Math.round(o.from) : 0, lvl = t.lvl, tm = st.turbo ? 0.45 : 1;
    const logx = totalX >= 100 ? Math.log10(totalX / 100) : 0, mul = 1 + 0.5 * logx;
    const [bx, by] = sOff(boardEl), cx = bx + 500, cy = by + 440;
    const bg = document.createElement('div'); bg.id = 'tierbg'; bg.style.cssText = `top:${by}px;height:${boardEl.offsetHeight}px`;
    bg.innerHTML = `<div class="glow"></div><div class="burst"></div><div class="rays"></div>`;
    const box = document.createElement('div'); box.id = 'tier'; box.style.cssText = `top:${by}px;height:${boardEl.offsetHeight}px`;
    box.innerHTML = `<div class="in"><img class="banner" src="assets/img/banner_${t.img}.webp" alt="${t.n}"><div class="xx">x${xFmt(totalX)}</div>${from > 0 ? '<div class="tot">TOTAL WIN</div>' : ''}<div class="amt t${lvl} shk">${fmt(from)}</div></div>`;
    box.style.setProperty('--tm', tm);
    stage.append(bg, box); stage.classList.add('bw');
    let iv = 0;
    try {
    SFX.big(lvl); SFX.duck(true); if (lvl >= 3 && !fast) SFX.drop();
    // the banner drops from above; at impact: freeze frame, camera shake scaled by tier, flash, shockwave, paper burst
    const IMPACT = 0.52 * 620 * tm;
    setTimeout(() => {
      if (!box.isConnected) return;
      const fz = 60 + lvl * 35;
      FX.flash(140, '#fff', 0.7); FX.ring(cx, cy, { n: 2, r1: 560 + lvl * 90, w: 24, dur: 0.55 }); sfxSlam(lvl + 1); bounce(10 + lvl * 2, true);
      FX.burst(cx, cy + 40, { n: Math.round((18 + lvl * 8) * lite()), speed: 1000, size: 17, shape: 'ballot', cols: ['#FDFBF7'], g: 900, up: 250, life: 1.1 });
      freeze(fz);
      setTimeout(() => FX.shake(Math.min(46, 16 + lvl * 6 + 6 * logx) * lite(), (520 + lvl * 90 + 200 * logx) * (st.turbo ? 0.6 : 1), { big: lvl >= 3 }), reduce ? 0 : fz * speed());
    }, IMPACT);
    pose('cheer', 4200 + lvl * 500, { erupt: true }); say('bigWin');
    const [dx, dy] = sOff(dump);
    FX.flash(120, '#fff', 0.4);
    FX.eruption(dx + dump.offsetWidth * 0.5, dy + dump.offsetHeight * 0.3, [60, 100, 160, 260][lvl - 1] * mul);
    FX.radial(cx, cy, (28 + lvl * 14) * mul, { speed: 1500 });
    FX.rain([40, 80, 140, 240][lvl - 1] * mul); FX.confetti((30 + lvl * 25) * mul); FX.cannon(-1, (20 + lvl * 12) * mul); FX.cannon(1, (20 + lvl * 12) * mul);
    if (lvl >= 2) { const [mx, my] = mugPt(); FX.foam(mx, my, (40 + lvl * 20) * mul, { ang: -Math.PI / 2 + 0.25 }); setTimeout(() => FX.foam(mx, my, 30 * mul, { ang: -Math.PI / 2 + 0.25 }), 350 * tm); }
    const a = box.querySelector('.amt');
    a.textContent = fmt(amt); const base = parseFloat(getComputedStyle(a).fontSize), w = a.scrollWidth; if (w > 920) a.style.fontSize = (base * 920 / w).toFixed(1) + 'px'; a.textContent = fmt(from);
    let tk = 0; iv = setInterval(() => SFX.tick(tk++), 55 * tm);
    const D = (fast ? 1600 : Math.min(12000, [2000, 3000, 4200, 6000][lvl - 1] + (totalX >= 1000 ? 2000 * Math.log10(totalX / 100) : 0))) * tm;
    const t0 = performance.now(); let tapAt = st.tap;
    const skipped = await new Promise((res) => {
      const tick = (now) => {
        if (now - t0 < 450) tapAt = st.tap;
        const sk = st.tap !== tapAt, k = sk ? 1 : Math.max(0, Math.min(1, (now - t0) / D));
        const e = k < 0.85 ? (k / 0.85) * 0.8 : 0.8 + 0.2 * (1 - Math.pow(1 - (k - 0.85) / 0.15, 3));
        const v = from + (amt - from) * (k >= 1 ? 1 : e);
        a.textContent = fmt(v);
        if (o.meter) { countTok++; st.win = v; $('win').textContent = fmt(v); }
        if (k < 1) requestAnimationFrame(tick); else res(sk);
      };
      requestAnimationFrame(tick);
    });
    clearInterval(iv); a.classList.remove('shk');
    if (o.onCount) o.onCount();
    SFX.coin(); SFX.clink(lvl); SFX.cheer(lvl); FX.burst(cx, cy, { n: 40, speed: 900, size: 18, up: 300, shape: 'star' }); FX.rain(20 + lvl * 10); FX.flash(120, '#FFE9A8', 0.5);
    a.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 360 });
    await holdUntilTap((fast ? 700 : skipped ? 900 : 1200) * tm, 350);
    box.style.transition = bg.style.transition = 'opacity .35s'; box.style.opacity = bg.style.opacity = 0; await sleep(350);
    } finally {
      clearInterval(iv); SFX.duck(false); box.remove(); bg.remove(); stage.classList.remove('bw'); FX.settle(0.4);
    }
    st.skip = false; pose('idle');
  }
  // sub-10x wins: stamp banner + proportional juice (non-blocking)
  function smallTier(x) {
    const k = tierName(x); if (k !== 'tasty' && k !== 'nice') return false;
    stamp(pick(MINI[k]), k, k === 'tasty' ? 1700 : 1400, `x${xFmt(x)}`);
    if (k === 'tasty') { FX.confetti(35); FX.cannon(-1, 14); FX.cannon(1, 14); FX.shake(12, 420); SFX.tasty(); } else { FX.rain(18); FX.shake(9, 320); SFX.nice(); }
    SFX.coin(); SFX.clink(2); pose('hype', 1800); say(k);
    return true;
  }

  // ---------- helpers for the loss spin ----------
  function fourCluster(g) {
    const found = [];
    for (const sym of E.REG) {
      const seen = new Set();
      for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
        if (seen.has(c + ',' + r) || g[c][r].s !== sym) continue;
        const stack = [[c, r]], cells = []; seen.add(c + ',' + r);
        while (stack.length) { const [x, y] = stack.pop(); cells.push([x, y]); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || seen.has(nx + ',' + ny)) continue; const s = g[nx][ny].s; if (s !== sym && s !== 'W') continue; seen.add(nx + ',' + ny); stack.push([nx, ny]); } }
        if (cells.length === 4 && cells.some(([x, y]) => g[x][y].s === sym)) found.push(cells);
      }
    }
    return found.length ? pick(found) : null;
  }
  function fillIdle(rs) {
    const g = engine.playSpin(E.rngFrom(rs == null ? (Math.random() * 4294967296) >>> 0 : rs), { bonus: false, capLeft: 1 }).initial.map((col) => col.map((x) => (x.s === 'S' ? { ...x, s: 'pen' } : x)));
    reconcile(g); return g;
  }

  // ---------- bonus dressing ----------
  let emberIv = 0, spillN = 0;
  function bonusOn() {
    stage.classList.add('bonus'); spillN = 0; $('head').querySelectorAll('.spill').forEach((e) => e.remove()); dump.style.removeProperty('--fill');
    clearInterval(emberIv); if (!reduce) emberIv = setInterval(() => { const [bx, by] = sOff(boardEl); FX.ember(bx + 100 + Math.random() * 800, by + 700); }, 260);
  }
  function bonusOff() {
    stage.classList.remove('bonus'); clearInterval(emberIv); dump.style.removeProperty('--fill');
    $('head').querySelectorAll('.spill').forEach((e) => { e.style.transition = 'opacity .5s'; e.style.opacity = 0; setTimeout(() => e.remove(), 520); });
  }
  function spill(n) {
    const img = document.createElement('img'); img.className = 'spill'; img.src = 'assets/img/bal.webp'; img.alt = '';
    const k = Math.min(n, 12), rot = (Math.random() - 0.5) * 70;
    img.style.cssText = `right:${230 + Math.random() * 400}px;bottom:${300 + (k % 4) * 16 + Math.floor(k / 4) * 26}px;transform:rotate(${rot}deg) scale(${0.9 + Math.random() * 0.3})`;
    $('head').insertBefore(img, $('mascot')); dump.style.setProperty('--fill', Math.min(k, 12));
    const [dx, dy] = sOff(dump); FX.burst(dx + dump.offsetWidth * 0.5, dy + dump.offsetHeight * 0.25, { n: 6 + k, speed: 520, size: 12, cols: ['#FDFBF7', '#F5B942'], up: 500, g: 1200 });
  }

  // ---------- the round ----------
  let autoT = 0;
  function scheduleAuto() {
    clearTimeout(autoT);
    const go = () => { if (!st.auto || st.busy) return; if (ov.querySelector('.scrim')) { autoT = setTimeout(go, 300); return; } play('spin'); };
    autoT = setTimeout(go, 450 * speed());
  }
  async function play(mode) {
    if (st.busy) { if (mode !== 'spin') st.queued = mode; else st.skip = true; return; }
    if (betField && betField.value() === null) { toast('Pick a listed bet.'); st.auto = false; $('auto').classList.remove('on'); return; }
    const b = bet(), costX = mode === 'buy-election' ? E.CFG.buyCost.election : mode === 'buy-landslide' ? E.CFG.buyCost.landslide : 1, cost = b * costX;
    if (avail() < cost) { toast(mode === 'spin' ? `Not enough ${unitWord()}. Lower your bet.` : `Not enough ${unitWord()} for that bonus.`); st.auto = false; $('auto').classList.remove('on'); return; }
    SFX.init(); setBusy(true); st.skip = false; FX.clear(); sweepCells();
    setBal(st.bal - cost, true); setWin(0, false); SFX.spin(); pose('idle');
    if (mode === 'spin') { if (Math.random() < 0.55) say('spin'); } else { say('buy'); SFX.buy(); }
    let res, srvTotal = null;
    if (money.live) {
      try { const p = await serverRound(mode, b); res = p.res; srvTotal = p.total; }
      catch (e) {
        setBusy(false); setBal(st.bal + cost, true);
        if (e.server) { toast(e.message || 'Spin refused.', 2400); st.auto = false; $('auto').classList.remove('on'); return; }
        goPractice('Wallet did not answer. Switched to Practice (no wallet).'); return;
      }
    } else res = engine.round(rng, mode, Q.get('force') === 'bonus' ? 'bonus' : undefined);
    st.last = res;
    const run = { x: 0, lvl: 0, hold: false };
    let juiceTier_ = null, credited = false; const total = srvTotal != null ? srvTotal : Math.round(res.win * b);
    const credit = () => { if (credited) return; credited = true; setWin(total, true, 500); setBal(st.bal + total, true); };
    try {
      if (res.base) {
        const bt = !res.bonus && tierOf(res.win); run.lvl = bt ? bt.lvl : 0; run.hold = !!bt;
        await replay(res.base, run, false);
        run.hold = false;
        if (res.bonus) {
          const n = res.base.scatters, pay = res.scatterPay;
          const sc = []; for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) if (res.base.final[c][r].s === 'S') sc.push([c, r]);
          for (const [c, r] of sc) { els.get(res.base.final[c][r].id)?.classList.add('tease'); FX.burst(...cellPt(c, r), { n: 12, speed: 520, size: 14, cols: SYMCOL.S, g: 200, life: .9, shape: 'star' }); }
          SFX.scatter(n); FX.shake(22, 700); pose('shock', 1500);
          floatAt(HOLE.w / 2, HOLE.h / 2 - 90, `<span>${n} VP COINS</span>`, 'scat');
          run.x += pay; await setWin(run.x * b, true);
          await wait(900); clearFx();
        }
      }
      if (res.bonus) { st.streak = 0; st.losses = 0; await runBonus(res, run); juiceTier_ = juiceTier(res.win, !!res.maxed); }
      if (!res.bonus && total > 0) {
        st.streak = 0; st.lastLose = false;
        juiceTier_ = juiceWin(res.win, total, false);
        if (tierOf(res.win)) { try { await bigWin(res.win, { to: total, meter: true, onCount: credit }); } finally { credit(); } }
        else { await setWin(total, false); credit(); SFX.coin(); if (!smallTier(res.win)) { SFX.clink(res.win >= 1 ? 2 : 0); pose('hype', 1500); if (Math.random() < 0.8) say('smallWin'); } }
      } else if (res.bonus) { await setWin(total, false); credit(); }
      else {
        st.streak++; st.losses++;
        const four = !res.bonus && res.base && res.base.steps.length === 0 ? fourCluster(res.base.final) : null;
        let quip = false;
        if (res.base && res.base.scatters === 2) quip = true;
        else if (four) {
          for (const [c, r] of four) els.get(cur[c][r].id)?.classList.add('oneshort');
          setTimeout(() => clearFx(), 700 * speed()); say('oneShort'); SFX.oneShort(); quip = true;
          if (st.streak % 6 === 0) st.streak = 0;
        } else if (st.streak % 6 === 0) { pose(['pass', 'drink', 'shock'][st.poseRot++ % 3], 1800); say('loseStreak'); SFX.slideWhistle(false, 0); quip = true; }
        else if (!st.lastLose && Math.random() < 0.45) { const dr = Math.random() < 0.5; pose(dr ? 'drink' : 'pass', 1200); say('lose'); if (dr) SFX.hic(); quip = true; }
        st.lastLose = quip;
      }
    } catch (e) { console.error(e); }
    credit(); hcRecord(total - cost);
    if (money.live) { setBal(walletBal(), true); toParent({ type: 'round', win: total, bet: b, mode: money.mode, tier: juiceTier_ }); }
    else if (st.bal < BETS[0]) { setBal(50000, true); toast('Out of VOTES. Free refill to 50,000.', 2200); }
    st.skip = false; setBusy(false);
    if (st.queued) { const m = st.queued; st.queued = null; setTimeout(() => play(m), 300); return; }
    if (st.auto) scheduleAuto();
  }

  async function runBonus(res, run) {
    const bn = res.bonus, b = bet(), Ls = bn.kind === 'landslide', name = Ls ? 'Recount'.replace('Recount', 'Landslide') : 'Recount';
    await bonusIntro(bn.kind, bn.startSpins);
    bonusOn(); SFX.music('bonus'); pose('hype', 2000);
    let spinNo = 0, totalSpins = bn.startSpins;
    const rib = () => { $('ribL').textContent = `${name} ${spinNo}/${totalSpins}`; $('ribR').textContent = `${Math.max(0, totalSpins - spinNo)} left`; };
    for (const sp of bn.spins) {
      spinNo++; rib(); spill(spinNo); say('bonusSpin');
      SFX.spin(true);
      const bt = tierOf(sp.win), x0 = run.x; run.lvl = bt ? bt.lvl : 0; run.hold = !!bt;
      await replay(sp, run, true);
      run.hold = false;
      if (bt) await bigWin(sp.win, { fast: true, from: x0 * b, to: run.x * b, meter: true, onCount: () => setWin(run.x * b, false) });
      else { await setWin(run.x * b, false); smallTier(sp.win); }
      run.lvl = 0;
      if (sp.retrigger) {
        totalSpins += sp.retrigger; rib();
        for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) if (sp.final[c][r].s === 'S') els.get(sp.final[c][r].id)?.classList.add('tease');
        SFX.scatter(sp.scatters); SFX.retrigger(); FX.ballots(60); for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) if (sp.final[c][r].s === 'S') FX.ring(...cellPt(c, r), { n: 2, r1: 200 }); FX.shake(20, 600); FX.flash(120, '#FFE9A8', 0.6); pose('cheer', 1800);
        stamp(`+${sp.retrigger} SPINS`, 'retrig', 1500);
        await wait(1500); clearFx();
      }
      await wait(160);
    }
    const t = tierOf(res.win);
    SFX.bonusEnd(t ? t.lvl : 2); FX.ballots(120); FX.ring(540, 800, { n: 3, r1: 600, w: 26 }); pose('cheer', 5000, { erupt: true }); say('bonusEnd'); votedStamp();
    const amt = Math.round(res.win * b);
    { const jt = juiceTier(res.win, !!res.maxed); if (PJ && (jt === 'big' || jt === 'mega' || jt === 'jackpot')) PJ.screenShake(jt === 'big' ? 0.7 : 1.2, 450); }
    const p = modal(`<div class="scene out"><img class="ttl" src="assets/img/title_stack.webp" alt="">
      ${t ? `<img class="banner" src="assets/img/banner_${t.img}.webp" alt="${t.n}">` : `<h2 class="sm">${name} done</h2>`}
      <div class="big" id="sumAmt">0</div><p>${xFmt(res.win)}x your bet${res.maxed ? ' (max win)' : ''}</p>
      <img class="mas" src="assets/img/mascot_cheer.webp" alt="">
      <div class="tap">TAP TO CONTINUE</div></div>`, { anywhere: true, auto: st.auto ? 4600 : 0 });
    requestAnimationFrame(() => { const el = $('sumAmt'); if (el) { const dur = (3000 + (t ? 1500 : 0)) / speed(); countTo(el, 0, amt, dur, fmt); } });
    await p;
    bonusOff(); SFX.music('base'); pose('idle');
    $('ribL').textContent = '5+ matching = win. Wilds multiply.'; $('ribR').textContent = 'MAX 10,000x';
    for (const [id, el] of els) { el.remove(); els.delete(id); } cur = null;
    fillIdle();
    for (const el of els.values()) anim(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 300 });
  }

  // ---------- controls ----------
  $('spin').addEventListener('click', () => { SFX.init(); st.tap++; if (st.busy) { st.skip = true; return; } play('spin'); });
  $('board').addEventListener('click', () => { st.tap++; if (st.busy) st.skip = true; });
  $('betDn').addEventListener('click', () => { if (st.busy) return; st.betIdx = Math.max(0, st.betIdx - 1); SFX.bet(-1); drawBet(); });
  $('betUp').addEventListener('click', () => { if (st.busy) return; st.betIdx = Math.min(BETS.length - 1, st.betIdx + 1); SFX.bet(1); drawBet(); });
  $('turbo').addEventListener('click', () => { st.turbo = !st.turbo; $('turbo').classList.toggle('on', st.turbo); SFX.turbo(st.turbo); });
  $('auto').addEventListener('click', () => { SFX.init(); st.auto = !st.auto; $('auto').classList.toggle('on', st.auto); SFX.click(); if (st.auto && !st.busy) play('spin'); });
  const postMusicPref = () => { if (window.parent !== window) window.parent.postMessage({ type: 'bender-music-pref', value: SFX.isMusicOn() }, '*'); };
  const swUi = (id, on, name, x, w) => { const b = $(id); if (x) x.style.display = on ? 'none' : ''; if (w) w.style.display = on ? '' : 'none'; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.setAttribute('aria-label', name + (on ? ' on' : ' off')); b.title = name + (on ? ' on' : ' off'); };
  const sndUi = (on) => swUi('snd', on, 'Sound effects', $('sndx'), $('sndw'));
  const musUi = (on) => swUi('mus', on, 'Music', $('musx'), null);
  sndUi(SFX.isOn()); musUi(SFX.isMusicOn());
  $('snd').addEventListener('click', () => { SFX.init(); const on = SFX.toggle(); if (PJ) PJ.setSfx(on); sndUi(on); if (on) SFX.click(); });
  $('mus').addEventListener('click', () => { SFX.init(); const on = SFX.toggleMusic(); musUi(on); postMusicPref(); });
  // shell/lobby radio can flip the slot's music switch; the slot reports user flips back as 'bender-music-pref'
  addEventListener('message', (ev) => { const m = ev.data; if (!m || m.type !== 'music-enabled' || (window.parent !== window && ev.source !== window.parent)) return; SFX.setMusicEnabled(!!m.value); musUi(SFX.isMusicOn()); });
  $('pigeon').addEventListener('click', () => { SFX.init(); SFX.hic(); say('idle'); });
  stage.addEventListener('click', (e) => { if (e.target.closest('#tier')) st.tap++; });
  addEventListener('keydown', (e) => { const sc = ov.querySelector('.scrim'); if (e.key === 'Escape' && sc) { e.stopImmediatePropagation(); sc._done?.('x'); } });
  addEventListener('keydown', (e) => { if (e.target && e.target.closest && e.target.closest('.amt')) return; if (e.code === 'Space' && !e.repeat) { e.preventDefault(); if (ov.querySelector('.scrim')) { ov.querySelector('.scrim')._done?.('x'); return; } SFX.init(); st.tap++; st.busy ? (st.skip = true) : play('spin'); } });

  $('buy').addEventListener('click', async () => {
    if (st.busy) return; SFX.init(); SFX.click();
    const C = E.CFG, b = bet(), cE = b * C.buyCost.election, cL = b * C.buyCost.landslide;
    const v = await modal(`<div class="card"><h2 style="font-size:70px">Buy a bonus</h2>
      <div class="buygrid">
        <button class="buyopt" data-v="buy-election" ${avail() < cE ? 'disabled' : ''}><b>Recount</b><span>${C.spinsFor[3]} free spins. Wilds stick and double.</span><em>${fmt(cE)}</em><u>${money.live ? '' : 'VOTES'}</u></button>
        <button class="buyopt" data-v="buy-landslide" ${avail() < cL ? 'disabled' : ''}><b>Landslide</b><span>${C.spinsFor[4]} free spins. Starts with a wild planted.</span><em>${fmt(cL)}</em><u>${money.live ? '' : 'VOTES'}</u></button>
      </div><button class="btn alt" data-v="x">Not now</button></div>`, { backdrop: true });
    if (v === 'buy-election' || v === 'buy-landslide') play(v);
  });

  $('info').addEventListener('click', async () => {
    if (st.busy) return; SFX.init(); SFX.click();
    const C = E.CFG, P = C.pay, f = (n) => (n >= 100 ? Math.round(n) : n >= 10 ? n.toFixed(1).replace(/\.0$/, '') : n.toFixed(2).replace(/0$/, ''));
    const rows = ['seal', 'phn', 'cap', 'meg', 'yrd', 'bal', 'stk', 'pen'].map((s) => `<div><img src="assets/img/sym/${s}.webp" alt=""><span>${NAMES[s]}<small>5: ${f(P[s][0])}x<br>10+: ${f(P[s][5])}x<br>20+: ${f(P[s][8])}x</small></span></div>`).join('');
    const tiers = E.TIERS.slice().reverse().filter((t) => t[1] !== 'nice' && t[1] !== 'tasty').map(([x, k], i, a) => `${TIER_LABEL[k]} ${x}x${i === a.length - 1 ? '+' : ''}`).join(', ');
    await modal(`<div class="card" style="width:960px;padding:36px 40px 40px"><h2 style="font-size:64px">How it plays</h2>
      <p style="margin-top:10px;font-size:26px">Match 5 or more of the same symbol touching up, down, left or right. Winners vanish and new symbols tumble in until nothing pays.</p>
      <div class="pay">${rows}</div>
      <p style="font-size:24px"><b>Dump &amp; Count box</b> is wild: it stands in for any symbol and carries a multiplier. Multipliers in one cluster add together.</p>
      <p style="font-size:24px"><b>VP coin</b>: 3 trigger the Recount (${C.spinsFor[3]} free spins). 4+ trigger the Landslide (${C.spinsFor[4]}+ spins, a wild planted). In free spins wilds stick and double each time they win.</p>
      <p style="font-size:24px">Big wins: ${tiers}. Max win ${fx(E.MAX_WIN_X)}x. ${window.BENDER_FOOTER || ''}</p>
      <button class="btn" data-v="x" style="margin-top:20px">Close</button></div>`, { backdrop: true });
  });

  // ---------- idle life: rotating lines, random drink ----------
  let idleTick = 0;
  setInterval(() => {
    if (st.busy || ov.querySelector('.scrim') || $('splash')?.isConnected && !$('splash').classList.contains('out') && !Q.has('nosplash')) return;
    if (curPose !== 'idle') return;
    idleTick++; if (idleTick % 2 === 0) say('idle');
    if (Math.random() < 0.35) { pose('drink', 1900); SFX.hic(); }
  }, 4200);

  // ---------- bridge ----------
  function serverRound(mode, b) {
    return new Promise((resolve, reject) => {
      const id = ++reqSeq;
      const t = setTimeout(() => { pend.delete(id); reject(new Error('timeout')); }, 2000);
      pend.set(id, { ok: (p) => { clearTimeout(t); resolve(p); }, err: (e) => { clearTimeout(t); reject(e); } });
      toParent({ type: 'spin', reqId: id, bet: b, mode: money.mode, buy: mode === 'spin' ? null : String(mode).replace(/^buy-/, '') });
    });
  }
  function onResult(m) {
    const w = pend.get(m.reqId); if (!w) return; pend.delete(m.reqId);
    if (m.type === 'error') { w.err(Object.assign(new Error(m.message || 'Spin refused.'), { server: true })); return; }
    const p = m.payload || {};
    const res = p.res || p.round || (p.base || p.bonus || typeof p.win === 'number' ? p : null);
    if (!res) { w.err(new Error('bad result')); return; }
    w.ok({ res, total: typeof p.totalWin === 'number' ? p.totalWin : null });
    if (p.balances) applyWallet(p.balances);
  }
  function applyWallet(w) {
    if (!w) return;
    if (typeof w.play === 'number') money.wallet.play = w.play;
    if (typeof w.chips === 'number') money.wallet.chips = w.chips;
    if (money.live && !st.busy) setBal(walletBal(), false);
  }
  function modeUi() {
    const bar = $('modebar'); if (!bar) return;
    bar.dataset.state = money.live ? money.mode : 'practice';
    bar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', money.live && b.dataset.m === money.mode));
    $('modenote').textContent = !money.live ? 'Practice (no wallet)' : money.mode === 'chips' ? 'Real poker chips from your bank.' : 'Pretend money.';
    $('balM').querySelector('.lbl').innerHTML = '&#9733; ' + (!money.live ? 'VOTES' : money.mode === 'chips' ? 'CHIPS' : 'BALANCE');
    const fineTxt = !money.live ? 'Practice (no wallet). Free play only.' : (window.BENDER_FOOTER || 'No deposits, no payouts. Chips are your poker bank.');
    [$('fine'), $('dis')].forEach((el) => { if (el) el.textContent = fineTxt; });
  }
  function setBets(list) {
    BETS.length = 0; list.forEach((x) => BETS.push(x));
    st.betIdx = Math.min(BETS.length - 1, Math.max(0, BETS.indexOf(100) >= 0 ? BETS.indexOf(100) : 3));
  }
  // live math from the server (pay table / buy prices shown in the UI); the server always settles with its own copy
  function applyCfg(c) { if (!c || typeof c !== 'object') return; for (const k of Object.keys(c)) if (k in E.CFG) E.CFG[k] = c[k]; if (!st.busy) drawBet(); }
  function goLive(m) {
    applyCfg(m.cfg);
    if (!money.live) { money.live = true; setBets(Array.isArray(m.bets) && m.bets.length ? m.bets : DEFAULT_BETS.concat([2500])); }
    if (m.mode === 'play' || m.mode === 'chips') money.mode = m.mode;
    fmt = liveFmt();
    applyWallet(m.wallet || m.balances); modeUi(); if (!st.busy) setBal(walletBal(), false); drawBet();
  }
  function goPractice(msg) {
    money.live = false; fmt = fx; pend.clear(); setBets(DEFAULT_BETS); st.betIdx = 3; st.bal = st.balShown = 50000;
    modeUi(); setBal(50000, false); drawBet(); if (msg) toast(msg, 2600);
  }
  if (P.Money && P.Money.onPrefChange) P.Money.onPrefChange(() => { if (money.live) fmt = liveFmt(); if (!st.busy) setBal(money.live ? walletBal() : st.bal, false); drawBet(); });
  function initBridge() {
    const bar = document.createElement('div'); bar.id = 'modebar';
    bar.innerHTML = '<div class="mb"><button data-m="play">Play $</button><button data-m="chips">Chips</button></div><span id="modenote"></span>';
    $('stage').appendChild(bar);
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || !money.live || st.busy) return;
      money.mode = b.dataset.m; fmt = liveFmt(); SFX.click(); setBal(walletBal(), false); modeUi(); drawBet(); toParent({ type: 'mode', mode: money.mode });
    });
    modeUi();
    if (!BRIDGE) return;
    addEventListener('message', (ev) => {
      if (ev.source !== window.parent) return; const m = ev.data || {};
      if (m.type === 'init') goLive(m); else if (m.type === 'cfg') applyCfg(m.cfg); else if (m.type === 'wallet') { if (money.live) applyWallet(m.wallet || m); else goLive(m); }
      else if (m.type === 'result' || m.type === 'error') onResult(m);
    });
    addEventListener('keydown', (e) => { if (e.key === 'Escape') toParent({ type: 'esc' }); });
    toParent({ type: 'hello' });
    setTimeout(() => { if (!money.live) toParent({ type: 'practice' }); }, 2000);
  }

  // ---------- boot ----------
  function boot() {
    $('bal').textContent = fmtBal(st.bal); $('win').textContent = '0'; drawBet(); $('ribR').textContent = 'MAX ' + fx(E.MAX_WIN_X) + 'x';
    $('fine').textContent = $('dis').textContent = window.BENDER_FOOTER || 'Free play only. No real money.';
    initBridge(); postMusicPref();
    say('idle');
    fillIdle((seed ^ 0x9e3779b9) >>> 0);
    const start = () => { SFX.init(); $('splash').classList.add('out'); SFX.music('base'); setTimeout(() => $('splash').remove(), 600); };
    if (Q.has('nosplash')) { $('splash').remove(); } else $('go').addEventListener('click', start);
    if (Q.get('buy')) setTimeout(() => play(Q.get('buy') === 'landslide' ? 'buy-landslide' : 'buy-election'), 400);
    document.addEventListener('pointerdown', () => SFX.init(), { once: true });
  }
  window.BENDER = { st, engine, play, get last() { return st.last; }, seed, bigWin, smallTier, stamp, pose, say, bubble: bubbleShow, spill, bonusOn, bonusOff };
  boot();
})();
