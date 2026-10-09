// Money 1008 R2B-4: an accounts file that exists but does not parse is never read as "no accounts".
// Exit 1 while the fault exists (a cut file boots as an empty store, the names return UNCLAIMED and the room word takes their Cash), exit 0 when fixed.
// accounts.js directly, no server, no ports. Plain node script like tests/money-1008-proto.js.
const fs = require('fs'), os = require('os'), path = require('path');
const { createAccounts } = require(path.join(__dirname, '..', 'accounts.js'));
let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const TMP = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'ppacct-'));
const CTX = { ip: '9.9.9.9', ua: 't' };
const mk = () => { const d = fs.mkdtempSync(path.join(TMP, 'd-')); return { d, f: path.join(d, 'a.json') }; };
const flushAll = a => a.flush();
// capture console.error while fn runs
function loud(fn) { const lines = []; const e = console.error, l = console.log; console.error = (...x) => lines.push(x.join(' ')); console.log = () => {}; let r, thrown = null; try { r = fn(); } catch (x) { thrown = x; } finally { console.error = e; console.log = l; } return { r, lines, thrown }; }
const names = d => fs.readdirSync(d);

// a store with chris (admin, claimed by hand), bob (PIN 1111, claimed) and two saves, so .bak holds bob
function seed(f) {
  const a = createAccounts({ file: f });
  a.migrateLegacy({ bank: {}, ledgerEntries: [] });
  const s = a.signup('Bob', '1111', 'a01', CTX); if (!s.ok) throw new Error('seed signup');
  flushAll(a);
  a.updateProfile('bob', { prefs: { sound: false } }); flushAll(a);   // second save: the first one is now the .bak
  return a;
}

// 1. writes: temp + .bak (the version before the last save), no .tmp left
{
  const { d, f } = mk(); seed(f);
  ok(fs.existsSync(f + '.bak'), '1 a save keeps the previous good file as .bak');
  ok(!names(d).some(n => n.endsWith('.tmp')), '1 no .tmp left behind');
  const bakJ = JSON.parse(fs.readFileSync(f + '.bak', 'utf8')), mainJ = JSON.parse(fs.readFileSync(f, 'utf8'));
  ok(bakJ.accounts.bob && bakJ.accounts.bob.prefs.sound === true && mainJ.accounts.bob.prefs.sound === false, '1 .bak is exactly one save behind main');
}

// 2. main cut in half, .bak good: loud line, damaged bytes kept, restored from .bak, the real Bob can log in, a stranger cannot take the name
for (const mode of ['half', 'empty', 'garbage', 'wrongshape']) {
  const { d, f } = mk(); seed(f);
  const full = fs.readFileSync(f, 'utf8');
  const bad = mode === 'half' ? full.slice(0, Math.floor(full.length / 2)) : mode === 'empty' ? '' : mode === 'garbage' ? '\u0000\u0000\u0000not json' : '{"hello":1}';
  fs.writeFileSync(f, bad);
  const { r: a, lines, thrown } = loud(() => createAccounts({ file: f }));
  ok(!thrown, `2 ${mode}: boots from .bak`);
  if (thrown) continue;
  const secure = lines.filter(l => /accounts/.test(l) && /Restored|restor/i.test(l));
  ok(secure.length === 1, `2 ${mode}: exactly one loud line says it restored from the .bak (${secure.length})`);
  const kept = names(d).filter(n => n.startsWith('a.json.damaged-'));
  ok(kept.length === 1 && fs.readFileSync(path.join(d, kept[0]), 'utf8') === bad, `2 ${mode}: the damaged bytes are kept under a dated name (${kept.join(',')})`);
  ok(a.login('Bob', '1111', CTX).ok, `2 ${mode}: the real Bob logs in with his PIN`);
  ok(!a.claim('Bob', '9999', 'a01', 'ping', CTX).ok, `2 ${mode}: the room word does not claim Bob`);
  ok(JSON.parse(fs.readFileSync(f, 'utf8')).accounts.bob, `2 ${mode}: the restored file is on disk again`);
}

// 3. main missing, .bak good: restored, loud
{
  const { f } = mk(); seed(f); fs.unlinkSync(f);
  const { r: a, lines, thrown } = loud(() => createAccounts({ file: f }));
  ok(!thrown && a.login('Bob', '1111', CTX).ok && lines.some(l => /missing/.test(l) && /Restored/.test(l)), '3 main missing + good .bak: restored loudly');
}

// 4. neither usable: the loader throws (the server does not start), main stays in place, the message names the files, nothing is overwritten
for (const bakMode of ['bad', 'missing']) {
  const { d, f } = mk(); seed(f);
  const full = fs.readFileSync(f, 'utf8'); const cut = full.slice(0, 40);
  fs.writeFileSync(f, cut);
  if (bakMode === 'bad') fs.writeFileSync(f + '.bak', full.slice(0, 10)); else fs.unlinkSync(f + '.bak');
  for (let i = 0; i < 2; i++) {   // twice: the second boot fails the same way (main was not moved away)
    const { thrown, lines } = loud(() => createAccounts({ file: f }));
    ok(thrown && /does NOT start/.test(thrown.message) && thrown.message.includes(f) && thrown.message.includes('.bak'), `4 ${bakMode} .bak, boot ${i + 1}: throws, names the files`);
    ok(lines.some(l => /SECURITY/.test(l)), `4 ${bakMode} .bak, boot ${i + 1}: one loud line`);
  }
  ok(fs.readFileSync(f, 'utf8') === cut, `4 ${bakMode} .bak: the damaged main is untouched`);
  ok(names(d).filter(n => n.startsWith('a.json.damaged-')).length === 1, `4 ${bakMode} .bak: one kept copy of the damaged bytes (not one per boot)`);
}

// 5. a missing file on an empty data dir boots fresh and quiet
{
  const { f } = mk();
  const { r: a, lines, thrown } = loud(() => createAccounts({ file: f }));
  ok(!thrown && lines.length === 0 && Object.keys(a.all()).length === 0, '5 empty data dir: fresh, quiet');
}

// 6. (d) an account re-made for a key that holds Cash is LOCKED; the room word, signup and login do not open it; only the admin PIN reset does
{
  const { f } = mk();
  const a = createAccounts({ file: f });
  const rl = loud(() => a.migrateLegacy({ bank: { Bob: 1000, Zed: 500 }, ledgerEntries: [], cash: { bob: 50000, ghost: 700 } }));
  ok(a.get('bob') && a.get('bob').locked === true, '6 bob (Cash 500.00) is re-made LOCKED');
  ok(a.get('ghost') && a.get('ghost').locked === true, '6 a key that only the Cash ledger knows is re-made locked too');
  ok(a.get('zed') && !a.get('zed').locked, '6 zed (no Cash) is re-made unlocked as before');
  ok(rl.lines.some(l => /SECURITY/.test(l) && /LOCKED/.test(l)), '6 one loud line says accounts were locked');
  const c = a.claim('Bob', '9999', 'a01', 'ping', CTX);
  ok(!c.ok && c.code === 'account_locked', `6 claim with the room word refused (${c.code})`);
  const s = a.signup('Bob', '9999', 'a01', CTX);
  ok(!s.ok && s.code === 'account_locked', `6 signup refused with the same code (${s.code})`);
  const l = a.login('Bob', '9999', CTX);
  ok(!l.ok && l.code === 'account_locked', `6 login refused with the same code (${l.code})`);
  ok(a.claim('Zed', '4321', 'a01', 'ping', CTX).ok, '6 an unlocked legacy name is still claimable with the room word');
  ok(a.get('chris') && !a.get('chris').locked, '6 the admin account is not locked (its claim never takes the room word)');
  // the lock survives a restart
  flushAll(a);
  const b = createAccounts({ file: f });
  ok(!b.claim('Bob', '9999', 'a01', 'ping', CTX).ok && b.get('bob').locked === true, '6 the lock is stored and survives a restart');
  // admin reset opens it
  const adm = b.claim('chris', '4321', 'a01', 'x', CTX);   // no ADMIN_CLAIM_PASSWORD: refused, so make chris an admin session by hand
  const bo = b.get('chris'); bo.claimed = true; bo.pinHash = 'x';
  const rr = b.resetPin('chris', 'bob', '2468');
  ok(rr.ok && !b.get('bob').locked, '6 admin PIN reset unlocks the account');
  ok(b.login('Bob', '2468', CTX).ok, '6 ...and Bob logs in with the new PIN');
}

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
