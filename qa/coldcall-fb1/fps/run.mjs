#!/usr/bin/env node
// COLD CALL FB5 frame-time rig, one command:   node qa/coldcall-fb1/fps/run.mjs <baseUrl> <outTag> [--headless] [--no-ablate] [--only-cold | --only-load | --only-ablate --merge-into <tag>] [--no-profile] [--scenes a,b] [--throttles 1,4] [--vp 1440x900] [--seed N] [--quick]
// <baseUrl> = the game's index.html as shaman can reach it, e.g. http://100.104.51.99:4650/games/coldcall/index.html  (127.0.0.1 / localhost are rewritten to this box's tailnet IP)
// Runs on shaman's RTX 5090 (Chris's interactive session via schtasks /IT, Chrome 154, E:\bricklord-test\coldcall-fb5 only), refuses any non-RTX-5090 renderer, then writes
//   qa/coldcall-fb1/fps/<tag>.json and <tag>.md (and OFFENDERS.md for tag "before", OFFENDERS-<tag>.md otherwise).
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2), flag = (n) => argv.includes('--' + n), opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const VALOPTS = ['vp', 'dpr', 'seed', 'throttles', 'scenes', 'ablate-limit', 'merge-into'];
const pos = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && VALOPTS.includes(argv[i - 1].slice(2))));
let [base, tag] = pos; if (!base || !tag) { console.error('usage: node run.mjs <baseUrl> <outTag> [options]  (see the header of this file)'); process.exit(1); }
if (!/^[\w.-]+$/.test(tag)) { console.error('outTag must be [A-Za-z0-9._-]'); process.exit(1); }
const myIp = (() => { try { return execFileSync('tailscale', ['ip', '-4'], { encoding: 'utf8' }).trim().split('\n')[0]; } catch { return '100.104.51.99'; } })();
base = base.replace(/\/\/(127\.0\.0\.1|localhost)/, '//' + myIp);
const E = 'E:/bricklord-test/coldcall-fb5', EW = 'E:\\bricklord-test\\coldcall-fb5';
const sh = (cmd, o = {}) => spawnSync('ssh', ['-o', 'ConnectTimeout=15', 'shaman', cmd], { stdio: o.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 1 << 28 });
// the server must answer from here and shaman must be able to read the same URL
try { const r = await fetch(base.split('?')[0]); if (!r.ok) throw new Error('HTTP ' + r.status); } catch (e) { console.error('base URL does not answer from this box:', base, e.message); process.exit(1); }
const q = sh(`curl.exe -s -o NUL -w %{http_code} ${base.split('?')[0]}`); if (q.stdout.trim() !== '200') { console.error('shaman cannot reach', base, '(curl said', q.stdout.trim() + ')', q.stderr); process.exit(1); }
const [w, h] = (opt('vp', '1440x900')).split('x').map(Number);
const args = { base, tag, vp: [w, h], dpr: +opt('dpr', 0), seed: +opt('seed', 12345), headful: !flag('headless'), ablate: !flag('no-ablate') && !flag('quick'), profile: !flag('no-profile'), vp2: !flag('quick') && !flag('no-phone'), firstLoad: !flag('no-first-load'),
  coldAblate: !flag('no-cold-ablate') && !flag('quick') && !flag('only-ablate'), only: flag('only-cold') ? 'cold' : flag('only-load') ? 'load' : flag('only-ablate') ? 'ablate' : undefined, ablateLimit: +opt('ablate-limit', 99), steady: !flag('no-steady'), throttles: opt('throttles', '1,4').split(',').map(Number), scenes: opt('scenes', '') ? opt('scenes').split(',') : undefined, calibrate: !flag('quick') };
fs.mkdirSync(path.join(HERE, '_tmp'), { recursive: true });
const rigFiles = ['cdp.mjs', 'launch.mjs', 'trace.mjs', 'drive.mjs', 'page.js', 'scenes.js', 'cleanup.ps1'];
sh(`mkdir ${EW}\\rig 2>nul & mkdir ${EW}\\runs\\${tag} 2>nul`);
const scp = spawnSync('scp', ['-q', ...rigFiles.map((f) => path.join(HERE, 'rig', f)), `shaman:${E}/rig/`], { encoding: 'utf8' }); if (scp.status) { console.error('scp failed', scp.stderr); process.exit(1); }
const argsFile = path.join(HERE, '_tmp', tag + '.args.json'); fs.writeFileSync(argsFile, JSON.stringify(args));
spawnSync('scp', ['-q', argsFile, `shaman:${E}/runs/${tag}/args.json`]);
console.log(`[run] ${tag}: ${base} on shaman (${args.headful ? 'headful window parked off-screen' : 'headless=new'}), viewport ${w}x${h}, throttles ${args.throttles}, ablate ${args.ablate}, profile ${args.profile}`);
const r = spawnSync('ssh', ['shaman', `cd /d ${EW}\\rig && node drive.mjs ${EW}\\runs\\${tag}\\args.json`], { stdio: 'inherit' });
const outDir = path.join(HERE, '_tmp', tag); fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });
spawnSync('scp', ['-q', '-r', `shaman:${E}/runs/${tag}/out/.`, outDir]);
if (fs.existsSync(path.join(outDir, 'renderer-FAIL.json'))) { console.error('REFUSED: the browser on shaman is not on the RTX 5090. See', path.join(outDir, 'renderer-FAIL.json')); process.exit(3); }
if (!fs.existsSync(path.join(outDir, 'result.json'))) { console.error('no result.json came back (exit', r.status + ')'); process.exit(1); }
fs.copyFileSync(path.join(outDir, 'result.json'), path.join(HERE, tag + '.json'));
let rtag = tag;
if (opt('merge-into') && fs.existsSync(path.join(HERE, opt('merge-into') + '.json'))) {   // --only-cold runs fold their cold-start experiment into an existing run
  const dst = path.join(HERE, opt('merge-into') + '.json'), A_ = JSON.parse(fs.readFileSync(dst, 'utf8')), B_ = JSON.parse(fs.readFileSync(path.join(HERE, tag + '.json'), 'utf8'));
  if (B_.coldAblation) { A_.coldAblation = B_.coldAblation; A_.sessions = [...A_.sessions.filter((x) => !String(x.session).startsWith('C:')), ...B_.sessions]; }
  if (B_.firstLoad && args.only === 'load') A_.firstLoad = B_.firstLoad;
  if (B_.ablation && args.only === 'ablate') A_.ablation = B_.ablation; A_.elapsedS = (A_.elapsedS || 0) + (B_.elapsedS || 0); A_.finishedAt = B_.finishedAt; A_.mergedColdFrom = tag;
  fs.writeFileSync(dst, JSON.stringify(A_)); fs.rmSync(path.join(HERE, tag + '.json')); rtag = opt('merge-into');
}
const rp = spawnSync(process.execPath, [path.join(HERE, 'report.mjs'), path.join(HERE, rtag + '.json')], { stdio: 'inherit' });
// shaman housekeeping: our run folder (profile, tmp, job) goes; the rig files stay (a few KB)
sh(`rmdir /s /q ${EW}\\runs\\${tag}`);
fs.rmSync(outDir, { recursive: true, force: true });
process.exit(r.status || rp.status || 0);
