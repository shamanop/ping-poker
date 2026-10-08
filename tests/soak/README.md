# The money soak

One server, several tables in both currencies, Ballot Bender, the slot COLD CALL, the step game CAMPAIGN TRAIL, bank moves, kills and restarts. After EVERY step the invariants below are checked from the ledger file,
the mirror files, the server's own `__audit` and the harness' own book. It exists to fail loudly when money code is wrong; `prove.js` shows that it does.

```
node tests/soak/soak.js [--seed N] [--minutes M | --steps N] [--kills N] [--port 4740] [--server-dir D] [--data D] [--bug NAME] [--kill-kinds a,b] [--players 6]
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
| `campaign` | `g:campaign:*` in both currencies at every bet level (CAMPAIGN TRAIL; `CAMPAIGN_TEST=1` and a 2.5 s idle timer `CAMPAIGN_IDLE_MS`): a run with several steps and a cash-out, a run ridden to a scandal (QA-forced), a withdrawal at 0 steps, a run left to the idle timer, a socket dropped with a run open (also for longer than the idle timer, so the run closes unheard), an unaffordable start (a player made poor through the admin), a second start while one is open (`run_open`), a double step / cash, hostile payloads, `state`, and now and then the whole 50-state LANDSLIDE route (1,000x). Every option the server shows is re-derived from the engine |
| `chaos` | the `--kills` budget, spread over the run: SIGKILL (a quarter SIGTERM) mid-hand, right after a spin was sent, right after a `showdown_result`, during a burst of buy-ins, after a hand batch with the result muted (`settle`), a Bender spin whose answer is dropped (`spinlost`), a slot decision open (`slotopen`), a Callback open or armed (`slotcb`), a slot spin whose answer is dropped (`slotlost`), a Campaign run open at 0 steps (`campopen0`) or at >= 1 step (`campopen1`), a Campaign step sent and unanswered (`campstep`), a Campaign cash-out sent and unanswered (`campcash`). Then restart on the SAME data dir, sign every bot in again, go on |

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

### CAMPAIGN TRAIL: runs open across a kill (and a dropped socket)

The model (`CampBook`) holds, per open run, the last state the client SAW (steps, multiplier, the options it was shown) and the one step it has sent and not seen answered (`pend`). A run the client was told is open must get **exactly ONE close line**,
written either just before the kill (or by the idle timer while the client's socket was down) or by boot recovery (decision D1: a restart is an automatic cash-out). Which close lines are accepted (`allowedCloses` in `actors/campaign.js`):

| the client last saw | no step in flight (or a cash in flight) | ONE step in flight, unanswered |
|---|---|---|
| 0 steps | a **refund**: a void line returning the whole stake, no spend, no credit | refund, **or** win 0 (the step was a scandal and settled), **or** stake x the multiplier of that one option (it survived and was flushed) |
| >= 1 step at m x | a settle: spend = stake, credit = stake x m / 100 | win 0 (scandal), **or** stake x m (the step was never flushed), **or** stake x the multiplier of that one option (it survived and was flushed) |

Nothing else is accepted: a settle at 0 steps with no step in flight, a credit that is any other number, two close lines, a close line for a run the client never saw open, or a run still open after the restart are violations (I9 / I7).
A start sent and unanswered at the kill may leave nothing, or an `:open` line that boot refunds (never a win). A client that was listening must hear the end of every run: a run whose close line is in the ledger and whose `end` event never reached a connected client is an I7 violation.


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
- **Campaign (inside I2 / I4 / I7)**: `_campLine` takes every `campaign:` line apart: a run writes exactly ONE `:open` line (player -> `escrow:campaign:<key>:<roundId>`) and ONE `:close` line (escrow -> `house:campaign` for the whole stake plus `house:campaign` -> player for the payout, or escrow -> player alone as a void); any other ref (a credit mid-run, a second payout under a new ref) or leg shape is an I2 violation on the spot. `checkCampaign`: every `end` the client received (stake, win, refund) is in the ledger as told; every run told open has its `:open` line, its escrow and no close line; every non-zero `escrow:campaign:*` is a run the client was told about; `audit.games.campaign.openRounds` equals the escrows and `pools` is empty; `house:campaign` equals minus what the players netted. Every runView and step answer is compared with the engine (options, odds to 4 decimals, next multiplier, cash-out amounts) and every `end` obeys the rules of its `reason`.
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
| `stuck-stake` | on every 6th Bender round booked through `ctx.money.round` (one ledger write), the wallet adapter ALSO parks a 1-unit stake through its real `spend` and the tick flush that would settle it is dropped: "some code path took the old park-then-credit road and the flush never ran" | I8 (and I6) |
| `neg-holder` | a line appended straight to `money.jsonl` behind the ledger's back takes `bank:chris` below zero | I1 / I3 |
| `stranded-escrow` | now and then a `settleRound` / `voidRound` of the slot is swallowed after `open`: the game forgets the round, the escrow stays; only a close with a stake in escrow is swallowed, a free round has none to strand | I4 (escrow with no open round) |
| `pool-skim` | the pot feed leg is dropped, or a prize is paid from `house:coldcall` instead of the pool (both sum to zero) | I4 pool (prize leg, feed rate), I2 |
| `settle-after-void` | a slot round with a win is voided (stake back) and ALSO settled under a fresh ref: the win is paid on a returned stake | I7, I2 |
| `camp-pays-scandal` | now and then a scandal (win 0) is settled as a win of the stake | I7 (told win 0), I2 `house:campaign` |
| `camp-pays-twice` | after a cash-out the same win is credited again under a new ref | I2 (the ref shape), I7 |
| `camp-cash-plus-step` | a cash-out pays 4% of the stake more than the multiplier the run reached ("one step more than survived") | I7 (told vs ledger), I2 |
| `camp-stranded-escrow` | a settle / void of Campaign is swallowed after the game dropped its record: the stake stays in escrow | I4 (escrow with no open run), I7 |
| `camp-record-kept` | the record of a closed run is not dropped now and then: the game keeps reporting a run open that the ledger closed | I4 (`audit` lists a run with no escrow) |
| `camp-recover-pays-zero` | boot recovery pays a run that sat at 0 steps (+4%) instead of refunding it. Reachable only through a kill with a run open at 0 steps: `prove.js` runs it with `--kill-kinds campopen0,...` (`ARGS` in `bugs/inject.js`) | I9 (a settle where only a refund is allowed), I7 |
| `camp-step-credit` | a surviving step credits 1 unit to the player under a ref of its own, mid-run (a step moves no money) | I2 (`campaign:<key>:<roundId>:s<n>` is not open / close) |

`node tests/soak/prove.js` prints one line per run (name, exit code, invariants that fired, step, seconds, firings, verdict) and exits 0 only if the clean soak exits 0 and every bug exits 1 naming an invariant it is expected to break.
A bug that is not caught is printed as FAILED PROOF, never hidden.

## Differences from the wave 1 brief (the code and ADD-A-GAME.md win)

- Cold Call is in; its admin switch is `POST /api/admin/coldcall-config` with `x-admin-token` (`BENDER_ADMIN_TOKEN`), not a socket event. A POST REPLACES the override set: the actor resends its own knobs with every change.
- The soak plays the slot on a live config (`SETUP_CFG` in `actors/coldcall.js`): a Callback after about two spins (`pull.list: 2`), a pot fed 1.5% and hit 1 in 30 per dollar with a 50c cap (the validator ties `capCents` to `feedBps` and `oneInPerDollar`), decisions that default after 3 s, ONE MORE CALL from a 1x bonus up.
- A QA-forced round (`force`) is a stateless paid spin: no decision, no Callback. Decisions come from buys and from natural bonuses; the Callback from the state.
- The mirror files fold open escrows into the player's row (V2-DESIGN, P6 wave 2), so I5 does too.
- `fx:chips` + `fx:play` = 0 always; each side alone is not 0 once a cross-funded seat has won or lost (see PROGRESS).
- Bugs that no longer make sense on today's code: none of the twelve was retired. `stuck-stake` changed shape twice. First (wave 2) the adapter's `schedule` and a refused credit, while a Bender stake was parked inside one handler. Since wave 3b fix A5 Bender books a round as ONE ledger write (`ctx.money.round`) and no product path calls the adapter's `spend`, so that hook never fired (0 firings = FAILED PROOF); it now hooks `service.houseRound` for a Bender round and parks a stake of its own through the adapter's real `spend`. I8 still has a proof, but the bug stands for a path the product no longer takes: if the legacy `spend`/`credit` road is deleted from the adapter, retire this bug and say that I8 has no proof.

## Campaign notes

- bb298d2 ("Chips and Play $ fully separate", the commit the Campaign branch starts from) had changed the product after the soak last ran green, so three soak pieces were stale and are adapted here (not a Campaign change): `wallet_topup` is always refused with `topup_off` and mints nothing (the bank actor checks that; the old cooldown / not_needed rule is gone); the daily bonus pays Chips (model `applyMint('bonus')` and the `mint:bonus` expectation are in chips); achievements are badges (reward 0).
- Campaign: `CAMPAIGN_IDLE_MS=2500` and `CAMPAIGN_TEST=1` are set for the server (soak.js), so a run left alone closes by the idle timer within a few seconds and QA-forced outcomes are available. A `--kill-kinds a,b,c` argument replaces the seeded choice of the chaos kinds (cycled in order).

## Not covered

Chaos on the HTTP side, tournaments, the achievements surface beyond the unlock mints, accounts other than the bot set, two servers, a full disk, a torn line in the MIDDLE of the file, clock changes, and the slot's cold clock / daily claim (the clock is real, one run is minutes), a Campaign run left open for the real 60 s idle timer (the soak shortens it to 2.5 s), two servers sharing one Campaign file.
