'use strict';
const { startServer, mk, waitFor, sleep } = require('../qa/finaltest/D/lib.js');
(async () => {
  const srv = await startServer(3141, { chris: 10000, liam: 10000 });
  let fail = 0;
  const check = (ok, msg) => { console.log(ok ? 'PASS' : 'FAIL', msg); if (!ok) fail++; };
  try {
    const [a, b] = await mk(srv, ['Chris', 'Liam']);
    const shownEv = c => c.events.filter(e => e.ev === 'cards_shown').map(e => e.d);
    // Hand 1: Liam / Chris fold-win, then winner shows one card
    await waitFor(() => a.gs && a.gs.status === 'playing', 8000);
    await waitFor(() => a.myTurn() || b.myTurn(), 5000);
    const folder = a.myTurn() ? a : b, winner = folder === a ? b : a;
    folder.act('fold');
    await waitFor(() => a.gs.status === 'waiting_next', 3000);
    const sd = winner.showdowns[0];
    check(sd && sd.winners[0].cards.length === 0 && sd.nextMs === 7000, 'fold-win does not auto-reveal cards, window 7s');
    winner.emit('show_cards', { which: 0 });
    await waitFor(() => shownEv(a).length > 0, 2000);
    const ev = shownEv(a)[0];
    check(ev && ev.name === winner.name && ev.cards[0] && ev.cards[1] === null, 'show left reveals only the left card to everyone');
    winner.emit('show_cards', { which: 'both' });
    await waitFor(() => shownEv(a).length > 1, 2000);
    check(shownEv(a)[1].cards.every(Boolean), 'show both reveals both');
    folder.emit('show_cards', { which: 'both' });
    await waitFor(() => shownEv(a).length > 2, 2000);
    check(shownEv(a)[2].name === folder.name, 'folded player can show after the hand');
    // outsider cannot show mid-hand
    await waitFor(() => a.gs.status === 'playing' && a.gs.handNum === 2, 9000);
    const n = shownEv(a).length;
    a.emit('show_cards', { which: 'both' });
    await sleep(300);
    check(shownEv(a).length === n, 'cannot show cards during a live hand');
    // Hand 2: run to showdown, everyone revealed
    const t0 = Date.now();
    while (Date.now() - t0 < 25000 && !a.showdowns[1]) {
      for (const c of [a, b]) if (c.myTurn()) c.act(c.gs.currentBet > c.me().roundBet ? 'call' : 'check');
      await sleep(80);
    }
    const sd2 = a.showdowns[1];
    check(sd2 && sd2.reveals && sd2.reveals.length === 2 && sd2.reveals.every(r => r.cards.length === 2 && r.handName), 'showdown reveals both contenders with hand names');
    // Bank: set total
    await waitFor(() => a.gs.status === 'waiting_next', 3000);
    a.emit('bank_set', { name: 'Liam', balance: 50000 });
    await sleep(300);
    const liamStack = b.me().chips;
    check(srv.bank().liam + liamStack === 50000, `set Liam total to 50000 (bank ${srv.bank().liam} + table ${liamStack})`);
    b.emit('bank_set', { name: 'Chris', balance: 1 });
    await sleep(200);
    check(b.errors.some(e => /Only Chris/.test(e || '')), 'non-Chris cannot edit');
    a.emit('bank_set', { name: 'Newguy', balance: 7000 });
    await sleep(200);
    check(srv.bank().newguy === 7000, 'can set money for a player not yet in the bank');
    a.emit('bank_set', { name: 'Liam', balance: 100 });
    await sleep(300);
    check(srv.bank().liam + b.me().chips === 100, `lowering total below table stack trims stack (bank ${srv.bank().liam} + table ${b.me().chips})`);
  } catch (e) { console.log('ERR', e); fail++; }
  srv.stop();
  process.exit(fail ? 1 : 0);
})();
