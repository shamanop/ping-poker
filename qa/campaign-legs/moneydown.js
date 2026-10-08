'use strict';
// Campaign Trail money_down through the real shell: make the ledger refuse writes WITHOUT editing product code, then click.
// The ledger fences itself ("foreign_write") when money.jsonl changes size under it. We append ONE newline byte to the file while a run is open (a blank line, ignored by every reader),
// click CASH OUT (the settle is refused: error, run stays open), then click a pick card (a new step: refused with money_down). Evidence: toasts, events, JPEGs, ledger state.
//   node qa/campaign-legs/moneydown.js --base <url> --data <dir> --viewport 360x740 --mode chips --name chips360 --out <json> --shots <dir>
const C = require('./clib.js'); const { sleep } = C;
const base = C.argOf('--base'), DATA = C.argOf('--data'), VP = C.argOf('--viewport', '540x960'), MODE = C.argOf('--mode', 'chips'), NAME = C.argOf('--name', 'md'), OUT = C.argOf('--out', NAME + '-moneydown.json'), SHOTS = C.argOf('--shots', 'shots');
const [W, H] = VP.split('x').map(Number); C.fs.mkdirSync(SHOTS, { recursive: true });
const out = { leg: NAME, viewport: VP, mode: MODE, steps: [], fails: [], shots: [] };
const rec = (k, v) => { out.steps.push({ k, v }); console.log(k, JSON.stringify(v)); };
const fail = (w, g) => { out.fails.push({ w, g }); console.log('FAIL', w, JSON.stringify(g)); };
async function shot(b, what) { const f = C.path.join(SHOTS, NAME + '_' + what + '.jpg'); await sleep(500); let q = 55; await b.page.screenshot({ path: f, type: 'jpeg', quality: q }); while (C.fs.statSync(f).size > 120 * 1024 && q > 20) { q -= 10; await b.page.screenshot({ path: f, type: 'jpeg', quality: q }); } out.shots.push({ name: NAME + '_' + what + '.jpg', bytes: C.fs.statSync(f).size }); }
(async () => {
  const b = await C.launch(W, H); const key = (NAME + 'md' + Math.random().toString(36).slice(2, 5)).toLowerCase(); out.key = key;
  try {
    await C.signUp(b.page, base, key); b.fr = await C.openGame(b.page); await C.hook(b.page, b.fr); await C.setMode(b.fr, MODE);
    await C.pickHomeSearch(b.fr, 'ohi', /^Ohio/); await C.setStake(b.fr, 500); await b.fr.locator('#cta').click(); await C.waitView(b.fr, 'run', 10000); await sleep(400);
    await C.force(b.page, 'survive'); await C.pickCard(b.fr, 0); await b.fr.waitForFunction(() => window.__campaign.run && window.__campaign.run.steps === 1 && !window.__campaign.busy, null, { timeout: 10000 }); await sleep(500);
    const R0 = C.replay(DATA, key); rec('before_fence', { ledger: R0.bal(MODE), escrows: R0.escrows, screen: await C.screenBal(b.fr), plates: await C.plates(b.page), stake: 500, note: 'mid-run, ledger = wallet balance with the stake in escrow', steps: 1 });
    await shot(b, 'moneydown_before');
    let u = null; const io = require('socket.io-client'); u = await new Promise((res, rej) => { const s = io(base, { transports: ['websocket'] }); s.on('connect', () => s.emit('auth_signup', { name: key + 'b', pin: '1234', avatar: 'a1' })); s.on('auth_ok', () => res(s)); s.on('auth_error', (e) => { out.steps.push({ k: 'second_account_auth_error', v: e }); }); s.on('error', () => {}); setTimeout(() => rej(new Error('auth timeout')), 8000); }).catch((e) => ({ err: e.message }));   // a second account, signed up BEFORE the fence (a sign-up writes to the ledger too)
    // the foreign write: ONE newline byte appended to the ledger file under the running server
    C.fs.appendFileSync(C.path.join(DATA, 'money.jsonl'), '\n'); rec('foreign_write', 'appended 1 byte (a blank line) to money.jsonl');
    const t0 = (await C.toasts(b.fr)).length, e0 = (await C.errEvents(b.fr)).length;
    await b.fr.locator('#cta').click(); await sleep(1500);                                   // CASH OUT: the settle is refused
    const cashToasts = (await C.toasts(b.fr)).slice(t0), cashErr = (await C.errEvents(b.fr)).slice(e0);
    rec('cash_click', { toasts: cashToasts, errorCodes: cashErr, view: await C.viewOf(b.fr), screen: await C.screenBal(b.fr), plate: await C.plateTxt(b.page, MODE) });
    await shot(b, 'moneydown_cash_refused');
    if ((await C.viewOf(b.fr)) !== 'run') fail('the run closed although the ledger was fenced', await C.viewOf(b.fr));
    await sleep(2800);                                                                         // let the first toast fade so the next one is its own
    const t1 = (await C.toasts(b.fr)).length, e1 = (await C.errEvents(b.fr)).length;
    await C.force(b.page, 'survive'); const pk = await C.pickCard(b.fr, 0); await sleep(1500);   // a NEW STEP: refused with money_down
    const stepToasts = (await C.toasts(b.fr)).slice(t1), stepErr = (await C.errEvents(b.fr)).slice(e1);
    rec('step_click', { pick: pk, toasts: stepToasts, errorCodes: stepErr, view: await C.viewOf(b.fr), steps: await b.fr.evaluate(() => window.__campaign.run && window.__campaign.run.steps), busy: await b.fr.evaluate(() => window.__campaign.busy), cta: await C.ctaRead(b.fr) });
    await shot(b, 'moneydown');
    if (!stepErr.includes('money_down')) fail('no money_down error reached the client on a new step', stepErr);
    if (!stepToasts.length) fail('money_down showed NO message on screen', stepToasts);
    // a NEW start by a second account, straight on the socket (not a click): refused with money_down too
    if (u && u.emit) { const ev = await new Promise((res) => { u.on('error', (e) => { if (e && e.game === 'campaign') res(e); }); u.emit('g:campaign:start', { mode: MODE, bet: 100, home: 'OH' }); setTimeout(() => res(null), 4000); }); rec('second_account_start', ev); u.close(); }
    else rec('second_account_start', 'could not authenticate a second raw socket: ' + JSON.stringify(u));
    const R1 = C.replay(DATA, key); rec('after', { ledger: R1.bal(MODE), escrowsOpen: R1.escrows, screen: await C.screenBal(b.fr), note: 'the stake stays in escrow; nothing was paid or lost; a restart cashes the run out (recover) once the ledger opens again' });
    out.reproduced = stepErr.includes('money_down');
  } catch (e) { console.error('ERR', e.stack || e.message); fail('driver error: ' + e.message, null); try { await shot(b, 'moneydown_error'); } catch (e2) { /* ignore */ } }
  finally { await C.closeBrowser(b); }
  out.pass = out.fails.length === 0 && out.reproduced === true; C.fs.writeFileSync(OUT, JSON.stringify(out, null, 1)); console.log(NAME + ' money_down: reproduced=' + out.reproduced + ' fails=' + out.fails.length); process.exit(out.pass ? 0 : 1);
})();
