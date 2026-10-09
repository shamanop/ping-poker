'use strict';
// Escrow and pool primitives (openRound / settleRound / voidRound / pool legs / sweepEscrows) against a real money.open() on a
// temp file. Plain node: exit 0 on pass, 1 on fail. The contract is ADD-A-GAME.md sections 2-3.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { open, MoneyError } = require('../../money/ledger');
const { createService, START_CHIPS, START_PLAY } = require('../../money/service');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'eq') + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); };
const ok = (c, m) => { if (!c) throw new Error(m || 'not ok'); };
function throwsCode(fn, code) {
  try { fn(); } catch (e) { if (e instanceof MoneyError && e.code === code) return e; throw new Error('wanted ' + code + ', got ' + (e && e.code || e) + ' ' + (e && e.message)); }
  throw new Error('did not throw ' + code);
}

const dir = fs.mkdtempSync(path.join(process.env.MONEY_TMP || os.tmpdir(), 'money-rounds-'));
let n = 0, clock = 1000000;
const quiet = () => {};
function env(file) {
  const f = file || path.join(dir, 'r' + (++n) + '.jsonl');
  const ledger = open(f, { now: () => clock, log: quiet });
  const svc = createService(ledger, { now: () => clock });
  return { f, ledger, svc };
}
function player(file, keys = ['ann']) { const e = env(file); for (const k of keys) e.svc.ensureAccount(k); return e; }
const booksOk = (ledger) => { const c = ledger.check(); ok(c.chips.ok && c.play.ok, 'books balance ' + JSON.stringify(c)); };
const lines = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const lineOf = (f, ref) => lines(f).find(l => l.ref === ref);
const legs = (rec) => rec.batch.map(i => `${i.from}>${i.to}:${i.amount}:${i.cur}:${i.reason}`);
// no new line was written since `id`
const still = (e, id) => eq(e.ledger.lastId, id, 'a line was written');

// seeds a pool with `n` units out of a player's stake (instant round: cost n, feed n), so the pool is fed only from stakes
function seedPool(e, name, n, cur = 'play', who = 'ann') {
  e.svc.houseRound('coldcall', who, n, 0, cur, `coldcall:${who}:seed-${name}-${cur}`, { name, feed: n });
}

t('escrow and pool names: well-formed accepted, malformed refused, neither may go negative', () => {
  const { ledger } = env();
  for (const cur of ['chips', 'play']) {
    ledger.transfer('mint:signup', 'escrow:coldcall:ann:r1', 50, cur, 'x', 'e-' + cur);
    ledger.transfer('mint:signup', 'pool:coldcall:office', 70, cur, 'x', 'p-' + cur);
    eq(ledger.balance('escrow:coldcall:ann:r1', cur), 50); eq(ledger.balance('pool:coldcall:office', cur), 70);
    throwsCode(() => ledger.transfer('escrow:coldcall:ann:r1', 'mint:signup', 51, cur, 'x', 'e2-' + cur), 'insufficient');
    throwsCode(() => ledger.transfer('pool:coldcall:office', 'mint:signup', 71, cur, 'x', 'p2-' + cur), 'insufficient');
  }
  for (const bad of ['escrow:coldcall:ann', 'escrow:coldcall:ann:r1:x', 'pool:coldcall:office:x', 'pool:coldcall', 'escrow:coldcall::r1', 'pool:coldcall:', 'escrow::ann:r1', 'pool::office']) {
    throwsCode(() => ledger.transfer('mint:signup', bad, 5, 'chips', 'x', 'bad-' + bad), 'bad_account');
  }
  booksOk(ledger);
});

t('openRound: the stake moves to the escrow, books balance, in both currencies', () => {
  for (const cur of ['chips', 'play']) {
    const { svc, ledger } = player();
    const start = cur === 'chips' ? START_CHIPS : START_PLAY, pre = cur === 'chips' ? 'bank:' : 'play:';
    const r = svc.openRound('coldcall', 'ann', cur, 'r1', 300);
    ok(r.id > 0 && !r.dup);
    eq(ledger.balance(pre + 'ann', cur), start - 300); eq(ledger.balance('escrow:coldcall:ann:r1', cur), 300);
    eq(svc.openRounds('coldcall'), [{ key: 'ann', cur, roundId: 'r1', amount: 300 }]);
    eq(svc.roundClosed('coldcall', 'ann', 'r1'), false);
    booksOk(ledger);
  }
});

t('openRound: no funds -> insufficient, nothing written; same call -> dup; other cost -> ref_conflict; cost 0 -> noop', () => {
  const { svc, ledger } = player();
  const id = ledger.lastId;
  const e = throwsCode(() => svc.openRound('coldcall', 'ann', 'play', 'r1', START_PLAY + 1), 'insufficient');
  eq(e.account, 'play:ann'); still({ ledger }, id);
  const a = svc.openRound('coldcall', 'ann', 'play', 'r1', 500), id2 = ledger.lastId;
  const b = svc.openRound('coldcall', 'ann', 'play', 'r1', 500);
  eq(b, { id: a.id, dup: true }); still({ ledger }, id2); eq(ledger.balance('escrow:coldcall:ann:r1', 'play'), 500);
  throwsCode(() => svc.openRound('coldcall', 'ann', 'play', 'r1', 501), 'ref_conflict'); still({ ledger }, id2);
  eq(svc.openRound('coldcall', 'ann', 'play', 'free', 0), { id: null, dup: false, noop: true }); still({ ledger }, id2);
});

t('names and amounts: bad game, key, roundId (with a colon), cur and cost are refused with nothing written', () => {
  const { svc, ledger } = player();
  const id = ledger.lastId;
  throwsCode(() => svc.openRound('nogame', 'ann', 'play', 'r1', 5), 'bad_game');
  throwsCode(() => svc.openRound('coldcall', 'a:b', 'play', 'r1', 5), 'bad_key');
  throwsCode(() => svc.openRound('coldcall', 'ann', 'play', 'r:1', 5), 'bad_round');
  throwsCode(() => svc.openRound('coldcall', 'ann', 'play', '', 5), 'bad_round');
  throwsCode(() => svc.openRound('coldcall', 'ann', 'gold', 'r1', 5), 'bad_cur');
  throwsCode(() => svc.openRound('coldcall', 'ann', 'play', 'r1', -5), 'bad_amount');
  throwsCode(() => svc.openRound('coldcall', 'ann', 'play', 'r1', 1.5), 'bad_amount');
  throwsCode(() => svc.settleRound('coldcall', 'ann', 'play', 'r:1', { win: 1 }), 'bad_round');
  throwsCode(() => svc.settleRound('coldcall', 'ann', 'play', 'r1', { win: 1, pool: { name: 'a:b', feed: 1 } }), 'bad_pool');
  throwsCode(() => svc.settleRound('coldcall', 'ann', 'play', 'r1', { win: 1, pool: { name: 'o', feed: -1 } }), 'bad_amount');
  throwsCode(() => svc.voidRound('coldcall', 'ann', 'play', 'r1', 'Bad Why'), 'bad_reason');
  throwsCode(() => svc.houseRound('coldcall', 'ann', 1, 0, 'play', 'x', { name: '', feed: 1 }), 'bad_pool');
  still({ ledger }, id);
});

for (const variant of ['clean reopen', 'reopen with a torn half line']) {
  t(`crash: ${variant} keeps the escrow, the same open is dup, settle pays once`, () => {
    const e1 = player();
    e1.svc.openRound('coldcall', 'ann', 'play', 'r1', 400);
    e1.svc.openRound('coldcall', 'ann', 'chips', 'c1', 90);
    // the first process is never closed: it just dies (its fd stays open, the newest opener wins the fence)
    if (variant !== 'clean reopen') fs.appendFileSync(e1.f, '{"id":999,"ts":1,"from":"play:ann","to":"esc');
    const e2 = env(e1.f);
    eq(e2.svc.openRounds('coldcall').map(r => `${r.key}/${r.cur}/${r.roundId}/${r.amount}`).sort(), ['ann/chips/c1/90', 'ann/play/r1/400']);
    eq(e2.ledger.balance('escrow:coldcall:ann:r1', 'play'), 400);
    const before = e2.ledger.lastId, play = e2.ledger.balance('play:ann', 'play');
    eq(e2.svc.openRound('coldcall', 'ann', 'play', 'r1', 400).dup, true);
    eq(e2.ledger.lastId, before); eq(e2.ledger.balance('play:ann', 'play'), play, 'a retried open took more money');
    const s = e2.svc.settleRound('coldcall', 'ann', 'play', 'r1', { win: 1000 });
    ok(!s.dup);
    eq(e2.ledger.balance('play:ann', 'play'), play + 1000); eq(e2.ledger.balance('escrow:coldcall:ann:r1', 'play'), 0);
    const after = e2.ledger.lastId;
    eq(e2.svc.settleRound('coldcall', 'ann', 'play', 'r1', { win: 1000 }).dup, true);
    eq(e2.ledger.lastId, after); eq(e2.ledger.balance('play:ann', 'play'), play + 1000, 'paid twice');
    booksOk(e2.ledger);
    // a third open after yet another restart still answers round_closed, never reopens
    const e3 = env(e1.f);
    throwsCode(() => e3.svc.openRound('coldcall', 'ann', 'play', 'r1', 400), 'round_closed');
    eq(e3.svc.openRounds('coldcall').map(r => r.roundId), ['c1']);
  });
}

t('settleRound: legs in the contract order, the whole escrow leaves, win and prize paid in the same batch', () => {
  const e = player(); const { svc, ledger, f } = e;
  seedPool(e, 'office', 500);
  svc.openRound('coldcall', 'ann', 'play', 'r1', 300);
  const start = ledger.balance('play:ann', 'play');
  const r = svc.settleRound('coldcall', 'ann', 'play', 'r1', { win: 40, pool: { name: 'office', feed: 25, prize: 200 } });
  ok(!r.dup && r.id > 0);
  const rec = lineOf(f, 'coldcall:ann:r1:close');
  eq(rec.reason, 'coldcall:settle');
  eq(legs(rec), [
    'escrow:coldcall:ann:r1>house:coldcall:300:play:coldcall:spend',
    'house:coldcall>pool:coldcall:office:25:play:coldcall:feed',
    'pool:coldcall:office>play:ann:200:play:coldcall:prize',
    'house:coldcall>play:ann:40:play:coldcall:credit',
  ]);
  eq(ledger.balance('escrow:coldcall:ann:r1', 'play'), 0);
  eq(ledger.balance('play:ann', 'play'), start + 240);
  eq(svc.poolBalance('coldcall', 'office', 'play'), 500 - 200 + 25);
  eq(svc.roundClosed('coldcall', 'ann', 'r1'), true); eq(svc.openRounds('coldcall'), []);
  booksOk(ledger);
});

t('settleRound: loss only (win 0), win only, feed only each write the right legs', () => {
  const e = player(); const { svc, ledger, f } = e;
  svc.openRound('coldcall', 'ann', 'chips', 'loss', 100);
  svc.settleRound('coldcall', 'ann', 'chips', 'loss', { win: 0 });
  eq(legs(lineOf(f, 'coldcall:ann:loss:close')), ['escrow:coldcall:ann:loss>house:coldcall:100:chips:coldcall:spend']);
  svc.openRound('coldcall', 'ann', 'chips', 'win', 100);
  svc.settleRound('coldcall', 'ann', 'chips', 'win', { win: 250 });
  eq(legs(lineOf(f, 'coldcall:ann:win:close')), ['escrow:coldcall:ann:win>house:coldcall:100:chips:coldcall:spend', 'house:coldcall>bank:ann:250:chips:coldcall:credit']);
  svc.openRound('coldcall', 'ann', 'chips', 'feed', 100);
  svc.settleRound('coldcall', 'ann', 'chips', 'feed', { win: 0, pool: { name: 'office', feed: 10 } });
  eq(legs(lineOf(f, 'coldcall:ann:feed:close')), ['escrow:coldcall:ann:feed>house:coldcall:100:chips:coldcall:spend', 'house:coldcall>pool:coldcall:office:10:chips:coldcall:feed']);
  eq(ledger.balance('house:coldcall', 'chips'), (100) + (100 - 250) + (100 - 10));
  eq(svc.poolBalance('coldcall', 'office', 'chips'), 10); eq(svc.poolBalance('coldcall', 'office', 'play'), 0);
  booksOk(ledger);
});

t('close once: the same settle again is dup (no line, balances unchanged); other numbers are round_closed (no line)', () => {
  const e = player(); const { svc, ledger } = e;
  seedPool(e, 'office', 300);
  svc.openRound('coldcall', 'ann', 'play', 'r1', 200);
  const pool = { name: 'office', feed: 20, prize: 100 };
  const first = svc.settleRound('coldcall', 'ann', 'play', 'r1', { win: 50, pool });
  const id = ledger.lastId, bal = ledger.balance('play:ann', 'play'), poolBal = svc.poolBalance('coldcall', 'office', 'play');
  eq(svc.settleRound('coldcall', 'ann', 'play', 'r1', { win: 50, pool }), { id: first.id, dup: true });
  eq(svc.settleRound('coldcall', 'ann', 'play', 'r1', { win: 50, pool: { ...pool } }).dup, true);
  for (const bad of [{ win: 51, pool }, { win: 50, pool: { ...pool, prize: 101 } }, { win: 50, pool: { ...pool, feed: 21 } }, { win: 50 }, { win: 50, pool: { ...pool, name: 'other' } }]) {
    throwsCode(() => svc.settleRound('coldcall', 'ann', 'play', 'r1', bad), 'round_closed');   // W2-b F2: was ref_conflict
  }
  still({ ledger }, id); eq(ledger.balance('play:ann', 'play'), bal); eq(svc.poolBalance('coldcall', 'office', 'play'), poolBal);
});

t('close once: a win-only settle resend is dup, a pool-less resend of a pool settle is round_closed', () => {
  const { svc, ledger } = player();
  svc.openRound('coldcall', 'ann', 'play', 'r1', 100);
  svc.settleRound('coldcall', 'ann', 'play', 'r1', { win: 70 });
  const id = ledger.lastId;
  eq(svc.settleRound('coldcall', 'ann', 'play', 'r1', { win: 70, pool: { name: 'office', feed: 0, prize: 0 } }).dup, true);
  throwsCode(() => svc.settleRound('coldcall', 'ann', 'play', 'r1', { win: 70, pool: { name: 'office', feed: 1 } }), 'round_closed');   // W2-b F2: was ref_conflict
  still({ ledger }, id);
});

t('void: the stake goes back, void again (other why) is dup, settle after void is round_closed and pays nothing', () => {
  const { svc, ledger, f } = player();
  const start = ledger.balance('play:ann', 'play');
  svc.openRound('coldcall', 'ann', 'play', 'r1', 700);
  const v = svc.voidRound('coldcall', 'ann', 'play', 'r1', 'timeout');
  ok(!v.dup);
  const rec = lineOf(f, 'coldcall:ann:r1:close');
  eq([rec.from, rec.to, rec.amount, rec.cur, rec.reason], ['escrow:coldcall:ann:r1', 'play:ann', 700, 'play', 'coldcall:void:timeout']);
  eq(ledger.balance('play:ann', 'play'), start); eq(ledger.balance('escrow:coldcall:ann:r1', 'play'), 0);
  const id = ledger.lastId;
  eq(svc.voidRound('coldcall', 'ann', 'play', 'r1', 'other'), { id: v.id, dup: true });
  eq(svc.voidRound('coldcall', 'ann', 'play', 'r1').dup, true);
  throwsCode(() => svc.settleRound('coldcall', 'ann', 'play', 'r1', { win: 5000 }), 'round_closed');
  throwsCode(() => svc.settleRound('coldcall', 'ann', 'play', 'r1', { win: 0 }), 'round_closed');
  throwsCode(() => svc.openRound('coldcall', 'ann', 'play', 'r1', 700), 'round_closed');
  still({ ledger }, id); eq(ledger.balance('play:ann', 'play'), start);
  booksOk(ledger);
});

t('void after settle is round_closed (no line); void of a round with no escrow is a noop', () => {
  const { svc, ledger } = player();
  svc.openRound('coldcall', 'ann', 'chips', 'r1', 100);
  svc.settleRound('coldcall', 'ann', 'chips', 'r1', { win: 0 });
  const id = ledger.lastId, bal = ledger.balance('bank:ann', 'chips');
  throwsCode(() => svc.voidRound('coldcall', 'ann', 'chips', 'r1', 'x'), 'round_closed');
  throwsCode(() => svc.openRound('coldcall', 'ann', 'chips', 'r1', 100), 'round_closed');
  eq(svc.voidRound('coldcall', 'ann', 'chips', 'never', 'x'), { id: null, dup: false, noop: true });
  still({ ledger }, id); eq(ledger.balance('bank:ann', 'chips'), bal);
});

t('a closed round stays closed across a restart: settle after void and void after settle', () => {
  const e = player();
  e.svc.openRound('coldcall', 'ann', 'play', 'a', 100); e.svc.voidRound('coldcall', 'ann', 'play', 'a', 'x');
  e.svc.openRound('coldcall', 'ann', 'play', 'b', 100); e.svc.settleRound('coldcall', 'ann', 'play', 'b', { win: 9 });
  const e2 = env(e.f), id = e2.ledger.lastId;
  throwsCode(() => e2.svc.settleRound('coldcall', 'ann', 'play', 'a', { win: 9 }), 'round_closed');
  throwsCode(() => e2.svc.voidRound('coldcall', 'ann', 'play', 'b', 'x'), 'round_closed');
  eq(e2.svc.voidRound('coldcall', 'ann', 'play', 'a', 'y').dup, true);
  eq(e2.svc.settleRound('coldcall', 'ann', 'play', 'b', { win: 9 }).dup, true);
  still(e2, id);
});

t('a prize bigger than the pool: pool_short, nothing written, escrow open, pool unchanged; pool + own feed is allowed', () => {
  const e = player(); const { svc, ledger } = e;
  seedPool(e, 'office', 100);
  svc.openRound('coldcall', 'ann', 'play', 'r1', 50);
  const id = ledger.lastId, bal = ledger.balance('play:ann', 'play');
  const err = throwsCode(() => svc.settleRound('coldcall', 'ann', 'play', 'r1', { win: 0, pool: { name: 'office', feed: 10, prize: 111 } }), 'pool_short');
  eq([err.have, err.need], [110, 111]);
  still({ ledger }, id); eq(ledger.balance('escrow:coldcall:ann:r1', 'play'), 50); eq(svc.poolBalance('coldcall', 'office', 'play'), 100); eq(ledger.balance('play:ann', 'play'), bal);
  eq(svc.roundClosed('coldcall', 'ann', 'r1'), false);
  const ok2 = svc.settleRound('coldcall', 'ann', 'play', 'r1', { win: 0, pool: { name: 'office', feed: 10, prize: 110 } });
  ok(!ok2.dup);
  eq(svc.poolBalance('coldcall', 'office', 'play'), 0); eq(ledger.balance('play:ann', 'play'), bal + 110);
  // an unfunded pool, instant round: the same code, not the ledger's bare insufficient
  const id2 = ledger.lastId;
  throwsCode(() => svc.houseRound('coldcall', 'ann', 10, 0, 'play', 'coldcall:ann:i1', { name: 'empty', prize: 1 }), 'pool_short');
  still({ ledger }, id2);
  // the player's own shortage stays `insufficient` on the player's account
  const e3 = throwsCode(() => svc.houseRound('coldcall', 'ann', START_PLAY * 2, 0, 'play', 'coldcall:ann:i2', { name: 'empty', prize: 1 }), 'insufficient');
  eq(e3.account, 'play:ann');
  booksOk(ledger);
});

t('free round (no escrow): settle pays the win and the pool legs under :close, a resend is dup, an all-zero settle is a noop', () => {
  const e = player(); const { svc, ledger, f } = e;
  seedPool(e, 'office', 80);
  const bal = ledger.balance('play:ann', 'play'), id0 = ledger.lastId;
  eq(svc.settleRound('coldcall', 'ann', 'play', 'nothing', { win: 0 }), { id: null, dup: false, noop: true }); still({ ledger }, id0);
  const r = svc.settleRound('coldcall', 'ann', 'play', 'free1', { win: 30, pool: { name: 'office', prize: 80 } });
  ok(!r.dup);
  eq(legs(lineOf(f, 'coldcall:ann:free1:close')), ['pool:coldcall:office>play:ann:80:play:coldcall:prize', 'house:coldcall>play:ann:30:play:coldcall:credit']);
  eq(ledger.balance('play:ann', 'play'), bal + 110); eq(svc.poolBalance('coldcall', 'office', 'play'), 0);
  const id = ledger.lastId;
  eq(svc.settleRound('coldcall', 'ann', 'play', 'free1', { win: 30, pool: { name: 'office', prize: 80 } }), { id: r.id, dup: true }); still({ ledger }, id);
  booksOk(ledger);
});

t('settle names the wrong currency for an escrow: refused, the close ref is not burned', () => {
  const { svc, ledger } = player();
  svc.openRound('coldcall', 'ann', 'chips', 'r1', 100);
  const id = ledger.lastId;
  throwsCode(() => svc.settleRound('coldcall', 'ann', 'play', 'r1', { win: 5 }), 'bad_cur');
  throwsCode(() => svc.voidRound('coldcall', 'ann', 'play', 'r1', 'x'), 'bad_cur');
  still({ ledger }, id); eq(svc.roundClosed('coldcall', 'ann', 'r1'), false);
  ok(!svc.voidRound('coldcall', 'ann', 'chips', 'r1', 'x').dup); eq(ledger.balance('bank:ann', 'chips'), START_CHIPS);
});

t('houseRound with pool legs: stake, feed, prize, win in that order under <game>:round; resend is dup', () => {
  const e = player(); const { svc, ledger, f } = e;
  seedPool(e, 'office', 60, 'chips');
  const r = svc.houseRound('coldcall', 'ann', 100, 20, 'chips', 'coldcall:ann:i1', { name: 'office', feed: 15, prize: 60 });
  ok(!r.dup);
  const rec = lineOf(f, 'coldcall:ann:i1');
  eq(rec.reason, 'coldcall:round');
  eq(legs(rec), ['bank:ann>house:coldcall:100:chips:coldcall:spend', 'house:coldcall>pool:coldcall:office:15:chips:coldcall:feed', 'pool:coldcall:office>bank:ann:60:chips:coldcall:prize', 'house:coldcall>bank:ann:20:chips:coldcall:credit']);
  eq(svc.poolBalance('coldcall', 'office', 'chips'), 15);
  const id = ledger.lastId;
  eq(svc.houseRound('coldcall', 'ann', 100, 20, 'chips', 'coldcall:ann:i1', { name: 'office', feed: 15, prize: 60 }).dup, true); still({ ledger }, id);
  throwsCode(() => svc.houseRound('coldcall', 'ann', 100, 21, 'chips', 'coldcall:ann:i1', { name: 'office', feed: 15, prize: 60 }), 'ref_conflict');
  eq(svc.houseRound('coldcall', 'ann', 0, 0, 'chips', 'coldcall:ann:i9', { name: 'office' }), { id: null, dup: false, noop: true });
  booksOk(ledger);
});

t('houseRound WITHOUT a pool is the batch it always wrote (dup against one written by hand in today\'s shape)', () => {
  const { svc, ledger, f } = player();
  const hand = (ref, cost, win) => {
    const items = [];
    if (cost > 0) items.push({ from: 'play:ann', to: 'house:bender', amount: cost, cur: 'play', reason: 'bender:spend' });
    if (win > 0) items.push({ from: 'house:bender', to: 'play:ann', amount: win, cur: 'play', reason: 'bender:credit' });
    return ledger.batch(items, ref, 'bender:round');
  };
  for (const [cost, win] of [[100, 0], [100, 250], [0, 75]]) {
    const ref = `bender:ann:h${cost}-${win}`, a = hand(ref, cost, win), id = ledger.lastId;
    eq(svc.houseRound('bender', 'ann', cost, win, 'play', ref), { id: a.id, dup: true }, 'bytes moved for ' + cost + '/' + win);
    eq(svc.houseRound('bender', 'ann', cost, win, 'play', ref, undefined).dup, true);
    eq(svc.houseRound('bender', 'ann', cost, win, 'play', ref, { name: 'office' }).dup, true, 'a pool with no amounts is no pool');
    still({ ledger }, id);
  }
  // and the other way round: a batch the service wrote is exactly the hand-written line
  svc.houseRound('bender', 'ann', 100, 250, 'chips', 'bender:ann:w1');
  const rec = lineOf(f, 'bender:ann:w1');
  eq(legs(rec), ['bank:ann>house:bender:100:chips:bender:spend', 'house:bender>bank:ann:250:chips:bender:credit']); eq(rec.reason, 'bender:round');
});

t('sweepEscrows: unclaimed voided under :close with reason <game>:void:boot, claimed kept, second sweep does nothing', () => {
  const { svc, ledger, f } = player(null, ['ann', 'bob']);
  svc.openRound('coldcall', 'ann', 'play', 'live', 100);
  svc.openRound('coldcall', 'ann', 'chips', 'dead', 200);
  svc.openRound('coldcall', 'bob', 'play', 'dead2', 300);
  const claim = ({ key, roundId }) => key === 'ann' && roundId === 'live';
  const r = svc.sweepEscrows(claim);
  eq(r.errors, []);
  eq(r.kept.map(x => x.roundId), ['live']);
  eq(r.voided.map(x => x.roundId).sort(), ['dead', 'dead2']);
  const rec = lineOf(f, 'coldcall:ann:dead:close');
  eq([rec.from, rec.to, rec.amount, rec.cur, rec.reason], ['escrow:coldcall:ann:dead', 'bank:ann', 200, 'chips', 'coldcall:void:boot']);
  eq(ledger.balance('bank:ann', 'chips'), START_CHIPS); eq(ledger.balance('play:bob', 'play'), START_PLAY);
  eq(ledger.balance('escrow:coldcall:ann:live', 'play'), 100);
  const id = ledger.lastId, again = svc.sweepEscrows(claim);
  eq(again.voided, []); eq(again.errors, []); eq(again.kept.map(x => x.roundId), ['live']); still({ ledger }, id);
  booksOk(ledger);
});

t('sweepEscrows reaches a game id with no module, and one bad account does not stop the rest', () => {
  const { svc, ledger } = player();
  // a game this build knows no module for, and an account only a hand-edited ledger could hold
  ledger.transfer('mint:signup', 'escrow:ghost:ann:g1', 40, 'play', 'x', 'ghost-open');
  ledger.transfer('mint:signup', 'escrow:ghost:ann:g2', 60, 'chips', 'x', 'ghost-open2');
  svc.openRound('coldcall', 'ann', 'play', 'ok1', 100);
  const seen = [];
  const r = svc.sweepEscrows((x) => { seen.push(x.game); if (x.roundId === 'g1') throw new Error('boom'); return false; });
  ok(seen.includes('ghost') && seen.includes('coldcall'));
  eq(r.errors.length, 1); eq(r.errors[0].what, 'escrow:ghost:ann:g1');
  eq(r.voided.map(x => x.roundId).sort(), ['g2', 'ok1']);
  eq(ledger.balance('escrow:coldcall:ann:ok1', 'play'), 0); eq(ledger.balance('escrow:ghost:ann:g2', 'chips'), 0);
  eq(ledger.balance('escrow:ghost:ann:g1', 'play'), 40, 'the account that errored is left as it was');
});

t('mirror folds a player\'s escrows into their row and never shows a pool; books balance with escrows and pools open', () => {
  const e = player(null, ['ann', 'bob']); const { svc, ledger } = e;
  seedPool(e, 'office', 1234, 'play'); seedPool(e, 'office', 77, 'chips', 'bob');
  svc.openRound('coldcall', 'ann', 'play', 'p1', 250);
  svc.openRound('coldcall', 'ann', 'chips', 'c1', 40);
  svc.openRound('coldcall', 'bob', 'chips', 'c2', 5);
  const m = svc.mirror();
  eq(m.wallet.ann, START_PLAY - 1234 - 250 + 250, 'ann wallet row = wallet + escrow'); eq(m.bank.ann, START_CHIPS);
  eq(m.bank.bob, START_CHIPS - 77); eq(m.wallet.bob, START_PLAY);
  eq(Object.keys(m.bank).sort(), ['ann', 'bob']); eq(Object.keys(m.wallet).sort(), ['ann', 'bob']);
  const sumW = Object.values(m.wallet).reduce((a, b) => a + b, 0), sumB = Object.values(m.bank).reduce((a, b) => a + b, 0);
  eq(sumW, 2 * START_PLAY - 1234, 'wallet rows hold everything but the pool'); eq(sumB, 2 * START_CHIPS - 77);
  booksOk(ledger);
  ok(ledger.check().play.players === 2 * START_PLAY); // pool and escrow are holders: the player-side total is all of it
});

t('playHeld and top-up eligibility count an open Play escrow; balances() lists escrows and inRound', () => {
  const { svc, ledger } = player();
  // ann stakes nearly everything into a round: the wallet alone is under TOPUP_BELOW but she is not "broke"
  svc.openRound('coldcall', 'ann', 'play', 'big', START_PLAY - 50);
  svc.openRound('coldcall', 'ann', 'chips', 'cc', 123);
  eq(ledger.balance('play:ann', 'play'), 50);
  const el = svc.topUpEligible('ann');
  eq(el.eligible, false); eq(el.why, 'not_needed'); eq(el.total, START_PLAY); eq(el.escrow, START_PLAY - 50); eq(el.wallet, 50);
  throwsCode(() => svc.topUp('ann', 'tu1'), 'disabled');   // SVC-1b: the refill is off
  const b = svc.balances('ann');
  eq(b.chips, START_CHIPS - 123); eq(b.play, 50); eq(b.inRound, { chips: 123, play: START_PLAY - 50 });
  eq(b.escrows.map(x => [x.account, x.game, x.roundId, x.cur, x.balance]).sort(), [['escrow:coldcall:ann:big', 'coldcall', 'big', 'play', START_PLAY - 50], ['escrow:coldcall:ann:cc', 'coldcall', 'cc', 'chips', 123]].sort());
  eq(b.seats, []); eq(b.atTable, { chips: 0, play: 0 });
  // after the round is lost the money is gone for real and she can top up
  svc.settleRound('coldcall', 'ann', 'play', 'big', { win: 0 });
  clock += 4000000;
  eq(svc.topUpEligible('ann').eligible, true);
});

// ---- the seeded random walk: a few thousand ops, a model kept in the test, everything checked after every op ----
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }

t('random walk: 4000 ops over open / settle / void / round / resends / wrong closes keep the books, the holders and a model', () => {
  const { svc, ledger } = (() => { const f = path.join(dir, 'walk.jsonl'); const l = open(f, { fsync: 'none', now: () => clock, log: quiet }); return { svc: createService(l, { now: () => clock }), ledger: l }; })();
  const R = rng(20261006), pick = (a) => a[Math.floor(R() * a.length)], rint = (lo, hi) => lo + Math.floor(R() * (hi - lo + 1));
  const keys = ['ann', 'bob'], curs = ['chips', 'play'];
  for (const k of keys) svc.ensureAccount(k);
  // shrink the wallets so a stake can really be refused
  for (const k of keys) for (const c of curs) svc.adminAdjust(k, -((c === 'chips' ? START_CHIPS : START_PLAY) - 150), c, 'walk', `adj:${k}:${c}`);
  const store = (c, k) => (c === 'chips' ? 'bank:' : 'play:') + k;
  const M = { chips: new Map(), play: new Map() };                 // model balances per currency
  const mget = (c, a) => M[c].get(a) || 0, madd = (c, a, v) => M[c].set(a, mget(c, a) + v);
  for (const k of keys) for (const c of curs) M[c].set(store(c, k), 150);
  const accounts = new Set(); for (const k of keys) for (const c of curs) accounts.add(store(c, k));
  accounts.add('house:coldcall'); accounts.add('pool:coldcall:office');
  const rounds = new Map();                                        // roundId -> { key, cur, state: none|open|closed, stake, close }
  const instants = new Map();                                      // id -> { key, cur, params }
  const counts = {};
  const bump = (name) => { counts[name] = (counts[name] || 0) + 1; };
  const POOL = 'pool:coldcall:office', H = 'house:coldcall';
  const moveModel = (cur, list) => { for (const [a, b, v] of list) { madd(cur, a, -v); madd(cur, b, v); } };
  const attempt = (fn) => { try { const r = fn(); bump(r.dup ? 'dup' : r.noop ? 'noop' : 'wrote'); return { r }; } catch (e) { if (e instanceof MoneyError) { bump(e.code); return { code: e.code }; } throw e; } };
  const noLine = (id0, what) => { if (ledger.lastId !== id0) throw new Error(what + ': a line was written'); };

  // returns { legs?: [from,to,amount][], throws?: code, dup?: true, noop?: true } for the pooled legs of an outcome
  const outcomeLegs = (esc, player, cur, win, pool, stake) => {
    const L = [];
    if (stake > 0) L.push([esc ? esc : player, H, stake]);
    if (pool.feed > 0) L.push([H, POOL, pool.feed]);
    if (pool.prize > 0) L.push([POOL, player, pool.prize]);
    if (win > 0) L.push([H, player, win]);
    return L;
  };
  const shortCheck = (cur, L, playerAcct) => {
    // replay the legs on a scratch copy exactly as the ledger does: holders may not go negative at any step
    const s = new Map(); const g = (a) => (s.has(a) ? s.get(a) : mget(cur, a));
    for (const [a, b, v] of L) {
      if (a !== H) { if (g(a) < v) return a === POOL ? 'pool_short' : 'insufficient'; }
      s.set(a, g(a) - v); s.set(b, g(b) + v);
    }
    return null;
  };

  for (let step = 0; step < 4000; step++) {
    const op = pick(['open', 'open', 'settle', 'settle', 'void', 'round', 'resend', 'wrong']);
    const fresh = R() < 0.4 || rounds.size === 0;
    let id, rd;
    if (fresh) { id = 'r' + step; rd = { key: pick(keys), cur: pick(curs), state: 'none', stake: 0, close: null }; rounds.set(id, rd); }
    else { id = pick([...rounds.keys()]); rd = rounds.get(id); }
    const { key, cur } = rd, player = store(cur, key), esc = `escrow:coldcall:${key}:${id}`;
    accounts.add(esc);
    const id0 = ledger.lastId;
    const poolArg = () => (R() < 0.5 ? undefined : { name: 'office', feed: rint(0, 30), prize: R() < 0.5 ? 0 : rint(0, 200) });
    const pv = (p) => ({ feed: p ? p.feed : 0, prize: p ? p.prize : 0 });

    if (op === 'open') {
      const cost = R() < 0.1 ? 0 : (rd.state === 'open' && R() < 0.5 ? rd.stake : rint(1, 140));
      const got = attempt(() => svc.openRound('coldcall', key, cur, id, cost)); bump('open');
      if (cost === 0) { eq(got.r, { id: null, dup: false, noop: true }); noLine(id0, 'open 0'); }
      else if (rd.state === 'closed') { eq(got.code, 'round_closed'); noLine(id0, 'open closed'); }
      else if (rd.state === 'open') {
        if (cost === rd.stake) { ok(got.r && got.r.dup, 'open resend should be dup'); } else eq(got.code, 'ref_conflict');
        noLine(id0, 'open resend');
      } else if (mget(cur, player) < cost) { eq(got.code, 'insufficient'); noLine(id0, 'open short'); }
      else { ok(got.r && !got.r.dup, 'open should write'); moveModel(cur, [[player, esc, cost]]); rd.state = 'open'; rd.stake = cost; }
    } else if (op === 'settle' || op === 'wrong') {
      const win = R() < 0.55 ? 0 : rint(1, 160), pool = poolArg(), pw = pv(pool);
      let useCur = cur;
      if (op === 'wrong' && rd.state === 'open') useCur = cur === 'chips' ? 'play' : 'chips';
      if (op === 'wrong' && rd.state === 'closed' && rd.close) { /* a different number on a closed round */ }
      const got = attempt(() => svc.settleRound('coldcall', key, useCur, id, { win, pool })); bump('settle');
      if (useCur !== cur && rd.state === 'open') { eq(got.code, 'bad_cur'); noLine(id0, 'wrong cur'); }
      else if (rd.state === 'closed') {
        if (rd.close.kind === 'void') eq(got.code, 'round_closed');
        else if (rd.close.win === win && rd.close.feed === pw.feed && rd.close.prize === pw.prize) ok(got.r && got.r.dup, 'settle resend should be dup');
        else eq(got.code, 'round_closed');   // W2-b F2: a different outcome on a closed round is "already played"
        noLine(id0, 'settle on a closed round');
      } else {
        const stake = rd.state === 'open' ? rd.stake : 0;
        const L = outcomeLegs(stake > 0 ? esc : null, player, cur, win, pw, stake);
        if (pw.feed > stake) { eq(got.code, 'bad_amount'); noLine(id0, 'settle feed above the stake'); }   // W2-b F4
        else if (!L.length) { eq(got.r, { id: null, dup: false, noop: true }); noLine(id0, 'settle noop'); }
        else {
          const bad = shortCheck(cur, L, player);
          if (bad) { eq(got.code, bad); noLine(id0, 'settle ' + bad); }
          else { ok(got.r && !got.r.dup, 'settle should write: ' + JSON.stringify(got)); moveModel(cur, L); rd.state = 'closed'; rd.close = { kind: 'settle', win, feed: pw.feed, prize: pw.prize }; rd.stake = 0; }
        }
      }
    } else if (op === 'void') {
      const got = attempt(() => svc.voidRound('coldcall', key, cur, id, pick(['timeout', 'boot', 'x']))); bump('void');
      if (rd.state === 'closed') {
        if (rd.close.kind === 'void') ok(got.r && got.r.dup, 'void resend should be dup'); else eq(got.code, 'round_closed');
        noLine(id0, 'void on a closed round');
      } else if (rd.state === 'none') { eq(got.r, { id: null, dup: false, noop: true }); noLine(id0, 'void none'); }
      else { ok(got.r && !got.r.dup); moveModel(cur, [[esc, player, rd.stake]]); rd.state = 'closed'; rd.close = { kind: 'void' }; rd.stake = 0; }
    } else if (op === 'round') {
      // an instant round, id space of its own ('i' + n), bound to (key, cur) on first use
      let iid = fresh || instants.size === 0 || R() < 0.5 ? 'i' + step : pick([...instants.keys()]);
      let ir = instants.get(iid);
      if (!ir) { ir = { key, cur, params: null }; instants.set(iid, ir); }
      const ip = ir.key + '|' + ir.cur, ipl = store(ir.cur, ir.key);
      const same = ir.params && R() < 0.5;
      const cost = same ? ir.params.cost : (R() < 0.15 ? 0 : rint(0, 130)), win = same ? ir.params.win : (R() < 0.55 ? 0 : rint(0, 160));
      const pool = same ? ir.params.pool : poolArg(), pw = pv(pool);
      const got = attempt(() => svc.houseRound('coldcall', ir.key, cost, win, ir.cur, `coldcall:${ir.key}:${iid}`, pool)); bump('round');
      const L = outcomeLegs(null, ipl, ir.cur, win, pw, cost);
      if (pw.feed > cost) { eq(got.code, 'bad_amount'); noLine(id0, 'round feed above the cost'); }   // W2-b F4: checked before the noop and the ref
      else if (!L.length) { eq(got.r, { id: null, dup: false, noop: true }); noLine(id0, 'round noop'); }   // all zero is a noop before the ref is looked at, as it always was
      else if (ir.params) {
        const p = ir.params;
        if (p.cost === cost && p.win === win && p.feed === pw.feed && p.prize === pw.prize) ok(got.r && got.r.dup, 'round resend should be dup ' + ip); else eq(got.code, 'ref_conflict');
        noLine(id0, 'round resend');
      } else {
        const bad = shortCheck(ir.cur, L, ipl);
        if (bad) { eq(got.code, bad); noLine(id0, 'round ' + bad); }
        else { ok(got.r && !got.r.dup); moveModel(ir.cur, L); ir.params = { cost, win, feed: pw.feed, prize: pw.prize, pool }; }
      }
    } else {   // resend: replay the stored close or open exactly, after a "crash" of nothing but the caller
      if (rd.state === 'closed' && rd.close.kind === 'settle') {
        const got = attempt(() => svc.settleRound('coldcall', key, cur, id, { win: rd.close.win, pool: { name: 'office', feed: rd.close.feed, prize: rd.close.prize } })); bump('resend');
        ok(got.r && got.r.dup, 'exact resend should be dup'); noLine(id0, 'exact resend');
      } else if (rd.state === 'open') {
        const got = attempt(() => svc.openRound('coldcall', key, cur, id, rd.stake)); bump('resend');
        ok(got.r && got.r.dup, 'open resend should be dup'); noLine(id0, 'open resend');
      }
    }

    // ---- after every op ----
    const c = ledger.check();
    if (!(c.chips.ok && c.play.ok)) throw new Error('step ' + step + ' ' + op + ': books do not balance ' + JSON.stringify(c));
    for (const cu of curs) for (const a of accounts) {
      const have = ledger.balance(a, cu), want = mget(cu, a);
      if (have !== want) throw new Error(`step ${step} ${op}: ${a} ${cu} is ${have}, model says ${want}`);
      if (a !== H && have < 0) throw new Error(`step ${step}: holder ${a} is negative`);
    }
    // everything a player, the pool, the escrows and the house hold sums to zero per currency: nothing was made or lost
    for (const cu of curs) {
      let all = 0; for (const a of accounts) all += ledger.balance(a, cu);
      if (all !== -ledger.balance('admin:adjust', cu) - ledger.balance('mint:signup', cu)) throw new Error(`step ${step}: sum of players + pool + escrows + house does not match what entered`);
    }
  }
  // the service's own view of the open rounds matches the model at the end
  const want = [...rounds].filter(([, r]) => r.state === 'open').map(([id, r]) => `${r.key}/${r.cur}/${id}/${r.stake}`).sort();
  eq(svc.openRounds('coldcall').map(r => `${r.key}/${r.cur}/${r.roundId}/${r.amount}`).sort(), want);
  for (const k of ['open', 'settle', 'void', 'round', 'resend']) ok((counts[k] || 0) > 100, 'op mix too thin: ' + JSON.stringify(counts));
  for (const k of ['wrote', 'dup', 'noop', 'insufficient', 'pool_short', 'round_closed', 'ref_conflict', 'bad_cur', 'bad_amount']) ok((counts[k] || 0) >= 20, 'outcome mix too thin for ' + k + ': ' + JSON.stringify(counts));
  // and a sweep of everything left open returns every stake
  const sw = svc.sweepEscrows(() => false);
  eq(sw.errors, []); eq(svc.openRounds('coldcall'), []);
  const c = ledger.check(); ok(c.chips.ok && c.play.ok);
});

// ---- W2-b fixes (critic report _scratch/p6/w2b/CRITIC-REPORT.md) ----

t('F1: houseRound / houseSpend / houseCredit refuse a ref ending in :open or :close (bad_ref, nothing written); other refs are fine', () => {
  const { svc, ledger } = player();
  svc.openRound('coldcall', 'ann', 'chips', 'r7', 700);
  const id = ledger.lastId;
  for (const ref of ['coldcall:ann:r7:close', 'coldcall:ann:r7:open', 'x:open', 'x:close']) {
    throwsCode(() => svc.houseSpend('coldcall', 'ann', 1, 'chips', ref), 'bad_ref');
    throwsCode(() => svc.houseCredit('coldcall', 'ann', 1, 'chips', ref), 'bad_ref');
    throwsCode(() => svc.houseRound('coldcall', 'ann', 1, 0, 'chips', ref), 'bad_ref');
    throwsCode(() => svc.houseRound('coldcall', 'ann', 0, 0, 'chips', ref), 'bad_ref');   // refused before the all-zero noop
  }
  still({ ledger }, id);
  // the escrow is not stranded: its close is still free
  const w = svc.settleRound('coldcall', 'ann', 'chips', 'r7', { win: 0 }); ok(w.id > 0 && !w.dup);
  eq(ledger.balance('escrow:coldcall:ann:r7', 'chips'), 0);
  for (const ref of ['coldcall:ann:r8', 'coldcall:ann:r8:closed', 'coldcall:ann:r8:opening']) ok(svc.houseSpend('coldcall', 'ann', 1, 'chips', ref).id > 0, ref);
});

t('F2: a replayed settle with other numbers (or a free round that won, replayed with 0) is round_closed, the identical one is dup, and nothing is written', () => {
  const { svc, ledger } = player();
  const first = svc.settleRound('coldcall', 'ann', 'play', 'cb-41', { win: 500 });   // free round: no escrow
  const id = ledger.lastId, bal = ledger.balance('play:ann', 'play');
  eq(svc.settleRound('coldcall', 'ann', 'play', 'cb-41', { win: 500 }), { id: first.id, dup: true });
  for (const win of [300, 0, 501]) throwsCode(() => svc.settleRound('coldcall', 'ann', 'play', 'cb-41', { win }), 'round_closed');
  throwsCode(() => svc.settleRound('coldcall', 'ann', 'play', 'cb-41', {}), 'round_closed');
  still({ ledger }, id); eq(ledger.balance('play:ann', 'play'), bal);
});

t('F2: roundClosed is true for a settled or voided round AND for an instant round whose own ref is in the ledger', () => {
  const { svc } = player();
  eq(svc.roundClosed('coldcall', 'ann', 'i1'), false);
  svc.houseRound('coldcall', 'ann', 10, 25, 'play', 'coldcall:ann:i1');
  eq(svc.roundClosed('coldcall', 'ann', 'i1'), true);
  eq(svc.roundClosed('coldcall', 'bob', 'i1'), false); eq(svc.roundClosed('coldcall', 'ann', 'i2'), false); eq(svc.roundClosed('bender', 'ann', 'i1'), false);
  svc.openRound('coldcall', 'ann', 'play', 'r1', 10); eq(svc.roundClosed('coldcall', 'ann', 'r1'), false);
  svc.voidRound('coldcall', 'ann', 'play', 'r1'); eq(svc.roundClosed('coldcall', 'ann', 'r1'), true);
});

t('F3: settleRound refuses an outcome that is not an object (bad_amount); stake: exact escrow or stake_mismatch { have, want }, nothing written', () => {
  const { svc, ledger } = player();
  svc.openRound('coldcall', 'ann', 'play', 'r1', 1000);
  const id = ledger.lastId;
  for (const bad of [5000, '5', null, [], true]) throwsCode(() => svc.settleRound('coldcall', 'ann', 'play', 'r1', bad), 'bad_amount');
  for (const stake of [999, 1001, 0]) { const e = throwsCode(() => svc.settleRound('coldcall', 'ann', 'play', 'r1', { win: 5, stake }), 'stake_mismatch'); eq([e.have, e.want], [1000, stake]); }
  throwsCode(() => svc.settleRound('coldcall', 'ann', 'play', 'r1', { win: 5, stake: -1 }), 'bad_amount');
  throwsCode(() => svc.settleRound('coldcall', 'ann', 'play', 'r1', { win: 5, stake: 1.5 }), 'bad_amount');
  still({ ledger }, id); eq(ledger.balance('escrow:coldcall:ann:r1', 'play'), 1000);
  // a typo in the round id finds no escrow: with stake the settle is refused instead of paying a free round
  const e2 = throwsCode(() => svc.settleRound('coldcall', 'ann', 'play', 'R1', { win: 3000, stake: 1000 }), 'stake_mismatch'); eq([e2.have, e2.want], [0, 1000]);
  still({ ledger }, id);
  const w = svc.settleRound('coldcall', 'ann', 'play', 'r1', { win: 5, stake: 1000 }); ok(w.id > 0);
  // stake 0 is how a game says "free round": it settles when there is no escrow
  const f = svc.settleRound('coldcall', 'ann', 'play', 'free1', { win: 9, stake: 0 }); ok(f.id > 0);
  // not given = today's behaviour
  svc.openRound('coldcall', 'ann', 'play', 'r2', 40); ok(svc.settleRound('coldcall', 'ann', 'play', 'r2', { win: 0 }).id > 0);
});

t('F3: a resend of a stored close names the same stake (when given) and the same currency, else round_closed', () => {
  const { svc, ledger } = player();
  svc.openRound('coldcall', 'ann', 'chips', 's1', 100); const s = svc.settleRound('coldcall', 'ann', 'chips', 's1', { win: 40 });
  const id = ledger.lastId;
  eq(svc.settleRound('coldcall', 'ann', 'chips', 's1', { win: 40, stake: 100 }), { id: s.id, dup: true });
  eq(svc.settleRound('coldcall', 'ann', 'chips', 's1', { win: 40 }).dup, true);
  throwsCode(() => svc.settleRound('coldcall', 'ann', 'chips', 's1', { win: 40, stake: 90 }), 'round_closed');
  throwsCode(() => svc.settleRound('coldcall', 'ann', 'chips', 's1', { win: 40, stake: 0 }), 'round_closed');
  throwsCode(() => svc.settleRound('coldcall', 'ann', 'play', 's1', { win: 40 }), 'round_closed');       // the other currency was dup
  svc.settleRound('coldcall', 'ann', 'chips', 'f1', { win: 700 });
  throwsCode(() => svc.settleRound('coldcall', 'ann', 'play', 'f1', { win: 700 }), 'round_closed');
  eq(svc.settleRound('coldcall', 'ann', 'chips', 'f1', { win: 700, stake: 0 }).dup, true);
  // a void stored in one currency, the same void named in the other
  svc.openRound('coldcall', 'ann', 'play', 'v1', 50); const v = svc.voidRound('coldcall', 'ann', 'play', 'v1', 'timeout');
  eq(svc.voidRound('coldcall', 'ann', 'play', 'v1', 'again'), { id: v.id, dup: true });
  throwsCode(() => svc.voidRound('coldcall', 'ann', 'chips', 'v1', 'timeout'), 'round_closed');
  eq(ledger.lastId, id + 3, 'only the f1 settle, the v1 open and the v1 void were written');
});

t('F4: feed may not exceed the stake of the same batch: houseRound (cost) and settleRound (escrow), free rounds cannot feed, they can still win a prize', () => {
  const e = player(); const { svc, ledger } = e;
  seedPool(e, 'office', 300);
  const id = ledger.lastId;
  throwsCode(() => svc.houseRound('coldcall', 'ann', 0, 0, 'play', 'coldcall:ann:i1', { name: 'office', feed: 50000 }), 'bad_amount');
  const x = throwsCode(() => svc.houseRound('coldcall', 'ann', 10, 0, 'play', 'coldcall:ann:i2', { name: 'office', feed: 11 }), 'bad_amount'); eq(x.field, 'feed');
  throwsCode(() => svc.settleRound('coldcall', 'ann', 'play', 'free9', { pool: { name: 'office', feed: 70000, prize: 120 } }), 'bad_amount');
  svc.openRound('coldcall', 'ann', 'play', 'r2', 10);
  throwsCode(() => svc.settleRound('coldcall', 'ann', 'play', 'r2', { pool: { name: 'office', feed: 9999 } }), 'bad_amount');
  throwsCode(() => svc.settleRound('coldcall', 'ann', 'play', 'r2', { pool: { name: 'office', feed: 11 } }), 'bad_amount');
  eq(ledger.lastId, id + 1, 'only the r2 open was written'); eq(svc.poolBalance('coldcall', 'office', 'play'), 300);
  // exactly the stake is allowed, on both paths; a free round still wins a prize
  ok(svc.houseRound('coldcall', 'ann', 10, 0, 'play', 'coldcall:ann:i3', { name: 'office', feed: 10 }).id > 0);
  ok(svc.settleRound('coldcall', 'ann', 'play', 'r2', { pool: { name: 'office', feed: 10 } }).id > 0);
  ok(svc.settleRound('coldcall', 'ann', 'play', 'free10', { pool: { name: 'office', prize: 120 } }).id > 0);
  eq(svc.poolBalance('coldcall', 'office', 'play'), 300 + 10 + 10 - 120);
  booksOk(ledger);
});

t('F5: escrows that share a round id across keys, currencies and games: playHeld, balances().inRound, escrows and openRounds stay per key / game / currency', () => {
  const { svc, ledger } = player(null, ['ann', 'bob']);
  svc.openRound('coldcall', 'ann', 'play', 'r1', 300);
  svc.openRound('bender', 'ann', 'play', 'r1', 200);                       // same round id, other game
  ledger.transfer('bank:ann', 'escrow:coldcall:ann:r1', 40, 'chips', 'coldcall:open', 'seed-ann-chips-r1');   // same round id, other currency (the open ref has no currency, so it is written by hand)
  svc.openRound('coldcall', 'bob', 'play', 'r1', 7000);                    // same round id, other key
  ledger.transfer('bank:bob', 'escrow:coldcall:bob:r1', 9, 'chips', 'coldcall:open', 'seed-bob-chips-r1');
  const a = svc.balances('ann'), b = svc.balances('bob');
  eq(a.inRound, { chips: 40, play: 500 }); eq(b.inRound, { chips: 9, play: 7000 });
  eq(a.escrows.map(x => `${x.game}/${x.roundId}/${x.cur}/${x.balance}`).sort(), ['bender/r1/play/200', 'coldcall/r1/chips/40', 'coldcall/r1/play/300']);
  eq(b.escrows.length, 2);
  eq(svc.openRounds('coldcall').map(r => `${r.key}/${r.cur}/${r.amount}`).sort(), ['ann/chips/40', 'ann/play/300', 'bob/chips/9', 'bob/play/7000']);
  eq(svc.openRounds('bender'), [{ key: 'ann', cur: 'play', roundId: 'r1', amount: 200 }]);
  // top-up eligibility counts the key's own Play escrows (all games) and nobody else's
  const ea = svc.topUpEligible('ann'), eb = svc.topUpEligible('bob');
  eq([ea.escrow, ea.total], [500, START_PLAY]);
  eq([eb.escrow, eb.total], [7000, START_PLAY]);
  eq(svc.mirror().wallet.ann, START_PLAY); eq(svc.mirror().wallet.bob, START_PLAY); eq(svc.mirror().bank.ann, START_CHIPS); eq(svc.mirror().bank.bob, START_CHIPS);
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
