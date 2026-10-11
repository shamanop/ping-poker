/* DINO FX: canvas particles, shake/flash, count-ups, big-win / free-spin overlays. Plain script, no deps. window.DinoFX.
   Stage-relative CSS px everywhere. Styles are injected by init(); no fx.css needed. */
(function () {
  'use strict';
  var SND = window.DinoAudio || null;
  var reduce = false;
  try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var rnd = function (a, b) { return a + Math.random() * (b - a); };
  var STALE = 0.75;
  var FONT = "'Arial Black', Impact, 'Helvetica Neue', system-ui, sans-serif";

  // Overlay timings in ms. The real values live in timing.js (window.DINO_FX_T, each cited against TIMING.md); these are only fallbacks.
  var T = {
    bigHold: 1200, bigClose: 300, skipGuard: 160,
    bombFly: 650, bombPunch: 225,
    retrigger: 1200, fade: 260, cardIn: 500
  };
  if (window.DINO_FX_T) for (var tk in window.DINO_FX_T) T[tk] = window.DINO_FX_T[tk];
  var TIERS = ['big', 'huge', 'mega', 'epic'];
  var TIER_RANK = ['nice', 'great', 'big', 'huge', 'mega', 'epic'];
  var TIER_STYLE = {
    nice: ['NICE WIN', '#BFF3FF'], great: ['GREAT WIN', '#9CFFD0'],
    big: ['BIG WIN', '#FFD23F'], huge: ['HUGE WIN', '#FF9F3A'], mega: ['MEGA WIN', '#FF5FA8'], epic: ['EPIC WIN', '#B79CFF']
  };

  var CSS = [
    '.dfx-cv{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;opacity:0;will-change:transform}',
    '.dfx-cv.back{z-index:10}.dfx-cv.front{z-index:30}',
    '.dfx-ov{position:absolute;inset:0;z-index:20;pointer-events:none;overflow:hidden;font-family:' + FONT + ';--u:4px}',
    '.dfx-flash{position:absolute;inset:0;opacity:0;pointer-events:none;z-index:40}',
    '.dfx-panel{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:calc(var(--u)*2);text-align:center;color:#fff;' +
      'background:radial-gradient(ellipse at 50% 45%,rgba(14,70,84,.88) 0%,rgba(5,20,38,.93) 70%);pointer-events:auto;touch-action:manipulation;-webkit-tap-highlight-color:transparent;user-select:none;padding:0 4%;box-sizing:border-box}',
    '.dfx-panel.light{background:radial-gradient(ellipse at 50% 50%,rgba(14,70,84,.55) 0%,rgba(5,20,38,.2) 75%);pointer-events:none}',
    '.dfx-tier{font-size:calc(var(--u)*14);line-height:1;letter-spacing:.02em;font-weight:900;text-shadow:0 calc(var(--u)*.5) 0 rgba(0,0,0,.55),0 0 calc(var(--u)*4) currentColor;white-space:nowrap;will-change:transform}',
    '.dfx-amt{font-size:calc(var(--u)*11);line-height:1.05;font-weight:900;color:#fff;font-variant-numeric:tabular-nums;white-space:nowrap;text-shadow:0 calc(var(--u)*.5) 0 rgba(0,0,0,.6),0 0 calc(var(--u)*3) rgba(255,210,63,.55);max-width:96%}',
    '.dfx-hint{font-size:calc(var(--u)*2.8);letter-spacing:.14em;color:rgba(255,255,255,.62);font-weight:700;min-height:1.2em}',
    '.dfx-big{font-size:calc(var(--u)*30);line-height:.95;font-weight:900;color:#FFD23F;text-shadow:0 calc(var(--u)*.8) 0 rgba(0,0,0,.55),0 0 calc(var(--u)*5) rgba(255,210,63,.6)}',
    '.dfx-lbl{font-size:calc(var(--u)*9);line-height:1;font-weight:900;letter-spacing:.04em;text-shadow:0 calc(var(--u)*.5) 0 rgba(0,0,0,.55)}',
    '.dfx-btn{font:inherit;font-weight:900;font-size:calc(var(--u)*5);letter-spacing:.08em;color:#13202e;background:linear-gradient(#FFE27A,#F5B31B);border:calc(var(--u)*.5) solid #5A3A00;border-radius:calc(var(--u)*2);padding:calc(var(--u)*2.4) calc(var(--u)*9);cursor:pointer;box-shadow:0 calc(var(--u)*.9) 0 #7A5200,0 0 calc(var(--u)*4) rgba(255,210,63,.45);margin-top:calc(var(--u)*2)}',
    '.dfx-btn:active{transform:translateY(calc(var(--u)*.6))}',
    '.dfx-banner{position:absolute;left:0;right:0;top:34%;display:flex;justify-content:center;pointer-events:none}',
    '.dfx-banner span{font-size:calc(var(--u)*11);font-weight:900;color:#FFD23F;white-space:nowrap;padding:calc(var(--u)*1.6) calc(var(--u)*5);border-radius:calc(var(--u)*3);background:rgba(5,20,38,.86);border:calc(var(--u)*.5) solid #FFD23F;text-shadow:0 calc(var(--u)*.5) 0 rgba(0,0,0,.6),0 0 calc(var(--u)*3) rgba(255,210,63,.6)}',
    '.dfx-fly{position:absolute;left:0;top:0;z-index:25;pointer-events:none;font-family:' + FONT + ';font-weight:900;color:#fff;white-space:nowrap;padding:.1em .45em;border-radius:99px;background:radial-gradient(circle at 35% 30%,#fff7c2,#FFC21A 55%,#B36B00);color:#2A1A00;box-shadow:0 0 18px 6px rgba(255,210,63,.75);will-change:transform}'
  ].join('\n');

  var stage = null, ov = null, ro = null, dpr = 1, W = 0, H = 0, flashEl = null;
  var layers = {}, cleanups = [], shakeAnim = null;

  function injectCss() {
    if (document.getElementById('dfx-css')) return;
    var s = document.createElement('style'); s.id = 'dfx-css'; s.textContent = CSS; document.head.appendChild(s);
  }

  function star(g, r) {
    g.beginPath();
    for (var i = 0; i < 8; i++) { var a = -Math.PI / 2 + i * Math.PI / 4, rr = i % 2 ? r * 0.3 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    g.closePath(); g.fill();
  }

  function makeLayer(cls) {
    var cv = document.createElement('canvas'); cv.className = 'dfx-cv ' + cls;
    var g = cv.getContext('2d'), ps = [], raf = 0, last = 0;
    function wipe() { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); cv.style.opacity = '0'; }
    function clear() { if (raf) cancelAnimationFrame(raf); raf = 0; ps = []; wipe(); }
    function frame(now) {
      var real = Math.max(0, (now - last) / 1000); last = now;
      if (real > STALE) { clear(); return; }
      try {
        var dt = Math.min(real, 0.2), n = Math.max(1, Math.ceil(dt / 0.05)), h = dt / n;
        g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); g.setTransform(dpr, 0, 0, dpr, 0, 0);
        ps = ps.filter(function (p) { p.life -= real; return p.life > 0 && p.y < H + 200; });
        for (var i = 0; i < ps.length; i++) {
          var p = ps[i];
          if (p.shape === 'ring') {
            var t = Math.min(1, Math.max(0, 1 - p.life / p.dur));
            g.save(); g.globalAlpha = Math.max(0, 1 - t); g.strokeStyle = p.c; g.lineWidth = p.w * (1 - t) + 1.5;
            g.beginPath(); g.arc(p.x, p.y, p.r0 + (p.r1 - p.r0) * (1 - Math.pow(1 - t, 3)), 0, 7); g.stroke(); g.restore(); continue;
          }
          if (p.shape === 'bubble') {
            var tb = Math.min(1, Math.max(0, 1 - p.life / p.dur)), rb = p.r0 + (p.r1 - p.r0) * Math.sin(tb * 1.4), ab = Math.max(0, 1 - tb * tb);
            var gr = g.createRadialGradient(p.x - rb * 0.3, p.y - rb * 0.35, rb * 0.1, p.x, p.y, rb);
            gr.addColorStop(0, 'rgba(255,255,255,' + (0.5 * ab) + ')'); gr.addColorStop(0.7, 'rgba(190,230,255,' + (0.16 * ab) + ')'); gr.addColorStop(1, 'rgba(255,255,255,' + (0.55 * ab) + ')');
            g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, rb, 0, 7); g.fill(); continue;
          }
          for (var k = 0; k < n; k++) { p.vy += p.g * h; p.vx *= 1 - p.drag * h; p.vy *= 1 - p.drag * h * 0.5; p.x += p.vx * h; p.y += p.vy * h; p.rot += p.vr * h; }
          g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
          g.globalAlpha = Math.min(1, p.life / 0.3); g.fillStyle = p.c;
          if (p.shape === 'star') star(g, p.size);
          else if (p.shape === 'shard') { g.beginPath(); g.moveTo(0, -p.size); g.lineTo(p.size * 0.55, p.size * 0.7); g.lineTo(-p.size * 0.5, p.size * 0.5); g.closePath(); g.fill(); }
          else if (p.shape === 'coin') {
            var sc = Math.abs(Math.cos(p.rot * 1.3)) * 0.8 + 0.2; g.scale(sc, 1); g.beginPath(); g.arc(0, 0, p.size, 0, 7); g.fill();
            g.lineWidth = Math.max(1.5, p.size * 0.16); g.strokeStyle = '#5A3A00'; g.stroke(); g.fillStyle = '#E09A10'; g.beginPath(); g.arc(0, 0, p.size * 0.55, 0, 7); g.fill();
          } else { var sc2 = Math.abs(Math.cos(p.rot * 1.7)); g.fillRect(-p.size / 2, -p.size * sc2 / 2, p.size, p.size * sc2 * 0.8 + 1.5); }
          g.restore();
        }
      } catch (e) { console.error('dinofx frame', e); ps = []; }
      if (ps.length) raf = requestAnimationFrame(frame); else { raf = 0; wipe(); }
    }
    return {
      cv: cv, clear: clear, resize: function () { cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr)); },
      add: function (p) {
        if (reduce) return;
        if (raf && performance.now() - last > STALE * 1000) clear();
        cv.style.opacity = '1'; ps.push(p); if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
      }
    };
  }

  function P(o) { var p = { x: 0, y: 0, vx: 0, vy: 0, g: 900, drag: 0.6, rot: 0, vr: 0, size: 5, life: 0.6, c: '#fff', shape: 'confetti' }; for (var k in o) p[k] = o[k]; return p; }

  function resize() {
    if (!stage) return;
    dpr = Math.min(1.5, window.devicePixelRatio || 1);   // particles are soft shapes: 1.5x keeps them crisp and the canvas upload small on 3x phones
    W = stage.clientWidth || 1; H = stage.clientHeight || 1;
    layers.back.resize(); layers.front.resize();
    ov.style.setProperty('--u', (Math.min(W, H * 0.62) / 100).toFixed(3) + 'px');
  }

  function init(stageEl) {
    if (stage) { clear(); if (ro) ro.disconnect(); [layers.back && layers.back.cv, layers.front && layers.front.cv, ov, flashEl].forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); }); }
    stage = stageEl; injectCss();
    if (getComputedStyle(stage).position === 'static') stage.style.position = 'relative';
    layers.back = makeLayer('back'); layers.front = makeLayer('front');
    ov = document.createElement('div'); ov.className = 'dfx-ov';
    flashEl = document.createElement('div'); flashEl.className = 'dfx-flash';
    stage.appendChild(layers.back.cv); stage.appendChild(ov); stage.appendChild(layers.front.cv); stage.appendChild(flashEl);
    resize();
    if (window.ResizeObserver) { ro = new ResizeObserver(resize); ro.observe(stage); } else window.addEventListener('resize', resize);
    return api;
  }

  // ---------- particles ----------
  function burst(x, y, color, n) {
    if (reduce || !stage) return;
    n = n || 14; color = color || '#FFD23F';
    for (var i = 0; i < n; i++) {
      var a = rnd(0, 6.283), v = rnd(140, 420);
      layers.front.add(P({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, g: 700, drag: 1.6, rot: rnd(0, 6), vr: rnd(-10, 10), size: rnd(4, 9), life: rnd(0.35, 0.6), c: i % 3 ? color : '#FFFFFF', shape: 'shard' }));
    }
    for (var j = 0; j < Math.ceil(n / 2); j++) {
      var b = rnd(0, 6.283), w = rnd(60, 260);
      layers.front.add(P({ x: x, y: y, vx: Math.cos(b) * w, vy: Math.sin(b) * w, g: 120, drag: 2, rot: rnd(0, 6), vr: rnd(-4, 4), size: rnd(4, 8), life: rnd(0.4, 0.6), c: j % 2 ? '#FFF4C2' : color, shape: 'star' }));
    }
    layers.front.add(P({ x: x, y: y, shape: 'ring', c: color, w: 5, r0: 4, r1: 38, life: 0.4, dur: 0.4 }));
  }

  // Pop burst (_dino/qa-motion/motion-measure.md "pop"): a bubble ring swells, then frosty shards drop with gravity (no radial star blast). sz = cell height in px.
  function popBurst(x, y, color, sz) {
    if (reduce || !stage) return;
    sz = sz || 60; color = color || '#FFD23F';
    var f = T.popShards || {};
    layers.front.add(P({ x: x, y: y, shape: 'bubble', r0: sz * 0.44, r1: sz * 0.6, life: (f.ring || 0.22) + 0.06, dur: (f.ring || 0.22) + 0.06 }));
    layers.front.add(P({ x: x, y: y, shape: 'ring', c: '#FFFFFF', w: 3, r0: sz * 0.28, r1: sz * 0.62, life: (f.ring || 0.22), dur: (f.ring || 0.22) }));
    var n = f.n || 7;
    for (var i = 0; i < n; i++) {
      var a = -Math.PI / 2 + rnd(-1.5, 1.5), v = rnd(sz * 0.5, sz * 2.2);
      layers.front.add(P({ x: x + rnd(-sz * 0.22, sz * 0.22), y: y + rnd(-sz * 0.2, sz * 0.2), vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6, g: sz * (f.g || 26), drag: 1.1, rot: rnd(0, 6), vr: rnd(-9, 9), size: rnd(sz * 0.05, sz * 0.12), life: rnd(0.3, 0.52), c: i % 2 ? '#FFFFFF' : color, shape: 'shard' }));
    }
  }

  var CONF = ['#FFD23F', '#FFFFFF', '#2FD6C0', '#FF5FA8', '#6EC1F5', '#B79CFF'];
  function confetti(level) {
    if (reduce || !stage) return;
    level = Math.max(1, Math.min(3, level | 0 || 1));
    var n = [0, 50, 110, 200][level];
    for (var i = 0; i < n; i++) {
      layers.back.add(P({ x: rnd(0, W), y: rnd(-H * 0.25, -10), vx: rnd(-60, 60), vy: rnd(40, 220), g: rnd(260, 420), drag: 0.9, rot: rnd(0, 6), vr: rnd(-8, 8), size: rnd(6, 12), life: rnd(2.2, 4), c: CONF[i % CONF.length], shape: 'confetti' }));
    }
  }

  function coinShower(k) {
    if (reduce || !stage) return;
    for (var i = 0; i < k; i++) {
      layers.back.add(P({ x: rnd(0, W), y: rnd(-60, -10), vx: rnd(-40, 40), vy: rnd(100, 280), g: rnd(500, 800), drag: 0.3, rot: rnd(0, 6), vr: rnd(-9, 9), size: rnd(8, 14), life: rnd(2, 3.2), c: '#FFD23F', shape: 'coin' }));
    }
  }

  function shake(ms, amp) {
    if (reduce || !stage) return;
    ms = ms || 400; amp = amp == null ? 8 : amp;
    if (shakeAnim) { try { shakeAnim.cancel(); } catch (e) {} }
    var kf = [], steps = Math.max(4, Math.round(ms / 40));
    for (var i = 0; i <= steps; i++) { var d = 1 - i / steps; kf.push({ translate: (i === steps ? 0 : rnd(-amp, amp) * d) + 'px ' + (i === steps ? 0 : rnd(-amp, amp) * d) + 'px' }); }
    try { shakeAnim = stage.animate(kf, { duration: ms, easing: 'linear' }); shakeAnim.onfinish = function () { shakeAnim = null; }; } catch (e) {}
  }

  function flash(color, ms) {
    if (reduce || !flashEl) return;
    ms = ms || 300;
    flashEl.style.background = color || '#FFFFFF';
    try { flashEl.animate([{ opacity: 0.75 }, { opacity: 0 }], { duration: ms, easing: 'ease-out' }); } catch (e) {}
  }

  function punch(el, scale, ms) {
    if (reduce || !el || !el.animate) return;
    try { el.animate([{ scale: 1 }, { scale: scale || 1.25 }, { scale: 1 }], { duration: ms || 260, easing: 'cubic-bezier(.2,.9,.3,1.3)' }); } catch (e) {}
  }

  // ---------- count-up ----------
  function defFmt(n) { return String(Math.round(n)); }
  function countUp(el, from, to, ms, fmt) {
    fmt = fmt || defFmt; ms = ms == null ? 800 : ms;
    return new Promise(function (resolve) {
      var done = false, raf = 0, tm = 0, t0 = performance.now();
      function finish() { if (done) return; done = true; if (raf) cancelAnimationFrame(raf); clearTimeout(tm); el.textContent = fmt(to); resolve(); }
      function tick(now) {
        if (done) return;
        var t = Math.min(1, Math.max(0, (now - t0) / ms));
        if (t >= 1) return finish();
        var e = 1 - Math.pow(1 - t, 3);
        el.textContent = fmt(from + (to - from) * e);
        raf = requestAnimationFrame(tick);
      }
      if (ms <= 0 || from === to) return finish();
      el.textContent = fmt(from);
      raf = requestAnimationFrame(tick);
      tm = setTimeout(finish, ms + 120); // hidden tab: rAF does not run
    });
  }

  // ---------- overlays ----------
  function el(cls, text, tag) { var e = document.createElement(tag || 'div'); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function track(fn) { cleanups.push(fn); return function () { var i = cleanups.indexOf(fn); if (i >= 0) cleanups.splice(i, 1); }; }
  function fadeOut(node, ms, cb) {
    if (reduce || !node.animate) { cb(); return; }
    var a = node.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease-in', fill: 'forwards' });
    a.onfinish = cb; setTimeout(cb, ms + 80);
  }
  // shrink until the rendered text really fits (fit() estimates from glyph count; wide digits/currency on a phone can still overflow)
  function fitMeasured(node, maxFrac) {
    node.style.whiteSpace = 'nowrap';
    Promise.resolve().then(function () {   // runs after modal() has attached the panel
      if (!node.isConnected) return;
      var avail = Math.min(W, window.innerWidth || W) * maxFrac, size = parseFloat(getComputedStyle(node).fontSize) || 40, n = 0;
      var wide = function () { var cs = getComputedStyle(node); return node.scrollWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) > avail; };
      while (wide() && size > 14 && n++ < 30) { size *= 0.92; node.style.fontSize = size.toFixed(1) + 'px'; }
    });
  }
  function fit(node, text, maxFrac, ratio) {
    var base = parseFloat(getComputedStyle(node).fontSize) || 40, avail = W * maxFrac, need = String(text).length * ratio * base;
    if (need > avail) node.style.fontSize = Math.max(14, base * avail / need).toFixed(1) + 'px';
  }

  // opts (optional): { tiers: state.tiers [[x, name], ...], winX: round win in x bet, from: lowest banner tier }.
  // With opts the banner escalates when the (linear) count crosses the server's tier thresholds; without, it escalates evenly over the time.
  function bigWin(tier, toUnits, fmt, ms, opts) {
    fmt = fmt || defFmt; tier = TIER_STYLE[tier] ? tier : 'big';
    return new Promise(function (resolve) {
      if (!stage) return resolve();
      var short = tier === 'nice' || tier === 'great';
      var stages = short ? [tier] : TIERS.slice(0, TIERS.indexOf(tier) + 1), thr = null, winX = opts && opts.winX;
      if (!short && opts && opts.tiers && winX > 0) {
        var fromRank = TIER_RANK.indexOf(opts.from || 'big'), asc = opts.tiers.slice().sort(function (a, b) { return a[0] - b[0]; })
          .filter(function (t) { return TIER_STYLE[t[1]] && TIER_RANK.indexOf(t[1]) >= fromRank && t[0] <= winX; });
        if (asc.length) { stages = asc.map(function (t) { return t[1]; }); thr = asc.map(function (t) { return t[0]; }); }
      }
      var total = ms == null ? 3200 : ms;
      var panel = el('dfx-panel'), tierEl = el('dfx-tier', ''), amt = el('dfx-amt', fmt(0)), hint = el('dfx-hint', short ? '' : 'TAP TO SKIP');
      panel.appendChild(tierEl); panel.appendChild(amt); panel.appendChild(hint);
      ov.appendChild(panel);
      if (!short) cameo(panel);
      fit(amt, fmt(toUnits), 0.92, 0.72);
      var idx = -1, t0 = performance.now(), raf = 0, finishTm = 0, holdTm = 0, coinIv = 0, closed = false, finished = false, t00 = t0;

      function setStage(i, quiet) {
        if (i === idx) return; idx = i;
        var name = stages[i], st = TIER_STYLE[name];
        tierEl.textContent = st[0]; tierEl.style.color = st[1];
        fit(tierEl, st[0], 0.94, 0.8);
        if (!quiet) {
          SND && SND.bigWin(name);
          punch(tierEl, 1.35, 340);
          if (!reduce) { flash(st[1], 260); var lvl = Math.min(3, i + 1); confetti(short ? 1 : lvl); shake(260 + 80 * i, 3 + 2 * i); }
          if (!reduce) { burst(W / 2, H * 0.4, st[1], 20 + 8 * i); }
        }
      }
      function finishCount() {
        if (finished) return; finished = true;
        SND && SND.countEnd();
        cancelAnimationFrame(raf); clearTimeout(finishTm); clearInterval(coinIv);
        amt.textContent = fmt(toUnits);
        setStage(stages.length - 1);
        punch(amt, 1.12, 300);
        hint.textContent = short ? '' : 'TAP TO CLOSE';
        holdTm = setTimeout(close, T.bigHold);
      }
      function tick(now) {
        if (finished || closed) return;
        var t = Math.min(1, Math.max(0, (now - t0) / total));
        var si = Math.min(stages.length - 1, Math.floor(t * stages.length));
        if (thr) { si = 0; for (var q = 0; q < thr.length; q++) if (winX * t >= thr[q]) si = q; }
        setStage(si);
        if (t >= 1) return finishCount();
        amt.textContent = fmt(toUnits * t * 0.9999);
        raf = requestAnimationFrame(tick);
      }
      function close() {
        if (closed) return; closed = true;
        SND && SND.bigWinEnd();
        clearTimeout(holdTm); clearTimeout(finishTm); cancelAnimationFrame(raf); clearInterval(coinIv);
        document.removeEventListener('keydown', onKey, true); untrack();
        fadeOut(panel, T.bigClose, function () { if (panel.parentNode) panel.parentNode.removeChild(panel); resolve(); });
      }
      function act() {
        if (closed) return;
        if (performance.now() - t00 < T.skipGuard) return;
        if (!finished) finishCount(); else close();
      }
      function onKey(e) { if (e.code === 'Space' || e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); act(); } }
      var untrack = track(function () { closed = true; clearTimeout(holdTm); clearTimeout(finishTm); cancelAnimationFrame(raf); clearInterval(coinIv); document.removeEventListener('keydown', onKey, true); resolve(); });
      panel.addEventListener('pointerdown', function (e) { e.preventDefault(); act(); });
      document.addEventListener('keydown', onKey, true);
      SND && SND.countStart(total);
      setStage(0);
      if (!reduce) { coinShower(short ? 8 : 14); coinIv = setInterval(function () { coinShower(short ? 2 : 3 + stages.length * 2); }, 140); }
      amt.textContent = fmt(0);
      raf = requestAnimationFrame(tick);
      finishTm = setTimeout(finishCount, total + 150); // hidden tab fallback
    });
  }

  function bombFly(fromEl, toEl, text, ms) {
    return new Promise(function (resolve) {
      if (!stage || !fromEl || !toEl) return resolve();
      var sr = stage.getBoundingClientRect(), a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
      var scaleX = sr.width ? W / sr.width : 1, scaleY = sr.height ? H / sr.height : 1;
      var x0 = (a.left + a.width / 2 - sr.left) * scaleX, y0 = (a.top + a.height / 2 - sr.top) * scaleY;
      var x1 = (b.left + b.width / 2 - sr.left) * scaleX, y1 = (b.top + b.height / 2 - sr.top) * scaleY;
      var fly = el('dfx-fly', text); fly.style.fontSize = Math.max(16, Math.min(a.width, 64) * 0.42) + 'px';
      ov.appendChild(fly);
      var cx = (x0 + x1) / 2, cy = Math.min(y0, y1) - Math.max(40, Math.hypot(x1 - x0, y1 - y0) * 0.35);
      var dur = ms || T.bombFly, t0 = performance.now(), raf = 0, tm = 0, done = false, lastTrail = 0;
      function place(t) {
        var u = 1 - t, x = u * u * x0 + 2 * u * t * cx + t * t * x1, y = u * u * y0 + 2 * u * t * cy + t * t * y1;
        var s = 1 + 0.35 * Math.sin(Math.PI * t);
        fly.style.transform = 'translate(' + (x - fly.offsetWidth / 2).toFixed(1) + 'px,' + (y - fly.offsetHeight / 2).toFixed(1) + 'px) scale(' + s.toFixed(3) + ')';
        return [x, y];
      }
      function end() {
        if (done) return; done = true; cancelAnimationFrame(raf); clearTimeout(tm); untrack();
        if (fly.parentNode) fly.parentNode.removeChild(fly);
        burst(x1, y1, '#FFD23F', 12); punch(toEl, 1.28, T.bombPunch);
        resolve();
      }
      function tick(now) {
        if (done) return;
        var t = Math.min(1, Math.max(0, (now - t0) / dur)), e = t * t * (3 - 2 * t), pos = place(e);
        if (!reduce && now - lastTrail > 40) { lastTrail = now; layers.front.add(P({ x: pos[0], y: pos[1], vx: rnd(-30, 30), vy: rnd(-30, 30), g: 0, drag: 2, size: rnd(3, 6), life: 0.3, c: '#FFE680', shape: 'star' })); }
        if (t >= 1) return end();
        raf = requestAnimationFrame(tick);
      }
      var untrack = track(function () { done = true; cancelAnimationFrame(raf); clearTimeout(tm); if (fly.parentNode) fly.parentNode.removeChild(fly); resolve(); });
      place(0); raf = requestAnimationFrame(tick); tm = setTimeout(end, dur + 150);
    });
  }

  function modal(build, autoMs, blocking) {
    return new Promise(function (resolve) {
      if (!stage) return resolve();
      var panel = el('dfx-panel'), closed = false, tm = 0, t00 = performance.now();
      var btn = build(panel);
      ov.appendChild(panel);
      if (!reduce && panel.animate) { try { panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: T.cardIn, easing: 'ease-out' }); } catch (e) {} }
      function close() {
        if (closed) return; closed = true; clearTimeout(tm); document.removeEventListener('keydown', onKey, true); untrack();
        fadeOut(panel, T.fade, function () { if (panel.parentNode) panel.parentNode.removeChild(panel); resolve(); });
      }
      function onKey(e) { if (e.code === 'Space' || e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (performance.now() - t00 > T.skipGuard) close(); } }
      var untrack = track(function () { closed = true; clearTimeout(tm); document.removeEventListener('keydown', onKey, true); resolve(); });
      if (btn) btn.addEventListener('click', function (e) { e.preventDefault(); close(); });
      document.addEventListener('keydown', onKey, true);
      if (autoMs > 0) tm = setTimeout(close, autoMs);
    });
  }

  // autoMs: 0/undefined = wait for a click (the default); a number closes the card by itself after that long (autoplay).
  // the nanny (mascot.js) stands in #play, under the banner dim: show a copy of her current pose in front of the dim, at the same spot
  function cameo(panel) {
    try {
      var m = document.querySelector('#play .th-mascot'); if (!m || !stage) return;
      var r = m.getBoundingClientRect(), s = stage.getBoundingClientRect(); if (!r.width) return;
      var c = m.cloneNode(true); c.classList.add('dfx-cameo');
      c.style.cssText = 'position:absolute;left:' + (r.left - s.left) + 'px;top:' + (r.top - s.top) + 'px;width:' + r.width + 'px;height:' + r.height + 'px;right:auto;bottom:auto;z-index:-1';
      panel.style.isolation = 'isolate'; panel.insertBefore(c, panel.firstChild);
    } catch (e) {}
  }

  function fsIntro(spins, autoMs) {
    return modal(function (panel) {
      var n = el('dfx-big', String(spins)), l = el('dfx-lbl', 'FREE SPINS'), b = el('dfx-btn', 'START', 'button'); b.type = 'button';
      n.setAttribute('aria-label', spins + ' FREE SPINS');
      panel.appendChild(n); panel.appendChild(l); panel.appendChild(b);
      confetti(2); flash('#FFD23F', 300); burst(W / 2, H * 0.4, '#FFD23F', 26); punch(n, 1.3, 420);
      return b;
    }, autoMs || 0);
  }

  function retrigger(added) {
    return new Promise(function (resolve) {
      if (!stage) return resolve();
      var wrap = el('dfx-banner'), s = el('', '+' + added + ' FREE SPINS', 'span');
      wrap.appendChild(s); ov.appendChild(wrap);
      fit(s, '+' + added + ' FREE SPINS', 0.86, 0.8);
      punch(s, 1.3, 360); flash('#FFD23F', 240); burst(W / 2, H * 0.38, '#FFD23F', 18); confetti(1);
      var tm = 0, done = false;
      function end() { if (done) return; done = true; clearTimeout(tm); untrack(); fadeOut(wrap, 200, function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); resolve(); }); }
      var untrack = track(function () { done = true; clearTimeout(tm); if (wrap.parentNode) wrap.parentNode.removeChild(wrap); resolve(); });
      tm = setTimeout(end, T.retrigger);
    });
  }

  function fsOutro(totalText, autoMs) {
    return modal(function (panel) {
      var l = el('dfx-lbl', 'YOU WON'), a = el('dfx-big', totalText), b = el('dfx-btn', 'CONTINUE', 'button'); b.type = 'button';
      panel.appendChild(l); panel.appendChild(a); panel.appendChild(b);
      fit(a, totalText, 0.9, 0.72); fitMeasured(a, 0.9);
      confetti(3); flash('#FFFFFF', 260); burst(W / 2, H * 0.42, '#FFD23F', 30); punch(a, 1.2, 420);
      return b;
    }, autoMs || 0);
  }

  function clear() {
    var cs = cleanups.slice(); cleanups = [];
    cs.forEach(function (f) { try { f(); } catch (e) {} });
    if (layers.back) { layers.back.clear(); layers.front.clear(); }
    if (ov) while (ov.firstChild) ov.removeChild(ov.firstChild);
    if (shakeAnim) { try { shakeAnim.cancel(); } catch (e) {} shakeAnim = null; }
  }

  var api = { init: init, burst: burst, popBurst: popBurst, shake: shake, flash: flash, confetti: confetti, countUp: countUp, bigWin: bigWin, bombFly: bombFly, fsIntro: fsIntro, retrigger: retrigger, fsOutro: fsOutro, clear: clear, T: T };
  window.DinoFX = api;
})();
