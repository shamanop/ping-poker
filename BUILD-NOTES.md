# BUILD NOTES (D3 layout worker)
- [01:10] Reviewed d3.png + ui assets. Plan: keep --u scale system (clamp 0.8-1.35 of min(h/900,w/1440)); rework .g-grid to areas "head head / panel stage / panel bar"; left panel = chat+stickers+throws; Log/Rank hidden; sit-out -> PAUSE; bank slide-over limited to stage col.
- [01:25] index.html game markup, bank.js slot, style.css grid/head/rail/bar/seat block written (untested). Next: game.js changes (layout, seats ellipse, controls, preselect, rail).
- [01:50] game.js: ellipse layout, left-panel JS, controls w/ presets/helper/preselect wired to PRESELECT.md protocol (your_cards.preselect, emit 'preselect'). Next: start server :3217 and screenshot.

## Layout QA pass (2026-10-05)
- Pre-select state: action bar gets `.preselect`; raise presets/slider hidden, Check/Fold + Call fill the bar (taller, disabled Call legible). game.js renderPreselect, style.css tail.
- Hero seat clamp raised (myB 6u -> 30u) so Chris's plate lifts off the "Waiting/turn" line; line gap to bar widened (8px).
- Verified: slider sets amount, presets set amount (flop Pot=120), preflop presets 2.5x/3x/4x/All-in = 50/60/80/1500.
- Finals: qa/final/final-{1440,1920}-{turn,wait}.png. Remaining: side-bottom plates (Liam/Adam) still overlap table rim slightly by design (matches d3 reference).

## Panel left/right toggle
- Brass arrow button in the Chat header (#btn-panel-side) toggles `.panel-right` on #game-screen (swaps .g-grid areas in style.css); saved as localStorage `ping.panelSide` ('left' default). Logic: `initPanelSide()` in game.js.
- Bank slide-over (bank.css) fills the stage column and slides from the side opposite the panel; bar and stage stay centred in the remaining column. Frame art is symmetric, so no mirroring was needed. QA: qa/panel_qa.py -> qa/final/panel-left.png, panel-right.png.

## Table C re-lay (slanted table, scratch build)
- public/images/ui/table.png is now art-src/persp/table-C.png (old flat oval kept as table-flat.png); layoutTable() sizes it at 1152:535 from stage width/height, seats ride the rim ellipse (seatCenter) with per-seat scale 0.85 (far) to 1.0 (near) via --ss; hero cards sit just above the hero plate; board at 34% of table height over the baked-in VP logo.
- QA: qa/capture_c.py (port 3217, 6 players, turn street) -> qa/final/c-1440.png, c-1920.png; tests/preselect.js passes.
- Gaps vs mock: VP logo is baked into the art so the board hides most of it (mock shows it fully below the board); hero card bottom corners slightly tucked under plate; blind marks are SB/BB tags, not chips.
- Dealer D puck still uses old betSpot offsets (floats on felt near the dealer's bet), not pinned beside hero cards as in the mock.
