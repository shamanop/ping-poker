'use strict';
// P6 w3a driver 1: real-click smoke of the Cold Call slot (in the shell, bridge=1) and one poker hand with the slot docked, on the v2-all build.
//   node qa/p6-w3a/smoke.js --base http://127.0.0.1:4760 --data <dataDir of that server>
// Exit 0 only if every check passes; writes qa/p6-w3a/smoke-result.json (one row per check: name, pass, expected, got).
// Funding: the sign-up grant of a fresh account (10,000 chips in bank:<key>, 1,000,000 Play cents in play:<key>) plus the daily bonus ($100 Play) claimed by a real click on CLAIM.
// Money is read from <dataDir>/money.jsonl (the ledger), never from the screen. Bonuses come from the BUY menu (a server without COLDCALL_TEST has no `force`).
const L = require('./lib');
const V = require('../../tests/v2/lib.js');          // Bot (socket.io test client) and audit(): reused, not rewritten
const { fs, path, sleep } = L;
const BASE = L.argOf('--base', 'http://127.0.0.1:4760'), DATA = L.argOf('--data'), PORT = Number(new URL(BASE).port);
const SHOTS = path.join(__dirname, 'shots'), RESULT = path.join(__dirname, 'smoke-result.json');
if (!DATA) { console.error('usage: node qa/p6-w3a/smoke.js --base http://127.0.0.1:4760 --data <dataDir>'); process.exit(2); }
const C = L.checks(), notes = [];
const note = (s) => { notes.push(s); console.log('NOTE ' + s); };
fs.mkdirSync(SHOTS, { recursive: true });
let shotN = 0;
async function shot(page, name) {
  if (shotN >= 12) return; const f = path.join(SHOTS, name + '.jpg');
  for (const q of [62, 45, 30]) { await page.screenshot({ path: f, type: 'jpeg', quality: q }); if (fs.statSync(f).size < 150 * 1024) break; }
  shotN++;
}

// ---- the three numbers and the idle invariants, after every phase
async function settleCheck(label, ctx, before, resFrom) {
  const { page, fr, key, mode, led } = ctx;
  const s0 = await L.frState(fr); if (s0.busy) await L.finishRound(page, fr, s0.rounds - 1);
  await sleep(1500);
  const after = led().get(L.storeOf(key, mode), mode);
  const rows = L.doneRounds(await L.tapRes(page), mode, resFrom), s = L.sums(rows);
  const expect = before - s.cost + s.win + s.pot;
  C.eq(`${mode}/${label}: ledger before ${before} - cost ${s.cost} + win ${s.win} + pot ${s.pot} = after (${rows.length} rounds)`, after, expect);
  // meter in the slot, the shell's plate, the ledger
  let meter = NaN, plate = NaN, pl = null; const onTables = mode === 'chips' ? led().seats(key, 'chips') : 0, plateWant = after + onTables;   // the Chips plate shows bank + table stacks
  for (let i = 0; i < 12; i++) {
    const st = await L.frState(fr); meter = L.toUnits(st.bal, mode); pl = await L.plates(page); plate = L.toUnits(mode === 'chips' ? pl.chips : pl.play, mode);
    if (meter === after && plate === plateWant) break; await sleep(500);
  }
  C.eq(`${mode}/${label}: slot meter = ledger balance`, meter, after);
  C.eq(`${mode}/${label}: shell plate = ledger balance${onTables ? ' + table stacks ' + onTables : ''} (${JSON.stringify(pl)})`, plate, plateWant);
  const esc = led().escrows; C.eq(`${mode}/${label}: no escrow account holds money while idle`, esc, []);
  const st = await L.frState(fr);
  C.eq(`${mode}/${label}: CC.dbg.mismatch empty`, st.mismatch, []);
  C.ok(`${mode}/${label}: CC.dbg.aborted is 0`, !st.aborted, st.aborted);
  C.ok(`${mode}/${label}: CC.dbg.error unset, not busy, no prompt/scrim left`, !st.error && !st.busy && !st.prompt && st.scrims === 0, { error: st.error, busy: st.busy, prompt: st.prompt, scrims: st.scrims });
  const a = await audit(); C.ok(`${mode}/${label}: rig audit clean (ledger ok, no drift, no open coldcall round)`, a.ok, a.why);
  return { after, rows };
}
let auditBot = null;
async function audit() {
  if (!auditBot) auditBot = await new V.Bot({ port: PORT, clients: [] }, 'aud' + Date.now().toString(36).slice(-4)).connect();
  const a = await V.audit(auditBot);
  if (a.__err) return { ok: false, why: a.__err };
  const bad = [];
  if (!a.ledger || !a.ledger.chips.ok || !a.ledger.play.ok || a.ledger.quarantined) bad.push('ledger ' + JSON.stringify(a.ledger));
  if (a.drift && a.drift.length) bad.push('drift ' + JSON.stringify(a.drift).slice(0, 200));
  if (a.walletPending) bad.push('walletPending ' + a.walletPending);
  const cc = a.games && a.games.coldcall; if (!cc || (cc.openRounds && cc.openRounds.length) || cc.error) bad.push('coldcall ' + JSON.stringify(cc).slice(0, 200));
  return { ok: bad.length === 0, why: bad.join('; ') || undefined, a };
}

// ---- one fresh account, one currency
async function runMode(mode) {
  const b = await L.launch(540, 960), { page } = b; let pokerBot = null;
  const led = () => L.readLedger(DATA);
  try {
    const name = 'w3a' + mode[0] + Date.now().toString(36).slice(-5);
    const { claimed } = await L.signUp(page, BASE, name);
    const key = await page.evaluate(() => Lobby.user().key);
    note(`${mode}: fresh account ${name} (key ${key}); funding = sign-up grant, daily bonus claimed by real click: ${claimed}`);
    await L.installTap(page);
    // 1. lobby, dock buttons, open the slot
    const dock = await page.evaluate(() => [...document.querySelectorAll('.sh-di:not(.soon)')].map((d) => ({ t: d.textContent.trim(), ok: d.classList.contains('btn') && d.classList.contains('btn--icon') })));
    C.ok(`${mode}/dock: Cold Call and Ballot Bender buttons carry btn btn--icon`, ['Cold Call', 'Ballot Bender'].every((n) => dock.some((d) => d.t === n && d.ok)), dock);
    const fr = await L.openColdCall(page);
    const st0 = await L.frState(fr);
    C.ok(`${mode}/open: the slot is live (bridge), not practice`, st0.live && st0.kind === 'bridge', { live: st0.live, kind: st0.kind });
    if (mode === 'chips') { await fr.locator('#modebar button[data-m=chips]').click({ timeout: 15000 }); await fr.waitForFunction(() => CC.core.st.mode === 'chips', null, { timeout: 15000 }); }
    C.eq(`${mode}/open: slot mode`, (await L.frState(fr)).mode, mode);
    await shot(page, `${mode}_1_open`);
    const ctx = { page, fr, key, mode, led };
    const bal = () => led().get(L.storeOf(key, mode), mode);
    const resLen = async () => (await L.tapRes(page)).length;
    await settleCheck('open (before any round)', ctx, bal(), await resLen());

    // 2. ten plain spins, each awaited
    {
      const before = bal(), from = await resLen(); await L.setBet(fr, 10); let dec = { pick: 0, more: 0, hang: 0 };
      await fr.locator('#turbo').click({ timeout: 15000 });
      for (let i = 0; i < 10; i++) {
        const n0 = (await L.frState(fr)).rounds; await L.clickSpin(page, fr); const r = await L.finishRound(page, fr, n0);
        for (const k of Object.keys(dec)) dec[k] += r.answered[k];
      }
      const rr = await settleCheck('10 plain spins', ctx, before, from);
      C.ok(`${mode}/10 plain spins: the server settled 10 or more rounds, the screen ran the same count`, rr.rows.length >= 10, rr.rows.length);
      if (dec.pick + dec.more + dec.hang) note(`${mode}: the plain spins also hit ${JSON.stringify(dec)} decisions (answered by clicks)`);
      await shot(page, `${mode}_2_spins`);
    }

    // 3. a bonus that asks for a decision: bought through the buy menu (no `force` without COLDCALL_TEST), until PICK YOUR LEAD and ONE MORE CALL were both answered by clicks
    {
      const before = bal(), from = await resLen(); const low = Math.min(5, (await L.frState(fr)).bets[0] === 1 ? 5 : (await L.frState(fr)).bets[0]); await L.setBet(fr, low);
      const dec = { pick: 0, more: 0, hang: 0 }; let buys = 0;
      while (buys < 15 && !(dec.pick && dec.more && dec.hang)) {
        const n0 = (await L.frState(fr)).rounds; await L.buyBonus(fr, 'bonus1'); buys++;
        const r = await L.finishRound(page, fr, n0, { take: dec.more === 0 });   // take ONE MORE CALL the first time it is offered, HANG UP after that
        for (const k of Object.keys(dec)) dec[k] += r.answered[k];
        if (buys === 1) await shot(page, `${mode}_3_bonus`);
      }
      await settleCheck(`bonus buys with decisions (${buys} buys, ${JSON.stringify(dec)})`, ctx, before, from);
      C.ok(`${mode}/decisions: PICK YOUR LEAD answered by a real click`, dec.pick >= 1, dec);
      C.ok(`${mode}/decisions: ONE MORE CALL (take) answered by a real click`, dec.more >= 1, dec);
      if (!dec.hang) note(`${mode}: HANG UP was not exercised in ${buys} buys (take was)`);
    }

    // 4. one bonus buy through the buy menu, a different bonus (bonus2)
    {
      const before = bal(), from = await resLen(); const n0 = (await L.frState(fr)).rounds;
      await L.buyBonus(fr, 'bonus2'); const r = await L.finishRound(page, fr, n0, { take: false });
      const rr = await settleCheck(`one bonus2 buy (decisions ${JSON.stringify(r.answered)})`, ctx, before, from);
      C.ok(`${mode}/buy: the server settled exactly one round, a bought bonus2`, rr.rows.length === 1 && rr.rows[0].buyBonus === 'bonus2', rr.rows.map((x) => x.buyBonus));
    }

    // 5. fast-click burst: 20 clicks on SPIN inside about a second while idle
    {
      const before = bal(), from = await resLen(); const s0 = await L.frState(fr), led0 = led().reasons.length; const n0 = s0.rounds;
      const bb = await fr.locator('#spin').boundingBox(), x = bb.x + bb.width / 2, y = bb.y + bb.height / 2, t0 = Date.now();
      for (let i = 0; i < 20; i++) await page.mouse.click(x, y);
      const burstMs = Date.now() - t0;
      await L.finishRound(page, fr, n0); await sleep(2500); await L.finishRound(page, fr, n0);   // wait until idle, then make sure no late round starts
      const screen = (await L.frState(fr)).rounds - n0;
      const rr = await settleCheck(`fast-click burst (20 clicks in ${burstMs} ms)`, ctx, before, from);
      const refs = new Set(led().reasons.slice(led0).filter((r) => /^coldcall:(spend|credit|settle|open)/.test(r.reason || '')).map((r) => String(r.ref).split(':')[2]));
      note(`${mode}: burst of 20 clicks took ${burstMs} ms (a ${burstMs > 1100 ? 'SLOW' : 'fast'} burst on this loaded box); server rounds ${rr.rows.length}, screen rounds ${screen}, ledger rounds ${refs.size}`);
      C.eq(`${mode}/burst: rounds the server played = rounds the screen ran`, rr.rows.length, screen);
      C.eq(`${mode}/burst: rounds in the ledger = rounds the server played`, refs.size, rr.rows.length);
      C.ok(`${mode}/burst: at least one round ran`, rr.rows.length >= 1, rr.rows.length);
      await shot(page, `${mode}_5_burst`);
    }

    // 7. poker with the slot docked (chips run only: the table is a chips table)
    if (mode === 'chips') await poker(ctx, b);

    // end of the run
    const fin = await settleCheck('end of run', ctx, bal(), await resLen());
    C.ok(`${mode}/end: no page error, no console error (favicon 404 excluded and listed)`, b.logs.filter((l) => !/favicon\.ico/.test(l)).length === 0, b.logs);
    if (b.logs.length || b.bad.length) note(`${mode}: console errors / bad responses: ${JSON.stringify([...new Set([...b.logs, ...b.bad])]).slice(0, 600)}`);
    return fin;
  } finally { if (pokerBot) pokerBot.close(); await L.closeBrowser(b); }
}

// ---- 7. poker: the slot window docked (Dock right button, real click), one hand to its end by real clicks on this page's buttons against one socket bot
async function poker(ctx, b) {
  const { page, fr, key, led } = ctx; const mode = 'chips', bots = [];
  try {
    await page.setViewportSize({ width: 1280, height: 800 }); await sleep(800);   // at 540 px the docked slot covers the whole stage; a docked-right slot next to the table needs the wider window
    await page.locator('.sh-win[data-game=coldcall] button[title="Dock right"]').first().click({ timeout: 15000 }); await sleep(1200);
    const docked = await page.evaluate(() => { const w = document.querySelector('.sh-win[data-game=coldcall]'); return { cls: w.className, open: w.classList.contains('open') }; });
    C.ok('poker: the Cold Call window is docked and still open', /docked/.test(docked.cls) && docked.open, docked);
    const bot = await new V.Bot({ port: PORT, clients: [] }, 'w3b' + Date.now().toString(36).slice(-5)).connect(); bots.push(bot); await bot.signup();
    const c = await bot.req('table_create', { settings: { name: 'W3A', mode: 'chips', buyIn: { min: 500, max: 5000, default: 2000 }, blinds: { sb: 25, bb: 50 }, autoStart: false, actionTimerSec: 0 } }, 'table_created');
    if (c.__err) throw new Error('table_create ' + c.__err); const id = c.table.id;
    const sit = await bot.sit(id, 2000); if (sit.__err) throw new Error('bot sit ' + sit.__err);
    const sumNow = () => { const q = led(); return q.get('bank:' + key, 'chips') + q.get('seat:' + id + ':' + key, 'chips') + q.get('bank:' + bot.key, 'chips') + q.get('seat:' + id + ':' + bot.key, 'chips'); };
    const total0 = sumNow();   // the bot is seated, this page is not yet: bank + seats of the two accounts must stay this number
    await page.fill('#lb-code', id); await page.click('#lb-join-btn'); await page.locator('#lb-sit').click({ timeout: 15000 });
    await V.waitFor(() => bot.gs && bot.gs.players && bot.gs.players.length === 2, 10000); await sleep(800);
    C.eq('poker: both players seated, chips conserved before the hand (bank + seats of both accounts)', sumNow(), total0);
    bot.emit('table_start', { tableId: id }); await V.waitFor(() => bot.gs && bot.gs.status === 'playing', 10000);
    let classes = null, clicks = 0; const t1 = Date.now();
    while (Date.now() - t1 < 120000) {
      if (bot.showdowns.length || (bot.gs && bot.gs.status !== 'playing' && Date.now() - t1 > 3000)) break;
      if (bot.myTurn()) { const i = V.info(bot); bot.act(i.toCall ? 'call' : 'check'); await sleep(300); continue; }
      const cc = page.locator('#btn-check-call');
      if (await cc.isEnabled().catch(() => false)) {
        if (!classes) classes = await page.evaluate(() => ['btn-fold', 'btn-check-call', 'btn-raise'].map((i) => ({ id: i, cls: document.getElementById(i).className })));
        await cc.click({ timeout: 8000 }); clicks++; await sleep(600);
      } else await sleep(200);
    }
    await sleep(1500); await shot(page, 'chips_7_poker_docked');
    C.ok('poker: the page made real clicks on CHECK/CALL', clicks >= 1, clicks);
    C.ok('poker: action buttons carry the UI wave 1 classes (act act-fold / act-call / act-raise)', !!classes && classes.every((x) => /\bact\b/.test(x.cls) && new RegExp('act-' + { 'btn-fold': 'fold', 'btn-check-call': 'call', 'btn-raise': 'raise' }[x.id]).test(x.cls)), classes);
    C.ok('poker: the hand reached its end', bot.showdowns.length >= 1 || (bot.gs && bot.gs.status !== 'playing'), { showdowns: bot.showdowns.length, status: bot.gs && bot.gs.status });
    const post = led();
    C.eq('poker: chips conserved after the hand (bank + seats of both accounts)', sumNow(), total0);
    C.eq('poker: no pot / escrow account holds chips when the hand is over', post.escrows, []);
    const a = await audit(); C.ok('poker: rig audit clean after the hand', a.ok, a.why);
    // leave the table by the real button so the slot's chips are all in the bank again
    page.once('dialog', (d) => { note('poker: leave-table confirm dialog: ' + d.message().slice(0, 90)); d.accept(); });   // Leave table opens a native confirm()
    await page.locator('#btn-leave-table').click({ timeout: 8000 }); await sleep(2500);
    // one more spin in the docked slot still works and balances
    const key2 = key, before = led().get('bank:' + key2, 'chips'), from = (await L.tapRes(page)).length, n0 = (await L.frState(fr)).rounds;
    await L.clickSpin(page, fr); await L.finishRound(page, fr, n0);
    const seatLeft = led().get('seat:' + id + ':' + key2, 'chips');
    if (seatLeft) note('poker: this page was still seated at the table after the leave click (' + seatLeft + ' chips on the seat); the spin check below uses the bank only');
    await settleCheck('docked spin after the poker hand', ctx, before, from);
  } finally { for (const x of bots) x.close(); }
}

(async () => {
  let ok = false;
  try {
    for (const mode of ['play', 'chips']) await runMode(mode);
  } catch (e) { C.add('driver ran to the end without an exception', false, 'no exception', String(e && e.stack || e).slice(0, 700)); }
  finally { if (auditBot) auditBot.close(); }
  ok = C.failed === 0;
  fs.writeFileSync(RESULT, JSON.stringify({ driver: 'smoke.js', base: BASE, at: new Date().toISOString(), passed: C.passed, failed: C.failed, notes, rows: C.rows }, null, 1));
  console.log(`SMOKE ${ok ? 'PASS' : 'FAIL'}: ${C.passed} passed, ${C.failed} failed -> ${RESULT}`);
  process.exit(ok ? 0 : 1);
})();
