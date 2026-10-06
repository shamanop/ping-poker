'use strict';
// H7 the Play $ top-up ignored money parked at a table (sit with almost everything, top up, stand up: +$9,9xx per hour).
// M10 the rebuy limit was bypassed by leave + sit. Audit repro 15.
const { startServer, Bot, sleep, suite, expect } = require('./lib');
const T = suite(__filename);
(async () => {
  const srv = await startServer(0);
  const host = await new Bot(srv, 'Hosty').connect(); await host.signup();
  const t = (await host.req('table_create', { settings: { name: 'Deep', mode: 'play', buyIn: { min: 500, max: 2000000, default: 2000 }, rebuyLimit: 1, autoStart: false } }, 'table_created')).table;
  await T.check('play-topup-counts-money-parked-at-a-table', ['H7'], async () => {
    const a = await new Bot(srv, 'Lena').connect(); await a.signup();
    const w0 = (await a.req('wallet_get', {}, 'wallet')).play;
    const s = await a.sit(t.id, w0 - 5000); expect(!s.__err, 'sit: ' + s.__err);
    const tu = await a.req('wallet_topup', {}, 'wallet', 1500);          // refused or not, the total must not grow
    await a.leave(t.id); await sleep(200);
    const w1 = (await a.req('wallet_get', {}, 'wallet')).play;
    a.close();
    expect(w1 === w0, `Play $ went ${w0} -> ${w1} (+${w1 - w0}) after sit, top-up (${tu.__err || 'granted'}) and stand-up`);
  });
  await T.check('rebuy-limit-is-not-bypassed-by-leave-and-sit', ['M10'], async () => {
    const b = await new Bot(srv, 'Milo').connect(); await b.signup();
    let joins = 0;
    for (let i = 0; i < 5; i++) { const r = await b.sit(t.id, 500); if (!r.__err) joins++; await b.leave(t.id); }
    b.close();
    expect(joins <= 2, `rebuyLimit 1 but ${joins} fresh buy-ins were accepted (a buy-in plus one rebuy is the most a night allows)`);
  });
  await srv.stop();
  await T.done();
})();
