# THE PULL wave 2 (UI + client flow): independent critic, Opus

Commit under test: `864bff7` (branch `coldcall-pull`). Diff read: `git diff 62f1692..864bff7 -- public games`.
Model: `claude-cli/claude-opus-5-5`. Date 2026-10-06, 09:36 to 10:25 CDT.

Engine copy: `cmp public/games/coldcall/engine.js games/coldcall-engine.js` is clean (sha256 `2df15ce8...4b6210` both).

## How it was run

- Nothing in the worktree was edited by me; the only file I wrote is this report. 4610 and 4640 were not touched.
- Private server on **4650**: `git archive 864bff7` unpacked to `/tmp/crit-w2/srv`, started by `/tmp/crit-w2/start.sh` (stock 20 s decision timer, `COLDCALL_TEST=1`, own bank).
  A preload (`/tmp/crit-w2/ctl.js`, outside the tree) can pin the round rng to a seed, pin the pot roll and set `pot.minBal` through `/tmp/crit-w2/ctl.json`.
  Some runs start from a pre-seeded store (`/tmp/crit-w2/pull-seed.json`: accounts `visw`, `visz`, `visone`, `visbig`, `viscb`, `viscold`).
- Playwright, software GL, one browser at a time, real clicks. Scripts and screenshots: `/tmp/crit-w2/*.js`, `/tmp/crit-w2/shots/`.
- **The working tree changed under me.** At 10:07 somebody else's uncommitted hunk appeared in `public/games/coldcall/game.js` (`goLive`, +6 lines, pushes `_voided` when a
  reconnect's state no longer lists the round on screen) plus untracked `qa/coldcall-v2/capture/real.js` and `qa/coldcall-v2/pull/real_*.png`. Every result below is for
  `864bff7` as committed (the export), not for that hunk. See U7 and P4 for how the hunk relates.

Line numbers are those of `864bff7`.

---

## Reproduced

### U1 (money) Taps that speed a bonus up take ONE MORE CALL the instant it appears
- Where: `public/games/coldcall/pull.js:141-152` (`askMore`: the two keys are inserted at the top of the HUD and are live at once), `pull.css:79-81`
  (`#hud.dec` hides SPIN, `.dec2` is `.82fr / 1.18fr`: the ONE MORE CALL key covers the centre, where SPIN was), `game.js:584` (SPIN while busy = skip).
- Repro: `node /tmp/crit-w2/g_skiptap.js spin 5` (then `spin 2 360 740`, `spin 2 1440 900`). Bet $0.10, buy DIALING FOR DOLLARS, no turbo. Click a lit square when PICK
  shows, otherwise click the centre of the SPIN button every 110 ms, which is the game's own "tap to skip".
- Observed: 9 rounds of 9 took the gamble without any tap aimed at it. The prompt was on screen 7 to 162 ms before it was answered.
  540x960 (tap 270,839): lost, won, lost, won, won. 360x740 (180,659): lost, won. 1440x900 (720,787): lost, won. 4 of 9 bonuses went to 0.
- Same class on PICK: `node /tmp/crit-w2/g_skiptap.js board 4` (taps at the board centre, 270,559): 2 of 4 rounds picked a lead 116 and 146 ms after the prompt opened
  (`board.js:110-123` swallows a board tap that lands on a lit square; `game.js:585` makes every other board tap a skip).
- Expected: a decision cannot be answered by a tap that started as a skip. The safe side (HANG UP) should be the one under the SPIN position, and both prompts need a short
  arming delay (taps ignored for the first 400 to 600 ms).

### U2 (money) ONE MORE CALL shows the wrong amounts when the trigger spin itself paid
- Where: `pull.js:143-146` (`BANK ${money(W)}`, `you double (${money(X)})`, `you leave with ${money(0)}`), info line `pull.js:242`.
  Engine: `games/coldcall-engine.js:503-512` (`W` is the bonus alone; a lost gamble sets only the bonus to 0; `winTenths = cluster + phone + finalBonus`).
- Repro: `node /tmp/crit-w2/c_more.js play 46474 take` (seed 46474, fresh account, $1 bet: natural 3 bells, the trigger spin pays 11.2x, the bonus 6.2x).
  Shot `/tmp/crit-w2/shots/c_more_play_46474.png`.
- Observed on one screen: WIN `$17.40`, HUD `ROUND TOTAL $17.40`, key `HANG UP / BANK $6.20`, key `50% you double ($12.40). 50% you leave with $0.00.`
  The gamble was taken and lost: the server paid `$11.20` (wallet +$10.20 after the $1 bet). Banking would have paid $17.40, a win $23.60.
- How often: `node /tmp/crit-w2/off_more.js`: 30 of 119 ONE MORE CALL offers on natural bonuses (25%) come with a trigger spin that paid. Bought bonuses and the Callback
  have no base spin, so they are right.
- Expected: the three numbers are the round's outcomes (bank $17.40, win $23.60, lose $11.20), or the wording says "the bonus" for each of them.

### U3 (money) A round another connection settles is shown as this tab's spin, in the wrong currency
- Where: `game.js:463-466` (`onResult`: a result whose `roundId` has no inbox is handed to `firstPend()`, the spin in flight, with no check of `mode`, bet or `resolved`).
- Repro: `node /tmp/crit-w2/i_cross.js`. Tab B idle in Chips, bet 100. A second connection of the same account has ONE MORE CALL open in Play $ (bought bonus, $1 bet).
  The Play round is banked in the same tick as B's SPIN. Hit on the first try. Shot `/tmp/crit-w2/shots/i_cross_end.png`.
- Observed: tab B (Chips) animated the Play $ bonus `f2cf4e46716f` and ended on WIN `2,840`, CHIPS `10,000`. Its own chips spin `7ddf9921b9bf` (cost 100, won 100) was dropped
  as a stray and never shown. Chips wallet delta 0. `CC.dbg.mismatch` stayed empty, so the self-check does not see it. The Chips lead view also stayed stale
  (the result's state was stored under `play`).
- Window: the other round must settle while a spin is in flight (one round trip). Realistic with autoplay in one tab and a decision in another tab or on a phone.
- Expected: a result is taken for the spin only if it is not `resolved` and its `mode` matches; anything else goes down the stray path.

### U4 (stuck) At normal speed the decisions are often never offered: the server's 20 s runs out during the client's own animation
- Where: `games/coldcall.js:170-175` and `:414` (timer armed when the pending result is SENT), `:432-437` (`ready` re-arms only if it arrives before that timer fires),
  `game.js:239` (`ready` is sent only once the prompt is on screen), `game.js:227-230` (round already settled: caption only), `bonus.js:59` (the intro dial waits 25 s).
- Repro A: `node /tmp/crit-w2/a_normal.js` (bet $0.10, no turbo, no skip, dial tapped at once, PICK answered 1.5 s after it shows).
  | buy | pick answered at | ONE MORE CALL | bonus |
  |---|---|---|---|
  | bonus1 | 13.7 s | not shown, `TIME'S UP: banked` at 35.9 s | 148.4x |
  | bonus1 | 10.5 s | shown at 17.4 s | 14.2x |
  | bonus1 | 14.3 s | shown at 22.3 s | 67.6x |
  | bonus1 | 10.2 s | shown at 24.3 s | 81.0x |
  | bonus2 | 10.4 s | not shown, `TIME'S UP: banked` at 53.0 s | 268.4x |
  | bonus2 | 12.8 s | not shown, `TIME'S UP: banked` at 48.1 s | 419.4x |
  3 of 6 lost the offer, both ALWAYS BE CLOSING bonuses among them. The long bonuses are the big ones, so the offer disappears exactly where it matters.
- Repro B: `node /tmp/crit-w2/a2_passive.js bonus1` (same, the dial is not touched): 0 prompts, `decisions: ['timeout']`, caption `TIME'S UP: first lead picked` at 38 s for a
  clock the player never saw, 27.7x banked with no offer.
- Why the tests passed: the builders' shots and `flow.js` reach ONE MORE CALL in turbo (`qa/coldcall-v2/pull/more_360_play.png` has TURBO lit).
- Expected: the decision clock starts when the prompt is on screen (the server arms on `ready`, with a long ceiling for a client that never sends it), or the client sends
  `ready` as a keep-alive while it animates.

### U5 (stuck) The countdown on screen is not the server's: any timer message resets it to 0:20
- Where: `game.js:483-486` (`onTimer` ignores `expiresAt` and counts a full `timeoutMs` from receipt), `game.js:205` (`advance` does the same for an adopted round),
  server `games/coldcall.js:438` (a repeated `ready` answers EVERY socket of the account with the unchanged `expiresAt`).
- Repro: `node /tmp/crit-w2/b_timer.js 1`. PICK open in a tab; 9 s later a second connection of the same account sends `g:coldcall:ready` for that round, which is what a
  second tab does when it adopts the round. Shot `/tmp/crit-w2/shots/b1_after_second_ready.png`.
- Observed: clock `0:11` before, `0:20` after. The server still had 10.9 s. Its default landed 20.3 s after the prompt opened while the clock read `0:10`
  (`decisions: ['timeout']`). With two real tabs (`j_tabs.js`) both showed `0:20` at once.
- Expected: `left = expiresAt - (server now)`, or at least never raise a running clock on a repeat.

### U6 (stuck) A socket drop leaves a dead prompt that still takes an answer, then freezes 9 s
- Where: `game.js:556-568` (no `disconnect` handler), `games/coldcall.js:364-366` (the owner's disconnect takes the default at once), `game.js:217` (`no_round` is skipped),
  `game.js:177` (`LOST_MS = 9000`), `game.js:413` (toast).
- Repro: `node /tmp/crit-w2/b2_reload.js more drop`. ONE MORE CALL open (bonus $40.37 at a $0.10 bet), the transport is closed under the page, socket.io reconnects in 0.85 s.
  Shot `/tmp/crit-w2/shots/b3_after_drop_more.png`.
- Observed: the server history says `auto: 'disconnect'`, banked. The screen still shows `ONE MORE CALL? 0:16` with both keys. The player clicks ONE MORE CALL: nothing for
  9.1 s, then `Lost the line. Your round is settled on the server.` The screen never says the bonus was banked. Balance is right ($10,030.73).
- Expected: on `disconnect` the prompt closes with a plain line ("line dropped: banked $40.37"), and the state after the reconnect ends the round on screen.

### U7 (stuck) Server restart with a decision open: dead prompt for 28 s, wrong message, a WIN that was never paid
- Where: same as U6, plus `game.js:413` (the "cancelled, refunded" text exists but is not reached).
- Repro: `node /tmp/crit-w2/h_restart.js` (ONE MORE CALL open, then `KEEP=1 /tmp/crit-w2/start.sh`). Shot `/tmp/crit-w2/shots/h_after_restart.png`.
- Observed: the round is voided and refunded (wallet back to $10,000.00 exactly). The page reconnects in 1.0 s and keeps `ONE MORE CALL? 0:16`, keys live, WIN `$9.83`.
  28 s after the restart: `Lost the line. Your round is settled on the server.` It was cancelled, not settled; the $9.83 the meter showed was never paid and nothing says so.
- Note: the uncommitted `goLive` hunk in the working tree targets this case. Not tested here; see P4 for what it does to U6.

### U8 (stuck) A `rate` reply to `ready` aborts the round and starts a replay loop
- Where: `game.js:250` (`if (it._err) throw new Abort(...)` for ANY error that arrives while the prompt is up), `game.js:476` (`onError` puts every error in the round's inbox).
  Contract, `PULL-UI.md` section 0: "a `rate` error on `ready` = ignore (double-send)". The comment at `game.js:238` says it is ignored; it is not.
- Repro: `node /tmp/crit-w2/e_rate.js`. `CC.core.T.ready` is wrapped in the page so each `ready` goes out twice (the double-send inside 150 ms). Buy bonus1, turbo.
- Observed: PICK was up for 118 ms, then abort `Slow down`, toast `Lost the line...`. The state request re-adopted the same round, replayed it from the start, aborted again:
  4 aborts and 4 toasts for one round `d18d8668a60e` until the server's timeout settled it. The pick was never usable. Money right.
- Scope: the shipped single tab sends one `ready`, so this needs a double-send. The limiter is per account, so two tabs opening a prompt within 150 ms qualify.
- Expected: `rate` (and `no_round`) on `ready` are dropped; only an error that answers a `decide` may end the round.

### U9 (minor, honesty) After a mode switch the feed keeps showing the other currency's events
- Where: `game.js:495-498` (`feedReplay` calls `P('feedClear')`), `pull.js:312` (no `feedClear` in the API), `pull.js:99-102` (`feed` only appends, deduped by id).
  Contract, `PULL-UI.md` section 3: "Never show Play $ events in Chips mode or the reverse".
- Repro: `node /tmp/crit-w2/d_feed.js` (Play $ events only on the server, then switch to Chips and read the ticker for 14 s). Shot `/tmp/crit-w2/shots/d_feed_chips.png`.
- Observed in Chips: `CRITB78827 HIT DIALING FOR DOLLARS`, `CRITB78827 CLOSED 113X`, `CRITB50432 HIT DIALING FOR DOLLARS`, all Play $ rounds. The stored lines also held
  `YOU took THE POT $1.66`, a dollar amount that would rotate through the Chips ticker. `typeof CC.pull.feedClear === 'undefined'`.
- Expected: `feedClear` exists and empties `S.feed` and `S.seen`.

### U10 (visual, honesty) Ghost squares do not add up to the stamped number
- Where: `pull.js:189` (`if (f && f.k === 'b') f.v = h.after`: an upsell hit on a close that already collected is ignored; engine `:254` multiplies that close).
- Repro: `node /tmp/crit-w2/f_ghost.js 6376` (real ghost, seeded). Shot `/tmp/crit-w2/shots/f_ghost_6376_540_play.png`. Offline: `node /tmp/crit-w2/off_ghost.js`.
- Observed: stamp `IF A PHONE HAD LANDED 11.1x / $11.10 at your bet`; squares `$1`, `$2`, `x3 UPSELL`, close `$2.20`, `$1.50` = $6.70. The close is really $6.60.
  Offline: 43 of 9,769 ghosts (0.44%) disagree, always squares below the stamp (seed 7366: stamp 109.1x, squares 55.7x).
- Expected: `fin` applies every hit (`h.k === 'c'` without `pend` too).

### U11 (minor) Reload during a decision: settled by the server, the player is told nothing
- Where: `games/coldcall.js:364-366`; client: no path. `PULL-UI-FLOW-NOTES.md` says a reload "is adopted from `state.open`": for the tab that owns the round that never
  happens, the disconnect has already settled it.
- Repro: `node /tmp/crit-w2/b2_reload.js more reload`. Shot `/tmp/crit-w2/shots/b2_after_reload_more.png`.
- Observed: before, WIN `$9.75` and ONE MORE CALL at `0:19`. After the reload: no round, no toast, WIN `$0.00`, balance $9,990.36 -> $10,000.11. History: `auto: 'disconnect'`.
  For a reload during PICK the rest of a bought bonus is never shown either.
- Expected: one line after the reload ("Your open call was banked: $9.75"), fed from the history or a field in the state.

### U12 (minor, honesty) Info line for PICK promises more than the rule
- Where: `pull.js:241`: "When a bonus phone is about to ring with 2+ lit leads, you pick one." Engine `:456-457`: only the FIRST phone feature of a bonus.
- Repro: `node /tmp/crit-w2/o_info.js` prints the live lines; `node /tmp/crit-w2/off_pick.js` counts (engine only).
- Observed over 3,000 bought bonus1: 6,222 phone features with 2+ lit leads, 2,727 picks offered (44%). 1,971 bonuses had two or more such phones and one pick.
- Expected: "At the first phone of a bonus, if 2+ leads are lit, you pick one."

### U13 (visual) Cold line reads "0 warm leads go cold in 1 d 6 h"
- Where: `pull.js:43` (falls to the warm wording when `cold.leads` is 0), engine `coldInfo` `:158` (whole leads, floored).
- Repro: `node /tmp/crit-w2/v_shots.js visz` (store: 300.5 leads, no warm squares). Shots `/tmp/crit-w2/shots/v_visz_*`. All three sizes, both modes.
- Observed: `LEADS 300 / 450` and `0 warm leads go cold in 1 d 6 h`. Any list between 300.1 and 300.9 leads shows it (one or two spins on the way up).
- Expected: show the fraction ("0.5 lead goes cold in ...") or hide the line when nothing whole is at risk.

### U14 (visual, honesty) WIN shows dollars in Chips mode
- Where: `game.js:545` (the mode switch redraws balance, bet, feed and view, not the WIN meter), `game.js:83`.
- Repro: `node /tmp/crit-w2/q_win.js` (360x740). Shot `/tmp/crit-w2/shots/q_chips_win_dollars_360.png`; also the builders' own `qa/coldcall-v2/pull/idle_360_chips.png`.
- Observed: fresh Chips screen: WIN `$0.00`, CHIPS `10,000`, bet `100`. After a Play $ win of $1.30 and a switch to Chips: WIN `$1.30` on the Chips screen.
- Older than this diff, but it is on every Chips pull screen. Expected: `resetWin()` on a mode switch.

### U15 (minor) Callback armed: buy prices use a bet the screen no longer shows and cannot change
- Where: `game.js:98-99` (bet readout shows `cb.bet`, both bet buttons disabled, `buyFrom` still uses `bet()`), `game.js:601-602`.
- Repro: `node /tmp/crit-w2/k_cb.js 540 960 play` (store: 449.5 leads at an average bet of $1.37; one spin arms it). Shots `/tmp/crit-w2/shots/k_cb_*`.
- Observed: `FREE BONUS AT $1.30`, SPIN reads CALLBACK, bet buttons off, `BUY BONUS from $2.00`, menu `THE CALL $2.70`, `DIALING FOR DOLLARS $96.40` (the hidden $1.00 bet).
  What the menu says is what is charged, so no money error.
- Same run, checked and right: the Callback cost 0, played at $1.30 (not a bet level), wallet +$421.85 = total win, no mismatch.

### U16 (minor) Two captions say the wrong thing
- Where: `game.js:251` (any result that arrives under an open prompt is announced as `TIME'S UP: <default>`), `game.js:300` and `bonus.js:115` (`AUTO: banked` when
  `p.auto` is `'timeout'`).
- Repro: `node /tmp/crit-w2/j_tabs.js` (two tabs of one account on one round, autoplay off).
- Observed: the lead was picked in tab B (the last lit square); tab A said `TIME'S UP: first lead picked`. After the timeout both tabs said `TIME'S UP: banked`, then `AUTO: banked`.
- Expected: say what happened (`p.pull.pick.p`, `pull.more.take`), and keep AUTO for autoplay.

### U17 (minor) BIG WIN overlay straight after a lost gamble
- Where: `game.js:380-382` (tier from the round total, whatever ONE MORE CALL did).
- Repro: the U2 run. Shot `/tmp/crit-w2/shots/c_more_play_46474_outcome.png`.
- Observed: the gamble is lost, then `BIG WIN x11.2` with the full count-up and cash art for the $11.20 the trigger spin had already paid.
- Expected: no tier overlay after `more.take && !more.won`; show the plain total.

---

## Plausible (read, not run)

### P1 (minor) Dock badge counts rounds this tab did not play
`public/shell.js:344`: `ccNet += p.totalWin - p.cost` runs for every done result the shell hears. A decision round is sent to every socket of the account
(`games/coldcall.js:256`), so a second tab's badge moves by a round it did not play. A pot prize is never in the badge.

### P2 (minor) Countdown text breaks above 59 s
`pull.js:124`: `'0:' + pad2(s)` prints `0:60`, `0:75` if `decision.timeoutMs` is raised (the flow tests already run a 30 s server).

### P3 (visual) The pot mug gives a pot win away before the reveal
`games/coldcall.js:266` broadcasts `floor:pot` with the emptied balance when the round settles; `pull.js:59-63` redraws the mug at once, busy or not. The mug should drop
to almost nothing while the winning round is still animating, seconds before YOU TOOK IT.

### P4 (money wording) The uncommitted `goLive` hunk would tell a player a banked bonus was cancelled and refunded
Working tree only, `game.js` `goLive`, the 6 lines added at 10:07. It pushes `_voided` whenever a reconnect's state does not list the round on screen. After a plain socket
drop (U6) the server has BANKED the round (`auto: 'disconnect'`), so it is also missing from `opens`; the screen would then say `That call was cancelled. Your bet is refunded.`
while the win was paid. Not run: another agent's browser was up and the hunk is not in `864bff7`. The fix needs to tell voided from settled (history, or a `settled` list in
the state).

---

## Checks that came out clean
- Long amounts ($125,000.00, 25,000,000 chips) in both decision keys and the result card at 540, 360 and 1440: no overflow, chips wrap to two lines (`m_long.js`).
- Seeded real states at the three sizes, both modes (warm stamps at $25.00 and 2,500, pot $12,345.67 and 98,765,432, cold line with days, warm warning after a bet change):
  no clipped or escaping text (`v_shots.js`).
- Info lines against `CFG.pull`: leads 1.2 / 0.6 / 0.6, list 450, cold 36 h / 8 per 12 h / floor 300, warm 35% up to 4, ghost under 1x and 5x or more, daily 0.2 + 0.05 up to 0.4
  at $0.10, pot 1% / 1 in 3,000 per $1 / 50x / $10, both currencies. All match except U12.
- Ghost stamp never touches WIN or the wallet (U10 run: WIN $0.30, wallet -$0.70 on a $1 bet). Daily leaf matches `daily.next` (0.2, and 0.4 at a long streak).
- Double clicks on the keys and on a lit square send one `decide` (read: `done` guards, `pull.js:137`, `:149`).

FINAL: 17 reproduced, 4 plausible
