'use strict';
// Tables: settings, lobby, join/leave, host controls, nights and settle-up. The poker engine stays in server.js;
// each table is a room in the shared `rooms` map (table id === room id).
const fs = require('fs');
const { keyOf } = require('./accounts');

const MAX_SEATS = 8;                 // game.js lays out 8 sockets; seats 9 is accepted by validation but clamped here
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'.replace(/[IO]/g, '');
const LEGACY_ID = 'POKERPING';
const TIMERS = [0, 15, 30, 45, 60];
const MULTS = { standard: [1, 1.5, 2.5, 5, 7.5, 10, 15, 20], turbo: [1, 2, 4, 8, 16, 32, 64, 128] };
const MAX_UNITS = 100000000;
const EMPTY_MS = Number(process.env.TABLE_EMPTY_MS) || 30 * 60000;

const isInt = n => Number.isSafeInteger(n);
const normCode = c => String(c == null ? '' : c).toUpperCase().replace(/[^A-Z0-9]/g, '');

function defaultsFor(mode) {
  return mode === 'chips'
    ? { buyIn: { min: 500, max: 1000000, default: 2000 }, blinds: { sb: 25, bb: 50 } }
    : mode === 'play'
      ? { buyIn: { min: 500, max: 50000, default: 2000 }, blinds: { sb: 25, bb: 50 } }
      : { buyIn: { min: 500, max: 50000, default: 10000 }, blinds: { sb: 50, bb: 100 } };
}

// Validates a settings object (create form shape). Returns { ok, value } or { ok:false, message }.
function validateSettings(raw) {
  const bad = message => ({ ok: false, message });
  if (!raw || typeof raw !== 'object') return bad('Bad table settings');
  const mode = raw.mode === undefined ? 'play' : raw.mode;
  if (!['chips', 'play'].includes(mode)) return bad('Mode must be chips or play');
  const unit = mode === 'chips' ? 'chips' : 'cents';
  if (raw.unit !== undefined && raw.unit !== unit) return bad(`Mode ${mode} uses unit ${unit}`);
  const name = typeof raw.name === 'string' ? raw.name.replace(/[\u0000-\u001f<>]/g, '').trim().replace(/\s+/g, ' ') : '';
  if (name.length < 2 || name.length > 24) return bad('Table name must be 2-24 characters');
  const d = defaultsFor(mode);
  const bi = raw.buyIn === undefined ? d.buyIn : raw.buyIn;
  const bl = raw.blinds === undefined ? d.blinds : raw.blinds;
  if (!bi || typeof bi !== 'object' || !bl || typeof bl !== 'object') return bad('Bad buy-in or blinds');
  const buyIn = { min: bi.min, max: bi.max, default: bi.default === undefined ? Math.max(bi.min, Math.min(bi.max, d.buyIn.default)) : bi.default };
  for (const k of ['min', 'max', 'default']) if (!isInt(buyIn[k]) || buyIn[k] < 1 || buyIn[k] > MAX_UNITS) return bad(`Buy-in ${k} must be a whole number`);
  if (buyIn.min > buyIn.max) return bad('Minimum buy-in is above the maximum');
  if (buyIn.default < buyIn.min || buyIn.default > buyIn.max) return bad('Default buy-in must be between min and max');
  const blinds = { sb: bl.sb, bb: bl.bb };
  if (!isInt(blinds.sb) || !isInt(blinds.bb) || blinds.sb < 1 || blinds.bb < 2 || blinds.sb >= blinds.bb) return bad('Blinds must be whole numbers with small < big');
  const seats = raw.seats === undefined ? 8 : raw.seats;
  if (!isInt(seats) || seats < 2 || seats > 9) return bad('Seats must be 2 to 9');
  const timer = raw.actionTimerSec === undefined ? 30 : raw.actionTimerSec;
  if (!TIMERS.includes(timer)) return bad('Action timer must be 0, 15, 30, 45 or 60 seconds');
  const bool = (v, def) => (v === undefined ? def : v);
  const rebuys = bool(raw.rebuys, true), isPrivate = bool(raw.isPrivate, true), autoStart = bool(raw.autoStart, true);
  if (typeof rebuys !== 'boolean' || typeof isPrivate !== 'boolean' || typeof autoStart !== 'boolean') return bad('Bad option');
  const rebuyLimit = raw.rebuyLimit === undefined ? 0 : raw.rebuyLimit;
  if (!isInt(rebuyLimit) || rebuyLimit < 0 || rebuyLimit > 99) return bad('Bad rebuy limit');
  const bin = raw.blindIncrease === undefined ? {} : raw.blindIncrease;
  if (!bin || typeof bin !== 'object') return bad('Bad blind increase');
  const blindIncrease = { enabled: !!bin.enabled, everyMin: bin.everyMin === undefined ? 15 : bin.everyMin, schedule: bin.schedule === undefined ? 'standard' : bin.schedule };
  if (![10, 15, 20, 30].includes(blindIncrease.everyMin) || !MULTS[blindIncrease.schedule]) return bad('Bad blind increase');
  return { ok: true, value: { name, mode, unit, buyIn, blinds, blindIncrease, seats: Math.min(seats, MAX_SEATS), actionTimerSec: timer, rebuys, rebuyLimit, isPrivate, autoStart } };
}

function genSchedule(sb, bb, kind) {
  const nice = v => Math.max(5, Math.round(v / 5) * 5);
  const out = [{ sb, bb }];
  const ratio = sb / bb;
  for (const m of MULTS[kind].slice(1)) {
    const prev = out[out.length - 1];
    const nb = Math.max(prev.bb + 1, nice(bb * m));
    const ns = Math.min(nb - 1, Math.max(1, Math.round(nb * ratio)));
    out.push({ sb: ns, bb: nb });
  }
  return out;
}

function fmtUnits(n, unit, signed) {
  const sign = n < 0 ? '-' : (signed && n > 0 ? '+' : '');
  const a = Math.abs(n);
  if (unit === 'chips') return sign + a.toLocaleString('en-US');
  return sign + '$' + (a / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function createTables(E) {
  const { io, rooms, ledger, accounts } = E;
  const tables = new Map();                 // id -> table object (settings + id/hostKey/state/nightId/createdAt)
  const playRows = new Map();               // nightId -> rows (Play $ nights are never written to the ledger)
  const file = E.file;
  let saveTimer = null, savedLegacyBlinds = null;

  function writeNow() {
    try {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, tables: [...tables.values()].filter(t => t.id !== LEGACY_ID), legacyBlinds: tables.get(LEGACY_ID) ? tables.get(LEGACY_ID).blinds : savedLegacyBlinds }));
      fs.renameSync(tmp, file);
    } catch (e) { console.error('tables save failed:', e.message); }
  }
  function save() { if (saveTimer) return; saveTimer = setTimeout(() => { saveTimer = null; writeNow(); }, 100); if (saveTimer.unref) saveTimer.unref(); }
  function flush() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; } writeNow(); }

  // ── helpers ───────────────────────────────────────────────────────────────
  const lookup = id => tables.get(normCode(id)) || null;
  const roomOf = t => rooms.get(t.id) || null;
  const seatOf = (room, key) => room && room.players.find(p => !p.isBot && (p.acct === key || (!p.acct && E.bankKey(p.name) === key)));
  const humans = room => (room ? room.players.filter(p => !p.isBot) : []);
  const canHost = (t, key) => key === t.hostKey || accounts.isAdmin(key);
  const dispOf = key => accounts.displayOf(key);
  const usd = n => '$' + (n % 100 ? (n / 100).toFixed(2) : (n / 100).toLocaleString('en-US'));
  const nowStr = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');

  function genId() {
    for (;;) {
      let id = '';
      for (let i = 0; i < 6; i++) id += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!tables.has(id) && !rooms.has(id)) return id;
    }
  }

  function applyToRoom(room, t) {
    room.settings = t;
    room.mode = t.mode;
    room.unit = t.unit;
    room.moneyMode = t.mode;
    room.maxSeats = t.seats;
    room.turnMs = t.actionTimerSec * 1000;
    room.rebuysAllowed = t.rebuys;
    room.rebuyLimit = t.rebuyLimit;
    room.nightId = t.nightId;
    room.autoStart = t.autoStart;
    room.keepStacks = t.id !== LEGACY_ID;
    room.blindSchedule = t.blindIncrease.enabled ? genSchedule(t.blinds.sb, t.blinds.bb, t.blindIncrease.schedule) : genSchedule(t.blinds.sb, t.blinds.bb, 'standard');
    room.startBlindInterval = t.blindIncrease.enabled ? t.blindIncrease.everyMin * 60000 : 0;
    return room;
  }

  function buildTable(value, hostKey, id) {
    const tid = id || genId();
    return { id: tid, ...value, hostKey, state: 'open', nightId: `n_${nowStr()}_${tid}`, createdAt: Date.now() };
  }

  function addTable(t) {
    t.emptySince = Date.now();
    tables.set(t.id, t);
    const room = applyToRoom(E.makeRoom(t.id, null), t);
    room.sb = t.blinds.sb; room.bb = t.blinds.bb;
    rooms.set(t.id, room);
    save(); pushLobby();
    return room;
  }

  const LEGACY = () => buildTable({
    name: 'The Ping', mode: 'chips', unit: 'chips', buyIn: { min: 500, max: 1000000, default: 2000 }, blinds: { sb: 25, bb: 50 },
    blindIncrease: { enabled: false, everyMin: 15, schedule: 'standard' }, seats: MAX_SEATS, actionTimerSec: 30, rebuys: true, rebuyLimit: 0, isPrivate: false, autoStart: true,
  }, 'chris', LEGACY_ID);

  // The permanent chips table. Called at boot and whenever the empty legacy room is re-made.
  function attachLegacy(room) {
    let t = tables.get(LEGACY_ID);
    if (!t) { t = LEGACY(); t.nightId = null; if (savedLegacyBlinds) t.blinds = { ...savedLegacyBlinds }; tables.set(LEGACY_ID, t); }
    applyToRoom(room, t);
    room.sb = t.blinds.sb; room.bb = t.blinds.bb;
    room.autoStart = true;
    room.keepStacks = false;
    room.blindSchedule = null;
    room.startBlindInterval = 0;
    return room;
  }

  // ── payloads ──────────────────────────────────────────────────────────────
  function card(t) {
    const room = roomOf(t);
    return {
      id: t.id, name: t.name, mode: t.mode, unit: t.unit, sb: room ? room.sb : t.blinds.sb, bb: room ? room.bb : t.blinds.bb,
      buyIn: { min: t.buyIn.min, max: t.buyIn.max }, seats: t.seats, seated: humans(room).filter(p => p.connected).length,
      host: { key: t.hostKey, display: dispOf(t.hostKey) }, state: t.state, isPrivate: t.isPrivate,
    };
  }
  function publicTable(t) {
    const room = roomOf(t);
    return { ...t, sb: room ? room.sb : t.blinds.sb, bb: room ? room.bb : t.blinds.bb, host: { key: t.hostKey, display: dispOf(t.hostKey) }, moneyMode: t.mode };
  }
  function seatedList(t) {
    return humans(roomOf(t)).filter(p => p.connected).map(p => ({ key: p.acct || E.bankKey(p.name), display: p.name, avatar: p.avatarId || null, pic: p.acct ? accounts.picUrl(accounts.get(p.acct)) : null, stack: p.chips }));
  }

  // Name, preset and picture on a seat always mirror the account (rename / avatar change / re-seat).
  function applySeat(player, acct) {
    player.name = acct.display;
    player.avatar = E.AV_EMOJI[Number(String(acct.avatar).slice(1)) - 1] || '🃏';
    player.avatarId = acct.avatar;
    player.profilePic = accounts.picUrl(acct);
  }
  function syncAccount(key) {
    const acct = accounts.get(key);
    if (!acct) return;
    for (const t of tables.values()) {
      const room = roomOf(t);
      const p = room && room.players.find(x => !x.isBot && x.acct === key);
      if (!p) continue;
      applySeat(p, acct);
      E.broadcastRoomUpdate(room); E.broadcastGameState(room);
    }
    pushLobby();
  }

  // ── nights ────────────────────────────────────────────────────────────────
  const playExtra = [];                     // hand snapshots + wins for the Play $ bank charts (memory only)
  function playEntries() {
    const all = [...playExtra];
    for (const rows of playRows.values()) all.push(...rows);
    return all.sort((a, b) => a.t - b.t);
  }
  function noteRow(room, row) {
    if (room.mode !== 'play' || !room.nightId) return;
    if (row.type === 'snapshot' || row.type === 'win') {
      playExtra.push({ t: Date.now(), room: room.id, tableId: room.id, nightId: room.nightId, mode: 'cents', ...row });
      if (playExtra.length > 20000) playExtra.splice(0, playExtra.length - 20000);
      return;
    }
    const rows = playRows.get(room.nightId) || [];
    rows.push({ t: Date.now(), room: room.id, tableId: room.id, nightId: room.nightId, mode: 'cents', ...row });
    playRows.set(room.nightId, rows);
  }
  const nightOf = t => (t.mode === 'play' ? ledger.nightFromRows(playRows.get(t.nightId) || [], t.nightId) : ledger.nightSummary(t.nightId));

  function nightPayload(t) {
    const n = nightOf(t);
    const players = n.players.map(p => ({ key: p.key, display: accounts.get(p.key) ? dispOf(p.key) : p.display, avatar: accounts.get(p.key) ? accounts.get(p.key).avatar : null, pic: accounts.get(p.key) ? accounts.picUrl(accounts.get(p.key)) : null, buyIns: p.buyIns, rebuys: p.rebuys, cashedOut: p.cashedOut, net: p.net }));
    const d = new Date(n.endedAt || Date.now());
    const lines = [`The Ping - ${t.name} - ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`];
    for (const p of players) lines.push(`${p.display} ${fmtUnits(p.net, t.unit, true)}`);
    const out = { nightId: t.nightId, tableId: t.id, table: { name: t.name, mode: t.mode, unit: t.unit }, ended: t.state === 'ended', startedAt: n.startedAt, endedAt: n.endedAt, players, zeroSum: n.zeroSum, text: lines.join('\n') };
    if (n.drift) out.drift = n.drift;
    return out;
  }
  function participants(t) {
    const set = new Set([t.hostKey]);
    for (const p of nightOf(t).players) set.add(p.key);
    for (const p of humans(roomOf(t))) if (p.acct) set.add(p.acct);
    return set;
  }
  function emitToParticipants(t, ev, payload) {
    const set = participants(t);
    for (const s of io.sockets.sockets.values()) if (s.data && s.data.acct && set.has(s.data.acct)) s.emit(ev, payload);
  }
  const isParticipant = (t, key) => canHost(t, key) || participants(t).has(key);

  function netTonight(t, key) {
    const me = nightOf(t).players.find(p => p.key === key);
    const room = roomOf(t);
    const seat = seatOf(room, key);
    return (me ? me.net : 0) + (seat ? seat.chips : 0);
  }

  function finishNight(room, reason) {
    const t = room.settings;
    if (!t || t.state === 'ended') return;
    E.clearHandTimers(room);
    for (const k of ['blindTimer', 'autoStartTimer']) if (room[k]) { clearTimeout(room[k]); room[k] = null; }
    for (const p of room.players) {
      if (p.isBot || !(p.chips > 0)) continue;
      const c = p.chips; p.chips = 0;
      E.payOut(room, p.name, c, { reason, key: p.acct || E.bankKey(p.name) });
    }
    const meta = { mode: t.unit, tableId: t.id, nightId: t.nightId, tableName: t.name, reason };
    if (t.mode === 'play') noteRow(room, { type: 'night-end', tableName: t.name, reason });
    else ledger.log('night-end', null, 0, null, null, room.handNum, t.id, meta);
    t.state = 'ended';
    room.status = 'ended';
    for (const p of room.players) { const s = p.socketId && io.sockets.sockets.get(p.socketId); if (s) s.leave(t.id); }
    room.players = [];
    rooms.delete(t.id);
    if (reason !== 'shutdown') {
      if (t.mode !== 'play') for (const p of nightOf(t).players) accounts.recordNight(p.key, { mode: t.unit === 'chips' ? 'chips' : 'cents', net: p.net });
      emitToParticipants(t, 'settle_up', nightPayload(t));
    }
    save(); pushLobby();
  }

  // ── lobby ─────────────────────────────────────────────────────────────────
  const mine = (t, key) => t.hostKey === key || !!seatOf(roomOf(t), key);
  function listFor(key) {
    return [...tables.values()].filter(t => t.state !== 'ended' && (!t.isPrivate || mine(t, key))).map(card);
  }
  function mineFor(key) {
    const list = [...tables.values()].filter(t => t.state !== 'ended' && t.id !== LEGACY_ID || (t.id === LEGACY_ID && seatOf(roomOf(t), key)));
    const out = [], nightNet = {};
    for (const t of list) {
      const part = t.hostKey === key || seatOf(roomOf(t), key) || nightOf(t).players.some(p => p.key === key);
      if (!part) continue;
      out.push(card(t));
      nightNet[t.id] = netTonight(t, key);
    }
    return { tables: out, nightNet };
  }
  let lobbyTimer = null;
  function pushLobby() {
    if (lobbyTimer) return;
    lobbyTimer = setTimeout(() => {
      lobbyTimer = null;
      const sockets = io.sockets.adapter.rooms.get('lobby');
      if (!sockets) return;
      for (const sid of sockets) { const s = io.sockets.sockets.get(sid); if (s && s.data.acct) s.emit('lobby_tables', { tables: listFor(s.data.acct) }); }
    }, 200);
    if (lobbyTimer.unref) lobbyTimer.unref();
  }

  // ── host helpers ──────────────────────────────────────────────────────────
  function event(t, kind, extra) { io.to(t.id).emit('table_event', { tableId: t.id, kind, ...extra }); }

  function setHostSocket(t) {
    const room = roomOf(t);
    if (!room) return;
    const h = seatOf(room, t.hostKey);
    room.hostSocketId = h && h.connected ? h.socketId : null;
  }
  function transferHost(t) {
    const room = roomOf(t);
    if (!room || t.id === LEGACY_ID) return;
    const cur = seatOf(room, t.hostKey);
    if (cur && cur.connected) return;
    const next = room.players.find(p => !p.isBot && p.connected && p.acct && p.acct !== t.hostKey);
    if (!next) return;
    t.hostKey = next.acct;
    room.hostSocketId = next.socketId;
    E.roomLog(room, `${next.name} is now the host`);
    event(t, 'host', { key: next.acct, display: next.name });
    save();
  }
  function afterDrop(room, player) {
    const t = room.settings;
    if (!t) return;
    if (player.acct && player.acct === t.hostKey) { const tm = setTimeout(() => transferHost(t), Number(process.env.HOST_GRACE_MS) || 20000); if (tm.unref) tm.unref(); }
    if (!humans(room).some(p => p.connected)) t.emptySince = Date.now();
    pushLobby();
  }
  function onRoomEmptied(room) { if (room.settings) { room.settings.emptySince = Date.now(); room.status = 'waiting'; pushLobby(); } }

  // ── socket handlers ───────────────────────────────────────────────────────
  function register(socket, on, authed) {
    const err = (message, code) => socket.emit('error', code ? { message, code } : { message });
    const tableFor = (id, key) => {
      const t = lookup(id);
      if (!t) { err('No table with that code'); return null; }
      return t;
    };
    const hostFor = id => {
      const key = authed(); if (!key) return {};
      const t = tableFor(id); if (!t) return {};
      if (!canHost(t, key)) { err('Only the host can do that', 'not_host'); return {}; }
      return { key, t, room: roomOf(t) };
    };

    on('lobby_list', () => {
      const key = authed(); if (!key) return;
      socket.join('lobby');
      socket.emit('lobby_tables', { tables: listFor(key) });
    });
    on('tables_mine', () => {
      const key = authed(); if (!key) return;
      socket.emit('tables_mine', mineFor(key));
    });

    on('table_create', ({ settings } = {}) => {
      const key = authed(); if (!key) return;
      const v = validateSettings(settings);
      if (!v.ok) { err(v.message, 'range'); return; }
      if ([...tables.values()].filter(t => t.hostKey === key && t.state !== 'ended' && t.id !== LEGACY_ID).length >= 5) { err('You already host 5 open tables'); return; }
      const t = buildTable(v.value, key);
      addTable(t);
      socket.emit('table_created', { table: publicTable(t) });
    });

    on('table_preview', ({ code } = {}) => {
      const key = authed(); if (!key) return;
      const t = lookup(code);
      if (!t) { err('No table with that code'); return; }
      socket.emit('table_info', { table: publicTable(t), seated: seatedList(t), openSeats: Math.max(0, t.seats - humans(roomOf(t)).length) });
    });

    on('table_join', ({ tableId, buyIn, seat, fund: reqFund } = {}) => {
      const key = authed(); if (!key) return;
      const t = lookup(tableId);
      if (!t) { err('No table with that code'); return; }
      if (t.state === 'ended') { err('This table has ended'); return; }
      const room = roomOf(t);
      if (!room) { err('This table is not available'); return; }
      const acct = accounts.get(key);
      const existing = seatOf(room, key);

      // Same account already seated and connected: rebind the socket, keep the stack
      if (existing && existing.connected) {
        const oldSock = existing.socketId !== socket.id ? io.sockets.sockets.get(existing.socketId) : null;
        if (oldSock) { oldSock.leave(t.id); oldSock.emit('error', { message: 'This seat was taken over by a newer connection' }); }
        const wasHost = room.hostSocketId === existing.socketId;
        existing.socketId = socket.id;
        existing.acct = key;
        applySeat(existing, acct);
        if (wasHost || t.hostKey === key) room.hostSocketId = socket.id;
        socket.join(t.id);
        socket.emit('table_joined', { tableId: t.id, playerIdx: room.players.indexOf(existing), stack: existing.chips, table: publicTable(t), you: { key, display: acct.display } });
        E.broadcastRoomUpdate(room); E.broadcastGameState(room); E.emitPrivateCards(room);
        return;
      }

      const prior = room.lastStacks[key];
      let amount = buyIn === undefined || buyIn === null ? (prior >= t.buyIn.min ? Math.min(prior, t.buyIn.max) : t.buyIn.default) : buyIn;
      if (!isInt(amount) || amount < t.buyIn.min || amount > t.buyIn.max) { err(`Buy-in must be between ${usd(t.buyIn.min)} and ${usd(t.buyIn.max)}`, 'range'); return; }
      if (!existing && humans(room).length + room.players.filter(p => p.isBot).length >= room.maxSeats) { err('Table is full', 'full'); return; }
      const fund = reqFund === 'chips' || reqFund === 'play' ? reqFund : t.mode;
      if (fund === 'chips' && E.getBalance(acct.display) < amount) { err('Not enough in your bank', 'bank'); return; }
      if (fund === 'play' && E.getPlay(key) < amount) { err('Not enough Play $', 'bank'); return; }

      let player = existing;
      if (player) {
        E.payIn(room, player.name, amount, 'buyin', { key, fund });
        player.fund = fund;
        delete room.lastStacks[key];
        applySeat(player, acct);
        player.chips = amount; player.chipsBought = amount; player.connected = true; player.socketId = socket.id;
        if (room.status === 'playing') player.sittingOut = true;
        E.roomLog(room, `${player.name} rejoined`);
      } else {
        player = E.makePlayer(socket.id, acct.display, E.AV_EMOJI[Number(String(acct.avatar).slice(1)) - 1] || '🃏', amount);
        player.acct = key; applySeat(player, acct);
        E.payIn(room, acct.display, amount, 'buyin', { key, fund });
        player.fund = fund;
        delete room.lastStacks[key];
        if (room.status === 'playing' || room.status === 'waiting_next') player.sittingOut = true;
        room.players.push(player);
      }
      room.rebuyCounts = room.rebuyCounts || {};
      if (!room.hostSocketId && t.hostKey === key) room.hostSocketId = socket.id;
      if (t.hostKey === key) room.hostSocketId = socket.id;
      t.emptySince = null;
      socket.join(t.id);
      socket.emit('table_joined', { tableId: t.id, playerIdx: room.players.indexOf(player), stack: player.chips, table: publicTable(t), you: { key, display: acct.display } });
      E.roomLog(room, `${player.name} sat down`);
      E.broadcastRoomUpdate(room); E.broadcastGameState(room);
      E.maybeAutoStart(room);
      pushLobby();
    });

    on('table_leave', ({ tableId } = {}) => {
      const key = authed(); if (!key) return;
      const t = lookup(tableId);
      if (!t) { err('No table with that code'); return; }
      const room = roomOf(t);
      const seat = seatOf(room, key);
      if (!seat || !seat.connected) { socket.emit('table_left', { tableId: t.id, cashedOut: 0 }); return; }
      const stack = seat.chips;
      E.dropSeat(room, seat, { leaving: true });
      socket.leave(t.id);
      socket.emit('table_left', { tableId: t.id, cashedOut: stack });
    });

    on('table_start', ({ tableId } = {}) => {
      const { t, room } = hostFor(tableId); if (!t) return;
      if (t.state === 'ended' || !room) { err('This table has ended'); return; }
      if (room.paused) { err('Table is paused', 'paused'); return; }
      if (room.status === 'playing' || room.status === 'waiting_next') { err('Game already started'); return; }
      if (room.players.filter(p => p.connected && p.chips > 0 && !p.sitOutRequest).length < 2) { err('Need 2+ players with chips to start'); return; }
      E.beginGame(room, room.startBlindInterval);
      event(t, 'started', {});
    });

    on('table_pause', ({ tableId, paused } = {}) => {
      const { key, t, room } = hostFor(tableId); if (!t) return;
      if (t.state === 'ended' || !room) { err('This table has ended'); return; }
      const p = paused !== false;
      E.setPaused(room, p, dispOf(key));
      event(t, p ? 'paused' : 'resumed', { paused: p, by: dispOf(key) });
      E.broadcastGameState(room);
      save(); pushLobby();
    });

    on('table_kick', ({ tableId, key: target } = {}) => {
      const { t, room } = hostFor(tableId); if (!t) return;
      const k = keyOf(target);
      const seat = seatOf(room, k);
      if (!seat || !seat.connected) { err('That player is not seated'); return; }
      if (k === t.hostKey) { err('The host cannot be kicked'); return; }
      const sid = seat.socketId, stack = seat.chips;
      E.dropSeat(room, seat, { leaving: true });
      const s = sid && io.sockets.sockets.get(sid);
      if (s) { s.leave(t.id); s.emit('table_left', { tableId: t.id, cashedOut: stack, reason: 'kicked' }); }
      event(t, 'kicked', { key: k, display: dispOf(k) });
    });

    on('table_update', ({ tableId, patch } = {}) => {
      const { key, t, room } = hostFor(tableId); if (!t) return;
      if (t.state === 'ended' || !room) { err('This table has ended'); return; }
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) { err('Nothing to update'); return; }
      const allowed = ['name', 'blinds', 'actionTimerSec', 'rebuys', 'rebuyLimit', 'isPrivate', 'blindIncrease', 'autoStart', 'buyIn'];
      for (const k of Object.keys(patch)) {
        if (!allowed.includes(k)) { err(`Cannot change ${k}`); return; }
        if (k === 'buyIn' && room.handNum > 0) { err('Buy-in limits are locked once a hand has been dealt'); return; }
      }
      const blindsOnly = Object.keys(patch).every(k => k === 'blinds');
      if (room.status === 'playing' && !room.paused && !blindsOnly) { err('Change settings between hands', 'paused'); return; }
      const v = validateSettings({ ...t, ...patch });
      if (!v.ok) { err(v.message, 'range'); return; }
      if (blindsOnly && (room.status === 'playing' || room.status === 'waiting_next')) {
        t.blinds = v.value.blinds; room.pendingBlinds = { sb: t.blinds.sb, bb: t.blinds.bb };
        const legacy = t.id === LEGACY_ID;
        applyToRoom(room, t);
        if (legacy) { room.autoStart = true; room.keepStacks = false; room.blindSchedule = null; room.startBlindInterval = 0; }
        room.blindLevel = 0;
        E.roomLog(room, `${dispOf(key)} changed the blinds, starting next hand`);
        save(); pushLobby(); E.broadcastGameState(room);
        event(t, 'updated', { table: publicTable(t), pendingBlinds: room.pendingBlinds });
        return;
      }
      for (const k of Object.keys(patch)) t[k] = v.value[k];
      const prevSb = room.sb, prevBb = room.bb;
      applyToRoom(room, t);
      if (t.id === LEGACY_ID) { room.autoStart = true; room.keepStacks = false; room.blindSchedule = null; room.startBlindInterval = 0; }
      room.pendingBlinds = null;
      if (patch.blinds || patch.blindIncrease) {
        if (room.blindTimer) { clearTimeout(room.blindTimer); room.blindTimer = null; }
        room.blindLevel = 0; room.sb = t.blinds.sb; room.bb = t.blinds.bb;
        if (t.blindIncrease.enabled && room.status !== 'waiting') {
          room.blindsEnabled = true; room.blindIntervalMs = room.startBlindInterval; room.blindLevelStartAt = Date.now(); E.scheduleBlindIncrease(room);
        } else { room.blindsEnabled = false; room.blindIntervalMs = 0; }
      } else { room.sb = prevSb; room.bb = prevBb; }
      save(); pushLobby();
      E.broadcastGameState(room);
      event(t, 'updated', { table: publicTable(t) });
    });

    on('table_end_night', ({ tableId } = {}) => {
      const { key, t, room } = hostFor(tableId); if (!t) return;
      if (t.id === LEGACY_ID) { err('The Ping is a permanent table'); return; }
      if (t.state === 'ended' || !room) { err('This table has ended'); return; }
      if (room.status === 'playing' || room.status === 'waiting_next') {
        room.endNightPending = true;
        E.roomLog(room, `${dispOf(key)} is ending the night after this hand`);
        event(t, 'ending', { by: dispOf(key) });
        E.broadcastGameState(room);
        return;
      }
      finishNight(room, 'host');
    });

    on('table_clone', ({ tableId } = {}) => {
      const key = authed(); if (!key) return;
      const t = lookup(tableId);
      if (!t) { err('No table with that code'); return; }
      if (!isParticipant(t, key)) { err('Only people from that night can clone it', 'not_host'); return; }
      const v = validateSettings(t);
      if (!v.ok) { err(v.message, 'range'); return; }
      const n = buildTable(v.value, key);
      addTable(n);
      socket.emit('table_created', { table: publicTable(n) });
    });

    const nightTable = nightId => [...tables.values()].find(t => t.nightId === nightId) || null;
    on('night_get', ({ nightId } = {}) => {
      const key = authed(); if (!key) return;
      const t = nightTable(String(nightId || ''));
      if (!t || !isParticipant(t, key)) { err('No such night'); return; }
      socket.emit('settle_up', nightPayload(t));
    });
  }

  // ── boot ──────────────────────────────────────────────────────────────────
  function load() {
    let j = null;
    try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { j = null; }
    const cutoff = Date.now() - 14 * 86400000;
    const lb = j && j.legacyBlinds;
    if (lb && Number.isInteger(lb.sb) && Number.isInteger(lb.bb) && lb.sb >= 1 && lb.sb < lb.bb) {
      savedLegacyBlinds = { sb: lb.sb, bb: lb.bb };
      const lt = tables.get(LEGACY_ID), lr = rooms.get(LEGACY_ID);
      if (lt) lt.blinds = { ...savedLegacyBlinds };
      if (lr && lr.status !== 'playing') { lr.sb = lb.sb; lr.bb = lb.bb; }
    }
    for (const t of (j && Array.isArray(j.tables) ? j.tables : [])) {
      if (!t || !t.id || tables.has(t.id) || t.id === LEGACY_ID) continue;
      if (t.state === 'ended') { if ((t.createdAt || 0) > cutoff) tables.set(t.id, t); continue; }
      if (t.mode === 'friends') continue; // Friends $ tables were removed; a live one cannot resume
      t.emptySince = Date.now();
      tables.set(t.id, t);
      const room = applyToRoom(E.makeRoom(t.id, null), t);
      room.sb = t.blinds.sb; room.bb = t.blinds.bb;
      room.paused = t.state === 'paused';
      rooms.set(t.id, room);
    }
  }

  const sweep = setInterval(() => {
    for (const t of [...tables.values()]) {
      if (t.id === LEGACY_ID || t.state === 'ended') continue;
      const room = roomOf(t);
      if (humans(room).some(p => p.connected)) { t.emptySince = null; continue; }
      if (t.emptySince && Date.now() - t.emptySince > EMPTY_MS) {
        if (room) { finishNight(room, 'idle'); }
        if (!nightOf(t).players.length) tables.delete(t.id);
        save(); pushLobby();
      }
    }
  }, Math.min(60000, EMPTY_MS));
  sweep.unref();

  return { syncAccount, register, load, flush, attachLegacy, afterDrop, onRoomEmptied, finishNight, noteRow, playEntries, card, publicTable, tables, lookup, genSchedule, setHostSocket, pushLobby, LEGACY_ID };
}

module.exports = { createTables, validateSettings, genSchedule, fmtUnits, MAX_SEATS };
