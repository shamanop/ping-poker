const q = require('./qalib');
const OUT = '/home/frank/.openclaw/workspace/projects/ping-coldcall/qa/coldcall-skin';
const base = 'http://127.0.0.1:4610/games/coldcall/index.html';
async function shot(page, name, quality = 74) { const p = `${OUT}/${name}.jpg`; await page.screenshot({ path: p, type: 'jpeg', quality }); return p; }
module.exports = { ...q, OUT, base, shot };
