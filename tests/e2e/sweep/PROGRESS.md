# P5 sweep progress (lead: Sonnet 5.5)

## Hand-off block (read this first; update it every step)
- Repo `repo/` branch `v2-core`; sweep files in `tests/e2e/sweep/` (lib.py, botd.js bots daemon, audit.js, server.sh, s01..s10 scripts, defects.json -> mkqa.py -> `repo/QA-FRANK.md`, shotmap.json -> collect_shots.py -> `qa/v2-sweep/`).
- Servers: `PORT=4701 HAND_DELAY_MS=5000 tests/e2e/sweep/server.sh` (the sweep server, chris claimed via `node tests/e2e/claim.js chris` with E2E_BASE=http://127.0.0.1:4701), 4700 = the e2e re-run server (fresh, funded accounts chris ua1-3 by1-6), 4702 = bender-config server with BENDER_ADMIN_TOKEN=sweeptoken. Never 4610/4630/4640. Data dirs are in /tmp (mktemp), print on start.
- Do NOT run wrong-PIN tests against a server you still need: the sign-in lockout is per IP, escalates (30 s -> 930 s) and also blocks sign-ups.
- Run a script: `E2E_BASE=http://127.0.0.1:4701 python3 tests/e2e/sweep/s02_hands.py desk chips` (view desk|phone, mode chips|play). Each prints checks and a summary line; shots go to `runs/shots/` (outside the repo), `-s.jpg` = small copy safe to Read.
- Defects: see QA-FRANK.md (generated; edit defects.json, run `python3 tests/e2e/sweep/mkqa.py` and `collect_shots.py`, commit named paths only).
- Phone (390) cannot be played (Q02), so phone coverage is geometry only (offscreen() in lib.py).
- Fix waves: none started yet (see "Waves" below).

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
- s10_misc: login lockout copy, bender-config token gate (needs 4702): written, first half verified (wrong PIN message fine, lockout "Too many tries. Try again in 30s."); rerun against a fresh server.

## Waves
- Wave 1 spawned (visible, Sonnet default, own worktrees off v2-core 11d2618): A = agent:main:dashboard:b95ded74-f819-45d8-9934-f8c4160a0645 (branch p5-fix-a, Q03 rejoin/resume, Q08 leave control, brief builders/P5-FIX-A.md); B = agent:main:dashboard:28f4c387-db3a-4c33-a8c4-2e8e5584a0d8 (branch p5-fix-b, Q01 Q04 Q05 Q06 Q07, brief builders/P5-FIX-B.md). Never cancel them. When they report: merge p5-fix-a then p5-fix-b into v2-core (they touch different functions of public/lobby.js and public/game.js), run `node tests/v2/30_shapes.js --target .`, unit suites, the sweep scripts for the touched screens, record the commit hashes in defects.json (status fixed + fix) and rerun mkqa.py.
- Wave 2 candidates: Q02 phone layout (needs a builder + screenshot critic on 390x844), anything new found by s10/s06c reruns.
