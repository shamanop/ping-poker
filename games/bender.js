'use strict';
// Ballot Bender: server-authoritative slot. Math lives in bender-engine.js (same file the client copy uses).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Eng = require('./bender-engine.js');

// Live math: overrides saved on the data volume, loaded at boot, swappable at runtime (no deploy). See setLiveConfig.
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..');
const CFG_FILE = process.env.BENDER_CFG_FILE || path.join(DATA_DIR, 'bender-config.json');
let live = { overrides: {}, rtpLabel: null, note: '', updatedAt: null };
function loadLiveConfig() {
  try {
    const j = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
    Eng.setConfig(j.overrides || {});
    live = { overrides: j.overrides || {}, rtpLabel: j.rtpLabel || null, note: j.note || '', updatedAt: j.updatedAt || null };
  } catch (e) { if (e.code !== 'ENOENT') console.error('[bender] live config not loaded, using defaults:', e.message); }
}
function setLiveConfig({ overrides, rtpLabel, note } = {}) {
  Eng.setConfig(overrides || {});                  // throws on a bad config; nothing changes in that case
  live = { overrides: overrides || {}, rtpLabel: typeof rtpLabel === 'string' && rtpLabel ? rtpLabel.slice(0, 160) : null, note: String(note || '').slice(0, 300), updatedAt: new Date().toISOString() };
  const tmp = CFG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(live, null, 2)); fs.renameSync(tmp, CFG_FILE);
  return liveInfo();
}
const rtpLabel = () => live.rtpLabel || RTP_LABEL;
function clientCfg() { const c = Eng.currentConfig(); return { weights: c.weights, pay: c.pay, scatterPay: c.scatterPay, spinsFor: c.spinsFor, retrigger: c.retrigger, buyCost: c.buyCost }; }
function liveInfo() { return { file: CFG_FILE, rtpLabel: rtpLabel(), note: live.note, updatedAt: live.updatedAt, overrides: live.overrides, cfg: Eng.currentConfig() }; }

const BET_LEVELS = Eng.BET_LEVELS;
const RATE_MS = 150;
const HISTORY_MAX = 20;
const RTP_LABEL = '98% (long-run, 56M spin stratified sim, +-0.11; bonus about 1 in 100)';

function cryptoRng() {
  return () => crypto.randomBytes(6).readUIntBE(0, 6) / 281474976710656; // 48-bit uniform in [0,1)
}

const history = new Map(); // account key -> last rounds (memory only)
const keyOf = (socket) => { const a = socket.data && socket.data.acct; return String(a && typeof a === 'object' ? a.key : a || ''); };

function err(socket, code, message) { socket.emit('error', { message, code, game: 'bender' }); }

function walletErr(socket, e) {
  if (e && e.code === 'funds') return err(socket, 'funds', e.message);
  return err(socket, 'bad_request', 'Could not place that bet');
}

module.exports = {
  id: 'bender',
  name: 'Ballot Bender',
  kind: 'solo',
  betLevels: BET_LEVELS,
  RTP_LABEL,
  init(ctx) { this.rng = ctx.rng || cryptoRng(); loadLiveConfig(); },
  setLiveConfig, liveInfo, clientCfg, loadLiveConfig,
  onDisconnect(socket) { if (socket.data) delete socket.data.benderLast; },
  handlers: {
    state(socket, payload, ctx) {
      socket.emit('g:bender:state', {
        betLevels: BET_LEVELS, modes: ['play', 'chips'], rtp: rtpLabel(), cfg: clientCfg(),
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
      if (p.mode !== 'play' && p.mode !== 'chips') return err(socket, 'bad_mode', 'Pick Play $ or Chips');
      const buy = p.buyBonus == null || p.buyBonus === false ? null : p.buyBonus;
      if (buy !== null && buy !== 'election' && buy !== 'landslide') return err(socket, 'bad_request', 'Bad bonus');

      const key = keyOf(socket);
      const rng = module.exports.rng || cryptoRng();
      const roundId = crypto.randomBytes(6).toString('hex');
      const r = Eng.resolveRound(rng, buy);                // pure; nothing touched yet
      const cost = Math.round(r.costMult * p.bet);
      // unbiased rounding to whole cents: plain Math.round cost ~1.5 RTP points at a 1c bet (sub-cent wins vanished).
      // Floor + random extra cent with probability = the fraction keeps the long-run return exact at every bet size.
      const exact = r.totalWinMult * p.bet, floor = Math.floor(exact + 1e-9);
      const totalWin = floor + (exact - floor > 1e-9 && rng() < exact - floor ? 1 : 0);
      const ref = { game: 'bender', round: roundId };
      let w;
      try { ctx.wallet.spend(key, p.mode, cost, ref); } catch (e) { return walletErr(socket, e); }
      try { w = ctx.wallet.credit(key, p.mode, totalWin, ref); } catch (e) { w = ctx.wallet.get(key); }

      const h = history.get(key) || [];
      h.unshift({ roundId, t: t, bet: p.bet, cost, mode: p.mode, buy, totalWin, tier: r.tier });
      if (h.length > HISTORY_MAX) h.length = HISTORY_MAX;
      history.set(key, h);

      try { if (ctx.social) ctx.social.onSpin(socket, { bet: p.bet, totalWin, tier: r.tier, mode: p.mode, feature: r.bonus ? 'free spins' : null, bonusKind: r.bonus ? r.bonus.kind : null }); } catch {}
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
