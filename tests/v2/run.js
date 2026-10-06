#!/usr/bin/env node
'use strict';
// Acceptance suite runner.
//   node tests/v2/run.js [--target dir] [--label name] [--only 01,07,30] [--jobs 3] [--long] [--baseline] [--write-expect]
// Runs every tests/v2/NN_*.js against the target server dir (default: repo root), up to --jobs files in parallel (each file gets its own port block
// inside 3500-3559), prints one line per check  PASS|FAIL  NN  check-name  [bug ids]  detail  and writes tests/v2/results/<label>.json. Exit 1 on any fail.
// --baseline: target = ../baseline-9440541 (built by baseline/setup.sh if missing); exits 0 only when every check matches tests/v2/EXPECT.json.
// --write-expect: (with --baseline) rewrite EXPECT.json from this run, keeping the reasons already written there.
const fs = require('fs'), path = require('path');
const { spawn, execFileSync } = require('child_process');
const HERE = __dirname, REPO = path.resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const flag = f => argv.includes(f);
const val = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const BASE = flag('--baseline');
const baselineDir = path.resolve(REPO, '..', 'baseline-9440541');
if (BASE && !fs.existsSync(path.join(baselineDir, 'server.js'))) execFileSync('bash', [path.join(HERE, 'baseline', 'setup.sh')], { stdio: 'inherit' });
const TARGET = path.resolve(BASE ? baselineDir : (val('--target') || process.env.TARGET_DIR || REPO));
const LABEL = val('--label') || (BASE ? 'baseline' : path.basename(TARGET));
const JOBS = Number(val('--jobs')) || 3;
const ONLY = val('--only') ? val('--only').split(',').map(s => s.trim()) : null;
fs.mkdirSync(path.join(HERE, 'results'), { recursive: true });
fs.mkdirSync(path.join(HERE, 'runs'), { recursive: true });

const files = fs.readdirSync(HERE).filter(f => /^\d\d_.*\.js$/.test(f)).sort();
const slot = Object.fromEntries(files.map((f, i) => [f, i]));              // stable port block per file: 3500 + 2*slot (+0, +1)
if (files.length * 2 > 60) throw new Error('more than 30 test files: port blocks would leave 3500-3559');
const todo = files.filter(f => !ONLY || ONLY.includes(f.slice(0, 2)));
// longest first so the parallel run ends early; durations from the last results file if there is one
let prev = {};
try { for (const r of JSON.parse(fs.readFileSync(path.join(HERE, 'results', LABEL + '.json'), 'utf8')).checks) prev[r.test] = (prev[r.test] || 0) + (r.ms || 0); } catch {}
const guess = { '14': 72000, '10': 92000, '20': 45000, '11': 28000, '30': 20000, '07': 22000, '17': 20000, '21': 60000 };
todo.sort((a, b) => ((prev[b.slice(0, 2)] || guess[b.slice(0, 2)] || 5000) - (prev[a.slice(0, 2)] || guess[a.slice(0, 2)] || 5000)));

const rows = [];
function runFile(f) {
  const NN = f.slice(0, 2), rf = path.join(HERE, 'results', `.tmp-${LABEL}-${NN}.json`);
  try { fs.unlinkSync(rf); } catch {}
  return new Promise(resolve => {
    const t0 = Date.now();
    const args = [path.join(HERE, f), '--target', TARGET]; if (flag('--long')) args.push('--long');
    const child = spawn('node', args, { env: { ...process.env, V2_PORT_BASE: String(3500 + 2 * slot[f]), V2_RESULT_FILE: rf, TARGET_DIR: TARGET }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
    const limit = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, (flag('--long') ? 20 : 8) * 60000);
    child.on('exit', code => {
      clearTimeout(limit);
      let r = [];
      try { r = JSON.parse(fs.readFileSync(rf, 'utf8')); fs.unlinkSync(rf); } catch {}
      if (!r.length) r = [{ test: NN, check: `${f} produced no result`, bugs: [], status: 'FAIL', error: true, detail: 'ERR exit ' + code + ': ' + out.replace(/\s+/g, ' ').slice(-300), ms: Date.now() - t0 }];
      else if (code === 2) r.push({ test: NN, check: `${f} crashed after its checks`, bugs: [], status: 'FAIL', error: true, detail: 'ERR ' + out.replace(/\s+/g, ' ').slice(-300), ms: 0 });
      for (const x of r) rows.push(x);
      for (const x of r) console.log(`${x.status}  ${x.test}  ${x.check}  [${x.bugs.join(',')}]  ${x.detail}`);
      resolve();
    });
  });
}
(async () => {
  const t0 = Date.now();
  console.log(`# target ${TARGET}  label ${LABEL}  files ${todo.length}  jobs ${JOBS}`);
  const queue = todo.slice();
  await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => { while (queue.length) await runFile(queue.shift()); }));
  rows.sort((a, b) => a.test.localeCompare(b.test) || 0);
  let commit = ''; try { commit = execFileSync('git', ['-C', TARGET, 'rev-parse', '--short', 'HEAD']).toString().trim(); } catch {}
  const fail = rows.filter(r => r.status === 'FAIL').length, pass = rows.length - fail;
  const out = { label: LABEL, target: TARGET, commit, date: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), total: rows.length, pass, fail, checks: rows };
  fs.writeFileSync(path.join(HERE, 'results', LABEL + '.json'), JSON.stringify(out, null, 1));
  console.log(`# ${rows.length} checks: ${pass} pass, ${fail} fail  (${out.seconds}s)  -> tests/v2/results/${LABEL}.json`);
  const key = r => `${r.test}/${r.check}`;
  if (BASE) {
    const EXP = path.join(HERE, 'EXPECT.json');
    let exp = {}; try { exp = JSON.parse(fs.readFileSync(EXP, 'utf8')); } catch {}
    if (flag('--write-expect')) {
      const next = {};
      for (const r of rows) { const old = exp[key(r)] || {}; next[key(r)] = { baseline: r.status === 'FAIL' ? 'fail' : 'pass', bugs: r.bugs, ...(old.reason ? { reason: old.reason } : {}) }; }
      fs.writeFileSync(EXP, JSON.stringify(next, null, 1)); console.log('# wrote EXPECT.json with', Object.keys(next).length, 'checks'); process.exit(0);
    }
    const bad = [];
    for (const r of rows) { const e = exp[key(r)]; const got = r.status === 'FAIL' ? 'fail' : 'pass'; if (!e) bad.push(`NEW      ${key(r)} (${got}) is not in EXPECT.json`); else if (e.baseline !== got) bad.push(`MISMATCH ${key(r)}: expected ${e.baseline}, got ${got}  ${r.detail}`); }
    if (!ONLY) for (const k of Object.keys(exp)) if (!rows.some(r => key(r) === k)) bad.push(`MISSING  ${k} is in EXPECT.json but did not run`);
    for (const b of bad) console.log(b);
    console.log(bad.length ? `# baseline does NOT match EXPECT.json (${bad.length} differences)` : '# baseline matches EXPECT.json');
    process.exit(bad.length ? 1 : 0);
  }
  process.exit(fail ? 1 : 0);
})();
