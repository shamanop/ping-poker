'use strict';
// M4 POKERPING heads-up ending (winner cashed out, loser no rebuy prompt, advertised minimum rejected), M3 queued check/fold fires while paused,
// M2 action timer folds a player who can check, L2 button skips a seat when someone leaves between hands. Audit repro 11.
const { startServer, Bot, waitFor, sleep, audit, seatOf, roomOf, drive, P, rigDeck, dealAligned, step, suite, expect } = require('./lib');
const T = suite(__filename);

async function pokerping(srv) {
  const deck = rigDeck([['As', 'Ad'], ['7c', '2d']], ['Kc', '9d', '4h', '3s', 'Jc']);
  const a = await new Bot(srv, 'Uma').connect(), c = await new Bot(srv, 'Vic').connect();
  await a.signup(); await c.signup(); await a.req('__rig', { decks: [deck] }, '__rig_ok');
  const a0 = await audit(a); const bank0 = { Uma: a0.bank.uma ?? 10000, Vic: a0.bank.vic ?? 10000 };
  const r1 = await a.sit('POKERPING', 2000), r2 = await c.sit('POKERPING', 2000);
  if (r1.__err || r2.__err) throw new Error('sit ' + (r1.__err || r2.__err));
  await waitFor(() => a.gs && a.gs.status === 'playing', 5000);
  await drive([a, c], [P.allin, P.call], () => a.showdowns.length > 0, 15000);
  await sleep(1300);
  const au = await audit(a);
  return { a, c, au, bank0 };
}
(async () => {
  const srv = await startServer(0);
  let pp;
  const getPP = async () => pp || (pp = await pokerping(srv));
  await T.check('pokerping-headsup-allin-winner-keeps-the-stack-at-the-table', ['M4'], async () => {
    const { au, bank0 } = await getPP();
    const room = roomOf(au, 'POKERPING');
    const winner = room.players.reduce((x, y) => (x.chips >= y.chips ? x : y));
    expect(winner.chips === 4000, `winner stack at the table ${winner.chips} (bank ${au.bank[winner.key]}, was ${bank0[winner.name]}); the whole stack was cashed out instead of staying seated`);
  });
  await T.check('pokerping-busted-player-gets-bust-out-and-can-rebuy-the-advertised-minimum', ['M4'], async () => {
    const { a, c } = await getPP();
    const loser = a.me() && a.me().chips === 0 ? a : c.me() && c.me().chips === 0 ? c : (a.busts.length ? a : c);
    const bp = loser.busts[0];
    expect(bp, 'the busted player never got a bust_out (no rebuy prompt)');
    const want = bp.rebuy && bp.rebuy.min;
    expect(Number.isInteger(want), 'bust_out carries no rebuy.min: ' + JSON.stringify(bp).slice(0, 150));
    loser.emit('rebuy', { roomId: 'POKERPING', amount: want });
    await waitFor(() => loser.me() && loser.me().chips === want, 2500);
    expect(loser.me() && loser.me().chips === want, `rebuy of the advertised minimum ${want} was refused: ${loser.errors.slice(-1)[0]}`);
  });
  await T.check('queued-checkfold-does-not-fire-while-the-table-is-paused', ['M3'], async () => {
    const S = await dealAligned(srv, ['Wes', 'Xan', 'Yul'], [2000, 2000, 2000], { want: 0 });
    const [wes, xan, yul] = S.bots;
    await step(S.bots, 'raise', 300, wes);
    yul.emit('preselect', { roomId: S.id, mode: 'checkfold' }); await sleep(60);
    xan.act('call'); await sleep(40);
    wes.emit('table_pause', { tableId: S.id, paused: true });
    await sleep(900);
    const folded = yul.gs.players.find(p => p.name === 'Yul').folded;
    S.bots.forEach(b => b.close());
    expect(!folded, 'the queued check/fold acted while the table was paused');
  });
  await T.check('action-timer-checks-a-player-who-can-check-for-free', ['M2'], async () => {
    const S = await dealAligned(srv, ['Zed', 'Abe', 'Bea'], [2000, 2000, 2000], { want: 0, settings: { actionTimerSec: 15 } });
    await step(S.bots, 'call'); await step(S.bots, 'call');           // limp, SB completes: Bea (BB) may check for free
    const bea = S.bots[2];
    await waitFor(() => bea.me() && (bea.me().folded || bea.gs.street !== 'preflop'), 19000);
    const folded = bea.me().folded;
    S.bots.forEach(b => b.close());
    expect(!folded, 'the action timer folded the big blind who could check for free');
  }, { timeoutMs: 60000 });
  await T.check('button-moves-to-the-next-seat-when-the-dealer-leaves-between-hands', ['L2'], async () => {
    const slow = await startServer(1, { handDelayMs: 1500 });      // time to stand up between hands
    let dealer;
    try {
      const S = await dealAligned(slow, ['Cy', 'Di', 'Ed', 'Flo'], [2000, 2000, 2000, 2000], { want: 0 });
      const [cy, di] = S.bots; const h = di.gs.handNum;
      await drive(S.bots, P.fold, () => di.gs.status !== 'playing' || di.gs.handNum > h, 8000);
      await cy.leave(S.id);
      await waitFor(() => di.gs.handNum > h && di.gs.status === 'playing', 12000);
      await sleep(80);
      dealer = di.gs.players.find(p => p.isDealer);
      S.bots.forEach(b => b.close());
    } finally { await slow.stop(); }
    expect(dealer && dealer.name === 'Di', `after Cy (button) left, the button went to ${dealer && dealer.name}, expected Di (next seat)`);
  });
  await srv.stop();
  await T.done();
})();
