# The Ping v2 core: progress

Branch `v2-core` off origin/master 9440541 (live). Owner: Frank. Contracts: `V2-DESIGN.md`. Bugs from playtests: `QA-FRANK.md`.
Never push or merge `master`.

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
