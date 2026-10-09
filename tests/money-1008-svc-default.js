'use strict';
// Money 1008 SVC-1a: Cash is never minted by a default. createService with no signupPlay mints 0 Cash at signup; a value must be passed on purpose
// and must be a safe integer >= 0, or createService throws at once. The Chips signup grant is unchanged. In-process, real ledger + service. Plain node: exit 0 / 1.
const fs = require('fs'), os = require('os'), path = require('path');
const { open } = require('../money/ledger');
const { createService, START_CHIPS } = require('../money/service');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.message)); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'eq') + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); };
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'svcdef-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
let n = 0;
const mk = () => open(path.join(dir, 'm' + (++n) + '.jsonl'), { fsync: 'none', log: () => {} });
const signupCash = (ledger) => Array.from(ledger.entries(null, 0)).filter(e => e.from === 'mint:signup' && String(e.to).startsWith('play:'));

t('no signupPlay: one signup mints 0 Cash and writes no mint:signup Cash line', () => {
  const ledger = mk(), svc = createService(ledger);
  const r = svc.ensureAccount('ann');
  eq(ledger.balance('play:ann', 'play'), 0); eq(ledger.balance('mint:signup', 'play'), 0);
  eq(r.minted.play, 0); eq(signupCash(ledger).length, 0, 'no Cash signup line');
});
t('no signupPlay and an options object without it: also 0 Cash', () => {
  const ledger = mk(), svc = createService(ledger, { now: Date.now });
  svc.ensureAccount('ann'); eq(ledger.balance('play:ann', 'play'), 0);
});
t('signupPlay 0 explicit and null/undefined: 0 Cash', () => {
  for (const v of [0, undefined, null]) { const ledger = mk(), svc = createService(ledger, { signupPlay: v }); svc.ensureAccount('ann'); eq(ledger.balance('play:ann', 'play'), 0, String(v)); }
});
t('signupPlay 5000 passed on purpose: 5000 Cash', () => {
  const ledger = mk(), svc = createService(ledger, { signupPlay: 5000 });
  const r = svc.ensureAccount('ann'); eq(ledger.balance('play:ann', 'play'), 5000); eq(r.minted.play, 5000);
});
t('signupPlay -5, 1.5, "100", NaN, Infinity, 2^53, true, [] all throw at once', () => {
  for (const v of [-5, 1.5, '100', NaN, Infinity, 2 ** 53, true, [], {}]) {
    let threw = false; const ledger = mk();
    try { createService(ledger, { signupPlay: v }); } catch (e) { threw = true; }
    if (!threw) throw new Error('did not throw for ' + String(v));
    eq(ledger.lastId, 0, 'nothing written for ' + String(v));
  }
});
t('signupPlay 2^53-1 (largest safe integer) is accepted', () => {
  const ledger = mk(); createService(ledger, { signupPlay: Number.MAX_SAFE_INTEGER });
});
t('Chips signup grant is unchanged by all of this', () => {
  for (const o of [undefined, { signupPlay: 0 }, { signupPlay: 5000 }]) {
    const ledger = mk(), svc = createService(ledger, o); const r = svc.ensureAccount('ann');
    eq(ledger.balance('bank:ann', 'chips'), START_CHIPS); eq(r.minted.chips, START_CHIPS);
  }
});
t('ensureAccount twice mints once (no second Cash or Chips line)', () => {
  const ledger = mk(), svc = createService(ledger, { signupPlay: 700 }); svc.ensureAccount('ann'); svc.ensureAccount('ann');
  eq(ledger.balance('play:ann', 'play'), 700); eq(ledger.balance('bank:ann', 'chips'), START_CHIPS);
});

console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
