# RETUNE NOTES (running log; config tried -> numbers)

Compute: shaman (24 threads, Node v24), E:\bricklord-test\coldcall-sim, helper ~/cc-tools/shrun.sh. No perf-lock owner files present at start (2026-10-05).

## BEFORE (config of 808567d), all run on shaman
- plain 200M seed 303 (44 s): RTP 97.941 +-0.257; hit whole 32.22%, base-only 31.91%; bands %spins/%RTP: 0 67.78/0; <1 24.93/8.44; 1-2 3.337/4.43; 2-5 1.671/4.75; 5-20 1.461/15.49; 20-100 0.696/28.28; 100-1000 0.120/27.65; 1000+ 0.005/8.89.
  bonus 1 in 171/1926/25803, any 1 in 156.4; avg bonus1 50.24 b2 289.6 b3 1684, all 79.58x; bonuses 52.0% of RTP; cap 51 (1 in 3.92M: base 21, b1 12, b2 6, b3 12). max 10000x.
- strat 450M+8M seed 202 (157 s): RTP 98.099 +-0.139; clusters 21.33 phone 25.74 b1 29.38 b2 15.16 b3 6.49; avg b1 50.28 b2 290.80 b3 1679.41.
- buys 5M seed 404 (60 s): call 4.546x (RTP 98.82+-0.53 at 4.6), bonus1 50.276x (98.00+-0.16 at 51.3), bonus2 291.115x (97.99+-0.08 at 297.1), hunt 3.991x (97.35+-1.23 at 4.1). Raw: /tmp/ccout/before_*.json
- Observation: bonuses are phone-driven (bonus1 clusters 1.6x of 50.3x). Under-1x wins are 24.9% of spins today; the 5x+ bands carry 80.3% of RTP today.

## Tuning log (shaman, short runs; plain 30M seed 21, strat seed 22; bonus probes seed 31). cfg files in /tmp/ccout/cN.json = overrides on top of 808567d CFG
Key learnings:
- Hit rate vs weight flattening (weights_i = w_i^alpha, rescaled to the same sum 140.4): alpha 1 = 32.2%, 0.8 = 23.1%, 0.6 = 15.6%, 0.4 = 10.0%. alpha ~0.74-0.76 gives 20.6-21.5%.
- Wins under 1x are almost entirely mug / note 5-6 clusters. With every 5-cluster pay >= 1.0x (10 tenths) the <1x band is 0.000% of spins (c5+). c4 (mug 5 = 0.6x, note 0.8x) put 11.1% of spins under 1x.
- Flatter weights = fewer hot leads in bonuses; bonus avg fell (b1 50 -> 32). Fixed with per-mode wild weight (bonus1 wild 5) and silver/gold weights.
- Bonus1 probes from c5 (b1 avg 53.1): wild 5 -> 68; phone 7 -> 50; silver 20 + gold 2 -> 70.7; upsell 16 -> 62.5 (cap 1 in 11.5k runs); close 1.5 -> 62.3 (cap 1 in 6.7k); wild 5 + silver 20 + gold 2 -> 90.1.
- c2 (alpha .78, P5 10.., M [1,1.25,1.8,3,6,12,28,70,180]): clusters 53.9% RTP: too much. c3 M [1,1.15,1.5,2.2,4,8,20,60,160]: 46.6. c6b P5 10.. M [1,1.08,1.3,1.8,3,6,15,45,130] alpha .74: clusters 36.2, base phone 12.75 (phone 0.2).
- c8 (c6b + bell 1.54, b1 wild 5 silver 20 gold 2 upsell 9 close .6, b2 wild 3 silver 12 gold 1 upsell 9 close .2, b3 wild 2): strat 60M: RTP 102.36 +-0.30, any bonus 1 in 199, combined avg 106.5x, bonus 52.3% of RTP.
- c9 (bell 1.53, b1 silver 18 gold 1.8, b2 silver 11 gold .9): strat 80M/2.5M: RTP 98.85 +-0.25; cl 36.13 ph 12.76 b1 37.28 b2 10.06 b3 2.63; any 1 in 202 (b1 220 b2 2762 b3 41907); avg b1 81.8 b2 277.8 b3 1102, combined 101.1x; bonus 50.5% of RTP. Plain 30M: hit 20.69%, <1x 0%, 1-2 14.54%, 2-5 4.44%; >=5x carry 71.3% of RTP (today 80.3%).
- Target 5 arithmetic: with ~20% hits all >= 1x, the <5x bands carry at least ~22-27 pts of RTP, so >=5x share cannot reach today's 80.3% unless bonuses/phone take more of RTP. Trying: compress mid pays, shift RTP from clusters to base phone, bonus share to ~53%.
- c10 (phone .26): RTP 102.2, c11 (phone .225, bell 1.52, b1 silver 19 gold 1.9): strat 100M RTP 98.49 +-0.22. c12 (phone .217): 98.02 +-0.22; hunt 2.44% bonus = 5.0x natural (bellMult 1.85 kept). Note: ">=5x share" printed by ~/cc-tools/summ.js was in RTP points, not % of RTP: today 80.27 pts / 97.94 = 82.0% of RTP; c12 72%.
- Pay table differentiated by symbol at sizes 7+ (factor F [1,1.1,1.2,1.35,1.55,1.85,2.3,3,4,5.5]; sizes 5-6 flat 10..18): c13 98.71, c14 (base phone .205) strat 150M/3M seed 22: RTP 98.025 +-0.186. FINAL CONFIG = c14 (in engine CFG).
- Buy values at c14, 10M seed 505 (shaman, 61 s): call 2.849x, bonus1 83.908x, bonus2 277.705x, hunt 3.469x -> prices (avg/0.98 -> whole tenth) call 29, bonus1 856, bonus2 2834, hunt 35.
- tests: only the hit-rate band (30-35 -> 18-26) and the pay-shape assertion (5-cluster 10..18, 13+ 1300..7150) changed; 46 pass, bender 17 pass.
- Final-run attempt 1 on 6ff7b46 (phone .205), strat 450M/8M seed 202: RTP 97.788 +-0.109 (pooled with the 150M tuning run 98.025 +-0.186 -> ~97.82). Centre it: base phone .205 -> .208 (+~0.2). Plain 200M seed 303: RTP 97.795 +-0.230, hit 20.68, sd 16.63x. Discarded as the final table; rerun on the new commit.

## Second pass (2026-10-06, branch coldcall-v2, from c14 / 47ca018). Overrides on the c14 CFG; tune.sh = plain 30-60M seed 21 + strat 60-150M/3-4M seed 22, shaman
Diagnosis (local, 3M base spins, script mode): the 2-5x band (11 pts) is mostly chains of cheap clusters (no phone, 2+ cascades: 3.18% of spins, 7.8 pts); the 1-2x band is single 5-6 clusters at 1.0-1.2x (14.5% of spins, 15.3 pts). Base 5x+ spins are almost all phone-feature fires (a feature on 5+ bronze leads already pays about 5x), so base 5x+ spin share follows the phone fire rate (phone weight), not the cluster pay.
- c15 (mug 5/6 = 0.5/0.8x, note 5/6 = 0.7/0.9x, base silver 2.5 -> 5, gold 0.2 -> 0.4): RTP 95.57, <1x 9.42% (too many), 2-5x 2.08% / 5.7 pts, base 5x+ 1.256% / 24.2 pts (silver alone does not make more 5x+ spins).
- c16 (mug 5 = 0.6x, 6 = 1.0x; base phone weight 0.208 -> 0.30; base reveal back to 2.5/0.2): RTP 100.62, <1x 4.00%, base 5x+ 1.616% (1 in 62) / 27.2 pts, <5x 23.7 pts. Phone weight is the lever for base 5x+ spins: +0.01 = +0.03% of spins and +0.58 pts of RTP.
- c17 (c16 + mug/note/ball/can sizes 7-9 trimmed): 99.41, <5x 22.7 pts, base 5x+ 1.601% / 27.0.
- c18 (c17 + cups/headset/rx/pile sizes 7-9 trimmed, note 5 = 0.8x, phone 0.31): 99.00, <1x 6.33% (note 5 at 0.8x costs 2.3% of spins, over the 5% allowance), <5x 21.9 pts, 1.631% / 27.4.
- c19 (c18 with mug 5 = 0.3x, note 5 back to 1.0x): 97.84 +-0.28 (60M), <1x 4.05%, <5x 20.9 pts (share 79.2%), 1.623% / 27.3. Lowering the mug 5 pay is the cheap way to buy points inside the sub-1x allowance (0.3 vs 0.6 = +1.2 pts), unlike note 5.
- c20 (phone 0.313): strat 150M/4M 98.02 +-0.19; plain 200M seed 303 hit 20.62%, share 78.6%, base 5x+ 1.636% / 27.6. Hunt at bell 1.85 20M: 3.439x. Call 2.784x (price 2.9 = 96.0%, 2.8 = 99.4%: call did not fit a tenth).
- c21 (c20 + base silver 2.65): RTP 98.22, call 2.803x (silver +0.15 = +0.19 pts RTP, +0.019x of call).
- c22 (silver 2.95, mug 7-9 -> 11/16, note 13/18, ball 14/22): strat 98.30 +-0.19, call 2.837x (sits on the 2.9x price: 2.842x = 98.0%), 1.638% / 28.0.
- c23 (c22 + cups/headset/rx sizes 8-9 trimmed): no change (those sizes almost never occur in the base game).
- c24 (c22 with base phone 0.308): plain 100M seed 21: hit 20.63%, base 5x+ 1.621% / 27.8, <5x 20.7 pts; strat 200M/4M seed 22: 98.10 +-0.16; call 2.838x. FINAL CONFIG = c24 (in engine CFG).
- Hunt: with c24 at bellMult 1.85 (100M seed 707): 3.4555x = 98.7%; at 1.80: 3.228x; at 1.844: 3.4289x = 97.97% (hunt-only 100M seed 707). Slope about 4.5x per unit of bellMult. Committed 1.845 (pooled estimate about 3.429x). A hunt-only run and a call+hunt run with the same seed consume the rng differently: 1.844 gave 3.4289 hunt-only and 3.4149 after call (1.1 sigma), so the final file's 100M reading (97.72) is a low draw.
- Final runs on c24 (shaman): strat 450M/8M seed 202: 97.926 +-0.111 (133 s); plain 200M seed 303: 98.02 +-0.23; buys 10M seed 606; call+hunt 100M seed 707; hunt 200M seed 909. Prices from avg/0.98: call 2.832 -> 29, bonus1 83.18 -> 849, bonus2 276.72 -> 2824, hunt 35.
- Sim: added an `exact1` counter (spins paying exactly 10 tenths) and `exact1Pct`, `exact1PctOfHits`, `under1PctOfHits` to the plain output.
- Tests: only the pay-shape assertion changed (mug 5-cluster 3, every other 5-cluster >= 10); coldcall 47 pass, bender 19 pass.
- Configs fitted: 10 (c15-c24) plus hunt bell probes. Limit found: base 5x+ is not capped by anything but RTP: a base game with the phone feature at 20% of RTP and the mug 5 at 0.3x fits all six; the 80% stretch for 5x+ share was not reached (78.9%): that would need either a lower hit rate (the pushes below 5x are about 18.6% of spins at >= 1.0x) or more sub-1x spins than the 5% allowance.
