# THE PING - OVERNIGHT SPEC (accounts, tables, bank, $ display, lobby)

Scratch build only: /home/isabelle/.openclaw/workspace/the-ping-build. The live game and ../ping-poker are never touched. Nothing deploys until the table is empty and Chris approves. Dark basement look is locked. Desktop-first (1440x900, 1920x1080).

## 0. Current architecture (as read 2026-10-05)

- server.js (1259 lines): express + socket.io. ONE hard-coded room: `ROOM_ID='POKERPING'`, `ROOM_PASSWORD='ping'`, max 8 seats, `STARTING_CHIPS=1500`, `BANK_DEFAULT=10000`, `SMALL_BLIND/BIG_BLIND=10/20`, `TURN_MS=30000`, `BLIND_SCHEDULE` (8 levels 10/20..200/400), `AUTO_START_MS=2000`.
- `rooms = new Map()`; `makeRoom(id, hostSocketId)` builds `{players[], status, sb, bb, blindIntervalMs, blindsEnabled, lastStacks{}, handNum, pot, ...}`. Player seat = `{name, avatar, socketId, connected, chips, chipsBought, cards, sittingOut, isBot, ...}`.
- Identity today = a typed name. `cleanNameOf(name)` + `bankKey(name)` (lowercase) are the only identity. No auth. Rejoin with same name reclaims the seat (join_game, ~L975-1000).
- Socket handlers use `on(ev, fn)` wrapper (L892, catches errors, emits `error {message}`): `check_balance, get_bank_summary, bank_set (Chris only), show_cards, get_leaderboard, join_game {name,avatar,profilePic,password}, start_game {roomId,blindInterval}, create_demo, player_action {roomId,action,amount}, preselect, rebuy {roomId}, drop_sticker, throw_item, chat_message, sit_out`, plus `disconnect`.
- Server->client: `room_joined {roomId, playerIdx, balance}`, `room_update`, `game_state` (publicGameState), `your_cards`, `showdown_result`, `bust_out {balance}`, `balance_data {balance}`, `bank_summary`, `leaderboard_data`, `blinds_up {level,sb,bb}`, `cards_shown`, `error {message}`.
- Money today: `bank.json` = flat `{ "<lowercasename>": <int chips> }` (BANK_FILE env override). Joining debits `bank[k]` for the buy-in (`min(lastStack>=BB ? lastStack : 1500, bank)`); busting returns remaining stack on cash-out; `rebuy` debits the bank again. `getBalance(name)` reads it. Integer chips everywhere; `Math.round` used client-side.
- ledger.js (133 lines): `createLedger({file,onWrite})` -> `{log, seedBank, startHand, endHand, summary, entries}`. `ledger.json` = array of `{t, name, type, amount, balanceAfter, tableChips, handNum, room...}`; atomic write via tmp+rename; `log(type,name,amount,balanceAfter,tableChips,handNum,room)` is positional. Existing types seen in server.js: `adjust` (bank_set), `bank-start` (seedBank), plus `cashout` (special-cased in log()). `summary(roomId, bank, live)` powers the Bank panel (`players[]` with bank/atTable/net/biggestWin/status, `maxHand`).
- Client: public/game.js (1753 lines) owns landing->game flow; landing (`#landing-screen`, name + avatar grid `AV_EMOJI[12]` -> files `images/avatars/a01..a12.png`, `AV_FILES`), game (`#game-screen`). Scripts load order: socket.io, sound.js, game.js?v=24, bank.js?v=2. bank.js is a self-mounting slide-over (`#bank-btn`, `#bank-panel`) using its own `fmt = Math.round(n).toLocaleString('en-US')` and `signed()`.
- Number-render sites in game.js today (all raw `.toLocaleString()`): see section D for the full list.
- Tests: `npm test` = preselect, allin, mp, rejoin, bankedit, labels.test, clientlabels.test (node scripts, spawn server with env overrides). PRESELECT.md documents the pre-select protocol (untouched by this work).

## Key design decisions (read first)

1. **Base unit**: the server game engine keeps working in integers called *units*. Table `unit` is `'cents'` (Friends $) or `'chips'` (Chips). Engine code does not change; only blinds/buy-in/stack values given to it change magnitude. $25 buy-in = 2500 units.
2. **Friends $ mode has NO bankroll gate.** Buy-ins are IOUs recorded in the ledger; account net can go negative (that is the point: who is up/down). Chips mode keeps the legacy `bank.json` balance (debit on buy-in, credit on cash-out) exactly as today. (Chris may not like: friends mode can't "run out of money", only the per-table min/max buy-in limits it.)
3. **Display toggle is a viewer preference, independent of table mode.** `$` view of a chips table: 1 chip = $1. Chips view of a friends table: 1 chip = 1 cent (so $100 = 10,000 chips; fine, toggle is for taste). Default view per table: `$` for Friends, `chips` for Chips tables, until the user clicks the toggle.
4. The legacy single room `POKERPING` (password `ping`) becomes a permanent Chips-mode table "The Ping" listed in the lobby so nothing existing breaks; `join_game` stays working for it (legacy path) until S confirms all tests pass on the new path, then it is kept as a thin alias.
5. Accounts: username + PIN, case-insensitive key, no email, no real payments.

## A. Accounts

### A1. accounts.json (file: `ACCOUNTS_FILE` env, default `./accounts.json`; atomic tmp+rename like ledger.js, written via `accounts.js` `save()` debounced 50ms, sync on shutdown)

```json
{
  "version": 1,
  "accounts": {
    "chris": {
      "id": "a_3f9c2b1e",
      "key": "chris",
      "display": "Chris",
      "avatar": "a03",
      "kdf": { "alg": "scrypt", "N": 16384, "r": 8, "p": 1, "len": 32 },
      "salt": "<hex 16 bytes>",
      "pinHash": "<hex 32 bytes>",
      "claimed": true,
      "isAdmin": true,
      "createdAt": 1790000000000,
      "lastLoginAt": 1790000000000,
      "prefs": { "currency": "auto", "sound": true },
      "stats": { "hands": 0, "handsWon": 0, "netCents": 0, "netChips": 0, "biggestPot": 0, "nights": 0, "bestNightCents": 0 },
      "sessions": [ { "h": "<sha256 hex of token>", "created": 0, "lastSeen": 0, "ua": "short" } ],
      "legacy": { "bankKey": "chris" }
    }
  }
}
```
- Key = `String(name).trim().toLowerCase()`; names 2-16 chars, `^[A-Za-z0-9 _.\-']+$`, collapsed inner spaces. `display` = casing from FIRST signup (never overwritten; a later "CHRIS" signup/login just resolves to key `chris`). `isAdmin` true for key `chris` (replaces the hard-coded `bankKey(me.name)==='chris'` check in `bank_set`).
- `avatar` = file id `a01`..`a12` (the existing set; `AV_EMOJI[i]` <-> `a{i+1}`). Validate `/^a(0[1-9]|1[0-2])$/`. Legacy emoji from join_game map by index.
- PIN: 4-6 digits, `^\d{4,6}$`. `crypto.scryptSync(pin, salt, 32, {N:16384,r:8,p:1})`, compare with `timingSafeEqual`. New 16-byte random salt per account, per PIN change. Never log PINs or hashes; never send them to clients.
- Sessions: 32 random bytes hex token returned once; server stores only sha256. TTL 90 days sliding (`lastSeen` bump on resume), max 5 sessions per account (oldest dropped). Client stores `localStorage['ping.session'] = {key, token}`.
- Rate limit (in-memory, `accounts.js`): failures counted per `ip|key` AND per `key`. 5 failures -> lockout 30s, doubling each further failure, cap 15 min; success resets. Reply `auth_error {code:'rate_limited', retryMs}`. Signup limited to 5 per IP per hour. Constant-time-ish: unknown user still runs one scrypt against a dummy salt so timing does not reveal existence.
- Stats updated by server only: on `endHand` (hands, handsWon, biggestPot), on settle (net*, nights, bestNightCents). `net*` is lifetime from ledger; recomputable (`accounts.rebuildStats(ledger.entries())` on boot if `stats` missing).

### A2. Flows
- **Sign up**: `auth_signup {name, pin, avatar}` -> `auth_ok` | `auth_error {code:'name_taken'|'bad_name'|'bad_pin'|'rate_limited'|'claim_required'}`. If the key matches an UNCLAIMED legacy account (A3), reply `auth_error {code:'claim_required'}`, client re-sends `auth_claim`.
- **Log in**: `auth_login {name, pin}` -> `auth_ok {account, token}`. **Resume**: `auth_resume {key, token}` -> `auth_ok {account}` (no new token) | `auth_error {code:'bad_session'}` (client wipes localStorage, shows sign-in). **Logout**: `auth_logout {}` drops this session.
- Socket binding: on `auth_ok` the server sets `socket.data.acct = accountKey`. EVERY new protocol handler (section F) requires `socket.data.acct` or replies `error {message:'Sign in first'}`. Legacy `join_game` is left unauthenticated only for the legacy room and is removed in phase 2.
- **Profile**: `profile_get {key?}` -> `profile {display, avatar, stats, netCents, netChips, recent:[last 20 settled nights], prefs}`; `profile_update {avatar?, prefs?}` -> `profile`. PIN change: `pin_change {oldPin,newPin}` -> `ok`/`auth_error`. Admin only: `account_reset_pin {key, newPin}` (Chris resets forgotten PINs; all sessions revoked).
- Changing display casing is not allowed (case-insensitive identity stays stable).

### A3. Migration (runs once at boot in `accounts.js` `migrateLegacy({bank, ledgerEntries})` when accounts.json is absent or `version` < 1; idempotent)
1. Gather names from `bank.json` keys (already lowercase) and `ledger.json` entry `.name` values. Group case-insensitively. `display` = casing of the earliest-timestamped ledger entry for that key (fallback: Capitalize bank key). Skip bots/`testplayer`-style names matching `/^(bot|demo|test)/i`.
2. Create each as `{claimed:false, pinHash:null, salt:null, avatar:'a01', legacy:{bankKey}}`. Merge duplicates ("Chris"/"chris"/"CHRIS") into one key; sum nothing (bank.json is already keyed lowercase and is the source of truth for the chips balance).
3. Claim: the first `auth_claim {name, pin, avatar, roomPassword}` for an unclaimed key sets the PIN (and flips `claimed:true`) if `roomPassword === 'ping'` (the old table password proves "I'm one of the friends"). The claimant inherits that key's existing ledger history and bank balance automatically because both are keyed by lowercase name. Key `chris`: Isabelle/Hugo give Chris a one-time claim at first run; admin can `account_reset_pin` afterwards.
4. Unclaimed accounts appear in the Bank panel and Leaderboard exactly as today (ledger/bank unaffected).
5. Write migration summary to stdout (`migrated N accounts, merged M duplicates`). Before the first run that touches the new code, copy `bank.json` -> `bank.json.bak-<ts>` and `ledger.json` -> `ledger.json.bak-<ts>` ONCE (S does this in `server.js` boot, guarded by existence check).

## B. Create Table / game setup BEFORE joining

### B1. Table settings object (server `tables.js`, validated server-side; client form mirrors limits)
```js
{
  id: 'K7QF2M',                // 6 chars from A-Z minus I,O + 2-9 minus 0,1; = invite code
  name: 'Friday Night',        // 2-24 chars
  mode: 'friends' | 'chips',   // friends -> unit 'cents'; chips -> unit 'chips'
  unit: 'cents' | 'chips',
  buyIn: { min, max, default },// units. Friends defaults 500..50000 (=$5..$500), default 10000 ($100). Chips defaults 500..5000, default 1500 (legacy)
  blinds: { sb, bb },          // units, chosen from presets below (or custom: bb>=2*sb... any ints, sb<bb, bb>=2)
  blindIncrease: { enabled, everyMin: 10|15|20|30, schedule: 'standard'|'turbo' }, // optional, default off
  seats: 2..9,                 // default 8 (legacy max 8; server MAX_SEATS raised to 9 - S checks seat layout code in game.js handles 9, else cap UI at 8 and note it)
  actionTimerSec: 15|30|45|60|0, // 0 = no timer (default 30 = TURN_MS)
  rebuys: true|false,          // default true
  rebuyLimit: 0,               // 0 = unlimited when rebuys true
  isPrivate: true,             // default true: not in lobby list, join by code/link only
  hostKey: 'chris',            // account key
  state: 'open'|'paused'|'ended',
  nightId: 'n_20261005_K7QF2M',// one per table lifetime; settle-up is per night
  createdAt
}
```
- Friends blind presets (units = cents; label shown with fmt): `$0.25/$0.50` (25/50), `$0.50/$1` (50/100), `$1/$2` (100/200), `$2/$5` (200/500), `$5/$10` (500/1000), `$25/$50` (2500/5000). Form shows a "suggested buy-in" hint = 100 big blinds (clamped into min..max) and warns (non-blocking) if min buy-in < 20 bb.
- Chips presets: `10/20, 25/50, 50/100, 100/200, 250/500`.
- Create form defaults: Friends, min $5 / max $500 / default $100, blinds `$0.50/$1`, seats 8, timer 30s, rebuys on, private on. Slider range is always $5-$500 for Friends (step $1 below $50, step $5 above; typed entry accepts any whole dollar or cents with 2 decimals).
- Blind-increase timer (optional): when enabled, server reuses the existing `blindIntervalMs`/`BLIND_SCHEDULE` machinery, but the schedule is generated from the table's starting blinds: levels multiply bb by [1,1.5,2.5,5,7.5,10,15,20] rounded to the nearest nice unit (round to nearest 5 units chips / 5 cents friends, never below +1 unit). `blinds_up` event unchanged.

### B2. Host controls (host = `hostKey`; admin Chris can also act on any table)
- `table_start {tableId}` (manual start; auto-start with 2 seated still works as today unless `autoStart:false`), `table_pause {tableId, paused}` (finish current hand, then hold; banner "Paused by <host>"), `table_kick {tableId, key}` (not mid-hand: marks seat for removal after the hand; stack cashes out to ledger first), `table_end_night {tableId}` (finish hand, cash out EVERY stack to ledger, state 'ended', emit `settle_up`), `table_update {tableId, patch}` (only while paused or between hands; allowed fields: name, blinds, actionTimerSec, rebuys, isPrivate, blindIncrease; NOT mode/buyIn limits once any hand dealt).
- Host leaving: host role passes to the longest-seated connected player; announced in table log. Table with 0 seated and no pending reconnect for 30 min is deleted (state 'ended', no settle needed if no buy-ins).

### B3. Join flow (client L, server S)
1. Lobby: `Join by code` input (6 chars, case-insensitive, strips spaces/dashes) or click a public table in the list; deep link `/?t=K7QF2M` (or `/t/K7QF2M`; server serves index.html for `/t/*`) pre-fills the code after sign-in.
2. `table_preview {code}` -> `table_info {table, seated:[{key,display,avatar,stack}], openSeats}` (read-only, shows name, mode, blinds, buy-in range, seats, timer, host, who is sitting). Error `error {message:'No table with that code'}`.
3. Join modal: buy-in picker (slider + typed field, clamped to min..max, default = `buyIn.default`; for Chips mode also clamped to bank balance; Friends shows "Your night so far: +$X / -$Y" from `tables_mine`). Button: "Sit down".
4. `table_join {tableId, buyIn, seat?}` -> `table_joined {tableId, playerIdx, stack, table, you:{key,display}}` (consumed by `PingGame.enter`, section F) | `error`. Same account re-sending `table_join` while already seated just rebinds the socket (same as legacy rejoin, keeps stack, no new buy-in).
5. Spectate (phase 2): `table_watch`.

## C. Bank / stack system

### C1. Rules
- All stored money is an integer in the table's unit: cents (Friends) or chips (Chips). No floats anywhere on server; client formatting divides by 100 only at render. Server rejects non-integers (`Number.isSafeInteger`) and amounts outside min/max.
- **Buy-in**: Friends -> append ledger `buyin` (+ unlimited, no balance check), seat stack = amount. Chips -> same plus `bank[key] -= amount` (reject if bank < amount; `error {message:'Not enough in your bank'}`).
- **Cash-out** (stand up, kicked, end night, disconnect-timeout, table deleted): ledger `cashout` with `amount = stack`; Chips mode also `bank[key] += stack`. Mid-hand stand-up: seat folds, cash-out after hand (existing `cashedDuring` logic in ledger.js is the model).
- **Bust**: stack hits 0 at hand end -> `bust_out {tableId, rebuy:{min,max,allowed}}` (extends existing `bust_out {balance}`; keep `balance` for chips). If `rebuys:true` client shows rebuy prompt with amount picker; `rebuy {roomId|tableId, amount}` (amount optional for legacy -> default). Ledger `rebuy`. `rebuys:false` -> seat becomes a spectator slot ("Stand up" / "Leave").
- **Per-night net** for an account = sum over the night of `cashout - buyin - rebuy` (the ledger is the only source). Chips-mode nights are tracked the same way (in chips) so settle-up works there too, but payments suggestion is shown only for Friends mode.
- Ledger stays append-only: corrections are new `adjust` rows (existing bank_set behavior); no entry is ever edited or deleted.

### C2. Ledger extension (ledger.js, backward compatible)
- Keep `log(type,name,amount,balanceAfter,tableChips,handNum,room)` positional signature working. Add optional 8th arg `meta` merged into the row: `{ mode:'cents'|'chips', tableId, nightId, key, rebuyNo }`. Rows without `mode` are legacy -> treated as `mode:'chips', tableId:'POKERPING'`.
- New types: `buyin`, `rebuy`, `cashout` (existing), `settle` (a recorded real-world payment `{from,to,amount}`; optional, marks "paid" in settle screen), `adjust` (existing). `summary()` ignores unknown types so the Bank panel keeps working.
- New exports: `nightSummary(nightId)` -> `{nightId, tableId, mode, unit, startedAt, endedAt, players:[{key,display,buyIns,rebuys,cashedOut,stack,net}], zeroSum:bool, payments:[{from,to,amount}]}`; `accountNet(key, {mode})`; `nightsFor(key, limit)`. `payments` from `settlePayments(nets)`: greedy min-transfer (sort creditors desc / debtors desc, match largest debtor to largest creditor; at most n-1 transfers); nets must sum to 0 (assert; if not, include `drift` units and attribute to "house rounding" line - should never happen).
- Live stacks at settle time: `table_end_night` cashes out first, so `nightSummary` is always computed from ledger rows only.
- Bank panel (bank.js) additions (M edits, S supplies data): in `bank_summary.players[]` add `netTonight`, and for Friends tables the panel header shows "Tonight" instead of "In bank"; `signed()` and `fmt()` route through money.js. `bank_set` (admin edit) keeps working in Chips mode; in Friends mode it is hidden (net is derived, edit via `adjust` only by admin through `table_adjust {tableId,key,amount,note}`).

### C3. Settle-up screen (client L, `settle_up` event)
- Server emits `settle_up {nightId, table:{name,mode,unit}, players:[{key,display,avatar,buyIns,rebuys,cashedOut,net}], payments:[{from,to,amount}], text}` to all seated + the host on `table_end_night`; also fetchable: `night_get {nightId}` -> same payload (history in profile).
- Screen: ranked list by net (green +, red -, using fmt signed), "How to settle" list ("Mike pays Chris $42.50"), `Copy as text` button (text = server-built, e.g. `The Ping - Friday Night - Oct 5\nChris +$85.00\nMike -$42.50 ...\nSettle: Mike -> Chris $42.50`), per-payment "Mark paid" -> `settle_mark {nightId, from, to, amount}` logs a `settle` row (purely cosmetic, never moves money). Footer buttons: "Back to lobby", "New table with same settings" (`table_clone`).

## D. Currency toggle + formatter

### D1. public/money.js (NEW, owner M) - classic script, exposes `window.Money`
```js
Money.fmt(units, opts?)  // -> string. opts: { mode:'usd'|'chips' (override), unit:'cents'|'chips' (override), signed:bool, compact:bool, symbol:bool(default true) }
Money.setMode('usd'|'chips'|'auto')  // 'auto' = follow table unit ($ for cents tables, chips for chips tables). Persists localStorage['ping.currency'] and calls Money.onSave callback (lobby posts profile_update {prefs:{currency}}).
Money.getMode()          // -> effective 'usd'|'chips' (resolves 'auto' via current unit); Money.getPref() -> raw 'usd'|'chips'|'auto'
Money.setUnit('cents'|'chips') // game/lobby set this when entering a table; default 'cents' in lobby
Money.onChange(fn)       // fn(effectiveMode) -> returns unsubscribe(); fired by setMode/setUnit; subscribers re-render
Money.parse(text, opts?) // user typed "12.5" / "$12.50" / "1,250" -> integer units (null if invalid); used by slider typed input, buy-in field
Money.toggleEl()         // returns a ready-made <button class="money-toggle"> ($ | chips segmented, aria-pressed) that stays in sync; mounted by L/M into [data-money-toggle] slots
```
Conversion table (the ONLY place it lives): unit 'cents' + view usd = units/100; cents + chips = units; unit 'chips' + view usd = units (1 chip = $1); chips + chips = units.
Formatting rules: usd -> `$` + grouped digits, cents shown only when `units % 100 !== 0` (`$1,250`, `$0.50`, `$12.35`, negative `-$3`, signed `+$85`); chips -> grouped integer, no symbol (`12,500`). `compact:true` (pots on felt, chip-stack labels) -> `$1.2K` / `12.5K` above 10,000 display units. All `en-US`. `fmt(NaN|undefined)` -> `'-'` never `NaN`.
Toggle placement: button in lobby topbar, in game top bar next to Bank button (slot `<span data-money-toggle>` added by L in index.html; M's `Money.toggleEl()` fills it). Style: M appends a delimited block `/* money-toggle */` at the end of public/bank.css (M owns bank.css) so both lobby and game get it; uses btn-brass/blue art only via existing tokens, no glow.
Persistence: `localStorage['ping.currency']` (instant, pre-login) and account `prefs.currency` (server, source of truth after sign-in; on `auth_ok` lobby calls `Money.setMode(account.prefs.currency)` without re-saving).

### D2. Every edit site (grep'd; M replaces each with `Money.fmt(...)`)
game.js `.toLocaleString()` lines (as of this commit): 440 (`bank-amount`), 627 (`bust-balance` "Bank N"), 633 (rebuy button label, also `Math.min(1500, balance)` default -> table.buyIn.default), 647 (`lb-balance` leaderboard), 803 (seat action text "Call N"), 807 ("Bet/Raise to N"), 944 (`seat-chips` stack), 1028 (pot text; also `chipStacksHtml(gs.pot,3,5)` denominations - see below), 1098 (`pl-tocall`), 1099 (`pl-minraise`), 1126 (call act-sub), 1151 (helper bar "Call N to win M"), 1180 (raise preset buttons `.pre` label/`b`), 1187-1188 (`tick-min`, `tick-max`), 1202 and 1206 (helper "N after call / raising to"), 1220 (`pre-call-sub`), 1251 and 1271 (`raise-sub` value), 1504 (floating `+N` win text), 1615-1619 (showdown amounts `+N`, `showdown-pot`). Also hidden numeric text: blinds label and `blinds_up` toast, buy-in text on landing, any `Blinds sb/bb` header in room_update handlers (M greps `sb`, `bb`, `blind` in game.js and converts). Slider math: `clampV = Math.round` stays (units are integers); slider `step` and preset rounding must be in units but "nice" for $: preset buttons round to nearest 25 units cents-mode / nearest 1 in chips (M adds `niceStep()` local to game.js).
- `chipStacksHtml(amount, ...)` (game.js ~706) and `.chip c{1,5,25,100,500}` art: denominations are currently chip values. In cents tables, denominations must scale by table bb: M changes it to `denomFor(unitValue)` = pick the 5 chip arts as multiples of `bb` (1bb, 5bb, 25bb, 100bb, 500bb... art labelled generically, no numerals on the chip art - M verifies the PNGs have no printed value; if they do, in `$` view overlay no text and accept mismatch).
bank.js: line 11 `fmt` and line 12 `signed` (replace bodies with `Money.fmt`/`Money.fmt(...,{signed:true})`, keep names so the ~15 call sites at 101-134 need no edits); 129-134 bank player cells; any `bank-total` card; and chart axis labels (grep `toLocaleString|toFixed` in bank.js - currently only fmt/signed). bank.js must `Money.onChange(() => rerender())`.
Also `public/index.html`: landing text mentioning "1500 chips"/"chips" (L rewrites that screen anyway).
Re-render on toggle: game.js already has a render function for state; M adds `Money.onChange(() => { if (state.gs) renderAll(); })` (M finds the actual render entrypoint names).

## E. Lobby UI (owner L; file public/lobby.js + public/lobby.css; one mount `<div id="lobby-root"></div>` in index.html)

All screens use the locked kit: `images/ui/room.jpg` backdrop (dimmed), `panel.png` cards (9-slice via border-image or background-size as bank.css already does - L reads bank.css for the technique), `plate.png` headers, `btn-brass.png` primary, `btn-blue.png` secondary, `topbar.png` bar, `bar-teak.png` rows/inputs. Typography = whatever style.css already uses (L reads `:root` tokens; no new fonts). No gradient pills, no neon glow, no emoji in UI chrome, avatars only from `images/avatars/a01-a12.png`. Spacing generous, 1440x900 first, scales to 1920x1080 using the existing `--u` unit trick in game.js (`document.documentElement.style --u`) - L reuses `--u` rather than inventing a new scale.

Screens (single-page state machine `Lobby.show(name)`, URL hash `#/signin #/lobby #/create #/t/CODE`):
1. **Sign in / landing** (`#/signin`): logo-lockup, two tabs "Sign in" / "New account". Name field, PIN field (4-6 digits, numeric keypad input type password, inputmode numeric), avatar grid (12) on signup only. Inline errors from `auth_error.code`; rate-limit shows countdown. "Resume" is silent (auto on load via stored session). Legacy-name notice: if `claim_required`, show "This name is already on the books - set a PIN to claim it" and a room-password field ("ping").
2. **Lobby** (`#/lobby`): topbar = logo, account chip (avatar + name + net: `+$85` in tonight/lifetime), money toggle slot, Sign out. Left: "Your tables" (tables I'm seated at or host, with Resume) + "Open tables" list (public tables: name, mode badge, blinds via fmt, seated n/seats, buy-in range). Right panel: "Join by code" input + button, big brass "Create table" button, mini leaderboard (top 5 lifetime net, from `leaderboard_data`) and profile link (modal: stats, recent nights, change avatar/PIN).
3. **Create table** (`#/create`): single form panel. Mode segmented (Friends $ | Chips), name, buy-in range (dual-handle slider + two typed fields + default), blinds preset buttons (+ custom), seats stepper 2-9, action timer segmented (15/30/45/60/Off), blind-increase toggle + interval, rebuys toggle, private toggle. Live summary card on the right ("8 seats, $0.50/$1, buy in $5-$500, 30s clock"). Submit -> `table_create` -> then straight to the share screen.
4. **Table created / share** (`#/t/CODE`): big code, `Copy link` (`location.origin + '/?t=' + code`), `Copy code`, host's own buy-in modal immediately (host also sits), `Start when ready` appears once 2 are seated. Shows who is seated live (`table_info` pushes via `table_event`).
5. **Join / buy-in modal**: as B3. Shows table settings card (read-only) + buy-in slider/typed + your night net + "Sit down".
6. **In-game**: existing `#game-screen`; L adds NOTHING inside it except a "Lobby" back button via the integration contract (F4). Host controls (start/pause/kick/end night) live in a small host drawer implemented by L as `public/lobby.js` module `HostDrawer` injecting a button into the game top bar slot `#host-slot` (L adds the slot to index.html game header; game.js untouched).
7. **Settle-up** (C3) and **Rebuy prompt** (existing `#bust` overlay in game.js is reused; M updates the amount picker via Money; L only provides the "table is out of rebuys" variant text through `PingGame` hook).

## F. File ownership and contracts

### F1. Ownership table (ZERO overlap)
| Worker | Owns (create/edit exclusively) | Never touches |
|---|---|---|
| S (server) | `accounts.js` NEW, `tables.js` NEW, `ledger.js` (extend), `server.js`, `package.json` (test chain only), `tests/accounts.js` NEW, `tests/tables.js` NEW, existing tests that need updating for the new protocol (`tests/mp.js`, `rejoin.js`, `bankedit.js`, `showbank.js`) | anything under `public/` |
| L (lobby client) | `public/lobby.js` NEW, `public/lobby.css` NEW, `public/index.html` (whole file: lobby mount, `#host-slot`, `[data-money-toggle]` slots, script tags), `tests/e2e/walk.py` NEW (Playwright) | `server.js`, `game.js`, `bank.*`, `style.css`, `money.js` |
| M (money) | `public/money.js` NEW, `public/game.js` (number sites + `PingGame` adapter, phase 1 only), `public/bank.js`, `public/bank.css`, `tests/money.test.js` NEW | `server.js`, `index.html`, `lobby.*`, `style.css` |
`public/style.css`, `sound.js`, `PRESELECT.md`, `tests/preselect.js`, `tests/allin.js`, `tests/labels.test.js`, `tests/clientlabels.test.js`: FROZEN for everyone (if a change is truly needed, report it to the lead; do not edit).
- game.js timing: M owns game.js for the whole night. L and S never edit it. If L needs game.js behavior, it is delivered ONLY through `window.PingGame` (F4) which M implements first (first ~30 min, before the number sweep) so L can code against it immediately.
- index.html timing: L owns it from start. Script order L must use: `socket.io.js`, `money.js?v=1`, `sound.js`, `game.js`, `bank.js`, `lobby.js?v=1`; css: existing + `bank.css` + `lobby.css`. M needs `[data-money-toggle]` slots in both topbars - L adds them in the first 10 min.
- `tests`: `package.json` `test` becomes existing chain + `node tests/accounts.js && node tests/tables.js && node tests/money.test.js` (S edits package.json; M and L just agree on those filenames). Playwright walk is NOT in `npm test` (needs a browser); run as `python3 tests/e2e/walk.py`.

### F2. Socket protocol (S implements, L codes against; payloads are JSON, ids are strings, money = integer units)
| Event (client->server) | Payload | Reply (server->client) |
|---|---|---|
| `auth_signup` | `{name, pin, avatar}` | `auth_ok {account, token}` / `auth_error {code, retryMs?}` |
| `auth_claim` | `{name, pin, avatar, roomPassword}` | `auth_ok {account, token}` / `auth_error` |
| `auth_login` | `{name, pin}` | `auth_ok {account, token}` / `auth_error` |
| `auth_resume` | `{key, token}` | `auth_ok {account}` / `auth_error {code:'bad_session'}` |
| `auth_logout` | `{}` | `auth_out {}` |
| `profile_get` | `{key?}` | `profile {display, avatar, stats, netCents, netChips, recent[], prefs}` |
| `profile_update` | `{avatar?, prefs?:{currency?,sound?}}` | `profile` |
| `pin_change` | `{oldPin, newPin}` | `ok {what:'pin'}` / `auth_error` |
| `account_reset_pin` (admin) | `{key, newPin}` | `ok {what:'pin_reset'}` |
| `lobby_list` | `{}` | `lobby_tables {tables:[tableCard]}` (public tables + tables I'm in) and live push of same on change |
| `tables_mine` | `{}` | `tables_mine {tables:[tableCard], nightNet:{[tableId]:units}}` |
| `table_create` | `{settings}` (B1 shape without id/host/nightId) | `table_created {table}` / `error` |
| `table_preview` | `{code}` | `table_info {table, seated[], openSeats}` / `error` |
| `table_join` | `{tableId, buyIn, seat?}` | `table_joined {tableId, playerIdx, stack, table, you}` / `error` |
| `table_leave` | `{tableId}` | `table_left {tableId, cashedOut}` (cash-out + ledger) |
| `table_start` / `table_pause` | `{tableId}` / `{tableId, paused}` | `table_event {tableId, kind, ...}` broadcast to table |
| `table_kick` | `{tableId, key}` | `table_event {kind:'kicked', key}` |
| `table_update` | `{tableId, patch}` | `table_event {kind:'updated', table}` |
| `table_end_night` | `{tableId}` | `settle_up {...}` to everyone seated + host |
| `table_clone` | `{tableId}` | `table_created {table}` |
| `table_adjust` (admin) | `{tableId, key, amount, note}` | `table_event {kind:'adjusted'}` |
| `rebuy` | `{roomId\|tableId, amount?}` | `balance_data`/`table_event {kind:'rebuy', key, amount}` (stack updates ride the normal `game_state`) |
| `night_get` | `{nightId}` | `settle_up {...}` / `error` |
| `settle_mark` | `{nightId, from, to, amount}` | `settle_up {...}` (updated with `paid:true` flags) |
| existing: `player_action, preselect, sit_out, chat_message, drop_sticker, throw_item, show_cards, get_bank_summary, get_leaderboard` | unchanged, `roomId` = `tableId` | unchanged (+ `game_state`/`room_update`/`bank_summary` carry `table:{mode,unit,sb,bb}` so money.js unit can be set) |
tableCard = `{id, name, mode, unit, sb, bb, buyIn:{min,max}, seats, seated, host:{key,display}, state, isPrivate}`.
- `roomId` in all legacy events keeps working: `roomId === table.id`; the legacy room is table id `POKERPING`.
- `room_update` and `game_state` gain `unit` ('cents'|'chips') and `mode`; `blinds_up` gains `unit`.
- Errors: always `error {message}` (existing) with optional `code` (`'auth'|'full'|'range'|'bank'|'rebuy_off'|'not_host'|'paused'`).

### F3. Server wiring notes for S
- `tables.js` exports `createTables({io, rooms, ledger, accounts, bank, saveBank, makeRoom, constants})`; it stores table settings on `room.settings` (so existing `rooms` Map and game engine remain; table id == room id). Engine reads `room.sb/bb`, `room.maxSeats` (replace the hard-coded 8), `room.turnMs` (replace TURN_MS), `room.blindIntervalMs`, `room.rebuysAllowed`. S makes those minimal substitutions in server.js and nothing else in game logic.
- Persistence of tables: `tables.json` (atomic) so a server restart does not lose open tables; seats are NOT restored (players rejoin with `table_join`; stacks are cashed out to ledger on shutdown via SIGTERM handler = `endNight` without settle screen, flagged `reason:'shutdown'`).
- Bots/demo (`create_demo`) stay Chips mode only and never write to ledger/accounts.
- `bank_set` admin check switches to `accounts.isAdmin(socket.data.acct)`; legacy fallback `bankKey(me.name)==='chris'` stays for the legacy room until phase 2.

### F4. Client integration contract (M implements in game.js, L consumes)
```js
window.PingGame = {
  enter({ tableId, playerIdx, stack, table, you }), // switches to #game-screen, sets Money.setUnit(table.unit), seeds state as room_joined does today
  leave(),                                           // returns to lobby (calls window.Lobby.show('lobby')), cleans timers/handlers
  isIn()                                             // bool
}
window.Lobby = { show(name), user(): {key,display,avatar,prefs}|null, onGameLeft() } // owner L
```
- game.js must stop showing `#landing-screen` on boot (L hides it: `#landing-screen` is removed from index.html by L, game.js guards `$('landing-screen')` null - M makes every reference to landing elements null-safe; the legacy landing join path is deleted, `join_game` is no longer emitted by the client).
- game.js `socket` object: M exposes `window.PingSocket = socket` so lobby.js reuses ONE connection (no second `io()`).
- game.js must read player identity from `Lobby.user()` instead of the landing name field (used for `meName` in bank.js too).

## G. Test plan and acceptance

### G1. Node tests (S unless noted; each exits non-zero on failure, spawn server with temp `ACCOUNTS_FILE/BANK_FILE/LEDGER_FILE/TABLES_FILE`)
- `tests/accounts.js`: signup ok; 'Chris' then 'CHRIS' signup -> `name_taken`; login ok with any casing and display stays 'Chris'; wrong PIN x5 -> `rate_limited` with retryMs, success after lock expiry (inject clock via env `AUTH_CLOCK_SKEW`); PIN never in accounts.json (grep hash only); resume with token ok, bad token -> `bad_session`; logout invalidates; migration: seed bank.json `{chris:5000,Mike:300,mike:200}`+ledger -> 2 accounts, unclaimed, claim with room password works, balance preserved, merged "mike"; atomic write (kill mid-save simulated by checking `.tmp` not left behind).
- `tests/tables.js`: create friends table (defaults 500..50000, blinds 50/100), reject bad settings (buyIn min>max, seats 1/10, sb>=bb, non-integer, mode mismatch), code uniqueness, preview, join with buyIn in range ok / out of range -> `range`, chips-mode bank debit/credit exact, friends no bank debit, two players play >=3 hands via real `player_action`, bust -> `bust_out` -> rebuy (amount in range), `rebuys:false` -> `rebuy_off`, `table_end_night` -> `settle_up` nets sum to 0 and `payments` count <= n-1 and applying payments zeroes everyone, ledger rows append-only (count never decreases, earlier rows byte-identical), kick/pause/host-transfer, only host/admin may use host events.
- `tests/money.test.js` (M, run in node via `vm` loading public/money.js with a fake localStorage): `fmt(125000,{unit:'cents',mode:'usd'})==='$1,250'`; `fmt(50,{unit:'cents',mode:'usd'})==='$0.50'`; `fmt(1235)` -> `$12.35`; `fmt(-300)` -> `-$3`; signed `+$85`; chips view `12,500`; chips unit usd view `fmt(1500,{unit:'chips',mode:'usd'})==='$1,500'`; NaN -> `'-'`; `parse('$12.5')===1250`; `parse('abc')===null`; `setMode('chips')` fires `onChange` once with 'chips' and persists; `'auto'` resolves per unit; unsubscribe works.
- Existing chain must still pass (`preselect, allin, mp, rejoin, bankedit, labels, clientlabels`); S updates `mp/rejoin/bankedit/showbank` only as far as the join path changes (legacy `join_game` kept, so ideally zero edits).

### G2. Playwright browser walk (`tests/e2e/walk.py`, L; two browser contexts, server on a spare port with temp data files, 1440x900, screenshots to `qa/overnight/`)
1. Context A: open `/`, sign up "Chris" PIN 1234 avatar a03. Context B: sign up "mike" PIN 4321. (Assert 'CHRIS' sign-up in a third page -> inline "name taken".)
2. A: Lobby -> Create table (Friends, $0.50/$1, $5-$500, 6 seats, private) -> share screen shows 6-char code; screenshot.
3. B: Join by code (also test `/?t=CODE` deep link) -> modal shows settings; buy in $100 via typed field and via slider; sit.
4. A sits for $100; auto-start; play >=1 full hand via buttons (check/call); verify pot/stack/blinds render as `$` everywhere (assert no raw bare big integers like "10000" in `#game-screen` text; regex `/\$[\d,]+(\.\d\d)?/`).
5. Toggle to chips: same screens re-render with plain numbers and no `$`; reload page -> toggle choice persists (localStorage + account pref); toggle back.
6. Bust test: host uses `table_adjust`-free path: B goes all-in against A (server test hook env `PING_TEST_DECK` seeded deck, S provides in `tables.js` guarded by `NODE_ENV==='test'`) -> loser sees rebuy prompt with picker $5-$500 -> rebuy $50 -> ledger shows `rebuy`.
7. Reload B mid-hand: auto-resume session, auto `table_join` rebind, same stack and seat (no extra buy-in row in ledger).
8. A: host drawer -> End night -> both see settle-up screen: nets sum to $0, payment line "mike pays Chris $X", Copy text works (read clipboard), mark paid; back to lobby shows Net on account chip.
9. Screenshots 1440x900 and 1920x1080 of: sign-in, lobby, create, share, join modal, in-game ($), in-game (chips), settle-up. Visual check: dark basement kit, no pills/glow, nothing clipped.

### G3. Acceptance checklist (lead signs off; every box must be true)
- [ ] Sign up / log in with name+PIN; 'Chris' == 'CHRIS'; wrong PIN rate-limited; session survives reload; sign out works.
- [ ] Existing names/bank entries show up merged case-insensitively and are claimable; no balance or ledger row changed by migration (diff test).
- [ ] Can create a Friends table with $5-$500 buy-in range, blinds preset, seats 2-9, timer, rebuys, private code + share link; Chips table still works.
- [ ] Join by code, lobby click, and deep link; join modal shows settings and enforces buy-in range; seat stack = buy-in.
- [ ] Host controls: start, pause, kick, end night all work; non-host denied.
- [ ] Bank: ledger append-only, cash-out on leave/end night, bust -> rebuy prompt, rebuy limits honored, Bank panel still opens and shows Tonight/net.
- [ ] Settle-up: nets zero-sum, <= n-1 payments, copyable text, per-account lifetime net in profile.
- [ ] `$` everywhere (pot, stacks, bets, seat labels, presets, slider, ticks, helper bar, showdown, +N floaters, bank panel, blinds, lobby cards); toggle flips every one; persists per account + localStorage; no `NaN`, no stray `.toLocaleString()` left in game.js/bank.js (`grep -c toLocaleString` = 0 outside money.js).
- [ ] `npm test` all green; Playwright walk green; screenshots reviewed at 1440x900 and 1920x1080.
- [ ] No console errors/warnings in the walk; no 404s; no second socket connection; `git status` shows only owned files changed.
- [ ] PRESELECT protocol untouched and tests/preselect.js still green.
- [ ] Nothing deployed; live game and ../ping-poker untouched; changes sit on the scratch build until Chris approves with the table empty.

## H. Phase-2 queue (not tonight unless time remains)
1. Rejoin after a drop: 60s seat hold with banner and countdown; auto-fold on timeout; stack kept (builds on existing same-name reclaim).
2. AFK sit-out: after 2 consecutive timeouts auto sit-out; "I'm back" button; host can toggle `autoSitOut`.
3. Bust/rebuy polish: quick-rebuy chips ($20/$50/$100), "rebuy same as last", spectate while busted, rebuy cap messaging.
4. Spectators (`table_watch`) and table chat history.
5. Lobby 70s soundtrack: low-volume looped track in lobby only, mute remembered (`prefs.sound`), uses sound.js unlock-on-first-click.
6. Account polish: PIN reset by admin UI, avatar upload (existing `profilePic`), profile night history charts, "rematch" button, export ledger CSV.
7. Remove legacy `join_game` path and `ROOM_PASSWORD` once everyone has claimed accounts.
8. Bots-in-friends-mode (practice) and tournament mode (blind schedule already exists).

## I. SOCIAL CASINO PLATFORM LAYER (added 10/5 04:10 from Chris 5617; overrides conflicts above)

Chris: "this is eventually going to be a social casino for me and my friends ... switching between games ... Ballot Bender slot machine pull up inside the same window as the poker game and let them play at the same time with either real or fake money." So The Ping = shell + shared accounts/wallet + pluggable GAME MODULES. Poker = game 1 (existing engine, wrapped, not rewritten). Ballot Bender (vp-slot/bender/) = game 2. Future: blackjack, roulette etc. must be addable by dropping in a module.

### I1. Money modes ("real or fake"; NO payment processing, ever)
- `play` = fake Play $ wallet. Each account starts with 10,000.00 play dollars (1,000,000 cents); "Top up" button refills to 10,000 when below 100 (cooldown 1 h). Never shows in net-vs-friends.
- `ledger` = Ledger $ = real-money-as-IOU among friends. Nothing moves in the real world; the app only tracks who is up/down, settle up yourselves. Poker Friends $ tables already behave this way. Slot spins in ledger mode record net vs "the House" (house = the host/admin account `chris`; shown as "House"). Optional per-account `ledgerLimitCents` (default -50,000 = -$500) enforced server-side on slot bets, no limit on poker (existing decision 2).
- Chips mode stays the legacy bank.json chips for the legacy table only.
- Unit everywhere = integer cents. Every table/game declares `moneyMode: 'play'|'ledger'` (poker table creation gets a third mode choice: `Play $` fake / `Friends $` ledger / `Chips`).
- Legal/ethics flag: the app must never take deposits, hold funds, or pay out. Copy in UI: "Ledger $ is a friendly tally, settle up on your own." No wording like "real money wins".

### I2. Server platform (owner S; new files)
- `wallet.js`: per-account `{play: cents, ledgerNet: cents, ledgerLimit}` inside accounts.json (`wallet` key); `wallet.spend(acct, mode, amount, ref)` / `wallet.credit(...)` atomic, append-only ledger rows `type:'game'`, `meta:{game, mode, round}`. Integer-safe, rejects negative or non-integer. `wallet.get(acct)` -> `{play, ledgerNet, ledgerLimit}` pushed as `wallet {play, ledgerNet}` event after every change and on `auth_ok`.
- `games/index.js`: registry. A module = `{id:'poker'|'bender', name, kind:'table'|'solo', init(ctx), handlers:{[event]:fn(socket,payload)}, onDisconnect(socket)}`; server.js loads all modules and registers their events namespaced `g:<id>:<event>` (poker keeps its legacy event names too). `ctx = {io, wallet, accounts, ledger, now, rng}`.
- `games/poker.js`: thin adapter exposing existing tables (no logic move; tables.js stays the owner).
- `games/bender.js`: SERVER-AUTHORITATIVE slot. Port the pure math of `vp-slot/bender/engine.js` (read it; if it is pure, require/copy it into `games/bender-engine.js` unchanged so client and server agree) and run RNG on the server (`crypto.randomInt`-seeded). Events: `g:bender:spin {bet, mode, buyBonus?}` -> `g:bender:result {roundId, grid, cascades[], bonus?, totalWin, balances}`; bet levels fixed list in cents (10,20,50,100,200,500,1000,2500) from the engine; each spin = `wallet.spend(bet)` then `wallet.credit(win)`; bonus rounds resolved server-side in one result payload (client just plays the animation). `g:bender:history {}` -> last 20 rounds. `g:bender:state {}` -> balances, bet levels, RTP label. Rate limit 1 spin/150 ms per socket. Sim: `node games/bender-sim.js 200000` prints RTP/hit-rate (must match the engine's published RTP within 0.5%); `tests/bender.js` = wallet math, play+ledger modes, limits, no negative, concurrent spins.
- Net-by-game stats: `accounts.stats.byGame[game]` = `{rounds, wagered, won, netCents}` for play and ledger separately; profile payload includes it.

### I3. Client platform shell (owner P = new worker; new files `public/shell.js`, `public/shell.css`)
- A persistent shell wraps everything after sign-in: top bar (logo, wallet chips `Play $9,820 | Ledger +$85`, money toggle, account, sign out) and a GAME DOCK (left or right edge; a small brass vertical rail of game icons: Poker, Ballot Bender, +coming soon placeholders).
- Windows: each game opens in a docked/floating WINDOW inside the same page: poker table = main stage window; Ballot Bender opens as a second window that can be (a) docked beside the table (default 40% width, poker shrinks via the existing `--u` scale), (b) floating draggable/resizable over the table (min 360x540), (c) minimized to the dock with a live badge (e.g. "+$12.40"), (d) maximized. Layout persisted per account (`prefs.layout`). BOTH stay live and interactive at once; poker keeps receiving state and the turn timer keeps running when the slot window has focus; a "Your turn" pulse shows on the poker dock icon/minimized bar. ESC and click focus bring a window to front. Basement look only (kit art), no glow/pills.
- Isolation: Ballot Bender is mounted as an `<iframe src="/games/bender/index.html">` (copy of vp-slot/bender client into `public/games/bender/`, assets included, original untouched) talking to the shell via `postMessage` (`{type:'spin', bet}` etc.); the SHELL owns the socket and forwards to `g:bender:*` so the iframe never needs the account token. Iframe client is changed ONLY to (1) remove its local RNG for money rounds and animate the server result, (2) show wallet balance from messages, (3) mode badge Play $/Ledger $, (4) label VOTES -> dollars via the shared formatter. Keep its Look-C art and humor intact. Phase fallback: if the server game is not ready the iframe runs its existing free-play client engine labelled "Practice (no wallet)".
- Poker integration: `PingGame` (F4) is the poker module's client side; the shell mounts it as the main stage. Lobby (E) becomes a screen inside the shell: tabs per game (Poker tables | Slots).
- Game switcher API: `Shell.openGame(id, opts)`, `Shell.focus(id)`, `Shell.minimize(id)`, `Shell.registerGame({id,name,icon,mount(el,ctx),onBlur,onFocus,badge()})` so a new game plugs in with one file.

### I4. Updated ownership (supersedes F1 where it conflicts)
| Worker | Owns |
|---|---|
| S | accounts.js, tables.js, wallet.js, games/*, ledger.js, server.js, package.json test chain, tests/{accounts,tables,bender}.js |
| L | public/lobby.js, lobby.css, public/index.html (adds `<div id="shell-root">`, script tags incl shell.js), tests/e2e/walk.py |
| M | public/money.js, game.js (numbers + PingGame), bank.js, bank.css, tests/money.test.js |
| P | public/shell.js, shell.css, public/games/bender/** (client copy + iframe bridge), tests/e2e/casino.py |
| UI (current ping_ui_fix) | style.css + stage/action-bar part of game.js/index.html ONLY until it reports done; M/L/P start after |
Timing: S starts now (server only). UI worker finishes first (~10 min); then L, M, P start. P and L coordinate only through `Shell.registerGame` / `Lobby.show`.

### I5. Extra acceptance
- [ ] Poker table and Ballot Bender both open at once, both interactive; turn timer runs while playing the slot; minimized badge works; layout persists after reload.
- [ ] Spin in Play $ and Ledger $ changes the right purse only; slot server RTP sim within tolerance; no client-side authority over results.
- [ ] A third game could be added with one `registerGame` file + one server module (document this in `ADD-A-GAME.md`).
- [ ] Wording audit: no "real money" claims, no deposits/payouts.
