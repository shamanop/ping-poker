# PROGRESS-M
- Step 1 done: window.PingGame {enter, leave, isIn} + window.PingSocket in game.js; landing refs null-safe; identity from Lobby.user() with legacy fallback. Leave button emits table_leave when in lobby flow.
- Step 2/4 done: public/money.js + tests/money.test.js green.
- Step 3a: game.js number sites -> Money.fmt (toLocaleString=0), nice step/presets, denom scaling by bb, input parse, re-render on Money.onChange, unit from game_state/blinds_up.
