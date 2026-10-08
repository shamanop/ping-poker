'use strict';
// Cash movements are recorded (10/6 finding, M6): after a Cash hand and a restart the night data of that table is not empty and is zero-sum,
// and it shows the hand that was played (+2000 / -2000 for a rigged all-in), for SIGTERM (deploy) and SIGKILL (crash).
const { startServer, Bot, waitFor, sleep, audit, drive, P, tableWith, rigDeck, suite, expect } = require('./lib');
const T = suite(__filename);
async function run(sig) {
  const srv = await startServer(0, { handDelayMs: 600000 });
  try {
    const deck = rigDeck([['As', 'Ad'], ['7c', '2d']], ['3c', '8d', '9h', '4s', 'Kh']);
    const { id, bots, table } = await tableWith(srv, ['Pla' + sig[3], 'Plb' + sig[3]], [2000, 2000], { mode: 'play' }, { decks: [deck] });
    await drive(bots, [P.allin, P.call], () => bots[0].showdowns.length > 0, 20000);
    expect(bots[0].showdowns.length > 0, 'no showdown');
    await sleep(2300);
    await srv.stop(sig);
    const srv2 = await srv.restart();
    try {
      const c = await new Bot(srv2, 'Pla' + sig[3]).connect(); await c.login();
      const s = await c.req('night_get', { nightId: table.nightId }, 'settle_up');
      const ps = s && s.players ? (Array.isArray(s.players) ? s.players : Object.values(s.players)) : [];
      return { zeroSum: s.zeroSum, nets: Object.fromEntries(ps.map(p => [p.display || p.key, p.net])), err: s.__err };
    } finally { await srv2.stop(); }
  } finally { await srv.stop().catch(() => {}); }
}
(async () => {
  for (const sig of ['SIGTERM', 'SIGKILL']) {
    await T.check(`play-night-keeps-its-hand-after-${sig.toLowerCase()}-restart`, ['M6'], async () => {
      const r = await run(sig);
      const v = Object.values(r.nets);
      expect(!r.err && v.length === 2, `night data empty or missing after the restart: ${JSON.stringify(r)}`);
      expect(r.zeroSum === true && v.reduce((a, b) => a + b, 0) === 0, `not zero-sum: ${JSON.stringify(r)}`);
      expect(v.slice().sort((a, b) => a - b).join() === '-2000,2000', `nets ${JSON.stringify(r.nets)}, want +2000 / -2000 (the rigged all-in)`);
    });
  }
  await T.done();
})();
