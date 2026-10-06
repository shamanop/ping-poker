'use strict';
// Live slot math: validate, swap without restart, persist to file, reload, reject bad configs untouched.
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const dir = fs.mkdtempSync(path.join(os.homedir(), '.bender-livecfg-'));
process.env.BENDER_CFG_FILE = path.join(dir, 'bender-config.json');
const E = require('../games/bender-engine.js');
const B = require('../games/bender.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
try {
  B.init({});
  const def = JSON.stringify(E.DEFAULT_CFG);
  t('boots on defaults with no file', () => assert.strictEqual(JSON.stringify(E.CFG), def));
  t('rejects unknown key, bad number, wrong length; nothing changes', () => {
    for (const bad of [{ nope: 1 }, { scatterW: -1 }, { scatterW: 'x' }, { pay: { pen: [1, 2] } }, { buyCost: { election: 0 } }])
      assert.throws(() => B.setLiveConfig({ overrides: bad }));
    assert.strictEqual(JSON.stringify(E.CFG), def);
    assert.ok(!fs.existsSync(process.env.BENDER_CFG_FILE));
  });
  t('swap applies to the next round and buy costs', () => {
    B.setLiveConfig({ overrides: { buyCost: { election: 100 }, scatterW: 2.5 }, note: 'test' });
    assert.strictEqual(E.CFG.buyCost.election, 100); assert.strictEqual(E.CFG.scatterW, 2.5);
    assert.strictEqual(E.CFG.buyCost.landslide, E.DEFAULT_CFG.buyCost.landslide);
    const r = E.resolveRound(E.rngFrom(1), 'election'); assert.strictEqual(r.costMult, 100);
    let bon = 0; const rng = E.rngFrom(9); for (let i = 0; i < 4000; i++) if (E.resolveRound(rng, null).bonus) bon++;
    assert.ok(bon > 4000 / 100, 'higher scatter weight should raise bonus rate, got ' + bon);
  });
  t('persisted and reloaded', () => {
    const j = JSON.parse(fs.readFileSync(process.env.BENDER_CFG_FILE, 'utf8'));
    assert.strictEqual(j.overrides.buyCost.election, 100);
    E.resetConfig(); assert.strictEqual(E.CFG.buyCost.election, E.DEFAULT_CFG.buyCost.election);
    B.loadLiveConfig(); assert.strictEqual(E.CFG.buyCost.election, 100);
  });
  t('clientCfg carries the live buy price; reset restores defaults', () => {
    assert.strictEqual(B.clientCfg().buyCost.election, 100);
    B.setLiveConfig({ overrides: {} }); assert.strictEqual(JSON.stringify(E.CFG), def);
  });
  console.log(`bender-livecfg: ${n} passed`);
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
