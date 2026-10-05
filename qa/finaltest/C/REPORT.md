# FINAL TEST C: visual / animation / FX QA

Branch `redesign-70s` (merged build). Chromium via Playwright, local server on :3113 (own bank/ledger copies), password `ping`. Sizes 1440x900 and 1920x1080. Live Railway URL never touched. No code edited.

Setup: 1 real browser (hero) + 2 scripted socket.io-client opponents (separate context); extra 8-seat run (hero + 7 bots); extra hotkey/glyph run.
Scripts and logs: `run.py` (full 3-player flow), `run2.py` (8 seats), `run3.py` (hotkeys, 10 glyph), `run.log`, `run2.log`, `run3.log`. Screenshots are `<size>-NN-name.png`.

Viewing limit: I looked at 6 images (1440 landing, 1920 river/your-turn, 1440 hero-win sunburst, 1440 bomb crop, 1440 card grid, 1440 bank panel). One planned view (rail tabs Chat/Rank/Stickers) was wasted by a bad montage crop, so those three tabs and the 8-seat tables were verified by DOM geometry only, not by eye.

## PASS / FAIL by area

| Area | Result | Notes |
|---|---|---|
| Console errors / 404s / failed requests | PASS | 0 console errors or warnings, 0 pageerrors, 0 HTTP >=400, 0 failed requests, in all three runs at both sizes. No broken `<img>`. Libre Baskerville, Bebas Neue and Bitter all load. |
| Login screen | PASS | Painted backdrop (`/art/login-bg.jpg`, `html.art-login` set, shown full-bleed, readable card). 12 avatars render (256px PNGs); every one is selectable with exactly one `.selected`. Photo option opens the file chooser and shows a preview (profilePic set). "Take a seat" eyebrow present. Password field gold focus ring. No scroll at either size. |
| Lobby / waiting | PASS | Count updates 1 -> 3 -> 8, Start button appears for host, no overflow. |
| Deal / flop / turn / river | PASS | Community card counts 0/3/4/5, hero 2 cards, plaque (blinds / level / next / street / to call / min raise) updates, no clipped text (`textOverflow` empty everywhere). |
| Your-turn state | PASS | Ring + timer + "Your turn", Fold/Check-Call/Raise enabled, sub-labels correct ("20 to call - pot 30", "Check or bet"). |
| Action bar visible without scrolling | PASS | Bar bottom = viewport bottom (900 / 1080) at every street, doc scroll = viewport, both sizes, 3 and 8 players. |
| Raise presets and slider | PASS | Min / 1/2 pot / 3/4 pot / Pot / All-in presets set value, input, "to N" label and slider fill correctly (All-in shows "to 1,500 - all-in", fill 100%). Mid-slider click gave 770. |
| Hotkeys | FAIL (partial) | F (fold), C (call/check), ArrowUp/Down (when focus is on body) work; typing `fcr` in chat does not trigger them. **R + ArrowUp/Down + Enter sends the wrong amount, see BUG 1.** |
| Right-rail tabs Log / Chat / Rank / Stickers | PASS | Each tab activates, panel stays inside the rail (x 1141-1440), no horizontal overflow (scrollWidth = clientWidth). Chat send works; Rank lists standings. Only the Log tab was reviewed by eye. |
| Bank | PASS with note | Bank is a gold header chip ("BANK", also hotkey B), not a 5th rail tab. Panel opens full-stage with no overflow, closes on Escape. Layout looks polished (viewed at 1440). See BUG 5. |
| Sticker throws (bomb, tomato, splash, popper) | PASS | Seat click opens the tray in-viewport at both sizes, 4 option images load. All four projectiles fly, then the splat image appears centred on the target seat (bomb + smoke, tomato, water, popper), FX PNGs load (512px natives), nothing left behind. Bomb viewed: clean. Floating emoji sticker appears mid-table. See BUG 4 (FX hides the seat). |
| Win sunburst | PASS | `win-burst.png` (about 455-534px) fades 0.4 -> 0, `party-popper-burst` on the winner seat, "+30" win-float; showdown plaque "ISABELLE Everyone folded +30" with countdown bar. Seen at 1440 (hero win by fold) and in the data at 1920. |
| Showdown banner | PASS | Plaque sits on the felt between the top seats, no overlap with seats/pot/community (overlaps = []). |
| Sound mute toggle | PASS | Icon `#i-sound` <-> `#i-mute`, `.muted` class, `localStorage.pp_sound_muted` 1/0; toggles back cleanly. (Audio output itself not auditable headlessly.) |
| Court cards J/Q/K | PASS | All 12 illustrated faces load (no broken images), consistent frame and scale; K and Q seen in play and in the grid, sharp and well framed. |
| '10' glyph | PASS with note | Reads "10" (1 then 0, never "0I"). Libre Baskerville loads. But the two characters touch, see BUG 6. |
| Seats cropped at either size | PASS | 3 and 8 players, both sizes: `seatsClipped` = [] in lobby, dealt, every hero turn and showdown; seat-vs-seat and seat-vs-pot/community/hero/plaque overlaps = []. Min margin 12px (8-seat left seat at 1440). |
| Overlapping widgets | FAIL (minor) | Hero bet chip over hole cards, see BUG 2. |

## Bugs, severity-ranked

### BUG 1 (Medium-High, functional): R + arrow keys + Enter sends the stale input value, not the shown "to N"
- Where: `public/game.js` `setRaiseValue()` (about line 1075) only writes `#raise-input.value` when the input is NOT focused; `doRaise()` reads `$('raise-input').value`.
- Repro (1440 and 1920): on your turn press `R` (focuses `#raise-input`), press `ArrowUp` twice, press `Enter`.
- Observed: slider and `#raise-sub` say "to 60", `state.raiseVal` = 60, but the input still shows "20". Enter sends 20 (the min bet). Log: "Isabelle raises to 20". Reproduced at both sizes (`run.log`: `RAISE via R+arrows+Enter [inputValue, state.raiseVal, subText, focus] ['20', 60, 'to 60', 'raise-input']`).
- Arrow keys with focus on body (after blur) work correctly (40 -> 60 -> 40), as do presets and slider.
- Impact: user bets less than they see and think they are sending.

### BUG 2 (Medium, visual): hero's bet chip + amount sits on top of both hole cards
- Repro: raise preflop (or any bet) with a 3- or 8-player table. `#bet-layer .hero-bet` overlaps `#hole-cards .card` 0 and 1.
- 1440x900: bet badge rect [523,516,616,544] over the card tops; 1920x1080: [723,666,836,700]. Seen in `1440x900-20-herowin-0.png`: the chip covers the top-right of the 5 and the "20" label sits on the 9 index of the second card.
- Impact: the chip hides a card index while you are deciding. No other bet/seat/puck overlaps found (7 opponent bets at 8 seats: none).

### BUG 3 (Low): new player sees the previous session's log, and hand numbering continues
- Repro: join after a game ended (same room). Log tab shows "Carla disconnected / Not enough players. Waiting..." from the earlier run, and the new game starts at "HAND 4". Seen in `1920x1080-05-myturn-river.png`.

### BUG 4 (Low, polish): popper/bomb FX completely hides the target seat
- Win popper (about 200-213px) on hero seat hides name and stack for about 1.8s (`1440x900-20-herowin-0.png`); bomb + smoke on an opponent hides name/avatar for about 1.1-1.7s (`v-throw-crop.png`). Probably intended, but players cannot read the seat or stack at the moment of the win.

### BUG 5 (Low): Bank "chips at the table" chart draws a false 0 -> 1.6k ramp
- After 2 hands the line chart starts Bob and Carla at 0 on HAND 1 (Isabelle starts at about 1.5k), producing a steep diagonal that looks like a data error (`1440x900-15-bank-panel.png`, viewed). Likely the first-hand snapshot lacks the other players; low impact.

### BUG 6 (Low, polish): '1' and '0' of the "10" index touch
- `getExtentOfChar` gap between '1' and '0' is about 0.0 units at sm/md/lg (letter-spacing -2 on 20px type). In a pixel scan of the lg index there is no empty column between the two glyphs (one dark run x 3-16). It still reads "10" at lg, but at sm (38px-wide card) the slab-serif 1 touching the 0 can look like "I0" / "IO".
- Suggest letter-spacing about -1 or a slightly smaller size.

### Observations (not bugs)
- Dealer "D" puck sits on the felt ring about 110px below the dealer's seat at 1920; fine but a little detached.
- "STICKERS" rail tab ends 9px from the screen edge at 1920 (tight, not clipped).
- Opponent card backs are intentionally tucked under seats.
- Avatar swatches are 47-60px: small at 1440 but clickable.

## Files
`qa/finaltest/C/`: `run.py`, `run2.py`, `run3.py`, `run*.log`, `server.log`, `1440x900-*.png`, `1920x1080-*.png`, `v-throw-crop.png`, `photo.png`.
