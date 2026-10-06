# RADIO (feat-radio) progress

Branch feat-radio, based on v2 e262d46. Nothing pushed.

## What changed
- Merged `music-sync` (synced radio: server-clocked epoch per station, drift correction, ducking, `window.PingMusic`) and resolved package.json (test list) and public/index.html (asset tags).
- 24 real tracks in 4 stations (public/audio/music/, stations.json with exact ffprobe durations, LICENSES.md). Placeholder tones and tools/gen-placeholder-music.sh removed.
- MUSIC switch = radio switch. Slot `#mus` and the bar play button are one state, both directions (postMessage `music-enabled` / `bender-music-pref`, plus localStorage `ping.music` mirror). No autoplay before a gesture ("Click anywhere to start").
- No overlap: while the radio is playing/loading the parent posts `radio-active`; the slot's synthesized bed is held (audio.js `holdBed`, game.js listener). Radio ducks on slot big wins (`SFX.duck` -> `PingMusic.duck`).
- Per player: on/off/station saved in account `prefs.radio` (accounts.js `updateProfile`), applied on `auth_ok`/sign-in, so a new device restores it.
- public/music.css: <=600px rule: radio is a compact floating chip under the top bar (the v2 top bar has no narrow layout and squashed the radio to 12px), top bar raised above slot windows so the chip stays clickable, picker clamps to viewport.
- tests/radio-sync.py: 2-browser E2E (port 3462). package.json test script runs tests/music-clock.test.js.

## Evidence
- tests/radio-sync.py: ALL PASS (23 checks): same track and position at POKERPING (worst delta 7-40 ms), station change propagates, toggle off is silent (and the bed stays silent), per-player pref saved/restored after reload and on a new-device login, bar <-> slot switch both ways, no autoplay before gesture, no page errors, 390x844 chip and picker inside viewport.
- Node suites (tests/*.js): all pass except tests/preselect.js (5 fails, identical on v2 baseline e262d46, not touched). music-clock.test.js passes.
- Screenshots (ping-v2/radio/shots/): 1440-table-radio.png, 1440-picker.png, 1440-slot-docked.png, 1440-music-off.png, 390-table-radio.png, 390-picker.png, 390-slot-open.png.

## Open issues
- preselect.js 5 failures are pre-existing.
- The v2 top bar is not responsive below ~600px (bonus/account/sign-out clip off the right edge); not addressed here, radio is a floating chip there instead.
- Station picker "Now:" lines show the real track, but the 24 tracks' licenses are Pixabay content licence (see LICENSES.md); no political-use review done.
- Bender iframe has no cache-bust; a stale cached audio.js/game.js would miss the hold hook until reloaded.
