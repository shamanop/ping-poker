# COLD CALL pull lead: brief (read fully before acting)

You lead the build of THE PULL: six mechanics specified in `cold-call/PULL.md`. Read that, then
`cold-call/ENGINE-V2.md`, `games/coldcall-engine.js`, `games/coldcall.js`, `cold-call/RETUNE.md`, `PROGRESS-CC.md` (top).

## Who else is working (do not collide)
- `projects/ping-coldcall` (branch `coldcall`): another Frank session runs money QA there and owns the final merge. NEVER touch it.
- `projects/ping-coldcall-skin3` (branch `coldcall-skin3`): the new skin is being built there. NEVER touch it. UI for THE PULL
  waits until Frank tells you the skin has landed; then you merge that branch into yours and build the UI in its language.
- The levers agent (`cold-call/LEVERS-BRIEF.md`) works in THIS worktree and owns the VALUES of the `CFG` knobs and
  `cold-call/LEVERS.md`. You own mechanisms. Give every mechanic named knobs in `CFG` with provisional values and tell the
  levers agent (sessions_send, key in `PULL-STATE.md`) the moment a mechanism is in and tested.
- You: worktree `/home/frank/.openclaw/workspace/projects/ping-coldcall-pull`, branch `coldcall-pull`, dev server port **4640**
  only (4610 and 4630 belong to others), data under `_scratch/srv-pull`.

## Wave 1 (now): engine + server, no UI
1. Player state: per player, per currency, on the server, persisted like the wallet. The round becomes a pure function of
   (rng, buy, state) -> (win, script, new state). Keep the engine pure, deterministic, replayable, and byte-identical
   between `games/coldcall-engine.js` and `public/games/coldcall/engine.js` (there is a byte-sync test: keep it green).
2. Lead list + THE CALLBACK + cold leak + daily free leads. 3. Warm leads. 4. "Would have closed" data in the script,
   taken from the round's own draw. 5. PICK YOUR LEAD and ONE MORE CALL as server-resolved decisions with safe defaults
   on timeout / disconnect / autoplay; a round with an open decision must never strand money or a stuck round.
6. THE OFFICE POT (per currency; in = out to the cent) and feed events (socket broadcast; lobby, both slots, poker table
   can subscribe later). 7. Sim support for all of it in `games/coldcall-sim.js` so the levers agent can measure.
Tests for each: unit tests in `tests/coldcall.js`, a settlement test for Play $ AND Chips that includes the pot and the
gamble, state persistence across a server restart, decision timeout, two players racing for the pot.

## Later waves (do not start until wave 1 is reported)
Wave 2: UI on the new skin. Wave 3: watch-a-friend's-bonus. Wave 4: full QA at 540x960, 1440x900, 360 wide, both currencies.

## Rules
- Children only through OpenClaw `sessions_spawn` (never the built-in Agent tool). Builders: no model override (Sonnet).
  One critic per wave reading the diff for money bugs: `model: "anthropic/claude-opus-5-5"`. At most 2 live children at
  once (the box has 12 GB RAM and other projects running). Never cancel a running child to take it over: steer with
  `sessions_send`. If a builder fails the same critic list two rounds running, tell Frank instead of looping.
- Search for and try free premade pieces before building anything (repo first: Bender, poker tables, wallet, social.js).
- Stay under about 150K tokens of context. At the end of each wave write the hand-off into `cold-call/PULL-STATE.md`
  (what is committed, what is open, the next wave, gotchas), send your report, and STOP. The next wave starts in a
  fresh lead session from that file.
- Commits: `git -c user.name=Frank -c user.email=frank@localhost commit`, staged by named path only (never `-a`, never
  `add -A`; children share this tree). No push, no merge into other branches, nothing to master, no deploy.
- Tests: `SIO_CLIENT=$PWD/_scratch/sio/node_modules/socket.io-client node tests/coldcall.js`, `node tests/bender.js`. Tests
  drop `accounts.json`, `*.bak-*` and rewrite tracked `tests/*.json`: restore those by path, never commit them.
- Report failures accurately: what failed, what you stopped, what is untested.

## Report (final message of the wave, plain words)
What is built and tested, what is not, test counts, commit hashes, open questions for Frank, and the knob names handed to
the levers agent.
