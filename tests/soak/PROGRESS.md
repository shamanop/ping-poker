# P6 wave 1 task B: the money soak (progress)

Worktree wt-all, branch v2-all. Ports 4740-4759. Data under `_scratch/p6/soak/`.

## Done
- [x] 1+2 runner, invariants (I1-I9 checker), model, Bender + bank actors, rig.js `walletPending` + `games` (commit 1)

## In progress
- [ ] 3 poker actor
- [ ] 4 chaos (kills, restarts, unacked rules)
- [ ] 5 inject.js + prove.js + proof table
- [ ] 6 long clean runs, three seeds

## DEFECTS FOUND
(none yet)

## Notes for the lead
- fx: the brief says `fx:chips` and `fx:play` are both 0 when no cross-funded seat is open. That is not a product rule: a cross-funded seat that wins or loses
  leaves the difference in the fx accounts (play-funded winner at a chips table: `fx:chips` +d, `fx:play` -d). V2-DESIGN.md line 60 only says the funding is 1:1.
  The check is therefore `fx:chips(chips) + fx:play(play) == 0` always (invariants.js checkConservation); the per-side values are covered by I7 (the player's holdings).
