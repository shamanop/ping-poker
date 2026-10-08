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
  service.ensureAccount('ann'); service.ensureAccount('bob');
  const accounts = { get: (k) => (k === 'ann' || k === 'bob' ? { key: k } : null), keyOf: (s) => String(s).toLowerCase().trim(), displayOf: (k) => k, all: () => ({}) };
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

t('A4: a resend of a negative adjust in Cash does not burn twice', () => {
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

t('K1-2: a request without an op id is refused (op_required), nothing written, however often it is sent', () => {
  const e = env(); const b0 = e.bank(); const id = e.ledger.lastId;
  const a = e.send('admin_adjust', { key: 'ann', delta: 100, cur: 'chips', reason: 'x' });
  eq([a.op, a.key, a.ok, a.code], ['adjust', 'ann', false, 'op_required']);
  e.send('admin_adjust', { key: 'ann', delta: 100, cur: 'chips', reason: 'x' });
  eq(e.bank(), b0); eq(e.adjLines().length, 0); eq(e.ledger.lastId, id);
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
  // the resend is the same answer; the where-the-Cash-sits numbers (K1-3 msg) are today's, not a copy of the first answer's
  eq([b.op, b.key, b.ok, b.message, b.opId], [a.op, a.key, a.ok, a.message, a.opId], 'the same answer'); eq([a.wallet, a.total, b.wallet, b.total], [5000, 5000, 5700, 5700], 'the numbers are current');
  eq(e.play(), 5700, 'the resend did not set it again'); eq(e.adjLines().length, 2, 'only the unrelated line was added');
  // a new op id sets it again
  e.send('admin_set_play', { key: 'ann', cents: 5000, opId: 'op-set-2' }); eq(e.play(), 5000);
});

t('K1-2: admin_set_play without an op id is refused (op_required), nothing written', () => {
  const e = env(); const id = e.ledger.lastId;
  const a = e.send('admin_set_play', { key: 'ann', cents: 4321 });
  eq([a.op, a.key, a.ok, a.code], ['set_play', 'ann', false, 'op_required']); eq(e.ledger.lastId, id); eq(e.adjLines().length, 0);
});

// ---- P6 W3b fix round 2 ----
t('D7: admin_set_play with an op id the ledger holds for ANOTHER edit is refused (ref_conflict), never answered "Play set": a chips adjust, another target, and the other order', () => {
  const e = env(); const p0 = e.play();
  e.send('admin_adjust', { key: 'ann', delta: 500, cur: 'chips', reason: 'admin console', opId: 'X1' });
  const a = e.send('admin_set_play', { key: 'ann', cents: 5, opId: 'X1' });
  eq([a.ok, a.code], [false, 'ref_conflict'], 'a chips edit under that op id'); eq(e.play(), p0, 'nothing set'); eq(e.adjLines().length, 1);
  const f = env();
  eq(f.send('admin_set_play', { key: 'ann', cents: 500, opId: 'X2' }).ok, true);
  const b = f.send('admin_set_play', { key: 'ann', cents: 900, opId: 'X2' });
  eq([b.ok, b.code], [false, 'ref_conflict'], 'another target'); eq(f.play(), 500, 'still the first target'); eq(f.adjLines().length, 1);
  const h = env(); h.send('admin_set_play', { key: 'ann', cents: 500, opId: 'X4' });
  const d = h.send('admin_adjust', { key: 'ann', delta: 700, cur: 'chips', reason: 'admin console', opId: 'X4' });
  eq([d.ok, d.code], [false, 'ref_conflict'], 'the other order'); eq(h.adjLines().length, 1);
});

t('D7: the same op id with the SAME request is still an ok dup (even when the balance moved), the target is what makes it the same request', () => {
  const e = env(); const a = e.send('admin_set_play', { key: 'ann', cents: 500, opId: 'Y1' }); eq(a.ok, true);
  e.service.adminAdjust('ann', 250, 'play', 'won something', 'test:other');
  const b = e.send('admin_set_play', { key: 'ann', cents: 500, opId: 'Y1' });
  eq([b.op, b.key, b.ok, b.message, b.opId], [a.op, a.key, a.ok, a.message, a.opId], 'same answer'); eq([a.total, b.total], [500, 750], 'the numbers are current');
  eq(e.play(), 750, 'not set again'); eq(e.adjLines().length, 2);
});

t('D5: the op id names the edit of ONE player: the same op id on two players writes both (refs carry the key)', () => {
  const e = env(); const b0 = e.ledger.balance('bank:bob', 'chips');
  const a = e.send('admin_adjust', { key: 'ann', delta: 500, cur: 'chips', reason: 'admin console', opId: 'X4' });
  const b = e.send('admin_adjust', { key: 'bob', delta: 500, cur: 'chips', reason: 'admin console', opId: 'X4' });
  eq([a.ok, a.dup, b.ok, b.dup], [true, undefined, true, undefined]); eq(e.ledger.balance('bank:bob', 'chips'), b0 + 500, 'bob moved');
  eq(e.adjLines().map((x) => x.ref), ['adj:ann:c.X4', 'adj:bob:c.X4']);
  const c = e.send('admin_set_play', { key: 'bob', cents: 123, opId: 'X5' }), d = e.send('admin_set_play', { key: 'ann', cents: 123, opId: 'X5' });
  eq([c.ok, d.ok], [true, true]); eq([e.ledger.balance('play:bob', 'play'), e.play()], [123, 123]);
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
