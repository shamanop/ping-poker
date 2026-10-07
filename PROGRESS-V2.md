# The Ping v2 core: progress

Branch `v2-core` off origin/master 9440541 (live). Owner: Frank. Contracts: `V2-DESIGN.md`. Bugs from playtests: `QA-FRANK.md`.
Never push or merge `master`.

## HAND-OFF TO ISABELLE, 2026-10-07 05:10 CDT (P6 wave 3c lead; branch `v2-all`). This is the current one; the 2026-10-06 19:50 section further down is the old UI hand-off, done.

**Head: the commit on `origin/v2-all` that carries this section; product code = `fd065d1`** (the commit on top adds only this file, `PROGRESS-CC.md` and QA output). A plain descendant of `origin/master` f34da22 (merged, never rebased; master had not moved at 04:53 CDT). Not merged to master, not deployed: that is yours. Play money only.

**TOP LINE, read before any deploy: a rollback to master f34da22 AS IS does not hold once one Cold Call round has been played.** Master's `money/ledger.js` does not know the account kinds `escrow:` and `pool:`. Tested on a copy of a soak data dir (6,677 lines): master boots, serves, QUARANTINES 995 lines, 28 player balances read wrong (Play $ total 12.2M against 4.36M) and it writes 17 recovery lines on that wrong view. The boot does not stop, which is the dangerous part.
- What holds (tested, scratch copies): master + the 2-line change `git diff f34da22 a10735a -- money/ledger.js` (the two kinds in `PLAYER_KINDS`) reads the same dir with 0 quarantined and correct balances; open slot rounds stay parked in escrow (master has no slot) and are settled when this head boots again. Before the first slot round is played, master as is reads the dir cleanly (tested).
- So: either put that 2-line change on master BEFORE this head goes live (it changes nothing for master's own play), or keep a rollback build = master + those 2 lines. Never roll back to plain f34da22 after slot play.
- D2 adds nothing to this: the checkpoint is a sidecar file that old code ignores, and `money.jsonl` stays byte for byte what the old code writes. Tested on this head's code: soak dir (5,639 lines + sidecar) -> master + 2 lines (14 seats returned, 14 lines appended) -> this head again with verify on: checkpoint used, 320 tail lines replayed, no mismatch, 0 quarantined, 10 open slot rounds settled, and the pre-D2 ledger's full replay of the final journal = this head's state (0 of 43 accounts differ).

**What is in it** (since master f34da22)
- UI wave 1 from master, merged (wave 3a).
- The one money system (P6): Bender and Cold Call write through `ctx.money` to `money.jsonl` (escrow per open round, the office pot as a pool account, one ledger line per money event, ledger first / state second / result last); boot rule: seats back to their fund, open slot rounds settled as their 20 s timeout would.
- Cold Call, lobby + docked in the shell, Play $ and Chips, with the client improvements of `coldcall` 18f1e67 and of `coldcall-fb1` accb6bc (Chris's play notes FB1 wave B: painted pay table / plaque / keypad, fit at 360, FB5 perf, the FB6 motion layer `juice.js`). accb6bc came in by path checkout of 15 files under `public/games/coldcall` (no merge: 47 MB of QA shots left out); nothing outside that folder changed.
- Ride-along fixes A2-A5, the Opus money critic's fixes (two rounds), the money soak (`tests/soak/`, README there).
- **D2 ledger checkpoints** (p6-d2 908cb06; `money/ledger.js`, `money/service.js`; D2 sections in `money/PROGRESS.md`): only the newest 20,000 ledger lines are parsed in RAM, older ones are read from the file on demand; `money.jsonl.ckpt` lets a boot replay only the tail; the poker seat events are indexed once at boot so normal play never scans the file. Opus critic, three rounds: r1 DOES NOT HOLD (a checkpoint written under other ledger rules was believed), r2 HOLDS, r3 HOLDS after the second and last fix round. Builder's numbers at 500,000 lines (ledger alone, fix round 1): open with a checkpoint 0.67 s, one boot pass about 1.45 s; before D2 3.3 s and 552 MB RSS.

**What is NOT in it**: watch a friend (`coldcall-w3`), `combo-1006`, the painted poker buttons, anything of `coldcall-fb1` after accb6bc, `qa/coldcall-fb1` and the `cold-call/` art of fb1.

**What I tested myself** (wave 3c lead, clean `git archive` exports; builders' and critics' numbers are named as theirs)
- Product tree of `fd065d1` (export identical by `diff -rq` to the one the runs used): run-money 567/567, run-tables 180/180, run-engine 96 (seed 1), `tests/coldcall.js` exit 0 (47 / 57 / 61 / 28 / 20 / 46), bender 19 + 5, `tests/v2/run.js --jobs 1` 166 of 166. `cmp games/coldcall-engine.js public/games/coldcall/engine.js` silent.
- Same tree: `tests/soak/prove.js --seed 7`, default env: clean PASS, 12 of 12 planted bugs CAUGHT. One 8-minute soak (`--seed 14 --kills 12`) under `LEDGER_WINDOW=200 LEDGER_CKPT_EVERY=500 LEDGER_CKPT_VERIFY=1`: CLEAN, 11,156 steps, 5,639 ledger lines, 11,171 checks; 12 of 12 restarts booted from a checkpoint with the full-replay comparison on: 0 mismatches, 0 ignored, 0 quarantined, 0 cold scans. The same pair also on the two earlier D2 heads (9ad1c59, 4af7bc6): clean, 12 of 12 each.
- Browser on `fd065d1`, real clicks via `qa/p6-w3b/run_leg.sh`: 540x960 Play $ PASS and docked 360x740 Chips PASS, 33 rounds each, 0 fails, 7 of 7 forced features, 4 of 4 buys, 0 console / page errors, 0 bad responses; each leg's `money.jsonl` replayed against its JSON round by round: OK (`qa/p6-w3b/out/w3c-fd065d1-*.json`). I looked at the docked 360 end shot: painted board, nothing broken. The same two legs passed on 0910bef (the fb1 client before D2).
- Rollback / migration boots of the real `server.js` (the cases in the top line plus a first boot on a master-written dir and a plain boot on a soak dir copy: 14 seats + 10 slot rounds recovered). Scripts in `_scratch/p6/w3c/rb/` on Frank's box, not in the repo.
- Not mine. Builder: run-money 567/567 in three env settings; 37 + 8 mutants killed. Critic r3 (Opus): 0 of 2,118,490 answers differ from the real pre-D2 service + port; 180 rollback / forward boots between the two last D2 heads equal the full replay. Earlier waves: six-leg browser chain (198 rounds), money critic rounds 1-2.
- NOT run by anyone: a real phone, iOS, touch, sound; the Railway volume; real traffic; the real server at 500,000 lines (measured on the ledger alone); `f1_u17.js` on this head.

**Open bugs** (severity first)
- MONEY, only on a line no shipped code writes (critic E14): a batch leg stored WITHOUT its own `reason` that buys into a seat. Pre-D2 code threw for that seat; this head answers, treats the seat's fund as the table currency and can cash a Play $-bought stack out as chips. Also E8's shape (two `topup` legs in one line) is handled as before D2. Check the live journal once before deploy, both counts must be 0:
  `node -e 'let a=0,b=0,n=0;require("readline").createInterface({input:require("fs").createReadStream(process.argv[1])}).on("line",l=>{n++;try{const r=JSON.parse(l);if(!Array.isArray(r.batch))return;if(r.batch.filter(x=>x.reason==="topup").length>1)a++;if(r.batch.some(x=>typeof x.reason!=="string"))b++}catch(e){}}).on("close",()=>console.log(n,"lines | 2+ topup legs:",a,"| batch legs without a reason:",b))' money.jsonl`
- MONEY, latent (E15): the checkpoint's rules fingerprint is the `money/ledger.js` file plus the live `SOURCE_ACCOUNTS` / `CURS` at write time. Code that changed that set at run time, at different moments in two processes, could make a boot believe a wrong state. Nothing in the tree does it; `ADD-A-GAME.md` says to edit the file. `LEDGER_CKPT=0` removes the whole class.
- STATE, no balance (C3, partly): after a crash between a slot ledger line and the state flush the office pot's `paid` / `last` can miss one prize.
- STATE, on purpose (C4): an instant spin's leads / daily state reach disk within 50 ms, not before the result.
- LOW, 0 money (D7 residual): `admin_set_play` with a reused op id and a hand-typed matching reason reads as a dup.
- LOW, display: a second tab opened while a decision is open elsewhere shows BUSY with no prompt; in 1 of 2 runs its meter kept the old number until the next spin (shell plate and ledger right).
- LOW: a late decision on a closed round answers `no_round`, not `round_closed` (nothing written).
- LOW, visual, no money path: the `juice.js` small-win rings are still too large (known in accb6bc, not fixed). `juice.js` has no test of its own: in the two legs on this head it was on and its counters ran (cells landed 4,534 / 4,490, puffs 17 / 12, nudges 20 / 19) with 0 page errors; how it looks was not judged by me.
- NEVER SEEN in a browser: an office pot win; a poker hand played with the slot docked at 360 (played at 540 in wave 3a).
- U17 (BIG WIN overlay after a lost one-more-call): restated as a detector artefact (the hidden warm-up layer); nothing visible.
- TEST GAPS (E16): two surviving mutants on the fingerprint (`CURS` not covered, set order); `LEDGER_WINDOW=1` alone fails 13 log-count asserts in `money-ledger.js` (the new "window 1 raised to 2" log line; do not run live with 1). Not reachable by the soak: engine-failure voids, a decision timer exactly across a restart, live buy-price changes.

**Deploy notes**
- New files beside `money.jsonl` (same volume): `coldcall-pull.json` (slot state), `coldcall-config.json` (live slot config), `money.jsonl.ckpt` (+ `.ckpt.bad` if one was ever refused; both can be deleted at any time, the next boot does a full replay). `money.jsonl.quarantine` only if lines were refused.
- Env: `COLDCALL_PULL_FILE`, `COLDCALL_CFG_FILE` (optional, default beside `money.jsonl`); `BENDER_ADMIN_TOKEN` (live slot math endpoints, off when unset); `COLDCALL_TEST` must NOT be set (ignored anyway when `NODE_ENV=production`). D2 switches: `LEDGER_CKPT=0` (no checkpoint read or written), `LEDGER_WINDOW=0` (all lines in RAM); both together = pre-D2 reading. `LEDGER_CKPT_VERIFY=1` compares the checkpoint with a full replay at boot and logs `CHECKPOINT MISMATCH` if they differ: suggested for the first live boots.
- First boot on master's data: no migration; `money.jsonl` is read as it is and its bytes are not touched (tested: prefix `cmp`); after recovery one line `ledger: N lines, M in memory, checkpoint ok` and the sidecar appears. Later boots log `money: checkpoint id ... tail lines replayed`. Every deploy that changes `money/ledger.js` costs ONE full replay on its first boot (`checkpoint ignored: rules changed`), on purpose.
- The Cold Call motion layer can be switched off per page load with `?nojuice` on the slot URL (loads neither `juice.js` nor `juice.css`); there is no server switch.
- The push does not need an empty table for the money to be right (a restart voids the hand in flight, returns every seat to its fund, settles open slot rounds), but it does unseat everyone: pick a quiet moment.
- A bonus claimed on master stays claimed (the gate reads the account record first).

**Needs Chris**
- D1: a restart settles an open bonus decision as its 20 s timeout would and pays the shown win (was: refund the stake). Every deploy does this.
- Chips max bet x the 10,000x cap: the exposure of one spin in real poker bank chips (Cold Call top bet 2,500 x 10,000 = 25,000,000 chips; Bender the same kind).
- iOS / touch / sound: never tested.
- The 2-line master change for rollback (top line): Isabelle's call, his to know.

## 2026-10-07 01:45, branch `v2-all`: P6 wave 3b CLOSED, INTERIM head (NOT the hand-off)

Product code head 6634db1, unchanged since the 00:45 push; this update adds only tests (`tests/soak/`, soak head 481104b), browser QA files (`qa/p6-w3b/`) and this entry. Still NOT merged to master, NOT deployed. Still to come before the hand-off: wave 3c (ledger checkpoints, then `HAND-OFF TO ISABELLE`).

**Added 01:45: the two results that were still running at 00:45**
- **Money soak, merged** (`tests/soak/`, how to run: `tests/soak/README.md`). Random play on a real server (poker, Bender, Cold Call in Play $ and Chips, bank and admin moves) with the server killed and restarted mid-round; after every step the ledger is checked against a model (nine invariants). `node tests/soak/prove.js` first runs it clean, then plants twelve money bugs one by one and each must be caught.
  - My own runs on the merged head (clean export): proof seed 7 and seed 9, each clean PASS and 12 of 12 planted bugs caught; one 8-minute clean run (seed 14: 13,436 steps, 12 kills, 688 poker hands, 2,328 Bender spins, 1,163 slot rounds, 6,677 ledger lines, 0 violations, 0 warnings).
  - My FIRST proof run on the merge failed 1 of 12: the planted bug `stuck-stake` never fired, because Bender now writes a round as one ledger line and nothing takes the old park-then-credit road. A test-harness matter, not a product defect: the bug was given a shape that fires (soak commit 481104b), then the two runs above passed. The same commit narrowed the planted `stranded-escrow` to closes that hold a stake. No invariant was changed.
  - Defects found by the soak in the product: none. Builder's numbers, not mine: three 8-minute clean runs (seeds 11 to 13) and eight stress runs on the pre-merge code.
- **Browser chain, real clicks, on 24fe5cf** (slot code identical to this head; report `qa/p6-w3b/REPORT.md`). Builder's run: six legs (540x960, 1440x900, docked 360x740; Play $ and Chips), 33 rounds each = 198 rounds, 0 fails; every forced bonus (7), every buy (4), a 100x-plus win and five fast-click cases in every leg. Extras: server killed with a decision open (one close, paid once, board free after reload), a broke player (refused by client and by server, nothing written), a second tab on the same account (no second round, no double pay), autoplay 10 rounds: all pass. Office pot win in the browser: not reached.
  - My own check (`qa/p6-w3b/lead-check-leg.py`, an independent replay of each leg's `money.jsonl` against its JSON): 6 of 6 legs agree round by round (33 ledger rounds each, the same ids, the same deltas, sums 0, no escrow left). I did not drive a browser myself.
  - U17 (BIG WIN overlay after a lost one-more-call): the builder's reading is a detector artefact (the old check counts the hidden warm-up layer); after two lost gambles nothing was visible. Restated, not fixed; the old `f1_u17.js` was not re-run.
- Also mine on this head: the short suites again (same counts as below), a real boot on the soak's 6,677-line data dir (`boot recovery: 11 seats, 0 pots returned`, `game recovery: ... coldcall 11 open/11 by game/0 kept, 0 escrows voided`, pages answer 200). NOT re-run on this head: `tests/v2/run.js` (no product or `tests/v2` file changed since the 166 of 166 run on 6634db1).

**What changed** (166beca -> 6634db1; `public/games/coldcall/**` and both engine copies untouched)
- Bender writes a round as ONE ledger line and answers an error, never a result, when the ledger refuses; a buy whose cost rounds to 0 is refused.
- Daily bonus and achievements: the mint line in the ledger is the gate (paid first, flag second). After a crash between the two: no second payment, the streak and the Full Week achievement carry on.
- Admin adjust / set Play: the admin page sends one op id per confirmed click; a resend writes nothing. A request without an op id works as before.
- Slot: a live `stake_mismatch` voids the round once (it retried forever); `g:coldcall:voided.refund` is what the ledger returned (0 when nothing was charged).
- Slot, from the Opus money critic (two passes): a round the ledger closed by a void gives nothing at boot (it could arm a free Callback); a player's final decision is on disk before the money call (a Callback gamble lost for 0 could be re-paid as banked after a crash). About 40 new tests on ledger lines.

**What I tested** (the lead's own runs, clean export of 6634db1)
- run-money 120/120, run-tables 180/180 (was 151), run-engine 96 (seed 1), `tests/coldcall.js` 47 / 57 / 61 / 28 / 20 / coldcall-money 46 (was 18), bender 19 + 5, `tests/v2/run.js --jobs 1` 166 of 166 (494 s).
- Builders' and critic's numbers, not mine: every fix shown to fail without its line; the critic's mutants killed; critic pass 2 found no way left to make the ledger pay twice or pay a returned stake.
- At 00:45 the browser chain and the soak were still running: see "Added 01:45" above.

**Open bugs**
- State only, no balance: after a crash between a slot ledger line and the state flush the office pot's `paid` / `last` can miss one prize; an instant spin's leads / daily state reach disk within 50 ms, not before the result.
- `admin_set_play` with a reused op id AND a hand-typed matching reason reads as a dup (0 money).
- Second tab, display only, no money (low): a tab opened while a decision is open in another tab shows BUSY with no prompt, so the decision cannot be taken there. In one of two runs its balance meter was still the old number after the round closed elsewhere (the shell plate and the ledger were right; the next spin or wallet message corrects it). Likely cause, read not proven: `game.js` `applyWallet` does not repaint the meter while busy. Not fixed.
- A late decision on a round that is already closed is answered `no_round`, not `round_closed` (nothing written, board stays free).
- The soak cannot reach: the slot's engine-failure voids, a decision timer firing exactly across a restart, a live change of buy prices, an office pot win in the browser.
- From wave 3a, unchanged: the decision-error toast wording, `/favicon.ico` 404, the showdown banner over the board cards with the slot docked at 1280x800.

**Needs Chris**: nothing new. (Still his: a restart settles an open bonus as its timeout would; the Chips max-bet cap exposure; iOS / touch / sound never tested.)

## 2026-10-06 21:20, branch `v2-all`: P6 wave 3a, INTERIM head (NOT the hand-off)

**This push is an interim head. It is not the hand-off and it is not ready for master.** Still to come on this branch: wave 3b (ride-along money fixes, the money soak with a Cold Call actor, an Opus money critic over the slot port, the three-size browser chain) and wave 3c (ledger checkpoints, then a section titled `HAND-OFF TO ISABELLE` at the top of this file). Estimate for the hand-off: Wed 2026-10-07, about 12:00 CDT.
Note on the push log: `origin/v2-all` showed `e596336` from 20:14. That push came from another of Frank's sessions by mistake (same commits, nothing rewritten); this entry is the first note that describes it.

**What changed** (729b829 -> this head; master is an ancestor, nothing rebased)
- 7eeb617: merge of `origin/master` f34da22 (the live v2 core + poker UI wave 1 + table looks). One conflict, this file, both texts kept. `public/shell.js` = master's wave 1 markup + the Cold Call bridge; against master it differs only by the Cold Call lines.
- 732f1d6: merge of `origin/coldcall` 18f1e67 (code = `coldcall-fb1` 7a57245): today's Cold Call client. SPIN no longer waits for the leads update, slim leads strip, keypad instead of the rotary dial, painted UI, GPU warm-up. Client only: nothing under `games/`, `money/`, `transport/`, `tests/`, `server.js` changed by it. cdb9316: the same branch again at 5d03ed1, `PROGRESS-CC.md` only (its old "coldcall fast-forwards master" note is replaced by a pointer here).
- e596336: one line in `public/games/coldcall/game.js`. The ledger build can answer a spin, a buy or a decision with an error (`round_closed`, `internal`, `funds`) instead of a result. A decision error already ended the round on screen, unlocked and asked the server for the state. A refused spin or buy unlocked but put the meter back from the page's own copy and kept a stale Callback view; it now asks the server for the state too.
- `qa/p6-w3a/`: two browser drivers and `run.sh` (smoke of the slot and one poker hand against the ledger; the error cases through a stub parent page).
- Proofs: `git diff 18f1e67 HEAD -- public/games/coldcall` = that one line; `cmp games/coldcall-engine.js public/games/coldcall/engine.js` silent; `git diff b55e7cb HEAD -- games money transport tests/v2-unit` = 3 files, 8 lines, all from master (table looks).
- NOT in it: watch a friend (`coldcall-w3`, `coldcall-pull` past b9ab3a5), combo-1006 (radio, login, recap), painted poker buttons.

**What I tested** (the wave 3a lead's own runs, clean export of e596336; every later commit is docs or `qa/` only)
- run-money 120/120, run-tables 151/151, run-engine 96 passed (seed 1).
- `node tests/coldcall.js` exit 0: 47 / 57 / 61 / 28 / 20 / 18. `tests/bender.js` 19, `tests/bender-livecfg.js` 5.
- `node tests/v2/run.js --jobs 1`: 166 of 166, twice (494 s and 506 s). 166 = master's 160 + the 6 checks of `tests/v2/18_escrow_boot.js`, which only this branch has (it had 156 before the merge; master's `28_looks.js` adds 10). The first run overlapped another session's run on the same fixed ports for about 4 minutes, so I ran it again alone: same result.
- Real boot on an empty data dir: `game recovery: bender 0 open/0 by game/0 kept, coldcall 0 open/0 by game/0 kept, 0 escrows voided`.
- `qa/p6-w3a/run.sh` on a fresh server (headless Chromium, real pointer clicks): smoke 134 of 134, errors 166 of 166.
  - Smoke, 540x960, a fresh account in Play $ and one in Chips: lobby, the dock lists Cold Call, 10 plain spins, bonuses with PICK YOUR LEAD / ONE MORE CALL / HANG UP answered by clicks, one more buy, a 20-click burst. After each step: ledger before - cost + win + pot = ledger after, the slot's meter = the shell's plate = the ledger, no escrow left, audit clean, no mismatch on screen.
  - Poker with the slot docked (1280x800, Chips): one heads-up hand against a socket bot by real clicks, chips conserved in the ledger, then one more spin in the docked slot.
  - Errors: `round_closed` and `internal` on a spin, a buy, ONE MORE CALL, HANG UP, a pick, an unsolicited error under an open prompt, and a spin with a Callback pending; `funds` on a spin and a buy. Each time: unlocked, no prompt left, state asked again, meter = the server's number, next spin goes out.
- The builder's runs (Sonnet, not mine): the same two drivers, same counts; and a negative control: the client from before e596336 fails 9 of 29 of those checks (no state request, meter stays, the Callback label stays).
- NOT tested here: a forced bonus on a PLAIN paid spin (the server runs without the QA hook, so every decision in the smoke came from a bought bonus; plain spins that happened to ask were answered too, not counted on); a `round_closed` produced by a real server (the errors are injected by the stub page); 360 and 1440 widths; phone-width poker with the slot docked; Bender in a browser; the admin console; iOS, touch, sound. The six-leg chain that another builder ran on the sibling head cd9336b is not counted here.

**Open bugs**
- Carried from wave 2, for wave 3b: a live `stake_mismatch` retries on every timeout forever (boot voids it); `g:coldcall:voided` names a refund for an instant round that was never charged (wrong number, no money moves); the money soak is unfinished and has no Cold Call actor; no Opus critic has read the slot's money port yet.
- Not ready for live until wave 3c: the ledger file has no checkpoints (measured: 500,000 lines = 132 MB, 5.3 s boot, 957 MB RSS).
- Low: after a decision error the toast reads "Lost the line. Your round is settled on the server." also for `round_closed` (true, but not the cause).
- Low: `/favicon.ico` answers 404 (one console error per page load).
- Seen in one screenshot, not compared with master: with the slot docked at 1280x800 the showdown banner and the hand text overlap the board cards (`qa/p6-w3a/shots/chips_7_poker_docked.jpg`).
- Known driver fail U17 (BIG WIN overlay element after a lost one-more-call): not re-run in this wave.

**Needs Chris**
- Nothing new. Still his: D1 (a restart settles an open bonus decision and pays the shown win), the Chips max-bet x 10,000x cap exposure, and that iOS / touch / sound were never tested.

## 2026-10-06 19:50, branch `v2-all`: P6 wave 2, the slot on the one money system (head of the code: b55e7cb)

`v2-all` = `v2-core` + the money soak (wave 1, unfinished) + P6 wave 2. NOT merged anywhere, NOT deployed. Hand-off between lead sessions: `P6-STATE.md` (outside the repo); the builder's report: `P6-W2C-REPORT.md`.

**What changed**
- W2-a (2f2688e, f35b95b, b414f03): the money primitives. Ledger accounts `escrow:<game>:<key>:<roundId>` and `pool:<game>:<name>`; `openRound` / `settleRound` / `voidRound`, pool legs; `ctx.money` (`transport/game-money.js`) is the only way a game touches money; the games registry runs `recover()` and an escrow sweep at boot, before the server listens. Contract: `ADD-A-GAME.md`.
- W2-b (2deee54, d60274c): fixes after an Opus money critic (report `_scratch/p6/w2b/CRITIC-REPORT.md`, outside the repo): only Bender keeps the old `ctx.wallet`; a replayed round answers `round_closed`; strict outcome arguments and `stake`; a pool is fed at most the stake.
- W2-c / W2-d (fed1a7c .. b55e7cb): COLD CALL (`coldcall-pull`, FIX M1 included) merged and moved onto `ctx.money`. One ledger call per movement, ledger first. Open round = escrow; office pot = `pool:coldcall:office` per currency, fed and paid inside the round's own batch, only on a plain paid spin (never a buy, never a Callback). A restart settles an open round exactly as its timeout would. A Callback's round id sits on the entitlement and its roll is on disk before any money moves. Slot tests moved onto a real ledger (`tests/lib-coldcall-ledger.js`), new `tests/coldcall-money.js`. The engine files are byte-identical to `coldcall-pull` 4713970.

**Run by the lead on a clean export of b55e7cb** (not the builder's numbers)
- `tests/v2-unit/run-money.js` 120/120, `run-tables.js` 151/151, `run-engine.js` 96 passed (seed 1).
- `tests/v2/run.js --jobs 1`: 156 of 156, 0 fail (481 s).
- `node tests/coldcall.js` exit 0: coldcall 47, pull-engine 57, pull-server 61, livecfg 28, presets 20, coldcall-money 18. `tests/bender.js` 19, `tests/bender-livecfg.js` 5.
- Engine: `git diff --stat 4713970 b55e7cb -- games/coldcall-engine.js public/games/coldcall/engine.js` empty; `cmp` of the two files silent.
- A real boot on an empty data dir logs `game recovery: bender 0 open/0 by game/0 kept, coldcall 0 open/0 by game/0 kept, 0 escrows voided`.
- The builder's numbers only (not re-run by the lead): four hand mutations (pot rule, recover on an empty tape, snapshot feed and roll, snapshot memo key), each reported as caught by a test.

**Open**
- The soak (`tests/soak/`) is NOT finished: poker actor, chaos (kills and restarts), inject / prove and the long runs are open; its builder session failed and left uncommitted edits in the worktree. There is no Cold Call soak actor yet. `ADD-A-GAME.md` section 8 makes that the gate before a game ships.
- No Opus money critic has read the slot port yet (W2-g). Points handed to it are listed in `P6-STATE.md`.
- No browser check of the slot on v2 (the client is unchanged; it can now receive error code `round_closed`).
- Small: a live `stake_mismatch` retries on every timeout (boot voids it); `g:coldcall:voided` names a refund for an instant round that was never charged.
- Ride-along fixes A2, A3, A4, A5 of `P6-MONEY-AUDIT.md` (Bender emits a result when the ledger write failed; admin adjust is not idempotent on a resend).
- Not merged: `coldcall-w3`, `coldcall-fb1`, `preview`. Ledger checkpoints (D2) are their own wave, needed before live.

**Open on purpose (written limits)**
- D3: leads, the Callback and its remainder are game state, not ledger balances. A crash can cost the entitlements granted by the one round in flight, never a balance. A corrupt slot file loses leads and Callbacks, never money.
- F2.4: a free round whose whole outcome is 0 writes no ledger line. The slot closes this itself for the Callback (record first, id on the entitlement); a second game with free rounds must do the same.
- A resent `spin` message is a new round (150 ms rate limit and the open-decision guard, as before).
- The last decision of a round is not on disk before the money call: a crash at that instant settles the default at boot, as a timeout would. It cannot pay twice.

**Needs Chris**
- D1 (told to Chris 2026-10-06, "unless you object"): a restart with a bonus decision open now SETTLES the round and pays the win on screen, where the old slot refunded the stake only.
- Nothing here is live. `master` is untouched; a live push is his call.

## HAND-OFF TO ISABELLE, 2026-10-06 19:50 (Chris, topic 10, 19:32: "send to isabelle to push ui")

**Merge `v2-core` into `master` and deploy.** This head = the v2 core rewrite (2d7feab, milestone 5) + `ui-basement` 47e890c (UI wave 1: one button system, panels, text floors, phone and landscape) + `table-looks` 1488813 (seven host-picked table looks). The UI is built on v2 and cannot ship without it; there is no master-based UI branch. Frank does not push master.

- **Before the push (yours).** Dry-run the migration on a copy of the prod volume: `node tools/migrate-v2.js --bank b.json --wallet w.json --stacks s.json --accounts a.json --out money.jsonl --dry-run`, read the report. Frank never had prod data, so this has not been done on real balances.
- **What the deploy does on first boot.** Copies `bank.json`, `wallet.json`, `stacks.json`, `accounts.json` to `<name>.pre-v2`, migrates them into `money.jsonl`, writes `stacks.json` as `{}`. Idempotent by `mig:` ref. No manual step on Railway. Boot recovery closes open tables and returns seats to the bank: push when nobody is mid-hand.
- **Rollback.** v2 mirrors balances back into `bank.json` and `wallet.json` after each write burst, so a redeploy of 9440541 reads current balances.
- **Frank's run on this head (2026-10-06 19:40, scratch checkout).** v2 harness 160 of 160 (`node tests/v2/run.js`, 183 s). Unit: money 90, engine 96, tables 128, migrate 27, amountfield 66, money.test 6538, bender 19, bender-livecfg 5, labels and clientlabels pass. e2e on the same merge at 17:25: blinds_typing chips 9/9, play 11/11, chips phone 9/9; looks_drawer 4/4; host_drawer 11/11.
- **One fix in this hand-off commit.** `tests/v2-unit/tables-settings.js` expected the default settings without `look`; table-looks added `look: 'basement'`, so tables ran 127 of 128. Test updated, no code change.
- **NOT in this branch.** Cold Call (stays on its own branches, not ready; it is not on v2 money yet). Your combo-1006 work (radio, login, recap): not merged or tested here. This branch rewrites `server.js` and most of the lobby client, so that merge needs care; Frank has not seen combo-1006 and has not tried it. Painted button art (UI wave 2, waits on Chris's kit pick).
- **Not checked.** Real iOS or Android devices. Prod data. `npm test` as one chain on this box (suites run one by one).
- **Preview.** This build has been on Chris's tailnet preview (port 4800 on Frank's box) since 17:25; he asked for the push after looking at it.
- **Reply path.** Frank cannot reach you (your box refuses his key). Answer through Chris, or call into `agent:main:isabelle`.

## Status

| Phase | What | State |
|---|---|---|
| 0 | Acceptance harness `tests/v2/` (repros 01-23, new N1/N3/Play $ ledger/hand-log tests, fuzz invariant, payload-shape contract), baseline run on 9440541 | done: 150 checks, 150 pass on v2-core 95ad5e7 |
| 1 | `money/` ledger + `tools/migrate-v2.js` | merged, 90/90 |
| 2 | `engine/` pure poker + unit tests | merged, 96/96 |
| 3 | `tables/` + `transport/`, legacy path deleted | merged 2026-10-06 07:07 (30adcba) |
| 4 | Client: AmountInput, legalActions controls, UI fixes | merged 2026-10-06 05:50 (edc52cd) |
| 5 | Playtest sweep, fix loop | done 2026-10-06 09:56: 8 defects (Q01-Q08, none S1), all fixed; see `QA-FRANK.md` |

## Log

- 2026-10-06 02:40 Branch cut, contracts written. `socket.io-client` added as a devDependency for the socket tests. The audit's rigged server copy (`src/` with `__rig`/`__audit`) was not shipped with the briefs, so the harness rebuilds it as a patch on a 9440541 worktree.
- 2026-10-06 02:55 Phases 1 and 2 merged into v2-core. `money/` ledger + service + migration: 71/71 unit checks. `engine/`: 92/92 (63 rule cases, evaluator differential, 20k-hand property test, old-showdown differential). Not yet wired into the server; that is phase 3.
- 2026-10-06 05:50 Phase 4 merged. Client: AmountInput rewrite, legalActions controls, admin console, bust panel, showdown UI. Unit 90/90 money, 96/96 engine. Client e2e proofs (A-I) done on legacy server; raise box (F) re-run against a v2-tables export.
- 2026-10-06 07:07 Phase 3 merged. `tables/` + `transport/` wired to v2 money + engine, legacy `tables.js` deleted. Unit suites: tables 127/127. SIGTERM/SIGKILL/reconnect/cashout/short-all-in. E1 engine fix (kicked top-bettor alloc) verified seeds 1/7/11. Harness bot fix (check 21 illegal raises) committed f347b20. Full 147-check harness pending (in-flight at this log entry).
- 2026-10-06 09:56 Phase 5 done on 95ad5e7. Sweep found Q01-Q08 (6 S2, 2 S3, no money or stuck-table defect); Q01, Q03-Q08 fixed in wave 1, Q02 (phone layout at 390x844) in wave 2. Full harness 150/150 in 495 s run alone (`tests/v2/results/fixc.json`, not committed); unit: money 90, engine 96, tables 128, amountfield 66, money.test 6538, 0 fails. Not checked: real iOS/Android, landscape phones, 3+ players on a phone, the s10_misc browser half (script stalls), radio/recap/Cold Call (not on this branch). Open for Chris: `/api/bank-summary?password=` is an open read behind the room password; a disconnected seat is cashed out after 2 minutes, between hands only. master untouched at 9440541.

## UI wave 1

Branch `ui-basement`, merged with origin/v2-core 2d7feab. Client only: no art, no server change, every element id kept.

- **What it is.** One component layer, `public/theme.css`, loaded first; every screen sheet (`style.css`, `lobby.css`, `shell.css`, `bank.css`, `admin.css`, `amount.css`, `phone.css`, new `landscape.css`) only lays out. All frames are CSS in wave 1; wave 2 drops painted art in by setting `--frame-*` / `--bw-*` / `--bg-*` variables (slot list and art sizes in `UI-KIT.md`). The old `btn-blue/brass/green/panel.png` are deleted.
- **Merge note.** `lobby.js drawDrawer` keeps the stable-node structure from 2d7feab (the blinds editor and a persistent `.host-body` stay in the document; title, rows around the editor and `.host-foot` are redrawn). Do not go back to `replaceChildren` over the whole drawer.
- **Proof on the merged head.** Unit: money 90/90, engine 96/96, tables 128/128, amountfield 66/66, money.test 6538/0. `tests/v2/30_shapes.js` 42/42. Full v2 harness 150 of 150 (249 s, `--jobs 2`; `tests/v2/results/ui-full.json`, not committed). `blinds_typing.py` chips 9/9, play 11/11, chips phone 9/9 (re-run after the last CSS change).
- **Before/after sheets** in `qa/ui-basement/sheet_<WxH>_p<N>.jpg` (before on top, after below, same states): 1440x900 (2 players), 1280x720, phone 390x844 with 2, 3, 6 and 8 players, landscape 844x390 with 2 and 6. Raw shots (`before/`, `after/`, `ref/`, 33 MB) stay untracked. Re-run: `qa/ui-basement/runset.sh after` (`AUDIT=1 GEOM=1` for the text-size/contrast and geometry audits), then `sheets.py`.
- **Audit result, last run.** Text under 12 px: none at 1440, 1280 and 390x844. Contrast under 4.5:1: none, except `.seat-bubble.k-call.above` on 6 and 8 players at 390 (1 to 2 samples, taken mid fade-in of the 2.6 s bubble animation, so likely a measurement artefact; not verified by eye). Landscape 844x390 6 players: clean after the final fix.
- **What was not checked.** Real iOS or Android devices. Landscape with 3, 8 players. The geom audit still lists below-the-fold controls in scrolling screens (create, profile, seat, settle) as "offscreen"; they scroll into view, that is expected. Seat plates overlap the board cards on 6 and 8 player phone layouts in the geom audit (same as before the wave). The table felt art, cards and chip piles are unchanged.
- **Open for Chris.** Pick which skin slots get painted art first (primary, secondary, danger buttons and the panel give the most).
