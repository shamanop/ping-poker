'use strict';
// node tests/money-1008-cfg-bender.js   (about 4 to 6 minutes: real payback measurements, no mocks; needs games/bender-ref.json)
// MONEY HARDENING 1008, K2-Bcfg: the Ballot Bender admin config can no longer rig the pay table. A config is live only after the server measured the payback of the base game and both bonus buys under its
// numbers and none is above 100.0%; the label is the measured value; every accepted or refused change is one audit line; the measuring does not block the event loop; the shipped numbers pass.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bender-1008-cfg-'));
const CFG_FILE = path.join(tmp, 'bender-config.json');
process.env.BENDER_CFG_FILE = CFG_FILE;
const E = require('../games/bender-engine.js'), B = require('../games/bender.js'), R = require('../games/bender-rtp.js');
const SHIPPED = JSON.stringify(E.DEFAULT_CFG);
let pass = 0;
const test = async (name, fn) => { const t0 = Date.now(); try { await fn(); pass++; console.log('ok   ' + name + ' (' + Math.round((Date.now() - t0) / 1000) + ' s)'); } catch (e) { console.error('FAIL ' + name + '\n' + (e.stack || e)); process.exitCode = 1; } };
const quiet = async (fn) => { const o = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = o; } };
const auditLines = () => (fs.existsSync(CFG_FILE + '.audit.log') ? fs.readFileSync(CFG_FILE + '.audit.log', 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
const unchanged = () => { assert.strictEqual(JSON.stringify(E.CFG), SHIPPED, 'Eng.CFG unchanged'); assert.ok(!fs.existsSync(CFG_FILE), 'no config file written'); assert.strictEqual(B.liveInfo().rtpLabel, B.RTP_LABEL); };
const times = (a, k) => a.map((x) => x * k);

(async () => {
  B.init({});
  await test('the reference numbers (games/bender-ref.json) are those of the CURRENT shipped config (a deploy that moves a default must re-run the reference)', () => {
    const ref = R.loadRef(); assert.ok(ref, 'bender-ref.json missing or made for other default numbers'); assert.ok(Math.abs(ref.spin.pct - 98) < 1.5, 'reference spin ' + ref.spin.pct); assert.ok(ref.spin.se < 0.5);
  });
  const RIGGED = [
    ['K2-Bcfg: the critic\'s rig, scatterW 1e6 and scatterPay[6] 10000, typed with the label "98% (long-run)"', { scatterW: 1e6, scatterPay: { 6: 10000 } }],
    ['pay table x3 (a pay-only change: paired mode)', { pay: Object.fromEntries(Object.entries(E.DEFAULT_CFG.pay).map(([k, v]) => [k, times(v, 3)])) }],
    ['cheap buy: buyCost.election 0.0002', { buyCost: { election: 0.0002 } }],
    ['cheap buy: buyCost.landslide 1', { buyCost: { landslide: 1 } }],
    ['all symbol weights 0 (accepted by the old validator)', { weights: { pen: 0, stk: 0, bal: 0, yrd: 0, meg: 0, cap: 0, phn: 0, seal: 0 }, wildW: 0, scatterW: 0 }],
  ];
  await test('K2-Bcfg: rigged configs are refused; nothing is saved or swapped, the label stays; each refusal is one audit line with who and the measured numbers', async () => {
    for (const [name, over] of RIGGED) {
      const n0 = auditLines().length;
      await assert.rejects(quiet(() => B.setLiveConfigChecked({ overrides: over, rtpLabel: '98% (long-run)', who: 'test-admin#1234', note: name })), (e) => { if (!/^cfg: refused,/.test(e.message)) console.error('UNEXPECTED ' + name + ': ' + e.message); return /^cfg: refused,/.test(e.message); }, name);
      unchanged();
      const a = auditLines(); assert.strictEqual(a.length, n0 + 1, name); const l = a[a.length - 1];
      assert.strictEqual(l.outcome, 'refused'); assert.strictEqual(l.who, 'test-admin#1234'); assert.ok(!Number.isNaN(Date.parse(l.t))); assert.strictEqual(l.old.pct, 98.0); assert.ok(l.why);
    }
    // the synchronous setter has no way in without a proof for exactly these numbers (the critic's p-bender.js calls it directly)
    assert.throws(() => B.setLiveConfig({ overrides: RIGGED[0][1], rtpLabel: '98% (long-run)', note: 'k2' }), /no passing payback measurement/);
    assert.throws(() => B.setLiveConfig({ overrides: RIGGED[1][1], measured: { ok: true, hash: 'f'.repeat(64) } }), /no passing payback measurement/, 'a proof for other numbers');
    assert.throws(() => B.setLiveConfig({ overrides: RIGGED[1][1], measured: { ok: false, hash: R.cfgHash(E.DEFAULT_CFG) } }), /no passing payback measurement/);
    unchanged();
  });
  await test('a saved file without a passing measurement is not loaded at boot', async () => {
    fs.writeFileSync(CFG_FILE, JSON.stringify({ overrides: { scatterW: 1e6, scatterPay: { 6: 10000 } }, rtpLabel: '98% (long-run)', note: 'hand edited' }));
    const err = console.error; const said = []; console.error = (...x) => said.push(x.join(' ')); try { B.loadLiveConfig(); } finally { console.error = err; }
    assert.strictEqual(JSON.stringify(E.CFG), SHIPPED); assert.ok(said.some((m) => /payback measurement/.test(m)), said.join('|')); assert.strictEqual(B.liveInfo().rtpLabel, B.RTP_LABEL); fs.rmSync(CFG_FILE, { force: true });
  });
  await test('the shipped numbers: reset is accepted without a measurement; the paired check of the shipped config returns the reference; a DIRECT full-budget measurement of it is under 100% on every way', async () => {
    await quiet(() => B.setLiveConfigChecked({ overrides: {}, who: 'test-admin#1234', note: 'reset' })); assert.strictEqual(B.liveInfo().rtpLabel, B.RTP_LABEL);
    const p = await R.measure(JSON.parse(SHIPPED)); assert.strictEqual(p.mode, 'paired'); assert.strictEqual(p.ok, true); assert.ok(p.ms < 1000);
    const d = await R.measure(JSON.parse(SHIPPED), { direct: true }); const s = Object.fromEntries(Object.entries(d.ways).map(([w, x]) => [w, x.pct.toFixed(2) + ' +-' + x.se.toFixed(2)]));
    console.log('     shipped, direct, full budget: ' + JSON.stringify(s) + ' in ' + Math.round(d.ms / 1000) + ' s, longest stretch ' + Math.round(d.maxStretchMs) + ' ms; reference ' + JSON.stringify({ spin: R.loadRef().spin.pct.toFixed(2), buyE: R.loadRef().buyElection.pct.toFixed(2), buyL: R.loadRef().buyLandslide.pct.toFixed(2) }));
    assert.strictEqual(d.mode, 'direct'); assert.ok(d.maxStretchMs < 250);
    for (const w of ['spin', 'buyElection', 'buyLandslide']) assert.ok(d.ways[w].pct < 100 + 2 * d.ways[w].se, w + ' ' + d.ways[w].pct + ' +-' + d.ways[w].se + ' (a direct election-buy estimate is wide: that is why shipped-like configs use the paired mode)');
    assert.ok(Math.abs(d.ways.spin.pct - R.loadRef().spin.pct) < 4 * d.ways.spin.se + 0.5, 'direct spin agrees with the reference');
  });
  await test('a mild pay-table change (x0.9, payback goes down) is accepted: the label is the measured value, one audit line, the event loop is never blocked 250 ms, the file carries the measurement and reloads', async () => {
    let maxGap = 0, last = Date.now(); const probe = setInterval(() => { const t = Date.now(); maxGap = Math.max(maxGap, t - last); last = t; }, 5);
    const over = { pay: Object.fromEntries(Object.entries(E.DEFAULT_CFG.pay).map(([k, v]) => [k, times(v, 0.9)])) };
    try {
      const first = quiet(() => B.setLiveConfigChecked({ overrides: over, rtpLabel: '98% (long-run)', note: 'x0.9', who: 'test-admin#5678' }));
      await new Promise((r) => setTimeout(r, 30));
      await assert.rejects(quiet(() => B.setLiveConfigChecked({ overrides: over, who: 'second' })), /another payback check is running/);
      const info = await first;
      assert.ok(/^\d+\.\d% \(measured by the server when this was set: base game, \+-\d+\.\d; highest way \w+ \d+\.\d%\)$/.test(info.rtpLabel), info.rtpLabel); assert.notStrictEqual(info.rtpLabel, B.RTP_LABEL);
      const spinPct = parseFloat(info.rtpLabel); assert.ok(spinPct > 80 && spinPct < 95, 'x0.9 pay lowers the base game from ~98 to ~88: ' + spinPct);
      const a = auditLines(), l = a[a.length - 1]; assert.strictEqual(l.outcome, 'accepted'); assert.strictEqual(l.who, 'test-admin#5678'); assert.strictEqual(l.old.pct, 98.0); assert.ok(l.new.spin.pct > 80 && l.new.maxStretchMs < 250);
      assert.ok(maxGap < 250, 'event loop gap ' + maxGap + ' ms'); console.log('     probe gap ' + maxGap + ' ms; check says ' + l.new.maxStretchMs + ' ms; took ' + (l.new.ms / 1000).toFixed(1) + ' s; ways ' + JSON.stringify(l.new.ways));
      const j = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); assert.strictEqual(j.measured.ok, true);
      E.resetConfig(); B.loadLiveConfig(); assert.strictEqual(E.CFG.pay.pen[0], E.DEFAULT_CFG.pay.pen[0] * 0.9); assert.ok(/measured by the server/.test(B.liveInfo().rtpLabel));
    } finally { clearInterval(probe); }
    await quiet(() => B.setLiveConfigChecked({ overrides: {} }));
  });
  console.log(pass + ' passed' + (process.exitCode ? ', with failures' : ''));
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
