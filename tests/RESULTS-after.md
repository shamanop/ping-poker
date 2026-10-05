# Server fix pass (pp-serverfix) progress

## Baseline on this branch (before fixes): 64 hands, 39 findings, 155s
- F2 side pots: NOT reproduced (layered handBet split already in branch).
- Still reproducing: F1, F3, F4, F5, F6, F7, F8, F9, F10, F11, F12, F13 plus medium/low items.

## Fixes (appended as done)
- F1 FIXED: `on()` wrapper in io.on('connection') coerces non-object payloads to {} and try/catches handlers; names validated as strings, trimmed, max 24 (commit c6fcfad).
- F3 FIXED: raise needs Number.isSafeInteger, else error event "Raise amount must be a whole number".
- F4 FIXED: toCall clamped >= 0; a raise that does not exceed currentBet is treated as a call/all-in call and never lowers currentBet.
- F5 FIXED: start_game needs 2+ connected players with chips and not sitting out; also refused during waiting_next; blindInterval must be finite, clamped 1min..6h.
- F6 FIXED: clearHandTimers (turn, bot, street, next-hand); scheduleNextHand clears and stores nextHandTimer; instantWin/showdown ignore a second hand end; timers check handNum; room reset clears timers.
- F7/F11 FIXED: rebuy allowed whenever chips == 0 (except all-in player still holding cards in a live hand); mid-hand rebuy sets sittingOut until startHand deals next hand.
- F8 FIXED: processAction only clears the turn timer after an accepted action; rejected actions emit error (unknown action, bad check, bad raise amount, unknown room, no hand in progress).
- F9 FIXED: dealer picked at next-hand time as next clockwise connected seat with chips and no sit-out request (object-based, survives seat removal).
- F12 FIXED: host reassigned to next connected human on host disconnect (lobby and mid-hand), room_update broadcast.
- F13 FIXED: with 2+ chipped players but <2 willing, stacks are kept (no cash-out), sit-outs cleared, room returns to 'waiting' and host can restart. Harness S15 still lists this because it flags any 'waiting' status; chips are retained (sg1:1520 sg2:1480, bank intact).
- F10 SKIPPED: reconnect-by-name needs seat/identity rebinding and un-cashing the stack; not small/clean. Left open.
- Medium/low left: late joiners queue (S11), min-raise silent promotion, AFK auto-sit-out.

## After run: 63 hands, 5 findings (F10, S15 flag-only, S11, 2 low), 156s. labels.test: 52033 checks 0 failures; clientlabels: 19 scenarios OK.
