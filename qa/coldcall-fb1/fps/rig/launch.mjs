// Starts Chrome in Chris's interactive session (the only place the RTX 5090 is visible; over ssh = session 0 there is no GPU)
// through a one-shot scheduled task (schtasks /IT), exactly like projects/bricklord/tools/gpu. Everything lives under E:\bricklord-test\coldcall-fb5.
// Never writes to C: (Chrome profile, TEMP and TMP all point at E:). The task is deleted at stop().
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { sleep } from './cdp.mjs';

const rmdir = (d) => { if (fs.existsSync(d)) try { execFileSync('cmd', ['/c', 'rmdir', '/s', '/q', d], { stdio: 'ignore' }); } catch {} };   // fs.rmSync gives EPERM on Chrome's profile files
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
export async function launchChrome({ root, tag, port = 9333, headful = false, vp = [1440, 900], extraArgs = [], keepProfile = false, freshProfile = true }) {   // keepProfile: leave the profile on disk at stop (a second launch re-uses its GPU / shader caches); freshProfile false: do not wipe it at launch
  const job = path.join(root, 'runs', tag, 'job'); fs.mkdirSync(job, { recursive: true });
  const profile = path.join(root, 'runs', tag, 'profile'); try { execFileSync('powershell', ['-NoProfile', '-File', path.join(root, 'rig', 'cleanup.ps1'), '-Tag', tag], { stdio: 'ignore' }); } catch {}
  await sleep(500); if (freshProfile) rmdir(profile); fs.mkdirSync(path.join(root, 'runs', tag, 'tmp'), { recursive: true });
  const task = 'coldcall-fb5-' + tag.replace(/[^\w-]/g, '_');
  const args = [`--remote-debugging-port=${port}`, '--remote-allow-origins=*', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
    '--enable-precise-memory-info', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion,Translate',
    '--disable-extensions', '--disable-component-update', '--disable-sync', '--metrics-recording-only', '--disable-breakpad', `--window-size=${vp[0]},${vp[1] + (headful ? 140 : 0)}`,
    ...(headful ? ['--window-position=-30000,0'] : ['--headless=new'])   // headful window parked off-screen: real window + DWM presentation, nothing visible on Chris's desktop
    , ...extraArgs, 'about:blank'];
  const cmd = path.join(job, 'chrome.cmd');
  fs.writeFileSync(cmd, ['@echo off', `set "TEMP=${root}\\runs\\${tag}\\tmp"`, `set "TMP=${root}\\runs\\${tag}\\tmp"`, `"${CHROME}" ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`, ''].join('\r\n'));
  const vbs = path.join(root, 'rig', 'hidden.vbs');
  fs.writeFileSync(vbs, `CreateObject("WScript.Shell").Run WScript.Arguments(0), 0, True\r\n`);
  try { execFileSync('schtasks', ['/Delete', '/F', '/TN', task], { stdio: 'ignore' }); } catch {}
  execFileSync('schtasks', ['/Create', '/F', '/TN', task, '/SC', 'ONCE', '/ST', '23:59', '/IT', '/RU', process.env.USERNAME || 'ctkul', '/TR', `wscript.exe //B //Nologo ${vbs} ${cmd}`], { stdio: 'ignore' });
  execFileSync('schtasks', ['/Run', '/TN', task], { stdio: 'ignore' });
  let ver = null;
  for (let i = 0; i < 150 && !ver; i++) { await sleep(200); try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) ver = await r.json(); } catch {} }
  if (!ver) { try { execFileSync('schtasks', ['/Delete', '/F', '/TN', task], { stdio: 'ignore' }); } catch {} throw new Error('Chrome did not come up in 30 s (is Chris logged in on the console? `query session` must show ctkul Active)'); }
  return { ver, ws: ver.webSocketDebuggerUrl, task, port,
    async stop(cdp) {
      try { if (cdp) await Promise.race([cdp.send('Browser.close'), sleep(4000)]); } catch {}
      await sleep(800); try { execFileSync('schtasks', ['/Delete', '/F', '/TN', task], { stdio: 'ignore' }); } catch {}
      try { execFileSync('powershell', ['-NoProfile', '-File', path.join(root, 'rig', 'cleanup.ps1'), '-Tag', tag], { stdio: 'ignore' }); } catch {}
      await sleep(500); if (!keepProfile) rmdir(profile);
    } };
}
