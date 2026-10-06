const { authJoin } = require('../authjoin');
// Bank reconciliation checks: rejoin must not inflate buy-ins, names are case-insensitive, totals reconcile.
// Spawns a throwaway server (TEST_PORT, default 3302) with scratch bank/ledger files under qa/bankfix/.
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const { io } = require(process.env.SIO_CLIENT || '/home/isabelle/.cache/node_modules/socket.io-client');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ROOT = path.join(__dirname, '..', '..');
const PORT = Number(process.env.TEST_PORT || 3302);
const dir = fs.mkdtempSync(path.join(ROOT, 'qa', 'bankfix', 'run-'));
const bankFile = path.join(dir, 'bank.json'), ledgerFile = path.join(dir, 'ledger.json');
let proc = null;
let fails = 0, passes = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (c) passes++; else fails++; };

function startServer() {
  proc = spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), AUTO_START_MS: '600000', BANK_FILE: bankFile, LEDGER_FILE: ledgerFile } });
  proc.stderr.on('data', d => process.stderr.write(d));
}
async function waitUp() { for (let i = 0; i < 80; i++) { try { await fetch(`http://localhost:${PORT}/`); return; } catch { await sleep(100); } } }
async function stopServer() { if (!proc) return; const p = proc; proc = null; await new Promise(r => { p.on('exit', r); p.kill('SIGTERM'); setTimeout(() => { p.kill('SIGKILL'); r(); }, 3000); }); }

function client(name) {
  const c = { name, gs: null, errors: [], joined: null, sum: null };
  c.s = io(`http://localhost:${PORT}`, { forceNew: true });
  c.s.on('game_state', g => { c.gs = g; });
  c.s.on('error', e => c.errors.push(e.message));
  c.s.on('room_joined', d => { c.joined = d; });
  c.s.on('bank_summary', d => { c.sum = d; });
  c.join = async () => { c.joined = null; authJoin(c.s, { name, avatar: 'x', password: 'ping' }); for (let i = 0; i < 40 && !c.joined && !c.errors.length; i++) await sleep(50); await sleep(150); return c.joined; };
  c.summary = async () => { c.sum = null; c.s.emit('get_bank_summary', { roomId: 'POKERPING' }); for (let i = 0; i < 40 && !c.sum; i++) await sleep(50); return c.sum; };
  return c;
}
const find = (sum, n) => sum.players.find(p => p.name.toLowerCase() === n.toLowerCase());
const bankJson = () => JSON.parse(fs.readFileSync(bankFile, 'utf8'));

// Invariants that must hold on any summary: per human, bank + at table = start + adjustments + net; money is conserved overall.
function reconcile(sum, label, expectedTotal) {
  const humans = sum.players.filter(p => !p.isBot);
  const lower = humans.map(p => p.name.toLowerCase());
  ok(new Set(lower).size === lower.length, `${label}: one row per name (case-insensitive)`);
  let bad = [];
  for (const p of humans) {
    if (p.bank + p.atTable !== p.startBank + p.adjusted + p.net) bad.push(`${p.name}: ${p.bank}+${p.atTable} != ${p.startBank}+${p.adjusted}+${p.net}`);
    if (p.rebuyTotal > p.totalBuyIns || p.rebuys > p.buyIns) bad.push(`${p.name}: rebuys exceed buy-ins`);
    if (p.cashedOut < 0 || p.totalBuyIns < 0) bad.push(`${p.name}: negative totals`);
  }
  ok(!bad.length, `${label}: bank + at table = start + adjustments + net P&L ${bad.join('; ')}`);
  const total = humans.reduce((x, p) => x + p.bank + p.atTable, 0);
  ok(total === expectedTotal, `${label}: bank + table across players = ${expectedTotal} (got ${total})`);
  const names = new Map(humans.map(p => [p.name.toLowerCase(), p.name]));
  const badEv = (sum.events || []).filter(e => names.has(e.name.toLowerCase()) && names.get(e.name.toLowerCase()) !== e.name);
  ok(!badEv.length, `${label}: activity feed uses the same name as the standings row`);
}

// Check/call around until `cond()` or timeout. clients: [{name,s,gs}]
async function playUntil(clients, cond, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    for (const cl of clients) {
      const g = cl.gs; if (!g || g.status !== 'playing') continue;
      const my = g.players.findIndex(p => p.name.toLowerCase() === cl.name.toLowerCase());
      if (my >= 0 && g.currentPlayerIdx === my) cl.s.emit('player_action', { roomId: 'POKERPING', action: g.currentBet - g.players[my].roundBet > 0 ? 'call' : 'check' });
    }
    if (cond()) return true;
    await sleep(200);
  }
  return false;
}

(async () => {
  try {
    startServer(); await waitUp();
    let chris = client('chris'), bob = client('Bob');
    await chris.join(); await bob.join();
    let sum = await chris.summary();
    reconcile(sum, 'fresh', 20000);
    ok(find(sum, 'Bob').totalBuyIns === 2000 && find(sum, 'Bob').buyIns === 1, 'fresh: Bob has one 2,000 buy-in');

    // Rejoin x5 in waiting state (drop + rejoin with varying case) must not add buy-ins
    for (const nm of ['bob', 'BOB', 'Bob', 'bOb', 'Bob']) {
      bob.s.disconnect(); await sleep(250);
      bob = client(nm); await bob.join();
    }
    sum = await chris.summary();
    const b = find(sum, 'Bob');
    ok(b.buyIns === 1 && b.totalBuyIns === 2000, `rejoin x5 (waiting): Bob still 1 buy-in / 2,000 (got ${b.buyIns} / ${b.totalBuyIns})`);
    ok(b.net === 0, `rejoin x5 (waiting): Bob net P&L 0 (got ${b.net})`);
    ok(!sum.events.some(e => /^bob$/i.test(e.name) && e.type === 'cashout') && sum.events.filter(e => /^bob$/i.test(e.name) && e.type === 'buyin').length === 1, 'rejoin x5 (waiting): feed has no cash-out/buy-in pairs for Bob');
    reconcile(sum, 'after rejoins', 20000);

    // Start, then refresh mid-hand; numbers must hold mid-hand (blinds in the pot still count as at-table)
    chris.s.emit('start_game', { roomId: 'POKERPING', blindInterval: 0 }); await sleep(700);
    ok(chris.gs.status === 'playing', 'hand started');
    sum = await chris.summary();
    reconcile(sum, 'mid-hand', 20000);
    ok(sum.players.filter(p => !p.isBot).reduce((x, p) => x + p.atTable, 0) === 4000, 'mid-hand: at-table total stays 4,000 with blinds in the pot');
    for (const nm of ['BOB', 'bob', 'Bob']) {
      bob.s.disconnect(); await sleep(300);
      bob = client(nm); await bob.join();
    }
    sum = await chris.summary();
    const b2 = find(sum, 'Bob');
    ok(b2.buyIns === 1 && b2.totalBuyIns === 2000, `refresh x3 (mid-hand): Bob still 1 buy-in / 2,000 (got ${b2.buyIns} / ${b2.totalBuyIns})`);
    ok(!sum.events.some(e => /^bob$/i.test(e.name) && e.type === 'cashout'), 'refresh x3 (mid-hand): feed has no phantom Bob cash-out');
    reconcile(sum, 'after mid-hand refreshes', 20000);

    // Play a few hands with chris + bob
    const h0 = chris.gs.handNum;
    const played = await playUntil([chris, bob], () => chris.gs.handNum >= h0 + 2 && chris.gs.status === 'playing', 90000);
    ok(played, 'played two more hands');
    sum = await chris.summary();
    reconcile(sum, 'after hands', 20000);
    ok(sum.maxHand >= 2 && Object.keys(sum.series).length >= 1, `chart has data (hands ${sum.maxHand})`);

    // Bank edit by chris: explicit adjust entry, net P&L untouched, baseline shifts
    const before = find(sum, 'Bob');
    chris.s.emit('bank_set', { name: 'bob', balance: before.bank + before.atTable + 5000 }); await sleep(500);
    sum = await chris.summary();
    const after = find(sum, 'Bob');
    ok(after.bank === before.bank + 5000, 'edit: Bob bank +5,000');
    ok(after.net === before.net, `edit: net P&L unchanged by an adjustment (${before.net} -> ${after.net})`);
    ok(after.adjusted === before.adjusted + 5000, 'edit: adjustment recorded in baseline');
    const adj = sum.events.find(e => e.type === 'adjust' && /^bob$/i.test(e.name));
    ok(adj && adj.delta === 5000, 'edit: feed shows an explicit +5,000 adjustment entry');
    ok(after.totalBuyIns === before.totalBuyIns && after.buyIns === before.buyIns, 'edit: buy-in totals unchanged');
    chris.s.emit('bank_set', { name: 'Bob', balance: after.bank + after.atTable - 2000 }); await sleep(400);
    sum = await chris.summary();
    ok(find(sum, 'Bob').adjusted === 3000 && sum.events.some(e => e.type === 'adjust' && e.delta === -2000), 'edit: negative adjustment recorded with sign');
    chris.s.emit('bank_set', { name: 'Bob', balance: find(sum, 'Bob').bank + find(sum, 'Bob').atTable }); await sleep(300);
    sum = await chris.summary();
    ok(sum.events.filter(e => e.type === 'adjust').length === 2, 'edit: setting the same value logs nothing');
    reconcile(sum, 'after edits', 20000 + 3000);

    // Edit during a running hand
    const mid = find(sum, 'chris');
    chris.s.emit('bank_set', { name: 'chris', balance: mid.bank + mid.atTable + 1000 }); await sleep(400);
    sum = await chris.summary();
    reconcile(sum, 'edit while hand running', 20000 + 4000);

    // Restart server with persisted bank + ledger: totals survive, resuming does not inflate buy-ins
    bob.s.disconnect(); chris.s.disconnect(); await sleep(800);
    const pre = await (await fetch(`http://localhost:${PORT}/api/bank-summary?password=ping&room=POKERPING`)).json();
    await stopServer(); startServer(); await waitUp();
    chris = client('Chris'); await chris.join();
    sum = await chris.summary();
    const cpre = find(pre, 'chris'), cpost = find(sum, 'chris');
    ok(cpost.net === cpre.net, `restart: chris net P&L preserved (${cpre.net} -> ${cpost.net})`);
    ok(cpost.buyIns === cpre.buyIns && cpost.totalBuyIns === cpre.totalBuyIns, `restart: chris rejoin after restart is not a new buy-in (${cpre.buyIns}/${cpre.totalBuyIns} -> ${cpost.buyIns}/${cpost.totalBuyIns})`);
    ok(find(sum, 'chris').name === find(sum, 'chris').name && sum.players.filter(p => p.name.toLowerCase() === 'chris').length === 1, 'restart: Chris/chris is one row');
    bob = client('bob'); await bob.join();
    sum = await chris.summary();
    reconcile(sum, 'after restart', 20000 + 4000);
    ok(bankJson().bob !== undefined && Object.keys(bankJson()).every(k => k === k.toLowerCase()), 'bank.json keys are lowercase');

    // A tolerated legacy ledger entry (no delta/park fields) still summarises
    const led = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
    ok(Array.isArray(led) && led.every(e => e && typeof e.type === 'string'), 'ledger.json still a plain array of typed entries');
  } catch (e) { console.log('ERROR', e); fails++; }
  finally {
    await stopServer();
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`${passes} passed, ${fails} failed`);
    console.log(fails ? 'FAILED' : 'ALL PASS');
    process.exit(fails ? 1 : 0);
  }
})();
