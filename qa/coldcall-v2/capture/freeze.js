// Freeze helpers: pause every animation the moment a condition becomes true, take the shot, thaw. The game itself is unchanged.
const { launch, ready, shot, sleep, OUT, base } = require('./lib');
// arm: in-page MutationObserver + 40 ms poll; resolves (inside the page) after pausing all animations `delay` ms after cond() first holds
async function arm(page, cond, delay = 0, timeout = 90000) {
  return page.evaluate(({ cond, delay, timeout }) => new Promise((res) => {
    if (window.__armStop) window.__armStop(); const f = new Function('return (' + cond + ')()'); let done = false;
    const fire = () => { if (done) return; let ok = false; try { ok = f(); } catch (e) { /* not yet */ } if (!ok) return; done = true; mo.disconnect(); clearInterval(iv); setTimeout(() => { document.getAnimations().forEach((a) => a.pause()); res(true); }, delay); };
    const mo = new MutationObserver(fire); mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    const iv = setInterval(fire, 40); window.__armStop = () => { if (!done) { done = true; mo.disconnect(); clearInterval(iv); res(false); } }; setTimeout(() => { if (!done) { done = true; mo.disconnect(); clearInterval(iv); res(false); } }, timeout); fire();
  }), { cond: cond.toString(), delay, timeout });
}
const thaw = (page) => page.evaluate(() => document.getAnimations().forEach((a) => a.play()));
// play rounds (practice, local engine) until `cond` fires inside one; returns true when frozen. The caller shoots and thaws.
async function chase(page, { force, buy, cond, delay = 0, tries = 12, turbo = false, noPoke = false }) {
  for (let t = 0; t < tries; t++) {
    await page.evaluate(() => { if (CC.core.st.busy) return; });
    await page.waitForFunction(() => !CC.core.st.busy, null, { timeout: 120000 });
    const armed = arm(page, cond, delay, 240000);
    await page.evaluate(({ buy, turbo }) => { CC.core.st.turbo = !!turbo; document.getElementById('turbo').classList.toggle('on', !!turbo); (buy ? CC.core.play(buy) : document.getElementById('spin').click()); }, { buy, turbo });
    // intro dial helper: tap it so the script goes on
    const poke = setInterval(() => page.evaluate((np) => { if (np) return; const d = document.querySelector('.dial'); if (d && d._finish && !d._tapped && !document.getAnimations().some((a) => a.playState === 'paused')) { d._tapped = 1; setTimeout(() => d._finish(), 500); } }, noPoke).catch(() => {}), 300);
    const idle = page.waitForFunction(() => !CC.core.st.busy, null, { timeout: 240000, polling: 200 }).then(() => 'idle');
    const r = await Promise.race([armed.then((ok) => (ok ? 'froze' : 'timeout')), idle]);
    clearInterval(poke);
    if (r === 'froze') return true;
  }
  return false;
}
module.exports = { arm, thaw, chase, launch, ready, shot, sleep, OUT, base };

// let a frozen round run to its end: taps any intro dial and the finale card
async function finish(page, ms = 300000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const busy = await page.evaluate(() => { const d = document.querySelector('.dial'); if (d && d._finish && !d._tapped) { d._tapped = 1; d._finish(); } const e = document.querySelector('.scn .tap'); if (e && /CONTINUE/.test(e.textContent)) CC.core.st.tap++; return CC.core.st.busy; });
    if (!busy) return true; await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
module.exports.finish = finish;
