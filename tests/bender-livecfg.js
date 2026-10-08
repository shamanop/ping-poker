'use strict';
// Live slot math: validate, swap without restart, persist, reload, reject bad configs untouched. K2-Bcfg: a config goes live only after the server has measured its payback (games/bender-rtp.js);
// the gate itself is tests/money-1008-cfg-bender.js. Needs games/bender-ref.json (the shipped numbers) for the paired mode, which keeps this file's measurements short.
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.homedir(), '.bender-livecfg-'));
process.env.BENDER_CFG_FILE = path.join(dir, 'bender-config.json');
const E = require('../games/bender-engine.js');
const B = require('../games/bender.js');
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };
const quiet = async (fn) => { const o = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = o; } };
(async () => {
  try {
    B.init({});
    const def = JSON.stringify(E.DEFAULT_CFG);
    await t('boots on defaults with no file', () => assert.strictEqual(JSON.stringify(E.CFG), def));
    await t('rejects unknown key, bad number, wrong length; nothing changes', async () => {
      for (const bad of [{ nope: 1 }, { scatterW: -1 }, { scatterW: 'x' }, { pay: { pen: [1, 2] } }, { buyCost: { election: 0 } }])
        await assert.rejects(quiet(() => B.setLiveConfigChecked({ overrides: bad })));
      assert.strictEqual(JSON.stringify(E.CFG), def);
      assert.ok(!fs.existsSync(process.env.BENDER_CFG_FILE));
    });
    await t('swap applies to the next round and buy costs (a dearer election buy: its payback goes down, so it is accepted)', async () => {
      const info = await quiet(() => B.setLiveConfigChecked({ overrides: { buyCost: { election: 14 } }, note: 'test', who: 'test' }));
      assert.strictEqual(E.CFG.buyCost.election, 14);
      assert.strictEqual(E.CFG.buyCost.landslide, E.DEFAULT_CFG.buyCost.landslide);
      assert.ok(/measured by the server/.test(info.rtpLabel), info.rtpLabel);
      const r = E.resolveRound(E.rngFrom(1), 'election'); assert.strictEqual(r.costMult, 14);
    });
    await t('persisted (with its measurement) and reloaded', () => {
      const j = JSON.parse(fs.readFileSync(process.env.BENDER_CFG_FILE, 'utf8'));
      assert.strictEqual(j.overrides.buyCost.election, 14); assert.strictEqual(j.measured.ok, true); assert.ok(j.measured.label);
      E.resetConfig(); assert.strictEqual(E.CFG.buyCost.election, E.DEFAULT_CFG.buyCost.election);
      B.loadLiveConfig(); assert.strictEqual(E.CFG.buyCost.election, 14);
    });
    await t('clientCfg carries the live buy price; reset restores defaults', async () => {
      assert.strictEqual(B.clientCfg().buyCost.election, 14);
      await quiet(() => B.setLiveConfigChecked({ overrides: {} })); assert.strictEqual(JSON.stringify(E.CFG), def);
    });
    console.log(`bender-livecfg: ${n} passed`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exit(1); });
