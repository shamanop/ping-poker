'use strict';
// Payload-shape contract. A scripted session (3 accounts + admin: lobby, preview, chips + Cash tables, sit, rigged showdown with a bust, rebuy, fold-win,
// show cards, chat/emote/sticker/throw, pause/update, night results, leave, admin overview, bank summaries, Bender, bonus) is replayed on the target and
// every server->client event is reduced to a recursive type skeleton (key names + value types, arrays as element skeleton, unions allowed).
// The target fails a check when it drops an event, drops a required key or gives a key a disjoint type. Extra keys/events are fine.
//   node tests/v2/30_shapes.js --target <dir> --record   records tests/v2/shapes/9440541.json (3 runs; run it only against the baseline)
//   node tests/v2/30_shapes.js --target <dir>            compares. shapes/allowlist.json: { events: [names v2 removes], keys: ["event:path"] }
const fs = require('fs'), path = require('path');
const { startServer, Bot, waitFor, sleep, drive, P, rigDeck, suite, expect } = require('./lib');
const T = suite(__filename);
const SHAPES = process.env.V2_SHAPES || path.join(__dirname, 'shapes', '9440541.json');
const ALLOW = path.join(__dirname, 'shapes', 'allowlist.json');
const SKIP = new Set(['__audit', '__rig_ok', 'connect', 'disconnect', 'connect_error']);
// map-like objects whose keys are data (names, ids), collapsed to one '*' child
const DYNAMIC = new Set(['tables_mine.nightNet', 'wallet.byGame']);

// ---- skeletons: { t: [types], k: {key: skel}, e: skel, o: 1 (optional key) }
const typeOf = v => v === null ? 'null' : v === undefined ? 'undefined' : Array.isArray(v) ? 'array' : typeof v;
function skel(v, p) {
  const t = typeOf(v), s = { t: [t] };
  if (t === 'array') { let e = null; for (const x of v) e = merge(e, skel(x, p + '[]')); if (e) s.e = e; }
  else if (t === 'object') {
    s.k = {};
    if (DYNAMIC.has(p)) { let e = null; for (const x of Object.values(v)) e = merge(e, skel(x, p + '.*')); if (e) s.k['*'] = e; }
    else for (const [k, x] of Object.entries(v)) s.k[k] = skel(x, p + '.' + k);
  }
  return s;
}
function merge(a, b) {
  if (!a) return b; if (!b) return a;
  const r = { t: [...new Set([...a.t, ...b.t])].sort() };
  if (a.e || b.e) r.e = merge(a.e, b.e);
  if (a.k || b.k) {
    r.k = {};
    for (const key of new Set([...Object.keys(a.k || {}), ...Object.keys(b.k || {})])) {
      const x = a.k && a.k[key], y = b.k && b.k[key];
      r.k[key] = merge(x, y);
      if (!x || !y || x.o || y.o) r.k[key].o = 1;
    }
  }
  return r;
}
function compare(base, tgt, p, out, allow) {
  if (allow.has(p)) return;
  if (!base.t.some(x => tgt.t.includes(x))) { out.push(`${p}: type ${base.t.join('|')} -> ${tgt.t.join('|')}`); return; }
  if (base.e && tgt.e) compare(base.e, tgt.e, p + '[]', out, allow);
  if (base.k && tgt.k) for (const [k, b] of Object.entries(base.k)) {
    const sub = p + '.' + k;
    if (allow.has(sub)) continue;
    if (!tgt.k[k]) { if (!b.o) out.push(`${sub}: key dropped or renamed`); continue; }
    compare(b, tgt.k[k], sub, out, allow);
  }
}

// ---- the scripted session
async function session(srv, log) {
  const mk = async (n, admin) => { const b = await new Bot(srv, n).connect(); const r = admin ? await b.claimAdmin() : await b.signup(); if (r.__err) throw new Error(n + ' auth ' + r.__err); return b; };
  const chris = await mk('chris', true), sue = await mk('Sue'), tom = await mk('Tom'), uri = await mk('Uri');
  const all = [chris, sue, tom, uri];
  const step = async (name, fn) => { const t0 = Date.now(); try { await fn(); } catch (e) { log.push(`${name}: ${e.message}`); } if (process.env.V2_TRACE) console.log('step', name, Date.now() - t0, 'ms'); };
  const BOARD = ['3c', '8d', '9h', '4s', '5h'];
  const tt0 = Date.now(); const mark = m => { if (process.env.V2_TRACE) console.log('  mark', m, Date.now() - tt0); };
  await step('lobby', async () => {
    sue.emit('lobby_list', {}); sue.emit('table_preview', { code: 'POKERPING' }); sue.emit('tables_mine', {}); sue.emit('wallet_get'); sue.emit('bonus:status');
    sue.emit('get_leaderboard', {}); sue.emit('profile_get', {}); sue.emit('profile_get', { key: 'tom' }); sue.emit('social:feed'); sue.emit('social:biggest'); await sleep(500);
  });
  let t1;
  await step('chips-table', async () => {
    const c = await sue.req('table_create', { settings: { name: 'ShapeChips', mode: 'chips', buyIn: { min: 100, max: 100000, default: 2000 }, blinds: { sb: 25, bb: 50 }, autoStart: false, actionTimerSec: 0, rebuyLimit: 3 } }, 'table_created');
    t1 = c.table; if (!t1) throw new Error('create ' + c.__err);
    sue.emit('table_preview', { code: t1.id }); sue.emit('tables_mine', {}); sue.emit('lobby_list', {});
    // hand 1: showdown with a side pot and a bust (Uri has 500). hand 2: fold-win.
    const d1 = rigDeck([['As', 'Ad'], ['Ks', 'Kd'], ['7c', '2d']], BOARD), d2 = rigDeck([['As', 'Ad'], ['Ks', 'Kd'], ['7c', '2d']], BOARD);
    await sue.req('__rig', { decks: [d1, d2, d2, d2, d2, d2, d2] }, '__rig_ok');
    const bad = await tom.req('table_join', { tableId: t1.id, buyIn: 1 }, 'table_joined', 1500);       // error payload
    for (const [b, n] of [[sue, 2000], [tom, 2000], [uri, 500]]) { const r = await b.sit(t1.id, n); if (r.__err) throw new Error(b.name + ' sit ' + r.__err); }
    mark('after-join');
    sue.emit('table_start', { tableId: t1.id });
    await waitFor(() => sue.gs && sue.gs.status === 'playing', 5000);
    await drive([sue, tom, uri], P.allin, () => sue.showdowns.length >= 1, 20000);
    mark('after-hand1');
    await waitFor(() => uri.busts.length > 0, 8000);
    mark('after-bust');
    await waitFor(() => tom.busts.length > 0, 4000);
    uri.emit('rebuy', { roomId: t1.id, amount: 500 }); tom.emit('rebuy', { roomId: t1.id, amount: 1000 }); await sleep(500);
    if (sue.gs.status !== 'playing') sue.emit('table_start', { tableId: t1.id });          // a bust leaves the table waiting for the host
    sue.emit('chat_message', { roomId: t1.id, text: 'gg' }); sue.emit('emote', { roomId: t1.id, id: 'clap' }); sue.emit('drop_sticker', { roomId: t1.id, emoji: '🔥' });
    await sleep(200);
    const n0 = sue.showdowns.length;
    await drive([sue, tom, uri], [P.raiseTo(150), P.fold, P.fold], () => sue.showdowns.length > n0, 20000);
    mark('after-hand2'); if (process.env.V2_TRACE) console.log(JSON.stringify({ st: sue.gs.status, street: sue.gs.street, hn: sue.gs.handNum, cur: sue.gs.currentPlayerIdx, pl: sue.gs.players.map(p => [p.name, p.chips, p.roundBet, p.folded, p.sittingOut, p.connected]) }), sue.errors.slice(-2), uri.errors.slice(-2));
    await waitFor(() => sue.gs.status === 'waiting_next', 3000);
    sue.emit('show_cards', { roomId: t1.id, which: 'both' }); await sleep(200);
    sue.emit('throw_item', { roomId: t1.id, targetIdx: sue.gs.players.findIndex(p => p.name === 'Tom'), item: 'tomato' });
    sue.emit('table_pause', { tableId: t1.id, paused: true }); await sleep(200);
    sue.emit('table_update', { tableId: t1.id, patch: { blinds: { sb: 50, bb: 100 } } }); await sleep(200);
    sue.emit('table_pause', { tableId: t1.id, paused: false }); await sleep(200);
    tom.emit('sit_out', { roomId: t1.id }); await sleep(200);
    sue.emit('get_bank_summary', { roomId: t1.id, view: 'chips' }); await sleep(300);
    const s = await sue.req('night_get', { nightId: t1.nightId }, 'settle_up'); if (s.__err) throw new Error('night_get ' + s.__err);
    mark('after-night');
    sue.emit('table_kick', { tableId: t1.id, key: 'uri' }); await sleep(300);
    await tom.leave(t1.id); await sue.leave(t1.id);
  });
  let t2;
  await step('play-table', async () => {
    const c = await sue.req('table_create', { settings: { name: 'ShapePlay', mode: 'play', buyIn: { min: 200, max: 100000, default: 2000 }, blinds: { sb: 25, bb: 50 }, autoStart: false, actionTimerSec: 60 } }, 'table_created');
    t2 = c.table; if (!t2) throw new Error('create ' + c.__err);
    for (const b of [sue, tom, uri]) { const r = await b.sit(t2.id, 2000, 'play'); if (r.__err) throw new Error(b.name + ' sit ' + r.__err); }
    sue.emit('table_start', { tableId: t2.id });
    await waitFor(() => sue.gs && sue.gs.status === 'playing' && sue.gs.roomId !== t1.id, 5000);
    const n0 = sue.showdowns.length;
    await drive([sue, tom, uri], [P.raiseTo(150), P.fold, P.fold], () => sue.showdowns.length > n0, 20000);
    sue.emit('get_bank_summary', { roomId: t2.id, view: 'play' }); await sleep(300);
    const s = await sue.req('night_get', { nightId: t2.nightId }, 'settle_up'); if (s.__err) throw new Error('night_get ' + s.__err);
    sue.emit('table_clone', { tableId: t2.id }); await sleep(300);
    sue.emit('table_end_night', { tableId: t2.id }); await sleep(800);
    for (const b of [tom, uri]) await b.leave(t2.id);
  });
  await step('admin', async () => {
    chris.emit('admin_overview', {}); chris.emit('admin_bank_summary', { view: 'chips' }); chris.emit('admin_bank_summary', { view: 'play' });
    chris.emit('get_bank_summary', { roomId: 'POKERPING', view: 'chips' }); chris.emit('admin_set_play', { key: 'tom', cents: 1234500 }); await sleep(500);
  });
  await step('wallet-bonus-bender', async () => {
    sue.emit('bonus:claim'); sue.emit('wallet_topup', {}); sue.emit('g:bender:state', {});
    for (let i = 0; i < 3; i++) { sue.emit('g:bender:spin', { bet: 50, mode: 'chips' }); await sleep(150); sue.emit('g:bender:spin', { bet: 100, mode: 'play' }); await sleep(150); }
    sue.emit('achv:seen', {}); await sleep(600);
  });
  await step('profile', async () => { sue.emit('profile_update', { avatar: 'a02' }); await sleep(300); sue.emit('auth_logout', {}); await sleep(200); });
  const per = {};
  for (const b of all) for (const e of b.events) { if (SKIP.has(e.ev)) continue; (per[e.ev] ||= null); per[e.ev] = merge(per[e.ev], skel(e.d, e.ev)); }
  all.forEach(b => b.close());
  return per;
}
async function oneRun(log) {
  const srv = await startServer(0, { handDelayMs: 1200, env: { HOST_GRACE_MS: '60000' } });
  try { return await session(srv, log); } finally { await srv.stop(); }
}

(async () => {
  if (process.argv.includes('--record')) {
    const runs = [], logs = [];
    for (let i = 0; i < 3; i++) { const log = []; runs.push(await oneRun(log)); logs.push(log); }
    const events = {};
    for (const name of new Set(runs.flatMap(r => Object.keys(r)))) {
      const have = runs.filter(r => r[name]);
      let s = null; for (const r of have) s = merge(s, r[name]);
      events[name] = { required: have.length === runs.length, shape: s };
    }
    fs.writeFileSync(SHAPES, JSON.stringify({ recordedFrom: '9440541 + rig.patch', runs: runs.length, events }, null, 1));
    console.log('recorded', Object.keys(events).length, 'events;', Object.values(events).filter(e => e.required).length, 'required; step problems:', JSON.stringify(logs));
    process.exit(0);
  }
  const contract = JSON.parse(fs.readFileSync(SHAPES, 'utf8'));
  const allow = JSON.parse(fs.readFileSync(ALLOW, 'utf8'));
  const allowKeys = new Set(allow.keys || []), allowEvents = new Set(allow.events || []);
  const log = []; let got, err;
  try { got = await oneRun(log); } catch (e) { err = e; }
  await T.check('shapes-session-ran-to-the-end', [], async () => { if (err) throw err; expect(!log.length, 'session steps failed: ' + log.join(' | ')); });
  for (const [name, spec] of Object.entries(contract.events)) {
    if (!spec.required) continue;
    await T.check('shape-' + name, [], async () => {
      if (err) throw err;
      if (allowEvents.has(name)) return 'allowlisted (removed on purpose)';
      expect(got[name], `event ${name} never arrived on the target (session problems: ${log.length})`);
      const out = [];
      compare(spec.shape, got[name], name, out, new Set([...allowKeys].map(k => k.replace(':', '.')).map(k => k)));
      expect(!out.length, out.slice(0, 6).join(' ; ') + (out.length > 6 ? ` ; +${out.length - 6} more` : ''));
    });
  }
  await T.done();
})();
