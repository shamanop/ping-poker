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
1. `package.json` scripts.test: append ` && node tests/music-clock.test.js` (the old branch did; `package.json` is the lead's). DONE by the lead (5efbbc1).
2. (r2) `public/index.html`: move the cache-busts because `music.js` and `music.css` changed:
   - line 19 `<link rel="stylesheet" href="music.css?v=1-port">` -> `music.css?v=1-port-r2`
   - line 199 `<script src="music.js?v=1-port"></script>` -> `music.js?v=1-port-r2`
   (`music-clock.js` is unchanged.)
No hunk needed in `index.html` (tags and cache-busts already there), `shell.js`, `shell.css`, `phone.css`, `landscape.css`.

## Round 2 (critic r1 fixes, from port-1007 a236e59)
Done (each change tagged `(r2) critic r1 #N` in the code):
- #3 user-gesture gate in `public/music.js`: `play()` is never called before a trusted gesture this page load (`onGesture` capture listeners on pointerdown / pointerup(touch) / touchend / keydown, plus `navigator.userActivation.hasBeenActive`). ON and no gesture: status `blocked`, nothing loaded, label "Click or tap to start", pulsing control (+ gold dot on the compact icon, `music.css`). A rejected play() (NotAllowedError) lands in `blocked`; each later gesture retries once, no timer. `begin()` callers have `.catch(beginFailed)`: no unhandled rejection. OFF stays off through gestures. Default for a new account NOT changed (still ON): open product question for Chris.
- #9 station list updated in place (`paintPop`): buttons are built once per station set, classes / aria / now-playing updated on the same nodes; `paintBar` writes only what changed (`setHtml` / `setText` / `setAttr`).
- #10 `music.css`: at <= 600 px the dock row gets `padding-left: 52px` while the radio icon is shown (it was 2 px under the first dock icon at 360).
- Evidence: `qa/port-radio/r2/` (`layout.py`, `gate.py`, `layout.json`, shots).
Open:
- Playwright `page.evaluate` / `wait_for_function` run with userGesture:true and give the page sticky activation; the no-input leg therefore reads console reports from an init script only (see `gate.py`). Any future gate test must do the same.
- Chromium's own autoplay policy was NOT exercised (headless does not enforce it); the gate is the page's own logic, forced-reject covers the browser side. Real Chrome / Safari / iOS untested.
- At 320 px wide the dock row (275 px of icons) no longer fits next to the 52 px padding and overflows by about 7 px each side; icons then sit 0.5 px clear of the radio. Not in the 7 measured sizes. A 4th dock game would overflow below about 400 px.
Resume: dev server as in "How to resume", then `PORT=4710 python3 qa/port-radio/r2/layout.py` and `PORT=4710 python3 qa/port-radio/r2/gate.py`; `node tests/music-clock.test.js`; `PORT=4711 SHOTS=<dir> python3 tests/radio-sync.py`.

## Open
- v2's own top bar overlaps its level chip and wallet below about 1100 px wide (measured with music.css disabled, e.g. 900x800: `sh-lvl` 180-338 vs `sh-wallet` 206-506). Not caused by the radio; the compact layout keeps the radio out of that bar.
- Phone dock margin button: FIXED in round 2 (#10), see above for the 320 px / 4th-game caveat.
- The two radio files `qa/music/two_context.py`, `shot_narrow.py` use the old landing form and are not run.
- `tests/profile.js` fails on untouched port-1007 c1cf225 too (it waits on `game_state`, v2 sends `table_state`); `tests/accounts.js` and `tests/profile.js` hard-code `/home/isabelle/.cache/node_modules/socket.io-client`, run them with `SIO_CLIENT=$PWD/node_modules/socket.io-client`.
- Pixabay content licence: no political-use review done (LICENSES.md says so as shipped).
- Rapid repeated `auth_signup` from one IP gets rate limited (my screenshot script hit it on the 6th run on one server); restart the dev server.
- Not verified: real audio output (headless chromium has no sound device; sync is measured from `audio.currentTime`, bed hold from the synth's own state / RMS), Safari / iOS autoplay and the phone layout on a real device, Firefox.

## How to resume
Dev server: `PORT=4710 DATA_DIR=$(mktemp -d) RIG=1 SIGNUP_PLAY_CENTS=1000000 node server.js` then `PORT=4710 python3 qa/music/shots_port.py` (`VIEWS=1280x800,... ONLY=360x740` env options).
Tests: `node tests/music-clock.test.js`; `PORT=4711 SHOTS=qa/port-radio python3 tests/radio-sync.py`; `node tests/v2-unit/run-tables.js`; `flock /tmp/ping-v2-tests.lock node tests/v2/run.js --jobs 1 --only 08,27,30`.
