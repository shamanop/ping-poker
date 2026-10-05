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

  function log(type, name, amount, balanceAfter, tableChips, handNum, room) {
    if (type === 'cashout' && room) {
      const m = cashedDuring.get(room) || {};
      m[key(name)] = (m[key(name)] || 0) + amount;
      cashedDuring.set(room, m);
    }
    return push({ t: Date.now(), name, type, amount, balanceAfter, tableChips: tableChips ?? null, handNum: handNum ?? null, room: room || null });
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

  // live: [{ name, isBot, chips, status }] for players currently in any room
  function summary(roomId, bank, live) {
    const P = new Map();
    const ensure = (name, isBot) => {
      const k = key(name);
      if (!P.has(k)) P.set(k, { name, isBot: !!isBot, bank: isBot ? null : (bank[k] ?? null), atTable: 0, status: 'offline', totalBuyIns: 0, rebuys: 0, cashedOut: 0, net: 0, biggestWin: 0, handsPlayed: 0, lastSeen: null });
      return P.get(k);
    };
    const events = [];
    const hands = new Map(); // handNum -> { handNum, t, chips: {key: n} }
    for (const e of entries) {
      if (e.type === 'snapshot') {
        if (e.room !== roomId) continue;
        const h = { handNum: e.handNum, t: e.t, chips: {} };
        for (const sp of e.players) {
          const p = ensure(sp.name, sp.isBot);
          if (sp.played) p.handsPlayed++;
          h.chips[key(sp.name)] = sp.chips;
          p.lastSeen = Math.max(p.lastSeen || 0, e.t);
        }
        hands.set(e.handNum, h);
        continue;
      }
      if (!e.name) continue;
      const p = ensure(e.name, false);
      p.lastSeen = Math.max(p.lastSeen || 0, e.t);
      if (e.type === 'buyin') p.totalBuyIns += e.amount;
      else if (e.type === 'rebuy') { p.totalBuyIns += e.amount; p.rebuys++; }
      else if (e.type === 'cashout') p.cashedOut += e.amount;
      else if (e.type === 'win') p.biggestWin = Math.max(p.biggestWin, e.amount);
      if (e.type === 'buyin' || e.type === 'rebuy' || e.type === 'cashout') events.push(e);
    }
    for (const l of live) {
      const p = ensure(l.name, l.isBot);
      p.atTable = l.chips;
      p.status = l.status;
      if (l.status !== 'offline') p.lastSeen = Date.now();
    }
    for (const p of P.values()) p.net = p.cashedOut + p.atTable - p.totalBuyIns;
    const series = {};
    const handList = [...hands.values()].sort((a, b) => a.handNum - b.handNum);
    for (const [k, p] of P) {
      const pts = [];
      for (const h of handList) if (k in h.chips) pts.push([h.handNum, h.chips[k]]);
      if (pts.length) series[p.name] = pts;
    }
    return {
      t: Date.now(),
      players: [...P.values()].sort((a, b) => (b.bank ?? -1) + b.atTable - ((a.bank ?? -1) + a.atTable)),
      series,
      events: events.slice(-60).reverse(),
      maxHand: handList.length ? handList[handList.length - 1].handNum : 0,
    };
  }

  return { log, seedBank, startHand, endHand, summary, entries: () => entries };
}

module.exports = { createLedger };
