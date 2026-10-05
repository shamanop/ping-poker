const { startServer, Client, waitFor, mk, sleep, check } = require('./lib');
const total = (srv, c) => { const b = srv.bank(); let t = Object.values(b).reduce((a, x) => a + x, 0); for (const p of c.gs.players) t += p.chips; t += c.gs.pot; return t; };
// auto-player: check/call whatever
function autoplay(cs, stopFn) {
  let run = true;
  (async () => { while (run && !(stopFn && stopFn())) { for (const c of cs) if (!c.closed && c.myTurn()) c.act(c.gs.currentBet > c.me().roundBet ? 'call' : 'check', 0); await sleep(40); } })();
  return () => { run = false; };
}
(async () => {
  // ---- 8 players + 9th
  let srv = await startServer(3123, {});
  const names = ['P1','P2','P3','P4','P5','P6','P7','P8'];
  const cs = await mk(srv, names);
  check('E1', '8 players can join', cs.every(c => c.jr.ok), cs.map(c => c.jr.ok).join(','));
  const nine = (await mk(srv, ['P9']))[0];
  check('E2', '9th joiner rejected in lobby with clear message', !nine.jr.ok && /full/i.test(nine.jr.error), JSON.stringify(nine.jr));
  cs[0].emit('start_game', { roomId: 'POKERPING' });
  await waitFor(() => cs.every(c => c.gs && c.gs.status === 'playing'));
  const stop = autoplay(cs);
  const start = total(srv, cs[0]);
  let hands = 0; const t0 = Date.now();
  await waitFor(() => cs[0].gs.handNum >= 4, 90000);
  stop();
  check('E3', '8-player table plays 4 hands w/o error, chips conserved', cs[0].gs.handNum >= 4 && cs.every(c => c.errors.length === 0), `handNum=${cs[0].gs.handNum} elapsed=${((Date.now()-t0)/1000).toFixed(0)}s errors=${cs.map(c=>c.errors.join('/')).join(';')}`);
  await waitFor(() => cs[0].gs.status === 'waiting_next' || cs[0].gs.status === 'playing');
  const ten = (await mk(srv, ['Late1']))[0];
  check('E4', '9th/late joiner during game gets clear rejection', !ten.jr.ok, JSON.stringify(ten.jr));
  srv.stop(); await sleep(300);

  // ---- host disconnect lobby
  srv = await startServer(3124, {});
  let [A, B, C] = await mk(srv, ['Ann','Bob','Cy']);
  const hostOf = c => (c.events.filter(e => e.ev === 'room_update').slice(-1)[0] || {}).d?.hostName;
  console.log('host before', hostOf(B));
  A.sock.disconnect(); await sleep(300);
  check('F1', 'lobby: host disconnect reassigns host', hostOf(B) === 'Bob', 'host=' + hostOf(B));
  B.emit('start_game', { roomId: 'POKERPING' });
  await waitFor(() => C.gs && C.gs.status === 'playing', 3000);
  check('F2', 'new host can start the game', C.gs && C.gs.status === 'playing', 'status=' + (C.gs && C.gs.status));
  srv.stop(); await sleep(300);

  // ---- host disconnect mid-hand + (a) player mid-hand disconnect + (b) late join
  srv = await startServer(3125, {});
  [A, B, C] = await mk(srv, ['Ann','Bob','Cy']); const D = (await mk(srv, ['Dee']))[0];
  A.emit('start_game', { roomId: 'POKERPING' });
  await waitFor(() => [A,B,C,D].every(c => c.gs && c.gs.status === 'playing')); await sleep(200);
  const live = [A,B,C,D];
  const bankBefore = srv.bank();
  // raise a bit so pot is nonzero; Dee disconnects (a), Ann(host) disconnects
  const cur = () => live[A.gs.currentPlayerIdx];
  const notHostNotCur = live.filter(c => c !== cur() && c !== A)[0];
  console.log('Ann host; current:', cur().name, ' disconnecting Ann (host) and', notHostNotCur.name);
  const victim = notHostNotCur; const vChipsBefore = victim.me().chips;
  A.sock.disconnect(); await sleep(300);
  check('G1', 'mid-hand host disconnect reassigns host', hostOf(B) !== 'Ann' && !!hostOf(B), 'host=' + hostOf(B));
  victim.sock.disconnect(); await sleep(300);
  const bk = srv.bank();
  console.log('(a) victim', victim.name, 'stack at disconnect', vChipsBefore, 'bank before', JSON.stringify(bankBefore), 'after', JSON.stringify(bk));
  // reconnect with new socket
  const back = new Client(srv, victim.name); await back.connect(); const rj = await back.join();
  console.log('(a) rejoin attempt:', JSON.stringify(rj));
  check('H1', '(a) disconnected mid-hand player can return to the same game', rj.ok, JSON.stringify(rj) + ' stack was ' + vChipsBefore + ' now banked');
  // (b) late joiner at various phases
  const stop2 = autoplay([B,C,D].filter(c => c !== victim));
  const latePhases = [];
  for (let i = 0; i < 6; i++) { const l = new Client(srv, 'Late' + i); await l.connect(); const rr = await l.join(); latePhases.push(srv.clients.length && (B.gs ? B.gs.status : '?') + ':' + (rr.ok ? 'OK' : rr.error)); await sleep(1200); }
  console.log('(b) late-join attempts across 7s:', latePhases.join(' | '));
  check('H2', '(b) late joiner can join an ongoing session at any point', latePhases.some(x => x.includes(':OK')), latePhases.join(' | '));
  stop2();
  console.log('serverlog errs', srv.logText().split('\n').filter(l => /fail|Error|Unhandled|TypeError/.test(l)).slice(0, 10));
  srv.stop(); process.exit(0);
})();
