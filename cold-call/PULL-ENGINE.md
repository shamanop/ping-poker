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
  coldAt: null,     // ms timestamp of the next cold event, or null
  day: null,        // last day the daily appointment was claimed ("YYYY-MM-DD")
  streak: 0,        // consecutive days
  rounds: 0, callbacks: 0   // counters
}
```
Why `avg`: leads earned at a small bet must not fire a big-bet Callback. The Callback is played at
`cb.bet` = the largest BET_LEVEL <= avg + 0.5 (min 10). Lead fill: `avg = (avg*lt + bet*fillT) / (lt + fillT)`; leaks and carry-over keep `avg`.

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
  pot: { feedBps: 50, oneInPerDollar: 20000, seed: 0, minBal: 100, maxPayX: 10000 },   // slice of every bet in basis points; hit chance per spin = (cost cents / 100) / oneInPerDollar; seed in CENTS (house money, tracked); minBal cents; prize = min(bal, maxPayX * bet)
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
1. LEAD LIST: fill by `fill.dead` if round paid 0 (before ONE MORE CALL), `fill.win` if it paid, `fill.bonus` if a natural bonus triggered (instead). At `lt >= list*10`: arm `cb = { bet: level(avg) }`; with `carryOver` the excess stays (`lt -= list*10`, `avg` kept), else `lt = 0`. A Callback round does not fill and cannot arm another.
2. WARM: at the end of a BASE spin (not a bonus spin) with `phones === 0` and marked squares (`hot`, including warm squares carried in): each marked square independently stays warm with `warm.chance`, drawn in position order from the sub-rng, until `warm.cap`. If a phone fired, marks are consumed, `warmOut = []`. Warm squares start the next paid base spin as `hot` (so they can fire a phone feature). They die at the first cold event.
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
the pot hit rate per 1M spins and the average pot at hit. `--bonus [runs=2000000]`: per bonus kind average, P(cap), with each pick policy and the gamble taken / banked. Existing modes untouched.

## 6. Tests (self-contained, `node tests/coldcall-pull-engine.js`, `node tests/coldcall-pull-server.js`; `tests/coldcall.js` requires both at its end so one command runs all)
Engine: tick/cold leak (floor, batch, clock, warm expiry); lead fill dead > win, carry-over, Callback armed at exactly list size, lead-weighted `avg` and `cb.bet` (small-bet fill cannot fire a big Callback; flat bettor exact);
Callback round (free, bet = cb.bet, no fill, cb cleared, `status` done); warm out/in (cap, chance 0 and 1, consumed when a phone fires); ghost (equals what `phoneFeature` yields from the same sub-rng; never changes win; absent when a phone fired);
pick (default first, chosen square upgraded, invalid p rejected, same rng consumption for every choice); more (bank / take win / take lose with a scripted draw, cap respected, exact `pWin`); decisions replay determinism; buys never touch state; daily + streak (consecutive, gap, same day twice);
legacy equality (`pull.on=false` and legacy calls reproduce old results seed for seed); `W*mult` never > cap in a 200k-round sweep; total win <= cap always.
Server: settlement for Play $ AND Chips over every bet level and every buy including pot slice and a taken gamble (balance before - cost + win + pot prize = after; pot invariant `fed + seeded = paid + bal`); state persists across a restart (new `games()` over the same files);
decision timeout (short `timeoutMs`), disconnect, autoplay, rejected spin while a decision is open, wrong account / wrong round / bad `p`; open decision at restart is refunded exactly once; two players racing for the pot in one tick (injected `potRng` forcing a hit: one wins, the other gets nothing, pot invariant holds, wallet sums equal);
feed events fire with the right shape and only to signed-in sockets; Play $ and Chips state do not leak into each other.
