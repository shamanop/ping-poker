'use strict';
// The money suites in one go: one line per file (name, exit, seconds, last output line), a timeout per file, exit 1 when any file failed or timed out. Plain node, no framework.
//   node tests/run-money-1008.js --fast     the files that end in a few seconds (samefund boots one server, cfg-admin-token and cfg-notoken one in-process); what `npm test` runs
//   node tests/run-money-1008.js --money    every tests/money-1008-*.js that ends in under about a minute (npm run test:money)
//   node tests/run-money-1008.js --rest     what --fast leaves out: the money files that boot a server, the minutes-long ones, the long Cold Call suites (npm run test:all, after `npm test`)
//   node tests/run-money-1008.js --all      everything above
//   --only a,b      only these (a part of the file name is enough)       --keep-going   do not stop at the first failure (default: stop)
// MONEY_PORT_BASE=N points the files that boot a server at N..N+9 (V2_PORT_BASE, SESSION_PORT_BASE, PROTO_PORT, SEAT_PORT, R3_PORT, K3_PORT); without it each file keeps its own default.
// A tests/money-1008-*.js file is picked up from the directory, so a new one is in --fast / --money until it is listed below: if it takes more than a few seconds or boots a server,
// add it to SERVER (or to LONG when it needs minutes) in the same commit that adds it. A file that is not finished within its timeout is reported TIMEOUT and counts as a failure.
const fs = require('fs'), path = require('path');
const { spawn } = require('child_process');

// money-1008 files that boot server.js or a child process on a port, or take 8 s or more (timed 2026-10-08 on the shared 12 GB box, whole run one file at a time)
const SERVER = {
  'money-1008-adminclaim.js': 'boots server.js, 8 s', 'money-1008-bender-pay.js': '13 s', 'money-1008-r2c-buy.js': 'boots server.js, 25 s', 'money-1008-r2c-loop.js': 'boots server.js, 21 s', 'money-1008-r2c-reset.js': 'boots server.js, 26 s', 'money-1008-proto.js': 'boots server.js, 4 s', 'money-1008-r2b-boot.js': 'boots server.js, 22 s',
  'money-1008-r2b-seat-socket.js': 'boots server.js, 12 s', 'money-1008-r2c-flush-kill.js': 'kill loop, 17 s', 'money-1008-server-guard.js': 'boots server.js 19 times, 56 s',
  'money-1008-session.js': 'boots server.js, 13 s', 'money-1008-zero-start.js': 'boots server.js, 10 s',
};
// money-1008 files that need minutes: they run the live-config payback measurement (the server measures every way to play before it accepts a config)
const LONG = { 'money-1008-cfg-bender.js': 'payback measurement, 152 s', 'money-1008-cfg-coldcall.js': 'payback measurement, 136 s', 'money-1008-r2c-bound.js': 'payback bounds, 269 s under load' };
// the older Cold Call / Campaign suites that pin the money rules and that `npm test` did not run
const SUITES = [
  ['coldcall-money.js', 'fast'], ['coldcall-presets.js', 'fast'], ['campaign.js', 'fast'], ['campaign-engine.js', 'fast'],
  ['campaign-money.js', 'server'], ['coldcall-livecfg.js', 'server'],
  ['coldcall-pull-engine.js', 'long'], ['coldcall-pull-server.js', 'long'], ['coldcall.js', 'long'],
];
const TIMEOUT = { fast: 90, server: 240, long: 1200 };            // seconds per file

const args = process.argv.slice(2);
const flag = (f) => args.includes(f), val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const mode = ['--fast', '--money', '--rest', '--all'].find(flag);
if (!mode) { console.error('usage: node tests/run-money-1008.js --fast | --money | --rest | --all  [--only a,b] [--keep-going]'); process.exit(2); }

const dir = __dirname;
const money = fs.readdirSync(dir).filter((f) => /^money-1008-.*\.js$/.test(f)).sort().map((f) => [f, LONG[f] ? 'long' : SERVER[f] ? 'server' : 'fast', 'money']);
const suites = SUITES.map(([f, tier]) => [f, tier, 'suite']).filter(([f]) => fs.existsSync(path.join(dir, f)));
const want = ([, tier, kind]) => (mode === '--all') || (mode === '--fast' && tier === 'fast') || (mode === '--money' && kind === 'money' && tier !== 'long') || (mode === '--rest' && tier !== 'fast');
let list = [...money, ...suites].filter(want);
const only = val('--only'); if (only) { const parts = only.split(','); list = [...money, ...suites].filter(([f]) => parts.some((p) => f.includes(p))); }
if (!list.length) { console.error('run-money-1008: nothing to run'); process.exit(2); }

const env = { ...process.env };
if (env.MONEY_PORT_BASE) for (const k of ['V2_PORT_BASE', 'SESSION_PORT_BASE', 'PROTO_PORT', 'SEAT_PORT', 'R3_PORT', 'K3_PORT']) env[k] = env.MONEY_PORT_BASE;

function runOne([file, tier]) {
  return new Promise((resolve) => {
    const t0 = Date.now(); let out = '', timedOut = false;
    const p = spawn(process.execPath, [path.join(dir, file)], { cwd: path.join(dir, '..'), env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });   // its own process group: a timeout kills the servers it booted too
    const take = (d) => { out = (out + d).slice(-6000); };
    p.stdout.on('data', take); p.stderr.on('data', take);
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-p.pid, 'SIGKILL'); } catch {} }, TIMEOUT[tier] * 1000);
    p.on('close', (code, sig) => {
      clearTimeout(timer);
      try { process.kill(-p.pid, 'SIGKILL'); } catch {}                                  // anything it left running
      const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
      resolve({ file, tier, code: timedOut ? null : code, sig, timedOut, secs: (Date.now() - t0) / 1000, last: (lines[lines.length - 1] || '').slice(0, 110), tail: lines.slice(-12) });
    });
    p.on('error', (e) => resolve({ file, tier, code: null, timedOut: false, secs: 0, last: 'spawn failed: ' + e.message, tail: [] }));
  });
}

(async () => {
  const t0 = Date.now(), bad = [];
  console.log(`run-money-1008 ${mode}: ${list.length} files${env.MONEY_PORT_BASE ? ', ports from ' + env.MONEY_PORT_BASE : ''}`);
  for (const item of list) {
    const r = await runOne(item), ok = r.code === 0 && !r.timedOut;
    console.log(`${ok ? 'ok     ' : r.timedOut ? 'TIMEOUT' : 'FAIL   '} ${r.file.replace(/\.js$/, '').padEnd(34)} exit ${String(r.timedOut ? 'timeout(' + TIMEOUT[r.tier] + 's)' : r.code === null ? r.sig : r.code).padEnd(4)} ${r.secs.toFixed(1).padStart(6)}s  ${r.last}`);
    if (!ok) {
      bad.push(r.file);
      if (r.timedOut) console.log(`         not finished in ${TIMEOUT[r.tier]} s as a ${r.tier}-tier file: if it is honestly slow, list it in SERVER or LONG in tests/run-money-1008.js`);
      for (const l of r.tail.slice(-8)) console.log('         | ' + l.slice(0, 200));
      if (!flag('--keep-going')) break;
    }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`run-money-1008 ${mode}: ${bad.length ? 'FAILED ' + bad.join(', ') : 'all passed'} (${list.length} files${bad.length && !flag('--keep-going') ? ' listed, stopped at the first failure' : ''}, ${secs} s)`);
  process.exit(bad.length ? 1 : 0);
})();
