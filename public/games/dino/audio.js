/* HATCH PARTY audio (dino). File-based: one SFX sprite + music loops/stingers under sfx/ (built by _dino/sound/tools/build.py; sources and licenses in _dino/sound/LICENSES.md).
   Graph: sprite/stinger voices -> sfxG, loops -> musG -> glue compressor -> master -> soft ceiling shaper (<= -1.3 dBFS) -> destination (+ analyser tap).
   Formats: Opus/WebM first, MP3 fallback (picked by canPlayType, and again if decoding fails). Bytes are fetched at load; decoding waits for the first gesture.
   Same switches as Bender: 'ping.sfx' / 'ping.music' in localStorage (shared across the slots); volumes in 'ping.dino.sfxVol' / 'ping.dino.musVol'.
   Rule (Chris: no celebration when a win pays back less than the bet): call round({ win, stake: bet }) at the start of each round; while win < stake every pop, win and banner cue plays as a neutral tick, no ladder, no chirps, no stingers. (UKGC RTS 14F judges against the full stake: pass stake: p.cost for that.)
   Public events are wrapped: logged (DinoAudio.log), throttled, silent no-ops before init or while muted. */
const DinoAudio = (() => {
  'use strict';
  const BASE = (() => {
    if (window.DINO_AUDIO_BASE) return window.DINO_AUDIO_BASE;
    try { return new URL('sfx/', document.currentScript.src).href; } catch (e) { return 'sfx/'; }
  })();
  let ctx = null, master, sfxG, musG, comp, shaper, analyser;
  let on = readPref('ping.sfx', true), musicOn = readMusicPref();
  let sfxVol = readNum('ping.dino.sfxVol', 0.9), musVol = readNum('ping.dino.musVol', 0.5);
  let man = null, sprite = null, sprOff = 0, ext = null, chirpSet = 'voice';
  const bytes = {}, bufs = {}, loading = {}, log = [], last = {};
  let musicMode = null, musicWant = 'base', loopSrc = null, loopGain = null, duckN = 0, duckTimer = 0;
  let count = null, stinger = null, ldw = false, turbo = false;
  let readyRes; const ready = new Promise((r) => { readyRes = r; });

  // ---------- prefs ----------
  function readPref(k, dflt) {
    try {
      const v = localStorage.getItem(k);
      if (v !== null) return !/^(0|off|false|mute|muted|no)$/i.test(v);
      if (k === 'ping.sfx') return localStorage.getItem('pp_sound_muted') !== '1';
    } catch (e) { /* storage blocked */ }
    return dflt;
  }
  function readMusicPref() { try { if (localStorage.getItem('ping.music') !== null) return readPref('ping.music', true); } catch (e) { /* blocked */ } return readPref('ping.sfx', true); }
  function readNum(k, d) { try { const v = parseFloat(localStorage.getItem(k)); return isFinite(v) ? Math.max(0, Math.min(1, v)) : d; } catch (e) { return d; } }
  function write(k, v) { try { localStorage.setItem(k, String(v)); } catch (e) { /* blocked */ } }

  // ---------- loading ----------
  const pickExt = () => {
    const a = document.createElement('audio');
    return a.canPlayType && a.canPlayType('audio/webm; codecs="opus"') ? 'webm' : 'mp3';
  };
  const get = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(url + ' ' + r.status); return r.arrayBuffer(); });
  // prefetch bytes right away (no AudioContext needed): manifest, sprite, base loop. The rest loads after init.
  function prefetch() {
    if (prefetch.p) return prefetch.p;
    ext = pickExt();
    prefetch.p = get(BASE + 'manifest.json').then((b) => {
      man = JSON.parse(new TextDecoder().decode(b));
      fetchBytes('sfx', 'sfx'); fetchBytes('base', man.music.base.file);
      return man;
    }).catch((e) => { console.warn('[DinoAudio] manifest', e.message); return null; });
    return prefetch.p;
  }
  function fetchBytes(key, path, e) {
    const x = e || ext;
    if (!bytes[key + '.' + x]) bytes[key + '.' + x] = get(BASE + path + '.' + x);
    return bytes[key + '.' + x];
  }
  function decode(ab) { return new Promise((res, rej) => { try { const p = ctx.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); } catch (e) { rej(e); } }); }
  // key -> AudioBuffer, Opus first, MP3 if the browser can't decode it
  function load(key, path) {
    if (bufs[key]) return Promise.resolve(bufs[key]);
    if (loading[key]) return loading[key];
    loading[key] = fetchBytes(key, path).then(decode).catch(() => {
      if (ext === 'mp3') throw new Error('decode ' + key);
      return fetchBytes(key, path, 'mp3').then(decode);
    }).then((b) => { bufs[key] = b; return b; }).catch((e) => { console.warn('[DinoAudio] load', key, e && e.message); delete loading[key]; return null; });
    return loading[key];
  }
  // first sample above thr in the first `lim` seconds (decoder delay, e.g. MP3 padding)
  function onsetOf(b, thr, lim) {
    const d = b.getChannelData(0), n = Math.min(d.length, Math.round(lim * b.sampleRate));
    for (let i = 0; i < n; i++) if (Math.abs(d[i]) > thr) return i / b.sampleRate;
    return 0;
  }
  async function loadAll() {
    await prefetch(); if (!man) return;
    const s = await load('sfx', 'sfx');
    if (s) {
      sprite = s;
      const o = man.sfx_onset, got = onsetOf(s, o.thr, o.t + 0.2);
      sprOff = Math.abs(got - o.t) < 0.1 ? got - o.t : 0;
    }
    readyRes(true);
    await load('base', man.music.base.file);
    if (musicWant) applyMusic();
    // everything else in the background, small ones first
    for (const k of ['st_big', 'st_huge', 'st_intro', 'st_mega', 'st_epic', 'st_outro', 'fs']) await load(k, man.music[k].file);
    if (musicWant && musicWant !== musicMode) applyMusic();
  }

  // ---------- context / unlock (same pattern as Bender) ----------
  function isIOS() { const u = navigator.userAgent || ''; return /iP(hone|ad|od)/.test(u) || (/Macintosh/.test(u) && navigator.maxTouchPoints > 1); }
  // iOS only: a playing HTMLMediaElement makes WebAudio ignore the ringer switch. Needs real audio length (a 0-byte loop re-seeks ~30k times/s and pins the main thread).
  let iosEl = null;
  function iosSilentSwitchHelper() {
    try {
      const sr = 8000, n = sr, buf = new ArrayBuffer(44 + n), v = new DataView(buf), w = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
      w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true);
      new Uint8Array(buf, 44).fill(128);
      iosEl = document.createElement('audio'); iosEl.src = URL.createObjectURL(new Blob([buf], { type: 'audio/wav' })); iosEl.loop = true; iosEl.play().catch(() => {});
    } catch (e) { /* helper only */ }
  }
  function init() {
    if (ctx) { if (ctx.state !== 'running') ctx.resume().catch(() => {}); return ctx; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
    ctx = new AC();
    comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    master = ctx.createGain(); master.gain.value = 0.9;
    sfxG = ctx.createGain(); sfxG.gain.value = on ? sfxVol : 0;
    musG = ctx.createGain(); musG.gain.value = musicOn ? musVol : 0;
    shaper = ctx.createWaveShaper(); const cv = new Float32Array(2049); for (let i = 0; i < cv.length; i++) { const x = i / 1024 - 1; cv[i] = 1.4 * Math.tanh(x / 1.4); } shaper.curve = cv; shaper.oversample = '2x';
    sfxG.connect(comp); musG.connect(comp); comp.connect(master); master.connect(shaper); shaper.connect(ctx.destination);
    analyser = ctx.createAnalyser(); analyser.fftSize = 2048; shaper.connect(analyser);
    ctx.onstatechange = () => { if (!document.hidden && (ctx.state === 'suspended' || ctx.state === 'interrupted')) ctx.resume().catch(() => {}); };
    try { const b = ctx.createBuffer(1, 1, ctx.sampleRate), n = ctx.createBufferSource(); n.buffer = b; n.connect(ctx.destination); n.start(0); } catch (e) { /* silent unlock tick */ }
    if (isIOS()) iosSilentSwitchHelper();
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    loadAll();
    return ctx;
  }
  function unlock() { init(); if (ctx && ctx.state === 'running') ['pointerdown', 'keydown', 'touchend', 'click'].forEach((e) => removeEventListener(e, unlock, true)); }
  ['pointerdown', 'keydown', 'touchend', 'click'].forEach((e) => addEventListener(e, unlock, { capture: true, passive: true }));
  // hidden tab: pause everything (music too); back: resume
  document.addEventListener('visibilitychange', () => {
    if (iosEl) { if (document.hidden) iosEl.pause(); else iosEl.play().catch(() => {}); }
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(() => {}); else ctx.resume().catch(() => {});
  });

  // ---------- playback ----------
  // mix gains per sound (files are all peak -3 dBFS; balance lives here)
  const G = {
    click: 0.35, spin: 0.55, fs_spin: 0.5, drop_out: 0.3, land: 0.42, refill: 0.32, pop: 0.6, pop_soft: 0.35, win_tick: 0.4,
    win_small: 0.5, win_nice: 0.6, win_great: 0.7, chirp: 0.5, scatter: 0.75, bomb_land: 0.7, bomb_fly: 0.45, bomb_hit: 0.7,
    mult_slam: 0.85, count_loop: 0.32, count_end: 0.7, coins: 0.45, tier_up: 0.7, retrigger: 0.7, ante_on: 0.45, ante_off: 0.4,
    buy_confirm: 0.7, fs_trigger: 0.85, st: 0.9
  };
  const gainOf = (name) => { if (G[name] != null) return G[name]; const k = name.replace(/^alt_/, '').replace(/_[^_]+$/, '').replace(/_h\d$/, ''); return G[k] != null ? G[k] : 0.6; };
  // play one sprite sound. o: { gain, rate, at (s from now), loop, dest }
  function play(name, o) {
    o = o || {};
    if (!ctx || !sprite || !man || !man.sfx[name]) return null;
    const s = man.sfx[name], src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = sprite; src.playbackRate.value = o.rate || 1;
    g.gain.value = (o.gain == null ? 1 : o.gain) * gainOf(name);
    src.connect(g); g.connect(o.dest || sfxG);
    const t = ctx.currentTime + (o.at || 0), off = Math.max(0, s.o + sprOff);
    if (o.loop) { src.loop = true; src.loopStart = off; src.loopEnd = off + s.d; src.start(t, off); }
    else src.start(t, off, s.d);
    return { src, g, t };
  }
  const jit = (c) => Math.pow(2, ((Math.random() * 2 - 1) * c) / 1200); // +-c cents

  // ---------- music ----------
  function fadeTo(g, v, sec) { const t = ctx.currentTime; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(v, t + sec); }
  function startLoop(key) {
    const b = bufs[key]; if (!b) return false;
    const m = man.music[key], src = ctx.createBufferSource(), g = ctx.createGain();
    const off = onsetOf(b, 1e-4, 0.08), len = Math.min(m.dur, b.duration - off);
    src.buffer = b; src.loop = true; src.loopStart = off; src.loopEnd = off + len;
    g.gain.value = 0; src.connect(g); g.connect(musG); src.start(ctx.currentTime + 0.02, off);
    fadeTo(g, 1, 0.6);
    loopSrc = src; loopGain = g; musicMode = key; return true;
  }
  function stopLoop(sec) {
    if (!loopSrc) return;
    const s = loopSrc, g = loopGain; loopSrc = loopGain = null; musicMode = null;
    fadeTo(g, 0, sec == null ? 0.5 : sec); try { s.stop(ctx.currentTime + (sec == null ? 0.5 : sec) + 0.05); } catch (e) { /* stopped */ }
  }
  function applyMusic() {
    if (!ctx || !musicOn) return;
    if (musicWant === musicMode) return;
    if (!musicWant) { stopLoop(0.6); return; }
    if (!bufs[musicWant]) { load(musicWant, man && man.music[musicWant].file).then(() => applyMusic()); return; }
    stopLoop(0.6); startLoop(musicWant);
  }
  function setMusic(mode) { musicWant = mode; applyMusic(); }
  // duck the bed under celebrations; counted so overlapping ducks nest; a watchdog always restores it
  function duck(onNow, depth) {
    if (!ctx) return;
    duckN = Math.max(0, duckN + (onNow ? 1 : -1));
    clearTimeout(duckTimer);
    const v = !musicOn ? 0 : duckN ? musVol * (depth || 0.35) : musVol;
    musG.gain.cancelScheduledValues(ctx.currentTime); musG.gain.setTargetAtTime(v, ctx.currentTime, duckN ? 0.06 : 0.25);
    if (duckN) duckTimer = setTimeout(() => { duckN = 1; duck(false); }, 15000);
  }
  // one music stinger at a time (a new one fades the old one in 120 ms). Stingers ride the SFX bus: they are win feedback, so they follow the SFX switch.
  function playStinger(key, o) {
    o = o || {};
    if (!ctx || !bufs[key]) { if (man && man.music[key]) load(key, man.music[key].file); return 0; }
    if (stinger) { const s = stinger; fadeTo(s.g, 0, 0.12); try { s.src.stop(ctx.currentTime + 0.15); } catch (e) { /* stopped */ } }
    const src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = bufs[key];
    g.gain.value = G.st * (o.gain || 1); src.connect(g); g.connect(sfxG); src.start(ctx.currentTime + (o.at || 0));
    const me = { src, g }; stinger = me;
    const d = bufs[key].duration;
    if (o.duck !== false) { duck(true); setTimeout(() => duck(false), (d + (o.at || 0)) * 1000 - 300); }
    src.onended = () => { if (stinger === me) stinger = null; };
    return d;
  }

  // ---------- count-up loop ----------
  function countStop(withEnd) {
    if (!count) return;
    const c = count; count = null; clearTimeout(c.tm);
    const t = ctx.currentTime; c.v.g.gain.cancelScheduledValues(t); c.v.g.gain.setValueAtTime(c.v.g.gain.value, t); c.v.g.gain.linearRampToValueAtTime(0, t + 0.04);
    try { c.v.src.stop(t + 0.06); } catch (e) { /* stopped */ }
    if (withEnd && c.end) play('count_end');
  }

  // ---------- helpers for callers ----------
  // multiplier value -> bomb tier 1..4 (art bands: 2-6, 8-15, 20-50, 100)
  const bombTier = (m) => (m >= 100 ? 4 : m >= 20 ? 3 : m >= 8 ? 2 : 1);
  const HIGH = { h1: 1, h2: 1, h3: 1, h4: 1 };

  // ---------- raw events (wrapped below) ----------
  const R = {};
  R.click = () => play('click', { rate: jit(30) });
  R.spinStart = (free) => { play(free ? 'fs_spin' : 'spin'); play('drop_out', { at: 0.12 }); };
  R.fsSpin = () => R.spinStart(true);
  R.land = (col) => {
    const c = Math.max(0, Math.min(5, col | 0)), now = performance.now(), burst = now - (last._landT || 0) < 18;
    last._landT = now;
    play('land_' + (c % 3), { rate: Math.pow(2, c / 12) * jit(15), gain: burst ? 0.45 : 1 });
  };
  R.refill = () => play('refill', { rate: jit(25) });
  // pop(step, syms): step = 1-based tumble step in this spin; syms (optional) = winning symbol ids this step -> one baby-dino chirp for the best high symbol
  R.pop = (step, syms) => {
    if (ldw) { play('pop_soft', { rate: jit(20) }); return; }
    play('pop_' + Math.max(1, Math.min(8, step | 0 || 1)), { rate: jit(8) });
    const hi = (syms || []).filter((s) => HIGH[s]).sort()[0];
    if (hi) R.chirp(hi, 0.09);
  };
  R.chirp = (sym, at) => {
    if (ldw || !HIGH[sym]) return;
    const pre = chirpSet === 'synth' ? 'alt_chirp_' : 'chirp_';
    play(pre + sym + '_' + (Math.random() < 0.5 ? 'a' : 'b'), { at: at || 0, rate: jit(40) });
  };
  R.scatterLand = (n) => play('scatter_' + Math.max(1, Math.min(4, n | 0 || 1)));
  R.bombLand = (tier) => play('bomb_land_' + Math.max(1, Math.min(4, tier | 0 || 1)));
  R.bombFly = () => play('bomb_fly', { rate: jit(30) });
  // sum = multiplier total after this bomb lands in the plaque -> the hit climbs 5 levels
  R.bombCollect = (sum) => play('bomb_hit_' + (sum >= 50 ? 5 : sum >= 25 ? 4 : sum >= 10 ? 3 : sum >= 5 ? 2 : 1));
  R.slam = () => play('mult_slam');
  // countStart(ms, {end}): rolling counter for exactly ms (speeds up ~20% over long counts), then the end hit unless end:false. countEnd() = stop now (skip).
  R.countStart = (ms, o) => {
    countStop(false);
    if (ldw) return;
    const sec = Math.max(0.05, (ms || 0) / 1000), v = play('count_loop', { loop: true }); if (!v) return;
    if (sec > 1.5) { v.src.playbackRate.setValueAtTime(1, v.t); v.src.playbackRate.linearRampToValueAtTime(1.2, v.t + sec); }
    count = { v, end: !(o && o.end === false) };
    count.tm = setTimeout(() => countStop(true), sec * 1000);
  };
  R.countEnd = () => countStop(true);
  // win(tier, winX): end-of-round cue for wins below the banner. Below the stake (see round()) -> neutral tick only.
  R.win = (tier, winX) => {
    if (ldw || (winX != null && winX < 1)) { play('win_tick'); return; }
    if (tier === 'great') play('win_great'); else if (tier === 'nice') play('win_nice'); else play('win_small');
  };
  // bigWin(tier): banner reached (or escalated to) big | huge | mega | epic -> impact + that tier's stinger; music ducks
  R.bigWin = (tier) => {
    if (ldw) { play('win_tick'); return; }
    if (tier === 'nice' || tier === 'great') { R.win(tier); return; }
    const k = { big: 'st_big', huge: 'st_huge', mega: 'st_mega', epic: 'st_epic' }[tier] || 'st_big';
    play('tier_up'); playStinger(k, { at: 0.3 }); play('coins', { at: 0.35 });
  };
  R.bigWinEnd = () => { countStop(false); if (stinger) { const s = stinger; stinger = null; fadeTo(s.g, 0, 0.5); try { s.src.stop(ctx.currentTime + 0.55); } catch (e) { /* stopped */ } } };
  R.fsTrigger = () => { play('fs_trigger'); duck(true); setTimeout(() => duck(false), 2500); };
  // intro card opens: base bed out, intro stinger, then the FS loop
  R.fsIntro = () => { musicWant = 'fs'; stopLoop(0.4); const d = playStinger('st_intro', { duck: false }); setTimeout(() => applyMusic(), Math.max(300, d * 1000 - 400)); };
  // outro card opens: FS loop out, outro stinger, then the base bed
  R.fsOutro = () => { musicWant = 'base'; stopLoop(0.4); const d = playStinger('st_outro', { duck: false }); setTimeout(() => applyMusic(), Math.max(300, d * 1000 - 300)); };
  R.retrigger = () => play('retrigger');
  R.buyConfirm = () => play('buy_confirm');
  R.anteToggle = (onNow) => play(onNow ? 'ante_on' : 'ante_off');

  const GAP = { click: 40, land: 0, refill: 60, pop: 40, chirp: 250, scatterLand: 15, bombLand: 15, bombFly: 80, bombCollect: 60, win: 200, bigWin: 300, anteToggle: 60, buyConfirm: 300, spinStart: 120, fsSpin: 120 };
  const api = {
    BASE, ready, init, prefetch, bombTier,
    get log() { return log; }, get ctx() { return ctx; }, get manifest() { return man; },
    get names() { return man ? Object.keys(man.sfx) : []; },
    isOn: () => on, isMusicOn: () => musicOn,
    get on() { return on; }, get musicOn() { return musicOn; },
    state() { return { ctx: ctx ? ctx.state : 'none', ext, sprite: !!sprite, sprOff, loaded: Object.keys(bufs), on, musicOn, sfxVol, musVol, music: musicMode, want: musicWant, ldw, chirpSet }; },
    // SFX switch (stingers are on this bus too); music untouched
    toggle() { return api.setSfxEnabled(!on); },
    setSfxEnabled(v) {
      on = !!v; write('ping.sfx', on ? '1' : '0');
      if (on) { try { if (localStorage.getItem('pp_sound_muted') === '1') localStorage.setItem('pp_sound_muted', '0'); } catch (e) { /* blocked */ } }
      if (sfxG) { sfxG.gain.cancelScheduledValues(ctx.currentTime); sfxG.gain.setValueAtTime(on ? sfxVol : 0, ctx.currentTime); }
      if (!on) countStop(false);
      return on;
    },
    toggleMusic() { return api.setMusicEnabled(!musicOn); },
    setMusicEnabled(v) {
      musicOn = !!v; write('ping.music', musicOn ? '1' : '0');
      if (musG) { musG.gain.cancelScheduledValues(ctx.currentTime); musG.gain.setValueAtTime(musicOn ? musVol : 0, ctx.currentTime); }
      if (!musicOn) stopLoop(0.2); else applyMusic();
      try { window.dispatchEvent(new CustomEvent('dino:music', { detail: { value: musicOn } })); } catch (e) { /* no window */ }
      return musicOn;
    },
    setSfxVolume(v) { sfxVol = Math.max(0, Math.min(1, +v || 0)); write('ping.dino.sfxVol', sfxVol); if (sfxG && on) sfxG.gain.setTargetAtTime(sfxVol, ctx.currentTime, 0.03); return sfxVol; },
    setMusicVolume(v) { musVol = Math.max(0, Math.min(1, +v || 0)); write('ping.dino.musVol', musVol); if (musG && musicOn && !duckN) musG.gain.setTargetAtTime(musVol, ctx.currentTime, 0.03); return musVol; },
    get sfxVolume() { return sfxVol; }, get musicVolume() { return musVol; },
    // 'base' | 'fs' | null. Safe to call before init: remembered and started once the loop is decoded.
    music(mode) { setMusic(mode || null); },
    musicStop() { setMusic(null); },
    duck,
    // start of every round: { win, stake } in the same unit (p.totalWin, p.bet). Below the stake = no celebration sounds this round.
    round(o) { ldw = !!(o && o.stake > 0 && o.win < o.stake); },
    setTurbo(v) { turbo = !!v; },
    // 'voice' (default, voice-actor dinos) or 'synth' (alternate synthesized chirps)
    setChirpSet(v) { chirpSet = v === 'synth' ? 'synth' : 'voice'; return chirpSet; },
    // raw sprite access for the audition page
    playRaw(name, o) { return play(name, o); },
    stinger(key) { return playStinger(key); },
    level() {
      if (!analyser) return { peak: 0, rms: 0 };
      const b = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(b);
      let p = 0, s = 0; for (let i = 0; i < b.length; i++) { const a = Math.abs(b[i]); if (a > p) p = a; s += b[i] * b[i]; }
      return { peak: p, rms: Math.sqrt(s / b.length) };
    }
  };
  Object.keys(R).forEach((name) => {
    api[name] = (...a) => {
      const rec = { n: name, a, wall: performance.now(), ok: false };
      log.push(rec); if (log.length > 600) log.shift();
      if (!ctx || !sprite) { rec.skip = !ctx ? 'noctx' : 'loading'; if (name === 'fsIntro') musicWant = 'fs'; if (name === 'fsOutro') musicWant = 'base'; return; }
      if (!on && !/^fs(Intro|Outro)$/.test(name)) { rec.skip = 'muted'; return; }
      const gap = GAP[name] || 0;
      if (gap && last[name] && rec.wall - last[name] < gap) { rec.skip = 'throttle'; return; }
      last[name] = rec.wall;
      try { R[name](...a); rec.ok = true; } catch (e) { rec.err = String(e && e.message); }
    };
  });
  prefetch();
  return api;
})();
window.DinoAudio = DinoAudio;
