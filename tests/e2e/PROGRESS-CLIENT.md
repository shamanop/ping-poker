# P4 client progress (branch v2-client, worktree wt-client)

## Hand-off block (restart-safe; updated each step)
- Branch v2-client in wt-client. Merged v2-core 0245430 (baa7304). Run killed once by a gateway restart at 03:37; background processes do not survive.
- Committed: A (dcbeb92 Money core), B (amount.js + tests/amountfield.test.js, see `git log`).
- Done: A, B. No jsdom installed: amountfield.test.js uses a hand-made DOM stub (El class in the test).
- Last proof: `node tests/money.test.js` -> 6538 passed, 0 failed; `node tests/amountfield.test.js` -> 58 passed, 0 failed.
- Open: C (wire AmountInput into buy-in picker, create form, host drawer, admin, bank, rebuy, Bender bet), D, E, then F-I after P3 (tables/PROGRESS.md in wt-tables / branch v2-tables).
- Next: C, buy-in picker in public/lobby.js first, then a Playwright proof against a throwaway server on port 3580.
- Gotchas: amount.js CSS (.amt*) is not written yet; stage by path only; ports 3580-3599; one headless browser at a time; never push master.

## Step log
- A (dcbeb92): Money core rewrite: `Money.format(units, mode, opts)`, `Money.plain`, `Money.parse(text, mode) -> {ok, units}|{ok:false,error,hint}`, `Money.modeFor(pref, unit)`, `Money.pref`/`setPref`/`onPrefChange`. `setUnit/getUnit/getMode/getPref/fmt/setMode/onChange` deleted. Callers (game, lobby, bank, admin, shell, juice via `window.PingFmt`, bender chipsFmt) pass mode explicitly; game.js keeps `state.unit` per table.
- B: public/amount.js (AmountInput: number is truth, text is a view; stops, presets, All-in confirm, setBounds) + tests/amountfield.test.js (58 checks: stops, presets, mode toggle mid-edit, dirty+focused set(), out-of-range null+message, arrows, All-in confirm). CSS for .amt* still to write with step C.

## ui/REPORT defects (1-16)
(filled as they land)

## Server features the UI would need that do not exist (for the lead)
- make host, mute (client-only is fine), chat delete, seat reserve, invite-link regenerate: no server event, left out of the seat context menu.
