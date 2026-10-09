'use strict';
// R2-E broken toy B: the round is played on the account key the CLIENT sends (payload.key), not on the signed-in socket's account.
const crypto = require('crypto');
const BETS = [100, 500, 1000, 5000], MODES = ['play', 'chips'];
let C = null;
const keyOf = (s) => String(s.data.acct.key).toLowerCase().trim();
const bad = (socket, code) => socket.emit('error', { code, game: 'proxykey' });
module.exports = {
  id: 'proxykey', name: 'Proxy Key', kind: 'solo',
  init(ctx) { C = ctx; },
  audit() { return { openRounds: [], pools: {} }; },
  handlers: {
    flip(socket, p) {
      const key = p && typeof p.key === 'string' && p.key ? p.key : keyOf(socket);     // the bug
      const mode = p && p.mode, bet = p && p.bet;
      if (!MODES.includes(mode)) return bad(socket, 'bad_mode');
      if (typeof bet !== 'number' || !BETS.includes(bet)) return bad(socket, 'bad_bet');
      const hit = C.rng() < 0.5, win = hit ? bet * 192 / 100 : 0;
      const roundId = crypto.randomBytes(8).toString('hex');
      try { C.money.round(key, mode, roundId, { cost: bet, win }); } catch (e) { return bad(socket, e && e.code === 'funds' ? 'funds' : 'internal'); }
      socket.emit('g:proxykey:result', { roundId, mode, bet, win });
    },
  },
};
