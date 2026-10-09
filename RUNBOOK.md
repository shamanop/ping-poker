# RUNBOOK.md: operating the money system at 2 a.m.

Written for `money-hardening` (2026-10-08): read at `69a44f6`, line cites rechecked after the merges up to `057a243`. `MONEY-SYSTEM.md` explains what the parts are; this file is what to do. The shell one-liners below were RUN by me against a 14-line sample ledger made with the real service (`_scratch/money/fix-docs/runbook-sample-ledger.js`) in a temp dir. They were not run against the live site, whose data I cannot reach.

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
| `NODE_ENV` | `production` | Anything else turns on `COLDCALL_TEST` / `CAMPAIGN_TEST` if those are set (below). Cash rounds ignore the force hooks either way (Chips only), but a hook that is on is an unneeded risk. |
| `RIG` | **unset** | `RIG=1` registers `__rig` and `__audit` for ANY socket, signed in or not, with no `NODE_ENV` check (finding FOUND-1): a stranger can queue the decks and read all balances. Never set on Railway. |
| `SIGNUP_PLAY_CENTS` | **unset** | Any number mints that much Cash for every new account at signup, also in production (`server.js:28`; finding SVC-1, open). Unset = 0 Cash. |
| `COLDCALL_TEST`, `CAMPAIGN_TEST` | unset | `=1` outside production turns on the QA `force` hook (`games/coldcall.js:26`, `games/campaign.js:28`), logged as `*** QA FORCE HOOK IS ON`. Chips rounds only. `CAMPAIGN_IDLE_MS` shortens the idle timer under the same switch. |
| `ADMIN_CLAIM_PASSWORD` | 8 or more characters (after trimming), not the room word `ping` (any case) | Unset, shorter, or equal to the room word = the admin account `chris` cannot be claimed (fail closed, `accounts.js:52-54,197`); the boot log says so (`accounts.js:361`). It is used only while `chris` is unclaimed: an already-claimed admin signs in with the PIN. Set it, restart, claim `chris` once, then the value no longer matters for login. |
| `BENDER_ADMIN_TOKEN` | a long random value | Unset = the live-config routes `/api/admin/bender-config` and `/api/admin/coldcall-config` always answer 403 (`server.js:93`). Wrong tokens: `ADMIN_WRONG_TOKEN_MAX` (default 5) wrong tries from one address inside `ADMIN_WRONG_TOKEN_WINDOW_MS` (default 600000) lock that address out with 429 until the window moves on; one log line per refusal; the token is never logged (`server.js:101`). |
| `RAILWAY_VOLUME_MOUNT_PATH` or `DATA_DIR` | the mounted volume | Neither set = data files live in the code directory and are lost at the next deploy, including `money.jsonl`. A first boot on an empty directory starts with no Cash for anyone (`tools/migrate-v2.js` mints none since 5922b5e) and 10,000 Chips each. A first boot with an OLD `wallet.json` / `bank.json` in the directory copies their rows into the ledger once as `mint:migration` (`mig:play:<name>`, `mig:...`, `tools/migrate-v2.js:105-113`): that is real Cash created from a file. Never put an old `wallet.json` into a data dir. |
| `FRESH_START_ID` | **unset** | A value not yet used moves EVERY data file to `backup-<id>/` and starts empty (`transport/boot.js:25-44`; a marker `.fresh-<id>` stops a repeat). Only when the data dir is not the code dir. |
| `LEDGER_CKPT` | unset (on) | `0`/`false`/`off`/`no` turns the boot checkpoint off: every boot is a full replay. `LEDGER_CKPT_VERIFY=1` makes every boot replay in full AND compare; `LEDGER_CKPT_EVERY=n` writes a checkpoint every n lines; `LEDGER_WINDOW` (default 20000) is the number of lines kept in memory. |
| `MONEY_FILE`, `BANK_FILE`, `WALLET_FILE`, `ACCOUNTS_FILE`, `TABLES_FILE`, `STACKS_FILE`, `LEDGER_FILE`, `BIGWINS_FILE`, `COLDCALL_PULL_FILE`, `COLDCALL_CFG_FILE`, `BENDER_CFG_FILE`, `CAMPAIGN_FILE` | unset | Move one file away from the others (`transport/boot.js:10-22`). `MONEY_FILE` defaults to `money.jsonl` next to `bank.json`. |
| `PORT` | set by Railway | default 3000. |
| `HAND_DELAY_MS`, `TABLE_EMPTY_MS`, `AUTH_CLOCK_SKEW`, `AUTH_SIGNUP_LIMIT`, `LEGACY_IMPORT_FILE` | unset | Test and tuning: hand delay, empty-table timeout, a shift of the auth clock (never in production), signups per address per hour (default 40), a one-time chips history file. |
| `CC_MAX_THREADS`, `BB_CFG` | unset | Simulation only. `BB_CFG` (JSON) overrides the Bender engine config used by `games/bender-rtp.js`, which the live-config check measures with: do not set it on the server. |

**Before a deploy, a minimum**
1. Copy `money.jsonl` (and `accounts.json`, `campaign.json`, `coldcall-pull.json`) off the volume. `money.jsonl` only grows, so a copy is an exact backup up to that moment.
2. Compare the money accounts: the old build must know every non-player account the file already uses (section 2, step 1). Compare against the build that is live now, not against this file.
3. Run the suites named in the lead's hand-off (`MONEY-FINDINGS-1008.md` lists a regression test per fix). I do not list commands here that I did not run.

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
- X is a whole number of cents, at most 100,000,000,000 (`admin/index.js:4`). Not a number or out of range = `range`.
- The admin console's Chips "bank" edit is a signed delta against the bank (`admin_adjust`, `cur: 'chips'`); Chips at tables are not touched. The server also accepts `admin_adjust` for Cash as a signed delta from a crafted client; the console does not offer it.
- No op id = refused (`op_required`). A repeat of the same click = `dup`, nothing written. The same op id with another amount = `ref_conflict`.
- Check it afterwards: `jq -c 'select(.ref|startswith("adj:ann:"))' money.jsonl | tail -3`. The reason carries the target: `admin:admin set play to 100000`.

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
