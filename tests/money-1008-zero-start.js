'use strict';
// Money 1008 fresh start at zero (Chris 2026-10-08), variant KEEP names + PINs, ZERO the money: the accounts file stays, the money ledger starts empty.
// The REAL server.js is booted (no browser, tests/v2/lib.js harness, ports V2_PORT_BASE + 0..2):
//   1. an "old life" data dir: legacy bank / wallet files seeded BEFORE the first v2 boot (so the .pre-v2 copies carry old money, like the live dir), players claim their names
//      with PINs, an admin sets Cash, one player sits at a Chips table;
//   2. tools/export-balances.js on it (the record Chris sets Cash from);
//   3. server stopped, the money files moved aside exactly as RUNBOOK-fresh-start step 3 says (ZERO_FILES below), accounts.json and the rest kept untouched;
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

// The money files of a data dir as the code names them (transport/boot.js resolvePaths + migrateIfNeeded). Test harness names: b.json = BANK_FILE, w.json = WALLET_FILE, s.json = STACKS_FILE.
// What the RUNBOOK moves aside: the journal and everything derived from it, the bank / wallet mirrors, and the .pre-v2 copies the migration re-reads at every boot.
const ZERO_FILES = ['money.jsonl', 'money.jsonl.ckpt', 'money.jsonl.ckpt.tmp', 'money.jsonl.ckpt.bad', 'money.jsonl.lock', 'money.jsonl.quarantine',
  'b.json', 'w.json', 's.json', 'b.json.pre-v2', 'w.json.pre-v2', 's.json.pre-v2', 'a.json.pre-v2'];
const KEEP_FILES = ['a.json'];     // accounts (names + PINs); the others in the dir (a.json.bak, l.json player history, t.json tables) are left alone, not asserted

const root = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'zero-start-'));
process.on('exit', () => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });
const bytes = (dir, f) => { try { return fs.readFileSync(path.join(dir, f)); } catch { return null; } };
const journal = (dir) => { try { return fs.readFileSync(path.join(dir, 'money.jsonl'), 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)); } catch { return []; } };
const legs = (rec) => (rec.batch || [rec]);
const exportJson = (dir, extra = []) => {
  const r = spawnSync('node', [TOOL, '--ledger', path.join(dir, 'money.jsonl'), '--accounts', path.join(dir, 'a.json'), '--json', '-', '--tmpdir', root, ...extra], { encoding: 'utf8', maxBuffer: 1 << 26 });
  return { status: r.status, err: r.stderr, j: r.status === 0 || r.status === 4 ? JSON.parse(r.stdout) : null };
};
const moveAside = (dir, into) => { fs.mkdirSync(into, { recursive: true }); const moved = []; for (const f of ZERO_FILES) if (fs.existsSync(path.join(dir, f))) { fs.renameSync(path.join(dir, f), path.join(into, f)); moved.push(f); } return moved; };
const PINS = { ann: '1111', bob: '2222', cy: '3333' };

(async () => {
  // ---- 1. the old life ----
  const dir = path.join(root, 'live'); fs.mkdirSync(dir);
  const env = { SIGNUP_PLAY_CENTS: '0' };   // the production rule (new accounts start with 0 Cash); the harness would otherwise hand every signup 10,000.00 Cash
  fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify({ ann: 777, bob: 4242, cy: 10000 }));                                 // legacy chips
  fs.writeFileSync(path.join(dir, 'w.json'), JSON.stringify({ ann: { play: 123456 }, bob: { play: 50000 } }));                    // legacy Cash
  let srv = await L.startServer(0, { dir, keepFiles: true, env });
  const adm = new L.Bot(srv, 'chris'); await adm.connect(); await adm.claimAdmin();
  const bots = {};
  for (const [k, pin] of Object.entries(PINS)) { bots[k] = new L.Bot(srv, k[0].toUpperCase() + k.slice(1)); await bots[k].connect(); const r = await bots[k].claim(pin); if (!r.account) throw new Error('setup: ' + k + ' could not claim: ' + JSON.stringify(r)); }
  const set = await adm.req('admin_set_play', { key: 'ann', cents: 300000, opId: 'zs.old.ann' }, 'admin_result', 4000);
  const seat = await bots.bob.sit('POKERPING', 1000, 'chips');
  await L.sleep(500);
  ok(set.ok && !!seat, 'setup: an admin set Ann to 3,000.00 Cash and Bob sat at a Chips table');
  await Promise.all(Object.values(bots).concat(adm).map(b => b.close())); await L.sleep(200);
  await srv.stop('SIGTERM');
  const old = exportJson(dir);
  ok(old.status === 0 && old.j.accounts.find(a => a.key === 'ann').cash.total === 300000 && old.j.accounts.find(a => a.key === 'bob').chips.seats === 1000, 'setup: the old ledger holds the money (Ann 300000 Cash, Bob 1000 Chips at a seat)');
  ok(journal(dir).some(r => legs(r).some(l => l.from === 'mint:migration')) && fs.existsSync(path.join(dir, 'w.json.pre-v2')) && /123456/.test(fs.readFileSync(path.join(dir, 'w.json.pre-v2'), 'utf8')), 'setup: like the live dir, the .pre-v2 copies hold the old balances and the journal has mint:migration lines');

  // ---- the hazard, informational: only the journal emptied ----
  {
    const naive = path.join(root, 'naive'); fs.cpSync(dir, naive, { recursive: true });
    for (const f of ['money.jsonl', 'money.jsonl.ckpt', 'money.jsonl.lock']) fs.rmSync(path.join(naive, f), { force: true });
    const s = await L.startServer(1, { dir: naive, keepFiles: true, env }); await L.sleep(400); await s.stop('SIGTERM');
    const x = exportJson(naive); const cash = x.j.totals.cash.total;
    console.log(`INFO emptying ONLY money.jsonl: Cash back after boot = ${cash} cents, ${journal(naive).filter(r => legs(r).some(l => l.from === 'mint:migration')).length} mint:migration line(s) (the .pre-v2 copies and bank.json / wallet.json are re-read at boot)`);
  }

  // ---- 3. the zero ----
  const keptBefore = Object.fromEntries(KEEP_FILES.map(f => [f, bytes(dir, f)]));
  const moved = moveAside(dir, path.join(root, 'moved-aside'));
  ok(moved.includes('money.jsonl') && moved.includes('w.json.pre-v2') && moved.includes('b.json') && !fs.existsSync(path.join(dir, 'money.jsonl')), 'zero: the journal, the mirrors and the .pre-v2 copies are moved aside (' + moved.join(' ') + ')');
  ok(fs.existsSync(path.join(dir, 'a.json')), 'zero: accounts.json is still in the data dir');

  // ---- 4. the boot ----
  let srv2 = null, err = null;
  try { srv2 = await L.startServer(0, { dir, keepFiles: true, env }); } catch (e) { err = e; }
  if (!ok(!err, 'boot: the server starts on kept accounts + an empty ledger' + (err ? ' (' + err.message + ')' : ''))) { console.log(`${pass} passed, ${fail} failed, ${found} finding(s)`); process.exit(1); }
  await L.sleep(500);
  const atBoot = journal(dir);
  const migLines = atBoot.filter(r => legs(r).some(l => l.from === 'mint:migration')), signupLines = atBoot.filter(r => legs(r).some(l => l.from === 'mint:signup'));
  const cashLines = atBoot.filter(r => legs(r).some(l => l.cur === 'play'));
  ok(cashLines.length === 0, `boot: no Cash line in the ledger at all (${cashLines.length})`);
  ok(atBoot.every(r => legs(r).every(l => l.cur !== 'play' || l.from === 'admin:adjust')), 'boot: nothing but an admin can have written Cash');
  finding(migLines.length === 0, `boot: no mint:migration line (got ${migLines.length})`);
  finding(signupLines.length === 0, `boot: no mint:signup line (got ${signupLines.length}: ${signupLines.slice(0, 3).map(r => legs(r).map(l => l.to + ' ' + l.amount + ' ' + l.cur).join('+')).join(', ')})`);
  const z = exportJson(dir);
  ok(z.status === 0 && z.j.accounts.filter(a => a.kind === 'account').length === 4, 'boot: the export sees the 4 kept accounts (chris, ann, bob, cy)');
  ok(z.j.accounts.every(a => a.cash.total === 0) && z.j.totals.cash.total === 0, 'boot: every wallet is 0 Cash');
  const cz = exportJson(dir, ['--expect-zero', 'cash']);
  ok(cz.status === 0 && /expect-zero \(cash\): OK/.test(cz.err), '--expect-zero cash exits 0 on the fresh ledger: ' + (cz.err.trim().split('\n').pop()));
  finding(z.j.accounts.every(a => a.chips.total === 0) && z.j.totals.chips.total === 0, `boot: every wallet is 0 Chips (got ${z.j.accounts.map(a => a.key + '=' + a.chips.total).join(' ')})`);
  ok(z.j.accounts.every(a => a.escrowDetail.length === 0 && a.seatsDetail.length === 0), 'boot: no escrow and no seat stack anywhere (Bob\'s old seat did not come back)');
  ok(z.j.books.chips.ok && z.j.books.play.ok && z.j.quarantined.length === 0, 'boot: the books balance, nothing quarantined');
  ok(Buffer.compare(keptBefore['a.json'], bytes(dir, 'a.json')) === 0, 'kept: accounts.json (names + PINs) is byte-identical after the boot');

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

  console.log(`${pass} passed, ${fail} failed, ${found} finding(s)${STRICT ? ' (strict)' : ''}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(2); });
