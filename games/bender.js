'use strict';
// Ballot Bender: server-authoritative slot. Math lives in bender-engine.js (same file the client copy uses).
const crypto = require('crypto');
const Eng = require('./bender-engine.js');

const BET_LEVELS = Eng.BET_LEVELS;
const RATE_MS = 150;
const HISTORY_MAX = 20;
const RTP_LABEL = '95.8% (long-run, 12M spin sim)';

function cryptoRng() {
  return () => crypto.randomBytes(6).readUIntBE(0, 6) / 281474976710656; // 48-bit uniform in [0,1)
}

const history = new Map(); // account key -> last rounds (memory only)
const keyOf = (socket) => { const a = socket.data && socket.data.acct; return String(a && typeof a === 'object' ? a.key : a || ''); };

function err(socket, code, message) { socket.emit('error', { message, code, game: 'bender' }); }

function walletErr(socket, e) {
  if (e && e.code === 'funds') return err(socket, 'funds', 'Not enough Play $');
  if (e && e.code === 'limit') return err(socket, 'limit', 'Ledger limit reached');
  return err(socket, 'bad_request', 'Could not place that bet');
}

module.exports = {
  id: 'bender',
  name: 'Ballot Bender',
  kind: 'solo',
  betLevels: BET_LEVELS,
  RTP_LABEL,
  init(ctx) { this.rng = ctx.rng || cryptoRng(); },
  onDisconnect(socket) { if (socket.data) delete socket.data.benderLast; },
  handlers: {
    state(socket, payload, ctx) {
      socket.emit('g:bender:state', {
        betLevels: BET_LEVELS, modes: ['play', 'ledger'], rtp: RTP_LABEL,
        buyCostX: { election: Eng.CFG.buyCost.election, landslide: Eng.CFG.buyCost.landslide },
        wallet: ctx.wallet.get(keyOf(socket)), balances: ctx.wallet.get(keyOf(socket)), bets: BET_LEVELS,
      });
    },
    history(socket) {
      socket.emit('g:bender:history', { rounds: history.get(keyOf(socket)) || [] });
    },
    spin(socket, payload, ctx) {
      const t = ctx.now();
      if (socket.data.benderLast != null && t - socket.data.benderLast < RATE_MS) return err(socket, 'rate', 'Slow down');
      socket.data.benderLast = t;
      const p = payload && typeof payload === 'object' ? payload : {};
      if (!Number.isSafeInteger(p.bet) || !BET_LEVELS.includes(p.bet)) return err(socket, 'bad_bet', 'Pick a listed bet');
      if (p.mode !== 'play' && p.mode !== 'ledger') return err(socket, 'bad_mode', 'Pick Play $ or Ledger $');
      const buy = p.buyBonus == null || p.buyBonus === false ? null : p.buyBonus;
      if (buy !== null && buy !== 'election' && buy !== 'landslide') return err(socket, 'bad_request', 'Bad bonus');

      const key = keyOf(socket);
      const rng = module.exports.rng || cryptoRng();
      const roundId = crypto.randomBytes(6).toString('hex');
      const r = Eng.resolveRound(rng, buy);                // pure; nothing touched yet
      const cost = Math.round(r.costMult * p.bet);
      const totalWin = Math.round(r.totalWinMult * p.bet);
      const ref = { game: 'bender', round: roundId };
      let w;
      try { ctx.wallet.spend(key, p.mode, cost, ref); } catch (e) { return walletErr(socket, e); }
      try { w = ctx.wallet.credit(key, p.mode, totalWin, ref); } catch (e) { w = ctx.wallet.get(key); }

      const h = history.get(key) || [];
      h.unshift({ roundId, t: t, bet: p.bet, cost, mode: p.mode, buy, totalWin, tier: r.tier });
      if (h.length > HISTORY_MAX) h.length = HISTORY_MAX;
      history.set(key, h);

      try { if (ctx.social) ctx.social.onSpin(socket, { bet: p.bet, totalWin, tier: r.tier, mode: p.mode }); } catch {}
      socket.emit('g:bender:result', {
        roundId, bet: p.bet, cost, mode: p.mode, buyBonus: buy,
        grid: r.grid, cascades: r.cascades, finalGrid: r.finalGrid, scatters: r.scatters, scatterPay: r.scatterPay,
        bonus: r.bonus, totalWinMult: r.totalWinMult, totalWin, tier: r.tier, maxed: r.maxed, steps: r.steps,
        wallet: w, balances: w, round: r.round,
      });
    },
  },
  _history: history,
};
