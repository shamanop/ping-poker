# PROGRESS-MONEY-1008.md: money + slots hardening, hand-off to Isabelle

Written 2026-10-09 02:35 CDT by Frank (main session) on Chris's word "send to isabelle" (02:28).
Branch `money-hardening`, on top of live `master` `cfa2ff8` (fetched 02:33, still an ancestor: a fast-forward). 257 commits.

## STATUS: SENT EARLY. THE FINAL TEST RUN IS NOT FINISHED.

- The first line of this commit does NOT start with the READY words, on purpose (your rule: only when everything is tested).
- Step G (the full run on the final head) started 02:17. Done so far: `npm test` exit 0 (kit 104 pass, 0 fail, 2 skip). Still running: `run-money-1008 --rest`, `test:money`, fuzz alone, the v2 batch, soak with kills, storm, `prove.js`.
- When step G is green, one more commit lands whose subject starts with the READY words, and the table below is filled in. If step G finds a fault, a fix commit comes first.
- **Recommended: review now if you want, push `master` only after the READY commit.**

## GO-LIVE (Chris 2026-10-08 22:31: Isabelle pushes master AND runs the zero step)

Everything is in `RUNBOOK.md`. Nothing below was ever run on Railway.

1. `RUNBOOK.md` section 1, "Before a deploy, a minimum", steps 1-6. The three that are checks on LIVE data:
   - step 3: look at the live `bender-config.json` (RVC-4).
   - step 5: `jq -c '(.batch // [.])[] | select(.amount > 1e12)' money.jsonl | wc -l` must print 0 (RV-2).
   - step 6: the Cold Call list gate (RL2-1, open on purpose). The fresh start step 3b below removes it.
2. `RUNBOOK.md` "Fresh start at zero" (Chris chose: KEEP names + PINs, ZERO the money). The command list is section 11, rows 1-10. In short: back up, export balances, stop, move the money files aside, **`node tools/zero-game-state.js --data-dir "$D" --zeroed-dir "$Z" --apply` (row 4b, do not skip: without it a stored Cold Call Callback pays Cash after the zero)**, start, read the boot lines (row 6), `--expect-zero cash` (row 7).
3. Keep the export file (row 2): Chris sets each player's Cash from it by hand (rows 9-10).
4. After the deploy: reload any open admin tab (RVP-2). Fund only names that have a PIN: Set Cash refuses to raise an unclaimed account.
5. First boot of this build LOCKS accounts that have no PIN and hold Cash (section 11, last paragraphs). If the money is zeroed before this build's first boot, none hold Cash. If this build boots on the old data first (a push to `master` restarts the server at once), expect the `[SECURITY] accounts: N existing UNCLAIMED` line; the admin then resets those PINs.
6. Rollback: `RUNBOOK.md` section 2.

## What was tested, and on which build

Product code has not changed since `b85121e` (01:50). After it: four `.md` files and two test files only (`git diff --stat b85121e HEAD`).

| What | Result | Build | Who counted |
|---|---|---|---|
| Step G item 1, `npm test` | exit 0 | export of `83144ce` | the lead's script, summary read by Frank |
| Step G items 2-8 | RUNNING at 02:35 | export of `83144ce` | not yet |
| Cold Call play-through, 4 cells (Chips + Cash, 360 + 1440) | 228 rounds, 0 fails | product `b85121e` | the agent's count; NOT yet re-counted by the lead |
| Cold Call list-swap cell | 0 fails | product `b85121e` | the agent's |
| Poker + Ballot Bender short cells | 0 fails, 360 wide only | product `b85121e` | agent, re-counted by the lead |
| Campaign play-through, 4 cells | 170 rounds, 0 fails | `3074b04` | the agent's. NOT re-run on the final head: no Campaign game file, nothing in `money/`, `transport/` or `server.js` changed since |
| Boot on an old (un-zeroed) ledger copy | pass | export of `83144ce` | the lead. Not covered: open escrows, seated stacks, Cold Call state, the Railway volume, a lock held by a live process |

Never exercised in a browser: a Cold Call Callback round (it never armed), the new-day streak pop-up, a spin on a page left open across a list swap.

## Findings

`MONEY-FINDINGS-1008.md` has every row (what, proof, fix commit, test). Section 5 is the list of what is NOT fixed. The ones that matter at go-live:

- **RL2-1** (admin only, mints Cash; the code live today pays the same or more): the deploy gate in step 1 above. Gone once step 3b is run.
- **RL2-2, RL-3, RL-5**: noted, not fixed.
- **`.github/workflows/deploy.yml` runs no test before `railway up`** (K4-5): yours.
- RV-3 (heads-up kick), RV-4 (sit back after a cash-out below the minimum): open, low.

## Needs Chris

1. **ZS-1:** the fresh start gives every kept account 10,000 Chips, not 0. Accept, or change it (RUNBOOK "Open decision ZS-1").
2. **Wording:** the Ballot Bender footer "Free play only. No real money, no prizes." and the Cold Call line "Chips have no cash value." (shown in Cash mode too) are unchanged.
3. The live site address, and Cash on one test account, for Frank's test after the deploy.

## After the deploy

Frank plays all four games on live in Chips and checks sign-in and balances. Cash paths wait for item 3 above.
