'use strict';
// Every outgoing payload that is derived from table state (contract sections 4.6, 5, 6). tests/v2/30_shapes judges this file.
// Pure reads: nothing here writes money or changes a table. The dense players[] array is built by Table.players() only.

const engine = require('../engine/hand');
const { levelAt } = require('../tables/settings');

const AV_EMOJI = ['🤠', '🦊', '🐉', '🎩', '🦁', '🐺', '🦅', '🎲', '👑', '💀', '🎯', '⚡'];
const emojiOf = avatar => AV_EMOJI[Number(String(avatar || '').slice(1)) - 1] || '🃏';

function createViews({ registry, accounts, presLedger, ledger, service, wallet }) {
  const acctOf = key => accounts.get(key);
  const nameOf = key => { const a = acctOf(key); return a ? a.display : key; };
  const picOf = key => { const a = acctOf(key); return a ? accounts.picUrl(a) : null; };
  const bankOf = key => ledger.balance('bank:' + key, 'chips');
  const playOf = key => ledger.balance('play:' + key, 'play');
  const atTableChips = key => { let n = 0; for (const { account, balance } of ledger.list('seat:', 'chips')) if (account.split(':')[2] === key) n += balance; return n; };

  // ---- money ---------------------------------------------------------------------------------------------------
  function walletView(key) { return wallet ? wallet.get(key) : { play: playOf(key), chips: bankOf(key) }; }
  function moneyView(key) {
    const bank = bankOf(key), atTable = atTableChips(key);
    return { bank, atTable, chips: bank + atTable, wallet: walletView(key) };
  }

  // ---- table objects -------------------------------------------------------------------------------------------
  function blindsNow(t) { return t.handLive() || t.hand ? { sb: t.hand.sb, bb: t.hand.bb } : { sb: t.blinds.sb, bb: t.blinds.bb }; }
  function tableObj(t) { const b = blindsNow(t); return { id: t.id, name: t.name, mode: t.mode, unit: t.unit, sb: b.sb, bb: b.bb, maxSeats: t.maxSeats, look: t.look || 'basement' }; }
  function modeFields(t) { return { mode: t.mode, unit: t.unit, moneyMode: t.mode, table: tableObj(t) }; }
  function publicTable(t) { return { ...registry.publicTable(t), emptySince: t.emptySince == null ? null : t.emptySince, pausedBy: t.pausedBy || '' }; }
  const hostName = t => { const s = t.seatOfKey(t.hostKey); return s ? nameOf(s.key) : ''; };
  function seatedList(t) {
    return t.players().filter(s => s.connected).map(s => { const a = acctOf(s.key); return { key: s.key, display: nameOf(s.key), avatar: a ? a.avatar : null, pic: picOf(s.key), stack: s.stack }; });
  }
  // `you` and `away` are additive (Q03): the caller's own seat is reported even while it is disconnected, so the lobby can resume it instead of offering a buy-in.
  function awayList(t) { return t.players().filter(s => !s.connected).map(s => ({ key: s.key, display: nameOf(s.key), stack: s.stack })); }
  function tableInfo(t, forKey) {
    const mine = forKey ? t.seatOfKey(forKey) : null;
    return { table: publicTable(t), seated: seatedList(t), openSeats: Math.max(0, t.maxSeats - t.players().filter(s => s.connected).length),
      away: awayList(t), you: { seated: !!mine, connected: !!(mine && mine.connected), stack: mine ? mine.stack : 0 } };
  }

  // ---- game_state ----------------------------------------------------------------------------------------------
  const statusOf = t => (t.phase === 'betting' || t.phase === 'runout' ? 'playing' : t.phase === 'between' ? 'waiting_next' : t.phase === 'ended' ? 'ended' : 'waiting');
  function turnRemainingMs(t) {
    if (t.paused || t.phase !== 'betting' || !t.hand || t.hand.toAct == null) return null;
    const seat = t.seats.get(t.hand.toAct);
    const limit = seat ? t.turnLimitMs(seat) : 0;
    if (!(limit > 0) || !t.turnStartAt) return null;
    return Math.max(0, limit - (t.now() - t.turnStartAt));
  }
  function legalFor(t, seat) {
    if (!seat || t.paused || t.phase !== 'betting' || !t.hand || t.hand.toAct !== seat.seat || !seat.dealt) return null;
    const la = engine.legalActions(t.hand, seat.seat);
    if (!la) return null;
    return { toCall: la.toCall, callAmount: la.callAmount, canFold: true, canCheck: !!la.canCheck, canCall: !!la.canCall, canRaise: !!la.canRaise,
      minRaiseTo: la.canRaise ? la.minRaiseTo : null, maxRaiseTo: la.canRaise ? la.maxRaiseTo : null };
  }
  // A table that went back to 'waiting' (hand over, not enough players) keeps its last hand in memory; nobody may see it as a live hand (Q03).
  const shownHand = t => (t.phase === 'waiting' ? null : t.hand);
  function seatRow(t, s, i, curIdx, dealerIdx) {
    const a = acctOf(s.key), h = shownHand(t);
    const hs = h && s.dealt ? h.seats[s.seat] : null, live = t.liveSeat(s);
    const chips = live && hs ? hs.stack : s.stack;
    const inHand = !!hs;
    const midHand = !!t.hand && (t.phase === 'betting' || t.phase === 'runout');
    const sittingOut = midHand ? !s.dealt : (s.stack === 0 || s.sitOutNext || !s.connected);
    return {
      name: nameOf(s.key), avatar: emojiOf(a && a.avatar), profilePic: picOf(s.key),
      chips, roundBet: live && hs ? (hs.bet || 0) : 0, folded: !!(inHand && (hs.folded || s.folded)), allIn: !!(live && hs && !hs.folded && (hs.allIn || t.phase === 'runout')),   // run-out: nobody can act, so every live seat reads as all-in (the uncalled layer already sits back in chips)
      sittingOut: !!sittingOut, sitOutRequest: !!s.sitOutNext, connected: !!s.connected, isBot: false,
      isDealer: i === dealerIdx, isActive: curIdx === i, cardCount: inHand && !(hs.folded) ? 2 : (inHand ? 2 : 0), chipsBought: 0, lastAction: s.lastAction || null,
      seatNo: s.seat, leaving: !!s.leaving,
      blind: live && h && s.dealt ? (s.seat === h.sbSeat ? 'SB' : s.seat === h.bbSeat ? 'BB' : null) : null,   // the seats that posted the blinds (engine sbSeat/bbSeat); the client prints it as is
    };
  }
  function gameState(t, forKey) {
    const players = t.players(), h = shownHand(t);
    const betting = t.phase === 'betting' && h && h.toAct != null;
    const curIdx = betting ? players.findIndex(s => s.seat === h.toAct) : null;
    const dealerIdx = t.button == null ? 0 : Math.max(0, players.findIndex(s => s.seat === t.button));
    const now = t.now(), lv = levelAt(t, t.blindStartAt, now), b = blindsNow(t);
    const me = forKey ? t.seatOfKey(forKey) : null;
    const live = t.handLive();
    return {
      street: h ? h.street : null,
      pot: live && h ? engine.totalPot(h) : (t.phase === 'between' && t.lastResult ? t.lastResult.pot : 0),
      currentBet: live && h ? h.currentBet : 0,
      community: h ? h.board.slice() : [],
      dealerIdx, currentPlayerIdx: curIdx == null || curIdx < 0 ? null : curIdx,
      handNum: Math.max(0, t.handNo - (t.nightHand0 || 0)), status: statusOf(t),
      ...modeFields(t), paused: !!t.paused, endingNight: !!t.endNightPending, startChips: t.buyIn.default, hostName: hostName(t),
      sb: b.sb, bb: b.bb, blindLevel: lv.level, blindsEnabled: !!lv.enabled, blindNextMs: lv.enabled ? lv.nextMs : null, blindMaxLevel: lv.maxLevel,
      turnRemainingMs: turnRemainingMs(t),
      players: players.map((s, i) => seatRow(t, s, i, curIdx == null ? -1 : curIdx, dealerIdx)),
      log: t.log.slice(-8), handHistory: t.history,
      legalActions: legalFor(t, me),
      you: me ? { seatNo: me.seat, idx: players.findIndex(s => s.seat === me.seat) } : null,
    };
  }
  function yourCards(t, seat) {
    const h = shownHand(t), hs = h && seat.dealt ? h.seats[seat.seat] : null;
    return { cards: hs && hs.hole ? hs.hole.slice() : [], myIdx: t.players().findIndex(s => s.seat === seat.seat),
      preselect: seat.pre && t.preValid(seat) ? { mode: seat.pre.kind || seat.pre.mode, amount: seat.pre.amount } : null };
  }
  function roomUpdate(t) {
    return { ...modeFields(t), players: t.players().map(s => { const a = acctOf(s.key); return { name: nameOf(s.key), avatar: emojiOf(a && a.avatar), profilePic: picOf(s.key) }; }), hostName: hostName(t) };
  }

  // ---- end of hand ---------------------------------------------------------------------------------------------
  function showdownResult(result) { const { history, ...rest } = result; return rest; }
  function bustOut(t, seat) {
    const fund = seat.fund || t.cur, bal = fund === 'chips' ? bankOf(seat.key) : playOf(seat.key);
    const o = { tableId: t.id, unit: t.unit, mode: t.mode, rebuy: { allowed: !!t.rebuys && t.buyInAllowed(seat.key) && bal >= t.buyIn.min, fund, balance: bal, min: t.buyIn.min, max: t.buyIn.max, default: Math.min(t.buyIn.default, Math.max(bal, t.buyIn.min)) } };
    if (t.mode === 'chips') o.balance = bankOf(seat.key);
    return o;
  }

  // ---- bank screens (old presentation ledger + live rows) -------------------------------------------------------
  function bankMap() { const m = {}; for (const a of Object.values(accounts.all())) m[a.key] = bankOf(a.key); return m; }
  function walletMap() { const m = {}; for (const a of Object.values(accounts.all())) m[a.key] = playOf(a.key); return m; }
  function liveRows(t) {
    return t.players().map(s => {
      const hs = t.liveSeat(s) ? t.hand.seats[s.seat] : null;
      const status = !s.connected ? 'away' : (s.sitOutNext || s.stack === 0 ? 'sitting-out' : 'seated');
      return { name: nameOf(s.key), isBot: false, chips: hs ? hs.stack : s.stack, inPot: hs ? hs.committed - (hs.returned || 0) : 0, status };
    });
  }
  function bankSummary(roomId, view) {
    const own = registry.tables.get(roomId);
    const want = view === 'play' || view === 'chips' ? view : (own && own.mode === 'play' ? 'play' : 'chips');
    if (want === 'play') {
      const live = [];
      for (const t of registry.tables.values()) if (t.mode === 'play') live.push(...liveRows(t));
      const rows = presLedger.entries().filter(e => e.mode === 'cents');
      return { ...presLedger.summary(roomId, walletMap(), live, { all: true, rows }), view: 'play', unit: 'cents' };
    }
    const base = own && own.mode === 'play' ? 'POKERPING' : roomId;
    const chipsTable = registry.tables.get(base) || own;
    const nightId = (chipsTable && chipsTable.nightId) || null;
    const live = [];
    for (const t of registry.tables.values()) {
      if (t.mode === 'play') continue;
      if (nightId ? t !== chipsTable : t.nightId) continue;
      live.push(...liveRows(t));
    }
    return { ...presLedger.summary(base, bankMap(), live, { nightId }), view: 'chips', unit: 'chips' };
  }

  function leaderboard(myKey) {
    const rows = [];
    for (const [k, net] of presLedger.accountNets({ mode: 'cents' })) {
      const a = acctOf(k);
      if (a) rows.push({ key: k, display: a.display, avatar: a.avatar, pic: accounts.picUrl(a), netCents: net });
    }
    rows.sort((x, y) => y.netCents - x.netCents || x.display.localeCompare(y.display));
    const entries = rows.slice(0, 10).map((r, i) => ({ ...r, rank: i + 1 }));
    const mi = myKey ? rows.findIndex(r => r.key === myKey) : -1;
    return { entries, me: mi >= 0 ? { ...rows[mi], rank: mi + 1 } : null, total: rows.length };
  }

  function profile(a, self) {
    return {
      key: a.key, display: a.display, avatar: a.avatar, pic: accounts.picUrl(a), stats: a.stats,
      netCents: presLedger.accountNet(a.key, { mode: 'cents' }), netChips: presLedger.accountNet(a.key, { mode: 'chips' }),
      recent: presLedger.nightsFor(a.key, 20), prefs: self ? a.prefs : undefined, isAdmin: !!a.isAdmin,
    };
  }

  return { moneyView, walletView, modeFields, tableObj, publicTable, tableInfo, seatedList, gameState, yourCards, roomUpdate, showdownResult, bustOut, bankSummary, leaderboard, profile, legalFor, bankOf, playOf, nameOf, picOf, emojiOf, hostName };
}

module.exports = { createViews, AV_EMOJI };
