'use strict';
// transport/game-money.js (ctx.money) and the games/ registry's recover() / audit(), against a real money.open() on a temp file with
// FAKE game modules passed through ctx.modules. Plain node: exit 0 on pass, 1 on fail. Contract: ADD-A-GAME.md sections 3 and 6.
const fs = require('fs');
const path = require('path');
const { open, MoneyError } = require('../../money/ledger');
const { createService, START_CHIPS, START_PLAY } = require('../../money/service');
const { createGameMoney } = require('../../transport/game-money');
const games = require('../../games');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); }
}
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || 'eq') + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); };
const ok = (c, m) => { if (!c) throw new Error(m || 'not ok'); };
const code = (fn) => { try { fn(); } catch (e) { return e; } return null; };
function throwsCode(fn, c) { const e = code(fn); if (!e || e.code !== c) throw new Error('wanted ' + c + ', got ' + (e ? e.code + ' ' + e.message : 'no throw')); return e; }

fs.mkdirSync(path.join(__dirname, '..', '..', 'tables', 'runs'), { recursive: true }); // gitignored scratch dir, absent in a fresh checkout
const dir = fs.mkdtempSync(path.join(__dirname, '..', '..', 'tables', 'runs', 'gm-'));
let n = 0;
function env(file, keys = ['ann', 'bob']) {
  const f = file || path.join(dir, 'm' + (++n) + '.jsonl');
  const ledger = open(f, { fsync: 'none', log: () => {} });
  const service = createService(ledger);
  for (const k of keys) service.ensureAccount(k);
  const changed = [];
  const gm = createGameMoney({ service, ledger, onChange: k => changed.push(k), log: () => {} });
  return { f, ledger, service, gm, changed };
}
const wallet = { get: () => ({}), topUp: () => ({}) };
const registry = (e, modules, extra = {}) => games({ io: null, wallet, money: e.gm, service: e.service, modules, ...extra });
const accountsOf = (ledger) => { const out = []; for (const cur of ['chips', 'play']) for (const p of ['escrow:', 'pool:']) for (const x of ledger.list(p, cur)) out.push(x.account); return [...new Set(out)].sort(); };

// ---- ctx.money ----
t('the bound object cannot name another game\'s accounts: ids, keys and pool names with a colon are refused and write nothing', () => {
  const e = env(); const m = e.gm.forGame('coldcall');
  const id = e.ledger.lastId;
  for (const fn of [
    () => m.open('ann', 'play', 'x:y', 5), () => m.open('ann', 'play', '', 5), () => m.open('ann:x', 'play', 'r1', 5), () => m.open('', 'play', 'r1', 5),
    () => m.settle('ann', 'play', 'a:b', { win: 5 }), () => m.settle('ann', 'play', 'r1', { win: 5, pool: { name: 'a:b', feed: 1 } }),
    () => m.void('ann', 'play', 'a:b'), () => m.round('ann', 'play', 'a:b', { cost: 5 }), () => m.round('ann', 'play', 'r1', { cost: 5, pool: { name: 'o:p', feed: 1 } }),
    () => m.closed('ann', 'a:b'), () => m.pool('o:p', 'play'),
  ]) ok(code(fn), 'a bad name was accepted: ' + fn);
  eq(e.ledger.lastId, id);
  // the account a good call touches is exactly this game's
  m.open('ann', 'play', 'r1', 5); m.round('ann', 'play', 'r2', { cost: 10, pool: { name: 'office', feed: 3 } });
  eq(accountsOf(e.ledger), ['escrow:coldcall:ann:r1', 'pool:coldcall:office']);
  eq(e.gm.forGame('bender').openRounds(), []); eq(m.openRounds(), [{ key: 'ann', cur: 'play', roundId: 'r1', amount: 5 }]);
  eq(e.gm.forGame('bender').pool('office', 'play'), 0); eq(m.pool('office', 'play'), 3);
  eq(e.gm.forGame('bender').closed('ann', 'r1'), false);
  const keys = Object.keys(m).sort(); eq(keys, ['balance', 'closed', 'open', 'openRounds', 'pool', 'round', 'settle', 'void']);
});

t('errors: funds, amount, round_closed, pool_short, ref_conflict keep their code; the rest is internal; the original is on .cause', () => {
  const e = env(); const m = e.gm.forGame('coldcall');
  let x = throwsCode(() => m.open('ann', 'play', 'r1', START_PLAY + 1), 'funds');
  ok(!(x instanceof MoneyError) && x instanceof Error && x.cause instanceof MoneyError && x.cause.code === 'insufficient');
  eq(throwsCode(() => m.round('ann', 'chips', 'r2', { cost: START_CHIPS + 1 }), 'funds').cause.account, 'bank:ann');
  throwsCode(() => m.open('ann', 'play', 'r1', -1), 'amount'); throwsCode(() => m.open('ann', 'play', 'r1', 2.5), 'amount');
  throwsCode(() => m.round('ann', 'play', 'r3', { cost: 1, win: -4 }), 'amount');
  m.open('ann', 'play', 'r4', 50); throwsCode(() => m.open('ann', 'play', 'r4', 51), 'ref_conflict');
  m.settle('ann', 'play', 'r4', { win: 0 });
  throwsCode(() => m.void('ann', 'play', 'r4', 'x'), 'round_closed'); throwsCode(() => m.open('ann', 'play', 'r4', 50), 'round_closed');
  const ps = throwsCode(() => m.round('ann', 'play', 'r5', { cost: 10, pool: { name: 'empty', prize: 5 } }), 'pool_short');
  eq(ps.cause.code, 'pool_short');
  throwsCode(() => e.gm.forGame('nogame').open('ann', 'play', 'r1', 5), 'internal');
  throwsCode(() => m.open('ann', 'play', 'a:b', 5), 'internal');
  throwsCode(() => m.open('ann', 'gold', 'r1', 5), 'mode'); throwsCode(() => m.balance('ann', 'gold'), 'mode'); throwsCode(() => m.pool('office', 'gold'), 'mode');
  throwsCode(() => m.open('  ', 'play', 'r1', 5), 'acct');
  // a ledger that has been closed under the game is `internal`, never a result
  e.ledger.close(); throwsCode(() => m.open('ann', 'play', 'late', 5), 'internal');
});

t('keys are lower-cased and trimmed; write calls answer { id, dup, noop }; balance reads bank / play', () => {
  const e = env(); const m = e.gm.forGame('coldcall');
  eq(m.balance(' ANN ', 'play'), START_PLAY); eq(m.balance('ann', 'chips'), START_CHIPS);
  const a = m.open(' ANN', 'chips', 'r1', 100);
  ok(a.id > 0 && a.dup === false && a.noop === false);
  eq(m.balance('ann', 'chips'), START_CHIPS - 100); eq(e.ledger.balance('escrow:coldcall:ann:r1', 'chips'), 100);
  eq(m.open('ann', 'chips', 'r1', 100), { id: a.id, dup: true, noop: false });
  eq(m.open('ann', 'chips', 'free', 0), { id: null, dup: false, noop: true });
  eq(m.closed('ANN', 'r1'), false);
  const s = m.settle('Ann', 'chips', 'r1', { win: 250 });
  eq(m.closed('ann', 'r1'), true); eq(m.balance('ann', 'chips'), START_CHIPS + 150);
  eq(m.settle('ann', 'chips', 'r1', { win: 250 }), { id: s.id, dup: true, noop: false });
  eq(m.round('ann', 'play', 'i1', { cost: 0, win: 0 }), { id: null, dup: false, noop: true });
  eq(m.round('bob', 'play', 'i2', { cost: 10, win: 25 }).dup, false); eq(m.balance('bob', 'play'), START_PLAY + 15);
  eq(m.round('bob', 'play', 'i2', { cost: 10, win: 25 }).dup, true); eq(m.balance('bob', 'play'), START_PLAY + 15);
  // the instant round writes the ref the contract names
  ok(e.ledger.has('coldcall:bob:i2'));
});

t('onChange fires after every write call that did not throw, with the lower-cased key, and never after a throw or a read', () => {
  const e = env(); const m = e.gm.forGame('coldcall');
  m.balance('ann', 'play'); m.openRounds(); m.closed('ann', 'r1'); m.pool('o', 'play'); eq(e.changed, []);
  m.open('ANN', 'play', 'r1', 10); eq(e.changed, ['ann']);
  code(() => m.open('ann', 'play', 'r1', 11)); code(() => m.open('ann', 'play', 'big', START_PLAY * 2));
  eq(e.changed, ['ann'], 'a throw must not push');
  m.settle('ann', 'play', 'r1', { win: 1 }); m.open('bob', 'play', 'r2', 10); m.void('bob', 'play', 'r2', 'x'); m.round('bob', 'chips', 'i1', { cost: 1, win: 2 });
  eq(e.changed, ['ann', 'ann', 'bob', 'bob', 'bob']);
  m.settle('ann', 'play', 'r1', { win: 1 });   // dup still pushes (harmless, and the game just learned the balance)
  eq(e.changed.length, 6);
  // a throwing onChange does not turn a written round into an error
  const e2 = env(); const m2 = createGameMoney({ service: e2.service, ledger: e2.ledger, onChange: () => { throw new Error('socket gone'); }, log: () => {} }).forGame('coldcall');
  ok(m2.open('ann', 'play', 'r1', 10).id > 0); eq(e2.ledger.balance('escrow:coldcall:ann:r1', 'play'), 10);
});

// ---- the registry ----
t('each module gets its OWN ctx.money, the same object in init and in handlers; ctx.wallet stays; the raw service never reaches a module', () => {
  const e = env(); const seen = {};
  const mk = (id) => ({ id, name: id, kind: 'solo', init(ctx) { seen[id] = { init: ctx }; }, handlers: { ping(sock, p, ctx) { seen[id].handler = ctx; } } });
  const reg = registry(e, [mk('coldcall'), mk('bender')]);
  ok(seen.coldcall.init.money && seen.bender.init.money && seen.coldcall.init.money !== seen.bender.init.money);
  const handlers = {};
  reg.onConnection({ data: { acct: { key: 'ann' } }, on: (ev, fn) => { handlers[ev] = fn; }, emit() {} });
  handlers['g:coldcall:ping']({}); handlers['g:bender:ping']({});
  ok(seen.coldcall.handler === seen.coldcall.init && seen.bender.handler === seen.bender.init, 'init ctx and handler ctx differ');
  ok(seen.coldcall.init.wallet === wallet && seen.bender.init.wallet === wallet);
  ok(!('service' in seen.coldcall.init), 'the service must not reach a module');
  seen.coldcall.init.money.open('ann', 'play', 'r1', 10);
  eq(seen.coldcall.init.money.openRounds().length, 1); eq(seen.bender.init.money.openRounds().length, 0);
  eq(accountsOf(e.ledger), ['escrow:coldcall:ann:r1']);
  ok(typeof reg.recover === 'function' && typeof reg.audit === 'function');
});

t('a registry built without ctx.money still works: the module has ctx.wallet and no money (Bender\'s old path)', () => {
  const e = env(); let initCtx = null, handlerCtx = null;
  const bender = { id: 'bender', name: 'B', kind: 'solo', init(c) { initCtx = c; }, handlers: { spin(s, p, c) { handlerCtx = c; c.wallet.get('ann'); } } };
  const reg = games({ io: null, wallet, modules: [bender] });
  ok(initCtx.wallet === wallet && !('money' in initCtx) && !('service' in initCtx));
  const handlers = {};
  reg.onConnection({ data: { acct: { key: 'ann' } }, on: (ev, fn) => { handlers[ev] = fn; }, emit() {} });
  handlers['g:bender:spin']({}); ok(handlerCtx === initCtx);
  const r = reg.recover();
  eq(r.games.bender, { found: 0, settledOrVoidedByGame: 0, kept: 0 }); ok(r.errors.some(x => x.code === 'no_service'), 'no service: reported, not thrown');
  // a foreign ctx.money (not the factory) is not handed to modules
  const reg2 = games({ io: null, wallet, money: { drift() {} }, modules: [bender] });
  ok(!('money' in initCtx) || typeof initCtx.money !== 'object' || !initCtx.money.drift); void reg2;
});

// A fake COLD CALL: its own state is only the record of what it believes is open. D1: a round a game still knows at boot with a
// decision open is settled as its timeout would settle it (the player keeps the win); it keeps one on purpose and does not know a third.
function fakeGame(id, o = {}) {
  const state = o.state || { kept: { key: 'ann', cur: 'play', stake: 100 }, timed: { key: 'ann', cur: 'chips', stake: 200 } };
  const log = [];
  return {
    id, name: id, kind: 'solo', state, log, init() {}, handlers: {},
    recover(rounds, ctx) {
      if (o.throwRecover) throw new Error('recover boom');
      log.push(rounds.map(r => r.roundId).sort());
      for (const [roundId, r] of Object.entries(state)) {
        if (ctx.money.closed(r.key, roundId)) { delete state[roundId]; continue; }   // stale: its :close ref is in the ledger
        if (roundId === 'timed') {
          const w = ctx.money.settle(r.key, r.cur, roundId, { win: r.stake * 3 });   // the stake outcome + win, as its timeout settles it
          if (o.crashAfterSettle) throw new Error('killed after the settle, before the state was updated');
          log.push('settled:' + roundId + (w.dup ? ':dup' : '')); delete state[roundId];
        }
      }
    },
    audit() { if (o.throwAudit) throw new Error('audit boom'); return { openRounds: Object.entries(state).map(([roundId, r]) => ({ key: r.key, cur: r.cur, roundId, amount: r.stake })), pools: {} }; },
  };
}

function seedRounds(e) {
  const m = e.gm.forGame('coldcall');
  m.open('ann', 'play', 'kept', 100); m.open('ann', 'chips', 'timed', 200); m.open('bob', 'play', 'third', 300);    // 'third': the game has no record of it
  e.ledger.transfer('mint:signup', 'escrow:ghost:bob:g1', 40, 'chips', 'x', 'ghost-open');                     // a game id with no module at all
}

t('recover(): the kept round stays, the timeout round is settled once with its win, the unknown one and a module-less game\'s escrow go back', () => {
  const e = env(); seedRounds(e);
  const game = fakeGame('coldcall');
  const reg = registry(e, [game]);
  const r = reg.recover();
  eq(r.errors, []);
  eq(r.games.coldcall, { found: 3, settledOrVoidedByGame: 1, kept: 1 });
  eq(r.voided.map(v => `${v.game}/${v.key}/${v.roundId}`).sort(), ['coldcall/bob/third', 'ghost/bob/g1']);
  // ledger: kept still open; timed settled (stake -> house, win from house: ann nets +400 chips); third and ghost back to bob
  eq(e.ledger.balance('escrow:coldcall:ann:kept', 'play'), 100); eq(e.ledger.balance('escrow:coldcall:ann:timed', 'chips'), 0);
  eq(e.ledger.balance('bank:ann', 'chips'), START_CHIPS - 200 + 600); eq(e.ledger.balance('play:ann', 'play'), START_PLAY - 100);
  eq(e.ledger.balance('play:bob', 'play'), START_PLAY); eq(e.ledger.balance('bank:bob', 'chips'), START_CHIPS + 40, 'the ghost game escrow (40 chips) went back to bob');
  ok(e.ledger.has('coldcall:ann:timed:close') && e.ledger.has('coldcall:bob:third:close') && e.ledger.has('ghost:bob:g1:close'));
  eq(e.ledger.balance('house:coldcall', 'chips'), 200 - 600);
  const last = [...e.ledger.entries(x => x.ref === 'coldcall:bob:third:close')][0];
  eq(last.reason, 'coldcall:void:boot');
  ok(e.ledger.check().chips.ok && e.ledger.check().play.ok);
  eq(game.state.timed, undefined); ok(game.state.kept);
  eq(reg.audit().coldcall.openRounds.map(x => x.roundId), ['kept']);
  eq(e.changed.length > 0 && e.changed.includes('ann'), true);
});

t('recover() after a crash during recovery on a freshly reopened ledger: nothing is paid twice, the kept round is still kept', () => {
  const e1 = env(); seedRounds(e1);
  // first boot: the game settles 'timed', then the process dies before the game updates its state and before the sweep ran
  const g1 = fakeGame('coldcall', { crashAfterSettle: true });
  const r1 = registry(e1, [g1]).recover();
  ok(r1.errors.some(x => x.game === 'coldcall' && x.what === 'recover'), 'the throw is reported');
  ok(e1.ledger.has('coldcall:ann:timed:close'));
  const bankAfterSettle = e1.ledger.balance('bank:ann', 'chips');
  // second boot: reopen the same file without closing the first, the game still believes 'timed' is open (its state was not saved)
  const e2 = env(e1.f, []);
  const g2 = fakeGame('coldcall', { state: { kept: { key: 'ann', cur: 'play', stake: 100 }, timed: { key: 'ann', cur: 'chips', stake: 200 } } });
  const lines = e2.ledger.lastId;
  const r2 = registry(e2, [g2]).recover();
  eq(r2.errors, []);
  eq(e2.ledger.balance('bank:ann', 'chips'), bankAfterSettle, 'the timed round was paid twice');
  eq(e2.ledger.balance('house:coldcall', 'chips'), 200 - 600);
  eq(e2.ledger.balance('escrow:coldcall:ann:kept', 'play'), 100);
  eq(e2.ledger.balance('play:bob', 'play'), START_PLAY);
  // timed was closed already: the game dropped it as stale (its :close ref is in the ledger) rather than settling it again
  eq(g2.state.timed, undefined);
  ok(e2.ledger.lastId >= lines);
  // third boot: nothing left to do, nothing is written
  const e3 = env(e1.f, []); const id = e3.ledger.lastId;
  const g3 = fakeGame('coldcall', { state: { kept: { key: 'ann', cur: 'play', stake: 100 } } });
  const r3 = registry(e3, [g3]).recover();
  eq(r3.errors, []); eq(r3.voided, []); eq(e3.ledger.lastId, id, 'a third recovery wrote lines');
  ok(e3.ledger.check().chips.ok && e3.ledger.check().play.ok);
});

t('a game that settles again after a crash (its own record still open) is answered dup by the ledger', () => {
  const e1 = env(); const m1 = e1.gm.forGame('coldcall');
  m1.open('ann', 'chips', 'timed', 200); m1.settle('ann', 'chips', 'timed', { win: 600 });
  const e2 = env(e1.f, []); const m2 = e2.gm.forGame('coldcall'), bal = e2.ledger.balance('bank:ann', 'chips'), id = e2.ledger.lastId;
  eq(m2.settle('ann', 'chips', 'timed', { win: 600 }).dup, true);
  eq(e2.ledger.balance('bank:ann', 'chips'), bal); eq(e2.ledger.lastId, id);
});

t('a module whose recover throws does not stop the others; its own escrows then go through the sweep as unclaimed', () => {
  const e = env(); const c = e.gm.forGame('coldcall'), b = e.gm.forGame('bender');
  c.open('ann', 'play', 'kept', 100); c.open('bob', 'play', 'third', 300); b.open('ann', 'chips', 'b1', 70);
  const cold = fakeGame('coldcall', { state: { kept: { key: 'ann', cur: 'play', stake: 100 } } });
  const ben = fakeGame('bender', { throwRecover: true, state: { b1: { key: 'ann', cur: 'chips', stake: 70 } } });
  const r = registry(e, [ben, cold]).recover();           // the throwing module is FIRST
  eq(r.errors.map(x => [x.game, x.what]), [['bender', 'recover']]);
  eq(e.ledger.balance('escrow:coldcall:ann:kept', 'play'), 100, 'kept');
  eq(e.ledger.balance('escrow:coldcall:bob:third', 'play'), 0, 'the other game was still recovered');
  eq(e.ledger.balance('escrow:bender:ann:b1', 'chips'), 70, 'a game that claims a round in audit() keeps it even when its recover threw');
  eq(r.games.bender.found, 1); eq(r.games.coldcall.found, 2);
});

t('a module whose audit throws keeps its escrows (an unknown claim closes nothing) and an error is reported; other games are still swept', () => {
  const e = env(); const c = e.gm.forGame('coldcall'), b = e.gm.forGame('bender');
  c.open('ann', 'play', 'a', 100); c.open('ann', 'chips', 'b', 50); b.open('bob', 'play', 'x', 30);
  const cold = fakeGame('coldcall', { throwAudit: true, state: {} });
  const ben = fakeGame('bender', { state: {} });
  const reg = registry(e, [cold, ben]);
  const r = reg.recover();
  ok(r.errors.some(x => x.game === 'coldcall' && x.what === 'audit'), JSON.stringify(r.errors));
  eq(e.ledger.balance('escrow:coldcall:ann:a', 'play'), 100); eq(e.ledger.balance('escrow:coldcall:ann:b', 'chips'), 50);
  eq(e.ledger.balance('escrow:bender:bob:x', 'play'), 0); eq(e.ledger.balance('play:bob', 'play'), START_PLAY);
  eq(r.games.coldcall.kept, 2); eq(r.voided.map(v => v.game), ['bender']);
  eq(reg.audit().coldcall, { error: 'audit boom' }); eq(reg.audit().bender.openRounds, []);
});

t('a module with no audit claims nothing: its escrows are voided; one without recover is only swept', () => {
  const e = env(); const c = e.gm.forGame('coldcall'); c.open('ann', 'play', 'a', 100);
  const bare = { id: 'coldcall', name: 'x', kind: 'solo', init() {}, handlers: {} };
  const r = registry(e, [bare]).recover();
  eq(r.errors, []); eq(r.games.coldcall, { found: 1, settledOrVoidedByGame: 0, kept: 0 }); eq(e.ledger.balance('play:ann', 'play'), START_PLAY);
  eq(registry(e, [bare]).audit(), {});
});

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
