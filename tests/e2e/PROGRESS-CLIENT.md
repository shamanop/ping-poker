# P4 client progress (branch v2-client, worktree wt-client)

## Hand-off block (restart-safe; updated each step)
- Branch v2-client in wt-client. Merged v2-core 0245430 (baa7304). Run killed once by a gateway restart at 03:37; background processes do not survive.
- Committed: A (dcbeb92 Money core), B (amount.js + tests/amountfield.test.js), C1 (lobby buy-in picker), C2 (create form), C3 (host drawer blinds), C4 (admin console). `git log` has the hashes.
- Done: A, B, C1 (buy-in picker + share-panel error persistence S2-2), C2 (create form: min/default/max/custom blinds on compact AmountInput, S3-1, S3-2), C3 (host drawer blinds, S2-8), C4 (admin console amounts). No jsdom installed: amountfield.test.js uses a hand-made DOM stub (El class in the test).
- Last proof: `node tests/money.test.js` -> 6538 passed, 0 failed; `node tests/amountfield.test.js` -> 58 passed, 0 failed.
- Open: C (wire AmountInput into buy-in picker, create form, host drawer, admin, bank, rebuy, Bender bet), D, E, then F-I after P3 (tables/PROGRESS.md in wt-tables / branch v2-tables).
- Next: C5 bank panel edit (type=number -> AmountInput), C6 rebuy amount, C7 Ballot Bender bet.
- How to run e2e: `d=$(mktemp -d); echo '{}'>$d/b.json; echo '[]'>$d/l.json; PORT=3580 BANK_FILE=$d/b.json LEDGER_FILE=$d/l.json ACCOUNTS_FILE=$d/a.json TABLES_FILE=$d/t.json WALLET_FILE=$d/w.json setsid nohup node server.js >$d/server.log 2>&1 &` then `NODE_PATH=/home/isabelle/.cache/node_modules node tests/e2e/claim.js chris by1 by2 by3 by4 by5 by6` then `python3 tests/e2e/buyin.py`. (claim.js: chris is claimed as admin, the rest are signed up.) Screenshots go to tests/e2e/_shots (not committed).
- Gotchas: stage by path only; do not commit tests/e2e/_shots; ports 3580-3599; one headless browser at a time; never push master.

## Step log
- A (dcbeb92): Money core rewrite: `Money.format(units, mode, opts)`, `Money.plain`, `Money.parse(text, mode) -> {ok, units}|{ok:false,error,hint}`, `Money.modeFor(pref, unit)`, `Money.pref`/`setPref`/`onPrefChange`. `setUnit/getUnit/getMode/getPref/fmt/setMode/onChange` deleted. Callers (game, lobby, bank, admin, shell, juice via `window.PingFmt`, bender chipsFmt) pass mode explicitly; game.js keeps `state.unit` per table.
- B: public/amount.js (AmountInput: number is truth, text is a view; stops, presets, All-in confirm, setBounds) + tests/amountfield.test.js (58 checks: stops, presets, mode toggle mid-edit, dirty+focused set(), out-of-range null+message, arrows, All-in confirm). CSS for .amt* still to write with step C.
- C1: lobby `buyInPicker` is now AmountInput (ladder). Bank unknown -> cap = table max; bank below min -> picker refuses with a message; fund row moved above the slider (ui 11); out-of-range/garbage never reaches `table_join` (S1-3). Proof: `python3 tests/e2e/buyin.py` -> 15 checks, 0 failed (usd/chips/auto typed, Max preset, 4 bad inputs send nothing, fund row above slider). Server was the CURRENT v2-core legacy server.js (P3 not merged).
- C2: create form on `AmountInput({compact:true})` (text + message only). Slider span now covers typed values; cross-field message min<=default<=max, no silent clamp; submit blocked while any field is invalid; summary no longer prints literal "null". Proof: `python3 tests/e2e/create.py` -> 23 checks, 0 failed (usd/chips/auto table_create payloads: buyIn + custom blinds in units; bad amounts send nothing).
- C3: host drawer blinds editor = two compact AmountInputs, one live editor per table, `update(t)` pushes server blinds into untouched boxes only (S2-8); "Blinds set" appears only when the server's blinds equal what was sent. Proof: `python3 tests/e2e/host_drawer.py` -> 9 checks, 0 failed (payload in units, confirm-after-server, external change flows into untouched boxes, edited box survives polls, Set after editing sb then bb sends both, garbage sends nothing).
- C4: admin.js accounts (Set chips / Set Play $) and table pane (starting stack, blinds) on compact AmountInput; the Play $ box no longer does `parseFloat * 100`. Persistent field instances: a 4 s overview refresh does not rebuild a box being used or overwrite typed-but-unsaved blinds; "Blinds set" now appears when the overview shows the new blinds, not on a 400 ms timer. Proof: `python3 tests/e2e/admin.py` -> 14 checks, 0 failed (bank_set.balance / admin_set_play.cents / table_update blinds in units for chips, usd, auto; bad amounts send nothing; typed blinds survive a refresh). `bank_set` / `reset_table` / `set_pause` are still the legacy events here: step E and I replace them (admin_adjust) once P3 is merged.

## ui/REPORT defects (1-16)
(filled as they land)

## Server features the UI would need that do not exist (for the lead)
- make host, mute (client-only is fine), chat delete, seat reserve, invite-link regenerate: no server event, left out of the seat context menu.
