'use strict';
// R2-E broken toy E: a two-step game (deal: stake into escrow, reveal: settle). When the player's socket disconnects the game forgets the open round
// and does NOT refund it (ADD-A-GAME.md 5.8: "Leave an escrow non-zero for a round it no longer knows").
const crypto = require('crypto');
const BETS = [100, 500, 1000, 5000];
let C = null, rec = new Map();
const keyOf = (s) => String(s.data.acct.key).toLowerCase().trim();
const bad = (socket, code) => socket.emit('error', { code, game: 'dropper' });
module.exports = {
  id: 'dropper', name: 'Dropper', kind: 'solo',
  init(ctx) { C = ctx; rec = new Map(); },
  audit() { return { openRounds: [...rec.entries()].map(([key, r]) => ({ key, cur: r.cur, roundId: r.roundId, amount: r.bet })), pools: {} }; },
  onDisconnect(socket) { rec.delete(keyOf(socket)); },          // the bug: the record is dropped, the escrow is not voided
  handlers: {
    deal(socket, p) {
      const key = keyOf(socket), mode = p && p.mode, bet = p && p.bet;
      if (mode !== 'play' && mode !== 'chips') return bad(socket, 'bad_mode');
      if (typeof bet !== 'number' || !BETS.includes(bet)) return bad(socket, 'bad_bet');
      if (rec.has(key)) return bad(socket, 'run_open');
      const roundId = crypto.randomBytes(6).toString('hex');
      try { C.money.open(key, mode, roundId, bet); } catch (e) { return bad(socket, e && e.code === 'funds' ? 'funds' : 'internal'); }
      rec.set(key, { roundId, cur: mode, bet });
      socket.emit('g:dropper:dealt', { roundId });
    },
    reveal(socket, p) {
      const key = keyOf(socket), id = p && p.roundId, r = rec.get(key);
      if (!r || r.roundId !== id) return bad(socket, 'no_run');
      const win = (C.rng ? C.rng() : Math.random()) < 0.5 ? r.bet * 192 / 100 : 0;
      try { C.money.settle(key, r.cur, id, { win, stake: r.bet }); } catch (e) { return bad(socket, 'internal'); }
      rec.delete(key);
      socket.emit('g:dropper:result', { roundId: id, win });
    },
  },
};
