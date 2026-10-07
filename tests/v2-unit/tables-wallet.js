'use strict';
// transport/wallet-adapter.js against a real money.open() on a temp file. Plain node: exit 0 on pass, 1 on fail.
const fs = require('fs');
const path = require('path');
const { open } = require('../../money/ledger');
const { createService } = require('../../money/service');
const { createWalletAdapter } = require('../../transport/wallet-adapter');

let pass = 0, fail = 0;
const jobs = [];
function t(name, fn) { jobs.push([name, fn]); }
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'eq') + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); };
const ok = (c, m) => { if (!c) throw new Error(m || 'not ok'); };
fs.mkdirSync(path.join(__dirname, '..', '..', 'tables', 'runs'), { recursive: true }); // gitignored scratch dir, absent in a fresh checkout
const dir = fs.mkdtempSync(path.join(path.join(__dirname, '..', '..', 'tables', 'runs'), 'wl-'));
let n = 0;
function env() {
  const file = path.join(dir, 'm' + (++n) + '.jsonl');
  const ledger = open(file, { fsync: 'none', log: () => {} });
  const service = createService(ledger);
  service.ensureAccount('ann');
  const pushed = [], q = [];
  const wallet = createWalletAdapter({ service, ledger, onChange: k => pushed.push(k), schedule: fn => q.push(fn), log: () => {} });
  return { file, ledger, service, wallet, pushed, runTick: () => { while (q.length) q.shift()(); } };
}
const bal = (e, a, cur) => e.ledger.balance(a, cur);

t('spend only parks: nothing written, get() subtracts it', () => {
  const e = env(), before = e.ledger.lastId;
  const v = e.wallet.spend('ann', 'play', 100, { game: 'bender', round: 'r1' });
  eq(e.ledger.lastId, before); eq(v.play, e.service.START_PLAY - 100); eq(e.wallet.get('ann').play, e.service.START_PLAY - 100);
});
t('spend then credit = ONE houseRound batch, same ref twice answers dup (no second batch)', () => {
  const e = env();
  e.wallet.spend('ann', 'play', 100, { game: 'bender', round: 'r1' });
  const before = e.ledger.lastId;
  const v = e.wallet.credit('ann', 'play', 250, { game: 'bender', round: 'r1' });
  eq(v.play, e.service.START_PLAY + 150);
  ok(e.ledger.lastId <= before + 2, 'one batch (two lines at most)');
  eq(bal(e, 'house:bender', 'play'), -150);
  const after = e.ledger.lastId;
  e.wallet.spend('ann', 'play', 100, { game: 'bender', round: 'r1' });   // the same round retried: spend + credit again
  const v2 = e.wallet.credit('ann', 'play', 250, { game: 'bender', round: 'r1' });
  eq(e.ledger.lastId, after, 'dup writes nothing'); eq(v2.play, e.service.START_PLAY + 150);
  ok(e.ledger.check().play.ok);
});
t('credit 0 settles the stake as a loss', () => {
  const e = env();
  e.wallet.spend('ann', 'play', 100, { game: 'bender', round: 'r2' });
  e.wallet.credit('ann', 'play', 0, { game: 'bender', round: 'r2' });
  eq(e.wallet.get('ann').play, e.service.START_PLAY - 100); eq(bal(e, 'house:bender', 'play'), 100); eq(e.wallet.pendingCount(), 0);
});
t('spend with no credit is flushed at the end of the tick as a loss', () => {
  const e = env();
  e.wallet.spend('ann', 'play', 40, { game: 'bender', round: 'r3' });
  eq(bal(e, 'play:ann', 'play'), e.service.START_PLAY);
  e.runTick();
  eq(bal(e, 'play:ann', 'play'), e.service.START_PLAY - 40); eq(e.wallet.pendingCount(), 0); ok(e.pushed.includes('ann'));
});
t('crash between spend and credit leaves the ledger unchanged', () => {
  const e = env();
  e.wallet.spend('ann', 'play', 500, { game: 'bender', round: 'r4' });
  e.ledger.close();
  const l2 = open(e.file, { fsync: 'none', log: () => {} });
  eq(l2.balance('play:ann', 'play'), e.service.START_PLAY); eq(l2.balance('house:bender', 'play'), 0);
});
t('funds error writes nothing and parks nothing', () => {
  const e = env(), before = e.ledger.lastId;
  let code = null; try { e.wallet.spend('ann', 'play', e.service.START_PLAY + 1, { game: 'bender', round: 'r5' }); } catch (x) { code = x.code; }
  eq(code, 'funds'); eq(e.ledger.lastId, before); eq(e.wallet.pendingCount(), 0);
});
t('two parked stakes cannot overspend the same wallet', () => {
  const e = env();
  e.wallet.spend('ann', 'play', e.service.START_PLAY - 10, { game: 'bender', round: 'a' });
  let code = null; try { e.wallet.spend('ann', 'play', 11, { game: 'bender', round: 'b' }); } catch (x) { code = x.code; }
  eq(code, 'funds');
});
t('chips mode uses the bank and houseRound in chips', () => {
  const e = env();
  e.wallet.spend('ann', 'chips', 1000, { game: 'bender', round: 'c1' });
  e.wallet.credit('ann', 'chips', 3000, { game: 'bender', round: 'c1' });
  eq(bal(e, 'bank:ann', 'chips'), e.service.START_CHIPS + 2000); ok(e.ledger.check().chips.ok);
});
t('achv and bonus credits are Chips mints (never Play $), bonus double claim is dup at the ledger', () => {
  const e = env();
  e.wallet.credit('ann', 'play', 700, { game: 'achv', round: 'first' });       // a caller asking for Play $ still gets Chips
  e.wallet.credit('ann', 'chips', 900, { game: 'bonus', round: '2026-10-06' });
  const after = e.ledger.lastId;
  e.wallet.credit('ann', 'chips', 900, { game: 'bonus', round: '2026-10-06' });
  eq(e.ledger.lastId, after); eq(bal(e, 'bank:ann', 'chips'), e.service.START_CHIPS + 1600); ok(e.ledger.check().chips.ok);
  eq(bal(e, 'play:ann', 'play'), e.service.START_PLAY, 'Play $ untouched by rewards');
});
t('bad arguments map to codes', () => {
  const e = env();
  const code = fn => { try { fn(); } catch (x) { return x.code; } return null; };
  eq(code(() => e.wallet.spend('ann', 'play', 0, { game: 'bender', round: 'z' })), 'amount');
  eq(code(() => e.wallet.spend('ann', 'gold', 5, { game: 'bender', round: 'z' })), 'mode');
  eq(code(() => e.wallet.spend('ann', 'play', 1.5, { game: 'bender', round: 'z' })), 'amount');
});
t('topUp: not_needed carries code, success writes a mint', () => {
  const e = env();
  let c = null; try { e.wallet.topUp('ann'); } catch (x) { c = x.code; }
  eq(c, 'not_needed');
  e.wallet.spend('ann', 'play', e.service.START_PLAY - 100, { game: 'bender', round: 'tu' }); e.wallet.credit('ann', 'play', 0, { game: 'bender', round: 'tu' });
  const v = e.wallet.topUp('ann'); eq(v.play, e.service.START_PLAY);
});

for (const [name, fn] of jobs) { try { fn(); pass++; } catch (x) { fail++; console.log('FAIL ' + name + ': ' + (x && x.stack ? x.stack.split('\n').slice(0, 3).join(' | ') : x)); } }
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
