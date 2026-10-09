'use strict';
// Money 1008 K1-3: "Set Cash to X" means the player's TOTAL Cash becomes X (wallet + Play seats + open rounds).
// X below the part in play: refused, names the amount at the table, nothing moves. X at or above it: wallet = X - part. The answer shows wallet / at tables / in rounds / total.
// In-process: real admin/index.js over a real ledger + service. Plain node: exit 0 on pass, 1 on fail.
const fs = require('fs'), os = require('os'), path = require('path');
const { open } = require('../money/ledger');
const { createService } = require('../money/service');
const { createAdmin } = require('../admin');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.message)); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'eq') + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); };

const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'adm-setcash-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
let n = 0;
// vic: wallet 200000, 30000 at a Play seat, 20000 in an open Play round -> total 250000, part in play 50000
function env() {
  const ledger = open(path.join(dir, 'm' + (++n) + '.jsonl'), { fsync: 'none', log: () => {} });
  const service = createService(ledger, { signupPlay: 0 });
  service.ensureAccount('vic');
  const accounts = { get: k => (k === 'vic' ? { key: k } : null), all: () => ({}) };
  const adm = createAdmin({ service, ledger, accounts, registry: { tables: new Map() }, views: {}, onlineKeys: () => new Set() });
  adm.adjust('vic', 250000, 'play', 'fund', 'fund1');
  service.buyIn('vic', 'TBL', 30000, 'play', null, 'buy1');
  service.openRound('campaign', 'vic', 'play', 'r1', 20000);
  const total = () => { const b = service.balances('vic'); return b.play + b.atTable.play + b.inRound.play; };
  return { ledger, service, adm, total, wallet: () => ledger.balance('play:vic', 'play') };
}

t('set Cash below the part at the table is refused, names the amount, writes no ledger line', () => {
  const e = env(); const id = e.ledger.lastId;
  const r = e.adm.setPlay('vic', 0, 'op1');
  eq([r.ok, r.code], [false, 'cash_in_play']);
  if (!/500\.00/.test(r.message)) throw new Error('message does not name the 500.00 at the table: ' + r.message);
  eq([r.wallet, r.atTable, r.inRound, r.total], [200000, 30000, 20000, 250000]);
  eq(e.ledger.lastId, id, 'no ledger line'); eq(e.wallet(), 200000); eq(e.total(), 250000);
});
t('set Cash to exactly the part in play: wallet goes to 0, total = X', () => {
  const e = env(); const r = e.adm.setPlay('vic', 50000, 'op2');
  eq(r.ok, true); eq(e.wallet(), 0); eq(e.total(), 50000);
  eq([r.wallet, r.atTable, r.inRound, r.total], [0, 30000, 20000, 50000]);
});
t('set Cash above the part: wallet = X - part, total = X (up and down)', () => {
  const e = env();
  let r = e.adm.setPlay('vic', 400000, 'op3'); eq(r.ok, true); eq(e.wallet(), 350000); eq(e.total(), 400000); eq(r.total, 400000);
  r = e.adm.setPlay('vic', 100000, 'op4'); eq(r.ok, true); eq(e.wallet(), 50000); eq(e.total(), 100000);
});
t('set Cash to the current total is a noop (no balance moves; one net-zero line holds the op id, R2B-3)', () => {
  const e = env(); const id = e.ledger.lastId, w = e.wallet(), tot = e.total(); const r = e.adm.setPlay('vic', 250000, 'op5');
  eq([r.ok, r.noop], [true, true]); eq(e.ledger.lastId, id + 1); eq(e.wallet(), w); eq(e.total(), tot);
  const again = e.adm.setPlay('vic', 250000, 'op5'); eq([again.ok, again.dup], [true, true]); eq(e.ledger.lastId, id + 1);
});
t('with no Cash in play it behaves as before: wallet set to X', () => {
  const e = env(); e.service.cashOut('vic', 'TBL', 30000, 'play', null, 'out1'); e.service.voidRound('campaign', 'vic', 'play', 'r1', 'test');
  eq(e.service.balances('vic').atTable.play + e.service.balances('vic').inRound.play, 0, 'nothing in play');
  const r = e.adm.setPlay('vic', 0, 'op6'); eq(r.ok, true); eq(e.wallet(), 0); eq(e.total(), 0);
});
t('the same op id again after a refusal is refused again (no stale dup), a resend after success is a dup', () => {
  const e = env(); const id = e.ledger.lastId;
  eq(e.adm.setPlay('vic', 0, 'op7').code, 'cash_in_play'); eq(e.adm.setPlay('vic', 0, 'op7').code, 'cash_in_play'); eq(e.ledger.lastId, id);
  eq(e.adm.setPlay('vic', 60000, 'op8').ok, true); const d = e.adm.setPlay('vic', 60000, 'op8'); eq([d.ok, d.dup], [true, true]); eq(e.total(), 60000);
});
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
