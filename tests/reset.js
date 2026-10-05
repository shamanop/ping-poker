'use strict';
const { startServer, mk, waitFor, sleep } = require('./lib.js');
(async () => {
  const srv = await startServer(3957, { chris: 10000, liam: 7000 });
  let fail = 0;
  const check = (ok, msg) => { console.log(ok ? 'PASS' : 'FAIL', msg); if (!ok) fail++; };
  const total = c => c.me().chips + (srv.bank()[c.name.toLowerCase()] || 0);
  try {
    const [a, b] = await mk(srv, ['Chris', 'Liam']);
    await waitFor(() => a.gs && a.gs.status === 'playing', 8000);
    const t0 = { a: 10000, b: 7000 };
    const mover = a.myTurn() ? a : b;
    mover.act('raise', 200); await sleep(300);
    check(a.gs.pot > 30, 'chips are in the pot before reset');
    a.emit('reset_table'); await sleep(300);
    check(a.errors.some(e => /Pause the table first/.test(e || '')), 'reset refused while not paused');
    a.emit('set_pause', { paused: true }); await waitFor(() => a.gs.paused, 2000);
    b.emit('reset_table'); await sleep(300);
    check(b.errors.some(e => /Only Chris/.test(e || '')), 'non-Chris cannot reset');
    const hn = a.gs.handNum;
    a.emit('reset_table', { amount: 50 }); await sleep(300);
    check(a.errors.some(e => /Starting stack/.test(e || '')) && a.gs.paused, 'tiny/invalid stack rejected');
    a.emit('reset_table', { amount: 3000 });
    await waitFor(() => !a.gs.paused && a.gs.pot === 0, 3000);
    check(!a.gs.paused && !b.gs.paused, 'reset unpauses the table');
    check(a.gs.pot === 0 && a.gs.community.length === 0, 'pot and board cleared');
    check(total(a) === 3000 && total(b) === 3000 && srv.bank().chris === 0 && srv.bank().liam === 0, `everyone's total set to the chosen stack (Chris ${total(a)}, Liam ${total(b)})`);
    check(a.me().chips === 3000 && b.me().chips === 3000, 'both re-seated with the chosen 3000 stacks');
    await waitFor(() => a.gs.status === 'playing' && a.gs.handNum === hn + 1, 6000);
    check(a.gs.status === 'playing' && a.gs.handNum === hn + 1, 'new game deals automatically');
    check(total(a) + total(b) + a.gs.pot === 6000, 'money conserved after new deal');
  } catch (e) { console.log('ERR', e); fail++; }
  srv.stop(); process.exit(fail ? 1 : 0);
})();
