# PROGRESS-recap (night recap port, branch port-recap)

STATUS: DONE, waiting for the lead's merge. Nothing pushed, nothing merged.

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
