'use strict';
// The set of tables: create/close, POKERPING bootstrap, tables.json load + debounced save, lobby cards, one seat per account,
// night summaries (from the money ledger, not the presentation log), idle sweep, void-all / pause-all for the safety wrapper.
// No sockets: events leave through deps.out (wrapped so every change marks the registry dirty and asks for a lobby push).
// Contract sections 1, 2, 5.

const fs = require('fs');
const { Table } = require('./table');
const { validateSettings, defaultsFor } = require('./settings');
const { TableError } = require('./errors');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';         // no I, O, 0, 1
const PERMANENT_ID = 'POKERPING';
const MAX_OPEN_PER_HOST = 5;
const ENDED_KEEP_MS = 14 * 86400000;
const PERSIST = ['id', 'name', 'mode', 'unit', 'buyIn', 'blinds', 'blindIncrease', 'actionTimerSec', 'rebuys', 'rebuyLimit', 'isPrivate', 'autoStart', 'look',
  'hostKey', 'state', 'permanent', 'nightId', 'nightFromId', 'nightHand0', 'createdAt', 'blindStartAt', 'endedAt'];

const pad = n => String(n).padStart(2, '0');
const ymd = ms => { const d = new Date(ms); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`; };

function fmtUnits(n, unit, signed) {
  const sign = n < 0 ? '-' : (signed && n > 0 ? '+' : '');
  const a = Math.abs(n);
  if (unit === 'chips') return sign + a.toLocaleString('en-US');
  return sign + '$' + (a / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function createRegistry(deps) {
  const { money, service, ledger, clock, file } = deps;
  const hooks = deps.hooks || {};
  const tables = new Map();
  const EMPTY_MS = Number(process.env.TABLE_EMPTY_MS) > 0 ? Number(process.env.TABLE_EMPTY_MS) : 30 * 60000;
  let saveHandle = null, lobbyHandle = null, sweepHandle = null;

  const profileOf = key => (hooks.profileOf ? hooks.profileOf(key) : null) || { display: key, avatar: null, pic: null };
  const isAdmin = key => !!(hooks.isAdmin && hooks.isAdmin(key));

  // ---- persistence ----------------------------------------------------------------------------------------------
  function recOf(t) {
    const r = {};
    for (const k of PERSIST) if (t[k] !== undefined) r[k] = t[k];
    r.seats = t.maxSeats;
    return r;
  }
  function writeNow() {
    if (!file) return;
    try {
      const pp = tables.get(PERMANENT_ID);
      const body = { version: 1, tables: [...tables.values()].filter(t => !t.permanent).map(recOf), legacyBlinds: pp ? { ...pp.blinds } : (registry.savedLegacyBlinds || null) };
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(body));
      fs.renameSync(tmp, file);
    } catch (e) { console.error('[v2] tables save failed:', e.message); }
  }
  function save() { if (saveHandle || !file) return; saveHandle = clock.setTimeout(() => { saveHandle = null; writeNow(); }, 100); if (saveHandle && saveHandle.unref) saveHandle.unref(); }
  function flush() { if (saveHandle) { clock.clearTimeout(saveHandle); saveHandle = null; } writeNow(); }
  function pushLobby() {
    if (lobbyHandle || !deps.onLobby) return;
    lobbyHandle = clock.setTimeout(() => { lobbyHandle = null; try { deps.onLobby(); } catch (e) { console.error('[v2] lobby push failed:', e.message); } }, 200);
    if (lobbyHandle && lobbyHandle.unref) lobbyHandle.unref();
  }

  // Every Table talks through this: transport's out first, the presentation log second, then save + lobby.
  const out = {
    state(t) { try { if (deps.out) deps.out.state(t); } finally { pushLobby(); } },
    event(t, kind, data, toKey) {
      try { if (deps.out) deps.out.event(t, kind, data, toKey); } finally {
        if (deps.viewlog) { try { deps.viewlog.onEvent(t, kind, data); } catch (e) { console.error('[v2] viewlog:', kind, e && e.message); } }
        if (kind !== 'money') { save(); pushLobby(); }
      }
    },
  };

  function build(rec) {
    let t = null;
    t = new Table(rec, {
      money, clock, out, onError: deps.onError ? (e, where) => deps.onError(e, where, t) : null, rng: deps.rng, deckSource: deps.deckSource, constants: deps.constants,
      hooks: { seatOf: key => { const r = seatOf(key); return r && r.tableId !== rec.id ? r : null; }, profileOf },
    });
    t.handNo = Math.max(t.handNo || 0, money.lastHandNo(t.id));      // monotonic across restarts: never reuse hand:<id>:<n>
    tables.set(t.id, t);
    return t;
  }

  // ---- create / lookup ------------------------------------------------------------------------------------------
  function genId() {
    for (;;) {
      let id = '';
      for (let i = 0; i < 6; i++) id += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!tables.has(id)) return id;
    }
  }
  const normCode = id => String(id || '').trim().toUpperCase();
  const get = id => tables.get(normCode(id)) || tables.get(String(id || '')) || null;

  function create(hostKey, raw) {
    const open = [...tables.values()].filter(t => t.hostKey === hostKey && t.state !== 'ended' && !t.permanent).length;
    if (open >= MAX_OPEN_PER_HOST) throw new TableError('max_tables', { max: MAX_OPEN_PER_HOST });
    const v = validateSettings(raw);
    if (!v.ok) {
      const { code, field, message, ...rest } = v;
      throw new TableError(code === 'range' ? 'range' : 'bad_request', { field, ...rest }, message);
    }
    const id = genId(), now = clock.now();
    const rec = { id, hostKey, permanent: false, state: 'open', createdAt: now, nightId: `n_${ymd(now)}_${id}`, nightFromId: ledger.lastId, nightHand0: 0, blindStartAt: 0, ...v.value };
    const t = build(rec);
    t.emptySince = now;
    save(); pushLobby();
    return t;
  }

  function ensurePermanent(legacyBlinds) {
    if (tables.has(PERMANENT_ID)) return tables.get(PERMANENT_ID);
    const d = defaultsFor('chips');
    const blinds = legacyBlinds && Number.isInteger(legacyBlinds.sb) && Number.isInteger(legacyBlinds.bb) && legacyBlinds.sb >= 1 && legacyBlinds.sb < legacyBlinds.bb ? { sb: legacyBlinds.sb, bb: legacyBlinds.bb } : d.blinds;
    return build({
      id: PERMANENT_ID, name: 'The Ping', mode: 'chips', unit: 'chips', buyIn: { ...d.buyIn }, blinds, blindIncrease: { enabled: false, everyMin: 15, schedule: 'standard' },
      seats: 8, actionTimerSec: 30, autoStart: true, isPrivate: false, look: 'basement', rebuys: true, rebuyLimit: 0, hostKey: 'chris', state: 'open', permanent: true,
      nightId: null, nightFromId: 0, nightHand0: 0, createdAt: clock.now(), blindStartAt: 0,
    });
  }

  function load() {
    let j = null;
    try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { j = null; }
    const cutoff = clock.now() - ENDED_KEEP_MS;
    const lb = j && j.legacyBlinds;
    registry.savedLegacyBlinds = lb && Number.isInteger(lb.sb) && Number.isInteger(lb.bb) ? { sb: lb.sb, bb: lb.bb } : null;
    for (const raw of (j && Array.isArray(j.tables) ? j.tables : [])) {
      if (!raw || !raw.id || tables.has(raw.id) || raw.id === PERMANENT_ID || raw.mode === 'friends') continue;
      if (raw.state === 'ended' && (raw.createdAt || 0) <= cutoff) continue;
      const v = validateSettings({ ...raw, seats: raw.seats });
      if (!v.ok && raw.state !== 'ended') { console.error('[v2] tables.json: dropping invalid table', raw.id, v.field); continue; }
      const rec = { ...raw, ...(v.ok ? v.value : {}), id: raw.id, hostKey: raw.hostKey, permanent: false, state: raw.state === 'paused' ? 'paused' : raw.state === 'ended' ? 'ended' : 'open' };
      if (!Number.isInteger(rec.seats)) rec.seats = 8;
      const t = build(rec);
      t.emptySince = clock.now();
    }
    ensurePermanent(registry.savedLegacyBlinds);
    pushLobby();
    return tables.size;
  }

  // ---- queries --------------------------------------------------------------------------------------------------
  function seatOf(key) {
    for (const t of tables.values()) {
      if (t.state === 'ended') continue;
      const s = t.seatOfKey(key);
      if (s) return { tableId: t.id, seat: s.seat };
    }
    return null;
  }
  const canHost = (t, key) => key === t.hostKey || isAdmin(key);
  function card(t) {
    const b = t.handLive() ? { sb: t.hand.sb, bb: t.hand.bb } : { sb: t.blinds.sb, bb: t.blinds.bb };
    return { id: t.id, name: t.name, mode: t.mode, unit: t.unit, sb: b.sb, bb: b.bb, buyIn: { min: t.buyIn.min, max: t.buyIn.max }, seats: t.maxSeats,
      seated: t.players().filter(s => s.connected).length, host: { key: t.hostKey, display: profileOf(t.hostKey).display }, state: t.state, isPrivate: t.isPrivate, look: t.look || 'basement' };
  }
  function publicTable(t) {
    const b = t.handLive() ? { sb: t.hand.sb, bb: t.hand.bb } : { sb: t.blinds.sb, bb: t.blinds.bb };
    const r = recOf(t);
    return { ...r, sb: b.sb, bb: b.bb, host: { key: t.hostKey, display: profileOf(t.hostKey).display }, moneyMode: t.mode };
  }
  const mine = (t, key) => t.hostKey === key || !!t.seatOfKey(key);
  const listFor = key => [...tables.values()].filter(t => t.state !== 'ended' && (!t.isPrivate || mine(t, key))).map(card);

  // ---- nights (truth = money ledger) --------------------------------------------------------------------------
  function nightOf(t) { return service.nightSummary(t.id, { fromId: t.nightFromId || 0 }); }
  function netTonight(t, key) { const r = nightOf(t).perKey[key]; return r ? r.net : 0; }
  function participants(t) {
    const set = new Set([t.hostKey]);
    for (const k of Object.keys(nightOf(t).perKey)) set.add(k);
    for (const s of t.players()) set.add(s.key);
    return set;
  }
  const isParticipant = (t, key) => canHost(t, key) || participants(t).has(key);
  function mineFor(key) {
    const out2 = [], nightNet = {};
    for (const t of tables.values()) {
      if (t.state === 'ended' || (t.permanent && !t.seatOfKey(key))) continue;
      if (!(t.hostKey === key || t.seatOfKey(key) || (!t.permanent && nightOf(t).perKey[key]))) continue;
      out2.push(card(t)); nightNet[t.id] = netTonight(t, key);
    }
    return { tables: out2, nightNet };
  }
  function nightPayload(t) {
    const n = nightOf(t);
    const players = Object.entries(n.perKey).map(([key, r]) => {
      const p = profileOf(key);
      return { key, display: p.display, avatar: p.avatar || null, pic: p.pic || null, buyIns: r.buyIn, rebuys: 0, cashedOut: r.cashOut + r.open, net: r.net };
    }).sort((a, b) => b.net - a.net);
    const d = new Date(t.endedAt || clock.now());
    const lines = [`The Ping - ${t.name} - ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`];
    for (const p of players) lines.push(`${p.display} ${fmtUnits(p.net, t.unit, true)}`);
    const o = { nightId: t.nightId, tableId: t.id, table: { name: t.name, mode: t.mode, unit: t.unit }, ended: t.state === 'ended', startedAt: t.createdAt || null, endedAt: t.endedAt || null, players, zeroSum: n.zeroSum, text: lines.join('\n') };
    if (!n.zeroSum) o.drift = n.sum;
    return o;
  }

  // ---- sweep, safety --------------------------------------------------------------------------------------------
  function sweep(now) {
    now = now == null ? clock.now() : now;
    for (const t of [...tables.values()]) {
      if (t.permanent || t.state === 'ended') continue;
      if (t.players().some(s => s.connected)) { t.emptySince = null; continue; }
      if (!t.emptySince) { t.emptySince = now; continue; }
      if (now - t.emptySince > EMPTY_MS) {
        try { t.endNight('idle'); } catch (e) { console.error('[v2] idle end failed', t.id, e.message); }
        if (t.state === 'ended' && Object.keys(nightOf(t).perKey).length === 0) tables.delete(t.id);
        save(); pushLobby();
      }
    }
    for (const [id, t] of tables) if (t.state === 'ended' && (t.endedAt || 0) && now - t.endedAt > ENDED_KEEP_MS) tables.delete(id);
  }
  function startSweep() { if (sweepHandle) return; sweepHandle = setInterval(() => sweep(), Math.min(60000, EMPTY_MS)); if (sweepHandle.unref) sweepHandle.unref(); }
  function stop() { if (sweepHandle) { clearInterval(sweepHandle); sweepHandle = null; } for (const t of tables.values()) { t.deadlines.clear(); t.arm(); } }
  const voidAll = reason => { let n = 0; for (const t of tables.values()) if (t.void(reason)) n++; return n; };
  const pauseAll = () => { for (const t of tables.values()) if (!t.paused && t.phase !== 'ended') t.pause(true); };

  const registry = {
    tables, create, get, load, save, flush, ensurePermanent, seatOf, card, publicTable, listFor, mineFor, mine, canHost, isParticipant,
    nightOf, netTonight, participants, nightPayload, sweep, startSweep, stop, voidAll, pauseAll, pushLobby, recOf, genId, out, savedLegacyBlinds: null,
  };
  return registry;
}

module.exports = { createRegistry, fmtUnits, PERMANENT_ID, MAX_OPEN_PER_HOST };
