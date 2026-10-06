# COLD CALL engine v2 (Le Bandit rules, Cold Call names)

Branch `coldcall-v2`. Files: `games/coldcall-engine.js` (math, pure), `games/coldcall.js` (server module), `games/coldcall-sim.js` (worker-thread sim),
`tests/coldcall.js`, `public/games/coldcall/engine.js` (byte-identical copy of the engine, for the browser; the front end must NOT use it for any math).
**This file is the contract the front-end builder codes against.** Sections 2 and 3 are the exact contract; 5 and 6 are the final config and measured numbers; 7 and 8 are my rule decisions and what is unverified.

## 1. Rules as built

Grid 6 columns x 5 rows. A win is a cluster of 5+ of the same symbol connected up/down/left/right; `closer` (wild) substitutes for any of the 10 regular symbols.

- **Super cascade.** When wins form, every position in a winning cluster is removed AND every other symbol of a winning symbol type anywhere on the grid.
  A wild is removed only if it sat in a winning cluster. Symbols fall straight down, new symbols drop in from the top, repeat while wins form.
  `bell` and `phone` are never removed; they fall like the rest.
- **Hot leads** (their Golden Squares). Every position that was part of a win (cluster cells including wilds; NOT the swept off-cluster symbols) is marked. Marks belong to
  the SQUARE, not the symbol: they stay while symbols fall.
- **Phone feature.** When no more wins form (cascade over), if at least one `phone` is on the grid and at least one square is hot, every hot lead activates and reveals one of:
  a quote bubble (value in x bet), an UPSELL (multiplier), or THE CLOSE.
  1. Reveal: every active square draws one outcome.
  2. Upsells apply first, in reading order (top to bottom, left to right). An upsell multiplies the bubbles and closes on adjacent hot squares (4 neighbours: up/down/left/right;
     `CFG.adjacency` = 8 adds the diagonals). Several upsells next to one square MULTIPLY (x2 then x3 = x6). Upsells do not touch upsells or squares that are not hot leads.
     A close that has not collected yet stores the multiplier and applies it to what it collects; a close that has already collected has its value multiplied.
  3. Closes collect in reading order. A close takes the sum of every bubble value plus every other close that has already collected (value x its stored multiplier).
  4. If this round produced at least one close, every hot lead that is NOT a close activates AGAIN (new reveal, replacing the old one) and 1-3 repeat. Only closes revealed in the
     latest round collect; earlier closes keep their value. The loop ends when a round reveals no new close (or at `CFG.maxRevealRounds`).
  5. Pay = sum of all bubble values currently on the board + all close values. (Bubbles that were replaced by a re-reveal pay nothing; their value lives on in the close that took it.)
- **Base spin**: hot leads are cleared at the end of the spin.
- **Bells**: counted on the final grid of a spin (after all cascades, so every bell that landed in the spin counts; bells never leave).
  Base spin: 3 bells = bonus 1, 4 = bonus 2, 5 or more = bonus 3. 2 bells = a tease, nothing happens. Bells pay nothing by themselves.
- **Bonus 1 DIALING FOR DOLLARS**: 8 free spins. Hot leads stay between spins until a phone activates them, then clear.
- **Bonus 2 ALWAYS BE CLOSING**: 12 free spins. Hot leads stay for the whole bonus, even after being activated (every phone re-reveals all of them).
- **Bonus 3 QUOTE ACCEPTED**: 5+ bells, 12 free spins, cannot be bought. Hot leads stay all bonus, a phone is guaranteed on every spin (it is placed in the starting grid), no bronze bubbles.
- **In a bonus**, bells are counted at the end of each spin: 2 bells = +2 spins, 3 bells = +4 spins; 4+ bells in bonus 1 = upgrade to bonus 2 with +4 spins (4+ bells in bonus 2/3 = +4 spins).
  Total free spins are capped at `CFG.maxSpins` (40). The upgrade applies from the NEXT spin; hot leads carry over.
- **Max win 10,000x bet**, enforced: the round stops paying at the cap. In the script: `capped: true` on the round, and on the step / spin / bonus where it happened; nothing is played after it.
- **Buys** (`buyBonus` ids): `call` = one base spin with a guaranteed phone; `bonus1`; `bonus2`; `hunt` = one base spin at a higher price with about 5x the bonus chance (bell weight multiplied).
  Prices are `CFG.buyCost[id]` in tenths of the bet (price in cents = tenths x bet / 10).
- **Money**: every pay is a whole number of TENTHS of the bet (min cluster 0.1x, min bubble 0.2x). Bet levels `[10, 20, 50, 100, 200, 500, 1000, 2500]` cents are all multiples of 10 cents,
  so `cents = tenths * bet / 10` is an exact integer. No floats on the money path. The server ignores anything the client sends except bet, mode, buyBonus (and `force` when the QA hook is on).

## 2. Ids and units (every number in a script is an integer)

- Position `p` = `row * 6 + col`, row 0 on top, col 0 on the left. 0..29. "Reading order" = ascending `p`.
- Symbol ids (in `grid` arrays): `0 mug, 1 note, 2 ball, 3 can, 4 cups` (low), `5 headset, 6 rx, 7 pile, 8 cashwad, 9 cash` (high), `10 closer` (wild), `11 bell` (scatter), `12 phone` (rainbow).
  Exported as `ColdCallEngine.SYM` (array of names; index = id).
- Money: tenths of the bet. `10` = 1.0x. Bubble values: bronze 2,5,10,20,30,40 (0.2 .. 4x), silver 50,100,150,200 (5 .. 20x), gold 250,500,1000,2500,5000 (25 .. 500x).
- Tier `t`: 0 bronze, 1 silver, 2 gold. Upsell multipliers: 2,3,4,5,10.

## 3. The script

`resolveRound(rng, buy, opts)` (exported; also on the server) returns
`{ round, buy, costTenths, winTenths, winX, capped, tier, script }`. The server sends `script` to the client. Everything below is inside `script`.

```
script = {
  v: 2, buy: null|'call'|'bonus1'|'bonus2'|'hunt',
  costTenths, winTenths,                 // winTenths = min(spin.win + bonus.winTenths, maxWinTenths)
  tier: 'none'|'nice'|'sweet'|'big'|'huge'|'mega'|'legend',   // from winX: 2,5,10,25,50,100
  capped: bool, maxWinTenths: 100000,
  parts: { cluster, phone, bonus },      // tenths; cluster + phone = spin.win, bonus = bonus.winTenths (before the cap clamp of the total)
  spin:  SpinScript | null,              // the base spin; null for bonus1 / bonus2 buys
  bonus: BonusScript | null              // null unless 3+ bells landed (or a bonus buy)
}
```

**SpinScript** (a base spin, or one free spin):

```
{ mode: 'base'|'bonus1'|'bonus2'|'bonus3',
  grid: [30 symbol ids],                 // the grid the spin starts with (what the reels show first)
  gp: position|-1,                       // where a guaranteed phone was placed (bonus3 / call buy) or -1; grid already includes it
  hotIn: [p...],                         // hot leads carried IN from the previous free spin (always [] in base)
  steps: [ Step... ],                    // cascade steps, in order; [] if the first grid has no win
  bells: n, phones: n,                   // on the final grid
  phone: PhoneScript | null,             // null unless a phone and >= 1 hot lead are on the board when the cascade ends (and not capped)
  hotOut: [p...],                        // hot leads carried OUT (base: []; bonus1: [] if a phone fired else all; bonus2/3: all)
  cluster, phoneTenths, win,             // win = cluster + phoneTenths (the cap may have clamped it)
  capped: bool,
  // free spins only (BonusScript.spins[i]):
  n: 1-based spin number, added: spins added by this spin's bells, upgrade: bool (bonus1 -> bonus2 starts next spin),
  left: free spins left after this spin (added included), bonusTotal: running bonus total after this spin (tenths)
}
Step = {
  wins: [ { sym, pos: [p...], pay } ],   // every cluster that paid (sym = regular symbol id; pos include the wilds in it); pay in tenths
  pay,                                   // sum of the clusters (clamped to what the cap allows)
  removed: [p...],                       // every position removed: cluster cells + same-type sweep (ascending)
  falls: [ [fromP, toP]... ],            // surviving symbols that moved down
  fresh: [ [p, symId]... ],              // new symbols dropping in (positions are the empty top cells of each column)
  grid: [30],                            // the grid after the drop (redundant with falls + fresh; use whichever you animate)
  hot: [p...],                           // ALL hot leads so far (ascending), including this step's wins and carried-in leads
  capped?: true                          // present on the last step if the cap was reached
}
PhoneScript = {
  leads: [p...],                         // the squares that activate (= the last step's hot, or hotIn if the spin had no win)
  rounds: [ Round... ],                  // at least 1
  pay,                                   // tenths: all bubbles + all closes on the board at the end (clamped by the cap)
  capped: bool
}
Round = {
  reveals: [ { p, k: 'b', v, t } | { p, k: 'u', v } | { p, k: 'c', v: 0 } ],
                                         // one per active square, ascending p. 'b' bubble (v tenths, t tier), 'u' upsell (v = multiplier), 'c' close
  upsells: [ { p, m, hits: [ { p, k: 'b'|'c', before, after, pend? } ] } ],
                                         // one per 'u' reveal, in reading order, applied in this order. hits = adjacent hot squares that were bubbles/closes, ascending p.
                                         // k:'b' before/after are bubble values. k:'c' with pend:1 = a close that has not collected yet: before/after are its stored multiplier (1 -> m);
                                         // k:'c' without pend = an already collected close: before/after are its value. Later upsells see the values changed by earlier ones.
  collects: [ { p, m, took, value, run } ]
                                         // one per NEW close of this round, in reading order. took = sum of all bubbles + collected closes at that moment (after all upsells),
                                         // m = the close's stored multiplier, value = took * m (the close's value now), run = total value on the board right after this collect
}
```
The next round (if any) reveals exactly the leads that are NOT closes (closes keep their value). The last round has `collects: []` (or the loop cap or "no non-close lead left" ended it).

**BonusScript**:

```
{ kind: 'bonus1'|'bonus2'|'bonus3',      // the kind it STARTED as
  startSpins: 8|12|12,
  spins: [ SpinScript... ],              // free spins in order (mode on each spin says which rules it ran under; after an upgrade it reads 'bonus2')
  totalSpins,                            // start + all added (<= 40); spins.length === totalSpins unless capped
  upgraded: bool,
  winTenths,                             // sum of spin wins, clamped to what the cap left
  capped: bool }
```

### Worked example (one base spin; 2 round phone feature; grid shown as rows)

Start grid (`spin.grid`), mug mug WILD mug mug in the top row, a phone bottom right:

```
 0, 0,10, 0, 0, 2
 3, 4, 1, 2, 3, 4
 1, 2, 3, 4, 1, 2
 3, 4, 1, 2, 3, 4
 1, 2, 3, 4, 1,12
```
```
steps[0] = { wins:[{sym:0, pos:[0,1,2,3,4], pay:1}], pay:1, removed:[0,1,2,3,4], falls:[],
             fresh:[[0,1],[1,2],[2,3],[3,4],[4,1]], grid:[1,2,3,4,1,2, 3,4,1,2,3,4, ...unchanged...], hot:[0,1,2,3,4] }
phone = { leads:[0,1,2,3,4], pay:63, capped:false, rounds:[
  { reveals:[ {p:0,k:'u',v:3}, {p:1,k:'b',v:10,t:0}, {p:2,k:'c',v:0}, {p:3,k:'b',v:20,t:0}, {p:4,k:'b',v:5,t:0} ],
    upsells:[ {p:0, m:3, hits:[ {p:1,k:'b',before:10,after:30} ]} ],          // square 1 is right of the upsell; square 6 below it is not hot
    collects:[ {p:2, m:1, took:55, value:55, run:110} ] },                     // 30 + 20 + 5 = 55; board now: bubbles 55 + close 55
  { reveals:[ {p:0,k:'b',v:2,t:0}, {p:1,k:'b',v:2,t:0}, {p:3,k:'b',v:2,t:0}, {p:4,k:'b',v:2,t:0} ],   // the non-close leads re-reveal; no new close: done
    upsells:[], collects:[] } ] }
cluster = 1, phoneTenths = 63 (close 55 + four 0.2x bubbles), win = 64, hotOut = []
```

### Replay recipe for the front end (no math of its own)
1. Show `spin.grid`. For each `step`: pulse `wins[].pos` and show `wins[].pay`; mark `hot` squares (new ones are `hot` minus the previous step's `hot`); remove `removed`; animate `falls` then `fresh`;
   (or just set `step.grid`). 2. After the last step, if `phone`: for each round, flip the squares in `reveals`, animate each `upsells[]` entry (`hits` carry before/after),
   then each `collects[]` entry (fly the `took` into the close, show `value`). Show `phone.pay`. 3. `hotOut` = squares that stay lit into the next free spin.
4. If `script.bonus`: intro for `bonus.kind` (bells that triggered it are `spin.bells`), then play `bonus.spins` in order; show `added` / `upgrade` / `left` / `bonusTotal` as you go.
5. `winTenths * bet / 10` is the payout in cents; `capped` = show the max-win message. The server's `wallet` push is the balance source of truth.

## 4. Server (games/coldcall.js)

Events unchanged from v1: `g:coldcall:state` (reply: `betLevels, modes, rtp, maxWinX, buyCostX {call, bonus1, bonus2, hunt} in x bet, wallet/balances, bets, qaHook?`),
`g:coldcall:history` (last 20), `g:coldcall:spin` `{ bet, mode: 'play'|'ledger', buyBonus?: 'call'|'bonus1'|'bonus2'|'hunt'|null, force? }` (150 ms rate limit per socket).
Reply `g:coldcall:result`: `{ roundId, bet, cost, mode, buyBonus, script, costTenths, totalWinTenths, totalWinMult, totalWin, tier, maxed, wallet, balances, forced? }`.
Order inside one synchronous handler: resolve round (pure) -> `wallet.spend(cost)` -> `wallet.credit(totalWin)`.
QA hook (`COLDCALL_TEST=1` and `NODE_ENV !== 'production'`, gated exactly as before): `force` in a spin payload is one of `bonus1, bonus2, bonus3, phone, close, big, tease`; ignored on buys.
`bonus1/2/3` = 3 / 4 / 5 bells land (and exactly that many, no more); `phone` = a phone feature with >= 4 hot leads; `close` = a feature with a close and a second reveal round;
`big` = the round pays >= 25x; `tease` = exactly 2 bells, no bonus. They are real engine rounds (bells placed, or whole rounds re-rolled with the real rng), through the normal spend/credit path.

## 5. Final config (all in the `CFG` block at the top of `games/coldcall-engine.js`)

| Lever | Value |
|---|---|
| Regular symbol weights per cell (mug note ball can cups headset rx pile cashwad cash) | 35.9, 29, 22, 17, 12.2, 8.2, 6.2, 4.5, 3.2, 2.2 (skewed low: this is what makes the hit rate about 32%) |
| closer / bell / phone weight per cell, base | 1 / 1.567 / 0.1945 |
| closer / bell / phone weight per cell, bonus1, bonus2 | 1 / 1.567 / 4.5 |
| closer / bell / phone weight per cell, bonus3 (a phone is also forced into every starting grid) | 1 / 1.567 / 3 |
| Cluster pay, tenths of bet, sizes 5,6,7,8,9,10,11,12,13+ | mug 1,3,6,9,14,21,32,69,150 ... cash 10,23,46,81,138,230,402,805,1000 (5 pays 0.1x..1x, 13+ pays 15x..100x; full table in the file) |
| Reveal weights base (bronze / silver / gold / upsell / close) | 100 / 2.5 / 0.2 / 6 / 1 |
| Reveal weights bonus1 | 100 / 7.5 / 0.5 / 7 / 0.55 |
| Reveal weights bonus2 | 100 / 7.5 / 0.5 / 7 / 0.22 |
| Reveal weights bonus3 (no bronze; its own value weights: silver 75/15/7/3 %, gold 60/25/10/4/1 %) | 0 / 5.5 / 0.05 / 0.5 / 0.004 |
| Value weights inside a tier (all other modes) | bronze 30/28/20/10/7/5, silver 40/30/18/12, gold 45/30/17/6/2 |
| Upsell multiplier weights (x2 x3 x4 x5 x10) | 40 / 28 / 17 / 10 / 5 |
| Upsell adjacency | 4 |
| Free spins | bonus1 8, bonus2 12, bonus3 12; +2 for 2 bells, +4 for 3 bells, upgrade +4; cap 40 total |
| Hard caps | 40 cascades per spin, 30 reveal rounds, 40 (+2) free spins; the 10,000x cap |
| Hunt | bell weight x1.85 on one base spin |
| Buy prices (tenths of bet) | call 46, bonus1 513, bonus2 2971, hunt 41 |

## 6. Measured table (final config; every number below is from a run on exactly this config, commit of this file)

Method. The sim is `games/coldcall-sim.js` on 6 worker threads, `nice -n 10`, seeds split per 1M-spin chunk (independent 128-bit rng streams).
- **RTP and parts: stratified estimator** (`--strat`), like `games/bender-rtp.js`: RTP = E[base spin pay (clusters + phone)] + sum over bonus kinds of P(bell trigger of that kind) x E[that bonus, sampled directly from a fresh start].
  Variance includes the covariance of the base pay with the trigger kind and each bonus's own sampling error. 450,000,000 base spins + 8,000,100 bonus runs of each kind, seed 202, 875 s (14.6 min) locally.
- **Frequencies, hit rate, tails, cap hits: plain full-round sim** (every spin is a real paid round, bonus included), 200,000,000 spins, seed 303, 230 s.
- **Buys**: average value of 5,000,000 rounds per buy to set the price, then a fresh 5,000,000-round run at that price (seed 505), then 100,000,000 rounds each for `call` and `hunt` (seed 606) because their intervals were too wide at 5M.

| Measure | Result |
|---|---|
| **Total RTP (stratified)** | **98.10% +- 0.14 (95%)** (target 98.0 +-0.3, interval at most 0.15: met) |
| Total RTP, plain 200M cross-check | 97.94% +- 0.26 (95%): agrees |
| By part (stratified) | clusters (base) 21.33%, base phone feature 25.74%, bonus 1 29.38% (+-0.05), bonus 2 15.16% (+-0.06), bonus 3 6.49% (+-0.10). Bonuses together 51.0% |
| Hit rate (plain) | any win 32.22%; base cluster win 31.91% (Le Bandit 32.47%) |
| Any bonus | 1 in 156.2 spins (bonus 1: 1 in 171, bonus 2: 1 in 1,918, bonus 3: 1 in 25,862) |
| Bonus average value (natural triggers; stratified) | bonus 1 50.28x (+-0.06), bonus 2 290.80x (+-0.19), bonus 3 1,679x (+-0.74). Average free spins played per bonus: 9.4 (bonus 1: 9.0 incl. 0.4% upgraded to bonus 2) |
| Phone feature in the base game | fires on 1.70% of spins (1 in 58.7); average 8.3 hot leads; 0.048 closes per feature |
| Cascades | 1.36 per winning base spin |
| Max win seen | 10,000x (the cap) |
| Cap hits | plain: 51 in 200,000,000 spins = 1 in 3.9M (21 base-only, 12 bonus 1, 6 bonus 2, 12 bonus 3). Stratified cross-check: base-only 36 in 450M (1 in 12.5M) + bonus caps = about 1 in 4.3M overall. Target "not routine, at most 1 in 2M": met |
| Tail, share of spins paying (plain 200M) | >= 100x: 0.125% (1 in 800); >= 1,000x: 0.00452% (1 in 22,100; 9,041 spins); >= 5,000x: 0.00011% (1 in 909,000; 220 spins) |
| Bonus tails (stratified, per bonus) | bonus 1: >=100x 10.3%, >=1,000x 0.088%, >=5,000x 0.0043%, cap 1 in 78,400; bonus 2: 83.3%, 1.53%, 0.035%, cap 1 in 11,600; bonus 3: 97.8%, 72.6%, 1.06%, cap 1 in 1,100 |
| Script size | base spin avg 0.6 KB (max seen 20 KB); bonus 1 avg 4.8 KB; bonus 2 avg 10.7 KB (max 25 KB); bonus 3 avg 13.7 KB (max 34 KB). Resolve time per round under 1 ms average |
| Tests | `node tests/coldcall.js`: 46 passed (about 30 s); `node tests/bender.js`: 17 passed |

### Buy prices (price = measured average value / 0.98, rounded to a whole tenth of the bet, then re-simulated at that price)

| Buy | Measured avg value (run 1, 5M) | Price | Re-simulated RTP at that price |
|---|---|---|---|
| `call` (one spin, phone guaranteed) | 4.546x | 4.6x (46 tenths) | 98.61% +- 0.12 (100M rounds); 98.64% +- 0.53 (5M) |
| `bonus1` | 50.28x | 51.3x (513) | 98.04% +- 0.16 (5M) |
| `bonus2` | 291.12x | 297.1x (2971) | 97.95% +- 0.08 (5M) |
| `hunt` (one spin, bell weight x1.85) | 3.99x | 4.1x (41) | 98.36% +- 0.28 (100M); bonus on 3.12% of hunt spins = 4.9x the natural 0.64% |

The `call` and `hunt` RTP sit 0.3-0.6 pt above 98 because a 4.6x / 4.1x price rounded to a whole tenth is a coarse step (one tenth = 2.2% of the price); that is the rounding the brief asked for.
Caps in buys: bonus2 buy hits the cap on 0.0094% of buys (469 in 5M, by design: it is a bonus 2 start); hunt 1 in 840,000 hunts; call 1 in 930,000 calls.

## 7. Rule decisions where the brief was silent

1. **Close semantics.** A close collects bubbles + other already-collected closes, times its stored upsell multiplier. In a repeat round only the NEW closes collect; old closes keep their value (an upsell revealed next to an old close
   multiplies its value). Bubbles replaced by a re-reveal are gone (paid only through the close that took them). A re-reveal replaces upsells too.
2. **Upsell stacking** multiplies. Adjacency is **4** (the brief's lever allowed it): with 8 neighbours, on an early config, base phone feature was 34.6% RTP vs 24.2% and bonus 2 averaged 381x vs 223x
   with a cap hit on 1 run in 171 vs 1 in 1,087. I did not re-tune a full config around 8. The lever is still `CFG.adjacency`.
3. **Every individual value is clamped at the 10,000x cap** while computing (so a chain of closes cannot overflow); the round win is then clamped again.
4. **Bells** are counted on the final grid of the spin and pay nothing by themselves. 5, 6, ... bells all start bonus 3. In a bonus 2 or 3, 4+ bells give +4 spins (same as 3). Upgrade applies from the next spin.
5. **Phone feature trigger** = a phone on the final grid AND at least one hot lead (a phone alone does nothing). In bonus 1 a phone activates carried leads even on a spin with no win.
6. **The spin that triggers a bonus** plays its own phone feature and pays; its hot leads are then cleared, the bonus starts empty.
7. **Bonus 3 / `call` guaranteed phone**: if the starting grid has no phone, one replaces a random non-bell cell (`gp` in the script). Phones never leave, so one is on the board when the cascade ends.
8. **Cap behaviour**: when the cap is reached inside cascades, that step is the last one scripted (removal and drop included), no phone feature and no bonus follow. Inside a phone feature the pay is clamped.
   Inside a bonus, the spin that reaches it is the last one. `capped` is true whenever the win equals the cap.
9. **Bonus 3 reveal values** use their own value weights (heavier on the low silver and gold values) because with no bronze every bubble is at least 5x; the shared weights made bonus 3 average 9,000x.
10. **`hunt`** is my design of the optional buy: one base spin with the bell weight x1.85 (everything else normal), price from its measured value.
11. **QA forces**: `bonus1/2/3` and `tease` place exactly 3/4/5/2 bells in the starting grid and draw refills without bells; `phone`, `close`, `big` re-roll whole real rounds (up to 200,000 tries) until the condition holds.
12. **Hit rate** = share of paid spins that return more than 0. Bonus parts in the sim are attributed to the bonus kind that STARTED (an upgraded bonus 1 stays in bonus 1).
13. **Pay table**: 13+ is one bucket (a 30-cell cluster pays the same as a 13).

## 8. Unverified / open

- **The front end has not been run against this contract.** `public/games/coldcall/game.js` is still the v1 board and will not work. The script contract is only checked by `tests/coldcall.js`' independent replayer, which I also wrote
  (it re-derives clusters, sweeps, gravity, hot leads, reveals, upsells, closes and bonus bookkeeping from the rules, but a shared misreading of a rule would pass both).
- **Nothing here is checked against the real Le Bandit.** Rules are the brief's; symbol weights, pay table, reveal weights are mine. Hit rate and bonus frequency are in Le Bandit's range, nothing more is claimed.
- The RTP numbers are the sim measuring its own engine (sfc32 streams, independent per chunk). The stratified estimator assumes a bonus does not depend on the spin that triggered it (true: it starts from an empty board)
  and ignores the cap interplay between the base pay and the bonus (at most a few 1e-6 of a bet; capped rounds are about 2e-7 of spins).
- Cap-hit rates are small-count estimates (51 events in the plain run: about +-14%). The stratified cross-check agrees (1 in 4.3M vs 1 in 3.9M).
- `call` and `hunt` caps per round are higher than a normal spin's because those rounds carry more bonus chance; they are 1 in 930k and 1 in 840k of those buys.
- Server tests use fake sockets (as v1); the real `server.js` / socket.io path and `tests/e2e` were not run.
- The tests' RTP/buy checks are wide bands (the sim is the precise figure); they guard against a broken config, not against a 1 pt drift.

## 9. How to run

```
node tests/coldcall.js                                   # 46 tests, about 30 s, no node_modules needed
nice -n 10 node games/coldcall-sim.js --strat 450000000 8000000 202   # stratified RTP + parts + bonus table (about 15 min)
nice -n 10 node games/coldcall-sim.js 200000000 303      # plain rounds: hit rate, frequencies, tails, cap hits (about 4 min)
nice -n 10 node games/coldcall-sim.js --buys 5000000 404 [--only call,hunt]   # buy values and RTP at the configured prices
# any of them: --cfg '{"extra":{"base":{"phone":0.2}}}' overrides levers (objects merge); --threads N (max 6); --out file.json
```
