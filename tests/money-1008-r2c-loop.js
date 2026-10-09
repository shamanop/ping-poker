'use strict';
// node tests/money-1008-r2c-loop.js   (about 40 s; R2C_ROOT=<dir> runs it against another checkout; against 2dee7c1 it stops the process for minutes: run it with a timeout)
// MONEY HARDENING 1008, R2C-4: one admin POST must not stop the server. RULE under test (Cold Call and Ballot Bender): every number of an admin config has a range checked BEFORE any building or measuring (out of range =
// refused at once, nothing run); no config check holds the event loop for more than 250 ms in one stretch (the smoke test and the measuring run in a worker thread); a check that cannot finish is refused and stopped.
const path = require('path'), fs = require('fs'), os = require('os'), assert = require('assert');
const ROOT = process.env.R2C_ROOT || path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r2c-loop-'));
process.env.BENDER_CFG_FILE = path.join(tmp, 'bender-config.json'); process.env.COLDCALL_CFG_FILE = path.join(tmp, 'coldcall-config.json');
const E = require(path.join(ROOT, 'games/bender-engine.js')), B = require(path.join(ROOT, 'games/bender.js')), L = require(path.join(ROOT, 'games/coldcall-livecfg.js'));
let pass = 0, fail = 0;
const test = async (name, fn) => { const t0 = Date.now(); try { await fn(); pass++; console.log('ok   ' + name + ' (' + Math.round((Date.now() - t0) / 100) / 10 + ' s)'); } catch (e) { fail++; console.error('FAIL ' + name + '\n     ' + String(e.message).split('\n').join('\n     ')); } };
const quiet = async (fn) => { const o = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = o; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// a second "socket": a 20 ms ping on the same event loop; reports the longest gap and the number of answers
const probe = () => { let last = Date.now(), max = 0, n = 0; const iv = setInterval(() => { const t = Date.now(); max = Math.max(max, t - last - 20); last = t; n++; }, 20); return { stop: () => { clearInterval(iv); return { maxLateMs: max, pings: n }; } }; };
const z9 = () => [0, 0, 0, 0, 0, 0, 0, 0, 0];
(async () => {
  B.init({}); L.loadLiveConfig(() => {});
  const OUT = [
    ['Bender maxSpins 400000 + spinsFor[3] 400000 (the critic\'s POST)', { maxSpins: 400000, spinsFor: { 3: 400000 } }],
    ['Bender maxSpins 4e6', { maxSpins: 4e6 }], ['Bender spinsFor[6] 1e9', { spinsFor: { 6: 1e9 } }], ['Bender retrigger[3] 1e6', { retrigger: { 3: 1e6 } }], ['Bender maxTumbles 1e6', { maxTumbles: 1e6 }],
    ['Bender buyCost.election 1e12', { buyCost: { election: 1e12 } }], ['Bender pay.pen[0] 1e12', { pay: { pen: [1e12, 1, 1, 1, 1, 1, 1, 1, 1] } }], ['Bender weights.pen 1e12', { weights: { pen: 1e12 } }], ['Bender maxSticky 1e6', { maxSticky: 1e6 }],
  ];
  await test('Ballot Bender: a number outside its range is refused at once (under 1 s), by name, with nothing built or measured, and a second socket\'s ping is never late', async () => {
    const p = probe(), t0 = Date.now();
    for (const [name, over] of OUT) {
      const t = Date.now(); let err = null; try { await quiet(() => B.setLiveConfigChecked({ overrides: over, who: 'r2c-test' })); } catch (e) { err = e; }
      assert.ok(err && /must be between|range|at most/.test(err.message), name + ': ' + (err ? err.message : 'ACCEPTED'));
      assert.ok(Date.now() - t < 1000, name + ' took ' + (Date.now() - t) + ' ms');
    }
    const r = p.stop(); assert.ok(Date.now() - t0 < 3000 && r.maxLateMs < 250, 'ping late by ' + r.maxLateMs + ' ms');
  });
  await test('Ballot Bender: the shipped numbers and the critic-style small tweaks are inside every range', () => {
    E.validateConfig({}); E.validateConfig({ buyCost: { election: 12 } }); E.validateConfig({ pay: { seal: [4.989, 9.969, 21.28, 36.84, 61.84, 123.4, 312.2, 1406, 5612] }, scatterPay: { 6: 10000 } }); E.validateConfig({ scatterW: 1e6 });
  });
  await test('Ballot Bender: a config inside every range whose bonus never ends (200 spins x 14 tumbles, one symbol) is checked in a worker: the event loop is never late by 250 ms over 6 s, and a reset stops the check', async () => {
    const over = { weights: { pen: 1000, stk: 0, bal: 0, yrd: 0, meg: 0, cap: 0, phn: 0, seal: 0 }, maxSpins: 200, spinsFor: { 3: 100, 4: 100, 5: 100, 6: 100 }, retrigger: { 3: 40, 4: 40, 5: 40 }, maxTumbles: 100 };
    const p = probe(); const pending = quiet(() => B.setLiveConfigChecked({ overrides: over, who: 'r2c-test' })).then(() => 'ACCEPTED', (e) => 'refused: ' + e.message);
    await sleep(6000); const r = p.stop();
    assert.ok(r.maxLateMs < 250, 'the event loop stood still for ' + r.maxLateMs + ' ms'); assert.ok(r.pings > 150, 'only ' + r.pings + ' pings in 6 s');
    await quiet(() => B.setLiveConfigChecked({ overrides: {}, who: 'r2c-test' }));
    const t = Date.now(), res = await Promise.race([pending, sleep(3000).then(() => 'STILL RUNNING')]);
    assert.ok(/another admin change|superseded/.test(res), 'the check was not stopped by the reset: ' + res); assert.ok(Date.now() - t < 3000);
  });
  await test('Cold Call: the critic\'s in-range config (maxSpins 200, maxCascades 200, spins 100, retrigger 40, one symbol; a smoke test of 15 s) is checked in a worker: the event loop is never late by 250 ms over 6 s, and a reset stops the check', async () => {
    const over = { weights: [1000, 0, 0, 0, 0, 0, 0, 0, 0, 0], pay: { mug: z9() }, maxSpins: 200, maxCascades: 200, maxRevealRounds: 100, spins: { bonus1: 100, bonus2: 100, bonus3: 100 }, retrigger: { two: 40, three: 40, upgrade: 40 } };
    const p = probe(); const pending = quiet(() => L.setLiveConfigChecked({ overrides: over, who: 'r2c-test' })).then(() => 'ACCEPTED', (e) => 'refused: ' + e.message);
    await sleep(6000); const r = p.stop();
    assert.ok(r.maxLateMs < 250, 'the event loop stood still for ' + r.maxLateMs + ' ms'); assert.ok(r.pings > 150, 'only ' + r.pings + ' pings in 6 s');
    await quiet(() => L.setLiveConfigChecked({ overrides: {}, who: 'r2c-test' }));
    const t = Date.now(), res = await Promise.race([pending, sleep(3000).then(() => 'STILL RUNNING')]);
    assert.ok(/another admin change|superseded/.test(res), 'the check was not stopped by the reset: ' + res); assert.ok(Date.now() - t < 3000);
  });
  await test('both games: an ordinary config is still checked and accepted through the worker, and the longest late ping stays under 250 ms while it runs', async () => {
    const p = probe();
    const a = await quiet(() => L.setLiveConfigChecked({ overrides: { payScale: 0.4, buyCost: { bonus1: 1800, bonus2: 5000 } }, scale: 0.05, who: 'r2c-test' }));
    const b = await quiet(() => B.setLiveConfigChecked({ overrides: { pay: Object.fromEntries(Object.entries(E.DEFAULT_CFG.pay).map(([k, v]) => [k, v.map((x) => Math.round(x * 0.5 * 1e4) / 1e4)])) }, scale: 0.05, who: 'r2c-test' }));
    const r = p.stop(); assert.ok(a.measured && b.measured, 'no measurement'); assert.ok(r.maxLateMs < 250, 'ping late by ' + r.maxLateMs + ' ms');
    await quiet(() => L.setLiveConfigChecked({ overrides: {} })); await quiet(() => B.setLiveConfigChecked({ overrides: {} }));
  });
  console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
