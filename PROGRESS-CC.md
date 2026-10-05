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

## Milestone 3a: concept stills menu (done, waiting on Chris's pick)
Five concepts, four stills each (portrait, wide, low angle, mascot), 832x1248. Sent to Chris 2026-10-05 18:20; no pick yet.
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
Next in milestone 3, after the pick: one polished hero scene and the cutout symbol set in that look.

## Log
- 2026-10-05 18:50 Milestone 3a committed (concept menu). Frank re-ran `tests/coldcall.js` (27 pass) and `tests/bender.js` (17 pass); engine copies byte-identical.
- 2026-10-05 Milestone 2 done: engine, server module, sim, 27 tests; 200M-spin sim 98.10% +- 0.10; buys 97.99% / 98.07%.
- 2026-10-05 17:50 Milestone 1 plan written. Branch created from master bffe087.
