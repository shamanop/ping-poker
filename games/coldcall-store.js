'use strict';
// COLD CALL, THE PULL: the game's own file (state, not money). One JSON file next to money.jsonl (atomic temp+rename, debounced 50 ms, flushed on exit).
//   { v: 1, players: { <key>: { play: state, chips: state } }, pot: { play: pot, chips: pot }, open: { "<key>|<mode>": record } }
// pot = { bal, fed, paid, rem, last: { who, amount, at } | null } in cents. P6: the office pot is the ledger account pool:coldcall:office; `bal` here is only a mirror of it (audit() reads it,
// no decision does), `fed` / `paid` are running statistics, `rem` (the sub-cent remainder, 1/10,000 of a cent) and `last` are game state. A `seeded` field of an old file is dropped.
// An `open` record holds everything needed to finish the round after a restart (see games/coldcall.js openRecord): ids, key, mode, cost, bet, buy, clock, the pre-round state, the tapes,
// the decisions, and the whole config snapshot the round runs on.
// flush() throws when the write failed (the caller decides what a failed write means: the money flows depend on it). A debounced write that fails keeps the data dirty and tries again.
const fs = require('fs');

const MODES = ['play', 'chips'];
const flushers = new Set();
process.on('exit', () => { for (const f of flushers) { try { f(); } catch {} } });

const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
// maps keyed by account name or "<name>|<mode>" have NO prototype: a key like __proto__ or constructor is a plain entry, never Object.prototype
const dict = (src) => { const m = Object.create(null); if (isObj(src)) for (const k of Object.keys(src)) m[k] = src[k]; return m; };
// a stored pot is four safe non-negative integers and a `last` that is null or { who, amount, at }; anything else is a fresh pot (W1B N5: one bad entry must not take the cost of every spin)
const POT_INTS = ['bal', 'fed', 'paid', 'rem'];
const validPot = (p) => isObj(p) && POT_INTS.every((k) => Number.isSafeInteger(p[k]) && p[k] >= 0) && (p.last === null || (isObj(p.last) && typeof p.last.who === 'string' && Number.isSafeInteger(p.last.amount) && Number.isFinite(p.last.at)));
const emptyData = () => ({ v: 1, players: dict(), pot: dict(), open: dict() });
const RETRY_MS = 1000;

function createStore(file, opts = {}) {
  const say = opts.log || (() => {});
  let data = emptyData();
  if (file) {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (isObj(j)) {
        data = { v: 1, players: dict(j.players), pot: dict(j.pot), open: dict(j.open) };
        for (const k of Object.keys(data.players)) if (!isObj(data.players[k])) delete data.players[k];   // an account entry is an object of per-currency states, or it is gone
        for (const k of Object.keys(data.pot)) {
          if (!MODES.includes(k) || !validPot({ ...data.pot[k], seeded: undefined })) { delete data.pot[k]; continue; }   // recreated fresh on first use
          if (isObj(data.pot[k]) && 'seeded' in data.pot[k]) { if (data.pot[k].seeded > 0) say('coldcall: ignoring a stored pot seed of', data.pot[k].seeded, k); delete data.pot[k].seeded; }
        }
      }
    } catch { data = emptyData(); }
  }

  let timer = null, dirty = false;
  function writeNow() {                       // throws when the disk refuses; `dirty` stays set then
    if (!file) { dirty = false; return; }
    const tmp = file + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file);
    } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch {} throw e; }
    dirty = false;
  }
  function arm(ms) { if (!timer) { timer = setTimeout(() => { timer = null; try { writeNow(); } catch (e) { say('coldcall: store write failed, will retry:', e && e.message); arm(RETRY_MS); } }, ms); if (timer.unref) timer.unref(); } }
  function save() { dirty = true; arm(50); }
  function flush() { if (timer) { clearTimeout(timer); timer = null; } if (dirty) { try { writeNow(); } catch (e) { arm(RETRY_MS); throw e; } } return true; }
  // close(true) abandons what was not written (a test's "crash"); a plain close writes it
  function close(discard) { if (discard) dirty = false; else { try { flush(); } catch {} } flushers.delete(flush); if (timer) { clearTimeout(timer); timer = null; } }
  flushers.add(flush);

  const checkMode = (mode) => { if (!MODES.includes(mode)) throw new Error('bad mode'); };
  const openKey = (key, mode) => key + '|' + mode;

  return {
    file, save, flush, close,
    // player state (a stored object or null; callers clone before handing it to the engine)
    player(key, mode) { checkMode(mode); const p = data.players[key]; return (p && p[mode]) || null; },
    setPlayer(key, mode, state) { checkMode(mode); (data.players[key] = data.players[key] || dict())[mode] = state; save(); },
    // the pot record of a currency (mirror + statistics + remainder); created empty on first use. The pot's MONEY is the ledger's pool account.
    pot(mode) {
      checkMode(mode);
      let p = data.pot[mode];
      if (!validPot(p)) { p = data.pot[mode] = { bal: 0, fed: 0, paid: 0, rem: 0, last: null }; save(); }
      return p;
    },
    // the pot record if there is one (never creates it): a game that never ran a pot leaves no pot in its file
    peekPot(mode) { checkMode(mode); const p = data.pot[mode]; return validPot(p) ? p : null; },
    potChanged: save,
    // open rounds (a decision pending, or a Callback in flight)
    putOpen(rec) { checkMode(rec.mode); data.open[openKey(rec.key, rec.mode)] = rec; save(); },
    delOpen(key, mode) { const had = delete data.open[openKey(key, mode)]; save(); return had; },
    getOpen(key, mode) { return data.open[openKey(key, mode)] || null; },
    allOpen() { return Object.values(data.open); },
    _data: () => data,
  };
}

module.exports = { createStore, MODES };
