# FB4 painted UI (chris 10-06 FB4)

GPT-painted blanks (model `openai/gpt-5.4-image-2` through OpenRouter) for every piece that was a CSS box. Text stays live HTML on top; the art carries no words.

## Pipeline (all in cold-call/art/redesign, run from there)
1. `python3 paint_gen.py <sheet> 3:2 "<prompt>" <ref1> [ref2]` -> `raw/paint_<sheet>.png` (checks balance, refuses past BUDGET, logs to spend.jsonl). Pieces on flat #00FF00.
2. `python3 paint_cut.py raw/paint_<sheet>.png <sheet> name1 name2 ...` -> trimmed RGBA masters in `../paint/<sheet>/` (reading order).
3. `python3 paint_export.py <sheet>` -> `public/games/coldcall/assets/img/ui/ui_<name>.webp` (display size x2; table T in the script, or paint_export_cfg.py).
4. `python3 cold-call/art/redesign/paint_register.py` from the repo root -> pieces in `assets/symbols.json` (CSS gets `--img-ui_<name>`, assets.js preloads).
5. `public/games/coldcall/paint.css` (loaded last) wires them. Rule: no box changes size. `qa/coldcall-fb1/paint_shift.js` compares box rects with and without paint.css (shots from `paint_shots.js`).

## Sheets
### S1 status bar (painted, wired, VERIFIED 2026-10-06)
Pieces: bar_red 1060x76, bar_gold 1060x76 (rule bar, the red one for 5+ TOUCHING / PICK / ONE MORE CALL, the gold for bonus and Callback), strip_note 1032x60 (leads strip), sticky 200 px (corner notes), leaf (APPT plate) , lcd (dark readout). Raw `redesign/raw/paint_s1.png` doubles as the style ref for later sheets. Prompt for S1 was not logged by the previous builder.
States: none (the PICK / ONE MORE countdown darkens the right end with a CSS layer over the red bar; `.late` brightens it).
Verified: 540x960, 360x740, 1440x900, Play $ and Chips; idle, hot_leads, callback, gain, pick, more, ghost: text legible, no symbol covered, leads strip 30 px (540), 28 (1440), 20 (360). paint_shift: 39 pairs, 0 boxes shifted (#spin, #cap, #plBn are animated by the game and ignored). Shots: qa/coldcall-fb1/paint/s1/.
Spend: $0.19.

### S2 buttons (painted, wired, VERIFIED 2026-10-06)
Sheet 3:2 on green, refs raw/paint_s1.png + bezel.png; one prompt, first try (no repaint). Prompt gist: "six separate blank UI pieces ... same thick oil-paint style as the first reference image (heavy black ink outline, thin cream inner line, brush strokes) ... NO text/letters/numbers/icons ... Row 1: wide beige plastic desk-phone button ~2.4:1 with a thick darker lip, same in cherry red; Row 2: same in lit gold, same in deep navy with a gold inner line; Row 3: chunky square-ish beige keypad key ~1.4:1, wide navy keypad plate with a brushed-brass rim".
Pieces (webp in assets/img/ui, 9-slice sources; CSS slice values live in paint.css):
| piece | file px | used for |
|---|---|---|
| key_cream | 360x136 | .sq (bet - / +), AUTO, TURBO, i, SFX, MUSIC, HANG UP, buy-menu cards (.buyopt), CANCEL (.btn.alt) |
| key_red | 362x135 | BUY BONUS, ONE MORE CALL, CONFIRM / .btn |
| key_gold | 360x133 | lit toggle (.btns button.on), lit mode tab |
| key_navy | 362x133 | NOT USED (the 24 px mode-tab pill read as a dotted line when 9-sliced, so it stays CSS); kept for later plates |
| key_pad | 200x176 | keypad key (--key-art slot era: now border-image on .dial .key) |
| pad_plate | 408x160 | keypad plate (.dial::before 9-slice, 18 px rim) |
States: ONE blank per colour. Rest = painted. Pressed = existing translateY(3px) + filter:brightness(.9) (:active). Disabled = filter:saturate(.45) brightness(.82) on [disabled]. Lit keypad key = the pad key through filter sepia(1) saturate(3.4) hue-rotate(-6deg) brightness(1.12) + glow (no separate gold pad key). Nothing is painted three times.
Fit: the painted face is narrower than the old CSS key (outline and lip are art), so button labels went down 1 px (.btns 12.5 -> 11.5 px, .tog em 11 -> 10 px, BUY BONUS 13.5 -> 12.5 px) so MUSIC / TURBO clear the outline at 540 and 360. Mode tab pill and its Play $ / Chips labels are CSS; only the lit tab is the gold blank.
Verified: 540/360/1440, Play $ and Chips; idle, more, buy_menu, buy_confirm, keypad, keypad_lit, pick, callback, disabled, pressed. paint_shift 45 pairs, 0 boxes shifted. Shots: qa/coldcall-fb1/paint/s2/. Spend $0.18.

### S3 bubble, panels, plates (painted, wired, VERIFIED 2026-10-06)
Same refs (s1 + s2 raw), first try. Pieces:
| piece | file px | used for |
|---|---|---|
| bubble_body | 388x165 | hero caption #cap::before, 9-slice 13 px. One body serves all three widths (short / medium / 250 px max); a separate painted blank per width would only repaint the same rectangle |
| bubble_tail | 72x44 | #capTail (34x30), open top edge so it overlaps the body; captions.js still aims and rotates it, clip-path triangle dropped |
| toast | 252x89 | .toast ticket |
| card_panel | 301x353 | .card (info, buy menu, confirm) and .scn (pot-win card, bonus cards), 16 px rim |
| plate_win | 332x146 | #winbox |
| plate_chip | 214x138 | #plPot, .chip (SPINS LEFT, BONUS TOTAL, YOU DIALED, FREE SPINS) |
Also: sticky (from S1) as a 9-slice for #plBn (+N LEADS / APPOINTMENT banner) and #plmo (ONE MORE CALL result), CSS fold triangle removed. The 4-way ink drop-shadow outline of #cap is gone (the body carries its own outline).
Verified: 540/360/1440, Play $ and Chips; idle, hot_leads, buy_menu, buy_confirm, info, keypad_lit, more, pick, callback, gain, pot, more_won, more_lost, banner. paint_shift 78 pairs 0 shifted (animations finished before the rects are read). Shots: qa/coldcall-fb1/paint/s3/. Spend $0.18.

### S4 big-win backdrop (painted, wired, VERIFIED 2026-10-06)
One 9:16 piece, refs s1 raw + before/big_win_540x960.jpg: painted sunburst, calm dark centre for the MEGA WIN text. ui_burst 720x1280 webp 134 KB on #tierbg (centre 50% 45%). Verified 540/360/1440 (qa/coldcall-fb1/paint/s4/), text legible, 0 boxes shifted. Spend $0.15.

## Spend (spend.jsonl, paint_*): S1 0.193, S2 0.183, S3 0.185, S4 0.145 = $0.706. No repaints needed. Credit left on openrouter.key: $5.88.

## Still CSS (and why)
- Mode tab pill (Play $ / Chips): 24 px bar; a 9-slice painted pill read worse than the CSS one.
- Bonus-HUD countdown bar `.dec2 .dr` and the 5 px leads fill meter: live data bars, must be exact.
- Splash PICK UP, lobby: use .btn (red key) already; no separate art.
- Win-screen tier title text (MEGA WIN): live HTML with a stroke, by design.
- No separate pressed / disabled / lit paintings: derived by CSS filter from the blank (said above).
