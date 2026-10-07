# The money soak

One server, several tables in both currencies, Ballot Bender, the slot COLD CALL, bank moves, kills and restarts. After EVERY step the invariants below are checked from the ledger file,
the mirror files, the server's own `__audit` and the harness' own book. It exists to fail loudly when money code is wrong; `prove.js` shows that it does.

```
node tests/soak/soak.js [--seed N] [--minutes M | --steps N] [--kills N] [--port 4740] [--server-dir D] [--data D] [--bug NAME] [--players 6]
node tests/soak/prove.js [--minutes 1.5] [--kills 3] [--seed 7] [--port 4742] [--only a,b] [--no-clean]
```

Exit 0 = clean. Exit 1 = a violation (invariant id, accounts, numbers, the last 15 steps, the kept data dir, the replay flags). Exit 2 = the harness itself broke (the server would not start, a bot got
no answer with no money disagreement): that is never reported as "passes". Ports 4740-4759. Data under `_scratch/p6/soak/` (never /tmp, never in the repo). One soak at a time.
`<data>/steps.jsonl` has every step, `<data>/result.json` the totals and the violations, `<data>/server.log` the server's output (and `[soak-bug]` lines).

All choices come from one seeded PRNG (`lib/prng.js`, mulberry32). The same `--seed` repeats the same PLAN; timing (timers, sockets) is real, so a run is not bit-for-bit repeatable. A violation keeps its data dir.

## What it does

| actor | what |
|---|---|
| `poker` | the permanent POKERPING table plus created chips and Play $ tables; join with random buy-ins and funds (own and cross-currency), LEGAL actions from `legalActions`, leave (also mid-hand), rebuy, host kick, sit out, drop and reconnect a socket, end the night |
| `bank` | signups mid-run, `wallet_topup` (and its refusals), `bonus:claim` twice, admin plus / minus / minus-too-big / set-play, a non-admin trying an admin event |
| `bender` | `g:bender:spin` in both currencies, every bet level, with and without buyBonus, an unaffordable spin, two spins back to back |
| `coldcall` | `g:coldcall:spin` in both currencies at every bet level: plain spins, every buy (call / bonus1 / bonus2 / hunt), QA-forced rounds (`COLDCALL_TEST=1`), a decision answered, a decision left to its 3 s timer (`ready`), a decision left open, the free Callback, the office pot won while another player's round is open (`poolrace`), a live config change while a round is open (`cfg`), a socket dropped while a round is open (`drop`), a spin the player cannot afford, back-to-back spins, a spin while a decision is open |
| `chaos` | the `--kills` budget, spread over the run: SIGKILL (a quarter SIGTERM) mid-hand, right after a spin was sent, right after a `showdown_result`, during a burst of buy-ins, after a hand batch with the result muted (`settle`), a Bender spin whose answer is dropped (`spinlost`), a slot decision open (`slotopen`), a Callback open or armed (`slotcb`), a slot spin whose answer is dropped (`slotlost`). Then restart on the SAME data dir, sign every bot in again, go on |

Actor interface: `{ name, weight, init(W)?, afterRestart(W)?, step(W) -> record | null }`. `W` is the world built in `soak.js` (rng, model, checker, bots, counters, `W.violate`, `W.warn`). A step records
what it did (it is written to `steps.jsonl`), never decides what is true, and feeds the model only through events the client received. To add a game: write `actors/<game>.js`, add it to `ACTORS` in
`soak.js`, feed the model from the game's result events (see `actors/coldcall.js listen`), add the game's ledger shape to `invariants.js` (`_slotLine` / `checkSlot` are the template) and one chaos kind per way a kill can cut it.

## The model (`model.js`)

The harness keeps its own book and never copies a number from the ledger into it, except for the "unacked" cases after a kill (or a dropped socket) below. Per player and currency:
`held = signup mint + bonus / achievement / top-up mints the server told the client about + admin deltas + Bender (totalWin - cost) + poker nets from showdown_result + Cold Call (win + pot prize - cost)`
from the results received. A seat counts toward the currency of its FUND; a stake in a Cold Call escrow is still the player's (`heldOf` adds open escrows). A void nets 0.

A kill (or a socket that went while a round was open) makes exactly these things legitimately unknown to the client; nothing else is accepted:

1. a hand whose `showdown_result` was not seen: the ref `hand:<table>:<n>` may or may not be in the ledger (at most one per table per kill); zero-sum;
2. a Bender spin sent and not answered: at most one `bender:<key>:*` batch per spin in flight, priced as asked;
3. an achievement or bonus mint cut off: at most one per (key, achievement) / (key, day), amount from the reward tables;
4. a Cold Call spin sent and not answered: the instant round batch, or its `:open` line (then boot recovery closes it), or its Callback close, at most one per spin in flight, priced as asked;
5. a Cold Call round open when the server died (the client was told "decision waiting"): exactly ONE close line, written either just before the kill or by boot recovery: a settle whose stake equals the escrow, or a void that returns it (decision D1);
6. the same for a round whose client socket was gone when it closed (disconnect settle): one close line, the stake unchanged.

And the other direction is a hard rule: **every result a client DID receive is in the ledger** (acked means durable), with the same cost, win and pot prize.

## Invariants (`invariants.js`)

The checker has its OWN reader of `money.jsonl` and shares no code with `money/`. Ledger-only violations are final; the rest get 1.5 s to clear (a message may still be in flight).

- **I1 file**: every line parses, ids strictly increase, refs unique, amounts positive safe integers, account names of a known shape, no `money.jsonl.quarantine`, the file only grows (a torn last line after SIGKILL excepted).
- **I2 conservation**: per currency all accounts sum to 0; every source account equals the model (`mint:signup|bonus|achv|topup`, `admin:adjust`, `house:bender`; `house:coldcall` + `pool:coldcall:office` = minus what the players netted); `fx:chips`(chips) + `fx:play`(play) = 0. Also: every Cold Call line is made of the legs the contract allows (spend, feed, prize, credit, open, void with the right accounts); a leg of another shape is an I2 violation even when it sums to zero.
- **I3 no negative holder**: recomputed line by line, in order.
- **I4 nothing stranded**: no `pot:*` balance; every non-zero `seat:` is a seat the server shows, equal to `chips + handBet` (`audit.drift` empty); right after a restart no seat; every non-zero `escrow:coldcall:*` is an open round the harness was told about AND the game's `audit.games.coldcall.openRounds` lists it (and the other way round); `pool:coldcall:office` equals the game's own figure; the pot is fed by the rate and only by plain paid spins (per round: `floor(cost * feedBps / 10000) <= feed <= ceil(...)`; per stretch between restarts: `floor(sum/10000) <= fed <= floor((sum+9999)/10000)`, because the game carries the sub-cent remainder); a pot prize is paid FROM the pool and equals the prize the client was told.
- **I5 mirrors**: after the ledger has been quiet, `bank.json` and `wallet.json` equal the fold (V2-DESIGN: bank + seats + orphans + open escrows) at some recent ledger line, at most 1.5 s old.
- **I6 what the client is told**: the `wallet_get` answer and the admin overview rows equal the ledger.
- **I7 the model**: every player's holdings (bank or wallet + seats by fund + open escrows) equal the model; every result the client received is in the ledger as told (Bender, poker, Cold Call); a round told open has its `:open` line and its stake in escrow; a ledger line closes a round no client was told about = violation.
- **I8 no money in memory**: `audit.walletPending` = 0.
- **I9 restart**: lines across a kill are only the kinds a cut-off operation can leave (`hand|bender|coldcall|achv|bonus|signup|buyin|...`); lines written after the process died are only `boot:*` or the slot's own recovery closes; the restarted server's balances equal the file's; every slot round open at the kill has exactly one close line.

## Seeded bugs (`bugs/inject.js`, run by `prove.js`)

Loaded with `node -r tests/soak/bugs/inject.js server.js` and `SOAK_BUG=<name>` in the SERVER process only; the module exports are wrapped before `server.js` loads them (it requires inside `start()`). No switch in product code.
Each fires rarely from its own counter (the soak has to find it) and logs `[soak-bug]` to `server.log`.

| name | what it does | must be caught by |
|---|---|---|
| `win-dropped` | `service.houseRound` drops a Bender win leg (the player was told a win the ledger never paid) | I7 (result vs ledger), I2 `house:bender` |
| `paid-twice` | after a Bender round a second credit of the same win under a new ref | I7, I2 |
| `skim` | `ledger.batch` of a hand moves 1 unit of one winner's payout to another seat (sums to zero) | I7 (showdown nets), I4 (seat drift) |
| `mirror-stale` | `service.mirror()` returns a frozen copy after 12 calls (the files stop changing) | I5 |
| `boot-skip` | `service.bootRecover` leaves every second seat | I4 after a restart |
| `ghost-mint` | every 4th `ensureAccount` also mints 500 Play $ under a `bonus:` ref nobody asked for | I2 (`mint:bonus`), I7 |
| `view-lies` | the wallet adapter's `get()` says 100 more Play $ than the ledger | I6 |
| `stuck-stake` | a Bender stake is parked, its credit refused and the tick flush dropped: the cost stays parked | I8 (and I6) |
| `neg-holder` | a line appended straight to `money.jsonl` behind the ledger's back takes `bank:chris` below zero | I1 / I3 |
| `stranded-escrow` | now and then a `settleRound` / `voidRound` of the slot is swallowed after `open`: the game forgets the round, the escrow stays | I4 (escrow with no open round) |
| `pool-skim` | the pot feed leg is dropped, or a prize is paid from `house:coldcall` instead of the pool (both sum to zero) | I4 pool (prize leg, feed rate), I2 |
| `settle-after-void` | a slot round with a win is voided (stake back) and ALSO settled under a fresh ref: the win is paid on a returned stake | I7, I2 |

`node tests/soak/prove.js` prints one line per run (name, exit code, invariants that fired, step, seconds, firings, verdict) and exits 0 only if the clean soak exits 0 and every bug exits 1 naming an invariant it is expected to break.
A bug that is not caught is printed as FAILED PROOF, never hidden.

## Differences from the wave 1 brief (the code and ADD-A-GAME.md win)

- Cold Call is in; its admin switch is `POST /api/admin/coldcall-config` with `x-admin-token` (`BENDER_ADMIN_TOKEN`), not a socket event. A POST REPLACES the override set: the actor resends its own knobs with every change.
- The soak plays the slot on a live config (`SETUP_CFG` in `actors/coldcall.js`): a Callback after about two spins (`pull.list: 2`), a pot fed 1.5% and hit 1 in 30 per dollar with a 50c cap (the validator ties `capCents` to `feedBps` and `oneInPerDollar`), decisions that default after 3 s, ONE MORE CALL from a 1x bonus up.
- A QA-forced round (`force`) is a stateless paid spin: no decision, no Callback. Decisions come from buys and from natural bonuses; the Callback from the state.
- The mirror files fold open escrows into the player's row (V2-DESIGN, P6 wave 2), so I5 does too.
- `fx:chips` + `fx:play` = 0 always; each side alone is not 0 once a cross-funded seat has won or lost (see PROGRESS).
- Bugs that no longer make sense on today's code: none of the nine was dropped; `stuck-stake` is done through the adapter's `schedule` and a refused credit because a Bender stake is now parked only inside one handler.

## Not covered

Chaos on the HTTP side, tournaments, the achievements surface beyond the unlock mints, accounts other than the bot set, two servers, a full disk, a torn line in the MIDDLE of the file, clock changes, and the slot's cold clock / daily claim (the clock is real, one run is minutes).
