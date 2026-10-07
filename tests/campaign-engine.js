'use strict';
// CAMPAIGN TRAIL engine tests. Plain node script: exit 0 on pass, 1 on fail. Run: node tests/campaign-engine.js
const E = require('../games/campaign-engine.js');
const M = E.MAP;
let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL', name, '-', e.message); } }
const eq = (a, b, m) => { if (a !== b) throw new Error((m || '') + ' got ' + a + ' want ' + b); };
const throwsCode = (fn, code) => { try { fn(); } catch (e) { if (e.code === code) return; throw new Error('wrong error ' + e.code); } throw new Error('did not throw ' + code); };

const WITNESS = 'ME NH VT MA RI CT NY NJ DE MD PA WV OH MI IN IL WI MN ND MT SD IA NE KS CO WY UT ID WA AK HI CA OR NV AZ NM OK TX LA AR MO KY VA NC SC GA FL AL MS TN'.split(' ');

t('map basics', () => {
  eq(M.codes.length, 50);
  for (const c of M.codes) for (const a of M.states[c].adj) { if (!M.states[a].adj.includes(c)) throw new Error('asym ' + c + a); if (a === c) throw new Error('self'); }
});
t('engine opens a run and lists options', () => {
  const r = E.newRun('OH');
  eq(r.mx, 100); eq(E.options(r).length, 5);
  for (const o of E.options(r)) if (!(o.pFail > 0 && o.pFail < 1 && o.nextMx > 100)) throw new Error('option ' + o.to);
});
t('step survive / scandal', () => {
  const r = E.newRun('OH');
  const a = E.step(r, 'IN', () => 0.999999); eq(a.ok, true); eq(a.run.at, 'IN'); eq(a.run.steps, 1);
  const b = E.step(r, 'IN', () => 0); eq(b.ok, false); eq(b.run.done, 'scandal'); eq(b.run.failedAt, 'IN');
});
t('landslide witness', () => {
  let r = E.newRun(WITNESS[0]);
  for (const to of WITNESS.slice(1)) r = E.step(r, to, () => 0.999999).run;
  eq(r.done, 'landslide'); eq(r.mx, 100000); eq(E.payout(r, 2500), 2500000); E.check(r);
});

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
