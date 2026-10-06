#!/usr/bin/env node
'use strict';
// Reporting helpers for the acceptance suite.
//   node tests/v2/report.js --write                 table + counts from results/baseline.json and EXPECT.json into PROGRESS.md (between the TABLE markers)
//   node tests/v2/report.js --diff <labelA> <labelB>  checks whose result differs between two results/<label>.json files
//   node tests/v2/report.js --bugs [label]          per reported bug ID: how many checks fail / pass
const fs = require('fs'), path = require('path');
const R = l => JSON.parse(fs.readFileSync(path.join(__dirname, 'results', l + '.json'), 'utf8'));
const argv = process.argv.slice(2);
const key = c => `${c.test}/${c.check}`;
const ALL_IDS = [...'C'.repeat(5).split('').map((_, i) => 'C' + (i + 1)), ...Array.from({ length: 8 }, (_, i) => 'H' + (i + 1)), ...Array.from({ length: 10 }, (_, i) => 'M' + (i + 1)), ...Array.from({ length: 8 }, (_, i) => 'L' + (i + 1)), 'N1', 'N3'];
function perBug(res) {
  const out = {};
  for (const id of ALL_IDS) out[id] = { fail: 0, pass: 0 };
  for (const c of res.checks) for (const b of c.bugs) if (out[b]) out[b][c.status === 'FAIL' ? 'fail' : 'pass']++;
  return out;
}
if (argv[0] === '--diff') {
  const a = R(argv[1]), b = R(argv[2]); const m = new Map(a.checks.map(c => [key(c), c.status]));
  const d = [];
  for (const c of b.checks) { const s = m.get(key(c)); if (s !== c.status) d.push(`${key(c)}: ${s || 'absent'} -> ${c.status}  ${c.detail}`); m.delete(key(c)); }
  for (const [k, s] of m) d.push(`${k}: ${s} -> absent`);
  console.log(d.length ? d.join('\n') : `no differences (${a.checks.length} vs ${b.checks.length} checks)`); process.exit(d.length ? 1 : 0);
}
if (argv[0] === '--bugs') {
  const res = R(argv[1] || 'baseline'), pb = perBug(res);
  for (const [id, v] of Object.entries(pb)) console.log(id.padEnd(4), v.fail + v.pass === 0 ? 'no check' : `${v.fail} fail / ${v.pass} pass`);
  process.exit(0);
}
if (argv[0] === '--write') {
  const res = R('baseline'), exp = JSON.parse(fs.readFileSync(path.join(__dirname, 'EXPECT.json'), 'utf8'));
  const pb = perBug(res);
  const rows = res.checks.map(c => `| ${c.test} | ${c.check} | ${c.bugs.join(', ') || '-'} | ${c.status === 'FAIL' ? 'FAIL' : 'pass'} | ${(c.status === 'PASS' && c.bugs.length && (exp[key(c)] || {}).reason) || ''} |`);
  const gone = Object.entries(pb).filter(([, v]) => v.pass > 0 && v.fail === 0).map(([id]) => id);
  const partial = Object.entries(pb).filter(([, v]) => v.pass > 0 && v.fail > 0).map(([id]) => id);
  const repro = Object.entries(pb).filter(([, v]) => v.fail > 0 && v.pass === 0).map(([id]) => id);
  const none = Object.entries(pb).filter(([, v]) => v.fail + v.pass === 0).map(([id]) => id);
  const md = [
    `Baseline run (${res.commit}, ${res.date.slice(0, 16)}Z, ${res.seconds}s): **${res.total} checks, ${res.fail} fail, ${res.pass} pass** on 9440541.`, '',
    `Reported bugs by what the checks see on 9440541:`,
    `- reproduce (every check for the ID fails): ${repro.join(', ')}`,
    `- no longer reproduce (every check for the ID passes): ${gone.join(', ') || 'none'}`,
    `- partly (some checks pass, some fail): ${partial.join(', ')}`,
    `- no check written: ${none.join(', ') || 'none'}`, '',
    '| file | check | bug IDs | on 9440541 | why it passes although a bug is listed |', '|---|---|---|---|---|', ...rows,
  ].join('\n');
  const p = path.join(__dirname, 'PROGRESS.md'); let s = fs.readFileSync(p, 'utf8');
  const A = '<!-- TABLE START -->', B = '<!-- TABLE END -->';
  if (!s.includes(A)) s += `\n## Baseline table\n\n${A}\n${B}\n`;
  s = s.slice(0, s.indexOf(A) + A.length) + '\n' + md + '\n' + s.slice(s.indexOf(B));
  fs.writeFileSync(p, s); console.log('PROGRESS.md table written:', res.total, 'checks'); process.exit(0);
}
console.log('usage: report.js --write | --diff A B | --bugs [label]'); process.exit(2);
