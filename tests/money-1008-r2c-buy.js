'use strict';
// node tests/money-1008-r2c-buy.js   (about 40 s; R2C_ROOT=<dir> runs it against another checkout)
// MONEY HARDENING 1008, R2C-1: a Ballot Bender bonus buy is charged in whole cents (round(buyCost x bet)) and its win is paid unscaled, but the payback check measured it at the nominal price buyCost x bet.
// RULE under test: the check measures each buy at the LOWEST price (in bets) that any allowed bet is charged, so a config is accepted only if the buy is at or under the ceiling at EVERY bet a player can pick.
const path = require('path'), fs = require('fs'), os = require('os'), assert = require('assert');
const ROOT = process.env.R2C_ROOT || path.join(__dirname, '..');
process.env.BENDER_CFG_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'r2c-buy-')), 'bender-config.json');
const E = require(path.join(ROOT, 'games/bender-engine.js')), B = require(path.join(ROOT, 'games/bender.js')), R = require(path.join(ROOT, 'games/bender-rtp.js'));
let pass = 0, fail = 0;
const test = async (name, fn) => { const t0 = Date.now(); try { await fn(); pass++; console.log('ok   ' + name + ' (' + Math.round((Date.now() - t0) / 100) / 10 + ' s)'); } catch (e) { fail++; console.error('FAIL ' + name + '\n     ' + String(e.message).split('\n').join('\n     ')); } };
const D = E.DEFAULT_CFG, r4 = (x) => Math.round(x * 1e4) / 1e4, SC = 0.1;
const cfgWith = (buyCost, S) => { const c = JSON.parse(JSON.stringify(D)); if (S) { for (const k of Object.keys(c.pay)) c.pay[k] = c.pay[k].map((v) => r4(v * S)); for (const k of Object.keys(c.scatterPay)) c.scatterPay[k] = r4(c.scatterPay[k] * S); } Object.assign(c.buyCost, buyCost); return c; };
const charged = (cost, bet) => Math.round(cost * bet);
(async () => {
  B.init({});
  await test('what the handler charges: the lowest price in bets over the allowed bets is the one the check should use (1.49x -> 1c at the 1c bet, 1.51x -> 1.5x at the 2c bet)', () => {
    assert.strictEqual(typeof R.lowestPrice, 'function', 'bender-rtp.js exports no lowestPrice');
    const lo = (c) => Math.min(...E.BET_LEVELS.filter((b) => charged(c, b) > 0).map((b) => charged(c, b) / b));
    for (const c of [1.49, 1.51, 2.4, 10.91, 77.21, 33.3, 0.7]) assert.ok(Math.abs(R.lowestPrice(c) - Math.min(lo(c), c)) < 1e-9, c + ': ' + R.lowestPrice(c) + ' vs ' + lo(c));
  });
  await test('the measured payback of a buy is the one at its lowest charged price: the same sample under buyCost 1.49 and under 1.0 (both charged 1c at the 1c bet) reads the SAME payback', async () => {
    const o = console.log; console.log = () => {};
    let a, b;
    try { a = await R.measure(cfgWith({ election: 1.49 }, 0.12), { scale: SC }); b = await R.measure(cfgWith({ election: 1.0 }, 0.12), { scale: SC }); } finally { console.log = o; }
    assert.ok(Math.abs(a.ways.buyElection.pct - b.ways.buyElection.pct) < 1e-6, 'buyCost 1.49 reads ' + a.ways.buyElection.pct.toFixed(2) + '%, buyCost 1.0 reads ' + b.ways.buyElection.pct.toFixed(2) + '% (the 1c bet pays the same for both)');
  });
  await test('through the admin path: setLiveConfigChecked refuses the critic\'s config (pay x0.12, election 1.49x) and changes nothing', async () => {
    const D0 = JSON.stringify(E.currentConfig()), o = console.log; console.log = () => {};
    const over = { pay: Object.fromEntries(Object.entries(D.pay).map(([k, a]) => [k, a.map((v) => r4(v * 0.12))])), scatterPay: Object.fromEntries(Object.entries(D.scatterPay).map(([k, v]) => [k, r4(v * 0.12)])), buyCost: { election: 1.49, landslide: 77.21 } };
    let err = null; try { await B.setLiveConfigChecked({ overrides: over, scale: 0.3, who: 'r2c-test' }); } catch (e) { err = e; } finally { console.log = o; }
    assert.ok(err && /above the 100% ceiling|ceiling/.test(err.message), 'accepted or wrong error: ' + (err && err.message));
    assert.strictEqual(JSON.stringify(E.currentConfig()), D0, 'config changed');
  });
  console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
