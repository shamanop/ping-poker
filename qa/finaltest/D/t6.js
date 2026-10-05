const { startServer, Client, waitFor, mk, sleep, check } = require('./lib');
(async () => {
  const srv = await startServer(3130, {});
  const dbl = new Client(srv, 'Dbl'); await dbl.connect(); await dbl.join(); await dbl.join();   // double-click
  const [B, C] = await mk(srv, ['Bob', 'Cy']);
  console.log('seats:', dbl.events.filter(e => e.ev === 'room_update').slice(-1)[0].d.players.map(p => p.name).join(','), 'bank', JSON.stringify(srv.bank()));
  dbl.emit('start_game', { roomId: 'POKERPING' });
  await waitFor(() => B.gs && B.gs.status === 'playing');
  // auto-play: Dbl socket plays only its first seat (server maps socket -> first seat); Bob/Cy check/call
  let run = true; const t0 = Date.now(); const turnLog = [];
  (async () => { while (run) {
    const gs = B.gs; if (gs && gs.status === 'playing' && gs.currentPlayerIdx != null) {
      const i = gs.currentPlayerIdx, nm = gs.players[i].name, who = nm === 'Bob' ? B : nm === 'Cy' ? C : dbl;
      const k = gs.handNum + ':' + i + ':' + gs.street + ':' + gs.currentBet;
      if (!turnLog.length || turnLog[turnLog.length - 1].k !== k) turnLog.push({ k, nm, i, t: Date.now() - t0 });
      who.act(gs.currentBet > gs.players[i].roundBet ? 'call' : 'check', 0);
    } await sleep(50); } })();
  await waitFor(() => B.gs.handNum >= 3, 150000);
  run = false;
  const stalls = []; for (let i = 1; i < turnLog.length; i++) { const dt = turnLog[i].t - turnLog[i - 1].t; if (dt > 5000) stalls.push(`${turnLog[i-1].nm}(idx${turnLog[i-1].i}) ${ (dt/1000).toFixed(0)}s`); }
  console.log('elapsed', ((Date.now() - t0) / 1000).toFixed(0) + 's for', B.gs.handNum, 'hands; stalls >5s:', stalls.join(', ') || 'none');
  check('L1', 'double join_game from one socket does NOT create a phantom unplayable seat', stalls.length === 0 && B.gs.players.filter(p => p.name === 'Dbl').length === 1, `Dbl seats=${B.gs.players.filter(p => p.name==='Dbl').length}; stalls=${stalls.join(', ') || 'none'}`);
  // disconnect Dbl socket: does the second seat get cleaned?
  const bankBefore = srv.bank().dbl; dbl.sock.disconnect(); await sleep(500);
  const seats = B.gs.players.filter(p => p.name === 'Dbl').map(p => `chips=${p.chips} connected=${p.connected}`);
  console.log('after Dbl socket disconnect: Dbl seats', seats.join(' | '), 'bank dbl', bankBefore, '->', srv.bank().dbl);
  await sleep(12000);
  const seats2 = B.gs.players.filter(p => p.name === 'Dbl').map(p => `chips=${p.chips} connected=${p.connected} folded=${p.folded}`);
  console.log('12s later:', seats2.join(' | '), 'status', B.gs.status);
  srv.stop(); process.exit(0);
})();
