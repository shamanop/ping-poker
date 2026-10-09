'use strict';
// Kit adapter for Cold Call (ADD-A-GAME.md section 9). Plays the game with its own messages only: spin (plain or buyBonus) and decide. Never touches money.
const path = require('path');

const BUYS = ['bonus1', 'bonus2'];
// answer every open decision (pick the first marked square, bank the gamble) until the round is done -> the final `done` result
function finishRound(g, sock, r) {
  let n = 0;
  while (r.status === 'pending') {
    if (n++ > 40) throw new Error('coldcall kit: a round with more than 40 decisions');
    const d = r.pending.k === 'pick' ? { k: 'pick', p: r.pending.choices[0] } : { k: 'more', take: false };
    r = g.call(sock, 'decide', { roundId: r.roundId, ...d });
  }
  return r;
}
const shown = (r) => ({ roundId: r.roundId, cost: r.cost, win: r.totalWin + (r.pot && r.pot.amount ? r.pot.amount : 0) });   // what the client was told it paid and won (a pot prize is paid on top of totalWin)

// buy bonuses until one stops at a decision of the wanted kind ('pick' | 'more'); a buy that ends without one is a finished round
function toPending(g, sock, kind, cur, bet) {
  for (let i = 0; i < 400; i++) {
    let r = g.call(sock, 'spin', { mode: cur, bet, buyBonus: BUYS[i % 2] });
    let n = 0;
    while (r.status === 'pending') {
      if (r.pending.k === kind) return r;
      if (n++ > 40) throw new Error('coldcall kit: a round with more than 40 decisions');
      const d = r.pending.k === 'pick' ? { k: 'pick', p: r.pending.choices[i % r.pending.choices.length] } : { k: 'more', take: i % 3 !== 0 };
      r = g.call(sock, 'decide', { roundId: r.roundId, ...d });
    }
  }
  throw new Error(`coldcall kit: no ${kind} decision in 400 buys`);
}

module.exports = {
  id: 'coldcall',
  module: 'coldcall.js',
  files: (dir) => ({ coldcallPull: path.join(dir, 'coldcall-pull.json'), coldcallConfig: path.join(dir, 'coldcall-config.json') }),
  prepare(mod) { mod.log = () => {}; mod.potRng = () => 1; mod._history.clear(); },   // the office pot is never won unless a test says so
  crash(mod) {                                       // a kill: no decision timer fires afterwards, the store keeps only what it already wrote
    for (const rec of mod._pull.open.values()) if (rec.timer) { clearTimeout(rec.timer); rec.timer = null; }
    try { mod._pull.store.close(true); } catch {}
  },
  bets: { good: [10, 50, 100, 500], min: 1, max: 2500 },   // cents / chips
  maxCost: (bet) => bet * 500,                       // a bought bonus costs a multiple of the bet
  oneOpen: true,                                     // one open decision per account and currency
  playVariants: 3,                                   // 0: a plain spin, 1: buy bonus1, 2: buy bonus2 (decisions answered until done)
  open: (cur, bet) => ({ ev: 'spin', payload: { mode: cur, bet } }),
  play(g, sock, { cur, bet, i }) {
    const v = i % 3, p = { mode: cur, bet };
    if (v) p.buyBonus = BUYS[v - 1];
    return shown(finishRound(g, sock, g.call(sock, 'spin', p)));
  },
  heldPoints: ['pick', 'more'].map((kind) => ({
    name: kind,                                      // a bought bonus stopped at a PICK YOUR LEAD / ONE MORE CALL decision with its stake in escrow
    hold(g, sock, { cur, bet }) { const r = toPending(g, sock, kind, cur, bet); return { roundId: r.roundId, cost: r.cost, bootWin: null, pending: r.pending }; },   // a restart plays the stored tape with the default answer: not a number the client saw
    finish: (g, sock, held) => ({ win: shown(finishRound(g, sock, { status: 'pending', roundId: held.roundId, pending: held.pending })).win }),
  })),
};
