'use strict';
// Migration tests. Plain node: exit 0 on pass, 1 on fail.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { open } = require('../../money/ledger');
const { createService } = require('../../money/service');
const mig = require('../../tools/migrate-v2');
const { apply, needsMigration, accountKeys } = mig;
// Money 1008 S-1: the migration mints no Cash by default. These fixtures model the OLD lazy default (1,000,000 for an account with no wallet row), so they opt in; the default (0) is tested in tests/money-1008-migrate.js.
const migrate = (inputs) => mig.migrate(inputs, { signupPlay: 1000000 });
const gen = require('./fixtures/gen-fixtures');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); }
}
const eq = (a, b, m) => { if (a !== b) throw new Error((m || 'eq') + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); };
const deq = (a, b, m) => eq(JSON.stringify(a), JSON.stringify(b), m || 'deep');
const ok = (c, m) => { if (!c) throw new Error(m || 'not ok'); };

const FX = path.join(__dirname, 'fixtures');
const NAMES = fs.readdirSync(FX).filter(n => fs.statSync(path.join(FX, n)).isDirectory()).sort();
const load = (name) => Object.fromEntries(['bank', 'wallet', 'stacks', 'accounts'].map(k => [k, JSON.parse(fs.readFileSync(path.join(FX, name, k + '.json'), 'utf8'))]));
const hash = (x) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); } return o; }

const dir = fs.mkdtempSync(path.join(process.env.MONEY_TMP || os.tmpdir(), 'money-migrate-'));
let n = 0;
const tmpFile = () => path.join(dir, 'm' + (++n) + '.jsonl');
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// An independent model of what migration must produce, written from the contract and the old boot code
// (bank[k] = (bank[k] || 0) + stack for stack > 0, lazy defaults 10,000 / 1,000,000).
const good = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
function model(fx) {
  const keys = accountKeys(fx.accounts); const isAcc = new Set(keys);
  const bank = {}, play = {}, orphanChips = {}, orphanPlay = {}, rows = { bank: new Set(), play: new Set() };
  const add = (m, k, v) => { m[k] = (m[k] || 0) + v; };
  for (const [name, v] of Object.entries(fx.bank)) {
    if (isAcc.has(name)) { rows.bank.add(name); if (good(v)) add(bank, name, v); } else if (good(v) && v > 0) add(orphanChips, name, v);
  }
  const srows = [];
  for (const [k, v] of Object.entries(fx.stacks)) { if (v && typeof v === 'object') for (const [kk, vv] of Object.entries(v)) srows.push([kk, vv]); else srows.push([k, v]); }
  for (const [name, v] of srows) {
    if (!good(v) || v === 0) continue;
    if (isAcc.has(name)) { rows.bank.add(name); add(bank, name, v); } else add(orphanChips, name, v);
  }
  for (const [name, row] of Object.entries(fx.wallet)) {
    const v = row && typeof row === 'object' ? row.play : row;
    if (isAcc.has(name)) { rows.play.add(name); if (good(v)) add(play, name, v); } else if (good(v) && v > 0) add(orphanPlay, name, v);
  }
  for (const k of keys) { if (!rows.bank.has(k)) bank[k] = 10000; if (!rows.play.has(k)) play[k] = 1000000; bank[k] = bank[k] || 0; play[k] = play[k] || 0; }
  return { keys, bank, play, orphanChips, orphanPlay };
}

function check(name) {
  const fx = deepFreeze(load(name));
  const before = hash(fx);
  const { items, report } = migrate(fx);
  eq(hash(fx), before, 'inputs untouched (hash)');
  deq(migrate(fx).items, items, 'migrate is deterministic');
  ok(report.totals.chips.ok && report.totals.play.ok, 'report totals in == out');
  const f = tmpFile(); const l = open(f, { now: () => 1 });
  const r1 = apply(l, items);
  eq(r1.conflicts.length, 0); eq(r1.written, items.length);
  const ck = l.check(); ok(ck.chips.ok && ck.play.ok, 'books balance');
  const m = model(fx);
  for (const k of m.keys) { eq(l.balance('bank:' + k, 'chips'), m.bank[k], name + ' bank:' + k); eq(l.balance('play:' + k, 'play'), m.play[k], name + ' play:' + k); }
  const orphanMap = (cur) => Object.fromEntries(l.list('orphan:', cur).map(x => [x.account.slice(7), x.balance]));
  deq(Object.fromEntries(Object.entries(orphanMap('chips')).sort()), Object.fromEntries(Object.entries(m.orphanChips).sort()), name + ' orphan chips');
  deq(Object.fromEntries(Object.entries(orphanMap('play')).sort()), Object.fromEntries(Object.entries(m.orphanPlay).sort()), name + ' orphan play');
  // totals in the ledger == totals the model says went in, per currency
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  const players = (cur) => ['bank:', 'play:', 'orphan:'].reduce((a, p) => a + l.list(p, cur).reduce((x, y) => x + y.balance, 0), 0);
  eq(players('chips'), sum(m.bank) + sum(m.orphanChips), name + ' chips total'); eq(players('play'), sum(m.play) + sum(m.orphanPlay), name + ' play total');
  eq(report.totals.chips.out, players('chips')); eq(report.totals.play.out, players('play'));
  // idempotent: same ledger again changes nothing, byte for byte, also after a reopen
  const bytes = sha(f), id = l.lastId;
  const r2 = apply(l, items); eq(r2.written, 0); eq(r2.dup, items.length); eq(l.lastId, id); eq(sha(f), bytes);
  l.close();
  const l2 = open(f); const r3 = apply(l2, items); eq(r3.written, 0); eq(sha(f), bytes, 'reopen + migrate again = no change');
  ok(!needsMigration(l2) || items.length === 0, 'needsMigration false once applied');
  l2.close();
  eq(hash(fx), before, 'inputs untouched after apply');
  return { fx, items, report, m, f };
}

for (const name of NAMES) t('fixture ' + name + ': totals, model, idempotent, inputs untouched', () => check(name));

t('fixtures on disk match the generator (so they are reproducible)', () => {
  const g = gen.all();
  for (const name of NAMES) deq(load(name), JSON.parse(JSON.stringify(g[name])), name);
  deq(NAMES, Object.keys(g).sort());
  for (const need of ['empty', 'normal', 'orphans', 'stacks', 'no-bank-row', 'no-wallet', 'bad-rows', 'big']) ok(NAMES.includes(need), need);
  eq(accountKeys(load('big').accounts).length, 500);
});

t('empty fixture writes nothing', () => {
  const { items, report } = migrate(load('empty'));
  eq(items.length, 0); eq(report.accounts, 0); ok(report.totals.chips.ok);
});

t('normal: balances land exactly, zero rows are registered, nothing minted by default', () => {
  const { f, report } = check('normal'); const l = open(f);
  eq(l.balance('bank:chris', 'chips'), 52000); eq(l.balance('bank:lee', 'chips'), 1); eq(l.balance('play:raj', 'play'), 742500); eq(l.balance('play:sam', 'play'), 9999999);
  eq(l.balance('mint:signup', 'chips'), 0, 'no default minted'); eq(l.balance('mint:migration', 'chips'), -68401);
  eq(report.zeroRows.length, 1); eq(report.zeroRows[0].key, 'sam'); eq(report.defaults.chips.length, 0);
  // sam's 0 bank row is registered: ensureAccount must not mint him 10,000, and the rollback mirror shows 0
  const svc = createService(l);
  ok(!svc.ensureAccount('sam').created); eq(l.balance('bank:sam', 'chips'), 0);
  eq(svc.mirror().bank.sam, 0);
  deq(svc.mirror().bank, { chris: 52000, raj: 6400, pia: 10000, sam: 0, lee: 1 }, 'mirror reproduces bank.json');
  deq(Object.fromEntries(Object.entries(svc.mirror().wallet)), { chris: 1000000, raj: 742500, pia: 250, sam: 9999999, lee: 1000000 }, 'mirror reproduces wallet.json');
});

t('orphans: name-keyed rows go to orphan:<name> and are listed, nothing dropped', () => {
  const { f, report } = check('orphans'); const l = open(f);
  eq(l.balance('orphan:dial-up', 'chips'), 9546); eq(l.balance('orphan:crip doe', 'chips'), 6454); eq(l.balance('orphan:Raj', 'chips'), 700);
  deq(report.orphans.map(o => o.name).sort(), ['Raj', 'crip doe', 'dial-up']);
  ok(report.orphans.every(o => o.cur === 'chips' && o.source === 'bank'));
  eq(report.zeroRows.filter(z => z.key === 'hr').length, 1, 'zero orphan row listed, no orphan account made');
  eq(l.balance('orphan:hr', 'chips'), 0);
  eq(l.balance('bank:raj', 'chips'), 10000, 'raj has no exact-key row: lazy default');
  deq(report.defaults.chips, ['raj']);
  const svc = createService(l);
  eq(svc.mirror().bank['dial-up'], 9546, 'orphans survive in the rollback file under their old name');
});

t('stacks: open stacks fold into the owner bank like today\'s boot; stranger stack is an orphan', () => {
  const { f, report } = check('stacks'); const l = open(f);
  eq(l.balance('bank:chris', 'chips'), 6000); eq(l.balance('bank:raj', 'chips'), 7900);
  eq(l.balance('bank:pia', 'chips'), 3000, 'a stack creates the row today, so no default is added');
  eq(l.balance('orphan:stranger', 'chips'), 800);
  eq(report.stacksFolded.length, 3); ok(report.orphans.some(o => o.name === 'stranger' && o.source === 'stacks'));
  eq(report.defaults.chips.length, 0);
  ok(l.has('mig:stack:all:chris') && l.has('mig:bank:chris'));
});

t('stacks-nested: { table: { key: n } } keeps the table in the ref', () => {
  const { f, report } = check('stacks-nested'); const l = open(f);
  eq(l.balance('bank:chris', 'chips'), 4000 + 2000 + 300); ok(l.has('mig:stack:POKERPING:chris') && l.has('mig:stack:T2:chris'));
  eq(l.balance('orphan:stranger', 'chips'), 5); eq(report.stacksFolded.length, 2);
});

t('account with no bank row / no wallet gets today\'s lazy default from mint:signup', () => {
  let r = check('no-bank-row'); let l = open(r.f);
  eq(l.balance('bank:newbie', 'chips'), 10000); eq(l.balance('play:newbie', 'play'), 1000000); eq(l.balance('mint:signup', 'chips'), -10000);
  deq(r.report.defaults, { chips: ['newbie'], play: [] }); eq(l.balance('mint:signup', 'play'), 0);
  ok(!createService(l).ensureAccount('newbie').created, 'signup ref shared with ensureAccount: no second mint');
  r = check('no-wallet'); l = open(r.f);
  eq(l.balance('bank:newbie', 'chips'), 12345); eq(l.balance('play:newbie', 'play'), 1000000); eq(l.balance('mint:signup', 'play'), -1000000);
  deq(r.report.defaults, { chips: [], play: ['newbie'] });
});

t('bad rows: non-integer, negative, wrong type are rejected, listed, never minted', () => {
  const { f, report } = check('bad-rows'); const l = open(f);
  const by = (src, key) => report.rejected.find(x => x.source === src && x.key === key);
  for (const [s, k] of [['bank', 'chris'], ['bank', 'raj'], ['bank', 'pia'], ['bank', 'sam'], ['bank', 'zed'], ['bank', 'big'], ['bank', 'flo'], ['wallet', 'chris'], ['wallet', 'raj'], ['wallet', 'pia'], ['wallet', 'lee'], ['stacks', 'lee'], ['stacks', 'sam']]) ok(by(s, k), s + ' ' + k + ' listed');
  eq(report.rejected.length, 13);
  eq(by('bank', 'chris').why, 'not an integer'); eq(by('bank', 'raj').why, 'negative'); eq(by('bank', 'big').why, 'not a safe integer'); eq(by('bank', 'pia').why, 'not a number');
  eq(l.balance('bank:lee', 'chips'), 700, 'the one good row on a bad-ish account');
  for (const k of ['chris', 'raj', 'pia', 'sam']) eq(l.balance('bank:' + k, 'chips'), 0, 'rejected row leaves 0 for ' + k);
  eq(l.balance('play:chris', 'play'), 0); eq(l.balance('play:lee', 'play'), 0);
  eq(report.defaults.chips.length, 0, 'a rejected row is not "missing": no free default on top');
  const svc = createService(l);
  for (const k of ['chris', 'raj', 'pia', 'sam', 'lee']) ok(!svc.ensureAccount(k).created, k);
  eq(l.balance('bank:chris', 'chips'), 0);
  ok(report.zeroRows.some(z => z.source === 'wallet' && z.key === 'sam') && report.zeroRows.some(z => z.source === 'stacks' && z.key === 'chris'));
  eq(l.balance('orphan:zed', 'chips'), 0, 'a rejected non-account row creates nothing');
});

t('big: 500 accounts, totals match, a crash half way through resumes to the same state', () => {
  const full = check('big');
  eq(full.report.accounts, 500); ok(full.report.orphans.length >= 12); ok(full.report.rejected.length > 20); ok(full.report.defaults.chips.length > 20);
  ok(full.report.stacksFolded.length > 30); ok(full.items.length > 900);
  // apply half, "crash", reopen, apply everything: identical to a clean run
  const f = tmpFile(); const l = open(f, { now: () => 1 }); apply(l, full.items.slice(0, full.items.length >> 1)); l.close();
  const l2 = open(f, { now: () => 1 }); const r = apply(l2, full.items);
  eq(r.dup, full.items.length >> 1); eq(r.written, full.items.length - (full.items.length >> 1));
  eq(sha(f), sha(full.f), 'resumed migration is byte-identical to a clean one');
});

t('inputs frozen deeply: migrate never writes to them', () => {
  const fx = deepFreeze(load('big')); migrate(fx); migrate({ bank: null, wallet: undefined, stacks: 5, accounts: null });
});

t('accounts input shapes: { version, accounts }, bare map, array', () => {
  deq(accountKeys({ version: 1, accounts: { b: { key: 'b' }, a: { key: 'a' } } }), ['a', 'b']);
  deq(accountKeys({ b: { key: 'b' }, a: {} }), ['a', 'b']);
  deq(accountKeys([{ key: 'z' }, 'y']), ['y', 'z']);
  deq(accountKeys(null), []);
});

t('needsMigration follows the mig: refs', () => {
  const l = open(tmpFile());
  ok(needsMigration(l));
  l.transfer('mint:signup', 'bank:a', 5, 'chips', 'signup', 'signup:bank:a'); ok(needsMigration(l), 'signup is not a migration');
  apply(l, migrate(load('normal')).items); ok(!needsMigration(l)); l.close();
});

t('changed inputs on a second run conflict loudly instead of double counting', () => {
  const fx = load('normal'); const f = tmpFile(); const l = open(f);
  apply(l, migrate(fx).items);
  fx.bank.chris += 1;
  const r = apply(l, migrate(fx).items);
  eq(r.written, 0); eq(r.conflicts.length, 1); eq(r.conflicts[0].ref, 'mig:bank:chris'); eq(l.balance('bank:chris', 'chips'), 52000);
});

// ---- CLI ----
const CLI = path.join(__dirname, '..', '..', 'tools', 'migrate-v2.js');
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const flags = (name) => ['bank', 'wallet', 'stacks', 'accounts'].flatMap(k => ['--' + k, path.join(FX, name, k + '.json')]);

t('CLI: writes money.jsonl, second run is a no-op, inputs byte-identical, --report written', () => {
  const out = path.join(dir, 'cli1.jsonl'); const rep = path.join(dir, 'cli1.report.json');
  const inHashes = ['bank', 'wallet', 'stacks', 'accounts'].map(k => sha(path.join(FX, 'orphans', k + '.json')));
  let r = run([...flags('orphans'), '--out', out, '--report', rep]);
  eq(r.status, 0, r.stderr); ok(/ORPHANS \(3/.test(r.stdout)); ok(/dial-up: 9546/.test(r.stdout)); ok(/OK \| play/.test(r.stdout));
  const bytes = sha(out);
  r = run([...flags('orphans'), '--out', out]); eq(r.status, 0, r.stderr); eq(sha(out), bytes, 'rerun changes nothing'); ok(/0 written/.test(r.stdout));
  const report = JSON.parse(fs.readFileSync(rep, 'utf8')); eq(report.orphans.length, 3); ok(report.totals.chips.ok); eq(report.dryRun, false);
  deq(['bank', 'wallet', 'stacks', 'accounts'].map(k => sha(path.join(FX, 'orphans', k + '.json'))), inHashes);
  const l = open(out); eq(l.balance('orphan:dial-up', 'chips'), 9546);
});

t('CLI: --dry-run writes nothing and still reports', () => {
  const out = path.join(dir, 'cli2.jsonl');
  const r = run([...flags('bad-rows'), '--out', out, '--dry-run']);
  eq(r.status, 0, r.stderr); ok(!fs.existsSync(out), 'no output file'); ok(/DRY RUN/.test(r.stdout)); ok(/REJECTED \(13/.test(r.stdout));
  const r2 = run([...flags('normal'), '--dry-run']); eq(r2.status, 0, 'dry run needs no --out');
  // dry run against an existing ledger reports what is already there and does not touch it
  const out2 = path.join(dir, 'cli2b.jsonl'); run([...flags('normal'), '--out', out2]); const b = sha(out2);
  const r3 = run([...flags('normal'), '--out', out2, '--dry-run']); eq(r3.status, 0); eq(sha(out2), b); ok(/0 written/.test(r3.stdout));
});

t('CLI: usage and input errors exit 1 without writing', () => {
  const out = path.join(dir, 'cli3.jsonl');
  let r = run(['--bank', path.join(FX, 'normal', 'bank.json'), '--out', out]); eq(r.status, 1); ok(/usage/.test(r.stderr));
  r = run([...flags('normal')]); eq(r.status, 1, '--out missing');
  r = run([...flags('normal'), '--out', out, '--bogus']); eq(r.status, 1);
  r = run(['--bank', path.join(dir, 'nope.json'), '--accounts', path.join(FX, 'normal', 'accounts.json'), '--out', out]); eq(r.status, 1); ok(/cannot read/.test(r.stderr));
  ok(!fs.existsSync(out));
  const bad = path.join(dir, 'bad.json'); fs.writeFileSync(bad, '{not json');
  r = run(['--bank', bad, '--accounts', path.join(FX, 'normal', 'accounts.json'), '--out', out]); eq(r.status, 1); ok(!fs.existsSync(out));
});

t('CLI: a conflicting second run exits 1 and leaves the ledger alone', () => {
  const d = path.join(dir, 'cli4'); fs.mkdirSync(d);
  const fx = load('normal'); const p = (k) => path.join(d, k + '.json');
  for (const k of Object.keys(fx)) fs.writeFileSync(p(k), JSON.stringify(fx[k]));
  const out = path.join(d, 'm.jsonl');
  const args = ['--bank', p('bank'), '--wallet', p('wallet'), '--stacks', p('stacks'), '--accounts', p('accounts'), '--out', out];
  eq(run(args).status, 0); const b = sha(out);
  fx.bank.raj += 5; fs.writeFileSync(p('bank'), JSON.stringify(fx.bank));
  const r = run(args); eq(r.status, 1); ok(/REF CONFLICTS/.test(r.stderr)); eq(sha(out), b);
});

t('CLI: the big fixture migrates in one go', () => {
  const out = path.join(dir, 'cli5.jsonl'); const t0 = Date.now();
  const r = run([...flags('big'), '--out', out]); eq(r.status, 0, r.stderr); ok(Date.now() - t0 < 10000, 'fast');
  const l = open(out); ok(l.check().chips.ok && l.check().play.ok);
});

try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
console.log(`migrate: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
