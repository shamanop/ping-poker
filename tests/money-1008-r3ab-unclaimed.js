'use strict';
// Money 1008 R3AB-2: the admin money edits refuse to leave Cash above 0 on an account that is not claimed with a PIN (the public room word would claim the name and the Cash).
// Unit level on createAdmin (real ledger + service), then one real server: refused, ledger unchanged, then after a real claim with a PIN the same edit is accepted.
// Plain node: exit 0 on pass, 1 on fail. Real-server port: R3_PORT or 5680.
const fs = require('fs'), os = require('os'), path = require('path');
const { open } = require('../money/ledger');
const { createService } = require('../money/service');
const { createAdmin } = require('../admin');
const L = require('./v2/lib.js');

let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.message)); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'eq') + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); };

const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'adm-unclaimed-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
let n = 0;
function env(acct) {
  const ledger = open(path.join(dir, 'm' + (++n) + '.jsonl'), { fsync: 'none', log: () => {} });
  const service = createService(ledger, { signupPlay: 0 });
  service.ensureAccount('ann');
  const accounts = { get: k => (k === 'ann' ? { key: 'ann', ...acct } : null), all: () => ({}) };
  const adm = createAdmin({ service, ledger, accounts, registry: { tables: new Map() }, views: {}, onlineKeys: () => new Set() });
  return { ledger, service, adm, wallet: () => ledger.balance('play:ann', 'play') };
}
const UNCLAIMED = { claimed: false, pinHash: null };
const refused = (r, e, id) => { eq([r.ok, r.code], [false, 'account_unclaimed']); if (!/PIN/.test(r.message || '')) throw new Error('message does not say PIN: ' + r.message); eq(e.ledger.lastId, id, 'no ledger line'); };

(async () => {
  await t('unit: Set Cash > 0 on an unclaimed account is refused, no ledger line', async () => {
    const e = env(UNCLAIMED), id = e.ledger.lastId;
    refused(e.adm.setPlay('ann', 50000, 'u1'), e, id); eq(e.wallet(), 0);
  });
  await t('unit: Cash adjust ending above 0 on an unclaimed account is refused, no ledger line', async () => {
    const e = env(UNCLAIMED), id = e.ledger.lastId;
    refused(e.adm.adjust('ann', 100, 'play', 'gift', 'u2'), e, id); eq(e.wallet(), 0);
  });
  await t('unit: taking Cash back (Set Cash 0, negative adjust, lower Set Cash) stays allowed on an unclaimed account', async () => {
    const e = env({ claimed: true }); e.adm.setPlay('ann', 50000, 'u3a'); eq(e.wallet(), 50000);
    // the account loses its claim (accounts.json re-made): the admin can still take money back
    const un = createAdmin({ service: e.service, ledger: e.ledger, accounts: { get: k => (k === 'ann' ? { key: 'ann', ...UNCLAIMED } : null), all: () => ({}) }, registry: { tables: new Map() }, views: {}, onlineKeys: () => new Set() });
    let r = un.adjust('ann', -10000, 'play', 'take back', 'u3b'); eq(r.ok, true); eq(e.wallet(), 40000);
    r = un.setPlay('ann', 10000, 'u3c'); eq(r.ok, true); eq(e.wallet(), 10000);
    r = un.setPlay('ann', 10000, 'u3d'); eq([r.ok, r.noop], [true, true]);
    r = un.setPlay('ann', 0, 'u3e'); eq(r.ok, true); eq(e.wallet(), 0);
  });
  await t('unit: Chips edits on an unclaimed account are not changed', async () => {
    const e = env(UNCLAIMED); const r = e.adm.adjust('ann', 5000, 'chips', 'gift', 'u4'); eq(r.ok, true);
  });
  await t('unit: a claimed account takes the same edits', async () => {
    const e = env({ claimed: true }); eq(e.adm.setPlay('ann', 50000, 'u5a').ok, true); eq(e.adm.adjust('ann', 100, 'play', 'gift', 'u5b').ok, true); eq(e.wallet(), 50100);
  });
  await t('unit: a locked account (boot lock) keeps its behaviour: a stranger cannot claim it, only the admin PIN reset opens it', async () => {
    const e = env({ claimed: false, locked: true }); eq(e.adm.setPlay('ann', 50000, 'u6').ok, true); eq(e.wallet(), 50000);
  });
  await t('unit: a resend of a held Cash edit after the account lost its claim is still the ledger\'s dup', async () => {
    const e = env({ claimed: true }); eq(e.adm.setPlay('ann', 50000, 'u7').ok, true);
    const un = createAdmin({ service: e.service, ledger: e.ledger, accounts: { get: k => (k === 'ann' ? { key: 'ann', ...UNCLAIMED } : null), all: () => ({}) }, registry: { tables: new Map() }, views: {}, onlineKeys: () => new Set() });
    const id = e.ledger.lastId, r = un.setPlay('ann', 50000, 'u7'); eq(r.ok, true); eq(e.ledger.lastId, id);
  });

  await t('server: Set Cash on an unclaimed name refused, ledger unchanged; after a real claim with a PIN the same edit is accepted', async () => {
    const sdir = fs.mkdtempSync(path.join(dir, 'srv-'));
    const srv = await L.startServer(Number(process.env.R3_PORT || 5680), { dir: sdir, env: { SIGNUP_PLAY_CENTS: '0' } });
    let srv2;
    try {
      const adm = new L.Bot(srv, 'chris'); await adm.connect(); await adm.claimAdmin();
      const dave = new L.Bot(srv, 'Dave'); await dave.connect(); await dave.signup('1111');
      await L.sleep(300); await srv.stop();
      const f = path.join(sdir, 'a.json'); const db = JSON.parse(fs.readFileSync(f, 'utf8')); const a = db.accounts.dave;
      a.kdf = null; a.salt = null; a.pinHash = null; a.claimed = false; a.sessions = Array.isArray(a.sessions) ? [] : {};
      fs.writeFileSync(f, JSON.stringify(db)); fs.rmSync(f + '.bak', { force: true });
      srv2 = await srv.restart();
      const a2 = new L.Bot(srv2, 'chris'); await a2.connect(); const lg = await a2.req('auth_login', { name: 'chris', pin: '4321' }, 'auth_ok', 3000);
      if (!lg.account) throw new Error('admin sign-in failed');
      const lines = () => fs.readFileSync(path.join(sdir, 'money.jsonl'), 'utf8').split('\n').filter(Boolean).length;
      const before = lines();
      const r = await a2.req('admin_set_play', { key: 'dave', cents: 50000, opId: 'r3ab2.s1' }, 'admin_result', 3000);
      eq([r.ok, r.code], [false, 'account_unclaimed']); eq(lines(), before, 'ledger lines');
      const st = new L.Bot(srv2, 'Dave'); await st.connect();
      const c = await st.req('auth_claim', { name: 'Dave', pin: '9999', avatar: 'a02', roomPassword: 'ping' }, 'auth_ok', 3000);
      if (!c.account) throw new Error('claim failed');
      const r2 = await a2.req('admin_set_play', { key: 'dave', cents: 50000, opId: 'r3ab2.s2' }, 'admin_result', 3000);
      eq(r2.ok, true); if (lines() <= before) throw new Error('no ledger line after the claimed edit');
    } finally { try { await (srv2 || srv).stop(); } catch {} }
  });

  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('SCRIPT ERROR ' + (e && e.stack || e)); process.exit(2); });
