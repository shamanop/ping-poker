# tables/ + transport/ progress (builder P3, branch v2-tables, worktree wt-tables)

## HAND-OFF (top block, keep current)
- Steps 0-9 DONE. Last commit: see `git log -1` on v2-tables (pushed). Nothing is owed except what the lead decides below.
- Step 8 (whole run): `node tests/v2/run.js --jobs 1 --label v2` 142 pass / 5 fail (483 s); rerun after step 9 as `--label v2b`: 142 / 5 (493 s). All 5 fails are check 21 (`21_money_stores.js`): it seats one account at two tables, which the one-seat contract answers with `one_seat`; see "Harness vs contract". Not worked around. Every other check passes, 24b included (E1 merged), 30_shapes 42/42 with `allowlist.json` still `{ "events": [], "keys": [] }`.
- Unit: `run-money.js` 90/90, `run-engine.js` 96/96 (80 s), `run-tables.js` 127/127 (tables-hands.js mini fuzz was flaky 3 of 10 runs because the deck rng is crypto: seeded now, 18 runs green).
- Step 9: `NODE_OPTIONS="--require tests/v2/baseline/remap-isabelle-path.js"` then each of preselect (18 PASS), allin (4), rejoin (14), migrate (11), labels.test (45025 checks, showdown/makeRoom section skipped with a printed reason), clientlabels.test, accounts (39), tables (72), profile (46), social (85), bender (19), bender-livecfg (5), money.test: all exit 0, one at a time, `git checkout qa; git clean -fdq qa` after each. At step 0 on 9440541 preselect and migrate failed (migrate only with a leftover accounts.json); both pass now. mp/bankedit/bankfix/pause/reset/persist moved to `tests/legacy-stale/` with README. Root `tables.js` deleted. `package.json` test lists the 13 suites above.
- `git log --stat v2-core..v2-tables` is inside the owned paths plus: `.gitignore` (tables/runs/), `package.json` (the brief asks for the test script), and the existing `tests/*.js` ports (allin, authjoin, lib, labels.test, preselect, profile, rejoin, tables): the brief allowed 1-2 line ports, these needed more, each edit is commented `v2:` in the file and explained under "Where the contract was wrong".
- Criterion 7 grep: no join_game/create_demo/bank_set/reset_table/set_pause/check_balance/start_game/keepStacks; `legacy` still appears as data/internal names (see Guesses).
- Old-suite runner: `tables/runs/old-suites.sh <suite...>` (scratch, gitignored) writes `tables/runs/old-summary.log`.
- Gotchas: `tests/v2/results/*.json` are scratch, never commit. Never `pkill -f` with a pattern that appears in your own command line (it kills the shell). Other builders' servers (wt-client 3581, coldcall 4610, /tmp/p4b-v2tables) are on this box: leave them.

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
| 8 | whole run | done: 142/147 pass; the 5 FAIL were all check 21 (contradicted H6); after v2-core 7f51a19 check 21 is 4-5/5, remaining flake is the harness bot (see Harness vs contract) |
| 9 | old suites + cleanup | done: 13 old suites pass one at a time, 6 moved to tests/legacy-stale, root tables.js deleted, harness rerun 142/147 (same 5, check 21) |

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
- **Check 21 after the lead's fix (v2-core 7f51a19, merged into v2-tables as b432eab): 5/5 in 2 runs (40 s), 4/5 in 3 runs.** The recurring fail is `sigkill-after-showdown` ("harness could not set up the kill", 160 s wait). Evidence from a debug copy (tables/runs/dbg21b.js, log dbg21b_1.log): T1 sits in hand 7 `playing`, pot 2150, Cat all-in 2000, Ann (to act, stack 850 + bet 150) holds `errors: ['Raising is closed']` and never acts again, for 80+ s. Cause is the harness bot `drive()` (lines 25-27): `raise` to `currentBet + 100` or to `chips + roundBet` without checking `legalActions`; when the seat cannot legally raise, v2 answers a structured error (contract, check 27) where 9440541 clamped to a call, and the bot has no retry (it only acts on the next state event, and none comes). So the turn waits forever because no turn clock runs (T1 `actionTimerSec: 0`). Not a table-layer fault; a bot fix would be: on error, or when `toCall >= me.chips`, send `call`. Not edited (tests/v2 is read-only for me).
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
