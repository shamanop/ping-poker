# P6 money audit: every place money exists or moves

Lead: Frank's P6 lead (Opus), 2026-10-06. Read from the code, not from the docs.
Part A = `v2-core` at 2d7feab (poker, bank, Play $, Bender). Part B = the slot COLD CALL at `coldcall-pull` fb4f644 (old master money, not on v2).

The rule being audited (Chris, P6): every cent or chip that exists is a balance in the ledger; every movement is ONE atomic ledger batch with an idempotent ref; nothing that counts as money lives only in memory or in a game's own file; a crash at any point loses nothing and pays nothing twice.

Marks: **OK** = a ledger balance / one atomic idempotent write. **NOT** = breaks the rule (numbered `A1..`, `B1..`, worst first in each summary).

## Part A: v2-core (2d7feab)

### A.1 Where money exists

| What | Store | Verdict |
|---|---|---|
| Chips bank | ledger `bank:<key>` (chips) | OK |
| Play $ wallet | ledger `play:<key>` (play) | OK |
| A seat's stack plus what it has put into the live hand | ledger `seat:<tableId>:<key>` (table currency); `seat.stack` in memory is a copy, compared only under RIG (`money-port.js` `drift`) | OK |
| A hand's pot while the hand is live | the chips stay in the seat accounts; who has committed what is engine memory (`hand.seats[s].committed`); `pot:<tableId>:<handNo>` holds chips only inside the settle batch | OK by rule: the chips are ledger balances, only the claim on them is in memory, and the crash outcome is written down (the hand never happened) |
| Cross-currency seat funding in transit | ledger `fx:chips` / `fx:play` (always sum to 0 across the pair) | OK |
| Old name-keyed bank rows with no account | ledger `orphan:<name>` | OK |
| The stake of a Bender spin between `spend` and `credit` | **memory**: `parked` map in `transport/wallet-adapter.js:27`, written to the ledger with the win as one batch, or alone at the end of the tick | **NOT (A1)**: harmless for Bender (same synchronous handler), fatal for any game that keeps a round open across messages |
| Daily-bonus "claimed today" flag and streak | `accounts.json` (`rec.bonus`, saved 50 ms later, `accounts.js:64`) | **NOT (A2)**: the gate of a mint lives outside the ledger |
| Achievement "unlocked" flags | `accounts.json` (`rec.achv.u`), same 50 ms save | **NOT (A3)**: same |
| Top-up cooldown and eligibility | derived from the ledger (`service.js` `topUpEligible`) | OK |
| `bank.json`, `wallet.json` | write-only mirrors of the ledger, rewritten within 250 ms (`transport/boot.js` `startMirror`) | OK (not money; never read back) |
| Old hand log `ledger.json` (`balanceAfter`, deltas per row) | its own file (`ledger.js`), feeds the bank screen and the night settle-up view | **NOT (A7)**, display only: a second set of money-shaped numbers that can disagree with the ledger |
| Bender round history, `bigwins.json`, XP and stats | memory / own files | not money |
| `tables.json` | settings and night markers (`registry.js:16` `PERSIST`); no stacks | not money |

### A.2 Every movement

| Movement | Writes, in order | Atomic | Crash between steps | Resend of the same message | Verdict |
|---|---|---|---|---|---|
| Signup mint | two transfers `signup:bank:<key>`, `signup:play:<key>` (`service.js:84`) | each yes; the pair no | boot calls `ensureAccount` for every account and completes it | dup by ref | OK (A6, cosmetic: two lines for one event) |
| Migration from the old files | one transfer per row, refs `mig:*` | per row | next boot completes, dup by ref | dup | OK |
| Buy-in, rebuy | one transfer, or one fx batch; ledger first, then the seat in memory (`table.js:169`, `:203`) | yes | money in the seat account with no seat in memory: boot returns it | new server-made ref each time; a second join is refused because the seat exists, not by ref | OK |
| Leave, kick, grace timeout, sweep after the hand | one transfer or fx batch each, stack only; committed chips stay until the hand batch (`hand-flow.js:206`) | yes | boot returns the seat | amount 0 is a no-op; otherwise state-guarded | OK |
| End night | one cash-out per seat (`hand-flow.js:321`), N lines | each yes; the night no | boot returns the seats not yet cashed out | state-guarded | OK (same result either way) |
| Hand settle | ONE batch `hand:<tableId>:<handNo>`: every seat -> pot, pot -> seats; refuses to write unless committed = payouts + returned (`service.js:122`) | yes | before the line: hand void, nothing moved. After: result stands | dup by ref | OK |
| Hand void (error, shutdown, kill) | nothing | - | - | - | OK |
| Boot recovery | one line per non-zero seat `boot:<bootId>:<account>`; stray pots refunded pro rata and logged | each yes | the next boot takes the seats still non-zero | by balance | OK |
| Bender spin | adapter parks the cost in memory, then ONE batch `bender:<key>:<roundId>` (cost leg, win leg) (`wallet-adapter.js:82`) | yes | before the line: nothing happened; after: stands. The client may never see the result of a round that stands (history is memory only) | `roundId` is random per message: a resend is a new spin (rate limit 150 ms) | OK, with A1 and A5 |
| Bender spin when the ledger write fails | `credit` throws, `bender.js:91` swallows it and still emits the result with `totalWin`; the parked cost is then written alone at the end of the tick if the ledger works again | - | - | - | **NOT (A5)**: the client is told a win the ledger did not pay, and can be charged the stake without the win |
| Daily bonus | flag in `accounts.json` (memory now, disk in 50 ms), then mint `bonus:<key>:<day>` (`social.js:233-240`) | no: two stores | mint durable, flag lost: the next claim answers dup at the ledger, but the adapter ignores `dup` (`wallet-adapter.js:72`) and the client is told it was paid again | paid once (ref = the day) | **NOT (A2)**: never pays twice, but tells the player it did |
| Achievement reward | flag in `accounts.json`, then mint `achv:<key>:<id>` (`social.js:141-142`) | no: two stores | as above: unlocked twice on screen, paid once; XP added twice | paid once | **NOT (A3)** |
| Top-up | one transfer `topup:<key>:<bootTag>.<n>` | yes | - | ref is new each time, but eligibility comes from the ledger (under 100.00 and one hour since the last top-up line): the resend is refused | OK |
| Admin adjust (signed delta) | one transfer `adj:<key>:<bootTag>.<n>` (`admin/index.js:20`) | yes | - | **applied again**: nothing ties two sends of one admin action together | **NOT (A4)** |
| Admin "set Play $ to X" | reads the balance, writes the delta, same synchronous block | yes | - | second send is a no-op (already X) | OK |
| Bender live config change | no money; rounds are instant, none is open | - | - | - | OK |
| Shutdown | adapter flush, mirror write, no cash-outs | - | - | - | OK |

### A.3 Not a ledger balance or not one atomic batch (v2-core): 7

1. **A1 stake parked in memory** (`wallet-adapter.js:27-62`). The contract of `ctx.wallet` is "spend then credit in one synchronous handler"; a parked cost with no credit is taken as a loss at the end of the tick. Bender fits. The slot does not: an open bonus round would lose its stake to the house one tick after the spin, and a refund would be refused (`flushed`). This is the reason the slot cannot just be merged.
2. **A5 result emitted without a ledger line** (`games/bender.js:90-91`). Only when the ledger refuses the write (disk, fence). Told is not paid.
3. **A4 admin adjust is not idempotent** on a resend. Admin only, but it is the one place a double click mints or burns.
4. **A2 daily bonus gate in `accounts.json`**. Paid once (ledger ref), shown twice after a crash inside 50 ms. The gate should be `ledger.has('bonus:<key>:<day>')`.
5. **A3 achievement gate in `accounts.json`**. Same shape.
6. **A7 old hand log holds its own balance numbers** for the bank screen. Display only.
7. **A6 signup is two lines**. Cosmetic.

Nothing in Part A loses or doubles money in a crash. The poker side (seats, hands, buy-ins, cash-outs, boot) is all ledger balances and single atomic writes.

## Part B: the slot COLD CALL (`coldcall-pull` fb4f644, old master money)

Full line-by-line audit (every claim with file:line, written by a Sonnet auditor, spot-checked by the lead against `games/coldcall.js` and `games/coldcall-store.js`): `P6-MONEY-AUDIT-COLDCALL.md`. Nothing was run. Summary:

### B.1 Where money exists

| What | Store | Verdict |
|---|---|---|
| Play $ balance | `wallet.json` (old `wallet.js`, saved 50 ms later, write errors swallowed) | NOT a ledger balance (the whole branch predates the ledger) |
| Chips balance | `bank.json` via `adjustBank` (clamps at 0, written at once) | NOT |
| The stake of an open round | gone from the balance at the spin; remembered as `cost` in memory and in the open record in `coldcall-pull.json` | **NOT (B1)**: no hold, no escrow |
| The win a player is looking at while a decision is open (the bank at ONE MORE CALL) | nowhere: recomputed from a tape that is in memory only | **NOT (B7)** |
| The office pot (`bal`, `fed`, `seeded`, `paid`, `rem`), one per currency | `coldcall-pull.json` | **NOT (B3, B6)**: a number in a game file |
| Leads, the Callback (`cb.bet`, a free round worth that many cents of stake), its remainder (`carry`) | `coldcall-pull.json` player state | not money by the contract (they only become money as a later round's win), but they are worth cents and sit in one unprotected file (B8) |
| Statistics, feed, history, live config | own files / memory | not money |

### B.2 Every movement (all of them are more than one write, in two files)

| Movement | Writes in order | Crash between steps |
|---|---|---|
| Base spin or bought bonus, no decision | wallet spend -> pot numbers -> player state -> wallet credit; `wallet.json` and `coldcall-pull.json` saved by two separate 50 ms timers | either file can land alone: a consumed Callback plays again, or the stake and the win are lost (B9) |
| Spin whose bonus opens a decision | wallet spend -> open record -> wallet flush -> store flush | after the wallet flush, before the store flush: stake taken, no record, no refund ever (B1) |
| Decision message (PICK, ONE MORE CALL) | no money; the record's rounding draws are rewritten | - |
| Settle of an open round (decision, 20 s timeout, disconnect) | record deleted + pot + state, flushed -> win credit -> prize credit -> wallet flush | after the store flush, before the credit: stake and win lost (B2). A credit that throws is logged and swallowed (B10) |
| Pot feed | 1% of the cost, booked at settle; no balance moves, the cost was already gone | the pot's `fed + seeded = paid + bal` is checked nowhere at run time (B6) |
| Pot prize | pot file says paid, flushed -> prize credit | prize destroyed, the pot's books still "balance" (B3) |
| Void (four reasons) and restart refund | record deleted and flushed -> refund credit -> wallet flush (restart: after the whole loop) | refund lost (B4) |
| Callback round | no spend; state loses the Callback; win credited | state saved without the win: the free round is lost; win saved without the state: it plays again |
| Top-up, admin set | SET the balance, no ref, no row, allowed while a round is open | - (B11) |
| Live config change with a round open | no money; the open round keeps its whole snapshot | OK as designed |

No movement has an idempotency key: `wallet.js` ignores the ref it is given, and crediting the same ref twice pays twice (B13).

### B.3 Not a ledger balance or not one atomic batch (slot): 16, worst first

1. **B1** open round: stake in one file, record in another, flushed one after the other. A crash between keeps the stake with no refund.
2. **B2** settle of an open round drops the record before the win is credited. A crash between, or a swallowed credit error, costs the player stake and win.
3. **B3** pot prize: the pot says "paid" before the winner is credited.
4. **B4** void and restart refund delete the record first and credit second.
5. **B5** a damaged `coldcall-pull.json` empties every pot, every player's leads and Callback and every open record: open stakes are never refunded.
6. **B6** the pot is a number in a game file; its 1% never leaves any balance; its own invariant is never checked at run time.
7. **B7** the win on screen during a decision exists only in memory. A restart (every deploy) gives the stake back, not the win shown: a player looking at a 200x bonus gets 1x.
8. **B8** leads, Callback and remainder are worth cents and live only in that file; a damaged field resets them with no trace.
9. **B9** instant rounds write wallet and state through two separate timers; a crash inside 50 ms can replay a consumed Callback or lose a win.
10. **B10** win and prize are two credit calls; a throw in either is swallowed after the pot and the state have advanced.
11. **B11** top-up and admin set overwrite the balance: no ref, no row.
12. **B12** per-game statistics count refunds and pot prizes as wins.
13. **B13** no idempotency anywhere.
14. **B14** both writers swallow write errors: memory runs ahead of disk silently.
15. **B15** chips and Play $ go through two different stores with different guarantees.
16. **B16** live config (prices, pot cap, feed rate) is outside any balance and moves the house's exposure at once for the next round. Fine as a design; listed for completeness.

What the slot's tests pin that wave 2 must change on purpose (they assert the OLD two-file order): `tests/coldcall-pull-server.js` F9d (:745-754, "the pot file shows `paid` before the prize credit"), the checks that read `wallet.json` / `coldcall-pull.json` from disk (:111-113, :332-340, :1072-1081), the stats assertions in `tests/coldcall.js:201-231`, and about 100 direct `wallet.spend|credit|get|adminSet` calls across the three slot test files, all built on the old `createWallet`. The engine digests and the engine byte-sync test do not depend on wallet order.

Other slot branches (read only, by path): `coldcall-w3` b3d9d74 touches `games/coldcall.js` +11/-1 outside the money path (a `Watch.offer` after settle, two handlers); `coldcall-fb1` 493e6d1 touches no server money file; `coldcall-pull` has no uncommitted change to money files.

## Part C: scale (measured, `_scratch/p6/scale/replay.js`, this box)

The ledger keeps every line and every ref (with its full signature string) in memory and replays the whole file at boot. One slot round is one line.

| Lines | File | Cold open (boot replay) | RSS after open | One `entries()` scan (run on every buy-in and cash-out by `seatFund`) |
|---|---|---|---|---|
| 100,000 | 26 MB (276 bytes per round) | 1.0 s | 259 MB | 35 ms |
| 500,000 | 132 MB | 5.3 s | 957 MB | 118 ms |

Poker alone writes a few hundred lines a night. A slot writes one per spin: five players at one spin every 2.5 s for four hours is about 29,000 lines a night, so the file passes 500,000 lines in under three weeks of nightly play and the server needs about 1 GB just to boot. **S1: the ledger needs checkpoints before the slot goes live** (rotate the file at N lines; the new file starts with one checkpoint line holding every balance and the set of refs as short hashes; old segments are kept as archives, never replayed; `seatFund`, `lastHandNo`, `buyInCount` and the top-up index become maintained indexes instead of scans). This is the one piece of "scalable architecture" the money core is missing; the account scheme and the batch kinds do not need to change for it.

## Totals

- Part A (v2-core): 7 findings, 0 that lose or double money in a crash.
- Part B (slot): 16 findings, 5 that lose a player's stake, win, prize or refund in a crash (B1-B5), 0 that pay twice.
- Part C: 1 scale finding (S1).
