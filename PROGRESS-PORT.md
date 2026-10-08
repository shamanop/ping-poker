# PORT: radio + login + night recap onto v2 master. HAND-OFF READY for Isabelle (2026-10-08, Frank / port lead 3)

Branch `port-1007`, cut from master bb298d2, 23 commits, NOT pushed, master not merged. Review, then push / merge is yours.
Sources ported: feat-radio 0b43542 (combo-1006 203d9c5 as radio reference), feat-recap 219bc1d, feat-login 5202679. All three were pre-v2 (base b0c20e7), so this is a re-wire onto transport/ + tables/ + money/, not a merge. The 3D lobby: nothing of it existed in any branch, nothing was added.

## What is on the branch
- **Login** (public/lobby.js, public/lobby.css): the feat-login look on the v2 sign-in view (ballot tabs, avatar grid, submit). r2: the submit is released when the socket drops before a reply, and a locked submit is dimmed.
- **Radio** (music.js, music-clock.js, public/music.js, public/music.css, public/audio/music/, MUSIC.md, hooks in bender / sounds): 4 stations on a server clock, top-bar player at desktop, dock icon + sheet on phones, second slot (Cold Call) holds the bed. r2: explicit gesture gate (no play() before a trusted gesture, "Click or tap to start" state), station list updated in place, dock row reserves the radio's column.
- **Night recap** (recap.js, transport/handlers/recap.js, public/recap.js, public/recap.css, tests/recap.js): recorder fed from registry events + hand-flow engine events, night nets from registry.nightOf (the ledger), Recap buttons at the table / bank header / night-end screen, replay, share card. r1-r3 fixes below.
- Shared files (index.html tags + cache-busts, package.json test list, server.js wiring) were edited by the lead only. Contract and owner table: PORT-CONTRACT.md.

## Critic rounds (Opus, independent sessions)
- **r1 on 5efbbc1: DOES NOT HOLD.** 1 BLOCKER (a crafted `recap_get` threw in build() and transport/safe.js voided the caller's live hand) + 11 minors.
- **r2 on d2ab1f1: DOES NOT HOLD.** r1 items 1-7 and 9-12 FIXED (item 1 re-attacked live by the critic: 0 voids), item 8 partly, and ONE new MAJOR: `recap_get` on a 6000-hand POKERPING session from 3 sockets took a bystander's round-trip from 1 ms to median 324 ms (event loop starved; no void, no money).
- **r3 on 03a05b8 (the fix for that MAJOR): HOLDS.** Measured by the critic: 3 askers median 1 ms / max 88, 12 askers median 1 / max 80; the same probe on d2ab1f1 gives median 304 / max 930. tests/recap.js 19/19. It left 3 minors + 2 nits (open items 1-5 below).
- Model check: r1 and r3 ran on claude-opus-5-5 only. r2's gateway line says claude-opus-5-5, but its transcript shows 31 turns on claude-opus-5-5 and 15 on claude-opus-4-8 (an older Opus, not Sonnet); its findings were reproduced by my own script and by r3.

## The r3 fix (lead, commit 03a05b8), please read this one
- transport/handlers/recap.js: one server-wide budget for recap answers (`ctx.recapBudget`): after an answer that cost c ms nobody is answered for c x 9 ms; waiting sockets are served first come first served, one (the newest) request per socket; the per-socket 800 ms window stays. Every throw still ends inside the handler.
- recap.js: `RECAP_HANDS = 500`. A recap holds the newest 500 hands of its night / session and says so in a note. This is a behaviour change for very long nights (500 hands is 10+ hours live). Change the number if you disagree.

## Verified by lead 3 itself, on the final code head 03a05b8 unless noted
- `flock /tmp/ping-v2-tests.lock node tests/v2/run.js --jobs 1`: 166/166 (508 s). Baseline c1cf225: 166/166.
- tests/v2-unit: engine 96/96, money 568/568, tables 180/180. tests/recap.js 19/19. tests/music-clock.test.js ok.
- `node qa/port-lead/exploit.js 4701` on a live server (critic r1's exact frame + 8 hostile frames mid-hand): HOLDS, 0 voids, hand finished and recorded; the only VOID in the log is the shutdown. The same script reproduces the void on the 5efbbc1 handler.
- `node qa/port-lead/starve.js` (6000-hand seed, bystander latency): d2ab1f1 code = median 222 ms / max 936 (DOES NOT HOLD); 03a05b8 = median 1 / p90 43 / max 101 with 3 askers, median 1 / max 64 with 12, every asker answered, recap = 500 hands, 1.26 MB.
- Browser leg `python3 qa/port-lead/leg.py` (sign-up through the form -> lobby -> radio off / on by its button -> hands -> recap -> replay -> night-end -> recap) at 360x740, 540x900, 1440x900: PROBLEMS 0, 0 page errors, recap nets == settle_up nets at every size. Run on d2ab1f1; no public/ file changed after it. I looked at all 27 shots (qa/port-lead/), the radio r2 shots (qa/port-radio/r2: waiting, playing, sheet, forced-block) and the recap r2 shots (qa/port-recap/r2: Recap button still there after the settle screen, loading, error with Try again / Close).
- `python3 qa/port-lead/login-lock.py`: locked submit = disabled, opacity .8, saturate(.8); released after the socket closes. Shots qa/port-lead/login-lock-*.jpg looked at.

## Open items (none blocks the hand-off; first five are critic r3's)
1. MINOR: the recap budget is one FIFO for the server, so many sockets on one account can crowd it: with 45 sockets a legitimate first recap came after 15-16 s (past the client's 15 s "Could not load the recap"); with 12 it took 4.4 s. The loop itself stayed healthy.
2. MINOR: the cool-down uses wall-clock time with no ceiling; a 1 h clock step during an answer would leave the recap dead for hours. A clamp (a few seconds) is a one-line fix I did not make after the critic's HOLDS.
3. MINOR: on a night over 500 hands, Net is whole-night (ledger) while hands / won / highlights cover the last 500.
4. NIT: a late-recorded night over 500 hands can show "Hand log starts at hand #4" while the first hand shown is later. 5. NIT: the session dropdown still says "6000 hands" for a capped session.
6. PRODUCT (Chris): radio default for a new account is ON; it starts on the first click after sign-in.
7. The gesture gate is the page's own logic: headless Chromium does not enforce autoplay, so real Chrome / Safari / iOS and real audio output are untested. Nothing was checked on a real phone.
8. POKERPING's recap is readable by every signed-in user (old behaviour; hole cards not shown at showdown stay masked).
9. Old feat-recap hand lines (handNum without handNo) are skipped, not migrated.
10. Pixabay music licence: no review for political use.
11. Slot iframes have no cache-bust (a stale audio.js misses the bed hold until reload).
12. `.lb-btns` 4-button layout fix lives in recap.css; the real home is lobby.css.
13. v2's juice floats (+XP) draw over the recap header and the night-end buttons for a moment (z-index 9300 vs 9250); v2's top bar squeezes the radio label when the streak chip shows, and overlaps level chip and wallet under ~1100 px (not the radio).
14. Dock row overflows ~7 px at 320 px wide; a 4th dock game would overflow below ~400 px.
15. `tests/profile.js` fails on untouched c1cf225 too (waits on `game_state`); not part of this port.
16. Replay of the leg's first hand shows both hole-card pairs because both went to showdown; the critics checked masking for hands that did not.

## How to re-run
`npm test` list is in package.json. Live checks: see the headers of qa/port-lead/exploit.js, starve.js, leg.py (needs `node qa/port-recap/bots.js <port> <dir>/bots.json` and a server with `RIG=1 SIGNUP_PLAY_CENTS=1000000 AUTO_START_MS=300 HAND_DELAY_MS=900`), login-lock.py.
