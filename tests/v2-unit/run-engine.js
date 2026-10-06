'use strict';
// One command: node tests/v2-unit/run-engine.js [--seed N] [--hands N]
// Env: ENGINE_SEED (default 1), ENGINE_HANDS (random hands per property/differential test, default 20000).
// Exit 0 when every case passes, 1 otherwise.
const path = require('path');
const L = require('./engine-lib');

const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 ? Number(argv[i + 1]) : dflt; };
const seed = arg('seed', Number(process.env.ENGINE_SEED || 1));
const hands = arg('hands', Number(process.env.ENGINE_HANDS || 20000));
const env = { seed, hands };

const FILES = ['engine-rules.js', 'engine-eval.js', 'engine-property.js', 'engine-showdown-diff.js'];
let pass = 0, fail = 0;
const failures = [];
const t0 = Date.now();
console.log(`engine tests: seed=${seed} hands=${hands}`);
for (const f of FILES) {
  const suite = L.makeSuite(f);
  require(path.join(__dirname, f))(suite, env);
  const t1 = Date.now();
  const r = L.runSuite(suite);
  pass += r.pass; fail += r.fail; failures.push(...r.failures);
  console.log(`  ${r.fail ? 'FAIL' : 'ok  '} ${f}: ${r.pass} passed, ${r.fail} failed (${Date.now() - t1} ms)`);
}
for (const m of failures) console.log('\n' + m);
console.log(`\nTOTAL: ${pass} passed, ${fail} failed, ${((Date.now() - t0) / 1000).toFixed(1)} s, seed ${seed}`);
process.exit(fail ? 1 : 0);
