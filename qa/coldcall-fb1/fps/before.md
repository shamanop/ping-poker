# COLD CALL FB5 frame-time results: before

Build under test: http://100.104.51.99:4650/games/coldcall/index.html  
Run: 2026-10-06T20:28:39.664Z (undefineds), viewport 1440x900 css px, device scale native (measured devicePixelRatio 1.5), seed 12345 (practice rounds are seeded through crypto.getRandomValues, so a re-run plays the same rounds on the same code)  
GPU (verified before any scene ran): **ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 (0x00002B85) Direct3D11 vs_5_0 ps_5_0, D3D11)**, driver NVIDIA GeForce RTX 5090 32.0.15.8180; Chrome Chrome/154.0.8037.98 (headful window parked off-screen: real window + DWM presentation, nothing visible); gpu_compositing enabled, rasterization enabled_force. The rig refuses to write results on any other renderer (exit 3).

## What each number is
- **p50 / p95 / p99 / worst ms**: `requestAnimationFrame` frame-start deltas (the rAF timestamp argument, which is the compositor's BeginFrame time), recorded by a loop injected before any game script, taken only inside the scene's window (setup and waits excluded; a frame counts only when the previous frame is also inside the window). The display is 60 Hz, so frames arrive 16.7 ms apart and a missed vsync shows as 33.3 ms. This is main-thread frame cadence, not GPU execution time.
- **>16.7**: literal count of deltas over 16.7 ms. At 60 Hz this counts vsync jitter (idle: p50 16.7, p95 16.8), so it is not a stutter count. **>=25** (at least one vsync missed) and **>33** (the brief's number; two vsyncs) are the ones to read.
- **long tasks n / worst**: PerformanceObserver 'longtask' (main-thread task over 50 ms) inside the window. long-animation-frame entries are in the JSON (`loaf`, with script / style+layout / render split and the slowest scripts).
- **compositor presented-all / partial / dropped**: cc PipelineReporter frame outcomes from a Chrome trace (category disabled-by-default-devtools.timeline.frame only, calibration below): PRESENTED_ALL = every update made it, PRESENTED_PARTIAL = presented without the latest main-thread update (the main thread was late, so anything driven by main-thread work, such as paint-based CSS animations and per-frame JS tweens, lagged a frame), DROPPED = nothing presented. "idle" = no update wanted. This is the real compositor result per frame. (The BeginImplFrame-to-presented latency is a constant 33 ms with a vsync pipeline two deep, so it is in the JSON but not used.)

Calibration, idle 10 s with and without the light trace: p50 16.7 -> 16.7, p95 16.8 -> 16.8, worst 16.9 -> 17, >=25 ms 0 -> 0.

## Real GPU, no throttle, steady state (1440x900; second run of every scene in the same browser, GPU caches warm)

| scene / window | frames | p50 ms | p95 ms | p99 ms | worst ms | >16.7 | >=25 | >33 | long tasks n / worst ms | compositor presented-all / partial / dropped |
|:---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| idle 10 s | 598 | 16.7 | 16.8 | 16.9 | 17 | 232 | 0 | 0 | 0/0 | 320/0/0 +279 idle |
| **10 normal spins** | 688 | 16.7 | 16.8 | 16.9 | 17 | 303 | 0 | 0 | 0/0 | 695/0/0 |
| **cascade win (4 cascades, x3.3)** | 343 | 16.7 | 16.8 | 16.9 | 16.9 | 112 | 0 | 0 | 0/0 | 342/0/0 |
| **big win: click -> big-win card (big x13.3, 2 cascades)** | 379 | 16.7 | 16.8 | 16.9 | 17.3 | 128 | 0 | 0 | 0/0 | 381/0/0 |
| **big-win card held 3 s** | 179 | 16.7 | 16.8 | 16.9 | 16.9 | 82 | 0 | 0 | 0/0 | 180/0/0 |
| **base spin to the BONUS! stamp** | 52 | 16.7 | 16.8 | 16.8 | 16.8 | 17 | 0 | 0 | 0/0 | 53/50/0 (49% partial) +1 idle |
| **bonus trigger flourish** | 90 | 16.7 | 16.8 | 16.9 | 16.9 | 31 | 0 | 0 | 0/0 | 91/0/0 |
| **bonus intro (PLACE THE CALL)** | 291 | 16.7 | 16.8 | 16.9 | 17 | 107 | 0 | 0 | 0/0 | 293/0/0 |
| **buy menu open 3 s** | 179 | 16.7 | 16.8 | 16.8 | 16.8 | 54 | 0 | 0 | 0/0 | 180/1/0 (1% partial) +1 idle |
| **full bought bonus (confirm -> SPIN accepting)** | 1807 | 16.7 | 16.8 | 16.9 | 17 | 876 | 0 | 0 | 0/0 | 1805/153/0 (8% partial) |
| &nbsp;&nbsp;bonus intro | 293 | 16.7 | 16.8 | 16.9 | 16.9 | 136 | 0 | 0 | 0/0 | 294/0/0 |
| &nbsp;&nbsp;free spins (stage.bonus) | 1235 | 16.7 | 16.8 | 16.9 | 17 | 637 | 0 | 0 | 0/0 | 1236/1/0 (0% partial) |
| &nbsp;&nbsp;finale (card, BONUS COMPLETE) | 155 | 16.7 | 16.8 | 16.9 | 16.9 | 55 | 0 | 0 | 0/0 | 152/152/0 (50% partial) |
| **ONE MORE CALL prompt 8 s** | 480 | 16.7 | 16.8 | 16.9 | 16.9 | 174 | 0 | 0 | 0/0 | 479/0/0 |
| **PICK YOUR LEAD prompt 8 s** | 479 | 16.7 | 16.8 | 16.9 | 17.1 | 173 | 0 | 0 | 0/0 | 478/0/0 |
| **leads strip + feed (mock idle) 8 s** | 478 | 16.7 | 16.8 | 16.9 | 16.9 | 182 | 0 | 0 | 0/0 | 260/0/0 +219 idle |
| **info screen 5 s** | 300 | 16.7 | 16.8 | 16.9 | 17 | 88 | 0 | 0 | 0/0 | 299/0/0 |

Bar from the brief (0 frames over 33 ms, p95 at 60 Hz = <= 17 ms):
- idle 10 s: PASS (p95 16.8 ms, 0 frames over 33 ms, worst 17 ms)
- 10 normal spins: PASS (p95 16.8 ms, 0 frames over 33 ms, worst 17 ms)
- cascade win (4 cascades, x3.3): PASS (p95 16.8 ms, 0 frames over 33 ms, worst 16.9 ms)
- bonus intro (PLACE THE CALL): PASS (p95 16.8 ms, 0 frames over 33 ms, worst 17 ms)
- full bought bonus (confirm -> SPIN accepting): PASS (p95 16.8 ms, 0 frames over 33 ms, worst 17 ms)
- ONE MORE CALL prompt 8 s: PASS (p95 16.8 ms, 0 frames over 33 ms, worst 16.9 ms)

## Real GPU, no throttle, FIRST encounter (fresh Chrome profile: cold GPU shader / decode caches, what a new player's first minute looks like)

| scene / window | frames | p50 ms | p95 ms | p99 ms | worst ms | >16.7 | >=25 | >33 | long tasks n / worst ms | compositor presented-all / partial / dropped |
|:---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| idle 10 s | 598 | 16.7 | 16.8 | 16.9 | 16.9 | 234 | 0 | 0 | 0/0 | 318/0/0 +281 idle |
| **10 normal spins** | 681 | 16.7 | 16.8 | 16.9 | 100 | 288 | 3 | 3 | 0/0 | 687/0/7 |
| **cascade win (4 cascades, x3.3)** | 342 | 16.7 | 16.8 | 16.9 | 16.9 | 120 | 0 | 0 | 0/0 | 341/0/0 |
| **big win: click -> big-win card (big x13.3, 2 cascades)** | 381 | 16.7 | 16.8 | 16.9 | 16.9 | 127 | 0 | 0 | 0/0 | 382/0/0 |
| **big-win card held 3 s** | 176 | 16.7 | 16.8 | 50 | 50.1 | 85 | 2 | 2 | 0/0 | 177/0/4 |
| **base spin to the BONUS! stamp** | 52 | 16.7 | 16.9 | 16.9 | 16.9 | 22 | 0 | 0 | 0/0 | 53/50/0 (49% partial) +1 idle |
| **bonus trigger flourish** | 90 | 16.7 | 16.9 | 17 | 17 | 28 | 0 | 0 | 0/0 | 91/0/0 |
| **bonus intro (PLACE THE CALL)** | 284 | 16.7 | 16.8 | 33.4 | 117 | 107 | 3 | 3 | 0/0 | 286/0/9 |
| **buy menu open 3 s** | 180 | 16.7 | 16.8 | 16.9 | 16.9 | 69 | 0 | 0 | 0/0 | 181/0/0 |
| **full bought bonus (confirm -> SPIN accepting)** | 1810 | 16.7 | 16.8 | 16.9 | 17 | 911 | 0 | 0 | 0/0 | 1809/0/0 |
| &nbsp;&nbsp;bonus intro | 294 | 16.7 | 16.8 | 16.9 | 16.9 | 139 | 0 | 0 | 0/0 | 295/0/0 |
| &nbsp;&nbsp;free spins (stage.bonus) | 1239 | 16.7 | 16.8 | 16.9 | 17 | 666 | 0 | 0 | 0/0 | 1240/0/0 |
| &nbsp;&nbsp;finale (card, BONUS COMPLETE) | 153 | 16.7 | 16.8 | 16.9 | 17 | 57 | 0 | 0 | 0/0 | 151/0/0 |
| **ONE MORE CALL prompt 8 s** | 479 | 16.7 | 16.8 | 16.9 | 16.9 | 187 | 0 | 0 | 0/0 | 479/0/0 |
| **PICK YOUR LEAD prompt 8 s** | 479 | 16.7 | 16.8 | 16.9 | 17.9 | 183 | 0 | 0 | 0/0 | 478/0/0 |
| **leads strip + feed (mock idle) 8 s** | 479 | 16.7 | 16.8 | 16.9 | 17 | 192 | 0 | 0 | 0/0 | 260/0/0 +221 idle |
| **info screen 5 s** | 299 | 16.7 | 16.9 | 16.9 | 17.1 | 95 | 0 | 0 | 0/0 | 298/0/0 |

Same bar:
- idle 10 s: PASS (p95 16.8 ms, 0 frames over 33 ms, worst 16.9 ms)
- 10 normal spins: FAIL (p95 16.8 ms, 3 frames over 33 ms, worst 100 ms)
- cascade win (4 cascades, x3.3): PASS (p95 16.8 ms, 0 frames over 33 ms, worst 16.9 ms)
- bonus intro (PLACE THE CALL): FAIL (p95 16.8 ms, 3 frames over 33 ms, worst 117 ms)
- full bought bonus (confirm -> SPIN accepting): PASS (p95 16.8 ms, 0 frames over 33 ms, worst 17 ms)
- ONE MORE CALL prompt 8 s: PASS (p95 16.8 ms, 0 frames over 33 ms, worst 16.9 ms)

## Same scenes, CPU throttled 4x (Emulation.setCPUThrottlingRate 4; stands in for a phone, GPU still the 5090)

| scene / window | frames | p50 ms | p95 ms | p99 ms | worst ms | >16.7 | >=25 | >33 | long tasks n / worst ms | compositor presented-all / partial / dropped |
|:---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| idle 10 s | 599 | 16.7 | 16.8 | 16.8 | 16.9 | 230 | 0 | 0 | 0/0 | 243/0/0 +357 idle |
| **10 normal spins** | 699 | 16.7 | 16.8 | 16.9 | 50 | 300 | 3 | 3 | 1/54 | 706/428/0 (38% partial) +10 idle |
| **cascade win (4 cascades, x3.3)** | 356 | 16.7 | 16.8 | 16.9 | 49.9 | 135 | 1 | 1 | 0/0 | 355/46/0 (11% partial) +3 idle |
| **big win: click -> big-win card (big x13.3, 2 cascades)** | 391 | 16.7 | 16.8 | 16.8 | 50.1 | 141 | 1 | 1 | 1/55 | 393/70/0 (15% partial) +5 idle |
| **big-win card held 3 s** | 179 | 16.7 | 16.8 | 16.9 | 16.9 | 86 | 0 | 0 | 0/0 | 180/180/0 (50% partial) |
| **base spin to the BONUS! stamp** | 53 | 16.7 | 16.9 | 50.1 | 50.1 | 13 | 1 | 1 | 1/59 | 54/54/0 (50% partial) +1 idle |
| **bonus trigger flourish** | 91 | 16.7 | 16.8 | 16.9 | 16.9 | 19 | 0 | 0 | 0/0 | 92/2/0 (2% partial) +1 idle |
| **bonus intro (PLACE THE CALL)** | 296 | 16.7 | 16.8 | 16.8 | 33.3 | 131 | 1 | 1 | 0/0 | 298/202/0 (40% partial) +2 idle |
| **buy menu open 3 s** | 180 | 16.7 | 16.8 | 16.8 | 16.8 | 52 | 0 | 0 | 0/0 | 182/1/0 (1% partial) +2 idle |
| **full bought bonus (confirm -> SPIN accepting)** | 1843 | 16.7 | 16.8 | 16.9 | 17 | 924 | 0 | 0 | 0/0 | 1839/565/0 (24% partial) +13 idle |
| &nbsp;&nbsp;bonus intro | 299 | 16.7 | 16.8 | 16.9 | 16.9 | 138 | 0 | 0 | 0/0 | 300/205/0 (41% partial) +2 idle |
| &nbsp;&nbsp;free spins (stage.bonus) | 1258 | 16.7 | 16.8 | 16.8 | 16.9 | 664 | 0 | 0 | 0/0 | 1259/168/0 (12% partial) +10 idle |
| &nbsp;&nbsp;finale (card, BONUS COMPLETE) | 158 | 16.7 | 16.8 | 16.8 | 16.8 | 60 | 0 | 0 | 0/0 | 154/154/0 (50% partial) |
| **ONE MORE CALL prompt 8 s** | 479 | 16.7 | 16.8 | 16.9 | 17 | 189 | 0 | 0 | 0/0 | 478/0/0 |
| **PICK YOUR LEAD prompt 8 s** | 479 | 16.7 | 16.8 | 16.9 | 16.9 | 178 | 0 | 0 | 0/0 | 478/0/0 |
| **leads strip + feed (mock idle) 8 s** | 479 | 16.7 | 16.8 | 16.9 | 17 | 187 | 0 | 0 | 0/0 | 185/1/0 (1% partial) +295 idle |
| **info screen 5 s** | 299 | 16.7 | 16.8 | 16.9 | 16.9 | 105 | 0 | 0 | 0/0 | 298/0/0 |

Bar from the brief (p95 under 33 ms, read as <= 33.6; single missed frames are listed but do not fail this bar):
- idle 10 s: PASS (p95 16.8 ms, 0 frames over 33 ms, worst 16.9 ms)
- 10 normal spins: PASS (p95 16.8 ms, 3 frames over 33 ms, worst 50 ms)
- cascade win (4 cascades, x3.3): PASS (p95 16.8 ms, 1 frames over 33 ms, worst 49.9 ms)
- bonus intro (PLACE THE CALL): PASS (p95 16.8 ms, 1 frames over 33 ms, worst 33.3 ms)
- full bought bonus (confirm -> SPIN accepting): PASS (p95 16.8 ms, 0 frames over 33 ms, worst 17 ms)
- ONE MORE CALL prompt 8 s: PASS (p95 16.8 ms, 0 frames over 33 ms, worst 17 ms)

## Phone-shaped viewport 540x960 at dpr 2, no throttle (idle, 10 spins, ONE MORE CALL only)

| scene / window | frames | p50 ms | p95 ms | p99 ms | worst ms | >16.7 | >=25 | >33 | long tasks n / worst ms | compositor presented-all / partial / dropped |
|:---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| idle 10 s | 599 | 16.7 | 16.8 | 16.9 | 18.1 | 240 | 0 | 0 | 0/0 | 318/0/0 +282 idle |
| **10 normal spins** | 686 | 16.7 | 16.8 | 16.9 | 16.9 | 301 | 0 | 0 | 0/0 | 693/0/0 |
| **ONE MORE CALL prompt 8 s** | 479 | 16.7 | 16.8 | 16.9 | 17.1 | 185 | 0 | 0 | 0/0 | 477/0/0 |

10 normal spins, per spin (1x steady): #1 885 ms; #2 873 ms; #3 867 ms; #4 869 ms; #5 867 ms; #6 3766 ms win 31; #7 875 ms; #8 872 ms; #9 887 ms; #10 877 ms

## First load and time to first spin (over the tailnet, shaman -> this box, http://100.104.51.99:4650)

|  | cold cache | warm reload |
|:---|---:|---:|
| game ready (assets decoded, SPIN usable), ms from navigation start | 4324 | 361 |
| index.html response end, ms | 8.2 | 5.8 |
| requests | 62 | 61 |
| transferred KB | 2043 | 23 |
| encoded body KB / decoded KB | 2020 / 2020 | 2020 / 2020 |
| last byte at, ms | 4312 | 337 |
| PICK UP click to SPIN click, ms (scripted wait) | 741 | 711 |
| first spin, click to SPIN accepting again, ms | 874 | 961 |

Time to first spin (cold) = ready 4324 ms + a human click on PICK UP + the SPIN click; the first round then takes 874 ms. By type (cold): css 2 files 51 KB, js 12 files 214 KB, woff2 3 files 60 KB, json 1 files 3 KB, webp 42 files 1692 KB, ico 1 files 0 KB. Response headers: index.html: public, max-age=0, content-encoding none; style.css: public, max-age=0, content-encoding none; game.js: public, max-age=0, content-encoding none; room.webp: public, max-age=0, content-encoding none. Largest files: img/title.webp 206 KB, img/room.webp 177 KB, img/bezel.webp 126 KB, coldcall/game.js 68 KB, img/desk.webp 61 KB, img/s3big_closer.webp 60 KB.

Rig artifact, not a game number: the first request after Chrome starts stalls 5-23 s before it is sent (resource timing requestStart; curl from the same PC takes 25 ms), so the rig warms the browser with one request first and loads are measured after that.

## Where the time goes (full Chrome trace per window, 1x; the trace itself slows the page, so read the shares, not the absolute frame times)

| window | main thread busy | script ms | style ms | layout ms | paint ms | commit ms | other ms | raster threads ms/s | GPU-process thread ms/s | painted area per s (viewports) | style+layout p95 ms/frame | render p95 ms/frame |
|:---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| idle 10 s | 1.9% | 20.4 | 46.8 | 0 | 2.5 | 14.1 | 105 | 0.1 | 2 | 2.08 | 0.3 | 0.5 |
| cascade win (4 cascades, x3.3) | 6.4% | 68.7 | 77.2 | 2.3 | 55.8 | 12.3 | 167 | 4.8 | 73.1 | 159.46 | 0.7 | 1 |
| big win: click -> big-win card (big x13.3, 2 cascades) | 5.8% | 64.4 | 73.4 | 2.4 | 56.4 | 13.2 | 173 | 5.5 | 61.7 | 94.09 | 0.6 | 1 |
| big-win card held 3 s | 8.3% | 54.5 | 35 | 2.6 | 48.5 | 5.8 | 102 | 57.1 | 160 | 241.45 | 0.8 | 1.3 |
| base spin to the BONUS! stamp | 8.1% | 22.6 | 11.9 | 0.6 | 12.6 | 2.4 | 36 | 12 | 71.3 | 184.32 | 0.8 | 1.4 |
| bonus trigger flourish | 3.5% | 7.1 | 14.6 | 0 | 1.5 | 2.5 | 26.6 | 2 | 5.2 | 7.01 | 0.4 | 0.5 |
| bonus intro (PLACE THE CALL) | 5.3% | 33.4 | 48.5 | 0.2 | 63.1 | 9.4 | 106 | 11.8 | 176 | 97.28 | 0.4 | 0.6 |
| buy menu open 3 s | 2.9% | 7.7 | 26 | 0 | 1.3 | 4.5 | 48.2 | 1.1 | 2.5 | 1.26 | 0.3 | 0.5 |
| full bought bonus (confirm -> SPIN accepting) | 6% | 304 | 342 | 9.6 | 297 | 59.5 | 804 | 11 | 82.8 | 116.89 | 0.6 | 1 |
| bonus intro | 5.5% | 37.8 | 49.1 | 0.2 | 64.2 | 9.7 | 109 | 12.2 | 173 | 97.1 | 0.4 | 0.6 |
| free spins (stage.bonus) | 6.1% | 188 | 247 | 7.6 | 193 | 41.4 | 573 | 4.5 | 60.7 | 130.72 | 0.6 | 1 |
| finale (card, BONUS COMPLETE) | 7.9% | 61.1 | 25.6 | 1.2 | 32 | 5 | 79 | 64 | 114 | 104.05 | 0.6 | 1 |
| ONE MORE CALL prompt 8 s | 3.5% | 27 | 77.8 | 1.4 | 25.8 | 12.6 | 133 | 0.9 | 8.9 | 37.87 | 0.6 | 0.7 |
| PICK YOUR LEAD prompt 8 s | 3.3% | 26.2 | 75.2 | 1.2 | 17.8 | 12.9 | 128 | 0.7 | 7.7 | 29.25 | 0.5 | 0.6 |
| leads strip + feed (mock idle) 8 s | 1.9% | 16.2 | 38.4 | 0 | 2.1 | 11.2 | 82.5 | 0.2 | 2.5 | 2.72 | 0.3 | 0.4 |
| info screen 5 s | 2.7% | 10.5 | 43.9 | - | 1.1 | 7.5 | 69.8 | 0 | 0.3 | 0 | 0.3 | 0.5 |

Ms columns are exclusive main-thread self time inside the window. Raster = RasterTask on the raster worker threads; GPU-process = CrGpuMain thread busy (command decode and submit, not shader execution time). Painted area per second = sum of Paint-event clip areas / viewport area / seconds (1.0 = the whole screen repainted once a second; 60 = every frame).

## Worst-frame autopsy, FIRST encounter (cold GPU caches) (profile pass: every rAF gap >= 25 ms; what the main thread, GPU process and raster threads were doing inside that gap)

| window | gap ms | at | main busy | biggest main-thread events | GPU-proc / raster busy ms | verdict |
|:---|---:|---:|---:|---:|---:|---:|
| 10 normal spins | 100.1 | 1 s | 1% | - | 111.1 / 0 [RunTask 73.8 ms; Scheduler::RunTask 73.8 ms; GpuChannel::ExecuteDeferredRequest 73.8 ms; RendererRasterWorker 73.8 ms; CommandBuffer::Flush 73.8 ms] | GPU process |
| 10 normal spins | 33.5 | 0 s | 100% | TimerFire 35 ms; EventDispatch 32.4 ms; FunctionCall 32.2 ms ((anon)@game.js:691); ProxyMain::BeginMainFrame 3.3 ms | 0 / 0 [RunTask 16.8 ms; RunTask 16.7 ms; RunTask 16.7 ms; RunTask 16.6 ms] | main thread |
| 10 normal spins | 33.4 | 1.3 s | 6% | - | 54.5 / 0.2 [RunTask 54.5 ms; Scheduler::RunTask 54.5 ms; GpuChannel::ExecuteDeferredRequest 54.5 ms; RendererRasterWorker 54.5 ms; CommandBuffer::Flush 54.5 ms] | GPU process |
| big-win card held 3 s | 33.3 | 0.6 s | 4% | - | 61.8 / 0.7 [RunTask 39.3 ms; Scheduler::RunTask 39.3 ms; GpuChannel::ExecuteDeferredRequest 39.3 ms; RendererRasterWorker 39.3 ms; CommandBuffer::Flush 39.3 ms] | GPU process |
| big-win card held 3 s | 33.3 | 0.4 s | 6% | - | 58.6 / 0.7 [RunTask 58.6 ms; Scheduler::RunTask 58.6 ms; GpuChannel::ExecuteDeferredRequest 58.6 ms; RendererRasterWorker 58.6 ms; CommandBuffer::Flush 58.6 ms] | GPU process |
| bonus intro (PLACE THE CALL) | 100.1 | 0.1 s | 2% | - | 125.1 / 0.2 [RunTask 76.8 ms; Scheduler::RunTask 76.8 ms; GpuChannel::ExecuteDeferredRequest 76.8 ms; RendererRasterWorker 76.8 ms; CommandBuffer::Flush 76.8 ms] | GPU process |
| bonus intro (PLACE THE CALL) | 50.1 | 0.2 s | 2% | - | 83.4 / 0.1 [RunTask 48.3 ms; Scheduler::RunTask 48.3 ms; GpuChannel::ExecuteDeferredRequest 48.3 ms; RendererRasterWorker 48.3 ms; CommandBuffer::Flush 48.3 ms] | GPU process |
| bonus intro (PLACE THE CALL) | 33.4 | 0.3 s | 4% | - | 63.4 / 0.3 [RunTask 40.1 ms; Scheduler::RunTask 40.1 ms; GpuChannel::ExecuteDeferredRequest 40.1 ms; RendererRasterWorker 40.1 ms; CommandBuffer::Flush 40.1 ms] | GPU process |

## Worst-frame autopsy, steady (profile pass: every rAF gap >= 25 ms; what the main thread, GPU process and raster threads were doing inside that gap)

No frame gap >= 25 ms (0 counted in the pass).

## Cold-start hitch experiment (a fresh Chrome profile per variant, scenes 10 spins -> big win -> bonus intro in that order; which CSS feature, switched off everywhere, removes the first-encounter hitches)

| variant | frames >=25 ms (all windows) | frames >33 ms | worst frame ms | per window |
|:---|---:|---:|---:|---:|
| control | 12 | 12 | 150 | 10 normal spins: 7x >=25, worst 150; big win: click -> big-: 0x >=25, worst 16.9; big-win card held 3 s: 2x >=25, worst 66.7; base spin to the BONUS: 0x >=25, worst 16.8; bonus trigger flourish: 0x >=25, worst 16.9; bonus intro (PLACE THE: 3x >=25, worst 117 |
| filter:none everywhere | 9 | 9 | 167 | 10 normal spins: 4x >=25, worst 150; big win: click -> big-: 0x >=25, worst 17.1; big-win card held 3 s: 3x >=25, worst 50.1; base spin to the BONUS: 0x >=25, worst 16.8; bonus trigger flourish: 0x >=25, worst 17; bonus intro (PLACE THE: 2x >=25, worst 167 |
| box-shadow+text-shadow:none everywhere | 7 | 7 | 100 | 10 normal spins: 3x >=25, worst 83.2; big win: click -> big-: 0x >=25, worst 17.3; big-win card held 3 s: 2x >=25, worst 100; base spin to the BONUS: 1x >=25, worst 33.4; bonus trigger flourish: 0x >=25, worst 16.9; bonus intro (PLACE THE: 1x >=25, worst 66.7 |
| CSS animations off | 5 | 5 | 300 | 10 normal spins: 3x >=25, worst 300; big win: click -> big-: 0x >=25, worst 17; big-win card held 3 s: 0x >=25, worst 16.9; base spin to the BONUS: 1x >=25, worst 33.4; bonus trigger flourish: 0x >=25, worst 16.9; bonus intro (PLACE THE: 1x >=25, worst 234 |
| will-change:auto everywhere | 13 | 13 | 167 | 10 normal spins: 6x >=25, worst 167; big win: click -> big-: 0x >=25, worst 16.9; big-win card held 3 s: 3x >=25, worst 100; base spin to the BONUS: 1x >=25, worst 33.4; bonus trigger flourish: 0x >=25, worst 17.1; bonus intro (PLACE THE: 3x >=25, worst 167 |

The hitch is a first-use cost on the GPU process, so a single run is a sample, not a rate; read a variant as a cause only if its count is clearly below control in more than one window.

## Kill-switch experiments (full-trace windows, same seed; one CSS rule injected after load disables a property everywhere)

### idle

| variant | window | main busy % | delta vs control | raster ms/s | GPU-proc ms/s | painted area/s | p95 ms | >=25 |
|:---|---:|---:|---:|---:|---:|---:|---:|---:|
| control | idle 10 s | 2 | 0 | 0.1 | 2.2 | 2.08 | 16.8 | 0 |
| will-change:auto everywhere | idle 10 s | 1.9 | -0.1 | 0.2 | 2 | 2.08 | 16.8 | 2 |
| filter:none everywhere | idle 10 s | 2.3 | 0.3 | 0 | 0 | 0.2 | 16.9 | 0 |
| backdrop-filter:none everywhere | idle 10 s | 2.4 | 0.4 | 0 | 0 | 0.2 | 16.8 | 0 |
| box-shadow+text-shadow:none everywhere | idle 10 s | 5.1 | 3.1 | 0.3 | 2.6 | 2.08 | 16.9 | 0 |
| CSS animations off (animation:none) | idle 10 s | 0.9 | -1.1 | 0.1 | 1.7 | 1.98 | 16.8 | 0 |
| mix-blend-mode:normal everywhere | idle 10 s | 1.8 | -0.2 | 0.1 | 2.1 | 2.08 | 16.8 | 0 |
| #fx canvas + #sides props hidden | idle 10 s | 3.8 | 1.8 | 0.3 | 3 | 0.78 | 16.8 | 0 |

### cascade

| variant | window | main busy % | delta vs control | raster ms/s | GPU-proc ms/s | painted area/s | p95 ms | >=25 |
|:---|---:|---:|---:|---:|---:|---:|---:|---:|
| control | cascade win (4 cascades, x3.3) | 7.1 | 0 | 4.9 | 75.6 | 159.58 | 16.8 | 0 |
| will-change:auto everywhere | cascade win (4 cascades, x3.3) | 11.4 | 4.3 | 7.6 | 117 | 158.55 | 16.8 | 3 |
| filter:none everywhere | cascade win (4 cascades, x3.3) | 15.7 | 8.6 | 8.3 | 106 | 163.41 | 16.8 | 0 |
| backdrop-filter:none everywhere | cascade win (4 cascades, x3.3) | 14.8 | 7.7 | 8.3 | 128 | 165.13 | 16.8 | 1 |
| box-shadow+text-shadow:none everywhere | cascade win (4 cascades, x3.3) | 7.1 | 0 | 4 | 47.7 | 114.66 | 16.8 | 0 |
| CSS animations off (animation:none) | cascade win (4 cascades, x3.3) | 4.4 | -2.7 | 3.7 | 75 | 89.54 | 16.8 | 0 |
| mix-blend-mode:normal everywhere | cascade win (4 cascades, x3.3) | 6.5 | -0.6 | 4.7 | 74.1 | 160.01 | 16.8 | 0 |
| #fx canvas + #sides props hidden | cascade win (4 cascades, x3.3) | 13.7 | 6.6 | 9.9 | 132 | 158.66 | 16.8 | 0 |

## Not provable with this rig
- Real compositor frame times are only known through trace frame outcomes (presented / partial / dropped); GPU shader-execution time is not exposed by Chrome tracing, so GPU cost is the GPU-process thread busy time and the raster-thread time.
- 60 Hz display only (the 5090 is attached to a 60 Hz 4K panel): a 144 Hz player has tighter frame budgets and would show the same misses as 6.9 ms multiples.
- A 5090 is 10-20x a typical laptop GPU; 4x CPU throttle models a slower CPU only. GPU-bound costs (large blurred drop-shadows, full-screen repaints) are understated for integrated GPUs.
- The rig's own rAF loop forces a frame every vsync, so 'idle' frame time is cadence of an always-ticking page; a browser with no animation would skip frames.
- Chris's PC may be doing other work during a run: nvidia-smi before each Chrome launch is recorded under gpu.sessions[].nvidiaSmiBeforeLaunch in the JSON (utilization %, MiB, W, MHz) and printed in the run log; a busy GPU there means the numbers are polluted.
- Practice mode only (local engine, no server round-trip, no leads/pull UI). The pull UI is covered only by the mock=pull scenes; live-server decisions are not driven.
