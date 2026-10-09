'use strict';
// Admin money operations and the overview payload. Money goes through the service only. "Set Cash to X" sets the player's TOTAL Cash (K1-3); Chips are adjusted by a signed delta.

const MAX_PLAY = 100000000000;
// R2B-2: an amount is a raw number that is a safe integer, never converted first; -0 is refused (it is not a plain 0 on the wire).
const isInt = v => typeof v === 'number' && Number.isSafeInteger(v) && !Object.is(v, -0);

function createAdmin({ service, ledger, accounts, registry, views, onlineKeys }) {
  const bankOf = k => ledger.balance('bank:' + k, 'chips');
  const playOf = k => ledger.balance('play:' + k, 'play');
  const cents = c => (c / 100).toFixed(2);

  // The ledger ref of an admin edit. The client op id (one per confirmed click, made in the admin page) names the EVENT, so a resend of the same click
  // (a socket retry, a double click, a reconnect) hits the same ref and writes nothing. An edit WITHOUT an op id is refused: there is no default id, because a
  // per-call id would make every resend of a crafted or retrying client pay again (Money 1008 K1-2).
  const OPID = /^[A-Za-z0-9._-]{1,64}$/;
  const checkOp = id => (id == null
    ? { ok: false, code: 'op_required', message: 'Every money edit needs an op id (one per confirmed click). Nothing was changed.' }
    : typeof id === 'string' && OPID.test(id) ? null : { ok: false, code: 'bad_op', message: 'Bad op id. Nothing was changed.' });
  // RV-1: an op id is used ONCE, for one account. New edits are written under `adj:c.<opId>` (no account in it), so the ledger itself answers ref_conflict when the same op id comes
  // for another account (its legs name another wallet). Lines written before this rule are under `adj:<key>:c.<opId>`: they are still found, for their own account (a resend = dup)
  // and for any other account (ref_conflict). Returns { ref } or { conflict: true }.
  const refOf = (key, opId) => {
    const old = k => `adj:${k}:c.${opId}`;
    for (const a of Object.values(accounts.all())) if (a && a.key !== key && ledger.has(old(a.key))) return { conflict: true };
    return { ref: ledger.has(old(key)) ? old(key) : `adj:c.${opId}` };
  };
  const CONFLICT = { ok: false, code: 'ref_conflict' };

  // R3AB-2: an account that exists but has no PIN yet (claimed false) is opened by anyone who has the public room word (accounts.claim), so Cash given to it would belong to
  // whoever claims it first. An admin edit that RAISES Cash on such an account is refused before any write; lowering it, or setting it to 0, stays allowed (it takes money back).
  // Not refused: an admin account (its claim never takes the room word) and a boot-LOCKED account (claim and signup are refused for it; only the admin PIN reset opens it).
  const UNCLAIMED = { ok: false, code: 'account_unclaimed', message: 'This name has no PIN yet. The player must sign in and set a PIN before Cash can be given. Nothing was changed.' };
  const openToStranger = key => { const a = accounts.get(key); return !!a && a.claimed === false && a.locked !== true && !a.isAdmin; };

  // A signed delta on the bank (chips) or the Cash wallet. insufficient is returned as { ok: false, code: 'insufficient' }.
  // The same op id again is a dup: { ok: true, dup: true }, nothing written. The same op id with other numbers is refused (ref_conflict).
  function adjust(key, delta, cur, reason, opId) {
    if (!key || !accounts.get(key)) return { ok: false, code: 'unknown_player' };
    if (cur !== 'chips' && cur !== 'play') return { ok: false, code: 'bad_cur' };
    if (!isInt(delta) || delta === 0) return { ok: false, code: 'bad_amount' };
    if (typeof reason !== 'string' || !reason.trim()) return { ok: false, code: 'bad_reason' };
    const bad = checkOp(opId); if (bad) return bad;
    const f = refOf(key, opId); if (f.conflict) return CONFLICT;
    if (cur === 'play' && delta > 0 && !ledger.has(f.ref) && openToStranger(key)) return UNCLAIMED;
    // RV-4: an adjust cannot take the TOTAL Cash (wallet + seats + open rounds) past the Set Cash maximum; a removal never does. A resend (the ref is held) is the ledger's to answer: dup, or ref_conflict.
    if (cur === 'play' && delta > 0 && !ledger.has(f.ref) && cashOf(key).total + delta > MAX_PLAY) return { ok: false, code: 'range' };
    try { const r = service.adminAdjust(key, delta, cur, reason, f.ref); return r && r.dup ? { ok: true, dup: true } : { ok: true }; }
    catch (e) { if (e && e.name === 'MoneyError') return { ok: false, code: e.code === 'insufficient' ? 'insufficient' : e.code }; throw e; }
  }

  // Where a player's Cash sits now: wallet, Play seats ("at tables"), open game rounds, and the total of the three.
  function cashOf(key) {
    const h = service.balances(key);
    return { wallet: h.play, atTable: h.atTable.play, inRound: h.inRound.play, total: h.play + h.atTable.play + h.inRound.play };
  }

  // "Set Cash to X": the player's TOTAL Cash becomes X (wallet + seats + open rounds). Cash at a seat or in a round is not the admin's to move, so X below that part
  // is refused (cash_in_play, the message names the amount) and nothing is written; otherwise the wallet is set to X minus the part in play. The answer carries
  // wallet / atTable / inRound / total. The ledger reason carries the target, so the request is in the line: with an op id the ledger already
  // holds, the same request (same target) is the first answer (ok, dup) whatever the balance is now; any other edit under that op id (another kind, another target) is ref_conflict.
  function setPlay(key, target, opId) {
    if (!key || !accounts.get(key)) return { ok: false, code: 'unknown_player' };
    if (!isInt(target)) return { ok: false, code: 'bad_amount', message: 'The amount must be a whole number of cents. Nothing was changed.' };
    if (target < 0 || target > MAX_PLAY) return { ok: false, code: 'range' };
    const bad = checkOp(opId); if (bad) return bad;
    const reason = `admin set play to ${target}`;
    const f = refOf(key, opId); if (f.conflict) return CONFLICT;
    if (ledger.has(f.ref)) {
      // the held line must be THIS account's Cash edit to this target (a leg names this wallet), else the op id belongs to another edit
      const held = ledger.entriesOf(f.ref)[0];
      return held && held.cur === 'play' && held.reason === 'admin:' + reason && (held.from === 'play:' + key || held.to === 'play:' + key) ? { ok: true, dup: true, ...cashOf(key) } : CONFLICT;
    }
    const c = cashOf(key), part = c.atTable + c.inRound;
    if (target < part) {
      const where = [c.atTable ? `${cents(c.atTable)} at tables` : '', c.inRound ? `${cents(c.inRound)} in open rounds` : ''].filter(Boolean).join(' and ');
      return { ok: false, code: 'cash_in_play', message: `Cannot set Cash to ${cents(target)}: ${where} (${cents(part)}) is in play and cannot be taken. End the night or wait for the round, then set it. Nothing was changed.`, ...c };
    }
    const delta = target - part - c.wallet;
    if (delta > 0 && openToStranger(key)) return UNCLAIMED;
    // R2B-3: a Set Cash that changes nothing still holds its op id (a net-zero line under the same ref), so its resend is a dup after the balance moved and after a restart.
    if (delta === 0) {
      // RV-2: a refused write (closed / write_failed / lost_lock) is an answer here, as in adjust(), not a throw
      try { service.adminMark(key, 'play', reason, f.ref); } catch (e) { if (e && e.name === 'MoneyError') return { ok: false, code: e.code }; throw e; }
      return { ok: true, noop: true, ...c };
    }
    const r = adjust(key, delta, 'play', reason, opId);
    return r.ok ? { ...r, ...cashOf(key) } : r;
  }

  // R2B-6: a row carries Cash three ways: playTotal (wallet + seats + open rounds = what "Set Cash" sets and the page edits), playWallet and playInPlay (seats + open rounds).
  // `play` stays the wallet alone (old readers); the page must never edit it.
  function overview() {
    const online = onlineKeys();
    const rows = Object.values(accounts.all()).map(a => {
      const seen = Math.max(a.lastLoginAt || 0, ...(a.sessions || []).map(x => x.lastSeen || 0));
      const held = service.balances(a.key);
      return { key: a.key, display: a.display, isAdmin: !!a.isAdmin, claimed: !!a.claimed, lastSeen: seen || null, online: online.has(a.key), balance: bankOf(a.key) + held.atTable.chips, play: playOf(a.key), playWallet: held.play, playInPlay: held.atTable.play + held.inRound.play, playTotal: held.play + held.atTable.play + held.inRound.play, bank: bankOf(a.key), atTable: held.atTable.chips, atTablePlay: held.atTable.play };
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
