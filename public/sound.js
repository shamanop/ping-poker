// PPSound: synthesized WebAudio sound effects (no audio files).
(function () {
  'use strict';
  var MUTE_KEY = 'pp_sound_muted';
  var VOL_KEY = 'pp_sound_volume';
  var DEFAULT_VOL = 0.5;
  var LOG_MAX = 200;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var muted = lsGet(MUTE_KEY) === '1';
  var volume = (function () {
    var v = parseFloat(lsGet(VOL_KEY));
    return isFinite(v) && v >= 0 && v <= 1 ? v : DEFAULT_VOL;
  })();

  var ctx = null, master = null, noiseBuf = null;
  var log = [];

  // ── Graph helpers ────────────────────────────────────────────────
  function buildChain(c, dest) {
    var g = c.createGain();
    g.gain.value = volume;
    var comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 6;
    comp.attack.value = 0.003; comp.release.value = 0.12;
    g.connect(comp); comp.connect(dest);
    return g;
  }

  function makeNoise(c) {
    var len = Math.floor(c.sampleRate * 0.6);
    var b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
    var seed = 12345;
    for (var i = 0; i < len; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; d[i] = (seed / 4294967296) * 2 - 1; }
    return b;
  }

  // Envelope: linear attack to peak, exponential decay to silence.
  function env(c, t, peak, attack, dur) {
    var g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }

  function tone(c, out, t, o) {
    var osc = c.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
    var g = env(c, t, o.vol, o.attack || 0.004, o.dur);
    osc.connect(g); g.connect(out);
    osc.start(t); osc.stop(t + o.dur + 0.02);
  }

  function noise(c, nb, out, t, o) {
    var src = c.createBufferSource();
    src.buffer = nb;
    var f = c.createBiquadFilter();
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.f, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
    f.Q.value = o.q || 1;
    var g = env(c, t, o.vol, o.attack || 0.002, o.dur);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t, o.offset || 0, o.dur + 0.02);
  }

  // ── Voices: (ctx, noiseBuffer, out, t0) ──────────────────────────
  function clack(c, nb, out, t, pitch, vol) {
    noise(c, nb, out, t, { f: 3800 * pitch, q: 2.5, vol: vol, attack: 0.001, dur: 0.035, offset: 0.1 });
    tone(c, out, t, { f: 2200 * pitch, f2: 1500 * pitch, vol: vol * 0.45, attack: 0.001, dur: 0.05 });
    tone(c, out, t, { f: 3300 * pitch, f2: 2400 * pitch, vol: vol * 0.2, attack: 0.001, dur: 0.035 });
  }

  function bell(c, out, t, f, vol, dur, type) {
    tone(c, out, t, { f: f, vol: vol, attack: 0.008, dur: dur, type: type || 'sine' });
    tone(c, out, t, { f: f * 2, vol: vol * 0.25, attack: 0.008, dur: dur * 0.6 });
    tone(c, out, t, { f: f * 3.01, vol: vol * 0.08, attack: 0.008, dur: dur * 0.35 });
  }

  var VOICES = {
    deal: function (c, nb, out, t) {
      noise(c, nb, out, t, { f: 2600, f2: 6500, q: 0.9, vol: 0.32, attack: 0.006, dur: 0.07, offset: 0.2 });
      noise(c, nb, out, t + 0.05, { f: 5200, q: 1.2, vol: 0.12, attack: 0.001, dur: 0.025, offset: 0.35 });
    },
    chip: function (c, nb, out, t) {
      clack(c, nb, out, t, 1, 0.32);
      clack(c, nb, out, t + 0.055, 1.18, 0.24);
    },
    raise: function (c, nb, out, t) {
      clack(c, nb, out, t, 0.9, 0.3);
      clack(c, nb, out, t + 0.05, 1.1, 0.28);
      clack(c, nb, out, t + 0.11, 1.3, 0.24);
    },
    check: function (c, nb, out, t) {
      tone(c, out, t, { f: 210, f2: 120, vol: 0.55, attack: 0.002, dur: 0.1 });
      noise(c, nb, out, t, { f: 900, q: 2, vol: 0.3, attack: 0.001, dur: 0.04, offset: 0.05 });
      tone(c, out, t + 0.09, { f: 190, f2: 110, vol: 0.3, attack: 0.002, dur: 0.08 });
    },
    fold: function (c, nb, out, t) {
      noise(c, nb, out, t, { filter: 'lowpass', f: 1100, f2: 180, q: 0.7, vol: 0.5, attack: 0.05, dur: 0.26, offset: 0.0 });
    },
    turn: function (c, nb, out, t) {
      bell(c, out, t, 659.25, 0.34, 0.45);
      bell(c, out, t + 0.14, 987.77, 0.34, 0.6);
    },
    win: function (c, nb, out, t) {
      bell(c, out, t, 523.25, 0.3, 0.55, 'triangle');
      bell(c, out, t + 0.13, 659.25, 0.3, 0.55, 'triangle');
      bell(c, out, t + 0.26, 783.99, 0.34, 0.95, 'triangle');
    },
    msg: function (c, nb, out, t) {
      tone(c, out, t, { f: 880, f2: 1180, vol: 0.28, attack: 0.004, dur: 0.09 });
    },
    timer_warn: function (c, nb, out, t) {
      tone(c, out, t, { f: 880, vol: 0.22, attack: 0.003, dur: 0.08 });
    },
    blinds_up: function (c, nb, out, t) {
      [330, 415.3, 523.25, 659.25].forEach(function (f, i) { bell(c, out, t + i * 0.09, f, 0.26, 0.4, 'triangle'); });
    },
    splat: function (c, nb, out, t) {
      tone(c, out, t, { f: 150, f2: 55, vol: 0.5, attack: 0.003, dur: 0.18 });
      noise(c, nb, out, t, { filter: 'lowpass', f: 1400, f2: 300, q: 0.7, vol: 0.4, attack: 0.002, dur: 0.14, offset: 0.1 });
    }
  };
  var ALIAS = { bet: 'chip', call: 'chip', deal_community: 'deal', your_turn: 'turn', chat: 'msg', blind_up: 'blinds_up' };

  // ── Live playback ────────────────────────────────────────────────
  function ensureCtx() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = buildChain(ctx, ctx.destination);
    noiseBuf = makeNoise(ctx);
    return ctx;
  }

  function unlock() {
    var c = ensureCtx();
    if (c && c.state === 'suspended') c.resume();
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) {
    window.addEventListener(ev, unlock, { capture: true, passive: true });
  });

  function play(name) {
    name = ALIAS[name] || name;
    var voice = VOICES[name];
    if (!voice) return false;
    log.push({ name: name, muted: muted, at: Date.now() });
    if (log.length > LOG_MAX) log.shift();
    if (muted) return false;
    try {
      var c = ensureCtx();
      if (!c) return false;
      if (c.state !== 'running') { c.resume(); return false; }
      voice(c, noiseBuf, master, c.currentTime + 0.005);
      return true;
    } catch (e) { return false; }
  }

  // ── Offline measurement (duration + peak amplitude per sound) ────
  function measure(names) {
    names = names || Object.keys(VOICES);
    var rate = 44100;
    return Promise.all(names.map(function (name) {
      var oc = new OfflineAudioContext(1, rate * 2, rate);
      var chain = buildChain(oc, oc.destination);
      VOICES[name](oc, makeNoise(oc), chain, 0.01);
      return oc.startRendering().then(function (buf) {
        var d = buf.getChannelData(0), peak = 0, last = 0;
        for (var i = 0; i < d.length; i++) {
          var a = Math.abs(d[i]);
          if (a > peak) peak = a;
          if (a > 0.001) last = i;
        }
        return { name: name, durationMs: Math.round(last / rate * 1000), peak: +peak.toFixed(3) };
      });
    }));
  }

  function setMuted(m) {
    muted = !!m;
    lsSet(MUTE_KEY, muted ? '1' : '0');
    if (!muted) unlock();
  }

  window.PPSound = {
    play: play,
    measure: measure,
    names: function () { return Object.keys(VOICES); },
    get muted() { return muted; },
    setMuted: setMuted,
    toggleMute: function () { setMuted(!muted); return muted; },
    get volume() { return volume; },
    setVolume: function (v) {
      v = Math.max(0, Math.min(1, +v || 0));
      volume = v; lsSet(VOL_KEY, String(v));
      if (master) master.gain.value = v;
    },
    get log() { return log; }
  };
})();
