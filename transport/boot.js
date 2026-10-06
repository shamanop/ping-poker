'use strict';
// Boot helpers for server.js (contract section 9): paths, the FRESH_START_ID one-shot, first-boot seed copy, legacy import,
// v2 migration, and the write-only bank.json / wallet.json mirror. Nothing here has a side effect on require.

const fs = require('fs');
const path = require('path');

const readJson = (file, dflt) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return dflt; } };

function resolvePaths(root, env) {
  const DATA_DIR = env.DATA_DIR || env.RAILWAY_VOLUME_MOUNT_PATH || root;
  const BANK_FILE = env.BANK_FILE || path.join(DATA_DIR, 'bank.json');
  const near = (name, v) => v || path.join(path.dirname(BANK_FILE), name);
  return {
    root, DATA_DIR, BANK_FILE,
    MONEY_FILE: near('money.jsonl', env.MONEY_FILE), // next to bank.json, so a test that moves only BANK_FILE never writes money.jsonl into the repo root
    STACKS_FILE: near('stacks.json', env.STACKS_FILE), LEDGER_FILE: env.LEDGER_FILE || path.join(DATA_DIR, 'ledger.json'),
    ACCOUNTS_FILE: near('accounts.json', env.ACCOUNTS_FILE), TABLES_FILE: near('tables.json', env.TABLES_FILE),
    WALLET_FILE: near('wallet.json', env.WALLET_FILE), BIGWINS_FILE: near('bigwins.json', env.BIGWINS_FILE),
  };
}

// One-shot fresh start (marker file stops repeats) and the first-boot seed copy of bank.json (never overwrites existing data).
function prepareDataDir(p, env, log) {
  if (env.FRESH_START_ID && path.resolve(p.DATA_DIR) !== path.resolve(p.root)) {
    try {
      const id = String(env.FRESH_START_ID).replace(/[^\w.-]/g, '');
      const marker = path.join(p.DATA_DIR, `.fresh-${id}`);
      if (id && !fs.existsSync(marker)) {
        const bak = path.join(p.DATA_DIR, `backup-${id}`);
        fs.mkdirSync(bak, { recursive: true });
        for (const f of fs.readdirSync(p.DATA_DIR)) {
          const src = path.join(p.DATA_DIR, f);
          if (f.startsWith('backup-') || f.startsWith('.fresh-') || f === 'lost+found' || !fs.statSync(src).isFile()) continue;
          fs.renameSync(src, path.join(bak, f));
        }
        fs.writeFileSync(path.join(p.DATA_DIR, 'bank.json'), '{}');
        fs.writeFileSync(marker, new Date().toISOString());
        log(`fresh start ${id}: old data moved to ${bak}`);
      }
    } catch (e) { console.error('fresh start failed:', e.message); }
  }
  if (path.resolve(p.DATA_DIR) !== path.resolve(p.root)) {
    try { fs.mkdirSync(p.DATA_DIR, { recursive: true }); } catch {}
    if (!env.BANK_FILE) {
      try { if (!fs.existsSync(p.BANK_FILE) && fs.existsSync(path.join(p.root, 'bank.json'))) fs.copyFileSync(path.join(p.root, 'bank.json'), p.BANK_FILE); } catch {}
    }
  }
  // 9440541 behaviour kept: one-time safety copies of bank.json and ledger.json before the first run that creates accounts.json.
  if (!fs.existsSync(p.ACCOUNTS_FILE)) {
    const stamp = Date.now();
    for (const f of [p.BANK_FILE, p.LEDGER_FILE]) { try { if (fs.existsSync(f) && !fs.existsSync(`${f}.bak-${stamp}`)) fs.copyFileSync(f, `${f}.bak-${stamp}`); } catch {} }
  }
}

// Step 4 of the boot order. The four old stores are copied ONCE to <name>.pre-v2 (never overwritten; a missing store becomes '{}', so the
// copies also mark "v2 has booted here"). The migration always runs from those copies and is idempotent by mig: refs: a crash half way is
// completed by the next boot, and later boots add nothing. (V2-DESIGN says "migrate when the ledger has no mig: refs"; that rule re-runs
// from a mirror that already holds v2 money when the first boot had no accounts, so the copies are the marker instead. See PROGRESS.)
function migrateIfNeeded({ ledger, paths, migrate, log }) {
  const files = [paths.BANK_FILE, paths.WALLET_FILE, paths.STACKS_FILE, paths.ACCOUNTS_FILE];
  for (const f of files) {
    try {
      if (fs.existsSync(f + '.pre-v2')) continue;
      if (fs.existsSync(f)) fs.copyFileSync(f, f + '.pre-v2'); else fs.writeFileSync(f + '.pre-v2', '{}');
    } catch (e) { log('pre-v2 copy failed ' + f + ': ' + e.message); }
  }
  const [bank, wallet, stacks, accounts] = files.map(f => readJson(f + '.pre-v2', {}));
  const { items, report } = migrate.migrate({ bank, wallet, stacks, accounts });
  const res = migrate.apply(ledger, items);
  if (res.written) { try { fs.writeFileSync(paths.STACKS_FILE, '{}'); } catch {} }
  if (res.written || res.conflicts.length) log(`migration: ${report.accounts} accounts, ${report.items} writes (${res.written} written, ${res.dup} dup), orphans ${report.orphans.length}, rejected ${report.rejected.length}${res.conflicts.length ? ', CONFLICTS ' + res.conflicts.length : ''}`);
  return { report, res };
}

// One-time carry-over of the pre-redesign chips history (qa/chip-snapshot/MIGRATION.md): production only, or when LEGACY_IMPORT_FILE is set.
function legacyImport({ presLedger, bank, accounts, paths, env, keyOf }) {
  try {
    const impFile = env.LEGACY_IMPORT_FILE || (env.BANK_FILE ? null : path.join(paths.root, 'legacy-import.json'));
    if (!impFile || !fs.existsSync(impFile)) return;
    const hist = new Set(['buyin', 'rebuy', 'cashout', 'legacy-import']);
    const have = new Set(presLedger.entries().filter(e => hist.has(e.type) && e.name).map(e => keyOf(e.name)));
    for (const r of readJson(impFile, [])) {
      const k = keyOf(r.name);
      if (!k || have.has(k) || bank[k] === undefined) continue;
      presLedger.log('legacy-import', r.name, r.net, bank[k], null, null, null, { key: k, hands: r.hands || 0, biggestWin: r.biggestWin || 0, note: 'Carried over from the original chips bank' });
    }
  } catch (e) { console.error('legacy import failed:', e.message); }
}

// Write-only mirror for rollback: bank.json and wallet.json, rewritten (temp + rename) only when the ledger moved.
function startMirror({ service, ledger, paths, intervalMs = 250 }) {
  let last = -1;
  const writeOne = (file, obj) => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, file); };
  function write(force) {
    if (!force && ledger.lastId === last) return;
    try { const m = service.mirror(); writeOne(paths.BANK_FILE, m.bank); writeOne(paths.WALLET_FILE, m.wallet); last = ledger.lastId; }
    catch (e) { console.error('[v2] mirror write failed:', e && e.message); }
  }
  write(true);
  const h = setInterval(() => write(false), intervalMs);
  if (h.unref) h.unref();
  return { write: () => write(true), stop: () => clearInterval(h) };
}

module.exports = { resolvePaths, prepareDataDir, migrateIfNeeded, legacyImport, startMirror, readJson };
