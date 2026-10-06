// Runs ON SHAMAN (node 24, no dependencies). Launches Chrome on the real GPU in Chris's interactive session, verifies the renderer, drives the COLD CALL scenes
// in-page and writes <out>/result.json. Usage: node drive.mjs <args.json>   (called by ../run.mjs over ssh)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { CDP, newPage, sleep } from './cdp.mjs';
import { launchChrome } from './launch.mjs';
import { index as traceIndex, summarize, autopsy } from './trace.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const A = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ROOT = 'E:\\bricklord-test\\coldcall-fb5';
if (!/^E:\\bricklord-test\\coldcall-fb5\\/i.test(path.resolve(HERE) + '\\') && !/^E:/i.test(HERE)) throw new Error('refusing to run outside E:\\bricklord-test\\coldcall-fb5 (shaman C: is never written): ' + HERE);
const OUT = path.join(ROOT, 'runs', A.tag, 'out'); fs.mkdirSync(OUT, { recursive: true });
const t00 = Date.now(), log = (...a) => console.log(`[shaman +${((Date.now() - t00) / 1000).toFixed(0)}s]`, ...a);
const pageJs = fs.readFileSync(path.join(HERE, 'page.js'), 'utf8'), scenesJs = fs.readFileSync(path.join(HERE, 'scenes.js'), 'utf8');
const vp = A.vp || [1440, 900], dpr = A.dpr || 0;   // dpr 0 = the display's native scale (shaman's 4K panel runs at 150%: what Chris's own Chrome uses); --dpr N forces N
const BAD = /swiftshader|warp|llvmpipe|basic render|software|mesa offscreen|microsoft basic/i;

// ---------------------------------------------------------------- stats
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const r2 = (x) => (x == null ? null : +x.toFixed(2));
function frameStats(F, wins) {   // F: [[t, dt, lag]] ; wins: [[t0,t1]]. A frame counts when the previous frame was also inside the window (its delta is entirely inside)
  const dt = [], lag = []; let wall = 0;
  for (const [t0, t1] of wins) { wall += t1 - t0; for (const [t, d, l] of F) if (t > t0 && t <= t1 && t - d >= t0 - 0.5) { dt.push(d); lag.push(l); } }
  const sum = dt.reduce((a, b) => a + b, 0);
  return { frames: dt.length, wallMs: Math.round(wall), fps: r2(dt.length / (wall / 1000)), p50: r2(pct(dt, .5)), p95: r2(pct(dt, .95)), p99: r2(pct(dt, .99)), worst: r2(dt.length ? Math.max(...dt) : null), mean: r2(sum / Math.max(1, dt.length)),
    over16_7: dt.filter((x) => x > 16.7).length, over20: dt.filter((x) => x > 20).length, over25: dt.filter((x) => x >= 25).length, over33: dt.filter((x) => x > 33).length, over50: dt.filter((x) => x > 50).length, cbLagP95: r2(pct(lag, .95)), cbLagWorst: r2(lag.length ? Math.max(...lag) : null) };
}
const longStats = (LT, LOAF, wins) => { const inW = (s, d) => wins.some(([a, b]) => s + d >= a && s <= b); const lt = LT.filter((x) => inW(x[0], x[1])), lf = LOAF.filter((x) => inW(x.s, x.d));
  return { longtasks: lt.length, longtaskMs: Math.round(lt.reduce((a, x) => a + x[1], 0)), longtaskWorst: Math.round(Math.max(0, ...lt.map((x) => x[1]))), loaf: lf.length, loafMs: Math.round(lf.reduce((a, x) => a + x.d, 0)), loafWorst: Math.round(Math.max(0, ...lf.map((x) => x.d))),
    loafSplit: lf.length ? { scriptMs: Math.round(lf.reduce((a, x) => a + x.sc.reduce((p, s) => p + s[4], 0), 0)), styleLayoutMs: Math.round(lf.reduce((a, x) => a + (x.sl ? x.s + x.d - x.sl : 0), 0)), renderMs: Math.round(lf.reduce((a, x) => a + (x.rs ? x.s + x.d - x.rs : 0), 0)) } : null,
    loafScripts: lf.flatMap((x) => x.sc).sort((a, b) => b[4] - a[4]).slice(0, 5) }; };

// ---------------------------------------------------------------- browser + gpu check
let L, cdp, exitCode = 0; const sessions = [];
// one Chrome process = one session with a fresh profile (so the first pass of a session meets cold GPU shader / decode caches, the way a new player does)
const smi = () => { try { return execFileSync('nvidia-smi', ['--query-gpu=utilization.gpu,memory.used,power.draw,clocks.sm', '--format=csv,noheader'], { encoding: 'utf8' }).trim(); } catch (e) { return 'n/a'; } };
async function startSession(label, lo = {}) {
  const gpuBefore = smi();
  L = await launchChrome({ root: ROOT, tag: A.tag, headful: !!A.headful, vp, ...lo }); cdp = await CDP.connect(L.ws);
  const si = await cdp.send('SystemInfo.getInfo'), aux = si.gpu.auxAttributes || {}, fs_ = si.gpu.featureStatus || {};
  const gpu = { session: label, nvidiaSmiBeforeLaunch: gpuBefore, chrome: L.ver.Browser, headful: !!A.headful, windowParkedOffscreen: !!A.headful, glRenderer: aux.glRenderer, glVendor: aux.glVendor, devices: si.gpu.devices.map((d) => d.deviceString + ' ' + d.driverVersion), gpuCompositing: fs_.gpu_compositing, rasterization: fs_.rasterization, webgl: fs_.webgl };
  const probe = await newPage(cdp); await probe.send('Runtime.enable');
  gpu.pageWebglRenderer = await probe.eval(`(()=>{const gl=document.createElement('canvas').getContext('webgl2');if(!gl)return null;const e=gl.getExtension('WEBGL_debug_renderer_info');return e?gl.getParameter(e.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)})()`);
  await cdp.send('Target.closeTarget', { targetId: probe.targetId });
  fs.writeFileSync(path.join(OUT, 'renderer.json'), JSON.stringify(gpu, null, 1));
  const want = new RegExp(A.gpuRe || 'RTX 5090', 'i');
  if (!gpu.pageWebglRenderer || BAD.test(gpu.pageWebglRenderer) || !want.test(gpu.pageWebglRenderer + ' ' + (gpu.glRenderer || '')) || !/enabled/.test(gpu.gpuCompositing || '') || !/enabled/.test(gpu.rasterization || '')) {
    fs.writeFileSync(path.join(OUT, 'renderer-FAIL.json'), JSON.stringify(gpu, null, 1)); log('!!!! NOT THE REAL GPU, REFUSING:', JSON.stringify(gpu)); exitCode = 3; throw new Error('renderer check failed');
  }
  log('session', label, 'nvidia-smi before launch (util %, MiB, W, MHz):', gpuBefore);
  log('session', label, 'renderer OK:', gpu.pageWebglRenderer, '| gpu_compositing', gpu.gpuCompositing, '| rasterization', gpu.rasterization, '|', gpu.chrome, A.headful ? 'headful off-screen' : 'headless=new');
  sessions.push(gpu); return gpu;
}
try {
  // ---------------------------------------------------------------- page helpers
  const SC = {
    idle: { url: '?nosplash', fn: 'idle', title: 'idle 10 s' },
    spins10: { url: '?nosplash', fn: 'spins10', title: '10 normal spins' },
    cascade: { url: '?nosplash', fn: 'cascade', title: 'cascade win (seeded round, 4+ cascades, no bonus)' },
    bigwin: { url: '?nosplash', fn: 'bigwin', title: 'big win to the big-win card (seeded round, no bonus)' },
    intro: { url: '?nosplash&force=bonus1', fn: 'intro', title: 'bonus intro (force=bonus1)' },
    bought: { url: '?nosplash', fn: 'bought', title: 'buy menu + full bought bonus' },
    more: { url: '?nosplash&mock=pull&state=more', fn: 'more', title: 'ONE MORE CALL prompt (mock=pull)' },
    pick: { url: '?nosplash&mock=pull&state=pick', fn: 'pick', title: 'PICK YOUR LEAD prompt (mock=pull)' },
    pullIdle: { url: '?nosplash&mock=pull&state=idle', fn: 'pullIdle', title: 'leads strip + feed (mock=pull idle)' },
    info: { url: '?nosplash&shot=info', fn: 'info', title: 'info screen' },
  };
  const sceneList = (A.scenes && A.scenes.length ? A.scenes : Object.keys(SC)).filter((k) => SC[k]);
  const idxUrl = A.base.split('?')[0], dirUrl = idxUrl.replace(/[^/]*$/, '');   // A.base is the game's index.html
  async function open(url, { throttle = 1, size = vp, dpr_ = dpr, css = '', cache = true } = {}) {
    const pg = await newPage(cdp);
    for (const d of ['Page', 'Runtime', 'Performance', 'Network']) await pg.send(d + '.enable');
    await pg.send('Network.setCacheDisabled', { cacheDisabled: !cache });
    await pg.send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: dpr_, mobile: false });
    if (throttle !== 1) await pg.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    await pg.send('Page.addScriptToEvaluateOnNewDocument', { source: pageJs.replace('__SEED__', String(A.seed || 12345)) });
    const errs = []; pg.on('Runtime.exceptionThrown', (p) => errs.push((p.exceptionDetails.exception && p.exceptionDetails.exception.description || p.exceptionDetails.text).slice(0, 300)));
    pg.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') errs.push('console.error: ' + p.args.map((a) => a.value || a.description).join(' ').slice(0, 300)); });
    const load = new Promise((r) => { const off = pg.on('Page.loadEventFired', () => { off(); r(); }); });
    await pg.send('Page.navigate', { url: idxUrl + url }); await load;
    await pg.eval(`new Promise((res,rej)=>{const t0=performance.now();const i=setInterval(()=>{if(window.CC&&CC.ready){clearInterval(i);res()}else if(performance.now()-t0>90000){clearInterval(i);rej(new Error('CC.ready timeout'))}},20)})`);
    if (css) await pg.eval(`(()=>{const s=document.createElement('style');s.id='fb5abl';s.textContent=${JSON.stringify(css)};document.head.appendChild(s)})()`);
    pg.errs = errs; return pg;
  }
  const close = (pg) => cdp.send('Target.closeTarget', { targetId: pg.targetId }).catch(() => {});
  const metrics = async (pg) => Object.fromEntries((await pg.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  async function trace(pg, mode, fn) {   // mode 'light' (compositor frames only) | 'full' (attribution)
    const events = []; const off = cdp.listen('Tracing.dataCollected', (p) => { for (const e of p.value) events.push(e); });
    const cats = mode === 'full' ? ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'cc', 'benchmark', 'viz', 'gpu', 'blink.animations', 'blink.user_timing', 'rail']
      : ['disabled-by-default-devtools.timeline.frame', 'blink.user_timing'];
    await cdp.send('Tracing.start', { traceConfig: { includedCategories: cats, recordMode: 'recordAsMuchAsPossible' }, transferMode: 'ReportEvents' });
    const align = await pg.eval(`(()=>{performance.mark('fb5:align');return performance.getEntriesByName('fb5:align').pop().startTime})()`);
    let r, err; try { r = await fn(); } catch (e) { err = e; }
    const done = new Promise((res) => { const o2 = cdp.listen('Tracing.tracingComplete', () => { o2(); res(); }); });
    await cdp.send('Tracing.end'); await done; off();
    if (err) throw err;
    const al = events.find((e) => e.name === 'fb5:align'); const offset = al ? al.ts - align * 1000 : null;
    return { r, events, offset };
  }

  // ---------------------------------------------------------------- one scene
  async function runScene(key, { throttle = 1, mode = 'timing', css = '', size = vp, dpr_ = dpr, survey = false, layers = true } = {}) {
    const sc = SC[key], pg = await open(sc.url, { throttle, size, dpr_, css });
    try {
      await pg.eval(scenesJs); await sleep(2500 * (throttle > 1 ? 1.5 : 1));
      const m0 = await metrics(pg), tw0 = Date.now();
      const run = () => pg.eval(`__fb5scenes.S.${sc.fn}()`);
      const tr = mode === 'timing' ? await trace(pg, 'light', run) : mode === 'profile' ? await trace(pg, 'full', run) : { r: await run(), events: null };
      const res = tr.r, m1 = await metrics(pg), wallS = (Date.now() - tw0) / 1000;
      const raw = await pg.eval(`JSON.stringify(__fb5.take(0, 1e12))`).then(JSON.parse);
      const wins = res.win.map(([n, t0, t1]) => ({ name: n, t0, t1 }));
      const groups = {}; for (const w of wins) { const g = (res.group && /^spin \d+$|^full bought bonus/.test(w.name) ? res.group : null); if (g) (groups[g] = groups[g] || []).push(w); }
      const rows = [];
      for (const w of wins) if (!(res.group && /^spin \d+$/.test(w.name))) rows.push({ name: w.name, wins: [w] });
      for (const [g, ws] of Object.entries(groups)) if (g === res.group && /^spin/.test(ws[0].name)) rows.unshift({ name: g, wins: ws });
      const out = { key, title: sc.title, throttle, mode, dprActual: await pg.eval('devicePixelRatio'), wallS: +wallS.toFixed(1), errors: pg.errs.slice(0, 5), ph: res.ph || null, info: res.info || null, rows: [] };
      for (const row of rows) {
        const wl = row.wins.map((w) => [w.t0, w.t1]);
        const o = { name: row.name, ...frameStats(raw.F, wl), ...longStats(raw.LT, raw.LOAF, wl) };
        if (tr.events && tr.offset != null) {
          const ix = traceIndex(tr.events), W = (w) => [w.t0 * 1000 + tr.offset, w.t1 * 1000 + tr.offset], full = mode === 'profile', va = size[0] * size[1];
          if (row.wins.length === 1) o.trace = summarize(tr.events, ix, W(row.wins[0]), { full, vpArea: va });
          else { const parts = row.wins.map((w) => summarize(tr.events, ix, W(w), { full: false })); const st_ = {}; let dm = 0, fr = 0; for (const p_ of parts) { fr += p_.compositor.frames; dm += p_.compositor.droppedFrameMarkers; for (const [k, v] of Object.entries(p_.compositor.states)) st_[k] = (st_[k] || 0) + v; } o.trace = { compositor: { frames: fr, states: st_, droppedFrameMarkers: dm } }; }
          if (full) { const fl = []; for (const w of row.wins) for (const [t, d] of raw.F) if (t > w.t0 && t <= w.t1 && t - d >= w.t0 - 0.5 && d >= 25) fl.push({ dt: d, at: t - w.t0, t0us: (t - d) * 1000 + tr.offset, t1us: t * 1000 + tr.offset }); if (fl.length) o.autopsy = autopsy(tr.events, ix, fl); }
        }
        out.rows.push(o);
      }
      if (/^spin/.test(rows[0] && rows[0].name) || (res.group === '10 normal spins')) out.perSpin = wins.filter((w) => /^spin \d+$/.test(w.name)).map((w) => ({ ...frameStats(raw.F, [[w.t0, w.t1]]), name: w.name }));
      // main-thread totals over the whole scene run (CDP Performance domain, cumulative counters; not windowed)
      const d = (k) => (m1[k] || 0) - (m0[k] || 0);
      out.mainThread = { taskMsPerS: r2(d('TaskDuration') * 1000 / wallS), scriptMsPerS: r2(d('ScriptDuration') * 1000 / wallS), layoutMsPerS: r2(d('LayoutDuration') * 1000 / wallS), styleMsPerS: r2(d('RecalcStyleDuration') * 1000 / wallS), layouts: d('LayoutCount'), styleRecalcs: d('RecalcStyleCount'), heapMB: r2(m1.JSHeapUsedSize / 1048576), nodes: m1.Nodes, docs: m1.Documents };
      if (survey) out.survey = await pg.eval(`__fb5scenes.survey(${JSON.stringify(key)})`);
      if (mode === 'profile' && layers) out.layers = await layerSnapshot(pg);
      return out;
    } finally { await close(pg); }
  }
  async function layerSnapshot(pg) {   // LayerTree: layer count, total area, top layers with the DOM node and compositing reasons
    let tree = null; const off = pg.on('LayerTree.layerTreeDidChange', (p) => { if (p.layers) tree = p.layers; });
    try { await pg.send('LayerTree.enable'); for (let i = 0; i < 20 && !tree; i++) await sleep(50);
      if (!tree) return { error: 'no layerTreeDidChange' };
      const L2 = tree.map((l) => ({ id: l.layerId, w: l.width, h: l.height, area: l.width * l.height, draws: l.drawsContent, node: l.backendNodeId, paintCount: l.paintCount }));
      const top = L2.filter((l) => l.draws).sort((a, b) => b.area - a.area).slice(0, 10);
      for (const l of top) { try { if (l.node) { const n = await pg.send('DOM.describeNode', { backendNodeId: l.node }); const nd = n.node; const at = Object.fromEntries((nd.attributes || []).reduce((a, v, i, arr) => (i % 2 ? a : [...a, [arr[i], arr[i + 1]]]), [])); l.sel = nd.nodeName.toLowerCase() + (at.id ? '#' + at.id : '') + (at.class ? '.' + at.class.split(/\s+/).slice(0, 3).join('.') : ''); } const cr = await pg.send('LayerTree.compositingReasons', { layerId: l.id }); l.reasons = cr.compositingReasonIds || cr.compositingReasons; } catch (e) { l.err = String(e.message).slice(0, 80); } }
      return { layers: L2.length, drawing: L2.filter((l) => l.draws).length, totalAreaMpx: +(L2.reduce((a, l) => a + l.area, 0) / 1e6).toFixed(2), drawingAreaMpx: +(L2.filter((l) => l.draws).reduce((a, l) => a + l.area, 0) / 1e6).toFixed(2), rootAreaMpx: +(Math.max(...L2.map((l) => l.area)) / 1e6).toFixed(2), top };
    } finally { off(); await pg.send('LayerTree.disable').catch(() => {}); }
  }

  // ---------------------------------------------------------------- first load over the tailnet (cold cache, then a warm reload)
  async function firstLoad(cache) {
    const pg = await newPage(cdp);
    for (const d of ['Page', 'Runtime', 'Network']) await pg.send(d + '.enable');
    if (!cache) await pg.send('Network.clearBrowserCache'); await pg.send('Network.setCacheDisabled', { cacheDisabled: !cache });   // the warm load reuses what the cold load just cached
    await pg.send('Emulation.setDeviceMetricsOverride', { width: vp[0], height: vp[1], deviceScaleFactor: dpr, mobile: false });
    await pg.send('Page.addScriptToEvaluateOnNewDocument', { source: pageJs.replace('__SEED__', String(A.seed || 12345)) });
    const hdr = {}; pg.on('Network.responseReceived', (p) => { const n = p.response.url.split('/').pop().split('?')[0]; if (/^(index\.html|game\.js|style\.css|room\.webp)$/.test(n)) hdr[n] = { status: p.response.status, cacheControl: p.response.headers['Cache-Control'] || p.response.headers['cache-control'], encoding: p.response.headers['Content-Encoding'] || p.response.headers['content-encoding'] || 'none', proto: p.response.protocol }; });
    const load = new Promise((r) => { const off = pg.on('Page.loadEventFired', () => { off(); r(); }); });
    await pg.send('Page.navigate', { url: idxUrl }); await load;   // splash path, practice mode: what a first-time player gets
    await pg.eval(`new Promise((res,rej)=>{const t0=performance.now();const i=setInterval(()=>{if(window.CC&&CC.ready){clearInterval(i);__fb5.readyAt=__fb5.readyAt||performance.now();res()}else if(performance.now()-t0>90000){clearInterval(i);rej(new Error('CC.ready timeout'))}},10)})`);
    const nav = await pg.eval(`(()=>{const n=performance.getEntriesByType('navigation')[0];return {requestStart:n.requestStart,responseEnd:n.responseEnd,domInteractive:n.domInteractive,loadEventEnd:n.loadEventEnd,readyAt:__fb5.readyAt}})()`);
    const res = await pg.eval(`JSON.stringify(performance.getEntriesByType('resource').map(e=>({u:e.name,t:e.initiatorType,s:Math.round(e.startTime),end:Math.round(e.responseEnd),tx:e.transferSize,enc:e.encodedBodySize,dec:e.decodedBodySize})))`).then(JSON.parse);
    // first spin: Pick up (splash), SPIN, until the round settles
    await sleep(500);
    const fsr = await pg.eval(`(async()=>{const st=CC.core.st,sl=ms=>new Promise(r=>setTimeout(r,ms));const g=document.getElementById('go');const tg=performance.now();if(g&&document.getElementById('splash')){g.click();await sl(700)}const t0=performance.now();document.getElementById('spin').click();const t1=performance.now();for(let i=0;i<600&&!st.busy;i++)await sl(10);const tb=performance.now();const dl=performance.now()+90000;while(st.busy&&performance.now()<dl){if(document.getElementById('tier'))st.tap++;await sl(20)}return {splashToSpinClickMs:Math.round(t0-tg),firstSpinMs:Math.round(performance.now()-t0),busyAfterClickMs:Math.round(tb-t1)}})()`);
    await close(pg);
    const tot = res.reduce((a, r) => a + (r.tx || 0), 0), enc = res.reduce((a, r) => a + (r.enc || 0), 0) + 0, dec = res.reduce((a, r) => a + (r.dec || 0), 0);
    const byType = {}; for (const r of res) { const e = (r.u.split('?')[0].match(/\.(\w+)$/) || [, 'other'])[1]; const o = byType[e] || (byType[e] = { n: 0, transferKB: 0, bodyKB: 0 }); o.n++; o.transferKB += (r.tx || 0) / 1024; o.bodyKB += (r.enc || 0) / 1024; }
    for (const o of Object.values(byType)) { o.transferKB = Math.round(o.transferKB); o.bodyKB = Math.round(o.bodyKB); }
    return { cache, nav, readyAtMs: Math.round(nav.readyAt), requests: res.length + 1, transferKB: Math.round((tot + 5329) / 1024), bodyKB: Math.round(enc / 1024), decodedKB: Math.round(dec / 1024), byType, lastByteMs: Math.max(...res.map((r) => r.end)), headers: hdr, firstSpin: fsr, top: [...res].sort((a, b) => (b.enc || b.tx) - (a.enc || a.tx)).slice(0, 12).map((r) => ({ url: r.u.split('/').slice(-2).join('/'), kb: Math.round((r.enc || r.tx) / 1024), startMs: r.s, endMs: r.end })), resources: res.map((r) => ({ url: r.u, tx: r.tx, enc: r.enc, dec: r.dec, start: r.s, end: r.end, t: r.t })) };
  }

  // ---------------------------------------------------------------- run
  const R = { schema: 'coldcall-fb5/1', tag: A.tag, base: A.base, startedAt: new Date().toISOString(), viewport: { w: vp[0], h: vp[1], dpr: dpr || 'native' }, seed: A.seed || 12345, gpu: null, sessions, display: A.display || null, scenes: sceneList, passes: {} };
  const save = () => fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(R));
  // Chrome's first request after launch stalls 5-23 s before it is sent (measured: requestStart 5-23 s, curl from the same machine 25 ms); warm it so no scene or load sees that
  const warmFirst = async () => { const w = await newPage(cdp); await w.send('Page.enable'); const l = new Promise((r) => { const off = w.on('Page.loadEventFired', () => { off(); r(); }); }); await w.send('Page.navigate', { url: dirUrl + 'qa.js' }); await l; await close(w); };
  const passTiming = async (label, opts) => { const arr = []; for (const k of sceneList) { if (opts.only && !opts.only.includes(k)) continue; log(label, k); try { arr.push(await runScene(k, { mode: 'timing', ...opts, survey: !!opts.survey })); } catch (e) { arr.push({ key: k, title: SC[k].title, error: String(e.message).slice(0, 400), throttle: opts.throttle || 1 }); log('  FAILED', k, e.message); } R.passes[label] = arr; save(); } };
  const ths = A.throttles || [1, 4];
  // ---- session A: first load (fresh profile = cold HTTP cache), then frame timing. 'first' = first encounter in a fresh Chrome profile (cold GPU shader/decode caches), then the same scenes again (steady)
  if (A.only !== 'cold' && A.only !== 'ablate') {
  await startSession('A'); R.gpu = sessions[0];
  await warmFirst(); log('warm-up done');
  if (A.firstLoad !== false) { const colds = []; for (let i = 0; i < (A.loadRepeats || 3); i++) colds.push(await firstLoad(false)); const med = [...colds].sort((a, b) => a.readyAtMs - b.readyAtMs)[colds.length >> 1]; R.firstLoad = { cold: med, coldRuns: colds.map((c) => ({ readyAtMs: c.readyAtMs, lastByteMs: c.lastByteMs, transferKB: c.transferKB, requests: c.requests, firstSpinMs: c.firstSpin.firstSpinMs })), warm: await firstLoad(true) }; log('first load: ready at', R.firstLoad.cold.readyAtMs, 'ms cold,', R.firstLoad.warm.readyAtMs, 'ms warm; transfer', R.firstLoad.cold.transferKB, 'KB in', R.firstLoad.cold.requests, 'requests'); save(); }
  if (A.only === 'load') { await L.stop(cdp); L = null; } else {
  if (ths.includes(1)) { await passTiming('timing_1x_first', { throttle: 1, survey: true }); if (A.steady !== false) await passTiming('timing_1x', { throttle: 1, survey: true }); }
  // calibration: does the light compositor trace itself cost frame time? idle 10 s without a trace vs with it
  if (A.calibrate !== false) { const a = await runScene('idle', { mode: 'none' }), b = await runScene('idle', { mode: 'timing' }); R.traceOverheadCheck = { noTrace: a.rows[0], lightTrace: { ...b.rows[0], trace: undefined } }; log('trace overhead check: idle p95', a.rows[0].p95, '->', b.rows[0].p95); save(); }
  for (const th of ths.filter((t) => t !== 1)) await passTiming(`timing_${th}x`, { throttle: th });
  if (A.vp2) await passTiming('timing_phone_540x960_dpr2', { throttle: 1, size: [540, 960], dpr_: 2, only: ['idle', 'spins10', 'more'], survey: true });
  await L.stop(cdp);
  }   // end of 'not only load'
  }   // end of session A
  // ---- session B: full traces (fresh profile again), cold first and steady, then the kill-switch experiments
  if (A.only !== 'cold' && A.only !== 'load') {
  if (A.profile !== false || A.ablate) await startSession('B');
  if (A.only === 'ablate') await warmFirst();
  if (A.profile !== false && A.only !== 'ablate') { await warmFirst(); await passTiming('profile_1x_first', { throttle: 1, mode: 'profile' }); await passTiming('profile_1x', { throttle: 1, mode: 'profile' }); }
  save();
  if (A.ablate) {
    const ABL = [['control', ''], ['will-change:auto everywhere', '*{will-change:auto!important}'], ['filter:none everywhere', '*{filter:none!important}'], ['backdrop-filter:none everywhere', '*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}'],
      ['box-shadow+text-shadow:none everywhere', '*{box-shadow:none!important;text-shadow:none!important}'], ['CSS animations off (animation:none)', '*,*::before,*::after{animation:none!important}'], ['mix-blend-mode:normal everywhere', '*{mix-blend-mode:normal!important}'], ['#fx canvas + #sides props hidden', '#fx,#sides{display:none!important}'], ...(A.ablateExtra || []), ['control (repeat, run-to-run spread)', '']];
    R.ablation = [];
    for (const [name, css] of ABL.slice(0, A.ablateLimit || 99)) for (const key of ['idle', 'cascade']) { log('ablate', name, key); try { await runScene(key, { mode: 'none', css }); /* warm-up run: first use of a new CSS state costs GPU compiles that are not the steady cost */ const o = await runScene(key, { mode: 'profile', css, layers: false }); R.ablation.push({ variant: name, css, scene: key, rows: o.rows.map((r) => ({ name: r.name, p95: r.p95, over25: r.over25, over33: r.over33, frames: r.frames, trace: r.trace && { main: r.trace.main && { busyPct: r.trace.main.busyPct, selfMs: r.trace.main.selfMs }, raster: r.trace.raster, gpuProcess: r.trace.gpuProcess, paint: r.trace.paint && { paintedAreaPerSecInViewports: r.trace.paint.paintedAreaPerSecInViewports, paintEvents: r.trace.paint.paintEvents }, compositor: r.trace.compositor } })), mainThread: o.mainThread }); } catch (e) { R.ablation.push({ variant: name, scene: key, error: String(e.message).slice(0, 200) }); } save(); }
  }
  if (L && (A.profile !== false || A.ablate)) { await L.stop(cdp); L = null; }
  }   // end of session B
  // ---- session C: the cold-start GPU hitches. Each row = one Chrome launch, scenes spins10 -> bigwin -> intro in that order. Questions: do they go away when the on-disk GPU / shader caches are warm
  // (same profile relaunched), how much do two fresh launches differ, and does switching a CSS feature off remove them?
  if (A.coldAblate && A.only !== 'load') {
    const CV = [['control, fresh profile (cold GPU caches)', '', { keepProfile: true }], ['SAME profile relaunched (on-disk GPU / shader caches warm)', '', { freshProfile: false }], ['control again, fresh profile (run to run spread)', '', {}],
      ['filter:none everywhere, fresh profile', '*{filter:none!important}', {}], ['box-shadow+text-shadow:none everywhere, fresh profile', '*{box-shadow:none!important;text-shadow:none!important}', {}], ['CSS animations off, fresh profile', '*,*::before,*::after{animation:none!important}', {}]];
    R.coldAblation = [];
    for (const [name, css, lo] of CV.slice(0, A.coldLimit || 99)) {
      log('cold experiment', name); const rec = { variant: name, css, rows: [] };
      try { await startSession('C:' + name, lo); await warmFirst();
        for (const key of ['spins10', 'bigwin', 'intro']) { const o = await runScene(key, { mode: 'timing', css }); for (const r of o.rows) if (!/^  /.test(r.name)) rec.rows.push({ scene: key, name: r.name, frames: r.frames, p99: r.p99, worst: r.worst, over25: r.over25, over33: r.over33 }); }
      } catch (e) { rec.error = String(e.message).slice(0, 200); log('  cold experiment FAILED', e.message); }
      try { await L.stop(cdp); } catch {} R.coldAblation.push(rec); save();
    }
    L = null;
  }
  if (!R.gpu) R.gpu = sessions[0];
  R.finishedAt = new Date().toISOString(); R.elapsedS = Math.round((Date.now() - t00) / 1000); save();
  log('done in', R.elapsedS, 's ->', path.join(OUT, 'result.json'));
} catch (e) { console.error('FATAL', e && e.stack || e); exitCode = exitCode || 1; }
finally { if (L) await L.stop(cdp).catch(() => {}); }
process.exit(exitCode);
