const q = require('./qalib');
const OUT = '/home/frank/.openclaw/workspace/projects/ping-coldcall/qa/coldcall-v2';
const base = 'http://127.0.0.1:4610/games/coldcall/index.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function shot(page, name, quality = 70) { const p = `${OUT}/${name}.jpg`; await page.screenshot({ path: p, type: 'jpeg', quality }); return p; }
// load a page and wait for the game
async function ready(page, qs) { await page.goto(base + qs); await page.waitForFunction(() => window.CC && CC.ready, null, { timeout: 30000 }); }
module.exports = { ...q, OUT, base, shot, sleep, ready };
