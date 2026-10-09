'use strict';
// Ledger tests. Plain node: exit 0 on pass, 1 on fail.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { open, MoneyError } = require('../../money/ledger');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); }
}
const deq = (a, b, m) => eq(JSON.stringify(a), JSON.stringify(b), m || 'deep');
const eq = (a, b, m) => { if (a !== b) throw new Error((m || 'eq') + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); };
const ok = (c, m) => { if (!c) throw new Error(m || 'not ok'); };
function throwsCode(fn, code) {
  try { fn(); } catch (e) { if (e instanceof MoneyError && e.code === code) return e; throw new Error('wanted ' + code + ', got ' + (e && e.code || e)); }
  throw new Error('did not throw ' + code);
}

const dir = fs.mkdtempSync(path.join(process.env.MONEY_TMP || os.tmpdir(), 'money-ledger-'));
let n = 0;
const fresh = () => path.join(dir, 'm' + (++n) + '.jsonl');
const quiet = () => {};
const mk = (f) => open(f || fresh(), { now: () => 1000, log: quiet });

t('amount must be a positive safe integer, at most MAX_AMOUNT (R2E-2)', () => {
  const l = mk();
  for (const bad of [0, -1, 1.5, NaN, Infinity, '5', null, undefined, 2 ** 53, 2 ** 53 - 1, 1e12 + 1, {}]) {
    throwsCode(() => l.transfer('mint:signup', 'bank:a', bad, 'chips', 'x', 'r-bad'), 'bad_amount');
  }
  l.transfer('mint:signup', 'bank:a', 1e12, 'chips', 'x', 'r-max');
  eq(l.balance('bank:a', 'chips'), 1e12);
  eq(l.lastId, 1, 'bad writes leave no line');
});

t('bad account, currency, reason, ref', () => {
  const l = mk();
  throwsCode(() => l.transfer('nope:x', 'bank:a', 1, 'chips', 'x', 'r1'), 'bad_account');
  throwsCode(() => l.transfer('mint:signup', 'bank:', 1, 'chips', 'x', 'r2'), 'bad_account');
  throwsCode(() => l.transfer('mint:signup', 'seat:t', 1, 'chips', 'x', 'r3'), 'bad_account');
  throwsCode(() => l.transfer('mint:signup', 'bank:a', 1, 'play', 'x', 'r4'), 'bad_account'); // bank is chips only
  throwsCode(() => l.transfer('mint:signup', 'play:a', 1, 'chips', 'x', 'r5'), 'bad_account'); // play is play only
  throwsCode(() => l.transfer('mint:signup', 'bank:a', 1, 'gold', 'x', 'r6'), 'bad_cur');
  throwsCode(() => l.transfer('mint:signup', 'bank:a', 1, 'chips', '', 'r7'), 'bad_reason');
  throwsCode(() => l.transfer('mint:signup', 'bank:a', 1, 'chips', 'x', ''), 'bad_ref');
  throwsCode(() => l.transfer('mint:signup', 'bank:a', 1, 'chips', 'x'), 'bad_ref');
  throwsCode(() => l.transfer('bank:a', 'bank:a', 1, 'chips', 'x', 'r8'), 'bad_account');
  eq(l.lastId, 0);
});

t('player accounts never below zero, details reported', () => {
  const l = mk();
  l.transfer('mint:signup', 'bank:a', 100, 'chips', 'signup', 's1');
  const e = throwsCode(() => l.transfer('bank:a', 'seat:T:a', 101, 'chips', 'buyin', 'b1'), 'insufficient');
  eq(e.details.account, 'bank:a'); eq(e.details.have, 100); eq(e.details.need, 101);
  eq(l.balance('bank:a', 'chips'), 100, 'no clamp, nothing moved');
  l.transfer('bank:a', 'seat:T:a', 100, 'chips', 'buyin', 'b2');
  eq(l.balance('bank:a', 'chips'), 0);
  for (const acct of ['bank:z', 'seat:T:z', 'pot:T:1', 'orphan:Some Name']) {
    throwsCode(() => l.transfer(acct, 'bank:a', 1, 'chips', 'x', 'neg-' + acct), 'insufficient');
  }
  throwsCode(() => l.transfer('play:z', 'fx:play', 1, 'play', 'x', 'neg-play'), 'insufficient');
});

t('source accounts may go negative and the books balance', () => {
  const l = mk();
  for (const s of ['mint:signup', 'mint:bonus', 'mint:achv', 'mint:topup', 'mint:migration', 'house:bender', 'house:coldcall', 'admin:adjust', 'fx:chips']) {
    l.transfer(s, 'bank:a', 10, 'chips', 'x', 'src-' + s);
    eq(l.balance(s, 'chips'), -10, s);
  }
  l.transfer('mint:signup', 'play:a', 7, 'play', 'x', 'p1');
  const c = l.check();
  ok(c.chips.ok && c.play.ok, 'check ok');
  eq(c.chips.players, 90); eq(c.chips.sources, -90); eq(c.play.players, 7);
});

t('idempotent by ref, conflict on different content', () => {
  const l = mk();
  const a = l.transfer('mint:signup', 'bank:a', 50, 'chips', 'signup', 'ref1');
  eq(a.dup, false);
  const b = l.transfer('mint:signup', 'bank:a', 50, 'chips', 'signup', 'ref1');
  eq(b.dup, true); eq(b.id, a.id);
  eq(l.balance('bank:a', 'chips'), 50, 'dup is a no-op');
  eq(l.lastId, 1);
  throwsCode(() => l.transfer('mint:signup', 'bank:a', 51, 'chips', 'signup', 'ref1'), 'ref_conflict');
  throwsCode(() => l.transfer('mint:signup', 'bank:b', 50, 'chips', 'signup', 'ref1'), 'ref_conflict');
  throwsCode(() => l.transfer('mint:signup', 'bank:a', 50, 'chips', 'other reason', 'ref1'), 'ref_conflict');
  ok(l.has('ref1')); ok(!l.has('nope'));
  // a dup stays a dup after reopen, a conflict stays a conflict
  const f = l.file; l.close();
  const l2 = mk(f);
  eq(l2.transfer('mint:signup', 'bank:a', 50, 'chips', 'signup', 'ref1').dup, true);
  throwsCode(() => l2.transfer('mint:signup', 'bank:a', 52, 'chips', 'signup', 'ref1'), 'ref_conflict');
});

t('batch: one line, all or nothing, ordered projection, ref idempotency', () => {
  const f = fresh(); const l = mk(f);
  l.transfer('mint:signup', 'bank:a', 100, 'chips', 'signup', 's1');
  l.transfer('mint:signup', 'bank:b', 100, 'chips', 'signup', 's2');
  const items = [
    { from: 'bank:a', to: 'seat:T:a', amount: 60, cur: 'chips' },
    { from: 'bank:b', to: 'seat:T:b', amount: 40, cur: 'chips' },
  ];
  const r = l.batch(items, 'bi1', 'buyin');
  eq(r.dup, false);
  eq(fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length, 3, 'one line per write');
  eq(l.balance('seat:T:a', 'chips'), 60);
  eq(l.batch(items, 'bi1', 'buyin').dup, true);
  throwsCode(() => l.batch([{ ...items[0], amount: 61 }], 'bi1', 'buyin'), 'ref_conflict');
  // third item insufficient: nothing written, nothing changed
  const before = fs.readFileSync(f, 'utf8'); const id = l.lastId;
  throwsCode(() => l.batch([
    { from: 'bank:a', to: 'seat:T:a', amount: 10, cur: 'chips' },
    { from: 'bank:b', to: 'seat:T:b', amount: 10, cur: 'chips' },
    { from: 'bank:a', to: 'seat:T:a', amount: 31, cur: 'chips' },
  ], 'bi2', 'buyin'), 'insufficient');
  eq(fs.readFileSync(f, 'utf8'), before, 'file untouched'); eq(l.lastId, id);
  eq(l.balance('bank:a', 'chips'), 40); ok(!l.has('bi2'));
  // projected balances: pot funded earlier in the same batch can be spent later in it, but not the reverse
  l.batch([
    { from: 'seat:T:a', to: 'pot:T:1', amount: 60, cur: 'chips' },
    { from: 'seat:T:b', to: 'pot:T:1', amount: 40, cur: 'chips' },
    { from: 'pot:T:1', to: 'seat:T:a', amount: 100, cur: 'chips' },
  ], 'hand:T:1', 'hand');
  eq(l.balance('seat:T:a', 'chips'), 100); eq(l.balance('pot:T:1', 'chips'), 0);
  throwsCode(() => l.batch([
    { from: 'pot:T:2', to: 'seat:T:a', amount: 5, cur: 'chips' },
    { from: 'seat:T:a', to: 'pot:T:2', amount: 5, cur: 'chips' },
  ], 'hand:T:2', 'hand'), 'insufficient');
  throwsCode(() => l.batch([], 'empty', 'x'), 'empty_batch');
  throwsCode(() => l.batch([{ ...items[0], amount: 0 }], 'bad0', 'x'), 'bad_amount');
  // reopen: same balances, and the batch is still idempotent
  l.close();
  const l2 = mk(f);
  eq(l2.balance('seat:T:a', 'chips'), 100); eq(l2.batch(items, 'bi1', 'buyin').dup, true);
});

t('batch can mix currencies (fx funding)', () => {
  const l = mk();
  l.transfer('mint:signup', 'play:a', 500, 'play', 'signup', 's1');
  l.batch([
    { from: 'play:a', to: 'fx:play', amount: 300, cur: 'play' },
    { from: 'fx:chips', to: 'seat:T:a', amount: 300, cur: 'chips' },
  ], 'fx1', 'buyin');
  eq(l.balance('seat:T:a', 'chips'), 300); eq(l.balance('play:a', 'play'), 200);
  ok(l.check().chips.ok && l.check().play.ok);
});

t('list, entries, balance queries', () => {
  const l = mk();
  l.transfer('mint:signup', 'bank:b', 5, 'chips', 'signup', 's1');
  l.transfer('mint:signup', 'bank:a', 7, 'chips', 'signup', 's2');
  l.transfer('mint:signup', 'play:a', 9, 'play', 'signup', 's3');
  l.transfer('bank:a', 'seat:T:a', 7, 'chips', 'buyin', 'b1');
  eq(JSON.stringify(l.list('bank:', 'chips')), JSON.stringify([{ account: 'bank:b', balance: 5 }]), 'zero balances hidden');
  eq(l.list('seat:', 'chips').length, 1); eq(l.list('seat:', 'play').length, 0);
  eq(l.balance('bank:never', 'chips'), 0);
  l.batch([{ from: 'seat:T:a', to: 'pot:T:1', amount: 3, cur: 'chips' }, { from: 'pot:T:1', to: 'seat:T:a', amount: 3, cur: 'chips' }], 'hand:T:1', 'hand');
  const all = [...l.entries()];
  eq(all.length, 6, 'batch items expanded');
  eq(all[4].batchRef, 'hand:T:1'); eq(all[3].batchRef, null);
  eq([...l.entries(e => e.reason === 'hand')].length, 2);
  ok(typeof l.entries()[Symbol.iterator] === 'function');
});

function writeRaw(f, lines, tail) { fs.writeFileSync(f, lines.map(x => x + '\n').join('') + (tail || '')); }
const goodLines = () => {
  const f = fresh(); const l = mk(f);
  l.transfer('mint:signup', 'bank:a', 100, 'chips', 'signup', 's1');
  l.transfer('bank:a', 'seat:T:a', 40, 'chips', 'buyin', 'b1');
  l.close();
  return { f, lines: fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) };
};

t('crash safety: torn last line is dropped and the file truncated', () => {
  for (const cut of [1, 10, 30, 'all-but-newline']) {
    const { f, lines } = goodLines();
    const last = lines[1];
    const torn = cut === 'all-but-newline' ? last : last.slice(0, cut);
    fs.writeFileSync(f, lines[0] + '\n' + torn);
    const l = mk(f);
    eq(l.balance('bank:a', 'chips'), 100, 'torn line not applied (cut=' + cut + ')');
    eq(l.lastId, 1);
    eq(fs.readFileSync(f, 'utf8'), lines[0] + '\n', 'truncated to the last good line');
    ok(!l.has('b1'), 'ref of the torn line is free');
    l.transfer('bank:a', 'seat:T:a', 40, 'chips', 'buyin', 'b1');   // retry works and gets id 2
    eq(l.lastId, 2); l.close();
    const l2 = mk(f); eq(l2.balance('seat:T:a', 'chips'), 40); eq(l2.lastId, 2);
    eq(fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length, 2);
  }
});

t('crash safety: half a batch line, garbage tail, tail of only a partial newline-less record', () => {
  const f = fresh(); const l = mk(f);
  l.transfer('mint:signup', 'bank:a', 100, 'chips', 'signup', 's1');
  l.batch([{ from: 'bank:a', to: 'seat:T:a', amount: 10, cur: 'chips' }, { from: 'bank:a', to: 'seat:T:b', amount: 10, cur: 'chips' }], 'bb', 'x');
  l.close();
  const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
  fs.writeFileSync(f, lines[0] + '\n' + lines[1].slice(0, lines[1].length >> 1));
  const l2 = mk(f);
  eq(l2.balance('bank:a', 'chips'), 100); eq(l2.balance('seat:T:a', 'chips'), 0); l2.close();
  fs.writeFileSync(f, lines[0] + '\n{"id":2,"ts":1,"fro');
  const l3 = mk(f); eq(l3.lastId, 1); l3.close();
  fs.writeFileSync(f, '{"id":1');
  const l4 = mk(f); eq(l4.lastId, 0); eq(fs.statSync(f).size, 0); l4.close();
});

// ---- quarantine: a bad line never stops a boot ----
const shaOf = (f) => require('crypto').createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const qrecs = (f) => { try { return fs.readFileSync(f + '.quarantine', 'utf8').split('\n').filter(Boolean).map(x => JSON.parse(x)); } catch { return []; } };
const openQ = (f, logs) => open(f, { now: () => 1000, log: logs ? (m) => logs.push(m) : quiet });

// Opens twice (the same lines are quarantined again on the second boot) and checks the common promises.
function quarantineCase(name, build, want) {
  t('quarantine: ' + name, () => {
    const { f, lines } = goodLines();
    build(f, lines);
    const fileBefore = shaOf(f);
    const logs = []; const l = openQ(f, logs);
    eq(l.quarantined.length, want.n, 'quarantined count'); eq(logs.length, 1, 'one loud log'); ok(/QUARANTINED/.test(logs[0]) && /admin look/.test(logs[0]));
    for (const q of l.quarantined) { ok(typeof q.line === 'string' && q.reason, 'line and reason reported'); }
    ok(want.reason.test(l.quarantined[0].reason), 'reason ' + l.quarantined[0].reason);
    eq(shaOf(f), fileBefore, 'the file is not rewritten on open');
    eq(l.balance('bank:a', 'chips'), want.bank, 'balances equal the valid lines only'); eq(l.balance('seat:T:a', 'chips'), want.seat);
    const ck = l.check(); ok(ck.chips.ok && ck.play.ok, 'books balance'); eq(ck.quarantined, want.n, 'check() reports the count apart from ok');
    eq(qrecs(f).length, want.n, 'quarantine file has each line once'); ok(qrecs(f).every(r => r.ts === 1000 && r.reason && typeof r.line === 'string'));
    // later writes work and are durable
    const w = l.transfer('mint:signup', 'bank:z', 5, 'chips', 'signup', 'after-quarantine'); eq(w.dup, false);
    l.batch([{ from: 'bank:z', to: 'seat:T:z', amount: 5, cur: 'chips' }], 'after-batch', 'x');
    l.close();
    const l2 = openQ(f);
    eq(l2.quarantined.length, want.n, 'same lines quarantined again on the next boot');
    eq(qrecs(f).length, want.n, 'quarantine file idempotent after a second open');
    eq(l2.balance('bank:a', 'chips'), want.bank); eq(l2.balance('seat:T:z', 'chips'), 5, 'writes after the bad line survived');
    ok(l2.has('after-quarantine') && l2.has('after-batch'));
    const l3 = (l2.close(), openQ(f)); eq(qrecs(f).length, want.n, 'and a third open');
    ok(l3.check().chips.ok);
  });
}
const L = (f, arr, tail) => fs.writeFileSync(f, arr.map(x => x + '\n').join('') + (tail || ''));
quarantineCase('garbage in the middle', (f, ls) => L(f, [ls[0], 'this is not json {{{', ls[1]]), { n: 1, bank: 60, seat: 40, reason: /unparseable/ });
quarantineCase('garbage at the end', (f, ls) => L(f, [ls[0], ls[1], '<<<garbage>>>']), { n: 1, bank: 60, seat: 40, reason: /unparseable/ });
quarantineCase('garbage at the start', (f, ls) => L(f, ['}{', ls[0], ls[1]]), { n: 1, bank: 60, seat: 40, reason: /unparseable/ });
quarantineCase('a duplicate id', (f, ls) => {
  const dup = JSON.parse(ls[1]); dup.ref = 'other-ref'; dup.amount = 1;     // same id 2, different ref
  L(f, [ls[0], ls[1], JSON.stringify(dup)]);
}, { n: 1, bank: 60, seat: 40, reason: /id 2 is not after 2/ });
quarantineCase('a replayed line (same id and ref)', (f, ls) => L(f, [ls[0], ls[1], ls[1]]), { n: 1, bank: 60, seat: 40, reason: /id 2 is not after 2/ });
quarantineCase('an id that goes backwards', (f, ls) => { const old = JSON.parse(ls[0]); old.ref = 'again'; L(f, [ls[0], ls[1], JSON.stringify(old)]); }, { n: 1, bank: 60, seat: 40, reason: /not after/ });
quarantineCase('a line that overdraws', (f, ls) => {
  const over = JSON.parse(ls[1]); over.amount = 999; over.ref = 'overdraw';
  L(f, [ls[0], JSON.stringify(over)]);
}, { n: 1, bank: 100, seat: 0, reason: /insufficient: bank:a has 100, needs 999/ });
quarantineCase('a batch whose later item overdraws', (f, ls) => {
  const b = { id: 2, ts: 1, ref: 'bad-batch', reason: 'x', batch: [
    { from: 'bank:a', to: 'seat:T:a', amount: 60, cur: 'chips', reason: 'x' }, { from: 'bank:a', to: 'seat:T:b', amount: 60, cur: 'chips', reason: 'x' }] };
  L(f, [ls[0], JSON.stringify(b)]);
}, { n: 1, bank: 100, seat: 0, reason: /insufficient/ });
quarantineCase('a wrong shape', (f, ls) => L(f, [ls[0], '[1,2,3]', ls[1]]), { n: 1, bank: 60, seat: 40, reason: /not a record/ });
quarantineCase('a negative amount', (f, ls) => { const bad = JSON.parse(ls[1]); bad.amount = -5; bad.id = 2; L(f, [ls[0], JSON.stringify(bad), ls[1]]); }, { n: 1, bank: 60, seat: 40, reason: /bad_amount/ });
quarantineCase('binary garbage (byte offsets stay right)', (f, ls) => {
  fs.writeFileSync(f, Buffer.concat([Buffer.from(ls[0] + '\n'), Buffer.from([0xff, 0xfe, 0x00, 0xc3, 0x28, 0x0a]), Buffer.from(ls[1] + '\n')]));
}, { n: 1, bank: 60, seat: 40, reason: /unparseable/ });

t('quarantine: several bad lines, a torn tail on top, blank lines ignored, clean file untouched', () => {
  const { f, lines } = goodLines();
  const bad2 = JSON.parse(lines[1]); bad2.amount = 5000; bad2.ref = 'ovr';
  fs.writeFileSync(f, [lines[0], '', 'junk-1', lines[1], JSON.stringify(bad2), 'junk-2'].join('\n') + '\n{"id":9,"ts":1,"fro');
  const l = openQ(f);
  eq(l.quarantined.length, 3, 'blank line not counted, torn tail dropped not quarantined');
  eq(l.balance('bank:a', 'chips'), 60); eq(fs.readFileSync(f, 'utf8').endsWith('junk-2\n'), true, 'torn tail truncated');
  eq(qrecs(f).length, 3); l.close(); openQ(f).close(); eq(qrecs(f).length, 3);
  // a clean file creates no quarantine file and reports none
  const g = goodLines(); const c = openQ(g.f);
  eq(c.quarantined.length, 0); eq(c.check().quarantined, 0); ok(!fs.existsSync(g.f + '.quarantine'));
});

t('quarantine: ids may have a gap (a lost line costs only what depends on it)', () => {
  const { f, lines } = goodLines();
  const gap = JSON.parse(lines[1]); gap.id = 7;
  L(f, [lines[0], JSON.stringify(gap)]);
  const l = openQ(f); eq(l.quarantined.length, 0); eq(l.lastId, 7); eq(l.balance('seat:T:a', 'chips'), 40);
  eq(l.transfer('mint:signup', 'bank:q', 1, 'chips', 'x', 'next').id, 8);
  eq([...l.entries(null, 7)].length, 1, 'entries(afterId) follows ids, not positions'); eq([...l.entries(null, 1)].length, 2); eq([...l.entries(null, 0)].length, 3);
});

t('quarantine: an unwritable quarantine file does not stop the boot', () => {
  const { f, lines } = goodLines(); L(f, [lines[0], 'junk', lines[1]]);
  fs.mkdirSync(f + '.quarantine');                    // a directory where the file should be: appendFileSync fails
  const logs = []; const l = openQ(f, logs);
  eq(l.quarantined.length, 1); eq(l.balance('bank:a', 'chips'), 60); ok(logs.some(m => /could not write/.test(m)));
});

t('reopen gives identical state and appends continue the id sequence', () => {
  const f = fresh(); const l = mk(f);
  l.transfer('mint:signup', 'bank:a', 10, 'chips', 'signup', 's1');
  l.close();
  const l2 = mk(f);
  eq(l2.transfer('bank:a', 'seat:T:a', 10, 'chips', 'buyin', 'b1').id, 2);
  l2.close();
  eq(mk(f).lastId, 2);
});

t('missing file is created on first write; empty file opens', () => {
  const f = fresh();
  const l = mk(f); eq(l.lastId, 0); ok(fs.existsSync(f)); l.close();
});

t('10,000 random transfers match a model; reopen is identical', () => {
  const f = fresh(); const l = open(f, { now: () => 5, fsync: 'none' });
  let seed = 12345;
  const rnd = (m) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % m; };
  const model = { chips: new Map(), play: new Map() };
  const mget = (c, a) => model[c].get(a) || 0;
  const people = ['a', 'b', 'c', 'd', 'e', 'f'];
  const accts = (cur) => {
    const base = cur === 'chips' ? ['bank:', 'seat:T1:', 'seat:T2:', 'orphan:'] : ['play:', 'seat:T3:', 'seat:T4:'];
    const out = [];
    for (const b of base) for (const p of people) out.push(b + p);
    out.push('pot:T1:1', 'pot:T3:1');
    return out;
  };
  const sources = { chips: ['mint:signup', 'mint:bonus', 'house:bender', 'admin:adjust', 'fx:chips'], play: ['mint:signup', 'mint:topup', 'house:coldcall', 'admin:adjust', 'fx:play'] };
  const isSrc = (a) => !/^(bank|play|seat|pot|orphan):/.test(a);
  let accepted = 0, rejected = 0, dups = 0;
  const seen = new Map();
  for (let i = 0; i < 10000; i++) {
    const cur = rnd(2) ? 'chips' : 'play';
    const pool = accts(cur);
    const pick = () => (rnd(5) === 0 ? sources[cur][rnd(sources[cur].length)] : pool[rnd(pool.length)]);
    let from = pick(), to = pick();
    if (from === to) continue;
    if ((from.startsWith('fx:') && from !== 'fx:' + cur) || (to.startsWith('fx:') && to !== 'fx:' + cur)) continue;
    if (/^bank:/.test(from + to) && cur !== 'chips') continue;
    if (/^play:/.test(from + to) && cur !== 'play') continue;
    const amount = isSrc(from) ? 1 + rnd(500) : 1 + rnd(120);
    const ref = rnd(20) === 0 && seen.size ? [...seen.keys()][rnd(seen.size)] : 'r' + i;
    const prev = seen.get(ref);
    let res = null, err = null;
    try { res = l.transfer(from, to, amount, cur, 'fuzz', ref); } catch (e) { err = e; }
    if (prev) {
      // reused ref: same content would be a dup, anything else a conflict; the model never changes
      ok(err ? err.code === 'ref_conflict' : res.dup, 'reused ref is conflict or dup');
      if (err) rejected++; else dups++;
      continue;
    }
    const expectOk = isSrc(from) || mget(cur, from) >= amount;
    if (expectOk) {
      ok(!err, 'should be accepted: ' + (err && err.code));
      model[cur].set(from, mget(cur, from) - amount); model[cur].set(to, mget(cur, to) + amount);
      seen.set(ref, true); accepted++;
    } else { ok(err && err.code === 'insufficient', 'should be insufficient'); rejected++; }
    if (i % 997 === 0) for (const c of ['chips', 'play']) for (const [a, v] of model[c]) eq(l.balance(a, c), v, 'live ' + a);
  }
  ok(accepted > 3000, 'enough accepted writes (' + accepted + ')');
  ok(rejected > 100, 'enough rejected writes (' + rejected + ')');
  for (const c of ['chips', 'play']) for (const [a, v] of model[c]) { eq(l.balance(a, c), v, 'final ' + a); if (!isSrc(a)) ok(v >= 0); }
  const ck = l.check(); ok(ck.chips.ok && ck.play.ok, 'books balance');
  const snap = (x) => JSON.stringify(['chips', 'play'].map(c => x.list('', c)));
  const s1 = snap(l), checkBefore = JSON.stringify(ck), last = l.lastId; l.close();
  const l2 = open(f, { now: () => 5 });
  eq(snap(l2), s1, 'reopen identical balances'); eq(l2.lastId, last); eq(JSON.stringify(l2.check()), checkBefore);
  eq(l2.transfer('mint:signup', 'bank:a', 1, 'chips', 'late', 'r-new').id, last + 1);
});

t('a rejected write does not consume its ref; closed ledger refuses writes', () => {
  const l = mk();
  throwsCode(() => l.transfer('bank:a', 'seat:T:a', 5, 'chips', 'buyin', 'same-ref'), 'insufficient');
  ok(!l.has('same-ref'));
  l.transfer('mint:signup', 'bank:a', 5, 'chips', 'signup', 's');
  eq(l.transfer('bank:a', 'seat:T:a', 5, 'chips', 'buyin', 'same-ref').dup, false, 'the retry after funding goes through');
  l.close();
  throwsCode(() => l.transfer('mint:signup', 'bank:a', 5, 'chips', 'signup', 'after-close'), 'closed');
});

t('fsync: default is every write; batch and none are options', () => {
  const real = fs.fsyncSync; let calls = 0;
  fs.fsyncSync = (fd) => { calls++; return real(fd); };
  try {
    const run = (opts) => {
      const l = open(fresh(), { log: quiet, ...opts }); calls = 0;
      l.transfer('mint:signup', 'bank:a', 5, 'chips', 'x', 'a'); const afterT = calls;
      l.batch([{ from: 'bank:a', to: 'seat:T:a', amount: 5, cur: 'chips' }], 'b', 'x');
      const out = [afterT, calls - afterT]; eq(l.balance('seat:T:a', 'chips'), 5); l.close(); return out;
    };
    deq(run({}), [1, 1], 'default: transfer and batch both fsynced');
    deq(run({ fsync: 'all' }), [1, 1]); deq(run({ fsync: 'batch' }), [0, 1]); deq(run({ fsync: 'none' }), [0, 0]);
  } finally { fs.fsyncSync = real; }
});

const lockOf = (f) => { try { return fs.readFileSync(f + '.lock', 'utf8').trim(); } catch { return null; } };
const nLines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).length;

t('fence: second opener wins, the first gets lost_lock and its file stays untouched', () => {
  const f = fresh(); const a = mk(f);
  a.transfer('mint:signup', 'bank:a', 10, 'chips', 'signup', 'a1');
  const logs = []; const b = open(f, { now: () => 1, log: (m) => logs.push(m) });
  eq(logs.length, 1, 'replacing a lock is logged'); ok(/replaced a lock/.test(logs[0]));
  eq(b.balance('bank:a', 'chips'), 10);
  b.transfer('mint:signup', 'bank:b', 20, 'chips', 'signup', 'b1');
  throwsCode(() => a.transfer('mint:signup', 'bank:a', 5, 'chips', 'signup', 'a2'), 'lost_lock');
  throwsCode(() => a.batch([{ from: 'mint:signup', to: 'bank:a', amount: 5, cur: 'chips' }], 'a3', 'x'), 'lost_lock');
  eq(nLines(f), 2, 'only a1 and b1 on disk'); ok(!a.has('a2'), 'refused write left memory alone'); eq(a.balance('bank:a', 'chips'), 10);
  // sticky: even if the lock were handed back, the fenced writer stays refused
  fs.writeFileSync(f + '.lock', 'garbage'); b.close();
  throwsCode(() => a.transfer('mint:signup', 'bank:a', 5, 'chips', 'signup', 'a4'), 'lost_lock');
  // a duplicate is not a write, a read is fine
  eq(a.transfer('mint:signup', 'bank:a', 10, 'chips', 'signup', 'a1').dup, true);
  a.close();
  const c = mk(f); eq(c.lastId, 2); eq(c.balance('bank:b', 'chips'), 20); eq(c.balance('bank:a', 'chips'), 10);
  const ck = c.check(); ok(ck.chips.ok && ck.play.ok);
  c.transfer('mint:signup', 'bank:c', 1, 'chips', 'signup', 'c1'); eq(c.lastId, 3);
});

t('fence: the lock file belongs to the newest opener; close removes only its own', () => {
  const f = fresh(); const a = mk(f); const ta = lockOf(f); ok(ta && ta.length >= 16);
  const b = mk(f); const tb = lockOf(f); ok(tb !== ta, 'new token');
  a.close(); eq(lockOf(f), tb, 'a closing does not remove b\'s lock');
  b.close(); eq(lockOf(f), null, 'b removes its own lock');
  const c = mk(f); ok(lockOf(f)); c.close();
});

t('fence: a stale lock never blocks a boot (and a missing lock fences the writer)', () => {
  const f = fresh(); fs.writeFileSync(f + '.lock', 'left-by-a-crashed-process\n');
  const logs = []; const l = open(f, { log: (m) => logs.push(m) });
  eq(logs.length, 1); l.transfer('mint:signup', 'bank:a', 1, 'chips', 'x', 'r1');
  fs.unlinkSync(f + '.lock');
  throwsCode(() => l.transfer('mint:signup', 'bank:a', 1, 'chips', 'x', 'r2'), 'lost_lock');
  eq(nLines(f), 1); l.close();
  const l2 = mk(f); eq(l2.balance('bank:a', 'chips'), 1);
});

t('fence: a foreign append makes the next write throw foreign_write, then it stays refused', () => {
  for (const foreign of ['torn', 'valid-line', 'garbage-line']) {
    const f = fresh(); const a = mk(f);
    a.transfer('mint:signup', 'bank:a', 10, 'chips', 'signup', 'a1');
    const size = fs.statSync(f).size;
    if (foreign === 'torn') fs.appendFileSync(f, '{"id":2,"ts":1,"fro');
    else if (foreign === 'valid-line') fs.appendFileSync(f, JSON.stringify({ id: 2, ts: 1, from: 'mint:signup', to: 'bank:z', amount: 7, cur: 'chips', reason: 'x', ref: 'foreign' }) + '\n');
    else fs.appendFileSync(f, 'not json at all\n');
    const before = fs.statSync(f).size;
    const e = throwsCode(() => a.transfer('mint:signup', 'bank:a', 5, 'chips', 'signup', 'a2'), 'foreign_write');
    eq(e.details.expected, size); eq(e.details.have, before);
    throwsCode(() => a.transfer('mint:signup', 'bank:a', 5, 'chips', 'signup', 'a3'), 'foreign_write');
    eq(fs.statSync(f).size, before, 'the fenced writer wrote nothing');
    a.close();
    const b = mk(f); if (foreign === 'garbage-line') eq(b.quarantined.length, 1, 'garbage is quarantined, not fatal'); const ck = b.check(); ok(ck.chips.ok && ck.play.ok, 'books ok after ' + foreign);
    eq(b.balance('bank:a', 'chips'), 10); eq(b.balance('bank:z', 'chips'), foreign === 'valid-line' ? 7 : 0);
    b.transfer('mint:signup', 'bank:a', 5, 'chips', 'signup', 'a2'); eq(b.balance('bank:a', 'chips'), 15); b.close();
  }
});

t('fence: a shrunk file is foreign too', () => {
  const f = fresh(); const a = mk(f);
  a.transfer('mint:signup', 'bank:a', 10, 'chips', 'signup', 'a1'); a.transfer('mint:signup', 'bank:a', 10, 'chips', 'signup', 'a2');
  fs.truncateSync(f, 20);
  throwsCode(() => a.transfer('mint:signup', 'bank:a', 5, 'chips', 'signup', 'a3'), 'foreign_write');
});

t('fence: a file with quarantined lines still opens and holds the lock', () => {
  const f = fresh(); fs.writeFileSync(f, 'junk\n{"id":1}\n');
  const l = mk(f); eq(l.quarantined.length, 2); ok(lockOf(f)); l.transfer('mint:signup', 'bank:a', 1, 'chips', 'x', 'r'); l.close(); eq(lockOf(f), null);
});

t('fsync option does not change behaviour', () => {
  for (const mode of ['all', 'none', 'batch']) {
    const l = open(fresh(), { fsync: mode, log: quiet });
    l.transfer('mint:signup', 'bank:a', 5, 'chips', 'x', 'a'); l.batch([{ from: 'bank:a', to: 'seat:T:a', amount: 5, cur: 'chips' }], 'b', 'x');
    eq(l.balance('seat:T:a', 'chips'), 5);
  }
});

try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
console.log(`money-ledger: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
