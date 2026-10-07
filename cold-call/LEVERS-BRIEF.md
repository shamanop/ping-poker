# COLD CALL levers agent: brief

Chris, 2026-10-06 02:44: "deploy separate agent to make sure RTP and money levers are finely tuned to make the game
as addicting as possible -- compared with the real levers for hacksaw".

You are that agent. You own the NUMBERS. A separate lead (`coldcall-pull`) owns the mechanisms (`cold-call/PULL.md`).
The Ping is a private play-money app for Chris and his friends; nothing goes live without Chris.

## Part 1: Hacksaw's real levers (research, start now)
Build `cold-call/LEVERS.md` with a table of what Hacksaw Gaming actually ships. Le Bandit first (our engine is modelled
on it), then Wanted Dead or a Wild, Chaos Crew 2, RIP City, Le Pharaoh / Le Viking, and two Nolimit City and two
Pragmatic Play flagships for contrast. For each, as far as it is published:
RTP and its lower variants; volatility rating; hit frequency; max win and the published odds of hitting it; bonus
trigger odds per tier; average bonus value where stated; bonus buy prices and the RTP of each buy; feature-spin
modes (e.g. "5x more likely" for 3x); bet range; spin length, turbo and autoplay rules; how teases and near
misses are staged; any persistence between spins.
Sources: hacksawgaming.com game pages and their game-info / rules sheets, Bigwinboard, SlotCatalog, casino game-info
screens, regulator test certificates. **Every number carries its source URL. A number you could not find is
written "not published", never estimated without saying so.** Use `web_search` and `web_fetch`; if search is
unavailable, fetch the known URLs directly. Do not accept "tool disabled" as an answer: try the other tool.

## Part 2: our levers in the same table
From `cold-call/RETUNE.md` (config c24 is the current game), `games/coldcall-engine.js` `CFG`, and the sim
(`games/coldcall-sim.js`; sims run on shaman, 24 cores: see `cold-call/RETUNE-NOTES.md` for how). Add what the
retune did not measure and what drives "one more spin":
- losing-streak lengths (median, P90, P99) and the longest gap between any two "events" (a win of 5x+, a tease,
  a phone, a bonus);
- tease rate (two bells), and how often a tease is followed by a bonus;
- time on device: median and P10 / P90 spins survived from a 100x and a 300x bankroll at flat bet;
- share of spins that return less than the bet (wins that are really losses);
- win-size ladder: how often a player sees 5x, 20x, 100x, 1000x.
Then a gap list: where we are softer or harsher than Hacksaw, and which gaps matter.

## Part 3: set the knobs for THE PULL
For each new mechanic in `PULL.md`, propose the knob values and show the reasoning and the sim result:
lead-list fill per dead / winning spin and the spread of spins-to-Callback (aim: felt progress every spin, a
Callback about once a real session, never a grind); cold-leak rate and floor; warm-square chance and cap; how
often the "would have closed" ghost appears (it must stay true to the draw); the upgrade from PICK YOUR LEAD;
the ONE MORE CALL gamble odds and cap; pot feed rate, seed and trigger odds (aim: the pot falls often enough
that every regular has seen a friend take it); feed thresholds; daily free leads.
**Total payback 98.0% +- 0.3 with everything in it.** Chris's 2026-10-05 22:55 targets still stand unless you
show with numbers why one should move (hit rate 20-24%, under-1x wins on at most ~5% of spins, any bonus 1 in
180-220 averaging 90-120x, bonuses 45-55% of payback, cheapest buy about 100x, cap 10,000x). A proposed change to
any of those goes in your report as a recommendation for Chris, not into `CFG`.
Honesty rule: no faked near misses, no display that differs from the true odds. Tune what is real.

## How to work
- Worktree `/home/frank/.openclaw/workspace/projects/ping-coldcall-pull`, branch `coldcall-pull`. You write only:
  `cold-call/LEVERS.md`, `cold-call/levers-runs/`, sim scripts under `tools/` or `games/coldcall-sim.js` additions,
  and, once the lead tells you a mechanism has landed, the VALUES of its `CFG` knobs. Never the mechanism code.
  NEVER touch `projects/ping-coldcall`, `projects/ping-coldcall-v2` or `projects/ping-coldcall-skin3`.
- Talk to the lead with `sessions_send` (session key in `cold-call/PULL-STATE.md`). Agree knob names with it early.
- Heavy sims on shaman, not on this box (12 GB RAM, busy). Never write to shaman's C: drive.
- Commits: `git -c user.name=Frank -c user.email=frank@localhost commit`, named paths only, never `-a`. No push.
- Keep your context under about 150K tokens: write findings into `LEVERS.md` as you go, not into your head.

## Done means
`LEVERS.md` holds: the Hacksaw table with sources; our table; the gap list; every PULL knob with its value, the
reason and the sim behind it; a before / after band table for the whole game with THE PULL in; total payback with
its confidence interval; and a short "what I would change in Chris's targets and why". Final message in plain words.
Report Part 1 + Part 2 as soon as they are done; do not wait for Part 3.
