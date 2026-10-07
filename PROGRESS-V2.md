# The Ping v2 core: progress

Branch `v2-core` off origin/master 9440541 (live). Owner: Frank. Contracts: `V2-DESIGN.md`. Bugs from playtests: `QA-FRANK.md`.
Never push or merge `master`.

## 2026-10-06 21:50, branch `v2-all`: P6 wave 2, the slot on the one money system (head of the code: b55e7cb)

`v2-all` = `v2-core` + the money soak (wave 1, unfinished) + P6 wave 2. NOT merged anywhere, NOT deployed. Hand-off between lead sessions: `P6-STATE.md` (outside the repo); the builder's report: `P6-W2C-REPORT.md`.

**What changed**
- W2-a (2f2688e, f35b95b, b414f03): the money primitives. Ledger accounts `escrow:<game>:<key>:<roundId>` and `pool:<game>:<name>`; `openRound` / `settleRound` / `voidRound`, pool legs; `ctx.money` (`transport/game-money.js`) is the only way a game touches money; the games registry runs `recover()` and an escrow sweep at boot, before the server listens. Contract: `ADD-A-GAME.md`.
- W2-b (2deee54, d60274c): fixes after an Opus money critic (report `_scratch/p6/w2b/CRITIC-REPORT.md`, outside the repo): only Bender keeps the old `ctx.wallet`; a replayed round answers `round_closed`; strict outcome arguments and `stake`; a pool is fed at most the stake.
- W2-c / W2-d (fed1a7c .. b55e7cb): COLD CALL (`coldcall-pull`, FIX M1 included) merged and moved onto `ctx.money`. One ledger call per movement, ledger first. Open round = escrow; office pot = `pool:coldcall:office` per currency, fed and paid inside the round's own batch, only on a plain paid spin (never a buy, never a Callback). A restart settles an open round exactly as its timeout would. A Callback's round id sits on the entitlement and its roll is on disk before any money moves. Slot tests moved onto a real ledger (`tests/lib-coldcall-ledger.js`), new `tests/coldcall-money.js`. The engine files are byte-identical to `coldcall-pull` 4713970.

**Run by the lead on a clean export of b55e7cb** (not the builder's numbers)
- `tests/v2-unit/run-money.js` 120/120, `run-tables.js` 151/151, `run-engine.js` 96 passed (seed 1).
- `tests/v2/run.js --jobs 1`: 156 of 156, 0 fail (481 s).
- `node tests/coldcall.js` exit 0: coldcall 47, pull-engine 57, pull-server 61, livecfg 28, presets 20, coldcall-money 18. `tests/bender.js` 19, `tests/bender-livecfg.js` 5.
- Engine: `git diff --stat 4713970 b55e7cb -- games/coldcall-engine.js public/games/coldcall/engine.js` empty; `cmp` of the two files silent.
- A real boot on an empty data dir logs `game recovery: bender 0 open/0 by game/0 kept, coldcall 0 open/0 by game/0 kept, 0 escrows voided`.
- The builder's numbers only (not re-run by the lead): four hand mutations (pot rule, recover on an empty tape, snapshot feed and roll, snapshot memo key), each reported as caught by a test.

**Open**
- The soak (`tests/soak/`) is NOT finished: poker actor, chaos (kills and restarts), inject / prove and the long runs are open; its builder session failed and left uncommitted edits in the worktree. There is no Cold Call soak actor yet. `ADD-A-GAME.md` section 8 makes that the gate before a game ships.
- No Opus money critic has read the slot port yet (W2-g). Points handed to it are listed in `P6-STATE.md`.
- No browser check of the slot on v2 (the client is unchanged; it can now receive error code `round_closed`).
- Small: a live `stake_mismatch` retries on every timeout (boot voids it); `g:coldcall:voided` names a refund for an instant round that was never charged.
- Ride-along fixes A2, A3, A4, A5 of `P6-MONEY-AUDIT.md` (Bender emits a result when the ledger write failed; admin adjust is not idempotent on a resend).
- Not merged: `coldcall-w3`, `coldcall-fb1`, `preview`. Ledger checkpoints (D2) are their own wave, needed before live.

**Open on purpose (written limits)**
- D3: leads, the Callback and its remainder are game state, not ledger balances. A crash can cost the entitlements granted by the one round in flight, never a balance. A corrupt slot file loses leads and Callbacks, never money.
- F2.4: a free round whose whole outcome is 0 writes no ledger line. The slot closes this itself for the Callback (record first, id on the entitlement); a second game with free rounds must do the same.
- A resent `spin` message is a new round (150 ms rate limit and the open-decision guard, as before).
- The last decision of a round is not on disk before the money call: a crash at that instant settles the default at boot, as a timeout would. It cannot pay twice.

**Needs Chris**
- D1 (told to Chris 2026-10-06, "unless you object"): a restart with a bonus decision open now SETTLES the round and pays the win on screen, where the old slot refunded the stake only.
- Nothing here is live. `master` is untouched; a live push is his call.

## Status

| Phase | What | State |
|---|---|---|
| 0 | Acceptance harness `tests/v2/` (repros 01-23, new N1/N3/Play $ ledger/hand-log tests, fuzz invariant, payload-shape contract), baseline run on 9440541 | done: 150 checks, 150 pass on v2-core 95ad5e7 |
| 1 | `money/` ledger + `tools/migrate-v2.js` | merged, 90/90 |
| 2 | `engine/` pure poker + unit tests | merged, 96/96 |
| 3 | `tables/` + `transport/`, legacy path deleted | merged 2026-10-06 07:07 (30adcba) |
| 4 | Client: AmountInput, legalActions controls, UI fixes | merged 2026-10-06 05:50 (edc52cd) |
| 5 | Playtest sweep, fix loop | done 2026-10-06 09:56: 8 defects (Q01-Q08, none S1), all fixed; see `QA-FRANK.md` |

## Log

- 2026-10-06 02:40 Branch cut, contracts written. `socket.io-client` added as a devDependency for the socket tests. The audit's rigged server copy (`src/` with `__rig`/`__audit`) was not shipped with the briefs, so the harness rebuilds it as a patch on a 9440541 worktree.
- 2026-10-06 02:55 Phases 1 and 2 merged into v2-core. `money/` ledger + service + migration: 71/71 unit checks. `engine/`: 92/92 (63 rule cases, evaluator differential, 20k-hand property test, old-showdown differential). Not yet wired into the server; that is phase 3.
- 2026-10-06 05:50 Phase 4 merged. Client: AmountInput rewrite, legalActions controls, admin console, bust panel, showdown UI. Unit 90/90 money, 96/96 engine. Client e2e proofs (A-I) done on legacy server; raise box (F) re-run against a v2-tables export.
- 2026-10-06 07:07 Phase 3 merged. `tables/` + `transport/` wired to v2 money + engine, legacy `tables.js` deleted. Unit suites: tables 127/127. SIGTERM/SIGKILL/reconnect/cashout/short-all-in. E1 engine fix (kicked top-bettor alloc) verified seeds 1/7/11. Harness bot fix (check 21 illegal raises) committed f347b20. Full 147-check harness pending (in-flight at this log entry).
- 2026-10-06 09:56 Phase 5 done on 95ad5e7. Sweep found Q01-Q08 (6 S2, 2 S3, no money or stuck-table defect); Q01, Q03-Q08 fixed in wave 1, Q02 (phone layout at 390x844) in wave 2. Full harness 150/150 in 495 s run alone (`tests/v2/results/fixc.json`, not committed); unit: money 90, engine 96, tables 128, amountfield 66, money.test 6538, 0 fails. Not checked: real iOS/Android, landscape phones, 3+ players on a phone, the s10_misc browser half (script stalls), radio/recap/Cold Call (not on this branch). Open for Chris: `/api/bank-summary?password=` is an open read behind the room password; a disconnected seat is cashed out after 2 minutes, between hands only. master untouched at 9440541.
