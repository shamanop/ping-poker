'use strict';
// R2-E broken toy D: 60% of the flips pay 1.5 x the bet (90% return on paper). The contract refuses a fractional win, so the game rounds it: UP.
const crypto = require('crypto');
const BETS = [1, 5, 100, 500], MODES = ['play', 'chips'];
let C = null;
const keyOf = (s) => String(s.data.acct.key).toLowerCase().trim();
const bad = (socket, code) => socket.emit('error', { code, game: 'ceilwin' });
module.exports = {
  id: 'ceilwin', name: 'Ceil Win', kind: 'solo',
  init(ctx) { C = ctx; },
  audit() { return { openRounds: [], pools: {} }; },
  handlers: {
    flip(socket, p) {
      const key = keyOf(socket), mode = p && p.mode, bet = p && p.bet;
      if (!MODES.includes(mode)) return bad(socket, 'bad_mode');
      if (typeof bet !== 'number' || !BETS.includes(bet)) return bad(socket, 'bad_bet');
      const win = C.rng() < 0.6 ? Math.ceil(bet * 1.5) : 0;
      const roundId = crypto.randomBytes(8).toString('hex');
      try { C.money.round(key, mode, roundId, { cost: bet, win }); } catch (e) { return bad(socket, e && e.code === 'funds' ? 'funds' : 'internal'); }
      socket.emit('g:ceilwin:result', { roundId, mode, bet, win });
    },
  },
};
