#!/usr/bin/env node
'use strict';
// tools/zero-game-state.js: the games' own state files at the fresh start at zero (Money 1008 ZS-4). Dry run by default, --apply writes.
//
// Why: Cold Call keeps, per player AND per mode (Cash = 'play', Chips), the leads, an armed Callback and the open round records in coldcall-pull.json; Campaign keeps its open runs in campaign.json.
// Cash earned there with pretend money before go-live pays REAL Cash after the ledger starts at zero: an armed Cash Callback is played free at its stored bet (the house pays the win), Cash leads arm a
// Callback within a few paid spins. The books still sum to 0 (the house account goes negative), so no audit sees it. Proof: _scratch/money/fix-zs-games/FOUND-1.md, p-zs4.js.
//
// What it does to a data dir (the files games/coldcall.js and games/campaign.js read, found the way server.js finds them: transport/boot.js resolvePaths):
//   Cold Call  coldcall-pull.json + .bak + .journal + .journal.prev (+ .tmp, .damaged-*): loaded with the game's OWN store code (journal replayed, .bak fallback) on a private copy; every Cash ('play') player state,
//              the Cash pot record and every Cash open round are dropped; Chips ('chips') player states, the Chips pot and the Chips open rounds are KEPT. The original files go to the zeroed folder
//              under their own names; a new coldcall-pull.json with the Chips half is written (temp + fsync + rename). No Cash state at all: the files are left alone.
//   Campaign   campaign.json + .bak (+ .tmp, .damaged-*): every open Cash run is dropped, open Chips runs are KEPT, same move-aside + rewrite.
//   KEPT untouched: coldcall-config.json, the Bender config, their audit logs, accounts.json, everything else.
// A store that is damaged, blocked or restored from a backup is NOT touched: the tool stops (exit 3) and says which file; a person looks first.
//
// Run it with the server STOPPED and AFTER the money files are moved aside (RUNBOOK fresh start, step 3): it refuses when money.jsonl.lock is still in the data dir (the ledger's writer fence,
// present while the server runs and removed by the move) It cannot see processes: stopping the server is still the operator's job.
// Plain node, no dependencies. Exit: 0 ok (dry run or applied), 1 usage, 2 a file is unreadable, 3 refused (server looks running, damaged store, or the zeroed folder already holds a file).
const fs = require('fs');
const os = require('os');
const path = require('path');
const boot = require('../transport/boot');
const cold = require('../games/coldcall-store.js');
const camp = require('../games/campaign-store.js');

const ROOT = path.join(__dirname, '..');
const HELP = `usage: node tools/zero-game-state.js [--data-dir DIR] [--zeroed-dir DIR] [--apply]

Dry run unless --apply. Removes the Cash (ledger 'play') half of the games' own state files; Chips state and the config files stay.
  --data-dir    the data dir (default: DATA_DIR, else RAILWAY_VOLUME_MOUNT_PATH, else the repo root: transport/boot.js resolvePaths). The game files are found like server.js finds them
                (COLDCALL_PULL_FILE, CAMPAIGN_FILE, else next to bank.json).
  --zeroed-dir  where the original files go (default: <data dir>/zeroed-YYYYMMDD, the folder of the fresh start). An existing file of the same name there is never overwritten (exit 3).
  --apply       write: move the originals aside and write the Chips-only files.
Exit: 0 ok, 1 usage, 2 unreadable file, 3 refused (server running, damaged store, name clash).`;

class Fail extends Error { constructor(code, msg) { super(msg); this.exitCode = code; } }

function parseArgs(argv) {
  const o = { dataDir: null, zeroed: null, apply: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--apply') o.apply = true;
    else if (a === '--data-dir' || a === '--zeroed-dir') { if (i + 1 >= argv.length) throw new Fail(1, a + ' needs a value'); o[a === '--data-dir' ? 'dataDir' : 'zeroed'] = argv[++i]; }
    else throw new Fail(1, 'unknown argument ' + a);
  }
  return o;
}

const stampDay = () => { const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); };
const exists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);

// every file of one game store in the data dir: <base>, <base>.bak, .tmp, .bak.tmp, .journal, .damaged-*
function familyOf(file) {
  const dir = path.dirname(file), base = path.basename(file), out = [];
  let names = []; try { names = fs.readdirSync(dir); } catch (e) { throw new Fail(2, 'cannot read ' + dir + ': ' + e.message); }
  for (const n of names) if (n === base || n.startsWith(base + '.')) out.push(path.join(dir, n));
  return out.sort();
}

function copyTo(files, tmp) { for (const f of files) fs.copyFileSync(f, path.join(tmp, path.basename(f))); }

function writeAtomic(file, text) {
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  try { const d = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(d); } finally { fs.closeSync(d); } } catch {}
}

// ---- Cold Call: load on a private copy with the game's own store, report, build the Chips-only file
function planColdCall(file, tmpRoot, io) {
  const fam = familyOf(file).filter((f) => fs.statSync(f).isFile());
  const res = { name: 'Cold Call', file, family: fam, cash: false, alarms: [], keep: null, summary: [] };
  if (!fam.length) { res.summary.push('no coldcall-pull.json in the data dir: nothing to do'); return res; }
  const tmp = fs.mkdtempSync(path.join(tmpRoot, 'cc-'));
  copyTo(fam.filter((f) => /\.(bak|journal|journal\.prev)$/.test(f) || f === file), tmp);     // main, .bak, .journal, .journal.prev (R3C-2: read after a restore from the .bak): the rest is never read by the store
  const alarms = [];
  const st = cold.createStore(path.join(tmp, path.basename(file)), { log: () => {}, alarm: (...a) => alarms.push(a.join(' ')), confirm: () => true });   // confirm: every intent line of the journal counts (the ledger is gone)
  res.alarms = alarms;
  if (st.blocked() || alarms.length) { res.refuse = 'the Cold Call store did not load cleanly (' + (st.blocked() || alarms[0]).toString().slice(0, 300) + ')'; return res; }
  const d = st._data();
  const keep = { v: 1, players: {}, pot: {}, open: {} };
  let cashPlayers = 0, cashLeads = 0, cbs = 0, chipsPlayers = 0, cashOpen = 0, chipsOpen = 0;
  for (const k of Object.keys(d.players)) {
    const p = d.players[k];
    if (isObj(p.play)) { cashPlayers++; cashLeads += Number(p.play.lt) || 0; if (p.play.cb) cbs++; }
    if (isObj(p.chips)) { chipsPlayers++; keep.players[k] = { chips: p.chips }; }
  }
  for (const k of Object.keys(d.open)) { const r = d.open[k]; if (r && r.mode === 'chips') { chipsOpen++; keep.open[k] = r; } else cashOpen++; }
  const potCash = !!d.pot.play;
  if (d.pot.chips) keep.pot.chips = d.pot.chips;
  res.cash = cashPlayers > 0 || cashOpen > 0 || potCash;
  res.keep = keep;
  res.summary.push(`Cash state found: ${cashPlayers} player state(s) (${cbs} armed Callback(s), ${(cashLeads / 10).toFixed(1)} leads), ${cashOpen} open round record(s), Cash pot record ${potCash ? 'yes' : 'no'}`);
  res.summary.push(`Chips state kept: ${chipsPlayers} player state(s), ${chipsOpen} open round record(s), Chips pot record ${d.pot.chips ? 'yes' : 'no'}`);
  st.close(true);
  return res;
}

// ---- Campaign
function planCampaign(file, tmpRoot) {
  const fam = familyOf(file).filter((f) => fs.statSync(f).isFile());
  const res = { name: 'Campaign', file, family: fam, cash: false, alarms: [], keep: null, summary: [] };
  if (!fam.length) { res.summary.push('no campaign.json in the data dir: nothing to do'); return res; }
  const tmp = fs.mkdtempSync(path.join(tmpRoot, 'cp-'));
  copyTo(fam.filter((f) => f.endsWith('.bak') || f === file), tmp);
  const alarms = [];
  const st = camp.createStore(path.join(tmp, path.basename(file)), { log: () => {}, alarm: (...a) => alarms.push(a.join(' ')) });
  res.alarms = alarms;
  if (st.blocked() || st.lost() || alarms.length) { res.refuse = 'the Campaign store did not load cleanly (' + (st.blocked() || st.lost() || alarms[0]).toString().slice(0, 300) + ')'; return res; }
  const keep = { v: 1, open: {} };
  let cash = 0, chips = 0;
  for (const r of st.allOpen()) { if (r.cur === 'chips') { chips++; keep.open[r.key] = r; } else cash++; }
  res.cash = cash > 0;
  res.keep = keep;
  res.summary.push(`open runs: ${cash} Cash (dropped), ${chips} Chips (kept)`);
  st.close(true);
  return res;
}

function main(argv, env, io) {
  const o = parseArgs(argv);
  if (o.help) { io.out(HELP); return 0; }
  const paths = boot.resolvePaths(ROOT, o.dataDir ? { DATA_DIR: o.dataDir } : env);
  const dir = paths.DATA_DIR;
  if (!fs.existsSync(dir)) throw new Fail(2, 'data dir ' + dir + ' does not exist');
  const ccFile = paths.COLDCALL_PULL_FILE, cpFile = (o.dataDir ? null : env.CAMPAIGN_FILE) || path.join(path.dirname(paths.BANK_FILE), 'campaign.json');
  const zeroed = o.zeroed || path.join(dir, 'zeroed-' + stampDay());
  io.out(`zero-game-state: ${o.apply ? 'APPLY' : 'DRY RUN'}; data dir ${dir}; originals go to ${zeroed}`);

  // the server must be stopped and the money files moved: the ledger's writer fence is still there while it runs
  const lock = paths.MONEY_FILE + '.lock';
  if (exists(lock)) throw new Fail(3, `${lock} exists: the server may be running, or the money files are not moved aside yet. Stop the server and do RUNBOOK step 3 first, then run this tool.`);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zero-game-state-'));
  const plans = [];
  try {
    plans.push(planColdCall(ccFile, tmpRoot, io), planCampaign(cpFile, tmpRoot));
  } finally { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {} }

  for (const p of plans) {
    io.out(`${p.name} (${p.file}): ${p.family.length} file(s): ${p.family.map((f) => path.basename(f)).join(' ') || '-'}`);
    for (const s of p.summary) io.out('  ' + s);
    if (p.refuse) io.out('  REFUSED: ' + p.refuse);
  }
  const refused = plans.find((p) => p.refuse);
  if (refused) throw new Fail(3, refused.name + ': ' + refused.refuse + '. Nothing was changed. A person must look at the file first.');

  let moved = 0, written = 0;
  const todo = plans.filter((p) => p.cash);
  if (!todo.length) { io.out('no Cash game state in the data dir: nothing to do' + (o.apply ? '' : ' (dry run)')); return 0; }
  // name clashes first: nothing is moved when any file of the zeroed folder is already there
  for (const p of todo) for (const f of p.family) { const dst = path.join(zeroed, path.basename(f)); if (exists(dst)) throw new Fail(3, dst + ' already exists in the zeroed folder; nothing was changed. Pick another --zeroed-dir.'); }
  for (const p of todo) {
    for (const f of p.family) io.out(`  ${o.apply ? 'move' : 'would move'} ${f} -> ${path.join(zeroed, path.basename(f))}`);
    const has = p.name === 'Cold Call' ? Object.keys(p.keep.players).length + Object.keys(p.keep.open).length + Object.keys(p.keep.pot).length : Object.keys(p.keep.open).length;
    io.out(`  ${o.apply ? 'write' : 'would write'} ${p.file} with the Chips half only${has ? '' : ' (empty: nothing of Chips to keep)'}`);
  }
  if (!o.apply) { io.out('dry run: nothing was changed. Run again with --apply.'); return 0; }
  fs.mkdirSync(zeroed, { recursive: true });
  for (const p of todo) {
    for (const f of p.family) { fs.renameSync(f, path.join(zeroed, path.basename(f))); moved++; }
    writeAtomic(p.file, JSON.stringify(p.keep));
    written++;
  }
  io.out(`done: ${moved} file(s) moved to ${zeroed}, ${written} Chips-only file(s) written. coldcall-config.json, the Bender config and accounts.json were not touched.`);
  return 0;
}

if (require.main === module) {
  const io = { out: (m) => console.log(m), err: (m) => console.error(m) };
  try { process.exitCode = main(process.argv.slice(2), process.env, io); }
  catch (e) { if (e instanceof Fail) { io.err('zero-game-state: ' + e.message); process.exitCode = e.exitCode; } else { io.err('zero-game-state: unexpected error: ' + (e && e.stack || e)); process.exitCode = 2; } }
}
module.exports = { main, Fail };
