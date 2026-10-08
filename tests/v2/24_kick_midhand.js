'use strict';
// N1 (10/6 finding): the host kicks a player in the middle of a hand. The kicked player's called bet stays in the pot, the pot goes to a remaining
// player by the rules, the part of his bet nobody called goes back to him, and total money is conserved (nobody "takes the pot" by kicking).
// Totals = chips at the table + bank delta, so the kicked player's cash-out counts.
const { startServer, sleep, drive, P, rigDeck, runPot, diffTotals, roomOf, audit, moneyTotal, suite, expect } = require('./lib');
const T = suite(__filename);
const DRY = ['3c', '8d', '9h', '4s', '5h'];
(async () => {
  const srv = await startServer(0, { handDelayMs: 1200 });
  await T.check('kick-midhand-the-kicked-best-hand-does-not-take-the-pot', [], async () => {
    // P0 KK, P1 72, P2 AA. Pre: P0 raises 400, P1 and P2 call. Flop: P1 bets 300, the host kicks P2 on his turn. P0 calls, checks down: KK wins.
    const spec = {
      names: ['Kia', 'Kib', 'Kic'], stacks: [1000, 1000, 1000], want: 0, deck: rigDeck([['Ks', 'Kd'], ['7c', '2d'], ['As', 'Ad']], DRY),
      strength: [2, 1, 3], folded: S => new Set([S.names[2]]), committed: S => ({ [S.names[0]]: 700, [S.names[1]]: 700, [S.names[2]]: 400 }),
      script: async S => {
        const [h, p1, p2] = S.bots;
        const pol = [P.street({ preflop: P.raiseTo(400), default: P.call }), P.street({ preflop: P.call, flop: P.raiseTo(300), default: P.call }), P.street({ preflop: P.call, default: () => null })];
        await drive(S.bots, pol, () => p2.myTurn() && p2.gs.street === 'flop' && p2.gs.currentBet === 300, 15000);
        h.emit('table_kick', { tableId: S.id, key: p2.key }); await sleep(300);
        await drive(S.bots, pol, () => h.showdowns.length > S.sd0[0], 15000);
      },
    };
    const r = await runPot(srv, spec);
    expect(r.res.sd, 'no showdown_result');
    const d = diffTotals(r.res.totals, r.exp.totals);
    expect(!d, d + ' (the kicked AA hand must not win; his 400 stays in the pot)');
  });
  // K3-1 (money hardening 1008): a kick never changes the result of a live hand. The old rule folded the kicked seat at once (and the host could
  // take any pot by kicking an all-in caller); now the kicked seat stays in the hand like a seat that sat out: it checks when that is free and folds
  // only against a real bet, and it is removed when the hand has settled. Here the kicked P1 has raised and the host is still to answer.
  await T.check('kick-midhand-the-kicked-raise-stays-live-the-host-calls-and-the-aces-win', ['N1', 'K3-1'], async () => {
    // heads-up: the host limps, P1 raises to 500, the host kicks P1 before answering, then calls. P1's raise stands; AA beats 72 at the showdown.
    const spec = {
      names: ['Kja', 'Kjb'], stacks: [2000, 2000], deck: rigDeck([['7c', '2d'], ['As', 'Ad']], DRY),
      strength: [1, 3], folded: () => new Set(), committed: S => ({ [S.names[0]]: 500, [S.names[1]]: 500 }),
      script: async S => {
        const [h, p1] = S.bots;
        const pol = [(b, i) => (i.currentBet <= i.bb ? [i.toCall ? 'call' : 'check'] : null), P.raiseTo(500)];
        await drive(S.bots, pol, () => h.myTurn() && h.gs.currentBet === 500, 15000);
        h.emit('table_kick', { tableId: S.id, key: p1.key }); await sleep(300);
        await drive(S.bots, [P.street({ default: P.call }), () => null], () => h.showdowns.length > S.sd0[0], 15000);
      },
    };
    const r = await runPot(srv, spec);
    expect(r.res.sd, 'no showdown_result');
    const d = diffTotals(r.res.totals, r.exp.totals);
    expect(!d, d + ' (the kicked seat is not folded: the aces win the 1,000 pot)');
  });
  await T.check('kick-midhand-the-kicked-raise-stays-live-the-host-folds-and-it-wins-uncontested', ['N1', 'K3-1'], async () => {
    // same, but the host folds to the raise: P1 wins the host's 50 blind; the 450 nobody called goes back to him.
    const spec = {
      names: ['Kka', 'Kkb'], stacks: [2000, 2000], deck: rigDeck([['As', 'Ad'], ['7c', '2d']], DRY),
      strength: [3, 1], folded: S => new Set([S.names[0]]), committed: S => ({ [S.names[0]]: 50, [S.names[1]]: 500 }),
      script: async S => {
        const [h, p1] = S.bots;
        const pol = [(b, i) => (i.currentBet <= i.bb ? [i.toCall ? 'call' : 'check'] : null), P.raiseTo(500)];
        await drive(S.bots, pol, () => h.myTurn() && h.gs.currentBet === 500, 15000);
        h.emit('table_kick', { tableId: S.id, key: p1.key }); await sleep(300);
        await drive(S.bots, [() => ['fold'], () => null], () => h.showdowns.length > S.sd0[0], 15000);
      },
    };
    const r = await runPot(srv, spec);
    expect(r.res.sd, 'no showdown_result');
    const d = diffTotals(r.res.totals, r.exp.totals);
    expect(!d, d + ' (the kicked seat stays live; the host folds and it takes the matched 100, the uncalled 450 goes back to him)');
  });
  await srv.stop();
  await T.done();
})();
