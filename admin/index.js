'use strict';
// Admin money operations and the overview payload. Money goes through the service only; there is no "set total" (H5).

const MAX_PLAY = 100000000000;
const isInt = v => Number.isSafeInteger(v);

function createAdmin({ service, ledger, accounts, registry, views, onlineKeys }) {
  let n = 0;
  const bootTag = Date.now().toString(36);
  const op = () => `${bootTag}.${++n}`;
  const bankOf = k => ledger.balance('bank:' + k, 'chips');
  const playOf = k => ledger.balance('play:' + k, 'play');

  // A signed delta on the bank (chips) or the Play $ wallet. insufficient is returned as { ok: false, code: 'insufficient' }.
  function adjust(key, delta, cur, reason) {
    if (!key || !accounts.get(key)) return { ok: false, code: 'unknown_player' };
    if (cur !== 'chips' && cur !== 'play') return { ok: false, code: 'bad_cur' };
    if (!isInt(delta) || delta === 0) return { ok: false, code: 'bad_amount' };
    if (typeof reason !== 'string' || !reason.trim()) return { ok: false, code: 'bad_reason' };
    try { service.adminAdjust(key, delta, cur, reason, `adj:${key}:${op()}`); return { ok: true }; }
    catch (e) { if (e && e.name === 'MoneyError') return { ok: false, code: e.code === 'insufficient' ? 'insufficient' : e.code }; throw e; }
  }

  // "Set wallet to X": one wallet delta, never table money.
  function setPlay(key, cents) {
    if (!key || !accounts.get(key)) return { ok: false, code: 'unknown_player' };
    if (!isInt(cents) || cents < 0 || cents > MAX_PLAY) return { ok: false, code: 'range' };
    const delta = cents - playOf(key);
    if (delta === 0) return { ok: true, noop: true };
    return adjust(key, delta, 'play', 'admin set play');
  }

  function overview() {
    const online = onlineKeys();
    const rows = Object.values(accounts.all()).map(a => {
      const seen = Math.max(a.lastLoginAt || 0, ...(a.sessions || []).map(x => x.lastSeen || 0));
      const held = service.balances(a.key);
      return { key: a.key, display: a.display, isAdmin: !!a.isAdmin, claimed: !!a.claimed, lastSeen: seen || null, online: online.has(a.key), balance: bankOf(a.key) + held.atTable.chips, play: playOf(a.key), bank: bankOf(a.key), atTable: held.atTable.chips, atTablePlay: held.atTable.play };
    }).sort((x, y) => (y.online - x.online) || ((y.lastSeen || 0) - (x.lastSeen || 0)) || x.display.localeCompare(y.display));
    const t = registry.tables.get('POKERPING');
    const b = t ? (t.hand ? { sb: t.hand.sb, bb: t.hand.bb } : t.blinds) : null;
    return {
      accounts: rows,
      table: t ? { paused: !!t.paused, status: t.phase === 'betting' || t.phase === 'runout' ? 'playing' : t.phase === 'between' ? 'waiting_next' : 'waiting', seated: t.players().length, handNum: Math.max(0, t.handNo - (t.nightHand0 || 0)), startChips: t.buyIn.default, sb: b.sb, bb: b.bb, nextSb: t.pendingBlinds ? t.pendingBlinds.sb : null, nextBb: t.pendingBlinds ? t.pendingBlinds.bb : null } : null,
    };
  }

  return { adjust, setPlay, overview };
}

module.exports = { createAdmin };
