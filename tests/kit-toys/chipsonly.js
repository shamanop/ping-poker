'use strict';
// EXAMPLE game: copy this file to start a new one (ADD-A-GAME.md section 9). One bet, one coin, 96% return. It is NOT in games/index.js MODULES:
// only `node tests/game-kit.js chipsonly` and the kit self-test load it. Money rules in short: the server mints the round id, takes every number
// from its own table, makes ONE ctx.money call (the ledger first), and only after that call returned does it tell the client anything.
const crypto = require('crypto');

const BETS = [100, 500, 1000, 5000];     // whole units (Play cents / chips); the client picks a level, never an amount
const WIN_X100 = 192;                    // a hit pays 1.92 x the bet: 0.5 * 1.92 = 96%
const MODES = ['chips'];
const RATE_MS = 150;

let C = null;                            // the ctx from init: { money, now, rng }
const lastAt = new Map();                // account key -> time of its last accepted flip (rate limit; not money)
const cryptoRng = () => crypto.randomBytes(6).readUIntBE(0, 6) / 281474976710656;
const keyOf = (s) => { const a = s.data && s.data.acct; return String(a && typeof a === 'object' ? a.key : a || '').toLowerCase().trim(); };
const bad = (socket, code, message) => socket.emit('error', { code, message, game: 'chipsonly' });

module.exports = {
  id: 'chipsonly',
  name: 'Coin Flip',
  kind: 'solo',
  init(ctx) { C = ctx; lastAt.clear(); },
  audit() { return { openRounds: [], pools: {} }; },     // an instant game never holds an escrow
  handlers: {
    flip(socket, p) {
      const key = keyOf(socket), t = C.now();
      if (lastAt.has(key) && t - lastAt.get(key) < RATE_MS) return bad(socket, 'rate', 'Too fast');
      lastAt.set(key, t);
      const mode = p && p.mode, bet = p && p.bet, call = p && p.call;
      if (!MODES.includes(mode)) return bad(socket, 'bad_mode', 'Pick Cash or chips');
      if (typeof bet !== 'number' || !BETS.includes(bet)) return bad(socket, 'bad_bet', 'Pick a bet level');
      if (call !== 'heads' && call !== 'tails') return bad(socket, 'bad_call', 'Pick heads or tails');
      const side = (C.rng || cryptoRng)() < 0.5 ? 'heads' : 'tails';          // resolved first, with the injected rng, before any money moves
      const win = side === call ? bet * WIN_X100 / 100 : 0;
      const roundId = crypto.randomBytes(8).toString('hex');
      try { C.money.round(key, mode, roundId, { cost: bet, win }); }          // the one money call: stake and win in one batch
      catch (e) { return e && e.code === 'funds' ? bad(socket, 'funds', 'Not enough funds') : bad(socket, 'internal', 'Server error'); }
      socket.emit('g:chipsonly:result', { roundId, mode, bet, call, side, win, balance: C.money.balance(key, mode) });
    },
  },
};
