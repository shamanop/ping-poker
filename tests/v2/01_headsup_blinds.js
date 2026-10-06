'use strict';
// H4: heads-up, the button posts the SMALL blind, acts FIRST preflop and LAST postflop. Audit repro 01.
const { startServer, waitFor, sleep, tableWith, step, suite, expect } = require('./lib');
const T = suite(__filename);
let data;
async function scenario() {
  if (data) return data;
  const srv = await startServer(0);
  const { bots } = await tableWith(srv, ['Alice', 'Bobby'], [2000, 2000], { autoStart: true }, { start: false });
  bots[0].emit('table_start', { tableId: bots[0].tableId });
  const out = [];
  for (let h = 1; h <= 3; h++) {
    await waitFor(() => bots[0].gs && bots[0].gs.status === 'playing' && bots[0].gs.handNum === h, 8000);
    await sleep(60);
    const gs = bots[0].gs;
    const dealer = gs.players.find(p => p.isDealer);
    const sbPoster = gs.players.find(p => p.roundBet === gs.sb), bbPoster = gs.players.find(p => p.roundBet === gs.bb);
    const first = gs.players[gs.currentPlayerIdx];
    const row = { hand: h, dealer: dealer && dealer.name, sb: sbPoster && sbPoster.name, bb: bbPoster && bbPoster.name, firstPre: first && first.name };
    await step(bots, 'call');                     // button limps
    await step(bots, 'check');                    // BB checks the option
    await waitFor(() => bots[0].gs.street === 'flop', 3000); await sleep(40);
    const g2 = bots[0].gs; row.firstFlop = g2.players[g2.currentPlayerIdx] && g2.players[g2.currentPlayerIdx].name;
    for (let i = 0; i < 4 && bots[0].gs.handNum === h && bots[0].gs.status === 'playing'; i++) { const x = bots.find(y => y.myTurn()); if (!x) { await sleep(60); continue; } x.act('fold'); await sleep(120); }
    out.push(row);
  }
  await srv.stop();
  return (data = out);
}
(async () => {
  await T.check('hu-button-posts-small-blind', ['H4'], async () => {
    const d = await scenario(); const bad = d.filter(r => r.dealer !== r.sb);
    expect(!bad.length, `button posts ${bad[0] && bad[0].dealer === bad[0].bb ? 'BIG' : '?'} blind in hands ${bad.map(b => b.hand)}: ${JSON.stringify(bad[0])}`);
  });
  await T.check('hu-button-acts-first-preflop', ['H4'], async () => {
    const d = await scenario(); const bad = d.filter(r => r.firstPre !== r.dealer);
    expect(!bad.length, `first to act preflop is not the button: ${JSON.stringify(bad[0])}`);
  });
  await T.check('hu-button-acts-last-postflop', ['H4'], async () => {
    const d = await scenario(); const bad = d.filter(r => r.firstFlop === r.dealer);
    expect(!bad.length, `button acts first on the flop in hands ${bad.map(b => b.hand)}: ${JSON.stringify(bad[0])}`);
  });
  await T.done();
})();
