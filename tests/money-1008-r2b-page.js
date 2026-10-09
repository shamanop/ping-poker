// Money 1008 R2B-6 / RV-1 / RV-2 / RV-4 (admin). In-process: the real transport/handlers/admin.js over the real admin/index.js, service and ledger file. No server, no port.
//  R2B-6: the admin page shows and edits the player's TOTAL Cash (wallet + seats + open rounds); the overview carries total, wallet and in-play as three numbers; saving the shown total unchanged moves nothing.
//  RV-1: an op id is used once, for one account (another account = ref_conflict, also after a restart; a line under the old per-account ref still counts as a dup for its own account).
//  RV-2: a refused ledger write on a no-op Set Cash answers { ok:false, code } and an admin_result with the op id (no throw).
//  RV-4: admin_adjust cannot take a player's total Cash past the Set Cash maximum.
// Plain node: exit 0 on pass, 1 on fail.
const fs = require('fs'), os = require('os'), path = require('path');
const { open } = require('../money/ledger');
const { createService } = require('../money/service');
const { createAdmin } = require('../admin');
const handler = require('../transport/handlers/admin');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.message)); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'eq') + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); };

const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'adm-page-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
let n = 0, op = 0;
const nextOp = () => 'pg.' + (++op);
const KEYS = ['vic', 'bob'];

// A world over one ledger file; world(file) again = a restart on the same file.
function world(file) {
  file = file || path.join(dir, 'm' + (++n) + '.jsonl');
  const ledger = open(file, { fsync: 'none', log: () => {} });
  const service = createService(ledger, { signupPlay: 0 });
  for (const k of KEYS) service.ensureAccount(k);
  const all = {}; for (const k of KEYS) all[k] = { key: k, display: k, claimed: true };
  const accounts = { keyOf: s => String(s).toLowerCase(), get: k => all[k] || null, all: () => all, displayOf: k => k, resetPin: () => ({ ok: true }) };
  const adm = createAdmin({ service, ledger, accounts, registry: { tables: new Map() }, views: { bankOf: () => 0 }, onlineKeys: () => new Set() });
  const handlers = {}, sent = [];
  const socket = { emit: (ev, p) => sent.push([ev, p]) };
  const ctx = { accounts, auth: { requireAdmin: () => 'chris' }, adm, views: { bankOf: () => 0 }, presLedger: { log() {} }, afterWrite() {}, socketsOf: () => [] };
  handler.register(ctx, socket, (ev, fn) => { handlers[ev] = fn; });
  const call = (ev, p) => { sent.length = 0; const log = console.log; console.log = () => {}; try { handlers[ev](p); } finally { console.log = log; } return sent.map(([, x]) => x).pop(); };
  const row = k => adm.overview().accounts.find(a => a.key === k);
  return {
    file, ledger, service, adm, call, row, sent,
    set: (cents, opId, key) => call('admin_set_play', { key: key || 'vic', cents, opId: opId === undefined ? nextOp() : opId }),
    adj: (delta, cur, opId, key) => call('admin_adjust', { key: key || 'vic', delta, cur: cur || 'play', reason: 'x', opId: opId === undefined ? nextOp() : opId }),
    play: k => ledger.balance('play:' + (k || 'vic'), 'play'),
    lines: () => ledger.lastId,
    close: () => ledger.close(),
  };
}
// vic: 300.00 in the wallet, 200.00 at a Cash table, 100.00 in an open round (total 600.00)
function seated(w) {
  w.adm.setPlay('vic', 60000, 'seed.vic');
  w.service.buyIn('vic', 'TBL', 20000, 'play', null, 'buy.vic');
  w.service.openRound('campaign', 'vic', 'play', 'r1', 10000);
}

t('R2B-6 the overview row carries total, wallet and in-play as three numbers', () => {
  const w = world(); seated(w);
  const r = w.row('vic');
  eq([r.playTotal, r.playWallet, r.playInPlay], [60000, 30000, 30000]);
  eq(r.playTotal, r.playWallet + r.playInPlay, 'total = wallet + in play');
  const q = w.row('bob'); eq([q.playTotal, q.playWallet, q.playInPlay], [0, 0, 0]);
  w.close();
});
t('R2B-6 the number the edit box holds (the total), saved unchanged, changes nothing', () => {
  const w = world(); seated(w);
  const shown = w.row('vic').playTotal, id = w.lines();
  const r = w.set(shown);
  eq([r.ok, r.wallet, r.atTable, r.inRound, r.total], [true, 30000, 20000, 10000, 60000]);
  eq(w.play(), 30000, 'wallet'); eq(w.row('vic').playTotal, shown, 'total after');
  eq(w.row('vic').playWallet, 30000, 'wallet in the overview');
  if (w.lines() < id) throw new Error('ledger went back');
  w.close();
});
t('R2B-6 add 100.00 to the shown total: the wallet gains exactly 100.00', () => {
  const w = world(); seated(w);
  const r = w.set(w.row('vic').playTotal + 10000);
  eq(r.ok, true); eq(w.play(), 40000, 'wallet'); eq(w.row('vic').playTotal, 70000);
  w.close();
});
t('R2B-6 a total below the part in play is refused with a message that names it, nothing written', () => {
  const w = world(); seated(w); const id = w.lines();
  const r = w.set(20000);
  eq([r.ok, r.code], [false, 'cash_in_play']);
  if (!/in play/.test(r.message) || !/300\.00/.test(r.message)) throw new Error('message: ' + r.message);
  eq(w.lines(), id); eq(w.play(), 30000);
  w.close();
});

// ---- RV-1: one op id, one account ----
const noWrite = (w, fn) => { const id = w.lines(); const r = fn(); eq(w.lines(), id, 'ledger line written'); return r; };
t('RV-1 the same op id for ANOTHER account is ref_conflict, nothing written (adjust Chips, adjust Cash, set Cash)', () => {
  const w = world(); w.adj(500, 'chips', 'X1'); w.adj(700, 'play', 'X2'); w.set(900, 'X3');
  const b0 = w.ledger.balance('bank:bob', 'chips');
  for (const [label, fn] of [['adjust chips', () => w.adj(500, 'chips', 'X1', 'bob')], ['adjust cash', () => w.adj(700, 'play', 'X2', 'bob')], ['set cash', () => w.set(900, 'X3', 'bob')],
    ['cash op id used for chips', () => w.adj(500, 'chips', 'X2', 'bob')]]) {
    const r = noWrite(w, fn); eq([label, r.ok, r.code], [label, false, 'ref_conflict']);
  }
  eq([w.ledger.balance('bank:bob', 'chips'), w.play('bob')], [b0, 0], 'bob untouched');
  w.close();
});
t('RV-1 a no-op Set Cash holds its op id for the account it was sent for; another account is ref_conflict', () => {
  const w = world(); w.set(0, 'N1');            // vic is at 0: a no-op, one net-zero line
  eq(noWrite(w, () => w.adm.setPlay('vic', 0, 'N1')).dup, true, 'same account resend');
  const r = noWrite(w, () => w.set(0, 'N1', 'bob')); eq([r.ok, r.code], [false, 'ref_conflict']);
  w.close();
});
t('RV-1 also after a restart', () => {
  const w = world(); w.adj(500, 'chips', 'R1'); w.set(0, 'R2', 'bob'); const file = w.file; w.close();
  const v = world(file);
  eq(noWrite(v, () => v.adj(500, 'chips', 'R1', 'bob')).code, 'ref_conflict'); eq(noWrite(v, () => v.set(0, 'R2')).code, 'ref_conflict');
  eq(noWrite(v, () => v.adm.adjust('vic', 500, 'chips', 'x', 'R1')).dup, true, 'same account, same op: dup');
  v.close();
});
t('RV-1 a line written under the OLD ref form still counts: the same account\'s resend is dup, another account is ref_conflict', () => {
  const w = world();
  w.service.adminAdjust('vic', 5000, 'play', 'admin set play to 5000', 'adj:vic:c.OLD1');            // what the shipped code wrote
  w.service.adminAdjust('vic', 300, 'chips', 'admin console', 'adj:vic:c.OLD2');
  const a = noWrite(w, () => w.adm.setPlay('vic', 5000, 'OLD1')); eq([a.ok, a.dup, a.code], [true, true, undefined]);
  const b = noWrite(w, () => w.adm.adjust('vic', 300, 'chips', 'admin console', 'OLD2')); eq([b.ok, b.dup], [true, true]);
  eq(noWrite(w, () => w.adj(999, 'chips', 'OLD2')).code, 'ref_conflict', 'other numbers under an old op id');
  eq(noWrite(w, () => w.set(5000, 'OLD1', 'bob')).code, 'ref_conflict', 'another account, old op id (set Cash)');
  eq(noWrite(w, () => w.adj(300, 'chips', 'OLD2', 'bob')).code, 'ref_conflict', 'another account, old op id (adjust)');
  eq([w.play(), w.play('bob')], [5000, 0]);
  w.close();
});
t('RV-1 a new edit is written under the op-id-only ref', () => {
  const w = world(); w.adj(500, 'chips', 'F1');
  eq([w.ledger.has('adj:c.F1'), w.ledger.has('adj:vic:c.F1')], [true, false]);
  w.close();
});

// ---- RV-2: a refused ledger write on a no-op Set Cash is an answer, not a throw ----
t('RV-2 a no-op Set Cash while the ledger refuses the write answers { ok:false, code } (no throw), and the socket answer carries the op id', () => {
  const w = world(); w.set(0, 'E0');            // vic at 0
  w.close();                                      // the ledger now refuses every write
  let r; try { r = w.adm.setPlay('vic', 0, 'E1'); } catch (e) { throw new Error('setPlay threw: ' + (e && e.message)); }
  eq(r.ok, false); if (!r.code) throw new Error('no code: ' + JSON.stringify(r));
  const s = w.call('admin_set_play', { key: 'vic', cents: 0, opId: 'E2' });
  eq([s.op, s.ok, s.opId], ['set_play', false, 'E2']); if (!s.code) throw new Error('no code on the socket answer');
  const d = w.adj(100, 'play', 'E3'); eq([d.op, d.ok, d.opId], ['adjust', false, 'E3']);   // the real-delta paths already answered like this
});

// ---- RV-4: admin_adjust cannot take a player's total Cash past the Set Cash maximum ----
const MAX = 100000000000;
t('RV-4 an adjust whose resulting total Cash would pass the maximum is refused like Set Cash (same code and message), nothing written', () => {
  const w = world(); seated(w);                 // total 60000: 30000 wallet + 30000 in play
  const id = w.lines();
  const a = w.adj(MAX - 60000 + 1, 'play'), s = w.set(MAX + 1);
  eq([a.ok, a.code], [false, 'range']); eq([s.ok, s.code], [false, 'range']); eq(a.message, s.message, 'same message');
  if (!/range/i.test(a.message)) throw new Error('message: ' + a.message);
  eq(w.lines(), id, 'ledger line written'); eq(w.play(), 30000);
  w.close();
});
t('RV-4 an adjust that lands exactly on the maximum is allowed; Chips have no such limit', () => {
  const w = world(); seated(w);
  const a = w.adj(MAX - 60000, 'play', 'AT-MAX'); eq(a.ok, true); eq(w.adm.adjust('vic', MAX - 60000, 'play', 'x', 'AT-MAX').dup, true, 'the resend of the adjust that reached the maximum is a dup, not range'); eq(w.row('vic').playTotal, MAX);
  eq(w.adj(MAX - 60000, 'play').code, 'range', 'a fresh op id for the same amount: over');
  eq(w.adj(1, 'play').code, 'range', 'one cent over'); eq(w.adj(-1, 'play').ok, true, 'a removal is always fine');
  eq(w.adj(MAX + 5, 'chips').ok, true, 'Chips');
  w.close();
});

// ---- RV-3: the soak checker does not count a net-zero mark line as Cash born ----
const { Checker } = require('./soak/invariants');
const poll = w => { const c = new Checker(w.file); c.poll(); return { c, v: c.take() }; };
t('RV-3 Checker: a no-op Set Cash mark is not "born" Cash: I13 still watches that wallet; a mark alone is no violation', () => {
  const w = world(); w.set(0, 'M1', 'bob');            // bob has 0 Cash: a mark line (1 in, 1 out)
  let { c, v } = poll(w);
  eq(v.filter(x => /^I(1|3|1[0-3])$/.test(x.id)), [], 'a mark alone'); eq(c.cashBorn.has('bob'), false, 'bob is not born');
  w.ledger.transfer('mint:signup', 'play:bob', 500, 'play', 'signup', 'leak.1');   // Cash that reaches the wallet from nowhere legitimate
  ({ c, v } = poll(w));
  eq(v.filter(x => x.id === 'I13').map(x => x.accounts.key), ['bob'], 'I13 must report bob');
  w.close();
});
t('RV-3 Checker: a real admin credit still makes the key born (no I13), also when a mark follows', () => {
  const w = world(); w.adj(700, 'play', 'M2', 'bob'); w.set(700, 'M3', 'bob');   // credit, then a no-op mark
  const { c, v } = poll(w);
  eq(c.cashBorn.has('bob'), true); eq(v.filter(x => x.id === 'I13'), []);
  w.close();
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
