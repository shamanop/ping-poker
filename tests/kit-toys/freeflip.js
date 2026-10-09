'use strict';
// R2-E broken toy A: a coin flip with a "boost" token. A paid flip that loses grants one token; a token doubles the pay of one later flip.
// The token has no currency: it is earned in whatever mode the losing flip was played and spent in whatever mode the client names later.
const crypto = require('crypto');
const BETS = [100, 500, 1000, 5000], MODES = ['play', 'chips'], RATE_MS = 150;
let C = null;
const lastAt = new Map(), tokens = new Map();
const keyOf = (s) => String(s.data.acct.key).toLowerCase().trim();
const bad = (socket, code) => socket.emit('error', { code, game: 'freeflip' });
module.exports = {
  id: 'freeflip', name: 'Free Flip', kind: 'solo',
  init(ctx) { C = ctx; lastAt.clear(); tokens.clear(); },
  audit() { return { openRounds: [], pools: {} }; },
  _tokens: tokens,
  handlers: {
    flip(socket, p) {
      const key = keyOf(socket), t = C.now();
      if (lastAt.has(key) && t - lastAt.get(key) < RATE_MS) return bad(socket, 'rate');
      lastAt.set(key, t);
      const mode = p && p.mode, bet = p && p.bet, boost = !!(p && p.boost === true);
      if (!MODES.includes(mode)) return bad(socket, 'bad_mode');
      if (typeof bet !== 'number' || !BETS.includes(bet)) return bad(socket, 'bad_bet');
      if (boost && !(tokens.get(key) > 0)) return bad(socket, 'no_token');
      const hit = C.rng() < 0.5, win = hit ? bet * 192 / 100 * (boost ? 2 : 1) : 0;
      const roundId = crypto.randomBytes(8).toString('hex');
      try { C.money.round(key, mode, roundId, { cost: bet, win }); } catch (e) { return bad(socket, e && e.code === 'funds' ? 'funds' : 'internal'); }
      if (boost) tokens.set(key, tokens.get(key) - 1); else if (!hit) tokens.set(key, (tokens.get(key) || 0) + 1);
      socket.emit('g:freeflip:result', { roundId, mode, bet, cost: bet, win, tokens: tokens.get(key) || 0 });
    },
  },
};
