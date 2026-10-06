# engine/ progress (builder P2)

Branch `v2-engine`, worktree `wt-engine`. Owner: engine builder. Pure poker: no timers, no I/O, no Date, no Math.random.

Run everything: `node tests/v2-unit/run-engine.js` (options `--seed N`, `--hands N`; env `ENGINE_SEED`, `ENGINE_HANDS`; exit 0 = pass).
About 90 s for the default 20,000 random hands per random test.

## Status

- [x] engine/deck.js, evaluate.js, pots.js, hand.js to the V2-DESIGN.md contract
- [x] Rule tests (66 named cases), evaluator port + differential, property test, old-showdown differential
- [x] Mutation check: 9 deliberate engine bugs (reopen on short all-in, odd chip to lowest seat, min-raise = bb, no uncalled return, reversed HU blinds, folded chips dropped, stale toAct after foldOut, raise with no one to answer, lastFullRaise not reset) each turn the suite red

## API as built

```
deck.js      SUITS, RANKS, makeDeck() (ordered, suit-major), shuffle(deck, rng) -> new array (rng = () => [0,1))
evaluate.js  evaluate5, compareHands, bestHand       moved from server.js unchanged (only RANKS now imported from deck.js)
pots.js      sidePots(committedBySeat, foldedSeats) -> [{ amount, eligible: [seat] }]   lowest layer first
hand.js      createHand({ handNo, button, sb, bb, seats: [{ seat, stack }], deck }) -> hand
             legalActions(hand, seat) -> null | { toCall, canCheck, canCall, callAmount, canRaise, minRaiseTo, maxRaiseTo }
             apply(hand, seat, { type: 'fold'|'check'|'call'|'raise', to }) -> events[]     mutates, throws RuleError
             foldOut(hand, seat) -> events[]
             dealNext(hand) -> events[]            one street during phase 'runout'
             settle(hand) -> { pots, payouts, returned, net, reveals, handNames }
             totalPot(hand) -> chips in the pots (committed - returned), extra helper for the client pot display
             RuleError(code, details)
```

Hand state is exactly the contract object plus: `seats[s].returned`, `hand.uncontested`, `hand.result` (cache of settle). Seats are keyed by seat number (object keys become strings after JSON; every function accepts an integer or a digit string for `seat`, anything else is never a seat).

RuleError codes: `not_your_turn`, `bad_action`, `cannot_check`, `cannot_call`, `bad_amount` (not a positive safe integer), `raise_closed`, `raise_too_small`, `raise_too_big` (the last three carry `details: { min, max, have }`), `not_runout`, `not_settleable`, `not_in_hand`, `hand_over`, and for createHand `bad_seats`, `bad_stack`, `bad_blinds`, `bad_button`, `bad_deck`. A thrown error never leaves the hand changed (tested on every rejected action in the property test).

Events: `fold {seat, forced?}`, `check {seat}`, `call {seat, amount, allIn}`, `raise {kind: 'bet'|'raise', seat, to, added, allIn, full}`, `returned {seat, amount}`, `street {street, cards}`, `runout`, `showdown {uncontested}`. `createHand` returns the hand only; blinds are readable from `sbSeat/bbSeat` and `seats[s].bet`. If nobody can act after the blinds the hand is returned already in `phase: 'runout'`.

Flow: `betting` -> (closing round) -> next street `betting`, or `runout` (call `dealNext` per street), or `showdown` (all streets dealt, or everyone else folded: `uncontested: true`) -> `settle` -> `done`.

## Where the contract was unclear and what I chose

1. **settle mutates and credits stacks.** The contract does not say. `settle` adds `payouts` to `seats[s].stack` once, sets `phase`/`street` to `'done'`, caches the result in `hand.result` and returns the same object on a second call. After it, `stack - stackAtHandStart === net[seat]`. The table layer must not add payouts again. Returned chips go back into `stack` immediately when betting closes (event `returned`), so a seat that leaves mid-hand cashes out stack including the returned part. `committed` is never reduced, so the table's hand batch is `seat -> pot` for `committed`, `pot -> seat` for `payouts[s] + returned[s]`.
2. **`returned` timing and E1.** Uncalled part = (top bet this street) - (second highest bet this street, folded seats included), only when the top bet is unique. Applied when a betting round closes, also on the fold-win path. **E1 (2026-10-06, V2-DESIGN 4.5/12a): it goes to the top bettor even if `foldOut` removed that seat (the seat is flagged `forced`). A top bettor that folded by its own action gets nothing back: its whole bet is dead money, as in the old server's showdown (lead fix 03:45 after seed 7 hand 8895 of the differential failed on f9a237a, which refunded voluntary folds too)** (kicked or stood-up top bettor gets the uncalled layer back; heads-up: host limps, P1 raises to 500, host kicks P1 -> P1 +450 returned, host wins 100). The only exception is a guard: if handing it back would leave the pot empty (`totalPot - back <= 0`) it stays. That cannot happen with blinds posted; it exists so chips can never vanish. `allIn` is `stack === 0` at all times, so a seat that gets chips back is no longer flagged all-in.
3. **Fold-win** ends in `phase: 'showdown'` with `uncontested: true` (there is no 'done' until `settle`). `reveals` is `[]`, `handNames` is `{}`, `pots` is one pot.
4. **Short all-in never reopens, even cumulatively.** The contract says a short all-in does not reopen seats that already acted; I implemented exactly that. TDA rule 47 lets several short all-ins that add up to a full raise reopen the action; that is NOT implemented (a seat that acted stays closed until a real full raise). Say if you want the cumulative rule.
5. **A raise needs someone who can answer.** `canRaise` is also false when every other live seat is all-in (old server converted such a raise into a call). `apply` then throws `raise_closed`. `minRaiseTo/maxRaiseTo` are `null` whenever `canRaise` is false.
6. **Call-size on short blinds.** `currentBet = bb` preflop even if the BB posted less (the old server does the same; players owe the full BB and the unmatched part comes back as `returned`).
7. **Odd chips**: one chip at a time to the winners in order left of the button (remainder 2 in a 3-way split gives the first two winners one extra each). `pots[].winners` is listed in that order.
8. **Dead chips.** Chips a folded seat put in above every live seat's commitment that were NOT returned (a seat with a smaller excess is not the top bettor, or two folded seats tied at the top) join the top pot. If no live seat has put in anything (everyone else was folded out), the live seats share the dead money (`sidePots` returns one pot whose eligible list is the live seats).
9. **`fold` is always legal** on your turn (also when you could check). `to` is ignored for fold/check/call; a call is always `min(toCall, stack)`.
10. **foldOut** in `showdown`/`done` throws `hand_over`; on a seat already folded it is a no-op returning `[]`; it may fold an all-in seat (kick/leave) in betting or run-out. It never applies to a seat that is not in the hand (`not_in_hand`).
11. **Deck**: `createHand` copies the deck (the caller's array is not mutated); `makeDeck()` is unshuffled, `shuffle` returns a new array. Deal order matches the old server (one card per seat ascending, twice; burn, flop x3, burn, turn, burn, river by `deck.pop()`), so `rigDeck` from `tests/v2/lib.js` works unchanged (my test helper is a line-for-line copy of it).
12. Blinds validated: integers, `1 <= sb <= bb`; stacks `>= 1`; deck must hold at least `2 * seats + 8` cards.

## Tests (all under tests/v2-unit/, run by run-engine.js)

| file | what |
|---|---|
| engine-rules.js | 66 table-driven cases: H2, H3, H4, M1, M8, L1, L3, L5, BB option, run-out, side pots, foldOut, JSON round-trip, createHand validation, ports of the 20_pots.js scenarios (S1-S10), bad input and out-of-turn |
| engine-eval.js | 11 cases ported from 03_eval.js, one case per hand class, 20,000 random hands vs the old evaluator |
| engine-property.js | N random hands, 2-9 seats, stacks below the blinds, legal + illegal actions, random foldOut, a JSON-roundtripped twin, independent water-fill settlement oracle, an independent check of every `returned` event (E1 rule), coverage assertions |
| engine-showdown-diff.js | old `showdown()` (copied verbatim) vs `settle` on N random contested showdowns, exact (no odd chips) and arbitrary amounts, plus L1/L3 labelled differences |
| engine-old-server.js | fixture: evaluator and showdown copied from server.js at 9440541 |
| engine-lib.js | seeded rng, rigDeck, helpers |

## Not verified

- Nothing runs through sockets or the table layer; no timers or money. Property tests assume the table layer calls `apply` / `foldOut` / `dealNext` / `settle` as documented above.
- The old server was not required: `server.js` has side effects at load, so the differential uses a verbatim copy (engine-old-server.js). It was copied once from 9440541 and is not re-synced.
- The old-showdown differential skips fold-wins (the old code paid those through `instantWin`, not `showdown`); fold-win money is checked by the rule cases and the property oracle instead.
- The oracle in the property test is my own re-derivation of the pot rules (same author as the engine): a shared misreading of poker rules would pass both. The old-showdown differential is the independent check, but only for contested showdowns.
- Cumulative short-all-in reopening (see 4) is deliberately absent.
- No performance test beyond the 20k-hand run time.
