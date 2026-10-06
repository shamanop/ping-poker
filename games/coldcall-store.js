'use strict';
// COLD CALL, THE PULL: persisted state. One JSON file next to the wallet (atomic temp+rename, debounced 50 ms, flushed on exit, like wallet.js).
//   { v: 1, players: { <key>: { play: state, chips: state } }, pot: { play: pot, chips: pot }, open: { "<key>|<mode>": record } }
// pot = { bal, fed, seeded, paid, rem, last: { who, amount, at } | null } in cents. Invariant: fed + seeded = paid + bal.
// An `open` record is the minimum needed to refund a round whose decision was still open at a restart: { roundId, key, mode, cost, bet, buy, t }.
const fs = require('fs');

const MODES = ['play', 'chips'];
const flushers = new Set();
process.on('exit', () => { for (const f of flushers) f(); });

const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
const emptyData = () => ({ v: 1, players: {}, pot: {}, open: {} });

function createStore(file) {
  let data = emptyData();
  if (file) {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (isObj(j)) {
        data = { v: 1, players: isObj(j.players) ? j.players : {}, pot: isObj(j.pot) ? j.pot : {}, open: isObj(j.open) ? j.open : {} };
      }
    } catch { data = emptyData(); }
  }

  let timer = null, dirty = false;
  function writeNow() {
    dirty = false;
    if (!file) return;
    try {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file);
    } catch {}
  }
  function save() { dirty = true; if (!timer) { timer = setTimeout(() => { timer = null; writeNow(); }, 50); if (timer.unref) timer.unref(); } }
  function flush() { if (timer) { clearTimeout(timer); timer = null; } if (dirty) writeNow(); }
  function close() { flush(); flushers.delete(flush); }
  flushers.add(flush);

  const checkMode = (mode) => { if (!MODES.includes(mode)) throw new Error('bad mode'); };
  const openKey = (key, mode) => key + '|' + mode;

  return {
    file, save, flush, close,
    // player state (a stored object or null; callers clone before handing it to the engine)
    player(key, mode) { checkMode(mode); const p = data.players[key]; return (p && p[mode]) || null; },
    setPlayer(key, mode, state) { checkMode(mode); (data.players[key] = data.players[key] || {})[mode] = state; save(); },
    // the pot of a currency; created on first use holding `seed` cents of tracked house money
    pot(mode, seed) {
      checkMode(mode);
      let p = data.pot[mode];
      if (!p) {
        const s = Number.isSafeInteger(seed) && seed > 0 ? seed : 0;
        p = data.pot[mode] = { bal: s, fed: 0, seeded: s, paid: 0, rem: 0, last: null };
        save();
      }
      return p;
    },
    potChanged: save,
    // open decisions
    putOpen(rec) { checkMode(rec.mode); data.open[openKey(rec.key, rec.mode)] = rec; save(); },
    delOpen(key, mode) { const had = delete data.open[openKey(key, mode)]; save(); return had; },
    allOpen() { return Object.values(data.open); },
    _data: () => data,
  };
}

module.exports = { createStore, MODES };
