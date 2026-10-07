# THE PULL wave 1 fix round: money critic re-check (Opus, independent)

Reviewed: `git diff 2af8c3c^..3a5b50b` (fix round: 2af8c3c engine, 6b9324a sim, ceb7dea store, 3a5b50b server) and 9a59e6f (`ready`, `state.pull.rules`, `daily.next`).
Run from a clean copy of HEAD 31ea21a in `/tmp/pull-critic-fix` (no change to `games/` or `tests/` between 9a59e6f and HEAD). Repro scripts: `/tmp/pull-critic-fix/_crit/*.js`, shared harness `_crit/h.js`, knobs pinned to `tests/lib-pull-pin.js` unless said. Nothing was run, edited or committed in the worktree except this file.
Baseline in the copy: `coldcall-pull-engine.js` 37, `coldcall-pull-server.js` 43, `coldcall.js` 47, `bender.js` 19, 0 failures.

Ranked by money at risk. Line numbers are HEAD.

---

## N1. The F2 fix rounds the Callback bet to the NEAREST 10 cents: a player who mixes two bet sizes steers every Callback up for free (+29% Callback value, +6.9 points of payback)  -- REPRODUCED

- Where: `games/coldcall-engine.js:127` (`cbBet`: `Math.round(a / 10) * 10`), `:135` (`st.cb = { bet: cbBet(st.avg) }`), `:136` (the rounded-off part is neither charged nor carried).
- Scenario: the Callback is one free bonus at `cb.bet`. The player keeps the lead-weighted average just over a half step: bet 20 cents while `avg < 15.5`, else 10 cents. Every list arms at an average of about 15.5 and is paid at 20. The player needs no hidden data: `avg` follows from their own bets and the `filled` number in each result. The same works one step up (20 / 50 around 25.5), with a smaller gain. The gain is at most 5 cents of Callback bet per list, so it is a small-stakes hole, but it is a positive edge that never ends, in Chips too.
- Repro: `node _crit/f2-cb.js 600000` (engine, daily off, warm off, same seed for every row):
```
--- list 50 (pinned) ---
flat 10                          Callbacks 12634 mean cb.bet 10.00c  payback 321.36%  Callback part 215.98% of stake | Callback bet handed out / lead value put in = 1.0000
flat 20                          Callbacks 12634 mean cb.bet 20.00c  payback 321.36%  Callback part 215.98%          | 1.0000
steer: 20 if avg < 15.5 else 10  Callbacks 12634 mean cb.bet 20.00c  payback 382.79%  Callback part 278.60%          | 1.2901
steer: 50 if avg < 25.5 else 20  Callbacks 12634 mean cb.bet 30.00c  payback 356.52%  Callback part 251.85%          | 1.1660
--- list 400 (the LEVERS.md recommendation) ---
flat 10                          Callbacks 1609 payback 127.55%  Callback part 26.61% of stake | 1.0000
flat 20                          Callbacks 1609 payback 127.55%  Callback part 26.61%          | 1.0000
steer: 20 if avg < 15.5 else 10  Callbacks 1609 payback 134.48%  Callback part 34.34%          | 1.2904
```
  The gain is 0.29 x the Callback share of stake whatever the tuning: with the levers' own 22.3 points for the Callback that is about +6.5 points on a 98% game (about 104.5% at 10 / 20 cent bets). The mirror case costs an honest player: a mix that arms just under the half step (`anti-steer` row in the script) gets 0.69 of the Callback value it paid for.
- What still holds from the original F2: a flat $25.00 bettor with the daily on spin 1 gets a first Callback at $23.60 on a 50 list, $24.80 on a 400 list and $25.00 on a 2000 list, then $25.00 every time (`node _crit/f2-flat.js`; engine test `F2 Callback bet is the exact...`, fails on the old engine with `bet 2500 -> Callback at 1000`). "Many cheap leads then a few big spins" is neutral: 10 cents to 45 leads then $25.00 gives ratio 1.0009 (same script). A random level every spin gives 1.0001.
- Fix suggestion: round DOWN to 10 cents and carry what was rounded off into the next list (keep `avg x list` conserved: store the remainder in the state and add it at the next arming). Then no mix can gain and nobody loses over time.

## N2. THE APPOINTMENT at the recommended values is a money gift: one $1.00 spin a day returns about $15 a day, per currency  -- REPRODUCED (not caused by the fix round; a levers matter that the fix round's F2 text keeps: "daily leads stay at stake min(bet, stakeCap)")

- Where: `games/coldcall-engine.js:471-476` (free leads worked at `min(bet, daily.stakeCap)` = 100 cents), `cold-call/LEVERS.md:201` (`base 20, perStreak 10, streakMax 4` of a 400 list, listed as "no money").
- Scenario: spin once a day at $1.00, a minute inside 24 h so nothing goes cold, and play the Callback when it arms. From day 5 the claim is 15% of a list a day; a list is one free bonus of about 83 to 98 x $1.00.
- Repro: `node _crit/daily.js` (engine, 300 players x 365 days, one paid spin a day):
```
pinned: list 50, daily base 3 perStreak 1 max 4       109500 paid $1 spins, staked 10950000c, back 179926890c, payback 1643%, 17400 Callbacks (1 per 6.3 days), profit per day 15.43 dollars per currency
LEVERS.md: list 400, daily base 20 perStreak 10 max 4 109500 paid $1 spins, staked 10950000c, back 176566240c, payback 1612%, 16500 Callbacks (1 per 6.6 days), profit per day 15.12 dollars per currency
```
  For a regular at $1.00 and 600 spins a week the same gift is about 87x a week on 600x staked, about 14 points of payback that no sim counts (sim limit S4 is listed, its money effect is not).
- Fix suggestion: cost the daily inside the 98% (the Callback share has to shrink by what the daily gives), or make the free leads a match on leads worked that day, or lower `stakeCap` (at 10 cents the gift is about $1.50 a day).

## N3. The knob snapshot is a JSON copy: a knob set to `Infinity` ("never") becomes `null` on the server and means "always". `list: Infinity` = a free bonus every second round  -- REPRODUCED (needs someone to set such a knob; nothing in the repo does today)

- Where: `games/coldcall.js:31` (`clone` = JSON), `:299` (`cfg: clone(pullCfg())`), `:145` (every round runs under the copy); `games/coldcall-engine.js:133` (`Math.round(P.list * 10)` = 0 for `null`), `:476` (`Math.min(bet, null)` = 0), `games/coldcall.js:196` (`null * betCents` = 0), `:351` (`rules` shows `null` to the client).
- Repro: `node _crit/f3-clone.js`:
```
list = Infinity ("no Callback")   engine under the live knobs: 0 Callbacks in 400 rounds | server (snapshot): 200 Callbacks in 400 rounds, staked 20000 back 3307670 (16538%), rules.list sent to the client = null
list = 50 (control)               engine: 8 Callbacks | server: 8 Callbacks
pot.maxPayX = Infinity ("no cap") server: 293 pot hits paying 0 cents in total
cold.afterMs = Infinity ("never") server: view.cold after 30 spins = null leads 10   (the list is cold at once, every spin)
```
  The engine tests and the sims run on the live object, so they cannot see it. Before the fix round the server read the live knobs too.
- Fix suggestion: refuse a snapshot that holds a non-finite number or a `null` where a number is expected (answer `bad_request` before the spend), or copy with `structuredClone`.

## N4. F4 is closed for `settle()` but not for a round that stops at a decision: a throw after the spend leaves the cost taken, "Server error", and an open round with no timer  -- REPRODUCED (through a removed knob block, as the original F4)

- Where: `games/coldcall.js:310` (spend), `:312-319` (`putOpen`, `armTimer`, flushes, `pendingView`: no try), `:161` (`rec.cfg.decision.timeoutMs` throws when the block is missing), `:391` (same call in `decide`).
- Repro: `node _crit/f4-pending.js` (also `_crit/f4-throw.js`, 3,400 rounds over 34 knob corruptions x 2 currencies, before the spin and while a decision is open: this is the only case that failed, 12 bad lines, all of them this one):
```
decision knob block missing, bonus buy #2: spin answered {"message":"Server error","code":"internal"}; wallet delta -8490; open rounds 1; pending event sent: false
300 ms later (timeoutMs was 40): still open 1, timer armed false, wallet delta -8490; next spin -> "decision_open"
owner socket disconnects: settled done auto=disconnect win 4390; wallet delta for the round -4100 (= -cost + win: true)
```
  The money is not gone for good (a disconnect of the owning socket defaults the round, a restart refunds it) but the player never got the pending event, cannot spin in that currency, and nothing times out.
- Fix suggestion: one try around `:312-319` that ends in `voidRound(rec, 'open_error')`; `armTimer` with a fallback when the number is not finite.

## N5. F8 is closed for the fields `normState` checks, not for `day`, and not for the two levels above a state. One of them loses the cost of every spin and can kill the process  -- REPRODUCED (needs a hand-edited or damaged `coldcall-pull.json`; no player route found)

- Where: (a) `games/coldcall.js:78` (`day`: any string passes), `:95` (`dayAfter(st.day)` runs OUTSIDE the try of `dailyNext`), `:90` (`Date.parse` of a non-date = NaN, `dayFmt.format` throws). New with 9a59e6f. (b) `games/coldcall-store.js:49` (`setPlayer` writes a property on whatever `players[key]` holds), `:53-59` (`pot(mode)` returns any truthy value), `games/coldcall.js:205` (`rec.settled = true`) then `:209` (`pot.rem = ...`) and `:218` (`setPlayer`), both before the credit at `:222`; `:168` (the timer callback has no catch) and `server.js` has no `uncaughtException` handler.
- Repro: `node _crit/f78.js`, `node _crit/f4-pending.js` (last line):
```
F8 state: day "zzz"              state handler: ERROR internal; 6 spins: voided:settle_error; money that moved outside a done round: 0
F8 state: day "2026-13-45"       state handler: ERROR internal; 6 spins: voided:settle_error; money that moved outside a done round: 0
F8 players.ann = "x" (string)    state handler: ok; 6 spins: error:internal; money that moved outside a done round: -600
F8 players.ann = 5               state handler: ok; 6 spins: error:internal; money that moved outside a done round: -600
F8 pot.play = 5                  state handler: ok; 6 spins: error:internal; money that moved outside a done round: -600
F8 pot.play = "x"                state handler: ok; 6 spins: error:internal; money that moved outside a done round: -600
stored pot.play = 5 ... a round left to time out: uncaught exception in the timer = "Cannot create property 'rem' on number '5'", wallet delta for that round -8490, open 0
```
  (a) locks the account out of the state event for both currencies and refunds every spin, no money moves. (b) is the old F4 again: the throw comes after `rec.settled`, so no refund; one bad pot entry takes the cost of every paid spin of every player in that currency, and the first decision that times out throws inside a timer.
- Holds: every other shape I tried resets or plays cleanly with 0 cents moved outside a done round (state an array, `lt` / `avg` 1e308, repeated or 30 warm squares, `players` an array, `players.ann` an array, pot `{}` or strings, open records without a cost, with a negative cost, with a bad mode). F7 holds: `stored lt 348, warm 2, cold since 3 days -> leaked 248 warmDied 2`.
- Fix suggestion: `day` must match `^\d{4}-\d{2}-\d{2}$` in `normState` and `claimDay` goes inside the try; the store normalises `players[key]` (object or dropped) and `pot[mode]` (five safe integers or a fresh pot) at load; move `pot.rem / setPlayer` in front of `rec.settled`, or wrap the block after it so the credit is always reached; a catch in the timer callback.

## N6. The snapshot covers `CFG.pull` only. Five other knobs are read live by the replay, so editing one while a decision is open replaces the bonus the player was shown  -- REPRODUCED (needs a runtime edit of a non-pull knob; nothing does that today, they change with a restart, and a restart voids open rounds)

- Where: `games/coldcall.js:144-148` (only `Eng.CFG.pull` is swapped); `games/coldcall-engine.js:346` (`cfg.spins`), `:357-359` (`cfg.retrigger`, `cfg.maxSpins`), `:238` (`cfg.maxRevealRounds`), `:321` (`cfg.maxCascades`), `:465` (`cfg.buyCost`, shown only: the charge is `rec.cost`).
- Repro: `node _crit/f3-snap.js` (12 edits x pick / more x decide / timeout / disconnect, each against a control run on the same seed):
```
more / timeout: control win 310 ...; 12 edits, 1 differ from the control
    DIFFERS  NON-pull knob: CFG.spins.bonus1 = 30, bonus2 = 30: done true win 20000 wallet delta 20000
pick / timeout: control win 7590 ...; 12 edits, 2 differ
    DIFFERS  NON-pull knob: CFG.spins.bonus1 = 30, bonus2 = 30: win 28400
    DIFFERS  NON-pull knob: CFG.retrigger.two = 9: win 25700
```
  (ONE MORE CALL was open on a bonus shown as 310; the default paid 20,000.) All nine edits of `CFG.pull` (on flipped, pick and more wrecked, the whole object replaced by `{}` or `null`, pot / feed / decision blocks deleted, a pot that always hits) gave the control result to the cent in all six paths.
- Fix suggestion: say in `PULL-ENGINE.md` that everything outside `CFG.pull` is restart-only, or freeze those five into the record as well.

---

## A. Earlier findings

- F1 warm squares across bets: **holds**. Engine, 1M spins per policy (`_crit/f1-warm.js`): flat $25 110.25%; the old attack (10 cents cold, $25 when warm) 108.61% with 0 warm spins honoured at a different bet and 139,151 drops; follow-the-warm-bet 106.39%; the reverse 103.61%. No policy beats flat. Server fuzz (`_crit/f1-server.js`): 12,000 rounds, random bets, 1,630 buys, 217 Callback rounds, both currencies, decisions: warm honoured 1,296 times, dropped 1,027 times, rule broken 0, balance mismatches 0; buys and Callbacks never moved `warm` / `warmBet`; a stored state without `warmBet`, with `warmBet` 10 then a $25 spin, with a string or a float `warmBet`: 0 squares honoured; the other currency sees none; with a natural bonus open at 10 cents a $25 spin and a $25 buy both answer `decision_open` and the round settles at 10 cents.
- F2 Callback floored to a level: the original loss is **closed**; the new rounding is steerable upward, see **N1**.
- F3 knob edit voids / changes an open round: **holds for every `CFG.pull` edit** on decide, timeout and disconnect (N6 run above). Restart: a stored open record is only refunded (`games/coldcall.js:278-284`), never replayed, so an old snapshot cannot pay anything. Two limits: N3 (the copy is JSON) and N6 (non-pull knobs).
- F4 settle throws: **closed inside `settle()`** (3,400-round corruption fuzz: every round was either done with delta = -cost + win + prize, or refunded once, never both, pot invariant intact). **Not closed** on the pending path (N4) and for a malformed store entry (N5 b).
- F5 `oneInPerDollar` 0: **holds** (`_crit/f5.js`, pot rng forced to 0: 0, -5, NaN, null, undefined, 'x', Infinity all give 0 hits in 40 rounds; 1e-9 gives 40).
- F7 leaked / warmDied: **holds** (248 / 2 above).
- F8 stored shapes: **closed for the state fields except `day`; not closed above the state** (N5).
- F9a rate limit per account: **holds** (`ann`, `'ANN '`, `Ann` in one ms: 1 accepted, 2 `rate`). F9b clock back 1 h: **holds** (spin done). F9c history key: **holds** (7 rows under both spellings). F9d reserved names: **holds** (`__proto__`, `constructor`, `prototype` in any case and with spaces refused at all six handlers, `Object.prototype` clean; `toString`, `hasOwnProperty`, `valueOf` play normally because the key is lower-cased). F9e crash windows: not made worse (the added `store.flush()` at `:219` only narrows the prize window).

## B. New holes from the fixes

N1 (paid at a bet above the one staked), N3 (free bonuses from a knob that meant "never"), N4 and N5 (cost taken with nothing back). No route found to be paid twice or refunded plus paid: `rec.settled` is set before any credit in both `settle` and `voidRound`, the void is only reached from the try that runs before it, and the 12,000-round and 3,400-round fuzzes show 0 such rounds.

## C. `ready`, `rules`, `daily.next` (9a59e6f)

- Hold time, real clock, `timeoutMs` 300 (`_crit/c-ready.js`): no ready 1.01 x; one ready at 0.9 x T -> 1.91 x; ready from 3 sockets every 20 ms -> 1.10 x; the same with the server clock frozen -> 1.08 x; with the server clock stepping BACK 1 h before every ready -> 1.12 x; after a 1 h jump forward -> 1.00 x (ignored); another account or junk ids -> 1.02 x, 0 timer events. **Holds: never past 2 x timeoutMs per decision.** What bounds it is the one-shot `readyDone` (`games/coldcall.js:409-413`) and that `setTimeout` runs on real time; the `armedAt + 2 x timeoutMs` test only matters when the wall clock is right.
- Per ROUND the bound is 4 x, not 2 x: PICK held 1.8 x, decided, ONE MORE CALL re-armed -> round open 3.71 x timeoutMs (`armTimer` at `:391` gives each decision a new budget). As designed and documented; say "per decision" wherever the UI or the info screen quotes it.
- A re-arm changes when, not what: same seed, PICK and ONE MORE CALL left to time out, with and without a ready: identical result (win, bonus script, lead list). After settle: `no_round`. Someone else's round: `forbidden`, the owner hears nothing. Inside 150 ms: `rate`; a repeat returns the same `expiresAt`.
- `dailyNext` probe (`_crit/c-probe.js`): 1,500 rounds with nine state / floor calls before each against none: results equal, rng draws 97,921 vs 97,921, pot rng draws 1,472 vs 1,472, store file byte-equal, feed equal, balances equal. `Eng.CFG.pull` was the same object with the same content after 609 probing paths, including an rng that throws inside a spin and inside a decide (both `bad_request`, round still open) and a probe that throws in the engine (`daily.next` = null). `daily.next` matched the real claim on 12 of 12 days with a 3-day gap inside. **Holds**, with one hole: `claimDay` is computed before the try (`:95`), see N5 a (the swap itself is not left behind, the throw comes before it).
- Cost: the state handler has no rate limit and now runs two engine rounds per call: 0.068 ms a call measured. Not a risk.
- `rules`: a copy (editing the payload does not move the live knobs). Nothing in it is hidden state; every number is already in the client's `engine.js` or measurable. It hands a pot chaser (W8, accepted) the exact break-even instead of an estimate, and shows `null` for a non-finite knob (N3).

## D. Do the new tests fail on the old code?

HEAD tests against the old file swapped in from git (`_crit/old1..3`):
- Engine before 2af8c3c: 10 fail, 27 pass. F1 fails on `dropped warm squares are not warmIn` and `undefined !== 4` (no `warmDropped`); F2 on `bet 2500 -> Callback at 1000 (want >= 2490)`; F5 on `1 !== 0`. Right reasons.
- `games/coldcall.js` before 3a5b50b: 16 fail, 27 pass. F4 `pot: no router "Server error"`, F7 `leaked 0`, F8 `state handler works: {"v":2}`, F9d `the pot file already says paid 12: null`: right reasons. F3 and F9a fail by crashing on a `null` (`reading 'W'`, `reading 'code'`) one line before their own assert: the old behaviour is what makes the value null (the round was replayed under the new knobs and has no `more` block; the second and third socket got a result, not an error), so the cause is right but the message is not the test's.
- `games/coldcall.js` before 9a59e6f: 7 fail, 36 pass: the four `ready` tests, `rules is there`, `day 1: base`, and the updated state-shape test.

## Not covered by any test today

N1 (steered mix), N3 (non-finite knob through the server), N4 (throw on the pending path), N5 (`day`, `players[key]`, `pot[mode]`), N6 (non-pull knob while open).

FINAL: 6 reproduced, 0 plausible, 2 earlier findings not closed
