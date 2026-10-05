# Ping Poker BANK panel UI audit (local server, scratch data, 1440x900 + 1920x1080)

Checked OK: B key and BANK button open the panel. It sits above the table and ends exactly at the action bar (804px at 1440, 965px at 1920), so nothing overlaps. Enter commits a chris edit (8,500 -> 12,345). Esc cancels the edit without closing the panel. A typed edit value survives the 4s refresh. Pixel diff of two shots 1s apart shows no bank-area change (only the turn timer ring). 'Nothing to plot yet' empty state renders well. No JS errors.

1. MED - Chart is unreadable at normal stacks. Y axis is 0..2k for 1.5k stacks, so +/-30 chip swings are flat lines. End labels all read '1.5k' and nearly touch. Fix: scale to min/max of series (or +/-20% of the start stack) and label unrounded values. See public/bank.js renderLine / niceMax.
2. MED - Editing shifts layout. Opening the input grows that player's row about 9px (Vic card 110->119px) and pushes the rows below down. The sub-line truncates ('At the table . 5 h...'). Fix: give .bp-edit the same height as .bp-bal b. See bank.css .bp-edit / .bp-bal.
3. MED - Edit affordance is hard to find. Only a dashed underline and a title tooltip mark the number; there is no pencil icon and no 'Enter save / Esc cancel' hint. Only chris sees it. Selector: .bp-bal b.editable.
4. MED - Clicking away (blur) silently discards typed input. renderPlayers() is skipped while an edit is open, so the standings and 'N players' count go stale during an edit. See editBank blur handler: finish(false); renderPlayers early return.
5. MED - A chris bank edit leaves no Activity entry. The feed shows only buy-ins ('3 recent'), so balance changes are unaudited and invisible. Server bank_set should log an event.
6. LOW - The whole panel is rebuilt every 4s (about 16 DOM mutations, 32 nodes removed, row nodes replaced). There is no visible flicker, but hover, selection and tooltips reset, and a click spanning a tick can miss the editable number. Fix: diff or patch values in place.
7. LOW - '1 players' grammar in the empty state (#bank-pcount).
8. LOW - Activity timestamps wrap to two lines ('10:42 / PM') in the narrow column (.bank-feed row time).
9. LOW - Status wording: chris is 'Sitting out . 0 hands' while 1,500 is at the table.
10. LOW - .bp-avw clips 2px (scrollWidth 46 > clientWidth 44); avatar ring is slightly cut.
11. LOW - Panel hides the whole table at both sizes (1140px of 1440, 1560px of 1920). The live hand can't be watched while the bank is open. Likely by design; consider a narrower or side-docked variant.
12. LOW - Small caps labels (AT TABLE, NET P&L, the legend) are about 9-10px, with low contrast at 1440. The dashed starting-stack line in the chart is barely visible.

Screenshots: a1-empty-1440 (mid-game, not the empty state), a2-1440, a3-t0/a4-t1 (diff), a5-editing, a6-1920, a7-empty (empty state). Local servers were on 4461 and 4462 and have been stopped.
