# COLD CALL — progress (branch `coldcall`, built by Frank)

Second slot for The Ping. Game id `coldcall`. Play money only. Brief from Isabelle 2026-10-05.
This file is the status line: Isabelle reads it on GitHub. Newest milestone at the top of the log.

## Status (updated 2026-10-06 00:10)

**Not green yet.** The high-volatility retune is merged (six of seven targets met, one MISSED: see "Retune result"); a second
tuning pass on the missed target is running; the full three-size QA pass has not run. Nothing goes to master (Chris's hold, see Rules).

| Part | State |
|---|---|
| Engine v2 (6x5 clusters, super cascade, hot leads, phone feature, 3 bonuses) | on this branch at the retuned config `c14`, with the contract `cold-call/ENGINE-V2.md` and final re-simulated buy prices. |
| **Math retune to high volatility** | pass 1 DONE and merged: `cold-call/RETUNE.md` (table), `cold-call/RETUNE-NOTES.md` (log), raw run outputs in `cold-call/retune-runs/`. **Pass 2 RUNNING since 00:05** on the missed target (bigger base hits) and the `hunt` buy; it changes the engine only if every target holds together, otherwise it reports the limit. |
| Board front end v2 (cascades, hot leads, reveal / upsell / close, 3 bonuses, buys, info) | built: `f862e27`, `fe1eb0b`; shots in `qa/coldcall-v2/`. I have NOT reviewed the shots myself yet. Its builder is still looking at a slow big-win overlay and a possible stuck round; no result yet. |
| Master merged in + Chips | `2f0da2c` = master `b0c20e7` merged (0 behind), Cold Call ported from Ledger $ to Chips the way Bender was. NOT browser-smoked since the merge. |
| Skin in the A1 look | done `3c75d02`; shots in `qa/coldcall-skin/` |
| v1 (5x3, 243 ways, ROTARY + checkout form) | retired; last working commit `e5a6af6` |

### Isabelle's verification list (22:55), item by item
| # | Item | State |
|---|---|---|
| 1 | Before/after table (RTP +-CI, hit %, bands, bonus frequency and average, buy RTPs, max win) | DONE for config `c14`: `cold-call/RETUNE.md`. I checked its numbers against the raw run outputs; I did not re-run the sims. One target missed, one buy out of band (below). May gain an AFTER-2 column from pass 2. |
| 2 | Money settlement, Play $ and Chips | SERVER side done at this commit: one test, 480 rounds per currency over every bet level and every buy; on each round balance before - cost + win = after, whole units only, the other purse does not move, the pushed wallet equals the settled one, a same-instant double click is refused and not charged; bad amounts were already covered. BROWSER side (win meter = amount credited, fast clicks on the real button) NOT done: part of item 4. |
| 3 | Engine byte-sync test | exists, passes at this commit |
| 4 | Headless real-spin QA, 15+ spins, each bonus forced, a big win; 1440x900, 540x960, docked | NOT done. Runs after the retune is merged, on a restarted dev server. |
| 5 | All tests pass | after the retune merge: `tests/coldcall.js` 47 pass, `tests/bender.js` 19 pass, engine copies byte-identical, run by me. The `npm test` chain: not run by me; `preselect`, `allin`, `pause`, `reset` hard-code `/home/isabelle/.cache` and are reported to fail the same way on master on this box. |

### Retune result, config `c14` (builder's runs on shaman, 24 threads; full table in `cold-call/RETUNE.md`)
| Target | BEFORE | AFTER (c14) | Verdict |
|---|---|---|---|
| RTP 98.0 +-0.3, stratified (450M base + 8M per bonus) | 98.10% +-0.14 | 97.95% +-0.11 | met |
| Hit rate 20-24%, whole round | 32.22% | 20.68% | met, low edge |
| Spins paying under 1x, at most about 5% | 24.93% | 0% | met |
| Any bonus 1 in 180-220 | 1 in 156.2 | 1 in 206.7 (bonus 1: 224, bonus 2: 2,832, bonus 3: 44,092) | met |
| Average natural bonus 90-120x | 79.6x | 102.9x | met |
| Bonuses 45-55% of RTP | 52.0% | 50.8% | met |
| **5x+ wins carry more of the RTP (bigger base hits)** | 82.0% of RTP | **73.1%** | **MISSED** |
| Max win 10,000x | 10,000x, 1 in 3.92M | 10,000x, 1 in 3.28M | met |
| Buys at value / 0.98, re-simulated | see below | call 2.9x 97.92% +-0.14; bonus1 85.6x 97.99% +-0.12; bonus2 283.4x 97.95% +-0.07; **hunt 3.5x 99.15% +-0.25** | hunt is 0.85 over the band |

- **The miss, plainly:** in the base spin alone, wins of 5x and more went from 1 in 58 spins (29.3 points of RTP) to 1 in 78
  (21.7 points). Most hits are now pushes: 14.5% of spins pay 1-2x, averaging 1.06x. The first pass used none of the 5% allowance
  for wins under 1x. Pass 2 aims for 5x+ at 78% of RTP or better and a base 5x+ hit at 1 in 62 or better, with every other target
  held. If those cannot hold together, the engine stays at `c14` and the limit is reported here for Isabelle and Chris to choose.
- **By the single-number measure the game is not more volatile:** the standard deviation of a round fell 18.6x -> 16.7x bet,
  because bonus 3 is rarer and smaller. More spins lose (79.3%, was 67.8%) and the average bonus is bigger.
- **Cheap buy:** bonus1 prices at 85.6x, not the roughly 100x expected, because bonus 1 averages 83.8x.
- **`hunt`:** one whole tenth is 2.9% of a 3.5x price, so the rounding rule alone put it at 99.15%. Pass 2 tunes its bonus
  chance to land in the band.
- **Not counted yet:** the share of hits paying exactly 1.0x (pass 2 counts it).

### BEFORE column (old volatility, engine config of `808567d`; builder's runs on shaman, not re-run by me)
- RTP 98.10% +-0.14 stratified (450M base spins + 8M runs per bonus); plain 200M cross-check 97.94% +-0.26.
- Hit rate 32.22% whole round, 31.91% base only. Any bonus 1 in 156.4 (bonus 1: 171, bonus 2: 1,926, bonus 3: 25,803).
- Average bonus 79.6x (bonus 1 50.2x, bonus 2 289.6x, bonus 3 1,684x). Bonuses 52.0% of RTP.
- Max win 10,000x; the cap was hit 51 times in 200M spins (1 in 3.92M).
- Buys at the old prices: call 4.6x 98.82% +-0.53; bonus1 51.3x 98.00% +-0.16; bonus2 297.1x 97.99% +-0.08; hunt 4.1x 97.35% +-1.23.

| Band (round win / bet) | % of spins | % of RTP |
|---|---|---|
| 0 | 67.78 | 0 |
| under 1x | 24.93 | 8.44 |
| 1-2x | 3.337 | 4.43 |
| 2-5x | 1.671 | 4.75 |
| 5-20x | 1.461 | 15.49 |
| 20-100x | 0.696 | 28.28 |
| 100-1000x | 0.120 | 27.65 |
| 1000x+ | 0.005 | 8.89 |

Retune targets (replace every older target in this file): RTP 98.0% +-0.3 stratified; whole-round hit rate 20-24%; wins under 1x
on at most about 5% of spins; any bonus 1 in 180-220; average natural bonus 90-120x; bonuses 45-55% of RTP; cap 10,000x; buys
priced at measured value / 0.98 and re-simulated at that price.

### v2 plan (Le Bandit's rules, Cold Call's names)
- 6 columns x 5 rows. A win is 5+ of the same symbol connected. 10 regular symbols (low: mug, note, ball, can, cups; high:
  headset, rx, pile, cashwad, cash) + wild (closer). Scatter = bell. "Rainbow" = the ringing phone.
- Super cascade: a win removes its symbols AND every other symbol of that type on the grid; new ones drop; repeat.
- HOT LEADS: every square that was part of a win is marked. If a phone is on the grid when the wins are paid, every hot lead
  reveals a quote bubble (bronze 0.2-4x, silver 5-20x, gold 25-500x), an UPSELL (multiplies its neighbours x2-x10) or THE CLOSE
  (card machine: collects every bubble and other close; then the other squares reveal again until no new close appears).
- Bonuses: 3 bells DIALING FOR DOLLARS (8 spins, leads stay until a phone uses them); 4 bells ALWAYS BE CLOSING (12 spins,
  leads stay all bonus); 5 bells QUOTE ACCEPTED (12 spins, a phone every spin, no bronze; cannot be bought).
  The rotary dial stays as the bonus intro (a reveal only).
- Targets: RTP 98%, cap 10,000x, hit rate about 32%, any bonus about 1 in 150 to 200 spins (Le Bandit's shape; RARER than the
  brief's 1 in 100: Isabelle or Chris can overrule), buys priced at measured value / 0.98 and re-simulated at that price.

## Milestone 1: the plan (v1, 243 ways; SUPERSEDED 2026-10-05 20:02)

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

## Milestone 2: measured (v1 engine, RETIRED)

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
- Branch `coldcall` only. No push to master, no deploy. The merge into master is Isabelle's (Chris 22:45), never mine.
- **HOLD, Chris 2026-10-05 21:29: "dont push it live yet we are playing".** Nothing to master, no pull request against master,
  no deploy, by me or any builder, until Chris says so in his own words. Pushes to `coldcall` continue.
- Own clone (`projects/ping-coldcall` on Frank's box), dev port 4610, at most 2 browser processes, kill by PID.
- No paid APIs: art on shaman's local models (GPU lock first), code written here.
  One exception, asked for by Chris directly (2026-10-05 17:54): the concept stills menu was made with GPT image
  through OpenRouter, $3.31 (`cold-call/art/concepts/spend.jsonl`). Nothing else has used a paid API.

## For Isabelle (updated 2026-10-05 23:30)
- **THE HAND-OVER IS YOURS. Chris, topic 10, 22:45, his words: "send it to isabelle to fork into the repo".** When the list in
  Status is all green, you merge `coldcall` into master yourself. Frank will not push master and will not open a pull request.
  Chris's 21:29 hold still stands ("dont push it live yet we are playing"), and your 22:56 note says the same.
- **Flag for you and Chris, not a blocker: Chips exposure.** With Chips now a slot currency, Cold Call's top bet (2,500) times
  the 10,000x cap is a 25,000,000-chip win against the poker bank. If chips are ever settled between friends, someone is the
  counterparty to that. Bender has the same exposure. Your call whether Chips mode gets a lower top bet or a lower cap.
- **Branch state:** `coldcall` has master `b0c20e7` merged in (0 commits behind, merges clean) and plays in Play $ and Chips.
- **Your 22:55 retarget is taken** (high volatility, verification list). Progress is the table in Status. It supersedes the
  bonus-rate line in Chris's delegated calls below (now 1 in 180-220).
- **Engine direction, Chris 20:02:** "I want the game engine to be very similar to le bandit". This overrode your "feel different
  from Bender" line. His delegated calls (21:30, "just use your best judgement"): the checkout form is dropped as its own bonus,
  the dial stays as the bonus intro, the top bonus is QUOTE ACCEPTED; it ships as a Bender cousin.
- **Look:** Chris picked concept still A1 (18:45) and approved the tile sheets ("this looks perfect"). Real art is in the game.
- **Image credit: $1.45 left** on the OpenRouter key you gave me (cap $15), as of 20:00. OpenAI direct and my own OpenRouter
  account are empty. Still to paint once there is credit: an empty office background, a clean dial, a frame, title art.
- Art is the one place this build used a paid API (Chris asked for GPT-made art himself, 17:54). He cleared shaman for compute.
- I have no line out to you: ask me for a reply, or read this file.

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
- 2026-10-05 21:35 Skin wave verified (tests 31 + 17 before the merge; shots read). Engine v2 merged at `33ca611` (46 + 17 pass, copies identical). Board v2 builder started.
- 2026-10-05 20:10 Direction change (Chris): engine v2, Le Bandit style. v1 engine retired, kept in history. Engine v2 builder started.
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


## Skin wave (2026-10-05, Frank): the rest of the screen painted to match A1

Front end only. Engine copies, `games/`, `server.js`, `public/shell.js` and Bender untouched. Game behaviour unchanged (the only logic added is the dead-spin counter that picks the `rage` mood).

**What changed**
- **Palette (sampled from A1 with PIL, all in `:root` of `style.css`):** wood `#4a2c12`/`#26160a`, dark umber `#150e06`, nicotine cream `#f1e3c1`, paper `#e7d6ac`, bakelite `#bfab80`, brass `#c8984a`/`#f0d083`/`#7d5a1f`, tie red `#a3281b`, seal green `#46592a`. Cells are a lamp-lit recess (`--tile-lit #54401f` centre to `--tile #2a1c0d` edge) so cream/beige pieces (headset, mug, note, pile) and dark ones (can, rx) both read. Type: Alfa Slab One (display), Courier Prime Bold (text), Special Elite (memo), subset woff2, ~66 KB.
- **Base screen:** brass nameplate ribbon with rivets, wood housing with brass rim, lamp-window WIN readout, bakelite keys, painted `spin` piece with the word SPIN as HTML over the dome, typed-memo speech bubble (inked outline incl. tail), dark-leather modals with brass rim and paper buy slips, big-win overlay with `hero_win` and two `cashwad` pieces, toasts and stamps as paper slips. `bg.jpg` is cropped (170%, right/top, masked into the wood desk) so the ghost face is out of frame.
- **ROTARY:** CSS bakelite dial (pewter ring, beige plate with grain, deep finger holes with brass rim, worn number plate hub, brass finger stop), two `phone_gold` flank the title, `hero_win` on the finale card.
- **QUOTE ACCEPTED:** a carbon payment slip on the wood desk, empty boxes recessed, filled boxes inked in green, a seal slot per field that takes the green wax `seal` when the field pays, `cardmachine` + `card` on the desk, PAYMENT ACCEPTED drops the `seal` at 236 px with a stamped slip across it.
- **Title/splash:** ONE idea, a rubber stamp. COLD CALL stamped in tie-red double border on a taped lead sheet (speckle mask from `stampmask.webp`), typed memo header, the hero leaning over the sheet, brass PICK UP key. All HTML/CSS type, no text in images.
- **Manifest** (`assets/symbols.json`) now also holds `hero.moods` (file + mouth point each), `pieces`, `textures`, `fonts`. `assets.js` decodes every image in the splash, waits for the three fonts, and sets `--img-bg`, `--img-<piece>`, `--img-<texture>` on `:root`; `style.css` has no image path (only the three font files). `assets/img` is 614 KB (placeholder SVGs deleted).

**Hero moods (`hero.js`, `CC.hero.set(mood, ms)`)**
| Event | Mood | Held |
|---|---|---|
| base win (any size), and when ROTARY or QUOTE triggers | `hype` | 2.0 s / 1.8 s |
| near miss: reel 5 tease or two phones, no feature, no base win | `shock` | 2.2 s |
| 4 paid spins in a row with total win 0 (counter restarts after the rage, resets on any win or a buy) | `rage` | 2.4 s |
| big-win overlay (also shown inside the overlay) and the ROTARY / QUOTE total card | `win` | overlay length + 1.5 s / 3.0 s |
Back to `idle` after the hold, and instantly when the next spin starts. All five poses are the same 434 px canvas, feet aligned to idle's baseline by `cold-call/art/skin_export.py`, so the swap never moves the box (checked: same offset box 0,0,236,295 in all five). The bubble tail is refitted per mood from the manifest mouth point (tail angle 66.1 / 62.2 / 60.7 / 70.3 / 67.5 deg for idle / hype / shock / win / rage). `hero_out` and `frame` unused (bad cuts); `cash`, `handset`, `bell`, `cups`, `closer_scream` also not used.

**Files:** `style.css` (rewritten), `index.html` (splash markup, hero.js tag), `assets.js`, `assets/symbols.json`, `hero.js` (new), `captions.js` (mood mouth, `rage` lines), `game.js`, `rotary.js`, `quote.js`, `qa.js` (new, only loaded with `?shot=`), `assets/fonts/*` (+ `LICENSES.txt`), `assets/img/{hero_hype,hero_shock,hero_win,hero_rage,spin,seal,cardmachine,card,cashwad,phone_gold,wood,grain,stampmask}.webp`, `cold-call/art/skin_export.py`, `cold-call/art/skin_textures.py`, `cold-call/art/SOURCES.md` (appended). The info modal no longer carries the Twemoji credit (no Twemoji art is left).

**Shot commands** (server as in Milestone 4 via `bash qa/coldcall-skin/capture/startsrv.sh`; base `http://127.0.0.1:4610/games/coldcall/index.html`; scripts in `qa/coldcall-skin/capture/`, run from a folder that holds them, one browser at a time, 540x960, output `qa/coldcall-skin/`):
- URL flags (`qa.js`): `?shot=splash`, `?shot=idle`, `?shot=hype|shock|rage|win` (mood held, matching caption), `?shot=bigwin`, `?shot=buy` (confirm step), `?shot=info`, `?force=rotary&shot=spin`, `?force=quote&shot=spin`, `?shot=quote_grand` (engine copy with respin landing chance 1, so every box fills and PAYMENT ACCEPTED lands; practice mode only).
- `node skin_static.js [splash idle hype shock rage win bigwin buy info]` -> splash, idle, win (replaced by `skin_win.js`), near_miss, rage, mood_win, bigwin_overlay, bigwin_closed, buy_confirm, info_modal. `node skin_win.js` (real spins until a base win, hype mood). `node skin_bonus.js rotary` -> rotary_trigger, rotary_dial, rotary_dial_mult, rotary_freespins, rotary_complete. `node skin_bonus.js quote grand` -> quote_g_midfill / field_prize / payment_accepted (renamed quote_midfill, quote_field_prize, quote_payment_accepted); `node skin_bonus.js quote` -> quote_trigger. `node skin_docked.js` -> docked_360 (through the real shell, window docked at 360 px). `node skin_check.js` (assets decoded, fonts, 404s, hero box and tail angle per mood). `node skin_moods.js 80` (mood map on real rounds).

**Verified (ran it, looked at it)**
- `node tests/coldcall.js` 31 passed, `node tests/bender.js` 17 passed, `cmp games/coldcall-engine.js public/games/coldcall/engine.js` identical.
- Opened every shot in `qa/coldcall-skin/` (20 files, all under 100 KB) and compared with A1. Fixed on the way: grain multiply made paper grey (now overlay, softer grain), ghost hero doubled behind the big-win overlay (hero hidden under `.bw`), dial focus rectangle, trigger stamp covering the hero (now under the chin), prize float over the prize text, cash wad blue fringe (defringed).
- Running total sampled every 100 ms: ROTARY live round 590 samples, 0 blank, 0 decreases, 0 leftover nodes, max rAF 1; QUOTE live 4 forced rounds 713 samples, 0 blank, 0 decreases, 0 leftover, max rAF 2; QUOTE practice grand round 222 samples, 0/0/0, max rAF 2; `CC.dbg.mismatch` empty throughout.
- Mood map on 80 real practice rounds (local engine, turbo): 26 base wins all `hype`, 5 near misses with no win all `shock`, 8 rage events exactly at the 4th dead spin, 0 violations of the map. No natural bonus or big win occurred in those 80, so `win` on a bonus total and on a big win was checked on forced rounds (`rotary_complete` shows `hero_win`, `bigwin_overlay` shows it, the log read `win` at the ROTARY total and `hype` at both bonus triggers), not on natural ones.
- `skin_check.js`: 27 images decoded, 0 undecoded, 0 low-res warnings, 0 responses >= 400, three fonts `loaded`, 0 `<audio>` elements. Docked through the shell at 360x752: layout holds, shell wallet equals game balance after 2 spins.

**What still looks wrong or is unverified (my own eye)**
1. The head background is a dark blurred smear. `bg.jpg` is pre-blurred and has the ghost face, so I cropped it to the far office and masked it into the wood; it reads as mud, not as A1's crowded boiler room. It needs the clean painted background.
2. The dial is CSS gradients next to painted pieces: it reads as better vector, not as paint. `hero_win` is a smaller figure than the idle pose (the sheet drew it at a different scale; I did not rescale art), and the bubble tail is still a short stub, not reaching the mouth.
3. QUOTE screen: the content is centred so there is an empty band above the title and below the desk objects; card machine and card are static decoration (not tied to the payout). ROTARY free-spin win floats can still overlap each other (existing behaviour, not touched).
- Unverified: a real touch screen or phone GPU (software GL only; 15 `drop-shadow` symbols, the 5-shadow bubble outline and `background-blend-mode` layers are untimed), Safari rendering of `paint-order`/`mask`, audio (nobody listened). `?shot=` flag ships in the public bundle (`qa.js` is only fetched when the URL asks for it and changes no rules). Near miss `shock` is checked on a flag and on 5 natural rounds; a near miss that also wins shows `hype`, by design.
- Commit `8d7a931` (skin wave 1+4) was committed without the `Co-Authored-By` trailer; it was already pushed, so I left it alone. Later commits carry it. The CSS is one file, so the four commits are by step of work, not by file.


## Skin wave follow-up (steer after the engine change to a 6x5 cluster/cascade game)
Kept: base skin, splash, hero moods, bakelite dial. QUOTE ACCEPTED screen left as committed (e5a6af6), no more work on it (record shot `quote_midfill` only).
- **Size-agnostic board:** `:root` has `--cols:5 --rows:3 --cell:94px --gap:5px`; `.slots`, `#reels`, `.reel` height and the board row height of `#shake` are all computed from them (grid + 34 px frame), cell backgrounds and the win highlight use no pixel sizes. A 6x5 board drops in by setting the four variables on `#stage`; the game code still builds 5x3 (`COLS`/`ROWS` come from the engine), I did not rebuild the board.
- **`?mock=6x5`** (`qa.js`, layout only, no game logic): 30 cells at `--cell:78px --gap:3px` (6 x 78 + 5 x 3 = 483 fits the 520 px frame; 80 px cells would need a 3 px gap and slimmer frame padding), current symbols, one lit cluster. Shot `qa/coldcall-skin/board_6x5_mock.jpg`: symbols stay readable at 78 px; the lit cluster and dimmed cells read. Cost: the board row grows from 326 to 436 px, so the head row drops to its 150 px minimum on a 960 px stage and the hero's feet tuck under the ribbon (taller windows give it more room).
- **Extras** (`assets/symbols.json` -> `extras`, decoded in the splash through `CC.assets.extraUrl(id)`, not used by any screen): `cups`, `bell`, `quote_bronze`, `quote_silver`, `quote_gold` exported at 256 px (`extra_<id>.webp`, `cold-call/art/skin_export.py`; the three `quote_*` PNGs were only read, not staged); `cashwad`, `cardmachine`, `seal` point at their existing piece files (300/300/340 px, not re-exported smaller). `assets/img` is 674 KB.
- **Mood API:** `CC.hero.mood('shock')` (default hold per mood: hype 2.0 s, shock 2.2 s, rage 2.4 s, win 3.0 s, or pass ms); `CC.hero.set(mood, ms)` is the same call with an explicit hold. The map is unchanged; "near miss" is still the reel-5 tease or two phones until the scatter tease replaces it.
- Not touched: `games/`, either engine copy, `tests/`, `server.js`. Tests re-run below.
