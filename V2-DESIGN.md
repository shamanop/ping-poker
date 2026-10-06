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
| `tables/**`, `transport/**`, `auth/**`, `admin/**`, `server.js`, `tables.js` | phase 3 (not started) |
| `public/**` | phase 4 (not started) |
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

- `__rig { decks: [deck, ...] }` -> `__rig_ok`: the next hands use these decks in order (same format as `tests/v2/lib.js rigDeck`).
- `__audit {}` -> `__audit { bank: {key: n}, wallet: {key: n}, accounts: [key], rooms: [{ id, status, unit, pot, handNum, players: [{ key, name, chips, handBet, isBot, fund, connected }] }], minted, slotNet }`.
  v2 adds `ledger: ledger.check()` and `seats: [{ account, balance }]`.

## Behaviour decisions (Frank, say so if Chris disagrees)

- One seat per account across all tables.
- Disconnect never folds. The seat stays; on its turn the action timer checks or folds. On a table with no timer, a disconnected seat gets 30 s per turn. Between hands a seat disconnected for 2 minutes is cashed out.
- The server rejects out-of-range amounts with `{ code, min, max, have }`. No server string contains a formatted amount.
- Restart: every seat is cashed out to its owner (as today). Tables stay, seats are empty.
