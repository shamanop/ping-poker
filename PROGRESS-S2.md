S2 step1: read spec, copied vp-slot bender engine -> games/bender-engine.js (pure UMD, rng injected). Orig sim baseline 200k seed12345: RTP 89.57% hit 29.3%.
S2 step2: wallet.js, games/bender.js, games/index.js written (engine copy + resolveRound appended).
S2 step3: bender-sim.js (exact-match vs orig engine + RTP/CI), tests/bender.js written & passing.
S2 step4: ADD-A-GAME.md done. 6M-spin sim seed 777: RTP 96.40% (+-2.3 CI) vs published 95.84%; 200k seed 12345 bit-identical to original engine. Committing.
