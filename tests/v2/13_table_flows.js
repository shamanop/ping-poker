'use strict';
// Table / host flows. M7 unplayable settings, H6 one seat per account + ghost seats, H5 admin "set money" minting, end-night mid-hand,
// blinds change mid-hand. Audit repro 13.
const { startServer, Bot, waitFor, sleep, audit, seatOf, roomOf, drive, P, moneyTotal, suite, expect } = require('./lib');
const T = suite(__filename);
(async () => {
  const srv = await startServer(0, { env: { HOST_GRACE_MS: '400' } });
  const mk = async n => { const b = await new Bot(srv, n).connect(); const r = await b.signup(); if (r.__err) throw new Error('signup ' + n + ' ' + r.__err); return b; };
  const [h, p1, p2, val] = [await mk('Host'), await mk('Pia'), await mk('Raj'), await mk('Val')];
  const create = async (s, by = h) => by.req('table_create', { settings: { name: 'Tbl', mode: 'chips', ...s } }, 'table_created', 2000);

  // a rejected create answers with an error and no table_created; a silent fix-up of the numbers is as bad as accepting them
  await T.check('table-create-rejects-big-blind-above-the-max-buy-in', ['M7'], async () => {
    const r = await create({ buyIn: { min: 10, max: 100, default: 50 }, blinds: { sb: 500, bb: 1000 } }, val);
    expect(r.__err, 'accepted: every stack would be less than one big blind');
  });
  await T.check('table-create-rejects-min-buy-in-below-the-big-blind', ['M7'], async () => {
    const r = await create({ buyIn: { min: 1, max: 100000, default: 2000 }, blinds: { sb: 25, bb: 50 } }, val);
    expect(r.__err, 'accepted a 1 chip minimum buy-in with a 50 big blind');
  });
  await T.check('table-create-rejects-or-keeps-an-unsupported-seat-count', ['M7'], async () => {
    const r = await create({ seats: 9 }, val);
    expect(r.__err || (r.table && r.table.seats === 9), `silently stored seats=${r.table && r.table.seats} for a request of 9`);
  });

  const tc = await create({ buyIn: { min: 100, max: 10000, default: 2000 }, blinds: { sb: 25, bb: 50 }, autoStart: false, actionTimerSec: 0 });
  if (!tc.table) throw new Error('create: ' + tc.__err);
  const t = tc.table;
  for (const b of [h, p1, p2]) { const r = await b.sit(t.id, 2000); if (r.__err) throw new Error('sit ' + r.__err); }
  h.emit('table_start', { tableId: t.id }); await waitFor(() => h.gs && h.gs.status === 'playing', 3000); await sleep(50);
  const a0 = moneyTotal(await audit(h));
  await T.check('blinds-change-mid-hand-applies-from-the-next-hand', [], async () => {
    const sb0 = h.gs.sb, bb0 = h.gs.bb;
    h.emit('table_update', { tableId: t.id, patch: { blinds: { sb: 100, bb: 200 } } });
    await sleep(400);
    expect(h.gs.sb === sb0 && h.gs.bb === bb0, `live hand blinds went ${sb0}/${bb0} -> ${h.gs.sb}/${h.gs.bb}`);
  });
  await T.check('end-night-mid-hand-waits-for-the-hand-then-settles-and-conserves-money', [], async () => {
    h.emit('table_end_night', { tableId: t.id });
    const settled = h.wait('settle_up', 15000);
    await drive([h, p1, p2], P.fold, () => false, 1500);        // fold the live hand out
    const s = await settled;
    expect(s, 'no settle_up after the hand finished');
    expect(s.zeroSum === true, 'settle_up zeroSum=' + s.zeroSum);
    await sleep(300);
    const m = moneyTotal(await audit(h)).total;
    expect(m === a0.total, `money changed by ${m - a0.total} after the night ended`);
  });

  const tA = (await create({ name: 'TA', autoStart: false, actionTimerSec: 0 })).table, tB = (await create({ name: 'TB', autoStart: false, actionTimerSec: 0 })).table;
  await T.check('one-seat-per-account-across-tables', ['H6'], async () => {
    const ra = await p1.sit(tA.id, 2000), rb = await p1.sit(tB.id, 2000);
    expect(!ra.__err, 'first sit failed: ' + ra.__err);
    expect(rb.__err, 'the same account sat at a second table');
  });
  await T.check('disconnect-leaves-no-connected-ghost-seat', ['H6'], async () => {
    p1.close(); await sleep(500);
    const a = await audit(h);
    const ghosts = [tA.id, tB.id].map(id => seatOf(a, id, 'Pia')).filter(s => s && s.connected);
    expect(!ghosts.length, `${ghosts.length} seat(s) of the disconnected account still marked connected`);
  });
  await T.check('admin-saving-the-shown-total-changes-nothing', ['H5'], async () => {
    const chris = await new Bot(srv, 'chris').connect(); await chris.claimAdmin();
    const r = await p2.sit(tB.id, 3000); expect(!r.__err, 'Raj sit: ' + r.__err);
    const ov = await chris.req('admin_overview', {}, 'admin_overview');
    const row = ov.accounts.find(a => a.key === 'raj'); expect(row, 'no admin_overview row for Raj');
    chris.emit('bank_set', { name: 'Raj', balance: row.balance }); await sleep(300);
    const ov2 = await chris.req('admin_overview', {}, 'admin_overview');
    const row2 = ov2.accounts.find(a => a.key === 'raj');
    expect(row2.balance === row.balance, `the total Raj is shown with went ${row.balance} -> ${row2.balance} after saving the same value`);
  });
  await srv.stop();
  await T.done();
})();
