// Money 1008 R2B-4 (server side): the REAL server.js booted on an accounts.json that exists but does not parse.
//  - a name that holds Cash comes back LOCKED: neither signup nor the public room word takes it, the real owner is told it is locked
//  - the file and its .bak both unreadable = the server does not start
//  - RV-ACCT-1: the lock counts ALL of a key's Cash at boot (wallet + poker seat + game-round escrow + a stray pot), not the wallet alone: heldCash()
// R3AB-1: the same lock for names that start with bot / demo / test (Tester, Demon, Bottle, Botha, Demi), which signup allows.
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
async function heldCash(off, where, fileMode, NAME = 'Bob') {
  const KEY = NAME.toLowerCase(), tag = (NAME === 'Bob' ? '' : NAME + ' ') + where + '/' + fileMode;
  const srv = await L.startServer(off, { env: { SIGNUP_PLAY_CENTS: '0' } });
  const adm = new L.Bot(srv, 'chris'); await adm.connect(); await adm.claimAdmin();
  const bob = new L.Bot(srv, NAME); await bob.connect(); await bob.signup('1111');
  let tid = null;
  const AMT = where === 'escrow' ? 2500 : 50000;   // the top Campaign bet level is 25.00, so there Bob's whole Cash is 25.00
  if (where !== 'chips') {
    const r = await adm.req('admin_set_play', { key: KEY, cents: AMT, opId: 'r2bheld.' + tag.replace(/[^A-Za-z0-9]/g, '-') }, 'admin_result', 3000);
    ok(r.ok, tag + ': admin gave ' + NAME + ' 500.00 Cash');
  }
  if (where === 'seat' || where === 'pot') {
    const mal = new L.Bot(srv, 'Mal'); await mal.connect(); await mal.signup('5555');
    await adm.req('admin_set_play', { key: 'mal', cents: 50000, opId: 'r2bheld.m.' + tag.replace(/[^A-Za-z0-9]/g, '-') }, 'admin_result', 3000);
    const tc = await mal.req('table_create', { settings: { name: 'r2bheld', mode: 'play', buyIn: { min: 500, max: 100000, default: 20000 }, blinds: { sb: 50, bb: 100 }, autoStart: false, actionTimerSec: 15 } }, 'table_created', 3000);
    tid = tc.table.id;
    await mal.sit(tid, 20000);
    const sr = await bob.sit(tid, 50000);
    ok(!sr.__err, tag + ': ' + NAME + ' sits with ALL his Cash (500.00) (' + (sr.__err || 'ok') + ')');
  } else if (where === 'escrow') {
    const run = await bob.req('g:campaign:start', { mode: 'play', bet: AMT, home: 'OH' }, 'g:campaign:run', 3000);
    ok(run && run.run, tag + ': ' + NAME + ' opened a Cash round with ALL his Cash (' + JSON.stringify(run).slice(0, 80) + ')');
  }
  await L.sleep(500);
  const f = path.join(srv.dir, 'a.json');
  await srv.stop();
  const open = () => require(path.join(__dirname, '..', 'money/ledger')).open(path.join(srv.dir, 'money.jsonl'), { fsync: 'all', log: () => {} });
  const total = lg => ['play:' + KEY].reduce((a, k) => a + lg.balance(k, 'play'), 0) + lg.list('seat:', 'play').concat(lg.list('escrow:', 'play'), lg.list('pot:', 'play')).filter(x => x.account.split(':')[2] === KEY || x.account.startsWith('pot:')).reduce((a, x) => a + x.balance, 0);
  if (where === 'pot') {
    const lg = open(); const seat = lg.list('seat:', 'play').find(x => x.account.endsWith(':' + KEY));
    lg.transfer(seat.account, 'pot:' + tid + ':999', seat.balance, 'play', 'hand', 'r2bheld.pot'); ok(lg.balance('pot:' + tid + ':999', 'play') === AMT, tag + ': setup: ' + NAME + '\'s whole stack is in a stray pot at the stop'); lg.close();
  }
  if (where !== 'chips') { const lg = open(); ok(lg.balance('play:' + KEY, 'play') === (where === 'wallet' ? AMT : 0) && total(lg) === AMT, tag + ': setup: at the stop ' + NAME + '\'s wallet is 0 and all his Cash sits in a ' + where + ' (' + total(lg) + ')'); lg.close(); }
  if (fileMode === 'gone') { fs.rmSync(f, { force: true }); fs.rmSync(f + '.bak', { force: true }); }
  else { fs.writeFileSync(f, '{"version":1,"accounts":{}}'); fs.rmSync(f + '.bak', { force: true }); }
  const srv2 = await srv.restart();
  const st = new L.Bot(srv2, NAME); await st.connect();
  const pe = st.wait('auth_error', 3000).catch(() => null);
  let s = await st.req('auth_signup', { name: NAME, pin: '9999', avatar: 'a02' }, 'auth_ok', 3000);
  const e1 = s.account ? null : await pe;
  let via = 'signup';
  if (!s.account) {
    const st2 = new L.Bot(srv2, NAME); await st2.connect(); const pe2 = st2.wait('auth_error', 3000).catch(() => null);
    s = await st2.req('auth_claim', { name: NAME, pin: '9999', avatar: 'a02', roomPassword: 'ping' }, 'auth_ok', 3000);
    via = 'room-word claim'; s.err = s.account ? null : await pe2;
  }
  if (where === 'chips') ok(!!s.account, tag + ': Chips only, no Cash anywhere: ' + NAME + ' is NOT locked, a stranger gets in by ' + via + ' (control)');
  else {
    ok(!s.account, tag + ': a stranger cannot take ' + NAME + ' (signup ' + JSON.stringify(e1 && e1.code) + ', then ' + via + ')');
    ok(s.err && s.err.code === 'account_locked', tag + ': ...and is told account_locked (got ' + JSON.stringify(s.err && s.err.code) + ')');
  }
  await srv2.stop();
  if (where !== 'chips') { const lg = open(); ok(lg.balance('play:' + KEY, 'play') === AMT && total(lg) === AMT, tag + ': after boot recovery all his Cash is back in ' + NAME + '\'s wallet and nowhere else (wallet ' + lg.balance('play:' + KEY, 'play') + ')'); lg.close(); }
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

// R3AB-2: a healthy accounts file with an account that EXISTS but was never claimed with a PIN (a legacy name) and holds Cash: the boot locks it too, not only the accounts it re-makes.
// Dave = unclaimed with 500.00 Cash (locked), Eve = claimed with 500.00 Cash (untouched, signs in with her PIN), Fay = unclaimed with no Cash (control: the room word still claims her).
async function unclaimedCash(off) {
  const tag = 'unclaimed/valid file';
  const srv = await L.startServer(off, { env: { SIGNUP_PLAY_CENTS: '0' } });
  const adm = new L.Bot(srv, 'chris'); await adm.connect(); await adm.claimAdmin();
  for (const [n, pin] of [['Dave', '1111'], ['Eve', '2222'], ['Fay', '3333']]) { const b = new L.Bot(srv, n); await b.connect(); await b.signup(pin); }
  for (const k of ['dave', 'eve']) { const r = await adm.req('admin_set_play', { key: k, cents: 50000, opId: 'r3ab2.' + k }, 'admin_result', 3000); ok(r.ok, tag + ': admin gave ' + k + ' 500.00 Cash'); }
  await L.sleep(400);
  const f = path.join(srv.dir, 'a.json');
  await srv.stop();
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const k of ['dave', 'fay']) Object.assign(j.accounts[k], { kdf: null, salt: null, pinHash: null, claimed: false, sessions: [] });   // what blank() writes for a legacy name
  delete j.accounts.dave.locked; fs.writeFileSync(f, JSON.stringify(j)); fs.rmSync(f + '.bak', { force: true });
  const srv2 = await srv.restart();
  const st = new L.Bot(srv2, 'Dave'); await st.connect(); const pe = st.wait('auth_error', 3000).catch(() => null);
  let c = await st.req('auth_claim', { name: 'Dave', pin: '9999', avatar: 'a02', roomPassword: 'ping' }, 'auth_ok', 3000); const ce = c.account ? null : await pe;
  ok(!c.account && ce && ce.code === 'account_locked', tag + ': the room word does not claim Dave, who holds Cash (got ' + JSON.stringify(ce && ce.code) + ')');
  const st2 = new L.Bot(srv2, 'Dave'); await st2.connect(); const pe2 = st2.wait('auth_error', 3000).catch(() => null);
  const s = await st2.req('auth_signup', { name: 'Dave', pin: '9999', avatar: 'a02' }, 'auth_ok', 3000); const se = s.account ? null : await pe2;
  ok(!s.account && se && se.code === 'account_locked', tag + ': signup as Dave is refused account_locked (got ' + JSON.stringify(se && se.code) + ')');
  const ev = new L.Bot(srv2, 'Eve'); await ev.connect(); const pe3 = ev.wait('auth_error', 3000).catch(() => null);
  const l = await ev.req('auth_login', { name: 'Eve', pin: '2222' }, 'auth_ok', 3000); ok(!!l.account, tag + ': Eve (claimed, 500.00 Cash) signs in with her PIN (' + JSON.stringify(l.account ? 'ok' : (await pe3))  + ')');
  const fy = new L.Bot(srv2, 'Fay'); await fy.connect(); const pe4 = fy.wait('auth_error', 3000).catch(() => null);
  const fc = await fy.req('auth_claim', { name: 'Fay', pin: '4444', avatar: 'a02', roomPassword: 'ping' }, 'auth_ok', 3000); ok(!!fc.account, tag + ': Fay (unclaimed, no Cash) is still claimed by the room word (control) (' + (fc.account ? 'ok' : JSON.stringify(await pe4)) + ')');
  await srv2.stop();
  const j2 = JSON.parse(fs.readFileSync(f, 'utf8')).accounts;
  ok(j2.dave.locked === true && !j2.eve.locked && !j2.fay.locked, tag + ': a.json: dave locked, eve and fay not');
}

(async () => {
  await cashed(0, 'empty');
  await cashed(1, 'half');
  await unreadable(2);
  let off = 3;
  for (const where of ['seat', 'escrow', 'pot']) for (const fm of ['gone', 'empty']) await heldCash(off++, where, fm);
  await heldCash(off++, 'chips', 'gone');
  // R3AB-1: names that start with bot / demo / test are ordinary signup names and hold Cash like any other: the lock must not look at the name (the runs are one after another, so the ports 0..4 are free again)
  await heldCash(0, 'wallet', 'gone', 'Tester');
  await heldCash(1, 'wallet', 'empty', 'Demon');
  await heldCash(2, 'seat', 'gone', 'Bottle');
  await heldCash(3, 'escrow', 'gone', 'Botha');
  await heldCash(4, 'chips', 'gone', 'Demi');
  await unclaimedCash(5);
  console.log(fails ? fails + ' FAILED' : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(2); });
