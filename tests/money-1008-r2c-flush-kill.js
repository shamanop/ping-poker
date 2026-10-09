'use strict';
// node tests/money-1008-r2c-flush-kill.js [kills]   (MONEY 1008 R2C-5: kill -9 loop; default 220 kills)
// A real child process runs paid Cold Call spins (account `ann` in BOTH currencies, account `bob` in Chips only; decisions answered) on one data dir, in journal mode. The parent SIGKILLs it:
//   - at a random moment of the spinning (about half of the kills),
//   - or the child kills ITSELF at a named point: after the journal line and before the ledger call / after the ledger call and before the ack / inside the fsync wait.
// Every next child starts by booting the dir (journal replay + recover()) and checks, before it spins, that for each account and currency the paid rounds the STATE counts (rounds - callbacks)
// are exactly the stakes the LEDGER holds (a stake without its leads or leads without a stake break it), that the state of every spin it ever ACKNOWLEDGED is still there (a counter file the parent
// owns), and that bob's Chips spins left no Cash line. Exit 0 = no kill found a violation.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const MODE = process.argv[2] === 'child' ? 'child' : 'parent';

if (MODE === 'child') {
  process.env.COLDCALL_JOURNAL = '1';
  const dir = process.argv[3], killAt = process.argv[4], killAfter = Number(process.argv[5] || 0), seed = Number(process.argv[6] || 1);
  const H = require('./lib-coldcall-ledger.js'), E = require('../games/coldcall-engine.js');
  const w = H.world({ dir, potRng: () => 1, keys: ['ann', 'bob'], rng: E.rngFrom(seed), roundRng: E.rngFrom(seed + 1) });
  const out = (s) => fs.writeSync(1, s + '\n');
  const check = () => {
    const bad = [];
    for (const key of ['ann', 'bob']) for (const cur of ['chips', 'play']) {
      const st = w.store().player(key, cur) || { rounds: 0, callbacks: 0 };
      const stakes = new Set(w.lines((e) => e.cur === cur && e.reason === 'coldcall:spend' && (e.from === (cur === 'chips' ? 'bank:' : 'play:') + key || e.from.startsWith('escrow:coldcall:' + key + ':'))).map((e) => e.batchRef || e.ref)).size;
      if (st.rounds - st.callbacks !== stakes) bad.push(key + '/' + cur + ': state counts ' + (st.rounds - st.callbacks) + ' paid rounds, ledger holds ' + stakes + ' stakes');
    }
    if (w.lines((e) => e.cur === 'play' && /bob/.test(e.from + e.to) && /^coldcall:/.test(e.reason)).length) bad.push('a Cash line for bob, a Chips-only player');
    const acked = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'acked.json'), 'utf8')); } catch { return {}; } })();
    for (const k of Object.keys(acked)) { const [key, cur] = k.split('/'); const st = w.store().player(key, cur) || { rounds: 0 }; if (st.rounds < acked[k]) bad.push(k + ': ' + acked[k] + ' acknowledged rounds, the state has ' + st.rounds); }
    return bad;
  };
  const bad = check();
  out(bad.length ? 'BAD ' + bad.join(' | ') : 'BOOT-OK');
  if (bad.length) process.exit(3);
  if (process.env.CC_KILL_CHECK_ONLY) process.exit(0);                                       // a person looking at a data dir left by a run
  if (!w.ledger.balance('play:ann', 'play') && !w.lines((e) => e.reason === 'test-fund').length) { w.fund('ann', 'chips', 1e9); w.fund('ann', 'play', 1e9); w.fund('bob', 'chips', 1e9); }
  const kill = () => process.kill(process.pid, 'SIGKILL');
  let hits = 0;
  if (killAt === 'ledger') w.hooks.before.round = () => { if (++hits === killAfter) kill(); };          // the journal line is written, the ledger call is not
  if (killAt === 'ack') w.hooks.after.round = () => { if (++hits === killAfter) kill(); };             // the ledger holds the stake, nothing is acknowledged
  if (killAt === 'sync') { const fd = fs.fdatasync; fs.fdatasync = (f, cb) => { if (++hits === killAfter) kill(); return fd(f, cb); }; }
  const socks = { ann: w.sock('ann'), bob: w.sock('bob') };
  const ackedNow = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'acked.json'), 'utf8')); } catch { return {}; } })();
  const bump = (key, cur) => { ackedNow[key + '/' + cur] = (w.store().player(key, cur) || { rounds: 0 }).rounds; fs.writeFileSync(path.join(dir, 'acked.json.tmp'), JSON.stringify(ackedNow)); fs.renameSync(path.join(dir, 'acked.json.tmp'), path.join(dir, 'acked.json')); };
  const cnt = { ann: 0, bob: 0 };
  const next = (key) => {
    const s = socks[key], k = cnt[key]++, cur = key === 'bob' ? 'chips' : (k % 2 ? 'play' : 'chips'), bet = cur === 'play' ? [10, 100, 500][k % 3] : [1, 10, 100][k % 3];
    const push = s.out.push.bind(s.out); let d = 0;
    s.out.push = (e) => {
      const r = push(e);
      if (e[0] === 'error') { s.out.push = push; setImmediate(() => next(key)); }
      else if (e[0] === 'g:coldcall:result') {
        if (e[1].status === 'pending') setImmediate(() => { w.clock.advance(5); s.send('g:coldcall:decide', { roundId: e[1].roundId, ...H.policy(k + d++, e[1].pending) }); });
        else { s.out.push = push; bump(key, cur); setImmediate(() => next(key)); }
      }
      return r;
    };
    w.clock.advance(200); s.send('g:coldcall:spin', { bet, mode: cur });
  };
  next('ann'); next('bob');
  return;
}

// ---- parent ----
const KILLS = Number(process.argv[2]) || 220, LANES = 4;                       // 4 lanes in parallel, each with its own data dir and its own child, one child per lane at a time
const PER_DIR = 40;                                                           // a fresh data dir every 40 kills keeps the boot (ledger replay) fast; inside a dir every boot replays what the kills left
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const kinds = ['random', 'random', 'ledger', 'ack', 'sync'];
const ackedTotal = {};
let fails = 0, boots = 0, selfKills = 0, extKills = 0;
function runChild(dir, kind, killAfter, seed) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [__filename, 'child', dir, kind, String(killAfter), String(seed)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let buf = '', booted = false, finished = false, timer = null;
    const done = (code, sig) => { if (finished) return; finished = true; clearTimeout(timer); resolve({ code, sig, buf }); };
    c.stdout.on('data', (d) => {
      buf += d;
      if (!booted && /BOOT-OK|BAD /.test(buf)) {
        booted = true;
        if (/BAD /.test(buf)) return;                                     // the child exits 3 by itself
        if (kind === 'random') timer = setTimeout(() => { extKills++; try { c.kill('SIGKILL'); } catch {} }, rnd(20, 450));
        else timer = setTimeout(() => { try { c.kill('SIGKILL'); } catch {} }, 8000);   // the child should have killed itself long before
      }
    });
    c.on('exit', done);
  });
}
async function finalBoot(dir) {                                               // one more boot to check the state after the last kill of this dir
  const last = await new Promise((resolve) => { const c = spawn(process.execPath, [__filename, 'child', dir, 'random', '0', '1'], { stdio: ['ignore', 'pipe', 'inherit'] }); let b = ''; c.stdout.on('data', (d) => { b += d; if (/BOOT-OK|BAD /.test(b)) { c.kill('SIGKILL'); } }); c.on('exit', () => resolve(b)); });
  if (!/BOOT-OK/.test(last)) { fails++; console.error('final boot: ' + last.split('\n').find((l) => /BAD /.test(l))); }
  try { const a = JSON.parse(fs.readFileSync(path.join(dir, 'acked.json'), 'utf8')); for (const k of Object.keys(a)) ackedTotal[k] = (ackedTotal[k] || 0) + a[k]; } catch {}
}
async function lane(L) {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-kill-'));
  const mine = Math.ceil(KILLS / LANES);
  for (let k = 0; k < mine && fails < 3; k++) {
    if (k && k % PER_DIR === 0) { await finalBoot(dir); dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-kill-')); }
    const kind = kinds[(k + L) % kinds.length], after = kind === 'random' ? 0 : rnd(1, 12);
    if (process.env.CC_KILL_SNAP) { try { fs.rmSync(dir + '.snap', { recursive: true, force: true }); fs.cpSync(dir, dir + '.snap', { recursive: true }); } catch {} }   // debugging: the dir as the next child will find it
    const r = await runChild(dir, kind, after, 1000 + L * 100003 + k * 7);
    boots++;
    if (kind !== 'random' && r.sig === 'SIGKILL' && /BOOT-OK/.test(r.buf)) selfKills++;
    if (/BAD /.test(r.buf) || r.code === 3) { fails++; console.error('VIOLATION in lane ' + L + ' after kill ' + k + ' (' + kind + ' ' + after + ') dir ' + dir + ': ' + r.buf.split('\n').find((l) => /BAD /.test(l))); }
    else if (!/BOOT-OK/.test(r.buf)) { fails++; console.error('child ' + k + ' did not boot cleanly: code ' + r.code + ' sig ' + r.sig + ' out ' + r.buf.slice(0, 300)); }
  }
  await finalBoot(dir);
}
(async () => {
  await Promise.all(Array.from({ length: LANES }, (_, L) => lane(L)));
  const acked = ackedTotal;
console.log(`${boots} child runs killed with SIGKILL (${extKills} at a random moment, ${selfKills} at a named point: after the journal line / after the ledger call / inside the fsync wait); acknowledged rounds at the end ${JSON.stringify(acked)}; violations ${fails}`);
  console.log(fails ? 'FAIL' : 'ok   no kill found a stake without its leads, leads without a stake, or an acknowledged spin missing');
  process.exit(fails ? 1 : 0);
})();
