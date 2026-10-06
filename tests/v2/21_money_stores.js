'use strict';
// Mixed session: a chips night table + a Play $ night table + POKERPING, buy-ins from both funds, rebuys, cash-outs, slot spins, daily bonus,
// one SIGTERM restart in the middle of live hands and one SIGKILL right after a showdown. Every snapshot compares true holdings
// (bank + wallet + stacks + live bets) and the night settle-ups. Port of audit repro 21 (client-side flow bookkeeping dropped, invariants kept).
const { startServer, Bot, waitFor, sleep, audit, moneyTotal, suite, expect } = require('./lib');
const T = suite(__filename);
let seed = 2024;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const NAMES = ['Ann', 'Bob', 'Cat', 'Dee'], PP = 'POKERPING';
const hold = (a, k) => { let n = 0; for (const r of a.rooms) for (const p of r.players) if (!p.isBot && p.key === k) n += p.chips + (r.status === 'playing' && r.pot > 0 ? p.handBet : 0); return (a.bank[k] ?? 10000) + (a.wallet[k] ?? 1000000) + n; };
const holdings = a => Object.fromEntries(NAMES.map(n => [n.toLowerCase(), hold(a, n.toLowerCase())]));
const sameHoldings = (x, y) => NAMES.map(n => n.toLowerCase()).filter(k => x[k] !== y[k]).map(k => `${k} ${x[k]}->${y[k]}`).join(', ');

async function scenario() {
  const R = { snaps: {}, nights: {} };
  let srv, socks = [], T1, T2, N1, N2;
  const opts = { handDelayMs: 400, autoStartMs: 300, env: { HOST_GRACE_MS: '600000' } };
  const login = async (name, first) => { const b = await new Bot(srv, name).connect(); const r = first ? await b.signup() : await b.login(); if (r.__err) throw new Error('auth ' + name + ' ' + r.__err); socks.push(b); return b; };
  const drive = (b, aggr) => { b.onState = gs => {
    if (b.acting || !b.myTurn()) return; b.acting = true;
    setTimeout(() => {
      b.acting = false; if (!b.myTurn()) return;
      const me = b.me(), toCall = Math.max(0, b.gs.currentBet - me.roundBet), r = rnd();
      if (aggr && r < 0.35) b.act('raise', me.chips + me.roundBet);
      else if (r < 0.1 && toCall) b.act('fold');
      else if (r < 0.25) b.act('raise', b.gs.currentBet + 100);
      else b.act(toCall ? 'call' : 'check');
    }, 30);
  }; };
  const seat = async (name, table, amount, fund, aggr) => {
    const b = await login(name); const r = await b.sit(table, amount, fund);
    if (r.__err) { (R.errors ||= []).push(`sit ${name}@${table}: ${r.__err}`); return null; }
    drive(b, aggr); return b;
  };
  const rebuyLoop = async (bots, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      await sleep(150);
      for (const b of bots) { if (!b || !b.gs) continue; const me = b.me(); if (me && me.chips === 0 && (b.gs.status !== 'playing' || me.sittingOut)) b.emit('rebuy', { roomId: b.tableId, amount: b.tableId === T2 ? 1500 : 1000 }); }
    }
  };
  const closeAll = async () => { for (const b of socks) { b.onState = null; b.close(); } socks = []; await sleep(150); };
  const snap = async (label, obs) => { const a = await audit(obs); R.snaps[label] = { total: moneyTotal(a).total, hold: holdings(a), seated: a.rooms.flatMap(r => r.players.filter(p => !p.isBot && (p.chips || p.handBet)).map(p => `${r.id}:${p.name}:${p.chips}`)) }; };

  srv = await startServer(0, opts);
  try {
    const boot = {}; for (const n of NAMES) boot[n] = await login(n, true);
    const obs = boot.Ann;
    const c1 = await obs.req('table_create', { settings: { name: 'NightChips', mode: 'chips', buyIn: { min: 500, max: 20000, default: 2000 }, blinds: { sb: 25, bb: 50 }, rebuyLimit: 0, autoStart: false, actionTimerSec: 0 } }, 'table_created');
    const c2 = await boot.Bob.req('table_create', { settings: { name: 'NightPlay', mode: 'play', buyIn: { min: 500, max: 50000, default: 2000 }, blinds: { sb: 25, bb: 50 }, rebuyLimit: 0, autoStart: false, actionTimerSec: 0 } }, 'table_created');
    if (!c1.table || !c2.table) throw new Error('create tables: ' + (c1.__err || c2.__err));
    T1 = c1.table.id; N1 = c1.table.nightId; T2 = c2.table.id; N2 = c2.table.nightId;
    const s1 = [await seat('Ann', T1, 2000, 'chips'), await seat('Bob', T1, 2000, 'play', true), await seat('Cat', T1, 1500, 'chips')];
    const s2 = [await seat('Bob', T2, 3000, 'play'), await seat('Cat', T2, 2000, 'chips', true), await seat('Dee', T2, 2500, 'play')];
    const s3 = [await seat('Dee', PP, 1000, 'chips'), await seat('Ann', PP, 1500, 'chips', true)];
    s1[0].emit('table_start', { tableId: T1 }); s2[0].emit('table_start', { tableId: T2 });
    for (let i = 0; i < 6; i++) { boot.Ann.emit('g:bender:spin', { bet: 50, mode: 'chips' }); await sleep(60); boot.Dee.emit('g:bender:spin', { bet: 100, mode: 'play' }); await sleep(60); }
    boot.Cat.emit('bonus:claim', {});
    await rebuyLoop([...s1, ...s2, ...s3], 7000);
    if (s2[2]) { await s2[2].leave(T2); await sleep(200); s2[2] = await seat('Dee', T2, 1800, 'chips'); }
    if (s1[2]) { await s1[2].leave(T1); await sleep(200); }
    await rebuyLoop([...s1, ...s2, ...s3], 5000);
    for (const b of socks) b.onState = null;
    await sleep(800);
    await snap('idle', obs);
    // SIGTERM while hands are live: restart the bots' play, wait for a live pot on the chips table and one more, then stop acting and snapshot
    for (const b of [...s1, ...s2, ...s3]) if (b) drive(b, false);
    let live = false;
    for (let i = 0; i < 400 && !live; i++) { const a = await audit(obs); const lv = a.rooms.filter(r => [T1, T2, PP].includes(r.id) && r.status === 'playing' && r.pot > 0).map(r => r.id); live = lv.includes(T1) && lv.length >= 2 ? lv.join(',') : false; if (!live) await sleep(40); }
    for (const b of socks) b.onState = null;
    await snap('at-sigterm', obs); R.liveAtSigterm = live;
    await srv.stop('SIGTERM'); await closeAll();
    srv = await srv.restart();
    const o2 = await login('Ann'); await sleep(300);
    await snap('after-sigterm-restart', o2);
    // phase 2: re-seat, play, SIGKILL ~150 ms after a T1 showdown that moved money
    const t1b = [await seat('Ann', T1, 1000, 'chips'), await seat('Cat', T1, 1000, 'play', true)];
    const t2b = [await seat('Bob', T2, 1000, 'play'), await seat('Dee', T2, 1000, 'play', true)];
    const ppb = [await seat('Bob', PP, 800, 'chips', true), await seat('Cat', PP, 800, 'chips')];
    if (t1b[0]) t1b[0].emit('table_start', { tableId: T1 }); if (t2b[0]) t2b[0].emit('table_start', { tableId: T2 });
    await rebuyLoop([...t1b, ...t2b, ...ppb], 4000);
    let killed = null;
    for (let i = 0; i < 40 && !killed; i++) { const sd = await t1b[0].wait('showdown_result', 4000); if (sd && sd.pot > 150) { for (const b of socks) b.onState = null; await sleep(150); killed = sd; } }
    for (const b of socks) b.onState = null;
    await snap('at-sigkill', o2); R.killedAfterShowdown = !!killed;
    await srv.stop('SIGKILL'); await closeAll();
    srv = await srv.restart();
    const o3 = await login('Ann'), ob = await login('Bob'); await sleep(300);
    await snap('after-sigkill-restart', o3);
    const endN = async (b, tid) => { const p = b.wait('settle_up', 4000, d => d && d.tableId === tid); b.emit('table_end_night', { tableId: tid }); return (await p) || { __err: 'timeout' }; };
    R.nights.T1 = await endN(o3, T1); R.nights.T2 = await endN(ob, T2);
    await sleep(300); await snap('final', o3);
  } finally { await closeAll(); await srv.stop().catch(() => {}); }
  return R;
}
(async () => {
  let R, err;
  try { R = await scenario(); } catch (e) { err = e; }
  const need = () => { if (err) throw err; return R; };
  await T.check('mixed-session-money-total-constant-while-idle-and-with-hands-live', [], async () => {
    const r = need(); expect(r.snaps.idle.total === r.snaps['at-sigterm'].total, `total ${r.snaps.idle.total} -> ${r.snaps['at-sigterm'].total} (live hands: ${r.liveAtSigterm})`);
  }, { timeoutMs: 240000 });
  await T.check('mixed-session-sigterm-midhand-restart-conserves-money-and-empties-seats', ['C3', 'C4'], async () => {
    const r = need(), a = r.snaps['at-sigterm'], b = r.snaps['after-sigterm-restart'];
    expect(b.total === a.total, `total money ${a.total} -> ${b.total} (${b.total - a.total}) across SIGTERM with live hands ${r.liveAtSigterm}; per player ${sameHoldings(a.hold, b.hold)}`);
    expect(sameHoldings(a.hold, b.hold) === '', 'players differ: ' + sameHoldings(a.hold, b.hold));
    expect(!b.seated.length, 'still seated after the restart: ' + b.seated.join(' '));
  });
  await T.check('mixed-session-sigkill-after-showdown-keeps-every-players-holdings', ['N3', 'C4'], async () => {
    const r = need(), a = r.snaps['at-sigkill'], b = r.snaps['after-sigkill-restart'];
    expect(r.killedAfterShowdown, 'no T1 showdown with money moved before the kill (harness could not set up the kill)');
    expect(b.total === a.total && sameHoldings(a.hold, b.hold) === '', `total ${a.total} -> ${b.total}; per player ${sameHoldings(a.hold, b.hold)}`);
  });
  await T.check('mixed-session-end-night-settle-ups-are-zero-sum', ['M6'], async () => {
    const r = need();
    for (const k of ['T1', 'T2']) { const n = r.nights[k]; expect(n && !n.__err, `${k}: no settle_up (${n && n.__err})`); expect(n.zeroSum === true, `${k} settle_up zeroSum=${n.zeroSum} drift=${n.drift}`); }
  });
  await T.check('mixed-session-final-total-equals-total-before-the-restarts', [], async () => {
    const r = need(); expect(r.snaps.final.total === r.snaps['after-sigkill-restart'].total, `total ${r.snaps['after-sigkill-restart'].total} -> ${r.snaps.final.total} while ending the nights`);
  });
  await T.done();
})();
