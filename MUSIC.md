# The Ping synced radio

Everyone on a station hears the same moment. The server never streams: it publishes a fixed epoch per station, and each client computes `track = f((serverNow - epoch) mod loopLength)`.

## Files
- `public/music-clock.js` shared pure math (UMD: browser + node). `position`, `estimateOffset`, `nudgeRate`, `stationEpoch`.
- `music.js` server: `attach({app, io, publicDir, on})` called once from server.js `start()` directly above `app.use(express.static(`; `on(socket, ev, fn)` is `ctx.safe.onEvent` so a throw in a handler is contained like every other v2 event. Loads `public/audio/music/stations.json`, serves mp3 (Accept-Ranges, ETag, `Cache-Control: public, max-age=604800`), `GET /api/music/state`, socket `music:hello` -> `music:state`, `music:ping` (ack `{t: serverMs}`).
- `public/music.js` + `public/music.css` client player and the bar. Layout depends on the viewport (see Layouts); the station picker is a popover / sheet on `document.body`.
- Real tracks: 24 Pixabay mp3s in 4 stations under `public/audio/music/<id>/`, licenses in `public/audio/music/LICENSES.md`. `durationSec` in stations.json is exact (ffprobe, ms precision); keep it exact, the handoff timer relies on it.

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

## Layouts (v2 port)
The bar is always the LAST child of `.sh-top` (phone.css / landscape.css place the other children by `nth-child`; never insert before them).
- >= 1200 px wide and > 500 px high: in the top bar, explicit grid cell 4 (music.css gives the nine columns explicit places). Tiers hide the volume slider and the "THE PING" wordmark at <= 1280 px and the note icon / mute at <= 1240 px.
- Everything else (phone <= 600, anything < 1200 wide, landscape phone <= 500 high): one 40x44 icon button (`.mu-bar--dock`) child of `#shell-root`, at the foot of the game dock (bottom-left on phone, bottom of the left rail otherwise). It stays visible at a phone table, where phone.css hides the top bar. It opens a sheet (`#mu-pop`) with play / pause, volume and the station list. `music.js` moves the bar between the two homes with `matchMedia` (`placeBar`).
v2's own top bar already overlaps its level chip and wallet below about 1100 px (checked with music.css disabled), which is why the compact layout starts at 1200.

## Slots (Ballot Bender and Cold Call)
`slotFrames()` covers `iframe[src*="/games/bender/"]` and `iframe[src*="/games/coldcall/"]`. One MUSIC switch: radio -> slot `{type:'music-enabled', value}` (also mirrored to localStorage `ping.music`), slot -> radio `bender-music-pref` / `cc-music-pref`. While the radio plays or loads the parent posts `{type:'radio-active', value:true}` first, then `music-enabled`, and the slot holds its synthesized bed (`SFX.holdBed`; the bed mode is remembered and resumes on release). Wins duck the radio: Bender `SFX.duck(true)` and Cold Call `SFX.duck(true)` call `parent.PingMusic.duck(2500, 0.5)`; `PingJuice.sfx('big'|'mega'|'jackpot')` ducks 0.45 / 0.55 / 0.65.

## Default
A brand-new account has the radio ON (it inherits the slot's `ping.music`, absent = on) and that is saved to `account.prefs.radio` on first sign-in. It still starts only after the first click / key / touch ("Click anywhere to start").

## Tests
`node tests/music-clock.test.js`; `PORT=4711 SHOTS=<dir> python3 tests/radio-sync.py` (starts its own server on a temp data dir; sign in -> lobby -> `table_join`); `PORT=4710 python3 qa/music/shots_port.py` against a running dev server (layout asserts + screenshots at 360x740, 540x900, 1440x900, 844x390). `qa/music/two_context.py` and `shot_narrow.py` are the pre-v2 scripts (old landing form), kept for reference only.
