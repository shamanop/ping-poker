# Part 3 working notes (levers agent successor session, 2026-10-06). Read LEVERS.md section 8 for the final answer.

## Tools (mine)
- tools/levers-pull.js: --stream (whole game with the pull, state carried, real daily streak), --sessions, --buys. tools/lv-s.sh cfg spins = local smoke summary (tools/lv-sum.js).
- tools/lv-run.sh name cfg.json sim.js args = run on shaman (24 threads, E: only), json back to levers-runs/. tools/lv-bonus-sum.js, tools/lv-pickpol.js (pick heuristics).
- cfg overrides in levers-runs/cfg/*.json (merged over CFG by --cfg).

## Decisions so far
- PICK: bronze mult is the lever (bronze 0 = picked square never a bronze). --bonus 400k runs/config: P0 (0,2,3,2,2) b1 first 98.2 / best 104.7 / none 82.9; P1 (0,2,3,1,2) 99.4/104.7; P2 (0,1.5,2,1,1) 97.8/103.5; P3 (0.3,2,3,1,1) 91.4/94.1; P4 (0,1.5,2,1.5,1.5) 97.7/103.9. bonus2: none 276.9, first ~289, best ~295. Heuristic search (lv-pickpol, bonus1 P1): first 99.4, deg 105.9, deg2 106.1, centre 101.7: the skill edge is best/first = +6.5%, `best` (most hot neighbours) is the practical maximum. => headline payback is quoted at pick=best (max skill), first/auto is lower.
- ONE MORE CALL rtp 1.0 (fair coin, payback neutral at any policy), minTenths 50.
- Provisional knobs, pick best, list 400, A1 cfg, 10M spins: Callback every 367 spins (median 371, P90 379), natural 1 in 209 avg 123x (PICK lifts natural 102x -> 123x), Callback bonus1 avg 104x; parts clusters 28.9 phone+warm 25.5 natural 58.9 Callback 28.3 = 141.5 (+ pot 1.0). Needs about -44 pts.
- Budget logic: Chris targets any bonus 1 in 180-220, avg 90-120x, bonus share 45-55%  => B = bonus points about 48-54; clusters 28.9 + pot 1.0 => base phone incl warm must fall to ~18-20 (from 25.5), natural bell weight down (Callback takes 22-26 pts), and the PICK lift makes avg 118-123 so any-bonus rate is 1 in 237 unless values come down.
