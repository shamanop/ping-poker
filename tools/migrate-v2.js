#!/usr/bin/env node
'use strict';
// tools/migrate-v2.js: bank.json + wallet.json + stacks.json + accounts.json -> money.jsonl (V2-DESIGN.md "Migration").
// migrate() is pure and never touches its inputs. Every write has a ref, so applying it twice is a no-op.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { open, MoneyError } = require('../money/ledger');

const START_CHIPS = 10000;     // server.js BANK_DEFAULT: what an account with no bank row gets on first touch today
const START_PLAY = 1000000;    // wallet.js START_PLAY

const isInt = (n) => typeof n === 'number' && Number.isSafeInteger(n);
const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);

// accounts.json is { version, accounts: { key: {...} } }; also accept a bare key->account map or an array.
function accountKeys(accounts) {
  let m = accounts;
  if (isObj(m) && isObj(m.accounts) && ('version' in m || Object.keys(m).length === 1)) m = m.accounts;
  if (Array.isArray(m)) return m.map(a => (typeof a === 'string' ? a : a && a.key)).filter(k => typeof k === 'string' && k).sort();
  if (!isObj(m)) return [];
  return Object.keys(m).map(k => (isObj(m[k]) && typeof m[k].key === 'string' && m[k].key ? m[k].key : k)).sort();
}

// wallet row: { play } or a bare number
const walletValue = (row) => (isObj(row) ? row.play : row);

function why(v) {
  if (typeof v !== 'number') return 'not a number';
  if (!Number.isFinite(v)) return 'not finite';
  if (!Number.isInteger(v)) return 'not an integer';
  if (!Number.isSafeInteger(v)) return 'not a safe integer';
  return 'negative';
}

function migrate(inputs) {
  const { bank = {}, wallet = {}, stacks = {}, accounts = {} } = inputs || {};
  const keys = accountKeys(accounts);
  const isAccount = new Set(keys);
  const items = [];
  const report = {
    accounts: keys.length,
    orphans: [],    // { source, name, cur, amount }
    zeroRows: [],   // { source, key }
    rejected: [],   // { source, key, value, why }
    stacksFolded: [],
    defaults: { chips: [], play: [] },
    totals: null,
  };
  const inn = { chips: 0, play: 0 };
  const want = (source, key, v) => {
    if (isInt(v) && v >= 0) return true;
    report.rejected.push({ source, key, value: isObj(v) || Array.isArray(v) ? JSON.stringify(v) : v, why: why(v) });
    return false;
  };
  const mint = (to, amount, cur, ref, from = 'mint:migration', reason = 'migration') => {
    items.push({ from, to, amount, cur, reason, ref });
    inn[cur] += amount;
  };
  // An account whose row is zero or unusable still has to exist in the ledger: otherwise the old server (rollback)
  // or ensureAccount would hand it the 10,000 default. A zero-net batch registers it without moving any value.
  const mark = (account, cur, ref) => items.push({
    batch: [{ from: 'mint:migration', to: account, amount: 1, cur }, { from: account, to: 'mint:migration', amount: 1, cur }],
    ref, reason: 'migration-mark',
  });

  const hasBank = new Set();       // account keys whose bank row exists (valid or not), counting stacks like today's boot
  const hasWallet = new Set();

  // bank rows
  for (const name of Object.keys(isObj(bank) ? bank : {})) {
    const v = bank[name];
    const acc = isAccount.has(name);
    if (acc) hasBank.add(name);
    if (!want('bank', name, v)) { if (acc) mark('bank:' + name, 'chips', 'mig:bank:' + name); continue; }
    if (v === 0) { report.zeroRows.push({ source: 'bank', key: name }); if (acc) mark('bank:' + name, 'chips', 'mig:bank:' + name); continue; }
    if (acc) mint('bank:' + name, v, 'chips', 'mig:bank:' + name);
    else { mint('orphan:' + name, v, 'chips', 'mig:orphan:chips:' + name); report.orphans.push({ source: 'bank', name, cur: 'chips', amount: v }); }
  }

  // open stacks: folded into the owner's bank, which is what the old boot does. Flat { key: n } or { table: { key: n } }.
  const stackRows = [];
  for (const k of Object.keys(isObj(stacks) ? stacks : {})) {
    if (isObj(stacks[k])) for (const kk of Object.keys(stacks[k])) stackRows.push([k, kk, stacks[k][kk]]);
    else stackRows.push(['all', k, stacks[k]]);
  }
  for (const [table, name, v] of stackRows) {
    const acc = isAccount.has(name);
    if (!want('stacks', name, v)) continue;
    if (v === 0) { report.zeroRows.push({ source: 'stacks', key: name }); continue; }
    if (acc) {
      hasBank.add(name);
      mint('bank:' + name, v, 'chips', `mig:stack:${table}:${name}`);
      report.stacksFolded.push({ table, key: name, amount: v });
    } else {
      mint('orphan:' + name, v, 'chips', `mig:orphan:stack:${table}:${name}`);
      report.orphans.push({ source: 'stacks', name, cur: 'chips', amount: v });
    }
  }

  // wallet rows
  for (const name of Object.keys(isObj(wallet) ? wallet : {})) {
    const v = walletValue(wallet[name]);
    const acc = isAccount.has(name);
    if (acc) hasWallet.add(name);
    if (!want('wallet', name, v)) { if (acc) mark('play:' + name, 'play', 'mig:play:' + name); continue; }
    if (v === 0) { report.zeroRows.push({ source: 'wallet', key: name }); if (acc) mark('play:' + name, 'play', 'mig:play:' + name); continue; }
    if (acc) mint('play:' + name, v, 'play', 'mig:play:' + name);
    else { mint('orphan:' + name, v, 'play', 'mig:orphan:play:' + name); report.orphans.push({ source: 'wallet', name, cur: 'play', amount: v }); }
  }

  // today's lazy defaults, so nobody's balance changes on first touch. Same refs as service.ensureAccount.
  for (const k of keys) {
    if (!hasBank.has(k)) { mint('bank:' + k, START_CHIPS, 'chips', 'signup:bank:' + k, 'mint:signup', 'signup'); report.defaults.chips.push(k); }
    if (!hasWallet.has(k)) { mint('play:' + k, START_PLAY, 'play', 'signup:play:' + k, 'mint:signup', 'signup'); report.defaults.play.push(k); }
  }

  // totals in vs out per currency: what the inputs account for vs what the items put into player accounts
  const out = { chips: 0, play: 0 };
  const playerAcct = (a) => /^(bank|play|seat|pot|orphan):/.test(a);
  for (const it of items) {
    const legs = it.batch || [it];
    for (const l of legs) { if (playerAcct(l.to)) out[l.cur] += l.amount; if (playerAcct(l.from)) out[l.cur] -= l.amount; }
  }
  report.totals = {
    chips: { in: inn.chips, out: out.chips, ok: inn.chips === out.chips },
    play: { in: inn.play, out: out.play, ok: inn.play === out.play },
  };
  report.items = items.length;
  return { items, report };
}

// Writes items into a ledger. Idempotent: a ref that already exists with the same content is skipped.
function apply(ledger, items) {
  const r = { written: 0, dup: 0, conflicts: [] };
  for (const it of items) {
    try {
      const res = it.batch ? ledger.batch(it.batch, it.ref, it.reason) : ledger.transfer(it.from, it.to, it.amount, it.cur, it.reason, it.ref);
      if (res.dup) r.dup++; else r.written++;
    } catch (e) {
      if (e instanceof MoneyError && e.code === 'ref_conflict') r.conflicts.push({ ref: it.ref, id: e.details.id });
      else throw e;
    }
  }
  return r;
}

// Boot rule from the contract: migrate when the ledger has no mig: refs yet.
function needsMigration(ledger) {
  for (const _ of ledger.entries(e => e.ref.startsWith('mig:'))) return false;
  return true;
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function parseArgs(argv) {
  const o = { dry: false };
  const flags = { '--bank': 'bank', '--wallet': 'wallet', '--stacks': 'stacks', '--accounts': 'accounts', '--out': 'out', '--report': 'report' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') o.dry = true;
    else if (flags[a]) { if (i + 1 >= argv.length) throw new Error(a + ' needs a value'); o[flags[a]] = argv[++i]; }
    else throw new Error('unknown argument ' + a);
  }
  if (!o.bank || !o.accounts) throw new Error('--bank and --accounts are required');
  if (!o.out && !o.dry) throw new Error('--out is required (or --dry-run)');
  return o;
}

function main(argv, io = { log: console.log, err: console.error }) {
  let o;
  try { o = parseArgs(argv); } catch (e) {
    io.err(e.message);
    io.err('usage: node tools/migrate-v2.js --bank b.json --wallet w.json --stacks s.json --accounts a.json --out money.jsonl [--dry-run] [--report r.json]');
    return 1;
  }
  const inputs = {};
  try {
    for (const k of ['bank', 'wallet', 'stacks', 'accounts']) inputs[k] = o[k] ? readJson(o[k]) : {};
  } catch (e) { io.err('cannot read input: ' + e.message); return 1; }

  const { items, report } = migrate(inputs);
  let target = o.out, tmpDir = null;
  if (o.dry) { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-dry-')); target = path.join(tmpDir, 'money.jsonl'); if (o.out && fs.existsSync(o.out)) fs.copyFileSync(o.out, target); }
  let res, check;
  const ledger = open(target);
  try {
    res = apply(ledger, items);
    check = ledger.check();
  } finally { ledger.close(); if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); }

  const ok = report.totals.chips.ok && report.totals.play.ok && check.chips.ok && check.play.ok && res.conflicts.length === 0;
  const full = { ...report, apply: res, books: check, dryRun: o.dry, out: o.out || null };
  if (o.report) fs.writeFileSync(o.report, JSON.stringify(full, null, 1) + '\n');
  const t = report.totals;
  io.log(`${o.dry ? 'DRY RUN: ' : ''}${report.accounts} accounts, ${report.items} writes: ${res.written} written, ${res.dup} already there`);
  io.log(`chips in ${t.chips.in} out ${t.chips.out} ${t.chips.ok ? 'OK' : 'MISMATCH'} | play in ${t.play.in} out ${t.play.out} ${t.play.ok ? 'OK' : 'MISMATCH'} | books ${check.chips.ok && check.play.ok ? 'balance' : 'DO NOT BALANCE'}`);
  io.log(`defaults minted: ${report.defaults.chips.length} bank, ${report.defaults.play.length} wallet; stacks folded: ${report.stacksFolded.length}; zero rows: ${report.zeroRows.length}`);
  if (report.orphans.length) { io.log(`ORPHANS (${report.orphans.length}, held under orphan:<name>, for Chris to assign):`); for (const x of report.orphans) io.log(`  ${x.name}: ${x.amount} ${x.cur} (${x.source})`); }
  if (report.rejected.length) { io.log(`REJECTED (${report.rejected.length}, not migrated, account left at 0 for you to fix):`); for (const x of report.rejected) io.log(`  ${x.source} ${x.key}: ${JSON.stringify(x.value)} (${x.why})`); }
  if (res.conflicts.length) { io.err(`REF CONFLICTS (${res.conflicts.length}): the ledger already has these refs with other numbers, inputs changed since the last run:`); for (const c of res.conflicts.slice(0, 20)) io.err('  ' + c.ref); }
  return ok ? 0 : 1;
}

module.exports = { migrate, apply, needsMigration, accountKeys, main, START_CHIPS, START_PLAY };
if (require.main === module) process.exit(main(process.argv.slice(2)));
