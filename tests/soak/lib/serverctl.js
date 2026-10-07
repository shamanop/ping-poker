'use strict';
// Starts, kills and restarts ONE server process (node server.js) on one data dir. Only ever signals the child it spawned.
const fs = require('fs'), path = require('path'), net = require('net');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const sleep = ms => new Promise(r => setTimeout(r, ms));
function portOpen(port) { return new Promise(res => { const s = net.connect(port, '127.0.0.1'); s.once('connect', () => { s.destroy(); res(true); }); s.once('error', () => res(false)); }); }
function portFree(port) { return new Promise((res, rej) => { const s = net.createServer().once('error', () => rej(new Error('port ' + port + ' busy'))).once('listening', () => s.close(res)).listen(port); }); }

class ServerCtl {
  // opts: { port, dir, serverDir, bug, injectPath, env, log }
  constructor(opts) {
    this.port = opts.port; this.dir = opts.dir; this.serverDir = opts.serverDir; this.bug = opts.bug || null; this.injectPath = opts.injectPath;
    this.extraEnv = opts.env || {}; this.log = opts.log || (() => {});
    this.proc = null; this.boots = 0; this.exited = null;
    this.f = n => path.join(this.dir, n);
    fs.mkdirSync(this.dir, { recursive: true });
  }
  env() {
    const f = this.f;
    const e = { SIGNUP_PLAY_CENTS: '1000000', ...process.env, PORT: String(this.port), DATA_DIR: this.dir, BANK_FILE: f('bank.json'), LEDGER_FILE: f('ledger.json'), ACCOUNTS_FILE: f('accounts.json'),
      TABLES_FILE: f('tables.json'), WALLET_FILE: f('wallet.json'), STACKS_FILE: f('stacks.json'), BIGWINS_FILE: f('bigwins.json'), BENDER_CFG_FILE: f('bender-cfg.json'),
      MONEY_FILE: f('money.jsonl'), RIG: '1', AUTO_START_MS: '250', HAND_DELAY_MS: '120', STREET_MS: '120', TURN_MS: '1500', HOST_GRACE_MS: '3000',
      AUTH_SIGNUP_LIMIT: '100000', ...this.extraEnv };
    if (this.bug) e.SOAK_BUG = this.bug;
    delete e.NODE_OPTIONS;
    return e;
  }
  alive() { return !!this.proc && this.proc.exitCode === null && !this.proc.signalCode; }
  logTail(n = 6) { try { return fs.readFileSync(this.f('server.log'), 'utf8').split('\n').slice(-n).join(' | ').slice(0, 500); } catch { return ''; } }

  async start() {
    if (this.alive()) throw new Error('server already running');
    await portFree(this.port);
    const fresh = !fs.existsSync(this.f('money.jsonl')) && !fs.existsSync(this.f('accounts.json'));
    if (fresh) { fs.writeFileSync(this.f('bank.json'), '{}'); fs.writeFileSync(this.f('ledger.json'), '[]'); }
    const out = fs.openSync(this.f('server.log'), 'a');
    fs.writeSync(out, `\n=== boot ${this.boots + 1} ${new Date().toISOString()} bug=${this.bug || '-'} ===\n`);
    const args = this.bug ? ['-r', this.injectPath, 'server.js'] : ['server.js'];
    const proc = spawn('node', args, { cwd: this.serverDir, stdio: ['ignore', out, out], env: this.env() });
    this.proc = proc; this.exited = null; this.boots++;
    proc.once('exit', (code, sig) => { this.exited = { code, sig }; });
    let up = false;
    for (let i = 0; i < 600; i++) {                         // up to 15 s
      if (!this.alive()) break;
      if (await portOpen(this.port)) { up = true; break; }
      await sleep(25);
    }
    if (!up) { const tail = this.logTail(); await this.kill('SIGKILL'); throw new Error('server did not start on ' + this.port + ': ' + tail); }
    await sleep(50);
    return this;
  }
  // Signals only the child this object spawned. Resolves when it has exited.
  async kill(sig = 'SIGKILL') {
    const p = this.proc;
    if (!p) return;
    try { p.kill(sig); } catch {}
    await new Promise(r => { if (p.exitCode !== null || p.signalCode) return r(); p.once('exit', r); setTimeout(r, 6000); });
    if (p.exitCode === null && !p.signalCode) { try { p.kill('SIGKILL'); } catch {} await sleep(200); }
  }
  async restart(sig = 'SIGKILL') { await this.kill(sig); return this.start(); }
  url() { return `http://127.0.0.1:${this.port}`; }
  connect() { return io(this.url(), { transports: ['websocket'], forceNew: true, reconnection: false }); }
}
module.exports = { ServerCtl, sleep };
