# FB1 state

## FOR FRANK (lead 3, interim 17:25 CDT; the final version replaces this block)
- Leads 1 and 2 are dead. Lead 3 = agent:main:dashboard:dba33ab7-3e17-4a11-b30c-c3a567a50941. Both builders are alive and were never cancelled. A live claude-cli run cannot be steered (gateway `sessions.send` returned "started" but the text never reached the run); `gateway call agent` QUEUES a turn behind the running one. Queued: fb1-paint = lead change + critic r1 fix list; fb1-perf = lead change (stop tracing, one after-run, commit, report). Their reports land in `_scratch/lead3/paint-report.md` / `perf-report.md`. Live progress: `_scratch/lead3/poll.sh` (reads the CLI transcripts ac4b6338 = paint, f3b4b58d = perf).
- **Chris's play copy on 4655 is DOWN** (nothing listens; pid 1149085 from /tmp/cc-live/_srv/pid is gone; last write 16:07, the time of the gateway restart). His data is intact in /tmp/cc-live/_srv. Not restarted by me yet.
- Commits on coldcall-fb1: FB2 493e6d1, FB3 a9f7f4d + dc32097, FB1 68dba50, FB4 S1 7d987d0, FB4 S2+S3 174771f. Uncommitted: fb1-perf's warm.js / boot.js / fx.js / fps rig; fb1-paint's S4 + outcome-card work in paint.css.
- Verified by lead 3 on a slim export: suites at 7d987d0 47 / 57 / 58 / 19, exit 0; engine copy identical to games/ and to the coldcall-pull worktree copy; settle-to-spin in-page, 30 spins: median 9 ms, max 26 ms; money / settled / leads / ghost checks pass; 1 of 11 checks failed (forced "leads supersede": the note showed the older number in 26 of 81 samples after the newer leadGain started; passed in lead 2's two runs; display only, no money; not yet re-run).
- Painted and looked at by lead 3 (own capture of 174771f, 54 shots, `_scratch/lead3/shots/`): strip 30 / 20 / 28 px at 540 / 360 / 1440, no symbol covered, no capture errors.
- Opus critic r1 (run 7b0782b9, `cli exec ... model=claude-opus-5-5` confirmed 17:13:17): no symbol covered PASS, strip PASS, no stretch at 1440 PASS, text fit at 360 FAIL (HANG UP / ONE MORE CALL text on the bottom bevel). Still reads as CSS: leads strip, mode tabs, WIN / POT / SPINS LEFT / BONUS TOTAL plates, countdown block, keypad frame + YOU DIALED / FREE SPINS boxes, buy / confirm / info panel backgrounds. Full list: `_scratch/lead3/msg-paint-r1.txt`.
- Credit: both numbers are right. The account counter (used 24.55 -> 28.62 = $4.07 by 16:45) is the whole account; `projects/ping-ui` cost logs add up to $3.52 on the same key (concepts 0.90, tables 1.61, _scratch/looks 1.01) and this wave's spend.jsonl is $0.56 (S1 0.19, S2 0.18, S3 0.18): 3.52 + 0.56 = 4.08. Usable 17:15: $6.03 (another $0.35 went since 16:45 with no FB1 paint call logged: not this wave as far as the log shows).
- Dry-run `git merge-tree HEAD coldcall-pull` (b596408): no conflicts. Not merged.

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
