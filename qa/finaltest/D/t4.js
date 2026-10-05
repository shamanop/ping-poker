const { startServer, Client, waitFor, mk, sleep, check } = require('./lib');
const fs = require('fs');
(async () => {
  // ---- demo with 1 human
  let srv = await startServer(3126, {});
  const h = new Client(srv, 'Solo'); await h.connect();
  let roomId = null; h.sock.on('room_joined', d => roomId = d.roomId);
  h.emit('create_demo', { name: 'Solo', avatar: 'x' });
  await waitFor(() => h.gs && h.gs.status === 'playing', 3000);
  check('I1', 'demo with 1 human + 3 bots starts and deals', h.gs && h.gs.players.length === 4 && h.cards.length === 2, `players=${h.gs && h.gs.players.map(p=>p.name+(p.isBot?'(bot)':'')).join(',')} cards=${h.cards.length} room=${roomId}`);
  // play 6 hands: human check/calls; track handNum and bots acting
  let hands = new Set(); const errs0 = h.errors.length;
  const t0 = Date.now();
  while (Date.now() - t0 < 60000 && hands.size < 6) {
    hands.add(h.gs.handNum);
    if (h.myTurn()) { h.sock.emit('player_action', { roomId, action: h.gs.currentBet > h.me().roundBet ? 'call' : 'check' }); await sleep(100); }
    else await sleep(80);
  }
  check('I2', 'demo plays multiple hands with bots acting', hands.size >= 6, `hands=${[...hands].join(',')} elapsed=${((Date.now()-t0)/1000).toFixed(0)}s errors=${h.errors.slice(errs0).join('|')||'none'}`);
  // human sits out then leaves -> zombie?
  const ledgerLen = () => JSON.parse(fs.readFileSync(srv.dir + '/ledger.json', 'utf8')).length;
  const bankBefore = srv.bank().solo, ll0 = ledgerLen();
  const stackBefore = h.me().chips;
  h.sock.disconnect(); await sleep(500);
  const l1 = ledgerLen(); await sleep(25000); const l2 = ledgerLen();
  console.log('demo zombie check: ledger entries after leave', l1, '-> +25s', l2, ' bank solo', bankBefore, '->', srv.bank().solo, 'stack was', stackBefore);
  check('I3', 'demo room stops when the only human leaves (no zombie bot-only hands)', l2 === l1, `ledger ${l1} -> ${l2} over 25s`);
  srv.stop(); await sleep(300);

  // ---- turn timer expiry
  srv = await startServer(3127, {});
  const [A, B, C] = await mk(srv, ['Ann', 'Bob', 'Cy']);
  A.emit('start_game', { roomId: 'POKERPING' });
  await waitFor(() => A.gs && A.gs.status === 'playing');
  const order = [A, B, C];
  const cur0 = A.gs.currentPlayerIdx; const idler = order[cur0]; const t1 = Date.now();
  console.log('idler =', idler.name, 'turnRemainingMs', A.gs.turnRemainingMs);
  // others never act out of turn; wait for auto-fold
  await waitFor(() => A.gs.players[cur0].folded, 40000);
  const dt = (Date.now() - t1) / 1000;
  check('J1', 'turn timer auto-folds idle player (~30s)', A.gs.players[cur0].folded && dt > 28 && dt < 33, `folded after ${dt.toFixed(1)}s; log=${A.gs.log.slice(-2).join(' / ')}`);
  // does the idler keep getting seated next hand and burning 30s each?
  // others play: fold to end hand fast
  const stopAuto = (() => { let run = true; (async () => { while (run) { for (const c of [A,B,C].filter(x => x !== idler)) if (c.myTurn()) c.act('fold'); await sleep(50); } })(); return () => run = false; })();
  await waitFor(() => A.gs.handNum >= 2, 20000);
  console.log('handNum now', A.gs.handNum, 'idler sittingOut=', idler.me().sittingOut, 'connected', idler.me().connected);
  stopAuto();
  // late action after the auto-fold: idler acts after being folded
  const ne = idler.errors.length; idler.act('call'); await sleep(150);
  console.log('idler late action errors:', idler.errors.slice(ne));
  srv.stop(); await sleep(300);

  // ---- recovery workaround: everyone reloads
  srv = await startServer(3128, {});
  const [P, Q, R] = await mk(srv, ['Pat', 'Quin', 'Rae']);
  P.emit('start_game', { roomId: 'POKERPING' });
  await waitFor(() => P.gs && P.gs.status === 'playing'); await sleep(300);
  Q.sock.disconnect(); await sleep(200);          // Quin drops (a)
  const retry = new Client(srv, 'Quin'); await retry.connect(); const r1 = await retry.join();
  P.sock.disconnect(); R.sock.disconnect(); await sleep(8000); // everyone else reloads, wait past next-hand timer
  const q2 = new Client(srv, 'Quin'); await q2.connect(); const r2 = await q2.join();
  const p2 = new Client(srv, 'Pat'); await p2.connect(); const r3 = await p2.join();
  const r2c = new Client(srv, 'Rae'); await r2c.connect(); const r4 = await r2c.join();
  check('K1', 'recovery: if everyone reloads, table resets and all can rejoin with banked chips', r2.ok && r3.ok && r4.ok, `rejoin while others playing=${JSON.stringify(r1)}; after all reload: ${JSON.stringify([r2,r3,r4])}; bank=${JSON.stringify(srv.bank())}`);
  const bsum = Object.values(srv.bank()).reduce((a, b) => a + b, 0), inTable = [q2,p2,r2c].reduce((a, c) => a + (c.joined ? 1500 : 0), 0);
  check('K2', 'bank + table chips conserved through disconnect/reload cycle', bsum + inTable === 30000, `bank=${bsum} inTable=${inTable}`);
  console.log('serverlog errs', srv.logText().split('\n').filter(l => /fail|Error|Unhandled|TypeError/.test(l)).slice(0, 10));
  srv.stop(); process.exit(0);
})();
