/* BALLOT BENDER audio: all synthesized (no audio files). Drunken-carnival theme: wobbly oom-pah brass, slide whistles, hics, glass clinks, kazoo stings, crowd cheers. C major. */
const SFX = (() => {
  let ctx, master, sfxG, musG, noiseBuf, comp;
  let on = true, musicTimer = null, musicMode = null, step = 0, nextT = 0, musicOn = true;
  const PENT = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760, 2093, 2349.3];

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ctx = new AC();
    try { const el = document.createElement('audio'); el.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='; el.loop = true; el.play().catch(() => {}); } catch (e) {}
    comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
    master = ctx.createGain(); master.gain.value = on ? 0.85 : 0;
    sfxG = ctx.createGain(); sfxG.gain.value = 0.9;
    musG = ctx.createGain(); musG.gain.value = 0.55;
    sfxG.connect(comp); musG.connect(comp); comp.connect(master); master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function tone(o) {
    if (!ctx || !on) return;
    const t = ctx.currentTime + (o.t || 0), dur = o.dur || 0.2, a = o.attack || 0.004, vol = o.vol == null ? 0.25 : o.vol;
    const osc = ctx.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
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
    const t = ctx.currentTime + (o.t || 0), dur = o.dur || 0.15;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = o.type || 'lowpass'; f.frequency.setValueAtTime(o.f || 1500, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    f.Q.value = o.q || 0.8;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.2, t + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(o.dest || sfxG); src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  // ---- carnival voices ----
  const cents = (c) => Math.pow(2, c / 1200);
  // wobbly detuned brass: two detuned saws, lowpass bloom, vibrato that drifts
  function brass(o) {
    if (!ctx || !on) return;
    const t = ctx.currentTime + (o.t || 0), dur = o.dur || 0.3, vol = o.vol == null ? 0.12 : o.vol, drift = o.drift == null ? 14 : o.drift;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + (o.attack || 0.025));
    g.gain.setValueAtTime(vol, t + Math.max(0.03, dur * 0.6)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 2.5;
    f.frequency.setValueAtTime((o.lp || 900) * 0.45, t); f.frequency.exponentialRampToValueAtTime(o.lp || 900, t + 0.06); f.frequency.exponentialRampToValueAtTime((o.lp || 900) * 0.6, t + dur);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 4.2 + Math.random() * 2; const lg = ctx.createGain(); lg.gain.value = drift * 1.6;
    lfo.connect(lg);
    const fl = o.f * cents((Math.random() - 0.5) * drift);
    [-1, 1].forEach((s, i) => {
      const osc = ctx.createOscillator(); osc.type = i ? 'sawtooth' : 'square';
      osc.frequency.setValueAtTime(fl, t); if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur * 0.8);
      osc.detune.value = s * (8 + Math.random() * 10); lg.connect(osc.detune);
      osc.connect(f); osc.start(t); osc.stop(t + dur + 0.05);
    });
    lfo.start(t); lfo.stop(t + dur + 0.05);
    f.connect(g); g.connect(o.dest || sfxG);
  }
  // kazoo-ish buzz: square through nasal bandpass with fast vibrato and a little noise fizz
  function kazoo(o) {
    if (!ctx || !on) return;
    const t = ctx.currentTime + (o.t || 0), dur = o.dur || 0.2, vol = o.vol == null ? 0.1 : o.vol;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.setValueAtTime(vol, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1300; bp.Q.value = 1.6;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 6.5; const lg = ctx.createGain(); lg.gain.value = 28; lfo.connect(lg);
    const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.setValueAtTime(o.f, t); if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    lg.connect(osc.detune); osc.connect(bp); bp.connect(g); g.connect(o.dest || sfxG);
    lfo.start(t); osc.start(t); lfo.stop(t + dur + 0.05); osc.stop(t + dur + 0.05);
    noise({ type: 'bandpass', f: 2600, dur: dur * 0.8, vol: vol * 0.25, t: o.t || 0, q: 1, dest: o.dest });
  }
  // major-scale ladder (C major) for escalating cascade combos
  const MAJ = [523.25, 587.33, 659.25, 698.46, 783.99, 880, 987.77, 1046.5, 1174.66, 1318.51, 1396.91, 1567.98, 1760, 1975.53, 2093];

  const api = {
    init,
    get on() { return on; },
    isOn() { return on; },
    toggle() { on = !on; if (master) master.gain.value = on ? 0.85 : 0; if (!on) api.musicStop(); else if (musicMode) { const m = musicMode; musicMode = null; api.music(m); } return on; },
    click() { tone({ f: 1400, to: 900, type: 'triangle', dur: 0.05, vol: 0.12 }); },
    spin() { noise({ f: 300, to: 2400, dur: 0.38, vol: 0.18, q: 1.2, attack: 0.08 }); tone({ f: 180, to: 520, type: 'sawtooth', dur: 0.3, vol: 0.05, lp: 900 }); },
    land(heavy) { tone({ f: heavy ? 150 : 120, to: 48, dur: 0.14, vol: heavy ? 0.5 : 0.34 }); noise({ f: 900, to: 200, dur: 0.07, vol: heavy ? 0.22 : 0.12 }); },
    chime(n) {
      const f = MAJ[Math.min(n, MAJ.length - 1)];
      tone({ f, type: 'sine', dur: 0.6, vol: 0.24 }); tone({ f: f * 2, type: 'triangle', dur: 0.4, vol: 0.09 });
      tone({ f: f * 1.5, type: 'sine', dur: 0.45, vol: 0.06, t: 0.04 });
      brass({ f: f / 2, dur: 0.22, vol: 0.05, lp: 1400, drift: 20 });
      if (n >= 1) api.slideWhistle(true, 0.04 + Math.min(n, 8) * 0.012);
      if (n >= 3) api.clink(n - 3);
    },
    pop() { noise({ f: 2400, to: 300, dur: 0.13, vol: 0.22 }); tone({ f: 380, to: 130, dur: 0.1, vol: 0.18 }); tone({ f: 700, to: 240, type: 'triangle', dur: 0.08, vol: 0.12 }); },
    grow() { tone({ f: 660, type: 'triangle', dur: 0.18, vol: 0.2 }); tone({ f: 990, type: 'triangle', dur: 0.3, vol: 0.2, t: 0.09 }); tone({ f: 1320, type: 'sine', dur: 0.4, vol: 0.12, t: 0.16 }); },
    wild() {
      api.slideWhistle(true, 0.14);
      [523.25, 659.25, 783.99].forEach((f, i) => brass({ f, t: 0.1 + i * 0.07, dur: 0.4, vol: 0.09, lp: 1800 }));
      tone({ f: 130.8, dur: 0.3, vol: 0.28, type: 'triangle' });
      setTimeout(() => api.hic(), 330);
    },
    scatter(k) {
      const f = 1318.5 * (1 + k * 0.12);
      tone({ f, dur: 1.0, vol: 0.3 }); tone({ f: f * 2.01, dur: 0.7, vol: 0.14 }); tone({ f: f * 2.76, dur: 0.5, vol: 0.08 });
      tone({ f: 90, to: 50, dur: 0.3, vol: 0.4 });
    },
    anticip() {
      noise({ type: 'highpass', f: 400, to: 6000, dur: 1.5, vol: 0.2, attack: 1.0, q: 2 });
      tone({ f: 220, to: 1100, type: 'sawtooth', dur: 1.5, vol: 0.06, lp: 600, lpTo: 4000, attack: 0.9 });
    },
    fanfare() {
      [[261.63, 0], [329.63, 0], [392, 0], [523.25, 0.32], [659.25, 0.32], [783.99, 0.32], [1046.5, 0.7], [1318.5, 0.7], [1567.98, 0.7]].forEach(([f, t]) => {
        brass({ f, t, dur: 0.85, vol: 0.075, lp: 2200, drift: 24 });
      });
      kazoo({ f: 784, to: 1046, t: 0.7, dur: 0.5, vol: 0.07 });
      tone({ f: 65.4, t: 0, dur: 1.6, vol: 0.4 }); tone({ f: 98, t: 0.7, dur: 1.2, vol: 0.3 });
      noise({ f: 3000, to: 200, dur: 0.6, vol: 0.12, t: 0.7 });
      api.clink(0);
    },
    tick(i) { tone({ f: 800 + (i % 14) * 50, type: 'square', dur: 0.025, vol: 0.05, lp: 3000 }); },
    big(tier) {
      const n = 6 + tier * 3;
      for (let i = 0; i < n; i++) tone({ f: MAJ[(i * 2) % 9] * (i > n / 2 ? 2 : 1), t: i * 0.075, type: 'triangle', dur: 0.4, vol: 0.13 });
      noise({ type: 'bandpass', f: 1200, dur: 2.2, vol: 0.08, attack: 0.5, q: 0.6 });
      tone({ f: 65.4, dur: 1.4, vol: 0.4 }); tone({ f: 130.8, t: 0.2, dur: 1.2, vol: 0.2 });
      api.slideWhistle(true, 0); api.cheer(tier);
      for (let i = 0; i < Math.min(tier, 4); i++) api.clink(i + 1, 0.2 + i * 0.18);
      if (tier >= 3) setTimeout(() => api.drop(), 380);
    },
    coin() { tone({ f: 1760, dur: 0.12, type: 'square', vol: 0.06, lp: 4000 }); tone({ f: 2349, t: 0.06, dur: 0.18, type: 'square', vol: 0.06, lp: 4000 }); },

    // ---- Ballot Bender additions ----
    hic() {
      noise({ type: 'bandpass', f: 1800, dur: 0.05, vol: 0.12, q: 1.4 });
      tone({ f: 330, to: 640, type: 'sawtooth', dur: 0.07, vol: 0.09, lp: 1400, t: 0.02 });
      tone({ f: 560, to: 210, type: 'square', dur: 0.1, vol: 0.07, lp: 900, t: 0.09 });
      noise({ type: 'highpass', f: 3500, dur: 0.02, vol: 0.1, t: 0.09 });
    },
    clink(n, delay) {
      const d = delay || 0, k = 1 + ((n || 0) % 4) * 0.06;
      [[2637, 0.14, 0.7], [3520 * k, 0.12, 0.5], [4186 * k, 0.09, 0.4], [5587, 0.06, 0.3]].forEach(([f, v, dur]) => tone({ f, type: 'sine', dur, vol: v, t: d, attack: 0.001 }));
      noise({ type: 'highpass', f: 6000, dur: 0.02, vol: 0.08, t: d });
      [[2349 * k, 0.1, 0.55], [3136 * k, 0.07, 0.4]].forEach(([f, v, dur]) => tone({ f, type: 'sine', dur, vol: v, t: d + 0.11, attack: 0.001 }));
    },
    cheer(tier) {
      const sw = 1.6 + (tier || 0) * 0.35;
      noise({ type: 'bandpass', f: 900, to: 1700, dur: sw, vol: 0.12, attack: 0.35, q: 0.5 });
      noise({ type: 'bandpass', f: 2600, dur: sw * 0.9, vol: 0.06, attack: 0.3, q: 0.7 });
      for (let i = 0; i < 18 + (tier || 0) * 6; i++) noise({ type: 'bandpass', f: 500 + Math.random() * 2600, dur: 0.05 + Math.random() * 0.05, vol: 0.05 + Math.random() * 0.06, t: Math.random() * sw * 0.9, q: 1.2 });
      [0, 0.12, 0.26].forEach((t, i) => tone({ f: 260 + i * 40, to: 420 + i * 60, type: 'sawtooth', dur: 0.55, vol: 0.025, lp: 900, lpTo: 1500, t: 0.1 + t, attack: 0.1 }));
    },
    slideWhistle(up, delay) {
      if (!ctx || !on) return;
      const t = ctx.currentTime + (delay || 0), dur = 0.42, a = up ? 480 : 2100, b = up ? 2100 : 420;
      const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.setValueAtTime(a, t); osc.frequency.exponentialRampToValueAtTime(b, t + dur);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 9; const lg = ctx.createGain(); lg.gain.value = 22; lfo.connect(lg); lg.connect(osc.detune);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.11, t + 0.04); g.gain.setValueAtTime(0.11, t + dur * 0.75); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(sfxG); osc.start(t); lfo.start(t); osc.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
      noise({ type: 'bandpass', f: up ? 1800 : 2400, dur: dur * 0.8, vol: 0.015, t: delay || 0, q: 3 });
    },
    drop() {
      if (!ctx || !on) return;
      const t = ctx.currentTime;
      const ws = ctx.createWaveShaper(), curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 3); } ws.curve = curve;
      const osc = ctx.createOscillator(); osc.type = 'sine'; osc.frequency.setValueAtTime(190, t); osc.frequency.exponentialRampToValueAtTime(34, t + 0.9);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      osc.connect(ws); ws.connect(g); g.connect(sfxG); osc.start(t); osc.stop(t + 1.2);
      noise({ type: 'lowpass', f: 4000, to: 120, dur: 0.5, vol: 0.4, q: 1 });
      tone({ f: 70, to: 40, type: 'sawtooth', dur: 0.7, vol: 0.2, lp: 300 });
    },
    sting() {
      [[392, 0], [440, 0.1], [392, 0.2], [523.25, 0.34], [659.25, 0.5]].forEach(([f, t]) => kazoo({ f: f * (1 + (Math.random() - 0.5) * 0.02), to: f * 1.015, t, dur: 0.16, vol: 0.08 }));
      kazoo({ f: 784, to: 740, t: 0.7, dur: 0.6, vol: 0.09 });
      brass({ f: 130.8, t: 0.5, dur: 0.9, vol: 0.12, lp: 700 });
      api.slideWhistle(false, 0.7); setTimeout(() => api.hic(), 1000);
    },

    music(mode) {
      if (!ctx || !on || !musicOn) { musicMode = mode; return; }
      if (musicMode === mode && musicTimer) return;
      api.musicStop(); musicMode = mode; step = 0; nextT = ctx.currentTime + 0.1;
      const bonus = mode === 'bonus', bpm = bonus ? 124 : 110, sixteenth = 60 / bpm / 4;
      // C major oom-pah, I - IV - V - I (one bar each)
      const roots = [65.41, 87.31, 98, 65.41], fifths = [98, 130.81, 146.83, 98];
      const chords = [[261.63, 329.63, 392], [261.63, 349.23, 440], [246.94, 392, 587.33], [261.63, 329.63, 392]];
      const lead = [4, 4, 5, 4, 2, 4, 7, 4, 5, 5, 4, 2, 0, 2, 4, 2, 4, 5, 7, 5, 4, 2, 0, 2, 4, 4, 5, 4, 7, 9, 7, 4];
      const sched = () => {
        while (nextT < ctx.currentTime + 0.25) {
          const s = step % 64, bar = Math.floor(s / 16) % 4, k = s % 16, D = musG;
          // drunk timing: notes land a touch late, randomly
          const t = nextT - ctx.currentTime + Math.random() * 0.018;
          if (k === 0 || k === 8) brass({ f: k === 0 ? roots[bar] : fifths[bar], dur: sixteenth * 3.2, vol: bonus ? 0.2 : 0.17, t, dest: D, lp: 520, drift: 18 });
          if (k === 4 || k === 12) chords[bar].forEach((f) => brass({ f: f / 2, dur: sixteenth * 2.2, vol: 0.05, t, dest: D, lp: 1500, drift: 22 }));
          if (k === 0 || k === 8) noise({ type: 'bandpass', f: 220, dur: 0.07, vol: 0.12, t, dest: D });
          if (k === 4 || k === 12) noise({ type: 'bandpass', f: 4200, dur: 0.05, vol: bonus ? 0.1 : 0.07, t, dest: D, q: 1.4 });
          if (bonus && k % 4 === 2) noise({ type: 'highpass', f: 7000, dur: 0.03, vol: 0.05, t, dest: D });
          // wobbly melody: trombone-ish in base on even-bar phrases, kazoo in bonus
          const li = (s % 32), mel = lead[li];
          if (bonus) {
            if (k % 2 === 0) kazoo({ f: MAJ[mel % MAJ.length] * (1 + (Math.random() - 0.5) * 0.015), dur: sixteenth * 1.8, vol: 0.05, t, dest: D });
          } else if (k % 4 === 0 && Math.floor(s / 16) % 2 === 1 || (k === 8 && Math.floor(s / 16) % 2 === 0)) {
            brass({ f: MAJ[mel % MAJ.length] / 2 * (1 + (Math.random() - 0.5) * 0.03), to: MAJ[(mel + 1) % MAJ.length] / 2, dur: sixteenth * 3, vol: 0.05, t, dest: D, lp: 1800, drift: 30 });
          }
          if (k === 15 && bar === 3 && Math.random() < 0.35) setTimeout(() => api.hic(), t * 1000);
          nextT += sixteenth; step++;
        }
      };
      musicTimer = setInterval(sched, 60); sched();
    },
    musicStop() { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } },
    duck(on_) { if (!musG || !ctx) return; musG.gain.cancelScheduledValues(ctx.currentTime); musG.gain.linearRampToValueAtTime(on_ ? 0.18 : 0.55, ctx.currentTime + 0.25); },
  };
  return api;
})();
