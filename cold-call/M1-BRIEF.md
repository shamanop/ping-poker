# COLD CALL fix round M1 (money critic 2, 2026-10-06 17:33)

You are a builder on COLD CALL, the play-money slot of THE PING (Play $ and Chips, no real money). Frank (the main session) wrote this brief and will check your work himself, then hand it to an Opus critic.

## Where you work
- Worktree: `/home/frank/.openclaw/workspace/projects/ping-coldcall-m1`, branch `coldcall-m1`, cut from `coldcall-pull` at `b596408`. `node_modules` is a symlink, leave it.
- NEVER touch `projects/ping-coldcall-pull` (another builder has uncommitted client work there), `ping-coldcall-w3`, `ping-coldcall-fb1`, or any other clone.
- Do NOT edit any file under `public/` in this round, with one exception: if you change `games/coldcall-engine.js`, copy it to `public/games/coldcall/engine.js` so `cmp` stays identical. Prefer a fix that does not touch the engine.
- Ports 4660 to 4664 only, own data dir under `_scratch/`. Kill only processes you started, by pid, never by pattern.
- Tests run under the shared lock: `flock /tmp/pull-tests.lock nice -n 10 node tests/<file>`. Run them from a slim export (`git archive HEAD` into a temp dir, `node_modules` symlinked), the way `cold-call/PULL-STATE.md` describes, so they see only committed code.
- This box: smoke sims only (2M spins or fewer, `nice -n 10`, `CC_MAX_THREADS=2`). Long sims go to shaman, see `cold-call/PULL-SIM-NOTES.md` and `cold-call/RETUNE-NOTES.md` (helper `~/cc-tools/shrun.sh`, scratch on `E:`, never `C:`; use your own directory, for example `E:\bricklord-test\coldcall-sim-m1`, and check that no other sim is hogging the 24 threads first).
- Commit named paths only (`git add <path>`, never `-A` or `commit -a`), check `git show --stat` after each commit. Do not push. No master, no PR.

## Read first
1. `cold-call/PULL-CRITIC-MONEY2-OPUS.md` (the whole file; findings M1, D1 to D6). Its repro scripts are in `_scratch/critic-money2/` and run from the root of a slim export.
2. `cold-call/LEVERS.md` sections 8.11 to 8.13, `cold-call/PULL-ENGINE.md` sections 7 and 8.
3. `games/coldcall.js` `settle()` (pot block near line 212), `games/coldcall-livecfg.js`, `server.js` lines 265 to 315.

## The decision (Frank's, do not re-open it)
**M1: buys do not touch the office pot.** A paid round with `rec.buy` set (call, bonus1, bonus2, hunt, any future buy) feeds no slice, moves no `pot.rem`, makes no pot roll and can win no pot. Only a plain paid spin (`cost > 0` and no buy) feeds and rolls, exactly as today. A Callback stays as it is (never). Why this option: buys were priced at 98.0 with no pot, so this makes the shipped prices and the "98.0%" label true again with no knob change and no re-pricing, and the measured chaser ceiling of 98.687 on paid spins stays the only pot ceiling.

## Jobs, in this order
**A. Measure first (start it before you write code, it runs while you work).** The shipped hunt buy, pot excluded, at 200M paid rounds at a $1 bet on shaman (`--buys-pull`, the same policy flags LEVERS 8.12 used, a seed not used before). Report payback with its interval, and say plainly whether it is above or below 98.33. The two older runs disagree (98.12 +- 0.44 and 98.58 +- 0.36). Save the raw output under `cold-call/levers-runs/M1_*`. Do not change any knob because of the result; if the hunt buy sits clearly above 98.3, say so in the hand-off and Frank decides.

**B. M1 in the server.** Tests first, in `tests/coldcall-pull-server.js`, and show that each new test fails on the unchanged code:
- each of the four buys at 1c, $1 and $25, both currencies, with the pot at $50 or more and `potRng` returning 0: no prize, `pot.bal`, `pot.fed`, `pot.paid` and `pot.rem` unchanged, the wallet moves by `win - cost` only, the result payload carries no pot win;
- a plain paid spin in the same state still feeds and still wins the pot (guard against over-fixing);
- the conservation property the file already checks still holds with buys mixed in.
Then make the change. Check every other place that assumes a buy feeds the pot: the feed/ribbon events a settle sends (`floor:pot`), the history row (`pot:` field), the `state` payload, `games/coldcall-sim.js` (`--pull` with buys mixed in, `--pot-room`), and the smoke test inside `coldcall-livecfg.js`. `m1-buy-pot-chaser.js` and `m1b-buy-only-pot-part.js` from the critic must now show no pot part on a buy; adapt them into a kept repro or a test.

**C. D1.** Validator: `pull.more.rtp` must be at most 1 (and still at most `mult`). Test: `{rtp: 1.5}` and `{rtp: 2, mult: 2}` are refused, the shipped value and all three preset files still pass.

**D. D2.** Validator relation for the chaser bar: `capCents / 100 / oneInPerDollar` may not exceed the shipped 1.667 points (write it in whole numbers, `capCents * 3 <= oneInPerDollar * 5`, so the shipped 5000 / 3000 passes exactly). Refuse with a message that names the bar. Test: `oneInPerDollar: 1000` refused, `{oneInPerDollar: 100, capCents: 1e9}` refused, shipped and presets pass.

**E. D3.** The RTP label must be tied to the numbers it was measured on:
- each preset file in `cold-call/presets/` gains a `measuredHash`: a stable hash (sorted keys, sha256) of the full merged config (shipped defaults + that file's overrides) it was measured on;
- a test recomputes each hash from the current shipped defaults and fails if one no longer matches (so a deploy that moves a shipped default under a preset is caught until it is re-measured);
- at run time a label other than the shipped one is shown only when the hash of the live merged config equals the `measuredHash` of a known preset whose label it is; anything else, including a hand-edited preset POSTed with its old label and a saved file re-merged onto changed defaults at boot, shows "custom settings, not measured";
- keep the POST body shape Bender's switch uses (`overrides`, `rtpLabel`, `reset`), so Isabelle's tooling does not change; when a sent label is not honoured, the POST reply says so in a `warning` field.
Re-run the critic's `e1-presets-label.js` LABELS part: every row must now be right.

**F. D4 and D5, small.** One paragraph in `PULL-ENGINE.md` section 8 on what a preset change does to held leads (rtp94 to rtp98: up to 22% of a Callback per player, once; the reverse takes it away). In `server.js`: compare byte lengths before `timingSafeEqual` in the shared admin check (no 500 on a non-ASCII token; the check must stay constant-time for equal lengths and must not weaken Bender's endpoint), and in the Cold Call POST only `reset === true` resets. Tests for both. Leave the order of `express.json` and the token check alone.

**G. D6, only if A to F are done and green.** Build the snapshot once per swap and hand the same deep-frozen object to every round, in place of two `structuredClone` + `createEngine` per spin. Every existing live-config test must pass unchanged ("an open round finishes on the config it started on"). If any test would need weakening, skip D6 and say so.

## Docs
- `cold-call/LEVERS.md`: a new section 8.14 "Buys and the pot (M1)": the finding in three lines, the rule now, the 200M hunt number, and a corrected chaser table that has a row for each buy (ex-pot figure = its total now) next to the paid-spin chaser 98.687. Correct the sentence under the RTP label rows so it says the pot is part of paid spins only.
- `cold-call/PULL-ENGINE.md`: the pot rule in the pot section and the validator table in section 8 (D1, D2, D3).
- `cold-call/PULL-STATE.md`: a section "FIX M1" with what changed, the commits, and a short list "what the UI must change" with exact wording for the info screen ("Bonus buys do not feed or win the office pot" or better), since you may not edit `public/`. Also list anything in the client you saw that would now be wrong (a pot card after a buy, a feed animation on a buy).

## Done means
- All suites green from a slim export of your last commit: `tests/coldcall.js`, `tests/coldcall-pull-engine.js`, `tests/coldcall-pull-server.js`, `tests/coldcall-livecfg.js`, `tests/coldcall-presets.js`, `tests/bender.js`, `tests/bender-livecfg.js`, `tests/authjoin.js`. Give each count and compare with the count at `b596408` (run the baseline first).
- `cmp games/coldcall-engine.js public/games/coldcall/engine.js` identical.
- A 10c-and-up transcript digest that the existing guard checks is unchanged for plain spins (the fix must not move a single paid-spin result).
- Commits on `coldcall-m1` only, by layer, nothing pushed.

## Report back (your final message, plain words, short)
For each of A to G: done / not done, the commit hash, the test names that failed before and pass now, every number with "measured" or "claimed". Then: what you did not check. If something in this brief turns out to be wrong or impossible, stop that item, say why, and carry on with the rest. A status line every 20 minutes or so while you work.
