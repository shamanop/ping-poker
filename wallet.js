'use strict';
// Per-account wallet: Play $ (fake, integer cents, own atomic file) and Chips (the poker bank, reached through opts.chips).
const fs = require('fs');
const path = require('path');

const START_PLAY = 1000000;      // 10,000.00
const TOPUP_BELOW = 10000;       // refill allowed only when play < 100.00
const TOPUP_COOLDOWN_MS = 3600000;
const MODES = ['play', 'chips'];

function fail(code, message) { const e = new Error(message || code); e.code = code; return e; }
const isCents = (n) => typeof n === 'number' && Number.isSafeInteger(n);

const flushers = new Set();
process.on('exit', () => { for (const f of flushers) f(); });

function createWallet(opts = {}) {
  const file = opts.file || process.env.WALLET_FILE || path.join(__dirname, 'wallet.json');
  const ledger = opts.ledger || null;
  const now = opts.now || Date.now;
  const logPlay = !!opts.logPlay;
  const onChange = opts.onChange || null;
  const chips = opts.chips || null; // { get(key), add(key, delta) } over the bank
  let data = {};
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && typeof j === 'object') data = j; } catch { data = {}; }

  let timer = null, dirty = false;
  function writeNow() {
    dirty = false;
    try {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, file);
    } catch {}
  }
  function save() { dirty = true; if (!timer) { timer = setTimeout(() => { timer = null; writeNow(); }, 50); if (timer.unref) timer.unref(); } }
  function flush() { if (timer) { clearTimeout(timer); timer = null; } if (dirty) writeNow(); }
  flushers.add(flush);

  const keyOf = (a) => String(a && typeof a === 'object' ? a.key : a || '').toLowerCase().trim();

  function rec(acct) {
    const k = keyOf(acct);
    if (!k) throw fail('acct', 'No account');
    let w = data[k];
    if (!w) { w = data[k] = { play: START_PLAY, lastTopUp: null, byGame: {} }; save(); }
    return w;
  }
  const view = (w, k) => ({ play: w.play, chips: chips && k ? chips.get(k) : null });

  function stat(w, game, mode) {
    const g = (w.byGame[game] = w.byGame[game] || {});
    return (g[mode] = g[mode] || { rounds: 0, wagered: 0, won: 0 });
  }

  function logRow(acct, mode, amount, balanceAfter, ref) {
    if (!ledger || typeof ledger.log !== 'function') return;
    if (mode === 'play' && !logPlay) return;
    try {
      ledger.log('game', keyOf(acct), amount, balanceAfter, 0, ref && ref.round != null ? ref.round : null,
        'game:' + ((ref && ref.game) || 'unknown'), { game: ref && ref.game, mode, round: ref && ref.round });
    } catch {}
  }

  function checkArgs(mode, amount) {
    if (!MODES.includes(mode)) throw fail('mode', 'Bad money mode');
    if (!isCents(amount) || amount < 0) throw fail('amount', 'Bad amount');
  }

  // Synchronous end to end: no await between the check and the write, so concurrent callers cannot interleave.
  function spend(acct, mode, amount, ref) {
    checkArgs(mode, amount);
    if (amount === 0) throw fail('amount', 'Bad amount');
    const k = keyOf(acct);
    const w = rec(acct);
    if (mode === 'play') {
      if (w.play < amount) throw fail('funds', 'Not enough Play $');
      w.play -= amount;
    } else {
      if (!chips) throw fail('mode', 'Chips unavailable');
      if (chips.get(k) < amount) throw fail('funds', 'Not enough chips');
      chips.add(k, -amount);
    }
    if (ref && ref.game) { const st = stat(w, ref.game, mode); st.rounds += 1; st.wagered += amount; }
    save();
    if (mode === 'play') logRow(acct, mode, -amount, w.play, ref);
    if (onChange) try { onChange(k, view(w, k)); } catch {}
    return view(w, k);
  }

  function credit(acct, mode, amount, ref) {
    checkArgs(mode, amount);
    const k = keyOf(acct);
    const w = rec(acct);
    if (amount === 0) return view(w, k);
    if (mode === 'play') w.play += amount;
    else { if (!chips) throw fail('mode', 'Chips unavailable'); chips.add(k, amount); }
    if (ref && ref.game) stat(w, ref.game, mode).won += amount;
    save();
    if (mode === 'play') logRow(acct, mode, amount, w.play, ref);
    if (onChange) try { onChange(k, view(w, k)); } catch {}
    return view(w, k);
  }

  function get(acct) { const k = keyOf(acct); return view(rec(acct), k); }

  function stats(acct) { return JSON.parse(JSON.stringify(rec(acct).byGame)); }

  function adminSet(acct, cents) {
    if (!isCents(cents) || cents < 0) throw fail('amount', 'Bad amount');
    const k = keyOf(acct);
    const w = rec(acct); w.play = cents; save();
    if (onChange) try { onChange(k, view(w, k)); } catch {}
    return view(w, k);
  }

  function topUp(acct) {
    const k = keyOf(acct);
    const w = rec(acct);
    if (w.play >= TOPUP_BELOW) throw fail('not_needed', 'Top up is only for balances under 100');
    const wait = w.lastTopUp == null ? 0 : w.lastTopUp + TOPUP_COOLDOWN_MS - now();
    if (wait > 0) { const e = fail('cooldown', 'Top up again later'); e.retryMs = wait; throw e; }
    w.play = START_PLAY; w.lastTopUp = now();
    save();
    if (onChange) try { onChange(k, view(w, k)); } catch {}
    return view(w, k);
  }

  return { spend, credit, get, stats, topUp, adminSet, flush, file, START_PLAY };
}

module.exports = { createWallet, START_PLAY, TOPUP_BELOW, TOPUP_COOLDOWN_MS };
