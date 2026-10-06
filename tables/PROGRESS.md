# tables/ + transport/ progress (builder P3, branch v2-tables, worktree wt-tables)

## HAND-OFF (top block, keep current)
- Committed: step 3 (see git log; v2-core 0245430 merged at ddfe12d: houseRound + engine E1).
- Done: steps 0-3. settings.js, money-port.js, table.js (seats, deadlines, pause, grace, host transfer, autostart check; NO hands).
- Last proof: `node tests/v2-unit/run-tables.js` -> tables total 67/67 in 3 files; run-money 90/90 (before E1 merge). Engine 96/96 per lead, not re-run by me.
- Open: steps 4-9.
- Next: step 4, hand lifecycle in tables/table.js. Hooks already in place: `fireHand(d)` (turn/pre/street/nexthand deadlines, hand:true so pause freezes them), `leaveInHand(seat, kind)` (called by leave() when `liveSeat(seat) && !seat.folded`), `startHand()` (autostart calls it), `this.hand` (engine hand), `committedOf(seat)`, `checkAutostart()`, phase field.
- Table API facts: `new Table(rec, {money, clock, out, hooks:{seatOf,profileOf}, onError, rng, constants})`; rec is validateSettings value + {id, hostKey, permanent, nightId, nightFromId, nightHand0, blindStartAt, handNo}; `rec.seats` (count) is kept as `table.maxSeats`, `table.seats` is a Map seatNo -> seat record. `out.event(table, kind, data, toKey?)` kinds so far: joined, rebuy, left, room, money, table_event, taken_over; transport/views maps them to the wire names. Deadline ids: 'phase' (autostart/turn/street/nexthand, one at a time), 'grace:<seat>', 'host'.
- Gotchas: buy-in reason is `buyin:<fund>` for rebuys too (ref kind differs only in the ref). money-port `cashOut` returns `{intent:{amount}}`; `leave()` sweeps the whole seat balance when no hand is live. Exec calls over ~60 s need setsid nohup. wt-tables has node_modules symlinked.

## Status
| Step | What | State |
|---|---|---|
| 0 | setup, baseline | done (baseline = tests/v2/results/old-suite-baseline.txt, harness builder: all old suites pass on 9440541 except preselect (5 FAIL lines) and migrate (fails only when accounts.json is left in repo root)) |
| 1 | tables/settings.js | done (24 tests) |
| 2 | tables/money-port.js | done (20 tests), not yet reviewed by lead |
| 3 | tables/table.js seats | done (23 tests in tables-seats.js) |
| 4 | hand lifecycle | todo |
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
