// Money 1008 R2B-5: a socket holds a seat only while it is signed in as that seat's account.
// Exit 1 while the fault exists (a socket that sat Ann down and then signs in as Mal / signs out keeps Ann's seat connected and is sent her hole cards after her PIN change), exit 0 when fixed.
// Boots server.js through tests/v2/lib.js on SEAT_PORT (default 4890) and the next port; no argument runs `relogin` and `logout`.
'use strict';
const H = require('./v2/lib.js'); const fs = require('fs'), os = require('os'), path = require('path');
const BASE = Number(process.env.SEAT_PORT) || 4890;
async function run(mode, port) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'ppseat-'));
  const srv = await H.startServer(port, { rig: true, dir, env: { SIGNUP_PLAY_CENTS: '0' } });
  const out = []; const faults = [];
  const adm = new H.Bot(srv, 'chris'); await adm.connect(); await adm.claimAdmin();
  const s1 = new H.Bot(srv, 'Ann'); await s1.connect(); await s1.signup('1234');         // the old device (someone who knew the PIN)
  const mal = new H.Bot(srv, 'Mal'); await mal.connect(); await mal.signup('5555');
  let n = 0; const cash = (key, c) => adm.req('admin_set_play', { key, cents: c, opId: 'p4.' + (++n) }, 'admin_result', 3000);
  await cash('ann', 100000); await cash('mal', 100000);
  const tc = await mal.req('table_create', { settings: { name: 'p4 cash', mode: 'play', buyIn: { min: 500, max: 100000, default: 20000 }, blinds: { sb: 50, bb: 100 }, autoStart: false, actionTimerSec: 15 } }, 'table_created', 3000);
  if (!tc.table) throw new Error('create ' + JSON.stringify(tc));
  const id = tc.table.id;
  let r = await mal.sit(id, 20000); if (r.__err) throw new Error('mal sit ' + r.__err);
  r = await s1.sit(id, 20000); if (r.__err) throw new Error('ann sit ' + r.__err);
  out.push('Ann sits at the Cash table from socket S1 with 200.00');
  // the trick
  if (mode === 'relogin') { const x = await s1.req('auth_login', { name: 'Mal', pin: '5555' }, 'auth_ok', 3000); out.push('S1 signs in as Mal on the same socket: ' + (x.account ? 'auth_ok key=' + x.account.key : JSON.stringify(x))); }
  else { const x = await s1.req('auth_logout', {}, 'auth_out', 3000); out.push('S1 signs out (auth_logout): ' + JSON.stringify(x)); }
  // Ann, on her own device, changes her PIN
  const s2 = new H.Bot(srv, 'Ann'); await s2.connect(); await s2.login('1234');
  const mark = s1.events.length;
  const ch = await s2.req('pin_change', { oldPin: '1234', newPin: '987654' }, 'ok', 3000);
  await H.sleep(300);
  const outs = s1.events.slice(mark).filter(e => e.ev === 'auth_out').length;
  out.push('Ann changes her PIN on S2: ' + JSON.stringify(ch) + ' ; auth_out on S1: ' + outs);
  const au = await H.audit(mal); const tb = au && au.tables ? au.tables.find(t => t.id === id) : null;
  // start a hand and see who gets Ann's cards
  const m2 = s1.events.length;
  mal.emit('table_start', { tableId: id });
  await H.waitFor(() => mal.gs && mal.gs.status === 'playing', 4000); await H.sleep(300);
  const seatAnn = mal.gs && mal.gs.players.find(p => String(p.name).toLowerCase() === 'ann');
  out.push('hand started: ' + (mal.gs && mal.gs.status) + ' ; Ann seat in the table view: ' + JSON.stringify(seatAnn ? { name: seatAnn.name, connected: seatAnn.connected, disconnected: seatAnn.disconnected, sittingOut: seatAnn.sittingOut, stack: seatAnn.stack, chips: seatAnn.chips } : null));
  const got = s1.events.slice(m2).filter(e => e.ev === 'your_cards' && e.d && e.d.cards && e.d.cards.length === 2);
  out.push('your_cards with two hole cards on S1 after the PIN change: ' + got.length + (got.length ? ' e.g. ' + JSON.stringify(got[0].d.cards) : '') + ' ; S2 (Ann, new PIN) got cards: ' + s2.events.filter(e => e.ev === 'your_cards' && e.d.cards && e.d.cards.length === 2).length);
  if (seatAnn && got.length) faults.push(`after Ann's PIN change the ${mode === 'relogin' ? 'socket now signed in as Mal' : 'signed-out socket'} still holds Ann's seat and is sent her hole cards (${got.length} your_cards); it got no auth_out and the seat did not go to the disconnect rule`);
  // can S1 act for Ann? (must not)
  const eb = s1.errors.length; s1.sock.emit('player_action', { roomId: id, action: 'fold' }); await H.sleep(200);
  out.push('S1 player_action fold: ' + JSON.stringify(s1.errorObjs.slice(eb).map(e => e.code)));
  const sa = mal.gs && mal.gs.players.find(p => String(p.name).toLowerCase() === 'ann');
  if (sa && sa.connected !== false) faults.push(`${mode}: Ann's seat is still connected after her PIN change`);
  console.log(mode + ':\n' + out.join('\n'));
  await srv.stop();
  return faults;
}
(async () => {
  const modes = process.argv[2] ? [process.argv[2]] : ['relogin', 'logout'];
  let all = [];
  for (let i = 0; i < modes.length; i++) all = all.concat(await run(modes[i], BASE + i));
  console.log(all.length ? 'FAIL ' + all.join('\nFAIL ') : 'PASS: a socket that changes account gives up the old account\'s seat (relogin, logout)');
  process.exit(all.length ? 1 : 0);
})().catch(e => { console.error('SCRIPT ERROR', e); process.exit(2); });
