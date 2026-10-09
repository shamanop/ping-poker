// Money 1008 R2B-4 (server side): the REAL server.js booted on an accounts.json that exists but does not parse.
//  - a name that holds Cash comes back LOCKED: neither signup nor the public room word takes it, the real owner is told it is locked
//  - the file and its .bak both unreadable = the server does not start
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
  console.log(fails ? fails + ' FAILED' : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(2); });
