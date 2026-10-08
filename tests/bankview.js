// Bank charts: Chips / Cash views stay separate. Throwaway server, port 4877.
const { spawn } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const { io } = require(process.env.SIO_CLIENT || '/home/isabelle/.cache/node_modules/socket.io-client');
const { createLedger } = require('../ledger');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppbv-'));
const PORT = Number(process.env.TEST_PORT || 4877), ROOT = path.join(__dirname, '..');
const env = { ...process.env, PORT: String(PORT), BANK_FILE: path.join(dir, 'bank.json'), LEDGER_FILE: path.join(dir, 'ledger.json'), ACCOUNTS_FILE: path.join(dir, 'acc.json'), TABLES_FILE: path.join(dir, 'tables.json'), WALLET_FILE: path.join(dir, 'wallet.json'), AUTO_START_MS: '600000' };
const proc = spawn('node', ['server.js'], { cwd: ROOT, env, stdio: 'ignore' });
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const cl = () => { const c = { ev: [] }; c.s = io(`http://localhost:${PORT}`, { forceNew: true }); c.s.onAny((e, d) => c.ev.push([e, d])); c.last = e => { const h = c.ev.filter(x => x[0] === e); return h.length ? h[h.length - 1][1] : undefined; }; return c; };
(async () => {
  try {
    const L = createLedger({ file: path.join(dir, 'l2.json') });
    const rows = [
      { t: 1, type: 'snapshot', room: 'A', handNum: 1, mode: 'cents', nightId: 'n1', players: [{ name: 'Al', chips: 2500, played: true }, { name: 'Bo', chips: 1500, played: true }] },
      { t: 2, type: 'snapshot', room: 'B', handNum: 1, mode: 'cents', nightId: 'n2', players: [{ name: 'Al', chips: 900, played: true }] },
      { t: 3, type: 'buyin', name: 'Al', amount: 2000, mode: 'cents', nightId: 'n1' },
    ];
    const s = L.summary('X', { al: 777 }, [], { all: true, rows });
    ok(s.maxHand === 2 && s.series.Al.length === 2, 'play rows from several tables chart together');
    ok(L.summary('X', {}, [], {}).maxHand === 0, 'chips view ignores play rows');

    for (let i = 0; i < 60; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await sleep(100); } }
    const a = cl(); await sleep(300);
    a.s.emit('auth_signup', { name: 'Alice', pin: '1234', avatar: 'x' }); await sleep(400);
    a.s.emit('table_create', { settings: { name: 'Chips five', mode: 'chips', unit: 'chips', buyIn: { min: 5, max: 5000, default: 100 }, blinds: { sb: 10, bb: 20 } } }); await sleep(400);
    const t = a.last('table_created'); ok(t && t.table.buyIn.min === 5, 'chips table accepts a $5 minimum buy-in');
    a.s.emit('table_join', { tableId: t.table.id, buyIn: 5 }); await sleep(500);
    ok(!!a.last('table_joined'), 'joined a chips table with a buy-in of 5');
    a.s.emit('table_create', { settings: { name: 'Play night', mode: 'play', unit: 'cents', buyIn: { min: 500, max: 50000, default: 2000 }, blinds: { sb: 25, bb: 50 } } }); await sleep(400);
    const pt = a.last('table_created');
    a.s.emit('table_join', { tableId: pt.table.id, buyIn: 2000 }); await sleep(500);
    a.ev.length = 0;
    a.s.emit('get_bank_summary', { roomId: pt.table.id, view: 'play' }); await sleep(300);
    const ps = a.last('bank_summary');
    ok(ps && ps.view === 'play' && ps.unit === 'cents', 'play view is labelled play / cents');
    const me = ps && ps.players.find(p => /alice/i.test(p.name));
    ok(me && me.atTable === 2000 && me.bank > 0, 'play view shows the Cash stack and wallet only (' + JSON.stringify(me && [me.atTable, me.bank]) + ')');
    a.ev.length = 0;
    a.s.emit('get_bank_summary', { roomId: pt.table.id, view: 'chips' }); await sleep(300);
    const cs = a.last('bank_summary');
    ok(cs && cs.view === 'chips' && cs.unit === 'chips', 'chips view is labelled chips');
    ok(!cs.players.some(p => p.atTable === 2000), 'chips view does not include the Cash stack');
  } catch (e) { console.log('ERR', e); fails++; }
  proc.kill(); console.log(fails ? 'FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
