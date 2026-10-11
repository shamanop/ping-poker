/* DINO symbols. window.DinoSymbols.svg(sym, m) -> markup that fills its box. With art (DinoArt manifest has sym_<id>) it is an <img> block, otherwise the
   Hatch Party recolored geometric SVG placeholder. Slot contract: _dino/ASSET-SLOTS.md */
(function () {
  'use strict';
  var uid = 0;
  var NAMES = { h1: 'Hatchling', h2: 'Longneck', h3: 'Triceratops', h4: 'Stegosaurus', l1: 'Pebble', l2: 'Seashell', l3: 'Footprint', l4: 'Berries', l5: 'Fern leaf', S: 'Rainbow Egg', B: 'Multiplier Egg' };
  // [main, light, dark outline]
  var PAL = {
    h1: ['#F7B955', '#FFE7A8', '#6A3B0E'],
    h2: ['#2DB7A8', '#9CF0E0', '#06433D'],
    h3: ['#F26B4F', '#FFB09C', '#6B1C10'],
    h4: ['#6CC24A', '#C6F29A', '#1F4A0E'],
    l1: ['#F5C43A', '#FFF0A0', '#6B4A00'],
    l2: ['#49C9D6', '#C2F4F8', '#0B4A55'],
    l3: ['#F58A3E', '#FFD0A2', '#6A300A'],
    l4: ['#E4506B', '#FFB4C2', '#5E1426'],
    l5: ['#3FA564', '#A8EBC0', '#0F4224'],
    S: ['#FFC21A', '#FFF1A8', '#5A3A00'],
    B: ['#3FC8E8', '#B8F1FF', '#0B3E5A']
  };
  // shape path (centered in 100x100), numeral y baseline handled in svg()
  var SHAPES = {
    h1: 'M50 6 L61.8 36.6 L94.7 38.2 L69 58.8 L77.6 90.6 L50 72.6 L22.4 90.6 L31 58.8 L5.3 38.2 L38.2 36.6 Z',
    h2: 'M50 4 L92 50 L50 96 L8 50 Z',
    h3: 'M26 10 L74 10 L97 50 L74 90 L26 90 L3 50 Z',
    l1: 'M50 8 L95 88 L5 88 Z',
    l2: 'M13 13 H87 Q92 13 92 18 V82 Q92 87 87 87 H13 Q8 87 8 82 V18 Q8 13 13 13 Z',
    l3: 'M50 6 L95 38 L78 92 L22 92 L5 38 Z',
    l4: 'M36 6 H64 V36 H94 V64 H64 V94 H36 V64 H6 V36 H36 Z',
    l5: 'M50 5 C50 5 88 44 88 64 A38 38 0 0 1 12 64 C12 44 50 5 50 5 Z'
  };
  var TEXT_Y = { h1: 61, h2: 64, h3: 65, h4: 65, l1: 79, l2: 66, l3: 69, l4: 64, l5: 74 };
  var TEXT_SZ = { h1: 30, h2: 34, h3: 36, h4: 38, l1: 32, l2: 40, l3: 38, l4: 36, l5: 36 };

  function bombTier(m) { m = +m || 0; return m >= 100 ? 'max' : m >= 20 ? 'high' : m >= 8 ? 'mid' : 'low'; }
  var BOMB_PAL = { low: ['#3FC8E8', '#B8F1FF', '#0B3E5A'], mid: ['#F59A2E', '#FFD79A', '#6A3300'], high: ['#E1478F', '#FFB3D6', '#5A0F35'], max: ['#F0452B', '#FFD24A', '#5A0F05'] };
  function bombPal(m) { return BOMB_PAL[bombTier(m)]; }
  var EGG = 'M50 5 C75 5 89 37 89 60 C89 81 72 95 50 95 C28 95 11 81 11 60 C11 37 25 5 50 5 Z';
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function burstPath(n, ro, ri) {
    var d = '';
    for (var i = 0; i < n * 2; i++) {
      var a = -Math.PI / 2 + i * Math.PI / n, r = i % 2 ? ri : ro;
      d += (i ? 'L' : 'M') + (50 + Math.cos(a) * r).toFixed(1) + ' ' + (50 + Math.sin(a) * r).toFixed(1);
    }
    return d + 'Z';
  }
  function txt(x, y, size, str, fill, stroke, sw) {
    return '<text x="' + x + '" y="' + y + '" text-anchor="middle" font-family="\'Arial Black\',Impact,system-ui,sans-serif" font-weight="900" font-size="' + size +
      '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '" stroke-linejoin="round" paint-order="stroke fill">' + esc(str) + '</text>';
  }
  function grad(id, p, rx, ry) {
    return '<radialGradient id="' + id + '" cx="' + (rx || 0.35) + '" cy="' + (ry || 0.28) + '" r="0.85"><stop offset="0" stop-color="' + p[1] + '"/><stop offset="0.55" stop-color="' + p[0] + '"/><stop offset="1" stop-color="' + p[2] + '"/></radialGradient>';
  }

  function artFor(sym, m) {
    var A = window.DinoArt; if (!A || !A.has) return null;
    var main = null;
    if (sym === 'B') {
      var t = bombTier(m), k = t === 'low' ? 'sym_B' : 'sym_B_' + t;
      main = A.has(k) ? k : (A.has('sym_B') ? 'sym_B' : null);
    } else if (A.has('sym_' + sym)) main = 'sym_' + sym;
    if (!main) return null;
    var win = sym === 'B' ? null : (A.has('sym_' + sym + '_win') ? 'sym_' + sym + '_win' : null);
    return { main: A.url(main), win: win ? A.url(win) : null };
  }
  function artMarkup(sym, m, a) {
    var label = sym === 'B' ? (m == null ? '?' : m) + 'x' : '';
    return '<span class="dsym art' + (a.win ? ' hasw' : '') + '" data-dsym="' + sym + '" data-m="' + (m == null ? '' : esc(m)) + '" data-art="1" role="img" aria-label="' + esc(name(sym, m)) + '">' +
      '<img class="b" src="' + a.main + '" alt="" draggable="false">' + (a.win ? '<img class="w" src="' + a.win + '" alt="" draggable="false">' : '') +
      (sym === 'B' ? '<span class="bnum" data-t="' + bombTier(m) + '" data-l="' + label.length + '">' + esc(label) + '</span>' : '') + '</span>';
  }

  function svg(sym, m) {
    var art = artFor(sym, m);
    if (art) return artMarkup(sym, m, art);
    var id = 'ds' + (++uid), head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%" role="img" data-dsym="' + sym + '" data-m="' + (m == null ? '' : esc(m)) + '" data-art="0" aria-label="' + esc(name(sym, m)) + '">';
    var body = '', p = PAL[sym], d;
    if (sym === 'B') {
      p = bombPal(m);
      var label = (m == null ? '?' : m) + 'x', sz = label.length >= 5 ? 24 : label.length === 4 ? 27 : label.length === 3 ? 31 : 36;
      body = '<defs>' + grad(id + 'g', p, 0.38, 0.3) + '<radialGradient id="' + id + 'h"><stop offset="0" stop-color="' + p[1] + '" stop-opacity=".85"/><stop offset="1" stop-color="' + p[0] + '" stop-opacity="0"/></radialGradient></defs>' +
        '<circle cx="50" cy="52" r="49" fill="url(#' + id + 'h)"/>' +
        '<path d="' + EGG + '" fill="url(#' + id + 'g)" stroke="' + p[2] + '" stroke-width="4" stroke-linejoin="round"/>' +
        '<path d="M16 38 L28 30 L36 40 L47 28 L58 40 L68 30 L84 38" fill="none" stroke="' + p[2] + '" stroke-opacity=".55" stroke-width="3" stroke-linejoin="round"/>' +
        '<ellipse cx="35" cy="30" rx="10" ry="6" fill="#fff" fill-opacity=".5" transform="rotate(-30 35 30)"/>' +
        txt(50, 66 + sz * 0.1, sz, label, '#fff', p[2], 5);
    } else if (sym === 'S') {
      var rb = ['#FF5A5F', '#FF9F3A', '#FFD93D', '#59D36B', '#3FA7F5', '#9B6BF0'], st = '';
      rb.forEach(function (c, i) { st += '<stop offset="' + (i / 6).toFixed(3) + '" stop-color="' + c + '"/><stop offset="' + ((i + 1) / 6).toFixed(3) + '" stop-color="' + c + '"/>'; });
      body = '<defs><linearGradient id="' + id + 'g" x1="0.1" y1="0" x2="0.9" y2="1">' + st + '</linearGradient><radialGradient id="' + id + 'h"><stop offset="0" stop-color="#FFE066" stop-opacity=".95"/><stop offset="1" stop-color="#FFC21A" stop-opacity="0"/></radialGradient></defs>' +
        '<circle cx="50" cy="52" r="49" fill="url(#' + id + 'h)"/>' +
        '<path d="' + EGG + '" fill="url(#' + id + 'g)" stroke="#5A3A00" stroke-width="4" stroke-linejoin="round"/>' +
        '<ellipse cx="35" cy="28" rx="11" ry="6" fill="#fff" fill-opacity=".55" transform="rotate(-30 35 28)"/>' +
        '<circle cx="50" cy="62" r="19" fill="#FFF6D8" stroke="#5A3A00" stroke-width="3.5"/>' +
        txt(50, 74, 28, 'S', '#E07A00', '#5A3A00', 3);
    } else if (sym === 'h4') {
      body = '<defs>' + grad(id + 'g', p) + '</defs>' +
        '<circle cx="50" cy="50" r="45" fill="url(#' + id + 'g)" stroke="' + p[2] + '" stroke-width="5"/>' +
        '<circle cx="50" cy="50" r="35" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="3.5"/>' +
        '<ellipse cx="37" cy="26" rx="15" ry="7" fill="#fff" fill-opacity=".4" transform="rotate(-25 37 26)"/>' +
        txt(50, TEXT_Y.h4, TEXT_SZ.h4, '4', '#fff', p[2], 5);
    } else if (SHAPES[sym]) {
      d = SHAPES[sym];
      var hi = sym[0] === 'h', gloss = hi ? '<path d="' + d + '" fill="url(#' + id + 'o)" opacity=".9"/>' : '';
      body = '<defs>' + grad(id + 'g', p) + (hi ? '<linearGradient id="' + id + 'o" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/></linearGradient>' : '') + '</defs>' +
        '<path d="' + d + '" fill="url(#' + id + 'g)" stroke="' + p[2] + '" stroke-width="' + (hi ? 5 : 4) + '" stroke-linejoin="round"/>' + gloss +
        txt(50, TEXT_Y[sym], TEXT_SZ[sym], sym[1], hi ? '#fff' : p[2], hi ? p[2] : '#fff', hi ? 5 : 3);
    } else {
      body = '<rect x="10" y="10" width="80" height="80" fill="#888"/>' + txt(50, 62, 40, '?', '#fff', '#000', 3);
    }
    return head + body + '</svg>';
  }
  // Called by art.js once the manifest is loaded: re-render any symbol drawn before art was known (or whose art availability changed).
  function refresh() {
    var nodes = document.querySelectorAll('[data-dsym]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i], sym = n.getAttribute('data-dsym'), mm = n.getAttribute('data-m'), m = mm === '' ? undefined : (isNaN(+mm) ? mm : +mm);
      var want = !!artFor(sym, m);
      if ((n.getAttribute('data-art') === '1') === want && !want) continue;
      var tmp = document.createElement('div'); tmp.innerHTML = svg(sym, m);
      if (tmp.firstChild && n.parentNode) n.parentNode.replaceChild(tmp.firstChild, n);
    }
  }
  function name(sym) { return NAMES[sym] || String(sym); }
  function color(sym, m) { return sym === 'B' ? bombPal(m)[0] : (PAL[sym] ? PAL[sym][0] : '#888888'); }
  window.DinoSymbols = { svg: svg, name: name, color: color, refresh: refresh, bombTier: bombTier, list: ['h1', 'h2', 'h3', 'h4', 'l1', 'l2', 'l3', 'l4', 'l5', 'S', 'B'] };
})();
