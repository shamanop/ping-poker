'use strict';
// Money 1008 S-1: the migration never mints Cash. A first boot on an EMPTY data dir leaves every account at 0 Cash; an OLD data dir that really holds Cash
// balances carries them over unchanged. Cash is the ledger currency `play`. In-process: tools/migrate-v2.js + transport/boot.js over a real ledger. Plain node: exit 0 / 1.
const fs = require('fs'), os = require('os'), path = require('path');
const { open } = require('../money/ledger');
const migrate = require('../tools/migrate-v2');
const boot = require('../transport/boot');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.message)); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'eq') + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); };

const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'mig-cash-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
let n = 0;
const acct = k => ({ key: k, display: k, claimed: true });
const accounts = (...ks) => ({ version: 1, accounts: Object.fromEntries(ks.map(k => [k, acct(k)])) });
const cashLegs = ledger => [...ledger.entries(e => e.cur === 'play')];
const playTotal = (ledger, keys) => keys.reduce((s, k) => s + ledger.balance('play:' + k, 'play'), 0);

t('empty inputs + one seed account (a first boot on an empty data dir): no Cash minted', () => {
  const { items, report } = migrate.migrate({ bank: {}, wallet: {}, stacks: {}, accounts: accounts('chris') });
  eq(items.filter(i => (i.batch || [i]).some(l => l.cur === 'play' && l.from === 'mint:signup')).length, 0, 'no play mint:signup item');
  eq(report.defaults.play, []);
  const l = open(path.join(dir, 'm' + (++n) + '.jsonl'), { fsync: 'none', log: () => {} });
  migrate.apply(l, items);
  eq(l.balance('play:chris', 'play'), 0); eq(cashLegs(l).filter(e => e.amount > 1).length, 0, 'no Cash leg of value'); eq(l.balance('mint:signup', 'play'), 0);
  eq(l.balance('bank:chris', 'chips'), 10000, 'Chips default is free play and unchanged');
  l.close();
});
t('the real boot step (transport/boot.migrateIfNeeded) on an empty data dir: Cash 0, ledger has no Cash mint', () => {
  const d = path.join(dir, 'boot' + (++n)); fs.mkdirSync(d);
  const paths = { BANK_FILE: path.join(d, 'b.json'), WALLET_FILE: path.join(d, 'w.json'), STACKS_FILE: path.join(d, 's.json'), ACCOUNTS_FILE: path.join(d, 'a.json') };
  fs.writeFileSync(paths.ACCOUNTS_FILE, JSON.stringify(accounts('chris')));
  const l = open(path.join(d, 'money.jsonl'), { fsync: 'none', log: () => {} });
  boot.migrateIfNeeded({ ledger: l, paths, migrate, log: () => {} });
  eq(l.balance('play:chris', 'play'), 0); eq(cashLegs(l).filter(e => e.from === 'mint:signup').length, 0);
  l.close();
});
t('an account with no wallet row next to accounts WITH Cash: the others carry over, the new one is 0', () => {
  const wallet = { ann: { play: 123456 }, bob: 7 };
  const { items, report } = migrate.migrate({ bank: { ann: 500, bob: 0, cy: 1 }, wallet, stacks: {}, accounts: accounts('ann', 'bob', 'cy') });
  const l = open(path.join(dir, 'm' + (++n) + '.jsonl'), { fsync: 'none', log: () => {} });
  migrate.apply(l, items);
  eq([l.balance('play:ann', 'play'), l.balance('play:bob', 'play'), l.balance('play:cy', 'play')], [123456, 7, 0]);
  eq(playTotal(l, ['ann', 'bob', 'cy']), 123463, 'ledger sums to the Cash the old files held');
  eq(l.balance('mint:signup', 'play'), 0); eq(report.totals.play, { in: 123463, out: 123463, ok: true });
  eq(l.check().play.ok, true, 'play books balance');
  l.close();
});
t('an OLD data dir holding Cash (wallet.json) through the real boot step: every balance unchanged, a second boot adds nothing', () => {
  const d = path.join(dir, 'old' + (++n)); fs.mkdirSync(d);
  const paths = { BANK_FILE: path.join(d, 'b.json'), WALLET_FILE: path.join(d, 'w.json'), STACKS_FILE: path.join(d, 's.json'), ACCOUNTS_FILE: path.join(d, 'a.json') };
  const wallet = { chris: { play: 1000000, lastTopUp: null, byGame: {} }, raj: { play: 742500 }, pia: { play: 250 }, sam: { play: 9999999 } };
  fs.writeFileSync(paths.ACCOUNTS_FILE, JSON.stringify(accounts('chris', 'raj', 'pia', 'sam', 'newbie')));
  fs.writeFileSync(paths.BANK_FILE, JSON.stringify({ chris: 1, raj: 2, pia: 3, sam: 4, newbie: 5 })); fs.writeFileSync(paths.WALLET_FILE, JSON.stringify(wallet));
  const l = open(path.join(d, 'money.jsonl'), { fsync: 'none', log: () => {} });
  boot.migrateIfNeeded({ ledger: l, paths, migrate, log: () => {} });
  const want = { chris: 1000000, raj: 742500, pia: 250, sam: 9999999, newbie: 0 };
  for (const [k, v] of Object.entries(want)) eq(l.balance('play:' + k, 'play'), v, 'Cash of ' + k);
  eq(playTotal(l, Object.keys(want)), 1000000 + 742500 + 250 + 9999999, 'ledger sums to the old wallet.json');
  eq(l.balance('mint:signup', 'play'), 0); eq(l.check().play.ok, true);
  const lines = l.lastId; boot.migrateIfNeeded({ ledger: l, paths, migrate, log: () => {} }); eq(l.lastId, lines, 'second boot writes nothing');
  l.close();
});
t('the opt-in for an old fixture: migrate(inputs, { signupPlay }) still seeds the default for accounts with no wallet row', () => {
  const { items } = migrate.migrate({ bank: {}, wallet: {}, stacks: {}, accounts: accounts('old') }, { signupPlay: 1000000 });
  const l = open(path.join(dir, 'm' + (++n) + '.jsonl'), { fsync: 'none', log: () => {} });
  migrate.apply(l, items); eq(l.balance('play:old', 'play'), 1000000); l.close();
});
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
