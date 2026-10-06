'use strict';
// M5: legacy start_game with a blind interval turned on the hard-coded 10/20 schedule, so "BLINDS UP" lowered POKERPING from 25/50 to 15/30.
// Correct on both servers: POKERPING's blinds never drop below 25/50 (v2 has no start_game, so nothing escalates). Audit repro 14 (60 s is the server minimum interval, so this check takes about 70 s).
const { startServer, Bot, waitFor, sleep, suite, expect } = require('./lib');
const T = suite(__filename);
(async () => {
  const srv = await startServer(0, { autoStartMs: 3000 });
  await T.check('pokerping-blinds-never-drop-below-25-50-when-a-blind-interval-is-requested', ['M5'], async () => {
    const c = await new Bot(srv, 'chris').connect(); await c.claimAdmin();
    const p = await new Bot(srv, 'Kai').connect(); await p.signup();
    // 9440541 only makes the first legacy joiner host (needed for start_game); v2 has no join_game, so fall back to table_join
    for (const b of [c, p]) {
      const j = await b.req('join_game', { avatar: 'x', password: 'ping' }, 'room_joined', 1500);
      if (j.__err) { const r = await b.sit('POKERPING', 2000); expect(!r.__err, 'sit ' + r.__err); }
    }
    c.emit('start_game', { roomId: 'POKERPING', blindInterval: 60000 });
    let up = null; c.sock.on('blinds_up', d => { up = d; });
    const lows = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 68000) {
      const x = [c, p].find(b => b.myTurn()); if (x) x.act('fold');
      if (c.gs && c.gs.bb < 50) lows.push(`${c.gs.sb}/${c.gs.bb}`);
      await sleep(80);
    }
    expect(c.gs && c.gs.bb >= 50 && !(up && up.bb < 50) && !lows.length, `blinds dropped: blinds_up ${up ? up.sb + '/' + up.bb : 'none'}, table showed ${lows[0] || c.gs.sb + '/' + c.gs.bb}`);
  }, { timeoutMs: 100000 });
  await srv.stop();
  await T.done();
})();
