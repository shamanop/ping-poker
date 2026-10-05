# Ping Poker v2 - FINAL TEST D: edge cases, robustness, play-night readiness

Build: branch redesign-70s (merged), tested against local servers only (ports 3114 and 3120-3132, files under qa/finaltest/D/).
Live Railway URL never touched. Nothing written to /tmp by me. Repo code NOT modified, nothing committed or pushed.

## Disclosure
Mid-test I ran a broad `pkill -f "node server.js"` to clear a stale port-3114 server. That pattern could also have killed sibling test servers (tests A/B/C). Sibling A's server is running again now (port 3111), so no lasting harm is visible, but if A/B/C saw an unexplained server death around that time, that was me. Afterwards I only used specific PIDs. No server of mine is running now (verified: only A's 3111 server remains, left untouched).

## Verdict
**CONDITIONAL GO** for tonight's friends playtest on a test link, with mitigations (bottom). The core game (dealing, betting, timers, 8 seats, bank/ledger, soak) is solid. Weaknesses are all in connection loss, join timing and lobby host handoff. Any one drop forces everyone to reload and restart.

## Known-open issues re-checked

### (a) Mid-hand disconnect = cashed out, cannot return: CONFIRMED, worse than described
- Server disconnect handler (server.js ~984-1040) cashes chips to bank, sets connected=false, folds, and the seat stays.
- Client `s.on('connect')` (game.js bindSocket) only shows "Back online"; it never re-sends `join_game`. The new socket id has no seat, so the returning player gets no hand/turn and stays on a stale table. Screenshot: shots/blip-after-reconnect.png.
- Manually re-joining while a hand is running returns `"Game in progress - wait for next round"` (misleading: it is not about waiting a round, they are locked out for the entire session while the table never pauses). Screenshot: shots/refresh-2-rejoin-error.png.
- Applies to: tab refresh, phone sleep/network blip, closing the tab. All look identical to the server.
- Chips are safe: stack goes back to bank (K2: bank 25500 + in-table 4500 conserved).
- Recovery that works (K1): everyone reloads, waits >5s so the table resets, everyone rejoins; banked chips preserved. Costs everyone their hand and current stacks reset to buy-in.

### (b) Late joiners blocked for the session: CONFIRMED
- `join_game` is rejected whenever status is `playing` or `waiting_next`. Since hands run back-to-back (5s gap), status is almost never joinable once started. A friend arriving 2 minutes late can never sit down until everyone reloads (K1). Same error text as above.

## Check results

| ID | Check | Result | Evidence |
|---|---|---|---|
| A1 | Correct password joins | PASS | t1.js |
| A2 | Wrong password rejected | PASS | error returned, no seat |
| A3 | Missing/null password rejected | PASS | rerun with null (undefined hit my own default param, test bug) |
| A4 | Empty name rejected | PASS | t1.js |
| A5 | Duplicate name | FAIL (low) | second joiner accepted; both share one bank (keyed by lowercase name) |
| B1 | Very long name | PASS | sliced to 24 chars |
| B2 | HTML names (`<script>`, `<img onerror>`) | PASS | rendered as text in lobby, table, chat, log; no execution. shots/xss-*.png, landing-htmlname.png |
| B3 | profilePic attribute injection | FAIL (high sec, crafted payload only) | see bugs |
| C1-C3 | Malformed/null payload barrage | PASS | `on()` wrapper coerces; 0 uncaught exceptions in server log |
| D1 | Out-of-turn action spam | PASS | "Not your turn", state unchanged |
| E1-E4 | Raise below min / above stack, all-in, rebuy 0/negative/huge | PASS | rejected or clamped; chips conserved. Note: raise <= min is silently promoted to min-raise (info) |
| F1-F2 | 8 players then 9th | PASS | 9th rejected with room-full error |
| G1 | Host disconnect, server hands host to next player | PASS (server) | t3.js |
| G2 | Same, in the browser lobby: new host sees Start button | FAIL (high) | br4.py, shots/host-handoff-bob.png |
| H1 | Mid-hand disconnect returns | FAIL | issue (a) |
| H2 | Late join | FAIL | issue (b) |
| I1 | Demo with 1 human + 3 bots deals | PASS | players Solo,Apollo,Blaze,Nova, 2 cards |
| I2 | Bots play several hands | PASS | pacing ~20s/hand, my 6-in-60s threshold was wrong; 3 hands in 60s |
| I3 | Demo stops when only human leaves | FAIL (med-low) | ledger grew 7 -> 10 over 25s after leave; bot-only hands continue, ledger.json grows forever |
| J1 | Turn timer auto-fold | PASS | folded after 30.0s; late action gets "Not your turn" |
| J2 | AFK player auto sit-out | FAIL (medium) | idler stays connected, not sat out; stalls 30s every hand |
| K1/K2 | Everyone-reload recovery, chips conserved | PASS | |
| L1 | Refresh mid-hand in real browser | FAIL | player returns to a blank/landing UI, cannot rejoin ("Game in progress"). shots/refresh-1-after-reload.png |
| R2 | Brief network blip in browser | FAIL | "Back online" toast shown but table stale, no seat, no actions work |
| R3 | Two tabs, same name | PASS (info) | both connect, share bank; works. shots/twin-tab1/2.png |
| R4 | Double-click Join | FAIL (high) | see bugs. shots/dblclick-join-lobby.png |
| M1 | 3-min soak, 6 scripted players: no exceptions | PASS | 25 hands, 284 actions, 191 chats, 0 uncaught exceptions (8 log lines) |
| M2 | Chips conserved | PASS | 60000 total throughout |
| M3 | Memory flat | PASS | RSS 102-106 MB over 180s; ledger.json 24,562 bytes; blinds reached 25/50 |
| N1 | Chat/sticker flood | FAIL (low) | 191 chats accepted with no throttle |

Soak error mix was all expected rejections: "Not your turn" x61, "No hand in progress" x303, "Not enough chips in bank to rebuy" x601 (busted low-bank scripted players retrying).

## Bugs, severity-ranked

1. **HIGH - Disconnect/refresh/blip = permanent lockout + stale UI after reconnect** (issues a, b, L1, R2). Repro: start a hand with 3 players, one player reloads the tab. They land on the landing page; rejoining says "Game in progress - wait for next round" for the rest of the session. Phone-sleep variant: socket reconnects, toast "Back online", but no seat and no actions. Likely to hit at least one friend tonight.
2. **HIGH - Lobby host handoff leaves nobody able to start** (G2). Repro: 3 players in lobby, host (index 0) closes tab. Server correctly reassigns host and `room_update` shows the crown on the new host, but the client decides host by `state.myIdx === 0` (game.js renderLobbyPlayers ~414), and the server `splice`s the leaver so remaining players keep stale indexes (Bob 1, Cara 2). No one gets a Start button; lobby is dead until everyone reloads. Fix idea: compute host from `hostName === myName`, or refresh myIdx on room_update.
3. **HIGH - Double-click Join creates a phantom seat** (R4, t6). `join_game` has no "this socket already seated" check, so a double-click (or impatient second tap) seats the same socket twice: double buy-in, the first matching seat gets the actions, the phantom seat times out every hand (30s stalls), and after disconnect only the first seat is cashed out so chips are stranded on the second. Repro: click Join twice quickly (shots/dblclick-join-lobby.png shows two seats).
4. **HIGH (security, needs crafted socket payload) - profilePic attribute injection**. Server accepts any string starting `data:image/` (<=150000 chars); client inserts `<img src="${p}">` unescaped (game.js avatarInner ~94-99). A payload like `data:image/x" onerror="..."` runs script in every other player's browser. The real UI only produces clean JPEG data URLs, so friends playing normally cannot trigger it; only a hostile client can. Fine for a friends test, fix before any public link.
5. **MEDIUM - AFK player stalls every hand 30s** (J2). Turn timer auto-folds correctly, but the player is never sat out, so each hand costs 30s while the idler is in turn.
6. **MEDIUM-LOW - Zombie demo rooms** (I3). Demo room keeps running bot-only hands after the human leaves and keeps appending to ledger.json (full rewrite each push). Harmless for a night, grows over days.
7. **LOW** - No chat/sticker rate limit (N1); duplicate names share one bank (A5); raise at or below minimum silently promoted (E); first `game_state` has `turnRemainingMs: null` (timer bar blank for an instant); the "wait for next round" wording is wrong because the lockout is permanent.

## Top 3 things a player could hit tonight
1. Refresh, phone sleep, or tab drop = locked out, table keeps playing without them (HIGH, bug 1).
2. Host leaves the lobby (or refreshes before start) and nobody has a Start button (HIGH, bug 2).
3. Double-tapping Join gives a phantom seat that stalls the table 30s per hand (HIGH, bug 3). AFK players cause the same stall (bug 5).

## Go / No-go
**CONDITIONAL GO** for the friends playtest on a test link. Mitigations to tell players:
- Everyone joins before the host starts; the host does not leave or refresh the lobby.
- Tap Join once and wait.
- Keep phones awake and on the page; do not refresh.
- If someone drops: everyone reloads, waits 5+ seconds, rejoins (banked chips are preserved), host restarts.
- Do not share the link publicly (bug 4).

## Files
qa/finaltest/D/: lib.js (harness), t1-t8.js (socket scripts), br_common.py + br1-br4.py (Playwright), soak.json, shots/*.png, server*.log, run*/ (per-scenario banks, ledgers and logs).
