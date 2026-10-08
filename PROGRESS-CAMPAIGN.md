# PROGRESS-CAMPAIGN: Campaign Trail hand-off (Frank, 2026-10-08 01:15 CDT)

**Status: HAND-OFF READY for Isabelle.** Branch `campaign`, 37 commits on master `bb298d2`. Master is untouched; nothing was merged into it. Isabelle reviews and pushes after Chris says go.

## What it is
A solo game in the shell dock (lobby tile + `Shell.registerGame('campaign')`). Pick a home state, stake 100/200/500/1,000/2,500 (Play $ cents or Chips), then walk the 50-state map one bordering unvisited state at a time. Each step raises the multiplier (SAFE x1.04, LEAN x1.10, SWING x1.30) and carries a scandal chance; cash out any time. Dead end = auto cash-out. State 50 is a LANDSLIDE at 1,000x. Contract: `CAMPAIGN-DESIGN.md`. Maths and the derivation: `CAMPAIGN-MATH.md`. Server: `games/campaign.js`, `games/campaign-store.js`. Engine: `games/campaign-engine.js` (pure). Client: `public/games/campaign/`.

## Real RTP
96.00% exact on every route and every stop point: P(survive k steps) x mx_k = 96 (BigInt rationals tested at 313,000+ prefixes). 36M-run simulator lines are 95.7 to 96.15%, all inside their 95% intervals except `mixed @ 2x` (95.79, 0.01 outside; 12 more seeds average 95.97, so chance) and, on a second seed, the LANDSLIDE hunter (binomial count). The 4% edge sits entirely in step 1.

| strategy (1M runs) | RTP % | scandal % |
|---|---|---|
| first step and out, safe / lean / swing | 96.02 / 96.01 / 95.93 | 8.4 / 12.3 / 19.5 |
| always-safe @ 2x / never | 95.97 / 95.81 | 49.7 / 64.7 |
| always-swing @ 2x / never | 95.96 / 95.88 | 52.9 / 78.4 |
| mixed @ 5x | 96.15 | 66.4 |
| LANDSLIDE hunter (never cash) | 92.60 (wide interval) | 99.9; 926 landslides vs 960 expected |

**Exposure:** LANDSLIDE = 2,500 x 1,000 = 2,500,000 chips / $25,000 Play $ on one run, probability 0.096% from the start (1 in 1,042). Without a landslide the best seen is 83.64x ($2,091 at 2,500). One constant (`LANDSLIDE_MX`) if Chris wants it smaller or bigger.

## Behaviour you should know
- **D1:** a server restart with an open run is an automatic cash-out at the current multiplier (same answer as Cold Call). A run with no escrow is stale and is dropped.
- **Idle:** 60 s with no pick = cash-out.
- **Rollback:** master `bb298d2` does not know `house:campaign`. Measured in `_scratch/campaign/server/rb/`: the ledger quarantines unknown-source lines. Fix is one line on master before go-live: add `'house:campaign'` to `SOURCE_ACCOUNTS` in `money/ledger.js` (measured clean: 0 quarantined, balances equal). With it, an open run is refunded at its stake by the sweep.

## Deviations from the brief (contract section 7)
1. Odds derived from multipliers (x1.04/1.10/1.30 kept exactly): later steps are 3.8/9.1/23.1%, the whole 4% edge is in step 1.
2. Options are all unvisited neighbours (1 to 8), not 2 to 4; each state once; dead end cashes out.
3. LANDSLIDE pays 1,000x, not the 10,000x cap (cap kept as a guard).
4. Bets start at 100 units so every payout is a whole number.
5. One open run per account; cash-out before the first step is a refund.
6. AK and HI joined by air links (WA-AK, AK-HI, HI-CA).
Also: the critic's wording of "bet 2000" in the legs brief is 200 in the product.

## Money-critic and visual-critic history
- Opus money critic R1 (CRITIC-R1.md): no pay-twice, RTP <= 96.00% holds; 4 real faults (C1 doomed scandal paid as a cash-out after a fenced-ledger restart, C2 drawn win not sticky, C3 failed flush re-draws, C4 tier change turns cash-out into a refund) + 4 test gaps. I reproduced all four; F1 fixed them (pend written to the record before the ledger, memo for a failed flush, per-run tiers, `money_down` fence); I re-ran the repros and read the diff. No second round was run.
- Opus visual critic R1: 33 defects; I confirmed V10/V11/V3/V1 by looking at the shots; fix wave 1 (V1 builder) fixed most. One of two fix waves used; no second critic round on the fixed client.

## My own counts (merged head f2c8edc, all re-run or read by me)
- `tests/campaign-engine.js` 21, `tests/campaign.js` 28, `tests/campaign-money.js` 31: all pass (after the last commit).
- `tests/v2/run.js --jobs 1`: 166/166 pass, 0 fail (522 s) on an export of f2c8edc. Server/engine code is unchanged since 5c6e70b, where it was also 166/166.
- `prove.js` on 5c6e70b: PROOF OK, 20/20 bugs caught, including all 8 campaign mutants. (Server code identical to f2c8edc.)
- Soak with kills: seed 11 (899d42e) and seed 12 (5c6e70b): both CLEAN, 4 SIGTERM kills each, 0 violations; seed 12 = 3342 steps, 300 campaign runs.
- Browser legs (real clicks through the shell): 33 rounds play540 (Play $) and 33 rounds chips360 docked, 0 fails, independent ledger replay `qa/campaign-legs/lead-check-leg.py` PASS on both. After the visual fixes only the play540 leg was re-run (PASS, 33/33).
- `money_down` reproduced at 540 and 360: the toast shows, the UI stays usable, the run stays open, the stake stays in escrow.

## What failed / is open
- **prove.js flake:** on 899d42e `settle-after-void` was caught only by I9 (expected I2/I7) in 1 of 3 runs; a kill landing mid Cold Call round lets I9 fire first. Not seen on 5c6e70b. Not fixed.
- **Chips plate vs BALANCE (decision for Chris):** mid-run the shell Chips plate counts the open stake (20,000), the game BALANCE does not (19,500). Play $ plate matches. All agree after every round. Fix needs a shell change or the game adding the stake in Chips mode only.
- **Shell, not Campaign:** after a page reload the Chips plate shows "CHIPS --" and the dock flag is unlit (shell.js 282-284, 299, 322). Same for every game.
- **Rules table odds** are blank on the first open of a session (the state payload carries no per-tier odds). Server change to send them.
- At 360 the result map is small (~150 px); the 360 dock leaves it about 130 px.
- Landslide screens in the shots are synthetic (server-shaped message fed to the page), because no real 49-step route can be driven.

## Not run
- 1440x900 browser legs (1440 shots were taken but no 33-round leg); no chips360 leg after the visual fixes; no restart/recovery after `money_down` in the browser; touch scrolling and a phone keyboard over the search list; Money pref 'usd'; sound; anything on Railway; no second visual-critic round; no soak or prove re-run on f2c8edc (server code identical to 5c6e70b).

## Needs Chris
1. Go / no-go on the Chips plate behaviour (above).
2. LANDSLIDE size: 1,000x ($25,000 max at the top stake) is my default.
3. Ship the one-line `SOURCE_ACCOUNTS` fix to master before go-live.
