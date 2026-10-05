'use strict';
// COLD CALL: server-authoritative slot. Math lives in coldcall-engine.js (same file the client copy uses, for animation only).
const crypto = require('crypto');
const Eng = require('./coldcall-engine.js');

const BET_LEVELS = Eng.BET_LEVELS;
const BUYS = ['rotary', 'quote'];
const RATE_MS = 150;
const HISTORY_MAX = 20;
const RTP_LABEL = '98% (long-run, 200M spin sim, +-0.1)';

function cryptoRng() {
  return () => crypto.randomBytes(6).readUIntBE(0, 6) / 281474976710656; // 48-bit uniform in [0,1)
}

const history = new Map(); // account key -> last rounds (memory only)
const keyOf = (socket) => { const a = socket.data && socket.data.acct; return String(a && typeof a === 'object' ? a.key : a || ''); };

function err(socket, code, message) { socket.emit('error', { message, code, game: 'coldcall' }); }

function walletErr(socket, e) {
  if (e && e.code === 'funds') return err(socket, 'funds', 'Not enough Play $');
  if (e && e.code === 'limit') return err(socket, 'limit', 'Ledger limit reached');
  return err(socket, 'bad_request', 'Could not place that bet');
}

module.exports = {
  id: 'coldcall',
  name: 'Cold Call',
  kind: 'solo',
  betLevels: BET_LEVELS,
  RTP_LABEL,
  init(ctx) { this.rng = ctx.rng || cryptoRng(); },
  onDisconnect(socket) { if (socket.data) delete socket.data.coldcallLast; },
  handlers: {
    state(socket, payload, ctx) {
      const w = ctx.wallet.get(keyOf(socket));
      socket.emit('g:coldcall:state', {
        betLevels: BET_LEVELS, modes: ['play', 'ledger'], rtp: RTP_LABEL, maxWinX: Eng.MAX_WIN_X,
        buyCostX: { rotary: Eng.CFG.buyCost.rotary / 10, quote: Eng.CFG.buyCost.quote / 10 },
        wallet: w, balances: w, bets: BET_LEVELS,
      });
    },
    history(socket) {
      socket.emit('g:coldcall:history', { rounds: history.get(keyOf(socket)) || [] });
    },
    spin(socket, payload, ctx) {
      const t = ctx.now();
      if (socket.data.coldcallLast != null && t - socket.data.coldcallLast < RATE_MS) return err(socket, 'rate', 'Slow down');
      socket.data.coldcallLast = t;
      const p = payload && typeof payload === 'object' ? payload : {};
      if (!Number.isSafeInteger(p.bet) || !BET_LEVELS.includes(p.bet)) return err(socket, 'bad_bet', 'Pick a listed bet');
      if (p.mode !== 'play' && p.mode !== 'ledger') return err(socket, 'bad_mode', 'Pick Play $ or Ledger $');
      const buy = p.buyBonus == null || p.buyBonus === false ? null : p.buyBonus;
      if (buy !== null && !BUYS.includes(buy)) return err(socket, 'bad_request', 'Bad bonus');

      const key = keyOf(socket);
      const rng = module.exports.rng || cryptoRng();
      const roundId = crypto.randomBytes(6).toString('hex');
      const r = Eng.resolveRound(rng, buy);                // pure; nothing touched yet
      let cost, totalWin;
      try { cost = Eng.cents(r.costTenths, p.bet); totalWin = Eng.cents(r.winTenths, p.bet); } catch (e) { return err(socket, 'bad_request', 'Could not place that bet'); }
      const ref = { game: 'coldcall', round: roundId };
      let w;
      try { ctx.wallet.spend(key, p.mode, cost, ref); } catch (e) { return walletErr(socket, e); }
      try { w = ctx.wallet.credit(key, p.mode, totalWin, ref); } catch (e) { w = ctx.wallet.get(key); }

      const h = history.get(key) || [];
      h.unshift({ roundId, t, bet: p.bet, cost, mode: p.mode, buy, totalWin, tier: r.tier });
      if (h.length > HISTORY_MAX) h.length = HISTORY_MAX;
      history.set(key, h);

      socket.emit('g:coldcall:result', {
        roundId, bet: p.bet, cost, mode: p.mode, buyBonus: buy,
        script: r.script, costTenths: r.costTenths, totalWinTenths: r.winTenths, totalWinMult: r.winX, totalWin, tier: r.tier, maxed: r.capped,
        wallet: w, balances: w,
      });
    },
  },
  _history: history,
};
