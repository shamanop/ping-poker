'use strict';
// OWNER: engine builder. Pure side-pot layering.

// committedBySeat: { [seat]: amount } (what each seat has in the pots, uncalled returns already removed)
// foldedSeats: array or Set of seat numbers that cannot win.
// -> [{ amount, eligible: [seat, ...] }] lowest layer first. Layers are cut at the distinct commitments
// of the seats still in. A folded seat's chips stay in every layer they reach; chips a folded seat put in
// above the highest live commitment (only reachable through foldOut) join the top pot.
function sidePots(committedBySeat, foldedSeats) {
  const folded = new Set([...(foldedSeats || [])].map(Number));
  const entries = [];
  for (const k of Object.keys(committedBySeat || {})) {
    const amt = committedBySeat[k];
    if (!Number.isSafeInteger(amt) || amt < 0) throw new TypeError(`sidePots: bad amount for seat ${k}`);
    if (amt > 0) entries.push({ seat: Number(k), amt, live: !folded.has(Number(k)) });
  }
  const live = entries.filter(e => e.live);
  const levels = [...new Set(live.map(e => e.amt))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const e of entries) amount += Math.max(0, Math.min(e.amt, level) - prev);
    const eligible = live.filter(e => e.amt >= level).map(e => e.seat).sort((a, b) => a - b);
    pots.push({ amount, eligible });
    prev = level;
  }
  if (pots.length) {
    let extra = 0;
    for (const e of entries) extra += Math.max(0, e.amt - prev);
    pots[pots.length - 1].amount += extra;
  }
  return pots;
}

module.exports = { sidePots };
