'use strict';
// Money 1008 K1-2: a money-moving admin message without an op id is refused (no silent default id), and the same op id twice moves money once.
// In-process: the real admin/index.js over a real ledger + service. Plain node: exit 0 on pass, 1 on fail.
const fs = require('fs'), os = require('os'), path = require('path');
const { open } = require('../money/ledger');
const { createService } = require('../money/service');
const { createAdmin } = require('../admin');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.message)); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'eq') + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); };

const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'adm-opid-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
let n = 0;
function env() {
  const ledger = open(path.join(dir, 'm' + (++n) + '.jsonl'), { fsync: 'none', log: () => {} });
  const service = createService(ledger, { signupPlay: 0 });
  service.ensureAccount('ann');
  const accounts = { get: k => (k === 'ann' ? { key: k } : null), all: () => ({}) };
  const adm = createAdmin({ service, ledger, accounts, registry: { tables: new Map() }, views: {}, onlineKeys: () => new Set() });
  return { ledger, service, adm, lines: () => [...ledger.entries(e => e.reason && e.reason.startsWith('admin:'))].length, play: () => ledger.balance('play:ann', 'play'), bank: () => ledger.balance('bank:ann', 'chips') };
}

t('adjust with no op id is refused (Cash), nothing written, however often it is sent', () => {
  const e = env(); const id = e.ledger.lastId;
  for (let i = 0; i < 2; i++) { const r = e.adm.adjust('ann', 100000, 'play', 'bonus credit'); eq([r.ok, r.code], [false, 'op_required']); if (!r.message || !/op/i.test(r.message)) throw new Error('no clear message: ' + JSON.stringify(r)); }
  eq(e.play(), 0); eq(e.lines(), 0); eq(e.ledger.lastId, id, 'no ledger line');
});
t('adjust with no op id is refused (Chips) as well; null and undefined alike', () => {
  const e = env(); const b0 = e.bank();
  for (const op of [undefined, null]) eq(e.adm.adjust('ann', 500, 'chips', 'x', op).code, 'op_required');
  eq(e.bank(), b0); eq(e.lines(), 0);
});
t('set Cash with no op id is refused, nothing written', () => {
  const e = env(); const id = e.ledger.lastId;
  const r = e.adm.setPlay('ann', 4321); eq([r.ok, r.code], [false, 'op_required']); eq(e.play(), 0); eq(e.ledger.lastId, id);
});
t('the same op id twice moves money once (adjust)', () => {
  const e = env();
  const a = e.adm.adjust('ann', 100000, 'play', 'c', 'clickZ'), b = e.adm.adjust('ann', 100000, 'play', 'c', 'clickZ');
  eq([a.ok, a.dup], [true, undefined]); eq([b.ok, b.dup], [true, true]); eq(e.play(), 100000); eq(e.lines(), 1);
});
t('the same op id twice moves money once (set Cash)', () => {
  const e = env();
  const a = e.adm.setPlay('ann', 5000, 'clickS'), b = e.adm.setPlay('ann', 5000, 'clickS');
  eq(a.ok, true); eq([b.ok, b.dup], [true, true]); eq(e.play(), 5000); eq(e.lines(), 1);
});
t('a malformed op id is still bad_op', () => {
  const e = env();
  for (const op of ['', 'a:b', 'x'.repeat(65), 5, {}]) eq(e.adm.adjust('ann', 100, 'chips', 'x', op).code, 'bad_op', JSON.stringify(op));
  eq(e.lines(), 0);
});
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
