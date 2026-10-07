// layout-shift check: compares the rects json of the paint and nopaint runs. usage: node paint_shift.js <dir>   prints every box that moved or resized by more than 0.6 px
// ignored: boxes animated or re-rendered by the game itself, not by paint.css (#spin breathes, #cap height follows the caption text, #plBn and the gain-state #plNote are mid entry animation)
const IGN = ['#spin', '#cap', '#plBn']; const fs = require('fs'), path = require('path'); const D = path.resolve(process.argv[2]); let bad = 0, n = 0;
for (const f of fs.readdirSync(D).filter((f) => f.endsWith('_paint.json'))) { const g = f.replace('_paint.json', '_nopaint.json'); if (!fs.existsSync(path.join(D, g))) continue; n++;
  const a = JSON.parse(fs.readFileSync(path.join(D, f))).rects, b = JSON.parse(fs.readFileSync(path.join(D, g))).rects;
  for (const k of Object.keys(a)) if (!IGN.includes(k) && !(k === '#plNote' && /^gain/.test(f)) && b[k] && a[k].some((x, i) => Math.abs(x - b[k][i]) > 0.6)) { bad++; console.log(f.replace('_paint.json', ''), k, 'paint', a[k].join(','), 'nopaint', b[k].join(',')); } }
console.log(n, 'pairs compared,', bad, 'boxes shifted');
