'use strict';
// H1: a network drop must not fold a player. An all-in player with the best hand still wins at showdown; a seat that drops mid-hand stays seated.
const { startServer, waitFor, sleep, drive, P, rigDeck, audit, roomOf, seatOf, tableWith, moneyTotal, suite, expect } = require('./lib');
const T = suite(__filename);
(async () => {
  const srv = await startServer(0);
  await T.check('allin-player-who-drops-still-wins-with-the-best-hand', ['H1'], async () => {
    const deck = rigDeck([['As', 'Ad'], ['7c', '2d']], ['Kc', '9d', '4h', '3s', 'Jc']);
    const { id, bots } = await tableWith(srv, ['Pam', 'Quin'], [1000, 1000], {}, { decks: [deck] });
    const [pam, quin] = bots;
    const m0 = moneyTotal(await audit(quin)).total;
    await drive(bots, [P.allin, P.call], () => bots.every(b => b.gs.players.every(p => p.allIn)), 8000);
    await sleep(200);
    pam.close();
    await waitFor(() => quin.showdowns.length > 0, 10000);
    const sd = quin.showdowns[0];
    expect(sd, 'no showdown');
    const m1 = moneyTotal(await audit(quin)).total;
    quin.close();
    expect(m1 === m0, `money changed by ${m1 - m0}`);
    expect(sd.winners.some(w => w.name === 'Pam') && !sd.winners.some(w => w.name === 'Quin'), `winners ${sd.winners.map(w => w.name + ' ' + w.amount + ' ' + w.handName).join(', ')}; the disconnected AA seat must win the 2000 pot against 7-2`);
  });
  await T.check('seat-that-drops-mid-hand-stays-in-the-hand-with-its-chips', ['H1'], async () => {
    const { id, bots } = await tableWith(srv, ['Rae', 'Sid', 'Tom'], [1000, 1000, 1000]);
    const idle = bots.find(b => !b.myTurn());
    idle.close();
    await sleep(700);
    const other = bots.find(b => b !== idle);
    const a = await audit(other);
    const seat = seatOf(a, id, idle.name);
    const pub = other.gs.players.find(p => p.name === idle.name);
    bots.forEach(b => b.close());
    expect(seat, 'seat of the dropped player is gone from the table (cashed out and folded by the disconnect)');
    expect(seat.chips + seat.handBet > 0 && seat.connected === false, `seat state ${JSON.stringify(seat)}; want chips kept and connected=false`);
    expect(pub && !pub.folded, `the drop folded the seat out of the hand (game_state ${JSON.stringify(pub && { folded: pub.folded, connected: pub.connected })}); only the action timer may fold it, on its turn`);
  });
  await srv.stop();
  await T.done();
})();
