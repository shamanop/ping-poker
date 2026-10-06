'use strict';
// tables/registry.js: create/load/save, POKERPING, one seat per account, lobby, nights, sweep. Real money on temp files, fake clock.
const fs = require('fs');
const path = require('path');
const { open } = require('../../money/ledger');
const { createService } = require('../../money/service');
const { createMoneyPort } = require('../../tables/money-port');
const { createRegistry } = require('../../tables/registry');
const { rigDeck } = require('./engine-lib');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'eq') + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); };
const ok = (c, m) => { if (!c) throw new Error(m || 'not ok'); };
const code = fn => { try { fn(); } catch (e) { return e.code || e.message; } return 'none'; };

fs.mkdirSync(path.join(__dirname, '..', '..', 'tables', 'runs'), { recursive: true }); // gitignored scratch dir, absent in a fresh checkout
const dir = fs.mkdtempSync(path.join(__dirname, '..', '..', 'tables', 'runs', 'reg-'));
let n = 0;
const KEYS = ['ann', 'bob', 'cy', 'chris'];
function fakeClock() {
  let now = 1700000000000, id = 0; const timers = new Map();
  return { now: () => now, pending: () => timers.size,
    setTimeout: (fn, ms) => { const h = ++id; timers.set(h, { at: now + ms, fn }); return h; }, clearTimeout: h => { timers.delete(h); },
    advance(ms) { const end = now + ms; for (;;) { let b = null; for (const [h, x] of timers) if (x.at <= end && (!b || x.at < b[1].at)) b = [h, x]; if (!b) break; timers.delete(b[0]); now = Math.max(now, b[1].at); b[1].fn(); } now = end; } };
}
const SET = over => ({ name: 'Friday', mode: 'chips', buyIn: { min: 100, max: 50000, default: 2000 }, blinds: { sb: 25, bb: 50 }, seats: 6, ...(over || {}) });

function env(opts) {
  opts = opts || {};
  const mfile = opts.mfile || path.join(dir, 'm' + (++n) + '.jsonl'), tfile = opts.tfile || path.join(dir, 't' + n + '.json');
  const ledger = open(mfile, { fsync: 'none', log: () => {} });
  const service = createService(ledger);
  const port = createMoneyPort({ service, ledger, bootId: 'bt' });
  for (const k of KEYS) service.ensureAccount(k);
  const clock = opts.clock || fakeClock(), events = [], decks = []; let lobby = 0;
  const reg = createRegistry({ deckSource: () => decks.shift() || null, money: port, service, ledger, clock, file: tfile, onLobby: () => { lobby++; },
    out: { state() {}, event(tb, kind, data, to) { events.push([tb.id, kind, to]); } },
    hooks: { profileOf: k => ({ display: k.toUpperCase(), avatar: 'a1', pic: null }), isAdmin: k => k === 'chris' } });
  return { decks, ledger, service, port, reg, clock, events, mfile, tfile, lobby: () => lobby };
}
const bank = (e, k) => e.ledger.balance('bank:' + k, 'chips');

t('load creates POKERPING as an ordinary permanent table', () => {
  const e = env(); e.reg.load(); const p = e.reg.get('POKERPING');
  eq([p.permanent, p.hostKey, p.name, p.maxSeats, p.autoStart, p.isPrivate, p.actionTimerSec, p.nightId, p.rebuyLimit], [true, 'chris', 'The Ping', 8, true, false, 30, null, 0]);
  eq([p.blinds, p.buyIn], [{ sb: 25, bb: 50 }, { min: 500, max: 1000000, default: 2000 }]); eq(p.blindIncrease.enabled, false);
  let c = code(() => p.endNight('host')); eq(c, 'permanent');
});
t('create validates, mints a 6-char code without I/O, a night id and the ledger start', () => {
  const e = env(); e.reg.load(); const tb = e.reg.create('ann', SET());
  ok(/^[A-HJ-NP-Z2-9]{6}$/.test(tb.id), tb.id); ok(/^n_\d{8}_/.test(tb.nightId), tb.nightId); eq(tb.nightFromId, e.ledger.lastId); eq(tb.hostKey, 'ann'); eq(tb.state, 'open');
  eq(e.reg.get(tb.id.toLowerCase()), tb);
  eq(code(() => e.reg.create('ann', SET({ seats: 9 }))), 'range'); eq(code(() => e.reg.create('ann', SET({ name: 'x' }))), 'range');
  eq(code(() => e.reg.create('ann', SET({ mode: 'friends' }))), 'bad_request');
  const err = (() => { try { e.reg.create('ann', SET({ buyIn: { min: 10, max: 1000, default: 100 } })); } catch (er) { return er; } })(); eq([err.code, err.details.field], ['range', 'buyIn.min']); ok(!/\d|\$/.test(err.message), err.message);
});
t('max 5 open tables per host; an ended one frees a slot', () => {
  const e = env(); e.reg.load(); const made = []; for (let i = 0; i < 5; i++) made.push(e.reg.create('ann', SET({ name: 'T ' + 'abcde'[i] })));
  eq(code(() => e.reg.create('ann', SET())), 'max_tables'); e.reg.create('bob', SET());
  made[0].endNight('host'); e.reg.create('ann', SET());
});
t('one seat per account across tables; lookup by key', () => {
  const e = env(); e.reg.load(); const a = e.reg.create('ann', SET()), b = e.reg.create('bob', SET({ name: 'Other' }));
  a.sit('cy', { amount: 1000, socketId: 'c1' }); eq(e.reg.seatOf('cy'), { tableId: a.id, seat: 0 });
  eq(code(() => b.sit('cy', { amount: 1000, socketId: 'c2' })), 'one_seat'); eq(code(() => e.reg.get('POKERPING').sit('cy', { amount: 1000, socketId: 'c3' })), 'one_seat');
  a.leave('cy'); b.sit('cy', { amount: 1000, socketId: 'c2' }); eq(e.reg.seatOf('cy').tableId, b.id);
  eq(e.reg.seatOf('nobody'), null);
});
t('save + load round trip: same ids, settings, hosts; hand numbers continue from the ledger', () => {
  const e = env(); e.reg.load(); const a = e.reg.create('ann', SET({ name: 'Keep', blinds: { sb: 50, bb: 100 }, buyIn: { min: 200, max: 9000, default: 1000 } }));
  a.sit('ann', { amount: 1000, socketId: 's1' }); a.sit('bob', { amount: 1000, socketId: 's2' }); a.startHand(); a.act(a.seats.get(a.hand.toAct).key, { type: 'fold' });
  eq(a.handNo, 1); e.reg.flush();
  const j = JSON.parse(fs.readFileSync(e.tfile, 'utf8')); eq(j.version, 1); eq(j.tables.length, 1); eq(j.legacyBlinds, { sb: 25, bb: 50 }); ok(!j.tables.some(x => x.id === 'POKERPING'));
  const svc = e.service.bootRecover('restart'); eq(svc.errors, []);
  const f = env({ mfile: e.mfile, tfile: e.tfile }); f.reg.load(); const b = f.reg.get(a.id);
  eq([b.name, b.hostKey, b.blinds, b.buyIn, b.maxSeats, b.nightId, b.seats.size], ['Keep', 'ann', { sb: 50, bb: 100 }, { min: 200, max: 9000, default: 1000 }, 6, a.nightId, 0]);
  eq(b.handNo, 1, 'handNo from the ledger'); ok(f.reg.get('POKERPING'));
});
t('POKERPING blinds survive a restart through legacyBlinds', () => {
  const e = env(); e.reg.load(); e.reg.get('POKERPING').blinds = { sb: 100, bb: 200 }; e.reg.flush();
  const f = env({ mfile: e.mfile, tfile: e.tfile }); f.reg.load(); eq(f.reg.get('POKERPING').blinds, { sb: 100, bb: 200 });
});
t('paused and ended states come back; stale ended tables are dropped after 14 days', () => {
  const e = env(); e.reg.load(); const a = e.reg.create('ann', SET({ name: 'Pz' })), b = e.reg.create('bob', SET({ name: 'Done' }));
  a.pause(); b.endNight('host'); e.reg.flush();
  const f = env({ mfile: e.mfile, tfile: e.tfile }); f.reg.load(); eq([f.reg.get(a.id).paused, f.reg.get(a.id).state, f.reg.get(b.id).state, f.reg.get(b.id).phase], [true, 'paused', 'ended', 'ended']);
  const clock = fakeClock(); clock.advance(30 * 86400000);
  const g = env({ mfile: e.mfile, tfile: e.tfile, clock }); g.reg.load(); eq(g.reg.get(b.id), null); ok(g.reg.get(a.id));
});
t('lobby: public tables for everyone, private only for host and seated; ended never listed', () => {
  const e = env(); e.reg.load(); const pub = e.reg.create('ann', SET({ name: 'Pub', isPrivate: false })), prv = e.reg.create('ann', SET({ name: 'Prv', isPrivate: true }));
  const ids = k => e.reg.listFor(k).map(c => c.id).sort();
  eq(ids('bob'), [pub.id, 'POKERPING'].sort()); eq(ids('ann'), [pub.id, prv.id, 'POKERPING'].sort());
  prv.sit('bob', { amount: 1000, socketId: 'b' }); ok(ids('bob').includes(prv.id)); pub.endNight('host'); ok(!ids('ann').includes(pub.id));
  const c = e.reg.card(prv); eq([c.seated, c.host, c.buyIn, c.sb, c.bb, c.state], [1, { key: 'ann', display: 'ANN' }, { min: 100, max: 50000 }, 25, 50, 'open']);
  eq(Object.keys(e.reg.publicTable(prv)).includes('moneyMode'), true);
});
t('mineFor: tables I host, sit at, or played tonight, with the night net', () => {
  const e = env(); e.reg.load(); const a = e.reg.create('ann', SET());
  a.sit('bob', { amount: 1000, socketId: 'b' }); a.sit('cy', { amount: 1000, socketId: 'c' }); a.startHand(); a.void('test');
  eq(e.reg.mineFor('bob').tables.map(x => x.id), [a.id]); eq(e.reg.mineFor('bob').nightNet[a.id], 0);
  a.leave('cy'); eq(e.reg.mineFor('cy').tables.map(x => x.id), [a.id], 'cashed out but played tonight');
  eq(e.reg.mineFor('chris').tables.map(x => x.id), []);
});
t('night payload comes from the money ledger: zero-sum, per-key buy-in/cash-out/net, settle text', () => {
  const e = env(); e.reg.load(); const a = e.reg.create('ann', SET({ name: 'Night' }));
  e.decks.push(rigDeck([['As', 'Ad'], ['Ks', 'Kd']], ['2c', '7d', 'Jh', '3s', '4d']));
  a.sit('ann', { amount: 2000, socketId: 'a' }); a.sit('bob', { amount: 2000, socketId: 'b' });
  const key = x => a.seats.get(a.hand.toAct).key; a.startHand(); a.act(key(), { type: 'raise', to: 2000 }); a.act(key(), { type: 'call' }); e.clock.advance(1500 * 4 + 10);
  const winner = a.players().find(s => s.stack > 0);
  eq(e.reg.netTonight(a, winner.key), 2000); a.endNight('host');
  const p = e.reg.nightPayload(a); eq(p.zeroSum, true); eq(p.ended, true); eq(p.players.map(x => x.net).sort((x, y) => x - y), [-2000, 2000]);
  ok(p.text.includes('Night')); eq(p.players[0].net, 2000); eq(p.players[0].cashedOut, 4000); eq(p.players[0].buyIns, 2000);
  eq([...e.reg.participants(a)].sort(), ['ann', 'bob']);
  eq(bank(e, 'ann') + bank(e, 'bob'), 20000);
});
t('idle sweep: a table with no connected seat ends after TABLE_EMPTY_MS, seats cashed out; permanent never', () => {
  const e = env(); e.reg.load(); const a = e.reg.create('ann', SET({ name: 'Idle' })); a.sit('bob', { amount: 1000, socketId: 'b' });
  e.reg.sweep(); eq(a.state, 'open'); a.disconnect('b'); e.reg.sweep(e.clock.now()); e.reg.sweep(e.clock.now() + 29 * 60000); eq(a.state, 'open', 'not yet');
  e.reg.sweep(e.clock.now() + 31 * 60000); eq(a.state, 'ended'); eq(bank(e, 'bob'), 10000); ok(e.reg.get(a.id), 'listed 14 days because bob played');
  const idle2 = e.reg.create('bob', SET({ name: 'Never used' })); e.reg.sweep(e.clock.now() + 100 * 60000); e.reg.sweep(e.clock.now() + 200 * 60000); eq(e.reg.get(idle2.id), null);
  ok(e.reg.get('POKERPING'));
});
t('voidAll voids every live hand and writes nothing; pauseAll pauses open tables', () => {
  const e = env(); e.reg.load(); const a = e.reg.create('ann', SET()); a.sit('ann', { amount: 1000, socketId: 'a' }); a.sit('bob', { amount: 1000, socketId: 'b' }); a.startHand();
  const before = e.ledger.lastId; eq(e.reg.voidAll('uncaught'), 1); eq(e.ledger.lastId, before); eq(a.hand, null);
  e.reg.pauseAll(); eq([a.paused, e.reg.get('POKERPING').paused], [true, true]);
});
t('table events mark the registry dirty: debounced save and lobby push', () => {
  const e = env(); e.reg.load(); const base = e.lobby(); const a = e.reg.create('ann', SET()); a.sit('bob', { amount: 1000, socketId: 'b' });
  eq(e.clock.pending() > 0, true); e.clock.advance(300); ok(e.lobby() > base); ok(fs.existsSync(e.tfile));
  ok(e.events.some(x => x[0] === a.id && x[1] === 'joined'), 'forwarded to transport out');
});
t('handNo on a new table starts after any hand batches already in the ledger for that id', () => {
  const e = env(); e.reg.load(); const a = e.reg.create('ann', SET()); a.sit('ann', { amount: 1000, socketId: 'a' }); a.sit('bob', { amount: 1000, socketId: 'b' });
  a.startHand(); a.act(a.seats.get(a.hand.toAct).key, { type: 'fold' }); eq(a.handNo, 1); ok(e.ledger.has('hand:' + a.id + ':1'));
  eq(e.port.lastHandNo(a.id), 1);
});

console.log(`tables-registry.js: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
