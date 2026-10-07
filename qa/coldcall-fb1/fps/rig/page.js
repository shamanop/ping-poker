// Injected before any page script (Page.addScriptToEvaluateOnNewDocument). Records, on performance.now()'s timeline:
//   F  per-frame rAF: [frame start t, delta to the previous frame start, ms from frame start to our callback running]
//   LT long tasks (>50 ms), LOAF long-animation-frames (>50 ms, with script / render / style+layout split), marks (scene windows)
// and replaces crypto.getRandomValues with a seeded generator so practice rounds (rounds are seeded from it) repeat run to run.
(() => {
  if (window.__fb5) return;
  let s = (__SEED__ >>> 0) || 1; const next = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0); };
  const grv = crypto.getRandomValues.bind(crypto);
  crypto.getRandomValues = function (a) { if (window.__fb5 && window.__fb5.queue.length && a instanceof Uint32Array && a.length === 1) { a[0] = window.__fb5.queue.shift() >>> 0; return a; } if (a && a.BYTES_PER_ELEMENT && !(a instanceof Float32Array) && !(a instanceof Float64Array)) { for (let i = 0; i < a.length; i++) a[i] = next() & (a.BYTES_PER_ELEMENT === 4 ? 0xffffffff : (1 << (8 * a.BYTES_PER_ELEMENT)) - 1); return a; } return grv(a); };
  const R = (window.__fb5 = { F: new Float64Array(3 * 200000), n: 0, LT: [], LOAF: [], marks: [], on: true, queue: [] });   // queue: seeds handed to the next practice round(s), so a scene can ask for a specific kind of round
  let last = 0;
  const loop = (t) => { const now = performance.now(); if (last && R.n < R.F.length) { R.F[R.n++] = t; R.F[R.n++] = t - last; R.F[R.n++] = now - t; } last = t; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  const rd = setInterval(() => { if (window.CC && CC.ready) { R.readyAt = performance.now(); clearInterval(rd); } }, 10);   // ms since navigation start when the game is ready (assets decoded, SPIN usable)
  R.mark = (name) => { const t = performance.now(); R.marks.push([name, t]); return t; };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) R.LT.push([e.startTime, e.duration, (e.attribution && e.attribution[0] && e.attribution[0].containerType) || '']); }).observe({ type: 'longtask', buffered: true }); } catch (e) { R.noLT = String(e); }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) R.LOAF.push({ s: e.startTime, d: e.duration, rs: e.renderStart, sl: e.styleAndLayoutStart, b: e.blockingDuration, sc: (e.scripts || []).map((x) => [x.invokerType, x.invoker, (x.sourceURL || '').split('/').pop(), x.sourceFunctionName, +x.duration.toFixed(1), +(x.forcedStyleAndLayoutDuration || 0).toFixed(1)]) }); }).observe({ type: 'long-animation-frame', buffered: true }); } catch (e) { R.noLOAF = String(e); }
  R.take = (t0, t1) => { const F = []; for (let i = 0; i < R.n; i += 3) if (R.F[i] >= t0 && R.F[i] <= t1) F.push([R.F[i], R.F[i + 1], R.F[i + 2]]); return { F, LT: R.LT.filter((x) => x[0] + x[1] >= t0 && x[0] <= t1), LOAF: R.LOAF.filter((x) => x.s + x.d >= t0 && x.s <= t1) }; };
})();
