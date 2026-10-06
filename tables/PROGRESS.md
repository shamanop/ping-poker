# tables/ + transport/ progress (builder P3, branch v2-tables, worktree wt-tables)

## HAND-OFF (top block, keep current)
- Committed: steps 0-6 and harness slices 1-6 on v2-tables (git log -1). v2-core 0245430 (E1) merged earlier.
- Step 6 DONE: transport/{wallet-adapter,views,safe,index,boot,rig}.js, transport/handlers/{auth,lobby,seat,host,social,admin,bank}.js, auth/index.js, admin/index.js, thin server.js (about 140 lines).
- Proofs (run on this box, `--jobs 1`): 30_shapes 42/42 with empty allowlist; slice1 (01-06) 25/25; slice2 (07,17,23,25) 16/16; slice3 (08,09,12,13,15) 24/24; slice4 (11,20,22,24,26,27) 30/30 incl. 24b (E1 is merged); 14 1/1 (72 s); 10 fuzz passed on a re-run (first two runs had transient single-audit violations, see Findings). `node tests/v2-unit/run-tables.js` 126/126.
- Open: step 8 (whole run, run-money/run-engine/run-tables), step 9 (old suites + cleanup of tables.js, legacy-stale, package.json test), the fuzz flake (below), `tables/PROGRESS.md` summary of results/v2.json.
- Wiring: server.js builds ctx = {io, accounts, service, ledger, presLedger, social, wallet, money(port), registry, views, safe, auth, adm, rig}; transport/index.js `createTransport(ctx)` adds ctx.out/pushMoney/pushWallet/pushBank/pushLobby/afterWrite/announceAccount/tableEvent and `start()` registers io.on('connection'). Handlers: `register(ctx, socket, on)`; `on` = safe.onEvent (payload always an object, expected errors -> error event, anything else -> log + void touched table).
- Findings fixed during step 7: (1) boot migration: V2-DESIGN rule "migrate when no mig: refs" doubled every balance on the 2nd boot when the 1st boot had no accounts (mirror files then hold v2 money). Now boot copies bank/wallet/stacks/accounts to <name>.pre-v2 once (a missing file becomes '{}'), always migrates from those copies (idempotent by refs). (2) views: during run-out every live seat reads allIn (engine clears allIn when the uncalled layer returns; harness 20/S8b-c waits for allIn). (3) Table.auditSeats reports stack 0 for a seat that left mid-hand (was a double count in the fuzz audit).
- Fuzz flake: with seed 12345, two runs gave 2 and 4 transient single-audit violations (a -N audit then +N at the next, total leak 0); the third run had none. rig.js now logs `[v2] AUDIT DRIFT` to server.log when a seat disagrees with the ledger; no drift was seen. Not explained yet; see Findings below when closed.
- Gotchas: tests/v2/results/*.json from my slices are scratch, do not commit them. Run harness slices as `setsid nohup node tests/v2/run.js --only NN,.. --jobs 1 --label X > tables/runs/X.log 2>&1 &` and poll. Scratch debug scripts live in tables/runs (gitignored).
- Context note: P3b started at 15M budget; this block written at about 230K total tokens used by P3b (cap 150K context is about at limit); a fresh P3c should continue at step 8.

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
| 7 | harness slices | done except fuzz flake under investigation |
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
