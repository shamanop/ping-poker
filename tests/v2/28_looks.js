'use strict';
// Table looks: the per-table room + table painting (public/images/ui/looks/<id>/). Default, every valid id, unknown id rejected, host patch
// reaches everyone seated and the lobby list, a non-host cannot change it, it survives a restart and a clone.
const { startServer, Bot, waitFor, sleep, suite, expect } = require('./lib');
const T = suite(__filename);
const IDS = ['basement', 'yacht', 'miami', 'redroom', 'ranch', 'vault', 'saucer'];
(async () => {
  const srv = await startServer(0, {});
  const mk = async n => { const b = await new Bot(srv, n).connect(); const r = await b.signup(); if (r.__err) throw new Error('signup ' + n + ' ' + r.__err); return b; };
  const [h, p1, p2] = [await mk('Hosta'), await mk('Pia'), await mk('Raj')];
  const create = async (s, by = h) => by.req('table_create', { settings: { name: 'Look tbl', mode: 'chips', isPrivate: false, autoStart: false, actionTimerSec: 0, ...s } }, 'table_created', 2000);

  await T.check('look-defaults-to-basement-on-create-and-on-the-permanent-table', [], async () => {
    const r = await create({}); expect(r.table, 'create failed: ' + r.__err);
    expect(r.table.look === 'basement', 'created table look=' + r.table.look);
    const lt = await p1.req('lobby_list', {}, 'lobby_tables', 2000);
    const perm = lt.tables.find(x => x.id === 'POKERPING'); expect(perm && perm.look === 'basement', 'permanent table look=' + (perm && perm.look));
  });
  await T.check('every-valid-look-id-is-accepted-on-create-and-echoed', [], async () => {
    for (const [i, id] of IDS.entries()) {
      const by = await mk('Lk' + 'abcdefg'[i]);
      const r = await create({ look: id }, by); expect(r.table, `${id}: create failed: ${r.__err}`);
      expect(r.table.look === id, `${id}: stored as ${r.table.look}`);
      by.close();
    }
  });
  await T.check('unknown-look-id-is-rejected-on-create-without-digits-or-dollar-in-the-message', [], async () => {
    for (const bad of ['disco', '', 'Yacht', 7, null, ['yacht'], { id: 'yacht' }]) {
      const r = await create({ look: bad });
      expect(r.__err, `accepted look ${JSON.stringify(bad)}`);
      expect(!r.table, 'a table came back for a bad look');
    }
    const e = h.errorObjs.filter(x => x && x.field === 'look');
    expect(e.length, 'no error carried field=look');
    expect(e.every(x => !/[0-9$]/.test(x.message || '')), 'a look rejection message has a digit or $: ' + e.map(x => x.message).join(' | '));
  });

  const tc = await create({ look: 'yacht' }); expect(tc.table, 'create: ' + tc.__err);
  const t = tc.table;
  for (const b of [h, p1, p2]) { const r = await b.sit(t.id, 2000); if (r.__err) throw new Error('sit ' + r.__err); }
  await waitFor(() => p1.gs && p2.gs && h.gs, 3000);

  await T.check('seated-clients-get-the-look-in-game-state', [], async () => {
    expect(p1.gs.table && p1.gs.table.look === 'yacht', 'p1 game_state table.look=' + (p1.gs.table && p1.gs.table.look));
    expect(p2.gs.table && p2.gs.table.look === 'yacht', 'p2 game_state table.look=' + (p2.gs.table && p2.gs.table.look));
  });
  await T.check('host-patch-changes-the-look-for-everyone-seated-without-a-reload', [], async () => {
    for (const id of ['vault', 'saucer', 'basement', 'ranch']) {
      h.emit('table_update', { tableId: t.id, patch: { look: id } });
      expect(await waitFor(() => p1.gs.table.look === id && p2.gs.table.look === id && h.gs.table.look === id, 3000), `${id}: seated clients show ${p1.gs.table.look}/${p2.gs.table.look}/${h.gs.table.look}`);
    }
    const ev = p1.events.filter(e => e.ev === 'table_event' && e.d.kind === 'updated' && e.d.table && e.d.table.look === 'ranch');
    expect(ev.length, 'no table_event updated carried look=ranch');
  });
  await T.check('look-change-shows-in-the-lobby-list', [], async () => {
    const lt = await p1.req('lobby_list', {}, 'lobby_tables', 2000);
    const row = lt.tables.find(x => x.id === t.id); expect(row, 'table not listed'); expect(row.look === 'ranch', 'lobby look=' + row.look);
  });
  await T.check('non-host-cannot-change-the-look', [], async () => {
    const n = p1.errors.length;
    p1.emit('table_update', { tableId: t.id, patch: { look: 'saucer' } }); await sleep(400);
    expect(p1.errors.length > n, 'no error for a non-host patch');
    expect(h.gs.table.look === 'ranch' && p1.gs.table.look === 'ranch', 'look moved to ' + h.gs.table.look);
  });
  await T.check('host-patch-with-an-unknown-look-is-rejected-and-leaves-the-look', [], async () => {
    const n = h.errorObjs.length;
    h.emit('table_update', { tableId: t.id, patch: { look: 'disco' } }); await sleep(400);
    const e = h.errorObjs.slice(n); expect(e.length, 'no error for an unknown look');
    expect(e.every(x => !/[0-9$]/.test(x.message || '')), 'message has a digit or $: ' + e.map(x => x.message).join(' | '));
    expect(h.gs.table.look === 'ranch', 'look moved to ' + h.gs.table.look);
  });
  await T.check('look-can-change-mid-hand-and-the-hand-is-untouched', [], async () => {
    h.emit('table_start', { tableId: t.id }); expect(await waitFor(() => h.gs.status === 'playing', 4000), 'hand did not start');
    const hn = h.gs.handNo, pot = h.gs.pot;
    h.emit('table_update', { tableId: t.id, patch: { look: 'miami' } });
    expect(await waitFor(() => p2.gs.table.look === 'miami', 3000), 'look did not change mid-hand: ' + p2.gs.table.look);
    expect(h.gs.status === 'playing' && h.gs.handNo === hn && h.gs.pot === pot, 'the live hand changed');
  });
  await T.check('look-survives-a-server-restart-and-a-clone', [], async () => {
    await sleep(400);
    await srv.stop('SIGTERM');
    const s2 = await srv.restart();
    const b = await new Bot(s2, 'Hosta').connect(); const r = await b.login(); expect(!r.__err, 'login: ' + r.__err);
    const mine = await b.req('tables_mine', {}, 'tables_mine', 3000);
    const row = (mine.tables || []).find(x => x.id === t.id); expect(row, 'table gone after restart'); expect(row.look === 'miami', 'look after restart=' + row.look);
    const c = await b.req('table_clone', { tableId: t.id }, 'table_created', 3000); expect(c.table, 'clone: ' + c.__err);
    expect(c.table.look === 'miami', 'clone look=' + c.table.look);
    await s2.stop();
  });
  await T.done();
})();
