# The Ping v2 core: progress

Branch `v2-core` off origin/master 9440541 (live). Owner: Frank. Contracts: `V2-DESIGN.md`. Bugs from playtests: `QA-FRANK.md`.
Never push or merge `master`.

## Status

| Phase | What | State |
|---|---|---|
| 0 | Acceptance harness `tests/v2/` (repros 01-23, new N1/N3/Play $ ledger/hand-log tests, fuzz invariant, payload-shape contract), baseline run on 9440541 | started 2026-10-06 02:40 |
| 1 | `money/` ledger + `tools/migrate-v2.js` | started 2026-10-06 02:40 (parallel) |
| 2 | `engine/` pure poker + unit tests | started 2026-10-06 02:40 (parallel) |
| 3 | `tables/` + `transport/`, legacy path deleted | not started |
| 4 | Client: AmountInput, legalActions controls, UI fixes | not started |
| 5 | Playtest sweep, fix loop | not started |

## Log

- 2026-10-06 02:40 Branch cut, contracts written. `socket.io-client` added as a devDependency for the socket tests. The audit's rigged server copy (`src/` with `__rig`/`__audit`) was not shipped with the briefs, so the harness rebuilds it as a patch on a 9440541 worktree.
- 2026-10-06 02:55 Phases 1 and 2 merged into v2-core. `money/` ledger + service + migration: 71/71 unit checks. `engine/`: 92/92 (63 rule cases, evaluator differential, 20k-hand property test, old-showdown differential). Not yet wired into the server; that is phase 3.
