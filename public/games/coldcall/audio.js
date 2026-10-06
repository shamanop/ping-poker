/* COLD CALL audio: all synthesized WebAudio, no sample files. Call-center flavour: dial clicks, phone ring, hold music, cash register.
   Two independent switches, persisted in localStorage ping.sfx / ping.music (same keys as Ballot Bender, so the setting is shared).
   The AudioContext is created / resumed on a user gesture only (SFX.init() is called from pointer/key handlers). */
const SFX = (() => {
  let ctx, comp, sfxG, musG, duckG, noiseBuf, musicTimer = null, musicMode = null, step = 0, nextT = 0;
  const ls = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
  const off = (v) => v !== null && /^(0|off|false|mute|muted|no)$/i.test(v);
  let sfxOn = !off(ls('ping.sfx')), musicOn = !off(ls('ping.music'));
  const MAJ = [523.25, 587.33, 659.25, 698.46, 783.99, 880, 987.77, 1046.5, 1174.66, 1318.51, 1396.91, 1567.98];

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ctx = new AC(); if (ctx.state === 'suspended') ctx.resume();
    comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
    sfxG = ctx.createGain(); sfxG.gain.value = sfxOn ? 0.9 : 0;
    musG = ctx.createGain(); musG.gain.value = musicOn ? 1 : 0;
    duckG = ctx.createGain(); duckG.gain.value = 0.5;          // music bus level, ducked under wins
    musG.connect(duckG); duckG.connect(comp); sfxG.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (musicMode && musicOn) { const m = musicMode; musicMode = null; api.music(m); }
  }
  const live = (o) => ctx && (o.dest === musG ? musicOn : sfxOn);
  function tone(o) {
    if (!live(o)) return;
    const t = ctx.currentTime + (o.t || 0), dur = o.dur || 0.2, a = o.attack || 0.004, vol = o.vol == null ? 0.2 : o.vol;
    const osc = ctx.createOscillator(); osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(o.f, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = osc;
    if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; osc.connect(f); node = f; }
    node.connect(g); g.connect(o.dest || sfxG); osc.start(t); osc.stop(t + dur + 0.05);
  }
  function noise(o) {
    if (!live(o)) return;
    const t = ctx.currentTime + (o.t || 0), dur = o.dur || 0.1;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = o.type || 'lowpass'; f.frequency.setValueAtTime(o.f || 1500, t); if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur); f.Q.value = o.q || 0.8;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(o.vol || 0.15, t + (o.attack || 0.004)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(o.dest || sfxG); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }
  // North-American ring: 440 + 480 Hz together, 0.4 s on, 0.2 s off, twice
  function ring(t0 = 0, rounds = 2, vol = 0.1) { for (let i = 0; i < rounds; i++) for (const f of [440, 480]) tone({ f, t: t0 + i * 0.6, dur: 0.4, vol, attack: 0.01, type: 'sine' }); }

  const api = {
    init,
    isSfx: () => sfxOn, isMusic: () => musicOn,
    debug: () => ({ ctx: ctx ? ctx.state : 'none', music: !!musicTimer, sfx: sfxOn, musicOn, sfxGain: sfxG ? sfxG.gain.value : null, musGain: musG ? musG.gain.value : null }),
    setSfx(on) { sfxOn = !!on; lsSet('ping.sfx', sfxOn ? '1' : '0'); if (sfxG) sfxG.gain.value = sfxOn ? 0.9 : 0; return sfxOn; },
    setMusic(on) {
      musicOn = !!on; lsSet('ping.music', musicOn ? '1' : '0'); if (musG) musG.gain.value = musicOn ? 1 : 0;
      if (!musicOn) api.musicStop(); else if (musicMode) { const m = musicMode; musicMode = null; api.music(m); }
      return musicOn;
    },
    click() { tone({ f: 1500, to: 900, type: 'triangle', dur: 0.04, vol: 0.1 }); },
    // rotary-dial pulses: n short clicks
    dialPulses(n, gap = 0.07) { for (let i = 0; i < n; i++) { tone({ f: 2300, to: 1600, type: 'square', dur: 0.014, vol: 0.05, t: i * gap, lp: 4000 }); noise({ type: 'bandpass', f: 3000, dur: 0.012, vol: 0.06, t: i * gap, q: 2 }); } },
    dialTick() { tone({ f: 2100, to: 1500, type: 'square', dur: 0.016, vol: 0.06, lp: 4000 }); noise({ type: 'bandpass', f: 2800, dur: 0.012, vol: 0.07, q: 2 }); },
    dialWhirr(ms) { noise({ type: 'bandpass', f: 500, to: 1400, dur: Math.max(0.2, ms / 1000), vol: 0.07, q: 3, attack: 0.05 }); },
    dialStop() { tone({ f: 220, to: 110, dur: 0.12, vol: 0.3 }); noise({ f: 1200, to: 200, dur: 0.06, vol: 0.15 }); },
    spin() { api.dialPulses(5, 0.06); noise({ f: 300, to: 2000, dur: 0.35, vol: 0.1, q: 1.2, attack: 0.08 }); },
    land(heavy) { tone({ f: heavy ? 170 : 130, to: 55, dur: 0.12, vol: heavy ? 0.4 : 0.26 }); noise({ f: 900, to: 200, dur: 0.06, vol: heavy ? 0.16 : 0.09 }); },
    phone(k) { ring(0, 1, 0.1); tone({ f: 1318.5 * (1 + 0.1 * k), dur: 0.5, vol: 0.12, t: 0.05 }); },
    ringing() { ring(0, 3, 0.08); },
    tease() { ring(0, 4, 0.07); noise({ type: 'highpass', f: 400, to: 5000, dur: 2.2, vol: 0.1, attack: 1.5, q: 1.5 }); },
    chime(n) { const f = MAJ[Math.min(n, MAJ.length - 1)]; tone({ f, dur: 0.5, vol: 0.18 }); tone({ f: f * 2, type: 'triangle', dur: 0.35, vol: 0.07 }); },
    pop() { tone({ f: 520, to: 1100, type: 'triangle', dur: 0.09, vol: 0.14 }); noise({ type: 'bandpass', f: 2600, dur: 0.05, vol: 0.06, q: 1.4 }); },
    whoosh() { noise({ type: 'bandpass', f: 700, to: 2600, dur: 0.28, vol: 0.09, q: 1.2, attack: 0.05 }); },
    thunk() { tone({ f: 150, to: 70, dur: 0.1, vol: 0.3 }); },
    coin() { tone({ f: 1760, dur: 0.1, type: 'square', vol: 0.05, lp: 4000 }); tone({ f: 2349, t: 0.06, dur: 0.16, type: 'square', vol: 0.05, lp: 4000 }); },
    tick(i) { tone({ f: 800 + (i % 14) * 50, type: 'square', dur: 0.022, vol: 0.04, lp: 3000 }); },
    // cash register: drawer thunk, bell, coins
    register() {
      noise({ type: 'lowpass', f: 1200, to: 300, dur: 0.12, vol: 0.2 }); tone({ f: 120, to: 60, dur: 0.12, vol: 0.25 });
      for (const [f, t] of [[2637, 0.08], [3520, 0.08], [2093, 0.2]]) tone({ f, t, dur: 0.9, vol: 0.1, attack: 0.001 });
      for (let i = 0; i < 6; i++) tone({ f: 3000 + Math.random() * 1500, t: 0.3 + i * 0.045, dur: 0.05, vol: 0.05, attack: 0.001 });
    },
    field(i) { [0, 4, 7, 12].slice(0, 2 + i).forEach((s, k) => tone({ f: 523.25 * Math.pow(2, s / 12), t: k * 0.07, dur: 0.4, vol: 0.14, type: 'triangle' })); },
    accepted() {
      api.register();
      [[523.25, 0], [659.25, 0], [783.99, 0], [1046.5, 0.25], [1318.5, 0.25], [1567.98, 0.25], [2093, 0.55]].forEach(([f, t]) => tone({ f, t, dur: 0.9, vol: 0.09, type: 'triangle' }));
      tone({ f: 65.4, dur: 1.2, vol: 0.3 });
    },
    sting() { [[392, 0], [494, 0.1], [587, 0.2], [784, 0.34]].forEach(([f, t]) => tone({ f, t, dur: 0.3, vol: 0.12, type: 'triangle' })); ring(0.5, 1, 0.07); },
    win(lvl) { [0, 4, 7, 12, 16].slice(0, 2 + lvl).forEach((s, k) => tone({ f: 523.25 * Math.pow(2, s / 12), t: k * 0.08, dur: 0.5, vol: 0.14, type: 'triangle' })); if (lvl >= 2) api.register(); },
    big(lvl) {
      const n = 6 + lvl * 3;
      for (let i = 0; i < n; i++) tone({ f: MAJ[(i * 2) % 9] * (i > n / 2 ? 2 : 1), t: i * 0.07, type: 'triangle', dur: 0.35, vol: 0.12 });
      tone({ f: 65.4, dur: 1.3, vol: 0.35 }); noise({ type: 'bandpass', f: 1200, dur: 2, vol: 0.06, attack: 0.5, q: 0.6 });
      for (let i = 0; i < Math.min(lvl, 4); i++) setTimeout(() => api.register(), 300 + i * 420);
    },
    // ---- v2 board events (all synthesized). Cluster pop rises in pitch with every cascade step.
    clusterPop(i) { const f = 392 * Math.pow(2, Math.min(i, 12) / 7); tone({ f, to: f * 1.5, type: 'triangle', dur: 0.14, vol: 0.16 }); tone({ f: f * 2, t: 0.05, type: 'sine', dur: 0.2, vol: 0.07 }); noise({ type: 'bandpass', f: 2600, dur: 0.06, vol: 0.07, q: 1.4 }); },
    hot(n) { for (let k = 0; k < Math.min(n, 3); k++) { tone({ f: 880 * Math.pow(2, k / 6), to: 1320 * Math.pow(2, k / 6), t: k * 0.06, type: 'square', dur: 0.07, vol: 0.05, lp: 3500 }); noise({ type: 'highpass', f: 3000, t: k * 0.06, dur: 0.04, vol: 0.06 }); } },
    sweep() { noise({ type: 'bandpass', f: 2600, to: 500, dur: 0.3, vol: 0.1, q: 1.1, attack: 0.03 }); tone({ f: 640, to: 220, type: 'sine', dur: 0.28, vol: 0.08 }); },
    fall() { tone({ f: 150, to: 75, dur: 0.1, vol: 0.14 }); noise({ f: 700, to: 200, dur: 0.08, vol: 0.06 }); },
    phoneRing() { ring(0, 3, 0.1); tone({ f: 1318.5, t: 0.05, dur: 0.4, vol: 0.06 }); noise({ type: 'bandpass', f: 1800, t: 1.82, dur: 0.05, vol: 0.12, q: 2 }); },   // three rings, then the handset lifts
    reveal(t) {
      if (t === 0) { tone({ f: 660, to: 760, type: 'triangle', dur: 0.12, vol: 0.12 }); }
      else if (t === 1) { tone({ f: 880, type: 'triangle', dur: 0.2, vol: 0.12 }); tone({ f: 1318.5, t: 0.06, type: 'sine', dur: 0.3, vol: 0.08 }); }
      else { [1046.5, 1318.5, 1568, 2093].forEach((f, k) => tone({ f, t: k * 0.06, type: 'triangle', dur: 0.5, vol: 0.12 })); api.coin(); }
    },
    upsellReveal() { tone({ f: 330, to: 990, type: 'sawtooth', dur: 0.2, vol: 0.06, lp: 2200 }); },
    closeReveal() { tone({ f: 196, to: 98, type: 'triangle', dur: 0.25, vol: 0.22 }); tone({ f: 392, type: 'square', dur: 0.1, vol: 0.05, lp: 1800 }); },
    upsell(m) { const s = m >= 10 ? 14 : m >= 5 ? 9 : m >= 3 ? 5 : 0; [0, 4, 7].forEach((x, k) => tone({ f: 440 * Math.pow(2, (s + x) / 12), t: k * 0.07, type: 'triangle', dur: 0.4, vol: 0.13 })); },
    upsellHit() { tone({ f: 1760, to: 2637, type: 'square', dur: 0.07, vol: 0.05, lp: 4000 }); },
    closeStart() { noise({ type: 'bandpass', f: 400, to: 1800, dur: 0.45, vol: 0.12, q: 2, attack: 0.25 }); tone({ f: 110, to: 220, type: 'triangle', dur: 0.45, vol: 0.15, attack: 0.2 }); },
    collect(i) { tone({ f: 1200 * Math.pow(2, Math.min(i, 12) / 12), type: 'triangle', dur: 0.1, vol: 0.1 }); tone({ f: 2400 * Math.pow(2, Math.min(i, 12) / 12), t: 0.03, type: 'sine', dur: 0.12, vol: 0.04 }); },
    stamp() { tone({ f: 95, to: 48, dur: 0.22, vol: 0.4 }); noise({ f: 900, to: 150, dur: 0.12, vol: 0.2 }); api.register(); },
    bonusIntro() { [[392, 0], [494, 0.09], [587, 0.18], [784, 0.27], [988, 0.4], [1175, 0.52]].forEach(([f, t]) => tone({ f, t, dur: 0.4, vol: 0.12, type: 'triangle' })); ring(0.7, 2, 0.08); tone({ f: 98, dur: 0.9, vol: 0.3 }); },
    spinsAdded(n) { const k = n >= 4 ? 4 : 2; for (let i = 0; i < k; i++) { tone({ f: 1046.5 * Math.pow(2, [0, 4, 7, 12][i] / 12), t: i * 0.1, dur: 0.6, vol: 0.1, type: 'triangle' }); tone({ f: 2093, t: i * 0.1, dur: 0.4, vol: 0.03, type: 'sine' }); } },
    upgrade() { [[523, 0], [659, 0.08], [784, 0.16], [1046, 0.24], [1318, 0.4], [1568, 0.4], [2093, 0.4]].forEach(([f, t]) => tone({ f, t, dur: 0.8, vol: 0.09, type: 'triangle' })); tone({ f: 65.4, dur: 1.1, vol: 0.32 }); },
    // hold music: soft electric-piano arpeggio over a walking bass, jazzy muzak. base = 96 bpm, bonus = 126 bpm and brighter.
    music(mode) {
      musicMode = mode;
      if (!ctx || !musicOn) return;
      if (musicTimer && musicMode === mode && api._mm === mode) return;
      api.musicStop(); api._mm = mode; step = 0; nextT = ctx.currentTime + 0.1;
      const bonus = mode === 'bonus', sixteenth = 60 / (bonus ? 126 : 96) / 4;
      const chords = [[261.63, 329.63, 392, 493.88], [220, 261.63, 329.63, 392], [293.66, 349.23, 440, 523.25], [196, 246.94, 293.66, 349.23]];
      const bass = [65.41, 55, 73.42, 49];
      const sched = () => {
        while (nextT < ctx.currentTime + 0.25) {
          const s = step % 64, bar = (s >> 4) % 4, k = s % 16, t = nextT - ctx.currentTime, ch = chords[bar];
          if (k % 4 === 0) tone({ f: bass[bar] * (k === 8 ? 1.5 : 1), t, dur: sixteenth * 3, vol: 0.2, type: 'triangle', dest: musG, lp: 600 });
          if (k % 2 === 0 || bonus) { const f = ch[[0, 1, 2, 3, 2, 1, 2, 3][(k >> 1) % 8]] * (bonus && k % 4 === 3 ? 2 : 1); tone({ f, t, dur: sixteenth * 2.4, vol: bonus ? 0.075 : 0.06, type: 'sine', dest: musG, attack: 0.01 }); tone({ f: f * 2, t, dur: sixteenth * 1.2, vol: 0.02, type: 'sine', dest: musG }); }
          if (k === 4 || k === 12) noise({ type: 'highpass', f: 6000, dur: 0.03, vol: 0.03, t, dest: musG });
          nextT += sixteenth; step++;
        }
      };
      musicTimer = setInterval(sched, 60); sched();
    },
    musicStop() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } api._mm = null; },
    duck(on) { if (!duckG || !ctx) return; duckG.gain.cancelScheduledValues(ctx.currentTime); duckG.gain.linearRampToValueAtTime(on ? 0.12 : 0.5, ctx.currentTime + 0.25); }
  };
  return api;
})();
