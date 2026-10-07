'use strict';
// D2 checkpoint attacks: every way a <file>.ckpt can be wrong must end in a state equal to a full replay (the frozen pre-D2
// ledger on a copy of the same journal), plus the normal paths (tail-only replay, rollback to pre-D2 code and forward again).
const L = require('./money-d2-lib');
const { New, Ref, eq, deq, ok, fs, path } = L;
const run = L.makeRunner('money-d2-ckpt');
const t = run.t;
const root = L.mkdir('money-d2-ckpt-');
let n = 0;
const now = () => 1000;
const mkDir = () => { const d = path.join(root, 'c' + (++n)); fs.mkdirSync(d); return d; };
const OPEN = (f, o = {}) => { const log = L.logger(); const led = New.open(f, { now, fsync: 'none', log, window: 5, ckptEvery: 0, ckptVerify: false, ...o }); led.logs = log.lines; return led; };

// n lines of mixed transfers and batches (and a few refused calls), refs `${tag}<i>`
function fill(led, from, to, tag = 'r') {
  for (let i = from; i < to; i++) {
    if (i === 0) { led.transfer('mint:signup', 'bank:a', 1e6, 'chips', 'sign', tag + 'seed'); led.transfer('mint:topup', 'play:a', 5000, 'play', 'top', tag + 'seedp'); }
    if (i % 3 === 0) led.batch([{ from: 'bank:a', to: 'seat:T:a', amount: 10 + i, cur: 'chips', reason: 'buyin:chips' }, { from: 'seat:T:a', to: 'bank:b', amount: 3, cur: 'chips', reason: 'cashout:chips' }], tag + i, 'hand');
    else if (i % 7 === 0) { try { led.transfer('bank:c', 'bank:a', 5, 'chips', 'x', tag + i); } catch {} }
    else led.transfer(i % 2 ? 'bank:a' : 'play:a', i % 2 ? 'bank:b' : 'play:b', 1 + (i % 9), i % 2 ? 'chips' : 'play', 'x', tag + i);
  }
}
const snap = (led) => JSON.stringify({ c: led.list('', 'chips'), p: led.list('', 'play'), k: led.check(), id: led.lastId, sz: led.size, q: led.quarantined, e: [...led.entries()] });
// the full replay of a journal, by the frozen pre-D2 code on a COPY (so nothing of the D2 open can leak in)
function full(file) {
  const d = mkDir(), f = path.join(d, 'full.jsonl');
  fs.copyFileSync(file, f);
  const led = Ref.open(f, { now, fsync: 'none', log: () => {} });
  const s = snap(led); led.close();
  return { snap: s, bytes: fs.readFileSync(f) };
}
const build = (nLines, o = {}) => {
  const d = mkDir(), f = path.join(d, 'j.jsonl');
  const led = OPEN(f, o); fill(led, 0, nLines);
  return { d, f, led };
};
const ckptOf = (f) => JSON.parse(fs.readFileSync(f + '.ckpt', 'utf8'));
const putCkpt = (f, o) => fs.writeFileSync(f + '.ckpt', typeof o === 'string' ? o : JSON.stringify(o));
// opens with the checkpoint in place, asserts the state equals the full replay, returns the ledger
function openEqual(f, o = {}, why = '') {
  const want = full(f);
  const led = OPEN(f, o);
  eq(snap(led), want.snap, 'state differs from the full replay ' + why);
  ok(fs.readFileSync(f).equals(want.bytes), 'journal differs from the one the full replay left ' + why);
  return led;
}
const ignored = (led) => led.logs.filter(l => /^checkpoint ignored:/.test(l));

t('a written checkpoint is used: only the tail is replayed, state equals the full replay', () => {
  const { f, led } = build(120);
  const c = led.checkpoint(); ok(c.ok && c.bytes === led.size && c.lastId === led.lastId && c.refs > 100 && typeof c.ms === 'number', JSON.stringify(c));
  const n0 = led.stats().lines; fill(led, 120, 170, 'q'); const tailN = led.stats().lines - n0; ok(tailN > 30); led.close();
  const l2 = openEqual(f);
  const st = l2.stats();
  ok(st.ckpt.used, 'not used'); eq(st.ckpt.tailLines, tailN, 'tail lines replayed');
  ok(l2.logs.some(l => new RegExp('^checkpoint id \\d+ at \\d+ bytes, ' + tailN + ' tail lines replayed, \\d+ ms$').test(l)), 'log line: ' + JSON.stringify(l2.logs));
  eq(ignored(l2).length, 0); l2.close();
});

t('checkpoint() never touches the journal and returns { ok, bytes, lastId, refs, ms }', () => {
  const { f, led } = build(40);
  const before = fs.readFileSync(f);
  const c = led.checkpoint();
  deq(Object.keys(c).sort(), ['bytes', 'lastId', 'refs', 'ms', 'ok'].sort());
  ok(fs.readFileSync(f).equals(before), 'journal changed');
  ok(fs.existsSync(f + '.ckpt') && !fs.existsSync(f + '.ckpt.tmp'));
  led.close();
});

t('window 0 and a window bigger than the journal: checkpoint boot equals the full replay', () => {
  for (const w of [0, 1000]) {
    const { f, led } = build(60, { window: w }); led.checkpoint(); fill(led, 60, 70, 'q'); led.close();
    const l2 = openEqual(f, { window: w }, 'window ' + w); ok(l2.stats().ckpt.used); l2.close();
  }
});

for (const [name, content] of [['garbage', 'garbage { not json'], ['empty', ''], ['JSON of the wrong shape ({})', '{}'], ['a JSON array', '[]'], ['null', 'null'], ['only v', '{"v":1}']]) {
  t('checkpoint file is ' + name + ': ignored, full replay, moved to .ckpt.bad', () => {
    const { f, led } = build(50); led.checkpoint(); led.close();
    putCkpt(f, content);
    const l2 = openEqual(f);
    eq(ignored(l2).length, 1, JSON.stringify(l2.logs)); eq(l2.stats().ckpt.used, false);
    ok(fs.existsSync(f + '.ckpt.bad') && !fs.existsSync(f + '.ckpt'));
    l2.close();
  });
}

t('v: 2 is ignored', () => {
  const { f, led } = build(50); led.checkpoint(); led.close();
  const c = ckptOf(f); c.v = 2; putCkpt(f, c);
  const l2 = openEqual(f); eq(ignored(l2).length, 1); ok(/version/.test(ignored(l2)[0])); l2.close();
});

t('.ckpt.tmp left behind without a .ckpt: nothing is read from it', () => {
  const { f, led } = build(50); led.checkpoint(); led.close();
  fs.renameSync(f + '.ckpt', f + '.ckpt.tmp');
  const l2 = openEqual(f); eq(l2.stats().ckpt.used, false); eq(ignored(l2).length, 0); l2.close();
});

t('bytes beyond the journal (journal restored from an older backup): ignored', () => {
  const { f, led } = build(40); const backup = fs.readFileSync(f);
  fill(led, 40, 90, 'q'); led.checkpoint(); led.close();
  fs.writeFileSync(f, backup);
  const l2 = openEqual(f); eq(ignored(l2).length, 1); ok(/journal has/.test(ignored(l2)[0]), ignored(l2)[0]); l2.close();
});

t('one byte of the covered journal changed: ignored (sha256)', () => {
  const { f, led } = build(80); led.checkpoint(); fill(led, 80, 90, 'q'); led.close();
  const b = fs.readFileSync(f);
  const at = b.indexOf('"amount":', 2000) + 9;      // a digit inside a covered line
  b[at] = b[at] === 0x39 ? 0x38 : b[at] + 1;
  fs.writeFileSync(f, b);
  const l2 = openEqual(f); eq(ignored(l2).length, 1); ok(/sha256/.test(ignored(l2)[0]), ignored(l2)[0]); l2.close();
});

t('a covered line deleted: ignored', () => {
  const { f, led } = build(80); led.checkpoint(); fill(led, 80, 90, 'q'); led.close();
  const lines = fs.readFileSync(f, 'utf8').split('\n'); lines.splice(30, 1);
  fs.writeFileSync(f, lines.join('\n'));
  const l2 = openEqual(f); eq(ignored(l2).length, 1); l2.close();
});

t('the checkpoint of ANOTHER journal copied in: ignored', () => {
  const a = build(60), b = build(60);
  fill(b.led, 60, 75, 'z'); b.led.checkpoint(); b.led.close(); a.led.close();
  fs.copyFileSync(b.f + '.ckpt', a.f + '.ckpt');
  const l2 = openEqual(a.f); eq(ignored(l2).length, 1); l2.close();
});

t('a checkpoint many lines older than the journal: tail only, equal; a pre-D2 ledger grows the journal after it, D2 reads on', () => {
  const { f, led } = build(100); led.checkpoint(); led.close();
  // rollback to master code: it does not know the sidecar, opens, appends, closes
  const old = Ref.open(f, { now, fsync: 'none', log: () => {} });
  fill(old, 100, 160, 'o'); old.close();
  const l2 = openEqual(f);
  ok(l2.stats().ckpt.used); eq(ignored(l2).length, 0);
  ok(l2.stats().ckpt.tailLines >= 55, 'tail ' + l2.stats().ckpt.tailLines);
  // forward again: D2 appends, checkpoints, pre-D2 appends once more, D2 again
  fill(l2, 160, 200, 'p'); l2.checkpoint(); l2.close();
  const old2 = Ref.open(f, { now, fsync: 'none', log: () => {} }); fill(old2, 200, 230, 'o2'); old2.close();
  const l3 = openEqual(f); ok(l3.stats().ckpt.used); l3.close();
});

t('a quarantined line inside the covered part and one in the tail: lineNo and reasons equal a full replay', () => {
  const { f, led } = build(50); led.close();
  fs.appendFileSync(f, 'garbage line\n' + JSON.stringify({ id: 3, ts: 1, from: 'mint:signup', to: 'bank:a', amount: 1, cur: 'chips', reason: 'x', ref: 'dupid' }) + '\n');
  const l1 = OPEN(f); fill(l1, 50, 70, 'q'); eq(l1.quarantined.length, 2); l1.checkpoint(); fill(l1, 70, 75, 'w'); l1.close();
  fs.appendFileSync(f, 'tail garbage\n');
  const l2 = openEqual(f); ok(l2.stats().ckpt.used); eq(l2.quarantined.length, 3); l2.close();
});

t('a torn tail after the checkpoint is cut off as before and the checkpoint still serves', () => {
  const { f, led } = build(50); led.checkpoint(); fill(led, 50, 55, 'q'); led.close();
  fs.appendFileSync(f, '{"id":999,"ts":1,"fro');
  const l2 = openEqual(f); ok(l2.stats().ckpt.used); l2.close();
});

t('checkpoint() on a fenced-out ledger writes nothing (lost_lock, then foreign_write), nor does a closed one', () => {
  const a = build(20); const b = OPEN(a.f);          // b takes the lock
  const r = a.led.checkpoint(); eq(r.ok, false); eq(r.why, 'lost_lock'); ok(!fs.existsSync(a.f + '.ckpt'));
  b.close();
  const c = build(20); fs.appendFileSync(c.f, 'foreign write\n');
  const r2 = c.led.checkpoint(); eq(r2.ok, false); eq(r2.why, 'foreign_write'); ok(!fs.existsSync(c.f + '.ckpt'));
  const d = build(20); d.led.close(); const r3 = d.led.checkpoint(); eq(r3.ok, false); ok(!fs.existsSync(d.f + '.ckpt'));
});

t('ckpt off (option and LEDGER_CKPT=0): nothing written, nothing read', () => {
  const { f, led } = build(40); led.checkpoint(); led.close();
  const keep = fs.readFileSync(f + '.ckpt');
  const l2 = openEqual(f, { ckpt: false }); eq(l2.stats().ckpt.used, false); eq(l2.checkpoint().ok, false); fill(l2, 40, 50, 'q'); l2.close();
  ok(fs.readFileSync(f + '.ckpt').equals(keep), 'the checkpoint file was touched'); ok(!fs.existsSync(f + '.ckpt.bad'));
  process.env.LEDGER_CKPT = '0';
  try {
    const x = build(30); eq(x.led.checkpoint().ok, false); x.led.close(); ok(!fs.existsSync(x.f + '.ckpt'));
    const y = OPEN(f, { ckptEvery: 1 }); fill(y, 50, 60, 'e'); y.close(); ok(fs.readFileSync(f + '.ckpt').equals(keep));
  } finally { delete process.env.LEDGER_CKPT; }
});

t('ckptEvery: a checkpoint after every N appended lines, none by itself when 0', () => {
  const d = mkDir(), f = path.join(d, 'j.jsonl');
  const a = OPEN(f); fill(a, 0, 30); ok(!fs.existsSync(f + '.ckpt')); eq(a.stats().ckpt.written, 0); a.close();
  const b = OPEN(f, { ckptEvery: 4 }); const w0 = b.stats().ckpt.written; fill(b, 30, 50, 'q');
  ok(b.stats().ckpt.written - w0 >= 4, 'written ' + b.stats().ckpt.written); ok(fs.existsSync(f + '.ckpt'));
  const c = ckptOf(f); ok(c.bytes <= b.size && c.bytes > b.size - 4 * 400, 'ckpt bytes ' + c.bytes + ' size ' + b.size);
  b.close();
  openEqual(f).close();
});

t('a failing checkpoint write (tmp path is a directory) never throws and never harms the ledger', () => {
  const { f, led } = build(20); fs.mkdirSync(f + '.ckpt.tmp');
  const r = led.checkpoint(); eq(r.ok, false); ok(r.why);
  ok(led.logs.some(l => /^checkpoint failed/.test(l)));
  fill(led, 20, 30, 'q'); led.close(); fs.rmdirSync(f + '.ckpt.tmp');
  openEqual(f).close();
});

t('the older .ckpt.bad is overwritten by the next bad checkpoint', () => {
  const { f, led } = build(30); led.checkpoint(); led.close();
  fs.writeFileSync(f + '.ckpt.bad', 'OLD');
  putCkpt(f, 'new bad content');
  const l2 = openEqual(f); eq(fs.readFileSync(f + '.ckpt.bad', 'utf8'), 'new bad content'); l2.close();
});

t('a refs row pointing at the wrong place (covered window lines no longer match): ignored', () => {
  const { f, led } = build(60, { window: 10 }); led.checkpoint(); led.close();
  const c = ckptOf(f); const k = c.refs.length - 5 * 3; c.refs[k + 3] += 1; putCkpt(f, c);
  const l2 = openEqual(f, { window: 10 }); eq(ignored(l2).length, 1, JSON.stringify(l2.logs)); l2.close();
});

t('hand-edited balance inside an otherwise valid checkpoint: ckptVerify -> CHECKPOINT MISMATCH and the full replay state', () => {
  const { f, led } = build(60); led.checkpoint(); led.close();
  const c = ckptOf(f); const i = c.bal.chips.indexOf('bank:a'); ok(i >= 0); c.bal.chips[i + 1] += 5; putCkpt(f, c);
  const l2 = openEqual(f, { ckptVerify: true });
  ok(l2.logs.some(l => l.startsWith('CHECKPOINT MISMATCH')), JSON.stringify(l2.logs));
  eq(l2.stats().ckpt.mismatch, true); eq(l2.stats().ckpt.used, false); ok(fs.existsSync(f + '.ckpt.bad')); l2.close();
});

t('hand-edited ref sig / lastId inside a valid checkpoint with ckptVerify: mismatch or ignored, never believed', () => {
  const { f, led } = build(60); led.checkpoint(); led.close();
  const c = ckptOf(f); c.refs[2] = 'a'.repeat(32); putCkpt(f, c);
  const l2 = openEqual(f, { ckptVerify: true }); ok(l2.logs.some(l => l.startsWith('CHECKPOINT MISMATCH')), JSON.stringify(l2.logs)); l2.close();
  const { f: g, led: lg } = build(60); lg.checkpoint(); lg.close();
  const c2 = ckptOf(g); c2.lastId += 1; putCkpt(g, c2);
  const l3 = openEqual(g, { ckptVerify: true }); ok(ignored(l3).length === 1 || l3.logs.some(l => l.startsWith('CHECKPOINT MISMATCH'))); l3.close();
});

t('RESIDUAL RISK (documented): the same hand edit WITHOUT ckptVerify is believed (sha256 still matches the journal)', () => {
  const { f, led } = build(60); led.checkpoint(); led.close();
  const c = ckptOf(f); const i = c.bal.chips.indexOf('bank:a'); c.bal.chips[i + 1] += 5; putCkpt(f, c);
  const want = full(f);
  const l2 = OPEN(f);
  ok(l2.stats().ckpt.used, 'used'); ok(snap(l2) !== want.snap, 'the edited balance is believed');
  eq(l2.balance('bank:a', 'chips'), JSON.parse(want.snap).c.find(x => x.account === 'bank:a').balance + 5);
  l2.close();
});

t('ckptVerify on a good checkpoint: no mismatch, checkpoint used', () => {
  const { f, led } = build(80); led.checkpoint(); fill(led, 80, 95, 'q'); led.close();
  const l2 = openEqual(f, { ckptVerify: true }); eq(l2.stats().ckpt.mismatch, false); ok(l2.stats().ckpt.used); l2.close();
});

fs.rmSync(root, { recursive: true, force: true });
run.done();
