#!/usr/bin/env node
'use strict';
// The proof that the soak can fail: one clean soak (must exit 0), then every seeded bug of bugs/inject.js on a fresh data dir (each must exit 1 AND name one of the invariants the bug is expected to break).
// One line per run: name, exit code, the invariants that fired (first one first), step of the first violation, seconds. Exit 0 only if the clean run passed and every bug was caught by an expected invariant.
// A bug that is not caught within the time is a FAILED proof: it is printed as such. Never two soaks at once (one server, one port).
// Usage: node tests/soak/prove.js [--minutes 1.5] [--kills 3] [--seed 7] [--port 4742] [--only name[,name]] [--no-clean] [--data <dir>]
const fs = require('fs'), path = require('path');
const { spawnSync } = require('child_process');
const { EXPECT, ARGS } = require('./bugs/inject');

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const minutes = Number(arg('minutes', 1.5)), kills = Number(arg('kills', 3)), seed = Number(arg('seed', 7)), port = Number(arg('port', 4742));
const only = arg('only') ? arg('only').split(',') : null;
const root = path.join(path.resolve(__dirname, '..', '..', '..'), '_scratch', 'p6', 'soak');
const base = path.resolve(arg('data', path.join(root, `prove-${Date.now()}`)));
fs.mkdirSync(base, { recursive: true });

function run(name, bug) {
  const dir = path.join(base, name);
  const args = [path.join(__dirname, 'soak.js'), '--seed', String(seed), '--minutes', String(minutes), '--kills', String(kills), '--port', String(port), '--data', dir];
  if (bug) args.push('--bug', bug, ...((ARGS || {})[bug] || []));
  const t0 = Date.now();
  const r = spawnSync('node', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: Math.round((minutes + 3) * 60000) });
  const secs = Math.round((Date.now() - t0) / 100) / 10;
  let res = null;
  try { res = JSON.parse(fs.readFileSync(path.join(dir, 'result.json'), 'utf8')); } catch {}
  const ids = [], seen = new Set();
  for (const v of (res && res.violations) || []) if (!seen.has(v.id)) { seen.add(v.id); ids.push(v.id); }
  const first = res && res.violations && res.violations[0];
  const fired = (fs.existsSync(path.join(dir, 'server.log')) ? fs.readFileSync(path.join(dir, 'server.log'), 'utf8').split('\n').filter(l => l.startsWith('[soak-bug]')).length : 0);
  return { name, bug, code: r.status === null ? 'timeout' : r.status, ids, step: first ? first.step : null, secs, fired, steps: res ? res.steps : null, msg: first ? first.message : (res && res.harnessError ? res.harnessError.split('\n')[0] : r.stdout.split('\n').slice(-3).join(' ').slice(0, 160)), dir };
}

const rows = [];
if (!argv.includes('--no-clean') && (!only || only.includes('clean'))) rows.push(run('clean', null));
for (const bug of Object.keys(EXPECT)) if (!only || only.includes(bug)) rows.push(run(bug, bug));

let ok = true;
const lines = [];
for (const r of rows) {
  let verdict;
  if (!r.bug) { verdict = r.code === 0 ? 'PASS (clean)' : 'FAIL: the clean soak did not exit 0'; if (r.code !== 0) ok = false; }
  else if (r.code === 1 && r.ids.some(i => EXPECT[r.bug].includes(i))) verdict = 'CAUGHT';
  else if (r.code === 1) { verdict = `FAILED PROOF: caught only by ${r.ids.join(',')}, expected ${EXPECT[r.bug].join('/')}`; ok = false; }
  else if (r.code === 0) { verdict = `FAILED PROOF: NOT CAUGHT in ${r.steps} steps (${r.fired} firings of the bug)`; ok = false; }
  else { verdict = `FAILED PROOF: the harness broke (exit ${r.code})`; ok = false; }
  lines.push([r.name, String(r.code), r.ids.join(',') || '-', r.step == null ? '-' : String(r.step), String(r.secs), String(r.fired), verdict]);
}
const head = ['run', 'exit', 'invariants', 'step', 'sec', 'firings', 'verdict'];
const w = head.map((h, i) => Math.max(h.length, ...lines.map(l => l[i].length)));
const fmt = l => l.map((c, i) => c.padEnd(w[i])).join('  ');
console.log(fmt(head)); console.log(w.map(n => '-'.repeat(n)).join('  '));
for (const l of lines) console.log(fmt(l));
for (const r of rows) if (r.bug && r.msg) console.log(`  ${r.name}: ${String(r.msg).slice(0, 200)}`);
console.log(`\ndata: ${base}\n${ok ? (rows.some(r => !r.bug) ? 'PROOF OK: the clean soak passed and every seeded bug was caught' : 'ALL SELECTED BUGS CAUGHT (no clean run in this invocation)') : 'PROOF FAILED (see the lines above)'}`);
process.exit(ok ? 0 : 1);
