'use strict';
// Money hardening 1008, housekeeping: the table view carries `pausePending` (K3-4) and, per seat, `kickPending` (K3-1b) and `waitingForBB` (K3-8)
// next to `paused` / `leaving`. Data only: the client may ignore them.
const path = require('path');
const { world, rigDeck, quiet, suite, eq, ok, ROOT } = require('./lib-money-1008-tables');
const { createViews } = require(path.join(ROOT, 'transport/views'));
const { t, done } = suite(__filename);

function build() {
  const W = world({ keys: ['a', 'b', 'c'], cash: { a: 100000, b: 100000, c: 100000 } });
  const accounts = { get: k => ({ key: k, display: k, avatar: 'a01' }), picUrl: () => null, all: () => ({}) };
  const views = createViews({ registry: W.registry, accounts, presLedger: { summary() { return {}; } }, ledger: W.ledger, service: W.service, wallet: null });
  const T = W.registry.create('a', { name: 'View test', mode: 'play', buyIn: { min: 500, max: 50000, default: 20000 }, blinds: { sb: 50, bb: 100 }, seats: 3, autoStart: false, actionTimerSec: 60 });
  T.actionTimerSec = 0;
  ['a', 'b', 'c'].forEach((k, i) => T.sit(k, { amount: 20000, seat: i, socketId: 's-' + k }));
  return { W, T, views };
}
const row = (g, key) => g.players.find(p => p.name === key || p.key === key || p.display === key);

t('pausePending and kickPending show in the game state; both fall back to false', () => {
  const { W, T, views } = build();
  quiet(() => T.startHand());
  let g = views.gameState(T, 'a');
  eq(g.paused, false); eq(g.pausePending, false); ok(g.players.every(p => p.kickPending === false && p.waitingForBB === false));
  quiet(() => { T.pause(); T.kick('a', 'c', false); });
  g = views.gameState(T, 'a');
  eq(g.paused, false); eq(g.pausePending, true);
  eq(g.players.filter(p => p.kickPending).length, 1, 'one seat shows the pending kick');
  eq(g.players.filter(p => p.leaving).length, 0);
});
t('waitingForBB shows for a seat that missed a hand and is back in', () => {
  const { W, T, views } = build();
  quiet(() => T.startHand());
  while (T.handLive() && T.hand.phase === 'betting') T.act(T.seats.get(T.hand.toAct).key, { type: 'fold' });
  quiet(() => T.sitOut('c')); quiet(() => T.startHand());
  while (T.handLive() && T.hand.phase === 'betting') T.act(T.seats.get(T.hand.toAct).key, { type: 'fold' });
  quiet(() => T.sitOut('c'));
  const g = views.gameState(T, 'a');
  eq(g.players.filter(p => p.waitingForBB).length, 1);
});
done();
