'use strict';
const { startServer, mk, waitFor, sleep } = require('./lib.js');
(async () => {
  const srv = await startServer(3142, { chris: 10000, liam: 10000 });
  let fail = 0;
  const check = (ok, msg) => { console.log(ok ? 'PASS' : 'FAIL', msg); if (!ok) fail++; };
  try {
    const [a, b] = await mk(srv, ['Chris', 'Liam']);
    await waitFor(() => a.gs && a.gs.status === 'playing', 8000);
    b.emit('set_pause', { paused: true }); await sleep(300);
    check(!a.gs.paused && b.errors.some(e => /Only Chris/.test(e || '')), 'non-Chris cannot pause');
    a.emit('set_pause', { paused: true });
    await waitFor(() => a.gs.paused && b.gs.paused, 2000);
    check(a.gs.paused && b.gs.paused, 'Chris pause reaches everyone');
    const mover = a.myTurn() ? a : b;
    mover.act('call'); await sleep(300);
    check(mover.errors.some(e => /paused/i.test(e || '')), 'actions rejected while paused');
    const hn = a.gs.handNum, turn = a.gs.currentPlayerIdx;
    await sleep(2500);
    check(a.gs.handNum === hn && a.gs.currentPlayerIdx === turn, 'no change while paused');
    a.emit('set_pause', { paused: false });
    await waitFor(() => !a.gs.paused, 2000);
    const mover2 = a.myTurn() ? a : b;
    mover2.act(mover2.gs.currentBet > mover2.me().roundBet ? 'call' : 'check'); await sleep(300);
    check(!a.gs.paused && (a.gs.currentPlayerIdx !== turn || a.gs.street !== 'preflop' || a.gs.status !== 'playing'), 'play continues after resume');
    // pause between hands: fold, pause during waiting_next, next hand must not start
    const f = a.myTurn() ? a : b; if (f.myTurn()) f.act('fold');
    await waitFor(() => a.gs.status === 'waiting_next', 3000);
    a.emit('set_pause', { paused: true });
    const h = a.gs.handNum; await sleep(8500);
    check(a.gs.handNum === h && a.gs.status === 'waiting_next', 'next hand held while paused');
    a.emit('set_pause', { paused: false });
    await waitFor(() => a.gs.handNum === h + 1, 3000);
    check(a.gs.handNum === h + 1, 'next hand deals after resume');
    a.emit('set_pause', { paused: true }); await waitFor(() => b.gs.paused, 2000);
    a.sock.close(); await waitFor(() => !b.gs.paused, 2000);
    check(!b.gs.paused, 'pause clears when Chris disconnects');
  } catch (e) { console.log('ERR', e); fail++; }
  srv.stop(); process.exit(fail ? 1 : 0);
})();
