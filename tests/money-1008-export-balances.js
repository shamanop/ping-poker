'use strict';
// Money 1008 fresh start: tools/export-balances.js is READ-ONLY and its numbers are the ledger's.
// A data dir is built in-process (real ledger + service + admin; the ledger stays OPEN, like a running server, and carries a checkpoint; a copy of the dir gets a torn tail), the tool is run on it,
// and the test checks: per-account numbers = what the ledger says, totals = the ledger sum per currency, every byte / name / mtime of the data dir unchanged, the ledger still
// writable after the run (the tool did not steal its lock), and a clear non-zero exit on a missing or unreadable file with nothing written.
// EXPORT_TOOL=<path> points the test at another copy of the tool (the mutation checks). Plain node: exit 0 on pass, 1 on fail.
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { spawnSync } = require('child_process');
const { open } = require('../money/ledger');
const { createService } = require('../money/service');
const { createAdmin } = require('../admin');

const TOOL = path.resolve(process.env.EXPORT_TOOL || path.join(__dirname, '..', 'tools', 'export-balances.js'));
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.message)); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'eq') + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); };

const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'exp-bal-'));
process.on('exit', () => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });
const data = path.join(root, 'data'), out = path.join(root, 'out'), work = path.join(root, 'work');
for (const d of [data, out, work]) fs.mkdirSync(d);

// ---- the data dir ----
const accountsFile = path.join(data, 'accounts.json'), moneyFile = path.join(data, 'money.jsonl');
const names = { ann: 'Ann', bob: 'Bob "B" Smith', cy: '=Cy', dee: 'Dee, Jr', eve: 'Eve' };   // quotes / comma / a leading '=' exercise the CSV
fs.writeFileSync(accountsFile, JSON.stringify({ version: 1, accounts: Object.fromEntries(Object.entries(names).map(([k, d]) => [k, { key: k, display: d, pinHash: 'x', salt: 'y', claimed: true }])) }));
const ledger = open(moneyFile, { fsync: 'none', log: () => {} });
const service = createService(ledger, { signupPlay: 0 });
for (const k of Object.keys(names)) service.ensureAccount(k);                       // 10000 Chips each, 0 Cash
const accountsApi = { get: k => (names[k] ? { key: k } : null), all: () => ({}) };
const adm = createAdmin({ service, ledger, accounts: accountsApi, registry: { tables: new Map() }, views: {}, onlineKeys: () => new Set() });
const must = (r, m) => { if (!r || r.ok === false) throw new Error(m + ' failed: ' + JSON.stringify(r)); };
must(adm.setPlay('ann', 250000, 'o1'), 'set ann'); must(adm.setPlay('bob', 123456, 'o2'), 'set bob'); must(adm.setPlay('cy', 5, 'o3'), 'set cy'); must(adm.setPlay('dee', 700000, 'o4'), 'set dee');
must(adm.adjust('eve', 777, 'chips', 'gift', 'o5'), 'chips eve');
service.buyIn('ann', 'T1', 30000, 'play', null, 'buy-ann');                         // Cash seat stack at table T1
service.buyIn('bob', 'T2', 2500, 'chips', null, 'buy-bob');                         // Chips seat stack at T2
service.openRound('campaign', 'ann', 'play', 'rnd1', 20000);                        // open Cash escrow, Campaign
service.openRound('bender', 'dee', 'play', 'rnd2', 1100);                           // open Cash escrow, Bender
service.openRound('coldcall', 'bob', 'chips', 'rnd3', 400);                         // open Chips escrow, Cold Call
service.openRound('campaign', 'ann', 'chips', 'rnd4', 300);                         // a second escrow of Ann's, Chips
ledger.checkpoint();                                                                // a checkpoint file beside the journal
fs.writeFileSync(moneyFile + '.quarantine', 'pre-existing\n');
fs.writeFileSync(path.join(data, 'bank.json'), '{"ann":1}');

// ---- what the ledger says (independent of the tool) ----
const expect = {};
for (const k of Object.keys(names)) {
  const b = service.balances(k);
  expect[k] = { cash: { wallet: b.play, escrow: b.inRound.play, seats: b.atTable.play }, chips: { wallet: b.chips, escrow: b.inRound.chips, seats: b.atTable.chips } };
}
const sumCur = (cur) => ledger.list('', cur).filter(x => !/^(house|mint|admin|fx):/.test(x.account)).reduce((s, x) => s + x.balance, 0);

// ---- hashing the data dir ----
const snap = (dir) => {
  const o = {};
  const walk = (d, rel) => { for (const n of fs.readdirSync(d).sort()) { const p = path.join(d, n), r = path.join(rel, n), st = fs.statSync(p); if (st.isDirectory()) walk(p, r); else o[r] = { sha: crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'), size: st.size, mtime: st.mtimeMs }; } };
  walk(dir, ''); return o;
};
const run = (args, env) => spawnSync('node', [TOOL, ...args], { encoding: 'utf8', env: { ...process.env, DATA_DIR: '', MONEY_FILE: '', ACCOUNTS_FILE: '', BANK_FILE: '', ...(env || {}) }, maxBuffer: 1 << 26 });
const sameSnap = (a, b) => eq(Object.entries(b).map(([k, v]) => [k, v.sha, v.size, v.mtime]), Object.entries(a).map(([k, v]) => [k, v.sha, v.size, v.mtime]), 'data dir files (name, sha256, size, mtime)');
const csvRows = (text) => {   // minimal RFC-4180 reader
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  return rows;
};

const before = snap(data);
const csvOut = path.join(out, 'bal.csv'), jsonOut = path.join(out, 'bal.json');
const r1 = run(['--ledger', moneyFile, '--accounts', accountsFile, '--csv', csvOut, '--json', jsonOut, '--tmpdir', work]);
const after1 = snap(data);

t('the tool exits 0 and prints a one-line summary', () => { eq(r1.status, 0, 'exit (stderr: ' + (r1.stderr || '').slice(-300) + ')'); if (!/^export: 5 accounts/m.test(r1.stderr)) throw new Error('summary missing: ' + r1.stderr); });
const J = fs.existsSync(jsonOut) ? JSON.parse(fs.readFileSync(jsonOut, 'utf8')) : null;
const C = fs.existsSync(csvOut) ? csvRows(fs.readFileSync(csvOut, 'utf8')) : null;
const jrow = (k) => J.accounts.find(a => a.key === k);

t('JSON: every account\'s Cash and Chips (wallet, escrow, seats) equal the ledger\'s', () => {
  for (const k of Object.keys(names)) { const a = jrow(k); eq([a.cash.wallet, a.cash.escrow, a.cash.seats, a.chips.wallet, a.chips.escrow, a.chips.seats], [expect[k].cash.wallet, expect[k].cash.escrow, expect[k].cash.seats, expect[k].chips.wallet, expect[k].chips.escrow, expect[k].chips.seats], k); eq(a.name, names[k], k + ' name'); }
});
t('JSON: the numbers are the ones the setup made (not just self-consistent)', () => {
  eq([jrow('ann').cash.wallet, jrow('ann').cash.seats, jrow('ann').cash.escrow, jrow('ann').cash.total], [200000, 30000, 20000, 250000]);
  eq([jrow('bob').cash.wallet, jrow('bob').chips.seats, jrow('bob').chips.escrow, jrow('bob').chips.wallet], [123456, 2500, 400, 10000 - 2500 - 400]);
  eq([jrow('dee').cash.wallet, jrow('dee').cash.escrow], [698900, 1100]); eq(jrow('cy').cash.total, 5); eq(jrow('eve').chips.wallet, 10777); eq(jrow('eve').cash.total, 0);
});
t('JSON: open escrow is listed per game and per currency, seat stacks per table', () => {
  eq(jrow('ann').escrow, { 'cash:campaign': 20000, 'chips:campaign': 300 }); eq(jrow('dee').escrow, { 'cash:bender': 1100 }); eq(jrow('bob').escrow, { 'chips:coldcall': 400 });
  eq(jrow('ann').seatsDetail, ['cash/T1=30000']); eq(jrow('bob').seatsDetail, ['chips/T2=2500']);
  eq(jrow('ann').escrowDetail.sort(), ['cash/campaign/rnd1=20000', 'chips/campaign/rnd4=300']);
});
t('totals equal the ledger sum per currency (player-side accounts)', () => {
  eq(J.totals.cash.total, sumCur('play'), 'Cash total'); eq(J.totals.chips.total, sumCur('chips'), 'Chips total');
  eq(J.accounts.reduce((s, a) => s + a.cash.total, 0), J.totals.cash.total, 'rows add to the Cash total'); eq(J.accounts.reduce((s, a) => s + a.chips.total, 0), J.totals.chips.total, 'rows add to the Chips total');
  eq(J.totals.cash.total, 250000 + 123456 + 5 + 700000, 'Cash set by the admin, to the cent');
  eq(J.totals.cash.escrow, 21100); eq(J.totals.cash.seats, 30000); eq(J.totals.chips.seats, 2500); eq(J.totals.chips.escrow, 700);
  eq([J.books.play.ok, J.books.chips.ok], [true, true]);
});
t('CSV: header, one row per account, a TOTAL row; cells match the JSON; awkward names survive', () => {
  if (!C) throw new Error('no csv'); const h = C[0];
  const col = (n) => { const i = h.indexOf(n); if (i < 0) throw new Error('column ' + n + ' missing in ' + h.join('|')); return i; };
  eq(C.filter(r => r.length > 1).length, 1 + 5 + 1, 'header + 5 accounts + TOTAL');
  for (const k of Object.keys(names)) {
    const r = C.find(x => x[0] === k); if (!r) throw new Error('row ' + k + ' missing');
    eq([+r[col('cash_wallet')], +r[col('cash_escrow')], +r[col('cash_seats')], +r[col('cash_total')], +r[col('chips_wallet')], +r[col('chips_total')]], [jrow(k).cash.wallet, jrow(k).cash.escrow, jrow(k).cash.seats, jrow(k).cash.total, jrow(k).chips.wallet, jrow(k).chips.total], k);
  }
  eq(C.find(x => x[0] === 'bob')[1], 'Bob "B" Smith'); eq(C.find(x => x[0] === 'dee')[1], 'Dee, Jr'); eq(C.find(x => x[0] === 'cy')[1], "'=Cy", 'a leading = is kept as text');
  const tot = C.find(x => x[0] === 'TOTAL'); eq([+tot[col('cash_total')], +tot[col('chips_total')]], [J.totals.cash.total, J.totals.chips.total]);
  eq(+C.find(x => x[0] === 'ann')[col('escrow_cash_campaign')], 20000); eq(+C.find(x => x[0] === 'dee')[col('escrow_cash_bender')], 1100); eq(+C.find(x => x[0] === 'bob')[col('escrow_chips_coldcall')], 400);
  eq(C.find(x => x[0] === 'ann')[col('seats_detail')], 'cash/T1=30000');
});
t('read-only: every file of the data dir (name, sha256, size, mtime) is unchanged, no file added (no .lock, .ckpt.bad, .quarantine write)', () => { sameSnap(before, after1); });
t('the live ledger is still writable after the run: the tool took no lock from it and changed no byte under it', () => {
  let err = null; try { ledger.transfer('mint:topup', 'bank:eve', 1, 'chips', 'after', 'after-export'); } catch (e) { err = e; }
  if (err) throw new Error('the live writer was refused: ' + (err.code || err.message));
  eq(ledger.balance('bank:eve', 'chips'), 10778);
});
t('torn tail: on a copy of the dir whose journal ends in half a line, the tool exports the whole lines and leaves the half line (ledger.open would truncate it)', () => {
  const d2 = path.join(root, 'data2'); fs.mkdirSync(d2);
  for (const f of ['accounts.json', 'money.jsonl']) fs.copyFileSync(path.join(data, f), path.join(d2, f));
  const tail = '{"id":99999,"from":"mint:top'; fs.appendFileSync(path.join(d2, 'money.jsonl'), tail);
  const s = snap(d2), r = run(['--ledger', path.join(d2, 'money.jsonl'), '--accounts', path.join(d2, 'accounts.json'), '--json', '-', '--tmpdir', work]);
  eq(r.status, 0, 'exit ' + r.stderr.slice(-200)); const j = JSON.parse(r.stdout); eq(j.totals.cash.total, 1073461 );
  sameSnap(s, snap(d2)); if (!fs.readFileSync(path.join(d2, 'money.jsonl'), 'utf8').endsWith(tail)) throw new Error('journal tail changed');
});

// ---- more shapes ----
let beforeSnap = snap(data);
const r2 = run(['--ledger', moneyFile, '--accounts', accountsFile, '--json', '-']);
t('default output goes to stdout only; --json - prints parseable JSON, nothing written in the data dir', () => { eq(r2.status, 0, 'exit'); JSON.parse(r2.stdout); sameSnap(beforeSnap, snap(data)); });
const r3 = run([], { MONEY_FILE: moneyFile, ACCOUNTS_FILE: accountsFile });
t('env fallbacks (MONEY_FILE, ACCOUNTS_FILE): the CSV goes to stdout', () => { eq(r3.status, 0, 'exit'); if (!/^key,name,kind,cash_wallet/.test(r3.stdout) || !/^TOTAL,/m.test(r3.stdout)) throw new Error('no csv on stdout: ' + r3.stdout.slice(0, 200)); sameSnap(beforeSnap, snap(data)); });
const r3b = run([], { DATA_DIR: data });
t('env fallback DATA_DIR: money.jsonl and accounts.json in that dir', () => { eq(r3b.status, 0, 'exit ' + r3b.stderr.slice(-200)); if (!/^TOTAL,/m.test(r3b.stdout)) throw new Error('no total'); sameSnap(beforeSnap, snap(data)); });
t('an output path inside the data dir is refused, exit non-zero, nothing written', () => {
  const r = run(['--ledger', moneyFile, '--accounts', accountsFile, '--csv', path.join(data, 'x.csv')]);
  if (r.status === 0) throw new Error('exit 0'); if (!/inside the data dir/.test(r.stderr)) throw new Error('message: ' + r.stderr); sameSnap(beforeSnap, snap(data)); if (fs.existsSync(path.join(data, 'x.csv'))) throw new Error('file written');
  const r2b = run(['--ledger', moneyFile, '--accounts', accountsFile, '--json', moneyFile]); if (r2b.status === 0) throw new Error('overwrote the ledger'); sameSnap(beforeSnap, snap(data));
});
t('a --tmpdir inside the data dir is refused', () => { const r = run(['--ledger', moneyFile, '--accounts', accountsFile, '--tmpdir', data]); if (r.status === 0 || !/inside the data dir/.test(r.stderr)) throw new Error('got ' + r.status + ' ' + r.stderr); sameSnap(beforeSnap, snap(data)); });
t('no working copy is left behind in --tmpdir', () => { eq(fs.readdirSync(work), []); });

const missing = path.join(data, 'nope.jsonl'), missingAcc = path.join(data, 'nope.json');
const guard = (label, args, re) => t(label, () => {
  const s = snap(data), r = run(args);
  if (r.status === 0) throw new Error('exit 0'); if (r.status === 1) throw new Error('usage exit, not a file error: ' + r.stderr); if (!re.test(r.stderr)) throw new Error('unclear message: ' + JSON.stringify(r.stderr.slice(0, 300)));
  eq(r.stdout, '', 'nothing on stdout'); sameSnap(s, snap(data));
});
guard('missing ledger: exit 2, names the file, writes nothing (open() would have created an empty one)', ['--ledger', missing, '--accounts', accountsFile], /nope\.jsonl: does not exist/);
guard('missing accounts file: exit 2, names the file, writes nothing', ['--ledger', moneyFile, '--accounts', missingAcc], /nope\.json: does not exist/);
const bad = path.join(root, 'bad.json'); fs.writeFileSync(bad, '{"accounts":{"a":');
guard('accounts file that is not JSON: exit 2, clear message', ['--ledger', moneyFile, '--accounts', bad], /cannot be read as JSON/);
fs.writeFileSync(path.join(root, 'noacc.json'), '{"x":1}');
guard('accounts file without an accounts object: exit 2', ['--ledger', moneyFile, '--accounts', path.join(root, 'noacc.json')], /no "accounts" object/);
guard('a directory where the ledger should be: exit 2', ['--ledger', data, '--accounts', accountsFile], /not a regular file/);
t('unknown flag: exit 1 with usage, nothing written', () => { const r = run(['--wat']); eq(r.status, 1); if (!/unknown argument/.test(r.stderr)) throw new Error(r.stderr); });
t('unreadable ledger (mode 000): exit 2, message, nothing written (skipped as root)', () => {
  if (process.getuid && process.getuid() === 0) return;
  const f = path.join(root, 'locked.jsonl'); fs.writeFileSync(f, ''); fs.chmodSync(f, 0);
  const r = run(['--ledger', f, '--accounts', accountsFile]); fs.chmodSync(f, 0o600);
  if (r.status !== 2 || !/cannot be read/.test(r.stderr)) throw new Error(r.status + ' ' + r.stderr);
});
t('an EMPTY ledger (the zero start) exports every account at 0 and exits 0', () => {
  const e = path.join(root, 'empty.jsonl'); fs.writeFileSync(e, ''); const s = snap(root);
  const r = run(['--ledger', e, '--accounts', accountsFile, '--json', '-']); eq(r.status, 0, 'exit'); const j = JSON.parse(r.stdout);
  eq([j.totals.cash.total, j.totals.chips.total, j.accounts.length], [0, 0, 5]); eq(snap(root), s, 'nothing written next to it');
});

t('--expect-zero: exit 4 and names the accounts on a ledger with money; 0 on the empty ledger (cash and all)', () => {
  const s = snap(data), r = run(['--ledger', moneyFile, '--accounts', accountsFile, '--csv', '-', '--expect-zero', 'cash']);
  eq(r.status, 4, 'exit'); if (!/NOT ZERO: .*ann cash=250000/.test(r.stderr)) throw new Error(r.stderr.slice(-300)); sameSnap(s, snap(data));
  const e = path.join(root, 'empty2.jsonl'); fs.writeFileSync(e, '');
  const z = run(['--ledger', e, '--accounts', accountsFile, '--csv', '-', '--expect-zero']); eq(z.status, 0, 'empty ledger'); if (!/expect-zero \(all\): OK, 5 account row/.test(z.stderr)) throw new Error(z.stderr);
  const c = run(['--ledger', moneyFile, '--accounts', accountsFile, '--csv', '-', '--expect-zero', 'chips']); eq(c.status, 4, 'chips are not zero either');
});

console.log(`${pass} passed, ${fail} failed`);
try { ledger.close(); } catch {}
process.exit(fail ? 1 : 0);
