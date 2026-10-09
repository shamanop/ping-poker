'use strict';
// R2-E broken toy C: 10% of every stake goes into a jackpot that is only a number in this module (not a pool account), one number for both currencies.
// One round in five wins the whole pot on top of its own result. The pot is gone at a restart.
const crypto = require('crypto');
const BETS = [100, 500, 1000, 5000], MODES = ['play', 'chips'];
let C = null, pot = 0;
const keyOf = (s) => String(s.data.acct.key).toLowerCase().trim();
const bad = (socket, code) => socket.emit('error', { code, game: 'mempot' });
module.exports = {
  id: 'mempot', name: 'Mem Pot', kind: 'solo',
  init(ctx) { C = ctx; pot = 0; },
  audit() { return { openRounds: [], pools: {} }; },
  _pot: () => pot,
  handlers: {
    flip(socket, p) {
      const key = keyOf(socket), mode = p && p.mode, bet = p && p.bet;
      if (!MODES.includes(mode)) return bad(socket, 'bad_mode');
      if (typeof bet !== 'number' || !BETS.includes(bet)) return bad(socket, 'bad_bet');
      const hit = C.rng() < 0.45, jack = C.rng() < 0.2;
      const feed = bet / 10, prize = jack ? pot + feed : 0, win = (hit ? bet * 192 / 100 : 0) + prize;
      const roundId = crypto.randomBytes(8).toString('hex');
      try { C.money.round(key, mode, roundId, { cost: bet, win }); } catch (e) { return bad(socket, e && e.code === 'funds' ? 'funds' : 'internal'); }
      pot = jack ? 0 : pot + feed;
      socket.emit('g:mempot:result', { roundId, mode, bet, win, jackpot: prize, pot });
    },
  },
};
