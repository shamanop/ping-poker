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
  await T.check('kick-midhand-uncalled-part-of-the-kicked-bet-goes-back-to-him', ['N1'], async () => {
    // heads-up: the host limps, P1 raises to 500, the host kicks P1 before answering. P1's 450 above the matched 50 was never called.
    const spec = {
      names: ['Kja', 'Kjb'], stacks: [2000, 2000], deck: rigDeck([['7c', '2d'], ['As', 'Ad']], DRY),
      strength: [1, 3], folded: S => new Set([S.names[1]]), committed: S => ({ [S.names[0]]: 50, [S.names[1]]: 500 }),
      script: async S => {
        const [h, p1] = S.bots;
        const pol = [(b, i) => (i.currentBet <= i.bb ? [i.toCall ? 'call' : 'check'] : null), P.raiseTo(500)];
        await drive(S.bots, pol, () => h.myTurn() && h.gs.currentBet === 500, 15000);
        h.emit('table_kick', { tableId: S.id, key: p1.key }); await sleep(300);
      },
    };
    const r = await runPot(srv, spec);
    expect(r.res.sd, 'no showdown_result');
    const d = diffTotals(r.res.totals, r.exp.totals);
    expect(!d, d + ' (the kicked player gets his uncalled 450 back; the host wins the matched 100)');
  });
  await srv.stop();
  await T.done();
})();
