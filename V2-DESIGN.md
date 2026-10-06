# The Ping v2 core: module contracts

Owner: Frank. Base: origin/master 9440541. Branch: `v2-core`. Never push or merge `master`.
These contracts are fixed before the builders start so three of them can work in parallel. Change one only by editing this file first.

## Units and names

- Every amount is a positive safe integer of **units**. 1 unit = 1 chip = 1 Play cent.
- Currency `cur` is `'chips'` or `'play'`.
- Account key = `accounts.js` key (lowercase). Display names are never used for money.
- Cards keep today's shape: `{ rank: '2'..'10'|'J'|'Q'|'K'|'A', suit: '♠'|'♥'|'♦'|'♣' }`.

## File ownership (OWNER tags)

| Path | Owner |
|---|---|
| `tests/v2/**` (socket acceptance, shapes, fuzz, baseline rig) | harness builder |
| `money/**`, `tools/migrate-v2.js`, `tests/v2-unit/money*.js`, `tests/v2-unit/migrate*.js`, `tests/v2-unit/fixtures/**` | money builder |
| `engine/**`, `tests/v2-unit/engine*.js` | engine builder |
| `tables/**`, `transport/**`, `auth/**`, `admin/**`, `server.js`, `tables.js` (deleted), `tests/v2-unit/tables*.js`, `tests/v2-unit/run-tables.js` | P3 tables builder (contract: last section) |
| `public/**` except `public/games/coldcall/**` | P4 client builder |
| `V2-DESIGN.md`, `PROGRESS-V2.md`, `QA-FRANK.md` | Frank |

## money/ : one append-only ledger

File: `MONEY_FILE` env, default `<DATA_DIR>/money.jsonl`. The old `ledger.json` (hand log) is a different file and stays.

One line per write. A line is either a transfer or an atomic batch:

```
{"id":17,"ts":1791263035011,"from":"bank:chris","to":"seat:POKERPING:chris","amount":2000,"cur":"chips","reason":"buyin","ref":"buyin:POKERPING:chris:17"}
{"id":18,"ts":...,"batch":[ {from,to,amount,cur,reason,ref}, ... ],"ref":"hand:POKERPING:42"}
```

API (`money/ledger.js`):

```
open(file, { now }) -> ledger            load + replay; a torn last line is dropped and the file truncated to the last good line
ledger.transfer(from, to, amount, cur, reason, ref) -> { id, dup }
ledger.batch(items[], ref, reason) -> { id, dup }     all-or-nothing, written as ONE line
ledger.balance(account, cur) -> int
ledger.list(prefix, cur) -> [{ account, balance }]    non-zero balances
ledger.has(ref) -> bool
ledger.entries(filterFn) -> iterable of flat transfers (batch items expanded, each with batchRef)
ledger.check() -> { chips: { players, sources, ok }, play: { ... } }   players + sources === 0 per currency
```

Rules:
- `transfer`/`batch` are the ONLY writes. `appendFileSync` before memory is updated. `fsync` on batches.
- Amount must be a positive safe integer, else `MoneyError('bad_amount')`.
- Player-facing accounts (`bank:`, `play:`, `seat:`, `pot:`, `orphan:`) can never go below zero: `MoneyError('insufficient', { account, have, need })`. No clamps anywhere.
- Source accounts may go negative: `mint:signup`, `mint:bonus`, `mint:achv`, `mint:topup`, `mint:migration`, `house:bender`, `house:coldcall`, `admin:adjust`, `fx:chips`, `fx:play`.
- Idempotent by `ref`: the same ref with the same content is a no-op returning `{ dup: true }`; the same ref with different content throws `MoneyError('ref_conflict')`.
- A batch is validated against projected balances in order, then written as one line. Half a batch can never exist on disk.

Accounts:
- `bank:<key>` (chips), `play:<key>` (play).
- `seat:<tableId>:<key>` in the table's currency. It holds stack + whatever that seat has committed to the live hand.
- `pot:<tableId>:<handNo>` exists only inside a hand batch (see below). Outside a batch it is always 0.
- Funding a chips seat from Play $ (or the reverse) is one batch: `play:k -> fx:play` (play) and `fx:chips -> seat:t:k` (chips), same amount, 1:1. Cash-out reverses it to the seat's fund.

**Hand settlement (Frank's change to the audit design).** Bets are NOT ledger writes. The engine tracks them in memory. When the hand ends (showdown or everyone folds) the table writes one batch `hand:<tableId>:<handNo>`: each contributor `seat -> pot`, then `pot -> seat` for every payout and uncalled return. Consequences:
- A crash or deploy mid-hand means the hand never happened in the ledger. There is nothing to refund.
- The batch is written at the showdown instant, before any animation delay, so a crash right after showdown keeps the result (N3).
- A seat that leaves or is kicked mid-hand cashes out only `stack` (not its committed amount); the committed part stays in its seat account until the hand batch moves it (N1).
- Boot rule, the only recovery code: every non-zero `seat:*` balance goes back to its owner's fund (`ref boot:<bootId>:<account>`), every non-zero `pot:*` (should never exist) is refunded pro rata to contributors and logged as an error.

Queries replace parallel stores: top-up eligibility = `play:k` + all `seat:*:k` in play; admin overview; night settle-up; leaderboard.

Rollback mirror: after each write burst (debounced 250 ms) v2 rewrites `bank.json` and `wallet.json` from the ledger (bank + open seats folded in), so a rollback to 9440541 reads current balances. Write-only; v2 never reads them after migration.

## Migration (`tools/migrate-v2.js`)

Pure function + CLI. Never modifies its inputs.

```
migrate({ bank, wallet, stacks, accounts }) -> { items[], report }
node tools/migrate-v2.js --bank b.json --wallet w.json --stacks s.json --accounts a.json --out money.jsonl [--dry-run]
```

- `mint:migration -> bank:<key>` for each bank row whose key is an account, ref `mig:bank:<key>`.
- `mint:migration -> play:<key>` for each wallet, ref `mig:play:<key>`.
- Open stacks in `stacks.json` are folded into the owner's bank (that is what boot does today), ref `mig:stack:<table>:<key>`.
- Bank rows with no account go to `orphan:<name>` and are listed in the report for Chris. Nothing is dropped.
- Accounts with no bank row / wallet get today's lazy defaults (10,000 chips, 1,000,000 Play cents) from `mint:signup`, so nobody's balance changes on first touch.
- Report: totals in vs totals out per currency (must match), orphans, zero rows, rows that were not safe integers (rejected, listed).
- v2 runs the same function at boot when `money.jsonl` is missing or has no `mig:` refs. Idempotent by ref, so a second boot is a no-op. Railway has no manual step.

## engine/ : pure poker (no I/O, no timers, no money store)

```
engine/deck.js      makeDeck() ; shuffle(deck, rng)
engine/evaluate.js  bestHand(hole, board) ; compareHands(a, b)        moved from server.js unchanged
engine/pots.js      sidePots(committedBySeat, foldedSeats) -> [{ amount, eligible: [seat] }]
engine/hand.js      createHand(opts) ; legalActions(hand, seat) ; apply(hand, seat, action) ;
                    foldOut(hand, seat) ; dealNext(hand) ; settle(hand)
```

`createHand({ handNo, button, sb, bb, seats: [{ seat, stack }], deck })`
- `seats` = only the seats dealt in. Seat numbers are stable (0..maxSeats-1). `button` is a seat number and must be one of them.
- Deal order (matches today, keeps the rigged-deck helper valid): `deck.pop()` one card to each dealt seat in ascending seat number, then a second round. Later: burn, flop x3, burn, turn, burn, river, all by `deck.pop()`.
- Blinds: 3+ players: SB = next seat after the button, BB = next after SB. Heads-up: button posts SB and acts first preflop; BB acts first postflop. A short stack posts all-in.
- If nobody can act after the blinds, the hand goes straight to run-out.

Hand state (plain JSON-serialisable object):

```
{ handNo, button, sbSeat, bbSeat, sb, bb, street: 'preflop'|'flop'|'turn'|'river'|'showdown'|'done',
  phase: 'betting'|'runout'|'showdown'|'done',
  board: [], deck: [], toAct: seat|null, currentBet, lastFullRaise,
  seats: { [seat]: { stack, bet, committed, folded, allIn, hole: [c, c], acted, canRaise } } }
```

`legalActions(hand, seat)` -> `null` when it is not that seat's turn, else
`{ toCall, canCheck, canCall, callAmount, canRaise, minRaiseTo, maxRaiseTo }`.
- `minRaiseTo = currentBet + lastFullRaise` (lastFullRaise resets to bb each street).
- `maxRaiseTo = bet + stack` (all-in).
- `canRaise` is false when the seat already acted and the only raise since was a short all-in (no reopen), or when `stack <= toCall`.
- A shove with `stack > toCall` but below `minRaiseTo` is legal: `minRaiseTo` is then reported equal to `maxRaiseTo`.

`apply(hand, seat, { type: 'fold'|'check'|'call'|'raise', to })` mutates the hand and returns `events[]`.
- Throws `RuleError(code, details)` for anything illegal (`not_your_turn`, `cannot_check`, `raise_too_small`, `raise_too_big`, `raise_closed`, `bad_amount`). It never rewrites an amount.
- A short all-in raise sets `currentBet` but not `lastFullRaise`, and does not reopen raising for seats that already acted.
- When betting closes it returns the uncalled part of the top bet at once (event `returned`), advances the street, or sets `phase: 'runout'` when at most one seat can still act.
- `dealNext(hand)` deals one street during run-out, so the table layer can pace it. `foldOut(hand, seat)` folds a seat out of turn (leave, kick, grace expiry).
- Timeout = `apply(hand, seat, toCall ? fold : check)`. Disconnect is not an engine concept.

`settle(hand)` (phase `showdown` or everyone else folded) ->
`{ pots: [{ amount, eligible, winners }], payouts: { [seat]: amount }, returned: { [seat]: amount }, net: { [seat]: delta }, reveals: [seat], handNames }`
- Odd chip goes to the first winner left of the button.
- `returned` is not a win. `net` = payout + returned - committed. The client hand log reads `net`.
- Conservation: sum(payouts) + sum(returned) === sum(committed).

## Test hooks (only when `RIG=1`; never set in production)

(Superseded by section 10 of the tables/ + transport/ contract below: `__audit` there is the exact shape.)

- `__rig { decks: [deck, ...] }` -> `__rig_ok`: the next hands use these decks in order (same format as `tests/v2/lib.js rigDeck`).
- `__audit {}` -> `__audit { bank: {key: n}, wallet: {key: n}, accounts: [key], rooms: [{ id, status, unit, pot, handNum, players: [{ key, name, chips, handBet, isBot, fund, connected }] }], minted, slotNet }`.
  v2 adds `ledger: ledger.check()` and `seats: [{ account, balance }]`.

## Behaviour decisions (Frank, say so if Chris disagrees)

- One seat per account across all tables.
- (See Q2 in the last section: recommended change, a disconnected seat is not dealt into new hands.) Disconnect never folds. The seat stays; on its turn the action timer checks or folds. On a table with no timer, a disconnected seat gets 30 s per turn. Between hands a seat disconnected for 2 minutes is cashed out.
- The server rejects out-of-range amounts with `{ code, min, max, have }`. No server string contains a formatted amount.
- Restart: every seat is cashed out to its owner (as today). Tables stay, seats are empty.

## tables/ + transport/ (+ auth/, admin/) contract

Written 2026-10-06 (contract writer, wave 2). Status: draft for the lead; section 12 lists what is guessed. Where this section and the older text above differ, **this section wins** (it is built on what `engine/PROGRESS.md` and `money/PROGRESS.md` say was actually built, and on the harness in `tests/v2`). Money API names below are the ones in `money/PROGRESS.md` "Service API as built", plus the two pending money changes: `cashOut` takes the seat's fund (we always pass `null` = the seat's fund; a mismatch throws `fund_mismatch`), and `ledger.open()` quarantines bad lines.

### 0. Principles (each one closes a reported bug class)

1. **Money first, memory second.** Every money call returns before the in-memory table changes. If the in-memory step then throws, the wrapper compensates (section 8). Nothing in memory is ever the only copy of money.
2. **Bets are not ledger writes.** The only mid-hand money state is the seat account (`seat:<table>:<key>` = stack + this hand's committed). A hand ends in ONE batch `hand:<table>:<handNo>` (`settleHand`). That batch is the commit point.
3. **Seats are numbers.** `seat` is 0..maxSeats-1 and never moves. The wire format keeps a dense `players[]` array (the client indexes by array position), built by one function (`transport/views.js project()`): occupied seats, ascending seat number. Nothing else in the server holds an index into that array.
4. **One timer per table** (a single `setTimeout` handle, always re-armed to the earliest of the table's deadlines). Every deadline is data on the table; `table.tick(now)` handles all that are due.
5. **No server string carries a digit or a `$`.** Errors are `{ message, code, ...numbers }` (tests/v2/27_errors.js). The client formats.

### 1. File layout and owners

`P3` = tables builder (`builders/P3-TABLES.md`). `P4` = client builder (`builders/P4-CLIENT.md`). Paths not listed here are untouched in wave 2.

| Path | Owner | What it is |
|---|---|---|
| `server.js` | P3 | Thin boot only (<= 200 lines): paths/env, boot sequence (section 9), express static, `/apic/:key/:ver`, `/api/admin/bender-config` GET/POST (logic moved verbatim), `/api/bank-summary` (unchanged, see Q8), socket.io creation, signal handlers. Exports `{ start, bestHand, compareHands, evaluate5 }` (re-exported from `engine/evaluate.js`) and has NO side effect on `require` (so `tests/labels.test.js` and `clientlabels.test.js` can still load it). `start()` runs only when `require.main === module`. |
| `tables.js` | P3 | **Deleted** at the end of P3 (`validateSettings` and `genSchedule` move to `tables/settings.js`). |
| `tables/settings.js` | P3 | `validateSettings(raw)` (port, plus M7 rules), `genSchedule`, `defaultsFor`, constants. Pure. |
| `tables/table.js` | P3 | `Table`: state machine, seats, deadlines, hand lifecycle. Calls `engine/` and the money port. Knows nothing about sockets: it talks through an injected `out` ({ state(table), event(table, name, payload, toKey?), toSeat(table, key, name, payload) }) and an injected `clock` ({ now(), setTimeout, clearTimeout }) so unit tests run on a fake clock. |
| `tables/registry.js` | P3 | Map of tables; create / close / clone; POKERPING bootstrap; `tables.json` load and debounced save (same file shape as today: `{version:1, tables:[non-permanent], legacyBlinds}` plus additive keys `nightFromId`, `nightHand0`); lobby cards; one-seat-per-account lookup; host transfer; idle sweep; night summaries. |
| `tables/money-port.js` | P3 | The ONLY place a `ref` is built and the ONLY caller of the money service for table operations. Fires `afterWrite(keys)` so transport pushes `money`/`wallet`/`bank_summary`. |
| `tables/viewlog.js` | P3 | Adapter that writes the old presentation rows into the old `ledger.js` (`buyin`, `rebuy`, `cashout`, `win`/`loss`, `snapshot`, `night-end`, `adjust`) so `bank_summary`, `get_leaderboard`, `profile.recent/net*` and `accounts.recordHand/recordNight` keep working. Also builds the legacy-shaped room view that `social.onHandEnd` and `ledger.startHand/endHand` read (see social.js:193-215, ledger.js:48-85). Money truth is never read from it. |
| `transport/index.js` | P3 | `io.on('connection')`: builds the per-socket `ctx` and registers the handler modules. |
| `transport/safe.js` | P3 | The wrapper (section 8): `onEvent`, `onTimer`, process-level handlers. |
| `transport/views.js` | P3 | Every outgoing payload that is derived from table state: `gameState(table, forKey)`, `yourCards`, `roomUpdate`, `moneyView`, `bustOut`, `showdownResult`, `handHistory`, `settleUp`, `lobbyCard`, `tableInfo`. This is the file `30_shapes` judges. |
| `transport/handlers/{auth,lobby,seat,host,social,admin,bank}.js` | P3 | Event registration only: parse payload, authorise, call a `Table`/registry/service method, translate the result into events. No rules live here. |
| `transport/wallet-adapter.js` | P3 | `ctx.wallet` for `games/index.js` and `social.js` over the money service (section 7). |
| `transport/rig.js` | P3 | `RIG=1` hooks (section 10). |
| `auth/index.js` | P3 | Wraps `accounts.js` (which stays at the repo root, untouched): `requireAuth(ctx)`, `requireAdmin(ctx)`, `requireHost(table, key)`; identity is `socket.data.acct` (account key) only, never a display name. |
| `admin/index.js` | P3 | `adjust(key, delta, cur, reason)` -> `service.adminAdjust`; `setPlay(key, cents)` (a wallet-only delta); overview builder (bank + seats shown separately). |
| `tests/v2-unit/tables-*.js`, `run-tables.js` | P3 | Unit tests on the fake clock. |
| `tables/PROGRESS.md` | P3 | Progress and hand-off. |
| `money/**`, `engine/**`, `accounts.js`, `social.js`, `ledger.js`, `wallet.js`, `games/**` | not P3 | Read-only for P3. `wallet.js` stops being required by anything (kept in the tree until the lead deletes it). `ledger.js` is used only through `viewlog.js`. Engine amendment E1 (section 4.5) is the one change P3 must request. |
| `public/**` except `public/games/coldcall/**` | P4 | Client (`builders/P4-CLIENT.md`). `public/games/bender/**` only the bet control. |
| `tests/v2/**` | harness builder | P3 and P4 never edit it. A needed test change is reported to the lead. |

Dependency direction: `transport -> tables -> {engine, money-port}`; `tables` never imports `transport`, `socket.io` or `accounts` (it receives display data through the `out` interface and a `profileOf(key)` callback).

### 2. Table state machine

A table has a lobby state `t.state` (`open | paused | ended`, as today, used by the lobby and `table_event`) and a hand phase. Pause is an orthogonal flag, not a phase.

| Phase | Wire `game_state.status` | Entered when | What the single timer means | Leaves when |
|---|---|---|---|---|
| `waiting` | `'waiting'` | table created; a hand ends with fewer than 2 eligible seats; `table_start` pending | `autostart` at `now + AUTO_START_MS` if `t.autoStart` and >= 2 eligible seats and not paused. Otherwise none (the host must `table_start`). | autostart fires, or `table_start` -> `startHand()` |
| `betting` | `'playing'` | `startHand`; a street closes and >= 2 seats can still act | `turn` = `turnMs` (table setting; 0 = none) for the seat on turn, or `DISCONNECT_TURN_MS` (env `TURN_MS`, default 30000) when that seat is disconnected and `turnMs` is 0 or larger. `pre` = `PRE_MS` (450) when the seat on turn has a valid preselect. Whichever is earlier fires first. | action / timeout / `foldOut` -> `betting`, `runout`, or settle |
| `runout` | `'playing'` | engine `phase === 'runout'` (nobody can act) | `street` = `STREET_MS` (default 1500) before each `engine.dealNext`. | after the last street `engine.phase === 'showdown'` -> settle |
| `between` | `'waiting_next'` | right after settle committed | `nexthand` = `HAND_DELAY_MS` env if set, else 5000 after a showdown, 7000 after a fold-win. | tick: end-night pending -> `finishNight`; >= 2 eligible -> `startHand`; else -> `waiting` |
| `ended` | `'ended'` | `finishNight` | none | never |

Settle is not a phase: it is a synchronous transition `betting|runout -> between` with no timer inside it (section 4.4).

**Deadlines** (all plain data, one real timer): the phase deadline above; `seat.graceAt` for each disconnected seat (`disconnectedAt + 120000`, only acted on between hands, never mid-hand); `t.hostAt` (host transfer, `HOST_GRACE_MS` default 20000). Blind escalation has NO timer: the level is computed from `t.blindStartAt` when a hand starts. `tick(now)` loops: pick due deadlines in time order, run each, recompute, then re-arm the one handle to the earliest remaining (or none). `tick` always ends with a re-arm, also on error (`finally`), so a table cannot deadlock.

**Pause** (`table_pause`, host or admin, any phase): `paused = true`, every hand deadline is frozen as `remainingMs` (the turn clock does not run, preselects do not fire: M3), `table_event {kind:'paused'}`, `game_state.paused = true`. Resume re-arms each at `now + remainingMs`. A paused table still accepts sits, leaves, sit-outs (seats are not dealt until resume). Grace expiry and host transfer keep running while paused. `t.state` mirrors `open|paused` and is saved.

**Deal eligibility** ("eligible seat"): `stack > 0 && !sitOutNext && connected`. A disconnected seat is NOT dealt into a new hand (it stays seated and is brought back automatically on reconnect; see Q2, this deviates from the older behaviour note). A seat joined mid-hand is not dealt until the next hand.

**Button**: a seat number. Next hand: the first eligible seat with a number greater than the previous button seat, wrapping; if the previous button seat is gone, the same rule applies (so a vanished button seat can never crash a hand: C2). First hand: the lowest eligible seat. Heads-up blinds come from the engine.

**Blind changes** (`table_update` with `blinds`): stored as `t.pendingBlinds`, applied at the next `startHand` only; never mid-hand (L4). With escalation on, a blind change restarts the schedule (`blindStartAt = now`, level 0) at that next hand. Escalation level at hand start = `min(max, floor((now - blindStartAt) / intervalMs))`; if it rose, emit `blinds_up {level, sb, bb, unit, mode, table}` before the deal. POKERPING has escalation off.

**Table create / close.** `table_create` validates with `validateSettings` (M7 additions: `buyIn.min >= bb`, `buyIn.max >= buyIn.min`, `buyIn.default` inside, `seats` 2..8 and 9 is REJECTED, `bb >= 2`, `sb < bb`; every rejection is `error {code:'range', field, min?, max?, have?}`), max 5 open tables per host, id from `genId()` (6 chars, no `I`/`O`), `nightId = n_<yyyymmdd>_<id>`, `nightFromId = ledger.lastId`, `nightHand0 = 0`. Close = `finishNight(reason)`: cash out every seat (section 3), write `night-end` view row, `t.state = 'ended'`, emit `settle_up` to participants, drop sockets from the room, remove the table from `rooms`. Triggers: `table_end_night` (host/admin; mid-hand it sets `endNightPending` and runs right after the hand's settle, before `nexthand`), idle sweep (no connected seat for `TABLE_EMPTY_MS`, default 30 min; reason `'idle'`). Ended tables stay listed 14 days (as today).

**POKERPING**: an ordinary table record with `permanent: true`, created by `registry.load()` if missing: id `POKERPING`, name `The Ping`, chips, `buyIn {min 500, max 1000000, default 2000}`, blinds 25/50 (or `legacyBlinds` from `tables.json`), seats 8, `actionTimerSec` 30, `autoStart` true, `isPrivate` false, `rebuys` true, `rebuyLimit` 0, `hostKey 'chris'`, `nightId null` (no settle-up), escalation off. `table_end_night` on it: `error {code:'permanent'}`. It has no special code path anywhere else (no `legacy`, no `keepStacks`).

### 3. Seat lifecycle

Seat record (memory only): `{ seat, key, stack, fund, connected, socketId, sitOutNext, leaving, disconnectedAt, timeouts, pre, bought, lastAction, dealt }`. `stack` mirrors the ledger: `ledger.balance(seat account) === stack + (live hand ? committed - returned : 0)`. `__audit` reports any seat where that fails as `drift` (section 10); P3 asserts drift is empty after every unit test and in the fuzz.

**Ref format.** Every money call gets `ref = <kind>:<tableId>:<key>:<opId>` where `opId = <bootId>.<n>` (`bootId` = `Date.now().toString(36)` taken once at boot, `n` a process counter). The ref is minted ONCE when the intent is created (`seat.pending = { kind, ref, amount }`) and reused on any retry of that same intent, so a retry returns `dup` and can never double-pay. A new intent always gets a new ref. Hand batches are `hand:<tableId>:<handNo>`; boot refunds are `boot:<bootId>:<account>` (money-owned); games are `g:<game>:<key>:<round>:<spend|credit>`.

`handNo` is monotonic per table across restarts: at load, `table.handNo = max n over ledger refs 'hand:<id>:<n>'` (0 if none). Without this a restarted table would reuse `hand:T:1` with different content and every hand would die on `ref_conflict`.

| Action | Validation and engine call | Money call and `ref` | Events |
|---|---|---|---|
| **Sit** (`table_join`, no seat for this key) | table not ended; **one seat per account**: `registry.seatOf(key)` anywhere else -> `error {code:'one_seat'}`; free seat (given `seat` if free, else lowest); `buyIn` integer in `[min, max]` else `error {code:'range', min, max, have}`; buy-in count under the limit (below); `fund` = `'chips'|'play'`, default table currency. If the hand is live or `between`, the seat is not dealt until the next hand. No engine call. | `buyIn(key, table, amount, tableCur, fund, ref 'buyin:<t>:<key>:<op>')`. `insufficient` -> `error {code:'bank', fund, have, need}`. `fund_mismatch` -> `error {code:'fund_mismatch'}`. | to the sitter: `table_joined {tableId, playerIdx, stack, table, you}`, `game_state`, `your_cards`, `money`; to the room: `room_update`, `game_state`, `bank_summary`; lobby push; `table_event`-less. Then autostart check. |
| **Rebuy** (`rebuy {roomId\|tableId, amount?, fund?}`) | seat exists, `stack === 0`, not dealt into the live hand (an all-in seat has stack 0 but is in the hand: `error {code:'in_hand'}`); table `rebuys` on; limit; `amount` default = `min(buyIn.default, balance of the seat's fund)`; range -> `error {code:'range', min, max, have}`. | `buyIn(..., fund = requested or seat.fund, ref 'rebuy:<t>:<key>:<op>')`. **Fund rule:** while the seat account holds anything (stack or committed) the fund must equal the seat's fund; at stack 0 with nothing committed it may switch. The money layer enforces it (`fund_mismatch`). | `game_state`, `balance_update {balance}` (chips tables), `money`, `bank_summary`. |
| **Buy-in limit** (M10) | `n = count of 'buyin:' entries into seat:<t>:<key> since t.nightFromId` (read from the ledger, survives restarts). Allowed while `rebuys && (rebuyLimit === 0 \|\| n < 1 + rebuyLimit)`; with `rebuys` off only the first buy-in. Applies to sits and rebuys. Failure: `error {code:'rebuy_off'}`. | none | none |
| **Top-up / add-on** (stack > 0) | NOT supported in wave 2: `rebuy` with `stack > 0` -> `error {code:'have_chips'}` (same as today's "You still have chips"). Q7. | none | none |
| **Play $ wallet top-up** (`wallet_topup`, owned by `games/index.js`) | adapter `topUp` | `topUp(key, ref 'topup:<key>:<op>')` (counts wallet + Play seats: H7). `not_needed` / `cooldown` keep their `code` and `retryMs`. | `wallet`, `money` |
| **Sit out / back in** (`sit_out {roomId}`) | toggles `sitOutNext` (ignored at stack 0); resets `timeouts`. Effective at the next deal. If the table was `waiting` for players and this makes >= 2 eligible, autostart is re-checked. Two consecutive turn timeouts set `sitOutNext` (log line, as today). | none | `game_state` |
| **Leave** (`table_leave {tableId}`) | no seat -> `table_left {cashedOut:0}` (as today). Seat not in the live hand (waiting / between / not dealt): remove now. Seat in the live hand: `engine.foldOut(hand, seat)`, mark `leaving`, keep the record (so indices do not shift mid-hand) with `connected:false, folded:true`; if foldOut ends the hand, settle in the same tick. | **Cash-out now** `cashOut(key, table, amount, tableCur, null, ref 'leave:<t>:<key>:<op>')` with `amount = ledger.balance(seat acct) - committed` (committed = 0 outside a hand). **Never the engine `stack`**: engine returned chips are inside `stack` but the batch still has to move `committed` out of the seat account (see 4.5). After the hand's batch, **sweep** the remainder: `cashOut(key, table, ledger.balance(seat acct), tableCur, null, ref 'sweep:<t>:<key>:<op>')` (no-op at 0). | to the leaver: `table_left {tableId, cashedOut: amount}`, socket leaves the room; room: `room_update`, `game_state`; `money`; lobby push; host transfer deadline if it was the host. |
| **Kick** (`table_kick {tableId, key}`) | host or admin; target must be seated; not the host. Exactly the Leave path for the target, with `reason:'kicked'`. **N1:** the kicked seat's committed chips are never in anyone's stack; they stay in the seat account until the batch moves them to the pot, the pot goes to the winners by the rules, the uncalled part (E1) comes back to the kicked seat's account and is swept after. A kick cannot take a pot. | as Leave, `kick:<t>:<key>:<op>` / `sweep:` | target: `table_left {tableId, cashedOut, reason:'kicked'}`; room: `table_event {kind:'kicked', key, display}`, `room_update`, `game_state`. |
| **Disconnect** (socket `disconnect`) | for the seat bound to this `socket.id` only: `connected = false`, `socketId = null`, `disconnectedAt = now`, `graceAt = now + 120000`. **No fold, no cash-out, no engine call.** On its turn the turn deadline folds-or-checks it (timeout rule below). An all-in seat reaches showdown. The seat is never dealt into a new hand while disconnected. | none | `room_update`, `game_state` (`connected:false`); host transfer deadline if it was the host. |
| **Reconnect / rejoin** (`table_join` for a key that already has a seat) | seat exists and is connected on another socket: take it over (old socket gets `error {code:'taken_over'}` and leaves the room); seat exists and disconnected: rebind. `buyIn`/`fund` in the request are ignored. Clears `disconnectedAt`/`graceAt`; if it was `sitOut`-by-disconnect it is eligible again at the next deal. | none (the stack never left the seat account) | `table_joined {stack: seat.stack}`, `game_state`, `your_cards`; room: `room_update`. |
| **Grace expiry** (`graceAt` due) | only when no hand is live for that seat (`waiting`/`between`/not dealt): remove the seat. If the hand is live, the deadline is retried at the next `between`. | `cashOut(..., ref 'grace:<t>:<key>:<op>')` of the full seat balance | `room_update`, `game_state`, `money` (no `table_left`: no socket) |
| **Bust** (stack 0 after settle, not leaving) | seat stays; not dealt (stack 0). | none | `bust_out {tableId, unit, mode, rebuy:{allowed, fund, balance, min, max, default}, balance?}` once, right after `showdown_result` (additive keys over the pinned shape; `balance` only on chips tables; `rebuy.min` is exactly what `rebuy` accepts: M4). |
| **Night end** (`finishNight`) | all seats removed; an in-hand end-night waits for settle. | per seat `cashOut(..., ref 'night:<t>:<key>:<op>')` of the full seat balance | `settle_up` to participants; sockets leave the room |

**Timeout rule** (turn deadline fires): `legalActions(seat).canCheck ? check : fold` through `engine.apply` (M2). Counts toward the 2-timeouts sit-out rule only for connected seats.

**Preselect** (`preselect {roomId, mode|kind, amount}`): modes `'checkfold' | 'call' | null|'none'`; accepted only for a seat that is dealt, not folded, not all-in and not on turn; `'call'` needs `amount === current toCall` (`max(0, hand.currentBet - hand.seats[s].bet)`). Stored bound to `(handNo, street, currentBet)`; dropped the moment any of those changes; fires once `PRE_MS` after the turn arrives; never while paused. Rejection: `error {code:'preselect'}`.

### 4. Hand lifecycle and the commit point

**4.1 `startHand`** (from `waiting` via autostart / `table_start`, or from `between` via `tick`). Preconditions: not paused; no `endNightPending` (then `finishNight`); >= 2 eligible seats. Steps in order:
1. `handNo = ++table.handNo`; apply `pendingBlinds` or the escalation level; remember `handStartStacks = {seat: stack}` for every seat (the void snapshot).
2. `engine.createHand({ handNo, button, sb, bb, seats: eligible.map(s => ({ seat, stack })), deck })`. `deck` = `engine.shuffle(engine.makeDeck(), rng)`, `rng = () => crypto.randomBytes(6).readUIntBE(0, 6) / 2 ** 48` (same source as `games/bender.js`); under `RIG=1` a queued rig deck is used instead (`decks.shift()`).
3. Mark `dealt` on the seats in the hand, clear `lastAction`, `pre`; seats not dealt keep `dealt = false` (wire `sittingOut: true`).
4. Emit `blinds_up` if the level rose; `game_state` (room, per-seat copy with `legalActions`), `your_cards` to every connected dealt seat. Arm the phase deadline from the hand: `betting` (turn/pre) or, if the engine returned `phase: 'runout'` (everyone all-in from the blinds: M1), `runout`.

**4.2 Engine event -> socket mapping.** The wire has no per-action events: after every `apply` / `foldOut` / `dealNext` the table sends the room `game_state` and each seat `your_cards`, exactly as today. Engine events feed the log ring (<= 30 lines, last 8 sent) and `lastAction`:

| engine event | `lastAction` | log line |
|---|---|---|
| `fold {seat}` | `'FOLD'` | `<name> folds` |
| `check {seat}` | `'CHECK'` | `<name> checks` |
| `call {seat, amount, allIn}` | `'CALL'` | `<name> calls <amount>` |
| `raise {kind, seat, to, ...}` | `'RAISE'` | `<name> raises to <to>` (bet: `<name> bets <to>`) |
| `returned {seat, amount}` | - | none (chips are already back in `stack`) |
| `street {street, cards}` | clears the round bets | `Flop: ..`, `Turn: ..`, `River: ..` |
| `runout`, `showdown` | - | `--- Showdown ---` |

Blinds are read from `hand.sbSeat/bbSeat` (log `<name> posts SB/BB <n>`). `player_action {roomId, action, amount}`: `amount` is the raise-TO total (as today); `to` is accepted as an alias. The handler calls `legalActions` first only to shape the error, then `engine.apply`; a `RuleError` becomes `error {code, min, max, have, message}` using the engine's `details` (`raise_too_small`, `raise_too_big`, `raise_closed`, `cannot_check`, `not_your_turn`, `bad_amount`, `bad_action`); amounts are never rewritten (L5). Messages are fixed words with no digits.

**4.3 Run-out pacing.** When the engine phase becomes `runout`: broadcast `game_state` now, then every `STREET_MS` call `engine.dealNext(hand)` and broadcast, until `phase === 'showdown'`; then settle. Nothing is written to the ledger during run-out.

**4.4 Settle = the commit point.** One synchronous function `settle(table)`, entered when `engine.phase === 'showdown'` (all streets dealt, or everyone else folded):
1. `r = engine.settle(hand)` (mutates the hand; credits stacks; idempotent).
2. Build maps keyed by account key: `committed[key] = hand.seats[s].committed`, `payouts[key] = r.payouts[s]`, `returned[key] = r.returned[s]` (all non-negative integers).
3. **`money.settleHand(tableId, handNo, tableCur, { committed, payouts, returned })`** -> one ledger line, fsync'd before it returns. Throws `not_conserved` before writing anything if the three sums disagree.
4. Only after it returns: copy `seat.stack = hand.seats[s].stack` for every seat; run the leaving-seat sweep; write the view rows; build and emit `showdown_result` (4.6), `bust_out`s, `game_state`, `money`, `bank_summary`; set phase `between`, arm `nexthand`.

**What a crash does.**
- Before step 3 completes (anywhere during `betting` or `runout`, or inside step 3 before the line is durable): the in-memory hand is gone, the ledger never saw it, every seat account still holds its hand-start stack, boot (`bootRecover`) returns each seat's balance to its owner. The hand "never happened"; nobody lost or won. No pot refund code exists.
- After step 3 returned (including 1 ms later, before anything is emitted): the batch is durable, so the result stands: winners hold their winnings after the boot cash-out (N3; tests/v2/23 kills the process 100 ms to 2.5 s after the showdown and wants 12,000 / 8,000). There is no 2 s mirror and no post-showdown animation window that can undo a hand: the delay after the commit is only the `nexthand` wait.
- A torn last line is dropped by `ledger.open()` (money builder); so "crash inside the write" is either "before" or "after".

**4.5 Mid-hand leave/kick and the engine (E1).** `foldOut` makes the seat's committed chips dead money (they stay in the pot). The seat account holds `hand-start stack`; the batch moves `committed` out of it. Hence the cash-out formula `amount = ledger.balance(seat) - committed` (section 3). **Engine amendment E1 (required, see Q1):** today `engine.foldOut` does not return the uncalled excess to a folded top bettor (`engine/PROGRESS.md` points 2 and 8), but `tests/v2/24_kick_midhand.js` check 2 (heads-up: host calls 50, P1 raises to 500, host kicks P1) wants P1 to get his uncalled 450 back and the host to win only the matched 100. Rule: excess = `topCommitted - secondHighestCommitted` over ALL seats of the hand (folded included), returned to the top seat even if it folded, unless that would leave a live seat with nothing to play for (the case the property test found) — the engine builder reconciles that edge. Until E1 lands, check 24b is expected to fail; P3 must not work around it in the table layer.

**4.6 Payloads at the end of a hand** (corrected; additive over `30_shapes`):
```
showdown_result {
  handNo,
  winners: [ { name, handName, cards, amount, net } ],   // ONLY seats with payouts[s] > 0
  pot,                                                  // sum(payouts): chips actually won (uncalled returns excluded)
  net:      { [name]: n },                              // EVERY dealt seat, = payouts + returned - committed, sums to 0
  returned: { [name]: n },                              // uncalled chips handed back; NOT wins
  reveals?: [ { name, handName, cards } ],              // showdown only; absent on a fold-win
  nextMs                                                // the real delay (honours HAND_DELAY_MS)
}
```
- `amount` = `payouts[s]` only (a fold-winner's own uncalled raise is in `returned`, not `amount`: HL).
- Fold-win: `winners[0] = { name, handName: 'Everyone folded', cards: [], amount, net }`.
- A seat that only got an uncalled bet back is not in `winners` (L3). `net` names use the seat's display name at that time.
- `game_state.handHistory` (newest first, max 10) entries: `{ handNum, winners: [names with payout > 0], handName, pot, nets: { [name]: n }, returned: { [name]: n } }`. The hand-log UI MUST render `nets[name]` as the per-player result (`+n` green, `-n` red, `0` neutral) and use `pot` only as the pot size; it must not print `pot` as a win and must not list a `returned`-only seat as a winner (these were the three reported UI errors; the server was already paying correctly).

### 5. Socket events

Event names and payloads stay as recorded by `tests/v2/shapes/9440541.json` (the "30_shapes" file); "source" is where the unchanged shape comes from. Payload keys may be ADDED; none removed or retyped. `auth` column: `-` none, `A` signed in (`socket.data.acct`), `H` host of that table or admin, `Adm` admin. Every client->server handler gets `payload` as an object (anything else becomes `{}`), and an unauthenticated call to an `A+` event gets `error {code:'auth', message:'Sign in first'}`.

**Client -> server, KEPT (49)**

| Event | Payload | Source | Owner | Auth |
|---|---|---|---|---|
| `auth_signup` `auth_claim` `auth_login` `auth_resume` `auth_logout` | `{name,pin,avatar}` / `+roomPassword` / `{name,pin}` / `{key,token}` / `{}` | server.js:1250-1258 | handlers/auth + `accounts.js` | - |
| `profile_get` `profile_update` `pin_change` `account_reset_pin` | `{key?}` / `{avatar,prefs,display,avatarPic}` / `{oldPin,newPin}` / `{key,newPin}` | server.js:1259-1293 | handlers/auth | A (`account_reset_pin` is checked inside `accounts.resetPin`) |
| `get_leaderboard` | `{}` | server.js:1482 | handlers/auth | A for `me` |
| `lobby_list` `tables_mine` | `{}` | tables.js:352-360 | handlers/lobby | A |
| `table_create` | `{settings}` | tables.js:362 | handlers/lobby -> registry | A |
| `table_preview` `table_clone` `night_get` | `{code}` / `{tableId}` / `{nightId}` | tables.js:372, 543, 556 | handlers/lobby | A |
| `table_join` | `{tableId, buyIn?, seat?, fund?}` | tables.js:379 (`seat` is already in the signature but unused) | handlers/seat -> table | A |
| `table_leave` `sit_out` `show_cards` `rebuy` | `{tableId}` / `{roomId}` / `{roomId?, which: 0\|1\|'both'}` / `{roomId\|tableId, amount?, fund?}` | tables.js:442; server.js:1740, 1467, 1646 | handlers/seat | A (seat owner). `show_cards` without `roomId` finds the caller's seat (M9: any table); only in `between` |
| `player_action` `preselect` | `{roomId, action, amount}` / `{roomId, mode\|kind, amount?}` | server.js:1611, 1632 | handlers/seat | A (seat owner) |
| `table_start` `table_pause` `table_kick` `table_update` `table_end_night` | `{tableId}` / `{tableId, paused?}` / `{tableId, key}` / `{tableId, patch}` / `{tableId}` | tables.js:455-529 | handlers/host | H |
| `chat_message` `emote` `throw_item` `drop_sticker` | `{roomId,text}` / `{roomId,id}` / `{roomId,targetIdx,item}` / `{roomId,emoji}` | server.js:1690-1737 | handlers/social | A and seated (`throw_item.targetIdx` is the dense `players[]` index) |
| `get_bank_summary` | `{roomId, view?}` | server.js:1349 | handlers/bank | A in the room |
| `admin_overview` `admin_bank_summary` `admin_set_play` `admin_reset_pin` | `{}` / `{view}` / `{key, cents}` / `{key, newPin}` | server.js:1300-1340 | handlers/admin -> `admin/` | Adm. `admin_set_play` = ONE `adminAdjust(key, cents - play balance, 'play', 'admin set play')` on the wallet only (never touches seats) |
| `wallet_get` `wallet_topup` | `{}` | games/index.js | games (unchanged) + adapter | A |
| `bonus:status` `bonus:claim` `account:stats` `achv:state` `achv:seen` `social:feed` `social:biggest` | | social.js:257-267 | social.js (unchanged) | A |
| `g:bender:state` `g:bender:history` `g:bender:spin` (and `g:coldcall:*` when merged) | `{bet, mode, buyBonus?}` | games/bender.js | games (unchanged) | A |
| `__rig` `__audit` `__test_skew` | section 10 | | transport/rig.js | - (only when the env gate is on) |

New (1): `admin_adjust {key, delta, cur: 'chips'|'play', reason}` -> `admin_result {op:'adjust', ok, key, message?, code?}`; `delta` a non-zero integer; `insufficient` -> `ok:false, code:'insufficient'`; ref `adj:<key>:<op>`; Adm only. It replaces `bank_set`.

**Server -> client, KEPT (47)**: `auth_ok` `auth_error` `auth_out` `ok` `error` `money` `wallet` `account:stats` `achv:state` `achv:unlocked` `social:event` `social:feed` `social:biggest` `bonus:status` `bonus:claimed` `profile` `profile_error` `self_changed` `account_changed` `leaderboard_data` `lobby_tables` `tables_mine` `table_created` `table_info` `table_joined` `table_left` `table_event` `settle_up` `game_state` `your_cards` `room_update` `showdown_result` `bust_out` `balance_update` `cards_shown` `blinds_up` `sticker_dropped` `emote` `item_thrown` `chat_message` `bank_summary` `admin_overview` `admin_result` `g:bender:state` `g:bender:result` `g:bender:history` `g:bender:cfg`. Shapes: the recorded ones in `shapes/9440541.json`. `money` = `{bank, atTable, chips, wallet:{play, chips}}` with `bank` ALWAYS a number (the row exists from signup: money audit S2-1), `atTable` = sum of the key's seat balances. `error` = `{message, code, ...numbers}`; `message` never contains a digit or `$`. `game_state` / `your_cards` / `showdown_result` / `bust_out`: section 6 and 4.6. Owner of all table-derived ones: `transport/views.js`.

**DELETED (7 client -> server, 2 server -> client).** After P3 each is an unknown event: no handler, no reply, no state change (tests/v2/08, 09).

| Deleted event | Client call sites (9440541 tree) | Must call instead |
|---|---|---|
| `check_balance` | `public/game.js:354` (landing name box) | nothing: the bank arrives in `money` on `auth_ok` and after every money write; `wallet_get` for Play $. Delete the landing balance box. |
| `create_demo` | `public/game.js:361` (`#btn-demo`) | nothing: no demo mode exists in v2. Delete the button. |
| `join_game` | `public/game.js:369` (`#btn-join`, password box) | `table_join {tableId:'POKERPING', buyIn, fund}` through the lobby buy-in picker (`public/lobby.js:416`). Delete the landing form; entry is always lobby -> `table_join` -> `table_joined` -> `PingGame.enter` (`public/game.js:473`). |
| `start_game` | `public/game.js:437` (`#btn-start` + `#blind-seg`) | `table_start {tableId: state.roomId}`. The blind interval is a table setting (`table_update {patch:{blindIncrease}}` / create form), not a start argument; remove `#blind-seg`. |
| `set_pause` | `public/bank.js:47` (`#pause-btn`), `public/admin.js:218` (`#adm-pause`) | `table_pause {tableId:'POKERPING', paused}` (the host drawer already uses it: `public/lobby.js:771`). |
| `reset_table` | `public/bank.js:60`, `public/admin.js:224` | nothing: the feature is dropped (H8). A starting stack is `table_update {tableId, patch:{buyIn:{...}}}` (only before the first hand of the night); money fixes are `admin_adjust`. Delete both reset controls. |
| `bank_set` | `public/bank.js:226`, `public/admin.js:171` | `admin_adjust {key, delta, cur:'chips', reason}` with `delta = typed target - currently shown BANK balance` (bank and at-table are shown separately; "set total" no longer exists: H5). |
| `room_joined` (server->client) | handler `public/game.js:516` | `table_joined` (already handled by `PingGame.enter`). Remove the handler. |
| `balance_data` (server->client) | handler `public/game.js:503` | `money` and `balance_update`. Remove the handler. |

Also leaving as-is but listed so nobody touches them: HTTP `/apic/:key/:ver`, `/api/admin/bender-config` (+ `io.emit('g:bender:cfg')`), static files.

### 6. State payload: `legalActions`, per-seat `game_state`

`game_state` is sent **per seat** (one emit per connected seat via its socket id, plus nothing to unseated sockets), so a private field can ride on it. The public part is identical for everyone; keys of today's payload keep their meaning (`players[i].chips` = stack behind, `roundBet` = this street's bet, `pot` = chips in the pot now = `engine.totalPot`, `currentPlayerIdx`/`dealerIdx` = indices into the dense `players[]`). Additive keys:

| Key | Where | Meaning |
|---|---|---|
| `legalActions` | top level | `null` unless this seat is on turn in a live, unpaused hand; otherwise `{ toCall, callAmount, canFold: true, canCheck, canCall, canRaise, minRaiseTo, maxRaiseTo }` taken from `engine.legalActions(hand, seat)` plus `canFold`. `minRaiseTo`/`maxRaiseTo` are `null` when `canRaise` is false. A shove with `stack > toCall` but below the minimum is legal and reported as `minRaiseTo === maxRaiseTo`. `player_action.amount` for a raise must be in `[minRaiseTo, maxRaiseTo]` (raise-TO). The client computes NO rule: no min-raise, no `canRaise`, no `othersCanRespond`, no `BIG_BLIND` fallback. |
| `players[i].seatNo` | per player | the stable seat number. |
| `players[i].leaving` | per player | true for a seat that left/was kicked mid-hand and is shown until the hand ends. |
| `you` | top level | `{ seatNo, idx }` for the receiving seat, `null` for a non-seated recipient. (Same `idx` as `your_cards.myIdx`; both sent so ordering races cannot hurt.) |

`your_cards` keeps `{cards, myIdx, preselect}` and is sent right after `game_state` to each connected dealt seat. This does not change any pinned key, only adds keys, so `30_shapes` stays green.

### 7. Money for the games (Bender, Cold Call, achievements, bonus)

`games/bender.js`, `games/coldcall.js` (on the `coldcall` branch), `social.js` and `games/index.js` stay **unchanged**. They already take `ctx.wallet` (`games/index.js` uses `ctx.wallet` when given, else builds its own) and call `wallet.spend(key, mode, cents, {game, round})`, `wallet.credit(...)`, `wallet.get(key)`. `server.js` builds `transport/wallet-adapter.js` and passes it as `wallet` to both `require('./games')({...})` and `social.setWallet(...)`; `wallet.js` is no longer used.

| Adapter call | Money call | `ref` |
|---|---|---|
| `spend(key, mode, cents, ref)` `mode` `'play'`->cur `'play'`, `'chips'`->cur `'chips'` | `houseSpend(ref.game, key, cents, cur, r)` for `ref.game` in `bender`, `coldcall` | `g:<game>:<key>:<ref.round>:spend` (no `round`: process counter, flagged non-idempotent) |
| `credit(key, mode, cents, ref)` | `houseCredit(ref.game, key, cents, cur, r)`; `cents === 0` is a no-op returning `get(key)` | `g:<game>:<key>:<ref.round>:credit` |
| `credit` with `ref.game === 'achv'` (social.js:142) | `mint('achv', key, cents, 'play', r)` | `achv:<key>:<ref.round>` |
| `credit` with `ref.game === 'bonus'` (social.js:240) | `mint('bonus', key, cents, 'play', r)` | `bonus:<key>:<ref.round>` (`round` = the claim day, so a double claim is `dup` at the ledger) |
| `get(key)` | `{ play: balance('play:'+key), chips: balance('bank:'+key) }` | - |
| `topUp(key)` | `service.topUp(key, r)`; map `MoneyError` `not_needed`/`cooldown` to `e.code` and `e.retryMs = details.retryMs` | `topup:<key>:<op>` |
| `stats(key)`, `adminSet`, `flush`, `START_PLAY` | `stats` derived from ledger entries `reason startsWith '<game>:'` only if something reads it (P3 greps `wallet.stats` / `byGame`; at 9440541 nothing outside `wallet.js` does); `adminSet` unused; `flush` no-op; `START_PLAY` from the service | - |

Error mapping the games rely on: `MoneyError('insufficient')` -> thrown error with `code:'funds'` (bender.js `walletErr`); `bad_amount` -> `code:'amount'`; anything else -> `code:'internal'`. A new game needs `house:<game>` in `SOURCE_ACCOUNTS` and `GAMES` (money builder's files). After every successful write the adapter calls `onChange(key)` which P3 wires to `games.pushWallet` (the injected wallet does not auto-push) AND `views.pushMoney(key)`. Play $ therefore lands in the ledger (`house:bender` spend/credit in `play`), fixing "Play $ never goes into the ledger". The bender-config API is untouched. Bender spend then credit are two ledger lines in one synchronous handler (a kill between them loses a stake); see Q5.

### 8. Error containment

**The wrapper** (`transport/safe.js`):
- `onEvent(socket, ev, fn)`: normalises the payload, runs `fn` in `try/catch`. Expected errors (`RuleError`, `MoneyError`, `ValidationError` thrown by handlers) become `socket.emit('error', {message, code, ...details})` and change nothing else. Any other error is a **bug**: log it, `socket.emit('error', {message:'Server error', code:'internal'})`, and if a table was touched, void that table's hand (below).
- `onTimer(table, fn)`: every `setTimeout` callback in the table layer runs as `try { table.tick(now) } catch (e) { table.void('timer', e) } finally { table.rearm() }`. There is exactly one such callback per table.
- `process.on('uncaughtException' | 'unhandledRejection')`: log with stack, void every live hand (`registry.voidAll('uncaught')`), keep running. Never `process.exit`.

**What "void the hand" does** (`table.void(reason, err)`), only legal while the hand is NOT committed:
1. Discard the engine hand object (set `table.hand = null`, phase `between`).
2. Restore every seat's `stack` from `handStartStacks`; seats that left/were kicked mid-hand keep their `leaving` flag and are cashed out (`balance`, fresh ref `sweep:`), since nothing is committed.
3. **Write nothing to the ledger.** (Bets were never written, so there is nothing to undo; if the ledger and memory disagree, the ledger wins at the next boot.)
4. Emit to the room: `error {message:'Hand voided', code:'hand_void'}`, `table_event {kind:'void'}`, `game_state` (pot 0, bets 0, status `waiting_next`), `your_cards` (empty). Arm `nexthand` (2 s).
5. If 3 voids happen within 60 s the table pauses itself (`paused: true`, `table_event {kind:'paused', by:'server'}`) so a deterministic bug cannot loop.
If the error happens AFTER `settleHand` returned (step 4 of 4.4 onwards) the hand is NOT voided: it stands; the remaining steps (emits, view rows) are best effort, each in its own `try/catch`, and the table moves to `between`. The `table.committed` flag decides.
If a money call fails with `lost_lock` / `foreign_write` / `write_failed` / `closed` (the fence or the disk): pause every table, log `MONEY FENCED`, refuse sits/rebuys with `error {code:'money_down'}`, do not exit.

**Compensation for money-then-memory.** If `buyIn` succeeded and the seat creation then throws: `cashOut(amount, fresh ref 'sweep:')`; if that also fails, log `CRITICAL orphan seat <account>` (boot recovery returns it).

**Logging**: one line per incident to stderr: `[v2] <label> table=<id> hand=<n> phase=<p> <code|name>: <message>` then the stack; voids add `VOID`. Money failures log the ref. Nothing logs PINs, tokens or hole cards.

### 9. Boot, mirrors, shutdown

Order in `server.js start()` (the server listens LAST, so the harness' TCP probe means "ready"):
1. Resolve paths: `DATA_DIR` (or `RAILWAY_VOLUME_MOUNT_PATH`, or the repo dir), `MONEY_FILE` (default `<DATA_DIR>/money.jsonl`), `BANK_FILE`, `WALLET_FILE`, `STACKS_FILE`, `LEDGER_FILE` (the old hand log), `ACCOUNTS_FILE`, `TABLES_FILE`, `BIGWINS_FILE`. Keep the `FRESH_START_ID` one-shot and the first-boot seed copy of `bank.json` exactly as in server.js:49-74.
2. `ledger = money.open(MONEY_FILE, { fsync: 'all', log })` (takes the writer fence).
3. `accounts = createAccounts(...)`; `accounts.migrateLegacy({ bank, ledgerEntries })` as today (reads `BANK_FILE` and the old `LEDGER_FILE` read-only).
4. **Migrate if needed**: `if (migrate.needsMigration(ledger))`: first copy `bank.json`, `wallet.json`, `stacks.json`, `accounts.json` to `<name>.pre-v2` (never overwrite an existing copy); then `migrate({ bank, wallet, stacks, accounts })` and `apply(ledger, items)`; then write `stacks.json` as `{}` (its chips are now in `bank:`; a rollback boot must not add them twice). Idempotent by `mig:` refs, so a crash mid-migration and a re-boot is safe. Log the report (totals in vs out per currency, orphans).
5. `service = createService(ledger)`; `service.ensureAccount(key)` for every account (signups later call it from `auth_signup`/`auth_claim`).
6. **`report = service.bootRecover(bootId)`**: every non-zero seat goes back to its owner's fund; stray pots are refunded. Log the report; `report.errors` non-empty is a loud warning, not a failure.
7. Build `social`, the wallet adapter, `games`; build `registry` and `registry.load()` (reads `tables.json`, creates POKERPING, sets every table's `handNo` from the ledger, seats empty, `paused` restored from `t.state`).
8. Start the mirror writer: write `bank.json` and `wallet.json` once from `service.mirror()` (post-recovery), then a 250 ms interval that rewrites them (temp file + rename) only when `ledger.lastId` changed. Write-only: v2 never reads them after step 4. A write failure is logged, never fatal.
9. Create the http/socket.io server, register handlers, `server.listen(PORT)`.

SIGTERM / SIGINT: stop timers, void in-memory hands (no ledger write), force one mirror write, flush `tables.json`, `accounts`, `social`, `ledger.close()`, `process.exit(0)`. **No cash-out writes**: recovery is the boot rule only (one code path for deploy and crash, C3). Players are not kept at their seats across a restart (seats are cashed out at the next boot, as today); see Q6.

### 10. Test hooks (`RIG=1` only)

Registered in `transport/rig.js` only when `process.env.RIG === '1'`; never in production; no sign-in required (the harness comments rely on it so that probing does not pay a daily bonus). `__test_skew` keeps its own env gate (`AUTH_CLOCK_SKEW`).

- `__rig {decks: [[{rank,suit} x 52 in pop order], ...]}` -> `__rig_ok {queued}`. Global queue, `decks.shift()` per `startHand`; an empty queue means a real shuffle. (Same as `tests/v2/baseline/rig.patch`.)
- `__audit {}` -> `__audit`:
```
{ bank:   { [key]: bank: balance },            // ledger bank: accounts ONLY (seats are NOT folded in; the mirror files DO fold them in, do not use those)
  wallet: { [key]: play: balance },
  accounts: [key...],
  minted:  -(mint:bonus + mint:achv + mint:topup balances, both currencies, signs flipped),
  slotNet: -(house:bender + house:coldcall balances, both currencies, signs flipped),
  rooms: [ { id, status, unit, pot, handNum, sb, bb, street, currentBet,
             players: [ { key, name, chips: stack, handBet, isBot: false, fund, connected, roundBet, folded, allIn, sittingOut } ] } ],
  ledger: ledger.check(),                       // v2 addition
  seats:  [ { account, cur, balance } ],        // v2 addition: every non-zero seat:* account
  drift:  [ ... ] }                             // v2 addition: seats where ledger seat balance != stack + handBet; must be []
```
`handBet` = `committed - returned` (the chips this seat currently has in the pot; the harness adds `handBet` to `chips` while `status==='playing'`, and engine `returned` chips are already inside `stack`, so using raw `committed` would double count). `pot` = `engine.totalPot` while a hand is live, 0 otherwise. `unit` is the table unit (`'chips'|'cents'`). Everything `tests/v2/lib.js` reads (`audit`, `roomOf`, `seatOf`, `moneyTotal`) is above; `__rig`/`__audit` are the only hooks it calls. The harness also relies on these env vars, which v2 must honour: `PORT, DATA_DIR, BANK_FILE, LEDGER_FILE, ACCOUNTS_FILE, TABLES_FILE, WALLET_FILE, STACKS_FILE, BIGWINS_FILE, BENDER_CFG_FILE, MONEY_FILE, RIG, AUTO_START_MS, HAND_DELAY_MS, TURN_MS, AUTH_SIGNUP_LIMIT, HOST_GRACE_MS, AUTH_CLOCK_SKEW, TABLE_EMPTY_MS`.

### 11. Acceptance for wave 2

Wave 2 is done when ALL of these hold on the v2 server in `repo/`, with output pasted into `tables/PROGRESS.md`:
1. `node tests/v2/run.js --label v2` exits 0: every check `NN_*.js` green (01-26, 10_fuzz, 27_errors, 30_shapes). Exception allowed only for check 24b until engine amendment E1 lands (then it is green too). Single file: `node tests/v2/NN_name.js --target .`. `14_legacy_blind_schedule` takes about 70 s (60 s server minimum).
2. `node tests/v2/30_shapes.js --target .` green with `shapes/allowlist.json` still `{ "events": [], "keys": [] }` (v2 removes no recorded event and no recorded key).
3. `node tests/v2-unit/run-money.js` (>= 71 pass), `node tests/v2-unit/run-engine.js` (92 at seed 1, about 2 min), and the new `node tests/v2-unit/run-tables.js` (fake-clock tests for every row of sections 2-4 and 8; no sockets, no server) all exit 0.
4. Existing suites (`package.json` `test`), run ONE at a time (each starts a server; box RAM): must still pass: `preselect`, `accounts`, `migrate`, `social`, `profile`, `bender`, `bender-livecfg`, `money.test`, `clientlabels.test`. `labels.test` passes except its `showdown()`/`makeRoom()` section, which tests deleted code (stale by design; the engine differential tests replace it). `tables`, `allin`, `rejoin` pass after their 1-2 legacy `join_game` lines are ported to `table_join` (P3 does that port).
   **Stale by design** (they drive deleted events or `stacks.json`; P3 moves them to `tests/legacy-stale/` with a README, never deletes): `mp`, `bankedit`, `bankfix`, `pause`, `reset`, `persist`. Step 0 of P3 records, ON THE UNCHANGED v2-core tip, which of the existing suites already fail on this box (ports, timing, RAM); I did not run any of them, so I cannot list the known-stale-on-this-box ones: P3 reports them from its own step-0 run.
   After any run of the old suites: `git checkout qa; git clean -fdq qa` (they dirty `qa/`; never commit it).
5. Fuzz: `10_fuzz.js` ran with a fixed seed and its money invariant held; `__audit.drift` stayed `[]` and `ledger.check()` ok throughout.
6. `git log --stat` shows P3 touched only the paths it owns.
7. Not required in wave 2 (explicitly): client changes, Cold Call merge, leaderboard/profile moved to money queries, seat persistence across deploys.

### 12. Open questions for the lead

Each has my recommendation; the contract above already assumes the recommendation.

1. **Engine vs harness on a kicked top bettor (a real contradiction).** `tests/v2/24` check 2 wants the kicked player's uncalled 450 returned; the built engine (`PROGRESS.md` points 2, 8) keeps it in the pot as dead money, so the host would win 550 instead of 100. *Recommend:* engine amendment E1 (4.5), a small follow-up to the engine builder, with the property test updated; P3 does not work around it. The harness is right: a kick must not hand the other player a bet he never had to call.
2. **Deal a disconnected seat into new hands?** The older note says the seat stays and the timer folds it (so it bleeds blinds for 2 minutes and stalls a table with no clock for 30 s per hand). *Recommend:* do not deal it (treated as sitting out) until it reconnects, and cash it out after 2 minutes; within the hand it is already in, it is never folded for disconnecting. This deviates from the written decision, so it needs your yes.
3. **`handNo` persistence.** Derived from the ledger (`max hand:<id>:<n>`) so `hand:<t>:<n>` is never reused across restarts. *Recommend:* as specified; the alternative (a boot-id inside the ref) breaks the agreed ref format.
4. **Old `ledger.js` / `ledger.json`.** Kept as the presentation log fed by `viewlog.js` so bank screen, leaderboard, profile and nights keep working in wave 2; `settle_up`/`night_get`/`tables_mine.nightNet` come from `nightSummary` (truth, survives restarts: tests 17 and 25). *Recommend:* adapter now; moving leaderboard/profile/bank_summary to money queries in wave 3. Risk: two logs can disagree; the P3 fuzz compares per-night nets from both.
5. **Bender is two ledger lines.** *Recommend:* leave for wave 2 (a kill between two synchronous appends is microseconds), then add `houseRound(game, key, cost, win, cur, ref)` as ONE batch to `money/service.js` and switch the adapter to buffer spend until credit.
6. **Restart ejects everyone** (boot cashes out all seats; players re-sit after every deploy). *Recommend:* accept for v2 (it is today's behaviour and the simplest recovery); persisting seats is a later feature.
7. **Add-on at stack > 0** is not built (nothing in the client uses it). *Recommend:* leave out. Also: with `rebuys` off a leave-and-sit counts as a rebuy (one buy-in per night); with a limit the cap is `1 + rebuyLimit` (tests/v2/15 wants <= 2 for limit 1). This tightens `rebuys:false` tables slightly versus today.
8. **`/api/bank-summary?password=ping`** is an unauthenticated HTTP read of every player's bank, gated only by the public room password (and `auth_claim` uses the same word). *Recommend:* keep unchanged in wave 2 (nothing in `public/` calls it), delete it in wave 3; flag to Isabelle.
9. **M7 numbers.** `buyIn.min >= bb` (not 10 bb), seats 2-8. *Recommend:* as written; 10 bb would reject tables the harness builds (min 100 with bb 50).
10. **`minted` in `__audit` includes `mint:topup`** (the baseline hook did not, because the old top-up changed the wallet outside `byGame`). *Recommend:* include it so the conservation total stays comparable; the harness author should confirm no check depends on the old behaviour.
11. **`admin_set_play` stays as "set wallet to X"** (a single wallet delta, never table money), `bank_set` becomes `admin_adjust` with an explicit delta. *Recommend:* as written; P4 shows bank, at-table and Play $ separately in the admin console.
12. **Per-seat `game_state` emits** (up to 8 per change instead of one broadcast) to carry `legalActions`. *Recommend:* yes (one event, no ordering race with `your_cards`); the cost is negligible at this scale.
13. **`bust_out` is emitted right after the showdown**, not at the next deal. *Recommend:* yes (the rebuy prompt appears during the result screen); `30_shapes` is indifferent.
14. **Wire `nextMs` now honours `HAND_DELAY_MS`.** *Recommend:* yes (it is the real delay).
15. **Where the earlier design is weak** (contrarian notes): (a) "bets are not ledger writes" is right, but it makes mid-hand leave/kick arithmetic subtle: the cash-out must be `seat balance - committed`, not the engine stack; it is in the contract and has its own unit test. (b) "Restart: every seat is cashed out" plus "one seat per account" makes every deploy a table-wide eviction; fine for friends, bad for a live tournament night. (c) `fsync` on every transfer plus a 250 ms mirror rewrite of two JSON files is fine at this size but is O(accounts) per burst; if the mirror ever shows up in a profile, rewrite it only on `between` and on a timer. (d) The money ledger holds every line in memory; adequate for years of friend-group play, not for growth.

### 12a. Lead answers (Frank, 2026-10-06 03:40)

All recommendations in section 12 are accepted as written; the contract stands. Specifics:
1. Q1: engine amendment E1 goes to the engine builder now (kicked or stood-up top bettor gets the uncalled layer back; property test updated). P3 does not work around it; check 24b stays failing until E1 merges.
2. Q2: YES, a disconnected seat is not dealt into new hands (sitting out until it reconnects, cashed out after 2 minutes). In the hand it is already in it is never folded for disconnecting. This is a deliberate deviation from the earlier note; tell Isabelle at milestone 3.
3. Q3-Q14: as recommended. Q8 (`/api/bank-summary?password=ping`) stays unchanged in wave 2 and is flagged to Isabelle for deletion in wave 3. Q10: harness author (P0) has no check depending on `minted` excluding `mint:topup`; if one turns up, the harness is wrong, not the server.
4. Q15: noted, no action in wave 2.
5. **Q5 REVISED (Frank, 03:45): a slot round is ONE ledger batch in wave 2, not two lines.** The money builder adds `houseRound(game, key, cost, win, cur, ref) -> { id, dup }` to `money/service.js` (one batch; insufficient funds for `cost` throws before anything is written; win 0 = spend only; cost 0 = credit only; idempotent by ref). The games adapter (P3) settles every Bender and Cold Call round with one `houseRound`, ref `<game>:<accountKey>:<roundId>`, roundId unique per round and stable across a retry. Reason: with spend then credit, a crash between the two takes the bet and loses the win. This overrides "leave it for wave 2" in item 3 above for Q5 only.
