'use strict';
// Per-account wallet: Play $ (fake) and Ledger $ (friendly IOU tally). Integer cents only. Own atomic file.
const fs = require('fs');
const path = require('path');

const START_PLAY = 1000000;      // 10,000.00
const TOPUP_BELOW = 10000;       // refill allowed only when play < 100.00
const TOPUP_COOLDOWN_MS = 3600000;
const DEFAULT_LIMIT = -50000;    // -500.00
const MODES = ['play', 'ledger'];

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
    if (!w) { w = data[k] = { play: START_PLAY, ledgerNet: 0, ledgerLimit: DEFAULT_LIMIT, lastTopUp: null, byGame: {} }; save(); }
    return w;
  }
  const view = (w) => ({ play: w.play, ledgerNet: w.ledgerNet, ledgerLimit: w.ledgerLimit });

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
    const w = rec(acct);
    if (mode === 'play') {
      if (w.play < amount) throw fail('funds', 'Not enough Play $');
      w.play -= amount;
    } else {
      if (w.ledgerNet - amount < w.ledgerLimit) throw fail('limit', 'Ledger limit reached');
      w.ledgerNet -= amount;
    }
    if (ref && ref.game) { const s = stat(w, ref.game, mode); s.rounds += 1; s.wagered += amount; }
    save();
    logRow(acct, mode, -amount, mode === 'play' ? w.play : w.ledgerNet, ref);
    if (onChange) try { onChange(keyOf(acct), view(w)); } catch {}
    return view(w);
  }

  function credit(acct, mode, amount, ref) {
    checkArgs(mode, amount);
    const w = rec(acct);
    if (amount === 0) return view(w);
    if (mode === 'play') w.play += amount; else w.ledgerNet += amount;
    if (ref && ref.game) stat(w, ref.game, mode).won += amount;
    save();
    logRow(acct, mode, amount, mode === 'play' ? w.play : w.ledgerNet, ref);
    if (onChange) try { onChange(keyOf(acct), view(w)); } catch {}
    return view(w);
  }

  function get(acct) { return view(rec(acct)); }

  function stats(acct) { return JSON.parse(JSON.stringify(rec(acct).byGame)); }

  function setLimit(acct, cents) {
    if (!isCents(cents) || cents > 0) throw fail('amount', 'Bad limit');
    const w = rec(acct); w.ledgerLimit = cents; save(); return view(w);
  }

  function topUp(acct) {
    const w = rec(acct);
    if (w.play >= TOPUP_BELOW) throw fail('not_needed', 'Top up is only for balances under 100');
    const wait = w.lastTopUp == null ? 0 : w.lastTopUp + TOPUP_COOLDOWN_MS - now();
    if (wait > 0) { const e = fail('cooldown', 'Top up again later'); e.retryMs = wait; throw e; }
    w.play = START_PLAY; w.lastTopUp = now();
    save();
    if (onChange) try { onChange(keyOf(acct), view(w)); } catch {}
    return view(w);
  }

  return { spend, credit, get, stats, setLimit, topUp, flush, file, START_PLAY, DEFAULT_LIMIT };
}

module.exports = { createWallet, START_PLAY, DEFAULT_LIMIT, TOPUP_BELOW, TOPUP_COOLDOWN_MS };
