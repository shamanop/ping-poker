# COLD CALL FB5 frame-time rig (shaman, real GPU)

One command, from the repo root:

    node qa/coldcall-fb1/fps/run.mjs <baseUrl> <outTag> [options]
    node qa/coldcall-fb1/fps/run.mjs http://100.104.51.99:4650/games/coldcall/index.html before

`<baseUrl>` is the game's `index.html` as shaman reaches it (this box is 100.104.51.99 on the tailnet; `127.0.0.1` / `localhost` are rewritten). The server needs no test hook:
every scene runs in practice mode (`?nosplash`, local engine), and rounds are seeded through `crypto.getRandomValues` (page.js), so the same code plays the same rounds.

Output (next to this file): `<outTag>.json` (everything raw), `<outTag>.md` (tables), `OFFENDERS.md` (tag `before`) or `OFFENDERS-<outTag>.md` (evidence for the worst offenders; a hand-written reading in `OFFENDERS-notes-<tag>.md` is appended). Exit codes: 0 ok, 3 the browser was not on the RTX 5090 (nothing is written), 1 rig error.

Options: `--quick` (one timing pass at 1x, no profile, no kill-switches, about 4 min), `--scenes idle,spins10,cascade,bigwin,intro,bought,more,pick,pullIdle,info`, `--throttles 1,4`, `--no-profile`, `--no-ablate`, `--no-steady`, `--no-phone`, `--no-first-load`, `--vp 1440x900`, `--dpr N` (default: the display's native scale, 1.5 on shaman's 4K panel), `--seed N`, `--headless` (headless=new instead of the off-screen headful window), `--ablate-limit N`.
A full run takes about 35-40 minutes and holds Chrome on Chris's GPU the whole time; run it when he is not gaming (the renderer.json of a run records nothing about his load, check `nvidia-smi` first).

## How it works

- `run.mjs` copies `rig/*` to `E:\bricklord-test\coldcall-fb5\rig` (scp), then runs `drive.mjs` over ssh. Everything on shaman lives under `E:\bricklord-test\coldcall-fb5\` (profile, TEMP, job files); nothing is written to C: except the scheduled-task entry Windows keeps for the one-shot task, which is deleted at the end. The run folder is removed afterwards, the rig files (about 40 KB) stay.
- `launch.mjs` starts Chrome in Chris's interactive session (session 0 over ssh has no GPU) with a one-shot `schtasks /IT /RU ctkul` task and `wscript` (no window), headful, window parked at x=-30000 so nothing shows. `cleanup.ps1` kills only Chrome processes started with our profile path and deletes our `coldcall-fb5-*` tasks.
- `drive.mjs` talks raw CDP (Node's built-in WebSocket, no npm packages), checks `SystemInfo` and `WEBGL_debug_renderer_info` for the RTX 5090 with gpu_compositing and rasterization enabled, and refuses otherwise.
- `page.js` is injected before any game script: the rAF recorder (frame start, delta, callback lag), long-task and long-animation-frame observers, the seeded random generator, a seed queue. `scenes.js` holds the scripted scenes and the style / animation / image survey. `trace.mjs` turns Chrome traces into per-window summaries and the worst-frame autopsy.
- Sessions: A = fresh Chrome profile, first load (cold HTTP cache), then every scene once cold (`timing_1x_first`) and again (`timing_1x`), then 4x CPU throttle and a 540x960 dpr 2 pass; B = fresh profile again, full-trace profile pass cold and steady, then the kill-switch experiments.
- Meaning of every number, the bar, and what the rig cannot prove are printed at the top and bottom of `<outTag>.md`.
