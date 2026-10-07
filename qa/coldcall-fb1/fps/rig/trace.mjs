// Turns a Chrome trace (array of trace events, microsecond clock) into per-window summaries. Runs on shaman so raw traces (30-100 MB) never travel.
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const SCRIPT = new Set(['FunctionCall', 'EvaluateScript', 'v8.compile', 'v8.run', 'v8.callFunction', 'EventDispatch', 'TimerFire', 'FireAnimationFrame', 'RunMicrotasks', 'MinorGC', 'MajorGC', 'ParseHTML', 'FireIdleCallback', 'v8.parseOnBackground']);
const STYLE = new Set(['UpdateLayoutTree', 'RecalculateStyles']), LAYOUT = new Set(['Layout']);
const PAINT = new Set(['PrePaint', 'Paint', 'Layerize', 'UpdateLayer', 'PaintImage', 'Decode Image', 'Decode LazyPixelRef', 'Draw LazyPixelRef', 'ImageDecodeTask']), COMMIT = new Set(['Commit', 'UpdateLayerTree', 'CompositeLayers', 'HitTest']);
const bucket = (n) => (n.startsWith('V8.GC') || n.startsWith('BlinkGC') || n.startsWith('V8.') ? 'script' : SCRIPT.has(n) ? 'script' : STYLE.has(n) ? 'style' : LAYOUT.has(n) ? 'layout' : PAINT.has(n) ? 'paint' : COMMIT.has(n) ? 'commit' : 'other');
const area = (c, cap) => { if (!c || c.length < 8) return 0; const xs = [c[0], c[2], c[4], c[6]], ys = [c[1], c[3], c[5], c[7]]; return Math.min(cap, (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys))); };   // clip is in layer space; an unbounded clip is capped at the viewport

export function index(events) {
  const names = new Map(), mainCand = new Map();
  for (const e of events) {
    if (e.ph === 'M' && e.name === 'thread_name') names.set(e.pid + ':' + e.tid, e.args.name);
    if (e.name === 'FireAnimationFrame' || e.name === 'FunctionCall') mainCand.set(e.pid + ':' + e.tid, (mainCand.get(e.pid + ':' + e.tid) || 0) + 1);
  }
  let main = null, mc = -1; for (const [k, v] of mainCand) if (names.get(k) === 'CrRendererMain' && v > mc) { main = k; mc = v; }
  const [mpid, mtid] = main ? main.split(':').map(Number) : [null, null];
  const gpuPid = [...names].find(([k, v]) => v === 'CrGpuMain'); 
  return { names, mpid, mtid, gpuPid: gpuPid ? +gpuPid[0].split(':')[0] : null, compTid: [...names].find(([k, v]) => v === 'Compositor' && +k.split(':')[0] === mpid) };
}

// win: [t0us, t1us] in the trace clock. opts.full: attribution detail (full-category trace); otherwise only the compositor frame summary.
export function summarize(events, ix, [w0, w1], opts = {}) {
  const wall = (w1 - w0) / 1000, out = { wallMs: +wall.toFixed(1) };
  // ---- compositor frames: PipelineReporter b/e pairs (BeginImplFrame -> presented), their state, and DroppedFrame markers
  const pb = new Map(), dur = [], states = {}; let dropped = 0, nframes = 0;
  for (const e of events) {
    if (e.name === 'DroppedFrame' && e.ts >= w0 && e.ts <= w1) dropped++;
    if (e.name !== 'PipelineReporter') continue;
    const k = e.pid + ':' + (e.id2 ? e.id2.local : e.id);
    if (e.ph === 'b') pb.set(k, e); else if (e.ph === 'e') { const b = pb.get(k); if (b && b.ts >= w0 && b.ts <= w1) { const st = b.args && b.args.frame_reporter && b.args.frame_reporter.state || '?'; states[st] = (states[st] || 0) + 1; nframes++; dur.push((e.ts - b.ts) / 1000); } pb.delete(k); }
  }
  out.compositor = { frames: nframes, pipelineMs: { p50: pct(dur, .5), p95: pct(dur, .95), worst: dur.length ? Math.max(...dur) : null, over16_7: dur.filter((x) => x > 16.7).length, over33: dur.filter((x) => x > 33).length }, states, droppedFrameMarkers: dropped };
  if (!opts.full) return out;

  const mainEv = events.filter((e) => e.pid === ix.mpid && e.tid === ix.mtid && e.ph === 'X' && e.ts >= w0 && e.ts <= w1).sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const ex = {}, exName = {}, fn = {}; let busy = 0; const stack = [];
  const pop = (until) => { while (stack.length && stack[stack.length - 1].end <= until) { const s = stack.pop(); const self = Math.max(0, s.dur - s.child); const b = s.name === 'RunTask' ? 'other' : bucket(s.name); ex[b] = (ex[b] || 0) + self; exName[s.name] = (exName[s.name] || 0) + self; if (s.name === 'FunctionCall') { const d = s.args && s.args.data || {}; const key = (d.functionName || '(anon)') + '@' + (d.url || '').split('/').pop() + ':' + d.lineNumber; if (!(d.functionName === 'loop' && !d.url)) fn[key] = (fn[key] || 0) + self; } if (stack.length) stack[stack.length - 1].child += s.dur; } };
  for (const e of mainEv) { pop(e.ts); if (e.name === 'RunTask' && !stack.length) busy += e.dur; stack.push({ name: e.name, dur: e.dur, end: e.ts + e.dur, child: 0, args: e.args }); }
  pop(Infinity);
  const r1 = (x) => +(x / 1000).toFixed(1);
  out.main = { busyMs: r1(busy), busyPct: +(100 * busy / (w1 - w0)).toFixed(1), selfMs: Object.fromEntries(Object.entries(ex).map(([k, v]) => [k, r1(v)])), topSelf: Object.entries(exName).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [k, r1(v)]), topFunctions: Object.entries(fn).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => [k, r1(v)]) };
  // layout / style volume and per-frame render phases (AnimationFrame::StyleAndLayout / Render async pairs)
  let lay = 0, dirty = 0, tot = 0, ult = 0, elc = 0, nult = 0; for (const e of mainEv) { if (e.name === 'Layout') { lay++; const b = e.args && e.args.beginData; if (b) { dirty += b.dirtyObjects || 0; tot += b.totalObjects || 0; } } if (e.name === 'UpdateLayoutTree') { nult++; elc += (e.args && e.args.elementCount) || 0; } }
  out.layout = { layouts: lay, avgDirtyObjects: lay ? +(dirty / lay).toFixed(1) : 0, avgTotalObjects: lay ? +(tot / lay).toFixed(0) : 0, styleRecalcs: nult, avgElementsRestyled: nult ? +(elc / nult).toFixed(1) : 0 };
  const ap = new Map(), phase = { 'AnimationFrame::StyleAndLayout': [], 'AnimationFrame::Render': [], 'AnimationFrame::Script': [] };
  for (const e of events) { if (!(e.name in phase) || e.pid !== ix.mpid) continue; const k = e.name + (e.id2 ? e.id2.local : e.id); if (e.ph === 'b') ap.set(k, e.ts); else if (e.ph === 'e' && ap.has(k)) { const t = ap.get(k); if (t >= w0 && t <= w1) phase[e.name].push((e.ts - t) / 1000); ap.delete(k); } }
  out.framePhases = Object.fromEntries(Object.entries(phase).map(([k, a]) => [k.replace('AnimationFrame::', ''), { n: a.length, p50: pct(a, .5), p95: pct(a, .95), worst: a.length ? Math.max(...a) : null }]));
  // raster + gpu process + compositor draw
  let rt = 0, rn = 0; const byLayer = {}; let gpu = 0, gn = 0, draw = 0;
  for (const e of events) { if (e.ph !== 'X' || e.ts < w0 || e.ts > w1) continue;
    if (e.name === 'RasterTask') { rt += e.dur; rn++; const l = e.args && e.args.tileData && e.args.tileData.layerId; byLayer[l] = (byLayer[l] || 0) + e.dur; }
    else if (e.name === 'GPUTask' && e.pid === ix.gpuPid) { gpu += e.dur; gn++; } }
  for (const e of events) if (e.name === 'DrawFrame' && e.ts >= w0 && e.ts <= w1) draw++;
  out.raster = { rasterTasks: rn, rasterThreadMs: r1(rt), perSecMs: +(rt / 1000 / (wall / 1000)).toFixed(1), topLayers: Object.entries(byLayer).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([l, v]) => [+l, r1(v)]) };
  out.gpuProcess = { tasks: gn, threadBusyMs: r1(gpu), perSecMs: +(gpu / 1000 / (wall / 1000)).toFixed(1), note: 'CrGpuMain thread time (command decode + submit), not shader/GPU-execution time' };
  out.drawFrames = draw;
  // paint events: where and how big
  const pa = {}; let pAll = 0, pn = 0; for (const e of mainEv) if (e.name === 'Paint') { const d = e.args && e.args.data || {}, a = area(d.clip, opts.vpArea || 1440 * 900), k = (d.nodeName || '?') + '#L' + d.layerId; pn++; pAll += a; const o = pa[k] || (pa[k] = { n: 0, area: 0, ms: 0 }); o.n++; o.area += a; o.ms += e.dur / 1000; }
  const vp = opts.vpArea || 1440 * 900;
  out.paint = { paintEvents: pn, paintedAreaPerSecInViewports: +(pAll / vp / (wall / 1000)).toFixed(2), top: Object.entries(pa).sort((a, b) => b[1].area - a[1].area).slice(0, 8).map(([k, v]) => ({ node: k, n: v.n, avgAreaPct: +(100 * v.area / v.n / vp).toFixed(1), ms: +v.ms.toFixed(1) })) };
  // animations that started inside the window (nodeName + CSS animation name)
  const an = {}; for (const e of events) if (e.name === 'Animation' && e.ph === 'b' && e.ts >= w0 && e.ts <= w1) { const d = e.args && e.args.data || {}; const k = (d.nodeName || '?') + ' :: ' + (d.displayName || d.name || '(waapi/transition)'); an[k] = (an[k] || 0) + 1; }
  out.animationsStarted = Object.entries(an).sort((a, b) => b[1] - a[1]).slice(0, 14);
  return out;
}

// Worst-frame autopsy: for each rAF gap >= minMs inside the window, what was the main thread doing, and was the GPU process / raster busy.
export function autopsy(events, ix, frames, minMs = 25, maxN = 6) {
  const bad = frames.filter((f) => f.dt >= minMs).sort((a, b) => b.dt - a.dt).slice(0, maxN), out = [];
  const main = events.filter((e) => e.pid === ix.mpid && e.tid === ix.mtid && e.ph === 'X');
  for (const f of bad) {
    const a = f.t0us, b = f.t1us, ov = main.filter((e) => e.ts < b && e.ts + e.dur > a);
    const busy = ov.filter((e) => e.name === 'RunTask').reduce((s, e) => s + Math.min(e.ts + e.dur, b) - Math.max(e.ts, a), 0);
    const big = ov.filter((e) => e.name !== 'RunTask' && e.dur >= 3000).sort((x, y) => y.dur - x.dur).slice(0, 6).map((e) => { const d = e.args && (e.args.data || e.args.beginData) || {}; return { name: e.name, ms: +(e.dur / 1000).toFixed(1), detail: e.name === 'FunctionCall' ? (d.functionName || '(anon)') + '@' + (d.url || '').split('/').pop() + ':' + d.lineNumber : e.name === 'Paint' ? (d.nodeName || '') + ' layer ' + d.layerId : e.name === 'UpdateLayoutTree' ? 'elements ' + (e.args && e.args.elementCount) : e.name === 'Layout' ? 'dirty ' + (d.dirtyObjects) + '/' + (d.totalObjects) : '' }; });
    const gpu = events.filter((e) => e.pid === ix.gpuPid && e.ph === 'X' && e.name === 'GPUTask' && e.ts < b && e.ts + e.dur > a), ras = events.filter((e) => e.name === 'RasterTask' && e.ph === 'X' && e.ts < b && e.ts + e.dur > a);
    const gpuEv = events.filter((e) => e.pid === ix.gpuPid && e.ph === 'X' && e.name !== 'GPUTask' && e.dur >= 2000 && e.ts < b && e.ts + e.dur > a).sort((x, y) => y.dur - x.dur).slice(0, 5).map((e) => `${e.name} ${(e.dur / 1000).toFixed(1)} ms`);
    const longTasks = ov.filter((e) => e.name === 'RunTask' && e.dur >= 20000).map((e) => +(e.dur / 1000).toFixed(1));
    out.push({ dtMs: +f.dt.toFixed(1), atMs: +f.at.toFixed(0), mainBusyMs: +(busy / 1000).toFixed(1), mainBusyPctOfGap: +(100 * busy / (b - a)).toFixed(0), mainLongTasksMs: longTasks, biggestMainEvents: big, gpuTopEvents: gpuEv, gpuMaxTaskMs: gpu.length ? +(Math.max(...gpu.map((e) => e.dur)) / 1000).toFixed(1) : 0, gpuBusyMs: +(gpu.reduce((s, e) => s + e.dur, 0) / 1000).toFixed(1), rasterMs: +(ras.reduce((s, e) => s + e.dur, 0) / 1000).toFixed(1), verdict: busy / (b - a) > 0.6 ? 'main thread' : (gpu.reduce((s, e) => s + e.dur, 0) / (b - a) > 0.4 ? 'GPU process' : 'main idle, GPU idle: waiting (presentation / vsync / GC pause outside tasks)') });
  }
  return out;
}
