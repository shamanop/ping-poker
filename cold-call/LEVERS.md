# COLD CALL levers: Hacksaw's real numbers vs ours, then the knobs for THE PULL

Owner: levers agent (Frank, session `coldcall-levers`). Brief: `cold-call/LEVERS-BRIEF.md`. Branch `coldcall-pull`, config c24 (the engine as it stands).
Status: **Parts 1, 2 and 3 done (2026-10-06).** Sections 5 and 6 are the early, provisional Part 3 notes and are SUPERSEDED by section 8 (the knobs that are now in `CFG`, with their sims). Where 5 and 8 differ, 8 wins.
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
| `pull.daily` | `base 20, perStreak 10, streakMax 4` (of 400: 5% to 15% of a list) | no money, a visible reward (SUPERSEDED: this paid a once-a-day player $5 a day, see 8.8) |
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

## 8. Part 3 results: the knobs for THE PULL (final, 2026-10-06)

Everything below is measured with `tools/levers-pull.js` (the engine's own `playRound`, state carried, a real daily streak, 1,000 paid spins a day, flat 1.00 bet, PICK played "best" = the hot square with the most hot neighbours, ONE MORE CALL banked) on shaman, 24 threads. Cross-check with the lead's own `games/coldcall-sim.js --pull` (20,000 sessions x 2,000 spins, seed 7, best pick): 97.82 +- 0.46 including the pot, 0.996% of stake paid out by the pot (`X_pull_best.json`). Runs and configs: `cold-call/levers-runs/` (D1_*, D2_*, E1_*, F_*, G_*, B0_before, X_*) and `levers-runs/cfg/`. Working notes: `levers-runs/P3-NOTES.md`.

### 8.0 The answer in one table

**Total payback 97.96% +- 0.14 (95%)** (final, after the daily re-tune of 8.8): 96.96 from the game (500M paid spins, `H2_best`, seed 121) plus 1.00 returned by the office pot (feed 100 bps, every cent paid back as prizes; the sim's one-bettor pot paid 0.996). That is for a player who plays PICK well and never lets the list go cold. The daily is now worth about nothing, so spins a day no longer matter. (The first cut, 98.03 +- 0.12, carried a daily gift worth +0.6 at 1,000 spins a day; the Opus re-check N2 showed it paid a once-a-day $1 player $5 a day. The rows below marked * were measured with that gift.) Other players (all measured):

| Player | Payback | Run |
|---|---|---|
| default picks / autoplay / timeouts ("first hot square") | 96.63 +- 0.20 | H2_first, 200M |
| best picks (the headline) | 97.96 +- 0.14 | H2_best, 500M |
| ONE MORE CALL taken every time * | 97.83 +- 0.28 (neutral: -0.2 +- 0.3, the sd of a spin goes 12.9x -> 15.9x) | D1_take |
| 300 spins a day * (the old daily weighed more) | 99.02 +- 0.29 | D2_day300 |
| 3,000 spins a day * | 97.73 +- 0.32 | D2_day3000 |
| no daily appointment at all (what the final daily is worth) | 97.42 +- 0.30 at the old phone weight | D2_nodaily |
| flat 10-cent / flat $25 bettor * | 98.09 +- 0.30 / 97.94 +- 0.32 | F_bet10, F_bet2500 |
| call / bonus1 / bonus2 / hunt BUY, best pick | 97.7 / 97.9 / 98.0 / 97.7 (+- 0.2 / 0.07 / 0.04 / 0.55) | H2_buys, 30M each |
| bonus1 BUY / bonus2 BUY, default pick | 95.0 / 97.3 | D1_buys_first |
| a pot chaser (bets only while the pot holds at least the cap) | **98.69** (97.02 + 1.667, the same at every bet; measured at 10c, $1, $25 in 8.11). Before 8.11 this row said 98.7 for every bet and was wrong above $1: on the old cap (`maxPayX` 50 x bet) a $25 chaser got 138.7 | measured, 8.11 (was analytic, 8.8) |
| a player away for days | lower, see 8.4 | analytic |

No policy I could construct pays more than 100%: the best PICK heuristic is worth 6.5% on a bonus1 over the default (search over six heuristics, `tools/lv-pickpol.js`: first 99.4, most-neighbours 105.9, neighbour-of-neighbour 106.1, centre 101.7, least-neighbours 98.3, edge 99.6 on the PICK as it was before I weakened it), and the sim's "best" is the practical maximum. The buys are priced against it so a buy never beats 98% even for a perfect picker. That matters most in Chips, which is the poker bank.

### 8.1 Every knob, its value, the reason, the sim behind it

| Knob | Value | Was | Reason and evidence |
|---|---|---|---|
| `pull.list` | **450** | 50 | A Callback every **422 paid spins** (mean 412 in the sim + the daily gift; median 415, P90 425: the spread is 2%). 450 leads ticks the "LEADS 312 / 450" number on every spin (fills are 1.2 and 0.6). Cadence sets the budget: Callback costs 22.9 RTP points at this rate (94.3x average bonus / 412). At 50 leads it cost 200 points. A returning 100x-bankroll player sees a Callback in 55% of sessions, a 300x player in 99.9% (D3_sess100c, D3_sess300c) = "about once a real session". Alternative tried (E1: list 600, bell 1.27): any-bonus share in a fresh 100x session 41% vs 36%, nothing else moves; not worth the slower meter. |
| `pull.fill` | dead 1.2, win 0.6, bonus 0.6 (unchanged) | same | The lead's ratio is right: a dead spin works twice a win. **Spread (open ask answered): the first passage has a coefficient of variation of 2%** (P10-P90 about 10 spins around 412) because the only randomness is dead vs paid. It is clockwork. I recommend leaving it: the surprise lives in the natural bonuses, the meter is the goal-gradient; adding spread needs a weighted-outcome fill (mechanism code) and would not change a number above. If Chris wants it unpredictable, ask the lead for a two-point `fill.dead` (1.2 for 90%, 3.0 for 10%, same mean). |
| `pull.callback.kind` | `bonus1` | same | Bonus 1 at a 412-spin cadence is the guaranteed bonus a player can count on; bonus 2 (286x) at 1 in 1,200 spins would feel like a lottery again. Average 94.3x (P10 under 1x: 6.8%, same shape as a natural bonus 1). |
| `pull.carryOver` | `true` | same | Leads above the list stay: no wasted spins. |
| `pull.pick` | `minLeads 2`, `mult bronze 0.3, silver 2, gold 3, upsell 1, close 1` | bronze 0, silver 2, gold 3, upsell 2, close 2 | Bronze is the lever, not the others. Sweep (`--bonus`, 400k runs a cell, `bonus_P0..P4.json`), bonus1 average first / best / PICK off: default 98.2 / 104.7 / 82.9; upsell 1: 99.4 / 104.7; (0,1.5,2,1,1): 97.8 / 103.5; **(0.3,2,3,1,1): 91.4 / 94.1**; (0,1.5,2,1.5,1.5): 97.7 / 103.9. The chosen one lifts a bonus1 +10 to +13% (bonus2 +2 to +3%) and keeps the best-over-default edge at 3% instead of 6.5%. It also keeps combined bonus value near 100x (see 8.2) and lets the bonus1 buy sit at 96.4x. Cost: the picked square is a bronze 36% of the time instead of never. |
| `pull.more` | `rtp 1.0`, `mult 2`, `minTenths 50` | rtp 0.98, minTenths 20 | **A fair coin: win probability exactly 1/2, pays x2.** Payback neutral for every player and policy (taken always: -0.2 +- 0.3 pts, D1_take), so the 98% holds whatever people do and the info screen can say "double or nothing, 50 / 50". Offered from a 5x bonus up (a gamble on a 2x bonus is not a decision). |
| `pull.warm` | `chance 0.35`, `cap 4` | same | The value is real and large: **+4.3 points of payback** (base phone part 14.64 -> 18.90, D1_nowarm vs D1_best, 200M / 400M), hit rate 20.69% -> 21.80%, 30.8% of spins start with a warm square. Paid for by the base phone weight (8.2). Warm hits: 1.49 phone fires per 100 spins at 5.9x. Bet switching is not an exploit (the critics' F1 attack): in the sim's `--bet-switch` mode the $25 spins that lose their warm squares pay 67.7% and the whole switcher about 70% (`X_pull_switch`). |
| `pull.ghost` | `on`, `maxWinTenths 10`, **`minTenths 50`** | minTenths 0 | Shown only if the base spin paid under 1x AND the call you did not get would have paid 5x or more. Frequency per 100 spins by `minTenths` (G_0..G_100, 50M spins): 0 -> 27.5 (avg 3.9x), 10 -> 19.6, 20 -> 14.5 (6.7x), **50 -> 6.0 (avg 11.7x)**, 100 -> 2.1 (21.3x). Every value shown is the real counterfactual and none is altered. **This is a judgment call, flagged for Frank:** showing only the 5x+ ones is selective (a line that appears 6 times in 100 spins rather than 27), still true. Needs one sentence on the info screen: "this line appears only when the unplayed call would have paid 5x or more, about 6 spins in 100". If you want zero selection set `minTenths 0` and let the UI make small ones quiet. **Wording (open ask answered): "IF A PHONE HAD LANDED: 12x"**, not "would have closed": the phone did not land, the number is a draw of what it would have paid. |
| `pull.cold` | `afterMs 36 h`, `stepMs 12 h`, `batch 8`, `floor 300` | 24 h / 6 h / 3 / 10 | A daily visitor (even a late one) never leaks. After 36 h idle, 8 leads (1.8%) go cold every 12 h, never below 300 of 450. Worth 0.215 bets per lead (Callback part 22.94 pts / 1.069 leads a spin x 1/100): 2 days away costs 8 leads = 1.7 bets, 3 days 32 leads = 6.9 bets, 7 days 88 leads = 18.9 bets, worst case about 150 leads = 32 bets. Not measurable in the sim (S5, no idle time): analytic. See 8.4. |
| `pull.daily` | `base 0.2`, `perStreak 0.05`, `streakMax 4`, `stakeCap 10` | 3 / 1 / 4 / 100 (then my 8 / 4 / 4 / 100) | **Re-tuned after the Opus re-check (N2), see 8.8.** 0.2 to 0.4 of a lead a day, worked at 10 cents: a ritual and a streak counter, not money. The 8 / 4 / 4 / 100 I first set paid a once-a-day $1 player $4.87 a day. |
| `pull.pot` | `feedBps 100`, `oneInPerDollar 3000`, `seed 0`, `minBal 1000` ($10), `capCents 5000` ($50, the same for every bet; was `maxPayX 50`, changed in 8.11) | 50 / 20000 / 0 / 100 / 1000000 | See 8.3 and 8.11. |
| `pull.feed.minWinX` | 100 | same | Wins of 100x or more are 1 in 553 spins counting Callbacks (D2_best); with every bonus also pushed (about 1 a 210 spins) a group of five at 300 spins a day each sees 7 bonus lines and 3 win lines a day. Enough. |
| `pull.decision.timeoutMs` | 20000 | same | Not a payback knob. |
| `extra.base.bell` | **1.175** | 1.52 | Natural bonus 1 in 207 -> **1 in 420** (average 108x, b1 1/447 at 95x, b2 1/7,392 at 286x, b3 1/150,094 at 1,112x). Teases (two bells) 1 in 24.4 -> 1 in 37.6. This pays for the Callback: any bonus (natural + Callback) stays **1 in 208**. Not a CFG.pull knob; an engine value. |
| `extra.base.phone` | **0.2275** | 0.308 | Pays for warm squares: base phone part 20.2 (+4.3 warm) -> 19.4 including warm (0.2205 until the daily re-tune gave back 0.6 points). Phone feature gaps: mean 43.6 spins (was 63.8, warm squares make more of them). Engine value. |
| `buyCost` | **call 27 (2.7x), bonus1 964 (96.4x), bonus2 2910 (291.0x), hunt 20 (2.0x)** | 29 / 849 / 2824 / 35 | Re-priced at the best-pick average / 0.98 (30M-run `buys`, D2_buys_best): call 97.7 +- 0.2, **bonus1 97.8 +- 0.1, bonus2 98.0 +- 0.04, hunt 97.9 +- 0.6**. Default picks: 95.0 / 97.3 / hunt 95.7. Cheapest full bonus 96.4x: Chris's "about 100x" holds. Hunt still makes a bonus 5.3x more likely (1.25% vs 0.24%), so the "5x more likely" label stays true; it costs 2.0x, not 3.5x, because bonuses are now rarer and worth less per spin. `hunt.bellMult` unchanged (1.845). |

### 8.2 The budget, before and after (flat 1.00 bet)

| | Before (c24, no PULL) | After |
|---|---|---|
| Clusters | 28.9 | 29.4 |
| Base phone (incl warm after) | 19.8 | 19.4 (warm is 4.3 of it) |
| Natural bonus | 49.3 | 25.7 |
| Callback | 0 | 22.4 |
| Pot (feed returned as prizes) | 0 | 1.0 |
| **Total** | 97.9 (+- 0.1) | **97.96 (+- 0.14)** |
| Bonus share of payback | 50.3% | 49.6% |

Chris's targets, one by one: hit rate 20.63% -> **21.80%** (target 20-24, warm squares add 1.1); wins under 1x 4.04% -> **4.53%** of spins (at most 5%); any bonus 1 in 207 -> **1 in 208** averaging **101x** (90-120) if "any bonus" counts the Callback, natural alone is 1 in 420; bonuses **49.6%** of payback (45-55); cheapest buy **96.4x** (about 100); cap 10,000x reached 1 in 2.41M events (was 1 in 2.75M).

### 8.3 The pot (W8, F6, W9)

- **Seed stays 0** (W9). **F6 stays as decided**: the prize is outside the 10,000x cap; the info screen says "the pot is extra".
- **Chasing (W8): CORRECTED in 8.11, the bound below was wrong above a $1 bet.** (Original text: "a bettor's pot EV per dollar staked is `min(pot / bet, maxPayX) / oneInPerDollar`, at most 50 / 3000 = 1.67 points, so a chaser gets at most 98.7%".) The formula dropped a factor of the bet. The chance of a hit is `bet$ / oneInPerDollar` and the prize is `min(pot, maxPayX x bet)`, so the pot EV per dollar staked is `min(pot$, maxPayX x bet$) / oneInPerDollar`: 1.67 points only at a $1 bet, 0.17 at 10c and **up to 1,250 / 3000 = 41.7 points at a $25 bet** once the pot holds $1,250 (measured 41.67 expected, 8.11). The pile-up the small bets left in the pot (8.10) is what fills it. Fixed in 8.11 with a cap in money: `capCents` 5000, whose bound is `capCents / 100 / oneInPerDollar` = 1.67 points at EVERY bet. Rule if you move a knob: keep `capCents >= feedBps x oneInPerDollar / 100` (3000, or the pot cannot pay out what it is fed) and `capCents / 100 / oneInPerDollar` under the headroom you want a chaser to have (1.67 points = 98.69 total).
- Size: the pot at a hit is on average `feed x oneIn` = 1% x $3,000 = **$30** of wagers (the prize is now `min(pot, $50)` for every bet, 8.11; it was `min(pot, 50 x bet)`: a $1 bettor up to $50, a 10-cent bettor up to $5, a $25 bettor the lot; what is not paid stays in the pot). `minBal $10`: a hit on a pot under $10 pays nothing and waits.
- **Frequency needs the group's real spending, which I do not have**: the server keeps history in memory only (20 rounds an account) and the game is not live, so there is no log to read. Hits per week = 7 x (dollars wagered a day) / 3,000: $300 a day -> one hit in 10 days; **$1,000 a day -> one every 3 days**; $3,000 a day -> one a day. The aim (every regular has seen a friend take it) is met at about $1,000 a day, which is five players at 200 spins at $1. After the first live week set `oneInPerDollar = 7 x (dollars a day) / 2` (two hits a week) and `maxPayX = 0.0167 x oneInPerDollar` together.

### 8.4 Cold leads (open ask: should the value of leads that go cold go to the pot?)

Yes in principle, and it is the better design, but it needs one engine and server change (the house credits `0.215 x list-average bet` per lead to the pot; the pot already tracks house money as `seeded`), so I did not do it. What I did instead: a leak small enough that it costs nothing a daily player ever sees, and the info screen says **"98% for continuous play"**. Cost of being away (analytic, 0.215 bets a lead): 2 days 1.7 bets, 3 days 6.9, 7 days 18.9. A player who plays 400 spins once a week gives up about 19 bets to the leak on top of the 8 the house edge takes from 400 spins at 98%: **about 93% for that player**; a player who plays daily loses nothing. If Chris wants the "7 leads go cold in 3 h" line to bite harder, the pot route is the one that does not move the payback.

### 8.5 What changed in the feel, honestly

| Measure | Before | After |
|---|---|---|
| Tease (two bells) | 1 in 24.4 spins | 1 in 37.6 |
| Natural bonus | 1 in 207, gap P99 950, longest 3,404 | 1 in 420, gap median 292, P99 1,930, longest 5,751 |
| **Any bonus (natural + Callback) gap** | mean 207, median 144, P90 475, **P99 950, longest 3,404** | mean 208, median 186, P90 414, **P99 427, longest 445** |
| Wins of 5x+ gap | mean 48.7, P99 223, longest 860 | 51.8, 232, 679 |
| Wins of 20x+ gap | mean 145, P99 666 | 148, 563 |
| Phone feature gap | mean 63.8 | 43.6 |
| Any event (5x+ win, tease, phone, bonus) gap | mean 15.6, P99 70, longest 305 | 17.5, 79, 291 |
| Dead-spin run | median 4, P99 20, longest 80 | median 3, P99 20, longest 80 |
| Win ladder, event 20x / 100x / 1,000x | 1 in 145 / 574 / 29,774 | 1 in 148 / 553 / 37,629 |
| Natural bonus under 1x / under 10x / under 20x of the stake | 6.6% / 13.4% / 21.7% | 6.7% / 11.3% / 18.1% (PICK helped; not fixed, see 8.7) |

The PULL removes the long drought (any bonus, 3,404 spins -> 445) and pays for it with rarer teases and rarer natural bonuses.

| Time on device, flat 1x bet to bust, 20,000-spin cap | P10 / median / P90 spins | See a bonus | See a Callback | Touch 2x | See 100x+ |
|---|---|---|---|---|---|
| 100x bankroll, before | 132 / 229 / 2,355 | 57.5% | n/a | 27.2% | 31.5% |
| 100x, a **returning** player (list part full, D3_sess100c) | 135 / 241 / 2,096 | 61.9% | 54.9% | 27.0% | 32.3% |
| 100x, a **first-time** player (empty list, D2_sess100) | 131 / 183 / 1,003 | **36.2%** | 17.5% | 15.9% | 20.0% |
| 300x, before | 519 / 1,255 / 14,598 | 92.4% | n/a | 32.2% | 68.0% |
| 300x, returning (D3_sess300c) | 570 / 1,358 / 11,810 | 99.9% | 99.9% | 30.1% | 72.2% |

**The cost lands on the first session of a new player**: half as many see a bonus in a 100x session (36% vs 57%). A returning player is where he was. The lead list is persistent by design, so this is a one-time dip; if Chris cares about it, the lever is a head start (a larger first daily gift) or list 600 (E1: 41%), not the cadence.

### 8.6 Tests (the lead / Frank must act)
Two old tests pin the old base game and fail with the new `bell` / `phone`: `tests/coldcall.js:588` (any bonus 1 in 120-250; natural is now 1 in 420, widen to about 120-600) and `tests/coldcall-pull-engine.js:61` (legacy-equality digest: golden of the old weights, needs the new digest). Everything else passes (47 with those two, server 43). A third test now also fails with the new weights, `tests/coldcall-pull-server.js` "W1B N5" (its `toPending` helper asks for a decision of one kind in 600 buys and throws "no more decision"; it passes with bell 1.52 / phone 0.308 and with every other value of mine reverted one at a time, so it is sensitive to the base weights; the helper should check every pending step, not only the first). They are outside my write scope; I asked Frank. The edit of `games/coldcall-engine.js` is in the working tree and the public copy is re-synced (cmp clean), not committed until the two tests are decided.

### 8.7 What I would change in Chris's targets, and what is still open
- **Read "any bonus 1 in 180-220" as natural + Callback.** Natural alone is 1 in 420. Say it that way on the info screen too.
- **Add a payback sentence to the targets: "98% with the best PICK, about 97% with default picks, for continuous play"; a casual player gets nothing from the daily (8.8) and loses a few points to the cold leak.** One number cannot cover all of them.
- **Add a floor target: natural bonuses under 10x at most 8%.** Now 11.3% (was 13.4%). PICK helped, the rest needs the bonus 1 reveal / spin tables retuned, which is a base-game change I did not make inside the PULL pass.
- Hold the rest: hit rate (21.8%), under 1x (4.5%), bonus share (50%), buy (96.4x), cap. No fanfare for a win of 1.0x or less (12.7% of spins returned the bet or less before, 13.6% now).
- The tease dropping to 1 in 38 is the visible price of the Callback. If Chris wants teases back, the one lever is a rarer Callback (list 600 gives natural 1 in 338 and tease 1 in 33) at the cost of the persistent meter.
- Open for Frank: (a) the ghost filter `minTenths 50` (8.1, ghost row), (b) the two tests (8.6), (c) the cold-lead-to-pot change (8.4), (d) real group volume for the pot (8.3).

### 8.8 The daily appointment re-tuned (Opus re-check N2, 2026-10-06 07:05)

The finding is right and it was my value. A free lead is worth `94 x average bet / 450` = 0.21 bets, whatever the player stakes, so 8 to 24 free leads (1.8% to 5.3% of a list) are a large gift to anyone who plays few spins: a once-a-day $1 player gained **$4.87 a day** (`tools/lv-daily.js 100`, 500 players x 15 years, `cfg 8/4/4/100` vs no daily; the critic's own loop gave $15 on the older knobs). My sim had no daily loop worth the name (S4), so the 98.03 hid it.

Re-tuned to **`base 0.2, perStreak 0.05, streakMax 4, stakeCap 10`** (0.2 to 0.4 of a lead a day, worked at 10 cents). Same loop, 500 players x 15 years, once a day at $1: gift vs no daily **$0.008 a day**; at a $25 bet about $0.5 a day on a $25 stake (2%, noisy). Why so small: any whole lead is worth about 10 cents to such a player, so "a few cents" means a fraction of a lead; the gift is proportional to free leads over leads earned, and a once-a-day spinner earns 1.07 a day. For a regular the daily is now worth under 0.05 points. It is a streak ritual for the UI, not a reward in money. If Chris wants the appointment to feel like a gift, it needs a mechanism that scales with play (a match on the leads worked that day, the critic's second suggestion); I do not write that.

Total payback was re-centred for it: `extra.base.phone` 0.2205 -> 0.2275 (96.49 +- 0.15 at 0.2205 on 400M, 96.90 at 0.2265, **96.96 +- 0.14 at 0.2275 on 500M**; each +0.01 of phone weight is +0.85 points). The sim sessions now carry a daily of 1 claim a day; with this value it cannot move a number.

N1 (the Callback bet is rounded to the nearest 10 cents, so a player who mixes two bet sizes steers it up, +6.9 points) is an engine fix assigned to the wave-2 lead. **My total does not count it** (flat bets only); once it lands I re-run the total with the mixed-bet policy of the critic's N1 repro.

## 8.9 Re-run with the Callback floor (N1)

Measured 2026-10-06 on shaman (24 threads, scratch `E:\bricklord-test\coldcall-n1`, nothing on C:), engine = `git show HEAD:games/coldcall-engine.js` at 12b9e1e (sha256 2df15ce8...), sim = `games/coldcall-sim.js` with the new `--bet-mix` flag. Raw output: `levers-runs/N1_*.json|txt` (what-ifs `N1w_*`). No CFG value was changed. **Result: flat play FAILS the band (96.87, not 98.0 +- 0.3); bet mixing PASSES (nobody beats flat).**

**Floor check.** `cbBet` (`games/coldcall-engine.js:129`) is `min(2500, max(10, floor(avg / 10 + 1e-9) * 10))`: the floor ships. `git diff 265dd33 HEAD -- games/coldcall-engine.js` is empty: no CFG value moved, and e56db4f (the floor) is an ancestor of 265dd33, so the 97.96 was already measured on this engine. It still did not see the floor, because `tools/levers-pull.js --stream` adds a Callback's value in x-bet of the nominal bet (`a.cb += R.bonusRawTenths`), never at `r.betCents`.

**Headline repro.** `levers-pull.js --stream 500000000 121 --pick best --day 1000 --bet 100`: **bit-identical to H2_best** (96.962 +- 0.137 game part, Callback 22.349; + the 1.00 pot that 8.0 quotes = 97.96). So the old number reproduces, and it is the nominal-bet number.

**Real-cents re-run.** `--pull 100000 2000 121 --pickpolicy best --nowarmdiff` (200M paid spins, 400 batches, Callbacks valued at their own bet, the sim's one-bettor pot measured), table of 95% intervals:

| Player (best picks) | Total | Ex-pot | Callback part | Avg Callback bet | Run |
|---|---|---|---|---|---|
| flat $1 (the headline player) | **96.87 +- 0.22** | 95.87 | 21.19 | **94.9c** | N1_flat100 |
| flat $2 | 97.42 +- 0.22 | 96.42 | 21.74 | 194.6c | N1_flat200 |
| flat 20c | **92.76 +- 0.21** | 92.43 | 17.74 | 15.9c | N1_flat20 |
| flat 10c | 97.19 +- 0.22 | 97.02 | 22.34 | 10.0c | N1_flat10 |
| flat $25 | 97.97 +- 0.22 | 96.97 | 22.29 | 2,494.6c | N1_flat2500 |
| what-if daily off, flat $1 | 98.14 +- 0.22 | 97.14 | 22.40 | 100.0c | N1w_nodaily_flat100 |
| what-if `daily.stakeCap` 2500, flat $1 | 98.02 +- 0.22 | 97.02 | 22.34 | 100.0c | N1w_cap2500_flat100 |
| what-if `daily.stakeCap` 2500, flat 20c | 97.36 +- 0.22 | 97.02 | 22.34 | 20.0c | N1w_cap2500_flat20 |

The pot column is small for small bets because the sim's pot has one bettor and pays at most `maxPayX x bet` (0.17 points at 10c, 0.33 at 20c, 1.0 from $1); a real shared pot is drained by the bigger bettors, so compare the ex-pot column across bet sizes. (Fixed in 8.11: with `capCents` 5000 the pot column is 0.96 / 0.98 / 0.995 / 1.00.)

**Why flat is short: the floor and the daily.** The daily gift's leads are worked at `min(bet, stakeCap)` = 10c, so any list holding one has a lead-weighted average a hair under the bet (a $1 bettor: 99.96c), and the floor takes a whole 10-cent step. Measured on the engine (`playRound`, 400k spins, one daily claim per 300 spins, seed 77): flat $1 Callbacks 951 of 951 at **90c** (no daily: 950 of 950 at 100c), flat 50c 951 of 951 at 40c, flat 20c 951 of 951 at 10c, flat 10c exact, flat $25 at 2,490c; with one claim per 1,000 spins a $1 bettor gets 837 of 950 at 90c. A flat 20c bettor loses half of the Callback value, a $1 bettor 5 to 10%. A once-a-day $1 player (500 players x 15 years, a scratch copy of `tools/lv-daily.js`) is now **worse off with the daily than without it**: payback 93% vs 96%, gift -$0.029 a day.

**Bet-mixing attackers** (same seed and spins; all intervals +- 0.2, inside the +-0.5 target):

| Policy | Total | Ex-pot | Avg stake / Callback bet | vs the flat player it could have been |
|---|---|---|---|---|
| N1 attacker 10c, 20c while avg < 15.5c (`--bet-mix 10,20`) | **86.41 +- 0.21** | 86.13 | 15.50c / 10.00c | -10.8 vs flat 10c (97.19) |
| same at $1 / $2, hi while avg < 155.5c (`--bet-mix 100,200`) | **94.50 +- 0.23** | 93.50 | 155.5c / 150.0c | -2.4 vs flat $1 (96.87), -2.9 vs flat $2 |
| $1 / $2 aimed at a multiple of 10 (`--bet-mix 100,200,150`) | 94.37 +- 0.22 | 93.38 | 150.0c / 145.2c | -2.5 vs flat $1 |
| existing `--bet-switch` (10c, $25 after >= 3 warm squares) | 95.64 +- 0.65 (stake mix: 8.5% of spins, 96% of stake at $25) | n/a | 214.9c Callback bet | -2.3 vs flat $25 (97.97) |

The floor closes N1: with the floor `cb.bet <= avg`, so the steered Callback pays 10c on 15.5c of stake (64.5%) and the policy that gained 6.9 points before is now 10.8 below flat 10c. The mix also drops every warm square on a bet change (base phone 16.5 vs 19.5). The `--bet-switch` row: the 10c spins pay 71.8%, the $25 spins 72.6%, the 15.4M attack spins (warm squares dropped) 70.3%; this mode prints no interval, the per-spin sd of 12.7x (quoted from H2_best) gives about +-0.6 on the $25 spins.

**Verdict.**
- Flat play: FAIL. Flat $1 is 96.87 +- 0.22 against 98.0 +- 0.3 (gap -1.1, about 0.8 below the band edge); flat 20c is 92.76. The headline 97.96 stands only as a nominal-bet number.
- Bet mixing: PASS. Every mixed policy is 2.3 to 10.8 points below its best flat alternative; none is within noise of flat.

**What I would change (not done; the brief says stop).** One knob, `pull.daily.stakeCap` 10 -> 2500 (daily leads worked at the player's own bet, so a flat bettor's average stays exact and the floor never bites). Measured effect: flat $1 96.87 -> **98.02 +- 0.22**, flat 20c 92.76 -> 97.36 (ex-pot 97.02, the same as every other bet), the attackers do not move (86.55 +- 0.24 and 94.47 +- 0.24, `N1w_cap2500_mix*`), N1 stays closed. Cost, which is why I did not just do it: that is the N2 gift back at its stake-scaled size. Once-a-day $1 player, 500 x 15 years, gift vs no daily: **+$0.055 a day** (payback 102%; against -$0.029 today and the $0.008 8.8 aimed at), and it grows with the bet. So pair it with a smaller gift: `daily.base` 0.2 -> 0.1 and `perStreak` 0.05 -> 0 (the lead count is kept in tenths, 0.1 is the smallest gift), expected about +$0.014 a day at $1 (scaled from the measured +0.055, not measured). Without that second change the first reopens N2; with the daily off (`base 0, perStreak 0`) flat $1 is 98.14 +- 0.22 measured, the simplest route to the band if the appointment is only a ritual. The engine alternative (daily leads join at the current average instead of at `min(bet, stakeCap)`) has the same N2 cost per lead; the critic's floor-plus-carry-the-remainder would cover it without a knob but is an engine and state-shape change.

Not run: a flat 50c run (the 50c to 40c figure is the engine micro-test above, not a payback measurement); an interval for `--bet-switch` (the mode has none).

## 8.10 Callback floor with carry (FIX N1-CARRY)

Measured 2026-10-06 on shaman (24 threads, scratch `E:\bricklord-test\coldcall-n1c`, nothing on C:), engine = `games/coldcall-engine.js` with `cbArm` (floor10 of `avg + carry`, the remainder carried in `state.carry`; sha256 3691fd05...), sim = `games/coldcall-sim.js` (only a help-text change). Same setup as 8.9: `--pull 100000 2000 121 --pickpolicy best --nowarmdiff` (200M paid spins, seed 121, Callbacks valued at their own bet). No CFG value changed. Raw: `levers-runs/N1C_*.json|txt`. Cluster, base phone and natural bonus parts are bit-identical to the 8.9 runs of the same seed (flat $1: 29.45 / 19.50 / 25.74); only the Callback part moved (flat $1 21.19 -> 22.34).

| Player (best picks) | Total | Ex-pot | Callback part | Pot part | Avg Callback bet | Run |
|---|---|---|---|---|---|---|
| flat 10c | **97.19 +- 0.22** | 97.02 | 22.34 +- 0.11 | 0.165 | 10.00c | N1C_flat10 |
| flat 20c | **97.35 +- 0.22** | 97.02 | 22.33 +- 0.11 | 0.333 | 20.00c | N1C_flat20 |
| flat $1 | **98.02 +- 0.22** | 97.02 | 22.34 +- 0.11 | 0.995 | 99.99c | N1C_flat100 |
| flat $25 | **98.02 +- 0.22** | 97.02 | 22.34 +- 0.11 | 1.000 | 2,499.8c | N1C_flat2500 |
| 10c / 20c mixer (`--bet-mix 10,20`) | 94.39 +- 0.23 | 94.11 | 22.51 +- 0.12 | 0.283 | 15.50c (stake 15.50c) | N1C_mix10_20 |
| $1 / $2 mixer (`--bet-mix 100,200`) | 95.29 +- 0.23 | 94.29 | 22.51 +- 0.13 | 0.998 | 155.50c (stake 155.53c) | N1C_mix100_200 |
| `--bet-switch` (10c, $25 after >= 3 warm squares) | 96.24 +- 0.65 | 95.24 | 22.67 +- 0.13 | 0.999 | 220.7c | N1C_betswitch |

Before (8.9, floor only): flat $1 96.87 (Callback 21.19, bet 94.9c), flat 20c 92.76 (17.74, 15.9c), flat 10c 97.19, flat $25 97.97, mixers 86.41 / 94.50.

**(i) Callback part: PASS.** Every flat bet gives 22.33 to 22.34 (+- 0.11), the $25 figure is 22.34: the floor no longer costs anything and the 20c player's Callback plays at 20.00c, not 10c. No mixing policy pays above flat by more than noise: the mixers' Callback part is 22.51 vs 22.34 (+0.17, 1.0 sigma of the difference), `--bet-switch` 22.67 (+0.33, 1.9 sigma; the sim has no interval for the total, the Callback part's interval is the one printed). In TOTAL every mixer is far below flat: 94.39 vs 97.19 / 97.35 (flat 10c / 20c), 95.29 vs 98.02 (flat $1), 96.24 +- 0.65 vs 98.02 (flat $25). The mix still drops warm squares at every bet change (base phone 16.5 vs 19.5), and now pays no more than the stake it staked. Attack closed: N1 attacker 86.41 -> 94.39 is the carry returning the stake the floor used to eat, not a gain over flat.

**(ii) Flat totals inside 98.0 +- 0.3 (97.7 to 98.3) within the interval: flat $1 and flat $25 PASS (98.02 +- 0.22 each); flat 20c FAILS (97.35 +- 0.22, interval 97.13 to 97.57, 0.65 under 98.0); flat 10c FAILS (97.19 +- 0.22, 0.81 under).** Ex-pot, all four flat bets are 97.02 (identical, to the last digit). The whole gap is the pot part: 0.165 at 10c and 0.333 at 20c against 0.995 at $1 and 1.000 at $25, i.e. -0.83 and -0.66 points, as 8.9 predicted. Not a Callback problem any more.

**Why the pot pays small bets less (not changed).** A pot hit pays at most `maxPayX x bet` (50 bets) and the hit chance per spin is also proportional to the bet, so the pot's payback is `min(1% feed, maxPayX x bet / (oneInPerDollar x 100))`: 50 x 10 / 300,000 = 0.167% at 10c (measured 0.165), 0.333% at 20c (0.333), and the 1% feed binds from about 60c up. At 10c and 20c the pot piles up unpaid (cents left in the sim's pot, summed over the batches: 16.69M at 10c, 26.67M at 20c, 0.91M at $1). What I would change: give the prize cap a floor in money, `prize = min(bal, max(maxPayX x bet, 3000 cents))` (3000 = feed 1% x `oneInPerDollar` 3000 x 100 cents, the smallest cap at which the pot can pay out all it is fed at every bet size). Before it ships it needs the W8 chaser check redone at 10c: the floor makes the most a 10c spin can win 300 bets instead of 50, with the hit chance unchanged per dollar. Alternative with no code change to the cap: a higher hit chance per dollar for small bets. Not done, no pot knob or pot rule touched. **Done in 8.11 (candidate A was the floor above; the cap in money, candidate B, won).**

**Carry accounting check (engine, not sim).** Test N1-CARRY (a): flat $1, real daily (stakeCap 10c), list 450, one claim per list, 20 lists: Callback stakes sum to within 10c of the lead-weighted stake paid in (the floor alone: about 9.96c lost per list, 199c in 20). Test (b): the N1 attacker, a carry-reading attacker, a coin-flip mixer and a 50c/10c mixer never get more Callback stake than their leads were worth on any prefix of 150 lists, and lose under one carry plus the unarmed rest of a list.

## 8.11 The pot: small bets and the chaser (FIX POT-CAP)

Measured 2026-10-06 on shaman (24 threads, scratch `E:\bricklord-test\coldcall-pot`, nothing on C:). Flat runs: the 8.10 setup, `--pull 100000 2000 121 --pickpolicy best --nowarmdiff --bet B` (200M paid spins, seed 121, best picks, Callback with floor + carry), engine = the 8.10 engine plus the new pot rule; ex-pot every flat bet is 97.02 as in 8.10 (cluster, phone, bonus, Callback parts bit-identical). Pot-only rooms: the new sim mode `--pot-room` (below). Raw: `levers-runs/POT_*` (`POT_experiment.patch` = the two-candidate engine used for the measurement, A and B both as knobs; the committed engine has only the winner). No game number moved: only the pot part.

**Verdict on the 8.3 chaser formula: Frank's reading is right, 8.3 was wrong above $1.** Hit chance per spin = `(cost / 100) / oneInPerDollar`, prize = `min(bal, maxPayX x bet)`, so the pot EV per dollar staked = `min(pot$, maxPayX x bet$) / oneInPerDollar`, in dollars of pot, not in bets of pot (8.3 had `pot / bet` where `pot` belongs). Measured, current rule, room R1 (40 flat 10c + 40 flat 20c feeders, 100,000 ticks, 200 rooms, seed 777; the chaser spins once a tick while the pot is at least T; "expected" = the prize a spin is worth given the pot at that moment, no roll noise, `expPct` in `POT_chaser_conf.json`; the rolled prizes agree within their intervals): a $25 chaser with T = $1,250 gets **41.67 points of pot** (analytic 1250/3000 = 41.67; rolled 38.5 +- 2.2), total **138.7%**; $1 chaser 1.667 (98.69); 10c chaser 0.167 (97.19). T lower: pot part by T at $25 is 1.4 (always), 2.4 ($30), 3.9 ($75), 6.4 ($150), 11.4 ($300), 18.0 ($500), 26.4 ($750), 41.7 ($1,250+) (`POT_chaser_scan.json`). The pile-up is real in a small-bet room: after 100,000 ticks (about 1.2M dollars staked) the pot holds $4,329 on average and $8,655 at the end (feeders only, current rule). With 20 $1 players added (R2) the $1 players drain it (they get 1.43 points of pot from the 10c / 20c pile) and a $25 chaser's pot is rarely above $750 (26.4 points on 4,752 spins): the room decides how much the chaser gets, the rule only bounds it.

**What I added to the sim (the pot is a per-batch single-bettor pot in `--pull`, no shared policies):** `--pot-room [ticks] [seed] --feeders bet:count,... [--chase bet,T[,perTick]] [--batches N]`, pot only, no game (the pot does not depend on game outcomes): each tick every feeder spins once, the chaser spins while the pot holds at least T. Same pot code and rng stream as `--pull` (`Eng.potSlice`, `potHitChance`, new `Eng.potPrize`), so a one-feeder room reproduces the pot part of a `--pull` run bit for bit: checked for all 16 rule x bet cells, pot part and cents left identical (flat 10c current rule: 0.1654, 16,692,000 cents left, 6,616 hits in both). Prints per class stake, pot part, an expected-prize estimate, average and largest prize in bets, cents left, and `fed + seeded = paid + left` to the cent (true in every run). 200M spins take 0.4 s on shaman, so the chaser threshold is scanned on a grid (12 thresholds x 3 bets x 2 rooms x 4 rules) and the best threshold is re-measured on a fresh seed.

**Candidates** (same setup; "flat total" = 97.02 + pot part; band 98.0 +- 0.3 = 97.7 to 98.3; every flat total has 95% +- 0.22):

| Rule | 10c | 20c | $1 | $25 |
|---|---|---|---|---|
| current (8.10): flat total / pot part | 97.19 / 0.165 | 97.35 / 0.333 | 98.02 / 0.995 | 98.02 / 1.000 |
| **A** `max(maxPayX x bet, 3000c)`: flat total / pot part | 97.89 / 0.869 | 97.92 / 0.905 | 98.02 / 0.995 | 98.02 / 1.000 |
| A cents left (summed over 200 batches) | 2,617,384 | 3,782,721 | 911,217 | 657,150 |
| A prize avg / largest, in bets | 281.8 / 300.0 | 143.0 / 150.0 | 36.2 / 50.0 | 1.6 / 16.8 |
| A best chaser, pot part (total; gain over flat) | 1.000 (98.02; +0.13) | n/a | 1.667 (98.69; +0.67) | **26.2 in R1 / 11.2 in R2 (123.2 / 108.2; +25.2 / +10.2), ceiling 41.67 (138.7)** |
| **B5000** `min(bal, 5000c)`: flat total / pot part | 97.98 / 0.957 | 98.00 / 0.980 | 98.02 / 0.995 | 98.02 / 1.000 |
| B5000 cents left | 856,439 | 786,555 | 911,217 | 983,050 |
| B5000 prize avg / largest, in bets | 353.7 / 500.0 | 179.0 / 250.0 | 36.2 / 50.0 | 1.4 / 2.0 |
| B5000 best chaser, pot part (total; gain over flat) | **1.667 (98.69; +0.71)** | n/a | **1.667 (98.69; +0.67)** | **1.667 (98.69; +0.67)** |
| B3000 `min(bal, 3000c)`: flat total / pot part | 97.89 / 0.869 | 97.92 / 0.905 | 97.98 / 0.957 | 98.01 / 0.991 |
| B3000 cents left | 2,617,384 | 3,782,721 | 8,560,916 | 43,853,925 |
| B3000 prize avg / largest, in bets | 281.8 / 300.0 | 143.0 / 150.0 | 29.4 / 30.0 | 1.2 / 1.2 |
| B3000 best chaser, pot part (total; gain over flat) | 1.000 (98.02; +0.13) | n/a | 1.000 (98.02; +0.04) | 1.000 (98.02; +0.01) |
| current best chaser | 0.167 (97.19; +0.00) | n/a | 1.667 (98.69; +0.67) | **41.67 (138.69; +40.67)** |

Runs: `POT_<rule>_flat<bet>` (flat, full sim), `POT_room_<rule>_flat<bet>` (the same pot in the pot-only sim; the prize rows), `POT_chaser_scan.json` (threshold scan, seed 121), `POT_chaser_conf.json|txt` (best threshold re-measured, seed 777; chaser rows; R1 shown for A, the R2 value is the second number). Chaser columns: 10c, $1 and $25 only ("n/a" = not run, the 20c chaser sits between 10c and $1). Chaser total = 97.02 + the chaser's pot part (the game part does not depend on when he plays; a chaser who also lets leads go cold would lose some). Cents left = what the pot still holds at the end of each 1M-spin batch, summed: about 4% of a batch's feed at 10c on B5000 is the pot refilling after the last hit, not a leak (a pot that starts empty and ends a batch holding about one pot).

**Pass bar (flat in band, chaser at most 98.7, conservation to the cent):**
- **A: FAIL.** Flats pass (97.89, 97.92, 98.02, 98.02). The chaser fails at every bet from about $1 up: the floor only touches bets under 60c, so a $25 chaser still takes `min(pot, $1,250)`: 123.2 in a 10c / 20c room, and the ceiling is 138.7. (A also moves the 10c chaser from 0.17 to 1.0 pot points.)
- **B5000: PASS.** Flats 97.98, 98.00, 98.02, 98.02 (all inside 97.7 to 98.3 within their intervals). Chaser 98.69 at every bet (10c, $1, $25; analytic ceiling 97.02 + 5000/100/3000 = 98.687, expected prize at T >= $50 is exactly 1.667 in every room, rolled values agree). Conservation: `fed + seeded = paid + left` to the cent in every run. **The margin under 98.7 is 0.013 at the ceiling**: if the ex-pot ever measures 0.02 higher, a chaser crosses the bar; the sim's ex-pot interval is +- 0.22 and the 500M strat estimate is 96.96, so say it plainly.
- **B3000: PASS** too (flats 97.89, 97.92, 97.98, 98.01; chaser 98.02 at every bet, a margin of 0.68) and not chosen: 5000 does not leave a chaser above the bar, so 3000 was not needed, and 3000 leaves the pot unpaid at big bets (at flat $25 the pot averages $1,429 at a hit, $2,193 stays in it per 1M spins, while a hit pays $30: the pot display would show a number no one can win). Not "a third rule".

**Rule chosen: B, `capCents` 5000** (`prize = min(bal, capCents)`, one cap for every bet; `CFG.pull.pot.capCents`, new `Eng.potPrize(pullCfg, bal)` used by both the server and the sim; `maxPayX` removed). It pays every bet what it is fed (0.957 / 0.980 / 0.995 / 1.000, the 10c and 20c gaps are the batch edge), keeps the pot near $45 (average balance $45 in R1 and R2), and bounds a chaser at 1.67 points at every bet. Costs: a $25 bettor's hit now pays at most $50 (2 bets, not up to 50 bets; his hits are 25 times as frequent, the pot part is unchanged at 1.00), and a 10c bettor's hit can pay $50 = 500 bets. The info screen must change (see PULL-STATE FIX POT-CAP). A `capCents` under 3000 would leave part of the feed unpaid (B3000 is already at the limit).

## 8.12 Small bets: 1c / 2c / 5c (DENOMS)

Measured 2026-10-06 on shaman (24 threads, scratch `E:\bricklord-test\coldcall-denoms`, nothing on C:), engine `games/coldcall-engine.js` sha256 6664a356a0dc8620... and sim `games/coldcall-sim.js` 272f7338d39b441f... (both from the DENOMS commit; the engine has the whole-cent rounding, buy pricing and the 1c Callback step, no pay knob moved). Same setup as 8.10 / 8.11: `--pull 100000 2000 121 --pickpolicy best --nowarmdiff --bet B` (200M paid spins, seed 121, best picks, Callback floor + carry, pot rule B5000). Raw files `levers-runs/DEN_*` (`.json` + `.txt`, 216 KB), one batch script on shaman. Design: `PULL-ENGINE.md` section 7.

**Check that nothing moved at 10c and up: PASS, bit for bit.** `DEN_flat10` = `POT_B5000_flat10` and `DEN_flat100` = `POT_B5000_flat100` to the last printed digit (97.9793646 +- 0.2194 and 98.0159901 +- 0.2190, every part identical); the engine's 5,760-round `playRound` transcript digest (written on the old engine) and the legacy digest match in the test suites.

### Flat bets (best picks), per paid spin, money in real cents

| Bet | Total as the sim prints | Ex-pot | Base (cluster + phone) | Natural bonus | Callback part | Pot part (1M-spin batch) | Pot part, long horizon (pot-only room) | Total, steady pot | Callback bet |
|---|---|---|---|---|---|---|---|---|---|
| 1c | **97.682 +- 0.222** | 97.022 | 48.95 (29.45 + 19.50) | 25.74 +- 0.17 | 22.34 +- 0.11 | 0.660 +- 0.038 | 0.996 +- 0.002 | 98.018 | 1.00c |
| 2c | **97.821 +- 0.222** | 97.022 | 48.95 | 25.74 | 22.34 | 0.799 +- 0.024 | 0.998 +- 0.001 | 98.020 | 2.00c |
| 5c | **97.929 +- 0.221** | 97.022 | 48.95 | 25.74 | 22.34 | 0.906 +- 0.013 | 0.999 +- 0.000 | 98.021 | 5.00c |
| 10c (check) | **97.979 +- 0.219** | 97.022 | 48.95 | 25.74 | 22.34 | 0.957 +- 0.006 | 0.995 +- 0.002 (10M-tick rooms) | 98.017 | 10.00c |
| $1 (check) | **98.016 +- 0.219** | 97.021 | 48.95 | 25.74 | 22.34 | 0.995 +- 0.001 | 1.000 | 98.021 | 99.99c |

Runs: `DEN_flat1|2|5|10|100`; long-horizon pot parts `DEN_potroomLong1|2|5` (100M ticks x 20 rooms, one feeder, `--pot-room`) and `DEN_potroom1|2|5|10|100` (10M ticks). Ex-pot is identical at every bet (the same seed plays the same rounds; only the rounding of the wallet differs), and so is the wallet: "paid cents" (what the wallet gets, ex pot, rounding included) is 97.021 / 97.023 / 97.022 / 97.022 / 97.021 against the exact 97.022 / 97.022 / 97.022 / 97.022 / 97.021, drift -0.0011 +- 0.0020, +0.0009 +- 0.0010, +0.0002 +- 0.0004, 0, 0 points: the rounding is unbiased.

**Pass bar, flat totals inside 98.0 +- 0.3 (97.7 to 98.3) within the interval: PASS, with one marginal reading.** 2c, 5c, 10c, $1 are inside as printed. 1c prints 97.682 +- 0.222 (interval 97.46 to 97.90): the point estimate is 0.018 under 97.70 and the interval overlaps the band, so it passes by the "within its interval" rule used in 8.10 / 8.11, not by the point estimate. The whole gap to 98.0 is the pot part and it is a measurement edge, not a leak: the sim's pot is one bettor per 1M-spin batch, a 1c bettor feeds only $100 per batch (2.3 hits), so the pot is still holding its last $34 when the batch ends (6,809 cents left across 20 batches, `fed = paid + left` to the cent). With the horizon removed (`--pot-room`, 100M ticks per room, 20 rooms, 5,420 / 10,859 / 27,380 hits) the pot pays 0.996 / 0.998 / 0.999 of what it is fed at 1c / 2c / 5c (the rest is the pot's last balance, 84k of 20M cents at 1c), so the steady total is 98.02 at every bet. In the real shared pot nothing is truncated. Item 6: the pot part is about 1.0 at 1c, 2c and 5c too; `potSlice` carries the remainders (tested over 100,000 spins at each bet: `fed x 10000 + rem = cost x bps`) and `fed + seeded = paid + left` held to the cent in every one of the 8 pot-room runs and the 5 flat runs.

### Buys at 1c / 2c / 5c against $1 (30M rounds per buy per bet, seed 121, best picks, gamble banked, PICK + ONE MORE CALL through `playRound`; `DEN_buys1|2|5|100`)

Payback = cents paid / cents of price. Price is the exact price rounded to the nearest cent (min 1c), the round is played at the fair stake (price / cost multiple). The same seed gives the same rounds at every bet, so the exact payback is the same to the last digit and the paid column differs only by rounding.

| Buy | $1: price, payback | 1c: price (exact), payback, paid - exact | 2c: price (exact), payback, paid - exact | 5c: price (exact), payback, paid - exact |
|---|---|---|---|---|
| call | 270c, 98.041 +- 0.216 | 3c (2.7), 98.030 +- 0.212, -0.0107 +- 0.0097 | 5c (5.4), 98.041 +- 0.216, -0.0003 +- 0.0013 | 14c (13.5), 98.037 +- 0.215, -0.0042 +- 0.0034 |
| bonus1 | 9640c, 97.814 +- 0.063 | 96c (96.4), 97.814 +- 0.063, 0.0000 +- 0.0002 | 193c (192.8), 97.813 +- 0.063, -0.0007 +- 0.0001 | 482c (481.8), 97.814 +- 0.063, 0.0000 |
| bonus2 | 29100c, 98.008 +- 0.040 | 291c, 98.008 +- 0.040, 0.0000 | 582c, 98.008 +- 0.040, 0.0000 | 1455c, 98.008 +- 0.040, 0.0000 |
| hunt | 200c, 98.124 +- 0.439 | 2c, 98.124 +- 0.440, +0.0006 +- 0.0026 | 4c, 98.124 +- 0.439, +0.0001 +- 0.0010 | 10c, 98.124 +- 0.439, -0.0001 +- 0.0005 |

**Pass bar, every buy within its interval of the $1 figure: PASS** (largest gap 0.011 points, call at 1c, 1 sigma of its paired interval). No buy is locked below 10c. Two honest footnotes, both from pricing at a fair stake: (a) the call at 1c is played at 1.111c per x, so its 10,000x cap (11,111c) is clamped to $100.00, which costs exactly the -0.0107 above (9 cap hits in 30M x 1,111c / 90M cents of price); (b) the bonus1 buy at 1c plays at 0.996c per x, so its top win is 100,000 tenths x 0.996c = $99.58, not $100.00. Neither can exceed 10,000 x the bet.

### Decision policy at 1c (item 3; `DEN_policy1_*`, 200M paid spins each, 867,161 ONE MORE CALL offers each, the shown bank amount rounded UP on 44.6% of them)

The sim's decision ledger = for every offer, (expected value of the option the policy took, computed from the SHOWN whole cents) minus (the exact value of banking), in cents. A design that cannot be gamed by reading the shown amount gives 0.

| Policy at 1c | Ledger, cents per offer | Paid cents, % of stake (ex pot) | Total with the sim's pot |
|---|---|---|---|
| bank always (the exact-value policy: the live `more.rtp` is 1.0, bank and take are equal) | -0.00003 +- 0.00089 | 97.021 +- 0.219 | 97.682 +- 0.222 |
| take always | -0.00024 +- 0.00084 | 97.053 +- 0.302 | 97.713 +- 0.302 |
| bank when rounded UP, gamble when rounded down (the trap policy) | -0.00012 +- 0.00087 | 97.110 +- 0.251 | 97.767 +- 0.248 |
| gamble when rounded up, bank when rounded down | -0.00052 +- 0.00083 | 97.150 +- 0.244 | 97.810 +- 0.248 |

**Pass bar: PASS.** No policy beats the exact-value policy beyond the interval: every ledger entry is zero within +- 0.0009 cents per offer (a leaky design pays about 0.15 cents per offer on a 12.3c bonus: engine test "the leak trap" computes the naive `floor(exact + u)` design at +0.15 and this one at 0.000), and the paid-cents totals differ by at most 0.13 points with intervals of +- 0.22 to +- 0.30 (the policies play different main-stream draws after the first gamble, so the totals are not paired; the ledger is the sharp test).

### Mixers (`--bet-mix lo,hi,T`: bet hi while the lead-weighted average is under T, else lo; the N1 attacker generalised) and `--bet-switch`

| Mixer | Total | Ex-pot | Flat at its larger bet (same run family) | Average stake / average Callback bet | Run |
|---|---|---|---|---|---|
| 1c / 2c, T 1.5 | 94.908 +- 0.251 | 94.174 | 2c: 97.821 +- 0.222 | 1.50c / 1.50c | DEN_mix1_2 |
| 1c / 10c, T 5.5 | 95.035 +- 0.277 | 94.122 | 10c: 97.979 +- 0.219 | 5.50c / 5.50c | DEN_mix1_10 |
| 5c / 10c, T 7.5 | 95.018 +- 0.227 | 94.079 | 10c: 97.979 +- 0.219 | 7.50c / 7.50c | DEN_mix5_10 |
| 2c / $1, T 55.5 | 95.497 +- 0.278 | 94.505 | $1: 98.016 +- 0.219 | 55.50c / 55.47c | DEN_mix2_100 |
| 5c / 20c, T 10.5 (the average sits at the 10c line, extra) | 94.653 +- 0.257 | 93.694 | 20c: 98.00 (8.11, not re-run) | 10.50c / 10.50c | DEN_mix5_20x |
| `--bet-switch` (10c, then $25 after >= 3 warm squares) | 96.239 +- 0.649 | 95.241 | $25: 98.02 (8.10 / 8.11) | 10c / $25 (switching), Callback bet 220.7c on average | DEN_betswitch |

**Pass bar, no mixer above flat play at its larger bet: PASS** (every mixer is 1.8 to 3.4 points BELOW flat; the mix drops warm squares at every bet change: base phone 15.97 to 17.53 against 19.50). The Callback part of every mixer is 22.45 to 22.67 against 22.34 flat (+0.1 to +0.3, about 1 to 2 sigma of its +- 0.11 to +- 0.14, the same size as in 8.10), and the average Callback bet is 99.9% to 100.1% of the average stake per paid spin (the proven invariant is in lead-weighted stake, sum of Callback bets <= sum of list averages; the 0.1% is the lead weighting): the carry across the 10c line (the 5c / 20c run arms at average 10.5c, step 10, and the 5c / 10c run at 7.5c, step 1) does not create stake. The fuzz proof (`DENOMS Callback invariant`) covers pure `cbArm` and real flows with random bets from the whole list.

### Open / decisions
No decision of Frank's was changed and no pay knob moved. Implementation choices that are mine and are documented in `PULL-ENGINE.md` section 7: (1) the Callback step follows the average of the list being armed (below 10c: 1 cent, from 10c: the old rule, bit for bit); (2) a round pays its base spin and its bonus rounded apart (paid within 2c of exact, mean exact), so ONE MORE CALL can show whole-cent bank / win / base amounts rounded once; (3) buys are played at the fair stake with the price rounded to the nearest cent, and the 10,000x cap is `min(cap at the fair stake, 10,000 x bet)` in cents. The sim's pot part is truncated at a batch edge for the smallest bets; use `--pot-room` for the steady figure.

Commands (shaman, scratch on E:, 24 threads; the engine and sim copied to `E:\bricklord-test\coldcall-denoms\games`):
```
node games\coldcall-sim.js --pull 100000 2000 121 --pickpolicy best --nowarmdiff --bet B --threads 24 --out DEN_flatB.json           # B = 1 2 5 10 100
node games\coldcall-sim.js --pot-room 10000000 121 --feeders B:1 --batches 20 --threads 24 --out DEN_potroomB.json                  # B = 1 2 5 10 100 (long: 100000000 ticks, B = 1 2 5, 4 threads)
node games\coldcall-sim.js --pull 100000 2000 121 --pickpolicy best --nowarmdiff --bet 1 --more P --threads 24 --out DEN_policy1_P.json   # P = bank take bankup takeup
node games\coldcall-sim.js --pull 100000 2000 121 --pickpolicy best --nowarmdiff --bet-mix 1,2,1.5 | 1,10,5.5 | 5,10,7.5 | 2,100 | 5,20,10.5 | --bet-switch
node games\coldcall-sim.js --buys-pull 30000000 121 --bet B --pickpolicy best --more bank --threads 24 --out DEN_buysB.json          # B = 1 2 5 100
```


## 8.13 RTP presets: 98 / 96 / 94 (PRESETS)

Measured 2026-10-06 on shaman (24 threads, scratch `E:\bricklord-test\coldcall-presets`, nothing on C:), engine and sim as in 8.12, no engine change. A preset is a file in `cold-call/presets/` with the POST body of `/api/admin/coldcall-config` (`{ overrides, rtpLabel, note }`); the sim reads it with `--preset file.json` (same deep merge and validation as the server, through `games/coldcall-livecfg.js merge()`). `tests/coldcall-presets.js` checks that every file is accepted by the validator and the smoke test, swaps in and out through `setLiveConfig`, and moves no knob in `weights, extra, pay, reveal, bubbles, upsell, adjacency`.

**Method.** The Callback is the only part of the RTP that scales with one knob and touches nothing the player sees in the base game: its part is 22.34 x (450 / `pull.list`). Shipped 22.34 at list 450; list 495 gives 20.3, list 550 gives 18.3. Hit rate (21.67% paid base, same to the digit), cluster, base phone and natural bonus parts do not move (29.4 / 19.5 / 25.8, noise only: the Callback consumes draws from the same random stream, so a different list size re-rolls the same distribution; natural bonus 1 in 420 / 420 / 421 spins). The buys are re-priced so they pay back about what the game does: price (tenths of a bet) = shipped price x shipped payback / target, whole tenths only. The hunt buy's payback is also tuned with `hunt.bellMult` (it is the only knob that moves it without touching the base game). Same setup as 8.10 to 8.12: `--pull 100000 2000 121 --pickpolicy best --nowarmdiff --bet B --preset ...` (200M paid spins, seed 121, best picks, Callback floor + carry, pot rule B5000), buys `--buys-pull 30000000 121 --bet 100` (hunt 200M).

| Preset | Knobs (everything else shipped) | Flat $1 total | Flat 10c | Flat 1c (pot cut at the batch edge, see 8.12; steady = flat $1) | Ex-pot | Callback part | Chaser total |
|---|---|---|---|---|---|---|---|
| rtp98 (shipped) | none | **98.016 +- 0.219** | 97.979 | 97.682 | 97.022 | 22.34 | 98.69 |
| rtp96 | `pull.list` 495; `buyCost` call 28, bonus1 982, bonus2 2971; `hunt.bellMult` 1.828 | **96.143 +- 0.199** (target 96.0, +0.14) | 96.107 | 95.809 | 95.147 | 20.37 | 96.81 |
| rtp94 | `pull.list` 550; `buyCost` call 28, bonus1 1003, bonus2 3034, hunt 21; `hunt.bellMult` 1.85 | **94.045 +- 0.222** (target 94.0, +0.05) | 94.009 | 93.711 | 93.050 | 18.32 | 94.72 |

All three are inside target +- 0.3. Chaser total = ex-pot + `capCents` 5000 / 100 / `oneInPerDollar` 3000 = ex-pot + 1.667 (the pot-chaser bar of 98.7 from 8.11): 98.69 shipped (0.013 under the bar), 96.81 and 94.72 for the lower presets, i.e. 1.9 and 4.0 points under it. A lower preset can only help on that bar. Pot part is unchanged (0.995 at $1).

Buys at $1 (paid payback, +- 95%; call, bonus1, bonus2 30M rounds, hunt 200M):

| Preset | call | bonus1 | bonus2 | hunt |
|---|---|---|---|---|
| rtp98 | 98.04 +- 0.22 | 97.81 +- 0.06 | 98.01 +- 0.04 | 98.12 +- 0.44 (8.12; 98.58 +- 0.36 at 60M) |
| rtp96 | 94.54 +- 0.21 | 96.02 +- 0.06 | 96.00 +- 0.04 | 96.27 +- 0.20 |
| rtp94 | 94.54 +- 0.21 | 94.01 +- 0.06 | 94.00 +- 0.04 | 94.21 +- 0.20 |

Honest caveat on the call buy: its price is a whole number of tenths and 27 pays back 98.04, 28 pays back 94.54, so 96 is not reachable. rtp96 uses 28 (1.5 under its target; 27 would be 2.0 over), and rtp94 uses 28 (0.5 over target). Pass 1 of rtp94 used 29 (91.28, 2.7 under) and hunt 21 at bellMult 1.845 (93.62); pass 2 changed those two knobs only (the flat figures do not depend on them). rtp96 needed one pass. Two passes of three used. The bellMult scan by the first builder (60M hunt rounds at price 20: 1.60 72.5, 1.66 78.4, 1.72 84.5, 1.76 88.8, 1.80 93.3, 1.845 98.6) fixes the slope: about 1.2 points of payback per 0.01 of bellMult.

Labels shown in the lobby (`rtpLabel`, 160 characters at most, what was measured and nothing more): rtp98 "98.0% (long-run, 200M-spin sim, +-0.22, includes the Callback and the office pot)" (= `RTP_LABEL` in `games/coldcall.js`; 98.016 +- 0.219 from 8.12; the old 97.93 line was the 5c flat figure without the steady pot); rtp96 "96.1% ... +-0.20 ..."; rtp94 "94.0% ... +-0.22 ...". Totals are for flat play at $1 or any bet from 10c up within 0.04; at 1c the label would read 0.3 lower in the sim, which is the batch edge of the pot (8.12), not the game.

Not done: no preset was measured with mixed bets (8.10 / 8.12 mixers sit 1.8 to 3.4 below flat at the shipped math, so they sit below at the presets too) and the bonus buy 100x-cap tails were not re-measured (cap hits 2,071 / 4,538 per 30M at rtp96, unchanged knobs in the pay table).

Raw files `levers-runs/PRE_p1_flat100|flat10|flat1_rtp96|rtp94.json|txt`, `PRE_p1_buys_rtp96|rtp94` (call, bonus1, bonus2), `PRE_p1_hunt_rtp96|rtp94` (200M), `PRE_p2_callbuy_rtp94`, `PRE_p2_hunt_rtp94` (pass 2). The rtp94 pass-1 call and hunt lines in `PRE_p1_buys_rtp94` / `PRE_p1_hunt_rtp94` are superseded by pass 2.

Commands (shaman, `CC_MAX_THREADS=24`, files copied to `E:\bricklord-test\coldcall-presets`):
```
node games\coldcall-sim.js --pull 100000 2000 121 --pickpolicy best --nowarmdiff --bet B --threads 24 --preset presets\rtpNN.json --out out\PRE_p1_flatB_rtpNN.json   # B = 100 10 1
node games\coldcall-sim.js --buys-pull 30000000 121 --bet 100 --pickpolicy best --more bank --only call,bonus1,bonus2 --threads 24 --preset presets\rtpNN.json
node games\coldcall-sim.js --buys-pull 200000000 121 --bet 100 --pickpolicy best --more bank --only hunt --threads 24 --preset presets\rtpNN.json
```
