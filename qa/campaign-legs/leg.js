'use strict';
// Campaign Trail browser leg: 33 rounds through the real Ping shell with real clicks; screen = shell plate = ledger after EVERY round (ledger = replay of money.jsonl).
//   node qa/campaign-legs/leg.js --base http://127.0.0.1:4801 --data <dir> --viewport 540x960 --mode play --name play540 [--docked] --out <json> --shots <dir>
// The only non-click input: window.__force on g:campaign:step (the CAMPAIGN_TEST=1 server hook picks the random draw; the click, the route and the money path are real).
const C = require('./clib.js');
const { sleep } = C;
const base = C.argOf('--base', 'http://127.0.0.1:4801'), DATA = C.argOf('--data'), VP = C.argOf('--viewport', '540x960'), MODE = C.argOf('--mode', 'play');
const NAME = C.argOf('--name', 'leg'), OUT = C.argOf('--out', NAME + '.json'), SHOTS = C.argOf('--shots', 'shots'), DOCKED = C.hasFlag('--docked'), SEED = Number(C.argOf('--seed', '7'));
const [W, H] = VP.split('x').map(Number);
C.fs.mkdirSync(SHOTS, { recursive: true });
const rnd = (() => { let s = SEED * 2654435761 >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
const shuffle = (a) => { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };

const LEVELS = [100, 200, 500, 1000, 2500];                       // the real bet levels (the brief's "2000" is the real 200)
const HOMES = [['OH', 'Ohio'], ['GA', 'Georgia'], ['PA', 'Pennsylvania'], ['KS', 'Kansas'], ['MT', 'Montana'], ['NV', 'Nevada'], ['VA', 'Virginia'], ['AZ', 'Arizona'], ['WI', 'Wisconsin'], ['CO', 'Colorado'],
  ['MI', 'Michigan'], ['NC', 'North Carolina'], ['FL', 'Florida'], ['NY', 'New York'], ['IL', 'Illinois'], ['OR', 'Oregon'], ['UT', 'Utah'], ['WV', 'West Virginia'], ['SC', 'South Carolina'], ['IN', 'Indiana']];
// ---- the plan: 33 rounds. kind -> { steps, end }. Stakes cycle over all five levels so each is played 6-7 times.
function buildPlan() {
  const kinds = [];
  const add = (k, n, extra) => { for (let i = 0; i < n; i++) kinds.push(Object.assign({ kind: k }, extra || {})); };
  add('cash1', 4); add('cash2', 4); add('cash3', 1); add('cash5', 3); add('withdraw', 3);
  add('scandal1', 4); add('scandal2', 3); add('scandal4', 3);
  kinds.push({ kind: 'eight_cash', home: ['TN', 'Tennessee'], badge: 8 }, { kind: 'eight_cash', home: ['MO', 'Missouri'], badge: 5 }, { kind: 'eight_scandal', home: ['TN', 'Tennessee'], badge: 1 });
  add('idle', 1); add('reload_mid', 1); add('reload_open', 1);
  let order = shuffle(kinds);
  const firstIdx = order.findIndex((k) => k.kind === 'cash5'); const t = order[firstIdx]; order.splice(firstIdx, 1); order.splice(3, 0, t);     // an early 5-step run for the mid-trail shot
  const e0 = order.findIndex((k) => k.kind === 'eight_cash'); const e = order[e0]; order.splice(e0, 1); order.splice(5, 0, e);                       // and an early 8-option state
  // two PLAY AGAIN rounds, each right after a plain cash-out / scandal round (same home and stake as the round before)
  const donors = []; for (let i = 2; i < order.length; i++) if (/^(cash|scandal)/.test(order[i].kind) && !donors.includes(i)) donors.push(i);
  const pickD = [donors[Math.floor(donors.length * 0.3)], donors[Math.floor(donors.length * 0.75)]].sort((a, b) => b - a);
  for (const d of pickD) order.splice(d + 1, 0, { kind: 'again_' + (order[d].kind.startsWith('scandal') ? 'cash1' : 'cash1'), again: true });
  const plan = []; let hi = 0, mapUsed = 0; const mapAt = [8, 21];
  order.forEach((k, i) => {
    const row = Object.assign({}, k, { i: i + 1 });
    row.stake = LEVELS[(i * 2 + (SEED % 5)) % 5];
    if (k.again) { const p = plan[i - 1]; row.home = p.home; row.stake = p.stake; row.homeHow = 'again'; }
    else {
      if (!row.home) { row.home = HOMES[hi++ % HOMES.length]; }
      row.homeHow = mapAt.includes(i) && !/^eight/.test(k.kind) && !/^reload/.test(k.kind) ? 'map' : 'search';
      if (row.homeHow === 'map') { row.home = mapUsed++ === 0 ? ['TX', 'Texas'] : ['CA', 'California']; }
    }
    plan.push(row);
  });
  return plan;
}
const SPEC = {      // kind -> steps survived before the end action and how the run ends
  cash1: { steps: 1, end: 'cash' }, cash2: { steps: 2, end: 'cash' }, cash3: { steps: 3, end: 'cash' }, cash5: { steps: 5, end: 'cash' }, withdraw: { steps: 0, end: 'cash' },
  scandal1: { steps: 1, end: 'scandal' }, scandal2: { steps: 2, end: 'scandal' }, scandal4: { steps: 4, end: 'scandal' },
  eight_cash: { steps: 1, end: 'cash' }, eight_scandal: { steps: 1, end: 'scandal' }, idle: { steps: 1, end: 'idle' },
  reload_mid: { steps: 2, end: 'cash', reloadAfter: 1 }, reload_open: { steps: 1, end: 'cash', reloadAfter: 0 }, again_cash1: { steps: 1, end: 'cash' },
};

const out = { leg: NAME, viewport: VP, mode: MODE, docked: DOCKED, base, key: null, plan: null, rounds: [], fails: [], notes: [], wrong: {}, shots: [], consoleErrors: [], badResponses: [], baseline: { favicon404: 0 }, startBalance: null, end: null, pass: null, startedAt: new Date().toISOString() };
const note = (s) => { out.notes.push(s); console.log('NOTE ' + s); };
const save = () => C.fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
const fail = (round, what, got) => { out.fails.push({ round, what, got }); console.log('FAIL r' + round + ' ' + what + ' ' + JSON.stringify(got)); };
const shotsTaken = new Set();
async function shot(b, what, once = true) {
  const name = NAME + '_' + what + '.jpg'; if (once && shotsTaken.has(name)) return; shotsTaken.add(name);
  const f = C.path.join(SHOTS, name); await sleep(450);
  let q = 55; await b.page.screenshot({ path: f, type: 'jpeg', quality: q });
  while (C.fs.statSync(f).size > 120 * 1024 && q > 20) { q -= 10; await b.page.screenshot({ path: f, type: 'jpeg', quality: q }); }
  out.shots.push({ name, bytes: C.fs.statSync(f).size, quality: q });
}
const sameNoise = (s) => /favicon\.ico/.test(s);

async function reopen(b) {
  await b.page.waitForFunction(() => window.Shell && Shell.isSignedIn && Shell.isSignedIn(), null, { timeout: 40000 });
  await sleep(1500);
  let fr = b.page.frames().find((f) => /games\/campaign/.test(f.url()));
  if (!fr) { await b.page.locator('button.sh-di', { hasText: 'Campaign Trail' }).click(); for (let i = 0; i < 60 && !fr; i++) { fr = b.page.frames().find((f) => /games\/campaign/.test(f.url())); await sleep(150); } }
  if (!fr) throw new Error('no campaign frame after the reload');
  await fr.waitForFunction(() => window.__campaign && window.__campaign.ready, null, { timeout: 20000 });
  b.fr = fr; await C.hook(b.page, fr); await sleep(700);
}

(async () => {
  const b = await C.launch(W, H); const name = (NAME + Math.random().toString(36).slice(2, 5)).toLowerCase(); const key = name; out.key = key;
  let logMark = 0, badMark = 0;
  const finish = async (why) => {
    out.consoleErrors = b.logs.filter((s) => !sameNoise(s)); out.badResponses = b.bad.filter((s) => !sameNoise(s)); out.baseline.favicon404 = b.logs.filter(sameNoise).length + b.bad.filter(sameNoise).length;
    out.pass = out.fails.length === 0 && !!out.plan && out.rounds.length === out.plan.length && !out.consoleErrors.length && !out.badResponses.length; out.finishedAt = new Date().toISOString(); out.stop = why || null; save();
  };
  try {
    const su = await C.signUp(b.page, base, name); note('account ' + name + ' (key ' + key + '); daily bonus claimed by a real click: ' + su.claimed + '; viewport ' + VP + (DOCKED ? ' docked' : ''));
    b.fr = await C.openGame(b.page); await C.hook(b.page, b.fr);
    out.geometry = { window: await b.page.locator('.sh-win[data-game="campaign"]').boundingBox(), frame: await (await b.fr.frameElement()).boundingBox() };
    out.plan = buildPlan(); save();
    note('plan: ' + out.plan.map((r) => r.i + ':' + r.kind + '@' + r.stake).join(' '));
    const R0 = C.replay(DATA, key); out.startBalance = { ledger: R0.bal(MODE), other: R0.bal(MODE === 'play' ? 'chips' : 'play'), screen: C.numOf(await C.screenBal(b.fr), MODE), plates: await C.plates(b.page) };
    await C.setMode(b.fr, MODE); await sleep(300);
    out.startBalance.screen = C.numOf(await C.screenBal(b.fr), MODE); await shot(b, 'setup');

    // ------------------------------------------------------------- wrong inputs: each must cost nothing
    const wrong = out.wrong; const lines0 = () => C.fs.readFileSync(C.path.join(DATA, 'money.jsonl'), 'utf8').split('\n').filter(Boolean).length;
    { // W1: START with no home. The client disables the button: a real click lands on a disabled button and sends nothing.
      const l0 = lines0(), s0 = (await C.sentLog(b.page)).length, t0 = (await C.toasts(b.fr)).length; const cta = await C.ctaRead(b.fr);
      const bb = await b.fr.locator('#cta').boundingBox(), fb = await (await b.fr.frameElement()).boundingBox(); await b.page.mouse.click(fb.x + bb.x + bb.width / 2, fb.y + bb.y + bb.height / 2); await sleep(500);
      wrong.noHome = { cta, sentAfter: (await C.sentLog(b.page)).length - s0, toasts: (await C.toasts(b.fr)).length - t0, ledgerLines: lines0() - l0, view: await C.viewOf(b.fr) };
      if (!(cta.disabled && /PICK A HOME/.test(cta.main) && wrong.noHome.sentAfter === 0 && wrong.noHome.ledgerLines === 0 && wrong.noHome.view === 'setup')) fail(0, 'W1 no-home START not inert', wrong.noHome);
    }
    { // W2: search for a state that does not exist, press Enter
      const inp = b.fr.locator('#homeQ'); await inp.click(); await inp.fill('zzzz'); await sleep(250); const none = await b.fr.locator('#homeList .none').count(); await inp.press('Enter'); await sleep(300);
      const cta = await C.ctaRead(b.fr); wrong.badSearch = { noSuchStateShown: none, cta };
      if (!(none === 1 && cta.disabled)) fail(0, 'W2 bad search not inert', wrong.badSearch);
      await inp.fill(''); await inp.press('Escape'); await b.page.mouse.click(5, 5); await sleep(200);
    }
    { // W3: a bad home sent to the server (NOT a click: the client cannot produce it). The server error must reach the screen as a toast and cost nothing.
      const l0 = lines0(), t0 = (await C.toasts(b.fr)).length;
      await b.page.evaluate((m) => window.PingSocket.emit('g:campaign:start', { mode: m, bet: 100, home: 'ZZ' }), MODE); await sleep(900);
      const tt = (await C.toasts(b.fr)).slice(t0); wrong.badHomeInjected = { toasts: tt, ledgerLines: lines0() - l0, view: await C.viewOf(b.fr), injected: true };
      if (!(tt.length === 1 && /home state/i.test(tt[0]) && wrong.badHomeInjected.ledgerLines === 0 && wrong.badHomeInjected.view === 'setup')) fail(0, 'W3 injected bad home', wrong.badHomeInjected);
      await sleep(2800);
    }
    if (MODE === 'chips') { // W4: stake over the balance. Play $ is 0 on this account (live sign-up grants 0): the client disables START ("not enough Play $"). A real click on it sends nothing.
      await C.setMode(b.fr, 'play'); await C.pickHomeMap(b.page, b.fr, 'TX'); await C.setStake(b.fr, 100);
      const l0 = lines0(), s0 = (await C.sentLog(b.page)).length, t0 = (await C.toasts(b.fr)).length; const cta = await C.ctaRead(b.fr);
      const bb = await b.fr.locator('#cta').boundingBox(), fb = await (await b.fr.frameElement()).boundingBox(); await b.page.mouse.click(fb.x + bb.x + bb.width / 2, fb.y + bb.y + bb.height / 2); await sleep(500);
      wrong.overBalanceClick = { cta, screen: await C.screenBal(b.fr), sentAfter: (await C.sentLog(b.page)).length - s0, toasts: (await C.toasts(b.fr)).length - t0, ledgerLines: lines0() - l0 };
      if (!(cta.disabled && /not enough/.test(cta.sub) && wrong.overBalanceClick.sentAfter === 0 && wrong.overBalanceClick.ledgerLines === 0)) fail(0, 'W4 over-balance START not inert', wrong.overBalanceClick);
      await shot(b, 'notenough');
      await sleep(2800); const t1 = (await C.toasts(b.fr)).length;      // the same thing sent to the server (NOT a click): the 'Not enough Play $' toast
      await b.page.evaluate(() => window.PingSocket.emit('g:campaign:start', { mode: 'play', bet: 100, home: 'TX' })); await sleep(900);
      const tt = (await C.toasts(b.fr)).slice(t1); wrong.overBalanceInjected = { toasts: tt, ledgerLines: lines0() - l0, injected: true };
      if (!(tt.length === 1 && /Not enough/i.test(tt[0]) && wrong.overBalanceInjected.ledgerLines === 0)) fail(0, 'W4 injected over-balance', wrong.overBalanceInjected);
      await sleep(2800); await C.setMode(b.fr, 'chips'); await sleep(300);
    } else note('W4 (stake over the balance) not run in this leg: with 10,000.00 Play $ and 20,000 chips no stake level exceeds a balance; covered in the chips360 leg on the empty Play $ wallet');
    note('wrong inputs: ' + JSON.stringify(Object.fromEntries(Object.entries(wrong).map(([k, v]) => [k, v.toasts || v.cta && v.cta.main]))));
    // the wrong-input phase leaves the page quiet: remember toasts / errors / console counts so a round only sees its own
    let tMark = (await C.toasts(b.fr)).length; let eMark = (await C.errEvents(b.fr)).length; let sMark = (await C.sentLog(b.page)).length; logMark = b.logs.filter((s) => !sameNoise(s)).length; badMark = b.bad.filter((s) => !sameNoise(s)).length;
    if (await b.fr.locator('[data-m="' + MODE + '"].on').count() === 0) await C.setMode(b.fr, MODE);

    // ------------------------------------------------------------- the rounds
    let prev = null; const seenIds = new Set();
    for (const spec of out.plan) {
      const sp = SPEC[spec.kind]; const t0 = Date.now(); const stake = spec.stake; const cur = MODE; const other = MODE === 'play' ? 'chips' : 'play';
      const rd = { i: spec.i, kind: spec.kind, stake, home: spec.home[0], homeHow: spec.homeHow, plannedSteps: sp.steps, end: sp.end, picks: [], checks: {} };
      const Rb = C.replay(DATA, key); rd.before = Rb.bal(cur); rd.beforeOther = Rb.bal(other);
      const scrBefore = C.numOf(await C.screenBal(b.fr), cur); rd.screenBefore = scrBefore;
      if (rd.before < stake) { fail(spec.i, 'balance below the planned stake', { before: rd.before, stake }); break; }
      const carry = { sent: [], toasts: [], errs: [] };
      // ---- start
      if (spec.again) {
        const c = await C.ctaRead(b.fr); rd.againCta = c;
        if (!(/PLAY AGAIN/.test(c.main) && !c.disabled)) { fail(spec.i, 'PLAY AGAIN not offered', c); break; }
        await b.fr.locator('#cta').click();
      } else {
        if ((await C.viewOf(b.fr)) !== 'setup') { await b.fr.locator('[data-action="setup"]').click(); await C.waitView(b.fr, 'setup'); await sleep(300); }
        if (spec.homeHow === 'map') await C.pickHomeMap(b.page, b.fr, spec.home[0]); else await C.pickHomeSearch(b.fr, spec.home[1].slice(0, 3), new RegExp('^' + spec.home[1]));
        await C.setStake(b.fr, stake);
        const c = await C.ctaRead(b.fr); rd.startCta = c;
        if (c.disabled || !/START/.test(c.main) || !c.sub.includes(spec.home[1])) { fail(spec.i, 'START not ready with the chosen home', c); break; }
        await b.fr.locator('#cta').click();
      }
      try { await C.waitView(b.fr, 'run', 10000); } catch (e) { fail(spec.i, 'run did not open', await b.fr.evaluate(() => ({ view: window.__campaign.view, busy: window.__campaign.busy }))); break; }
      await sleep(450);
      const r0 = await b.fr.evaluate(() => window.__campaign.run); rd.roundId = r0.roundId; rd.runHome = r0.home; rd.runBet = r0.bet; rd.runMode = r0.mode; rd.options0 = r0.options.length;
      if (seenIds.has(rd.roundId)) fail(spec.i, 'round id reused', rd.roundId); seenIds.add(rd.roundId);
      if (r0.home !== spec.home[0] || r0.bet !== stake || r0.mode !== cur) fail(spec.i, 'run opened with other home/stake/mode', { home: r0.home, bet: r0.bet, mode: r0.mode });
      if (/^eight/.test(spec.kind)) { if (r0.options.length !== 8) fail(spec.i, '8-option state does not have 8 options', r0.options.length); await shot(b, 'eight_options'); }
      if (spec.i === 1) await shot(b, 'run_start');
      // ---- steps
      const doStep = async (k, last) => {
        await C.force(b.page, last && sp.end === 'scandal' ? 'scandal' : 'survive');
        const pk = await C.pickCard(b.fr, k === 1 && spec.badge ? spec.badge : 0); rd.picks.push(pk.to + '#' + pk.n + '/' + pk.of);
        await b.fr.waitForFunction((n) => { const c = window.__campaign; return c.view === 'ended' || (c.run && c.run.steps === n && !c.busy); }, k, { timeout: 12000 });
        await sleep(380);
      };
      let aborted = false;
      const doReload = async () => {
        const rid = await b.fr.evaluate(() => window.__campaign.run && window.__campaign.run.roundId), st = await b.fr.evaluate(() => window.__campaign.run.steps);
        carry.sent = carry.sent.concat((await C.sentLog(b.page)).slice(sMark)); carry.toasts = carry.toasts.concat((await C.toasts(b.fr)).slice(tMark)); carry.errs = carry.errs.concat((await C.errEvents(b.fr)).slice(eMark));
        await b.page.reload({ waitUntil: 'domcontentloaded' }); await reopen(b);
        const s2 = await b.fr.evaluate(() => ({ view: window.__campaign.view, rid: window.__campaign.run && window.__campaign.run.roundId, steps: window.__campaign.run && window.__campaign.run.steps }));
        rd.reload = { before: { rid, st }, after: s2 }; rd.checks.reloadAdopts = s2.view === 'run' && s2.rid === rid && s2.steps === st;
        tMark = 0; eMark = 0; sMark = 0;
        if (!rd.checks.reloadAdopts) { fail(spec.i, 'reload did not adopt the open run', rd.reload); return false; }
        await shot(b, 'reload_adopted'); return true;
      };
      if (sp.reloadAfter === 0 && !(await doReload())) break;
      for (let k = 1; k <= sp.steps && !aborted; k++) {
        const last = k === sp.steps;
        await doStep(k, last);
        if (k === 3 && spec.kind === 'cash5') await shot(b, 'trail_mid');
        if (!last && (await C.viewOf(b.fr)) === 'ended') { fail(spec.i, 'run ended early (forced survive)', await b.fr.evaluate(() => window.__campaign.lastEnd)); aborted = true; break; }
        if (sp.reloadAfter === k && !last && !(await doReload())) { aborted = true; break; }
      }
      if (aborted) break;
      // ---- the end
      if (sp.end === 'cash') {
        const c = await C.ctaRead(b.fr); rd.cashCta = c;
        if (c.disabled) { fail(spec.i, 'cash-out button disabled', c); break; }
        await b.fr.locator('#cta').click();
      } else if (sp.end === 'idle') {
        const tIdle = Date.now(); await shot(b, 'idle_ring'); try { await C.waitView(b.fr, 'ended', 80000); } catch (e) { fail(spec.i, 'idle: run not closed within 80 s', await C.viewOf(b.fr)); break; }
        rd.idleSec = Math.round((Date.now() - tIdle) / 100) / 10;
      }
      try { await C.waitView(b.fr, 'ended', 12000); } catch (e) { fail(spec.i, 'run did not end', await b.fr.evaluate(() => ({ view: window.__campaign.view, busy: window.__campaign.busy }))); break; }
      await sleep(900);
      // ---- checks
      const end = await b.fr.evaluate(() => window.__campaign.lastEnd); const R = C.replay(DATA, key); const ck = rd.checks;
      rd.reason = end.reason; rd.win = end.win; rd.mx = end.mx; rd.endSteps = end.steps; rd.bet = end.bet; rd.after = R.bal(cur); rd.afterOther = R.bal(other);
      const refc = R.refs.get(rd.roundId) || { lines: 0, kinds: [], delta: { play: 0, chips: 0 } }; rd.refKinds = refc.kinds; rd.ledgerDelta = refc.delta[cur];
      const wantReason = sp.end === 'scandal' ? 'scandal' : sp.steps === 0 ? 'withdrawn' : sp.end === 'idle' ? 'timeout' : 'cashout';
      ck.reason = end.reason === wantReason; ck.endSteps = end.steps === (sp.end === 'scandal' ? sp.steps - 1 : sp.steps);
      ck.betMatches = end.bet === stake && end.mode === cur && end.roundId === rd.roundId;
      ck.winRule = sp.end === 'scandal' ? end.win === 0 : sp.steps === 0 ? end.win === stake : end.win === stake * end.mx / 100 && end.win > 0;
      ck.trail = Array.isArray(end.trail) && end.trail.length === (sp.end === 'scandal' ? sp.steps : sp.steps + 1) && end.trail[0] === spec.home[0];
      ck.refOnceOpen = refc.kinds.filter((x) => x === 'open').length === 1; ck.refOnceClose = refc.kinds.filter((x) => x === 'close' || x === 'void').length === 1; ck.refNoMore = refc.kinds.length === 2;
      ck.ledgerDelta = rd.ledgerDelta === -stake + end.win; ck.arith = rd.after === rd.before - stake + end.win; ck.otherCurrency = rd.afterOther === rd.beforeOther;
      ck.beforeIsPrev = prev == null || rd.before === prev.after;
      ck.screenBeforeIsLedger = scrBefore === rd.before;
      const scr = C.numOf(await C.screenBal(b.fr), cur); rd.screen = scr; ck.screenIsLedger = scr === rd.after;
      let pl = NaN; for (let t = 0; t < 12; t++) { pl = C.numOf(await C.plateTxt(b.page, cur), cur); if (pl === rd.after + R.lg.seats(key, cur)) break; await sleep(250); }
      rd.plate = pl; ck.plateIsLedger = pl === rd.after + R.lg.seats(key, cur);
      const pn = await C.panelRead(b.fr); rd.panel = pn; const paid = C.numOf(pn.paid, cur), stk = C.numOf(pn.stake, cur);
      ck.panelPaid = paid === end.win && paid === (rd.after - rd.before + stake); ck.panelStake = stk === stake;
      ck.panelStamp = sp.end === 'scandal' ? /SCANDAL/.test(pn.stamp) : sp.steps === 0 ? /WITHDRAWN/.test(pn.stamp) : sp.end === 'idle' ? /TIME/i.test(pn.stamp) : /VICTORY/.test(pn.stamp);
      ck.noEscrow = R.escrows.length === 0; ck.sumZero = Object.values(R.sumBy).every((v) => v === 0); ck.noNegative = R.neg.length === 0;
      const toastsNow = carry.toasts.concat((await C.toasts(b.fr)).slice(tMark)); rd.toasts = toastsNow; ck.noToasts = toastsNow.length === 0;
      const errNow = carry.errs.concat((await C.errEvents(b.fr)).slice(eMark)); rd.errEvents = errNow; ck.noErrorEvents = errNow.length === 0;
      const sentNow = carry.sent.concat((await C.sentLog(b.page)).slice(sMark)); rd.sent = sentNow.map((s) => s.replace('g:campaign:', ''));
      const cnt = (e) => sentNow.filter((s) => s.startsWith('g:campaign:' + e)).length;
      ck.sentStart = cnt('start') === 1; ck.sentSteps = cnt('step') === sp.steps; ck.sentCash = cnt('cash') === (sp.end === 'cash' ? 1 : 0);
      const lg = b.logs.filter((s) => !sameNoise(s)).slice(logMark), bd = b.bad.filter((s) => !sameNoise(s)).slice(badMark); rd.consoleErrors = lg; rd.badResponses = bd; ck.noConsole = lg.length === 0; ck.noBad = bd.length === 0;
      rd.ms = Date.now() - t0; rd.pass = Object.values(ck).every(Boolean);
      for (const [n, v] of Object.entries(ck)) if (!v) fail(spec.i, 'check ' + n, { rd: { reason: rd.reason, win: rd.win, before: rd.before, after: rd.after, ledgerDelta: rd.ledgerDelta, screen: rd.screen, plate: rd.plate, toasts: rd.toasts, errEvents: rd.errEvents, sent: rd.sent, panel: pn } });
      out.rounds.push(rd); prev = rd; tMark = (await C.toasts(b.fr)).length; eMark = (await C.errEvents(b.fr)).length; sMark = (await C.sentLog(b.page)).length; logMark = b.logs.filter((s) => !sameNoise(s)).length; badMark = b.bad.filter((s) => !sameNoise(s)).length;
      if (sp.end === 'scandal') await shot(b, 'result_scandal'); else if (sp.end === 'idle') await shot(b, 'result_idle'); else if (sp.steps === 0) await shot(b, 'result_withdraw'); else if (spec.kind === 'cash5') await shot(b, 'result_cashout');
      if (spec.kind === 'scandal4') await shot(b, 'result_scandal4'); if (/^eight/.test(spec.kind)) await shot(b, 'result_eight_' + spec.kind.slice(6));
      console.log((rd.pass ? 'ok   ' : 'FAIL ') + 'r' + spec.i + ' ' + spec.kind + ' ' + spec.home[0] + ' ' + stake + ' ' + rd.reason + ' win ' + rd.win + ' ' + rd.before + '->' + rd.after + ' (' + rd.ms + ' ms)');
      save();
      if (!rd.pass) break;
    }
    // ------------------------------------------------------------- end block
    const RE = C.replay(DATA, key); const lastR = out.rounds[out.rounds.length - 1];
    const screenEnd = C.numOf(await C.screenBal(b.fr), MODE), plateEnd = C.numOf(await C.plateTxt(b.page, MODE), MODE);
    out.end = { screen: screenEnd, plate: plateEnd, ledger: RE.bal(MODE), plateWant: RE.bal(MODE) + RE.lg.seats(key, MODE), lastAfter: lastR && lastR.after, other: RE.bal(MODE === 'play' ? 'chips' : 'play'), escrowsNonZero: RE.escrows, sumByCurrency: RE.sumBy, negatives: RE.neg, ledgerRefsForAccount: RE.refs.size };
    if (!(screenEnd === out.end.ledger && plateEnd === out.end.plateWant && (!lastR || lastR.after === out.end.ledger))) fail(99, 'end block: screen/plate/ledger disagree', out.end);
    await finish(out.fails.length ? 'stopped on a fail' : null);
  } catch (e) {
    console.error('ERR', e.stack || e.message); fail(98, 'driver error: ' + (e.message || e).toString().slice(0, 200), null);
    try { await shot(b, 'error_state', false); } catch (e2) { /* ignore */ }
    await finish('driver error');
  } finally { await C.closeBrowser(b); }
  console.log(NAME + ': ' + out.rounds.filter((r) => r.pass).length + '/' + out.rounds.length + ' rounds ok of ' + (out.plan ? out.plan.length : '?') + ', fails ' + out.fails.length + ', pass ' + out.pass);
  process.exit(out.pass ? 0 : 1);
})();
