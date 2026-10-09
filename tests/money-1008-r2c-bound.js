'use strict';
// node tests/money-1008-r2c-bound.js   (about 3 minutes: the critic's config is measured at the full budget; R2C_ROOT=<dir> runs it against another checkout)
// MONEY HARDENING 1008, R2C-3: the payback check accepted a config on the point estimate and ignored its own standard error (fixed seed). RULE under test (Ballot Bender and Cold Call): a config is accepted only when
// EVERY pay way is at or under 100.0% with the uncertainty counted against the admin, upper bound = measured + 3 standard errors; a way that cannot be measured tightly enough makes the config refused, and the reply says which way.
const path = require('path'), fs = require('fs'), os = require('os'), assert = require('assert');
const ROOT = process.env.R2C_ROOT || path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r2c-bound-'));
process.env.BENDER_CFG_FILE = path.join(tmp, 'bender-config.json'); process.env.COLDCALL_CFG_FILE = path.join(tmp, 'coldcall-config.json');
const E = require(path.join(ROOT, 'games/bender-engine.js')), B = require(path.join(ROOT, 'games/bender.js')), R = require(path.join(ROOT, 'games/bender-rtp.js')), L = require(path.join(ROOT, 'games/coldcall-livecfg.js'));
let pass = 0, fail = 0;
const test = async (name, fn) => { const t0 = Date.now(); try { await fn(); pass++; console.log('ok   ' + name + ' (' + Math.round((Date.now() - t0) / 100) / 10 + ' s)'); } catch (e) { fail++; console.error('FAIL ' + name + '\n     ' + String(e.message).split('\n').join('\n     ')); } };
const quiet = async (fn) => { const o = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = o; } };
const D = E.DEFAULT_CFG, r4 = (x) => Math.round(x * 1e4) / 1e4;
const bcfg = (over) => { const c = JSON.parse(JSON.stringify(D)); (function m(b, o) { for (const k of Object.keys(o)) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) m(b[k], o[k]); else b[k] = o[k]; } })(c, over); return c; };
const payX = (S) => ({ pay: Object.fromEntries(Object.entries(D.pay).map(([k, a]) => [k, a.map((v) => r4(v * S))])), scatterPay: Object.fromEntries(Object.entries(D.scatterPay).map(([k, v]) => [k, r4(v * S)])) });
(async () => {
  B.init({});
  await test('Ballot Bender: ok means every way\'s upper bound (measured + 3 SE) is at or under 100; a config whose POINT estimates are all at or under 100 but whose standard error is wide is refused, and the result names the way', async () => {
    let seen = 0;
    for (const over of [{ ...payX(0.12), buyCost: { election: 3.0 } }, { ...payX(0.5), buyCost: { landslide: 90 } }, { spinsFor: { 6: 21 }, buyCost: { landslide: 73.8 } }, { ...payX(0.3), buyCost: { election: 6 } }]) {
      const r = await quiet(() => R.measure(bcfg(over), { scale: 0.1 }));
      assert.ok(r.bound && r.bound.way && Number.isFinite(r.bound.upper), 'no bound in the result');
      for (const [w, x] of Object.entries(r.ways)) assert.ok(r.bound.upper >= x.pct + 3 * x.se - 1e-9, w + ' above the reported bound');
      assert.strictEqual(r.ok, r.bound.upper <= 100, 'ok ' + r.ok + ' with bound ' + r.bound.upper.toFixed(1) + ' (' + r.bound.way + ')');
      if (r.worst.pct <= 100 && !r.ok) seen++;
    }
    assert.ok(seen >= 1, 'no config in the set read at or under 100 on the point estimate and was refused on its bound (the test is not sensitive)');
  });
  await test('Ballot Bender: the shipped numbers (the reference) are inside the bound', async () => {
    const r = await quiet(() => R.measure(bcfg({}), { scale: 0.1 }));
    assert.ok(r.ok && r.bound.upper < 100, 'shipped bound ' + JSON.stringify(r.bound));
  });
  await test('Ballot Bender admin path: the critic\'s p8 config (spinsFor[6] 21, landslide buy 73.8x; the check read the buy 99.5% +-2.1, the reference says 102.1%) is REFUSED at the full budget, the reply names the way and the bound, nothing changes', async () => {
    const before = JSON.stringify(E.currentConfig());
    let err = null; try { await quiet(() => B.setLiveConfigChecked({ overrides: { spinsFor: { 6: 21 }, buyCost: { landslide: 73.8 } }, note: 'r2c-3', who: 'r2c-test' })); } catch (e) { err = e; }
    assert.ok(err, 'ACCEPTED'); assert.ok(/buyLandslide|buyElection|spin/.test(err.message) && /upper bound/.test(err.message) && /ceiling/.test(err.message), err.message);
    assert.strictEqual(JSON.stringify(E.currentConfig()), before); assert.ok(!fs.existsSync(process.env.BENDER_CFG_FILE));
    const a = fs.readFileSync(process.env.BENDER_CFG_FILE + '.audit.log', 'utf8').trim().split('\n').map((l) => JSON.parse(l)); assert.strictEqual(a[a.length - 1].outcome, 'refused');
  });
  await test('Cold Call: the same rule. ok means every way\'s upper bound is at or under 100; the refusal names the way and the bound', async () => {
    let seen = 0;
    for (const over of [{ payScale: 0.9 }, { buyCost: { bonus1: 1100 } }, { payScale: 0.97 }]) {
      const r = await quiet(() => L.measurePayback(L.merge(over), { scale: 0.1 }));
      assert.ok(r.bound && r.bound.way && Number.isFinite(r.bound.upper), 'no bound in the result');
      for (const [w, x] of Object.entries(r.ways)) if (x.judged !== 'gift') assert.ok(r.bound.upper >= x.pct + 3 * x.se - 1e-9, w + ' above the bound');
      assert.strictEqual(r.ok, r.bound.upper <= 100 && r.giftOk);
      if (r.worst.pct <= 100 && !r.ok && r.giftOk) seen++;
    }
    assert.ok(seen >= 1, 'no config read at or under 100 on the point estimate and was refused on its bound (not sensitive)');
    let err = null; try { await quiet(() => L.setLiveConfigChecked({ overrides: { payScale: 0.97 }, scale: 0.1, who: 'r2c-test' })); } catch (e) { err = e; }
    assert.ok(err && /upper bound/.test(err.message) && /ceiling/.test(err.message), err ? err.message : 'accepted');
  });
  console.log(pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})();
