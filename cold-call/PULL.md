# COLD CALL: THE PULL (what to build)

Chris, 2026-10-06 02:36, asked what would make these slots more addictive and what Hacksaw-type studios overlook.
Two answers (Opus and Fable 5.1) agreed: the spin is solved; the gap is **memory, other people and a decision**.
Chris 02:44: "yes. want this all built in and tested. deploy separate agent to make sure RTP and money levers are
finely tuned to make the game as addicting as possible -- compared with the real levers for hacksaw".

The Ping is a private, play-money app for Chris and his friends. Nothing here goes live without Chris's word.

## The six mechanics

### 1. THE LEAD LIST (memory; a meter that never resets)
A per-player, per-currency list of 50 leads, kept on the server, shown as "LEADS 43 / 50".
- Every paid spin works leads. A dead spin works MORE leads than a winning one, so no spin is worth nothing.
- 50 / 50 = **THE CALLBACK**: a guaranteed bonus on the next spin, then the list starts again.
- **Leads go cold.** After 24 h without a spin the list starts losing leads (a slow leak, never below a floor).
  The game shows it plainly: "7 leads go cold in 3 h 12 m".
- Bonus buys do not fill the list.

### 2. WARM LEADS (memory on the board)
When a base spin ends with marked squares and no phone, each marked square has a chance to stay "warm" for the next
spin. Warm squares survive closing the game and go cold with the same 24 h clock. A capped number can be warm.

### 3. WHAT YOU LEFT ON THE TABLE (regret, honest)
On a dead spin that had marked or warm squares, briefly ghost-flip them: "WOULD HAVE CLOSED $12.40".
**Honest only:** the values shown are the ones the round's own random draw would have produced. Never invented,
never inflated, never shown more often than they truly happen. Skippable, short, and off in turbo.

### 4. THE DECISION (one real choice per bonus)
- **PICK YOUR LEAD:** at the first phone of a bonus the player taps one marked square; that square is upgraded.
- **ONE MORE CALL:** when a bonus ends, the player may hang up and bank it, or put it on one more call
  (a fair gamble at the game's own payback). One offer per bonus, capped so the 10,000x cap holds.
- Both resolve on the server. A timeout, a disconnect and autoplay all take the safe default (first square, bank).

### 5. THE FLOOR (other people)
- **Feed:** friends' wins above a threshold, and every bonus and Callback, pushed live to the lobby and into both
  slots and the poker table ("Matt just closed 2,400x on COLD CALL").
- **THE OFFICE POT:** one shared pot per currency, fed by a slice of every COLD CALL bet, always on screen and
  ticking up, won whole by one player on a rare trigger. Everyone sees who took it.
- **Sweat it:** when a friend is in a bonus, others get a toast and can watch it live, read-only.
- NOT in this build: buying a piece of a friend's bonus. It moves money between players and needs Chris's rules.

### 6. THE APPOINTMENT
The first spin of the day works a handful of free leads, and a day streak adds more. Small, visible, no money gift.

## Hard rules
- **Total payback stays 98.0% +- 0.3 with everything in it**: base game, bonuses, Callback, warm leads, the gamble,
  the pot. Each mechanic has a named knob in `CFG` (rate, cap, cost); the levers agent sets the values, the
  builders build the mechanisms. See `cold-call/LEVERS-BRIEF.md`.
- **Server-authoritative, per player, per currency (Play $ and Chips kept apart).** The engine today resolves a round
  as a pure function of (rng, buy). It becomes a pure function of (rng, buy, player state) and returns the new
  player state. Still deterministic, still replayable, still byte-identical between server and browser copies.
- Money is whole tenths of the bet, never rounded. The pot is real money in the wallet's terms: what goes in
  equals what comes out, to the cent, with a settlement test for both currencies.
- No lying to the player: no faked near misses, no faked "would have" values, no pot odds that differ from the
  displayed rules. The info screen explains every mechanic in one line each.
- Nothing to master, no deploy, no PR. Chris's hold from 2026-10-05 21:29 stands.

## Order
1. Engine + server: player state, lead list, Callback, warm leads, the two decisions, pot, feed events. Tests + sims.
2. Levers set the numbers (separate agent). Before / after table.
3. UI in the NEW skin (branch `coldcall-skin3`, being built now): lead list, warm squares, ghost flip, pick, one
   more call, pot, feed, watch. Do not build UI on the old brown skin.
4. Full QA: money, both currencies, three screen sizes, stuck rounds, disconnects in the middle of a decision.
