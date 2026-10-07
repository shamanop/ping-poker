# CAMPAIGN TRAIL: design contract

Lead: Frank (session agent:main:isabelle), 2026-10-07. Source: Isabelle's build brief of 2026-10-07 (Chris approved the concept).
Branch `campaign` off master `bb298d2`. Never push or merge master. This file is the contract the three builders code against; a builder who
has to deviate writes the deviation into its own PROGRESS section and tells the lead, it does not silently change another owner's file.

## 1. The game in one paragraph

A step game on the US map. The player puts up a stake, picks a home state and starts there at 1.00x. Before every step the player picks the next
state from the unvisited states that border the current one. Each state has a risk tier. A step that survives multiplies the multiplier; a step that
fails is a SCANDAL and the stake is lost. The player may cash out after any surviving step for stake x multiplier. A state is visited once per run;
the trail stays on the map. Visiting all 50 states is a LANDSLIDE.

## 2. Math (owner: builder A). RTP is 96.00% exactly, for every route, every stop point and every bet level

Rule of the whole design: **the multiplier is an integer in hundredths (`mx`, 100 = 1.00x) and the chance of a scandal is derived from the two
integers**, never the other way round.

- Tiers and growth: SAFE x1.04, LEAN x1.10, SWING x1.30 (`g100` = 104 / 110 / 130).
- Step number `n` (1-based) from `mxPrev` into a state of growth `g100`: `mxNext = floor(mxPrev * g100 / 100)`.
- Chance of a scandal on that step: `pFail = 1 - R(n) * mxPrev / mxNext`, with `R(1) = 0.96` and `R(n) = 1` for `n >= 2`.
  The house edge is taken ONCE, as worse odds on the first step. Every later step is exactly fair.
- So after `k` surviving steps `P(survive) * mx_k = 0.96 * 100` whatever the route (the product telescopes). A cash-out pays `bet * mx / 100`.
  Bet levels are multiples of 100 units, so that is a whole number of cents or chips with no rounding. RTP = 96.00% by algebra, not by tuning.
  The sim confirms it; the unit tests prove the identity on enumerated and random routes with exact rational arithmetic (BigInt), no floats.
- Nominal odds (they move slightly with the floor; the server sends the real number for every option):

  | tier | growth | first step | later steps |
  |---|---|---|---|
  | SAFE | x1.04 | 7.7% (1 in 13) | 3.8% (1 in 26) |
  | LEAN | x1.10 | 12.7% (1 in 7) | 9.1% (1 in 11) |
  | SWING | x1.30 | 26.2% (1 in 3) | 23.1% (1 in 4) |

- No revisits. Options = the unvisited neighbours of the current state (1 to 8 on the real map, not capped at 4).
- Dead end: a surviving step into a state with no unvisited neighbour ends the run with an automatic cash-out at the new multiplier (`deadend`).
  The option is marked `deadEnd: true` before the player picks it.
- LANDSLIDE: step 49 (the 50th state) pays a fixed `LANDSLIDE_MX = 100000` (1,000.00x). Its odds are derived the same way:
  `pFail = 1 - mx48 / 100000` (about 1 chance in 12 to 18 of winning). Still exactly fair, so the RTP identity holds. The run ends there.
- Hard cap `CAP_MX = 1000000` (10,000x, as Cold Call). The engine asserts `mx <= CAP_MX` on every step. By construction the largest payable
  multiplier is the LANDSLIDE's 1,000x; the largest multiplier before it is under 100x (prove the bound in a test: max over tiers of the full product).
- Bet levels (both currencies): `[100, 200, 500, 1000, 2500]` units (1 unit = 1 Play cent = 1 chip).
  **Exposure: 2,500 x 1,000 = 2,500,000 chips, or $25,000 Play $, on one run** (LANDSLIDE); without a LANDSLIDE under 100x = under $2,500. State this in the report.
- Map data (`games/campaign-map.js`): 50 states, no DC. `{ states: { OH: { name, tier, party, adj: [...] } }, ... }`.
  - Borders: the standard land-border list of the 48 contiguous states (Four Corners diagonals do NOT count; water-only borders do not count).
    Air links so the two outliers are playable and a LANDSLIDE is possible: `AK-WA`, `AK-HI`, `HI-CA` (flag `air: true` on those edges for the client).
  - Tiers. SWING: PA GA AZ WI MI NV NC. LEAN (18): NH MN NJ VA NM ME CO NY IL OR DE CT RI FL TX OH IA AK. SAFE: the other 25.
  - `party`: `'R'`, `'D'` (2024 presidential result) or `'S'` for the seven swing states. Colour only, no rule reads it.
  - Tests: adjacency symmetric, connected, no self-links, every code valid, edge count written down; a stored witness route that visits all 50
    states (found by search, kept in the test) proves a LANDSLIDE is reachable. Maine has one neighbour, so it is an end of any such route.

### Engine API (`games/campaign-engine.js`: pure, no I/O, no `Math.random`, never mutates its input)

```
E.VERSION, E.RTP_BPS = 9600, E.LANDSLIDE_MX = 100000, E.CAP_MX = 1000000, E.MAX_STEPS = 49
E.BET_LEVELS = [100, 200, 500, 1000, 2500], E.TIERS = { safe: { g100: 104 }, lean: { g100: 110 }, swing: { g100: 130 } }, E.MAP
E.newRun(home)            -> run = { v, home, at, trail: [home], steps: 0, mx: 100, done: null }   plain JSON; throws EngineError('bad_home')
E.options(run)            -> [{ to, tier, g100, nextMx, pFail, deadEnd, landslide }]   unvisited neighbours of run.at in MAP order; [] when done or none
E.step(run, to, rng)      -> { ok, run, opt }   draws EXACTLY ONE rng() (uniform in [0,1)); scandal when rng() < opt.pFail.
                             ok false: run.done = 'scandal' (at, trail and mx unchanged, `failedAt: to`). ok true: run advanced; run.done = 'landslide' at
                             steps 49, else 'deadend' when it has no options left, else null. Throws EngineError('bad_step') when `to` is not an option or the run is done.
E.payout(run, bet)        -> whole units: bet * mx / 100 when steps >= 1 and done !== 'scandal'; 0 on a scandal; throws on steps === 0 (that is a refund, not a win)
E.check(run)              -> true, or throws EngineError('bad_run'): re-derives at / steps / mx from home + trail (a stored record is never trusted as it stands)
E.pFail(mxPrev, mxNext, n) -> number
```

`rng() = 0` always fails a step and `rng() = 0.999999` always survives: that is how the server's QA hook forces an outcome, the engine has no force code.

Sim (`games/campaign-sim.js`): 1,000,000 runs per strategy, seeded, printing RTP with its 95% interval, share of runs that end in a scandal,
average and largest multiplier, steps per run: always-safe, always-swing, mixed (uniform random option), each at cash-out targets of 1.5x, 2x, 5x, 20x and "never
cash out"; plus first-step-and-out per tier; plus a LANDSLIDE hunter on the witness route. Every line must sit inside its interval around 96.00%.

## 3. Server (owner: builder B). `games/campaign.js`, `games/campaign-store.js`

Follows `ADD-A-GAME.md` to the letter; Cold Call (`games/coldcall.js`) is the pattern for `open` / `settle` / `void` / `recover` / `audit`.
No pool, no entitlements, no free rounds, no rewards: **the only money that ever moves is the stake and the payout.**

- One open run per ACCOUNT (not per currency). A run is in the one currency it was started in.
- `roundId`: made by the server, no `:`, stored in the run's record before `money.open` is called... no: ledger first. Order at start:
  validate -> `money.open(key, cur, roundId, bet)` -> record `{ roundId, key, cur, bet, run, startedAt, lastAt }` into the store, flush -> emit.
  (A crash between the two leaves an escrow with no record: `recover` voids it. That refund is correct: no step was taken.)
- Step: validate (`roundId` is the account's open run, `n === run.steps + 1`, `to` is an option) -> `E.step` with `ctx.rng`:
  - scandal: `money.settle(key, cur, roundId, { win: 0, stake: bet })` -> drop the record, flush -> emit `end`.
  - survived, run goes on: update the record, FLUSH, then emit. No ledger line (nothing moved). A crash before the flush = the step never happened.
  - survived and the run is done (`landslide` / `deadend`): `money.settle(..., { win: E.payout(run, bet), stake: bet })` -> drop, flush -> emit `end`.
- Cash-out: `steps >= 1`: `settle` with `win = E.payout`; `steps === 0`: `money.void(..., 'withdrawn')` (full refund, nothing was risked).
- Idle: 60 s (`E.IDLE_MS`, env `CAMPAIGN_IDLE_MS` only with the test hook) after the start or the last accepted pick with no new pick = the same
  as a cash-out (`reason: 'timeout'`). A disconnect changes nothing: the timer runs on, a reconnect gets the run back through `state`.
- Boot `recover(rounds)`: every stored record whose escrow is non-zero is cashed out at its stored multiplier (`steps === 0`: voided). This is
  the Cold Call D1 answer: **a restart is an automatic cash-out at the current multiplier.** A record with no escrow is stale: drop it, pay
  nothing. An escrow with no record: void it. `E.check` every record first; a record that fails the check is voided, never paid.
- `audit()` -> `{ openRounds: [{ key, cur, roundId, amount }], pools: {} }` from the game's own records.
- `settle` and `void` answering `dup` / `round_closed` mean "already played": drop the record, pay nothing, tell the client the run is over.
  Any other money error: emit an error, never a result, keep the record, the timer tries again (as Cold Call's `moneyFailed`).
- Every event is rate-limited per account (150 ms) and every field validated against fixed lists. The client never sends an amount, a
  multiplier, odds or an outcome.
- Registry: `'./campaign.js'` in `games/index.js` MODULES, `'campaign'` in `GAMES` (`money/service.js`), `'house:campaign'` in `SOURCE_ACCOUNTS`
  (`money/ledger.js`). Nothing else in `money/`. The store file sits beside Cold Call's (`CAMPAIGN_FILE`, default next to the wallet file).
- QA hook, only when `CAMPAIGN_TEST=1` and `NODE_ENV !== 'production'`: a `step` payload may carry `force: 'survive' | 'scandal'` (the server
  passes a fixed rng to `E.step`; the normal money path runs). Ignored otherwise; a test proves it is ignored.

### Socket events (prefix `g:campaign:`; errors are `error { game: 'campaign', code, message }`)

| client sends | payload | server answers |
|---|---|---|
| `state` | `{}` | `state { betLevels, modes: ['play','chips'], rtp: '96.0%', maxWinX: 1000, capX: 10000, idleMs, map, balances, run: runView or null }` |
| `start` | `{ mode, bet, home }` | `run { run: runView, balances }` |
| `step` | `{ roundId, n, to }` | survived: `step { roundId, n, to, tier, run: runView }`; else `end {...}` |
| `cash` | `{ roundId }` | `end {...}` |

- `runView = { roundId, mode, bet, home, at, trail, steps, mx, cashout, canCash, options: [{ to, name, tier, g100, nextMx, nextCashout, pFail, deadEnd, landslide }], idleMs, expiresAt }`.
  `cashout` and `nextCashout` are whole units computed by the server. `pFail` is rounded to 4 decimals.
- `end = { roundId, reason, mode, bet, mx, win, at, failedAt, trail, steps, balances }`, `reason` one of
  `scandal | cashout | withdrawn | timeout | deadend | landslide | boot`. An `end` goes to every socket of the account.
- Error codes: `auth`, `rate`, `bad_mode`, `bad_bet`, `bad_home`, `funds`, `run_open` (a run is already open: the answer carries its `runView`),
  `no_run`, `bad_step` (wrong `n` or `to`; a double click lands here or on `rate` and moves nothing), `internal`.
- `map` in `state` = `E.MAP` plus the tier table, so the client holds no copy of the rules.

## 4. Client (owner: builder C). `public/games/campaign/`, bridge in `public/shell.js`, lobby tile

- Loaded like Cold Call: an iframe (`/games/campaign/index.html?bridge=1`) with a postMessage bridge in `shell.js`, `Shell.registerGame`, a lobby tile.
- House style: smoky card room, gold `#F5B942`, the fonts and chrome of the lobby and Cold Call. Not a template: one signature idea, the
  election-night map. States tinted deep red / deep blue (SAFE), lighter red / blue (LEAN), gold-violet (SWING); visited states stamped; the
  trail drawn as a gold route line that stays; a scandal flashes the state and tears the route.
- Layout, top to bottom: header (multiplier, stake, currency), the map (auto-zooms to the current state and its options, animated), one news
  ticker line per step ("Rally in Ohio +10%", "SCANDAL in Georgia"), the pick cards, the big gold CASH OUT button with the live amount from
  `runView.cashout`, a 60 s idle ring.
- Pick cards are the primary tap target (small states cannot be tapped on a phone map): state name, tier chip, growth ("+10%" and the next
  multiplier), the odds in plain words, `deadEnd` / LANDSLIDE marks. Tapping a highlighted state on the map does the same.
- Odds in words, from `pFail` only: `pFail <= 0.5`: "1 in N scandal" with `N = floor(1 / pFail)` (never shown better than it is); `pFail > 0.5`
  (the LANDSLIDE step): "1 in N to win" with `N = ceil(1 / (1 - pFail))`. First step: a line that says the first step is the risky one.
- Before a run: home-state picker (map tap or list), bet level, currency (Play $ / Chips, the shell's mode), START.
- Sizes that must work: docked 360x740, 540x960, 1440x900. No overlap, no clipping, nothing off-screen, tap targets >= 44 px.
- Money on screen comes only from `balances`, `runView` and `end`. No client arithmetic on money, no client RNG for outcomes.
- Map geometry: a free premade SVG of the US states (public domain / CC0 / MIT), licence written in `public/games/campaign/SOURCES.md`. No CDN, no network at run time.
- `window.__campaign` QA surface for drivers: `{ ready, run, busy, lastEnd, events: [] }`, and stable `data-` attributes on the cards and the buttons.
- Sound and a juice layer are optional in v1. A double tap must send one step (disable on send, re-enable on the answer).

## 5. Tests and done (lead owns the merge and the final runs)

1. `tests/campaign-engine.js` (A), `tests/campaign.js` + `tests/campaign-money.js` (B, in the style of `tests/coldcall*.js`, on the real ledger through `tests/lib-coldcall-ledger.js`'s pattern).
   Money test, Play $ and Chips, every bet level: balance before - stake + win = balance after on every run; the amount in `end` = the amount credited;
   fast double `step` / `cash` / `start` = one effect; integer units only; bad amounts refused; a run never touches the other currency; nothing is credited mid-run.
2. Soak: actor `tests/soak/actors/campaign.js`, the game's ledger shape in `invariants.js`, chaos kinds (kill with a run open at 0 steps, at >= 1 step, right after a `step` was
   sent, right after a `cash` was sent), seeded bugs in `prove.js` (pays a scandal, pays twice, cash-out at the wrong multiplier, escrow left behind, record kept after close).
   `prove.js` passes: clean soak finds nothing, every seeded bug is caught. Kills mid-run, 0 money errors.
3. Sim report (A) in `CAMPAIGN-MATH.md`.
4. Browser legs (after the merge): 33 rounds at 540x960 Play $ and at docked 360x740 Chips, real clicks through the shell, 0 fails, small JPEG shots; screen = wallet = ledger at the end.
5. Everything that passed on `bb298d2` still passes: `tests/v2/run.js`, `tests/v2-unit/run-money.js`, `run-tables.js`, `run-engine.js`, `tests/coldcall*.js`, `tests/bender*.js`.
6. Rollback: say what a rollback to master `bb298d2` does after one Campaign run (master does not know `house:campaign`); measure it, do not guess.
7. Hand-off: top section of `PROGRESS-CAMPAIGN.md` + a commit message containing "HAND-OFF READY for Isabelle".

## 6. File owners

| owner | branch / worktree | files |
|---|---|---|
| A engine | `campaign-engine` / `wt-camp-engine` | `games/campaign-engine.js`, `games/campaign-map.js`, `games/campaign-sim.js`, `tests/campaign-engine.js`, `CAMPAIGN-MATH.md` |
| B server | `campaign-server` / `wt-camp-server` | `games/campaign.js`, `games/campaign-store.js`, the three registry lines, `server.js` (file path only), `tests/campaign.js`, `tests/campaign-money.js`, `tests/soak/**` |
| C client | `campaign-client` / `wt-camp-client` | `public/games/campaign/**`, `public/shell.js`, `public/lobby.js` and its CSS |
| lead | `campaign` / `wt-campaign` | this file, `PROGRESS-CAMPAIGN.md`, merges, `qa/campaign/**` |

## 7. Deviations from Isabelle's brief (for the hand-off)

1. Odds are derived from round multipliers (x1.04 / x1.10 / x1.30 kept exactly), not multipliers from round odds: later steps are 3.8% / 9.1% / 23.1%, and the
   whole 4% edge sits in the first step's odds. That is what makes the RTP 96.00% on every route and stop point.
2. Options are all unvisited bordering states (1 to 8), not 2 to 4; a state is visited once; a dead end cashes out.
3. LANDSLIDE pays 1,000x, not the 10,000x cap, as a last fair gamble; the cap stays as a guard. It is one constant if Chris wants it bigger.
4. Bets start at 100 units ($1.00 / 100 chips) so every payout is exact.
5. One open run per account. A cash-out before the first step is a refund.
6. Alaska and Hawaii are joined by air links (WA-AK, AK-HI, HI-CA).
