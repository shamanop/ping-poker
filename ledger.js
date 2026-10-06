'use strict';
// Append-only bank ledger, kept in its own file. Never touches bank.json or chip math.
const fs = require('fs');

function createLedger({ file, onWrite, keyOf, displayOf }) {
  let entries = [];
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(j)) entries = j; } catch { entries = []; }

  const key = n => { const k = String(n).toLowerCase().trim(); return keyOf ? keyOf(k) : k; };
  const handStart = new Map();   // roomId -> { name: chips at deal }
  const cashedDuring = new Map(); // roomId -> { name: amount cashed out mid-hand }

  function save() {
    try {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(entries));
      fs.renameSync(tmp, file);
    } catch {}
  }

  function push(e) {
    entries.push(e);
    save();
    if (onWrite) { try { onWrite(e); } catch {} }
    return e;
  }

  // extra: optional fields merged into the entry, e.g. { park: true } on a cash-out that a later buy-in resumes, { delta } on an adjust, { mode, key, nightId } for table rows.
  function log(type, name, amount, balanceAfter, tableChips, handNum, room, extra) {
    if (type === 'cashout' && room) {
      const m = cashedDuring.get(room) || {};
      m[key(name)] = (m[key(name)] || 0) + amount;
      cashedDuring.set(room, m);
    }
    const row = { t: Date.now(), name, type, amount, balanceAfter: balanceAfter ?? null, tableChips: tableChips ?? null, handNum: handNum ?? null, room: room || null };
    if (extra && typeof extra === 'object') for (const [k, v] of Object.entries(extra)) if (v !== undefined) row[k] = v;
    return push(row);
  }

  function seedBank(bankMap) {
    const known = new Set(entries.map(e => key(e.name || '')));
    for (const [k, bal] of Object.entries(bankMap)) {
      if (!known.has(k)) { entries.push({ t: Date.now(), name: k, type: 'bank-start', amount: bal, balanceAfter: bal, tableChips: null, handNum: null, room: null }); known.add(k); }
    }
    save();
  }

  function startHand(room) {
    const m = {};
    for (const p of room.players) m[key(p.name)] = p.chips;
    handStart.set(room.id, m);
    cashedDuring.set(room.id, {});
  }

  function endHand(room, bankOf) {
    const start = handStart.get(room.id);
    const cashed = cashedDuring.get(room.id) || {};
    const t = Date.now();
    const players = room.players.map(p => ({
      name: p.name,
      chips: p.chips,
      played: !!start && key(p.name) in start && start[key(p.name)] > 0 && !p.sittingOut,
      isBot: !!p.isBot,
    }));
    const snap = { t, type: 'snapshot', room: room.id, handNum: room.handNum, players };
    if (room.nightId) { snap.mode = room.unit || 'chips'; snap.tableId = room.id; snap.nightId = room.nightId; }
    push(snap);
    if (!start) return;
    for (const p of room.players) {
      if (p.isBot) continue;
      const k = key(p.name);
      if (!(k in start) || start[k] <= 0) continue;
      const delta = p.chips + (cashed[k] || 0) - start[k];
      if (delta === 0) continue;
      const row = { t, name: p.name, type: delta > 0 ? 'win' : 'loss', amount: Math.abs(delta), balanceAfter: room.unit === 'cents' ? null : bankOf(p.name), tableChips: p.chips, handNum: room.handNum, room: room.id };
      if (room.nightId) { row.mode = room.unit || 'chips'; row.tableId = room.id; row.nightId = room.nightId; row.key = key(p.name); }
      push(row);
    }
    handStart.delete(room.id);
    cashedDuring.delete(room.id);
  }

  // live: [{ name, isBot, chips, inPot, status }] for players currently in any room
  // Cash-outs flagged park (disconnect, shutdown, lone player) are chips returned to the bank only until the player sits back down:
  // a later buy-in/rebuy by the same name resumes up to the parked amount, so a refresh never shows as a new buy-in or a cash-out.
  // Net P&L = cashed out + at table - bought in is unchanged by that netting; adjustments by Chris never touch it.
  function summary(roomId, bank, live, opts) {
    const nightId = (opts && opts.nightId) || null;
    const all = !!(opts && opts.all), src = (opts && opts.rows) || entries;
    const rowOk = e => (all ? true : nightId ? e.nightId === nightId : (!e.nightId && e.mode !== 'cents'));
    const P = new Map();
    const ensure = (name, isBot) => {
      const k = key(name);
      if (!P.has(k)) P.set(k, { name, isBot: !!isBot, bank: isBot ? null : (bank[k] ?? null), atTable: 0, status: 'offline', totalBuyIns: 0, buyIns: 0, rebuys: 0, rebuyTotal: 0, cashedOut: 0, net: 0, biggestWin: 0, handsPlayed: 0, lastSeen: null, startBank: null, adjusted: 0 });
      return P.get(k);
    };
    const events = [];
    const starts = new Map(); // bank-start seen before the player's first real entry
    const parked = new Map(); // key -> [{ ev, left }]
    const lastBal = new Map();
    const handList = []; // snapshots in order; x-axis is sequential so restarts (handNum reset) don't overwrite
    for (const e of src) {
      if (!rowOk(e)) continue;
      if (e.type === 'snapshot') {
        if (!all && e.room !== roomId) continue;
        const h = { handNum: handList.length + 1, t: e.t, chips: {} };
        for (const sp of e.players) {
          const p = ensure(sp.name, sp.isBot);
          if (sp.played) p.handsPlayed++;
          h.chips[key(sp.name)] = sp.chips;
          p.lastSeen = Math.max(p.lastSeen || 0, e.t);
        }
        handList.push(h);
        continue;
      }
      if (!e.name) continue;
      const k = key(e.name);
      if (e.type === 'bank-start') {
        lastBal.set(k, e.balanceAfter);
        const p = P.get(k);
        if (p && p.startBank === null) p.startBank = e.amount;
        else if (!p) starts.set(k, starts.get(k) ?? e.amount);
        continue;
      }
      const p = ensure(e.name, false);
      if (p.startBank === null && starts.has(k)) p.startBank = starts.get(k);
      p.lastSeen = Math.max(p.lastSeen || 0, e.t);
      if (e.type === 'buyin' || e.type === 'rebuy') {
        let r = 0;
        const list = parked.get(k) || [];
        while (r < e.amount && list.length) {
          const q = list[0], take = Math.min(q.left, e.amount - r);
          q.left -= take; q.ev.amount = q.left; r += take;
          if (!q.left) list.shift();
        }
        p.cashedOut -= r;
        const counted = e.amount - r;
        if (counted > 0) {
          p.totalBuyIns += counted; p.buyIns++;
          if (e.type === 'rebuy') { p.rebuys++; p.rebuyTotal += counted; }
          events.push({ ...e, amount: counted });
        }
      } else if (e.type === 'cashout') {
        p.cashedOut += e.amount;
        const ev = { ...e };
        events.push(ev);
        if (e.park) { if (!parked.has(k)) parked.set(k, []); parked.get(k).push({ ev, left: e.amount }); }
      } else if (e.type === 'adjust') {
        const delta = typeof e.delta === 'number' ? e.delta : (lastBal.has(k) && typeof e.balanceAfter === 'number' ? e.balanceAfter - lastBal.get(k) : null);
        if (delta) p.adjusted += delta;
        events.push({ ...e, delta });
      } else if (e.type === 'legacy-import') {
        p.legacyNet = (p.legacyNet || 0) + e.amount;
        p.handsPlayed += e.hands || 0;
        if (e.biggestWin) p.biggestWin = Math.max(p.biggestWin, e.biggestWin);
        events.push({ ...e });
      } else if (e.type === 'win') p.biggestWin = Math.max(p.biggestWin, e.amount);
      if (typeof e.balanceAfter === 'number') lastBal.set(k, e.balanceAfter);
    }
    const RANK = { offline: 0, away: 1, 'sitting-out': 2, seated: 3 };
    for (const l of live) {
      const p = ensure(l.name, l.isBot);
      const first = p.status === 'offline' && p.atTable === 0;
      p.atTable += l.chips + (l.inPot || 0);
      if (first || (RANK[l.status] ?? 0) > (RANK[p.status] ?? 0)) p.status = l.status;
      p.name = l.name;
      if (l.status !== 'offline') p.lastSeen = Date.now();
    }
    for (const p of P.values()) {
      if (!p.isBot && displayOf) { const d = displayOf(key(p.name)); if (d) p.name = d; }
      if (p.startBank === null && starts.has(key(p.name))) p.startBank = starts.get(key(p.name));
      p.net = p.cashedOut + p.atTable - p.totalBuyIns + (p.legacyNet || 0);
      p.netTonight = nightId ? p.net : null;
    }
    const series = {};
    for (const [k, p] of P) {
      const pts = [];
      for (const h of handList) if (k in h.chips) pts.push([h.handNum, h.chips[k]]);
      if (pts.length) series[p.name] = pts;
    }
    const feed = events.filter(ev => ev.amount > 0 || ev.type === 'adjust' || ev.type === 'legacy-import').reverse().slice(0, 60)
      .map(ev => ({ t: ev.t, name: P.get(key(ev.name)).name, type: ev.type, amount: ev.amount, delta: ev.delta ?? null, balanceAfter: ev.balanceAfter ?? null }));
    return {
      t: Date.now(),
      nightId,
      players: [...P.values()].sort((a, b) => (b.bank ?? -1) + b.atTable - ((a.bank ?? -1) + a.atTable)),
      series,
      events: feed,
      maxHand: handList.length ? handList[handList.length - 1].handNum : 0,
    };
  }

  // ── nights / accounts (cents or chips; rows without `mode` are legacy chips) ──
  const rowMode = e => (e.mode === 'cents' ? 'cents' : 'chips');
  const rowKey = e => e.key || key(e.name || '');
  const signedOf = e => (e.type === 'cashout' ? e.amount : (e.type === 'buyin' || e.type === 'rebuy') ? -e.amount : e.type === 'adjust' && e.nightId ? (e.signed ?? 0) : e.type === 'legacy-import' ? e.amount : 0);

  // nets: [{key, net}] summing to 0 -> [{from, to, amount}] (keys), at most n-1 transfers
  function settlePayments(nets) {
    const cred = nets.filter(n => n.net > 0).map(n => ({ key: n.key, v: n.net })).sort((a, b) => b.v - a.v);
    const debt = nets.filter(n => n.net < 0).map(n => ({ key: n.key, v: -n.net })).sort((a, b) => b.v - a.v);
    const out = [];
    let i = 0, j = 0;
    while (i < debt.length && j < cred.length) {
      const amt = Math.min(debt[i].v, cred[j].v);
      if (amt > 0) out.push({ from: debt[i].key, to: cred[j].key, amount: amt });
      debt[i].v -= amt; cred[j].v -= amt;
      if (debt[i].v === 0) i++;
      if (cred[j].v === 0) j++;
      cred.sort((a, b) => b.v - a.v); debt.sort((a, b) => b.v - a.v);
      i = 0; j = 0;
      while (i < debt.length && debt[i].v === 0) i++;
      while (j < cred.length && cred[j].v === 0) j++;
      if (i >= debt.length || j >= cred.length) break;
    }
    return out;
  }

  function nightFromRows(rows, nightId, extra) {
    const P = new Map();
    let startedAt = null, endedAt = null, tableId = null, unit = null, tableName = null, ended = false;
    const paid = [];
    for (const e of rows) {
      if (e.type === 'night-end') { ended = true; endedAt = e.t; tableName = e.tableName || tableName; continue; }
      if (e.type === 'settle') { paid.push(e); continue; }
      if (!['buyin', 'rebuy', 'cashout', 'adjust'].includes(e.type) || !e.name) continue;
      tableId = tableId || e.tableId || e.room || null;
      unit = unit || rowMode(e);
      startedAt = startedAt === null ? e.t : Math.min(startedAt, e.t);
      if (!ended) endedAt = Math.max(endedAt || 0, e.t);
      const k = rowKey(e);
      if (!P.has(k)) P.set(k, { key: k, display: e.name, buyIns: 0, rebuys: 0, cashedOut: 0, adjust: 0, stack: 0, net: 0 });
      const p = P.get(k);
      if (e.type === 'buyin') p.buyIns += e.amount;
      else if (e.type === 'rebuy') p.rebuys += e.amount;
      else if (e.type === 'cashout') p.cashedOut += e.amount;
      else p.adjust += (e.signed ?? 0);
    }
    const players = [...P.values()];
    for (const p of players) p.net = p.cashedOut - p.buyIns - p.rebuys + p.adjust;
    players.sort((a, b) => b.net - a.net);
    const sum = players.reduce((s, p) => s + p.net, 0);
    const payments = unit === 'chips' || unit === null ? [] : settlePayments(players.map(p => ({ key: p.key, net: p.net })));
    for (const pay of payments) pay.paid = paid.some(s => s.from === pay.from && s.to === pay.to && s.amount === pay.amount);
    const out = { nightId, tableId, mode: unit, unit, startedAt, endedAt, ended, tableName, players, zeroSum: sum === 0, payments };
    if (sum !== 0) out.drift = sum;
    return Object.assign(out, extra || {});
  }

  function nightSummary(nightId) {
    return nightFromRows(entries.filter(e => e.nightId === nightId), nightId);
  }

  function accountNet(k, { mode } = {}) {
    k = key(k);
    let net = 0;
    for (const e of entries) {
      if (!e.name || !['buyin', 'rebuy', 'cashout', 'legacy-import'].includes(e.type)) continue;
      if (rowKey(e) !== k) continue;
      if (mode && rowMode(e) !== mode) continue;
      net += signedOf(e);
    }
    return net;
  }

  function accountNets({ mode } = {}) {
    const m = new Map();
    for (const e of entries) {
      if (!e.name || !['buyin', 'rebuy', 'cashout', 'legacy-import'].includes(e.type)) continue;
      if (mode && rowMode(e) !== mode) continue;
      const k = rowKey(e);
      m.set(k, (m.get(k) || 0) + signedOf(e));
    }
    return m;
  }

  function nightsFor(k, limit = 20) {
    k = key(k);
    const ids = new Map();
    for (const e of entries) if (e.nightId && rowKey(e) === k && ['buyin', 'rebuy', 'cashout', 'adjust'].includes(e.type)) ids.set(e.nightId, 1);
    const out = [];
    for (const id of ids.keys()) {
      const n = nightSummary(id);
      if (!n.ended) continue;
      const me = n.players.find(p => p.key === k);
      out.push({ nightId: id, tableId: n.tableId, tableName: n.tableName, mode: n.mode, unit: n.unit, endedAt: n.endedAt, net: me ? me.net : 0 });
    }
    return out.sort((a, b) => b.endedAt - a.endedAt).slice(0, limit);
  }

  return { log, seedBank, startHand, endHand, summary, nightSummary, nightFromRows, accountNet, accountNets, nightsFor, settlePayments, entries: () => entries };
}

module.exports = { createLedger };
