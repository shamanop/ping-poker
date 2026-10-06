'use strict';
// Presentation log adapter (contract section 1). Money truth is the money ledger; this writes the OLD ledger.js rows that
// bank_summary, get_leaderboard, profile.recent/net* and accounts.recordHand/recordNight still read, and builds the
// legacy-shaped room view that social.onHandEnd and ledger.startHand/endHand expect. Nothing here is ever read back as money.
// Wiring: money-port `onWrite` -> viewlog.onWrite (buyin / rebuy / cashout rows); registry out events -> viewlog.onEvent.

function createViewlog({ presLedger, accounts, social, bankOf, profileOf, nightNets }) {
  const nameOf = key => (profileOf && profileOf(key) && profileOf(key).display) || key;
  const meta = (t, key) => (t.nightId ? { mode: t.unit, tableId: t.id, nightId: t.nightId, key } : undefined);
  const guard = (what, fn) => { try { return fn(); } catch (e) { console.error('[v2] viewlog ' + what + ':', e && e.message); return undefined; } };

  // money-port onWrite({ kind, table, key, amount })
  function onWrite(w) {
    if (!presLedger) return;
    const t = w.table, name = nameOf(w.key);
    const after = t.unit === 'cents' ? null : guard('bank', () => bankOf(w.key));
    if (w.kind === 'buyin' || w.kind === 'rebuy') {
      const seat = t.seatOfKey(w.key);
      presLedger.log(w.kind, name, w.amount, after, seat ? seat.stack : w.amount, t.handNo, t.id, meta(t, w.key));
    } else {
      // leave | kick | sweep | grace | night: chips returned to the owner's fund. Reason rides on the row like the old payOut meta.
      const m = meta(t, w.key); const extra = m ? { ...m, reason: w.kind } : { reason: w.kind };
      if (w.kind === 'grace') extra.park = true;
      presLedger.log('cashout', name, w.amount, after, 0, t.handNo, t.id, extra);
    }
  }

  // The room shape ledger.js and social.js read (names, chips, handBet, handStartChips).
  function legacyRoom(t, hand, bySeat, names) {
    return {
      id: t.id, handNum: hand.handNo - (t.nightHand0 || 0), bb: hand.bb, sb: hand.sb, unit: t.unit, mode: t.mode, nightId: t.nightId, status: 'waiting_next',
      players: Object.values(bySeat).map(s => {
        const hs = hand.seats[s.seat];
        return { name: names[s.seat] || nameOf(s.key), acct: s.key, isBot: false, chips: hs.stack, handStartChips: (t.handStartStacks && t.handStartStacks[s.seat]) || 0,
          handBet: hs.committed, sittingOut: !!s.sitOutNext, winHand: names.winHand && names.winHand[s.seat] };
      }),
    };
  }

  function onEvent(t, kind, data) {
    if (kind === 'hand_start') {
      guard('startHand', () => { if (!presLedger) return;
        const hand = t.hand, bySeat = {}; for (const s of t.players()) if (s.dealt) bySeat[s.seat] = s;
        const room = { id: t.id, players: Object.values(bySeat).map(s => ({ name: nameOf(s.key), chips: t.handStartStacks[s.seat] })) };
        presLedger.startHand(room); });
    } else if (kind === 'hand_end') {
      guard('handEnd', () => {
        const { hand, result, bySeat } = data;
        const names = { winHand: {} };
        for (const s of Object.values(bySeat)) names[s.seat] = nameOf(s.key);
        if (result) for (const w of result.winners) for (const s of Object.values(bySeat)) if (names[s.seat] === w.name) names.winHand[s.seat] = w.handName;
        const room = legacyRoom(t, hand, bySeat, names);
        if (presLedger) presLedger.endHand(room, name => { const k = Object.values(bySeat).find(s => names[s.seat] === name); return k ? bankOf(k.key) : null; });
        if (social) social.onHandEnd(room);
        if (t.nightId && t.mode !== 'play' && accounts) {
          const pot = room.players.reduce((sum, p) => sum + (p.handBet || 0), 0);
          for (const p of room.players) if (p.acct && p.handStartChips > 0) accounts.recordHand(p.acct, { won: p.chips > p.handStartChips, pot });
        }
      });
    } else if (kind === 'night_end') {
      guard('nightEnd', () => {
        if (presLedger) presLedger.log('night-end', null, 0, null, null, t.handNo - (t.nightHand0 || 0), t.id, { mode: t.unit, tableId: t.id, nightId: t.nightId, tableName: t.name, reason: data.reason });
        if (t.mode !== 'play' && data.reason !== 'shutdown' && accounts && nightNets) {
          for (const [key, r] of Object.entries(nightNets(t).perKey)) accounts.recordNight(key, { mode: t.unit === 'chips' ? 'chips' : 'cents', net: r.net });
        }
      });
    }
  }

  return { onWrite, onEvent, legacyRoom };
}

module.exports = { createViewlog };
