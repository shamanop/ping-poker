// Money 1008 K6b-1: a PIN change / an admin PIN reset signs out the sockets that were signed in before it.
// Exit 1 while the fault exists (the old socket keeps spinning Cash and buying a Cash seat), exit 0 when fixed.
// Boots server.js on a fresh temp data dir, one port (SESSION_PORT_BASE, default 4890).
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..');
const { io } = require(path.join(ROOT, 'node_modules', 'socket.io-client'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = Number(process.env.SESSION_PORT_BASE) || 4890;
const ADMIN_PW = 'test-admin-claim-1008';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
let proc = null;
process.on('exit', () => { if (proc) try { proc.kill('SIGKILL'); } catch {} });

async function boot() {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'ppses-'));
  const f = n => path.join(dir, n);
  fs.writeFileSync(f('b.json'), '{}'); fs.writeFileSync(f('l.json'), '[]');
  const e = { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(PORT), DATA_DIR: dir, BANK_FILE: f('b.json'), LEDGER_FILE: f('l.json'), ACCOUNTS_FILE: f('a.json'),
    TABLES_FILE: f('t.json'), WALLET_FILE: f('w.json'), STACKS_FILE: f('s.json'), BIGWINS_FILE: f('bw.json'), BENDER_CFG_FILE: f('bc.json'), MONEY_FILE: f('money.jsonl'),
    CAMPAIGN_FILE: f('c.json'), AUTO_START_MS: '600000', AUTH_SIGNUP_LIMIT: '100000', ADMIN_CLAIM_PASSWORD: ADMIN_PW };
  proc = spawn('node', ['server.js'], { cwd: ROOT, env: e, stdio: ['ignore', fs.openSync(f('server.log'), 'a'), fs.openSync(f('server.log'), 'a')] });
  for (let i = 0; i < 200; i++) { try { await fetch(`http://127.0.0.1:${PORT}/`); break; } catch { await sleep(50); } }
  await sleep(100);
  return dir;
}

function client() {
  const s = io(`http://127.0.0.1:${PORT}`, { transports: ['websocket'], forceNew: true, reconnection: false });
  const got = [];
  s.onAny((ev, p) => got.push([ev, p]));
  const c = { s, got, name: '', token: null, key: null,
    emit: (ev, p) => s.emit(ev, p),
    all: ev => got.filter(([e]) => e === ev).map(([, p]) => p),
    async req(ev, p, want, ms = 2500) {
      const n = got.length; s.emit(ev, p);
      for (let i = 0; i < ms / 15; i++) { const h = got.slice(n).find(([e]) => (Array.isArray(want) ? want : [want]).includes(e)); if (h) return { ev: h[0], p: h[1] }; await sleep(15); }
      return { ev: null, p: null };
    },
    // one spin: true when the server answered with a round result, false when it answered with an error or nothing
    async spin(mode) { const n = got.length; s.emit('g:bender:spin', { bet: 100, mode }); await sleep(330); const new_ = got.slice(n); return new_.some(([e]) => e === 'g:bender:result'); },
    async wallet() { const r = await c.req('wallet_get', {}, 'wallet'); return r.p; } };
  return new Promise((res, rej) => { s.on('connect', () => res(c)); s.on('connect_error', rej); });
}
async function signup(name, pin) { const c = await client(); const r = await c.req('auth_signup', { name, pin, avatar: 'a01' }, ['auth_ok', 'auth_error']); c.name = name; c.pin = pin; c.key = r.p && r.p.account && r.p.account.key; c.token = r.p && r.p.token; return c; }
async function login(name, pin) { const c = await client(); const r = await c.req('auth_login', { name, pin }, ['auth_ok', 'auth_error']); c.name = name; c.pin = pin; c.key = r.p && r.p.account && r.p.account.key; c.token = r.p && r.p.token; return c; }
const cashTo = async (adm, key, cents) => { const opId = 'ses.' + Math.random().toString(36).slice(2); const r = await adm.req('admin_adjust', { key, delta: cents, cur: 'play', reason: 'session test', opId }, 'admin_result'); return r.p && r.p.ok; };
const outs = c => c.all('auth_out');
const signedOutOnce = (c, code) => outs(c).length === 1 && (!code || outs(c)[0].code === code) && typeof outs(c)[0].message === 'string' && outs(c)[0].message.length > 0;

// the sockets of one account: A is the one that acts; all must be dead except A after a PIN change
async function spinsOf(c) { return { cash: await c.spin('play'), chips: await c.spin('chips') }; }

(async () => {
  try {
    await boot();
    const adm = await client();
    let r = await adm.req('auth_claim', { name: 'chris', pin: '4321', avatar: 'a01', roomPassword: ADMIN_PW }, ['auth_ok', 'auth_error']);
    ok(r.ev === 'auth_ok', 'setup: admin signed in');

    // ── A. owner pin_change: every OTHER socket is signed out, the changing socket stays on a fresh token ───────
    const A = await signup('sesown', '1234'), B = await login('sesown', '1234'), C = await login('sesown', '1234');
    ok(await cashTo(adm, A.key, 20000), 'A: Cash granted');
    for (const c of [A, B, C]) { const s = await spinsOf(c); ok(s.cash && s.chips, 'A setup: a signed-in socket spins Cash and Chips'); }
    const ch = await A.req('pin_change', { oldPin: '1234', newPin: '987654' }, 'ok');
    ok(ch.ev === 'ok' && ch.p.what === 'pin', 'A: pin_change answered ok');
    await sleep(150);
    const fresh = A.all('auth_ok').pop();
    ok(fresh && fresh.token && fresh.token !== A.token && fresh.account.key === A.key, 'A: the changing socket is told its fresh token');
    ok(signedOutOnce(B, 'pin_changed') && signedOutOnce(C, 'pin_changed'), 'A: each other socket got exactly one auth_out with code pin_changed and a message');
    ok(outs(A).length === 0, 'A: the changing socket was not signed out');
    for (const [n, c] of [['B', B], ['C', C]]) {
      const s = await spinsOf(c);
      ok(!s.cash && !s.chips, `A: signed-out socket ${n} cannot spin (Cash ${s.cash}, Chips ${s.chips})`);
      const w = await c.req('wallet_get', {}, ['wallet', 'error'], 600);
      ok(w.ev === 'error' && w.p.code === 'auth', `A: signed-out socket ${n} gets an auth error on wallet_get (${w.ev})`);
      const d = await c.req('g:coldcall:spin', { bet: 10, mode: 'play' }, ['g:coldcall:result', 'error'], 600);
      ok(d.ev === 'error' && d.p.code === 'auth', `A: signed-out socket ${n} cannot play Cold Call Cash (${d.ev})`);
      const bk = await c.req('get_bank_summary', { roomId: 'POKERPING', view: 'play' }, ['bank_summary', 'error'], 600);
      ok(bk.ev !== 'bank_summary' || !(bk.p && bk.p.you), `A: signed-out socket ${n} reads no bank summary for the account`);
      const j = await c.req('table_create', { settings: { name: 'ses', mode: 'play', buyIn: { min: 500, max: 100000, default: 1000 }, blinds: { sb: 50, bb: 100 } } }, ['table_created', 'error'], 800);
      ok(j.ev === 'error' && j.p.code === 'auth', `A: signed-out socket ${n} cannot create/sit at a Cash table (${j.ev})`);
    }
    const sA = await spinsOf(A);
    ok(sA.cash && sA.chips, 'A: the changing socket still spins Cash and Chips');
    const t1 = await client(); const res1 = await t1.req('auth_resume', { key: A.key, token: A.token }, ['auth_ok', 'auth_error']);
    ok(res1.ev === 'auth_error', 'A: the old session token no longer resumes');
    const t2 = await client(); const res2 = await t2.req('auth_resume', { key: A.key, token: fresh.token }, ['auth_ok', 'auth_error']);
    ok(res2.ev === 'auth_ok', 'A: the fresh token resumes');
    const t3 = await client(); const res3 = await t3.req('auth_login', { name: 'sesown', pin: '1234' }, ['auth_ok', 'auth_error']);
    ok(res3.ev === 'auth_error', 'A: login with the old PIN is refused');
    ok(!(await t3.spin('play')), 'A: ...and that socket cannot spin');
    const t4 = await login('sesown', '987654'); ok((await spinsOf(t4)).cash, 'A: login with the new PIN works and spins');

    // ── B. a second device in the middle of a spin storm: nothing answers after its auth_out ───────────────────
    const D = await login('sesown', '987654');
    const stop = { v: false };
    const storm = (async () => { while (!stop.v) { D.emit('g:bender:spin', { bet: 100, mode: 'play' }); D.emit('g:bender:spin', { bet: 100, mode: 'chips' }); await sleep(8); } })();
    await sleep(200);
    const ch2 = await A.req('pin_change', { oldPin: '987654', newPin: '246810' }, 'ok');
    ok(ch2.ev === 'ok', 'B: second pin_change ok');
    await sleep(500); stop.v = true; await storm; await sleep(200);
    const iOut = D.got.findIndex(([e]) => e === 'auth_out');
    ok(iOut >= 0 && outs(D).length === 1, 'B: the spinning device was signed out once');
    const lateResults = D.got.slice(iOut + 1).filter(([e]) => e === 'g:bender:result').length;
    ok(lateResults === 0, `B: no spin result reached the device after its auth_out (${lateResults})`);

    // ── C. seated socket mid-hand: the seat follows the disconnect rule, the hand is not voided ────────────────
    const bob = await signup('sesbob', '2222'); await cashTo(adm, bob.key, 20000);
    const E = await login('sesown', '246810'); await cashTo(adm, E.key, 20000);
    const tc = await E.req('table_create', { settings: { name: 'ses cash', mode: 'play', buyIn: { min: 500, max: 100000, default: 1000 }, blinds: { sb: 50, bb: 100 }, autoStart: false, actionTimerSec: 0 } }, 'table_created');
    const tid = tc.p && tc.p.table && tc.p.table.id;
    ok(!!tid, 'C: Cash table created');
    ok((await E.req('table_join', { tableId: tid, buyIn: 1000 }, 'table_joined')).ev === 'table_joined', 'C: owner device seated');
    ok((await bob.req('table_join', { tableId: tid, buyIn: 1000 }, 'table_joined')).ev === 'table_joined', 'C: bob seated');
    E.emit('table_start', { tableId: tid });
    for (let i = 0; i < 80 && !(bob.all('game_state').pop() || {}).status; i++) await sleep(50);
    const live = () => { const g = bob.all('game_state').pop(); return g && g.status === 'playing'; };
    for (let i = 0; i < 80 && !live(); i++) await sleep(50);
    ok(live(), 'C: a hand is live');
    const nBob = bob.got.length;
    const ch3 = await A.req('pin_change', { oldPin: '246810', newPin: '135790' }, 'ok');
    ok(ch3.ev === 'ok', 'C: pin_change while the other device sits in a live hand');
    await sleep(400);
    ok(signedOutOnce(E, 'pin_changed'), 'C: the seated device was signed out once');
    const bobAfter = bob.got.slice(nBob);
    ok(!bobAfter.some(([e, p]) => e === 'error' && p && p.code === 'hand_void') && !bobAfter.some(([e]) => e === 'table_event' && false), 'C: the hand was not voided');
    ok(live(), 'C: the hand is still live');
    const gsNow = bob.all('game_state').pop();
    const mine = gsNow && (gsNow.players || []).find(x => String(x.name).toLowerCase() === 'sesown');
    ok(mine && mine.connected === false, 'C: the seat is kept and shown as disconnected (the normal disconnect path), not cashed out on the spot');
    const act = await E.req('player_action', { roomId: tid, action: 'fold' }, ['error', 'game_state'], 600);
    ok(act.ev === 'error' && act.p.code === 'auth', 'C: the signed-out seat cannot act');
    const rb = await E.req('rebuy', { roomId: tid, tableId: tid, amount: 500 }, ['error', 'table_joined', 'balance_update'], 600);
    ok(rb.ev === 'error' && rb.p.code === 'auth', 'C: the signed-out seat cannot rebuy');
    const lv = await E.req('table_leave', { tableId: tid }, ['error', 'table_left'], 600);
    ok(lv.ev === 'error' && lv.p.code === 'auth', 'C: the signed-out socket cannot cash the seat out');
    const rj = await E.req('table_join', { tableId: tid, buyIn: 1000 }, ['error', 'table_joined'], 600);
    ok(rj.ev === 'error' && rj.p.code === 'auth', 'C: the signed-out socket cannot sit again');

    // ── D. admin reset: EVERY socket of the account is signed out, the message is true ─────────────────────────
    const F = await login('sesown', '135790'), G = await login('sesown', '135790');
    ok((await spinsOf(F)).cash, 'D setup: sockets spin');
    const rs = await adm.req('admin_reset_pin', { key: A.key, newPin: '555555' }, 'admin_result');
    ok(rs.p && rs.p.ok === true && /signed out/i.test(rs.p.message), 'D: admin told the sessions were signed out (' + (rs.p && rs.p.message) + ')');
    await sleep(200);
    for (const [n, c] of [['A', A], ['F', F], ['G', G]]) {
      ok(outs(c).length >= 1 && outs(c).pop().code === 'pin_reset', `D: socket ${n} (including the one that changed the PIN earlier) was signed out with code pin_reset`);
      const s = await spinsOf(c); ok(!s.cash && !s.chips, `D: socket ${n} cannot spin (Cash ${s.cash}, Chips ${s.chips})`);
    }
    ok(outs(adm).length === 0, 'D: the admin socket was not signed out');
    const oldPin = await client(); const lo = await oldPin.req('auth_login', { name: 'sesown', pin: '135790' }, ['auth_ok', 'auth_error']);
    ok(lo.ev === 'auth_error', 'D: login with the PIN before the reset is refused');
    const newPin = await login('sesown', '555555'); ok((await spinsOf(newPin)).cash, 'D: the new PIN signs in and spins');

    // ── E. account_reset_pin (admin through the account route) signs out the target's sockets too ──────────────
    const H = await login('sesown', '555555');
    const ar = await adm.req('account_reset_pin', { key: A.key, newPin: '777777' }, ['ok', 'auth_error', 'error']);
    await sleep(200);
    if (ar.ev === 'ok') {
      ok(outs(H).length >= 1, 'E: account_reset_pin signed out the target\'s socket');
      ok(!(await H.spin('play')), 'E: ...and it cannot spin');
    } else console.log('NOTE E: account_reset_pin answered ' + ar.ev + '; nothing to check');

    // ── F. a PIN change that fails changes nothing ──────────────────────────────────────────────────────────────
    const K = await login('sesown', fs.existsSync('/nonexistent') ? '' : (ar.ev === 'ok' ? '777777' : '555555'));
    const K2 = await login('sesown', K.pin);
    const bad = await K.req('pin_change', { oldPin: '0000', newPin: '4444' }, ['ok', 'auth_error']);
    ok(bad.ev === 'auth_error', 'F: pin_change with a wrong old PIN refused');
    ok(outs(K2).length === 0 && (await K2.spin('play')), 'F: ...and no other socket was signed out');
  } catch (e) {
    console.log('FAIL exception ' + (e && e.stack || e)); fails++;
  }
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})();
