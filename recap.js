'use strict';
// Night recap: records every hand (cards, board, actions, pot, winners) and builds the recap payload.
// Hand records are appended to a JSONL file next to the bank (also for Play $ tables: they hold no balances).
// Play $ money rows (buy-ins/cash-outs) only live in memory in tables.js, so recaps flag when that history is partial.
const fs = require('fs');

const HAND_RANK = { 'High Card': 1, 'Pair': 2, 'Two Pair': 3, 'Three of a Kind': 4, 'Straight': 5, 'Flush': 6, 'Full House': 7, 'Four of a Kind': 8, 'Straight Flush': 9, 'Royal Flush': 10 };
const MAX_HANDS = 6000;
// A POKERPING (permanent table) session = consecutive hands with no gap of SESSION_GAP_MS or more between them.
const SESSION_GAP_MS = 4 * 3600 * 1000;
const cs = c => (c ? c.rank + c.suit : null);

function createRecap({ file, keyOf, dispOf, avatarOf, picOf, isAdmin, getTables, getRooms, ledger, bootAt }) {
  let hands = [];
  const open = new Map();   // roomId -> record in progress
  const lastDone = new Map(); // roomId -> last finished record (voluntary shows patch it)

  function load() {
    let txt = '';
    try { txt = fs.readFileSync(file, 'utf8'); } catch { return; }
    const lines = txt.split('\n').filter(Boolean);
    for (const ln of lines) {
      let j; try { j = JSON.parse(ln); } catch { continue; }
      if (j.patch) {
        const r = [...hands].reverse().find(h => h.tableId === j.tableId && h.handNum === j.handNum && h.t === j.ht);
        if (r) { const p = r.players.find(x => x.key === j.key); if (p) p.shown = j.shown; }
      } else hands.push(j);
    }
    if (hands.length > MAX_HANDS) hands = hands.slice(-MAX_HANDS);
  }
  load();
  function append(obj) { try { fs.appendFile(file, JSON.stringify(obj) + '\n', () => {}); } catch {} }

  const keyOfPlayer = p => p.acct || keyOf(p.name);

  function startHand(room, sbIdx, bbIdx) {
    const rec = {
      t: Date.now(), tableId: room.id, nightId: room.nightId || null, mode: room.mode, unit: room.unit,
      handNum: room.handNum, sb: room.sb, bb: room.bb,
      players: [], actions: [], board: [], pot: 0, showdown: false, winners: [],
    };
    room.players.forEach((p, i) => {
      if (!p.cards || p.cards.length < 2) return;
      rec.players.push({ key: keyOfPlayer(p), name: p.name, isBot: !!p.isBot, seat: i, start: p.handStartChips, cards: p.cards.map(cs), bet: p.handBet || 0, dealer: i === room.dealerIdx || undefined });
      if (i === sbIdx) rec.actions.push({ k: keyOfPlayer(p), street: 'preflop', a: 'sb', put: p.handBet || 0, to: p.roundBet || 0, pot: 0 });
      if (i === bbIdx) rec.actions.push({ k: keyOfPlayer(p), street: 'preflop', a: 'bb', put: p.handBet || 0, to: p.roundBet || 0, pot: 0 });
    });
    rec.actions.sort((x, y) => (x.a === 'sb' ? 0 : 1) - (y.a === 'sb' ? 0 : 1));
    for (const a of rec.actions) a.pot = room.pot;
    open.set(room.id, rec);
  }

  function onAction(room, p) {
    const rec = open.get(room.id); if (!rec) return;
    const k = keyOfPlayer(p), rp = rec.players.find(x => x.key === k); if (!rp) return;
    const put = (p.handBet || 0) - rp.bet; rp.bet = p.handBet || 0;
    const a = String(p.lastAction || '').toLowerCase();
    rec.actions.push({ k, street: room.street, a, put, to: p.roundBet || 0, allIn: p.allIn || undefined, pot: room.pot });
  }

  function onShowdown(room, winnerList, reveals) {
    const rec = open.get(room.id); if (!rec) return;
    rec.showdown = true;
    rec.reveals = reveals.map(r => ({ name: r.name, handName: r.handName }));
    rec.winnerList = winnerList.map(w => ({ name: w.name, amount: w.amount, handName: w.handName }));
  }

  function endHand(room) {
    const rec = open.get(room.id); if (!rec) return; open.delete(room.id);
    rec.board = room.community.map(cs);
    for (const rp of rec.players) {
      const p = room.players.find(x => keyOfPlayer(x) === rp.key);
      if (p) { rp.end = p.chips; rp.bet = p.handBet || rp.bet; rp.net = p.chips - rp.start; if (p.folded) rp.folded = true; }
      else { rp.end = 0; rp.net = -rp.bet; rp.left = true; }
    }
    rec.pot = rec.players.reduce((s, x) => s + x.bet, 0);
    const wl = rec.winnerList || [];
    delete rec.winnerList;
    if (rec.showdown) {
      rec.winners = wl.map(w => { const rp = rec.players.find(x => x.name === w.name); return { key: rp && rp.key, name: w.name, amount: w.amount, handName: w.handName }; });
      const names = new Set(rec.reveals.map(r => r.name));
      for (const rp of rec.players) { if (names.has(rp.name)) { rp.hand = rec.reveals.find(r => r.name === rp.name).handName; rp.shown = [true, true]; } }
      delete rec.reveals;
    } else {
      const w = rec.players.filter(x => x.net > 0).sort((a, b) => b.net - a.net)[0];
      rec.winners = w ? [{ key: w.key, name: w.name, amount: w.net + w.bet, handName: null }] : [];
    }
    rec.t = Date.now();
    hands.push(rec); if (hands.length > MAX_HANDS) hands.shift();
    lastDone.set(room.id, rec);
    append(rec);
  }

  // a player voluntarily shows after the hand: patch the finished record
  function onShown(room, key, flags) {
    const rec = lastDone.get(room.id);
    if (!rec || rec.handNum !== room.handNum) return;
    const rp = rec.players.find(x => x.key === key); if (!rp) return;
    rp.shown = [!!flags[0], !!flags[1]];
    append({ patch: true, tableId: rec.tableId, handNum: rec.handNum, ht: rec.t, key, shown: rp.shown });
  }

  // ── building the payload ────────────────────────────────────────────────
  function sessionsOf(tableId) {
    const hs = hands.filter(h => h.tableId === tableId);
    const out = [];
    for (const h of hs) {
      const s = out[out.length - 1];
      if (s && h.t - s.end < SESSION_GAP_MS) { s.end = h.t; s.hands++; } else out.push({ start: h.t, end: h.t, hands: 1 });
    }
    return out;
  }

  function nightPlayers(t) {
    const rows = t.mode === 'play' ? getTables().playEntries().filter(e => e.nightId === t.nightId) : null;
    return rows ? ledger.nightFromRows(rows, t.nightId) : ledger.nightSummary(t.nightId);
  }

  function superlatives(hs, nameOf) {
    const out = [];
    const tally = (m, k, v = 1) => m.set(k, (m.get(k) || 0) + v);
    const top = (m, min) => { let best = -Infinity; for (const v of m.values()) best = Math.max(best, v); if (!(best >= min)) return null; return { value: best, keys: [...m].filter(([, v]) => v === best).map(([k]) => k) }; };
    const wins = new Map(), fold = new Map(), raises = new Map(), allins = new Map(), single = new Map(), loss = new Map();
    let bigPot = null, bestHand = null;
    const last = new Map(), streak = new Map(); // current/longest consecutive wins
    for (const h of hs) {
      const winKeys = new Set(h.winners.filter(w => (w.amount || 0) > 0).map(w => w.key));
      for (const p of h.players) {
        if (winKeys.has(p.key)) { tally(wins, p.key); if (!h.showdown) tally(fold, p.key); }
        if (p.net > 0) single.set(p.key, Math.max(single.get(p.key) || 0, p.net));
        if (p.net < 0) loss.set(p.key, Math.min(loss.get(p.key) || 0, p.net));
        const won = winKeys.has(p.key);
        const run = won ? (last.get(p.key) || 0) + 1 : 0; last.set(p.key, run);
        if (run > (streak.get(p.key) || 0)) streak.set(p.key, run);
      }
      for (const a of h.actions) { if (a.a === 'raise') tally(raises, a.k); if (a.allIn) tally(allins, a.k); }
      if (!bigPot || h.pot > bigPot.pot) bigPot = h;
      if (h.showdown) for (const p of h.players) {
        const r = HAND_RANK[p.hand] || 0;
        if (r && (!bestHand || r > bestHand.r || (r === bestHand.r && h.pot > bestHand.h.pot))) bestHand = { r, h, p };
      }
    }
    const nm = ks => ks.map(nameOf);
    if (bigPot) { const w = bigPot.winners[0]; out.push({ id: 'bigpot', label: 'Biggest pot', kind: 'money', value: bigPot.pot, names: nm(bigPot.winners.map(x => x.key)), handNum: bigPot.handNum, detail: w && w.handName ? w.handName : 'Everyone folded' }); }
    if (bestHand) out.push({ id: 'besthand', label: 'Best hand shown', kind: 'text', value: bestHand.p.hand, names: nm([bestHand.p.key]), handNum: bestHand.h.handNum, cards: bestHand.p.cards, board: bestHand.h.board });
    let t;
    if ((t = top(wins, 2))) out.push({ id: 'mostwins', label: 'Most hands won', kind: 'count', value: t.value, names: nm(t.keys) });
    if ((t = top(single, 1))) { const h = hs.find(x => x.players.some(p => p.key === t.keys[0] && p.net === t.value)); out.push({ id: 'bigwin', label: 'Biggest single-hand win', kind: 'money', value: t.value, names: nm(t.keys), handNum: h && h.handNum }); }
    const worst = Math.min(0, ...loss.values());
    if (worst < 0) { const ks = [...loss].filter(([, v]) => v === worst).map(([k]) => k); const h = hs.find(x => x.players.some(p => p.key === ks[0] && p.net === worst)); out.push({ id: 'bigloss', label: 'Biggest single-hand loss', kind: 'money', value: worst, names: nm(ks), handNum: h && h.handNum }); }
    if ((t = top(raises, 3))) out.push({ id: 'raises', label: 'Most raises', kind: 'count', value: t.value, names: nm(t.keys) });
    if ((t = top(allins, 2))) out.push({ id: 'allins', label: 'Most all-ins', kind: 'count', value: t.value, names: nm(t.keys) });
    if ((t = top(fold, 2))) out.push({ id: 'uncalled', label: 'Most pots won by everyone folding', kind: 'count', value: t.value, names: nm(t.keys) });
    if ((t = top(streak, 3))) out.push({ id: 'streak', label: 'Longest winning streak', kind: 'count', value: t.value, names: nm(t.keys), detail: 'hands in a row' });
    return out;
  }

  function build({ viewerKey, tableId, nightId, start }) {
    const T = getTables();
    let t = null;
    if (nightId) t = [...T.tables.values()].find(x => x.nightId === nightId) || null;
    else if (tableId) t = T.tables.get(tableId) || null;
    if (!t) return { error: 'No such night' };
    const legacy = !t.nightId;
    const notes = [];
    let hs, scope;
    if (legacy) {
      const sessions = sessionsOf(t.id);
      const s = start ? sessions.find(x => x.start === Number(start)) : sessions[sessions.length - 1];
      hs = s ? hands.filter(h => h.tableId === t.id && h.t >= s.start && h.t <= s.end) : [];
      scope = { kind: 'session', tableId: t.id, tableName: t.name, mode: t.mode, unit: t.unit, start: s ? s.start : null, end: s ? s.end : null, ended: !!s && Date.now() - s.end >= SESSION_GAP_MS, sessions: sessions.slice(-12).reverse() };
      notes.push('A POKERPING session is a run of hands with no gap of 4 hours or more. Net is chips won or lost in hands; buy-ins, cash-outs and bank edits are not counted.');
    } else {
      hs = hands.filter(h => h.nightId === t.nightId);
      scope = { kind: 'night', nightId: t.nightId, tableId: t.id, tableName: t.name, mode: t.mode, unit: t.unit, start: hs.length ? hs[0].t : t.createdAt, end: hs.length ? hs[hs.length - 1].t : null, ended: t.state === 'ended' };
    }
    let nightRows = null;
    if (!legacy) {
      const n = nightPlayers(t); nightRows = new Map(n.players.map(p => [p.key, p]));
      if (hs.length && hs[0].handNum > 1) notes.push(`Hand log starts at hand #${hs[0].handNum}; earlier hands were played before recording began.`);
      if (t.mode === 'play' && t.createdAt < bootAt) {
        scope.partialMoney = true;
        notes.push(`Play $ buy-in and cash-out history is kept in memory only and starts at the last restart (${new Date(bootAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}). Nets here come from the hands recorded, not from buy-in totals.`);
      }
    }
    if (viewerKey && !isAdmin(viewerKey) && !legacy) {
      const inNight = t.hostKey === viewerKey || (nightRows && nightRows.has(viewerKey)) || hs.some(h => h.players.some(p => p.key === viewerKey));
      if (!inNight) return { error: 'No such night' };
    }

    // per-player table
    const P = new Map();
    const ensure = (key, name, isBot) => { if (!P.has(key)) P.set(key, { key, name: dispOf(key) || name, avatar: avatarOf(key), pic: picOf(key), isBot: !!isBot, hands: 0, won: 0, handNet: 0, settleNet: null, net: 0, buyIns: null, cashedOut: null, atTable: null }); return P.get(key); };
    for (const h of hs) for (const p of h.players) {
      const r = ensure(p.key, p.name, p.isBot); r.hands++; r.handNet += p.net || 0;
      if (h.winners.some(w => w.key === p.key && (w.amount || 0) > 0)) r.won++;
    }
    const rooms = getRooms(); const room = rooms.get(t.id);
    if (nightRows) for (const [k, n] of nightRows) {
      const r = ensure(k, n.display, false);
      const seat = room && room.players.find(x => !x.isBot && keyOfPlayer(x) === k);
      const cur = open.get(t.id), inHand = cur && cur.players.find(x => x.key === k);
      r.atTable = inHand ? inHand.start : seat ? seat.chips : 0;
      r.buyIns = n.buyIns + n.rebuys; r.cashedOut = n.cashedOut;
      r.settleNet = n.net + r.atTable;
    }
    const useSettle = !scope.partialMoney && !legacy;
    const players = [...P.values()];
    for (const p of players) p.net = useSettle && p.settleNet !== null ? p.settleNet : p.handNet;
    players.sort((a, b) => b.net - a.net);
    const nameOf = k => (P.get(k) ? P.get(k).name : k);

    // hands, with private cards removed unless shown (viewer sees their own)
    const handsOut = hs.map(h => ({
      handNum: h.handNum, t: h.t, sb: h.sb, bb: h.bb, pot: h.pot, board: h.board, showdown: h.showdown,
      winners: h.winners.map(w => ({ key: w.key, name: nameOf(w.key), amount: w.amount, handName: w.handName })),
      players: h.players.map(p => {
        const shown = p.shown && (p.shown[0] || p.shown[1]);
        const see = p.key === viewerKey || shown;
        return { key: p.key, name: nameOf(p.key), start: p.start, end: p.end, net: p.net, bet: p.bet, folded: !!p.folded, left: !!p.left, dealer: !!p.dealer, hand: p.hand || null,
          cards: see ? p.cards.map((c, i) => (p.key === viewerKey || (p.shown && p.shown[i]) ? c : null)) : [null, null] };
      }),
      actions: h.actions.map(a => ({ key: a.k, street: a.street, a: a.a, put: a.put, to: a.to, allIn: !!a.allIn, pot: a.pot })),
    }));
    for (const p of players) { p.raises = hs.reduce((s, h) => s + h.actions.filter(a => a.k === p.key && a.a === 'raise').length, 0); }
    const sup = superlatives(hs, nameOf);
    return {
      ok: true, scope, notes, players, superlatives: sup, hands: handsOut,
      totals: { hands: hs.length, pot: hs.reduce((s, h) => s + h.pot, 0), handNetSum: players.reduce((s, p) => s + p.handNet, 0) },
      generatedAt: Date.now(),
    };
  }

  function attach(socket, on, authed) {
    on('recap_get', d => {
      const key = authed(); if (!key) return;
      const out = build({ viewerKey: key, tableId: typeof d.tableId === 'string' ? d.tableId : null, nightId: typeof d.nightId === 'string' ? d.nightId : null, start: d.start });
      if (out.error) socket.emit('error', { message: out.error, code: 'recap' }); else socket.emit('recap_data', out);
    });
  }

  return { startHand, onAction, onShowdown, endHand, onShown, build, sessionsOf, attach, all: () => hands };
}

module.exports = { createRecap, SESSION_GAP_MS, HAND_RANK };
