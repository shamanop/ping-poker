'use strict';
const { startServer, mk, waitFor, sleep } = require('../qa/finaltest/D/lib.js');
(async () => {
  const srv = await startServer(3140, { chris: 10000, liam: 10000 });
  let fail = 0;
  const check = (ok, msg) => { console.log(ok ? 'PASS' : 'FAIL', msg); if (!ok) fail++; };
  try {
    const [a, b] = await mk(srv, ['Chris', 'Liam']);
    if (!await waitFor(() => a.gs && a.gs.status === 'playing' && a.myTurn() !== undefined, 8000)) a.emit('start_game', { roomId: 'POKERPING' });
    await waitFor(() => a.gs && a.gs.status === 'playing', 8000);
    await waitFor(() => a.myTurn() || b.myTurn(), 5000);
    const first = a.myTurn() ? a : b, second = first === a ? b : a;
    first.act('raise', 100000);
    await waitFor(() => first.me() && first.me().allIn, 3000);
    await waitFor(() => second.myTurn(), 3000);
    const before = second.me().chips + second.me().roundBet;
    second.act('raise', 99999);
    await sleep(300);
    const afterReraise = second.gs.currentBet;
    const lg = second.gs.log.join(' | ');
    check(/calls/.test(lg) && (lg.match(/raises to/g) || []).length === 1, `re-raise over all-in treated as call: ${lg.slice(-120)}`);
    await waitFor(() => second.gs.street === 'river' || second.gs.status !== 'playing' || second.showdowns.length, 15000);
    let acted = false;
    for (let i = 0; i < 30; i++) { if (second.myTurn() && second.gs.status === 'playing' && second.gs.street !== 'preflop' && first.me().allIn) { acted = true; break; } await sleep(100); }
    check(!acted, 'no betting turn offered on later streets while opponent is all-in');
    await waitFor(() => second.showdowns.length > 0, 15000);
    check(second.showdowns.length > 0, 'hand reached showdown');
    await sleep(500);
    const tot = srv.bank().chris + srv.bank().liam + a.gs.players.reduce((s, p) => s + p.chips, 0);
    check(tot === 20000, `chips total ${tot}`);
  } catch (e) { console.log('ERR', e); fail++; }
  srv.stop();
  process.exit(fail ? 1 : 0);
})();
