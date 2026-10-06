# P5 fix A progress (Q03, Q08), branch p5-fix-a

## Server (Q03), `node tests/e2e/sweep/fix_a_socket.js` (port 4711)
BEFORE (head caa487d):
```
FAIL  table_info-lists-callers-disconnected-seat  caller with a disconnected seat: info.you = undefined
PASS  non-seated-caller-gets-no-seat
FAIL  rebind-of-a-busted-seat-resends-bust_out-and-no-stale-hand  bust_out after rebind: null
```
With the bust_out fix but without the views fix, the third check also fails on "stale board shown on a waiting table: [K 9 4 3 J]".
Fix: views.tableInfo(t, key) adds `you {seated, connected, stack}` and `away [{key, display, stack}]`; handlers/lobby.js passes the key;
Table.rebind re-sends `bust` (-> bust_out) for a stack-0 seat; views.shownHand hides the old hand on a `waiting` table (game_state community/street, your_cards).
AFTER: 3/3 PASS.

## Browser proof, `E2E_BASE=http://127.0.0.1:4710 python3 -u tests/e2e/sweep/fix_a_leave.py [chips|play]`
BEFORE (head caa487d, 17 checks, 7 failed; the run stops after (c) finds no control):
```
FAIL (a) RESUME opens the table
FAIL (a) no buy-in form was offered
FAIL (a) seat is connected again
FAIL (b) no buy-in form for a seat you hold
FAIL (b) the rebuy panel is open with a Rebuy button {'open': False, 'btn': True, 'board': 0, 'hero': 0}
FAIL (c) Leave control exists and is visible at 1440x900 None
FAIL (c) it is labelled "Leave table" None
```
AFTER: `fix_a_leave chips: 23 checks, 0 failed`, `fix_a_leave play: 23 checks, 0 failed`.
Play-mode note: a one-off bronze tier reward (social.js, 2500 cents) can land in the leave window; the test allows exactly that.
Unit: tests/v2-unit/tables-seats.js new case "rebind of a stack-0 seat re-sends bust" fails on caa487d (got 0 want 1), 24/24 after.

## Fix summary
- transport/views.js: tableInfo(t, key) adds `you {seated, connected, stack}` and `away [{key, display, stack}]`; shownHand hides the old hand on a `waiting` table.
- transport/handlers/lobby.js: table_preview passes the caller key.
- tables/table.js rebind: a stack-0 seat gets `bust` (bust_out) again.
- public/lobby.js: seatOfMine(info) (also from `you`); onInfo goes straight to table_join for a seat you hold (no buy-in form); preview lists away seats.
- public/index.html + public/game.js: visible "Leave table" plate button (#btn-leave-table) with the confirm text, calls leaveToLobby().
## Regression (unchanged green)
run-tables 127/127 (after: +1 case in tables-seats), run-money 90/90, run-engine 96/0, amountfield 66/0, money.test 6538/0, tests/v2/30_shapes.js exit 0.
## Not verified
Phone layout (separate job); a Leave press while the table is paused or ended; multi-tab resume race.
