'use strict';
// MONEY HARDENING 2026-10-08, builder M: shared pieces of modeflip.js / twotab.js. Real server on a fresh data dir, real browser, real shell, real clicks.
// Money is read from the ledger (money.jsonl), never from the screen. Reuses qa/p6-w3b/lib.js (launch, signUp, plates, ledger) and qa/campaign-legs/clib.js (Campaign helpers).
const { spawn } = require('child_process');
const C = require('../campaign-legs/clib.js');
const { sleep, fs, path } = C;
const ROOT = path.resolve(__dirname, '..', '..');

// ---- server: fresh data dir, PORT, Cash seeded ($10,000.00) because a live sign-up starts at 0; CAMPAIGN_TEST=1 only for the step "force" hook (not used here). Killed by PID.
async function startServer(port, dataDir, logFile, env = {}) {
  fs.rmSync(dataDir, { recursive: true, force: true }); fs.mkdirSync(dataDir, { recursive: true }); fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const out = fs.openSync(logFile, 'w');
  const e = Object.assign({}, process.env, { DATA_DIR: dataDir, PORT: String(port), SIGNUP_PLAY_CENTS: '1000000' }, env); delete e.NODE_ENV; delete e.RIG;
  const p = spawn('node', ['server.js'], { cwd: ROOT, env: e, stdio: ['ignore', out, out] });
  for (let i = 0; i < 120; i++) { await sleep(500); if (/server running on port/.test(fs.readFileSync(logFile, 'utf8'))) return p; if (p.exitCode != null) throw new Error('server died: ' + fs.readFileSync(logFile, 'utf8').slice(-400)); }
  p.kill(); throw new Error('server did not start');
}
function stopServer(p) { if (!p) return; try { p.kill('SIGTERM'); } catch (e) { /* gone */ } setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) { /* gone */ } }, 1500).unref(); }

// ---- the ledger: every line of money.jsonl whose ref starts with `<game>:<key>:`, as { ref, cur } in file order
function ledgerLines(dataDir, game, key) {
  let txt = ''; try { txt = fs.readFileSync(path.join(dataDir, 'money.jsonl'), 'utf8'); } catch (e) { return []; }
  const out = []; const pre = game + ':' + key + ':';
  for (const l of txt.split('\n')) {
    if (!l.trim()) continue; let r; try { r = JSON.parse(l); } catch (e) { continue; }
    const ref = r.ref || (Array.isArray(r.batch) && r.batch[0] && r.batch[0].ref) || '';
    if (!String(ref).startsWith(pre)) continue;
    const items = Array.isArray(r.batch) ? r.batch : [r]; const curs = [...new Set(items.map((it) => it.cur || r.cur))];
    out.push({ ref, cur: curs.length === 1 ? curs[0] : curs.join('+') });
  }
  return out;
}

// ---- game adapters: how to find, read and drive each game through the shell
const GAMES = {
  bender: { dock: 'Ballot Bender', re: /games\/bender/, id: 'bender' },
  coldcall: { dock: 'Cold Call', re: /games\/coldcall/, id: 'coldcall' },
  campaign: { dock: 'Campaign Trail', re: /games\/campaign/, id: 'campaign' },
};
const frameFor = (page, game) => page.frames().find((f) => GAMES[game].re.test(f.url()));

async function gameReady(fr, game) {
  if (game === 'bender') {
    await fr.waitForFunction(() => window.BENDER && document.getElementById('modebar') && ['play', 'chips'].includes(document.getElementById('modebar').dataset.state), null, { timeout: 30000 });
    const go = fr.locator('#go'); if (await go.count()) { await go.click({ timeout: 8000 }).catch(() => {}); await sleep(900); }   // the BELLY UP splash
  }
  else if (game === 'coldcall') {
    await fr.waitForFunction(() => window.CC && CC.ready, null, { timeout: 60000 });
    const go = fr.locator('#go'); if (await go.count()) { await go.click({ timeout: 20000 }).catch(() => {}); await sleep(700); }
    await fr.waitForFunction(() => CC.core.st.live, null, { timeout: 30000 });
  } else await fr.waitForFunction(() => window.__campaign && window.__campaign.ready && window.__campaign.st, null, { timeout: 30000 }).catch(() => fr.waitForFunction(() => window.__campaign && window.__campaign.ready, null, { timeout: 30000 }));
  await sleep(700);
}
async function openGame(page, game) {
  let fr = frameFor(page, game);
  if (!fr) { await page.locator('button.sh-di', { hasText: GAMES[game].dock }).click(); for (let i = 0; i < 120 && !fr; i++) { fr = frameFor(page, game); if (!fr) await sleep(200); } }
  if (!fr) throw new Error('no ' + game + ' frame');
  await gameReady(fr, game); await page.evaluate((g) => { try { Shell.focus(g); } catch (e) { /* ignore */ } }, game); await sleep(250); return fr;   // several game windows float over each other: bring this one to the front
}
// the mode the game SHOWS (its own data-* / debug handle)
const gameMode = (fr, game) => fr.evaluate((g) => g === 'bender' ? document.getElementById('modebar').dataset.state : g === 'coldcall' ? CC.core.st.mode : document.getElementById('app').dataset.mode, game);
const shellMode = (page, game) => page.evaluate((g) => (window.Shell && Shell.wmode ? Shell.wmode(g) : null), game);   // the shell's wallet mode for that game
const busyOf = (fr, game) => fr.evaluate((g) => g === 'bender' ? !!BENDER.st.busy || !!document.querySelector('#ov .scrim') : g === 'coldcall' ? !!CC.core.st.busy || !!CC.core.st.ctx : window.__campaign.busy, game);
// the balance the game shows, in the units of the mode it shows, and the shell plate for that mode
const gameBalTxt = (fr, game) => fr.evaluate((g) => { const el = g === 'bender' ? document.getElementById('balM') : document.getElementById('bal'); return el ? (el.innerText || el.textContent) : ''; }, game);
async function setMode(fr, game, mode) {
  const sel = game === 'campaign' ? '[data-action="mode"][data-m="' + mode + '"]' : '#modebar button[data-m="' + mode + '"]';
  // the game's own mode switch is a thin strip at the top edge of the stage and a real pointer click is sometimes caught by the window chrome: try the pointer, then the element's own click()
  try { await fr.locator(sel).click({ timeout: 2500 }); } catch (e) { await fr.locator(sel).evaluate((el) => el.click()); }
  await sleep(350);
}
// wait until the account is signed in again and the shell is bound (after a reload)
async function waitSignedIn(page, acct) {
  await page.waitForFunction(() => window.Shell && Shell.isSignedIn && Shell.isSignedIn(), null, { timeout: 40000 }).catch(async () => {
    if (!acct) throw new Error('not signed in after reload');
    await page.fill('#lb-name', acct.name).catch(() => {}); await page.fill('#lb-pin', acct.pin).catch(() => {}); await page.click('#lb-submit').catch(() => {});
    await page.waitForFunction(() => window.Shell && Shell.isSignedIn && Shell.isSignedIn(), null, { timeout: 40000 });
  });
  await sleep(1500);
}
async function shot(page, dir, name) {
  const f = path.join(dir, name + '.jpg'); let q = 55; await page.screenshot({ path: f, type: 'jpeg', quality: q });
  while (fs.statSync(f).size > 120 * 1024 && q > 20) { q -= 10; await page.screenshot({ path: f, type: 'jpeg', quality: q }); }
  return f;
}

module.exports = Object.assign({}, C, { ROOT, startServer, stopServer, ledgerLines, GAMES, frameFor, openGame, gameReady, gameMode, shellMode, busyOf, gameBalTxt, setMode, waitSignedIn, shot });
