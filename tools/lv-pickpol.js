'use strict';
// Which pick heuristic is best? Bonus1/bonus2 bought, common random numbers (pick consumes the same rng for every choice). node tools/lv-pickpol.js [runs=100000] [cfg json] [kind=bonus1]
const Eng = require('../games/coldcall-engine.js');
const merged = (a, b) => { const o = Array.isArray(a) ? a.slice() : Object.assign({}, a); for (const k of Object.keys(b)) o[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) ? merged(o[k], b[k]) : b[k]; return o; };
const runs = +process.argv[2] || 100000, cfg = merged(Eng.CFG, JSON.parse(process.argv[3] || '{}')), kind = process.argv[4] || 'bonus1', e = Eng.createEngine(cfg);
const nb = (p, set) => { const r = (p / 6) | 0, c = p % 6; const L = []; if (r > 0) L.push(p - 6); if (c > 0) L.push(p - 1); if (c < 5) L.push(p + 1); if (r < 4) L.push(p + 6); return L.filter((q) => set.has(q)); };
const argmax = (ch, f) => { let b = ch[0], bv = -1e9; for (const p of ch) { const v = f(p); if (v > bv) { bv = v; b = p; } } return b; };
const POL = {
  first: (ch) => ch[0], last: (ch) => ch[ch.length - 1],
  deg: (ch) => { const s = new Set(ch); return argmax(ch, (p) => nb(p, s).length); },
  deg2: (ch) => { const s = new Set(ch); return argmax(ch, (p) => nb(p, s).length * 10 + nb(p, s).reduce((a, q) => a + nb(q, s).length, 0)); },
  leastdeg: (ch) => { const s = new Set(ch); return argmax(ch, (p) => -nb(p, s).length); },
  center: (ch) => argmax(ch, (p) => -(Math.abs((p / 6 | 0) - 2) + Math.abs(p % 6 - 2.5))),
  edge: (ch) => argmax(ch, (p) => (Math.abs((p / 6 | 0) - 2) + Math.abs(p % 6 - 2.5))),
};
for (const [name, f] of Object.entries(POL)) {
  const rng = Eng.rngFrom(77); let sum = 0, sq = 0, n = 0;
  for (let i = 0; i < runs; i++) { const r = e.playRound(rng, { buy: kind, bet: 100, state: null, script: false, auto: true, decide: (pt) => (pt.k === 'pick' ? { k: 'pick', p: f(pt.choices) } : null) }, []); sum += r.winTenths; sq += r.winTenths * r.winTenths; n++; }
  const m = sum / n, sd = Math.sqrt(sq / n - m * m); console.log(name.padEnd(9), (m / 10).toFixed(1), '+-' + (1.96 * sd / Math.sqrt(n) / 10).toFixed(1));
}
