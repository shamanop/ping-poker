# THE PULL: sim notes (engine builder, 2026-10-06)

Owner: the engine builder. Source: `games/coldcall-sim.js` (new modes `--pull`, `--bonus`; the old modes are untouched). Contract: `PULL-ENGINE.md` section 5.
Heavy runs go to shaman (24 cores) per `RETUNE-NOTES.md`; on this box only smoke runs (<= 2M spins, `nice -n 10`, `CC_MAX_THREADS=2`).

## Commands

```
# THE PULL: sequential flat-bet sessions with state, no idle time. Positional: sessions, paid spins per session, seed.
nice -n 10 node games/coldcall-sim.js --pull [sessions=20000] [spinsPerSession=2000] [seed=1] [--pickpolicy first|best|none] [--more bank|take] [--bet 100] [--nowarmdiff] [--cfg '{...}' | --cfg @file.json] [--json] [--out file.json] [--threads n]
# bought bonuses (bonus1, bonus2) x pick policy (first, best, none) x gamble (bank, take), same random numbers across policies. Positional: runs per kind and policy, seed.
nice -n 10 node games/coldcall-sim.js --bonus [runs=2000000] [seed=1] [--bet 100] [--cfg ...] [--json] [--out file.json]
```
- `--cfg` merges into `CFG` as before, so every knob is reachable: `--cfg '{"pull":{"fill":{"dead":1.0,"win":0.5},"list":60,"pick":{"mult":{"silver":1.5}}}}'`.
- Shaman: `ssh shaman` then run from `E:\bricklord-test`-style scratch, NOT C:; example full run: `CC_MAX_THREADS=24 node games/coldcall-sim.js --pull 20000 2000 1 --json --out pull_full.json` (40M paid spins; each Callback is a whole bonus so a pull spin costs about 3x a plain spin).
- Paid spins are what counts: Callback rounds are free and are not in the denominator. Payback = (base cluster + base phone + natural bonus + Callback bonus + ONE MORE CALL net + pot slice) / stake.
- CI = 95% from the spread of batch means (20 or more batches of sessions, same seed scheme as the other modes: seed per batch from `seedOf(baseSeed, k)`, thread count never changes the result).
- `--pickpolicy`: `first` = the engine's safe default (first hot square), `best` = the hot square with the most hot neighbours (an upsell reaches most leads; a real player's heuristic), `none` = pick off (`pull.pick.on=false`). `--more bank` = hang up, `take` = always take the gamble.
- Warm attribution: unless `--nowarmdiff`, every batch is run twice on the same seed, the second time with `pull.warm.chance = 0`. The TOTAL diff is noisy (the Callback and bonus tails dominate); read the "base phone part alone" figure for the clean number.
- Pot: simulated the way the server will run it (`potSlice` per paid spin, `potHitChance` roll, prize = min(bal, maxPayX x bet), seed after a hit), one shared pot per batch. The RTP part reported for the pot is `feedBps/10000` by design (it assumes the pot pays back what it takes); `paid out` below it is the measured share and is lower only because the pot still holds money at the end of a short run.
- Output fields (`--json`): `parts` (pct + ci each), `rtpPct`, `callback` (arms, per 100 spins, spinsPer mean/p10/median/p90, avgBonusX), `deadShare`, `leads` (per paid spin, value per lead), `warm`, `ghost`, `decisions`, `pot`.

## What the PROVISIONAL knobs do (smoke, seed 1; read before tuning)

1. **Total payback is about 315%, not 98%.** The Callback is a free bonus1 every ~47 paid spins (fill 1.2 dead / 0.6 win, list 50) and bonus1 is worth about 82x plain, so the Callback part alone is about 200% of stake. The knob that moves it most is `list` and the fills: for a Callback part of ~5% of stake at ~90x per bonus the list needs to fill about once per 1,900 paid spins (about 40x fewer leads per spin), or the Callback needs a much smaller bonus (a bonus with its own cheaper table). That is the levers agent's job; flagging it because it is the whole budget.
2. **PICK is worth +19% on bonus1 and +4.8% on bonus2 at the default `pick.mult`** (first-square default; `best` +31% / +7.5%): bonus1 avg 98.1x (first) / 107.6x (best) vs 82.2x with pick off, bonus2 288.8x / 296.4x vs 275.6x (`--bonus`, 20k runs, CI about +-3 to +-5x). Dropping bronze (mult 0) is the main cause.
3. **Bonus BUYS take the decisions too** (contract: decisions apply to buy bonuses), so a bought bonus1 now has an average value of 98x against its price of 84.9x: buy RTP about 115% unless the price moves or `pick` is switched off for buys. The engine does not do this yet (one switch away: tell me if you want `pull.pick.onBuy=false`), the buy prices in `CFG.buyCost` are the legacy ones.
4. **ONE MORE CALL** is a fair 49% coin (`take` wins 48.7 to 49.4% in the smoke, 49.0% expected) and costs the 2% by design (take: -1.1x on bonus1, -3.6x on bonus2 in the `--bonus` run, inside noise). It is offered on 92 to 96% of bonuses.
5. **WARM adds about +5.8% of stake to the base phone part** (25.4% with, ~19.6% without) at chance 0.35 / cap 4: a big lever, and warm hits also turn dead spins into paid ones, so the list fills about 0.09 leads per spin slower.
6. **GHOST shows on about 26 of every 100 paid spins** (marked squares are common) with an average "would have closed" of 3.9x and >= 1x on 71% of those: honest (it is the real phone feature) but frequent and generous; `ghost.maxWinTenths` (shown only if the base pay is under that) and `ghost.minTenths` are the knobs.
7. **Pot at defaults** (`feedBps 50`, one in 20000 per dollar): about 50 to 60 hits per 1M spins, average pot at a hit about 41x to 56x the bet in this one-player-per-pot sim (the real pot is fed by everybody, so it is much larger per hit).

## Smoke output (this box, 2 threads, nice 10)

Default knobs, `--pull 250 2000 1`:
```
COLD CALL --pull: 260 sessions x 2000 paid spins = 520000 paid spins, flat bet 100c, pick first, gamble bank, seed 1, 2 threads, 20 batches, 6.1s
  total payback   314.399% +- 9.472 (95%, by batch means, per PAID spin; Callback rounds are free)
  by part         base clusters 28.83%  base phone 25.39%  natural bonus 56.30% (+-5.304)  Callback bonus 203.38% (+-6.464)  ONE MORE CALL net 0.000% (+-0.000)  pot slice 0.50%
  Callback        2.108 per 100 paid spins; spins per Callback mean 46.8  P10 45  median 47  P90 49; avg Callback bonus 96.57x
  spins           dead 77.94%  paid base 21.74%  natural bonus 1 in 215  cap hits 1  leads worked 1.069 per paid spin  value per lead 1.9023x bet (Callback part 203.38% of stake)
  warm            marked-no-phone spins 40.58 per 100; warm squares created 0.599 per spin; spins starting with warm 29.34 per 100; phone features fired on warm squares 1.985 per 100 (avg pay 5.77x)
  warm payback    with 314.399%  without (chance 0) 314.656%  -> total differs by -0.257% +- 8.435 (95%, batches of the same seeds; noisy: Callback and bonus tails); base phone part alone 5.789% +- 1.099; leads per spin -0.0869 (warm hits turn dead spins into paid ones)
  ghost           25.94 per 100 spins; avg shown 3.88x; pay > 0 97.7%; >= 1x 71.2%; >= 10x 7.69%; max 1003.7x
  decisions       picks 2.366 per 100 spins; ONE MORE CALL offered 2.378 per 100, taken 0.000 per 100
  pot             59.6 hits per 1M spins; avg pot at hit 41.23 (bet units: 41.2x bet); fed 0.500% of stake, paid out 0.246%
```

`--pull 250 2000 1 --pickpolicy best --more take --nowarmdiff`:
```
COLD CALL --pull: 260 sessions x 2000 paid spins = 520000 paid spins, flat bet 100c, pick best, gamble take, seed 1, 2 threads, 20 batches, 4.0s
  total payback   327.790% +- 15.941 (95%, by batch means, per PAID spin; Callback rounds are free)
  by part         base clusters 28.90%  base phone 25.94%  natural bonus 58.79% (+-4.594)  Callback bonus 217.63% (+-9.992)  ONE MORE CALL net -3.972% (+-8.087)  pot slice 0.50%
  Callback        2.109 per 100 paid spins; spins per Callback mean 46.8  P10 45  median 47  P90 49; avg Callback bonus 103.25x
  spins           dead 77.97%  paid base 21.70%  natural bonus 1 in 210  cap hits 2  leads worked 1.069 per paid spin  value per lead 2.0352x bet (Callback part 217.63% of stake)
  warm            marked-no-phone spins 40.59 per 100; warm squares created 0.599 per spin; spins starting with warm 29.31 per 100; phone features fired on warm squares 1.956 per 100 (avg pay 5.82x)
  ghost           26.01 per 100 spins; avg shown 3.89x; pay > 0 97.8%; >= 1x 71.3%; >= 10x 7.63%; max 1004.0x
  decisions       picks 2.374 per 100 spins; ONE MORE CALL offered 2.383 per 100, taken 2.383 per 100, win rate 49.35%
  pot             59.6 hits per 1M spins; avg pot at hit 41.23 (bet units: 41.2x bet); fed 0.500% of stake, paid out 0.246%
```

Legacy-equivalence check: every PULL mechanic off (`list` huge, warm/ghost/pick/more off, no daily). Must match the legacy engine (RTP parts: clusters 29.0, base phone 20.2, bonuses ~49); it does (legacy `--strat` run on the same box: 98.1% +- 1.6; here 97.0% +- 4.0 including the 0.5% pot slice, clusters 28.97 vs 29.03, phone 20.25 vs 20.18):
```
nice -n 10 node games/coldcall-sim.js --pull 500 2000 1 --nowarmdiff --cfg '{"pull":{"list":1000000000,"warm":{"chance":0},"ghost":{"on":false},"pick":{"on":false},"more":{"on":false},"daily":{"base":0,"perStreak":0}}}'
COLD CALL --pull: 500 sessions x 2000 paid spins = 1000000 paid spins, flat bet 100c, pick first, gamble bank, seed 1, 2 threads, 20 batches, 5.9s
  total payback   97.033% +- 3.965 (95%, by batch means, per PAID spin; Callback rounds are free)
  by part         base clusters 28.97%  base phone 20.25%  natural bonus 47.31% (+-4.006)  Callback bonus 0.00% (+-0.000)  ONE MORE CALL net 0.000% (+-0.000)  pot slice 0.50%
  Callback        0.000 per 100 paid spins; spins per Callback mean n/a  P10 0  median 0  P90 0; avg Callback bonus n/ax
  spins           dead 79.35%  paid base 20.32%  natural bonus 1 in 215  cap hits 1  leads worked 1.076 per paid spin  value per lead 0.0000x bet (Callback part 0.00% of stake)
  warm            marked-no-phone spins 18.75 per 100; warm squares created 0.000 per spin; spins starting with warm 0.00 per 100; phone features fired on warm squares 0.000 per 100 (avg pay n/a)
  ghost           0.00 per 100 spins; avg shown n/a; pay > 0 n/a; >= 1x n/a; >= 10x n/a; max 0.0x
  decisions       picks 0.000 per 100 spins; ONE MORE CALL offered 0.000 per 100, taken 0.000 per 100
  pot             47.0 hits per 1M spins; avg pot at hit 56.45 (bet units: 56.4x bet); fed 0.500% of stake, paid out 0.265%
```

`--bonus 20000 1`:
```
COLD CALL --bonus: 20000 bought bonuses per kind and policy (common random numbers across policies), seed 1, bet 100c, 22.0s
  bonus1: pick policy / gamble -> average value (95% CI), sd, P(cap), P(>=100x), P(>=1000x), offers per bonus, gamble win rate
    first bank  avg 98.086x (+-3.017)  sd 217.7x  cap 1 in 4000  >=100x 29.92%  >=1000x 0.395%  offers 0.923  take wins n/a
    first take  avg 96.963x (+-3.438)  sd 248.1x  cap none  >=100x 29.21%  >=1000x 0.860%  offers 0.924  take wins 49.12%
    best  bank  avg 107.601x (+-3.274)  sd 236.2x  cap 1 in 5000  >=100x 32.55%  >=1000x 0.590%  offers 0.923  take wins n/a
    best  take  avg 104.454x (+-3.899)  sd 281.4x  cap 1 in 20000  >=100x 30.09%  >=1000x 1.120%  offers 0.924  take wins 49.27%
    none  bank  avg 82.193x (+-1.931)  sd 139.3x  cap none  >=100x 24.62%  >=1000x 0.275%  offers 0.923  take wins n/a
    none  take  avg 82.579x (+-3.000)  sd 216.4x  cap none  >=100x 25.18%  >=1000x 0.690%  offers 0.924  take wins 49.43%
  bonus2: pick policy / gamble -> average value (95% CI), sd, P(cap), P(>=100x), P(>=1000x), offers per bonus, gamble win rate
    first bank  avg 288.784x (+-4.546)  sd 328.0x  cap 1 in 5000  >=100x 77.90%  >=1000x 2.205%  offers 0.958  take wins n/a
    first take  avg 285.145x (+-7.155)  sd 516.3x  cap 1 in 10000  >=100x 43.79%  >=1000x 7.120%  offers 0.959  take wins 49.12%
    best  bank  avg 296.367x (+-4.764)  sd 343.7x  cap 1 in 5000  >=100x 78.59%  >=1000x 2.405%  offers 0.956  take wins n/a
    best  take  avg 282.341x (+-7.059)  sd 509.3x  cap 1 in 10000  >=100x 43.87%  >=1000x 6.975%  offers 0.958  take wins 48.73%
    none  bank  avg 275.645x (+-4.436)  sd 320.1x  cap 1 in 5000  >=100x 75.87%  >=1000x 2.010%  offers 0.958  take wins n/a
    none  take  avg 265.905x (+-6.679)  sd 481.9x  cap 1 in 20000  >=100x 42.87%  >=1000x 6.350%  offers 0.957  take wins 48.94%
```
