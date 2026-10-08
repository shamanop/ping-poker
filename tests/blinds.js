// Host/admin can edit blinds on POKERPING (mid-hand changes apply next hand); Cash buy-in at POKERPING costs exactly its dollar value. Port 4874.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { io } = require(process.env.SIO_CLIENT || '/home/isabelle/.cache/node_modules/socket.io-client');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppbl-'));
const PORT = Number(process.env.TEST_PORT || 4874), ROOT = path.join(__dirname, '..');
const ADMIN_CLAIM = 'test-admin-claim-1008';   // ADMIN_CLAIM_PASSWORD for the spawned server; the admin account `chris` is claimable ONLY with this (never the room word)
const env = { SIGNUP_PLAY_CENTS: '1000000', ...process.env, ADMIN_CLAIM_PASSWORD: ADMIN_CLAIM, PORT: String(PORT), BANK_FILE: path.join(dir, 'bank.json'), LEDGER_FILE: path.join(dir, 'ledger.json'), ACCOUNTS_FILE: path.join(dir, 'acc.json'), TABLES_FILE: path.join(dir, 'tables.json'), WALLET_FILE: path.join(dir, 'wallet.json'), AUTO_START_MS: '300' };
let proc = spawn('node', ['server.js'], { cwd: ROOT, env, stdio: 'ignore' });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const cl = () => { const c = { ev: [] }; c.s = io(`http://localhost:${PORT}`, { forceNew: true }); c.s.onAny((e, d) => c.ev.push([e, d])); c.last = e => { const h = c.ev.filter(x => x[0] === e); return h.length ? h[h.length - 1][1] : undefined; }; c.has = e => c.ev.some(x => x[0] === e); return c; };
const up = async () => { for (let i = 0; i < 60; i++) { try { await fetch(`http://localhost:${PORT}/`); return; } catch { await sleep(100); } } };
(async () => {
  try {
    await up();
    const ch = cl(), b = cl(); await sleep(300);
    ch.s.emit('auth_claim', { name: 'chris', pin: '4321', avatar: 'x', roomPassword: ADMIN_CLAIM }); await sleep(500);
    b.s.emit('auth_signup', { name: 'Bob', pin: '1234', avatar: 'x' }); await sleep(400);
    ch.s.emit('table_preview', { code: 'POKERPING' }); await sleep(300);
    const pi = ch.last('table_info'); ok(pi && pi.table.sb === 25 && pi.table.bb === 50, 'POKERPING room blinds are 25/50 ($0.25/$0.50), got ' + (pi && pi.table.sb + '/' + pi.table.bb));
    ch.s.emit('admin_set_play', { key: 'bob', cents: 5000 }); await sleep(300);
    b.s.emit('wallet_get'); await sleep(300); const w0 = b.last('wallet');
    b.s.emit('table_join', { tableId: 'POKERPING', buyIn: 2000, fund: 'play' }); await sleep(400);
    b.s.emit('wallet_get'); await sleep(300); const w1 = b.last('wallet');
    ok(b.has('table_joined') && w1.play === w0.play - 2000 && w1.chips === w0.chips, '$20 Cash buy-in at POKERPING takes exactly $20 (' + w0.play + ' -> ' + w1.play + ') and sits with 2000 ($20)');
    ch.s.emit('table_join', { tableId: 'POKERPING', buyIn: 2000 }); await sleep(1500);
    const gs = ch.last('game_state') || {};
    ok(gs.status === 'playing' || gs.street, 'hand running (status ' + gs.status + ')');
    ch.ev.length = 0; ch.s.emit('table_update', { tableId: 'POKERPING', patch: { blinds: { sb: 50, bb: 100 } } }); await sleep(300);
    ok(!ch.has('error'), 'blinds edit accepted mid-hand ' + JSON.stringify(ch.last('error') || ''));
    const g2 = ch.last('game_state') || gs; ok(g2.bb === 50, 'current hand keeps $0.50 big blind (bb ' + g2.bb + ')');
    b.ev.length = 0; b.s.emit('table_update', { tableId: 'POKERPING', patch: { blinds: { sb: 1, bb: 2 } } }); await sleep(300);
    ok(b.last('error') && b.last('error').code === 'not_host', 'non-admin cannot change blinds');
    ch.ev.length = 0; ch.s.emit('table_update', { tableId: 'POKERPING', patch: { blinds: { sb: 100, bb: 50 } } }); await sleep(300);
    ok(ch.last('error'), 'small >= big refused');
    // finish the hand: everyone folds/checks until a new hand starts
    for (let i = 0; i < 80; i++) {
      for (const c of [ch, b]) c.s.emit('player_action', { roomId: 'POKERPING', action: 'fold' });
      await sleep(250);
      const g = ch.last('game_state'); if (g && g.bb === 100) break;
    }
    const g3 = ch.last('game_state') || {}; ok(g3.bb === 100 && g3.sb === 50, 'next hand uses $0.50/$1 (' + g3.sb + '/' + g3.bb + ')');
    // survives restart
    ch.s.close(); b.s.close(); proc.kill(); await sleep(600);
    proc = spawn('node', ['server.js'], { cwd: ROOT, env, stdio: 'ignore' }); await up();
    const c2 = cl(); await sleep(300); c2.s.emit('auth_login', { name: 'chris', pin: '4321' }); await sleep(400);
    c2.s.emit('table_preview', { code: 'POKERPING' }); await sleep(300);
    const p2 = c2.last('table_info'); ok(p2 && p2.table.bb === 100 && p2.table.blinds.bb === 100, 'POKERPING blinds survive a restart (' + (p2 && p2.table.sb + '/' + p2.table.bb) + ')');
    c2.s.close();
  } catch (e) { console.error(e); fails++; }
  proc.kill(); fs.rmSync(dir, { recursive: true, force: true });
  console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
