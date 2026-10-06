// Runs ON SHAMAN. FB5 (chris 10-06 FB5): what is the GPU process doing during a first-encounter hitch? One fresh Chrome profile, a page per pass, one scene function per pass, a Chrome trace with
// GPU / Skia categories per pass: frames >= 25 ms, the GPU-process op totals (FillRRectOp ...) inside the window, optional dump of the events around the worst frames, optional animation snapshot.
// node gpuprobe.mjs <args.json>   args: { tag, base, scene, cats, url, passes, early, css, winIdx, dump: 'auto', snap: {sel, delay}, vp }  (driven by _scratch/fb1perf/probe.sh, not by run.mjs)
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { CDP, newPage, sleep } from './cdp.mjs'; import { launchChrome } from './launch.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)), A = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')), ROOT = 'E:\\bricklord-test\\coldcall-fb5';
const pageJs = fs.readFileSync(path.join(HERE, 'page.js'), 'utf8').replace('__SEED__', '12345'), scenesJs = fs.readFileSync(path.join(HERE, 'scenes.js'), 'utf8');
const vp = A.vp || [1440, 900]; let L, cdp;
const SNAP = `JSON.stringify(document.getAnimations().map(a=>{const ef=a.effect,t=ef&&ef.target,kf=ef&&ef.getKeyframes?ef.getKeyframes():[],props=new Set();kf.forEach(k=>Object.keys(k).forEach(n=>{if(!['offset','easing','composite','computedOffset'].includes(n))props.add(n)}));const r=t&&t.getBoundingClientRect?t.getBoundingClientRect():{width:0,height:0};return {t:t?(t.tagName.toLowerCase()+(t.id?'#'+t.id:'')+(typeof t.className==='string'&&t.className?'.'+t.className.split(' ').join('.'):'')):'?',n:a.animationName||a.transitionProperty||'waapi',p:[...props].join(','),dur:ef&&ef.getTiming?ef.getTiming().duration:0,w:Math.round(r.width),h:Math.round(r.height)}}))`;
async function pass(n) {
  const pg = await newPage(cdp); for (const d of ['Page', 'Runtime']) await pg.send(d + '.enable');
  await pg.send('Emulation.setDeviceMetricsOverride', { width: vp[0], height: vp[1], deviceScaleFactor: 0, mobile: false });
  await pg.send('Page.addScriptToEvaluateOnNewDocument', { source: pageJs });
  const events = []; const off = cdp.listen('Tracing.dataCollected', (p) => { for (const e of p.value) events.push(e); });
  const start = () => cdp.send('Tracing.start', { traceConfig: { includedCategories: A.cats, recordMode: 'recordAsMuchAsPossible' }, transferMode: 'ReportEvents' });
  if (A.early) await start();
  const load = new Promise((r) => { const o = pg.on('Page.loadEventFired', () => { o(); r(); }); }); await pg.send('Page.navigate', { url: A.base.split('?')[0] + (A.url || '?nosplash') }); await load;
  await pg.eval(`new Promise((res,rej)=>{const t0=performance.now();const i=setInterval(()=>{if(window.CC&&CC.ready){clearInterval(i);res()}else if(performance.now()-t0>90000){clearInterval(i);rej(new Error('timeout'))}},20)})`);
  await pg.eval(scenesJs); await sleep(2500);
  if (A.css) { await pg.eval(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(A.css)};document.head.appendChild(s)})()`); await sleep(600); }
  if (A.js) { await pg.eval(A.js); await sleep(300); }   // JS kill-switch injected after load (e.g. CC.fx.shake = () => {})
  if (!A.early) await start();
  const align = await pg.eval(`(()=>{performance.mark('fb5:align');return performance.getEntriesByName('fb5:align').pop().startTime})()`);
  let snapOut = null;
  if (A.snap) (async () => { try { await pg.eval(`new Promise((res)=>{const i=setInterval(()=>{if(document.querySelector(${JSON.stringify(A.snap.sel)})){clearInterval(i);res()}},20)})`); await sleep(A.snap.delay || 500); snapOut = await pg.eval(SNAP); } catch (e) { snapOut = null; } })();
  let mutOut = null;   // per-frame DOM writers: MutationObserver over body for 2 s after a selector shows up, top targets by count
  if (A.mut) (async () => { try { await pg.eval(`new Promise((res)=>{const i=setInterval(()=>{if(document.querySelector(${JSON.stringify(A.mut.sel)})){clearInterval(i);res()}},20)})`); await sleep(A.mut.delay || 300);
    mutOut = await pg.eval(`new Promise((res)=>{const M=new Map();const nm=(n)=>{const e=n.nodeType===1?n:n.parentElement;if(!e)return '?';return e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(typeof e.className==='string'&&e.className?'.'+e.className.trim().split(/\s+/).join('.'):'')};const mo=new MutationObserver((l)=>{for(const r of l){const k=r.type+':'+(r.attributeName||'')+' '+nm(r.target);M.set(k,(M.get(k)||0)+1)}});mo.observe(document.body,{attributes:true,characterData:true,childList:true,subtree:true});setTimeout(()=>{mo.disconnect();res(JSON.stringify([...M.entries()].sort((a,b)=>b[1]-a[1]).slice(0,14)))},2000)})`); } catch (e) { mutOut = null; } })();
  let layerOut = null;
  if (A.layers) (async () => { try { await pg.eval(`new Promise((res)=>{const i=setInterval(()=>{if(document.querySelector(${JSON.stringify(A.layers.sel)})){clearInterval(i);res()}},20)})`); await sleep(A.layers.delay || 500);
    let tree = null; const o = pg.on('LayerTree.layerTreeDidChange', (p) => { if (p.layers) tree = p.layers; }); await pg.send('DOM.enable'); await pg.send('LayerTree.enable'); for (let i = 0; i < 40 && !tree; i++) await sleep(50);
    layerOut = []; for (const l of (tree || [])) { let sel = ''; if (l.backendNodeId) { try { const n = (await pg.send('DOM.describeNode', { backendNodeId: l.backendNodeId })).node; const at = Object.fromEntries((n.attributes || []).reduce((a, v, i, arr) => (i % 2 ? a : [...a, [arr[i], arr[i + 1]]]), [])); sel = n.nodeName.toLowerCase() + (at.id ? '#' + at.id : '') + (at.class ? '.' + at.class.split(' ').join('.') : ''); } catch (e) { sel = '?'; } } layerOut.push({ id: l.layerId, w: l.width, h: l.height, draws: l.drawsContent, sel }); }
    o(); } catch (e) { layerOut = null; } })();
  const fn = { spin1: 'S.spins10', spins3: 'S.spins10', bigwin: 'S.bigwin', intro: 'S.intro' }[A.scene] || 'S.' + A.scene;
  const res = await pg.eval(A.scene === 'spin1' ? `(async()=>{const st=CC.core.st;const t0=performance.now();document.getElementById('spin').click();await new Promise(r=>{const i=setInterval(()=>{if(!st.busy){clearInterval(i);r()}},20)});return {win:[['spin1',t0,performance.now()]]}})()` : `__fb5scenes.${fn}()`);
  const done = new Promise((r) => { const o2 = cdp.listen('Tracing.tracingComplete', () => { o2(); r(); }); }); await cdp.send('Tracing.end'); await done; off();
  const raw = await pg.eval(`JSON.stringify(__fb5.take(0,1e12))`).then(JSON.parse);
  const al = events.find((e) => e.name === 'fb5:align'), offset = al ? al.ts - align * 1000 : 0;
  const pn = {}, tn = {}; for (const e of events) if (e.ph === 'M') { if (e.name === 'process_name') pn[e.pid] = e.args.name; if (e.name === 'thread_name') tn[e.pid + ':' + e.tid] = e.args.name; }
  let t0 = res.win[0][1], t1 = res.win[res.win.length - 1][2]; if (A.winIdx != null && res.win[A.winIdx]) { t0 = res.win[A.winIdx][1]; t1 = res.win[A.winIdx][2]; } const sceneT0 = t0;
  if (A.early) { const m = (nm) => { const x = events.find((e) => e.name === nm); return x ? (x.ts - offset) / 1000 : null; }; console.log('MARKS ccwarm:start', m('ccwarm:start'), 'ccwarm:end', m('ccwarm:end'), 'scene t0', t0); t0 = 0; }
  const bad = raw.F.filter(([t, d]) => t > t0 && t <= t1 && d >= 25).map(([t, d]) => ({ at: +(t - t0).toFixed(0), dt: +d.toFixed(1), from: +(t - d - t0).toFixed(0) }));
  const inW = (e) => e.ts - offset >= t0 * 1000 && e.ts - offset <= t1 * 1000;
  const OPS = {}; for (const e of events) if (e.ph === 'X' && inW(e) && /Op$/.test(e.name) && (pn[e.pid] || '').startsWith('GPU')) { const o = OPS[e.name] || (OPS[e.name] = { n: 0, ms: 0, max: 0, over5: 0 }); o.n++; o.ms += e.dur / 1000; o.max = Math.max(o.max, e.dur / 1000); if (e.dur > 5000) o.over5++; }
  console.log(`PASS ${n} GPUOPS (window ${Math.round(t1 - t0)} ms)`, Object.entries(OPS).sort((a, b) => b[1].ms - a[1].ms).slice(0, 6).map(([k, v]) => `${k} n=${v.n} sum=${v.ms.toFixed(0)}ms max=${v.max.toFixed(1)} over5ms=${v.over5}`).join(' | '));
  const PA = {}; for (const e of events) if (e.name === 'Paint' && inW(e) && e.args && e.args.data) { const k = e.args.data.nodeName || '?'; PA[k] = (PA[k] || 0) + 1; }
  console.log(`PASS ${n} PAINTS`, Object.entries(PA).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => v + 'x ' + k).join(' | '));
  console.log(`PASS ${n} frames>=25ms`, JSON.stringify(bad));
  if (A.dump) for (const bf of bad.filter((b) => b.dt > 45 && b.from >= sceneT0 - t0).slice(0, 3)) { console.log('DUMP frame', JSON.stringify(bf)); const rng = events.filter((e) => e.ph === 'X' && (e.dur >= 800 || /^(RasterTask|UpdateLayer|PrePaint|Layerize|Commit)$/.test(e.name)) && (e.ts - offset) / 1000 - t0 >= bf.from - 60 && (e.ts - offset) / 1000 - t0 <= bf.at && !/^(Scheduler|GpuChannel|CommandBuffer)/.test(e.name)).sort((a, b) => a.ts - b.ts); for (const e of rng.slice(0, 220)) console.log('DUMP', ((e.ts - offset) / 1000 - t0).toFixed(0), (e.dur / 1000).toFixed(1), pn[e.pid] || e.pid, '/', tn[e.pid + ':' + e.tid] || e.tid, '|', e.name, '|', JSON.stringify(e.args || {}).slice(0, 220)); }
  if (mutOut) { console.log('MUT (2 s)'); for (const [k, n] of JSON.parse(mutOut)) console.log('MUT', n, k); }
  if (layerOut) for (const l of layerOut.filter((x) => x.draws)) console.log('LAYER', l.id, l.w + 'x' + l.h, l.sel);
  if (snapOut) { const an = JSON.parse(snapOut); console.log('SNAP animations', an.length); for (const a of an) console.log('SNAP', a.t, '|', a.n, '|', a.p, '|', a.dur, a.w + 'x' + a.h); }
  await cdp.send('Target.closeTarget', { targetId: pg.targetId }).catch(() => {});
}
try {
  L = await launchChrome({ root: ROOT, tag: A.tag, headful: true, vp }); cdp = await CDP.connect(L.ws);
  const w = await newPage(cdp); await w.send('Page.enable'); const l0 = new Promise((r) => { const o = w.on('Page.loadEventFired', () => { o(); r(); }); }); await w.send('Page.navigate', { url: A.base.replace(/[^/]*$/, '') + 'qa.js' }); await l0; await cdp.send('Target.closeTarget', { targetId: w.targetId });
  for (let i = 0; i < (A.passes || 1); i++) await pass(i + 1);
} catch (e) { console.error('FATAL', e && e.stack || e); } finally { if (L) await L.stop(cdp).catch(() => {}); }
process.exit(0);
