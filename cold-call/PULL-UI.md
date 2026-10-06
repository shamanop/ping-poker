# THE PULL: wave 2 UI contract (lead: wave-2 session; builders code against THIS file)

Skin 3 look is fixed (see `public/games/coldcall/style.css`). Extend it; no new palette, no templated SaaS cards. Honesty: nothing shown that differs from the true odds or from the result fields. Spec wording: `PULL.md`. Server fields: `PULL-ENGINE.md`.

## 0. Server pieces the UI depends on: ALL THREE LANDED (commit 9a59e6f, details in PULL-STATE.md 'Server bits for the wave-2 UI'). `timer` is authoritative for the countdown, keep a 1 s own fallback; a `rate` error on `ready` = ignore (double-send). `rules` = whole CFG.pull; `daily.next` is in every state view (null if unknown). Original ask:
1. `g:coldcall:ready {roundId}` re-arms the decision timer once per open decision (the ONE MORE CALL pending event carries the whole bonus, 60 s+ of animation, the 20 s timer starts at the event). Reply `g:coldcall:timer {roundId, timeoutMs, expiresAt}`. UI: sends `ready` when the prompt is on screen; if no reply arrives within 1 s it counts down from its own `timeoutMs` receipt time.
2. `state.pull.rules` = live `CFG.pull`. UI reads `rules` if present, else `E.CFG.pull` of the engine copy (byte-identical to the server file).
3. `stateView.daily.next` = leads the next claim gives. UI: if absent, say "free leads" with no number until the claim result shows `pull.daily.leads`.

## 1. Wire protocol (client side)
Events from the server (socket directly, or relayed by `public/shell.js` as postMessage into the iframe): `g:coldcall:state` (adds `pull`, `pot`, `feed`, `open`), `g:coldcall:result` (status `done` | `pending`), `g:coldcall:voided`, `floor:feed`, `floor:pot`, `g:coldcall:timer`. Requests: `g:coldcall:spin {bet, mode, buyBonus?, auto?}`, `g:coldcall:decide {roundId, k:'pick', p} | {roundId, k:'more', take}`, `g:coldcall:ready {roundId}`.
Bridge messages (iframe <-> shell): game -> shell `spin {reqId,bet,mode,buy,auto}`, `decide {reqId, roundId, k, p|take}`, `ready {roundId}`; shell -> game `init`, `wallet`, `result {payload}`, `error {message, code, open?}`, `floor {kind:'feed'|'pot', payload}`, `timer {payload}`, `voided {payload}`.
Results: a spin request is answered by ONE result: `pending` (a decision is open) or `done`. A decide request is answered by the next result for that round: `pending` (next decision) or `done` (`resolved: true`). A `done` result for an open round can also arrive UNSOLICITED (server timeout / disconnect default: `auto: 'timeout'|'disconnect'`): the client must take it, close the prompt and finish the animation from the new script. Results are keyed by `roundId`, never by queue position.

## 2. Resuming an animation (the hard part; builder A owns it)
`pending.partial` is the script SO FAR (only what the player has seen); the next result's `script` is the longer/final one. A `cursor` per round remembers what is already on screen: base spin shown, bonus intro shown, N bonus spins shown, the decision spin's cascade shown. On each new result the animation continues from the cursor and never replays.
- `pick` (first phone feature of a bonus; `pending.spin` = bonus spin n, `choices` = hot squares): the decision spin in `partial.bonus.spins[last]` has `pickPending: 1`, `phone: null`: animate drop + cascades, then show the PICK prompt on the lit squares (board stays as is), on result run only the phone feature of that spin (`playSpin` resume mode: no drop, no steps). Revealed upgraded square has `up: 1`.
- `more` (end of bonus; `pending = {W, mult, pWin, capT}`): the whole bonus is in `partial.bonus` with `winTenths = W` (as played). Animate it, then the HANG UP / ONE MORE CALL prompt. On result: `pull.more.take`, `.won`; final total in `p.totalWinTenths`. If taken and lost the WIN meter drops to the final total (a dedicated path; the "win never decreases in a round" rule has this one exception, `selfCheck` compares to `p.totalWin`).
- Timer: counts down from `timeoutMs` (restart on `g:coldcall:timer`). At 0 the UI shows "TIME'S UP: <default>" and waits for the server's unsolicited `done`; it never decides on its own.
- Autoplay (`st.auto`) sends `auto: true`: no prompts, a caption line says what the default did ("AUTO: first lead picked", "AUTO: banked").
- Turbo / skip never skips a decision.

## 3. Money and display rules
- A Callback round: cost 0, played at `result.betCents` (not the selected bet), allowed with a low balance. SPIN button reads CALLBACK while `view.cb` is set; the bet shown during it is `cb.bet`.
- Play $ shows dollars, Chips shows whole chips (`dollars()` in game.js). Pot, feed amounts, Callback bet all go through it.
- Warm squares show their bet: `view.warm` positions + `view.warmBet` (cents). Changing the bet to anything else drops them (`pull.warmDropped`): the UI warns BEFORE the spin ("4 warm leads work at $1.00 only").
- Cold clock: `view.cold = {inMs, leads, warm}` -> "20 leads go cold in 3 h 12 m", always shown when non-null; counted down locally.
- Ghost ("WOULD HAVE CLOSED $12.40"): only when `pull.ghost` is non-null and `ghost.pay > 0`; value = `ghost.pay` in tenths of the round's bet; flip the ghost squares from `ghost.script`; short, skippable, OFF in turbo, never when the same spin triggered a bonus.
- Daily: `view.daily.claimed`; result `pull.daily = {leads, streak}` -> "APPOINTMENT KEPT +N leads, day S".
- Pot: `state.pot[mode].bal` ticks on `floor:pot`; a pot win (`result.pot = {won, amount, who}`) gets its own celebration and the amount is ADDED on top of the win (info screen: the pot is extra, outside the 10,000x cap).
- Feed: `floor:feed` events {kind: win|bonus|callback|pot, who, x, amount, mode, bonus}; rotate lines in a single ticker; own events included but marked "YOU". Never show Play $ events in Chips mode or the reverse (filter on `mode`).
- Practice (not signed in, local engine): no pull UI at all.
- Info screen: one honest line per mechanic, numbers from `rules`; states the pot is extra.

## 4. Files and ownership
- Builder A (flow): `game.js` (transport, results inbox, decide/ready, resume cursor, Callback spin), `bonus.js` (resume mid-bonus, more finale), `board.js` (resume phone only, pick tap targets, warm square markers), `phone.js` if needed, `public/shell.js` (bridge relay only).
- Builder B (look): NEW `pull.js` + NEW `pull.css`-style rules appended to a NEW file `pull.css` (linked from index.html), `fx.js` additions, `index.html` DOM slots. Exposes `CC.pull` (see section 5). Does not touch the transport.
- Engine copy stays byte-identical. No edits to `games/*` or `server.js`.

## 5. `CC.pull` API (B implements, A calls)
```
CC.pull.setView(view, mode)          // lead list / callback / warm / cold / daily chip from a state view {leads, list, cb, warm, warmBet, cold, daily}
CC.pull.setPot(modeBal)              // {bal, last} for the current mode
CC.pull.feed(event)                  // push one floor:feed event
CC.pull.onBetChange(betCents)        // warm warning
CC.pull.leadGain(pullBlock)          // after a round: animates leads filled, daily, leaked, armed
CC.pull.ghost(ghost, ctx)            // Promise; plays the would-have-closed line
CC.pull.askPick(pending, ctx)        // Promise<p>; highlights choices, timer; resolves with the tapped square (never auto-resolves)
CC.pull.askMore(pending, ctx)        // Promise<boolean take>
CC.pull.expired(why)                 // closes a prompt: "TIME'S UP: <default>"
CC.pull.moreOutcome(more, ctx)       // Promise; the gamble reveal (won or lost) after take
CC.pull.potWin(pot, ctx)             // Promise
CC.pull.rules(rules)                 // info-screen lines
```
Prompts are rendered inside `#ov` / `#scene` so `sweep()` removes everything.
