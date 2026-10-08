'use strict';
// Night recap on v2: scripted bots play real hands; the recap payload is checked against what the clients saw and against the money ledger
// (the settle-up screen). Own ports 4720-4724 (recap block). Run: node tests/recap.js   (never inside tests/v2/run.js: that suite owns 3500-3559)
const os = require('os'), path = require('path'), fs = require('fs');
const { startServer, Bot, waitFor, sleep, tableWith, drive, P, rigDeck, audit, suite, expect, expectEq } = require('./v2/lib');
const T = suite(__filename);
const PORT = Number(process.env.RECAP_TEST_PORT) || 4720;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ppre-'));
const dirs = [];
const mkdir = () => { const d = tmp(); dirs.push(d); return d; };

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
    expectEq(lines.filter(l => !l.patch).length, 1, 'hand lines in the file');
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

  // ======== restart: the big night survives ========
  await T.check('night-recap-survives-a-kill-restart', ['recap'], async () => {
    N.bots.concat(PN.bots).forEach(b => b.close());
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
