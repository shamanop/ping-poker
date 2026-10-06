'use strict';
// Q01 (P5 sweep): game_state.players[i].blind is 'SB' | 'BB' | null and names the seats that posted the blinds (engine sbSeat/bbSeat).
// The client prints it as is. Run: V2_PORT_BASE=4715 node tests/v2/31_blind_badges.js
const { startServer, waitFor, sleep, tableWith, suite, expect } = require('./lib');
const T = suite(__filename);
const stacks = n => Array(n).fill(2000);
async function firstDeal(names, o = {}) {
  const srv = await startServer(o.off || 0);
  const { bots, id } = await tableWith(srv, names, stacks(names.length), { autoStart: false }, { start: false });
  if (o.sitOut != null) { bots[o.sitOut].emit('sit_out', { roomId: id }); await sleep(200); }
  bots[0].emit('table_start', { tableId: id });
  await waitFor(() => bots[0].gs && bots[0].gs.status === 'playing', 6000); await sleep(120);
  const gs = JSON.parse(JSON.stringify(bots[0].gs)); await srv.stop(); return gs;
}
function check(gs, label) {
  const pl = gs.players;
  const sbPosted = pl.filter(p => p.roundBet === gs.sb).map(p => p.name), bbPosted = pl.filter(p => p.roundBet === gs.bb).map(p => p.name);
  const sbBadge = pl.filter(p => p.blind === 'SB').map(p => p.name), bbBadge = pl.filter(p => p.blind === 'BB').map(p => p.name);
  expect(pl.every(p => 'blind' in p), `${label}: players[*].blind missing from game_state`);
  expect(JSON.stringify(sbBadge) === JSON.stringify(sbPosted), `${label}: SB badge ${sbBadge} but the seat that posted ${gs.sb} is ${sbPosted}`);
  expect(JSON.stringify(bbBadge) === JSON.stringify(bbPosted), `${label}: BB badge ${bbBadge} but the seat that posted ${gs.bb} is ${bbPosted}`);
  expect(pl.filter(p => p.blind && p.blind !== 'SB' && p.blind !== 'BB').length === 0, `${label}: blind must be SB, BB or null`);
  expect(pl.filter(p => !p.blind).every(p => p.blind === null), `${label}: non-blind seats must carry null`);
}
(async () => {
  await T.check('headsup-blind-badges-match-posted', ['Q01'], async () => { check(await firstDeal(['Alice', 'Bobby'], { off: 0 }), 'heads-up'); });
  await T.check('three-handed-blind-badges-match-posted', ['Q01'], async () => { check(await firstDeal(['Alice', 'Bobby', 'Carol'], { off: 1 }), '3-handed'); });
  await T.check('sitting-out-seat-skipped-by-badges', ['Q01'], async () => { check(await firstDeal(['Alice', 'Bobby', 'Carol', 'Daria'], { off: 2, sitOut: 1 }), '4 seats, one sitting out'); });
  await T.done();
})();
