'use strict';
// N3: SIGKILL shortly after a showdown must not undo the hand. The old server mirrored stacks every 2 s, so a crash in that window gave the loser
// his chips back and took the win from the winner. Correct: the hand's result stands after the restart (winner 12,000 in the bank, loser 8,000). Audit repro 23.
const { startServer, Bot, waitFor, sleep, audit, drive, P, tableWith, rigDeck, suite, expect } = require('./lib');
const T = suite(__filename);
async function once(delay, tag) {
  const srv = await startServer(0, { handDelayMs: 600000 });
  try {
    const deck = rigDeck([['As', 'Ad'], ['7c', '2d']], ['3c', '8d', '9h', '4s', 'Kh']);
    const { id, bots } = await tableWith(srv, ['Wina' + tag, 'Losb' + tag], [2000, 2000], {}, { decks: [deck] });
    await drive(bots, [P.allin, P.call], () => bots[0].showdowns.length > 0, 20000);
    expect(bots[0].showdowns.length > 0, 'no showdown');
    const sd = bots[0].showdowns[0];
    await sleep(delay);
    await srv.stop('SIGKILL');
    const srv2 = await srv.restart();
    try {
      const c = await new Bot(srv2, 'Probe').connect();
      const a = await audit(c);
      const h = k => (a.bank[k] ?? 10000) + (a.rooms.reduce((s, r) => s + r.players.filter(p => p.key === k).reduce((x, p) => x + p.chips, 0), 0));
      return { wina: h('wina' + tag.toLowerCase()), losb: h('losb' + tag.toLowerCase()), winners: sd.winners.map(w => w.name) };
    } finally { await srv2.stop(); }
  } finally { await srv.stop().catch(() => {}); }
}
(async () => {
  let i = 0;
  for (const d of [100, 300, 700, 2500]) {
    await T.check(`sigkill-${d}ms-after-showdown-keeps-the-hand-result`, ['N3'], async () => {
      const r = await once(d, String.fromCharCode(97 + i++));
      expect(r.wina === 12000 && r.losb === 8000, `after the restart winner holds ${r.wina}, loser ${r.losb} (want 12000 / 8000)`);
    });
  }
  await T.done();
})();
