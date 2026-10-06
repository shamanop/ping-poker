# THE PULL UI: concept comps A / B / C (builder C, 2026-10-06)

Mocks are static HTML on the live skin-3 CSS and art (`_shared/base.js` rebuilds the live DOM ids, same fit math as game.js). No file under `public/games/coldcall/` was touched.
Regenerate: `python3 -m http.server 4641` from the repo root, then `node qa/coldcall-v2/concepts/capture.js [A|B|C] [state]`. PNGs: `<X>/<state>_<540|360>.png`, sheets: `<X>/contact_<X>.png`.
Shared numbers: LEADS 43/400, 20 leads cold in 3 h 12 m, 4 warm at $1.00, DAY 4 +30, pot $1,284.50, bank $35.84, x2 wins 49% pays $71.68, ghost $12.40 (3 squares: $2.20 + $6.80 + $3.40). Warm = amber lit square (hot stays cyan); ghost/flip reuses the live `.rv.b` quote bubbles.

## A: THE LEAD SHEET (paper)
Idea: leads are a taped call sheet; 40 boxes, 1 box = 10 leads, ticked in red. Full = stamped CALLBACK.
- Leads + cold line: sheet in the head band, top right, above the bubble (gone in a bonus, the SPINS/TOTAL chips take that corner).
- Pot: right end of the rule bar ("OFFICE POT $1,284.50"). Feed: dark readout over the bezel's vent. Appointment: left lip beside WIN. Warm count: right lip. Warm tag: price tag on the square.
- PICK: the feed strip becomes a red draining prompt strip; squares get a gold ring. ONE MORE CALL: a "while you were out" slip over the board (two 104 px keys, drain bar).
- GHOST: hero bubble ("WOULD HAVE CLOSED $12.40"). POT: head band takeover (rays, cashwads), board untouched; ribbon shows the reset pot.
- Risks: sheet and bubble share the head's right side (about 10 px apart at 960; fine when the head is taller); 12-13 px text on lips is about 8 px on a 360 screen; slip hides the board (acceptable at bonus end); the CALLBACK stamp covers the sheet header.

## B: THE ROLODEX (card file + desk)
Idea: leads are index cards standing in a card file set into the bezel top (1 card = 20 leads, last card red). Thumb-zone decisions.
- Leads: dark readout in the bezel top (LEADS 43 / 400 + card edges). Feed: right end of the rule bar. Pot: right lip, the #1 CLOSER mug. Appointment: left lip as a desk-calendar leaf. Cold line: label-maker tape in the HUD fine row (HUD grows about 10 px; the head gives it up). Warm tag: red rubber stamp.
- PICK: the rule bar becomes the prompt and drains. ONE MORE CALL: the HUD top row turns into HANG UP key / countdown dial / ONE MORE CALL key; board fully visible; odds in the rule bar. GHOST: the WIN window itself reads WOULD HAVE CLOSED $12.40 in ghost cyan.
- POT: a medallion over the board (mug, wads, rays), not full screen.
- Risks: balance and bet are hidden during the decision (is that OK?); the bezel readout is dense at 360; the fine-row legal line is replaced by the cold line; card edges read as a bar at small size.

## C: STICKY NOTES (uses the painted notes)
Idea: the monitor already wears two painted sticky notes; the game writes on new ones stuck on top. Lead note top-left (big 43, marker bar), appointment note bottom-right, CALLBACK = the existing CALL BACK! note art on the stack.
- Pot + feed: the top mode bar becomes a ticker tape (bar grows 24 to 30 px, the head loses 6 px). Cold line: a note in the head band. Warm tag: mini sticky flag.
- PICK: a big note "PICK YOUR LEAD" with a draining marker bar in the head (bubble steps aside). ONE MORE CALL: two big notes (236 x 190) on the board, tape strip with the timer. GHOST: rubber stamp in the head band. POT: one big note slapped on the board.
- Risks: tops of lit squares and the bezel corners are covered by notes (the painted notes are art, the overlay must track them if the bezel art changes: positions are board-relative constants); ticker text is small (14 px, about 9 px at 360); two notes plus stamp is the most "toy-like".

## My take
A is the safest and most legible (nothing new in the HUD, one new object). B's decision-in-the-HUD is the best idea for thumbs and I would steal it for any concept. C is the most on-brand and cheapest in new art (reuses the painted notes) but tightest on legibility. Suggested merge: C's notes for leads/appointment + B's HUD decision keys + A's pot-in-ribbon only if the top bar text stays unreadable.
