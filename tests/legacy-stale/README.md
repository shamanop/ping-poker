# legacy-stale

These suites drive events or files that v2 deleted, so they cannot pass against the v2 server and are no longer part of `npm test`. They are kept as the record of what the old server did. The v2 behaviour is pinned by `tests/v2` (acceptance harness) and `tests/v2-unit`.

| file | why it is stale |
|---|---|
| `mp.js` | multi-client soak and bad-input sweep over `join_game`, `start_game`, `create_demo`, `check_balance`, host-only `start_game` rules and the legacy lobby-less room flow |
| `bankedit.js` | `bank_set` (deleted, admin money edits go through `admin_adjust` and the money service) |
| `bankfix.js` | `start_game`, `bank_set`, and bank totals read as bank + table chips from `bank.json` (the v2 mirror already folds seats in) |
| `pause.js` | `set_pause` (deleted, `table_pause` is per table) |
| `reset.js` | `reset_table` (deleted) and `set_pause` |
| `persist.js` | `start_game`, `bank_set` and `stacks.json` (seats are returned to owners at boot by `bootRecover`, there is no stacks file to persist) |

Paths inside the files were adjusted for the new directory (`../authjoin`, `../lib.js`, repo root two levels up); nothing else was edited. Moved in the P3 tables build (branch `v2-tables`), see `tables/PROGRESS.md` step 9.
