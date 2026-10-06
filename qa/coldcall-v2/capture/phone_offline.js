// Phone feature bookkeeping check: the screen-side state (bubbles + collected closes + upsell hits) must reproduce took / run / pay of the script. node phone_offline.js
const E = require(require('path').join(__dirname, '../../../games/coldcall-engine.js'));
let bad = 0, n = 0;
for (let seed = 1; seed < 400; seed++) {
  const r = E.resolveRound(E.rngFrom(seed), null, { force: seed % 2 ? 'phone' : 'close' }); const sp = r.script.spin; if (!sp || !sp.phone) continue; n++;
  const S = new Map(); const ph = sp.phone; let why = '';
  const sum = () => { let t = 0; S.forEach((s) => { if (s.k === 'b' || (s.k === 'c' && s.collected)) t += s.v; }); return t; };
  ph.rounds.forEach((rd, ri) => {
    rd.reveals.forEach((x) => S.set(x.p, { k: x.k, v: x.v, collected: false }));
    rd.upsells.forEach((u) => u.hits.forEach((h) => { const t = S.get(h.p); if (h.k === 'c' && h.pend) {} else t.v = h.after; }));
    rd.collects.forEach((c) => { let sh = 0; S.forEach((s, p) => { if (p !== c.p && (s.k === 'b' || (s.k === 'c' && s.collected))) sh += s.v; }); if (sh !== c.took) why += ` took ${sh}/${c.took}`; const me = S.get(c.p); me.collected = true; me.v = c.value; if (sum() !== c.run) why += ` run ${sum()}/${c.run}`; });
  });
  if (sum() !== ph.pay) why += ` pay ${sum()}/${ph.pay}`;
  if (why) { bad++; if (bad < 4) console.log(seed, why, JSON.stringify(ph.rounds.map(r => r.reveals.map(x => x.k + x.v)))); }
}
console.log('rounds', n, 'bad', bad);
