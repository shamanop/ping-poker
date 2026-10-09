'use strict';
// RVK-3 toy, the Chips-to-Cash half of `carry` ONLY. A coin flip with a boost token, like freeflip, but the token is kept in a FILE: it survives a restart, so the
// restart comparison cannot see it. It still has no currency: a Chips flip that loses grants a token and a later Cash flip spends it (double pay).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const BETS = [100, 500, 1000, 5000], MODES = ['play', 'chips'], RATE_MS = 150;
let C = null, file = null;
const lastAt = new Map();
let tokens = {};
const keyOf = (s) => String(s.data.acct.key).toLowerCase().trim();
const bad = (socket, code) => socket.emit('error', { code, game: 'chipscarry' });
const save = () => fs.writeFileSync(file, JSON.stringify(tokens));
module.exports = {
  id: 'chipscarry', name: 'Chips Carry', kind: 'solo',
  init(ctx) {
    C = ctx; lastAt.clear(); file = path.join(ctx.files.dir, 'tokens.json');
    try { tokens = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { tokens = {}; }
  },
  audit() { return { openRounds: [], pools: {} }; },
  handlers: {
    flip(socket, p) {
      const key = keyOf(socket), t = C.now();
      if (lastAt.has(key) && t - lastAt.get(key) < RATE_MS) return bad(socket, 'rate');
      lastAt.set(key, t);
      const mode = p && p.mode, bet = p && p.bet, boost = !!(p && p.boost === true);
      if (!MODES.includes(mode)) return bad(socket, 'bad_mode');
      if (typeof bet !== 'number' || !BETS.includes(bet)) return bad(socket, 'bad_bet');
      if (boost && !(tokens[key] > 0)) return bad(socket, 'no_token');
      const hit = C.rng() < 0.5, win = hit ? bet * 192 / 100 * (boost ? 2 : 1) : 0;
      const roundId = crypto.randomBytes(8).toString('hex');
      try { C.money.round(key, mode, roundId, { cost: bet, win }); } catch (e) { return bad(socket, e && e.code === 'funds' ? 'funds' : 'internal'); }
      if (boost) tokens[key] -= 1; else if (!hit) tokens[key] = (tokens[key] || 0) + 1;
      save();
      socket.emit('g:chipscarry:result', { roundId, mode, bet, cost: bet, win, tokens: tokens[key] || 0 });
    },
  },
};
