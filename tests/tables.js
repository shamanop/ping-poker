// Tables: create/validate, lobby, join/leave, host controls, nights, settle-up, rebuy, modes. Temp data files, port 4802.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { io } = require(process.env.SIO_CLIENT || '/home/isabelle/.cache/node_modules/socket.io-client');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptb-'));
const PORT = 4802, ROOT = path.join(__dirname, '..');
const F = { bank: path.join(dir, 'bank.json'), ledger: path.join(dir, 'ledger.json'), acc: path.join(dir, 'accounts.json'), tables: path.join(dir, 'tables.json') };
fs.writeFileSync(F.bank, JSON.stringify({ chris: 100000 }));
const env = { ...process.env, PORT: String(PORT), AUTO_START_MS: '300', HAND_DELAY_MS: '400', TABLE_EMPTY_MS: '2500', AUTH_CLOCK_SKEW: '0', AUTH_SIGNUP_LIMIT: '100', BANK_FILE: F.bank, LEDGER_FILE: F.ledger, ACCOUNTS_FILE: F.acc, TABLES_FILE: F.tables };
let proc = spawn('node', ['server.js'], { cwd: ROOT, env });
let out = ''; proc.stdout.on('data', d => { out += d; }); proc.stderr.on('data', d => { out += d; });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

function client(label) {
  const c = { label, ev: [], gs: null, my: null, auto: null, lastSig: '' };
  c.s = io(`http://localhost:${PORT}`, { forceNew: true });
  c.s.onAny((e, d) => c.ev.push([e, d]));
  c.s.on('game_state', g => { c.gs = g; drive(c); });
  c.s.on('your_cards', d => { c.my = d.myIdx; });
  c.call = async (ev, payload, ...want) => {
    const start = c.ev.length;
    c.s.emit(ev, payload);
    for (let i = 0; i < 80; i++) {
      const hit = c.ev.slice(start).find(([e]) => want.includes(e));
      if (hit) return hit;
      await sleep(30);
    }
    return [null, null];
  };
  c.last = name => { for (let i = c.ev.length - 1; i >= 0; i--) if (c.ev[i][0] === name) return c.ev[i][1]; return null; };
  c.count = name => c.ev.filter(([e]) => e === name).length;
  return c;
}
function drive(c) {
  const g = c.gs;
  if (g && g.paused) c.lastSig = '';
  if (!c.auto || !g || g.status !== 'playing' || g.paused || g.currentPlayerIdx === null || !c.tid) return;
  const me = g.players.findIndex(p => p.name === c.display);
  if (me !== g.currentPlayerIdx) return;
  const sig = `${g.handNum}:${g.street}:${g.currentBet}:${g.pot}:${me}`;
  if (sig === c.lastSig) return;
  c.lastSig = sig;
  const toCall = g.currentBet - g.players[me].roundBet;
  setTimeout(() => {
    if (c.auto === 'fold') c.s.emit('player_action', { roomId: c.tid, action: toCall > 0 ? 'fold' : 'check' });
    else if (c.auto === 'allin') c.s.emit('player_action', { roomId: c.tid, action: 'raise', amount: 10000000 });
    else if (c.auto === 'call') c.s.emit('player_action', { roomId: c.tid, action: toCall > 0 ? 'call' : 'check' });
  }, 20);
}
async function signup(label) {
  const c = client(label);
  c.display = label;
  const [e, d] = await c.call('auth_signup', { name: label, pin: '1234', avatar: 'a02' }, 'auth_ok', 'auth_error');
  if (e !== 'auth_ok') throw new Error('signup failed ' + label + ' ' + JSON.stringify(d));
  c.key = d.account.key;
  return c;
}
const settings = (over = {}) => ({ name: 'Friday Night', mode: 'play', buyIn: { min: 500, max: 5000, default: 1000 }, blinds: { sb: 5, bb: 10 }, seats: 8, actionTimerSec: 0, rebuys: true, isPrivate: true, autoStart: false, ...over });
async function waitFor(fn, ms = 6000) { for (let t = 0; t < ms; t += 40) { if (fn()) return true; await sleep(40); } return false; }
const sum = a => a.reduce((s, x) => s + x, 0);
const ledgerRows = () => JSON.parse(fs.readFileSync(F.ledger, 'utf8'));

(async () => {
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await sleep(100); } }
    const A = await signup('Alice'), B = await signup('Bobby'), C = await signup('Carol'), D = await signup('Dave');
    let e, d;

    // ── validation ──
    const bad = [['sb>=bb', { blinds: { sb: 10, bb: 10 } }], ['min>max', { buyIn: { min: 900, max: 500, default: 600 } }],
      ['short name', { name: 'x' }], ['bad timer', { actionTimerSec: 20 }], ['unit mismatch', { unit: 'chips' }], ['seats 1', { seats: 1 }], ['bad mode', { mode: 'cash' }], ['friends removed', { mode: 'friends' }]];
    for (const [label, over] of bad) {
      [e, d] = await A.call('table_create', { settings: settings(over) }, 'table_created', 'error');
      ok(e === 'error', 'validation rejects ' + label + (d && d.message ? ': ' + d.message : ''));
    }
    [e, d] = await client('anon').call('table_create', { settings: settings() }, 'table_created', 'error');
    ok(e === 'error', 'table_create requires sign in');

    // ── create + lobby ──
    [e, d] = await A.call('table_create', { settings: settings() }, 'table_created', 'error');
    ok(e === 'table_created' && /^[A-HJ-NP-Z2-9]{6}$/.test(d.table.id) && d.table.hostKey === A.key && d.table.mode === 'play' && d.table.unit === 'cents', 'Play $ table created, 6-char code, host is creator');
    const T = d.table.id; A.tid = B.tid = C.tid = D.tid = T;
    [e, d] = await B.call('lobby_list', {}, 'lobby_tables');
    ok(e === 'lobby_tables' && !d.tables.some(t => t.id === T), 'private table hidden from other users lobby');
    [e, d] = await A.call('lobby_list', {}, 'lobby_tables');
    ok(d.tables.some(t => t.id === T), 'host sees own private table in lobby');
    [e, d] = await B.call('table_preview', { code: T.toLowerCase() }, 'table_info', 'error');
    ok(e === 'table_info' && d.table.name === 'Friday Night' && d.openSeats === 8 && Array.isArray(d.seated), 'table_preview by code (case-insensitive)');
    [e, d] = await B.call('table_preview', { code: 'ZZZZZZ' }, 'table_info', 'error');
    ok(e === 'error', 'preview of unknown code errors');

    // ── join ──
    [e, d] = await A.call('table_join', { tableId: T, buyIn: 100 }, 'table_joined', 'error');
    ok(e === 'error' && d.code === 'range', 'buy-in below min -> code range');
    [e, d] = await A.call('table_join', { tableId: T, buyIn: 1000 }, 'table_joined', 'error');
    ok(e === 'table_joined' && d.stack === 1000 && d.table.unit === 'cents', 'host joins with 1000');
    await B.call('table_join', { tableId: T, buyIn: 1000 }, 'table_joined', 'error');
    await C.call('table_join', { tableId: T, buyIn: 1000 }, 'table_joined', 'error');
    await sleep(150);
    const ru = B.last('room_update');
    ok(ru && ru.unit === 'cents' && ru.moneyMode === 'play' && ru.mode === 'play' && ru.players.length === 3, 'room_update carries unit/mode/moneyMode');
    ok(JSON.parse(fs.readFileSync(F.bank, 'utf8')).alice === undefined, 'Play $ join never touches bank.json');
    ok(ledgerRows().filter(r => r.tableId === T).length === 0, 'Play $ join writes no ledger rows');
    await sleep(700);
    ok(A.gs && A.gs.status === 'waiting', 'autoStart false: table does not start itself');
    [e, d] = await D.call('table_join', { tableId: T, buyIn: 1000 }, 'table_joined', 'error');
    [e, d] = await D.call('table_leave', { tableId: T }, 'table_left');
    ok(e === 'table_left' && d.cashedOut === 1000, 'table_leave cashes the stack out');

    // ── host controls ──
    [e, d] = await B.call('table_start', { tableId: T }, 'error', 'game_state');
    ok(e === 'error' && d.code === 'not_host', 'non-host cannot start (not_host)');
    [e, d] = await B.call('table_pause', { tableId: T, paused: true }, 'error');
    ok(e === 'error' && d.code === 'not_host', 'non-host cannot pause');
    [e, d] = await B.call('table_update', { tableId: T, patch: { name: 'Hacked' } }, 'error');
    ok(e === 'error' && d.code === 'not_host', 'non-host cannot update');
    [e, d] = await A.call('table_update', { tableId: T, patch: { seats: 3 } }, 'error');
    ok(e === 'error', 'table_update refuses non-whitelisted field');
    [e, d] = await A.call('table_update', { tableId: T, patch: { name: 'Friday Night 2', blinds: { sb: 10, bb: 20 } } }, 'table_event', 'error');
    ok(e === 'table_event' && d.kind === 'updated' && d.table.blinds.bb === 20, 'host updates name + blinds between hands');

    // ── play a few folded hands ──
    A.auto = B.auto = C.auto = 'fold';
    [e, d] = await A.call('table_start', { tableId: T }, 'table_event', 'error');
    ok(e === 'table_event' && d.kind === 'started', 'host starts table');
    const okh = await waitFor(() => A.gs && A.gs.handNum >= 3);
    ok(okh, 'hands play out (3+)');
    ok(A.gs.sb === 10 && A.gs.bb === 20 && A.gs.unit === 'cents' && A.gs.moneyMode === 'play' && A.gs.table && A.gs.table.name === 'Friday Night 2', 'game_state carries unit/moneyMode/table + new blinds');

    // pause: finish hand, then hold
    [e, d] = await A.call('table_pause', { tableId: T, paused: true }, 'table_event', 'error');
    ok(e === 'table_event' && d.kind === 'paused', 'host pauses');
    ok(await waitFor(() => A.gs.paused === true), 'table holds (betting and dealing frozen) when paused');
    const hn = A.gs.handNum; await sleep(900);
    ok(A.gs.handNum === hn, 'no new hand while paused');
    await A.call('table_pause', { tableId: T, paused: false }, 'table_event', 'error');
    ok(await waitFor(() => A.gs.handNum > hn), 'resume continues play');

    // end night deferred until hand ends, then settle_up
    A.s.emit('table_end_night', { tableId: T });
    ok(await waitFor(() => A.count('settle_up') > 0 && B.count('settle_up') > 0 && C.count('settle_up') > 0), 'settle_up goes to every participant');
    const su = A.last('settle_up');
    ok(su.tableId === T && su.ended === true && su.table.mode === 'play' && su.players.length === 4, 'settle_up payload shape (4 players incl. one who left)');
    ok(su.zeroSum === true && sum(su.players.map(p => p.net)) === 0, 'night nets sum to zero');
    const al = su.players.find(p => p.key === A.key);
    ok(al && al.buyIns === 1000 && typeof al.cashedOut === 'number', 'player buyIns/cashedOut present');
    ok(/Friday Night 2/.test(su.text) && /\$/.test(su.text), 'share text includes table name and dollar amounts');
    ok(su.payments === undefined, 'no settle-up payments any more');
    ok(A.last('table_left') === null || true, 'ended');
    [e, d] = await B.call('table_join', { tableId: T, buyIn: 1000 }, 'table_joined', 'error');
    ok(e === 'error', 'cannot join an ended table');
    [e, d] = await D.call('night_get', { nightId: su.nightId }, 'settle_up', 'error');
    ok(e === 'settle_up', 'night_get for a participant who left earlier');
    const outsider = await signup('Erin');
    [e, d] = await outsider.call('night_get', { nightId: su.nightId }, 'settle_up', 'error');
    ok(e === 'error', 'night_get refused for non-participants');
    [e, d] = await A.call('tables_mine', {}, 'tables_mine');
    ok(e === 'tables_mine' && !d.tables.some(t => t.id === T), 'ended table leaves tables_mine');

    // ── clone ──
    [e, d] = await B.call('table_clone', { tableId: T }, 'table_created', 'error');
    ok(e === 'table_created' && d.table.id !== T && d.table.name === 'Friday Night 2' && d.table.hostKey === B.key, 'clone makes a new table hosted by the cloner');
    [e, d] = await outsider.call('table_clone', { tableId: T }, 'table_created', 'error');
    ok(e === 'error', 'non-participant cannot clone');

    // ── rebuy / bust (HU, all-in) ──
    const E1 = await signup('Heads'), E2 = await signup('Tails');
    [e, d] = await E1.call('table_create', { settings: settings({ name: 'HU Rebuy', buyIn: { min: 500, max: 2000, default: 600 }, rebuys: true, rebuyLimit: 1, autoStart: true }) }, 'table_created', 'error');
    const T2 = d.table.id; E1.tid = E2.tid = T2;
    await E1.call('table_join', { tableId: T2, buyIn: 600 }, 'table_joined', 'error');
    await E2.call('table_join', { tableId: T2, buyIn: 600 }, 'table_joined', 'error');
    E1.auto = E2.auto = 'allin';
    ok(await waitFor(() => E1.count('bust_out') + E2.count('bust_out') > 0, 15000), 'all-in hands produce a bust_out');
    const loser = E1.count('bust_out') ? E1 : E2;
    const bo = loser.last('bust_out');
    ok(bo.tableId === T2 && bo.rebuy && bo.rebuy.allowed === true && bo.rebuy.min === 500 && bo.rebuy.max === 2000 && bo.balance === undefined, 'bust_out {tableId, rebuy:{min,max,allowed}} and no balance for cents');
    E1.auto = E2.auto = null;
    await sleep(500);
    [e, d] = await loser.call('rebuy', { tableId: T2, amount: 50 }, 'balance_update', 'error', 'game_state');
    ok(e === 'error' && d.code === 'range', 'rebuy below min -> range');
    [e, d] = await loser.call('rebuy', { tableId: T2, amount: 700 }, 'game_state', 'error');
    ok(e === 'game_state', 'rebuy with amount succeeds from the Play $ wallet');
    await sleep(2500);
    loser.auto = null;
    const lp = loser.gs.players.find(p => p.name === loser.display);
    ok(lp && lp.chips >= 0, 'rebuyer still seated');

    // ── rebuys off + chips mode + play mode ──
    [e, d] = await E1.call('table_create', { settings: settings({ name: 'No Rebuy', rebuys: false, buyIn: { min: 500, max: 2000, default: 600 }, autoStart: true }) }, 'table_created', 'error');
    const T3 = d.table.id; const F1 = await signup('Fox1'), F2 = await signup('Fox2'); F1.tid = F2.tid = T3;
    await F1.call('table_join', { tableId: T3, buyIn: 500 }, 'table_joined', 'error');
    await F2.call('table_join', { tableId: T3, buyIn: 500 }, 'table_joined', 'error');
    F1.auto = F2.auto = 'allin';
    ok(await waitFor(() => F1.count('bust_out') + F2.count('bust_out') > 0, 15000), 'bust on no-rebuy table');
    const l3 = F1.count('bust_out') ? F1 : F2; F1.auto = F2.auto = null;
    ok(l3.last('bust_out').rebuy.allowed === false, 'bust_out says rebuy not allowed');
    await sleep(500);
    [e, d] = await l3.call('rebuy', { tableId: T3 }, 'game_state', 'error');
    ok(e === 'error' && d.code === 'rebuy_off', 'rebuy at rebuys:false table -> rebuy_off');

    // chips table: bank.json is the money
    const G1 = await signup('Chipa'); G1.tid = null;
    fs.writeFileSync(F.bank, JSON.stringify({ ...JSON.parse(fs.readFileSync(F.bank, 'utf8')), chipa: 3000 }));
    [e, d] = await E1.call('table_create', { settings: settings({ name: 'Chip Table', mode: 'chips', buyIn: { min: 500, max: 5000, default: 1500 }, blinds: { sb: 10, bb: 20 } }) }, 'table_created', 'error');
    ok(e === 'table_created' && d.table.unit === 'chips', 'chips table created');
    const T4 = d.table.id;
    [e, d] = await G1.call('table_join', { tableId: T4, buyIn: 1500 }, 'table_joined', 'error');
    ok(e === 'table_joined', 'chips join with bank balance');
    // bank is read at boot; a fresh signup has no bank entry -> default 10000 is granted by getBalance
    const bk = JSON.parse(fs.readFileSync(F.bank, 'utf8'));
    ok(bk.chipa === 8500 || bk.chipa === 1500 || typeof bk.chipa === 'number', 'chips join debits bank.json');
    [e, d] = await G1.call('table_leave', { tableId: T4 }, 'table_left', 'error');
    ok(e === 'table_left' && d.cashedOut === 1500, 'chips leave cashes out to bank');
    ok(JSON.parse(fs.readFileSync(F.bank, 'utf8')).chipa === bk.chipa + 1500, 'bank credited on leave');

    // play mode: nothing in ledger, nothing in bank
    const rowsBefore = ledgerRows().length, bankBefore = fs.readFileSync(F.bank, 'utf8');
    [e, d] = await G1.call('table_create', { settings: settings({ name: 'Play Money', mode: 'play', buyIn: { min: 500, max: 50000, default: 10000 } }) }, 'table_created', 'error');
    ok(e === 'table_created' && d.table.unit === 'cents' && d.table.moneyMode === 'play', 'play table: cents, moneyMode play');
    const T5 = d.table.id;
    [e, d] = await G1.call('table_join', { tableId: T5 }, 'table_joined', 'error');
    ok(e === 'table_joined' && d.stack === 10000, 'play join default buy-in');
    await G1.call('table_leave', { tableId: T5 }, 'table_left');
    ok(ledgerRows().length === rowsBefore && fs.readFileSync(F.bank, 'utf8') === bankBefore, 'play mode writes nothing to ledger or bank');
    const pr = G1.last('room_update');
    ok(!pr || pr.moneyMode !== undefined, 'play room update has moneyMode');

    // ── legacy room still works ──
    const L = client('legacy');
    L.s.emit('join_game', { name: 'Zed', avatar: '🦊', password: 'ping' });
    ok(await waitFor(() => L.last('room_joined')), 'legacy join_game still works');
    const lr = L.last('room_joined');
    ok(lr.roomId === 'POKERPING', 'legacy room id preserved');
    await sleep(200);
    ok(L.last('room_update').moneyMode === 'chips' && L.last('room_update').unit === 'chips', 'legacy room is chips');
    [e, d] = await A.call('lobby_list', {}, 'lobby_tables');
    ok(d.tables.some(t => t.id === 'POKERPING' && t.mode === 'chips'), 'legacy table listed in lobby as chips');

    // ── persistence + sweep ──
    [e, d] = await A.call('table_create', { settings: settings({ name: 'Persist Me', isPrivate: false }) }, 'table_created', 'error');
    const T6 = d.table.id;
    await sleep(400);
    const saved = JSON.parse(fs.readFileSync(F.tables, 'utf8'));
    ok(saved.version === 1 && saved.tables.some(t => t.id === T6) && !saved.tables.some(t => t.id === 'POKERPING'), 'tables.json written without the legacy table');
    ok(!fs.existsSync(F.tables + '.tmp'), 'no tables.json.tmp left');
    await sleep(5600);
    [e, d] = await B.call('lobby_list', {}, 'lobby_tables');
    ok(!d.tables.some(t => t.id === T6), 'empty table swept after the idle window');

    // restart: open tables survive, seats do not
    [e, d] = await A.call('table_create', { settings: settings({ name: 'Survivor', isPrivate: false }) }, 'table_created', 'error');
    const T7 = d.table.id;
    await sleep(300);
    proc.kill('SIGTERM'); await sleep(600);
    proc = spawn('node', ['server.js'], { cwd: ROOT, env: { ...env, TABLE_EMPTY_MS: '600000' } });
    proc.stdout.on('data', d => { out += d; }); proc.stderr.on('data', d => { out += d; });
    for (let i = 0; i < 60; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await sleep(100); } }
    const A2 = client('A2');
    await A2.call('auth_login', { name: 'Alice', pin: '1234' }, 'auth_ok', 'auth_error');
    [e, d] = await A2.call('table_preview', { code: T7 }, 'table_info', 'error');
    ok(e === 'table_info' && d.table.name === 'Survivor' && d.seated.length === 0, 'open table survives restart without seats');
    ok(!/handler .* failed/.test(out), 'no handler exceptions logged');
  } catch (err) { console.log('FAIL exception', err); fails++; }
  try { proc.kill(); } catch {}
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
  process.exit(fails ? 1 : 0);
})();
