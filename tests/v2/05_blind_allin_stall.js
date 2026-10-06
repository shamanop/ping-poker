'use strict';
// M1: every dealt player is all-in from posting the blinds -> the hand must run out by itself (it stalled forever).
// S7c: heads-up, the short stack is all-in from its blind; the unmatched part of the other blind must come back.
// v2 validation forbids sitting with less than one big blind, so the short stacks are made the legal way: hand 1 (rigged) is lost down to 20 / 25
// chips, the winner (third seat) stands up, and hand 2 is the case under test.
const { startServer, waitFor, drive, P, rigDeck, audit, roomOf, tableWith, suite, expect } = require('./lib');
const T = suite(__filename);
const DRY = ['3c', '8d', '9h', '4s', '5h'];
const pre = to => P.street({ preflop: P.raiseTo(to), default: P.call });

// names = [A, B, Win]; Win holds AA in hand 1 and wins; deck2 is dealt to hand 2 (A, B in seat order).
async function shrink(srv, names, stacks, policies, deck2) {
  const deck1 = rigDeck([['7c', '2d'], ['Jc', '2h'], ['As', 'Ad']], DRY);
  const { id, bots } = await tableWith(srv, names, stacks, { blinds: { sb: 25, bb: 50 }, buyIn: { min: 500, max: 100000, default: 600 }, autoStart: false }, { decks: [deck1, deck2], start: false });
  bots[0].emit('table_start', { tableId: id });
  await drive(bots, policies, () => bots[0].showdowns.length >= 1, 20000);
  expect(bots[0].showdowns.length >= 1, 'setup: hand 1 did not finish');
  await bots[2].leave(id);
  const a = await audit(bots[0]); const r = roomOf(a, id);
  return { id, bots, burned: Object.fromEntries(r.players.map(p => [p.name, p.chips])) };
}
// Whoever is asked to act in hand 2 checks / calls (the old server asks the big blind to check against an all-in small blind; v2 runs out at once).
async function hand2(S, ms = 12000) {
  const a = S.bots[0];
  if (!await waitFor(() => a.showdowns.length >= 2, 4000) && a.gs && a.gs.status !== 'playing') a.emit('table_start', { tableId: S.id });
  return drive(S.bots.slice(0, 2), P.call, () => a.showdowns.length >= 2, ms);
}

(async () => {
  const srv = await startServer(0, { handDelayMs: 1500 });
  await T.check('hand-runs-out-when-all-dealt-players-are-all-in-from-the-blinds', ['M1'], async () => {
    const S = await shrink(srv, ['Ned', 'Ola', 'Wim'], [600, 600, 600], [pre(580), pre(580), pre(580)], rigDeck([['As', 'Ad'], ['Ks', 'Kd']], DRY));
    expect(S.burned.Ned === 20 && S.burned.Ola === 20, 'setup: stacks after hand 1 are ' + JSON.stringify(S.burned));
    const done = await hand2(S);
    const r = roomOf(await audit(S.bots[0]), S.id);
    S.bots.forEach(b => b.close());
    expect(done, `hand 2 (20 vs 20 at 25/50, both all-in from the blinds) never finished: status ${r && r.status}, street ${r && r.street}`);
  });
  await T.check('short-blind-all-in-unmatched-part-of-the-other-blind-comes-back', [], async () => {
    // hand 1: Sho and Win commit 575, Big folds. hand 2: Sho (AA, 25 chips) vs Big (about 575).
    const S = await shrink(srv, ['Sho', 'Big', 'Win'], [600, 600, 600], [pre(575), P.fold, pre(575)], rigDeck([['As', 'Ad'], ['7c', '2d']], DRY));
    expect(S.burned.Sho === 25, 'setup: stacks after hand 1 are ' + JSON.stringify(S.burned));
    const done = await hand2(S);
    await new Promise(r => setTimeout(r, 200));
    const r = roomOf(await audit(S.bots[0]), S.id);
    const got = Object.fromEntries(r.players.map(p => [p.name, p.chips]));
    S.bots.forEach(b => b.close());
    expect(done, 'hand 2 never finished');
    const want = { Sho: 50, Big: S.burned.Big - 25 };
    expect(got.Sho === want.Sho && got.Big === want.Big, `after hand 2 stacks are ${JSON.stringify(got)}, want ${JSON.stringify(want)} (Big only loses the 25 Sho could match)`);
  });
  await srv.stop();
  await T.done();
})();
