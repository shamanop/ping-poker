# Campaign Trail: asset sources and licences

Everything here is free to ship. Nothing is fetched at run time (no CDN, no network).

| File | What | Source | Licence |
|---|---|---|---|
| `map-data.js` | One SVG path per US state (50, keyed by postal code), label point and bounding box per state | Wikimedia Commons, "Blank US Map (states only).svg" by Heitordp, derived from "Blank USA, w territories.svg". https://commons.wikimedia.org/wiki/File:Blank_US_Map_(states_only).svg (raw: https://upload.wikimedia.org/wikipedia/commons/1/1a/Blank_US_Map_%28states_only%29.svg). Alaska and Hawaii are in the file's own inset positions. | CC0 1.0 (public domain dedication), confirmed in the Commons metadata (`LicenseShortName: CC0`) on 2026-10-07 |
| `build-map.js` | Our script that turns that SVG into `map-data.js` (`node build-map.js us.svg > map-data.js`) | written for this game | same as the repo |
| `assets/fonts/BebasNeue-Regular.woff2` | Display face (numbers, labels) | Bebas Neue, Dharma Type; converted ttf to woff2 with fontTools from the copy already in the repo's Cold Call font scratch | SIL OFL 1.1 (`assets/fonts/OFL-BebasNeue.txt`) |
| `assets/fonts/AlfaSlabOne-Regular.woff2`, `SpecialElite-Regular.woff2`, `CourierPrime-Bold.woff2` | Title slab, ticker typewriter, small print | copied from `public/games/coldcall/assets/fonts/` (see the licence text in that folder's `LICENSES.txt`: Alfa Slab One and Courier Prime OFL 1.1, Special Elite Apache 2.0) | OFL 1.1 / Apache 2.0 |

All fonts are Latin subsets: copy in the game uses Basic Latin characters only.

The air links (AK-WA, AK-HI, HI-CA) are drawn by `map.js` as dashed arcs between state label points; the border pairs list inside `map-data.js` (`borders`) is only what the SVG file itself carried and is not used by the game (the server's map is the truth).

## `?fx=a` (election-night graphics pass, fx-a.js / fx-a.css)

Loaded only when the page, or the shell page around it, carries `?fx=a`. Nothing here is fetched at run time from outside the repo.

| File | What | Source | Licence |
|---|---|---|---|
| `assets/fonts/Inter-700.woff2` | Label face for the fx skin (the second of its two faces; the first is Bebas Neue above) | Inter, Rasmus Andersson; copied from `public/games/bender/assets/fonts/Inter-700.woff2` already in this repo | SIL OFL 1.1 |
| `assets/fx/studio.webp` | Blurred dark studio backdrop behind the glass panels | Generated 2026-10-08 through OpenRouter (`google/gemini-3.1-flash-image`), resized, blurred and darkened by us | Ours (model output, no third-party source image) |
| `assets/fx/alert.webp` | Red light-streak plate behind the BREAKING NEWS cut-in | Generated 2026-10-08 through OpenRouter, same model, resized | Ours |
| `assets/fx/skyline.webp` | Night skyline plate behind the PROJECTED WINNER screen | Generated 2026-10-08 through OpenRouter, same model, resized | Ours |
| `assets/fx/flare.webp` | Anamorphic gold flare on black, screen-blended over the pay-out | Generated 2026-10-08 through OpenRouter, same model, cropped and resized | Ours |

The generated plates carry no lettering, no people, no party marks and no flags. All type, numbers, the map and the motion are code.

Sound: every sound in the fx pass is synthesized in the browser with WebAudio (`fx-a.js`, `VOICE`); there are no sample files, so there is nothing to licence. It follows the shell's own mute switch and volume (`pp_sound_muted`, `pp_sound_volume` from `public/sound.js`).
