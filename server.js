'use strict';

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const fs      = require('fs');

// ─── Constants ───────────────────────────────────────────────────────────────

const STARTING_CHIPS  = 1500;
const BANK_DEFAULT    = 10000;
const BANK_FILE       = path.join(__dirname, 'bank.json');
const TURN_MS         = 30000;
const SMALL_BLIND     = 10;
const BIG_BLIND       = 20;
const SUITS           = ['♠', '♥', '♦', '♣'];
const RANKS           = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

const BLIND_SCHEDULE = [
  { sb: 10,  bb: 20  },
  { sb: 15,  bb: 30  },
  { sb: 25,  bb: 50  },
  { sb: 50,  bb: 100 },
  { sb: 75,  bb: 150 },
  { sb: 100, bb: 200 },
  { sb: 150, bb: 300 },
  { sb: 200, bb: 400 },
];

// ─── Bank System ─────────────────────────────────────────────────────────────

let bank = {};
try { bank = JSON.parse(fs.readFileSync(BANK_FILE, 'utf8')); } catch { bank = {}; }

function bankKey(name) { return String(name).toLowerCase().trim(); }

function getBalance(name) {
  const k = bankKey(name);
  if (bank[k] === undefined) { bank[k] = BANK_DEFAULT; saveBank(); }
  return bank[k];
}

function adjustBank(name, delta) {
  const k = bankKey(name);
  if (bank[k] === undefined) bank[k] = BANK_DEFAULT;
  bank[k] = Math.max(0, bank[k] + delta);
  saveBank();
  return bank[k];
}

function saveBank() {
  try { fs.writeFileSync(BANK_FILE, JSON.stringify(bank)); } catch {}
}

function getLeaderboard() {
  return Object.entries(bank)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, balance]) => ({ name, balance }));
}

// ─── App Setup ───────────────────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// ─── Room State ──────────────────────────────────────────────────────────────

const rooms = new Map();

function makeRoom(id, hostSocketId) {
  return {
    id,
    hostSocketId,
    status:       'waiting',
    players:      [],
    deck:         [],
    community:    [],
    pot:          0,
    currentBet:   0,
    dealerIdx:    0,
    street:       null,
    actionQueue:  [],
    handNum:      0,
    log:          [],
    turnTimeout:  null,
    turnStartedAt: null,
    sb:               SMALL_BLIND,
    bb:               BIG_BLIND,
    blindLevel:       0,
    blindsEnabled:    false,
    blindIntervalMs:  0,
    blindLevelStartAt: null,
    blindTimer:       null,
    handHistory:      [],
  };
}

function makePlayer(socketId, name, avatar, chips) {
  return {
    socketId,
    name,
    avatar:     avatar || '🃏',
    profilePic: null,
    chips:      chips !== undefined ? chips : STARTING_CHIPS,
    chipsBought: chips !== undefined ? chips : STARTING_CHIPS,
    lastAction: null,
    cards:      [],
    roundBet:   0,
    folded:     false,
    allIn:      false,
    sittingOut: false,
    sitOutRequest: false,
    connected:  true,
  };
}

// ─── Deck & Shuffle ──────────────────────────────────────────────────────────

function makeDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// ─── Hand Evaluator ──────────────────────────────────────────────────────────

function combs(arr, k) {
  if (k === 0) return [[]];
  if (arr.length === 0) return [];
  const [first, ...rest] = arr;
  return [...combs(rest, k - 1).map(c => [first, ...c]), ...combs(rest, k)];
}

const RANK_VAL = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));
function rankVal(card) { return RANK_VAL[card.rank]; }
function sortDesc(vals) { return [...vals].sort((a, b) => b - a); }

function evaluate5(cards) {
  const vals   = cards.map(rankVal);
  const suits  = cards.map(c => c.suit);
  const sorted = sortDesc(vals);

  const isFlush  = new Set(suits).size === 1;
  const uniqueVals = [...new Set(sorted)];

  let isStraight = false, straightHigh = 0;
  if (uniqueVals.length >= 5) {
    const t = sorted.slice(0, 5);
    if (t[0] - t[4] === 4) { isStraight = true; straightHigh = t[0]; }
    if (!isStraight && sorted.includes(14)) {
      const low = sortDesc(sorted.map(v => v === 14 ? 1 : v)).slice(0, 5);
      if (low[0] - low[4] === 4) { isStraight = true; straightHigh = 5; }
    }
  }

  const freq = {};
  for (const v of sorted) freq[v] = (freq[v] || 0) + 1;
  const counts = Object.entries(freq)
    .map(([v, c]) => ({ v: Number(v), c }))
    .sort((a, b) => b.c - a.c || b.v - a.v);
  const [f1, f2] = counts;

  if (isFlush && isStraight) return straightHigh === 14
    ? { rank: 10, name: 'Royal Flush',    kickers: [14] }
    : { rank: 9,  name: 'Straight Flush', kickers: [straightHigh] };
  if (f1.c === 4) return { rank: 8, name: 'Four of a Kind',  kickers: [f1.v, f2.v] };
  if (f1.c === 3 && f2?.c >= 2) return { rank: 7, name: 'Full House',  kickers: [f1.v, f2.v] };
  if (isFlush)    return { rank: 6, name: 'Flush',           kickers: sortDesc(vals).slice(0, 5) };
  if (isStraight) return { rank: 5, name: 'Straight',        kickers: [straightHigh] };
  if (f1.c === 3) return { rank: 4, name: 'Three of a Kind', kickers: [f1.v, ...counts.slice(1).map(e => e.v)] };
  if (f1.c === 2 && f2?.c === 2) return { rank: 3, name: 'Two Pair',  kickers: [f1.v, f2.v, ...(counts[2] ? [counts[2].v] : [])] };
  if (f1.c === 2) return { rank: 2, name: 'Pair',            kickers: [f1.v, ...counts.slice(1).map(e => e.v)] };
  return { rank: 1, name: 'High Card', kickers: sortDesc(vals).slice(0, 5) };
}

function compareHands(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.max(a.kickers.length, b.kickers.length); i++) {
    const d = (a.kickers[i] || 0) - (b.kickers[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function bestHand(hole, community) {
  const all   = [...hole, ...community];
  const picks = all.length >= 5 ? combs(all, 5) : [all];
  let best = null, bestCards = null;
  for (const five of picks) {
    const result = evaluate5(five);
    if (!best || compareHands(result, best) > 0) { best = result; bestCards = five; }
  }
  return { ...best, cards: bestCards };
}

// ─── Bot AI ──────────────────────────────────────────────────────────────────

const BOT_ROSTER = [
  { name: 'Apollo', avatar: '🦅' },
  { name: 'Blaze',  avatar: '🐉' },
  { name: 'Nova',   avatar: '⚡' },
  { name: 'Storm',  avatar: '🐺' },
  { name: 'Raven',  avatar: '🎯' },
];

function decideBotAction(player, toCall, room) {
  const rand = Math.random();
  if (toCall <= 0) {
    if (rand < 0.65) return { action: 'check' };
    return { action: 'raise', amount: room.currentBet + room.bb * (1 + Math.floor(Math.random() * 2)) };
  }
  const pressure = toCall / Math.max(player.chips, 1);
  if (pressure > 0.4) {
    if (rand < 0.42) return { action: 'fold' };
    if (rand < 0.82) return { action: 'call' };
    return { action: 'raise', amount: room.currentBet + room.bb * 2 };
  }
  if (rand < 0.15) return { action: 'fold' };
  if (rand < 0.74) return { action: 'call' };
  return { action: 'raise', amount: room.currentBet + room.bb * 2 };
}

function scheduleBotActionsIfNeeded(room) {
  if (!room || room.status !== 'playing') return;
  const idx = room.actionQueue[0];
  if (idx === undefined) return;
  const player = room.players[idx];
  if (!player || !player.isBot) return;

  setTimeout(() => {
    if (!rooms.has(room.id)) return;
    if (room.actionQueue[0] !== idx) return;
    if (room.status !== 'playing') return;
    const toCall = room.currentBet - player.roundBet;
    const { action, amount } = decideBotAction(player, toCall, room);
    processAction(room, idx, action, amount || 0);
    broadcastGameState(room);
    emitPrivateCards(room);
    scheduleBotActionsIfNeeded(room);
    scheduleTurnTimeout(room); // arm timer for next human turn if any
  }, 900 + Math.random() * 600);
}

// ─── Turn Timer ──────────────────────────────────────────────────────────────

function clearTurnTimeout(room) {
  if (room.turnTimeout) { clearTimeout(room.turnTimeout); room.turnTimeout = null; }
  room.turnStartedAt = null;
}

function scheduleTurnTimeout(room) {
  clearTurnTimeout(room);
  if (room.status !== 'playing') return;
  const idx = room.actionQueue[0];
  if (idx === undefined) return;
  if (room.players[idx]?.isBot) return; // bots self-manage

  room.turnStartedAt = Date.now();
  room.turnTimeout   = setTimeout(() => {
    if (!rooms.has(room.id)) return;
    if (room.actionQueue[0] !== idx) return;
    if (room.status !== 'playing') return;
    processAction(room, idx, 'fold', 0);
    broadcastGameState(room);
    emitPrivateCards(room);
    scheduleBotActionsIfNeeded(room);
    scheduleTurnTimeout(room);
  }, TURN_MS);
}

// ─── Blind Escalation ─────────────────────────────────────────────────────────

function scheduleBlindIncrease(room) {
  if (room.blindTimer) { clearTimeout(room.blindTimer); room.blindTimer = null; }
  if (!room.blindsEnabled || room.blindIntervalMs <= 0) return;
  const nextLevel = room.blindLevel + 1;
  if (nextLevel >= BLIND_SCHEDULE.length) return;

  room.blindTimer = setTimeout(() => {
    if (!rooms.has(room.id)) return;
    room.blindLevel = nextLevel;
    const lvl = BLIND_SCHEDULE[nextLevel];
    room.sb = lvl.sb;
    room.bb = lvl.bb;
    room.blindLevelStartAt = Date.now();
    roomLog(room, `★ BLINDS UP · Level ${nextLevel + 1}: ${room.sb}/${room.bb}`);
    io.to(room.id).emit('blinds_up', { level: nextLevel, sb: room.sb, bb: room.bb });
    broadcastGameState(room);
    scheduleBlindIncrease(room);
  }, room.blindIntervalMs);
}

// ─── Room Helpers ─────────────────────────────────────────────────────────────

function roomLog(room, msg) {
  room.log.push(msg);
  if (room.log.length > 30) room.log.shift();
}

function buildActionQueue(room, startIdx) {
  const n = room.players.length, queue = [];
  for (let offset = 0; offset < n; offset++) {
    const idx = (startIdx + offset) % n;
    const p   = room.players[idx];
    if (!p.folded && !p.allIn && !p.sittingOut && p.connected) queue.push(idx);
  }
  return queue;
}

// ─── Start Hand ───────────────────────────────────────────────────────────────

function startHand(room) {
  const players = room.players;
  room.deck      = makeDeck();
  room.community = [];
  room.pot       = 0;
  room.currentBet = room.bb;
  room.street    = 'preflop';
  room.handNum  += 1;

  for (const p of players) {
    p.cards    = [];
    p.roundBet = 0;
    p.folded   = false;
    p.allIn    = false;
    p.lastAction = null;
    if (p.chips === 0)  p.sittingOut = true;
    else                p.sittingOut = p.sitOutRequest;
  }

  for (let i = 0; i < 2; i++) for (const p of players) {
    if (!p.sittingOut) p.cards.push(room.deck.pop());
  }

  const sbIdx = nextActiveIdx(room, room.dealerIdx, 1);
  const bbIdx = nextActiveIdx(room, sbIdx, 1);
  postBlind(room, sbIdx, room.sb, 'small blind');
  postBlind(room, bbIdx, room.bb, 'big blind');
  const utgIdx = nextActiveIdx(room, bbIdx, 1);
  room.actionQueue = buildActionQueue(room, utgIdx);

  roomLog(room, `--- Hand #${room.handNum} · ${room.sb}/${room.bb} ---`);
  roomLog(room, `Dealer: ${players[room.dealerIdx].name}`);
  roomLog(room, `${players[sbIdx].name} posts SB ${room.sb}`);
  roomLog(room, `${players[bbIdx].name} posts BB ${room.bb}`);
}

function nextActiveIdx(room, fromIdx, steps) {
  const n = room.players.length;
  let idx = fromIdx;
  for (let s = 0; s < steps; s++) {
    for (let offset = 1; offset <= n; offset++) {
      const c = (idx + offset) % n;
      if (!room.players[c].sittingOut && !room.players[c].folded) { idx = c; break; }
    }
  }
  return idx;
}

function postBlind(room, playerIdx, amount, label) {
  const p = room.players[playerIdx];
  const bet = Math.min(amount, p.chips);
  p.chips -= bet; p.roundBet += bet; room.pot += bet;
  if (p.chips === 0) p.allIn = true;
}

// ─── Process Action ───────────────────────────────────────────────────────────

function processAction(room, playerIdx, action, amount) {
  clearTurnTimeout(room); // always cancel pending auto-fold first
  const p = room.players[playerIdx];
  const name = p.name;
  const toCall = room.currentBet - p.roundBet;

  switch (action) {
    case 'fold': {
      p.folded = true;
      p.lastAction = 'FOLD';
      room.actionQueue = room.actionQueue.filter(i => i !== playerIdx);
      roomLog(room, `${name} folds`);
      break;
    }
    case 'check': {
      if (p.roundBet !== room.currentBet) { roomLog(room, `${name} cannot check`); return false; }
      p.lastAction = 'CHECK';
      room.actionQueue.shift();
      roomLog(room, `${name} checks`);
      break;
    }
    case 'call': {
      const callAmt = Math.min(toCall, p.chips);
      p.chips -= callAmt; p.roundBet += callAmt; room.pot += callAmt;
      if (p.chips === 0) p.allIn = true;
      p.lastAction = 'CALL';
      room.actionQueue.shift();
      roomLog(room, `${name} calls ${callAmt}`);
      break;
    }
    case 'raise': {
      const minRaise = room.currentBet + room.bb;
      const raiseTo  = Math.max(amount || 0, minRaise);
      const addAmt   = Math.min(raiseTo - p.roundBet, p.chips);
      p.chips -= addAmt; p.roundBet += addAmt; room.pot += addAmt;
      if (p.chips === 0) p.allIn = true;
      room.currentBet = p.roundBet;
      p.lastAction = 'RAISE';
      roomLog(room, `${name} raises to ${p.roundBet}`);
      const nextIdx = (playerIdx + 1) % room.players.length;
      room.actionQueue = buildActionQueue(room, nextIdx).filter(i => i !== playerIdx);
      break;
    }
    default: return false;
  }

  const remaining = room.players.filter(p => !p.folded && !p.sittingOut && p.connected);
  if (remaining.length === 1) { instantWin(room, remaining[0]); return true; }
  if (room.actionQueue.length === 0) advanceStreet(room);
  return true;
}

// ─── Instant Win ──────────────────────────────────────────────────────────────

function instantWin(room, winner) {
  winner.chips += room.pot;
  roomLog(room, `${winner.name} wins ${room.pot} (all others folded)`);
  const winnerIdx = room.players.indexOf(winner);
  room.handHistory.unshift({
    handNum:  room.handNum,
    winners:  [winner.name],
    handName: 'All others folded',
    pot:      room.pot,
  });
  if (room.handHistory.length > 10) room.handHistory.pop();
  io.to(room.id).emit('showdown_result', {
    winners: [{ name: winner.name, handName: 'Everyone folded', cards: winner.cards }],
    pot: room.pot,
  });
  room.pot = 0;
  scheduleNextHand(room, winnerIdx);
}

// ─── Advance Street ───────────────────────────────────────────────────────────

function advanceStreet(room) {
  for (const p of room.players) { p.roundBet = 0; }
  room.currentBet = 0;

  switch (room.street) {
    case 'preflop':
      room.deck.pop();
      room.community.push(room.deck.pop(), room.deck.pop(), room.deck.pop());
      room.street = 'flop';
      roomLog(room, `Flop: ${room.community.map(c => c.rank + c.suit).join(' ')}`);
      break;
    case 'flop':
      room.deck.pop(); room.community.push(room.deck.pop());
      room.street = 'turn';
      roomLog(room, `Turn: ${room.community[3].rank + room.community[3].suit}`);
      break;
    case 'turn':
      room.deck.pop(); room.community.push(room.deck.pop());
      room.street = 'river';
      roomLog(room, `River: ${room.community[4].rank + room.community[4].suit}`);
      break;
    case 'river':
      showdown(room);
      return;
  }

  const firstIdx = nextActiveIdx(room, room.dealerIdx, 1);
  room.actionQueue = buildActionQueue(room, firstIdx);
  if (room.actionQueue.length === 0) advanceStreet(room);
}

// ─── Showdown ─────────────────────────────────────────────────────────────────

function showdown(room) {
  const contenders = room.players.filter(p => !p.folded && !p.sittingOut && p.connected);
  roomLog(room, '--- Showdown ---');

  const results = contenders.map(p => ({
    player: p, idx: room.players.indexOf(p), hand: bestHand(p.cards, room.community),
  }));
  results.sort((a, b) => compareHands(b.hand, a.hand));

  const best    = results[0].hand;
  const winners = results.filter(r => compareHands(r.hand, best) === 0);
  const share   = Math.floor(room.pot / winners.length);
  const rem     = room.pot - share * winners.length;

  winners.sort((a, b) => a.idx - b.idx);
  for (let i = 0; i < winners.length; i++) winners[i].player.chips += share + (i === 0 ? rem : 0);

  const winnerList = winners.map(w => ({ name: w.player.name, handName: w.hand.name, cards: w.player.cards }));
  for (const w of winners) roomLog(room, `${w.player.name} wins ${share + (w.idx === winners[0].idx ? rem : 0)} with ${w.hand.name}`);

  room.handHistory.unshift({
    handNum:  room.handNum,
    winners:  winners.map(w => w.player.name),
    handName: results[0].hand.name,
    pot:      room.pot,
  });
  if (room.handHistory.length > 10) room.handHistory.pop();
  io.to(room.id).emit('showdown_result', { winners: winnerList, pot: room.pot });
  room.pot = 0;
  scheduleNextHand(room, nextActiveIdx(room, room.dealerIdx, 1));
}

// ─── Schedule Next Hand ───────────────────────────────────────────────────────

function scheduleNextHand(room, nextDealerIdx) {
  clearTurnTimeout(room);
  room.status = 'waiting_next';
  broadcastGameState(room);

  setTimeout(() => {
    if (!rooms.has(room.id)) return;

    // Remove disconnected players and busted bots; keep busted humans (rebuy option)
    room.players = room.players.filter(p => {
      if (!p.connected) return false;
      if (p.isBot && p.chips === 0) return false;
      return true;
    });

    const active = room.players.filter(p => p.connected && p.chips > 0);
    const willPlay = active.filter(p => !p.sitOutRequest);
    if (active.length < 2 || willPlay.length < 2) {
      // Award remaining chips back to bank
      for (const p of room.players) {
        if (!p.isBot && p.chips > 0) { adjustBank(p.name, p.chips); p.chips = 0; }
      }
      if (room.blindTimer) { clearTimeout(room.blindTimer); room.blindTimer = null; }
      room.status = 'waiting';
      if (active.length >= 2 && willPlay.length < 2) {
        // Everyone sat out — bring them back automatically
        for (const p of room.players) p.sitOutRequest = false;
        roomLog(room, 'All players sat out. Sit-out requests cleared.');
      } else {
        roomLog(room, 'Not enough players. Waiting...');
      }
      broadcastGameState(room);
      return;
    }

    // Notify busted humans so they can see rebuy prompt
    for (const p of room.players) {
      if (p.connected && !p.isBot && p.chips === 0) {
        io.to(p.socketId).emit('bust_out', { balance: getBalance(p.name) });
      }
    }

    room.dealerIdx = nextDealerIdx % room.players.length;
    room.status    = 'playing';
    startHand(room);
    broadcastGameState(room);
    emitPrivateCards(room);
    scheduleBotActionsIfNeeded(room);
    scheduleTurnTimeout(room);
  }, 5000);
}

// ─── Broadcasting ─────────────────────────────────────────────────────────────

function publicGameState(room) {
  const currentPlayerIdx = room.actionQueue[0] ?? null;
  return {
    street:          room.street,
    pot:             room.pot,
    currentBet:      room.currentBet,
    community:       room.community,
    dealerIdx:       room.dealerIdx,
    currentPlayerIdx,
    handNum:         room.handNum,
    status:          room.status,
    sb:              room.sb,
    bb:              room.bb,
    blindLevel:      room.blindLevel,
    blindsEnabled:   room.blindsEnabled,
    blindNextMs:     (room.blindsEnabled && room.blindLevelStartAt)
      ? Math.max(0, room.blindLevelStartAt + room.blindIntervalMs - Date.now())
      : null,
    blindMaxLevel:   BLIND_SCHEDULE.length - 1,
    turnRemainingMs: room.turnStartedAt
      ? Math.max(0, room.turnStartedAt + TURN_MS - Date.now())
      : null,
    players: room.players.map((p, i) => ({
      name:          p.name,
      avatar:        p.avatar,
      profilePic:    p.profilePic || null,
      chips:         p.chips,
      roundBet:      p.roundBet,
      folded:        p.folded,
      allIn:         p.allIn,
      sittingOut:    p.sittingOut,
      sitOutRequest: p.sitOutRequest,
      connected:     p.connected,
      isBot:         p.isBot || false,
      isDealer:      i === room.dealerIdx,
      isActive:      currentPlayerIdx === i,
      cardCount:     p.cards.length,
      chipsBought:   p.chipsBought || 0,
      lastAction:    p.lastAction || null,
    })),
    log:         room.log.slice(-8),
    handHistory: room.handHistory,
  };
}

function broadcastGameState(room) { io.to(room.id).emit('game_state', publicGameState(room)); }

function emitPrivateCards(room) {
  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    if (!p.isBot && p.connected && p.socketId) {
      io.to(p.socketId).emit('your_cards', { cards: p.cards, myIdx: i });
    }
  }
}

function broadcastRoomUpdate(room) {
  io.to(room.id).emit('room_update', {
    players:  room.players.map(p => ({ name: p.name, avatar: p.avatar, profilePic: p.profilePic || null })),
    hostName: room.players.find(p => p.socketId === room.hostSocketId)?.name || '',
  });
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validatePic(pic) {
  if (typeof pic !== 'string') return null;
  if (!pic.startsWith('data:image/')) return null;
  if (pic.length > 150000) return null;
  return pic;
}

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// ─── Socket Events ────────────────────────────────────────────────────────────

io.on('connection', socket => {
  console.log(`Socket connected: ${socket.id}`);

  // ── Bank queries ──────────────────────────────────────────────────────────
  socket.on('check_balance', ({ name } = {}) => {
    if (!name || typeof name !== 'string') return;
    socket.emit('balance_data', { balance: getBalance(name.trim()) });
  });

  socket.on('get_leaderboard', () => {
    socket.emit('leaderboard_data', { entries: getLeaderboard() });
  });

  // ── create_room ──────────────────────────────────────────────────────────
  socket.on('create_room', ({ name, avatar, profilePic } = {}) => {
    let roomId;
    do { roomId = generateRoomId(); } while (rooms.has(roomId));

    const cleanName = (name || 'Player 1').trim();
    const buyIn  = Math.min(STARTING_CHIPS, getBalance(cleanName));
    if (buyIn < BIG_BLIND) { socket.emit('error', { message: 'Insufficient bank balance.' }); return; }
    const room   = makeRoom(roomId, socket.id);
    const player = makePlayer(socket.id, cleanName, avatar, buyIn);
    player.profilePic = validatePic(profilePic);
    adjustBank(cleanName, -buyIn);
    room.players.push(player);
    rooms.set(roomId, room);
    socket.join(roomId);
    socket.emit('room_joined', { roomId, playerIdx: 0, balance: getBalance(cleanName) });
    broadcastRoomUpdate(room);
  });

  // ── join_room ─────────────────────────────────────────────────────────────
  socket.on('join_room', ({ roomId, name, avatar, profilePic } = {}) => {
    const room = rooms.get(roomId);
    if (!room)                     { socket.emit('error', { message: 'Room not found' }); return; }
    if (room.status === 'playing') { socket.emit('error', { message: 'Game already in progress' }); return; }

    const cleanName  = (name || `Player ${room.players.length + 1}`).trim();
    const buyIn  = Math.min(STARTING_CHIPS, getBalance(cleanName));
    if (buyIn < BIG_BLIND) { socket.emit('error', { message: 'Insufficient bank balance.' }); return; }
    const playerIdx = room.players.length;
    const player    = makePlayer(socket.id, cleanName, avatar, buyIn);
    player.profilePic = validatePic(profilePic);
    adjustBank(cleanName, -buyIn);
    room.players.push(player);
    socket.join(roomId);
    socket.emit('room_joined', { roomId, playerIdx, balance: getBalance(cleanName) });
    broadcastRoomUpdate(room);
  });

  // ── start_game ────────────────────────────────────────────────────────────
  socket.on('start_game', ({ roomId, blindInterval } = {}) => {
    const room = rooms.get(roomId);
    if (!room)                               { socket.emit('error', { message: 'Room not found' }); return; }
    if (room.hostSocketId !== socket.id)     { socket.emit('error', { message: 'Only host can start' }); return; }
    if (room.players.length < 2)             { socket.emit('error', { message: 'Need 2+ players' }); return; }
    if (room.status === 'playing')           { socket.emit('error', { message: 'Game already started' }); return; }

    room.status = 'playing';

    if (blindInterval && blindInterval > 0) {
      room.blindsEnabled    = true;
      room.blindIntervalMs  = Math.max(60000, Number(blindInterval)); // min 1 minute
      room.blindLevelStartAt = Date.now();
      scheduleBlindIncrease(room);
    }

    startHand(room);
    broadcastGameState(room);
    emitPrivateCards(room);
    scheduleBotActionsIfNeeded(room);
    scheduleTurnTimeout(room);
  });

  // ── create_demo ───────────────────────────────────────────────────────────
  socket.on('create_demo', ({ name, avatar, profilePic } = {}) => {
    let roomId;
    do { roomId = generateRoomId(); } while (rooms.has(roomId));

    const cleanName = (name || 'You').trim();
    const buyIn  = Math.min(STARTING_CHIPS, getBalance(cleanName));
    if (buyIn < BIG_BLIND) { socket.emit('error', { message: 'Insufficient bank balance.' }); return; }
    const room  = makeRoom(roomId, socket.id);
    const human = makePlayer(socket.id, cleanName, avatar, buyIn);
    human.profilePic = validatePic(profilePic);
    adjustBank(cleanName, -buyIn);
    room.players.push(human);

    for (let i = 0; i < 3; i++) {
      const b = makePlayer(`bot_${i}_${roomId}`, BOT_ROSTER[i].name, BOT_ROSTER[i].avatar, STARTING_CHIPS);
      b.isBot = true;
      room.players.push(b);
    }

    rooms.set(roomId, room);
    socket.join(roomId);
    socket.emit('room_joined', { roomId, playerIdx: 0, balance: getBalance(cleanName) });

    room.status = 'playing';
    startHand(room);
    broadcastGameState(room);
    emitPrivateCards(room);
    scheduleBotActionsIfNeeded(room);
    scheduleTurnTimeout(room);
  });

  // ── player_action ─────────────────────────────────────────────────────────
  socket.on('player_action', ({ roomId, action, amount } = {}) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;
    const playerIdx = room.players.findIndex(p => p.socketId === socket.id);
    if (playerIdx === -1) return;
    if (room.actionQueue[0] !== playerIdx) { socket.emit('error', { message: "Not your turn" }); return; }

    const ok = processAction(room, playerIdx, action, amount);
    if (ok) {
      broadcastGameState(room);
      emitPrivateCards(room);
      scheduleBotActionsIfNeeded(room);
      scheduleTurnTimeout(room);
    }
  });

  // ── rebuy ─────────────────────────────────────────────────────────────────
  socket.on('rebuy', ({ roomId } = {}) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const playerIdx = room.players.findIndex(p => p.socketId === socket.id);
    if (playerIdx === -1) return;
    const player = room.players[playerIdx];
    if (!player.sittingOut || player.chips > 0) return;

    const balance = getBalance(player.name);
    const buyIn   = Math.min(STARTING_CHIPS, balance);
    if (buyIn < BIG_BLIND) { socket.emit('error', { message: 'Not enough chips in bank to rebuy' }); return; }

    const newBalance = adjustBank(player.name, -buyIn);
    player.chips     = buyIn;
    player.chipsBought = (player.chipsBought || 0) + buyIn;
    player.sittingOut = false;
    socket.emit('balance_update', { balance: newBalance });
    broadcastGameState(room);
  });

  // ── drop_sticker ──────────────────────────────────────────────────────────
  socket.on('drop_sticker', ({ roomId, emoji } = {}) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const sender = room.players.find(p => p.socketId === socket.id);
    if (!sender) return;
    io.to(roomId).emit('sticker_dropped', { emoji: String(emoji || '').slice(0, 8), fromName: sender.name });
  });

  // ── throw_item ────────────────────────────────────────────────────────────
  socket.on('throw_item', ({ roomId, targetIdx, item } = {}) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const fromIdx = room.players.findIndex(p => p.socketId === socket.id);
    if (fromIdx === -1) return;
    if (typeof targetIdx !== 'number' || targetIdx < 0 || targetIdx >= room.players.length) return;
    if (targetIdx === fromIdx) return;
    const safe = String(item || '').slice(0, 8);
    io.to(roomId).emit('item_thrown', { fromIdx, targetIdx, item: safe, fromName: room.players[fromIdx].name });
  });

  // ── chat_message ──────────────────────────────────────────────────────────
  socket.on('chat_message', ({ roomId, text } = {}) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const sender = room.players.find(p => p.socketId === socket.id);
    if (!sender) return;
    const safe = String(text || '').slice(0, 120).trim();
    if (!safe) return;
    io.to(roomId).emit('chat_message', { name: sender.name, text: safe });
  });

  // ── sit_out ────────────────────────────────────────────────────────────────
  socket.on('sit_out', ({ roomId } = {}) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player || player.chips === 0) return;
    player.sitOutRequest = !player.sitOutRequest;
    roomLog(room, player.sitOutRequest
      ? `${player.name} sitting out next hand`
      : `${player.name} is back in`);
    broadcastGameState(room);
  });

  // ── disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    for (const [roomId, room] of rooms.entries()) {
      const playerIdx = room.players.findIndex(p => p.socketId === socket.id);
      if (playerIdx === -1) continue;

      const player = room.players[playerIdx];

      // Cash out remaining chips back to bank before marking disconnected
      if (!player.isBot && player.chips > 0) {
        adjustBank(player.name, player.chips);
        player.chips = 0;
      }

      player.connected = false;
      roomLog(room, `${player.name} disconnected`);

      if (room.status === 'playing') {
        if (room.actionQueue[0] === playerIdx) {
          processAction(room, playerIdx, 'fold', 0);
        } else {
          player.folded = true;
          room.actionQueue = room.actionQueue.filter(i => i !== playerIdx);
          const remaining = room.players.filter(p => !p.folded && !p.sittingOut && p.connected);
          if (remaining.length === 1) instantWin(room, remaining[0]);
          else if (remaining.length === 0) room.status = 'waiting';
        }
        broadcastGameState(room);
        scheduleBotActionsIfNeeded(room);
        scheduleTurnTimeout(room);
      } else {
        room.players.splice(playerIdx, 1);
        if (room.players.length === 0) {
          rooms.delete(roomId);
        } else {
          if (room.hostSocketId === socket.id) room.hostSocketId = room.players[0].socketId;
          broadcastRoomUpdate(room);
        }
      }
      break;
    }
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Ping Poker server running on port ${PORT}`));
