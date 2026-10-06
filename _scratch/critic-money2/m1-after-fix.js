'use strict';
// FIX M1 repro, kept: the critic's two M1 scripts (m1-buy-pot-chaser.js part 2, m1b-buy-only-pot-part.js) turned into asserts. Run from the root of a slim export:  cd $D && node _scratch/critic-money2/m1-after-fix.js
// A buy feeds no slice, rolls no pot, wins no pot; a plain paid spin on the same pot, with the same forced roll, still wins it.
const assert = require('assert');
const H = require('./h.js'), { E } = H;
for (const [buy, bet, n] of [['hunt', 2500, 3000], ['bonus2', 100, 400], ['bonus1', 100, 400], ['call', 1000, 3000]]) {
  const s = H.setup({ rng: E.rngFrom(41), roundRng: E.rngFrom(42), potRng: E.rngFrom(43), bank: new Map([['buyer', 1e12]]) }), a = s.sock('buyer');
  let cost = 0, pot = 0;
  for (let i = 0; i < n; i++) { const r = H.playOut(s, a, { bet, mode: 'chips', buyBonus: buy }); if (!r || r.error) throw new Error(JSON.stringify(r)); cost += r.cost; if (r.pot) pot += r.pot.amount; a.out.length = 0; }
  const p = s.potOf('chips');
  assert.strictEqual(pot, 0, buy + ': no pot win'); assert.deepStrictEqual([p.fed, p.paid, p.bal, p.rem], [0, 0, 0, 0], buy + ': the pot never moved');
  console.log((buy + ' at ' + bet + 'c x ' + n + ':').padEnd(26) + ' staked ' + cost + 'c, pot fed ' + p.fed + 'c, paid ' + pot + 'c: ok');
}
{ // the same pot at $50 and a roll of 0: the hunt buy gets nothing, the plain $1 spin takes it
  const s = H.setup({ rng: E.rngFrom(7), potRng: () => 0, roundRng: E.rngFrom(8) }), a = s.sock('chaser');
  E.CFG.pull.pot.capCents = 5000; const pot = s.potOf('play'); pot.bal = 5000; pot.fed = 5000; s.store().potChanged();
  const b = H.playOut(s, a, { bet: 100, mode: 'play', buyBonus: 'hunt' }); assert.strictEqual(b.pot, null); assert.deepStrictEqual([pot.bal, pot.fed, pot.paid], [5000, 5000, 0]);
  const p = H.playOut(s, a, { bet: 100, mode: 'play', auto: true }); assert.ok(p.pot && p.pot.amount === 5000, 'plain spin wins'); assert.strictEqual(pot.paid, 5000);
  console.log('hunt buy at a $50 pot with the roll forced: no prize; plain $1 spin: prize 5000: ok');
}
process.exit(0);
