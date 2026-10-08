# CAMPAIGN TRAIL: the maths (builder A, 2026-10-07)

Files: `games/campaign-engine.js` (rules), `games/campaign-map.js` (50 states), `games/campaign-sim.js` (simulator), `tests/campaign-engine.js` (21 tests).
Contract: `CAMPAIGN-DESIGN.md` section 2. Nothing here changes it.

## 1. Derivation in 10 lines

1. The multiplier is an integer `mx` in hundredths (100 = 1.00x). Step `n` into a state of growth `g` (104 / 110 / 130): `mxNext = floor(mxPrev * g / 100)`; step 49 (the 50th state) is `mxNext = 100000`.
2. The scandal chance is DERIVED from the two integers: `pFail = 1 - R(n) * mxPrev / mxNext`, `R(1) = 0.96`, `R(n >= 2) = 1`.
3. Survival of step `n` has probability `R(n) * mxPrev / mxNext`; the product over steps 1..k telescopes (each `mxNext` is the next `mxPrev`).
4. So `P(survive k steps) = 0.96 * 100 / mx_k`, i.e. `P * mx_k = 96` for every route, every prefix, every stop point. A cash-out pays `bet * mx / 100`: expected return per stake = `P * mx_k / 100 = 0.96`.
5. A dead end or a LANDSLIDE is a forced stop after a survived step, so it is one more stop point: still 96.00%.
6. The 4% edge is taken once, on step 1 (worse odds there); every later step is exactly fair. Strategy cannot change RTP: only variance and the shape of the payout.
7. `0 < pFail < 1` holds because `mxNext > mxPrev` on every step (floor of x1.04 from 100 is 104; for `mxPrev >= 100` the floor always adds at least 4) and `R * mxPrev / mxNext > 0`.
8. Bet levels are multiples of 100 units, so `bet * mx / 100` is a whole number for every integer `mx`: no rounding anywhere.
9. `pFail` as a float is ONE integer division (`(10000*mxNext - 9600*mxPrev) / (10000*mxNext)` on step 1, `(mxNext - mxPrev) / mxNext` later), so it is correctly rounded; the test shows it is within 1e-12 of the exact rational.
10. The server draws one uniform `u` per step and fails when `u < pFail`; `u === pFail` survives, `0` always fails, `0.999999` always survives (the largest `pFail` is the LANDSLIDE step's, about 0.945).

## 2. What is proven how

| claim | how | where |
|---|---|---|
| `P(survive) * mx == 96` exactly | BigInt rationals, contract re-implemented independently of the engine, checked at EVERY prefix of (a) all routes to depth 5 from 14 named homes (swing PA GA WI; lean OH TX NH ME AK HI RI FL; safe WY MO TN; 12,247 prefixes) and from all 50 homes (51,038 more), (b) 20,000 seeded random routes of random length 1..49 (250,588 prefixes) | tests |
| float `opt.pFail` within 1e-12 of the rational | same walk | tests |
| `0 < pFail < 1`, `mxNext > mxPrev` | every `mxPrev` from 100 to 99,999 and every tier (later steps), the three first steps, the LANDSLIDE step for every `mx48` | tests |
| largest `mx` before step 49 below `LANDSLIDE_MX` | real-number bound `100 * 1.3^7 * 1.1^18 * 1.04^23 = 8598.8` (85.99x: home and last state outside the product, so 7 swing + 18 lean + 23 safe is the worst case); floors only lower it | tests |
| a LANDSLIDE exists | witness route through all 50 states, stored in the test, walked with a forcing rng: `done === 'landslide'`, `mx === 100000`, payout `bet * 1000` for all five bets | tests |
| mutations are caught | engine with `RTP_BPS` 9601, `Math.round` instead of `floor`, `<=` instead of `<` each fail the suite (checked by hand) | |

## 3. Odds as the engine really gives them

The server sends the real `pFail` for every option; the nominal table in the contract is the rounded version.

| tier | growth | first step | later steps, min .. max (over every `mxPrev` from 104 to 8,600) |
|---|---|---|---|
| SAFE | x1.04 | 7.692% (1 in 13.0) | 3.125% (at mx 124, 1 in 32) .. 3.846% (at mx 125, 1 in 26) |
| LEAN | x1.10 | 12.727% (1 in 7.9) | 8.403% (at mx 109) .. 9.091% (at mx 110, 1 in 11) |
| SWING | x1.30 | 26.154% (1 in 3.8) | 22.603% (at mx 113) .. 23.077% (at mx 110, 1 in 4.3) |

(The min..max scan is over all integer `mxPrev`, a superset of the reachable values.) The first step does not depend on the map: it is always from 100.
The LANDSLIDE step (step 49) has `pFail = 1 - mx48 / 100000`. `mx48` lies between about 5,500 (all the big tiers spent early; real-number bound `100*1.3^5*1.1^18*1.04^25`) and 8,598 (bound above),
so `pFail` is 0.914 .. 0.945: you WIN the last step 1 time in 11.6 .. 18.2. The stored witness route has `mx48 = 7781`, `pFail = 0.92219`, 1 in 12.85 to win.
Chance of a LANDSLIDE from the start on any route: `0.96 * 100 / 100000 = 0.096%` (1 in 1,042); it pays 1000x; that is the whole 96% of that route's RTP.

## 4. Exposure

- Bet levels `[100, 200, 500, 1000, 2500]` units (1 unit = 1 Play cent = 1 chip).
- LANDSLIDE: `2,500 x 1,000 = 2,500,000 chips = $25,000 Play $` on one run (probability 0.096% on a witness-like route). The hard cap `CAP_MX = 1,000,000` (10,000x) is never reached.
- Largest multiplier WITHOUT a LANDSLIDE: the real-number ceiling is 85.99x. A randomised search over 49-state routes (40,000 restarts, 10,448 routes found) gave **83.64x (`mx` 8364)**, i.e. $2,091 at a 2,500 bet:
  `UT AZ NV CA HI AK WA OR ID MT ND MN WI MI IN OH WV KY IL IA SD WY NE CO KS MO OK NM TX LA AR MS AL FL GA TN NC VA MD DE NJ PA NY CT RI MA VT NH ME` (home UT, 48 steps, ends in Maine: a dead end that auto-cashes at 8364).
  Under 100x, as the contract says; the true maximum is between 83.64x and 85.99x. Largest paid multiplier seen in 1M-run sim lines without a landslide: 68.81x.

## 5. Map

- 50 states, no DC. Land borders of the 48 contiguous states: **105 edges** (107 with DC, which has MD and VA). Plus 3 air links AK-WA, AK-HI, HI-CA: **108 edges**. Sum of degrees 216; land degrees sum to 210.
- Excluded: Four Corners diagonals (AZ-CO, NM-UT) and water-only boundaries (MI-MN, NY-RI, ...). Included: river boundaries (DE-NJ, the Mississippi/Ohio/Missouri states).
- Checked two ways in the test, both against numbers typed separately from the map: (1) the land degree of every one of the 48 states against a separate table (TN 8, MO 8, KY 7, ME 1; exactly FL, RI, SC, WA have 2), and (2) the totals: handshake sum 210 = 2 x 105, and 105 (+2 for DC = 107) is the standard edge count of the contiguous-US adjacency graph. Symmetry is tested on the raw lists (every state lists its neighbours itself, so a one-sided typo fails).
  I could not fetch an outside source (no network in this job); the degree table and the 105/107 figures are from memory, and the fact that two independently typed tables agree is the evidence.
- Connected with the air links; without them exactly AK and HI are cut off (48 reachable).
- Tiers 7 / 18 / 25 exactly as the contract; party: 24 R, 19 D, 7 S (2024 presidential result, colour only).
- LANDSLIDE witness (home Maine, Maine an end): `ME NH VT MA RI CT NY NJ DE MD PA WV OH MI IN IL WI MN ND MT SD IA NE KS CO WY UT ID WA AK HI CA OR NV AZ NM OK TX LA AR MO KY VA NC SC GA FL AL MS TN`. It needs all three air links (WA-AK-HI-CA is a chain; AK and HI each have exactly two neighbours).

## 6. Simulator

Command (about 2 minutes on 6 workers, 1,000,000 runs per line, 34 lines, 36M runs):

    node games/campaign-sim.js --runs 1000000 --seed 20261007 --workers 6

Strategy definitions are in the header of `games/campaign-sim.js`. "picks" counts every pick including the one that ended in a scandal. "avg paid x" is the mean over runs that paid. RTP and its 95% interval are over all runs of the line.

```
CAMPAIGN TRAIL sim: engine v1, seed 20261007, 1000000 runs per line, 119 s
line                                      RTP %   95% interval       scandal%  picks  avg paid x  max paid x  deadends  landslides
always-safe @ 1.5x                         95.95  [ 95.81,  96.10]     36.83   7.00        1.52        1.93    124262           0
always-safe @ 2x                           95.97  [ 95.78,  96.16]     49.69   9.03        1.91        2.58    194118           0
always-safe @ 5x                           95.89  [ 95.59,  96.18]     63.43  10.77        2.62        6.48    328012           0
always-safe @ 20x                          95.74  [ 95.39,  96.08]     64.68  10.91        2.71       25.98    352839           0
always-safe @ never                        95.81  [ 95.46,  96.17]     64.73  10.92        2.72       68.81    352699           0
always-swing @ 1.5x                        95.89  [ 95.73,  96.05]     41.72   2.43        1.65        1.92     43616           0
always-swing @ 2x                          95.96  [ 95.76,  96.17]     52.94   3.52        2.04        2.58     77036           0
always-swing @ 5x                          96.08  [ 95.73,  96.44]     73.00   5.61        3.56        6.48    175769           0
always-swing @ 20x                         95.86  [ 95.31,  96.42]     78.15   6.14        4.39       25.85    210401           0
always-swing @ never                       95.88  [ 95.27,  96.48]     78.44   6.17        4.45       62.01    215633           0
mixed @ 1.5x                               96.02  [ 95.87,  96.18]     39.37   4.36        1.58        1.93     89199           0
mixed @ 2x                                 95.79  [ 95.60,  95.99]     51.30   5.79        1.97        2.58    152010           0  <-- 96.00 OUTSIDE
mixed @ 5x                                 96.15  [ 95.83,  96.46]     66.44   7.67        2.87        6.48    277120           0
mixed @ 20x                                95.98  [ 95.58,  96.38]     68.71   7.95        3.07       25.93    311912           0
mixed @ never                              95.90  [ 95.49,  96.30]     68.80   7.96        3.07       57.77    311995           0
greedy-growth @ 1.5x                       96.02  [ 95.85,  96.18]     41.85   2.40        1.65        1.92     17524           0
greedy-growth @ 2x                         95.92  [ 95.71,  96.12]     53.73   3.47        2.07        2.48     64763           0
greedy-growth @ 5x                         96.04  [ 95.67,  96.42]     76.92   5.36        4.16        6.38    103609           0
greedy-growth @ 20x                        95.94  [ 95.44,  96.44]     82.28   5.97        5.41       13.70    177242           0
greedy-growth @ never                      95.95  [ 95.45,  96.46]     82.26   5.97        5.41       13.70    177446           0
greedy-risk @ 1.5x                         95.91  [ 95.76,  96.06]     37.51   7.25        1.53        1.63     59210           0
greedy-risk @ 2x                           95.86  [ 95.66,  96.06]     51.27   9.55        1.97        2.39    188804           0
greedy-risk @ 5x                           95.73  [ 95.44,  96.02]     62.79  10.92        2.57        6.47    328753           0
greedy-risk @ 20x                          95.89  [ 95.56,  96.22]     64.06  11.08        2.67       12.90    359352           0
greedy-risk @ never                        95.70  [ 95.37,  96.03]     64.08  11.07        2.66       12.90    359179           0
first-step-and-out safe                    96.02  [ 95.96,  96.07]      8.35   1.00        1.05        1.30         0           0
first-step-and-out lean                    96.01  [ 95.94,  96.08]     12.29   1.00        1.09        1.30     17475           0
first-step-and-out swing                   95.93  [ 95.84,  96.03]     19.47   1.00        1.19        1.30     17604           0
LANDSLIDE hunter (witness, never cash)     92.60  [ 86.64,  98.56]     99.91  11.34     1000.00     1000.00         0         926
mixed @ 2x, bet 100                        96.05  [ 95.85,  96.24]     51.20   5.79        1.97        2.58    151676           0
mixed @ 2x, bet 200                        96.05  [ 95.85,  96.24]     51.20   5.79        1.97        2.58    151676           0
mixed @ 2x, bet 500                        96.05  [ 95.85,  96.24]     51.20   5.79        1.97        2.58    151676           0
mixed @ 2x, bet 1000                       96.05  [ 95.85,  96.24]     51.20   5.79        1.97        2.58    151676           0
mixed @ 2x, bet 2500                       96.05  [ 95.85,  96.24]     51.20   5.79        1.97        2.58    151676           0
```

### Honest reading of the one line that misses

`mixed @ 2x` is 95.79 [95.60, 95.99]: 96.00 is 0.01 points outside. I did not widen the interval. What I checked:

- The identity is exact and tested with BigInt rationals; the engine is the same code the sim plays. Nothing in the sim touches the odds.
- 34 lines at 95% each: 1.7 misses are EXPECTED by chance (the five bet lines share one seed and are one sample, so about 30 independent lines, 1.5 expected).
- Same line, 12 more seeds (11..22, 1M runs each): 96.05 95.92 96.03 95.87 95.91 95.89 95.79 95.95 96.07 96.13 95.97 96.01, mean **95.966**, standard error 0.03, so 96.00 is within 1.2 standard errors. One of the 12 misses its own interval, as 5% predicts.
- Whole table again with seed 20261008: the only miss is the LANDSLIDE hunter (103.50 [97.20, 109.80]: 1,035 landslides against 960 expected, 2.4 standard deviations, a binomial count). Hunter, 10 more seeds (31..40): landslide counts 962 986 937 954 959 1004 936 966 894 981, mean 957.9 against 960 expected.
- The first-step-and-out lines, where the interval is only +-0.06, are 96.02 / 96.01 / 95.93 (inside).
- The hunter's own interval is wide by nature (a 1000x prize at 0.096%): +-6 points at 1M runs.

Conclusion: no bug found; the miss is the expected 5%.

## 7. Notes for the other builders

- `E.payout(run, bet)` returns 0 for a scandal even at 0 steps (a scandal on the first pick); it throws `bad_run` only for a live run with 0 steps (that is a refund). It throws `bad_bet` when `bet * mx / 100` is not a whole number (cannot happen for the five bet levels).
- `E.options(run)` returns options in map (alphabetical code) order; air links are ordinary neighbours in `adj` and are listed in `MAP.air` as `[a, b]` pairs. `MAP.tiers` holds the growth table, `MAP.codes` the 50 codes.
- The engine throws `EngineError` with `.code` in `bad_home | bad_step | bad_run | bad_bet`.
