// FB1 (chris 10-06 FB1): the "leads supersede" check of fb1.js with the frame clock starved on purpose, 5 times. node supersede_starved.js PORT [stallMs]   (run under flock _scratch/locks/chrome.lock)
// fb1.js failed this check 1 run in 4 on a loaded box: the count is drawn on the frame ticker, so with no frame for ~270 ms a superseded call's last number stayed up. Here every frame callback is
// held back stallMs (default 300) from 50 ms into the older call, the newer call starts at 100 ms; the note must never show a number below the newer call's start (13). exit 1 if it does.
const L = require('./lib'); const PORT = +process.argv[2] || 4653, STALL = +process.argv[3] || 300;
(async () => {
  const b = await L.open(PORT, L.uniq('fb1s')), { page } = b;
  const out = await page.evaluate(async (stall) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), S = CC.pull._S, v0 = S.view, raf = window.requestAnimationFrame, runs = [];
    const note = () => parseInt(document.getElementById('plN').textContent, 10);
    for (let i = 0; i < 5; i++) {
      CC.pull.setView({ ...v0, leads: 15, lt: 150, list: 450, cb: null }, 'play'); const lo = []; let t2 = null;
      const iv = setInterval(() => { if (t2 != null) lo.push(note()); }, 8);
      CC.pull.leadGain({ leadsBefore: 100, leadsAfter: 130, filled: 30, leaked: 0, armed: false });
      await sleep(50); window.requestAnimationFrame = (f) => setTimeout(() => raf.call(window, f), stall);   // the older call has drawn 10..11; from here frames are starved
      await sleep(50); const second = CC.pull.leadGain({ leadsBefore: 130, leadsAfter: 150, filled: 20, leaked: 0, armed: false }); t2 = performance.now();
      await second; clearInterval(iv); window.requestAnimationFrame = raf; await sleep(400);
      runs.push({ below13: lo.filter((x) => x < 13).length, samples: lo.length, min: Math.min(...lo), end: note(), gainHidden: document.getElementById('plGain').hidden });
    }
    CC.pull.setView(v0, 'play'); return runs;
  }, STALL);
  const ok = out.every((r) => r.below13 === 0 && r.samples > 20 && r.end === 15 && r.gainHidden);
  console.log(JSON.stringify({ port: PORT, stallMs: STALL, ok, runs: out })); await b.browser.close(); process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
