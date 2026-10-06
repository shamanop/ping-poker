# P5 sweep progress (lead: Sonnet 5.5)

## Hand-off block (read this first; update it every step)
- Repo `repo/` branch `v2-core`; sweep files in `tests/e2e/sweep/` (lib.py, botd.js bots daemon, audit.js, server.sh, s01..s10 scripts, defects.json -> mkqa.py -> `repo/QA-FRANK.md`, shotmap.json -> collect_shots.py -> `qa/v2-sweep/`).
- Servers: `PORT=4701 HAND_DELAY_MS=5000 tests/e2e/sweep/server.sh` (the sweep server, chris claimed via `node tests/e2e/claim.js chris` with E2E_BASE=http://127.0.0.1:4701), 4700 = the e2e re-run server (fresh, funded accounts chris ua1-3 by1-6), 4702 = bender-config server with BENDER_ADMIN_TOKEN=sweeptoken. Never 4610/4630/4640. Data dirs are in /tmp (mktemp), print on start.
- Do NOT run wrong-PIN tests against a server you still need: the sign-in lockout is per IP, escalates (30 s -> 930 s) and also blocks sign-ups.
- Run a script: `E2E_BASE=http://127.0.0.1:4701 python3 tests/e2e/sweep/s02_hands.py desk chips` (view desk|phone, mode chips|play). Each prints checks and a summary line; shots go to `runs/shots/` (outside the repo), `-s.jpg` = small copy safe to Read.
- Defects: see QA-FRANK.md (generated; edit defects.json, run `python3 tests/e2e/sweep/mkqa.py` and `collect_shots.py`, commit named paths only).
- Phone (390) cannot be played (Q02), so phone coverage is geometry only (offscreen() in lib.py).
- WAVE 1 MERGED AND VERIFIED (lead 2, 08:5x): p5-fix-a (3db2177, tests 5faf7a7) and p5-fix-b (c7b07dd, tests 73b350d) merged into v2-core (aea1862, bfbf029). Verified on the merged tree: 30_shapes 42/0, money 90/90, engine 96/96, tables 128/128, full `node tests/v2/run.js --jobs 1` 150/150 (lead2.json), fix_a_leave chips+play 23/0, fix_b_labels 22/0, s01 10/0, s02 chips+play 56/0, s03 24/0 (script patched: the 8-seat submit now succeeds, form reopened), s05 13/0, s06 chips 16/0, s06b 17/0, s06c 12/0, s07 chips 22/0. Fixed: Q01 Q03 Q04 Q05 Q06 Q07 Q08. OPEN: Q02 (phone layout, S2).
- NEXT: Q02 is the only wave-2 candidate (needs a builder + screenshot critic at 390x844; touches public/*.css only). Not started. Both fix builders (wt-fix-a, wt-fix-b) are idle/done; worktrees can be removed. Not re-run after the merge: s06 play, s07 play, s08 admin, s09 bender, s10 misc (not touched by the fixes).

## Step 2: tests/e2e/*.py against v2-core 60fbd32 (server 4700, rerun_e2e.sh)
Pass: buyin 15/0, create 23/0, host_drawer 10/0, rebuy 16/0, bender 12/0, admin 17/0, bank 14/0, showdown 10/0 (after reset), ui-audit 48/0 (after reset), games_shell bender 7/0.
Fail, both STALE SCRIPT, not client defects: `rebuy_v2.py` (chris already hosts 5 open tables from create.py, the create is refused with "Too many open tables (at most 5)", which the page shows correctly; fix = end the host's tables between proofs, see end_tables.js) and `raise.py` (the All-in preset against a calling bot loses half the time, the hero busts and the script waits for a turn that never comes; flaky by design). Earlier showdown/ui-audit/raise failures were chris left seated at 0 chips by rebuy.py (grace is 2 min, rebuy_v2 and raise run inside it).
Cold Call: not in v2-core (origin/coldcall), games_shell coldcall not run. radio / recap: only exist on the unmerged side branch combo-1006, not testable here.

## Sweep scripts and results (desk unless noted)
- s01_account: sign-up, bonus, header vs audit, sign out: pass on desk; phone stops at Sign out (off screen, Q02).
- s02_hands: foldwin foldlose showdown split sidepots allin: desk chips 56/0 (seat stacks count up for up to 0.3 s), desk play 56/0. Phone not playable.
- s03_create: form summary vs server table: pass; limits: Q06, Q07.
- s05_session: reload mid-hand, second tab take-over, transport drop and return: 13/0.
- s06_bust: bust, rebuy default, limit reached, refused while holding chips: chips 16/0, play 16/0 (conservation check relaxed for Play $ because achievement mints land in the wallet).
- s06b_leave: sit out, leave mid-hand, cash-out: chips 17/0. (Leave works only through a hidden button, Q08.)
- s06c_disconnect: disconnect on turn, clock acts, return, 2 min cash-out: see Q03 (RESUME shows a buy-in form).
- s07_host: pause/resume, blinds change mid-hand, kick mid-hand, end night + settle-up: chips 22/0; play needs the rerun with the relaxed script (net compared with the hands' own nets).
- s08_admin: bank adjust by delta, over-draw refused, Play $ set, row vs audit: 12/0.
- s09_bender: 3 spins per fund, wallet/bank/header vs audit: 43/0.
- s10_misc: bender-config verified by curl on 4702 (no/wrong token 403, right token GET 200, POST override 200, reset 200, POST without token 403); login: wrong PIN "Wrong name or PIN", lockout after 5 tries "Too many tries. Try again in 30s." (per name, escalates); reload resumes the session. The browser half of the script stops after the lockout step on a slow sign-up wait (script issue, not triaged); radio and recap do not exist in v2-core.
- s06c_disconnect (chips): turn clock acted for the absent hero at 32 s, seat kept, cashed out after 124 s with the right amount; only failure = Q03 (RESUME shows a buy-in form).
- s11_phone_geometry: 5 of 6 checks fail by design (Q02 numbers).
- s07 play: settle-up shows -$1 / +$1.50 / -$0.50 = the hands' own nets (script was double counting; fixed, rerun pending).
- Unverified suspicion (not logged as a defect): after a lockout a browser sign-up on the same IP once showed "Try again in 930s"; a node socket repro did not block a new name, so it was probably the escalating per-name lock on a reused name.

## Waves
- CORRECTION: the first wave-1 spawn FAILED in 0.5 s (OpenClaw worktree allocation refused: only 11 GiB free on / at 98%). Respawned with worktrees made by hand (`git -C repo worktree add -b p5-fix-a ../wt-fix-a v2-core`, node_modules symlinked), cwd = the worktree, no worktree flag. Respawned (accepted): A = agent:main:dashboard:b30fb1a5-daeb-438a-9577-35479d449b84 (wt-fix-a, ports 4710-4714), B = agent:main:dashboard:805e7bed-f46b-4f21-9ce9-dad9619a9c92 (wt-fix-b, ports 4715-4719). The session keys in the next line are the DEAD first attempt.
- Wave 1 spawned (visible, Sonnet default, own worktrees off v2-core 11d2618): A = agent:main:dashboard:b95ded74-f819-45d8-9934-f8c4160a0645 (branch p5-fix-a, Q03 rejoin/resume, Q08 leave control, brief builders/P5-FIX-A.md); B = agent:main:dashboard:28f4c387-db3a-4c33-a8c4-2e8e5584a0d8 (branch p5-fix-b, Q01 Q04 Q05 Q06 Q07, brief builders/P5-FIX-B.md). Never cancel them. When they report: merge p5-fix-a then p5-fix-b into v2-core (they touch different functions of public/lobby.js and public/game.js), run `node tests/v2/30_shapes.js --target .`, unit suites, the sweep scripts for the touched screens, record the commit hashes in defects.json (status fixed + fix) and rerun mkqa.py.
- Wave 2 candidates: Q02 phone layout (needs a builder + screenshot critic on 390x844), anything new found by s10/s06c reruns.
