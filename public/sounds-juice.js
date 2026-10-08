// PingJuice sound layer: synthesized WebAudio only, no files. Attaches PingJuice.sfx(name).
(function () {
  'use strict';
  var PJ = (window.PingJuice = window.PingJuice || {});
  var ctx = null, master = null, noiseBuf = null, lastAt = {};

  // VP C-major chord tones.
  var C4 = 261.63, E4 = 329.63, G4 = 392.0, C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function muted() {
    var v = lsGet('ping.sfx');
    if (v !== null && /^(0|off|false|mute|muted|no)$/i.test(v)) return true;
    return lsGet('pp_sound_muted') === '1';
  }
  PJ.sfxMuted = muted;
  PJ.setSfx = function (on) { try { localStorage.setItem('ping.sfx', on ? '1' : '0'); } catch (e) {} };

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.55;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.15;
    master.connect(comp); comp.connect(ctx.destination);
    var len = ctx.sampleRate, d;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate); d = noiseBuf.getChannelData(0);
    var seed = 9871;
    for (var i = 0; i < len; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; d[i] = (seed / 4294967296) * 2 - 1; }
    return ctx;
  }

  function tone(t, f, dur, o) {
    o = o || {};
    var osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(f, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    var vol = o.vol == null ? 0.2 : o.vol, a = o.attack || 0.006;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(o.dest || master);
    osc.start(t); osc.stop(t + dur + 0.05);
    return osc;
  }

  function noise(t, dur, o) {
    o = o || {};
    var src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    src.buffer = noiseBuf; src.loop = true;
    f.type = o.filter || 'bandpass';
    f.frequency.setValueAtTime(o.freq || 2000, t);
    if (o.freqTo) f.frequency.exponentialRampToValueAtTime(o.freqTo, t + dur);
    f.Q.value = o.q || 1;
    var vol = o.vol == null ? 0.2 : o.vol, a = o.attack || 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  // Bell-ish voice: sine + soft 2x partial, used for jingles.
  function bell(t, f, dur, vol) {
    tone(t, f, dur, { vol: vol, type: 'triangle', attack: 0.008 });
    tone(t, f * 2, dur * 0.6, { vol: vol * 0.35, type: 'sine', attack: 0.008 });
  }

  function arp(t, notes, step, dur, vol) {
    notes.forEach(function (f, i) { bell(t + i * step, f, dur, vol); });
  }

  function chord(t, notes, dur, vol) {
    notes.forEach(function (f) { bell(t, f, dur, vol); });
  }

  var S = {
    chipClink: function (t, o) {
      var j = 1 + (Math.random() - 0.5) * 0.16, v = (o && o.vol) || 1;
      tone(t, 2400 * j, 0.09, { vol: 0.09 * v, type: 'sine' });
      tone(t, 3650 * j, 0.06, { vol: 0.05 * v, type: 'sine' });
      noise(t, 0.025, { freq: 5200, q: 2, vol: 0.09 * v });
    },
    chipShower: function (t) {
      for (var i = 0; i < 14; i++) {
        var at = t + i * 0.05 + Math.random() * 0.03;
        S.chipClink(at, { vol: 0.5 + Math.random() * 0.5 });
      }
    },
    coinTick: function (t) {
      tone(t, 1250, 0.035, { vol: 0.07, type: 'square', attack: 0.002 });
      noise(t, 0.02, { freq: 3500, q: 1.5, vol: 0.05 });
    },
    whoosh: function (t) {
      noise(t, 0.34, { freq: 500, freqTo: 3200, q: 0.9, vol: 0.2, attack: 0.12 });
    },
    thud: function (t) {
      tone(t, 130, 0.22, { to: 48, vol: 0.5 });
      noise(t, 0.08, { freq: 300, filter: 'lowpass', vol: 0.18 });
    },
    nice: function (t) {
      arp(t, [C5, E5, G5], 0.075, 0.5, 0.13);
    },
    big: function (t) {
      arp(t, [C4, E4, G4, C5, E5], 0.07, 0.6, 0.14);
      chord(t + 0.4, [C5, G5, C6], 0.9, 0.08);
    },
    mega: function (t) {
      arp(t, [C4, E4, G4, C5, E5, G5, C6], 0.065, 0.7, 0.14);
      chord(t + 0.5, [C4, E4, G4, C5, E5], 1.3, 0.07);
      chord(t + 0.5, [G5, C6], 1.3, 0.06);
      noise(t + 0.5, 0.5, { freq: 6500, q: 3, vol: 0.05, attack: 0.1 });
    },
    jackpot: function (t) {
      arp(t, [C4, E4, G4, C5, E5, G5, C6], 0.075, 0.8, 0.15);
      arp(t + 0.75, [C5, E5, G5, C6, G5, C6], 0.06, 0.6, 0.12);
      chord(t + 1.2, [C4, E4, G4, C5, E5, G5, C6], 2.2, 0.075);
      tone(t + 1.2, 65.4, 1.8, { vol: 0.28, type: 'sine', attack: 0.04 });
      for (var i = 0; i < 18; i++) S.chipClink(t + 1.2 + i * 0.07 + Math.random() * 0.03, { vol: 0.4 + Math.random() * 0.4 });
    },
    nearMiss: function (t) {
      tone(t, G4, 0.2, { vol: 0.12, type: 'triangle' });
      tone(t + 0.16, E4, 0.2, { vol: 0.12, type: 'triangle' });
      tone(t + 0.32, 207.65, 0.55, { vol: 0.13, type: 'triangle', to: 190 });
    },
    bombBoom: function (t) {
      tone(t, 95, 0.9, { to: 32, vol: 0.7, attack: 0.004 });
      noise(t, 0.7, { freq: 1800, freqTo: 120, filter: 'lowpass', q: 0.7, vol: 0.45, attack: 0.003 });
      noise(t + 0.02, 0.18, { freq: 4200, q: 1, vol: 0.2 });
    },
    sticker: function (t) {
      tone(t, 190, 0.1, { to: 70, vol: 0.4 });
      noise(t, 0.05, { freq: 2500, q: 1, vol: 0.12 });
    },
    toast: function (t) {
      bell(t, G5, 0.3, 0.07);
      bell(t + 0.07, C6, 0.36, 0.06);
    },
    claim: function (t) {
      arp(t, [C5, E5, G5, C6], 0.06, 0.5, 0.12);
    },
    ping: function (t) {
      bell(t, C6, 0.5, 0.1);
    }
  };

  PJ.sfxNames = Object.keys(S);

  // Win stingers briefly lower the lobby radio (window.PingMusic, also reachable from game iframes via parent).
  var DUCK = { big: [900, 0.45], mega: [1600, 0.55], jackpot: [2600, 0.65] };
  PJ.sfx = function (name, opts) {
    var fn = S[name];
    if (!fn || muted()) return false;
    // Throttle identical rapid-fire sounds (ticks, clinks) so they never stack into noise.
    var now = performance.now(), gap = (opts && opts.minGap) || (name === 'coinTick' || name === 'chipClink' ? 30 : 0);
    if (gap && lastAt[name] && now - lastAt[name] < gap) return false;
    lastAt[name] = now;
    try {
      if (!ensure()) return false;
      fn(ctx.currentTime + 0.01, opts);
      var dk = DUCK[name];
      if (dk) { try { var M = window.PingMusic || (window.parent && window.parent.PingMusic); if (M) M.duck(dk[0], dk[1]); } catch (e) {} }
      return true;
    } catch (e) { return false; }
  };

  // Browsers keep AudioContext suspended until a gesture; resume on first one.
  function unlock() { try { ensure(); } catch (e) {} }
  window.addEventListener('pointerdown', unlock, { once: true, capture: true });
  window.addEventListener('keydown', unlock, { once: true, capture: true });
})();
