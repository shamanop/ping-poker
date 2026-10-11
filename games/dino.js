'use strict';
// Dino: server-authoritative pay-anywhere tumble slot. Math lives in dino-engine.js (same file the client copy uses). Payload format: _dino/SCRIPT-FORMAT.md.
// An instant game: every spin (plain, ante or a bought feature) is resolved up front and is ONE ctx.money.round. No live config route yet (engine keeps RANGES / validateConfig).
const crypto = require('crypto');
const Eng = require('./dino-engine.js');

const RTP_LABEL = '96% (long-run, 36M-spin sim + 6M bonuses: base 96.1 +-0.1, ante 96.2 +-0.1, buy 96.1 +-0.1; bonus about 1 in 390, 1 in 190 with ante)';
const BET_LEVELS = Eng.BET_LEVELS;
const ANTE_LEVELS = Eng.anteLevels();
const MODES = ['play', 'chips'];
const RATE_MS = 150;
const HISTORY_MAX = 20;

function cryptoRng() {
  return () => crypto.randomBytes(6).readUIntBE(0, 6) / 281474976710656; // 48-bit uniform in [0,1)
}

const history = new Map(); // account key -> last rounds (memory only)
const lastAt = new Map();  // account key -> time of the last accepted spin (rate limit by ACCOUNT, ADD-A-GAME 6.7); not money
const keyOf = (socket) => { const a = socket.data && socket.data.acct; return String(a && typeof a === 'object' ? a.key : a || '').trim().toLowerCase(); };

function err(socket, code, message) { socket.emit('error', { message, code, game: 'dino' }); }
const balances = (ctx, key) => ({ play: ctx.money.balance(key, 'play'), chips: ctx.money.balance(key, 'chips') });
function walletErr(socket, e, mode) {
  if (e && e.code === 'funds') return err(socket, 'funds', mode === 'chips' ? 'Not enough chips' : 'Not enough Cash');
  return err(socket, 'bad_request', 'Could not place that bet');
}
// a flag is off when missing / false / null, on when exactly true; anything else is refused
const flag = (v) => (v == null || v === false ? false : v === true ? true : null);

function clientCfg() {
  const c = Eng.CFG;
  return { symbols: Eng.REG.slice(), pay: c.pay, payBuckets: [[8, 9], [10, 11], [12, Eng.COLS * Eng.ROWS]], scatterPay: c.scatterPay, freeSpins: c.freeSpins, retriggerMin: c.retriggerMin, retriggerAdd: c.retriggerAdd, maxSpins: c.maxSpins, bombValues: c.bombTable.map((x) => x[0]) };
}

module.exports = {
  id: 'dino',
  name: 'Dino',
  kind: 'solo',
  betLevels: BET_LEVELS,
  anteLevels: ANTE_LEVELS,
  RTP_LABEL,
  init(ctx) { this.rng = ctx.rng || cryptoRng(); lastAt.clear(); },
  handlers: {
    state(socket, payload, ctx) {
      const key = keyOf(socket);
      socket.emit('g:dino:state', {
        betLevels: BET_LEVELS, anteLevels: ANTE_LEVELS, anteCost: Eng.CFG.anteCost, buyCostX: Eng.CFG.buyCost, maxWinX: Eng.MAX_WIN_X,
        modes: MODES, rtp: RTP_LABEL, cfg: clientCfg(), tiers: Eng.TIERS,
        wallet: balances(ctx, key), balances: balances(ctx, key),
      });
    },
    history(socket) {
      socket.emit('g:dino:history', { rounds: history.get(keyOf(socket)) || [] });
    },
    spin(socket, payload, ctx) {
      const key = keyOf(socket);
      const t = ctx.now();
      if (lastAt.has(key) && t - lastAt.get(key) < RATE_MS) return err(socket, 'rate', 'Slow down');
      const p = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
      if (!Number.isSafeInteger(p.bet) || !BET_LEVELS.includes(p.bet)) return err(socket, 'bad_bet', 'Pick a listed bet');
      if (!MODES.includes(p.mode)) return err(socket, 'bad_mode', 'Pick Cash or Chips');
      const ante = flag(p.ante), buy = flag(p.buy);
      if (ante === null || buy === null) return err(socket, 'bad_request', 'Bad option');
      if (ante && buy) return err(socket, 'ante_buy', 'The feature cannot be bought with the ante bet on');
      if (ante && !ANTE_LEVELS.includes(p.bet)) return err(socket, 'ante_level', 'Ante is not available at this bet');
      lastAt.set(key, t);

      const rng = module.exports.rng || cryptoRng();
      const roundId = crypto.randomBytes(6).toString('hex');
      const r = Eng.resolveRound(rng, { ante, buy });     // pure; nothing touched yet
      const exactCost = r.costMult * p.bet, cost = Math.round(exactCost);
      if (!(cost > 0) || Math.abs(exactCost - cost) > 1e-9) return err(socket, 'bad_request', 'Could not place that bet');   // prices are whole units by construction (ante levels, integer buy price)
      // unbiased rounding to whole units (as Ballot Bender): floor + one extra unit with probability = the fraction, so the long-run return is exact at every bet
      const exact = r.totalWinMult * p.bet, floor = Math.floor(exact + 1e-9);
      const totalWin = floor + (exact - floor > 1e-9 && rng() < exact - floor ? 1 : 0);
      // Ledger first (ADD-A-GAME.md rule 4): the whole round is ONE ledger write, ref dino:<key>:<roundId>. A money error is an error, never a result.
      try { ctx.money.round(key, p.mode, roundId, { cost, win: totalWin }); } catch (e) { return walletErr(socket, e, p.mode); }
      let w = null;
      try { w = balances(ctx, key); } catch { /* the round is in the ledger; the wallet push carries the balances */ }

      const h = history.get(key) || [];
      h.unshift({ roundId, t, bet: p.bet, cost, mode: p.mode, ante, buy, totalWin, tier: r.tier });
      if (h.length > HISTORY_MAX) h.length = HISTORY_MAX;
      history.set(key, h);

      // TODO(open question for Chris): social feed / achievements. ctx.social.onSpin counts every call as a Ballot Bender spin today, so Dino does not call it until social knows the game id.
      socket.emit('g:dino:result', {
        roundId, bet: p.bet, mode: p.mode, ante, buy, cost,
        totalWinMult: r.totalWinMult, totalWin, tier: r.tier, maxed: r.maxed,
        wallet: w, balances: w, round: r.round,
      });
    },
  },
  // an instant game never holds an escrow: nothing to recover, nothing to report (ADD-A-GAME.md section 6.5)
  audit() { return { openRounds: [], pools: {} }; },
  _history: history,
  _lastAt: lastAt,
};
