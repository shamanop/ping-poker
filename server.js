'use strict';

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const { createLedger } = require('./ledger');
const { createAccounts } = require('./accounts');
const { createTables } = require('./tables');

// ─── Constants ───────────────────────────────────────────────────────────────

const STARTING_CHIPS  = 1500;
const BANK_DEFAULT    = 10000;
const DATA_DIR        = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const BANK_FILE       = process.env.BANK_FILE || path.join(DATA_DIR, 'bank.json');
const AUTO_START_MS  = Number(process.env.AUTO_START_MS) || 2000;
const STACKS_FILE     = process.env.STACKS_FILE || path.join(path.dirname(BANK_FILE), 'stacks.json');
const LEDGER_FILE     = process.env.LEDGER_FILE || path.join(DATA_DIR, 'ledger.json');
const ACCOUNTS_FILE   = process.env.ACCOUNTS_FILE || path.join(path.dirname(BANK_FILE), 'accounts.json');
const TABLES_FILE     = process.env.TABLES_FILE || path.join(path.dirname(BANK_FILE), 'tables.json');
const WALLET_FILE     = process.env.WALLET_FILE || path.join(path.dirname(BANK_FILE), 'wallet.json');
const BIGWINS_FILE    = process.env.BIGWINS_FILE || path.join(path.dirname(BANK_FILE), 'bigwins.json');
const TURN_MS         = Number(process.env.TURN_MS) || 30000;
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

const ROOM_ID = 'POKERPING';
const ROOM_PASSWORD = 'ping';

// ─── Bank System ─────────────────────────────────────────────────────────────

let bank = {};
// One-shot fresh start: when FRESH_START_ID is new, move every data file into backup-<id>/ and begin empty (marker file stops repeats).
if (process.env.FRESH_START_ID && path.resolve(DATA_DIR) !== path.resolve(__dirname)) {
  try {
    const id = String(process.env.FRESH_START_ID).replace(/[^\w.-]/g, '');
    const marker = path.join(DATA_DIR, `.fresh-${id}`);
    if (id && !fs.existsSync(marker)) {
      const bak = path.join(DATA_DIR, `backup-${id}`);
      fs.mkdirSync(bak, { recursive: true });
      for (const f of fs.readdirSync(DATA_DIR)) {
        const src = path.join(DATA_DIR, f);
        if (f.startsWith('backup-') || f.startsWith('.fresh-') || f === 'lost+found' || !fs.statSync(src).isFile()) continue;
        fs.renameSync(src, path.join(bak, f));
      }
      fs.writeFileSync(path.join(DATA_DIR, 'bank.json'), '{}');
      fs.writeFileSync(marker, new Date().toISOString());
      console.log(`fresh start ${id}: old data moved to ${bak}`);
    }
  } catch (e) { console.error('fresh start failed:', e.message); }
}
// First boot on an empty data dir (Railway volume): copy the repo's seed files in. Never overwrites existing data.
if (path.resolve(DATA_DIR) !== path.resolve(__dirname)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
  if (!process.env.BANK_FILE) {
    try { if (!fs.existsSync(BANK_FILE) && fs.existsSync(path.join(__dirname, 'bank.json'))) fs.copyFileSync(path.join(__dirname, 'bank.json'), BANK_FILE); } catch {}
  }
}
try { bank = JSON.parse(fs.readFileSync(BANK_FILE, 'utf8')); } catch { bank = {}; }
try {
  const stacks = JSON.parse(fs.readFileSync(STACKS_FILE, 'utf8'));
  for (const [k, v] of Object.entries(stacks)) if (v > 0) bank[k] = (bank[k] || 0) + v;
  fs.writeFileSync(STACKS_FILE, '{}');
  fs.writeFileSync(BANK_FILE, JSON.stringify(bank));
} catch {}

let nameResolver = null; // set once accounts exist: maps a current display name to its account key
function bankKey(name) { const k = String(name).toLowerCase().trim(); return nameResolver ? nameResolver(k) : k; }

// Ledger lives in its own file (LEDGER_FILE); bank.json format is unchanged.
let bankPushTimer = null;
const ledger = createLedger({
  file: LEDGER_FILE,
  keyOf: k => (nameResolver ? nameResolver(k) : k),
  displayOf: k => (accounts && accounts.get(k) ? accounts.get(k).display : null),
  onWrite: () => {
    if (bankPushTimer) return;
    bankPushTimer = setTimeout(() => {
      bankPushTimer = null;
      for (const room of rooms.values()) {
        if (room.players.some(p => !p.isBot && p.connected)) io.to(room.id).emit('bank_summary', bankSummary(room.id));
      }
    }, 250);
  },
});
ledger.seedBank(bank);

// One-time carry-over of the pre-redesign chips history (see qa/chip-snapshot/MIGRATION.md).
// Runs only when LEGACY_IMPORT_FILE is set, or when BANK_FILE is not overridden (production); a player who already has any chips history is never touched.
try {
  const impFile = process.env.LEGACY_IMPORT_FILE || (process.env.BANK_FILE ? null : path.join(__dirname, 'legacy-import.json'));
  if (impFile && fs.existsSync(impFile)) {
    const hist = new Set(['buyin', 'rebuy', 'cashout', 'legacy-import']);
    const have = new Set(ledger.entries().filter(e => hist.has(e.type) && e.name).map(e => bankKey(e.name)));
    for (const r of JSON.parse(fs.readFileSync(impFile, 'utf8'))) {
      const k = bankKey(r.name);
      if (!k || have.has(k) || bank[k] === undefined) continue;
      ledger.log('legacy-import', r.name, r.net, bank[k], null, null, null, { key: k, hands: r.hands || 0, biggestWin: r.biggestWin || 0, note: 'Carried over from the original chips bank' });
    }
  }
} catch (e) { console.error('legacy import failed:', e.message); }

// One-time safety copies before the first run that creates accounts.json
if (!fs.existsSync(ACCOUNTS_FILE)) {
  const stamp = Date.now();
  for (const f of [BANK_FILE, LEDGER_FILE]) { try { if (fs.existsSync(f) && !fs.existsSync(`${f}.bak-${stamp}`)) fs.copyFileSync(f, `${f}.bak-${stamp}`); } catch {} }
}
const accounts = createAccounts({ file: ACCOUNTS_FILE, roomPassword: ROOM_PASSWORD });
nameResolver = accounts.keyForName;
accounts.migrateLegacy({ bank, ledgerEntries: ledger.entries() });

function getBalance(name) {
  const k = bankKey(name);
  if (bank[k] === undefined) {
    bank[k] = BANK_DEFAULT; saveBank();
    ledger.log('bank-start', name, BANK_DEFAULT, BANK_DEFAULT, null, null, null);
  }
  return bank[k];
}

// type/room/tableChips/extra are optional ledger metadata only; they do not affect the balance math.
function adjustBank(name, delta, type, room, tableChips, extra) {
  const k = bankKey(name);
  if (bank[k] === undefined) {
    bank[k] = BANK_DEFAULT;
    ledger.log('bank-start', name, BANK_DEFAULT, BANK_DEFAULT, null, null, null);
  }
  bank[k] = Math.max(0, bank[k] + delta);
  saveBank();
  pushMoney(k);
  if (type) ledger.log(type, name, Math.abs(delta), bank[k], tableChips, room ? room.handNum : null, room ? room.id : null, extra);
  return bank[k];
}

let gameHooks = null;
function atTableOf(k) {
  let n = 0;
  for (const r of rooms.values()) {
    if (r.unit !== 'chips') continue;
    for (const p of r.players) if (!p.isBot && bankKey(p.name) === k) n += p.chips + (r.status === 'playing' && r.pot > 0 ? (p.handBet || 0) : 0);
  }
  return n;
}
// One shape for everything a player's own money bar needs: chips bank + table stack, plus the Play$/Ledger$ wallet.
function moneyView(key) {
  const k = bankKey(key);
  const bankChips = bank[k] === undefined ? null : bank[k];
  const atTable = atTableOf(k);
  const w = gameHooks && gameHooks.wallet ? gameHooks.wallet.get(k) : null;
  return { bank: bankChips, atTable, chips: bankChips === null ? null : bankChips + atTable, wallet: w };
}
function pushMoney(key) {
  const k = bankKey(key);
  if (!k || !io || !io.sockets) return;
  let view = null;
  for (const s of io.sockets.sockets.values()) {
    if (s.data && s.data.acct === k) { view = view || moneyView(k); s.emit('money', view); }
  }
}

function bankSummary(roomId) {
  const live = [];
  const own = rooms.get(roomId);
  const nightId = (own && own.nightId) || null;
  for (const room of rooms.values()) {
    if (nightId ? room !== own : room.nightId) continue;
    for (const p of room.players) {
      if (p.isBot && room.id !== roomId) continue;
      let status;
      if (!p.connected && !p.isBot) status = 'away';
      else if (p.sittingOut || p.sitOutRequest || p.chips === 0) status = 'sitting-out';
      else status = 'seated';
      live.push({ name: p.name, isBot: !!p.isBot, chips: p.chips, inPot: room.status === 'playing' && room.pot > 0 ? (p.handBet || 0) : 0, status });
    }
  }
  return ledger.summary(roomId, bank, live, { nightId });
}

function saveBank() {
  try {
    const tmp = BANK_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(bank));
    fs.renameSync(tmp, BANK_FILE);
  } catch {}
  saveStacks();
}

// Chips on the table live only in memory; mirror them to disk so a restart (deploy)
// returns them to the owner's bank on boot instead of losing them.
function saveStacks() {
  try {
    const stacks = {};
    for (const room of rooms.values()) {
      if (room.unit !== 'chips') continue;
      for (const p of room.players) {
        if (p.isBot) continue;
        const inPot = room.status === 'playing' && room.pot > 0 ? (p.handBet || 0) : 0;
        if (!(p.chips + inPot > 0)) continue;
        const k = bankKey(p.name);
        stacks[k] = (stacks[k] || 0) + p.chips + inPot;
      }
    }
    const tmp = STACKS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(stacks));
    fs.renameSync(tmp, STACKS_FILE);
  } catch {}
}
setInterval(saveStacks, 2000).unref();

function getLeaderboard(myKey) {
  const rows = [];
  for (const [k, net] of ledger.accountNets({ mode: 'cents' })) {
    const a = accounts.get(k);
    if (a) rows.push({ key: k, display: a.display, avatar: a.avatar, pic: accounts.picUrl(a), netCents: net });
  }
  rows.sort((x, y) => y.netCents - x.netCents || x.display.localeCompare(y.display));
  const entries = rows.slice(0, 10).map((r, i) => ({ ...r, rank: i + 1 }));
  const mi = myKey ? rows.findIndex(r => r.key === myKey) : -1;
  const me = mi >= 0 ? { ...rows[mi], rank: mi + 1 } : null;
  return { entries, me, total: rows.length };
}

// ─── App Setup ───────────────────────────────────────────────────────────────

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

app.get('/apic/:key/:ver', (req, res) => {
  const a = accounts.get(String(req.params.key).toLowerCase());
  const m = a && a.avatarPic && /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(a.avatarPic);
  if (!m) { res.status(404).end(); return; }
  const current = accounts.picUrl(a).split('/').pop() === req.params.ver;
  res.set({ 'Content-Type': m[1], 'Cache-Control': current ? 'public, max-age=31536000, immutable' : 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" });
  res.send(Buffer.from(m[2], 'base64'));
});

app.get('/api/bank-summary', (req, res) => {
  if (req.query.password !== ROOM_PASSWORD) return res.status(403).json({ error: 'Incorrect password' });
  const roomId = typeof req.query.room === 'string' && req.query.room ? req.query.room : ROOM_ID;
  if (!rooms.has(roomId)) return res.status(404).json({ error: 'Unknown room' });
  res.json(bankSummary(roomId));
});

// ─── Room State ──────────────────────────────────────────────────────────────

const rooms = new Map();
const AV_EMOJI = ['🤠', '🦊', '🐉', '🎩', '🦁', '🐺', '🦅', '🎲', '👑', '💀', '🎯', '⚡'];

// Money in/out of a table seat by room mode. Chips: bank.json (+ ledger). Friends: ledger rows only (cents IOU).
// Play: nothing is stored except in-memory night rows used for the settle screen.
function moneyMeta(room, name, key) {
  if (!room.nightId) return undefined;
  return { mode: room.unit, tableId: room.id, nightId: room.nightId, key: key || bankKey(name) };
}
function payIn(room, name, amount, type, opts = {}) {
  const meta = moneyMeta(room, name, opts.key);
  if (room.mode === 'play') { tables.noteRow(room, { name, type, amount, key: (meta && meta.key) }); return null; }
  if (room.mode === 'friends') { ledger.log(type, name, amount, null, amount, room.handNum, room.id, meta); return null; }
  return adjustBank(name, -amount, type, room, amount, meta);
}
function payOut(room, name, amount, opts = {}) {
  let meta = moneyMeta(room, name, opts.key);
  if (meta && opts.reason) meta.reason = opts.reason;
  if (opts.park && room.mode === 'chips') meta = { ...(meta || {}), park: true };
  if (room.mode === 'play') { tables.noteRow(room, { name, type: 'cashout', amount, key: (meta && meta.key) }); return null; }
  if (room.mode === 'friends') { ledger.log('cashout', name, amount, null, 0, room.handNum, room.id, meta); return null; }
  return adjustBank(name, amount, 'cashout', room, 0, meta);
}
const tables = createTables({
  io, rooms, ledger, accounts, file: TABLES_FILE, bankKey, makeRoom, makePlayer, getBalance, payIn, payOut, AV_EMOJI,
  dropSeat: (...a) => dropSeat(...a), broadcastRoomUpdate: r => broadcastRoomUpdate(r), broadcastGameState: r => broadcastGameState(r),
  emitPrivateCards: r => emitPrivateCards(r), maybeAutoStart: (...a) => maybeAutoStart(...a), beginGame: (...a) => beginGame(...a),
  scheduleBlindIncrease: r => scheduleBlindIncrease(r), clearHandTimers: r => clearHandTimers(r), setPaused: (...a) => setRoomPaused(...a), roomLog: (r, m) => roomLog(r, m),
});
tables.load();
rooms.set(ROOM_ID, tables.attachLegacy(makeRoom(ROOM_ID, null)));

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
    lastStacks:   {},
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
    mode:             'chips',
    unit:             'chips',
    moneyMode:        'chips',
    maxSeats:         8,
    turnMs:           TURN_MS,
    rebuysAllowed:    true,
    rebuyLimit:       0,
    settings:         null,
    nightId:          null,
    blindSchedule:    null,
    autoStart:        false,
    paused:           false,
    keepStacks:       false,
    startBlindInterval: 0,
    rebuyCounts:      {},
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
    timeouts: 0,
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

function clearHandTimers(room) {
  for (const k of ['turnTimeout', 'botTimer', 'streetTimer', 'nextHandTimer', 'preTimer']) {
    if (room[k]) { clearTimeout(room[k]); room[k] = null; }
  }
  room.turnStartedAt = null;
}

function scheduleBotActionsIfNeeded(room) {
  if (!room || room.status !== 'playing') return;
  const idx = room.actionQueue[0];
  if (idx === undefined) return;
  const player = room.players[idx];
  if (!player || !player.isBot) return;

  const handNum = room.handNum;
  if (room.botTimer) clearTimeout(room.botTimer);
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    if (!rooms.has(room.id)) return;
    if (room.paused) { scheduleBotActionsIfNeeded(room); return; }
    if (room.handNum !== handNum) return;
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


// ─── Pre-select ──────────────────────────────────────────────────────────────
// A player who is not on turn can queue "check/fold" or "call N". It is bound to the
// hand, street and bet it was made against, fires once, and drops itself the moment any of
// those change (a raise, a new street, a new hand) so it can never act for a different amount.

function preStillValid(room, p) {
  const pre = p.pre;
  return !!pre && pre.handNum === room.handNum && pre.street === room.street && pre.bet === room.currentBet
    && !p.folded && !p.allIn && !p.sittingOut && p.connected && room.status === 'playing';
}

function clearStalePre(room) {
  for (const p of room.players) if (p.pre && !preStillValid(room, p)) p.pre = null;
}

function setPreselect(room, playerIdx, kind, amount) {
  const p = room.players[playerIdx];
  if (!p) return false;
  if (kind === null || kind === 'none') { p.pre = null; return true; }
  if (room.status !== 'playing' || p.folded || p.allIn || p.sittingOut || p.cards.length === 0) return false;
  if (!room.actionQueue.includes(playerIdx) || room.actionQueue[0] === playerIdx) return false; // only while waiting
  const toCall = Math.max(0, room.currentBet - p.roundBet);
  if (kind === 'checkfold') {
    p.pre = { kind, amount: 0, bet: room.currentBet, handNum: room.handNum, street: room.street };
    return true;
  }
  if (kind === 'call') {
    if (toCall <= 0 || amount !== toCall) return false; // must match what is owed right now
    p.pre = { kind, amount: toCall, bet: room.currentBet, handNum: room.handNum, street: room.street };
    return true;
  }
  return false;
}

function armPreselect(room) {
  if (room.preTimer) { clearTimeout(room.preTimer); room.preTimer = null; }
  if (room.status !== 'playing') return;
  const idx = room.actionQueue[0];
  const p = idx === undefined ? null : room.players[idx];
  if (!p || p.isBot || !p.pre) return;
  const handNum = room.handNum;
  room.preTimer = setTimeout(() => {
    room.preTimer = null;
    if (!rooms.has(room.id) || room.handNum !== handNum || room.status !== 'playing' || room.actionQueue[0] !== idx) return;
    const pre = p.pre;
    if (!preStillValid(room, p)) { p.pre = null; broadcastGameState(room); emitPrivateCards(room); return; }
    const toCall = Math.max(0, room.currentBet - p.roundBet);
    p.pre = null; // fires once
    let ok = false;
    if (pre.kind === 'checkfold') ok = processAction(room, idx, toCall === 0 ? 'check' : 'fold', 0);
    else if (pre.kind === 'call' && toCall === pre.amount) ok = processAction(room, idx, 'call', 0);
    broadcastGameState(room);
    emitPrivateCards(room);
    scheduleBotActionsIfNeeded(room);
    scheduleTurnTimeout(room);
  }, 450);
}

// ─── Turn Timer ──────────────────────────────────────────────────────────────

function clearTurnTimeout(room) {
  if (room.turnTimeout) { clearTimeout(room.turnTimeout); room.turnTimeout = null; }
  room.turnStartedAt = null;
}

function scheduleTurnTimeout(room) {
  clearTurnTimeout(room);
  if (room.status !== 'playing' || room.paused) return;
  const idx = room.actionQueue[0];
  if (idx === undefined) return;
  if (room.players[idx]?.isBot) return; // bots self-manage

  const handNum = room.handNum;
  if (!room.turnMs) { armPreselect(room); return; }
  room.turnStartedAt = Date.now();
  room.turnTimeout   = setTimeout(() => {
    if (!rooms.has(room.id)) return;
    if (room.handNum !== handNum) return;
    if (room.actionQueue[0] !== idx) return;
    if (room.status !== 'playing') return;
    const afk = room.players[idx];
    processAction(room, idx, 'fold', 0);
    if (afk && ++afk.timeouts >= 2 && !afk.sitOutRequest) {
      afk.sitOutRequest = true;
      roomLog(room, `${afk.name} timed out twice and is sitting out`);
    }
    broadcastGameState(room);
    emitPrivateCards(room);
    scheduleBotActionsIfNeeded(room);
    scheduleTurnTimeout(room);
  }, room.turnMs);
  armPreselect(room);
}

// ─── Blind Escalation ─────────────────────────────────────────────────────────

function scheduleBlindIncrease(room) {
  if (room.blindTimer) { clearTimeout(room.blindTimer); room.blindTimer = null; }
  if (!room.blindsEnabled || room.blindIntervalMs <= 0) return;
  const sched = room.blindSchedule || BLIND_SCHEDULE;
  const nextLevel = room.blindLevel + 1;
  if (nextLevel >= sched.length) return;

  room.blindTimer = setTimeout(() => {
    if (!rooms.has(room.id)) return;
    room.blindLevel = nextLevel;
    const lvl = sched[nextLevel];
    room.sb = lvl.sb;
    room.bb = lvl.bb;
    room.blindLevelStartAt = Date.now();
    roomLog(room, `★ BLINDS UP · Level ${nextLevel + 1}: ${room.sb}/${room.bb}`);
    io.to(room.id).emit('blinds_up', { level: nextLevel, sb: room.sb, bb: room.bb, ...modeFields(room) });
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

function beginGame(room, blindInterval) {
  room.status = 'playing';
  if (Number.isFinite(blindInterval) && blindInterval > 0) {
    room.blindsEnabled    = true;
    room.blindIntervalMs  = Math.min(6 * 3600000, Math.max(60000, blindInterval)); // 1 minute .. 6 hours
    room.blindLevelStartAt = Date.now();
    scheduleBlindIncrease(room);
  }
  startHand(room);
  broadcastGameState(room);
  emitPrivateCards(room);
  scheduleBotActionsIfNeeded(room);
  scheduleTurnTimeout(room);
}

// Pause holds betting, dealing and all timers; resume picks them back up. Also mirrors the state onto the table card.
function setRoomPaused(room, next, by) {
  if (next === !!room.paused) return false;
  room.paused = next;
  const t = tables.tables.get(room.id);
  if (t && t.state !== 'ended') { t.state = next ? 'paused' : 'open'; t.pausedBy = next ? by : null; }
  roomLog(room, next ? `Table paused by ${by}` : 'Table resumed');
  if (next) clearTurnTimeout(room);
  else { scheduleBotActionsIfNeeded(room); scheduleTurnTimeout(room); if (!room.nextHandTimer) maybeAutoStart(room, true); }
  tables.pushLobby();
  return true;
}

// The persistent table starts by itself once two players with chips are seated.
function maybeAutoStart(room, force) {
  if ((!room.autoStart && !force) || room.paused || room.endNightPending || room.status !== 'waiting' || room.autoStartTimer) return;
  const ready = () => room.status === 'waiting' && room.players.filter(p => p.connected && p.chips > 0 && !p.sitOutRequest).length >= 2;
  if (!ready()) return;
  const go = () => {
    room.autoStartTimer = null;
    if (ready() && !room.paused && !room.endNightPending) beginGame(room, room.startBlindInterval);
  };
  room.autoStartTimer = setTimeout(go, AUTO_START_MS);
}

function startHand(room) {
  const players = room.players;
  room.deck      = makeDeck();
  room.community = [];
  room.pot       = 0;
  room.currentBet = room.bb;
  room.street    = 'preflop';
  room.handNum  += 1;
  room.shown = {};
  if (room.mode !== 'play') ledger.startHand(room);

  for (const p of players) {
    p.cards    = [];
    p.roundBet = 0;
    p.handBet  = 0;
    p.folded   = false;
    p.allIn    = false;
    p.lastAction = null;
    p.pre = null;
    if (p.chips === 0)  p.sittingOut = true;
    else                p.sittingOut = p.sitOutRequest;
    p.handStartChips = p.sittingOut ? 0 : p.chips;
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
  p.chips -= bet; p.roundBet += bet; p.handBet = (p.handBet || 0) + bet; room.pot += bet;
  if (p.chips === 0) p.allIn = true;
}

// ─── Process Action ───────────────────────────────────────────────────────────

function processAction(room, playerIdx, action, amount) {
  const p = room.players[playerIdx];
  const name = p.name;
  const toCall = Math.max(0, room.currentBet - p.roundBet);
  room.lastReject = null;

  switch (action) {
    case 'fold': {
      p.folded = true;
      p.lastAction = 'FOLD';
      room.actionQueue = room.actionQueue.filter(i => i !== playerIdx);
      roomLog(room, `${name} folds`);
      break;
    }
    case 'check': {
      if (p.roundBet !== room.currentBet) { roomLog(room, `${name} cannot check`); room.lastReject = 'Cannot check: call, raise or fold'; return false; }
      p.lastAction = 'CHECK';
      room.actionQueue.shift();
      roomLog(room, `${name} checks`);
      break;
    }
    case 'call': {
      const callAmt = Math.min(toCall, p.chips);
      p.chips -= callAmt; p.roundBet += callAmt; p.handBet = (p.handBet || 0) + callAmt; room.pot += callAmt;
      if (p.chips === 0) p.allIn = true;
      p.lastAction = 'CALL';
      room.actionQueue.shift();
      roomLog(room, `${name} calls ${callAmt}`);
      break;
    }
    case 'raise': {
      if (!Number.isSafeInteger(amount)) { room.lastReject = 'Raise amount must be a whole number'; return false; }
      const canRespond = room.players.some((o, i) => i !== playerIdx && !o.folded && !o.allIn && !o.sittingOut && o.connected);
      if (!canRespond) { // everyone else is all-in: only call is possible, a bet or raise has no one to answer it
        if (toCall <= 0) { room.lastReject = 'Everyone else is all-in, nothing to bet'; return false; }
        const callAmt = Math.min(toCall, p.chips);
        p.chips -= callAmt; p.roundBet += callAmt; p.handBet = (p.handBet || 0) + callAmt; room.pot += callAmt;
        if (p.chips === 0) p.allIn = true;
        p.lastAction = 'CALL';
        room.actionQueue = room.actionQueue.filter(i => i !== playerIdx);
        roomLog(room, `${name} calls ${callAmt}`);
        break;
      }
      const minRaise = room.currentBet + room.bb;
      const raiseTo  = Math.max(amount, minRaise);
      const addAmt   = Math.min(raiseTo - p.roundBet, p.chips);
      const prevBet  = room.currentBet;
      p.chips -= addAmt; p.roundBet += addAmt; p.handBet = (p.handBet || 0) + addAmt; room.pot += addAmt;
      if (p.chips === 0) p.allIn = true;
      if (p.roundBet <= prevBet) { // short all-in that does not reach the current bet is just a call
        p.lastAction = 'CALL';
        room.actionQueue = room.actionQueue.filter(i => i !== playerIdx);
        roomLog(room, `${name} calls ${addAmt} (all-in)`);
        break;
      }
      room.currentBet = p.roundBet;
      p.lastAction = 'RAISE';
      roomLog(room, `${name} raises to ${p.roundBet}`);
      const nextIdx = (playerIdx + 1) % room.players.length;
      room.actionQueue = buildActionQueue(room, nextIdx).filter(i => i !== playerIdx);
      break;
    }
    default: room.lastReject = 'Unknown action'; return false;
  }
  clearTurnTimeout(room); // only an accepted action cancels the pending auto-fold
  room.players[playerIdx].pre = null;
  clearStalePre(room);

  const remaining = room.players.filter(p => !p.folded && !p.sittingOut && p.connected);
  if (remaining.length === 1) { instantWin(room, remaining[0]); return true; }
  if (room.actionQueue.length === 0) advanceStreet(room);
  return true;
}

// ─── Instant Win ──────────────────────────────────────────────────────────────

function instantWin(room, winner) {
  if (room.nextHandTimer) return; // hand already ended
  winner.chips += room.pot;
  roomLog(room, `${winner.name} wins ${room.pot} (all others folded)`);
  room.handHistory.unshift({
    handNum:  room.handNum,
    winners:  [winner.name],
    handName: 'All others folded',
    pot:      room.pot,
  });
  if (room.handHistory.length > 10) room.handHistory.pop();
  io.to(room.id).emit('showdown_result', {
    winners: [{ name: winner.name, handName: 'Everyone folded', cards: [], amount: room.pot }],
    pot: room.pot, nextMs: 7000,
  });
  room.pot = 0;
  scheduleNextHand(room, 7000);
}

// ─── Advance Street ───────────────────────────────────────────────────────────

function advanceStreet(room) {
  for (const p of room.players) { p.roundBet = 0; p.pre = null; }
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
  // One player with chips left against all-in opponents has no one to bet against: run the board out.
  if (room.actionQueue.length === 1 && room.players.some(o => !o.folded && !o.sittingOut && o.connected && o.allIn)) room.actionQueue = [];
  if (room.actionQueue.length === 0) {
    broadcastGameState(room);
    const handNum = room.handNum;
    if (room.streetTimer) clearTimeout(room.streetTimer);
    const tick = () => {
      room.streetTimer = null;
      if (room.status !== 'playing' || room.handNum !== handNum) return;
      if (room.paused) { room.streetTimer = setTimeout(tick, 500); return; }
      advanceStreet(room);
    };
    room.streetTimer = setTimeout(tick, 1500);
  }
}

// ─── Showdown ─────────────────────────────────────────────────────────────────

function showdown(room) {
  if (room.nextHandTimer) return; // hand already ended
  const contenders = room.players.filter(p => !p.folded && !p.sittingOut && p.connected);
  roomLog(room, '--- Showdown ---');

  const results = contenders.map(p => ({
    player: p, idx: room.players.indexOf(p), hand: bestHand(p.cards, room.community),
  }));
  results.sort((a, b) => compareHands(b.hand, a.hand));

  // Split the pot in layers by total contribution so short all-ins only win what they covered.
  const paid = new Map();
  const levels = [...new Set(room.players.map(p => p.handBet || 0).filter(b => b > 0))].sort((a, b) => a - b);
  let prev = 0, awarded = 0;
  for (const level of levels) {
    const layer = room.players.reduce((sum, p) => sum + Math.max(0, Math.min(p.handBet || 0, level) - prev), 0);
    prev = level;
    if (layer === 0) continue;
    let pool = results.filter(r => (r.player.handBet || 0) >= level);
    if (pool.length === 0) pool = results;
    const top = pool.reduce((b, r) => (compareHands(r.hand, b) > 0 ? r.hand : b), pool[0].hand);
    const layerWinners = pool.filter(r => compareHands(r.hand, top) === 0).sort((a, b) => a.idx - b.idx);
    const share = Math.floor(layer / layerWinners.length);
    const rem = layer - share * layerWinners.length;
    layerWinners.forEach((w, i) => {
      const amt = share + (i === 0 ? rem : 0);
      w.player.chips += amt;
      paid.set(w, (paid.get(w) || 0) + amt);
    });
    awarded += layer;
  }
  if (awarded < room.pot) { // contributions untracked: fall back to a single pot
    const top = results[0].hand;
    const ws = results.filter(r => compareHands(r.hand, top) === 0).sort((a, b) => a.idx - b.idx);
    const extra = room.pot - awarded, share = Math.floor(extra / ws.length), rem = extra - share * ws.length;
    ws.forEach((w, i) => { const amt = share + (i === 0 ? rem : 0); w.player.chips += amt; paid.set(w, (paid.get(w) || 0) + amt); });
  }
  const winners = [...paid.keys()].sort((a, b) => a.idx - b.idx);

  const winnerList = winners.map(w => ({ name: w.player.name, handName: w.hand.name, cards: w.player.cards, amount: paid.get(w), net: paid.get(w) - (w.player.handBet || 0) }));
  for (const w of winners) w.player.winHand = w.hand.name;
  for (const w of winners) roomLog(room, `${w.player.name} wins ${paid.get(w)} with ${w.hand.name}`);

  room.handHistory.unshift({
    handNum:  room.handNum,
    winners:  winners.map(w => w.player.name),
    handName: results[0].hand.name,
    pot:      room.pot,
  });
  if (room.handHistory.length > 10) room.handHistory.pop();
  const reveals = results.map(r => ({ name: r.player.name, handName: r.hand.name, cards: r.player.cards }));
  for (const r of reveals) (room.shown ||= {})[bankKey(r.name)] = [true, true];
  io.to(room.id).emit('showdown_result', { winners: winnerList, pot: room.pot, reveals, nextMs: 5000 });
  room.pot = 0;
  scheduleNextHand(room, 5000);
}

// ─── Schedule Next Hand ───────────────────────────────────────────────────────

function scheduleNextHand(room, delayMs = 5000) {
  if (process.env.HAND_DELAY_MS) delayMs = Number(process.env.HAND_DELAY_MS) || delayMs;
  clearHandTimers(room);
  try { if (typeof social !== 'undefined') social.onHandEnd(room); } catch {}
  if (room.nightId && room.mode !== 'play') {
    const pot = room.players.reduce((sum, p) => sum + (p.handBet || 0), 0);
    for (const p of room.players) if (!p.isBot && p.acct && p.handStartChips > 0) accounts.recordHand(p.acct, { won: p.chips > p.handStartChips, pot });
  }
  if (room.mode !== 'play') ledger.endHand(room, getBalance);
  room.status = 'waiting_next';
  broadcastGameState(room);

  const dealNext = () => {
    room.nextHandTimer = null;
    if (!rooms.has(room.id)) return;
    if (room.endNightPending && room.settings) { tables.finishNight(room, 'host'); return; }
    if (room.paused) { room.nextHandTimer = setTimeout(dealNext, 500); return; }

    // Dealer button moves clockwise to the next seat that is not busted or sitting out
    const n0 = room.players.length;
    let nextDealer = null;
    for (let o = 1; o <= n0 && !nextDealer; o++) {
      const c = room.players[(room.dealerIdx + o) % n0];
      if (c.connected && c.chips > 0 && !c.sitOutRequest) nextDealer = c;
    }

    // Remove disconnected players and busted bots; keep busted humans (rebuy option)
    room.players = room.players.filter(p => {
      if (!p.connected) return false;
      if (p.isBot && p.chips === 0) return false;
      return true;
    });

    const active = room.players.filter(p => p.connected && p.chips > 0);
    const willPlay = active.filter(p => !p.sitOutRequest);
    if (active.length < 2 || willPlay.length < 2) {
      // Lone player left: award remaining chips back to bank (sit-outs keep their stacks)
      if (active.length < 2 && !room.keepStacks) for (const p of room.players) {
        if (!p.isBot && p.chips > 0) { const c = p.chips; p.chips = 0; payOut(room, p.name, c, { key: p.acct, park: true }); }
      }
      if (room.keepStacks) for (const p of room.players) {
        if (p.connected && !p.isBot && p.chips === 0) io.to(p.socketId).emit('bust_out', bustPayload(room, p));
      }
      if (room.blindTimer) { clearTimeout(room.blindTimer); room.blindTimer = null; }
      room.status = 'waiting';
      if (active.length >= 2 && willPlay.length === 0) {
        // Everyone sat out — bring them back automatically
        for (const p of room.players) p.sitOutRequest = false;
        roomLog(room, 'All players sat out. Sit-out requests cleared.');
      } else if (active.length >= 2) {
        room.sitterWait = true;
        roomLog(room, 'Waiting for players (only one player is sitting in)');
      } else {
        roomLog(room, 'Not enough players. Waiting...');
      }
      broadcastGameState(room);
      return;
    }

    if (room.paused) {
      room.status = 'waiting';
      if (room.blindTimer) { clearTimeout(room.blindTimer); room.blindTimer = null; }
      roomLog(room, 'Table paused');
      broadcastGameState(room);
      return;
    }

    // Notify busted humans so they can see rebuy prompt
    for (const p of room.players) {
      if (p.connected && !p.isBot && p.chips === 0) io.to(p.socketId).emit('bust_out', bustPayload(room, p));
    }

    room.dealerIdx = Math.max(0, room.players.indexOf(nextDealer));
    room.status    = 'playing';
    startHand(room);
    broadcastGameState(room);
    emitPrivateCards(room);
    scheduleBotActionsIfNeeded(room);
    scheduleTurnTimeout(room);
  };
  room.nextHandTimer = setTimeout(dealNext, delayMs);
}

// ─── Broadcasting ─────────────────────────────────────────────────────────────

function modeFields(room) {
  return {
    mode: room.mode, unit: room.unit, moneyMode: room.mode === 'friends' ? 'ledger' : room.mode,
    table: { id: room.id, name: room.settings ? room.settings.name : null, mode: room.mode, unit: room.unit, sb: room.sb, bb: room.bb, maxSeats: room.maxSeats },
  };
}

function bustPayload(room, p) {
  const t = room.settings;
  const legacy = !room.nightId;
  const o = {
    tableId: room.id, unit: room.unit, mode: room.mode,
    rebuy: { allowed: rebuyAllowed(room, p), min: legacy ? BIG_BLIND : t.buyIn.min, max: t ? t.buyIn.max : STARTING_CHIPS },
  };
  if (room.mode === 'chips') o.balance = getBalance(p.name);
  return o;
}

function rebuyAllowed(room, p) {
  if (!room.rebuysAllowed) return false;
  if (room.rebuyLimit > 0 && (room.rebuyCounts[p.acct || bankKey(p.name)] || 0) >= room.rebuyLimit) return false;
  return true;
}

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
    ...modeFields(room),
    paused:          !!room.paused,
    endingNight:     !!room.endNightPending,
    startChips:      room.startChips || STARTING_CHIPS,
    hostName:        room.players.find(p => p.socketId === room.hostSocketId)?.name || '',
    sb:              room.sb,
    bb:              room.bb,
    blindLevel:      room.blindLevel,
    blindsEnabled:   room.blindsEnabled,
    blindNextMs:     (room.blindsEnabled && room.blindLevelStartAt)
      ? Math.max(0, room.blindLevelStartAt + room.blindIntervalMs - Date.now())
      : null,
    blindMaxLevel:   (room.blindSchedule || BLIND_SCHEDULE).length - 1,
    turnRemainingMs: room.turnStartedAt
      ? Math.max(0, room.turnStartedAt + room.turnMs - Date.now())
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
  clearStalePre(room);
  for (let i = 0; i < room.players.length; i++) {
    const p = room.players[i];
    if (!p.isBot && p.connected && p.socketId) {
      io.to(p.socketId).emit('your_cards', { cards: p.cards, myIdx: i, preselect: p.pre ? { mode: p.pre.kind, amount: p.pre.amount } : null });
    }
  }
}

function broadcastRoomUpdate(room) {
  io.to(room.id).emit('room_update', {
    ...modeFields(room),
    players:  room.players.map(p => ({ name: p.name, avatar: p.avatar, profilePic: p.profilePic || null })),
    hostName: room.players.find(p => p.socketId === room.hostSocketId)?.name || '',
  });
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validatePic(pic) {
  if (typeof pic !== 'string') return null;
  if (pic.length > 150000 || !/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+\/=]+$/.test(pic)) return null;
  return pic;
}

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// ─── Socket Events ────────────────────────────────────────────────────────────

// Tell every client about a display/avatar change and refresh the live seat at any table.
function announceAccount(key) {
  const a = accounts.get(key);
  if (!a) return;
  const view = { key, display: a.display, avatar: a.avatar, pic: accounts.picUrl(a) };
  for (const s of io.sockets.sockets.values()) {
    if (!s.data || !s.data.acct) continue;
    if (s.data.acct === key) s.emit('self_changed', { ...view, account: accounts.publicAccount(a) });
  }
  tables.syncAccount(key);
  io.emit('account_changed', view);
}

function profileOf(a, self) {
  return {
    key: a.key, display: a.display, avatar: a.avatar, pic: accounts.picUrl(a), stats: a.stats,
    netCents: ledger.accountNet(a.key, { mode: 'cents' }), netChips: ledger.accountNet(a.key, { mode: 'chips' }),
    recent: ledger.nightsFor(a.key, 20), prefs: self ? a.prefs : undefined, isAdmin: !!a.isAdmin,
  };
}

io.on('connection', socket => {
  console.log(`Socket connected: ${socket.id}`);

  // Handlers always get an object payload and can never take the process down.
  const on = (ev, fn) => socket.on(ev, (payload, ...rest) => {
    try { fn(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}, ...rest); }
    catch (err) { console.error(`handler ${ev} failed:`, err); socket.emit('error', { message: 'Server error' }); }
  });
  const cleanNameOf = v => (typeof v === 'string' ? v.trim().slice(0, 24) : '');

  // ── Accounts / auth ───────────────────────────────────────────────────────
  const ctxOf = () => ({ ip: String(socket.handshake.headers['x-forwarded-for'] || socket.handshake.address || '?').split(',')[0].trim(), ua: socket.handshake.headers['user-agent'] });
  const authFail = r => { console.log(`auth fail ${r.code} ip=${ctxOf().ip} ua=${String(ctxOf().ua || '').slice(0, 50)}`); socket.emit('auth_error', { code: r.code, message: r.message, ...(r.retryMs ? { retryMs: r.retryMs } : {}) }); };
  const authOk = (r, withToken) => {
    const a = r.account;
    socket.data.acct = a.key;
    socket.data.sessionH = r.sessionH || crypto.createHash('sha256').update(r.token).digest('hex');
    socket.emit('auth_ok', withToken ? { account: accounts.publicAccount(a), token: r.token } : { account: accounts.publicAccount(a) });
    accounts.emit('auth', socket, a.key);
    try { socket.emit('money', moneyView(a.key)); } catch {}
    try { socket.emit('account:stats', social.statsView(a.key)); socket.emit('achv:state', social.achvView(a.key)); } catch {}
  };
  const authed = () => { if (!socket.data.acct) { socket.emit('error', { message: 'Sign in first', code: 'auth' }); return null; } return socket.data.acct; };
  on('auth_signup', ({ name, pin, avatar } = {}) => { const r = accounts.signup(name, pin, avatar, ctxOf()); r.ok ? authOk(r, true) : authFail(r); });
  on('auth_claim', ({ name, pin, avatar, roomPassword } = {}) => { const r = accounts.claim(name, pin, avatar, roomPassword, ctxOf()); r.ok ? authOk(r, true) : authFail(r); });
  on('auth_login', ({ name, pin } = {}) => { const r = accounts.login(name, pin, ctxOf()); r.ok ? authOk(r, true) : authFail(r); });
  on('auth_resume', ({ key, token } = {}) => { const r = accounts.resume(key, token); r.ok ? authOk(r, false) : authFail(r); });
  on('auth_logout', () => {
    if (socket.data.acct) accounts.logoutHash(socket.data.acct, socket.data.sessionH);
    socket.data.acct = null; socket.data.sessionH = null;
    socket.emit('auth_out', {});
  });
  on('profile_get', ({ key } = {}) => {
    const me = authed(); if (!me) return;
    const k = typeof key === 'string' && key ? accounts.keyOf(key) : me;
    const a = accounts.get(k);
    if (!a) { socket.emit('error', { message: 'No such player' }); return; }
    socket.emit('profile', profileOf(a, k === me));
  });
  on('profile_update', ({ avatar, prefs, display, avatarPic } = {}) => {
    const me = authed(); if (!me) return;
    const fail = (field, message) => socket.emit('profile_error', { field, message });
    let changed = false;
    if (display !== undefined) {
      const r = accounts.rename(me, display);
      if (!r.ok) fail('display', r.message); else if (r.changed) changed = true;
    }
    if (avatarPic !== undefined) {
      if (avatarPic && !accounts.validAvatarPic(avatarPic)) fail('avatarPic', 'That picture is not allowed. Use a JPEG, PNG or WebP under 40 KB.');
      else { accounts.setAvatarPic(me, avatarPic || null); changed = true; }
    }
    const before = accounts.get(me) && accounts.get(me).avatar;
    const a = accounts.updateProfile(me, { avatar, prefs });
    if (a.avatar !== before) changed = true;
    socket.emit('profile', profileOf(a, true));
    if (changed) announceAccount(me);
  });
  on('pin_change', ({ oldPin, newPin } = {}) => {
    const me = authed(); if (!me) return;
    const r = accounts.pinChange(me, oldPin, newPin, { ...ctxOf(), sessionH: socket.data.sessionH });
    r.ok ? socket.emit('ok', { what: 'pin' }) : authFail(r);
  });
  on('account_reset_pin', ({ key, newPin } = {}) => {
    const me = authed(); if (!me) return;
    const r = accounts.resetPin(me, key, newPin);
    r.ok ? socket.emit('ok', { what: 'pin_reset' }) : authFail(r);
  });
  // ── Admin console (floating admin button). Every event re-checks isAdmin server-side. ──
  const adminOnly = () => {
    if (accounts.isAdmin(socket.data.acct)) return socket.data.acct;
    socket.emit('admin_result', { ok: false, code: 'auth', message: 'Admin only' });
    return null;
  };
  on('admin_overview', () => {
    if (!adminOnly()) return;
    const room = rooms.get(ROOM_ID);
    const online = new Set();
    for (const s of io.sockets.sockets.values()) if (s.data && s.data.acct) online.add(s.data.acct);
    const rows = Object.values(accounts.all()).map(a => {
      const k = bankKey(a.key);
      const atTable = atTableOf(k);
      const seen = Math.max(a.lastLoginAt || 0, ...(a.sessions || []).map(x => x.lastSeen || 0));
      const w = gameHooks && gameHooks.wallet ? gameHooks.wallet.get(k) : null;
      return { key: a.key, display: a.display, isAdmin: !!a.isAdmin, claimed: !!a.claimed, lastSeen: seen || null, online: online.has(a.key), balance: bank[k] === undefined ? null : bank[k] + atTable, play: w ? w.play : null };
    }).sort((x, y) => (y.online - x.online) || ((y.lastSeen || 0) - (x.lastSeen || 0)) || x.display.localeCompare(y.display));
    socket.emit('admin_overview', {
      accounts: rows,
      table: room ? { paused: !!room.paused, status: room.status, seated: room.players.filter(p => !p.isBot).length, handNum: room.handNum || 0, startChips: room.startChips || STARTING_CHIPS } : null,
    });
  });
  on('admin_bank_summary', () => {
    if (!adminOnly()) return;
    socket.emit('bank_summary', bankSummary(ROOM_ID));
  });
  on('admin_set_play', ({ key, cents } = {}) => {
    if (!adminOnly()) return;
    const k = typeof key === 'string' ? accounts.keyOf(key) : '';
    const v = Math.round(Number(cents));
    if (!k || !accounts.get(k)) { socket.emit('admin_result', { op: 'set_play', ok: false, message: 'Unknown player' }); return; }
    if (!Number.isFinite(v) || v < 0 || v > 100000000000) { socket.emit('admin_result', { op: 'set_play', ok: false, message: 'Enter a Play $ amount from 0 up to 1,000,000,000' }); return; }
    if (!gameHooks || !gameHooks.wallet) { socket.emit('admin_result', { op: 'set_play', ok: false, message: 'Wallet unavailable' }); return; }
    gameHooks.wallet.adminSet(k, v);
    gameHooks.pushWallet(k);
    pushMoney(k);
    console.log(`admin ${accounts.displayOf(socket.data.acct)} set Play $ for ${k} to ${v} cents`);
    socket.emit('admin_result', { op: 'set_play', key: k, ok: true, message: 'Play $ set' });
  });
  on('admin_reset_pin', ({ key, newPin } = {}) => {
    const me = adminOnly(); if (!me) return;
    const k = typeof key === 'string' ? accounts.keyOf(key) : '';
    const r = accounts.resetPin(me, k, typeof newPin === 'string' || typeof newPin === 'number' ? String(newPin) : '');
    if (r.ok) console.log(`admin ${me} reset PIN for ${k}`);
    socket.emit('admin_result', { op: 'reset_pin', key: k, ok: !!r.ok, code: r.code, message: r.ok ? 'PIN reset. Their other sessions were signed out.' : r.message });
  });
  if (process.env.AUTH_CLOCK_SKEW !== undefined) on('__test_skew', ({ ms } = {}) => { accounts.setSkew(ms); socket.emit('ok', { what: 'skew' }); });

  // ── Bank queries ──────────────────────────────────────────────────────────
  on('check_balance', ({ name } = {}) => {
    if (!cleanNameOf(name)) return;
    socket.emit('balance_data', { balance: getBalance(cleanNameOf(name)) });
  });

  on('get_bank_summary', ({ roomId } = {}) => {
    if (typeof roomId !== 'string' || !socket.rooms.has(roomId)) return;
    socket.emit('bank_summary', bankSummary(roomId));
  });

  // Only the seated player named "chris" can edit money. `balance` is the player's TOTAL (bank + chips at the table).
  on('bank_set', ({ name, balance } = {}) => {
    const room = rooms.get(ROOM_ID);
    const me = room && room.players.find(p => !p.isBot && p.socketId === socket.id);
    const admin = accounts.isAdmin(socket.data.acct);
    if (!room || (!admin && (!me || bankKey(me.name) !== 'chris'))) { socket.emit('error', { message: 'Only Chris can edit the bank' }); return; }
    const byName = me ? me.name : accounts.displayOf(socket.data.acct);
    const target = cleanNameOf(name);
    const total = Math.round(Number(balance));
    if (!target) { socket.emit('error', { message: 'Unknown player' }); return; }
    if (!Number.isFinite(total) || total < 0 || total > 100000000) { socket.emit('error', { message: 'Enter an amount from 0 to 100,000,000' }); return; }
    const k = bankKey(target);
    getBalance(target);
    const seat = room.players.find(p => !p.isBot && bankKey(p.name) === k);
    const stack = seat ? seat.chips : 0;
    let newStack = stack;
    if (total < stack) {
      if (room.status === 'playing' && seat && seat.cards.length && !seat.folded) { socket.emit('error', { message: `${target} is in a hand. Lower their money after it ends.` }); return; }
      newStack = total;
    }
    const inPot = seat && room.status === 'playing' && room.pot > 0 ? (seat.handBet || 0) : 0;
    const before = bank[k] + stack + inPot;
    bank[k] = Math.max(0, total - newStack - inPot);
    saveBank();
    if (seat && newStack !== stack) {
      seat.chips = newStack;
      if (newStack === 0 && !seat.allIn) seat.sittingOut = true;
    }
    if (total !== before) {
      ledger.log('adjust', target, Math.abs(total - before), bank[k], newStack, room.handNum, room.id, { delta: total - before });
      roomLog(room, `${byName} set ${target}'s money to ${total.toLocaleString()}`);
    }
    pushMoney(k);
    if (seat && seat.connected) {
      io.to(seat.socketId).emit('balance_data', { balance: bank[k] });
      if (seat.chips === 0) io.to(seat.socketId).emit('bust_out', bustPayload(room, seat));
    }
    broadcastGameState(room);
    io.to(room.id).emit('bank_summary', bankSummary(room.id));
  });

  // Voluntarily show hole cards once the hand is over. idx is 0, 1 or 'both'.
  on('set_pause', ({ paused } = {}) => {
    const room = rooms.get(ROOM_ID);
    const me = room && room.players.find(p => !p.isBot && p.socketId === socket.id);
    if (!room || (!accounts.isAdmin(socket.data.acct) && (!me || bankKey(me.name) !== 'chris'))) { socket.emit('error', { message: 'Only Chris can pause the table' }); return; }
    setRoomPaused(room, typeof paused === 'boolean' ? paused : !room.paused, 'Chris');
    broadcastGameState(room);
  });

  on('reset_table', ({ amount } = {}) => {
    const room = rooms.get(ROOM_ID);
    const me = room && room.players.find(p => !p.isBot && p.socketId === socket.id);
    if (!room || (!accounts.isAdmin(socket.data.acct) && (!me || bankKey(me.name) !== 'chris'))) { socket.emit('error', { message: 'Only Chris can reset the table' }); return; }
    if (!room.paused) { socket.emit('error', { message: 'Pause the table first' }); return; }
    const stack = amount === undefined ? (room.startChips || STARTING_CHIPS) : Math.floor(Number(amount));
    if (!Number.isFinite(stack) || stack < BIG_BLIND * 10 || stack > 10000000) {
      socket.emit('error', { message: `Starting stack must be between ${BIG_BLIND * 10} and 10,000,000` }); return;
    }
    room.startChips = stack;
    const legacyTable = tables.tables.get(room.id);
    if (legacyTable && legacyTable.buyIn) legacyTable.buyIn = { ...legacyTable.buyIn, default: stack, max: Math.max(legacyTable.buyIn.max, stack) };

    if (room.status === 'playing') {
      for (const p of room.players) { p.chips += p.handBet || 0; p.handBet = 0; }
      ledger.endHand(room, getBalance);
    }
    clearHandTimers(room);
    if (room.autoStartTimer) { clearTimeout(room.autoStartTimer); room.autoStartTimer = null; }
    if (room.blindTimer) { clearTimeout(room.blindTimer); room.blindTimer = null; }

    for (const p of room.players) {
      if (!p.isBot && p.chips > 0) { const c = p.chips; p.chips = 0; payOut(room, p.name, c, { key: p.acct }); }
    }
    // Everyone's total money becomes the chosen stack, so the bank matches what they sit down with.
    for (const k of Object.keys(bank)) {
      if (bank[k] === stack) continue;
      const delta = stack - bank[k];
      bank[k] = stack;
      ledger.log('adjust', k, Math.abs(delta), stack, 0, room.handNum, room.id, { delta });
    }
    saveBank();
    for (const p of room.players) {
      if (p.isBot) continue;
      if (p.connected) {
        const buyIn = Math.min(stack, getBalance(p.name));
        if (buyIn >= BIG_BLIND) {
          payIn(room, p.name, buyIn, 'buyin', { key: p.acct });
          p.chips = buyIn;
          p.chipsBought = buyIn;
        }
      }
      p.cards = []; p.roundBet = 0; p.handBet = 0; p.folded = false; p.allIn = false; p.lastAction = null;
      p.sittingOut = p.chips === 0 || !!p.sitOutRequest;
    }

    for (const k of Object.keys(bank)) pushMoney(k);
    room.status = 'waiting';
    room.community = []; room.pot = 0; room.currentBet = 0; room.street = null;
    room.actionQueue = []; room.dealerIdx = 0; room.shown = {}; room.lastStacks = {};
    room.sb = SMALL_BLIND; room.bb = BIG_BLIND; room.blindLevel = 0; room.blindsEnabled = false;
    setRoomPaused(room, false, 'Chris');
    roomLog(room, `Table reset by Chris, stacks ${stack.toLocaleString()}`);

    broadcastRoomUpdate(room);
    broadcastGameState(room);
    emitPrivateCards(room);
    for (const p of room.players) if (!p.isBot && p.connected) io.to(p.socketId).emit('balance_data', { balance: getBalance(p.name) });
    io.to(room.id).emit('bank_summary', bankSummary(room.id));
    maybeAutoStart(room);
  });

  on('show_cards', ({ which } = {}) => {
    const room = rooms.get(ROOM_ID);
    const me = room && room.players.find(p => !p.isBot && p.socketId === socket.id);
    if (!me || room.status !== 'waiting_next' || me.cards.length !== 2) return;
    const slots = which === 'both' ? [0, 1] : (which === 0 || which === 1) ? [which] : [];
    if (!slots.length) return;
    const shown = (room.shown ||= {});
    const rec = shown[bankKey(me.name)] || [false, false];
    slots.forEach(i => { rec[i] = true; });
    shown[bankKey(me.name)] = rec;
    io.to(room.id).emit('cards_shown', { handNum: room.handNum, name: me.name, cards: me.cards.map((c, i) => (rec[i] ? c : null)) });
    roomLog(room, `${me.name} shows ${rec[0] && rec[1] ? 'both cards' : 'one card'}`);
  });

  on('get_leaderboard', () => {
    socket.emit('leaderboard_data', getLeaderboard(socket.data.acct && (socket.data.acct.key || socket.data.acct)));
  });

  tables.register(socket, on, authed);
  socket.on('table_create', () => { try { const k = socket.data.acct; if (k && [...tables.tables.values()].some(t => t.hostKey === k && t.id !== tables.LEGACY_ID && Date.now() - t.createdAt < 3000)) social.onAction(socket, 'host'); } catch {} });

  // ── join_game ─────────────────────────────────────────────────────────────
  on('join_game', ({ name, avatar, profilePic, password } = {}) => {
    if (String(password || '').trim().toLowerCase() !== ROOM_PASSWORD) {
      socket.emit('error', { message: 'Incorrect password' }); return;
    }
    const room = rooms.get(ROOM_ID);
    if (!room) { socket.emit('error', { message: 'Server error' }); return; }
    if (room.players.some(p => p.socketId === socket.id)) return;

    const cleanName = cleanNameOf(name) || `Player ${room.players.length + 1}`;
    const key = bankKey(cleanName);
    const buyInFor = () => {
      const prior = room.lastStacks[key] || 0;
      return Math.min(prior >= BIG_BLIND ? prior : (room.startChips || STARTING_CHIPS), getBalance(cleanName));
    };

    // Same name already at this table: take that seat back (refresh, dropped phone, second tab)
    const seat = room.players.find(p => !p.isBot && bankKey(p.name) === key);
    if (seat) {
      const wasHost = room.hostSocketId === seat.socketId;
      const oldSock = seat.connected ? io.sockets.sockets.get(seat.socketId) : null;
      if (!seat.connected) {
        const buyIn = buyInFor();
        if (buyIn < BIG_BLIND) { socket.emit('error', { message: 'Insufficient bank balance.' }); return; }
        adjustBank(seat.name, -buyIn, 'buyin', room, buyIn);
        delete room.lastStacks[key];
        seat.chips = buyIn;
        seat.connected = true;
        if (room.status === 'playing') seat.sittingOut = true;
        roomLog(room, `${seat.name} rejoined`);
      }
      if (oldSock) {
        oldSock.leave(ROOM_ID);
        oldSock.emit('error', { message: 'This seat was taken over by a newer connection' });
      }
      seat.socketId = socket.id;
      if (seat.profilePic === null) seat.profilePic = validatePic(profilePic);
      if (wasHost || !room.hostSocketId) room.hostSocketId = socket.id;
      socket.join(ROOM_ID);
      socket.emit('room_joined', { roomId: ROOM_ID, playerIdx: room.players.indexOf(seat), balance: getBalance(cleanName) });
      broadcastRoomUpdate(room);
      broadcastGameState(room);
      emitPrivateCards(room);
      maybeAutoStart(room);
      return;
    }

    if (room.players.length >= room.maxSeats) {
      socket.emit('error', { message: 'Table is full (max 8 players)' }); return;
    }
    const buyIn = buyInFor();
    if (buyIn < BIG_BLIND) { socket.emit('error', { message: 'Insufficient bank balance.' }); return; }
    delete room.lastStacks[key];

    const playerIdx = room.players.length;
    const player = makePlayer(socket.id, cleanName, avatar, buyIn);
    player.profilePic = validatePic(profilePic);
    adjustBank(cleanName, -buyIn, 'buyin', room, buyIn);
    // mid-hand joiners watch from the rail and are dealt in at the next hand (startHand clears this)
    if (room.status === 'playing' || room.status === 'waiting_next') player.sittingOut = true;
    room.players.push(player);
    if (!room.hostSocketId) room.hostSocketId = socket.id;

    socket.join(ROOM_ID);
    socket.emit('room_joined', { roomId: ROOM_ID, playerIdx, balance: getBalance(cleanName) });
    try { social.onJoin(socket, { players: room.players.filter(p => !p.isBot).length }); } catch {}
    broadcastRoomUpdate(room);
    broadcastGameState(room);
    maybeAutoStart(room);
  });

  // ── start_game ────────────────────────────────────────────────────────────
  on('start_game', ({ roomId, blindInterval } = {}) => {
    const room = rooms.get(roomId);
    if (!room)                               { socket.emit('error', { message: 'Room not found' }); return; }
    if (room.hostSocketId !== socket.id)     { socket.emit('error', { message: 'Only host can start' }); return; }
    if (room.players.length < 2)             { socket.emit('error', { message: 'Need 2+ players' }); return; }
    if (room.status === 'playing' || room.status === 'waiting_next') { socket.emit('error', { message: 'Game already started' }); return; }
    if (room.players.filter(p => p.connected && p.chips > 0 && !p.sitOutRequest).length < 2) {
      socket.emit('error', { message: 'Need 2+ players with chips to start' }); return;
    }

    beginGame(room, blindInterval);
  });

  // ── create_demo ───────────────────────────────────────────────────────────
  on('create_demo', ({ name, avatar, profilePic } = {}) => {
    let roomId;
    do { roomId = generateRoomId(); } while (rooms.has(roomId));

    const cleanName = cleanNameOf(name) || 'You';
    const buyIn  = Math.min(STARTING_CHIPS, getBalance(cleanName));
    if (buyIn < BIG_BLIND) { socket.emit('error', { message: 'Insufficient bank balance.' }); return; }
    const room  = makeRoom(roomId, socket.id);
    const human = makePlayer(socket.id, cleanName, avatar, buyIn);
    human.profilePic = validatePic(profilePic);
    adjustBank(cleanName, -buyIn, 'buyin', room, buyIn);
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
  on('player_action', ({ roomId, action, amount } = {}) => {
    const room = rooms.get(roomId);
    if (!room) { socket.emit('error', { message: 'Room not found' }); return; }
    if (room.status !== 'playing') { socket.emit('error', { message: 'No hand in progress' }); return; }
    if (room.paused) { socket.emit('error', { message: 'Table is paused' }); return; }
    const playerIdx = room.players.findIndex(p => p.socketId === socket.id);
    if (playerIdx === -1) return;
    if (room.actionQueue[0] !== playerIdx) { socket.emit('error', { message: "Not your turn" }); return; }

    const ok = processAction(room, playerIdx, action, amount);
    if (ok) { const hp = room.players[playerIdx]; if (hp) hp.timeouts = 0; }
    if (!ok) socket.emit('error', { message: room.lastReject || 'Invalid action' });
    if (ok) {
      broadcastGameState(room);
      emitPrivateCards(room);
      scheduleBotActionsIfNeeded(room);
      scheduleTurnTimeout(room);
    }
  });

  // ── preselect ─────────────────────────────────────────────────────────────
  on('preselect', ({ roomId, mode, kind, amount } = {}) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const playerIdx = room.players.findIndex(p => p.socketId === socket.id);
    if (playerIdx === -1) return;
    const m = mode === undefined ? kind : mode; // `kind` accepted as an alias
    let ok = false;
    if (m === null || m === 'none') ok = setPreselect(room, playerIdx, null, 0);
    else if (m === 'checkfold' || m === 'call') ok = setPreselect(room, playerIdx, m, typeof amount === 'number' ? amount : NaN);
    if (!ok) socket.emit('error', { message: 'Pre-select not available' });
    emitPrivateCards(room);
  });

  // ── rebuy ─────────────────────────────────────────────────────────────────
  on('rebuy', ({ roomId, tableId, amount } = {}) => {
    const room = rooms.get(roomId || tableId);
    if (!room) return;
    const playerIdx = room.players.findIndex(p => p.socketId === socket.id);
    if (playerIdx === -1) return;
    const player = room.players[playerIdx];
    if (player.chips > 0) { socket.emit('error', { message: 'You still have chips' }); return; }
    // all-in players of the live hand still hold cards and cannot rebuy yet
    if (room.status === 'playing' && player.cards.length > 0 && !player.sittingOut) {
      socket.emit('error', { message: 'Wait for the hand to finish' }); return;
    }
    if (!room.rebuysAllowed) { socket.emit('error', { message: 'Rebuys are off at this table', code: 'rebuy_off' }); return; }
    const pkey = player.acct || bankKey(player.name);
    if (room.rebuyLimit > 0 && (room.rebuyCounts[pkey] || 0) >= room.rebuyLimit) {
      socket.emit('error', { message: 'This table is out of rebuys', code: 'rebuy_off' }); return;
    }

    const t = room.settings, legacy = !room.nightId;
    const startChips = room.startChips || STARTING_CHIPS;
    const min = legacy ? BIG_BLIND : t.buyIn.min, max = legacy ? Math.max(t ? t.buyIn.max : STARTING_CHIPS, startChips) : t.buyIn.max;
    const balance = room.mode === 'chips' ? getBalance(player.name) : Infinity;
    let buyIn = amount;
    if (buyIn === undefined || buyIn === null) buyIn = Math.min(legacy ? startChips : t.buyIn.default, balance);
    if (!Number.isSafeInteger(buyIn) || buyIn < min || buyIn > max) {
      if (room.mode === 'chips' && balance < min) socket.emit('error', { message: 'Not enough chips in bank to rebuy', code: 'bank' });
      else socket.emit('error', { message: `Rebuy must be between ${min} and ${max}`, code: 'range' });
      return;
    }
    if (buyIn > balance) { socket.emit('error', { message: 'Not enough chips in bank to rebuy', code: 'bank' }); return; }

    const newBalance = payIn(room, player.name, buyIn, 'rebuy', { key: player.acct });
    room.rebuyCounts[pkey] = (room.rebuyCounts[pkey] || 0) + 1;
    player.chips     = buyIn;
    player.chipsBought = (player.chipsBought || 0) + buyIn;
    // no cards this hand: stay out until the next deal (startHand clears this)
    if (room.status === 'playing') player.sittingOut = true;
    if (room.mode === 'chips') socket.emit('balance_update', { balance: newBalance });
    broadcastGameState(room);
  });

  // ── drop_sticker ──────────────────────────────────────────────────────────
  on('drop_sticker', ({ roomId, emoji } = {}) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const sender = room.players.find(p => p.socketId === socket.id);
    if (!sender) return;
    try { social.onAction(socket, 'sticker'); } catch {}
    io.to(roomId).emit('sticker_dropped', { emoji: String(emoji || '').slice(0, 8), fromName: sender.name });
  });

  // ── emote ─────────────────────────────────────────────────────────────────
  const EMOTE_IDS = ['thumbs', 'laugh', 'mindblown', 'sweat', 'clap', 'tilt'];
  let lastEmoteAt = 0;
  on('emote', ({ roomId, id } = {}) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const idx = room.players.findIndex(p => p.socketId === socket.id);
    if (idx === -1) return;
    if (typeof id !== 'string' || !EMOTE_IDS.includes(id)) return;
    const now = Date.now();
    if (now - lastEmoteAt < 3000) return;
    lastEmoteAt = now;
    try { social.onAction(socket, 'sticker'); } catch {}
    io.to(roomId).emit('emote', { idx, id, name: room.players[idx].name });
  });

  // ── throw_item ────────────────────────────────────────────────────────────
  on('throw_item', ({ roomId, targetIdx, item } = {}) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const fromIdx = room.players.findIndex(p => p.socketId === socket.id);
    if (fromIdx === -1) return;
    if (typeof targetIdx !== 'number' || targetIdx < 0 || targetIdx >= room.players.length) return;
    if (targetIdx === fromIdx) return;
    const safe = String(item || '').slice(0, 8);
    try { social.onAction(socket, 'throw'); } catch {}
    io.to(roomId).emit('item_thrown', { fromIdx, targetIdx, item: safe, fromName: room.players[fromIdx].name });
  });

  // ── chat_message ──────────────────────────────────────────────────────────
  on('chat_message', ({ roomId, text } = {}) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const sender = room.players.find(p => p.socketId === socket.id);
    if (!sender) return;
    const safe = String(text || '').slice(0, 120).trim();
    if (!safe) return;
    io.to(roomId).emit('chat_message', { name: sender.name, text: safe });
  });

  // ── sit_out ────────────────────────────────────────────────────────────────
  on('sit_out', ({ roomId } = {}) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const player = room.players.find(p => p.socketId === socket.id);
    if (!player || player.chips === 0) return;
    player.sitOutRequest = !player.sitOutRequest;
    player.timeouts = 0;
    roomLog(room, player.sitOutRequest
      ? `${player.name} sitting out next hand`
      : `${player.name} is back in`);
    broadcastGameState(room);
    if (!player.sitOutRequest && room.sitterWait) {
      room.sitterWait = false;
      const ready = room.status === 'waiting' && !room.paused && !room.endNightPending
        && room.players.filter(p => p.connected && p.chips > 0 && !p.sitOutRequest).length >= 2;
      if (ready) beginGame(room, room.blindsEnabled ? room.blindIntervalMs : undefined);
    }
  });

  // ── disconnect ────────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    for (const room of rooms.values()) {
      const player = room.players.find(p => p.socketId === socket.id);
      if (!player) continue;
      dropSeat(room, player);
      break;
    }
  });
});

// Cash the stack out and remove or fold the seat. `leaving` = deliberate (table_leave/kick), frees the socket binding.
function dropSeat(room, player, opts = {}) {
  const playerIdx = room.players.indexOf(player);
  if (playerIdx === -1) return;
  const sid = player.socketId;

  // Cash out remaining chips before marking disconnected
  if (!player.isBot && player.chips > 0) {
    const c = player.chips;
    player.chips = 0;
    payOut(room, player.name, c, { key: player.acct, reason: opts.leaving ? 'leave' : 'disconnect', park: true });
    room.lastStacks[bankKey(player.name)] = c;
  }

  player.connected = false;
  if (opts.leaving) player.socketId = null;
  if (room.paused && room.id === ROOM_ID && !player.isBot && bankKey(player.name) === 'chris') setRoomPaused(room, false, 'Chris');
  roomLog(room, opts.leaving ? `${player.name} left the table` : `${player.name} disconnected`);
  if (room.hostSocketId === sid) {
    room.hostSocketId = room.players.find(p => p !== player && p.connected && !p.isBot)?.socketId || null;
  }

  if (room.status === 'playing') {
    if (room.actionQueue[0] === playerIdx) {
      processAction(room, playerIdx, 'fold', 0);
    } else {
      player.folded = true;
      room.actionQueue = room.actionQueue.filter(i => i !== playerIdx);
      const remaining = room.players.filter(p => !p.folded && !p.sittingOut && p.connected);
      if (remaining.length === 1) instantWin(room, remaining[0]);
      else if (remaining.length === 0) { clearHandTimers(room); room.status = 'waiting'; }
    }
    broadcastRoomUpdate(room);
    broadcastGameState(room);
    scheduleBotActionsIfNeeded(room);
    scheduleTurnTimeout(room);
  } else {
    room.players.splice(playerIdx, 1);
    if (room.players.length === 0) {
      clearHandTimers(room);
      if (room.blindTimer) { clearTimeout(room.blindTimer); room.blindTimer = null; }
      if (room.id === ROOM_ID) rooms.set(ROOM_ID, tables.attachLegacy(makeRoom(ROOM_ID, null)));
      else if (room.settings) { room.status = 'waiting'; room.dealerIdx = 0; room.hostSocketId = null; tables.onRoomEmptied(room); }
      else rooms.delete(room.id);
    } else {
      broadcastRoomUpdate(room);
      broadcastGameState(room);
    }
  }
  if (room.settings) tables.afterDrop(room, player);
}

// ─── Start Server ─────────────────────────────────────────────────────────────

const social = require('./social.js').createSocial({ io, accounts, now: () => Date.now(), file: BIGWINS_FILE });
process.env.WALLET_FILE = WALLET_FILE;
try{ const g = require('./games')({io, rooms, ledger, accounts, tables, social, now:()=>Date.now()}); social.setWallet(g.wallet); gameHooks = g; }catch(e){ if(e.code!=='MODULE_NOT_FOUND') throw e; }

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  server.listen(PORT, () => console.log(`Ping Poker server running on port ${PORT}`));
}

module.exports = { evaluate5, compareHands, bestHand, showdown, makeRoom, makePlayer, io, server };

// Return seated human stacks to the bank on deploy/shutdown so they are not lost
function shutdownCashOut() {
  for (const room of rooms.values()) {
    for (const p of room.players) {
      // an interrupted hand is void: chips already bet this hand go back too, so nothing vanishes with the pot
      const c = p.chips + (room.status === 'playing' && room.pot > 0 ? (p.handBet || 0) : 0);
      if (!p.isBot && c > 0) { p.chips = 0; payOut(room, p.name, c, { key: p.acct, reason: 'shutdown', park: true }); }
    }
  }
  tables.flush();
  accounts.flush();
  process.exit(0);
}
process.on('SIGTERM', shutdownCashOut);
process.on('SIGINT', shutdownCashOut);
