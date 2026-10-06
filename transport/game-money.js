'use strict';
// ctx.money for game modules (ADD-A-GAME.md section 3): the only way a game touches money. forGame(gameId) returns the
// calls bound to ONE game id; no call takes a game id, so a module cannot name another game's accounts. Every call is one
// service call (one ledger write), so a game never holds money between messages. After a write that did not throw, onChange(key)
// fires (the wallet push).
const { MoneyError } = require('../money/ledger');

const keyOf = a => String(a && typeof a === 'object' ? a.key : a || '').toLowerCase().trim();

function fail(code, message, cause) { const e = new Error(message); e.code = code; if (cause) e.cause = cause; return e; }

// MoneyError -> the codes a game handles; the original stays on .cause. A refused player account is `funds`; anything the
// game cannot act on (a bad id, a closed ledger, a bug) is `internal`.
function mapError(e) {
  if (e instanceof MoneyError) {
    if (e.code === 'insufficient' && /^(bank|play):/.test(String(e.account))) return fail('funds', 'Not enough funds', e);
    if (e.code === 'bad_amount') return fail('amount', 'Bad amount', e);
    if (e.code === 'round_closed' || e.code === 'pool_short' || e.code === 'ref_conflict') return fail(e.code, e.message, e);
  }
  return fail('internal', 'Server error', e);
}

function createGameMoney({ service, ledger, onChange, log }) {
  const say = log || console.error;
  const note = key => { if (onChange) { try { onChange(key); } catch (e) { say('[v2] game money onChange failed:', e && e.message); } } };

  function forGame(game) {
    const cur = c => { if (c !== 'play' && c !== 'chips') throw fail('mode', 'Bad money mode'); return c; };
    const who = k => { const key = keyOf(k); if (!key) throw fail('acct', 'No account'); return key; };
    // a ':' in a round id or pool name would let a game walk into another account's name: refuse it before the service sees it
    const part = (v, label) => { if (typeof v !== 'string' || !v || v.includes(':')) throw new MoneyError('bad_ref', { [label]: v }); return v; };
    const call = (key, fn) => {
      let r;
      try { r = fn(); } catch (e) { throw mapError(e); }
      note(key);
      return { id: r.id == null ? null : r.id, dup: !!r.dup, noop: !!r.noop };
    };
    const amount = (o, k) => (o && o[k] != null ? o[k] : 0);

    return {
      balance(key, c) { const k = who(key); c = cur(c); return ledger.balance((c === 'chips' ? 'bank:' : 'play:') + k, c); },
      round(key, c, roundId, o) {
        const k = who(key); c = cur(c);
        return call(k, () => service.houseRound(game, k, amount(o, 'cost'), amount(o, 'win'), c, `${game}:${k}:${part(roundId, 'roundId')}`, o && o.pool));
      },
      open(key, c, roundId, cost) { const k = who(key); c = cur(c); return call(k, () => service.openRound(game, k, c, part(roundId, 'roundId'), cost)); },
      settle(key, c, roundId, o) { const k = who(key); c = cur(c); return call(k, () => service.settleRound(game, k, c, part(roundId, 'roundId'), { win: amount(o, 'win'), pool: o && o.pool })); },
      void(key, c, roundId, why) { const k = who(key); c = cur(c); return call(k, () => service.voidRound(game, k, c, part(roundId, 'roundId'), why)); },
      openRounds() { try { return service.openRounds(game); } catch (e) { throw mapError(e); } },
      closed(key, roundId) { const k = who(key); try { return service.roundClosed(game, k, part(roundId, 'roundId')); } catch (e) { throw mapError(e); } },
      pool(name, c) { c = cur(c); try { return service.poolBalance(game, part(name, 'name'), c); } catch (e) { throw mapError(e); } },
    };
  }

  return { forGame };
}

module.exports = { createGameMoney, mapError };
