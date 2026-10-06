# P4 client progress (branch v2-client, worktree wt-client)

## Hand-off block (restart-safe; updated each step)
- Branch v2-client in wt-client. Merged v2-core 0245430 (baa7304). Run killed once by a gateway restart at 03:37; background processes do not survive.
- Committed: A (dcbeb92 Money core), B (amount.js + tests/amountfield.test.js), C1 (lobby buy-in picker). `git log` has the hashes.
- Done: A, B, C1 (buy-in picker + share-panel error persistence S2-2). No jsdom installed: amountfield.test.js uses a hand-made DOM stub (El class in the test).
- Last proof: `node tests/money.test.js` -> 6538 passed, 0 failed; `node tests/amountfield.test.js` -> 58 passed, 0 failed.
- Open: C (wire AmountInput into buy-in picker, create form, host drawer, admin, bank, rebuy, Bender bet), D, E, then F-I after P3 (tables/PROGRESS.md in wt-tables / branch v2-tables).
- Next: C2 create form (min/default/max/custom blinds, S3-1 "null", S3-2), host drawer blinds (S2-8), then admin, bank, rebuy, Bender bet.
- How to run e2e: `d=$(mktemp -d); echo '{}'>$d/b.json; echo '[]'>$d/l.json; PORT=3580 BANK_FILE=$d/b.json LEDGER_FILE=$d/l.json ACCOUNTS_FILE=$d/a.json TABLES_FILE=$d/t.json WALLET_FILE=$d/w.json setsid nohup node server.js >$d/server.log 2>&1 &` then `NODE_PATH=/home/isabelle/.cache/node_modules node tests/e2e/claim.js chris by1 by2 by3 by4 by5 by6` then `python3 tests/e2e/buyin.py`. (claim.js: chris is claimed as admin, the rest are signed up.) Screenshots go to tests/e2e/_shots (not committed).
- Gotchas: stage by path only; do not commit tests/e2e/_shots; ports 3580-3599; one headless browser at a time; never push master.

## Step log
- A (dcbeb92): Money core rewrite: `Money.format(units, mode, opts)`, `Money.plain`, `Money.parse(text, mode) -> {ok, units}|{ok:false,error,hint}`, `Money.modeFor(pref, unit)`, `Money.pref`/`setPref`/`onPrefChange`. `setUnit/getUnit/getMode/getPref/fmt/setMode/onChange` deleted. Callers (game, lobby, bank, admin, shell, juice via `window.PingFmt`, bender chipsFmt) pass mode explicitly; game.js keeps `state.unit` per table.
- B: public/amount.js (AmountInput: number is truth, text is a view; stops, presets, All-in confirm, setBounds) + tests/amountfield.test.js (58 checks: stops, presets, mode toggle mid-edit, dirty+focused set(), out-of-range null+message, arrows, All-in confirm). CSS for .amt* still to write with step C.
- C1: lobby `buyInPicker` is now AmountInput (ladder). Bank unknown -> cap = table max; bank below min -> picker refuses with a message; fund row moved above the slider (ui 11); out-of-range/garbage never reaches `table_join` (S1-3). Proof: `python3 tests/e2e/buyin.py` -> 15 checks, 0 failed (usd/chips/auto typed, Max preset, 4 bad inputs send nothing, fund row above slider). Server was the CURRENT v2-core legacy server.js (P3 not merged).

## ui/REPORT defects (1-16)
(filled as they land)

## Server features the UI would need that do not exist (for the lead)
- make host, mute (client-only is fine), chat delete, seat reserve, invite-link regenerate: no server event, left out of the seat context menu.
