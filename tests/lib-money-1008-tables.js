'use strict';
// Harness for tests/money-1008-*.js: real ledger + money service + money port + registry/Table on a fake clock and a temp dir.
// MONEY_ROOT (default: this tree) points the requires at another checkout, to run a test against the code before a fix.
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = process.env.MONEY_ROOT || path.join(__dirname, '..');
const R = p => require(path.join(ROOT, p));
const { open } = R('money/ledger');
const { createService } = R('money/service');
const { createMoneyPort } = R('tables/money-port');
const { createRegistry } = R('tables/registry');
const { rigDeck } = require(path.join(ROOT, 'tests/v2-unit/engine-lib'));

function fakeClock() {
  let now = 1000000, id = 0; const timers = new Map();
  return {
    now: () => now, pending: () => timers.size,
    setTimeout: (fn, ms) => { const h = ++id; timers.set(h, { at: now + ms, fn }); return h; },
    clearTimeout: h => { timers.delete(h); },
    advance(ms) {
      const end = now + ms;
      for (let guard = 0; guard < 100000; guard++) {
        let best = null;
        for (const [h, x] of timers) if (x.at <= end && (!best || x.at < best[1].at)) best = [h, x];
        if (!best) break;
        timers.delete(best[0]); now = Math.max(now, best[1].at); best[1].fn();
      }
      now = end;
    },
  };
}

// world({ keys, cash: {key: cents}, chips: {key: n}, dir, bootId }) -> { ledger, service, port, registry, clock, events, decks, dir, file, held, total, restart }
function world(o = {}) {
  const dir = o.dir || fs.mkdtempSync(path.join(process.env.MONEY_TMP || os.tmpdir(), 'money1008-'));
  const file = path.join(dir, 'money.jsonl');
  const clock = o.clock || fakeClock();
  const events = [], decks = [], errors = [];
  const boot = (ledger, bootId) => {
    const service = createService(ledger, { signupPlay: 0 });
    const port = createMoneyPort({ service, ledger, bootId: bootId || o.bootId || 'b1', sameFundOnly: true });
    const registry = createRegistry({
      money: port, service, ledger, clock, file: path.join(dir, 'tables.json'),
      out: { state() {}, event(t, kind, data, to) { events.push([t.id, kind, data, to]); } },
      onError: (e, where) => { errors.push([where, e && (e.code || e.message)]); },
      deckSource: () => decks.shift() || null, constants: o.constants || {},
      hooks: { profileOf: k => ({ display: k }), isAdmin: k => k === 'admin' },
    });
    return { service, port, registry };
  };
  const ledger = open(file, { fsync: 'none', log: () => {} });
  const W = { dir, file, clock, events, decks, errors, ledger, ...boot(ledger) };
  let n = 0, boots = 0;
  for (const k of o.keys || []) {
    W.service.ensureAccount(k);
    if (o.cash && o.cash[k] > 0) W.service.adminAdjust(k, o.cash[k], 'play', 'seed', 'seed:' + k + ':' + (++n));
  }
  W.held = (key, cur) => {
    let t = W.ledger.balance((cur === 'chips' ? 'bank:' : 'play:') + key, cur);
    for (const { account, balance } of W.ledger.list('seat:', cur)) if (account.split(':')[2] === key) t += balance;
    return t;
  };
  const sum = (prefix, cur) => W.ledger.list(prefix, cur).reduce((a, x) => a + x.balance, 0);
  W.total = cur => sum(cur === 'chips' ? 'bank:' : 'play:', cur) + sum('seat:', cur) + sum('pot:', cur);
  // A server stop and start on the same files: void live hands, save, close, reopen, boot recovery, load tables.json.
  // editTables(file), when given, runs on tables.json after the shutdown save and before the next boot reads it (an old or hand-edited file).
  W.restart = (bootId, editTables) => {
    quiet(() => { W.registry.voidAll('shutdown'); W.registry.flush(); });
    if (editTables) editTables(path.join(dir, 'tables.json'));
    W.ledger.close();
    const l2 = open(file, { fsync: 'none', log: () => {} });
    const id = bootId || 'b' + (++boots + 1);                       // a fresh boot id per start, like the live server: refs never repeat
    const b = boot(l2, id);
    W.ledger = l2; W.service = b.service; W.port = b.port; W.registry = b.registry;
    const rep = W.service.bootRecover(id);
    W.registry.load();
    return rep;
  };
  return W;
}

const quiet = fn => { const e = console.error; console.error = () => {}; try { return fn(); } finally { console.error = e; } };
const code = fn => { try { fn(); return 'none'; } catch (e) { return e.code || e.message; } };

// Tiny runner: t(name, fn); done() prints the counts and sets the exit code.
function suite(file) {
  let pass = 0, fail = 0;
  return {
    t(name, fn) {
      try { fn(); pass++; } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); }
    },
    done() { console.log(`${path.basename(file)}: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); },
  };
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'eq') + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); };
const ok = (c, m) => { if (!c) throw new Error(m || 'not ok'); };

module.exports = { ROOT, world, fakeClock, rigDeck, quiet, code, suite, eq, ok };
