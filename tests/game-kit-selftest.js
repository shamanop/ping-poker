'use strict';
// SELF-TEST OF THE KIT: a kit that has never failed proves nothing. A minimal two-step game (deal: stake into escrow, reveal: settle) is played through
// tests/game-kit.js once as written (it must PASS every check) and then in deliberately broken variants (VARIANTS) and broken whole games (TOYS); each variant must FAIL the check named for it.
//   node tests/game-kit-selftest.js        exit 0 when the good toy passes and every broken one is caught on its check
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const K = require('./game-kit.js');
const { Refused } = K;

const BETS = [100, 500, 1000];
let backdoor = null;                    // the service of the live kit world, for the variants that cheat
const persisted = new Map();            // data dir -> open rounds that outlive a restart (variant redraw: a record kept in a file)
let carried = 0;                        // a result kept in memory across a restart (variant keepdoomed); init() does not clear it on purpose

function makeToy(variant) {
  const done = new Map();               // roundId -> win paid (variant doublepay)
  let C = null;
  let rec = new Map();                  // account key -> the open round { roundId, cur, bet }
  const keyOf = (s) => String(s.data.acct.key).toLowerCase();
  const bad = (socket, code) => socket.emit('error', { code, game: 'toy' });
  const mod = {
    id: 'toy', name: 'Toy', kind: 'solo',
    init(ctx) {
      C = ctx; done.clear();
      if (variant === 'redraw') { const d = ctx.files && ctx.files.dir; if (!persisted.has(d)) persisted.set(d, new Map()); rec = persisted.get(d); } else rec = new Map();
    },
    recover(rounds, ctx) { if (variant === 'bootbonus') for (const r of rounds) ctx.money.settle(r.key, r.cur, r.roundId, { win: r.amount * 2, stake: r.amount }); },   // boot pays double
    audit() { return { openRounds: [...rec.entries()].map(([key, r]) => ({ key, cur: r.cur, roundId: r.roundId, amount: variant === 'varmoney' ? 0 : r.bet })).filter((r) => r.amount > 0), pools: {} }; },
    handlers: {
      deal(socket, p) {
        const key = keyOf(socket);
        const mode = p && p.mode, bet = p && p.bet;
        if (mode !== 'play' && mode !== 'chips') return bad(socket, 'bad_mode');
        if (variant === 'nomax' ? !(Number.isSafeInteger(bet) && bet > 0) : !(typeof bet === 'number' && BETS.includes(bet))) return bad(socket, 'bad_bet');
        if (rec.has(key) && variant !== 'twoopen') return bad(socket, 'run_open');
        const roundId = crypto.randomBytes(6).toString('hex');
        if (variant === 'varmoney') {
          if (C.money.balance(key, mode) < bet) return bad(socket, 'funds');   // the stake is only a number in this module until the reveal
        } else {
          try { C.money.open(key, mode, roundId, bet); } catch (e) { return bad(socket, e && e.code === 'funds' ? 'funds' : 'internal'); }
        }
        rec.set(key, { roundId, cur: mode, bet });
        socket.emit('g:toy:dealt', { roundId });
      },
      reveal(socket, p) {
        const key = keyOf(socket), id = p && p.roundId;
        if (variant === 'doublepay' && done.has(id)) {                          // a second reveal pays again under a fresh ref
          const w = done.get(id);
          try { C.money.round(key, 'chips' === (p.mode) ? 'chips' : (rec.lastCur || 'chips'), id + 'p' + crypto.randomBytes(3).toString('hex'), { cost: 0, win: w }); } catch {}
          return socket.emit('g:toy:result', { roundId: id, win: w });
        }
        const r = rec.get(key);
        if (!r || r.roundId !== id) return bad(socket, 'no_run');
        const hit = variant === 'keepdoomed' ? true : C.rng() < 0.5;
        const win = hit ? r.bet * 192 / 100 : 0;
        const cur = variant === 'wrongmode' && (p.mode === 'play' || p.mode === 'chips') ? p.mode : r.cur;   // closes in whatever mode the client says
        rec.lastCur = r.cur;
        if (variant === 'early') {                                              // tells the client first, asks the ledger second, ignores the answer
          socket.emit('g:toy:result', { roundId: id, win });
          try { C.money.settle(key, cur, id, { win, stake: r.bet }); } catch {}
          rec.delete(key); return;
        }
        try {
          if (variant === 'varmoney') C.money.round(key, cur, id, { cost: r.bet, win });
          else if (variant === 'otherhouse') { C.money.settle(key, cur, id, { win: 0, stake: r.bet }); if (win) backdoor.houseRound('coldcall', key, 0, win, cur, `coldcall:${key}:${id}`); }
          else if (variant === 'wrongmode') C.money.settle(key, cur, id, { win });                  // no stake given: a settle in the wrong currency is a free round there
          else if (variant === 'keepdoomed') { const extra = carried; carried = 0; C.money.settle(key, cur, id, { win: win + extra, stake: r.bet }); }
          else C.money.settle(key, cur, id, { win, stake: r.bet });
        } catch (e) {
          if (variant === 'redraw' && e && e.code === 'round_closed') {         // the record outlived the restart: the round is played again with a new draw and a fresh ref
            try { C.money.round(key, r.cur, id + 'r' + crypto.randomBytes(3).toString('hex'), { cost: 0, win: r.bet * 2 }); } catch {}
            rec.delete(key); return socket.emit('g:toy:result', { roundId: id, win: r.bet * 2 });
          }
          if (variant === 'errresult') { bad(socket, 'internal'); return socket.emit('g:toy:result', { roundId: id, win }); }   // reports the money error AND shows the win
          if (variant === 'keepdoomed') carried += win;                         // the result the ledger refused is kept to be paid with the next round
          return bad(socket, 'internal');
        }
        rec.delete(key);
        if (variant === 'doublepay') done.set(id, win);
        socket.emit('g:toy:result', { roundId: id, win });
      },
    },
  };
  return mod;
}

function adapterFor(variant) {
  const mod = makeToy(variant);
  return {
    id: 'toy', mod, modPath: 'toy.js', example: variant !== 'unregistered' || undefined, oneOpen: true, playVariants: 1,
    files: (dir) => ({ dir }),
    bets: { good: BETS, min: 100, max: 1000 },
    open: (cur, bet) => ({ ev: 'deal', payload: { mode: cur, bet } }),
    play(g, sock, { cur, bet }) {
      const d = g.call(sock, 'deal', { mode: cur, bet });
      const r = g.call(sock, 'reveal', { roundId: d.roundId, mode: cur });
      return { roundId: d.roundId, cost: bet, win: r.win };
    },
    heldPoints: [{
      name: 'dealt',
      hold(g, sock, { cur, bet }) { const d = g.call(sock, 'deal', { mode: cur, bet }); return { roundId: d.roundId, cost: bet, bootWin: bet }; },
      finish(g, sock, held) { const r = g.call(sock, 'reveal', { roundId: held.roundId, mode: held.cur }); return { win: r.win }; },
    }],
  };
}

// variant -> the check that must fail ('unregistered' makes the whole game unusable: only registration is asserted)
const VARIANTS = [
  ['wrongmode', 'mix', 'settles in the mode the client sends, not the one it opened in'],
  ['early', 'errors', 'tells the client before the ledger answered and swallows the refusal'],
  ['doublepay', 'replay', 'a second reveal pays again under a fresh ref'],
  ['keepdoomed', 'errors', 'keeps the result the ledger refused in memory and pays it with the next round'],
  ['otherhouse', 'escrow', "pays from another game's house under another game's ref"],
  ['varmoney', 'escrow', 'holds the stake in a variable, no escrow while the round is open'],
  ['nomax', 'input', 'accepts any positive bet'],
  ['twoopen', 'sockets', 'two sockets of one account both get a round'],
  ['bootbonus', 'restart', 'boot recovery pays twice the stake instead of refunding it'],
  ['redraw', 'restart', 'a round record outlives the restart and the round is played again under a fresh ref'],
  ['errresult', 'errors', 'on a money error sends the error event AND the result event (the client is shown a win nobody paid)'],
  ['unregistered', 'registration', 'not in MODULES, house account not registered'],
];

// broken toy GAMES (tests/kit-toys/<name>.js + <name>.kit.js, written by the Opus critic R2-E, each a whole game with its own adapter) -> the check that must fail
const TOYS = [
  ['proxykey', 'identity', 'plays the round on the account key the CLIENT names (payload.key)'],
  ['freeflip', 'carry', 'a boost token earned by losing a Chips flip doubles the pay of a later Cash flip'],
  ['dropper', 'disconnect', 'forgets the open round when the socket drops and does not refund it: the stake sits in an escrow nothing knows'],
  ['cashbug', 'refuse', "the adapter says currencies: ['chips'] and the game takes Cash bets (and pays them double)"],
  ['mempot', 'carry', '10% of every stake feeds a jackpot kept in a module variable, one number for Chips and Cash'],
];
function runToy(name) {
  K.RESULTS.length = 0;
  const file = path.join(__dirname, 'kit-toys', name + '.kit.js');
  K.runAdapter(K.finishAdapter(require(file), file));
  return K.RESULTS.filter((r) => !r.ok).map((r) => r.check + (r.cur ? '/' + r.cur : ''));
}

let failed = 0;
const rows = [];
function runVariant(variant) {
  K.RESULTS.length = 0;
  const A = K.finishAdapter(adapterFor(variant), __filename);
  K.runAdapter(A, { onBoot: (w) => { backdoor = w.service; } });
  carried = 0;
  return K.RESULTS.filter((r) => !r.ok).map((r) => r.check + (r.cur ? '/' + r.cur : ''));
}

const good = runVariant('ok');
rows.push(['ok', '(none)', good.length ? 'FAIL: ' + good.join(',') : 'PASS: every check passes', !good.length]);
for (const [v, check, what] of VARIANTS) {
  const f = runVariant(v);
  const hit = f.some((x) => x === check || x.startsWith(check + '/'));
  rows.push([v, check, hit ? `caught on ${check} (all failing: ${[...new Set(f)].join(',')})` : `NOT CAUGHT on ${check}; failing: ${f.join(',') || 'nothing'}`, hit, what]);
}
for (const [v, check, what] of TOYS) {
  const f = runToy(v);
  const hit = f.some((x) => x === check || x.startsWith(check + '/'));
  rows.push([v, check, hit ? `caught on ${check} (all failing: ${[...new Set(f)].join(',')})` : `NOT CAUGHT on ${check}; failing: ${f.join(',') || 'nothing'}`, hit, what]);
}
console.log('variant         expected-check  result');
for (const r of rows) { console.log(`${r[3] ? 'PASS' : 'FAIL'} ${r[0].padEnd(13)} ${String(r[1]).padEnd(14)} ${r[2]}${r[4] ? '  -- ' + r[4] : ''}`); if (!r[3]) failed++; }
console.log(`kit self-test: ${rows.length - failed}/${rows.length} as expected`);
try { fs.rmSync(K.BASE, { recursive: true, force: true }); } catch {}
process.exit(failed ? 1 : 0);
