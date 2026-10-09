'use strict';
// node tests/money-1008-voidthrow.js   (K6-1; no server, no network: transport/safe.js against a fake socket and fake tables)
// Rule under test: a hand is voided only when the error was thrown from INSIDE the hand engine (engine/*, tables/table.js,
// tables/hand-flow.js); never because of WHO sent the message. A throw in any other handler (auth_*, profile_*, lookups, social)
// answers `internal` to that socket and leaves every table alone. Payloads that carry a function-shaped key (toString, valueOf...)
// never reach a handler at all.
const assert = require('assert');
const { createSafe } = require('../transport/safe');
const engine = require('../engine/hand');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('ok   ' + name); } catch (e) { fail++; console.error('FAIL ' + name + '\n' + (e.stack || e)); process.exitCode = 1; } }

function world() {
  const voids = [], logs = [];
  const mk = id => ({ id, handNo: 1, phase: 'betting', void(reason, err) { voids.push({ id, reason }); return true; } });
  const tables = new Map([['T1', mk('T1')], ['T2', mk('T2')]]);
  const registry = { tables, seatOf: k => (k === 'att' || k === 'vic' ? { tableId: 'T1' } : null), pauseAll() { logs.push('pauseAll'); }, voidAll(r) { voids.push({ id: '*', reason: r }); return 1; } };
  const safe = createSafe({ registry, log: (...a) => logs.push(a.join(' ')) });
  const handlers = {}, emitted = [];
  const socket = { data: { acct: 'att' }, on(ev, fn) { handlers[ev] = fn; }, emit(ev, p) { emitted.push([ev, p]); } };
  return { safe, voids, logs, tables, handlers, emitted, socket, send: (ev, p) => handlers[ev](p) };
}

// a TypeError born in accounts.js cleanName: String({toString:1})
const notEngine = () => String({ toString: 1 });
// a TypeError born inside the hand engine (engine/hand.js is on the stack)
const inEngine = () => engine.apply(null, null, null);

test('a throw in a non-table handler (auth_login) does not void the sender\'s live hand', () => {
  const w = world();
  w.safe.onEvent(w.socket, 'auth_login', () => { notEngine(); });
  w.send('auth_login', { name: 'x' });
  assert.deepStrictEqual(w.voids, [], 'a hand was voided: ' + JSON.stringify(w.voids.map(v => v.reason)));
  assert.deepStrictEqual(w.emitted, [['error', { message: 'Server error', code: 'internal' }]]);
});

test('every non-table event name is safe (profile_update, table_preview, table_clone, lobby_list, chat_message ...)', () => {
  const w = world();
  for (const ev of ['profile_update', 'table_preview', 'table_clone', 'lobby_list', 'tables_mine', 'chat_message', 'emote', 'get_bank_summary', 'pin_change', 'auth_resume', 'admin_overview']) {
    w.safe.onEvent(w.socket, ev, () => { notEngine(); });
    w.send(ev, { tableId: 'T1', roomId: 'T1' });
  }
  assert.deepStrictEqual(w.voids, []);
});

test('a throw from inside the hand engine still voids the table the message named', () => {
  const w = world();
  w.safe.onEvent(w.socket, 'player_action', () => { inEngine(); });
  w.send('player_action', { roomId: 'T2', action: 'call' });
  assert.deepStrictEqual(w.voids.map(v => v.id), ['T2'], 'expected exactly T2 voided, got ' + JSON.stringify(w.voids.map(v => v.id)));
  assert.strictEqual(w.emitted[0][1].code, 'internal');
});

test('an engine throw with no table named voids the sender\'s own table (his seat)', () => {
  const w = world();
  w.safe.onEvent(w.socket, 'show_cards', () => { inEngine(); });
  w.send('show_cards', {});
  assert.deepStrictEqual(w.voids.map(v => v.id), ['T1']);
});

test('a lookup that throws in the registry (String(id)) is not an engine throw', () => {
  const w = world();
  w.safe.onEvent(w.socket, 'player_action', () => { String({ toString: 1 }); });
  w.send('player_action', { roomId: 'T1' });
  assert.deepStrictEqual(w.voids, []);
});

test('TableError / RuleError / MoneyError stay plain error answers and void nothing', () => {
  const w = world();
  const { TableError } = require('../tables/errors');
  w.safe.onEvent(w.socket, 'a', () => { throw new TableError('not_found'); });
  try { w.send('a', {}); } catch {}
  assert.deepStrictEqual(w.voids, []);
  assert.strictEqual(w.emitted[0][0], 'error');
});

test('a payload with a function-shaped key never reaches the handler (top level and nested)', () => {
  const w = world(); let ran = 0;
  w.safe.onEvent(w.socket, 'auth_login', () => { ran++; });
  const bad = [
    JSON.parse('{"name":{"toString":1}}'), JSON.parse('{"toString":1}'), JSON.parse('{"a":{"b":[{"valueOf":1}]}}'), JSON.parse('{"x":{"toJSON":"no"}}'),
    JSON.parse('{"__proto__":{"a":1}}'), JSON.parse('{"settings":{"constructor":{"prototype":1}}}'),
  ];
  for (const p of bad) w.send('auth_login', p);
  assert.strictEqual(ran, 0, 'handler ran for a hostile payload');
  assert.strictEqual(w.emitted.length, bad.length);
  assert.ok(w.emitted.every(e => e[0] === 'error' && e[1].code === 'bad_request'), JSON.stringify(w.emitted[0]));
  assert.deepStrictEqual(w.voids, []);
});

test('ordinary payloads (including deep settings objects, arrays, null, numbers) still reach the handler untouched', () => {
  const w = world(); const seen = [];
  w.safe.onEvent(w.socket, 'table_create', p => { seen.push(p); });
  const ok = [{ settings: { name: 'ok', blindIncrease: { enabled: true, everyMin: 5, schedule: [[1, 2], [3, 4]] }, buyIn: { min: 1, max: 2, default: 1 } } }, {}, undefined, 'str', 7, [1, 2], null];
  for (const p of ok) w.send('table_create', p);
  assert.strictEqual(seen.length, ok.length);
  assert.deepStrictEqual(seen[0], ok[0]);
  assert.deepStrictEqual(seen[2], {});   // non-object payloads become {} as before
  assert.deepStrictEqual(w.emitted, []);
});

test('a payload nested absurdly deep is refused, not walked into a stack overflow', () => {
  const w = world(); let ran = 0;
  w.safe.onEvent(w.socket, 'x', () => { ran++; });
  let o = {}; const root = o; for (let i = 0; i < 5000; i++) { o.a = {}; o = o.a; }
  w.send('x', root);
  assert.strictEqual(ran, 0); assert.strictEqual(w.emitted[0][1].code, 'bad_request');
});

test('a timer / disconnect error (onError with the table) still voids that table: the engine-origin path is kept', () => {
  const w = world();
  w.safe.onError(new Error('boom'), 'deadline:turn', w.tables.get('T2'));
  assert.deepStrictEqual(w.voids.map(v => v.id), ['T2']);
});

test('a money fence still pauses all tables and voids nothing', () => {
  const w = world(); const { FENCE_CODES } = require('../tables/errors');
  const e = Object.assign(new Error('fenced'), { name: 'MoneyError', code: [...FENCE_CODES][0] });
  w.safe.onError(e, 'x', w.tables.get('T1'));
  assert.ok(w.logs.includes('pauseAll'), 'pauseAll not called');
  assert.deepStrictEqual(w.voids, []);
});

test('uncaughtException / unhandledRejection from non-engine code do not void every table; engine-origin ones still do', () => {
  const w = world();
  const before = process.listeners('uncaughtException').slice(), beforeR = process.listeners('unhandledRejection').slice();
  w.safe.installProcessHandlers();
  const ours = process.listeners('uncaughtException').filter(f => !before.includes(f)), oursR = process.listeners('unhandledRejection').filter(f => !beforeR.includes(f));
  try {
    for (const f of [...ours, ...oursR]) f(new TypeError('not from the engine'));
    assert.deepStrictEqual(w.voids, [], 'voidAll ran for a non-engine uncaught error');
    for (const f of [...ours, ...oursR]) f((() => { try { inEngine(); } catch (e) { return e; } })());
    assert.strictEqual(w.voids.length, ours.length + oursR.length, 'engine-origin uncaught must still voidAll');
  } finally {
    for (const f of ours) process.removeListener('uncaughtException', f);
    for (const f of oursR) process.removeListener('unhandledRejection', f);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
