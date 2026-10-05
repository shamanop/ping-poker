# Adding a game to The Ping

A game = one server module + one client `registerGame` file. Nothing else changes.

## Server (games/<id>.js)
1. Create `games/<id>.js` exporting `{ id, name, kind: 'solo'|'table', init(ctx), handlers, onDisconnect? }`.
2. `handlers` is `{ event: (socket, payload, ctx) => ... }`. `games/index.js` registers each as `g:<id>:<event>`
   and rejects unsigned sockets with `error {code:'auth'}` before your handler runs. `this` is your module.
3. Add `'./<id>.js'` to the `MODULES` list in `games/index.js`.
4. `ctx` = `{io, rooms, ledger, accounts, tables, now, wallet, rng}`. Account key: `socket.data.acct.key`.

## Money (always through ctx.wallet, integer cents only)
- `wallet.spend(key, mode, cents, {game:'<id>', round})` throws `code` = `funds` | `limit` | `amount` | `mode`.
- `wallet.credit(key, mode, cents, ref)` pays out; `wallet.get(key)` -> `{play, ledgerNet, ledgerLimit}`.
- `mode` is `'play'` (fake Play $) or `'ledger'` (friendly IOU tally; never real deposits or payouts).
- Wallet changes auto-push a single `wallet` event to every socket of the account.
- Pass `game` in `ref` and per-game stats (`rounds, wagered, won`) are kept per mode.
- Resolve the round first (pure function, injected `ctx.rng`), then spend, then credit, all in one
  synchronous handler so concurrent requests cannot interleave. Never trust amounts from the client.

## Rules of thumb
- Rate-limit spam-able events per socket (see `RATE_MS` in `games/bender.js`).
- Validate every payload field against a fixed allow-list (bet levels, modes).
- Keep math in `games/<id>-engine.js`, plus a `games/<id>-sim.js` that prints RTP and a test in `tests/<id>.js`.

## Client (public/games/<id>/...)
```js
Shell.registerGame({ id: '<id>', name: 'My Game', icon: '...', mount(el, ctx) {}, onFocus() {}, onBlur() {}, badge() { return ''; } });
```
The shell owns the socket: forward `g:<id>:*` events and show `wallet` pushes. Test: `node tests/<id>.js`.
