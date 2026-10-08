/* BALLOT BENDER audio: all synthesized (no audio files). Drunken-carnival theme: wobbly oom-pah brass, slide whistles, hics, glass clinks, kazoo stings, crowd cheers, paper flutter, stamp/slam thuds. C major.
   Graph: events -> sfxG / musG -> glue compressor -> master (mute) -> soft ceiling shaper (<= -1.3 dBFS) -> destination (+ analyser tap).
   Public events are wrapped: logged (SFX.log), throttled, random pitch +-4%, no-ops when muted or no context. Internal composition uses R.* (raw) with at(delay, fn) so nothing relies on setTimeout. */
const SFX = (() => {
  let ctx, master, sfxG, musG, noiseBuf, comp, shaper, analyser, unlockOn = false;
  let on = readPref(), musicOn = readMusicPref(), bedHeld = false, musicTimer = null, musicMode = null, step = 0, nextT = 0, duckTimer = 0;
  let off = 0, pv = 1; // schedule offset (s) and per-event pitch variation, both set around an event call
  const log = [], last = {};
  const CEIL = 1.4; // shaper: y = CEIL*tanh(x/CEIL) over [-1,1] -> hard ceiling 0.858 = -1.33 dBFS

  function readPref() {
    try {
      const v = localStorage.getItem('ping.sfx');
      if (v !== null) return !/^(0|off|false|mute|muted|no)$/i.test(v);
      return localStorage.getItem('pp_sound_muted') !== '1';
    } catch (e) { return true; }
  }
  // music has its own switch; with no saved choice it follows the old single mute so a muted player stays muted
  function readMusicPref() {
    try {
      const v = localStorage.getItem('ping.music');
      if (v !== null) return !/^(0|off|false|mute|muted|no)$/i.test(v);
    } catch (e) { /* storage blocked */ }
    return readPref();
  }
  function writeMusicPref(v) { try { localStorage.setItem('ping.music', v ? '1' : '0'); } catch (e) { /* storage blocked */ } }
  function writePref(v) { try { localStorage.setItem('ping.sfx', v ? '1' : '0'); if (v && localStorage.getItem('pp_sound_muted') === '1') localStorage.setItem('pp_sound_muted', '0'); } catch (e) { /* storage blocked */ } }

  function makeNoise(c) {
    const b = c.createBuffer(1, c.sampleRate, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  function makeGraph(c) {
    const g = {};
    g.comp = c.createDynamicsCompressor(); g.comp.threshold.value = -16; g.comp.knee.value = 10; g.comp.ratio.value = 6; g.comp.attack.value = 0.003; g.comp.release.value = 0.18;
    g.master = c.createGain(); g.master.gain.value = 0.85;
    g.sfxG = c.createGain(); g.sfxG.gain.value = on ? 0.9 : 0;
    g.musG = c.createGain(); g.musG.gain.value = musicOn ? 0.55 : 0;
    g.shaper = c.createWaveShaper(); const cv = new Float32Array(2049); for (let i = 0; i < cv.length; i++) { const x = i / 1024 - 1; cv[i] = CEIL * Math.tanh(x / CEIL); } g.shaper.curve = cv; g.shaper.oversample = '2x';
    g.sfxG.connect(g.comp); g.musG.connect(g.comp); g.comp.connect(g.master); g.master.connect(g.shaper); g.shaper.connect(c.destination);
    g.noise = makeNoise(c);
    return g;
  }
  function use(g, c) { ctx = c; comp = g.comp; master = g.master; sfxG = g.sfxG; musG = g.musG; shaper = g.shaper; noiseBuf = g.noise; }

  // iOS only: an HTMLMediaElement playing makes WebAudio ignore the ringer switch. Needs real audio length (a 0-byte loop re-seeks ~30k times/s and pins the main thread).
  function isIOS() { const u = navigator.userAgent || ''; return /iP(hone|ad|od)/.test(u) || (/Macintosh/.test(u) && navigator.maxTouchPoints > 1); }
  function iosSilentSwitchHelper() {
    try {
      const sr = 8000, n = sr, buf = new ArrayBuffer(44 + n), v = new DataView(buf), w = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
      w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
      new Uint8Array(buf, 44).fill(128);
      const el = document.createElement('audio'); el.src = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })); el.loop = true; el.play().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (document.hidden) el.pause(); else el.play().catch(() => {}); });
    } catch (e) { /* helper only */ }
  }

  function init() {
    if (ctx) { if (ctx.state !== 'running') ctx.resume().catch(() => {}); return ctx; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    const c = new AC(); use(makeGraph(c), c);
    analyser = ctx.createAnalyser(); analyser.fftSize = 2048; shaper.connect(analyser);
    c.onstatechange = () => { if (c.state === 'suspended' || c.state === 'interrupted') c.resume().catch(() => {}); };
    try { const b = c.createBuffer(1, 1, c.sampleRate), n = c.createBufferSource(); n.buffer = b; n.connect(c.destination); n.start(0); } catch (e) { /* one-shot silent unlock tick */ }
    if (isIOS()) iosSilentSwitchHelper();
    if (c.state !== 'running') c.resume().catch(() => {});
    return ctx;
  }
  // any gesture creates/resumes the context; listeners stay until it is running
  function unlock() { init(); if (ctx && ctx.state === 'running') { ['pointerdown', 'keydown', 'touchend', 'click'].forEach((e) => removeEventListener(e, unlock, true)); unlockOn = false; } }
  if (typeof addEventListener === 'function') { ['pointerdown', 'keydown', 'touchend', 'click'].forEach((e) => addEventListener(e, unlock, { capture: true, passive: true })); unlockOn = true; }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (!document.hidden && ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); });

  const T = (o) => ctx.currentTime + off + (o.t || 0);
  function tone(o) {
    if (!ctx || !on) return;
    const t = T(o), dur = o.dur || 0.2, a = o.attack || 0.004, vol = o.vol == null ? 0.25 : o.vol, f0 = o.f * pv;
    const osc = ctx.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(f0, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to * pv, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(o.lp, t); if (o.lpTo) f.frequency.exponentialRampToValueAtTime(o.lpTo, t + dur); osc.connect(f); node = f; }
    node.connect(g); g.connect(o.dest || sfxG);
    osc.start(t); osc.stop(t + dur + 0.05);
  }
  function noise(o) {
    if (!ctx || !on) return;
    const t = T(o), dur = o.dur || 0.15;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = o.type || 'lowpass'; f.frequency.setValueAtTime((o.f || 1500) * pv, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to * pv, t + dur);
    f.Q.value = o.q || 0.8;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.2, t + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(o.dest || sfxG); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }
  const at = (d, fn) => { const o = off; off += d; try { fn(); } finally { off = o; } };
  const panner = (p) => { if (!ctx || !ctx.createStereoPanner) return sfxG; const n = ctx.createStereoPanner(); n.pan.value = Math.max(-1, Math.min(1, p)); n.connect(sfxG); return n; };
  const rnd = (a, b) => a + Math.random() * (b - a);

  // ---- carnival voices ----
  const cents = (c) => Math.pow(2, c / 1200);
  function brass(o) {
    if (!ctx || !on) return;
    const t = T(o), dur = o.dur || 0.3, vol = o.vol == null ? 0.12 : o.vol, drift = o.drift == null ? 14 : o.drift;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + (o.attack || 0.025));
    g.gain.setValueAtTime(vol, t + Math.max(0.03, dur * 0.6)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2.5;
    f.frequency.setValueAtTime((o.lp || 900) * 0.45, t); f.frequency.exponentialRampToValueAtTime(o.lp || 900, t + 0.06); f.frequency.exponentialRampToValueAtTime((o.lp || 900) * 0.6, t + dur);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 4.2 + Math.random() * 2; const lg = ctx.createGain(); lg.gain.value = drift * 1.6;
    lfo.connect(lg);
    const fl = o.f * pv * cents((Math.random() - 0.5) * drift);
    [-1, 1].forEach((s, i) => {
      const osc = ctx.createOscillator(); osc.type = i ? 'sawtooth' : 'square';
      osc.frequency.setValueAtTime(fl, t); if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to * pv, t + dur * 0.8);
      osc.detune.value = s * (8 + Math.random() * 10); lg.connect(osc.detune);
      osc.connect(f); osc.start(t); osc.stop(t + dur + 0.05);
    });
    lfo.start(t); lfo.stop(t + dur + 0.05);
    f.connect(g); g.connect(o.dest || sfxG);
  }
  function kazoo(o) {
    if (!ctx || !on) return;
    const t = T(o), dur = o.dur || 0.2, vol = o.vol == null ? 0.1 : o.vol;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.setValueAtTime(vol, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 1.6;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 6.5; const lg = ctx.createGain(); lg.gain.value = 28; lfo.connect(lg);
    const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.setValueAtTime(o.f * pv, t); if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to * pv, t + dur);
    lg.connect(osc.detune); osc.connect(bp); bp.connect(g); g.connect(o.dest || sfxG);
    lfo.start(t); osc.start(t); lfo.stop(t + dur + 0.05); osc.stop(t + dur + 0.05);
    noise({ type: 'bandpass', f: 2600, dur: dur * 0.8, vol: vol * 0.25, t: o.t || 0, q: 1, dest: o.dest });
  }
  const MAJ = [523.25, 587.33, 659.25, 698.46, 783.99, 880, 987.77, 1046.5, 1174.66, 1318.51, 1396.91, 1567.98, 1760, 1975.53, 2093];

  // ---- raw sounds (no throttle / logging); public wrappers are generated below ----
  const R = {};
  R.click = () => tone({ f: 1400, to: 900, type: 'triangle', dur: 0.05, vol: 0.12 });
  R.bet = (dir) => { const f = dir < 0 ? 760 : 1060; tone({ f, to: f * (dir < 0 ? 0.78 : 1.25), type: 'triangle', dur: 0.06, vol: 0.12 }); noise({ type: 'bandpass', f: 3000, dur: 0.02, vol: 0.04 }); };
  R.turbo = (onNow) => { noise({ type: 'bandpass', f: onNow ? 500 : 3000, to: onNow ? 3500 : 400, dur: 0.22, vol: 0.14, q: 1, attack: 0.04 }); tone({ f: onNow ? 400 : 900, to: onNow ? 1000 : 380, type: 'sawtooth', dur: 0.2, vol: 0.04, lp: 1600 }); };
  R.buy = () => { R.clink(1); at(0.09, () => R.clink(3)); tone({ f: 95, to: 50, dur: 0.18, vol: 0.3 }); at(0.16, () => R.coinShower(7, 0.5)); };
  R.spin = (bonus) => {
    noise({ f: 300, to: 2400, dur: 0.38, vol: 0.18, q: 1.2, attack: 0.08 }); tone({ f: 180, to: 520, type: 'sawtooth', dur: 0.3, vol: 0.05, lp: 900 });
    if (bonus) { R.flutter(5, 0.25); brass({ f: 130.8, to: 196, dur: 0.3, vol: 0.07, lp: 900 }); }
  };
  R.colDrop = (col) => { const k = col || 0; noise({ type: 'bandpass', f: 1000 + k * 130, to: 2800, dur: 0.22, vol: 0.06, q: 0.9, attack: 0.05, dest: panner((k - 2.5) / 3) }); };
  R.land = (heavy, col) => {
    const k = col == null ? 1 + Math.floor(Math.random() * 4) : Math.max(0, Math.min(5, col)), f = (heavy ? 120 : 100) * Math.pow(2, (k * 2) / 12), d = panner((k - 2.5) / 3);
    tone({ f, to: f * 0.4, dur: 0.15, vol: heavy ? 0.42 : 0.28, dest: d }); noise({ f: 900, to: 200, dur: 0.07, vol: heavy ? 0.2 : 0.1, dest: d });
    if (heavy) R.slam(0.45);
  };
  // heavy SLAM: sub drop + body + noise transient + crack; rumble tail above ~0.8. strength 0..1.5
  R.slam = (s) => {
    s = Math.max(0.1, Math.min(1.5, s == null ? 0.7 : s)); const k = Math.min(1, s);
    tone({ f: 95 + 30 * k, to: 34, dur: 0.28 + 0.4 * k, vol: 0.3 + 0.35 * k, attack: 0.002 });
    tone({ f: 190, to: 70, type: 'triangle', dur: 0.12 + 0.08 * k, vol: 0.14 + 0.16 * k, attack: 0.001 });
    noise({ type: 'lowpass', f: 3500, to: 140, dur: 0.1 + 0.2 * k, vol: 0.14 + 0.2 * k, attack: 0.001, q: 0.7 });
    noise({ type: 'highpass', f: 2500, dur: 0.03, vol: 0.04 + 0.08 * k, attack: 0.001 });
    if (s > 0.8) { tone({ f: 55, to: 30, dur: 0.9, vol: 0.2, attack: 0.01 }); noise({ type: 'lowpass', f: 300, to: 60, dur: 0.7, vol: 0.12, attack: 0.02 }); }
  };
  R.lockIn = () => { R.slam(0.8); tone({ f: 1500, to: 1100, type: 'sine', dur: 0.32, vol: 0.06, attack: 0.001, t: 0.02 }); tone({ f: 2250, type: 'sine', dur: 0.2, vol: 0.04, attack: 0.001, t: 0.02 }); };
  R.stamp = () => {
    tone({ f: 120, to: 48, dur: 0.3, vol: 0.4, attack: 0.002 }); tone({ f: 900, to: 240, type: 'triangle', dur: 0.06, vol: 0.14, attack: 0.001 });
    noise({ type: 'bandpass', f: 1600, dur: 0.09, vol: 0.18, q: 0.8, attack: 0.001 }); noise({ type: 'lowpass', f: 500, to: 100, dur: 0.2, vol: 0.14 });
  };
  R.flutter = (n, spread) => {
    n = n || 8; spread = spread || 0.5;
    for (let i = 0; i < n; i++) {
      const t = Math.random() * spread, d = panner(rnd(-0.8, 0.8));
      noise({ type: 'bandpass', f: rnd(2500, 7000), dur: rnd(0.03, 0.07), vol: rnd(0.025, 0.05), q: 2, t, dest: d });
      if (i % 3 === 0) noise({ type: 'bandpass', f: rnd(900, 1500), to: rnd(1800, 3000), dur: 0.12, vol: 0.03, q: 1, t, dest: d, attack: 0.03 });
    }
  };
  R.chime = (n) => {
    const f = MAJ[Math.min(n, MAJ.length - 1)];
    tone({ f, type: 'sine', dur: 0.6, vol: 0.24 }); tone({ f: f * 2, type: 'triangle', dur: 0.4, vol: 0.09 });
    tone({ f: f * 1.5, type: 'sine', dur: 0.45, vol: 0.06, t: 0.04 });
    brass({ f: f / 2, dur: 0.22, vol: 0.05, lp: 1400, drift: 20 });
    if (n >= 1) R.slideWhistle(true, 0.04 + Math.min(n, 8) * 0.012);
    if (n >= 3) R.clink(n - 3);
  };
  R.pop = () => { noise({ f: 2400, to: 300, dur: 0.13, vol: 0.22 }); tone({ f: 380, to: 130, dur: 0.1, vol: 0.18 }); tone({ f: 700, to: 240, type: 'triangle', dur: 0.08, vol: 0.12 }); };
  R.grow = () => { tone({ f: 660, type: 'triangle', dur: 0.18, vol: 0.2 }); tone({ f: 990, type: 'triangle', dur: 0.3, vol: 0.2, t: 0.09 }); tone({ f: 1320, type: 'sine', dur: 0.4, vol: 0.12, t: 0.16 }); };
  R.wild = () => {
    R.slideWhistle(true, 0.14);
    [523.25, 659.25, 783.99].forEach((f, i) => brass({ f, t: 0.1 + i * 0.07, dur: 0.4, vol: 0.09, lp: 1800 }));
    tone({ f: 130.8, dur: 0.3, vol: 0.28, type: 'triangle' });
    at(0.33, R.hic);
  };
  R.scatter = (k) => {
    const f = 1318.5 * (1 + (k || 1) * 0.12);
    tone({ f, dur: 1.0, vol: 0.3 }); tone({ f: f * 2.01, dur: 0.7, vol: 0.14 }); tone({ f: f * 2.76, dur: 0.5, vol: 0.08 });
    tone({ f: 90, to: 50, dur: 0.3, vol: 0.4 });
  };
  R.anticip = () => {
    noise({ type: 'highpass', f: 400, to: 6000, dur: 1.5, vol: 0.2, attack: 1.0, q: 2 });
    tone({ f: 220, to: 1100, type: 'sawtooth', dur: 1.5, vol: 0.06, lp: 600, lpTo: 4000, attack: 0.9 });
  };
  R.fanfare = () => {
    [[261.63, 0], [329.63, 0], [392, 0], [523.25, 0.32], [659.25, 0.32], [783.99, 0.32], [1046.5, 0.7], [1318.5, 0.7], [1567.98, 0.7]].forEach(([f, t]) => brass({ f, t, dur: 0.85, vol: 0.075, lp: 2200, drift: 24 }));
    kazoo({ f: 784, to: 1046, t: 0.7, dur: 0.5, vol: 0.07 });
    tone({ f: 65.4, t: 0, dur: 1.6, vol: 0.4 }); tone({ f: 98, t: 0.7, dur: 1.2, vol: 0.3 });
    noise({ f: 3000, to: 200, dur: 0.6, vol: 0.12, t: 0.7 });
    R.clink(0);
  };
  R.tick = (i) => tone({ f: 800 + (i % 14) * 50, type: 'square', dur: 0.025, vol: 0.05, lp: 3000 });
  R.coin = () => { tone({ f: 1760, dur: 0.12, type: 'square', vol: 0.06, lp: 4000 }); tone({ f: 2349, t: 0.06, dur: 0.18, type: 'square', vol: 0.06, lp: 4000 }); };
  R.coinPing = () => { const f = rnd(2300, 3900); tone({ f, type: 'sine', dur: 0.14, vol: rnd(0.03, 0.06), attack: 0.001 }); tone({ f: f * 1.5, type: 'sine', dur: 0.08, vol: 0.02, attack: 0.001 }); noise({ type: 'highpass', f: 5500, dur: 0.015, vol: 0.03 }); };
  R.coinShower = (n, dur) => { n = n || 12; dur = dur || 1; for (let i = 0; i < n; i++) at(Math.pow(Math.random(), 0.8) * dur, R.coinPing); };
  R.hic = () => {
    noise({ type: 'bandpass', f: 1800, dur: 0.05, vol: 0.12, q: 1.4 });
    tone({ f: 330, to: 640, type: 'sawtooth', dur: 0.07, vol: 0.09, lp: 1400, t: 0.02 });
    tone({ f: 560, to: 210, type: 'square', dur: 0.1, vol: 0.07, lp: 900, t: 0.09 });
    noise({ type: 'highpass', f: 3500, dur: 0.02, vol: 0.1, t: 0.09 });
  };
  R.clink = (n, delay) => {
    const d = delay || 0, k = 1 + ((n || 0) % 4) * 0.06;
    [[2637, 0.14, 0.7], [3520 * k, 0.12, 0.5], [4186 * k, 0.09, 0.4], [5587, 0.06, 0.3]].forEach(([f, v, dur]) => tone({ f, type: 'sine', dur, vol: v, t: d, attack: 0.001 }));
    noise({ type: 'highpass', f: 6000, dur: 0.02, vol: 0.08, t: d });
    [[2349 * k, 0.1, 0.55], [3136 * k, 0.07, 0.4]].forEach(([f, v, dur]) => tone({ f, type: 'sine', dur, vol: v, t: d + 0.11, attack: 0.001 }));
  };
  R.cheer = (tier) => {
    const sw = 1.6 + (tier || 0) * 0.35;
    noise({ type: 'bandpass', f: 900, to: 1700, dur: sw, vol: 0.12, attack: 0.35, q: 0.5 });
    noise({ type: 'bandpass', f: 2600, dur: sw * 0.9, vol: 0.06, attack: 0.3, q: 0.7 });
    for (let i = 0; i < 18 + (tier || 0) * 6; i++) noise({ type: 'bandpass', f: 500 + Math.random() * 2600, dur: 0.05 + Math.random() * 0.05, vol: 0.05 + Math.random() * 0.06, t: Math.random() * sw * 0.9, q: 1.2 });
    [0, 0.12, 0.26].forEach((t, i) => tone({ f: 260 + i * 40, to: 420 + i * 60, type: 'sawtooth', dur: 0.55, vol: 0.025, lp: 900, lpTo: 1500, t: 0.1 + t, attack: 0.1 }));
  };
  R.slideWhistle = (up, delay) => {
    if (!ctx || !on) return;
    const t = ctx.currentTime + off + (delay || 0), dur = 0.42, a = (up ? 480 : 2100) * pv, b = (up ? 2100 : 420) * pv;
    const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.setValueAtTime(a, t); osc.frequency.exponentialRampToValueAtTime(b, t + dur);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 9; const lg = ctx.createGain(); lg.gain.value = 22; lfo.connect(lg); lg.connect(osc.detune);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.11, t + 0.04); g.gain.setValueAtTime(0.11, t + dur * 0.75); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(sfxG); osc.start(t); lfo.start(t); osc.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
    noise({ type: 'bandpass', f: up ? 1800 : 2400, dur: dur * 0.8, vol: 0.015, t: delay || 0, q: 3 });
  };
  // rubber-band "boing": sine with a decaying vibrato
  R.boing = () => {
    if (!ctx || !on) return;
    const t = T({}), dur = 0.55, osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.setValueAtTime(300 * pv, t); osc.frequency.exponentialRampToValueAtTime(150 * pv, t + dur);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 17; const lg = ctx.createGain(); lg.gain.setValueAtTime(520, t); lg.gain.exponentialRampToValueAtTime(8, t + dur); lfo.connect(lg); lg.connect(osc.detune);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(sfxG); osc.start(t); lfo.start(t); osc.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  };
  // party blower: toot with a noisy rising reed
  R.horn = () => { kazoo({ f: 440, to: 880, dur: 0.45, vol: 0.07 }); noise({ type: 'bandpass', f: 1500, to: 4200, dur: 0.45, vol: 0.05, q: 1.5, attack: 0.1 }); };
  R.drop = () => {
    if (!ctx || !on) return;
    const t = T({}), ws = ctx.createWaveShaper(), curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 3); } ws.curve = curve;
    const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.setValueAtTime(190 * pv, t); osc.frequency.exponentialRampToValueAtTime(34 * pv, t + 0.9);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    osc.connect(ws); ws.connect(g); g.connect(sfxG); osc.start(t); osc.stop(t + 1.2);
    noise({ type: 'lowpass', f: 4000, to: 120, dur: 0.5, vol: 0.4, q: 1 });
    tone({ f: 70, to: 40, type: 'sawtooth', dur: 0.7, vol: 0.2, lp: 300 });
  };
  R.sting = () => {
    [[392, 0], [440, 0.1], [392, 0.2], [523.25, 0.34], [659.25, 0.5]].forEach(([f, t]) => kazoo({ f: f * (1 + (Math.random() - 0.5) * 0.02), to: f * 1.015, t, dur: 0.16, vol: 0.08 }));
    kazoo({ f: 784, to: 740, t: 0.7, dur: 0.6, vol: 0.09 });
    brass({ f: 130.8, t: 0.5, dur: 0.9, vol: 0.12, lp: 700 });
    R.slideWhistle(false, 0.7); at(1.0, R.hic);
  };
  R.bonusStart = () => { R.boing(); at(0.06, R.sting); R.flutter(16, 0.9); at(0.2, R.horn); };
  R.retrigger = () => {
    [[523.25, 0], [659.25, 0.09], [783.99, 0.18], [1046.5, 0.27]].forEach(([f, t]) => kazoo({ f, to: f * 1.02, t, dur: 0.2, vol: 0.08 }));
    brass({ f: 261.63, t: 0.27, dur: 0.8, vol: 0.1, lp: 1600 }); brass({ f: 392, t: 0.27, dur: 0.8, vol: 0.07, lp: 1600 });
    R.slam(0.7); R.slideWhistle(true, 0.1); at(0.3, () => R.coinShower(12, 0.7)); R.flutter(10, 0.6);
  };
  R.bonusEnd = (lvl) => { R.fanfare(); R.cheer(lvl == null ? 2 : lvl); R.clink(2); R.flutter(14, 1.0); at(0.9, () => R.coinShower(14, 1.2)); };
  R.nice = () => { [523.25, 659.25, 783.99].forEach((f, i) => tone({ f, t: i * 0.07, type: 'triangle', dur: 0.4, vol: 0.1 })); tone({ f: 1046.5, t: 0.21, type: 'sine', dur: 0.5, vol: 0.06 }); };
  R.tasty = () => { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone({ f, t: i * 0.065, type: 'triangle', dur: 0.45, vol: 0.12 })); R.cheer(0); at(0.3, R.hic); };
  // win ladder 1..4 (Close Enough, Ballot Bender, Mega Landslide, The World Is Yours): more notes, more bass, brass, shower
  R.big = (lvl) => {
    lvl = Math.max(1, Math.min(4, Math.round(lvl || 1)));
    const n = 5 + lvl * 3, deg = [0, 2, 4, 7, 9, 11, 14, 16, 18, 21, 23, 25];
    for (let i = 0; i < n; i++) tone({ f: MAJ[deg[i % deg.length] % MAJ.length] * (i >= 8 ? 2 : 1) * (i >= 12 ? 0.5 : 1), t: i * 0.075, type: 'triangle', dur: 0.4, vol: 0.09 + 0.05 * (i / n) });
    noise({ type: 'bandpass', f: 1200, dur: 2.2, vol: 0.07, attack: 0.5, q: 0.6 });
    tone({ f: 65.4, dur: 1.4, vol: 0.34 }); tone({ f: 130.8, t: 0.2, dur: 1.2, vol: 0.18 });
    R.slideWhistle(true, 0); R.cheer(lvl);
    for (let i = 0; i < Math.min(lvl, 4); i++) R.clink(i + 1, 0.2 + i * 0.18);
    if (lvl >= 2) at(0.25, () => R.coinShower(6 + lvl * 4, 1.2 + lvl * 0.3));
    if (lvl >= 3) { at(0.35, () => R.slam(0.85)); [261.63, 329.63, 392, 523.25].forEach((f) => brass({ f, t: n * 0.075, dur: 0.9, vol: 0.06, lp: 2000, drift: 22 })); }
    if (lvl >= 4) { at(0.6, () => { R.fanfare(); R.flutter(20, 1.2); }); }
  };
  R.nearMiss = () => { [[392, 0], [329.63, 0.18]].forEach(([f, t]) => kazoo({ f, to: f * 0.97, t, dur: 0.17, vol: 0.07 })); kazoo({ f: 207.65, to: 175, t: 0.36, dur: 0.6, vol: 0.08 }); R.slideWhistle(false, 0.4); };
  R.oneShort = () => { R.slideWhistle(false, 0); brass({ f: 196, to: 146.8, t: 0.12, dur: 0.5, vol: 0.08, lp: 900 }); };
  R.talk = (len) => {
    const n = Math.max(3, Math.min(8, Math.round((len || 18) / 5))), base = rnd(240, 340);
    noise({ type: 'bandpass', f: 1800, to: 700, dur: 0.04, vol: 0.04 });
    for (let i = 0; i < n; i++) tone({ f: base * rnd(0.85, 1.4), to: base * rnd(0.8, 1.5), type: 'triangle', dur: 0.05, vol: 0.04, t: 0.03 + i * 0.055, lp: 1800 });
  };

  const GAP = { click: 40, bet: 40, tick: 25, pop: 45, land: 25, colDrop: 20, coinPing: 10, talk: 500, hic: 120, chime: 60, clink: 70, grow: 60, slam: 60, lockIn: 90, stamp: 200 };
  const JIT = { chime: 0.015, scatter: 0.02, tick: 0.0, click: 0.02, bet: 0.02, nearMiss: 0.01, boing: 0.06, talk: 0.08, big: 0.012, nice: 0.01, tasty: 0.01, fanfare: 0.01, retrigger: 0.01, bonusEnd: 0.01, bonusStart: 0.01, sting: 0.01 };
  const api = {
    init,
    get on() { return on; },
    isOn() { return on; },
    get log() { return log; },
    get ctx() { return ctx; },
    get names() { return Object.keys(R); },
    state() { return { on, ctx: ctx ? ctx.state : 'none', masterGain: master ? master.gain.value : null, musicOn, musicGain: musG ? musG.gain.value : null, sfxGain: sfxG ? sfxG.gain.value : null }; },
    get musicOn() { return musicOn; },
    isMusicOn() { return musicOn; },
    // SFX switch: silences every event (and anything already ringing); music is untouched
    toggle() { return api.setSfxEnabled(!on); },
    setSfxEnabled(v) {
      on = !!v; writePref(on);
      if (sfxG) { sfxG.gain.cancelScheduledValues(ctx.currentTime); sfxG.gain.setValueAtTime(on ? 0.9 : 0, ctx.currentTime); }
      return on;
    },
    // MUSIC switch: the synthesized bed only; sound effects are untouched
    toggleMusic() { return api.setMusicEnabled(!musicOn); },
    setMusicEnabled(v) {
      v = !!v; const changed = v !== musicOn; musicOn = v; writeMusicPref(v);
      if (musG) { musG.gain.cancelScheduledValues(ctx.currentTime); musG.gain.setValueAtTime(v ? 0.55 : 0, ctx.currentTime); }
      if (!v) api.musicStop(); else if (musicMode) { const m = musicMode; musicMode = null; api.music(m); }
      if (changed) try { window.dispatchEvent(new CustomEvent('bender:music', { detail: { value: v } })); } catch (e) { /* no window */ }
      return musicOn;
    },
    // analyser tap for tests/diagnostics: peak and rms of the last 2048 samples at the final output
    level() {
      if (!analyser) return { peak: 0, rms: 0 };
      const b = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(b);
      let p = 0, s = 0; for (let i = 0; i < b.length; i++) { const a = Math.abs(b[i]); if (a > p) p = a; s += b[i] * b[i]; }
      return { peak: p, rms: Math.sqrt(s / b.length) };
    },
    // render one event through an OfflineAudioContext (full graph incl. compressor + ceiling shaper). Used by qa/bb-audio.
    async render(name, args, secs) {
      const fn = R[name]; if (!fn) throw new Error('no such sfx ' + name);
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext, sr = 44100, oc = new OAC(2, Math.ceil(sr * ((secs || 3) + 0.1)), sr);
      const saved = { ctx, comp, master, sfxG, musG, shaper, noiseBuf, on, off, pv }; on = true; off = 0.1; pv = 1; // 100 ms lead-in so the compressor is past its startup when the event begins
      use(makeGraph(oc), oc);
      try { fn(...(args || [])); } finally { ({ comp, master, sfxG, musG, shaper, noiseBuf, on, off, pv } = saved); ctx = saved.ctx; }
      const buf = await oc.startRendering(), d0 = buf.getChannelData(0), d1 = buf.getChannelData(1);
      let peak = 0, sum = 0, lastLoud = 0, firstLoud = -1;
      for (let i = 0; i < d0.length; i++) { const a = Math.max(Math.abs(d0[i]), Math.abs(d1[i])); if (a > peak) peak = a; if (a > 0.0015) { lastLoud = i; if (firstLoud < 0) firstLoud = i; } }
      const n = Math.max(1, lastLoud - Math.max(0, firstLoud) + 1);
      for (let i = Math.max(0, firstLoud); i <= lastLoud; i++) sum += d0[i] * d0[i];
      return { peak, rms: Math.sqrt(sum / n), durMs: firstLoud < 0 ? 0 : Math.round((lastLoud - firstLoud) / sr * 1000), startMs: firstLoud < 0 ? 0 : Math.max(0, Math.round(firstLoud / sr * 1000) - 100) };
    },

    music(mode) {
      if (!ctx || !musicOn || bedHeld) { musicMode = mode; return; }
      if (musicMode === mode && musicTimer) return;
      api.musicStop(); musicMode = mode; step = 0; nextT = ctx.currentTime + 0.1;
      const bonus = mode === 'bonus', bpm = bonus ? 124 : 110, sixteenth = 60 / bpm / 4;
      const roots = [65.41, 87.31, 98, 65.41], fifths = [98, 130.81, 146.83, 98];
      const chords = [[261.63, 329.63, 392], [261.63, 349.23, 440], [246.94, 392, 587.33], [261.63, 329.63, 392]];
      const lead = [4, 4, 5, 4, 2, 4, 7, 4, 5, 5, 4, 2, 0, 2, 4, 2, 4, 5, 7, 5, 4, 2, 0, 2, 4, 4, 5, 4, 7, 9, 7, 4];
      const sched = () => {
        while (nextT < ctx.currentTime + 0.25) {
          const s = step % 64, bar = Math.floor(s / 16) % 4, k = s % 16, D = musG;
          const t = nextT - ctx.currentTime + Math.random() * 0.018;
          if (k === 0 || k === 8) brass({ f: k === 0 ? roots[bar] : fifths[bar], dur: sixteenth * 3.2, vol: bonus ? 0.2 : 0.17, t, dest: D, lp: 520, drift: 18 });
          if (k === 4 || k === 12) chords[bar].forEach((f) => brass({ f: f / 2, dur: sixteenth * 2.2, vol: 0.05, t, dest: D, lp: 1500, drift: 22 }));
          if (k === 0 || k === 8) noise({ type: 'bandpass', f: 220, dur: 0.07, vol: 0.12, t, dest: D });
          if (k === 4 || k === 12) noise({ type: 'bandpass', f: 4200, dur: 0.05, vol: bonus ? 0.1 : 0.07, t, dest: D, q: 1.4 });
          if (bonus && k % 4 === 2) noise({ type: 'highpass', f: 7000, dur: 0.03, vol: 0.05, t, dest: D });
          const li = (s % 32), mel = lead[li];
          if (bonus) {
            if (k % 2 === 0) kazoo({ f: MAJ[mel % MAJ.length] * (1 + (Math.random() - 0.5) * 0.015), dur: sixteenth * 1.8, vol: 0.05, t, dest: D });
          } else if (k % 4 === 0 && Math.floor(s / 16) % 2 === 1 || (k === 8 && Math.floor(s / 16) % 2 === 0)) {
            brass({ f: MAJ[mel % MAJ.length] / 2 * (1 + (Math.random() - 0.5) * 0.03), to: MAJ[(mel + 1) % MAJ.length] / 2, dur: sixteenth * 3, vol: 0.05, t, dest: D, lp: 1800, drift: 30 });
          }
          if (k === 15 && bar === 3 && Math.random() < 0.35) at(t, R.hic);
          nextT += sixteenth; step++;
        }
      };
      musicTimer = setInterval(sched, 60); sched();
    },
    // the shell radio is audible: hold the synthesized bed (mode is remembered) and resume it when the radio stops
    holdBed(v) {
      bedHeld = !!v;
      if (bedHeld) api.musicStop(); else if (musicOn && musicMode && ctx) { const m = musicMode; musicMode = null; api.music(m); }
    },
    musicStop() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } },
    // duck music under big wins; a watchdog always restores it
    duck(on_) {
      if (!musG || !ctx) return;
      if (on_) try { const PM = window.parent !== window && window.parent.PingMusic; if (PM) PM.duck(2500, 0.5); } catch (e) { /* cross-origin */ }
      clearTimeout(duckTimer); const t = ctx.currentTime;
      musG.gain.cancelScheduledValues(t); musG.gain.setTargetAtTime(!musicOn ? 0 : on_ ? 0.18 : 0.55, t, 0.1);
      if (on_) duckTimer = setTimeout(() => api.duck(false), 20000);
    },
  };

  // generate wrapped public events from R (skip internals that need no wrapper)
  Object.keys(R).forEach((name) => {
    api[name] = (...a) => {
      const rec = { n: name, a, wall: performance.now(), t: ctx ? ctx.currentTime : null, ok: false };
      log.push(rec); if (log.length > 800) log.shift();
      if (!ctx || !on) { rec.skip = !ctx ? 'noctx' : 'muted'; return; }
      const now = rec.wall, gap = GAP[name] || 0;
      if (gap && last[name] && now - last[name] < gap) { rec.skip = 'throttle'; return; }
      last[name] = now; pv = 1 + (Math.random() * 2 - 1) * (JIT[name] == null ? 0.04 : JIT[name]); off = 0;
      try { R[name](...a); rec.ok = true; } finally { pv = 1; off = 0; }
    };
  });
  return api;
})();
window.BenderAudio = SFX;
