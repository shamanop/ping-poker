const { startServer, Client, waitFor, mk, sleep, check } = require('./lib');
const fs = require('fs'), cp = require('child_process');
const rss = pid => { try { return Number(cp.execSync(`ps -o rss= -p ${pid}`).toString().trim()) / 1024; } catch { return NaN; } };
(async () => {
  const names = ['S1','S2','S3','S4','S5','S6'];
  const srv = await startServer(3131, {});
  const cs = await mk(srv, names);
  cs[0].emit('start_game', { roomId: 'POKERPING', blindInterval: 60000 });
  await waitFor(() => cs.every(c => c.gs && c.gs.status === 'playing'));
  const pid = srv.proc.pid; const samples = [{ t: 0, mb: rss(pid) }]; const t0 = Date.now();
  let actions = 0, chats = 0, rebuys = 0, rejects = 0;
  const rnd = (a) => a[Math.floor(Math.random() * a.length)];
  // free-form chaos: random actions out of turn too
  const loops = cs.map(c => (async () => {
    while (Date.now() - t0 < 180000) {
      if (c.myTurn()) {
        const me = c.me(), toCall = c.gs.currentBet - me.roundBet, r = Math.random();
        if (r < 0.12) c.act('fold'); else if (r < 0.30) c.act('raise', c.gs.currentBet + c.gs.bb * (1 + Math.floor(Math.random() * 6)));
        else if (r < 0.34) c.act('raise', 99999); else c.act(toCall > 0 ? 'call' : 'check');
        actions++;
      } else if (Math.random() < 0.02) { c.act(rnd(['fold','call','check','raise']), 100); }   // out-of-turn noise
      if (Math.random() < 0.01) { c.emit('chat_message', { roomId: 'POKERPING', text: '<b>hi</b> ' + Math.random() }); chats++; }
      if (Math.random() < 0.01) c.emit('drop_sticker', { roomId: 'POKERPING', emoji: rnd(['🔥','💀','🎰','zz']) });
      if (Math.random() < 0.01) c.emit('throw_item', { roomId: 'POKERPING', targetIdx: Math.floor(Math.random() * 6), item: rnd(['💣','🍅','x']) });
      if (Math.random() < 0.003) c.emit('sit_out', { roomId: 'POKERPING' });
      if (c.me() && c.me().chips === 0 && c.gs.status !== 'playing') { c.emit('rebuy', { roomId: 'POKERPING' }); rebuys++; }
      if (Math.random() < 0.02) c.emit('get_bank_summary', { roomId: 'POKERPING' });
      await sleep(30 + Math.random() * 60);
    }
  })());
  const mon = (async () => { while (Date.now() - t0 < 180000) { await sleep(10000); samples.push({ t: Math.round((Date.now() - t0) / 1000), mb: rss(pid), hand: cs[0].gs.handNum, status: cs[0].gs.status, ev: cs[0].events.length }); } })();
  await Promise.all([...loops, mon]);
  const lastGs = cs[0].gs;
  const bank = srv.bank(); const bsum = Object.values(bank).reduce((a, b) => a + b, 0);
  const tbl = lastGs.players.reduce((a, p) => a + p.chips, 0) + lastGs.pot;
  console.log('samples', JSON.stringify(samples));
  console.log('hands', lastGs.handNum, 'actions', actions, 'chats', chats, 'rebuys', rebuys, 'bank+table', bsum + tbl, 'expected', 6 * 10000, 'errors per client', cs.map(c => c.errors.length).join(','));
  const errTypes = {}; cs.forEach(c => c.errors.forEach(e => errTypes[e] = (errTypes[e] || 0) + 1)); console.log('error msgs', JSON.stringify(errTypes));
  const log = srv.logText();
  const bad = log.split('\n').filter(l => /Unhandled|TypeError|ReferenceError|handler .* failed|uncaught|ERR_|RangeError/i.test(l));
  console.log('server log lines', log.split('\n').length, 'bad:', bad.slice(0, 5));
  const ledgerSize = fs.statSync(srv.dir + '/ledger.json').size;
  console.log('ledger.json bytes', ledgerSize, 'blind level at end', lastGs.blindLevel, lastGs.sb + '/' + lastGs.bb, 'exit', srv.proc.exitCode);
  const first = samples[1].mb, last = samples[samples.length - 1].mb;
  check('M1', 'soak 3 min / 6 players: server alive, no uncaught exceptions', srv.proc.exitCode === null && bad.length === 0, `hands=${lastGs.handNum} bad=${bad.length}`);
  check('M2', 'soak: chips conserved (bank + table = 60,000)', bsum + tbl === 60000, `bank+table=${bsum + tbl}`);
  check('M3', 'soak: RSS not growing unboundedly', last - first < 40, `RSS ${samples.map(s => s.mb.toFixed(0)).join('->')} MB`);
  fs.writeFileSync('soak.json', JSON.stringify({ samples, hands: lastGs.handNum, actions, errTypes, ledgerSize }, null, 1));
  srv.stop(); process.exit(0);
})();
