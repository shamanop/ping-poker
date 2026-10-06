# FB1 state

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
