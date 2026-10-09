#!/usr/bin/env node
'use strict';
// tools/export-balances.js: READ-ONLY balance export. One row per account: name, key, Cash (cents), Chips, open escrow per game, seat stacks at poker tables; then totals.
// Chris reads this before a fresh start and sets each player's Cash by hand from it.
//
// Read-only, on purpose and by construction:
//  - money/ledger.js has no read-only open: open() writes <file>.lock, truncates a torn tail, renames a bad checkpoint, appends to <file>.quarantine and opens the journal for append.
//    So the data dir's journal is only ever READ here (fs.copyFileSync). The copy goes to a private mkdtemp dir OUTSIDE the data dir and the ledger's own open() replays that copy
//    (checkpoint off: a full replay of every line, the ledger's own validation and quarantine rules). The temp dir is removed at the end.
//  - accounts.json is read as plain JSON (accounts.js would repair and re-save it). Nothing under the data dir is created, renamed, truncated or written.
//  - It never starts the server, never writes a checkpoint, never touches the data dir; an output path inside the data dir is refused.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { open } = require('../money/ledger');
const boot = require('../transport/boot');

const ROOT = path.join(__dirname, '..');
const KNOWN_GAMES = ['bender', 'coldcall', 'campaign'];

const HELP = `usage: node tools/export-balances.js [--ledger money.jsonl] [--accounts accounts.json] [--csv out.csv|-] [--json out.json|-] [--tmpdir dir] [--strict]

Read-only: one row per account (name, key, Cash in cents, Chips, open escrow per game, seat stacks), then TOTAL rows. Nothing in the data dir is written.
  --ledger    the money ledger (money.jsonl). Default: the same path the server uses: MONEY_FILE, else money.jsonl next to BANK_FILE, else <DATA_DIR>/money.jsonl
              (DATA_DIR, else RAILWAY_VOLUME_MOUNT_PATH, else the repo root; transport/boot.js resolvePaths).
  --accounts  the accounts file. Default: ACCOUNTS_FILE, else accounts.json next to bank.json (same rule).
  --csv F     write the CSV to F ('-' = stdout). --json F  write the JSON to F ('-' = stdout).
              With neither flag the CSV goes to stdout. Both may be given (at most one may be '-'). An output path inside the data dir is refused.
  --tmpdir D  where the private working copy of the journal goes (default: the OS temp dir; removed at the end; never inside the data dir).
  --strict    exit 3 if the ledger quarantined any line (balances may then be short; the default is a loud warning on stderr and "quarantined" in the JSON).
Columns: cash_* = ledger currency 'play' (real money, cents); chips_* = free play. wallet = the account's own balance, escrow = open game rounds, seats = poker table stacks,
other = pots / pools / orphan rows. escrow_<cur>_<game> = open escrow per game; escrow_detail and seats_detail list every round / table.
Exit: 0 ok, 1 usage, 2 a file is missing or unreadable, 3 quarantined lines under --strict. Every error leaves the data dir untouched.`;

class Fail extends Error { constructor(code, msg) { super(msg); this.exitCode = code; } }

function parseArgs(argv) {
  const o = { csv: null, json: null, ledger: null, accounts: null, tmpdir: null, strict: false, help: false };
  const flags = { '--ledger': 'ledger', '--accounts': 'accounts', '--csv': 'csv', '--json': 'json', '--tmpdir': 'tmpdir' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--strict') o.strict = true;
    else if (flags[a]) { if (i + 1 >= argv.length || argv[i + 1] === undefined) throw new Fail(1, a + ' needs a value'); o[flags[a]] = argv[++i]; }
    else throw new Fail(1, 'unknown argument ' + a);
  }
  return o;
}

const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
// is p the same as dir or inside it (symlinks resolved on the part that exists)
function inside(p, dir) {
  const rd = real(dir);
  let q = path.resolve(p), tail = '';
  while (q !== path.dirname(q) && !fs.existsSync(q)) { tail = path.join(path.basename(q), tail); q = path.dirname(q); }
  const full = path.join(real(q), tail);
  return full === rd || full.startsWith(rd + path.sep);
}

function readAccounts(file) {
  let st;
  try { st = fs.statSync(file); } catch (e) { throw new Fail(2, `accounts file ${file}: ${e.code === 'ENOENT' ? 'does not exist' : 'cannot be read (' + e.message + ')'}`); }
  if (!st.isFile()) throw new Fail(2, `accounts file ${file}: not a regular file`);
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Fail(2, `accounts file ${file}: cannot be read as JSON (${e.message})`); }
  const m = j && typeof j === 'object' && j.accounts && typeof j.accounts === 'object' && !Array.isArray(j.accounts) ? j.accounts : null;
  if (!m) throw new Fail(2, `accounts file ${file}: no "accounts" object in it`);
  const out = new Map();
  for (const k of Object.keys(m)) { const a = m[k]; if (a && typeof a === 'object') out.set(typeof a.key === 'string' && a.key ? a.key : k, typeof a.display === 'string' ? a.display : ''); }
  return out;
}

// Replays a private copy of the journal with the ledger's own open() and returns every non-zero balance per currency, the books check and the quarantined lines.
function replayCopy(file, tmpBase, dataDirs) {
  let st;
  try { st = fs.statSync(file); } catch (e) { throw new Fail(2, `ledger ${file}: ${e.code === 'ENOENT' ? 'does not exist' : 'cannot be read (' + e.message + ')'}`); }
  if (!st.isFile()) throw new Fail(2, `ledger ${file}: not a regular file`);
  try { fs.accessSync(file, fs.constants.R_OK); } catch (e) { throw new Fail(2, `ledger ${file}: cannot be read (${e.message})`); }
  const base = tmpBase || os.tmpdir();
  for (const d of dataDirs) if (inside(base, d)) throw new Fail(1, `--tmpdir ${base} is inside the data dir ${d}: refused`);
  let work = null, ledger = null;
  try {
    work = fs.mkdtempSync(path.join(base, 'export-balances-'));
    const copy = path.join(work, 'money.jsonl');
    try { fs.copyFileSync(file, copy); } catch (e) { throw new Fail(2, `ledger ${file}: cannot be read (${e.message})`); }
    const warn = [];
    ledger = open(copy, { fsync: 'none', ckpt: false, log: (m) => warn.push(m) });
    const bal = { chips: ledger.list('', 'chips'), play: ledger.list('', 'play') };
    const check = ledger.check();
    return { bal, check, quarantined: ledger.quarantined.map(q => ({ lineNo: q.lineNo, reason: q.reason })), lastId: ledger.lastId, bytes: st.size, warn };
  } finally {
    if (ledger) try { ledger.close(); } catch {}
    if (work) try { fs.rmSync(work, { recursive: true, force: true }); } catch {}
  }
}

const CUR_LABEL = { play: 'cash', chips: 'chips' };
const PLAYER_KINDS = new Set(['bank', 'play', 'seat', 'pot', 'orphan', 'escrow', 'pool']);   // money/ledger.js PLAYER_KINDS

function build(accounts, rep) {
  const rows = new Map();
  const rowOf = (key, name, kind) => {
    if (!rows.has(key)) rows.set(key, { key, name, kind, cash: { wallet: 0, escrow: 0, seats: 0, other: 0 }, chips: { wallet: 0, escrow: 0, seats: 0, other: 0 }, escrow: {}, escrowDetail: [], seatsDetail: [] });
    return rows.get(key);
  };
  for (const [k, d] of accounts) rowOf(k, d, 'account');
  const games = new Set(KNOWN_GAMES);
  const totals = { cash: { wallet: 0, escrow: 0, seats: 0, other: 0, total: 0 }, chips: { wallet: 0, escrow: 0, seats: 0, other: 0, total: 0 } };
  const sources = { cash: {}, chips: {} };
  for (const cur of ['play', 'chips']) {
    const L = CUR_LABEL[cur];
    for (const { account, balance } of rep.bal[cur]) {
      const p = account.split(':');
      if (!PLAYER_KINDS.has(p[0])) { sources[L][account] = balance; continue; }     // mint:* / house:* / admin:adjust / fx:*: the other side of the books, not a player
      let part, key, r;
      if ((p[0] === 'play' || p[0] === 'bank') && p.length === 2) { part = 'wallet'; key = p[1]; }
      else if (p[0] === 'seat' && p.length === 3) { part = 'seats'; key = p[2]; }
      else if (p[0] === 'escrow' && p.length === 4) { part = 'escrow'; key = p[2]; }
      else { part = 'other'; key = account; }
      if (part === 'other') r = rowOf(key, '', p[0] === 'orphan' ? 'orphan' : p[0]);
      else r = rowOf(key, accounts.has(key) ? accounts.get(key) : '', accounts.has(key) ? 'account' : 'not-in-accounts-file');
      r[L][part] += balance;
      totals[L][part] += balance;
      if (part === 'escrow') { const g = p[1]; games.add(g); r.escrow[`${L}:${g}`] = (r.escrow[`${L}:${g}`] || 0) + balance; r.escrowDetail.push(`${L}/${g}/${p[3]}=${balance}`); }
      if (part === 'seats') r.seatsDetail.push(`${L}/${p[1]}=${balance}`);
    }
  }
  for (const L of ['cash', 'chips']) {
    for (const r of rows.values()) r[L].total = r[L].wallet + r[L].escrow + r[L].seats + r[L].other;
    totals[L].total = totals[L].wallet + totals[L].escrow + totals[L].seats + totals[L].other;
  }
  const list = [...rows.values()].sort((a, b) => (a.kind === 'account') === (b.kind === 'account') ? (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) : (a.kind === 'account' ? -1 : 1));
  return { rows: list, totals, sources, games: [...games].sort() };
}

const csvCell = (v) => {
  if (typeof v === 'number') return String(v);
  let s = String(v == null ? '' : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;         // a name that starts like a spreadsheet formula stays text
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

function toCsv(b) {
  const cols = ['key', 'name', 'kind', 'cash_wallet', 'cash_escrow', 'cash_seats', 'cash_other', 'cash_total', 'chips_wallet', 'chips_escrow', 'chips_seats', 'chips_other', 'chips_total'];
  for (const g of b.games) cols.push(`escrow_cash_${g}`);
  for (const g of b.games) cols.push(`escrow_chips_${g}`);
  cols.push('escrow_detail', 'seats_detail');
  const line = (vals) => vals.map(csvCell).join(',');
  const out = [cols.join(',')];
  const rowVals = (r) => {
    const v = [r.key, r.name, r.kind];
    for (const L of ['cash', 'chips']) v.push(r[L].wallet, r[L].escrow, r[L].seats, r[L].other, r[L].total);
    for (const L of ['cash', 'chips']) for (const g of b.games) v.push(r.escrow[`${L}:${g}`] || 0);
    v.push(r.escrowDetail.join(';'), r.seatsDetail.join(';'));
    return v;
  };
  for (const r of b.rows) out.push(line(rowVals(r)));
  const T = b.totals, tv = ['TOTAL', '', 'total'];
  for (const L of ['cash', 'chips']) tv.push(T[L].wallet, T[L].escrow, T[L].seats, T[L].other, T[L].total);
  for (const L of ['cash', 'chips']) for (const g of b.games) tv.push(b.rows.reduce((s, r) => s + (r.escrow[`${L}:${g}`] || 0), 0));
  tv.push('', '');
  out.push(line(tv));
  return out.join('\n') + '\n';
}

function toJson(b, meta) {
  return JSON.stringify({
    generated: meta.generated, ledger: meta.ledger, accountsFile: meta.accounts, ledgerBytes: meta.bytes, ledgerLastId: meta.lastId,
    unit: 'cash = ledger currency play, cents; chips = free play',
    quarantined: meta.quarantined, books: meta.check,
    games: b.games,
    accounts: b.rows.map(r => ({ key: r.key, name: r.name, kind: r.kind, cash: { ...r.cash }, chips: { ...r.chips }, escrow: r.escrow, escrowDetail: r.escrowDetail, seatsDetail: r.seatsDetail })),
    totals: b.totals,
    sources: b.sources,
  }, null, 1) + '\n';
}

function main(argv, io = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s + '\n'), env: process.env }) {
  let o;
  try {
    o = parseArgs(argv);
    if (o.help) { io.out(HELP + '\n'); return 0; }
    const paths = boot.resolvePaths(ROOT, io.env || process.env);
    const ledgerFile = path.resolve(o.ledger || paths.MONEY_FILE);
    const accountsFile = path.resolve(o.accounts || paths.ACCOUNTS_FILE);
    const dataDirs = [...new Set([path.dirname(ledgerFile), path.dirname(accountsFile)])];
    if (o.csv === '-' && o.json === '-') throw new Fail(1, '--csv - and --json - cannot both be stdout');
    const targets = [];
    if (o.csv == null && o.json == null) o.csv = '-';
    for (const [flag, p] of [['--csv', o.csv], ['--json', o.json]]) {
      if (p == null || p === '-') continue;
      for (const d of dataDirs) if (inside(path.resolve(p), d)) throw new Fail(1, `${flag} ${p} is inside the data dir ${d}: refused (this tool writes nothing there)`);
      for (const f of [ledgerFile, accountsFile]) if (real(p) === real(f)) throw new Fail(1, `${flag} ${p} is an input file: refused`);
      targets.push(p);
    }
    const accounts = readAccounts(accountsFile);
    const rep = replayCopy(ledgerFile, o.tmpdir, dataDirs);
    const b = build(accounts, rep);
    if (rep.quarantined.length) io.err(`WARNING: the ledger quarantined ${rep.quarantined.length} line(s) at replay (${rep.quarantined.slice(0, 3).map(q => `line ${q.lineNo}: ${q.reason}`).join('; ')}). They are NOT in these balances: ask for an admin look before you rely on them.`);
    if (!rep.check.chips.ok || !rep.check.play.ok) io.err('WARNING: the books do not balance (see "books" in the JSON).');
    const meta = { generated: new Date().toISOString(), ledger: ledgerFile, accounts: accountsFile, bytes: rep.bytes, lastId: rep.lastId, quarantined: rep.quarantined, check: rep.check };
    const csv = toCsv(b), json = toJson(b, meta);
    if (o.csv === '-') io.out(csv); else if (o.csv != null) fs.writeFileSync(o.csv, csv);
    if (o.json === '-') io.out(json); else if (o.json != null) fs.writeFileSync(o.json, json);
    const T = b.totals;
    io.err(`export: ${b.rows.filter(r => r.kind === 'account').length} accounts, ledger id ${rep.lastId}; Cash total ${T.cash.total} cents (wallets ${T.cash.wallet}, escrow ${T.cash.escrow}, seats ${T.cash.seats}), Chips total ${T.chips.total}`);
    return o.strict && rep.quarantined.length ? 3 : 0;
  } catch (e) {
    if (e instanceof Fail) { io.err('export-balances: ' + e.message); if (e.exitCode === 1) io.err('try --help'); return e.exitCode; }
    io.err('export-balances: ' + (e && e.message ? e.message : e));
    return 2;
  }
}

module.exports = { main, build, toCsv, toJson, readAccounts, replayCopy };
if (require.main === module) process.exit(main(process.argv.slice(2)));
