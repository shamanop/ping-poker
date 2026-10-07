'use strict';
// The converted call sites that keep incremental caches (service.nightSummary, port.buyInCount, port.lastHandNo) against the
// pre-D2 way of answering (a brute-force scan of every entry of the FROZEN pre-D2 ledger, fed the same calls), over seeded random histories with a tiny window and reopens.
// The D2 side is pinned: window, ckpt, ckptEvery, ckptVerify.
const L = require('./money-d2-lib');
const { New, Ref, mulberry32, eq, deq, ok, fs, path } = L;
const { createService } = require('../../money/service');
const { createMoneyPort } = require('../../tables/money-port');
const run = L.makeRunner('money-d2-callsites');
const SEEDS = Number(process.env.D2_SEEDS) || 60;
const root = L.mkdir('money-d2-callsites-');
const now = () => 1000;

// the pre-D2 bodies, over the frozen ledger's `entries`
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
  const o = { now, fsync: 'none', log: () => {}, window, ckpt: true, ckptEvery: rng.pick([0, 3]), ckptVerify: false };
  let led, ref, svc, port, n = 0;
  const mk = () => { ref = Ref.open(f + '.ref', { now, fsync: 'none', log: () => {} }); led = New.open(f, o); svc = createService(led, { now }); port = createMoneyPort({ service: svc, ledger: led, bootId: 'bt', afterWrite: () => {}, onFence: () => {} }); };
  mk();
  // the same call goes to the frozen ledger and to the D2 ledger; the outcome (id or error code) must agree
  const both = (fn) => {
    const go = (l) => { try { return JSON.stringify(fn(l)); } catch (e) { if (!e.code) throw e; return 'E:' + e.code; } };
    const want = go(ref), got = go(led);
    eq(got, want, 'the same call gives the same outcome');
    if (got.startsWith('E:')) throw new MoneyErrorLike(got);
  };
  class MoneyErrorLike extends Error {}
  const tables = ['T1', 'T2', 'T3', 'Tö'], keys = ['ann', 'bob', 'cy', 'jürgen'];
  for (const k of keys) both(l => l.transfer('mint:signup', 'bank:' + k, 1e7, 'chips', 'sign', 'sign:' + k));
  const marks = [0];
  const handIds = ['T1', 'T2', 'T3', 'Tö', 'a:b', 'a', ''];
  const check = (tag) => {
    for (let i = 0; i < 4; i++) {
      const t = rng.pick(tables), k = rng.pick(keys), from = rng.chance(0.3) ? 0 : rng.pick(marks);
      eq(port.buyInCount({ id: t }, k, from), oldBuyIns(ref, `seat:${t}:${k}`, from), `${tag} buyInCount ${t} ${k} from ${from}`);
      deq(svc.nightSummary(t, { fromId: from }), oldNight(ref, t, from), `${tag} nightSummary ${t} from ${from}`);
    }
    deq(svc.nightSummary('T1'), oldNight(ref, 'T1', 0), tag + ' nightSummary no fromId');
    for (const h of handIds) eq(port.lastHandNo(h), oldHandNo(ref, h), `${tag} lastHandNo '${h}'`);
  };
  for (let i = 0; i < 80; i++) {
    const x = rng();
    const t = rng.pick(tables), k = rng.pick(keys), seat = `seat:${t}:${k}`;
    try {
      if (x < 0.3) { const amt = rng.range(1, 500), r1 = 'bi' + (n++); both(l => l.transfer('bank:' + k, seat, amt, 'chips', 'buyin:chips', r1)); }
      else if (x < 0.45) { const amt = Math.max(1, Math.min(led.balance(seat, 'chips'), rng.range(1, 300))), why = rng.pick(['cashout:chips', 'boot:recover', 'sweep']), ref1 = 'co' + (n++); both(l => l.transfer(seat, 'bank:' + k, amt, 'chips', why, ref1)); }
      else if (x < 0.5) { const t2 = rng.pick(tables), k2 = rng.pick(keys), amt = Math.max(1, Math.min(led.balance(seat, 'chips'), rng.range(1, 50))), why = rng.pick(['cashout:chips', 'boot:x', 'buyin:chips']), ref1 = 'ss' + (n++); both(l => l.transfer(seat, `seat:${t2}:${k2}`, amt, 'chips', why, ref1)); }   // seat -> seat, same and other table
      else if (x < 0.75) { const k2 = rng.pick(keys.filter(y => y !== k)), r1 = rng.pick(['hand:T1:', 'hand:T2:', 'hand:a:b:', 'hand:a:', 'hand::', 'hand:T3:', 'hand:Tö:', 'hand:']) + rng.pick(['1', '2', '5', '17', 'x', '', '1:2', '-4', '0x10', '3.5', String(rng.int(40))]) + (rng.chance(0.2) ? 'u' + (n++) : ''); both(l => l.batch([{ from: 'bank:' + k, to: 'bank:' + k2, amount: 1, cur: 'chips', reason: 'x' }], r1, 'hand')); }
      else if (x < 0.82) marks.push(led.lastId);
      else if (x < 0.9) { led.close(); ref.close(); mk(); }
    } catch (e) { if (!(e instanceof MoneyErrorLike)) throw e; }
    check(`seed ${s} i${i}`);
  }
  led.close(); ref.close();
}
for (let s = 1; s <= SEEDS; s++) run.t('call sites vs brute force, seed ' + s, () => seed(s));

// ---- fix2 E13: the expected answers come from the REAL a10735a service + port on the frozen ledger (fixtures/), same calls on both sides,
// asked also with fromId AHEAD of lastId, with hand-made lines (two top-up legs in one line, seat->seat, a leg without a reason) ----
const loadPre = (file, map) => {
  const m = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(path.join(__dirname, 'fixtures', file), 'utf8'))((r) => map[r] || require(r), m, m.exports);
  return m.exports;
};
const PreSvc = loadPre('service-pre-d2.js', { './ledger': Ref, './errors': require('../../tables/errors') });
const PrePort = loadPre('money-port-pre-d2.js', { './errors': require('../../tables/errors') });
function realOldSeed(s) {
  const rng = mulberry32(s * 977 + 5);
  const fo = path.join(root, 'ro' + s + '.jsonl'), fn = path.join(root, 'rn' + s + '.jsonl');
  const o = { fsync: 'none', log: () => {}, window: rng.pick([1, 2, 3, 10]), ckpt: true, ckptEvery: rng.pick([0, 3]), ckptVerify: false };
  let clock = 1e12; const clk = () => clock;
  let A, B;
  const open = () => {
    const lo = Ref.open(fo, { fsync: 'none', log: () => {}, now: clk }), ln = New.open(fn, { ...o, now: clk });
    const so = PreSvc.createService(lo, { now: clk }), sn = createService(ln, { now: clk });
    A = { l: lo, s: so, p: PrePort.createMoneyPort({ service: so, ledger: lo, bootId: 'b', afterWrite: () => {}, onFence: () => {} }) };
    B = { l: ln, s: sn, p: createMoneyPort({ service: sn, ledger: ln, bootId: 'b', afterWrite: () => {}, onFence: () => {} }) };
  };
  open();
  const call = (fn) => { try { return JSON.stringify(fn()); } catch (e) { if (!e.code) throw e; return 'E:' + e.code; } };
  const both = (what, fn) => eq(call(() => fn(B)), call(() => fn(A)), `seed ${s} ${what}`);
  const tables = ['T', 'U', 'π'], keys = ['a', 'b', 'é'];
  for (let i = 0; i < 90; i++) {
    clock += 1000 * rng.range(0, 3000);
    const t = rng.pick(tables), k = rng.pick(keys), k2 = rng.pick(keys), cur = rng.pick(['chips', 'play']), a = rng.range(1, 30), ref = 'x' + s + '.' + i, w = rng.int(14);
    if (w < 2) both('ensure', X => X.s.ensureAccount(k));
    else if (w < 5) both('buyIn', X => X.s.buyIn(k, t, a, cur, cur, ref));
    else if (w < 7) both('cashOut', X => X.s.cashOut(k, t, a, cur, null, ref));
    else if (w < 8) both('settle', X => X.s.settleHand(t, i, cur, { committed: { [k]: 2 }, payouts: { [k]: 2 } }));
    else if (w < 9) both('topUp', X => X.s.topUp(k, ref));
    else if (w < 10) both('two top-up legs in one line', X => X.l.batch([{ from: 'mint:topup', to: 'play:' + k, amount: a, cur: 'play' }, { from: 'mint:topup', to: 'play:' + k2, amount: a, cur: 'play' }], ref, 'topup'));
    else if (w < 11) both('seat->seat', X => X.l.batch([{ from: `seat:${t}:${k}`, to: `seat:${t}:${k2}`, amount: 1, cur }], ref, 'cashout:' + cur));
    else if (w < 12) { A.l.close(); if (rng.chance(0.5)) B.l.checkpoint(); B.l.close(); open(); }
    for (const tb of tables) {
      const last = A.l.lastId;
      for (const from of [0, undefined, last, last + 3, rng.int(last + 1)]) both(`nightSummary ${tb} ${from}`, X => X.s.nightSummary(tb, { fromId: from }));
      both('lastHandNo ' + tb, X => X.p.lastHandNo(tb));
      for (const ky of keys) { both(`seatFund ${tb} ${ky}`, X => X.s.seatFund(tb, ky, 'chips')); both(`buyInCount ${tb} ${ky}`, X => [X.p.buyInCount({ id: tb }, ky, 0), X.p.buyInCount({ id: tb }, ky, last + 3)]); }
    }
    for (const ky of keys) both('topUpEligible ' + ky, X => X.s.topUpEligible(ky));
  }
  A.l.close(); B.l.close();
}
for (let s = 1; s <= Math.max(10, SEEDS / 3); s++) run.t('real a10735a service + port, same calls (also fromId ahead of lastId, two top-up legs in one line), seed ' + s, () => realOldSeed(s));
fs.rmSync(root, { recursive: true, force: true });
run.done();
