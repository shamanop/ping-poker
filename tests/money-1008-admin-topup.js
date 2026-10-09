'use strict';
// Money 1008 SVC-1b: the Cash top-up cannot mint. service.topUp throws a MoneyError (code `disabled`) before any ledger write; the wallet adapter turns it into a refusal.
// The free-play Chips mints that share service.mint() (daily bonus) keep working. In-process, real ledger + service + adapter. Plain node: exit 0 / 1.
const fs = require('fs'), os = require('os'), path = require('path');
const { open } = require('../money/ledger');
const { createService } = require('../money/service');
const { createWalletAdapter } = require('../transport/wallet-adapter');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.message)); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'eq') + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); };
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'topup-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
let n = 0;
function env() {
  const ledger = open(path.join(dir, 'm' + (++n) + '.jsonl'), { fsync: 'none', log: () => {} });
  const service = createService(ledger, { signupPlay: 0 });
  service.ensureAccount('ann');
  return { ledger, service, wallet: createWalletAdapter({ service, ledger, schedule: fn => fn() }) };
}
const code = fn => { try { fn(); return null; } catch (e) { return { name: e && e.name, code: e && e.code }; } };

t('service.topUp on a broke player throws MoneyError disabled and writes nothing', () => {
  const e = env(); const id = e.ledger.lastId;
  eq(code(() => e.service.topUp('ann', 'tu1')), { name: 'MoneyError', code: 'disabled' });
  eq(e.ledger.lastId, id, 'no ledger line'); eq(e.ledger.balance('play:ann', 'play'), 0); eq(e.ledger.balance('mint:topup', 'play'), 0);
});
t('...also with a fresh ref each time, and when a ref already exists in the ledger (no replay path mints)', () => {
  const e = env(); const id = e.ledger.lastId;
  for (const r of ['a', 'b', 'c']) eq(code(() => e.service.topUp('ann', r)).code, 'disabled');
  e.service.adminAdjust('ann', 50, 'play', 'x', 'tu-held'); const id2 = e.ledger.lastId;
  eq(code(() => e.service.topUp('ann', 'tu-held')).code, 'disabled'); eq(e.ledger.lastId, id2); eq(e.ledger.balance('play:ann', 'play'), 50);
});
t('the wallet adapter maps it to a refusal (code disabled), balance untouched, repeatable', () => {
  const e = env(); const id = e.ledger.lastId;
  for (let i = 0; i < 3; i++) eq(code(() => e.wallet.topUp('ann')), { name: 'Error', code: 'disabled' });
  eq(e.ledger.lastId, id); eq(e.wallet.get('ann').play, 0);
});
t('Chips keep working: the daily bonus mint and a Chips adjust are untouched', () => {
  const e = env(); const c0 = e.ledger.balance('bank:ann', 'chips');
  e.service.mint('bonus', 'ann', 500, 'chips', 'bonus:ann:1'); eq(e.ledger.balance('bank:ann', 'chips'), c0 + 500);
  e.wallet.credit('ann', 'chips', 300, { game: 'bonus', round: 'd1' }); eq(e.ledger.balance('bank:ann', 'chips'), c0 + 800);
  eq(e.ledger.balance('play:ann', 'play'), 0, 'no Cash from a Chips mint');
});
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
