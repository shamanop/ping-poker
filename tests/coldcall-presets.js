'use strict';
// node tests/coldcall-presets.js  (standalone: temp dir, no network)
// COLD CALL RTP presets (cold-call/presets/*.json, LEVERS.md 8.13): every file is the POST body of /api/admin/coldcall-config ({ overrides, rtpLabel, note }), is accepted by the live-config
// validator + smoke test, moves only the knobs the measurement allows (never the symbol weights, the base-game extras or the pay table: those move the hit rate and the natural bonus), and
// swaps in and out through setLiveConfig. rtp98 is the shipped math and its label is the shipped label.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coldcall-presets-'));
process.env.WALLET_FILE = path.join(tmp, 'wallet.json');
process.env.COLDCALL_CFG_FILE = path.join(tmp, 'coldcall-config.json');
for (const k of ['COLDCALL_PULL_FILE', 'DATA_DIR', 'RAILWAY_VOLUME_MOUNT_PATH', 'BENDER_ADMIN_TOKEN']) delete process.env[k];
const E = require('../games/coldcall-engine.js');
const L = require('../games/coldcall-livecfg.js');
const SRV = require('../games/coldcall.js');

const DIR = path.join(__dirname, '..', 'cold-call', 'presets');
const SHIPPED = JSON.stringify(E.CFG);
const MOVES_HIT_RATE = ['weights', 'extra', 'pay', 'reveal', 'bubbles', 'upsell', 'adjacency'];   // overriding any of these would change the hit rate or the natural bonus frequency
let pass = 0;
const test = (name, fn) => { try { fn(); pass++; console.log('ok   ' + name); } catch (e) { process.exitCode = 1; console.log('FAIL ' + name + '\n     ' + (e && e.message)); } };

const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort() : [];
test('the presets folder has rtp98 (shipped) and at least one other preset', () => {
  assert.ok(files.includes('rtp98.json'), 'cold-call/presets/rtp98.json is missing');
  assert.ok(files.length >= 1);
});

for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  test(f + ': POST body shape, non-empty label', () => {
    assert.deepStrictEqual(Object.keys(j).sort(), ['measuredHash', 'note', 'overrides', 'rtpLabel']);
    assert.ok(j.overrides && typeof j.overrides === 'object' && !Array.isArray(j.overrides));
    assert.ok(typeof j.rtpLabel === 'string' && j.rtpLabel.trim().length > 0 && j.rtpLabel.length <= 160, 'rtpLabel must be 1 to 160 characters (setLiveConfig cuts at 160)');
    assert.ok(typeof j.note === 'string' && j.note.length <= 300);
  });
  test(f + ': validate() accepts it (merge, relations, smoke test)', () => {
    const { next, smoke } = L.validate(j.overrides);
    assert.ok(smoke.rounds > 0 && smoke.pull > 0);
    assert.ok(next.pull.list > 0 && next.buyCost.bonus1 > 0);
  });
  test(f + ': FIX D3: measuredHash = sha256 of the full merged config (the CURRENT shipped defaults + its overrides); a mismatch means a shipped default moved under a measured label: re-measure, then node tools/coldcall-preset-hash.js --write', () => {
    assert.ok(/^[0-9a-f]{64}$/.test(j.measuredHash), 'measuredHash is a sha256 hex string');
    assert.strictEqual(L.configHash(L.merge(j.overrides)), j.measuredHash, f + ': the numbers this label was measured on are not the numbers the code now ships with');
  });
  test(f + ': FIX D3: the label is shown for its own numbers only (the live config hashes to measuredHash), not for one number moved', () => {
    assert.strictEqual(SRV.setLiveConfig(j).warning, null);
    const moved = JSON.parse(JSON.stringify(j.overrides)); moved.pull = { ...(moved.pull || {}), cold: { floor: E.CFG.pull.cold.floor + 1 } };
    const info = SRV.setLiveConfig({ overrides: moved, rtpLabel: j.rtpLabel }); assert.strictEqual(info.rtpLabel, 'custom settings, not measured'); assert.ok(/rtpLabel not shown/.test(info.warning));
    SRV.setLiveConfig({ overrides: {} });
  });
  test(f + ': moves no knob that changes the hit rate or the natural bonus', () => {
    for (const k of Object.keys(j.overrides)) assert.ok(!MOVES_HIT_RATE.includes(k), k + ' must not be in a preset');
    assert.strictEqual(j.overrides.pull && j.overrides.pull.fill, undefined, 'pull.fill: use pull.list (fill keeps whole-tenth leads)');
  });
  test(f + ': swaps in through setLiveConfig, shows its label, and a reset restores the shipped math', () => {
    const info = SRV.setLiveConfig(j);
    assert.strictEqual(info.rtpLabel, j.rtpLabel.trim());
    for (const [k, v] of Object.entries(j.overrides.buyCost || {})) assert.strictEqual(E.CFG.buyCost[k], v);
    SRV.setLiveConfig({ overrides: {} });
    assert.strictEqual(JSON.stringify(E.CFG), SHIPPED); assert.strictEqual(SRV.liveInfo().rtpLabel, SRV.RTP_LABEL);
  });
}

test('rtp98 is the shipped math: empty overrides, label = RTP_LABEL', () => {
  const j = JSON.parse(fs.readFileSync(path.join(DIR, 'rtp98.json'), 'utf8'));
  assert.deepStrictEqual(j.overrides, {}); assert.strictEqual(j.rtpLabel, SRV.RTP_LABEL);
});

console.log(pass + ' passed' + (process.exitCode ? ', with failures' : ''));
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(process.exitCode || 0);
