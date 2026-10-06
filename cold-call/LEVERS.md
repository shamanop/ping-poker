# COLD CALL levers: Hacksaw's real numbers vs ours, then the knobs for THE PULL

Owner: levers agent (Frank, session `coldcall-levers`). Brief: `cold-call/LEVERS-BRIEF.md`. Branch `coldcall-pull`, config c24 (the engine as it stands).
Status: **Part 1 and Part 2 done (2026-10-06).** Part 3 (the knobs for the six mechanics) is open: it starts when the lead says a mechanism has landed. Early Part 3 findings that the lead needs now are in section 5.
Full sourced research, game by game, is kept in `cold-call/levers-runs/research-hacksaw-A.md` (Le Bandit, Wanted Dead or a Wild, Chaos Crew 2, RIP City) and `research-hacksaw-B.md` (Le Pharaoh, Le Viking, Le Zeus / Le Fisherman, studio norms and UK rules, Nolimit City, Pragmatic Play). Raw sim output: `cold-call/levers-runs/p2_*.json`. Sim code: `tools/levers-sim.js` (feel numbers), `tools/pull-model.js` (lead-list model), `tools/levers-run.sh` (runs on shaman, E: drive only).

Rule used throughout: a number without a URL beside it is ours (measured by sim, run named). "not published" means searched and not found. "estimate (reason)" is arithmetic or inference, labelled.

## 0. The five findings that matter

1. **Hacksaw publishes far less than the brief assumed.** Its own game pages carry feature rules only: no hit frequency, no trigger odds, no average bonus value, no max-win odds (checked on Le Bandit, Pharaoh, Viking, Zeus, Fisherman: https://www.hacksawgaming.com/games/le-bandit). No regulator certificate for any of these games is online. What does exist comes from Bigwinboard's game-info boxes and in-game info screens quoted by review sites. Per-tier bonus trigger odds are "not published" for every Hacksaw game.
2. **Hacksaw's Le Bandit is easier to lose a spin on than people think, but it hits far more often than we do:** hit frequency 32.47% (https://www.bigwinboard.com/le-bandit-hacksaw-gaming-slot-review/) vs our 20.63%. Our dead-spin run at the 99th percentile is 20 spins; Le Bandit's would be about 12 (estimate: geometric from the published hit rate, independent spins). Our 5x+ wins come every 49 spins, our bonus every 207 (median 143, P90 476, P99 953, longest in 1 billion spins: 2,860).
3. **The retune bought a bonus that is median 55.6x, not 102x:** the mean is 101.9x but 6.6% of bonuses pay less than the stake, 13.4% pay under 10x, 21.7% under 20x (1 billion spins, seed 11). That is the softest spot in the game and nothing in Chris's targets protects it.
4. **A tease predicts nothing, as it must:** two bells (1 in 24.4 spins) is followed by a bonus on the next spin 0.48% of the time, which is the base rate (0.483%). Nothing to tune and nothing that may be tuned.
5. **THE PULL as provisionally set is a money printer for the player: Callback every 47 spins costs 177 RTP points.** The numbers to use are in section 5; the lead's tests must not hard-code them.

## 1. Hacksaw's real levers (and the contrast studios)

Every cell has its source. "BWB" = Bigwinboard game page; "OLBG" = olbg.com game page; "NLC" = nolimitcity.com game page. Anything "not published" was searched on the sources named in the research files and not found.

### 1a. Hacksaw: the games with cluster or scatter-trigger structure closest to ours

| Item | Le Bandit | Le Pharaoh | Le Viking | Wanted Dead or a Wild | Chaos Crew 2 | RIP City |
|---|---|---|---|---|---|---|
| RTP default / lower variants | 96.34% / 94.23, 92.17, 88.36 (https://www.hacksawgaming.com/games/le-bandit) | 96.18% / 94.33, 92.26, 88.24 (https://www.bigwinboard.com/le-pharaoh-hacksaw-gaming-slot-review/); AboutSlots says 96.16 (https://www.aboutslots.com/casino-slots/le-pharaoh) | 96.32% / 94.31, 92.28, 88.27 (https://www.bigwinboard.com/le-viking-hacksaw-gaming-slot-review/) | 96.38% / 94.55, 92.33, 88.42 (https://www.hacksawgaming.com/games/wanted-dead-or-a-wild) | 96.27% / 94.22, 92.41, 88.28 (https://www.hacksawgaming.com/games/chaos-crew-2) | 96.22% / 94.27, 92.32, 88.02 (https://www.hacksawgaming.com/games/rip-city) |
| Volatility | 3/5 (https://www.hacksawgaming.com/games/le-bandit); BWB "swingy temperament at times" | 3/5 BWB (https://www.bigwinboard.com/le-pharaoh-hacksaw-gaming-slot-review/); "High" Respinix (https://respinix.com/demo/le-pharaoh/) | 3/5 (https://www.bigwinboard.com/le-viking-hacksaw-gaming-slot-review/) | 4/5 (https://www.hacksawgaming.com/games/wanted-dead-or-a-wild) | 5/5 (https://www.hacksawgaming.com/games/chaos-crew-2) | 3/5 (https://www.hacksawgaming.com/games/rip-city) |
| Hit frequency | 32.47% (https://www.bigwinboard.com/le-bandit-hacksaw-gaming-slot-review/); 32.49% at lower RTP variants (https://www.olbg.com/slots/games/le-bandit) | 29.21% (https://www.bigwinboard.com/le-pharaoh-hacksaw-gaming-slot-review/) | 38.17% (https://www.bigwinboard.com/le-viking-hacksaw-gaming-slot-review/); Wolfbet "about 28%" rejected as unreliable (https://wolfbet.com/blog/le-viking-casino-slot-review/) | 19.3% (https://www.bigwinboard.com/wanted-dead-or-a-wild-hacksaw-gaming-slot-review/); 19.36% (https://www.olbg.com/slots/games/wanted-dead-or-a-wild) | 27% (https://www.bigwinboard.com/chaos-crew-2-hacksaw-gaming-slot-review/); 27.6% (https://www.olbg.com/slots/games/chaos-crew-2) | 18% (https://www.bigwinboard.com/rip-city-hacksaw-gaming-slot-review/); 18.22% (https://www.olbg.com/slots/games/rip-city) |
| Max win | 10,000x (https://www.hacksawgaming.com/games/le-bandit) | 15,000x (https://www.bigwinboard.com/le-pharaoh-hacksaw-gaming-slot-review/) | 10,000x (https://www.bigwinboard.com/le-viking-hacksaw-gaming-slot-review/) | 12,500x (https://www.hacksawgaming.com/games/wanted-dead-or-a-wild) | 20,000x (https://www.hacksawgaming.com/games/chaos-crew-2) | 12,500x (https://www.hacksawgaming.com/games/rip-city) |
| Odds of max win | "1 in 14,000,000" (BWB https://www.bigwinboard.com/le-bandit-hacksaw-gaming-slot-review/; origin not shown, OLBG says no max win probability details https://www.olbg.com/slots/games/le-bandit) | not published (aboutslots: N/A https://www.aboutslots.com/casino-slots/le-pharaoh) | not published | ~1 in 6,000,000 (Respinix only https://respinix.com/demo/wanted-dead-or-a-wild/) | 1 in 1,700,000 (https://www.bigwinboard.com/chaos-crew-2-hacksaw-gaming-slot-review/) | 1 in 6,000,000 (https://www.bigwinboard.com/rip-city-hacksaw-gaming-slot-review/) |
| Bonus trigger odds per tier | not published. Weak affiliate claims that disagree: "approximately every 130 spins" (https://lebandit-slot.com/), "roughly 1 in 180" (https://3scatters.org/le-bandit.html); no method stated, not used | not published (https://www.aboutslots.com/casino-slots/le-pharaoh: N/A) | not published; Wolfbet "every 180 to 220 spins" rejected (https://wolfbet.com/blog/le-viking-casino-slot-review/) | not published | not published (BWB: "it would be of interest to know the natural trigger frequency" https://www.bigwinboard.com/chaos-crew-2-hacksaw-gaming-slot-review/) | not published |
| Average bonus value | not published | not published | not published | not published | not published | not published |
| Bonus tiers (scatters) | 3 = 8 spins, 4 = 12, 5 = 12 with a Rainbow every spin; 4 in tier 1 upgrades (https://www.hacksawgaming.com/games/le-bandit) | 3 / 4 / 5 scatters, choice of two bonuses at 3 and 4 (https://www.hacksawgaming.com/games/le-pharaoh) | 6 coins = Raid Spins; 3-6 scatters = four tiers (https://www.bigwinboard.com/le-viking-hacksaw-gaming-slot-review/) | 3 bonuses (https://www.bigwinboard.com/wanted-dead-or-a-wild-hacksaw-gaming-slot-review/) | Bonus, Super Bonus, Best-of variants (https://www.bigwinboard.com/chaos-crew-2-hacksaw-gaming-slot-review/) | Ro$$ and Maxx (https://www.bigwinboard.com/rip-city-hacksaw-gaming-slot-review/) |
| Cheapest "feature spins" bet mode | BonusHunt 3x, "5 times more likely" to trigger, RTP 96.28% (https://www.bigwinboard.com/le-bandit-hacksaw-gaming-slot-review/) | BonusHunt 3x, 5x trigger, RTP 96.28 or 96.35% (https://www.bigwinpictures.com/games/le-pharaoh/) | BonusHunt 3x, 5x, RTP 96.36% (https://www.bigwinboard.com/le-viking-hacksaw-gaming-slot-review/) | none listed (https://www.hacksawgaming.com/games/wanted-dead-or-a-wild) | BonusHunt 5x, "10 times higher chance", RTP 96.22% (https://www.hacksawgaming.com/games/chaos-crew-2) | Bonushunt 3x, 5x, RTP 96.44% (https://www.bigwinboard.com/rip-city-hacksaw-gaming-slot-review/) |
| Other feature-spin modes | Rainbow FeatureSpins 50x (Rainbow every spin) RTP 96.36% (https://www.bigwinboard.com/le-bandit-hacksaw-gaming-slot-review/) | Rainbow 60x RTP 96.35% (https://www.bigwinboard.com/le-pharaoh-hacksaw-gaming-slot-review/) | Raider 30x RTP 96.27% (https://www.bigwinboard.com/le-viking-hacksaw-gaming-slot-review/) | not published | Epic Drop 200x RTP 96.35% (https://www.bigwinboard.com/chaos-crew-2-hacksaw-gaming-slot-review/) | 2 Wild Cats 20x RTP 96.34%; 3 Wild Cats 50x RTP 96.31% (https://www.bigwinboard.com/rip-city-hacksaw-gaming-slot-review/) |
| Bonus buys (x bet, RTP) | 100x / 96.3%; 250x / 96.4% (https://www.bigwinboard.com/le-bandit-hacksaw-gaming-slot-review/) | 100x / 96.33 or 96.31%; 250x (AboutSlots 200x) / 96.29% (https://www.aboutslots.com/casino-slots/le-pharaoh) | 100x / 96.29%; 200x / 96.29% (https://www.bigwinboard.com/le-viking-hacksaw-gaming-slot-review/) | 80x, 200x, 400x; RTP only as a range 96.27-96.43%, Dead Man's Hand 96.43% (https://respinix.com/demo/wanted-dead-or-a-wild/) | 100x / 96.34%; 250x / 96.3%; Best-of 200x / 500x (https://www.bigwinboard.com/chaos-crew-2-hacksaw-gaming-slot-review/) | 110x / 96.2%; Maxx 2000x / 96.41% (https://www.bigwinboard.com/rip-city-hacksaw-gaming-slot-review/) |
| Bet range | 0.10-100 (https://www.bigwinboard.com/le-bandit-hacksaw-gaming-slot-review/) | 0.10-100 | 0.10-100 | 0.20-100 (https://www.bigwinboard.com/wanted-dead-or-a-wild-hacksaw-gaming-slot-review/) | 0.10-100 (https://www.bigwinboard.com/chaos-crew-2-hacksaw-gaming-slot-review/) | 0.10-100 (https://www.bigwinboard.com/rip-city-hacksaw-gaming-slot-review/) |
| Persistence between spins | Base: none ("this doesn't mean collecting winning symbols in a meter", https://www.bigwinboard.com/le-bandit-hacksaw-gaming-slot-review/). Bonus: Golden Squares stay lit (https://www.hacksawgaming.com/games/le-bandit) | Base: nothing carries; "removed at the start of the next spin" (https://www.hacksawgaming.com/games/le-pharaoh) | Bonus only: sticky multipliers, coins, lives (https://www.bigwinboard.com/le-viking-hacksaw-gaming-slot-review/) | Bonus only: sticky wilds, collection meter | Bonus only: sticky multipliers, refilling lives | Bonus only: reel activation stays |

Le Zeus (96.26%, hit 36.6%, 20,000x) and Le Fisherman (96.33%, hit 42%, 15,000x, volatility 2/5): https://www.bigwinboard.com/le-zeus-hacksaw-gaming-slot-review/ , https://www.bigwinboard.com/le-fisherman-hacksaw-gaming-slot-review/ .

### 1b. Hacksaw: staging, spin length, turbo and autoplay (shared engine)

| Item | What is known | Source |
|---|---|---|
| Teases and near misses | No Hacksaw page or review describes them in words (not published). Evidence is the shipping client: a per-reel "attention" system slows later reels to 0.6 speed when scatters are already on screen and delays the remaining reels one by one; each landing scatter plays "bonus_landed", a Rainbow plays a pitch-randomised "rainbow_ding", completion plays "bonus_triggered". The count of scatters that starts the slowdown is not in the bundle: not published. | Le Bandit client https://static-live.hacksawgaming.com/1309/1.25.0/main.js (our reading of minified code) |
| Spin timing defaults | normal start 0.5 s / stop 0.66 s; turbo 0.2 s / 0.2 s; super turbo stop 0.05 s, speed 30. Shipping per-game overrides not confirmed. Seconds per spin as marketed: not published. | same main.js |
| Win tiers in the client | Small, Regular, BigWin, MegaWin, SuperMegaWin, EpicWin; fanfares only from BigWin up; end-of-win sound differs at or below 1.0x bet. The x-bet thresholds: not published. | same main.js |
| Autoplay / turbo | "up to 1,000 auto spins with loss and single-win limits, Turbo Mode and Super Turbo Mode" outside the UK | https://www.olbg.com/slots/games/le-bandit |
| UK rules (not applicable to a private play-money app, useful as a hygiene reference) | 2.5 s minimum per game cycle (RTS 14D); no turbo, quick spin or slam stop on paid spins (RTS 14E); **"must not celebrate a return which is less than or equal to the total stake gambled"** (RTS 14F); no autoplay and no bonus buy in UK builds | https://www.gamblingcommission.gov.uk/standards/remote-gambling-and-software-technical-standards/rts-14-responsible-product-design ; https://www.olbg.com/slots/articles/bonus-buy-slots |
| Operator-selectable | RTP variant and buy on / off are set per operator | https://wagermaniacs.com/hacksaw-gaming/ (via search summary; unverified) |

### 1c. Contrast studios

| Item | San Quentin xWays (Nolimit) | Tombstone RIP (Nolimit) | Gates of Olympus (Pragmatic) | Sugar Rush (Pragmatic) |
|---|---|---|---|---|
| RTP default / lower | 96.03% / 94.11% (https://nolimitcity.com/games/san-quentin) | 96.08% / 94.08%; 96.28% with Enhanced Bet (https://www.bigwinboard.com/tombstone-2-nolimit-city-slot-review/) | 96.50% / 95.50 / 94.50 (https://www.pragmaticplay.com/en/games/gates-of-olympus/ ; BWB https://www.bigwinboard.com/gates-of-olympus-pragmatic-play-slot-review/) | 96.50% / 95.50 / 94.50 (https://www.bigwinboard.com/sugar-rush-pragmatic-play-slot-review/) |
| Volatility | "Extreme" (https://nolimitcity.com/games/san-quentin) | 10/10 "Insane" (https://www.bigwinboard.com/tombstone-2-nolimit-city-slot-review/) | 5/5 (https://www.bigwinboard.com/gates-of-olympus-pragmatic-play-slot-review/) | 5/5 (https://www.bigwinboard.com/sugar-rush-pragmatic-play-slot-review/) |
| Hit frequency | 34.25% (https://nolimitcity.com/games/san-quentin) | 9.08% (https://nolimitcity.com/games/tombstone-rip); BWB says 8.7% | not published | 1 in 2.9 = 34.5% (https://www.bigwinboard.com/sugar-rush-pragmatic-play-slot-review/) |
| Bonus frequency | 1 in 230 (https://nolimitcity.com/games/san-quentin) | Hang 'em High 1 in 194; Boothill 1 in 85,000 (https://www.bigwinboard.com/tombstone-2-nolimit-city-slot-review/) | 1 in 448 (https://www.bigwinboard.com/gates-of-olympus-pragmatic-play-slot-review/) | 1 in 323 (https://www.bigwinboard.com/sugar-rush-pragmatic-play-slot-review/) |
| Max win and its odds | 150,000x; odds N/A on Nolimit's page, 1 in 91M (https://www.olbg.com/slots/games/san-quentin-xways) vs 1.83 billion (BWB) | 300,000x; 1 in 130M (https://nolimitcity.com/games/tombstone-rip) | 5,000x; 1 in 697,350 (https://www.bigwinboard.com/gates-of-olympus-pragmatic-play-slot-review/) | 5,000x; 1 in 2,340,000 (https://www.bigwinboard.com/sugar-rush-pragmatic-play-slot-review/) |
| Buys (x bet, RTP) | 100x / 96.26%; 400x / 96.26%; 2,000x / 96.95% (https://www.bigwinboard.com/san-quentin-nolimit-city-slot-review/) | 70x / 96.47%; 3,000x / 97.03% (https://www.bigwinboard.com/tombstone-2-nolimit-city-slot-review/) | 100x; RTP not published | 100x; RTP = headline 96.5% (https://www.bigwinboard.com/sugar-rush-pragmatic-play-slot-review/) |
| Feature-spin modes | none published for this title | Enhanced Bet +10% stake, scatter guaranteed on reel 2, Hang 'em High freq 1/96 (https://www.bigwinboard.com/tombstone-2-nolimit-city-slot-review/) | Ante +25%, scatter odds doubled, buy off while on; ante RTP not published (https://www.bigwinboard.com/gates-of-olympus-pragmatic-play-slot-review/) | not published |
| Bet range | 0.20-32 (https://nolimitcity.com/games/san-quentin) | 0.10-50 (https://nolimitcity.com/games/tombstone-rip) | 0.20-100 (125 with ante) | 0.20-100 |
| Shape levers worth stealing or avoiding | A 1-2 scatter near miss is converted into a visible reward (unlocked cells, wilds): the tease pays something (https://nolimitcity.com/games/san-quentin). Buy payout spread of the 2,000x buy: 28% pay under half the price (https://www.olbg.com/slots/games/san-quentin-xways) | **xRIP: a win worth less than the bet is voided**; that is why hit frequency is 9% and BWB calls it a jackpot slot (https://www.bigwinboard.com/tombstone-2-nolimit-city-slot-review/) | Global multiplier that never resets in free spins (https://www.bigwinboard.com/gates-of-olympus-pragmatic-play-slot-review/) | Grid multipliers double on each re-hit up to x128, kept in the bonus, cleared in base (same BWB page) |

**What Hacksaw shows about the whole studio:** four RTP variants per game (about 96.3 / 94.3 / 92.3 / 88.3); a buy menu of four entries, with BonusHunt 3x ("5 times more likely") as the cheap one; every published buy RTP sits within about 0.1 of the headline (Le Bandit 96.28 to 96.40 vs 96.34); max wins 10,000x to 20,000x; bet range 0.10 to 100. Nolimit's buy RTPs rise with price (96.26 to 97.03); Pragmatic's equal the headline. Sources: sections 2 and 3.4 of `research-hacksaw-B.md`.

## 2. Our levers in the same table (config c24, engine as of `bea8097`)

All "ours" numbers: `tools/levers-sim.js --stream 1,000,000,000 spins seed 11` on shaman (166 s, 24 threads), cross-checked with the retune's stratified run (`cold-call/RETUNE.md`, seed 202 450M + 8M per bonus). The streak and session code replays the engine round for round: 200,000 rounds against `engine.round()` gave 0 mismatches.

### 2a. Ours vs Le Bandit, row for row

| Item | Ours (c24) | Le Bandit (source above) | Note |
|---|---|---|---|
| RTP / variants | 97.93% +- 0.11 (stratified 450M); this run 97.926%. One variant only | 96.34% / 94.23 / 92.17 / 88.36 | We pay 1.6 points more; no variants |
| Volatility | sd of one round 16.94x bet (plain 200M); no label | 3/5 | Our sd is above Le Bandit's class (hit rate says WDW 4/5 to CC2 5/5) |
| Hit frequency (any paid round) | 20.63% (base-only 20.31%) | 32.47% | Gap 11.8 points |
| Wins under the bet | 4.04% of spins pay under 1x (19.6% of hits) | not published | Mug 5-cluster at 0.3x only |
| Wins exactly equal to the bet | 8.68% of spins (42.1% of hits) | not published | Pushes. 12.7% of spins return the bet or less; that is 61.7% of all hits |
| Max win and odds | 10,000x; 1 in 3,058,104 spins (this run, 327 hits; plain 200M: 1 in 3.03M) | 10,000x; 1 in 14,000,000 (BWB, origin unstated) | Cap is reached 4.6x more often than Le Bandit's |
| Bonus trigger odds | bonus 1: 1 in 224; bonus 2: 1 in 2,846; bonus 3: 1 in 44,304; any: **1 in 207.2** (retune) | not published (affiliates: 130 or 180) | Same range as San Quentin 1 in 230, Tombstone 1 in 194 |
| Average bonus value | bonus 1: 83.1x; bonus 2: 276.8x; bonus 3: 1,101.6x; all natural: 101.9x; **median 55.6x** | not published | See 2d: the median is the point |
| Bonus share of RTP | 50.3% | not published | |
| Buys | `call` 2.9x / 97.91%; `bonus1` 84.9x / 97.97%; `bonus2` 282.4x / 97.99%; `hunt` 3.5x / 97.7 to 98.1% (retune) | 100x / 96.3%; 250x / 96.4%; hunt 3x / 96.28% | Cheapest full-bonus buy: ours 84.9x, theirs 100x. Our buys are priced to the game's own RTP like Hacksaw's |
| Feature-spin mode | `hunt`: 3.5x for one spin with bell weight x1.845 (about 5.0x natural bonus odds, 2.44% per spin; retune notes c12) | 3x for "5 times more likely" | Same idea, 0.5x dearer |
| Bet range | 0.10 to 25.00 (BET_LEVELS 10..2500 cents) | 0.10 to 100 | |
| Spin length, turbo, autoplay | tease holds 900 ms; turbo = 0.45x animation time, skip 0.3x, free spins 20% quicker; autoplay exists (`public/games/coldcall/game.js` lines 57, 119, 335) | start 0.5 s / stop 0.66 s normal, 0.2 / 0.2 turbo (client defaults); autoplay to 1,000 spins with limits | Seconds per spin on our side not measured |
| Teases | exactly 2 bells and no bonus: 900 ms hold, hero "shock", sound, then the board resolves; no reel slowdown | per-reel slowdown as scatters land, sound per landing | See gap G6 |
| Persistence | none between base spins; bonus 1 squares persist until a phone uses them | none in base; squares persist in bonus | THE PULL adds the first memory |

### 2b. What drives "one more spin" (1 billion spins, seed 11, `p2_stream.json`)

| Measure | Result |
|---|---|
| Bells on a base spin | 0: 70.91%; 1: 24.50%; 2: 4.106% (the tease); 3: 0.446%; 4: 0.035%; 5: 0.0023% |
| **Tease rate (two bells)** | 4.106% of spins, **1 in 24.4** |
| Tease followed by a bonus on the very next spin | 0.48% (base rate 0.48%); within 10 spins 4.73% (base 4.7%); within 50 spins 21.5% (base 21.5%). Teases carry no signal, as designed. |
| Phone symbol lands but there is nothing marked to call ("dud phone") | 5.14% of spins, vs 1.57% where the phone feature fires |
| Dead-spin run (consecutive spins paying 0), run length | median 4; P90 10; P99 20; P99.9 30; longest in 1 billion spins 77. Mean 4.8 |
| Run of spins paying under the bet (0 or under 1x) | median 4; P90 13; P99 26; P99.9 39; longest 113 |
| Gap between wins of 5x or more | mean 48.7; median 34; P90 112; P99 223; longest 821 |
| Gap between wins of 20x or more | mean 145; median 101; P90 334; P99 667; longest 2,498 |
| Gap between phone features (live) | mean 63.8; median 44; P90 146; P99 292; longest 1,110 |
| Gap between teases | mean 24.4; median 17; P90 55; P99 110; longest 455 |
| **Gap between bonuses** | mean 206.9; **median 143; P90 476; P99 953; longest 2,860** |
| Gap between ANY event (5x+ win, tease, live phone, bonus) | mean 15.6; median 11; P90 35; P99 70; **longest in 1 billion spins 269** |
| Share of windows with nothing happening | 25 spins with no event: 19.2%; 100 spins: 0.13%. 100 spins with no 5x+ win: 12.6%. 100 spins with no bonus: 61.6%; 400 spins with no bonus: 14.4% |
| Win ladder: a win of at least | 2x: 1 in 21; **5x: 1 in 49**; 10x: 1 in 80; **20x: 1 in 145**; 50x: 1 in 304; **100x: 1 in 574**; 200x: 1 in 1,724; 500x: 1 in 7,510; **1,000x: 1 in 29,774**; 5,000x: 1 in 882,613; 10,000x: 1 in 3,058,104 |
| Chance to see it in 200 spins / in 1,000 spins | 5x 98.4% / 100%; 20x 74.9% / 99.9%; 100x 29.5% / 82.5%; 1,000x 0.7% / 3.3% |
| Bonus value spread (4.83M bonuses) | mean 101.9x; P10 6.0x; P25 23.7x; median 55.6x; P75 110.9x; P90 216x; P99 785x. Under 1x: 6.6%; under 5x: 9.3%; under 10x: 13.4%; under 20x: 21.7%; under 50x: 46.3%; 200x or more: 11.2%; 1,000x or more: 0.65% |

### 2c. Time on device (flat 1x bet, play until the balance is under one bet, 20,000-spin cap; `p2_sess100.json`, `p2_sess300.json`)

| Bankroll | Sessions | P10 / median / P90 spins survived | Mean (lower bound, cap) | Hit the 20,000-spin cap | See a bonus | See a 20x+ win | See a 100x+ win | Touch 2x the bankroll | First bonus (mean spin) | Bonuses per session |
|---|---|---|---|---|---|---|---|---|---|---|
| 100x | 400,000 | **132 / 229 / 2,355** | 1,345 | 2.6% | 57.5% | 64.4% | 31.5% | 27.2% | 83.6 | 6.5 |
| 300x | 300,000 | **519 / 1,255 / 14,598** | 3,879 | 8.1% | 92.4% | 95.5% | 68.0% | 32.2% | 165.3 | 18.8 |

Minutes depend on spin speed, which we have not measured: at an assumed 3 s per spin (estimate, not measured) the 100x median is about 11 minutes and the 300x median about 63. Of players who fall to half their bankroll, 22.0% (100x) and 29.1% (300x) climb back to the full bankroll before busting.
The median session is short because 10% of players bust within 132 spins and half within 229: long sessions come from the rare lucky bonus, not from grinding.

### 2d. Wins that are really losses
12.7% of all spins return the stake or less (4.04% under 1x, 8.68% exactly 1x). Of all spins that "win", 61.7% win back no more than they bet. Hacksaw's Le Bandit pays 0.1x to 1x on 5-clusters of the low symbols (https://www.bigwinboard.com/le-bandit-hacksaw-gaming-slot-review/) so its share is higher still (not published). The UKGC forbids celebrating a return of the stake or less (https://www.gamblingcommission.gov.uk/standards/remote-gambling-and-software-technical-standards/rts-14-responsible-product-design). That does not bind a private play-money app, but celebrating a 0.3x "win" is the one place where the display is on the edge of the honesty rule; see recommendation R4.

## 3. Gap list: where we are softer or harsher than Hacksaw, and whether it matters

Ranked by how much each costs the feeling of "one more spin". "Chris target" = the 2026-10-05 22:55 targets in the brief.

| # | Gap | Us vs them | Matters? | What I would do |
|---|---|---|---|---|
| G1 | **Bonus floor.** 6.6% of our bonuses pay under the stake, 13.4% under 10x, 21.7% under 20x; the median is 55.6x against a mean of 102x. | Hacksaw: not published. The nearest published comparison is San Quentin's 2,000x buy, where 28% pay under half the price (https://www.olbg.com/slots/games/san-quentin-xways). | **Yes, the biggest.** A 1-in-207 event that returns under the stake 1 time in 15 is the strongest "that's it?" feeling in the game. | Part 3: shape the bonus reveal weights so under-10x falls to about 8% without moving the mean (see section 5.4). Chris's targets (90-120x average) do not prevent it. |
| G2 | **Hit rate.** 20.63% vs Le Bandit 32.47%, Pharaoh 29.21%, Viking 38.17%, Zeus 36.6%, Fisherman 42%; ours is WDW (19.3%) and RIP City (18%) territory. | Dead run P99: ours 20, Le Bandit about 12 (estimate, geometric) | **Medium.** The first 50 spins feel colder than the game we clone. THE PULL's meter fills hardest on dead spins, which is the right answer to this gap. | Keep Chris's 20-24% target; ask whether 23% is acceptable (needs a re-tune of the 1-2x band; section 6). Do not touch it before the meter exists. |
| G3 | **Cheapest full-bonus buy.** `bonus1` 84.9x vs Hacksaw's 100x entry. Chris target says "about 100x". | Hacksaw 100x / 96.3% | Low-medium. The price follows bonus 1's average value (83.1x). | To reach 100x, bonus 1 must average about 98x, which fits only if bonus 2 / 3 weight shifts to bonus 1 or the bonus-1 reveal improves; combine with G1 (section 5.4). Otherwise report as a miss of 15%. |
| G4 | **RTP 97.93% vs 96.3%; no variants.** | Hacksaw ships four variants (down to 88%) | Not a gap for a play-money app. It is more generous. | none |
| G5 | **Cap reached 4.6x more often** (1 in 3.06M vs 1 in 14M). | Chaos Crew 2 is 1 in 1.7M, RIP City 1 in 6M | Low. A 10,000x cap in play money makes a friend's screenshot. | none |
| G6 | **Tease staging.** Ours is a 900 ms hold after the board has resolved; Hacksaw's client slows the remaining reels and plays a sound per landing scatter as they land (client code, `main.js` above). | Same odds either way (tease = exactly 2 bells, 4.1% of spins) | Medium for feel, zero for maths. | Out of my scope: skin and UI. Tell the skin builder: stage the bells as they land, never change which spins tease. |
| G7 | **Dud phones.** A phone lands with nothing marked on 5.14% of spins; a live phone fires on 1.57%. | not published | Unknown. Three dud phones per live one is a built-in near miss, a true one (the phone really landed). | Leave as is; the ghost mechanic (section 5.5) shows the true counterfactual. |
| G8 | **Pushes and sub-stake wins.** 12.7% of spins return the stake or less. | Hacksaw higher (not published) | Low for pull; medium for honesty. | R4: no win fanfare at 1.0x or less. |
| G9 | **Bonus drought.** 14.4% of 400-spin windows have no bonus; P99 gap 953 spins; longest 2,860 (about 2.4 hours at 3 s a spin, estimate). | Hacksaw: not published | **Yes**; this is what the Callback fixes: a guaranteed bonus at a known count removes the long tail. | Section 5. |
| G10 | **Time on device.** A 100x bankroll lasts a median of 229 spins; 10% are out by 132. | Hacksaw: not published | Medium. It is what it is for a 98% game; the lead list and Callback turn a short session into progress. | Section 5 and 7. |
| G11 | **The tease is not a promise.** Right as built. | | none | none |

## 4. Honesty checks on THE PULL (found while reading `PULL-ENGINE.md`)

1. **Cold leads make the game pay a lapsed player far less than 98%.** A lead is worth 83.1x / list x average bet = 0.21x per lead at a 400 list. A leak of 100 leads (25%: three days away under 20-per-12-hours) is 21x. A player who comes back for 300 spins loses 21x on a game whose whole house edge over those spins is 6x: **their payback is about 91%, not 98%**. Under the lead's provisional cold settings (floor 10 of 50, 3 leads per 6 h after 24 h idle) a three-day absence at 43 leads costs 33 leads, 55x. To stay inside 98 +- 0.3 for someone who plays 600 spins a week and is away two days, the leak must be at most about 9 leads a week (2% of a 400 list): cosmetic. Two honest ways out:
   - (a) a near-zero leak (`afterMs 48 h, stepMs 24 h, batch 4, floor 380`), which keeps the "7 leads go cold in 3 h" line but makes it nearly harmless; or
   - (b) **the value of leads that go cold goes into THE OFFICE POT** (0.21x x the list's average bet per lead, credited to the pot by the house). The house gains nothing from a lapse, payback stays 98% for everyone, the leak can be as big as the lead wants, and it becomes social ("Matt's cold leads fed the pot"). This needs one engine and server change (the pot already tracks house money as `seeded`); I recommend (b) and will size the pot with it. Chris should say yes or no.
   Either way the info screen should read "98% for continuous play" (R3).
2. **The ghost is a counterfactual, not "the round's own draw".** The contract (section 3, mechanic 3) draws the reveal on a sub-rng because the phone never landed. That is honest as long as (a) the label says "if a phone had landed" and not "would have closed", (b) `ghost.minTenths` stays 0 so we never filter to flattering values, and (c) the shown pay uses the real base reveal table. I will set `minTenths = 0`.
3. **ONE MORE CALL at `rtp: 0.98` costs the player 2% of every bonus they gamble**, so total payback falls 1 point when everybody takes it. I recommend `more.rtp = 1.0` (a fair coin on a fair multiplier): the gamble becomes pure variance, payback neutral, and the displayed line "double or nothing at the true odds" is exact. The 98% total then comes from the base game only. Needs Chris's call (it changes what the info screen can say).
4. **The pot pays out every cent it takes in, so it is payback-neutral only if the slice is subtracted from the game.** 50 bps of every bet into the pot is 0.5 points that the base game must give up, or total payback becomes 98.5%.

## 5. THE PULL: early Part 3 findings (the lead needs these before it writes numbers into tests)

Method: `tools/pull-model.js` is an exact first-passage model of the lead list. Spins are independent, so the lead list needs only the round mix (dead 79.37%, paid 20.14%, natural bonus 0.4826%) and the fill per outcome. The RTP bill of a Callback is its bonus value divided by the paid spins per Callback.

### 5.1 The provisional defaults cannot stand
With `list: 50`, `fill: { dead: 1.2, win: 0.6, bonus: 0.6 }` (the PULL-ENGINE.md defaults): mean fill 1.076 leads per spin; **a Callback every 47.1 spins** (P10 45, median 47, P90 49); Callback is a free `bonus1` (83.1x average) so **it costs 176.6 RTP points**. Total payback would be about 275%. Lead tests must read `CFG.pull` and not assert spins-to-Callback.

Two more facts from the same model:
- **Spread is almost zero.** The first passage has a coefficient of variation of 1.2% to 3.3%: P10 to P90 differ by 4 to 11 spins. The Callback is clockwork. That is a feature for a goal-gradient meter; it is the opposite of variable-ratio reward. If Chris wants it felt-close but not on a fixed count, the fill needs a random spread per spin (optional recommendation to the lead: `fill.dead` and `fill.win` as weighted outcome lists, e.g. dead = 1.2 for 90%, 3.0 for 10%, same mean).
- **Granularity.** Lead knobs are in tenths of a lead. With a 50-lead list, a spin worth 0.1 to 0.2 leads moves the "LEADS 43 / 50" display once every 5 to 10 spins, which is not "felt progress every spin". A list of 400 leads with the contract's own default fills (1.2 / 0.6) ticks the number every spin and lands on the same cadence as a 50 list at 0.15 / 0.075. **I recommend `list: 400`, `fill` as the lead wrote it; the UI line becomes "LEADS 312 / 400".** This is a wording change to PULL.md ("50 leads") and needs the lead and Chris to agree; the numbers are equivalent.

### 5.2 Callback budget (the number everything else hangs on)
Callback cost in RTP points = 83.1 / spins-per-Callback x 100. Total bonus RTP is fixed (about 49 points, Chris's 45-55%), and the Callback is a bonus, so every Callback point comes out of the natural bonus rate:

| Spins per Callback | Callback RTP | Natural bonus RTP left (49.2 total) | Natural bonus rate needed | Any bonus (natural + Callback) |
|---|---|---|---|---|
| 250 | 33.2 pts | 16.0 | 1 in 639 | 1 in 180 |
| 300 | 27.7 | 21.5 | 1 in 474 | 1 in 184 |
| **372 (list 400, fills 1.2 / 0.6 / 0.6)** | **22.3** | **26.9** | **1 in 379** | **1 in 188** |
| 450 | 18.5 | 30.7 | 1 in 332 | 1 in 191 |
| 600 | 13.9 | 35.3 | 1 in 288 | 1 in 195 |

(Natural bonus average taken as 101.9x; the any-bonus column assumes the Callback is a 83.1x bonus 1, so it sits a little under 1 in 207 whatever the cadence. 49.2 = 50.3% of 97.93.)

Reading: a Callback about once a session at 372 spins turns about half of all bonuses (52%) into scheduled ones. The natural rate has to fall from 1 in 207 to about 1 in 379. The lever is the base bell weight (`CFG.extra.base.bell`, 1.52 now). Measured on shaman, 100M spins each, seed 21, only the bell weight changed (`bell_*.json`):

| `extra.base.bell` | Natural bonus rate | Natural bonus average | Tease (two bells) | Bonus gap median / P90 |
|---|---|---|---|---|
| 1.52 (today) | 1 in 207 | 101.9x | 1 in 24.4 | 143 / 476 |
| 1.30 | 1 in 318 | 98.7x | 1 in 31.7 | 221 / 732 |
| 1.25 | 1 in 355 | 98.4x | 1 in 33.8 | 245 / 820 |
| **1.22 (interpolated)** | **about 1 in 379** | **about 98x** | **about 1 in 35** | **about 260 / 870** |
| 1.20 | 1 in 397 | 97.6x | 1 in 36.3 | 274 / 918 |
| 1.15 | 1 in 448 | 96.4x | 1 in 39.1 | 310 / 1,031 |

Lowering the bell weight also lowers the natural average (bonus 2 and 3 need four and five bells and fall faster than bonus 1) and pushes the natural mix toward bonus 1. **That is the real cost of the Callback to the feel of the game: fewer teases (1 in 24 to about 1 in 35) and longer natural gaps, in exchange for a guaranteed bonus every 372 spins.** The alternative, holding the bell weight and cutting bonus size instead, breaks the 90-120x target and the floor (section 5.4). The final bell value and a base-phone re-centre are set from the full sim once the mechanism exists, not from this table.

### 5.3 Knob values (provisional, to be confirmed by sim once `--pull` runs)
| Knob | Proposed | Why |
|---|---|---|
| `pull.list` | 400 | felt progress every spin (5.1) |
| `pull.fill` | `dead 1.2, win 0.6, bonus 0.6` | keep the lead's ratio: a dead spin works twice a winning one; 372 spins per Callback |
| `pull.cold` | with value kept in the game (section 4.1 option b): `afterMs 24 h, stepMs 12 h, batch 20 (5% of the list), floor 200`. Without it: `afterMs 48 h, stepMs 24 h, batch 4, floor 380` | see section 4.1: a leak of any size is a transfer from the player to the house unless the value goes somewhere |
| `pull.warm` | chance 0.35, cap 4: to be sized by sim | warm squares raise phone value; payback to be bought back with base phone weight |
| `pull.ghost` | `minTenths 0`, `maxWinTenths 10` | honesty (section 4) |
| `pull.more` | `rtp 1.0`, `mult 2`, cap respected | payback-neutral gamble (section 4) |
| `pull.pot` | `feedBps 100`, `oneInPerDollar` from the real play volume | to be sized (5.6) |
| `pull.daily` | `base 20, perStreak 10, streakMax 4` (of 400: 5% to 15% of a list) | no money, a visible reward |
| `CFG.extra.base.bell` | about 1.22 (from 1.52), then re-centred | pays for the Callback (table above) |
| `CFG.extra.base.phone` | to be retuned after warm / pick | pays for warm squares |

None of this is in `CFG` yet: nothing of the PULL exists in the engine, so there is nothing to set. I will write the values into `CFG` only once the lead reports each mechanism landed.

### 5.4 Bonus floor (G1) and the 100x buy (G3): plan
Levers that exist today without mechanism code: `reveal.bonus1.bronze/silver/gold` weights, `extra.bonus1.wild/phone`, `spins.bonus1`, `retrigger`. Target: P(bonus under 10x) from 13.4% to about 8%, mean unchanged, and bonus 1 average from 83x toward 95x (paying for it from bonus 2 / 3 weight). Measured in Part 3 with `tools/levers-sim.js --stream` and `--cfg`.

### 5.5 Mechanics still waiting on the engine
Lead-list fill and Callback (exact model above; sim confirmation pending), warm squares (needs `--pull` with `warm.chance` 0 for the diff), ghost frequency per 100 spins (needs `--pull`), PICK YOUR LEAD (needs the sim's `--pickpolicy`), ONE MORE CALL (analytic: neutral at `rtp 1.0`), pot (needs real play volume).

### 5.6 Pot sizing needs a number I do not have
"Every regular has seen a friend take it" depends on how many paid spins the group plays per day. At `oneInPerDollar: 20000` and a $1 bet, one hit per 20,000 spins; at 1,500 group spins a day that is once per 13 days, which fails the aim. The pot at a hit averages `feedBps x oneIn / 10000` bets: 100 bps and 1 in 3,000 spins gives 30x; 100 bps and 1 in 20,000 gives 200x. I will read the real daily spin count from the server's history files in Part 3 and size to a hit every 2 to 3 days; the size of the pot then follows from the feed (about 3 points of RTP buys a 100x pot every 3,000 spins).

## 6. What I would change in Chris's targets and why (provisional; final after Part 3)

| Target | Today | Recommendation |
|---|---|---|
| Hit rate 20-24% | 20.63% | Hold. Lift to 22-23% only if the Callback leaves room; it is the cheapest way to shorten the P99 dead run from 20 to 17. |
| Under 1x wins at most about 5% of spins | 4.04% | Hold, and add: no win fanfare at 1.0x or less (R4). |
| Any bonus 1 in 180-220, averaging 90-120x | 1 in 207, 102x | Hold, but read "any bonus" as natural + Callback (192 at 372 spins per Callback). Add a floor: bonuses under 10x at most 8% (today 13.4%). |
| Bonuses 45-55% of payback | 50.3% | Hold. The Callback lives inside it. |
| Cheapest buy about 100x | 84.9x | Either accept 85x (it follows the bonus-1 average) or raise bonus 1 to about 98x average, which makes bonus 1 the dominant payer and should only be done with the floor change. |
| Cap 10,000x | 10,000x | Hold. |

## 7. Recommendations for Chris (outside the knobs)

- R1: **Callback cadence: one every 372 paid spins (list 400).** That is about 11 minutes at the median 100x session and once per 300x session. It costs 22 points, paid by cutting natural bonuses. Say if you want it rarer (600 spins: 14 points, natural bonus about 1 in 290).
- R2: **ONE MORE CALL at the true 1.0 (not 0.98).** Otherwise payback is 97% for everyone who takes it.
- R3: **State the payback as "98% for continuous play".** The leak and the lead carry-over make it slightly lower for a player who disappears.
- R4: **No win fanfare for a win of 1.0x or less.** 12.7% of spins; honesty, and Hacksaw-regulated markets require it.
- R5: **Tease staging in the skin:** bells landing one by one with the tease sound as they land; the odds do not change.
- R6: Ask the lead for an optional spread on the fill if the Callback feels like a timer.

## 8. Part 3 results

(open; filled after the lead's mechanisms land: knob table with sim behind each, before / after band table, total payback with CI, what I would change in the targets)
