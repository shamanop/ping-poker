# THE PULL wave 1: money critic (Opus, independent)

Reviewed: `git diff 45e3252..a98fb53 -- games/coldcall.js games/coldcall-store.js games/coldcall-engine.js` (+ `games/coldcall-sim.js`, lower priority).
Run from a private copy of a98fb53 in `/tmp/pull-critic-opus` (repro scripts in `/tmp/pull-critic-opus/_crit/`). Nothing was run, edited or committed in the worktree.
Status: FINAL.

Ranked most severe first.

---

## F1. Warm squares are not tied to a bet: bet 10 cents until a square is warm, then bet $25.00. Payback 119 to 126%, in Chips too  -- REPRODUCED

- Where: `games/coldcall-engine.js:475-477` (`hot[p] = 1` for every `s.warm` on any paid base spin, whatever its bet), `:531` (`ns.warm = pull.warmOut`), state has no bet for the warm squares (`:122`); `games/coldcall.js:63` sends `warm` to the client in every state view and result, and `:215-220` takes `p.bet` freely on the next spin.
- Scenario: warm squares are created by one spin and cashed by the next. A spin that STARTS with warm squares is worth far more than it costs (any phone that lands fires the feature on them). The player sees `pull.state.warm` before spinning and may change the bet. So: spin at the smallest bet while the board is cold, switch to the largest bet whenever `warm.length > 0`. The squares earned for 10 cents are cashed at $25.00. Works per currency, so it mints Chips (the poker bank).
- Repro: `node _crit/r2-warm.js 4000000 nopick` (engine, sequential state, Callback and daily OFF, pick and gamble OFF, so this is the plain base game plus warm only):
```
paid base spins 4000000 (Callback off, daily off, pick default, gamble banked)
  warm squares at the start = 0: 2822949 spins (70.57%), payback 97.82%
  warm squares at the start = 1: 500175 spins (12.50%), payback 107.18%
  warm squares at the start = 2: 308834 spins (7.72%), payback 119.61%
  warm squares at the start = 3: 185965 spins (4.65%), payback 127.21%
  warm squares at the start = 4: 182077 spins (4.55%), payback 141.62%
  flat bet payback                     104.03%
  bet 10 cold / 2500 warm: staked 29708570, back 35274154, payback 118.73%, profit 5565584 dollars
```
  Same run with pick and gamble at their defaults (`node _crit/r2-warm.js 3000000`): warm 0 = 104.30%, warm 1 = 113.47%, warm 2 = 127.72%, warm 3 = 135.48%, warm 4 = 150.41%; bet-switch payback 126.19%.
- Tuning does not close it: lowering `warm.chance` only makes warm spins rarer, the payback of a spin that has k warm squares stays the same (107 to 142% above). Lowering base pays to bring the flat-bet total to 98% leaves the warm spins above 100% and the cold ones far below, which makes the switch more profitable, not less. The flat-bet sim cannot see it at all.
- Fix suggestion: store the bet with the warm squares (`warmBet`) and seed them as `hot` only on a spin at that same bet (a different bet = they go cold, shown plainly), or cap a warm-fired phone feature's pay at `min(bet, warmBet)`.

## F2. THE CALLBACK bet is floored to the bet level under the average: the daily gift (and any one smaller spin) cuts a big bettor's Callback by 50 to 60%  -- REPRODUCED

- Where: `games/coldcall-engine.js:125` (`cbLevel`: largest level `<= avg + 0.5`), `:133` (`st.cb = { bet: cbLevel(st.avg) }`), `:473` (daily leads worked at `min(bet, daily.stakeCap)` = 100 cents), `:134` (`carryOver` keeps the diluted `avg`).
- Scenario: a flat $25.00 bettor makes the first spin of the day. THE APPOINTMENT works 3 free leads at a stake of $1.00. That pulls the lead-weighted average under 2500, and `cbLevel` rounds DOWN to the next level, which is 1000. The Callback is played at $10.00, not $25.00. Carry-over keeps a few diluted tenths, so the SECOND Callback is also at $10.00. Flat $5.00 -> first Callback at $2.00. Flat $2.00 -> first Callback at $1.00. A single $10.00 spin inside a $25.00 list does the same.
  The "free" daily leads are worth about +6% of one list and cost 60% of the Callback: the gift has negative value for every bettor above $1.00. It gets worse after tuning: with a 2000-lead list one daily claim (3 leads of 2000) still drops a $25.00 bettor to $10.00 and a $5.00 bettor to $2.00, because the tolerance is 0.5 cents of average.
- Repro: `node _crit/r1-cbbet.js` (real server, real engine, Play $):
```
   spin 1 daily: {"leads":3,"streak":1}
flat 2500 (with the daily on spin 1)       -> Callbacks: [{"afterPaidSpins":49,"callbackBet":1000},{"afterPaidSpins":92,"callbackBet":1000},{"afterPaidSpins":138,"callbackBet":2500}] avg at last arm 2499.956
flat 500  (with the daily on spin 1)       -> Callbacks: [{"afterPaidSpins":49,"callbackBet":200},{"afterPaidSpins":92,"callbackBet":500},{"afterPaidSpins":138,"callbackBet":500}]
flat 200  (with the daily on spin 1)       -> Callbacks: [{"afterPaidSpins":49,"callbackBet":100},{"afterPaidSpins":92,"callbackBet":200},{"afterPaidSpins":138,"callbackBet":200}]
flat 100                                    -> Callbacks: [... "callbackBet":100 x3]
flat 2500, ONE spin at 1000 (spin 5)        -> Callbacks: [{"afterPaidSpins":49,"callbackBet":1000},{"afterPaidSpins":92,"callbackBet":1000},{"afterPaidSpins":138,"callbackBet":2500}]
flat 2500, daily leads set to 0             -> first Callback bet 2500
list of 2000 leads, flat 2500, ONE daily (3 leads at 100): avg 2496.402 -> cbLevel 1000
list of 2000 leads, flat 500,  ONE daily (3 leads at 100): avg 499.400 -> cbLevel 200
```
- Why it matters for money: the rounded-off part of the Callback is simply gone (not carried, not paid). The direction is against the player, so nobody gets rich, but real payback for anyone betting above $1.00 or mixing bets is well under what the flat-bet sim reports (the sim runs `--bet 100` by default, where the bug is invisible; with `--bet 500` and up the sim also counts the Callback in tenths of the nominal bet, see S1). The contract text (`largest BET_LEVEL <= avg + 0.5`) is implemented as written; the contract is what is wrong.
- Fix suggestion: pay the Callback at the exact average (`cb.bet` = avg rounded to a 10-cent multiple, `Eng.cents` only needs a multiple of 10), or keep the level but carry the remainder value into the next list; and work daily leads at the player's own bet (cap the lead COUNT instead of the stake) so the gift can never lower the average.

## F3. A knob edited while a decision is open voids the round: the player gets the cost back instead of the result they were shown  -- REPRODUCED

- Where: `games/coldcall.js:191-197` (`autoSettle`: any replay error -> `voidRound(rec, 'unresolvable')`), `:83-91` (`runRound` replays the tape against the LIVE `Eng.CFG.pull`), `games/coldcall-engine.js:535` (`more decisions than decision points`). `tests/lib-pull-pin.js` says the levers agent "may change them any time".
- Scenario: a bonus is bought, the pick is made, ONE MORE CALL is open with the bonus total on screen. A lever changes (`pick.on`, `pick.minLeads`, `pick.mult`, `more.*`, reveal weights, anything that moves a decision point or a draw). The timeout or a disconnect replays the tape under the new knobs, the recorded decisions no longer fit, the engine throws, the round is refunded. A shown win is taken away, or a shown loss is refunded. A `decide` in that state answers `Invalid decision` until the timer voids it.
- Repro: `node _crit/r7-void.js`:
```
open: bonus1 bought for 212250 cents, bonus shown to the player W = 1484 tenths = 371000 cents
after the default: balance +212250 cents; log: coldcall: voided round c5b97b186eaf unresolvable refund 212250 play; voided event: {"roundId":"c5b97b186eaf","mode":"play","refund":212250,"reason":"unresolvable",...}
```
  (the player had been shown $3,710.00 and got the $2,122.50 cost back.)
- Fix suggestion: snapshot the knobs into the open record at spin time (`rec.cfg = clone(CFG.pull)`, engine built from it for every replay), or keep the last good `done`-able result: for a `more` decision the bank outcome is already known at pending time, settle that instead of voiding.

## F4. Anything that throws inside `settle()` loses the cost: no credit, no refund, no record  -- REPRODUCED (through a removed knob)

- Where: `games/coldcall.js:231` (cost spent), `:116-144` (`rec.settled = true`, open record dropped and deleted from the store, THEN `cfg.pot.seed`, `Eng.cents`, `potSlice`, `potHitChance`, `C.now()`, `store.setPlayer` with no try around them), `:147` (the credit, never reached). `games/index.js:35` turns the throw into `Server error`.
- Scenario: a paid spin; `settle` throws before the credit. For a round that was open, the stored open record is already gone, so neither the timeout nor the restart void can refund it.
- Repro: `node _crit/r5-edges.js`, first line (the pot switched off by removing the knob block, one $25.00 spin):
```
CFG.pull.pot removed, one $25.00 spin  | spin -> {"message":"Server error","code":"internal"}; balance moved -2500 cents; state stored: null
```
  Same family, also run: `CFG.pull.feed` removed -> the round is paid and reported, then the handler throws (`Server error` after the result, feed and `floor:pot` skipped). A stored Callback whose bet is not a level (`cb: { bet: 15 }`, hand-edited or old file) is played and goes pending (`r3-life.js` last line); its settle would throw in `Eng.cents` with the Callback still armed (PLAUSIBLE, not run to the end).
- Fix suggestion: compute everything that can throw (cents, pot numbers) BEFORE `rec.settled = true` and before the record is dropped; wrap the block so a throw ends in `voidRound` (refund once) rather than in the router's catch.

## F5. `pot.oneInPerDollar = 0` does not switch the pot off, it makes every paid spin take it  -- REPRODUCED

- Where: `games/coldcall-engine.js:158` (`min(1, cost/100 / 0)` = 1), `games/coldcall.js:134`.
- Repro: `node _crit/r4-pot.js`: `pot.oneInPerDollar = 0 means "never" | 1 pot hits in 20 ten-cent spins (hit chance = cost / 0 = Infinity -> 1)` (one hit only because the pot was then under `minBal`; it is taken again as soon as it is back over $1.00). Money still balances (`fed + seeded = paid + bal`), but the "rare trigger" is gone and with `seed > 0` every hit adds house money.
- Fix suggestion: `oneInPerDollar > 0 ? ... : 0`, and an explicit `pot.on`.

## F6. The pot prize is outside the 10,000x cap  -- REPRODUCED (decision for the lead, not a code slip)

- Where: `games/coldcall.js:135` (`min(pot.bal, maxPayX * betCents)`, `maxPayX` 10000), `:147-148` (win and prize credited side by side).
- Repro: `node _crit/r5-edges.js`: `win + pot in one round | bet 10c: win 10c + pot 100000c = 10001x the bet`. Worst case one round credits 20,000x. PULL.md says the final win is capped at 10,000x and names only the gamble; say on the info screen that the pot is extra, or cap `win + prize`.

## F7. The server ticks the state before the engine sees it, so `pull.leaked` and `pull.warmDied` are always 0  -- REPRODUCED (no money; the "leads went cold" line can never show)

- Where: `games/coldcall.js:59` (`loadState` = `tickState(...)`), `games/coldcall-engine.js:427-428` (`leaked = before.lt - s.lt` on an already ticked state).
- Repro: `node _crit/r3-life.js`: `pull.leaked / warmDied reported after 3 idle days | stored lt before 348 (warm 0); result leadsBefore 100, leaked 0, warmDied 0` (24.8 leads were lost and the result says none).
- Fix suggestion: hand the engine the stored state (it ticks itself), or compute leaked / warmDied in `loadState` and put them in the result.

## F8. A stored state of another shape locks the account out of the game  -- REPRODUCED (no money moves)

- Where: `games/coldcall-engine.js:123` (`cloneState`: `st.warm.slice()` on whatever the file holds), `games/coldcall.js:59`, `:273` (the state handler loads BOTH currencies, so one bad entry kills the state event for both), `games/coldcall-store.js:19-22` (only the top level is checked, `v` is ignored).
- Repro: `node _crit/r3-life.js`: `unknown stored state shape is tolerated | spin -> {"message":"Server error","code":"internal"}; state handler -> {"message":"Server error","code":"internal"}; balance moved 0`.
- Fix suggestion: a `normState()` at load (defaults for missing fields, `warm` array of 0..29, `cb.bet` in `BET_LEVELS`, finite `lt` / `avg`, else `newState()`), and check `v`.

## F9. Small ones  -- REPRODUCED unless marked

- Rate limit is per socket, not per account (`games/coldcall.js:322`): `3 spins accepted in the same millisecond from 3 sockets of one account` (`r3-life.js`). `decide` has no limit. No money effect found (everything is one synchronous block per spin).
- A clock that steps back locks the socket out (`:322`, `t - last < 150` is true for a negative difference): `clock back 1 h (prev day):ERR rate` (`r5b.js`); it lasts until the clock passes the old stamp. Pre-existing line, more visible now that days matter. Fix: treat `t < last` as allowed.
- History is keyed by the raw key, the wallet / state / open rounds by the lower-cased trimmed key (`:153-156`, `:286` vs `:29`): `ann has 20 rows, 'ANN ' has 0` (`r3-life.js`). One wallet, two histories. Fix: `nkey` everywhere.
- PLAUSIBLE, account key `__proto__` (passes `accounts.js` `NAME_RE`, 9 characters): `wallet.js:44` (pre-existing) reads `data['__proto__']` = `Object.prototype` and a Play $ spend writes `Object.prototype.play = NaN` for the whole process (`r5-edges.js`: `({}).play = null` after one spin, the spin itself answers `Could not place that bet`). `coldcall-store.js:47-48` has the same pattern (`setPlayer('__proto__', mode, state)` would put a player state on `Object.prototype`, which `data.pot[mode]` and other players' missing currencies would then inherit). I could not reach the store write because the wallet throws first; not checked whether `accounts.js` lets the name register. Fix: `Object.create(null)` maps or a `Map`, and refuse the name.
- PLAUSIBLE, crash windows (not run, they need a kill between two synchronous writes): a round that settles in the same tick is written by two independent 50 ms debounces (store: state + pot; wallet: spend + win), so a crash between them leaves the pot fed and the list filled without the wallet rows, or the reverse. On the pending path the wallet is flushed before the open record (`:238-239`), so a crash between the two loses the cost with no refund record (the stated "lose, never pay twice" choice). Chips are safe at spend time (`server.js` `adjustBank` saves synchronously).

## Sim (`games/coldcall-sim.js`): where a tuning agent gets a wrong payback number

- S1, REPRODUCED. The Callback is counted in tenths of the NOMINAL bet (`:70` `a.cb += R.bonusRawTenths`, `:198-200` divided by `paid * 10`), but it is played at `cb.bet`. `node _crit/r6-sim.js`: `bet 100 ... reports 193.83% of stake; in real cents 193.83%` and `bet 2500 ... the sim formula reports 193.83% of stake; in real cents 135.52%; 5000 of 10000 Callbacks played under the bet`. The sim's number does not depend on `--bet` at all, so F2 is invisible to it.
- S2, REPRODUCED. Every session starts from an empty state and the unfinished list at the end is thrown away (`:63-66`). `r6-sim.js`: `list 400 leads, bet 100: sessions of 500 spins -> 2000 Callbacks in 1000000 spins (19.08% of stake); one long session -> 2667 in 1000000 (26.48%)`. Once the list is tuned to hundreds or thousands of spins per Callback, the default 2000-spin session understates the Callback part by a large share, and a list tuned to "98%" on that number pays more than 98% to a real returning player. Fix: carry the state across sessions (or one long session per batch) and report leads left over.
- S3, by reading. The pot part of the total is the constant `feedBps / 100` (`:200`), not what is paid: `seed` (house money added at every hit) is not in the total at all, `minBal` and the `maxPayX * bet` cap are ignored there. The modelled pot also differs from the server: on a hit the sim sets `bal` to the seed and drops what the cap left behind (`:83`), the server keeps it (`coldcall.js:136-137`); the sim has no `bal > 0` test.
- S4, by reading. One daily per session on a fixed day (`:57`, `:67`), so free leads per paid spin are whatever `spinsPerSession` implies (1 claim per 2000 spins by default). A real player claims once per calendar day per currency, with a streak up to 7 leads; the sim never reaches streak 2.
- S5, by reading. No idle time (`t += 1000`): the cold clock never fires, so the leak and the death of warm squares are not in any number.
- S6, by reading. Flat bet only and no buys inside a session: the bet switch of F1 (119 to 126%) and the rounding of F2 cannot show up; state is never crossed with a bought bonus.

## Checked and found clean

- Settlement in both purses: 6,000-round fuzz over 3 accounts, Play $ and Chips, every bet level, every buy, random decisions, autoplay, the pot hitting 4,047 times with a prize cap and a seed: balance = start - cost + win + prize after every round, 0 mismatches (`r4-pot.js`). Pot invariant `fed + seeded = paid + bal` after every round, remainder in 0..9999, prize credited once and equal to `pot.paid`, cap respected, residual above the cap kept.
- THE CALLBACK: cost 0, played at the stored `cb.bet` whatever bet the client sends, not claimable through a buy (the buy leaves it armed), does not feed the pot, cleared after it is played (`r5b.js`). The lead-weighted average cannot be pushed ABOVE the stake actually paid (the rounding only goes down, F2).
- Decisions: other account refused, wrong kind refused, spin and buy refused while open with the wallet untouched, the other currency free, decide twice / after settle / after timeout / after a restart = `no_round`, a second socket of the account may decide, a second socket's disconnect leaves the round open, the owner's disconnect defaults it once, timeout defaults once, timers cleared (`r3-life.js`).
- Restart void: a round open in Play $ and one in Chips are both refunded their exact cost once, a second `init` refunds nothing, player state untouched (`r3-life.js`).
- Replay: 400 bought bonuses with 748 decisions through the server equal a one-shot engine run on the same stream, script for script; a rejected decide does not move the tape; no way found to re-roll a decision by reconnecting.
- Pending payloads: no reveal of the decision spin, no gamble result, no tape in 748 pending payloads; the ghost and warm draws come after the last decision.
- ONE MORE CALL gate and the 10,000x cap on the engine win including the gamble (0 rounds over the cap in the fuzz; gate is `W * mult <= cap left`).
- Refused spend (funds): no state, no daily claim, no pot slice. QA force ignored without `COLDCALL_TEST=1` with pull on. Autoplay flag only takes the defaults.
- Daily: once per Chicago day per currency, streak +1 on the next day, reset after a gap, not claimed by a buy, nothing on a backwards clock; day boundary at 05:00Z (CDT) and across the 2026-11-01 DST change is right. JSON round trip of `avg` (float) and `null` fields is exact.
- Play $ and Chips state, pot and open rounds are kept apart.
- The three test files in my copy of a98fb53: `coldcall-pull-engine.js` 31 passed, `coldcall-pull-server.js` 28 passed, `coldcall.js` 47 passed, 0 failures. None of them covers F1 to F8.

FINAL: 9 reproduced (F1 to F9, with 3 reproduced small ones inside F9), 3 plausible (the Callback-bet settle throw in F4, `__proto__` and the crash windows in F9), plus 2 sim defects reproduced (S1, S2) and 4 by reading (S3 to S6).

