'use strict';
// Money hardening 2026-10-08, R2E-1 / R2E-2 / R2E-14: the game-money contract keeps ONE round id = ONE round, bounds an amount, and boots without rewriting balances.
//   node tests/money-1008-r2e-contract.js     plain node: exit 0 on pass, 1 on fail.
//   R2E-2  one amount is at most MAX_AMOUNT (1e12 cents) and no write takes a balance past Number.MAX_SAFE_INTEGER; an ordinary amount is untouched
//   R2E-1  a round id closed by one path (round / settle) is never paid again by the other; round() on an OPEN id is refused
const fs = require('fs');
const os = require('os');
const path = require('path');
const { open: openLedger } = require('../money/ledger');
const { createService } = require('../money/service');
const { createGameMoney } = require('../transport/game-money');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'r2e-contract-'));
let pass = 0, fail = 0, seq = 0;
const check = (name, ok, extra) => { if (ok) pass++; else { fail++; console.log('FAIL ' + name + (extra ? ': ' + extra : '')); } };
const code = (fn) => { try { fn(); return null; } catch (e) { return e && e.code ? e.code : 'throw:' + (e && e.message); } };
function rig(game = 'coldcall') {
  const file = path.join(tmp, `l${++seq}.jsonl`);
  const ledger = openLedger(file, { fsync: 'none', log: () => {} });
  const service = createService(ledger, { signupPlay: 0 });
  const M = createGameMoney({ service, ledger, log: () => {} }).forGame(game);
  service.ensureAccount('ann'); service.adminAdjust('ann', 100000, 'play', 'fund', 'fund:ann'); service.adminAdjust('ann', 100000, 'chips', 'fund', 'fund:annc');
  return { ledger, service, M, file, cash: (c = 'play') => ledger.balance((c === 'chips' ? 'bank:' : 'play:') + 'ann', c) };
}

// ---- R2E-1 ----
for (const cur of ['play', 'chips']) {
  {   // A: closed by settle(), then round() on the same id
    const r = rig(); r.M.open('ann', cur, 'a', 100); r.M.settle('ann', cur, 'a', { win: 1000, stake: 100 });
    const b = r.cash(cur), n = r.ledger.entries ? [...r.ledger.entries()].length : 0;
    check(`${cur} A: round() on an id settle() closed is round_closed`, code(() => r.M.round('ann', cur, 'a', { cost: 0, win: 1000 })) === 'round_closed');
    check(`${cur} A: ... and writes nothing`, r.cash(cur) === b && (!r.ledger.entries || [...r.ledger.entries()].length === n));
    check(`${cur} A: round() with other numbers is round_closed too`, code(() => r.M.round('ann', cur, 'a', { cost: 100, win: 0 })) === 'round_closed');
    check(`${cur} A: an all-zero round() on it is round_closed, not a quiet noop`, code(() => r.M.round('ann', cur, 'a', { cost: 0, win: 0 })) === 'round_closed');
    check(`${cur} A: the identical settle() is still dup`, r.M.settle('ann', cur, 'a', { win: 1000, stake: 100 }).dup === true);
    r.ledger.close();
  }
  {   // A2: a free (stakeless) settle closes the id for round() as well
    const r = rig(); r.M.settle('ann', cur, 'f', { win: 500 });
    const b = r.cash(cur);
    check(`${cur} A2: round() on an id a free settle() closed is round_closed`, code(() => r.M.round('ann', cur, 'f', { cost: 0, win: 500 })) === 'round_closed' && r.cash(cur) === b);
    r.ledger.close();
  }
  {   // B: played by round(), then settle() / open() on the same id
    const r = rig(); r.M.round('ann', cur, 'b', { cost: 100, win: 1000 });
    const b = r.cash(cur);
    check(`${cur} B: settle() on an instant round's id is round_closed`, code(() => r.M.settle('ann', cur, 'b', { win: 1000 })) === 'round_closed' && r.cash(cur) === b);
    check(`${cur} B: settle() with a stake of 0 is round_closed`, code(() => r.M.settle('ann', cur, 'b', { win: 1000, stake: 0 })) === 'round_closed' && r.cash(cur) === b);
    check(`${cur} B: open() on an instant round's id is round_closed`, code(() => r.M.open('ann', cur, 'b', 100)) === 'round_closed' && r.cash(cur) === b);
    check(`${cur} B: the identical round() is still dup`, r.M.round('ann', cur, 'b', { cost: 100, win: 1000 }).dup === true && r.cash(cur) === b);
    check(`${cur} B: round() with other numbers is round_closed`, code(() => r.M.round('ann', cur, 'b', { cost: 100, win: 1001 })) === 'round_closed' && r.cash(cur) === b);
    r.ledger.close();
  }
  {   // C: round() on the id of an OPEN round
    const r = rig(); r.M.open('ann', cur, 'c', 100);
    const b = r.cash(cur);
    check(`${cur} C: round() on an OPEN id is refused`, code(() => r.M.round('ann', cur, 'c', { cost: 0, win: 500 })) === 'round_closed' && r.cash(cur) === b);
    check(`${cur} C: closed() is still false while the escrow holds the stake`, r.M.closed('ann', 'c') === false && r.ledger.balance('escrow:coldcall:ann:c', cur) === 100);
    check(`${cur} C: the open round settles normally afterwards`, r.M.settle('ann', cur, 'c', { win: 500, stake: 100 }).dup === false && r.cash(cur) === b + 500);
    check(`${cur} C: ... and is then closed to round()`, code(() => r.M.round('ann', cur, 'c', { cost: 0, win: 500 })) === 'round_closed' && r.M.closed('ann', 'c') === true);
    r.ledger.close();
  }
  {   // D: a voided round is closed to round() too
    const r = rig(); r.M.open('ann', cur, 'v', 100); r.M.void('ann', cur, 'v', 'test');
    const b = r.cash(cur);
    check(`${cur} D: round() on a voided id is round_closed`, code(() => r.M.round('ann', cur, 'v', { cost: 0, win: 500 })) === 'round_closed' && r.cash(cur) === b);
    r.ledger.close();
  }
}
{   // E: different ids and different players are independent; the rule survives a restart
  const r = rig(); r.service.ensureAccount('bob'); r.service.adminAdjust('bob', 5000, 'play', 'fund', 'fund:bob');
  r.M.round('ann', 'play', 'x', { cost: 100, win: 200 });
  check('E: another id of the same player is untouched', code(() => r.M.open('ann', 'play', 'y', 100)) === null && code(() => r.M.settle('ann', 'play', 'y', { win: 0, stake: 100 })) === null);
  check('E: the same id of another player is untouched', code(() => r.M.round('bob', 'play', 'x', { cost: 100, win: 0 })) === null);
  r.M.open('ann', 'play', 'z', 100); r.M.settle('ann', 'play', 'z', { win: 700, stake: 100 });
  r.ledger.close();
  const ledger = openLedger(r.file, { fsync: 'none', log: () => {} }), service = createService(ledger, { signupPlay: 0 });
  const M = createGameMoney({ service, ledger, log: () => {} }).forGame('coldcall');
  const b = ledger.balance('play:ann', 'play');
  check('E: after a restart round() on a settled id is still round_closed', code(() => M.round('ann', 'play', 'z', { cost: 0, win: 700 })) === 'round_closed' && ledger.balance('play:ann', 'play') === b);
  check('E: after a restart settle() on an instant id is still round_closed', code(() => M.settle('ann', 'play', 'x', { win: 200 })) === 'round_closed' && ledger.balance('play:ann', 'play') === b);
  ledger.close();
}

// ---- R2E-2 ----
{
  const { MAX_AMOUNT } = require('../money/ledger');
  check('R2E-2: the ceiling is a named constant, 1e12 cents', MAX_AMOUNT === 1e12);
  const r = rig('bender');
  const b0 = r.cash();
  check('R2E-2: an amount of exactly the ceiling is accepted (admin)', code(() => r.service.adminAdjust('ann', MAX_AMOUNT, 'play', 'cap', 'cap:1')) === null && r.cash() === b0 + MAX_AMOUNT);
  check('R2E-2: ceiling + 1 is bad_amount (admin)', code(() => r.service.adminAdjust('ann', MAX_AMOUNT + 1, 'play', 'cap', 'cap:2')) === 'bad_amount');
  check('R2E-2: a negative adjustment past the ceiling is bad_amount', code(() => r.service.adminAdjust('ann', -(MAX_AMOUNT + 1), 'play', 'cap', 'cap:3')) === 'bad_amount');
  check('R2E-2: MAX_SAFE_INTEGER is bad_amount (admin)', code(() => r.service.adminAdjust('ann', Number.MAX_SAFE_INTEGER, 'play', 'cap', 'cap:4')) === 'bad_amount');
  check('R2E-2: ctx.money.round win past the ceiling is refused as amount and writes nothing', (() => { try { r.M.round('ann', 'play', 'h1', { cost: 0, win: MAX_AMOUNT + 1 }); return false; } catch (e) { return e.code === 'amount' && r.cash() === b0 + MAX_AMOUNT && !r.M.closed('ann', 'h1'); } })());
  check('R2E-2: ctx.money.round cost past the ceiling is refused', code(() => r.M.round('ann', 'play', 'h2', { cost: MAX_AMOUNT + 1, win: 0 })) === 'amount');
  check('R2E-2: open() past the ceiling is refused', code(() => r.M.open('ann', 'play', 'h3', MAX_AMOUNT + 1)) === 'amount');
  check('R2E-2: ctx.money.round win of exactly the ceiling is accepted', code(() => r.M.round('ann', 'play', 'h4', { cost: 0, win: MAX_AMOUNT })) === null && r.cash() === b0 + 2 * MAX_AMOUNT);
  check('R2E-2: an ordinary round still pays to the cent', (() => { const b = r.cash(); r.M.round('ann', 'play', 'h5', { cost: 25, win: 100 }); return r.cash() === b + 75; })());
  // a balance is never taken past 2^53: keep adding the largest legal amount until the write is refused
  let n = 2, last = null;
  for (; n < 9100; n++) { const e = code(() => r.service.adminAdjust('ann', MAX_AMOUNT, 'play', 'cap', 'fill:' + n)); if (e) { last = e; break; } }
  check('R2E-2: a write that would take a balance past MAX_SAFE_INTEGER is balance_overflow', last === 'balance_overflow', String(last));
  check('R2E-2: the refused write left the balance an exact safe integer and the books balanced', Number.isSafeInteger(r.cash()) && r.ledger.check().play.ok === true);
  const b9 = r.cash();
  check('R2E-2: a 1 cent stake after the refusal still moves the balance', code(() => r.M.round('ann', 'play', 'h6', { cost: 1, win: 0 })) === null && r.cash() === b9 - 1);
  r.ledger.close();
  const ledger = openLedger(r.file, { fsync: 'none', log: () => {} });
  check('R2E-2: a restart replays that journal with nothing quarantined and the books ok', ledger.quarantined.length === 0 && ledger.check().play.ok === true && ledger.balance('play:ann', 'play') === b9 - 1);
  ledger.close();
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(`money-1008-r2e-contract: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
