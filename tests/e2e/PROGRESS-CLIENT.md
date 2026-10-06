# P4 client progress (branch v2-client, worktree wt-client)

## Hand-off block
- Committed: see `git log` (updated each step).
- Steps: A in progress.
- Proof: `node tests/money.test.js`
- P3 payload (legalActions): NOT merged yet at start; F-I wiring waits (check tables/PROGRESS.md in wt-tables / branch v2-tables).

## Step log
- A: Money core rewrite: `Money.format(units, mode, opts)`, `Money.plain`, `Money.parse(text, mode) -> {ok, units}|{ok:false,error,hint}`, `Money.modeFor(pref, unit)`, `Money.pref`/`setPref`/`onPrefChange`. `setUnit/getUnit/getMode/getPref/fmt/setMode/onChange` deleted. Callers (game, lobby, bank, admin, shell, juice via `window.PingFmt`, bender chipsFmt) pass mode explicitly; game.js keeps `state.unit` per table.

## ui/REPORT defects (1-16)
(filled as they land)

## Server features the UI would need that do not exist (for the lead)
- make host, mute (client-only is fine), chat delete, seat reserve, invite-link regenerate: no server event, left out of the seat context menu.
