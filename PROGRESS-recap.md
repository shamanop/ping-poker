# PROGRESS-recap (night recap port, branch port-recap)

STATUS: round 2 DONE (critic r1 fix list), waiting for the lead's merge. Nothing pushed, nothing merged.

## What was built
- `recap.js` (root): recorder + payload builder. Recorder is fed by three hooks and never touches money; a hand is written as one JSONL line on `setImmediate` (after the tick's emits), flushed synchronously in `shutdown()`. Unwritable file: logged once a minute, hands stay in memory, the hand itself is unaffected. Load dedupes by `tableId|handNo`, applies `patch` lines (voluntary shows), compacts the file once when it holds more than 12000 lines.
- Night money = `registry.nightOf(t).perKey[key]`: `net` (same number as `nightPayload(t).players[].net`), `buyIns = buyIn`, `cashedOut = cashOut + open`. The old "Play $ memory only" note and `partialMoney` are gone.
- A hand's `bet` is `committed - returned`, so `sum(bet) = pot = sum(payouts)` and an uncalled bet handed back is logged as an action `back` (put negative), never as a win.
- POKERPING (permanent, `nightId` null): 4-hour-gap sessions, readable by any signed-in user (as before); hole cards still follow the viewer rule.
- Hooks (see the report for exact lines): `tables/registry.js` (out.event -> recorder.onEvent; `t.recorder` set in build()), `tables/hand-flow.js` (one guarded forward at the top of noteEvents), `transport/handlers/seat.js` (one guarded line in show_cards), `transport/handlers/recap.js`, `transport/index.js` HANDLERS, `transport/boot.js` RECAP_FILE, `server.js` region + one flush line.
- Client: `public/recap.js`, `public/recap.css` ported onto the UI kit (btn, panel, panel__title, panel__close, field), plain px, nothing under 12 px. Entry points injected by a MutationObserver: `#rc-table-btn` after `#bank-btn`, `#rc-bank-btn` after `#bank-view` in `#bank-panel .bank-head`, `#lb-recap` first in `.lb-settle .lb-btns`. Money is formatted with `Money.format(v, Money.modeFor(Money.pref, unit))` (the contract says `Money.fmt`, which does not exist).
- `tests/recap.js` on the v2 harness (ports 4720-4723), 11 checks.
- `qa/port-recap/`: `bots.js` (two house tables), `shoot.py` (the browser leg), screenshots.

## Evidence (run on this branch)
- `node tests/recap.js`: 11/11 PASS.
- `node tests/v2-unit/run-tables.js` 180/180, `run-engine.js` 96/96, `run-money.js` 568/568.
- `flock /tmp/ping-v2-tests.lock node tests/v2/run.js --jobs 1`: 166/166 PASS (513 s); the lead's baseline is 166/166 (502 s) with the identical check set.
- Browser leg: `python3 qa/port-recap/shoot.py 4720 <tables.json> 360x740 540x900 1440x900`, 0 page errors, 0 overflow findings, 54 JPEGs + 2 share-card PNGs.

## HUNKS FOR LEAD
1. `public/lobby.css` (login owns it) or `public/phone.css`: the night-end row `.lb-btns` has four buttons now (three before) and at 360 the labels overlapped. recap.css carries a workaround scoped to the row that holds `#lb-recap`:
   `.lb-btns:has(#lb-recap) > .btn { flex: 1 1 140px; white-space: normal; min-height: 44px; ... }`.
   The real fix is the same declaration on `.lb-settle .lb-btns .btn` in lobby.css; then delete the recap.css block.
2. `public/theme.css`: `.panel__close` sizes its glyph with `var(--p22)` and no floor, so the close glyph shrinks to about 11 px when the table scale `--u` drops. recap.css pins `.rc-actions .panel__close { font-size: 22px }`. Suggested kit fix: `font: 400 max(18px, var(--p22))/1 var(--f-text)`.
3. `public/index.html`: nothing needed; bump the `recap.js` / `recap.css` cache-bust (`?v=1-port`) at merge.

## Open
- Not verified: Safari / real phone (`navigator.share` path, Copy image, Download PNG were rendered but not clicked in headless), landscape 844x390, the admin console's mounted Bank panel (recap button stays hidden there because there is no seat), more than one tab open on the same account.
- POKERPING recap is open to every signed-in user (old behaviour); the contract's access list names only nights. Lead decides.
- The `+N XP` / BIG WIN juice floats (z-index 9300) draw over the recap header; not ours.

## How to resume
`node tests/recap.js` (ports 4720-4723). Browser leg: start `PORT=4720 DATA_DIR=$(mktemp -d) RIG=1 SIGNUP_PLAY_CENTS=1000000 AUTO_START_MS=300 HAND_DELAY_MS=900 node server.js`, then `node qa/port-recap/bots.js 4720 <dir>/tables.json &`, then `python3 qa/port-recap/shoot.py 4720 <dir>/tables.json`. Kill both and delete the data dir afterwards.

## Round 2 (critic r1 fixes, on top of a236e59)
Commits: 9c79751 (server, handler, tests), 501eb68 (client, browser leg). Each change carries a `(r2) critic r1 #N: '...'` comment.

Done
- #1 `tests/recap.js` `hostile-recap-frames-never-touch-a-live-hand`: POKERPING with one recorded hand, a second hand live with chips in the pot, then 24 RAW frames (`socket.io.engine.send`, so `1e309` and 20,000-deep nesting reach the server): `start` as deep array / deep object / `{}` / string / `1e309` / `-1` / digit string, `tableId` and `nightId` as deep array / deep object / number / null, both ids deep, `have` deep / number / 5,000-char string, payload itself deep array / number / string / null, no payload. After each: reply is `recap_data` or `error` code `recap`, no `Hand voided`, pot and hand number unchanged, sender still connected; after all, the hand plays to its end and is recorded. Proven to fail on the pre-fix handler (`git show 21d23f9:transport/handlers/recap.js`): the first frame voids the hand. The handler reduces every field (`tableId`, `nightId`, `start`, `have`) and `build()` also coerces its own inputs.
- #2 `recap-file-with-foreign-lines-loads-the-good-hands`: `null`, numbers, strings, arrays, `{}`, a patch without `shown`, records missing `winners` / `actions`, `players:[null]`, `winners:[null]`, `actions:[7]`, an old feat-recap line, a torn half line, two good hands: the two load, `build()` does not throw. `load()` now also requires `key` on every player and numeric `t`.
- #4 `recap.js` startHand: the blind rows use the committed amount and the uncalled part (`seats[n].returned`, which engine/hand.js keeps when it drops the event) is logged as a `back` row right after the blinds, so the running pot and `rp.bet` are right; final pot unchanged. Test `blind-allin-at-deal-logs-the-uncalled-part-back` (engine hand, 25 vs 1000): `sb 25 pot 25`, `bb 50 pot 75`, `back -25 pot 50`, final pot 50, nets sum 0.
- #5 a voided hand writes a `{void:true, tableId, nightId, handNo}` line (ignored by old readers: not a hand, not a patch) and is remembered in memory; the "before recording began" note counts only hand numbers that were neither recorded nor voided. Test covers live, after a restart (marker read back) and the genuinely missing hand 1.
- #6 `public/recap.js`: `settle_up` clears `st.cur` only when `d.ended === true` and it is the viewer's own table / night.
- #7 `public/recap.js`: `st.pending` + `settleFail`: any `error` while a request is pending, or 15 s of silence, ends "Loading the night" with a plain sentence and Try again / Close (`#rc-error`, `#rc-retry`, `#rc-err-close`). A failed background refresh keeps what is on screen; a `recap` error always shows.
- #8 `recap_get` accepts `have` (a string version). `build()` returns `version` (16 hex of md5 over: recorder revision for the table, hand count, last hand number, scope start/end/ended, session count, every night row buyIn / cashOut / open / net) and, when `have` equals it, `{ ok:true, unchanged:true, version, generatedAt }` (85 B vs 4 KB in the test, 83 KB for 55 hands in the browser). The access check runs first, so a stranger holding the right string is refused. `transport/handlers/recap.js`: one build per socket per 800 ms (`MIN_MS`); a request inside the window is coalesced (the newest one is answered when the window opens, timers are unref'd and cleared on disconnect), nothing is refused so no new error string exists. The client refresh sends `have` and keeps the screen on `unchanged`.
- #12 `own()` for `nightRows`, `acct()` accepts only an object whose `key` equals the key asked for. Test with `constructor`, `__proto__`, `toString`, `hasOwnProperty`, `valueOf`, plus the live server (signup of `constructor` / `__proto__` is refused by accounts; `toString`, `hasOwnProperty` signed up and refused).

Evidence (this branch): `node tests/recap.js` 19/19 (11 old + 8 new); `run-tables.js` 180/180, `run-engine.js` 96/96, `run-money.js` 568/568; full suite 166/166 (499 s). Browser leg `python3 qa/port-recap/r2.py 4720 <dir>/bots.json 360x740 1440x900`: 0 problems, 17 JPEGs in `qa/port-recap/r2/`.

## HUNKS FOR LEAD (round 2)
1. `public/index.html`: bump the cache-bust of `recap.js` (`?v=1-port` -> `?v=2-port`, line 200), otherwise a browser holding the old file keeps the old client (a new client against the new server works, the old client against the new server also works: `have` is additive).
Round 1 hunks (lobby.css `.lb-btns`, theme.css `.panel__close`) are still open.

## Open / not verified (round 2)
- #6: in the real UI, `lobby.js` answers every `settle_up` by leaving the table view and showing the settle screen, and returning to the seat sends `table_join` -> `table_joined`, which sets `st.cur` again. So in the browser the buttons also came back with the OLD code; what the old code got wrong was the state (`Recap.state.cur` null after a live `night_get`, checked: null before, set after). I could not find a path where the old behaviour is visible besides that state.
- Account renames are not part of the version: an open overlay shows an old display name until the next hand or money change.
- The 800 ms window is per socket; a user with many tabs gets one build per tab per window.
- Not run: Safari / real phone, 540x900 for the r2 leg (360x740 and 1440x900 only, as asked), landscape.
