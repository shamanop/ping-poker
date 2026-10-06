# QA-FRANK: browser playtest sweep of v2-core (P5)

Server under test: `repo/` head `60fbd32`, play money only, throwaway data. Re-run: `tests/e2e/sweep/run_all.sh`.

Severity: S1 money or stuck table, S2 wrong or misleading, S3 looks. Status: open, fixed (commit), known.

| id | sev | status | title |
|---|---|---|---|
| Q01 | S2 | open | Heads-up: SB and BB badges are swapped on the seats |
| Q02 | S2 | open | Phone width (390): header, lobby buttons and the action bar are off screen; the table cannot be played |
| Q03 | S2 | open | Returning to a busted seat through JOIN: the buy-in is ignored silently and the table shows a dead hand |
| Q04 | S2 | open | Daily bonus window prints raw cents with no unit |
| Q05 | S3 | open | A busted seat is labelled "JOINING" |

## Q01 (S2) Heads-up: SB and BB badges are swapped on the seats

- Status: open
- Steps: Heads-up table (2 seats), start a hand. Hero is the button.
- Expected: Button seat shows SB (posts the small blind, acts first preflop), the other shows BB.
- Actual: Hero (dealer, posted 25, first to act) is badged BB; the opponent (posted 50) is badged SB. Verified with players[0].isDealer true and roundBet 25 vs 50.
- Where: public/game.js:958-959 (client derives SB/BB as the two seats after the dealer; heads-up the dealer IS the small blind; also wrong when a seat is sitting out). The server knows hand.sbSeat/bbSeat but game_state does not carry them.
- Evidence: ![](qa/v2-sweep/Q01.jpg)

## Q02 (S2) Phone width (390): header, lobby buttons and the action bar are off screen; the table cannot be played

- Status: open
- Steps: Open the site at 390x844, sign in. Lobby, then sit at a table and wait for your turn.
- Expected: Every control reachable; Fold / Call / Raise usable.
- Actual: Lobby: money toggle, daily bonus, account and Sign out sit at x 430-749 and CREATE TABLE / JOIN reach x 435 (page does not scroll). Table: the 210 px chat rail takes half the screen, FOLD is 22 px wide, CALL, RAISE and the raise box are cut off, the table is clipped. Moving the rail to the other side only mirrors it. A phone player can neither sign out nor act; the turn clock folds them.
- Where: public/*.css has no phone @media pass (client defects 1, 2, 14 from ui/REPORT were never started)
- Evidence: ![](qa/v2-sweep/Q02.jpg)

## Q03 (S2) Returning to a busted seat through JOIN: the buy-in is ignored silently and the table shows a dead hand

- Status: open
- Steps: Bust at a table (stack 0), close the tab. Within 2 minutes sign in again, JOIN the same table from the lobby, type a buy-in (20000) and press Sit.
- Expected: Either the buy-in is taken (rebuy) or the rebuy panel appears, or the join is refused with a reason.
- Actual: table_joined stack 0, no money moved (bank still 80,000), the screen shows the previous hand's board and old hole cards, the text "Waiting for a second player" and the seat reads "JOINING". No rebuy panel, no message. The player has typed a buy-in and nothing tells them it was dropped.
- Where: tables/table.js rejoin path (seat exists -> rebind, buyIn ignored, no bust_out re-sent); public/game.js enter()
- Evidence: ![](qa/v2-sweep/Q03.jpg)

## Q04 (S2) Daily bonus window prints raw cents with no unit

- Status: open
- Steps: Sign up a new account. The daily bonus window opens.
- Expected: $100 / $125 ... $1,000 (Play $), as the header pill says "Day 1 $100".
- Actual: The window shows "10,000", "12,500" ... "100,000" and a CLAIM 10,000 button. The values are Play $ cents; a Chips-mode player reads them as 10,000 chips.
- Where: public/juice.js streakCalendar (renders schedule cents with toLocaleString); public/shell.js:331
- Evidence: ![](qa/v2-sweep/Q04.jpg)

## Q05 (S3) A busted seat is labelled "JOINING"

- Status: open
- Steps: Lose all chips at a table; look at your seat and the opponent's seat.
- Expected: "Busted" / "Out of chips" (or Rebuying).
- Actual: Stack 0 seats read "JOINING", the same word used for a seat waiting for the next deal.
- Where: public/game.js:945 (sittingOut without sitOutRequest -> "Joining")
- Evidence: ![](qa/v2-sweep/Q03.jpg)

## Covered

- tests/e2e/*.py re-run on the merged build (buyin, create, host_drawer, rebuy, bender, admin, bank, showdown, ui-audit, games_shell bender pass; rebuy_v2 and raise fail for stale-script reasons, see PROGRESS.md)
- s01 sign-up/bonus/header vs audit (desk; phone stops at Sign out, off screen)
- s02 hands in the browser: fold win, fold lose, showdown, split, side pots, all-in run-out (desk chips, desk Play $)
- s05 reload mid-hand, second tab take-over, transport drop and return

## NOT covered

- Cold Call: not in v2-core (lives on origin/coldcall)
- Phone hands: the 390 layout cannot be played (Q02)
