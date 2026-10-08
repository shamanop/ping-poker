'use strict';
// Money hardening 1008, K3-G1: the one line that keeps Chips and Cash seats apart on the live server (server.js `sameFundOnly: true` in the
// money port) had no test: flipping it to false passed every suite. This boots the real server and tries to pay a Cash seat with Chips and a
// Chips seat with Cash, and checks that the table's own currency still works. Exit 0 = refused both ways, 1 = a buy-in crossed over.
// MONEY_ROOT = another checkout (a copy with the mutation); K3_PORT / V2_PORT_BASE choose the port (default 4905).
const path = require('path'), fs = require('fs'), os = require('os'), { spawn } = require('child_process'), net = require('net');
const ROOT = process.env.MONEY_ROOT || path.join(__dirname, '..');
const { io } = require(path.join(ROOT, 'node_modules', 'socket.io-client'));
const PORT = Number(process.env.K3_PORT || (process.env.V2_PORT_BASE ? Number(process.env.V2_PORT_BASE) + 5 : 4905));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(process.env.MONEY_TMP || os.tmpdir(), 'money1008-samefund-'));
const f = n => path.join(dir, n);
fs.writeFileSync(f('b.json'), '{}'); fs.writeFileSync(f('l.json'), '[]');
const env = { ...process.env, SIGNUP_PLAY_CENTS: '1000000', PORT: String(PORT), DATA_DIR: dir, BANK_FILE: f('b.json'), LEDGER_FILE: f('l.json'), ACCOUNTS_FILE: f('a.json'), TABLES_FILE: f('t.json'),
  WALLET_FILE: f('w.json'), STACKS_FILE: f('s.json'), BIGWINS_FILE: f('bw.json'), BENDER_CFG_FILE: f('bender-cfg.json'), MONEY_FILE: f('money.jsonl'), RIG: '', AUTH_SIGNUP_LIMIT: '1000', ADMIN_CLAIM_PASSWORD: 'samefund-test-pw' };
delete env.NODE_OPTIONS;
const logFd = fs.openSync(f('server.log'), 'a');
const proc = spawn('node', ['server.js'], { cwd: ROOT, stdio: ['ignore', logFd, logFd], env });
const portOpen = () => new Promise(res => { const s = net.connect(PORT, '127.0.0.1'); s.on('connect', () => { s.destroy(); res(true); }); s.on('error', () => res(false)); });
function client(name) {
  const s = io(`http://127.0.0.1:${PORT}`, { transports: ['websocket'], forceNew: true, reconnection: false });
  const c = { s, name, errors: [], got: {} };
  s.onAny((ev, p) => { c.got[ev] = p; if (ev === 'error') c.errors.push(p && p.code); });
  c.req = (ev, payload, answer, ms = 3000) => new Promise(res => { const t = setTimeout(() => res({ __err: 'timeout ' + answer }), ms); s.once(answer, p => { clearTimeout(t); res(p || {}); }); s.emit(ev, payload); });
  c.ready = new Promise(res => s.on('connect', res));
  return c;
}
let pass = 0, fail = 0;
const check = (name, okk, extra) => { if (okk) pass++; else { fail++; console.log('FAIL ' + name + (extra ? ': ' + extra : '')); } };
(async () => {
  let setupErr = null;
  try {
    for (let i = 0; i < 400 && !(await portOpen()); i++) await sleep(25);
    if (!(await portOpen())) throw new Error('server did not start (see ' + f('server.log') + ')');
    const a = client('Gfunda'); await a.ready;
    const ra = await a.req('auth_signup', { name: a.name, pin: '1234', avatar: 'a01' }, 'auth_ok'); if (ra.__err) throw new Error('signup ' + ra.__err);
    const mk = async mode => (await a.req('table_create', { settings: { name: mode + ' table', mode, buyIn: { min: 500, max: 50000, default: 2000 }, blinds: { sb: 25, bb: 50 }, seats: 2, autoStart: false } }, 'table_created')).table.id;
    const cash = await mk('play'), chips = await mk('chips');
    const tryJoin = async (id, fund) => {
      a.errors.length = 0; delete a.got.table_joined;
      a.s.emit('table_join', { tableId: id, buyIn: 2000, fund }); await sleep(400);
      const joined = !!a.got.table_joined;
      if (joined) await a.req('table_leave', { tableId: id }, 'table_left');
      return { joined, errors: a.errors.slice() };
    };
    const own1 = await tryJoin(cash, 'play'), own2 = await tryJoin(chips, 'chips');
    check('control: a Cash seat can be bought with Cash', own1.joined, JSON.stringify(own1));
    check('control: a Chips seat can be bought with Chips', own2.joined, JSON.stringify(own2));
    const x1 = await tryJoin(cash, 'chips'), x2 = await tryJoin(chips, 'play');
    check('a Cash table refuses a buy-in paid with Chips', !x1.joined, 'ACCEPTED');
    check('a Chips table refuses a buy-in paid with Cash', !x2.joined, 'ACCEPTED');
    check('the refusals are an error to the client, not silence', x1.errors.length > 0 && x2.errors.length > 0, JSON.stringify([x1.errors, x2.errors]));
    a.s.close();
  } catch (e) { setupErr = e; }
  try { proc.kill('SIGKILL'); } catch {}
  await sleep(200);
  if (setupErr) { console.log('ERROR could not run: ' + (setupErr && setupErr.message)); process.exit(2); }
  console.log(`money-1008-samefund.js: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
