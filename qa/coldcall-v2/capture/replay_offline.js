// Browser-free replay check: applies removed + falls + fresh to the previous grid for every step of every script (base spins and free spins) and
// compares with step.grid, step.hot, the hotIn -> hotOut chain and phone.leads. Same algorithm board.js animates. node replay_offline.js
const E = require(require('path').join(__dirname, '../../../games/coldcall-engine.js'));
let rounds = 0, bad = 0, steps = 0, spins = 0, phones = 0, caps = 0; const why = {};
const fail = (k, x) => { bad++; why[k] = (why[k] || 0) + 1; if (bad < 6) console.log(k, JSON.stringify(x).slice(0, 300)); };
function checkSpin(sp, tag) {
  spins++; let g = sp.grid.slice(), hot = new Set(sp.hotIn);
  for (const s of sp.steps) {
    steps++; const win = new Set(); s.wins.forEach((w) => w.pos.forEach((p) => win.add(p)));
    for (const p of win) if (!s.removed.includes(p)) fail('win not removed', { tag, p });
    const rem = new Set(s.removed); const ng = new Array(30).fill(-1);
    for (let p = 0; p < 30; p++) if (!rem.has(p)) ng[p] = g[p];
    const moved = s.falls.map(([f, t]) => [f, t, g[f]]); for (const [f, t] of moved) { if (rem.has(f)) fail('fall from removed', { f }); }
    const ng2 = new Array(30).fill(-1); for (let p = 0; p < 30; p++) if (!rem.has(p) && !moved.some(([f]) => f === p)) ng2[p] = g[p];
    for (const [f, t, id] of moved) ng2[t] = id; for (const [p, id] of s.fresh) ng2[p] = id;
    if (ng2.join() !== s.grid.join()) fail('step grid replay', { tag }); g = s.grid.slice();
    win.forEach((p) => hot.add(p)); if ([...hot].sort((a, b) => a - b).join() !== s.hot.join()) fail('hot', { tag, mine: [...hot], s: s.hot });
    // my "fresh" count per column matches the empty cells above
    const nf = new Array(6).fill(0); s.fresh.forEach(([p]) => nf[p % 6]++); for (let c = 0; c < 6; c++) { const empties = s.removed.filter((p) => p % 6 === c).length; if (nf[c] !== empties) fail('fresh count', { c }); }
  }
  if (sp.phone) { phones++; const ph = sp.phone; const last = sp.steps.length ? sp.steps[sp.steps.length - 1].hot : sp.hotIn; if (ph.leads.join() !== last.join()) fail('leads', { tag }); }
}
for (let seed = 1; seed <= 6000; seed++) {
  const buy = [null, null, null, 'call', 'bonus1', 'bonus2', 'hunt'][seed % 7]; const force = !buy && seed % 5 === 0 ? ['bonus1', 'bonus2', 'bonus3', 'phone', 'close', 'big', 'tease'][(seed / 5) % 7 | 0] : undefined;
  const r = E.resolveRound(E.rngFrom(seed * 7919), buy, force ? { force } : undefined); rounds++; if (r.capped) caps++;
  const S = r.script; if (S.spin) checkSpin(S.spin, 'base'); if (S.bonus) { let prevOut = []; S.bonus.spins.forEach((sp, i) => { if (i && sp.hotIn.join() !== prevOut.join()) fail('hotIn chain', { i }); prevOut = sp.hotOut; checkSpin(sp, 'bonus'); }); }
}
console.log({ rounds, spins, steps, phones, caps, bad, why });
