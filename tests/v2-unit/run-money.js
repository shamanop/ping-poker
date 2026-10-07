'use strict';
// Runs every money test file in its own process. Usage: node tests/v2-unit/run-money.js
// Exit 0 when all pass. Per-file output is shown only when a file fails.
const { spawnSync } = require('child_process');
const path = require('path');

const FILES = ['money-ledger.js', 'money-service.js', 'money-rounds.js', 'migrate.js', 'money-d2-equiv.js', 'money-d2-ckpt.js', 'money-d2-misc.js', 'money-d2-callsites.js', 'money-d2-fix1.js'];
let failed = 0, passed = 0, total = 0;
for (const f of FILES) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const p = m ? Number(m[1]) : 0, x = m ? Number(m[2]) : 1;
  passed += p; total += p + x;
  const good = r.status === 0 && m && x === 0;
  if (!good) { failed++; process.stdout.write(out); }
  console.log(`${good ? 'ok  ' : 'FAIL'} ${f}: ${m ? m[0] : 'no summary (exit ' + r.status + ')'}`);
}
console.log(`money total: ${passed}/${total} passed in ${FILES.length} files${failed ? ', ' + failed + ' FILE(S) FAILED' : ''}`);
process.exit(failed ? 1 : 0);
