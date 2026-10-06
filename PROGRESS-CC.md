# COLD CALL — progress (branch `coldcall`, built by Frank)

Second slot for The Ping. Game id `coldcall`. Play money only. Brief from Isabelle 2026-10-05.
This file is the status line: Isabelle reads it on GitHub. Newest milestone at the top of the log.

## Status

| Milestone | State |
|---|---|
| 1. Plan | done 2026-10-05 17:50 (below) |
| 2. Engine + sim + tests, measured RTP / bonus rate | done 2026-10-05 (numbers below) |
| 3. Concept stills menu, hero pick, symbol set (`cold-call/art/`) | not started |
| 4. Playable front end, both bonuses, SFX/MUSIC switches | not started |
| 5. QA pass, screenshots + numbers | not started |

## Milestone 1: the plan

### Base game: 5 reels x 3 rows, 243 ways
- Pays left to right, 3+ of a kind on adjacent reels from reel 1. No tumbles, no clusters: one spin, one result.
  Why ways, not paylines: nothing to draw across a phone screen, and it reads as the opposite of Bender's 6x5 tumble.
- Every pay is a whole number of tenths of the bet. All bet levels are multiples of 10 cents, so wins are exact integer cents
  with no rounding.
- Bet levels: the same list as Bender (10 .. 2500 cents).

### Symbols
| Kind | Id | What |
|---|---|---|
| Wild | `closer` | the salesman's wired face, reels 2-3-4 only, stands in for any regular symbol |
| High | `cash` | money signs |
| High | `pile` | cartoon pile of white powder |
| High | `rx` | prescription bottle, fake label (label text added in CSS, never in the image) |
| Mid | `headset` | headset |
| Mid | `can` | energy can, no brand |
| Low | `mug` | coffee mug |
| Low | `note` | sticky note |
| Low | `ball` | stress ball |
| Scatter | `phone` | rotary phone, reels 1-3-5 only; all three = Bonus A |
| Cash | `quote` | text bubble carrying an amount (x bet); 6+ anywhere = Bonus B |

### Bonus A: ROTARY (free spins)
- Trigger: a phone on reels 1, 3 and 5. Two landed = reel 5 spins long.
- The player spins the dial twice. Finger-stop 1 = number of free spins (5 .. 20). Finger-stop 2 = multiplier (x1 .. x5)
  on every ways win in the feature. The server has already picked both; the dial is the reveal.
- In free spins each phone that lands is a "callback": +1 spin. Capped spin count.

### Bonus B: QUOTE ACCEPTED (hold and respin)
- Trigger: 6+ quote bubbles in view. They leave the reels and drop into a checkout form.
- The form: CVV 3 boxes, EXPIRY 4, NAME 5, CARD 6 (18 boxes). 3 respins; any new quote resets to 3.
- Each new quote lands in a random empty box, so the short fields fill first and the long card number is the chase.
- Filling a field pays its tier on top of the amounts in it: CVV mini, EXPIRY minor, NAME major, CARD mega.
  All four filled = PAYMENT ACCEPTED, the grand.
- My one addition: a rare UPSELL bubble. It doubles every amount in the field it lands in.
- Ends when respins run out or the form is full. Pays the sum of all amounts + field prizes.

### RTP split (target 98.0% total)
| Part | RTP | Frequency |
|---|---|---|
| Base ways wins | about 60% | hit rate about 30% |
| Bonus A, ROTARY | about 21% | about 1 in 170 spins |
| Bonus B, QUOTE ACCEPTED | about 17% | about 1 in 240 spins |
| Any bonus | | about 1 in 100 spins |

- MAX_WIN cap 10,000x bet, enforced in the engine.
- Buy options: one per bonus. Price = measured average bonus value / 0.98, then re-simulated AT that price (the gap the
  brief names on Bender).
- Levers: per-reel symbol weights, one pay-table scale, phone weight, quote weight, respin landing chance, field prizes.

## Milestone 2: measured

Final sim, 200,000,000 plain spins, seed 20261005, 6 threads (`nice -n 15 node games/coldcall-sim.js 200000000 20261005`), levers as committed:

| Metric | Measured | Plan |
|---|---|---|
| Total RTP | 98.098% +- 0.103 (95%) | 98.0 +- 0.3 |
| Hit rate (base ways pay) | 31.20% (any win incl. bonuses 32.03%) | 28-32% |
| ROTARY | 1 in 173.5, avg value 36.06x | 1 in 170 |
| QUOTE ACCEPTED | 1 in 244.6, avg value 41.80x | 1 in 240 |
| Any bonus | 1 in 101.6 (both on one spin: 1,276 times) | 1 in 100 |
| RTP by part | base ways 60.23 (+-0.04), ROTARY 20.78 (+-0.06), QUOTE 17.09 (+-0.08) | 60 / 21 / 17 |
| Max win seen | 2,504x | cap 10,000x |
| Cap (10,000x) hit | 0 times in 200M (enforced and tested with a low cap; natural reach is rarer than 1 in 200M) | |
| QUOTE grand (all 4 fields) | 549 times, 1 in 364,299 spins | |

Buys (30,000,000 runs each, same seed), price = measured avg / 0.98 rounded to a whole tenth, then re-simulated at that price:

| Buy | Avg bonus value | Price | RTP at that price |
|---|---|---|---|
| ROTARY | 36.060x (+-0.015) | 36.8x (368 tenths) | 97.99% (+-0.04) |
| QUOTE ACCEPTED | 41.778x (+-0.028) | 42.6x (426 tenths) | 98.07% (+-0.07) |

Final levers (top of `games/coldcall-engine.js`): reel weights per reel `[cash, pile, rx, headset, can, mug, note, ball, closer]` =
`[3,4,5,7,8,9,10,10, 0|3|3|3|0]`, phoneW 4.4, quoteW 7.65, free spins use the same strips with no bubbles, payScale 1 (pay table is explicit integers in tenths per way,
3/4/5 of a kind: cash 25/100/400, pile 20/70/250, rx 12/45/140, headset 6/18/55, can 4/10/24, mug 3/7/12, note 2/5/9, ball 2/4/7),
dial spins 5..20 (weights 14,14,13,12,12,10,9,7,5,4), dial multiplier x1..x5 (55,28,11,4,2), free-spin cap 30, landP 0.047 per empty box per respin,
upsellP 0.02 (max x8 per field), field prizes mini 5x / minor 15x / major 50x / mega 200x, grand 2,000x.

Rules as built (small things the plan left open): phones and bubbles pay nothing by themselves; QUOTE plays before ROTARY if one spin triggers both;
an UPSELL bubble fills a box, carries no amount and doubles its field's amounts (up to three doublings); each empty box gets a bubble with probability landP on every respin
(same thing as "random empty box"); a QUOTE buy starts with a bubble count drawn from the same distribution as natural triggers (6-15).
Script shape: `resolveRound(rng, buy)` -> `{winTenths, costTenths, script:{base:{grid,wins,phones,quotes,tease,triggers}, features:[{kind:'quote'|'rotary',...}]}}`.
Server events `g:coldcall:state|history|spin` -> `g:coldcall:result`; buy ids `rotary` and `quote`. Tests: `node tests/coldcall.js` (27). Not wired into `npm test`, same as Bender.

## Rules I am holding to
- Branch `coldcall` only. No push to master, no deploy.
- Own clone (`projects/ping-coldcall` on Frank's box), dev port 4610, at most 2 browser processes, kill by PID.
- No paid APIs: art on shaman's local models (GPU lock first), code written here.
  One exception, asked for by Chris directly (2026-10-05 17:54): the concept stills menu was made with GPT image
  through OpenRouter, $3.31 (`cold-call/art/concepts/spend.jsonl`). Nothing else has used a paid API.

## For Isabelle (updated 2026-10-05 19:50)
- **Look:** Chris picked concept still A1 (Boiler Room, painted caricature) at 18:45, then approved the tile sheets
  ("this looks perfect"; one change, the powder pile without the donut, done).
- **Real art is in the game and pushed** (`2c18f07`): 12 reel symbols, the idle hero and a background, cut from the approved
  sheets, swapped in through `public/games/coldcall/assets/symbols.json` with no code change. Screenshots: `qa/coldcall-art/`.
- **Milestone 4 is built** (`5c74fdd`): playable front end with both bonuses, buys, SFX/MUSIC switches, the gated QA hook.
  Its own honest gaps are listed at the end of the Milestone 4 section. I re-ran the tests after the art went in: 31 + 17 pass.
- **In progress now (skin wave):** frame/buttons/bar from the blue placeholder skin to the painted boiler-room look, the two bonus
  screens with the painted dial/card-machine/seal pieces, hero moods on events, title and splash. Then milestone 5 QA.
- **Image credit: $1.45 left** on the OpenRouter key you gave me (cap $15). OpenAI direct and my own OpenRouter account are empty.
  Still to paint once there is credit: an empty office background, a clean dial, a frame, title art. Chris has been asked.
- Chris asked for GPT-made art himself (17:54), so art is the one place this build uses a paid API. He cleared shaman for
  compute and testing.

## Milestone 3a: concept stills menu (done; Chris picked A1)
Five concepts, four stills each (portrait, wide, low angle, mascot), 832x1248. Sent to Chris 2026-10-05; he picked A1 at 18:45.
Contact sheets: `cold-call/art/concepts/sheet_A.jpg` .. `sheet_E.jpg`. Single stills: `cold-call/art/concepts/stills/A1.jpg` .. `E4.jpg`
(JPEG copies; the 37 MB of source PNGs stay on Frank's box in `raw/`, not in git). Prompts: `gen_concepts.py`.

| | Concept | Look |
|---|---|---|
| A | Boiler Room | painted caricature, warm office yellows |
| B | Graveyard Shift | flat shapes |
| C | Rubber Hose | 1930s cartoon |
| D | Jackpot Poster | glossy 3D, purple and gold |
| E | Clay | stop-motion clay |

No text is drawn in any still; labels on the sheets are added afterwards. No brands, no drug names.

## Milestone 3b: tile design sheets in the A1 look (sent to Chris, waiting on his notes)
Five design sheets, six pieces each, painted in the A1 style on flat slate-blue. These are design sheets for Chris to mark up,
NOT final cutouts. Files: `cold-call/art/tiles/sheet_T1.jpg` .. `sheet_T5.jpg` (source PNGs stay local in `raw/`), prompts in
`gen_tiles.py`, spend $0.87 in `spend.jsonl`.

| Sheet | Pieces |
|---|---|
| T1 | high pays + wild: two wild faces, cash wad, gold money sign, powder pile, pill bottle |
| T2 | low + mid pays |
| T3 | scatter + bonus symbols |
| T4 | bonus screens + buttons: dial, card machine, blank card, spin button, approved seal, desk frame |
| T5 | salesman moods |

Next, after Chris's notes and the credit top-up: each kept piece painted alone at full size and cut out to the manifest ids
(closer, cash, pile, rx, headset, can, mug, note, ball, phone, quote), plus the A1 scene as the background.

## Log
- 2026-10-05 19:50 Milestone 4 verified by Frank (tests 31 + 17, engine copies identical, screenshots read). Skin wave started.
- 2026-10-05 18:58 Look locked to A1 (Chris). Tile design sheets committed (milestone 3b).
- 2026-10-05 18:50 Milestone 3a committed (concept menu). Frank re-ran `tests/coldcall.js` (27 pass) and `tests/bender.js` (17 pass); engine copies byte-identical.
- 2026-10-05 Milestone 2 done: engine, server module, sim, 27 tests; 200M-spin sim 98.10% +- 0.10; buys 97.99% / 98.07%.
- 2026-10-05 17:50 Milestone 1 plan written. Branch created from master bffe087.

## Milestone 4: playable front end (2026-10-05, built by Frank on placeholder art)
Status table above is stale for row 4 (left untouched on purpose): this milestone is built, QA'd on my box, not yet reviewed by Chris.

**Built.** `public/games/coldcall/`: `index.html`, `style.css` (all colours/fonts/sizes in `:root` variables), `game.js` (reels, win presentation, counters, big-win overlay, buy + info modals, bet/mode, three transports), `rotary.js` (dial + free spins), `quote.js` (checkout form), `audio.js` (synthesized WebAudio), `fx.js` (canvas particles), `captions.js` (speech bubble), `assets.js` (manifest loader), `boot.js`, plus the untouched byte-identical `engine.js`.
The browser only animates the server script; the running total only ever adds (`ctx.addWin` is clamped to the server round total; a mismatch is recorded in `CC.dbg.mismatch`, 0 seen).
- **Art swap:** everything loads through `assets/symbols.json` (12 symbols + hero + background; hero entry carries the mouth point the speech tail aims at). Placeholders are Twemoji SVGs (CC-BY 4.0), sources in `cold-call/art/SOURCES.md`. Vector, so the "2x display size" rule only matters once raster art arrives; the loader logs a warning for low-res raster art.
- **Shell wiring:** `public/shell.js` +32/-3 lines: a parallel Cold Call bridge block (own request queue, same postMessage protocol as Bender), a dock icon, and one changed line so errors tagged `game:'coldcall'` are not routed into Bender's queue. No change to lobby/index pages or Bender.
- **Rules from the brief:** no looping `<audio>` trick (zero `<audio>` elements, context created/resumed on first gesture), looping CSS animations freeze via `#app.calm` (idle 8 s, tab hidden, window blur/docked), 2 rAF loops max (one shared count-up ticker + the fx canvas), images decoded during the splash, `#ov`/scene/fx/floats swept after every round, SFX and MUSIC are separate switches stored in `ping.sfx` / `ping.music`, caption bubble sized to its text and fitted once per line, CSS grid layout, stage 540 wide x 960..1250 scaled to fit.

**Run it.**
```
mkdir -p _scratch/srv && echo '{}' > _scratch/srv/bank.json && echo '[]' > _scratch/srv/ledger.json
COLDCALL_TEST=1 PORT=4610 BANK_FILE=$PWD/_scratch/srv/bank.json LEDGER_FILE=$PWD/_scratch/srv/ledger.json node server.js   # accounts/wallet files land next to bank.json
http://127.0.0.1:4610/games/coldcall/index.html?live=1&name=NAME&pin=1234      # standalone against the dev server (auto login/sign-up)
  add &force=rotary|quote|big (QA, needs COLDCALL_TEST=1 server side), &nosplash, &buy=rotary|quote
http://127.0.0.1:4610/games/coldcall/index.html                                # practice: no wallet, local engine copy (like Bender's practice mode)
http://127.0.0.1:4610/  -> sign in -> dock icon "Cold Call"                    # through the shell (?bridge=1 iframe)
```
**Test hook and its gate.** Spin payload `force: 'rotary' | 'quote' | 'big'` (`big` = reroll plain spins until >= 25x, `both` is not offered: a natural double trigger is ~1 in 157,000). Honoured only when `process.env.COLDCALL_TEST === '1'` AND `NODE_ENV !== 'production'`, read per call; the state event carries `qaHook:true` and the result `forced` only then. A force on a buy is dropped. Forced rounds are real engine rounds through the normal spend/credit path. 4 new tests in `tests/coldcall.js` (hook ignored without the env var, ignored with `NODE_ENV=production`, ignored for `0/true/yes`, and accounting exact when on).

**Verified (numbers).** `node tests/coldcall.js` 31 pass (27 + 4), `node tests/bender.js` 17 pass, engine copies byte-identical (`cmp`). Headless Chromium (software GL), 540x960, dev server on 4610, scripts in `_scratch/` (gitignored):
- 8 real clicked spins on the live socket: displayed balance == server wallet to the cent after every spin (asserted in the script); the win text matched the script's win in every logged row (read by eye, not asserted).
- Final-code session: forced ROTARY 3 rounds, forced QUOTE 5 live rounds plus 1 grand round in a practice page, forced BIG 1 round (a 1027-tenth QUOTE round; earlier sessions ran more of each; the last two cosmetic edits, float positions on the form, were re-checked on the grand round and the big round only). ROTARY: dial dragged with the mouse for stop 1 and tapped for stop 2 in every round; the dial stops where the script says and the chips show the script's values (by construction: the dial resolves the hole from `script.dial.*.value`, I did not add an independent check of the dial angle). QUOTE: bubbles carry their amounts on the reels, fly into the form, respins, upsell, field prizes (MAJOR seen on a live round). BIG: overlay counts up, closes, 0 leftover nodes, fx loop stopped.
- Running total sampled every 100 ms (about 1,300 to 2,000 samples per bonus run): 0 blank, 0 decreases inside a round (it resets to $0.00 only when the next paid round starts). This found and fixed a real bug: a count-up could dip 1 cent when a frame timestamp preceded its start time.
- Max pending rAF callbacks from game scripts: 2 (instrumented). Looping animations: `calm` set after idle, `animation-play-state: paused` on hero/spin, cleared on input; blur also freezes.
- SFX/MUSIC: independent, persisted across reload, music does not start when off; AudioContext `running` after the first click, `none` before.
- Through the real shell at 1280x800: dock icon, bridge init, spins, shell wallet == game balance, docked at 360 px wide (`shell_docked_narrow.jpg`), mode bar works.
- Screenshots (24 files, all < 110 KB) in `qa/coldcall-m4/`: `base_idle`, `base_win`, `rotary_dial*`, `rotary_freespins*`, `rotary_complete`, `quote_trigger`, `quote_form_midfill`, `quote_respin`, `quote_field_prize`, `quoteGrand_payment_accepted`, `bigwin_overlay`, `bigwin_closed`, `buy_confirm`, `shell_*`.

**Unfinished or unverified (honest list).**
- Audio is synthesized and its graph/switches are checked, but nobody has listened to it (headless box): levels, ducking and the hold-music loop are unjudged. Not tested on iOS Safari or a touch screen; no real GPU/phone frame times (software GL only).
- PAYMENT ACCEPTED was verified on a real-engine round with the respin landing chance forced to 1 in a practice page, not a natural round (natural grand is ~1 in 364,000). Quote-then-ROTARY in one round (two features) and a bought bonus run to the end in the browser were not exercised; the buy flow was checked only to the confirm/cancel step (the server side of buys is covered by tests). The reel-5 tease animation exists but was not specifically captured.
- Lobby feed, achievements and "biggest win today" still only know Bender (`social.js`, `lobby.js` untouched to keep shared-file diffs small).
- Practice mode (no wallet, no server) resolves rounds with the local engine copy for animation, like Bender's practice mode; with a server attached the client never decides anything.
- Hero mouth point and all sizes are tuned for the placeholder art; the final art pass will need new mouth coordinates and a look at the dial/form themes.
- Another process is writing into `cold-call/art/tiles/` in this clone (modified `spend.jsonl`, new `gen_one.py`, `pile_nodonut.jpg`); I did not stage or touch those.
