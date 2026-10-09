# PROGRESS-MONEY-1008.md: money + slots hardening, hand-off to Isabelle

First written 2026-10-09 02:30 CDT by Frank (main session) on Chris's word "send to isabelle" (02:28), sent early. This version: 03:26 CDT, after the full run finished.
Branch `money-hardening`, on top of live `master` `cfa2ff8` (fetched 03:26, still an ancestor: a fast-forward). 260 commits.

## STATUS: READY. The full run on the final product code is green.

- Step G = the full run, one item at a time, on a clean export of `83144ce`. Product code of `83144ce` and of this head is the same: `git diff --name-only 83144ce HEAD` lists `.md` files only.
- Every item exit 0 (the lead's script `stepG.sh`; summary and item logs read by Frank):

| Item | Result | Finished |
|---|---|---|
| `npm test` | exit 0; kit 104 pass, 0 fail, 2 skip | 02:23 |
| `node tests/run-money-1008.js --rest` | exit 0; 21 files | 02:45 |
| `npm run test:money` | exit 0; 59 files | 02:51 |
| `tests/v2/10_fuzz.js` alone | exit 0 | 02:53 |
| v2 batch (`tests/v2/run.js --jobs 1`) | exit 0; 168 checks: 168 pass, 0 fail (518 s) | 03:01 |
| soak with 3 kills (`tests/soak/soak.js --seed 7 --minutes 1.5 --kills 3`) | exit 0; CLEAN, 291 steps, 3 kills, 297 checks | 03:03 |
| storm, 18 cases | exit 0 each; each log ends `== case <name>: ok` | 03:06 |
| `tests/soak/prove.js` | exit 0; `PROOF OK`: the clean soak passed, 23 of 23 seeded bugs caught | 03:25 |

- To run `npm test` yourself: `ADMIN_CLAIM_PASSWORD` must be UNSET in that shell (`tests/accounts.js:106` asserts the unset case). With a deploy env exported you get one red test that is not a fault. The soak and storm items need it SET.

## GO-LIVE (Chris 2026-10-08 22:31: Isabelle pushes master AND runs the zero step)

Everything is in `RUNBOOK.md`. Nothing below was ever run on Railway, and nobody in this job has seen the live data or the Railway variables.

0. **Until the deploy, on LIVE** (stopgaps given during the night, for faults that are in the code live today): no Set Cash on a player who is seated or mid-round; Set Cash only on names whose row says claimed; no Cash poker tables with anyone not trusted; do not change Cold Call `pull.list` / `pull.fill` by live config.
1. **Railway variables** (`RUNBOOK.md` section 1, "Env vars that matter"): `NODE_ENV=production`. NOT set: `RIG`, `SIGNUP_PLAY_CENTS`, `AUTH_CLOCK_SKEW`, `COLDCALL_TEST`, `CAMPAIGN_TEST`, `FRESH_START_ID` (it is the wipe-everything variant Chris did not choose), `COLDCALL_JOURNAL_MAX`, `BB_CFG`. `ADMIN_CLAIM_PASSWORD` (8+ characters, not the room word) only if the admin account `chris` is not claimed yet. `BENDER_ADMIN_TOKEN` long and random; its limiter counts the TCP peer address, so behind Railway's proxy five wrong tries by anyone may lock the two config routes for 10 minutes (not confirmed either way).
2. `RUNBOOK.md` section 1, "Before a deploy, a minimum", steps 1-6. The checks on LIVE data:
   - step 3: look at the live `bender-config.json` (RVC-4).
   - step 5: `jq -c '(.batch // [.])[] | select(.amount > 1e12)' money.jsonl | wc -l` must print 0 (RV-2).
   - step 6: the Cold Call list gate (RL2-1, open on purpose; see Findings).
   - also: look in the live `accounts.json` for records without their own `pinHash` / `claimed` fields (R2B-1, told to you 19:05).
3. `RUNBOOK.md` "Fresh start at zero" (Chris chose: KEEP names + PINs, ZERO the money). The command list is section 11, rows 1-10. In short: back up, export balances, stop, move the money files aside, **write `{}` to `bank.json` (row 4, not optional: without it the boot copies the repo's `bank.json` back in)**, **`node tools/zero-game-state.js --data-dir "$D" --zeroed-dir "$Z" --apply` (row 4b, do not skip: without it a stored Cold Call Callback pays Cash after the zero)**, start, read the boot lines (row 6), `--expect-zero cash` (row 7).
4. Keep the export file (row 2): Chris sets each player's Cash from it by hand (rows 9-10).
5. The first boot after the deploy is ONE full replay of the ledger: slow on a big file, not an error. A deploy in the middle of a poker hand voids that hand (stacks go back).
6. After the deploy: reload any open admin tab (RVP-2). Fund only names that have a PIN: Set Cash refuses to raise an unclaimed account. Set Cash is the player's TOTAL Cash.
7. First boot of this build LOCKS accounts that have no PIN and hold Cash (section 11, last paragraphs). If the money is zeroed before this build's first boot, none hold Cash. If this build boots on the old data first (a push to `master` restarts the server at once), expect the `[SECURITY] accounts: N existing UNCLAIMED` line; the admin then resets those PINs. In that case the RL2-1 gate is also live from the deploy until the zero step is run.
8. Rollback: `RUNBOOK.md` section 2, its step 1 first (the list of non-player accounts the journal uses against the old build's list). This head adds no account to the lists of live `master` `cfa2ff8` (the doc builder's sample run, `RUNBOOK.md` section 2), so a rollback to `cfa2ff8` passes that step as far as this branch goes; a build older than `bb298d2` does not know `house:campaign`.

## What was tested, and on which build

Product code has not changed since `b85121e` (01:50). After it: `.md` files and two test files only (`git diff --name-only b85121e HEAD`).

| What | Result | Build | Who counted |
|---|---|---|---|
| Step G, 8 items | all exit 0 (table above) | export of `83144ce` | the lead's script; summary + item logs read by Frank |
| Cold Call play-through, 4 cells (Chips + Cash, 360 + 1440) | 228 rounds, 0 fails | product `b85121e` | agent; re-counted by the lead 02:30 (4 x 60 rows, 0 not-ok, 0 mismatches) |
| Cold Call list-swap cell | 9 rows, 0 fails | product `b85121e` | agent; re-counted by the lead |
| Poker + Ballot Bender short cells | 0 fails, 360 wide only | product `b85121e` | agent; re-counted by the lead |
| Campaign play-through, 4 cells | 170 paid rounds + 16 mode-flip rows, 0 fails | `3074b04` | agent; re-counted by the lead 23:53 (186 rows). NOT re-run on the final head: no Campaign game file, nothing in `money/`, `transport/` or `server.js` changed since. What did change since: Ballot Bender and Cold Call game files, `admin/index.js` (8 lines), `package.json`, `public/index.html` (1 line), the new `tools/zero-game-state.js` |
| Boot on an old (un-zeroed) ledger copy | pass | export of `83144ce` | the lead. Not covered: open escrows, seated stacks, Cold Call state, the Railway volume, a lock held by a live process |

Never exercised in a browser: a Cold Call Callback round (it never armed), the new-day streak pop-up, a spin on a page left open across a list swap, two tabs of one player in different currencies. The 1440-wide poker and Ballot Bender cells were last run on product code `1bb821f`, not on the final head.
Never run at all: anything on Railway; any check on the live journal, `accounts.json` or config files; two server processes on one data dir (the ledger has a lock, `campaign.json` and `coldcall-pull.json` have none).
Not logged: the lead's own proof re-runs for the ten rows merged around 18:15 (K3-1b, K3-8, K3-9, K3-C2, K3-G1, K5-2, K5-3, K5-F, K2-3c, K2-Cdisk; that run wrote no log line). Their test files ran exit 0 in step G (`test:money` item log, read by Frank).

## Findings

`MONEY-FINDINGS-1008.md` has every row (what, proof, fix commit, test). Its section 5 is the list of what is NOT fixed. The open ones where money can move:

- **RL2-1** (admin only; no player can cause it; the code live today pays the same or more): if an admin accepts a shorter Cold Call list while an old unstamped record exists, that player gets a Callback he did not earn. $34,177.50 on 12 Callbacks at the $25.00 bet in the lead's run. Zero-step row 4b removes every unstamped CASH record, so nothing is left to act on in Cash; Chips records may stay unstamped (no money). Until row 4b is run: do not change the Cold Call list.
- **RV-C1** (a player with two tabs; read only, never run): a Cash round opened in another tab moves this tab to Cash and it sticks, so a tab the player left in Chips stakes Cash on its next bet. His own Cash, his own bet; no mint.
- **RV-3** (review r2a-headsup; host of a table of two): a kick between hands makes the kicked player the big blind every hand when he sits back (8000 against 4000 over 40 hands in the reviewer's proof). The lead's rule "a kick keeps the debt" stands unless Chris changes it.
- **RL2-2, RL-3, RL-5, RW-5, RVP-5**: noted, not fixed. RL-3 and RW-5 need a damaged data file; RVP-5 is an admin saving a Set Cash box that is one pot old (the confirm line shows the newest total).
- **`.github/workflows/deploy.yml` runs no test before `railway up`** (K4-5): yours.
- RV-4 (review r2a-headsup): a player cashed out below the table minimum cannot sit back from the browser. No money moves.

## Needs Chris

1. **ZS-1:** the fresh start gives every kept account 10,000 Chips, not 0. Accept, or change it (RUNBOOK "Open decision ZS-1").
2. **Wording:** the Ballot Bender footer "Free play only. No real money, no prizes." (LEGS-B1) and the Cold Call line "Chips have no cash value." shown in Cash mode too (LEGS-CC-W1) are unchanged.
3. The live site address, and Cash on one test account, for Frank's test after the deploy.
4. Rules the lead set during the night; each is in force on this branch and changes how the game plays. Say so if any is wrong:
   - A kick or a leave never changes a live hand; a pause asked for mid-hand starts when the hand has settled (K3-1, K3-4).
   - A seat back from sit-out is dealt in when the big blind reaches it; the blind debt belongs to the player at that table; a kick keeps the debt (K3-8, R2A-1, R2A-2, RR-1).
   - A Cash table always has a turn clock of 15 s or more (K3-9).
   - Re-entry at a no-rebuy table: one return, for at most what the server cashed out (K3-5, R2A-3, R2A-4).
   - Side pots: a top bet nobody matched goes back to its owner, also after his own fold (K3-2, K3-3).
   - Set Cash sets the player's TOTAL Cash; refused below the part at a seat or in a round; refused to raise a name with no PIN (K1-2, R2B-6, R3AB-2).
   - A PIN change signs out every other socket of the account, a second tab of the same browser too (K6b-1).
   - A damaged `accounts.json` is never read as empty: the `.bak` is loaded, or the server does not start (R2B-4).
   - A live slot config above 100.0% payback (measured + 3 standard errors) is refused; near-shipped numbers can be refused on a slow box (K4-1, R2C-3).
   - A Cold Call config change never changes the share of a Callback a player holds; a Campaign run settles on the map it started on (R3C-1, K5-2).

## After the deploy

Frank plays all four games on live in Chips and checks sign-in and balances. Cash paths wait for item 3 above.
