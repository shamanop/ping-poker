'use strict';
// D2 fix round 1 (critic findings E1-E6): rules fingerprint, cold reads that throw, atomic memos, no cold scan in normal play,
// non-ASCII / CRLF / chunk-border data, a checkpoint right after a failed append. Every open pins window, ckpt, ckptEvery, ckptVerify.
const L = require('./money-d2-lib');
const { New, Ref, eq, deq, ok, fs, path } = L;
const { createService } = require('../../money/service');
const { createMoneyPort } = require('../../tables/money-port');
const run = L.makeRunner('money-d2-fix1');
const t = run.t;
const root = L.mkdir('money-d2-fix1-');
let n = 0;
const now = () => 1000;
const file = () => path.join(root, 'f' + (++n) + '.jsonl');
const PIN = { now, fsync: 'none', window: 5, ckpt: true, ckptEvery: 0, ckptVerify: false };
const OPEN = (f, o = {}, mod = New) => { const log = L.logger(); const led = mod.open(f, { ...PIN, log, ...o }); led.logs = log.lines; return led; };
const REFOPEN = (f) => Ref.open(f, { now, fsync: 'none', log: () => {} });
const snap = (led) => JSON.stringify({ c: led.list('', 'chips'), p: led.list('', 'play'), k: led.check(), id: led.lastId, sz: led.size, q: led.quarantined, e: [...led.entries()] });
// the full replay of a journal by the frozen pre-D2 ledger, on a copy
const fullOf = (f) => { const g = file(); fs.copyFileSync(f, g); const r = REFOPEN(g); const s = snap(r); r.close(); return s; };
const throwsCode = (fn, code, m) => { try { fn(); } catch (e) { eq(e.code, code, (m || '') + ' code'); return; } throw new Error((m || '') + ': did not throw'); };

function mk40(o = {}) {
  const f = file(), l = OPEN(f, { window: 2, ...o });
  l.transfer('mint:signup', 'bank:a', 1000, 'chips', 'signup', 's');
  for (let i = 0; i < 40; i++) l.transfer('bank:a', 'seat:T:k' + i, 1, 'chips', 'buyin:chips', 'r' + i);
  return { l, f };
}
const lineStart = (f, k) => Buffer.byteLength(fs.readFileSync(f, 'utf8').split('\n').slice(0, k).join('\n')) + (k ? 1 : 0);

// ---- E3: a cold read that cannot give the line the index promises throws in all three readers ----
t('E3 a: the journal is cut short under the process: entries, findLast, entriesOf all throw journal_mismatch', () => {
  const { l, f } = mk40(); fs.truncateSync(f, fs.statSync(f).size >> 1);
  throwsCode(() => [...l.entries()], 'journal_mismatch', 'entries');
  throwsCode(() => l.findLast(e => e.to === 'seat:T:k3' && e.reason.startsWith('buyin:')), 'journal_mismatch', 'findLast');
  throwsCode(() => l.findLast(e => e.to === 'seat:T:nobody'), 'journal_mismatch', 'findLast without a hit');
  throwsCode(() => l.entriesOf('r3' + '0'), 'journal_mismatch', 'entriesOf');
  l.close();
});
for (const [name, repl] of [
  ['unparseable bytes', (len) => '#'.repeat(len)],
  ['another valid line (a ref the index does not know)', (len) => { const s = JSON.stringify({ id: 11, ts: 1000, from: 'bank:a', to: 'seat:T:zz', amount: 1, cur: 'chips', reason: 'buyin:chips', ref: 'zz' }); return s + ' '.repeat(Math.max(0, len - s.length)); }],
  ['the same ref and id at the right place but cut short', (len, ln) => ln.slice(0, len - 3) + '   '],
]) {
  t('E3 b: a cold line is overwritten in place (' + name + '): entries and findLast throw, a cold entriesOf of it throws', () => {
    const { l, f } = mk40();
    const lines = fs.readFileSync(f, 'utf8').split('\n'), len = Buffer.byteLength(lines[10]);
    const r = repl(len, lines[10]); eq(Buffer.byteLength(r), len, 'test data: same length');
    const fd = fs.openSync(f, 'r+'); fs.writeSync(fd, Buffer.from(r), 0, len, lineStart(f, 10)); fs.closeSync(fd);
    throwsCode(() => [...l.entries()], 'journal_mismatch', 'entries');
    throwsCode(() => l.findLast(e => e.to === 'seat:T:k9' && e.reason.startsWith('buyin:')), 'journal_mismatch', 'findLast over the line');
    throwsCode(() => l.findLast(e => e.to === 'seat:T:nobody'), 'journal_mismatch', 'findLast without a hit');
    throwsCode(() => l.entriesOf('r9'), 'journal_mismatch', 'entriesOf');
    l.close();
  });
}
t('E3: lines that were legitimately not applied (blank, quarantined) are still skipped by the cold readers', () => {
  const f = file(); let l = OPEN(f, { window: 2 });
  l.transfer('mint:signup', 'bank:a', 1000, 'chips', 'signup', 's'); l.close();
  fs.appendFileSync(f, '\n{"id":1,"bad":true}\nnot json\n   \r\n');
  l = OPEN(f, { window: 2 }); for (let i = 0; i < 20; i++) l.transfer('bank:a', 'seat:T:k' + i, 1, 'chips', 'buyin:chips', 'r' + i);
  eq(l.quarantined.length, 2); eq([...l.entries()].length, 21);
  eq(l.findLast(e => e.ref === 's').amount, 1000); eq(l.entriesOf('s').length, 1); l.close();
  const l2 = OPEN(f, { window: 2 }); eq(snap(l2), fullOf(f)); eq(l2.findLast(e => e.ref === 's').amount, 1000); l2.close();
});

// ---- E4: no kept sum or count is changed by a scan that did not finish ----
t('E4: a scan that throws half-way, then works: buyInCount, nightSummary, seatFund, lastHandNo equal the truth', () => {
  const f = file(), led = OPEN(f, { window: 3 }), ref = REFOPEN(file());
  let fail = false;
  const flaky = new Proxy(led, { get(tg, p) {
    if (p === 'entries' && fail) return function* (fn, a) { let i = 0; for (const e of tg.entries(fn, a)) { if (i++ >= 2) throw new Error('boom'); yield e; } };
    const v = tg[p]; return typeof v === 'function' ? v.bind(tg) : v;
  } });
  const svc = createService(flaky, { now });
  const port = createMoneyPort({ service: svc, ledger: flaky, bootId: 'bt', afterWrite: () => {}, onFence: () => {} });
  const both = (fn) => { fn(ref); fn(led); };
  both(l => l.transfer('mint:signup', 'bank:ann', 1e6, 'chips', 'sign', 'sg'));
  for (let i = 0; i < 6; i++) both(l => l.transfer('bank:ann', 'seat:T:ann', 5 + i, 'chips', 'buyin:chips', 'b' + i));
  eq(port.buyInCount({ id: 'T' }, 'ann', 0), 6);
  fail = true;
  for (let i = 6; i < 12; i++) both(l => l.transfer('bank:ann', 'seat:T:ann', 5 + i, 'chips', 'buyin:chips', 'b' + i));       // the index update fails (the ledger logs it and goes on)
  both(l => l.batch([{ from: 'bank:ann', to: 'bank:bob', amount: 1, cur: 'chips', reason: 'x' }], 'hand:T:9', 'hand'));
  for (const f2 of [() => port.buyInCount({ id: 'T' }, 'ann', 0), () => svc.nightSummary('T'), () => svc.seatFund('T', 'ann', 'chips'), () => port.lastHandNo('T')]) { try { f2(); } catch {} }
  fail = false;
  let nb = 0; for (const _ of ref.entries(e => e.to === 'seat:T:ann' && e.reason.startsWith('buyin:'))) nb++;
  eq(port.buyInCount({ id: 'T' }, 'ann', 0), nb, 'buyInCount after the failure');
  let bi = 0; for (const e of ref.entries(e => e.to === 'seat:T:ann')) bi += e.amount;
  eq(svc.nightSummary('T').perKey.ann.buyIn, bi, 'nightSummary buyIn after the failure');
  eq(port.lastHandNo('T'), 9); eq(svc.seatFund('T', 'ann', 'chips'), 'chips');
  led.close(); ref.close();
});

// ---- E2: a scripted hour of normal play at a permanent table does no cold scan after boot ----
t('E2: scripted hour (journal of 6 windows, permanent table nightFromId 0, new players, cash-outs of old seats, lobby summaries, a seat with no buy-in): coldScans stays 0', () => {
  const f = file(), W = 40;
  let led = OPEN(f, { window: W }), svc = createService(led, { now });
  for (let k = 0; k < 6; k++) led.transfer('mint:signup', 'bank:p' + k, 1e6, 'chips', 'sign', 'sg' + k);
  for (let i = 0; i < 6 * W; i++) { if (i % 9 === 0) led.transfer('bank:p' + (i % 6), 'seat:PERM:p' + (i % 6), 10, 'chips', 'buyin:chips', 'bi' + i); else led.transfer('mint:bonus', 'bank:p' + (i % 6), 1, 'chips', 'slot', 'sl' + i); }
  led.close();
  led = OPEN(f, { window: W }); svc = createService(led, { now });                          // boot: the one pass
  const port = createMoneyPort({ service: svc, ledger: led, bootId: 'bt', afterWrite: () => {}, onFence: () => {} });
  ok(led.stats().lines > 5 * W && led.stats().inMemory < led.stats().lines, 'journal bigger than the window');
  const c0 = led.stats().coldScans, l0 = led.stats().coldLookups;
  const T = { id: 'PERM', cur: 'chips' };
  for (let m = 0; m < 60; m++) {
    for (let j = 0; j < 90; j++) led.transfer('mint:bonus', 'bank:p' + (j % 6), 1, 'chips', 'slot', 'h' + m + 'x' + j);   // slot rounds in between (more than a window over the hour)
    const k = 'new' + m;                                                                      // a new player
    led.transfer('mint:signup', 'bank:' + k, 5000, 'chips', 'sign', 'ns' + k);
    eq(port.buyInCount(T, k, 0), 0, 'first buy-in check of a new player at a permanent table');
    svc.buyIn(k, 'PERM', 100, 'chips', 'chips', 'nb' + m);
    eq(port.buyInCount(T, k, 0), 1);
    svc.nightSummary('PERM'); svc.nightSummary('PERM', { fromId: 0 });
    const old = m % 2 ? 'p0' : 'p3';
    svc.cashOut(old, 'PERM', 3, 'chips', null, 'old' + m);                                     // p0 and p3 bought in before the window
    eq(svc.seatFund('PERM', old, 'chips'), 'chips');
    eq(svc.seatFund('PERM', 'ghost', 'play'), 'play', 'a seat with no buy-in line falls back to the table currency');
    eq(port.lastHandNo('PERM'), 0);
  }
  eq(led.stats().coldScans - c0, 0, 'cold scans after boot');
  ok(led.stats().coldLookups - l0 >= 0);
  // and the answers equal the frozen ledger's
  const g = file(); led.sync(); fs.copyFileSync(f, g); const r = REFOPEN(g);
  let want = 0; for (const e of r.entries(e => e.to === 'seat:PERM:p0' && e.reason.startsWith('buyin:'))) want++;
  eq(port.buyInCount(T, 'p0', 0), want); r.close(); led.close();
});

// ---- E1: a checkpoint is only believed by the code whose rules wrote it ----
function altLedger(dir) {
  const src = fs.readFileSync(path.join(__dirname, '../../money/ledger.js'), 'utf8').replace("'house:coldcall',", "'house:coldcall', 'house:newgame',");
  ok(src.includes("'house:newgame'"), 'test data: patched');
  const p = path.join(dir, 'alt-ledger.js'); fs.writeFileSync(p, src); return require(p);
}
const altDir = path.join(root, 'alt'); fs.mkdirSync(altDir);
const Alt = altLedger(altDir);
const newgame = (l, ref) => l.transfer('house:newgame', 'bank:a', 300, 'chips', 'win', ref);
t('E1 rollback after a clean shutdown: the new rules wrote the sidecar, the shipped code replays everything (== frozen pre-D2), check() does not throw', () => {
  const f = file(); let l = OPEN(f, {}, Alt);
  l.transfer('mint:signup', 'bank:a', 100, 'chips', 'sign', 's1'); newgame(l, 'g1'); eq(l.balance('bank:a', 'chips'), 400);
  l.checkpoint(); l.close();
  const r = OPEN(f, {}); ok(r.logs.some(m => /^checkpoint ignored: rules changed/.test(m)), JSON.stringify(r.logs)); eq(r.stats().ckpt.used, false);
  eq(snap(r), fullOf(f)); eq(r.balance('bank:a', 'chips'), 100); r.check(); r.close();
});
t('E1 crash, then rollback: the boot checkpoint covers the stake, the win is in the tail: full replay, not 40', () => {
  const f = file(); let l = OPEN(f, {}, Alt);
  l.transfer('mint:signup', 'bank:a', 100, 'chips', 'sign', 's1'); l.transfer('bank:a', 'escrow:g:a:r1', 60, 'chips', 'stake', 'st'); l.checkpoint();
  l.transfer('house:newgame', 'escrow:g:a:r1', 5, 'chips', 'x', 'x1'); l.transfer('escrow:g:a:r1', 'bank:a', 65, 'chips', 'win', 'wn');   // crash: no close
  const r = OPEN(f, {}); ok(r.logs.some(m => /rules changed/.test(m))); eq(snap(r), fullOf(f)); r.close();
});
t('E1 forward: the shipped code wrote the sidecar (a line quarantined), the new rules replay and apply it', () => {
  const f = file(); let l = OPEN(f, {});
  l.transfer('mint:signup', 'bank:a', 100, 'chips', 'sign', 's1'); l.close();
  fs.appendFileSync(f, JSON.stringify({ id: 2, ts: 1000, from: 'house:newgame', to: 'bank:a', amount: 500, cur: 'chips', reason: 'win', ref: 'g1' }) + '\n');
  l = OPEN(f, {}); eq(l.quarantined.length, 1); eq(l.balance('bank:a', 'chips'), 100); l.checkpoint(); l.close();
  const a = OPEN(f, {}, Alt); ok(a.logs.some(m => /rules changed/.test(m))); eq(a.balance('bank:a', 'chips'), 600); eq(a.quarantined.length, 0);
  const full = OPEN(f, { ckpt: false }, Alt); eq(snap(a), snap(full)); full.close(); a.close();
});
t('E1: the fingerprint is the sha256 of ledger.js: any edit of the file gives a different one', () => {
  const f = file(); const l = OPEN(f, {}); l.transfer('mint:signup', 'bank:a', 1, 'chips', 's', 's'); l.checkpoint(); l.close();
  const h = JSON.parse(fs.readFileSync(f + '.ckpt', 'utf8').split('\n')[0]);
  const sha = require('crypto').createHash('sha256').update(fs.readFileSync(path.join(__dirname, '../../money/ledger.js'))).digest('hex');
  ok(/^\d+:[0-9a-f]{64}$/.test(h.rules)); eq(h.rules.split(':')[1], sha); eq(h.v, 2);
  const a = OPEN(f, {}, Alt); ok(a.logs.some(m => /rules changed/.test(m))); a.close();
});

// ---- E6: non-ASCII, CRLF, a multi-byte character across the 1 MB chunk border, a checkpoint after a failed append ----
const REC = (id, ref, extra = {}) => JSON.stringify({ id, ts: 1000, from: 'mint:signup', to: 'bank:a', amount: 1, cur: 'chips', reason: 'r', ref, ...extra });
function compareAll(f, o, why) {
  const want = fullOf(f); const l = OPEN(f, o);
  eq(snap(l), want, why + ': snapshot');
  const g = file(); fs.copyFileSync(f, g); const r = REFOPEN(g);
  for (const ref of ['é1', '日本-2', 'last', 's0', 'emoji-straddle']) {
    deq(l.entriesOf(ref), [...r.entries(e => e.ref === ref)], why + ' entriesOf ' + ref);
    let w = null; for (const e of r.entries(e => e.ref === ref)) w = e; deq(l.findLast(e => e.ref === ref), w, why + ' findLast ' + ref);
  }
  for (const a of [0, 3, 50]) deq([...l.entries(null, a)], [...r.entries(null, a)], why + ' afterId ' + a);
  r.close(); return l;
}
t('E6: non-ASCII accounts (orphan:), reasons and refs, CRLF line ends, appended live and by hand, windows 1/3/0, reopen with and without the checkpoint', () => {
  for (const window of [0, 1, 3]) for (const ckpt of [true, false]) {
    const f = file(); let l = OPEN(f, { window, ckpt });
    l.transfer('mint:signup', 'orphan:Zoë 🂡', 50, 'play', 'signup', 'é1');
    l.transfer('mint:signup', 'bank:a', 9, 'chips', 'señal 日本', '日本-2');
    l.batch([{ from: 'bank:a', to: 'bank:b', amount: 2, cur: 'chips', reason: 'ünï' }], 'bé', 'hand');
    for (let i = 0; i < 6; i++) l.transfer('mint:bonus', 'bank:c', 1, 'chips', 'n' + i, 's' + i);
    l.checkpoint(); l.close();
    fs.appendFileSync(f, REC(11, 'crlf', { reason: 'ü' }) + '\r\n' + '\r\n' + REC(12, 'last', { reason: '日本語' }) + '\n');
    fs.appendFileSync(f, '{"id":13,"x":"é');                  // a torn tail cut inside a multi-byte character
    const l2 = compareAll(f, { window, ckpt }, `w${window} ckpt ${ckpt}`); l2.close();
    const l3 = compareAll(f, { window, ckpt }, `w${window} ckpt ${ckpt} again`); l3.close();
  }
});
t('E6: a 4-byte character straddling the 1 MB chunk border (and a 3-byte one) in the journal: every reader equals the frozen ledger', () => {
  for (const border of [(1 << 20) - 1, (1 << 20) - 2, (1 << 20) - 3, (1 << 20) + 1]) {
    const f = file(); const lines = []; let id = 1, size = 0;
    const push = (s) => { lines.push(s); size += Buffer.byteLength(s) + 1; };
    push(REC(id++, 'é1'));
    while (size < (1 << 20) - 400) push(REC(id++, 's' + id, { reason: 'filler ' + 'x'.repeat(60) }));
    // the emoji must start at byte `border - 0`: pad the reason so that the character begins exactly there
    const head = (pad) => REC(id, 'emoji-straddle', { reason: 'p'.repeat(pad) + '😀tail' });
    let pad = 0; for (; pad < 400; pad++) { const s = head(pad); const at = size + Buffer.byteLength(s.slice(0, s.indexOf('😀'))); if (at === border - 1) break; }
    ok(pad < 400, 'test data: placed');
    push(head(pad)); id++;
    push(REC(id++, 'last', { reason: '日本' }));
    fs.writeFileSync(f, lines.join('\n') + '\n');
    for (const window of [1, 3]) { const l = compareAll(f, { window, ckpt: true }, `border ${border} w${window}`); l.checkpoint(); l.close(); const l2 = compareAll(f, { window, ckpt: true }, `border ${border} w${window} ckpt`); ok(l2.stats().ckpt.used); l2.close(); }
  }
});
t('E6: a checkpoint right after a failed append: rawLines / bytes / hash are the journal\'s, a later quarantined line has the right lineNo', () => {
  const f = file(); const l = OPEN(f, { window: 2 });
  l.transfer('mint:signup', 'bank:a', 100, 'chips', 'sign', 's1'); l.transfer('bank:a', 'bank:b', 1, 'chips', 'x', 'x1');
  const real = fs.writeSync; let hit = false;
  fs.writeSync = function (fd, buf, ...rest) { if (!hit && Buffer.isBuffer(buf) && buf.length > 20) { hit = true; real.call(fs, fd, buf, 0, 7); const e = new Error('ENOSPC'); e.code = 'ENOSPC'; throw e; } return real.call(fs, fd, buf, ...rest); };
  try { throwsCode(() => l.transfer('bank:a', 'bank:b', 5, 'chips', 'x', 'x2'), 'write_failed', 'the failed append'); } finally { fs.writeSync = real; }
  ok(hit);
  const c = l.checkpoint(); ok(c.ok, JSON.stringify(c));
  l.transfer('bank:a', 'bank:b', 7, 'chips', 'x', 'x3'); l.close();
  fs.appendFileSync(f, 'garbage after\n');
  const l2 = compareAll(f, { window: 2, ckpt: true, ckptVerify: true }, 'after a failed append'); eq(l2.stats().ckpt.mismatch, false); l2.close();
  const l3 = OPEN(f, { window: 2 }); eq(l3.quarantined[0].lineNo, 4, 'lineNo of the garbage line (4th complete line)'); l3.close();
});

fs.rmSync(root, { recursive: true, force: true });
run.done();
