'use strict';
// P6 W3b A4: admin_adjust / admin_set_play are idempotent on a resend of the same op id. The real admin/index.js + transport/handlers/admin.js over a real
// ledger + service on a temp file; accounts, auth and views are stubs. Asserts on ledger lines and on what the admin socket is sent. Plain node: exit 0 on pass, 1 on fail.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { open } = require('../../money/ledger');
const { createService } = require('../../money/service');
const { createAdmin } = require('../../admin');
const { register } = require('../../transport/handlers/admin');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'eq') + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); };
const ok = (c, m) => { if (!c) throw new Error(m || 'not ok'); };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-money-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
let n = 0;

function env() {
  const ledger = open(path.join(dir, 'm' + (++n) + '.jsonl'), { fsync: 'none', log: () => {} });
  const service = createService(ledger);
  service.ensureAccount('ann');
  const accounts = { get: (k) => (k === 'ann' ? { key: 'ann' } : null), keyOf: (s) => String(s).toLowerCase().trim(), displayOf: (k) => k, all: () => ({}) };
  const adm = createAdmin({ service, ledger, accounts, registry: { tables: new Map() }, views: {}, onlineKeys: () => new Set() });
  const hand = [], touched = [], handlers = {}, sent = [];
  const socket = { emit: (ev, p) => sent.push([ev, p]) };
  const ctx = { accounts, auth: { requireAdmin: () => 'chris' }, adm, views: { bankOf: (k) => ledger.balance('bank:' + k, 'chips') }, presLedger: { log: (...a) => hand.push(a) }, afterWrite: (ks) => touched.push(...ks) };
  register(ctx, socket, (ev, fn) => { handlers[ev] = fn; });
  const send = (ev, p) => { const log = console.log; console.log = () => {}; try { handlers[ev](p); } finally { console.log = log; } return sent[sent.length - 1][1]; };
  const adjLines = () => [...ledger.entries((e) => e.reason && e.reason.startsWith('admin:'))];
  return { ledger, service, adm, send, sent, hand, touched, adjLines, bank: () => ledger.balance('bank:ann', 'chips'), play: () => ledger.balance('play:ann', 'play') };
}

t('A4: a resend of the same op id writes nothing and gets the same answer (adjust, chips)', () => {
  const e = env(); const b0 = e.bank();
  const msg = { key: 'ann', delta: 500, cur: 'chips', reason: 'admin console', opId: 'op-click-1' };
  const a = e.send('admin_adjust', msg);
  eq([a.ok, a.message, a.opId], [true, 'Adjusted', 'op-click-1']);
  eq(e.adjLines().length, 1); eq(e.bank(), b0 + 500);
  const b = e.send('admin_adjust', msg); const c = e.send('admin_adjust', msg);
  eq(b, a, 'the same answer'); eq(c, a);
  eq(e.adjLines().length, 1, 'still one ledger line'); eq(e.bank(), b0 + 500, 'balance moved once');
  eq(e.hand.length, 1, 'the hand log got one adjust row');
});

t('A4: a resend of a negative adjust in Play $ does not burn twice', () => {
  const e = env(); const p0 = e.play();
  const msg = { key: 'ann', delta: -1234, cur: 'play', reason: 'admin console', opId: 'op-burn' };
  e.send('admin_adjust', msg); e.send('admin_adjust', msg);
  eq(e.play(), p0 - 1234); eq(e.adjLines().length, 1);
});

t('A4: two different op ids are two edits', () => {
  const e = env(); const b0 = e.bank();
  e.send('admin_adjust', { key: 'ann', delta: 100, cur: 'chips', reason: 'x', opId: 'op-a' });
  e.send('admin_adjust', { key: 'ann', delta: 100, cur: 'chips', reason: 'x', opId: 'op-b' });
  eq(e.bank(), b0 + 200); eq(e.adjLines().length, 2);
});

t('A4: the same op id with other numbers is refused, nothing written', () => {
  const e = env(); const b0 = e.bank();
  e.send('admin_adjust', { key: 'ann', delta: 100, cur: 'chips', reason: 'x', opId: 'op-a' });
  const r = e.send('admin_adjust', { key: 'ann', delta: 999, cur: 'chips', reason: 'x', opId: 'op-a' });
  eq([r.ok, r.code], [false, 'ref_conflict']); eq(e.bank(), b0 + 100); eq(e.adjLines().length, 1);
});

t('A4: a request without an op id works as before: every call writes', () => {
  const e = env(); const b0 = e.bank();
  const a = e.send('admin_adjust', { key: 'ann', delta: 100, cur: 'chips', reason: 'x' });
  eq(a, { op: 'adjust', key: 'ann', ok: true, message: 'Adjusted' }, 'no opId in the answer');
  e.send('admin_adjust', { key: 'ann', delta: 100, cur: 'chips', reason: 'x' });
  eq(e.bank(), b0 + 200); eq(e.adjLines().length, 2);
});

t('A4: a malformed op id is refused and writes nothing', () => {
  const e = env(); const id = e.ledger.lastId;
  for (const opId of ['', 'a:b', 'x'.repeat(65), 5, {}, 'sp ace']) {
    const r = e.send('admin_adjust', { key: 'ann', delta: 100, cur: 'chips', reason: 'x', opId });
    eq([r.ok, r.code], [false, 'bad_op'], JSON.stringify(opId));
  }
  eq(e.ledger.lastId, id);
});

t('A4: admin_set_play with an op id: a resend writes nothing and answers the same, even when the balance moved meanwhile', () => {
  const e = env();
  const msg = { key: 'ann', cents: 5000, opId: 'op-set' };
  const a = e.send('admin_set_play', msg);
  eq([a.ok, a.message, a.opId], [true, 'Play set', 'op-set']); eq(e.play(), 5000); eq(e.adjLines().length, 1);
  e.service.adminAdjust('ann', 700, 'play', 'won something', 'test:other');   // the balance moves before the resend arrives
  const b = e.send('admin_set_play', msg);
  eq(b, a, 'the same answer'); eq(e.play(), 5700, 'the resend did not set it again'); eq(e.adjLines().length, 2, 'only the unrelated line was added');
  // a new op id sets it again
  e.send('admin_set_play', { key: 'ann', cents: 5000, opId: 'op-set-2' }); eq(e.play(), 5000);
});

t('A4: admin_set_play without an op id works as before', () => {
  const e = env();
  const a = e.send('admin_set_play', { key: 'ann', cents: 4321 });
  eq(a, { op: 'set_play', key: 'ann', ok: true, message: 'Play set' }); eq(e.play(), 4321);
  e.send('admin_set_play', { key: 'ann', cents: 4321 }); eq(e.adjLines().length, 1, 'setting the same value again is a noop, as before');
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
