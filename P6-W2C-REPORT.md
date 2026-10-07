# P6 W2-c + W2-d report: COLD CALL on the one money system

Builder `p6-w2c-slot-port`, branch `p6-w2c` (worktree `wt-w2c`), from `d60274c` (= `v2-all`). Slot merged by path from `/home/frank/.openclaw/workspace/projects/ping-coldcall-pull`: first `4713970`, then the addendum's docs-only update (the fetch gave `b9ab3a5`, a descendant of `4713970` and of `782e974`: 3 critic reports + 6 lines of `cold-call/PULL-STATE.md`, no code; `git diff --stat 4713970 b9ab3a5 -- games public tests server.js` is empty). Nothing pushed, `master` untouched, no PR. Engine files untouched; `money/**`, `transport/game-money.js` and `tests/soak/**` not touched.

## What changed (files)

| File | Change |
|---|---|
| `games/coldcall.js` | The port: no `wallet`; one `ctx.money` call per movement; flows, round ids, pot on `pool:coldcall:office`, `recover()`, `audit()`. |
| `games/coldcall-store.js` | `flush()` throws when the write failed (a failed debounced write retries); pot = mirror (`bal`) + statistics (`fed`, `paid`) + `rem` + `last`; no `seeded`; `peekPot`; `close(true)` abandons unwritten data (a test's crash). |
| `games/coldcall-livecfg.js` | `encodeCfg` / `decodeCfg` / `restoreSnapshot` (the whole config of an open round survives JSON, Infinity and NaN included); `setFile` (the path server.js hands the game; `COLDCALL_CFG_FILE` still wins). |
| `transport/boot.js`, `server.js` | `COLDCALL_PULL_FILE` / `COLDCALL_CFG_FILE` resolved next to `money.jsonl` (same `near()` rule), handed to the games registry as `ctx.files`. Merge of the slot's `coldcall-config` admin block next to the bender block, byte-length token compare for both. |
| `public/shell.js`, `.gitignore`, `games/index.js` | Merge only: v2's shell plus the slot's Cold Call bridge (`onPrefChange` repaint); `_scratch/` ignored; `MODULES` has both games. |
| `tests/lib-coldcall-ledger.js` | New helper (see below). |
| `tests/coldcall.js`, `coldcall-livecfg.js`, `coldcall-pull-server.js` | Moved onto the helper. `tests/coldcall.js` also chains the new file. |
| `tests/coldcall-money.js` | New: 18 tests. |
| `ADD-A-GAME.md`, `cold-call/PULL-STATE.md` | Status paragraph; new last section "P6: money on the ledger". Contract rules unchanged. |

## The 16 audit findings (`P6-MONEY-AUDIT-COLDCALL.md` section 8)

| # | Finding | Status |
|---|---|---|
| 1 | Open round: stake in wallet, record in the slot file, flushed one after the other; crash between = stake kept | **Closed** by `money.open` (the stake IS the escrow) then record flush. A crash between leaves an escrow with no record: boot voids it. Tests `CRASH 1`, `FILE corrupt`. |
| 2 | Settle drops the record and flushes state before the win credit | **Closed**: one `money.settle` first, state + record drop in one write after. `CRASH 3` (both the `dup` and the `round_closed` answer). |
| 3 | Pot prize recorded in the pot file before the prize credit | **Closed**: feed and prize are legs of the SAME batch as the stake and the win. `F9d (D4)` rewritten as a one-batch test; `POT fuzz`. |
| 4 | Restart refund / `voidRound` delete the record first, credit second | **Closed**: `money.void` first, then the record is dropped and flushed; boot settles via `recover` (D1). `F4`, `W1B N4`, `CRASH 2`. |
| 5 | Corrupt `coldcall-pull.json` empties every state, the pot AND the open record | **Closed for money, open on purpose for game state (D3).** The pot is a ledger balance, an open stake is an escrow the registry sweep returns; the leads and Callbacks in the file are still lost. `FILE: corrupt game file`. |
| 6 | The pot is a number in a file; `fed + seeded = paid + bal` never checked | **Closed**: `pool:coldcall:office`; the file holds a mirror that `audit()` reports and the soak compares; set from the ledger after every settle and after `recover`. `POT` tests assert mirror = ledger. |
| 7 | Unpaid win of an open round only a replayable tape in memory; restart gave back the cost, not the shown bank | **Closed (decision D1)**: the tape is in the record on disk; a restart settles as the timeout would and pays the shown amount. `restart (D1)`, `DENOMS restart`, `item 3b`. |
| 8 | Leads, `avg`, `carry`, `cb`, `warm` stored only in the file, worth cents but never a balance | **Open on purpose (D3)**: game state, never money; a crash can cost the entitlements granted by the one round in flight, never a balance. The Callback's id keeps it from being paid twice (RULE 2). |
| 9 | Immediate rounds write wallet and state/pot through two debounced writers | **Closed for money** (one batch, the ledger is the truth); the state may lag one round behind (D3). The Callback replay is closed by `cb.id` + record-first (RULE 2 tests). |
| 10 | Win and prize two credits; a throw swallowed | **Closed**: one batch; a money error is never caught and carried on (`THROW`). |
| 11 | Top-up and admin set SET the balance (no ref, no ledger row) | **Closed by v2 itself** (`service.topUp`, `adminAdjust`: signed deltas with refs). |
| 12 | wallet stats count refunds and prizes as won; Callback rounds never raise `rounds` | **Closed by v2 itself**: no wallet stats; the facts are ledger lines (`house:coldcall`). The stats assertions were rewritten (list below). |
| 13 | No idempotency; ids random and unchecked; a resent spin is a new round | **Closed for the money**: every call has a ref, a repeat answers `dup` / `round_closed`, a Callback's id comes from the entitlement. **Open on purpose**: a resent `spin` message is still a new round (150 ms rate limit and `decision_open` guard, as before); ids stay 48-bit random, the ledger refuses a reused one. |
| 14 | Debounced writers swallow write errors | **Closed**: `store.flush()` throws and the flows depend on it (record flush failure = void or "nothing played"); a failed debounced write keeps the data dirty and retries every second. `FILE: a store write that fails`. |
| 15 | Chips split from the wallet; ledger rows only for Chips | **Closed by v2 itself**: both currencies in one ledger, every round has lines. |
| 16 | Live config (prices, pot cap, feed rate) outside any balance; moves house exposure at once | **Open on purpose**: config is not money; the admin API is token-gated and validated (D1 / D2 caps). An open round keeps its own snapshot, now pinned by T1. |

## Suites I ran (this worktree, last commit before this report)

| Suite | Result |
|---|---|
| `node tests/coldcall.js` (47 itself; it chains the next five) | 47 passed |
| `coldcall-pull-engine.js` | 57 passed (not touched) |
| `coldcall-pull-server.js` | 61 passed |
| `coldcall-livecfg.js` | 28 passed (27 + T2) |
| `coldcall-presets.js` | 20 passed (not touched) |
| `coldcall-money.js` (new) | 18 passed |
| `node tests/bender.js` / `bender-livecfg.js` | 19 passed / 5 passed |
| `node tests/v2-unit/run-money.js` | 120/120 |
| `node tests/v2-unit/run-tables.js` | 151/151 |
| `node tests/v2-unit/run-engine.js` | 96 passed (seed 1) |
| `node tests/v2/run.js --jobs 1` | 156 of 156, 0 fail (492 s); result file kept at `_scratch/p6/w2c/v2-results-wt-w2c.json`, not in the tree |

The slot's old server suites were red between the merge commit and the port, as expected; the three of them are green on the ledger helper now.

Engine proof (`git diff --stat 4713970 HEAD -- games/coldcall-engine.js public/games/coldcall/engine.js` and `cmp`): both silent: the `git diff --stat` is empty and `cmp games/coldcall-engine.js public/games/coldcall/engine.js` prints nothing. `git diff --stat d60274c HEAD -- money transport/game-money.js tests/soak` is empty too.

Real boot: `node server.js` with a temp `BANK_FILE` logs `game recovery: bender 0 open/0 by game/0 kept, coldcall 0 open/0 by game/0 kept, 0 escrows voided` before listening.

## Tests deleted, or whose meaning changed (nothing deleted)

`tests/coldcall.js`
- `wallet: new account starts at 10,000.00 ...` -> `ledger: a new account starts ...` (same facts, read from the ledger and `ctx.money.balance`).
- `wallet: spend/credit math + per-game stats` -> `ctx.money: one round = one batch ...`. Changed: the wallet.js stats `{rounds, wagered, won}` are ledger facts now (lines per ref, `house:coldcall`).
- `wallet: float, negative, NaN, ... rejected` -> `ctx.money: ...`. Dropped: `null` / `undefined` amounts (ctx.money takes an outcome object, a missing amount is 0); added the bad-mode check on `round`.
- `wallet: insufficient funds are exact ...` -> `ctx.money: ...` (same, through `round`).
- `settlement, Play $ and Chips ...`: `wallet.stats` reconciliation became `house + pool = what the player lost` and one ledger ref per round. `QA hook ... normal spend/credit path`: same stats change. Titles of two tests say "ledger" instead of "wallet".

`tests/coldcall-livecfg.js`
- `item 3b: swap, then restart while a decision is open: refunded once` -> `item 3b (D1)`: the restart settles once as its timeout would, on the config the round started on; a second restart writes no ledger line (decision D1).
- `the file location ...` gained the `setFile` precedence (server path beats `DATA_DIR`, env beats both).
- `item 4: pot, feed ...`: `fed + seeded = paid + bal` -> `fed = paid + bal`, mirror = ledger pool, pool = feeds - prizes from the ledger lines.
- `admin API`: starts the v2 server through `start(env)` instead of the old exported `server`; also asserts the state file sits next to `money.jsonl`.
- New: `snapshot memo (T2)`.

`tests/coldcall-pull-server.js` (61 tests, all kept)
- `settlement, Play $ and Chips ...` and `DENOMS settlement to the cent ...`: wallet stats -> ledger facts; the pot's invariant is checked against the ledger pool too.
- `restart: an open decision is voided at init, refunded once` and `restart: the same for Chips` -> `restart (D1)`: settled once as the timeout would, from the ledger escrow, a second restart writes nothing.
- `DENOMS restart ...` -> D1; the stored record now holds `rtape` (was `rnd`) plus tape, config, state, decisions; an old-format record is dropped and pays nothing (it used to be refunded 7: its stake was in the old wallet, not in an escrow).
- `pot: seed (tracked house money) ...` -> `pot (D2)`: a seed in the knobs is ignored and logged, never minted; no seed is put back after a hit.
- `F9d: a pot prize is flushed to disk before it is credited` -> `F9d (D4)`: stake, feed, prize and win are legs of ONE batch, written before any result goes out (decision D4).
- Seven tests that edited the pot's `bal` / `fed` by hand now fund the pool through the ledger (`seedPool`). Test title `store: file next to the wallet` -> `next to money.jsonl`.

## New tests, `tests/coldcall-money.js` (18) and the two pins

`RULE 1` (every buy kind and a Callback x 1c / $1 / $25 x both currencies, roll forced to hit on a funded pool: no pool leg in the ledger batch, pool unchanged, `potRng` not drawn; a plain spin on the same setup feeds and wins). `RULE 2` x4 (a Callback paying 0 and paying W, crash before the money call and after it: the module rng is not drawn at boot, the Callback is consumed, paid exactly once). `RULE 2` record and state lost but the ledger paid (`round_closed` or `dup`, nothing paid again). `RULE 2` Callback id on the entitlement (written on arm, flushed, stripped from client views, an old state gets an id before it is played). `CRASH 1` / `2` / `3` (take and bank): kill after `open` before the record flush; after the record flush; after `settle` before the state flush; each then checks every escrow is 0, `audit()` = ledger, a second boot writes no line. `THROW` (`funds` on `round` and on `open`, `internal` on `settle`: never a result, the round stays open and finishes as a timeout). `FILE` x2 (a failed store write; a corrupt game file loses state never money). `POT` fuzz (500 spins x 2 currencies on random pools and knobs: the pool is never asked for more than it holds) and `POT` conservation (spins, buys, Callbacks, decisions, timeouts, disconnects and voids, both currencies, after every step). `NO WALLET` (source grep and a probe ctx). `SNAPSHOT (T1)` and, in `coldcall-livecfg.js`, `snapshot memo (T2)` (addendum B).

Mutations I ran by hand on scratch copies, then restored (`git diff` on `games/` clean afterwards):
- `const plain = cost > 0 && !rec.buy` -> `cost > 0`: 1 test fails (`RULE 1`).
- `recover` replays from an empty tape: 5 fail (the four `RULE 2` crash cases, `CRASH 2`).
- T1 `SNAP` (from `mutate.py`): the feed `cfg.pot.feedBps` -> `pullCfg().pot.feedBps`: `SNAPSHOT (T1)` fails. The roll change (`potHitChance(cfg, ..)` etc. -> `pullCfg()`): `SNAPSHOT (T1)` fails.
- T2 `D6 memo key blind` (`JSON.stringify(Eng.CFG)` without `keyOf`): `snapshot memo (T2)` fails.

## Anything in `money/**` I think is wrong

Nothing blocking. Two notes, no patch made: (1) a free round that pays 0 stays invisible to `closed()` (the written F2.4 limit): the slot closes it itself (record-first + `cb` id); a second game with free rounds will have to do the same. (2) `settle` on a free round with `stake: 0` and `win: 0` answers `noop`, so `recover` cannot tell "played" from "not played" for a 0 Callback; harmless here because the replay of the same tape pays 0 again.

## What I did not do

- No `tests/soak/actors/coldcall.js` and no `node tests/soak/prove.js` run (ADD-A-GAME section 8 asks for both; `tests/soak/**` was out of scope).
- No client (`public/games/coldcall`) change. The client now sees one more error code (`round_closed`, shown through its generic error path) and `g:coldcall:voided` with `refund` equal to the round's cost for a round voided before any money moved (an instant round whose settle threw: nothing was charged, the payload shape is kept).
- `LEAD-ADDENDUM-READ-ME.md` in the worktree root is the lead's file, untracked, not committed.
- The Callback armed by a round that crashes before the state flush is lost (D3); not fixed on purpose.

## For the lead to decide

1. A decision made on the LAST step of a round (the one that settles it) is not in the stored record (the record is rewritten on a decision that keeps the round pending, not on the final one). A crash right after the money call replays the default for it: `round_closed`, nothing paid again, the state advances from the default. Accepted under D3; the alternative is one more flush of the record before the money call.
2. An unrecoverable `stake_mismatch` at boot is voided (refund of whatever the escrow holds); a live `stake_mismatch` just retries each timeout. Say if you want the live path to void too.
3. The soak actor for COLD CALL (section 8) is the missing gate before this ships.
