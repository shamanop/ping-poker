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
  const names = ['Ann', 'Bob', 'Cy', 'Dee'];
  const cs = names.map(n => new C(n));
  await Promise.all(cs.map(c => c.conn()));
  const start = {}; const b0 = bankFile();
  for (const n of names) start[n.toLowerCase()] = (b0[n.toLowerCase()] ?? 10000);
  for (const c of cs) { c.s.emit('join_game', { name: c.name, avatar: 'x', password: 'ping' }); await sleep(150); }
  console.log('start', start, 'after join', bankFile());
  cs.forEach(c => c.policy = 'rand');
  cs[0].s.emit('start_game', { roomId: ROOM });
  const log = [];
  let rebuys = 0, left = false, lastHand = -1;
  const shoveAt = { 3: ['Dee', 'Ann'], 6: ['Bob', 'Dee'], 9: ['Ann', 'Bob'] };
  const t0 = Date.now();
  while (Date.now() - t0 < 600000) {
    await sleep(100);
    const g = cs[0].gs; if (!g) continue;
    if (g.status === 'playing') continue;
    if (g.handNum === lastHand) continue;
    lastHand = g.handNum; await sleep(300);
    const chips = Object.fromEntries(g.players.map(p => [p.name, p.chips]));
    console.log('hand', g.handNum, 'ended', g.status, JSON.stringify(chips));
    // rebuy for busted (first two), third bust stays out
    for (const c of cs) { const me = c.me(); if (c.dead || !me || me.chips > 0) continue;
      if (rebuys < 2) { c.s.emit('rebuy', { roomId: ROOM }); rebuys++; console.log('  rebuy by', c.name); await sleep(200); }
      else console.log('  bust (no rebuy):', c.name); }
    if (g.handNum === 7 && !left) { const cy = cs[2]; console.log('  Cy leaves w/ chips', cy.me() && cy.me().chips); cy.dead = true; cy.s.disconnect(); left = true; await sleep(500); }
    // set policies for next hand
    cs.forEach(c => c.policy = 'rand');
    const sh = shoveAt[g.handNum + 1]; if (sh) { cs.forEach(c => { if (sh.includes(c.name)) c.policy = 'shove'; else c.policy = 'call'; }); console.log('  next hand shove:', sh); }
    if (g.handNum >= 13) break;
  }
  // let the in-progress hand finish, then freeze
  cs.forEach(c => c.policy = 'call');
  for (let i = 0; i < 300; i++) { const g = cs[0].gs; if (g.status !== 'playing') break; await sleep(100); }
  await sleep(1200);
  console.log('final hand', cs[0].gs.handNum, cs[0].gs.status);
  const s = await snapshot('final', cs, start);
  console.log(JSON.stringify(s, null, 1));
  fs.writeFileSync(DIR + '/snap1.json', JSON.stringify({ s, start }, null, 1));
  console.log('errors', cs.map(c => c.name + ':' + c.errors.join('|')));
  process.exit(0);
})();
