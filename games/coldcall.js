'use strict';
// COLD CALL: server-authoritative slot. Math lives in coldcall-engine.js (same file the client copy uses, for animation only).
const crypto = require('crypto');
const Eng = require('./coldcall-engine.js');

const BET_LEVELS = Eng.BET_LEVELS;
const BUYS = Eng.BUYS;   // call, bonus1, bonus2, hunt (prices in Eng.CFG.buyCost, tenths of the bet)
const RATE_MS = 150;
const HISTORY_MAX = 20;
const RTP_LABEL = '97.93% (long-run, 450M-spin stratified sim, +-0.11)';

// QA hook: forces a feature so the front end can be driven by a test. It runs ONLY when the server process was started
// with COLDCALL_TEST=1 (and NODE_ENV is not 'production'); otherwise `force` in a spin payload is ignored. Forced rounds are paid and
// charged through the normal wallet path, with real engine rounds (bells placed, or whole rounds re-rolled until the condition holds; no hand-made scripts).
//   bonus1 / bonus2 / bonus3 = 3 / 4 / 5 bells land; phone = phone feature with >= 4 hot leads; close = phone feature with a close and a second reveal round;
//   big = round pays >= 25x; tease = exactly 2 bells, no bonus.
const FORCES = Eng.FORCES;
const testHookOn = () => process.env.COLDCALL_TEST === '1' && process.env.NODE_ENV !== 'production';
const resolveForced = (rng, force) => Eng.resolveRound(rng, null, { force });

function cryptoRng() {
  return () => crypto.randomBytes(6).readUIntBE(0, 6) / 281474976710656; // 48-bit uniform in [0,1)
}

const history = new Map(); // account key -> last rounds (memory only)
const keyOf = (socket) => { const a = socket.data && socket.data.acct; return String(a && typeof a === 'object' ? a.key : a || ''); };

function err(socket, code, message) { socket.emit('error', { message, code, game: 'coldcall' }); }

function walletErr(socket, e) {
  if (e && e.code === 'funds') return err(socket, 'funds', e.message);
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
        engine: 2, grid: { cols: Eng.COLS, rows: Eng.ROWS },
        betLevels: BET_LEVELS, modes: ['play', 'chips'], rtp: RTP_LABEL, maxWinX: Eng.MAX_WIN_X,
        buyCostX: Object.fromEntries(BUYS.map((b) => [b, Eng.CFG.buyCost[b] / 10])),
        wallet: w, balances: w, bets: BET_LEVELS,
        ...(testHookOn() ? { qaHook: true } : {}),
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
      if (p.mode !== 'play' && p.mode !== 'chips') return err(socket, 'bad_mode', 'Pick Play $ or Chips');
      const buy = p.buyBonus == null || p.buyBonus === false ? null : p.buyBonus;
      if (buy !== null && !BUYS.includes(buy)) return err(socket, 'bad_request', 'Bad bonus');

      const key = keyOf(socket);
      const rng = module.exports.rng || cryptoRng();
      const roundId = crypto.randomBytes(6).toString('hex');
      const force = testHookOn() && buy === null && FORCES.includes(p.force) ? p.force : null;
      const r = force ? resolveForced(rng, force) : Eng.resolveRound(rng, buy);   // pure; nothing touched yet
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
        ...(force ? { forced: force } : {}),
      });
    },
  },
  _history: history,
};
