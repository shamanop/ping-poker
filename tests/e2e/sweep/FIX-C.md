# P5 fix C progress (Q02 phone layout 390x844), branch p5-fix-c

## What changed
- public/phone.css (new, linked with media="(max-width: 600px)", so desktop never loads it): two-row shell top bar, game dock as a bottom strip, single-column lobby/create/share, table grid head/stage/action dock, chat rail as a bottom sheet (closed by default), action dock full width with 44 px+ targets, table unit 0.5.
- public/index.html: the phone.css link and one Chat button (#btn-rail-toggle, hidden on desktop by style.css).
- public/game.js: initRailDrawer() (toggles .rail-open), PHONE_TABLE_U = 0.5 for the table geometry on phones, and the table height floor no longer forces a 200 px table (430 px wide) onto a 390 px stage. On desktop widths the floor is unchanged (sw*0.9/AR >= 200 whenever sw >= 430).
- No server, socket event or payload changes.

## Before (v2-core 2e3064c), tests/e2e/sweep/s11_phone_geometry.py
```
FAIL lobby: Sign out reachable 
FAIL lobby: Create table reachable 
table geometry (left,right,width): {'fold': [298, 321, 22], 'call': [306, 328, 22], 'raise': [312, 334, 22], 'rail': [72, 276, 204], 'stage': [284, 382, 98], 'home': [0, 0, 0]}
FAIL phone: fold button on screen and at least 44 px wide ([298, 321, 22]) 
FAIL phone: call button on screen and at least 44 px wide ([306, 328, 22]) 
FAIL phone: raise button on screen and at least 44 px wide ([312, 334, 22]) 
s11 phone geometry: 6 checks, 5 failed
```
fix_c_phone.py before: the run cannot even press Sign out ("element is outside of the viewport", 30 s timeout).

## After
- s11_phone_geometry.py: 6 checks, 0 failed (fold/call/raise 121 px wide at x 8-382, nothing off screen on lobby, table, host drawer, Bender window).
- fix_c_phone.py chips and play: 46 checks, 0 failed each. It signs up, sign-out/sign-in through the form, opens and submits the create form, joins a bot's table by code through the buy-in, opens/closes the chat drawer and sends a message, then presses Call and Raise (preset) through the real buttons; checks every control's box is inside 0..390 and the action dock >= 44x44.
- Desktop unchanged: fix_c_shots.py dumps the rect of every id'd element for lobby and table at 1440x900 and 1920x1080: 0 differences before vs after. At 1024x768 six 1 px differences in the shell wallet (sh-chips/sh-play/sh-wallet); a second run of the same code gives identical numbers, the difference is the random account name width (hNNNNN) shifting the neighbouring grid column, not CSS.
- 30_shapes 42/0 (exit 0), run-tables 128/128, run-money 90/90, run-engine 96/0, amountfield 66/0, money 6538/0, s02_hands desk chips 56/0.
- Screens: tests/e2e/sweep/fix-c-shots/{before,after}_{desk,phone}_{lobby,table}.jpg (each < 150 KB), after_phone_later_street.jpg.

## Not verified
Real iOS/Android browsers (chromium only), landscape phones (>600 px wide gets the desktop layout), 6-9 handed tables at 390 px (seats are 84 px wide and will crowd; only 2-handed was played), the :has() rule that hides the shell top bar at the table needs Safari 15.4+.
