'use strict';
// P6 w3a driver 2: the slot client survives a ledger error. A stub parent plays the shell's side of the bridge and answers a spin, a buy or a decision with an `error`
// (round_closed / internal / funds). Rule under test: the board is never left stuck and the meter is never wrong: the screen unlocks and reads the balance from the server again.
//   node qa/p6-w3a/errors.js --base http://127.0.0.1:4760 [--record]
// Fixtures (qa/p6-w3a/fixtures/*.json) are the REAL messages the real shell posted down to the iframe, recorded in a first pass against the server at --base
// (missing fixtures are recorded automatically; --record forces it). The stub replays them and swaps the answer under test for the error.
// Exit 0 only if every check passes; writes qa/p6-w3a/errors-result.json.
const L = require('./lib');
const { fs, path, sleep } = L;
const BASE = L.argOf('--base', 'http://127.0.0.1:4760');
const FIX = path.join(__dirname, 'fixtures'), SHOTS = path.join(__dirname, 'shots'), RESULT = null;
const OLD_GAME = L.argOf('--old-game', null);   // negative control: serve this game.js instead of the server's (e.g. the client before e596336); the driver must then FAIL
const ONLY = L.argOf('--only', null), KINDS = L.argOf('--kinds', null), RESULT_NAME = OLD_GAME ? 'errors-negative-control-result.json' : ONLY || KINDS ? 'errors-partial-result.json' : 'errors-result.json';
const C = L.checks(), notes = [];
const note = (s) => { notes.push(s); console.log('NOTE ' + s); };
fs.mkdirSync(FIX, { recursive: true }); fs.mkdirSync(SHOTS, { recursive: true });
const WALLET2 = 123456, BET = 10;
const ERRS = {
  round_closed: { code: 'round_closed', message: 'That round was already settled', game: 'coldcall' },
  internal: { code: 'internal', message: 'Server error', game: 'coldcall' },
  funds: { code: 'funds', message: 'Not enough funds', game: 'coldcall' },
};
const jf = (n) => path.join(FIX, n + '.json');
const readFix = (n) => JSON.parse(fs.readFileSync(jf(n), 'utf8'));
const writeFix = (n, o) => fs.writeFileSync(jf(n), JSON.stringify(o));

// ================================================================== pass 1: record what the real shell sends
async function record() {
  const b = await L.launch(540, 960), { page } = b;
  try {
    await page.addInitScript(() => {   // every frame: the Cold Call iframe keeps a copy of each message its parent posts down (read only)
      if (window.parent === window) return;   // (an iframe starts as about:blank and its Window is reused for the same-origin page, so test the frame, not the path)
      window.__down = []; addEventListener('message', (e) => { if (e.source === window.parent) window.__down.push(e.data); });
    });
    const name = 'w3e' + Date.now().toString(36).slice(-6);
    await L.signUp(page, BASE, name);
    const fr = await L.openColdCall(page);
    await fr.locator('#turbo').click({ timeout: 15000 });
    await L.setBet(fr, BET);
    const down = () => fr.evaluate(() => window.__down.slice());
    const init = (await down()).find((m) => m.type === 'init'); if (!init) throw new Error('no init message recorded');
    // a plain spin
    let n0 = (await L.frState(fr)).rounds; await L.clickSpin(page, fr); await L.finishRound(page, fr, n0);
    const plain = (await down()).filter((m) => m.type === 'result' && m.payload && m.payload.status === 'done' && !m.payload.buyBonus).pop();
    // bonus1 buys until one round shows PICK YOUR LEAD and then ONE MORE CALL (pending, pending, done), taking the call
    let found = null, buys = 0;
    while (buys < 40 && !found) {
      n0 = (await L.frState(fr)).rounds; await L.buyBonus(fr, 'bonus1'); buys++; await L.finishRound(page, fr, n0, { take: true });
      const by = {}; for (const m of await down()) if (m.type === 'result' && m.payload && m.payload.buyBonus === 'bonus1' && m.payload.roundId) (by[m.payload.roundId] = by[m.payload.roundId] || []).push(m);
      for (const g of Object.values(by)) {
        const kinds = g.map((m) => (m.payload.status === 'pending' ? (m.payload.pending && m.payload.pending.k) || 'pending' : 'done'));
        if (kinds[0] === 'pick' && kinds.includes('more') && kinds[kinds.length - 1] === 'done') found = { msgs: g, kinds };
      }
    }
    if (!found) throw new Error('no bonus1 round with pick + more in ' + buys + ' buys');
    const strip = (m) => ({ type: m.type, payload: m.payload });
    writeFix('init', init); writeFix('plain', strip(plain));
    writeFix('pick_pending', strip(found.msgs[found.kinds.indexOf('pick')])); writeFix('more_pending', strip(found.msgs[found.kinds.indexOf('more')])); writeFix('buy_done', strip(found.msgs[found.msgs.length - 1]));
    writeFix('round_msgs', found.msgs.map(strip));
    writeFix('meta', { recordedAt: new Date().toISOString(), server: BASE, mode: 'play', bet: BET, buy: 'bonus1', buys, kinds: found.kinds, roundId: found.msgs[0].payload.roundId,
      initKeys: Object.keys(init), initWallet: init.wallet, pendingKeys: Object.keys(found.msgs[0].payload) });
    note(`recorded fixtures from the real shell: init, plain spin, bonus1 round [${found.kinds.join(', ')}] after ${buys} buys`);
  } finally { await L.closeBrowser(b); }
}

// ================================================================== the stub parent (the shell's side of the bridge)
const STUB_HTML = `<!doctype html><meta charset=utf-8><body style="margin:0;background:#000"><iframe id=f src="/games/coldcall/index.html?bridge=1" style="border:0;width:540px;height:960px"></iframe><script>
const f = document.getElementById('f'), S = window.__stub = { up: [], down: [], hellos: 0, inits: 0, init: [], spin: [], decide: [], errAt: 0 };
S.send = (m) => { S.down.push({ at: Date.now(), type: m.type }); f.contentWindow.postMessage(m, '*'); };
S.err = (e, reqId) => { S.errAt = Date.now(); S.send(Object.assign({ type: 'error', reqId }, e)); };
const answer = (step, reqId) => { if (!step) return; if (step.err) S.err(step.err, reqId); else S.send({ type: 'result', reqId, payload: step.payload }); };
addEventListener('message', (ev) => {
  if (ev.source !== f.contentWindow) return; const m = ev.data || {}; S.up.push(Object.assign({ at: Date.now() }, m));
  if (m.type === 'hello') { S.hellos++; const i = S.init[Math.min(S.inits, S.init.length - 1)]; S.inits++; if (i) S.send(i); }
  else if (m.type === 'spin') answer(S.spin.shift(), m.reqId);
  else if (m.type === 'decide') answer(S.decide.shift(), m.reqId);
});
</script>`;
function patchInit(init, { play, cb }) {            // same init, other wallet / Callback
  const m = JSON.parse(JSON.stringify(init)), setW = (o) => { if (o && typeof o === 'object' && typeof o.play === 'number') o.play = play; };
  setW(m.wallet); setW(m.balances); if (m.state) { setW(m.state.wallet); setW(m.state.balances); const pv = m.state.pull && m.state.pull.play; if (pv) { if (cb === null) delete pv.cb; else if (cb) pv.cb = cb; } }
  return m;
}

// ---- player actions in the stub (real clicks)
async function waitPrompt(page, fr, kind, ms = 90000) {
  const t0 = Date.now(); let lastDial = 0;
  for (;;) {
    const s = await L.frState(fr); if (s.prompt === kind) { await L.armedWait(fr); return; }
    if (Date.now() - lastDial > 1500 && (await L.tapDial(page, fr))) lastDial = Date.now();
    if (Date.now() - t0 > ms) throw new Error('prompt ' + kind + ' did not show: ' + JSON.stringify(s));
    await sleep(250);
  }
}

// ---- what must hold after the error, within 3 s
async function observe(page, fr) {
  const st = await fr.evaluate(() => {
    const q = (s) => document.querySelectorAll(s).length, S = CC.core.st;
    return { busy: S.busy, label: document.getElementById('spin').textContent.trim(), spinRun: document.getElementById('spin').classList.contains('run'), bal: document.getElementById('bal').textContent, error: CC.dbg.error || null,
      scrims: q('#ov .scrim'), pullNodes: q('#pl_more, #pl_bank, #cc_more_take, #cc_more_bank, #hud.dec, #ribbon.ask, .slots i.pl-late, .slots i.pl-arm, #app.pl-busy'),
      betUpDis: document.getElementById('betUp').disabled, betDnDis: document.getElementById('betDn').disabled, betIdx: S.betIdx, bets: S.bets.length, betTxt: document.getElementById('bet').textContent, prompt: (S.ctx && S.ctx.promptOpen) || null };
  });
  const sv = await page.evaluate(() => ({ errAt: __stub.errAt, hellos: __stub.up.filter((m) => m.type === 'hello' && m.at >= __stub.errAt).length, spins: __stub.up.filter((m) => m.type === 'spin').length }));
  return { ...st, ...sv, meter: L.toUnits(st.bal, 'play') };
}
const isOk = (s) => s.errAt > 0 && !s.busy && s.label === 'SPIN' && !s.spinRun && s.scrims === 0 && s.pullNodes === 0 && !s.error && s.hellos >= 1 && s.meter === WALLET2;

async function afterError(page, fr, kind, id, wallet1) {
  const tag = `${kind}/${id}`;
  let s = await observe(page, fr); const t0 = s.errAt || Date.now();
  while (!isOk(s) && Date.now() - t0 < 3000) { await sleep(120); s = await observe(page, fr); }
  const ms = s.errAt ? Date.now() - s.errAt : -1;
  C.ok(`${tag}: the error was delivered`, s.errAt > 0, s.errAt);
  C.ok(`${tag}: not busy, SPIN idle (label ${JSON.stringify(s.label)}), within 3 s`, !s.busy && s.label === 'SPIN' && !s.spinRun, { busy: s.busy, label: s.label, spinRun: s.spinRun, ms });
  C.ok(`${tag}: no scrim, no prompt node left on screen`, s.scrims === 0 && s.pullNodes === 0, { scrims: s.scrims, pullNodes: s.pullNodes });
  C.ok(`${tag}: CC.dbg.error unset`, !s.error, s.error);
  C.ok(`${tag}: the iframe sent hello AFTER the error`, s.hellos >= 1, { hellosAfterError: s.hellos });
  C.eq(`${tag}: the meter shows the server's second init (${WALLET2} cents, first was ${wallet1}) within 3 s (settled ${ms} ms after the error)`, s.meter, WALLET2);
  // the bet buttons work: a real click moves the bet and back
  const up = !s.betUpDis && s.betIdx < s.bets - 1; const b1 = s.betIdx;
  await fr.locator(up ? '#betUp' : '#betDn').click({ timeout: 8000 }).catch(() => {}); await sleep(150);
  const s1 = await observe(page, fr); await fr.locator(up ? '#betDn' : '#betUp').click({ timeout: 8000 }).catch(() => {}); await sleep(150);
  const s2 = await observe(page, fr);
  C.ok(`${tag}: the bet buttons work (bet index ${b1} -> ${s1.betIdx} -> ${s2.betIdx})`, s1.betIdx !== b1 && s2.betIdx === b1, { b1, s1: s1.betIdx, s2: s2.betIdx });
  return { pre: s2, label: s.label };
}
async function nextSpinSends(page, fr, tag, paid) {
  const before = await page.evaluate(() => __stub.up.filter((m) => m.type === 'spin').length), pre = await observe(page, fr);
  await L.clickSpin(page, fr);
  let sent = null; for (let i = 0; i < 20 && !sent; i++) { await sleep(150); sent = await page.evaluate((n) => __stub.up.filter((m) => m.type === 'spin')[n] || null, before); }
  C.ok(`${tag}: a real click on SPIN sends a spin message (the board is usable)`, !!sent, sent);
  if (paid) {   // E6: after the second init (no Callback) the button is a normal paid SPIN at the bet on screen, not the free Callback at the Callback's own bet
    const cur = await fr.evaluate(() => CC.core.st.bets[CC.core.st.betIdx]), want = '$' + (cur / 100).toFixed(2);
    C.ok(`${tag}: that spin is a normal paid one: label SPIN, bet shown ${pre.betTxt} (= ${want}), message bet ${sent && sent.bet} (the Callback's own bet was ${BET}; not a free Callback)`,
      pre.label === 'SPIN' && pre.betTxt === want && !!sent && sent.bet === cur && !sent.buy && sent.mode === 'play', { label: pre.label, betTxt: pre.betTxt, want, sent });
  }
}

// ================================================================== the cases
async function runCase(b, F, kind, id) {
  const { page } = b, err = ERRS[kind], tag = `${kind}/${id}`;
  if (OLD_GAME) await page.route(BASE + '/games/coldcall/game.js*', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(OLD_GAME) }));
  await page.route(BASE + '/__stub__', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: STUB_HTML }));
  await page.goto(BASE + '/__stub__', { waitUntil: 'domcontentloaded', timeout: 60000 });
  const wallet1 = F.init.wallet.play;
  const cb = id === 'E6' ? { bet: BET, id: 'cbfixture0001' } : undefined;
  const init1 = patchInit(F.init, { play: wallet1, cb }), init2 = patchInit(F.init, { play: WALLET2, cb: null });
  const steps = {
    E1: { spin: [{ err }], decide: [] }, E2: { spin: [{ err }], decide: [] }, E6: { spin: [{ err }], decide: [] },
    E3: { spin: [{ payload: F.pick_pending.payload }], decide: [{ payload: F.more_pending.payload }, { err }] }, E3b: { spin: [{ payload: F.pick_pending.payload }], decide: [{ payload: F.more_pending.payload }, { err }] },
    E4: { spin: [{ payload: F.pick_pending.payload }], decide: [{ err }] },
    E5: { spin: [{ payload: F.pick_pending.payload }], decide: [] }, E5m: { spin: [{ payload: F.pick_pending.payload }], decide: [{ payload: F.more_pending.payload }] },
  }[id];
  await page.evaluate(({ i1, i2, st }) => { __stub.init = [i1, i2]; __stub.spin = st.spin; __stub.decide = st.decide; }, { i1: init1, i2: init2, st: steps });
  const fr = await (async () => { for (let i = 0; i < 120; i++) { const f = L.frameOf(page); if (f) return f; await sleep(250); } throw new Error('no frame'); })();
  await fr.waitForFunction(() => window.CC && CC.ready, null, { timeout: 120000 });
  const go = fr.locator('#go'); if (await go.count()) { await go.click({ timeout: 20000 }); await sleep(900); }
  await fr.waitForFunction(() => CC.core.st.live, null, { timeout: 60000 });
  await fr.locator('#turbo').click({ timeout: 15000 });
  if (id !== 'E6' && !(await L.setBet(fr, BET))) throw new Error('bet ' + BET + ' not on the ladder');
  if (id === 'E6') { const s = await observe(page, fr); C.eq(`${tag}: with a Callback pending the button reads CALLBACK`, s.label, 'CALLBACK'); }
  else await L.setBet(fr, BET);
  const buy = () => L.buyBonus(fr, 'bonus1');
  switch (id) {
    case 'E1': case 'E6': await L.clickSpin(page, fr); break;
    case 'E2': await buy(); break;
    case 'E3': case 'E3b': await buy(); await waitPrompt(page, fr, 'pick'); await L.clickLit(fr); await waitPrompt(page, fr, 'more'); await L.clickMore(fr, id === 'E3'); break;
    case 'E4': await buy(); await waitPrompt(page, fr, 'pick'); await L.clickLit(fr); break;
    case 'E5': await buy(); await waitPrompt(page, fr, 'pick'); await page.evaluate((e) => __stub.err(e, undefined), err); break;
    case 'E5m': await buy(); await waitPrompt(page, fr, 'pick'); await L.clickLit(fr); await waitPrompt(page, fr, 'more'); await page.evaluate((e) => __stub.err(e, undefined), err); break;
  }
  const r = await afterError(page, fr, kind, id, wallet1);
  if (id === 'E3' && kind !== 'funds') { const f = path.join(SHOTS, `errors_${kind}_E3_after_error.jpg`); for (const q of [62, 45, 30]) { await page.screenshot({ path: f, type: 'jpeg', quality: q }); if (fs.statSync(f).size < 150 * 1024) break; } }
  await nextSpinSends(page, fr, tag, id === 'E6');
  return r;
}

(async () => {
  let b = null;
  try {
    if (L.hasFlag('--record') || !fs.existsSync(jf('init')) || !fs.existsSync(jf('more_pending'))) await record();
    const F = Object.fromEntries(['init', 'plain', 'pick_pending', 'more_pending', 'buy_done'].map((n) => [n, readFix(n)]));
    note('fixtures: ' + JSON.stringify(readFix('meta')).slice(0, 300));
    const plan = [['round_closed', ['E1', 'E2', 'E3', 'E3b', 'E4', 'E5', 'E5m', 'E6']], ['internal', ['E1', 'E2', 'E3', 'E3b', 'E4', 'E5', 'E5m', 'E6']], ['funds', ['E1', 'E2']]];
    for (const [kind, ids] of plan) for (const id of ids) {
      if ((KINDS && !KINDS.split(',').includes(kind)) || (ONLY && !ONLY.split(',').includes(id))) continue;
      b = await L.launch(540, 960);   // a fresh browser per case: one process at a time, closed before the next
      try { await runCase(b, F, kind, id); }
      catch (e) { C.add(`${kind}/${id}: case ran to the end`, false, 'no exception', String(e && e.stack || e).slice(0, 500)); }
      finally { const pe = b.logs.filter((l) => !/favicon\.ico/.test(l)); if (pe.length) note(`${kind}/${id}: page errors: ${JSON.stringify(pe).slice(0, 300)}`); C.ok(`${kind}/${id}: no page error`, !b.logs.some((l) => /^pageerror/.test(l)), b.logs.filter((l) => /^pageerror/.test(l))); await L.closeBrowser(b); b = null; }
    }
  } catch (e) { C.add('driver ran to the end without an exception', false, 'no exception', String(e && e.stack || e).slice(0, 700)); }
  finally { if (b) await L.closeBrowser(b); }
  const ok = C.failed === 0;
  const RES = path.join(__dirname, RESULT_NAME); fs.writeFileSync(RES, JSON.stringify({ driver: 'errors.js', base: BASE, ...(OLD_GAME ? { negativeControl: OLD_GAME } : {}), at: new Date().toISOString(), passed: C.passed, failed: C.failed, notes, rows: C.rows }, null, 1));
  console.log(`ERRORS ${ok ? 'PASS' : 'FAIL'}: ${C.passed} passed, ${C.failed} failed -> ${RES}`);
  process.exit(ok ? 0 : 1);
})();
