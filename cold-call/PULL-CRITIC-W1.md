# THE PULL wave 1: critic report (money bugs and stuck rounds)

Reviewed 45e3252..0a6f4c3 (HEAD a98fb53 at the time of the run). Read-only. Scripts are in /tmp/crit (h.js is the harness, copied from
tests/coldcall-pull-server.js). Both pull test files pass (31 + 28). Engine copy is byte-identical.

Result: 6 findings REPRODUCED, 3 PLAUSIBLE. No settlement bug found in either purse (details under "Checked and holding").

## Ranked findings

### 1. REPRODUCED, HIGH: warm squares are carried across bet sizes, so low-bet play can pre-charge a max-bet spin
games/coldcall-engine.js:477 (warm in as `hot`), :531 (`ns.warm = pull.warmOut`), cold clock only (no bet stored in state).
Scenario: spin at the minimum bet until >= 3 warm squares exist (about 1 spin in 20), then bet 2500 once. /tmp/crit/warm.js, /tmp/crit/warm2.js
(engine only, provisional knobs):
```
flat spin, no warm squares   RTP 104.18%      with warm [0,1] 127.81%   [7,8,9] 137.14%   [6,7,8,9] 147.60%   [2,8,14,20] 149.08%
flat 2500c paid-spin RTP 108.24%
attacker (2500 only when >=3 warm, else 10c): 270,779 big spins, big-spin RTP 146.4%, small-spin RTP 107.8%
attacker (2500 only when >=4 warm):           134,044 big spins, big-spin RTP 151.5%
```
The big spin earns about +38 to +43 points of RTP over a flat max bettor, about +$9.5 expected per $25 spin, and the setup costs nothing (small spins are
also above 100% with these knobs). The sim's "+5.8% of stake from warm" is the flat-bettor number; the exploit is priced by bet, not by flat averages.
Fix suggestion: store the bet the warm squares were made at (`warmBet`) and drop them (or only honour them) when the next paid bet is larger.

### 2. REPRODUCED, LOW-MEDIUM: result of a pending round is delivered to whatever account is on the socket when it settles
games/coldcall.js:166 (settle emits to `rec.socket`), :262 (`onDisconnect` is the only owner check; server.js `auth_login`/`auth_logout` change
`socket.data.acct` without a disconnect).
Scenario (/tmp/crit/misc.js #1): ann has a pending ONE MORE CALL, the socket is re-signed-in as bob (or logs out and bob logs in), the 20 s timer fires:
```
result of ann's round delivered to the socket now signed in as bob: true status done includes ann wallet {"play":1001000079,"chips":10000}
```
Money is fine (credited to ann), but ann's balances and script leak to bob, and a logout never defaults the round early.
Fix suggestion: on settle/void check `rec.socket.data.acct` still maps to `rec.nk`, else skip the emit; also default open rounds on `auth_logout`.

### 3. REPRODUCED, LOW-MEDIUM: flipping `pull.on` (the "live" master switch) while a decision is open pays a different round
games/coldcall-engine.js:418 (`!P.on` returns a legacy round, ignores tape/decisions), games/coldcall.js:194 (`autoSettle`) and :309 (`decide`).
Scenario (/tmp/crit/misc.js #2): player sees W = 19.9x at ONE MORE CALL, operator sets `CFG.pull.on = false`, player banks:
`pending showed W = 19.9x ... player banks -> paid 10.4x`. The shown bonus is replaced by a brand new legacy round (cost stays the recorded one, so no
refund mismatch, but the win is not the one seen). Same class if the levers agent edits `more.*`/`pick.*` while rounds are open.
Fix suggestion: snapshot the pull config into the open record and replay with it, or void (refund) every open round when `pull.on` changes.

### 4. REPRODUCED, LOW: window where a prize is paid and the pot file still holds it (double pay on a crash within 50 ms)
games/coldcall.js:141-144 (`potChanged()`/`setPlayer` are debounced), :148 (prize credited), :144 only flushes `if (wasOpen)`.
Chips: server.js `adjustBank` writes bank.json synchronously, coldcall-pull.json is written 50 ms later. /tmp/crit/crash.js: right after a same-tick
settle that hit the pot, disk shows `{"bal":5000,"fed":5000,"paid":0}` while the player already holds the 5000 prize; a crash there restores the prize
to the pot and it is paid again later. (Crash not simulated, the stale-disk state is.)
Fix suggestion: `store.flush()` before the prize credit whenever `potWon` (not only `wasOpen`).

### 5. REPRODUCED, LOW: object-key hazard for account names like `__proto__`
games/coldcall-store.js:48 (`(data.players[key] = data.players[key] || {})[mode] = state`). NAME_RE allows `_`. /tmp/crit/misc.js #3:
`store.setPlayer("__proto__","play",state) -> ({}).play = {"v":1,"lt":77}`. In the current flow the wallet throws first for such a name (wallet.js has the
same class: `({}).play` is polluted with NaN after a `__proto__` spin), so the store is not reached today, but a Callback (cost 0) skips `wallet.spend`.
Fix suggestion: `Object.create(null)` maps in wallet and store, or reject keys that are `__proto__`/`constructor`/`prototype` at signup.

### 6. REPRODUCED, LOW: the other tab of the same account never hears about a defaulted round
games/coldcall.js:166, :187, :264 (result and `voided` go to `rec.socket` only). /tmp/crit/life.js: owner socket disconnects, same-account socket `a2` gets
no result for that round (`false`); it only gets the `wallet` push. A flaky mobile connection that reconnects as a new socket loses the decision (banked by
default) and gets no message saying so. Not a money bug.
Fix suggestion: also emit `g:coldcall:result` / `voided` to every live socket of `rec.nk`.

### 7. PLAUSIBLE, LOW: crash window at spin loses the cost
games/coldcall.js:236-239. Order is putOpen (memory) -> `wallet.flush()` -> `store.flush()`. A crash between the two flushes leaves the spend on disk and no
open record, so restart has nothing to refund. The order is the safe one (reverse order would mint money); the loss is bounded to one cost per crash.
Also `voidStored` (:200-207) deletes the record before the credit and flushes the wallet after the whole loop, same trade-off. Fix suggestion: write the open
record into wallet.json (same file as the spend) or journal it before the spend.

### 8. PLAUSIBLE, LOW: progressive-style pot chasing
games/coldcall.js:133-137. Hit chance is `cost / 2,000,000` per spin and the prize is the whole pot up to 10000x bet, so expected prize per stake unit is
`bal / 2,000,000`. With the pot "always on screen", betting only when `bal` is above about 40,000 cents ($400) makes the pot worth more than the 2% edge
(at 100,000 cents it is 5% of stake), i.e. the pot is advantage-playable by waiting (the equilibrium pot at defaults is about $100). MC of an all-comers pot at flat bets
(/tmp/crit/potfair.js) is fair per bet class (prizes/fed 1.06, 0.98, 1.00), so only the timed strategy is the issue.
Fix suggestion: hit chance independent of bal can stay, but cap the prize to a multiple of what the player fed, or hide the exact pot size.

### 9. PLAUSIBLE, LOW: `seed > 0` mints currency
games/coldcall.js:137. Each prize re-adds `seed` cents from nothing (tracked in `seeded`, invariant holds, but chips are the poker bank). /tmp/crit/pot.js
with seed 500: two prizes in one tick, `seeded` 1500. Fine at the default 0; flag it before the levers agent sets a seed.

## Checked and holding (so nobody re-checks)
- Settlement, both purses (240 rounds x every bet level x every buy, plus the tests): `before - cost + win + prize = after`, Callback paid at `cb.bet` with cost 0
  and no pot, pending Callback (pick) leaves the wallet untouched until settle (/tmp/crit/cb.js). Pot slice exact (4000 mixed spins: fed 588,278 = floor(cost x 50 / 10000),
  rem carried), `fed + seeded = paid + bal` after every case, two players in one tick for the pot: one prize, second gets nothing (seed 0) or the seed (seed > 0), wallets sum
  (/tmp/crit/pot.js).
- Restart void: play and chips, open in both currencies at once, refunded exactly once, second `init` over the same files refunds 0 (/tmp/crit/restart.js, both.js).
- Lifecycle: timeout (auto 'timeout', record dropped, win credited once), decide after settle -> `no_round`, other account -> `forbidden`, wrong kind / non-boolean take /
  bad square rejected, double decide -> second is `no_round`, spin while open -> `decision_open` (also for a buy), second socket of the account may decide and both sockets get the
  result, non-owner disconnect does not default, owner disconnect does, `auto:true` never pends (/tmp/crit/life.js). Spin in the OTHER currency while a decision is open is allowed
  (matches the contract: per key and mode).
- Replay: 40,000 random rounds (all buys, Callbacks, warm, random decisions): tape-recorded growing-decision replay equals one-shot replay, 0 mismatches (/tmp/crit/replay.js).
  Partial scripts: 846 pick-pending and 848 more-pending rounds, the only partial-vs-final differences are `phone`, `hotOut`, `pickPending` of the decision spin (/tmp/crit/leak.js).
  The gamble draw `u` is taken at decide time, after the choice.
- Cap: 400k rounds with cap 300x, more.mult 3, boosted pick: 0 over cap, 0 clipped gambles, EV taken / (rtp x W) = 0.9997 (/tmp/crit/cap.js).
- Lead-weighted avg: "fill at 10c, cash at 2500" yields Callback value per wagered unit 1.62 vs 2.09 for a flat 50c bettor, so it is not an exploit (/tmp/crit/avg.js).
- QA force hook only with COLDCALL_TEST=1; with a pending Callback a forced spin is a paid legacy round and leaves state (cb, warm, lt) untouched (/tmp/crit/force.js). A buy never claims
  a Callback; `p.auto` can only make the player's own choices worse.

## games/coldcall-sim.js: what would mislead the levers agent
1. Flat bet only: it cannot see finding 1 (warm across bets) or finding 8 (pot timing). A flat 98.0% target is not the exposure; the exploit-priced warm lever is worth about 7x the quoted 5.8%.
2. `t += 1000` and one fixed `DAY` per session: cold clock never fires and the daily/streak mechanic is claimed once per session, so `cold.*`, `daily.*`, warm lifetime and
   the "lead leak" cannot be tuned from this sim. Treat Callback and warm values as upper bounds for casual players.
3. The pot RTP part is `feedBps/10000` by assumption (sim notes admit it); the sim pot is one pot per batch with one bettor, so "avg pot at hit 41x bet" and "paid out 0.246%" say nothing about the real shared pot.
4. `--bonus` and the `best` pick policy: all picks draw from the same PICKREV table, only the neighbour/upsell effect depends on position, so `first` vs `best` differences are position effects; the server's auto default is `first`.
5. The headline 315% payback is the Callback at provisional `list`/`fill`; every other number in the smoke output is conditional on that Callback cadence (leads per spin, dead share, cap hits).
