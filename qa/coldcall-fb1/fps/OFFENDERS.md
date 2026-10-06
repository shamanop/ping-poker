# COLD CALL FB5 offenders: before

Evidence for where frame time and load time go, from before.json (http://100.104.51.99:4650/games/coldcall/index.html, 1440x900, RTX 5090). Numbers are from this run; nothing here is from reading the code.

## 1. Kill-switch experiments (cause, not correlation)

One CSS rule injected after load, same seeded round, full trace. Cost columns: main thread busy %, raster-thread ms per second, GPU-process thread ms per second, painted area per second (screens). Lower than control = that property costs that much.

### idle: idle 10 s

| variant | main busy % | raster ms/s | GPU-proc ms/s | painted screens/s | saved vs control: main % / raster ms/s / GPU ms/s |
|:---|---:|---:|---:|---:|---:|
| control | 2 | 0.1 | 2.2 | 2.08 |  |
| will-change:auto everywhere | 1.9 | 0.2 | 2 | 2.08 | 0.1 / -0.1 / 0.2 |
| filter:none everywhere | 2.3 | 0 | 0 | 0.2 | -0.3 / 0.1 / 2.2 |
| backdrop-filter:none everywhere | 2.4 | 0 | 0 | 0.2 | -0.4 / 0.1 / 2.2 |
| box-shadow+text-shadow:none everywhere | 5.1 | 0.3 | 2.6 | 2.08 | -3.1 / -0.2 / -0.4 |
| CSS animations off (animation:none) | 0.9 | 0.1 | 1.7 | 1.98 | 1.1 / 0 / 0.5 |
| mix-blend-mode:normal everywhere | 1.8 | 0.1 | 2.1 | 2.08 | 0.2 / 0 / 0.1 |
| #fx canvas + #sides props hidden | 3.8 | 0.3 | 3 | 0.78 | -1.8 / -0.2 / -0.8 |

### cascade: cascade win (4 cascades, x3.3)

| variant | main busy % | raster ms/s | GPU-proc ms/s | painted screens/s | saved vs control: main % / raster ms/s / GPU ms/s |
|:---|---:|---:|---:|---:|---:|
| control | 7.1 | 4.9 | 75.6 | 159.58 |  |
| will-change:auto everywhere | 11.4 | 7.6 | 117 | 158.55 | -4.3 / -2.7 / -41.1 |
| filter:none everywhere | 15.7 | 8.3 | 106 | 163.41 | -8.6 / -3.4 / -30.8 |
| backdrop-filter:none everywhere | 14.8 | 8.3 | 128 | 165.13 | -7.7 / -3.4 / -51.9 |
| box-shadow+text-shadow:none everywhere | 7.1 | 4 | 47.7 | 114.66 | 0 / 0.9 / 27.9 |
| CSS animations off (animation:none) | 4.4 | 3.7 | 75 | 89.54 | 2.7 / 1.2 / 0.6 |
| mix-blend-mode:normal everywhere | 6.5 | 4.7 | 74.1 | 160.01 | 0.6 / 0.2 / 1.5 |
| #fx canvas + #sides props hidden | 13.7 | 9.9 | 132 | 158.66 | -6.6 / -5 / -56.7 |

## 2. Animations running at survey time (document.getAnimations(), taken after each scene window)

Properties Chrome can run on the compositor: transform, translate, rotate, scale, opacity, filter, backdrop-filter. Anything else (box-shadow, background-position, width/height/top/left, clip-path, colour...) animates on the main thread and repaints. `filter` is compositor-run but is re-rasterised on the GPU every frame for the whole element.

| element :: animation | animated properties | main-thread (non-compositor) properties | duration ms / iterations | area px (largest) | simultaneous instances (max) | seen in |
|:---|---:|---:|---:|---:|---:|---:|
| i.a :: sidefloat | rotate, translate | - | 6200 / inf | 59359 | 11 | idle, spins10, cascade, bigwin, intro, bought, more, pick, pullIdle, info |
| div.side.l :: sidespin | rotate | - | 90000 / inf | 412988 | 1 | idle, spins10, cascade, bigwin, intro, bought, more, pick, pullIdle, info |
| div.side.r :: sidespin | rotate | - | 90000 / inf | 412988 | 1 | idle, spins10, cascade, bigwin, intro, bought, more, pick, pullIdle, info |
| img#hero :: sway | transform | - | 3400 / inf | 84720 | 1 | idle, spins10, cascade, bigwin, intro, bought, more, pick, pullIdle, info |
| button#spin.idle :: breathe | transform | - | 2400 / inf | 16839 | 1 | idle, spins10, cascade, bigwin, intro, bought, pullIdle, info |
| div#cap.pop :: bpop | opacity, transform | - | 350 / 1 | 13725 | 1 | idle, spins10, pullIdle |

## 3. Costly static styles on visible elements (computed style of every visible element)

Score = largest area x simultaneous instances x a rough weight (backdrop-filter 6, filter 4, blend/mask 3, box-shadow 2, will-change 1.5). Only a ranking aid; section 1 and 4 say what it actually costs.

| element | property | value | largest area px | instances (max) |
|:---|---:|---:|---:|---:|
| i.a | filter | drop-shadow(rgba(0, 0, 0, 0.6) 0px 10px 10px) | 59359 | 11 |
| div#stage | box-shadow | rgb(0, 0, 0) 0px 0px 0px 2px, rgba(0, 0, 0, 0.7) 0px 20px 80px 0px | 455625 | 1 |
| div#stage.bonus | box-shadow | rgb(0, 0, 0) 0px 0px 0px 2px, rgba(0, 0, 0, 0.7) 0px 20px 80px 0px | 455625 | 1 |
| div.card.info | box-shadow | rgba(0, 0, 0, 0.5) 0px 0px 30px 0px inset, rgba(0, 0, 0, 0.7) 0px 12px 30px 0px | 406934 | 1 |
| i.ttl | filter | drop-shadow(rgba(0, 0, 0, 0.4) 0px 8px 0px) drop-shadow(rgba(0, 0, 0, 0.65) 0px  | 123902 | 1 |
| img.sym | filter | drop-shadow(rgba(0, 0, 0, 0.55) 0px 3px 2px) | 3969 | 30 |
| img#hero | filter | drop-shadow(rgba(0, 0, 0, 0.55) 0px 8px 6px) | 84720 | 1 |
| div#reels | clip-path | clip-path | 118125 | 1 |
| i#ttl | filter | drop-shadow(rgba(0, 0, 0, 0.45) 0px 5px 0px) drop-shadow(rgba(0, 0, 0, 0.6) 0px  | 26040 | 1 |
| button#spin.idle | filter | drop-shadow(rgba(0, 0, 0, 0.7) 0px 6px 6px) | 16839 | 1 |
| div#cap.pop | filter | drop-shadow(rgb(26, 14, 8) 3px 0px 0px) drop-shadow(rgb(26, 14, 8) -3px 0px 0px) | 16610 | 1 |
| button#spin.run | filter | drop-shadow(rgba(0, 0, 0, 0.7) 0px 6px 6px) saturate(0.55) brightness(0.9) | 15314 | 1 |
| div#plNote.pl | box-shadow | rgba(120, 90, 10, 0.55) 0px 2px 0px 0px, rgba(0, 0, 0, 0.45) 0px 4px 5px 0px | 23653 | 1 |
| img | filter | drop-shadow(rgba(0, 0, 0, 0.6) 0px 2px 2px) | 1139 | 10 |
| button#pl_bank.k.hang | box-shadow | rgb(26, 14, 8) 0px 5px 0px 0px, rgba(0, 0, 0, 0.45) 0px 10px 10px 0px | 20026 | 1 |
| button#pl_more.k.more | box-shadow | rgb(26, 14, 8) 0px 5px 0px 0px, rgba(0, 0, 0, 0.45) 0px 10px 10px 0px | 15735 | 1 |
| i.hot.still | box-shadow | rgb(255, 208, 88) 0px 0px 0px 2px inset, rgba(8, 30, 50, 0.4) 0px -10px 14px 0px inset, rg | 3263 | 4 |
| div#winbox | box-shadow | rgb(0, 0, 0) 0px 3px 8px 0px inset, rgba(255, 244, 214, 0.55) 0px 2px 0px 0px | 12129 | 1 |
| b | text-shadow | rgb(92, 18, 11) 0px 2px 0px | 4474 | 5 |
| i.hot.still.pick | box-shadow | rgb(239, 90, 66) 0px 0px 0px 3px inset, rgb(26, 14, 8) 0px 0px 0px 3px, rgb(239, 90, 66) 0 | 3363 | 3 |
| div.chip | box-shadow | rgb(0, 0, 0) 0px 3px 8px 0px inset, rgba(246, 232, 196, 0.35) 0px 0px 0px 2px, rgba(0, 0,  | 4497 | 2 |
| h2 | text-shadow | rgb(176, 42, 29) 0px 4px 0px, rgba(0, 0, 0, 0.7) 0px 6px 6px | 16251 | 1 |

## 4. Compositor layers (CDP LayerTree, mid-scene snapshot) and repaint

| scene | layers | drawing layers | drawing area Mpx / root layer Mpx = overdraw | largest layers [compositing reasons] |
|:---|---:|---:|---:|---:|
| idle | 29 | 26 | 18.52 / 2.92 = 6.3x | #document 2160x1350 [RootScroller,OverflowScrolling]; div#app.calm 2160x1350 [Overlap]; ::before 1485x1485 [Overlap]; ::before 1485x1485 [Overlap]; div#stage 1170x1800 [Viewport,OverflowScrolling]; div#scene 810x1440 [Overlap]; ::after 688x1350 [Overlap]; ::after 688x1350 [Overlap] |
| spins10 | 29 | 26 | 18.53 / 2.92 = 6.3x | #document 2160x1350 [RootScroller,OverflowScrolling]; div#app 2160x1350 [Overlap]; ::before 1485x1485 [Overlap]; ::before 1485x1485 [Overlap]; div#stage 1170x1800 [Viewport,OverflowScrolling]; div#scene 810x1440 [Overlap]; ::after 688x1350 [Overlap]; ::after 688x1350 [Overlap] |
| cascade | 29 | 26 | 18.53 / 2.92 = 6.3x | #document 2160x1350 [RootScroller,OverflowScrolling]; div#app 2160x1350 [Overlap]; ::before 1485x1485 [Overlap]; ::before 1485x1485 [Overlap]; div#stage 1170x1800 [Viewport,OverflowScrolling]; div#scene 810x1440 [Overlap]; ::after 688x1350 [Overlap]; ::after 688x1350 [Overlap] |
| bigwin | 29 | 26 | 18.51 / 2.92 = 6.3x | #document 2160x1350 [RootScroller,OverflowScrolling]; div#app 2160x1350 [Overlap]; ::before 1485x1485 [Overlap]; ::before 1485x1485 [Overlap]; div#stage 1170x1800 [Viewport,OverflowScrolling]; div#scene 810x1440 [Overlap]; ::after 688x1350 [Overlap]; ::after 688x1350 [Overlap] |
| intro | 29 | 26 | 18.52 / 2.92 = 6.3x | #document 2160x1350 [RootScroller,OverflowScrolling]; div#app 2160x1350 [Overlap]; ::before 1485x1485 [Overlap]; ::before 1485x1485 [Overlap]; div#stage 1170x1800 [Viewport,OverflowScrolling]; div#scene 810x1440 [Overlap]; ::after 688x1350 [Overlap]; ::after 688x1350 [Overlap] |
| bought | 29 | 26 | 18.51 / 2.92 = 6.3x | #document 2160x1350 [RootScroller,OverflowScrolling]; div#app 2160x1350 [Overlap]; ::before 1485x1485 [Overlap]; ::before 1485x1485 [Overlap]; div#stage 1170x1800 [Viewport,OverflowScrolling]; div#scene 810x1440 [Overlap]; ::after 688x1350 [Overlap]; ::after 688x1350 [Overlap] |
| more | 28 | 25 | 17.64 / 2.92 = 6.0x | #document 2160x1350 [RootScroller,OverflowScrolling]; div#app.pl-on.pl-busy 2160x1350 [Overlap]; ::before 1485x1485 [Overlap]; ::before 1485x1485 [Overlap]; div#stage.bonus 1170x1800 [Viewport,OverflowScrolling]; div#board 810x1440 [Overlap]; ::after 688x1350 [Overlap]; ::after 688x1350 [Overlap] |
| pick | 28 | 25 | 17.68 / 2.92 = 6.1x | #document 2160x1350 [RootScroller,OverflowScrolling]; div#app.pl-on.pl-busy 2160x1350 [Overlap]; ::before 1485x1485 [Overlap]; ::before 1485x1485 [Overlap]; div#stage.bonus 1170x1800 [Viewport,OverflowScrolling]; div#board 810x1440 [Overlap]; ::after 688x1350 [Overlap]; ::after 688x1350 [Overlap] |
| pullIdle | 29 | 26 | 18.52 / 2.92 = 6.3x | #document 2160x1350 [RootScroller,OverflowScrolling]; div#app.pl-on.calm 2160x1350 [Overlap]; ::before 1485x1485 [Overlap]; ::before 1485x1485 [Overlap]; div#stage 1170x1800 [Viewport,OverflowScrolling]; div#scene 810x1440 [Overlap]; ::after 688x1350 [Overlap]; ::after 688x1350 [Overlap] |
| info | 35 | 31 | 20.93 / 2.92 = 7.2x | #document 2160x1350 [RootScroller,OverflowScrolling]; div#app 2160x1350 [Overlap]; ::before 1485x1485 [Overlap]; ::before 1485x1485 [Overlap]; div#stage 1170x1800 [Viewport,OverflowScrolling]; div.card.info 719x1714 [Overlap]; div#scene 810x1440 [Overlap]; div.card.info 758x1397 [Overlap] |

Paint events (main thread, per window, top 3 by painted area; area as % of the viewport; layer L0 is the root layer, so a hit there means the whole page content below it was repainted rather than one composited layer):

| window | node painted | times | avg area per paint | paint ms total |
|:---|---:|---:|---:|---:|
| idle: idle 10 s | I class='a'#L0 | 11 | 100% | 0 |
| idle: idle 10 s | #document#L0 | 2 | 100% | 0.3 |
| idle: idle 10 s | DIV id='sides'#L0 | 1 | 100% | 0 |
| cascade: cascade win (4 cascades, x3.3) | I class='cool'#L0 | 361 | 90% | 2.8 |
| cascade: cascade win (4 cascades, x3.3) | #document#L0 | 201 | 100% | 17.9 |
| cascade: cascade win (4 cascades, x3.3) | DIV class='cell'#L0 | 124 | 100% | 0.8 |
| bigwin: big win: click -> big-win card (big x13. | #document#L0 | 214 | 100% | 15.9 |
| bigwin: big win: click -> big-win card (big x13. | DIV class='cell'#L0 | 108 | 100% | 0.7 |
| bigwin: big win: click -> big-win card (big x13. | SPAN id='win' class='pop'#L0 | 54 | 100% | 0.4 |
| bigwin: big-win card held 3 s | I class='cool'#L0 | 216 | 100% | 1.8 |
| bigwin: big-win card held 3 s | #document#L0 | 180 | 100% | 13.4 |
| bigwin: big-win card held 3 s | DIV id='winbox'#L0 | 179 | 91.6% | 1.9 |
| intro: base spin to the BONUS! stamp | DIV class='cell'#L0 | 60 | 100% | 0.4 |
| intro: base spin to the BONUS! stamp | #document#L0 | 52 | 100% | 4.3 |
| intro: base spin to the BONUS! stamp | DIV id='balM' class='meter'#L0 | 37 | 90% | 0.4 |
| intro: bonus trigger flourish | #document#L0 | 3 | 100% | 0.6 |
| intro: bonus trigger flourish | IMG class='sym'#L0 | 3 | 100% | 0.1 |
| intro: bonus trigger flourish | IMG id='hero'#L0 | 1 | 100% | 0.1 |
| intro: bonus intro (PLACE THE CALL) | #document#L0 | 215 | 100% | 22.4 |
| intro: bonus intro (PLACE THE CALL) | DIV id='scene'#L0 | 200 | 90% | 12.1 |
| intro: bonus intro (PLACE THE CALL) | DIV class='cell'#L0 | 60 | 100% | 0.3 |
| bought: buy menu open 3 s | #document#L0 | 2 | 100% | 0.3 |
| bought: buy menu open 3 s | DIV class='scrim'#L0 | 1 | 90% | 0.1 |
| bought: buy menu open 3 s | DIV id='ov'#L0 | 1 | 90% | 0.1 |
| bought: full bought bonus (confirm -> SPIN accep | #document#L0 | 991 | 100% | 91.7 |
| bought: full bought bonus (confirm -> SPIN accep | DIV class='cell'#L0 | 573 | 100% | 3.1 |
| bought: full bought bonus (confirm -> SPIN accep | I class='cool'#L0 | 617 | 90% | 6.2 |
| bought: bonus intro | #document#L0 | 216 | 100% | 22.6 |
| bought: bonus intro | DIV id='scene'#L0 | 201 | 90% | 12.1 |
| bought: bonus intro | DIV class='cell'#L0 | 60 | 100% | 0.3 |
| bought: free spins (stage.bonus) | #document#L0 | 642 | 100% | 60.4 |
| bought: free spins (stage.bonus) | I class='cool'#L0 | 617 | 90% | 6.2 |
| bought: free spins (stage.bonus) | DIV class='cell'#L0 | 513 | 100% | 2.8 |
| bought: finale (card, BONUS COMPLETE) | #document#L0 | 94 | 100% | 6 |
| bought: finale (card, BONUS COMPLETE) | DIV id='winbox'#L0 | 90 | 93.2% | 1.1 |
| bought: finale (card, BONUS COMPLETE) | DIV class='amtw'#L0 | 89 | 90% | 0.4 |
| more: ONE MORE CALL prompt 8 s | #document#L0 | 80 | 100% | 7.7 |
| more: ONE MORE CALL prompt 8 s | SPAN id='ribR' class='r'#L0 | 80 | 90% | 0.7 |
| more: ONE MORE CALL prompt 8 s | DIV class='dec2'#L0 | 80 | 90% | 1.2 |
| pick: PICK YOUR LEAD prompt 8 s | #document#L0 | 80 | 100% | 5.7 |
| pick: PICK YOUR LEAD prompt 8 s | SPAN id='ribR' class='r'#L0 | 80 | 90% | 0.6 |
| pick: PICK YOUR LEAD prompt 8 s | DIV id='ribbon' class='ask'#L0 | 63 | 90% | 1.8 |
| pullIdle: leads strip + feed (mock idle) 8 s | I class='a'#L0 | 11 | 100% | 0.1 |
| pullIdle: leads strip + feed (mock idle) 8 s | #document#L0 | 2 | 100% | 0.3 |
| pullIdle: leads strip + feed (mock idle) 8 s | DIV id='sides'#L0 | 1 | 100% | 0 |

Animations that started inside each window (trace):

| window | started (element :: css animation name x count) |
|:---|---:|
| idle: idle 10 s | DIV id='cap' class='pop' :: bpop x2 |
| cascade: cascade win (4 cascades, x3.3) | DIV class='cell' :: (waapi/transition) x124; IMG class='sym' :: hit x22; DIV class='cell hit' :: (waapi/transition) x22; I class='hot' :: slap x19; I class='cool' :: cool x19; DIV class='cell sweep' :: wob x10 |
| bigwin: big win: click -> big-win card (big x13. | DIV class='cell' :: (waapi/transition) x108; DIV class='rv b t0' :: (waapi/transition) x24; IMG class='sym' :: hit x13; I class='hot' :: slap x12; DIV class='cell hit' :: (waapi/transition) x12; DIV class='cell under' :: opacity x12 |
| intro: base spin to the BONUS! stamp | DIV class='cell' :: (waapi/transition) x60; IMG class='sym' :: hit x3; DIV id='cap' class='pop' :: bpop x1; DIV class='stamp' :: (waapi/transition) x1; DIV id='shake' :: (waapi/transition) x1 |
| intro: bonus trigger flourish | DIV id='cap' class='pop' :: bpop x1; DIV class='scn rot' :: fadein x1; DIV class='ring' :: dialhint x1 |
| intro: bonus intro (PLACE THE CALL) | DIV class='cell' :: (waapi/transition) x60; DIV class='plate' :: (waapi/transition) x2; B :: winpop x2; DIV id='cap' class='pop' :: bpop x1 |
| bought: buy menu open 3 s | DIV class='scrim' :: fadein x1 |
| bought: full bought bonus (confirm -> SPIN accep | DIV class='cell' :: (waapi/transition) x575; DIV class='rv b t0' :: (waapi/transition) x74; IMG class='sym' :: hit x48; DIV class='cell hit' :: (waapi/transition) x40; I class='hot' :: slap x39; DIV class='cell under' :: opacity x39 |
| bought: bonus intro | DIV class='cell' :: (waapi/transition) x60; DIV class='plate' :: (waapi/transition) x2; B :: winpop x2; DIV id='cap' class='pop' :: bpop x1 |
| bought: free spins (stage.bonus) | DIV class='cell' :: (waapi/transition) x515; DIV class='rv b t0' :: (waapi/transition) x74; IMG class='sym' :: hit x48; DIV class='cell hit' :: (waapi/transition) x40; I class='hot' :: slap x39; DIV class='cell under' :: opacity x39 |
| bought: finale (card, BONUS COMPLETE) | DIV id='tierbg' :: opacity x1; DIV id='tier' :: opacity x1; BUTTON id='spin' class='idle' :: breathe x1 |
| pullIdle: leads strip + feed (mock idle) 8 s | DIV id='cap' class='pop' :: bpop x2 |

Top script functions by self time (FunctionCall, rig loop excluded):

| window | functions |
|:---|---:|
| idle: idle 10 s | (anon)@pull.js:123 0.3 ms; (anon)@game.js:751 0.2 ms; (anon)@game.js:682 0.1 ms; (anon)@:0 0 ms |
| cascade: cascade win (4 cascades, x3.3) | (anon)@game.js:691 12.1 ms; loop@game.js:46 10.4 ms; frame@fx.js:11 5.8 ms; (anon)@:0 2.4 ms |
| bigwin: big win: click -> big-win card (big x13. | (anon)@game.js:691 10.4 ms; loop@game.js:46 9.8 ms; frame@fx.js:11 3.4 ms; (anon)@:0 2.6 ms |
| bigwin: big-win card held 3 s | loop@game.js:46 16.3 ms; frame@fx.js:11 14.7 ms; (anon)@game.js:162 8 ms; (anon)@audio.js:92 0.6 ms |
| intro: base spin to the BONUS! stamp | (anon)@game.js:691 11.9 ms; loop@game.js:46 3.2 ms; (anon)@board.js:53 1.3 ms; (anon)@:0 0.3 ms |
| intro: bonus trigger flourish | (anon)@:0 0.6 ms; (anon)@pull.js:123 0 ms |
| intro: bonus intro (PLACE THE CALL) | frame@fx.js:11 4.7 ms; (anon)@:0 2 ms; (anon)@bonus.js:36 0.3 ms; next@:0 0.2 ms |
| bought: buy menu open 3 s | (anon)@game.js:145 0.3 ms; (anon)@pull.js:123 0.1 ms; (anon)@:0 0 ms; (anon)@game.js:200 0 ms |
| bought: full bought bonus (confirm -> SPIN accep | frame@fx.js:11 36.5 ms; loop@game.js:46 31.9 ms; (anon)@:64 21.9 ms; (anon)@:0 10.5 ms |
| bought: bonus intro | frame@fx.js:11 4.1 ms; (anon)@:64 4 ms; (anon)@:0 1.8 ms; (anon)@bonus.js:36 0.3 ms |
| bought: free spins (stage.bonus) | loop@game.js:46 20.8 ms; (anon)@:64 14.1 ms; (anon)@board.js:53 8.7 ms; frame@fx.js:11 8.4 ms |
| bought: finale (card, BONUS COMPLETE) | frame@fx.js:11 24 ms; loop@game.js:46 8.2 ms; (anon)@game.js:162 3.7 ms; (anon)@:64 2.2 ms |
| more: ONE MORE CALL prompt 8 s | tick@pull.js:133 5.7 ms; (anon)@pull.js:123 0.2 ms; (anon)@game.js:682 0.1 ms; (anon)@game.js:751 0 ms |
| pick: PICK YOUR LEAD prompt 8 s | tick@pull.js:133 6.1 ms; (anon)@pull.js:123 0.1 ms; (anon)@game.js:682 0.1 ms; (anon)@game.js:751 0 ms |
| pullIdle: leads strip + feed (mock idle) 8 s | (anon)@game.js:751 0.2 ms; (anon)@pull.js:123 0.1 ms; (anon)@game.js:682 0.1 ms |
| info: info screen 5 s | (anon)@pull.js:123 0.2 ms; (anon)@game.js:682 0.1 ms; (anon)@:0 0 ms |

## 5. Image sizes versus on-screen size x2 (largest on-screen use across all surveyed states, in CSS px; x2 = a 2x display)

A file is "oversized" when its pixel size is more than 1.25x the larger on-screen side x2. Wasted decoded memory = RGBA bytes beyond what the display size x2 needs (this is texture memory and decode time, not download bytes).

18 of 30 images are oversized; total wasted decoded memory 4.7 MB of 20.5 MB decoded.

| file | file px | largest on screen, css px (viewport) | x2 target | ratio | wasted decoded MB | file KB | used by |
|:---|---:|---:|---:|---:|---:|---:|---:|
| img/s3big_cups.webp | 512x512 | 164x164 (1440x900) | 328x328 | 1.6x | 0.6 | 28 | i.a |
| img/s3big_can.webp | 512x512 | 171x171 (1440x900) | 342x342 | 1.5x | 0.6 | 38 | i.a |
| img/s3big_rx.webp | 512x512 | 172x172 (1440x900) | 345x345 | 1.5x | 0.5 | 38 | i.a |
| img/s3big_headset.webp | 512x512 | 198x198 (1440x900) | 396x396 | 1.3x | 0.4 | 38 | i.a |
| img/s3_spin.webp | 366x366 | 137x137 (540x960) | 275x275 | 1.3x | 0.2 | 36 | button#spin.idle, button#spin.run |
| img/s3_bell.webp | 256x256 | 63x63 (1440x900) | 126x126 | 2x | 0.2 | 25 | img.sym |
| img/s3_cups.webp | 256x256 | 67x67 (540x960) | 134x134 | 1.9x | 0.2 | 14 | img.sym, img |
| img/s3_headset.webp | 256x256 | 67x67 (540x960) | 134x134 | 1.9x | 0.2 | 20 | img.sym, img |
| img/s3_note.webp | 256x256 | 67x67 (540x960) | 134x134 | 1.9x | 0.2 | 19 | img.sym, img |
| img/s3_pile.webp | 256x256 | 67x67 (540x960) | 134x134 | 1.9x | 0.2 | 17 | img.sym, img |
| img/s3_mug.webp | 256x256 | 67x67 (540x960) | 134x134 | 1.9x | 0.2 | 21 | img.sym, img |
| img/s3_rx.webp | 256x256 | 67x67 (540x960) | 134x134 | 1.9x | 0.2 | 18 | img.sym, img |
| img/s3_cash.webp | 256x256 | 67x67 (540x960) | 134x134 | 1.9x | 0.2 | 18 | img.sym, img |
| img/s3_can.webp | 256x256 | 67x67 (540x960) | 134x134 | 1.9x | 0.2 | 18 | img.sym, img |
| img/s3_ball.webp | 256x256 | 67x67 (540x960) | 134x134 | 1.9x | 0.2 | 19 | img.sym, img |
| img/s3_cashwad.webp | 256x256 | 67x67 (540x960) | 134x134 | 1.9x | 0.2 | 19 | img.sym, img |
| img/s3_phone.webp | 256x256 | 67x67 (540x960) | 134x134 | 1.9x | 0.2 | 27 | img.sym |
| img/s3_closer.webp | 256x256 | 67x67 (540x960) | 134x134 | 1.9x | 0.2 | 26 | img.sym |

Soft (file smaller than on-screen x2): img/hero.webp 434x434 shown 310x310.

Non-WebP raster files loaded: none (everything raster is already WebP).

## 6. First-load weight and time to first spin (tailnet)

Cold: 62 requests, 2043 KB over the wire (2020 KB bodies, 2020 KB decoded; identical, so nothing is compressed in transit), game ready at 4324 ms, last byte 4312 ms, first spin 874 ms. Warm reload: 61 requests, 23 KB, ready 361 ms.

| type | files | KB |
|:---|---:|---:|
| css | 2 | 51 |
| js | 12 | 214 |
| woff2 | 3 | 60 |
| json | 1 | 3 |
| webp | 42 | 1692 |
| ico | 1 | 0 |

Largest 12:

| file | KB | start ms | end ms |
|:---|---:|---:|---:|
| img/title.webp | 206 | 260 | 1449 |
| img/room.webp | 177 | 259 | 1624 |
| img/bezel.webp | 126 | 260 | 1526 |
| coldcall/game.js | 68 | 12 | 177 |
| img/desk.webp | 61 | 260 | 522 |
| img/s3big_closer.webp | 60 | 260 | 1526 |
| img/s3big_phone.webp | 56 | 260 | 1871 |
| img/s3big_bell.webp | 55 | 260 | 1871 |
| coldcall/engine.js | 51 | 12 | 93 |
| img/s3big_cashwad.webp | 44 | 260 | 1871 |
| img/s3big_mug.webp | 44 | 260 | 1871 |
| img/hero.webp | 43 | 259 | 3932 |

Text assets (js, css, json, html) sent uncompressed: 268 KB (a gzip/brotli pass typically takes 70-75% off these). Cache headers: index.html public, max-age=0; style.css public, max-age=0; game.js public, max-age=0; room.webp public, max-age=0: max-age=0 means every return visit revalidates every file (61 requests, 23 KB on a warm reload).

