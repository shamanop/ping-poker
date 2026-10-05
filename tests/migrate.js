// Chip-history migration: fresh DATA_DIR + repo seed -> four accounts, bank and nets equal the 2026-10-05 snapshot; restart is idempotent.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ROOT = path.join(__dirname, '..'), PORT = 3481;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppmig-'));
const env = { ...process.env, PORT: String(PORT), AUTO_START_MS: '600000', DATA_DIR: dir, LEGACY_IMPORT_FILE: path.join(ROOT, 'legacy-import.json') };
for (const k of ['BANK_FILE', 'LEDGER_FILE', 'ACCOUNTS_FILE', 'TABLES_FILE', 'WALLET_FILE', 'BIGWINS_FILE', 'STACKS_FILE', 'RAILWAY_VOLUME_MOUNT_PATH']) delete env[k];
const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'qa/chip-snapshot/live-bank-summary-20261005-1155.json'), 'utf8'));
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const boot = async () => { const p = spawn('node', ['server.js'], { cwd: ROOT, env, stdio: 'ignore' }); for (let i = 0; i < 80; i++) { try { await fetch(`http://localhost:${PORT}/`); return p; } catch { await sleep(150); } } return p; };
const sum = async () => { const r = await (await fetch(`http://localhost:${PORT}/api/bank-summary?password=ping`)).json(); return Object.fromEntries(r.players.map(p => [p.name.toLowerCase(), p])); };
const rd = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const state = () => ({ accts: Object.keys(rd('accounts.json').accounts || rd('accounts.json')).sort(), imports: rd('ledger.json').filter(e => e.type === 'legacy-import').length });
(async () => {
  let proc = await boot();
  try {
    ok(fs.existsSync(path.join(dir, 'bank.json')), 'DATA_DIR respected: bank.json seeded into the data dir');
    ok(fs.existsSync(path.join(dir, 'accounts.json')) && fs.existsSync(path.join(dir, 'ledger.json')), 'DATA_DIR respected: accounts.json + ledger.json live there');
    ok(!fs.existsSync(path.join(ROOT, 'accounts.json')), 'no accounts.json written in the repo');
    const s1 = await sum(), st1 = state();
    ok(['chris', 'crip doe', 'dial-up', 'hr'].every(k => st1.accts.includes(k)), `four accounts exist: ${st1.accts.join(',')}`);
    for (const sp of snap.players) {
      const p = s1[sp.name.toLowerCase()];
      ok(p && p.bank === sp.bank && p.net === sp.net && p.handsPlayed === sp.handsPlayed && p.biggestWin === sp.biggestWin, `${sp.name}: bank ${p && p.bank}/${sp.bank} net ${p && p.net}/${sp.net} hands ${p && p.handsPlayed}/${sp.handsPlayed}`);
    }
    proc.kill('SIGKILL'); await sleep(300);
    const bankBefore = fs.readFileSync(path.join(dir, 'bank.json'), 'utf8');
    proc = await boot();
    const s2 = await sum(), st2 = state();
    ok(JSON.stringify(st1) === JSON.stringify(st2) && st2.imports === 4, `restart idempotent: ${st2.imports} legacy-import rows, accounts unchanged`);
    ok(snap.players.every(sp => { const p = s2[sp.name.toLowerCase()]; return p.bank === sp.bank && p.net === sp.net; }), 'restart: bank + nets unchanged');
    ok(fs.readFileSync(path.join(dir, 'bank.json'), 'utf8') === bankBefore, 'restart: seed not re-copied over existing bank.json');
  } catch (e) { console.log('ERROR', e); fails++; }
  finally { proc.kill('SIGKILL'); console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0); }
})();
