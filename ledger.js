'use strict';
// Append-only bank ledger, kept in its own file. Never touches bank.json or chip math.
const fs = require('fs');

function createLedger({ file, onWrite }) {
  let entries = [];
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (Array.isArray(j)) entries = j; } catch { entries = []; }

  const key = n => String(n).toLowerCase().trim();
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

  // extra: optional fields merged into the entry, e.g. { park: true } on a cash-out that a later buy-in resumes, { delta } on an adjust.
  function log(type, name, amount, balanceAfter, tableChips, handNum, room, extra) {
    if (type === 'cashout' && room) {
      const m = cashedDuring.get(room) || {};
      m[key(name)] = (m[key(name)] || 0) + amount;
      cashedDuring.set(room, m);
    }
    return push({ t: Date.now(), name, type, amount, balanceAfter, tableChips: tableChips ?? null, handNum: handNum ?? null, room: room || null, ...(extra || {}) });
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
    push({ t, type: 'snapshot', room: room.id, handNum: room.handNum, players });
    if (!start) return;
    for (const p of room.players) {
      if (p.isBot) continue;
      const k = key(p.name);
      if (!(k in start) || start[k] <= 0) continue;
      const delta = p.chips + (cashed[k] || 0) - start[k];
      if (delta === 0) continue;
      push({ t, name: p.name, type: delta > 0 ? 'win' : 'loss', amount: Math.abs(delta), balanceAfter: bankOf(p.name), tableChips: p.chips, handNum: room.handNum, room: room.id });
    }
    handStart.delete(room.id);
    cashedDuring.delete(room.id);
  }

  // live: [{ name, isBot, chips, inPot, status }] for players currently in any room
  // Cash-outs flagged park (disconnect, shutdown, lone player) are chips returned to the bank only until the player sits back down:
  // a later buy-in/rebuy by the same name resumes up to the parked amount, so a refresh never shows as a new buy-in or a cash-out.
  // Net P&L = cashed out + at table - bought in is unchanged by that netting; adjustments by Chris never touch it.
  function summary(roomId, bank, live) {
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
    for (const e of entries) {
      if (e.type === 'snapshot') {
        if (e.room !== roomId) continue;
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
      if (p.startBank === null && starts.has(key(p.name))) p.startBank = starts.get(key(p.name));
      p.net = p.cashedOut + p.atTable - p.totalBuyIns;
    }
    const series = {};
    for (const [k, p] of P) {
      const pts = [];
      for (const h of handList) if (k in h.chips) pts.push([h.handNum, h.chips[k]]);
      if (pts.length) series[p.name] = pts;
    }
    const feed = events.filter(ev => ev.amount > 0 || ev.type === 'adjust').reverse().slice(0, 60)
      .map(ev => ({ t: ev.t, name: P.get(key(ev.name)).name, type: ev.type, amount: ev.amount, delta: ev.delta ?? null, balanceAfter: ev.balanceAfter ?? null }));
    return {
      t: Date.now(),
      players: [...P.values()].sort((a, b) => (b.bank ?? -1) + b.atTable - ((a.bank ?? -1) + a.atTable)),
      series,
      events: feed,
      maxHand: handList.length ? handList[handList.length - 1].handNum : 0,
    };
  }

  return { log, seedBank, startHand, endHand, summary, entries: () => entries };
}

module.exports = { createLedger };
