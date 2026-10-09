'use strict';
// The game kit has to run by default (R2E-9): scripts.test must run tests/game-kit.js with --all, and every games/*.kit.js adapter must be one `--all` runs:
// its id is in games/index.js MODULES, or it is an example adapter (games/_example-*.kit.js) and the same command also passes --examples.
// KIT_GATED_PKG=<package.json> checks another package.json (a copy without the kit must fail). Plain node, exit 0 on pass, 1 on fail.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const pkgFile = process.env.KIT_GATED_PKG || path.join(ROOT, 'package.json');
const test = String(JSON.parse(fs.readFileSync(pkgFile, 'utf8')).scripts.test || '');
const cmds = test.split('&&').map((c) => c.trim());
const kitCmd = cmds.find((c) => /(^|\s)node\s+tests\/game-kit\.js(\s|$)/.test(c) && /(^|\s)--all(\s|$)/.test(c));
const bad = [];
if (!kitCmd) bad.push('scripts.test does not run `node tests/game-kit.js --all` (' + cmds.length + ' commands in it)');
if (!/(^|\s)node\s+tests\/game-kit-selftest\.js(\s|$)/.test(test)) bad.push('scripts.test does not run tests/game-kit-selftest.js (a kit that nobody tests can pass anything)');
const MODULES = require(path.join(ROOT, 'games/index.js')).MODULES.map((m) => path.basename(m, '.js'));
const adapters = fs.readdirSync(path.join(ROOT, 'games')).filter((f) => f.endsWith('.kit.js'));
for (const f of adapters) {
  const id = require(path.join(ROOT, 'games', f)).id, example = /^_example-.*\.kit\.js$/.test(f);
  const covered = MODULES.includes(id) || (example && kitCmd && /(^|\s)--examples(\s|$)/.test(kitCmd));
  if (!covered) bad.push(`adapter ${f} (id ${id}) is neither in games/index.js MODULES nor an example run by --examples in the kit command: --all leaves it out`);
}
for (const b of bad) console.log('FAIL ' + b);
console.log(bad.length ? `money-1008-kit-gated: ${bad.length} problem(s)` : `money-1008-kit-gated: ok (${adapters.length} adapters: ${MODULES.join(', ')} + examples; kit command: ${kitCmd})`);
process.exit(bad.length ? 1 : 0);
