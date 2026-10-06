'use strict';
// tables/table.js, seats and deadlines only (no hands): fake clock, real money.open() on a temp file.
const fs = require('fs');
const path = require('path');
const { open } = require('../../money/ledger');
const { createService } = require('../../money/service');
const { createMoneyPort } = require('../../tables/money-port');
const { Table } = require('../../tables/table');
const { validateSettings } = require('../../tables/settings');
const { TableError } = require('../../tables/errors');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'eq') + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); };
const ok = (c, m) => { if (!c) throw new Error(m || 'not ok'); };
function code(fn) { try { fn(); } catch (e) { if (e instanceof TableError) return e.code; throw e; } return 'none'; }

const dir = fs.mkdtempSync(path.join(path.join(__dirname, '..', '..', 'tables', 'runs'), 'seats-'));
let n = 0;
const KEYS = ['ann', 'bob', 'cy', 'dee'];

function fakeClock() {
  let now = 1000000, id = 0; const timers = new Map();
  return {
    now: () => now,
    setTimeout: (fn, ms) => { const h = ++id; timers.set(h, { at: now + ms, fn }); return h; },
    clearTimeout: h => { timers.delete(h); },
    pending: () => timers.size,
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let best = null;
        for (const [h, x] of timers) if (x.at <= end && (!best || x.at < best[1].at)) best = [h, x];
        if (!best) break;
        timers.delete(best[0]); now = Math.max(now, best[1].at); best[1].fn();
      }
      now = end;
    },
  };
}

function env(over, recOver) {
  const ledger = open(path.join(dir, 'm' + (++n) + '.jsonl'), { fsync: 'none', log: () => {} });
  const service = createService(ledger);
  const events = [];
  const port = createMoneyPort({ service, ledger, bootId: 'bt' });
  for (const k of KEYS) service.ensureAccount(k);
  const v = validateSettings({ name: 'Test table', mode: 'chips', buyIn: { min: 500, max: 5000, default: 2000 }, blinds: { sb: 25, bb: 50 }, seats: 4, ...(over || {}) });
  if (!v.ok) throw new Error('settings ' + JSON.stringify(v));
  const clock = fakeClock();
  const others = new Map();
  const rec = { id: 'T1', hostKey: 'ann', permanent: false, nightFromId: 0, ...v.value, ...(recOver || {}) };
  const table = new Table(rec, {
    money: port, clock, out: { state() { events.push(['state']); }, event(tb, kind, data, to) { events.push([kind, data, to]); } },
    hooks: { seatOf: key => others.get(key) || null, profileOf: key => ({ display: key.toUpperCase() }) },
  });
  return { ledger, service, port, table, clock, events, others, kinds: () => events.map(e => e[0]) };
}
const drift = e => { const s = [...e.table.seats.values()].map(x => ({ key: x.key, stack: x.stack, handBet: 0 })); return e.port.drift(e.table, s); };
const bank = (e, k) => e.ledger.balance('bank:' + k, 'chips');

t('sit takes the lowest free seat, money first, seat mirrors the ledger', () => {
  const e = env(); const a = e.table.sit('ann', { amount: 2000, socketId: 's1' }), b = e.table.sit('bob', { amount: 1000, socketId: 's2' });
  eq([a.seat, b.seat], [0, 1]); eq(bank(e, 'ann'), 8000); eq(e.port.seatBalance(e.table, 'ann'), 2000); eq(drift(e), []);
  eq(e.table.players().map(s => s.key), ['ann', 'bob']); eq(e.table.denseIndex('bob'), 1);
});
t('given seat is honoured when free, seat_taken when not, table_full when none', () => {
  const e = env(); const c = e.table.sit('cy', { amount: 600, seat: 3, socketId: 'c' }); eq(c.seat, 3);
  eq(code(() => e.table.sit('ann', { amount: 600, seat: 3, socketId: 'a' })), 'seat_taken');
  e.table.sit('ann', { amount: 600, socketId: 'a' }); e.table.sit('bob', { amount: 600, socketId: 'b' }); e.table.sit('dee', { amount: 600, socketId: 'd' });
  const f = env({ seats: 2 }); f.table.sit('ann', { amount: 600, socketId: 'a' }); f.table.sit('bob', { amount: 600, socketId: 'b' });
  eq(code(() => f.table.sit('cy', { amount: 600, socketId: 'c' })), 'table_full');
});
t('buy-in range and fund are validated, nothing written on rejection', () => {
  const e = env(); const before = e.ledger.lastId;
  for (const amt of [499, 5001, 1.5, -1, '1000', undefined]) eq(code(() => e.table.sit('ann', { amount: amt, socketId: 's' })), 'range');
  eq(code(() => e.table.sit('ann', { amount: 1000, fund: 'gold', socketId: 's' })), 'bad_request');
  eq(e.ledger.lastId, before); eq(e.table.seats.size, 0);
});
t('one seat per account across tables (hook), bank insufficient maps to bank', () => {
  const e = env(); e.others.set('ann', { tableId: 'T9' });
  const x = (() => { try { e.table.sit('ann', { amount: 600, socketId: 's' }); } catch (er) { return er; } })();
  eq(x.code, 'one_seat'); eq(x.details.tableId, 'T9');
  const y = env({ buyIn: { min: 500, max: 50000, default: 2000 } }); y.table.sit('bob', { amount: 9000, socketId: 'b' });
  const z = (() => { try { y.table.sit('cy', { amount: 20000, socketId: 'c' }); } catch (er) { return er; } })();
  eq(z.code, 'bank'); eq(z.details.fund, 'chips'); eq(y.table.seats.size, 1);
});
t('sitting twice is a reconnect: stack unchanged, request amount ignored', () => {
  const e = env(); e.table.sit('ann', { amount: 2000, socketId: 's1' });
  const s = e.table.sit('ann', { amount: 4000, socketId: 's2' });
  eq(s.stack, 2000); eq(s.socketId, 's2'); eq(bank(e, 'ann'), 8000);
  ok(e.events.some(x => x[0] === 'taken_over' && x[1].socketId === 's1'), 'old socket told');
});
t('play fund on a chips table keeps the fund; mixing funds while stack > 0 is fund_mismatch', () => {
  const e = env(); const s = e.table.sit('ann', { amount: 1000, fund: 'play', socketId: 's' }); eq(s.fund, 'play');
  eq(e.port.seatFund(e.table, 'ann'), 'play'); eq(e.ledger.balance('play:ann', 'play') < e.ledger.balance('play:bob', 'play'), true);
  eq(code(() => e.table.rebuy('ann', { amount: 600, fund: 'chips' })), 'have_chips');
});
t('rebuy: only at stack 0, honours rebuys off and the limit, default amount', () => {
  const e = env({ rebuyLimit: 1 }); const s = e.table.sit('ann', { amount: 1000, socketId: 'a' });
  eq(code(() => e.table.rebuy('ann', {})), 'have_chips');
  e.port.cashOut(e.table, 'ann', 1000, 'leave'); s.stack = 0;
  e.table.rebuy('ann', {}); eq(s.stack, 2000); eq(drift(e), []);
  e.port.cashOut(e.table, 'ann', 2000, 'leave'); s.stack = 0;
  eq(code(() => e.table.rebuy('ann', { amount: 600 })), 'rebuy_off');
  const f = env({ rebuys: false }); f.table.sit('bob', { amount: 1000, socketId: 'b' });
  const sb = f.table.seatOfKey('bob'); f.port.cashOut(f.table, 'bob', 1000, 'leave'); sb.stack = 0;
  eq(code(() => f.table.rebuy('bob', {})), 'rebuy_off');
  eq(code(() => f.table.rebuy('nobody', {})), 'no_seat');
});
t('buy-in count survives a rebuilt table (read from the ledger)', () => {
  const e = env({ rebuyLimit: 1 }); const s = e.table.sit('ann', { amount: 1000, socketId: 'a' });
  e.port.cashOut(e.table, 'ann', 1000, 'leave'); s.stack = 0; e.table.rebuy('ann', { amount: 600 });
  eq(e.port.buyInCount(e.table, 'ann', 0), 2); eq(e.table.buyInAllowed('ann'), false);
});
t('sit out toggles at stack > 0 and clears timeouts; ignored at 0', () => {
  const e = env(); const s = e.table.sit('ann', { amount: 1000, socketId: 'a' }); s.timeouts = 2;
  eq(e.table.sitOut('ann'), true); eq(s.timeouts, 0); eq(e.table.sitOut('ann'), false);
  s.stack = 0; eq(e.table.sitOut('ann'), false); eq(code(() => e.table.sitOut('zed')), 'no_seat');
});
t('leave cashes the whole seat out to the owner and frees the seat', () => {
  const e = env(); e.table.sit('ann', { amount: 2000, socketId: 'a' });
  const r = e.table.leave('ann'); eq(r, { cashedOut: 2000, left: true });
  eq(bank(e, 'ann'), 10000); eq(e.table.seats.size, 0); eq(e.ledger.balance('seat:T1:ann', 'chips'), 0);
  eq(e.table.leave('ann'), { cashedOut: 0, left: false });
  ok(e.events.some(x => x[0] === 'left' && x[2] === 'ann'));
});
t('kick: host or admin only, never the host, target must be seated', () => {
  const e = env(); e.table.sit('ann', { amount: 1000, socketId: 'a' }); e.table.sit('bob', { amount: 1000, socketId: 'b' });
  eq(code(() => e.table.kick('bob', 'ann')), 'not_host'); eq(code(() => e.table.kick('ann', 'ann')), 'forbidden');
  eq(code(() => e.table.kick('ann', 'zed')), 'no_seat');
  e.table.kick('ann', 'bob'); eq(e.table.seatOfKey('bob'), null); eq(bank(e, 'bob'), 10000);
  const l = e.events.find(x => x[0] === 'left' && x[2] === 'bob'); eq(l[1].reason, 'kicked');
  ok(e.events.some(x => x[0] === 'table_event' && x[1].kind === 'kicked' && x[1].display === 'BOB'));
  e.table.sit('cy', { amount: 600, socketId: 'c' }); e.table.kick('dee', 'cy', true); eq(e.table.seatOfKey('cy'), null);
});
t('disconnect keeps the seat and the stack; grace expiry cashes out after the hand-free wait', () => {
  const e = env(); e.table.sit('ann', { amount: 2000, socketId: 'a' }); e.table.sit('bob', { amount: 1000, socketId: 'b' });
  const s = e.table.disconnect('b'); eq(s.connected, false); eq(s.stack, 1000); eq(e.port.seatBalance(e.table, 'bob'), 1000);
  e.clock.advance(119000); ok(e.table.seatOfKey('bob'), 'still seated at 119 s');
  e.clock.advance(2000); eq(e.table.seatOfKey('bob'), null); eq(bank(e, 'bob'), 10000); eq(e.clock.pending(), 0);
  eq(e.table.disconnect('nope'), null);
});
t('reconnect before grace keeps the seat and clears the deadline', () => {
  const e = env(); e.table.sit('ann', { amount: 2000, socketId: 'a' }); e.table.disconnect('a');
  e.clock.advance(60000); const s = e.table.sit('ann', { socketId: 'a2' });
  eq([s.connected, s.socketId, s.graceAt], [true, 'a2', null]); e.clock.advance(200000); ok(e.table.seatOfKey('ann'));
  eq(e.table.hasDeadline('grace:0'), false);
});
t('disconnected seat is not eligible; reconnect makes it eligible again', () => {
  const e = env(); e.table.sit('ann', { amount: 2000, socketId: 'a' }); e.table.sit('bob', { amount: 2000, socketId: 'b' });
  eq(e.table.eligible().length, 2); e.table.disconnect('b'); eq(e.table.eligible().length, 1);
  e.table.sit('bob', { socketId: 'b2' }); eq(e.table.eligible().length, 2);
});
t('host disconnect: host moves to the first connected seat after the grace; reconnect cancels', () => {
  const e = env(); e.table.sit('ann', { amount: 1000, socketId: 'a' }); e.table.sit('bob', { amount: 1000, socketId: 'b' });
  e.table.disconnect('a'); e.table.sit('ann', { socketId: 'a2' }); e.clock.advance(60000); eq(e.table.hostKey, 'ann');
  e.table.disconnect('a2'); e.clock.advance(21000); eq(e.table.hostKey, 'bob');
  ok(e.events.some(x => x[0] === 'table_event' && x[1].kind === 'host' && x[1].key === 'bob'));
});
t('autostart deadline: set with two eligible seats, cleared when one leaves, one real timer', () => {
  const e = env(); e.table.sit('ann', { amount: 1000, socketId: 'a' }); eq(e.table.hasDeadline('phase'), false);
  e.table.sit('bob', { amount: 1000, socketId: 'b' }); eq(e.table.hasDeadline('phase'), true); eq(e.clock.pending(), 1);
  e.table.leave('bob'); eq(e.table.hasDeadline('phase'), false); eq(e.clock.pending(), 0);
  const m = env({ autoStart: false }); m.table.sit('ann', { amount: 1000, socketId: 'a' }); m.table.sit('bob', { amount: 1000, socketId: 'b' });
  eq(m.table.hasDeadline('phase'), false);
});
t('pause freezes the autostart deadline and grace keeps running; resume re-arms the remainder', () => {
  const e = env(); e.table.sit('ann', { amount: 1000, socketId: 'a' }); e.table.sit('bob', { amount: 1000, socketId: 'b' });
  e.clock.advance(500); e.table.pause(); eq(e.table.paused, true); eq(e.table.state, 'paused');
  const d = e.table.deadlines.get('phase'); eq([d.at, d.frozen], [null, 1500]);
  e.clock.advance(60000); ok(e.table.hasDeadline('phase'), 'frozen deadline did not fire');
  e.table.disconnect('b'); e.clock.advance(125000); eq(e.table.seatOfKey('bob'), null, 'grace ran while paused');
  eq(code(() => e.table.sit('cy', { amount: 600, socketId: 'c' })), 'none'); e.table.resume();
  eq(e.table.paused, false); eq(e.table.state, 'open');
});
t('resume re-arms a frozen deadline at now + remaining', () => {
  const e = env(); e.table.sit('ann', { amount: 1000, socketId: 'a' }); e.table.sit('bob', { amount: 1000, socketId: 'b' });
  e.clock.advance(500); e.table.pause(); e.clock.advance(10000); const t0 = e.clock.now(); e.table.resume();
  eq(e.table.deadlines.get('phase').at, t0 + 1500);
});
t('a paused table still accepts sits and leaves', () => {
  const e = env(); e.table.pause(); e.table.sit('ann', { amount: 1000, socketId: 'a' }); e.table.sit('bob', { amount: 1000, socketId: 'b' });
  eq(e.table.hasDeadline('phase'), false); eq(e.table.leave('bob').left, true);
});
t('sit at an ended table is rejected', () => {
  const e = env({}, { state: 'ended' }); eq(e.table.phase, 'ended'); eq(code(() => e.table.sit('ann', { amount: 600, socketId: 'a' })), 'ended');
});
t('tick re-arms after a deadline throws; the error goes to onError', () => {
  const e = env(); const errs = []; e.table.onError = (er, where) => errs.push(where);
  e.table.fire = d => { if (d.kind === 'boom') throw new Error('x'); };
  e.table.setDeadline('a', 'boom', 100); e.table.setDeadline('b', 'later', 5000);
  e.clock.advance(200); eq(errs, ['deadline:boom']); eq(e.clock.pending(), 1); eq(e.table.hasDeadline('b'), true);
  e.table.onError = null; e.table.setDeadline('c', 'boom', 10);
  let thrown = null; try { e.clock.advance(20); } catch (er) { thrown = er; }
  ok(thrown, 'no onError rethrows'); eq(e.clock.pending(), 1);
});
t('deadlines of one table share ONE real timer handle', () => {
  const e = env(); e.table.sit('ann', { amount: 1000, socketId: 'a' }); e.table.sit('bob', { amount: 1000, socketId: 'b' });
  e.table.disconnect('b'); e.table.disconnect('a'); e.table.setDeadline('extra', 'x', 777); ok(e.table.deadlines.size >= 3); eq(e.clock.pending(), 1);
});
t('drift check stays clean after a mixed sequence', () => {
  const e = env(); e.table.sit('ann', { amount: 2000, socketId: 'a' }); e.table.sit('bob', { amount: 700, socketId: 'b', seat: 2 }); e.table.sit('cy', { amount: 5000, socketId: 'c' });
  e.table.leave('bob'); e.table.disconnect('c'); e.clock.advance(130000); eq(drift(e), []); const c = e.ledger.check(); ok(c.chips.ok && c.play.ok);
});

console.log(`tables-seats.js: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
