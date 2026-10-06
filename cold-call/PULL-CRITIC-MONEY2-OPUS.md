# COLD CALL: Opus money critic 2 (carry, pot cap, denoms, live config, presets)

Started 2026-10-06 17:11 CDT. Reviewer: Opus 5.5 subagent, adversarial, read-only (no fixes, no commits).
Code under review: branch coldcall-pull at b596408, slim export (git archive, no qa / art / levers-runs).

Scope (five changes no Opus review has seen):
1. e15f151 N1-CARRY (Callback bet = floor10(lead-weighted average + carry), state.carry per currency)
2. f721061 POT-CAP (pot hit pays min(bal, capCents 5000), Eng.potPrize)
3. 9a02561 DENOMS (1c / 2c / 5c, Eng.roundCents, buyPrice, rounding tape, shown = paid)
4. 82a1502 LIVECFG (games/coldcall-livecfg.js, admin GET/POST /api/admin/coldcall-config, rec.K snapshot)
5. b596408 PRESETS (cold-call/presets/rtp98|96|94.json, RTP_LABEL)

Out of scope: the 16 persistence / crash-ordering findings in ping-v2-core/_scratch/p6/AUDIT-COLDCALL.md, client code other than engine.js.

Repro scripts: _scratch/critic-money2/ (run each as: cd <slim export> && node <path to script>; scripts take the export root from process.cwd()).

Status: COMPLETE (attack phase ended 17:33 CDT, verdict at the end). Findings were appended the moment they were confirmed.

## FINDINGS

### M1. MONEY, REPRODUCED (mechanism) / PLAUSIBLE (above 100%): the pot-chaser ceiling was computed for paid spins only; a chaser who uses BUYS sits at 99.5 to 99.8, a full point over the 98.7 bar

Where: `games/coldcall.js:212-216` (settle: `if (cost > 0)` feeds and rolls the pot for every paid round, buys included, chance `potHitChance(cfg, cost)` = price / 100 / 3000), `games/coldcall-engine.js:69-70` (buy prices = average value / 0.98), LEVERS.md 8.11 ("Chaser total = 97.02 + the chaser's pot part") and 8.13 ("Chaser total = ex-pot + 1.667").

The claimed ceiling 98.687 is `ex-pot flat spin (97.02) + capCents / 100 / oneInPerDollar (1.667)`. The 97.02 is the paid spin. The buys were priced to pay back 98.0 on their own, measured ex-pot in LEVERS 8.12 ("Payback = cents paid / cents of price"): call 98.041, bonus1 97.814, bonus2 98.008, hunt 98.124 (98.58 +- 0.36 in the 60M run quoted in 8.13). A buy takes a pot slice and rolls the pot with a chance proportional to its price, so with the pot at $50 or more every buy carries the same +1.667:

```
$ node _scratch/critic-money2/m1-buy-pot-chaser.js
pot rules: {"feedBps":100,"oneInPerDollar":3000,"seed":0,"minBal":1000,"capCents":5000}
1) analytic pot part of every buy when the pot holds >= capCents (chance x prize / price), per bet:
  bet 1c:   call price 3c ... pot +1.667 => 99.71 | bonus1 price 96c ... => 99.48 | bonus2 price 291c ... => 99.67 | hunt price 2c ... => 99.79
  bet 100c: call price 270c chance 9.000e-4 pot +1.667 => 99.71 | bonus1 9640c chance 3.213e-2 => 99.48 | bonus2 29100c chance 9.700e-2 => 99.67 | hunt 200c chance 6.667e-4 => 99.79
  bet 2500c: ... bonus2 price 727500c chance 1.000e+0 pot +0.687 => 98.70 | hunt price 5000c chance 1.667e-2 pot +1.667 => 99.79
  flat spin chaser (the documented ceiling): 97.02 + 1.667 = 98.687 (bar 98.7)
2) the real handler: a hunt buy at $1 with the pot at $50.00 and a pot roll that hits
  cost 200 game win 130 pot {"won":true,"amount":5000,"who":"chaser"} wallet 1000000 -> 1004930 (delta 4930 )
  pot after: {"bal":2,"fed":5002,"paid":5000} conserved: true
  the same roll u = 6.660e-4 on a $1 paid spin (chance 3.333e-4): hit = false
```

Size: buy chaser = 99.48 (bonus1) / 99.67 (bonus2, the tightest interval, +- 0.04) / 99.71 (call) / 99.79 (hunt at the 30M figure), i.e. 0.8 to 1.1 points over the bar at every bet from 1c to $25 (the only exception is the bonus2 buy at $25, whose chance clamps at 1). With the 60M hunt figure (98.58 +- 0.36) the hunt chaser is 100.25 +- 0.36: break-even is an ex-pot buy payback of 98.333, and the hunt's two measurements (98.12 +- 0.44, 98.58 +- 0.36) straddle it. Pooling the two shipped hunt runs by their intervals gives about 98.40 +- 0.28, and the rtp96 hunt run (200M, 96.27 +- 0.20 at bellMult 1.828, same price 20) moved by the measured slope (1.2 points per 0.01 of bellMult, to 1.845) gives about 98.3: the hunt chaser is 100.0 +- 0.3, i.e. break-even inside the noise. So "not beatable" is not established for a hunt buyer who only plays while the pot shows $50 or more (the pot balance is broadcast in `floor:pot`, and both currencies have a pot).
Also without any chasing: a buy-only player gets 98.0 + the average pot part (0.96 to 1.00) = about 99.0 against a label that says "98.0% ... includes the Callback and the office pot". Measured through the real handlers, a buyer alone in the room, pot starting empty (`m1b-buy-only-pot-part.js`):
```
hunt at 2500c x 12000:     staked 60000000c, pot fed 600000c, pot hits 174 paid 599400c = 0.999% of stake (pot left 600c)
bonus2 at 100c x 1500:     staked 43650000c, pot fed 436500c, pot hits 128 paid 432109c = 0.990% of stake (pot left 4391c)
call at 1000c x 12000:     staked 32400000c, pot fed 324000c, pot hits 92 paid 323676c = 0.999% of stake (pot left 324c)
```
Same shape in the presets: rtp96 buys 96.0 to 96.3 + 1.667 = 97.7 to 97.9 for a chaser (label 96.1), rtp94 94.0 to 94.2 + 1.667 = 95.7 to 95.9 (label 94.0).
Checked that the buy figures are ex-pot: `games/coldcall-sim.js` has pot code only in `--pot-room` (:51-55) and `--pull` (:162-164), none in `--buys-pull` (:277-295); a local run of the sim (`--buys-pull 120000 121 --bet 100 --pickpolicy best --more bank --only bonus2,hunt --threads 2`, 13 s) prints `bonus2 price 29100c ... paid payback 97.812% +- 0.717` with no pot column, in line with the 30M figure 98.008 +- 0.040.
Conservation is not broken (the pot invariant holds, see the output): this is other players' feed going to the buyer, on top of a buy that was priced as if it had no pot.
Not a fix, only where the choice is: either buys do not roll the pot (or roll it at the chance of one bet), or the buys are priced with the pot part inside their 98.0, or the bar is restated with buys in it. Lowering capCents to 3000 leaves the buy chaser at 99.0 to 99.1.

### D1. MONEY IF SET (admin only), REPRODUCED: the validator accepts `pull.more.rtp` up to `more.mult`, i.e. a ONE MORE CALL gamble that pays up to 200%

Where: `games/coldcall-livecfg.js:33` (`'pull.more.rtp': [0, 100]`) and `:113` (the only relation: `rtp <= mult`). The engine wins the gamble with probability `rtp / mult` (`coldcall-engine.js:569-573`), so `rtp` is the payback of the gamble as a fraction and anything above 1 is player-positive. `{pull:{more:{rtp:2,mult:2}}}` and `{pull:{more:{rtp:1.5}}}` both pass validation and the smoke test:

```
$ node _scratch/critic-money2/d1-validation-edges.js
more.rtp 2 with mult 2 (gamble always wins):                   ACCEPTED (smoke 320 rounds, max win 5213 tenths)
more.rtp 1.5 with mult 2 (gamble pays 150%):                   ACCEPTED (smoke 320 rounds, max win 5213 tenths)
more.rtp 2 / mult 2 accepted: over 3607 offers on bonus1 buys at $1, banking paid 36074920c, taking paid 72149840c (x2.000)
```
Size if set: every bonus of 5x or more is worth `rtp` times its value (3,607 of 4,000 bonus1 buys got the offer: at rtp 1.5 the buy pays back roughly 1.45 times its 97.8%). A typo away from the shipped `1.0` (someone reading the knob as "RTP of the gamble in units of the multiplier"). The label then reads "custom settings, not measured" unless the POST carried its own. The rule should be `rtp <= 1`.

### D2. MONEY IF SET (admin only), REPRODUCED: nothing ties `pot.capCents / pot.oneInPerDollar` to the chaser bar; a "make the pot hit more often" edit passes and puts a chaser over 100%

Where: `games/coldcall-livecfg.js:35, 110-112`. The relations give the pot a LOWER bound only (`capCents >= feedBps x oneInPerDollar / 100`). The chaser's pot part is `capCents / 100 / oneInPerDollar` points; shipped 1.667 with a margin of 0.013 under the bar. `{pull:{pot:{oneInPerDollar:1000}}}` (three times as many hits, cap unchanged) is accepted: pot part up to 5.0, chaser on paid spins up to 102.0 whenever the pot shows $50, and already over 100 from a pot of $29.80. `{oneInPerDollar:100, capCents:1e9}` is accepted too.
```
pot oneInPerDollar 1000 (chaser +5 points):                    ACCEPTED (smoke 320 rounds, max win 5213 tenths)
pot oneInPerDollar 100, capCents 1e9:                          ACCEPTED (smoke 320 rounds, max win 5213 tenths)
```
Conservation holds (it is pot money). The gap: the one bar this build was tuned against (chaser <= 98.7) is not a validation rule, so the switch can silently break it. A relation `capCents / oneInPerDollar <= 1.667` (or a warning in the POST reply) would hold it.

### D3. COSMETIC / HONESTY (admin only), REPRODUCED: the RTP label is free text and is not tied to the overrides it is sent with

Where: `games/coldcall-livecfg.js:185, 215` (`rtp = live.rtpLabel || (custom ? "custom settings, not measured" : shipped)`).
```
$ node _scratch/critic-money2/e1-presets-label.js   (LABELS part)
rtp94 overrides, no rtpLabel            -> custom settings, not measured          (right)
rtp94 overrides + the rtp98 label       -> 98.0% (long-run, 200M-spin sim, +-0.22, includes the Callback and the office pot) (accepted; list 550)
payScale 3 + a "94.0%" label            -> 94.0% (measured)
NO overrides + the rtp94 label          -> 94.0% (200M-spin sim at $1) | custom: false
reset                                   -> 98.0% (long-run, ...)                  (right)
```
Players are shown whatever string came with the POST: a preset's overrides edited by hand (say `pull.list` 550 -> 400) and re-POSTed with the file's label still claims "94.0%". PLAUSIBLE second route: the saved file holds only `{overrides, rtpLabel}`; the label was measured on (shipped defaults + overrides), so after a deploy that changes any shipped number the saved preset is re-merged onto the NEW defaults at boot and keeps its old label (no hash of the merged config is stored with the label). Suggest: store a hash of the merged config beside the label and fall back to "custom settings, not measured" when it no longer matches.
Also from the presets table (LEVERS 8.13): under rtp96 the call buy pays 94.54 (1.6 under the 96.1 label) and under every preset the buys plus the pot sit about a point over the label (see M1).

### D4. INFO (admin only), REPRODUCED: a swap that shortens `pull.list` re-prices the leads players already hold (rtp94 -> rtp98: +22%)

Leads are stored as a count; a Callback costs `pull.list` of them under whatever config is live when the list is checked (`coldcall-engine.js:150-153`). A player holding 540 leads at $1 under rtp94 (list 550) gets a Callback on his next paid spin after a swap to rtp98 (list 450) and keeps 90 leads; a swap to a list of 100 gives 5 Callbacks in the next 40 rounds:
```
$ node _scratch/critic-money2/e1-presets-label.js   (last part)
  list 450: in the next 40 rounds 1 free Callbacks (paid them 4070c) against 39 paid spins; leads left 129.6
  list 100: in the next 40 rounds 5 free Callbacks (paid them 75890c) against 35 paid spins; leads left 76.6
```
The mechanism is the documented one (PULL-ENGINE.md section 8, item 8a: a stock of N lists becomes N Callbacks, one at a time; no throw, no stuck state, carry stays in range). What the doc does not say is the size at a PRESET change: a one-time transfer of up to (550 - 450) / 450 = 22% of a Callback (about 21x the average bet) per player when the room goes from rtp94 to rtp98, and the reverse takes that much away. Worth one line in PULL-ENGINE.md section 8 so the operator knows.

### D5. COSMETIC, REPRODUCED: admin endpoint edge behaviour (no bypass found)

Where: `server.js:271-276` (`benderAdminOk`, shared with Ballot Bender), `server.js:301-303`. Real server.js on 127.0.0.1:4636, own data dir:
```
$ node _scratch/critic-money2/d2-admin-http.js
env unset, no header, POST:                         403      env unset, empty header, POST:       403      env EMPTY string, empty header, POST:  403
no header: 403   wrong token, same length: 403   token as ?token= query: 403   token in Authorization: 403   token sent twice: 403
GET, same LENGTH, non-ASCII:                        500 <!DOCTYPE html> ... <pre>RangeError: Input buffers must have the same byte length
no token, malformed JSON body:                      400 <!DOCTYPE html> ... <pre>SyntaxError: Unexpected end of JSON input<br> ...
no token, 70 KB body:                               413 <!DOCTYPE html> ... PayloadTooLargeError
good token, reset as a string "false":              200 {"ok":true, ... "rtpLabel":"98.0% ..."      <- {"reset":"false","overrides":{"payScale":2}} RESETS (any truthy `reset` wins, the overrides are dropped)
good token, the disk refuses the write:             400 {"ok":false,"error":"ENOENT ..."}   payScale after the failed write: 1   (nothing changed: right)
```
(a) The length check compares UTF-16 lengths, `timingSafeEqual` compares UTF-8 bytes: a header of the right length with one byte above 0x7F throws, and an unauthenticated caller gets a 500 with a stack trace (file paths) when NODE_ENV is not production. Not a bypass. Same in Bender's endpoint. (b) `express.json` runs before the token check, so an unauthenticated caller gets body-parser errors (400 / 413 with a stack) instead of 403. (c) `reset` is tested for truthiness: `"reset":"false"` resets and ignores the overrides sent with it. (d) One token (`BENDER_ADMIN_TOKEN`) opens both games' math. None of these moves money for a player.

### D6. DoS HEADROOM (low), REPRODUCED: the per-round snapshot rebuilds the whole engine two times per spin and once per `state` request

Where: `games/coldcall-livecfg.js:234` (`snapshot()` = structuredClone(CFG) + `createEngine`), called at `games/coldcall.js:327` (every spin), `:112` (`viewK`, every settle), `:116` / `:386` (every `state` request, which has no rate limit).
```
$ node _scratch/critic-money2/d3-snapshot-cost.js      (this box, nice 10, shared)
L.snapshot():            0.298 ms each
g:coldcall:state:        0.643 ms each (no rate limit in the handler; payload 4120 bytes)
paid $1 spin, settled:   0.851 ms each
engine.playRound alone:  0.062 ms each
```
A settled spin costs 14 times the engine's own work, most of it two snapshots; the single Node thread tops out near 1,200 spins a second, and one socket sending `g:coldcall:state` in a loop holds the thread at 0.64 ms per message. No money effect. The snapshot only changes when `setLiveConfig` / `loadLiveConfig` swaps: build it once per swap and hand the same frozen object to every round (an open round keeps its reference, so the "round finishes on its own config" property stays).

## ATTACKED AND NOT BROKEN (one line each; script in _scratch/critic-money2/ where one exists)

A. Carry / Callback
- cbArm chains across the 10c line, at the 2500 clamp and under 10c (20,000 chains of 60 arms): bet never above avg + carry, carry always in [0, 10), largest running gain -2e-6c (`a1-carry.js` 1).
- Real flows with a config swap mid-list (list 5 / 20 / 60 / 3.3, carryOver on and off every 400 rounds), two currencies' states side by side, cold gaps: 8,437 arms, carry never out of range (`a1-carry.js` 2).
- Stake ledger for four mixers (random 11 bets; 5c / 20c around the 10c line; 1c then $25 at the last spin; $25 then 1c): Callback stake handed out + stake still held - stake credited = 0.0000c in every run (`a1-carry.js` 3). Collecting cheap and cashing dear, or the reverse, gains nothing.
- Currency switching: carry lives inside the per-currency state (`store.player(key, mode)`), nothing converts; the same mixers on two states do not interact.
- Damaged state: `normState` reads a carry outside (0, 10) as 0 and a `cb.bet` outside whole [1, 2500] resets that currency; nothing a client sends reaches the stored state.
- Only with a non-shipped config: `daily.stakeCap` 0 lets the list average fall under 1c and the 1c minimum lifts the Callback above it (`d1-validation-edges.js` last line: avg 0.023c, bet 1c). At most 1c per Callback, admin-set.

B. Pot
- Conservation through the real handlers: 9,000 random events, 5 accounts on 10 sockets, both currencies, 3,037 rounds under 10c, 804 decisions held open and answered later in any order, 227 disconnects, 371 pot hits, 1,492 pot-knob swaps while rounds were open: `fed + seeded = paid + bal`, `fed x 10000 + rem = sum(cost x the feedBps the round was spun under)` and every wallet = start - costs + wins + prizes + refunds after every event (`b1-pot-conservation.js`).
- The 1% of a 1c bet: `potSlice` carries it in `pot.rem` (ten-thousandths of a cent, per currency, shared); the cent goes into the shared pot when the remainder crosses, nobody is credited it, a voided round and a Callback feed nothing. Not farmable.
- Two sockets on one pot, a hit while a decision is pending, feed before hit: one synchronous block per settle, the roll is made at settle on the pot of that moment; holding a decision open (up to 180 s per decision) only moves WHEN the same chance is rolled, never above `capCents`.
- Paid-spin chaser at 1c / 2c / 5c: chance and feed are linear in whole cents of cost, prize is `min(bal, 5000)`: 1.667 at every bet, as claimed. The break is the buys (M1), not the small bets.

C. Sub-cent rounding
- `roundCents` at every remainder of 72 scales (paid spin and Callback at 1 to 9c, every buy price of the three presets at 1c / 2c / 5c): P(round up) = r / den exactly on a 64 x den grid, error 0 (`c1-rounding.js` 1).
- The rounding numbers (separate `roundRng`, recorded in `rec.rtape`) are in no payload a client receives; they are in the stored open record only (`c1-rounding.js` 2).
- Shown = paid at 1c through bank, a won gamble, a lost gamble and a disconnect default (the timeout runs the same `autoSettle`); a restart refunds the 96c price once and leaves no open record (`c1-rounding.js` 3). No player-reachable void path was found (insufficient funds returns only an error: the round is computed before the spend, nothing of it is sent).
- Buys at 1c / 2c / 5c: the fair stake (price / cost multiple) makes payback independent of the bet by construction; the 1c minimum only matters for a non-shipped `buyCost` under 5 tenths and stays fair there too.
- Cap at 1c: paid spin 10,000c, call buy 10,000c (its fair-stake cap 11,111c clamped), hunt 10,000c (`c1-rounding.js` 4).

D. Live config
- Auth: unset env, empty env, empty header, wrong token, token in query / Authorization, doubled header: all 403 (`d2-admin-http.js`). Failed disk write: 400, nothing changed. `__proto__` / `constructor` / unknown nested keys / Infinity / strings / arrays / null blocks: refused (`d1-validation-edges.js`).
- Nothing accepted hangs a round or the smoke test (worst accepted config: 0.9 s for the 320-round smoke) and nothing accepted breaks conservation (`pot.seed` must be 0; -0 is harmless).
- A 1c bonus1 buy opened under the shipped config and decided (PICK, then ONE MORE CALL taken) under rtp94 + payScale 3 + more.mult 5: same script, same shown amounts, same payout as the unswapped twin (`e1-presets-label.js`).
- Label after overrides without a label ("custom settings, not measured"), after a reset (shipped line), after a failed POST (unchanged): right.

E. Presets
- rtp94 -> rtp96 -> rtp98 through `setLiveConfig` (the call `server.js:309` makes): a fixed 400-round session through the handlers (both currencies, every bet, buys, decisions, pot hits) is bit-identical to the no-override run, `Eng.CFG` deep-equals the shipped config with the same key order, label === RTP_LABEL, custom false (`e1-presets-label.js`).
- Buys against their own label, ex-pot, from LEVERS 8.13: rtp96 call 94.54 / bonus1 96.02 / bonus2 96.00 / hunt 96.27 (label 96.1); rtp94 call 94.54 / 94.01 / 94.00 / hunt 94.21 (label 94.0: the call buy is 0.5 over, as LEVERS says). With the pot every buy is about a point over its label (M1).


## VERDICT

The five changes do what their commits say. Carry, pot cap, sub-cent rounding, the per-round snapshot and the presets all held under attack: no wrong cent, no conservation break, no player-reachable re-roll or refund, no way past the admin token. One money finding comes from a number the changes rely on rather than from their code.

**Must be decided before this build goes to another team**
- **M1.** The "chaser at most 98.687, bar 98.7" figure is for paid spins. Buys roll and feed the pot too and were priced at 98.0 without it: a buy-only player is at about 99.0 against a 98.0 label, a buy chaser at 99.5 to 99.8, and the hunt-buy chaser is 100.0 +- 0.3 (break-even inside the measurement noise; two hunt runs disagree by 0.46). Either take the pot off buys (or roll it at one bet's chance), or price the buys with the pot inside, or restate the bar and the labels with buys in them. Whatever is chosen, re-measure the shipped hunt buy at 200M first: it is the one number that decides whether a visible-pot strategy is above 100%.

**Cheap, should go in with it (admin-only, but the switch is being handed to another team)**
- **D1.** Validator: `pull.more.rtp` must be <= 1, not <= mult.
- **D2.** Validator: add the chaser relation (`capCents / oneInPerDollar` at most what the bar allows), or at least return a warning in the POST reply.
- **D3.** Label: store a hash of the merged config with `rtpLabel` and show "custom settings, not measured" when it no longer matches (covers a hand-edited preset and a deploy that moves a shipped default under a saved preset).

**Can wait**
- **D4.** One line in PULL-ENGINE.md section 8 on what a preset change does to held leads (rtp94 -> rtp98: +22% of a Callback per player, once).
- **D5.** Admin endpoint tidy-up: byte-length compare before `timingSafeEqual`, token check before `express.json`, `reset === true`. Shared with Bender.
- **D6.** Build the snapshot once per swap instead of twice per spin; rate-limit `g:coldcall:state`.

**Reached late, both passed (added after the list above was written)**
- Timeout default on a real timer (`decision.timeoutMs` 3000, `ready` sent, 3.3 s wait; `c1-rounding.js` 5): `1c: shown bank 59c -> status done, auto timeout, paid 59c, wallet delta -37c (= -96 + 59), open left 0` and `2c: shown bank 199c -> auto timeout, paid 199c, wallet delta 6c (= -193 + 199)`.
- Each preset file POSTed over real HTTP with the token, then rtp98 (`d2-admin-http.js`, last lines): `preset rtp94 over HTTP: 200 | label: 94.0% ... | custom: true | list 550`, `rtp96: 200 | 96.1% ... | list 495`, `rtp98: 200 | label: 98.0% ... | custom: false | list 450 | live cfg === shipped: true`.
- D5 (a) detail: the 500 needs a raw byte above 0x7F in the header (my GET sent one); the same string on a POST with a body went out as two UTF-8 bytes, so the lengths differed and it got the normal 403.

**Not reached**
- No long simulation of my own (by instruction): M1's sizes rest on LEVERS 8.11 to 8.13 for the ex-pot paybacks; I only confirmed locally that the sim's buy mode has no pot and that the pot part is 1.0 for a buy-only player and 1.667 at a full pot.
- The `ready` handler beyond one use, and the 180 s ceiling (no `ready` sent) on a real clock.
- A deploy that changes a shipped default under a saved preset (D3's second route) is reasoned, not run.
- Client code, the public engine copy's use of the pushed config, the sim's `--preset` flag, Ballot Bender's own endpoint beyond the shared token check, and the 16 persistence findings of AUDIT-COLDCALL.md (none of the five changes was seen to make one worse; the stored open record now also holds the rounding numbers, which is refund-neutral).
- Mixed strategies that combine warm squares with the pot window (warm squares are older code and out of this scope).

Repro scripts (run from the root of a slim export of b596408): `h.js` (harness), `m1-buy-pot-chaser.js`, `m1b-buy-only-pot-part.js`, `d1-validation-edges.js`, `d2-admin-http.js` (port 4636), `d3-snapshot-cost.js`, `e1-presets-label.js`, `a1-carry.js`, `b1-pot-conservation.js`, `c1-rounding.js`.
