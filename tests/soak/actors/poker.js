'use strict';
// Actor: poker. POKERPING (chips, permanent) plus created tables so a chips table and a Cash table are both in play. Players join with a random
// legal buy-in from their own currency or the other one, act with a random LEGAL action (taken from legalActions in their game_state), leave
// (also mid-hand), rebuy after busting, get kicked by the host (also mid-hand), sit out, drop and reconnect their socket, and the host ends the night.
const { sleep } = require('../lib/bot');

let tableSeq = 0;
const SETTINGS = {
  chips: () => ({ name: `Soak chips ${++tableSeq}`, mode: 'chips', buyIn: { min: 500, max: 100000, default: 2000 }, blinds: { sb: 25, bb: 50 }, actionTimerSec: 0, autoStart: true, isPrivate: false, rebuys: true, rebuyLimit: 0 }),
  play: () => ({ name: `Soak play ${++tableSeq}`, mode: 'play', buyIn: { min: 1000, max: 100000, default: 5000 }, blinds: { sb: 50, bb: 100 }, actionTimerSec: 0, autoStart: true, isPrivate: false, rebuys: true, rebuyLimit: 0 }),
};
const aliveTables = W => [...W.tables.values()].filter(t => !t.ended && !t.gone);
const storeOf = (cur, key) => (cur === 'chips' ? 'bank:' : 'play:') + key;

// ---- ledger checks for what a client was told (acked means durable) ----
// The latest line for (kind, table, key) must move `amount` out of the owner's `fund` store into the seat (buy-in) or back (cash-out).
function checkBuyIn(W, kind, tableId, key, amount, fundCur, expectNew) {
  W.checker.poll();
  const L = W.checker.opsOf(kind, tableId, key);
  if (!L.length) { if (expectNew) W.violate('I7', `${key} was told the buy-in at ${tableId} worked but the ledger has no ${kind} line`, { table: tableId, key }, `${kind} ${amount}`, 'none'); return; }
  const last = L[L.length - 1];
  const store = storeOf(fundCur, key), seat = `seat:${tableId}:${key}`;
  const out = last.items.find(i => i.from === store), into = last.items.find(i => i.to === seat);
  if (!out || !into || out.amount !== amount || into.amount !== amount || !(into.reason || '').startsWith('buyin:' + fundCur)) {
    W.violate('I7', `buy-in ledger line ${last.ref} does not match: asked ${amount} from ${fundCur}`, { ref: last.ref, key, table: tableId }, `${store} -> ${seat} ${amount} buyin:${fundCur}`, JSON.stringify(last.items).slice(0, 240));
  }
}
function checkCashOut(W, kind, tableId, key, amount, fundCur) {
  if (!(amount > 0)) return;
  W.checker.poll();
  const L = W.checker.opsOf(kind, tableId, key);
  const last = L[L.length - 1];
  const store = storeOf(fundCur, key);
  const back = last && last.items.find(i => i.to === store);
  if (!last || !back || back.amount !== amount || !(back.reason || '').startsWith('cashout:' + fundCur)) {
    W.violate('I7', `${key} was told ${amount} came back from ${tableId} (${kind}) but the ledger line is ${last ? last.ref : 'missing'}`, { table: tableId, key }, `${store} +${amount} cashout:${fundCur}`, last ? JSON.stringify(last.items).slice(0, 240) : 'none');
  }
}

async function createTable(W, mode, host) {
  const b = host || W.rng.pick(W.connectedBots());
  if (!b) return null;
  const r = await b.req('table_create', { settings: SETTINGS[mode]() }, 'table_created', 4000);
  if (!r.data) { W.warn('table_create_' + (r.error ? r.error.code : 'timeout'), r.error && r.error.message); return null; }
  const t = r.data.table;
  W.tables.set(t.id, { id: t.id, mode: t.mode, cur: t.mode === 'chips' ? 'chips' : 'play', min: t.buyIn.min, max: t.buyIn.max, host: b.key, permanent: false, ended: false, gone: false, bb: t.bb });
  return { what: 'table_create', who: b.key, table: t.id, mode: t.mode };
}

async function join(W, bot, t, { fund, amount } = {}) {
  const key = bot.key, fundCur = fund || t.cur;
  W.checker.poll();
  const before = W.checker.opsOf('buyin', t.id, key).length;
  const r = await bot.req('table_join', { tableId: t.id, buyIn: amount, fund: fund || undefined }, 'table_joined', 4000);
  if (r.timeout) throw new Error(`table_join by ${key} at ${t.id} got no answer (harness problem)`);
  if (r.error) return { ok: false, code: r.error.code };
  W.checker.poll();
  const after = W.checker.opsOf('buyin', t.id, key).length;
  bot.wantTable = t.id;
  if (after > before) {                       // a new seat was bought
    W.counters.buyIns++;
    bot.seatFund = fundCur; W.fundAt.set(`${t.id}:${key}`, fundCur);
    if (amount !== undefined) {
      checkBuyIn(W, 'buyin', t.id, key, amount, fundCur, true);
      if (r.data.stack !== amount) W.violate('I7', `table_joined says stack ${r.data.stack}, the buy-in was ${amount}`, { table: t.id, key }, amount, r.data.stack);
    }
  } else if (!bot.seatFund) bot.seatFund = W.fundCur(t.id, key);
  return { ok: true, fresh: after > before };
}

const ops = {
  async join(W) {
    const tables = aliveTables(W);
    const cand = W.connectedBots().filter(b => !b.tableId && !b.wantTable);
    if (!tables.length || !cand.length) return null;
    const bot = W.rng.pick(cand), t = W.rng.pick(tables);
    const fund = W.rng.chance(0.4) ? (t.cur === 'chips' ? 'play' : 'chips') : null;
    const fundCur = fund || t.cur;
    W.checker.poll();
    const have = W.checker.balance(fundCur, storeOf(fundCur, bot.key));
    const cap = Math.min(t.max, Math.max(t.min, t.min * 8));
    let amount = t.min + Math.floor(W.rng() * W.rng() * (cap - t.min + 1));
    const broke = have < t.min;
    if (broke && !W.rng.chance(0.25)) return null;                 // sometimes try anyway: must be refused, nothing may move
    if (!broke) amount = Math.min(amount, have);
    const r = await join(W, bot, t, { fund, amount });
    if (!r.ok && r.code === 'bank' && have >= amount) W.warn('join_refused_affordable', `${bot.key} had ${have}, asked ${amount}`);
    if (r.ok && broke) {
      // a slot round of this player can settle on its own timer and credit the bank between our read and the join: judge by what the ledger held at the buy-in line itself
      W.checker.poll();
      const ops = W.checker.opsOf('buyin', t.id, bot.key), L = ops[ops.length - 1];
      const before = L ? W.checker.balanceBefore(fundCur, storeOf(fundCur, bot.key), L.idx) : have;
      if (before < amount) W.violate('I7', `${bot.key} bought in for ${amount} holding ${before} ${fundCur}`, { key: bot.key }, 'refused', 'seated');
      else W.warn('buyin_after_credit', `${bot.key} held ${have} when asked, ${before} at the buy-in line (a slot round paid in between)`);
    }
    return { what: 'join', who: bot.key, table: t.id, amount, fund: fund || 'own', result: r.ok ? 'seated' : r.code };
  },

  async act(W) {
    const cand = W.connectedBots().filter(b => b.tableId && b.legal());
    if (!cand.length) { await sleep(70); return null; }
    const bot = W.rng.pick(cand), la = bot.legal();
    const opts = [];
    if (la.canCheck) opts.push([34, 'check'], [2, 'fold']); else opts.push([14, 'fold']);
    if (la.canCall) opts.push([42, 'call']);
    if (la.canRaise) opts.push([9, 'raise_min'], [11, 'raise_rand'], [9, 'allin']);
    const pick = W.rng.weighted(opts);
    let action = pick, amount;
    if (pick === 'raise_min') { action = 'raise'; amount = la.minRaiseTo; }
    else if (pick === 'raise_rand') { action = 'raise'; amount = la.minRaiseTo + Math.floor(W.rng() * W.rng() * (la.maxRaiseTo - la.minRaiseTo + 1)); }
    else if (pick === 'allin') { if (la.canRaise) { action = 'raise'; amount = la.maxRaiseTo; } else action = la.canCall ? 'call' : 'check'; }
    const tableId = bot.tableId;
    const r = await bot.req('player_action', { roomId: tableId, action, amount }, 'game_state', 1500);
    if (r.error && !['not_your_turn', 'no_hand', 'paused'].includes(r.error.code)) W.warn('action_error_' + r.error.code, `${bot.key} ${action} ${amount}: ${r.error.message}`);
    return { what: 'act', who: bot.key, table: tableId, action, amount, result: r.error ? r.error.code : 'ok' };
  },

  async leave(W) {
    const cand = W.connectedBots().filter(b => b.tableId);
    if (!cand.length) return null;
    const busted = cand.filter(b => b.busted);
    const bot = busted.length && W.rng.chance(0.6) ? W.rng.pick(busted) : W.rng.pick(cand);
    const tableId = bot.tableId, fundCur = W.fundCur(tableId, bot.key);
    const live = !!(bot.gs && bot.gs.status === 'playing');
    const r = await bot.req('table_leave', { tableId }, 'table_left', 4000);
    if (r.timeout) throw new Error(`table_leave by ${bot.key} got no answer (harness problem)`);
    if (r.error) return { what: 'leave', who: bot.key, table: tableId, result: r.error.code };
    bot.wantTable = null;
    W.counters.cashOuts++;
    checkCashOut(W, 'leave', tableId, bot.key, r.data.cashedOut || 0, fundCur);
    return { what: 'leave', who: bot.key, table: tableId, midHand: live, cashedOut: r.data.cashedOut };
  },

  async rebuy(W) {
    const cand = W.connectedBots().filter(b => b.tableId && b.busted);
    if (!cand.length) return null;
    const bot = W.rng.pick(cand), t = W.tables.get(bot.tableId);
    if (!t) return null;
    const oldFund = W.fundCur(t.id, bot.key);
    const fund = W.rng.chance(0.3) ? (oldFund === 'chips' ? 'play' : 'chips') : oldFund;
    W.checker.poll();
    const have = W.checker.balance(fund, storeOf(fund, bot.key));
    if (have < t.min) return null;
    const amount = Math.min(have, t.min + Math.floor(W.rng() * W.rng() * (Math.min(t.max, t.min * 8) - t.min + 1)));
    const before = W.checker.opsOf('rebuy', t.id, bot.key).length;
    const r = await bot.req('rebuy', { roomId: t.id, amount, fund }, 'game_state', 2500);
    if (r.error) return { what: 'rebuy', who: bot.key, table: t.id, amount, fund, result: r.error.code };
    W.checker.poll();
    const after = W.checker.opsOf('rebuy', t.id, bot.key).length;
    if (after > before) { W.counters.buyIns++; bot.busted = false; bot.seatFund = fund; W.fundAt.set(`${t.id}:${bot.key}`, fund); checkBuyIn(W, 'rebuy', t.id, bot.key, amount, fund, true); }
    return { what: 'rebuy', who: bot.key, table: t.id, amount, fund, result: after > before ? 'ok' : 'no line' };
  },

  async kick(W) {
    const t = W.rng.pick(aliveTables(W).filter(x => x.host));
    if (!t) return null;
    const host = W.bots.get(t.host);
    if (!host || !host.connected()) return null;
    const cand = W.connectedBots().filter(b => b.tableId === t.id && b.key !== t.host);
    if (!cand.length) return null;
    const target = W.rng.pick(cand), fundCur = W.fundCur(t.id, target.key);
    const live = !!(target.gs && target.gs.status === 'playing');
    const p = target.wait('table_left', 2500);
    host.emit('table_kick', { tableId: t.id, key: target.key });
    const r = await p;
    if (r.timeout) return { what: 'kick', who: host.key, target: target.key, table: t.id, result: 'no table_left' };
    target.wantTable = null;
    W.counters.cashOuts++;
    checkCashOut(W, 'kick', t.id, target.key, r.data.cashedOut || 0, fundCur);
    return { what: 'kick', who: host.key, target: target.key, table: t.id, midHand: live, cashedOut: r.data.cashedOut };
  },

  async sitout(W) {
    const cand = W.connectedBots().filter(b => b.tableId);
    if (!cand.length) return null;
    const bot = W.rng.pick(cand);
    await bot.req('sit_out', { roomId: bot.tableId }, 'game_state', 600, { errs: false });
    return { what: 'sit_out', who: bot.key, table: bot.tableId };
  },

  // drop the socket (also mid-hand), wait a little while the table carries on, then sign in again and take the seat back
  async reconnect(W) {
    const cand = W.connectedBots().filter(b => b.tableId && !(W.slot && W.model.slot.hasOpen(b.key)));     // a slot round with a decision open is the slot actor's to drop (its 'drop' step)
    if (!cand.length) return null;
    const bot = W.rng.pick(cand), tableId = bot.tableId, live = !!(bot.gs && bot.gs.status === 'playing');
    bot.close();
    await sleep(W.rng.range(30, 700));
    await bot.connect();
    const a = await bot.resume();
    if (!a.data) throw new Error(`${bot.key} could not resume after dropping its socket: ${JSON.stringify(a.error || a)}`);
    const t = W.tables.get(tableId);
    let res = 'idle';
    if (t && !t.ended) { const r = await join(W, bot, t, {}); res = r.ok ? (r.fresh ? 'NEW seat' : 'seat back') : r.code; }
    return { what: 'reconnect', who: bot.key, table: tableId, midHand: live, result: res };
  },

  async endnight(W) {
    const t = W.rng.pick(aliveTables(W).filter(x => !x.permanent));
    if (!t) return null;
    const host = W.bots.get(t.host);
    if (!host || !host.connected()) return null;
    const p = host.wait('settle_up', 1200);
    host.emit('table_end_night', { tableId: t.id });
    const r = await p;
    if (r.data) W.settleUp(r.data.tableId); else t.ending = true;      // a live hand: the night ends after it (settle_up arrives during a later step)
    return { what: 'end_night', who: host.key, table: t.id, result: r.data ? 'ended' : 'after the hand' };
  },

  async create(W) {
    const have = aliveTables(W);
    if (have.length >= 4) return null;
    const mode = have.some(t => t.cur === 'play' && !t.permanent) ? 'chips' : 'play';
    return createTable(W, mode);
  },
};

module.exports = {
  name: 'poker', weight: 60, ops,
  async init(W) {
    W.tables.set('POKERPING', { id: 'POKERPING', mode: 'chips', cur: 'chips', min: 500, max: 100000, host: 'chris', permanent: true, ended: false, gone: false, bb: 50 });
    const bots = W.botList();
    W.settleUp = (tableId) => {
      const t = W.tables.get(tableId); if (t) { t.ended = true; t.ending = false; }
      for (const b of W.botList()) if (b.tableId === tableId) { b.tableId = null; b.seatFund = null; }
      for (const b of W.botList()) if (b.wantTable === tableId) b.wantTable = null;
    };
    for (const b of bots) b.on('settle_up', d => { if (d && d.tableId && d.ended) W.settleUp(d.tableId); });
    if (bots.length >= 2) {
      await createTable(W, 'chips', bots[1]);
      await createTable(W, 'play', bots[Math.min(2, bots.length - 1)]);
    }
  },
  // after a restart every seat is gone (boot returned the money); tables that were saved are still there
  async afterRestart(W) {
    for (const b of W.botList()) { b.wantTable = null; b.busted = false; }
    for (const t of W.tables.values()) {
      if (t.permanent) continue;
      const r = await W.admin.req('table_preview', { code: t.id }, 'table_info', 2500);
      if (!r.data) { t.gone = true; W.warn('table_lost_in_restart', t.id); }
    }
  },
  async step(W) {
    // late joiners (signups) need a seat to play at; keep the number of live tables up
    if (aliveTables(W).filter(t => !t.permanent).length < 2 && W.rng.chance(0.5)) { const r = await ops.create(W); if (r) return { actor: 'poker', ...r }; }
    const seated = W.connectedBots().filter(b => b.tableId).length;
    const onTurn = W.connectedBots().some(b => b.tableId && b.legal());
    const op = W.rng.weighted([
      [onTurn ? 62 : 8, 'act'], [seated < 4 ? 40 : 9, 'join'], [4, 'leave'], [W.connectedBots().some(b => b.busted) ? 14 : 0, 'rebuy'],
      [2, 'kick'], [3, 'sitout'], [3, 'reconnect'], [0.7, 'endnight'], [1, 'create'],
    ]);
    const r = await ops[op](W);
    return r ? { actor: 'poker', ...r } : null;
  },
};
