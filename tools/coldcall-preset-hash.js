'use strict';
// node tools/coldcall-preset-hash.js [--write]
// FIX D3: the `measuredHash` of every cold-call/presets/*.json = sha256 of the FULL merged config (the shipped defaults of THIS tree + the file's overrides, every key sorted).
// A preset's label is only honest for those exact numbers. Run without flags to check (exit 1 on a mismatch); run with --write ONLY after the preset has been re-measured on the current defaults.
const fs = require('fs');
const path = require('path');
const L = require('../games/coldcall-livecfg.js');
const DIR = path.join(__dirname, '..', 'cold-call', 'presets');
const write = process.argv.includes('--write');
let bad = 0;
for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.json')).sort()) {
  const file = path.join(DIR, f), j = JSON.parse(fs.readFileSync(file, 'utf8')), h = L.configHash(L.merge(j.overrides));
  const ok = j.measuredHash === h;
  console.log((ok ? 'ok      ' : write ? 'written ' : 'MISMATCH ') + f + '  ' + h);
  if (!ok && write) {
    const out = {}; for (const k of Object.keys(j)) { if (k === 'measuredHash') continue; if (k === 'note') out.measuredHash = h; out[k] = j[k]; } if (!out.measuredHash) out.measuredHash = h;
    fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
  } else if (!ok) bad++;
}
process.exit(bad ? 1 : 0);
