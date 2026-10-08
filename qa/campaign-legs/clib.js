'use strict';
// Campaign Trail browser legs: shared pieces. Reuses qa/p6-w3b/lib.js (launch, signUp, plates, ledger replay). Real clicks through the Ping shell.
const L = require('../p6-w3b/lib.js');
const { sleep } = L;

// ---- open the game from the shell dock (docked at 360x740, a window at 540x960), same as the client's drive/dlib.js
async function openGame(page) {
  await page.locator('button.sh-di', { hasText: 'Campaign Trail' }).click();
  let fr = null; for (let i = 0; i < 100 && !fr; i++) { fr = page.frames().find((f) => /games\/campaign/.test(f.url())); if (!fr) await sleep(150); }
  if (!fr) throw new Error('no campaign frame after clicking the dock button');
  await fr.waitForFunction(() => window.__campaign && window.__campaign.ready, null, { timeout: 20000 });
  await sleep(900);
  return fr;
}
// hooks inside the page and the frame: (1) force on g:campaign:step (CAMPAIGN_TEST=1 server only picks the random draw), (2) every g:campaign:* the shell sends, (3) every toast the game shows
async function hook(page, fr) {
  await page.evaluate(() => {
    const s = window.PingSocket; if (!s || s.__cl) return; s.__cl = 1; const o = s.emit.bind(s);
    window.__force = null; window.__sent = [];
    s.emit = function (ev, ...a) {
      if (/^g:campaign:/.test(ev)) window.__sent.push(ev + (a[0] && a[0].force ? '!' + a[0].force : ''));
      if (ev === 'g:campaign:step' && window.__force && a[0]) a[0] = { ...a[0], force: window.__force };
      return o(ev, ...a);
    };
  });
  await fr.evaluate(() => {
    if (window.__toastObs) return; window.__toasts = [];
    const t = document.getElementById('toast');
    window.__toastObs = new MutationObserver(() => { if (t.classList.contains('on') && t.textContent) window.__toasts.push(t.textContent); });
    window.__toastObs.observe(t, { attributes: true, childList: true, characterData: true, subtree: true });
  });
}
const force = (page, f) => page.evaluate((x) => { window.__force = x; }, f);
const sentLog = (page) => page.evaluate(() => (window.__sent || []).slice());
const toasts = (fr) => fr.evaluate(() => (window.__toasts || []).slice());
const errEvents = (fr) => fr.evaluate(() => window.__campaign.events.filter((e) => e.dir === 'in' && e.event === 'error').map((e) => (e.payload && e.payload.code) || '?'));
const viewOf = (fr) => fr.evaluate(() => window.__campaign.view);
const waitView = (fr, v, t = 12000) => fr.waitForFunction((x) => window.__campaign.view === x, v, { timeout: t });
const waitIdle = (fr, t = 12000) => fr.waitForFunction(() => !window.__campaign.busy, null, { timeout: t });

// ---- player actions (real pointer clicks)
async function pickHomeSearch(fr, q, nameRe) {
  const inp = fr.locator('#homeQ'); await inp.click(); await inp.fill(q);
  await fr.locator('.hrow', { hasText: nameRe }).first().click(); await sleep(250);
}
// a tap on the map: find a pixel that really hits the state's own path (elementFromPoint), then a real mouse click there
async function pickHomeMap(page, fr, code) {
  const pt = await fr.evaluate((c) => {
    const p = document.querySelector('path.st[data-s="' + c + '"]'); if (!p) return null; const b = p.getBoundingClientRect();
    for (let k = 0; k < 400; k++) { const x = b.left + b.width * (((k * 0.618034) % 1) * 0.8 + 0.1), y = b.top + b.height * (((k * 0.414214) % 1) * 0.8 + 0.1); const e = document.elementFromPoint(x, y); if (e && e.getAttribute && e.getAttribute('data-s') === c) return { x, y }; }
    return null;
  }, code);
  if (!pt) throw new Error('no clickable point on the map for ' + code);
  const fb = await (await fr.frameElement()).boundingBox();
  await page.mouse.click(fb.x + pt.x, fb.y + pt.y); await sleep(300);
}
const setStake = async (fr, units) => { await fr.locator('.segb[data-b="' + units + '"]').click(); await sleep(150); };
const setMode = async (fr, mode) => { await fr.locator('[data-m="' + mode + '"]').click(); await sleep(200); };
// the pick cards: not a dead end (a forced survive into a dead end would end the run on its own); card chosen by its number badge
async function pickCard(fr, force_) {
  const info = await fr.evaluate(() => [...document.querySelectorAll('.cards .card')].map((c) => ({ n: +c.dataset.n, dead: c.classList.contains('dead'), to: c.dataset.to })));
  const live = info.filter((c) => !c.dead); const want = force_ && live.find((c) => c.n === force_) ? force_ : (live[0] || info[0]).n;
  await fr.locator('.cards .card[data-n="' + want + '"] .num').click();
  return { n: want, of: info.length, to: (info.find((c) => c.n === want) || {}).to };
}

// ---- screen / shell reads
const numOf = (t, mode) => L.toUnits(t, mode);
const screenBal = (fr) => fr.evaluate(() => document.getElementById('bal').textContent);
const plateTxt = (page, mode) => page.evaluate((m) => (document.querySelector(m === 'chips' ? '#sh-chips .plate__value' : '#sh-play .plate__value') || {}).textContent, mode);
const panelRead = (fr) => fr.evaluate(() => {
  const q = (s) => (document.querySelector(s) || {}).textContent || '';
  return { stamp: q('#panel .stamp b'), sub: q('#panel .stamp span'), stake: q('#panel .figs div:nth-child(1) dd'), mult: q('#panel .figs div:nth-child(2) dd'), paid: q('#panel .figs .paid dd'), paidLabel: q('#panel .figs .paid dt'), cls: (document.querySelector('#panel .result') || {}).className || '' };
});
const ctaRead = (fr) => fr.evaluate(() => { const b = document.getElementById('cta'); return { disabled: b.disabled, main: b.querySelector('.main').textContent, sub: b.querySelector('.sub').textContent }; });

// ---- ledger replay of money.jsonl (the ledger itself, never the screen)
function replay(dataDir, key) {
  const lg = L.readLedger(dataDir); const refs = new Map();
  let txt = ''; try { txt = L.fs.readFileSync(L.path.join(dataDir, 'money.jsonl'), 'utf8'); } catch (e) { /* none */ }
  for (const l of txt.split('\n')) {
    if (!l.trim()) continue; let r; try { r = JSON.parse(l); } catch (e) { continue; }
    const m = /^campaign:([^:]+):([0-9a-f]+):(open|close|void)/.exec(r.ref || ''); if (!m || m[1] !== key) continue;
    const e = refs.get(m[2]) || { lines: 0, kinds: [], delta: { play: 0, chips: 0 } }; e.lines++; e.kinds.push(m[3]);
    for (const it of (Array.isArray(r.batch) ? r.batch : [r])) { const cur = it.cur || r.cur; if (it.to === L.storeOf(key, cur)) e.delta[cur] += it.amount; if (it.from === L.storeOf(key, cur)) e.delta[cur] -= it.amount; }
    refs.set(m[2], e);
  }
  const sumBy = { play: 0, chips: 0 }; for (const [k, v] of lg.bal) { const c = k.split('|')[1]; sumBy[c] = (sumBy[c] || 0) + v; }
  const neg = [...lg.bal].filter(([k, v]) => v < 0 && !/^(mint|house|fx):/.test(k)).map(([k, v]) => k + '=' + v);
  return { lg, refs, sumBy, neg, bal: (cur) => lg.get(L.storeOf(key, cur), cur), escrows: lg.escrows };
}

module.exports = Object.assign({}, L, { openGame, hook, force, sentLog, toasts, errEvents, viewOf, waitView, waitIdle, pickHomeSearch, pickHomeMap, setStake, setMode, pickCard, numOf, screenBal, plateTxt, panelRead, ctaRead, replay });
