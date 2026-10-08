'use strict';
// P6 W3b A5: Ballot Bender never tells a result the ledger did not write (ADD-A-GAME.md rule 4). A real ledger + service + ctx.money + wallet adapter +
// the games registry + games/bender.js on a temp file; the failure is injected at service.houseRound, the one call both Bender paths end in.
// Plain node: exit 0 on pass, 1 on fail.
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');
const { open, MoneyError } = require('../../money/ledger');
const { createService } = require('../../money/service');
const { createGameMoney } = require('../../transport/game-money');
const { createWalletAdapter } = require('../../transport/wallet-adapter');
const games = require('../../games');
const bender = require('../../games/bender.js');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'eq') + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); };
const ok = (c, m) => { if (!c) throw new Error(m || 'not ok'); };
const tick = () => new Promise((r) => setImmediate(r));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bender-money-'));
process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

function world(rng) {
  bender._history.clear();                 // the module keeps its per-account history in memory, shared by every world of this process
  const ledger = open(path.join(dir, 'm' + Math.random().toString(36).slice(2) + '.jsonl'), { fsync: 'none', log: () => {} });
  const service = createService(ledger);
  for (const k of ['ann', 'poor']) service.ensureAccount(k);
  service.adminAdjust('poor', -(service.START_PLAY - 5), 'play', 'test: leave 5 cents', 'test:poor');
  let reg = null;
  const onChange = (k) => { if (reg) reg.pushWallet(k); };
  const gm = createGameMoney({ service, ledger, onChange, log: () => {} });
  const wallet = createWalletAdapter({ service, ledger, onChange, log: () => {} });
  const io = new EventEmitter(); io.sockets = { sockets: new Map() };
  let now = 1000000;
  reg = games({ io, wallet, money: gm, service, modules: [bender], accounts: {}, tables: {}, rooms: {}, now: () => now, rng });
  const sock = (key) => {
    const s = new EventEmitter(); s.data = { acct: { key } }; s.out = [];
    const emit = s.emit.bind(s);
    s.send = (ev, p) => emit(ev, p);
    s.emit = (ev, p) => { if (ev === 'error' || ev === 'wallet' || ev.startsWith('g:')) { s.out.push([ev, p]); return true; } return emit(ev, p); };
    io.sockets.sockets.set(String(Math.random()), s); io.emit('connection', s);
    return s;
  };
  const spin = (s, p) => { now += 500; s.send('g:bender:spin', p); };
  return { ledger, service, wallet, sock, spin, reg };
}
const evs = (s, ev) => s.out.filter((o) => o[0] === ev).map((o) => o[1]);
const roundLines = (w, key) => [...w.ledger.entries((e) => typeof e.ref === 'string' && e.ref.startsWith(`bender:${key}:`))];
// a failing ledger: houseRound refuses with a disk-style error (what a fence or a full disk does) until `failing` is cleared
function breakLedger(w) {
  const real = w.service.houseRound; const st = { failing: true, calls: 0 };
  w.service.houseRound = (...a) => { st.calls++; if (st.failing) throw new MoneyError('io_error', { why: 'disk' }); return real(...a); };
  return st;
}

(async () => {
  // a seeded rng so the test can look for a winning and a losing spin
  let seed = 12345; const rng = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

  await t('a spin is ONE ledger line under bender:<key>:<roundId>: the cost and the win together, and the result carries the ledger balance', async () => {
    const w = world(rng); const s = w.sock('ann');
    const bal0 = w.ledger.balance('play:ann', 'play');
    let res = null;
    for (let i = 0; i < 200 && !(res && res.totalWin > 0); i++) { w.spin(s, { bet: 100, mode: 'play' }); await tick(); res = evs(s, 'g:bender:result').pop(); }
    ok(res && res.totalWin > 0, 'a winning spin was found');
    const lines = roundLines(w, 'ann');
    const mine = lines.filter((e) => e.ref === `bender:ann:${res.roundId}`);
    eq(new Set(mine.map((x) => x.id)).size, 1, 'one ledger line for the round');
    ok(mine.every((x) => x.batchRef === `bender:ann:${res.roundId}`), 'a batch: stake and win are legs of the same line');
    eq(mine.map((x) => [x.from, x.to, x.amount, x.reason]), [['play:ann', 'house:bender', res.cost, 'bender:spend'], ['house:bender', 'play:ann', res.totalWin, 'bender:credit']].filter((x) => x[2] > 0));
    ok(w.ledger.balance('play:ann', 'play') === res.wallet.play, 'the result wallet is the ledger balance');
    // nothing is parked in the adapter and nothing extra lands on the next tick
    eq(w.wallet.pendingCount(), 0); const n = [...w.ledger.entries()].length; await tick(); eq([...w.ledger.entries()].length, n);
    ok(bal0 !== undefined);
  });

  await t('the ledger refuses the round (disk / fence): the client gets an error and NO result, and the ledger holds none of the round', async () => {
    const w = world(rng); const s = w.sock('ann');
    const before = w.ledger.balance('play:ann', 'play'), idBefore = w.ledger.lastId;
    const st = breakLedger(w);
    for (const bet of [100, 100, 100]) { w.spin(s, { bet, mode: 'play' }); await tick(); await tick(); }
    ok(st.calls >= 3, 'the ledger was asked');
    eq(evs(s, 'g:bender:result').length, 0, 'no result was told');
    const errs = evs(s, 'error'); eq(errs.length, 3); ok(errs.every((x) => x.game === 'bender' && x.code === 'bad_request' && x.message === 'Could not place that bet'), JSON.stringify(errs[0]));
    eq(w.ledger.lastId, idBefore, 'not one line was written');
    eq(w.ledger.balance('play:ann', 'play'), before);
    eq(roundLines(w, 'ann').length, 0);
    eq(w.wallet.pendingCount(), 0, 'nothing is parked in the adapter either');
    // the history only holds rounds the ledger wrote
    s.send('g:bender:history'); eq(evs(s, 'g:bender:history').pop().rounds, []);
    // and the table recovers once the ledger does
    st.failing = false; w.spin(s, { bet: 100, mode: 'play' }); await tick();
    eq(evs(s, 'g:bender:result').length, 1); eq(roundLines(w, 'ann').length, 1);
  });

  await t('the same refusal in Chips', async () => {
    const w = world(rng); const s = w.sock('ann');
    const before = w.ledger.balance('bank:ann', 'chips'), idBefore = w.ledger.lastId;
    breakLedger(w);
    w.spin(s, { bet: 100, mode: 'chips' }); await tick(); await tick();
    eq(evs(s, 'g:bender:result').length, 0); eq(evs(s, 'error').length, 1);
    eq(w.ledger.lastId, idBefore); eq(w.ledger.balance('bank:ann', 'chips'), before);
  });

  await t('a player who cannot pay still gets the funds error (message per currency), no result, no line', async () => {
    const w = world(rng); const s = w.sock('poor');
    const idBefore = w.ledger.lastId;
    w.spin(s, { bet: 100, mode: 'play' }); await tick();
    const e = evs(s, 'error').pop(); eq([e.code, e.message, e.game], ['funds', 'Not enough Cash', 'bender']);
    eq(evs(s, 'g:bender:result').length, 0); eq(w.ledger.lastId, idBefore);
  });

  // P6 W3b fix round 2
  await t('D6: a ledger refusal that happens ONCE loses nothing: error, no result, no stake taken, no line (the round is one ledger call, not a spend and a credit)', async () => {
    const w = world(rng); const s = w.sock('ann');
    const before = w.ledger.balance('play:ann', 'play'), idBefore = w.ledger.lastId;
    const real = w.service.houseRound; let fails = 1;
    w.service.houseRound = (...a) => { if (fails-- > 0) throw new MoneyError('io_error', { why: 'disk' }); return real(...a); };
    w.spin(s, { bet: 100, mode: 'play' }); await tick(); await tick();
    eq(evs(s, 'g:bender:result').length, 0, 'no result'); eq(evs(s, 'error').map((x) => [x.code, x.message]), [['bad_request', 'Could not place that bet']]);
    eq(w.ledger.balance('play:ann', 'play'), before, 'no stake taken'); eq(w.ledger.lastId, idBefore, 'no line'); eq(roundLines(w, 'ann').length, 0);
    eq(w.wallet.pendingCount(), 0); s.send('g:bender:history'); eq(evs(s, 'g:bender:history').pop().rounds, []);
  });

  await t('D8: a round whose cost rounds to 0 (a bonus priced below half a cent at the lowest bet) is refused before any write: bad_request, no result, no line, no history', async () => {
    const Eng = require('../../games/bender-engine.js');
    const w = world(rng); const s = w.sock('ann'); const keep = Eng.CFG.buyCost.election; Eng.CFG.buyCost.election = 0.4;
    try {
      const bet = bender.betLevels[0], before = w.ledger.balance('play:ann', 'play'), idBefore = w.ledger.lastId;
      for (const mode of ['play', 'chips']) { w.spin(s, { bet, mode, buyBonus: 'election' }); await tick(); await tick(); }
      eq(evs(s, 'g:bender:result').length, 0, 'no result'); eq(evs(s, 'error').map((x) => [x.code, x.message]), [['bad_request', 'Could not place that bet'], ['bad_request', 'Could not place that bet']]);
      eq(w.ledger.lastId, idBefore, 'nothing written'); eq(w.ledger.balance('play:ann', 'play'), before);
      s.send('g:bender:history'); eq(evs(s, 'g:bender:history').pop().rounds, [], 'no history entry');
    } finally { Eng.CFG.buyCost.election = keep; }
  });

  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
