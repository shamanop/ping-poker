# Cold Call board v2: critic r1 (Opus, 2026-10-05 ~23:35, stills only)

Reviewed 24 shots in `qa/coldcall-v2/` as they stood at ~23:35. The shots were re-captured in `4a97dcc` (00:47), so
some items may already be gone: re-check each against the current build before touching code. r = row, c = column.

| shot | defects | severity |
|---|---|---|
| idle | header unlike all other shots, Play $/Ledger $ clipped by top edge; grey bubble repeats "Press 1 to spin." | should fix |
| cascade_win | "+$0.10" sits on mugs r4c4-5; hot-lead squares saturated flat blue, spill past cells | should fix |
| sweep | "+$0.30" over mugs; WIN reads $0.19 | minor |
| hot_leads | stamp hides all of row 3 | minor |
| phone_reveal | "UPSELL" label tiny; "50c" beside "$2" | minor |
| upsell | white blob covers the "x" of "x3" (r3c5); burst spills onto r2c5; no phone visible | should fix |
| close_collect | r3c4: two small tags ("20c", "$2") over the bubble amount, one straddling c3/c4; r3c6 "$10" tag over another amount; flat black "CLOSE" box | blocker |
| payment_accepted | seal + stamp bury card machine and ~8 cells; black box fragment at r2c3; WIN $0.70 beside ~$15 of bubbles | should fix |
| second_round | r1c4 bubble squashed, unreadable; three totals ($32.20, $16.10, $0.20) | should fix |
| tease | bells unmarked; WIN $0.70 with no win visible; handset cut by banner | minor |
| spins_added | stamp hides r3c2-5; unexplained "PAYS $14.80" | minor |
| buy_menu | speech bubble shows through, third line cut by modal; spin button base pokes out below | minor |
| info_modal | tiny dense text; last row clipped, no scroll cue; "and" appears a different colour; icons too small to tell apart | should fix |
| info_modal_pay | top line clipped | minor |
| bigwin_overlay | $37.63 above WIN $56.50; board shows through text; wads clipped at both edges; "TAP TO CONTINUE" on board border | should fix |
| bigwin_closed | hero smaller than other poses | minor |
| bonus1/2/3_spin | BONUS TOTAL $0.00 while WIN $0.10/$3.80/$3.30; bonus2: blank blue cells r4c4, r4c6, r5c2, sliver bubble r4c3 unreadable; bonus3: silver bubbles weak on blue | blocker |
| bonus_intro_dial | hero absent; faint duplicate "PLACE THE CALL"; mismatched dash placeholders; "CALL" in a different font | should fix |
| bonus_total | confetti covers header buttons; flat-colour confetti; balance $999.00 beside $57.10 | minor |
| bubbles_10c, buy_confirm | none seen | none |

## Five worst
1. `close_collect`: stacked tags make bubble amounts unreadable.
2. Money disagrees on screen: BONUS TOTAL $0.00 vs WIN in all three bonus spins; three totals in `second_round`; $37.63 vs $56.50 in `bigwin_overlay`.
3. `bonus2_spin`: three blank blue cells and an unreadable sliver bubble.
4. `payment_accepted`: seal and stamp bury the card machine, with a black fragment sticking out.
5. `upsell`: white blob over the "x3".

Closeness to A1: 5/10. Biggest gap: no room behind the hero (out of scope for this wave).
