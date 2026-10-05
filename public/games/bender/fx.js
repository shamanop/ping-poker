/* Canvas particles in stage space 1080 x canvas height, plus screen shake and flash.
   Two layers: #fx (front, sparks/bursts/lightning) and #fxb (back: confetti, coins, rain, cannons, eruption, which sit BEHIND win numbers and modal text). */
const FX = (() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const COLORS = ['#F5B942', '#FDFBF7', '#C8352B', '#3A7CC4', '#F5B942'];
  const rnd = (a, b) => a + Math.random() * (b - a);

  function star(g, r) {
    g.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.42 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    g.closePath(); g.fill();
  }

  function layer(id) {
    const cv = document.getElementById(id), g = cv.getContext('2d');
    let ps = [], raf = 0, last = 0;
    cv.style.display = 'none'; // idle canvases are expensive to composite under the shell
    function frame(now) {
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); g.setTransform(0.5, 0, 0, 0.5, 0, 0);
      ps = ps.filter((p) => (p.life -= dt) > 0 && p.y < cv.height * 2 + 180);
      for (const p of ps) {
        if (p.shape === 'bolt') { drawBolt(g, p); continue; }
        p.vy += p.g * dt; p.vx *= 1 - p.drag * dt; p.vy *= 1 - p.drag * dt * 0.5;
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
        g.globalAlpha = Math.min(1, p.life / 0.35);
        g.fillStyle = p.c;
        if (p.shape === 'star') star(g, p.size);
        else if (p.shape === 'foam') { g.beginPath(); g.arc(0, 0, p.size, 0, 7); g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(10,22,40,.45)'; g.stroke(); }
        else if (p.shape === 'coin') { const sc = Math.abs(Math.cos(p.rot * 1.3)) * 0.8 + 0.2; g.scale(sc, 1); g.beginPath(); g.arc(0, 0, p.size, 0, 7); g.fill(); g.lineWidth = Math.max(2, p.size * 0.16); g.strokeStyle = '#0A1628'; g.stroke(); g.fillStyle = '#D99A1E'; g.beginPath(); g.arc(0, 0, p.size * 0.55, 0, 7); g.fill(); }
        else if (p.shape === 'ballot') { const w = p.size * 1.5, h = p.size * 2 * (0.55 + 0.45 * Math.abs(Math.cos(p.rot * 1.1))); g.fillStyle = '#FDFBF7'; g.fillRect(-w / 2, -h / 2, w, h); g.strokeStyle = '#0A1628'; g.lineWidth = 2; g.strokeRect(-w / 2, -h / 2, w, h); g.fillStyle = '#C8352B'; g.fillRect(-w / 2 + 4, -h / 2 + 5, w * 0.35, 3); g.fillStyle = '#3A7CC4'; g.fillRect(-w / 2 + 4, -h / 2 + 12, w * 0.6, 2.5); }
        else if (p.shape === 'spark') { g.fillRect(-p.size * 1.6, -p.size * 0.25, p.size * 3.2, p.size * 0.5); }
        else { const sc = Math.abs(Math.cos(p.rot * 1.7)); g.fillRect(-p.size / 2, -p.size * sc / 2, p.size, p.size * sc * 0.8 + 2); }
        g.restore();
      }
      if (ps.length) raf = requestAnimationFrame(frame); else { raf = 0; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); cv.style.display = 'none'; }
    }
    return { cv, add(p) { cv.style.display = ''; ps.push(p); if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }, count: () => ps.length };
  }
  function drawBolt(g, p) {
    g.save(); g.globalAlpha = Math.min(1, p.life / 0.06); g.lineJoin = 'round'; g.lineCap = 'round';
    for (const [w, c] of [[p.w * 2.6, 'rgba(245,185,66,.35)'], [p.w, '#FFF4CF']]) {
      g.strokeStyle = c; g.lineWidth = w; g.beginPath();
      for (let i = 0; i < p.pts.length; i++) { const q = p.pts[i], j = i === 0 || i === p.pts.length - 1 ? 0 : p.jit; g.lineTo(q[0] + rnd(-j, j), q[1] + rnd(-j, j)); }
      g.stroke();
    }
    g.restore();
  }
  const front = layer('fx'), back = layer('fxb');
  const cap = (L, n) => Math.max(0, Math.min(n, 450 - L.count()));

  function burst(x, y, o = {}) {
    const L = o.back ? back : front, n = cap(L, Math.round((o.n || 14) * (reduce ? 0.4 : 1))), cols = o.cols || COLORS;
    for (let i = 0; i < n; i++) {
      const a = (o.ang == null ? rnd(0, Math.PI * 2) : o.ang + rnd(-(o.spread || 1), o.spread || 1)), sp = rnd(0.35, 1) * (o.speed || 520);
      L.add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (o.up == null ? 120 : o.up), g: o.g == null ? 1500 : o.g, drag: o.drag == null ? 1.2 : o.drag, life: rnd(0.55, 1) * (o.life || 0.9), size: rnd(0.6, 1) * (o.size || 14), rot: rnd(0, 6), vr: rnd(-12, 12), c: cols[(Math.random() * cols.length) | 0], shape: o.shape || (Math.random() < 0.25 ? 'star' : 'rect') });
    }
  }
  // coins and stars flung outward from a centre (the "radial burst" behind a big win number)
  function radial(x, y, n, o = {}) {
    n = cap(back, Math.round(n * (reduce ? 0.35 : 1)));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(-0.15, 0.15), sp = rnd(500, o.speed || 1500);
      back.add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 260, drag: 0.55, life: rnd(1.0, 1.9), size: rnd(12, 24), rot: rnd(0, 6), vr: rnd(-9, 9), c: i % 3 ? '#F5B942' : '#FFF4CF', shape: i % 3 === 0 ? 'star' : 'coin' });
    }
  }
  function foam(x, y, n, o = {}) {
    n = cap(front, Math.round(n * (reduce ? 0.4 : 1)));
    for (let i = 0; i < n; i++) { const a = (o.ang == null ? -Math.PI / 2 : o.ang) + rnd(-0.85, 0.85), sp = rnd(300, 1100); front.add({ x: x + rnd(-14, 14), y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 520, drag: 0.9, life: rnd(0.7, 1.5), size: rnd(7, 19), rot: 0, vr: 0, c: Math.random() < 0.8 ? '#FDFBF7' : '#F5E3A0', shape: 'foam' }); }
  }
  function ember(x, y) { front.add({ x, y, vx: rnd(-40, 40), vy: rnd(-260, -120), g: -20, drag: 0.3, life: rnd(1.2, 2.2), size: rnd(4, 9), rot: 0, vr: 0, c: Math.random() < 0.5 ? '#F5B942' : '#C8352B', shape: 'foam' }); }
  // jagged gold lightning along a chain of stage-space points
  function lightning(pts, o = {}) {
    if (reduce || pts.length < 2) return;
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], seg = 4;
      for (let k = 0; k < seg; k++) out.push([x0 + (x1 - x0) * k / seg, y0 + (y1 - y0) * k / seg]);
    }
    out.push(pts[pts.length - 1]);
    for (let f = 0; f < 3; f++) front.add({ shape: 'bolt', pts: out, w: o.w || 5, jit: o.jit || 14, life: 0.12 + f * 0.06, x: 0, y: 0 });
  }
  function confetti(n, o = {}) {
    n = cap(back, Math.round(n * (reduce ? 0.35 : 1)));
    for (let i = 0; i < n; i++) back.add({ x: rnd(-40, 1120), y: rnd(-300, -20), vx: rnd(-160, 160), vy: rnd(100, 500), g: 520, drag: 0.5, life: rnd(2.2, 4), size: rnd(12, 26), rot: rnd(0, 6), vr: rnd(-9, 9), c: COLORS[(Math.random() * 5) | 0], shape: Math.random() < 0.18 ? 'star' : 'rect' });
  }
  function rain(n, shapes) {
    n = cap(back, Math.round(n * (reduce ? 0.35 : 1))); shapes = shapes || ['coin', 'ballot'];
    for (let i = 0; i < n; i++) back.add({ x: rnd(0, 1080), y: rnd(-500, -20), vx: rnd(-120, 120), vy: rnd(150, 500), g: 700, drag: 0.35, life: rnd(2.4, 4.2), size: rnd(14, 24), rot: rnd(0, 6), vr: rnd(-8, 8), c: '#F5B942', shape: shapes[(Math.random() * shapes.length) | 0] });
  }
  function eruption(x, y, n) {
    n = cap(back, Math.round(n * (reduce ? 0.35 : 1)));
    for (let i = 0; i < n; i++) { const a = -Math.PI / 2 + rnd(-0.9, 0.9), sp = rnd(700, 1700); back.add({ x: x + rnd(-80, 80), y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 1500, drag: 0.5, life: rnd(1.4, 2.4), size: rnd(14, 26), rot: rnd(0, 6), vr: rnd(-10, 10), c: '#F5B942', shape: Math.random() < 0.5 ? 'ballot' : 'coin' }); }
  }
  function cannon(side, n) {
    n = cap(back, Math.round(n * (reduce ? 0.35 : 1)));
    const x = side < 0 ? 20 : 1060, ang = side < 0 ? -1.0 : -Math.PI + 1.0, cy = back.cv.height * 2 * 0.78;
    for (let i = 0; i < n; i++) { const a = ang + rnd(-0.38, 0.38), sp = rnd(900, 1900); back.add({ x, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, g: 1300, drag: 1.1, life: rnd(1.6, 3), size: rnd(12, 24), rot: rnd(0, 6), vr: rnd(-12, 12), c: COLORS[(Math.random() * 5) | 0], shape: Math.random() < 0.2 ? 'star' : 'rect' }); }
  }
  // opts.big: more steps, a scale pulse and a little rotation for the huge wins
  function shake(amp, dur, o = {}) {
    if (reduce) return;
    const el = document.getElementById('shake'), kf = [], N = 14;
    for (let i = 0; i < N; i++) {
      const k = 1 - i / N, sc = o.big ? 1 + 0.022 * k * (i % 2 ? 1 : 0.4) : 1, rot = (o.big ? 0.9 : 0.5) * k;
      kf.push({ transform: `translate(${rnd(-amp, amp) * k}px,${rnd(-amp, amp) * k}px) rotate(${rnd(-rot, rot)}deg) scale(${sc})` });
    }
    kf.push({ transform: 'none' });
    el.animate(kf, { duration: dur, easing: 'linear' });
  }
  function flash(ms = 120, color = '#fff', peak = 0.85) {
    if (reduce) return;
    const stage = document.getElementById('stage'), d = document.createElement('div');
    d.className = 'flash'; d.style.background = color; stage.appendChild(d);
    d.animate([{ opacity: peak }, { opacity: 0 }], { duration: ms, easing: 'ease-out' }).finished.then(() => d.remove(), () => d.remove());
  }
  return { burst, radial, foam, ember, lightning, confetti, cannon, shake, rain, eruption, flash };
})();
