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
    if (e.code === 'round_closed' || e.code === 'pool_short' || e.code === 'ref_conflict' || e.code === 'stake_mismatch') return fail(e.code, e.message, e);
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
    // The outcome of a call is a plain object with known keys only: a bare number or a misspelt field would otherwise close a round on numbers that are not its own.
    const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
    const shape = (o, keys, label) => {
      if (!plain(o)) throw fail('args', label + ': the outcome must be an object');
      for (const k of Object.keys(o)) if (!keys.includes(k)) throw fail('args', `${label}: unknown field ${k}`);
      if (o.pool != null) {
        if (!plain(o.pool)) throw fail('args', label + ': pool must be an object');
        for (const k of Object.keys(o.pool)) if (!['name', 'feed', 'prize'].includes(k)) throw fail('args', `${label}: unknown pool field ${k}`);
      }
      return o;
    };

    return {
      balance(key, c) { const k = who(key); c = cur(c); return ledger.balance((c === 'chips' ? 'bank:' : 'play:') + k, c); },
      // A replay of an instant round the ledger already holds is "already played": ref_conflict (other numbers) and noop (all 0 against a
      // stored round) both become round_closed.
      round(key, c, roundId, o) {
        const k = who(key); c = cur(c); shape(o, ['cost', 'win', 'pool'], 'round');
        return call(k, () => {
          const ref = `${game}:${k}:${part(roundId, 'roundId')}`;
          let r;
          try { r = service.houseRound(game, k, amount(o, 'cost'), amount(o, 'win'), c, ref, o.pool); } catch (e) { if (e && e.code === 'ref_conflict') throw new MoneyError('round_closed', { ref }); throw e; }
          if (r.noop && ledger.has(ref)) throw new MoneyError('round_closed', { ref });
          return r;
        });
      },
      open(key, c, roundId, cost) {
        const k = who(key); c = cur(c);
        if (typeof cost !== 'number') throw fail('args', 'open: cost must be a number');
        return call(k, () => service.openRound(game, k, c, part(roundId, 'roundId'), cost));
      },
      settle(key, c, roundId, o) {
        const k = who(key); c = cur(c); shape(o, ['win', 'pool', 'stake'], 'settle');
        return call(k, () => service.settleRound(game, k, c, part(roundId, 'roundId'), { win: amount(o, 'win'), pool: o.pool, stake: o.stake }));
      },
      void(key, c, roundId, why) { const k = who(key); c = cur(c); return call(k, () => service.voidRound(game, k, c, part(roundId, 'roundId'), why)); },
      openRounds() { try { return service.openRounds(game); } catch (e) { throw mapError(e); } },
      closed(key, roundId) { const k = who(key); try { return service.roundClosed(game, k, part(roundId, 'roundId')); } catch (e) { throw mapError(e); } },
      pool(name, c) { c = cur(c); try { return service.poolBalance(game, part(name, 'name'), c); } catch (e) { throw mapError(e); } },
    };
  }

  return { forGame };
}

module.exports = { createGameMoney, mapError };
