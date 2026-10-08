# PROGRESS-radio (port of origin/feat-radio 0b43542 onto v2, branch port-radio)

Worktree `wt-port-radio`, cut from `port-1007` c1cf225. Nothing pushed, nothing merged. Spec: `PORT-CONTRACT.md` section 2, brief `briefs/PORT-RADIO.md`.

## Done
- Taken as-is from feat-radio: `music.js`, `public/music-clock.js`, `public/audio/music/**` (24 mp3, `stations.json` with exact `durationSec`, `LICENSES.md`), `MUSIC.md` (extended with the v2 sections), `tests/music-clock.test.js`, `qa/music/two_context.py` + `shot_narrow.py` (pre-v2 scripts, reference only).
- `music.js` (server): `attach({app, io, publicDir, on})`; `music:ping` (ack) and `music:hello` go through `ctx.safe.onEvent`. One line in `server.js` directly above `app.use(express.static(`.
- `accounts.js`: the one `prefs.radio` line in `updateProfile`. `profile_update` already passes `prefs`; `auth_ok.account.prefs.radio` comes back on a new-device login (tested).
- `public/music.js` + `public/music.css`: re-fitted to the v2 top bar. The bar is the LAST child of `.sh-top` (phone.css / landscape.css place children by `nth-child`).
  - >= 1200 px wide, > 500 px high: in the top bar, explicit grid cell 4.
  - everything else (phone, < 1200 wide, landscape phone): one 40x44 icon button in `#shell-root` at the foot of the game dock, opens a sheet (play / pause, volume, stations). Visible at a phone table too (phone.css hides the top bar there).
- Slots: Bender (`holdBed`, `radio-active` listener, duck call) and COLD CALL (it HAS a synthesized hold-music bed and shared the `ping.music` key but listened to nothing: added `holdBed`, `music-enabled` + `radio-active` listeners, `cc-music-pref` echo, duck call). `slotFrames()` covers both iframes.
- `public/sounds-juice.js`: the duck hunk.
- `tests/radio-sync.py` rewritten for v2 (sign in -> lobby -> `table_join`), own port 4711. `qa/music/shots_port.py`: layout asserts + screenshots. Screenshots in `qa/port-radio/*.jpg`, `layout.json`, `radio-sync-results.json`.

## HUNKS FOR LEAD
1. `package.json` scripts.test: append ` && node tests/music-clock.test.js` (the old branch did; `package.json` is the lead's).
No hunk needed in `index.html` (tags and cache-busts already there), `shell.js`, `shell.css`, `phone.css`, `landscape.css`.

## Open
- v2's own top bar overlaps its level chip and wallet below about 1100 px wide (measured with music.css disabled, e.g. 900x800: `sh-lvl` 180-338 vs `sh-wallet` 206-506). Not caused by the radio; the compact layout keeps the radio out of that bar.
- Phone dock margin button: at 360 px it sits flush against the first dock icon (button 4-44 px, first icon from 44 px). Narrower than 360 px would overlap; a 4th game in the dock would push icons into it.
- The two radio files `qa/music/two_context.py`, `shot_narrow.py` use the old landing form and are not run.
- `tests/profile.js` fails on untouched port-1007 c1cf225 too (it waits on `game_state`, v2 sends `table_state`); `tests/accounts.js` and `tests/profile.js` hard-code `/home/isabelle/.cache/node_modules/socket.io-client`, run them with `SIO_CLIENT=$PWD/node_modules/socket.io-client`.
- Pixabay content licence: no political-use review done (LICENSES.md says so as shipped).
- Rapid repeated `auth_signup` from one IP gets rate limited (my screenshot script hit it on the 6th run on one server); restart the dev server.
- Not verified: real audio output (headless chromium has no sound device; sync is measured from `audio.currentTime`, bed hold from the synth's own state / RMS), Safari / iOS autoplay and the phone layout on a real device, Firefox.

## How to resume
Dev server: `PORT=4710 DATA_DIR=$(mktemp -d) RIG=1 SIGNUP_PLAY_CENTS=1000000 node server.js` then `PORT=4710 python3 qa/music/shots_port.py` (`VIEWS=1280x800,... ONLY=360x740` env options).
Tests: `node tests/music-clock.test.js`; `PORT=4711 SHOTS=qa/port-radio python3 tests/radio-sync.py`; `node tests/v2-unit/run-tables.js`; `flock /tmp/ping-v2-tests.lock node tests/v2/run.js --jobs 1 --only 08,27,30`.
