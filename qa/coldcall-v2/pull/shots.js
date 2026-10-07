// THE PULL wave 2 integration shots (builder I): real driver paths on the real 4640 server, plus ?mock=pull for states chance does not give (ghost, pot, gain, more result).
//   node shots.js            -> qa/coldcall-v2/pull/<state>_<size>_<mode>.png   (size 540 = 540x960, 1440 = 1440x900, 360 = 360x740; mode play|chips)
// real: idle (fresh account), round (a real base spin, mid-spin), pick (bought bonus1 until a PICK), more (ONE MORE CALL prompt), after (round over), callback (armed through autoplay spins, shown ready)
// mock: ghost, pot, gain, more_won, more_lost, warm (idle mock has 4 warm squares)
const { launch: launch0 } = require('../capture/qalib'); const PAGEERR = [];
const launch = async (w, h) => { const b = await launch0(w, h); b.page.on('pageerror', (e) => PAGEERR.push(e.message)); return b; };
const io = require('/home/frank/.openclaw/workspace/projects/ping-coldcall-pull/_scratch/sio/node_modules/socket.io-client');
const PORT = process.env.CCPORT || 4640, BASE = `http://127.0.0.1:${PORT}/games/coldcall/index.html`, OUT = __dirname, PIN = '1234';
const SIZES = [[540, 960, '540'], [1440, 900, '1440'], [360, 740, '360']], sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ONLY = process.argv[2] ? process.argv[2].split(',') : null;
function sockSession(name) {
  return new Promise((resolve, reject) => {
    const s = io(`http://127.0.0.1:${PORT}`, { forceNew: true }); let tried = false;
    s.on('connect', () => s.emit('auth_login', { name, pin: PIN }));
    s.on('auth_error', () => { if (!tried) { tried = true; s.emit('auth_signup', { name, pin: PIN, avatar: 'a01' }); } else reject(new Error('auth')); });
    s.on('auth_ok', () => resolve(s)); setTimeout(() => reject(new Error('sock timeout')), 15000);
  });
}
const serverState = (s) => new Promise((res) => { s.once('g:coldcall:state', res); s.emit('g:coldcall:state', {}); });
async function armCallback(name, mode, max = 700) {
  const s = await sockSession(name); const st = await serverState(s); let view = st.pull[mode], n = 0;
  await new Promise((res) => {
    const go = () => { if (view.cb || n >= max) return res(); n++; s.emit('g:coldcall:spin', { bet: 10, mode, auto: true }); };
    s.on('g:coldcall:result', (r) => { if (r.status === 'done') { view = r.pull.state; setTimeout(go, 170); } });
    s.on('error', (e) => { if (e.code === 'rate') setTimeout(go, 200); else res(); }); go();
  });
  s.close(); return { view, spins: n };
}
async function open(w, h, name, mode, q = '') {
  const b = await launch(w, h), { page } = b;
  await page.goto(`${BASE}?live=1&nosplash&name=${name}&pin=${PIN}${q}`);
  await page.waitForFunction(() => window.CC && CC.ready && CC.core.st.live, null, { timeout: 30000 });
  if (mode === 'chips') { await page.click('#modebar button[data-m=chips]'); await page.waitForFunction(() => CC.core.st.mode === 'chips'); }
  await sleep(1200); return b;
}
async function setBet(page, cents) { for (let i = 0; i < 40; i++) { const cur = await page.evaluate(() => CC.core.st.bets[CC.core.st.betIdx]); if (cur === cents) return; await page.click(cur > cents ? '#betDn' : '#betUp'); await sleep(40); } }
const open_ = (page, k) => page.evaluate((kk) => !!(CC.core.st.ctx && CC.core.st.ctx.promptOpen === kk), k);
async function promptOrDone(page, k, n0, ms = 150000) {
  const t0 = Date.now();
  for (;;) {
    if (await open_(page, k)) return 'prompt';
    if (await page.evaluate((n) => CC.dbg.rounds.length > n && !CC.core.st.busy, n0)) return 'done';
    if (await page.locator('.dial').count()) await page.evaluate(() => { const d = document.querySelector('.dial'); if (d && d._finish) d._finish(); }).catch(() => {});
    if (Date.now() - t0 > ms) throw new Error('no prompt ' + k); await sleep(250);
  }
}
const nrounds = (page) => page.evaluate(() => CC.dbg.rounds.length);
async function buyUntilPick(page, tries = 10) {
  for (let i = 0; i < tries; i++) {
    const n0 = await nrounds(page); await page.click('#buy'); await page.click('#buy_bonus1'); await page.click('#buy_confirm');
    if ((await promptOrDone(page, 'pick', n0)) === 'prompt') return n0; await sleep(600);
  }
  throw new Error('no pick');
}
async function health(page, tag, out) { const h = await page.evaluate(() => ({ mm: CC.dbg.mismatch.length, pe: CC.dbg.pull.length, err: CC.dbg.error || null })); if (h.mm || h.pe || h.err) out.push(tag + ' ' + JSON.stringify(h)); }
(async () => {
  const issues = [], names = {}, want = (k) => !ONLY || ONLY.includes(k);
  for (const mode of ['play', 'chips']) {
    // one armed account per mode (the arming is the slow part: about 400 autoplay spins)
    names[mode] = 'shot' + mode[0] + Date.now().toString(36).slice(-4);
    if (want('callback')) { const a = await armCallback(names[mode] + 'cb', mode); console.log('armed', mode, a.spins, !!a.view.cb); if (!a.view.cb) issues.push('callback not armed ' + mode); }
  }
  for (const [w, h, tag] of SIZES) for (const mode of ['play', 'chips']) {
    const f = (st) => `${OUT}/${st}_${tag}_${mode}.png`, name = names[mode] + tag;
    // ---- real
    if (want('idle') || want('info') || want('round') || want('pick') || want('more')) {
      const b = await open(w, h, name, mode), { page } = b;
      try {
        if (want('idle')) await page.screenshot({ path: f('idle') });
        if (want('info')) { await page.click('#info'); await sleep(800); await page.screenshot({ path: f('info') }); await page.evaluate(() => { const c = document.querySelector('.card.info'); if (c) { c.scrollTop = 0; c.style.maxHeight = 'none'; } }); const h = await page.evaluate(() => { const c = document.querySelector('.card.info'); return c ? { sh: c.scrollHeight, ch: c.clientHeight, txt: [...c.querySelectorAll('.plinfo p')].map((p) => p.textContent) } : null; }); if (!h) issues.push('no info card ' + tag + mode); else if (tag === '540') console.log(mode, JSON.stringify(h.txt, null, 1)); await page.keyboard.press('Escape'); await sleep(300); }
        if (want('round')) {
          await page.click('#spin'); await sleep(1500); await page.screenshot({ path: f('round') });
          await page.waitForFunction(() => !CC.core.st.busy, null, { timeout: 60000 }); await sleep(900); await page.screenshot({ path: f('round_end') }); await health(page, 'round ' + tag + mode, issues);
        }
        if (want('pick') || want('more')) {
          await setBet(page, 10); await page.click('#turbo'); const n0 = await buyUntilPick(page); await sleep(500); await page.screenshot({ path: f('pick') });
          const p = await page.evaluate(() => CC.board.hotList()[0]); await page.locator('#slots i').nth(p).click({ force: true, timeout: 5000 });
          const r = await promptOrDone(page, 'more', n0);
          if (r === 'prompt') { await sleep(500); await page.screenshot({ path: f('more') }); await page.click((await page.locator('#pl_bank').count()) ? '#pl_bank' : '#cc_more_bank'); }
          else issues.push('no more prompt in this bonus ' + tag + mode);
          await page.waitForFunction((n) => CC.dbg.rounds.length > n && !CC.core.st.busy, n0, { timeout: 120000 }); await sleep(900); await page.screenshot({ path: f('after') }); await health(page, 'bonus ' + tag + mode, issues);
        }
      } catch (e) { issues.push(`real ${tag} ${mode}: ${e.message}`); await page.screenshot({ path: f('ERR') }).catch(() => {}); } finally { await b.browser.close(); }
    }
    if (want('callback')) {
      const b = await open(w, h, names[mode] + 'cb', mode), { page } = b; try { await page.screenshot({ path: f('callback') }); await health(page, 'cb ' + tag + mode, issues); } finally { await b.browser.close(); }
    }
    // ---- mock states (same page, no server)
    for (const st of ['ghost', 'pot', 'gain', 'more_won', 'more_lost', 'warm']) {
      if (!want(st)) continue; const b = await launch(w, h), { page } = b;
      await page.goto(`${BASE}?mock=pull&state=${st === 'warm' ? 'idle' : st}&mode=${mode}`); await page.waitForFunction(() => window.CC && CC.ready, null, { timeout: 20000 });
      await sleep(st === 'gain' ? 0 : 2600); const sel = { gain: '#plBn:not([hidden])', ghost: '#head .plgh', pot: '#plpot', more_won: '#plmo', more_lost: '#plmo' }[st]; if (sel) await page.waitForSelector(sel, { timeout: 10000 }).catch(() => issues.push('no ' + sel + ' ' + tag + mode)); if (st === 'ghost' || st === 'pot') await sleep(1800); if (st === 'gain') await sleep(150); await page.screenshot({ path: f(st) }); await health(page, st + tag + mode, issues); await b.browser.close();
    }
    console.log('done', tag, mode);
  }
  if (PAGEERR.length) issues.push('PAGEERRORS ' + JSON.stringify([...new Set(PAGEERR)]));
  console.log('ISSUES', JSON.stringify(issues, null, 1)); process.exit(0);
})();
