'use strict';
// P6: escrows at boot. A server killed (or restarted) while a game round is open leaves a non-zero escrow:<game>:<key>:<roundId> in the
// ledger. Rule (ADD-A-GAME.md section 3): at boot, before the server listens, every escrow no loaded game claims goes back to its player
// (<game>:<key>:<roundId>:close, reason <game>:void:boot); a pool is untouched; the rollback mirrors show the full balances; a second
// restart writes nothing more. No game module uses escrow yet, so the round is seeded with money/ledger + money/service in this process
// while the server is down (v2 server only: the 9440541 baseline has no escrow accounts).
const fs = require('fs');
const { startServer, Bot, sleep, audit, suite, expect, expectEq } = require('./lib');
const { open } = require('../../money/ledger');
const { createService } = require('../../money/service');
const T = suite(__filename);

const lines = (log) => log.split('\n').filter(l => /^game recovery:/.test(l));

// every balance in the ledger file, replayed from the lines alone (never through the server)
function replay(file) {
  const bal = { chips: {}, play: {} }, refs = {}, lines = [];
  for (const ln of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!ln.trim()) continue;
    let rec; try { rec = JSON.parse(ln); } catch { continue; }
    lines.push(rec);
    refs[rec.ref] = rec;
    for (const it of (Array.isArray(rec.batch) ? rec.batch : [rec])) {
      bal[it.cur][it.from] = (bal[it.cur][it.from] || 0) - it.amount;
      bal[it.cur][it.to] = (bal[it.cur][it.to] || 0) + it.amount;
    }
  }
  const get = (cur, a) => bal[cur][a] || 0;
  return { get, refs, count: lines.length };
}

async function scenario() {
  // 1. boot once, sign one account up, stop cleanly
  const srv = await startServer(0);
  let key;
  try {
    const a = await new Bot(srv, 'Escrowy').connect();
    const r = await a.signup(); expect(!r.__err && r.account, 'signup failed: ' + JSON.stringify(r));
    key = a.key; a.close();
  } finally { await srv.stop('SIGTERM'); }
  const file = srv.f('money.jsonl');

  // 2. server down: one open coldcall escrow in each currency plus a pool balance in each, written the way the service writes them
  const ledger = open(file, { fsync: 'all', log: () => {} });
  const svc = createService(ledger);
  svc.ensureAccount(key);
  svc.houseRound('coldcall', key, 1000, 0, 'chips', `coldcall:${key}:seedpool-c`, { name: 'office', feed: 600 });
  svc.houseRound('coldcall', key, 400, 0, 'play', `coldcall:${key}:seedpool-p`, { name: 'office', feed: 250 });
  svc.openRound('coldcall', key, 'chips', 'rc1', 700);
  svc.openRound('coldcall', key, 'play', 'rp1', 55000);
  const seeded = {
    bank: ledger.balance('bank:' + key, 'chips'), wallet: ledger.balance('play:' + key, 'play'),
    escChips: ledger.balance(`escrow:coldcall:${key}:rc1`, 'chips'), escPlay: ledger.balance(`escrow:coldcall:${key}:rp1`, 'play'),
    poolChips: ledger.balance('pool:coldcall:office', 'chips'), poolPlay: ledger.balance('pool:coldcall:office', 'play'),
  };
  ledger.close();
  expectEq([seeded.escChips, seeded.escPlay, seeded.poolChips, seeded.poolPlay], [700, 55000, 600, 250], 'seeded ledger');
  const before = replay(file);

  // 3. boot the server on that data dir
  const srv2 = await srv.restart();
  const out = { key, seeded, before, file, srv };
  try {
    out.log = srv2.logText();
    await sleep(900);                                   // the rollback mirror rewrites within 250 ms of a ledger change
    out.after = replay(file);
    out.mirror = { bank: srv2.read('b.json'), wallet: srv2.read('w.json') };
    const c = await new Bot(srv2, 'Auditor').connect();
    out.audit = await audit(c); c.close();
  } finally { await srv2.stop('SIGKILL'); }                // a crash, not a clean stop: recovery must not depend on shutdown

  // 4. and once more: the second restart finds nothing to do
  const srv3 = await srv.restart();
  try {
    await sleep(600);
    out.third = replay(file); out.log3 = srv3.logText();
  } finally { await srv3.stop('SIGTERM'); }
  out.final = replay(file);
  return out;
}

(async () => {
  let o = null, err = null;
  try { o = await scenario(); } catch (e) { err = e; }
  const need = async (fn) => { if (err) throw err; await fn(o); };

  await T.check('open-escrows-voided-at-boot-both-currencies', ['P6'], () => need(async () => {
    const { key, after, seeded } = o;
    expectEq([after.get('chips', `escrow:coldcall:${key}:rc1`), after.get('play', `escrow:coldcall:${key}:rp1`)], [0, 0], 'escrow balances after boot');
    const rec = lines(o.log);
    expect(rec.length === 2 && /2 escrows voided/.test(rec[1]), 'second boot (the one with the seeded escrows) must log "game recovery: ... 2 escrows voided": ' + rec.join(' | '));
  }));

  await T.check('stakes-are-back-in-bank-and-play', ['P6'], () => need(async () => {
    const { key, after, seeded } = o;
    expectEq(after.get('chips', 'bank:' + key), seeded.bank + seeded.escChips, 'bank chips');
    expectEq(after.get('play', 'play:' + key), seeded.wallet + seeded.escPlay, 'wallet play');
  }));

  await T.check('close-refs-exist-with-reason-void-boot', ['P6'], () => need(async () => {
    const { key, after, before } = o;
    for (const [round, cur, amount] of [['rc1', 'chips', 700], ['rp1', 'play', 55000]]) {
      const ref = `coldcall:${key}:${round}:close`, rec = after.refs[ref];
      expect(rec && !before.refs[ref], `no ${ref} line written at boot`);
      expectEq([rec.from, rec.to === (cur === 'chips' ? 'bank:' : 'play:') + key, rec.amount, rec.cur, rec.reason], [`escrow:coldcall:${key}:${round}`, true, amount, cur, 'coldcall:void:boot'], ref);
    }
    expectEq(after.count - before.count, 2, 'lines written by the boot (the two voids, nothing else)');
  }));

  await T.check('pool-untouched-and-books-balance', ['P6'], () => need(async () => {
    const { after, seeded } = o;
    expectEq([after.get('chips', 'pool:coldcall:office'), after.get('play', 'pool:coldcall:office')], [seeded.poolChips, seeded.poolPlay], 'pool balances');
    expect(o.audit.ledger && o.audit.ledger.chips.ok && o.audit.ledger.play.ok, 'ledger books do not balance: ' + JSON.stringify(o.audit.ledger));
  }));

  await T.check('audit-and-mirrors-show-the-full-balances', ['P6'], () => need(async () => {
    const { key, seeded, audit: a, mirror } = o;
    const wantBank = seeded.bank + seeded.escChips, wantWallet = seeded.wallet + seeded.escPlay;
    expectEq([a.bank[key], a.wallet[key]], [wantBank, wantWallet], '__audit bank / wallet');
    expectEq([mirror.bank && mirror.bank[key], mirror.wallet && mirror.wallet[key]], [wantBank, wantWallet], 'bank.json / wallet.json mirrors');
  }));

  await T.check('second-restart-writes-nothing-for-them', ['P6'], () => need(async () => {
    const { after, third, final, key } = o;
    expectEq(third.count, after.count, 'ledger lines after the second boot');
    expectEq(final.count, after.count, 'ledger lines after the second shutdown');
    expectEq([final.get('chips', 'bank:' + key), final.get('play', 'play:' + key)], [after.get('chips', 'bank:' + key), after.get('play', 'play:' + key)], 'balances');
    const rec = lines(o.log3);
    expect(rec.length === 3 && /, 0 escrows voided/.test(rec[2]), 'third boot must log "game recovery: ... 0 escrows voided": ' + rec.join(' | '));
  }));

  await T.done();
})();
