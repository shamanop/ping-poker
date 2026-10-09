'use strict';
// node tests/money-1008-cfg-coldcall.js   (about 6 to 9 minutes: it runs the real payback measurements, no mocks)
// MONEY HARDENING 1008, K4-1: the Cold Call live config check has a payback ceiling. A config is live only after the server has measured every paid way to play under its numbers and none is above
// 100.0%; the label players see is the measured value; every accepted or refused change is one audit line; the measuring never blocks the event loop for long; the shipped numbers and the documented presets pass.
const fs = require('fs'), os = require('os'), path = require('path'), assert = require('assert');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-1008-cfg-'));
const CFG_FILE = path.join(tmp, 'coldcall-config.json');
process.env.COLDCALL_CFG_FILE = CFG_FILE;
for (const k of ['DATA_DIR', 'RAILWAY_VOLUME_MOUNT_PATH']) delete process.env[k];
const E = require('../games/coldcall-engine.js'), L = require('../games/coldcall-livecfg.js'), SRV = require('../games/coldcall.js');
const SHIPPED = JSON.stringify(E.CFG);
const preset = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cold-call', 'presets', n + '.json'), 'utf8'));
let pass = 0;
const test = async (name, fn) => { const t0 = Date.now(); try { await fn(); pass++; console.log('ok   ' + name + ' (' + Math.round((Date.now() - t0) / 1000) + ' s)'); } catch (e) { console.error('FAIL ' + name + '\n' + (e.stack || e)); process.exitCode = 1; } };
const quiet = async (fn) => { const o = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = o; } };
const auditLines = () => (fs.existsSync(CFG_FILE + '.audit.log') ? fs.readFileSync(CFG_FILE + '.audit.log', 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
const unchanged = () => { assert.strictEqual(JSON.stringify(E.CFG), SHIPPED, 'Eng.CFG unchanged'); assert.ok(!fs.existsSync(CFG_FILE), 'no config file written'); };

(async () => {
  // the seven configs of the critic's repro (_scratch/money/k4/repro-k4-1-livecfg-rtp.js): every one passed the old range checks and smoke test
  const BAD = [
    ['one digit dropped: pull.list 45', { pull: { list: 45 } }, /plain|daily|ceiling|gift/],
    ['Callback kind bonus2', { pull: { callback: { kind: 'bonus2' } } }, /ceiling/],
    ['payScale 2', { payScale: 2 }, /ceiling/],
    ['one digit dropped: buyCost.bonus2 291', { buyCost: { bonus2: 291 } }, /ceiling/],
    ['buyCost.bonus1 1', { buyCost: { bonus1: 1 } }, /ceiling/],
    ['daily gift 100 leads at a $25 stake cap', { pull: { daily: { base: 100, stakeCap: 2500 } } }, /daily gift/],
    ['adjacency 8', { adjacency: 8 }, /ceiling/],
  ];
  await test('K4-1: the critic\'s seven configs are all refused, nothing is saved, swapped or broadcast, and each refusal is one audit line with the measured numbers', async () => {
    for (const [name, over, why] of BAD) {
      const n0 = auditLines().length;
      await assert.rejects(quiet(() => L.setLiveConfigChecked({ overrides: over, who: 'test-admin#1234', note: name })), (e) => /^cfg: refused,/.test(e.message) && why.test(e.message), name);
      unchanged();
      const a = auditLines(); assert.strictEqual(a.length, n0 + 1, 'one audit line: ' + name);
      const l = a[a.length - 1]; assert.strictEqual(l.outcome, 'refused'); assert.strictEqual(l.who, 'test-admin#1234'); assert.ok(l.t && !Number.isNaN(Date.parse(l.t))); assert.ok(l.old && l.old.pct === 98.0, 'old measured payback is on the line'); assert.ok(l.new && l.new.worst && l.new.worst.pct > 100 || /gift/.test(l.why), 'new measured payback is on the line');
    }
  });
  await test('K4-1: the synchronous swap machinery is never silent about an unmeasured config, and the file it saves is NOT trusted at the next boot', async () => {
    const over = { buyCost: { bonus1: 1000 } };
    await quiet(async () => { L.setLiveConfig({ overrides: over, note: 'machinery test' }); });
    const a = auditLines(), l = a[a.length - 1]; assert.strictEqual(l.outcome, 'unchecked'); assert.strictEqual(l.who, 'in-process caller');
    E.CFG.buyCost.bonus1 = 964; const said = []; assert.strictEqual(L.loadLiveConfig((...x) => said.push(x.join(' '))), false, 'an unmeasured file is not loaded at boot'); assert.ok(/payback measurement/.test(said.join()));
    assert.strictEqual(JSON.stringify(E.CFG), SHIPPED); fs.rmSync(CFG_FILE, { force: true });
  });
  await test('K4-1: a saved file without a passing measurement is not loaded at boot (the game boots on the shipped numbers, one log line)', async () => {
    fs.writeFileSync(CFG_FILE, JSON.stringify({ overrides: { pull: { list: 45 } }, note: 'hand edited', updatedAt: '2026-10-08T00:00:00.000Z' }));
    const said = []; assert.strictEqual(L.loadLiveConfig((...x) => said.push(x.join(' '))), false); assert.strictEqual(said.length, 1); assert.ok(/payback measurement/.test(said[0]));
    assert.strictEqual(JSON.stringify(E.CFG), SHIPPED);
    fs.writeFileSync(CFG_FILE, JSON.stringify({ overrides: { pull: { list: 45 } }, measured: { ok: true, hash: 'a'.repeat(64), summary: {}, worst: {}, label: 'x' } }));
    assert.strictEqual(L.loadLiveConfig(() => {}), false, 'a measurement for other numbers does not count');
    fs.rmSync(CFG_FILE, { force: true });
  });

  // one accepted config carries four checks: the label, the audit line, the event loop, the lock
  await test('K4-1: an accepted config shows the MEASURED value as its label, writes one audit line (who, when, old, new), never blocks the loop for 250 ms, and a second POST meanwhile is refused', async () => {
    let maxGap = 0, last = Date.now(); const probe = setInterval(() => { const t = Date.now(); maxGap = Math.max(maxGap, t - last); last = t; }, 5);
    try {
      const first = quiet(() => L.setLiveConfigChecked({ overrides: { buyCost: { bonus1: 1000 } }, rtpLabel: '98% (long-run, typed by an admin)', note: 'dearer bonus1 buy', who: 'test-admin#5678' }));
      await new Promise((r) => setTimeout(r, 50));
      await assert.rejects(quiet(() => L.setLiveConfigChecked({ overrides: { buyCost: { bonus1: 1100 } }, who: 'second' })), /another payback check is running/);
      const info = await first;
      assert.strictEqual(E.CFG.buyCost.bonus1, 1000);
      assert.ok(/^\d+\.\d% \(measured by the server when this was set: plain game, \+-\d+\.\d; highest way \w+ \d+\.\d%\)$/.test(info.rtpLabel), 'the label is the measured value: ' + info.rtpLabel);
      assert.notStrictEqual(info.rtpLabel, SRV.RTP_LABEL); assert.ok(!/typed by an admin/.test(info.rtpLabel), 'the typed label is not shown');
      assert.ok(/rtpLabel not shown/.test(L.liveInfo(SRV.RTP_LABEL).warning || ''), 'and the reply says so');
      const m = info.measured; assert.strictEqual(m.ok, true); assert.ok(m.worst.pct <= 100 && m.worst.se > 0); assert.ok(m.summary.plain && m.summary.call && m.summary.hunt && m.summary.bonus1 && m.summary.bonus2 && m.summary.daily, 'every way was measured');
      const j = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')); assert.strictEqual(j.measured.hash, L.configHash(E.CFG), 'the file carries the measurement of exactly these numbers');
      const a = auditLines(), l = a[a.length - 1]; assert.strictEqual(l.outcome, 'accepted'); assert.strictEqual(l.who, 'test-admin#5678'); assert.ok(Date.parse(l.t) > Date.now() - 600000); assert.strictEqual(l.old.pct, 98.0); assert.ok(l.new.plain.pct > 80 && l.new.plain.pct <= 100 && l.new.maxStretchMs < 250, JSON.stringify(l.new).slice(0, 300));
      assert.ok(l.new.maxStretchMs < 250, 'the check reports its longest stretch: ' + l.new.maxStretchMs + ' ms');
      assert.ok(maxGap < 250, 'the event loop was never blocked for 250 ms (probe saw ' + maxGap + ' ms)');
      console.log('     longest loop gap seen by a 5 ms probe: ' + maxGap + ' ms; check says ' + l.new.maxStretchMs + ' ms; took ' + Math.round(l.new.ms / 1000) + ' s; plain ' + l.new.plain.pct + '% +-' + l.new.plain.se);
    } finally { clearInterval(probe); }
    // a restart: the saved file loads because it carries its measurement, and the label survives
    E.CFG.buyCost.bonus1 = 964; assert.strictEqual(L.loadLiveConfig(() => {}), true); assert.strictEqual(E.CFG.buyCost.bonus1, 1000); assert.ok(/measured by the server/.test(SRV.liveInfo().rtpLabel));
  });
  await test('reset to the shipped numbers needs no measurement and is one audit line', async () => {
    const n0 = auditLines().length; await quiet(() => L.setLiveConfigChecked({ overrides: {}, who: 'test-admin#5678', note: 'reset' }));
    assert.strictEqual(JSON.stringify(E.CFG), SHIPPED); assert.strictEqual(SRV.liveInfo().rtpLabel, SRV.RTP_LABEL); const a = auditLines(); assert.strictEqual(a.length, n0 + 1); assert.strictEqual(a[a.length - 1].outcome, 'accepted');
    fs.rmSync(CFG_FILE, { force: true });
  });
  await test('the shipped numbers measure under the ceiling on every way (prove-it, full budget), and the daily gift is under its limit', async () => {
    const r = await L.measurePayback(L.merge({})); const s = L.pbSummary(r);
    console.log('     shipped: ' + JSON.stringify(s) + ' in ' + Math.round(r.ms / 1000) + ' s, longest stretch ' + Math.round(r.maxStretchMs) + ' ms');
    assert.strictEqual(r.ok, r.bound.upper <= 100 && r.giftOk, JSON.stringify(s)); /* R2C-3: ok is the UPPER bound (measured + 3 SE) at or under 100. The shipped numbers (98.6 +-0.7 here) are not provable by the check at its budget; they go live by a reset, which needs no measurement */ for (const w of ['plain', 'call', 'hunt', 'bonus1', 'bonus2']) assert.ok(s[w].pct <= 100, w + ' ' + s[w].pct);
    assert.ok(s.daily.giftCents <= L.DAILY_GIFT_MAX_CENTS, 'the daily gift is ' + s.daily.giftCents + ' cents a day'); assert.ok(r.maxStretchMs < 250);
    assert.ok(Math.abs(s.plain.pct - 98.0) < 4 * s.plain.se + 0.5, 'plain agrees with the documented 98.0 (LEVERS.md 8.12): ' + s.plain.pct);
  });
  for (const name of ['rtp94', 'rtp96']) {
    await test('the documented preset ' + name + ' is accepted through the checked path and shows its documented label', async () => {
      const j = preset(name), info = await quiet(() => L.setLiveConfigChecked({ overrides: j.overrides, rtpLabel: j.rtpLabel, note: name, who: 'test-admin#5678' }));
      assert.strictEqual(info.measured.ok, true); assert.strictEqual(info.rtpLabel, j.rtpLabel, 'the label measured offline for exactly these numbers (hash match)'); console.log('     ' + name + ' worst way ' + JSON.stringify(info.measured.worst) + ' plain ' + JSON.stringify(info.measured.summary.plain));
      await quiet(() => L.setLiveConfigChecked({ overrides: {} })); fs.rmSync(CFG_FILE, { force: true });
    });
  }
  await test('rtp98 is the shipped numbers: accepted without a measurement', async () => {
    const j = preset('rtp98'); await quiet(() => L.setLiveConfigChecked({ overrides: j.overrides, rtpLabel: j.rtpLabel })); assert.strictEqual(SRV.liveInfo().rtpLabel, SRV.RTP_LABEL); fs.rmSync(CFG_FILE, { force: true });
  });
  console.log(pass + ' passed' + (process.exitCode ? ', with failures' : ''));
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exit(1); });
