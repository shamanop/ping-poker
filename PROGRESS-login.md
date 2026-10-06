# Login buttons + font pass (branch feat-login, base v2)

Chris picked 3E "sample ballot bubble" (login-sheet3.png row 5).

## Done
- `bb()` helper in public/lobby.js builds real `<button>` elements: left cell with an SVG pencil-scribble bubble, label as real text.
- Used for the Sign in / New account tabs (`.lb-seg.tabs`, role=tab, aria-selected) and `#lb-submit`.
- Cream paper strip drawn in CSS (inline SVG noise + gradients), thin dark rule border via ::before, no image assets.
- Active/pressed/submitting: bubble fills over ~250 ms (opacity .25s + scribble stroke draw). Inactive tab: dimmer paper, empty oval.
- States: hover, :active, :focus-visible (gold outline), :disabled, user-select:none, prefers-reduced-motion.
- Font: Bebas Neue (var(--f-display)) on the buttons, Alfa Slab One on logo and field labels (Alfa on buttons read too heavy beside the rule border).
- Sign-in form is `min(480px, 100%)` wide; `.lb-center` now scrolls from the top in short viewports (margin-block:auto instead of place-items:center, which hid the top of the sign-up form in landscape).
- Tabs use a narrower bubble cell so "NEW ACCOUNT" does not clip at 390px.
- PIN input untouched (type/attrs unchanged, reserved for the separate hotfix).
- Cache-bust: lobby.css?v=4-login, lobby.js?v=6-login.

## Verified (Playwright, JPEG, 1440x900 / 390x844 / 844x390; login-shots/shoot2.py, results in login-shots/r3/)
- Both tabs, fill end state (fill opacity .5, scribble dashoffset 0), mid-animation ~.2 opacity at 80 ms.
- Keyboard: Tab focus ring on tab, Space switches tab.
- Wrong PIN error shows, button re-enabled. Long name (16 W), claim flow, sign-up, sign-in (click and Enter), admin sign-in all end to end at every size.
- No label clipping, no horizontal scroll, no page errors.
- tests/*.js: all pass except preselect.js ("dealer queued call 60": server-side, no overlap with this change). migrate.js passes in isolation (it fails only if an earlier test left accounts.json). qa/ and test artifacts cleaned.
