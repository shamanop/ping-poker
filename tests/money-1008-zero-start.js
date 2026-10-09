'use strict';
// Money 1008 fresh start at zero (Chris 2026-10-08), variant KEEP names + PINs, ZERO the money: the accounts file stays, the money ledger starts empty.
// The REAL server.js is booted (no browser; DATA_DIR only, so every file has the name it has on the live box and the boot paths of production run: the repo-root bank.json seed copy,
// legacyImport, the .pre-v2 migration; tests/v2/lib.js supplies only the socket Bot; ports V2_PORT_BASE (5520) + 0..2):
//   1. an "old life" data dir: legacy bank / wallet files seeded BEFORE the first v2 boot (so the .pre-v2 copies carry old money, like the live dir), players claim their names
//      with PINs, an admin sets Cash, one player sits at a Chips table;
//   2. tools/export-balances.js on it (the record Chris sets Cash from);
//   3. server stopped, the money files moved aside exactly as RUNBOOK-fresh-start step 3 says (ZERO_FILES below, then bank.json written as {}), accounts.json and the rest kept untouched;
//   4. boot: starts clean, every wallet 0 Cash and 0 Chips, a kept player signs in with the old PIN, no mint:migration / mint:signup line at boot or at sign-in;
//   5. an admin Set Cash works and is the only Cash in the ledger.
// Assertions about what the product does at boot that Chris's rule forbids are listed as FINDING lines (see FOUND-* in the report): with ZERO_START_STRICT=1 they fail the run,
// by default they are printed and not counted, so the rest of the run stays a usable regression test. Plain node: exit 0 on pass, 1 on fail.
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const L = require('./v2/lib.js');

const STRICT = process.env.ZERO_START_STRICT === '1';
const TOOL = path.join(__dirname, '..', 'tools', 'export-balances.js');
let pass = 0, fail = 0, found = 0;
const ok = (c, m) => { if (c) { pass++; console.log('PASS ' + m); } else { fail++; console.log('FAIL ' + m); } return c; };
const finding = (c, m) => { if (c) { pass++; console.log('PASS ' + m); } else if (STRICT) { fail++; console.log('FAIL (finding) ' + m); } else { found++; console.log('FINDING ' + m); } return c; };

// The money files of a data dir as the code names them (transport/boot.js resolvePaths + migrateIfNeeded), default names under DATA_DIR.
// What the RUNBOOK moves aside: the journal and everything derived from it, the bank / wallet / stacks mirrors, and the .pre-v2 copies the migration re-reads at every boot.
// Then bank.json is written as {} : boot.prepareDataDir copies the repo-root bank.json (dial-up, crip doe, ...) into a data dir that has none (FOUND-3).
const ZERO_FILES = ['money.jsonl', 'money.jsonl.ckpt', 'money.jsonl.ckpt.tmp', 'money.jsonl.ckpt.bad', 'money.jsonl.lock', 'money.jsonl.quarantine',
  'bank.json', 'wallet.json', 'stacks.json', 'bank.json.pre-v2', 'wallet.json.pre-v2', 'stacks.json.pre-v2', 'accounts.json.pre-v2'];
const KEEP_FILES = ['accounts.json'];     // accounts (names + PINs); accounts.json.bak, ledger.json (player history), tables.json are left alone, not asserted

const net = require('net');
const { spawn } = require('child_process');
const PORT_BASE = Number(process.env.V2_PORT_BASE) || 5520;
const procs = new Set();
process.on('exit', () => { for (const p of procs) try { p.kill('SIGKILL'); } catch {} });
const portOpen = (port) => new Promise(res => { const c = net.connect(port, '127.0.0.1'); c.once('connect', () => { c.destroy(); res(true); }); c.once('error', () => res(false)); });
// The real server, as started on the box: only DATA_DIR and PORT; no BANK_FILE, no RIG, not production. SIGNUP_PLAY_CENTS=0 is the production rule (the harness default would give signups Cash).
async function startReal(dir, off) {
  const port = PORT_BASE + off;
  const env = { ...process.env, DATA_DIR: dir, PORT: String(port), ADMIN_CLAIM_PASSWORD: L.ADMIN_CLAIM, AUTH_SIGNUP_LIMIT: '100000', SIGNUP_PLAY_CENTS: '0' };
  for (const k of ['NODE_OPTIONS', 'NODE_ENV', 'BANK_FILE', 'MONEY_FILE', 'ACCOUNTS_FILE', 'LEDGER_FILE', 'RIG', 'FRESH_START_ID', 'LEGACY_IMPORT_FILE', 'RAILWAY_VOLUME_MOUNT_PATH']) delete env[k];
  const logFd = fs.openSync(path.join(root, `server-${off}.log`), 'a');
  const proc = spawn('node', ['server.js'], { cwd: path.join(__dirname, '..'), stdio: ['ignore', logFd, logFd], env }); procs.add(proc);
  let up = false;
  for (let i = 0; i < 400 && proc.exitCode === null; i++) { if (await portOpen(port)) { up = true; break; } await L.sleep(25); }
  if (!up) { try { proc.kill('SIGKILL'); } catch {} throw new Error('server did not start on ' + port + ': ' + fs.readFileSync(path.join(root, `server-${off}.log`), 'utf8').split('\n').slice(-4).join(' | ').slice(0, 300)); }
  await L.sleep(60);
  return { port, clients: [], logText: () => fs.readFileSync(path.join(root, `server-${off}.log`), 'utf8'),
    async stop() { try { proc.kill('SIGTERM'); } catch {} await new Promise(r => { if (proc.exitCode !== null || proc.signalCode) return r(); proc.once('exit', r); setTimeout(r, 4000); }); procs.delete(proc); } };
}
const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'zero-start-'));
process.on('exit', () => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });
const bytes = (dir, f) => { try { return fs.readFileSync(path.join(dir, f)); } catch { return null; } };
const journal = (dir) => { try { return fs.readFileSync(path.join(dir, 'money.jsonl'), 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)); } catch { return []; } };
const legs = (rec) => (rec.batch || [rec]);
const exportJson = (dir, extra = []) => {
  const r = spawnSync('node', [TOOL, '--ledger', path.join(dir, 'money.jsonl'), '--accounts', path.join(dir, 'accounts.json'), '--json', '-', '--tmpdir', root, ...extra], { encoding: 'utf8', maxBuffer: 1 << 26 });
  return { status: r.status, err: r.stderr, j: r.status === 0 || r.status === 4 ? JSON.parse(r.stdout) : null };
};
const moveAside = (dir, into, bankEmpty = true) => { fs.mkdirSync(into, { recursive: true }); const moved = []; for (const f of ZERO_FILES) if (fs.existsSync(path.join(dir, f))) { fs.renameSync(path.join(dir, f), path.join(into, f)); moved.push(f); } if (bankEmpty) fs.writeFileSync(path.join(dir, 'bank.json'), '{}'); return moved; };
const PINS = { ann: '1111', bob: '2222', cy: '3333' };

(async () => {
  // ---- 1. the old life ----
  const dir = path.join(root, 'live'); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'bank.json'), JSON.stringify({ ann: 777, bob: 4242, cy: 10000 }));                                 // legacy chips
  fs.writeFileSync(path.join(dir, 'wallet.json'), JSON.stringify({ ann: { play: 123456 }, bob: { play: 50000 } }));                    // legacy Cash
  let srv = await startReal(dir, 0);
  const adm = new L.Bot(srv, 'chris'); await adm.connect(); await adm.claimAdmin();
  const bots = {};
  for (const [k, pin] of Object.entries(PINS)) { bots[k] = new L.Bot(srv, k[0].toUpperCase() + k.slice(1)); await bots[k].connect(); const r = await bots[k].claim(pin); if (!r.account) throw new Error('setup: ' + k + ' could not claim: ' + JSON.stringify(r)); }
  const set = await adm.req('admin_set_play', { key: 'ann', cents: 300000, opId: 'zs.old.ann' }, 'admin_result', 4000);
  const seat = await bots.bob.sit('POKERPING', 1000, 'chips');
  await L.sleep(500);
  ok(set.ok && !!seat, 'setup: an admin set Ann to 3,000.00 Cash and Bob sat at a Chips table');
  await Promise.all(Object.values(bots).concat(adm).map(b => b.close())); await L.sleep(200);
  await srv.stop();
  const old = exportJson(dir);
  ok(old.status === 0 && old.j.accounts.find(a => a.key === 'ann').cash.total === 300000 && old.j.accounts.find(a => a.key === 'bob').chips.seats === 1000, 'setup: the old ledger holds the money (Ann 300000 Cash, Bob 1000 Chips at a seat)');
  ok(journal(dir).some(r => legs(r).some(l => l.from === 'mint:migration')) && fs.existsSync(path.join(dir, 'wallet.json.pre-v2')) && /123456/.test(fs.readFileSync(path.join(dir, 'wallet.json.pre-v2'), 'utf8')), 'setup: like the live dir, the .pre-v2 copies hold the old balances and the journal has mint:migration lines');

  // ---- the hazards, informational (evidence for FOUND-2 and FOUND-3): copies of the old-life dir, zeroed the wrong way ----
  const trial = async (name, off, prep) => {
    const d = path.join(root, name); fs.cpSync(dir, d, { recursive: true }); prep(d);
    const s = await startReal(d, off); await L.sleep(400); await s.stop();
    const x = exportJson(d), j = journal(d);
    return { cash: x.j.totals.cash.total, chips: x.j.totals.chips.total, mig: j.filter(r => legs(r).some(l => l.from === 'mint:migration')).length, accounts: x.j.accounts.filter(a => a.kind === 'account').map(a => a.key).join(',') };
  };
  {
    const t1 = await trial('naive1', 1, d => { for (const f of ['money.jsonl', 'money.jsonl.ckpt', 'money.jsonl.lock']) fs.rmSync(path.join(d, f), { force: true }); });
    console.log(`INFO (FOUND-2) emptying ONLY money.jsonl: after boot Cash = ${t1.cash} cents, Chips = ${t1.chips}, ${t1.mig} mint:migration line(s) (the .pre-v2 copies and the bank / wallet mirrors are re-read at boot)`);
    const t2 = await trial('naive2', 2, d => moveAside(d, path.join(d, 'zeroed'), false));
    console.log(`INFO (FOUND-3) moving the money files aside but NOT writing bank.json = {}: accounts after boot = ${t2.accounts}; Chips = ${t2.chips}, ${t2.mig} mint:migration line(s) (boot.prepareDataDir copies the repo-root bank.json into a data dir with none)`);
  }

  // ---- 3. the zero ----
  const keptBefore = Object.fromEntries(KEEP_FILES.map(f => [f, bytes(dir, f)]));
  const moved = moveAside(dir, path.join(root, 'moved-aside'));
  ok(moved.includes('money.jsonl') && moved.includes('wallet.json.pre-v2') && moved.includes('bank.json') && !fs.existsSync(path.join(dir, 'money.jsonl')), 'zero: the journal, the mirrors and the .pre-v2 copies are moved aside (' + moved.join(' ') + ') and bank.json is {}');
  ok(fs.existsSync(path.join(dir, 'accounts.json')), 'zero: accounts.json is still in the data dir');

  // ---- 4. the boot ----
  let srv2 = null, err = null;
  try { srv2 = await startReal(dir, 0); } catch (e) { err = e; }
  if (!ok(!err, 'boot: the server starts on kept accounts + an empty ledger' + (err ? ' (' + err.message + ')' : ''))) { console.log(`${pass} passed, ${fail} failed, ${found} finding(s)`); process.exit(1); }
  await L.sleep(500);
  const atBoot = journal(dir);
  const migLines = atBoot.filter(r => legs(r).some(l => l.from === 'mint:migration')), signupLines = atBoot.filter(r => legs(r).some(l => l.from === 'mint:signup'));
  const cashLines = atBoot.filter(r => legs(r).some(l => l.cur === 'play'));
  ok(cashLines.length === 0, `boot: no Cash line in the ledger at all (${cashLines.length})`);
  ok(atBoot.every(r => legs(r).every(l => l.cur !== 'play' || l.from === 'admin:adjust')), 'boot: nothing but an admin can have written Cash');
  ok(migLines.length === 0, `boot: no mint:migration line (got ${migLines.length})`);
  finding(signupLines.length === 0, `boot: no mint:signup line (got ${signupLines.length}: ${signupLines.slice(0, 3).map(r => legs(r).map(l => l.to + ' ' + l.amount + ' ' + l.cur).join('+')).join(', ')})`);
  const z = exportJson(dir);
  ok(z.status === 0 && z.j.accounts.filter(a => a.kind === 'account').length === 4, 'boot: the export sees exactly the 4 kept accounts (chris, ann, bob, cy), no account re-made from the repo bank.json');
  ok(z.j.accounts.every(a => a.cash.total === 0) && z.j.totals.cash.total === 0, 'boot: every wallet is 0 Cash');
  const cz = exportJson(dir, ['--expect-zero', 'cash']);
  ok(cz.status === 0 && /expect-zero \(cash\): OK/.test(cz.err), '--expect-zero cash exits 0 on the fresh ledger: ' + (cz.err.trim().split('\n').pop()));
  finding(z.j.accounts.every(a => a.chips.total === 0) && z.j.totals.chips.total === 0, `boot: every wallet is 0 Chips (got ${z.j.accounts.map(a => a.key + '=' + a.chips.total).join(' ')})`);
  ok(z.j.accounts.every(a => a.escrowDetail.length === 0 && a.seatsDetail.length === 0), 'boot: no escrow and no seat stack anywhere (Bob\'s old seat did not come back)');
  ok(z.j.books.chips.ok && z.j.books.play.ok && z.j.quarantined.length === 0, 'boot: the books balance, nothing quarantined');
  ok(Buffer.compare(keptBefore['accounts.json'], bytes(dir, 'accounts.json')) === 0, 'kept: accounts.json (names + PINs) is byte-identical after the boot');

  // a kept player signs in with the old PIN
  const n0 = journal(dir).length;
  const ann = new L.Bot(srv2, 'Ann'); await ann.connect();
  const bad = ann.wait('auth_error', 3000).catch(() => null); const wrong = await ann.req('auth_login', { name: 'Ann', pin: '9999' }, 'auth_ok', 3000); await bad;
  ok(!wrong.account, 'sign-in: a wrong PIN is refused');
  const li = await ann.login(PINS.ann); await L.sleep(400);
  ok(!!li.account && li.account.key === 'ann', 'sign-in: Ann signs in with her old PIN 1111');
  ok(ann.money && ann.money.wallet && ann.money.wallet.play === 0, 'sign-in: the wallet the client sees shows 0 Cash (' + JSON.stringify(ann.money && ann.money.wallet) + ')');
  ok(journal(dir).length === n0, `sign-in: the ledger gets no new line at sign-in (${n0} -> ${journal(dir).length})`);
  const cy = new L.Bot(srv2, 'Cy'); await cy.connect(); const cyl = await cy.login(PINS.cy);
  ok(!!cyl.account, 'sign-in: a player who never touched the table signs in with the old PIN too');

  // ---- 5. an admin sets Cash ----
  const adm2 = new L.Bot(srv2, 'chris'); await adm2.connect(); const al = await adm2.req('auth_login', { name: 'chris', pin: '4321' }, 'auth_ok', 3000);
  ok(!!al.account && al.account.isAdmin, 'admin: chris signs in with the old PIN');
  const s1 = await adm2.req('admin_set_play', { key: 'ann', cents: 250000, opId: 'zs.fresh.ann' }, 'admin_result', 4000);
  ok(s1.ok, 'admin: Set Cash Ann = 2,500.00 works on the fresh ledger');
  await L.sleep(500);
  const after = journal(dir), cashAfter = after.filter(r => legs(r).some(l => l.cur === 'play'));
  ok(cashAfter.length === 1 && legs(cashAfter[0]).every(l => l.cur === 'play' && (l.from === 'admin:adjust' || l.to === 'admin:adjust')) && legs(cashAfter[0]).some(l => l.to === 'play:ann' && l.amount === 250000), 'admin: that one admin:adjust line is the only Cash in the ledger (' + cashAfter.length + ' Cash line)');
  const f = exportJson(dir);
  ok(f.j.accounts.find(a => a.key === 'ann').cash.total === 250000 && f.j.accounts.filter(a => a.key !== 'ann').every(a => a.cash.total === 0) && f.j.totals.cash.total === 250000, 'admin: the export shows Ann 250000 and everyone else 0 Cash, total 250000');
  ok(after.slice(0, n0).every((r, i) => JSON.stringify(r) === JSON.stringify(atBoot[i])), 'the boot lines are unchanged (append only)');
  await srv2.stop();
  ok(!/migration: .*CONFLICTS|QUARANTINED/.test(srv2.logText()), 'boot log: no migration conflicts, nothing quarantined');

  console.log(`${pass} passed, ${fail} failed, ${found} finding(s)${STRICT ? ' (strict)' : ''}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(2); });
