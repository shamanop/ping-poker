'use strict';
// Money-conservation fuzz. 7 bots roam POKERPING, a chips night table and a Cash night table, playing random actions (random raise sizes, all-ins,
// junk amounts), leaving/rejoining with random funding, dropping their socket and coming back, rebuying, sitting out, preselecting, spinning Ballot
// Bender in both modes, claiming the daily bonus, while the host changes blinds, pauses and kicks. Every 200 ms the server is audited:
//   bank + wallet + all human stacks + human bets in live pots - (achievement/bonus credits + slot net)  must stay constant.
// Port of audit repro 10. Default: time-boxed to about 90 s. --long: the 8 minute / 600 hand run. --seed N.
const { startServer, Bot, waitFor, sleep, audit, moneyTotal, suite, expect, RUN_ROOT } = require('./lib');
const fs = require('fs'), path = require('path');
const T = suite(__filename);
const LONG = process.argv.includes('--long');
const argv = f => { const i = process.argv.indexOf(f); return i >= 0 ? Number(process.argv[i + 1]) : undefined; };
const TARGET = LONG ? 600 : 100000;
const FUZZ_MIN = LONG ? 8 : 1.5;
const seed0 = argv('--seed') || 12345;
let seed = seed0;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = a => a[Math.floor(rnd() * a.length)];
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const BETS = [10, 20, 50, 100];

async function fuzz() {
  const names = ['Fa', 'Fb', 'Fc', 'Fd', 'Fe', 'Ff', 'Fg'].map(n => n + 'zz');
  // seeded bank rows become claimable accounts with 200,000 chips; if a server cannot claim them the bots sign up instead
  const srv = await startServer(0, { handDelayMs: 120, autoStartMs: 150, env: { HOST_GRACE_MS: '500' }, bank: Object.fromEntries(names.map(n => [n.toLowerCase(), 200000])) });
  const bots = {};
  for (const n of names) {
    const b = await new Bot(srv, n).connect(); let r = await b.claim();
    if (r.__err) { b.close(); const b2 = await new Bot(srv, n).connect(); r = await b2.signup(); if (r.__err) throw new Error('auth ' + n + ' ' + r.__err); bots[n] = b2; } else bots[n] = b;
  }
  const host = bots[names[0]];
  const auditor_ = await new Bot(srv, 'Auditzz').connect(); await auditor_.signup();
  const mk = async (s) => { const r = await host.req('table_create', { settings: s }, 'table_created'); if (r.__err) throw new Error('create ' + r.__err); return r.table.id; };
  const T1 = await mk({ name: 'FuzzChips', mode: 'chips', buyIn: { min: 100, max: 20000, default: 2000 }, blinds: { sb: 25, bb: 50 }, rebuyLimit: 3, actionTimerSec: 15, isPrivate: false });
  const T2 = await mk({ name: 'FuzzPlay', mode: 'play', buyIn: { min: 200, max: 50000, default: 2000 }, blinds: { sb: 10, bb: 20 }, actionTimerSec: 15, isPrivate: false });
  const TABLES = { POKERPING: { min: 500, max: 20000 }, [T1]: { min: 100, max: 20000 }, [T2]: { min: 200, max: 50000 } };
  const violations = [], notes = {}, noteSamples = {}; const note = (k, d) => { notes[k] = (notes[k] || 0) + 1; if (notes[k] <= 3) (noteSamples[k] ||= []).push(d); };
  const errCounts = {};

  function wire(b) {
    b.onState = gs => {
      if (b.acting || !b.myTurn()) return;
      b.acting = true;
      setTimeout(() => {
        b.acting = false;
        if (!b.myTurn()) return;
        const me = b.me(), gs2 = b.gs, toCall = Math.max(0, gs2.currentBet - me.roundBet), r = rnd();
        if (r < 0.12) b.act('fold');
        else if (r < 0.45) b.act(toCall ? 'call' : 'check');
        else if (r < 0.50) b.act('check');                                  // sometimes illegal
        else if (r < 0.53) b.act('raise', pick([-50, 1.5, '300', 1e20, NaN, null, 0]));
        else {
          const max = me.roundBet + me.chips, min = gs2.currentBet + gs2.bb;
          const amt = rnd() < 0.25 ? max : Math.min(max, ri(min, Math.max(min, Math.floor(min + (max - min) * rnd() * 0.5))));
          b.act('raise', amt);
        }
        if (rnd() < 0.05) b.emit('preselect', { roomId: b.tableId, mode: pick(['checkfold', 'call', 'none']), amount: toCall });
      }, ri(3, 20));
    };
    b.sock.on('error', e => { const m = String(e && e.message).replace(/\d+/g, 'N'); errCounts[m] = (errCounts[m] || 0) + 1; if (b.onState && b.gs) setTimeout(() => b.onState && b.onState(b.gs), 5); });
  }
  for (const b of Object.values(bots)) wire(b);
  const ticker = setInterval(() => { for (const b of Object.values(bots)) if (b.onState && b.myTurn() && !b.acting) b.onState(b.gs); }, 100);

  const seatOf = {}; // name -> tableId
  async function sitRandom(b) {
    const tid = pick(Object.keys(TABLES)), lim = TABLES[tid];
    const fund = pick(['chips', 'play', undefined]);
    const r = await b.sit(tid, ri(lim.min, Math.min(lim.max, 6000)), fund);
    if (!r.__err) seatOf[b.name] = tid; else note('sit_fail', r.__err);
  }
  for (const b of Object.values(bots)) await sitRandom(b);
  host.emit('table_start', { tableId: T1 }); host.emit('table_start', { tableId: T2 });

  let base = null, audits = 0;
  const handsOf = a => a.rooms.reduce((s, r) => s + r.handNum, 0);
  const stall = {};
  const t0 = Date.now();
  let hands = 0, busy = false;
  const auditor = setInterval(async () => {
    if (busy) return; busy = true;
    try {
      const a = await audit(auditor_); if (!a || !a.bank) return;
      audits++;
      const m = moneyTotal(a);
      if (base === null) base = m.total;
      if (m.total !== base) {
        violations.push({ t: Date.now() - t0, diff: m.total - base, m, rooms: a.rooms.map(r => ({ id: r.id, status: r.status, pot: r.pot, players: r.players.map(p => `${p.name}:${p.chips}/${p.handBet}${p.connected ? '' : '(dc)'}`) })) });
        console.log('VIOLATION', m.total - base);
        base = m.total; // re-base so each new leak is reported once
      }
      for (const r of a.rooms) {
        const sum = r.players.reduce((s, p) => s + p.handBet, 0);
        if (r.status === 'playing' && r.pot !== sum) note('pot_mismatch', { id: r.id, pot: r.pot, sum });
        for (const p of r.players) if (!(p.chips >= 0) || !Number.isInteger(p.chips)) note('bad_stack', { id: r.id, p });
        const sig = `${r.handNum}|${r.status}|${r.pot}|${r.players.map(p => p.chips + '/' + p.handBet).join(',')}`;
        const s = stall[r.id] || (stall[r.id] = { sig, since: Date.now() });
        if (s.sig !== sig) { s.sig = sig; s.since = Date.now(); s.reported = false; }
        else if (r.status === 'playing' && Date.now() - s.since > 20000 && !s.reported) {
          s.reported = true;
          note('STALL', { id: r.id, players: r.players.map(p => `${p.name}:${p.chips}${p.connected ? '' : 'dc'}`) });
          // unstick so the fuzz continues: everyone leaves that table
          for (const b of Object.values(bots)) if (seatOf[b.name] === r.id) { await b.leave(r.id); seatOf[b.name] = null; }
        }
      }
      hands = handsOf(a);
    } finally { busy = false; }
  }, 200);

  // chaos
  const deadline = Date.now() + FUZZ_MIN * 60000;
  while (hands < TARGET && Date.now() < deadline && srv.alive()) {
    await sleep(ri(60, 180));
    const b = bots[pick(names)];
    const me = b.me(); const r = rnd();
    try {
      if (!seatOf[b.name]) { await sitRandom(b); continue; }
      if (me && me.chips === 0 && (me.sittingOut || b.gs.status !== 'playing') && rnd() < 0.5) { await b.leave(); seatOf[b.name] = null; continue; }
      if (me && me.chips === 0 && rnd() < 0.5) {
        const lim = TABLES[b.tableId];
        b.emit('rebuy', { roomId: b.tableId, amount: rnd() < 0.2 ? undefined : ri(lim.min, Math.min(lim.max, 4000)), fund: pick(['chips', 'play', undefined]) });
        continue;
      }
      if (r < 0.05) { await b.leave(); seatOf[b.name] = null; await sleep(ri(0, 200)); await sitRandom(b); }
      else if (r < 0.08) {                     // drop the socket and come back on a new one
        const tid = b.tableId; b.close(); seatOf[b.name] = null;
        await sleep(ri(0, 300));
        const nb = await new Bot(srv, b.name).connect(); await nb.login();
        bots[b.name] = nb; wire(nb);
        const lim = TABLES[tid]; const rr = await nb.sit(tid, ri(lim.min, Math.min(lim.max, 5000)), pick(['chips', 'play']));
        if (!rr.__err) seatOf[nb.name] = tid; else note('rejoin_fail', rr.__err);
      }
      else if (r < 0.11) b.emit('sit_out', { roomId: b.tableId });
      else if (r < 0.14) b.emit('g:bender:spin', { bet: pick(BETS), mode: pick(['play', 'chips']) });
      else if (r < 0.15) b.emit('bonus:claim', {});
      else if (r < 0.16 && b.name === host.name) { const tid = pick([T1, T2]); b.emit('table_update', { tableId: tid, patch: { blinds: pick([{ sb: 10, bb: 20 }, { sb: 25, bb: 50 }, { sb: 50, bb: 100 }]) } }); }
      else if (r < 0.165 && b.name === host.name) { const tid = pick([T1, T2]); b.emit('table_pause', { tableId: tid, paused: true }); await sleep(ri(50, 300)); b.emit('table_pause', { tableId: tid, paused: false }); }
      else if (r < 0.17 && b.name === host.name) { const tid = pick([T1, T2]); const v = pick(names.slice(1)); if (seatOf[v] === tid) { b.emit('table_kick', { tableId: tid, key: v.toLowerCase() }); seatOf[v] = null; } }
    } catch (e) { note('chaos_err', e.message); }
  }
  const survived = srv.alive();
  clearInterval(auditor); clearInterval(ticker); await sleep(300);
  // everyone stands up; then all money must be back in banks/wallets
  let fin = null, fm = null, leftOnTables = [];
  if (survived) {
    for (const b of Object.values(bots)) { b.onState = null; if (seatOf[b.name]) await b.leave(seatOf[b.name]); }
    await sleep(800);
    fin = await audit(auditor_); fm = moneyTotal(fin);
    leftOnTables = fin.rooms.flatMap(r => r.players.filter(p => !p.isBot && (p.chips || (r.status === 'playing' && p.handBet))).map(p => `${r.id}:${p.name}:${p.chips}`));
  }
  const report = { seed: seed0, long: LONG, hands: fin ? handsOf(fin) : hands, audits, seconds: Math.round((Date.now() - t0) / 1000), survived, violations: violations.length, totalLeak: violations.reduce((s, v) => s + v.diff, 0),
    finalDiffVsLastBase: fm ? fm.total - base : null, leftOnTables, notes, noteSamples, topErrors: Object.entries(errCounts).sort((a, b) => b[1] - a[1]).slice(0, 15), crashLog: survived ? '' : srv.logText().split('\n').filter(l => /Error|at /.test(l)).slice(0, 4).join(' | ') };
  fs.mkdirSync(RUN_ROOT, { recursive: true });
  fs.writeFileSync(path.join(RUN_ROOT, `fuzz-s${seed0}${LONG ? '-long' : ''}.json`), JSON.stringify({ report, violations }, null, 1));
  await srv.stop();
  return { report, violations };
}

(async () => {
  let res, err;
  try { res = await fuzz(); } catch (e) { err = e; }
  const rep = res && res.report;
  const need = () => { if (err) throw err; return rep; };
  await T.check('fuzz-server-survives-random-play', ['C2'], async () => { const r = need(); expect(r.survived, 'server process exited: ' + r.crashLog); return `${r.hands} hands, ${r.audits} audits, ${r.seconds}s`; }, { timeoutMs: 15 * 60000 });
  await T.check('fuzz-money-conserved-at-every-audit', [], async () => { const r = need(); expect(r.audits > 50, 'only ' + r.audits + ' audits ran'); expect(r.violations === 0, `${r.violations} violations, total leak ${r.totalLeak} (report in tests/v2/runs/fuzz-s${seed0}.json)`); });
  await T.check('fuzz-no-table-stalls', [], async () => { const r = need(); expect(!(r.notes.STALL), `${r.notes.STALL} stalled table(s): ${JSON.stringify(r.noteSamples.STALL)}`); });
  await T.check('fuzz-everyone-standing-up-returns-all-money-to-banks', [], async () => {
    const r = need(); expect(r.survived, 'server died');
    expect(!r.leftOnTables.length, 'money left at tables after everyone left: ' + r.leftOnTables.join(' '));
    expect(r.finalDiffVsLastBase === 0, 'final total differs from the last audited base by ' + r.finalDiffVsLastBase);
  });
  await T.done();
})();
