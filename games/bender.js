'use strict';
// Ballot Bender: server-authoritative slot. Math lives in bender-engine.js (same file the client copy uses).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Eng = require('./bender-engine.js');

// Live math: overrides saved on the data volume, loaded at boot, swappable at runtime (no deploy). See setLiveConfig.
// K2-Bcfg: a config is live only with a payback MEASUREMENT of its own numbers (games/bender-rtp.js measure: stratified seeded simulation, stated standard error) that is at or under the ceiling for the base
// game and for both bonus buys. The label players see is that measured value (or the shipped line while the numbers are the shipped ones), never text the admin typed.
const rtpTool = require('./bender-rtp.js');
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..');
const CFG_FILE = process.env.BENDER_CFG_FILE || path.join(DATA_DIR, 'bender-config.json');
const RTP_LABEL = '98% (long-run, 56M spin stratified sim, +-0.11; bonus about 1 in 100)';
let live = { overrides: {}, rtpLabel: null, note: '', updatedAt: null, measured: null };
// R2C-2: the payback check that is running (null when none). Any accepted swap (a reset included) cancels it, so a check that finishes later cannot land on top of a later admin action.
let checking = null;
const clone = (o) => JSON.parse(JSON.stringify(o));
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hashOf = (cfg) => crypto.createHash('sha256').update(JSON.stringify(cfg)).digest('hex');
// the full merged config for some overrides (validated by the engine first; same merge rule as the engine's own)
function mergeOver(over) {
  Eng.validateConfig(over || {}, { skipSmoke: true });          // R2C-4: ranges and shape only; the 300-round smoke test runs in the checking worker (or inside Eng.setConfig for a config nobody measured)
  const next = clone(Eng.DEFAULT_CFG);
  (function m(b, o) { for (const k of Object.keys(o)) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) m(b[k], o[k]); else b[k] = o[k]; } })(next, over || {});
  return next;
}
const isDefaultCfg = (next) => deepEq(next, Eng.DEFAULT_CFG);
function loadLiveConfig() {
  try {
    const j = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
    const over = j.overrides || {}, next = mergeOver(over), m = j.measured;
    // a saved file is trusted only if it is the shipped numbers or carries the passing measurement made for exactly these numbers
    if (!isDefaultCfg(next) && !(m && m.ok === true && m.hash === hashOf(next) && typeof m.label === 'string')) throw new Error('the saved config has no passing payback measurement; POST it again so the server can measure it');
    Eng.setConfig(over);
    live = { overrides: over, rtpLabel: null, note: j.note || '', updatedAt: j.updatedAt || null, measured: isDefaultCfg(next) ? null : m };
  } catch (e) { if (e.code !== 'ENOENT') console.error('[bender] live config not loaded, using defaults:', e.message); try { Eng.setConfig({}); } catch {} live = { overrides: {}, rtpLabel: null, note: '', updatedAt: null, measured: null }; }
}
// swap the live config. `measured` = the passing check for these numbers (made by setLiveConfigChecked; the proof must carry the hash of exactly these numbers). There is no way in without one: a rigged
// pay table cannot be set by calling this directly, only the shipped numbers (reset) need no proof.
function setLiveConfig({ overrides, rtpLabel, note, measured } = {}) {
  const over = overrides || {}, next = mergeOver(over), reset = isDefaultCfg(next), proven = !!(measured && measured.ok === true && measured.hash === hashOf(next));
  if (!reset && !proven) throw new Error('cfg: refused, no passing payback measurement for these numbers (use setLiveConfigChecked)');
  Eng.setConfig(over, { skipSmoke: reset || proven });   // throws on a bad config; nothing changes in that case. A measured or shipped config was smoke-tested in the worker / is the shipped one
  if (checking) { checking.cancelled = true; checking = null; }   // R2C-2: an accepted change supersedes the check in flight
  const rec = { overrides: over, rtpLabel: null, note: String(note || '').slice(0, 300), updatedAt: new Date().toISOString(), measured: !reset && proven ? measured : null };
  const tmp = CFG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ overrides: rec.overrides, note: rec.note, updatedAt: rec.updatedAt, ...(rec.measured ? { measured: rec.measured } : {}) }, null, 2)); fs.renameSync(tmp, CFG_FILE);
  live = rec;
  return liveInfo();
}
const auditFile = () => CFG_FILE + '.audit.log';
function audit(rec) {                              // one line per accepted or refused change: when, who, old and new measured payback
  const line = JSON.stringify({ t: new Date().toISOString(), game: 'bender', ...rec });
  console.log('[cfg-audit] ' + line);
  try { fs.appendFileSync(auditFile(), line + '\n'); } catch {}
}
const SUPERSEDED = 'another admin change (a reset or a new config) was accepted while this check ran; nothing was changed by this one';
const round2 = (x) => Math.round(x * 100) / 100;
const summaryOf = (r) => Object.fromEntries(Object.entries(r.ways).map(([w, x]) => [w, { pct: round2(x.pct), se: round2(x.se) }]));
// The admin path: validate, measure (async, in slices), refuse above the ceiling, then write + swap. `who` names the caller (token fingerprint + address). Every outcome is one audit line.
async function setLiveConfigChecked({ overrides, rtpLabel, note, who, scale, seed } = {}) {
  const over = overrides || {}, old = live.measured ? { pct: live.measured.summary.spin.pct, worst: live.measured.worst, source: 'measured when set' } : { pct: 98.0, source: isDefaultCfg(Eng.CFG) ? 'shipped label (56M-spin sim)' : 'unmeasured custom (pre-check file)' };
  const log = (rec) => audit({ who: who || 'unknown', note: String(note || '').slice(0, 120), old, ...rec });
  let next;
  try { next = mergeOver(over); } catch (e) { log({ outcome: 'refused', why: String(e.message).slice(0, 200), new: null }); throw e; }
  if (isDefaultCfg(next)) { try { const info = setLiveConfig({ overrides: over, note }); log({ outcome: 'accepted', new: { pct: 98.0, source: 'shipped' } }); return info; } catch (e) { log({ outcome: 'refused', why: String(e.message).slice(0, 200), new: null }); throw e; } }
  if (checking) { const e = new Error('cfg: another payback check is running, try again when it has finished'); log({ outcome: 'refused', why: e.message, new: null }); throw e; }
  const token = checking = { cancelled: false };
  let m;
  try { m = await rtpTool.measureInWorker(next, { scale, seed, cancelled: () => token.cancelled }); } catch (e) { if (checking === token) checking = null; const why = token.cancelled ? SUPERSEDED : 'check failed: ' + String(e.message).slice(0, 200); log({ outcome: 'refused', why, new: null }); throw token.cancelled ? new Error('cfg: refused, ' + why) : e; }
  if (checking === token) checking = null;
  if (token.cancelled) { log({ outcome: 'refused', why: SUPERSEDED, new: null }); throw new Error('cfg: refused, ' + SUPERSEDED); }
  const summary = summaryOf(m), nw = { worst: { way: m.worst.way, pct: round2(m.worst.pct), se: round2(m.worst.se) }, spin: summary.spin, ways: summary, ms: m.ms, maxStretchMs: round2(m.maxStretchMs), seed: m.seed };
  if (!m.ok) {
    const b = m.bound, why = !m.finite ? 'the payback could not be measured (not a finite number: the symbol weights or pay table are degenerate)' : 'the ' + b.way + ' way is not shown to be at or under the ' + rtpTool.CEILING_PCT + '% ceiling: measured ' + round2(b.pct) + '% with a standard error of ' + round2(b.se) + ' points, so its upper bound (measured + ' + rtpTool.BOUND_SE + ' standard errors) is ' + round2(b.upper) + '%, above the ' + rtpTool.CEILING_PCT + '% ceiling';
    log({ outcome: 'refused', why, new: nw }); throw new Error('cfg: refused, ' + why + (m.early ? ' (stopped early)' : ''));
  }
  const measured = { hash: hashOf(next), ok: true, ceilingPct: rtpTool.CEILING_PCT, label: round2(m.ways.spin.pct).toFixed(1) + '% (measured by the server when this was set: base game, +-' + round2(1.96 * m.ways.spin.se).toFixed(1) + '; highest way ' + m.worst.way + ' ' + round2(m.worst.pct).toFixed(1) + '%)', summary, worst: nw.worst, seed: m.seed, at: new Date().toISOString() };
  try { const info = setLiveConfig({ overrides: over, note, measured }); log({ outcome: 'accepted', new: nw }); return info; } catch (e) { log({ outcome: 'refused', why: String(e.message).slice(0, 200), new: nw }); throw e; }
}
const rtpLabel = () => (isDefaultCfg(Eng.CFG) ? RTP_LABEL : live.measured && live.measured.hash === hashOf(Eng.CFG) ? live.measured.label : 'custom settings, not measured');
function clientCfg() { const c = Eng.currentConfig(); return { weights: c.weights, pay: c.pay, scatterPay: c.scatterPay, spinsFor: c.spinsFor, retrigger: c.retrigger, buyCost: c.buyCost }; }
function liveInfo() { return { file: CFG_FILE, rtpLabel: rtpLabel(), note: live.note, updatedAt: live.updatedAt, measured: live.measured, overrides: live.overrides, cfg: Eng.currentConfig() }; }

const BET_LEVELS = Eng.BET_LEVELS;
const RATE_MS = 150;
const HISTORY_MAX = 20;

function cryptoRng() {
  return () => crypto.randomBytes(6).readUIntBE(0, 6) / 281474976710656; // 48-bit uniform in [0,1)
}

const history = new Map(); // account key -> last rounds (memory only)
const keyOf = (socket) => { const a = socket.data && socket.data.acct; return String(a && typeof a === 'object' ? a.key : a || ''); };

function err(socket, code, message) { socket.emit('error', { message, code, game: 'bender' }); }
// the player's two balances as the wallet push carries them (ctx.money.balance: what can be spent now)
const balances = (ctx, key) => ({ play: ctx.money.balance(key, 'play'), chips: ctx.money.balance(key, 'chips') });

function walletErr(socket, e, mode) {
  if (e && e.code === 'funds') return err(socket, 'funds', mode === 'chips' ? 'Not enough chips' : 'Not enough Cash');
  return err(socket, 'bad_request', 'Could not place that bet');
}

module.exports = {
  id: 'bender',
  name: 'Ballot Bender',
  kind: 'solo',
  betLevels: BET_LEVELS,
  RTP_LABEL,
  init(ctx) { this.rng = ctx.rng || cryptoRng(); loadLiveConfig(); },
  setLiveConfig, setLiveConfigChecked, liveInfo, clientCfg, loadLiveConfig,
  onDisconnect(socket) { if (socket.data) delete socket.data.benderLast; },
  handlers: {
    state(socket, payload, ctx) {
      socket.emit('g:bender:state', {
        betLevels: BET_LEVELS, modes: ['play', 'chips'], rtp: rtpLabel(), cfg: clientCfg(),
        buyCostX: { election: Eng.CFG.buyCost.election, landslide: Eng.CFG.buyCost.landslide },
        wallet: balances(ctx, keyOf(socket)), balances: balances(ctx, keyOf(socket)), bets: BET_LEVELS,
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
      if (p.mode !== 'play' && p.mode !== 'chips') return err(socket, 'bad_mode', 'Pick Cash or Chips');
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
      // A round that costs nothing is not a round (the wallet refused an amount of 0 before the one-call path): refuse it before any write, nothing is told but the error.
      if (!(cost > 0)) return err(socket, 'bad_request', 'Could not place that bet');
      // Ledger first (ADD-A-GAME.md rule 4): a money error is an error to the client, never a result. The whole round is ONE ledger write
      // (ctx.money.round, ref bender:<key>:<roundId>), so the ledger holds all of it or none of it.
      try { ctx.money.round(key, p.mode, roundId, { cost, win: totalWin }); } catch (e) { return walletErr(socket, e, p.mode); }
      let w = null;
      try { w = balances(ctx, key); } catch { /* the round is in the ledger; the wallet push carries the balances */ }

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
  // an instant game never holds an escrow: nothing to recover, nothing to report (ADD-A-GAME.md section 6.5)
  audit() { return { openRounds: [], pools: {} }; },
  _history: history,
};
