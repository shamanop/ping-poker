// Money 1008 R2B-2 / R2B-3 (admin socket). In-process: the real transport/handlers/admin.js over the real admin/index.js, service and ledger file. No server, no port.
//  R2B-2: every admin message that moves or sets money takes its amount only as a raw JSON safe integer, checked before any conversion; anything else is bad_amount, nothing written.
//  R2B-3: an op id already used writes nothing and answers dup, also after a restart and also when the first send changed nothing (a no-op Set Cash).
// Plain node: exit 0 on pass, 1 on fail.
const fs = require('fs'), os = require('os'), path = require('path');
const { open } = require('../money/ledger');
const { createService } = require('../money/service');
const { createAdmin } = require('../admin');
const handler = require('../transport/handlers/admin');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.message)); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'eq') + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); };

const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'adm-r2b-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
let n = 0, op = 0;
const nextOp = () => 'r2b.' + (++op);

// A world over one ledger file; world(file) again = a restart on the same file.
function world(file) {
  file = file || path.join(dir, 'm' + (++n) + '.jsonl');
  const ledger = open(file, { fsync: 'none', log: () => {} });
  const service = createService(ledger, { signupPlay: 0 });
  service.ensureAccount('vic');
  const accounts = { keyOf: s => String(s).toLowerCase(), get: k => (k === 'vic' ? { key: 'vic' } : null), all: () => ({}), displayOf: k => k, resetPin: () => ({ ok: true }) };
  const adm = createAdmin({ service, ledger, accounts, registry: { tables: new Map() }, views: { bankOf: () => 0 }, onlineKeys: () => new Set() });
  const handlers = {}, sent = [];
  const socket = { emit: (ev, p) => sent.push([ev, p]) };
  const ctx = { accounts, auth: { requireAdmin: () => 'chris', signOutSockets: () => 0 }, adm, views: { bankOf: () => 0 }, presLedger: { log() {} }, afterWrite() {}, socketsOf: () => [] };
  handler.register(ctx, socket, (ev, fn) => { handlers[ev] = fn; });
  const call = (ev, p) => { sent.length = 0; handlers[ev](p); return sent.map(([, x]) => x).pop(); };
  return {
    file, ledger, service, adm, call,
    // the admin object's own answer (it says dup); the socket answer to a resend is the first answer, so tests read dup here
    setObj: (cents, opId) => adm.setPlay('vic', cents, opId),
    set: (cents, opId) => call('admin_set_play', { key: 'vic', cents, opId: opId === undefined ? nextOp() : opId }),
    adj: (delta, cur, opId) => call('admin_adjust', { key: 'vic', delta, cur: cur || 'play', reason: 'x', opId: opId === undefined ? nextOp() : opId }),
    play: () => ledger.balance('play:vic', 'play'), bank: () => ledger.balance('bank:vic', 'chips'),
    close: () => ledger.close(),
  };
}

// the nine non-number inputs of the proof, then the other values that are not a raw safe integer
const NOT_NUMBER = [['null', null], ['empty string', ''], ['[]', []], ['false', false], ['" "', ' '], ['true', true], ['"0x10"', '0x10'], ['[777]', [777]], ['"1e3"', '1e3'], ['{}', {}], ['undefined', undefined]];
const NOT_SAFE = [['NaN', NaN], ['Infinity', Infinity], ['-Infinity', -Infinity], ['-0', -0], ['1.5', 1.5], ['numeric string "500"', '500'], ['2^53', 2 ** 53], ['-(2^53)', -(2 ** 53)]];

t('R2B-2 set Cash: a non-number amount is bad_amount, nothing written, the admin is told (all nine inputs of the proof + {} + missing)', () => {
  const w = world(); w.set(50000);
  for (const [label, v] of NOT_NUMBER) {
    const id = w.ledger.lastId, r = w.set(v);
    eq([r.ok, r.code], [false, 'bad_amount'], 'cents=' + label);
    if (!r.message || !/amount/i.test(r.message)) throw new Error('no clear message for ' + label + ': ' + JSON.stringify(r));
    eq(w.play(), 50000, 'wallet after cents=' + label); eq(w.ledger.lastId, id, 'ledger line written for cents=' + label);
  }
  w.close();
});
t('R2B-2 set Cash: NaN / Infinity / -0 / 1.5 / numeric string / beyond the safe integers are bad_amount, nothing written', () => {
  const w = world(); w.set(50000);
  for (const [label, v] of NOT_SAFE) {
    const id = w.ledger.lastId, r = w.set(v);
    eq([r.ok, r.code], [false, 'bad_amount'], 'cents=' + label); eq(w.play(), 50000, label); eq(w.ledger.lastId, id, 'line for ' + label);
  }
  w.close();
});
t('R2B-2 set Cash: a refused bad_amount holds no op id (the same op id with a good amount still works)', () => {
  const w = world(); w.set(1000);
  eq(w.set(null, 'again').code, 'bad_amount'); const r = w.set(2500, 'again'); eq([r.ok, r.dup], [true, undefined]); eq(w.play(), 2500);
  w.close();
});
t('R2B-2 set Cash: the admin object itself refuses a non-number too (not only the socket handler)', () => {
  const w = world(); w.set(50000);
  for (const [label, v] of [...NOT_NUMBER, ...NOT_SAFE]) { const r = w.adm.setPlay('vic', v, nextOp()); eq(r.ok, false, label); if (w.play() !== 50000) throw new Error('moved for ' + label); }
  w.close();
});
t('R2B-2 set Cash: a good amount, 0 and the top of the range still work; out of range stays range', () => {
  const w = world(); eq(w.set(12345).ok, true); eq(w.play(), 12345); eq(w.set(0).ok, true); eq(w.play(), 0); eq(w.set(100000000000).ok, true);
  eq(w.set(100000000001).code, 'range'); eq(w.set(-1).code, 'range'); eq(w.play(), 100000000000);
  w.close();
});
t('R2B-2 adjust (Cash and Chips): a non-number delta is bad_amount, nothing written', () => {
  const w = world(); w.set(50000); const b0 = w.bank();
  for (const cur of ['play', 'chips']) for (const [label, v] of [...NOT_NUMBER, ...NOT_SAFE, ['0', 0]]) {
    const id = w.ledger.lastId, r = w.adj(v, cur);
    eq([r.ok, r.code], [false, 'bad_amount'], cur + ' delta=' + label); eq(w.ledger.lastId, id, 'line for ' + label);
  }
  eq(w.play(), 50000); eq(w.bank(), b0);
  w.close();
});
t('R2B-2 adjust: a good delta still works in both currencies', () => {
  const w = world(); eq(w.adj(700, 'play').ok, true); eq(w.play(), 700); eq(w.adj(-200, 'play').ok, true); eq(w.play(), 500);
  const b0 = w.bank(); eq(w.adj(40, 'chips').ok, true); eq(w.bank(), b0 + 40);
  w.close();
});
t('R2B-2 the handler refuses before it calls the admin object (stub that throws), unknown player aside', () => {
  const handlers = {}, sent = [];
  const accounts = { keyOf: s => String(s).toLowerCase(), get: k => (k === 'vic' ? { key: 'vic' } : null), displayOf: k => k };
  const adm = { setPlay: () => { throw new Error('setPlay called'); }, adjust: () => { throw new Error('adjust called'); } };
  handler.register({ accounts, auth: { requireAdmin: () => 'chris' }, adm, views: {}, presLedger: { log() {} }, afterWrite() {} }, { emit: (e, p) => sent.push(p) }, (ev, fn) => { handlers[ev] = fn; });
  for (const [, v] of [...NOT_NUMBER, ...NOT_SAFE]) {
    handlers.admin_set_play({ key: 'vic', cents: v, opId: 'h1' }); handlers.admin_adjust({ key: 'vic', delta: v, cur: 'play', reason: 'x', opId: 'h2' });
  }
  eq(sent.every(p => p.ok === false && p.code === 'bad_amount'), true); eq(sent.length, 2 * (NOT_NUMBER.length + NOT_SAFE.length));
});

t('R2B-3 a no-op Set Cash, the balance moves, the same message again: dup, nothing written', () => {
  const w = world(); w.set(50000);
  const a = w.set(50000, 'noop1'); eq([a.ok], [true]);
  w.adj(2000, 'play'); const id = w.ledger.lastId;
  const b = w.setObj(50000, 'noop1'); eq([b.ok, b.dup], [true, true]); eq(w.set(50000, 'noop1').ok, true); eq(w.play(), 52000); eq(w.ledger.lastId, id, 'a line was written by the resend');
  w.close();
});
t('R2B-3 the no-op leaves no balance change and the op id is one ledger line (Cash only moves net zero)', () => {
  const w = world(); w.set(50000); const id = w.ledger.lastId;
  w.set(50000, 'noop2'); eq(w.ledger.lastId, id + 1, 'one line for the no-op'); eq(w.play(), 50000); eq(w.ledger.has('adj:c.noop2'), true);
  w.close();
});
t('R2B-3 a no-op Set Cash resent after a RESTART is dup (read from the ledger file), nothing written', () => {
  const w = world(); w.set(50000); w.set(50000, 'noop3'); w.adj(2000, 'play'); const file = w.file; w.close();
  const w2 = world(file); const id = w2.ledger.lastId; eq(w2.play(), 52000);
  const r = w2.setObj(50000, 'noop3'); eq([r.ok, r.dup], [true, true]); eq(w2.set(50000, 'noop3').ok, true); eq(w2.play(), 52000); eq(w2.ledger.lastId, id);
  w2.close();
});
t('R2B-3 a no-op Set Cash resent after a restart with a 2-line window and checkpoint boot is dup', () => {
  const file = path.join(dir, 'win.jsonl');
  const mk = () => { const ledger = open(file, { fsync: 'none', log: () => {}, window: 2, ckptEvery: 3 }); const service = createService(ledger, { signupPlay: 0 }); service.ensureAccount('vic'); const accounts = { get: k => (k === 'vic' ? { key: 'vic' } : null), all: () => ({}) }; return { ledger, adm: createAdmin({ service, ledger, accounts, registry: { tables: new Map() }, views: {}, onlineKeys: () => new Set() }) }; };
  let w = mk(); w.adm.setPlay('vic', 50000, 'w1'); w.adm.setPlay('vic', 50000, 'wnoop');
  for (let i = 0; i < 6; i++) w.adm.adjust('vic', 100, 'play', 'x', 'w.a' + i);
  w.ledger.close(); w = mk(); const id = w.ledger.lastId, bal = w.ledger.balance('play:vic', 'play');
  const r = w.adm.setPlay('vic', 50000, 'wnoop'); eq([r.ok, r.dup], [true, true]); eq(w.ledger.balance('play:vic', 'play'), bal); eq(w.ledger.lastId, id);
  w.ledger.close();
});
t('R2B-3 the no-op op id with another target / as an adjust / in Chips is ref_conflict, nothing moves', () => {
  const w = world(); w.set(50000); w.set(50000, 'noop4'); const id = w.ledger.lastId;
  eq(w.set(60000, 'noop4').code, 'ref_conflict'); eq(w.adj(5000, 'play', 'noop4').ok, false); eq(w.adj(5000, 'chips', 'noop4').ok, false);
  eq(w.play(), 50000); eq(w.ledger.lastId, id);
  w.close();
});
t('R2B-3 a first no-op, then a resend with another target after the balance moved, is ref_conflict (never a new edit)', () => {
  const w = world(); w.set(50000); w.set(50000, 'noop5'); w.adj(2000, 'play');
  eq(w.set(52000, 'noop5').code, 'ref_conflict'); eq(w.play(), 52000);
  w.close();
});
t('R2B-3 a no-op on a player with Cash 0 and the first-ever edit also holds its op id', () => {
  const w = world(); const a = w.set(0, 'zero1'); eq(a.ok, true); w.adj(300, 'play');
  const b = w.setObj(0, 'zero1'); eq([b.ok, b.dup], [true, true]); eq(w.play(), 300);
  w.close();
});
t('R2B-3 control: a normal Set Cash resend is still dup, a different op id is still a new edit', () => {
  const w = world(); w.set(50000); w.set(60000, 'c1'); const r = w.setObj(60000, 'c1'); eq([r.ok, r.dup], [true, true]); eq(w.play(), 60000);
  eq(w.set(70000, 'c2').ok, true); eq(w.play(), 70000);
  w.close();
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
