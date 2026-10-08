// FROZEN pre-D2 service (git show a10735a:money/service.js), kept only so tests/v2-unit/money-d2-callsites.js can compare the D2 service against it. Loaded through a stub require ('./ledger' -> ledger-pre-d2.js). Do not edit.
'use strict';
// money/service.js: the named money operations the table layer calls. Every operation is one ledger
// transfer() or batch() with a caller-supplied ref, so a retry after a crash is a no-op (dup) and a
// retry with different numbers throws ref_conflict. See V2-DESIGN.md "money/".
const { MoneyError } = require('./ledger');

const START_CHIPS = 10000;        // today's lazy bank default (server.js BANK_DEFAULT)
const START_PLAY = 1000000;       // today's wallet default, 10,000.00 in cents (wallet.js START_PLAY)
const TOPUP_BELOW = 10000;        // wallet.js: top-up only when Cash is under 100.00
const TOPUP_COOLDOWN_MS = 3600000;
const CURS = ['chips', 'play'];
const MINT_KINDS = ['bonus', 'achv', 'topup'];
const GAMES = ['bender', 'coldcall'];

const isInt = (n) => typeof n === 'number' && Number.isSafeInteger(n);
const store = (fund, key) => (fund === 'chips' ? 'bank:' : 'play:') + key;
const other = (cur) => (cur === 'chips' ? 'play' : 'chips');

function needStr(v, code, label) {
  if (typeof v !== 'string' || !v || v.includes(':')) throw new MoneyError(code, { [label || 'value']: v });
  return v;
}
const needCur = (cur) => { if (!CURS.includes(cur)) throw new MoneyError('bad_cur', { cur }); return cur; };
const needRef = (ref) => { if (typeof ref !== 'string' || !ref) throw new MoneyError('bad_ref', { ref }); return ref; };
// :open and :close belong to openRound / settleRound / voidRound only: an instant call that wrote one could burn a round's close ref and strand its escrow.
const needHouseRef = (ref) => { needRef(ref); if (ref.endsWith(':open') || ref.endsWith(':close')) throw new MoneyError('bad_ref', { ref, why: 'reserved suffix' }); return ref; };
// Funding source of a seat. Missing means "the table's own currency" (today's fundOf). 'bank' is an alias of 'chips'.
function needFund(fund, tableCur) {
  if (fund == null || fund === '') return tableCur;
  if (fund === 'bank') return 'chips';
  if (!CURS.includes(fund)) throw new MoneyError('bad_fund', { fund });
  return fund;
}

function createService(ledger, opts = {}) {
  const now = opts.now || Date.now;

  // ---- derived indexes, rebuilt incrementally from the ledger (never a second source of truth) ----
  const known = { chips: new Set(), play: new Set() };     // keys that have ever had a bank:/play: account
  const lastTopUp = new Map();                              // key -> ts of the last mint:topup
  let scanned = 0;
  function refresh() {
    for (const e of ledger.entries(null, scanned)) {
      for (const a of [e.from, e.to]) {
        if (a.startsWith('bank:')) known.chips.add(a.slice(5));
        else if (a.startsWith('play:')) known.play.add(a.slice(5));
      }
      if (e.reason === 'topup' && e.to.startsWith('play:')) lastTopUp.set(e.to.slice(5), e.ts);
      scanned = e.id;
    }
    scanned = Math.max(scanned, ledger.lastId);
  }

  const seatName = (tableId, key) => `seat:${tableId}:${key}`;

  // ---- funding and cash-out: fund === tableCur is one transfer, otherwise one batch through fx ----
  function moveIn(key, tableId, amount, tableCur, fund, ref) {
    needStr(key, 'bad_key', 'key'); needStr(tableId, 'bad_table', 'tableId'); needCur(tableCur); needRef(ref);
    fund = needFund(fund, tableCur);
    const seat = seatName(tableId, key), reason = 'buyin:' + fund;
    // One fund per seat while it holds chips (today's server.js rebuy rule); the fund may change only from a 0 stack.
    // A retry of a buy-in already in the ledger is allowed through so it answers dup, not fund_mismatch.
    if (!ledger.has(ref) && ledger.balance(seat, tableCur) > 0) {
      const have = seatFund(tableId, key, tableCur);
      if (have !== fund) throw new MoneyError('fund_mismatch', { have, want: fund });
    }
    if (fund === tableCur) return ledger.transfer(store(fund, key), seat, amount, tableCur, reason, ref);
    return ledger.batch([
      { from: store(fund, key), to: 'fx:' + fund, amount, cur: fund },
      { from: 'fx:' + tableCur, to: seat, amount, cur: tableCur },
    ], ref, reason);
  }

  function moveOut(seat, key, amount, tableCur, fund, ref, kind) {
    const reason = kind + ':' + fund;
    if (fund === tableCur) return ledger.transfer(seat, store(fund, key), amount, tableCur, reason, ref);
    return ledger.batch([
      { from: seat, to: 'fx:' + tableCur, amount, cur: tableCur },
      { from: 'fx:' + fund, to: store(fund, key), amount, cur: fund },
    ], ref, reason);
  }

  // ---- public operations ----

  // Signup mints once. Safe to call again: only a currency with no bank:/play: account yet is minted.
  function ensureAccount(key) {
    needStr(key, 'bad_key', 'key');
    refresh();
    const minted = { chips: 0, play: 0 };
    for (const cur of CURS) {
      if (known[cur].has(key)) continue;
      const amount = cur === 'chips' ? START_CHIPS : START_PLAY;
      ledger.transfer('mint:signup', store(cur, key), amount, cur, 'signup', `signup:${cur === 'chips' ? 'bank' : 'play'}:${key}`);
      known[cur].add(key); minted[cur] = amount;
    }
    refresh();
    return { created: minted.chips > 0 || minted.play > 0, minted };
  }

  function buyIn(key, tableId, amount, tableCur, fund, ref) { return moveIn(key, tableId, amount, tableCur, fund, ref); }

  // Cashes out `amount` (the stack) only. Whatever the seat has committed to the live hand stays in the seat
  // account until the hand batch moves it (N1). Amount 0 is a no-op (a busted seat leaving), not an error.
  // The seat's fund comes from the ledger (seatFund), not from the caller: a different fund throws fund_mismatch,
  // a missing one means the seat's own. A retry of a ref already written skips the check and answers dup/ref_conflict.
  function cashOut(key, tableId, amount, tableCur, fund, ref) {
    needStr(key, 'bad_key', 'key'); needStr(tableId, 'bad_table', 'tableId'); needCur(tableCur); needRef(ref);
    if (amount === 0) return { id: null, dup: false, noop: true };
    if (fund != null && fund !== '') fund = needFund(fund, tableCur);
    if (ledger.has(ref)) {
      if (fund == null || fund === '') { // infer the original fund from the entry the ref wrote (cashout:<fund>)
        for (const e of ledger.entries(x => x.ref === ref && x.reason.startsWith('cashout:'))) { fund = e.reason.slice(8); break; }
      }
    } else {
      const have = seatFund(tableId, key, tableCur);
      if (fund == null || fund === '') fund = have;
      else if (fund !== have) throw new MoneyError('fund_mismatch', { have, want: fund });
    }
    return moveOut(seatName(tableId, key), key, amount, tableCur, fund || tableCur, ref, 'cashout');
  }

  // One batch hand:<tableId>:<handNo>: each contributor seat -> pot, then pot -> seat for payouts and uncalled returns.
  // Must conserve: sum(committed) === sum(payouts) + sum(returned), else it throws and writes nothing.
  function settleHand(tableId, handNo, tableCur, s) {
    needStr(tableId, 'bad_table', 'tableId'); needCur(tableCur);
    if (!(isInt(handNo) && handNo >= 0) && !(typeof handNo === 'string' && handNo && !handNo.includes(':'))) throw new MoneyError('bad_hand', { handNo });
    const sums = {};
    const norm = (m, label) => {
      const out = new Map();
      for (const k of Object.keys(m || {}).sort()) {
        const v = m[k];
        if (!isInt(v) || v < 0) throw new MoneyError('bad_amount', { amount: v, field: label, key: k });
        needStr(k, 'bad_key', 'key');
        if (v > 0) out.set(k, v);
      }
      sums[label] = [...out.values()].reduce((a, b) => a + b, 0);
      return out;
    };
    const committed = norm(s && s.committed, 'committed');
    const payouts = norm(s && s.payouts, 'payouts');
    const returned = norm(s && s.returned, 'returned');
    if (!Number.isSafeInteger(sums.committed + sums.payouts + sums.returned)) throw new MoneyError('bad_amount', { why: 'sum too large' });
    if (sums.committed !== sums.payouts + sums.returned) {
      throw new MoneyError('not_conserved', { committed: sums.committed, payouts: sums.payouts, returned: sums.returned });
    }
    if (sums.committed === 0) return { id: null, dup: false, noop: true };
    const pot = `pot:${tableId}:${handNo}`;
    const items = [];
    for (const [k, v] of committed) items.push({ from: seatName(tableId, k), to: pot, amount: v, cur: tableCur });
    const back = new Map();
    for (const m of [payouts, returned]) for (const [k, v] of m) back.set(k, (back.get(k) || 0) + v);
    for (const k of [...back.keys()].sort()) items.push({ from: pot, to: seatName(tableId, k), amount: back.get(k), cur: tableCur });
    return ledger.batch(items, `hand:${tableId}:${handNo}`, 'hand');
  }

  // bonus / achv / topup mints. Signup and migration are internal.
  function mint(kind, key, amount, cur, ref) {
    if (!MINT_KINDS.includes(kind)) throw new MoneyError('bad_kind', { kind });
    needStr(key, 'bad_key', 'key'); needCur(cur); needRef(ref);
    return ledger.transfer('mint:' + kind, store(cur, key), amount, cur, kind, ref);
  }

  // Bender and Cold Call: the player pays the house, the house pays the player. House balances may go negative.
  function houseSpend(game, key, amount, cur, ref) {
    if (!GAMES.includes(game)) throw new MoneyError('bad_game', { game });
    needStr(key, 'bad_key', 'key'); needCur(cur); needHouseRef(ref);
    return ledger.transfer(store(cur, key), 'house:' + game, amount, cur, game + ':spend', ref);
  }
  function houseCredit(game, key, amount, cur, ref) {
    if (!GAMES.includes(game)) throw new MoneyError('bad_game', { game });
    needStr(key, 'bad_key', 'key'); needCur(cur); needHouseRef(ref);
    return ledger.transfer('house:' + game, store(cur, key), amount, cur, game + ':credit', ref);
  }

  // ---- pools and escrows (ADD-A-GAME.md section 3) ----
  const escrowOf = (game, key, roundId) => `escrow:${game}:${key}:${roundId}`;
  const poolOf = (game, name) => `pool:${game}:${name}`;
  const refsOf = (game, key, roundId) => ({ open: `${game}:${key}:${roundId}:open`, close: `${game}:${key}:${roundId}:close` });
  const needGame = (game) => { if (!GAMES.includes(game)) throw new MoneyError('bad_game', { game }); return game; };
  const needAmt = (v, label) => { if (!isInt(v) || v < 0) throw new MoneyError('bad_amount', { amount: v, field: label }); return v; };
  const needRound = (roundId) => needStr(roundId, 'bad_round', 'roundId');
  const needWhy = (why) => {
    if (why == null || why === '') return 'void';
    if (typeof why !== 'string' || !/^[a-z0-9_-]{1,40}$/.test(why)) throw new MoneyError('bad_reason', { reason: why });
    return why;
  };
  // pool = { name, feed, prize } -> { acct, feed, prize }. Missing or zero amounts mean no leg; the name is checked whenever a pool is given.
  function needPool(game, pool) {
    if (pool == null) return { acct: null, feed: 0, prize: 0 };
    if (typeof pool !== 'object' || Array.isArray(pool)) throw new MoneyError('bad_pool', { pool });
    const name = needStr(pool.name, 'bad_pool', 'name');
    return { acct: poolOf(game, name), feed: needAmt(pool.feed == null ? 0 : pool.feed, 'feed'), prize: needAmt(pool.prize == null ? 0 : pool.prize, 'prize') };
  }
  // A pool is fed only out of the stake of the same batch (ADD-A-GAME 5.9): feed above it is house money going into the pot.
  const needFeed = (p, stake) => { if (p.feed > stake) throw new MoneyError('bad_amount', { amount: p.feed, field: 'feed', stake }); };
  // The legs after the stake, always in this order: feed (house -> pool), prize (pool -> player), win (house -> player).
  function payLegs(game, player, cur, p, win) {
    const items = [];
    if (p.feed > 0) items.push({ from: 'house:' + game, to: p.acct, amount: p.feed, cur, reason: game + ':feed' });
    if (p.prize > 0) items.push({ from: p.acct, to: player, amount: p.prize, cur, reason: game + ':prize' });
    if (win > 0) items.push({ from: 'house:' + game, to: player, amount: win, cur, reason: game + ':credit' });
    return items;
  }
  // The ledger refuses a prize the pool cannot cover as a bare 'insufficient' on the pool account, which a caller would
  // read as "the player has no funds": say pool_short, with what the pool held at that step (after this batch's own feed).
  function writeBatch(items, ref, reason, p) {
    try { return ledger.batch(items, ref, reason); } catch (e) {
      if (p && p.acct && e && e.code === 'insufficient' && e.account === p.acct) throw new MoneyError('pool_short', { have: e.have, need: e.need, account: p.acct, cur: e.cur });
      throw e;
    }
  }

  // One slot round as ONE batch: the bet (player -> house), the optional pool legs, then the win (house -> player), so a crash can
  // never take the bet and lose the win. Same accounts and reasons as houseSpend / houseCredit (<game>:spend, <game>:credit).
  // The bet is checked first, so insufficient funds for `cost` throws even when win > cost. win 0 = spend only,
  // cost 0 = credit only (a free round), all 0 = { noop: true }. pool (optional) = { name, feed, prize }: without it the
  // batch is byte-for-byte what it was before pools existed.
  function houseRound(game, key, cost, win, cur, ref, pool) {
    if (!GAMES.includes(game)) throw new MoneyError('bad_game', { game });
    needStr(key, 'bad_key', 'key'); needCur(cur); needHouseRef(ref);
    for (const [label, v] of [['cost', cost], ['win', win]]) if (!isInt(v) || v < 0) throw new MoneyError('bad_amount', { amount: v, field: label });
    const p = needPool(game, pool);
    needFeed(p, cost);
    if (cost + win + p.feed + p.prize === 0) return { id: null, dup: false, noop: true };
    const player = store(cur, key);
    const items = [];
    if (cost > 0) items.push({ from: player, to: 'house:' + game, amount: cost, cur, reason: game + ':spend' });
    items.push(...payLegs(game, player, cur, p, win));
    return writeBatch(items, ref, game + ':round', p);
  }

  // Stake into escrow: ONE transfer player -> escrow:<game>:<key>:<roundId>. A round that was closed is never reopened, not
  // even by a retry of its own open. Cost 0 (a free round) has no escrow and writes nothing.
  function openRound(game, key, cur, roundId, cost) {
    needGame(game); needStr(key, 'bad_key', 'key'); needCur(cur); needRound(roundId); needAmt(cost, 'cost');
    if (cost === 0) return { id: null, dup: false, noop: true };
    const refs = refsOf(game, key, roundId);
    if (ledger.has(refs.close)) throw new MoneyError('round_closed', { ref: refs.close });
    return ledger.transfer(store(cur, key), escrowOf(game, key, roundId), cost, cur, game + ':open', refs.open);
  }

  // What the :close ref already wrote, read from the stored entries: { id, kind: 'void'|'settle', cur, stake, win, feed, prize, pool }.
  // stake = the escrow leg (<game>:spend) of a settle. Only runs on a retry, so the scan over the ledger is not on any hot path.
  function closeOf(game, ref) {
    let out = null;
    for (const e of ledger.entries(x => x.ref === ref)) {
      if (!out) out = { id: e.id, kind: 'settle', cur: e.cur, stake: 0, win: 0, feed: 0, prize: 0, pool: null };
      if (e.reason.startsWith(game + ':void:')) out.kind = 'void';
      else if (e.reason === game + ':spend') out.stake += e.amount;
      else if (e.reason === game + ':credit') out.win += e.amount;
      else if (e.reason === game + ':feed') { out.feed += e.amount; out.pool = e.to; }
      else if (e.reason === game + ':prize') { out.prize += e.amount; out.pool = e.from; }
    }
    return out;
  }

  // An escrow in the other currency means the caller named the wrong cur: closing "nothing" there would burn the close ref
  // and strand the real stake, so refuse before anything is built.
  function noOtherEscrow(account, cur) {
    if (ledger.balance(account, other(cur)) !== 0) throw new MoneyError('bad_cur', { cur, account, why: 'the escrow is held in ' + other(cur) });
  }

  // Close a round with its outcome: ONE batch under <game>:<key>:<roundId>:close, in the contract's order: the WHOLE escrow
  // (read here, never passed in) -> house, feed, prize, win. A round with no escrow (a free round) writes only the pool legs and
  // the win; everything 0 and no escrow = noop. o = { win, pool, stake }: stake (optional) is what the caller believes the escrow
  // holds, 0 = "a free round, no escrow"; another escrow throws stake_mismatch before anything is written. The close ref is
  // decided from its stored lines BEFORE anything is built (after the first close the escrow is 0, so a rebuilt batch would
  // differ): the identical close (kind, currency, numbers, stake when given) = dup; anything else on a closed round = round_closed
  // ("already played": a game that replays after a crash rolls new numbers).
  function settleRound(game, key, cur, roundId, o = {}) {
    needGame(game); needStr(key, 'bad_key', 'key'); needCur(cur); needRound(roundId);
    if (o === null || typeof o !== 'object' || Array.isArray(o)) throw new MoneyError('bad_amount', { outcome: o });
    const win = needAmt(o.win == null ? 0 : o.win, 'win'), p = needPool(game, o.pool), want = o.stake == null ? null : needAmt(o.stake, 'stake');
    const { close } = refsOf(game, key, roundId), escrow = escrowOf(game, key, roundId), player = store(cur, key);
    if (ledger.has(close)) {
      const st = closeOf(game, close);
      const pooled = p.feed + p.prize > 0;
      if (st.kind === 'settle' && st.cur === cur && st.win === win && st.feed === p.feed && st.prize === p.prize && (!pooled || st.pool === p.acct)
        && (want == null || want === st.stake)) return { id: st.id, dup: true };
      throw new MoneyError('round_closed', { ref: close, id: st.id });
    }
    noOtherEscrow(escrow, cur);
    const held = ledger.balance(escrow, cur);
    if (want != null && want !== held) throw new MoneyError('stake_mismatch', { have: held, want });
    needFeed(p, held);
    const items = [];
    if (held > 0) items.push({ from: escrow, to: 'house:' + game, amount: held, cur, reason: game + ':spend' });
    items.push(...payLegs(game, player, cur, p, win));
    if (!items.length) return { id: null, dup: false, noop: true };
    return writeBatch(items, close, game + ':settle', p);
  }

  // Refund an open round: ONE transfer escrow -> player (the whole escrow), reason <game>:void:<why>, same close ref as settle.
  // No escrow = noop. A stored void answers dup whatever the `why` (same currency); a stored settle, or a void in the other currency, is round_closed.
  function voidRound(game, key, cur, roundId, why) {
    needGame(game);
    return voidAccount(game, key, cur, roundId, why);
  }
  function voidAccount(game, key, cur, roundId, why) {
    needStr(key, 'bad_key', 'key'); needCur(cur); needRound(roundId); why = needWhy(why);
    const { close } = refsOf(game, key, roundId), escrow = escrowOf(game, key, roundId);
    if (ledger.has(close)) {
      const st = closeOf(game, close);
      if (st.kind === 'void' && st.cur === cur) return { id: st.id, dup: true };
      throw new MoneyError('round_closed', { ref: close });
    }
    noOtherEscrow(escrow, cur);
    const held = ledger.balance(escrow, cur);
    if (held === 0) return { id: null, dup: false, noop: true };
    return ledger.transfer(escrow, store(cur, key), held, cur, `${game}:void:${why}`, close);
  }

  const parseEscrow = (account, cur, balance) => { const [, game, key, roundId] = account.split(':'); return { game, key, cur, roundId, amount: balance }; };
  // Every non-zero escrow of one game, read from the ledger.
  function openRounds(game) {
    needGame(game);
    const out = [];
    for (const cur of CURS) for (const { account, balance } of ledger.list(`escrow:${game}:`, cur)) { const { key, roundId, amount } = parseEscrow(account, cur, balance); out.push({ key, cur, roundId, amount }); }
    return out;
  }
  // True when the round was played: its :close ref is in the ledger, or (an instant round) its own ref is.
  function roundClosed(game, key, roundId) {
    needGame(game); needStr(key, 'bad_key', 'key'); needRound(roundId);
    return ledger.has(refsOf(game, key, roundId).close) || ledger.has(`${game}:${key}:${roundId}`);
  }
  function poolBalance(game, name, cur) {
    needGame(game); needStr(name, 'bad_pool', 'name'); needCur(cur);
    return ledger.balance(poolOf(game, name), cur);
  }

  // Boot rule for escrows, run by the game registry after the games' own recover(): every non-zero escrow of EVERY game id in
  // the ledger (a game with no module loaded too) that isLive() does not claim goes back to its player (void:boot). One bad
  // account is reported and does not stop the rest. Idempotent: the voided escrows are 0 on a second run.
  function sweepEscrows(isLive) {
    const report = { voided: [], kept: [], errors: [] };
    for (const cur of CURS) {
      for (const { account, balance } of ledger.list('escrow:', cur)) {
        const r = parseEscrow(account, cur, balance);
        try {
          if (isLive(r)) { report.kept.push(r); continue; }
          const w = voidAccount(r.game, r.key, cur, r.roundId, 'boot');
          report.voided.push({ ...r, id: w.id, dup: !!w.dup });
        } catch (e) { report.errors.push({ what: account, code: e.code || 'error', message: e.message }); }
      }
    }
    return report;
  }

  // Admin edits are a signed delta on the bank/wallet only. There is no "set total" (H5).
  function adminAdjust(key, delta, cur, reason, ref) {
    needStr(key, 'bad_key', 'key'); needCur(cur); needRef(ref);
    if (!isInt(delta) || delta === 0) throw new MoneyError('bad_amount', { amount: delta });
    if (typeof reason !== 'string' || !reason.trim()) throw new MoneyError('bad_reason', { reason });
    const why = 'admin:' + reason.trim().slice(0, 200);
    return delta > 0
      ? ledger.transfer('admin:adjust', store(cur, key), delta, cur, why, ref)
      : ledger.transfer(store(cur, key), 'admin:adjust', -delta, cur, why, ref);
  }

  // Cash held by this key: wallet, every seat at a Play table, and every open Play escrow (a stake in a round is still theirs).
  function playHeld(key) {
    const wallet = ledger.balance('play:' + key, 'play');
    let seats = 0, escrow = 0;
    for (const { account, balance } of ledger.list('seat:', 'play')) if (account.split(':')[2] === key) seats += balance;
    for (const { account, balance } of ledger.list('escrow:', 'play')) if (account.split(':')[2] === key) escrow += balance;
    return { wallet, seats, escrow, total: wallet + seats + escrow };
  }

  // H7: eligibility counts wallet + all Play seats, not the wallet alone.
  function topUpEligible(key) {
    needStr(key, 'bad_key', 'key');
    refresh();
    const h = playHeld(key);
    const last = lastTopUp.get(key);
    const retryMs = last == null ? 0 : Math.max(0, last + TOPUP_COOLDOWN_MS - now());
    let why = null;
    if (h.total >= TOPUP_BELOW) why = 'not_needed';
    else if (retryMs > 0) why = 'cooldown';
    return { eligible: !why, why, total: h.total, wallet: h.wallet, seats: h.seats, escrow: h.escrow, retryMs };
  }

  // Convenience on top of mint(): brings wallet + seats back up to START_PLAY (so money parked at a table is not minted twice).
  function topUp(key, ref) {
    needRef(ref);
    if (ledger.has(ref)) { // replay: re-issue the original amount so the ledger answers dup or ref_conflict
      for (const e of ledger.entries(x => x.ref === ref)) return mint('topup', key, e.amount, 'play', ref);
    }
    const e = topUpEligible(key);
    if (!e.eligible) throw new MoneyError(e.why, { retryMs: e.retryMs, total: e.total });
    return mint('topup', key, START_PLAY - e.total, 'play', ref);
  }

  // The fund a seat was bought in from, read from the ledger only: the most recent buyin:<fund> entry into the seat.
  function seatFund(tableId, key, cur) {
    const seat = seatName(tableId, key);
    let fund = null;
    for (const e of ledger.entries(x => x.to === seat && x.reason.startsWith('buyin:'))) fund = e.reason.slice(6);
    if (fund) return fund;
    if (cur) return cur;
    return null;
  }

  // Boot rule, the only recovery code. Stray pots (should never exist) are refunded pro rata to their net
  // contributors; then every non-zero seat goes back to its owner's fund. Idempotent per bootId.
  function bootRecover(bootId) {
    needStr(bootId, 'bad_boot', 'bootId');
    const report = { bootId, seats: [], pots: [], errors: [] };
    const attempt = (what, fn) => { try { return fn(); } catch (e) { report.errors.push({ what, code: e.code || 'error', message: e.message }); return null; } };

    for (const cur of CURS) {
      for (const { account, balance } of ledger.list('pot:', cur)) {
        const [, tableId] = account.split(':');
        const net = new Map();
        for (const e of ledger.entries(x => x.cur === cur && (x.to === account || x.from === account))) {
          const seat = e.to === account ? e.from : e.to;
          if (!seat.startsWith('seat:')) continue;
          net.set(seat, (net.get(seat) || 0) + (e.to === account ? e.amount : -e.amount));
        }
        const owners = [...net].filter(([, v]) => v > 0).sort((a, b) => (a[0] < b[0] ? -1 : 1));
        const total = owners.reduce((a, [, v]) => a + v, 0);
        report.errors.push({ what: account, code: 'stray_pot', message: `pot ${account} held ${balance} ${cur} outside a hand batch` });
        if (!owners.length || total <= 0) continue;
        // pro rata with largest remainder, in BigInt so balance * share cannot lose precision
        const B = BigInt(balance), T = BigInt(total);
        const parts = owners.map(([seat, v]) => ({ seat, share: (B * BigInt(v)) / T, rem: (B * BigInt(v)) % T }));
        let left = B - parts.reduce((a, p) => a + p.share, 0n);
        for (const p of [...parts].sort((a, b) => (a.rem === b.rem ? (a.seat < b.seat ? -1 : 1) : a.rem > b.rem ? -1 : 1))) {
          if (left <= 0n) break;
          p.share += 1n; left -= 1n;
        }
        const items = parts.filter(p => p.share > 0n).map(p => ({ from: account, to: p.seat, amount: Number(p.share), cur }));
        const r = attempt(account, () => ledger.batch(items, `boot:${bootId}:${account}`, 'boot:pot'));
        if (r) report.pots.push({ account, tableId, cur, refunded: items.map(i => ({ seat: i.to, amount: i.amount })), dup: r.dup });
      }
    }

    for (const cur of CURS) {
      for (const { account, balance } of ledger.list('seat:', cur)) {
        const [, tableId, key] = account.split(':');
        const fund = seatFund(tableId, key, cur);
        const r = attempt(account, () => moveOut(account, key, balance, cur, fund, `boot:${bootId}:${account}`, 'boot'));
        if (r) report.seats.push({ account, tableId, key, cur, fund, amount: balance, dup: r.dup });
      }
    }
    return report;
  }

  // Rollback files: bank.json and wallet.json as the old server (9440541) would read them. Open seats are folded
  // into the owner (chips seats and escrows -> bank, Play seats and escrows -> wallet; pools are nobody's), orphans are kept under their old name, and every
  // known account appears even at 0, because the old code mints 10,000 for a missing bank row.
  function mirror() {
    refresh();
    const bank = {}, wallet = {};
    for (const k of known.chips) bank[k] = 0;
    for (const k of known.play) wallet[k] = 0;
    const add = (obj, k, n) => { obj[k] = (obj[k] || 0) + n; };
    for (const { account, balance } of ledger.list('bank:', 'chips')) add(bank, account.slice(5), balance);
    for (const { account, balance } of ledger.list('play:', 'play')) add(wallet, account.slice(5), balance);
    for (const { account, balance } of ledger.list('seat:', 'chips')) add(bank, account.split(':')[2], balance);
    for (const { account, balance } of ledger.list('seat:', 'play')) add(wallet, account.split(':')[2], balance);
    for (const { account, balance } of ledger.list('escrow:', 'chips')) add(bank, account.split(':')[2], balance);
    for (const { account, balance } of ledger.list('escrow:', 'play')) add(wallet, account.split(':')[2], balance);
    for (const { account, balance } of ledger.list('orphan:', 'chips')) add(bank, account.slice(7), balance);
    for (const { account, balance } of ledger.list('orphan:', 'play')) add(wallet, account.slice(7), balance);
    return { bank, wallet };
  }

  // Buy-ins, cash-outs and net per key for one table, from the ledger. Boot recovery counts as a cash-out.
  // `open` is what seats still hold (stack + committed), so zeroSum holds during and after a night.
  // opts.fromId limits the window to entries after that ledger id (a table that is reused across nights).
  function nightSummary(tableId, o = {}) {
    needStr(tableId, 'bad_table', 'tableId');
    const prefix = `seat:${tableId}:`;
    const per = {};
    const row = (k) => (per[k] || (per[k] = { buyIn: 0, cashOut: 0, open: 0, net: 0 }));
    const f = (e) => (e.to.startsWith(prefix) && e.reason.startsWith('buyin:')) || (e.from.startsWith(prefix) && (e.reason.startsWith('cashout:') || e.reason.startsWith('boot:')));
    for (const e of ledger.entries(f, o.fromId || 0)) {
      if (e.to.startsWith(prefix)) row(e.to.slice(prefix.length)).buyIn += e.amount;
      else row(e.from.slice(prefix.length)).cashOut += e.amount;
    }
    for (const cur of CURS) for (const { account, balance } of ledger.list(prefix, cur)) row(account.slice(prefix.length)).open += balance;
    let sum = 0;
    for (const r of Object.values(per)) { r.net = r.cashOut + r.open - r.buyIn; sum += r.net; }
    return { tableId, perKey: per, zeroSum: sum === 0, sum };
  }

  // Everything one key holds, for the lobby/bank screen and the admin overview.
  function balances(key) {
    needStr(key, 'bad_key', 'key');
    const seats = [];
    for (const cur of CURS) for (const { account, balance } of ledger.list('seat:', cur)) {
      const [, tableId, k] = account.split(':');
      if (k === key) seats.push({ account, tableId, cur, balance });
    }
    const atTable = { chips: 0, play: 0 };
    for (const s of seats) atTable[s.cur] += s.balance;
    const escrows = [], inRound = { chips: 0, play: 0 };
    for (const cur of CURS) for (const { account, balance } of ledger.list('escrow:', cur)) {
      const [, game, k, roundId] = account.split(':');
      if (k === key) { escrows.push({ account, game, roundId, cur, balance }); inRound[cur] += balance; }
    }
    return { chips: ledger.balance('bank:' + key, 'chips'), play: ledger.balance('play:' + key, 'play'), seats, atTable, escrows, inRound };
  }

  return {
    ensureAccount, buyIn, cashOut, settleHand, mint, houseSpend, houseCredit, houseRound, adminAdjust,
    openRound, settleRound, voidRound, openRounds, roundClosed, poolBalance, sweepEscrows,
    topUpEligible, topUp, bootRecover, mirror, nightSummary, balances, seatFund, ledger, GAMES,
    START_CHIPS, START_PLAY, TOPUP_BELOW, TOPUP_COOLDOWN_MS,
  };
}

module.exports = { createService, START_CHIPS, START_PLAY, TOPUP_BELOW, TOPUP_COOLDOWN_MS };
