'use strict';
// Error containment (contract section 8). Expected errors (TableError, engine RuleError, MoneyError, validation) become a socket
// `error` payload { message, code, ...numbers } and change nothing else. Any other error is a bug: log it and answer `internal`.
// A hand is voided (if it is not committed) ONLY when the error was thrown from inside the hand engine while it mutates a hand
// (engine/*, tables/table.js, tables/hand-flow.js, tables/money-port.js): the void follows where the error came from, never who
// sent the message. A throw in auth_*, profile_*, a lookup, social or any other handler answers `internal` to that socket and leaves
// every table alone (money audit K6-1: a seated player could otherwise void a live Cash hand at will).
// Payloads carrying a function-shaped key (toString, valueOf, ...) are refused before any handler runs: JSON cannot make a function,
// so such a key only exists to make a String() / Number() / template-string conversion throw.
// The process never exits on a handler, timer or promise error.

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

// Where an error was thrown from: any frame inside the hand engine / table layer that mutates a hand. tables/registry.js (lookups),
// tables/settings.js (pure validation) and everything outside engine/ and tables/ are not hand mutations.
const path = require('path');
const ROOT = path.resolve(__dirname, '..').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SEP = '[\\\\/]';
const HAND_FRAME = new RegExp(ROOT + SEP + '(?:engine' + SEP + '[^\\\\/\\s)]+|tables' + SEP + '(?:table|hand-flow|money-port))\\.js\\b');
const fromHandEngine = e => !!e && typeof e.stack === 'string' && e.stack.split('\n').some(l => HAND_FRAME.test(l));

// Keys that only a hostile client sends: a non-callable own `toString` / `valueOf` / `toJSON` makes every implicit conversion throw.
const HOSTILE_KEY = new Set(['toString', 'valueOf', 'toJSON', 'toLocaleString', 'constructor', '__proto__', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__', 'hasOwnProperty']);
const MAX_DEPTH = 12, MAX_NODES = 5000;
function hostile(v) {
  let nodes = 0;
  const walk = (x, d) => {
    if (x === null || typeof x !== 'object') return false;
    if (d > MAX_DEPTH || ++nodes > MAX_NODES) return true;
    if (Buffer.isBuffer(x) || x instanceof ArrayBuffer || ArrayBuffer.isView(x)) return false;
    if (Array.isArray(x)) { for (const y of x) if (walk(y, d + 1)) return true; return false; }
    for (const k of Reflect.ownKeys(x)) { if (typeof k !== 'string' || HOSTILE_KEY.has(k)) return true; if (walk(x[k], d + 1)) return true; }
    return false;
  };
  return walk(v, 0);
}

function createSafe({ registry, log }) {
  const say = log || ((...a) => console.error(...a));
  if (Error.stackTraceLimit < 60) Error.stackTraceLimit = 60;        // fromHandEngine reads the whole stack, not the first 10 frames
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
      if (hostile(payload)) { socket.emit('error', { message: 'Bad request', code: 'bad_request' }); return; }
      const p = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
      try { fn(p, ...rest); }
      catch (e) {
        const w = wireOf(e);
        if (w) { socket.emit('error', w); if (isFence(e)) onError(e, 'event:' + ev, null); return; }
        // Void only when the throw came out of the hand engine; then the table is the one the message named, else the sender's own seat.
        let t = null;
        if (fromHandEngine(e)) {
          const named = typeof p.roomId === 'string' ? p.roomId : typeof p.tableId === 'string' ? p.tableId : null;
          t = named ? registry.tables.get(named) || null : null;
          if (!t) { const acct = socket.data && socket.data.acct; const seat = acct ? registry.seatOf(acct) : null; t = seat ? registry.tables.get(seat.tableId) : null; }
        }
        onError(e, 'event:' + ev, t);
        socket.emit('error', { message: 'Server error', code: 'internal' });
      }
    });
  }

  function installProcessHandlers() {
    // Every table is voided only when the error came out of the hand engine; any other stray error is logged and touches no hand.
    process.on('uncaughtException', e => { say('[v2] uncaughtException:', e && e.stack || e); if (fromHandEngine(e)) try { registry.voidAll('uncaught'); } catch {} });
    process.on('unhandledRejection', e => { say('[v2] unhandledRejection:', e && e.stack || e); if (fromHandEngine(e)) try { registry.voidAll('uncaught'); } catch {} });
  }

  return { onEvent, onError, wireOf, installProcessHandlers };
}

module.exports = { createSafe, wireOf, RULE_MESSAGES, fromHandEngine, hostile };
