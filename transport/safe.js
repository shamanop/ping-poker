'use strict';
// Error containment (contract section 8). Expected errors (TableError, engine RuleError, MoneyError, validation) become a socket
// `error` payload { message, code, ...numbers } and change nothing else. Any other error is a bug: log it, answer `internal`,
// and void the touched table's hand if it is not committed. The process never exits on a handler, timer or promise error.

const { TableError, isFence } = require('../tables/errors');

// Fixed sentences for engine rule errors: never a digit or a '$' (tests/v2/27_errors.js).
const RULE_MESSAGES = {
  not_your_turn: 'Not your turn', bad_action: 'Invalid action', cannot_check: 'You cannot check', cannot_call: 'You cannot call', bad_amount: 'Invalid amount',
  raise_closed: 'Raising is closed', raise_too_small: 'Raise is too small', raise_too_big: 'Raise is too big', hand_over: 'No hand in progress', not_in_hand: 'You are not in the hand',
};

function wireOf(e) {
  if (e instanceof TableError) return e.toWire();
  if (e && e.name === 'RuleError') {
    const d = e.details || {};
    const o = { message: RULE_MESSAGES[e.code] || 'Invalid action', code: e.code };
    for (const k of ['min', 'max', 'have']) if (Number.isInteger(d[k])) o[k] = d[k];
    return o;
  }
  if (e && e.name === 'MoneyError') {
    if (isFence(e)) return { message: 'Money service is unavailable', code: 'money_down' };
    if (e.code === 'insufficient') return { message: 'Not enough funds', code: 'bank' };
    if (e.code === 'fund_mismatch') return { message: 'Use the same funds as your seat', code: 'fund_mismatch' };
    if (e.code === 'bad_amount') return { message: 'Invalid amount', code: 'range' };
    return null;
  }
  if (e && e.name === 'ValidationError') return { message: e.message, code: e.code || 'bad_request', ...(e.details || {}) };
  return null;
}

function createSafe({ registry, log }) {
  const say = log || ((...a) => console.error(...a));
  const line = (label, t, e) => `[v2] ${label} table=${t ? t.id : '-'} hand=${t ? t.handNo : '-'} phase=${t ? t.phase : '-'} ${e && (e.code || e.name)}: ${e && e.message}`;

  // A bug somewhere in a table: log, void the hand when it is not committed, pause on a money fence.
  function onError(err, where, table) {
    say(line(where, table, err)); if (err && err.stack) say(err.stack);
    if (isFence(err)) { say('[v2] MONEY FENCED'); try { registry.pauseAll(); } catch (e) { say('[v2] pauseAll failed:', e && e.message); } return; }
    if (table && !(err instanceof TableError)) { try { if (table.void(where, err)) say('[v2] VOID ' + table.id); } catch (e) { say('[v2] void failed:', e && e.message); } }
  }

  // Wraps one client->server handler. The payload is always an object.
  function onEvent(socket, ev, fn) {
    socket.on(ev, (payload, ...rest) => {
      const p = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
      try { fn(p, ...rest); }
      catch (e) {
        const w = wireOf(e);
        if (w) { socket.emit('error', w); if (isFence(e)) onError(e, 'event:' + ev, null); return; }
        const acct = socket.data && socket.data.acct;
        const seat = acct ? registry.seatOf(acct) : null;
        onError(e, 'event:' + ev, seat ? registry.tables.get(seat.tableId) : null);
        socket.emit('error', { message: 'Server error', code: 'internal' });
      }
    });
  }

  function installProcessHandlers() {
    process.on('uncaughtException', e => { say('[v2] uncaughtException:', e && e.stack || e); try { registry.voidAll('uncaught'); } catch {} });
    process.on('unhandledRejection', e => { say('[v2] unhandledRejection:', e && e.stack || e); try { registry.voidAll('uncaught'); } catch {} });
  }

  return { onEvent, onError, wireOf, installProcessHandlers };
}

module.exports = { createSafe, wireOf, RULE_MESSAGES };
