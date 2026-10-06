# COLD CALL: Chris's play notes, 2026-10-06 14:25 (wave FB1)

You are the LEAD for this wave. COLD CALL is a play-money slot inside The Ping (Play $ and Chips, no real money). Chris played the build for the first time today and sent the notes below. Your job is to close every one of them, prove each with a before/after, and hand back a branch that merges.

## His words (verbatim, do not reinterpret past what is written under each)

> it doesnt let you click the button until the 'leads' thing updates. make this smaller btw. dragging rotary on the boost doesnt work on pc so just make it "pick a number" and make gpt generated assets for the rest of this including the status bar above the tile drop.
> also all of the buttons and speech bubbles
> game is laggy and needs more graphics improvements.

Stamp `(chris 10-06 FBn)` next to each constant, rule or CSS block you change for a note, so later sessions do not revert it.

- **FB1 spin is blocked by the leads update.** SPIN must take a click the moment the board has settled and the win is counted. The leads note (count, bar, "+N LEADS", cold-line text) updates on its own time and never holds `st.busy`. Find every awaited pull animation between "last cascade settled" and `setBusy(false)` (`game.js` `PA(...)` calls, `pull.js` leadGain) and make the non-decision ones non-blocking. A real decision (PICK, ONE MORE CALL), a pot win card and a Callback announcement may still hold the button. Measure before and after, in-page (see Gotchas): ms from the last cascade settling to SPIN accepting a click, on dead spins, small wins and a spin that fills leads. Target: 0 added wait from the leads update; a second click during the old blocked window starts the next spin and the money still adds up.
- **FB2 the leads note is smaller.** It is the yellow sticky "LEADS 13 / 450" over the top of the board; today it is about 68 px tall at 540 wide and covers the top of the monitor frame. Make it a slim strip (aim for half the height or less), still readable at 360 wide, and it must never cover a symbol.
- **FB3 the rotary dial becomes "pick a number".** The bonus intro dial (`bonus.js` `makeDial`, digits 1..9,0) does not respond to a mouse drag on desktop. Replace it: show the numbers as big keys (a desk-phone keypad fits the theme), one click or tap picks. It stays a REVEAL: the script already holds the digit, so the key the player presses shows the script's digit. Do not show what the other keys "would have been". The info screen says in plain words that the number is set before the pick. Keyboard digits and Enter work; nobody touching it for 25 s still places the call itself; autoplay 0.7 s as today. Delete the drag code. Keep the hook the drivers use (`.dial` + `_finish`) or update every driver that taps it (`grep -rn "_finish" qa/`).
- **FB4 painted assets for everything that is still CSS boxes.** He asked for GPT-made art (same as the symbols, hero, room, title, monitor). In scope, in his order:
  1. the status bar above the tile drop: the red rule bar ("5+ TOUCHING = WIN / MAX 10,000X", also PICK YOUR LEAD / ONE MORE CALL with the countdown) and the leads strip;
  2. all buttons: BUY BONUS, AUTO, TURBO, info, SFX, MUSIC, bet minus / plus, HANG UP, ONE MORE CALL, the buy-menu cards and CONFIRM, the pick-a-number keys, mode tabs (Play $ / Chips);
  3. speech bubbles (hero caption, with a tail, three widths);
  4. then the rest: WIN readout plate, DAY and POT plaques, SPINS LEFT / BONUS TOTAL plates, toast and big-win cards, info-screen panel.
  Text stays live HTML on top of painted blanks (numbers and labels change, and Chips mode relabels), except short fixed words that are part of the art. Buttons need rest, pressed and disabled states (paint or derive by CSS filter from one blank; say which). 9-slice or fixed-size pieces must hold at 360, 540 and 1440 wide.
- **FB5 lag.** He was on a PC. Do not guess: measure on a real GPU first (shaman, see Tools), then fix. Report frame-time p50 / p95 / worst and count of frames over 16.7 ms and over 33 ms for: idle 10 s, 10 normal spins, a cascade win, a bonus intro, a full bought bonus, the ONE MORE CALL prompt. Also one run with 4x CPU throttle (stands in for a phone). Usual causes here: animated `filter` / `box-shadow` / `backdrop-filter` over large areas, layout-triggering properties animated per symbol, too many live layers (`will-change`), oversized images scaled down, per-frame DOM writes in the rAF loop, the idle hero animation repainting the whole head. `qa/coldcall-v2/capture/frametime.js` is an older probe to start from. Bar: on shaman 0 frames over 33 ms and p95 under 16.7 ms in every scene above; with 4x throttle p95 under 33 ms. Also check first-load weight and time-to-first-spin over the tailnet (big PNGs should be WebP at display size x2).
- **FB6 "more graphics improvements".** After FB1-FB5 land, run the visual loop below against the sibling game Ballot Bender and two real slots (Hacksaw "Le Bandit", one more of your choice): motion and juice count as graphics (symbol landings, win-line emphasis, cascade pops, big-win build-up, bonus transitions, idle life in the room). No new mechanics, no rule or pay changes.

## Money, rules, honesty (hard lines)
- No change to the engine, the server, pay rules, RTP knobs or tests' expected numbers. `games/**`, `public/games/coldcall/engine.js`, `server.js`, `tests/**` are NOT yours. Other agents are changing them on `coldcall-pull` right now.
- Never animate a number the server did not send. WIN meter = credited amount. FB1 must not let a click start a spin while a round is still unsettled on the server.
- FB3 is a reveal, said so on the info screen.

## Where and who else
- Your worktree: `/home/frank/.openclaw/workspace/projects/ping-coldcall-fb1`, branch `coldcall-fb1`, cut from `coldcall-pull` 9a02561 at 14:35. `node_modules` is a symlink. `_scratch/` is ignored: use it for scratch, never `/tmp` for anything big (`/tmp` is on the root disk, which is at 97%, 13 GB free).
- Your files: `public/games/coldcall/{game.js,bonus.js,board.js,pull.js,pull.css,style.css,index.html,hero.js,fx.js,captions.js,assets.js,boot.js,phone.js}`, `public/games/coldcall/assets/**`, `cold-call/art/**`, `qa/coldcall-fb1/**`, this brief, `cold-call/FB1-STATE.md`.
- Live on sibling branches, same client files, you WILL have to merge:
  - wave 3 "watch a friend's bonus": worktree `ping-coldcall-w3`, branch `coldcall-w3`, editing `game.js`, `index.html`, `public/shell.js`, new `watch.js` / `watch.css`;
  - denoms + live config: worktree `ping-coldcall-pull`, branch `coldcall-pull`, its Job C will edit the client (bet list 1c/2c/5c, a pot text fix in `pull.js` ~266).
  Keep your edits to `game.js` small and local (no reformatting, no moving code), put new code in new files where you can (`ui.css`, `keypad.js`), and at the end of each of your waves `git merge coldcall-pull` into `coldcall-fb1`, resolve, re-run the suites. Never commit to `coldcall-pull`, `coldcall-w3`, `coldcall` or master; never push; nothing deploys.
- Never `git add -A` / `commit -a` / `stash`. Stage named paths, check `git show --stat`. Commits: `git -c user.name=Frank -c user.email=frank@localhost commit ...`.
- Ports: yours are 4650-4654. NOT 4610, 4640-4643 (other agents), NOT 4655 until the step below.
- Chris's play copy: a stock server on **4655** serving `/tmp/cc-live` (old build 9ac80ab), data in `/tmp/cc-live/_srv/` (his account is in there). When a wave of yours has passed its checks, move it onto your build: copy `/tmp/cc-live/_srv` to `_scratch/play-srv` once, stop the old process (pid in `/tmp/cc-live/_srv/pid`, check the port first), start `PORT=4655 BANK_FILE=... LEDGER_FILE=... setsid node server.js` from a slim export of your commit (not from the live worktree, so half-written edits never reach him), then `rm -rf /tmp/cc-live`. No test hook on 4655. Write the commit it serves into FB1-STATE.md.

## Art: how, and the money
- Pipeline that made the current look: `cold-call/art/redesign/` (`gen_ref.py name aspect "prompt" ref1 [ref2]`, `gen_sheet.py`, `cut_sheet.py`, `gen_piece.py`, `spend.jsonl`, `SOURCES.md` one level up). Style refs that keep the set consistent: `raw/bold_lows.png`, `bezel.png`, `title.png`, the A1 concept. Painted on chroma green or a flat backdrop and cut out. Read `SOURCES.md` and the scripts before the first call.
- **Credit as of 14:30: about $0.87 total.** `~/.openclaw/credentials/openrouter.key` has $0.45 (account total 25.00, used 24.55; the key's own limit is not the balance), `openrouter-isabelle.key` has $0.42 of its cap, OpenAI direct is empty (credit_balance_exhausted). A 1K sheet with a reference costs about $0.17, so about 5 sheets. Frank has asked Chris for a $10 top-up. Until FB1-STATE.md says the top-up landed: spend in his order (status bar + leads strip sheet, buttons sheet, bubbles sheet), plan each sheet to carry 6 pieces, check the balance before every call (`curl https://openrouter.ai/api/v1/credits` with the key in a header read from the file), log every call in `spend.jsonl`, stop at $0.05. Never print a key, never put one on a command line as a literal.
- If the credit runs out before the list is done: do not substitute local-model or hand-drawn art for the missing pieces (he asked for GPT-made); leave those as they are, list them in FB1-STATE.md under "waiting on image credit", and keep going on FB1-FB3, FB5, FB6-motion.
- Every painted piece is judged in the real screen at 540x960, 360x740 and 1440x900, next to Bender, before it is kept.

## Tools
- Real-GPU capture and frame timing on shaman (Chris's Windows PC, RTX 5090): read `/home/frank/.claude/projects/-home-frank--openclaw-workspace/memory/shaman-gpu-rig.md` and `shaman-disk-hygiene.md`. Session 0 has no WebGL; the rig uses `schtasks /IT`. Never write to shaman C:, only `E:\`. shaman reaches this box at `http://100.104.51.99:<port>/`.
- Local headless: `qa/coldcall-v2/capture/qalib.js` `launch(w,h)` (software GL: fine for clicks and screenshots, useless for frame timing). Drivers to reuse and keep green: `flow.js` (set `CCPORT`), `f1_*.js`, `real.js` (hard-wired to 4640: copy it and point the copy at your port, do not run the original).
- Suites, from a SLIM export, deleted after: `D=_scratch/exp; rm -rf $D; mkdir -p $D; git archive HEAD | tar -x -C $D --exclude=qa --exclude=cold-call/art --exclude=cold-call/levers-runs; ln -s $PWD/node_modules $D/node_modules; (cd $D && node tests/coldcall.js && node tests/coldcall-pull-engine.js && node tests/coldcall-pull-server.js && node tests/bender.js); rm -rf $D`. At 9a02561 expect 47 / 57 / 58 / 19 (confirm the counts yourself on your first run and write them down; they move as `coldcall-pull` moves). `cmp games/coldcall-engine.js public/games/coldcall/engine.js` must be identical.

## Method (this is a look-and-feel job; follow it)
1. `qa/coldcall-fb1/refs/`: Bender at the same sizes, Le Bandit and one more real slot (screens + a short clip each of a spin, a win, a bonus start).
2. Deterministic named shots of ours (`?shot=` or the existing `?mock=pull` states): idle, dead spin end, small win, big win, keypad, PICK, ONE MORE CALL, buy menu, info, bonus mid; 540x960, 360x740, 1440x900; Play $ and Chips. "Before" set captured FIRST, before any edit.
3. Builder change, then a critic child that sees ours next to the refs and returns terse defect quotes (what is wrong, never how to fix). Fixes are tagged `(rN) critic rN-1: '...'`. Two fix rounds per item, then ship what you have and list what is left.
4. Before anything is called done: a blind judge scores unlabeled ours-vs-Bender pairs 1-10. Report the scores as they are.
- Critics, judges and any call that is a visual judgement: `sessions_spawn` with `model: "anthropic/claude-opus-5-5"`, `collect: true`, then `agents_wait`, and CONFIRM a line `cli exec ... model=claude-opus-5-5` for that run in `/tmp/openclaw/openclaw-2026-10-06.log` before you trust the verdict (visible Opus spawns have silently run on Sonnet twice). Builders: `sessions_spawn`, no model override (Sonnet), `visible: true`, group "Cold Call". Never Claude Code's built-in Agent tool. Never cancel a running child to take it over; steer it with `sessions_send`.
- At most 4 live children. Only one child may run headless Chromium captures at a time on this box (12 GB RAM, shared with seven other agents); frame timing runs on shaman.
- Free premade first for anything that is not art Chris asked to be GPT-made (easing curves, a keypad layout, a particle helper): look for a free, licence-clean one before writing your own.
- If one builder fails the same critic list two rounds running: race 3 builders in separate worktrees with different approaches and let an Opus judge pick. Each worktree is 800 MB: remove it right after.

## Waves, state, your own context
- Wave A (now): "before" shots and before-timings; FB1, FB2, FB3; FB5 measured on shaman and the worst offenders fixed; the first paint sheets the credit allows wired in. Then merge `coldcall-pull`, suites, drivers, move the play copy on 4655 to your build.
- Wave B: the rest of FB4 as credit allows, FB5 to the bar, FB6 loop, blind judge.
- You stay under about 150K tokens of context. At the end of each wave write `cold-call/FB1-STATE.md` (what is committed, with hashes; before/after numbers for FB1 and FB5; which pieces are painted, which wait on credit; open items; next wave; gotchas) and commit it. Wave B runs in a FRESH lead session started from that file plus this brief: when wave A is done, write the state file, then end your turn with the report; do not start wave B yourself.
- Your `sessions_send` may not be available from a lead session: anything Frank must know goes in FB1-STATE.md under "FOR FRANK".

## Gotchas already paid for
- Playwright `page.click('#spin')` adds about 7 s per spin (the button never reads as "stable"): click in-page (`document.getElementById('spin').click()`) for any timing. In-page numbers today (headless, software GL): dead spin 1.8 s, turbo 0.75 s, wins 3-5 s.
- Prompts ignore taps for 600 ms after they open (deliberate, a money fix): drivers wait for `CC.pull.armed()` or 700 ms. Do not remove it.
- New accounts sign up on the lobby's NEW ACCOUNT tab; drivers use `?live=1&nosplash&name=..&pin=..` on the game page with a socket signup first.
- Tests rewrite tracked `tests/*.json` and drop `accounts.json`, `*.bak-*`: run suites only in the export. `flow.js` rewrites tracked PNGs under `qa/coldcall-v2/w2flow/`: `git checkout --` them before committing.
- `node games/coldcall-sim.js` with no arguments starts a 100M-spin run. You have no reason to run the sim.
- A known bug on your base: `pull.js` ~266 reads `R.pot.maxPayX` and prints "undefined" on the info screen; the denoms lead owns that fix, leave it.

## Report (end of wave A; plain words, numbers, no adjectives)
For each of FB1-FB6: done / partly / not started; the before and after number or the two screenshot paths; what you did not check. Then: suite counts, driver results, the commit list, what the play copy on 4655 serves, credit spent and left, what waits on Chris.
