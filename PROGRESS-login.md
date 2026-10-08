# PROGRESS-login (port-login, cut from port-1007 c1cf225)

## Done
- `public/lobby.js`: `BB_PENCIL` + `bb(label, attrs)` helper (button = bubble cell + live-text label). Used for the two tabs and `#lb-submit`. `fillIn` re-adds `.on` two frames after a tab redraw so the bubble animates. Submitting adds `.on` to `#lb-submit`; `S.onError` and `S.signErr` remove it and re-enable the button.
- Kept exactly as master: `field` inputs, `pin-mask` text PIN box, `panel` card, all ids (`lb-signform lb-name lb-pin lb-room lb-submit lb-err lb-claim lb-avatars`), `data-tab="in"|"up"`, `role=tab` + `aria-selected`, submit `type=submit`, events `auth_login` / `auth_signup` / `auth_claim` and payloads.
- The tablist keeps the kit classes `seg seg--tabs seg--block` (plus `lb-seg tabs`) because `tests/e2e/sweep/lib.py` clicks `.seg button[data-tab="up"]`; lobby.css drops the kit frame for it (`.lb-sign .seg.lb-seg`).
- `public/lobby.css`: ballot paper / bubble / pencil / states ported from 5202679, every `--p*`, `--px`, `--gold`, `--f-display` checked on master (`style.css` / `theme.css`). Alfa Slab One on the logo and field labels, Bebas on buttons. `.lb-center` top-scroll fix (`align-items:start` + `margin-block:auto`), `.lb-sign` width `min(480px, 100%)`.
- Evidence: qa/port-login/*.jpg (360, 540, 1440, 844x390; sign in, new account, submitting, wrong PIN, claim, rate limit, focus rings).

## Open
- None blocking. See final report for what was not verified.

## How to resume
Dev server: `PORT=4730 DATA_DIR=$(mktemp -d) RIG=1 SIGNUP_PLAY_CENTS=1000000 node server.js`; kill it and delete the dir afterwards. Scripts used for the browser legs live in `_scratch/login/` (shoot.py, flow.py, lock.py; ignored by git).

## HUNKS FOR LEAD
None.
