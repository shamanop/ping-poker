'use strict';
// D2 fix round 2 (critic round 2, E8-E13): one top-up time per LEG, a leg without a reason never stops createService, nightSummary does not
// depend on when it was first asked, the rules fingerprint covers the live SOURCE_ACCOUNTS, window 1 costs no cold scan, sidecar shape
// (a line after the end line, header counts, a full balance block). Every open pins window, ckpt, ckptEvery, ckptVerify.
const L = require('./money-d2-lib');
const { New, Ref, eq, deq, ok, fs, path } = L;
const { createService } = require('../../money/service');
const run = L.makeRunner('money-d2-fix2');
const t = run.t;
const root = L.mkdir('money-d2-fix2-');
let n = 0;
let clock = 1e12;
const now = () => clock;
const file = () => path.join(root, 'f' + (++n) + '.jsonl');
const PIN = { now, fsync: 'none', window: 5, ckpt: true, ckptEvery: 0, ckptVerify: false };
const OPEN = (f, o = {}, mod = New) => { const log = L.logger(); const led = mod.open(f, { ...PIN, log, ...o }); led.logs = log.lines; return led; };
const REFOPEN = (f) => Ref.open(f, { now, fsync: 'none', log: () => {} });
const snap = (led) => JSON.stringify({ c: led.list('', 'chips'), p: led.list('', 'play'), k: led.check(), id: led.lastId, q: led.quarantined, e: [...led.entries()] });
const fullOf = (f) => { const g = file(); fs.copyFileSync(f, g); const r = REFOPEN(g); const s = snap(r); r.close(); return s; };
const ignored = (l) => l.logs.filter(m => /^checkpoint ignored/.test(m));

// ---- E8: the top-up time is kept per leg (N14) ----
t('E8 a line with `topup` legs to two players sets both cooldowns: topUp(a) inside the cooldown is refused', () => {
  clock = 1e12; const l = OPEN(file()), s = createService(l, { now });
  l.batch([{ from: 'mint:topup', to: 'play:a', amount: 5, cur: 'play' }, { from: 'mint:topup', to: 'play:b', amount: 5, cur: 'play' }], 'tb1', 'topup');
  clock += 60000;
  for (const k of ['a', 'b']) { const e = s.topUpEligible(k); eq(e.eligible, false, k); eq(e.why, 'cooldown', k); }
  try { s.topUp('a', 'tu-a'); ok(false, 'minted inside the cooldown'); } catch (e) { eq(e.code, 'cooldown'); }
  l.close();
});

// ---- E9: a leg the replay accepts never stops createService ----
t('E9 a batch leg without its own reason (stored as null): createService returns, the other seats and accounts answer', () => {
  const f = file();
  fs.writeFileSync(f, ['{"id":1,"ts":1,"from":"mint:signup","to":"bank:a","amount":100,"cur":"chips","reason":"signup","ref":"s1"}',
    '{"id":2,"ts":2,"batch":[{"from":"bank:a","to":"seat:T:a","amount":10,"cur":"chips"}],"ref":"b1","reason":"buyin:chips"}'].join('\n') + '\n');
  const l = OPEN(f); eq(l.quarantined.length, 0); eq(l.balance('seat:T:a', 'chips'), 10);
  const s = createService(l, { now });
  eq(s.ensureAccount('b').created, true); eq(s.seatFund('T', 'b'), null);
  eq(s.seatFund('T', 'a'), null, 'not a buy-in: no fund found (a10735a threw a TypeError here)');
  eq(s.buyInCount('T', 'a', 0), 0); eq(s.nightSummary('T').perKey.a.buyIn, 0);
  s.buyIn('b', 'T', 5, 'chips', 'chips', 'bb1'); eq(s.buyInCount('T', 'b', 0), 1); eq(s.seatFund('T', 'b'), 'chips');
  l.close();
});

// ---- E10: nightSummary counts exactly the events with id > fromId, however early it was first asked ----
t('E10 first asked while fromId is ahead of lastId, then lines with id <= fromId: same answer as after a restart', () => {
  const f = file(); let l = OPEN(f), s = createService(l, { now });
  l.transfer('mint:signup', 'bank:a', 1000, 'chips', 'signup', 's1');
  s.nightSummary('T', { fromId: 3 });
  s.buyIn('a', 'T', 100, 'chips', 'chips', 'b1'); s.buyIn('a', 'T', 50, 'chips', 'chips', 'b2'); s.buyIn('a', 'T', 7, 'chips', 'chips', 'b3');
  const live = s.nightSummary('T', { fromId: 3 }).perKey.a;
  l.close(); l = OPEN(f); s = createService(l, { now });
  const boot = s.nightSummary('T', { fromId: 3 }).perKey.a;
  eq(live.buyIn, 7); deq(live, boot); l.close();
});

// ---- E11: the fingerprint covers the live content of SOURCE_ACCOUNTS ----
t('E11 SOURCE_ACCOUNTS.add() at run time, a sidecar written, a process without it: the sidecar is refused, the answer is the full replay', () => {
  const f = file(); const l = OPEN(f); l.transfer('mint:signup', 'bank:a', 100, 'chips', 'sign', 's1');
  New.SOURCE_ACCOUNTS.add('house:newgame');
  try {
    l.transfer('bank:a', 'house:newgame', 60, 'chips', 'newgame:spend', 'g1'); l.transfer('house:newgame', 'bank:a', 500, 'chips', 'newgame:win', 'g2');
    ok(l.checkpoint().ok); l.close();
  } finally { New.SOURCE_ACCOUNTS.delete('house:newgame'); }
  const r = OPEN(f); eq(r.stats().ckpt.used, false); eq(ignored(r).length, 1); ok(/rules changed/.test(ignored(r)[0]), ignored(r)[0]);
  eq(snap(r), fullOf(f)); r.close();
});
t('E11 the other way: written without the add, read with it: refused too; unchanged: believed', () => {
  const f = file(); let l = OPEN(f); l.transfer('mint:signup', 'bank:a', 100, 'chips', 'sign', 's1'); l.checkpoint(); l.close();
  let r = OPEN(f); eq(r.stats().ckpt.used, true); r.close();
  New.SOURCE_ACCOUNTS.add('house:newgame');
  try { r = OPEN(f); eq(r.stats().ckpt.used, false); ok(/rules changed/.test(ignored(r)[0] || '')); eq(snap(r), fullOf(f)); r.close(); } finally { New.SOURCE_ACCOUNTS.delete('house:newgame'); }
  ok(New.SOURCE_ACCOUNTS instanceof Set && New.SOURCE_ACCOUNTS.has('house:coldcall'));
});

// ---- E12: window 1 is raised to 2 ----
t('E12 window 1: 2000 appends do 0 cold scans, one log line says the window was raised; window 0 is still "off"', () => {
  const l = OPEN(file(), { window: 1 }); ok(l.logs.some(m => /window 1 raised to 2/.test(m)), JSON.stringify(l.logs)); eq(l.stats().window, 2);
  const s = createService(l, { now });
  for (let i = 0; i < 300; i++) l.transfer('mint:bonus', 'bank:p' + (i % 7), 1, 'chips', 'bonus', 'x' + i);
  const c0 = l.stats().coldScans;
  for (let i = 0; i < 2000; i++) l.transfer('mint:bonus', 'bank:p' + (i % 7), 1, 'chips', 'bonus', 'y' + i);
  eq(l.stats().coldScans - c0, 0); ok(l.stats().inMemory <= 4); s.buyInCount('T', 'a', 0); l.close();
  const z = OPEN(file(), { window: 0 }); eq(z.stats().window, 0); ok(!z.logs.some(m => /raised/.test(m))); for (let i = 0; i < 30; i++) z.transfer('mint:bonus', 'bank:p', 1, 'chips', 'bonus', 'z' + i);
  eq(z.stats().inMemory, 30); z.close();
});

// ---- E13: the sidecar shape (N1, N2, N13) ----
const lines = (f) => fs.readFileSync(f + '.ckpt', 'utf8').split('\n').filter(Boolean);
const writeCk = (f, ls) => fs.writeFileSync(f + '.ckpt', ls.join('\n') + '\n');
function mkCk(accounts = 20) {
  const f = file(), l = OPEN(f); for (let i = 0; i < accounts; i++) l.transfer('mint:signup', 'bank:p' + i, 1 + (i % 9), 'chips', 'sign', 's' + i);
  l.transfer('bank:p0', 'bank:p1', 1, 'chips', 'x', 'x1'); eq(l.checkpoint().ok, true); l.close(); return f;
}
const refused = (f, re, why) => { const r = OPEN(f); eq(r.stats().ckpt.used, false, why); eq(ignored(r).length, 1, why); ok(re.test(ignored(r)[0]), why + ': ' + ignored(r)[0]); eq(snap(r), fullOf(f), why); r.close(); };
t('E13 N1: a sidecar line after its end line is refused', () => {
  const f = mkCk(); let r = OPEN(f); eq(r.stats().ckpt.used, true, 'the untouched sidecar is believed'); r.close();
  const ls = lines(f); eq(JSON.parse(ls[ls.length - 1])[0], 'end'); writeCk(f, [...ls, '["r",[]]']); refused(f, /wrong shape/, 'a line after the end line');
});
t('E13 N2: header counts are checked (balances of each currency, quarantined)', () => {
  for (const key of ['nbc', 'nbp', 'nq']) {
    const f = mkCk(); const ls = lines(f), h = JSON.parse(ls[0]); h[key] += 1; writeCk(f, [JSON.stringify(h), ...ls.slice(1)]); refused(f, /wrong shape \(counts\)/, key);
  }
});
t('E13 N13: over 5,000 accounts the balances take two blocks: the sidecar is believed whole, and refused when the full block is missing', () => {
  const f = mkCk(5001); const ls = lines(f);
  const bc = ls.map((x, i) => [x, i]).filter(([x]) => x.startsWith('["bc"'));
  eq(bc.length, 2, 'two balance blocks'); eq(JSON.parse(bc[0][0])[1].length, 10000, 'the first block is full (5000 pairs)');
  let r = OPEN(f); eq(r.stats().ckpt.used, true, 'whole'); eq(snap(r), fullOf(f)); r.close();
  writeCk(f, ls.filter((x, i) => i !== bc[0][1])); refused(f, /wrong shape \(counts\)/, 'the full block missing');
});

fs.rmSync(root, { recursive: true, force: true });
run.done();
