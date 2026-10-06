# COLD CALL: Opus re-check of the M1 fix round (M1, D1 to D6)

2026-10-06, 18:31 to 18:55 CDT. Reviewer: Opus 5.5 subagent, adversarial, read-only (no fix, no commit).
Code under review: branch `coldcall-m1` at `c31da69`, against base `b596408` (`git diff b596408..HEAD -- games/ server.js tests/ tools/ cold-call/presets`).
Not repeated (the lead did them): the six suites on a clean export, the engine copy being byte-identical, the three 200M hunt-buy figures against the raw files.

## VERDICT: SHIP

No money defect, no label defect and no robustness defect was found in the code of this round. Every one of the six fixes held under attack, each with a script.
Two things to do, neither a reason to hold the server change:

1. **T1 (test, reproduced).** One re-pinned test was weakened: nothing in any suite now notices if an OPEN round takes its pot feed from the live config instead of its own snapshot. The code is right today; the pin is gone.
2. **U1 (label, by reading, not run).** The info screen in this branch still tells players that every paid bet feeds the pot and every spin can take it. That sentence becomes false for buys the moment this server change is live. The builder already handed it off in PULL-STATE.md ("What the UI must change"); it has to land in the same release.

## FINDINGS, worst first

### T1. TEST, REPRODUCED: item 3a no longer pins "an open round feeds the pot at the feedBps it was spun under"

Where: `tests/coldcall-livecfg.js` item 3a. At `b596408` it asserted `the pot slice follows the pre-swap feed (100 bps), not the new 300` on a round opened by a buy. Since a buy now feeds nothing, the line became `a buy feeds the pot nothing, before or after the swap`. No plain spin with an open decision crosses a swap anywhere in the suites, so the property moved from "pinned" to "not tested".

```
$ python3 _scratch/critic-m1fix/mutate.py SNAP        (settle(): cfg.pot.feedBps -> pullCfg().pot.feedBps)
SNAP: an OPEN round feeds at the LIVE feedBps, not its own (what item 3a used to pin on a buy) SURVIVED livecfg exit 0, 0 FAIL ;; pull-server exit 0, 0 FAIL
SNAP: an OPEN round rolls at the LIVE chance / minBal / cap                  SURVIVED livecfg exit 0, 0 FAIL ;; pull-server exit 0, 0 FAIL

the same first mutation on b596408 (base-feed-mut.out):
FAIL item 3a: a swap while a decision is open (pay table, spins, buy price, pick, more, list, pot all changed) ...   22 passed, with failures, exit 1
the second one on b596408 (base-roll-mut.out):   23 passed, exit 0      (never pinned: an older gap, not caused by this round)
```
Size: none today (`settle()` reads `rec.cfg`, checked by reading and by the earlier critic's `b1-pot-conservation.js`, which is a scratch script and not a suite). It matters because the snapshot was just rebuilt (D6) and this is the only pot path a plain spin with a natural bonus can hold open across a preset change.
Suggested pin: in 3a, also hold a PLAIN spin open (a natural bonus with a decision), swap to BIG_SWAP, settle with the pot roll forced, and assert the slice at the pre-swap 100 bps and the prize against the pre-swap chance and cap.
PULL-STATE.md says "Tests re-pinned (not weakened)". For this one line that is not accurate.

### U1. LABEL, BY READING (not run): the info screen still says buys feed and can take the pot

Where: `public/games/coldcall/pull.js:266-267`, as committed on this branch:
`"${feedBps / 100}% of every paid bet goes in; each spin has a 1 in N chance per $1 bet of taking all of it, up to ${num(R.pot.maxPayX)}x your bet"`.
After M1 a buy feeds nothing and can take nothing, so "every paid bet" and "each spin" are untrue for the four buys. `R.pot.maxPayX` also no longer exists in the rules (it became `capCents` in POT-CAP), so the last clause was already stale before this round.
Not a defect of this round: the brief forbade edits under `public/`, and PULL-STATE.md "What the UI must change" gives the exact replacement sentence. Listed here because it is the one player-facing statement the fix makes false. I did not run the client.

### T2. TEST, REPRODUCED (trivial): the `keyOf` replacer in the snapshot memo is pinned by no test

`games/coldcall-livecfg.js:268-271` names non-finite numbers in the memo key so a knob going Infinity <-> NaN is not served a stale engine. Replacing it with plain `JSON.stringify(Eng.CFG)` passes both suites (`mutate.out`: `D6: memo key blind to Infinity / NaN (plain JSON)  SURVIVED`). The D6 test checks Infinity -> 0, which plain JSON already tells apart (null vs 0). No production route reaches it (the validator refuses non-finite numbers); only in-place edits in tests do.

### I1. INFO, REPRODUCED: what the memo key and the config hash cannot see (no production effect found)

- `0` and `-0` are the same to JSON. Over the real route, `cold.floor: 0` then `cold.floor: -0` keeps the old snapshot (`d6-frozen.out` part 4) and a measured label stays on (`d3-label.out` part 1). I set every zero-valued leaf of the three labelled configs to `-0`: 6 leaves, all 6 accepted, label still shown on all 6, engine digest over 4,000 rounds changed on 0. Harmless.
- In place only (tests): a key set to `undefined` then deleted, and the string `"#Infinity"` against the number `Infinity`, reuse the same snapshot. A BigInt in the config makes `snapshot()` throw (inside settle that is a void and one refund, which `m1-paths.js` part 4 uses on purpose).
- The hash names numbers, not code. A code change that moves payback under unchanged numbers (M1 itself is one) keeps every hash and label. `tools/coldcall-preset-hash.js --write` re-stamps a preset with no measurement behind it. Both are process matters, not bugs.
- A non-math knob also drops the label: rtp94 plus `decision.timeoutMs 30000`, or plus `feed.minWinX 50`, reads "custom settings, not measured" with a warning. Cautious side, but an operator will meet it.
- `tests/coldcall-presets.js` is not in the chain `tests/coldcall.js` runs (it spawns pull-engine, pull-server, livecfg), and `npm test` runs no Cold Call suite at all. The preset hash is still checked inside the wired livecfg suite (`info.configHash === j.measuredHash`).
- Admin POST, unchanged behaviour: `{"reset":true,"overrides":{...}}` resets and drops the overrides with no warning in the reply; body-parser errors (malformed JSON, body `null`) still answer 400 as an HTML page before the token check (the brief said to leave that order alone).

## ATTACKED AND FOUND SOUND

**1. M1, buys and the pot** (`m1-paths.js`, pot at $70 with `rem` 4321, pot roll forced to 0 unless said; output `m1-paths.out`)
- Normal settle: 288 buy rounds (4 buys x 1c / $1 / $25 x both purses x bank / take x 6 seeds), 286 decisions answered: pot `bal / fed / paid / rem / seeded / last` unchanged, wallet = win - cost.
- Decision left open: disconnect default 24 rounds, real 40 ms timer after `ready` 4 rounds (`auto=timeout`), decided from a second socket of the account 2 rounds (another account refused): pot untouched.
- Restart with an open buy, 4 rounds: the stored record carries `buy` in memory and on disk, the cost is refunded once, the pot file is untouched, the round cannot be decided afterwards. (Restart never settles: `voidStored` only refunds.)
- Settle forced to throw on a buy (void), 2 rounds: cost refunded, pot untouched.
- A Callback armed, then a $25 hunt buy: the buy leaves the Callback armed and the pot alone; the Callback plays at cost 0 and rolls nothing; the next plain $1 spin wins 5000 (no over-fix).
- 18 values of `buyBonus` (absent, null, false, 0, "", true, "Hunt", " hunt", ["hunt"], an object with toString, "call\u0000", NaN, "__proto__", a String object, ...): each is refused, or is a plain spin (cost = bet, pot rolled), or is a real buy (cost = price, pot untouched). Server and engine never disagree on whether a round is a buy: one variable feeds both.
- Soak, 12,000 events, 2 accounts on 3 sockets, both purses, 6 bets, late decisions (1,562) and disconnects (286), real pot roll at 1 in 40 per dollar: 6,805 settled rounds, 2,998 buys, 409 pot hits on plain spins, 0 on a buy or a Callback, `fed x 10000 + rem = plain cost x feedBps` and `fed + seeded = paid + bal` after every event.
- By reading: buys do not use or make warm squares and never touch player state (`coldcall-engine.js`, "state out. Buys never touch it"); the legacy `pull.on = false` path has no pot code.

**2. D1 / D2 validator** (`d1d2-validator.js`, output `d1d2-validator.out`)
- 600,468 override sets on `pull.pot.*` and `pull.more.*`, drawn from 52 hostile values each (fractions, -0, denormals, 1e21, NaN, +-Infinity, strings, null, booleans, arrays, objects) plus 300,000 log-uniform cap / oneIn pairs: 81,781 accepted. Pay-out side computed from the engine's own `potHitChance`, `potPrize`, `potSlice` and its gamble comparison, not from the validator's formula.
- Largest chaser pot part among the accepted: 0.016666667, the bar exactly (the shipped pot). Accepted configs over the bar: 0.
- Largest ONE MORE CALL value: 1.000000000000156 per unit staked (the 48-bit grid of the server's random number, at most mult x 2^-48). Accepted configs with a gamble above 1: 0. `rtp 1.0000000000000002` is refused; `mult` 0 or 1 switches the gamble off.
- `seed` must be 0 (1 refused, -0 harmless), so a pot never re-seeds and the seed adds nothing to a chaser. With the two pot relations together `feedBps` cannot pass 166 while the pot can pay.
- A first version of my estimator reported 85 gambles "over 1" (1.00005 to 1.0004). That was my 20,000-point grid, not the code; the exact count gives the figure above.

**3. D3 label** (`d3-label.js`, output `d3-label.out`; `d5-admin-http.js` for the HTTP rows)
- 13-row matrix through `setLiveConfig` and the `state` handler: a preset with another preset's label, a preset with one number moved in the 16th digit, a different letter case, a label sent as an array, `pull.on false`: all read "custom settings, not measured" with a warning. A preset with its own label (padded with spaces and a newline too) shows it. The shipped numbers always show the shipped line whatever label is sent.
- Boot from a saved file: preset + its label shows; the same file with `list 400` reads custom; shipped numbers + "99.9% (trust me)" read the shipped line.
- Two different accepted configs sharing a hash: only the 0 / -0 pair (I1), no behaviour change.
- Preset list read once: a preset file dropped in after the first read and POSTed with its label reads custom.
- Over HTTP: the rtp94 file as the body gives `configHash === measuredHash` and its label; `list 400` with the rtp94 label gives custom + warning.

**4. D6 shared frozen snapshot** (`d6-frozen.js`, output `d6-frozen.out`)
- `games/coldcall-engine.js` has no `'use strict'`, so a write to the frozen config there would fail silently. Write detector (a recursive Proxy recording set / delete / defineProperty): the engine over 30,000 PULL rounds plus plain and forced rounds and the pot / state helpers made 0 writes; the server handlers over 4,145 settled rounds (spins, buys, late decisions, disconnects, `ready`, `state`, `history`, `floor`) made 0 writes into `K.cfg` / `rec.cfg`.
- The same seeded session on the real frozen snapshot and on an unfrozen copy: identical digest, wallets and pots, 0 voids, 0 failure lines in the log. (My first run showed a digest mismatch; it was the crypto-random `roundId` inside the state payload I was hashing. With it left out the digests match.)
- No payload (state, pending and done results, liveInfo, clientCfg) shares an object with the frozen snapshot. The stored open record does hold the frozen pull block by reference and still serialises.
- One engine for everybody: a round left open is unchanged by 3,000 rounds of another player on the same engine object, and finishes exactly as in a run where the other player never played. The engine allocates its grids per call and keeps only the PICK table cache.
- `K` and `K.eng` themselves are not frozen (only `K.cfg` is). Nothing assigns to them.

**5. D5 admin endpoint** (`d5-admin-http.js`, real `server.js` on 127.0.0.1:4665, closed after; output `d5-admin-http.out`)
- Headers with raw bytes above 0x7F at the same character length, the same byte length after re-encoding, 32 x 0xFF, 16 x 0xFF: 403 on both the Cold Call and the Bender route, no stack. One char off, token twice, no token: 403. Right token: 200.
- `reset` as "false", "true", 1, 0, null, [], {}, false with overrides: not a reset, overrides applied. `{"reset":1}` alone: 400. `{"reset":true}`: resets. Duplicate `reset` key: the last one wins (JSON).
- `1e999` (JSON gives Infinity), `__proto__`, `constructor.prototype`, text/plain, `overrides: null`, arrays: refused, `Object.prototype` clean. D1 and D2 are refused over HTTP with the named messages.
- An environment token with a non-ASCII character only matches when the client sends it as latin1 bytes. Not a bypass.

**6. Tests** (`mutate.py`, outputs `mutate.out`, `mutate-snap.out`, `mut-pull-server.out`)
- 22 single-line mutations, each on a fresh export: 19 caught, 3 survived (T1 twice, T2).
- M1 undone fails 2 of the 3 new tests plus the 2 re-pinned settlement tests; the third new test is the over-fix guard and fails when the pot block is switched off for everyone (13 failures). Half fixes are caught too: a buy that feeds but never rolls, a buy that rolls at $25 only, hunt left out, Chips left out.
- D1 and D2 undone or loosened (rtp <= 1.01, bar at 2.0 points), D3 undone or halved (label without hash, hash without label, no warning), D5 both parts, D6 not frozen / never refreshed / no copy: all caught.
- The other re-pins are equivalent, not weaker: settlement pot odds 1 in 400 -> 1 in 40 keeps `prizes >= 1` with only plain spins rolling; BIG_SWAP 99999 / 300 bps -> 650 / 150 bps and the pot-knob test 5000 -> 8 at 1 in 5 keep their assertions (`prizes >= 3`, slice exact) and sit on the bar.

## NOT REACHED
- No simulation of my own (limit: 1M spins). The buy paybacks and the 98.143 +- 0.119 pooled hunt figure rest on the lead's check of the raw files.
- The docs of this round (LEVERS.md 8.14, PULL-ENGINE.md section 8) were not read against the code.
- The client: U1 is by reading only; nothing under `public/` was run.
- `games/coldcall-sim.js` (`--pull`, `--pot-room`) after M1: the builder says it needed no change; not checked.
- The 180 s decision ceiling on a real clock, and a restart with a real process kill (the restart test re-inits the module on the same files).
- Ballot Bender's own POST beyond the shared token check (it still resets on any truthy `reset`; outside this round).

## REPRO
All scripts are in `_scratch/critic-m1fix/` and run from the root of a slim export of `c31da69` (they load the harness `_scratch/critic-money2/h.js` from the export):
```
mkdir -p _scratch/critic-m1fix/export && git archive c31da69 | tar -x -C _scratch/critic-m1fix/export && ln -sfn "$(readlink -f node_modules)" _scratch/critic-m1fix/export/node_modules
cd _scratch/critic-m1fix/export && nice -n 10 node ../m1-paths.js          (8 s)
                                   nice -n 10 node ../d1d2-validator.js    (60 s)
                                   nice -n 10 node ../d3-label.js          (1 s)
                                   nice -n 10 node ../d6-frozen.js         (8 s)
                                   nice -n 10 node ../d5-admin-http.js     (port 4665, closes it)
cd <worktree> && nice -n 10 python3 _scratch/critic-m1fix/mutate.py [name filter]     (needs the export above; about 6 min for all 22; runs the suites under flock /tmp/pull-tests.lock)
```
I removed my export and the mutated copies when done (806 MB each); the outputs of every run are kept beside the scripts as `*.out`. Nothing tracked was edited, nothing was committed, port 4665 is free.
