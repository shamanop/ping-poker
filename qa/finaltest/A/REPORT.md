# Ping Poker FINAL TEST A: full multi-player game

Repo: ping-poker-v2, branch redesign-70s (merged build). Own server on port 3111 with copies of bank/ledger under qa/finaltest/A/. Room password `ping`. No repo code edited, nothing committed or pushed, live Railway URL never touched. Server killed at the end.

Files: phase1.js / phase1.out / phase1-result.json (socket.io, 5 players), phase2.py / phase2.log / phase2-result.json / shot-*.png (browser), bots.js / bots.log (bot opponents + conservation observer), server.log.

## Verdict

Server logic is solid: 22 hands, zero conservation breaks, zero stalls, side pots and payouts match an independent evaluator in every hand. No console errors or failed requests in the browser. Bugs found are display-only (one medium, two low).

## Phase 1: 5 scripted socket clients (Ann host, Bob, Cat, Dan, Eve)

Result: 141 CHECK PASS, 2 CHECK FAIL (both harness timing artifacts, see below). 22 hands: 17 showdown, 5 fold-win. 33 all-ins. Side-pot hands: 5,6,8,9,10,12,13,14,17,18,21,22.

Method: per-hand contribution accounting from each accepted action, independent 7-card evaluator (best7), layered side-pot payouts compared to server stacks, pot == sum of contributions, bank + stacks + pot == expected total (57000 = 7000 testplayer + 5 x 10000), timing from deal to showdown_result.

| Check | Result | Evidence |
|---|---|---|
| Wrong room password rejected | PASS | "Incorrect password" |
| 5 seated, buy-in debited from bank | PASS | ann/bob/cat/dan/eve = 8500 each after 1500 buy-in |
| Non-host start_game rejected (pre-game and after handoff) | PASS | "Only host can start" |
| Join during a hand rejected | PASS | "Game in progress, wait for next round" |
| Out-of-turn action rejected | PASS | "Not your turn" (hand 2) |
| Illegal check, fractional/NaN raise, unknown action rejected without stalling | PASS | 4 distinct error strings, hand 2 completed normally |
| Chip conservation after every hand | PASS | all 22 hands, e.g. hand 19: bank 55180 + stacks 1820 + pot 0 = 57000; hand 21: 52500 + 4500 + 0 = 57000 |
| Pot equals sum of contributions every hand | PASS | e.g. hand 21 pot 3090 = Bob 1480 + Ann 1510 + Eve 100 |
| Side-pot layering and showdown payouts vs independent evaluator | PASS | hand 20: layers [[20,60,Ann],[100,160,Ann],[180,80,Ann]]; hand 21: [[100,300],[1480,2760],[1510,30]] all Ann; 20 of 22 hands pass automatically, hand 7 see artifact A |
| No stall: every hand reaches showdown/fold-win | PASS | longest normal hand 5.1s (hand 5); hand 10 intentionally idle: 32.5s total |
| Turn timer auto-fold | PASS | hand 10: Cat idle, FOLD recorded at 30s, hand completed |
| Sit out / sit back in | PASS | hand 7 Cat dealt 0 cards; hand 8 dealt 2 cards after toggle |
| Rebuy between hands (waiting_next) | PASS | many, e.g. Eve hand 7: 0 -> 1500, bank 8500 -> 7000, dealt in hand 8 |
| Rebuy during a playing hand | PASS | Ann hand 7: 0 -> 1500, sits out, dealt in at hand 8 |
| Bust_out event delivered | PASS | hands 6,8,9,... |
| Player leaves mid-hand | PASS | Eve (hand 13), Dan (hand 14, on his own turn): folded, chips cashed out, hand finished, conserved |
| Host handoff on host leave | PASS | hand 19: Ann (host) left on flop, room_update hostName = Bob |
| Lone survivor cashed out | PASS | hand 19: Ann and Cat left, status waiting, Bob chips 0, bank 57000 |
| Rebuy on waiting table + rejoin in waiting + start by new host | PASS | Bob rebuy 0 -> 1500, Ann and Eve rejoin, Ann's start rejected, hand 20 dealt |
| Final: everyone disconnects, bank restored | PASS | bank sum 57000 = expected |
| Ledger reproduces final balances | PASS | 145 entries (buyin 7, rebuy 18, cashout 7, bank-start 6, snapshot 22, win 22, loss 63); net per name matches bank |
| 15+ hands completed | PASS | 22 |

The 2 FAILs are harness artifacts, not server defects:
- A. Hand 7 payout check "Ann: server=1500 expected=0". Ann (busted in hand 6) rebought during hand 7 and the harness read her stack after the rebuy landed but before its own rebuy offset was applied. Server was correct: Ann had no cards, pot 30 went to Bob, conservation PASS in the same hand (bank 48000 + stacks 9000 = 57000).
- B. "start_game by handed-off host (Bob) starts a hand: before=waiting after=waiting_next". Bob's start worked (hand 20 was dealt, dealer Bob, logged at 162.2s). The hand was a 1-second fold-win, so by the time the check polled, status had already moved to waiting_next.

An earlier run in this session (old2/) showed the same two artifacts plus a stale-action count after leaves; those were fixed in the harness, not the server.

## Phase 2: one real browser (chromium 1920x1080) vs 2 bots (Rex, Sly)

3 hands played. Browser console errors: 0. pageerrors: 0. requestfailed: 0. HTTP >= 400: 0. Bot-side conservation after every hand: OK (bank 82500 + stacks 4500 + pot 0 = 87000 on hands 1,2,3).

| Check | Result | Evidence |
|---|---|---|
| Lobby shows players, host can start | PASS | lobby count 3, #btn-start works |
| My turn UI: timer, call/raise controls | PASS | screenshot 1: "YOUR TURN", ring at 29, seat timer 29s, FOLD / CALL 20 / RAISE to 40, presets 40/45/58/70/1500 |
| First-turn countdown renders despite server turnRemainingMs null | PASS | client falls back to local TURN_MS timer (game.js ~459-463); visible in screenshot 1 |
| Call (hand 1), raise via preset + raise button (hand 2) | PASS | raise-input=50 sent, hand continued |
| Showdown overlay shows and clears, next hand auto-starts | PASS | overlays 9.8s to 12.2s, hands 1,2,3 all seen |
| Bust screen | PASS | screenshot 4: "OUT OF CHIPS, Bank 8,500, REBUY 1,500 / SPECTATE / LEAVE", seat shows AWAY |
| Human fold on hand 3 | NOT EXERCISED | Hume busted in hand 2 (lost 1360 all-in vs both bots), so hand 3 was watched, not played |

Screenshots viewed: 2 of 4 (shot-1-my-turn.png, shot-4-final.png).

## Bugs, severity ranked

### 1. MEDIUM: showdown overlay splits the pot evenly between "winners" even when winners got different amounts (display only)
- Cause: server emits `showdown_result { winners: [{name, handName, cards}], pot }` with no per-winner amounts (server.js:617-627). Client renderShowdown computes `share = floor(pot / winners.length)` (game.js:1525-1530).
- Evidence: browser hand 2. Server log and chat log: "Rex wins 4080 with Two Pair" and "Sly wins 420 with Pair". Overlay: "Rex Two Pair +2,250" and "Sly Pair +2,250".
- Impact: players see wrong payout amounts whenever a side pot or an uncalled-bet refund exists (common in all-in hands). Chip stacks themselves are correct.
- Repro: 3 players, two go all-in for the same amount while the third has more chips and covers; the shorter-stack winner and the covering player both appear in winners; overlay shows pot/2 each.
- Suggested fix: include `amount` per winner in showdown_result and render it.

### 2. LOW: uncalled-bet refund is reported as a showdown win with the hand name
- Evidence: hand 2 log "Sly wins 420 with Pair". Sly held a losing pair; 420 was the uncalled excess of his bet returned. The overlay lists Sly as a winner with "Pair" and highlights his seat as winner.
- Impact: misleading log and winner highlight, no chip impact.
- Repro: same as bug 1.

### 3. LOW: stale action badges remain on seats at showdown/between hands
- Evidence: screenshot 4 and DOM text after hand 3: Rex seat "CALL 0", Sly seat "RAISE TO 0" while status is waiting_next. Bottom bar shows disabled "BET".
- Impact: cosmetic clutter between hands; "RAISE TO 0" is nonsensical.

### 4. INFO: first game_state of each hand has turnRemainingMs = null
- Cause: scheduleTurnTimeout runs after the broadcast. Phase 1 confirmed on hand 10 ("turnRemainingMs at start of turn null"). Client fallback hides it (screenshot 1 shows 29s ring), so no user-visible effect. A client that does not have the fallback would show no countdown on the first action of every hand.

### Not bugs (checked)
- Header blind timer "NEXT 9:59 / LEVEL 1" in the browser run: the client start button sends a blindInterval, so blinds are enabled there. In the socket run, start_game without blindInterval correctly keeps blinds flat at 10/20.
- Hand 10 taking 32.5s: deliberate idle test, auto-fold at the 30s timer.

## Not covered
- Real multi-browser sessions (only one browser). Mobile layout, chat, stickers, rank tab not driven.
- Blind escalation with a real interval was not exercised in phase 1 (flat blinds).
