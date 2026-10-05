# The Ping synced radio

Everyone on a station hears the same moment. The server never streams: it publishes a fixed epoch per station, and each client computes `track = f((serverNow - epoch) mod loopLength)`.

## Files
- `public/music-clock.js` shared pure math (UMD: browser + node). `position`, `estimateOffset`, `nudgeRate`, `stationEpoch`.
- `music.js` server: `attach({app, io, publicDir})` called once from server.js before `express.static`. Loads `public/audio/music/stations.json`, serves mp3 (Accept-Ranges, ETag, `Cache-Control: public, max-age=604800`), `GET /api/music/state`, socket `music:hello` -> `music:state`, `music:ping` (ack `{t: serverMs}`).
- `public/music.js` + `public/music.css` client player and the bar (docked in `.sh-top` after the level chip; station picker popover on `document.body`).
- `tools/gen-placeholder-music.sh` tiny placeholder tracks (`public/audio/music/placeholder-*`). Delete them and use the real stations.json when merged.

## stations.json
`{stations:[{id,name,tagline,tracks:[{file,title,artist,durationSec}]}]}`. `file` is relative to `public/audio/music/<id>/` (or contains a `/` to be relative to the music root). Missing `durationSec` is filled with `ffprobe` at boot (needs ffprobe on the host; otherwise the track is skipped with a warning). Epochs are derived from the station id, so a redeploy never reshuffles the radio; changing track order or durations does.

## Socket events
- client -> `music:hello` ; server -> `music:state` `{serverTime, stations:[{id,name,tagline,epoch,tracks:[{url,title,artist,durationSec}]}]}`
- client -> `music:ping` with ack `{t}`; client keeps the last 8 samples and uses the lowest-RTT one (`offset = ts - (t0 + rtt/2)`), re-pings every 30 s.

## Client API: `window.PingMusic`
`setStation(id)`, `play()`, `pause()` (local only; resume rejoins in sync), `toggle()`, `volume(v?)` 0..1, `mute(b?)`, `duck(ms, amount)`, `nowPlaying()`, `stations()`, `on(fn)`, `options({pauseOnHidden})` (default false).
`duck(holdMs, amount)`: ramps the music down by `amount` (0..1) in 90 ms, holds, releases in 600 ms; overlapping ducks take the deepest. Wired already: `PingJuice.sfx('big'|'mega'|'jackpot')` ducks 0.45/0.55/0.65 for 0.9/1.6/2.6 s (reaches the parent shell from game iframes via `window.parent.PingMusic`). Any slam sound can call `PingMusic.duck(500, 0.5)` directly.

## Sync behavior
Boundary hand-off by a precise timer to a preloaded second `<audio>` (next track is fetched ~20 s before the end). Drift check at 0.35/1.1/2.8 s after start (hard re-seek if >150 ms), then every 10 s (every 2.5 s while nudging): |drift| <30 ms ignored, <400 ms corrected with `playbackRate` 0.97..1.03, otherwise hard seek. Autoplay blocked -> bar shows "Click anywhere to start" and the first pointer/key/touch starts it.

## Prefs (localStorage `pingmusic.*`)
`vol` (default 0.35, applied squared), `muted`, `station`, `off` (local pause).

## Tests
`node tests/music-clock.test.js` (in `npm test`), `python3 qa/music/two_context.py` (two contexts + reload + boundary + drift + skew + autoplay gate; ports 4781).
