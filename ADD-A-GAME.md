# Adding a game to The Ping: the contract

A game = one server module + one client folder + a few registration lines. This file is the contract every game follows. The money part is not advice: the soak (`tests/soak/`) and the kit (`tests/game-kit.js`) fail the build when a game breaks it.
Read `MONEY-SYSTEM.md` first for how the ledger, accounts and flows work. This file is about what a new game must do.

**Naming.** Cash is real money, Chips are free play. In code, Cash is the currency key `play` (cents) and Chips is `chips` (whole chips). Every label a player sees says Cash; every key, account name and message field still says `play`. Never rename a key.

**Status at `money-hardening` (read at `69a44f6`, rechecked after merges up to `057a243`) plus the `mf-kit` branch.**
- Cold Call and Campaign Trail play through `ctx.money` only.
- At `69a44f6`, Ballot Bender spins through `ctx.money.round` but still reads its balances through `ctx.wallet` (`games/index.js:34` keeps `ctx.wallet` for Bender only; `games/bender.js:114,148`).
- **Pending merge of `mf-kit` (head `5ee9799`)**: Bender reads balances through `ctx.money.balance` and no module gets `ctx.wallet`; the kit (`tests/game-kit.js`, `tests/game-kit-selftest.js`), the three adapters `games/{bender,coldcall,campaign}.kit.js`, the example game `games/_example-coinflip.js` and its adapter exist. Everything below marked **[kit]** is written against that branch and is not true of `money-hardening` until the lead merges it.

## 1. The one money rule

1. Every cent or chip that exists is a balance of an account in the ledger (`money.jsonl`). Nothing else is money.
2. Every movement is ONE ledger write (a transfer or an all-or-nothing batch) with a `ref` that names the event. The same ref with the same content is a no-op; the same ref with different content is refused (`ref_conflict`).
3. A game never holds money: not in a variable, not in its own file, not "until the end of the tick".
4. The ledger is written first. Only after the call returns may the game change its own state or tell the client anything.
5. A crash at any point leaves every stake either with its owner, in an escrow that boot can return, or settled. Nothing is paid twice.
6. A round is played in ONE currency from its stake to its payout. A game never moves Cash into Chips or back, and never pays Cash against a Chips stake.

## 2. Accounts

| Account | Holds | May go negative |
|---|---|---|
| `bank:<key>` | a player's Chips | no |
| `play:<key>` | a player's Cash (cents) | no |
| `seat:<tableId>:<key>` | a poker seat: stack plus what is committed to the live hand | no |
| `pot:<tableId>:<handNo>` | a hand's pot; non-zero only inside the hand's own batch | no |
| `escrow:<game>:<key>:<roundId>` | the stake of ONE open round of a game. Non-zero only while that round is open | no |
| `pool:<game>:<name>` | a pot shared by the players of one game (Cold Call: `pool:coldcall:office`). One balance per currency | no |
| `house:<game>` | the game's result: stakes taken minus wins paid | yes, no floor |
| `mint:*`, `admin:adjust`, `fx:chips`, `fx:play` | where money enters, leaves, or changes currency | yes |

`<key>` is the account key (lowercase, no `:`). `<roundId>` is made by the server, has no `:`, and is stored with the round (`transport/game-money.js:31` refuses a round id or pool name with a `:`). A balance is per (currency, account): `pool:coldcall:office` has a Chips balance and a Cash balance.

## 3. `ctx.money`: the only way a game touches money

`ctx.money` is bound to your game id (`transport/game-money.js:27` `forGame`). You cannot name another game's accounts. `cur` is `'play'` (Cash) or `'chips'`; anything else throws `mode`. Amounts are whole units (1 unit = 1 Cash cent = 1 chip), non-negative safe integers.

```
money.balance(key, cur)                              -> what the player can spend now (the wallet only: an open stake is in escrow, not here)
money.round(key, cur, roundId, { cost, win, pool })  -> an instant round. ONE batch.           ref <game>:<key>:<roundId>
money.open(key, cur, roundId, cost)                  -> stake into escrow. ONE transfer.       ref <game>:<key>:<roundId>:open
money.settle(key, cur, roundId, { win, pool, stake }) -> close an open round. ONE batch.       ref <game>:<key>:<roundId>:close
money.void(key, cur, roundId, why)                   -> refund an open round. ONE transfer.    ref <game>:<key>:<roundId>:close
money.openRounds()                                   -> [{ key, cur, roundId, amount }]  every non-zero escrow of this game, read from the ledger
money.closed(key, roundId)                           -> true when the round was played: its :close ref is in the ledger, or (an instant round) its own ref
money.pool(name, cur)                                -> the pool's balance
```

`pool` (optional) = `{ name, feed, prize }`: `feed` units go from the house to the pool, `prize` units go from the pool to the player. Both are legs of the same batch as the round, so a pot can never be fed without the stake being taken, or emptied without the winner being paid.

The legs of a batch, always in this order (each step is checked; no holder account may dip below zero on the way):

| | `round` | `settle` | `void` |
|---|---|---|---|
| 1 stake | player -> `house:<game>` (`cost`) | `escrow` -> `house:<game>` (the whole escrow) | `escrow` -> player (the whole escrow) |
| 2 pool feed | `house` -> `pool` | `house` -> `pool` | - |
| 3 pool prize | `pool` -> player | `pool` -> player | - |
| 4 win | `house` -> player | `house` -> player | - |

What the calls guarantee (`money/service.js` `houseRound:271`, `openRound:287`, `settleRound:323`, `voidAccount:352`; mapping to game codes in `transport/game-money.js:14` `mapError`):
- `round` and `open` throw `funds` before anything is written when the player cannot pay. Nothing is parked.
- `settle` and `void` share ONE ref per round. Whichever is written first closes the round for good; the other answers `round_closed` and writes nothing. A retry of the identical close (same kind, currency, `win`, pool and, when given, `stake`) answers `dup`; anything else on a closed round answers `round_closed`. A `round` whose ref is already in the ledger with other numbers, or an all-zero `round` against a stored one, is also `round_closed`. `round_closed` and `dup` both mean "already played": advance your state, pay nothing.
- `settle`'s `stake` (optional, a non-negative integer) is what you believe the round's escrow holds. When the escrow of that round in that currency holds anything else the call throws `stake_mismatch` and writes nothing; `stake: 0` says "this is a free round, there must be no escrow". Not given: the escrow is settled whatever it holds. Pass it whenever you know it: a mistyped round id otherwise settles as a free round.
- `pool_short`: a `prize` larger than the pool holds after this batch's own `feed`. Nothing is written.
- `args`: the outcome of `round` / `settle` is not a plain object, has a key that is not `cost` / `win` / `pool` (`round`) or `win` / `pool` / `stake` (`settle`), or its `pool` has a key that is not `name` / `feed` / `prize`; `open`'s `cost` is not a number. Thrown before anything is written (`game-money.js:41-49`).
- `feed` is at most the stake of the same batch (`cost` for `round`, the escrow for `settle`; `needFeed`, `service.js:248`), else `amount`. A free round cannot feed a pool; it can still win a prize.
- A round with no stake (a free round) has no escrow: `open` with cost 0 writes nothing, `void` writes nothing, `settle` writes the win under the `:close` ref.
- A ref ending in `:open` or `:close` is reserved: `houseRound` refuses it (`bad_ref`) so an instant round can never burn a round's close ref.
- Every call returns only after the line is on disk (the server opens the ledger with `fsync: 'all'`, `server.js:21`). Every successful call fires the wallet push to the player's sockets (`note`, `game-money.js:25`); you do not emit balances yourself except inside your own result payload (`money.balance`).
- Any other failure becomes the code `internal`, with the original on `.cause`.

### The ref rule

A ref names the EVENT, never the attempt. Its id is fixed before the first attempt and survives a retry and a restart: a hand number, a round id stored in the round's record, a claim day, an achievement id, an entitlement's serial, an op id the client sent with an admin action. A counter that restarts with the process is allowed only where the ledger's own state refuses a second attempt (a buy-in when the seat exists, a cash-out of an empty seat).

### Boot: one recovery rule for the whole site

`server.js` runs, before it listens: `service.bootRecover` (every non-zero poker seat goes back to its owner's fund), then `games.recover()` (`games/index.js:69`). For every game id in `GAMES`: `mod.recover(money.openRounds(), ctx)` if the module has it; the game must settle or void each round, or keep it open and report it in `audit().openRounds`. Every escrow of that game that is still non-zero and not reported is voided by `service.sweepEscrows` (`why = 'boot'`), also for a game id that has no module loaded. A game whose `recover()` throws does not stop the others. A game whose `audit()` throws, or whose `recover()` or `audit()` returns a promise, is not known to hold nothing: its escrows are left alone and the error is reported. A game record with a stake but no escrow, or whose `:close` ref is in the ledger, is stale: drop it, pay nothing.

## 4. What a game keeps for itself, and the order of writes

Game state (reels in progress, the record of an open round, free rounds, leads, streaks, a sub-cent remainder, statistics, history) lives in the game's own file. It is never money and is never read as money. Rules:

- **Ledger first, state second**, in the same synchronous handler, state flushed to disk before the result is emitted when the round changed an entitlement or stays open. No `await`, timer or callback between reading a balance and writing the batch.
- **A crash between the two leaves the state at most one round behind the ledger.** That must be harmless: open rounds are reconciled from the ledger at boot (section 3); a round paid for by an entitlement (a free spin, a Callback) takes its `roundId` from the entitlement's serial, written when the entitlement was granted, so playing it again hits the same ref and cannot pay again (`dup` or `round_closed` = already played: advance the state, pay nothing). What a crash may cost a player is the entitlements granted by that one round; never a balance.
- **A drawn result is final.** Write the drawn result of a round into the round's record BEFORE the money call (Campaign: `pend`), so a refused ledger write never un-draws it: the retry, the idle timer and boot close the round at the result already drawn. A game that replays a round after a crash with a new draw lets a player re-roll.
- **An entitlement is not money.** It becomes money only as the `win` of a later `round` or `settle`. No call takes an entitlement as its amount.
- **The gate of a mint is the ledger.** "Already claimed today" is `ledger.has('bonus:<key>:<day>')`, not a flag in another file.
- **An open round runs on the config it was opened with.** Snapshot the config into the round's record. A live config change, and a restart, never change the price or the pay table of an open round.
- **Results after the write.** If a money call throws, emit an error, never a result. A result the client received is in the ledger.
- **What the ledger cannot remember.** A free round whose outcome is 0 (no win, no prize) writes no line, so after a crash between the money call and the state flush it is played again with a new draw. The player never saw the first result and cannot cause it. Leads, the Callback and its remainder are game state, not ledger balances; a crash can cost the entitlements granted by the one round in flight, never a balance.
- **A damaged state file is loud and kept.** An unreadable state file is never read as "no open rounds" (that would refund a winning run at its stake); keep the damaged file, restore from the backup or fail loudly (Campaign `campaign-store.js`, finding K2-3c / K5-1).

## 5. A game must never

1. Keep a balance, a stake, a pot, a pending win or an owed refund in memory or in its own file as the number that counts.
2. Split one outcome over two money calls (take the stake now, pay the win later in the same round without escrow; pay a win and a pot prize separately).
3. Emit a result, or change its own state, before the money call returned.
4. Catch a money error and carry on as if it was paid.
5. Build a ref from the clock or a per-process counter for something a client or a restart can repeat.
6. Take an amount, a price or a win from the client. The client sends choices; the server computes cents.
7. Call `ledger.transfer` / `ledger.batch`, write `money.jsonl`, `bank.json` or `wallet.json`, or reach for another game's accounts.
8. Leave an escrow non-zero for a round it no longer knows.
9. Create money: every unit a game pays comes from `house:<game>` or its pool, inside a batch. A pool is fed only from stakes.
10. Let a QA or test hook touch a Cash round. A `force` field in a payload is honoured only when the process was started with the game's test switch AND `NODE_ENV` is not `production` AND the round's stored currency is Chips (Cold Call `games/coldcall.js:26`, Campaign `games/campaign.js:28`). Take the currency from the stored round, never from the message that carries `force`.
11. Take a currency from a follow-up message. The currency of a round is fixed when it is opened and stored with the round.

## 6. Server module (`games/<id>.js`)

1. Export `{ id, name, kind: 'solo'|'table', init(ctx), handlers, onDisconnect?, recover?, audit }`.
2. `handlers` is `{ event: (socket, payload, ctx) => ... }`. `games/index.js` registers each as `g:<id>:<event>` and rejects sockets that are not signed in (`error {code:'auth'}`) before your handler runs; a handler that throws answers `error {code:'internal'}`. `this` is your module.
3. Add `'./<id>.js'` to `MODULES` in `games/index.js:7`.
4. `ctx` is the server's game context with `money` bound to your id: `{ io, accounts, social, money, now, rng?, rooms, tables, files, ledger, ... }`. Careful: `ctx.ledger` is the PRESENTATION ledger (`ledger.js`, the nights and net history), not the money ledger; a game has no money ledger and no `ctx.service`. Account key: `socket.data.acct` (a string key, or an object with `.key`); lowercase and trim it as `ctx.money` does. `ctx.wallet` exists only for Ballot Bender at `69a44f6`; **[kit]** after the merge no module gets it. New games never use it.
5. `recover(rounds, ctx)` and `audit()` must be synchronous. `audit()` returns `{ openRounds: [{ key, cur, roundId, amount }], pools: { '<name>': { chips, play } } }` from your OWN state. The registry reads `openRounds` to decide which escrows you keep; the soak compares both lists with the ledger after every step: an escrow you do not list, a round you list with no escrow, or a pool number that differs is a failed build. An instant game returns `{ openRounds: [], pools: {} }`.
6. Resolve the round first with a pure function and the injected `ctx.rng` (fall back to a crypto rng), then one money call, then state, then emit.
7. Rate-limit every event a client can spam, keyed by ACCOUNT, not by socket (a per-socket limit is bypassed by opening more tabs). Validate every payload field against a fixed list (bet levels, currencies, choices).
8. Keep the math in `games/<id>-engine.js` with a `games/<id>-sim.js` that prints the payback, and tests in `tests/<id>.js`. Cap the largest single payout in the engine (the ledger has no cap: `MONEY-SYSTEM.md` section 8) and state it.
9. If the game has live config (admin-changeable math): validate it, MEASURE its payback, refuse a config above 100.0%, make the label the measured value, log one line per change (Cold Call `games/coldcall-livecfg.js`, Bender `games/bender.js` `setLiveConfigChecked`, both behind the admin token routes in `server.js`).

## 7. Client (`public/games/<id>/...`) and the shell

Each current game is a page at `public/games/<id>/index.html?bridge=1` that the shell loads in an iframe. The shell owns the one socket; there is no generic forwarder: `public/shell.js` has a hand-written bridge per game (socket `s.on('g:<id>:state' ...)` blocks, a `to<Game>()` post to the iframe, a handler for the messages the iframe posts back; Bender at `shell.js:335-445`, Cold Call and Campaign next to it). A new game needs its own bridge block there. The registration is one `registerGame` call in `registerBuiltins` (`shell.js:498`):

```js
registerGame({ id: '<id>', name: 'My Game', icon: IC.box,
  mount(el) { const f = document.createElement('iframe'); f.src = '/games/<id>/index.html?bridge=1'; f.title = 'My Game'; el.appendChild(f); },
  badge() { return ''; } });
```
(`registerGame` is `shell.js:73`; it reads `id`, `name`, `icon`, `kind`, `mount(el)`, `badge()`.)

Balances on screen come from `wallet` pushes and your result payloads, never from client arithmetic. The top bar plates show AVAILABLE Cash and Chips (`MONEY-SYSTEM.md` section 7). A game window uses the currency the shell tells it (`wmode`); at `69a44f6` the shell has one mode for all games (`shell.js:14`, finding LEGS-C1, fixed on the unmerged `money-client` branch): a game must send the mode with every bet and the server must take the currency of an open round from the stored round.

## 8. The registration: four lines, plus what tests need

| # | Where | What |
|---|---|---|
| 1 | `games/index.js:7` `MODULES` | add `'./<id>.js'` |
| 2 | `money/ledger.js:28` `SOURCE_ACCOUNTS` | add `'house:<id>'` |
| 3 | `money/service.js:13` `GAMES` | add `'<id>'` |
| 4 | `public/shell.js` `registerBuiltins` (`:498`) | `registerGame({ id: '<id>', ... })` plus the bridge block (section 7) |

Not in the four lines, but the build fails without them:
- **[kit]** `games/<id>.kit.js`, the kit adapter (section 9).
- `tests/soak/invariants.js:8-9`: add `house:<id>` to `SOURCES` and `CASH_SOURCES`. Without it the soak reads the new house account as an unknown account shape (I1).
- `tests/soak/actors/<id>.js`, the soak actor (section 11).
- Editing `money/ledger.js` changes its source hash, so the first boot after the deploy replays the whole journal once (expected, `MONEY-SYSTEM.md` section 2). And rollback: the OLD build's `SOURCE_ACCOUNTS` must know `house:<id>` before a rollback, or it quarantines every line the new game wrote (`RUNBOOK.md` section 2).

## 9. The kit **[kit]**: `node tests/game-kit.js <gameId>`

A game is pluggable when it passes the kit and has the registration above. `node tests/game-kit.js --all` runs every game in `MODULES`; `node tests/game-kit.js coinflip` runs the worked example. `node tests/game-kit-selftest.js` proves the kit itself catches a set of seeded bad games. Exit 0 = all pass.

The kit runs the REAL ledger, service, `ctx.money` and games registry (with boot `recover()`) in a temp dir and plays the game through its own socket messages (`tests/game-kit.js:1-12`). It knows nothing of the game's rules; the game tells it how in `games/<id>.kit.js`. An adapter never touches money or the ledger: it only sends the game's messages through the kit's driver `g` and reports what the CLIENT was shown.

```js
module.exports = {
  id: 'campaign',
  module: 'campaign.js',                 // under games/
  env: { CAMPAIGN_TEST: '1' },           // optional: the QA switch for the game's seeded / forced draws (the kit unsets NODE_ENV)
  files: (dir) => ({ campaign: path.join(dir, 'campaign.json') }),   // ctx.files for the game's own state, under the kit's temp dir
  prepare(mod, { rng, log }) {},         // optional: set module-level hooks (rng, log, ...) before every boot
  crash(mod) {},                         // optional: abandon the module like a kill (clear timers, close stores WITHOUT flushing)
  bets: { good: [100, 500], min: 100, max: 500 },   // legal bets in whole units; the kit derives the bad ones
  oneOpen: true,                         // the game lets an account have only ONE open round
  maxCost: (bet) => bet * 500,           // optional: the most a round of this bet can cost (a bought bonus); default = the bet itself
  playVariants: 3,                       // how many different shapes of a whole round play() has (index i)
  currencies: ['play', 'chips'],         // optional
  open: (cur, bet) => ({ ev: 'start', payload: { mode: cur, bet } }),   // the message that places a bet (the kit sends it with bad values too)
  play(g, sock, { cur, bet, i }) { /* ...; */ return { roundId, cost, win }; },   // ONE whole round, to its end
  heldPoints: [{                         // every point where a round stays open and a kill is meaningful; [] for an instant game
    name: 'stepped',
    hold(g, sock, { cur, bet, i }) { /* ...; */ return { roundId, cost, bootWin }; },   // bootWin = what a restart must pay (the number the client was last shown), null = any
    finish(g, sock, held) { /* ...; */ return { win }; },                               // end the held round
  }],
};
```
`g.call(sock, ev, payload)` sends `g:<id>:<ev>` and returns the game's answer payload, or throws `Refused` when the game answered an error. `g.try` returns `{ ok, error, payload }` instead. `g.rng` is the seeded rng that is also `ctx.rng`.

Checks, each run in BOTH currencies (output `PASS|FAIL <game> <check>/<cur> <detail>`):

| check | what it proves |
|---|---|
| `registration` | in `MODULES`, `house:<id>` in `SOURCE_ACCOUNTS`, id in `GAMES`, has `audit()`, `init()`, handlers; adapter has `bets.good` and an array `heldPoints` (`game-kit.js:247`; an example game is exempt from the first three) |
| `escrow` | every ledger line has a ref `<id>:<key>:<roundId>[:open\|:close]` and touches only the player, this round's escrow, `house:<id>`, `pool:<id>:*`; one non-zero escrow while open, zero after; house + pool moved by stake minus win; the win the client was shown is the win the ledger paid |
| `restart` | kill at every held point, and at every `ctx.money` call a round makes (crash before and after it): stake with its owner, or settled once, or refunded once (what boot paid = `bootWin`); a second boot writes nothing; replaying the round's messages afterwards, also claiming the other currency, writes nothing; `audit()` equals the ledger's escrows |
| `replay` | every message sent twice (at once, and 200 ms later), and every message of a closed round replayed: no second spend, no second pay, no line written by a replay |
| `sockets` | 2 and 10 sockets of one account, same tick and spaced: no negative balance, stakes are bet levels, `oneOpen` honoured, balance = start - staked + returned |
| `mix` | follow-up messages claiming the other currency (`mode`, `cur`, `currency`) and a held round resumed after a restart: lines only in the opening currency, the other currency's balance, house and pool untouched, no `fx:` account |
| `errors` | the ledger fenced (`foreign_write`): no result is shown, no line written, nothing carried in memory; after the restart the balance is what it was and the next round pays exactly what the client was shown |
| `input` | negative, zero, fractional, NaN, Infinity, string, null, object, array, above max, below min, bad mode, junk payload, another account's round id: refused with no ledger line and no balance moved |
| `quarantine` | lines from an unknown source, a non-existent house and a wrong currency, written in the game's name, are quarantined at boot and change no balance; the game still plays |
| `ledger-replay` | an independent replay of `money.jsonl` (no ledger code) equals the service balances per currency after every world above and a mixed one; sum over all accounts is 0; no holder account ever negative |

Not covered by the kit (do these yourself): a live config change mid-round, a pool that several players share while another player's round is open, the client, the game's own state file damaged. These are in the soak actor.

A kit FAIL is a bug in the game or a hole in the contract, never a reason to loosen the kit. If the contract lacks a call the game needs, change `transport/game-money.js` and this file once, for all games.

## 10. Worked example: `games/_example-coinflip.js` **[kit]**

41 lines, instant game: one bet, one coin, 96% return. It is not in `MODULES`; copy it to start. Line by line (numbers are lines of the file on `mf-kit`):

| Lines | What it does and why |
|---|---|
| 5 | `crypto` for the round id and the fallback rng. |
| 7-10 | The only inputs a client may choose from: bet levels in whole units, the win factor (`192` = 1.92x, so 0.5 x 1.92 = 96%), the two currencies, a 150 ms rate limit. Prices and wins are server constants (never-rule 6). |
| 12 | `C` holds the ctx from `init`: `money`, `now`, `rng`. The game keeps no balance. |
| 13 | `lastAt`: last accepted flip per account key, for the rate limit. Not money (never-rule 1). |
| 14-16 | A crypto rng fallback, `keyOf` (the account key lowercased and trimmed, as `ctx.money` does), and `bad()` which emits an `error` with a code. |
| 18-21 | The module shape: `id`, `name`, `kind: 'solo'`. |
| 22 | `init(ctx)` stores the ctx and clears state. |
| 23 | `audit()`: an instant game never holds an escrow, so it reports nothing open and no pool. The registry and the soak read this (section 6.5). No `recover()` is needed for the same reason. |
| 24-25 | One handler `flip`, registered as `g:coinflip:flip` by `games/index.js`, only for signed-in sockets. |
| 26-28 | Rate limit by ACCOUNT key (section 6.7). |
| 29-32 | Validate every field against a fixed list: currency (`play` or `chips`), bet level, the call. A refusal answers and writes nothing. |
| 33 | Resolve the round FIRST with the injected `ctx.rng` (so the kit and tests can seed it). Nothing has moved yet. |
| 34 | Compute the win on the server from the bet level, a whole number of units. |
| 35 | The round id is made by the server (8 random bytes, no `:`). It is the event name in the ref. |
| 36 | The ONE money call: `C.money.round(key, mode, roundId, { cost: bet, win })` writes stake and win as one batch under `coinflip:<key>:<roundId>`. A crash cannot take the stake and lose the win. |
| 37 | A refused call is an error to the client, never a result (rule 4). `funds` is the only code a player can cause; anything else is `internal`. |
| 38 | Only after the call returned: emit the result with `C.money.balance(key, mode)`. The balance is read from the ledger, not computed. |

To make it a real game: copy to `games/<id>.js`, rename the ids, replace lines 7-10 and 29-34 with your engine, do the registration (section 8), copy `_example-coinflip.kit.js` to `games/<id>.kit.js`, run `node tests/game-kit.js <id>`.
A game with a decision or feature in the middle of a round replaces line 36 by `C.money.open(...)` when the round starts and `C.money.settle(..., { win, stake })` or `C.money.void(...)` when it ends, keeps the round's record on disk before replying, and adds `recover(rounds, ctx)` and a real `audit()`. Cold Call (`games/coldcall.js`, `payOut` `:290`, `recover` `:456`, `audit` `:469`) and Campaign (`games/campaign.js`, `closeRun` `:145`, `recover` `:242`) are the two worked examples of that shape.

## 11. Before a game ships

- Its own tests, plus an actor in `tests/soak/actors/<id>.js` (see `tests/soak/README.md`): rounds in both currencies, a round left open across a kill, a void, a pool win while another player's round is open if it has a pool, a live config change mid-round if it has live config.
- **[kit]** `node tests/game-kit.js <id>` passes in both currencies.
- `node tests/soak/prove.js` passes: the clean soak finds nothing and every seeded bug is caught.
- The exposure line: the largest single payout at the top bet and how often (`MONEY-SYSTEM.md` section 8). The ledger has no cap, so the engine is the cap.
- A live config route, if any, refuses a payback above 100.0% and logs every change.
- The rollback note: the old build's `SOURCE_ACCOUNTS` must know `house:<id>` before a rollback (`RUNBOOK.md`).
>>>>>>> money-hardening
