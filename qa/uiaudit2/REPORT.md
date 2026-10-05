# UI audit 2: join screen, table (3 seated), action bar, waiting panel, toasts
Shots (8): 1440/1920 landing, 1440 waiting, 1440 dealt, 1440+1920 my-turn, 1440+1920 after-raise. No console errors.

1. MED - Action bar status truncated while waiting: "Waiting for Carla (..." loses the countdown. game.js:649 puts "(Ns)" inside the `b` element, which has ellipsis/nowrap (style.css:449, .bar-status-text b). Move the seconds into the sub span or widen the status column.
2. MED - Dealer button hidden behind the deck: at 1920 hand 2 the "D" puck sits under the VP card-back stack beside Bob's seat. Elsewhere the deck sits next to the D beside the hero cards. Selectors .deck (style.css:347) and the dealer chip; separate their anchors.
3. MED - Hero bet chips collide with hole cards at 1440: the "58" stack and label sit on the top edge of the K/A cards. At 1920 the stack just touches the card tops. Bet-chip anchor for the bottom seat needs more offset.
4. MED - Opponent hole cards are clipped by their own nameplates (Bob/Carla, both sizes): only the lower half of the backs shows below the plate, so it reads as a glitch. Seat card layer sits under the plate.
5. LOW - "TO CALL" header shows "CHECK" while it is the opponent's turn and Carla still owes chips (1440 after-raise shot). Header reflects hero's own state, not the live bet. Also shows "CHECK" instead of an amount during preflop with blinds posted.
6. LOW - Waiting panel: stray gold dot at the far left of the panel title (about x429,y300), likely the .pulse-dot (style.css:142) rendered outside .wp-msg when the title wraps. Title "Waiting for a second / player" also wraps with a one-word orphan; .wp-msg is nowrap but the heading is not. Invite URL shows "localhost:4350" with no scheme (expected locally, check on Railway).
7. LOW - Raise slider min/max labels ("40", "1,500") are 9-10px, sit under the track at the bar's bottom edge and the min label is covered by the thumb (1440 and 1920).
8. LOW - Landing: "Bank 0" shows under the name field to a logged-out visitor (#bank-display, index.html:65), reading as an error. Dead vertical gap between the password field and the buttons.
9. LOW - Log panel is empty in the waiting state (large blank right column at 1440); no placeholder text.
10. LOW - Disabled bar shows blanked preset buttons ("-") but the raise input box remains an empty bordered rectangle (1920 after-raise).

Toasts/overlays: no toast fired in the flow I ran (#toasts container empty), so nothing to judge. Showdown overlay and bank modal not in scope.
Note: the 1920 pass reused room POKERPING after the 1440 bots dropped, so "disconnected/rejoined" lines in that log are a test artifact, not a bug.
