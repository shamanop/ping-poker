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
