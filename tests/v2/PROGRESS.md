# tests/v2 progress (builder P0: acceptance harness)

Status: DONE. Everything in `builders/P0-HARNESS.md` is built, the baseline run matches `EXPECT.json`, and the suite was run three times on 9440541 (see Flakiness).

## How to run

```
bash tests/v2/baseline/setup.sh              # once: worktree ../baseline-9440541 = 9440541 + rig.patch (only the RIG=1 hooks __rig / __audit)
node tests/v2/run.js --baseline              # all checks on the baseline; exit 0 only if every check matches tests/v2/EXPECT.json (about 150 s, 3 files in parallel)
node tests/v2/run.js --target <dir>          # all checks on any server dir (v2: --target .); exit 1 on any fail; results/<label>.json
node tests/v2/run.js --only 02,07 --jobs 1   # some files; --long = 8 minute fuzz
node tests/v2/NN_name.js --target <dir>      # one file (V2_CHECK_ONLY="substr|substr" runs only matching checks)
node tests/v2/report.js --write | --diff A B | --bugs     # table into this file, diff two result files, per bug ID counts
node tests/v2/30_shapes.js --target <baseline> --record   # re-record shapes/9440541.json (3 runs, baseline only)
```
Ports 3500-3559: run.js gives file number k the block 3500+2k (+0, +1). The target must run with `RIG=1` (the baseline patch adds the hooks, v2 ships them) and must honour `PORT`, `HAND_DELAY_MS`, `AUTO_START_MS`, `TURN_MS`, `HOST_GRACE_MS` and the data-file env vars the old server reads (`lib.startServer` also sets `DATA_DIR` and `MONEY_FILE`).

## What is in tests/v2

| file | covers |
|---|---|
| `lib.js` | startServer/Bot/audit/moneyTotal/rigDeck/tableWith/step (audit lib port) + `drive` policies, `dealAligned`, `runPot`/`refSettle` (reference pot settlement), `suite` (check runner) |
| `baseline/` | `setup.sh`, `rig.patch`, `remap-isabelle-path.js` (lets the OLD tests find socket.io-client) |
| 01 | H4 heads-up blinds |
| 02 | H2, H3, L5 (reject, not rewrite), M8 (short shove stays legal) |
| 03 | hand evaluator, 11 edge cases through rigged showdowns |
| 04, 20 | side pots, odd chip (L1), uncalled returns, folds, stand-up/kick/disconnect with an uncalled layer (H1, N1), L3 |
| 05 | M1 stall, short blind all-in (stacks are made short by losing a rigged hand, so it is valid under stricter table validation) |
| 06 | H1 disconnect |
| 07 | restart mid-hand, SIGTERM/SIGKILL x POKERPING/chips/Play $ (C3, C4) |
| 08, 09 | legacy events: unauthenticated attacks (C1, C5), and v2 removal of join_game/start_game/create_demo/check_balance/set_pause/reset_table/bank_set (H5, H8, M5) |
| 10 | fuzz with the money invariant (about 90 s; `--long` 8 min; `--seed N`) |
| 11 | M2, M3, M4, L2 |
| 12 | C2 crash |
| 13 | M7 validation, H6 one seat per account, H5 admin set-money, end night mid-hand |
| 14 | M5 blind schedule (takes about 70 s: the server's minimum interval is 60 s) |
| 15 | H7 top-up, M10 rebuy limit |
| 17, 25 | M6 night results across restarts, chips and Play $ |
| 21 | mixed session with SIGTERM mid-hand and SIGKILL after showdown |
| 22 | M9 show cards |
| 23 | N3 SIGKILL within 2 s of a showdown |
| 24 | N1 host kicks mid-hand |
| 26 | hand-log payload: no uncalled return in `winners`, fold-win amount, per-player `net` |
| 27 | v2 structured errors `{code,min,max,have}`, no amounts in message text |
| 30 | payload-shape contract: `shapes/9440541.json` (41 events), `shapes/allowlist.json` (empty) |
| `run.js`, `EXPECT.json`, `report.js` | runner, what each check must be on the baseline, reporting |

## Contract assumptions a phase 3 builder must know (all in the check names or comments)

- `showdown_result` must carry a per-player `net` for every dealt player: `showdown_result.net` as `{name: delta}` or an array of `{name, net}` (26). `winners` lists only players who won pot money (not an uncalled return); on a fold-win `winners[].amount` is the pot the winner took (matched part), not their own uncalled raise.
- Rejection is judged from `game_state` (bet and actor unchanged), except 27 which reads the `error` event and wants `{code, min, max, have}` as integers and no digits or `$` in `message`.
- Hand-by-hand scenarios align the button (`dealAligned`): they fold burner hands until the button sits on seat 0, so v2 may pick any first-hand button. They assume the button advances one seat per hand and that `game_state.players[]` is in seat order with `isDealer`.
- Pot totals = chips still at the table + bank delta. A seat that is kicked, stands up or disconnects mid-hand must have its returned/won money end up in the owner's bank when the hand settles (S8b/S8c/N1).
- Disconnect never folds a seat (06): it stays, `connected:false`, not folded. An all-in seat that dropped still wins at showdown (S5a/S5b).
- One seat per account across tables (13). `bank_set`/`set_pause`/`reset_table`/`start_game`/`join_game`/`create_demo`/`check_balance` are ignored without any state change (08); no demo room is ever created (09).
- `rebuyLimit` caps buy-ins per night: initial buy-in plus the limit, even through leave + sit (15).
- Table create is rejected for BB above max buy-in, min buy-in below BB, and seats above the maximum (or the count is kept as asked) (13).
- `__audit` fields used: `bank`, `wallet`, `accounts`, `minted`, `slotNet`, `rooms[].{id,status,unit,pot,handNum,players[].{key,name,chips,handBet,isBot,fund,connected}}`. The rig also emits `sb, bb, street, currentBet, roundBet, folded, allIn, sittingOut`; no test relies on those.
- `minted` may include `mint:topup` (V2-DESIGN open question 10): no check depends on the old behaviour (15 compares wallets directly; nothing else tops up).
- Bug ID `HL` = the 10/6 hand-log finding (no ID in the reports); `S3-5` = money audit S3-5 (formatted amounts in server text).
- Checks that stand for the old server's interface and are meant to flip on v2: the 7 `v2-legacy-event-*` checks (08), `v2-*` in 27, the `net` checks (26).

## Old suite on 9440541

`results/old-suite-baseline.txt`. 15 of 16 files exit 0 (`npm test` stops at the first failure, so each file ran alone; the old tests need `baseline/remap-isabelle-path.js` because they require socket.io-client from `/home/isabelle/.cache/node_modules`).
`tests/preselect.js` fails on 9440541 (5 FAIL lines, pre-existing). `tests/migrate.js` passes on a clean tree and fails when an earlier run left `accounts.json` in the repo root. Old tests dirty `qa/` and `tests/*.json`; clean the worktree afterwards (`setup.sh` resets it).

## Not covered / not verified

- No check for L4 (blind escalation mid-hand, legacy path only), L6 (showdown reveals every contender, no muck: the v2 `reveals` semantics are not specified), L8, and S7a (three short blind all-ins: cannot be built validly under stricter table validation).
- M8 and most UI items are client rules; only the server side (short shove accepted) is checked.
- The checks are only run on 9440541. How they behave on v2 (e.g. whether `dealAligned`, the `error` event and `net` readings match what phase 3 builds) is untested; the v2-interface checks were written from V2-DESIGN.md only.
- Parallel runs (3 files at once) share one CPU; timing-sensitive checks (N3 kills at 100/300/700 ms, the 15 s action timer) passed in every run so far, but a very loaded machine could flip them. Use `--jobs 1` to rule that out.
- `bank_set`-based H5 check passes on v2 as soon as `bank_set` is ignored; it would not notice a different admin "set money" event that re-introduces the bug.

## Baseline table

<!-- TABLE START -->
Baseline run (9440541, 2026-10-06T08:23Z, 161s): **147 checks, 61 fail, 86 pass** on 9440541.

Reported bugs by what the checks see on 9440541:
- reproduce (every check for the ID fails): C3, C4, H1, H2, H3, H5, H6, H7, H8, M1, M2, M3, M4, M5, M7, M10, L1, L2, L3, L5, L7, N1
- no longer reproduce (every check for the ID passes): C2, M8, M9
- partly (some checks pass, some fail): C1, C5, H4, M6, N3
- no check written: L4, L6, L8

| file | check | bug IDs | on 9440541 | why it passes although a bug is listed |
|---|---|---|---|---|
| 01 | hu-button-posts-small-blind | H4 | FAIL |  |
| 01 | hu-button-acts-first-preflop | H4 | FAIL |  |
| 01 | hu-button-acts-last-postflop | H4 | pass | the non-button already acts first on the flop on 9440541; only the blind posting and the preflop order are reversed |
| 02 | minraise-is-previous-raise-size | H2 | FAIL |  |
| 02 | raise-below-minimum-rejected-not-rewritten | L5 | FAIL |  |
| 02 | raise-above-stack-rejected-not-allin | L5 | FAIL |  |
| 02 | short-allin-raise-is-legal | M8 | pass | M8 is a client rule (game.js blocks the shove); the 9440541 server already accepts a short all-in shove. Kept so v2 keeps it legal |
| 02 | short-allin-does-not-reopen-betting | H3 | FAIL |  |
| 03 | eval-wheel-loses-to-6-high-straight | - | pass |  |
| 03 | eval-wheel-is-a-straight-beats-trips | - | pass |  |
| 03 | eval-steel-wheel-is-a-straight-flush | - | pass |  |
| 03 | eval-flush-beats-straight | - | pass |  |
| 03 | eval-two-pair-on-board-ace-kicker-beats-queen | - | pass |  |
| 03 | eval-board-plays-tie | - | pass |  |
| 03 | eval-three-pairs-best-two-plus-kicker | - | pass |  |
| 03 | eval-full-house-higher-trips-first | - | pass |  |
| 03 | eval-quads-kicker | - | pass |  |
| 03 | eval-flush-compares-five-cards | - | pass |  |
| 03 | eval-ace-high-straight-beats-king-high | - | pass |  |
| 04 | sidepots-four-stacks-all-in | - | pass |  |
| 04 | odd-chip-of-a-split-pot-goes-to-first-winner-left-of-button | L1 | FAIL |  |
| 05 | hand-runs-out-when-all-dealt-players-are-all-in-from-the-blinds | M1 | FAIL |  |
| 05 | short-blind-all-in-unmatched-part-of-the-other-blind-comes-back | - | pass |  |
| 06 | allin-player-who-drops-still-wins-with-the-best-hand | H1 | FAIL |  |
| 06 | seat-that-drops-mid-hand-stays-in-the-hand-with-its-chips | H1 | FAIL |  |
| 07 | restart-midhand-sigterm-legacy-table-money-unchanged | C3 | FAIL |  |
| 07 | restart-midhand-sigkill-legacy-table-money-unchanged | - | pass |  |
| 07 | restart-midhand-sigterm-chips-table-money-unchanged | C3 | FAIL |  |
| 07 | restart-midhand-sigkill-chips-table-money-unchanged | - | pass |  |
| 07 | restart-midhand-sigterm-play-table-money-unchanged | - | pass |  |
| 07 | restart-midhand-sigkill-play-table-money-unchanged | C4 | FAIL |  |
| 08 | unauthenticated-join-game-as-the-admin-name-does-not-seat | C1 | pass | 9440541 (commit 0407c19) needs a signed-in account for join_game; the unauthenticated takeover no longer works |
| 08 | unauthenticated-bank-set-does-not-edit-the-bank | C1 | pass | bank_set checks the account on 9440541; an unauthenticated socket cannot edit the bank |
| 08 | unauthenticated-join-game-with-a-seated-name-cannot-take-the-seat | C1 | pass | join_game uses the signed-in account, not the typed name, on 9440541; no seat takeover |
| 08 | unauthenticated-check-balance-and-create-demo-mint-nothing | C5 | pass | check_balance and create_demo refuse unauthenticated sockets on 9440541 (create_demo is admin-only); nothing is minted |
| 08 | v2-legacy-event-join_game-is-ignored-and-changes-nothing | C1, C5 | FAIL |  |
| 08 | v2-legacy-event-create_demo-is-ignored-and-changes-nothing | C5 | FAIL |  |
| 08 | v2-legacy-event-check_balance-is-ignored-and-changes-nothing | C5 | pass | a signed-in check_balance on 9440541 only reads the caller's own balance; no state change (the creating-rows-by-name mint is gone) |
| 08 | v2-legacy-event-start_game-is-ignored-and-changes-nothing | M5 | FAIL |  |
| 08 | v2-legacy-event-set_pause-is-ignored-and-changes-nothing | C1 | FAIL |  |
| 08 | v2-legacy-event-reset_table-is-ignored-and-changes-nothing | H8 | FAIL |  |
| 08 | v2-legacy-event-bank_set-is-ignored-and-changes-nothing | H5 | FAIL |  |
| 09 | create-demo-unauthenticated-makes-no-room-and-no-money | C5 | pass | create_demo is admin-only on 9440541 (the admin variant still fails) |
| 09 | create-demo-admin-makes-no-room-and-no-money | C5 | FAIL |  |
| 10 | fuzz-server-survives-random-play | C2 | pass | C2: startHand clamps dealerIdx on 9440541, the crash no longer happens |
| 10 | fuzz-money-conserved-at-every-audit | - | pass |  |
| 10 | fuzz-no-table-stalls | - | pass |  |
| 10 | fuzz-everyone-standing-up-returns-all-money-to-banks | - | pass |  |
| 11 | pokerping-headsup-allin-winner-keeps-the-stack-at-the-table | M4 | FAIL |  |
| 11 | pokerping-busted-player-gets-bust-out-and-can-rebuy-the-advertised-minimum | M4 | FAIL |  |
| 11 | queued-checkfold-does-not-fire-while-the-table-is-paused | M3 | FAIL |  |
| 11 | action-timer-checks-a-player-who-can-check-for-free | M2 | FAIL |  |
| 11 | button-moves-to-the-next-seat-when-the-dealer-leaves-between-hands | L2 | FAIL |  |
| 12 | button-seat-removed-then-new-player-sits-server-survives-and-deals | C2 | pass | C2: startHand clamps dealerIdx on 9440541 (regression guard for the stable-seat rewrite) |
| 13 | table-create-rejects-big-blind-above-the-max-buy-in | M7 | FAIL |  |
| 13 | table-create-rejects-min-buy-in-below-the-big-blind | M7 | FAIL |  |
| 13 | table-create-rejects-or-keeps-an-unsupported-seat-count | M7 | FAIL |  |
| 13 | blinds-change-mid-hand-applies-from-the-next-hand | - | pass |  |
| 13 | end-night-mid-hand-waits-for-the-hand-then-settles-and-conserves-money | - | pass |  |
| 13 | one-seat-per-account-across-tables | H6 | FAIL |  |
| 13 | disconnect-leaves-no-connected-ghost-seat | H6 | FAIL |  |
| 13 | admin-saving-the-shown-total-changes-nothing | H5 | FAIL |  |
| 14 | pokerping-blinds-never-drop-below-25-50-when-a-blind-interval-is-requested | M5 | FAIL |  |
| 15 | play-topup-counts-money-parked-at-a-table | H7 | FAIL |  |
| 15 | rebuy-limit-is-not-bypassed-by-leave-and-sit | M10 | FAIL |  |
| 17 | night-results-survive-sigkill-restart-chips | M6 | FAIL |  |
| 17 | night-results-survive-sigterm-restart-chips | M6 | pass | the SIGTERM path writes the cash-out rows with night metadata, so a chips night survives a deploy; only a crash (SIGKILL) and Play $ nights break |
| 17 | night-results-survive-sigterm-restart-play | M6 | FAIL |  |
| 17 | night-results-survive-sigkill-restart-play | M6 | FAIL |  |
| 20 | S1-three-way-split-odd-chip-goes-left-of-button | L1 | FAIL |  |
| 20 | S2-four-way-split-odd-chip-goes-left-of-button | L1 | FAIL |  |
| 20 | S3-folded-big-contributor-and-uncalled-bet | - | pass |  |
| 20 | S4-uncalled-bet-returned-to-the-loser-heads-up | - | pass |  |
| 20 | S6-foldwin-totals | - | pass |  |
| 20 | S6b-river-bet-folded | - | pass |  |
| 20 | S9-side-pot-tie | - | pass |  |
| 20 | S10-side-pot-tie-odd-chip-goes-left-of-button | L1 | FAIL |  |
| 20 | S5a-allin-disconnect-short-stack-has-best-hand | H1 | FAIL |  |
| 20 | S5b-allin-disconnect-covering-stack-has-best-hand | H1 | FAIL |  |
| 20 | S8a-kick-midhand-keeps-the-bet-in-the-pot | - | pass |  |
| 20 | S8b-standup-of-biggest-contributor-gets-uncalled-layer-back | N1 | FAIL |  |
| 20 | S8c-kick-of-biggest-contributor-gets-uncalled-layer-back | N1 | FAIL |  |
| 20 | S4-showdown-winners-exclude-the-uncalled-return | L3 | FAIL |  |
| 21 | mixed-session-money-total-constant-while-idle-and-with-hands-live | - | pass |  |
| 21 | mixed-session-sigterm-midhand-restart-conserves-money-and-empties-seats | C3, C4 | FAIL |  |
| 21 | mixed-session-sigkill-after-showdown-keeps-every-players-holdings | N3, C4 | FAIL |  |
| 21 | mixed-session-end-night-settle-ups-are-zero-sum | M6 | FAIL |  |
| 21 | mixed-session-final-total-equals-total-before-the-restarts | - | pass |  |
| 22 | show-cards-at-a-created-table-with-room-id | M9 | pass | M9 fixed on 9440541: show_cards finds the socket's seat at any table |
| 22 | show-cards-at-a-created-table-without-room-id | M9 | pass | M9 fixed on 9440541: show_cards finds the socket's seat at any table |
| 23 | sigkill-100ms-after-showdown-keeps-the-hand-result | N3 | FAIL |  |
| 23 | sigkill-300ms-after-showdown-keeps-the-hand-result | N3 | FAIL |  |
| 23 | sigkill-700ms-after-showdown-keeps-the-hand-result | N3 | FAIL |  |
| 23 | sigkill-2500ms-after-showdown-keeps-the-hand-result | N3 | pass | the 2 s stacks mirror has already run by 2.5 s; the loss window is under 2 s (same as the repro table) |
| 24 | kick-midhand-the-kicked-best-hand-does-not-take-the-pot | - | pass |  |
| 24 | kick-midhand-uncalled-part-of-the-kicked-bet-goes-back-to-him | N1 | FAIL |  |
| 25 | play-night-keeps-its-hand-after-sigterm-restart | M6 | FAIL |  |
| 25 | play-night-keeps-its-hand-after-sigkill-restart | M6 | FAIL |  |
| 26 | showdown-result-lists-only-pot-winners-not-uncalled-returns | L3 | FAIL |  |
| 26 | foldwin-listed-amount-excludes-the-winners-own-uncalled-raise | HL | FAIL |  |
| 26 | showdown-result-has-net-for-every-dealt-player-summing-to-zero-allin | HL | FAIL |  |
| 26 | showdown-result-has-net-for-every-dealt-player-summing-to-zero-foldwin | HL | FAIL |  |
| 27 | v2-buyin-out-of-range-is-a-structured-error-without-amounts-in-the-text | L7, S3-5 | FAIL |  |
| 27 | v2-rebuy-out-of-range-is-a-structured-error-without-amounts-in-the-text | S3-5 | FAIL |  |
| 27 | v2-raise-out-of-range-is-a-structured-error | L5 | FAIL |  |
| 30 | shapes-session-ran-to-the-end | - | pass |  |
| 30 | shape-social:feed | - | pass |  |
| 30 | shape-social:biggest | - | pass |  |
| 30 | shape-auth_ok | - | pass |  |
| 30 | shape-money | - | pass |  |
| 30 | shape-account:stats | - | pass |  |
| 30 | shape-achv:state | - | pass |  |
| 30 | shape-social:event | - | pass |  |
| 30 | shape-admin_overview | - | pass |  |
| 30 | shape-bank_summary | - | pass |  |
| 30 | shape-admin_result | - | pass |  |
| 30 | shape-account_changed | - | pass |  |
| 30 | shape-lobby_tables | - | pass |  |
| 30 | shape-table_info | - | pass |  |
| 30 | shape-tables_mine | - | pass |  |
| 30 | shape-wallet | - | pass |  |
| 30 | shape-bonus:status | - | pass |  |
| 30 | shape-leaderboard_data | - | pass |  |
| 30 | shape-profile | - | pass |  |
| 30 | shape-table_created | - | pass |  |
| 30 | shape-achv:unlocked | - | pass |  |
| 30 | shape-table_joined | - | pass |  |
| 30 | shape-room_update | - | pass |  |
| 30 | shape-game_state | - | pass |  |
| 30 | shape-your_cards | - | pass |  |
| 30 | shape-table_event | - | pass |  |
| 30 | shape-showdown_result | - | pass |  |
| 30 | shape-chat_message | - | pass |  |
| 30 | shape-emote | - | pass |  |
| 30 | shape-sticker_dropped | - | pass |  |
| 30 | shape-cards_shown | - | pass |  |
| 30 | shape-item_thrown | - | pass |  |
| 30 | shape-settle_up | - | pass |  |
| 30 | shape-table_left | - | pass |  |
| 30 | shape-bonus:claimed | - | pass |  |
| 30 | shape-error | - | pass |  |
| 30 | shape-g:bender:state | - | pass |  |
| 30 | shape-g:bender:result | - | pass |  |
| 30 | shape-self_changed | - | pass |  |
| 30 | shape-auth_out | - | pass |  |
| 30 | shape-bust_out | - | pass |  |
| 30 | shape-balance_update | - | pass |  |
<!-- TABLE END -->
