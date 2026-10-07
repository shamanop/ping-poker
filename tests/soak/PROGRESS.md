# P6 wave 1 task B: the money soak (progress)

Worktree wt-all, branch v2-all. Ports 4740-4759. Data under `_scratch/p6/soak/`.

## Done
- [x] 1+2 runner, invariants (I1-I9 checker), model, Bender + bank actors, rig.js `walletPending` + `games` (commit 1)

- [x] 3 poker actor, 4 chaos (commit 7153cbd + 8ef8d91: the dead builder's last edits kept: chaos kinds `settle` and `spinlost`, Bot hears table_info/lobby_tables)
- [x] W3B step 1 (own runs on 166beca): `--seed 1 --steps 300 --kills 3` CLEAN (hands 11, spins 62, 20 s); `--seed 2 --steps 600 --kills 5` CLEAN (27+1 unacked hands, 130 spins, 33 s); `--seed 3 --steps 600 --kills 5` CLEAN (36+3 unacked, 130 spins, 44 s)

- [x] W3B step 2: `actors/coldcall.js` (commit 663b1f6 + fixes): Play $ and Chips, every bet level, plain spins, every buy, QA-forced rounds, decisions answered / left to the 3 s timer / left open across a kill, the Callback (armed, played, open across a kill), the pot won while another round is open, a live config swap with a round open, a socket dropped with a round open, spins the player cannot afford, back-to-back spins, a spin while a decision is open. Chaos kinds `slotopen`, `slotcb`, `slotlost`. Own runs, clean: `--seed 1 --steps 400`; `--seed 2 --steps 500 --kills 4`; `--seed 3 --steps 800 --kills 6`; seeds 4-6 `--steps 1000 --kills 8` (slot 94-107 rounds + 32-37 unacked, 44-51 decisions, 3-5 Callbacks, 6-13 pot wins per run).
- [x] W3B step 3: `bugs/inject.js` (12 bugs), `prove.js`, `README.md` (commit aeb04e5). Proof below.

- [x] W3B step 4: three long clean runs on HEAD 3715c95 (table below), plus 8 stress runs (`--seed 31..38 --minutes 1.5 --kills 9`, about 72 kills) clean.

## Long clean runs (own runs, one after the other, `node tests/soak/soak.js --seed N --minutes 8 --kills 12`, HEAD 3715c95; data `_scratch/p6/soak/long-sN/`, logs `_scratch/p6/w3b/soak/long-sN.log`)

| seed | steps | wall | kills | poker hands | Bender spins | slot rounds | slot rounds by kind | ledger lines | checks | violations | warnings |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 11 | 9015 | 8.05 min | 12 (4 SIGTERM) | 501 + 3 unacked (26 voided by a kill) | 1587 (+3 unacked) | 698 + 192 unacked, 1 void | plain 451, buy 170, forced 89, Callbacks 77, decisions opened 359 (answered 260, left to the timer 111), pot wins 82, socket drops 11, config swaps 53 | 4690 | 9030 | 0 | none |
| 12 | 8110 | 8.02 min | 12 (3 SIGTERM) | 470 + 3 unacked (24 voided) | 1327 (+2 unacked) | 625 + 160 unacked, 1 void | plain 407, buy 144, forced 87, Callbacks 74, decisions 316 (250 / 104), pot wins 74, drops 10, swaps 54 | 4133 | 8125 | 0 | none |
| 13 | 8235 | 8.02 min | 12 (3 SIGTERM) | 490 + 1 unacked (23 voided) | 1327 (+3 unacked) | 650 + 175 unacked, 0 voids | plain 417, buy 151, forced 82, Callbacks 82, decisions 330 (267 / 109), pot wins 60, drops 13, swaps 56 | 4198 | 8250 | 0 | none |

"unacked" = a result the client could not hear (a kill, or a dropped socket with a round open) that the ledger closed exactly once, adopted under the rules in README.md. The chaos kinds that fired over the three runs include `slotopen` (decision open across a kill), `slotcb` (Callback open, or armed, across a kill), `slotlost`, `settle`, `spinlost`.

## Harness problems found while getting the clean runs (all mine, none a product defect; each was fixed, never loosened)
1. A Callback closed while its client socket was gone (socket drop with a decision open) left `armed` set: a later plain spin was reported as "did not play the waiting Callback". Fixed: a closed Callback clears `armed` however it was heard.
2. A paid round closed unheard (kill) may have armed a Callback the harness cannot see (the ledger does not say): a later Callback was reported as "never armed". Fixed: `unsure` is set for such a key and currency, and cleared by the next plain round that did not play one.
3. A chaos kind (`slotlost`) that returned early never marked the kill: nothing across that kill was classified, so the recovery closes looked like rounds "still open". Fixed in `killAndRestart` (it marks when nothing did).
4. The poker actor judged the cash-out fund by what it asked for; a rebuy from the other fund can land after the server's answer (it waits for the hand), and the product's rule (`service.seatFund`: the most recent `buyin:<fund>` line) then differs. Fixed: the ledger decides.
5. The "bought in while broke" check read the balance, then the join ran; a slot round settling on its own timer could credit the bank in between. Fixed: judged by the balance at the buy-in line. The bank ops that compute an expectation from a balance (top-up, too-big minus, set-play) skip a player whose slot round is open.
6. The chaos kinds that MUTE a result type for the kill (`settle`, `spinlost`, `slotlost`) muted the late arrival of a result whose line was written before the kill mark: that line was then neither acked nor racing. Fixed: `W.drain()` waits for every result already in the ledger before muting. (Found by the proof's own clean run at seed 7, once in about 20 runs.)
7. Adopting an instant slot round was recorded as an escrowed one; the config step replaced the whole override set (so the pot feed went back to the default and looked like a feed defect); the mirror fold did not include open escrows (the product does, V2-DESIGN); the generic pool check read `audit.games.coldcall.pools.office` as a number (it is `{chips, play}`).

## Not covered / not observed
- The slot's `unresolvable` / `settle_error` / `timer_error` voids need an engine or ledger failure the soak cannot cause without a product hook; the only voids seen are boot-sweep voids (an escrow whose record was not flushed before the kill: 1 each in seeds 11 and 12) and the seeded `settle-after-void`.
- A decision timer firing exactly across a restart, a Callback armed by the daily appointment, the slot's cold clock (the clock is real; a run is minutes), live config changes that change `buyCost` (the soak changes `payScale` only), `pull.on` flips.
- No browser, no tournament, no second server. `tests/v2/run.js` was NOT run (the lead runs it). Nothing was pushed, merged or deployed; master was not touched.

## Proof table (own run on HEAD 3715c95, `node tests/soak/prove.js`, seed 7, 1.5 min and 3 kills per run, 2026-10-07; log `_scratch/p6/w3b/soak/proof-table.txt`)

| run | exit | invariants that fired | step | sec | firings | verdict |
|---|---|---|---|---|---|---|
| clean | 0 | - | - | 91.1 | 0 | PASS |
| win-dropped | 1 | I2, I7 | 70 | 5.4 | 1 | CAUGHT |
| paid-twice | 1 | I2, I7 | 61 | 4.9 | 1 | CAUGHT |
| skim | 1 | I7, I4 | 79 | 5.7 | 1 | CAUGHT |
| mirror-stale | 1 | I5 | 76 | 6.1 | 1 | CAUGHT |
| boot-skip | 1 | I4 | 483 | 20.9 | 4 | CAUGHT |
| ghost-mint | 1 | I2, I7 | 0 | 2.8 | 1 | CAUGHT (fires in setup, step 0) |
| view-lies | 1 | I6 | 0 | 2.5 | - | CAUGHT |
| stuck-stake | 1 | I2, I7, I8, I6 | 72 | 5.0 | 2 | CAUGHT |
| neg-holder | 1 | I3 | 107 | 7.2 | 1 | CAUGHT |
| stranded-escrow (slot) | 1 | I2, I7, I4 | 251 | 15.1 | 1 | CAUGHT (I2 first; I4 named) |
| pool-skim (slot) | 1 | I2 | 56 | 3.2 | 1 | CAUGHT (this run: the prize paid from `house:coldcall`, caught by the leg-shape check) |
| settle-after-void (slot) | 1 | I2, I7 | 103 | 8.6 | 1 | CAUGHT |

All twelve caught by an expected invariant; the clean soak passed. `pool-skim` has two variants: the earlier proof run (seed 7, before it was split) was caught by the feed-rate bound (I4: "6 plain rounds fed 15, the rate allows 30..31"), and `SOAK_BUG_MODE=feed|prize` runs one alone (seeds 21, 22 feed: I4 at steps 51, 57; seed 23 prize: I2 at step 68).
None of the nine old bugs was dropped as meaningless on today's code. `stuck-stake` changed shape: a Bender stake is now parked only inside one handler (spend then credit), so the bug parks it, refuses the credit and drops the tick flush through the adapter's `schedule` option.

## DEFECTS FOUND
None on the real code. Every violation the soak raised while I was building it was a harness problem (list above), reproduced from the kept data dir and fixed; nothing was loosened. The three long runs, eight stress runs and every clean short run on HEAD pass with 0 violations.

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
