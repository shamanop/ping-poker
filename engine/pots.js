'use strict';
// OWNER: engine builder. Pure side-pot layering.

// committedBySeat: { [seat]: amount } (what each seat has in the pots, uncalled returns already removed)
// foldedSeats: array or Set of seat numbers that cannot win.
// -> [{ amount, eligible: [seat, ...] }] lowest layer first. Layers are cut at the distinct commitments
// of the seats still in. A folded seat's chips stay in every layer they reach, and a layer is only ever won by live seats
// that put chips into it (K3-2: a seat all-in for X wins at most X from each other seat).
// Chips a folded seat put in above the highest live commitment (a foldOut leaves them behind) belong to no live seat:
// they are cut into layers at the folded seats' own commitments and each layer comes back as
// { amount, eligible: [], refund: { seat: chips } } -> every contributor gets its own chips back, nobody else is paid.
// If no live seat has put in anything (everyone else was folded out), the live seats share the dead money.
function sidePots(committedBySeat, foldedSeats) {
  const folded = new Set([...(foldedSeats || [])].map(Number));
  const entries = [];
  for (const k of Object.keys(committedBySeat || {})) {
    const amt = committedBySeat[k];
    if (!Number.isSafeInteger(amt) || amt < 0) throw new TypeError(`sidePots: bad amount for seat ${k}`);
    if (amt > 0) entries.push({ seat: Number(k), amt, live: !folded.has(Number(k)) });
  }
  const live = entries.filter(e => e.live);
  const pots = [];
  let prev = 0;
  if (live.length) {
    for (const level of [...new Set(live.map(e => e.amt))].sort((a, b) => a - b)) {
      let amount = 0;
      for (const e of entries) amount += Math.max(0, Math.min(e.amt, level) - prev);
      pots.push({ amount, eligible: live.filter(e => e.amt >= level).map(e => e.seat).sort((a, b) => a - b) });
      prev = level;
    }
    for (const level of [...new Set(entries.filter(e => e.amt > prev).map(e => e.amt))].sort((a, b) => a - b)) {
      const refund = {};
      let amount = 0;
      for (const e of entries) {
        const part = Math.max(0, Math.min(e.amt, level) - prev);
        if (part > 0) { refund[e.seat] = part; amount += part; }
      }
      pots.push({ amount, eligible: [], refund });
      prev = level;
    }
  } else if (entries.length) {
    // only folded seats put chips in: the live seats (who may have put in nothing) split the dead money
    const liveSeats = Object.keys(committedBySeat).map(Number).filter(s => !folded.has(s)).sort((a, b) => a - b);
    if (liveSeats.length) pots.push({ amount: entries.reduce((t, e) => t + e.amt, 0), eligible: liveSeats });
  }
  return pots;
}

module.exports = { sidePots };
