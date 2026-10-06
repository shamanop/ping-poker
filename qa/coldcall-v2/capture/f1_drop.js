// U6 / P4 / U11 / U7: a dropped line. ONE MORE CALL (or PICK) open, then:
//   drop    the transport is closed under the page (socket.io reconnects). Server: banked (auto 'disconnect'). PASS = prompt gone <= 1.5 s, one line "Line dropped: your call was banked: <amount>"
//           with the amount the server history says, never "refunded", the screen free (not busy) <= 8 s after the drop.
//   reload  the page is reloaded. PASS = after the new page connects one line "Your open call was banked: <amount>" (amount from the history), screen idle, no replay.
//   restart the server restarts with the data kept (the open round is voided and refunded). PASS = line "That call was cancelled. Your bet is refunded.", never "banked",
//           the wallet back to what it was before the spin, screen free <= 3 s after the page is live again.
//   node f1_drop.js <drop|reload|restart> <play|chips> [pick|more]
const { spawn, execSync } = require('child_process');
const fs = require('fs'), path = require('path');
const L = require('./f1lib');
const SRV = path.join(L.ROOT, '_scratch', 'srv');
function restartKeep() {
  try { process.kill(+fs.readFileSync(path.join(SRV, 'pid'), 'utf8'), 'SIGTERM'); } catch (e) {} execSync('sleep 0.8');
  const log = fs.openSync(path.join(SRV, 'server.log'), 'a');
  const c = spawn('node', ['server.js'], { cwd: L.ROOT, detached: true, stdio: ['ignore', log, log], env: { ...process.env, PORT: '4640', COLDCALL_TEST: '1', BANK_FILE: path.join(SRV, 'bank.json'), LEDGER_FILE: path.join(SRV, 'ledger.json') } });
  c.unref(); fs.writeFileSync(path.join(SRV, 'pid'), String(c.pid));
}
const watch = (p) => p.evaluate(() => { window.__lines = []; const seen = new Set(); const log = (t, src) => { if (t && !seen.has(src + t)) { seen.add(src + t); window.__lines.push({ t: performance.now(), text: t, src }); } };
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.classList && n.classList.contains('toast')) log(n.textContent, 'toast'); }))).observe(document.getElementById('stage'), { childList: true });
  const s0 = CC.caption.say; CC.caption.say = (g, t) => { if (t) log(t, 'caption'); return s0(g, t); }; });
(async () => {
  const kind = process.argv[2] || 'drop', md = process.argv[3] || 'play', want = process.argv[4] || 'more';
  const { browser, ctx } = await L.launch(); const name = L.uniq('f1d'); let p = await L.page(ctx, name); await L.mode(p, md); await L.setBet(p, 10); await p.click('#turbo');
  const sw = await L.sock(name); const w0 = (await L.sstate(sw)).wallet[md]; sw.close(); const spinCost = await p.evaluate(() => 0);
  if (!(await L.reach(p, want))) throw new Error('no ' + want + ' prompt');
  await L.sleep(1200); await watch(p); let r = {};
  const fmt = (c) => (md === 'chips' ? Math.round(c).toLocaleString('en-US') + ' chips' : '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2 }));
  if (kind === 'drop') {
    const t0 = Date.now(); await p.evaluate(() => { window.__t0 = performance.now(); CC.core.T.sock.io.engine.close(); });
    let goneAt = null, freeAt = null; for (let i = 0; i < 160; i++) { const k = await L.promptOpen(p).catch(() => 'x'); const busy = await p.evaluate(() => CC.core.st.busy).catch(() => true); if (goneAt == null && !k) goneAt = Date.now() - t0; if (!busy && freeAt == null) { freeAt = Date.now() - t0; break; } await L.sleep(100); }
    await L.sleep(800); const lines = await p.evaluate(() => window.__lines.map((x) => x.text));
    const s = await L.sock(name); const h = (await L.shist(s)).rounds[0]; s.close();
    const banked = lines.find((t) => /^Line dropped: your call was banked: /.test(t)), refunded = lines.some((t) => /refunded/i.test(t));
    r = { ok: !!banked && !refunded && goneAt != null && goneAt <= 1500 && freeAt != null && freeAt <= 8000 && banked.endsWith(fmt(h.totalWin)), promptGoneMs: goneAt, freeMs: freeAt, lines, serverAuto: h.auto, serverTotalWin: h.totalWin };
  } else if (kind === 'reload') {
    await p.addInitScript(() => { window.__lines = []; new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.classList && n.classList.contains('toast')) window.__lines.push({ text: n.textContent }); }))).observe(document, { childList: true, subtree: true }); });   // before the new page runs: the line can come within a second of its connect
    await p.reload(); await p.waitForFunction(() => window.CC && CC.ready && CC.core.st.live, null, { timeout: 30000 }); await L.sleep(4000);
    const lines = await p.evaluate(() => window.__lines.map((x) => x.text)), busy = await p.evaluate(() => CC.core.st.busy), replay = await p.evaluate(() => CC.dbg.rounds.length);
    const s = await L.sock(name); const h = (await L.shist(s)).rounds[0]; s.close();
    const line = lines.find((t) => /^Your open call was banked: /.test(t));
    r = { ok: !!line && !busy && replay === 0 && line.endsWith(fmt(h.totalWin)) && h.auto === 'disconnect', lines, busy, roundsReplayed: replay, serverAuto: h.auto, serverTotalWin: h.totalWin };
  } else {
    const t0 = Date.now(); restartKeep();
    await p.waitForFunction(() => CC.core.T.sock && CC.core.T.sock.connected, null, { timeout: 40000 }).catch(() => {}); const tLive = Date.now();
    let freeAt = null; for (let i = 0; i < 300; i++) { const busy = await p.evaluate(() => CC.core.st.busy).catch(() => true); if (!busy) { freeAt = Date.now() - tLive; break; } await L.sleep(100); }
    await L.sleep(500); const lines = await p.evaluate(() => window.__lines.map((x) => x.text));
    const s = await L.sock(name); const w1 = (await L.sstate(s)).wallet[md]; s.close();
    const canc = lines.some((t) => /^That call was cancelled\. Your bet is refunded\.$/.test(t)), banked = lines.some((t) => /banked/i.test(t));
    r = { ok: canc && !banked && freeAt != null && freeAt <= 3000 && w1 === w0, reconnectedMs: tLive - t0, freeAfterReconnectMs: freeAt, lines, walletBefore: w0, walletAfter: w1 };
  }
  L.out({ scenario: 'drop-' + kind + '-' + want, mode: md, ...r }); await browser.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
