'use strict';
// Expected errors of the table layer. transport/safe.js turns these (and RuleError, MoneyError) into
// socket 'error' payloads { message, code, ...numbers }. `message` is a fixed sentence: never a digit or a '$' (tests/v2/27_errors.js).

const MESSAGES = {
  auth: 'Sign in first', forbidden: 'Not allowed', not_found: 'No such table', ended: 'That table has ended', permanent: 'That table cannot be ended',
  one_seat: 'You already have a seat at a table', range: 'Amount is out of range', bank: 'Not enough funds', fund_mismatch: 'Use the same funds as your seat',
  rebuy_off: 'No more buy-ins at this table', in_hand: 'You are still in the hand', have_chips: 'You still have chips', no_seat: 'You are not seated',
  table_full: 'The table is full', seat_taken: 'That seat is taken', not_host: 'Only the host can do that', bad_request: 'Bad request',
  preselect: 'Pre-select not accepted', taken_over: 'Your seat was taken over by another session', money_down: 'Money service is unavailable',
  hand_void: 'Hand voided', not_enough_players: 'Not enough players', hand_live: 'A hand is in progress', max_tables: 'Too many open tables',
  rejected: 'Request rejected', internal: 'Server error', insufficient: 'Not enough funds',
};

class TableError extends Error {
  constructor(code, details, message) {
    super(message || MESSAGES[code] || 'Request rejected');
    this.name = 'TableError';
    this.code = code;
    this.details = details || {};
  }
  // The wire form: numbers ride in keys, never in the message.
  toWire() { return { message: this.message, code: this.code, ...this.details }; }
}

// Money failures that mean "the ledger is unusable": pause tables, refuse sits, never exit (contract section 8).
const FENCE_CODES = new Set(['lost_lock', 'foreign_write', 'write_failed', 'closed']);
const isFence = e => !!e && e.name === 'MoneyError' && FENCE_CODES.has(e.code);

module.exports = { TableError, MESSAGES, FENCE_CODES, isFence };
