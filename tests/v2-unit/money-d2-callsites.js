'use strict';
// The converted call sites that keep incremental caches (service.nightSummary, port.buyInCount, port.lastHandNo) against the
// pre-D2 way of answering (a brute-force scan of every entry), over seeded random histories with a tiny window and reopens.
const L = require('./money-d2-lib');
const { New, mulberry32, eq, deq, ok, fs, path } = L;
const { createService } = require('../../money/service');
const { createMoneyPort } = require('../../tables/money-port');
const run = L.makeRunner('money-d2-callsites');
const SEEDS = Number(process.env.D2_SEEDS) || 60;
const root = L.mkdir('money-d2-callsites-');
const now = () => 1000;

// the pre-D2 bodies, over `led.entries` (which is the equivalence-proven part)
function oldNight(led, tableId, fromId) {
  const prefix = `seat:${tableId}:`, per = {};
  const row = (k) => (per[k] || (per[k] = { buyIn: 0, cashOut: 0, open: 0, net: 0 }));
  const f = (e) => (e.to.startsWith(prefix) && e.reason.startsWith('buyin:')) || (e.from.startsWith(prefix) && (e.reason.startsWith('cashout:') || e.reason.startsWith('boot:')));
  for (const e of led.entries(f, fromId || 0)) { if (e.to.startsWith(prefix)) row(e.to.slice(prefix.length)).buyIn += e.amount; else row(e.from.slice(prefix.length)).cashOut += e.amount; }
  for (const cur of ['chips', 'play']) for (const { account, balance } of led.list(prefix, cur)) row(account.slice(prefix.length)).open += balance;
  let sum = 0;
  for (const r of Object.values(per)) { r.net = r.cashOut + r.open - r.buyIn; sum += r.net; }
  return { tableId, perKey: per, zeroSum: sum === 0, sum };
}
const oldBuyIns = (led, seat, fromId) => { let n = 0; for (const _ of led.entries(e => e.to === seat && e.reason.startsWith('buyin:'), fromId || 0)) n++; return n; };
function oldHandNo(led, tableId) {
  const prefix = `hand:${tableId}:`; let max = 0;
  for (const e of led.entries(x => x.batchRef && x.batchRef.startsWith(prefix))) { const n = Number(e.batchRef.slice(prefix.length)); if (Number.isSafeInteger(n) && n > max) max = n; }
  return max;
}

function seed(s) {
  const rng = mulberry32(s * 31 + 7);
  const f = path.join(root, 'c' + s + '.jsonl');
  const window = rng.pick([1, 2, 3, 10]);
  const o = { now, fsync: 'none', log: () => {}, window, ckptEvery: rng.pick([0, 3]) };
  let led, svc, port, n = 0;
  const mk = () => { led = New.open(f, o); svc = createService(led, { now }); port = createMoneyPort({ service: svc, ledger: led, bootId: 'bt', afterWrite: () => {}, onFence: () => {} }); };
  mk();
  const tables = ['T1', 'T2', 'T3'], keys = ['ann', 'bob', 'cy'];
  for (const k of keys) led.transfer('mint:signup', 'bank:' + k, 1e7, 'chips', 'sign', 'sign:' + k);
  const marks = [0];
  const handIds = ['T1', 'T2', 'T3', 'a:b', 'a', ''];
  const check = (tag) => {
    for (let i = 0; i < 4; i++) {
      const t = rng.pick(tables), k = rng.pick(keys), from = rng.chance(0.3) ? 0 : rng.pick(marks);
      eq(port.buyInCount({ id: t }, k, from), oldBuyIns(led, `seat:${t}:${k}`, from), `${tag} buyInCount ${t} ${k} from ${from}`);
      deq(svc.nightSummary(t, { fromId: from }), oldNight(led, t, from), `${tag} nightSummary ${t} from ${from}`);
    }
    deq(svc.nightSummary('T1'), oldNight(led, 'T1', 0), tag + ' nightSummary no fromId');
    for (const h of handIds) eq(port.lastHandNo(h), oldHandNo(led, h), `${tag} lastHandNo '${h}'`);
  };
  for (let i = 0; i < 80; i++) {
    const x = rng();
    const t = rng.pick(tables), k = rng.pick(keys), seat = `seat:${t}:${k}`;
    try {
      if (x < 0.3) led.transfer('bank:' + k, seat, rng.range(1, 500), 'chips', 'buyin:chips', 'bi' + (n++));
      else if (x < 0.5) led.transfer(seat, 'bank:' + k, Math.max(1, Math.min(led.balance(seat, 'chips'), rng.range(1, 300))), 'chips', rng.pick(['cashout:chips', 'boot:recover', 'sweep']), 'co' + (n++));
      else if (x < 0.75) led.batch([{ from: 'bank:' + k, to: 'bank:' + rng.pick(keys.filter(y => y !== k)), amount: 1, cur: 'chips', reason: 'x' }], rng.pick(['hand:T1:', 'hand:T2:', 'hand:a:b:', 'hand:a:', 'hand::', 'hand:T3:', 'hand:']) + rng.pick(['1', '2', '5', '17', 'x', '', '1:2', '-4', '0x10', '3.5', String(rng.int(40))]) + (rng.chance(0.2) ? 'u' + (n++) : ''), 'hand');
      else if (x < 0.82) marks.push(led.lastId);
      else if (x < 0.9) { led.close(); mk(); }
    } catch (e) { if (!e.code) throw e; }
    check(`seed ${s} i${i}`);
  }
  led.close();
}
for (let s = 1; s <= SEEDS; s++) run.t('call sites vs brute force, seed ' + s, () => seed(s));
fs.rmSync(root, { recursive: true, force: true });
run.done();
