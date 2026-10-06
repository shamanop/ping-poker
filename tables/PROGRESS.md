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
| 2 | tables/money-port.js | todo |
| 3 | tables/table.js seats | todo |
| 4 | hand lifecycle | todo |
| 5 | registry | todo |
| 6 | transport + boot | todo |
| 7 | harness slices | todo |
| 8 | whole run | todo |
| 9 | old suites + cleanup | todo |

## Notes from server.js / tables.js (reading)

## Where the contract was wrong

## Harness vs contract

## Not verified

## Guesses
