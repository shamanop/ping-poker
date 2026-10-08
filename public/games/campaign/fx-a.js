/* Campaign Trail, ?fx=a: the decision desk (election-night graphics pass). Inert unless the page, or the shell page around it, carries ?fx=a.
   Presentation only: it never decides anything. Every figure it shows is handed to it by game.js as a server field; the only thing it adds is time
   (it holds an answer that has already arrived until the count has played) and sound (WebAudio, synthesized, no sample files). */
(function () {
  'use strict';
  let flag = new URLSearchParams(location.search).get('fx');
  if (!flag) { try { flag = new URLSearchParams(window.parent.location.search).get('fx'); } catch (e) { flag = null; } }
  if (flag !== 'a') return;
  const root = document.documentElement; root.dataset.fx = 'a';
  const hide = document.createElement('style'); hide.textContent = 'html[data-fx="a"]:not(.fx-ok) #app{visibility:hidden}'; document.head.appendChild(hide);
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'fx-a.css'; link.onload = link.onerror = () => root.classList.add('fx-ok'); document.head.appendChild(link);
  setTimeout(() => root.classList.add('fx-ok'), 1500);

  const NS = 'http://www.w3.org/2000/svg';
  const $ = (id) => document.getElementById(id);
  const div = (cls, parent, html) => { const n = document.createElement('div'); n.className = cls; if (html != null) n.innerHTML = html; if (parent) parent.appendChild(n); return n; };
  const sv = (tag, attrs, parent) => { const n = document.createElementNS(NS, tag); for (const k in attrs || {}) n.setAttribute(k, attrs[k]); if (parent) parent.appendChild(n); return n; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const HOLD = { safe: 1150, lean: 1500, swing: 2100, final: 2700 };          // ms between the tap and the call: the riskier the state, the longer the room waits

  // ================================================================ sound: every voice is (ctx, out, t, opts), so a recording can be re-rendered offline from the log
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const muted = () => lsGet('pp_sound_muted') === '1';                          // the shell's own switch and volume (public/sound.js)
  const vol = () => { const v = parseFloat(lsGet('pp_sound_volume')); return isFinite(v) && v >= 0 && v <= 1 ? v : 0.5; };
  let ac = null, master = null; const alog = [];
  function chain(c, v) { const g = c.createGain(); g.gain.value = v; const k = c.createDynamicsCompressor(); k.threshold.value = -12; k.knee.value = 10; k.ratio.value = 5; k.attack.value = 0.002; k.release.value = 0.14; g.connect(k); k.connect(c.destination); return g; }
  function noiseBuf(c) { if (c.__nb) return c.__nb; const len = c.sampleRate, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0); let s = 20261008; for (let i = 0; i < len; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = s / 2147483648 - 1; } return (c.__nb = b); }
  function env(c, t, peak, a, dur) { const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); return g; }
  function tone(c, out, t, o) { const os = c.createOscillator(); os.type = o.type || 'sine'; os.frequency.setValueAtTime(o.f, t); if (o.f2) os.frequency.exponentialRampToValueAtTime(o.f2, t + (o.glide || o.dur)); const g = env(c, t, o.vol, o.a || 0.004, o.dur); let last = os; if (o.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(o.lp, t); if (o.lp2) f.frequency.exponentialRampToValueAtTime(o.lp2, t + o.dur); os.connect(f); last = f; } last.connect(g); g.connect(out); os.start(t); os.stop(t + o.dur + 0.03); }
  function nz(c, out, t, o) { const s = c.createBufferSource(); s.buffer = noiseBuf(c); s.loop = true; const f = c.createBiquadFilter(); f.type = o.type || 'bandpass'; f.frequency.setValueAtTime(o.f, t); if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur); f.Q.value = o.q || 0.8; const g = env(c, t, o.vol, o.a || 0.003, o.dur); s.connect(f); f.connect(g); g.connect(out); s.start(t, (t * 0.37) % 0.9); s.stop(t + o.dur + 0.03); }
  const semi = (n) => Math.pow(2, n / 12);
  const VOICE = {
    tap(c, o, t) { tone(c, o, t, { f: 1900, f2: 1300, dur: 0.045, vol: 0.16 }); },
    open(c, o, t) { nz(c, o, t, { f: 500, f2: 5200, dur: 0.34, vol: 0.12, a: 0.2 }); tone(c, o, t + 0.3, { f: 110, f2: 55, dur: 0.5, vol: 0.5 }); tone(c, o, t + 0.3, { type: 'triangle', f: 440, dur: 0.5, vol: 0.14 }); tone(c, o, t + 0.3, { type: 'triangle', f: 660, dur: 0.5, vol: 0.1 }); },
    // the count: data chatter that speeds up and climbs, a low swell under it, then a hole of silence just before the call
    count(c, o, t, p) {
      const D = p.d, end = D - 0.2; let x = 0, i = 0;
      while (x < end) { const k = x / end; tone(c, o, t + x, { type: 'square', f: 880 * semi(Math.floor(k * 9)), dur: 0.03, vol: 0.05 + 0.07 * k, lp: 3800 }); if (i % 2) nz(c, o, t + x, { type: 'highpass', f: 5200, dur: 0.02, vol: 0.05 + 0.05 * k }); x += 0.19 - 0.125 * Math.min(1, k * 1.25); i++; }
      const os = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain(); os.type = 'sawtooth'; os.frequency.setValueAtTime(55, t); os.frequency.linearRampToValueAtTime(58.3, t + end);
      f.type = 'lowpass'; f.frequency.setValueAtTime(140, t); f.frequency.exponentialRampToValueAtTime(1500, t + end); f.Q.value = 5;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.2, t + end); g.gain.setValueAtTime(0.0001, t + end + 0.004);
      os.connect(f); f.connect(g); g.connect(o); os.start(t); os.stop(t + end + 0.02);
    },
    // the call: a low hit, a hard transient, and a clean two-note stab that climbs a step with every state carried
    call(c, o, t, p) {
      const r = 220 * semi(Math.min(14, (p.n || 0) * 2)), big = p.tier === 'swing';
      tone(c, o, t, { f: 120, f2: 38, dur: 0.5, vol: 1.0, glide: 0.12 }); nz(c, o, t, { type: 'highpass', f: 2400, dur: 0.05, vol: 0.4 });
      for (const [m, v] of [[1, 0.2], [1.5, 0.16], [2, 0.14]]) tone(c, o, t, { type: 'sawtooth', f: r * m, dur: 0.6, vol: v * 0.7, lp: 5200, lp2: 500 });
      tone(c, o, t, { f: r * 4, dur: 0.9, vol: 0.09 }); if (big) { tone(c, o, t + 0.09, { f: r * 6, dur: 1.1, vol: 0.07 }); tone(c, o, t, { f: 70, f2: 30, dur: 0.9, vol: 0.7 }); }
    },
    // the bust: one dry thud, then almost nothing
    bust(c, o, t) { tone(c, o, t, { f: 95, f2: 27, dur: 0.75, vol: 1.2, glide: 0.2 }); nz(c, o, t, { type: 'lowpass', f: 420, dur: 0.11, vol: 0.8 }); tone(c, o, t + 0.02, { type: 'sawtooth', f: 51.9, dur: 0.5, vol: 0.2, lp: 300 }); tone(c, o, t + 0.25, { f: 1000, dur: 2.2, vol: 0.018, a: 0.3 }); },
    tick(c, o, t, p) { tone(c, o, t, { f: 2100 * semi((p && p.up) || 0), dur: 0.028, vol: 0.07 }); },
    // victory declared: a clean rising sting
    win(c, o, t) { tone(c, o, t, { f: 100, f2: 42, dur: 0.6, vol: 0.9, glide: 0.14 }); nz(c, o, t, { f: 1800, f2: 7000, dur: 0.3, vol: 0.1, a: 0.08 }); [440, 554.37, 659.26, 880].forEach((f, i) => { tone(c, o, t + i * 0.075, { type: 'triangle', f, dur: 1.1, vol: 0.2 }); tone(c, o, t + i * 0.075, { f: f * 2, dur: 0.8, vol: 0.06 }); }); },
    slide(c, o, t) { tone(c, o, t, { f: 90, f2: 30, dur: 1.6, vol: 1.2, glide: 0.3 }); nz(c, o, t, { type: 'lowpass', f: 300, dur: 0.2, vol: 0.5 }); for (const [f, v] of [[110, 0.2], [164.81, 0.15], [220, 0.15], [277.18, 0.1], [329.63, 0.08]]) tone(c, o, t + 0.36, { type: 'sawtooth', f, dur: 5.5, vol: v * 0.8, a: 1.6, lp: 380, lp2: 3400 }); },
    slideHit(c, o, t) { tone(c, o, t, { f: 110, f2: 36, dur: 1.2, vol: 1.1, glide: 0.2 }); nz(c, o, t, { type: 'highpass', f: 2200, dur: 0.06, vol: 0.4 }); [440, 554.37, 659.26, 880, 1108.73].forEach((f, i) => tone(c, o, t + i * 0.06, { type: 'triangle', f, dur: 2.4, vol: 0.18 })); }
  };
  function unlock() { if (ac || muted()) { if (ac && ac.state === 'suspended') ac.resume(); return; } const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; try { ac = new AC(); master = chain(ac, vol()); } catch (e) { ac = null; } }
  addEventListener('pointerdown', unlock, true); addEventListener('keydown', unlock, true);
  function play(name, opts, delayMs) {
    alog.push({ t: performance.now() + (delayMs || 0), name, opts: opts || null }); if (alog.length > 600) alog.shift();
    if (!ac || muted() || !VOICE[name]) return; if (ac.state === 'suspended') ac.resume();
    try { master.gain.value = vol(); VOICE[name](ac, master, ac.currentTime + 0.012 + (delayMs || 0) / 1000, opts || {}); } catch (e) { /* sound is never worth an error */ }
  }
  // test hook: the same voices, from the log, into a WAV (base64). Used to lay the sound onto a silent screen recording.
  async function render(t0, seconds) {
    const sr = 44100, oc = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr), out = chain(oc, 0.7);
    for (const e of alog) { const t = (e.t - t0) / 1000 + 0.012; if (t < 0 || t > seconds - 0.05 || !VOICE[e.name]) continue; VOICE[e.name](oc, out, t, e.opts || {}); }
    const buf = await oc.startRendering(), n = buf.length, L = buf.getChannelData(0), R = buf.getChannelData(1), dv = new DataView(new ArrayBuffer(44 + n * 4));
    const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); w(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * 4, true);
    for (let i = 0; i < n; i++) { dv.setInt16(44 + i * 4, Math.max(-1, Math.min(1, L[i])) * 32767, true); dv.setInt16(46 + i * 4, Math.max(-1, Math.min(1, R[i])) * 32767, true); }
    let s = ''; const u = new Uint8Array(dv.buffer); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s);
  }

  // ================================================================ stage
  let map = null, board = null, fxb = null, fxf = null, fsvg = null, scrim = null, white = null, l3 = null, timers = [], raf = 0;
  const later = (ms, fn) => { const t = setTimeout(fn, ms); timers.push(t); return t; };
  function attach(m) {
    map = m; board = $('board'); const world = board.querySelector('.map-world'), G = window.CAMPAIGN_GEO;
    fsvg = sv('svg', { viewBox: '0 0 ' + G.w + ' ' + G.h, width: G.w, height: G.h, class: 'map-svg fx-svg', 'aria-hidden': 'true' }, world);
    const defs = sv('defs', null, fsvg), cp = sv('clipPath', { id: 'fxClip' }, defs); sv('circle', { id: 'fxClipC', cx: 0, cy: 0, r: 0 }, cp);
    fxb = div('fxb', board); scrim = div('fx-scrim', fxb); white = div('fx-white', fxb); fxf = div('fxf', $('app'));
    const tk = $('ticker'), setTk = () => fxb.style.setProperty('--tk', (tk ? tk.offsetHeight : 44) + 'px'); setTk(); if (window.ResizeObserver && tk) new ResizeObserver(setTk).observe(tk);
  }
  const clearSvg = (cls) => { if (fsvg) fsvg.querySelectorAll(cls || 'path, circle.fx-ring').forEach((n) => n.remove()); };
  function clearAll() {
    for (const t of timers) clearTimeout(t); timers = []; cancelAnimationFrame(raf); clearSvg();
    if (l3) { l3.remove(); l3 = null; } if (fxf) fxf.textContent = ''; if (fxb) fxb.querySelectorAll('.fx-vic').forEach((n) => n.remove());
    if (scrim) scrim.className = 'fx-scrim'; if (board) delete board.dataset.fxk; settle();
  }
  // while a state is being counted the option cards step aside and the map takes the room (narrow layouts); settle() gives the room back
  function settle(deal) { const app = $('app'); if (!app || app.dataset.fxc !== '1') return; delete app.dataset.fxc; if (board) void board.offsetHeight; if (map) map.resize(); if (deal) { const p = $('panel'); p.classList.remove('deal'); void p.offsetWidth; p.classList.add('deal'); } }
  function flash(big) { if (still || !white) return; white.className = 'fx-white'; void white.offsetWidth; white.className = 'fx-white ' + (big ? 'big' : 'go'); }
  function strap(kind, tag, name, meta) {
    if (l3) l3.remove();
    l3 = div('fx-l3 in k-' + kind, fxb, '<div class="tg"><i></i><span>' + esc(tag) + '</span></div><div class="bd"><b>' + esc(name) + '</b><span>' + esc(meta || '') + '</span><i class="gl"></i></div><div class="fg"><b></b><small></small></div><i class="pr"><i></i></i>');
    return l3;
  }
  function strapOut(ms) { const n = l3; if (!n) return; later(ms, () => { n.classList.remove('in'); n.classList.add('out'); setTimeout(() => { n.remove(); if (l3 === n) l3 = null; }, 180); }); }
  // a number that races to its real value: the last frame is always the exact server figure, formatted by the game's own formatter
  function race(node, from, to, ms, fmt, done, ticks) {
    const t0 = performance.now(); let lastTick = 0;
    const step = (now) => { const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3); node.textContent = fmt(k >= 1 ? to : Math.round(from + (to - from) * e)); if (ticks && now - lastTick > 55 && k < 1) { lastTick = now; play('tick', { up: Math.round(k * 7) }); } if (k < 1) raf = requestAnimationFrame(step); else if (done) done(); };
    if (still) { node.textContent = fmt(to); if (done) done(); } else raf = requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------- the hold: an answer that arrives during the count waits for the count to finish
  let holdUntil = 0, queue = [], flushT = 0;
  function gate(run) {
    const left = holdUntil - performance.now();
    if (left <= 0 && !queue.length) return false;
    queue.push(run); clearTimeout(flushT); flushT = setTimeout(flush, Math.max(0, left)); return true;
  }
  function flush() { holdUntil = 0; const q = queue; queue = []; for (const f of q) { try { f(); } catch (e) { setTimeout(() => { throw e; }, 0); } } }

  // ---------------------------------------------------------------- beat 1: the count
  function suspense(o) {                    // o: { from, to, name, tier, final, pay }
    if (!map) return; clearAll();
    const ms = still ? 250 : o.final ? HOLD.final : (HOLD[o.tier] || HOLD.safe); holdUntil = performance.now() + ms;
    play('tap'); play('count', { d: ms / 1000 }, 40);
    const st = map.states[o.to]; if (st) sv('path', { d: st.d, class: 'fx-cnt' }, fsvg);
    $('app').dataset.fxc = '1'; void board.offsetHeight; map.resize();
    if (o.from && map.states[o.from] && st) map.look([o.from, o.to], { minW: 150 });
    scrim.classList.add('on');
    const n = strap('count', o.final ? 'FINAL STATE' : o.tier === 'swing' ? 'TOO CLOSE TO CALL' : 'COUNTING', o.name, (o.tier || '').toUpperCase() + (o.pay ? '  /  FOR ' + o.pay : ''));
    const bar = n.querySelector('.pr i'); if (bar && bar.animate && !still) bar.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(.8)', offset: 0.55 }, { transform: 'scaleX(.9)', offset: 0.9 }, { transform: 'scaleX(.92)' }], { duration: ms, fill: 'forwards', easing: 'cubic-bezier(.3,.7,.4,1)' });
  }
  // ---------------------------------------------------------------- beat 2: called
  function called(o) {                      // o: { to, name, tier, gain, mx, mxFrom, mxTo, mxFmt, n }
    if (!map) return; clearSvg('.fx-cnt'); scrim.classList.remove('on');
    play('call', { n: o.n, tier: o.tier });
    const st = map.states[o.to], big = o.tier === 'swing';
    if (st && !still) {
      const c = st.c, b = st.b, R = Math.hypot(b[2] - b[0], b[3] - b[1]) * 0.75 + 8, cc = fsvg.querySelector('#fxClipC'); cc.setAttribute('cx', c[0]); cc.setAttribute('cy', c[1]);
      const fl = sv('path', { d: st.d, class: 'fx-flood', 'clip-path': 'url(#fxClip)' }, fsvg), ring = sv('circle', { cx: c[0], cy: c[1], r: 1, class: 'fx-ring' }, fsvg);
      cc.animate([{ r: '0px' }, { r: R + 'px' }], { duration: 260, easing: 'cubic-bezier(.1,.8,.2,1)', fill: 'forwards' });
      fl.animate([{ opacity: 1 }, { opacity: 1, offset: 0.45 }, { opacity: 0 }], { duration: 640, fill: 'forwards' }).onfinish = () => fl.remove();
      ring.animate([{ r: '2px', opacity: 0.95 }, { r: (R * (big ? 3.4 : 2.4)) + 'px', opacity: 0 }], { duration: big ? 800 : 620, easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'forwards' }).onfinish = () => ring.remove();
    }
    flash(big);
    const n = l3 && l3.classList.contains('k-count') ? l3 : strap('call', 'CALLED', o.name, '');
    n.className = 'fx-l3 k-call' + (big ? ' swing' : ''); n.querySelector('.tg span').textContent = 'CALLED'; n.querySelector('.bd span').textContent = 'STATE ' + o.n + ' OF 50  /  CARRIED';
    n.querySelector('.fg b').textContent = o.gain; n.querySelector('.fg small').textContent = o.mx;
    const mx = $('mxv'); if (mx && o.mxFmt) { race(mx, o.mxFrom, o.mxTo, 360, o.mxFmt); mx.classList.remove('fx-hit'); void mx.offsetWidth; mx.classList.add('fx-hit'); }
    strapOut(1500); later(still ? 0 : 720, () => settle(true));
  }
  // ---------------------------------------------------------------- beat 3: breaking
  function bust(o) {                        // o: { to, name, mx, lost, news }
    clearAll(); if (board) board.dataset.fxk = 'bust';
    play('bust', null, 90);
    const st = map && map.states[o.to]; if (st) sv('path', { d: st.d, class: 'fx-dead' }, fsvg);
    const n = div('fx-bust', fxf, '<div class="pl"></div><i class="sl"></i><div class="bn">BREAKING NEWS</div><div class="wd">SCANDAL</div><div class="wh"><b>' + esc(o.name) + '</b><span>CAMPAIGN OVER<br>AT ' + esc(o.mx) + '</span></div><div class="ls"><small>STAKE LOST</small><b>' + esc(o.lost) + '</b></div><div class="cr"><i>LIVE</i><p><span>' + esc(o.news || '') + '</span></p></div>');
    later(still ? 1400 : 2500, () => { n.classList.add('out'); setTimeout(() => n.remove(), 160); });
    later(3400, () => clearSvg('.fx-dead'));
  }
  // ---------------------------------------------------------------- beat 4: victory declared
  function victory(o) {                     // o: { trail, win, fmt, mx, states }
    clearAll(); play('tap');
    scrim.className = 'fx-scrim deep on';
    const n = div('fx-vic', fxb, '<i class="fl"></i><div class="tg">' + esc(o.tag || 'VICTORY DECLARED') + '</div><b class="am"></b><div class="ln">' + o.states + (o.states === 1 ? ' STATE' : ' STATES') + '  /  ' + esc(o.mx) + '</div>'), am = n.querySelector('.am');
    (o.trail || []).slice(-24).forEach((c, i) => later(60 + i * 55, () => { const st = map && map.states[c]; if (st) { const p = sv('path', { d: st.d, class: 'fx-rip' }, fsvg); p.addEventListener('animationend', () => p.remove()); } }));
    race(am, 0, o.win, 620, o.fmt, () => { n.classList.add('hit'); play('win'); flash(false); }, true);
    later(2700, () => { n.classList.add('out'); scrim.className = 'fx-scrim'; setTimeout(() => n.remove(), 180); });
  }
  // ---------------------------------------------------------------- the landslide: projected winner
  function landslide(o) {                   // o: { win, fmt, mx }
    clearAll(); play('slide');
    let motes = ''; for (let i = 0; i < 16; i++) motes += '<i style="left:' + ((i * 61.8 + 7) % 100).toFixed(1) + '%;animation-duration:' + (6 + (i * 37 % 50) / 10).toFixed(1) + 's;animation-delay:' + (0.6 + (i * 53 % 60) / 10).toFixed(1) + 's;transform:scale(' + (0.6 + (i % 4) * 0.35) + ')"></i>';
    let cells = ''; for (let i = 0; i < 50; i++) cells += '<i></i>';
    const n = div('fx-ls', fxf, '<div class="pl"></div><div class="mt">' + motes + '</div><i class="fl"></i><div class="pw">PROJECTED WINNER</div><div class="wd">LANDSLIDE</div><div class="ct"><b>0</b><span>OF 50 STATES CARRIED</span></div><div class="gd">' + cells + '</div><div class="py"><small>PAID</small><b></b><em>' + esc(o.mx) + '  /  ALL 50 STATES</em></div>');
    const ct = n.querySelector('.ct b'), gd = n.querySelectorAll('.gd i'), py = n.querySelector('.py b'); py.textContent = o.fmt(0);
    later(850, () => { let k = 0; const iv = setInterval(() => { k++; ct.textContent = String(k); if (gd[k - 1]) gd[k - 1].classList.add('on'); if (k % 2) play('tick', { up: Math.round(k / 6) }); if (k >= 50) clearInterval(iv); }, 31); timers.push(iv); });
    later(2550, () => race(py, 0, o.win, 1500, o.fmt, () => { py.classList.add('hit'); play('slideHit'); }, true));
    later(still ? 4500 : 8200, () => { n.classList.add('out'); setTimeout(() => n.remove(), 220); });
  }
  function open() { clearAll(); play('open'); flash(false); }

  window.CampaignFx = { id: 'a', attach, gate, suspense, called, bust, victory, landslide, open, clear: clearAll, play, render, get log() { return alog; }, get holding() { return holdUntil > performance.now(); } };
})();
