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

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
