# THE PULL wave 2: flow plumbing notes (builder A)

Files: `public/games/coldcall/{game.js,bonus.js,board.js}`, `public/shell.js` (bridge relay only), driver `qa/coldcall-v2/capture/flow.js`.
Contract: `PULL-UI.md` sections 1 to 4. Placeholder prompts only; `CC.pull` (builder B) replaces them.

## What is done
- Transport (socket `?live=1` and shell bridge): one results inbox per `roundId` (`CC.core.inbox`). `T.spin` resolves on the first result (pending or done). `T.decide(roundId, k, p|take)`, `T.ready(roundId)`. Unsolicited done (timeout / disconnect default) is just the next item in the inbox. Spin carries `auto: st.auto`. Practice is unchanged (no pull code runs).
- Relays in `shell.js`: `decide`, `ready`, `spin.auto` from the game; `timer`, `floor {kind: feed|pot}`, `voided`, error `code`/`open` to the game; `init.name` (for the "YOU" mark).
- Hooks on `CC.core` (all call `CC.pull.*` only if it exists, every call guarded): `onResult, onError, onTimer, onVoided, onFloor, adopt, syncView, syncWarm`.
- One `ctx` per round (`ctx.p` = newest result, `ctx.script`, `ctx.timer`, `ctx.decisions`, `ctx.cur`). `bonus.run(ctx)` keeps its own position and reads the newest `ctx.script.bonus`, so nothing replays:
  - pick: decision spin plays drop + cascades (`playSpin` `hold`), prompt, then only that spin's phone feature (`resume`).
  - more: whole bonus, prompt, `moreOutcome` (won / lost reveal, meter rises or drops: the only drop, `setWin(..., drop)`), finale.
- Callback: SPIN reads CALLBACK while `view.cb`, bet shown = `cb.bet`, bet buttons off, cost 0, no balance check, `betCents` from the result drives all money maths.
- Warm squares lit (quiet) while idle from `view.warm` when `view.warmBet == bet`; bet change re-evaluates; round start keeps them (`sweep(true)`), the first spin's `hotIn` drops them if the bet changed.
- Stuck-round safety: `Abort` on voided / refused decide / 9 s with no answer after a decide or after the timer ran out; screen is swept, state re-requested. A page reload or another tab with an open decision is adopted from `state.open` / a stray pending result (replays from the partial).
- Auto: spin carries `auto:true`; no prompt; captions "AUTO: first lead picked" / "AUTO: banked". If a server still asks while `st.auto`, the UI sends the default itself.

## For builder B (what A calls)
- `setView(view, mode)`: `view` = server view + `at: Date.now()` (count the cold clock from `at`). Also on bet change / mode change / after each round.
- `setPot(modeBal)`, `feed(ev)` (own events: `you: true`; ids deduped; Play/Chips filtered), `feedClear()` (optional, on mode switch, followed by a replay), `onBetChange(betCents)`, `rules(rules)` (`state.pull.rules` else `E.CFG.pull`), `leadGain(pull)` (awaited, 4 s cap), `ghost(ghost, ctx)` (only pay > 0, not turbo, no bonus on that spin), `potWin(pot, ctx)`, `moreOutcome(more, ctx)`, `expired(why, {k, default})`, optional `timer(timer, ctx)`.
- `askPick(pending, ctx)` / `askMore(pending, ctx)`: return a Promise of the value, never auto-resolve. Use `ctx.timer` (`{timeoutMs, expiresAt, left()}`, updated in place on `g:coldcall:timer`), `ctx.pickTargets(choices, cb)` (taps on the lit squares; returns dispose; class `pick` on the slot), `ctx.dollars`, `ctx.cents`, `ctx.bet`. A's `decisionPoint` closes your prompt with `expired(...)` when the server's default arrives; remove your DOM in `expired` and when you resolve. Prompts render inside `#ov` (swept at round end). The placeholder is `.scrim.ph` (scrim with no backdrop, card at the bottom).
- Balance math is untouched by `CC.pull`: WIN meter = `totalWin` only; a pot prize is on top (`row.potWon`).

## Gotchas / server dependencies (found by the tests)
- The server decision timer starts at the pending event, but the client plays everything the player has not seen first (spins before the pick, the whole bonus before ONE MORE CALL, plus the 1.5 s flourish and the intro dial). Without `g:coldcall:ready` re-arming the timer, the default often arrives before the prompt is on screen (`decisions: ['timeout']`, no prompt shown); with turbo it is borderline for PICK, and a normal-speed bonus never reaches ONE MORE CALL. PULL-UI section 0 item 1 is therefore required, not optional. The client sends `ready` the moment the prompt is up (the server ignores unknown events today).
- The intro dial waits 25 s for a tap (`autoT`); that wait counts against the 20 s server timer too.
- `CC.dbg.rounds[i]` now carries `first` (pending/done), `callback`, `adopted`, `decisions` (how each decision ended: player / timeout / disconnect / early / auto), `more` (won / lost / banked), `aborted`, `cost`, `totalWin`, `potWon`, `wallet`. `CC.dbg.pull` collects errors thrown by `CC.pull` hooks.
- Levers agent notes for B / the info screen (2026-10-06): LEADS n / `CFG.pull.list` (450 now, read it), ghost label "IF A PHONE HAD LANDED: 12x" and only at 5x+, ONE MORE CALL is a 50/50 offered from a 5x bonus, buys read `buyCost`, pot is extra and outside the cap, cold line 36 h / 8 every 12 h / floor 300 (`cold-call/LEVERS.md` section 8).

## Tests (`node qa/coldcall-v2/capture/flow.js <scenario|all> [play|chips]`)
Server: `qa/coldcall-v2/capture/start4641.sh` (own instance, COLDCALL_TEST=1, decision timer 30 s through the preload `bump_timer.js` next to it; the stock 20 s timer expires before the client's own animation reaches the prompt, see Gotchas). `CCPORT` overrides the port.
Scenarios: practice, pick, picktimeout, moreearly, more, auto, callback, bridge (the real shell iframe: lobby sign-in, `Shell.openGame`). Each checks: no `CC.dbg.mismatch`, no page / `CC.pull` error, WIN meter == `totalWin`, server wallet delta (read over a second socket) == `totalWin + pot - cost`, no leftover nodes or scrims, not busy, plus scenario checks (decision `how`, TIME'S UP caption, meter drop on a lost gamble, CALLBACK label / free / bet).
Result 2026-10-06 (builder A + B's pull.js live): all 8 scenarios pass in Play $ and in Chips. `more` saw wins and losses in both modes (loss meter drop observed).
Not driven: the Callback with a LOW balance (the account had thousands; the code path skips the balance check when `view.cb`), warm squares lit before a spin (the arming run left none lit in Play $; Chips showed `warm:[26]` at load but a spin at that state was not asserted), voided / refused-decide aborts (no server hook to force them), `g:coldcall:timer` replies and `ready` (the server has no handler yet), a disconnect default, ghost / pot win (random, no hook).
