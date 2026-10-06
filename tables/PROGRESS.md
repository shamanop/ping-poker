# tables/ + transport/ progress (builder P3, branch v2-tables, worktree wt-tables)

## HAND-OFF (top block, keep current)
- Committed: (nothing yet beyond branch point 1c50d0e)
- Done: step 0 setup (worktree, node_modules symlink, .gitignore tables/runs/)
- Last proof: `node tests/v2-unit/run-money.js` -> money total 85/85 passed in 3 files
- Open: steps 1-9
- Next: step 1 tables/settings.js + tests/v2-unit/run-tables.js
- Gotchas: engine amendment E1 NOT yet in v2-core (wt-engine at 1c50d0e); money amendments (cashOut seat fund, quarantine) ARE in (39dd280), so pass `null` fund to cashOut.

## Status
| Step | What | State |
|---|---|---|
| 0 | setup, baseline | done (baseline = tests/v2/results/old-suite-baseline.txt, harness builder: all old suites pass on 9440541 except preselect (5 FAIL lines) and migrate (fails only when accounts.json is left in repo root)) |
| 1 | tables/settings.js | todo |
| 2 | tables/money-port.js | done (20 tests), not yet reviewed by lead |
| 3 | tables/table.js seats | todo |
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
