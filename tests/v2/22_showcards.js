'use strict';
// M9: "show cards" must work at every table, not only POKERPING. Audit repro 22.
const { startServer, waitFor, sleep, tableWith, step, suite, expect } = require('./lib');
const T = suite(__filename);
(async () => {
  const srv = await startServer(0, { handDelayMs: 600000 });
  for (const withRoomId of [true, false]) {
    await T.check(`show-cards-at-a-created-table-${withRoomId ? 'with' : 'without'}-room-id`, ['M9'], async () => {
      const { id, bots } = await tableWith(srv, withRoomId ? ['Sca', 'Scb'] : ['Scc', 'Scd'], [1000, 1000]);
      await step(bots, 'fold');
      await waitFor(() => bots[0].gs.status === 'waiting_next', 3000);
      const shower = bots.find(b => b.cards && b.cards.length === 2), other = bots.find(b => b !== shower);
      const p = other.wait('cards_shown', 2000);
      shower.emit('show_cards', withRoomId ? { which: 'both', roomId: id } : { which: 'both' });
      const r = await p;
      bots.forEach(b => b.close());
      expect(r, 'cards_shown never reached the other player');
    });
  }
  await srv.stop();
  await T.done();
})();
