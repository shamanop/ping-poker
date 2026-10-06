'use strict';
// H2 min re-raise = last raise size, H3 short all-in does not reopen, L5 out-of-range raises are rejected (not rewritten), M8 short shove stays legal.
// Rejection is judged from game_state only (bet and actor unchanged), so any error event name works.
const { startServer, waitFor, sleep, tableWith, step, dealAligned, suite, expect } = require('./lib');
const T = suite(__filename);
const snap = b => ({ cb: b.gs.currentBet, idx: b.gs.currentPlayerIdx, pot: b.gs.pot, street: b.gs.street, hand: b.gs.handNum });
async function settle(b, ms = 700) { await sleep(ms); }

(async () => {
  const srv = await startServer(0);
  await T.check('minraise-is-previous-raise-size', ['H2'], async () => {
    const { bots } = await tableWith(srv, ['Ann', 'Ben', 'Cat'], [5000, 5000, 5000]);
    const first = bots.find(b => b.myTurn()); await step(bots, 'raise', 300, first);            // raise size 250 -> next min raise to 550
    const second = bots.find(b => b.myTurn());
    second.act('raise', 350); await settle(second);
    const cb = second.gs.currentBet;
    bots.forEach(b => b.close());
    expect(cb === 300 || cb >= 550, `raise to 350 over a raise to 300 (min is 550) left currentBet at ${cb}`);
  });
  await T.check('raise-below-minimum-rejected-not-rewritten', ['L5'], async () => {
    const { bots } = await tableWith(srv, ['Dia', 'Eli', 'Flo'], [5000, 5000, 5000]);
    const a = bots.find(b => b.myTurn()); const s0 = snap(a);
    a.act('raise', 60); await settle(a);                    // min raise to 100 (bet 50 + bb 50)
    const s1 = snap(a);
    bots.forEach(b => b.close());
    expect(s1.cb === s0.cb && s1.idx === s0.idx && s1.pot === s0.pot, `raise to 60 (min 100) changed state: ${JSON.stringify(s0)} -> ${JSON.stringify(s1)} (server rewrote the amount)`);
  });
  await T.check('raise-above-stack-rejected-not-allin', ['L5'], async () => {
    const { bots } = await tableWith(srv, ['Gus', 'Hal', 'Ivy'], [5000, 5000, 5000]);
    const a = bots.find(b => b.myTurn()); const s0 = snap(a);
    a.act('raise', 90000); await settle(a);
    const s1 = snap(a);
    bots.forEach(b => b.close());
    expect(s1.cb === s0.cb && s1.idx === s0.idx && s1.pot === s0.pot, `raise to 90000 with 5000 stacks changed state: ${JSON.stringify(s0)} -> ${JSON.stringify(s1)} (server turned it into an all-in)`);
  });
  // Dan raises to 300, Eve calls, Fay (BB, ~400 total) shoves: a 100 raise, less than a full 250 raise.
  let shove;
  async function shoveScenario() {
    if (shove) return shove;
    const S = await dealAligned(srv, ['Dan', 'Eve', 'Fay'], [5000, 5000, 400], { want: 0 });
    const [dan, eve, fay] = S.bots;
    const fayTotal = S.start.Fay;
    await step(S.bots, 'raise', 300, dan); await step(S.bots, 'call', undefined, eve);
    const r = await step(S.bots, 'raise', fayTotal, fay);
    const accepted = fay.gs.currentBet === fayTotal;
    await waitFor(() => dan.myTurn(), 2000);
    const danGotTurn = dan.myTurn();
    const s0 = dan.gs.currentBet;
    dan.act('raise', 1500); await sleep(700);
    const s1 = dan.gs.currentBet;
    S.bots.forEach(b => b.close());
    return (shove = { fayTotal, accepted, danGotTurn, before: s0, after: s1, err: r.err });
  }
  await T.check('short-allin-raise-is-legal', ['M8'], async () => {
    const d = await shoveScenario();
    expect(d.accepted, `a shove to ${d.fayTotal} (more than the call, below a full raise) was not accepted: ${d.err}`);
  });
  await T.check('short-allin-does-not-reopen-betting', ['H3'], async () => {
    const d = await shoveScenario();
    expect(d.danGotTurn, 'the raiser did not get the turn back to call or fold');
    expect(d.after === d.before, `short all-in reopened betting: currentBet ${d.before} -> ${d.after} after Dan re-raised to 1500`);
  });
  await srv.stop();
  await T.done();
})();
