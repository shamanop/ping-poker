// Synchronized lobby radio, server side. Authoritative station clock only; mp3s are plain static files.
// Hook: require('./music').attach({ app, io, publicDir, on }) before express.static in server.js; `on(socket, ev, fn)` routes events
// through the v2 error containment (ctx.safe.onEvent), without it plain socket.on is used.
const fs = require('fs');
const path = require('path');
const express = require('express');
const { execFileSync } = require('child_process');
const Clock = require('./public/music-clock.js');

function probeDuration(file) {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { timeout: 15000 }).toString().trim();
    const n = parseFloat(out);
    return n > 0 ? n : 0;
  } catch (e) { return 0; }
}

function loadStations(musicDir) {
  const jf = path.join(musicDir, 'stations.json');
  let raw;
  try { raw = JSON.parse(fs.readFileSync(jf, 'utf8')); } catch (e) { return []; }
  const out = [];
  for (const s of (raw && raw.stations) || []) {
    if (!s || typeof s.id !== 'string' || !/^[a-z0-9_-]+$/i.test(s.id)) continue;
    const tracks = [];
    for (const t of s.tracks || []) {
      if (!t || typeof t.file !== 'string') continue;
      const rel = t.file.includes('/') ? t.file : s.id + '/' + t.file;
      const abs = path.join(musicDir, rel);
      if (!abs.startsWith(musicDir + path.sep) || !fs.existsSync(abs)) { console.warn('[music] missing file, skipped:', rel); continue; }
      let dur = Number(t.durationSec);
      if (!(dur > 0)) dur = probeDuration(abs);
      if (!(dur > 0)) { console.warn('[music] no duration, skipped:', rel); continue; }
      tracks.push({ url: '/audio/music/' + rel.split('/').map(encodeURIComponent).join('/'), title: String(t.title || path.basename(rel, '.mp3')), artist: String(t.artist || ''), durationSec: Math.round(dur * 1000) / 1000 });
    }
    if (tracks.length) out.push({ id: s.id, name: String(s.name || s.id), tagline: String(s.tagline || ''), epoch: Clock.stationEpoch(s.id), tracks });
  }
  return out;
}

function createMusic({ musicDir, now = () => Date.now() }) {
  let stations = loadStations(musicDir);
  const state = () => ({ serverTime: now(), stations });
  return {
    state,
    reload() { stations = loadStations(musicDir); return stations; },
    stations: () => stations,
    nowPlaying(id, t = now()) {
      const s = stations.find(x => x.id === id); if (!s) return null;
      const p = Clock.position(s.tracks, s.epoch, t);
      return p && { station: id, index: p.index, title: s.tracks[p.index].title, offsetMs: p.offsetMs };
    },
  };
}

function attach({ app, io, publicDir, on, now = () => Date.now() }) {
  const musicDir = path.join(publicDir, 'audio', 'music');
  const music = createMusic({ musicDir, now });
  const onEv = typeof on === 'function' ? on : (socket, ev, fn) => socket.on(ev, fn);
  // mp3s: Accept-Ranges + ETag/Last-Modified come from express.static; add a week of caching.
  app.use('/audio/music', express.static(musicDir, {
    maxAge: '7d', acceptRanges: true, etag: true, lastModified: true, index: false,
    setHeaders(res, p) { if (p.endsWith('.json')) res.setHeader('Cache-Control', 'no-cache'); },
  }));
  app.get('/api/music/state', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(music.state()); });
  io.on('connection', socket => {
    // Cheap clock probe: client measures RTT and derives its offset from server time. Public: no auth.
    onEv(socket, 'music:ping', (_p, ack) => { if (typeof ack === 'function') ack({ t: now() }); });
    onEv(socket, 'music:hello', () => socket.emit('music:state', music.state()));
  });
  return music;
}

module.exports = { attach, createMusic, loadStations };
