const { startServer, Client, waitFor, mk, sleep, check } = require('./lib');
(async () => {
  const srv = await startServer(3132, { pauper: 1520 });
  const [A, B] = await mk(srv, ['Ann', 'pauper']);
  A.emit('start_game', { roomId: 'POKERPING' }); await waitFor(() => A.gs && A.gs.status === 'playing');
  // chat / sticker flood
  const t0 = Date.now(); for (let i = 0; i < 1000; i++) { A.emit('chat_message', { roomId: 'POKERPING', text: 'spam ' + i }); A.emit('drop_sticker', { roomId: 'POKERPING', emoji: '🔥' }); }
  await sleep(1500);
  const got = B.chats.length;
  check('N1', 'chat flood (1000 msgs) has rate limit / server stays up', srv.proc.exitCode === null, `B received ${got}/1000 chat msgs; no throttle in code; server alive=${srv.proc.exitCode === null}`);
  // pauper: bank 1520 -> buyin 1500 -> 20 left; bust and rebuy with bank 20 (=BB) then tiny
  console.log('pauper bank', srv.bank().pauper);
  // make pauper bust: all-in each hand vs Ann until pauper chips 0
  let run = true;
  (async () => { while (run) { for (const c of [A, B]) if (c.myTurn()) c.act('raise', 99999) ; await sleep(40); } })();
  await waitFor(() => A.gs.players.find(p => p.name === 'pauper').chips === 0 || A.gs.players.find(p => p.name === 'Ann').chips === 0, 60000);
  await sleep(500);
  const loser = A.gs.players.find(p => p.chips === 0); console.log('bust:', loser && loser.name);
  run = false;
  await waitFor(() => A.gs.status === 'waiting', 12000); await sleep(300);
  console.log('status', A.gs.status, 'players', A.gs.players.map(p => p.name + ':' + p.chips).join(','), 'bank', JSON.stringify(srv.bank()));
  const L = loser && loser.name === 'pauper' ? B : A; const ne = L.errors.length; L.emit('rebuy', { roomId: 'POKERPING' }); await sleep(300);
  console.log('rebuy result errors:', L.errors.slice(ne), 'chips now', L.me() && L.me().chips, 'bank', JSON.stringify(srv.bank()));
  srv.stop(); process.exit(0);
})();
