'use strict';
// RIG=1 test hooks (contract section 10). Registered only when process.env.RIG === '1'; never in production. No sign-in needed.
// __rig queues decks (dealt in order by deckSource), __audit returns a money + seat snapshot. Read-only: no rule change.

const CURS = ['chips', 'play'];

function createRig(ctx) {
  const decks = [];
  const deckSource = () => (decks.length ? decks.shift() : null);
  const sum = (account) => CURS.reduce((n, cur) => n + ctx.ledger.balance(account, cur), 0);

  function audit() {
    const { ledger, registry, accounts, money } = ctx;
    const keys = Object.values(accounts.all()).map(a => a.key);
    const bank = {}, wallet = {};
    for (const k of keys) { bank[k] = ledger.balance('bank:' + k, 'chips'); wallet[k] = ledger.balance('play:' + k, 'play'); }
    const minted = -['mint:bonus', 'mint:achv', 'mint:topup'].reduce((n, a) => n + sum(a), 0);
    const slotNet = -['house:bender', 'house:coldcall'].reduce((n, a) => n + sum(a), 0);
    const seats = [];
    for (const cur of CURS) for (const { account, balance } of ledger.list('seat:', cur)) if (balance !== 0) seats.push({ account, cur, balance });
    const drift = [];
    const rooms = [...registry.tables.values()].map(t => {
      const rows = t.auditSeats();
      drift.push(...money.drift(t, rows));
      const live = t.handLive(), h = t.hand;
      const byKey = Object.fromEntries(rows.map(r => [r.key, r]));
      return {
        id: t.id, status: ctx.views.gameState(t, null).status, unit: t.unit, pot: live && h ? require('../engine/hand').totalPot(h) : 0, handNum: Math.max(0, t.handNo - (t.nightHand0 || 0)),
        sb: h ? h.sb : t.blinds.sb, bb: h ? h.bb : t.blinds.bb, street: live && h ? h.street : null, currentBet: live && h ? h.currentBet : 0,
        players: t.players().map(s => {
          const hs = live && s.dealt && h ? h.seats[s.seat] : null;
          return { key: s.key, name: ctx.views.nameOf(s.key), chips: byKey[s.key].stack, handBet: byKey[s.key].handBet, isBot: false, fund: s.fund || null, connected: !!s.connected,
            roundBet: hs ? hs.bet || 0 : 0, folded: !!(hs && hs.folded), allIn: !!(hs && hs.allIn), sittingOut: !!(s.sitOutNext || (!s.dealt && live)) };
        }),
      };
    });
    if (drift.length) console.error('[v2] AUDIT DRIFT ' + JSON.stringify(drift).slice(0, 600));   // RIG only: a seat account disagrees with its seat
    // Soak hooks (P6): money parked in the wallet adapter's memory, and each game module's own audit() (none has one yet), keyed by game id.
    const games = {};
    for (const m of (ctx.games && ctx.games.modules) || []) if (m && typeof m.audit === 'function') { try { games[m.id] = m.audit(); } catch (e) { games[m.id] = { error: String(e && e.message) }; } }
    return { bank, wallet, accounts: keys, minted, slotNet, rooms, ledger: ledger.check(), seats, drift, walletPending: ctx.wallet ? ctx.wallet.pendingCount() : 0, games };
  }

  function register(socket, on) {
    on('__rig', ({ decks: ds } = {}) => {
      decks.length = 0;
      for (const d of Array.isArray(ds) ? ds : []) decks.push(d.map(c => ({ rank: c.rank, suit: c.suit })));
      socket.emit('__rig_ok', { queued: decks.length });
    });
    on('__audit', () => { socket.emit('__audit', audit()); });
  }

  return { register, deckSource, audit, queue: decks };
}

module.exports = { createRig };
