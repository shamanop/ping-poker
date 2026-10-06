'use strict';
const { authJoin } = require('./authjoin');
const path = require('path'), fs = require('fs');
const { spawn } = require('child_process');
const { io } = require('/home/isabelle/.cache/node_modules/socket.io-client');
const ROOT = path.join(__dirname, '..');
const ROOM = 'POKERPING', PASS = 'ping';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

let runN = 0;
async function startServer(port, seed = {}) {
  const dir = path.join(require('os').tmpdir(), 'pp_run' + (++runN) + '_' + port);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'bank.json'), JSON.stringify(seed));
  fs.writeFileSync(path.join(dir, 'ledger.json'), '[]');
  const out = fs.openSync(path.join(dir, 'server.log'), 'w');
  const proc = spawn('node', ['server.js'], { cwd: ROOT, stdio: ['ignore', out, out],
    env: { ...process.env, PORT: String(port), BANK_FILE: path.join(dir, 'bank.json'), LEDGER_FILE: path.join(dir, 'ledger.json') } });
  for (let i = 0; i < 60; i++) { await sleep(50); if (fs.readFileSync(path.join(dir, 'server.log'), 'utf8').includes('running')) break; }
  return { port, dir, proc, clients: [],
    bank: () => JSON.parse(fs.readFileSync(path.join(dir, 'bank.json'), 'utf8')),
    logText: () => fs.readFileSync(path.join(dir, 'server.log'), 'utf8'),
    stop() { for (const c of this.clients) try { c.sock.close(); } catch {} try { proc.kill(); } catch {} } };
}

class Client {
  constructor(srv, name, opts = {}) {
    this.srv = srv; this.name = name; this.gs = null; this.cards = []; this.errors = []; this.events = [];
    this.showdowns = []; this.busts = []; this.chats = [];
    this.sock = io(`http://127.0.0.1:${srv.port}`, { transports: ['websocket'], forceNew: true, reconnection: false });
    srv.clients.push(this);
    this.sock.onAny((ev, d) => this.events.push({ t: Date.now(), ev, d }));
    this.sock.on('game_state', gs => { this.gs = gs; });
    this.sock.on('your_cards', d => { this.cards = d.cards; this.myIdx = d.myIdx; });
    this.sock.on('error', e => this.errors.push(e && e.message));
    this.sock.on('showdown_result', d => this.showdowns.push(d));
    this.sock.on('bust_out', d => this.busts.push(d));
    this.sock.on('chat_message', d => this.chats.push(d));
    this.sock.on('table_joined', d => { this.joined = { ...d, roomId: d.tableId }; });
    this.sock.on('disconnect', () => { this.closed = true; });
  }
  connect() { return new Promise((res, rej) => { if (this.sock.connected) return res(); this.sock.once('connect', res); this.sock.once('connect_error', rej); }); }
  async join(name = this.name, password = PASS) {
    const n = this.errors.length, j = this.events.filter(e => e.ev === 'table_joined').length;
    authJoin(this.sock, { name, avatar: 'x', password });
    for (let i = 0; i < 100; i++) {
      await sleep(20);
      if (this.events.filter(e => e.ev === 'table_joined').length > j) return { ok: true };
      if (this.errors.length > n) return { ok: false, error: this.errors[this.errors.length - 1] };
    }
    return { ok: false, error: 'timeout' };
  }
  idx() { return this.gs ? this.gs.players.findIndex(p => p.name === this.name) : -1; }
  me() { return this.gs && this.gs.players[this.idx()]; }
  myTurn() { return !!this.gs && this.gs.status === 'playing' && this.idx() >= 0 && this.gs.currentPlayerIdx === this.idx(); }
  act(action, amount) { this.sock.emit('player_action', { roomId: ROOM, action, amount }); }
  emit(ev, d) { this.sock.emit(ev, d); }
}
async function waitFor(pred, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (pred()) return true; } catch {} await sleep(20); } return false; }
async function mk(srv, names) { const cs = []; for (const n of names) { const c = new Client(srv, n); await c.connect(); const r = await c.join(); c.jr = r; cs.push(c); } return cs; }
const results = [];
function check(id, name, pass, evidence) { results.push({ id, name, pass, evidence }); console.log(`${pass ? 'PASS' : 'FAIL'} [${id}] ${name} :: ${evidence}`); }
module.exports = { startServer, Client, waitFor, mk, sleep, log, check, results, ROOM, PASS, ROOT };
