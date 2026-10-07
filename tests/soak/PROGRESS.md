# P6 wave 1 task B: the money soak (progress)

Worktree wt-all, branch v2-all. Ports 4740-4759. Data under `_scratch/p6/soak/`.

## Done
- [x] 1+2 runner, invariants (I1-I9 checker), model, Bender + bank actors, rig.js `walletPending` + `games` (commit 1)

- [x] 3 poker actor, 4 chaos (commit 7153cbd + 8ef8d91: the dead builder's last edits kept: chaos kinds `settle` and `spinlost`, Bot hears table_info/lobby_tables)
- [x] W3B step 1 (own runs on 166beca): `--seed 1 --steps 300 --kills 3` CLEAN (hands 11, spins 62, 20 s); `--seed 2 --steps 600 --kills 5` CLEAN (27+1 unacked hands, 130 spins, 33 s); `--seed 3 --steps 600 --kills 5` CLEAN (36+3 unacked, 130 spins, 44 s)

## In progress (wave 3b)
- [ ] 2 coldcall actor
- [ ] 3 inject.js + prove.js + README (9 old bugs + 3 slot bugs)
- [ ] 4 long clean runs, three seeds x 8 min x 12 kills

## DEFECTS FOUND
(none yet)

## Notes for the lead
- fx: the brief says `fx:chips` and `fx:play` are both 0 when no cross-funded seat is open. That is not a product rule: a cross-funded seat that wins or loses
  leaves the difference in the fx accounts (play-funded winner at a chips table: `fx:chips` +d, `fx:play` -d). V2-DESIGN.md line 60 only says the funding is 1:1.
  The check is therefore `fx:chips(chips) + fx:play(play) == 0` always (invariants.js checkConservation); the per-side values are covered by I7 (the player's holdings).
