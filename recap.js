'use strict';
// Night recap (server). Presentation only: it records every finished hand (cards, board, actions, pot, winners) and builds the recap payload.
// It is FED by hooks on the v2 tables (PORT-CONTRACT section 3): registry out.event kinds hand_start / hand_end / void, the engine events
// that tables/hand-flow.js noteEvents already walks, and the show_cards handler. It never throws into a hand, never writes or reads money
// as a balance, and never sits in front of an emit: the registry calls it AFTER the transport out and after the ledger write of the settle.
// Night money truth is the money ledger: registry.nightOf(t).perKey[key] = { buyIn, cashOut, open, net } (chips and Play $ alike), the same
// numbers as registry.nightPayload(t) and so as the settle-up screen.
// Persistence: one JSONL line per finished hand, appended on setImmediate (after the tick's emits) and flushed synchronously on shutdown.
const fs = require('fs');

const HAND_RANK = { 'High Card': 1, 'Pair': 2, 'Two Pair': 3, 'Three of a Kind': 4, 'Straight': 5, 'Flush': 6, 'Full House': 7, 'Four of a Kind': 8, 'Straight Flush': 9, 'Royal Flush': 10 };
const MAX_HANDS = 6000;
// A POKERPING (permanent table) session = consecutive hands with no gap of SESSION_GAP_MS or more between them.
const SESSION_GAP_MS = 4 * 3600 * 1000;
const NO_NIGHT = 'No such night';
const cs = c => (c ? c.rank + c.suit : null);

function createRecap({ file, registry, accounts, now = Date.now, log }) {
  const say = log || ((...a) => console.error(...a));
  const reg = () => (typeof registry === 'function' ? registry() : registry && registry.current ? registry.current : registry);
  const isAdmin = key => !!(accounts && accounts.isAdmin && accounts.isAdmin(key));
  const acct = key => (accounts && accounts.get ? accounts.get(key) : null);

  let hands = [];
  const open = new Map();       // tableId -> hand in progress { rec, bySeat, street, pot, rb }
  const lastDone = new Map();   // tableId -> last finished record (voluntary shows patch it)
  const pending = [];           // JSONL lines waiting for the next setImmediate drain
  let scheduled = false, writeFails = 0, lastFailLog = 0;

  // ---- persistence --------------------------------------------------------------------------------------------
  const recKey = r => r.tableId + '|' + r.handNo;
  function load() {
    let txt = '';
    try { txt = fs.readFileSync(file, 'utf8'); } catch { return; }
    const lines = txt.split('\n').filter(Boolean);
    const at = new Map();     // a hand flushed twice around a shutdown is read once (last one wins)
    for (const ln of lines) {
      let j; try { j = JSON.parse(ln); } catch { continue; }
      if (!j || typeof j !== 'object') continue;                                  // a foreign line never stops the boot (critic r1 #2)
      if (j.patch) {
        if (!Array.isArray(j.shown)) continue;
        const r = hands[at.get(j.tableId + '|' + j.handNo)];
        const p = r && r.players.find(x => x && x.key === j.key);
        if (p) p.shown = [!!(p.shown && p.shown[0]) || !!j.shown[0], !!(p.shown && p.shown[1]) || !!j.shown[1]];
      } else if (Array.isArray(j.players) && j.players.every(x => x && typeof x === 'object' && Array.isArray(x.cards)) && Array.isArray(j.actions) && Array.isArray(j.winners) && Array.isArray(j.board) && typeof j.tableId === 'string' && Number.isFinite(j.handNo)) {
        const k = recKey(j);
        if (at.has(k)) hands[at.get(k)] = j; else { at.set(k, hands.length); hands.push(j); }
      }
    }
    if (lines.length > MAX_HANDS * 2) {                       // compact once: the file only ever grows otherwise
      const keep = hands.slice(-MAX_HANDS);
      try { const tmp = file + '.tmp'; fs.writeFileSync(tmp, keep.map(h => JSON.stringify(h)).join('\n') + '\n'); fs.renameSync(tmp, file); }
      catch (e) { say('[v2] recap compact failed:', e && e.code); }
    }
    if (hands.length > MAX_HANDS) hands = hands.slice(-MAX_HANDS);
  }
  function drain() {
    scheduled = false;
    if (!pending.length || !file) { pending.length = 0; return; }
    const text = pending.join('\n') + '\n'; pending.length = 0;
    try { fs.appendFileSync(file, text); }
    catch (e) {
      writeFails++;                                           // the hands stay in memory; a hand never depends on this file
      const t = now(); if (t - lastFailLog > 60000) { lastFailLog = t; say('[v2] recap file not writable:', e && e.code); }
    }
  }
  function append(obj) {
    if (!file) return;
    pending.push(JSON.stringify(obj));
    if (!scheduled) { scheduled = true; setImmediate(drain); }
  }
  const flush = () => { try { drain(); } catch {} };
  load();

  // ---- recording ----------------------------------------------------------------------------------------------
  function startHand(t) {
    const h = t.hand; if (!h) return;
    const rec = {
      t: now(), tableId: t.id, nightId: t.nightId || null, mode: t.mode, unit: t.unit, handNo: h.handNo, handNum: h.handNo - (t.nightHand0 || 0),
      sb: h.sb, bb: h.bb, players: [], actions: [], board: [], pot: 0, showdown: false, winners: [],
    };
    const o = { rec, bySeat: {}, street: 'preflop', pot: 0, rb: {} };
    for (const no of Object.keys(h.seats).map(Number).sort((a, b) => a - b)) {
      const s = t.seats.get(no), hs = h.seats[no]; if (!s) continue;
      const rp = { key: s.key, name: t.displayOf(s.key), seat: no, start: (t.handStartStacks && t.handStartStacks[no] != null) ? t.handStartStacks[no] : hs.stack + hs.committed, cards: hs.hole.map(cs), bet: hs.committed };
      if (no === h.button) rp.dealer = true;
      rec.players.push(rp); o.bySeat[no] = rp;
    }
    for (const [no, a] of [[h.sbSeat, 'sb'], [h.bbSeat, 'bb']]) {
      const rp = o.bySeat[no]; if (!rp) continue;
      const put = h.seats[no].committed;
      o.pot += put; o.rb[no] = h.seats[no].bet;
      rec.actions.push({ k: rp.key, street: 'preflop', a, put, to: o.rb[no], allIn: h.seats[no].allIn || undefined, pot: o.pot });
    }
    open.set(t.id, o);
  }

  // events are the engine events of one action (fold, check, call, raise, returned, street, runout, showdown)
  function onEngine(t, events) {
    const o = open.get(t.id); if (!o) return;
    for (const e of events || []) {
      if (e.type === 'street') { o.street = e.street; o.rb = {}; continue; }
      const rp = e.seat != null ? o.bySeat[e.seat] : null;
      if (!rp) continue;
      if (e.type === 'fold') o.rec.actions.push({ k: rp.key, street: o.street, a: 'fold', put: 0, to: o.rb[e.seat] || 0, forced: e.forced || undefined, pot: o.pot });
      else if (e.type === 'check') o.rec.actions.push({ k: rp.key, street: o.street, a: 'check', put: 0, to: o.rb[e.seat] || 0, pot: o.pot });
      else if (e.type === 'call') {
        o.pot += e.amount; o.rb[e.seat] = (o.rb[e.seat] || 0) + e.amount; rp.bet += e.amount;
        o.rec.actions.push({ k: rp.key, street: o.street, a: 'call', put: e.amount, to: o.rb[e.seat], allIn: e.allIn || undefined, pot: o.pot });
      } else if (e.type === 'raise') {
        o.pot += e.added; o.rb[e.seat] = e.to; rp.bet += e.added;
        o.rec.actions.push({ k: rp.key, street: o.street, a: 'raise', kind: e.kind, put: e.added, to: e.to, allIn: e.allIn || undefined, pot: o.pot });
      } else if (e.type === 'returned') {
        o.pot -= e.amount; rp.bet -= e.amount;
        o.rec.actions.push({ k: rp.key, street: o.street, a: 'back', put: -e.amount, to: 0, pot: o.pot });
      }
    }
  }

  // data = { hand, result, bySeat } emitted by afterCommit, i.e. after the ledger write of the settle
  function endHand(t, data) {
    const o = open.get(t.id); if (!o) return;
    open.delete(t.id);
    const h = data && data.hand, res = h && h.result; if (!res) return;
    const rec = o.rec;
    rec.board = (h.board || []).map(cs);
    for (const rp of rec.players) {
      const hs = h.seats[rp.seat]; if (!hs) continue;
      rp.end = hs.stack;
      rp.bet = hs.committed - (hs.returned || 0);             // what was really at risk: an uncalled bet handed back is not a bet
      rp.net = res.net[rp.seat] != null ? res.net[rp.seat] : (res.payouts[rp.seat] || 0) - rp.bet;
      if (hs.folded) rp.folded = true;
      const live = data.bySeat && data.bySeat[rp.seat];
      if (live && live.leaving) rp.left = true;
    }
    rec.pot = rec.players.reduce((s, x) => s + x.bet, 0);
    rec.showdown = !h.uncontested && (res.reveals || []).length > 0;
    if (rec.showdown) for (const no of res.reveals) {
      const rp = o.bySeat[no]; if (rp) { rp.hand = (res.handNames && res.handNames[no]) || ''; rp.shown = [true, true]; }
    }
    for (const rp of rec.players) {
      const amount = res.payouts[rp.seat] || 0;
      if (amount > 0) rec.winners.push({ key: rp.key, name: rp.name, amount, handName: rec.showdown ? (rp.hand || null) : null });
    }
    rec.t = now();
    hands.push(rec); if (hands.length > MAX_HANDS) hands.shift();
    lastDone.set(t.id, rec);
    append(rec);
  }

  // a player voluntarily shows after the hand: patch the finished record
  function onShown(t, key, flags) {
    const rec = lastDone.get(t.id);
    if (!rec || rec.handNo !== t.handNo) return;
    const rp = rec.players.find(x => x.key === key); if (!rp) return;
    rp.shown = [!!(rp.shown && rp.shown[0]) || !!flags[0], !!(rp.shown && rp.shown[1]) || !!flags[1]];
    append({ patch: true, tableId: rec.tableId, handNo: rec.handNo, key, shown: [!!flags[0], !!flags[1]] });
  }

  // registry out.event(t, kind, data): every table event passes here; the recorder takes three kinds.
  function onEvent(t, kind, data) {
    if (kind === 'hand_start') startHand(t);
    else if (kind === 'hand_end') endHand(t, data);
    else if (kind === 'void') open.delete(t.id);               // a voided hand never happened
  }

  // ---- building the payload ------------------------------------------------------------------------------------
  function sessionsOf(tableId) {
    const out = [];
    for (const h of hands) {
      if (h.tableId !== tableId) continue;
      const s = out[out.length - 1];
      if (s && h.t - s.end < SESSION_GAP_MS) { s.end = h.t; s.hands++; } else out.push({ start: h.t, end: h.t, hands: 1 });
    }
    return out;
  }

  function superlatives(hs, nameOf) {
    const out = [];
    const tally = (m, k, v = 1) => m.set(k, (m.get(k) || 0) + v);
    const top = (m, min) => { let best = -Infinity; for (const v of m.values()) best = Math.max(best, v); if (!(best >= min)) return null; return { value: best, keys: [...m].filter(([, v]) => v === best).map(([k]) => k) }; };
    const wins = new Map(), fold = new Map(), raises = new Map(), allins = new Map(), single = new Map(), loss = new Map();
    let bigPot = null, bestHand = null;
    const last = new Map(), streak = new Map();   // current/longest consecutive wins
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
      for (const a of h.actions) { if (a.a === 'raise') tally(raises, a.k); if (a.allIn && a.a !== 'sb' && a.a !== 'bb') tally(allins, a.k); }
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

  function resolve(tableId, nightId) {
    const R = reg(); if (!R) return null;
    if (nightId) { for (const t of R.tables.values()) if (t.nightId === nightId) return t; return null; }
    return tableId ? R.get(tableId) : null;
  }

  function build({ viewerKey, tableId, nightId, start }) {
    const t = resolve(tableId, nightId);
    if (!t) return { error: NO_NIGHT };
    const R = reg();
    const legacy = !t.nightId;
    const notes = [];
    let hs, scope;
    if (legacy) {
      const sessions = sessionsOf(t.id);
      const s = start ? sessions.find(x => x.start === Number(start)) : sessions[sessions.length - 1];
      hs = s ? hands.filter(h => h.tableId === t.id && h.t >= s.start && h.t <= s.end) : [];
      scope = { kind: 'session', tableId: t.id, tableName: t.name, mode: t.mode, unit: t.unit, start: s ? s.start : null, end: s ? s.end : null, ended: !!s && now() - s.end >= SESSION_GAP_MS, sessions: sessions.slice(-12).reverse() };
      notes.push('A POKERPING session is a run of hands with no gap of 4 hours or more. Net is chips won or lost in hands; buy-ins, cash-outs and bank edits are not counted.');
    } else {
      hs = hands.filter(h => h.nightId === t.nightId);
      scope = { kind: 'night', nightId: t.nightId, tableId: t.id, tableName: t.name, mode: t.mode, unit: t.unit, start: hs.length ? hs[0].t : t.createdAt, end: hs.length ? hs[hs.length - 1].t : null, ended: t.state === 'ended' };
    }
    let nightRows = null;
    if (!legacy) {
      try { nightRows = R.nightOf(t).perKey; } catch (e) { say('[v2] recap nightOf failed:', e && e.message); }
      if (!nightRows) notes.push('Money totals are unavailable right now. Nets here come from the hands recorded.');
      if (hs.length && hs[0].handNum > 1) notes.push(`Hand log starts at hand #${hs[0].handNum}; earlier hands were played before recording began.`);
    }
    if (viewerKey && !legacy && !isAdmin(viewerKey)) {
      const inNight = t.hostKey === viewerKey || (nightRows && nightRows[viewerKey]) || hs.some(h => h.players.some(p => p.key === viewerKey));
      if (!inNight) return { error: NO_NIGHT };
    }

    // per-player table
    const P = new Map();
    const dispOf = key => { const a = acct(key); return a ? a.display : null; };
    const ensure = (key, name) => {
      if (!P.has(key)) { const a = acct(key); P.set(key, { key, name: dispOf(key) || name || key, avatar: a ? a.avatar : null, pic: a && accounts.picUrl ? accounts.picUrl(a) : null, isBot: false, hands: 0, won: 0, handNet: 0, settleNet: null, net: 0, buyIns: null, cashedOut: null }); }
      return P.get(key);
    };
    for (const h of hs) for (const p of h.players) {
      const r = ensure(p.key, p.name); r.hands++; r.handNet += p.net || 0;
      if (h.winners.some(w => w.key === p.key && (w.amount || 0) > 0)) r.won++;
    }
    if (nightRows) for (const [k, n] of Object.entries(nightRows)) {
      const r = ensure(k, null);
      r.buyIns = n.buyIn; r.cashedOut = n.cashOut + n.open; r.settleNet = n.net;   // the same three numbers registry.nightPayload sends to the settle-up screen
    }
    const players = [...P.values()];
    for (const p of players) p.net = p.settleNet !== null ? p.settleNet : p.handNet;
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
      actions: h.actions.map(a => ({ key: a.k, street: a.street, a: a.a, kind: a.kind || null, put: a.put, to: a.to, allIn: !!a.allIn, pot: a.pot })),
    }));
    for (const p of players) p.raises = hs.reduce((s, h) => s + h.actions.filter(a => a.k === p.key && a.a === 'raise').length, 0);
    const sup = superlatives(hs, nameOf);
    return {
      ok: true, scope, notes, players, superlatives: sup, hands: handsOut,
      totals: { hands: hs.length, pot: hs.reduce((s, h) => s + h.pot, 0), handNetSum: players.reduce((s, p) => s + p.handNet, 0) },
      generatedAt: now(),
    };
  }

  return { onEvent, onEngine, onShown, build, sessionsOf, flush, all: () => hands, stats: () => ({ hands: hands.length, open: open.size, writeFails }) };
}

module.exports = { createRecap, SESSION_GAP_MS, HAND_RANK, MAX_HANDS };
