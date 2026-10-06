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
const eq = (a, b, m) => { if (a !== b) throw new Error((m || 'eq') + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); };
const ok = (c, m) => { if (!c) throw new Error(m || 'not ok'); };
function throwsCode(fn, code) {
  try { fn(); } catch (e) { if (e instanceof MoneyError && e.code === code) return e; throw new Error('wanted ' + code + ', got ' + (e && e.code || e)); }
  throw new Error('did not throw ' + code);
}

const dir = fs.mkdtempSync(path.join(process.env.MONEY_TMP || os.tmpdir(), 'money-ledger-'));
let n = 0;
const fresh = () => path.join(dir, 'm' + (++n) + '.jsonl');
const mk = (f) => open(f || fresh(), { now: () => 1000 });

t('amount must be a positive safe integer', () => {
  const l = mk();
  for (const bad of [0, -1, 1.5, NaN, Infinity, '5', null, undefined, 2 ** 53, {}]) {
    throwsCode(() => l.transfer('mint:signup', 'bank:a', bad, 'chips', 'x', 'r-bad'), 'bad_amount');
  }
  l.transfer('mint:signup', 'bank:a', 2 ** 53 - 1, 'chips', 'x', 'r-max');
  eq(l.balance('bank:a', 'chips'), 2 ** 53 - 1);
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

t('corruption before the end is an error, not a silent drop', () => {
  const { f, lines } = goodLines();
  writeRaw(f, ['{"id":1,"ts":1,"fro', lines[1]]);
  throwsCode(() => mk(f), 'corrupt');
  writeRaw(f, [lines[1]]);                         // id 2 first: out of sequence
  throwsCode(() => mk(f), 'corrupt');
  writeRaw(f, [lines[0], lines[0]]);               // replayed line: bad id
  throwsCode(() => mk(f), 'corrupt');
  const over = JSON.parse(lines[1]); over.amount = 999; over.id = 2;
  writeRaw(f, [lines[0], JSON.stringify(over)]);   // overdraws bank:a
  throwsCode(() => mk(f), 'corrupt');
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

t('fsync option does not change behaviour', () => {
  for (const mode of ['all', 'none', 'batch']) {
    const l = open(fresh(), { fsync: mode });
    l.transfer('mint:signup', 'bank:a', 5, 'chips', 'x', 'a'); l.batch([{ from: 'bank:a', to: 'seat:T:a', amount: 5, cur: 'chips' }], 'b', 'x');
    eq(l.balance('seat:T:a', 'chips'), 5);
  }
});

try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
console.log(`money-ledger: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
