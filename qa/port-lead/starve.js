'use strict';
// Lead check for critic r2 MAJOR ('recap_get on a large legacy table starves the event loop'), after the critic's own seed + probe.
//   node qa/port-lead/starve.js seed <dataDir> [hands=6000]     one POKERPING session of that many hands, then start the server on that DATA_DIR
//   node qa/port-lead/starve.js probe <port> [askers=3]         bystander get_leaderboard round-trips, idle and while the askers request the recap
// HOLDS = under load the bystander's median stays under 25 ms and its worst under 250 ms, and one recap holds at most RECAP_HANDS hands.
const fs = require('fs'), path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
if (process.argv[2] === 'seed') {
  const dir = process.argv[3], N = Number(process.argv[4] || 6000), now = Date.now(), out = [];
  fs.mkdirSync(dir, { recursive: true });
  for (let n = 1; n <= N; n++) {
    const ps = Array.from({ length: 6 }, (_, i) => { const k = 'seed' + ((n + i) % 12); return { key: k, name: k, seat: i, start: 1000, cards: ['A♠', 'K♠'], bet: 100, net: i ? -100 : 500, end: 1000, shown: i < 2 ? [true, true] : undefined, hand: i < 2 ? 'Pair' : undefined }; });
    const acts = Array.from({ length: 14 }, (_, i) => ({ k: ps[i % 6].key, street: 'preflop', a: i % 3 ? 'call' : 'raise', put: 10, to: 10, pot: 10 * i }));
    out.push(JSON.stringify({ t: now - 60000 - (N - n) * 30000, tableId: 'POKERPING', nightId: null, mode: 'chips', unit: 'chips', handNo: n, handNum: n, sb: 5, bb: 10, players: ps, actions: acts, board: ['2♠', '3♠', '4♠', '5♠', '6♠'], pot: 600, showdown: true, winners: [{ key: ps[0].key, name: ps[0].key, amount: 600, handName: 'Pair' }] }));
  }
  fs.writeFileSync(path.join(dir, 'recap-hands.jsonl'), out.join('\n') + '\n');
  console.log('seeded', N, 'hands,', (fs.statSync(path.join(dir, 'recap-hands.jsonl')).size / 1e6).toFixed(1), 'MB'); process.exit(0);
}
const { io } = require('socket.io-client');
const { RECAP_HANDS } = require('../../recap.js');
const port = Number(process.argv[3]), N = Number(process.argv[4] || 3), tag = String(process.pid % 10000);
function sock(name) {
  const s = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], forceNew: true, reconnection: false });
  const b = { s, replies: 0, authed: false, last: null };
  s.on('recap_data', d => { b.replies++; if (d && d.hands) b.last = d; });
  s.on('connect', () => s.emit('auth_signup', { name, pin: '1234', avatar: 'a01' }));
  s.on('auth_ok', () => { b.authed = true; });
  return b;
}
(async () => {
  const P = sock('Probe' + tag), askers = []; for (let i = 0; i < N; i++) askers.push(sock('Ask' + i + 'x' + tag));
  await sleep(2500);
  if (!P.authed || askers.some(a => !a.authed)) { console.log('sign-up failed'); process.exit(2); }
  const probe = () => new Promise(r => { const t = Date.now(), to = setTimeout(() => r(15000), 15000); P.s.once('leaderboard_data', () => { clearTimeout(to); r(Date.now() - t); }); P.s.emit('get_leaderboard'); });
  const run = async (label, asking) => {
    const lat = [], t0 = Date.now();
    const ask = asking ? setInterval(() => { for (const a of askers) a.s.emit('recap_get', { tableId: 'POKERPING' }); }, 400) : null;
    while (Date.now() - t0 < 10000) { lat.push(await probe()); await sleep(150); }
    if (ask) clearInterval(ask);
    lat.sort((a, b) => a - b);
    const r = { median: lat[lat.length >> 1], p90: lat[Math.floor(lat.length * 0.9)], max: lat[lat.length - 1], n: lat.length };
    console.log(`${label}: leaderboard round-trip ms median ${r.median} p90 ${r.p90} max ${r.max} (n=${r.n})`); return r;
  };
  await run('idle', false);
  const r = await run(`${N} sockets asking for the recap every 400 ms`, true);
  await sleep(1500);
  const got = askers.find(a => a.last), replies = askers.reduce((s, a) => s + a.replies, 0), each = askers.map(a => a.replies).join(',');
  const hands = got ? got.last.hands.length : -1, mb = got ? (JSON.stringify(got.last).length / 1e6).toFixed(2) : '?';
  console.log(`recap replies ${replies} (per asker ${each}); one recap: ${hands} hands, ${mb} MB, notes: ${got ? JSON.stringify(got.last.notes).slice(0, 260) : ''}`);
  const bad = [];
  if (r.median >= 25) bad.push('median ' + r.median); if (r.max >= 250) bad.push('max ' + r.max);
  if (hands < 1 || hands > RECAP_HANDS) bad.push('hands ' + hands); if (askers.some(a => !a.replies)) bad.push('an asker got no reply');
  console.log(bad.length ? 'DOES NOT HOLD: ' + bad.join(', ') : 'HOLDS'); process.exit(bad.length ? 1 : 0);
})();
