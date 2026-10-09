// Money 1008 R2B-4 (server side): the REAL server.js booted on an accounts.json that exists but does not parse.
//  - a name that holds Cash comes back LOCKED: neither signup nor the public room word takes it, the real owner is told it is locked
//  - the file and its .bak both unreadable = the server does not start
//  - RV-ACCT-1: the lock counts ALL of a key's Cash at boot (wallet + poker seat + game-round escrow + a stray pot), not the wallet alone: heldCash()
// Exit 1 while server.js does not hand the ledger's Cash to accounts.migrateLegacy, 0 when fixed. Ports V2_PORT_BASE (default as tests/v2/lib.js) +0..+2.
const fs = require('fs'), path = require('path');
const L = require('./v2/lib.js');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

async function cashed(off, mode) {
  const srv = await L.startServer(off);
  const adm = new L.Bot(srv, 'chris'); await adm.connect(); await adm.claimAdmin();
  const bob = new L.Bot(srv, 'Bob'); await bob.connect(); await bob.signup('1111');
  const r = await adm.req('admin_set_play', { key: 'bob', cents: 50000, opId: 'r2bboot.' + mode }, 'admin_result', 3000);
  ok(r.ok, mode + ': admin gave Bob 500.00 Cash');
  await L.sleep(400);
  const f = path.join(srv.dir, 'a.json'); const full = fs.readFileSync(f, 'utf8');
  await srv.stop();
  // the .bak is the save before the last one: it knows chris but not Bob, so the restore leaves Bob to be re-made from the legacy stores
  ok(fs.existsSync(f + '.bak') && !JSON.parse(fs.readFileSync(f + '.bak', 'utf8')).accounts.bob, mode + ': setup: the .bak is older than Bob\'s signup');
  fs.writeFileSync(f, mode === 'empty' ? '' : full.slice(0, Math.floor(full.length / 2)));
  const srv2 = await srv.restart();
  const st = new L.Bot(srv2, 'Bob'); await st.connect();
  const s = await st.req('auth_signup', { name: 'Bob', pin: '9999', avatar: 'a02' }, 'auth_ok', 3000);
  ok(!s.account, mode + ': a stranger cannot sign up as Bob');
  let c = {};
  if (!s.account) { const e = st.wait('auth_error', 3000).catch(() => null); c = await st.req('auth_claim', { name: 'Bob', pin: '9999', avatar: 'a02', roomPassword: 'ping' }, 'auth_ok', 3000); c.err = await e; }
  ok(!c.account, mode + ': ...and the public room word does not claim Bob either');
  const rb = new L.Bot(srv2, 'Bob'); await rb.connect(); const pe = rb.wait('auth_error', 3000).catch(() => null);
  const l = await rb.req('auth_login', { name: 'Bob', pin: '1111' }, 'auth_ok', 3000); const le = l.account ? null : await pe;
  ok(!l.account && le && le.code === 'account_locked', mode + ': the real Bob is told the account is locked (got ' + JSON.stringify(le && le.code) + ')');
  await srv2.stop();
}

// RV-ACCT-1: where Bob's Cash sits when the server stops. 'seat' = a poker seat, 'escrow' = an open Campaign Trail round, 'pot' = a stray pot (set in the ledger file by hand: a hand is one atomic batch, so no real stop leaves one),
// 'chips' = control: Bob has Chips only and no Cash anywhere. fileMode 'gone' = a.json and a.json.bak both missing, 'empty' = a valid file whose accounts is {}.
async function heldCash(off, where, fileMode) {
  const tag = where + '/' + fileMode;
  const srv = await L.startServer(off, { env: { SIGNUP_PLAY_CENTS: '0' } });
  const adm = new L.Bot(srv, 'chris'); await adm.connect(); await adm.claimAdmin();
  const bob = new L.Bot(srv, 'Bob'); await bob.connect(); await bob.signup('1111');
  let tid = null;
  const AMT = where === 'escrow' ? 2500 : 50000;   // the top Campaign bet level is 25.00, so there Bob's whole Cash is 25.00
  if (where !== 'chips') {
    const r = await adm.req('admin_set_play', { key: 'bob', cents: AMT, opId: 'r2bheld.' + tag.replace('/', '-') }, 'admin_result', 3000);
    ok(r.ok, tag + ': admin gave Bob 500.00 Cash');
  }
  if (where === 'seat' || where === 'pot') {
    const mal = new L.Bot(srv, 'Mal'); await mal.connect(); await mal.signup('5555');
    await adm.req('admin_set_play', { key: 'mal', cents: 50000, opId: 'r2bheld.m.' + tag.replace('/', '-') }, 'admin_result', 3000);
    const tc = await mal.req('table_create', { settings: { name: 'r2bheld', mode: 'play', buyIn: { min: 500, max: 100000, default: 20000 }, blinds: { sb: 50, bb: 100 }, autoStart: false, actionTimerSec: 15 } }, 'table_created', 3000);
    tid = tc.table.id;
    await mal.sit(tid, 20000);
    const sr = await bob.sit(tid, 50000);
    ok(!sr.__err, tag + ': Bob sits with ALL his Cash (500.00) (' + (sr.__err || 'ok') + ')');
  } else if (where === 'escrow') {
    const run = await bob.req('g:campaign:start', { mode: 'play', bet: AMT, home: 'OH' }, 'g:campaign:run', 3000);
    ok(run && run.run, tag + ': Bob opened a Cash round with ALL his Cash (' + JSON.stringify(run).slice(0, 80) + ')');
  }
  await L.sleep(500);
  const f = path.join(srv.dir, 'a.json');
  await srv.stop();
  const open = () => require(path.join(__dirname, '..', 'money/ledger')).open(path.join(srv.dir, 'money.jsonl'), { fsync: 'all', log: () => {} });
  const total = lg => ['play:bob'].reduce((a, k) => a + lg.balance(k, 'play'), 0) + lg.list('seat:', 'play').concat(lg.list('escrow:', 'play'), lg.list('pot:', 'play')).filter(x => x.account.split(':')[2] === 'bob' || x.account.startsWith('pot:')).reduce((a, x) => a + x.balance, 0);
  if (where === 'pot') {
    const lg = open(); const seat = lg.list('seat:', 'play').find(x => x.account.endsWith(':bob'));
    lg.transfer(seat.account, 'pot:' + tid + ':999', seat.balance, 'play', 'hand', 'r2bheld.pot'); ok(lg.balance('pot:' + tid + ':999', 'play') === AMT, tag + ': setup: Bob\'s whole stack is in a stray pot at the stop'); lg.close();
  }
  if (where !== 'chips') { const lg = open(); ok(lg.balance('play:bob', 'play') === 0 && total(lg) === AMT, tag + ': setup: at the stop Bob\'s wallet is 0 and all his Cash sits in a ' + where + ' (' + total(lg) + ')'); lg.close(); }
  if (fileMode === 'gone') { fs.rmSync(f, { force: true }); fs.rmSync(f + '.bak', { force: true }); }
  else { fs.writeFileSync(f, '{"version":1,"accounts":{}}'); fs.rmSync(f + '.bak', { force: true }); }
  const srv2 = await srv.restart();
  const st = new L.Bot(srv2, 'Bob'); await st.connect();
  const pe = st.wait('auth_error', 3000).catch(() => null);
  let s = await st.req('auth_signup', { name: 'Bob', pin: '9999', avatar: 'a02' }, 'auth_ok', 3000);
  const e1 = s.account ? null : await pe;
  let via = 'signup';
  if (!s.account) {
    const st2 = new L.Bot(srv2, 'Bob'); await st2.connect(); const pe2 = st2.wait('auth_error', 3000).catch(() => null);
    s = await st2.req('auth_claim', { name: 'Bob', pin: '9999', avatar: 'a02', roomPassword: 'ping' }, 'auth_ok', 3000);
    via = 'room-word claim'; s.err = s.account ? null : await pe2;
  }
  if (where === 'chips') ok(!!s.account, tag + ': Chips only, no Cash anywhere: Bob is NOT locked, a stranger gets in by ' + via + ' (control)');
  else {
    ok(!s.account, tag + ': a stranger cannot take Bob (signup ' + JSON.stringify(e1 && e1.code) + ', then ' + via + ')');
    ok(s.err && s.err.code === 'account_locked', tag + ': ...and is told account_locked (got ' + JSON.stringify(s.err && s.err.code) + ')');
  }
  await srv2.stop();
  if (where !== 'chips') { const lg = open(); ok(lg.balance('play:bob', 'play') === AMT && total(lg) === AMT, tag + ': after boot recovery all his Cash is back in Bob\'s wallet and nowhere else (wallet ' + lg.balance('play:bob', 'play') + ')'); lg.close(); }
}

async function unreadable(off) {
  const srv = await L.startServer(off);
  const adm = new L.Bot(srv, 'chris'); await adm.connect(); await adm.claimAdmin();
  await L.sleep(400);
  const f = path.join(srv.dir, 'a.json');
  await srv.stop();
  fs.writeFileSync(f, '{"accounts":{"chris":{'); fs.writeFileSync(f + '.bak', '');
  let err = null; try { const s2 = await srv.restart(); await s2.stop(); } catch (e) { err = e; }
  ok(err && /did not start/.test(err.message), 'neither a.json nor a.json.bak readable: the server does not start');
  ok(fs.readFileSync(f, 'utf8') === '{"accounts":{"chris":{', 'the damaged bytes are left where they were');
}

(async () => {
  await cashed(0, 'empty');
  await cashed(1, 'half');
  await unreadable(2);
  let off = 3;
  for (const where of ['seat', 'escrow', 'pot']) for (const fm of ['gone', 'empty']) await heldCash(off++, where, fm);
  await heldCash(off++, 'chips', 'gone');
  console.log(fails ? fails + ' FAILED' : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(2); });
