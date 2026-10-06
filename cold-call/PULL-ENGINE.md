# THE PULL: engine + server contract (wave 1)

Written by the lead, 2026-10-06. Builders code against THIS file. If something here is wrong or impossible, tell the lead
(do not silently change the contract). Spec: `PULL.md`. Existing engine contract: `ENGINE-V2.md` (still true with `pull.on = false`).

## 0. Ground rules
- Legacy must not move: `createEngine().round / playSpin / playBonus` and `resolveRound` keep their exact behaviour and rng
  draw order when called the old way (no state, no decisions). All 48 existing tests in `tests/coldcall.js` stay green. The c24
  numbers (RTP 97.9x) must not change for the legacy calls. New behaviour lives in NEW entry points and in new optional params.
- Master switch `CFG.pull.on` (read live, not baked). `false` = the server runs the old stateless path (no state, no pot, no
  decisions, no feed). Default `true`. Existing server-level tests that script the rng set it to `false` for their duration;
  new tests run with it `true`.
- Money is whole tenths of the bet in the engine, whole cents on the server (`Eng.cents`). Never round money. The engine copy
  at `public/games/coldcall/engine.js` stays byte-identical (copy it after every engine change; the byte-sync test must pass).
- The engine stays pure: no `Date.now`, no `Math.random`, no node APIs. Time comes in as `ctx.now` (ms) and `ctx.day` ("YYYY-MM-DD").
- Extra draws that must not shift the draw order of the round itself (warm squares, ghost) are taken at the very END of the round
  from a sub-rng: `sub = rngFrom(Math.floor(rng() * 4294967296))`, exactly one draw from the main stream, only when needed.

## 1. Player state (per account, per currency; the engine never sees the account)
```
state = {
  v: 1,
  lt: 0,            // lead list fill in TENTHS of a lead (0..500 for a 50-lead list; shown as floor(lt/10))
  avg: 0,           // lead-weighted average bet in CENTS of the leads in the list (float, exact for a flat bettor)
  cb: null,         // THE CALLBACK pending: { bet } (cents) or null
  warm: [],         // warm squares (positions 0..29, ascending)
  warmBet: 0,       // CENTS: the bet the current warm squares were made at (0 when warm is empty)
  coldAt: null,     // ms timestamp of the next cold event, or null
  day: null,        // last day the daily appointment was claimed ("YYYY-MM-DD")
  streak: 0,        // consecutive days
  rounds: 0, callbacks: 0   // counters
}
```
Why `avg`: leads earned at a small bet must not fire a big-bet Callback. The Callback is played at
`cb.bet` = `cbBet(avg)` = the exact lead-weighted average rounded to the nearest 10 cents, clamped to [10, 2500] (NOT a bet level: any integer multiple of 10 in [10, 2500]; `Eng.cents` is exact for all of them; 2026-10-06, critic F2: the old floor to a level turned a $25 bettor's first Callback into $10 after one daily claim). `cbLevel` is kept as an alias of `cbBet`. Daily leads stay at stake `min(bet, daily.stakeCap)`, so the first Callback of a big bettor is diluted by about `dailyLeads / list x (bet - stakeCap)` cents (one daily claim of 3 leads: 2000-lead list, flat $25 -> average 2496.4 -> $25.00; 50-lead list -> average 2356 -> $23.60). Lead fill: `avg = (avg*lt + bet*fillT) / (lt + fillT)`; leaks and carry-over keep `avg`.

## 2. Knobs: `CFG.pull` (the levers agent owns the VALUES; you own mechanisms; defaults are provisional)
Money knobs are tenths of the bet unless the name says otherwise; lead knobs are in whole leads with at most one decimal
(the engine rounds to tenths of a lead internally).
```
pull: {
  on: true,
  list: 50,                                     // leads for THE CALLBACK
  fill: { dead: 1.2, win: 0.6, bonus: 0.6 },    // leads per paid base spin: round paid 0 / paid > 0 / triggered a natural bonus. Dead MUST be > win (test it).
  callback: { kind: 'bonus1' },                 // 'bonus1' | 'bonus2'; played free (cost 0) at cb.bet, no base spin, never fills the list
  carryOver: true,                              // leads above the list size stay for the next list
  cold: { afterMs: 86400000, stepMs: 21600000, batch: 3, floor: 10 },   // 24 h idle, then `batch` leads go cold every stepMs, never below `floor` leads; warm squares die at the first cold event
  warm: { chance: 0.35, cap: 4 },               // per marked square on a base spin that ended with marked squares and no phone
  ghost: { on: true, maxWinTenths: 10, minTenths: 0 },   // show on a base spin with marked/warm squares and no phone whose pay is < maxWinTenths; only if the ghost pay >= minTenths
  pick: { on: true, minLeads: 2, mult: { bronze: 0, silver: 2, gold: 3, upsell: 2, close: 2 } },  // upgraded square draws from the mode's reveal table with its tier weights multiplied by mult
  more: { on: true, mult: 2, rtp: 0.98, minTenths: 20 },  // ONE MORE CALL: win with probability rtp/mult, pays bonus*mult, else 0; offered only if bonus*mult <= cap
  daily: { base: 3, perStreak: 1, streakMax: 4, stakeCap: 100 },   // free leads on the first paid spin of a day: base + perStreak * min(streak-1, streakMax); stake = min(bet, stakeCap) cents
  pot: { feedBps: 50, oneInPerDollar: 20000, seed: 0, minBal: 100, maxPayX: 10000 },   // slice of every bet in basis points; hit chance per spin = (cost cents / 100) / oneInPerDollar (oneInPerDollar <= 0 or not a number = 0, never; 2026-10-06, critic F5); seed in CENTS (house money, tracked); minBal cents; prize = min(bal, maxPayX * bet)
  feed: { minWinX: 100 },                       // feed a win of this many x bet or more
  decision: { timeoutMs: 20000 },
}
```
`CFG.pull.pot` and `.feed` and `.decision` are used by the server only; the engine exports helpers `potSlice` and `potHitChance` (below).

## 3. Engine API (new, in `games/coldcall-engine.js`, exported)
- `newState()`; `tickState(state, now)` -> a NEW state with the cold clock applied (warm squares cleared at the first cold event,
  `batch` leads cold per step, floor respected, `coldAt` advanced; never mutates the input). `coldInfo(state, now)` ->
  `null | { inMs, leads (whole leads that go cold next), warm (count) }` for the "7 leads go cold in 3 h 12 m" line.
- `playRound(rng, input, decisions)`:
  - `input = { buy: null|'call'|'bonus1'|'bonus2'|'hunt', bet: cents, state, now, day, script: bool (default true), auto: bool, force?: (QA, only with state ignored) }`.
  - `decisions`: array of already-made decisions, in order: `{ k: 'pick', p: <position> }` and `{ k: 'more', take: bool }`. With `auto: true`
    every decision point takes its safe default (pick = the first hot square in reading order, more = bank) and records it in the script as `auto: true`.
  - Returns `{ status: 'done', ... }` or `{ status: 'pending', pending, partial, ... }`. When `pull.on` is false it returns the legacy result
    with `state` unchanged and no decisions.
  - `done`: `{ status, round (engine round fields as today), buy, callback: bool, betCents (the bet actually played: cb.bet on a Callback), costTenths (0 on a Callback), winTenths (FINAL incl. ONE MORE CALL), winX, capped, tier, script, newState, pull }`.
    `pull = { leadsBefore, leadsAfter (tenths), filled (tenths, 0 on buys/Callback), armed: bool (Callback armed this round), daily: null|{ leads, streak }, warmIn: [], warmOut: [], ghost: null|{ pay, closes, leads, script }, decisions: [...], pick: null|{ spin, choices, p, auto }, more: null|{ W, mult, pWin, take, won, auto } }`. All of it also goes into `script.pull`.
  - `pending`: `{ k: 'pick', spin: <bonus spin number>, choices: [positions] }` or `{ k: 'more', W (tenths), mult, pWin, capT }`; `partial` = the script so far, containing ONLY what the player has already seen
    (base spin; completed bonus spins; the current bonus spin up to the decision with the phone feature not yet revealed; for `more`, the whole bonus but not the gamble outcome). `costTenths` is also returned.
  - Replay: `playRound` is deterministic in (rng draws, input, decisions). The server re-runs the round from a recorded tape of rng draws with the longer `decisions`; the pending decision is the first one missing.
  - Callback detection: `!buy && state.cb` => Callback round (free, bet = state.cb.bet, base spin skipped, bonus kind `pull.callback.kind`).
  - Buys (`buy` set) never touch state: no fill, no daily, no warm in or out, no Callback claim; decisions DO apply to buy bonuses.
  - Paid spin order: tick -> daily (if `state.day !== ctx.day`) -> base spin with `hot` seeded from `state.warm` -> natural bonus (decisions) -> ONE MORE CALL -> fill + arm -> warm out + ghost (sub-rng).
- `potSlice(feedBps, costCents, rem)` -> `{ slice, rem }` exact (`n = cost*bps + rem; slice = floor(n/10000); rem = n % 10000`); `potHitChance(cfgPull, costCents)`.
- `rngFrom` unchanged. `resolveRound` unchanged. `CFG.pull` exported through `CFG`.

### Mechanics, exactly
1. LEAD LIST: fill by `fill.dead` if round paid 0 (before ONE MORE CALL), `fill.win` if it paid, `fill.bonus` if a natural bonus triggered (instead). At `lt >= list*10`: arm `cb = { bet: cbBet(avg) }`; with `carryOver` the excess stays (`lt -= list*10`, `avg` kept), else `lt = 0`. A Callback round does not fill and cannot arm another.
2. WARM (tied to a bet, 2026-10-06 critic F1): `state.warmBet` is the bet (cents) the warm squares were made at. A paid spin honours the warm squares as `hot` ONLY at the same bet; at any other bet they are cleared before the round is played (`pull.warmDropped` = how many, `warmIn` = [], the spin is exactly a cold spin at that bet) and the squares the spin itself leaves are made at the new bet. Missing or 0 `warmBet` with warm squares = dropped. A Callback round has no base spin and leaves warm and `warmBet` untouched; buys never touch state; the cold clock clears both. `warmDied` is the cold clock, `warmDropped` is a bet change. At the end of a BASE spin (not a bonus spin) with `phones === 0` and marked squares (`hot`, including warm squares carried in): each marked square independently stays warm with `warm.chance`, drawn in position order from the sub-rng, until `warm.cap`. If a phone fired, marks are consumed, `warmOut = []`. Warm squares start the next paid base spin as `hot` (so they can fire a phone feature). They die at the first cold event.
3. GHOST ("would have closed"): on a base spin with `phones === 0`, marked/warm squares present, cluster pay `< ghost.maxWinTenths`: run `phoneFeature` for those squares on the sub-rng, with the base mode's reveal table, pay NOT added to the win. Script carries the full feature script. It is exactly what a phone landing would have produced; never altered, never re-rolled to look better. Shown only if `pay >= ghost.minTenths`. Costs one main-stream draw.
4. PICK YOUR LEAD: the first phone feature of a bonus (first spin of the bonus where `phoneFeature` runs) with `>= pick.minLeads` hot squares is a decision point. The chosen square's reveal draws from `PICKREV[mode]` (the mode's reveal weights times `pick.mult`); the draw consumes the same single rng value as an ordinary reveal. Script marks the square (`up: 1` on its reveal). Chosen position must be one of `choices`, else the decision is invalid (server rejects).
5. ONE MORE CALL: at the end of every bonus (Callback, natural, bought) that did not hit the cap, `W >= more.minTenths` and `W*mult <= capT`: decision point. `take`: one rng draw `u`; won iff `u * mult < rtp`; final bonus = `W*mult` or `0`. `bank`: final bonus = W. One offer per bonus. Final win is still `<= capT`.
6. DAILY: first paid spin of a new `day`: `streak = day === prevDay(state.day) ? streak+1 : 1`; free leads `daily.base + daily.perStreak * min(streak-1, daily.streakMax)` at stake `min(bet, daily.stakeCap)` cents. No money.
7. COLD: see `tickState`. Spins reset `coldAt = now + cold.afterMs` (`null` when `lt <= floor*10` and no warm squares).

## 4. Server (`games/coldcall.js` + a new `games/coldcall-store.js`)
- **Store** (`coldcall-store.js`): one JSON file `coldcall-pull.json` next to the wallet file (`path.dirname(ctx.wallet.file)`; env `COLDCALL_PULL_FILE` overrides), atomic temp+rename, debounced 50 ms, flushed on exit, exactly like `wallet.js`. Contents: `{ v:1, players: { <key>: { play: state, chips: state } }, pot: { play: {...}, chips: {...} }, open: { "<key>|<mode>": {...} } }`. `init(ctx)` (re)loads the file and voids any open round (below).
- **Spin**: validate as today (+ `auto: bool`). If a decision is open for (key, mode): error `decision_open` with the pending payload. State = `tickState(store state, ctx.now())`. `day` = `America/Chicago` calendar day from `ctx.now()` (server side only, `Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' })`). Rng = a recording wrapper over the module rng (tape). Bet = `cb.bet` on a Callback; cost 0 => no `wallet.spend`.
  Order inside one synchronous block (no await): resolve round -> `wallet.spend` (funds error leaves everything untouched) -> pot slice + hit roll + award -> if done: credit win, commit state, history, emit; if pending: store open record, arm timer, `wallet.flush()`, store flush, emit.
- **Pot** (per currency, in the store): `{ bal, fed, seeded, paid, rem, last: { who, amount, at } }` in cents. Invariant: `fed + seeded = paid + bal` at all times. Each paid spin (spin or buy; NOT a Callback): `potSlice` into `bal`, `fed`. Hit roll uses its own injectable rng (`module.exports.potRng`, default crypto), chance `potHitChance`. On a hit with `bal >= pot.minBal`: prize `= min(bal, maxPayX*bet)`, `wallet.credit(key, mode, prize, ref{pot:true})`, `paid += prize`, `bal -= prize`, then `bal += seed`, `seeded += seed` if `seed > 0`. All in the same synchronous block as the wallet calls, so two players in one tick cannot both take the same pot.
- **Decisions**: handler `g:coldcall:decide` `{ roundId, k: 'pick'|'more', p?, take? }`; validates owner (same account), round id, kind matches the open decision, `p` in `choices`; appends to the decision list and replays from the tape. Next pending or done. Result events are the same `g:coldcall:result` shape plus `pending` / `resolved`. Defaults on: timeout (`CFG.pull.decision.timeoutMs`, `setTimeout().unref()`), socket disconnect of the owning socket (`onDisconnect`), `auto: true`, a new spin by the same account is REJECTED not defaulted. A defaulted round is settled exactly like a chosen one and marked `auto: 'timeout'|'disconnect'|'autoplay'` in the result and history.
- **Never strand money**: a decision open at a server restart is VOIDED at `init`: refund `cost` through `wallet.credit`, drop the record, state untouched, log it. Cost is spent when the round is created, the win credited when it settles, once (record dropped before the credit call returns control; flush both).
- **Result event additions**: `pull` (the engine `pull` block + `state` view `{ leads, list, cb, warm, cold: coldInfo, daily: { claimed today, streak } }`), `pot: null|{ won, amount, who }`, `callback: bool`, `betCents`, `pending`.
- **State event** additions: `pull` view, `pot` (both currencies), `feed` (last 20), `open` (a pending decision for this account, if any).
- **Feed / floor**: ring buffer (50) in memory; broadcast `floor:feed` to every signed-in socket for: `win` (>= `feed.minWinX`, at settle), `bonus` (every bonus, incl. Callback and buys, with kind), `callback` (list full), `pot` (someone took it). Event: `{ id, t, game:'coldcall', kind, who (acct display or key), x, amount (cents), mode, bonus? }`. `floor:pot` `{ mode, bal }` broadcast after any pot change. Handler `g:coldcall:floor` replies `floor` `{ pot, feed }` for the lobby, the other slot and the poker table to use later.
- **History** entries keep working; add `callback`, `auto`, `pot`.

## 5. Sim (`games/coldcall-sim.js`)
Add modes (worker threads, same chunk/seed scheme): `--pull [sessions=20000] [spinsPerSession=2000] [seed]`: sequential flat-bet play
with state (no idle time), `--pickpolicy first|best|none`, `--more bank|take`, `--bet 100` (cents). Prints and `--json`/`--out`:
payback by part per paid spin (base cluster+phone, natural bonus, Callback bonus, ONE MORE CALL net, pot slice (feedBps/10000), total with CI by session batch means);
spins per Callback (mean, P10, median, P90), Callbacks per 100 spins, share of spins dead; warm stats (marked-no-phone spins, warm squares created per spin, phone features fired on warm squares,
extra payback attributable to warm: run the same seeds with `warm.chance=0` and diff); ghost frequency per 100 spins and ghost pay stats; value per lead (Callback RTP part / leads filled);
the pot hit rate per 1M spins and the average pot at hit. (Fix round: money in real cents, state carried across sessions unless `--fresh`, `--bet-switch`; see `PULL-SIM-NOTES.md`.) `--bonus [runs=2000000]`: per bonus kind average, P(cap), with each pick policy and the gamble taken / banked. Existing modes untouched.

## 6. Tests (self-contained, `node tests/coldcall-pull-engine.js`, `node tests/coldcall-pull-server.js`; `tests/coldcall.js` requires both at its end so one command runs all)
Engine: tick/cold leak (floor, batch, clock, warm expiry); lead fill dead > win, carry-over, Callback armed at exactly list size, lead-weighted `avg` and `cb.bet` (small-bet fill cannot fire a big Callback; flat bettor exact);
Callback round (free, bet = cb.bet, no fill, cb cleared, `status` done); warm out/in (cap, chance 0 and 1, consumed when a phone fires); ghost (equals what `phoneFeature` yields from the same sub-rng; never changes win; absent when a phone fired);
pick (default first, chosen square upgraded, invalid p rejected, same rng consumption for every choice); more (bank / take win / take lose with a scripted draw, cap respected, exact `pWin`); decisions replay determinism; buys never touch state; daily + streak (consecutive, gap, same day twice);
legacy equality (`pull.on=false` and legacy calls reproduce old results seed for seed); `W*mult` never > cap in a 200k-round sweep; total win <= cap always.
Server: settlement for Play $ AND Chips over every bet level and every buy including pot slice and a taken gamble (balance before - cost + win + pot prize = after; pot invariant `fed + seeded = paid + bal`); state persists across a restart (new `games()` over the same files);
decision timeout (short `timeoutMs`), disconnect, autoplay, rejected spin while a decision is open, wrong account / wrong round / bad `p`; open decision at restart is refunded exactly once; two players racing for the pot in one tick (injected `potRng` forcing a hit: one wins, the other gets nothing, pot invariant holds, wallet sums equal);
feed events fire with the right shape and only to signed-in sockets; Play $ and Chips state do not leak into each other.

## Server builder notes
- 2026-10-06 (server builder): No engine API change needed; `games/coldcall.js` runs against `playRound` as committed (c143360).
- 2026-10-06 DEVIATION from section 4 order: pot slice, hit roll and prize happen at SETTLE (same synchronous block as the win credit), not at spin time. Only `wallet.spend` happens at spin. Reason: a round voided at a restart refunds the full cost, so a slice already in the pot would have been money out of nowhere (chips are the poker bank). A round that settles in the same tick as the spin (the common case) behaves exactly as the contract. Visible effect: a pending round shows `pot: null` and the pot ticks when the round settles.
- Result event: every `g:coldcall:result` carries `status: 'done'|'pending'`, `pending` (engine payload or null), `resolved` (true when this done result closes a round that was open), `auto` (null | 'timeout' | 'disconnect' | 'autoplay'). A pending event has `partial` (the engine partial script), `timeoutMs`, `expiresAt` (server ms), `callback`, `betCents`, `cost`, `pull.state` (the list as before the round), and NO `script` / `totalWin*` / `tier` / `maxed`. Done events carry them. `bet` = the bet actually played (cb.bet on a Callback).
- `decision_open` error carries `open` = the pending event payload. State event adds `pull` `{ on, list, decisionMs, play: view, chips: view }`, `pot` `{ play: {bal, last}, chips }`, `feed` (last 20), `open` (first open decision or null) and `opens` (all). Floor reply event is `g:coldcall:floor` `{ pot, feed }`. A refund the server cannot default emits `g:coldcall:voided` to the owner.
- Feed: a bonus that also wins >= `feed.minWinX` emits both a `bonus` and a `win` event (contract lists them separately). `callback` events have `x: 0, amount: 0`; `pot` events have `x = prize / bet`.
- A decision made on a different socket of the same account is accepted; the result goes to the owner socket and the deciding socket. Disconnect defaults only the owning socket's rounds.
- `tests/coldcall.js` has 47 tests (not 48). With `CFG.pull.on = true` (the engine default) 5 of them fail on result shape (pull on is the new default), with `on = false` all 47 pass: the lead's edit in tests/coldcall.js must set `on = false` for its duration. `tests/coldcall-pull-server.js` forces `on = true` itself and restores the caller's knobs at the end.
- `input.force` (QA hook): the engine plays the legacy path and returns the ticked state; the server commits it, a forced spin is a paid spin (pot slice applies) and a pending Callback is not claimed.

## Engine builder notes
- 2026-10-06 (engine builder; commits c143360, a40cab4 and the sim commit after them). Additions and deviations the server and the UI should know:
- NEW `input.decide(point)`: optional policy callback (the sim uses it). Precedence for each decision point: recorded `decisions[i]` > `decide(point)` (return `null` to fall through) > `auto: true` default > pending. Not needed by the server.
- `pending` results also carry `pull` (what is known so far: `decisions` made, `daily`, `warmIn`, `leadsBefore`, `pick` once chosen), besides `partial`, `pending`, `costTenths`, `buy`, `callback`, `betCents`. For a pick, `partial.bonus.spins[last]` is the decision spin with `pickPending: 1`, `phone: null`, `hotOut: null` and no `win`/`phoneTenths`; for a `more`, `partial.bonus` is the whole bonus (`winTenths` = W, as played) and `partial.pull.decisions` holds the pick.
- Decision errors: `playRound` throws an `Error` with `code: 'bad_decision'` for a wrong kind, a `p` that is not in `choices`, `take` not a boolean, or MORE decisions than the round has points (strict). The server validates before it appends, so this only fires on a server bug; catch it and void the round (refund) rather than strand money.
- DEVIATION (ONE MORE CALL gate): offered iff `W*mult <= capT - (base spin win)` (the cap the bonus was played under), not `W*mult <= capT`, so a taken gamble can never be clipped by the cap and its EV stays exactly `rtp * W`. `pending.capT` is still the full cap. Everything else as written (not offered when the bonus hit the cap, `W < minTenths`, or `W = 0`; `mult` is floored to an integer, < 2 disables).
- PICK: the decision belongs to the FIRST phone feature of the bonus; if that one has fewer than `pick.minLeads` hot squares there is no pick in that bonus (a later phone is not offered it). The picked square draws from `PICKREV` in EVERY reveal round it takes part in (not only the first), `up: 1` on each of its reveals. `engine.PICKREV` is a getter (rebuilt if `cfg.pull.pick.mult` changes); each pick still consumes exactly one rng value.
- Ghost / warm order on the sub-rng: ghost feature first, then one warm draw per marked square in position order (so the ghost equals `phoneFeature(rngFrom(seed), 0, marks, ...)` exactly). The ghost is NOT suppressed when the same spin also triggers a natural bonus (contract wording); the UI can choose not to show it then. Sub-rng draw only when marked squares exist, no phone landed, and warm (`chance > 0 && cap > 0`) or ghost (`on` and base pay < `maxWinTenths`) can act.
- Daily: claimed by `day > state.day` (string compare, so a clock that goes backwards claims nothing) or `state.day == null`; streak +1 only if `day` is the calendar day after `state.day`. NOT claimed on a buy or on a Callback round. Daily leads can arm the Callback; it is then played on the NEXT spin.
- Result extras: `round.bonusRawTenths` (the bonus as played, before ONE MORE CALL), `round.bonusTenths` (paid, after it), `round.callback`, `round.phones`, `round.marked`; `pull.leaked` (tenths lost to the cold clock before this spin), `pull.warmDied`; `pull.pick` is null when no decision was offered, `pull.more.won` is null when banked. `script.parts.bonus` = paid bonus; `script.bonus.winTenths` = bonus as played; `script.pull === result.pull`; `script.callback`, `script.bet`. Script `v` stays 2.
- Buys and state: a buy returns `newState === input.state` (same object, even `null`), `pull.leadsBefore/After = state.lt`. With `pull.on = false` or `input.force` the legacy round is returned with `newState = input.state` (the caller's already-ticked state) and an empty pull block.
- Exports added to the module: `playRound`, `newState`, `tickState(state, now, pullCfg?)`, `coldInfo(state, now, pullCfg?)`, `potSlice`, `potHitChance(pullCfg, costCents)`, `cbLevel(avg)`; the per-engine object also has `playRound`.
- 2026-10-06 FIX ROUND (engine builder A, wave 1 critics): `warmBet` (F1), `cbBet` / exact Callback bet (F2), `potHitChance` 0 for `oneInPerDollar <= 0` (F5), `pull.warmDropped`. State key order is now `v, lt, avg, cb, warm, warmBet, coldAt, ...` (old stored states without `warmBet` simply lose their warm squares at the first paid spin). Server note for builder B: `cb.bet` is any integer multiple of 10 in [10, 2500]; the pot cap `maxPayX * bet` and `Eng.cents` need nothing else. Sim (section 5): money counted in real cents (Callback at `cb.bet`), state carried across sessions (`--fresh` for the old behaviour) with leftover leads reported, pot part = what the pot paid (seed, cap, minBal, `bal > 0` as in the server), `--bet-switch` shows the F1 attacker is neutral; S4 to S6 are listed as known limits in `PULL-SIM-NOTES.md`.
- CONTRACT PROBLEMS for the lead / levers (details in `cold-call/PULL-SIM-NOTES.md`): (1) with the provisional knobs total payback is about 315% (the free bonus1 Callback every ~47 spins is ~200% of stake) so `list` / `fill` must move by about 40x; (2) decisions apply to BOUGHT bonuses and PICK at default `mult` is worth +19% on bonus1 (98x vs 82x plain), so a bonus1 buy (price 84.9x) is about 115% RTP until the price moves or picks are off for buys; (3) warm at chance 0.35 / cap 4 adds about +5.8% of stake to the base phone part; (4) the ghost shows on ~26 of 100 spins at an average of 3.9x.
