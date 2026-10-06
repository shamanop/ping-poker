'use strict';
// C1/C5/H8: the unauthenticated legacy path (join_game, bank_set, check_balance, create_demo, set_pause, reset_table, start_game). Audit repros 08, 09.
// 1-4: a socket that never signs in must not seat, edit or mint anything (9440541 already needs an account for these).
// 5+: v2 removes the legacy events entirely: even a signed-in player or the admin sending them must change no money, seat or room.
const { startServer, Bot, waitFor, sleep, audit, moneyTotal, suite, expect } = require('./lib');
const T = suite(__filename);
const snap = a => JSON.stringify({ bank: a.bank, wallet: a.wallet, n: a.accounts.length, rooms: a.rooms.map(r => ({ id: r.id, status: r.status, pot: r.pot, hand: r.handNum, players: r.players.map(p => [p.name, p.chips, p.handBet, p.connected]) })) });
const diffOf = (x, y) => { const a = JSON.parse(x), b = JSON.parse(y); const out = [];
  // a missing row is worth the lazy default (10,000 chips / 1,000,000 Play cents), so creating it is not a money change
  for (const k of new Set([...Object.keys(a.bank), ...Object.keys(b.bank)])) { a.bank[k] = a.bank[k] ?? 10000; b.bank[k] = b.bank[k] ?? 10000; }
  for (const k of new Set([...Object.keys(a.wallet), ...Object.keys(b.wallet)])) { a.wallet[k] = a.wallet[k] ?? 1000000; b.wallet[k] = b.wallet[k] ?? 1000000; } for (const k of Object.keys(a.bank).concat(Object.keys(b.bank))) if (a.bank[k] !== b.bank[k]) out.push(`bank.${k} ${a.bank[k]}->${b.bank[k]}`); for (const k of Object.keys(b.wallet)) if (a.wallet[k] !== b.wallet[k]) out.push(`wallet.${k} ${a.wallet[k]}->${b.wallet[k]}`); if (a.rooms.length !== b.rooms.length) out.push(`rooms ${a.rooms.length}->${b.rooms.length}`); for (const r of b.rooms) { const o = a.rooms.find(q => q.id === r.id); if (!o || JSON.stringify(o) !== JSON.stringify(r)) out.push(`room ${r.id} changed (${JSON.stringify(r.players).slice(0, 120)})`); } return out.slice(0, 4).join('; '); };

(async () => {
  const srv = await startServer(0);
  const chris = await new Bot(srv, 'chris').connect(); await chris.claimAdmin();
  const alice = await new Bot(srv, 'Alice').connect(); await alice.signup();
  const evan = await new Bot(srv, 'Evan').connect(); await evan.signup();
  const s = await alice.sit('POKERPING', 2000); if (s.__err) throw new Error('alice sit ' + s.__err);
  await sleep(300);
  const A = () => audit(chris);

  await T.check('unauthenticated-join-game-as-the-admin-name-does-not-seat', ['C1'], async () => {
    const before = snap(await A());
    const evil = await new Bot(srv, 'evil').connect();
    const j = await evil.req('join_game', { name: 'Chris', avatar: 'x', password: 'ping' }, 'room_joined', 1500);
    await sleep(200);
    const d = diffOf(before, snap(await A())); evil.close();
    expect(j.__err && !d, `seated as Chris: ${j.__err ? '' : JSON.stringify(j).slice(0, 120)} ${d}`);
  });
  await T.check('unauthenticated-bank-set-does-not-edit-the-bank', ['C1'], async () => {
    const before = snap(await A());
    const evil = await new Bot(srv, 'evil2').connect();
    evil.emit('bank_set', { name: 'Mallory', balance: 100000000 }); evil.emit('bank_set', { name: 'Alice', balance: 100000000 });
    await sleep(300);
    const d = diffOf(before, snap(await A())); evil.close();
    expect(!d, d);
  });
  await T.check('unauthenticated-join-game-with-a-seated-name-cannot-take-the-seat', ['C1'], async () => {
    const before = snap(await A());
    const evil = await new Bot(srv, 'evil3').connect();
    const j = await evil.req('join_game', { name: 'Alice', avatar: 'x', password: 'ping' }, 'room_joined', 1500);
    await sleep(200);
    const d = diffOf(before, snap(await A())); evil.close();
    expect(j.__err && !d, `took over Alice's seat: ${d} ${alice.errors.slice(-1)[0] || ''}`);
  });
  await T.check('unauthenticated-check-balance-and-create-demo-mint-nothing', ['C5'], async () => {
    const before = snap(await A()), t0 = moneyTotal(await A()).total;
    const m = await new Bot(srv, 'minter').connect();
    for (let i = 0; i < 20; i++) m.emit('check_balance', { name: 'sock' + i });
    m.emit('create_demo', { name: 'demoer', avatar: 'x' });
    await sleep(500);
    const a = await A(); const d = diffOf(before, snap(a)); m.close();
    expect(!d && moneyTotal(a).total === t0, `minted ${moneyTotal(a).total - t0}: ${d}`);
  });

  // v2: legacy events are gone. Signed-in callers (and the admin) change nothing.
  const legacy = [
    ['join_game', 'Evan', { avatar: 'x', password: 'ping', name: 'Evan' }, ['C1', 'C5']],
    ['create_demo', 'chris', { avatar: 'x', name: 'Evan' }, ['C5']],
    ['check_balance', 'Evan', { name: 'brand-new-name' }, ['C5']],
    ['start_game', 'Alice', { roomId: 'POKERPING', blindInterval: 60000 }, ['M5']],
    ['set_pause', 'chris', { paused: true }, ['C1']],
    ['reset_table', 'chris', { amount: 12345 }, ['H8']],
    ['bank_set', 'chris', { name: 'Evan', balance: 99999999 }, ['H5']],
  ];
  await srv.stop();
  for (const [ev, whoName, payload, bugs] of legacy) {
    await T.check(`v2-legacy-event-${ev}-is-ignored-and-changes-nothing`, bugs, async () => {
      const s2 = await startServer(0, { autoStartMs: 60000 });       // fresh server per event so one broken event cannot hide another; no auto start, so only start_game could deal
      let who2 = null;
      try {
        const c = await new Bot(s2, 'chris').connect(); await c.claimAdmin();
        const al = await new Bot(s2, 'Alice').connect(); await al.signup();
        const ev2 = await new Bot(s2, 'Evan').connect(); await ev2.signup();
        const r = await al.sit('POKERPING', 2000); if (r.__err) throw new Error('alice sit ' + r.__err);
        if (ev === 'start_game') {            // the host of POKERPING is its first legacy joiner
          const o = new Bot(s2, 'Olga'); await o.connect(); await o.signup(); const j = await o.req('join_game', { avatar: 'x', password: 'ping' }, 'room_joined', 1500);
          if (j.__err) { const r2 = await o.sit('POKERPING', 2000); if (r2.__err) throw new Error('olga sit ' + r2.__err); }
          who2 = o;
        }
        await sleep(300);
        const who = whoName === 'chris' ? c : whoName === 'Alice' ? (who2 || al) : ev2;
        const before = snap(await audit(c));
        if (ev === 'reset_table') { c.emit('set_pause', { paused: true }); await sleep(150); }
        who.emit(ev, payload);
        await sleep(500);
        if (ev === 'reset_table') { c.emit('set_pause', { paused: false }); await sleep(100); }
        const d = diffOf(before, snap(await audit(c)));
        expect(!d, `${ev} changed state: ${d}`);
        expect(!who.events.some(e => e.ev === 'room_joined'), `${ev} produced room_joined (a legacy seat or demo room was created)`);
        if (ev === 'set_pause') expect(!(al.gs && al.gs.paused), 'set_pause paused the table');
      } finally { await s2.stop(); }
    });
  }
  await T.done();
})();
