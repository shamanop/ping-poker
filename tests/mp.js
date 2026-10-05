'use strict';
// Ping Poker multi-client stress test. REPORT-ONLY: runs a patched-free COPY of server.js
// in a temp dir with a throwaway bank.json. Usage: node tests/mp.js [groupName ...]
const path = require('path'), fs = require('fs'), os = require('os');
const { spawn } = require('child_process');
const { io } = require(process.env.SIO_CLIENT || '/home/isabelle/.cache/node_modules/socket.io-client');

const ROOT = path.join(__dirname, '..');
const ROOM = 'POKERPING', PASS = 'ping';
let portCounter = Number(process.env.BASE_PORT || 4012);
const nextPort = () => portCounter++;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FINDINGS = [];
let HANDS = 0;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function rec(scenario, sev, title, expected, actual, suspect, extra) {
  const key = scenario + '|' + title;
  if (FINDINGS.some(f => f.key === key)) return;
  FINDINGS.push({ key, scenario, sev, title, expected, actual, suspect, extra });
  log(`FINDING [${sev}] ${scenario}: ${title}`);
}

// ─── server harness ──────────────────────────────────────────────────────────
async function startServer(seed = {}) {
  const port = nextPort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppmp-'));
  fs.copyFileSync(path.join(ROOT, 'server.js'), path.join(dir, 'server.js'));
  for (const f of fs.readdirSync(ROOT)) if (f.endsWith('.js') && f !== 'server.js') fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  fs.cpSync(path.join(ROOT, 'games'), path.join(dir, 'games'), { recursive: true });
  fs.symlinkSync(fs.realpathSync(path.join(ROOT, 'node_modules')), path.join(dir, 'node_modules'));
  fs.mkdirSync(path.join(dir, 'public'));
  fs.writeFileSync(path.join(dir, 'bank.json'), JSON.stringify(seed));
  const proc = spawn('node', ['server.js'], { cwd: dir, env: { ...process.env, PORT: String(port), AUTO_START_MS: '600000' } });
  const srv = { port, dir, proc, seed: { ...seed }, out: '', exited: false, clients: [] };
  proc.stdout.on('data', d => { srv.out += d; });
  proc.stderr.on('data', d => { srv.out += d; });
  proc.on('exit', code => { srv.exited = true; srv.exitCode = code; });
  for (let i = 0; i < 100 && !srv.out.includes('running'); i++) await sleep(50);
  if (!srv.out.includes('running')) throw new Error('server did not start: ' + srv.out);
  srv.bank = () => JSON.parse(fs.readFileSync(path.join(dir, 'bank.json'), 'utf8'));
  srv.stop = () => {
    srv.stopped = true;
    for (const c of srv.clients) try { c.sock.close(); } catch {}
    try { proc.kill(); } catch {}
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  };
  return srv;
}

class Client {
  constructor(srv, name) {
    this.srv = srv; this.name = name; this.gs = null; this.cards = []; this.errors = [];
    this.events = []; this.showdowns = []; this.busts = []; this.dead = false;
    this.sock = io(`http://127.0.0.1:${srv.port}`, { transports: ['websocket'], forceNew: true, reconnection: false });
    srv.clients.push(this);
    this.sock.onAny((ev, d) => { this.events.push({ t: Date.now(), ev, d }); });
    this.sock.on('game_state', gs => { this.prev = this.gs; this.gs = gs; });
    this.sock.on('your_cards', d => { this.cards = d.cards; this.myIdx = d.myIdx; });
    this.sock.on('error', e => this.errors.push(e && e.message));
    this.sock.on('showdown_result', d => this.showdowns.push(d));
    this.sock.on('bust_out', d => this.busts.push(d));
  }
  connect() { return new Promise((res, rej) => { this.sock.once('connect', res); this.sock.once('connect_error', rej); }); }
  async join(name = this.name) {
    const n = this.errors.length, j = this.events.filter(e => e.ev === 'room_joined').length;
    this.sock.emit('join_game', { name, avatar: 'x', password: PASS });
    for (let i = 0; i < 100; i++) {
      await sleep(20);
      if (this.events.filter(e => e.ev === 'room_joined').length > j) return { ok: true };
      if (this.errors.length > n) return { error: this.errors[this.errors.length - 1] };
    }
    return { ok: false, error: 'timeout' };
  }
  idx() { return this.gs ? this.gs.players.findIndex(p => p.name === this.name) : -1; }
  me() { return this.gs && this.gs.players[this.idx()]; }
  myTurn() { return !!this.gs && this.gs.status === 'playing' && this.idx() >= 0 && this.gs.currentPlayerIdx === this.idx(); }
  act(action, amount) { this.sock.emit('player_action', { roomId: ROOM, action, amount }); }
  emit(ev, d) { this.sock.emit(ev, d); }
  disconnect() { this.dead = true; this.sock.disconnect(); }
}

async function waitFor(pred, ms = 15000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (pred()) return true; } catch {} await sleep(20); }
  if (label) log('waitFor timeout:', label);
  return false;
}

async function makeTable(names, seed, { start = true, host = 0, extra = [] } = {}) {
  const fullSeed = {};
  for (const n of extra) fullSeed[n.toLowerCase()] = 10000;
  for (const n of names) fullSeed[n.toLowerCase()] = seed && seed[n] !== undefined ? seed[n] : 10000;
  const srv = await startServer(fullSeed);
  const cs = [];
  for (const n of names) { const c = new Client(srv, n); await c.connect(); cs.push(c); }
  for (const c of cs) { c.sock.once('room_joined', () => {}); }
  for (const c of cs) {
    c.sock.emit('join_game', { name: c.name, avatar: 'x', password: PASS });
    await waitFor(() => c.events.some(e => e.ev === 'room_joined'), 3000);
  }
  if (start) {
    cs[host].emit('start_game', { roomId: ROOM });
    await waitFor(() => cs.every(c => c.gs && c.gs.status === 'playing'), 3000, 'table start');
    await sleep(100);
  }
  return { srv, cs };
}

function tableTotal(srv, c) {
  const bank = srv.bank();
  let t = Object.values(bank).reduce((a, b) => a + b, 0);
  let bad = [];
  if (c.gs) {
    for (const p of c.gs.players) {
      if (!Number.isFinite(p.chips) || !Number.isInteger(p.chips) || p.chips < 0) bad.push(`${p.name}.chips=${p.chips}`);
      t += Number(p.chips) || 0;
    }
    t += Number(c.gs.pot) || 0;
  }
  return { total: t, expected: Object.values(srv.seed).reduce((a, b) => a + b, 0), bad };
}

function checkConservation(scn, srv, c, label) {
  const r = tableTotal(srv, c);
  if (r.bad.length) rec(scn, 'high', 'Non-integer / invalid / negative chip values in game_state', 'all chip counts finite non-negative integers', `${label}: ${r.bad.join(', ')}`, 'server.js processAction raise/call (lines 412-433)');
  if (r.total !== r.expected) rec(scn, 'critical', 'Chip conservation violated', `bank+stacks+pot == ${r.expected}`, `${label}: total=${r.total} (diff ${r.total - r.expected})`, 'see scenario');
  return r;
}

// ─── policies ────────────────────────────────────────────────────────────────
const toCallOf = (gs, me) => gs.currentBet - me.roundBet;
const P = {
  call: (gs, me) => ({ action: toCallOf(gs, me) > 0 ? 'call' : 'check' }),
  fold: (gs, me) => ({ action: toCallOf(gs, me) > 0 ? 'fold' : 'check' }),
  shove: (gs, me) => me.chips > toCallOf(gs, me) ? { action: 'raise', amount: 1e9 } : { action: 'call' },
  foldSlow: (gs, me) => ({ action: toCallOf(gs, me) > 0 ? 'fold' : 'check', delay: 900 }),
  slow: (gs, me) => ({ action: toCallOf(gs, me) > 0 ? 'call' : 'check', delay: 700 }),
  random: (gs, me) => {
    const r = Math.random(), tc = toCallOf(gs, me);
    if (tc > 0) {
      if (r < 0.12) return { action: 'fold' };
      if (r < 0.20 && me.chips > tc + 100) return { action: 'raise', amount: gs.currentBet + gs.bb * (1 + Math.floor(Math.random() * 3)) };
      return { action: 'call' };
    }
    if (r < 0.12 && me.chips > 100) return { action: 'raise', amount: gs.currentBet + gs.bb * 2 };
    return { action: 'check' };
  },
};
function autoplay(c, policy) {
  c.auto = policy;
  const handle = gs => {
    if (!c.auto || c.dead || !gs) return;
    const idx = gs.players.findIndex(p => p.name === c.name);
    if (gs.status !== 'playing' || idx < 0 || gs.currentPlayerIdx !== idx) return;
    const me = gs.players[idx];
    const key = [gs.handNum, gs.street, gs.currentBet, gs.pot, me.chips].join('|');
    if (c.lastKey === key) return; c.lastKey = key;
    const d = c.auto(gs, me, c); if (!d) return;
    setTimeout(() => { if (!c.dead) c.act(d.action, d.amount); }, d.delay === undefined ? 15 : d.delay);
  };
  c.sock.on('game_state', handle);
  c.poke = () => { c.lastKey = null; handle(c.gs); };
  c.poke();
}

// ─── independent hand evaluator (cross-check) ────────────────────────────────
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

function expectedPayouts(contrib, scores) {
  const names = Object.keys(contrib), pay = {}, rem = { ...contrib };
  names.forEach(n => pay[n] = 0);
  for (;;) {
    const live = names.filter(n => rem[n] > 0); if (!live.length) break;
    const m = Math.min(...live.map(n => rem[n]));
    live.forEach(n => rem[n] -= m);
    const pot = m * live.length;
    const elig = live.filter(n => scores[n]);
    if (!elig.length) continue;
    let b = scores[elig[0]]; elig.forEach(n => { if (cmp(scores[n], b) > 0) b = scores[n]; });
    const ws = elig.filter(n => cmp(scores[n], b) === 0);
    ws.forEach(n => pay[n] += pot / ws.length);
  }
  return pay;
}

// ─── scenario: soak (30+ hands, 5 players, random play) ─────────────────────
async function soak() {
  const scn = 'S1 soak (5 players, random play, 30 hands)';
  const names = ['soak1', 'soak2', 'soak3', 'soak4', 'soak5'];
  const { srv, cs } = await makeTable(names, {}, { start: false });
  const obs = cs[0];
  cs.forEach(c => autoplay(c, P.random));
  const hands = []; let lastHand = 0, prevDealer = null, prevEnd = null;
  let pendingShowdown = null;
  obs.sock.on('showdown_result', d => { pendingShowdown = d; });
  let startedHands = 0, doneHands = 0, sdChecked = 0, sdBad = 0, rotBad = 0, blindBad = 0;
  obs.sock.on('game_state', gs => {
    if (gs.status === 'playing' && gs.handNum !== lastHand) {
      lastHand = gs.handNum; startedHands++;
      const lg = gs.log, mi = lg.map((l, i) => l.startsWith(`--- Hand #${gs.handNum} `) ? i : -1).filter(i => i >= 0).pop();
      const seg = lg.slice(mi), dealer = (seg.find(l => l.startsWith('Dealer: ')) || '').slice(8);
      const sb = ((seg.find(l => / posts SB /.test(l)) || '').split(' posts SB')[0]);
      const bb = ((seg.find(l => / posts BB /.test(l)) || '').split(' posts BB')[0]);
      const seated = gs.players.map(p => ({ name: p.name, active: !p.sittingOut }));
      const nextAfter = (n, from) => { const L = seated.length; for (let o = 1; o <= L; o++) { const q = seated[(from + o) % L]; if (q.active) return q.name; } };
      const dIdx = seated.findIndex(p => p.name === dealer);
      let expDealer = null;
      if (prevDealer !== null) expDealer = nextAfter(1, seated.findIndex(p => p.name === prevDealer));
      const row = { hand: gs.handNum, dealer, sb, bb, prevEnd, expDealer, stacks: gs.players.map(p => p.name + ':' + p.chips + (p.sittingOut ? '(SO)' : '')).join(' '), log: gs.log.slice(-5) };
      hands.push(row);
      if (expDealer && expDealer !== dealer) {
        rotBad++;
        rec(scn, 'high', `Dealer button does not rotate to next seat after ${prevEnd === 'fold-out' ? 'a fold-out (instantWin)' : 'showdown'}`,
          'dealer moves to the next seated player each hand', `hand ${gs.handNum}: prev dealer ${prevDealer}, expected ${expDealer}, actual ${dealer} (prev hand ended by ${prevEnd})`,
          prevEnd === 'fold-out' ? 'server.js:461 scheduleNextHand(room, winnerIdx) -> winner becomes dealer' : 'server.js:531 nextActiveIdx() skips folded players when computing next dealer');
      }
      if (sb !== nextAfter(1, dIdx)) { blindBad++; rec(scn, 'high', 'SB is not the first active seat after dealer', 'SB = next active after dealer', `hand ${gs.handNum}: dealer ${dealer} sb ${sb}`, 'server.js:357'); }
      if (bb !== nextAfter(1, seated.findIndex(p => p.name === sb))) { blindBad++; rec(scn, 'high', 'BB is not the first active seat after SB', 'BB = next active after SB', `hand ${gs.handNum}: sb ${sb} bb ${bb}`, 'server.js:358'); }
      prevDealer = dealer;
    }
    if (gs.status === 'waiting_next' && gs.handNum === lastHand && !gs._seen) {
      if (doneHands >= startedHands) return;
      doneHands++; HANDS++;
      const sd = pendingShowdown; pendingShowdown = null;
      const isFold = sd && sd.winners[0].handName === 'Everyone folded';
      prevEnd = isFold ? 'fold-out' : 'showdown';
      const snap = JSON.parse(JSON.stringify(gs));
      setTimeout(() => {
        if (srv.stopped) return;
        checkConservation(scn, srv, obs, `end of hand ${snap.handNum}`);
        if (sd && !isFold) {
          sdChecked++;
          const cont = snap.players.filter(p => !p.folded && !p.sittingOut && p.cardCount === 2);
          const sc = {}; for (const p of cont) { const c = cs.find(x => x.name === p.name); sc[p.name] = best7([...c.cards, ...snap.community]); }
          let b = null; for (const n in sc) if (!b || cmp(sc[n], b) > 0) b = sc[n];
          const exp = Object.keys(sc).filter(n => cmp(sc[n], b) === 0).sort();
          const act = sd.winners.map(w => w.name).sort();
          if (JSON.stringify(exp) !== JSON.stringify(act)) {
            sdBad++;
            rec(scn, 'high', 'Showdown winner differs from independent evaluator', `winners ${exp}`, `hand ${snap.handNum}: server says ${act}; board ${snap.community.map(c => c.rank + c.suit)}`, 'server.js evaluate5/compareHands (160-205)');
          }
        }
      }, 120);
    }
  });
  cs[0].emit('start_game', { roomId: ROOM });
  const t0 = Date.now();
  const stallTimer = setInterval(() => { const g = obs.gs; if (g && g.status === 'playing' && g.turnRemainingMs === null) log('soak: playing with no turn timer:', JSON.stringify({ hand: g.handNum, street: g.street, cur: g.currentPlayerIdx, bet: g.currentBet, pot: g.pot, pl: g.players.map(p => [p.name, p.chips, p.roundBet, p.folded, p.allIn, p.sittingOut].join('/')) })); }, 15000);
  await waitFor(() => doneHands >= 30 || Date.now() - t0 > 400000 || srv.exited, 420000);
  clearInterval(stallTimer);
  log(`soak: ${doneHands} hands, showdown checks ${sdChecked} (bad ${sdBad}), rotation mismatches ${rotBad}, blind mismatches ${blindBad}`);
  fs.writeFileSync(path.join(__dirname, 'soak-hands.json'), JSON.stringify(hands, null, 1));
  if (doneHands < 30) rec(scn, 'high', 'Soak did not reach 30 hands', '30 hands', `${doneHands} hands (status ${obs.gs && obs.gs.status})`, 'see log');
  srv.stop();
  return { doneHands, sdChecked, sdBad, rotBad, blindBad };
}

// ─── scenario: all-in with side pots (3 players different stacks) ───────────
async function sidepotTrial(k) {
  const scn = 'S2 all-in side pots (3 players, stacks 300/700/1500)';
  const stacks = { spa: 300, spb: 700, spc: 1500 };
  const order = [['spc', 'spb', 'spa'], ['spa', 'spb', 'spc'], ['spb', 'spc', 'spa']][k % 3];
  const { srv, cs } = await makeTable(order, stacks, { start: false });
  cs.forEach(c => autoplay(c, P.shove));
  cs[0].emit('start_game', { roomId: ROOM });
  let sd = null; cs[0].sock.on('showdown_result', d => { sd = d; });
  const ok = await waitFor(() => cs[0].gs && cs[0].gs.status === 'waiting_next' && sd, 20000);
  if (!ok) { rec(scn, 'high', 'All-in hand never reached waiting_next', 'hand completes', `trial ${k}: status ${cs[0].gs && cs[0].gs.status}`, 'n/a'); srv.stop(); return; }
  HANDS++;
  await sleep(150);
  const gs = cs[0].gs;
  const contrib = {}, scores = {};
  for (const c of cs) {
    contrib[c.name] = stacks[c.name];
    const p = gs.players.find(x => x.name === c.name);
    if (!p.folded) scores[c.name] = best7([...c.cards, ...gs.community]);
  }
  const exp = expectedPayouts(contrib, scores);
  const diffs = [];
  for (const p of gs.players) { if (Math.abs(p.chips - exp[p.name]) > 2) diffs.push(`${p.name}: expected ${exp[p.name]} got ${p.chips}`); }
  checkConservation(scn, srv, cs[0], `trial ${k}`);
  if (diffs.length) rec(scn, 'critical', 'No side-pot handling: showdown pays the entire pot to best hand among all-in players regardless of stack size',
    'short-stack winner only wins up to its stack from each opponent; remainder goes to next-best hand; uncalled excess returned',
    `trial ${k} (stacks ${JSON.stringify(stacks)}): ${diffs.join('; ')}; server winners ${sd.winners.map(w => w.name + ':' + w.handName)}, pot ${sd.pot}`,
    'server.js:502-532 showdown() single pot; no per-player contribution tracking (room.pot only)', { trial: k });
  srv.stop();
  return diffs.length > 0;
}
async function sidepots() {
  const results = [];
  const queue = Array.from({ length: 15 }, (_, i) => i);
  await Promise.all([0, 1, 2].map(async () => { while (queue.length) { const k = queue.shift(); try { results[k] = await sidepotTrial(k); } catch (e) { log('sidepot err', e.message); } } }));
  log(`sidepots: ${results.filter(x => x === true).length}/${results.length} trials show side-pot violations`);
  return results;
}

// ─── scenario: fold-around (everyone folds to one) ───────────────────────────
async function foldAround() {
  const scn = 'S3 fold-outs (everyone folds to one)';
  const { srv, cs } = await makeTable(['fa1', 'fa2', 'fa3', 'fa4'], {}, { start: false });
  cs.forEach(c => autoplay(c, P.fold));
  cs[0].emit('start_game', { roomId: ROOM });
  const dealers = []; let last = 0;
  cs[0].sock.on('game_state', gs => { if (gs.status === 'playing' && gs.handNum !== last) { last = gs.handNum; dealers.push(gs.players[gs.dealerIdx].name); } });
  for (let h = 1; h <= 6; h++) {
    await waitFor(() => cs[0].gs && cs[0].gs.handNum === h && cs[0].gs.status === 'waiting_next', 12000, 'foldaround hand ' + h);
    HANDS++; await sleep(150);
    checkConservation(scn, srv, cs[0], `hand ${h}`);
    await waitFor(() => cs[0].gs.handNum === h + 1 || h === 6, 8000);
  }
  const expected = ['fa1', 'fa2', 'fa3', 'fa4', 'fa1', 'fa2'];
  log('foldaround dealers', dealers.join(','));
  if (JSON.stringify(dealers.slice(0, 6)) !== JSON.stringify(expected))
    rec(scn, 'high', 'Dealer button after fold-outs follows the winner, not clockwise rotation', `dealers ${expected}`, `dealers ${dealers}`, 'server.js:461 scheduleNextHand(room, winnerIdx)');
  srv.stop();
}

// ─── scenario: bad inputs ────────────────────────────────────────────────────
async function badInputs() {
  const scn = 'S4 bad inputs on player_action';
  const cases = [
    ['raise below min (5)', 'raise', 5], ['raise above stack (1e9)', 'raise', 1e9], ['raise string "abc"', 'raise', 'abc'],
    ['raise numeric string "100"', 'raise', '100'], ['raise null', 'raise', null], ['raise object {}', 'raise', {}], ['raise negative', 'raise', -50],
    ['raise fractional 45.5', 'raise', 45.5], ['raise NaN/Infinity (null on wire)', 'raise', NaN], ['raise array [200]', 'raise', [200]],
    ['unknown action "foo"', 'foo', 0], ['uppercase action "RAISE"', 'RAISE', 100], ['illegal check (facing blind)', 'check', 0], ['undefined action', undefined, 0],
  ];
  const out = [];
  for (const [label, action, amount] of cases) {
    const { srv, cs } = await makeTable(['bi1', 'bi2', 'bi3'], {});
    const cur = cs.find(c => c.myTurn());
    const before = JSON.parse(JSON.stringify(cs[0].gs));
    const nErr = cur.errors.length;
    cur.sock.emit('player_action', { roomId: ROOM, action, amount });
    await sleep(350);
    cs[0].emit('sit_out', { roomId: ROOM }); // forces a broadcast so we can read timer state
    await sleep(250);
    const after = cs[0].gs;
    const errs = cur.errors.slice(nErr);
    const me = after.players[cur.idx()];
    const info = { label, errs, currentBet: after.currentBet, pot: after.pot, myChips: me.chips, myRoundBet: me.roundBet, curIdxNow: after.currentPlayerIdx, turnRemainingMs: after.turnRemainingMs, exited: srv.exited };
    out.push(info);
    const tt = tableTotal(srv, cs[0]);
    if (tt.bad.length) rec(scn, 'critical', `Chip state corrupted by ${label}`, 'input rejected or sanitised; chips stay finite integers', `player_action {action:${JSON.stringify(action)}, amount:${JSON.stringify(amount)}} -> ${tt.bad.join(', ')}; pot=${after.pot} currentBet=${after.currentBet}`, 'server.js:422-425 (Math.max/NaN, no Number.isInteger check)');
    if (tt.total !== tt.expected && !tt.bad.length) rec(scn, 'critical', `Conservation break after ${label}`, `${tt.expected}`, `${tt.total}`, 'server.js:421-433');
    if (label.startsWith('raise below min') && !errs.length) rec(scn, 'low', 'Raise below the minimum is silently promoted to a min-raise (no error sent)', `error message to client or exact-amount handling`, `raise 5 accepted, roundBet=${me.roundBet}, currentBet=${after.currentBet}, errors=${JSON.stringify(errs)}`, 'server.js:422-423');
    if (label.startsWith('illegal check') || label.startsWith('unknown') || label.startsWith('uppercase') || label.startsWith('undefined')) {
      const rejectedSilently = !errs.length && after.currentPlayerIdx === cur.idx();
      if (rejectedSilently) rec(scn, 'medium', `Invalid action (${label}) is dropped with no error to the client`, 'error event explaining rejection', `no error event received; still ${cur.name}'s turn`, 'server.js:406,434,778-784 (ok===false path emits nothing)');
      if (after.currentPlayerIdx === cur.idx() && after.turnRemainingMs === null) {
        rec(scn, 'high', 'Rejected/invalid action cancels the turn timer: player can stall forever (no auto-fold)',
          'turnRemainingMs still counting down after a rejected action', `after ${label}: turnRemainingMs=null while it is still ${cur.name}'s turn`, 'server.js:392 clearTurnTimeout at top of processAction runs before validation; player_action (778-784) only re-arms on ok===true', { stallConfirm: label });
      }
    }
    if (srv.exited) rec(scn, 'critical', `Server crashed on ${label}`, 'server survives', srv.out.slice(-400), 'n/a');
    srv.stop();
  }
  fs.writeFileSync(path.join(__dirname, 'badinputs.json'), JSON.stringify(out, null, 1));
  return out;
}

async function outOfTurnAndMisc() {
  const scn = 'S5 acting out of turn / wrong room';
  const { srv, cs } = await makeTable(['ot1', 'ot2', 'ot3'], {});
  const cur = cs.find(c => c.myTurn()); const other = cs.find(c => !c.myTurn());
  const n = other.errors.length;
  other.act('fold');
  await sleep(300);
  const err = other.errors.slice(n);
  if (!err.includes('Not your turn')) rec(scn, 'medium', 'Out-of-turn action gives no "Not your turn" error', '"Not your turn"', JSON.stringify(err), 'server.js:776'); else log('out-of-turn error ok:', err);
  if (cs[0].gs.players[other.idx()].folded) rec(scn, 'critical', 'Out-of-turn fold was applied', 'ignored', 'applied', 'server.js:776');
  // wrong room id
  const n2 = cur.errors.length;
  cur.sock.emit('player_action', { roomId: 'NOPE', action: 'call' });
  await sleep(200);
  if (cur.errors.length === n2) rec(scn, 'low', 'player_action with unknown roomId is silently ignored (no error)', 'error event', 'none', 'server.js:772-773');
  // act after hand (waiting_next) — set up via fold-around
  srv.stop();
}

// ─── scenario: server crash on malformed payloads ───────────────────────────
async function crashInputs() {
  const scn = 'S6 malformed payloads crash the server';
  const payloads = [
    ['player_action', null], ['join_game', null], ['start_game', null], ['rebuy', null], ['sit_out', null], ['drop_sticker', null],
    ['throw_item', null], ['chat_message', null], ['check_balance', null], ['create_demo', null],
    ['join_game', { name: 123, password: PASS }], ['join_game', { name: { a: 1 }, password: PASS }], ['create_demo', { name: 5 }],
  ];
  const res = [];
  for (const [ev, d] of payloads) {
    const srv = await startServer({});
    const c = new Client(srv, 'crash'); await c.connect();
    c.sock.emit(ev, d);
    await sleep(500);
    const crashed = srv.exited;
    res.push({ ev, d, crashed });
    if (crashed) rec(scn, 'critical', `Server process dies on ${ev} with payload ${JSON.stringify(d)}`, 'handler ignores / rejects bad payload, server stays up (DoS otherwise: any client can kill the game)', `node exited code ${srv.exitCode}: ${(srv.out.match(/TypeError[^\n]*/) || [''])[0]}`,
      ev === 'join_game' && d && d.name !== undefined ? 'server.js:698 (name.trim on non-string)' : ev === 'create_demo' ? 'server.js:743 name.trim' : 'server.js destructuring default `= {}` only covers undefined, not null (685,715,739,771,788,809,818,830,841)');
    srv.stop();
  }
  // blind interval overflow
  {
    const { srv, cs } = await makeTable(['bl1', 'bl2'], {}, { start: false });
    cs[0].emit('start_game', { roomId: ROOM, blindInterval: 1e12 });
    await sleep(3000);
    const gs = cs[0].gs;
    if (gs && (gs.sb !== 10 || gs.blindLevel !== 0)) rec('S6b blind interval', 'medium', 'Huge blindInterval overflows setTimeout: blinds escalate to max immediately', 'interval honoured / validated', `after 3s blindLevel=${gs.blindLevel}, blinds ${gs.sb}/${gs.bb}`, 'server.js:726,301-312 (no upper bound; Node clamps >2^31 to 1ms)');
    srv.stop();
  }
  return res;
}

// ─── scenario: turn timeout & disconnect on turn ────────────────────────────
async function timeoutAutoFold() {
  const scn = 'S7 turn timeout (AFK player)';
  const { srv, cs } = await makeTable(['to1', 'to2', 'to3'], {});
  const cur = cs.find(c => c.myTurn());
  const t0 = Date.now(); const startRemaining = cs[0].gs.turnRemainingMs;
  const idx = cur.idx();
  const ok = await waitFor(() => cs[0].gs.players[idx].folded || cs[0].gs.handNum > 1, 36000);
  const dt = Date.now() - t0;
  log(`timeout autofold after ${dt}ms (startRemaining ${startRemaining})`);
  if (!ok || dt < 28000 || dt > 33000) rec(scn, 'high', 'AFK player not auto-folded at ~30s', 'fold at 30000ms', `folded=${ok} after ${dt}ms`, 'server.js:273-291');
  await waitFor(() => cs[0].gs.players[idx].sitOutRequest, 150000);
  await sleep(300);
  const me = cs[0].gs.players[idx];
  if (me.sittingOut || me.sitOutRequest === false) log('afk player state after timeout: sittingOut', me.sittingOut);
  if (!me.sitOutRequest) rec(scn, 'low', 'AFK player auto-folded but never sat out: stays in every hand and stalls the table 30s each time', 'auto sit-out after N consecutive timeouts', `after timeout player ${cur.name} connected=${me.connected} sittingOut=${me.sittingOut} sitOutRequest=${me.sitOutRequest}`, 'server.js:281-290');
  checkConservation(scn, srv, cs[0], 'after timeout');
  srv.stop();
}

async function stallAfterInvalid() {
  const scn = 'S8 invalid action then wait for auto-fold';
  const { srv, cs } = await makeTable(['st1', 'st2', 'st3'], {});
  const cur = cs.find(c => c.myTurn()), idx = cur.idx();
  cur.act('check'); // illegal: facing BB
  const t0 = Date.now();
  const folded = await waitFor(() => cs[0].gs.players[idx].folded || cs[0].gs.handNum > 1, 40000);
  const dt = Date.now() - t0;
  log(`stall test: folded=${folded} after ${dt}ms`);
  if (!folded) rec(scn, 'high', 'After one rejected action the AFK timer never fires: hand blocked forever', 'auto-fold ~30s after turn start', `no fold after ${dt}ms; turn still ${cur.name}'s (server never re-arms timer)`, 'server.js:392 + 778-784');
  srv.stop();
}

async function disconnectOnTurn() {
  const scn = 'S9 disconnect on own turn';
  const { srv, cs } = await makeTable(['dt1', 'dt2', 'dt3', 'dt4'], {});
  const cur = cs.find(c => c.myTurn()), idx = cur.idx();
  const chipsBefore = cur.me().chips;
  const obs = cs.find(c => c !== cur);
  cur.disconnect();
  await sleep(500);
  const gs = obs.gs, p = gs.players[idx];
  log(`dc on turn: folded=${p.folded} connected=${p.connected} chips=${p.chips} next=${gs.currentPlayerIdx}`);
  if (!p.folded) rec(scn, 'high', 'Player who disconnects on their turn is not folded', 'folded', JSON.stringify(p), 'server.js:872-874');
  if (gs.currentPlayerIdx === idx) rec(scn, 'high', 'Turn did not advance', 'next player', 'still same', 'server.js:873');
  const bk = srv.bank();
  log('bank after dc:', bk[cur.name]);
  // conservation (disconnected stack goes to bank; blind they posted stays in pot)
  checkConservation(scn, srv, obs, 'after dc on turn');
  // continue to finish hand
  cs.filter(c => c !== cur).forEach(c => autoplay(c, P.call));
  await waitFor(() => obs.gs.status === 'waiting_next', 20000, 'dc hand finish');
  HANDS++; await sleep(150);
  checkConservation(scn, srv, obs, 'end of hand after dc');
  srv.stop();
}

// ─── scenario: disconnect mid-hand, reconnect ───────────────────────────────
async function disconnectReconnect() {
  const scn = 'S10 disconnect mid-hand then reconnect';
  const { srv, cs } = await makeTable(['rc1', 'rc2', 'rc3', 'rc4'], {});
  cs.forEach(c => autoplay(c, P.call));
  const victim = cs.find(c => !c.myTurn() && c.name !== 'rc1');
  const obs = cs.find(c => c !== victim);
  const vi = victim.idx(), chips0 = victim.me().chips;
  victim.disconnect(); await sleep(400);
  const p = obs.gs.players[vi];
  log(`rc: victim folded=${p.folded} connected=${p.connected} chips=${p.chips}; bank=${srv.bank()[victim.name.toLowerCase()]}`);
  checkConservation(scn, srv, obs, 'after mid-hand dc');
  // reconnect immediately, same name
  const c2 = new Client(srv, victim.name); await c2.connect();
  const r = await c2.join();
  log('reconnect during hand ->', JSON.stringify(r), c2.errors);
  if (!r.ok) rec(scn, 'high', 'Disconnected player cannot reconnect/rejoin during a hand; their seat, stack and cards are forfeited and stack is auto-cashed to bank',
    'reconnect with same name restores seat/stack (or at least can be seated next hand)', `join_game after disconnect -> "${(c2.errors.slice(-1)[0])}". Stack ${chips0} refunded to bank, seat removed after hand`, 'server.js:691-693 (no rejoin path), 863-866 (cash-out on any disconnect), 545-549 (removal)');
  // hand finishes
  await waitFor(() => obs.gs.status === 'waiting_next', 20000);
  HANDS++; await sleep(200);
  checkConservation(scn, srv, obs, 'end of hand after dc');
  const r2 = await c2.join();
  log('reconnect during waiting_next ->', JSON.stringify(r2));
  // wait for next hand: seat removed?
  await waitFor(() => obs.gs.status === 'playing' && obs.gs.handNum === 2, 9000);
  log('players in hand 2:', obs.gs.players.map(p => p.name).join(','));
  if (obs.gs.players.some(p => p.name === victim.name)) rec(scn, 'low', 'Disconnected player seat persisted', 'removed', 'still present', 'server.js:545');
  // dealer rotation after removal
  log('hand2 dealer:', obs.gs.players[obs.gs.dealerIdx].name);
  await waitFor(() => obs.gs.status === 'waiting_next' && obs.gs.handNum === 2, 20000);
  HANDS++; await sleep(200);
  checkConservation(scn, srv, obs, 'end of hand 2');
  srv.stop();
}

// ─── scenario: join mid-hand, 9th player ────────────────────────────────────
async function joinMidHand() {
  const scn = 'S11 join mid-hand';
  const { srv, cs } = await makeTable(['jm1', 'jm2', 'jm3'], {}, { extra: ['jm4'] });
  cs.forEach(c => autoplay(c, P.call));
  const late = new Client(srv, 'jm4'); await late.connect();
  const r = await late.join();
  log('join mid-hand ->', JSON.stringify(r));
  if (r.ok) rec(scn, 'medium', 'Mid-hand join accepted', 'rejected', 'accepted', 'server.js:691');
  else rec(scn, 'medium', 'Late joiners are hard-rejected during an entire session ("Game in progress") instead of being queued for the next hand', 'queued to join at next hand break (table was 3/8)', `error: "${r.error}" (also rejected during waiting_next)`, 'server.js:691-693');
  await waitFor(() => cs[0].gs.status === 'waiting_next', 20000);
  HANDS++;
  const r2 = await late.join();
  if (r2.ok) rec(scn, 'low', 'Join during waiting_next accepted', 'n/a', 'accepted', 'server.js:691'); else log('join during waiting_next ->', JSON.stringify(r2));
  checkConservation(scn, srv, cs[0], 'after late join attempts');
  srv.stop();
}

async function ninthPlayer() {
  const scn = 'S12 9th player / 8-seat table';
  const names = Array.from({ length: 9 }, (_, i) => 'np' + (i + 1));
  const seed = {}; names.forEach(n => seed[n] = 10000);
  const srv = await startServer(seed);
  const cs = [];
  for (const n of names) { const c = new Client(srv, n); await c.connect(); cs.push(c); }
  const res = [];
  for (const c of cs) { res.push(await c.join()); }
  log('join results:', res.map(r => r.ok ? 'ok' : r.error).join(' | '));
  if (!res.slice(0, 8).every(r => r.ok)) rec(scn, 'high', 'First 8 players could not all join', '8 joined', JSON.stringify(res), 'server.js:694');
  if (res[8].ok) rec(scn, 'high', '9th player allowed to join an 8-seat table', 'rejected', 'accepted', 'server.js:694');
  else if (!/full/i.test(res[8].error || '')) rec(scn, 'low', '9th player rejection message unexpected', 'Table is full', res[8].error, 'server.js:695');
  const bal = srv.bank()['np9'];
  if (bal !== 10000) rec(scn, 'high', '9th player rejected but bank debited', '10000', String(bal), 'server.js:705');
  cs.slice(0, 8).forEach(c => autoplay(c, P.call));
  cs[0].emit('start_game', { roomId: ROOM });
  await waitFor(() => cs[0].gs && cs[0].gs.status === 'playing', 3000);
  await sleep(200);
  const cardsOk = cs.slice(0, 8).every(c => c.cards.length === 2);
  if (!cardsOk) rec(scn, 'high', '8-handed deal missing hole cards', '2 cards each', cs.map(c => c.cards.length).join(','), 'server.js:353');
  const np9 = await cs[8].join();
  await waitFor(() => cs[0].gs.status === 'waiting_next', 30000, '8-handed hand');
  HANDS++; await sleep(200);
  const gs = cs[0].gs;
  log('8-handed street at end:', gs.street, 'dealer', gs.players[gs.dealerIdx].name, 'comm', gs.community.length);
  checkConservation(scn, srv, cs[0], '8-handed hand end');
  // 9th joins in-game
  srv.stop();
}

// ─── scenario: rebuy ─────────────────────────────────────────────────────────
async function rebuyScenario() {
  const scn = 'S13 rebuy after bust';
  for (let attempt = 0; attempt < 8; attempt++) {
    const { srv, cs } = await makeTable(['rb1', 'rb2', 'rb3', 'rb4'], {}, { start: false });
    const shov = ['rb1', 'rb2'];
    cs.forEach(c => autoplay(c, shov.includes(c.name) ? P.shove : P.fold));
    cs[0].emit('start_game', { roomId: ROOM });
    await waitFor(() => cs[0].gs && cs[0].gs.status === 'waiting_next', 25000);
    HANDS++; await sleep(200);
    const gs = cs[0].gs;
    const bust = gs.players.find(p => p.chips === 0);
    if (!bust) { log('rebuy: no bust attempt', attempt); srv.stop(); continue; }
    const bc = cs.find(c => c.name === bust.name);
    log(`rebuy: ${bust.name} busted. sittingOut=${bust.sittingOut} (at waiting_next)`);
    checkConservation(scn, srv, cs[0], 'after bust');
    cs.forEach(c => { c.auto = c.name === bust.name ? null : P.foldSlow; });
    bc.emit('rebuy', { roomId: ROOM });
    await sleep(500);
    const immediate = cs[0].gs.players.find(p => p.name === bust.name).chips;
    if (immediate === 0) rec(scn, 'high', 'Rebuy button/request ignored right after busting (before next hand)', 'rebuy accepted when chips==0', `rebuy at waiting_next: chips still 0, no balance_update, no error (bust player sittingOut=${bust.sittingOut})`, 'server.js:794 `if (!player.sittingOut || player.chips > 0) return` — sittingOut only set at startHand (349)');
    await waitFor(() => cs[0].gs.status === 'playing' && cs[0].gs.handNum === 2, 9000, 'hand 2');
    await sleep(300);
    const g2 = cs[0].gs; const b2 = g2.players.find(p => p.name === bust.name);
    log(`rebuy: hand2 started: bust sittingOut=${b2.sittingOut} cardCount=${b2.cardCount}, bust_out events=${bc.busts.length}`);
    let chipsAfter = b2.chips;
    if (chipsAfter === 0) {
      bc.emit('rebuy', { roomId: ROOM });
      await sleep(500);
      const b3 = cs[0].gs.players.find(p => p.name === bust.name);
      chipsAfter = b3.chips;
      log(`rebuy mid-hand 2: chips=${b3.chips} sittingOut=${b3.sittingOut} folded=${b3.folded} cardCount=${b3.cardCount}`);
      if (b3.chips > 0 && !b3.sittingOut && b3.cardCount === 0) {
        // phantom player: remaining-count includes them
        const winners = [];
        bc.sock.on('showdown_result', d => winners.push(d));
        cs.forEach(c => c.sock.on('showdown_result', d => { if (!winners.includes(d)) winners.push(d); }));
        const streetsSeen = new Set();
        cs[0].sock.on('game_state', s => { if (s.handNum === 2) streetsSeen.add(s.street); });
        cs.forEach(c => { if (c !== bc) { c.auto = P.foldSlow; c.poke && c.poke(); } });
        await waitFor(() => cs[0].gs.status === 'waiting_next' && cs[0].gs.handNum === 2, 30000, 'hand 2 end');
        HANDS++; await sleep(200);
        const sd = winners[winners.length - 1];
        log('hand2 result:', JSON.stringify(sd && sd.winners.map(w => w.name + ':' + w.handName)), 'streets', [...streetsSeen]);
        const names = sd ? sd.winners.map(w => w.name) : [];
        if (names.includes(bust.name) || ![...streetsSeen].every(s => s === 'preflop')) {
          rec(scn, 'critical', 'Rebuy mid-hand seats a phantom player (not dealt in, no cards) who counts as a live contender',
            'rebought player waits for next hand; hand ends as soon as all dealt-in players but one fold',
            `hand 2: after rebuy, streets reached ${[...streetsSeen]}; showdown winners ${JSON.stringify(sd && sd.winners.map(w => w.name + ':' + w.handName))} (rebuyer ${bust.name} holds 0 cards)`,
            'server.js:803 sets sittingOut=false without dealing; contender filters at 437/503/877 only check !folded && !sittingOut && connected');
        } else {
          rec(scn, 'medium', 'Rebuy mid-hand un-sits the player immediately (phantom risk)', 'wait for next hand', `hand 2 result ${JSON.stringify(sd && sd.winners)}`, 'server.js:803');
        }
      }
    }
    checkConservation(scn, srv, cs[0], 'after rebuy');
    srv.stop();
    return;
  }
  rec(scn, 'low', 'Could not force a bust in 8 attempts (inconclusive)', 'bust', 'none', 'n/a');
}

// ─── scenario: sit out / sit back in ────────────────────────────────────────
async function sitOut() {
  const scn = 'S14 sit out / sit back in';
  const { srv, cs } = await makeTable(['so1', 'so2', 'so3', 'so4'], {}, { start: false });
  cs.forEach(c => autoplay(c, P.call));
  cs[0].emit('start_game', { roomId: ROOM });
  await waitFor(() => cs[0].gs && cs[0].gs.status === 'playing', 3000);
  const so = cs[2];
  so.emit('sit_out', { roomId: ROOM });                  // request mid hand 1
  await waitFor(() => cs[0].gs.status === 'waiting_next' && cs[0].gs.handNum === 1, 25000); HANDS++; await sleep(200);
  checkConservation(scn, srv, cs[0], 'hand1');
  await waitFor(() => cs[0].gs.handNum === 2 && cs[0].gs.status === 'playing', 9000); await sleep(200);
  let p = cs[0].gs.players[2];
  log(`sit out: hand2 so3 sittingOut=${p.sittingOut} cardCount=${p.cardCount}`);
  if (!p.sittingOut || p.cardCount !== 0) rec(scn, 'high', 'Sit-out request not applied next hand', 'no cards', JSON.stringify(p), 'server.js:350');
  const g2 = cs[0].gs; const log2 = g2.log.join(' | ');
  if (new RegExp('so3 posts').test(log2)) rec(scn, 'high', 'Sitting-out player posted a blind', 'skipped', log2, 'server.js:357');
  so.emit('sit_out', { roomId: ROOM });                  // toggle back in
  await waitFor(() => cs[0].gs.status === 'waiting_next' && cs[0].gs.handNum === 2, 25000); HANDS++; await sleep(200);
  checkConservation(scn, srv, cs[0], 'hand2');
  await waitFor(() => cs[0].gs.handNum === 3 && cs[0].gs.status === 'playing', 9000); await sleep(200);
  p = cs[0].gs.players[2];
  log(`sit out: hand3 so3 sittingOut=${p.sittingOut} cardCount=${p.cardCount}`);
  if (p.sittingOut || p.cardCount !== 2) rec(scn, 'high', 'Player toggled back in but not dealt next hand', 'dealt in', JSON.stringify(p), 'server.js:350');
  await waitFor(() => cs[0].gs.status === 'waiting_next' && cs[0].gs.handNum === 3, 25000); HANDS++; await sleep(200);
  checkConservation(scn, srv, cs[0], 'hand3');
  srv.stop();
}

async function sitOutEndsGame() {
  const scn = 'S15 one player sits out at 2-player table (and restart)';
  const { srv, cs } = await makeTable(['sg1', 'sg2'], {}, { start: false });
  cs.forEach(c => autoplay(c, P.call));
  cs[0].emit('start_game', { roomId: ROOM });
  await waitFor(() => cs[0].gs && cs[0].gs.status === 'playing', 3000);
  cs[1].emit('sit_out', { roomId: ROOM });
  await waitFor(() => cs[0].gs.status === 'waiting_next', 25000); HANDS++; await sleep(200);
  await waitFor(() => cs[0].gs.status === 'waiting' || cs[0].gs.status === 'playing', 9000);
  await sleep(300);
  const gs = cs[0].gs;
  log('after sit-out hand boundary:', gs.status, gs.players.map(p => `${p.name}:${p.chips}:so=${p.sittingOut}:sor=${p.sitOutRequest}`).join(' '));
  const bank = srv.bank();
  log('bank:', JSON.stringify(bank));
  checkConservation(scn, srv, cs[0], 'after sit-out ends game');
  const zeroed = gs.players.some(p => p.chips === 0);
  const sitter = gs.players.find(p => p.name === 'sg2');
  if (gs.status !== 'waiting' || zeroed || !sitter || !sitter.sitOutRequest) {
    rec(scn, 'high', 'One player sitting out at a 2-player table must pause the table without cashing anyone out or clearing the sit-out',
      'status=waiting, stacks intact, sit-out kept', `status=${gs.status}; stacks ${gs.players.map(p => p.name + '=' + p.chips)}; sitOutRequest=${sitter && sitter.sitOutRequest}`, 'server.js scheduleNextHand');
  }
  cs[1].emit('sit_out', { roomId: ROOM });
  const resumed = await waitFor(() => cs[0].gs.status === 'playing', 9000);
  if (!resumed) rec(scn, 'high', 'Table does not resume after the sitter sits back in', 'status=playing', `status=${cs[0].gs.status}`, 'server.js sit_out');
  checkConservation(scn, srv, cs[0], 'after sit back in');
  srv.stop();
}

// ─── scenario: host leaving ──────────────────────────────────────────────────
async function hostLeaving() {
  const scn = 'S16 host leaving';
  {
    const { srv, cs } = await makeTable(['hl1', 'hl2', 'hl3'], {}, { start: false });
    const n = cs[1].errors.length;
    cs[1].emit('start_game', { roomId: ROOM });
    await sleep(300);
    if (!cs[1].errors.slice(n).includes('Only host can start')) rec(scn, 'high', 'Non-host start_game not rejected', 'Only host can start', JSON.stringify(cs[1].errors), 'server.js:718');
    cs[0].disconnect(); await sleep(400);
    cs[1].emit('start_game', { roomId: ROOM });
    await waitFor(() => cs[1].gs && cs[1].gs.status === 'playing', 2000);
    if (!(cs[1].gs && cs[1].gs.status === 'playing')) rec(scn, 'high', 'Host leaves lobby: host not reassigned', 'new host can start', `errors ${JSON.stringify(cs[1].errors)}`, 'server.js:894');
    else log('lobby host migrated ok');
    srv.stop();
  }
  {
    const { srv, cs } = await makeTable(['hm1', 'hm2', 'hm3', 'hm4'], {}, { extra: ['hm5'] });
    cs.forEach(c => autoplay(c, P.call));
    const host = cs[0];
    host.disconnect(); await sleep(400);
    const obs = cs[1];
    log('host left mid-hand; hand continues, status', obs.gs.status);
    await waitFor(() => obs.gs.status === 'waiting_next', 25000); HANDS++; await sleep(200);
    checkConservation(scn, srv, obs, 'hand after host left');
    await waitFor(() => obs.gs.status === 'playing' && obs.gs.handNum === 2, 9000);
    // everyone except hm2 leaves mid hand 2
    cs[2].disconnect(); await sleep(200); cs[3].disconnect(); await sleep(400);
    await waitFor(() => obs.gs.status === 'waiting', 12000, 'room -> waiting'); HANDS++; await sleep(300);
    log('room status', obs.gs.status, 'players', obs.gs.players.map(p => p.name + ':' + p.chips).join(' '));
    checkConservation(scn, srv, obs, 'room back to waiting');
    const late = new Client(srv, 'hm5'); await late.connect(); const jr = await late.join();
    log('new player join ->', JSON.stringify(jr));
    const n = obs.errors.length;
    obs.emit('start_game', { roomId: ROOM });
    await sleep(500);
    const e = obs.errors.slice(n);
    const st = obs.gs.status;
    log('start_game by remaining player ->', st, JSON.stringify(e));
    if (e.includes('Only host can start'))
      rec(scn, 'high', 'Host left mid-hand: host is never reassigned, so after the game drops back to waiting nobody can ever start another game',
        'host migrates to a connected player', `remaining players get "Only host can start"; hostName in room_update=${JSON.stringify((late.events.filter(x => x.ev === 'room_update').slice(-1)[0] || {}).d)}`,
        'server.js:707 (host only set when null), 894 (reassign only in non-playing disconnect branch)');
    srv.stop();
  }
}

// ─── scenario: short all-in "raise" lowers currentBet ───────────────────────
async function shortAllInRaise() {
  const scn = 'S17 short-stack all-in sent as raise';
  const { srv, cs } = await makeTable(['sa0', 'sa1', 'sa2'], { sa1: 50 }, { start: true });
  // seats: 0 dealer/UTG, 1 SB (50 stack), 2 BB
  const c0 = cs[0], c1 = cs[1], c2 = cs[2];
  await waitFor(() => c0.myTurn(), 2000);
  c0.act('raise', 200); await sleep(300);
  const g1 = c0.gs; log('after UTG raise 200: currentBet', g1.currentBet);
  c1.act('raise', 1000); await sleep(300);
  const g2 = c0.gs; log(`after short raise: currentBet=${g2.currentBet} sa1 chips=${g2.players[1].chips} roundBet=${g2.players[1].roundBet} allIn=${g2.players[1].allIn} cur=${g2.currentPlayerIdx}`);
  const chips0 = g2.players[0].chips, rb0 = g2.players[0].roundBet;
  if (g2.currentBet < g1.currentBet) {
    rec(scn, 'critical', 'All-in "raise" for less than the current bet LOWERS room.currentBet, letting earlier bettor take chips back',
      'short all-in is just a call-for-less; currentBet stays 200', `currentBet 200 -> ${g2.currentBet} after sa1 (stack 50) sent raise 1000`, 'server.js:421-433 (room.currentBet = p.roundBet unconditionally at 427)');
    // original raiser calls: negative call?
    if (c0.myTurn() || g2.currentPlayerIdx !== null) {
      for (const c of [c2, c0]) { if (c.myTurn()) { c.act('call'); await sleep(300); } }
      await sleep(200);
      const g3 = c0.gs;
      log('after calls: p0 chips', g3.players[0].chips, 'was', chips0, 'roundBet', rb0, '->', g3.players[0].roundBet, 'pot', g3.pot);
      if (g3.players[0].chips > chips0) rec(scn, 'critical', 'Negative call amount refunds the original raiser (bet withdrawn)', 'call never increases own stack', `sa0 chips ${chips0} -> ${g3.players[0].chips} after "call" (roundBet ${rb0} -> ${g3.players[0].roundBet})`, 'server.js:413-414 (toCall negative, no clamp)');
    }
  }
  checkConservation(scn, srv, c0, 'short raise');
  srv.stop();
}

// ─── scenario: disconnect during all-in runout (stale timers) ───────────────
async function runoutRace() {
  const scn = 'S18 disconnect during all-in runout';
  const { srv, cs } = await makeTable(['rr1', 'rr2', 'rr3'], {}, { start: false });
  cs.forEach(c => autoplay(c, c.name === 'rr3' ? P.fold : P.shove));
  const hist = []; const startsAt = []; let last = '';
  cs[1].sock.on('game_state', gs => { const s = `h${gs.handNum}/${gs.status}/${gs.street}`; if (s !== last) { last = s; if (gs.status === 'playing' && gs.street === 'preflop') startsAt.push([gs.handNum, Date.now()]); hist.push(`${((Date.now() - T0) / 1000).toFixed(1)}s ${s} pot=${gs.pot}`); } });
  const T0 = Date.now();
  cs[0].emit('start_game', { roomId: ROOM });
  let killed = false;
  cs[1].sock.on('game_state', gs => {
    if (killed || gs.status !== 'playing' || gs.street === 'preflop' && gs.currentPlayerIdx !== null) return;
    const live = gs.players.filter(p => !p.folded);
    if (live.length === 2 && live.every(p => p.allIn) && gs.currentPlayerIdx === null) { killed = true; setTimeout(() => { cs[0].disconnect(); cs[1].auto = P.slow; cs[2].auto = P.slow; cs[1].poke(); cs[2].poke(); }, 300); }
  });
  await waitFor(() => killed, 15000, 'runout reached');
  await sleep(16000);
  const gs = cs[1].gs;
  log('runout race timeline:\n  ' + hist.join('\n  '));
  const r = checkConservation(scn, srv, cs[1], 'after stale runout timers (T+16s)');
  const gaps = startsAt.slice(1).map((x, i) => (x[1] - startsAt[i][1]) / 1000);
  const maxHand = Math.max(...hist.map(h => Number(h.match(/ h(\d+)/)[1])));
  log('runout race hand start gaps (s):', gaps.map(g => g.toFixed(1)).join(' '));
  if (gaps.some(g => g < 4.9)) rec(scn, 'high', 'Stale advanceStreet / scheduleNextHand timers double-fire after an early finish: extra hands start (hand counter skips) and a live hand is restarted',
    'one hand ends once; exactly one new hand starts', `hand starts only ${gaps.filter(g => g < 4.9).map(g => g.toFixed(1)).join('/')}s apart (min is 5s); highest hand ${maxHand} in 16s; timeline: ${hist.join(' ; ')}`, 'server.js:496 setTimeout(advanceStreet) is never cancelled; instantWin (445) and showdown (531) each schedule scheduleNextHand 5s timer (541) with no guard on room.status');
  srv.stop();
  return hist;
}

// ─── runner ──────────────────────────────────────────────────────────────────
const GROUPS = {
  soak, sidepots, foldAround, badInputs, outOfTurnAndMisc, crashInputs, timeoutAutoFold, stallAfterInvalid,
  disconnectOnTurn, disconnectReconnect, joinMidHand, ninthPlayer, rebuyScenario, sitOut, sitOutEndsGame, hostLeaving, shortAllInRaise, runoutRace,
};

if (require.main !== module) { module.exports = { startServer, Client, makeTable, autoplay, P, waitFor, sleep, best7, cmp, ROOM, PASS }; } else (async () => {
  const want = process.argv.slice(2);
  const names = want.length ? want : Object.keys(GROUPS);
  const t0 = Date.now();
  const results = await Promise.all(names.map(async n => {
    try { return [n, await GROUPS[n]()]; } catch (e) { log('HARNESS ERROR in', n, e.stack); rec('harness:' + n, 'info', 'Harness error', 'n/a', String(e.stack).slice(0, 500), 'n/a'); return [n, null]; }
  }));
  const sev = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  FINDINGS.sort((a, b) => sev[a.sev] - sev[b.sev]);
  fs.writeFileSync(want.length ? '/tmp/ppmp-partial.json' : path.join(__dirname, 'results.json'), JSON.stringify({ hands: HANDS, seconds: (Date.now() - t0) / 1000, findings: FINDINGS }, null, 1));
  log(`DONE: ${HANDS} hands completed, ${FINDINGS.length} findings, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  for (const f of FINDINGS) console.log(`- [${f.sev}] ${f.scenario}: ${f.title}`);
  process.exit(0);
})();
