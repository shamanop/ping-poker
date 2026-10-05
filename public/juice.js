// PingJuice: DOM/CSS/WebAudio win effects, toasts, stickers, widgets. No dependencies. See JUICE-API.md.
(function () {
  'use strict';
  var PJ = (window.PingJuice = window.PingJuice || {});

  // Asset base = directory of this script, so it works from any mount point.
  var BASE = (function () {
    var s = document.currentScript && document.currentScript.src;
    if (!s) { var all = document.getElementsByTagName('script'); for (var i = 0; i < all.length; i++) if (/juice\.js(\?|$)/.test(all[i].src)) s = all[i].src; }
    return s ? s.replace(/[^\/]*$/, '') : '/';
  })();

  PJ.config = { toastPos: 'tr', maxToasts: 3, stage: null, reduced: null };
  PJ.sfx = PJ.sfx || function () { return false; };

  var ART = {
    starburst: 'ping-starburst', chips: 'chip-confetti-burst', ballots: 'ballot-confetti-burst', rays: 'jackpot-rays',
    bomb: 'bomb-blast', coins: 'coin-shower', ring: 'shockwave-ring', glitter: 'spark-glitter-puff'
  };
  var STICKERS = ['vp-charm', 'vp-horseshoe', 'i-pinged', 'ballot-cherry', 'vp-chip', 'ping-hand', 'boba-crown', 'skull-ace'];
  var CHIPS = ['chip-1', 'chip-5', 'chip-25', 'chip-100', 'chip-500'];
  PJ.stickerNames = STICKERS.slice();
  PJ.burstNames = Object.keys(ART);

  function artUrl(name) {
    if (STICKERS.indexOf(name) >= 0) name = 'sticker-' + name;
    name = ART[name] || name;
    return BASE + 'images/fx2/' + name + '.png';
  }
  function stickerUrl(name) { return BASE + 'images/fx2/' + (/^sticker-/.test(name) ? name : 'sticker-' + name) + '.png'; }
  function chipUrl(n) { return BASE + 'images/' + n + '.png'; }

  var cache = {};
  PJ.preload = function () {
    var urls = Object.keys(ART).map(artUrl).concat(STICKERS.map(stickerUrl), CHIPS.map(chipUrl));
    urls.forEach(function (u) { if (!cache[u]) { var im = new Image(); im.decoding = 'async'; im.src = u; cache[u] = im; } });
  };
  if ('requestIdleCallback' in window) requestIdleCallback(PJ.preload); else setTimeout(PJ.preload, 1200);

  // ---- helpers ----
  function reduced() {
    if (PJ.config.reduced !== null) return !!PJ.config.reduced;
    return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function T(x, y, s, r) { return 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(-50%,-50%) rotate(' + (r || 0).toFixed(1) + 'deg) scale(' + (s == null ? 1 : s).toFixed(3) + ')'; }
  function money(v, signed) {
    if (window.Money && typeof Money.fmt === 'function') return Money.fmt(v, signed ? { signed: true } : undefined);
    return (signed && v > 0 ? '+' : '') + Math.round(v).toLocaleString();
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var layers = {};
  function layer(front) {
    var k = front ? 'f' : 'b';
    if (layers[k] && layers[k].isConnected) return layers[k];
    var d = document.createElement('div');
    d.className = 'pj-layer' + (front ? ' pj-front' : '');
    d.setAttribute('aria-hidden', 'true');
    document.body.appendChild(d);
    return (layers[k] = d);
  }

  function stageEl() {
    var c = PJ.config.stage;
    if (typeof c === 'string') c = document.querySelector(c);
    return c || document.getElementById('stage') || document.querySelector('.sh-stage') || document.getElementById('game-screen') || document.body;
  }
  function center(el) {
    if (el && el.getBoundingClientRect) { var r = el.getBoundingClientRect(); if (r.width || r.height) return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }
    var s = stageEl().getBoundingClientRect();
    if (!s.width) return { x: innerWidth / 2, y: innerHeight / 2, w: innerWidth, h: innerHeight };
    return { x: s.left + s.width / 2, y: s.top + s.height / 2, w: s.width, h: s.height };
  }

  function run(el, frames, opts, done) {
    var a, fin = false;
    function end() { if (fin) return; fin = true; el.remove(); if (done) done(); }
    try { a = el.animate(frames, opts); a.onfinish = end; a.oncancel = end; }
    catch (e) { setTimeout(end, opts.duration + (opts.delay || 0)); }
    return a;
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function sprite(src, x, y, size, front) {
    var el = document.createElement('img');
    el.className = 'pj-fx'; el.alt = ''; el.draggable = false; el.src = src;
    el.style.width = size + 'px';
    el.style.transform = T(x, y, 1, 0);
    layer(front).appendChild(el);
    return el;
  }
  function textEl(cls, text, x, y) {
    var el = document.createElement('div');
    el.className = cls; el.textContent = text;
    el.style.transform = T(x, y, 1, 0);
    layer(true).appendChild(el);
    return el;
  }

  // ---- 1. burst / shockwave / shake ----
  PJ.burst = function (name, x, y, o) {
    o = o || {};
    var size = o.size || 280, ms = o.ms || 900, delay = o.delay || 0;
    var el = sprite(artUrl(name), x, y, size, o.front);
    var done = new Promise(function (res) {
      if (reduced()) { run(el, [{ opacity: 0, transform: T(x, y, 1) }, { opacity: 1, transform: T(x, y, 1), offset: 0.3 }, { opacity: 0, transform: T(x, y, 1) }], { duration: ms * 0.7, delay: delay, fill: 'both' }, res); return; }
      var r = o.rotate === false ? 0 : rnd(-9, 9), r0 = r - rnd(8, 18);
      run(el, [
        { opacity: 0, transform: T(x, y, 0.12, r0) },
        { opacity: 1, transform: T(x, y, 1.14, r), offset: 0.2 },
        { opacity: 1, transform: T(x, y, 1.0, r + 1.5), offset: o.hold || 0.55 },
        { opacity: 0, transform: T(x, y - size * 0.03, 1.06, r + 3) }
      ], { duration: ms, delay: delay, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'both' }, res);
    });
    return done;
  };

  PJ.shockwave = function (x, y, o) {
    o = o || {};
    var size = o.size || 380, ms = o.ms || 650;
    var el = sprite(artUrl('ring'), x, y, size, o.front);
    if (reduced()) { el.remove(); return Promise.resolve(); }
    return new Promise(function (res) {
      run(el, [
        { opacity: 0.95, transform: T(x, y, 0.12) },
        { opacity: 0.8, transform: T(x, y, 0.7), offset: 0.4 },
        { opacity: 0, transform: T(x, y, 1.35) }
      ], { duration: ms, delay: o.delay || 0, easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'both' }, res);
    });
  };

  PJ.screenShake = function (intensity, ms) {
    if (reduced()) return Promise.resolve();
    intensity = intensity == null ? 1 : intensity; ms = ms || 400;
    var el = stageEl(), n = Math.max(6, Math.round(ms / 36)), frames = [], i;
    for (i = 0; i < n; i++) {
      var k = 1 - i / n, a = 9 * intensity * k;
      frames.push({ translate: rnd(-a, a).toFixed(1) + 'px ' + rnd(-a, a).toFixed(1) + 'px' });
    }
    frames.push({ translate: '0px 0px' });
    return new Promise(function (res) {
      try { var an = el.animate(frames, { duration: ms, easing: 'linear' }); an.onfinish = res; an.oncancel = res; } catch (e) { res(); }
    });
  };

  // ---- 2. count-up / win celebration ----
  PJ.countUp = function (el, from, to, ms, o) {
    o = o || {};
    ms = ms == null ? 1000 : ms;
    var fmt = o.format || function (v) { return money(v, o.signed); };
    return new Promise(function (res) {
      if (!el) return res();
      if (reduced() || ms <= 0) { el.textContent = fmt(to); return res(); }
      var t0 = performance.now(), lastTick = 0, lastTxt = '';
      (function step(t) {
        var p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 3);
        var v = from + (to - from) * e;
        var txt = fmt(Math.round(v));
        if (txt !== lastTxt) { el.textContent = txt; if (p < 1 && t - lastTick > 55) { lastTick = t; if (o.tick !== false) PJ.sfx('coinTick'); } lastTxt = txt; }
        if (p < 1) requestAnimationFrame(step); else { el.textContent = fmt(to); res(); }
      })(t0);
    });
  };

  function chipRain(n, ms, front) {
    var w = innerWidth, h = innerHeight, rm = reduced();
    if (rm) return;
    for (var i = 0; i < n; i++) (function () {
      var src = chipUrl(CHIPS[Math.floor(Math.random() * CHIPS.length)]);
      var el = document.createElement('img'); el.className = 'pj-chip'; el.alt = ''; el.src = src;
      var sz = rnd(26, 44); el.style.width = el.style.height = sz + 'px';
      el.style.transform = T(-100, -100, 1, 0);
      layer(front).appendChild(el);
      var x = rnd(20, w - 20), drift = rnd(-60, 60), spin = rnd(360, 900) * (Math.random() < 0.5 ? -1 : 1), dur = rnd(1100, 1700);
      var f = [
        { opacity: 1, transform: 'translate(' + x + 'px,-60px) translate(-50%,-50%) perspective(300px) rotateX(0deg) rotate(0deg)' },
        { opacity: 1, transform: 'translate(' + (x + drift) + 'px,' + (h + 60) + 'px) translate(-50%,-50%) perspective(300px) rotateX(' + spin + 'deg) rotate(' + spin / 4 + 'deg)' }
      ];
      run(el, f, { duration: dur, delay: rnd(0, ms), easing: 'cubic-bezier(.45,.05,.9,.6)', fill: 'both' });
    })();
  }

  function coinStrip(x, delay, ms, width) {
    var el = sprite(artUrl('coins'), x, -width, width, true);
    if (reduced()) { el.remove(); return; }
    var y0 = -width * 0.55, y1 = innerHeight + width * 0.55;
    run(el, [
      { opacity: 0, transform: T(x, y0, 1) },
      { opacity: 1, transform: T(x, y0 + (y1 - y0) * 0.12, 1), offset: 0.12 },
      { opacity: 1, transform: T(x, y0 + (y1 - y0) * 0.85, 1), offset: 0.85 },
      { opacity: 0, transform: T(x, y1, 1) }
    ], { duration: ms, delay: delay, easing: 'linear', fill: 'both' });
  }

  var TIERS = {
    nice: { label: '', count: 800, hold: 1300 },
    big: { label: 'BIG WIN', count: 1000, hold: 1700 },
    mega: { label: 'MEGA WIN', count: 1400, hold: 2200 },
    jackpot: { label: 'JACKPOT', count: 2300, hold: 3400 }
  };

  PJ.winCelebration = function (tier, anchorEl, amountText) {
    tier = TIERS[tier] ? tier : 'nice';
    var cfg = TIERS[tier], c = center(anchorEl), x = c.x, y = c.y, rm = reduced();
    var numEl, labelEl, numY = y, total = cfg.count + cfg.hold;
    var amount = typeof amountText === 'number' ? amountText : null;
    var textStatic = amount === null ? (amountText == null ? '' : String(amountText)) : '';

    PJ.sfx(tier);
    if (tier === 'nice') {
      PJ.burst('glitter', x, y, { size: 300, ms: 1000 });
    } else if (tier === 'big') {
      PJ.shockwave(x, y, { size: 440 });
      PJ.burst('chips', x, y, { size: 480, ms: 1200 });
      chipRain(10, 500, true); PJ.screenShake(0.5, 360);
      PJ.sfx('chipShower');
    } else if (tier === 'mega') {
      PJ.shockwave(x, y, { size: 520 }); PJ.shockwave(x, y, { size: 760, delay: 180 });
      PJ.burst('starburst', x, y, { size: 600, ms: 1600, hold: 0.7 });
      PJ.burst('chips', x, y, { size: 680, ms: 1500, delay: 140, rotate: true });
      coinStrip(Math.max(180, x - 420), 200, 1700, 300); coinStrip(Math.min(innerWidth - 180, x + 420), 360, 1700, 300);
      chipRain(24, 900, true); PJ.screenShake(0.9, 520);
      PJ.sfx('chipShower');
    } else {
      // jackpot: opening smack, then rays + disc label, number below the disc, coin rain
      PJ.shockwave(x, y, { size: 700, front: true }); PJ.shockwave(x, y, { size: 1100, delay: 200, front: true });
      PJ.burst('starburst', x, y, { size: 760, ms: 1300 });
      var rays = sprite(artUrl('rays'), x, y, 1060, false);
      if (rm) { run(rays, [{ opacity: 0, transform: T(x, y, 1) }, { opacity: 1, transform: T(x, y, 1), offset: 0.15 }, { opacity: 1, transform: T(x, y, 1), offset: 0.85 }, { opacity: 0 }], { duration: total, fill: 'both' }); }
      else run(rays, [
        { opacity: 0, transform: T(x, y, 0.3, -20) },
        { opacity: 1, transform: T(x, y, 1, 0), offset: 0.12 },
        { opacity: 1, transform: T(x, y, 1.04, 40), offset: 0.86 },
        { opacity: 0, transform: T(x, y, 1.08, 52) }
      ], { duration: total + 600, delay: 450, easing: 'ease-out', fill: 'both' });
      var disc = textEl('pj-num pj-tier-nice', 'JACKPOT', x, y);
      disc.style.cssText += 'font-size:44px;color:#7a1f0c;text-shadow:0 2px 0 rgba(255,255,255,.55);letter-spacing:.06em;';
      run(disc, [{ opacity: 0, transform: T(x, y, 0.4) }, { opacity: 1, transform: T(x, y, 1.18), offset: 0.15 }, { opacity: 1, transform: T(x, y, 1), offset: 0.25 }, { opacity: 1, transform: T(x, y, 1), offset: 0.88 }, { opacity: 0, transform: T(x, y, 1) }], { duration: total + 600, delay: 700, fill: 'both' });
      numY = y + 215;
      coinStrip(x - 600, 0, 2400, 380); coinStrip(x - 330, 350, 2400, 300); coinStrip(x + 330, 520, 2400, 300); coinStrip(x + 600, 700, 2400, 380);
      chipRain(46, 2200, true);
      PJ.burst('ballots', x, y, { size: 960, ms: 1500, delay: 1000 });
      PJ.screenShake(1.2, 700); setTimeout(function () { PJ.screenShake(0.7, 500); }, 1300);
      PJ.sfx('chipShower'); setTimeout(function () { PJ.sfx('chipShower'); }, 1200);
    }

    if (amountText != null && amountText !== '') {
      var delay = tier === 'jackpot' ? 800 : tier === 'nice' ? 100 : 250;
      numEl = textEl('pj-num pj-tier-' + tier, amount !== null ? money(0, true) : textStatic, x, numY);
      var rise = tier === 'nice' ? 46 : 14;
      var f = rm ? [{ opacity: 0, transform: T(x, numY, 1) }, { opacity: 1, transform: T(x, numY, 1), offset: 0.1 }, { opacity: 1, transform: T(x, numY, 1), offset: 0.85 }, { opacity: 0, transform: T(x, numY, 1) }]
        : [{ opacity: 0, transform: T(x, numY + 20, 0.4) }, { opacity: 1, transform: T(x, numY, 1.22), offset: 0.1 }, { opacity: 1, transform: T(x, numY, 1), offset: 0.2 },
          { opacity: 1, transform: T(x, numY, 1), offset: 0.82 }, { opacity: 0, transform: T(x, numY - rise, 1.04) }];
      run(numEl, f, { duration: total, delay: delay, fill: 'both', easing: 'ease-out' });
      if (amount !== null) setTimeout(function () { PJ.countUp(numEl, 0, amount, cfg.count - 150, { signed: true }); }, delay);
    }
    if (cfg.label && tier !== 'jackpot') {
      var ly = numY + (tier === 'big' ? 66 : 84);
      labelEl = textEl('pj-tier-label', cfg.label, x, ly);
      run(labelEl, rm ? [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }]
        : [{ opacity: 0, transform: T(x, ly, 2.2, 6) }, { opacity: 1, transform: T(x, ly, 0.94, -2), offset: 0.14 }, { opacity: 1, transform: T(x, ly, 1, -2), offset: 0.2 },
          { opacity: 1, transform: T(x, ly, 1, -2), offset: 0.82 }, { opacity: 0, transform: T(x, ly - 10, 1, -2) }], { duration: total, delay: 150, fill: 'both', easing: 'ease-out' });
      if (!rm) setTimeout(function () { PJ.sfx('thud'); }, 270);
    }
    return wait(total + 700);
  };

  // ---- 3. chip shower ----
  PJ.chipShower = function (fromEl, toEl, n) {
    n = Math.max(1, Math.min(n == null ? 12 : n, 60));
    var a = center(fromEl), b = center(toEl), rm = reduced(), last = 0;
    var spread = 22;
    for (var i = 0; i < n; i++) (function (i) {
      var el = document.createElement('img'); el.className = 'pj-chip'; el.alt = ''; el.src = chipUrl(CHIPS[Math.floor(Math.random() * 4)]);
      var sz = rnd(26, 34); el.style.width = el.style.height = sz + 'px';
      layer(true).appendChild(el);
      var x0 = a.x + rnd(-spread, spread), y0 = a.y + rnd(-spread / 2, spread / 2);
      var x1 = b.x + rnd(-spread, spread), y1 = b.y - (i % 6) * 3 + rnd(-4, 4);
      var arc = Math.max(70, Math.hypot(x1 - x0, y1 - y0) * 0.35) * rnd(0.8, 1.2);
      var spin = rnd(180, 520) * (Math.random() < 0.5 ? -1 : 1);
      var frames = [], steps = rm ? 1 : 12, k;
      for (k = 0; k <= steps; k++) {
        var t = k / steps;
        frames.push({
          offset: t,
          opacity: k === 0 ? 0 : 1,
          transform: T(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t - 4 * arc * t * (1 - t), 1 + 0.18 * Math.sin(Math.PI * t), spin * t)
        });
      }
      var dly = i * 55 + rnd(0, 25), dur = rm ? 200 : rnd(520, 700);
      run(el, frames, { duration: dur, delay: dly, easing: 'cubic-bezier(.3,.1,.5,1)', fill: 'both' });
      var landAt = dly + dur;
      // chip rests briefly on the stack, then fades
      setTimeout(function () { PJ.sfx('chipClink', { minGap: 45 }); }, landAt);
      last = Math.max(last, landAt);
    })(i);
    return wait(last + 80);
  };

  // ---- 4. hand call-out ----
  PJ.calloutHand = function (name, anchorEl) {
    var c = center(anchorEl), x = c.x, y = c.y - 20, rm = reduced(), ms = 1700;
    PJ.sfx('ping');
    PJ.burst('starburst', x, y, { size: 400, ms: ms, hold: 0.8 });
    var py = y + 120;
    var el = document.createElement('div');
    el.className = 'pj-tier-label';
    el.style.cssText += 'font-size:46px;letter-spacing:.1em;padding:8px 26px 6px 30px;box-shadow:5px 5px 0 #000;';
    el.textContent = String(name).toUpperCase();
    el.style.transform = T(x, py, 1, -3);
    layer(true).appendChild(el);
    run(el, rm ? [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }]
      : [{ opacity: 0, transform: T(x, py, 2.4, 7) }, { opacity: 1, transform: T(x, py, 0.93, -3), offset: 0.15 }, { opacity: 1, transform: T(x, py, 1, -3), offset: 0.24 },
        { opacity: 1, transform: T(x, py, 1, -3), offset: 0.8 }, { opacity: 0, transform: T(x, py - 12, 1, -3) }], { duration: ms, delay: 120, fill: 'both', easing: 'ease-out' });
    if (!rm) { setTimeout(function () { PJ.sfx('thud'); }, 230); PJ.screenShake(0.35, 260); }
    return wait(ms + 150);
  };

  // ---- 5. toasts ----
  var toastQ = [], toastLive = 0, toastBox = null, toastPos = '';
  function toastHost() {
    if (toastBox && toastBox.isConnected && toastPos === PJ.config.toastPos) return toastBox;
    if (toastBox) toastBox.remove();
    toastPos = PJ.config.toastPos;
    toastBox = document.createElement('div');
    toastBox.className = 'pj-toasts pos-' + toastPos; toastBox.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastBox);
    return toastBox;
  }
  function pumpToasts() {
    while (toastLive < PJ.config.maxToasts && toastQ.length) showToast(toastQ.shift());
  }
  function showToast(t) {
    toastLive++;
    var el = document.createElement('div');
    el.className = 'pj-toast in' + (t.sticker ? '' : ' nosticker');
    var html = esc(t.text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    el.innerHTML = (t.sticker ? '<img alt="" src="' + stickerUrl(t.sticker) + '">' : '') + '<div class="pj-toast-t">' + html + '</div>';
    toastHost().appendChild(el);
    PJ.sfx('toast');
    setTimeout(function () {
      el.classList.remove('in'); el.classList.add('out');
      setTimeout(function () { el.remove(); toastLive--; pumpToasts(); }, reduced() ? 20 : 280);
    }, t.ms);
  }
  PJ.toast = function (text, o) {
    o = o || {};
    toastQ.push({ text: text, sticker: o.sticker || '', ms: o.ms || 3600 });
    if (toastQ.length > 8) toastQ.shift();
    pumpToasts();
  };

  // ---- 6. stickers and charm ----
  PJ.stickerPop = function (name, targetEl, o) {
    o = o || {};
    var c = center(targetEl), size = o.size || 92, hold = o.hold || 2600, rm = reduced();
    var x = c.x + (o.dx != null ? o.dx : rnd(-8, 8)), y = c.y + (o.dy != null ? o.dy : rnd(-6, 6)), r = o.rotate != null ? o.rotate : rnd(-16, 16);
    var el = document.createElement('img');
    el.className = 'pj-sticker'; el.alt = ''; el.src = stickerUrl(name); el.style.width = size + 'px';
    el.style.transform = T(x, y, 1, r);
    layer(true).appendChild(el);
    var total = 520 + hold + 350;
    var landT = 190 / total, settleT = 420 / total, holdT = (520 + hold) / total;
    run(el, rm ? [{ opacity: 0, transform: T(x, y, 1, r) }, { opacity: 1, transform: T(x, y, 1, r), offset: 0.05 }, { opacity: 1, transform: T(x, y, 1, r), offset: holdT }, { opacity: 0, transform: T(x, y, 1, r) }]
      : [{ opacity: 0, transform: T(x, y - 30, 2.5, r + 28) },
        { opacity: 1, transform: T(x, y, 0.82, r - 3), offset: landT },
        { opacity: 1, transform: T(x, y, 1.1, r + 2), offset: settleT },
        { opacity: 1, transform: T(x, y, 1, r), offset: 520 / total },
        { opacity: 1, transform: T(x, y, 1, r), offset: holdT },
        { opacity: 0, transform: T(x, y - 8, 0.94, r) }], { duration: total, fill: 'both', easing: 'ease-out' });
    if (!rm) { setTimeout(function () { PJ.sfx('sticker'); PJ.burst('glitter', x, y, { size: size * 1.9, ms: 700, rotate: false }); }, 190); }
    return el;
  };

  PJ.charm = function (targetEl, o) {
    if (!targetEl) return null;
    o = o || {};
    PJ.uncharm(targetEl);
    var size = o.size || 58, w = document.createElement('div');
    w.className = 'pj-charm' + (reduced() ? '' : ' drop');
    w.style.width = w.style.height = size + 'px';
    w.style[o.side === 'left' ? 'left' : 'right'] = (o.offset != null ? o.offset : 10) + 'px';
    w.style.top = 'calc(100% - ' + (o.overlap != null ? o.overlap : 6) + 'px)';
    w.innerHTML = '<img alt="" src="' + stickerUrl('vp-charm') + '">';
    if (getComputedStyle(targetEl).position === 'static') { targetEl.style.position = 'relative'; targetEl.setAttribute('data-pj-rel', '1'); }
    targetEl.appendChild(w);
    return w;
  };
  PJ.uncharm = function (targetEl) {
    if (!targetEl) return;
    var old = targetEl.querySelectorAll(':scope > .pj-charm');
    for (var i = 0; i < old.length; i++) old[i].remove();
  };

  // ---- 7. widgets ----
  PJ.streakFlame = function (el, n) {
    if (!el) return;
    n = Math.max(0, n | 0);
    if (!n) { el.innerHTML = ''; return; }
    var had = el.firstChild && el.firstChild.classList && el.firstChild.classList.contains('pj-streak');
    el.innerHTML = '<span class="pj-streak' + (n >= 3 ? ' hot' : '') + '"><svg viewBox="0 0 18 22" aria-hidden="true"><path class="f-out" d="M9 0c1 4 6 7 6 13a6 6 0 0 1-12 0c0-3 1.500-4.500 2.500-6 .5 2 1.500 3 2.500 3C8.500 7 7.500 3.500 9 0Z"/><path class="f-in" d="M9 22a4 4 0 0 1-4-4c0-2.500 2-3.500 3-5.500.5 1.500 1.500 2 2 2 .5-1 .5-2 .3-3 2 1.500 2.700 3.500 2.700 6.500a4 4 0 0 1-4 4Z" transform="translate(0 -1)"/></svg>' + n + '<small>streak</small></span>';
    if (n > 1 && !had) PJ.sfx('ping');
  };

  PJ.xpBar = function (el, pct, level) {
    if (!el) return;
    pct = Math.max(0, Math.min(100, pct || 0));
    var box = el.querySelector(':scope > .pj-xp');
    if (!box) {
      box = document.createElement('div'); box.className = 'pj-xp';
      box.innerHTML = '<span class="lv"></span><span class="track"><span class="fill"></span></span>';
      el.appendChild(box);
      box.querySelector('.fill').style.width = '0%';
      void box.offsetWidth;
    }
    var lv = box.querySelector('.lv'), prev = lv.getAttribute('data-lv');
    lv.textContent = 'LV ' + (level == null ? '' : level);
    lv.setAttribute('data-lv', level);
    box.querySelector('.fill').style.width = pct + '%';
    box.setAttribute('role', 'progressbar'); box.setAttribute('aria-valuenow', Math.round(pct));
    if (prev !== null && String(prev) !== String(level)) {
      box.classList.remove('lvup'); void box.offsetWidth; box.classList.add('lvup');
      var c = center(box); PJ.burst('glitter', c.x, c.y, { size: 150, ms: 800 }); PJ.sfx('claim');
    }
  };

  var modalOpen = null;
  PJ.dailyBonus = function (amount, o) {
    o = o || {};
    if (modalOpen) return modalOpen.promise;
    var m = document.createElement('div');
    m.className = 'pj-modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', 'Daily bonus');
    m.innerHTML = '<div class="pj-card"><div class="kick">' + esc(o.kicker || 'DAILY BONUS') + '</div>' +
      '<div class="pj-card-art"><img class="glitter" alt="" src="' + artUrl('glitter') + '"><img alt="" src="' + stickerUrl('vp-chip') + '"></div>' +
      '<div class="amt">' + (typeof amount === 'number' ? money(0, true) : esc(amount)) + '</div>' +
      '<p>' + esc(o.note || 'Come back every day to keep your streak alive.') + '</p><button type="button" class="claim">CLAIM</button></div>';
    document.body.appendChild(m);
    var btn = m.querySelector('.claim'), amt = m.querySelector('.amt'), done;
    var promise = new Promise(function (r) { done = r; });
    modalOpen = { promise: promise };
    requestAnimationFrame(function () { m.classList.add('open'); });
    PJ.sfx('toast');
    if (typeof amount === 'number') setTimeout(function () { PJ.countUp(amt, 0, amount, 900, { signed: true }); }, 250);
    function close(claimed) {
      document.removeEventListener('keydown', onKey, true);
      m.classList.remove('open');
      setTimeout(function () { m.remove(); modalOpen = null; }, reduced() ? 0 : 220);
      done(claimed);
    }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(false); } }
    document.addEventListener('keydown', onKey, true);
    btn.addEventListener('click', function () {
      btn.disabled = true;
      PJ.sfx('claim'); PJ.sfx('chipShower');
      var c = center(btn);
      PJ.burst('chips', c.x, c.y - 40, { size: 420, ms: 1000, front: true });
      if (typeof o.onClaim === 'function') { try { o.onClaim(amount); } catch (e) { console.error(e); } }
      setTimeout(function () { close(true); }, reduced() ? 100 : 650);
    });
    setTimeout(function () { btn.focus(); }, 60);
    return promise;
  };

  PJ.clear = function () {
    Object.keys(layers).forEach(function (k) { layers[k].textContent = ''; });
    toastQ.length = 0;
  };
})();
