// the 10-cent-and-up transcript digest: the new engine must produce exactly the old engine's playRound results at every bet >= 10 (bit for bit)
module.exports = function transcriptDigest(E, crypto) {
  const h = crypto.createHash('sha256');
  const BETS = [10, 20, 50, 100, 200, 500, 1000, 2500];
  const proj = (r) => [r.status, r.winTenths, r.costTenths, r.betCents, r.callback, r.buy, r.script, r.newState, r.pull, r.partial,
    r.pending ? (r.pending.k === 'more' ? [r.pending.k, r.pending.W, r.pending.mult, r.pending.pWin, r.pending.capT] : r.pending) : null];
  for (let seed = 1; seed <= 36; seed++) {
    const main = E.rngFrom(seed), pick = E.rngFrom(seed * 1000 + 7);
    let st = E.newState(), now = 1e6, dayN = 6;
    for (let i = 0; i < 160; i++) {
      now += i % 31 === 30 ? 40 * 3600000 : 2000; if (i % 40 === 39) dayN++;
      const day = '2026-10-' + String(dayN).padStart(2, '0');
      const bet = BETS[Math.floor(pick() * 8)], buy = pick() < 0.12 ? E.BUYS[Math.floor(pick() * 4)] : null;
      const withDecide = i % 25 !== 0, flip = pick() < 0.5, take = pick() < 0.5;
      const decide = withDecide ? (pt) => (pt.k === 'pick' ? { k: 'pick', p: pt.choices[flip ? 0 : pt.choices.length - 1] } : { k: 'more', take }) : undefined;
      const tape = []; let ti = 0; const rng = () => { if (ti < tape.length) return tape[ti++]; const v = main(); tape.push(v); ti++; return v; };
      const decisions = []; let r;
      for (let g = 0; g < 6; g++) {
        ti = 0;
        r = E.playRound(rng, { buy, bet, state: JSON.parse(JSON.stringify(st)), now, day, script: i % 2 === 0, decide }, decisions.slice());
        h.update(JSON.stringify(proj(r)));
        if (r.status !== 'pending') break;
        decisions.push(r.pending.k === 'pick' ? { k: 'pick', p: r.pending.choices[g % 2 ? r.pending.choices.length - 1 : 0] } : { k: 'more', take: g % 2 === 0 });
      }
      st = r.newState || st;
    }
  }
  return h.digest('hex');
};
