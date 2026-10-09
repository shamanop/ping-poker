'use strict';
// Money hardening 2026-10-08, K2-4: what Ballot Bender PAYS is measured on the live money path (real ledger + ctx.money + the games registry + games/bender.js), not the constants it is built from.
//   node tests/money-1008-bender-pay.js      plain node: exit 0 on pass, 1 on fail. Every number below is read off the LEDGER, never off the game's own reply.
// Pins (each one fails the mutant the K2 critic named):
//   pay-1  a spin charges and pays in the currency it was played in and leaves the other currency exactly where it was          (K2 B2: every round settled in Cash)
//   pay-2  a bought round costs round(price * bet) on the ledger, for every bet level and both buys; price read from the engine config   (K2 B3: a buy priced rounded down)
//   pay-3  the win is the exact win in cents, rounded without bias: each round within one cent of bet * multiple, and over many 1c spins the
//          cents paid match the multiples won                                                                                           (K2 B4: a fractional win always rounds up)
//   pay-4  the measured return over many spins is the tuned ~98% in both currencies, base and bought rounds                              (K2 B7: every cluster pays double)
//   pay-5  no round ever pays more than 10,000 x the bet, and a round that reaches the cap pays exactly the cap                          (K2 B5: the clamp is gone)
// Run against a tree carrying one of those mutants and the file must exit 1.
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bender-pay-'));
process.env.BENDER_CFG_FILE = path.join(tmp, 'no-such-bender-cfg.json');     // the live config file: absent, the engine runs on its defaults
const E = require('../games/bender-engine.js');
const games = require('../games');
const { open: openLedger } = require('../money/ledger');
const { createService } = require('../money/service');
const { createGameMoney } = require('../transport/game-money');
const { createWalletAdapter } = require('../transport/wallet-adapter');

let pass = 0, fail = 0;
const check = (name, ok, extra) => { if (ok) pass++; else { fail++; console.log('FAIL ' + name + (extra ? ': ' + extra : '')); } };
const BETS = [1, 2, 10, 20, 50, 100, 200, 500, 1000, 2500];
const CUR = ['play', 'chips'];

// A ledger-backed world: everything real except the socket layer. `seed` seeds the game's rng (the one seam ctx.rng gives every game).
let n = 0;
function world(seed) {
  const io = new EventEmitter(); io.sockets = { sockets: new Map() };
  let t = 1000000;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const ledger = openLedger(path.join(tmp, 'm' + (++n) + '.jsonl'), { fsync: 'none', log: () => {} });
  const service = createService(ledger);
  let reg = null;
  const onChange = (k) => { if (reg) reg.pushWallet(k); };
  const money = createGameMoney({ service, ledger, onChange, log: () => {} });
  const wallet = createWalletAdapter({ service, ledger, onChange, log: () => {} });
  reg = games({ io, wallet, money, service, now: clock.now, rng: E.rngFrom(seed), accounts: {}, tables: {}, rooms: {}, ledger: { log: () => {} } });
  const acct = (c) => (c === 'chips' ? 'bank:' : 'play:');
  const w = { ledger, clock, bal: (k, c) => ledger.balance(acct(c) + k, c), house: (c) => ledger.balance('house:bender', c) };
  w.fund = (k, v) => { service.ensureAccount(k); for (const c of CUR) { const d = v - w.bal(k, c); if (d) service.adminAdjust(k, d, c, 'test', 'fund:' + c + ':' + (++n)); } };
  w.sock = (k) => {
    service.ensureAccount(k);
    const s = new EventEmitter(); s.data = { acct: { key: k } }; s.out = [];
    const emit = s.emit.bind(s);
    s.send = (ev, p) => emit(ev, p);
    s.emit = (ev, p) => { if (ev === 'error' || ev === 'wallet' || ev.startsWith('g:')) { s.out.push([ev, p]); return true; } return emit(ev, p); };
    io.sockets.sockets.set(String(Math.random()), s); io.emit('connection', s);
    return s;
  };
  // one spin; returns what the LEDGER says happened: { res, error, cost, win, byCur: { play, chips } = balance deltas, lines }
  w.spin = (s, k, payload) => {
    const before = { play: w.bal(k, 'play'), chips: w.bal(k, 'chips') }, id0 = ledger.lastId, o0 = s.out.length;
    clock.advance(200); s.send('g:bender:spin', payload);
    const got = s.out.slice(o0), res = got.filter((o) => o[0] === 'g:bender:result').map((o) => o[1]).pop() || null, error = got.filter((o) => o[0] === 'error').map((o) => o[1]).pop() || null;
    const lines = [...ledger.entries(null, id0)].filter((l) => l.ref && l.ref.startsWith('bender:'));
    return { res, error, lines, d: { play: w.bal(k, 'play') - before.play, chips: w.bal(k, 'chips') - before.chips } };
  };
  return w;
}

// ---------------------------------------------------------------------------------------------------- pay-1 / pay-2 / pay-3 (per round, every bet, both modes, base + both buys)
{
  const w = world(20261008), s = w.sock('ann'); w.fund('ann', 1e12);
  const buys = [null, 'election', 'landslide'];
  const price = (b) => (b ? E.CFG.buyCost[b] : 1);
  let rounds = 0, wrongCur = 0, otherMoved = 0, badCost = 0, badNet = 0, badWin = 0, noLine = 0, badHouse = 0, sensitiveBuy = 0, errs = [];
  for (const mode of CUR) for (const buy of buys) for (const bet of BETS) for (let i = 0; i < 4; i++) {
    const h0 = { play: w.house('play'), chips: w.house('chips') };
    const r = w.spin(s, 'ann', { bet, mode, buyBonus: buy });
    if (!r.res) { errs.push(`${mode}/${buy}/${bet}: ${JSON.stringify(r.error)}`); continue; }
    rounds++;
    const other = mode === 'play' ? 'chips' : 'play';
    const cost = Math.round(price(buy) * bet);                                         // pay-2: the price in cents, rounded to nearest, from the ENGINE config not from the game file
    const lineCur = new Set(r.lines.map((l) => l.cur));
    if (!r.lines.length) noLine++;
    if (lineCur.size !== 1 || !lineCur.has(mode)) wrongCur++;                            // pay-1
    if (r.d[other] !== 0 || w.house(other) !== h0[other]) otherMoved++;                  // pay-1
    const win = r.d[mode] + cost;                                                      // what the ledger paid the player = delta + what was charged
    if (r.res.cost !== cost || (!buy && r.res.cost !== bet)) badCost++;                  // pay-2: the reply; the ledger side is the delta below
    if (r.d[mode] !== win - cost) badNet++;
    if (win !== r.res.totalWin) badWin++;                                              // the client was shown what the ledger paid
    const exact = r.res.totalWinMult * bet;
    if (!(win >= 0 && Math.abs(win - exact) < 1 + 1e-6)) badWin++;                       // pay-3: whole cents, within one cent of bet x multiple, never a different amount
    if (w.house(mode) - h0[mode] !== cost - win) badHouse++;
    if (buy && Math.round(price(buy) * bet) !== Math.floor(price(buy) * bet)) sensitiveBuy++;
  }
  check('pay-0 every spin of the matrix answered (no error)', errs.length === 0, errs.slice(0, 3).join(' | '));
  check('pay-0 the matrix is 2 modes x 3 kinds x 10 bets x 4', rounds === 240, String(rounds));
  check('pay-0 every round wrote a ledger line', noLine === 0, noLine + ' without');
  check('pay-1 every round is settled in the currency it was played in', wrongCur === 0, wrongCur + ' rounds in the other currency');
  check('pay-1 the other currency and its house account are untouched by a round', otherMoved === 0, otherMoved + ' rounds moved it');
  check('pay-2 the matrix hits bets where a price in cents is not whole and rounds up (the pin is sensitive)', sensitiveBuy > 0, String(sensitiveBuy));
  check('pay-2 every round cost is round(price x bet) (a bought round) or the bet (a base spin), on the reply', badCost === 0, badCost + ' wrong');
  check('pay-2 the player balance moved by exactly -cost + win, and the house by the opposite', badNet === 0 && badHouse === 0, `${badNet} / ${badHouse}`);
  check('pay-3 every win is whole cents within one cent of bet x multiple and equals what the client was shown', badWin === 0, badWin + ' wrong');
}

// pay-2, the ledger side by itself: a bought round at a bet where the price has a half-or-more fraction of a cent is charged the ROUNDED-UP amount
{
  const w = world(7), s = w.sock('bo'); w.fund('bo', 1e12);
  const found = [];
  for (const buy of ['election', 'landslide']) for (const bet of BETS) {
    const exact = E.CFG.buyCost[buy] * bet, up = Math.round(exact);
    if (up === Math.floor(exact)) continue;
    const staked = [];
    for (let i = 0; i < 3; i++) { const r = w.spin(s, 'bo', { bet, mode: 'chips', buyBonus: buy }); if (r.res) staked.push(r.lines.reduce((a, l) => a + (l.from === 'bank:bo' ? l.amount : 0), 0)); }
    found.push([buy, bet, up, staked]);
    check(`pay-2 ledger: ${buy} at bet ${bet} takes ${up} (price ${exact.toFixed(2)}) from the bank`, staked.length === 3 && staked.every((x) => x === up), JSON.stringify(staked));
  }
  check('pay-2 ledger: at least one buy/bet pair has a fractional price', found.length > 0, String(found.length));
}

// ---------------------------------------------------------------------------------------------------- pay-3 over many 1c spins: no bias in the rounding of the win
{
  const w = world(424242), s = w.sock('cy'); w.fund('cy', 1e12);
  const N = 8000; let paid = 0, exactSum = 0, fracRounds = 0, played = 0;
  for (let i = 0; i < N; i++) {
    const r = w.spin(s, 'cy', { bet: 1, mode: 'play' });
    if (!r.res) continue;
    played++; paid += r.d.play + 1; exactSum += r.res.totalWinMult * 1;
    if (r.res.totalWinMult * 1 % 1 > 1e-9) fracRounds++;
  }
  // the sum of unbiased roundings has sd <= sqrt(N)/2 = 45; a rounding up always (B4) is off by +(1 - f) per fractional round, hundreds of cents here
  check('pay-3 sample is big enough to see a rounding bias', played === N && fracRounds > 500, `played ${played}, fractional ${fracRounds}`);
  check('pay-3 cents paid over 8000 1c spins = the multiples won, within 5 sd (unbiased rounding)', Math.abs(paid - exactSum) < 5 * Math.sqrt(N) / 2, `paid ${paid}, exact ${exactSum.toFixed(1)}, diff ${(paid - exactSum).toFixed(1)}, fractional rounds ${fracRounds}`);
}

// ---------------------------------------------------------------------------------------------------- pay-4 the measured return, both currencies, base and bought
{
  const total = {};
  for (const [name, mode, buy, N, bet] of [['base/play', 'play', null, 30000, 100], ['base/chips', 'chips', null, 30000, 100], ['election/chips', 'chips', 'election', 6000, 100], ['landslide/play', 'play', 'landslide', 3000, 100]]) {
    const w = world(5 + N + bet), s = w.sock('di'); w.fund('di', 1e12);
    let cost = 0, win = 0;
    for (let i = 0; i < N; i++) { const r = w.spin(s, 'di', { bet, mode, buyBonus: buy }); if (!r.res) continue; const c = Math.round((buy ? E.CFG.buyCost[buy] : 1) * bet); cost += c; win += r.d[mode] + c; }
    total[name] = { cost, win, rtp: win / cost };
  }
  for (const [name, t] of Object.entries(total)) {
    // the game is tuned to 98% (bought rounds to the same return); 30000 rounds carry about +-4 points of noise, a doubled cluster pay is +100 points; the band is tight enough for any edit that matters
    check(`pay-4 measured return ${name} is the tuned ~98% (got ${(100 * t.rtp).toFixed(1)}% over ${(t.cost / 100).toFixed(0)} staked)`, t.rtp > 0.80 && t.rtp < 1.16, (100 * t.rtp).toFixed(1) + '%');
  }
}

// ---------------------------------------------------------------------------------------------------- pay-5 the 10,000 x clamp, settled on the live path
// A cap round is a 1-in-millions event on the shipped math, so the engine config is set to a pay table that
// reaches the cap on most rounds (E.setConfig, the engine's own door; the game still resolves and settles through the live path). The ledger must then show the cap, never more, and a capped round pays exactly cap x bet.
{
  const MAX = E.MAX_WIN_X;
  check('pay-5 the engine cap is 10,000x', MAX === 10000, String(MAX));
  const w = world(11), s = w.sock('ed'); w.fund('ed', 1e12);
  const huge = {}; for (const sym of E.REG) huge[sym] = [1e5, 1e5, 1e5, 1e5, 1e5, 1e5, 1e5, 1e5, 1e5];
  E.setConfig({ pay: huge });                      // at the engine, not through the admin path: that path refuses an unmeasured pay table (the payback ceiling), and must keep doing so
  let rounds = 0, capped = 0, over = 0, notExact = 0, worst = 0, errs = [];
  try {
    for (const [mode, buy] of [['chips', null], ['play', null], ['chips', 'election'], ['play', 'landslide']]) for (const bet of [1, 100, 2500]) for (let i = 0; i < 40; i++) {
      const r = w.spin(s, 'ed', { bet, mode, buyBonus: buy });
      if (!r.res) { errs.push(JSON.stringify(r.error)); continue; }
      rounds++;
      const win = r.d[mode] + r.res.cost;                                            // what the ledger paid
      worst = Math.max(worst, win / bet);
      if (win > MAX * bet) over++;
      if (r.res.maxed) { capped++; if (win !== MAX * bet) notExact++; }
    }
  } finally { E.resetConfig(); }
  check('pay-5 every cap-test spin answered', errs.length === 0, errs.slice(0, 2).join(' | '));
  check('pay-5 no round ever pays more than 10,000 x the bet on the ledger', rounds === 480 && over === 0, `rounds ${rounds}, over ${over}, worst ${worst}x`);
  check('pay-5 the test reaches the cap (the pin is sensitive)', capped >= 100, `capped ${capped} of ${rounds}`);
  check('pay-5 a round that reaches the cap pays exactly cap x bet on the ledger', notExact === 0, `${notExact} wrong`);
}

console.log(`money-1008-bender-pay.js: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
