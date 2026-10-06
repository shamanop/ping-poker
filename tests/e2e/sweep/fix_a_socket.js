'use strict';
// P5 fix A (Q03): additive server keys for a player who already holds a seat.
//  - table_info carries `you: { seated, connected, stack }` for the caller and `away: [...]` for disconnected seats (additive).
//  - a rebind of a stack-0 seat re-sends bust_out (same shape) and shows no stale hand (old board / hole cards).
// Usage: node tests/e2e/sweep/fix_a_socket.js [port]   (default 4711)
const path = require('path');
const { startServer, Bot, waitFor, sleep, rigDeck, audit, drive, P, tableWith, suite, expect } = require('../../v2/lib');
const T = suite(__filename);
const PORT = Number(process.argv[2]) || 4711;
const RUNS = path.join(__dirname, '..', '..', '..', '..', 'runs');
(async () => {
  const srv = await startServer(PORT, { dir: path.join(RUNS, 'fixa-socket-' + Date.now()) });

  await T.check('table_info-lists-callers-disconnected-seat', ['Q03'], async () => {
    const { id, bots } = await tableWith(srv, ['Ann', 'Bo'], [2000, 2000], {}, { start: false });
    const [ann, bo] = bots;
    ann.close();
    await sleep(400);
    const ann2 = await new Bot(srv, 'Ann').connect(); const r = await ann2.login(); expect(!r.__err, 'login ' + r.__err);
    const info = await ann2.req('table_preview', { code: id }, 'table_info');
    const info2 = await bo.req('table_preview', { code: id }, 'table_info');
    ann2.close(); bo.close();
    expect(info && info.you && info.you.seated === true, 'caller with a disconnected seat: info.you = ' + JSON.stringify(info && info.you));
    expect(info.you.stack === 2000 && info.you.connected === false, 'info.you = ' + JSON.stringify(info.you));
    expect(Array.isArray(info.away) && info.away.some(p => p.key === 'ann'), 'info.away = ' + JSON.stringify(info.away));
    expect(!info2.you || info2.you.seated === true, 'bo is seated and connected: ' + JSON.stringify(info2.you));
    expect(Array.isArray(info.seated) && info.table && typeof info.openSeats === 'number', 'old keys stay');
  });

  await T.check('non-seated-caller-gets-no-seat', ['Q03'], async () => {
    const { id, bots } = await tableWith(srv, ['Cy', 'Di'], [2000, 2000], {}, { start: false });
    const eve = await new Bot(srv, 'Eve').connect(); await eve.signup();
    const info = await eve.req('table_preview', { code: id }, 'table_info');
    bots.forEach(b => b.close()); eve.close();
    expect(!info.you || info.you.seated === false, 'eve holds no seat: ' + JSON.stringify(info.you));
  });

  await T.check('rebind-of-a-busted-seat-resends-bust_out-and-no-stale-hand', ['Q03'], async () => {
    const deck = rigDeck([['7c', '2d'], ['As', 'Ad']], ['Kc', '9d', '4h', '3s', 'Jc']);
    const { id, bots } = await tableWith(srv, ['Fay', 'Gus'], [1000, 1000], { rebuys: true }, { decks: [deck] });
    const [fay, gus] = bots;
    await drive(bots, [P.allin, P.call], () => fay.busts.length > 0, 12000);
    expect(fay.busts.length > 0, 'fay never busted');
    await waitFor(() => gus.gs && gus.gs.status === 'waiting', 6000);
    fay.close(); await sleep(400);
    const fay2 = await new Bot(srv, 'Fay').connect(); await fay2.login();
    const j = await fay2.req('table_join', { tableId: id, buyIn: 20000 }, 'table_joined');
    expect(!j.__err, 'join ' + j.__err); expect(j.stack === 0, 'rebind keeps stack 0, got ' + j.stack);
    const bust = await fay2.wait('bust_out', 2500).then(x => x || (fay2.busts[0] || null));
    const hasBust = bust || fay2.busts.length ? (bust || fay2.busts[0]) : null;
    await sleep(300);
    const gs = fay2.gs;
    const a = await audit(fay2); const tot = a && a.bank ? a.bank['fay'] : null;
    fay2.close(); bots.forEach(b => b.close());
    expect(hasBust && hasBust.tableId === id && hasBust.rebuy && 'allowed' in hasBust.rebuy && 'min' in hasBust.rebuy, 'bust_out after rebind: ' + JSON.stringify(hasBust));
    expect(gs && gs.community.length === 0, 'stale board shown on a waiting table: ' + JSON.stringify(gs && gs.community));
    expect(fay2.cards.length === 0, 'stale hole cards shown: ' + JSON.stringify(fay2.cards));
  });

  await srv.stop();
  await T.done();
})();
