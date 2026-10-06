'use strict';
// v2 interface change on purpose (money audit S3-5, L7, L5): out-of-range amounts are rejected with a structured error { code, min, max, have }
// and no server string carries a formatted amount ("$5", "10,000") or a raw number. 9440541 answers with prose like "Rebuy must be between 500 and 50000".
// The error is read from the `error` event (same event name as today).
const { startServer, waitFor, sleep, tableWith, drive, P, rigDeck, suite, expect } = require('./lib');
const T = suite(__filename);
const structured = (e, what) => {
  expect(e && typeof e === 'object', `${what}: no error event arrived`);
  expect(typeof e.code === 'string' && e.code, `${what}: error has no code: ${JSON.stringify(e)}`);
  expect(Number.isInteger(e.min) && Number.isInteger(e.max) && Number.isInteger(e.have), `${what}: error lacks integer min/max/have: ${JSON.stringify(e)}`);
  expect(!/[$]|\d/.test(String(e.message || '')), `${what}: message carries an amount: "${e.message}"`);
};
(async () => {
  const srv = await startServer(0);
  await T.check('v2-buyin-out-of-range-is-a-structured-error-without-amounts-in-the-text', ['L7', 'S3-5'], async () => {
    const { id, bots } = await tableWith(srv, ['Era', 'Erb'], [1000, 1000], { buyIn: { min: 500, max: 5000, default: 1000 } }, { start: false });
    const c = await new (require('./lib').Bot)(srv, 'Erc').connect(); await c.signup();
    const n = c.errorObjs.length;
    c.emit('table_join', { tableId: id, buyIn: 1 }); await waitFor(() => c.errorObjs.length > n, 2000);
    bots.forEach(b => b.close()); const e = c.errorObjs[c.errorObjs.length - 1]; c.close();
    structured(c.errorObjs.length > n ? e : null, 'table_join below the minimum');
  });
  await T.check('v2-rebuy-out-of-range-is-a-structured-error-without-amounts-in-the-text', ['S3-5'], async () => {
    const deck = rigDeck([['As', 'Ad'], ['7c', '2d']], ['3c', '8d', '9h', '4s', 'Kh']);
    const { id, bots } = await tableWith(srv, ['Esa', 'Esb'], [600, 600], { buyIn: { min: 500, max: 5000, default: 1000 } }, { decks: [deck] });
    await drive(bots, [P.allin, P.call], () => bots[0].showdowns.length > 0, 15000);
    const loser = bots[1];
    await waitFor(() => loser.busts.length > 0, 8000);
    expect(loser.busts.length > 0, 'the loser never got bust_out');
    const n = loser.errorObjs.length; loser.emit('rebuy', { roomId: id, amount: 1 }); await waitFor(() => loser.errorObjs.length > n, 2000);
    const e = loser.errorObjs[loser.errorObjs.length - 1]; bots.forEach(x => x.close());
    structured(loser.errorObjs.length > n ? e : null, 'rebuy of 1 (min 500)');
  });
  await T.check('v2-raise-out-of-range-is-a-structured-error', ['L5'], async () => {
    const { id, bots } = await tableWith(srv, ['Etc', 'Etd', 'Ete'], [5000, 5000, 5000]);
    const a = bots.find(b => b.myTurn()); const n = a.errorObjs.length;
    a.act('raise', 60); await waitFor(() => a.errorObjs.length > n, 2000);
    const e = a.errorObjs[a.errorObjs.length - 1]; bots.forEach(x => x.close());
    structured(a.errorObjs.length > n ? e : null, 'raise to 60 (min 100)');
  });
  await srv.stop();
  await T.done();
})();
