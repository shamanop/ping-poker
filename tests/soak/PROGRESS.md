# P6 wave 1 task B: the money soak (progress)

Worktree wt-all, branch v2-all. Ports 4740-4759. Data under `_scratch/p6/soak/`.

## Done
- [x] 1+2 runner, invariants (I1-I9 checker), model, Bender + bank actors, rig.js `walletPending` + `games` (commit 1)

- [x] 3 poker actor, 4 chaos (commit 7153cbd + 8ef8d91: the dead builder's last edits kept: chaos kinds `settle` and `spinlost`, Bot hears table_info/lobby_tables)
- [x] W3B step 1 (own runs on 166beca): `--seed 1 --steps 300 --kills 3` CLEAN (hands 11, spins 62, 20 s); `--seed 2 --steps 600 --kills 5` CLEAN (27+1 unacked hands, 130 spins, 33 s); `--seed 3 --steps 600 --kills 5` CLEAN (36+3 unacked, 130 spins, 44 s)

- [x] W3B step 2: `actors/coldcall.js` (commit 663b1f6 + fixes): Play $ and Chips, every bet level, plain spins, every buy, QA-forced rounds, decisions answered / left to the 3 s timer / left open across a kill, the Callback (armed, played, open across a kill), the pot won while another round is open, a live config swap with a round open, a socket dropped with a round open, spins the player cannot afford, back-to-back spins, a spin while a decision is open. Chaos kinds `slotopen`, `slotcb`, `slotlost`. Own runs, clean: `--seed 1 --steps 400`; `--seed 2 --steps 500 --kills 4`; `--seed 3 --steps 800 --kills 6`; seeds 4-6 `--steps 1000 --kills 8` (slot 94-107 rounds + 32-37 unacked, 44-51 decisions, 3-5 Callbacks, 6-13 pot wins per run).
- [x] W3B step 3: `bugs/inject.js` (12 bugs), `prove.js`, `README.md` (commit aeb04e5). Proof below.

## In progress (wave 3b)
- [ ] 4 long clean runs, three seeds x 8 min x 12 kills

## Proof table (own run, `node tests/soak/prove.js`, seed 7, 1.5 min, 3 kills per run, 2026-10-06; log `_scratch/p6/w3b/soak/proof-table.txt`)

| run | exit | invariants that fired | step | sec | firings | verdict |
|---|---|---|---|---|---|---|
| clean | 0 | - | - | 91.4 | 0 | PASS |
| win-dropped | 1 | I2, I7 | 87 | 6.5 | 1 | CAUGHT |
| paid-twice | 1 | I2, I7 | 127 | 9.3 | 1 | CAUGHT |
| skim | 1 | I7, I4 | 79 | 5.6 | 1 | CAUGHT |
| mirror-stale | 1 | I5 | 86 | 6.1 | 1 | CAUGHT |
| boot-skip | 1 | I4 | 337 | 21.3 | 2 | CAUGHT |
| ghost-mint | 1 | I2, I7 | 0 | 2.7 | 1 | CAUGHT (fires in setup, step 0) |
| view-lies | 1 | I6 | 0 | 2.7 | - | CAUGHT |
| stuck-stake | 1 | I2, I7, I8, I6 | 72 | 5.3 | 2 | CAUGHT |
| neg-holder | 1 | I3 | 97 | 7.2 | 1 | CAUGHT |
| stranded-escrow (slot) | 1 | I2, I7, I4 | 236 | 14.2 | 1 | CAUGHT (I2 first, I4 named) |
| pool-skim (slot) | 1 | I4 | 48 | 3.2 | 1 | CAUGHT (feed-rate bound; the first firing was the dropped feed leg) |
| settle-after-void (slot) | 1 | I2, I7 | 198 | 10.4 | 1 | CAUGHT |

All twelve caught by an expected invariant. Every one of the nine old bugs still makes sense on today's code (none dropped). `stuck-stake` had to change shape: a Bender stake is now parked only inside one handler (spend then credit),
so the bug parks it, refuses the credit and drops the tick flush through the adapter's `schedule` option.

## DEFECTS FOUND
(none so far on the real code; see the clean-run section and the list at the end)

## Differences from the old brief that I met (the code and ADD-A-GAME.md won)
- The slot's admin switch is `POST /api/admin/coldcall-config` (`x-admin-token` = `BENDER_ADMIN_TOKEN`), not a socket event; a POST REPLACES the override set (the first version of the config step reset the pot feed to the default and looked like a pot defect: it was the harness).
- `pull.pot` is validated: `capCents x 3 <= oneInPerDollar x 5` and `capCents >= feedBps x oneInPerDollar / 100`, so a hit is at most a few tens of cents; the soak plays feedBps 150, 1 in 30 per dollar, cap 50c.
- A QA-forced round goes through the legacy stateless path: no decision, no Callback. Decisions come from buys and from natural bonuses, Callbacks from `pull.list: 2` in the live config.
- The mirror files fold open escrows into the player's row (V2-DESIGN P6 wave 2 list); I5 does the same. Product matched; my first fold did not.
- The old rule "after a restart the lines are boot lines only" now also allows the slot's own recovery closes (`coldcall:<key>:<round>:close`, decision D1), told apart by the dead mark (the file length when the old process was gone).
- `audit.games.coldcall.pools.office` is `{chips, play}`, not a number: the generic pool check was fixed to read the currency.

## Notes for the lead
- fx: the brief says `fx:chips` and `fx:play` are both 0 when no cross-funded seat is open. That is not a product rule: a cross-funded seat that wins or loses
  leaves the difference in the fx accounts (play-funded winner at a chips table: `fx:chips` +d, `fx:play` -d). V2-DESIGN.md line 60 only says the funding is 1:1.
  The check is therefore `fx:chips(chips) + fx:play(play) == 0` always (invariants.js checkConservation); the per-side values are covered by I7 (the player's holdings).
