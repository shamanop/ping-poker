# FB1 state

## FOR FRANK (lead 4, INTERIM 19:15 CDT; final version replaces this block when the drivers and the shaman after-run are in)
- Branch coldcall-fb1 HEAD = **7a57245** = merge of coldcall-pull 4713970 into e222f6a. Commits since lead 3: 49859c2 (fb1-perf, FB5 r1), 80fe795 (lead 4, leads count fix), e222f6a (fb1-paint, r2 CSS only), 7a57245 (merge; one conflict, pull.js two lines, resolved as the union).
- **Play copy 4655 serves 7a57245** since 19:05 (8da0c51 from 18:19 to 19:05; it was down 16:07-18:19). It now runs as systemd user unit `cc-play-4655` (own cgroup, Restart=on-failure), NOT a setsid child: the gateway restart is what killed the old one. Data: `_scratch/play-srv` (Chris: chris3929, wallet 960018, 358 rounds, leads 3704, unchanged; byte-identical copy of the original in `_scratch/play-srv-orig-1820`). No test hook. `/tmp/cc-live` removed. Move it again with `_scratch/lead4/play.sh <commit>`; stop with `systemctl --user stop cc-play-4655`.
- Verified on a slim export of 7a57245 (my runs): suites coldcall 47, pull-engine 57, pull-server 61, bender 19, coldcall-livecfg 27, coldcall-presets 20, bender-livecfg 5, all exit 0 (counts moved with coldcall-pull: 58 -> 61, new livecfg / presets files). No diff vs coldcall-pull 4713970 in games/, server.js, tests/, engine.js, wallet/accounts/ledger, shell.js; engine copy identical. Before the merge, on 8da0c51 and 80fe795: 47 / 57 / 58 / 19, no diff vs 9a02561.
- Settle-to-spin, in-page, 30 spins on 7a57245: median 4 ms, max 14 ms, 11 of 11 checks (qa/coldcall-fb1/final/fb1_lead4_7a57245.json). On 80fe795: median 7, max 16, 11 of 11.
- The 1-in-4 "leads supersede" fail is FIXED (80fe795): the count was drawn on the frame ticker, so when frames starved about 270 ms a superseded leadGain's last number stayed up. leadGain now draws its start number at once. Proof `qa/coldcall-fb1/fb1/supersede_starved.js` (frames held back 300 ms): 8da0c51 shows the old number in 2 of 5 runs (38-39 of 88 samples), 80fe795 and 7a57245 0 of 5.
- paint_shift.js on 7a57245: 42 pairs (540 / 360 / 1440, Play $ and Chips, 8 states), 0 boxes shifted. Captures: 99 shots, 0 page errors, `_scratch/lead4/shots-final/`; the best ten are committed in `qa/coldcall-fb1/final/`.
- Still running at 19:15: flow.js / f1_*.js on 7a57245 (`_scratch/lead4/legacy-final.log`; on the earlier merge object flow.js Play $ passed 8 of 8 scenarios), fb1-perf's full shaman after-run (`_scratch/fb1perf/res/after1.*`, ends about 19:40) and fb1-perf itself (uncommitted warm.js edit at 19:12). fb1-paint is finished.

## FOR FRANK (lead 3, 18:10 CDT; wave A close-out is NOT complete, hand-off: I am at my 150K context cap)
**Done and verified by me. Not done: fb1-perf has not committed; paint fix round r2 is queued, not run; play copy 4655 is down; coldcall-pull not merged in.**

Commits on coldcall-fb1 (base 9a02561): FB2 493e6d1, FB3 a9f7f4d + dc32097, FB1 68dba50, FB4 S1 7d987d0, FB4 S2+S3 174771f, FB4 S3 fixes + S4 604f800, FB4 critic r1 fixes + S5 8da0c51. HEAD of verified work = 8da0c51.

Verified on a slim export of 8da0c51 (lead 3, own runs):
- Suites 47 / 57 / 58 / 19, all exit 0. No diff vs 9a02561 in games/, server.js, tests/, engine.js; engine copy identical to games/ and to the coldcall-pull worktree copy.
- Settle-to-spin, in-page, 30 spins (qa/coldcall-fb1/fb1/fb1_lead3b.json): median 6 ms, max 15 ms; all 11 checks pass (money, settled, leads, ghost). The same driver on 7d987d0 (fb1_lead3.json): median 9, max 26, 10 of 11; the forced "leads supersede" display check failed once there (old number shown in 26 of 81 samples) and passed on the re-run and in lead 2's two runs. Reading: frame starvation on a loaded box, display only, no money. 1 fail in 4 runs: not closed.
- Own capture, 36 shots at 540x960 / 360x740 / 1440x900, Play $ and Chips: `_scratch/lead3/shots2/` (previous build: `_scratch/lead3/shots/`). Strip 30 / 20 / 28.1 px. No capture errors. No symbol covered (my eye + both critics). The builder's committed A/B shots: qa/coldcall-fb1/paint/s1..s5.
- paint_shift.js: s2 45 pairs 0 shifted (my run). s3 was 11 shifted mid-work (all #plmo, the animated outcome card); the builder reports 0 after 604f800. I did NOT re-run it on 8da0c51.

Painted (GPT, 5 sheets): status bars red/gold, leads strip, sticky, leaf, lcd; all buttons incl. HANG UP / ONE MORE CALL, buy cards, keypad keys + plate; speech bubble; toast / outcome sticky, card panels, big-win backdrop; r1: brass plates (WIN / POT / SPINS LEFT / BONUS TOTAL), keypad frame, buy panel, strip repaint, active mode tab.
Opus critics (both confirmed `cli exec ... model=claude-opus-5-5`: r1 run 7b0782b9 at 17:13:17, r2 run ed575704 at 18:01:48):
- r1 on 174771f: symbol cover PASS, strip PASS, 1440 stretch PASS, text fit at 360 FAIL.
- r2 on 8da0c51: same three PASS, text fit at 360 still FAIL. Of nine r1 items: 2 fixed (plates, small glyphs), 6 partly, 1 not (countdown block). r1 fixes ADDED defects: info-panel corner ornaments cover content ('202' cut to '20'), plate labels on the brass lip unreadable at 360, NOT NOW overlaps the buy frame corners, slice line in the i / MUSIC pills.
- Fix round r2 (the last allowed) is QUEUED to fb1-paint, CSS only, no paint calls: `_scratch/lead3/msg-paint-r2.txt`. It was not run or re-checked by me.
Still CSS: mode-tab bar and inactive tab, countdown block, HANG UP progress line, APPT card, keypad key well + THE NUMBER readout, info pay-table rows, bubble tail.

FB5 lag: fb1-perf (transcript f3b4b58d) is still running after 105 min, uncommitted: warm.js (new), boot.js, fx.js, assets.js, style.css, fps rig. Its last quick numbers (first encounter, shaman): 10 spins worst 100 -> 33 ms (1 frame over 33), bonus intro 0-1 frames over 33, big-win card still 2 frames of 50-67 ms. NOT trustworthy as stated: from 16:41 its "export" runs on port 4651 hit fb1-paint's live-worktree server (its own server failed with EADDRINUSE). No full after-run exists. My lead-change message (stop tracing, one after-run on 4653, commit, report to `_scratch/lead3/perf-report.md`) is queued behind its turn.

Builders: never cancelled. A live claude-cli run cannot be steered: `gateway call sessions.send` returns "started" and the text never arrives; `gateway call agent` queues a turn that starts when the current one ends (worked for paint at 17:23, in a NEW transcript d7ce3639). `_scratch/lead3/poll.sh` shows both.

Credit: both numbers were right. Account used 24.55 -> 29.30. `projects/ping-ui` cost logs on the same key: $3.87 (concepts 0.90, tables 1.61, looks 1.36). This wave, spend.jsonl: $0.89 (S1 0.19, S2 0.18, S3 0.18, S4 0.15, S5 0.19). 3.87 + 0.89 = 4.76 = the account drop. Wave cap $6: $0.89 used. Usable now $5.70.

Not done, for you or the next lead:
1. **Play copy 4655 is DOWN** since about 16:07 (pid 1149085 gone, the gateway restart time). Chris's data is intact in /tmp/cc-live/_srv. I did not restart it. 8da0c51 passes suites and the timing driver; the 360-wide text-fit defects above are in it.
2. `git merge coldcall-pull` (b596408) into coldcall-fb1: dry-run merge-tree at 174771f had no conflicts. Not merged, suites not run on the merge.
3. Collect fb1-perf's commit + report, then re-run suites and the timing driver on that commit (it edits boot.js / fx.js / assets.js / style.css).
4. Collect fb1-paint r2, re-capture, check info / more / buy_menu at 360; no third critic round is allowed by the brief.
5. Not checked by anyone this wave: flow.js / f1_*.js drivers on the painted build, the blind judge vs Bender, 4x-throttle after numbers, first-load weight after.
6. My server on 4652 (pid in `_scratch/lead3/srv-4652.pid`) serves 8da0c51 with the test hook on: kill it when done. fb1-paint's server on 4651 and the baseline on 4650 are theirs.
Wave B: FB6 graphics / motion loop, remaining paint (list under "Still CSS"), FB5 to the bar with a real after-run, blind judge.

## FOR THE LEAD: image credit (Frank, 2026-10-06 14:43)
- The top-up LANDED: `~/.openclaw/credentials/openrouter.key` account now has $10.45 (total 35.00, used 24.55). The "stop when the credit runs out" limit in the brief is lifted: paint the whole FB4 list (status bar + leads strip, all buttons, speech bubbles, then the plates, plaques, cards and info panel).
- Use this key only. Isabelle's key ($0.42) and OpenAI direct (empty) are not needed.
- Budget for the wave: up to $6 without asking; keep $4 in reserve for wave B repaints. Still log every call in `cold-call/art/redesign/spend.jsonl` and check the balance before each call.

## Lead 2 log (coldcall-fb1-lead2, started 16:15 CDT)
- Committed: FB2 493e6d1, FB3 a9f7f4d + dc32097, FB1 68dba50 (spin never waits for leads note / ghost; in-page accept delay median 720 ms -> 9 ms, max 1225 -> 37, 30 spins; money/settled/leads checks hold; before-shots, Bender refs, FB5 rig + before run).
- FB5 before (shaman RTX 5090, 1440x900): steady state 60 Hz in every scene, p95 16.8, 0 frames >33 ms; only FIRST-ENCOUNTER hitches (spin 100 ms x3, bonus intro 117 ms x3, big-win card 50 ms x2). So "laggy" = mostly the 720 ms blocked SPIN (fixed) + cold decode hitches + oversized images.
- Running children (16:20): fb1-paint (agent:main:dashboard:62f85f19-6069-4fd9-98ce-0011d5027519): verify S1, paint S2 buttons, S3 bubbles, S4 plates, budget $4.50 more; fb1-perf (agent:main:dashboard:1a106317-41eb-432a-964c-2395dc64ac4e): first-encounter hitches, resample oversized images, rig re-run.
- Uncommitted (fb1-paint owns): paint.css, index.html (paint.css link), assets/symbols.json, assets/img/ui/, cold-call/art/paint/, redesign/paint_*.py, spend.jsonl.
- Image credit: usable $6.74 at 16:15 (spent 0.19 on S1 this wave).

## FRANK NOTE 18:43 CDT (for lead 4 and the watch)
- I killed `node qa/coldcall-fb1/shots.js http://127.0.0.1:4651 _scratch/fb1perf/shots-after` (pid 1411039, started by `_scratch/fb1perf/shots.sh`). Its loop had finished (report.json written 18:40:22, all 33 shots `ERR_CONNECTION_REFUSED`: nothing listens on 4651 any more), but it hung holding 33 browsers and the chrome.lock. Box was at 141 MB free RAM with swap full; after the kill 5.2 GB free and the queued flow.js got the lock. No builder session was cancelled.
- BUG in shots.js: when `page.goto` throws inside `open()`, `b` is never assigned, so `finally { if (b) await b.browser.close(); }` leaks one browser per failed shot. Check the port answers (curl) before any shots.js run, and fix `open()` to close its browser on failure when you next touch it.
- The perf after-shots therefore do NOT exist; `shots-after/report.json` is 33 failures from a dead port, not a build defect.
- Disk: 11 GB free after I purged the pip and uv caches (was 6.2 GB). Keep exports slim and delete your own /tmp copies.
