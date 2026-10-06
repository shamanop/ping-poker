// Station clock math shared by server (require) and browser (<script>). Pure functions, no I/O.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PingMusicClock = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Total loop length in ms (integer ms keeps server and every client bit-identical).
  function loopMs(tracks) {
    let t = 0;
    for (const k of tracks) t += Math.round(k.durationSec * 1000);
    return t;
  }

  // Which track is playing at server time `nowMs`, and how far into it (ms).
  // epoch = any server-ms instant the loop is defined to have started at track 0, offset 0.
  function position(tracks, epochMs, nowMs) {
    const total = loopMs(tracks);
    if (!tracks.length || total <= 0) return null;
    let into = (nowMs - epochMs) % total;
    if (into < 0) into += total;
    let acc = 0;
    for (let i = 0; i < tracks.length; i++) {
      const d = Math.round(tracks[i].durationSec * 1000);
      if (into < acc + d) {
        const offsetMs = into - acc;
        return { index: i, offsetMs, durMs: d, trackStartMs: nowMs - offsetMs, trackEndMs: nowMs - offsetMs + d, loopMs: total };
      }
      acc += d;
    }
    return { index: 0, offsetMs: 0, durMs: Math.round(tracks[0].durationSec * 1000), trackStartMs: nowMs, trackEndMs: nowMs, loopMs: total };
  }

  // Deterministic epoch per station so a server restart never reshuffles the radio.
  const BASE_EPOCH_MS = Date.UTC(2026, 0, 1);
  function stationEpoch(id) {
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return BASE_EPOCH_MS + (h % 3600000);
  }

  // Clock-offset estimate from ping samples [{t0, ts, t1}] (client send, server time, client receive).
  // offset = serverTime - clientTime at the midpoint; best sample = lowest RTT.
  function estimateOffset(samples) {
    let best = null;
    for (const s of samples) {
      const rtt = s.t1 - s.t0;
      if (rtt < 0) continue;
      if (!best || rtt < best.rtt) best = { rtt, offset: s.ts - (s.t0 + rtt / 2) };
    }
    return best;
  }

  // Playback-rate nudge for a small drift (seconds, audio ahead = positive). Clamped 0.97..1.03.
  function nudgeRate(driftSec) {
    if (Math.abs(driftSec) < 0.03) return 1;
    return Math.max(0.97, Math.min(1.03, 1 - driftSec * 0.25));
  }

  return { loopMs, position, stationEpoch, estimateOffset, nudgeRate, BASE_EPOCH_MS };
});
