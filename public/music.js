/* The Ping lobby radio, client. Every listener on a station hears the same moment: the server publishes a
   fixed epoch per station, and track + offset are computed locally from (serverNow - epoch) mod loop length.
   Server never streams; mp3s are static files under /audio/music/. Exposes window.PingMusic. See MUSIC.md. */
(function () {
  'use strict';
  const Clock = window.PingMusicClock;
  if (!Clock) { console.warn('[music] music-clock.js missing'); return; }

  // ---------- persisted prefs ----------
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('pingmusic.' + k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('pingmusic.' + k, String(v)); } catch (e) { /* private mode */ } },
  };
  const num = (v, d) => { const n = parseFloat(v); return isFinite(n) ? n : d; };

  const S = {
    stations: [], stationId: LS.get('station', ''), wantPlay: LS.get('off', '0') !== '1',
    volume: Math.max(0, Math.min(1, num(LS.get('vol', ''), 0.35))), muted: LS.get('muted', '0') === '1',
    offset: 0, rtt: null, haveClock: false, samples: [],
    status: 'idle', // idle | loading | playing | paused | blocked | error
    signedIn: false, gen: 0, pauseOnHidden: false, lastDrift: null, hardSeeks: 0, nudges: 0,
  };

  const mkVoice = () => { const el = new Audio(); el.preload = 'auto'; return { el, url: '', idx: -1, stationId: '' }; };
  const voices = [mkVoice(), mkVoice()];
  let cur = null;
  let boundaryTimer = 0, corrTimer = 0, tickTimer = 0;

  const serverNow = () => Date.now() + S.offset;
  const station = () => S.stations.find(s => s.id === S.stationId) || null;
  const posOf = (st, t) => Clock.position(st.tracks, st.epoch, t === undefined ? serverNow() : t);

  // ---------- events ----------
  const listeners = new Set();
  function emit() { for (const f of listeners) { try { f(api.nowPlaying()); } catch (e) { /* listener bug */ } } paintBar(); }
  function setStatus(s) { if (S.status !== s) { S.status = s; emit(); } }

  // ---------- volume + ducking ----------
  const ducks = []; // {t0, attack, hold, release, depth}
  let duckTimer = 0;
  const ATTACK = 90, RELEASE = 600;
  function duckFactor(now) {
    let f = 1;
    for (let i = ducks.length - 1; i >= 0; i--) {
      const d = ducks[i], el = now - d.t0;
      let k;
      if (el < ATTACK) k = el / ATTACK;
      else if (el < ATTACK + d.hold) k = 1;
      else if (el < ATTACK + d.hold + RELEASE) k = 1 - (el - ATTACK - d.hold) / RELEASE;
      else { ducks.splice(i, 1); continue; }
      f = Math.min(f, 1 - d.depth * k);
    }
    return f;
  }
  function applyVolume() {
    const f = ducks.length ? duckFactor(performance.now()) : 1;
    const v = S.muted ? 0 : S.volume * S.volume * f; // squared: slider feels linear to the ear
    for (const x of voices) x.el.volume = Math.max(0, Math.min(1, v));
    if (!ducks.length && duckTimer) { clearInterval(duckTimer); duckTimer = 0; }
  }
  function duck(ms, amount) {
    ms = Math.max(0, Math.min(10000, num(ms, 800))); amount = Math.max(0, Math.min(1, num(amount, 0.6)));
    ducks.push({ t0: performance.now(), hold: ms, depth: amount });
    if (!duckTimer) duckTimer = setInterval(applyVolume, 40);
    applyVolume();
  }

  // ---------- clock sync ----------
  function getSocket() { return window.PingSocket || null; }
  let syncing = false;
  async function syncClock(rounds) {
    const s = getSocket(); if (!s || !s.connected || syncing) return;
    syncing = true;
    try {
      for (let i = 0; i < rounds; i++) {
        const t0 = Date.now();
        const ack = await new Promise(res => { const to = setTimeout(() => res(null), 2000); s.emit('music:ping', {}, a => { clearTimeout(to); res(a); }); });
        if (ack && ack.t) S.samples.push({ t0, ts: ack.t, t1: Date.now() });
        if (S.samples.length > 8) S.samples.shift();
        if (i < rounds - 1) await new Promise(r => setTimeout(r, 90));
      }
    } finally { syncing = false; }
    const est = Clock.estimateOffset(S.samples);
    if (est) {
      const first = !S.haveClock;
      S.offset = est.offset; S.rtt = est.rtt; S.haveClock = true;
      if (first) maybeStart();
    }
  }

  // ---------- engine ----------
  function otherVoice() { return voices.find(v => v !== cur) || voices[0]; }
  const clearTimers = () => { clearTimeout(boundaryTimer); clearTimeout(corrTimer); boundaryTimer = corrTimer = 0; };

  function ready(el, g) {
    return new Promise(res => {
      if (el.readyState >= 3) return res(true);
      let done = false;
      const fin = ok => { if (done) return; done = true; el.removeEventListener('canplay', on); el.removeEventListener('error', er); clearTimeout(to); res(ok); };
      const on = () => fin(true), er = () => fin(false), to = setTimeout(() => fin(el.readyState >= 2), 10000);
      el.addEventListener('canplay', on); el.addEventListener('error', er);
    });
  }

  async function begin(v, g, retry) {
    const st = station(); if (!st) return;
    let p = posOf(st); if (!p) return;
    const track = st.tracks[p.index];
    if (v.url !== track.url) { v.el.src = track.url; v.url = track.url; v.el.load(); }
    v.idx = p.index; v.stationId = st.id;
    if (S.status !== 'blocked') setStatus('loading');
    const ok = await ready(v.el, g);
    if (g !== S.gen) return;
    if (!ok) { setStatus('error'); setTimeout(() => { if (g === S.gen && S.wantPlay && S.signedIn) start(); }, 5000); return; }
    p = posOf(st);
    if (p.index !== v.idx) { if (!retry) return begin(v, g, true); }
    v.el.playbackRate = 1;
    v.el.currentTime = Math.min(p.offsetMs + 80, p.durMs - 50) / 1000;
    applyVolume();
    try { await v.el.play(); } catch (e) {
      if (g !== S.gen) return;
      if (e && e.name === 'NotAllowedError') { setStatus('blocked'); armGesture(); return; }
      setStatus('error'); return;
    }
    if (g !== S.gen) { v.el.pause(); return; }
    const old = cur; cur = v;
    if (old && old !== v) old.el.pause();
    setStatus('playing');
    scheduleBoundary(g);
    scheduleCorrection(g, true);
  }

  function scheduleBoundary(g) {
    clearTimeout(boundaryTimer);
    const st = station(); if (!st) return;
    const p = posOf(st);
    boundaryTimer = setTimeout(() => {
      if (g !== S.gen || !S.wantPlay) return;
      begin(otherVoice(), g);
    }, Math.max(0, p.trackEndMs - serverNow()) + 5);
    preloadNext();
  }

  function preloadNext() {
    const st = station(); if (!st) return;
    const p = posOf(st); if (!p) return;
    const nextIdx = (p.index + 1) % st.tracks.length;
    const o = otherVoice(), url = st.tracks[nextIdx].url;
    if (o.url !== url) { o.el.src = url; o.url = url; o.idx = nextIdx; o.el.load(); }
  }

  const FIRST_CHECKS = [350, 1100, 2800];
  function scheduleCorrection(g, initial) {
    clearTimeout(corrTimer);
    const startAt = Date.now();
    let n = 0;
    const loop = () => {
      if (g !== S.gen) return;
      const early = initial && n < FIRST_CHECKS.length;
      const nudging = cur && cur.el.playbackRate !== 1;
      correct(early || Date.now() - startAt < 15000);
      n++;
      const next = n < FIRST_CHECKS.length && initial ? FIRST_CHECKS[n] - FIRST_CHECKS[n - 1] : nudging ? 2500 : 10000;
      corrTimer = setTimeout(loop, next);
    };
    corrTimer = setTimeout(loop, initial ? FIRST_CHECKS[0] : 10000);
  }

  function correct(tight) {
    const v = cur, st = station();
    if (!v || !st || S.status !== 'playing' || v.el.paused) return;
    const p = posOf(st);
    if (!p || v.idx !== p.index) return; // boundary hand-off pending
    const drift = v.el.currentTime - p.offsetMs / 1000; // positive = audio is ahead
    S.lastDrift = drift;
    const hard = tight ? 0.15 : 0.4;
    if (Math.abs(drift) > hard) { v.el.currentTime = Math.min(p.offsetMs + 60, p.durMs - 50) / 1000; v.el.playbackRate = 1; S.hardSeeks++; }
    else { const r = Clock.nudgeRate(drift); if (r !== v.el.playbackRate) { v.el.playbackRate = r; if (r !== 1) S.nudges++; } }
  }

  function start() {
    if (!S.wantPlay || !S.signedIn || !S.haveClock || !station()) return;
    S.gen++; clearTimers();
    for (const v of voices) { if (v !== cur) { v.el.pause(); } }
    begin(otherVoice(), S.gen);
  }
  function maybeStart() { if (S.wantPlay && S.signedIn && S.haveClock && station() && S.status !== 'playing') start(); }

  function stopAll() {
    S.gen++; clearTimers();
    for (const v of voices) v.el.pause();
    cur = null;
  }

  let gestureArmed = false;
  function armGesture() {
    if (gestureArmed) return; gestureArmed = true;
    const go = () => {
      gestureArmed = false;
      for (const ev of ['pointerdown', 'keydown', 'touchend']) document.removeEventListener(ev, go, true);
      if (S.wantPlay && S.status === 'blocked') start();
    };
    for (const ev of ['pointerdown', 'keydown', 'touchend']) document.addEventListener(ev, go, true);
  }

  // periodic housekeeping: now-playing label, clock re-sync, hidden-tab policy
  let lastSig = '';
  function tick() {
    const st = station();
    if (st) { const p = posOf(st); const sig = st.id + ':' + (p && p.index); if (sig !== lastSig) { lastSig = sig; emit(); } }
    if (popOpen) paintPop();
  }

  // ---------- public API ----------
  const api = {
    setStation(id) {
      if (!S.stations.some(s => s.id === id)) return false;
      if (id === S.stationId && S.status === 'playing') return true;
      S.stationId = id; LS.set('station', id);
      if (S.wantPlay && S.signedIn) { cur = null; start(); } else emit();
      return true;
    },
    play() {
      S.wantPlay = true; LS.set('off', '0');
      if (!S.signedIn || !S.haveClock) { emit(); return; }
      if (S.status !== 'playing') { start(); } emit();
    },
    pause() { S.wantPlay = false; LS.set('off', '1'); stopAll(); setStatus('paused'); },
    toggle() { if (S.status === 'blocked') return api.play(); (S.wantPlay && S.status !== 'paused') ? api.pause() : api.play(); },
    volume(v) { if (v === undefined) return S.volume; S.volume = Math.max(0, Math.min(1, num(v, S.volume))); LS.set('vol', S.volume); applyVolume(); paintBar(); return S.volume; },
    mute(b) { if (b === undefined) return S.muted; S.muted = !!b; LS.set('muted', S.muted ? '1' : '0'); applyVolume(); paintBar(); return S.muted; },
    duck,
    options(o) { if (o && 'pauseOnHidden' in o) S.pauseOnHidden = !!o.pauseOnHidden; return { pauseOnHidden: S.pauseOnHidden }; },
    stations() { return S.stations.map(s => ({ id: s.id, name: s.name, tagline: s.tagline, tracks: s.tracks.length })); },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    nowPlaying() {
      const st = station(); const p = st && posOf(st);
      const track = p && st.tracks[p.index];
      const v = cur;
      return {
        status: S.status, playing: S.status === 'playing',
        station: st ? { id: st.id, name: st.name, tagline: st.tagline } : null,
        track: track ? { index: p.index, title: track.title, artist: track.artist, durationSec: track.durationSec } : null,
        expectedOffsetSec: p ? p.offsetMs / 1000 : null,
        audioOffsetSec: v && !v.el.paused ? v.el.currentTime : null,
        audioTrackIndex: v && !v.el.paused ? v.idx : null,
        driftSec: S.lastDrift, rate: v ? v.el.playbackRate : 1, rttMs: S.rtt, clockOffsetMs: S.offset,
        hardSeeks: S.hardSeeks, nudges: S.nudges, serverNowMs: serverNow(),
      };
    },
  };
  window.PingMusic = api;

  // ---------- UI ----------
  const IC = {
    play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
    vol: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path class="ln" d="M16 9a4 4 0 010 6M18.500 6.500a8 8 0 010 11"/></svg>',
    mute: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path class="ln" d="M16 9l5 6M21 9l-5 6"/></svg>',
    note: '<svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2.500"/><circle cx="17" cy="16" r="2.500"/></svg>',
  };
  let bar = null, pop = null, popOpen = false;
  const q = (sel, root) => (root || bar).querySelector(sel);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function mount() {
    const top = document.querySelector('.sh-top');
    if (!top || document.getElementById('mu-bar')) return !!top;
    bar = document.createElement('div');
    bar.id = 'mu-bar'; bar.className = 'mu-bar';
    bar.innerHTML = `
      <button type="button" class="mu-play" id="mu-play" aria-label="Play radio"></button>
      <button type="button" class="mu-now" id="mu-now" aria-haspopup="true" aria-expanded="false" title="Pick a station">
        <span class="mu-ic">${IC.note}</span>
        <span class="mu-txt"><b class="mu-st">Radio</b><span class="mu-tr">Loading...</span></span>
        <span class="mu-caret" aria-hidden="true"></span>
      </button>
      <button type="button" class="mu-mute" id="mu-mute" aria-label="Mute radio"></button>
      <input type="range" class="mu-vol" id="mu-vol" min="0" max="100" step="1" aria-label="Radio volume">`;
    const lvl = document.getElementById('sh-lvl');
    if (lvl && lvl.parentNode === top) lvl.after(bar); else top.appendChild(bar);
    pop = document.createElement('div'); pop.className = 'mu-pop'; pop.id = 'mu-pop'; pop.hidden = true;
    pop.setAttribute('role', 'menu');
    document.body.appendChild(pop);

    q('#mu-play').addEventListener('click', () => api.toggle());
    q('#mu-mute').addEventListener('click', () => api.mute(!S.muted));
    q('#mu-vol').addEventListener('input', e => { api.volume(e.target.value / 100); if (S.muted && e.target.value > 0) api.mute(false); });
    q('#mu-now').addEventListener('click', e => { e.stopPropagation(); popOpen ? closePop() : openPop(); });
    pop.addEventListener('click', e => {
      const b = e.target.closest('[data-st]'); if (!b) return;
      api.setStation(b.dataset.st); closePop();
      if (!S.wantPlay) api.play();
    });
    document.addEventListener('pointerdown', e => { if (popOpen && !pop.contains(e.target) && !bar.contains(e.target)) closePop(); }, true);
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && popOpen) closePop(); });
    window.addEventListener('resize', () => { if (popOpen) placePop(); });
    paintBar();
    return true;
  }

  function placePop() {
    const r = q('#mu-now').getBoundingClientRect();
    pop.style.top = Math.round(r.bottom + 8) + 'px';
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 328, Math.round(r.left))) + 'px';
  }
  function openPop() { popOpen = true; pop.hidden = false; placePop(); paintPop(); q('#mu-now').setAttribute('aria-expanded', 'true'); }
  function closePop() { popOpen = false; pop.hidden = true; q('#mu-now').setAttribute('aria-expanded', 'false'); }

  function paintPop() {
    if (!pop) return;
    const t = serverNow();
    pop.innerHTML = '<div class="mu-pop-h">Stations</div>' + (S.stations.length ? S.stations.map(s => {
      const p = posOf(s, t), tr = p && s.tracks[p.index];
      return `<button type="button" class="mu-item${s.id === S.stationId ? ' on' : ''}" data-st="${esc(s.id)}" role="menuitemradio" aria-checked="${s.id === S.stationId}">
        <b>${esc(s.name)}</b><span class="tag">${esc(s.tagline)}</span>
        <span class="np">${tr ? 'Now: ' + esc(tr.title) + (tr.artist ? ' <i>' + esc(tr.artist) + '</i>' : '') : ''}</span></button>`;
    }).join('') : '<div class="mu-empty">No stations yet.</div>');
  }

  function paintBar() {
    if (!bar) return;
    const st = station(), np = api.nowPlaying();
    const playing = S.status === 'playing' || S.status === 'loading';
    const pb = q('#mu-play');
    pb.innerHTML = playing ? IC.pause : IC.play;
    pb.setAttribute('aria-label', playing ? 'Pause radio' : 'Play radio');
    bar.classList.toggle('blocked', S.status === 'blocked');
    bar.classList.toggle('off', !S.wantPlay);
    bar.dataset.status = S.status;
    q('.mu-st').textContent = st ? st.name : 'Radio';
    let line = 'No stations';
    if (st) {
      if (S.status === 'blocked') line = 'Click anywhere to start';
      else if (!S.wantPlay) line = 'Paused (just for you)';
      else if (S.status === 'error') line = 'Audio unavailable, retrying';
      else line = np.track ? np.track.title : '';
    }
    q('.mu-tr').textContent = line;
    q('#mu-now').title = st ? (st.tagline ? st.name + ': ' + st.tagline : st.name) + '. Pick a station.' : 'No stations';
    const mb = q('#mu-mute');
    mb.innerHTML = S.muted || S.volume === 0 ? IC.mute : IC.vol;
    mb.classList.toggle('on', S.muted);
    mb.setAttribute('aria-label', S.muted ? 'Unmute radio' : 'Mute radio');
    const vs = q('#mu-vol'); const vv = Math.round(S.volume * 100);
    if (String(vv) !== vs.value) vs.value = vv;
    vs.style.setProperty('--fill', vv + '%');
    bar.hidden = !S.stations.length;
  }

  // ---------- boot ----------
  function setStations(list) {
    S.stations = Array.isArray(list) ? list.filter(s => s && s.id && s.tracks && s.tracks.length) : [];
    if (!S.stations.some(s => s.id === S.stationId)) S.stationId = S.stations[0] ? S.stations[0].id : '';
    if (S.stationId) LS.set('station', S.stationId);
    if (cur && S.status === 'playing') { /* keep playing; epochs are deterministic so a refresh is seamless */ }
    emit(); maybeStart();
  }

  function wireSocket() {
    const s = getSocket();
    if (!s) return false;
    const hello = () => { s.emit('music:hello'); syncClock(6); };
    s.on('music:state', m => {
      if (m && typeof m.serverTime === 'number' && !S.haveClock) { S.offset = m.serverTime - Date.now(); /* coarse until ping */ }
      setStations(m && m.stations);
    });
    s.on('connect', hello);
    if (s.connected) hello();
    setInterval(() => { if (s.connected) syncClock(3); }, 30000);
    return true;
  }

  function onVisibility() {
    if (document.hidden) { if (S.pauseOnHidden && S.status === 'playing') { stopAll(); setStatus('paused'); S._hiddenPaused = true; } }
    else {
      if (S._hiddenPaused) { S._hiddenPaused = false; if (S.wantPlay) start(); }
      else if (S.status === 'playing') correct(true);
    }
  }

  function setSignedIn(v) {
    v = !!v; if (v === S.signedIn) return;
    S.signedIn = v;
    if (!v) { stopAll(); setStatus('idle'); } else maybeStart();
  }

  function boot() {
    applyVolume();
    const tryMount = () => { if (mount()) return true; return false; };
    if (!tryMount()) { const iv = setInterval(() => { if (tryMount()) clearInterval(iv); }, 300); }
    setSignedIn(document.body.classList.contains('sh-on'));
    new MutationObserver(() => setSignedIn(document.body.classList.contains('sh-on'))).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    if (!wireSocket()) { const iv = setInterval(() => { if (wireSocket()) clearInterval(iv); }, 300); }
    // HTTP fallback if the socket never delivers stations
    setTimeout(() => { if (!S.stations.length) fetch('/api/music/state', { cache: 'no-store' }).then(r => r.json()).then(m => { if (!S.haveClock) { S.offset = m.serverTime - Date.now(); S.haveClock = true; } setStations(m.stations); }).catch(() => {}); }, 4000);
    document.addEventListener('visibilitychange', onVisibility);
    tickTimer = setInterval(tick, 1000);
    for (const v of voices) v.el.addEventListener('error', () => { if (cur === v && S.status === 'playing') setStatus('error'); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
