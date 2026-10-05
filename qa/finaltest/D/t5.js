const { startServer, Client, waitFor, sleep, check } = require('./lib');
const fs = require('fs');
(async () => {
  const srv = await startServer(3129, {});
  const h = new Client(srv, 'Solo'); await h.connect();
  h.emit('create_demo', { name: 'Solo', avatar: 'x' });
  await waitFor(() => h.gs && h.gs.status === 'playing', 3000);
  await sleep(3000);
  const snaps = () => JSON.parse(fs.readFileSync(srv.dir + '/ledger.json', 'utf8')).filter(e => e.type === 'snapshot').length;
  const s0 = snaps(); h.sock.disconnect();
  const series = [];
  for (let i = 0; i < 9; i++) { await sleep(10000); series.push(snaps()); }
  const cpu = require('child_process').execSync(`ps -o rss=,pcpu= -p ${srv.proc.pid}`).toString().trim();
  console.log('snapshots at leave', s0, 'every 10s after:', series.join(','), 'rss/cpu', cpu);
  check('I3', 'demo room stops when only human leaves (no zombie bot-only hands)', series[series.length - 1] === series[0] || series[series.length-1] === s0+1, `snapshots ${s0} -> ${series.join(',')}`);
  srv.stop(); process.exit(0);
})();
