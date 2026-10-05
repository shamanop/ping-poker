# PingJuice API

Load order: `juice.css`, `juice.js`, `sounds-juice.js`. Everything hangs off `window.PingJuice` (PJ). No deps, no emojis, basement brass look.
Config: `PJ.config = { toastPos:'tr', maxToasts:3, stage:'#stage' (selector/el for centering), reduced:null|true }`. Honors prefers-reduced-motion.
Demo: `tests/juice.html` (serve repo root, open /tests/juice.html). Art: `public/images/fx2/` (art-src/fx2/MANIFEST.md).
Anchors (`anchorEl`, `targetEl`) are DOM elements; pass `null` to center on the stage.

## Methods
- `winCelebration(tier, anchorEl, amountText)` tier = nice|big|mega|jackpot. amountText number = counts up as "+$x"; string = shown verbatim. Returns a Promise. `PJ.winCelebration('big', potEl, 8400)`
- `calloutHand(name, anchorEl)` starburst + brass banner. `PJ.calloutHand('Full House!', stageEl)`
- `chipShower(fromEl, toEl, n)` chips fly pot to seat/stack. `PJ.chipShower(potEl, seatEl, 12)`
- `burst(name, x, y, {size, ms, delay, hold, rotate, front})` names in `PJ.burstNames`: starburst chips ballots rays bomb coins ring glitter.
- `shockwave(x, y, {size, delay, front})`; `screenShake(intensity 0-2, ms)`
- `countUp(el, from, to, ms, {signed})` animates text of el with Money.fmt if present.
- `toast(text, {sticker, ms})` queue, max 3 visible. `**bold**` marks names. `PJ.toast('**Ana** hit the JACKPOT', {sticker:'ballot-cherry'})`
- `stickerPop(name, targetEl, {dx, dy, size, hold})` names in `PJ.stickerNames`: vp-charm vp-horseshoe i-pinged ballot-cherry vp-chip ping-hand boba-crown skull-ace.
- `charm(targetEl, {side:'left'|'right', size, dx, dy})` persistent hanging VP charm on a seat; `uncharm(targetEl)`.
- `streakFlame(el, n)` streak badge, 0 hides flame. `xpBar(el, pct, level)` fills bar, level-up flash when level rises.
- `dailyBonus(amount, {kicker, note, onClaim(amount)})` modal with Claim button; Esc dismisses without claim.
- `streakCalendar({day, streak, available, schedule:[cents x7]}, {onClaim(cents, day), targetEl})` 7-day calendar modal (Day N of 7, past days stamped, day 7 jackpot tile). Claim fires winCelebration (nice/big/jackpot by day) + chipShower to targetEl. Esc/backdrop dismiss without claim. Replaces `dailyBonus` in the shell.
- `sfx(name, {minGap})` WebAudio only, no files; `PJ.sfxNames` = chipClink chipShower coinTick whoosh thud nice big mega jackpot nearMiss bombBoom sticker toast claim ping. Muted by `localStorage ping.sfx='0'` (or pp_sound_muted=1); `PJ.setSfx(bool)`.
- `preload()` warm images; `clear()` wipes all effects and the toast queue (call on table leave).

## Event wiring (suggested)
| Game event | Call |
|---|---|
| Pot win < 5 BB | `winCelebration('nice', winnerSeat, amt)` |
| Pot win 5-25 BB or all-in win | `winCelebration('big', potEl, amt)` + `chipShower(potEl, winnerSeat, n)` |
| Pot win 25+ BB | `winCelebration('mega', potEl, amt)` |
| Bender spin: 1-9x big, 10-49x mega, 50x+ or max symbol line jackpot | `winCelebration(tier, benderEl, payout)`; no win = `sfx('nearMiss')` |
| All-in call | `shockwave(x,y)` + `screenShake(0.6, 400)` + `sfx('whoosh')` |
| Hand name at showdown (Full House and up) | `calloutHand(handName, stage)`; Straight Flush / Royal use full tier |
| Sticker or throw received | `stickerPop(name, targetSeat)`; bomb throw: `burst('bomb',x,y)` + `screenShake(1,500)` |
| Player equips VP charm | `charm(seatEl)`; on leave `uncharm(seatEl)` |
| Win streak change | `streakFlame(badgeEl, n)`; at 3+ also `toast('**Name** is on a N-win streak', {sticker:'vp-horseshoe'})` |
| Hand finished, XP earned | `xpBar(barEl, pct, level)` |
| First login of the day | `dailyBonus(amount, {onClaim: creditChips})` |
| Chip stack refill, rebuy, notifications | `toast(text)` |
| Pot count in the center growing | `countUp(potAmtEl, old, new, 600)` |
