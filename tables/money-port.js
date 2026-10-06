'use strict';
// The ONLY place a money `ref` is built and the ONLY caller of the money service for table operations (contract section 3).
// `table` arguments are anything with { id, cur } (cur = 'chips' | 'play', the table's currency).
// Every write returns before the caller changes memory; a successful non-dup write fires afterWrite(keys).

const { TableError, isFence } = require('./errors');

const seatAcct = (tableId, key) => `seat:${tableId}:${key}`;

function createMoneyPort({ service, ledger, bootId, afterWrite, onFence }) {
  let counter = 0;
  const boot = bootId || Date.now().toString(36);
  const nextOp = () => `${boot}.${++counter}`;
  const touch = keys => { if (afterWrite) { try { afterWrite(keys); } catch (e) { console.error('[v2] afterWrite failed:', e && e.message); } } };

  // An intent mints its ref ONCE; passing the same intent to a retry answers dup and can never double-pay.
  function intent(kind, table, key, amount) {
    return { kind, key, amount, ref: `${kind}:${table.id}:${key}:${nextOp()}` };
  }

  // Money errors that a player can cause become TableErrors; a fence is reported and rethrown as money_down.
  function wrap(fn) {
    try { return fn(); } catch (e) {
      if (e && e.name === 'MoneyError') {
        if (isFence(e)) { if (onFence) onFence(e); throw new TableError('money_down', { reason: e.code }); }
        if (e.code === 'insufficient') throw new TableError('bank', { fund: String(e.account || '').startsWith('play:') ? 'play' : 'chips', have: e.have, need: e.need });
        if (e.code === 'fund_mismatch') throw new TableError('fund_mismatch', { have: e.have, want: e.want });
      }
      throw e;
    }
  }

  const seatBalance = (table, key) => ledger.balance(seatAcct(table.id, key), table.cur);
  const seatFund = (table, key) => service.seatFund(table.id, key, table.cur);
  // Balance of the owner's bank ('chips') or Play wallet ('play') fund.
  const fundBalance = (key, fund) => ledger.balance((fund === 'chips' ? 'bank:' : 'play:') + key, fund);

  // Buy in from `fund` ('chips'|'play'|null = the table's own). Returns { id, dup, intent }.
  function buyIn(table, key, amount, fund, it, kind = 'buyin') {
    const i = it || intent(kind, table, key, amount);
    const r = wrap(() => service.buyIn(key, table.id, amount, table.cur, fund || null, i.ref));
    if (!r.dup) touch([key]);
    return { ...r, intent: i };
  }

  // Cash out `amount` of stack to the seat's own fund (always null = the seat's fund). kind: leave|kick|sweep|grace|night.
  function cashOut(table, key, amount, kind, it) {
    if (amount === 0) return { id: null, dup: false, noop: true, intent: null };
    const i = it || intent(kind, table, key, amount);
    const r = wrap(() => service.cashOut(key, table.id, amount, table.cur, null, i.ref));
    if (!r.dup && !r.noop) touch([key]);
    return { ...r, intent: i };
  }

  // Leave / kick: the stack only. committed (this hand's chips) stays in the seat until the hand batch moves it (N1).
  // `committed` is hand.seats[s].committed while a hand is live, else 0. NEVER the engine stack (engine-returned chips sit in it).
  function leaveAmount(table, key, committed) { return Math.max(0, seatBalance(table, key) - (committed || 0)); }
  function leave(table, key, committed, kind = 'leave') { return cashOut(table, key, leaveAmount(table, key, committed), kind); }

  // After the hand's batch: whatever is left in the seat account goes back to the owner (no-op at 0).
  function sweep(table, key, kind = 'sweep') { return cashOut(table, key, seatBalance(table, key), kind); }

  // The commit point. One ledger line, fsync'd before it returns. not_conserved throws before anything is written.
  function settleHand(table, handNo, maps) {
    const r = wrap(() => service.settleHand(table.id, handNo, table.cur, maps));
    if (!r.dup) touch(Object.keys(maps.committed || {}));
    return r;
  }

  // M10: buy-ins into this seat since the night began, read from the ledger (survives restarts).
  function buyInCount(table, key, fromId) {
    const seat = seatAcct(table.id, key);
    let n = 0;
    for (const _ of ledger.entries(e => e.to === seat && e.reason.startsWith('buyin:'), fromId || 0)) n++;
    return n;
  }

  // handNo is monotonic per table across restarts: the highest n over refs 'hand:<id>:<n>' (0 if none).
  function lastHandNo(tableId) {
    const prefix = `hand:${tableId}:`;
    let max = 0;
    for (const e of ledger.entries(x => x.batchRef && x.batchRef.startsWith(prefix))) {
      const n = Number(e.batchRef.slice(prefix.length));
      if (Number.isSafeInteger(n) && n > max) max = n;
    }
    return max;
  }

  // Drift check for one table: every non-zero seat account must equal stack + handBet of its seat (contract 3 / 10).
  // `seats` = [{ key, stack, handBet }]. Returns [{ account, ledger, memory }] for each disagreement (empty = clean).
  function drift(table, seats) {
    const out = [], known = new Set();
    for (const s of seats) {
      known.add(s.key);
      const have = seatBalance(table, s.key), want = s.stack + (s.handBet || 0);
      if (have !== want) out.push({ account: seatAcct(table.id, s.key), ledger: have, memory: want });
    }
    for (const { account, balance } of ledger.list(`seat:${table.id}:`, table.cur)) {
      const key = account.slice(`seat:${table.id}:`.length);
      if (!known.has(key)) out.push({ account, ledger: balance, memory: 0 });
    }
    return out;
  }

  return { intent, buyIn, cashOut, leave, leaveAmount, sweep, settleHand, seatBalance, seatFund, fundBalance, buyInCount, lastHandNo, drift, nextOp, bootId: boot, seatAcct };
}

module.exports = { createMoneyPort, seatAcct };
