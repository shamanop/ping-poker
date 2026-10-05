const { createLedger } = require('../../../ledger');
const fs = require('fs'); const f = __dirname + '/bench-ledger.json'; fs.writeFileSync(f, '[]');
const l = createLedger({ file: f });
for (const N of [1000, 10000, 50000]) {
  while (l.entries().length < N) l.entries().push({ t: 1, name: 'Ann', type: 'win', amount: 10, balanceAfter: 8500, tableChips: 1500, handNum: 1, room: 'POKERPING' });
  let t = process.hrtime.bigint(); l.log('win', 'Ann', 10, 8500, 1500, 1, 'POKERPING'); const w = Number(process.hrtime.bigint() - t) / 1e6;
  t = process.hrtime.bigint(); l.summary('POKERPING', { ann: 1 }, []); const s = Number(process.hrtime.bigint() - t) / 1e6;
  console.log(N, 'entries: push+save', w.toFixed(1), 'ms; summary', s.toFixed(1), 'ms; file KB', Math.round(fs.statSync(f).size / 1024));
}
