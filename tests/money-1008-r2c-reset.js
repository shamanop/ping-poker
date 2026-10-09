'use strict';
// node tests/money-1008-r2c-reset.js   (about 20 s; R2C_ROOT=<dir> runs it against another checkout)
// MONEY HARDENING 1008, R2C-2: a reset POSTed while a payback check runs was answered "shipped numbers", then the pending config landed on top of it. RULE under test (Cold Call and Ballot Bender): a reset
// (any accepted change) cancels the pending check; a check that finishes later swaps in only if no later admin action was accepted; a new POST after a reset is not blocked by the cancelled check.
const path = require('path'), fs = require('fs'), os = require('os'), assert = require('assert');
const ROOT = process.env.R2C_ROOT || path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r2c-reset-'));
process.env.BENDER_CFG_FILE = path.join(tmp, 'bender-config.json'); process.env.COLDCALL_CFG_FILE = path.join(tmp, 'coldcall-config.json');
const BE = require(path.join(ROOT, 'games/bender-engine.js')), B = require(path.join(ROOT, 'games/bender.js')), L = require(path.join(ROOT, 'games/coldcall-livecfg.js')), CE = require(path.join(ROOT, 'games/coldcall-engine.js'));
let pass = 0, fail = 0;
const test = async (name, fn) => { const t0 = Date.now(); try { await fn(); pass++; console.log('ok   ' + name + ' (' + (Date.now() - t0) + ' ms)'); } catch (e) { fail++; console.error('FAIL ' + name + '\n     ' + String(e.message).split('\n').join('\n     ')); } };
const quiet = async (fn) => { const o = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = o; } };
const settle = (p) => p.then((v) => ({ ok: true, v }), (e) => ({ ok: false, msg: String(e.message) }));
const SC = 0.05;
const has = (live, o) => Object.keys(o).every((k) => (o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) ? has(live[k], o[k]) : JSON.stringify(live[k]) === JSON.stringify(o[k])));
const D = BE.DEFAULT_CFG, r4 = (x) => Math.round(x * 1e4) / 1e4;
const GAMES = [
  { name: 'Ballot Bender',
    A: { pay: Object.fromEntries(Object.entries(D.pay).map(([k, a]) => [k, a.map((v) => r4(v * 0.9))])) }, Bc: { buyCost: { election: 12 } },
    set: (o, extra) => B.setLiveConfigChecked({ overrides: o, scale: SC, who: 'r2c-test', ...extra }),
    custom: () => JSON.stringify(BE.currentConfig()) !== JSON.stringify(D), live: () => BE.currentConfig(), info: () => B.liveInfo(), file: () => process.env.BENDER_CFG_FILE },
  { name: 'Cold Call',
    A: { payScale: 0.4, buyCost: { bonus1: 1800, bonus2: 5000 } }, Bc: { payScale: 0.5, buyCost: { bonus1: 1500, bonus2: 4500 } },   // far under 100% on every way, so even the small-budget check passes the upper bound (R2C-3)
    set: (o, extra) => L.setLiveConfigChecked({ overrides: o, scale: SC, who: 'r2c-test', ...extra }),
    custom: () => JSON.stringify(CE.CFG) !== JSON.stringify(L.DEFAULT), live: () => CE.CFG, info: () => L.liveInfo('SHIPPED'), file: () => process.env.COLDCALL_CFG_FILE },
];
(async () => {
  B.init({}); L.loadLiveConfig(() => {});
  for (const G of GAMES) {
    const rtpLabel = () => G.info().rtpLabel;
    await quiet(() => G.set({}));
    await test(G.name + ': control, a check with no reset in between is accepted and goes live', async () => {
      const r = await quiet(() => settle(G.set(G.A))); assert.ok(r.ok, 'refused: ' + r.msg); assert.ok(G.custom() && has(G.live(), G.A));
      await quiet(() => G.set({})); assert.ok(!G.custom());
    });
    await test(G.name + ': a reset POSTed while a check runs wins: the pending config is refused and never goes live; the file and the label stay shipped', async () => {
      const pA = settle(G.set(G.A, { note: 'A' }));
      const reset = await quiet(() => settle(G.set({}, { note: 'reset' })));
      assert.ok(reset.ok, 'reset refused: ' + reset.msg);
      assert.ok(!G.custom(), 'shipped numbers right after the reset');
      const a = await quiet(() => pA);
      assert.ok(!a.ok, 'the check that was running was told it was accepted');
      assert.ok(/another admin change|superseded/.test(a.msg), 'reply says why: ' + a.msg);
      assert.ok(!G.custom(), 'the pending config landed on top of the reset');
      assert.strictEqual(G.info().note, 'reset');
      assert.ok(!fs.existsSync(G.file()) || !Object.keys(JSON.parse(fs.readFileSync(G.file(), 'utf8')).overrides || {}).length, 'the file holds the reset');
      assert.ok(/SHIPPED|98%/.test(rtpLabel()), 'label ' + rtpLabel());
    });
    await test(G.name + ': after a reset a new config can be POSTed at once (the cancelled check does not block it) and is the one that goes live', async () => {
      const pA = settle(G.set(G.A));
      await quiet(() => G.set({}));
      const pB = settle(G.set(G.Bc, { note: 'B' }));
      const [a, b] = await quiet(() => Promise.all([pA, pB]));
      assert.ok(!a.ok, 'A superseded'); assert.ok(b.ok, 'B refused: ' + b.msg);
      assert.ok(G.custom() && has(G.live(), G.Bc) && G.info().note === 'B', 'B is live');
      await quiet(() => G.set({}));
    });
    await test(G.name + ': a second POST while a check runs is still refused (one check at a time)', async () => {
      const pA = settle(G.set(G.A)); const b = await quiet(() => settle(G.set(G.Bc)));
      assert.ok(!b.ok && /another payback check/.test(b.msg), b.msg); const a = await quiet(() => pA); assert.ok(a.ok, a.msg); await quiet(() => G.set({}));
    });
    await test(G.name + ': the cancelled check ends early (it does not run to the end of its budget)', async () => {
      const t0 = Date.now(), pA = settle(G.set(G.A, { scale: 1 })); await quiet(() => G.set({})); const a = await quiet(() => pA);
      assert.ok(!a.ok && Date.now() - t0 < 5000, 'ended after ' + (Date.now() - t0) + ' ms: ' + a.msg);
    });
  }
  console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
