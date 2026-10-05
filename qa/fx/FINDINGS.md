# Ping Poker FX visual QA (HEAD 6b2d79b, 1440x900)

Method: `qa/fx/capture.py` (port 3911, scratch bank), 3 players. Real `throw_item` socket events, animations frozen the instant the fx img is inserted, then scrubbed to exact times (frames are deterministic, not wall-clock). Throw frames = ms after splat start (projectile flight adds 680ms before). Targets: Carla (top-right), Bob (top-left), hero seat (bottom). Win captured on a natural showdown win. `metrics.json` has rects/z/opacity. `contact.jpg` = 12 throw rows x 4 frames + win row.

## Throw splats (bomb / tomato / splash / popper)
- Centering: PASS. fx center == seatClientPos == seat pill center (e.g. Carla 948,188; hero 570,709), all 3 positions.
- Size: PASS. 170u = 172px (tomato 194px at peak). About 1.0x the 176x58 seat pill width, ~3x its height. Reads as "hit that player", not table-wide. No clipping at table corners or the hero seat (bottom edge 795 < bottom bar 805).
- z-index: PASS. fixed on body at z71 (smoke z72), above seats (seat-layer z3), hero cards and chips. Nothing overlaps it.
- Fade: PASS. Opacity ~1.0 at 400ms, 0.62 (tomato) / 0.24 (others) at 800ms, gone by 1100 / 1500ms. Bomb smoke rises and fades cleanly (still visible at 1050ms, ends ~1950ms).
- Minor: at the 150-400ms peak the pill (player name, stack) is fully hidden. Acceptable for a ~0.5s hit, but see suggestion.
- Minor: smoke is small and thin (80u, ~77px) and reads weaker than the explosion.
- Bomb/water/popper share the same 1.0 settle and 1100ms timing and look near-identical in motion. Only tomato differs.

## Win burst (win-burst + party-popper)
- Centering: on the TABLE CENTER (570,406), not the winner. Hero won, so the popper sits on the community cards, not near the hero seat.
- Size: TOO BIG. win-burst is 707px at 400ms and 802px at 800ms. That is taller than the stage (760px) and covers most of the felt, the community cards, hero cards and the Bob/Carla seats' inner edges.
- z-index: WRONG for the moment. win-burst is z8 and popper z73, both fixed on body, so both sit over the cards. At 400-800ms the five board cards and hero hole cards are yellow-washed and unreadable, "YOUR HAND / STRAIGHT" is washed out, and the popper cone blocks the middle three board cards. This is the showdown reveal, so the player cannot read why they won.
- Fade: OK. Rays 0.77 -> 0.51 (800ms) -> fully gone by 2200ms. Popper holds 1.0 until ~1260ms, then fades. 1200ms frame still obscures the board.

## Suggested value changes (public/game.js; I did not edit)
1. `spawnConfetti`: win-burst size `520` -> `340`, peak opacity `0.8` -> `0.4`, duration 2200 -> 1600.
2. Put the rays behind the cards. Either append them into the stage under `.t-center` (z-index 4-5), or keep fixed-on-body and drop `z=8` to below the stage. Cheapest: lower the peak opacity to 0.35 and accept the tint.
3. Move the popper off the board onto the winner's seat. Use `seatClientPos(winnerIdx)` instead of `(g.cx, g.cy)`, size `300` -> `220`, y offset `-30*u` -> `-70*u` so it fires above the pill. Or keep it central but raise it to `g.cy - 190*u` (above the board row, in the pot/logo area).
4. Throw splats: size `170` -> `150` and raise the y by `-8*u` so the name is partly legible. Optional: add `scale(1.0)` + a 60ms ease so the first frame isn't a full-opacity pop.
5. Differentiate: water-splash `1100` -> `900ms`, bomb keep 1100, popper-throw use `settle 0.9`. Smoke-puff `80` -> `110`.

Scrubbing caveat: frames at t past an animation's end show the element at base style (opacity 1), so throw frames use 1050ms, not 1200ms.
