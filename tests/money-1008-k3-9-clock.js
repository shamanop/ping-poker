'use strict';
// Money hardening 1008, K3-9: a Cash table always has a turn clock. With actionTimerSec 0 a CONNECTED player who never acts holds the
// betting round open for ever and the other players' committed Cash is stuck in the hand. Cash (`play`) refuses a timer below 15 at create
// (and in the settings validator an edit goes through); a stored Cash table with 0 is read as 30 at load; Chips keep 0 = no clock.
const fs = require('fs');
const path = require('path');
const { world, rigDeck, quiet, suite, eq, ok, code, ROOT } = require('./lib-money-1008-tables');
const { validateSettings } = require(path.join(ROOT, 'tables/settings'));
const { t, done } = suite(__filename);
const base = mode => ({ name: 'Clock test', mode, buyIn: mode === 'play' ? { min: 500, max: 50000, default: 20000 } : { min: 100, max: 50000, default: 2000 }, blinds: mode === 'play' ? { sb: 50, bb: 100 } : { sb: 25, bb: 50 }, seats: 2, autoStart: false });

t('validator: Cash refuses 0 (and anything below 15); 15, 30, 45, 60 pass; Chips keep 0', () => {
  const r = validateSettings({ ...base('play'), actionTimerSec: 0 });
  eq([r.ok, r.code, r.field, r.min], [false, 'range', 'actionTimerSec', 15]);
  ok(!/[0-9$]/.test(r.message), 'the message has no digit or $: ' + r.message);
  for (const s of [15, 30, 45, 60]) ok(validateSettings({ ...base('play'), actionTimerSec: s }).ok, 'cash ' + s);
  for (const s of [0, 15, 30, 45, 60]) ok(validateSettings({ ...base('chips'), actionTimerSec: s }).ok, 'chips ' + s);
  eq(validateSettings({ ...base('play'), actionTimerSec: 20 }).ok, false, 'not a listed value');
  eq(validateSettings(base('play')).value.actionTimerSec, 30, 'default stays 30');
});

t('registry.create: a Cash table with timer 0 is refused, a Chips table with timer 0 is made', () => {
  const W = world({ keys: ['a'] });
  eq(code(() => W.registry.create('a', { ...base('play'), actionTimerSec: 0 })), 'range');
  ok(W.registry.create('a', { ...base('chips'), actionTimerSec: 0 }).actionTimerSec === 0);
  const cash = W.registry.create('a', { ...base('play'), actionTimerSec: 15 });
  ok(cash.actionTimerSec === 15);
  // the host's table_update merges the patch into the stored record and runs the same validator: 0 is refused for Cash at edit too
  const v = validateSettings({ ...W.registry.recOf(cash), actionTimerSec: 0 });
  eq([v.ok, v.code, v.field], [false, 'range', 'actionTimerSec']);
  eq(validateSettings({ ...W.registry.recOf(cash), actionTimerSec: 45 }).ok, true);
});

t('K3-9 proof: Cash, opponent all-in, the connected staller never acts: his clock folds him and the the host is paid after 15 seconds', () => {
  const W = world({ keys: ['host', 'stall'], cash: { host: 100000, stall: 100000 } });
  const T = W.registry.create('host', { ...base('play'), actionTimerSec: 15 });
  T.sit('host', { amount: 20000, seat: 0, socketId: 'h' }); T.sit('stall', { amount: 20000, seat: 1, socketId: 's' });
  const before = W.held('host', 'play');
  W.decks.push(rigDeck([['7c', '2d'], ['As', 'Ad']], ['3c', '8d', '9h', '4s', 'Kh']));
  quiet(() => T.startHand());
  T.act('host', { type: 'raise', to: 20000 });
  eq(T.hand.toAct, 1);
  quiet(() => W.clock.advance(16000));                                     // his 15 s clock
  ok(!T.handLive(), 'the hand is settled, not held open');
  eq(T.seatOfKey('host').stack, 20100, 'the host won the staller\'s blind');
  eq(W.held('host', 'play') - before, 100); eq(W.total('play'), 200000);
});

t('load: a stored Cash table with timer 0 is read as 30 (and is not dropped); a stored Chips table keeps 0; a stored Cash 15 stays 15', () => {
  const W = world({ keys: ['a'] });
  const c0 = W.registry.create('a', { ...base('play'), actionTimerSec: 30 }), c15 = W.registry.create('a', { ...base('play'), actionTimerSec: 15 }), ch = W.registry.create('a', { ...base('chips'), actionTimerSec: 0 });
  quiet(() => W.registry.flush());
  const f = path.join(W.dir, 'tables.json'), j = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const x of j.tables) if (x.id === c0.id) x.actionTimerSec = 0;
  fs.writeFileSync(f, JSON.stringify(j));
  W.restart();
  eq(W.registry.get(c0.id).actionTimerSec, 30); eq(W.registry.get(c15.id).actionTimerSec, 15); eq(W.registry.get(ch.id).actionTimerSec, 0);
});
done();
