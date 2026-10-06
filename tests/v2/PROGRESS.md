# tests/v2 progress (builder P0)

Run (after `bash tests/v2/baseline/setup.sh`): `node tests/v2/run.js --baseline` (run.js not written yet), single file: `node tests/v2/NN_name.js --target <dir>`.
Baseline server = worktree `../baseline-9440541` (9440541 + `baseline/rig.patch`: only the RIG=1 hooks `__rig`, `__audit`).

## Done so far
- lib.js, baseline rig, 01, 02, 03, 04, 20 (all checks run on the baseline, see table when finished).

## Notes for phase 3 / other builders
- Tests judge rejection from `game_state` only (bet and actor unchanged), so the error event name is free.
- Scenario tests align the button (`dealAligned`): they fold burner hands until the button is on seat 0, so v2 may choose any first-hand button. They assume the button advances one seat per hand.
- Every scenario seats players with buy-in = min(stacks) and blinds <= stack/10 so tables stay valid under stricter v2 validation (M7).
- Pot totals count chips at the table + bank delta. A seat that leaves or is kicked mid-hand must have its returned/won money end up in its owner's bank.
