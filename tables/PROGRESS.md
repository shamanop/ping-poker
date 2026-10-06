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
- **Boot migration rule** ("migrate when there are no `mig:` refs") doubled every balance on the second boot when the first boot had no accounts (the mirror files then hold v2 money). Fixed in step 7: boot copies bank/wallet/stacks/accounts to `<name>.pre-v2` once (a missing file becomes `{}`), always migrates from those copies, idempotent by refs.
- **Run-out `allIn`**: the engine clears `allIn` once the uncalled layer is returned, so the contract's "allIn from the engine" made every live seat read not-all-in during the run-out. Views now report allIn for every live seat in run-out (harness 20/S8b-c waits for it).
- **`Table.auditSeats`**: the contract's `ledger.balance(seat) === stack + committed - returned` has no term for a seat that left or was kicked mid-hand (its stack is already cashed out; an E1-returned layer stays in the seat account until the batch). Leaver rows now report stack 0 and handBet = committed (two unit tests).
- **`MONEY_FILE` default**: contract 9 puts `money.jsonl` in `DATA_DIR` (default = repo root). A caller that moves only `BANK_FILE` (every old suite) then writes `money.jsonl` into the repo root and re-reads it on the next run (balances and hand numbers leak across runs). Now `MONEY_FILE` defaults next to `BANK_FILE` (identical when `DATA_DIR` holds `bank.json`, which is the production layout).
- **`bank.json` mirror folds seats in** (contract 9, correct as written) but contract section 1 text also says the old files stay "the same": every old assertion of the form bank + table chips = total, or "bank.json lists only players who touched the chips bank", is stale. Ported tests read the mirror total only (allin, rejoin, tables, profile). The mirror is debounced 250 ms, so old tests that read `bank.json` right after a write needed a 400 ms sleep.
- **`settle_up.payments`**: the viewlog/registry I wrote earlier added `payments` (from `ledger.settlePayments`) to the `settle_up` payload. 9440541 `nightPayload` has no such key and `tests/tables.js` asserts it is undefined. Removed (also removed the `settlePayments` hook in server.js).
- **Presentation rows for play-money tables**: viewlog wrote `buyin`/`rebuy`/`cashout` rows for `unit === 'cents'` tables. The old server wrote none until the night-end rows (`tests/tables.js` "Play $ join writes no ledger rows"). viewlog now returns early for cents tables.
- **Safety copies**: 9440541 made `bank.json.bak-<stamp>` and `ledger.json.bak-<stamp>` before the first run that creates `accounts.json` (`tests/accounts.js` asserts it). The v2 boot dropped them. Restored in `prepareDataDir`.
- **Raise over the stack**: the old server clamped an over-stack raise to all-in; the contract (harness 27) makes it a structured error, and a raise that only equals the bet answers "Raising is closed". Old suites (allin, tables) that sent `raise 100000` or `raise 10000000` now send the exact all-in amount, or `call`.
- **`AUTO_START_MS` also gates the next hand** (table.js `checkAutostart`: waiting phase between hands too). The old server used it only for the first deal. `tests/rejoin.js` sets it to 600000 to keep hands from starting; it now starts and restarts the hand with `table_start` from an authenticated `chris` socket (POKERPING `hostKey` is chris).
- **POKERPING blinds**: contract default 25/50; 9440541 started at 10/20 (`BLIND_SCHEDULE[0]`). `tests/lib.js startServer` seeds `tables.json` `legacyBlinds {sb:10,bb:20}` so the old suites see the blinds they were written for.
- **A disconnect keeps the seat** (contract, correct). `tests/rejoin.js` "dropped player leaves table" asserted the opposite; now asserts the seat stays, marked offline.

## Harness vs contract
- **Check 21 (`tests/v2/21_money_stores.js`, 5 checks) cannot pass against the contract.** It seats the same accounts at two tables at once (Bob at the chips table and the play table, Cat likewise, Dee and Ann at POKERPING as well). The contract (V2-DESIGN one seat per account, brief hard rule, harness check 13/H6) answers the second `table_join` with `error one_seat` ("You already have a seat at a table"). `seat()` in 21 then returns null and `s2[0].emit` throws `Cannot read properties of null (reading 'emit')`, so all 5 checks fail with ERR. Reproduced with a scratch copy that logs the sit errors (tables/runs/dbg21.js, 4 errors printed, all one_seat). The baseline passed 2 of the 5 only because the old server allowed multi-seating (the bug H6 pins). Not worked around: the table layer keeps one seat per account. The lead needs to fix the harness (use distinct accounts per table, or leave before the next sit). The money invariants that 21 checks (restart conservation, settle-ups zero-sum) are exercised by 07/17/23/25, 08/09 and the fuzz 10, all green.

## Not verified
- Any real browser or the shipped client (`public/*.js`): nothing here ran Playwright or a browser (box RAM, brief). Event names and shapes are pinned by `30_shapes` against 9440541 only.
- The Cold Call merge (`games/coldcall*` is on another branch). Ballot Bender is covered by `tests/bender.js` (19) and `tests/bender-livecfg.js` (5) and the harness slot checks, not by a human play-through.
- A real Railway volume (`RAILWAY_VOLUME_MOUNT_PATH`, volume permissions, fsync cost on network disk). All runs used local temp dirs.
- Two overlapping processes on the same data dir (deploy overlap). Only the single-writer fence in `money.open` is relied on; no test starts two servers on one `money.jsonl`.
- Long soak: the fuzz is ~90 s per seed (seeds 7, 99, 12345 in step 7); nothing ran for hours, and the 20 min `--long` harness mode was not run.
- Old `tests/legacy-stale/*` suites were moved, not run (they drive deleted events).
- `tests/showbank.js`, `bankview.js`, `blinds.js`, `moneysync.js`, `playtable.js`, `showcards.js` (not in `npm test`, not listed by the brief) were not touched and not run; `showbank.js` and `moneysync.js` still use `bank_set` and `qa/finaltest/D/lib.js` (`join_game`) and are stale.
- Memory footprint under load of more than one table of players per process.
- Harness check 21 (5 checks) does not pass, for the harness reason above; the money invariants it targets are only exercised indirectly by 07/17/23/25, 08/09 and the fuzz.

## Guesses
- `tests/lib.js` port: I mapped `room_joined` to `table_joined` (adding `roomId` = tableId for the old assertions) and made `authJoin` sit at POKERPING with the default buy-in. The brief says 1-2 lines per suite; the old suites needed more (see "Where the contract was wrong"): allin, rejoin, tables, preselect, profile, labels.test edits are all listed in the step 9 commit.
- `check_balance` port in `tests/profile.js`: replaced by a second `auth_login` socket and the `money` event's `chips` (bank + atTable) for the by-key and by-display comparison. A guess that this keeps the intent (balance lives on the account key).
- `tests/preselect.js` "check/fold auto-checked": the old assertion needed a visible `lastAction === 'CHECK'` on the turn; in v2 the street closes at once and clears it, so the check now waits for the river with the dealer not folded.
- Dropping the `payments` key and the play-table presentation rows is a guess that nobody reads them (grep of `public/` finds no `payments`); the shape harness would not have caught either.
- `MONEY_FILE` next to `BANK_FILE` assumes production never sets `BANK_FILE` outside `DATA_DIR` on purpose.
- Remaining `legacy` words in the criterion-7 grep are not comments saying "deleted": `legacyBlinds` (the `tables.json` key, the contract keeps the file shape), `legacy-import.json` / `legacyImport` (carry-over of the original chips history, kept from 9440541), `legacyRoom` (the room shape `ledger.js` and `social.js` still read). I judged them data and internal names, not the deleted join path, and did not rename them.
- `.gitignore` gained `tables/runs/` (scratch dirs, as the brief says); `.gitignore` is outside the owned list.
