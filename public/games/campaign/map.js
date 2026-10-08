/* Campaign Trail: the election-night map. Geometry comes from map-data.js (CC0 US states SVG); tiers, parties and borders come from the server's `map`.
   The world (states, trail, outlines) is one SVG inside a div that only ever moves by CSS transform; labels live in a pixel-space layer that fades while the camera moves.
   No rules here: it draws what it is told. */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, parent) => { const n = document.createElementNS(NS, tag); for (const k in attrs || {}) n.setAttribute(k, attrs[k]); if (parent) parent.appendChild(n); return n; };
  const div = (cls, parent, html) => { const n = document.createElement('div'); n.className = cls; if (html != null) n.innerHTML = html; if (parent) parent.appendChild(n); return n; };
  const FULL = { x0: 4, y0: 26, x1: 940, y1: 592 };
  const MOVE_MS = 900;

  function CampaignMap(host, geo, info, hooks) {
    const G = geo, MAPI = info || {}, H = hooks || {};
    const states = G.states;
    const world = div('map-world', host);
    world.style.width = G.w + 'px'; world.style.height = G.h + 'px';
    const mk = (cls) => el('svg', { viewBox: '0 0 ' + G.w + ' ' + G.h, width: G.w, height: G.h, class: cls, 'aria-hidden': 'true' }, world);
    const svg = mk('map-svg'), svgCur = mk('map-svg map-cur'), svgHot = mk('map-svg map-hot');       // base (static) / steady outline / pulsing outlines: the pulse is one opacity animation on its own layer
    const defs = el('defs', null, svg);
    const pat = el('pattern', { id: 'swingFill', width: 5, height: 5, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, defs);
    el('rect', { width: 5, height: 5, fill: '#5e3a7a' }, pat); el('rect', { width: 2, height: 5, fill: '#d9a93f', 'fill-opacity': '.75' }, pat);
    const pat2 = el('pattern', { id: 'visFill', width: 6, height: 6, patternUnits: 'userSpaceOnUse' }, defs);
    el('rect', { width: 6, height: 6, fill: '#2a1d13' }, pat2); el('circle', { cx: 3, cy: 3, r: 0.9, fill: '#b8893a', 'fill-opacity': '.5' }, pat2);
    const gStates = el('g', { class: 'g-states' }, svg), gAir = el('g', { class: 'g-air' }, svg), gTrail = el('g', { class: 'g-trail' }, svg), gCur = el('g', { class: 'g-cur' }, svgCur), gHot = el('g', { class: 'g-hot' }, svgHot);
    const marks = div('map-marks', host);
    const paths = {};
    for (const code of Object.keys(states)) {
      const meta = (MAPI.states && MAPI.states[code]) || {};
      const p = el('path', { d: states[code].d, class: 'st ' + (meta.tier || 'safe') + ' ' + (meta.party || 'R'), 'data-s': code }, gStates);
      paths[code] = p;
    }
    let W = host.clientWidth || 360, Hh = host.clientHeight || 240;
    let cam = { s: 1, tx: 0, ty: 0 }, target = null, hideT = 0, scene = null, inset = { t: 34, r: 8, b: 8, l: 8 };
    const insetFor = (mode) => { const big = W >= 700; return { t: mode === 'setup' ? (big ? 58 : 50) : 32, r: 8, b: big ? 66 : 38, l: 8 }; };
    const cen = (c) => states[c].c;
    const isAir = (a, b) => (MAPI.air || []).some((p) => (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a));

    // ---- camera
    function boxOf(codes, minW) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const c of codes) { const b = states[c].b; x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, ar = Math.max(0.3, (W - inset.l - inset.r) / Math.max(40, Hh - inset.t - inset.b));
      let w = Math.max(x1 - x0, minW || 0), h = Math.max(y1 - y0, (minW || 0) / ar);
      w *= 1.28; h *= 1.28;                       // margin so the edges of the box are never on the edge of the board
      return { cx, cy, w, h };
    }
    function camFor(box) {
      const aw = W - inset.l - inset.r, ah = Hh - inset.t - inset.b;
      let s = Math.min(aw / box.w, ah / box.h);
      const sFit = Math.min(aw / (FULL.x1 - FULL.x0), ah / (FULL.y1 - FULL.y0));
      s = Math.max(sFit, Math.min(s, 7));
      return { s, tx: inset.l + aw / 2 - s * box.cx, ty: inset.t + ah / 2 - s * box.cy };
    }
    function wholeBox() { return { cx: (FULL.x0 + FULL.x1) / 2, cy: (FULL.y0 + FULL.y1) / 2, w: FULL.x1 - FULL.x0, h: FULL.y1 - FULL.y0 }; }
    function apply(c, animate) {
      cam = c; world.style.transition = animate ? 'transform ' + MOVE_MS + 'ms cubic-bezier(.22,.8,.24,1)' : 'none';
      world.style.transform = 'translate(' + c.tx.toFixed(2) + 'px,' + c.ty.toFixed(2) + 'px) scale(' + c.s.toFixed(4) + ')';
      host.dataset.zoom = c.s.toFixed(2);
    }
    function look(codes, opts) {                   // codes = states to frame ('all' = whole map)
      const o = opts || {}; target = { codes, minW: o.minW };
      const box = codes === 'all' ? wholeBox() : boxOf(codes, o.minW == null ? Math.max(230, Math.min(380, W / 2.6)) : o.minW);
      const next = camFor(box), animate = o.animate !== false && Math.abs(next.s - cam.s) + Math.abs(next.tx - cam.tx) + Math.abs(next.ty - cam.ty) > 0.5;
      marks.classList.add('hide'); clearTimeout(hideT);
      apply(next, animate);
      hideT = setTimeout(() => { placeMarks(); marks.classList.remove('hide'); }, animate ? MOVE_MS - 80 : 0);
    }
    function resize() {
      const w = host.clientWidth, h = host.clientHeight; if (!w || !h || (w === W && h === Hh)) return; W = w; Hh = h;
      if (target) look(target.codes, { animate: false, minW: target.minW });
    }
    if (window.ResizeObserver) new ResizeObserver(resize).observe(host); else window.addEventListener('resize', resize);

    // ---- air links (dashed arcs): bulge toward the west for the Pacific legs, south for AK-HI
    function arcD(a, b) {
      const p = cen(a), q = cen(b), mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2, dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1;
      let nx = -dy / len, ny = dx / len; const west = (isAir(a, b) && (a === 'AK' || b === 'AK') && (a === 'WA' || b === 'WA')) || (isAir(a, b) && (a === 'CA' || b === 'CA'));
      if (west ? nx > 0 : ny < 0) { nx = -nx; ny = -ny; }
      const k = len * (west ? 0.22 : 0.3);
      return 'M' + p[0] + ',' + p[1] + ' Q' + (mx + nx * k).toFixed(1) + ',' + (my + ny * k).toFixed(1) + ' ' + q[0] + ',' + q[1];
    }
    const segD = (a, b) => (isAir(a, b) ? arcD(a, b) : 'M' + cen(a)[0] + ',' + cen(a)[1] + ' L' + cen(b)[0] + ',' + cen(b)[1]);
    const airPaths = {};
    for (const pr of MAPI.air || []) airPaths[pr[0] + pr[1]] = el('path', { d: arcD(pr[0], pr[1]), class: 'air', 'data-air': pr.join('-') }, gAir);

    // ---- scene: what is lit, visited, tinted; the trail; the markers
    const hotEls = [];
    let trailGlow, trailCore, trailNew, tornEls = [];
    function clearScene() {
      for (const c in paths) paths[c].setAttribute('class', 'st ' + ((MAPI.states[c] || {}).tier || 'safe') + ' ' + ((MAPI.states[c] || {}).party || 'R'));
      while (gHot.firstChild) gHot.removeChild(gHot.firstChild); while (gCur.firstChild) gCur.removeChild(gCur.firstChild); while (gTrail.firstChild) gTrail.removeChild(gTrail.firstChild);
      hotEls.length = 0; tornEls = []; trailGlow = trailCore = trailNew = null;
      for (const k in airPaths) airPaths[k].setAttribute('class', 'air');
    }
    function trailD(trail, skipLast) { let d = ''; for (let i = 0; i < trail.length - 1 - (skipLast ? 1 : 0); i++) d += segD(trail[i], trail[i + 1]); return d; }
    function draw(sc, opts) {
      const o = opts || {}; scene = sc; clearScene(); host.dataset.mode = sc.mode; inset = insetFor(sc.mode);
      const visited = new Set(sc.trail || []);
      for (const c in paths) {
        const p = paths[c]; let cls = 'st ' + ((MAPI.states[c] || {}).tier || 'safe') + ' ' + ((MAPI.states[c] || {}).party || 'R');
        if (sc.mode !== 'setup' && visited.has(c)) cls += ' vis';
        if (sc.mode === 'run' && sc.options && sc.options.some((x) => x.to === c)) cls += ' opt';
        else if (sc.mode === 'run' && !visited.has(c)) cls += ' dim';
        if (sc.mode === 'run' && sc.at === c) cls += ' cur';
        if (sc.mode === 'end' && !visited.has(c) && c !== sc.failedAt) cls += ' dim';
        if (sc.mode === 'end' && sc.failedAt === c) cls += ' failed';
        if (sc.mode === 'setup' && sc.home === c) cls += ' sel';
        p.setAttribute('class', cls);
      }
      const hotCodes = [];
      if (sc.mode === 'run') for (const op of sc.options || []) hotCodes.push([op.to, 'hot hot-' + op.tier + (op.landslide ? ' hot-ls' : '')]);
      if (sc.mode === 'run' && sc.at) hotCodes.push([sc.at, 'curO']);
      if (sc.mode === 'setup' && sc.home) hotCodes.push([sc.home, 'curO']);
      if (sc.mode === 'end' && sc.failedAt) hotCodes.push([sc.failedAt, 'failO']);
      for (const [c, cls] of hotCodes) { const ph = el('path', { d: states[c].d, class: 'ov ' + cls }, cls === 'curO' ? gCur : gHot); hotEls.push(ph); }
      // air links that are options right now glow
      if (sc.mode === 'run' && sc.at) for (const op of sc.options || []) { const k = airPaths[sc.at + op.to] || airPaths[op.to + sc.at]; if (k) el('path', { d: k.getAttribute('d'), class: 'air hot' }, gHot); }
      // trail
      const trail = sc.trail || [];
      if (trail.length > 1) {
        const d = trailD(trail, !!o.animateLast);
        trailGlow = el('path', { d, class: 'trail-glow' }, gTrail); trailCore = el('path', { d, class: 'trail-core' }, gTrail);
        if (o.animateLast) {
          const a = trail[trail.length - 2], b = trail[trail.length - 1];
          trailNew = el('path', { d: segD(a, b), class: 'trail-new', pathLength: 1 }, gTrail);
        }
      }
      if (sc.mode === 'end' && sc.failedAt && sc.at) {            // the route tears: a gap, jagged ends, no line into the failed state
        const a = cen(sc.at), b = cen(sc.failedAt), dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
        const pt = (t, off) => (a[0] + dx * t + nx * off).toFixed(1) + ',' + (a[1] + dy * t + ny * off).toFixed(1);
        const d1 = 'M' + pt(0, 0) + ' L' + pt(0.32, 0) + ' L' + pt(0.36, 3.5) + ' L' + pt(0.4, -3.5) + ' L' + pt(0.43, 0);
        const d2 = 'M' + pt(0.57, 0) + ' L' + pt(0.6, 3.5) + ' L' + pt(0.64, -3.5) + ' L' + pt(0.68, 0) + ' L' + pt(1, 0);
        tornEls.push(el('path', { d: d1, class: 'torn' }, gTrail), el('path', { d: d2, class: 'torn torn-b' }, gTrail));
      }
      // camera
      if (sc.mode === 'setup') look('all', { animate: o.animate });
      else if (sc.mode === 'end') look('all', { animate: o.animate });
      else if (sc.whole) look('all', { animate: o.animate });
      else look([sc.at].concat((sc.options || []).map((x) => x.to)), { animate: o.animate });
    }

    // ---- markers (pixel space)
    const px = (c) => { const p = cen(c); return [cam.s * p[0] + cam.tx, cam.s * p[1] + cam.ty]; };
    function placeMarks() {
      marks.textContent = ''; if (!scene) return;
      const items = [], sc = scene, trail = sc.trail || [];
      const add = (code, html, cls, r, fixed) => { const p = px(code); items.push({ code, x: p[0], y: p[1], html, cls, r: r || 14, fixed }); if (/mk-(cur|home|fail)/.test(cls)) { const nm = ((MAPI.states[code] && MAPI.states[code].name) || code).length, half = nm * 4.6; for (let gx = -half; gx <= half + 1; gx += 20) items.push({ code, x: p[0] + gx, y: p[1] - 27, r: 12, fixed: true, ghost: true, ox: p[0], oy: p[1] }); } };
      const nameOf = (c) => (MAPI.states[c] && MAPI.states[c].name) || (states[c] && states[c].n) || c;
      if (sc.mode === 'run') {
        for (const c of trail) if (c !== sc.at) add(c, '<i class="seal"></i>', 'mk-seal', 9, true);
        for (const op of sc.options || []) add(op.to, '<b class="badge">' + op.n + '</b><span class="code">' + op.to + '</span>', 'mk-opt', 17);
        if (sc.at) add(sc.at, '<i class="here"></i><span class="nm">' + nameOf(sc.at).toUpperCase() + '</span>', 'mk-cur', 16, true);
      } else if (sc.mode === 'setup') {
        if (sc.home) add(sc.home, '<i class="pin"></i><span class="nm">' + nameOf(sc.home).toUpperCase() + '</span>', 'mk-home', 16, true);
      } else if (sc.mode === 'end') {
        for (const c of trail) if (c !== sc.failedAt) add(c, '<i class="seal"></i>', 'mk-seal', 8, true);
        if (sc.failedAt) add(sc.failedAt, '<i class="xmark"></i><span class="nm bad">' + nameOf(sc.failedAt).toUpperCase() + '</span>', 'mk-fail', 16, true);
      }
      if (trail[0] && (sc.mode === 'run' || sc.mode === 'end') && trail[0] !== sc.at) { const i = items.findIndex((m) => m.code === trail[0] && m.cls === 'mk-seal'); if (i >= 0) { items[i].html = '<i class="pin sm"></i>'; items[i].cls = 'mk-home'; } }
      // keep markers on the board, then push overlapping option badges apart (a few relaxation passes)
      const minX = 14, maxX = W - 14, minY = inset.t - 2, maxY = Hh - inset.b + 6;
      for (const m of items) { m.x = Math.max(minX, Math.min(maxX, m.x)); m.y = Math.max(minY, Math.min(maxY, m.y)); m.ox = m.x; m.oy = m.y; }
      const movable = items.filter((m) => !m.fixed);
      for (let it = 0; it < 24; it++) {
        let moved = false;
        for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
          const a = items[i], b = items[j]; if (a.fixed && b.fixed) continue;
          let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), need = (a.r + b.r) * 0.95;
          if (d >= need) continue; moved = true; if (d < 0.01) { dx = 1; dy = 0.2; d = 1.02; }
          const push = (need - d) / 2 + 0.3, ux = dx / d, uy = dy / d;
          if (!a.fixed && !b.fixed) { a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push; }
          else if (a.fixed) { b.x += ux * push * 2; b.y += uy * push * 2; } else { a.x -= ux * push * 2; a.y -= uy * push * 2; }
        }
        for (const m of movable) { m.x = Math.max(minX, Math.min(maxX, m.x)); m.y = Math.max(minY, Math.min(maxY, m.y)); }
        if (!moved) break;
      }
      for (const m of items) {
        if (m.ghost) continue;
        const n = div('mk ' + m.cls, marks, m.html); n.style.transform = 'translate(' + m.x.toFixed(1) + 'px,' + m.y.toFixed(1) + 'px)'; n.dataset.s = m.code;
        if (m.cls === 'mk-opt') { n.dataset.to = m.code; if (Math.hypot(m.x - m.ox, m.y - m.oy) > 7) n.classList.add('nudged'); }
      }
    }

    // ---- input
    host.addEventListener('click', (ev) => {
      const mk = ev.target.closest && ev.target.closest('.mk-opt'); if (mk && H.pick) return H.pick(mk.dataset.to);
      const t = ev.target; const code = t && t.dataset && t.dataset.s;
      if (code && paths[code] && H.pick) H.pick(code);
    });
    let popT = 0;
    function pop(code, text, cls) {                // "+10%" rises from the state you just carried, after the camera has landed
      clearTimeout(popT); popT = setTimeout(() => { if (!states[code]) return; const p = px(code), n = div('mk mk-pop', marks); n.style.transform = 'translate(' + p[0].toFixed(1) + 'px,' + (p[1] + 24).toFixed(1) + 'px)'; const s = div('pop ' + (cls || ''), n, text); s.addEventListener('animationend', () => n.remove()); }, MOVE_MS + 30);
    }
    function flash(code, kind) { const p = paths[code]; if (!p) return; p.classList.add('flash-' + kind); setTimeout(() => p.classList.remove('flash-' + kind), 1600); }
    return { draw, look, resize, flash, pop, placeMarks, el: host, camera: () => Object.assign({}, cam), boxOf, states, pathOf: (c) => paths[c], MOVE_MS };
  }
  window.CampaignMap = CampaignMap;
})();
