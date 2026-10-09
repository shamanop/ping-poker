'use strict';
// R2-E: a RULE-ABIDING game with a free round (a token pays for one flip; one currency per token would not change this test). A free round that wins nothing writes no ledger line (ADD-A-GAME.md section 4).
const crypto = require('crypto');
const BETS = [100, 500, 1000, 5000], MODES = ['play', 'chips'], RATE_MS = 150;
let C = null;
const lastAt = new Map(), tokens = new Map();
const keyOf = (s) => String(s.data.acct.key).toLowerCase().trim();
const bad = (socket, code) => socket.emit('error', { code, game: 'freeclean' });
module.exports = {
  id: 'freeclean', name: 'Free Round', kind: 'solo',
  init(ctx) { C = ctx; lastAt.clear(); tokens.clear(); },
  audit() { return { openRounds: [], pools: {} }; },
  _tokens: tokens,
  handlers: {
    flip(socket, p) {
      const key = keyOf(socket), t = C.now();
      if (lastAt.has(key) && t - lastAt.get(key) < RATE_MS) return bad(socket, 'rate');
      lastAt.set(key, t);
      const mode = p && p.mode, tk = key + '|' + mode, bet = p && p.bet, free = !!(p && p.free === true);
      if (!MODES.includes(mode)) return bad(socket, 'bad_mode');
      if (typeof bet !== 'number' || !BETS.includes(bet)) return bad(socket, 'bad_bet');
      if (free && !(tokens.get(tk) > 0)) return bad(socket, 'no_token');
      const hit = C.rng() < 0.5, win = hit ? bet * 192 / 100 : 0, cost = free ? 0 : bet;
      const roundId = crypto.randomBytes(8).toString('hex');
      try { C.money.round(key, mode, roundId, { cost, win }); } catch (e) { return bad(socket, e && e.code === 'funds' ? 'funds' : 'internal'); }
      if (free) tokens.set(tk, tokens.get(tk) - 1); else if (!hit) tokens.set(tk, (tokens.get(tk) || 0) + 1);
      socket.emit('g:freeclean:result', { roundId, mode, bet, cost, win, tokens: tokens.get(tk) || 0 });
    },
  },
};
