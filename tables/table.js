'use strict';
// One poker table: seats, deadlines, pause. Knows nothing about sockets or accounts (contract section 1).
// Talks out through deps.out { state(table), event(table, kind, data, toKey?) }, reads time through deps.clock
// { now, setTimeout, clearTimeout }, and moves money ONLY through deps.money (tables/money-port.js).
// Money first, memory second: every money call returns before a seat changes (contract 0.1).
// deps.hooks: { seatOf(key) -> { tableId } | null  (one seat per account, other tables), profileOf(key) -> { display } }.
// deps.onError(err, where): a failing deadline is reported there; tick() still re-arms (a table cannot deadlock).

const { TableError } = require('./errors');
const { levelAt } = require('./settings');

const num = (v, d) => (Number(v) > 0 ? Number(v) : d);
const envMs = name => num(process.env[name], 0);

class Table {
  constructor(rec, deps) {
    Object.assign(this, rec);
    this.maxSeats = rec.seats;                     // validateSettings calls the seat count `seats`; this.seats is the Map
    this.cur = this.mode === 'chips' ? 'chips' : 'play';
    this.state = this.state || 'open';             // lobby state: open | paused | ended
    this.paused = this.state === 'paused';
    this.reentry = {};                            // key -> { remaining, forgiven }: what the SERVER cashed out and the player may bring back (K3-5)
    this.pausePending = false;                    // pause asked for during a live hand (K3-4)
    this.handNo = this.handNo || 0;
    this.nightFromId = this.nightFromId || 0;
    this.nightHand0 = this.nightHand0 || 0;
    this.phase = this.state === 'ended' ? 'ended' : 'waiting';
    this.hand = null; this.button = this.button == null ? null : this.button;
    this.log = []; this.history = []; this.committed = false; this.lastResult = null; this.pendingBlinds = null; this.blindLevelSeen = 0; this.voids = [];
    this.deckSource = deps.deckSource || null;
    this.seats = new Map();                         // seat number -> seat record
    this.deadlines = new Map();                     // id -> { id, kind, at, hand, seat?, frozen? }
    this.handle = null;
    this.handleAt = null;
    this.endNightPending = null;
    this.money = deps.money; this.clock = deps.clock; this.out = deps.out || { state() {}, event() {} };
    this.hooks = deps.hooks || {}; this.onError = deps.onError || null;
    this.rng = deps.rng || null;
    this.K = Object.assign({
      AUTO_START_MS: envMs('AUTO_START_MS') || 2000, GRACE_MS: 120000, HOST_GRACE_MS: envMs('HOST_GRACE_MS') || 20000,
      TURN_MS: envMs('TURN_MS') || 30000, PRE_MS: 450, STREET_MS: envMs('STREET_MS') || 1500,
    }, deps.constants || {});
  }

  // ---- time and the one timer -------------------------------------------------------------------------------
  now() { return this.clock.now(); }

  // deadline = { id, kind, at, hand }  hand:true deadlines freeze while paused (turn, preselect, street, nexthand, autostart).
  setDeadline(id, kind, ms, extra) {
    const d = { id, kind, at: this.now() + ms, hand: !!(extra && extra.hand), ...(extra || {}) };
    if (this.paused && d.hand) { d.frozen = ms; d.at = null; }
    this.deadlines.set(id, d); this.arm();
    return d;
  }
  clearDeadline(id) { if (this.deadlines.delete(id)) this.arm(); }
  hasDeadline(id) { return this.deadlines.has(id); }
  clearHandDeadlines() { for (const [id, d] of this.deadlines) if (d.hand) this.deadlines.delete(id); this.arm(); }

  arm() {
    let at = null;
    for (const d of this.deadlines.values()) if (d.at != null && (at == null || d.at < at)) at = d.at;
    if (at === this.handleAt && (this.handle || at == null)) return;
    if (this.handle) { this.clock.clearTimeout(this.handle); this.handle = null; }
    this.handleAt = at;
    if (at == null) return;
    this.handle = this.clock.setTimeout(() => { this.handle = null; this.handleAt = null; this.tick(this.now()); }, Math.max(0, at - this.now()));
    if (this.handle && this.handle.unref) this.handle.unref();
  }

  // Runs every due deadline in time order. Always ends by re-arming, also when a deadline throws.
  tick(now) {
    now = now == null ? this.now() : now;
    let firstErr = null, guard = 0;
    try {
      for (;;) {
        let due = null;
        for (const d of this.deadlines.values()) if (d.at != null && d.at <= now && (!due || d.at < due.at)) due = d;
        if (!due || ++guard > 1000) break;
        this.deadlines.delete(due.id);
        try { this.fire(due); } catch (e) { if (this.onError) this.onError(e, 'deadline:' + due.kind); else if (!firstErr) firstErr = e; }
      }
    } finally { this.arm(); }
    if (firstErr) throw firstErr;
  }

  fire(d) {
    if (d.kind === 'nexthand' || d.kind === 'turn' || d.kind === 'pre' || d.kind === 'street') return this.fireHand(d);
    if (d.kind === 'autostart') { if (this.phase === 'waiting' && this.startHand) this.startHand(); }
    else if (d.kind === 'grace') this.graceDue(d.seat);
    else if (d.kind === 'host') this.transferHost();
  }

  // ---- pause ------------------------------------------------------------------------------------------------
  // A pause never holds a live hand open (K3-4): asked for during a hand it is remembered (pausePending) and takes effect once that
  // hand has settled or been voided; the run-out and the turn clock keep going until then. force = the safety wrapper (money
  // fenced, three voids): those stop the table at once, as before.
  pause(force) {
    if (this.paused || this.phase === 'ended') return false;
    if (!force && this.handLive()) {
      if (this.pausePending) return false;
      this.pausePending = true;
      this.out.event(this, 'table_event', { kind: 'pause_pending' });
      this.out.state(this);
      return true;
    }
    this.pausePending = false;
    const now = this.now();
    for (const d of this.deadlines.values()) if (d.hand && d.at != null) { d.frozen = Math.max(0, d.at - now); d.at = null; }
    this.paused = true; this.state = 'paused'; this.arm();
    this.out.event(this, 'table_event', { kind: 'paused' });
    this.out.state(this);
    return true;
  }
  // The hand is over (settled or voided): a pause asked for during it starts now.
  applyPendingPause() {
    if (!this.pausePending || this.handLive()) return;
    if (this.endNightPending) { this.pausePending = false; return; }       // the night is ending: nothing to freeze
    this.pause();
  }
  resume() {
    if (this.pausePending && !this.paused) {            // the host changed his mind before the hand ended
      this.pausePending = false;
      this.out.event(this, 'table_event', { kind: 'resumed' });
      this.out.state(this);
      return true;
    }
    if (!this.paused || this.phase === 'ended') return false;
    const now = this.now();
    this.paused = false; this.state = 'open';
    for (const d of this.deadlines.values()) if (d.frozen != null) { d.at = now + d.frozen; delete d.frozen; }
    this.arm(); this.checkAutostart();
    this.out.event(this, 'table_event', { kind: 'resumed' });
    this.out.state(this);
    return true;
  }

  // ---- seat lookup and projection ---------------------------------------------------------------------------
  seatOfKey(key) { for (const s of this.seats.values()) if (s.key === key) return s; return null; }
  seatBySocket(socketId) { if (!socketId) return null; for (const s of this.seats.values()) if (s.socketId === socketId) return s; return null; }
  // Dense list, ascending seat number: the ONLY place an array index of players is born (contract 0.3).
  players() { return [...this.seats.values()].sort((a, b) => a.seat - b.seat); }
  denseIndex(key) { return this.players().findIndex(s => s.key === key); }
  eligible() { return this.players().filter(s => s.stack > 0 && !s.sitOutNext && s.connected && !s.leaving); }
  displayOf(key) { const p = this.hooks.profileOf && this.hooks.profileOf(key); return (p && p.display) || key; }
  liveSeat(s) { return !!(this.hand && s.dealt && this.hand.phase !== 'done' && !this.committed); }   // dealt into the live hand
  // What __audit and the drift check need: ledger seat balance must equal stack + handBet (engine stack while a hand is live).
  auditSeats() {
    return this.players().map(s => {
      const hs = this.liveSeat(s) ? this.hand.seats[s.seat] : null;
      // A seat that left or was kicked mid-hand was cashed out for its stack at once: only its committed chips are still in the seat account.
      // The uncalled layer E1 returns to a leaver sits in the engine stack but the seat account still holds it (it is paid out by the batch): count it in handBet.
      return { key: s.key, stack: s.leaving ? 0 : (hs ? hs.stack : s.stack), handBet: hs ? hs.committed - (s.leaving ? 0 : (hs.returned || 0)) : 0 };
    });
  }
  committedOf(s) { return this.liveSeat(s) && this.hand.seats[s.seat] ? this.hand.seats[s.seat].committed : 0; }

  freeSeat(want) {
    if (Number.isInteger(want) && want >= 0 && want < this.seatsMax()) return this.seats.has(want) ? null : want;
    for (let i = 0; i < this.seatsMax(); i++) if (!this.seats.has(i)) return i;
    return null;
  }
  seatsMax() { return this.maxSeats || 8; }

  // ---- buy-in rules -----------------------------------------------------------------------------------------
  // K3-5: a cash-out by the SERVER (boot recovery, the disconnect grace) is not the player's choice, so the buy-in that brings that money
  // back is not his rebuy: it is forgiven, up to the amount the server returned (`reentry[key].remaining`), and does not count against
  // the cap. Every other buy-in counts as before. The registry rebuilds `reentry` from the ledger at load.
  finiteCap() { return !this.rebuys || this.rebuyLimit > 0; }
  buyInAllowed(key, amount) {
    const re = this.reentry[key];
    if (re && amount > 0 && re.remaining >= amount) return true;
    const n = this.money.buyInCount(this, key, this.nightFromId) - (re ? re.forgiven : 0);
    if (!this.rebuys) return n === 0;
    return this.rebuyLimit === 0 || n < 1 + this.rebuyLimit;
  }
  noteBuyIn(key, amount) {
    const re = this.reentry[key];
    if (re && amount > 0 && re.remaining >= amount) { re.remaining -= amount; re.forgiven += 1; }
  }
  noteServerReturn(key, amount) {
    if (!(amount > 0) || !this.finiteCap()) return;
    const re = this.reentry[key] || (this.reentry[key] = { remaining: 0, forgiven: 0 });
    re.remaining += amount;
  }
  checkAmount(amount) {
    const { min, max } = this.buyIn;
    if (!Number.isSafeInteger(amount) || amount < min || amount > max) throw new TableError('range', { min, max, have: amount });
  }
  checkFund(fund) {
    if (fund === undefined || fund === null || fund === '') return null;
    if (fund !== 'chips' && fund !== 'play') throw new TableError('bad_request', { field: 'fund' });
    return fund;
  }

  // ---- sit / rebuy / sit out --------------------------------------------------------------------------------
  // opts { amount, fund, seat, socketId }. A key that already has a seat here is a reconnect (buy-in ignored).
  sit(key, opts) {
    opts = opts || {};
    if (this.phase === 'ended') throw new TableError('ended');
    const mine = this.seatOfKey(key);
    // K3-6: a seat that left or was kicked in a live hand is a seat on its way out, not a reconnect: there is no stack to hand back.
    // He sits again (with a real buy-in) once the hand has settled and the seat has been swept.
    if (mine && mine.leaving) throw new TableError('hand_live');
    if (mine) return this.rebind(mine, opts.socketId);
    const other = this.hooks.seatOf && this.hooks.seatOf(key);
    if (other) throw new TableError('one_seat', { tableId: other.tableId });
    const no = this.freeSeat(opts.seat);
    if (no == null) throw new TableError(Number.isInteger(opts.seat) && this.freeSeat() != null ? 'seat_taken' : 'table_full');
    this.checkAmount(opts.amount);
    const fund = this.checkFund(opts.fund);
    if (!this.buyInAllowed(key, opts.amount)) throw new TableError('rebuy_off');
    const r = this.money.buyIn(this, key, opts.amount, fund);          // money first
    this.noteBuyIn(key, opts.amount);
    const seat = {
      seat: no, key, stack: opts.amount, fund: fund || this.cur, connected: true, socketId: opts.socketId || null,
      sitOutNext: false, leaving: false, disconnectedAt: null, graceAt: null, timeouts: 0, pre: null, dealt: false, folded: false, lastAction: null,
    };
    this.seats.set(no, seat);
    this.afterSeatChange(seat, 'joined', { stack: seat.stack, reconnect: false, ref: r.intent.ref });
    return seat;
  }

  rebind(seat, socketId) {
    const wasConnected = seat.connected, old = seat.socketId;
    if (wasConnected && old && socketId && old !== socketId) this.out.event(this, 'taken_over', { socketId: old }, seat.key);
    seat.connected = true; seat.socketId = socketId || seat.socketId; seat.disconnectedAt = null; seat.graceAt = null;
    this.clearDeadline('grace:' + seat.seat);
    if (seat.key === this.hostKey) this.clearDeadline('host');
    this.afterSeatChange(seat, 'joined', { stack: seat.stack, reconnect: true });
    // A seat that is out of chips comes back to the rebuy panel: the bust_out the player missed is sent again (same event, same shape).
    if (seat.stack === 0 && !this.liveSeat(seat)) this.out.event(this, 'bust', { key: seat.key, seat: seat.seat }, seat.key);
    return seat;
  }

  // rebuy at stack 0. opts { amount?, fund? }.
  rebuy(key, opts) {
    opts = opts || {};
    const seat = this.seatOfKey(key);
    if (!seat) throw new TableError('no_seat');
    if (seat.leaving) throw new TableError('hand_live');            // K3-6: a seat on its way out takes no buy-in
    if (this.liveSeat(seat) && !seat.folded && this.hand.seats[seat.seat] && !this.hand.seats[seat.seat].folded) throw new TableError('in_hand');
    if (seat.stack > 0) throw new TableError('have_chips');
    const fund = this.checkFund(opts.fund) || seat.fund;
    let amount = opts.amount;
    if (amount === undefined || amount === null) amount = Math.min(this.buyIn.default, this.money.fundBalance(key, fund));
    if (!this.buyInAllowed(key, amount)) throw new TableError('rebuy_off');
    this.checkAmount(amount);
    const r = this.money.buyIn(this, key, amount, fund, null, 'rebuy');
    this.noteBuyIn(key, amount);
    seat.stack += amount; seat.fund = fund; seat.timeouts = 0;
    this.afterSeatChange(seat, 'rebuy', { stack: seat.stack, amount, ref: r.intent.ref });
    return seat;
  }

  sitOut(key) {
    const seat = this.seatOfKey(key);
    if (!seat) throw new TableError('no_seat');
    if (seat.stack > 0) seat.sitOutNext = !seat.sitOutNext;
    seat.timeouts = 0;
    this.checkAutostart();
    this.out.state(this);
    return seat.sitOutNext;
  }

  // ---- leave / kick / disconnect / grace ----------------------------------------------------------------
  // kind: leave | kick | grace | night. Returns { cashedOut, left }. The seat leaves the table now unless a hand is live for it.
  leave(key, kind) {
    const seat = this.seatOfKey(key);
    if (!seat) return { cashedOut: 0, left: false };
    kind = kind || 'leave';
    if (this.liveSeat(seat)) return this.leaveInHand(seat, kind);
    const r = this.money.cashOut(this, key, this.money.seatBalance(this, key), kind);
    this.removeSeat(seat);
    if (key === this.hostKey && !this.permanent) this.setDeadline('host', 'host', this.K.HOST_GRACE_MS);
    this.out.event(this, 'left', { key, cashedOut: r.noop ? 0 : this.lastCash(r), reason: kind === 'kick' ? 'kicked' : kind }, key);
    this.out.event(this, 'room', {});
    this.checkAutostart(); this.out.state(this);
    return { cashedOut: r.noop ? 0 : this.lastCash(r), left: true };
  }
  lastCash(r) { return r.intent ? r.intent.amount : 0; }

  kick(byKey, targetKey, isAdmin) {
    if (byKey !== this.hostKey && !isAdmin) throw new TableError('not_host');
    const seat = this.seatOfKey(targetKey);
    if (!seat) throw new TableError('no_seat');
    if (targetKey === this.hostKey) throw new TableError('forbidden');
    const display = this.displayOf(targetKey);
    const r = this.leave(targetKey, 'kick');
    this.out.event(this, 'table_event', { kind: 'kicked', key: targetKey, display });
    return r;
  }

  removeSeat(seat) {
    this.seats.delete(seat.seat);
    this.clearDeadline('grace:' + seat.seat);
  }

  // The socket bound to this seat went away. No fold, no cash-out, no engine call.
  disconnect(socketId) {
    const seat = this.seatBySocket(socketId);
    if (!seat) return null;
    seat.connected = false; seat.socketId = null; seat.disconnectedAt = this.now(); seat.graceAt = seat.disconnectedAt + this.K.GRACE_MS;
    this.setDeadline('grace:' + seat.seat, 'grace', this.K.GRACE_MS, { seat: seat.seat });
    if (seat.key === this.hostKey) this.setDeadline('host', 'host', this.K.HOST_GRACE_MS);
    if (this.handLive() && this.hand.toAct === seat.seat) this.armTurn();     // the seat on turn now runs on the disconnect clock
    this.checkAutostart();
    this.out.event(this, 'room', {}); this.out.state(this);
    return seat;
  }

  graceDue(seatNo) {
    const seat = this.seats.get(seatNo);
    if (!seat || seat.connected) return;
    if (this.liveSeat(seat)) { this.setDeadline('grace:' + seatNo, 'grace', 5000, { seat: seatNo }); return; }   // retried after the hand
    const r = this.money.cashOut(this, seat.key, this.money.seatBalance(this, seat.key), 'grace');
    this.noteServerReturn(seat.key, r.noop ? 0 : this.lastCash(r));
    this.removeSeat(seat);
    this.out.event(this, 'room', {}); this.out.event(this, 'money', { keys: [seat.key] });
    this.checkAutostart(); this.out.state(this);
    return r;
  }

  // Host moves to the first connected seated player (lowest seat). No connected seat: it stays, and the idle sweep decides.
  transferHost() {
    if (this.permanent) return false;                    // POKERPING keeps its host (old LEGACY behaviour)
    const host = this.seatOfKey(this.hostKey);
    if (host && host.connected) return false;
    const next = this.players().find(s => s.connected && s.key !== this.hostKey);
    if (!next) return false;
    const was = this.hostKey;
    this.hostKey = next.key;
    this.out.event(this, 'table_event', { kind: 'host', key: next.key, display: this.displayOf(next.key), from: was });
    this.out.state(this);
    return true;
  }

  // ---- autostart --------------------------------------------------------------------------------------------
  checkAutostart() {
    const want = this.phase === 'waiting' && this.autoStart && !this.paused && this.eligible().length >= 2;
    const has = this.deadlines.has('phase');
    if (want && !has) this.setDeadline('phase', 'autostart', this.K.AUTO_START_MS, { hand: true });
    else if (!want && has && this.deadlines.get('phase').kind === 'autostart') this.clearDeadline('phase');
  }

  afterSeatChange(seat, kind, data) {
    this.out.event(this, kind, { key: seat.key, seat: seat.seat, ...data }, seat.key);
    this.out.event(this, 'room', {});
    this.out.event(this, 'money', { keys: [seat.key] });
    this.checkAutostart();
    this.out.state(this);
  }

  // Blind level for the next deal (no timer: computed from blindStartAt).
  blindLevel() { return levelAt(this, this.blindStartAt, this.now()); }
}

Object.assign(Table.prototype, require('./hand-flow').proto);

module.exports = { Table };
