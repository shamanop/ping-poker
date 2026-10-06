# tables/ + transport/ progress (builder P3, branch v2-tables, worktree wt-tables)

## HAND-OFF (top block, keep current)
- Committed: steps 0-6 and harness slices 1-6 on v2-tables (git log -1). v2-core 0245430 (E1) merged earlier.
- Step 6 DONE: transport/{wallet-adapter,views,safe,index,boot,rig}.js, transport/handlers/{auth,lobby,seat,host,social,admin,bank}.js, auth/index.js, admin/index.js, thin server.js (about 140 lines).
- Proofs (run on this box, `--jobs 1`): 30_shapes 42/42 with empty allowlist; slice1 (01-06) 25/25; slice2 (07,17,23,25) 16/16; slice3 (08,09,12,13,15) 24/24; slice4 (11,20,22,24,26,27) 30/30 incl. 24b (E1 is merged); 14 1/1 (72 s); 10 fuzz seeds 7/99/12345 pass after the auditSeats fix. `node tests/v2-unit/run-tables.js` 126/126.
- Open: step 8 (whole run `setsid nohup node tests/v2/run.js --jobs 1 --label v2 > tables/runs/full.log 2>&1 &`, then run-money 90/90, run-engine in background, run-tables 127/127), step 9 (old suites one at a time, port join_game lines in allin/rejoin/tables tests, move mp/bankedit/bankfix/pause/reset/persist to tests/legacy-stale with README, delete root tables.js, package.json test, grep check from brief done-criterion 7, `git log --stat v2-core..v2-tables` owned paths only), then fill Not verified / Guesses / Where the contract was wrong in this file.
- Wiring: server.js builds ctx = {io, accounts, service, ledger, presLedger, social, wallet, money(port), registry, views, safe, auth, adm, rig}; transport/index.js `createTransport(ctx)` adds ctx.out/pushMoney/pushWallet/pushBank/pushLobby/afterWrite/announceAccount/tableEvent and `start()` registers io.on('connection'). Handlers: `register(ctx, socket, on)`; `on` = safe.onEvent (payload always an object, expected errors -> error event, anything else -> log + void touched table).
- Findings fixed during step 7: (1) boot migration: V2-DESIGN rule "migrate when no mig: refs" doubled every balance on the 2nd boot when the 1st boot had no accounts (mirror files then hold v2 money). Now boot copies bank/wallet/stacks/accounts to <name>.pre-v2 once (a missing file becomes '{}'), always migrates from those copies (idempotent by refs). (2) views: during run-out every live seat reads allIn (engine clears allIn when the uncalled layer returns; harness 20/S8b-c waits for allIn). (3) Table.auditSeats reports stack 0 for a seat that left mid-hand (was a double count in the fuzz audit).
- Fuzz flake RESOLVED: seeds 12345, 7 and 99 each showed 2-4 transient single-audit violations (-N then +N, total leak 0). Cause: for a seat that left/was kicked mid-hand, Table.auditSeats double counted its cashed-out stack, and ignored the E1-returned layer that stays inside the seat account until the batch (rig.js `[v2] AUDIT DRIFT` showed ledger 3555 vs memory 2917 = 638). Fixed in tables/table.js (leaver: stack 0, handBet = committed) with two unit tests. After the fix: seeds 7, 99, 12345 all 4/4 PASS (`node tests/v2/10_fuzz.js --target . --seed N`, 91-99 s each) and no AUDIT DRIFT lines.
- Gotchas: tests/v2/results/*.json from my slices are scratch, do not commit them. Run harness slices as `setsid nohup node tests/v2/run.js --only NN,.. --jobs 1 --label X > tables/runs/X.log 2>&1 &` and poll. Scratch debug scripts live in tables/runs (gitignored).
- Context note: P3b stopped at the context cap after step 7; a fresh P3c continues at step 8 from this block. Other builders' servers (wt-client port 3580, coldcall 4610) are on this box: harness ports 3500-3559 were free, do not kill those processes.

## Status
| Step | What | State |
|---|---|---|
| 0 | setup, baseline | done (baseline = tests/v2/results/old-suite-baseline.txt, harness builder: all old suites pass on 9440541 except preselect (5 FAIL lines) and migrate (fails only when accounts.json is left in repo root)) |
| 1 | tables/settings.js | done (24 tests) |
| 2 | tables/money-port.js | done (20 tests), not yet reviewed by lead |
| 3 | tables/table.js seats | done (23 tests in tables-seats.js) |
| 4 | hand lifecycle | done (28 tests in tables-hands.js) |
| 5 | registry + viewlog | done (14 + 5 tests) |
| 6 | transport + boot | done (30_shapes 42/42, empty allowlist) |
| 7 | harness slices | done (all slices green, fuzz 3 seeds green) |
| 8 | whole run | done: 142/147 pass; the 5 FAIL are all check 21 and contradict contract H6 (see Harness vs contract) |
| 9 | old suites + cleanup | todo |

## houseRound in the wallet adapter (lead, 03:5x; v2-core 819f9db merged into v2-tables at 61d3e3a)
- Merged v2-core into v2-tables; money 90/90, tables 44/44 after the merge.
- games/bender.js:90-91 (and coldcall.js:76-77 on the coldcall branch) call `wallet.spend(key, mode, cost, {game, round})` then `wallet.credit(key, mode, totalWin, {game, round})` and stay unchanged. The adapter (transport/wallet-adapter.js, step 6) therefore: `spend` checks the balance only (throws `funds` if short), parks `{key, mode, cost}` under `<game>:<key>:<round>` and writes nothing; `credit` with the same ref pops it and makes ONE `service.houseRound(game, key, cost, win, cur, '<game>:<key>:<round>')`. A spend with no credit by the end of the tick is flushed as houseRound(cost, 0) so a stake is never silently dropped. `wallet.get` subtracts parked costs. credit(win 0) is spend only, so no special case. Non-round credits (achv, bonus) stay houseCredit.
- Not built yet; step 6 builds it and tests: crash between spend and credit leaves the ledger unchanged, retry with the same ref answers dup, funds error leaves nothing written.

## Notes from server.js / tables.js (reading)

## Where the contract was wrong

## Harness vs contract
- **Check 21 (`tests/v2/21_money_stores.js`, 5 checks) cannot pass against the contract.** It seats the same accounts at two tables at once (Bob at the chips table and the play table, Cat likewise, Dee and Ann at POKERPING as well). The contract (V2-DESIGN one seat per account, brief hard rule, harness check 13/H6) answers the second `table_join` with `error one_seat` ("You already have a seat at a table"). `seat()` in 21 then returns null and `s2[0].emit` throws `Cannot read properties of null (reading 'emit')`, so all 5 checks fail with ERR. Reproduced with a scratch copy that logs the sit errors (tables/runs/dbg21.js, 4 errors printed, all one_seat). The baseline passed 2 of the 5 only because the old server allowed multi-seating (the bug H6 pins). Not worked around: the table layer keeps one seat per account. The lead needs to fix the harness (use distinct accounts per table, or leave before the next sit). The money invariants that 21 checks (restart conservation, settle-ups zero-sum) are exercised by 07/17/23/25, 08/09 and the fuzz 10, all green.

## Not verified

## Guesses
