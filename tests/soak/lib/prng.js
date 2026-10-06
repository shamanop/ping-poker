'use strict';
// mulberry32: one seeded PRNG for every choice the soak makes. No dependency.
function mulberry32(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = () => next();
  rng.int = (n) => Math.floor(next() * n);                 // 0..n-1
  rng.range = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));   // lo..hi inclusive
  rng.chance = (p) => next() < p;
  rng.pick = (arr) => arr[Math.floor(next() * arr.length)];
  // entries: [[weight, value], ...]
  rng.weighted = (entries) => {
    const total = entries.reduce((n, e) => n + e[0], 0);
    let x = next() * total;
    for (const [w, v] of entries) { x -= w; if (x < 0) return v; }
    return entries[entries.length - 1][1];
  };
  return rng;
}
module.exports = { mulberry32 };
