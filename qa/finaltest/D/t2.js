const { startServer, Client, waitFor, mk, sleep, check } = require('./lib');
const total = (srv, c) => { const b = srv.bank(); let t = Object.values(b).reduce((a, x) => a + x, 0); for (const p of c.gs.players) t += p.chips; t += c.gs.pot; return t; };
(async () => {
  let srv = await startServer(3121, {});
  let c = new Client(srv, 'pw'); await c.connect();
  let r = await c.join('pw', null); check('A2', 'null password rejected', !r.ok, JSON.stringify(r));
  // double join same socket
  const d = new Client(srv, 'Dbl'); await d.connect(); await d.join(); await d.join(); await d.join();
  await sleep(100);
  const ru = d.events.filter(e => e.ev === 'room_update').slice(-1)[0].d.players.map(p => p.name);
  check('A5', 'same socket cannot take multiple seats (double-click join)', ru.length === 1, 'seats=' + JSON.stringify(ru) + ' bank=' + JSON.stringify(srv.bank()));
  srv.stop(); await sleep(300);

  srv = await startServer(3122, {});
  const [A, B, C] = await mk(srv, ['Ann', 'Bob', 'Cy']);
  A.emit('start_game', { roomId: 'POKERPING' });
  await waitFor(() => [A, B, C].every(x => x.gs && x.gs.status === 'playing'));
  await sleep(200);
  const start = total(srv, A);
  const order = [A, B, C];
  const cur = () => order[A.gs.currentPlayerIdx];
  const notCur = () => order.filter(x => x !== cur());
  // out-of-turn spam
  const e0 = notCur().map(x => x.errors.length);
  for (let i = 0; i < 30; i++) for (const x of notCur()) { x.act(['fold','call','raise','check'][i % 4], 100); }
  await sleep(300);
  const errs = notCur().map((x, i) => x.errors.length - e0[i]);
  check('C1', 'out-of-turn actions rejected, state unchanged', A.gs.status === 'playing' && order.every(x => !x.me().folded) && total(srv, A) === start, 'errors per spammer=' + errs.join(',') + ' folded=' + order.map(x => x.me().folded));
  // invalid actions as current
  const bad = [['raise', -50], ['raise', 0], ['raise', 1], ['raise', NaN], ['raise', Infinity], ['raise', 1.5], ['raise', '100'], ['raise', null], ['raise', undefined], ['raise', 1e308], ['raise', {}], ['bogus', 1], [null, 1], [{}, 1], ['check']];
  const rows = [];
  for (const [a, amt] of bad) {
    if (A.gs.status !== 'playing') break;
    const x = cur(); const before = x.me().chips + x.me().roundBet; const ne = x.errors.length;
    const cb = A.gs.currentBet;
    x.act(a, amt); await sleep(120);
    rows.push({ a, amt: String(amt), err: x.errors.slice(ne).join('|') || '-', curBet: `${cb}->${A.gs.currentBet}`, pot: A.gs.pot, cur: A.gs.currentPlayerIdx, conserved: total(srv, A) === start });
  }
  console.log(JSON.stringify(rows));
  check('C2', 'chips conserved across invalid action barrage', rows.every(r => r.conserved), 'rows=' + rows.length);
  // min raise: raise to 1 when current acts
  console.log('state', A.gs.street, A.gs.currentBet, A.gs.pot, A.gs.players.map(p => p.chips + '/' + p.roundBet));
  // all-in above stack
  while (A.gs.status !== 'playing') await sleep(100);
  const x = cur(); x.act('raise', 999999); await sleep(200);
  check('C3', 'raise above stack becomes all-in (capped), no negative chips', A.gs.players.every(p => p.chips >= 0) && total(srv, A) === start, 'chips=' + A.gs.players.map(p => p.name + ':' + p.chips + (p.allIn ? '(allin)' : '')).join(' '));
  // play it out with everyone calling
  for (let i = 0; i < 80 && A.gs.status === 'playing'; i++) { const y = cur(); if (!y) { await sleep(100); continue; } y.act('call', 0); await sleep(60); }
  await waitFor(() => A.gs.status === 'waiting_next', 20000);
  console.log('after hand', A.gs.players.map(p => p.name + ':' + p.chips), 'total ok', total(srv, A) === start);
  // rebuy with chips>0 + weird amounts
  const ne = B.errors.length; B.emit('rebuy', { roomId: 'POKERPING', amount: -500 }); B.emit('rebuy', { roomId: 'POKERPING', amount: 0 }); B.emit('rebuy', { roomId: 'POKERPING', amount: 1e12 }); await sleep(200);
  const bankBefore = JSON.stringify(srv.bank());
  check('D1', 'rebuy with chips>0 rejected for 0/neg/huge amounts', B.errors.length > ne || B.me().chips === 0, 'errors=' + B.errors.slice(ne).join('|') + ' chips=' + B.me().chips + ' bank=' + bankBefore);
  fs = require('fs'); fs.writeFileSync('t2.out.json', JSON.stringify({ rows }, null, 1));
  console.log(srv.logText().split('\n').filter(l => /fail|Error|Unhandled|TypeError/.test(l)).slice(0, 10));
  srv.stop(); process.exit(0);
})();
