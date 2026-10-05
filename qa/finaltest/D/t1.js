const { startServer, Client, waitFor, mk, sleep, check } = require('./lib');
(async () => {
  const srv = await startServer(3120, {});
  // wrong password
  let c = new Client(srv, 'pw'); await c.connect();
  let r = await c.join('pw', 'wrong'); check('A1', 'wrong password rejected', !r.ok && /password/i.test(r.error), JSON.stringify(r));
  r = await c.join('pw', undefined); check('A2', 'missing password rejected', !r.ok, JSON.stringify(r));
  r = await c.join('pw', ['ping']); check('A3', 'array password rejected', !r.ok, JSON.stringify(r));
  r = await c.join('pw', 'PING'); check('A4', 'case-different password rejected', !r.ok, JSON.stringify(r));
  c.emit('player_action', { roomId: 'POKERPING', action: 'fold' });
  await sleep(100);
  // names
  const names = ['', '   ', 'x'.repeat(200), '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', null, 12345, {a:1}, ['a']];
  const out = [];
  for (const n of names) {
    const cl = new Client(srv, 'tmp'); await cl.connect();
    const res = await cl.join(n);
    const room = cl.gs; await sleep(60);
    out.push({ sent: JSON.stringify(n).slice(0, 40), res: JSON.stringify(res), nameSeen: cl.events.filter(e => e.ev === 'room_update').slice(-1)[0]?.d.players.slice(-1)[0]?.name });
    cl.sock.disconnect(); await sleep(60);
  }
  console.log(JSON.stringify(out, null, 1));
  // duplicate names
  const a = new Client(srv, 'Dup'); await a.connect(); const ra = await a.join('Dup');
  const b = new Client(srv, 'Dup'); await b.connect(); const rb = await b.join('Dup');
  const b2 = new Client(srv, 'dup'); await b2.connect(); const rb2 = await b2.join('dup');
  const upd = a.events.filter(e => e.ev === 'room_update').slice(-1)[0]?.d;
  console.log('dup', JSON.stringify([ra, rb, rb2]), JSON.stringify(upd.players.map(p => p.name)), JSON.stringify(srv.bank()));
  // malformed payloads
  const m = new Client(srv, 'mal'); await m.connect();
  const evs = ['join_game','start_game','player_action','rebuy','drop_sticker','throw_item','chat_message','sit_out','check_balance','get_bank_summary','get_leaderboard','create_demo'];
  const payloads = [null, undefined, 0, 'str', [], [1,2], true, {}, {roomId: null}, {roomId: {a:1}}, {roomId:'POKERPING', action: {}, amount: 'x'}, {name: {toString: 1}}, {__proto__: {x:1}}];
  for (const e of evs) for (const p of payloads) { try { m.sock.emit(e, p); } catch (er) { console.log('emit throw', e, er.message); } }
  // extra args / functions
  m.sock.emit('chat_message', 1, 2, 3); m.sock.emit('join_game', () => {});
  await sleep(800);
  check('B1', 'server survives malformed payload barrage', srv.proc.exitCode === null && !srv.proc.killed, 'exitCode=' + srv.proc.exitCode);
  console.log('serverlog errors:', srv.logText().split('\n').filter(l => /fail|Error|Unhandled|TypeError/.test(l)).slice(0, 10));
  // still responsive
  const z = new Client(srv, 'Zed'); await z.connect(); const rz = await z.join('Zed');
  check('B2', 'server responsive after barrage', rz.ok, JSON.stringify(rz));
  srv.stop(); process.exit(0);
})();
