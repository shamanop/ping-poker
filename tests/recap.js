'use strict';
// Night recap on v2: scripted bots play real hands; the recap payload is checked against what the clients saw and against the money ledger
// (the settle-up screen). Own ports 4720-4724 (recap block). Run: node tests/recap.js   (never inside tests/v2/run.js: that suite owns 3500-3559)
const os = require('os'), path = require('path'), fs = require('fs');
const { startServer, Bot, waitFor, sleep, tableWith, drive, P, rigDeck, audit, suite, expect, expectEq } = require('./v2/lib');
const engine = require('../engine/hand');
const { makeDeck } = require('../engine/deck');
const { createRecap } = require('../recap');
const T = suite(__filename);
// RECAP_ONLY=<regex> runs just the matching checks (used to prove a new check fails on the old code); the checks after a skipped one may then fail on missing state.
if (process.env.RECAP_ONLY) { const re = new RegExp(process.env.RECAP_ONLY), orig = T.check; T.check = (name, tags, fn) => (re.test(name) ? orig(name, tags, fn) : Promise.resolve()); }
const PORT = Number(process.env.RECAP_TEST_PORT) || 4720;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ppre-'));
const dirs = [];
const mkdir = () => { const d = tmp(); dirs.push(d); return d; };


// ---- unit helpers: a recorder fed by hand with real engine hands (no server) ---------------------------------------
const noop = () => {};
const quiet = { log: noop };
function fakeRegistry(t, perKey) {
  const tables = new Map([[t.id, t]]);
  return { tables, get: id => tables.get(id), nightOf: () => ({ perKey: perKey || {} }) };
}
function fakeTable(o = {}) {
  const t = { id: 'T1', nightId: 'N1', name: 'Unit night', mode: 'chips', unit: 'chips', hostKey: 'host', state: 'live', createdAt: 1, handNo: 0, nightHand0: 0, hand: null, seats: new Map(), button: 0, handStartStacks: {}, ...o };
  t.displayOf = k => k.toUpperCase();
  return t;
}
// Deal an engine hand on `t` for [{seat,key,stack}] with the given button, like tables/hand-flow.js does, then fire hand_start.
function dealOn(rec, t, players, button) {
  t.handNo += 1;
  t.seats = new Map(players.map(p => [p.seat, { key: p.key, seat: p.seat }]));
  t.handStartStacks = Object.fromEntries(players.map(p => [p.seat, p.stack]));
  t.hand = engine.createHand({ handNo: t.handNo, button, sb: 25, bb: 50, seats: players.map(p => ({ seat: p.seat, stack: p.stack })), deck: makeDeck() });
  rec.onEvent(t, 'hand_start', { handNo: t.handNo, button });
  return t.hand;
}
function finishOn(rec, t) {
  const h = t.hand;
  while (h.phase === 'runout') rec.onEngine(t, engine.dealNext(h));
  const result = engine.settle(h);
  const bySeat = {}; for (const [no, s] of t.seats) bySeat[no] = s;
  rec.onEvent(t, 'hand_end', { hand: h, result, bySeat });
  return result;
}
const goodHand = (n, over = {}) => ({
  t: 1000 + n, tableId: 'T1', nightId: 'N1', mode: 'chips', unit: 'chips', handNo: n, handNum: n, sb: 25, bb: 50, pot: 100, showdown: false, board: [],
  players: [{ key: 'a', name: 'A', seat: 0, start: 1000, cards: ['A♠', 'K♠'], bet: 50, end: 1050, net: 50 }, { key: 'b', name: 'B', seat: 1, start: 1000, cards: ['2♣', '7♦'], bet: 50, end: 950, net: -50, folded: true }],
  actions: [{ k: 'a', street: 'preflop', a: 'sb', put: 25, to: 25, pot: 25 }, { k: 'b', street: 'preflop', a: 'bb', put: 50, to: 50, pot: 75 }, { k: 'b', street: 'preflop', a: 'fold', put: 0, to: 50, pot: 75 }],
  winners: [{ key: 'a', name: 'A', amount: 100, handName: null }], ...over,
});

// ---- policies -------------------------------------------------------------------------------------------------
const call = P.call;
const mix = {
  0: (b, i) => (i.handNum % 3 === 0 && i.street === 'preflop' && i.currentBet <= i.gs.bb && i.maxTo >= i.gs.bb * 4 ? ['raise', i.gs.bb * 4] : call(b, i)),
  1: (b, i) => (i.handNum % 7 === 0 ? P.raiseTo(i.gs.bb * 10)(b, i) : call(b, i)),
  2: (b, i) => (i.toCall > 0 && i.handNum % 2 === 0 ? ['fold'] : call(b, i)),
};
const sumNet = r => r.players.reduce((s, p) => s + p.net, 0);

// A night played to completion. Returns everything the checks need.
async function night(srv, names, stacks, settings) {
  const { id, bots, table } = await tableWith(srv, names, stacks, { autoStart: true, ...settings }, { start: false });
  const A = bots[0];
  const ok = await drive(bots, [mix[0], mix[1], mix[2]], () => A.showdowns.length >= 20, 120000);
  if (!ok) throw new Error('only ' + A.showdowns.length + ' hands played');
  // live read: the recap net must equal the settle-up payload read at the same moment (night_get serves the same numbers)
  let live = null;
  for (let tries = 0; tries < 4 && !live; tries++) {
    const r = await A.req('recap_get', { nightId: table.nightId }, 'recap_data'), n = await A.req('night_get', { nightId: table.nightId }, 'settle_up');
    const same = !r.__err && !n.__err && n.players.every(p => (r.players.find(x => x.key === p.key) || {}).net === p.net);
    if (same) live = { recap: r, settle: n };
    else await sleep(60);
  }
  const p = A.wait('settle_up', 25000);
  A.emit('table_end_night', { tableId: id });
  const settle = await p;
  if (!settle) throw new Error('no settle_up');
  await sleep(150);
  return { id, bots, table, nightId: table.nightId, settle, live, seen: A.showdowns.slice() };
}

(async () => {
  const dir1 = mkdir();
  const srv = await startServer(PORT, { dir: dir1, handDelayMs: 250, autoStartMs: 200 });
  let N = null, PN = null;

  // ======== chips night ========
  await T.check('chips-night-recap-matches-clients-and-settle-up', ['recap'], async () => {
    N = await night(srv, ['Ann', 'Bo', 'Cy'], [8000, 8000, 8000], { name: 'Recap night' });
    const [A] = N.bots;
    const R = await A.req('recap_get', { nightId: N.nightId }, 'recap_data');
    expect(!R.__err, 'recap_get: ' + R.__err);
    expect(R.scope.kind === 'night' && R.scope.ended === true && R.scope.unit === 'chips', 'scope: ended chips night');
    expectEq(R.hands.length, N.seen.length, 'hand count vs showdown_result events');
    expectEq(R.totals.handNetSum, 0, 'hand nets sum');
    expect(R.hands.every(h => h.players.reduce((s, p) => s + p.net, 0) === 0), 'a hand does not net to zero');
    expect(R.hands.every(h => h.players.reduce((s, p) => s + p.bet, 0) === h.pot), 'a hand pot differs from the sum of what players put in');
    expectEq(R.hands.map(h => h.pot), N.seen.map(s => s.pot), 'pots in order vs what clients saw');
    expectEq(R.superlatives.find(s => s.id === 'bigpot').value, Math.max(...N.seen.map(s => s.pot)), 'biggest pot');
    const byName = Object.fromEntries(R.players.map(p => [p.name, p]));
    expect(['Ann', 'Bo', 'Cy'].every(n => byName[n]), 'all three players present');
    const settleBy = Object.fromEntries(N.settle.players.map(p => [p.display, p.net]));
    for (const n of ['Ann', 'Bo', 'Cy']) {
      expectEq(byName[n].net, settleBy[n], n + ' recap net vs settle_up net');
      expectEq(byName[n].handNet, settleBy[n], n + ' sum of hand nets vs settle_up net');
    }
    expectEq(sumNet(R), 0, 'night nets sum');
    expect(R.players[0].net >= R.players[1].net && R.players[1].net >= R.players[2].net, 'standings not sorted by net');
    const tally = {}; for (const x of N.seen) for (const w of new Set(x.winners.filter(z => z.amount > 0).map(z => z.name))) tally[w] = (tally[w] || 0) + 1;
    for (const n of ['Ann', 'Bo', 'Cy']) expectEq(byName[n].won, tally[n] || 0, n + ' hands won vs showdown_result winners');
    const mw = R.superlatives.find(s => s.id === 'mostwins');
    expect(!mw || mw.value === Math.max(...Object.values(tally)), 'most-wins superlative');
    expect(R.superlatives.every(s => s.names.length && s.names.every(n => byName[n])), 'a superlative names nobody');
    expect(R.hands.every(h => h.actions.length >= 2 && h.actions[0].a === 'sb' && h.actions[1].a === 'bb'), 'a hand log does not start with SB, BB');
    expect(R.hands.some(h => h.actions.some(a => a.a === 'raise')), 'no raise was logged');
    expectEq(R.hands.filter(h => h.showdown).length, N.seen.filter(s => s.reveals && s.reveals.length).length, 'showdown count');
    const bh = R.superlatives.find(s => s.id === 'besthand');
    expect(!R.hands.some(h => h.showdown) || (bh && bh.cards.length === 2 && bh.board.length === 5), 'best hand lacks cards');
    expect(!R.notes.some(n => /memory|restart/i.test(n)), 'the old Play $ memory-only note is back');
    return `${R.hands.length} hands, nets ${JSON.stringify(settleBy)}`;
  });

  await T.check('live-recap-net-equals-live-settle-payload', ['recap'], async () => {
    expect(N.live, 'recap and night_get never agreed while the night was live');
    return JSON.stringify(N.live.recap.players.map(p => [p.name, p.net]));
  });

  await T.check('hidden-cards-not-leaked-own-cards-shown', ['recap'], async () => {
    const [A] = N.bots;
    const R = await A.req('recap_get', { nightId: N.nightId }, 'recap_data');
    expect(R.hands.every(h => { const me = h.players.find(p => p.name === 'Ann'); return !me || (me.cards[0] && me.cards[1]); }), 'viewer does not see own hole cards');
    const leaked = R.hands.flatMap(h => h.players.filter(p => p.name !== 'Ann' && !(h.showdown && !p.folded && p.hand) && (p.cards[0] || p.cards[1])));
    expectEq(leaked.length, 0, 'unshown opponent cards sent');
    expect(R.hands.some(h => h.players.some(p => p.name !== 'Ann' && p.cards[0])), 'showdown hands never revealed an opponent (test saw no showdown)');
  });

  await T.check('access-control-stranger-refused-participant-and-admin-allowed', ['recap'], async () => {
    const Z = await new Bot(srv, 'Zed').connect(); await Z.signup();
    const rz = await Z.req('recap_get', { nightId: N.nightId }, 'recap_data', 1500);
    expect(rz.__err && Z.errorObjs.some(e => e && e.code === 'recap' && e.message === 'No such night'), 'a stranger got the recap: ' + JSON.stringify(rz).slice(0, 120));
    const rz2 = await Z.req('recap_get', { tableId: N.id }, 'recap_data', 1500);
    expect(rz2.__err, 'a stranger got the recap through the table id');
    const rb = await N.bots[1].req('recap_get', { nightId: N.nightId }, 'recap_data');
    expect(!rb.__err && rb.hands.length === N.seen.length, 'another participant did not get the same recap');
    const ad = await new Bot(srv, 'chris').connect(); const c = await ad.claimAdmin(); expect(!c.__err, 'admin claim: ' + c.__err);
    const ra = await ad.req('recap_get', { nightId: N.nightId }, 'recap_data');
    expect(!ra.__err && ra.hands.length === N.seen.length, 'admin cannot open a night');
    const leak = ra.hands.flatMap(h => h.players.filter(p => !(h.showdown && !p.folded && p.hand) && (p.cards[0] || p.cards[1])));
    expectEq(leak.length, 0, 'admin was sent cards that were never shown');
    const nobody = await new Bot(srv, 'Yan').connect();
    nobody.emit('recap_get', { nightId: N.nightId }); await sleep(300);
    expect(nobody.errorObjs.some(e => e && e.code === 'auth'), 'signed-out socket was not refused');
    [Z, ad, nobody].forEach(b => b.close());
  });

  // ======== Play $ night ========
  await T.check('play-dollar-night-recap-net-equals-settle-up-net', ['recap'], async () => {
    PN = await night(srv, ['Pam', 'Quin', 'Rex'], [20000, 20000, 20000], { name: 'Play recap', mode: 'play', unit: 'cents' });
    const [A] = PN.bots;
    const R = await A.req('recap_get', { nightId: PN.nightId }, 'recap_data');
    expect(!R.__err, 'recap_get: ' + R.__err);
    expect(R.scope.unit === 'cents' && R.scope.mode === 'play' && R.scope.ended, 'scope: ended Play $ night');
    expectEq(R.hands.length, PN.seen.length, 'hand count');
    expectEq(R.totals.handNetSum, 0, 'hand nets sum');
    const settleBy = Object.fromEntries(PN.settle.players.map(p => [p.display, p.net]));
    const byName = Object.fromEntries(R.players.map(p => [p.name, p]));
    for (const n of ['Pam', 'Quin', 'Rex']) expectEq(byName[n].net, settleBy[n], n + ' recap net vs settle_up net');
    expectEq(sumNet(R), 0, 'night nets sum');
    expect(PN.live, 'live recap and night_get never agreed');
    expect(!R.notes.some(n => /memory|restart/i.test(n)), 'memory-only note present');
    return JSON.stringify(settleBy);
  });

  // ======== all-in with an uncalled bet handed back ========
  let scripted = null;
  const deck = rigDeck([['As', 'Ad'], ['Kh', 'Kd']], ['2c', '5d', '9h', 'Jc', '3s']);
  async function scriptedHand(s, names) {
    const { id, bots } = await tableWith(s, names, [1000, 400], { name: 'Shove' }, { decks: [deck, deck, deck], start: false });
    bots[0].emit('table_start', { tableId: id });
    await drive(bots, P.allin, () => bots[0].showdowns.length >= 1, 15000);
    await sleep(200);
    const a = await audit(bots[0]);
    return { id, bots, sd: bots[0].showdowns[0], bank: Object.fromEntries(bots.map(b => [b.name, a.bank[b.key]])) };
  }
  await T.check('allin-uncalled-return-is-not-a-win', ['recap'], async () => {
    scripted = await scriptedHand(srv, ['Gus', 'Hal']);
    const [G] = scripted.bots;
    const R = await G.req('recap_get', { tableId: scripted.id }, 'recap_data');
    expect(!R.__err, 'recap_get: ' + R.__err);
    const h = R.hands[0];
    expectEq(R.hands.length, 1, 'hands');
    expectEq(h.pot, scripted.sd.pot, 'recap pot vs showdown_result pot');
    expectEq(h.pot, 800, 'pot is the called part only');
    const g = h.players.find(p => p.name === 'Gus'), hl = h.players.find(p => p.name === 'Hal');
    expect(g.net === 400 && hl.net === -400 && g.bet === 400, `nets ${g.net}/${hl.net} bet ${g.bet}`);
    const back = h.actions.find(a => a.a === 'back');
    expect(back && back.put === -600 && back.key === g.key, 'the 600 handed back is not in the log: ' + JSON.stringify(h.actions.map(a => a.a + ':' + a.put)));
    expect(h.actions.filter(a => a.allIn).length >= 2, 'all-in flags missing');
    expect(h.showdown && h.winners.length === 1 && h.winners[0].amount === 800, 'winner amount is the pot');
    expectEq(h.board.length, 5, 'board');
    expect(R.superlatives.find(s => s.id === 'bigwin').value === 400, 'biggest win counts the return');
  });

  // ======== POKERPING sessions ========
  await T.check('pokerping-session-recap', ['recap'], async () => {
    const D = await new Bot(srv, 'Dee').connect(), E = await new Bot(srv, 'Eli').connect();
    await D.signup(); await E.signup();
    for (const b of [D, E]) { const s = await b.sit('POKERPING', 4000); expect(!s.__err, 'sit ' + s.__err); }
    expect(await drive([D, E], [call, (b, i) => (i.handNum % 4 === 1 && i.street === 'preflop' && i.currentBet <= i.gs.bb && i.maxTo >= i.gs.bb * 3 ? ['raise', i.gs.bb * 3] : call(b, i))], () => D.showdowns.length >= 6, 90000), 'six hands not played');
    const R = await D.req('recap_get', { tableId: 'POKERPING' }, 'recap_data');
    expect(!R.__err, 'recap_get: ' + R.__err);
    expect(R.scope.kind === 'session' && R.scope.sessions.length === 1, 'one session expected');
    expect(R.totals.hands >= 6 && R.totals.handNetSum === 0, `session hands ${R.totals.hands} sum ${R.totals.handNetSum}`);
    expect(R.notes.some(n => /4 hours/.test(n)), 'session definition missing');
    expect(R.players.every(p => p.net === p.handNet), 'session net is the hand net');
    D.close(); E.close();
  });

  // ======== the unwritable recap file: same hands, same money ========
  const dirU = mkdir();
  const srvU = await startServer(PORT + 3, { dir: dirU, handDelayMs: 250, autoStartMs: 200, env: { RECAP_FILE: path.join(dirU, 'no', 'such', 'dir', 'recap.jsonl') } });
  await T.check('unwritable-recap-file-does-not-change-a-hand', ['recap'], async () => {
    const u = await scriptedHand(srvU, ['Gus', 'Hal']);
    const strip = x => JSON.stringify({ ...x, nextMs: 0 });
    expectEq(strip(u.sd), strip(scripted.sd), 'showdown_result with an unwritable file vs a normal one');
    expectEq(u.bank, scripted.bank, 'banks after the hand');
    const R = await u.bots[0].req('recap_get', { tableId: u.id }, 'recap_data');
    expect(!R.__err && R.hands.length === 1, 'the hand is still served from memory');
    await sleep(100);
    expect(/recap file not writable/.test(srvU.logText()), 'the write failure was not logged');
    expect(srvU.alive(), 'server died');
    u.bots.forEach(b => b.close());
  });
  await srvU.stop();

  // ======== kill right after a hand + a voluntary show survive ========
  const dirK = mkdir();
  let srvK = await startServer(PORT + 1, { dir: dirK, handDelayMs: 600000 });
  await T.check('kill-right-after-a-hand-keeps-it-and-a-voluntary-show', ['recap'], async () => {
    const { id, bots, table } = await tableWith(srvK, ['Jay', 'Kim'], [1000, 1000], { name: 'Kill night' });
    const [J, K] = bots;
    const first = bots.find(b => b.myTurn());
    // whoever is on turn folds: the other wins uncontested; Jay then shows
    const folder = first, winner = bots.find(b => b !== folder);
    folder.act('fold');
    expect(await waitFor(() => J.showdowns.length >= 1, 5000), 'hand did not finish');
    const nightId = table.nightId;
    const before = await folder.req('recap_get', { nightId }, 'recap_data');
    const wInK = before.hands[0].players.find(p => p.name === winner.name);
    expect(wInK.cards[0] === null && wInK.cards[1] === null, 'winner cards visible before any show');
    const shown = folder.wait('cards_shown', 3000);
    winner.emit('show_cards', { which: 'both', roomId: id });
    expect(await shown, 'cards_shown never came');
    const mid = await folder.req('recap_get', { nightId }, 'recap_data');
    const wMid = mid.hands[0].players.find(p => p.name === winner.name);
    expect(wMid.cards[0] && wMid.cards[1], 'voluntary show not in the recap');
    await srvK.stop('SIGKILL');
    srvK = await srvK.restart();
    const K2 = await new Bot(srvK, folder.name).connect(); const lg = await K2.login(); expect(!lg.__err, 'login after restart ' + lg.__err);
    const after = await K2.req('recap_get', { nightId }, 'recap_data');
    expect(!after.__err, 'recap after kill: ' + after.__err);
    expectEq(after.hands.length, 1, 'hands after the kill');
    const wAfter = after.hands[0].players.find(p => p.name === winner.name);
    expect(wAfter.cards[0] && wAfter.cards[1], 'the voluntary show did not survive the kill');
    expectEq(after.hands[0].pot, before.hands[0].pot, 'pot after the kill');
    [J, K, K2].forEach(b => b.close());
  });
  await srvK.stop();

  // ======== a voided hand is not recorded ========
  const dirV = mkdir();
  let srvV = await startServer(PORT + 2, { dir: dirV, handDelayMs: 1200 });
  await T.check('voided-hand-is-not-recorded', ['recap'], async () => {
    const { id, bots, table } = await tableWith(srvV, ['Lou', 'Mia'], [1000, 1000], { name: 'Void night' });
    const [L, M] = bots;
    bots.find(b => b.myTurn()).act('fold');
    expect(await waitFor(() => L.showdowns.length >= 1, 5000), 'hand 1 did not finish');
    expect(await waitFor(() => L.gs && L.gs.status === 'playing' && L.gs.handNum >= 2, 6000), 'hand 2 was not dealt');
    bots.find(b => b.myTurn()).act('call'); await sleep(80);
    await srvV.stop('SIGTERM');                       // shutdown() voids every live hand; nothing of it may reach the file
    expect(!srvV.alive(), 'server did not exit');
    const lines = fs.readFileSync(path.join(dirV, 'recap-hands.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    expectEq(lines.filter(l => !l.patch && !l.void).length, 1, 'hand lines in the file');
    expect(lines.filter(l => l.void).length <= 1, 'more than one void marker');
    srvV = await srvV.restart();
    const L2 = await new Bot(srvV, 'Lou').connect(); await L2.login();
    const R = await L2.req('recap_get', { nightId: table.nightId }, 'recap_data');
    expect(!R.__err, 'recap after restart: ' + R.__err);
    expectEq(R.hands.length, 1, 'recap hands after the void');
    expectEq(R.hands[0].handNum, 1, 'hand number');
    [L, M, L2].forEach(b => b.close());
    void id;
  });
  await srvV.stop();

  // ======== (r2) critic r1 #1 #8 #12: hostile frames, unchanged replies, the rate window, a key like 'constructor' (live server) ========
  const dirH = mkdir();
  const srvH = await startServer(PORT + 4, { dir: dirH, handDelayMs: 600, autoStartMs: 200, turnMs: 240000 });
  const rawEmit = (bot, ev, jsonArg) => bot.sock.io.engine.send(jsonArg === undefined ? `2["${ev}"]` : `2["${ev}",${jsonArg}]`);
  const deepArr = n => '['.repeat(n) + ']'.repeat(n);
  const deepObj = n => '{"a":'.repeat(n) + '1' + '}'.repeat(n);
  const msgs = [];                                       // every server error string seen in this block: none may carry a digit or '$'
  let H = null;
  await T.check('hostile-recap-frames-never-touch-a-live-hand', ['recap'], async () => {
    // POKERPING, so that `start` reaches the session lookup (the legacy branch of build(): the only place a start value is read): one hand is recorded first
    const A = await new Bot(srvH, 'Hal').connect(), B = await new Bot(srvH, 'Ida').connect(), bots = [A, B], id = 'POKERPING';
    await A.signup(); await B.signup();
    for (const b of bots) { const r = await b.sit(id, 4000); expect(!r.__err, 'sit ' + r.__err); }
    expect(await drive(bots, call, () => A.showdowns.length >= 1, 40000), 'the first hand did not finish');
    const hn1 = A.gs.handNum;
    expect(await waitFor(() => A.gs.status === 'playing' && A.gs.handNum > hn1 && (A.myTurn() || B.myTurn()), 8000), 'the next hand was not dealt');
    const first = bots.find(b => b.myTurn()); first.act('call'); await sleep(250);          // chips in the pot beyond the blinds
    const potBefore = A.gs.pot, hn = A.gs.handNum;
    expect(potBefore > 0 && A.gs.status === 'playing', 'no live hand with chips in the pot');
    const frames = [
      ['start = array 20000 deep', `{"tableId":"POKERPING","start":${deepArr(20000)}}`],
      ['start = deep object', `{"tableId":"POKERPING","start":${deepObj(20000)}}`], ['start = {}', '{"tableId":"POKERPING","start":{}}'], ['start = string', '{"tableId":"POKERPING","start":"abc"}'], ['start = 1e309', '{"tableId":"POKERPING","start":1e309}'],
      ['start = -1', '{"tableId":"POKERPING","start":-1}'], ['start = huge string of digits', '{"tableId":"POKERPING","start":"99999999999999999999"}'],
      ['tableId = deep array', `{"tableId":${deepArr(20000)}}`], ['tableId = deep object', `{"tableId":${deepObj(20000)}}`], ['tableId = number', '{"tableId":5}'], ['tableId = null', '{"tableId":null}'],
      ['nightId = deep array', `{"nightId":${deepArr(20000)}}`], ['nightId = deep object', `{"nightId":${deepObj(20000)}}`], ['nightId = number', '{"nightId":7}'], ['nightId = null', '{"nightId":null}'],
      ['both ids deep', `{"tableId":${deepObj(20000)},"nightId":${deepArr(20000)},"start":${deepObj(20000)}}`],
      ['have = deep array', `{"tableId":"POKERPING","have":${deepArr(20000)}}`], ['have = number', '{"tableId":"POKERPING","have":12}'], ['have = long string', `{"tableId":"POKERPING","have":"${'x'.repeat(5000)}"}`],
      ['payload = deep array', deepArr(20000)], ['payload = number', '1e309'], ['payload = string', '"x"'], ['payload = null', 'null'], ['no payload at all', undefined],
    ];
    let n = 0;
    for (const [label, json] of frames) {
      const from = A.events.length;
      rawEmit(A, 'recap_get', json);
      const ok = await waitFor(() => A.events.slice(from).some(e => e.ev === 'recap_data' || (e.ev === 'error' && e.d && e.d.code === 'recap')), 4000);
      expect(ok, label + ': no recap_data / recap error came back: ' + JSON.stringify(A.events.slice(from).map(e => e.ev + ':' + JSON.stringify(e.d).slice(0, 60))));
      const got = A.events.slice(from);
      for (const e of got) if (e.ev === 'error') { msgs.push(e.d && e.d.message); expect(e.d.code === 'recap', label + ': an error with code ' + (e.d && e.d.code)); }
      expect(!got.some(e => e.ev === 'error' && e.d && /void/i.test(e.d.message || '')), label + ': a Hand voided message');
      expect(A.sock.connected, label + ': the sender was disconnected');
      expect(A.gs.pot === potBefore && A.gs.handNum === hn && A.gs.status === 'playing', `${label}: the hand moved (pot ${A.gs.pot} vs ${potBefore})`);
      n++;
    }
    expect(!srvH.logText().includes('VOID'), 'the server voided a hand: ' + (srvH.logText().match(/.*VOID.*/) || [''])[0]);
    expect(!B.events.some(e => e.ev === 'error' && e.d && e.d.code === 'hand_void'), 'the other player got a void event');
    // the hand now plays to its end and is recorded
    const n0 = A.showdowns.length;
    const done = await drive(bots, call, () => A.showdowns.length > n0, 30000);
    expect(done, 'the hand did not finish after the hostile frames');
    await sleep(900);
    const R = await A.req('recap_get', { tableId: id }, 'recap_data');
    expect(!R.__err && R.hands.length >= 2 && R.hands[R.hands.length - 1].pot === A.showdowns[A.showdowns.length - 1].pot, 'the hand was not recorded: ' + (R.__err || JSON.stringify(R.hands && R.hands.map(h => h.pot))));
    H = { id, bots, tableId: id };
    return `${n} hostile frames, pot stayed ${potBefore}, hand finished and recorded`;
  });

  await T.check('recap-get-unchanged-reply-and-rate-window', ['recap'], async () => {
    const [A] = H.bots;
    await sleep(900);
    const full = await A.req('recap_get', { tableId: H.id }, 'recap_data');
    expect(!full.__err && full.version && full.hands.length, 'no versioned full payload');
    await sleep(900);
    const same = await A.req('recap_get', { tableId: H.id, have: full.version }, 'recap_data');
    expect(same.unchanged === true && same.ok === true && same.version === full.version && !same.hands, 'not an unchanged reply: ' + JSON.stringify(same).slice(0, 120));
    expect(JSON.stringify(same).length < 200 && JSON.stringify(full).length > 1000, `sizes ${JSON.stringify(same).length} vs ${JSON.stringify(full).length}`);
    await sleep(900);
    const stale = await A.req('recap_get', { tableId: H.id, have: 'deadbeef' }, 'recap_data');
    expect(!stale.unchanged && stale.hands.length === full.hands.length, 'a wrong version must get the full payload');
    // access is checked before "unchanged": a stranger holding the right version string gets the refusal
    const priv = await tableWith(srvH, ['Nan', 'Oli'], [1000, 1000], { name: 'Private night' }, { start: false });
    const pv = await priv.bots[0].req('recap_get', { nightId: priv.table.nightId }, 'recap_data');
    expect(!pv.__err && pv.version, 'no version on a private night');
    const Z = await new Bot(srvH, 'Zoe').connect(); await Z.signup();
    const rz = await Z.req('recap_get', { nightId: priv.table.nightId, have: pv.version }, 'recap_data', 2500);
    expect(rz.__err && Z.errorObjs.some(e => e && e.code === 'recap'), 'a stranger got an unchanged reply');
    H.priv = priv;
    // a new hand changes the version
    const n0 = A.showdowns.length;
    expect(await drive(H.bots, call, () => A.showdowns.length > n0, 20000), 'next hand did not finish');
    await sleep(900);
    const next = await A.req('recap_get', { tableId: H.id, have: full.version }, 'recap_data');
    expect(!next.unchanged && next.version !== full.version && next.hands.length === full.hands.length + 1, 'a new hand did not change the version');
    // rate window: a burst of 40 frames inside 100 ms is coalesced into the first answer plus one newest-request answer
    await sleep(900);
    const from = A.events.length;
    for (let i = 0; i < 40; i++) A.emit('recap_get', { tableId: H.id });
    await sleep(2600);
    const replies = A.events.slice(from).filter(e => e.ev === 'recap_data').length;
    expect(replies >= 1 && replies <= 3, `a burst of 40 got ${replies} answers`);
    // a burst from a signed-out socket costs nothing and is refused
    const Y = await new Bot(srvH, 'Yan').connect();
    for (let i = 0; i < 20; i++) Y.emit('recap_get', { tableId: H.id });
    await sleep(400);
    expect(Y.events.filter(e => e.ev === 'recap_data').length === 0, 'a signed-out socket got data');
    Z.close(); Y.close();
    return `unchanged ${JSON.stringify(same).length} B vs full ${JSON.stringify(full).length} B, burst of 40 -> ${replies} answers`;
  });

  await T.check('keys-like-constructor-are-not-participants', ['recap'], async () => {
    const nightId = H.priv.table.nightId;
    const out = [];
    for (const nm of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      const b = await new Bot(srvH, nm).connect(); const r = await b.signup();
      if (r.__err) { out.push(nm + ': signup refused'); b.close(); continue; }
      const q = await b.req('recap_get', { nightId }, 'recap_data', 2500);
      expect(q.__err && b.errorObjs.some(e => e && e.code === 'recap'), `an account named ${nm} passed as a participant`);
      out.push(nm + ': refused'); b.close();
    }
    return out.join(', ');
  });
  await T.check('error-messages-have-no-digit-and-no-dollar', ['recap'], async () => {
    expect(msgs.length > 0, 'no error message collected');
    const bad = msgs.filter(m => /[\d$]/.test(String(m)));
    expectEq(bad, [], 'error strings with a digit or $');
  });
  if (H) [...H.bots, ...(H.priv ? H.priv.bots : [])].forEach(b => b.close());
  await srvH.stop();

  // ======== (r2) critic r1 #2: a recap file full of foreign lines ========
  await T.check('recap-file-with-foreign-lines-loads-the-good-hands', ['recap'], async () => {
    const dir = mkdir(), file = path.join(dir, 'recap-hands.jsonl');
    const old = { t: 5, room: 'R1', handNum: 3, players: [{ key: 'a', cards: [] }], actions: [], winners: [], board: [] };      // a feat-recap line: handNum, no handNo
    const lines = [
      JSON.stringify(goodHand(1)), 'null', '5', '"text"', '[1,2]', '{}',
      JSON.stringify({ patch: true, tableId: 'T1', handNo: 1, key: 'a' }),                                            // patch without `shown`
      JSON.stringify({ ...goodHand(2), winners: undefined }), JSON.stringify({ ...goodHand(3), actions: undefined }),
      JSON.stringify({ ...goodHand(4), players: [null] }), JSON.stringify({ ...goodHand(5), winners: [null] }), JSON.stringify({ ...goodHand(6), actions: [7] }),
      JSON.stringify(old), '{"t":1,"tableId":"T1","handNo":9,"pla',                                                   // torn half line
      JSON.stringify(goodHand(7)),
    ];
    fs.writeFileSync(file, lines.join('\n') + '\n');
    const t = fakeTable({ state: 'ended' });
    let rec; try { rec = createRecap({ file, registry: fakeRegistry(t, { a: { buyIn: 1000, cashOut: 1050, open: 0, net: 50 }, b: { buyIn: 1000, cashOut: 950, open: 0, net: -50 } }), accounts: { isAdmin: k => k === 'adm', get: () => null }, ...quiet }); }
    catch (e) { throw new Error('createRecap threw: ' + e.message); }
    expectEq(rec.all().map(h => h.handNo), [1, 7], 'hands loaded');
    let out; try { out = rec.build({ viewerKey: 'adm', nightId: 'N1' }); } catch (e) { throw new Error('build threw: ' + e.message); }
    expect(out.ok && out.hands.length === 2, 'build: ' + JSON.stringify(out).slice(0, 100));
    rec.flush();
    return 'two good hands of 16 lines';
  });

  // ======== (r2) critic r1 #4: a blind post that is all-in closes betting at the deal ========
  await T.check('blind-allin-at-deal-logs-the-uncalled-part-back', ['recap'], async () => {
    const t = fakeTable(), rec = createRecap({ file: null, registry: fakeRegistry(t), accounts: null, ...quiet });
    // heads-up, the button posts the small blind: seat 0 has 25 (all-in on the post), seat 1 has 1000 and posts 50 -> 25 of it is uncalled
    const h = dealOn(rec, t, [{ seat: 0, key: 'sid', stack: 25 }, { seat: 1, key: 'bea', stack: 1000 }], 0);
    expect(h.seats[1].returned === 25 && h.phase === 'runout', 'the setup did not produce the case: returned ' + h.seats[1].returned + ' phase ' + h.phase);
    finishOn(rec, t);
    const out = rec.build({ viewerKey: null, nightId: 'N1' });
    const x = out.hands[0], a = x.actions;
    expectEq(a.slice(0, 3).map(z => [z.a, z.key, z.put, z.pot]), [['sb', 'sid', 25, 25], ['bb', 'bea', 50, 75], ['back', 'bea', -25, 50]], 'blind rows and the back line');
    expect(a[2].put === -25, 'back line');
    expectEq(x.pot, 50, 'final pot');
    expectEq(x.players.find(p => p.key === 'bea').bet, 25, 'bea bet is the called part only');
    expect(a.slice(3).every(z => z.pot === 50), 'a later row shows a pot that is not 50: ' + JSON.stringify(a.map(z => z.pot)));
    expectEq(x.players.reduce((s0, p) => s0 + p.net, 0), 0, 'nets sum');
    // and the normal case is untouched: two blinds, nobody all-in, no back line
    const t2 = fakeTable({ id: 'T2', nightId: 'N2' }), rec2 = createRecap({ file: null, registry: fakeRegistry(t2), accounts: null, ...quiet });
    const h2 = dealOn(rec2, t2, [{ seat: 0, key: 'sid', stack: 1000 }, { seat: 1, key: 'bea', stack: 1000 }], 0);
    expect(!h2.seats[0].returned && !h2.seats[1].returned, 'normal deal returned something');
    rec2.onEngine(t2, engine.apply(h2, h2.toAct, { type: 'fold' }));
    finishOn(rec2, t2);
    const a2 = rec2.build({ viewerKey: null, nightId: 'N2' }).hands[0].actions;
    expectEq(a2.map(z => z.a), ['sb', 'bb', 'fold', 'back'], 'a normal hand log (the folded-to big blind gets its uncalled 25 back, as before)');
    return 'sb 25 / bb 50 / back 25, final pot 50';
  });

  // ======== (r2) critic r1 #5: a voided hand 1 is not a missing recording ========
  await T.check('voided-first-hand-does-not-claim-missing-recording', ['recap'], async () => {
    const dir = mkdir(), file = path.join(dir, 'recap-hands.jsonl');
    const mk = () => { const t = fakeTable(); return { t, rec: createRecap({ file, registry: fakeRegistry(t), accounts: null, ...quiet }) }; };
    let { t, rec } = mk();
    dealOn(rec, t, [{ seat: 0, key: 'sid', stack: 1000 }, { seat: 1, key: 'bea', stack: 1000 }], 0);
    rec.onEvent(t, 'void', { reason: 'test' });                                       // hand 1 is voided
    t.hand = null;
    const h = dealOn(rec, t, [{ seat: 0, key: 'sid', stack: 1000 }, { seat: 1, key: 'bea', stack: 1000 }], 1);
    expect(h.handNo === 2, 'second hand is not number 2');
    rec.onEngine(t, engine.apply(h, h.toAct, { type: 'fold' }));
    finishOn(rec, t);
    rec.flush();
    const noted = x => (x.notes || []).some(n => /before recording began/.test(n));
    let out = rec.build({ viewerKey: null, nightId: 'N1' });
    expect(out.ok && out.hands.length === 1 && out.hands[0].handNum === 2, 'hands ' + JSON.stringify(out.hands && out.hands.map(z => z.handNum)));
    expect(!noted(out), 'a voided hand 1 was reported as missing: ' + JSON.stringify(out.notes));
    ({ rec } = (() => { const r = createRecap({ file, registry: fakeRegistry(t), accounts: null, ...quiet }); return { rec: r }; })());   // restart: the void marker is read back
    out = rec.build({ viewerKey: null, nightId: 'N1' });
    expect(out.ok && !noted(out), 'after a restart the voided hand 1 is reported as missing: ' + JSON.stringify(out.notes));
    // the real case still reads: hand 1 never recorded and never voided
    const t3 = fakeTable({ id: 'T3', nightId: 'N3' }), rec3 = createRecap({ file: null, registry: fakeRegistry(t3), accounts: null, ...quiet });
    t3.handNo = 1;
    const h3 = dealOn(rec3, t3, [{ seat: 0, key: 'sid', stack: 1000 }, { seat: 1, key: 'bea', stack: 1000 }], 1);
    rec3.onEngine(t3, engine.apply(h3, h3.toAct, { type: 'fold' }));
    finishOn(rec3, t3);
    const o3 = rec3.build({ viewerKey: null, nightId: 'N3' });
    expect(o3.ok && noted(o3), 'a genuinely missing hand 1 is no longer noted: ' + JSON.stringify(o3.notes));
  });

  // ======== (r2) critic r1 #12: own-property checks (unit) ========
  await T.check('prototype-keys-are-not-night-members', ['recap'], async () => {
    const t = fakeTable({ state: 'live' }), rec = createRecap({ file: null, registry: fakeRegistry(t, {}), accounts: { isAdmin: () => false, get: k => ({})[k] }, ...quiet });
    const h = dealOn(rec, t, [{ seat: 0, key: 'sid', stack: 1000 }, { seat: 1, key: 'bea', stack: 1000 }], 0);
    rec.onEngine(t, engine.apply(h, h.toAct, { type: 'fold' }));
    finishOn(rec, t);
    const refused = [];
    for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      const o = rec.build({ viewerKey: k, nightId: 'N1' });
      expect(o.error === 'No such night', `${k} was let in`); refused.push(k);
    }
    expect(rec.build({ viewerKey: 'sid', nightId: 'N1' }).ok, 'a real participant is refused');
    return refused.join(',');
  });

  // ======== restart: the big night survives ========
  await T.check('night-recap-survives-a-kill-restart', ['recap'], async () => {
    [...(N ? N.bots : []), ...(PN ? PN.bots : [])].forEach(b => b.close());
    await srv.stop('SIGKILL');
    const s2 = await srv.restart();
    const V = await new Bot(s2, 'Ann').connect(); const lg = await V.login(); expect(!lg.__err, 'login ' + lg.__err);
    const R = await V.req('recap_get', { nightId: N.nightId }, 'recap_data');
    expect(!R.__err, 'recap: ' + R.__err);
    expectEq(R.hands.length, N.seen.length, 'hands after restart');
    const settleBy = Object.fromEntries(N.settle.players.map(p => [p.display, p.net]));
    for (const p of R.players) expectEq(p.net, settleBy[p.name], p.name + ' net after restart');
    const P2 = await new Bot(s2, 'Pam').connect(); await P2.login();
    const RP = await P2.req('recap_get', { nightId: PN.nightId }, 'recap_data');
    expectEq(RP.hands.length, PN.seen.length, 'Play $ hands after restart');
    const ps = Object.fromEntries(PN.settle.players.map(p => [p.display, p.net]));
    for (const p of RP.players) expectEq(p.net, ps[p.name], p.name + ' Play $ net after restart');
    expect(!RP.notes.some(n => /memory|restart/i.test(n)), 'memory-only note after restart');
    V.close(); P2.close();
    await s2.stop();
  });

  for (const d of dirs) try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  await T.done();
})().catch(e => { console.error('SCRIPT ERROR', e); for (const d of dirs) try { fs.rmSync(d, { recursive: true, force: true }); } catch {} process.exit(2); });
