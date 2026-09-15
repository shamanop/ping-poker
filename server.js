'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

// ─── Constants ───────────────────────────────────────────────────────────────

const STARTING_CHIPS = 1500;
const SMALL_BLIND    = 10;
const BIG_BLIND      = 20;
const SUITS          = ['♠', '♥', '♦', '♣'];
const RANKS          = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

// ─── App Setup ───────────────────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// ─── Room State ──────────────────────────────────────────────────────────────

const rooms = new Map(); // roomId → room

function makeRoom(id, hostSocketId) {
  return {
    id,
    hostSocketId,
    status: 'waiting',
    players: [],
    deck: [],
    community: [],
    pot: 0,
    currentBet: 0,
    dealerIdx: 0,
    street: null,
    actionQueue: [],
    handNum: 0,
    log: [],
  };
}

function makePlayer(socketId, name, avatar) {
  return {
    socketId,
    name,
    avatar: avatar || '🃏',
    chips: STARTING_CHIPS,
    cards: [],
    roundBet: 0,
    folded: false,
    allIn: false,
    sittingOut: false,
    connected: true,
  };
}

// ─── Deck & Shuffle ──────────────────────────────────────────────────────────

function makeDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// ─── Hand Evaluator ──────────────────────────────────────────────────────────

// Generate all k-combinations of arr
function combs(arr, k) {
  if (k === 0) return [[]];
  if (arr.length === 0) return [];
  const [first, ...rest] = arr;
  const withFirst    = combs(rest, k - 1).map(c => [first, ...c]);
  const withoutFirst = combs(rest, k);
  return [...withFirst, ...withoutFirst];
}

const RANK_VAL = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));

function rankVal(card) {
  return RANK_VAL[card.rank];
}

function sortDesc(vals) {
  return [...vals].sort((a, b) => b - a);
}

// Returns {rank: 1-10, name, kickers: number[]}
// rank 10=Royal Flush, 9=Straight Flush, 8=Quads, 7=Full House,
//      6=Flush, 5=Straight, 4=Trips, 3=Two Pair, 2=Pair, 1=High Card
function evaluate5(cards) {
  const vals   = cards.map(rankVal);
  const suits  = cards.map(c => c.suit);
  const sorted = sortDesc(vals);

  const isFlush    = new Set(suits).size === 1;
  const uniqueVals = [...new Set(sorted)];

  // Straight detection (including A-low: A-2-3-4-5)
  let isStraight   = false;
  let straightHigh = 0;
  if (uniqueVals.length >= 5) {
    const top5 = sorted.slice(0, 5);
    if (top5[0] - top5[4] === 4) {
      isStraight   = true;
      straightHigh = top5[0];
    }
    // A-low straight
    if (!isStraight && sorted.includes(14)) {
      const aceLow = sortDesc(sorted.map(v => v === 14 ? 1 : v));
      const top5l  = aceLow.slice(0, 5);
      if (top5l[0] - top5l[4] === 4) {
        isStraight   = true;
        straightHigh = 5;
      }
    }
  }

  // Count frequencies
  const freq = {};
  for (const v of sorted) freq[v] = (freq[v] || 0) + 1;
  const counts = Object.entries(freq)
    .map(([v, c]) => ({ v: Number(v), c }))
    .sort((a, b) => b.c - a.c || b.v - a.v);

  const [f1, f2] = counts;

  if (isFlush && isStraight) {
    if (straightHigh === 14) {
      return { rank: 10, name: 'Royal Flush', kickers: [14] };
    }
    return { rank: 9, name: 'Straight Flush', kickers: [straightHigh] };
  }
  if (f1.c === 4) {
    return { rank: 8, name: 'Four of a Kind', kickers: [f1.v, f2.v] };
  }
  if (f1.c === 3 && f2 && f2.c >= 2) {
    return { rank: 7, name: 'Full House', kickers: [f1.v, f2.v] };
  }
  if (isFlush) {
    return { rank: 6, name: 'Flush', kickers: sortDesc(vals).slice(0, 5) };
  }
  if (isStraight) {
    return { rank: 5, name: 'Straight', kickers: [straightHigh] };
  }
  if (f1.c === 3) {
    const kick = counts.slice(1).map(e => e.v);
    return { rank: 4, name: 'Three of a Kind', kickers: [f1.v, ...kick] };
  }
  if (f1.c === 2 && f2 && f2.c === 2) {
    const kick = counts[2] ? [counts[2].v] : [];
    return { rank: 3, name: 'Two Pair', kickers: [f1.v, f2.v, ...kick] };
  }
  if (f1.c === 2) {
    const kick = counts.slice(1).map(e => e.v);
    return { rank: 2, name: 'Pair', kickers: [f1.v, ...kick] };
  }
  return { rank: 1, name: 'High Card', kickers: sortDesc(vals).slice(0, 5) };
}

// Compare two hand results; returns negative if a < b, 0 if equal, positive if a > b
function compareHands(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.max(a.kickers.length, b.kickers.length); i++) {
    const av = a.kickers[i] || 0;
    const bv = b.kickers[i] || 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

// Best 5-card hand from hole + community (up to 7 cards)
function bestHand(hole, community) {
  const all   = [...hole, ...community];
  const picks = all.length >= 5 ? combs(all, 5) : [all];
  let best    = null;
  let bestCards = null;
  for (const five of picks) {
    const result = evaluate5(five);
    if (!best || compareHands(result, best) > 0) {
      best      = result;
      bestCards = five;
    }
  }
  return { ...best, cards: bestCards };
}

// ─── Room Helpers ─────────────────────────────────────────────────────────────

function roomLog(room, msg) {
  room.log.push(msg);
  if (room.log.length > 30) room.log.shift();
}

function activePlayers(room) {
  return room.players.filter(p => !p.folded && !p.sittingOut && p.connected);
}

function eligibleForAction(room) {
  return room.players.filter(p => !p.folded && !p.allIn && !p.sittingOut && p.connected);
}

// ─── Build Action Queue ───────────────────────────────────────────────────────

// Build clockwise queue starting from startIdx (inclusive), skipping folded/allIn
function buildActionQueue(room, startIdx) {
  const n     = room.players.length;
  const queue = [];
  for (let offset = 0; offset < n; offset++) {
    const idx = (startIdx + offset) % n;
    const p   = room.players[idx];
    if (!p.folded && !p.allIn && !p.sittingOut && p.connected) {
      queue.push(idx);
    }
  }
  return queue;
}

// ─── Start Hand ───────────────────────────────────────────────────────────────

function startHand(room) {
  const players = room.players;
  const n       = players.length;

  // Reset per-hand state
  room.deck      = makeDeck();
  room.community = [];
  room.pot       = 0;
  room.currentBet = BIG_BLIND;
  room.street    = 'preflop';
  room.handNum   += 1;

  for (const p of players) {
    p.cards    = [];
    p.roundBet = 0;
    p.folded   = false;
    p.allIn    = false;
    if (p.chips === 0) p.sittingOut = true;
  }

  // Deal 2 cards each
  for (let i = 0; i < 2; i++) {
    for (const p of players) {
      if (!p.sittingOut) {
        p.cards.push(room.deck.pop());
      }
    }
  }

  // Post blinds — SB is dealer+1, BB is dealer+2
  const sbIdx = nextActiveIdx(room, room.dealerIdx, 1);
  const bbIdx = nextActiveIdx(room, sbIdx, 1);

  postBlind(room, sbIdx, SMALL_BLIND, 'small blind');
  postBlind(room, bbIdx, BIG_BLIND,   'big blind');

  // UTG = dealer+3 (one after BB)
  const utgIdx = nextActiveIdx(room, bbIdx, 1);

  // Preflop action queue starts at UTG, wraps around to BB last
  room.actionQueue = buildActionQueue(room, utgIdx);

  roomLog(room, `--- Hand #${room.handNum} ---`);
  roomLog(room, `Dealer: ${players[room.dealerIdx].name}`);
  roomLog(room, `${players[sbIdx].name} posts SB ${SMALL_BLIND}`);
  roomLog(room, `${players[bbIdx].name} posts BB ${BIG_BLIND}`);
}

function nextActiveIdx(room, fromIdx, steps) {
  const n = room.players.length;
  let idx = fromIdx;
  for (let s = 0; s < steps; s++) {
    let found = false;
    for (let offset = 1; offset <= n; offset++) {
      const candidate = (idx + offset) % n;
      if (!room.players[candidate].sittingOut && !room.players[candidate].folded) {
        idx   = candidate;
        found = true;
        break;
      }
    }
    if (!found) break;
  }
  return idx;
}

function postBlind(room, playerIdx, amount, label) {
  const p   = room.players[playerIdx];
  const bet = Math.min(amount, p.chips);
  p.chips    -= bet;
  p.roundBet += bet;
  room.pot   += bet;
  if (p.chips === 0) p.allIn = true;
}

// ─── Process Action ───────────────────────────────────────────────────────────

function processAction(room, playerIdx, action, amount) {
  const p       = room.players[playerIdx];
  const name    = p.name;
  const toCall  = room.currentBet - p.roundBet;

  switch (action) {
    case 'fold': {
      p.folded = true;
      room.actionQueue = room.actionQueue.filter(i => i !== playerIdx);
      roomLog(room, `${name} folds`);
      break;
    }
    case 'check': {
      if (p.roundBet !== room.currentBet) {
        roomLog(room, `${name} cannot check (must call ${toCall})`);
        return false;
      }
      room.actionQueue.shift();
      roomLog(room, `${name} checks`);
      break;
    }
    case 'call': {
      const callAmt = Math.min(toCall, p.chips);
      p.chips    -= callAmt;
      p.roundBet += callAmt;
      room.pot   += callAmt;
      if (p.chips === 0) p.allIn = true;
      room.actionQueue.shift();
      roomLog(room, `${name} calls ${callAmt}`);
      break;
    }
    case 'raise': {
      // amount = total bet size (not the increment)
      const minRaise = room.currentBet + BIG_BLIND;
      const raiseTo  = Math.max(amount || 0, minRaise);
      const addAmt   = Math.min(raiseTo - p.roundBet, p.chips);
      p.chips    -= addAmt;
      p.roundBet += addAmt;
      room.pot   += addAmt;
      if (p.chips === 0) p.allIn = true;
      room.currentBet = p.roundBet;
      roomLog(room, `${name} raises to ${p.roundBet}`);
      // Rebuild queue: everyone still active after the raiser, clockwise
      const nextIdx    = (playerIdx + 1) % room.players.length;
      room.actionQueue = buildActionQueue(room, nextIdx).filter(i => i !== playerIdx);
      break;
    }
    default:
      return false;
  }

  // Check if only 1 non-folded player remains
  const remaining = room.players.filter(p => !p.folded && !p.sittingOut && p.connected);
  if (remaining.length === 1) {
    instantWin(room, remaining[0]);
    return true;
  }

  // If queue empty, advance street
  if (room.actionQueue.length === 0) {
    advanceStreet(room);
  }

  return true;
}

// ─── Instant Win (everyone else folded) ──────────────────────────────────────

function instantWin(room, winner) {
  winner.chips += room.pot;
  roomLog(room, `${winner.name} wins ${room.pot} (all others folded)`);
  const winnerIdx = room.players.indexOf(winner);

  io.to(room.id).emit('showdown_result', {
    winners: [{ name: winner.name, handName: 'Everyone folded', cards: winner.cards }],
    pot: room.pot,
  });

  room.pot = 0;
  scheduleNextHand(room, winnerIdx);
}

// ─── Advance Street ───────────────────────────────────────────────────────────

function advanceStreet(room) {
  // Reset round bets for new street
  for (const p of room.players) {
    p.roundBet = 0;
  }
  room.currentBet = 0;

  switch (room.street) {
    case 'preflop': {
      // Deal flop (3 cards)
      room.deck.pop(); // burn
      room.community.push(room.deck.pop(), room.deck.pop(), room.deck.pop());
      room.street = 'flop';
      roomLog(room, `Flop: ${room.community.map(c => c.rank + c.suit).join(' ')}`);
      break;
    }
    case 'flop': {
      room.deck.pop(); // burn
      room.community.push(room.deck.pop());
      room.street = 'turn';
      roomLog(room, `Turn: ${room.community[3].rank + room.community[3].suit}`);
      break;
    }
    case 'turn': {
      room.deck.pop(); // burn
      room.community.push(room.deck.pop());
      room.street = 'river';
      roomLog(room, `River: ${room.community[4].rank + room.community[4].suit}`);
      break;
    }
    case 'river': {
      showdown(room);
      return;
    }
  }

  // Post-street: queue starts left of dealer
  const firstIdx   = nextActiveIdx(room, room.dealerIdx, 1);
  room.actionQueue = buildActionQueue(room, firstIdx);

  // If no one can act (all all-in), skip to next street
  if (room.actionQueue.length === 0) {
    advanceStreet(room);
  }
}

// ─── Showdown ─────────────────────────────────────────────────────────────────

function showdown(room) {
  const contenders = room.players.filter(
    p => !p.folded && !p.sittingOut && p.connected
  );

  roomLog(room, '--- Showdown ---');

  const results = contenders.map(p => ({
    player: p,
    idx: room.players.indexOf(p),
    hand: bestHand(p.cards, room.community),
  }));

  // Sort best → worst
  results.sort((a, b) => compareHands(b.hand, a.hand));

  const best    = results[0].hand;
  const winners = results.filter(r => compareHands(r.hand, best) === 0);

  // Split pot (integer division; remainder to lowest seat index)
  const share     = Math.floor(room.pot / winners.length);
  const remainder = room.pot - share * winners.length;

  // Sort winners by seat index for remainder assignment
  winners.sort((a, b) => a.idx - b.idx);

  for (let i = 0; i < winners.length; i++) {
    const extra = i === 0 ? remainder : 0;
    winners[i].player.chips += share + extra;
  }

  const winnerList = winners.map(w => ({
    name:     w.player.name,
    handName: w.hand.name,
    cards:    w.player.cards,
  }));

  for (const w of winners) {
    roomLog(room, `${w.player.name} wins ${share + (w.idx === winners[0].idx ? remainder : 0)} with ${w.hand.name}`);
  }

  io.to(room.id).emit('showdown_result', {
    winners: winnerList,
    pot: room.pot,
  });

  room.pot = 0;

  // Advance dealer for next hand
  const nextDealer = nextActiveIdx(room, room.dealerIdx, 1);
  scheduleNextHand(room, nextDealer);
}

// ─── Schedule Next Hand ───────────────────────────────────────────────────────

function scheduleNextHand(room, nextDealerIdx) {
  room.status = 'waiting_next';
  broadcastGameState(room);

  setTimeout(() => {
    if (!rooms.has(room.id)) return;

    // Remove busted players (0 chips)
    room.players = room.players.filter(p => p.chips > 0 || !p.connected);

    if (room.players.filter(p => p.connected && p.chips > 0).length < 2) {
      room.status = 'waiting';
      roomLog(room, 'Not enough players to continue. Waiting for players...');
      broadcastGameState(room);
      return;
    }

    // Recalculate dealer index after potential player removal
    room.dealerIdx = nextDealerIdx % room.players.length;
    room.status    = 'playing';
    startHand(room);
    broadcastGameState(room);
    emitPrivateCards(room);
  }, 5000);
}

// ─── Broadcasting ─────────────────────────────────────────────────────────────

function publicGameState(room) {
  const currentPlayerIdx = room.actionQueue.length > 0 ? room.actionQueue[0] : null;

  return {
    street:           room.street,
    pot:              room.pot,
    currentBet:       room.currentBet,
    community:        room.community,
    dealerIdx:        room.dealerIdx,
    currentPlayerIdx,
    handNum:          room.handNum,
    status:           room.status,
    players: room.players.map((p, i) => ({
      name:      p.name,
      avatar:    p.avatar,
      chips:     p.chips,
      roundBet:  p.roundBet,
      folded:    p.folded,
      allIn:     p.allIn,
      sittingOut: p.sittingOut,
      connected: p.connected,
      isDealer:  i === room.dealerIdx,
      isActive:  currentPlayerIdx === i,
      cardCount: p.cards.length,
    })),
    log: room.log.slice(-8),
  };
}

function broadcastGameState(room) {
  io.to(room.id).emit('game_state', publicGameState(room));
}

function emitPrivateCards(room) {
  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    if (p.connected && p.socketId) {
      io.to(p.socketId).emit('your_cards', { cards: p.cards, myIdx: i });
    }
  }
}

function broadcastRoomUpdate(room) {
  io.to(room.id).emit('room_update', {
    players:  room.players.map(p => ({ name: p.name, avatar: p.avatar })),
    hostName: room.players.find(p => p.socketId === room.hostSocketId)?.name || '',
  });
}

// ─── Room ID Generator ────────────────────────────────────────────────────────

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

// ─── Socket Events ────────────────────────────────────────────────────────────

io.on('connection', socket => {
  console.log(`Socket connected: ${socket.id}`);

  // ── create_room ──────────────────────────────────────────────────────────
  socket.on('create_room', ({ name, avatar } = {}) => {
    let roomId;
    do { roomId = generateRoomId(); } while (rooms.has(roomId));

    const room   = makeRoom(roomId, socket.id);
    const player = makePlayer(socket.id, name || 'Player 1', avatar);
    room.players.push(player);
    rooms.set(roomId, room);

    socket.join(roomId);
    socket.emit('room_joined', { roomId, playerIdx: 0 });
    broadcastRoomUpdate(room);
    console.log(`Room created: ${roomId} by ${socket.id}`);
  });

  // ── join_room ─────────────────────────────────────────────────────────────
  socket.on('join_room', ({ roomId, name, avatar } = {}) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('error', { message: 'Room not found' });
      return;
    }
    if (room.status === 'playing') {
      socket.emit('error', { message: 'Game already in progress' });
      return;
    }

    const playerIdx = room.players.length;
    const player    = makePlayer(socket.id, name || `Player ${playerIdx + 1}`, avatar);
    room.players.push(player);

    socket.join(roomId);
    socket.emit('room_joined', { roomId, playerIdx });
    broadcastRoomUpdate(room);
    console.log(`${name} joined room ${roomId}`);
  });

  // ── start_game ────────────────────────────────────────────────────────────
  socket.on('start_game', ({ roomId } = {}) => {
    const room = rooms.get(roomId);
    if (!room) { socket.emit('error', { message: 'Room not found' }); return; }
    if (room.hostSocketId !== socket.id) { socket.emit('error', { message: 'Only the host can start' }); return; }
    if (room.players.length < 2) { socket.emit('error', { message: 'Need at least 2 players' }); return; }
    if (room.status === 'playing') { socket.emit('error', { message: 'Game already started' }); return; }

    room.status = 'playing';
    startHand(room);
    broadcastGameState(room);
    emitPrivateCards(room);
    console.log(`Game started in room ${roomId}`);
  });

  // ── player_action ─────────────────────────────────────────────────────────
  socket.on('player_action', ({ roomId, action, amount } = {}) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'playing') return;

    // Find player index
    const playerIdx = room.players.findIndex(p => p.socketId === socket.id);
    if (playerIdx === -1) return;

    // Must be that player's turn
    if (room.actionQueue[0] !== playerIdx) {
      socket.emit('error', { message: "Not your turn" });
      return;
    }

    const ok = processAction(room, playerIdx, action, amount);
    if (ok) {
      broadcastGameState(room);
      emitPrivateCards(room);
    }
  });

  // ── disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);

    for (const [roomId, room] of rooms.entries()) {
      const playerIdx = room.players.findIndex(p => p.socketId === socket.id);
      if (playerIdx === -1) continue;

      const player = room.players[playerIdx];
      player.connected = false;
      roomLog(room, `${player.name} disconnected`);

      if (room.status === 'playing') {
        // Treat disconnect as fold if it's the player's turn
        if (room.actionQueue[0] === playerIdx) {
          processAction(room, playerIdx, 'fold', 0);
        } else {
          // Mark folded so they skip future action
          player.folded = true;
          room.actionQueue = room.actionQueue.filter(i => i !== playerIdx);

          const remaining = room.players.filter(p => !p.folded && !p.sittingOut && p.connected);
          if (remaining.length === 1) {
            instantWin(room, remaining[0]);
          } else if (remaining.length === 0) {
            room.status = 'waiting';
          }
        }
        broadcastGameState(room);
      } else {
        // In lobby: remove from room
        room.players.splice(playerIdx, 1);
        if (room.players.length === 0) {
          rooms.delete(roomId);
        } else {
          if (room.hostSocketId === socket.id && room.players.length > 0) {
            room.hostSocketId = room.players[0].socketId;
          }
          broadcastRoomUpdate(room);
        }
      }

      break; // socket can only be in one room
    }
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Ping Poker server running on port ${PORT}`);
});
