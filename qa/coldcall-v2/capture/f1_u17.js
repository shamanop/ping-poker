// U17: no BIG WIN tier overlay straight after a lost gamble. Seed 46474 on a fresh account at $1 (the critic's c_more.js run): a natural bonus whose trigger spin paid 11.2x, ONE MORE CALL
// taken and lost. PASS = the game never shows #tier (BIG WIN overlay) and ends on the plain total (WIN == totalWin, no mismatch). Starts its own server on 4640 with f1_hooks.js (fresh data
// dir _scratch/srv) and puts the stock one back at the end.
//   node f1_u17.js <play|chips> [seed]
const { spawn, execSync } = require('child_process');
const fs = require('fs'), path = require('path');
const L = require('./f1lib');
const SRV = path.join(L.ROOT, '_scratch', 'srv');
function startSeeded(seed) {
  try { process.kill(+fs.readFileSync(path.join(SRV, 'pid'), 'utf8'), 'SIGTERM'); } catch (e) {} execSync('sleep 0.8');
  fs.rmSync(SRV, { recursive: true, force: true }); fs.mkdirSync(SRV, { recursive: true }); fs.writeFileSync(path.join(SRV, 'bank.json'), '{}'); fs.writeFileSync(path.join(SRV, 'ledger.json'), '[]');
  const log = fs.openSync(path.join(SRV, 'server.log'), 'a');
  const c = spawn('node', ['-r', path.join(__dirname, 'f1_hooks.js'), 'server.js'], { cwd: L.ROOT, detached: true, stdio: ['ignore', log, log], env: { ...process.env, PORT: '4640', COLDCALL_TEST: '1', F1_SEED: String(seed), BANK_FILE: path.join(SRV, 'bank.json'), LEDGER_FILE: path.join(SRV, 'ledger.json') } });
  c.unref(); fs.writeFileSync(path.join(SRV, 'pid'), String(c.pid)); execSync('sleep 2');
}
(async () => {
  const md = process.argv[2] || 'play', seed = +(process.argv[3] || 46474);
  startSeeded(seed);
  try {
    const { browser, ctx } = await L.launch(); const p = await L.page(ctx, L.uniq('f1u')); await L.mode(p, md); await L.setBet(p, 100);
    await p.evaluate(() => { window.__tier = 0; window.__stamps = []; new MutationObserver(() => { if (document.getElementById('tier')) window.__tier++; document.querySelectorAll('.stamp').forEach((n) => { const t = n.firstChild && n.firstChild.textContent; if (t && !window.__stamps.includes(t)) window.__stamps.push(t); }); }).observe(document.body, { childList: true, subtree: true });
      window.__kind = []; });
    await p.click('#spin'); const t0 = Date.now(); let took = false;
    while (Date.now() - t0 < 200000) {
      await L.tapDial(p); const k = await L.promptOpen(p).catch(() => null);
      if (k === 'pick') { await L.sleep(800); const c = await p.evaluate(() => { const s = document.querySelector('.slots i.pick'); if (!s) return null; const r = s.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }); if (c) await p.mouse.click(c[0], c[1]); }
      if (k === 'more' && !took) { await L.sleep(900); await p.click('#pl_more').catch(() => {}); took = true; }
      if (!(await p.evaluate(() => CC.core.st.busy)) && Date.now() - t0 > 2500) break; await L.sleep(120);
    }
    await L.sleep(800);
    const r = await p.evaluate(() => { const row = CC.dbg.rounds[CC.dbg.rounds.length - 1] || {}; return { tierOverlaySeen: window.__tier, stamps: window.__stamps, more: row.more, win: document.getElementById('win').textContent, rowTier: row.tier, totalWin: row.totalWin, mismatch: CC.dbg.mismatch, pageErr: CC.dbg.error || null }; });
    await p.screenshot({ path: L.OUT + '/f1_u17_' + md + '.png' });
    L.out({ scenario: 'U17 lost-gamble-no-tier', mode: md, ok: took && r.more === 'lost' && r.tierOverlaySeen === 0 && r.mismatch.length === 0, tookGamble: took, ...r });
    await browser.close();
  } finally { spawn('bash', [path.join(L.ROOT, '_scratch', 'start4640.sh')], { detached: true, stdio: 'ignore' }).unref(); }
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
