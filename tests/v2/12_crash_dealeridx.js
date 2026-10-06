'use strict';
// C2: server crash when the button seat disappears (players leave while the table waits) and a new player sits. Audit repro 12.
// 9440541 already clamps dealerIdx, so this is expected to pass there; it stays as a regression guard for the stable-seat rewrite.
const { startServer, Bot, waitFor, sleep, suite, expect } = require('./lib');
const T = suite(__filename);
(async () => {
  const srv = await startServer(0, { handDelayMs: 100 });
  await T.check('button-seat-removed-then-new-player-sits-server-survives-and-deals', ['C2'], async () => {
    const bots = [];
    for (const n of ['Gil', 'Hana', 'Ike']) { const b = await new Bot(srv, n).connect(); await b.signup(); bots.push(b); }
    const c = await bots[0].req('table_create', { settings: { name: 'Crash', mode: 'chips', autoStart: true } }, 'table_created');
    const id = c.table.id;
    for (const b of bots) await b.sit(id, 2000);
    for (let i = 0; i < 80; i++) {          // fold until the button sits on the third seat
      await sleep(60);
      const g = bots[0].gs; if (!g) continue;
      if (g.status === 'playing' && g.players.findIndex(p => p.isDealer) === 2) break;
      const x = bots.find(b => b.myTurn()); if (x) x.act('fold');
    }
    await bots[1].leave(id); await bots[2].leave(id);
    await sleep(600);
    const j = await new Bot(srv, 'Jem').connect(); await j.signup(); const r = await j.sit(id, 2000);
    expect(!r.__err, 'Jem could not sit: ' + r.__err);
    const h0 = bots[0].gs.handNum;
    await waitFor(() => bots[0].gs.handNum > h0 && bots[0].gs.status === 'playing', 6000);
    const alive = srv.alive();
    const tail = srv.logText().split('\n').filter(l => /TypeError|ReferenceError|at startHand/.test(l)).slice(0, 2).join(' | ');
    expect(alive, 'server process exited: ' + tail);
    expect(bots[0].gs.status === 'playing' && bots[0].gs.handNum > h0, 'no hand was dealt after the new player sat');
  });
  await srv.stop();
  await T.done();
})();
