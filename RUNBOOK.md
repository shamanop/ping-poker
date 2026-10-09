# RUNBOOK.md: operating the money system at 2 a.m.

Written for `money-hardening` (2026-10-08): read at `69a44f6`, line cites rechecked after the merges up to `057a243`. PASS 2 (2026-10-08 evening): brought up to `money-hardening` `1bb821f` (and the Cold Call journal fix, section 12, see its own line); sections 3b, 3c, 10, 11, 12 are new. `MONEY-SYSTEM.md` explains what the parts are; this file is what to do. The shell one-liners below were RUN by me against a 14-line sample ledger made with the real service (`_scratch/money/fix-docs/runbook-sample-ledger.js`) in a temp dir. They were not run against the live site, whose data I cannot reach.

**Two rules before anything else**
1. **Never open `money.jsonl` with the ledger code (`node -e "require('./money/ledger')..."`) while the server is running.** Opening it takes the writer lock; the running server then refuses every write (`lost_lock`) and players see "Money service is unavailable". Read with `jq`/`tail` (read-only), or work on a COPY.
2. **Never append to, edit or truncate `money.jsonl` by hand while the server runs.** The server notices the file size changed (`foreign_write`) and stops writing for good until it is restarted.

| Symptom | Go to |
|---|---|
| Players see "Money service is unavailable", tables paused | section 6 |
| A player says a balance is wrong | sections 4, 5, 7 |
| Admin needs to give or fix Cash | section 3 |
| A round or run looks stuck, a stake is "missing" | section 8 |
| Deploy, or a deploy must be undone | sections 1, 2 |
| The server logs `QUARANTINED` | section 4 (quarantine) |
| Admin cannot sign in | section 1, `ADMIN_CLAIM_PASSWORD` |
| A player is told `account_locked` ("This account is locked. Ask the admin to reset its PIN.") | section 3c |
| Admin changes a slot's numbers and gets "another payback check is running" / "refused" / waits minutes | section 3b |
| Cold Call refuses every spin with "Server error" | section 12 |
| Start the books again at zero Cash | section 10 (the commands), section 11 (the list) |

## 1. Deploy

**How.** `.github/workflows/deploy.yml` runs on a push to `master` and executes `railway up --service ping-poker --detach`; `railway.toml` starts `node server.js` and restarts it on exit (`restartPolicyType = "always"`). A push to `master` is a deploy to real players. Isabelle merges to `master` and pushes; builders and critics never push (`builders/MONEY-COMMON.md`). I did not verify who holds the Railway token.

**What a boot does** (`server.js:14-80`; log lines to look for):
1. `[v2] money: checkpoint id N at B bytes, T tail lines replayed, M ms` or a full replay (every ledger message in the log carries the prefix `[v2] money:`, `server.js:21`). After a deploy that changed `money/ledger.js`, expect one full replay (the checkpoint is refused by design when the ledger source changed; `money/ledger.js:74-83`). That is slow on a big file, not an error.
2. `QUARANTINED n line(s)` means lines were NOT applied: go to section 4 before anything else.
3. `migration: ...` only on a first boot or a boot with changed old stores.
4. `boot recovery: S seats, P pots returned` (every seat that was open at the last stop goes back to its owner).
5. `game recovery: bender .., coldcall X open/Y by game/Z kept, campaign ..., N escrows voided`. `ERRORS n` here means a game's recovery or audit threw: its escrows were left alone (section 8).
6. `ledger: L lines, M in memory, checkpoint ok`.
7. `Ping Poker server running on port ...`.
`[SECURITY] Admin account(s) [chris] are UNCLAIMED and ADMIN_CLAIM_PASSWORD ...` is printed when the admin account is not claimed and nobody can claim it.

**Stop.** SIGTERM or SIGINT (`server.js:168` `shutdown`): live hands are voided (no money stays committed: the stacks come back), the wallet adapter is flushed, a checkpoint is written, the ledger lock is released. A hard kill (SIGKILL, power) is safe too: a torn last line is cut at the next boot, a hand that never wrote its batch never happened, seats come back at boot, open game rounds are settled or refunded at boot.

**Env vars that matter.** Set in the Railway service. I cannot see the live values: someone with access must check the first four.

| Variable | Right | What happens when it is wrong |
|---|---|---|
| `NODE_ENV` | `production` | The server counts itself as production when `NODE_ENV` (trimmed, any case) is `production` OR any of `RAILWAY_ENVIRONMENT`, `RAILWAY_ENVIRONMENT_NAME`, `RAILWAY_VOLUME_MOUNT_PATH`, `RAILWAY_SERVICE_ID` is set (`server.js:14-20` `isProduction`, REV-SG-1: a Railway deploy with `NODE_ENV` missing or misspelled is still production). In production `RIG`, `SIGNUP_PLAY_CENTS` and `AUTH_CLOCK_SKEW` do nothing. Outside production `COLDCALL_TEST` / `CAMPAIGN_TEST` turn the QA force hooks on if set. Cash rounds ignore the force hooks either way (Chips only). |
| `RIG` | **unset** | `RIG=1` outside production registers `__rig` (queue the decks) and `__audit` (all balances) for ANY socket, signed in or not. In production it is ignored with one line `[v2] RIG IGNORED: production ...` (`server.js:87`, RIG-1 / REV-SG-1); no hook is registered. Never set it on a box that holds real data. |
| `SIGNUP_PLAY_CENTS` | **unset** | Outside production only, digits only, a safe integer: that much Cash is minted for every new account at signup (test fixtures). In production, or with any other value, it is ignored with one line `[v2] SIGNUP_PLAY_CENTS IGNORED: ...` and new accounts start with 0 Cash (`server.js:47-56`, SVC-1a). `createService` itself also mints nothing unless its caller passes `signupPlay`. |
| `COLDCALL_TEST`, `CAMPAIGN_TEST` | unset | `=1` outside production turns on the QA `force` hook (`games/coldcall.js:26`, `games/campaign.js:28`), logged as `*** QA FORCE HOOK IS ON`. Chips rounds only. `CAMPAIGN_IDLE_MS` shortens the idle timer under the same switch. |
| `ADMIN_CLAIM_PASSWORD` | 8 or more characters (after trimming), not the room word `ping` (any case) | Unset, shorter, or equal to the room word = the admin account `chris` cannot be claimed (fail closed, `accounts.js:52-54,197`); the boot log says so (`accounts.js:361`). It is used only while `chris` is unclaimed: an already-claimed admin signs in with the PIN. Set it, restart, claim `chris` once, then the value no longer matters for login. |
| `BENDER_ADMIN_TOKEN` | a long random value | Unset = the live-config routes `/api/admin/bender-config` and `/api/admin/coldcall-config` always answer 403 (`server.js:93`). Wrong tokens: `ADMIN_WRONG_TOKEN_MAX` (default 5) wrong tries from one address inside `ADMIN_WRONG_TOKEN_WINDOW_MS` (default 600000) lock that address out with 429 until the window moves on; one log line per refusal; the token is never logged (`server.js:101`). |
| `RAILWAY_VOLUME_MOUNT_PATH` or `DATA_DIR` | the mounted volume | Neither set = data files live in the code directory and are lost at the next deploy, including `money.jsonl`. A first boot on an empty directory starts with no Cash for anyone (`tools/migrate-v2.js` mints none since 5922b5e) and 10,000 Chips each. A first boot with an OLD `wallet.json` / `bank.json` in the directory copies their rows into the ledger once as `mint:migration` (`mig:play:<name>`, `mig:...`, `tools/migrate-v2.js:105-113`): that is real Cash created from a file. Never put an old `wallet.json` into a data dir. |
| `FRESH_START_ID` | **unset** | A value not yet used moves EVERY data file to `backup-<id>/` and starts empty (`transport/boot.js:25-44`; a marker `.fresh-<id>` stops a repeat). Only when the data dir is not the code dir. |
| `LEDGER_CKPT` | unset (on) | `0`/`false`/`off`/`no` turns the boot checkpoint off: every boot is a full replay. `LEDGER_CKPT_VERIFY=1` makes every boot replay in full AND compare; `LEDGER_CKPT_EVERY=n` writes a checkpoint every n lines; `LEDGER_WINDOW` (default 20000) is the number of lines kept in memory. |
| `MONEY_FILE`, `BANK_FILE`, `WALLET_FILE`, `ACCOUNTS_FILE`, `TABLES_FILE`, `STACKS_FILE`, `LEDGER_FILE`, `BIGWINS_FILE`, `COLDCALL_PULL_FILE`, `COLDCALL_CFG_FILE`, `BENDER_CFG_FILE`, `CAMPAIGN_FILE` | unset | Move one file away from the others (`transport/boot.js:10-22`). `MONEY_FILE` defaults to `money.jsonl` next to `bank.json`. |
| `PORT` | set by Railway | default 3000. |
| `HAND_DELAY_MS`, `TABLE_EMPTY_MS`, `AUTH_CLOCK_SKEW`, `AUTH_SIGNUP_LIMIT`, `LEGACY_IMPORT_FILE` | unset | Test and tuning: hand delay, empty-table timeout, a shift of the auth clock (`__test_skew` is registered only outside production, `transport/handlers/auth.js:74`), signups per address per hour (default 40), a one-time chips history file. |
| `CC_MAX_THREADS`, `BB_CFG` | unset | Simulation only. `BB_CFG` (JSON) overrides the Bender engine config used by `games/bender-rtp.js`, which the live-config check measures with: do not set it on the server. |

**Before a deploy, a minimum**
1. Copy `money.jsonl` (and `accounts.json`, `campaign.json`, `coldcall-pull.json`) off the volume. `money.jsonl` only grows, so a copy is an exact backup up to that moment.
2. Compare the money accounts: the old build must know every non-player account the file already uses (section 2, step 1). Compare against the build that is live now, not against this file.
3. **Look at the live Ballot Bender config file before the deploy** (RVC-4): `$DATA_DIR/bender-config.json` (or the file named by `BENDER_CFG_FILE`). The new build checks number ranges at boot (`RANGES` in `games/bender-engine.js:224`). A saved config with a number outside them (e.g. `maxSpins` over 200, a `pay` value over 1e6, a list over 64 entries) is NOT loaded: the game starts on the shipped numbers with one console line `[bender] live config not loaded, using defaults: <why>`, and players see the shipped game. A saved config without a passing measurement made for exactly those numbers is refused the same way ("the saved config has no passing payback measurement; POST it again so the server can measure it"). So after the deploy check the console for that line, and POST the config again if it is wanted (section 3b). No money is involved either way. I did not read the live file (I cannot reach it).
4. Run the suites named in the lead's hand-off (`MONEY-FINDINGS-1008.md` lists a regression test per fix). I do not list commands here that I did not run.

## 2. Rollback

Rolling back means starting an OLDER build on the SAME `money.jsonl`. The older build reads every line with its own rules (`SOURCE_ACCOUNTS` and `PLAYER_KINDS` in `money/ledger.js:27-31`). A line it does not understand is not applied.

**What the old build does with a line it does not know** (RUN on a temp copy): at open it writes `QUARANTINED n line(s) ... They were NOT applied` to the log and copies the line to `money.jsonl.quarantine`. Then every later line that depended on it fails too: a player whose win came from an unknown `house:<newgame>` has a balance that is too low by the win, and the line where he spent it is quarantined as `insufficient` (the sample: 100 Chips balance instead of 150, the 140 spend quarantined). The file itself is not rewritten.
It gets worse in two ways. (a) The old build keeps appending, and its ids continue after its last APPLIED line, so its new lines reuse the ids of the quarantined ones. (b) If you then roll FORWARD again, the new build reads the reused id as "not after" the last one and quarantines the old build's line: in the sample, 10 Chips the old build paid out vanished after rolling forward (`id 2 is not after 3`). So a rollback that skips step 1 loses data both ways.

**Steps**
1. List the non-player accounts the file uses and compare with the old build:
   ```
   jq -r '(.batch // [.])[] | .from, .to' money.jsonl | sort -u | grep -Ev '^(bank|play|seat|pot|escrow|pool|orphan):' > used.txt
   git show <old-commit>:money/ledger.js | sed -n '/^const SOURCE_ACCOUNTS/,/\]);/p' | grep -o "'[a-z]*:[a-z]*'" | tr -d "'" | sort -u > old.txt
   comm -23 <(sort -u used.txt) old.txt        # empty = the old build knows all of them
   ```
   Also compare the line `const PLAYER_KINDS = {...}` of both builds. Both ran empty/equal in my sample for `origin/master` (`cfa2ff8`) against this head: this head adds no source account and no account kind to the live build's lists (`git log origin/master..HEAD -- money/ledger.js` is empty). `house:campaign` is NOT known to `bb298d2` or older: rolling back that far needs it added first.
2. If the list is not empty: do not roll back. Either deploy a forward fix, or deploy the old build plus a one-line change adding the missing names to its `SOURCE_ACCOUNTS` (and `GAMES` in `money/service.js`) first.
3. Copy `money.jsonl` before the switch (section 1).
4. Deploy the old build. Check the boot log for `QUARANTINED`. If it appears, stop and read section 4 before players play.
5. Rolling back to `9440541` (the file-based server before v2): it does not read `money.jsonl`. It reads `bank.json` and `wallet.json`, which the new build rewrites from the ledger every 250 ms while the ledger moves (`transport/boot.js:93` `startMirror`; open seats and open game rounds are folded into the owner's row, `money/service.js:499` `mirror`). Make sure the last mirror write happened (stop with SIGTERM, not a kill) and keep `money.jsonl` for the way forward; money won on the old build is NOT in the ledger.
6. A game's own state files (`campaign.json`, `coldcall-pull.json`) belong to the build that wrote them; an older build may not read them.

## 3. Setting a player's Cash (admin)

Only an admin account (`chris`, claimed with `ADMIN_CLAIM_PASSWORD` once) can. In the admin console in the lobby: a player's row, Cash, enter the amount, confirm. The page sends `admin_set_play { key, cents, opId }` (`public/admin.js:198`); every click has its own op id, so a double click or a reconnect writes nothing twice.
- **Set Cash is a TOTAL.** The player's Cash becomes X. It counts the wallet, Cash at poker seats and Cash in open game rounds (`admin/index.js:34-41`). The wallet is moved by `X - atTable - inRound - wallet` in one ledger line, `admin:adjust` to or from `play:<key>`, ref `adj:<key>:c.<opId>`.
- **Below what is in play, it refuses.** X lower than the Cash at seats plus in rounds answers `cash_in_play`, with the amount, and writes nothing (`admin/index.js:52-58`). End the night or wait for the round, then set it.
- X is a RAW JSON number that is a whole number of cents (a safe integer, not `-0`), at most 100,000,000,000 (`admin/index.js:4`). A string, `null`, `""`, `[]`, `false` or `"0x10"` is refused `bad_amount` ("The amount must be a whole number of cents. Nothing was changed.") before anything is converted (R2B-2, `transport/handlers/admin.js:7-22`). A number out of range is `range`. An `admin_adjust` that would take the player's TOTAL Cash over the maximum is `range` too (RV-4).
- The admin page shows, prefills and asks you to confirm the TOTAL Cash (wallet + seats + rounds) that Set Cash sets (R2B-6, `public/admin.js:135,144,211`), with the part in play shown beside it.
- A Set Cash that changes nothing (X already equals the total) still writes a net-zero mark under its op id (`service.adminMark`, R2B-3, `admin/index.js:73-77`), so a resend of the same click after the balance moved is `dup`, not a new edit.
- The admin console's Chips "bank" edit is a signed delta against the bank (`admin_adjust`, `cur: 'chips'`); Chips at tables are not touched. The server also accepts `admin_adjust` for Cash as a signed delta from a crafted client; the console does not offer it.
- No op id = refused (`op_required`). A repeat of the same click = `dup`, nothing written. The same op id with another amount = `ref_conflict`.
- Check it afterwards: `jq -c 'select(.ref|startswith("adj:ann:"))' money.jsonl | tail -3`. The reason carries the target: `admin:admin set play to 100000`.

## 3b. Changing a slot's numbers (the live config payback check)

Cold Call and Ballot Bender math is changed with `POST /api/admin/coldcall-config` or `POST /api/admin/bender-config` (header `x-admin-token` = `BENDER_ADMIN_TOKEN`; body `{overrides: {...}, note}` or `{reset: true}`; `server.js:153-185`). Why and how it is decided: `MONEY-SYSTEM.md` section 5.12. What an operator needs:
- **The rule.** A config goes live only if, for EVERY way to play, measured payback + 3 standard errors is at or under 100. Ballot Bender buys are measured at the lowest price any bet is charged. A refusal answers 400 with the reason ("the <way> way is not shown to be at or under the 100% ceiling: measured X% with a standard error of Y points ..."), and nothing changes. The shipped numbers (`{reset: true}`) need no check.
- **Order.** Number ranges and shape are checked first and refused at once ("... must be between lo and hi"). Only then the measuring starts, in a worker thread; the game keeps serving.
- **How long.** A check commonly takes 1 to 2 minutes; the POST waits for it (keep the client timeout above 5 minutes). Hard limits: the smoke test must end in 10 s ("the config is too slow to check"), the whole check in 300 s ("payback check did not finish in 300 s"), extra rounds for an undecided way stop 240 s after the start. These caps are wall clock: a slow or busy box refuses a config that a quick box accepts. It fails closed; the cure is to retry on a quiet moment or to send less extreme numbers.
- **One at a time.** A second POST while a check runs is refused: "cfg: another payback check is running, try again when it has finished".
- **Cancelled.** A reset, or any newer save that is accepted, cancels a check in flight; the older POST answers "refused, another admin change (a reset or a new config) was accepted while this check ran; nothing was changed by this one". To abort a running check: POST `{reset: true}`.
- **Audit.** Every accepted or refused POST is a console line `[cfg-audit] {...}` (who = `admin#<8 hex of the token hash>@<address>`, old and new measured payback, seed); the files `bender-config.json` and `coldcall-config.json` in the data dir hold the live numbers.
- **After a deploy**, a saved Bender config that no longer passes the number ranges is not loaded (section 1, "Before a deploy", step 3).
- Run one yourself (rehearsal on this box only, never on the live site): start a server on a scratch data dir, `curl -s -H "x-admin-token: $T" -H 'content-type: application/json' -d '{"overrides":{"maxSpins":400000}}' localhost:$PORT/api/admin/bender-config` answers 400 `maxSpins: must be between 0 and 200` within a second.

## 3c. A player is told `account_locked`

What it is: after `accounts.json` was lost or damaged, boot re-made this player's account because the ledger holds Cash for the key (the wallet, a Cash seat, a Cash round escrow or a stray pot; `MONEY-SYSTEM.md` section 5.1). A re-made account that holds ANY Cash is locked: the public room word does not claim it, signing up with the name is refused, a login is refused, all with `account_locked`. Boot logs one line `[SECURITY] accounts: N account(s) were re-made UNCLAIMED for keys that hold Cash and are LOCKED ... Was accounts.json lost or damaged?` Read that as a signal to find out why the file was lost (section 9: `accounts.json.bak`).
What the admin does, per player: confirm it is the real player (not through the game), then Admin page > Players > the row > **Reset PIN**, give the player the new PIN. Reset clears the lock, sets the PIN, signs old sessions out (`accounts.js:378` `resetPin`). The Cash is untouched the whole time. An admin account is never locked. A re-made account with only Chips is not locked (anyone with the room word can claim it, as before).

## 4. Reading `money.jsonl`

One JSON object per line. Single transfer: `{id, ts, from, to, amount, cur, reason, ref}`. Batch: `{id, ts, batch:[{from,to,amount,cur,reason},...], ref, reason}`; all legs apply or none. `cur` is `chips` or `play` (Cash, cents). `ts` is milliseconds since 1970. Refs and reasons are listed in `MONEY-SYSTEM.md` section 4. Run these in the data directory (a copy is safest; `jq` only reads).

```
# one ref (a hand, a round's open and close, an admin edit)
jq -c 'select(.ref=="hand:T1:1")' money.jsonl
# one round (instant, or open + close)
jq -c 'select(.ref|test("^coldcall:ann:held7(:|$)"))' money.jsonl
# every line that touches one player (wallet, bank, his seats, his escrows)
jq -c --arg k ann 'select([.from,.to,(.batch[]?|.from,.to)] | map(select(type=="string")) | any(test("^(bank|play):"+$k+"$|^seat:[^:]+:"+$k+"$|^escrow:[^:]+:"+$k+":")))' money.jsonl | jq -r '[.id,.ref]|@tsv'
# the last 5 lines, readable
tail -5 money.jsonl | jq -r '[.id,.ref,(.reason // "batch")]|@tsv'
# line count, last id, duplicates (both duplicate counts must be 0)
jq -s -c '{lines:length, lastId:(.[-1].id)}' money.jsonl; jq -r .ref money.jsonl | sort | uniq -d | wc -l; jq -r .id money.jsonl | sort -n | uniq -d | wc -l
```

Lines the ledger would refuse are not applied. `jq` does not know the rules, so it shows them anyway. The server tells you: the log line `QUARANTINED n line(s)` and the file `money.jsonl.quarantine`, one JSON object per refused line `{ts, lineNo, reason, line}`:
```
jq -c '{lineNo,reason}' money.jsonl.quarantine
```
Reasons: `bad_account` (unknown source or malformed name), `insufficient: <account> has X, needs Y` (a spend that the earlier, refused lines would have covered), `id N is not after M`, `duplicate ref`, `unparseable`. Quarantined lines are never applied and the file is never rewritten. A torn last line (no newline, after a crash) is not quarantined: it is cut off at boot. Check `.quarantine` is absent in a healthy data dir (the soak treats its existence as a failure, invariant I1).

## 5. Replaying the file to balances

Pure `jq`, no ledger code, safe on the live file (it reads only). It does NOT apply the quarantine rules, so on a healthy file it equals the server and on a file with refused lines it differs:
```
RE='reduce (inputs | (.batch // [.])[]) as $l ({}; (.[$l.cur+"|"+$l.from] = ((.[$l.cur+"|"+$l.from] // 0) - $l.amount)) | (.[$l.cur+"|"+$l.to] = ((.[$l.cur+"|"+$l.to] // 0) + $l.amount)))'
jq -n -c "$RE | with_entries(select(.value != 0))" money.jsonl                                   # every non-zero balance, key = "cur|account"
jq -n -c "$RE | with_entries(select(.value != 0 and (.key|test(\"\\\\|escrow:\"))))" money.jsonl     # open escrows only
jq -n -c "$RE | to_entries | group_by(.key|split(\"|\")[0]) | map({cur:(.[0].key|split(\"|\")[0]), sum:(map(.value)|add)})" money.jsonl   # per currency, both sums must be 0
```
Source accounts (`mint:*`, `house:*`, `admin:adjust`) show negative numbers: that is correct (`house:coldcall` positive means the house is ahead, negative that the players are).

With the ledger code, on a COPY (the same rules as the server, plus the quarantine):
```
mkdir /tmp/copy && cp money.jsonl /tmp/copy/        # never copy the .lock file
node -e "const L=require('./money/ledger');const l=L.open(process.argv[1],{fsync:'none',ckpt:false,log:console.error});console.log(JSON.stringify(l.check()));console.log(JSON.stringify(l.list('escrow:','play')));console.log(l.balance('play:ann','play'));l.close()" /tmp/copy/money.jsonl
```
`l.check()` prints `{chips:{players,sources,ok}, play:{...}, quarantined:n}`; `ok:true` means that currency sums to 0. Run from the repo root of the build you want the rules of.

## 6. `money_down` or a fenced ledger

**What players see.** Any action that needs money answers `Money service is unavailable` (`code: money_down`, `transport/safe.js:29`); all tables are paused (`registry.pauseAll`); Campaign refuses new runs and steps with `money_down` (`games/campaign.js:285,322`); Cold Call and Campaign keep an open round open and retry the close as a timeout (they never show a result for a write that failed).

**What triggers it** (`money/ledger.js:497-516`, `tables/errors.js:27`):
| Code | Meaning | Sticky |
|---|---|---|
| `lost_lock` | another process opened the same `money.jsonl` after this one and took `money.jsonl.lock` | yes, until this process restarts |
| `foreign_write` | the file's size is not what this process wrote: someone appended, truncated or replaced it | yes |
| `write_failed` | the write itself failed (disk full, I/O error); the ledger cut the file back to the last good size | no, but tables still pause |
| `closed` | writes after shutdown began | n/a |

**Find the cause**
```
grep -n "MONEY FENCED\|replaced a lock held by another opener\|lost_lock\|foreign_write\|write_failed\|QUARANTINED" <the server log>
df -h <data dir>                                  # write_failed: a full disk
ls -l --time-style=full-iso money.jsonl*          # modification times: who wrote when
tail -3 money.jsonl | jq -r '[.id,.ts,.ref]|@tsv' # ids still continue? ts of the last line
```
- `replaced a lock held by another opener (xxxxxxxx)` is logged by the process that took the lock: a second instance (an overlapping deploy, a manual `node` run, a tool that opened the ledger on the live directory). The other one is the one to stop.
- `foreign_write`: compare the last lines with the log. A restore of an older copy, an editor save, an `echo >>` all do this.

**Clear it**
1. Make sure exactly ONE server process uses the data dir (stop every other instance and every script that opened the ledger).
2. Restart the service. The fence lives in the process; a restart clears it. Boot recovery then returns every seat and settles or refunds every open game round (section 1, log lines 4-5). Nothing else is needed, and no player money is lost: a hand that was open never wrote its batch, so it never happened.
3. If the log shows `QUARANTINED` after the restart, go to section 4: lines someone wrote by hand were judged by the normal rules.
4. For `write_failed`: free disk space first, or the restart fails the same way.
5. After the restart run the replay of section 5 on a copy: both sums are 0 and no `.quarantine` file exists.

## 7. A player's balance history

Every change of a player's balance is a line with his wallet or bank. Wallet changes only (Cash):
```
jq -r --arg a play:ann '. as $r | (.batch // [.])[] | select(.cur=="play" and (.from==$a or .to==$a)) | [$r.id, ($r.ts/1000|todate), $r.ref, (if .to==$a then "+" else "-" end)+(.amount|tostring)] | @tsv' money.jsonl
```
(`bank:ann` and `"chips"` for Chips). Money sitting at a table is in `seat:<tableId>:<key>`; money in an open game round is in `escrow:<game>:<key>:<roundId>`; neither is in the wallet, and neither is in the top-bar plate. The player's full position today: wallet + seats + escrows, from section 5's replay (keys `play|play:ann`, `play|seat:*:ann`, `play|escrow:*:ann:*`) or `service.balances(key)`. Sample output of the query above:
```
3   2026-10-08T...Z  adj:ann:c.op1            +100000
5   ...              buyin:T1:ann:b1.1        -10000
8   ...              leave:T1:ann:b1.3        +10500
9   ...              coldcall:ann:r1          -500
```
What happened inside a poker hand is not in the ledger (only the totals per seat: `hand:<table>:<n>`); the table's hand log and the presentation ledger (`ledger.json`, nights and nets) have the rest.

## 8. Open escrow or stuck round?

An open round is a stake in `escrow:<game>:<key>:<roundId>` with a `...:open` line and no `...:close` line. Normal, short-lived: a Cold Call decision (a feature the player is choosing in), a Campaign run (up to the 60 s idle timeout between picks, then it cashes out).

List them (section 5, second command) and look at the age of the `:open` line (`ts`):
```
jq -c 'select(.ref|test(":open$")) | {ref,age_min:((now*1000 - .ts)/60000|floor)}' money.jsonl | tail -20
```
Cross-check with the open ref's `:close`: `jq -c 'select(.ref=="campaign:bob:run9:close")' money.jsonl` returns nothing for a round still open.

An escrow is STUCK when it is old (a Cold Call round past its decision timeout, a Campaign run past 60 s) and the player is not in it. The game closes its own rounds by timer; a stuck one means the timer's close call was refused (the log says `money call failed, the round stays open`) or the process restarted without the game claiming it.
1. **Restart the service.** Boot does the closing: each game settles or voids the rounds it knows; `sweepEscrows` voids every other non-zero escrow back to its player with reason `<game>:void:boot` (`money/service.js:387`). This is the normal and safe close.
2. If a restart leaves an escrow open, the boot log says why (`game recovery: ... ERRORS n`, the error is printed with the game id and code). Fix the cause; do not edit the file.
3. Last resort, with the server STOPPED and on a copy of `money.jsonl` first. This refunds the whole escrow to the player under the round's close ref, which is exactly what a boot void does (RUN on a temp copy, the escrow closed and the books stayed at 0):
   ```
   node -e "const L=require('./money/ledger'),{createService}=require('./money/service');
   const [file,game,key,cur,round]=process.argv.slice(1);
   const l=L.open(file,{fsync:'all',log:console.error});const s=createService(l,{signupPlay:0});
   console.log(JSON.stringify(s.openRounds(game)));
   console.log(JSON.stringify(s.voidRound(game,key,cur,round,'manual')));
   console.log(JSON.stringify(l.check()));l.close()" money.jsonl campaign bob play run9
   ```
   `voidRound` refuses a round that was already settled (`round_closed`) and does nothing when there is no escrow; running it twice is safe. The game's own record of that round (in `campaign.json` / `coldcall-pull.json`) is dropped by the game at the next boot, because it has no escrow and its close ref exists. This pays the stake back, not a win: if the player was ahead, that is for the admin to make good with Set Cash (section 3), after the round is closed.
4. Never close an escrow by writing a line yourself or by an admin adjust: the next boot would still see the escrow and void it, and the player would be paid twice.

## 9. Backups, checkpoints and what each file is

All in the data directory (`RAILWAY_VOLUME_MOUNT_PATH` or `DATA_DIR`). I found no job in the repo that copies `money.jsonl` off the volume, and I cannot see whether Railway backs the volume up: take your own copy before every deploy (section 1).

| File | What | Safe to delete? |
|---|---|---|
| `money.jsonl` | THE ledger. The only source of truth for money. Never rewritten, rotated or compacted. | **No.** Without it every balance is lost. |
| `money.jsonl.ckpt` | boot shortcut (balances and refs, with a hash of the journal bytes it covers). Believed only if the hash matches and the code that wrote it is the same code. | Yes: the next boot does a full replay. A checkpoint that fails a check (or, with `LEDGER_CKPT_VERIFY=1`, disagrees with a full replay: `CHECKPOINT MISMATCH`) is logged `checkpoint ignored: ...` and renamed `.ckpt.bad`; the full replay is used. Send that log to a developer. |
| `money.jsonl.lock` | the writer token of the running process (`money/ledger.js:280-283`). | Only with the server stopped; a stale lock never blocks a boot. |
| `money.jsonl.quarantine` | lines the ledger refused (section 4). | Keep it: it lists what needs an admin look. |
| `bank.json`, `wallet.json` | write-only mirror for rollback to the old file-based server, rewritten when the ledger moves. | They are derived; nothing reads them at run time. |
| `bank.json.pre-v2`, `wallet.json.pre-v2`, `stacks.json.pre-v2`, `accounts.json.pre-v2` | copies of the old stores made once, at the first v2 boot (`transport/boot.js:61`); also the marker that "v2 has booted here". | Keep. If missing, the migration treats the store as empty. |
| `ledger.json.bak-<stamp>`, `bank.json.bak-<stamp>` | one-time safety copies made before the first run that creates `accounts.json`. | Keep. |
| `accounts.json` | accounts, PIN hashes, profile; no money. | No. |
| `campaign.json` (+ `.bak`), `coldcall-pull.json` (+ `.bak`) | each game's own state: open rounds, leads, the Callback. Written as temp + fsync, the previous version kept as `.bak`; an unreadable main file is restored from `.bak` or reported loudly and kept, never read as "nothing open". Not money, but a lost one means rounds that boot must settle from the ledger alone. | No. |
| `backup-<id>/` | what `FRESH_START_ID` moved aside. | Keep. |

Checkpoints are written at boot, at shutdown and (with `LEDGER_CKPT_EVERY`) every n lines. To rebuild the books from nothing but the journal, delete `money.jsonl.ckpt` and start the server: the full replay is the proof that the file is self-consistent (a damaged file shows as `QUARANTINED`).

**Section 10 (its heading is not numbered because the text below is the builder's, word for word).**

## Fresh start at zero

Variant chosen by Chris 2026-10-08: KEEP player names + PINs (accounts.json stays), ZERO the money (the money ledger starts empty), Chris sets each player's Cash by hand from an export record. Cash = ledger currency `play` (real money, only an admin sets it); Chips are free play.

Every command below was run against a throwaway data dir (rehearsal: `_scratch/money/fix-zero-start/rehearse.sh`, full log `rehearsal.log`) with the real default file names (only `DATA_DIR` set). Not run: anything on Railway itself (how the repo checkout and the data volume are reached there is Isabelle's to know). `$D` = the data dir (`DATA_DIR`, else `RAILWAY_VOLUME_MOUNT_PATH`, else the repo root: `transport/boot.js resolvePaths`). Run the commands from the repo checkout that matches the deployed build (the tool needs `money/ledger.js` and `transport/boot.js` from it).

Read first: three things in the product make "just empty money.jsonl" WRONG (FOUND-2, FOUND-3) and one makes Chips non-zero (FOUND-1, below).

### 1. Export on LIVE first, and keep the file (Isabelle keeps the output)

The tool only reads. It copies the journal to a private temp dir, replays the copy with the ledger's own code, and never writes under `$D`. Run it on the live data dir while the server is still up; it does not touch the ledger lock.

    mkdir -p ~/ping-export
    node tools/export-balances.js --ledger "$D/money.jsonl" --accounts "$D/accounts.json" \
        --csv ~/ping-export/balances-before-zero.csv --json ~/ping-export/balances-before-zero.json

Output (rehearsal, 4 accounts):

    export: 4 accounts, ledger id 9; Cash total 350000 cents (wallets 350000, escrow 0, seats 0), Chips total 25019
    exit 0

    key,name,kind,cash_total,chips_total
    ann,Ann,account,300000,777
    bob,Bob,account,50000,4242
    chris,Chris,account,0,10000
    cy,Cy,account,0,10000
    TOTAL,,total,350000,25019

`cash_total` (cents) is wallet + Cash at poker seats + Cash in open game rounds: the number the admin page's Set Cash takes (K1-3). The same file has `cash_wallet`, `cash_escrow` (and `escrow_cash_<game>`), `cash_seats` and `seats_detail` per table, and the Chips equivalents. If the tool prints "WARNING ... quarantined", stop and get an admin look first.

Also keep a full copy of the data dir (safety net, not read by anything):

    cp -a "$D" ~/ping-export/data-before-zero        # exit 0

### 2. Stop the server

Stop the service the way it is normally stopped (rehearsal: `kill -TERM <pid>`; result: "server stopped"). Do the move below only while it is stopped: a running server holds the ledger open.

### 3. Files to empty / move aside, and files to KEEP

Move aside (all of these, as named in the code: `money.jsonl` = `paths.MONEY_FILE`; `bank.json` / `wallet.json` / `stacks.json` = BANK / WALLET / STACKS; the four `.pre-v2` copies are what `migrateIfNeeded` re-reads at EVERY boot):

    Z="$D/zeroed-$(date +%Y%m%d)"; mkdir -p "$Z"
    for f in money.jsonl money.jsonl.ckpt money.jsonl.ckpt.tmp money.jsonl.ckpt.bad money.jsonl.lock money.jsonl.quarantine \
             bank.json wallet.json stacks.json bank.json.pre-v2 wallet.json.pre-v2 stacks.json.pre-v2 accounts.json.pre-v2; do
      if [ -e "$D/$f" ]; then mv -v "$D/$f" "$Z/"; fi
    done
    echo '{}' > "$D/bank.json"        # NOT optional, see FOUND-3: without it the boot copies the repo's bank.json (dial-up, crip doe, ...) back in

Output (rehearsal): nine `renamed '$D/money.jsonl' -> '$D/zeroed-20261008/money.jsonl'` lines (money.jsonl, money.jsonl.ckpt, bank.json, wallet.json, stacks.json, bank.json.pre-v2, wallet.json.pre-v2, stacks.json.pre-v2, accounts.json.pre-v2), then `ls "$D"`:

    accounts.json  accounts.json.bak  bank.json  bank.json.bak-1791515627602  ledger.json  tables.json  zeroed-20261008

KEEP, do not touch: `accounts.json` (names + PINs; sha256 identical before and after the boot, rehearsal `222ea00274a8572b` both), `accounts.json.bak`, `ledger.json` (player history), `tables.json`, `bigwins.json`, `coldcall-pull.json`, `coldcall-config.json`, the Bender config. Do NOT set `FRESH_START_ID` (that is the wipe-all variant).

### 4. Start, what the boot log must show, the one command that proves Cash is 0

Start the server as usual. The boot log must show (rehearsal):

    migration: 4 accounts, 4 writes (4 written, 0 dup), orphans 0, rejected 0
    boot recovery: 0 seats, 0 pots returned
    Ping Poker server running on port 5525

and must NOT show `QUARANTINED`, `CONFLICTS`, `fresh start`, or a `migration:` line with accounts you do not know. (The 4 writes are the Chips defaults, FOUND-1; the account count must equal the number of kept accounts.)

The one command:

    node tools/export-balances.js --ledger "$D/money.jsonl" --accounts "$D/accounts.json" --csv /dev/null --expect-zero cash

    export: 4 accounts, ledger id 4; Cash total 0 cents (wallets 0, escrow 0, seats 0), Chips total 40000
    expect-zero (cash): OK, 4 account row(s), every one is 0
    exit 0

Two more proofs, both must print 0:

    grep -c "mint:migration" "$D/money.jsonl"                 # 0
    grep -c '"cur":"play"' "$D/money.jsonl"                   # 0   (no Cash line at all)

Chips: `--expect-zero chips` exits 4 here (`ann chips=10000, bob chips=10000, chris chips=10000, cy chips=10000`): every kept account gets the 10,000 Chips signup default at boot (FOUND-1). Chips are free play; no real money. If Chris wants Chips at 0 as well, that needs a decision (product change, or an admin Chips adjust per account); it is not part of this procedure.

### 5. Chris sets each player's Cash from the export

Admin page > Players > the player's row > "Set Cash": type that player's `cash_total` from `balances-before-zero.csv`, divided by 100 (the CSV is in cents). Set Cash means the player's TOTAL Cash becomes that number. Skip rows with `cash_total` 0. The server answers "Play set"; repeating a click is safe (same opId, nothing written twice).

Rehearsal, same event sent from the CSV's `cash_total` column:

    admin sign-in true
    set ann 300000 true
    set bob 50000 true

Check after the last player (the Cash column must equal the export, row by row; `cut` counts commas, so a name with a comma shifts the columns: read the JSON then):

    node tools/export-balances.js --ledger "$D/money.jsonl" --accounts "$D/accounts.json" --csv - | cut -d, -f1,3,8
    key,kind,cash_total
    ann,account,300000
    bob,account,50000
    chris,account,0
    cy,account,0
    TOTAL,total,350000

    diff <(cut -d, -f1,8 ~/ping-export/balances-before-zero.csv) <(node tools/export-balances.js --ledger "$D/money.jsonl" --accounts "$D/accounts.json" --csv - 2>/dev/null | cut -d, -f1,8)
    no difference in Cash per account

A player who was seated at a Cash table at export time is in `cash_total` already (it includes the seat), so Set Cash puts the whole amount in the wallet; the seat itself does not come back (rehearsal: Bob's Chips seat did not).

### Not chosen: wipe-all (from the code, NOT run)

`FRESH_START_ID=<id>` (transport/boot.js prepareDataDir) moves EVERY plain file in `$DATA_DIR` except `backup-*`, `.fresh-*` and `lost+found` into `backup-<id>/` and writes `bank.json` as `{}`. On top of the money files above that removes `accounts.json` (all names + PINs, every player would have to sign up again and the admin `chris` claim), `ledger.json` (player history / night nets), `bigwins.json`, `tables.json`, `coldcall-pull.json`, `coldcall-config.json` and the Bender config. Not what Chris chose.

### Open decision ZS-1 (for the owner; NOT decided)

The procedure above gives Cash 0 for everyone, but NOT zero Chips: boot gives every kept account 10,000 Chips as a `mint:signup` line (`server.js:46` `ensureAccount` -> `money/service.js` `START_CHIPS`; found as FOUND-1 in `_scratch/money/fix-zero-start/`, written ZS-1 in the findings list). Chips are free play, so no real money moves. The rule the owner stated was "0 Chips and no mint:signup"; the code cannot do that today. The owner decides one of:
1. **Accept** 10,000 Chips each (nothing to do; `--expect-zero cash` is the proof that matters).
2. **Product change** so a kept account is not given Chips at boot (server.js ensureAccount loop / `money/service.js`): a code change and a deploy, not done, no owner of it named.
3. **Admin Chips adjust** of -10,000 per account after the first boot (`admin_adjust` with `cur: 'chips'`; not run by anyone).
Until the owner answers, this stays open. The test `ZERO_START_STRICT=1 node tests/money-1008-zero-start.js` shows it as 2 FAIL lines (exit 1) on purpose; without the variable they print as FINDING lines (exit 0).

## 11. Go-live command list (every command a go-live uses, and where it was run)

Marks: **REHEARSAL** = run by the zero-start builder on a throwaway data dir on this box (log `_scratch/money/fix-zero-start/rehearsal.log`, exit codes printed there; the whole rehearsal used `DATA_DIR` only). **NOT RUN ON RAILWAY** = nothing here was ever run against the live service or its volume; how the checkout and the volume are reached there is Isabelle's to know. `$D` is the data dir (`DATA_DIR`, else `RAILWAY_VOLUME_MOUNT_PATH`, else the repo root).

| # | Step | Command | Mark |
|---|---|---|---|
| 1 | Back up | `cp -a "$D" ~/ping-export/data-before-zero` | REHEARSAL; NOT RUN ON RAILWAY |
| 2 | Export balances (read-only, server may be up) | `node tools/export-balances.js --ledger "$D/money.jsonl" --accounts "$D/accounts.json" --csv ~/ping-export/balances-before-zero.csv --json ~/ping-export/balances-before-zero.json` | REHEARSAL; NOT RUN ON RAILWAY |
| 3 | Stop the server (SIGTERM; section 1 "Stop") | `kill -TERM <pid>` (on Railway: stop the service the normal way) | REHEARSAL (`kill -TERM`); NOT RUN ON RAILWAY |
| 4 | Move the money files aside, bank.json = {} | the `Z=...; for f in ...; do mv -v ...; done` block and `echo '{}' > "$D/bank.json"` of section 10 step 3 | REHEARSAL; NOT RUN ON RAILWAY |
| 5 | Start the server as usual | `node server.js` (Railway: `railway.toml` start command) | REHEARSAL; NOT RUN ON RAILWAY |
| 6 | Boot lines that must show | `migration: N accounts, N writes (N written, 0 dup), orphans 0, rejected 0` (N = the number of kept accounts), `boot recovery: 0 seats, 0 pots returned`, `Ping Poker server running on port ...`; must NOT show `QUARANTINED`, `CONFLICTS`, `fresh start` | REHEARSAL; NOT RUN ON RAILWAY |
| 7 | The one command that proves Cash is 0 | `node tools/export-balances.js --ledger "$D/money.jsonl" --accounts "$D/accounts.json" --csv /dev/null --expect-zero cash` (exit 0 and `expect-zero (cash): OK`; exit 4 = some account is not 0) | REHEARSAL; NOT RUN ON RAILWAY |
| 8 | Two more zero proofs | `grep -c "mint:migration" "$D/money.jsonl"` and `grep -c '"cur":"play"' "$D/money.jsonl"`, both print 0 | REHEARSAL; NOT RUN ON RAILWAY |
| 9 | Admin sets each player's Cash | Admin page > Players > Set Cash (the TOTAL, CSV cents / 100); section 3 | REHEARSAL (as the socket event); NOT RUN ON RAILWAY |
| 10 | Check the Cash against the export | the `node tools/export-balances.js ... --csv - | cut -d, -f1,3,8` and `diff <(cut ...) <(...)` of section 10 step 5 | REHEARSAL; NOT RUN ON RAILWAY |
| 11 | Roll back if needed | section 2 steps 1-4 (`jq` list of used accounts against the old build's `SOURCE_ACCOUNTS`) | RUN on a temp sample ledger in pass 1; NOT RUN ON RAILWAY |
| 12 | Read the ledger afterwards | section 4 one-liners (`jq`, `node -e`) | RUN on a temp data dir; NOT RUN ON RAILWAY |

Not in the list on purpose: `FRESH_START_ID` (the wipe-all variant, section 10 "Not chosen"), and the Chips question (ZS-1).
