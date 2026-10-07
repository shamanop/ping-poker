# The Ping UI kit

One component layer, `public/theme.css`, loaded before every other sheet. Screen sheets (`style.css`, `lobby.css`, `shell.css`, `bank.css`, `admin.css`, `amount.css`, `phone.css`, `landscape.css`) only lay things out; they never restyle a control. Wave 1 draws every frame in CSS. Wave 2 drops painted art in by setting variables, with no markup or selector change.

## How a skin slot works

Every framed component reads its frame from one variable and its border width from a second:

```css
.btn { border: var(--btn-bw) solid var(--btn-edge); border-image: var(--btn-frame); background: var(--btn-bg); }
.btn--primary { --btn-frame: var(--frame-btn-primary); --btn-bw: var(--bw-btn-primary); --btn-bg: var(--bg-btn-primary); }
```

`--frame-*` is `none` in wave 1, so the CSS border shows. To skin it, override three variables on `:root`:

```css
:root {
  --frame-btn-primary: url(art/btn-primary.png) 24 fill / 12px stretch;   /* border-image shorthand: source, slice, fill, width, repeat */
  --bw-btn-primary: 12px;                                                  /* must equal the width in the shorthand: it sizes the box */
  --bg-btn-primary: transparent;                                           /* the art paints the centre (`fill`) */
}
```

Rules for the art:
- Export at 2x. A frame shown with a 12 css px border is drawn with a 24 px border in the PNG. In the `border-image` shorthand, `slice` is in image pixels (so 24 x 2 = 48 for a 24 css px corner at 2x) and the `/ 12px` width is in css pixels.
- Keep the centre a plain flat area: every label is live text in the display face, never baked into the art.
- Hover, pressed and disabled are done in CSS (brightness, a 2 px drop, grayscale plus 50% opacity). Art needs no state frames. Optional: set `--frame-btn-primary` again inside `.btn--primary:active` for a pressed frame.
- Frames must be opaque at the outer edge so they sit cleanly on the dark room photo.
- Sizes in the table below are the css size the component is drawn at, plus the 2x art size and the slice.

## Slot list

Sizes are CSS px; "art" is the 2x export (double it).

| Component | Class | Variables | Art it expects |
|---|---|---|---|
| Primary button (gold, one per screen) | `btn btn--primary` | `--frame-btn-primary`, `--bw-btn-primary`, `--bg-btn-primary` | 9-slice, shown 44 tall (sm 36, lg 56), any width, border 12. Art 88 x 88, slice 24 |
| Secondary button (neutral dark) | `btn btn--secondary` | `--frame-btn-secondary`, `--bw-btn-secondary`, `--bg-btn-secondary` | same as primary |
| Danger button (oxblood: END NIGHT, KICK, sign out, leave) | `btn btn--danger` | `--frame-btn-danger`, `--bw-btn-danger`, `--bg-btn-danger` | same as primary |
| Ghost button (outline only) | `btn btn--ghost` | `--frame-btn-ghost`, `--bw-btn-ghost`, `--bg-btn-ghost` | optional, 1 to 2 px hairline; leave `none` for a plain outline |
| Icon button (square) | `btn btn--icon` (also `.sticker-item`, `.throw-item`, `.emote-btn`, `.panel__close` is separate) | `--frame-btn-icon`, `--bw-btn-icon`, `--bg-btn-icon` | square 9-slice shown 36 x 36, border 8. Art 72 x 72, slice 16 |
| Fold | `act act-fold` (`#btn-fold`) | `--frame-act-fold`, `--bw-act-fold`, `--bg-act-fold` | red. Shown 124 x 66, border 12. Art 248 x 132, slice 24 |
| Call / Check | `act act-call` (`#btn-check-call`) | `--frame-act-call`, `--bw-act-call`, `--bg-act-call` | amber, same size |
| Raise / Bet | `act act-raise` (`#btn-raise`) | `--frame-act-raise`, `--bw-act-raise`, `--bg-act-raise` | green, same size |
| Pre-select toggles | `act act-pre` (`.on` = primary) | uses the secondary and primary slots | none extra |
| Panel (menu, card, modal, drawer, console, chat rail) | `panel` (+ `panel--tight`, `panel--flush`) | `--frame-panel`, `--bw-panel-art`, `--bg-panel` | 9-slice, border 14, any size. Art 64 x 64, slice 28 (border 14). Centre can be transparent: the dark fill is `--bg-panel` |
| Panel title bar | `panel__title` (`--bar` slim, `--sm` small) | `--frame-title`, `--bw-title`, `--bg-title` | 9-slice bar shown 40 tall, any width, border 6. Art 160 x 80 (the plate with the two rivets at the ends), slice 12 |
| Inset row / cell (seat row, stat cell, settings summary, standing row) | `panel panel--inset` | `--frame-inset`, `--bw-inset`, `--bg-inset` | 9-slice, border 6. Art 40 x 40, slice 12 |
| Close button | `panel__close` | none (plain glyph, 32 px hit area) | optional icon via `background-image` on `.panel__close` |
| Text field | `field` (`field--code`, `field--num`, `field--sm`) | `--frame-field`, `--bw-field`, `--bg-field` | 9-slice shown 44 tall, border 8. Art 64 x 88, slice 16 |
| Segmented toggle (Play $ / Chips, tabs, stepper, money toggle) | `seg` (`seg--tabs`, `seg--stepper`, `seg--block`) | `--frame-seg`, `--bw-seg`, `--bg-seg`; selected cell: `--frame-seg-on`, `--bw-seg-on`, `--bg-seg-on` | group frame 9-slice shown 36 tall, border 8, art 64 x 72, slice 16; selected cell 9-slice border 6, art 48 x 48, slice 12 |
| Slider (raise, buy-in) | `slider` (and the two-knob `.lb-slider`) | `--frame-slider`, `--bw-slider`, `--bg-slider`, `--img-knob` | rail 9-slice shown 10 tall, border 4, art 40 x 20, slice 8; knob: one image shown 24 x 24 (art 48 x 48) in `--img-knob` |
| Money plate (wallet, blinds, balances) | `plate` (`plate--row`, `plate--big`) | `--frame-plate`, `--bw-plate`, `--bg-plate` | 9-slice shown 36 tall, border 8. Art 72 x 72, slice 16 |
| Divider | `divider` | `--frame-divider`, `--bw-divider`, `--bg-divider` | horizontal strip shown 8 tall, e.g. `url(art/divider.png) 0 24 fill / 0 12px stretch` with `--bw-divider: 8px`; art 480 x 16, slice 24 |
| Top bar and dock (already painted) | `.g-head`, `.g-bar`, `.sh-top`, `.lb-top` | `--frame-topbar`, `--frame-dock` | the current `images/ui/topbar.png` and `bar-teak.png`; swap the files or the variables |

Colour tokens (`--brass`, `--gold`, `--oxblood`, `--ink`, `--panel`, ...), type tokens (`--f-display` for every button label and title, `--f-text` body, `--f-card` plaques and values), the scale (`--fs-1` 12 px floor to `--fs-big`), geometry (`--h-btn` 44, `--h-btn-sm` 36, `--h-btn-lg` 56, `--h-field` 44, `--hit` 32) and shape (`--r-ctl`, `--r-panel`, `--bw-ctl`, `--bw-panel`) are all in the first 90 lines of `theme.css`.

## What every screen uses

| Screen | Controls |
|---|---|
| Sign in / new account | `panel` card, `seg seg--tabs`, `field`, one `btn--primary btn--lg` |
| Lobby | `panel` + `panel__title` cards, `btn--primary btn--lg` (Create table), `btn--secondary` (Join, Resume, Settle up), `field--code`, `plate` wallet in the top bar |
| Create table | `panel`, `seg` (game, blinds, clock, rebuys, visibility), `seg--stepper` (seats), `slider--range` + `field` amounts, one `btn--primary btn--lg` |
| Buy-in / seat | modal `panel` (title bar, scrolling body, `.acts` footer), `seg` fund picker above the amount, `slider`, preset `btn--chip`, `btn--primary` Sit down |
| Table bar | `btn--secondary btn--sm` (Bank, Host, Sit out / I'm back, Chat), `btn--danger btn--sm` (Leave table), `btn--icon` sound, `plate` blinds |
| Action bar | `act-fold`, `act-call`, `act-raise`, `act-pre`, AmountInput (`field--num`, `slider`, `btn--chip` presets) |
| Host drawer, bank, admin console | `panel` with `panel__title` and `panel__close`, `btn--danger` for END NIGHT and KICK, `seg` for tabs and the Chips / Play $ switch |
| Chat rail, toasts, bust panel, showdown bar, settle-up, profile, bonus | `panel` variants (`--tight`, `--toast`, `--warn`, `--inset`), `field field--sm`, `btn--icon` |

## Adding a control

Use the existing class. If none fits, add a variant to `theme.css` and a slot row here. Never style a `button`, `input` or panel in a screen sheet.
