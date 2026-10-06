// Evidence tables for OFFENDERS.md, built from the raw run (<tag>.json). Called by report.mjs. A hand-written reading goes in OFFENDERS-notes-<tag>.md (same folder) and is appended.
import fs from 'node:fs';
import path from 'node:path';
const f1 = (x) => (x == null ? '-' : typeof x === 'number' ? (Math.abs(x) >= 100 ? String(Math.round(x)) : String(+x.toFixed(1))) : String(x));
const tbl = (head, rows) => rows.length ? ['| ' + head.join(' | ') + ' |', '|' + head.map((h, i) => (i ? '---:' : ':---')).join('|') + '|', ...rows.map((r) => '| ' + r.map((c) => (c == null ? '-' : String(c).replace(/\|/g, '/'))).join(' | ') + ' |')].join('\n') : '_none found_';
const short = (u) => u.split('/').slice(-2).join('/').split('?')[0];

export function write(R, dir, tag) {
  const surveys = []; for (const [pn, arr] of Object.entries(R.passes)) for (const s of arr) if (s.survey) surveys.push({ pass: pn, key: s.key, ...s.survey });
  const main = surveys.filter((s) => s.vw === R.viewport.w);
  let md = `# COLD CALL FB5 offenders: ${tag}\n\nEvidence for where frame time and load time go, from ${tag}.json (${R.base}, ${R.viewport.w}x${R.viewport.h}, RTX 5090). Numbers are from this run; nothing here is from reading the code.\n\n`;

  // ---- 1. kill-switch experiments
  if (R.ablation && R.ablation.length) {
    md += `## 1. Kill-switch experiments (cause, not correlation)\n\nOne CSS rule injected after load, same seeded round, full trace. Cost columns: main thread busy %, raster-thread ms per second, GPU-process thread ms per second, painted area per second (screens). Lower than control = that property costs that much.\n\n`;
    for (const scene of ['idle', 'cascade']) { const rows = R.ablation.filter((a) => a.scene === scene && a.rows && a.rows[0] && a.rows[0].trace && a.rows[0].trace.main); const ctl = rows.find((a) => a.variant === 'control'); if (!ctl) continue;
      const c = ctl.rows[0].trace;
      md += `### ${scene}: ${ctl.rows[0].name}\n\n` + tbl(['variant', 'main busy %', 'raster ms/s', 'GPU-proc ms/s', 'painted screens/s', 'saved vs control: main % / raster ms/s / GPU ms/s'], rows.map((a) => { const t = a.rows[0].trace; return [a.variant, t.main.busyPct, f1(t.raster.perSecMs), f1(t.gpuProcess.perSecMs), t.paint.paintedAreaPerSecInViewports, a.variant === 'control' ? '' : `${f1(c.main.busyPct - t.main.busyPct)} / ${f1(c.raster.perSecMs - t.raster.perSecMs)} / ${f1(c.gpuProcess.perSecMs - t.gpuProcess.perSecMs)}`]; })) + '\n\n'; }
  }

  // ---- 2. running animations
  const an = new Map();
  for (const s of main) for (const a of s.anims || []) { const k = `${a.target} :: ${a.name} (${a.props.join(',') || '?'})`; const o = an.get(k) || { target: a.target, name: a.name, props: a.props, non: a.nonCompositor, n: 0, area: 0, dur: a.dur, iter: a.iter, scenes: new Set() }; o.n = Math.max(o.n, 1); o.area = Math.max(o.area, a.area); o.scenes.add(s.key); an.set(k, o); }
  // count simultaneous instances per scene (max over surveys)
  const maxInst = new Map(); for (const s of main) { const c = new Map(); for (const a of s.anims || []) { const k = `${a.target} :: ${a.name} (${a.props.join(',') || '?'})`; c.set(k, (c.get(k) || 0) + 1); } for (const [k, v] of c) maxInst.set(k, Math.max(maxInst.get(k) || 0, v)); }
  const A = [...an.entries()].map(([k, o]) => ({ ...o, k, inst: maxInst.get(k) || 1 })).sort((a, b) => (b.non.length > 0) - (a.non.length > 0) || b.area * b.inst - a.area * a.inst);
  md += `## 2. Animations running at survey time (document.getAnimations(), taken after each scene window)\n\nProperties Chrome can run on the compositor: transform, translate, rotate, scale, opacity, filter, backdrop-filter. Anything else (box-shadow, background-position, width/height/top/left, clip-path, colour...) animates on the main thread and repaints. \`filter\` is compositor-run but is re-rasterised on the GPU every frame for the whole element.\n\n`;
  md += tbl(['element :: animation', 'animated properties', 'main-thread (non-compositor) properties', 'duration ms / iterations', 'area px (largest)', 'simultaneous instances (max)', 'seen in'], A.slice(0, 25).map((o) => [o.target + ' :: ' + o.name, o.props.join(', '), o.non.join(', ') || '-', `${f1(o.dur)} / ${o.iter}`, o.area, o.inst, [...o.scenes].join(', ')])) + '\n\n';

  // ---- 3. expensive static styles
  const sty = new Map();
  for (const s of main) for (const e of s.styled || []) for (const [prop, val] of [['filter', e.filter], ['backdrop-filter', e.backdrop], ['will-change', e.willChange], ['mix-blend-mode', e.blend], ['box-shadow', e.boxShadow], ['text-shadow', e.textShadow], ['mask', e.mask], ['clip-path', e.clip]]) { if (!val) continue; const k = e.sel + ' | ' + prop; const o = sty.get(k) || { sel: e.sel, prop, val, n: 0, area: 0 }; o.area = Math.max(o.area, e.area); sty.set(k, o); }
  const inst = new Map(); for (const s of main) { const c = new Map(); for (const e of s.styled || []) for (const [prop, val] of [['filter', e.filter], ['backdrop-filter', e.backdrop], ['will-change', e.willChange], ['mix-blend-mode', e.blend], ['box-shadow', e.boxShadow], ['text-shadow', e.textShadow], ['mask', e.mask], ['clip-path', e.clip]]) if (val) c.set(e.sel + ' | ' + prop, (c.get(e.sel + ' | ' + prop) || 0) + 1); for (const [k, v] of c) inst.set(k, Math.max(inst.get(k) || 0, v)); }
  const WEIGHT = { 'backdrop-filter': 6, filter: 4, 'mix-blend-mode': 3, mask: 3, 'box-shadow': 2, 'will-change': 1.5, 'clip-path': 1.5, 'text-shadow': 1 };
  const S = [...sty.entries()].map(([k, o]) => ({ ...o, inst: inst.get(k) || 1, score: o.area * (inst.get(k) || 1) * (WEIGHT[o.prop] || 1) })).sort((a, b) => b.score - a.score);
  md += `## 3. Costly static styles on visible elements (computed style of every visible element)\n\nScore = largest area x simultaneous instances x a rough weight (backdrop-filter 6, filter 4, blend/mask 3, box-shadow 2, will-change 1.5). Only a ranking aid; section 1 and 4 say what it actually costs.\n\n`;
  md += tbl(['element', 'property', 'value', 'largest area px', 'instances (max)'], S.slice(0, 22).map((o) => [o.sel, o.prop, o.val.slice(0, 90), o.area, o.inst])) + '\n\n';

  // ---- 4. layers + repaint
  const prof = R.passes.profile_1x || R.passes.profile_1x_first || [];
  const L = prof.filter((s) => s.layers && s.layers.layers).map((s) => [s.key, s.layers.layers, s.layers.drawing, `${s.layers.drawingAreaMpx} / ${s.layers.rootAreaMpx} = ${s.layers.rootAreaMpx ? (s.layers.drawingAreaMpx / s.layers.rootAreaMpx).toFixed(1) + 'x' : '?'}`, (s.layers.top || []).slice(0, 8).map((l) => `${l.sel || 'node ' + l.node} ${l.w}x${l.h}${l.reasons && l.reasons.length ? ' [' + l.reasons.join(',') + ']' : ''}`).join('; ')]);
  md += `## 4. Compositor layers (CDP LayerTree, mid-scene snapshot) and repaint\n\n` + tbl(['scene', 'layers', 'drawing layers', 'drawing area Mpx / root layer Mpx = overdraw', 'largest layers [compositing reasons]'], L) + '\n\n';
  const P = []; for (const s of prof) for (const r of s.rows || []) if (r.trace && r.trace.paint) for (const t of r.trace.paint.top.slice(0, 3)) P.push([s.key + ': ' + r.name.trim().slice(0, 40), t.node, t.n, t.avgAreaPct + '%', t.ms]);
  md += `Paint events (main thread, per window, top 3 by painted area; area as % of the viewport; layer L0 is the root layer, so a hit there means the whole page content below it was repainted rather than one composited layer):\n\n` + tbl(['window', 'node painted', 'times', 'avg area per paint', 'paint ms total'], P) + '\n\n';
  const AS = []; for (const s of prof) for (const r of s.rows || []) if (r.trace && r.trace.animationsStarted && r.trace.animationsStarted.length) AS.push([s.key + ': ' + r.name.trim().slice(0, 40), r.trace.animationsStarted.slice(0, 6).map(([k, n]) => `${k} x${n}`).join('; ')]);
  md += `Animations that started inside each window (trace):\n\n` + tbl(['window', 'started (element :: css animation name x count)'], AS) + '\n\n';
  const FN = []; for (const s of prof) for (const r of s.rows || []) if (r.trace && r.trace.main && r.trace.main.topFunctions.length) FN.push([s.key + ': ' + r.name.trim().slice(0, 40), r.trace.main.topFunctions.slice(0, 4).map(([f, ms]) => `${f} ${ms} ms`).join('; ')]);
  md += `Top script functions by self time (FunctionCall, rig loop excluded):\n\n` + tbl(['window', 'functions'], FN) + '\n\n';

  // ---- 5. images
  const use = new Map();
  for (const s of surveys) for (const i of s.imgs || []) { if (!i.nw) continue; const o = use.get(i.url) || { url: i.url, nw: i.nw, nh: i.nh, w: 0, h: 0, sels: new Set(), kind: i.kind, vp: '' }; const w = i.w, h = i.h; if (Math.max(w, h) > Math.max(o.w, o.h)) { o.w = w; o.h = h; o.vp = `${s.vw}x${s.vh}`; } /* css px */ o.sels.add(i.sel); use.set(i.url, o); }
  const enc = {}; if (R.firstLoad) for (const r of R.firstLoad.cold.resources) enc[r.url.split('?')[0]] = r.enc;
  const IM = [...use.values()].map((o) => { const need = Math.max(o.w, o.h) * 2 / Math.max(o.nw, o.nh); const ratio = Math.max(o.nw, o.nh) / (Math.max(o.w, o.h) * 2 || 1); return { ...o, ratio, wasteMB: ratio > 1 ? (o.nw * o.nh * 4 * (1 - 1 / (ratio * ratio))) / 1048576 : 0, kb: Math.round((enc[o.url.split('?')[0]] || 0) / 1024) }; }).sort((a, b) => b.wasteMB - a.wasteMB);
  const over = IM.filter((o) => o.ratio > 1.25);
  md += `## 5. Image sizes versus on-screen size x2 (largest on-screen use across all surveyed states, in CSS px; x2 = a 2x display)\n\nA file is "oversized" when its pixel size is more than 1.25x the larger on-screen side x2. Wasted decoded memory = RGBA bytes beyond what the display size x2 needs (this is texture memory and decode time, not download bytes).\n\n`;
  md += `${over.length} of ${IM.length} images are oversized; total wasted decoded memory ${f1(over.reduce((a, o) => a + o.wasteMB, 0))} MB of ${f1(IM.reduce((a, o) => a + o.nw * o.nh * 4 / 1048576, 0))} MB decoded.\n\n`;
  md += tbl(['file', 'file px', 'largest on screen, css px (viewport)', 'x2 target', 'ratio', 'wasted decoded MB', 'file KB', 'used by'], over.slice(0, 20).map((o) => [short(o.url), `${o.nw}x${o.nh}`, `${Math.round(o.w)}x${Math.round(o.h)} (${o.vp})`, `${Math.round(o.w * 2)}x${Math.round(o.h * 2)}`, f1(o.ratio) + 'x', f1(o.wasteMB), o.kb, [...o.sels].slice(0, 3).join(', ')])) + '\n\n';
  const under = IM.filter((o) => o.ratio < 0.7); md += under.length ? `Soft (file smaller than on-screen x2): ${under.slice(0, 8).map((o) => `${short(o.url)} ${o.nw}x${o.nh} shown ${Math.round(o.w)}x${Math.round(o.h)}`).join('; ')}.\n\n` : '';
  const png = R.firstLoad ? R.firstLoad.cold.resources.filter((r) => /\.(png|jpe?g|gif|bmp)(\?|$)/i.test(r.url)) : [];
  md += `Non-WebP raster files loaded: ${png.length ? png.map((r) => `${short(r.url)} ${Math.round(r.enc / 1024)} KB`).join(', ') : 'none (everything raster is already WebP)'}.\n\n`;

  // ---- 6. first load
  if (R.firstLoad) { const c = R.firstLoad.cold; const big = [...c.resources].sort((a, b) => b.enc - a.enc);
    md += `## 6. First-load weight and time to first spin (tailnet)\n\nCold: ${c.requests} requests, ${c.transferKB} KB over the wire (${c.bodyKB} KB bodies, ${c.decodedKB} KB decoded; identical, so nothing is compressed in transit), game ready at ${c.readyAtMs} ms, last byte ${c.lastByteMs} ms, first spin ${c.firstSpin.firstSpinMs} ms. Warm reload: ${R.firstLoad.warm.requests} requests, ${R.firstLoad.warm.transferKB} KB, ready ${R.firstLoad.warm.readyAtMs} ms.\n\n`;
    md += tbl(['type', 'files', 'KB'], Object.entries(c.byType).map(([k, v]) => [k, v.n, v.bodyKB])) + '\n\nLargest 12:\n\n' + tbl(['file', 'KB', 'start ms', 'end ms'], big.slice(0, 12).map((r) => [short(r.url), Math.round(r.enc / 1024), r.start, r.end])) + '\n\n';
    const txt = c.resources.filter((r) => /\.(js|css|json|html)(\?|$)/.test(r.url)).reduce((a, r) => a + r.enc, 0); md += `Text assets (js, css, json, html) sent uncompressed: ${Math.round(txt / 1024)} KB (a gzip/brotli pass typically takes 70-75% off these). Cache headers: ${Object.entries(c.headers).map(([k, v]) => `${k} ${v.cacheControl}`).join('; ')}: max-age=0 means every return visit revalidates every file (${R.firstLoad.warm.requests} requests, ${R.firstLoad.warm.transferKB} KB on a warm reload).\n\n`; }

  const notes = path.join(dir, `OFFENDERS-notes-${tag}.md`);
  if (fs.existsSync(notes)) md += '\n' + fs.readFileSync(notes, 'utf8');
  const out = path.join(dir, tag === 'before' ? 'OFFENDERS.md' : `OFFENDERS-${tag}.md`);
  fs.writeFileSync(out, md); console.log('wrote', out);
}
