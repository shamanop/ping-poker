# PORT CONTRACT: radio + night recap + login onto v2 (branch `port-1007`, base master bb298d2)

Written by the port lead, 2026-10-08. Every port builder reads this whole file first. Where it and an old PROGRESS-*.md of a feature branch differ, this file wins.

The three features were built before v2 (base b0c20e7, shared first commit e262d46 which is ALREADY on master as 9d5f578: do not port it again). v2 replaced the monolithic `server.js`, the lobby and the shell with `transport/`, `tables/`, `money/` (one ledger), `engine/`, a UI kit (`UI-KIT.md`, `theme.css`) and phone / landscape layouts (`phone.css`, `landscape.css`). So this is a RE-WIRE: take the feature's own files from its branch, and re-attach every hook to what v2 has now. Never copy an old shared file over a v2 one.

Sources (all on origin, fetched): radio `origin/feat-radio` 0b43542 (`origin/combo-1006` 203d9c5 is the same radio on old live, reference only), recap `origin/feat-recap` 219bc1d, login `origin/feat-login` 5202679. Feature-only diff: `git diff e262d46..origin/feat-<x>`. Old notes: `git show origin/feat-<x>:PROGRESS-<x>.md` (and `MUSIC.md` for radio).

No 3D lobby: none exists in any branch. Never add one (no three.js, no webgl, no flag).

## Rules for every builder

1. Work only in your own worktree and branch (cut from `port-1007`). Never push, never merge, never touch `master`, `campaign` or another builder's worktree. The lead merges into `port-1007`.
2. First command in the worktree: `ln -s /home/frank/.openclaw/workspace/projects/ping-v2-core/repo/node_modules node_modules` (ignored by git).
3. Edit only files you OWN (table below). A change you need in a file you do not own: do not make it in place of the owner. Put the exact hunk in your `PROGRESS-<feature>.md` under `## HUNKS FOR LEAD` and, if you need it to test, commit it ALONE in a commit titled `LEAD-HUNK: <file>: <why>`.
4. `public/index.html` is the lead's. The tags for `music.css`, `recap.css`, `music-clock.js`, `music.js`, `recap.js` and the cache-bust bumps of `lobby.css`, `lobby.js`, `sounds-juice.js` are already there (scaffold commit). You never edit it.
5. Dev server: `PORT=<yours> DATA_DIR=$(mktemp -d) RIG=1 SIGNUP_PLAY_CENTS=1000000 node server.js`. NEVER start a server whose data dir is the repo (it would write `money.jsonl` / `accounts.json` into the tree). Ports: radio 4710-4719, recap 4720-4729, login 4730-4739 (lead 4700-4709). Kill what you start.
6. The acceptance suite uses fixed ports 3500-3559. Always run it as `flock /tmp/ping-v2-tests.lock node tests/v2/run.js --jobs 1` so two builders never collide. Short suites: `node tests/v2-unit/run-engine.js`, `run-money.js`, `run-tables.js`. A failure you believe is not yours: prove it on untouched `port-1007` before saying so (the lead's baseline log is `wt-port/_scratch/port/baseline-v2.log`).
7. Browser legs: python playwright, headless chromium, viewports 360x740, 540x900, 1440x900. Save small JPEGs in `qa/port-<feature>/` and LOOK at each one yourself (read the image). One browser at a time: the box has 12 GB RAM.
8. Server strings: no `error.message` carries a digit or `$` (tests/v2/27_errors.js). New socket events and payload keys are additive only (tests/v2/30_shapes.js): never remove or retype an existing key.
9. Money: none of the three features is money. Never call `ledger.transfer` / `batch`, never write `money.jsonl`, never hold a number that is read as a balance. Chips and Play $ are fully separate (bb298d2): never add them, never convert.
10. Keep `PROGRESS-<feature>.md` (worktree root) current: what is done, what is open, how to resume. If you are restarted you continue from it.
11. Done = commit on your branch + final message with: commit SHA, every command you ran with its real numbers, the screenshot paths, open issues. No claim without your own run. No emojis in code, UI or docs.

## File OWNER table

| File | OWNER |
|---|---|
| `public/index.html`, `package.json`, `PORT-CONTRACT.md`, `PROGRESS-PORT.md` | lead |
| `public/shell.js`, `public/shell.css`, `public/phone.css`, `public/landscape.css`, `public/style.css`, `public/theme.css`, `public/game.js`, `public/bank.js`, `public/admin.js`, `money/**`, `engine/**`, `games/**`, `social.js` | nobody: read-only. Hunks to the lead. |
| `public/lobby.js`, `public/lobby.css` | login |
| `music.js` (root, server), `public/music.js`, `public/music-clock.js`, `public/music.css`, `public/audio/music/**`, `MUSIC.md`, `tests/music-clock.test.js`, `tests/radio-sync.py`, `qa/music/**`, `public/sounds-juice.js`, `public/games/bender/audio.js`, `public/games/bender/game.js`, `public/games/coldcall/audio.js`, `public/games/coldcall/game.js`, `accounts.js` (the one `prefs.radio` line) | radio |
| `recap.js` (root, server), `public/recap.js`, `public/recap.css`, `tests/recap.js`, `transport/handlers/recap.js`, `transport/index.js` (the `HANDLERS` list only), `transport/boot.js` (`RECAP_FILE` in `resolvePaths` only), `transport/handlers/seat.js` (one line in `show_cards`), `tables/registry.js` + `tables/hand-flow.js` (the recorder hooks below, nothing else) | recap |
| `server.js` | shared by region: recap edits ONLY between `const viewlog = ...` and `ctx.games = ...` plus one flush line in `shutdown()`; radio adds ONLY one line directly above `app.use(express.static(` . Nothing else. |

## 1. LOGIN (small)

What it is: Chris picked the "sample ballot bubble" buttons for the Sign in / New account tabs and the submit button, plus an Alfa Slab / Bebas font pass. Source diff: `git show 5202679 -- public/lobby.js public/lobby.css` (`bb()` helper, `BB_PENCIL`, `.lb-sign .bb*` rules, `fillIn` animation, `.lb-center` top-scroll fix).

What v2 changed underneath:
- `viewSignin` on master was restyled with the UI kit: `field`, `panel`, `btn btn--primary btn--lg btn--block`, and the PIN box is now `type=text` with `pin-mask` (the PIN hotfix). Keep master's inputs exactly as they are; only the two tabs and `#lb-submit` become ballot buttons.
- `lobby.css` on master is a different file (kit tokens, login background art `public/art/login-bg.jpg`). Re-fit the ballot CSS to the tokens that exist now (check every `var(--p..)`, `--px`, `--f-display`, `--gold` you use is defined on master; replace the ones that are not).
- `phone.css` (<=600px) and `landscape.css` now style the lobby too: check the form at 360 and in 844x390 landscape, no clipped label ("NEW ACCOUNT"), no horizontal scroll, top of the sign-up form reachable.
- Fonts are already loaded by `index.html` (Alfa Slab One, Bebas Neue).

Must keep (other tests and builders drive the form by these): ids `lb-signform`, `lb-name`, `lb-pin`, `lb-room`, `lb-submit`, `lb-err`, `lb-claim`, `lb-avatars`; `[data-tab="in"]`, `[data-tab="up"]`; `role=tab` + `aria-selected`; the submit stays `type=submit`; events `auth_login`, `auth_signup`, `auth_claim` and their payloads unchanged. Grep `tests/` and `qa/` for `lb-` selectors and for `.lb-seg` before you finish and keep every one working.

Evidence: sign in, new account, claim flow (a legacy name), wrong PIN (error shows, button re-enabled), rate limit lock, keyboard (Tab focus ring, Space/Enter), reduced motion; shots at 360 / 540 / 1440 and 844x390 of both tabs and the submitting state.

## 2. RADIO

What it is: a synced lobby radio. The server only publishes a clock (a fixed epoch per station); every client computes the same track and offset. 4 stations, 24 mp3 (about 55 MB) under `public/audio/music/`. The MUSIC switch is shared with the slot's music switch; per-player on / off / station is saved in `account.prefs.radio`. Read `git show origin/feat-radio:MUSIC.md`.

Take as-is from `origin/feat-radio` (`git checkout origin/feat-radio -- <path>`): `music.js`, `public/music.js`, `public/music-clock.js`, `public/music.css`, `public/audio/music/`, `MUSIC.md`, `tests/music-clock.test.js`, `tests/radio-sync.py`, `qa/music/*.py`. Then re-wire:

| Hook | Old | v2 |
|---|---|---|
| Server attach | `require('./music').attach({ app, io, publicDir })` above `express.static` in the old server.js | Same one line in v2 `server.js` inside `start()`, directly above `app.use(express.static(`. Pass `on: (socket, ev, fn) => ctx.safe.onEvent(socket, ev, fn)` and register `music:ping` (ack) and `music:hello` through it, so a throw is contained like every other v2 event (`transport/safe.js`; it forwards the ack as the 2nd argument). Do not touch `transport/index.js`. The clock is public: no auth. |
| Prefs | `accounts.js updateProfile` line for `prefs.radio` | Same line on master's `updateProfile` (it still has `currency`, `sound`, `layout`). Check `transport/handlers/auth.js` `profile_update` passes `prefs` through and that `auth_ok.account.prefs.radio` comes back after a new-device login. |
| Top bar | bar docked in `.sh-top` after `#sh-lvl` by DOM injection; `<=600px` floating chip because the old bar had no narrow layout | v2 `.sh-top` (shell.js:48) has more in it (wallet plates, money toggle, bonus, account, sign out) AND `phone.css` / `landscape.css` now lay it out. Re-fit: at 360 / 540 / 1440 and 844x390 nothing in the top bar may be pushed off, covered or made unclickable by the radio, and the radio itself must be usable. Inject only; `shell.js`, `shell.css`, `phone.css` are read-only (hunks to the lead). |
| Slot music | `postMessage` `music-enabled` / `radio-active` to `iframe[src*="/games/bender/"]`; `SFX.holdBed`; `PingMusic.duck` on big wins | master already has `music-enabled` / `bender-music-pref` in bender. Port `holdBed`, the `radio-active` listener and the duck call. v2 has a SECOND slot, COLD CALL (`public/games/coldcall/`, has its own `audio.js`): give it the same treatment if it has a music bed (held while the radio plays, radio ducks on its big wins), and make the frame selector cover both. Say what you found. |
| Juice duck | `PJ.sfx('big'|'mega'|'jackpot')` ducks the radio | same hunk in master's `public/sounds-juice.js` |
| Tests | `tests/radio-sync.py` joins through the OLD landing form | v2 entry is sign in -> lobby -> `table_join` (no `join_game`, no landing form). Update the script (your port range) and make it pass; `node tests/music-clock.test.js` must pass. `ffprobe` is NOT installed on this box: `stations.json` already carries exact `durationSec`, keep it that way and make sure a missing ffprobe only warns. |

Rules: no autoplay before a user gesture; the radio never plays over the slot's own bed; `LICENSES.md` ships with the tracks. Report the default for a brand-new account (on or off) and the total size added.

## 3. NIGHT RECAP (the real re-wire)

What it is: `recap_get` -> `recap_data`, a full-screen overlay with standings, highlights, the hand list, a per-hand replay and a share card. Read `git show origin/feat-recap:PROGRESS-recap.md` and `origin/feat-recap:recap.js`.

Take from `origin/feat-recap`: `recap.js`, `public/recap.js`, `public/recap.css`, `tests/recap.js`. The payload builder (`build`, `superlatives`, `sessionsOf`) and the client mostly survive. Everything that FEEDS the recorder is gone and is rebuilt on v2:

| Old hook (monolithic server.js) | v2 source |
|---|---|
| `recap.startHand(room, sbIdx, bbIdx)` | registry `out.event(t, 'hand_start')`: read `t.hand` (`engine/hand.js`: seats, hole cards, `sbSeat`, `bbSeat`, blinds posted), `t.handStartStacks[seat]`, `t.button`, `t.seats` (seat -> account key), `t.displayOf(key)` |
| `recap.onAction(room, p)` | engine events (`fold`, `check`, `call {amount, allIn}`, `raise {kind, to, added, allIn}`, `returned`, `street {street, cards}`, `runout`, `showdown`) that `tables/hand-flow.js noteEvents(events)` already walks. Add ONE guarded forward there. Running pot = sum of `hand.seats[*].committed`. |
| `recap.onShowdown` + `recap.endHand(room)` | registry `out.event(t, 'hand_end', { hand, result, bySeat })`, emitted AFTER the ledger commit (`afterCommit`). `result` is V2-DESIGN 4.6: `winners[{name, handName, cards, amount, net}]` (only payouts > 0), `net{}`, `returned{}`, `reveals?`. Per-seat net = payout + returned - committed and the hand's nets sum to 0. An uncalled bet handed back is NOT a win. |
| (did not exist) | `out.event(t, 'void')`: a voided hand never happened. Drop the open record, write nothing. |
| `recap.onShown(room, key, flags)` | one guarded line in `transport/handlers/seat.js` `show_cards` after `t.shown[key] = rec` |
| `recap.attach(socket, on, authed)` | `transport/handlers/recap.js` exporting `register(ctx, socket, on)` like `handlers/lobby.js` (`ctx.auth.requireAuth(socket)`), added to `HANDLERS` in `transport/index.js` |
| `ledger.nightSummary(nightId)`, `tables.playEntries()`, `ledger.nightFromRows`, `getRooms()` | ALL GONE. Night money truth is the money ledger: `registry.nightOf(t).perKey[key] = { buyIn, cashOut, open, net }` for chips AND Play $ nights. A night's net per player in the recap MUST equal `registry.nightPayload(t).players[].net` (what the settle-up screen shows). The "Play $ history is memory only / since last restart" caveat no longer applies: remove it unless you can show a real gap. |
| `room.handNum` | wire hand number = `t.handNo - (t.nightHand0 || 0)` (same as `game_state.handHistory[].handNum` and `cards_shown.handNum`) |
| `RECAP_FILE` const in server.js | `paths.RECAP_FILE = near('recap-hands.jsonl', env.RECAP_FILE)` in `transport/boot.js resolvePaths` (so the test harness, which moves `BANK_FILE`, never writes into the repo) |

Wiring (keep it this small):
- `server.js`: `ctx.recap = require('./recap').createRecap({ file: paths.RECAP_FILE, registry: <lazy ref>, accounts, now })`, created before the registry; pass it to `createRegistry` as `recorder`.
- `tables/registry.js`: in `out.event`, after the viewlog call, `if (deps.recorder) try { deps.recorder.onEvent(t, kind, data) } catch (e) { console.error(...) }`; hand the same recorder to each `Table` in `build()`.
- `tables/hand-flow.js`: `noteEvents` forwards `events` to the recorder inside try/catch. Nothing else in `tables/` changes. `node tests/v2-unit/run-tables.js` stays green and the full v2 run shows no new failure.
- The recorder is presentation only: it never throws into a hand, never runs before the money write of a settle, never delays an emit. A hand must play identically with the recap file unwritable (prove it in the test).
- Persistence: one JSONL line per finished hand; a restart right after a hand keeps that hand (test it with a kill). Cap in memory as before.

Wire contract (new, additive): client `recap_get { tableId?, nightId?, start? }` (signed in) -> `recap_data { ok, scope, notes, players, superlatives, hands, totals, generatedAt }` or `error { code: 'recap', message: 'No such night' }`. Access: admin, the host, anyone in the night's money rows or recorded hands. Hole cards of a player who did not show are never sent to another viewer (viewer sees own cards plus shown ones), admins included. POKERPING (permanent table, `nightId` null) keeps the 4-hour-gap sessions.

Client (`public/recap.js`, `recap.css`): the three entry points (table, next to BANK; Bank panel header; night-end screen `viewSettle` "Night recap") are injected by `recap.js`, no edits to `lobby.js` / `game.js` / `bank.js`. Master's DOM and class names changed (UI kit, `#bank-slot`, phone layout): re-anchor each injection and use kit classes (`btn btn--secondary btn--sm` etc., see `UI-KIT.md`). Money is formatted by `Money.fmt` in the table's unit. Overlay, hand replay and the share card must work at 360 / 540 / 1440 with no overlap and no horizontal scroll.

Test: rewrite `tests/recap.js` onto the v2 harness (`tests/v2/lib.js`: `startServer`, `Bot`, `rigDeck`, `tableWith`). Keep the old assertions that still mean something: nets sum to zero per hand and per night, biggest pot = the max pot clients saw, wins tally = `showdown_result` events, recap night net = `settle_up` net (chips night AND Play $ night), hidden cards not leaked, access control, restart persistence, a voided hand is not recorded, POKERPING sessions.
