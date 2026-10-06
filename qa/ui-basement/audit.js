// Legibility audit, run inside the page: smallest text and contrast of every visible text node.
// Returns {small: [...], low: [...], img: n, n: total}. Backgrounds with an image (painted plates) cannot be measured and are counted in `img`.
(() => {
  const ACT = '#action-bar, #raise-box, #bust-panel, #wait-panel, #show-panel, .seat, #bar-status, #host-drawer, .lb-modal, .toast, #bank-panel, .adm-dlg';
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const over = (top, bot) => { const a = top.a + bot.a * (1 - top.a); if (!a) return { r: 0, g: 0, b: 0, a: 0 }; return { r: (top.r * top.a + bot.r * bot.a * (1 - top.a)) / a, g: (top.g * top.a + bot.g * bot.a * (1 - top.a)) / a, b: (top.b * top.a + bot.b * bot.a * (1 - top.a)) / a, a }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c.r) + .7152 * f(c.g) + .0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const layerOf = (cs) => {
    const bi = cs.backgroundImage; let l = parse(cs.backgroundColor) || { r: 0, g: 0, b: 0, a: 0 };
    if (bi && bi !== 'none') {
      if (/url\(/.test(bi)) return { img: true };
      const cols = (bi.match(/rgba?\([^)]+\)/g) || []).map(parse).filter(Boolean);
      if (cols.length) { const n = cols.length, avg = { r: 0, g: 0, b: 0, a: 0 }; cols.forEach((c) => { avg.r += c.r / n; avg.g += c.g / n; avg.b += c.b / n; avg.a += c.a / n; }); l = over(avg, l); }
    }
    return l;
  };
  const out = { small: [], low: [], img: 0, n: 0 };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const t = walker.currentNode; if (!/\S/.test(t.nodeValue)) continue;
    const e = t.parentElement; if (!e || seen.has(e)) continue; seen.add(e);
    if (e.closest('script,style,svg,#toasts:empty') || e.closest('[hidden],.hidden')) continue;
    const cs = getComputedStyle(e), r = e.getBoundingClientRect();
    if (cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity === 0 || r.width < 2 || r.height < 2) continue;
    if (r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight) continue;
    if (e.closest('.pj-layer, .deal-layer, .emote-float, .win-float, .confetti-particle, .floating-sticker, .sh-xpfloat')) continue;
    // an ancestor with opacity 0 (fade-in screens, closed drawers) is not visible either
    let hidden = false; for (let a = e; a && a !== document.body; a = a.parentElement) { const s = getComputedStyle(a); if (+s.opacity === 0 || s.visibility === 'hidden') { hidden = true; break; } } if (hidden) continue;
    out.n++;
    const fs = parseFloat(cs.fontSize), name = (e.id ? '#' + e.id : '') + '.' + String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className).split(/\s+/).filter(Boolean).slice(0, 3).join('.');
    const txt = t.nodeValue.trim().slice(0, 28);
    const act = !!e.closest(ACT), need = act ? 12 : 11;
    if (fs < need - 0.05) out.small.push({ name, fs: +fs.toFixed(1), need, txt });
    if (e.closest('button:disabled, [aria-disabled="true"], .act:disabled')) continue;
    // background: composite ancestors, bottom up
    let fg = parse(cs.color) || { r: 255, g: 255, b: 255, a: 1 }, layers = [], img = false;
    for (let a = e; a; a = a.parentElement) { const l = layerOf(getComputedStyle(a)); if (l.img) { img = true; break; } layers.push(l); if (l.a >= .999) break; }
    if (img) { out.img++; continue; }
    let bg = { r: 11, g: 7, b: 5, a: 1 }; for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    fg = over({ r: fg.r, g: fg.g, b: fg.b, a: fg.a * (+cs.opacity || 1) }, bg);
    const cr = ratio(fg, bg);
    if (cr < 4.5) out.low.push({ name, cr: +cr.toFixed(2), fs: +fs.toFixed(1), txt });
  }
  return out;
})()
