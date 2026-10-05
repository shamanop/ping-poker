# Bank panel fixes (branch pp-bankfix)

Bugs found and fixed:
1. Refresh/rejoin/redeploy booked a cash-out + buy-in pair each time (repro: drop and rejoin Bob x3 mid-hand gave 9 buy-ins / 13,420). Disconnect, shutdown and lone-player cash-outs are now tagged `park`; a later buy-in/rebuy by the same name resumes the parked amount, so only genuinely new chips count as buy-ins and no pair shows in the feed (ledger.js summary).
2. Feed and rows used mixed-case names ('chris'/'Chris'). One canonical name per case-insensitive key everywhere; colours keyed lowercase; rejoin logs the seat's name.
3. Mid-hand, chips in the pot dropped out of at-table, net P&L and totals (blinds showed as small losses). Bets in the pot now count; a shutdown mid-hand refunds the pot bets (they previously vanished).
4. Bank edits were invisible in the feed. They are now explicit `Adjusted +/-N` entries (signed `delta`; no-op edits log nothing). Choice: an adjustment shifts the baseline, never P&L: bank + at table = startBank + adjusted + net.
5. Multi-room at-table was overwritten instead of summed; top strip counted bots in "On the table".
6. Flicker: every 4s refresh rewrote all innerHTML. Now only changed sections update, scroll position kept, tooltip survives, edit box survives; edit shows the new value immediately (no flash of old one); panel re-requests on socket reconnect; edit input no longer widens the row.

Commit: see `git log pp-bankfix` (one commit on top of af378b5).

Tests (TEST_PORT=3312, 3302 was held by the wt-pause server): tests/bankfix.js 54/54, tests/bankedit.js 11/11, tests/rejoin.js 14/14, qa/bankfix/pw.py (Playwright, legacy-format ledger) 8/8. Screenshots viewed in qa/bankfix/.

Not tested: real phone/reconnect timing, server crash (SIGKILL), more than 3 humans, demo rooms, tooltip hover after refresh, 1920x1080. Legacy ledger pairs are unchanged (fix is forward-only). game.js does not re-emit join_game on socket reconnect (left alone; outside scope).

Note: my first two test runs hit the wt-pause worker's server on 3302 (joined chris/Bob, played a hand, edited Bob's bank); scratch state only.
