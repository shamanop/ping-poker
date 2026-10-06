# tables/ + transport/ progress (builder P3, branch v2-tables, worktree wt-tables)

## HAND-OFF (top block, keep current)
- Committed: steps 0-5 on v2-tables (git log -1). v2-core 0245430 merged (houseRound + engine E1).
- Done: tables/{settings,money-port,table,hand-flow,registry,viewlog}.js. Step 5 added registry.js (create/load/save/lobby/nights/sweep/voidAll/pauseAll) and viewlog.js (old-ledger presentation rows + legacy room view for social.onHandEnd / accounts.recordHand/recordNight).
- Last proof: `node tests/v2-unit/run-tables.js` -> tables total 114/114 in 6 files (settings 24, money-port 20, seats 23, hands 28, registry 14, viewlog 5). Not re-run since the E1 merge: run-engine.js, run-money.js (lead reports 96/96 and 90/90 at 0245430; I re-ran money 90/90 before the E1 merge).
- Open: steps 6-9.
- Next: step 6 transport + boot. Order: (1) transport/wallet-adapter.js (houseRound plan below) (2) transport/views.js (payloads; 30_shapes judges it; read tests/v2/shapes/9440541.json first) (3) transport/safe.js (4) auth/index.js + admin/index.js (5) transport/handlers/* (copy event semantics from the OLD server.js/tables.js `register(socket...)` blocks: tables.js:338-563 holds table_* handlers, server.js holds the rest) (6) transport/rig.js (`__rig` -> `deckSource` queue, `__audit` using table.auditSeats() + money-port.drift) (7) thin server.js (boot order contract section 9) (8) boot by hand, `node tests/v2/30_shapes.js --target <worktree>`.
- Wiring facts: `createMoneyPort({service, ledger, bootId, afterWrite(keys), onFence(err), onWrite(w)})`: afterWrite -> transport pushMoney/pushWallet/bank_summary, onFence -> registry.pauseAll() + log MONEY FENCED, onWrite -> viewlog.onWrite. `createRegistry({money, service, ledger, clock, file, out (transport out {state(t), event(t, kind, data, toKey)}), onLobby, onError(err, where), rng, deckSource, constants, viewlog, hooks:{profileOf(key)->{display,avatar,pic}, isAdmin, settlePayments}})`; registry.out wraps transport out and feeds viewlog + save + lobby push. `createViewlog({presLedger (old ledger.js instance), accounts, social, bankOf(key), profileOf, nightNets: t => registry.nightOf(t)})`.
- Table out kinds (transport maps to wire names): joined{key,seat,stack,reconnect}, rebuy, left{key,cashedOut,reason,pendingHand?}, room, money{keys}, table_event{kind:paused|resumed|kicked|host|...}, taken_over{socketId}, blinds_up, hand_start, hand_end{hand,result,bySeat}, bust{key,seat}, void{reason}, night_end{reason,keys}. out.state(table) = push game_state. Table needs from transport: tick wrapper (`onTimer`), `onError(err, where)` = void + log (transport/safe.js), table.void(reason, err) returns true/false.
- Table API summary: sit(key,{amount,fund,seat,socketId}) (a held seat = rebind), rebuy(key,{amount,fund}), sitOut(key), leave(key,kind), kick(by,target,isAdmin), disconnect(socketId), act(key,{type,to}), preselect(key,mode,amount), pause(), resume(), startHand(), endNight(reason) -> true|'pending', transferHost(), checkAutostart(), auditSeats(), players() (dense, ascending), denseIndex(key), blindLevel(), lastResult (4.6 object + .history), history (10), log (30).
- Wallet adapter plan (houseRound, lead 03:45 and 03:50): games call `wallet.spend(key, mode, cost, {game, round})` then `wallet.credit(key, mode, win, {game, round})`, unchanged. `spend` checks the balance only (throw code 'funds' if short, 'amount' for bad_amount) and parks {key, mode, cost} under `<game>:<key>:<round>`; `credit` with the same ref pops it and calls ONE `service.houseRound(game, key, cost, win, cur, '<game>:<key>:<round>')`; a parked spend with no credit by the end of the tick is flushed as houseRound(cost, 0); `wallet.get` subtracts parked costs; non-round credits (achv, bonus, game 'achv'/'bonus') stay houseCredit/mint per contract section 7. After every write call onChange(key) (games.pushWallet + views.pushMoney). Tests: crash between spend and credit leaves the ledger unchanged, same ref twice answers dup, funds error writes nothing.
- Guesses/deviations so far: (a) night payload `rebuys` is always 0 and `buyIns` is the total of all buy-ins (the money ledger does not separate them); (b) viewlog also writes presentation rows for Play $ tables (old code kept them in memory only), tagged mode 'cents' and nightId; (c) `mineFor` hides POKERPING unless seated (old LEGACY behaviour); (d) the registry persists `blinds` as the base blinds, `pendingBlinds` is not persisted; (e) bust `rebuy` payload and game_state `legalActions` are built in views (step 6), not in the Table.
- Gotchas: seat.stack is the HAND-START stack while a hand is live (engine stack: hand.seats[n].stack; copied at the commit). A settle failure before the commit voids then rethrows; deadline errors go to onError. actionTimerSec 0 = no clock for a connected seat; a disconnected seat on turn uses TURN_MS (30 s). Grace expiry mid-hand retries every 5 s. Table creation: `rec.seats` is the seat COUNT (kept as table.maxSeats), `table.seats` is a Map. Engine hand names are 'Pair', 'Two Pair', etc. Exec calls over ~60 s need setsid nohup; hands/registry/viewlog unit tests take about 5 s together.
- Context note: this builder session stopped after step 5 at about the 150K cap; step 6 should start from a FRESH session reading this block.

## Status
| Step | What | State |
|---|---|---|
| 0 | setup, baseline | done (baseline = tests/v2/results/old-suite-baseline.txt, harness builder: all old suites pass on 9440541 except preselect (5 FAIL lines) and migrate (fails only when accounts.json is left in repo root)) |
| 1 | tables/settings.js | done (24 tests) |
| 2 | tables/money-port.js | done (20 tests), not yet reviewed by lead |
| 3 | tables/table.js seats | done (23 tests in tables-seats.js) |
| 4 | hand lifecycle | done (28 tests in tables-hands.js) |
| 5 | registry + viewlog | done (14 + 5 tests) |
| 6 | transport + boot | todo |
| 7 | harness slices | todo |
| 8 | whole run | todo |
| 9 | old suites + cleanup | todo |

## houseRound in the wallet adapter (lead, 03:5x; v2-core 819f9db merged into v2-tables at 61d3e3a)
- Merged v2-core into v2-tables; money 90/90, tables 44/44 after the merge.
- games/bender.js:90-91 (and coldcall.js:76-77 on the coldcall branch) call `wallet.spend(key, mode, cost, {game, round})` then `wallet.credit(key, mode, totalWin, {game, round})` and stay unchanged. The adapter (transport/wallet-adapter.js, step 6) therefore: `spend` checks the balance only (throws `funds` if short), parks `{key, mode, cost}` under `<game>:<key>:<round>` and writes nothing; `credit` with the same ref pops it and makes ONE `service.houseRound(game, key, cost, win, cur, '<game>:<key>:<round>')`. A spend with no credit by the end of the tick is flushed as houseRound(cost, 0) so a stake is never silently dropped. `wallet.get` subtracts parked costs. credit(win 0) is spend only, so no special case. Non-round credits (achv, bonus) stay houseCredit.
- Not built yet; step 6 builds it and tests: crash between spend and credit leaves the ledger unchanged, retry with the same ref answers dup, funds error leaves nothing written.

## Notes from server.js / tables.js (reading)

## Where the contract was wrong

## Harness vs contract

## Not verified

## Guesses
