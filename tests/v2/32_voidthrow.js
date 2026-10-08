'use strict';
// Money audit K6-1: no message a player can send may void a live hand. A seated player's second tab sends payloads that make
// handlers throw (auth_login with name {"toString":1}, the same at every other event): the live hand at his table is untouched, in
// the betting rounds and through the all-in run-out. Only the normal game actions move a hand.
const { startServer, waitFor, sleep, tableWith, Bot, suite, expect } = require('./lib');
const T = suite(__filename);

const HOSTILE = ['{"toString":1}', '{"valueOf":1,"toString":1}', '{"toJSON":5}', '{"__proto__":{"x":1}}', '{"constructor":1}'].map(s => JSON.parse(s));
const EVENTS = ['auth_login', 'auth_signup', 'auth_claim', 'auth_resume', 'profile_update', 'profile_get', 'pin_change', 'account_reset_pin', 'table_preview', 'table_clone', 'night_get', 'table_create',
  'table_join', 'sit_out', 'show_cards', 'rebuy', 'player_action', 'preselect', 'table_pause', 'table_kick', 'table_update', 'table_start', 'chat_message', 'emote', 'drop_sticker', 'get_bank_summary'];
const voids = b => b.events.filter(e => (e.ev === 'error' && e.d && e.d.code === 'hand_void') || (e.ev === 'table_event' && e.d && e.d.kind === 'void')).length;

async function burst(tab, id) {
  for (const ev of EVENTS) for (const h of HOSTILE) {
    tab.emit(ev, { name: h, pin: h, key: h, token: h, tableId: id, roomId: id, amount: h, settings: h, patch: h, code: id });
    tab.emit(ev, h); tab.emit(ev, { roomId: h, tableId: h });
  }
  await sleep(400);
}

(async () => {
  const srv = await startServer(0);
  await T.check('v2-k6-1-hostile-payloads-from-a-second-tab-do-not-void-the-live-hand', ['K6-1'], async () => {
    const { id, bots } = await tableWith(srv, ['Vta', 'Vtb'], [5000, 5000]);
    const [a, b] = bots;
    const tab2 = await new Bot(srv, 'Vta').connect(); const r = await tab2.login(); expect(r.account, 'second tab login: ' + JSON.stringify(r.__err));
    const turn = bots.find(x => x.myTurn()); turn.act('raise', 300); await waitFor(() => bots.some(x => x.myTurn()) && bots.find(x => x.myTurn()) !== turn, 3000);
    const callr = bots.find(x => x.myTurn()); if (callr) callr.act('call'); await sleep(250);
    expect(a.gs && a.gs.status === 'playing', 'setup: no live hand');
    const potBefore = a.gs.pot, nv = voids(a) + voids(b);
    const n0 = tab2.errorObjs.length;
    await burst(tab2, id);                                              // the second tab of Vta, mid hand
    await burst(b, id);                                                 // the other player's own socket
    expect(voids(a) + voids(b) === nv, `the live hand was voided: ${voids(a) + voids(b) - nv} void event(s)`);
    expect(a.gs.status === 'playing' && a.gs.pot === potBefore, `pot or status moved: ${potBefore} -> ${a.gs.pot} / ${a.gs.status}`);
    expect(tab2.errorObjs.length > n0 && tab2.errorObjs.some(e => e.code === 'bad_request'), 'hostile payloads were not answered with bad_request');
    expect(!/\[v2\] VOID/.test(srv.logText()), 'server logged a VOID: ' + (srv.logText().split('\n').find(l => /\[v2\] VOID/.test(l)) || ''));
    // all-in run-out, hostile traffic in the middle of it, then the hand settles and the books close
    for (let i = 0; i < 30 && a.gs.status === 'playing'; i++) {
      const t = bots.find(x => x.myTurn()); if (!t) { await sleep(120); continue; }
      t.act('raise', t.me().chips + (t.me().bet || 0)); await sleep(80); t.act('call'); t.act('check'); await sleep(100);
      if (i < 2) await burst(tab2, id);
    }
    expect(voids(a) + voids(b) === nv, 'the run-out was voided');
    await waitFor(() => a.gs.status !== 'playing' && b.gs.status !== 'playing', 15000);
    const sum = (x) => x.gs.players.reduce((s, p) => s + p.chips, 0);
    expect(sum(a) === 10000, `stacks do not add up after the hand: ${sum(a)}`);
    expect(!/\[v2\] VOID/.test(srv.logText()), 'server logged a VOID');
    tab2.close(); bots.forEach(x => x.close());
  });
  await srv.stop();
  await T.done();
})();
