'use strict';
// FINAL TEST A phase 1: 5 scripted socket.io players, 20+ hands. Report-only, own server on :3111.
const fs = require('fs'), path = require('path');
const { io } = require('/home/isabelle/.cache/node_modules/socket.io-client');

const DIR = __dirname;
const BANK = path.join(DIR, 'bank.json');
const URL = 'http://127.0.0.1:3111';
const ROOM = 'POKERPING', PASS = 'ping';
const BASE_BANK = 7000; // testplayer in the copied bank.json
const NAMES = ['Ann', 'Bob', 'Cat', 'Dan', 'Eve'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LOG = fs.createWriteStream(path.join(DIR, 'phase1.log'));
const t00 = Date.now();
const log = (...a) => { const s = `[${((Date.now() - t00) / 1000).toFixed(1)}s] ` + a.join(' '); console.log(s); LOG.write(s + '\n'); };

const R = { checks: [], hands: [], issues: [], errorsSeen: [] };
function check(id, ok, evidence) { R.checks.push({ id, ok, evidence }); log(`CHECK ${ok ? 'PASS' : 'FAIL'} ${id}: ${evidence}`); }
function issue(sev, title, detail) { R.issues.push({ sev, title, detail }); log(`ISSUE [${sev}] ${title} :: ${detail}`); }

// ── hand evaluator (independent of server) ──
const RV = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };
function score5(cs) {
  const v = cs.map(c => RV[c.rank]).sort((a, b) => b - a);
  const flush = cs.every(c => c.suit === cs[0].suit);
  let st = 0;
  if (new Set(v).size === 5) { if (v[0] - v[4] === 4) st = v[0]; else if (v.join() === '14,5,4,3,2') st = 5; }
  const cnt = {}; v.forEach(x => cnt[x] = (cnt[x] || 0) + 1);
  const g = Object.entries(cnt).map(([x, c]) => [c, +x]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  let cat;
  if (st && flush) cat = 8; else if (g[0][0] === 4) cat = 7; else if (g[0][0] === 3 && g[1][0] === 2) cat = 6;
  else if (flush) cat = 5; else if (st) cat = 4; else if (g[0][0] === 3) cat = 3;
  else if (g[0][0] === 2 && g[1][0] === 2) cat = 2; else if (g[0][0] === 2) cat = 1; else cat = 0;
  return [cat, ...(st ? [st] : g.map(x => x[1]))];
}
const cmp = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; } return 0; };
function combos(arr, k, s = 0, cur = [], out = []) {
  if (cur.length === k) { out.push([...cur]); return out; }
  for (let i = s; i < arr.length; i++) { cur.push(arr[i]); combos(arr, k, i + 1, cur, out); cur.pop(); }
  return out;
}
function best7(cards) { let b = null; for (const f of combos(cards, 5)) { const s = score5(f); if (!b || cmp(s, b) > 0) b = s; } return b; }

// ── clients ──
const clients = {};
const distinct = new Set();
class C {
  constructor(name) {
    this.name = name; this.gs = null; this.cards = []; this.errors = []; this.dead = false; this.busts = []; this.joined = false;
    this.sock = io(URL, { transports: ['websocket'], forceNew: true, reconnection: false });
    this.sock.on('game_state', gs => { this.gs = gs; if (this === obs()) onState(gs); });
    this.sock.on('your_cards', d => { this.cards = d.cards; this.myIdx = d.myIdx; });
    this.sock.on('error', e => { this.errors.push(e && e.message); R.errorsSeen.push({ who: name, msg: e && e.message, t: Date.now() - t00 }); });
    this.sock.on('showdown_result', d => { if (this === obs()) onShowdown(d); });
    this.sock.on('bust_out', d => { this.busts.push(d); onBust(this); });
    this.sock.on('room_joined', d => { this.joined = true; this.joinInfo = d; });
    this.sock.on('room_update', d => { if (this === obs()) { lastRoomUpdate = d; roomUpdates.push({ t: Date.now() - t00, hostName: d.hostName, players: d.players.map(p => p.name) }); } });
    this.sock.on('balance_update', d => { this.balance = d.balance; });
  }
  connect() { return new Promise((res, rej) => { this.sock.once('connect', res); this.sock.once('connect_error', rej); }); }
  join() { distinct.add(this.name.toLowerCase()); this.sock.emit('join_game', { name: this.name, avatar: 'x', password: PASS }); }
  act(action, amount) { this.sock.emit('player_action', { roomId: ROOM, action, amount }); }
  kill() { this.dead = true; this.sock.disconnect(); }
}
let lastRoomUpdate = null; const roomUpdates = [];
const alive = () => Object.values(clients).filter(c => !c.dead);
function obs() { return alive().find(c => c.gs) || alive()[0]; }
const byName = n => clients[n];

function readBank() {
  for (let i = 0; i < 5; i++) {
    try { return JSON.parse(fs.readFileSync(BANK, 'utf8')); } catch { }
  }
  return null;
}
const bankSum = () => { const b = readBank(); return b ? Object.values(b).reduce((a, c) => a + c, 0) : NaN; };
const expectedTotal = () => BASE_BANK + 10000 * distinct.size;

// ── plan ──
function modeFor(hn) {
  if (hn === 1) return 'checkdown';
  if (hn === 4) return 'foldwin';
  if ([5, 8, 12].includes(hn)) return 'shove';
  if ([2, 3].includes(hn)) return 'random';
  return 'mixed';
}

let H = null, curHandNum = 0, hn = 0, lastSig = '', baseline = null; const adjusts = [];
let leave1Done = false, leave2Done = false, hostLeaveDone = false, finalLeaveDone = false, idleDone = false, sitoutDone = false, sitoutBack = false;
let negDone = false;
let firstBustViaBustOut = true; const rebuyPending = new Set(); const rebuyLog = [];
let restartHn = 0, restarted = false, phase = 1, hostAfterHandoff = null;
const decisionKeys = new Set();
let lastStateAt = Date.now();
const sideHands = []; let busts = 0, allIns = 0;

function newHand(gs) {
  hn++; curHandNum = gs.handNum;
  H = { n: hn, serverHandNum: gs.handNum, startPre: {}, contrib: {}, cardCount: {}, t0: Date.now(), ended: false, raised: false, mode: modeFor(hn), actions: [], players: gs.players.map(p => p.name), dealerIdx: gs.dealerIdx, left: new Set(), rebuyShift: {}, showdown: null, idle: null, sbbb: gs.sb + '/' + gs.bb };
  for (const p of gs.players) { H.startPre[p.name] = p.chips + p.roundBet; H.contrib[p.name] = p.roundBet; H.cardCount[p.name] = p.cardCount; }
  baseline = gs.players.reduce((a, p) => a + p.chips, 0) + gs.pot;
  adjusts.length = 0;
  log(`HAND #${hn} (server ${gs.handNum}) mode=${H.mode} dealer=${gs.players[gs.dealerIdx].name} stacks=` + gs.players.map(p => `${p.name}:${p.chips + p.roundBet}${p.sittingOut ? '(out)' : ''}${p.connected ? '' : '(dc)'}`).join(' ') + ` pot=${gs.pot}`);
  if (sitoutDone && !sitoutBack && hn === 7) {
    const c = gs.players.find(p => p.name === 'Cat');
    check('sit_out: requested player skipped next hand', c.sittingOut && c.cardCount === 0, `hand ${hn}: Cat sittingOut=${c.sittingOut} cardCount=${c.cardCount} stack=${c.chips}`);
    sitoutBack = true; byName('Cat').sock.emit('sit_out', { roomId: ROOM }); log('Cat toggles sit_out back');
  }
  if (sitoutDone && sitoutBack && hn === 8) {
    const c = gs.players.find(p => p.name === 'Cat');
    check('sit_out: toggled back in is dealt in', !c.sittingOut && c.cardCount === 2, `hand ${hn}: Cat sittingOut=${c.sittingOut} cardCount=${c.cardCount}`);
  }
  // rebuy follow-up evidence
  for (const rb of rebuyLog) if (rb.verifyAtHand === hn && !rb.verified) {
    const p = gs.players.find(x => x.name === rb.name);
    rb.verified = true;
    check(`rebuy: ${rb.name} dealt in after rebuy`, p && p.cardCount === 2 && p.chips + p.roundBet > 0, `hand ${hn}: ${rb.name} cardCount=${p && p.cardCount} stack=${p && (p.chips + p.roundBet)} (rebuy via ${rb.path} before hand ${rb.atHand})`);
  }
  if (hn === 6 && !sitoutDone && byName('Cat') && !byName('Cat').dead) { sitoutDone = true; byName('Cat').sock.emit('sit_out', { roomId: ROOM }); log('Cat requests sit_out'); }
}

function inHandConservation(gs) {
  const sum = gs.players.reduce((a, p) => a + p.chips, 0) + gs.pot;
  if (!Number.isInteger(sum) || gs.players.some(p => !Number.isInteger(p.chips) || p.chips < 0)) issue('critical', 'invalid chip values', JSON.stringify(gs.players.map(p => [p.name, p.chips])));
  if (sum !== baseline) {
    const diff = sum - baseline;
    const k = adjusts.indexOf(diff);
    if (k >= 0) { adjusts.splice(k, 1); baseline = sum; }
    else { issue('critical', 'in-hand chip conservation broke', `hand ${hn} street=${gs.street} sum(stacks)+pot=${sum} baseline=${baseline} diff=${diff} pendingAdjusts=${JSON.stringify(adjusts)}`); baseline = sum; }
  }
}

function onState(gs) {
  const sig = JSON.stringify(gs);
  if (sig === lastSig) return; lastSig = sig; lastStateAt = Date.now();
  if (gs.status === 'playing' && gs.handNum !== curHandNum) newHand(gs);
  if (H && !H.ended && (gs.status === 'playing' || gs.status === 'waiting_next') && gs.handNum === curHandNum) {
    if (gs.status === 'playing') inHandConservation(gs);
  }
  // track player contribution via own acts (see decide); detect all-ins
  if (gs.status === 'playing' && H) {
    for (const p of gs.players) if (p.allIn && !H['ai_' + p.name]) { H['ai_' + p.name] = true; allIns++; }
    // leave1 trigger: Eve leaves mid-hand on flop/turn while it's not her turn
    if (hn >= 13 && !leave1Done && (gs.street === 'flop' || gs.street === 'turn')) {
      const victim = gs.players.find((p, i) => p.name === 'Eve' && !p.folded && p.connected && !p.sittingOut && gs.currentPlayerIdx !== i && p.cardCount === 2 && (p.chips > 0 || hn >= 16));
      if (victim && byName('Eve') && !byName('Eve').dead) { leave1Done = true; leaveNow(byName('Eve'), gs, 'mid-hand, not her turn'); }
    }
    // host leaves mid-hand (after leave2)
    if (hn >= 17 && leave1Done && leave2Done && !hostLeaveDone && gs.street !== 'preflop') {
      const hostIdx = gs.players.findIndex(p => p.name === 'Ann');
      const hp = gs.players[hostIdx];
      if (hp && hp.connected && !hp.folded && gs.currentPlayerIdx !== hostIdx && !byName('Ann').dead) { hostLeaveDone = true; leaveNow(byName('Ann'), gs, 'HOST mid-hand'); }
    }
    if (hostLeaveDone && !finalLeaveDone && hn >= 19 && gs.street !== 'preflop') {
      // only two humans left: Bob (new host) and Cat; Cat leaves mid-hand
      const ci = gs.players.findIndex(p => p.name === 'Cat');
      const cp = gs.players[ci];
      if (cp && cp.connected && !cp.folded && gs.currentPlayerIdx !== ci && !byName('Cat').dead) { finalLeaveDone = true; leaveNow(byName('Cat'), gs, 'final leave -> lone player'); }
    }
    scheduleDecision(gs);
  }
  if (gs.status === 'waiting_next' && H && !H.ended && gs.handNum === curHandNum) { H.ended = true; H.endState = gs; setTimeout(() => verifyHand(H, gs), 150); }
  if (gs.status === 'waiting') onWaiting(gs);
  if (gs.status === 'waiting_next') maybeRebuyBetweenHands(gs);
}

function leaveNow(c, gs, why) {
  const idx = gs.players.findIndex(p => p.name === c.name);
  const chips = gs.players[idx].chips;
  const wasHost = c.name === (lastRoomUpdate && lastRoomUpdate.hostName) || c.name === 'Ann';
  log(`LEAVE ${c.name} (${why}) hand ${hn} street ${gs.street} chips=${chips} cur=${gs.players[gs.currentPlayerIdx] && gs.players[gs.currentPlayerIdx].name} pot=${gs.pot}`);
  adjusts.push(-chips);
  H.left.add(c.name);
  H.leftInfo = H.leftInfo || {}; H.leftInfo[c.name] = { chips, street: gs.street };
  const prevRoomUpdates = roomUpdates.length;
  c.kill();
  H['leaveT_' + c.name] = Date.now();
  setTimeout(() => {
    const ru = roomUpdates.slice(prevRoomUpdates);
    log(`  room_update after ${c.name} left: ` + JSON.stringify(ru));
    if (wasHost && c.name === 'Ann') {
      const last = ru[ru.length - 1];
      hostAfterHandoff = last && last.hostName;
      check('host handoff: room_update names a new host when host leaves mid-hand', !!last && last.hostName && last.hostName !== 'Ann', `hand ${hn}: hostName after Ann left = ${JSON.stringify(last && last.hostName)}`);
    }
  }, 600);
}

function scheduleDecision(gs) {
  const i = gs.currentPlayerIdx; if (i === null || i === undefined) return;
  const p = gs.players[i]; const c = byName(p.name);
  if (!c || c.dead || !p.connected) return;
  const key = [gs.handNum, gs.street, gs.currentBet, gs.pot, i, p.chips].join('|');
  if (decisionKeys.has(key)) return; decisionKeys.add(key);

  // idle hand: first decider does nothing -> must be auto-folded by the 30s turn timer
  if (hn === 10 && !idleDone && gs.street === 'preflop') {
    idleDone = true; H.idle = { name: p.name, t: Date.now(), remaining: gs.turnRemainingMs, stackBefore: p.chips };
    log(`IDLE: ${p.name} will not act (turnRemainingMs=${gs.turnRemainingMs}) hand ${hn}`);
    return;
  }
  // leave2: a non-host player disconnects ON THEIR TURN
  if (hn >= 14 && leave1Done && !leave2Done && p.name === 'Dan') {
    leave2Done = true; leaveNow(c, gs, 'on their own turn'); return;
  }
  const d = decide(H.mode, gs, p);
  const delay = 20 + Math.random() * 100;
  // negative probes once
  if (hn === 2 && !negDone && gs.currentBet > p.roundBet) {
    negDone = true; runNegativeProbes(gs, p, c);
  }
  setTimeout(() => {
    if (c.dead) return;
    const live = obs().gs;
    if (!live || live.status !== 'playing' || live.handNum !== gs.handNum) { log(`skip stale action ${p.name}:${d.action} (hand already ended server-side)`); return; }
    // accounting of own chip commitment (exact server formulas)
    const tc = Math.max(0, gs.currentBet - p.roundBet);
    let add = 0;
    if (d.action === 'call') add = Math.min(tc, p.chips);
    else if (d.action === 'raise') { const raiseTo = Math.max(d.amount, gs.currentBet + gs.bb); add = Math.min(raiseTo - p.roundBet, p.chips); }
    H.contrib[p.name] = (H.contrib[p.name] || 0) + add;
    H.actions.push(`${p.name}:${d.action}${d.amount ? '(' + d.amount + ')' : ''}+${add}@${gs.street}`);
    c.act(d.action, d.amount);
  }, delay);
}

function runNegativeProbes(gs, p, c) {
  const i = gs.currentPlayerIdx;
  const other = alive().find(x => x.name !== p.name);
  const n0 = other.errors.length, c0 = c.errors.length;
  other.act('call'); // out of turn
  if (gs.currentBet > p.roundBet) c.act('check');
  c.act('raise', 1.5);
  c.act('raise', 'abc');
  c.act('bogus');
  setTimeout(() => {
    const oe = other.errors.slice(n0), ce = c.errors.slice(c0);
    check('negative: out-of-turn action rejected', oe.includes('Not your turn'), `errors to non-actor: ${JSON.stringify(oe)}`);
    check('negative: illegal check/fractional/NaN/unknown rejected w/o stalling', ce.includes('Cannot check: call, raise or fold') && ce.includes('Raise amount must be a whole number') && ce.includes('Unknown action'), `errors to actor: ${JSON.stringify(ce)}`);
  }, 400);
}

function decide(mode, gs, me) {
  const tc = gs.currentBet - me.roundBet; const r = Math.random();
  const callOrCheck = () => ({ action: tc > 0 ? 'call' : 'check' });
  switch (mode) {
    case 'checkdown': return callOrCheck();
    case 'foldwin':
      if (!H.raised) { H.raised = true; return { action: 'raise', amount: gs.bb * 6 }; }
      return { action: tc > 0 ? 'fold' : 'check' };
    case 'shove':
      if (me.chips > tc && r < 0.7) return { action: 'raise', amount: 1e9 };
      return r < 0.85 ? callOrCheck() : { action: tc > 0 ? 'fold' : 'check' };
    case 'random':
      if (tc > 0) { if (r < 0.12) return { action: 'fold' }; if (r < 0.22 && me.chips > tc + 100) return { action: 'raise', amount: gs.currentBet + gs.bb * (1 + Math.floor(Math.random() * 3)) }; return { action: 'call' }; }
      if (r < 0.15 && me.chips > 100) return { action: 'raise', amount: gs.currentBet + gs.bb * 2 };
      return { action: 'check' };
    default: // mixed
      if (tc > 0 && r < 0.14) return { action: 'fold' };
      if (r < 0.45) return callOrCheck();
      if (r < 0.70) return { action: 'raise', amount: gs.currentBet + gs.bb * (1 + Math.floor(Math.random() * 4)) };
      if (r < 0.85) return { action: 'raise', amount: gs.currentBet + Math.max(gs.bb, Math.floor(gs.pot / 2)) };
      if (r < 0.93 && me.chips > tc) return { action: 'raise', amount: 1e9 };
      return callOrCheck();
  }
}

function onShowdown(d) {
  if (H) H.showdown = d;
}

function sideLayers(contrib, contenders) {
  const lv = [...new Set(Object.values(contrib).filter(x => x > 0))].sort((a, b) => a - b);
  // a side pot exists when >=2 distinct contribution levels are covered by >=2 contenders... count distinct levels among contenders
  const cl = [...new Set(contenders.map(n => contrib[n]))].sort((a, b) => a - b);
  return cl.length;
}

function verifyHand(Hd, gs) {
  const n = Hd.n;
  const sd = Hd.showdown;
  const names = gs.players.map(p => p.name);
  const contrib = Hd.contrib;
  const csum = Object.values(contrib).reduce((a, b) => a + b, 0);
  // contenders per server flags
  const contenders = gs.players.filter(p => !p.folded && !p.sittingOut && p.connected && Hd.cardCount[p.name] === 2).map(p => p.name);
  const info = { n, mode: Hd.mode, pot: sd && sd.pot, contribSum: csum, contenders, actions: Hd.actions.length, durMs: Date.now() - Hd.t0 };
  const fold = sd && sd.winners && sd.winners[0] && sd.winners[0].handName === 'Everyone folded';
  info.type = fold ? 'fold-win' : 'showdown';
  check(`hand ${n}: showdown_result received and pot == my tracked contributions`, !!sd && sd.pot === csum, `hand ${n}: server pot=${sd && sd.pot} my sum of contributions=${csum} (${JSON.stringify(contrib)})`);
  // expected payouts
  const order = names; // seat order
  const pay = {}; names.forEach(x => pay[x] = 0);
  let scores = {};
  const community = gs.community;
  if (!fold) {
    for (const nm of contenders) { const c = byName(nm); const cards = c && c.cards; if (cards && cards.length === 2) scores[nm] = best7([...cards, ...community]); }
    if (Object.keys(scores).length !== contenders.length) issue('medium', 'verifier could not get cards for all contenders', `hand ${n}: ${JSON.stringify(contenders)} vs ${Object.keys(scores)}`);
  }
  const levels = [...new Set(Object.values(contrib).filter(b => b > 0))].sort((a, b) => a - b);
  let prev = 0;
  const layers = [];
  for (const level of levels) {
    const layer = names.reduce((s, nm) => s + Math.max(0, Math.min(contrib[nm] || 0, level) - prev), 0);
    prev = level; if (!layer) continue;
    let pool = contenders.filter(nm => (contrib[nm] || 0) >= level);
    if (!pool.length) pool = contenders;
    let winners;
    if (fold) winners = contenders.slice(0, 1);
    else { let top = scores[pool[0]]; pool.forEach(nm => { if (scores[nm] && cmp(scores[nm], top) > 0) top = scores[nm]; }); winners = pool.filter(nm => scores[nm] && cmp(scores[nm], top) === 0); winners.sort((a, b) => order.indexOf(a) - order.indexOf(b)); }
    const share = Math.floor(layer / winners.length), rem = layer - share * winners.length;
    winners.forEach((w, i) => { pay[w] += share + (i === 0 ? rem : 0); });
    layers.push({ level, layer, winners });
  }
  info.layers = layers.length; info.layerDetail = layers;
  let mismatches = [];
  for (const p of gs.players) {
    if (!p.connected) continue;
    const exp = Hd.startPre[p.name] - (contrib[p.name] || 0) + pay[p.name];
    // stacks of rebuyers mid-hand shift; allow if rebuy happened during this hand (tracked)
    const rebuyShift = (Hd.rebuyShift && Hd.rebuyShift[p.name]) || 0;
    if (p.chips !== exp + rebuyShift) mismatches.push(`${p.name}: server=${p.chips} expected=${exp + rebuyShift} (start ${Hd.startPre[p.name]} contrib ${contrib[p.name] || 0} pay ${pay[p.name]})`);
  }
  check(`hand ${n}: payouts match independent evaluator + side-pot layering`, mismatches.length === 0, mismatches.length ? mismatches.join('; ') : `hand ${n} ${info.type}, pot ${csum}, ${layers.length} layer(s) ${JSON.stringify(layers.map(l => [l.level, l.layer, l.winners]))}, winners server=${sd && JSON.stringify(sd.winners.map(w => w.name + ':' + w.handName))}`);
  const lv2 = sideLayers(contrib, contenders);
  info.sidePot = !fold && contenders.length >= 2 && lv2 > 1 && layers.length > 1;
  if (info.sidePot) sideHands.push(n);
  // bank conservation (quiescent: waiting_next)
  const bs = bankSum(); const stacks = gs.players.reduce((a, p) => a + p.chips, 0);
  const total = bs + stacks + gs.pot;
  info.conservation = { bank: bs, stacks, pot: gs.pot, total, expected: expectedTotal() };
  check(`hand ${n}: chip conservation bank+stacks+pot`, total === expectedTotal(), `hand ${n}: bank ${bs} + stacks ${stacks} + pot ${gs.pot} = ${total}, expected ${expectedTotal()}`);
  info.stacks = gs.players.map(p => `${p.name}:${p.chips}`).join(' ');
  if (Hd.idle) {
    const ip = gs.players.find(p => p.name === Hd.idle.name);
    info.idle = { name: Hd.idle.name, folded: ip.folded, lastAction: ip.lastAction, durMs: info.durMs };
    check('turn timer: idle player auto-folded and hand completed', ip.folded && info.durMs < 60000, `hand ${n}: ${Hd.idle.name} folded=${ip.folded} lastAction=${ip.lastAction}; hand total ${info.durMs}ms; turnRemainingMs at start of turn ${Hd.idle.remaining}`);
  } else {
    check(`hand ${n}: no stall (completed within 25s)`, info.durMs < 25000, `hand ${n} took ${info.durMs}ms from deal to result`);
  }
  R.hands.push(info);
  log(`HAND #${n} DONE ${info.type} pot=${csum} layers=${layers.length} stacks: ${info.stacks}`);
  // note busts
  for (const p of gs.players) if (p.chips === 0 && p.connected && Hd.startPre[p.name] > 0) { busts++; log(`BUST ${p.name} in hand ${n}`); }
}

function onBust(c) {
  // bust_out arrives at next-hand start -> first bust rebuy happens IN-hand via this path
  if (rebuyPending.has(c.name)) return;
  if (!firstBustViaBustOut) return;
  firstBustViaBustOut = false;
  doRebuy(c, 'bust_out event during playing');
}

function doRebuy(c, path) {
  if (rebuyPending.has(c.name)) return;
  rebuyPending.add(c.name);
  setTimeout(() => {
    const b = readBank(); const bal = b[c.name.toLowerCase()];
    const buyIn = Math.min(1500, bal);
    const gs = c.gs;
    const before = gs.players.find(p => p.name === c.name).chips;
    const status = gs.status;
    adjusts.push(buyIn);
    const n0 = c.errors.length;
    c.sock.emit('rebuy', { roomId: ROOM });
    setTimeout(() => {
      rebuyPending.delete(c.name);
      const now = c.gs.players.find(p => p.name === c.name);
      const ok = now && now.chips === buyIn && before === 0;
      rebuyLog.push({ name: c.name, path, atHand: hn, verifyAtHand: hn + 1, buyIn, status });
      check(`rebuy: ${c.name} chips restored (${path})`, ok, `hand ${hn} status=${status}: ${c.name} chips ${before} -> ${now && now.chips} (bank balance was ${bal}, expected buy-in ${buyIn}); errors=${JSON.stringify(c.errors.slice(n0))}`);
      if (!ok) { const k = adjusts.indexOf(buyIn); if (k >= 0) adjusts.splice(k, 1); }
      else if (status === 'playing' && H && !H.ended) { H.rebuyShift[c.name] = (H.rebuyShift[c.name] || 0) + buyIn; }
    }, 350);
  }, 60);
}

function maybeRebuyBetweenHands(gs) {
  for (const p of gs.players) {
    const c = byName(p.name);
    if (!c || c.dead || !p.connected || p.chips !== 0 || rebuyPending.has(p.name)) continue;
    if (firstBustViaBustOut) continue; // first bust waits for bust_out in-hand path
    setTimeout(() => { const cur = byName(p.name); if (cur && !cur.dead && cur.gs.status === 'waiting_next' && cur.gs.players.find(x => x.name === p.name).chips === 0) doRebuy(cur, 'between hands (waiting_next)'); }, 1500);
  }
}

function onWaiting(gs) {
  if (phase === 1 && finalLeaveDone) { handleLoneWaiting(gs); }
  else if (phase === 1) {
    // collapse (everyone but one busted): everybody with 0 chips rebuys, host restarts
    log(`WAITING state (collapse?) hn=${hn}: ` + gs.players.map(p => `${p.name}:${p.chips}${p.connected ? '' : '(dc)'}`).join(' '));
    handleCollapse(gs);
  }
}
let collapseBusy = false;
async function handleCollapse(gs) {
  if (collapseBusy) return; collapseBusy = true;
  await sleep(300);
  issue('info', 'table collapsed to waiting mid-session (only one player had chips)', `hand ${hn}: ${gs.players.map(p => p.name + ':' + p.chips).join(' ')}`);
  for (const p of gs.players) if (p.connected && p.chips === 0) { const c = byName(p.name); if (c && !c.dead) { doRebuy(c, 'waiting after collapse'); await sleep(200); } }
  await sleep(600);
  const host = alive().find(c => c.name === (lastRoomUpdate && lastRoomUpdate.hostName)) || alive()[0];
  host.sock.emit('start_game', { roomId: ROOM });
  log(`collapse restart: ${host.name} emits start_game`);
  await sleep(1500); collapseBusy = false;
}

let loneHandled = false;
async function handleLoneWaiting(gs) {
  if (loneHandled) return; loneHandled = true;
  await sleep(300);
  log('LONE WAITING: ' + gs.players.map(p => `${p.name}:${p.chips}${p.connected ? '' : '(dc)'}`).join(' '));
  const hostName = lastRoomUpdate && lastRoomUpdate.hostName;
  const bobChips = gs.players.find(p => p.name === 'Bob');
  const bs = bankSum();
  const stacks = gs.players.reduce((a, p) => a + p.chips, 0);
  check('lone survivor: stack cashed out to bank, total conserved', bs + stacks === expectedTotal() && bobChips && bobChips.chips === 0, `status=waiting: bank ${bs} + stacks ${stacks} = ${bs + stacks}, expected ${expectedTotal()}; Bob chips=${bobChips && bobChips.chips}; lastRoomUpdate.hostName=${hostName}`);
  // phase 2: Bob (handed-off host) rebuys, Ann & Eve rejoin
  const bob = byName('Bob');
  phase = 2;
  log('PHASE 2: Bob rebuys, Ann and Eve rejoin as fresh sockets');
  const err0 = bob.errors.length;
  doRebuy(bob, 'waiting table (lone survivor)');
  await sleep(700);
  for (const nm of ['Ann', 'Eve']) {
    const c = new C(nm); clients[nm] = c; await c.connect(); c.join();
    await sleep(400);
    check(`rejoin in waiting: ${nm} seated`, c.joined, `room_joined=${c.joined}, errors=${JSON.stringify(c.errors)}`);
  }
  await sleep(300);
  // non-host cannot start; handed-off host can
  const ann = byName('Ann'); const ae0 = ann.errors.length;
  ann.sock.emit('start_game', { roomId: ROOM });
  await sleep(400);
  check('start_game by non-host rejected', ann.errors.slice(ae0).includes('Only host can start'), `Ann errors: ${JSON.stringify(ann.errors.slice(ae0))}`);
  const st0 = obs().gs.status;
  bob.sock.emit('start_game', { roomId: ROOM });
  await sleep(1200);
  check('start_game by handed-off host (Bob) starts a hand', obs().gs.status === 'playing', `status before=${st0} after=${obs().gs.status}; handNum=${obs().gs.handNum}`);
  restarted = true; restartHn = hn;
}

async function main() {
  // pre-flight negative probes
  const bad = new C('Zed'); await bad.connect();
  bad.sock.emit('join_game', { name: 'Zed', avatar: 'x', password: 'wrong' }); await sleep(300);
  check('wrong room password rejected', bad.errors.includes('Incorrect password') && !bad.joined, JSON.stringify(bad.errors)); bad.kill();

  for (const n of NAMES) { const c = new C(n); clients[n] = c; await c.connect(); c.join(); await sleep(150); }
  await sleep(300);
  check('5 players seated', NAMES.every(n => clients[n].joined), NAMES.map(n => `${n}:${clients[n].joined ? clients[n].joinInfo.playerIdx : 'no'}`).join(' '));
  const bk = readBank();
  check('buy-in debited from bank', NAMES.every(n => bk[n.toLowerCase()] === 8500), JSON.stringify(bk));
  // non-host start rejected
  const e0 = clients.Bob.errors.length; clients.Bob.sock.emit('start_game', { roomId: ROOM }); await sleep(300);
  check('start_game by non-host rejected (pre-game)', clients.Bob.errors.slice(e0).includes('Only host can start'), JSON.stringify(clients.Bob.errors.slice(e0)));
  // late join during game
  clients.Ann.sock.emit('start_game', { roomId: ROOM });
  await sleep(500);
  const late = new C('Late'); await late.connect(); late.sock.emit('join_game', { name: 'Late', avatar: 'x', password: PASS }); await sleep(300);
  check('join during a hand rejected', late.errors.includes('Game in progress — wait for next round') && !late.joined, JSON.stringify(late.errors)); late.kill();

  // run until phase 2 has produced 2 hands (hn>=21) or timeout
  const T0 = Date.now(); let p2hands = 0;
  while (Date.now() - T0 < 15 * 60 * 1000) {
    await sleep(500);
    if (Date.now() - lastStateAt > 45000 && obs() && obs().gs && obs().gs.status === 'playing') { issue('critical', 'STALL: no game_state for 45s during playing', `hand ${hn}`); break; }
    if (restarted && R.hands.length >= 1) {
      const done = R.hands.filter(h => h.n > restartHn).length;
      if (done >= 2) break;
    }
  }
  // wrap up: wait for waiting_next, then everyone disconnects
  for (let i = 0; i < 100 && !(obs() && obs().gs && obs().gs.status === 'waiting_next'); i++) await sleep(200);
  await sleep(300);
  const preTotals = (() => { const g = obs().gs; return { stacks: g.players.reduce((a, p) => a + p.chips, 0), bank: bankSum() }; })();
  log('FINAL pre-disconnect: ' + JSON.stringify(preTotals));
  for (const c of alive()) c.kill();
  await sleep(1500);
  const finalBank = readBank();
  const fs_ = Object.values(finalBank).reduce((a, b) => a + b, 0);
  check('final: all disconnected -> everything back in bank, total conserved', fs_ === expectedTotal(), `bank sum ${fs_} expected ${expectedTotal()} :: ${JSON.stringify(finalBank)}`);
  // ledger cross-check
  try {
    const led = JSON.parse(fs.readFileSync(path.join(DIR, 'ledger.json'), 'utf8'));
    const per = {};
    for (const e of led) { if (!['buyin', 'rebuy', 'cashout'].includes(e.type)) continue; const k = e.name.toLowerCase(); per[k] = per[k] || 0; per[k] += e.type === 'cashout' ? e.amount : -e.amount; }
    const bad2 = [];
    for (const n of [...NAMES]) { const k = n.toLowerCase(); const exp = 10000 + (per[k] || 0); if (finalBank[k] !== exp) bad2.push(`${k}: bank ${finalBank[k]} vs ledger-derived ${exp}`); }
    check('ledger: buyin/rebuy/cashout entries reproduce final bank balances', bad2.length === 0, bad2.length ? bad2.join('; ') : `${led.length} entries; ` + JSON.stringify(per));
    const types = {}; led.forEach(e => types[e.type] = (types[e.type] || 0) + 1); log('ledger types ' + JSON.stringify(types));
    R.ledgerTypes = types;
  } catch (e) { issue('medium', 'ledger unreadable', String(e)); }

  const hs = R.hands;
  const showdowns = hs.filter(h => h.type === 'showdown').length, folds = hs.filter(h => h.type === 'fold-win').length;
  const maxDur = Math.max(...hs.filter(h => !h.idle).map(h => h.durMs));
  R.summary = { hands: hs.length, showdowns, folds, sideHands, busts, allIns, maxDurNonIdle: maxDur, rebuyLog, roomUpdates };
  check('>=15 full hands completed', hs.length >= 15, `${hs.length} hands (${showdowns} showdown, ${folds} fold-win)`);
  check('side-pot hands exercised (>=2 contenders at different all-in levels)', sideHands.length >= 1, `hands with side pots: ${JSON.stringify(sideHands)}; all-ins observed ${allIns}`);
  fs.writeFileSync(path.join(DIR, 'phase1-result.json'), JSON.stringify(R, null, 1));
  log('DONE phase 1');
  process.exit(0);
}
main().catch(e => { console.error(e); issue('critical', 'phase1 script crashed', String(e && e.stack)); fs.writeFileSync(path.join(DIR, 'phase1-result.json'), JSON.stringify(R, null, 1)); process.exit(1); });
