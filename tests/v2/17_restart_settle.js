'use strict';
// M6: settle-up (night results) across a restart. Chips nights after a crash showed everyone down their whole stack (zeroSum false);
// Play $ nights were empty after any deploy. Correct: after the restart the night shows exactly the hand that was played. Audit repro 17.
const { startServer, Bot, waitFor, sleep, step, suite, expect, expectEq } = require('./lib');
const T = suite(__filename);
async function run(mode, sig) {
  const srv = await startServer(0);
  try {
    const a = await new Bot(srv, 'Opal').connect(), b = await new Bot(srv, 'Penn').connect();
    await a.signup(); await b.signup();
    const t = (await a.req('table_create', { settings: { name: 'Night', mode, autoStart: false, actionTimerSec: 0 } }, 'table_created')).table;
    await a.sit(t.id, 2000); await b.sit(t.id, 2000);
    a.emit('table_start', { tableId: t.id }); await waitFor(() => a.gs && a.gs.status === 'playing', 3000); await sleep(50);
    await step([a, b], 'fold'); await waitFor(() => a.gs.handNum === 2, 3000); await sleep(2100);
    const before = await a.req('night_get', { nightId: t.nightId }, 'settle_up');
    await srv.stop(sig);
    const srv2 = await srv.restart();
    try {
      const c = await new Bot(srv2, 'Opal').connect(); await c.login();
      const after = await c.req('night_get', { nightId: t.nightId }, 'settle_up');
      const nets = s => s && s.players ? Object.fromEntries((Array.isArray(s.players) ? s.players : Object.values(s.players)).map(p => [p.display || p.key, p.net])) : s;
      return { before: nets(before), after: nets(after), zeroSum: after && after.zeroSum };
    } finally { await srv2.stop(); }
  } finally { await srv.stop().catch(() => {}); }
}
(async () => {
  for (const [mode, sig] of [['chips', 'SIGKILL'], ['chips', 'SIGTERM'], ['play', 'SIGTERM'], ['play', 'SIGKILL']]) {
    await T.check(`night-results-survive-${sig.toLowerCase()}-restart-${mode}`, ['M6'], async () => {
      const r = await run(mode, sig);
      // after the restart every seat is cashed out, so the night is exactly the one hand that was played (a fold: +-25, never the whole stack)
      expect(r.after && !r.after.__err && Object.keys(r.after).length > 0, 'night is empty after the restart: ' + JSON.stringify(r.after));
      const v = Object.values(r.after);
      expect(v.reduce((x, y) => x + y, 0) === 0 && v.every(n => Math.abs(n) <= 50), `nets after the restart ${JSON.stringify(r.after)} (want the one folded hand: opposite +-25)`);
      expect(r.zeroSum === true, 'zeroSum ' + r.zeroSum + ' after the restart');
    });
  }
  await T.done();
})();
