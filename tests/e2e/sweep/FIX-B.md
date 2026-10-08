# P5 fix B progress (Q01 Q04 Q05 Q06 Q07), branch p5-fix-b off v2-core caa487d

Tests
- tests/v2/31_blind_badges.js (node socket; `V2_PORT_BASE=4717 node tests/v2/31_blind_badges.js`)
- tests/e2e/sweep/fix_b_labels.py (Playwright; `E2E_BASE=http://127.0.0.1:4715 python3 tests/e2e/sweep/fix_b_labels.py`)

## BEFORE (caa487d, unfixed)
31_blind_badges.js: 3 FAIL, e.g. `FAIL 31 headsup-blind-badges-match-posted [Q01] heads-up: players[*].blind missing from game_state`
fix_b_labels.py: 22 checks, 10 failed:
    FAIL headsup: seat badges = seats that posted 25/50 got {'h93244he': 'BB', 'b193244he': 'SB'} want {'h93244he': 'SB', 'b193244he': 'BB'}
    FAIL bonus window day amounts, pref auto got ['10,000', '12,500', '15,000', '20,000', '25,000', '35,000', '100,000'] want ['$100', '$125', '$150', '$200', '$250', '$350', '$1,000']
    FAIL bonus window claim button, pref auto got 'CLAIM 10,000' want 'CLAIM $100'
    FAIL bonus window day amounts, pref chips got ['10,000', '12,500', '15,000', '20,000', '25,000', '35,000', '100,000'] want ['$100', '$125', '$150', '$200', '$250', '$350', '$1,000']
    FAIL bonus window claim button, pref chips got 'CLAIM 10,000' want 'CLAIM $100'
    FAIL seats stepper after 3 presses of + from the default got '9' want '8'
    FAIL seats stepper stops at 8 got '9' want '8'
    FAIL Cash create refusal reads dollars (every message) ['Minimum buy-in is below the big blind (at least 50, you have 10)', 'Minimum buy-in is below the big blind (at least 50, you have 10)']
    FAIL busted seat is labelled Out of chips 'Joining'
    FAIL busted seat is not labelled Joining 'Joining'
    fix_b_labels: 22 checks, 10 failed

## AFTER
31_blind_badges.js: 3 PASS. fix_b_labels.py: 22 checks, 0 failed.
30_shapes (--target .): 42 pass 0 fail. run-tables 127/127, run-money 90/90, run-engine 96/0, amountfield 66/0, money.test 6538/0.

## Fixes
- Q01 transport/views.js seatRow: additive `blind: 'SB'|'BB'|null` from engine hand.sbSeat/bbSeat (live hand, dealt seats only); public/game.js prints p.blind, nextActiveSeat deleted.
- Q04 public/juice.js streakCalendar takes o.format (cents -> text), shell.js passes dollars(): $100 .. $1,000 in every pref (it is Cash).
- Q07 public/lobby.js error handler words a create-form error in the form's unit. Also public/game.js: its own error listener toasted the same error in chips mode while not at a table (second, wrong message); it now only toasts inside a table.
- Q06 lobby.js seats stepper max 8.
- Q05 game.js seatStatus: 0 chips -> "Out of chips"; "Joining" kept for a seat with chips waiting for the deal. No per-seat rebuy flag in game_state, so no "Rebuying" label.
