# FINAL TEST B: bank dashboard and ledger correctness

Build: redesign-70s @ 517de8d (merged). Own server on port 3112, files in qa/finaltest/B/ (bank.json, ledger.json). Live Railway URL never touched. No code edited. Baseline for bank math: `git show master:server.js` (main is named `master` here).
Scripts: run1.js (10+ hand session), run2.js / run3.js (restart + kill -9), bots.js + browser.py (Playwright, real Chromium), bench.js. Logs: run1.out, browser.log, bots*.out, snap1.json, ledger.after1.json, bank.after1.json.

## Results

| # | Check | Result |
|---|-------|--------|
| 1 | Ledger adds up, per-player net = bank + table - start, sum P&L = 0 | PASS |
| 2 | Summary API matches ledger file and bank.json | PASS |
| 3 | bank.json math/format unchanged vs master | PASS |
| 4 | Restart: ledger + bank survive, no double count | PASS for persistence/no double count. FAIL for chart integrity (BUG 1); table stacks lost on restart (BUG 2, pre-existing) |
| 5 | Wrong password / wrong room | PASS for password (403). FAIL for wrong room (BUG 3: 200 with full data). Socket path correctly gated |
| 6 | Browser Bank panel 1920x1080 and 1440x900 live hand | PASS (numbers match API 33/33 at both sizes, tooltip, action bar, 0 console errors). Chart content corrupted only when the ledger spans a server restart (BUG 1) |

### 1. Ledger arithmetic (run1.js: Ann, Bob, Cy, Dee, 13 hands, 2 rebuys, 1 leave, 1 bust)
Events: 4 buy-ins at hand 0, hand 3 Bob+Dee bust -> rebuy 1,500 each (2 rebuys), hand 7 Cy disconnects with 280 chips (cash-out), hand 6 Dee busts again (no rebuy, stays "sitting-out"), then session end disconnect cash-outs.
Snapshot after hand 13 (status waiting_next), start bank 10,000 each, API vs recomputed:
- Ann: bank 8,500 + table 1,730 - 10,000 = +230; API net +230
- Bob: 7,000 + 6,990 - 10,000 = +3,990; API net +3,990 (2 buy-ins, 1 rebuy 1,500, best win 5,440)
- Cy: 8,780 + 0 - 10,000 = -1,220; API net -1,220 (cashed out 280, status offline)
- Dee: 7,000 + 0 - 10,000 = -3,000; API net -3,000 (2 buy-ins, 1 rebuy, status sitting-out)
- Sum of net P&L = 0 (API and recomputed). Sum of win/loss ledger entries = 0 for every hand 1..13.
After disconnect cash-outs, bank.json = ann 10,230 / bob 13,990 / cy 8,780 / dee 7,000 and equals start - buyins + cashouts reconstructed purely from ledger entries for all four; the `balanceAfter` chain on every buyin/rebuy/cashout entry replays exactly. Money conservation: banks + table = 40,000 = 4 x 10,000.
Mid-hand cash-out (everyone disconnected during hand 5, pot 520): ledger loss/win deltas include the cashed-out amount correctly (Ann cashout 1,540, loss 200; Bob cashout 1,610 win 360); sum net = 0.

### 2. API vs ledger/bank.json
Browser session (5 humans, 148 entries): for every player API bank == bank.json, API totalBuyIns == ledger buy-in+rebuy sum, API cashedOut == ledger cash-out sum, API net == cashedOut + atTable - totalBuyIns. All equal.

### 3. bank.json math
`git diff master redesign-70s -- server.js` bank hunks: getBalance/adjustBank bodies identical (same BANK_DEFAULT 10000, same `Math.max(0, bank+delta)`, same saveBank JSON.stringify of `{ "lowercasename": int }`); the new args (type/room/tableChips) only feed the ledger. File observed after all sessions is `{"testplayer":7000,"ann":...}` unchanged format; `testplayer` entry untouched. BANK_FILE env override is the only other change.

### 4. Restart
- Graceful stop/start with 64 ledger entries: entries still 64, bank-start count still 5 (seedBank does not re-add), API before/after identical for every player field, series and events. No double count.
- kill -9 mid-hand with Ann 1,480 + Bob 1,520 seated: ledger.json loaded fine (atomic tmp+rename), bank.json intact, dashboard net matches bank (Bob 4,120 -> 2,600, i.e. -1,520 table stack). See BUG 2 for the lost chips.

### 5. Auth
`/api/bank-summary` with no password, empty, `wrong`, `PING`, `password[]=ping`, wrong password + valid room -> 403 `{"error":"Incorrect password"}`. POST -> 404. Socket `get_bank_summary` from a non-member socket (valid room, unknown room, null, object roomId) -> no `bank_summary` emitted.
`password=ping&room=NOPE` -> 200 with all 4 players, banks, nets and 17 events (series empty). See BUG 3.

### 6. Browser (Playwright Chromium, player "Gus" vs 3 socket bots; hand slowed so panel opened mid-hand)
- 1920x1080, live hand (flop, pot 80): B key opens panel; panel rect [0,53,1560,965], action bar [0,965,1560,1080], elementFromPoint at bar center is inside #action-bar, Fold button visible and clickable. Tooltip shown: "Hand 5 Fay 1,760 Bob 1,520 Dee 1,480 Gus 1,240".
- 1440x900 (resized with panel open), live hand (pot 50): panel [0,44,1140,804], bar [0,804,1140,900], bar hit-test true, tooltip shown. Esc closes panel.
- Hand-end comparison of DOM vs `/api/bank-summary`: standings (bank, at table, net, buy-ins, best win), header totals (Banked 38,000 / On the table / Bought in / Hands), bar values, activity feed order+amounts, chart end labels and path count: 33/33 OK at 1920, 33/33 OK at 1440.
- Console/page errors/failed requests/HTTP>=400: none in either run.
- Screenshots viewed: s1-1920-live.png, s2-1920-hover.png, s3-1440-live.png.

## Bugs (severity ranked)

### BUG 1 (MEDIUM) Hand numbers restart after every server restart, corrupting chart and hand counts
Repro: play hands 1..13, restart server (Railway does this on every deploy), join and play hands 1..4 in the same room, GET `/api/bank-summary?password=ping`.
Actual: ledger snapshots are keyed by (room, handNum) in `Map hands` (ledger.js summary), so new hand 1..4 overwrite old 1..4 and old hands 5..13 stay: series Ann = [[1,1500],[2,1860],[3,1740],[4,1740],[5,3260],[6,1030],...,[13,1730]] with maxHand 13, handsPlayed 17 (13+4). Seen in the browser too: after a restart the panel showed "10 hands" and lines running to hand 10 while the table was on hand 7, Header HANDS = 10, and lines mixing two sessions.
Fix idea: key snapshots by ledger index or add a session id (boot timestamp) to snapshots and plot sequentially, or persist/restore room.handNum.

### BUG 2 (MEDIUM, pre-existing on master, not a regression) Seated stacks vanish on server stop/restart
Repro: two players seated mid-hand, `kill -9` (or SIGTERM) the server, restart. bank.json is debited at buy-in and only credited by the disconnect/lone-player cash-out paths; there is no process signal handler (master has none either). 3,000 chips (1,480 + 1,520) disappeared; dashboard reports it truthfully as net loss, so Sum P&L != 0 afterwards (-6,000 total in my session from 4 such stacks). Suggest SIGTERM handler that cashes out all human stacks and saves bank/ledger (Railway sends SIGTERM on deploy).

### BUG 3 (LOW) `/api/bank-summary` with a wrong/unknown room returns data
Repro: `curl 'localhost:3112/api/bank-summary?password=ping&room=NOPE'` -> 200, 4 players with bank balances and 17 events (players and buy-in/cash-out events are not room-filtered; only series is). Also `room[]=x` -> 200. Password is still required so exposure is limited to someone who knows `ping`. Suggest 404/empty for rooms not in `rooms`.

### BUG 4 (LOW, documented in NOTES.md) Mid-hand P&L dips
Net P&L and "At table" use `p.chips`, so chips committed to the pot count as losses until the hand ends; sum of nets != 0 mid-hand by the pot size. Hand-end values are exact.

### Notes (no action required)
- `check_balance` socket event creates a 10,000 bank account for any name, unauthenticated (pre-existing).
- Ledger rewrites the whole file on every push: 0.6 ms at 1k entries, 4 ms at 10k, 20 ms at 50k (5.6 MB). Fine at this scale.
- Test infra: at one point all `node server.js` processes on the box (including mine and other test servers) died at once, likely another test's broad pkill. I restarted mine; the lost state is described in BUG 2 numbers.
