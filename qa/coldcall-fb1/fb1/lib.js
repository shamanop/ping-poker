// FB1 driver lib (chris 10-06 FB1): in-page timing of "board settled -> SPIN accepts a click" against any port. Run under flock _scratch/locks/chrome.lock.
const { launch } = require('../../coldcall-v2/capture/qalib');
const io = require('/home/frank/.openclaw/workspace/projects/ping-coldcall-pull/_scratch/sio/node_modules/socket.io-client');
const PIN = '1234';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const uniq = (t) => t + (Date.now() % 1e6).toString(36) + Math.random().toString(36).slice(2, 4);
function sock(port, name) {
  return new Promise((resolve, reject) => {
    const s = io('http://127.0.0.1:' + port, { forceNew: true }); let tried = false;
    s.on('connect', () => s.emit('auth_login', { name, pin: PIN }));
    s.on('auth_error', () => { if (!tried) { tried = true; s.emit('auth_signup', { name, pin: PIN, avatar: 'a01' }); } else reject(new Error('auth')); });
    s.on('auth_ok', () => resolve(s)); setTimeout(() => reject(new Error('sock timeout')), 15000);
  });
}
const sstate = (s) => new Promise((res) => { s.once('g:coldcall:state', res); s.emit('g:coldcall:state', {}); });
async function wallet(port, name) { const s = await sock(port, name); const st = await sstate(s); s.close(); return st.wallet; }
async function open(port, name, q = '', w = 540, h = 960) {
  const b = await launch(w, h), { page } = b;
  await page.goto(`http://127.0.0.1:${port}/games/coldcall/index.html?live=1&nosplash&name=${name}&pin=${PIN}${q}`);
  await page.waitForFunction(() => window.CC && CC.ready && CC.core.st.live, null, { timeout: 30000 });
  await sleep(500); return b;
}
// in-page recorder: one row per round {tStart, tDone (server result done), tWin (WIN meter on the final amount, wins only), tRounds (st.rounds++ = last animation over, pull note next),
// tOff (busy false = SPIN accepts a click), p (what the server sent), fx (pull animations: name, t0, t1)}; all ms from page start
const REC = () => {
  const st = CC.core.st, M = (window.__m = { rows: [], cur: null, rounds: st.rounds, lg: [] }); const now = () => performance.now();
  for (const n of ['leadGain', 'ghost', 'potWin']) { const f = CC.pull[n]; CC.pull[n] = function (...a) { const e = { n, t0: now(), t1: null }; if (n === 'leadGain' && a[0]) e.arg = { before: a[0].leadsBefore, after: a[0].leadsAfter, filled: a[0].filled, armed: !!a[0].armed, daily: !!a[0].daily, leaked: a[0].leaked }; if (M.cur) M.cur.fx.push(e); const r = f.apply(this, a); Promise.resolve(r).finally(() => { e.t1 = now(); }); return r; }; }
  const fin = () => { const k = M.cur; if (!k) return; k.tOff = now(); k.cold = (document.getElementById('plCold') || {}).textContent; M.rows.push(k); M.cur = null; M.rounds = st.rounds; };
  // busy transitions come from a MutationObserver on the SPIN class (never misses an off/on pair that a poll would)
  new MutationObserver(() => { if (st.busy && !M.cur) M.cur = { tStart: now(), tDone: null, tWin: null, tRounds: null, tOff: null, p: null, fx: [] }; if (!st.busy) fin(); }).observe(document.getElementById('spin'), { attributes: true, attributeFilter: ['class'] });
  setInterval(() => {
    const t = now(), k = M.cur; if (!k) return;
    if (st.ctx && st.ctx.p) { const p = st.ctx.p; if (p.status === 'done' && k.tDone == null) k.tDone = t; if (p.status === 'done') { k.p = { id: p.roundId, totalWin: p.totalWin, tier: p.tier, cost: p.cost, pot: p.pot && p.pot.won ? p.pot.amount : 0, ghost: p.pull && p.pull.ghost ? p.pull.ghost.pay : 0, filled: p.pull && p.pull.filled, leadsBefore: p.pull && p.pull.leadsBefore, leadsAfter: p.pull && p.pull.leadsAfter, daily: !!(p.pull && p.pull.daily), leaked: p.pull && p.pull.leaked, armed: !!(p.pull && p.pull.armed), callback: !!p.callback, bonus: !!(p.script && p.script.bonus) }; if (p.totalWin > 0 && st.winShown === p.totalWin && k.tWin == null) k.tWin = t; } }
    if (st.rounds !== M.rounds && k.tRounds == null) { k.tRounds = t; M.rounds = st.rounds; }
  }, 3);
};
const rows = (page) => page.evaluate(() => window.__m.rows);
const idle = (page, ms = 60000) => page.waitForFunction(() => !CC.core.st.busy, null, { timeout: ms });
module.exports = { launch, sock, sstate, wallet, open, REC, rows, idle, sleep, uniq, PIN };
