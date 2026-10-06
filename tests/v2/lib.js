'use strict';
// Shared harness for the v2 acceptance suite (tests/v2). Port of the audit lib.js.
// Target server dir: --target <dir> | TARGET_DIR | repo root. The target must run with RIG=1 (the baseline rig patch adds the hooks; v2 ships them).
// Tests talk to the server over socket.io only (plus the RIG hooks __rig / __audit), so the same test runs on the old and the new server.
const path = require('path'), fs = require('fs'), net = require('net');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
function argOf(flag) { const i = process.argv.indexOf(flag); return i >= 0 ? process.argv[i + 1] : undefined; }
const TARGET_DIR = path.resolve(argOf('--target') || process.env.TARGET_DIR || REPO_ROOT);
const PORT_BASE = Number(process.env.V2_PORT_BASE) || 3500;   // run.js gives every test file its own block inside 3500-3559
const RUN_ROOT = path.join(__dirname, 'runs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
const TEST_NAME = path.basename(process.argv[1] || 'x', '.js');

const PROCS = new Set();
const killAll = () => { for (const p of PROCS) try { p.kill('SIGKILL'); } catch {} };
process.on('exit', killAll);
process.on('SIGINT', () => { killAll(); process.exit(130); });
process.on('SIGTERM', () => { killAll(); process.exit(143); });
process.on('uncaughtException', e => { console.error('SCRIPT ERROR', e); process.exit(2); });
process.on('unhandledRejection', e => { console.error('SCRIPT ERROR', e); process.exit(2); });

function portFree(port) { return new Promise((res, rej) => { const s = net.createServer().once('error', () => rej(new Error('port ' + port + ' busy'))).once('listening', () => s.close(res)).listen(port); }); }
function portOpen(port) { return new Promise(res => { const s = net.connect(port, '127.0.0.1'); s.once('connect', () => { s.destroy(); res(true); }); s.once('error', () => res(false)); }); }

// startServer(portOrOffset, opts). Offsets below 1000 are added to this test file's port base.
// opts: dir, keepFiles, bank, rig (default true), handDelayMs, autoStartMs, turnMs, env, boots (ignored; readiness is a TCP probe)
async function startServer(portArg = 0, opts = {}) {
  const port = portArg < 1000 ? PORT_BASE + portArg : portArg;
  await portFree(port);
  const dir = opts.dir || path.join(RUN_ROOT, `${TEST_NAME}_${port}_${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  const f = n => path.join(dir, n);
  if (!opts.keepFiles) { fs.writeFileSync(f('b.json'), JSON.stringify(opts.bank || {})); fs.writeFileSync(f('l.json'), '[]'); }
  const env = { ...process.env, PORT: String(port), DATA_DIR: dir, BANK_FILE: f('b.json'), LEDGER_FILE: f('l.json'), ACCOUNTS_FILE: f('a.json'), TABLES_FILE: f('t.json'),
    WALLET_FILE: f('w.json'), STACKS_FILE: f('s.json'), BIGWINS_FILE: f('bw.json'), BENDER_CFG_FILE: f('bender-cfg.json'), MONEY_FILE: f('money.jsonl'),
    RIG: opts.rig === false ? '' : '1',
    AUTO_START_MS: String(opts.autoStartMs || 300), HAND_DELAY_MS: String(opts.handDelayMs || 150), TURN_MS: String(opts.turnMs || 30000),
    AUTH_SIGNUP_LIMIT: '100000', ...(opts.env || {}) };
  delete env.NODE_OPTIONS;
  const out = fs.openSync(f('server.log'), 'a');
  const proc = spawn('node', ['server.js'], { cwd: TARGET_DIR, stdio: ['ignore', out, out], env });
  PROCS.add(proc);
  let up = false;
  for (let i = 0; i < 400; i++) {                      // up to 10 s
    if (proc.exitCode !== null || proc.signalCode) break;
    if (await portOpen(port)) { up = true; break; }
    await sleep(25);
  }
  if (!up) { const tail = (() => { try { return fs.readFileSync(f('server.log'), 'utf8').split('\n').slice(-6).join(' | '); } catch { return ''; } })(); try { proc.kill('SIGKILL'); } catch {} throw new Error('server did not start on ' + port + ': ' + tail.slice(0, 300)); }
  await sleep(60);
  const srv = {
    port, dir, proc, clients: [], f, target: TARGET_DIR,
    read: n => { try { return JSON.parse(fs.readFileSync(f(n), 'utf8')); } catch { return null; } },
    logText: () => { try { return fs.readFileSync(f('server.log'), 'utf8'); } catch { return ''; } },
    alive: () => proc.exitCode === null && !proc.signalCode,
    async stop(sig = 'SIGKILL') {
      try { proc.kill(sig); } catch {}
      await new Promise(r => { if (proc.exitCode !== null || proc.signalCode) return r(); proc.once('exit', r); setTimeout(r, 4000); });
      for (const c of this.clients) try { c.sock.close(); } catch {}
      PROCS.delete(proc);
    },
    // boot again on the same data dir
    async restart(extra = {}) { return startServer(port, { ...opts, ...extra, dir, keepFiles: true }); },
  };
  return srv;
}

class Bot {
  constructor(srv, name, opts = {}) {
    this.srv = srv; this.name = name; this.key = name.toLowerCase(); this.gs = null; this.cards = []; this.errors = []; this.errorObjs = []; this.events = []; this.showdowns = [];
    this.busts = []; this.tableId = opts.tableId || 'POKERPING';
    this.sock = io(`http://127.0.0.1:${srv.port}`, { transports: ['websocket'], forceNew: true, reconnection: false });
    srv.clients.push(this);
    this.sock.onAny((ev, d) => { this.events.push({ t: Date.now(), ev, d }); if (this.events.length > 4000) this.events.splice(0, 2000); });
    this.sock.on('game_state', gs => { this.gs = gs; if (this.onState) this.onState(gs); });
    this.sock.on('your_cards', d => { this.cards = d.cards; this.myIdx = d.myIdx; this.pre = d.preselect; });
    this.sock.on('error', e => { this.errorObjs.push(e); this.errors.push(e && e.message); });
    this.sock.on('showdown_result', d => this.showdowns.push(d));
    this.sock.on('bust_out', d => this.busts.push(d));
    this.sock.on('money', d => { this.money = d; });
  }
  connect() { return new Promise((res, rej) => { if (this.sock.connected) return res(this); this.sock.once('connect', () => res(this)); this.sock.once('connect_error', rej); }); }
  wait(ev, ms = 4000, pred = () => true) {
    return new Promise(res => {
      const t = setTimeout(() => { this.sock.off(ev, h); res(null); }, ms);
      const h = d => { if (!pred(d)) return; clearTimeout(t); this.sock.off(ev, h); res(d === undefined ? true : d); };
      this.sock.on(ev, h);
    });
  }
  async req(ev, payload, okEv, ms = 8000) {
    const ne = this.errors.length;
    const p = this.wait(okEv, ms);
    this.sock.emit(ev, payload);
    const r = await p;
    return r || { __err: this.errors.slice(ne).join(' | ') || 'timeout' };
  }
  async signup(pin = '1234') { const r = await this.req('auth_signup', { name: this.name, pin, avatar: 'a01' }, 'auth_ok'); if (r.account) this.key = r.account.key; return r; }
  async login(pin = '1234') { const r = await this.req('auth_login', { name: this.name, pin }, 'auth_ok'); if (r.account) this.key = r.account.key; return r; }
  async claim(pin = '1234') { const r = await this.req('auth_claim', { name: this.name, pin, avatar: 'a01', roomPassword: 'ping' }, 'auth_ok'); if (r.account) this.key = r.account.key; return r; }
  async claimAdmin() { const r = await this.req('auth_claim', { name: this.name, pin: '4321', avatar: 'a01', roomPassword: 'ping' }, 'auth_ok'); if (r.account) this.key = r.account.key; return r; }
  async sit(tableId = this.tableId, buyIn, fund) { this.tableId = tableId; return this.req('table_join', { tableId, buyIn, fund }, 'table_joined'); }
  async leave(tableId = this.tableId) { return this.req('table_leave', { tableId }, 'table_left'); }
  idx() { return this.gs ? this.gs.players.findIndex(p => p.name.toLowerCase() === this.name.toLowerCase()) : -1; }
  me() { return this.gs && this.gs.players[this.idx()]; }
  myTurn() { return !!this.gs && this.gs.status === 'playing' && !this.gs.paused && this.idx() >= 0 && this.gs.currentPlayerIdx === this.idx(); }
  act(action, amount) { this.sock.emit('player_action', { roomId: this.tableId, action, amount }); }
  emit(ev, d) { this.sock.emit(ev, d); }
  close() { try { this.sock.close(); } catch {} }
}

async function waitFor(pred, ms = 15000, step = 15) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (pred()) return true; } catch {} await sleep(step); } return false; }

// Snapshot through the RIG hook. Contract: V2-DESIGN.md "Test hooks".
async function audit(bot) { return bot.req('__audit', {}, '__audit'); }
const roomOf = (a, id) => a.rooms.find(r => r.id === id);
const seatOf = (a, id, name) => { const r = roomOf(a, id); return r && r.players.find(p => p.name.toLowerCase() === String(name).toLowerCase()); };
function moneyTotal(a) {
  // bank (chips) + wallet (Play cents) + every human stack + every human bet still in a live pot - (achievement/bonus credits + slot net). Bots excluded.
  let bank = 0, wallet = 0, stacks = 0, inPot = 0, botPot = 0;
  for (const v of Object.values(a.bank)) bank += v;
  for (const v of Object.values(a.wallet)) wallet += v;
  // lazy defaults: an account with no bank row / wallet yet is worth 10,000 chips / 1,000,000 Play cents the moment it is touched
  for (const k of a.accounts || []) { if (a.bank[k] === undefined) bank += 10000; if (a.wallet[k] === undefined) wallet += 1000000; }
  for (const r of a.rooms) for (const p of r.players) {
    if (p.isBot) { if (r.pot > 0 && r.status === 'playing') botPot += p.handBet; continue; }
    stacks += p.chips;
    if (r.status === 'playing' && r.pot > 0) inPot += p.handBet;
  }
  const minted = (a.minted || 0) + (a.slotNet || 0);
  return { total: bank + wallet + stacks + inPot - minted, bank, wallet, stacks, inPot, botPot, minted };
}

// Cards: 'As' 'Td' '9h' -> {rank, suit}
const SU = { s: '♠', h: '♥', d: '♦', c: '♣' };
const card = c => ({ rank: c[0] === 'T' ? '10' : c[0], suit: SU[c[1]] });
const ALL = (() => { const o = []; for (const s of 'shdc') for (const r of '23456789TJQKA') o.push(r + s); return o; })();
// holes: array (ascending seat order of the players dealt in) of ['As','Kd']; board: 5 cards. Deck in pop order reversed (the server pops from the end).
function rigDeck(holes, board) {
  const used = new Set([...holes.flat(), ...board]);
  const rest = ALL.filter(c => !used.has(c));
  const burns = rest.splice(0, 3);
  const pops = [...holes.map(h => h[0]), ...holes.map(h => h[1]), burns[0], board[0], board[1], board[2], burns[1], board[3], burns[2], board[4]];
  return [...rest, ...pops.reverse()].map(card);
}

// Create a private table hosted by bots[0] and seat every bot in order with the given stacks.
// The buy-in range is [min(stacks), 1e6] so tables stay valid under stricter v2 validation; blinds default to 25/50 and must be <= the smallest stack.
async function tableWith(srv, names, stacks, settings = {}, opts = {}) {
  const bots = [];
  for (const n of names) { const b = await new Bot(srv, n).connect(); const r = await b.signup(); if (r.__err) throw new Error(n + ' signup ' + r.__err); bots.push(b); }
  const min = Math.min(...stacks.filter(s => s > 0));
  const base = { name: 'Audit', mode: 'chips', buyIn: { min, max: 1000000, default: Math.min(Math.max(2000, min), 1000000) }, blinds: { sb: 25, bb: 50 }, autoStart: false, actionTimerSec: 0, ...settings };
  const c = await bots[0].req('table_create', { settings: base }, 'table_created');
  if (c.__err) throw new Error('create ' + c.__err);
  const id = c.table.id;
  if (opts.decks) { const r = await bots[0].req('__rig', { decks: opts.decks }, '__rig_ok'); if (r.__err) throw new Error('rig ' + r.__err); }
  for (let i = 0; i < bots.length; i++) { const r = await bots[i].sit(id, stacks[i], opts.fund && opts.fund[i]); if (r.__err) throw new Error(names[i] + ' sit ' + r.__err); }
  if (opts.start !== false) { bots[0].emit('table_start', { tableId: id }); await waitFor(() => bots[0].gs && bots[0].gs.status === 'playing', 4000); await sleep(80); }
  return { id, bots, table: c.table };
}
// act as the bot whose turn it is and wait for the state to move
async function step(bots, action, amount, who) {
  const b = who || bots.find(x => x.myTurn());
  if (!b) throw new Error('nobody on turn');
  const ne = b.errors.length; const hn = b.gs.handNum, cp = b.gs.currentPlayerIdx, st = b.gs.street, cb = b.gs.currentBet;
  b.act(action, amount);
  await waitFor(() => b.errors.length > ne || b.gs.currentPlayerIdx !== cp || b.gs.street !== st || b.gs.handNum !== hn || b.gs.status !== 'playing' || b.gs.currentBet !== cb, 2000);
  await sleep(40);
  return { by: b.name, err: b.errors.length > ne ? b.errors[b.errors.length - 1] : null };
}
// who is on turn / what they face, from game_state only
function info(b) {
  const gs = b.gs, me = b.me();
  const toCall = Math.max(0, gs.currentBet - me.roundBet);
  return { gs, me, toCall, maxTo: me.roundBet + me.chips, street: gs.street, currentBet: gs.currentBet, bb: gs.bb, sb: gs.sb, handNum: gs.handNum };
}
// Policies: (bot, info) -> [action, amount] | null
const P = {
  allin: (b, i) => (i.me.chips <= i.toCall ? ['call'] : ['raise', i.maxTo]),
  call: (b, i) => [i.toCall ? 'call' : 'check'],
  fold: () => ['fold'],
  checkfold: (b, i) => [i.toCall ? 'fold' : 'check'],
  // raise to `to` while the bet is below it (once per street it is reached), otherwise call
  raiseTo: to => (b, i) => (i.currentBet < to && i.maxTo > i.currentBet ? ['raise', Math.min(to, i.maxTo)] : [i.toCall ? 'call' : 'check']),
  // per street: object { preflop: policy, flop: policy, ..., default: policy }
  street: m => (b, i) => (m[i.street] || m.default || P.call)(b, i),
};
// Drive every bot with its policy until pred() is true or ms elapses. Each bot acts once per distinct decision point.
async function drive(bots, policies, pred, ms = 20000) {
  const pol = Array.isArray(policies) ? policies : bots.map(() => policies);
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return true;
    for (let k = 0; k < bots.length; k++) {
      const b = bots[k];
      if (!b.myTurn()) continue;
      const i = info(b);
      const sig = `${i.handNum}|${i.street}|${i.currentBet}|${i.me.roundBet}|${i.me.chips}|${i.gs.pot}|${b.errors.length}`;
      if (b._sig === sig && Date.now() - (b._sigT || 0) < 600) continue;
      b._sig = sig; b._sigT = Date.now();
      const a = pol[k](b, i);
      if (a) b.act(a[0], a[1]);
    }
    await sleep(25);
  }
  return pred();
}

// Reference settlement used for the pot checks. committed: {name: n}; folded: Set(names); strength: {name: n} higher wins, equal = tie;
// order: names in seat order (clockwise); button: name. Returns { final: {name: payout+returned}, pays: {name: payout}, returned: {name: n} }.
function refSettle({ committed, folded = new Set(), strength, order, button }) {
  const names = Object.keys(committed);
  const levels = [...new Set(names.map(n => committed[n]).filter(x => x > 0))].sort((a, b) => a - b);
  const pays = {}, returned = {}; for (const n of names) { pays[n] = 0; returned[n] = 0; }
  const bi = order.indexOf(button);
  const clockwise = ns => ns.slice().sort((a, b) => ((order.indexOf(a) - bi - 1 + order.length * 2) % order.length) - ((order.indexOf(b) - bi - 1 + order.length * 2) % order.length));
  let prev = 0;
  for (const L of levels) {
    const contrib = names.filter(n => committed[n] > prev);
    const amount = contrib.reduce((s, n) => s + Math.min(committed[n], L) - prev, 0);
    prev = L;
    if (contrib.length === 1) { returned[contrib[0]] += amount; continue; }
    const elig = contrib.filter(n => !folded.has(n));
    if (!elig.length) throw new Error('refSettle: layer with no eligible player');
    const best = Math.max(...elig.map(n => strength[n]));
    const win = clockwise(elig.filter(n => strength[n] === best));
    const each = Math.floor(amount / win.length); let rem = amount - each * win.length;
    for (const n of win) { pays[n] += each + (rem > 0 ? 1 : 0); if (rem > 0) rem--; }
  }
  const final = {}; for (const n of names) final[n] = pays[n] + returned[n];
  return { final, pays, returned };
}

// ---------------------------------------------------------------- scenario helpers
// Seat `names` with `stacks` at a fresh table hosted by names[0], rig `deck` for every hand, start, and fold hands out until the dealt hand has the
// button on players[want] (first-hand button choice differs between implementations; later hands rotate one seat). Returns the live aligned hand.
// start = {name: chips + roundBet at the first action} so expectations use real stacks even if a burner hand cost a blind.
async function dealAligned(srv, names, stacks, o = {}) {
  const decks = o.deck ? Array(8).fill(o.deck) : undefined;
  const { id, bots } = await tableWith(srv, names, stacks, o.settings || {}, { decks, start: false, fund: o.fund });
  const host = bots[0];
  const bank0 = Object.fromEntries(bots.map(b => [b.name, null]));
  const a0 = await audit(host); for (const b of bots) bank0[b.name] = a0.bank[b.key];
  host.emit('table_start', { tableId: id });
  let h = 1;
  for (let tries = 0; tries < names.length + 2; tries++) {
    if (!await waitFor(() => host.gs && host.gs.status === 'playing' && host.gs.handNum >= h, 8000)) throw new Error('hand did not start');
    await sleep(60);
    h = host.gs.handNum;
    const btn = host.gs.players.findIndex(p => p.isDealer);
    if (o.want === undefined || btn === o.want) {
      const start = Object.fromEntries(host.gs.players.map(p => [p.name, p.chips + p.roundBet]));
      const blinds = Object.fromEntries(host.gs.players.map(p => [p.name, p.roundBet]));
      return { id, bots, names, start, blinds, bank0, handNum: h, button: host.gs.players[btn].name, order: host.gs.players.map(p => p.name) };
    }
    await drive(bots, P.fold, () => host.gs.handNum > h || host.gs.status !== 'playing', 8000);
    h += 1;
  }
  throw new Error('could not align the button on seat ' + o.want);
}
// Wait for the hand's showdown_result on `ob`, then audit at once. Returns per-player chips (table) + bank delta, plus the payload.
async function settleOf(S, ob, ms = 15000) {
  const b = S.bots[ob === undefined ? 0 : ob];
  const n0 = b.showdowns.length;
  await waitFor(() => b.showdowns.length > n0, ms);
  const sd = b.showdowns[b.showdowns.length - 1];
  const a = await audit(b); const room = roomOf(a, S.id);
  const totals = {};
  for (const bt of S.bots) { const seat = room && room.players.find(p => p.name === bt.name); totals[bt.name] = (seat ? seat.chips : 0) + ((a.bank[bt.key] ?? 0) - (S.bank0[bt.name] ?? 0)); }
  return { sd: n0 === b.showdowns.length ? null : sd, totals, audit: a };
}
// expected totals = start - committed + settled payout (refSettle). committed/strength keyed by name.
function expectTotals(S, committed, folded, strength) {
  const r = refSettle({ committed, folded, strength, order: S.order, button: S.button });
  const out = {}; for (const n of S.names) out[n] = S.start[n] - (committed[n] || 0) + (r.final[n] || 0);
  return { totals: out, ref: r };
}

// ---------------------------------------------------------------- check runner
class Fail extends Error {}
const expect = (cond, msg) => { if (!cond) throw new Fail(msg || 'expectation failed'); };
const expectEq = (got, want, msg) => { const a = JSON.stringify(got), b = JSON.stringify(want); if (a !== b) throw new Fail(`${msg ? msg + ': ' : ''}got ${a} want ${b}`); };

// const T = suite(__filename); await T.check('name', ['H4'], async () => { ... throw/expect to fail; return 'detail' }); await T.done();
function suite(file) {
  const NN = path.basename(file, '.js').split('_')[0];
  const rows = [];
  const only = process.env.V2_CHECK_ONLY ? process.env.V2_CHECK_ONLY.split('|') : null;
  async function check(title, bugs, fn, o = {}) {
    if (only && !only.some(s => title.includes(s))) return;
    const t0 = Date.now(); let status = 'PASS', detail = '', error = false;
    let timer;
    try {
      const r = await Promise.race([Promise.resolve().then(fn), new Promise((_, rej) => { timer = setTimeout(() => rej(new Fail('timeout after ' + (o.timeoutMs || 150000) + ' ms')), o.timeoutMs || 150000); })]);
      if (typeof r === 'string') detail = r;
    } catch (e) {
      status = 'FAIL'; detail = String((e && e.message) || e).replace(/\s+/g, ' ').slice(0, 400);
      if (!(e instanceof Fail)) { error = true; detail = 'ERR ' + detail; }
    } finally { clearTimeout(timer); }
    const row = { test: NN, check: title, bugs: bugs || [], status, detail, error, ms: Date.now() - t0 };
    rows.push(row);
    console.log(`${status}  ${NN}  ${title}  [${row.bugs.join(',')}]  ${detail}`);
  }
  async function done() {
    const rf = process.env.V2_RESULT_FILE;
    if (rf) fs.writeFileSync(rf, JSON.stringify(rows, null, 1));
    killAll();
    process.exit(rows.some(r => r.status === 'FAIL') ? 1 : 0);
  }
  return { check, done, rows, NN };
}

module.exports = { startServer, Bot, waitFor, sleep, log, audit, roomOf, seatOf, moneyTotal, rigDeck, card, tableWith, step, info, P, drive, refSettle,
  suite, expect, expectEq, Fail, dealAligned, settleOf, expectTotals, TARGET_DIR, REPO_ROOT, PORT_BASE, RUN_ROOT };
