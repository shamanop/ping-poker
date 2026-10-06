'use strict';
// Restart in the middle of a hand: Railway deploy = SIGTERM, crash/OOM = SIGKILL. The hand is void: every player must have exactly what they had
// before sitting down (stack and bet back), no money created or lost. POKERPING, a chips table and a Play $ table. Audit repro 07.
const { startServer, Bot, waitFor, sleep, audit, step, moneyTotal, suite, expect } = require('./lib');
const T = suite(__filename);
// everything a player owns: bank + wallet + stack and live-pot bet at tables
const hold = (a, k) => { let n = 0; for (const r of a.rooms) for (const p of r.players) if (!p.isBot && p.key === k) n += p.chips + (r.status === 'playing' && r.pot > 0 ? p.handBet : 0); const b = bal(a, k); return b.bank + b.wallet + n; };
const bal = (a, k) => ({ bank: a.bank[k] === undefined ? 10000 : a.bank[k], wallet: a.wallet[k] === undefined ? 1000000 : a.wallet[k] });
async function scenario(sig, kind) {
  const srv = await startServer(0);
  try {
    const a = await new Bot(srv, 'Rex').connect(), b = await new Bot(srv, 'Sue').connect();
    await a.signup(); await b.signup();
    const pre = await audit(a);
    const before = { rex: bal(pre, 'rex'), sue: bal(pre, 'sue'), total: moneyTotal(pre).total };
    let id = 'POKERPING';
    if (kind !== 'legacy') {
      const c = await a.req('table_create', { settings: { name: 'Night', mode: kind, buyIn: { min: 100, max: 50000, default: 2000 }, blinds: { sb: 25, bb: 50 }, actionTimerSec: 0 } }, 'table_created');
      if (c.__err) throw new Error('create ' + c.__err);
      id = c.table.id;
    }
    const s1 = await a.sit(id, 2000), s2 = await b.sit(id, 2000);
    if (s1.__err || s2.__err) throw new Error('sit ' + (s1.__err || s2.__err));
    if (kind !== 'legacy') a.emit('table_start', { tableId: id });
    await waitFor(() => a.gs && a.gs.status === 'playing', 6000); await sleep(100);
    const bots = [a, b];
    await step(bots, 'raise', 500); await step(bots, 'call');
    await waitFor(() => a.gs.street === 'flop', 3000); await sleep(2300);    // past the old 2 s stacks mirror tick
    const live = await audit(a);
    const inHand = moneyTotal(live);
    await srv.stop(sig);
    const srv2 = await srv.restart();
    try {
      const c = await new Bot(srv2, 'Audit').connect();   // __audit needs no sign-in (a login would pay the daily bonus)
      const after = await audit(c);
      const m = moneyTotal(after);
      const d = { rex: hold(after, 'rex') - hold(live, 'rex'), sue: hold(after, 'sue') - hold(live, 'sue') };
      return { dTotal: m.total - before.total, inHandTotalDiff: inHand.total - before.total, d, leftAtTables: m.stacks + m.inPot };
    } finally { await srv2.stop(); }
  } finally { await srv.stop().catch(() => {}); }
}
function verdict(r) {
  expect(r.dTotal === 0, `total money changed by ${r.dTotal} across the restart (hand voided); per player ${JSON.stringify(r.d)}`);
  expect(r.d.rex === 0 && r.d.sue === 0, `players do not have their stack + bet back (holdings after minus holdings in the hand): ${JSON.stringify(r.d)}`);
  expect(r.leftAtTables === 0, `${r.leftAtTables} still seated at a table after restart (every seat must be cashed out)`);
}
(async () => {
  const plan = [['SIGTERM', 'legacy', ['C3']], ['SIGKILL', 'legacy', []], ['SIGTERM', 'chips', ['C3']], ['SIGKILL', 'chips', []], ['SIGTERM', 'play', []], ['SIGKILL', 'play', ['C4']]];
  for (const [sig, kind, bugs] of plan) await T.check(`restart-midhand-${sig.toLowerCase()}-${kind}-table-money-unchanged`, bugs, async () => verdict(await scenario(sig, kind)));
  await T.done();
})();
