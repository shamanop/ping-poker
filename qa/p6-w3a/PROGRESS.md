# P6 wave 3a drivers: PROGRESS (builder, Sonnet 5.5)

Started 2026-10-06 ~20:05, done ~21:00. Server under test: clean export /tmp/p6-w3a-e596336 (`public/` and `games/coldcall.js` identical to wt-all e596336).
No git write command was run by the builder. Nothing outside `qa/p6-w3a/` and `_scratch/p6/w3/builder/` was written.

## Files
- `run.sh [exportDir] [port]`: boots the export on a fresh scratch data dir (RIG=1, PORT, DATA_DIR), prints the `game recovery:` line, runs smoke.js then errors.js, one PASS/FAIL line per driver, kills the server by PID. `DRIVERS="smoke"` / `DRIVERS=none` to limit.
- `smoke.js --base URL --data DIR` -> `smoke-result.json`. `errors.js --base URL [--record] [--old-game FILE --only E1,E2 --kinds round_closed]` -> `errors-result.json`.
- `lib.js` (browser, ledger replay of money.jsonl, real-click helpers), `fixtures/` (real shell messages: init, plain, pick_pending, more_pending, buy_done, round_msgs, meta), `shots/` (11 JPEGs, each < 150 KB), `errors-negative-control-result.json`.

## Last runs (via `qa/p6-w3a/run.sh`, fresh server, box load ~6-10)
- smoke.js: 134 passed, 0 failed (play + chips, one fresh account each, 10 plain spins, bonus buys with PICK / ONE MORE CALL / HANG UP answered by clicks, one bonus2 buy, 20-click burst, poker hand docked, docked spin after).
- errors.js: 166 passed, 0 failed (round_closed and internal x E1 E2 E3 E3b E4 E5 E5m E6, plus funds x E1 E2).
- Negative control: errors.js with the client BEFORE e596336 (`git show e596336^:public/games/coldcall/game.js`, served through `--old-game`) on E1 E2 E6 round_closed: 20 passed, 9 failed (no hello after the error, meter stays at the first wallet, E6 still reads CALLBACK). So the driver does detect the bug the commit fixes.

## Deviations from the brief (all deliberate)
- Bonuses come from the BUY menu (bonus1 until PICK + ONE MORE CALL, bonus2 once). The bridge iframe URL is fixed (`?bridge=1`) and the server has no `force` without COLDCALL_TEST, so there is no real-click way to force one; COLDCALL_TEST is not set (production-like).
- Funding = sign-up grant (10,000 chips / 1,000,000 Play cents) + the daily bonus claimed by a real click on CLAIM.
- Poker step runs in the chips run at 1280x800: at 540 px the docked slot covers the whole poker stage. The slot is docked by the real "Dock right" button, then one socket bot (tests/v2 `Bot`) and this page play one heads-up hand (page: real clicks on CHECK/CALL; bot calls). Leaving the table opens a native `confirm()`: the driver accepts it.
- Poker action buttons are checked against `act act-fold / act-call / act-raise` (what UI-KIT.md documents for them), not `btn btn--*`. Dock buttons are checked for `btn btn--icon`.
- `tests/v2/lib.js` is required for `Bot` / `audit`: it installs its own uncaughtException handler (exit 2).
- Rig audit "clean" = `ledger.chips.ok && ledger.play.ok && quarantined 0`, no drift, `walletPending` 0, `games.coldcall.openRounds` empty.
- The 20-click burst takes about 65-115 ms (not 1 s) and always produces exactly ONE round: SPIN while a round runs is a skip tap by design. Server rounds = screen rounds = ledger rounds (1 = 1 = 1).
- The Chips plate in the shell shows bank + table stacks (checked as such when seated).

## Findings (product)
- None that fail a check. Minor, not checked as failure and listed in the driver notes: `GET /favicon.ico` answers 404 on every page load, so each run logs one `console.error: Failed to load resource ... 404`. The drivers exclude exactly that URL from the "no console error" check and print it.

## Flakes / not covered
- No timing flake seen in the final runs. The `within 3 s` window is measured from the stub's error send; settled times were 7 to 514 ms (18 cases that report it, most under 100 ms).
- Not run: the Bender slot, the admin console, a real server-side `round_closed` (the errors are injected by the stub parent, as the brief says), a phone-width poker table with the slot docked. tests/v2/run.js was not run (lead's).
