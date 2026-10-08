# Adding a game to The Ping: the contract

A game = one server module + one client `registerGame` file. This file is the contract every game follows. The money part is not advice: the soak (`tests/soak/`) fails the build when a game breaks it.

**Status (P6 wave 2, 2026-10-06).** The rule and the API below are fixed and the API now exists on `v2-all` (`transport/game-money.js`, `money/service.js`, `games/index.js`). COLD CALL is on `ctx.money` (branch `p6-w2c`: `round`, `open`, `settle`, `void`, the office pool, `recover` and `audit`; `cold-call/PULL-STATE.md` "P6: money on the ledger"). Bender still plays through `ctx.wallet.spend` then `ctx.wallet.credit` in one handler.

## 1. The one money rule

1. Every cent or chip that exists is a balance of an account in the ledger (`money.jsonl`). Nothing else is money.
2. Every movement is ONE ledger write (a transfer or an all-or-nothing batch) with a `ref` that names the event. The same ref with the same content is a no-op; the same ref with different content is refused.
3. A game never holds money: not in a variable, not in its own file, not "until the end of the tick".
4. The ledger is written first. Only after the call returns may the game change its own state or tell the client anything.
5. A crash at any point leaves every stake either with its owner, in an escrow that boot can return, or settled. Nothing is paid twice.

## 2. Accounts

| Account | Holds | May go negative |
|---|---|---|
| `bank:<key>` | a player's chips | no |
| `play:<key>` | a player's Play $ (cents) | no |
| `seat:<tableId>:<key>` | a poker seat: stack plus what is committed to the live hand | no |
| `pot:<tableId>:<handNo>` | a hand's pot; non-zero only inside the hand's own batch | no |
| `escrow:<game>:<key>:<roundId>` | the stake of ONE open round of a game. Non-zero only while that round is open | no |
| `pool:<game>:<name>` | a pot shared by the players of one game (COLD CALL: `pool:coldcall:office`). One balance per currency | no |
| `house:<game>` | the game's result: stakes taken minus wins paid | yes |
| `mint:*`, `admin:adjust`, `fx:chips`, `fx:play` | where money enters, leaves, or changes currency | yes |

`<key>` is the account key (lowercase, no `:`). `<roundId>` is made by the server, has no `:`, and is stored with the round. A balance is per (currency, account): `pool:coldcall:office` has a chips balance and a Play $ balance.

A new game needs: `house:<game>` in `SOURCE_ACCOUNTS` (`money/ledger.js`) and its id in `GAMES` (`money/service.js`). Nothing else in `money/`.

## 3. `ctx.money`: the only way a game touches money

`ctx.money` is bound to your game id. You cannot name another game's accounts. `cur` is `'play'` or `'chips'`. Amounts are whole units (1 unit = 1 Play cent = 1 chip), non-negative safe integers.

```
money.balance(key, cur)                              -> what the player can spend now
money.round(key, cur, roundId, { cost, win, pool })  -> an instant round. ONE batch.          ref <game>:<key>:<roundId>
money.open(key, cur, roundId, cost)                  -> stake into escrow. ONE transfer.      ref <game>:<key>:<roundId>:open
money.settle(key, cur, roundId, { win, pool, stake }) -> close an open round. ONE batch.      ref <game>:<key>:<roundId>:close
money.void(key, cur, roundId, why)                   -> refund an open round. ONE transfer.   ref <game>:<key>:<roundId>:close
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

What the calls guarantee:
- `round` and `open` throw `funds` before anything is written when the player cannot pay. Nothing is parked.
- `settle` and `void` share ONE ref per round. Whichever is written first closes the round for good; the other answers `round_closed` and writes nothing. A retry of the identical close (same kind, currency, `win`, pool and, when given, `stake`) answers `dup`; anything else on a closed round answers `round_closed`, also a `round` whose ref is already in the ledger with other numbers. `round_closed` and `dup` both mean "already played": advance your state, pay nothing.
- `settle`'s `stake` (optional, a non-negative integer) is what you believe the round's escrow holds. When the escrow of that round in that currency holds anything else the call throws `stake_mismatch` and writes nothing; `stake: 0` says "this is a free round, there must be no escrow". Not given: the escrow is settled whatever it holds. Pass it whenever you know it: a mistyped round id otherwise settles as a free round.
- `pool_short`: a `prize` larger than the pool holds after this batch's own `feed`. `args`: the outcome of `round` / `settle` is not a plain object, has a key that is not `cost` / `win` / `pool` (`round`) or `win` / `pool` / `stake` (`settle`), or its `pool` has a key that is not `name` / `feed` / `prize`; `open`'s `cost` is not a number. Thrown before anything is written.
- `feed` is at most the stake of the same batch (`cost` for `round`, the escrow for `settle`), else `amount`: a free round cannot feed a pool, it can still win a prize.
- A round with no stake (a free round) has no escrow: `open` with cost 0 writes nothing, `void` writes nothing, `settle` writes the win under the `:close` ref.
- Every call returns only after the line is on disk (fsync). Every call fires the wallet push to the player's sockets; you do not emit balances yourself except inside your own result payload (`money.balance`).

### The ref rule

A ref names the EVENT, never the attempt. Its id is fixed before the first attempt and survives a retry and a restart: a hand number, a round id stored in the round's record, a claim day, an achievement id, an entitlement's serial, an id the client sent with an admin action. A counter that restarts with the process is allowed only where the ledger's own state refuses a second attempt (a buy-in when the seat exists, a cash-out of an empty seat, a top-up when not eligible).

### Boot: one recovery rule for the whole site

At boot, before the server listens: every non-zero poker seat goes back to its owner's fund (as today). Then for every game: `mod.recover(money.openRounds())` if the module has it; the game must settle or void each round, or keep it open and report it in `audit()`. Every escrow of that game that is still non-zero and not reported is voided by the registry (`why = 'boot'`). A game record with a stake but no escrow, or whose `:close` ref is in the ledger, is stale: drop it, pay nothing.

## 4. What a game keeps for itself, and the order of writes

Game state (reels in progress, the record of an open round, free rounds, leads, streaks, a sub-cent remainder, statistics, history) lives in the game's own file. It is never money and is never read as money. Rules:

- **Ledger first, state second**, in the same synchronous handler, state flushed to disk before the result is emitted when the round changed an entitlement or stays open. No `await`, timer or callback between reading a balance and writing the batch.
- **A crash between the two leaves the state at most one round behind the ledger.** That must be harmless: open rounds are reconciled from the ledger at boot (section 3); a round paid for by an entitlement (a free spin, a Callback) takes its `roundId` from the entitlement's serial, written when the entitlement was granted, so playing it again hits the same ref and cannot pay again (`dup` or `round_closed` = already played: advance the state, pay nothing). What a crash may cost a player is the entitlements granted by that one round; never a balance.
- **An entitlement is not money.** It becomes money only as the `win` of a later `round` or `settle`. No call takes an entitlement as its amount.
- **The gate of a mint is the ledger.** "Already claimed today" is `ledger.has('bonus:<key>:<day>')`, not a flag in another file.
- **An open round runs on the config it was opened with.** Snapshot the config into the round's record. A live config change, and a restart, never change the price or the pay table of an open round.
- **Results after the write.** If a money call throws, emit an error, never a result. A result the client received is in the ledger.
- **What the ledger cannot remember.** A free round whose outcome is 0 (no win, no prize) writes no line, so after a crash between the money call and the state flush it is played again with a new draw. The player never saw the first result and cannot cause it. Also (decision D3): leads, the Callback and its remainder are game state, not ledger balances; a crash can cost the entitlements granted by the one round in flight, never a balance.

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

## 6. Server module (`games/<id>.js`)

1. Export `{ id, name, kind: 'solo'|'table', init(ctx), handlers, onDisconnect?, recover?, audit }`.
2. `handlers` is `{ event: (socket, payload, ctx) => ... }`. `games/index.js` registers each as `g:<id>:<event>` and rejects sockets that are not signed in (`error {code:'auth'}`) before your handler runs. `this` is your module.
3. Add `'./<id>.js'` to `MODULES` in `games/index.js`.
4. `ctx` = `{ io, accounts, money, now, rng, social }`. Account key: `socket.data.acct.key`. (`ctx.wallet` is in Bender's ctx only; every other module's ctx has none: `spend` then `credit` in one handler is `money.round` under an old name. New games do not use it.)
5. `recover(rounds, ctx)` and `audit()` must be synchronous: one that returns a promise is an error at boot and its game's escrows are left alone. `audit()` returns `{ openRounds: [{ key, cur, roundId, amount }], pools: { '<name>': { chips, play } } }` from your OWN state. The soak compares it with the ledger after every step: an escrow you do not list, a round you list with no escrow, or a pool number that differs is a failed build.
6. Resolve the round first with a pure function and the injected `ctx.rng`, then one money call, then state, then emit.
7. Rate-limit every event a client can spam. Validate every payload field against a fixed list (bet levels, currencies, choices).
8. Keep the math in `games/<id>-engine.js` with a `games/<id>-sim.js` that prints the payback, and tests in `tests/<id>.js`.

## 7. Client (`public/games/<id>/...`)

```js
Shell.registerGame({ id: '<id>', name: 'My Game', icon: '...', mount(el, ctx) {}, onFocus() {}, onBlur() {}, badge() { return ''; } });
```
The shell owns the socket: it forwards `g:<id>:*` events and shows `wallet` pushes. Balances on screen come from `wallet` pushes and your result payloads, never from client arithmetic.

## 8. Before a game ships

- Its own tests, plus an actor in `tests/soak/actors/<id>.js` (see `tests/soak/README.md`): spins or rounds in both currencies, a round left open across a kill, a void, a pool win while another player's round is open if it has a pool, a live config change mid-round if it has live config.
- `node tests/soak/prove.js` passes: the clean soak finds nothing and every seeded bug is caught.

## 9. The kit: `node tests/game-kit.js <gameId>`

A game is pluggable when it passes the kit and has the 4-line registration (`MODULES` in `games/index.js`, `house:<id>` in `SOURCE_ACCOUNTS`, `<id>` in `GAMES`, the `.kit.js` adapter). `node tests/game-kit.js --all` runs every game in `MODULES`; `node tests/game-kit.js coinflip` runs the worked example (`games/_example-coinflip.js`, about 40 lines: copy it). `node tests/game-kit-selftest.js` proves the kit itself: nine deliberately broken toys must each FAIL the check named for them.

The kit runs the REAL ledger, service, `ctx.money` and registry (with boot `recover()`) in a temp dir and plays the game through its own socket messages. It knows nothing of the game's rules; the game tells it how in `games/<id>.kit.js`. An adapter never touches money or the ledger: it only sends the game's messages through the kit's driver `g` and reports what the CLIENT was shown.

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
  play(g, sock, { cur, bet, i }) { ...; return { roundId, cost, win }; },   // ONE whole round, to its end
  heldPoints: [{                         // every point where a round stays open and a kill is meaningful; [] for an instant game
    name: 'stepped',
    hold(g, sock, { cur, bet, i }) { ...; return { roundId, cost, bootWin }; },   // bootWin = what a restart must pay (the number the client was last shown), null = any
    finish(g, sock, held) { ...; return { win }; },                               // end the held round
  }],
};
```
`g.call(sock, ev, payload)` sends `g:<id>:<ev>` and returns the game's answer payload, or throws `Refused` when the game answered an error. `g.try` returns `{ ok, error, payload }` instead. `g.rng` is the seeded rng that is also `ctx.rng`.

Checks, each in BOTH currencies (`PASS|FAIL <game> <check>/<cur> <detail>`):

| check | what it proves |
|---|---|
| `registration` | in `MODULES`, `house:<id>` in `SOURCE_ACCOUNTS`, id in `GAMES`, has `audit()`, `init()`, handlers |
| `escrow` | every ledger line has a ref `<id>:<key>:<roundId>[:open\|:close]` and touches only the player, this round's escrow, `house:<id>`, `pool:<id>:*`; one non-zero escrow while open, zero after; house + pool moved by stake minus win; the win the client was shown is the win the ledger paid |
| `restart` | kill at every held point, and at every `ctx.money` call a round makes (crash before and after it): stake with its owner, or settled once, or refunded once (what boot paid = `bootWin`); a second boot writes nothing; replaying the round's messages afterwards, also claiming the other currency, writes nothing; `audit()` equals the ledger's escrows |
| `replay` | every message sent twice (at once, and 200 ms later), and every message of a closed round replayed: no second spend, no second pay, no line written by a replay |
| `sockets` | 2 and 10 sockets of one account, same tick and spaced: no negative balance, stakes are bet levels, `oneOpen` honoured, balance = start - staked + returned |
| `mix` | follow-up messages claiming the other currency (`mode`, `cur`, `currency`) and a held round resumed after a restart: lines only in the opening currency, the other currency's balance, house and pool untouched, no fx account |
| `errors` | the ledger fenced (`foreign_write`): no result is shown, no line written, nothing carried in memory; after the restart the balance is what it was and the next round pays exactly what the client was shown |
| `input` | negative, zero, fractional, NaN, Infinity, string, null, object, array, above max, below min, bad mode, junk payload, another account's round id: refused with no ledger line and no balance moved |
| `quarantine` | lines from an unknown source, a non-existent house and a wrong currency, written in the game's name, are quarantined at boot and change no balance; the game still plays |
| `ledger-replay` | an independent replay of `money.jsonl` (no ledger code) equals the service balances per currency after every world above and a mixed one; sum over all accounts is 0; no holder account ever negative |

A kit FAIL is a bug in the game or a hole in the contract, never a reason to loosen the kit. If the contract itself lacks a call the game needs, change `transport/game-money.js` and this file once, for all games.
