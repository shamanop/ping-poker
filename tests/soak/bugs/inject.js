'use strict';
// Seeded bugs for the soak's proof (prove.js). Loaded with `node -r tests/soak/bugs/inject.js server.js` and env SOAK_BUG=<name>, in the SERVER process only.
// It requires the product modules by absolute path (the server's cwd is its own root) and wraps what they export BEFORE server.js loads them: server.js requires its modules inside start(),
// so what it gets is the wrapped createService / open / createWalletAdapter / startMirror. No bug switch exists in product code.
// Each bug fires rarely, from its own counter, so the soak has to find it. Every firing is logged to stderr as `[soak-bug] <name> ...` (server.log).
// EXPECT: the invariants the soak may name for the bug (README.md says why each one). prove.js reads it.
const fs = require('fs'), path = require('path');

const EXPECT = {
  'win-dropped': ['I7', 'I2'],
  'paid-twice': ['I7', 'I2'],
  'skim': ['I7', 'I4'],
  'mirror-stale': ['I5'],
  'boot-skip': ['I4'],
  'ghost-mint': ['I2', 'I7'],
  'view-lies': ['I6'],
  'stuck-stake': ['I8', 'I6'],
  'neg-holder': ['I1', 'I3'],
  'stranded-escrow': ['I4'],
  'pool-skim': ['I4', 'I2'],
  'settle-after-void': ['I7', 'I2'],
};
module.exports = { EXPECT };

const bug = process.env.SOAK_BUG;
if (!bug) return;
if (!EXPECT[bug]) { console.error(`[soak-bug] unknown bug ${bug}`); process.exit(3); }

const root = process.cwd();
const req = rel => require(path.join(root, rel));
const say = (...a) => console.error('[soak-bug]', bug, ...a);
const every = (n) => { let c = 0; return () => ++c % n === 0; };

// ---- service-level bugs: the object createService returns is patched before anything else sees it ----
const SERVICE = {
  // The player is told a win the ledger never paid: Bender's win leg is dropped now and then.
  'win-dropped'(svc) {
    const fire = every(5), orig = svc.houseRound;
    svc.houseRound = function (game, key, cost, win, cur, ref, pool) {
      if (game === 'bender' && win > 0 && fire()) { say('dropped the win leg', ref, win); return orig.call(this, game, key, cost, 0, cur, ref, pool); }
      return orig.apply(this, arguments);
    };
  },
  // After a Bender round, the same win is credited a second time under a new ref.
  'paid-twice'(svc, ledger) {
    const fire = every(5), orig = svc.houseRound; let n = 0;
    svc.houseRound = function (game, key, cost, win, cur, ref, pool) {
      const r = orig.apply(this, arguments);
      if (game === 'bender' && win > 0 && fire()) { say('paid the win twice', ref, win); ledger.transfer('house:bender', (cur === 'chips' ? 'bank:' : 'play:') + key, win, cur, 'bender:credit', `${ref}:again${++n}`); }
      return r;
    };
  },
  // A free ghost bonus: every 4th ensureAccount also mints 500 Play $ under a bonus: ref nobody asked for.
  'ghost-mint'(svc) {
    const fire = every(4), orig = svc.ensureAccount; let n = 0;
    svc.ensureAccount = function (key) {
      const r = orig.apply(this, arguments);
      if (fire()) { say('minted 500 play to', key); try { svc.mint('bonus', key, 500, 'play', `bonus:${key}:ghost${++n}`); } catch (e) { say('ghost mint refused', e.code); } }
      return r;
    };
  },
  // Boot recovery leaves every second seat where it is.
  'boot-skip'(svc, ledger) {
    const orig = svc.bootRecover;
    svc.bootRecover = function () {
      const list = ledger.list; let i = 0;
      ledger.list = function (prefix, cur) { const r = list.apply(this, arguments); return prefix === 'seat:' ? r.filter(() => { const keep = i++ % 2 === 0; if (!keep) say('boot recovery skipped a seat'); return keep; }) : r; };
      try { return orig.apply(this, arguments); } finally { ledger.list = list; }
    };
  },
  // The slot: a settle or a void is swallowed now and then (the game believes the round is closed; the stake stays in escrow and no round is reported open).
  // Only a close that has a stake in escrow is swallowed: a free round (cost 0) holds no escrow, so swallowing its settle strands nothing and is a different bug (a win never paid).
  'stranded-escrow'(svc, ledger) {
    const fire = every(4), noop = { id: null, dup: false, noop: true };
    for (const name of ['settleRound', 'voidRound']) {
      const orig = svc[name];
      svc[name] = function (game, key, cur, roundId) { if (game === 'coldcall' && ledger.balance(`escrow:coldcall:${key}:${roundId}`, cur) > 0 && fire()) { say(`swallowed ${name}`, key, roundId); return noop; } return orig.apply(this, arguments); };
    }
  },
  // The slot: a round with a win is voided (the stake goes back) and ALSO settled under a fresh ref, so the win is paid on a returned stake.
  'settle-after-void'(svc, ledger) {
    const fire = every(3), orig = svc.settleRound;
    svc.settleRound = function (game, key, cur, roundId, o) {
      if (game === 'coldcall' && o && o.win > 0 && fire()) {
        const w = svc.voidRound(game, key, cur, roundId, 'soak');
        if (!w.noop) {
          say('voided, then settled again under a new ref', key, roundId, o.win);
          ledger.batch([{ from: 'house:coldcall', to: (cur === 'chips' ? 'bank:' : 'play:') + key, amount: o.win, cur, reason: 'coldcall:credit' }], `coldcall:${key}:${roundId}v:close`, 'coldcall:settle');
          return { id: w.id, dup: false, noop: false };
        }
      }
      return orig.apply(this, arguments);
    };
  },
  // The mirror files stop changing after the first N writes.
  'mirror-stale'(svc) {
    const orig = svc.mirror; let n = 0, frozen = null;
    svc.mirror = function () { const m = orig.apply(this, arguments); if (++n === 12) { frozen = JSON.parse(JSON.stringify(m)); say('mirror frozen'); } return frozen || m; };
  },
};

// ---- ledger-level bugs: the object money.open returns is patched ----
const LEDGER = {
  // A hand batch moves 1 unit of one winner's payout to another seat (still sums to zero).
  'skim'(ledger) {
    const fire = every(3), orig = ledger.batch;
    ledger.batch = function (items, ref, reason) {
      if (typeof ref === 'string' && ref.startsWith('hand:')) {
        const pays = items.map((it, i) => [it, i]).filter(([it]) => String(it.from).startsWith('pot:') && String(it.to).startsWith('seat:'));
        const a = pays.find(([it]) => it.amount > 1);
        const other = a && (pays.find(([it]) => it.to !== a[0].to) || (items.find(it => String(it.to).startsWith('pot:') && it.from !== a[0].to) && [{ from: a[0].from, to: items.find(it => String(it.to).startsWith('pot:') && it.from !== a[0].to).from, amount: 0, cur: a[0].cur, reason: a[0].reason }, -1]));
        if (a && other && fire()) {
          say('skimmed 1 unit', ref, a[0].to, '->', other[0].to);
          items = items.map(it => ({ ...it })); items[a[1]].amount -= 1;
          if (other[1] >= 0) items[other[1]].amount += 1; else items.push({ ...other[0], amount: 1 });
        }
      }
      return orig.call(this, items, ref, reason);
    };
  },
  // The slot: the pot feed leg is dropped now and then, or a prize is paid from house:coldcall instead of the pool (both still sum to zero).
  'pool-skim'(ledger) {
    const mode = process.env.SOAK_BUG_MODE || 'both', feedFire = every(3), prizeFire = every(2), orig = ledger.batch;      // SOAK_BUG_MODE=feed|prize runs one variant alone (default: both)
    ledger.batch = function (items, ref, reason) {
      if (typeof ref === 'string' && ref.startsWith('coldcall:')) {
        const prize = items.find(it => it.reason === 'coldcall:prize');
        if (prize && mode !== 'feed' && prizeFire()) { say('paid a prize from the house, not the pool', ref, prize.amount); items = items.map(it => (it === prize ? { ...it, from: 'house:coldcall' } : it)); }
        else if (!prize && mode !== 'prize' && items.some(it => it.reason === 'coldcall:feed') && feedFire()) { say('dropped the pot feed leg', ref); items = items.filter(it => it.reason !== 'coldcall:feed'); }
      }
      return orig.call(this, items, ref, reason);
    };
  },
};

// ---- wallet adapter bugs ----
const ADAPTER = {
  // The wallet answer says 100 more Play $ than the ledger holds.
  'view-lies'(opts, make) {
    const a = make(opts), get = a.get;
    a.get = function () { const v = get.apply(this, arguments); return { ...v, play: v.play + 100 }; };
    return a;
  },
  // Bender books a round as ONE ledger write (service.houseRound through ctx.money.round) and nothing calls the adapter's spend any more. This stands for
  // "some code path took the old park-then-credit road and the flush never ran": every 6th Bender round, the adapter ALSO parks a 1-unit stake under a ref of
  // its own (through its real spend) and the tick flush that would settle it as a loss is dropped. The stake stays in the adapter's memory (I8: walletPending)
  // and is held against the player's wallet view (I6). The adapter patched is the one server.js hands to ctx.wallet, which the audit's walletPending reads.
  'stuck-stake'(opts, make) {
    let drop = false, n = 0; const fire = every(6), sched = opts.schedule || (fn => queueMicrotask(fn)), svc = opts.service, orig = svc.houseRound;
    const a = make({ ...opts, schedule: fn => { if (drop) { drop = false; return; } sched(fn); } });
    svc.houseRound = function (game, key, cost, win, cur, ref) {
      const r = orig.apply(this, arguments);
      if (game === 'bender' && !r.noop && !r.dup && /^bender:[^:]+:[0-9a-f]+$/.test(String(ref)) && fire()) {
        drop = true;
        try { a.spend(key, cur === 'chips' ? 'chips' : 'play', 1, { game: 'bender', round: `stuck${++n}` }); say('parked a stake and dropped its flush', ref); }
        catch (e) { say('could not park a stake', e.code); }
        finally { drop = false; }
      }
      return r;
    };
    return a;
  },
};

if (SERVICE[bug]) {
  const m = req('money/service.js'), orig = m.createService;
  m.createService = function (ledger) { const svc = orig.apply(this, arguments); SERVICE[bug](svc, ledger); return svc; };
}
if (LEDGER[bug]) {
  const m = req('money/ledger.js'), orig = m.open;
  m.open = function () { const ledger = orig.apply(this, arguments); LEDGER[bug](ledger); return ledger; };
}
if (ADAPTER[bug]) {
  const m = req('transport/wallet-adapter.js'), orig = m.createWalletAdapter;
  m.createWalletAdapter = function (opts) { return ADAPTER[bug](opts, orig); };
}
if (bug === 'neg-holder') {
  // a line written straight to money.jsonl behind the ledger's back that takes a bank: below zero
  const file = process.env.MONEY_FILE;
  const t = setTimeout(() => {
    try {
      fs.appendFileSync(file, JSON.stringify({ id: Date.now(), ts: Date.now(), from: 'bank:chris', to: 'house:bender', amount: 999999999999, cur: 'chips', reason: 'bender:spend', ref: `bender:chris:neg${Date.now()}` }) + '\n');
      say('appended a line that takes bank:chris below zero');
    } catch (e) { say('append failed', e.message); }
  }, 7000);
  if (t.unref) t.unref();
}
