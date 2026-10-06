# tables/ + transport/ progress (builder P3, branch v2-tables, worktree wt-tables)

## HAND-OFF (top block, keep current)
- Committed: step 4 (git log -1 on v2-tables). v2-core 0245430 merged (houseRound + E1).
- Done: steps 0-4. tables/{settings,money-port,table,hand-flow}.js. table.js = seats/deadlines/pause/grace/host; hand-flow.js (mixed into Table.prototype) = startHand, act, timeoutTurn, preselect, run-out pacing, settle (commit point), afterCommit (best-effort steps), void, endNight/finishNight, leaveInHand.
- Last proof: `node tests/v2-unit/run-tables.js` -> tables total 95/95 in 4 files (settings 24, money-port 20, seats 23, hands 28).
- Open: steps 5-9.
- Next: step 5 tables/registry.js (+ tables/viewlog.js). Table is constructed `new Table(rec, {money, clock, out, hooks:{seatOf, profileOf}, onError, rng, constants, deckSource})`. `deckSource()` returns a queued RIG deck or null (rig.js in step 6).
- out.event kinds emitted by Table: joined, rebuy, left, room, money{keys}, table_event{kind: paused|resumed|kicked|host|...}, taken_over{socketId}, blinds_up, hand_start, hand_end{hand,result,bySeat}, bust{key,seat}, void{reason}, night_end{reason,keys}; out.state(table) = push game_state. views.js (step 6) maps them to wire names. `table.lastResult` is the 4.6 showdown_result object plus `.history` (the handHistory row); `table.history` is the last 10 rows; `table.log` the log ring; `table.auditSeats()` feeds `__audit.drift` (money-port.drift).
- Gotchas: seat.stack is the HAND-START stack while a hand is live (engine stack is in hand.seats[n].stack; seat.stack is copied at the commit). A void restores seat.stack from handStartStacks and sweeps leaving seats. `committed` flag on the table = settleHand returned. A settle failure before the commit voids then rethrows; deadline errors go to onError (transport must void and re-arm). Turn clock: actionTimerSec 0 means no clock for a connected seat; a disconnected seat uses TURN_MS (env, 30 s). Grace expiry mid-hand retries every 5 s.
- Not yet done in table layer: table_start (host start from waiting) entry point beyond startHand(), updateSettings (table_update), idle sweep, hostKey reassignment on registry level (Table.transferHost exists).

## Status
| Step | What | State |
|---|---|---|
| 0 | setup, baseline | done (baseline = tests/v2/results/old-suite-baseline.txt, harness builder: all old suites pass on 9440541 except preselect (5 FAIL lines) and migrate (fails only when accounts.json is left in repo root)) |
| 1 | tables/settings.js | done (24 tests) |
| 2 | tables/money-port.js | done (20 tests), not yet reviewed by lead |
| 3 | tables/table.js seats | done (23 tests in tables-seats.js) |
| 4 | hand lifecycle | done (28 tests in tables-hands.js) |
| 5 | registry | todo |
| 6 | transport + boot | todo |
| 7 | harness slices | todo |
| 8 | whole run | todo |
| 9 | old suites + cleanup | todo |

## houseRound in the wallet adapter (lead, 03:5x; v2-core 819f9db merged into v2-tables at 61d3e3a)
- Merged v2-core into v2-tables; money 90/90, tables 44/44 after the merge.
- games/bender.js:90-91 (and coldcall.js:76-77 on the coldcall branch) call `wallet.spend(key, mode, cost, {game, round})` then `wallet.credit(key, mode, totalWin, {game, round})` and stay unchanged. The adapter (transport/wallet-adapter.js, step 6) therefore: `spend` checks the balance only (throws `funds` if short), parks `{key, mode, cost}` under `<game>:<key>:<round>` and writes nothing; `credit` with the same ref pops it and makes ONE `service.houseRound(game, key, cost, win, cur, '<game>:<key>:<round>')`. A spend with no credit by the end of the tick is flushed as houseRound(cost, 0) so a stake is never silently dropped. `wallet.get` subtracts parked costs. credit(win 0) is spend only, so no special case. Non-round credits (achv, bonus) stay houseCredit.
- Not built yet; step 6 builds it and tests: crash between spend and credit leaves the ledger unchanged, retry with the same ref answers dup, funds error leaves nothing written.

## Notes from server.js / tables.js (reading)

## Where the contract was wrong

## Harness vs contract

## Not verified

## Guesses
