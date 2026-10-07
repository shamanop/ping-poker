'use strict';
// Exact lead-list model for THE PULL: spins (paid rounds) from an empty list to the Callback, as a first-passage distribution.
// Needs only the per-round outcome mix (dead / paid / natural bonus) because spins are independent.
//   node tools/pull-model.js '{"list":50,"dead":1.2,"win":0.6,"bonus":0.6,"pd":0.7937,"pb":0.004826}'
// prints mean / P10 / P50 / P90 / sd of spins per Callback, mean fill per spin, and the Callback cost in RTP points for a bonus worth V (x bet).
function model({ list, dead, win, bonus, pd, pb, V = 83.12, carry = true }) {
  const L = Math.round(list * 10), fd = Math.round(dead * 10), fw = Math.round(win * 10), fb = Math.round(bonus * 10);
  const pw = 1 - pd - pb;
  const mean = pd * fd + pw * fw + pb * fb;                 // tenths of a lead per paid spin
  // first passage from lt=0: P(n) = P(lt reaches >= L exactly on spin n)
  let cur = new Float64Array(L).fill(0); cur[0] = 1;
  const pn = [0]; let alive = 1, n = 0, exc = 0, excW = 0;
  while (alive > 1e-12 && n < 100000) {
    const nxt = new Float64Array(L); let done = 0; n++;
    for (let s = 0; s < L; s++) {
      const p = cur[s]; if (!p) continue;
      for (const [f, q] of [[fd, pd], [fw, pw], [fb, pb]]) {
        if (!q || !f) { if (!f) nxt[s] += p * q; continue; }
        const t = s + f; if (t >= L) { done += p * q; exc += p * q * (t - L); excW += p * q; } else nxt[t] += p * q;
      }
    }
    pn.push(done); cur = nxt; alive = cur.reduce((a, b) => a + b, 0);
  }
  let m = 0, m2 = 0, c = 0; const q = {};
  for (let i = 1; i < pn.length; i++) { m += i * pn[i]; m2 += i * i * pn[i]; c += pn[i]; for (const k of [0.1, 0.5, 0.9]) if (q[k] === undefined && c >= k) q[k] = i; }
  const sd = Math.sqrt(m2 - m * m);
  return { meanFillLeadsPerSpin: mean / 10, spinsPerCallback: m, p10: q[0.1], p50: q[0.5], p90: q[0.9], sd, cv: sd / m, callbacksPer1000Spins: 1000 / m, costPts: V / m * 100 };
}
module.exports = { model };
if (require.main === module) console.log(JSON.stringify(model(JSON.parse(process.argv[2])), null, 1));
