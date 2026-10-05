'use strict';
const fs = require('fs'), path = require('path');
const { io } = require('/home/isabelle/.cache/node_modules/socket.io-client');
const PORT = 3112, ROOM = 'POKERPING', DIR = __dirname;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const bankFile = () => JSON.parse(fs.readFileSync(DIR + '/bank.json', 'utf8'));
const ledgerFile = () => JSON.parse(fs.readFileSync(DIR + '/ledger.json', 'utf8'));
async function api(q) { const r = await fetch(`http://127.0.0.1:${PORT}/api/bank-summary?${q}`); const t = await r.text(); return { status: r.status, body: t }; }
class C {
  constructor(name) { this.name = name; this.gs = null; this.errors = []; this.busts = []; this.joined = false;
    this.s = io(`http://127.0.0.1:${PORT}`, { transports: ['websocket'], forceNew: true, reconnection: false });
    this.s.on('game_state', g => { this.gs = g; this.handle(g); });
    this.s.on('error', e => this.errors.push(e.message));
    this.s.on('room_joined', () => this.joined = true);
    this.s.on('bust_out', d => this.busts.push(d));
    this.policy = 'call';
  }
  conn() { return new Promise(r => this.s.once('connect', r)); }
  me() { return this.gs && this.gs.players.find(p => p.name === this.name); }
  handle(gs) {
    if (this.dead || this.policy === 'none') return;
    const idx = gs.players.findIndex(p => p.name === this.name);
    if (gs.status !== 'playing' || idx < 0 || gs.currentPlayerIdx !== idx) return;
    const me = gs.players[idx]; const key = [gs.handNum, gs.street, gs.currentBet, gs.pot, me.chips].join('|');
    if (this.lk === key) return; this.lk = key;
    const tc = gs.currentBet - me.roundBet; let a;
    if (this.policy === 'shove') a = me.chips > tc ? ['raise', 1e9] : ['call'];
    else if (this.policy === 'rand') { const r = Math.random(); if (tc > 0) a = r < .15 ? ['fold'] : r < .3 && me.chips > tc + 100 ? ['raise', gs.currentBet + gs.bb * 3] : ['call']; else a = r < .15 && me.chips > 100 ? ['raise', gs.currentBet + gs.bb * 2] : ['check']; }
    else a = tc > 0 ? ['call'] : ['check'];
    setTimeout(() => { if (!this.dead) this.s.emit('player_action', { roomId: ROOM, action: a[0], amount: a[1] }); }, 20);
  }
}
async function waitHands(cs, n, ms = 120000) {
  const start = Math.max(...cs.map(c => c.gs ? c.gs.handNum : 0)); const t0 = Date.now();
  while (Date.now() - t0 < ms) { const g = cs[0].gs; if (g && g.handNum >= start + n && g.status !== 'playing') return true; await sleep(50); }
  return false;
}
async function settle(c) { for (let i = 0; i < 200; i++) { if (c.gs && c.gs.status !== 'playing') { await sleep(400); return; } await sleep(50); } }
async function snapshot(label, cs, start) {
  await sleep(600);
  const bank = bankFile(), led = ledgerFile();
  const a = await api('password=ping');
  const sum = JSON.parse(a.body);
  const g = (cs.find(c => !c.dead && c.gs) || {}).gs;
  const out = { label, status: g && g.status, handNum: g && g.handNum, pot: g && g.pot, rows: [] };
  let totalNet = 0;
  for (const c of cs) {
    const k = c.name.toLowerCase();
    const tp = g && g.players.find(p => p.name === c.name);
    const atTable = tp ? tp.chips : 0;
    const expectedNet = bank[k] + atTable - start[k];
    const sp = sum.players.find(p => p.name === c.name);
    out.rows.push({ name: c.name, bank: bank[k], atTable, start: start[k], expectedNet, apiNet: sp && sp.net, apiBank: sp && sp.bank, apiAtTable: sp && sp.atTable, status: sp && sp.status, totalBuyIns: sp && sp.totalBuyIns, buyIns: sp && sp.buyIns, rebuys: sp && sp.rebuys, rebuyTotal: sp && sp.rebuyTotal, cashedOut: sp && sp.cashedOut, hands: sp && sp.handsPlayed, bestWin: sp && sp.biggestWin });
    totalNet += sp ? sp.net : 0;
  }
  out.sumApiNet = totalNet; out.sumExpectedNet = out.rows.reduce((s, r) => s + r.expectedNet, 0);
  out.maxHand = sum.maxHand; out.events = sum.events.length; out.seriesKeys = Object.keys(sum.series);
  return out;
}
(async () => {
  const names = ['Ann', 'Bob', 'Dee'];
  const cs = names.map(n => new C(n));
  await Promise.all(cs.map(c => c.conn()));
  const b0 = bankFile(); const start = {ann:10000,bob:10000,cy:10000,dee:10000};
  for (const c of cs) { c.s.emit('join_game', { name: c.name, avatar: 'x', password: 'ping' }); await sleep(150); }
  console.log('bank after join', bankFile());
  cs.forEach(c => c.policy = 'rand');
  cs[0].s.emit('start_game', { roomId: ROOM });
  let last = -1, n = 0;
  while (n < 4) { await sleep(100); const g = cs[0].gs; if (!g || g.status === 'playing' || g.handNum === last) continue; last = g.handNum; n++; console.log('hand', g.handNum, g.status, JSON.stringify(Object.fromEntries(g.players.map(p => [p.name, p.chips])))); }
  await sleep(1000);
  const a = await api('password=ping'); fs.writeFileSync(DIR + '/api.run2.json', a.body);
  const sum = JSON.parse(a.body);
  console.log('maxHand', sum.maxHand, 'series Ann', JSON.stringify(sum.series.Ann), 'Ann.handsPlayed', sum.players.find(p=>p.name==='Ann').handsPlayed);
  // start a new hand and hard-kill the server mid-hand
  while (cs[0].gs.status !== 'playing') await sleep(50);
  await sleep(300);
  console.log('mid-hand chips (kill -9 next)', JSON.stringify(Object.fromEntries(cs[0].gs.players.map(p => [p.name, p.chips]))), 'pot', cs[0].gs.pot, 'hand', cs[0].gs.handNum);
  fs.writeFileSync(DIR + '/midhand.json', JSON.stringify({ chips: cs[0].gs.players.map(p => [p.name, p.chips]), pot: cs[0].gs.pot, bank: bankFile() }));
  process.exit(0);
})();
