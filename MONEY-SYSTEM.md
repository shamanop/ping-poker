# MONEY-SYSTEM.md: how money works in The Ping

Written for the head `69a44f6` of `money-hardening` (2026-10-08). Every sentence was checked in the code at that head; `file:line` points at it. If the code moved, the code wins, and this file is wrong: fix the file.
Companions: `ADD-A-GAME.md` (plug a game in), `RUNBOOK.md` (operate it), `MONEY-FINDINGS-1008.md` (what the 2026-10-08 hardening found).

## 1. The one rule

**Cash is real money. Chips are free play. They never mix.**

- Cash is the ledger currency `play`, counted in cents. The label was renamed "Play $" to "Cash"; the ledger key is still `play`. Chips are the currency `chips`, counted in whole chips.
- Only an admin puts Cash into a wallet (`admin/index.js:43` `setPlay`, `admin/index.js:23` `adjust`). The only other way Cash reaches a player is a win paid by a game house (`house:bender`, `house:coldcall`, `house:campaign`) or by a game pool fed by Cash stakes (Cold Call office pot), against a Cash stake of the same player. A new account has 0 Cash (`server.js:28` passes `signupPlay: 0`; `money/service.js:145`). There is no top up (`money/service.js:437` `topUp` always throws `disabled`; `games/index.js:48` answers `topup_off`).
- Chips come from signup (10,000), the daily bonus and the games. Achievements pay nothing (`social.js:14` `TIER_REWARD` is 0 for every tier; a 0 credit writes no line, `transport/wallet-adapter.js:72`).
- A table, a seat and a game round use one currency from start to end. A seat is bought in its table's own currency only (`tables/money-port.js:41`, `sameFundOnly: true` at `server.js:58`, answer `wrong_fund`). Nothing converts Cash to Chips or back.

## 2. Parts

```
 client (public/shell.js)  <--  money / wallet events  <--  transport/views.js, transport/index.js
        |
 socket handlers (transport/handlers/*, admin/index.js, games/*)
        |                     |                         |
 tables/money-port.js   transport/game-money.js    transport/wallet-adapter.js
 (poker tables)         (ctx.money, per game)      (ctx.wallet: Bender legacy path, daily bonus, achievements)
        \                     |                         /
                    money/service.js     (named operations, every one = ONE ledger write)
                              |
                    money/ledger.js      (append-only money.jsonl)
```

| Part | File | What it does |
|---|---|---|
| Ledger | `money/ledger.js` | One append-only file of transfers, `money.jsonl`. `transfer()` (`:544`) writes one line, `batch()` (`:554`) writes several legs as ONE line (all or nothing). Memory changes only after the line is on disk (`write`, `:535`). A `ref` string on every line makes a retry harmless (`refCheck`, `:523`): same ref and same content = `dup`, no write; same ref and other content = `ref_conflict`. Player accounts cannot go below 0 (`validateItems`, `:109`); source accounts can. Fsync on every write (`fsync: 'all'`, `server.js:21`). |
| Source accounts | `money/ledger.js:28` `SOURCE_ACCOUNTS` | The only accounts that may go negative: `mint:signup`, `mint:bonus`, `mint:achv`, `mint:topup`, `mint:migration`, `house:bender`, `house:coldcall`, `house:campaign`, `admin:adjust`, `fx:chips`, `fx:play`. Every other name must match a shape in `PLAYER_KINDS` (`:27`) or the line is refused (`bad_account`). |
| The fence | `money/ledger.js:497` `fence()` | One writer only. The newest opener writes a token to `money.jsonl.lock` (`:280-283`). Before every append the ledger re-reads the lock and the file size. A lost lock throws `lost_lock`; a file size that is not what this process wrote throws `foreign_write`; both are refused for good until the process restarts (`refused`). A failed write throws `write_failed` after truncating the file back to the last good size (`:504-516`); that one is not sticky. |
| Quarantine | `money/ledger.js:446-485` | At open, a line that does not parse or does not validate is NOT applied. It is copied (once) to `money.jsonl.quarantine` and logged `QUARANTINED n line(s)`; the journal is never rewritten. A torn last line (no newline) is truncated. `ledger.check()` (`:720`) reports the count separately. |
| Checkpoint | `money/ledger.js:732` `checkpoint()` | `money.jsonl.ckpt` is a verified shortcut for boot. It is believed only if the journal bytes it covers hash to its sha256 and the code that wrote it is the same code (`RULES_ID`, `:74-83`: any edit to `money/ledger.js`, including a new source account, forces one full replay on the next boot). Never the truth; the journal is. |
| Service | `money/service.js` | Named operations on top of the ledger (`createService`). Table half: `buyIn`, `cashOut`, `settleHand`, `bootRecover`, `seatFund`, `nightSummary`. Game half: `houseRound`, `openRound`, `settleRound`, `voidRound`, `openRounds`, `roundClosed`, `poolBalance`, `sweepEscrows`. Shared: `ensureAccount`, `mint`, `adminAdjust`, `balances`, `mirror`. The game ids it knows are in `GAMES` (`:13`). |
| Table port | `tables/money-port.js` | The ONLY place a table money `ref` is built and the only caller of the service for tables. Turns a fence into `TableError('money_down')` plus `onFence` (`server.js` pauses all tables). |
| Game money | `transport/game-money.js` | `ctx.money` for game modules. `forGame(gameId)` binds the calls to one game id; no call takes a game id, so a module cannot name another game's accounts. Calls: `balance`, `round`, `open`, `settle`, `void`, `openRounds`, `closed`, `pool`. |
| Wallet adapter | `transport/wallet-adapter.js` | `ctx.wallet`: `get`, `spend` + `credit` (spend only parks the cost in memory, credit writes ONE `houseRound` batch; a parked cost with no credit is flushed as a loss at the end of the tick, `:44`), and the mints for the daily bonus (`game 'bonus'`) and achievements (`'achv'`). At this head Ballot Bender still reads its balances through it; Cold Call and Campaign do not use it. |
| Views | `transport/views.js` | What a client is told: the `wallet` event (`walletView`, `:20`) and the `money` event (`moneyView`, `:23`). Pure reads. |
| Mirror | `transport/boot.js:93` `startMirror` | Write-only `bank.json` and `wallet.json`, rewritten (temp + rename) when the ledger moved, so an old build can be rolled back to. Nothing reads them at run time. |

Boot order (`server.js:14-80`): resolve paths, open the ledger, load accounts, migrate old stores if needed, create the service, `ensureAccount` for every account, `service.bootRecover` (seats back to their owners), start the mirror, build ports and registry, build the games, `games.recover()` (open game rounds settled or voided), `ledger.checkpoint()`, load tables, listen.

## 3. Account types

Names are `kind:part:part`. A part has no `:` and is not empty (`money/ledger.js:37-46`). `key` is the lowercase player key.

| Account | Holds | May go negative? | Written by |
|---|---|---|---|
| `bank:<key>` | a player's Chips (the "bank") | no; Chips only | signup mint, bonus mint, buy-in / cash-out, games, admin Chips adjust |
| `play:<key>` | a player's Cash wallet, cents | no; Cash only | admin set / adjust, cash-out from a Cash seat, game wins |
| `seat:<tableId>:<key>` | stack plus this hand's committed chips of a seated player, in the table's currency | no | buy-in, rebuy, cash-out, hand batch, boot recovery |
| `pot:<tableId>:<handNo>` | the chips of one hand while it settles | no | the hand batch only; must be 0 after it |
| `escrow:<game>:<key>:<roundId>` | the stake of one open game round | no | `openRound`, `settleRound`, `voidRound` |
| `pool:<game>:<name>` | a game's shared pot (Cold Call `office`) | no | pool feed and prize legs inside a game round |
| `orphan:<name>` | old name-keyed balances the migration could not assign to an account (free text after the prefix) | no | `tools/migrate-v2.js` only; for the owner to assign |
| `mint:signup`, `mint:bonus`, `mint:achv`, `mint:topup`, `mint:migration` | the other side of every creation of Chips (and, only in old fixtures, Cash) | yes | `ensureAccount`, `mint`, migration |
| `house:bender`, `house:coldcall`, `house:campaign` | the house side of a game; negative = the players are ahead | yes, no floor | game rounds |
| `admin:adjust` | the other side of an admin edit | yes | `adminAdjust` |
| `fx:chips`, `fx:play` | the middle of a cross-currency buy-in (`ONLY_CUR`: each is one currency) | yes | `moveIn` / `moveOut` with a fund other than the table's currency; unreachable live because of `sameFundOnly` |

`mint:topup` is still in `SOURCE_ACCOUNTS`, and `mint:signup` can still mint Cash in an old test fixture: `createService` defaults `signupPlay` to 10,000.00 (`money/service.js:38`) unless the caller passes 0. `server.js:28` passes 0 unless the env var `SIGNUP_PLAY_CENTS` is set, which is honoured also in production (finding SVC-1, open: see `MONEY-FINDINGS-1008.md`).

Per currency, all accounts sum to 0 at all times (`ledger.check()`, `money/ledger.js:720`).

## 4. Ledger lines

One line of `money.jsonl`:

```
single: {"id":412,"ts":1791...,"from":"play:ann","to":"house:coldcall","amount":500,"cur":"play","reason":"coldcall:spend","ref":"coldcall:ann:9f3a..."}
batch : {"id":413,"ts":...,"batch":[{"from":..,"to":..,"amount":..,"cur":..,"reason":..},...],"ref":"hand:POKERPING:57","reason":"hand"}
```

`id` rises by 1 per applied line (a gap is allowed in an old file). `ref` is unique in the file. Amounts are positive safe integers. The ledger accepts legs of both currencies in one batch (that was the `fx:` path); nothing live writes one and soak I10 flags it.

### Refs and reasons written today

| Event | ref | reason | Written by |
|---|---|---|---|
| signup | `signup:bank:<key>`, `signup:play:<key>` (Cash only if `signupPlay` > 0) | `signup` | `service.ensureAccount` (`:138`) |
| daily bonus | `bonus:<key>:<YYYY-MM-DD>` | `bonus` | `social.js:268` via the wallet adapter |
| achievement | `achv:<key>:<achievementId>` | `achv` (never written, reward is 0) | `social.js:147` |
| admin edit | `adj:<key>:c.<opId>` | `admin:<reason>`; Set Cash writes `admin:admin set play to <cents>` | `admin/index.js:23`, `service.adminAdjust` (`:403`) |
| buy-in, rebuy | `buyin:<tableId>:<key>:<boot>.<n>`, `rebuy:...` | `buyin:<fund>` | `tables/money-port.js` `buyIn` |
| cash-out | `<kind>:<tableId>:<key>:<boot>.<n>`, kind = `leave`, `kick`, `sweep`, `grace`, `night` | `<kind>:<fund>` | `money-port.js` `cashOut` |
| a hand | `hand:<tableId>:<handNo>` | `hand` | `service.settleHand` (`:177`) |
| boot return of a seat | `boot:<bootId>:seat:<tableId>:<key>` | `boot:<fund>` | `service.bootRecover` (`:453`) |
| boot return of a stray pot | `boot:<bootId>:pot:<tableId>:<handNo>` | `boot:pot` | same |
| instant game round | `<game>:<key>:<roundId>` | `<game>:round` | `service.houseRound` (`:271`) |
| round stake in | `<game>:<key>:<roundId>:open` | `<game>:open` | `service.openRound` (`:287`) |
| round closed | `<game>:<key>:<roundId>:close` | `<game>:settle` or `<game>:void:<why>` | `settleRound` (`:323`), `voidRound` / `voidAccount` (`:352`) |
| migration | `mig:...` | `migration` | `tools/migrate-v2.js` |

Leg reasons inside a game batch: `<game>:spend` (stake to the house), `<game>:feed` (house to pool), `<game>:prize` (pool to player), `<game>:credit` (house to player).
`:open` and `:close` are reserved suffixes: `houseRound`, `houseSpend` and `houseCredit` refuse a ref that ends in either (`money/service.js:26`, `needHouseRef`).

## 5. Flows

Each flow lists its ledger lines in order. "Restart" says what the next boot does (the D1 rule: a restart is an automatic settle or refund, never a silent loss).

### 5.1 Signup
1. `ensureAccount(key)` runs on every successful sign-in, signup included (`transport/handlers/auth.js:11`) and for every account at boot (`server.js:29`).
2. Line `signup:bank:<key>`: `mint:signup` to `bank:<key>`, 10,000 Chips. No Cash line (`signupPlay` is 0, `service.js:144`).
3. Safe to repeat: only a currency with no `bank:` / `play:` account yet is minted.
Restart: nothing to recover.

### 5.2 Admin sets or adjusts
1. The client message carries an op id, one per confirmed click (`transport/handlers/admin.js`, `admin_set_play`, `admin_adjust`). No op id = refused `op_required`, nothing written (`admin/index.js:15-21`).
2. `adjust`: one line `adj:<key>:c.<opId>`, `admin:adjust` to the player (delta > 0) or the player to `admin:adjust` (delta < 0). A resend of the same op id answers `dup`; the same op id with other numbers is `ref_conflict`.
3. Set Cash: the player's TOTAL Cash becomes X. Total = wallet + Cash at seats + Cash in open rounds (`cashOf`, `admin/index.js:34`). If X is below the part at a seat or in a round the answer is `cash_in_play` and nothing is written (`:52-53`). Otherwise one adjust line moves the wallet by `X - atTable - inRound - wallet`. X is at most 100,000,000,000 cents (`:4`).
Restart: nothing open.

### 5.3 Daily bonus
1. `bonus:claim` reads `bonusInfo` (`social.js`); the amount is `BONUS_DAYS[day-1]` Chips (`social.js:5`: 10,000 / 12,500 / 15,000 / 20,000 / 25,000 / 35,000 / 100,000).
2. One line `bonus:<key>:<day>`: `mint:bonus` to `bank:<key>`, Chips only (`social.js:268`). The account record is written after it. The ledger line is the truth for "claimed today": a mint with no record is mended on the next read (`social.js:244-253`).
Restart: nothing open.

### 5.4 Achievements
No money. The reward is 0 for every tier; `credit` with 0 returns without a line.

### 5.5 Poker: buy-in, rebuy
1. `sit` / `rebuy` check the range, the rebuy cap and the fund, then call `money.buyIn` first, then change memory (`tables/table.js:198-250`).
2. One line `buyin:...` (or `rebuy:...`): `bank:<key>` to `seat:<tableId>:<key>` for a Chips table, `play:<key>` to the seat for a Cash table. The player's own currency only: any other fund is `wrong_fund`.
3. A seat keeps one fund while it holds chips (`fund_mismatch`, `service.js:109`).
Restart: see 5.9.

### 5.6 Poker: a hand
1. The engine tracks blinds, bets, side pots and the odd chip in memory (`engine/hand.js`, `engine/pots.js`). The ledger sees nothing until the hand ends.
2. At showdown or when all but one fold, `settle()` (`tables/hand-flow.js:275`) calls `money.settleHand` with three maps per seat key: `committed`, `payouts`, `returned` (an uncalled bet).
3. ONE batch `hand:<tableId>:<handNo>` (`service.settleHand`, `:177`): each seat's committed chips go `seat -> pot`, then each seat's payouts plus returned chips go `pot -> seat`. `committed` must equal `payouts + returned`, or `not_conserved` is thrown before anything is written. The pot is 0 afterwards. The hand number never repeats after a restart (highest `hand:<id>:<n>` ref, `lastHandNo`).
4. If the batch is refused the hand is voided: the table returns to the stacks it had at the start of the hand (`hand-flow.js` `void`, three voids in 60 s pause the table). The batch is the commit point.
Restart (`tests/v2/07_restart_midhand.js`, `17_restart_settle.js`): a hand that never wrote its batch never happened. Boot recovery returns every seat's money to its owner at the stacks the ledger holds. Chips that were committed but not yet settled are still in the seat account (see below), so they go back too.

### 5.7 Poker: leave, kick, disconnect, end of night
- **Leave** with no hand live for the seat: `cashOut` of the whole seat balance, kind `leave`, then the seat is removed (`table.js:268`).
- **Leave in a live hand**: only the part not committed to the hand is cashed out (`leaveAmount`); committed chips stay in the seat account until the hand batch moves them. The leaver folds if a decision is still ahead of him; an all-in seat or a run-out stays in and is paid what it wins (`hand-flow.js` `leaveInHand`). After the batch the seat is swept (kind `sweep`).
- **Kick** (host or admin): a kick never changes a live hand. A seat still in the hand is marked `kickPending`, keeps its seat, stack, turn and clock, and is cashed out (kind `kick`) and removed after the hand settles or is voided (`table.js:286`, `hand-flow.js` `finishKick`).
- **Disconnect**: no money moves. After the grace time with no hand live the seat is cashed out (kind `grace`) and the amount is remembered as `reentry` so coming back is not counted as a rebuy (`table.js:90`, `noteServerReturn`).
- **End of night** (`hand-flow.js` `finishNight`): every seat cashed out, kind `night`. Pending while a hand is live.
Each cash-out is one transfer `seat -> bank:` or `seat -> play:` of the stack. Amount 0 writes nothing.

### 5.8 Instant game round (Ballot Bender spin, Cold Call spin with no decision, Campaign: not used)
1. The game decides cost and win in memory (nothing is spent yet), checks funds, then calls `ctx.money.round(key, cur, roundId, { cost, win, pool? })`.
2. ONE batch `<game>:<key>:<roundId>`: `player -> house:<game>` (cost), then pool legs (`feed`: house to pool, `prize`: pool to player), then `house:<game> -> player` (win). A crash can never take a stake and lose the win.
3. The same call again is `dup`; the same round id with other numbers is `round_closed` ("already played").
Restart: nothing open; the round is whole or absent.

### 5.9 Escrowed round with a held feature (Cold Call decisions, Callback, bonus buy; the pot)
1. A Cold Call spin whose result needs a player decision (a pending feature) opens the round: `ctx.money.open(key, cur, roundId, cost)` writes `<game>:<key>:<roundId>:open`, player to `escrow:coldcall:<key>:<roundId>`. The game keeps the record of the round (tape, decisions) in `coldcall-pull.json` before the next step.
2. The round closes with ONE batch under `...:close` (`settle`): the WHOLE escrow goes to `house:coldcall` (`coldcall:spend`), then pool feed, pool prize, win. A bonus buy is the same with a bigger cost; a buy never feeds or wins the pot (`coldcall.js` "RULE 1": only a plain paid spin passes a pool).
3. The office pot `pool:coldcall:office`: a plain paid spin feeds a slice of its stake (`feedBps`) in the same batch as the stake; a prize is paid out of the pool and never beyond what it holds (`pool_short`). A pool can only be fed out of the stake of the same batch (`needFeed`, `service.js:248`).
4. Callback: a free round (cost 0, no escrow) with its own round id `cb<id of the round that armed it>`; `settle` with stake 0 writes only the win legs under its `:close` ref.
5. A round with no escrow found at close, or an identical close again, is `dup`; any other close of a closed round is `round_closed`; an escrow that does not hold the stake the game believes is `stake_mismatch` and the game voids it.
6. Void: ONE transfer `escrow -> player`, the whole escrow, ref `...:close`, reason `<game>:void:<why>`.
Restart (D1): `games.recover()` (`games/index.js:69`) first lets each game replay its stored rounds (`coldcall.js` `recover`: a rebuilt round is settled from its recorded tape; one that cannot be rebuilt is voided; a Callback stays armed), then each game claims in `audit().openRounds` the escrows it keeps; `service.sweepEscrows` (`:387`) voids every other non-zero escrow of every game id in the ledger, also ids with no module, with reason `<game>:void:boot`. A game whose `audit()` throws keeps its escrows untouched and the error is reported.

### 5.10 Campaign run
1. Start: `ctx.money.open(key, cur, roundId, bet)`: `campaign:<key>:<roundId>:open`, player to `escrow:campaign:<key>:<roundId>`. The run record is flushed to `campaign.json`. Bets are $1, $2, $5, $10, $25 (`campaign-engine.js:8`).
2. Each surviving step moves no money. The run record is updated and flushed.
3. A drawn end (scandal, or the last step) is written into the record (`pend`) BEFORE the ledger call, so a refused write never un-draws it.
4. Cash-out, scandal, LANDSLIDE, idle timeout (60 s with no pick) all close with `closeRun` (`games/campaign.js:143`): 0 steps = `void` (stake back, reason `campaign:void:withdrawn` / `timeout` / `boot`); any other close = `settle` with `win = payout` (0 on a scandal, `stake` = the bet). The stake leg goes to `house:campaign`, then the win to the player, one batch.
Restart: every stored run is cashed out at its stored multiplier on the growth table and map it was opened with; a 0-step run is refunded; a pended result is closed as drawn (a scandal stays a loss); an escrow with no record is voided by the sweep (`games/campaign.js:203-260`).

### 5.11 A refused ledger write
| Part | What it does |
|---|---|
| ledger | `lost_lock`, `foreign_write`: refuses every later write until restart. `write_failed`: truncates to the last good size and throws once. `closed`: refuses after `close()`. |
| money port | A fence code (`tables/errors.js:27`: `lost_lock`, `foreign_write`, `write_failed`, `closed`) becomes `TableError('money_down')`, calls `onFence`, which pauses all tables (`server.js` `onFence`, `registry.pauseAll`, `tables/registry.js:246`). |
| safe wrapper | A fence from any handler is answered `{ code: 'money_down', message: 'Money service is unavailable' }` and also pauses all tables (`transport/safe.js:69-83`). Any other throw out of the hand engine voids the one table named in the message (or the sender's seat), never all of them. |
| hand | The settle batch refused: the hand is voided, stacks restored (5.6). |
| Cold Call | A refused money call leaves the round and its record open, tells the client an error (never a result), arms the timer to try again as a timeout (`coldcall.js:274` `moneyFailed`). |
| Campaign | Same for a run (`campaign.js:130` `moneyFailed`); a fence code sets `fenced` and every new start or step answers `money_down` until restart (`FENCE_CODES` `:62`, `noteFence` `:126`, checks at `:283` and `:320`). |
| game money / wallet adapter | `insufficient` on a player account = `funds`; `bad_amount` = `amount`; `round_closed`, `pool_short`, `ref_conflict`, `stake_mismatch` pass through; anything else = `internal` ("Server error") with the cause attached (`transport/game-money.js:14`, `wallet-adapter.js:17`). |

## 6. Invariants

Each has the check that enforces it. "Soak" ids are in `tests/soak/README.md` (I1-I13, an independent reader of `money.jsonl` that shares no code with `money/`). Run commands are in `RUNBOOK.md` and the test headers.

| # | Invariant | Enforced by |
|---|---|---|
| 1 | The file only grows; ids rise; every ref is unique; amounts are positive safe integers; account names have a known shape | `ledger.replayLine` (`:143`), quarantine; `tests/v2-unit/money-ledger.js` ("idempotent by ref", "crash safety", "quarantine: ..."); soak I1 |
| 2 | Per currency, all accounts sum to 0 | `ledger.check()` (`:720`); soak I2; random walks in `money-ledger.js` ("10,000 random transfers") and `money-rounds.js` ("random walk: 4000 ops") |
| 3 | A player account never goes below 0, also inside a batch, step by step | `validateItems` (`:109`); `money-ledger.js` ("player accounts never below zero"); soak I3 |
| 4 | A ref names one event: same ref and content = no second write; other content = `ref_conflict` | `refCheck` (`:523`); `money-ledger.js` ("idempotent by ref, conflict on different content") |
| 5 | A batch is one line, all or nothing | `money-ledger.js` ("batch: one line, all or nothing"); soak I2 (leg shapes) |
| 6 | Memory changes only after the line is on disk | `write` (`:535`); `money-ledger.js` ("a rejected write does not consume its ref") |
| 7 | One writer; a second opener fences the first | `fence` (`:497`); `money-ledger.js` ("fence: ..." tests); soak I1 (the file only grows) |
| 8 | A hand conserves: committed = payouts + returned; the pot is 0 after it | `service.settleHand` (`not_conserved`); soak I4 (no `pot:*` balance); `tests/v2-unit/money-service.js` |
| 9 | Every non-zero seat account = stack + this hand's committed chips; after a restart there is no seat | `money-port.drift`; soak I4 (`audit.drift` empty) |
| 10 | Cash and Chips never mix: one currency per line, no `fx:` leg, `bank:` is Chips only and `play:` Cash only; a seat, escrow or pot never holds both | `normItem` (`:48`, `ONLY_CUR`); `sameFundOnly`; soak I10 |
| 11 | Cash is never created except by `admin:adjust` or a game house paying a win | soak I11 (`CASH_SOURCES`), I12 (a house pays Cash only against a Cash stake of the same player), I13 (no Cash without an admin set or a win); `tests/money-1008-adminclaim.js` |
| 12 | An escrow holds one open round; a round closes once under its `:close` ref; a closed round is never reopened | `service.openRound` / `settleRound` / `voidAccount`; `money-rounds.js` ("close once", "a closed round stays closed across a restart"); soak I4, I7 |
| 13 | A pool is fed only out of the stake of the same batch and never paid beyond its balance | `needFeed`, `pool_short`; `money-rounds.js` ("F4", "a prize bigger than the pool"); soak I4 (pot-feed bound) |
| 14 | A restart returns all seat money and settles or refunds every open round | `bootRecover` (`:453`), `sweepEscrows` (`:387`), game `recover`; `tests/v2/07`, `17`, `18_escrow_boot.js`; soak I9 |
| 15 | `bank.json` / `wallet.json` equal the ledger fold | soak I5 |
| 16 | What a client is told equals the ledger | soak I6, I7 |
| 17 | No money sits in memory between messages | soak I8 (`audit.walletPending` = 0) |
| 18 | An admin money edit needs an op id; a resend writes nothing; Set Cash is a total | `tests/money-1008-admin-opid.js`, `money-1008-admin-setcash.js`, `money-1008-admin-msg.js` |
| 19 | An unclaimed admin account cannot be claimed without `ADMIN_CLAIM_PASSWORD` | `tests/money-1008-adminclaim.js` |
| 20 | The QA force hooks never touch a Cash round | `tests/money-1008-cc-hook.js`; Campaign: `tests/money-1008-campaign.js` |
| 21 | A live slot config above 100.0% payback is refused for Cold Call and Ballot Bender | `tests/money-1008-cfg-coldcall.js`, `money-1008-cfg-bender.js` |
| 22 | A game module reaches money only through `ctx.money`, and passes the kit | `node tests/game-kit.js <gameId>`: pending the kit merge, see `ADD-A-GAME.md` |

## 7. What the client sees

- The top bar shows two plates, **Chips** and **Cash**, each AVAILABLE only: what the player can bet right now (`public/shell.js:51`, `:283-284`). A bet, a run or a table buy-in comes off the plate at once and comes back when it ends. Chips at a table or in a round are not in the plate. The plates come from the `wallet` event: `wallet.get` = ledger balance minus a cost parked in the adapter (`wallet-adapter.js:35-38`).
- The Chips plate is always in chips (`shell.js:283`). Cash is in dollars (cents / 100).
- The `money` event (`views.js:23` `moneyView`) carries `bank` (Chips in the bank), `atTable` (Chips at seats), `inRound` (Chips in open rounds), `chips` (the sum of the three) and the same `wallet` object. It is pushed after every write that touches the player's money (`transport/index.js:15,27`).
- Game state events carry `balances` (`{ play, chips }` from `ctx.money.balance`; an open stake is in escrow, not in the balance).
- On `money_down` the client gets `{ code: 'money_down' }` and the tables are paused.
- Pending at this head: M's client branch (`money-client` 5fe7bb6 and later) keeps the Cash / Chips mode per game and per tab; until it is merged, `public/shell.js:14` still has one `let wmode = 'play'` (finding LEGS-C1).

## 8. Exposure in Cash

No code caps a payout or a house balance: the house accounts have no floor (`money/ledger.js:28`). The only ceilings are constants in the engines. The numbers below are from the critics' reports `_scratch/money/k2/K2-R1.md` (lines 22-32) and `k4/FINDINGS.md` (lines 44-50), because the lead's hand-off file `PROGRESS-MONEY-1008.md` does not exist at this head. I re-read the constants in the code (`bender-engine.js:8` `MAX_WIN_X = 10000`, `coldcall-engine.js:13` `MAX_WIN_X = 10000`, `campaign-engine.js:7-8`); the hit rates are the critics' measurements and are NOT re-run by me.

| Game | Largest payout on one round | Top bet | How often |
|---|---|---|---|
| Ballot Bender | **$250,000** (10,000 x $25) | $25 spin; the LANDSLIDE buy costs $1,930.25 | Spin: 1 in 890,000. LANDSLIDE buy: 1 in 1,709 buys. $25,000 or more: 1 in 59,000 spins |
| Cold Call | **$250,000**, plus at most $50 from the office pot on a plain spin = $250,050 | $25 spin; bonus2 buy $7,275 | Spin: 1 in 2,850,000 (K2) to 1 in 3,030,000 (K4's reading of the design sim). bonus2 buy: 1 in 6,600 (K4) to 1 in 7,550 (K2), two samples. $25,000 or more: 1 in 39,000 (K2) to 1 in 43,000 (K4) spins, about 1 in 45 bonus2 buys |
| Campaign Trail | **$25,000** (1,000 x $25, only at LANDSLIDE, step 49) | $25 run | 1 in 1,042 runs played to the end |
| Poker | no house; the pot is other players' money | n/a | n/a |

The live slot configs are measured before they go live: a Cold Call or Ballot Bender config above 100.0% payback is refused (`games/coldcall-livecfg.js`, `games/bender.js` `setLiveConfigChecked`). Return to players is about 96-98% in all three.

## 9. Deposits and withdrawals (not built)

**Design hook only. Nothing here is implemented. The spec belongs to Isabelle.** This is where a crypto deposit source plugs in without touching the games.

**Deposit**
- A new source account, named like the others, e.g. `chain:deposit`, added to `SOURCE_ACCOUNTS` (`money/ledger.js:28`) and allowed for `play` only (add it to `ONLY_CUR`'s logic or check it in `normItem`, as `bank:`/`fx:` are). Editing that file changes `SRC_SHA`, so the first boot after the deploy replays the whole journal once (`ledger.js:74-83`); that is expected.
- The credit is ONE ledger write: `chain:deposit -> play:<key>`, reason `deposit:<chain>`, ref = chain + transaction hash + log index (for example `dep:<chain>:<txHash>:<logIndex>`). A ref names the EVENT, so the same transaction can never credit twice, also after a restart or a re-scan of the chain.
- Credit only after the chain's own finality rule, from a service function in `money/service.js` (`depositCash(key, amount, ref)`) that is called by the connector, never by a socket handler.
- The checks that must learn the new source: soak `CASH_SOURCES` and `SOURCES` in `tests/soak/invariants.js:9-10` (I11 would flag the new source otherwise, on purpose; I13 treats it as a legal origin of a wallet's Cash), the account-shape list there, `tests/soak/actors/*` (the model books it as Cash created), and the game kit's source list once the kit is merged.
- The admin Set Cash total (`admin/index.js:43`) must keep counting deposited Cash like any other wallet Cash.

**Withdraw**
- A request is an escrow: `play:<key> -> escrow:withdraw:<key>:<reqId>`, ref `withdraw:<key>:<reqId>:open`. Cash leaves the spendable balance at request time. `GAMES` in `money/service.js:13` and `PLAYER_KINDS` need the new `withdraw` kind, or a reserved prefix that `sweepEscrows` leaves alone (the boot sweep voids every unclaimed escrow of a known game id; a withdraw escrow must be claimed by the connector's own `audit`, otherwise a restart refunds it).
- Admin approve: `escrow -> sink account` (e.g. `chain:withdraw`, a source account), ref `withdraw:<key>:<reqId>:close`. Reject: `escrow -> play:<key>`, same close ref, so a request closes once.
- The Set Cash total counts an open withdraw escrow as the player's Cash until it closes (as it counts a round's escrow, `admin/index.js:34`); decide that in the spec.

**What must NOT change**
- Chips are never convertible to or from Cash, and a deposit never credits Chips.
- Games stay untouched: they see only `ctx.money` and a balance.
- Cash is still created in exactly two ways: an admin edit and (new) a confirmed deposit; I11 / I13 must be updated for the second on purpose, not loosened.
