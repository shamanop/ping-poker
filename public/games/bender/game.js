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
  const money = { live: false, mode: 'play', wallet: { play: 0, ledgerNet: 0, ledgerLimit: -50000 } };
  const pend = new Map(); let reqSeq = 0;
  const toParent = (m) => { if (BRIDGE) window.parent.postMessage(m, '*'); };
  const walletBal = () => (money.mode === 'ledger' ? money.wallet.ledgerNet : money.wallet.play);
  const avail = () => (money.live ? (money.mode === 'ledger' ? money.wallet.ledgerNet - (money.wallet.ledgerLimit ?? -50000) : money.wallet.play) : st.bal);
  const fmtBal = (n) => (money.live && money.mode === 'ledger' && n > 0 ? '+' : '') + fmt(n);
  const unitWord = () => (money.live ? 'funds' : 'VOTES');

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
  ['pen', 'stk', 'bal', 'yrd', 'meg', 'cap', 'phn', 'seal', 'W', 'S'].forEach((s) => { new Image().src = `assets/img/${s}.webp`; });
  ['idle', 'drink', 'hype', 'shock', 'cheer', 'pass'].forEach((p) => { new Image().src = `assets/img/mascot_${p}.webp`; });
  ['banner_closeenough', 'banner_ballotbender', 'banner_megalandslide', 'banner_worldisyours', 'dumpster_erupt'].forEach((p) => { new Image().src = `assets/img/${p}.webp`; });

  // ---------- mascot: pose + caption bubble ----------
  let poseT = 0, curPose = 'idle', lastLine = '';
  function pose(name, ms, o) {
    o = o || {};
    clearTimeout(poseT); curPose = name;
    mimg.src = `assets/img/mascot_${name}.webp`; mimg.className = 'p-' + name; mimg.style.left = ((POSE_X.idle - POSE_X[name]) / 640 * mascot.offsetHeight).toFixed(1) + 'px'; mascot.className = name === 'idle' || name === 'drink' || name === 'hype' ? '' : name;
    const er = !!o.erupt, was = dump.src.includes('erupt');
    if (er !== was) { dump.src = `assets/img/dumpster_${er ? 'erupt' : 'back'}.webp`; if (er) { dump.classList.remove('erupt'); void dump.offsetWidth; dump.classList.add('erupt'); } }
    if (name !== 'idle' && ms !== 0) poseT = setTimeout(() => pose('idle'), ms || 1500);
  }
  function say(group, force) {
    const pool = L[group]; if (!pool || !pool.length) return;
    let t; for (let i = 0; i < 6; i++) { t = pool[(Math.random() * pool.length) | 0]; if (t !== lastLine) break; }
    lastLine = t; const p = $('bubbleT'), b = $('bubble');
    p.textContent = t; p.classList.toggle('sm', t.length > 30);
    b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
  }

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
    const img = document.createElement('img'); img.src = `assets/img/${cell.s}.webp`; img.alt = ''; el.appendChild(img);
    setMult(el, cell); el.classList.toggle('stick', !!cell.stick);
    el.style.transform = tf(c, r); cellsEl.appendChild(el); els.set(cell.id, el); return el;
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

  // ---------- readouts ----------
  let countTok = 0;
  function countTo(el, from, to, ms, f = fmt, after) {
    const tok = ++countTok; const t0 = performance.now(); ms = Math.max(1, ms * speed());
    return new Promise((res) => {
      const tick = (now) => {
        if (tok !== countTok && el === $('win')) { el.textContent = f(to); return res(); }
        const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
        el.textContent = f(from + (to - from) * e);
        if (k < 1) requestAnimationFrame(tick); else { if (after) after(); res(); }
      };
      requestAnimationFrame(tick);
    });
  }
  function setWin(x, animate, ms = 380) {
    const from = st.win; st.win = x;
    const w = $('win');
    if (animate && x > from) { w.classList.remove('pop'); void w.offsetWidth; w.classList.add('pop'); return countTo(w, from, x, ms); }
    countTok++; w.textContent = fmt(x); return Promise.resolve();
  }
  function setBal(v, animate) {
    const from = st.balShown; st.bal = v; st.balShown = v;
    if (animate && from !== v) { const el = $('bal'); const t0 = performance.now(), ms = 700 * speed(); const tick = (now) => { const k = Math.min(1, (now - t0) / ms); el.textContent = fmtBal(from + (v - from) * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(tick); else el.textContent = fmtBal(v); }; requestAnimationFrame(tick); }
    else $('bal').textContent = fmtBal(v);
  }
  function drawBet() { $('bet').textContent = fmt(bet()); $('betDn').disabled = st.busy || st.betIdx === 0; $('betUp').disabled = st.busy || st.betIdx === BETS.length - 1; $('buy').disabled = st.busy; }
  function setBusy(b) {
    st.busy = b; $('spin').classList.toggle('run', b); $('spin').classList.toggle('idle', !b); drawBet();
    $('buy').innerHTML = `Buy Bonus`;
  }

  // ---------- floats / stamps ----------
  function floatAt(x, y, html, cls) {
    const f = document.createElement('div'); f.className = 'float ' + (cls || ''); f.innerHTML = html; f.style.left = x + 'px'; f.style.top = y + 'px'; floatsEl.appendChild(f);
    anim(f, [{ transform: 'translate(-50%,-50%) scale(.3)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1.25)', opacity: 1, offset: 0.18 }, { transform: 'translate(-50%,-70%) scale(1)', opacity: 1, offset: 0.7 }, { transform: 'translate(-50%,-130%) scale(1)', opacity: 0 }], { duration: 1100, easing: 'ease-out' }).then(() => f.remove());
  }
  const toast = (t, ms = 1600) => { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; stage.appendChild(d); setTimeout(() => d.remove(), ms); };
  function stamp(text, cls, ms = 1500, sub) {
    const d = document.createElement('div'); d.className = 'stamp ' + cls; d.innerHTML = `<b>${text}</b>${sub ? `<i>${sub}</i>` : ''}`; boardEl.appendChild(d);
    anim(d, [{ transform: 'translate(-50%,-50%) scale(2.6) rotate(-14deg)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(.92) rotate(-6deg)', opacity: 1, offset: 0.2 }, { transform: 'translate(-50%,-50%) scale(1) rotate(-6deg)', opacity: 1, offset: 0.8 }, { transform: 'translate(-50%,-64%) scale(1) rotate(-6deg)', opacity: 0 }], { duration: ms, easing: 'ease-out' }).then(() => d.remove());
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
      outs.push(anim(el, [{ transform: `translate(${x}px,${y}px)`, opacity: 1 }, { transform: `translate(${x}px,${y + 700}px)`, opacity: 0 }], { duration: 300, delay: (x / PX) * 18 + (4 - y / PY) * 14, easing: 'cubic-bezier(.5,0,.9,.6)' }).then(() => { el.remove(); els.delete(id); }));
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
          el.style.opacity = ''; if (cell.s === 'S') { el.classList.add('scat'); FX.burst(...cellPt(c, r), { n: 8, speed: 380, size: 12, cols: SYMCOL.S, g: 300, life: .7, shape: 'star' }); } if (!reduce) anim(el.querySelector('img'), [{ transform: 'scale(1.06,.86)', transformOrigin: '50% 100%' }, { transform: 'scale(.97,1.04)', transformOrigin: '50% 100%', offset: .55 }, { transform: 'none', transformOrigin: '50% 100%' }], { duration: 190 });
        }));
      }
    }
    // sound + anticipation choreography
    for (let c = 0; c < COLS; c++) {
      setTimeout(() => {
        let heavy = false; const before = scSeen; for (let r = 0; r < ROWS; r++) if (grid[c][r].s === 'S') { heavy = true; scSeen++; SFX.scatter(scSeen); }
        SFX.land(heavy);
        if (before < 3 && scSeen >= 3) hitStop(250);
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
    if (!isBonus && script.scatters === 2) { pose('shock', 1500); say('nearMiss'); }
  }

  // ---------- a step (one tumble) ----------
  const chain = (cells) => { // greedy nearest-neighbour path through cell centres
    const left = cells.slice(), out = [left.shift()];
    while (left.length) { const [lc, lr] = out[out.length - 1]; let bi = 0, bd = 1e9; left.forEach(([c, r], i) => { const d = (c - lc) ** 2 + (r - lr) ** 2; if (d < bd) { bd = d; bi = i; } }); out.push(left.splice(bi, 1)[0]); }
    return out.map(([c, r]) => cellPt(c, r));
  };
  async function playStep(step, idx, runWin, isBonus) {
    const inCl = new Set(); for (const k of step.clusters) for (const [c, r] of k.cells) inCl.add(c + ',' + r);
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) { const el = els.get(cur[c][r].id); if (!el) continue; el.classList.add(inCl.has(c + ',' + r) ? 'hit' : 'dim'); }
    SFX.chime(idx);
    const sw = step.stepWin, b = bet();
    for (const k of step.clusters) {
      let sx = 0, sy = 0; for (const [c, r] of k.cells) { sx += c; sy += r; }
      const x = (sx / k.cells.length + .5) * PX, y = (sy / k.cells.length + .5) * PY;
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
      FX.burst(...cellPt(c, r), { n: 9, speed: 560, size: 15, cols: SYMCOL[cell.s] || SYMCOL.W, up: 160 });
      dead.push(anim(el, [{ transform: el.style.transform + ' scale(1)', opacity: 1 }, { transform: el.style.transform + ' scale(1.25)', opacity: 1, offset: .35 }, { transform: el.style.transform + ' scale(0)', opacity: 0 }], { duration: 260, easing: 'ease-in' }).then(() => { el.remove(); els.delete(cell.id); }));
    }
    if (st.turbo === false && sw >= 1) FX.shake(Math.min(14, 3 + step.clusters.reduce((a, k) => a + k.size, 0) * 0.5), 260);
    // growth
    for (const g of step.grown) {
      const el = els.get(cur[g.c][g.r].id); if (!el) continue;
      const m = el.querySelector('.mult'); if (m) m.textContent = g.to + 'x'; el.classList.toggle('big', g.to >= 10);
      SFX.grow(); FX.burst(...cellPt(g.c, g.r), { n: 14, speed: 640, size: 16, cols: SYMCOL.W });
      anim(el.querySelector('img'), [{ transform: 'scale(1)' }, { transform: 'scale(1.5)', offset: .35 }, { transform: 'scale(1)' }], { duration: 480, easing: 'ease-out' });
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
      moves.push(anim(el, [{ transform: `translate(${x}px,${y0}px)` }, { transform: `translate(${x}px,${y1}px)` }], { duration: 150 + 55 * (f.to - f.from), easing: 'cubic-bezier(.5,0,.9,.6)' }));
    }
    for (const s of step.spawn) {
      const el = mk(s.cell, s.c, s.r), [x, y] = pos(s.c, s.r);
      if (s.fromTop) {
        const n = cnt[s.c], y0 = (s.r - n) * PY - 20;
        moves.push(anim(el, [{ transform: `translate(${x}px,${y0}px)` }, { transform: `translate(${x}px,${y}px)` }], { duration: 170 + 55 * n, delay: s.order * 22, easing: 'cubic-bezier(.5,0,.9,.6)', fill: 'backwards' }));
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
      sc.addEventListener('click', (e) => { const t = e.target.closest('[data-v]'); if (t) { SFX.click(); done(t.dataset.v); } else if (o.anywhere) done('x'); });
      if (o.auto) setTimeout(() => sc.isConnected && done('x'), o.auto);
      sc._done = done;
    });
  }

  async function bonusIntro(kind, spins) {
    const Ls = kind === 'landslide';
    SFX.sting(); FX.confetti(70); FX.cannon(-1, 40); FX.cannon(1, 40); pose('shock', 3000); say('bonusStart');
    const p = modal(`<div class="scene"><img class="ttl" src="assets/img/title_stack.webp" alt="">
      <h2 ${Ls ? 'class="sm"' : ''}>${Ls ? 'Landslide' : 'Recount'}</h2><h3><b class="n">${spins}</b> free spins</h3>
      <p>${Ls ? 'A wild is already planted. Wilds stick and double every time they win.' : 'Wilds stick to the board and double every time they win. Dump & Count boxes add spins.'}</p>
      <img class="mas" src="assets/img/mascot_shock.webp" alt="">
      <div class="tap">TAP TO START</div></div>`, { anywhere: true, auto: st.auto ? 2600 : 0 });
    setTimeout(() => { FX.shake(14, 400); SFX.drop(); FX.flash(100, '#fff', 0.5); }, 450);
    await p;
  }

  // ---------- big-win overlay ----------
  const mugPt = () => { const [mx, my] = sOff(mascot); return [mx + mascot.offsetWidth * 0.2, my + mascot.offsetHeight * 0.13]; };
  function holdUntilTap(ms, minMs) {
    return new Promise((res) => { const s0 = performance.now(), t0 = st.tap; const iv = setInterval(() => { const d = performance.now() - s0; if (d > ms || (d > minMs && st.tap !== t0)) { clearInterval(iv); res(); } }, 40); });
  }
  async function bigWin(totalX, o = {}) {
    const t = tierOf(totalX); if (!t) return;
    const fast = !!o.fast, amt = Math.round(totalX * bet()), lvl = t.lvl, tm = st.turbo ? 0.45 : 1;
    const logx = totalX >= 100 ? Math.log10(totalX / 100) : 0, mul = 1 + 0.5 * logx;
    const [bx, by] = sOff(boardEl), cx = bx + 500, cy = by + 440;
    const bg = document.createElement('div'); bg.id = 'tierbg'; bg.style.cssText = `top:${by}px;height:${boardEl.offsetHeight}px`;
    bg.innerHTML = `<div class="glow"></div><div class="burst"></div><div class="rays"></div>`;
    const box = document.createElement('div'); box.id = 'tier'; box.style.cssText = `top:${by}px;height:${boardEl.offsetHeight}px`;
    box.innerHTML = `<div class="in"><img class="banner" src="assets/img/banner_${t.img}.webp" alt="${t.n}"><div class="xx">x${xFmt(totalX)}</div><div class="amt t${lvl} shk">0</div></div>`;
    stage.append(bg, box); stage.classList.add('bw');
    SFX.big(lvl); SFX.duck(true); if (lvl >= 3 && !fast) SFX.drop();
    pose('cheer', 4200 + lvl * 500, { erupt: true }); say('bigWin');
    const [dx, dy] = sOff(dump);
    FX.flash(170, '#fff', 0.85);
    FX.eruption(dx + dump.offsetWidth * 0.5, dy + dump.offsetHeight * 0.3, [60, 100, 160, 260][lvl - 1] * mul);
    FX.radial(cx, cy, (28 + lvl * 14) * mul, { speed: 1500 });
    FX.rain([40, 80, 140, 240][lvl - 1] * mul); FX.confetti((30 + lvl * 25) * mul); FX.cannon(-1, (20 + lvl * 12) * mul); FX.cannon(1, (20 + lvl * 12) * mul);
    FX.shake(Math.min(46, 14 + lvl * 5 + 6 * logx), 500 + lvl * 80 + 200 * logx, { big: lvl >= 3 });
    if (lvl >= 2) { const [mx, my] = mugPt(); FX.foam(mx, my, (40 + lvl * 20) * mul, { ang: -Math.PI / 2 + 0.25 }); setTimeout(() => FX.foam(mx, my, 30 * mul, { ang: -Math.PI / 2 + 0.25 }), 350 * tm); }
    const a = box.querySelector('.amt');
    a.textContent = fmt(amt); const base = parseFloat(getComputedStyle(a).fontSize), w = a.scrollWidth; if (w > 920) a.style.fontSize = (base * 920 / w).toFixed(1) + 'px'; a.textContent = '0';
    let tk = 0; const iv = setInterval(() => SFX.tick(tk++), 55 * tm);
    const D = (fast ? 1600 : Math.min(12000, [2000, 3000, 4200, 6000][lvl - 1] + (totalX >= 1000 ? 2000 * Math.log10(totalX / 100) : 0))) * tm;
    const t0 = performance.now(); let tapAt = st.tap;
    const skipped = await new Promise((res) => {
      const tick = (now) => {
        if (now - t0 < 450) tapAt = st.tap;
        const sk = st.tap !== tapAt, k = sk ? 1 : Math.min(1, (now - t0) / D);
        const e = k < 0.85 ? (k / 0.85) * 0.8 : 0.8 + 0.2 * (1 - Math.pow(1 - (k - 0.85) / 0.15, 3));
        a.textContent = fmt(amt * (k >= 1 ? 1 : e));
        if (k < 1) requestAnimationFrame(tick); else res(sk);
      };
      requestAnimationFrame(tick);
    });
    clearInterval(iv); a.classList.remove('shk');
    if (o.onCount) o.onCount();
    SFX.coin(); SFX.clink(lvl); SFX.cheer(lvl); FX.burst(cx, cy, { n: 40, speed: 900, size: 18, up: 300, shape: 'star' }); FX.rain(20 + lvl * 10); FX.flash(120, '#FFE9A8', 0.5);
    a.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 360 });
    await holdUntilTap((fast ? 700 : skipped ? 900 : 1200) * tm, 350);
    SFX.duck(false);
    box.style.transition = bg.style.transition = 'opacity .35s'; box.style.opacity = bg.style.opacity = 0; await sleep(350); box.remove(); bg.remove(); stage.classList.remove('bw');
    st.skip = false; pose('idle');
  }
  // sub-10x wins: stamp banner + proportional juice (non-blocking)
  function smallTier(x) {
    const k = tierName(x); if (k !== 'tasty' && k !== 'nice') return false;
    stamp(pick(MINI[k]), k, k === 'tasty' ? 1700 : 1400, `x${xFmt(x)}`);
    if (k === 'tasty') { FX.confetti(35); FX.cannon(-1, 14); FX.cannon(1, 14); FX.shake(12, 420); SFX.cheer(0); } else { FX.rain(18); FX.shake(9, 320); }
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
    const b = bet(), costX = mode === 'buy-election' ? E.CFG.buyCost.election : mode === 'buy-landslide' ? E.CFG.buyCost.landslide : 1, cost = b * costX;
    if (avail() < cost) { toast(mode === 'spin' ? `Not enough ${unitWord()}. Lower your bet.` : `Not enough ${unitWord()} for that bonus.`); st.auto = false; $('auto').classList.remove('on'); return; }
    SFX.init(); setBusy(true); st.skip = false;
    setBal(st.bal - cost, true); setWin(0, false); SFX.spin(); pose('idle');
    if (mode === 'spin') { if (Math.random() < 0.55) say('spin'); } else say('buy');
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
    let credited = false; const total = srvTotal != null ? srvTotal : Math.round(res.win * b);
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
      if (res.bonus) { st.streak = 0; st.losses = 0; await runBonus(res, run); }
      if (!res.bonus && total > 0) {
        st.streak = 0; st.lastLose = false;
        if (tierOf(res.win)) { try { await bigWin(res.win, { onCount: credit }); } finally { credit(); } }
        else { await setWin(total, false); credit(); SFX.coin(); if (!smallTier(res.win)) { SFX.clink(res.win >= 1 ? 2 : 0); pose('hype', 1500); if (Math.random() < 0.8) say('smallWin'); } }
      } else if (res.bonus) { await setWin(total, false); credit(); }
      else {
        st.streak++; st.losses++;
        const four = !res.bonus && res.base && res.base.steps.length === 0 ? fourCluster(res.base.final) : null;
        let quip = false;
        if (res.base && res.base.scatters === 2) quip = true;
        else if (four) {
          for (const [c, r] of four) els.get(cur[c][r].id)?.classList.add('oneshort');
          setTimeout(() => clearFx(), 700 * speed()); say('oneShort'); SFX.slideWhistle(false, 0); quip = true;
          if (st.streak % 6 === 0) st.streak = 0;
        } else if (st.streak % 6 === 0) { pose(['pass', 'drink', 'shock'][st.poseRot++ % 3], 1800); say('loseStreak'); SFX.slideWhistle(false, 0); quip = true; }
        else if (!st.lastLose && Math.random() < 0.45) { const dr = Math.random() < 0.5; pose(dr ? 'drink' : 'pass', 1200); say('lose'); if (dr) SFX.hic(); quip = true; }
        st.lastLose = quip;
      }
    } catch (e) { console.error(e); }
    credit();
    if (money.live) { setBal(walletBal(), true); toParent({ type: 'round', win: total, bet: b, mode: money.mode }); }
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
      SFX.spin();
      const bt = tierOf(sp.win); run.lvl = bt ? bt.lvl : 0; run.hold = !!bt;
      await replay(sp, run, true);
      run.hold = false;
      if (bt) await bigWin(sp.win, { fast: true, onCount: () => setWin(run.x * b, true, 500) });
      else { await setWin(run.x * b, false); smallTier(sp.win); }
      run.lvl = 0;
      if (sp.retrigger) {
        totalSpins += sp.retrigger; rib();
        for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) if (sp.final[c][r].s === 'S') els.get(sp.final[c][r].id)?.classList.add('tease');
        SFX.scatter(sp.scatters); SFX.fanfare(); SFX.slideWhistle(true, 0.2); FX.confetti(90); FX.shake(20, 600); FX.flash(120, '#FFE9A8', 0.6); pose('cheer', 1800);
        stamp(`+${sp.retrigger} SPINS`, 'retrig', 1500);
        await wait(1500); clearFx();
      }
      await wait(160);
    }
    const t = tierOf(res.win);
    SFX.fanfare(); SFX.cheer(t ? t.lvl : 2); SFX.clink(2); FX.confetti(90); FX.rain(40); FX.cannon(-1, 40); FX.cannon(1, 40); pose('cheer', 5000, { erupt: true }); say('bonusEnd');
    const amt = Math.round(res.win * b);
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
  $('betDn').addEventListener('click', () => { if (st.busy) return; st.betIdx = Math.max(0, st.betIdx - 1); SFX.click(); drawBet(); });
  $('betUp').addEventListener('click', () => { if (st.busy) return; st.betIdx = Math.min(BETS.length - 1, st.betIdx + 1); SFX.click(); drawBet(); });
  $('turbo').addEventListener('click', () => { st.turbo = !st.turbo; $('turbo').classList.toggle('on', st.turbo); SFX.click(); });
  $('auto').addEventListener('click', () => { SFX.init(); st.auto = !st.auto; $('auto').classList.toggle('on', st.auto); SFX.click(); if (st.auto && !st.busy) play('spin'); });
  $('snd').addEventListener('click', () => { SFX.init(); const on = SFX.toggle(); $('sndw').style.display = on ? '' : 'none'; $('snd').classList.toggle('on', !on); });
  $('pigeon').addEventListener('click', () => { SFX.init(); SFX.hic(); say('idle'); });
  stage.addEventListener('click', (e) => { if (e.target.closest('#tier')) st.tap++; });
  addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.repeat) { e.preventDefault(); if (ov.querySelector('.scrim')) { ov.querySelector('.scrim')._done?.('x'); return; } SFX.init(); st.tap++; st.busy ? (st.skip = true) : play('spin'); } });

  $('buy').addEventListener('click', async () => {
    if (st.busy) return; SFX.init(); SFX.click();
    const C = E.CFG, b = bet(), cE = b * C.buyCost.election, cL = b * C.buyCost.landslide;
    const v = await modal(`<div class="card"><h2 style="font-size:70px">Buy a bonus</h2>
      <div class="buygrid">
        <button class="buyopt" data-v="buy-election" ${avail() < cE ? 'disabled' : ''}><b>Recount</b><span>${C.spinsFor[3]} free spins. Wilds stick and double.</span><em>${fmt(cE)}</em><u>${money.live ? '' : 'VOTES'}</u></button>
        <button class="buyopt" data-v="buy-landslide" ${avail() < cL ? 'disabled' : ''}><b>Landslide</b><span>${C.spinsFor[4]} free spins. Starts with a wild planted.</span><em>${fmt(cL)}</em><u>${money.live ? '' : 'VOTES'}</u></button>
      </div><button class="btn alt" data-v="x">Not now</button></div>`);
    if (v === 'buy-election' || v === 'buy-landslide') play(v);
  });

  $('info').addEventListener('click', async () => {
    if (st.busy) return; SFX.init(); SFX.click();
    const C = E.CFG, P = C.pay, f = (n) => (n >= 100 ? Math.round(n) : n >= 10 ? n.toFixed(1).replace(/\.0$/, '') : n.toFixed(2).replace(/0$/, ''));
    const rows = ['seal', 'phn', 'cap', 'meg', 'yrd', 'bal', 'stk', 'pen'].map((s) => `<div><img src="assets/img/${s}.webp" alt=""><span>${NAMES[s]}<small>5: ${f(P[s][0])}x<br>10+: ${f(P[s][5])}x<br>20+: ${f(P[s][8])}x</small></span></div>`).join('');
    const tiers = E.TIERS.slice().reverse().filter((t) => t[1] !== 'nice' && t[1] !== 'tasty').map(([x, k], i, a) => `${TIER_LABEL[k]} ${x}x${i === a.length - 1 ? '+' : ''}`).join(', ');
    await modal(`<div class="card" style="width:960px;padding:36px 40px 40px"><h2 style="font-size:64px">How it plays</h2>
      <p style="margin-top:10px;font-size:26px">Match 5 or more of the same symbol touching up, down, left or right. Winners vanish and new symbols tumble in until nothing pays.</p>
      <div class="pay">${rows}</div>
      <p style="font-size:24px"><b>Dump &amp; Count box</b> is wild: it stands in for any symbol and carries a multiplier. Multipliers in one cluster add together.</p>
      <p style="font-size:24px"><b>VP coin</b>: 3 trigger the Recount (${C.spinsFor[3]} free spins). 4+ trigger the Landslide (${C.spinsFor[4]}+ spins, a wild planted). In free spins wilds stick and double each time they win.</p>
      <p style="font-size:24px">Big wins: ${tiers}. Max win ${fx(E.MAX_WIN_X)}x. ${window.BENDER_FOOTER || ''}</p>
      <button class="btn" data-v="x" style="margin-top:20px">Close</button></div>`);
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
      toParent({ type: 'spin', reqId: id, bet: b, mode: money.mode, buy: mode === 'spin' ? null : mode });
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
    if (typeof w.ledgerNet === 'number') money.wallet.ledgerNet = w.ledgerNet;
    if (typeof w.ledgerLimit === 'number') money.wallet.ledgerLimit = w.ledgerLimit;
    if (money.live && !st.busy) setBal(walletBal(), false);
  }
  function modeUi() {
    const bar = $('modebar'); if (!bar) return;
    bar.dataset.state = money.live ? money.mode : 'practice';
    bar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', money.live && b.dataset.m === money.mode));
    $('modenote').textContent = !money.live ? 'Practice (no wallet)' : money.mode === 'ledger' ? 'Ledger $ is a friendly tally. Settle up yourselves.' : 'Play $ is pretend money.';
    $('balM').querySelector('.lbl').innerHTML = '&#9733; ' + (!money.live ? 'VOTES' : money.mode === 'ledger' ? 'LEDGER $' : 'PLAY $');
    $('fine').textContent = $('dis').textContent = !money.live ? 'Practice (no wallet). Free play only.' : (window.BENDER_FOOTER || 'No deposits, no payouts. Ledger $ is a friendly tally.');
  }
  function setBets(list) {
    BETS.length = 0; list.forEach((x) => BETS.push(x));
    st.betIdx = Math.min(BETS.length - 1, Math.max(0, BETS.indexOf(100) >= 0 ? BETS.indexOf(100) : 3));
  }
  function goLive(m) {
    if (!money.live) { money.live = true; fmt = dollars; setBets(Array.isArray(m.bets) && m.bets.length ? m.bets : DEFAULT_BETS.concat([2500])); }
    if (m.mode === 'play' || m.mode === 'ledger') money.mode = m.mode;
    applyWallet(m.wallet || m.balances); modeUi(); if (!st.busy) setBal(walletBal(), false); drawBet();
  }
  function goPractice(msg) {
    money.live = false; fmt = fx; pend.clear(); setBets(DEFAULT_BETS); st.betIdx = 3; st.bal = st.balShown = 50000;
    modeUi(); setBal(50000, false); drawBet(); if (msg) toast(msg, 2600);
  }
  function initBridge() {
    const bar = document.createElement('div'); bar.id = 'modebar';
    bar.innerHTML = '<div class="mb"><button data-m="play">Play $</button><button data-m="ledger">Ledger $</button></div><span id="modenote"></span>';
    $('stage').appendChild(bar);
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || !money.live || st.busy) return;
      money.mode = b.dataset.m; SFX.click(); setBal(walletBal(), false); modeUi(); toParent({ type: 'mode', mode: money.mode });
    });
    modeUi();
    if (!BRIDGE) return;
    addEventListener('message', (ev) => {
      if (ev.source !== window.parent) return; const m = ev.data || {};
      if (m.type === 'init') goLive(m); else if (m.type === 'wallet') { if (money.live) applyWallet(m.wallet || m); else goLive(m); }
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
    initBridge();
    say('idle');
    fillIdle((seed ^ 0x9e3779b9) >>> 0);
    const start = () => { SFX.init(); $('splash').classList.add('out'); SFX.music('base'); setTimeout(() => $('splash').remove(), 600); };
    if (Q.has('nosplash')) { $('splash').remove(); } else $('go').addEventListener('click', start);
    if (Q.get('buy')) setTimeout(() => play(Q.get('buy') === 'landslide' ? 'buy-landslide' : 'buy-election'), 400);
    document.addEventListener('pointerdown', () => SFX.init(), { once: true });
  }
  window.BENDER = { st, engine, play, get last() { return st.last; }, seed, bigWin, smallTier, stamp, pose, say, spill, bonusOn, bonusOff };
  boot();
})();
