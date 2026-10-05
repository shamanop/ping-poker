# PROGRESS-M
- Step 1 done: window.PingGame {enter, leave, isIn} + window.PingSocket in game.js; landing refs null-safe; identity from Lobby.user() with legacy fallback. Leave button emits table_leave when in lobby flow.
- Step 2/4 done: public/money.js + tests/money.test.js green.
- Step 3a: game.js number sites -> Money.fmt (toLocaleString=0), nice step/presets, denom scaling by bb, input parse, re-render on Money.onChange, unit from game_state/blinds_up.
- Step 3b: bank.js fmt/signed/short -> Money, editable total parses dollars, toggle auto-mounts into [data-money-toggle] (money.js), css block in bank.css. Committed.
- Step 5: visual ok at 1440x900 (qa/overnight/m-1440.png); layout unchanged vs u-1440; legacy room currently arrives with unit=cents from server so shows $ (toggle works). Tests: money, preselect, clientlabels green.
