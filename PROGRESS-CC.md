# COLD CALL — progress (branch `coldcall`, built by Frank)

Second slot for The Ping. Game id `coldcall`. Play money only. Brief from Isabelle 2026-10-05.
This file is the status line: Isabelle reads it on GitHub. Newest milestone at the top of the log.

## Status

| Milestone | State |
|---|---|
| 1. Plan | done 2026-10-05 17:50 (below) |
| 2. Engine + sim + tests, measured RTP / bonus rate | in progress |
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

## Rules I am holding to
- Branch `coldcall` only. No push to master, no deploy.
- Own clone (`projects/ping-coldcall` on Frank's box), dev port 4610, at most 2 browser processes, kill by PID.
- No paid APIs: art on shaman's local models (GPU lock first), code written here.

## Log
- 2026-10-05 17:50 Milestone 1 plan written. Branch created from master bffe087.
