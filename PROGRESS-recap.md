# Night recap (branch feat-recap, based on v2)

## What it is
A full-screen overlay (`Recap.open()`, public/recap.js + recap.css) fed by one socket event, `recap_get` -> `recap_data`, built in the new server module `recap.js`.

- Up and down: net per player in the table's display unit (dollars when $ is on, via Money.fmt).
- Highlights, computed only from recorded hands: biggest pot, best hand shown, most hands won, biggest single-hand win/loss, most raises, most all-ins, most pots won by everyone folding, longest winning streak. A highlight only appears if the data supports it (e.g. streak needs 3+).
- Hand by hand list, and a replay per hand: hole cards, board by street, every action with the running pot, winner(s) and hand name.
- Share card: 1080x1350 PNG drawn client-side on a canvas (Download / Share / Copy image in a preview modal).

## Where to reach it
- Table: "Recap" button next to BANK (only while seated at a table).
- Bank panel: "Recap" button in the Bank header.
- Night-end screen (viewSettle): "Night recap" button, opens that night.

## Data and honesty
- Every hand is recorded at deal / action / showdown / end into `recap-hands.jsonl` next to the bank (`RECAP_FILE`), capped at 6000 hands in memory. Cards of players who did not show are never sent to other viewers (viewer sees own cards, plus voluntary shows).
- Chips and Play $ night nets: for a night with complete money history, net = settle-up net (cash-outs + stack - buy-ins), matching the night-end screen exactly.
- Play $ money rows (buy-ins/cash-outs) live in memory only (tables.js playEntries). If the night started before the last restart, the recap says so ("since last restart" note), and nets come from recorded hand results instead of buy-in totals. Hand nets always sum to zero.
- If the log starts after hand 1, a note says earlier hands were not recorded.
- POKERPING has no nightId. A session = a run of hands with no gap of 4 hours or more (`SESSION_GAP_MS` in recap.js). The recap shows the latest session, with a selector for the last 12. Net there = chips won/lost in hands; buy-ins, cash-outs and bank edits are not counted (stated in the note).
- Access: admins, the host, anyone seated/recorded in the night. Others get "No such night".

## Files
server.js (6 small hook lines + 1 require), recap.js, public/recap.js, public/recap.css, public/index.html (two tags, cache-bust 2-1005r), tests/recap.js. No edits to lobby.js, game.js or bank.js: buttons are injected by recap.js and re-injected by a MutationObserver.

## This run (second) fixes
- Mobile: cards were clipped/stacked on top of each other (grid auto rows collapsing); now a flex column that scrolls.
- Overlay z-index 80 -> 9250: it sat under juice win animations (coins over the recap) and the lobby/settle overlay.
- Escape listener moved to window capture so it works even when another handler swallows the key.
- Share card: highlights overlapped the footer; rows now size from the player count (fills 3-5 highlight rows, no overlap, no collisions with cards).

## Checks
- tests/recap.js: 36 PASS (bots play 26 hands chips, 8 hands Play $, 6 POKERPING; nets sum to zero, biggest pot = max pot clients saw, wins tally = showdown events, recap net = settle-up net, hidden cards not leaked, access control, restart persistence + Play $ memory-only flag).
- All tests/*.js: all pass except preselect (5 known) and migrate (1: "no accounts.json written in the repo", unrelated to recap, not investigated) and mp (soak, timed out at 150s). qa/ cleaned.
- Playwright (recap-evidence/run.py, fx.py): 1440x900 and 390x844 screenshots, all three entry points, replay stepping, share card to PNG (share-card-usd.png, share-card-chips.png). No page errors.
- Evidence lives in /home/isabelle/.openclaw/workspace/ping-v2/recap/ (small/ = downscaled JPEG copies; scripts need to run from the worktree's recap-evidence/ dir).

## Open
- Bank charts are not a data source: the recap computes its own numbers from the hand log (they agree at the end of a night; the live Bank shows later values than an older recap snapshot).
- Seat-to-seat hand-name for folded-out hands is not shown (not known).
