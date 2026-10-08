'use strict';
// ctx.wallet for games/index.js, games/bender.js and social.js, over the money service (contract section 7 + 12a Q5 revised).
// The games call spend(key, mode, cost, {game, round}) then credit(key, mode, win, {game, round}) in one synchronous handler and stay
// unchanged. spend() only CHECKS the balance and parks the cost under <game>:<key>:<round>; credit() with the same ref pops it and writes
// ONE houseRound batch, so a crash between the two can never take a stake and lose the win. A parked cost with no credit by the end of
// the tick is flushed as houseRound(cost, 0). Non-round credits (game 'achv' / 'bonus') are mints.


const GAMES = new Set(['bender', 'coldcall']);
const keyOf = a => String(a && typeof a === 'object' ? a.key : a || '').toLowerCase().trim();
const isInt = v => Number.isSafeInteger(v);
const curOf = mode => (mode === 'chips' ? 'chips' : 'play');

function fail(code, message, extra) { const e = new Error(message); e.code = code; if (extra) Object.assign(e, extra); return e; }

// MoneyError -> the codes the games rely on (bender.js walletErr): insufficient -> funds, bad_amount -> amount, anything else -> internal.
function mapMoneyError(e) {
  if (e && e.name === 'MoneyError') {
    if (e.code === 'insufficient') return fail('funds', 'Not enough funds');
    if (e.code === 'bad_amount') return fail('amount', 'Bad amount');
    return fail('internal', 'Server error');
  }
  return e;
}

function createWalletAdapter({ service, ledger, onChange, schedule, log }) {
  const parked = new Map();            // ref string -> { key, mode, cur, game, cost }
  const flushed = new Set();           // refs already flushed as spend-only (a late credit for one is refused, never double-paid)
  let counter = 0, opSeq = 0;
  const bootTag = Date.now().toString(36);
  const defer = schedule || (fn => queueMicrotask(fn));
  const note = key => { if (onChange) { try { onChange(key); } catch (e) { (log || console.error)('[v2] wallet onChange failed:', e && e.message); } } };

  const balance = (key, cur) => ledger.balance((cur === 'chips' ? 'bank:' : 'play:') + key, cur);
  function heldBy(key, cur) { let n = 0; for (const p of parked.values()) if (p.key === key && p.cur === cur) n += p.cost; return n; }
  const view = key => ({ play: balance(key, 'play') - heldBy(key, 'play'), chips: balance(key, 'chips') - heldBy(key, 'chips') });

  function checkArgs(mode, amount) {
    if (mode !== 'play' && mode !== 'chips') throw fail('mode', 'Bad money mode');
    if (!isInt(amount) || amount < 0) throw fail('amount', 'Bad amount');
  }
  const refOf = (game, key, round) => `${game}:${key}:${round != null ? round : `${bootTag}.${++counter}`}`;

  function flushParked(refStr) {
    const p = parked.get(refStr);
    if (!p) return;
    parked.delete(refStr);
    try { service.houseRound(p.game, p.key, p.cost, 0, p.cur, refStr); flushed.add(refStr); if (flushed.size > 2000) flushed.delete(flushed.values().next().value); note(p.key); }
    catch (e) { (log || console.error)('[v2] wallet flush failed', refStr, e && e.code); }
  }

  function spend(acct, mode, amount, ref) {
    checkArgs(mode, amount);
    if (amount === 0) throw fail('amount', 'Bad amount');
    const key = keyOf(acct), cur = curOf(mode), game = ref && ref.game;
    if (!key) throw fail('acct', 'No account');
    if (!GAMES.has(game)) throw fail('mode', 'Bad game');
    if (view(key)[cur] < amount) throw fail('funds', cur === 'chips' ? 'Not enough chips' : 'Not enough Cash');
    const refStr = refOf(game, key, ref.round);
    if (parked.has(refStr) || flushed.has(refStr)) throw fail('internal', 'Server error');
    parked.set(refStr, { key, mode, cur, game, cost: amount });
    defer(() => flushParked(refStr));
    return view(key);
  }

  function credit(acct, mode, amount, ref) {
    checkArgs(mode, amount);
    const key = keyOf(acct), cur = curOf(mode), game = ref && ref.game;
    if (!key) throw fail('acct', 'No account');
    try {
      if (game === 'achv' || game === 'bonus') {
        if (amount > 0) { service.mint(game, key, amount, 'chips', `${game}:${key}:${ref.round != null ? ref.round : `${bootTag}.${++opSeq}`}`); note(key); }
        return view(key);
      }
      if (!GAMES.has(game)) throw fail('mode', 'Bad game');
      const refStr = refOf(game, key, ref.round);
      if (flushed.has(refStr)) throw fail('internal', 'Server error');
      const p = parked.get(refStr);
      if (p && (p.mode !== mode)) throw fail('mode', 'Bad money mode');
      if (!p && amount === 0) return view(key);
      parked.delete(refStr);
      try { service.houseRound(game, key, p ? p.cost : 0, amount, cur, refStr); }
      catch (e) { if (p) parked.set(refStr, p); throw e; }       // a failed credit leaves the stake parked: the tick flush still settles it as a loss
      note(key);
      return view(key);
    } catch (e) { throw mapMoneyError(e); }
  }

  function get(acct) { const key = keyOf(acct); if (!key) throw fail('acct', 'No account'); return view(key); }

  function topUp(acct) {
    const key = keyOf(acct);
    try { const r = service.topUp(key, `topup:${key}:${bootTag}.${++opSeq}`); note(key); return { ...view(key), dup: !!r.dup }; }
    catch (e) {
      if (e && e.name === 'MoneyError' && e.code === 'disabled') throw fail('disabled', 'Cash is set by the admin: no top up');
      if (e && e.name === 'MoneyError' && (e.code === 'not_needed' || e.code === 'cooldown')) throw fail(e.code, e.code === 'cooldown' ? 'Top up is on cooldown' : 'You do not need a top up', { retryMs: e.retryMs || (e.details && e.details.retryMs) || 0 });
      throw mapMoneyError(e);
    }
  }

  // Nothing in the tree reads these after wallet.js is retired (contract section 7): stats is derived on demand, adminSet is the admin_adjust path.
  const stats = () => ({});
  const adminSet = () => { throw fail('internal', 'Use admin adjust'); };
  const flush = () => { for (const r of [...parked.keys()]) flushParked(r); };

  return { spend, credit, get, stats, topUp, adminSet, flush, flushNow: flush, START_PLAY: service.START_PLAY, pendingCount: () => parked.size, view };
}

module.exports = { createWalletAdapter, mapMoneyError, GAMES };
