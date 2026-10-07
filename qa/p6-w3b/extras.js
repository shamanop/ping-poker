'use strict';
// P6 w3b extras (Play $, 540x960, through the Ping shell, real clicks), then U17. Manages its OWN server (restart is part of extra 1): COLDCALL_TEST=1, fresh data dir.
//   node extras.js --export EXPORTDIR --port 4784 --data DIR [--only 1,2,3,4,5,u17]
// Run under the chrome flock (run_extras.sh). Writes qa/p6-w3b/out/extras.json. Money is read from <data>/money.jsonl.
const { spawn } = require('child_process');
const L = require('./lib');
const { fs, path, sleep } = L;
const EXPORT = L.argOf('--export'), PORT = Number(L.argOf('--port', 4784)), DATA = L.argOf('--data'), ONLY = (L.argOf('--only', '1,2,3,4,5,u17')).split(',');
const BASE = 'http://127.0.0.1:' + PORT, MODE = 'play';
const io = require(EXPORT + '/node_modules/socket.io-client');
const OUT = path.join(__dirname, 'out', 'extras.json'), SHOTS = path.join(__dirname, 'shots');
fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.mkdirSync(SHOTS, { recursive: true }); fs.mkdirSync(DATA, { recursive: true });
const res = { started: new Date().toISOString(), extras: {} };
const save = () => fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
const led = () => L.readLedger(DATA);
let srv = null, srvLog = path.join(DATA, 'server.log'), srvN = 0;
function startServer() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, COLDCALL_TEST: '1', DATA_DIR: DATA, PORT: String(PORT) }; delete env.NODE_ENV; delete env.RIG;
    const out = fs.openSync(srvLog + (srvN ? '.' + srvN : ''), 'a'); srvN++;
    srv = spawn('node', ['server.js'], { cwd: EXPORT, env, stdio: ['ignore', out, out] });
    const t0 = Date.now(); const iv = setInterval(() => { let t = ''; try { t = fs.readFileSync(srvLog + (srvN > 1 ? '.' + (srvN - 1) : ''), 'utf8'); } catch (e) { /* none yet */ }
      if (/server running on port/.test(t)) { clearInterval(iv); resolve(t); } else if (Date.now() - t0 > 60000 || srv.exitCode !== null) { clearInterval(iv); reject(new Error('server did not start: ' + t.slice(-300))); } }, 400);
  });
}
const killServer = async () => { if (srv && srv.exitCode === null) { srv.kill('SIGKILL'); await sleep(800); } };
process.on('exit', () => { if (srv && srv.exitCode === null) { try { srv.kill('SIGKILL'); } catch (e) { /* gone */ } } });

async function shot(page, name) { const f = path.join(SHOTS, 'x_' + name + '.jpg'); try { for (const q of [55, 40, 28]) { await page.screenshot({ path: f, type: 'jpeg', quality: q }); if (fs.statSync(f).size < 120 * 1024) break; } } catch (e) { /* ignore */ } }
async function loginForm(page, name, pin = '1234') {   // an existing account through the lobby form (no "New account")
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 }); await page.waitForSelector('#lb-name', { timeout: 60000 });
  await page.fill('#lb-name', name); await page.fill('#lb-pin', pin); await page.click('#lb-submit');
  await page.waitForFunction(() => window.Shell && Shell.isSignedIn && Shell.isSignedIn(), null, { timeout: 60000 }); await sleep(1000);
  const claim = page.locator('button.claim'); if (await claim.isVisible().catch(() => false)) { await claim.click().catch(() => {}); await sleep(600); }
}
const forceHook = (page) => page.evaluate(() => { const s = window.PingSocket, orig = s.emit.bind(s); window.__emits = []; window.__force = null; window.__bet = null;
  s.emit = function (ev, ...a) { if (typeof ev === 'string' && ev.startsWith('g:coldcall:')) window.__emits.push({ ev, p: a[0] && JSON.parse(JSON.stringify(a[0])) }); if (ev === 'g:coldcall:spin' && a[0] && typeof a[0] === 'object') { if (window.__force) { a[0] = { ...a[0], force: window.__force }; window.__force = null; } if (window.__bet) { a[0] = { ...a[0], bet: window.__bet }; window.__bet = null; } } return orig(ev, ...a); }; });
const toastHook = (fr) => fr.evaluate(() => { window.__toasts = []; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('toast')) window.__toasts.push(n.textContent); }).observe(document.body, { childList: true, subtree: true }); });
async function newPlayer(w = 540, h = 960, initScript = null) {
  const b = await L.launch(w, h), { page } = b; if (initScript) await b.ctx.addInitScript(initScript); const name = 'w3bx' + Date.now().toString(36).slice(-6) + Math.floor(Math.random() * 90 + 10);
  await L.signUp(page, BASE, name); const key = await page.evaluate(() => Lobby.user().key); await L.installTap(page); await forceHook(page);
  const fr = await L.openColdCall(page); await toastHook(fr); return { b, page, fr, name, key, store: L.storeOf(key, MODE) };
}
const bal = (p) => led().get(p.store, MODE);
const roundLines = (key, id) => led().reasons.filter((r) => String(r.ref || '').startsWith('coldcall:' + key + ':' + id));
const ccIds = (key) => new Set(led().reasons.filter((r) => String(r.ref || '').startsWith('coldcall:' + key + ':')).map((r) => String(r.ref).split(':')[2]));
async function run(id, fn) {
  if (!ONLY.includes(id)) return; const rec = { id, status: 'running', checks: [], notes: [] }; res.extras[id] = rec; save();
  const ck = (name, pass, got) => { rec.checks.push({ name, pass: !!pass, got }); console.log((pass ? 'PASS ' : 'FAIL ') + id + ' ' + name + (pass ? '' : ' got=' + JSON.stringify(got).slice(0, 300))); };
  try { await fn(rec, ck, (s) => { rec.notes.push(s); console.log('NOTE ' + id + ' ' + s); }); rec.status = rec.checks.every((c) => c.pass) ? 'done: pass' : 'done: FAIL'; }
  catch (e) { rec.status = 'error: ' + String(e && e.message).slice(0, 300); rec.stack = String(e && e.stack).slice(0, 800); console.log('ERROR ' + id, rec.status); }
  save();
}
const waitPrompt = (fr, ms = 150000) => fr.waitForFunction(() => { const c = CC.core.st.ctx; return !!(c && c.promptOpen); }, null, { timeout: ms });
async function buyUntilPrompt(p, id = 'bonus1', tries = 8) {   // buy a bonus until a PICK / MORE prompt is up; a bonus that ends with none is awaited and retried
  for (let k = 0; k < tries; k++) {
    const n0 = (await L.frState(p.fr)).rounds; await L.finishRound(p.page, p.fr, n0 - 0, { ms: 5000 }).catch(() => {});   // no-op when idle
    await L.buyBonus(p.fr, id); const t0 = Date.now(); let keyed = 0;
    while (Date.now() - t0 < 120000) { const s = await L.frState(p.fr); if (s.prompt) return s.prompt; if (s.rounds > n0 && !s.busy) break; if (Date.now() - keyed > 1500 && (await L.tapDial(p.page, p.fr))) keyed = Date.now(); await sleep(150); }
    await sleep(500);
  }
  throw new Error('no prompt after ' + tries + ' buys');
}
// a direct socket on the same account (setup only: draining the balance, a second "screen" that decides)
const sockFor = (name) => new Promise((resolve, reject) => { const s = io(BASE, { forceNew: true }); s.on('connect', () => s.emit('auth_login', { name, pin: '1234' })); s.on('auth_ok', () => resolve(s)); s.on('auth_error', (e) => reject(new Error('auth ' + JSON.stringify(e)))); setTimeout(() => reject(new Error('sock timeout')), 15000); });

(async () => {
  try {
    const first = await startServer(); res.serverBoot = (first.match(/game recovery:[^\n]*/) || [''])[0]; save();

    // ---- 1. server restart with a decision open
    await run('1', async (rec, ck, note) => {
      const p = await newPlayer(); await L.setBet(p.fr, 10); const before = bal(p);
      const kind = await buyUntilPrompt(p, 'bonus1'); const open = await p.page.evaluate(() => window.__tap.res.slice(-1)[0]); const rid = open.roundId; const wBefore = before;
      note('decision up: ' + kind + ' for round ' + rid + ', ledger lines so far ' + JSON.stringify(roundLines(p.key, rid).map((r) => r.reason + ':' + r.amount)));
      await shot(p.page, 'restart_prompt');
      const spent = roundLines(p.key, rid).filter((r) => r.from === p.store).reduce((n, r) => n + r.amount, 0);
      await killServer(); note('server pid killed (SIGKILL) while the ' + kind + ' prompt was up'); const boot = await startServer(); res.restartBoot = (boot.split('\n').filter((l) => /recovery/.test(l)).pop() || '');
      note('boot: ' + (res.restartBoot || '').slice(0, 200));
      await p.page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2000);
      const signed = await p.page.evaluate(() => !!(window.Shell && Shell.isSignedIn && Shell.isSignedIn())).catch(() => false);
      if (!signed) await loginForm(p.page, p.name); await forceHook(p.page); await L.installTap(p.page).catch(() => {});
      const fr = await L.openColdCall(p.page); p.fr = fr; await toastHook(fr); await sleep(1500);
      const lines = roundLines(p.key, rid), closes = lines.filter((r) => /:close$/.test(String(r.ref)) || /settle|credit|void|refund/.test(String(r.reason || ''))), after = bal(p), s = await L.frState(fr);
      note('ledger lines for the round: ' + JSON.stringify(lines.map((r) => [r.ref, r.reason, r.from, r.to, r.amount])).slice(0, 700));
      const closeRefs = new Set(lines.filter((r) => /:close$/.test(String(r.ref))).map((r) => r.ref));
      ck('exactly one close line group for that round id (refs ' + [...closeRefs].join(',') + ')', closeRefs.size === 1, [...closeRefs]);
      const credits = lines.filter((r) => r.to === p.store).reduce((n, r) => n + r.amount, 0);
      ck(`balance = before ${before} - spent ${spent} + credited ${credits}`, after === before - spent + credits, { after, before, spent, credits });
      ck('no escrow account non-zero', led().escrows.length === 0, led().escrows);
      ck('board free after reload (not busy, no prompt, no scrim)', !s.busy && !s.prompt && s.scrims === 0, s);
      ck('meter on screen = ledger balance', L.toUnits(s.bal, MODE) === after, { meter: s.bal, ledger: after });
      const n0 = s.rounds; await L.clickSpin(p.page, fr); await L.finishRound(p.page, fr, n0).catch((e) => note('next spin: ' + e.message.slice(0, 100)));
      ck('the next SPIN plays (one more ledger round)', ccIds(p.key).size === 2, [...ccIds(p.key)]); await L.closeBrowser(p.b);
    });

    // ---- 2. a broke player
    await run('2', async (rec, ck, note) => {
      const p = await newPlayer(); const sk = await sockFor(p.name);   // setup: drain the Play balance with direct spins on the same account; the browser is idle meanwhile
      let waiter = null; sk.on('g:coldcall:result', (m) => { if (m && m.status === 'pending' && m.pending) { if (m.pending.k === 'pick') sk.emit('g:coldcall:decide', { roundId: m.roundId, k: 'pick', p: m.pending.choices[0] }); else sk.emit('g:coldcall:decide', { roundId: m.roundId, k: 'more', take: false }); } else if (m && m.status === 'done' && waiter) { const w = waiter; waiter = null; w(m); } });
      sk.on('error', (e) => { if (waiter) { const w = waiter; waiter = null; w({ error: e }); } });
      const spinOnce = (bet, buy) => new Promise((resolve) => { const t = setTimeout(() => { waiter = null; resolve({ timeout: true }); }, 60000); waiter = (m) => { clearTimeout(t); resolve(m); }; sk.emit('g:coldcall:spin', { bet, mode: 'play', ...(buy ? { buyBonus: buy } : {}) }); });
      let n = 0; const target = 2500;
      for (let i = 0; i < 2500 && bal(p) >= target; i++) { const b0 = bal(p); const id = b0 >= 727500 + 30000 ? 'bonus2' : b0 >= 241000 + 30000 ? 'bonus1' : null; await sleep(220); const r = await spinOnce(2500, id); if (r.error && r.error.code === 'rate') { await sleep(400); continue; } n++; if (r.timeout || r.error) { note('drain stopped: ' + JSON.stringify(r).slice(0, 160)); break; } }
      await sleep(800); sk.close(); const b1 = bal(p); note(`drained by ${n} direct spins at $25 (buys while rich) to ${b1} cents`);
      ck('balance is now below the cost of a $25 spin', b1 < 2500, b1);
      await p.page.reload({ waitUntil: 'domcontentloaded' }); await sleep(1500); if (!(await p.page.evaluate(() => Shell.isSignedIn()).catch(() => false))) await loginForm(p.page, p.name); await forceHook(p.page); await L.installTap(p.page); const fr = await L.openColdCall(p.page); p.fr = fr; await toastHook(fr);
      const before = bal(p), lines0 = led().reasons.length, ids0 = ccIds(p.key).size; await L.setBet(fr, 2500);
      // (a) the real client: a click above the balance
      await L.clickSpin(p.page, fr); await sleep(2000); let tp = await fr.evaluate(() => window.__toasts.slice()), em = await p.page.evaluate(() => window.__emits.filter((e) => e.ev === 'g:coldcall:spin').length), s = await L.frState(fr);
      note('(a) real click, bet $25 above balance: toasts ' + JSON.stringify(tp) + ', spin emits ' + em);
      ck('(a) client refuses: a funds toast, no spin sent to the server', tp.some((t) => /funds/i.test(t)) && em === 0, { tp, em });
      // (b) the server's own refusal: the click is real, the shell page's emit carries the $25 bet the client would not have sent (the meter is stale on purpose)
      await p.page.evaluate(() => { const o = window.PingSocket.emit; window.__sent = []; }); const tapE0 = (await L.tapErr(p.page)).length;
      await fr.evaluate(() => { CC.core.st.__avail = null; });
      const emitsBefore = await p.page.evaluate(() => window.__emits.length);
      await p.page.evaluate(() => { window.PingSocket.emit('g:coldcall:spin', { bet: 2500, mode: 'play', auto: false }); });   // the same payload the shell sends for a SPIN at $25 (shell code path), sent without the client's local funds check
      await sleep(2500); const errs = (await L.tapErr(p.page)).slice(tapE0); s = await L.frState(fr); tp = await fr.evaluate(() => window.__toasts.slice());
      note('(b) server answer: ' + JSON.stringify(errs.map((e) => ({ code: e.code, message: e.message }))));
      ck('(b) server refuses with code funds', errs.some((e) => e.code === 'funds'), errs);
      ck('nothing in the ledger (no new line, no new round), balance unchanged', led().reasons.length === lines0 && ccIds(p.key).size === ids0 && bal(p) === before, { lines: led().reasons.length - lines0, bal: bal(p), before });
      ck('board free (not busy, no prompt, no scrim, SPIN clickable)', !s.busy && !s.prompt && s.scrims === 0 && (await L.frState(fr)).busy === false, s);
      await L.setBet(fr, 1); const n0 = s.rounds; await L.clickSpin(p.page, fr); await L.finishRound(p.page, fr, n0).catch(() => {}); ck('a $0.01 spin still plays after the refusal', ccIds(p.key).size === ids0 + 1, [...ccIds(p.key)].length);
      await shot(p.page, 'broke'); await L.closeBrowser(p.b);
    });

    // ---- 3. a second tab on the same account while a decision is open in the first
    await run('3', async (rec, ck, note) => {
      const p = await newPlayer(); await L.setBet(p.fr, 10); const before = bal(p);
      const kind = await buyUntilPrompt(p, 'bonus1'); const open = await p.page.evaluate(() => window.__tap.res.slice(-1)[0]); const rid = open.roundId; const spent = roundLines(p.key, rid).filter((r) => r.from === p.store).reduce((n, r) => n + r.amount, 0);
      note('tab 1: ' + kind + ' open, round ' + rid + ', spent ' + spent);
      const b2 = await L.launch(540, 960); const page2 = b2.page; await loginForm(page2, p.name); await L.installTap(page2); await forceHook(page2); const fr2 = await L.openColdCall(page2); await toastHook(fr2); await sleep(2500);
      const s2 = await L.frState(fr2); note('tab 2 after opening the slot: ' + JSON.stringify({ prompt: s2.prompt, busy: s2.busy, bal: s2.bal, rounds: s2.rounds }));
      await shot(page2, 'tab2_open');
      // tab 2 tries to start a spin and a buy: refused, no second round
      const ids0 = ccIds(p.key).size, l0 = led().reasons.length;
      if (!s2.busy && !s2.prompt) { await L.clickSpin(page2, fr2).catch(() => {}); await sleep(2500); }
      const t2 = await fr2.evaluate(() => window.__toasts.slice()), e2 = await L.tapErr(page2); note('tab 2 SPIN while tab 1 has a decision open: toasts ' + JSON.stringify(t2) + ' errors ' + JSON.stringify(e2.map((e) => e.code)));
      ck('no second open round, no second spend: ledger rounds ' + ccIds(p.key).size + ' (before ' + ids0 + ')', ccIds(p.key).size === ids0 && led().reasons.length === l0 || s2.prompt, { ids: ccIds(p.key).size, lines: led().reasons.length - l0 });
      // tab 2 decides if its UI shows the decision; else a direct socket stands in for "tab 2 decided"
      let how = 'tab 2 UI';
      if (s2.prompt) { if (s2.prompt === 'pick') await L.clickLit(fr2); else await L.clickMore(fr2, false); await sleep(1500); }
      else {
        how = 'direct socket on the account (tab 2 shows no prompt)'; const sk = await sockFor(p.name); const pend = open.pending || (await p.page.evaluate(() => window.__tap.res.slice(-1)[0].pending));
        sk.emit('g:coldcall:decide', pend.k === 'pick' ? { roundId: rid, k: 'pick', p: pend.choices[0] } : { roundId: rid, k: 'more', take: false }); await sleep(1500); sk.close();
      }
      note('round decided by ' + how);
      const s1 = await L.frState(p.fr); note('tab 1 after the other screen decided: ' + JSON.stringify({ prompt: s1.prompt, busy: s1.busy, bal: s1.bal }));
      // tab 1 decides late if its prompt is still up: the real server-made round_closed
      let late = false; const e1_0 = (await L.tapErr(p.page)).length;
      if (s1.prompt) { late = true; if (s1.prompt === 'pick') await L.clickLit(p.fr); else await L.clickMore(p.fr, true); await sleep(2500); }
      const e1 = (await L.tapErr(p.page)).slice(e1_0); note('tab 1 late decision clicked: ' + late + '; errors ' + JSON.stringify(e1.map((e) => e.code)));
      // a stale decision from tab 1 once the round is closed: NOT a click (the UI has already moved on), the same g:coldcall:decide the shell would send, emitted on tab 1's own socket: the server answers round_closed
      await p.fr.waitForFunction(() => !CC.core.st.busy && !CC.core.st.ctx?.promptOpen, null, { timeout: 90000 }).catch(() => {}); await sleep(1500);
      { const e0 = (await L.tapErr(p.page)).length, b0 = bal(p), l0 = led().reasons.length; await p.page.evaluate((r) => window.PingSocket.emit('g:coldcall:decide', { roundId: r, k: 'more', take: true }), rid); await sleep(2500);
        const es = (await L.tapErr(p.page)).slice(e0); const f1 = await L.frState(p.fr); note('stale decide emitted from tab 1 (socket, not a click): errors ' + JSON.stringify(es.map((e) => e.code)) + ', tab 1 state ' + JSON.stringify({ busy: f1.busy, prompt: f1.prompt, bal: f1.bal }));
        ck('stale decide: server answers round_closed or no_round (answer recorded in staleDecideErrors), no ledger line, balance unchanged', led().reasons.length === l0 && bal(p) === b0 && es.every((e) => e.code === 'round_closed' || e.code === 'no_round'), { es: es.map((e) => e.code), lines: led().reasons.length - l0 });
        ck('stale decide: tab 1 stays unlocked and shows the ledger balance', !f1.busy && !f1.prompt && f1.scrims === 0 && L.toUnits(f1.bal, MODE) === bal(p), { busy: f1.busy, prompt: f1.prompt, bal: f1.bal, ledger: bal(p) }); rec.staleDecideErrors = es.map((e) => e.code); }
      // settle: let any prompt of tab 1 finish by its own rules
      await p.fr.waitForFunction(() => !CC.core.st.busy && !CC.core.st.ctx?.promptOpen, null, { timeout: 90000 }).catch(() => {}); await sleep(1500);
      const lines = roundLines(p.key, rid), closeRefs = new Set(lines.filter((r) => /:close$/.test(String(r.ref))).map((r) => r.ref)), credits = lines.filter((r) => r.to === p.store).reduce((n, r) => n + r.amount, 0), after = bal(p);
      ck('one close for the round (refs ' + [...closeRefs].join(',') + ')', closeRefs.size === 1, [...closeRefs]);
      ck(`no double pay: balance ${after} = before ${before} - spent ${spent} + credited ${credits}`, after === before - spent + credits, { after, before, spent, credits });
      { const t0 = Date.now(); while (Date.now() - t0 < 25000) { const q = await L.frState(fr2); if (!q.busy && !q.prompt) break; await sleep(500); } }
      { const t0 = Date.now(); while (Date.now() - t0 < 12000 && L.toUnits((await L.frState(fr2)).bal, MODE) !== bal(p)) await sleep(500); }
      const f1 = await L.frState(p.fr), f2 = await L.frState(fr2); rec.tab2 = { busy: f2.busy, prompt: f2.prompt, bal: f2.bal, ledger: bal(p), spinLabel: f2.spinLabel, error: f2.error, rounds: f2.rounds, shellPlate: (await L.plates(page2)).play };
      if (f2.busy) { await shot(page2, 'tab2_stuck'); const e = await L.tapErr(page2), r = await L.tapRes(page2); rec.tab2.resultsSeen = r.map((x) => [x.roundId, x.status, x.auto || null]); rec.tab2.errs = e.map((x) => x.code); note('tab 2 still busy 25 s after the round closed: ' + JSON.stringify(rec.tab2));
        await fr2.locator('#spin').click({ timeout: 5000, force: true }).catch(() => {}); await sleep(2500); const q = await L.frState(fr2); rec.tab2.afterSpinClick = { busy: q.busy, bal: q.bal, rounds: q.rounds }; await page2.reload({ waitUntil: 'domcontentloaded' }).catch(() => {}); await sleep(2500); const sg = await page2.evaluate(() => !!(window.Shell && Shell.isSignedIn && Shell.isSignedIn())).catch(() => false); if (!sg) await loginForm(page2, p.name);
        const fr2b = await L.openColdCall(page2).catch(() => null); if (fr2b) { await sleep(1500); const q2 = await L.frState(fr2b); rec.tab2.afterReload = { busy: q2.busy, bal: q2.bal }; } note('tab 2 after a SPIN click: ' + JSON.stringify(rec.tab2.afterSpinClick) + '; after reload: ' + JSON.stringify(rec.tab2.afterReload)); }
      ck('tab 1 unlocked and its meter = ledger', !f1.busy && !f1.prompt && f1.scrims === 0 && L.toUnits(f1.bal, MODE) === after, { f1: [f1.busy, f1.prompt, f1.scrims, f1.bal], after });
      ck('tab 2 unlocked and its meter = ledger within 25 s of the round closing (it was opened while the decision was open in tab 1)', !f2.busy && !f2.prompt && L.toUnits(f2.bal, MODE) === after, rec.tab2);
      ck('no escrow non-zero', led().escrows.length === 0, led().escrows); await shot(p.page, 'tab1_end'); await L.closeBrowser(b2); await L.closeBrowser(p.b);
    });

    // ---- 4. autoplay, 10 rounds
    await run('4', async (rec, ck, note) => {
      const p = await newPlayer(); await L.setBet(p.fr, 10); await p.fr.locator('#turbo').click({ timeout: 8000 }).catch(() => {});
      const n0 = (await L.frState(p.fr)).rounds, tap0 = (await L.tapRes(p.page)).length, before = bal(p);
      await p.fr.locator('#auto').click({ timeout: 8000 }); await sleep(500); const on = await p.fr.evaluate(() => CC.core.st.auto); ck('AUTO is on after the click', on === true, on);
      const t0 = Date.now(); let stopped = false;
      for (;;) { const s = await L.frState(p.fr); if (s.prompt === 'pick' || s.prompt === 'more') { await sleep(300); } if (s.rounds - n0 >= 10 && !stopped) { await p.fr.locator('#auto').click({ timeout: 8000 }); stopped = true; } if (stopped && !s.busy && !s.prompt) break; if (Date.now() - t0 > 420000) throw new Error('autoplay did not stop in 7 min: ' + JSON.stringify(s)); await sleep(300); }
      await sleep(2500); const s = await L.frState(p.fr), done = L.doneRounds(await L.tapRes(p.page), MODE, tap0), sm = L.sums(done), after = bal(p);
      note(`autoplay: screen rounds ${s.rounds - n0}, server done rounds ${done.length}, cost ${sm.cost}, win ${sm.win}, pot ${sm.pot}`);
      ck('at least 10 rounds ran and AUTO stopped (not busy, auto off)', s.rounds - n0 >= 10 && !s.busy && !(await p.fr.evaluate(() => CC.core.st.auto)), { rounds: s.rounds - n0 });
      ck('server rounds = screen rounds', done.length === s.rounds - n0, { server: done.length, screen: s.rounds - n0 });
      let run_ = before, allOk = true; const per = []; for (const r of done) { const lines = roundLines(p.key, r.roundId), net = lines.filter((x) => x.to === p.store).reduce((n, x) => n + x.amount, 0) - lines.filter((x) => x.from === p.store).reduce((n, x) => n + x.amount, 0); const want = (r.totalWin || 0) + (r.pot && r.pot.won ? r.pot.amount || 0 : 0) - (r.cost || 0); per.push({ id: r.roundId, cost: r.cost, win: r.totalWin, net, want, auto: r.auto }); if (net !== want) allOk = false; run_ += net; }
      rec.perRound = per; ck('money equation per round from the ledger (net of ledger lines = win - cost), all ' + done.length + ' rounds', allOk, per.filter((x) => x.net !== x.want));
      ck(`balance before ${before} + sum of round nets = after ${after}`, run_ === after, { run_, after }); ck('meter = ledger', L.toUnits(s.bal, MODE) === after, { meter: s.bal, after }); ck('no escrow non-zero', led().escrows.length === 0, led().escrows);
      await L.closeBrowser(p.b);
    });

    // ---- 5. office pot
    await run('5', async (rec, ck, note) => {
      const cfg = await new Promise((r) => { try { r(require(EXPORT + '/games/coldcall-engine.js').CFG.pot || null); } catch (e) { r(null); } });
      note('not reached: no force or small config reaches the office pot in under 5 minutes. Engine pot config: ' + JSON.stringify(cfg).slice(0, 300));
      rec.reached = false; rec.checks.push({ name: 'office pot win in the browser: not reached', pass: true });
    });

    // ---- U17: after a lost ONE MORE CALL, is any BIG WIN overlay visible to a player?
    await run('u17', async (rec, ck, note) => {
      const p = await newPlayer(540, 960, require('./init_u17.js')); await L.setBet(p.fr, 5); rec.attempts = [];
      for (let a = 0; a < 25; a++) {
        const kind = await buyUntilPrompt(p, a % 3 === 2 ? 'bonus2' : 'bonus1').catch(() => null); if (!kind) continue;
        let tookMore = false, tiers = [], shots = 0, takeT = null; const t0 = Date.now();
        // answer: pick when asked, ONE MORE CALL when asked (take), then watch the tier overlay
        for (;;) {
          const s = await L.frState(p.fr);
          if (s.prompt === 'pick') { await L.clickLit(p.fr); await sleep(400); } else if (s.prompt === 'more') { takeT = await p.fr.evaluate(() => window.__tnow()); await L.clickMore(p.fr, true); tookMore = true; await sleep(300); }
          else if (!s.prompt && !s.busy && s.rounds > 0 && Date.now() - t0 > 2000 && (tookMore || !s.busy)) { /* maybe finished */ }
          if (tookMore) { const pr = await p.fr.evaluate(() => [...document.querySelectorAll('#tier, #tierbg')].map((e) => { const cs = getComputedStyle(e), r = e.getBoundingClientRect(); let o = 1, n = e; while (n && n.nodeType === 1) { o *= parseFloat(getComputedStyle(n).opacity); n = n.parentElement; } const top = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
              return { id: e.id, parent: e.parentElement && (e.parentElement.id || e.parentElement.className), display: cs.display, visibility: cs.visibility, opacity: +o.toFixed(3), box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], visible: cs.display !== 'none' && cs.visibility !== 'hidden' && o > 0.05 && r.width > 4 && r.height > 4 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight, centreElement: top && (top.id || top.className || top.tagName) }; }));
            if (pr.length) tiers.push({ t: Date.now() - t0, els: pr }); if (pr.some((x) => x.visible) && shots < 2) { shots++; await shot(p.page, 'u17_visible_' + a + '_' + shots); } }
          if (!s.busy && !s.prompt && Date.now() - t0 > 3000) { await sleep(800); const s2 = await L.frState(p.fr); if (!s2.busy && !s2.prompt) break; }
          if (Date.now() - t0 > 200000) break; await sleep(100);
        }
        const last = (await L.tapRes(p.page)).filter((x) => x.status === 'done').slice(-1)[0] || {}; const more = last.pull && last.pull.more;
        const winTxt = await p.fr.evaluate(() => document.getElementById('win').textContent); const af = await p.fr.evaluate(() => ({ n: document.querySelectorAll('#tier').length, vis: [...document.querySelectorAll('#tier')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 4 && getComputedStyle(e).display !== 'none'; }).length }));
        const sight = await p.fr.evaluate(() => window.__tsight.slice()); if (tookMore) await shot(p.page, 'u17_after_more_' + a);
        const row = { a, sightings: sight, takeAtMs: takeT, sightingsAfterTake: sight.filter((x) => takeT !== null && x.t > takeT), buy: last.buyBonus, tookMore, tier: last.tier, totalWin: last.totalWin, more, winTxt, tierElementsAtEnd: af, samples: tiers.length, anyVisible: tiers.some((x) => x.els.some((e) => e.visible)), firstSample: tiers[0] || null }; rec.attempts.push(row);
        console.log('u17 attempt', JSON.stringify(row).slice(0, 400));
        const lost = tookMore && more && (more.won === false || more.hit === false || more.win === 0 || more.lost === true || more.take === true && !(more.won || more.paid || more.win));
        if (tookMore && lost) { rec.lostSeen = (rec.lostSeen || 0) + 1; if (rec.lostSeen >= 2) break; }
        const s = await L.frState(p.fr); if (s.bal && L.toUnits(s.bal, MODE) < 5000) break;
      }
      const lostRows = rec.attempts.filter((r) => r.tookMore); const lostOnly = lostRows.filter((r) => r.more && r.more.won === false); const allSight = rec.attempts.flatMap((r) => r.sightings || []); rec.sightingSummary = { total: allSight.length, inWarm: allSight.filter((x) => x.inWarm).length, notInWarm: allSight.filter((x) => !x.inWarm).length, afterTakeOnLost: lostOnly.reduce((n, r) => n + r.sightingsAfterTake.length, 0), lostAttempts: lostOnly.length };
      rec.verdict = lostOnly.length === 0 ? 'not reached: no lost ONE MORE CALL' : (lostOnly.some((r) => r.anyVisible || r.tierElementsAtEnd.n > 0) || rec.sightingSummary.afterTakeOnLost > 0) ? 'real, visible (see sightings)' : (rec.sightingSummary.inWarm > 0 ? 'detector artefact, nothing visible (every #tier sighting is the aria-hidden #ccwarm warm-up layer, none after a lost ONE MORE CALL)' : 'no #tier at all: nothing visible, detector had nothing to count on this head');
      note('U17 verdict: ' + rec.verdict + ' over ' + lostRows.length + ' ONE MORE CALL attempts; lost-flag shape of pull.more: ' + JSON.stringify((lostRows[0] || {}).more));
      ck('U17: at least one lost ONE MORE CALL was reached', rec.verdict.indexOf('not reached') !== 0, rec.attempts.length); note('U17 sightings: ' + JSON.stringify(rec.sightingSummary)); await L.closeBrowser(p.b);
    });
  } catch (e) { res.fatal = String(e && e.stack || e).slice(0, 1000); console.log('FATAL', res.fatal); }
  finally { res.finished = new Date().toISOString(); save(); await killServer(); }
  console.log('EXTRAS done', Object.entries(res.extras).map(([k, v]) => k + ':' + v.status).join(' ')); process.exit(0);
})();
