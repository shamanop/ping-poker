'use strict';
// Pot disbursement (rigged decks): per-player money after the hand against a reference settlement (side pots, odd chip left of the button,
// uncalled bets returned, folded/kicked/stood-up/disconnected seats). Audit repro 20 scenarios S1-S10, rewritten to be seat- and button-agnostic.
// Totals = chips still at the table + bank delta, so a seat that was cashed out is counted too.
const { startServer, sleep, drive, P, rigDeck, runPot, diffTotals, waitFor, suite, expect } = require('./lib');
const T = suite(__filename);
const BOARD = ['Ts', 'Jh', 'Qd', 'Kc', 'Ac'];          // broadway on the board: everyone ties unless folded
const DRY = ['3c', '8d', '9h', '4s', '5h'];
const nm = (tag, n) => Array.from({ length: n }, (_, i) => `${tag}p${i}`);
const allAllIn = b => b.gs.players.filter(p => !p.folded).every(p => p.allIn);
const cache = {};

const specs = {
  S1: { bug: ['L1'], title: 'S1-three-way-split-odd-chip-goes-left-of-button',
    names: nm('S1', 4), stacks: [1000, 1000, 1000, 1000], settings: { blinds: { sb: 25, bb: 50 } },
    deck: rigDeck([['2c', '3d'], ['4c', '5d'], ['2d', '4h'], ['3h', '5s']], BOARD),
    policies: [P.call, P.fold, P.call, P.call], strength: [1, 0, 1, 1],
    folded: S => new Set([S.names[1]]), committed: S => ({ [S.names[0]]: 50, [S.names[1]]: S.blinds[S.names[1]], [S.names[2]]: 50, [S.names[3]]: 50 }) },
  S2: { bug: ['L1'], title: 'S2-four-way-split-odd-chip-goes-left-of-button',
    names: nm('S2', 6), stacks: Array(6).fill(1000),
    deck: rigDeck([['2c', '3d'], ['4c', '5d'], ['2d', '4h'], ['3h', '5s'], ['2h', '3s'], ['6c', '7d']], BOARD),
    policies: [P.call, P.fold, P.call, P.call, P.call, P.fold], strength: [1, 0, 1, 1, 1, 0],
    folded: S => new Set([S.names[1], S.names[5]]), committed: S => ({ [S.names[0]]: 50, [S.names[1]]: S.blinds[S.names[1]], [S.names[2]]: 50, [S.names[3]]: 50, [S.names[4]]: 50, [S.names[5]]: S.blinds[S.names[5]] || 0 }) },
  S3: { bug: [], title: 'S3-folded-big-contributor-and-uncalled-bet', want: 0,
    names: nm('S3', 3), stacks: [5000, 300, 5000], deck: rigDeck([['Ks', 'Kd'], ['As', 'Ad'], ['7c', '2d']], DRY),
    policies: [P.street({ preflop: P.raiseTo(1000), default: P.fold }), P.call, P.street({ preflop: P.call, default: P.raiseTo(2000) })], strength: [3, 2, 1],
    folded: S => new Set([S.names[0]]), committed: S => ({ [S.names[0]]: 1000, [S.names[1]]: S.start[S.names[1]], [S.names[2]]: 3000 }) },
  S4: { bug: [], title: 'S4-uncalled-bet-returned-to-the-loser-heads-up',
    names: nm('S4', 2), stacks: [5000, 1000], deck: rigDeck([['7c', '2d'], ['As', 'Ad']], ['3c', '8d', '9h', '4s', 'Kc']),
    policies: [P.allin, P.call], strength: [1, 2], committed: S => ({ [S.names[0]]: 5000, [S.names[1]]: 1000 }) },
  S6: { bug: [], title: 'S6-foldwin-totals', want: 0,
    names: nm('S6', 3), stacks: [1000, 1000, 1000], deck: rigDeck([['As', 'Ad'], ['Ks', 'Kd'], ['7c', '2d']], BOARD),
    policies: [P.raiseTo(300), P.fold, P.fold], strength: [3, 2, 1],
    folded: S => new Set([S.names[1], S.names[2]]), committed: S => ({ [S.names[0]]: 300, [S.names[1]]: S.blinds[S.names[1]], [S.names[2]]: S.blinds[S.names[2]] }) },
  S6b: { bug: [], title: 'S6b-river-bet-folded', want: 0,
    names: nm('S6b', 3), stacks: [1000, 1000, 1000], deck: rigDeck([['As', 'Ad'], ['Ks', 'Kd'], ['7c', '2d']], DRY),
    policies: [P.street({ river: P.raiseTo(500), default: P.call }), P.street({ river: P.checkfold, default: P.call }), P.street({ river: P.checkfold, default: P.call })], strength: [3, 2, 1],
    folded: S => new Set([S.names[1], S.names[2]]), committed: S => ({ [S.names[0]]: 550, [S.names[1]]: 50, [S.names[2]]: 50 }) },
  S9: { bug: [], title: 'S9-side-pot-tie',
    names: nm('S9', 3), stacks: [1001, 301, 1001], settings: { blinds: { sb: 10, bb: 20 } },
    deck: rigDeck([['Ks', 'Ah'], ['As', 'Ad'], ['Kd', 'Ac']], ['3c', '8d', '9h', '4s', '2h']),
    policies: [P.allin, P.allin, P.allin], strength: [2, 3, 2], committed: S => ({ [S.names[0]]: 1001, [S.names[1]]: 301, [S.names[2]]: 1001 }) },
  S10: { bug: ['L1'], title: 'S10-side-pot-tie-odd-chip-goes-left-of-button',
    names: nm('S10', 4), stacks: [1000, 333, 1000, 1000], settings: { blinds: { sb: 10, bb: 20 } },
    deck: rigDeck([['Ks', 'Ah'], ['As', 'Ad'], ['Kd', 'Ac'], ['7c', '2d']], ['3c', '8d', '9h', '4s', 'Jh']),
    policies: [P.allin, P.allin, P.allin, P.allin], strength: [2, 3, 2, 1], committed: S => ({ [S.names[0]]: 1000, [S.names[1]]: 333, [S.names[2]]: 1000, [S.names[3]]: 1000 }) },
};
// scripted scenarios (disconnect / leave / kick in the middle of the hand)
specs.S5a = { bug: ['H1'], title: 'S5a-allin-disconnect-short-stack-has-best-hand', want: 0,
  names: nm('S5a', 3), stacks: [3000, 500, 3000], deck: rigDeck([['Ks', 'Kd'], ['As', 'Ad'], ['7c', '2d']], DRY),
  strength: [2, 3, 1], committed: S => ({ [S.names[0]]: 3000, [S.names[1]]: 500, [S.names[2]]: 3000 }),
  script: async S => { await drive(S.bots, [P.allin, P.call, P.call], () => allAllIn(S.bots[0]), 15000); await sleep(300); S.bots[1].close(); } };
specs.S5b = { bug: ['H1'], title: 'S5b-allin-disconnect-covering-stack-has-best-hand', want: 0, observer: 1,
  names: nm('S5b', 3), stacks: [3000, 500, 2000], deck: rigDeck([['As', 'Ad'], ['Ks', 'Kd'], ['7c', '2d']], DRY),
  strength: [3, 2, 1], committed: S => ({ [S.names[0]]: 3000, [S.names[1]]: 500, [S.names[2]]: 2000 }),
  script: async S => { await drive(S.bots, [P.allin, P.call, P.call], () => allAllIn(S.bots[1]), 15000); await sleep(300); S.bots[0].close(); } };
// P0 raises 400, P1 and P2 call; flop: P1 bets 300, then the host removes P2 (kick) while it is P2's turn. P0 calls and checks down with AA.
specs.S8a = { bug: [], title: 'S8a-kick-midhand-keeps-the-bet-in-the-pot', want: 0,
  names: nm('S8a', 3), stacks: [1000, 1000, 1000], deck: rigDeck([['As', 'Ad'], ['Ks', 'Kd'], ['7c', '2d']], DRY),
  strength: [3, 2, 1], folded: S => new Set([S.names[2]]), committed: S => ({ [S.names[0]]: 700, [S.names[1]]: 700, [S.names[2]]: 400 }),
  script: async S => {
    const [h, p1, p2] = S.bots;
    const pol = [P.street({ preflop: P.raiseTo(400), default: P.call }), P.street({ preflop: P.call, flop: P.raiseTo(300), default: P.call }), P.street({ preflop: P.call, default: () => null })];
    await drive(S.bots, pol, () => p2.myTurn() && p2.gs.street === 'flop' && p2.gs.currentBet === 300, 15000);
    h.emit('table_kick', { tableId: S.id, key: p2.key }); await sleep(300);
    await drive(S.bots, pol, () => h.showdowns.length > S.sd0[0], 15000);
  } };
// P0 1000 (KK), P1 3000 (AA), P2 600 (QQ) all in; P1's top 2000 is never matched. Then P1 stands up (leave) or is kicked during the run-out.
for (const how of ['leave', 'kick']) specs['S8' + (how === 'leave' ? 'b' : 'c')] = { bug: ['N1'], title: `S8${how === 'leave' ? 'b' : 'c'}-${how === 'leave' ? 'standup' : 'kick'}-of-biggest-contributor-gets-uncalled-layer-back`, want: 0,
  names: nm('S8' + (how === 'leave' ? 'b' : 'c'), 3), stacks: [1000, 3000, 600], deck: rigDeck([['Ks', 'Kd'], ['As', 'Ad'], ['Qs', 'Qd']], DRY),
  strength: [3, 2, 1], folded: S => new Set([S.names[1]]), committed: S => ({ [S.names[0]]: 1000, [S.names[1]]: 3000, [S.names[2]]: 600 }),
  script: async S => {
    await drive(S.bots, [P.allin, P.allin, P.call], () => S.bots[0].gs.players.filter(p => !p.folded).every(p => p.allIn || p.chips === 0) && S.bots[0].gs.street !== undefined && S.bots[0].gs.pot > 0, 15000);
    await sleep(300);
    if (how === 'leave') await S.bots[1].leave(S.id); else S.bots[0].emit('table_kick', { tableId: S.id, key: S.bots[1].key });
  } };

(async () => {
  const srv = await startServer(0, { handDelayMs: 1200, env: { HOST_GRACE_MS: '600000' } });
  for (const [k, spec] of Object.entries(specs)) {
    await T.check(spec.title, spec.bug, async () => {
      const r = cache[k] = await runPot(srv, spec);
      expect(r.res.sd, 'no showdown_result');
      const d = diffTotals(r.res.totals, r.exp.totals);
      expect(!d, d + ` (start ${JSON.stringify(r.S.start)}, button ${r.S.button})`);
    });
  }
  await T.check('S4-showdown-winners-exclude-the-uncalled-return', ['L3'], async () => {
    const r = cache.S4; expect(r, 'S4 did not run');
    const names = r.res.sd.winners.map(w => w.name);
    expect(names.length === 1 && names[0] === r.S.names[1], `showdown_result.winners lists ${names.join(',')}; only the pot winner ${r.S.names[1]} belongs there (the loser only got an uncalled bet back)`);
  });
  await srv.stop();
  await T.done();
})();
