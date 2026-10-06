'use strict';
// Hand evaluator edge cases, judged through showdown_result of rigged heads-up hands that are checked down (works on any server).
const { startServer, tableWith, drive, P, rigDeck, waitFor, suite, expect } = require('./lib');
const T = suite(__filename);
const cases = [
  ['wheel-loses-to-6-high-straight', ['As', '2d'], ['6c', '7h'], ['3s', '4h', '5d', 'Kc', 'Qd'], -1],
  ['wheel-is-a-straight-beats-trips', ['As', '2d'], ['Kh', 'Ks'], ['3s', '4h', '5d', 'Kc', '9d'], 1],
  ['steel-wheel-is-a-straight-flush', ['Ah', '2h'], ['Kd', 'Kc'], ['3h', '4h', '5h', 'Kh', 'Ks'], 1],
  ['flush-beats-straight', ['2h', '9h'], ['Ts', 'Jd'], ['7h', '8h', 'Qh', '9c', '3d'], 1],
  ['two-pair-on-board-ace-kicker-beats-queen', ['Ad', '3c'], ['Qd', '4c'], ['Ks', 'Kh', '8s', '8h', '2d'], 1],
  ['board-plays-tie', ['2c', '3d'], ['2d', '4h'], ['Ts', 'Jh', 'Qd', 'Kc', 'Ac'], 0],
  ['three-pairs-best-two-plus-kicker', ['Ac', '9c'], ['Ad', '2c'], ['As', '9d', '5h', '5c', '2d'], 1],
  ['full-house-higher-trips-first', ['8c', '8d'], ['7c', 'Kd'], ['8s', '7s', '7h', 'Kc', '2d'], 1],
  ['quads-kicker', ['Ac', '2d'], ['Kc', '3d'], ['9s', '9h', '9d', '9c', '4d'], 1],
  ['flush-compares-five-cards', ['Ah', '2h'], ['Kh', '3h'], ['Qh', 'Jh', '9h', '4c', '5c'], 1],
  ['ace-high-straight-beats-king-high', ['Ac', '2d'], ['9c', '2c'], ['Ts', 'Jh', 'Qd', 'Kc', '3d'], 1],
];
(async () => {
  const srv = await startServer(0);
  let n = 0;
  for (const [name, h1, h2, board, want] of cases) {
    await T.check('eval-' + name, [], async () => {
      n++;
      const { bots } = await tableWith(srv, ['Ev' + n + 'a', 'Ev' + n + 'b'], [1000, 1000], {}, { decks: [rigDeck([h1, h2], board)] });
      await drive(bots, P.call, () => bots[0].showdowns.length > 0, 10000);
      const sd = bots[0].showdowns[0];
      bots.forEach(b => b.close());
      expect(sd, 'no showdown');
      const w = sd.winners.map(x => x.name).sort().join(',');
      const exp = want === 1 ? bots[0].name : want === -1 ? bots[1].name : [bots[0].name, bots[1].name].sort().join(',');
      expect(w === exp, `winners ${w}, expected ${exp} (${sd.winners.map(x => x.handName).join(' / ')})`);
    });
  }
  await srv.stop();
  await T.done();
})();
