/* Canvas particles (one layer, one rAF loop that exists only while particles are alive), screen shake and flash (Web Animations).
   Stage space is 540 x canvas height. clear() kills everything: big-win overlays call it on close. */
(() => {
  const CC = (window.CC = window.CC || {});
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const COLORS = () => { const s = getComputedStyle(document.getElementById('app')); return [s.getPropertyValue('--gold').trim() || '#f2c14e', s.getPropertyValue('--ink').trim() || '#f4f1ea', s.getPropertyValue('--accent').trim() || '#e4572e', s.getPropertyValue('--good').trim() || '#3bb273']; };
  let cv, g, ps = [], raf = 0, last = 0, cols = null;
  function init() { cv = document.getElementById('fx'); g = cv.getContext('2d'); cv.style.display = 'none'; }
  function star(r) { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.42 : r; g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } g.closePath(); g.fill(); }
  function frame(now) {
    const dt = Math.max(0, Math.min((now - last) / 1000, 0.05)); last = now;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
    ps = ps.filter((p) => (p.life -= dt) > 0 && p.y < cv.height + 80);
    for (const p of ps) {
      if (p.shape === 'ring') { const t = Math.min(1, Math.max(0, 1 - p.life / p.dur)); g.save(); g.globalAlpha = Math.max(0, 1 - t); g.strokeStyle = p.c; g.lineWidth = p.w * (1 - t) + 1.5; g.beginPath(); g.arc(p.x, p.y, p.r0 + (p.r1 - p.r0) * (1 - Math.pow(1 - t, 3)), 0, 7); g.stroke(); g.restore(); continue; }
      p.vy += p.g * dt; p.vx *= 1 - p.drag * dt; p.vy *= 1 - p.drag * dt * 0.5; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.globalAlpha = Math.min(1, p.life / 0.35); g.fillStyle = p.c;
      if (p.shape === 'star') star(p.size);
      else if (p.shape === 'coin') { const sc = Math.abs(Math.cos(p.rot * 1.3)) * 0.8 + 0.2; g.scale(sc, 1); g.beginPath(); g.arc(0, 0, p.size, 0, 7); g.fill(); g.lineWidth = Math.max(1.5, p.size * 0.18); g.strokeStyle = 'rgba(0,0,0,.45)'; g.stroke(); }
      else { const sc = Math.abs(Math.cos(p.rot * 1.7)); g.fillRect(-p.size / 2, -p.size * sc / 2, p.size, p.size * sc * 0.8 + 1.5); }
      g.restore();
    }
    if (ps.length) raf = requestAnimationFrame(frame); else stop();
  }
  function stop() { raf = 0; ps = []; if (g) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); cv.style.display = 'none'; } }
  const add = (p) => { if (!cv) init(); if (ps.length > 380) return; cols = cols || COLORS(); cv.style.display = ''; ps.push(p); if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  function clear() { if (raf) cancelAnimationFrame(raf); stop(); document.querySelectorAll('#stage > .flash').forEach((n) => n.remove()); }   // a flash whose animation callback is late (busy frame) must not outlive the round
  function burst(x, y, o = {}) {
    cols = cols || COLORS(); const n = Math.round((o.n || 14) * (reduce ? 0.4 : 1)), c = o.cols || cols;
    for (let i = 0; i < n; i++) { const a = rnd(0, Math.PI * 2), sp = rnd(0.35, 1) * (o.speed || 300); add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (o.up == null ? 60 : o.up), g: o.g == null ? 800 : o.g, drag: 1.1, life: rnd(0.55, 1) * (o.life || 0.9), size: rnd(0.6, 1) * (o.size || 7), rot: rnd(0, 6), vr: rnd(-12, 12), c: c[(Math.random() * c.length) | 0], shape: o.shape || (Math.random() < 0.3 ? 'star' : 'rect') }); }
  }
  function coins(n, o = {}) {
    cols = cols || COLORS(); n = Math.round(n * (reduce ? 0.35 : 1));
    for (let i = 0; i < n; i++) add({ x: o.x != null ? o.x + rnd(-40, 40) : rnd(10, 530), y: o.y != null ? o.y : rnd(-300, -10), vx: rnd(-90, 90), vy: o.up ? -rnd(300, 700) : rnd(80, 280), g: 520, drag: 0.4, life: rnd(1.6, 3), size: rnd(7, 12), rot: rnd(0, 6), vr: rnd(-8, 8), c: cols[0], shape: Math.random() < 0.2 ? 'star' : 'coin' });
  }
  function confetti(n) {
    cols = cols || COLORS(); n = Math.round(n * (reduce ? 0.35 : 1));
    for (let i = 0; i < n; i++) add({ x: rnd(-20, 560), y: rnd(-200, -10), vx: rnd(-90, 90), vy: rnd(60, 260), g: 300, drag: 0.5, life: rnd(2, 3.6), size: rnd(7, 13), rot: rnd(0, 6), vr: rnd(-9, 9), c: cols[(Math.random() * cols.length) | 0], shape: 'rect' });
  }
  function ring(x, y, o = {}) {
    if (reduce) return; cols = cols || COLORS();
    for (let i = 0; i < (o.n || 2); i++) add({ shape: 'ring', x, y, r0: 10, r1: (o.r1 || 90) * (1 + i * 0.4), w: o.w || 8, c: cols[i % 2 ? 1 : 0], life: 0.55 + i * 0.12, dur: 0.55 + i * 0.12, vx: 0, vy: 0, g: 0, drag: 0, rot: 0, vr: 0, size: 0 });
  }
  function shake(amp, dur) {
    if (reduce) return; const el = document.getElementById('shake'), kf = [], N = 12;
    for (let i = 0; i < N; i++) { const k = 1 - i / N; kf.push({ transform: `translate(${rnd(-amp, amp) * k}px,${rnd(-amp, amp) * k}px)` }); }
    kf.push({ transform: 'none' }); el.animate(kf, { duration: dur, easing: 'linear' });
  }
  function flash(ms = 120, color = '#fff', peak = 0.7) {
    if (reduce) return; const d = document.createElement('div'); d.className = 'flash'; d.style.background = color; document.getElementById('stage').appendChild(d);
    d.animate([{ opacity: peak }, { opacity: 0 }], { duration: ms, easing: 'ease-out' }).finished.then(() => d.remove(), () => d.remove());
  }
  // (chris 10-06 FB5) first-use GPU cost: the canvas layer and its fill / stroke programs are created the first time a particle shows, which was a 50 ms frame at the first big win.
  // Show the canvas once at ~invisible opacity with one of every shape while the game loads (warm.js calls this).
  function warm() {
    if (raf || ps.length) return Promise.resolve(); if (!cv) init();
    cv.style.display = ''; cv.style.opacity = '.02'; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
    const c = COLORS(); g.save(); g.translate(120, 140); g.fillStyle = c[0]; star(30); g.restore();
    g.save(); g.globalAlpha = 0.6; g.strokeStyle = c[1]; g.lineWidth = 6; g.beginPath(); g.arc(300, 140, 40, 0, 7); g.stroke(); g.restore();
    g.save(); g.translate(120, 300); g.scale(0.6, 1); g.fillStyle = c[0]; g.beginPath(); g.arc(0, 0, 14, 0, 7); g.fill(); g.lineWidth = 3; g.strokeStyle = c[1]; g.stroke(); g.restore();
    g.save(); g.translate(300, 300); g.rotate(0.5); g.fillStyle = c[2] || c[0]; g.fillRect(-8, -5, 16, 10); g.restore();
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => { if (!raf && !ps.length) { stop(); } cv.style.opacity = ''; r(); }, 120)))));
  }
  CC.fx = { burst, coins, confetti, ring, shake, flash, clear, warm, count: () => ps.length, running: () => !!raf };
})();
