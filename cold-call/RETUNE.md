# COLD CALL retune to high volatility: BEFORE / AFTER

BEFORE = commit 808567d. AFTER = commit d2faee3 (the commit these numbers were measured on). Rules and script shape are unchanged; only `CFG` numbers moved
(symbol weights, pay table, base phone and bell weights, bonus wild weights, bonus reveal weights, buy prices). Log of the steps: `cold-call/RETUNE-NOTES.md`.

Runs (all on shaman, 24 threads, Node v24, `CC_MAX_THREADS=24`; seeds are per-chunk so the thread count does not change a result):
- Stratified (`--strat`): 450,000,000 base spins + 8,000,100 runs of each bonus kind, seed 202 (BEFORE 157 s, AFTER 129 s).
- Plain: 200,000,000 rounds, seed 303 (BEFORE 44 s, AFTER 37 s). The BEFORE sd was added by re-running 808567d's engine with the new sim, same seed (every other number reproduced exactly).
- Buys BEFORE: 5,000,000 rounds per buy, seed 404, at the old prices. Buys AFTER: 10,000,000 rounds per buy, seed 606, at the new prices; `call` and `hunt` also 100,000,000 rounds, seed 707.

| Row | BEFORE (808567d) | AFTER (d2faee3) |
|---|---|---|
| **RTP +- CI (stratified, 95%)** | 98.10% +- 0.14 | **97.95% +- 0.11** |
| Standard deviation of one round (plain) | 18.56x bet | 16.69x bet |
| **Hit %, whole paid round** (any win, bonus included) | 32.22% | **20.68%** |
| Hit %, base-only (cluster or phone pay) | 31.91% | 20.36% |
| Band 0 (no win): % spins / % RTP | 67.78 / 0 | 79.32 / 0 |
| Band under 1x | 24.93 / 8.44 | 0.000 / 0 |
| Band 1-2x | 3.337 / 4.43 | 14.47 / 15.30 |
| Band 2-5x | 1.671 / 4.75 | 4.488 / 11.03 |
| Band 5-20x | 1.461 / 15.49 | 1.107 / 10.62 |
| Band 20-100x | 0.696 / 28.28 | 0.437 / 19.80 |
| Band 100-1000x | 0.120 / 27.65 | 0.169 / 35.27 |
| Band 1000x+ | 0.005 / 8.89 | 0.003 / 5.95 |
| Wins of 5x and more: % of spins, share of RTP | 2.28%, 82.0% (80.3 of 97.9 pts) | 1.72%, 73.1% (71.6 of 98.0 pts) |
| Same, base spin only (no bonus): share of base RTP | 62.3% | 45.1% |
| Bonus frequency: bonus 1 / 2 / 3 / any (stratified) | 1 in 171 / 1,918 / 25,862 / 156.2 | 1 in 224 / 2,832 / 44,092 / 206.7 |
| Average bonus x, natural: bonus 1 / 2 / 3 (stratified) | 50.28 / 290.80 / 1,679 | 83.82 / 277.65 / 1,102 |
| Average bonus x, all natural bonuses (plain) | 79.6x | 102.9x |
| Bonus share of RTP (stratified) | 52.0% (51.0 pts) | 50.8% (49.7 pts) |
| RTP by part: clusters | 21.33% | 34.98% |
| base phone feature | 25.74% | 13.26% |
| bonus 1 | 29.38% | 37.41% |
| bonus 2 | 15.16% | 9.80% |
| bonus 3 | 6.49% | 2.50% |
| Buy `call`: price, re-simulated RTP | 4.6x, 98.82% +- 0.53 (5M) | 2.9x, 98.07% +- 0.47 (10M); 97.92% +- 0.14 (100M) |
| Buy `bonus1` | 51.3x, 98.00% +- 0.16 | 85.6x, 97.99% +- 0.12 |
| Buy `bonus2` | 297.1x, 97.99% +- 0.08 | 283.4x, 97.95% +- 0.07 |
| Buy `hunt` | 4.1x, 97.35% +- 1.23 | 3.5x, 99.30% +- 0.78 (10M); 99.15% +- 0.25 (100M) |
| Max win seen | 10,000x | 10,000x |
| Cap-hit rate (plain 200M) | 51 = 1 in 3.92M (base-only 21, bonus 1 12, bonus 2 6, bonus 3 12) | 61 = 1 in 3.28M (base-only 4, bonus 1 50, bonus 2 6, bonus 3 1) |

## Targets

1. **Total RTP 98.0 +-0.3 (stratified, tight CI): met.** 97.95% +- 0.11 (CI 97.84 to 98.06).
2. **Any bonus 1 in 180-220: met** (1 in 206.7). **Average natural bonus 90-120x: met** (102.9x plain; 102.7x from the stratified parts). **Bonuses 45-55% of RTP: met** (50.8%).
3. **Wins under 1x on at most about 5% of spins: met.** 0 of 200,000,000 spins. This is structural: every 5-cluster pays at least 1.0x and bubbles only exist on spins that have a cluster. Many hits therefore pay exactly 1.0x to 1.2x (the 1-2x band is 14.5% of spins, 15.3 pts of RTP); how many are exactly 1.0x was not counted.
4. **Base hit rate 20-24%: met, at the low edge.** Whole round 20.68%, base-only 20.36%; I matched the whole-round figure.
5. **Wins of 5x and more carry more of the RTP than today: MISSED.** Share of RTP in rounds paying 5x+ fell from 82.0% to 73.1% (80.3 to 71.6 pts); in the base spin alone from 62.3% to 45.1% of base RTP. Fewer spins pay 5x+ (2.28% to 1.72%), but the average 5x+ win is larger (35.2x to 41.7x).
   Why: the 1x-5x bands hold 19.0% of spins, and every hit pays at least 1.0x, so they carry at least 18 pts of RTP (measured 26.3). With a 20% hit rate floor and nothing under 1x, the 5x+ share cannot exceed about 81%, below today's 82.0%.
   Using the 5% sub-1x allowance on small wins would lift that bound by about 2 points, but only with almost nothing left in the 2-5x band (11 pts today); I did not find such a mix and did not try it.
   Targets 3 and 4 outrank 5, so I kept them. I did move RTP into the big end where it was free (bonus 100-1000x band 27.7 -> 35.3 pts), and the base phone feature stays 13.3 pts.
6. **MAX_WIN 10,000x enforced: met.** Max seen 10,000x; cap-hit rate 1 in 3.28M spins (61 events, about +-13%); stratified cross-check about 1 in 3.0M. 82% of cap hits are bonus 1 (50 of 61): bonus 1 reaches the cap in 1 of 18,300 bonuses.
7. **Buys = average value / 0.98, whole tenth, re-simulated: done.** `bonus1` 85.6x (not the ~100x the brief expected: bonus 1 averages 83.8x, because bonuses are held to 50.8% of RTP and bonus 2 and 3 take the rest). Re-simulated RTPs: bonus1 97.99, bonus2 97.95, call 97.92 (100M), hunt 99.15 +- 0.25 (100M). `hunt` is 1.2 pt over 98 because one whole tenth is 2.9% of a 3.5x price; the rule was followed, not bent.

## About "high volatility"

By the single-number measure the retune is not more volatile: the standard deviation of a round fell from 18.6x to 16.7x bet, and rounds paying 1000x+ went from 1 in 22,100 to 1 in 30,400. Bonus 3 is the cause: it is rarer (1 in 25,900 to 1 in 44,100 spins) and smaller (1,679x to 1,102x), and that was most of the variance. What is more volatile: 79.3% of spins lose (was 67.8%), rounds paying 100x+ are 1 in 579 (was 1 in 800), the average bonus is 102.9x (was 79.6x), and the cheapest buy is 85.6x (was 51.3x).
If a larger sd is wanted, the lever is bonus 3 (base bell weight and bonus 3 reveal weights); I did not change it because targets 1 and 2 pin total bonus RTP.

## Unverified

- Front end: `public/games/coldcall/game.js` is still the v1 board and was not run against these numbers. No browser or server (`server.js`, sockets, e2e) run was done; `node tests/coldcall.js` (46) and `node tests/bender.js` (17) pass.
- RTP is the sim measuring its own engine; the independent replayer checks the script, not the maths against an outside source. The stratified estimator ignores the cap interplay between base pay and bonus (a few 1e-6 of a bet).
- The final buy prices come from the seed-505 10M run, taken one tick before base phone weight went 0.205 -> 0.208 (a +0.18 RTP centring step). The re-simulations on the final config (seeds 606, 707) agree (call 2.844x / 2.840x, bonus1 83.88x, bonus2 277.58x, hunt 3.476x / 3.470x); a re-derived price would differ by at most 2 tenths (bonus2 2832 vs 2834). Bonus2 re-simulated at 2834: 97.95%.
- Tuning runs (RETUNE-NOTES.md) used other seeds and sizes; only the numbers in the table above are final.
- The share of hits paying exactly 1.0x was not counted. Script sizes were measured locally on 1.5M rounds, bonus 3 on only 17 samples.
- The stale RTP label and v1 texts in the server and front end (see the F list in the report) were not edited.
