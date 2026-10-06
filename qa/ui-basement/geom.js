// Geometry check, run inside the page: overlaps between the table pieces that must not cover each other, and controls outside the viewport.
(() => {
  const R = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return null; return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
  const vis = (e) => { const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0; };
  const inter = (a, b) => { if (!a || !b) return 0; const w = Math.min(a.r, b.r) - Math.max(a.l, b.l), h = Math.min(a.b, b.b) - Math.max(a.t, b.t); return w > 0 && h > 0 ? Math.round(w * h) : 0; };
  const named = {};
  const add = (k, e) => { if (!e) return; const r = vis(e) ? R(e) : null; if (r) named[k] = r; };
  const hero = document.querySelector('.seat.hero .seat-pill') || document.querySelector('.seat.me .seat-pill');
  add('heroCards', document.getElementById('hole-cards')); if (hero) add('heroPlate', hero);
  add('pot', document.querySelector('#pot-row .pot-txt')); add('board', document.getElementById('community-cards'));
  add('handLabel', document.getElementById('my-hand-label')); add('emotes', document.getElementById('emote-strip'));
  add('actionBar', document.getElementById('action-bar')); add('head', document.querySelector('.g-head'));
  document.querySelectorAll('#player-seats .seat .seat-pill').forEach((e, i) => { if (e !== hero) add('seat' + i, e); });
  const pairs = [['heroCards', 'heroPlate'], ['pot', 'heroPlate'], ['pot', 'board'], ['handLabel', 'heroCards'], ['emotes', 'head']];
  Object.keys(named).filter((k) => /^seat/.test(k)).forEach((k) => { pairs.push([k, 'pot'], [k, 'heroPlate'], [k, 'board'], [k, 'emotes']); });
  const ov = pairs.map(([a, b]) => ({ a, b, px: inter(named[a], named[b]) })).filter((x) => x.px > 40);
  // seat plates against each other
  const ks = Object.keys(named).filter((k) => /^seat/.test(k)).concat(named.heroPlate ? ['heroPlate'] : []);
  for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) { const px = inter(named[ks[i]], named[ks[j]]); if (px > 40) ov.push({ a: ks[i], b: ks[j], px }); }
  const W = innerWidth, H = innerHeight, off = [];
  document.querySelectorAll('button, input, a[href], [role=button]').forEach((e) => {
    if (!vis(e) || e.closest('[hidden], .hidden')) return; const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
    let hid = false; for (let a = e.parentElement; a; a = a.parentElement) { const s = getComputedStyle(a); if (s.visibility === 'hidden' || s.display === 'none') { hid = true; break; } } if (hid) return;
    if (r.right > W + 1 || r.left < -1 || r.bottom > H + 1 || r.top < -1) off.push((e.id || e.className || e.tagName).toString().slice(0, 36) + ' [' + Math.round(r.left) + ',' + Math.round(r.top) + ',' + Math.round(r.right) + ',' + Math.round(r.bottom) + ']');
  });
  const small = []; document.querySelectorAll('button, input, [role=button]').forEach((e) => { if (!vis(e)) return; const r = e.getBoundingClientRect(); if (r.width > 1 && r.height > 1 && (r.width < 32 || r.height < 32) && !e.closest('#player-seats, .hidden, [hidden]')) small.push((e.id || e.className || e.tagName).toString().slice(0, 30) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); });
  return { overlaps: ov, offscreen: off, smallTargets: small, rects: named, vw: W, vh: H };
})()
