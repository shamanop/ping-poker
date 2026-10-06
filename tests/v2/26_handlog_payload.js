'use strict';
// Hand-log payload (10/6 finding "HL", plus L3): showdown_result must let the client show NET results.
//  - a player who only got an uncalled bet back is not listed as a winner
//  - on a fold-win the winner's listed amount excludes their own uncalled raise
//  - a per-player `net` is present for every dealt player and sums to 0
// `net` is read from showdown_result.net (object {name: delta} or array of {name, net}); also accepted: results[] / players[] with name+net.
const { startServer, P, rigDeck, runPot, suite, expect } = require('./lib');
const T = suite(__filename);
const DRY = ['3c', '8d', '9h', '4s', '5h'];
function netsOf(sd) {
  const arr = x => Array.isArray(x) && x.every(e => e && typeof e.name === 'string' && Number.isInteger(e.net)) ? Object.fromEntries(x.map(e => [e.name, e.net])) : null;
  if (sd.net && typeof sd.net === 'object' && !Array.isArray(sd.net) && Object.values(sd.net).every(Number.isInteger)) return sd.net;
  return arr(sd.net) || arr(sd.results) || arr(sd.players) || null;
}
const cache = {};
async function scen(srv, key) {
  if (cache[key]) return cache[key];
  const specs = {
    allin: { names: ['Hla', 'Hlb'], stacks: [5000, 1000], deck: rigDeck([['7c', '2d'], ['As', 'Ad']], ['3c', '8d', '9h', '4s', 'Kc']), policies: [P.allin, P.call], strength: [1, 2],
      committed: S => ({ Hla: 5000, Hlb: 1000 }) },
    foldwin: { names: ['Hlc', 'Hld', 'Hle'], stacks: [1000, 1000, 1000], want: 0, deck: rigDeck([['As', 'Ad'], ['Ks', 'Kd'], ['7c', '2d']], DRY), policies: [P.raiseTo(300), P.fold, P.fold], strength: [3, 2, 1],
      folded: S => new Set(['Hld', 'Hle']), committed: S => ({ Hlc: 300, Hld: S.blinds.Hld, Hle: S.blinds.Hle }) },
  };
  return (cache[key] = await runPot(srv, specs[key]));
}
(async () => {
  const srv = await startServer(0, { handDelayMs: 1200 });
  await T.check('showdown-result-lists-only-pot-winners-not-uncalled-returns', ['L3'], async () => {
    const r = await scen(srv, 'allin'); const names = r.res.sd.winners.map(w => w.name);
    expect(names.join() === 'Hlb', `winners listed: ${names.join(',')}; Hla only got 4000 of his own back`);
  });
  await T.check('foldwin-listed-amount-excludes-the-winners-own-uncalled-raise', ['HL'], async () => {
    const r = await scen(srv, 'foldwin'); const w = r.res.sd.winners.find(x => x.name === 'Hlc');
    const want = r.exp.ref.pays.Hlc;
    expect(w && w.amount === want, `winner amount ${w && w.amount}, want ${want} (the pot he won; his own 250 above the matched part is a return, not a win)`);
  });
  for (const key of ['allin', 'foldwin']) {
    await T.check(`showdown-result-has-net-for-every-dealt-player-summing-to-zero-${key}`, ['HL'], async () => {
      const r = await scen(srv, key); const nets = netsOf(r.res.sd);
      expect(nets, 'showdown_result has no per-player net: keys ' + Object.keys(r.res.sd).join(','));
      const names = Object.keys(r.exp.totals);
      expect(names.every(n => Number.isInteger(nets[n])), `net missing for some of ${names.join(',')}: ${JSON.stringify(nets)}`);
      expect(Object.values(nets).reduce((a, b) => a + b, 0) === 0, `nets do not sum to 0: ${JSON.stringify(nets)}`);
      const want = Object.fromEntries(names.map(n => [n, r.exp.totals[n] - r.S.start[n]]));
      expect(names.every(n => nets[n] === want[n]), `nets ${JSON.stringify(nets)}, want ${JSON.stringify(want)}`);
    });
  }
  await srv.stop();
  await T.done();
})();
