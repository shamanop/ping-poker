'use strict';
// Hand lifecycle for Table (contract section 4): startHand, act/timeout/preselect, run-out pacing, settle = THE commit point,
// void, finishNight. Mixed into Table.prototype by table.js. engine/ is pure; money goes through the money port only.
// Rule: the ledger is written once per hand (settleHand). Before that returns a hand can be voided for free; after, it stands.

const engine = require('../engine/hand');
const { makeDeck, shuffle } = require('../engine/deck');
const { TableError } = require('./errors');
const { levelAt } = require('./settings');

const LOG_MAX = 30;

function defaultRng() {
  const crypto = require('crypto');
  return () => crypto.randomBytes(6).readUIntBE(0, 6) / 2 ** 48;
}

const proto = {
  // ---- helpers -----------------------------------------------------------------------------------------------
  pushLog(line) { this.log.push(line); if (this.log.length > LOG_MAX) this.log.splice(0, this.log.length - LOG_MAX); },
  handLive() { return !!(this.hand && this.hand.phase !== 'done' && !this.committed); },
  seatNo(s) { return s.seat; },

  nextButton(elig) {
    const nos = elig.map(s => s.seat).sort((a, b) => a - b);
    if (this.button == null) return nos[0];
    return nos.find(n => n > this.button) ?? nos[0];
  },

  // ---- missed blinds (K3-8) -----------------------------------------------------------------------------------
  // A seat that missed a hand while it was sitting out or away (missedBlind) is dealt in again only when the big blind reaches it: it
  // waits, it does not post out of turn, and it can never be the button. A player who stood up and sits again at this table (table.owesBB, kept per
  // player, not per seat number or hand count) is the same case: standing up, and sitting again at once or in another seat, never clears the
  // debt, only being dealt the big blind does (R2A-1). A player who never sat here has missed
  // nothing and is dealt in at the next hand, in whatever position the button gives it (the rule for new seats is unchanged). With fewer than two seats that are free to play
  // there is no game to wait behind, so the waiting seats are dealt in at once.
  pickButton(elig) {
    let base = elig.filter(s => !s.missedBlind);
    if (base.length < 2) { for (const s of elig) s.missedBlind = false; base = elig; }
    return this.nextButton(base);
  },
  // The seats dealt into this hand: every seat that is free to play, plus the first waiting seat (ring order after the button) that
  // would be the big blind if it were dealt in.
  dealtSeats(elig, button) {
    const base = elig.filter(s => !s.missedBlind), waiting = elig.filter(s => s.missedBlind);
    if (!waiting.length) return elig;
    const after = n => (n - button + 1000) % 1000;
    waiting.sort((a, b) => after(a.seat) - after(b.seat));
    for (const w of waiting) {
      const trial = [...base, w].sort((a, b) => a.seat - b.seat), nos = trial.map(x => x.seat);
      const ring = nos.filter(n => n > button).concat(nos.filter(n => n <= button));    // seats after the button, wrapping (the button last)
      if (ring[1] === w.seat) return trial;                                            // at least 3 seats here: SB = ring[0], BB = ring[1]
    }
    return base;
  },
  // A hand is dealt without a seat that has chips and is sitting out or away: that seat now owes the wait for the big blind.
  noteMissedBlinds(dealtIn) {
    for (const s of this.players()) if (!dealtIn.includes(s) && s.stack > 0 && !s.leaving && (s.sitOutNext || !s.connected)) s.missedBlind = true;
  },

  nextHandDelay() { const env = Number(process.env.HAND_DELAY_MS); if (env > 0) return env; return this.hand && this.hand.uncontested ? 7000 : 5000; },

  // ---- start ------------------------------------------------------------------------------------------------
  // Returns true when a hand was dealt. Not paused, no end-night pending, >= 2 eligible seats.
  startHand() {
    if (this.paused || this.phase === 'ended') return false;
    if (this.endNightPending) { this.finishNight(this.endNightPending); return false; }
    const elig = this.eligible();
    if (elig.length < 2) { this.setPhase('waiting'); this.checkAutostart(); return false; }
    this.missedSnap = new Map(this.players().map(s => [s, s.missedBlind]));          // a voided hand did not happen: void() puts the flags back
    const button = this.pickButton(elig), dealtIn = this.dealtSeats(elig, button);
    this.clearDeadline('phase');
    const now = this.now();
    if (this.pendingBlinds) {
      this.blinds = { sb: this.pendingBlinds.sb, bb: this.pendingBlinds.bb }; this.pendingBlinds = null;
      if (this.blindIncrease && this.blindIncrease.enabled) { this.blindStartAt = now; this.blindLevelSeen = 0; }
    }
    if (this.blindIncrease && this.blindIncrease.enabled && !(this.blindStartAt > 0)) this.blindStartAt = now;
    const lv = levelAt(this, this.blindStartAt, now);
    const risen = lv.enabled && lv.level > (this.blindLevelSeen || 0);
    this.blindLevelSeen = lv.level;
    this.handNo += 1;
    this.button = button;
    this.noteMissedBlinds(dealtIn);
    this.handStartStacks = {};
    for (const s of this.players()) { this.handStartStacks[s.seat] = s.stack; s.dealt = false; s.folded = false; s.lastAction = null; s.pre = null; }
    const deck = (this.deckSource && this.deckSource()) || shuffle(makeDeck(), this.rng || (this.rng = defaultRng()));
    this.committed = false; this.lastResult = null; this.log = [];
    try {
      this.hand = engine.createHand({ handNo: this.handNo, button: this.button, sb: lv.sb, bb: lv.bb, seats: dealtIn.map(s => ({ seat: s.seat, stack: s.stack })), deck });
    } catch (e) { this.hand = null; this.handNo -= 1; throw e; }
    for (const s of dealtIn) { s.dealt = true; s.missedBlind = false; }
    const h = this.hand;
    this.setPhase('betting');
    this.pushLog(`Hand ${this.handNo} dealt`);
    this.pushLog(`${this.displayOf(this.seats.get(h.sbSeat).key)} posts SB ${h.seats[h.sbSeat].bet}`);
    this.pushLog(`${this.displayOf(this.seats.get(h.bbSeat).key)} posts BB ${h.seats[h.bbSeat].bet}`);
    if (risen) this.out.event(this, 'blinds_up', { level: lv.level, sb: lv.sb, bb: lv.bb, unit: this.unit, mode: this.mode });
    this.out.event(this, 'hand_start', { handNo: this.handNo, button: this.button });
    this.afterEngine();
    return true;
  },

  setPhase(p) { this.phase = p; },

  // ---- after any engine call ---------------------------------------------------------------------------------
  syncSeats() {
    for (const s of this.seats.values()) {
      const hs = this.hand && s.dealt ? this.hand.seats[s.seat] : null;
      if (hs) s.folded = !!hs.folded;
    }
  },

  noteEvents(events, actorSeat) {
    for (const e of events || []) {
      const who = e.seat != null && this.seats.get(e.seat) ? this.displayOf(this.seats.get(e.seat).key) : '';
      const seat = e.seat != null ? this.seats.get(e.seat) : null;
      if (e.type === 'fold') { if (seat) seat.lastAction = 'FOLD'; this.pushLog(`${who} folds`); }
      else if (e.type === 'check') { if (seat) seat.lastAction = 'CHECK'; this.pushLog(`${who} checks`); }
      else if (e.type === 'call') { if (seat) seat.lastAction = 'CALL'; this.pushLog(`${who} calls ${e.amount}`); }
      else if (e.type === 'raise') { if (seat) seat.lastAction = 'RAISE'; this.pushLog(`${who} ${e.kind === 'bet' ? 'bets' : 'raises to'} ${e.to}`); }
      else if (e.type === 'street') { for (const s of this.seats.values()) s.lastAction = null; this.pushLog(`${String(e.street).charAt(0).toUpperCase() + String(e.street).slice(1)}: ${(e.cards || []).map(c => c.rank + c.suit).join(' ')}`); }
      else if (e.type === 'showdown') this.pushLog('--- Showdown ---');
    }
  },

  dropStalePre() {
    const h = this.hand;
    for (const s of this.seats.values()) {
      const p = s.pre; if (!p) continue;
      const hs = h && s.dealt ? h.seats[s.seat] : null;
      if (!h || !hs || hs.folded || hs.allIn || p.handNo !== h.handNo || p.street !== h.street || p.currentBet !== h.currentBet) s.pre = null;
    }
  },

  // Decides what happens next from the engine phase. Always ends with a state push.
  afterEngine(events) {
    this.noteEvents(events);
    this.syncSeats(); this.dropStalePre();
    const h = this.hand;
    if (h.phase === 'showdown') { this.settle(); return; }
    if (h.phase === 'runout') {
      this.setPhase('runout'); this.out.state(this);
      this.setDeadline('phase', 'street', this.K.STREET_MS, { hand: true });
      return;
    }
    this.setPhase('betting');
    this.turnStartAt = this.now();
    this.armTurn();
    this.out.state(this);
  },

  turnLimitMs(seat) {
    const timer = (this.actionTimerSec || 0) * 1000;
    if (!seat.connected && (timer === 0 || timer > this.K.TURN_MS)) return this.K.TURN_MS;
    return timer;                                           // 0 = no turn clock for a connected seat
  },

  // The seat on turn gets ONE deadline: the earlier of its preselect and its turn clock.
  armTurn() {
    this.clearDeadline('phase');
    const h = this.hand; if (!h || h.phase !== 'betting' || h.toAct == null) return;
    const seat = this.seats.get(h.toAct); if (!seat) return;
    const limit = this.turnLimitMs(seat);
    const elapsed = this.turnStartAt ? Math.max(0, this.now() - this.turnStartAt) : 0;
    const turnMs = limit > 0 ? Math.max(0, limit - elapsed) : null;
    const pre = seat.pre && this.preValid(seat) ? this.K.PRE_MS : null;
    if (pre != null && (turnMs == null || pre <= turnMs)) this.setDeadline('phase', 'pre', pre, { hand: true });
    else if (turnMs != null) this.setDeadline('phase', 'turn', turnMs, { hand: true });
  },

  preValid(seat) {
    const p = seat.pre, h = this.hand;
    if (!p || !h || p.handNo !== h.handNo || p.street !== h.street || p.currentBet !== h.currentBet) return false;
    return true;
  },

  // ---- actions ----------------------------------------------------------------------------------------------
  // action { type: 'fold'|'check'|'call'|'raise', to }. Throws the engine's RuleError unchanged (never rewrites an amount).
  act(key, action) {
    const seat = this.seatOfKey(key);
    if (!seat || !this.handLive() || !seat.dealt) throw new TableError('no_seat');
    const events = engine.apply(this.hand, seat.seat, action);
    seat.timeouts = 0; seat.pre = null;
    this.afterEngine(events);
    return events;
  },

  fireHand(d) {
    if (d.kind === 'turn') this.timeoutTurn();
    else if (d.kind === 'pre') this.firePre();
    else if (d.kind === 'street') this.dealStreet();
    else if (d.kind === 'nexthand') this.afterBetween();
  },

  timeoutTurn() {
    const h = this.hand; if (!this.handLive() || h.phase !== 'betting' || h.toAct == null) return;
    const seat = this.seats.get(h.toAct);
    const la = engine.legalActions(h, h.toAct);
    if (!la) return;
    if (seat.connected) { seat.timeouts += 1; if (seat.timeouts >= 2) { seat.sitOutNext = true; this.pushLog(`${this.displayOf(seat.key)} is sitting out`); } }
    seat.pre = null;
    this.afterEngine(engine.apply(h, h.toAct, { type: la.canCheck ? 'check' : 'fold' }));
  },

  firePre() {
    const h = this.hand; if (!this.handLive() || h.phase !== 'betting' || h.toAct == null) return;
    const seat = this.seats.get(h.toAct);
    if (!seat.pre || !this.preValid(seat)) { seat.pre = null; this.armTurn(); return; }
    const la = engine.legalActions(h, h.toAct); const p = seat.pre; seat.pre = null;
    let action;
    if (p.mode === 'checkfold') action = { type: la.canCheck ? 'check' : 'fold' };
    else if (p.mode === 'call' && la.toCall === p.amount) action = { type: la.canCheck ? 'check' : 'call' };
    else { this.armTurn(); return; }
    this.afterEngine(engine.apply(h, h.toAct, action));
  },

  // preselect { mode: 'checkfold'|'call'|null|'none', amount }
  preselect(key, mode, amount) {
    const seat = this.seatOfKey(key), h = this.hand;
    if (!seat) throw new TableError('no_seat');
    if (mode === null || mode === undefined || mode === 'none') { seat.pre = null; this.out.state(this); return null; }
    const hs = h && seat.dealt ? h.seats[seat.seat] : null;
    if (!this.handLive() || !hs || hs.folded || hs.allIn || h.toAct === seat.seat || (mode !== 'checkfold' && mode !== 'call')) throw new TableError('preselect');
    const toCall = Math.max(0, h.currentBet - hs.bet);
    if (mode === 'call' && amount !== toCall) throw new TableError('preselect');
    seat.pre = { mode, amount: mode === 'call' ? toCall : 0, handNo: h.handNo, street: h.street, currentBet: h.currentBet };
    this.out.state(this);
    return seat.pre;
  },

  dealStreet() {
    const h = this.hand; if (!this.handLive() || h.phase !== 'runout') return;
    this.afterEngine(engine.dealNext(h));
  },

  // ---- leave while a hand is live (N1, K3-1, K3-1b) ----------------------------------------------------------
  // Cash out only what is not committed to this hand now; the committed chips stay in the seat account until the batch.
  // A KICK never gets here for a seat that still has a hand to play (Table.kick marks it kickPending instead), only for a folded one.
  // A player who walks out of his own accord with a decision still ahead of him folds (his own choice); all-in or in the run-out he
  // has no decision, so he stays in the hand and is paid what he wins.
  leaveInHand(seat, kind) {
    const amount = this.money.leaveAmount(this, seat.key, this.committedOf(seat));
    const r = this.money.cashOut(this, seat.key, amount, kind);
    seat.leaving = true; seat.connected = false; seat.socketId = null; seat.sitOutNext = true; seat.pre = null;
    this.out.event(this, 'left', { key: seat.key, cashedOut: amount, reason: kind === 'kick' ? 'kicked' : kind, pendingHand: true }, seat.key);
    const hs = this.hand.seats[seat.seat];
    // A decision is still ahead of him only while betting is open and he is not all-in (the run-out has none, and an uncalled layer handed
    // back to an all-in seat clears its allIn flag without giving it a decision).
    const decides = !!hs && !hs.folded && !hs.allIn && this.hand.phase === 'betting';
    if (decides) {
      seat.folded = true;
      this.afterEngine(engine.foldOut(this.hand, seat.seat));
    } else { this.out.event(this, 'room', {}); this.out.state(this); }
    return { cashedOut: amount, left: false, intent: r.intent };
  },

  // The hand is over (settled or voided): a seat whose kick was held back is paid everything it has in the seat account (exactly what it
  // would have been paid without the kick), removed, and the kick events go out.
  finishKick(s) {
    if (s.leaving) {                                        // he walked out himself meanwhile: leaveInHand already paid the stack; the batch sweep pays the rest
      this.money.sweep(this, s.key); this.removeSeat(s);
      this.out.event(this, 'table_event', { kind: 'kicked', key: s.key, display: this.displayOf(s.key) });
      return;
    }
    const amount = this.money.seatBalance(this, s.key);
    const r = this.money.cashOut(this, s.key, amount, 'kick');
    this.removeSeat(s);
    this.out.event(this, 'left', { key: s.key, cashedOut: r.noop ? 0 : amount, reason: 'kicked' }, s.key);
    this.out.event(this, 'table_event', { kind: 'kicked', key: s.key, display: this.displayOf(s.key) });
    this.out.event(this, 'room', {});
    this.out.event(this, 'money', { keys: [s.key] });
  },

  // ---- settle: the commit point -------------------------------------------------------------------------------
  settle() {
    const h = this.hand;
    const r = engine.settle(h);
    const maps = { committed: {}, payouts: {}, returned: {} };
    const bySeat = {};
    for (const s of this.seats.values()) {
      if (!s.dealt) continue;
      bySeat[s.seat] = s;
      const hs = h.seats[s.seat];
      maps.committed[s.key] = hs.committed; maps.payouts[s.key] = r.payouts[s.seat] || 0; maps.returned[s.key] = r.returned[s.seat] || 0;
    }
    try { this.money.settleHand(this, h.handNo, maps); }
    catch (e) { this.void('settle', e); throw e; }
    this.committed = true;                                  // from here the hand stands (contract 4.4)
    this.afterCommit(h, r, bySeat);
  },

  afterCommit(h, r, bySeat) {
    const best = (what, fn) => { try { return fn(); } catch (e) { if (this.onError) this.onError(e, 'after-commit:' + what); else console.error('[v2] after-commit ' + what + ':', e && e.message); return undefined; } };
    this.setPhase('between');
    const busted = [], names = {};
    best('stacks', () => { for (const s of Object.values(bySeat)) { s.stack = h.seats[s.seat].stack; names[s.seat] = this.displayOf(s.key); } });
    const result = best('result', () => this.buildResult(h, r, bySeat, names));
    this.lastResult = result;
    for (const s of Object.values(bySeat)) {
      s.pre = null;
      if (s.kickPending) best('kick:' + s.key, () => this.finishKick(s));
      else if (s.leaving) best('sweep:' + s.key, () => { this.money.sweep(this, s.key); this.removeSeat(s); this.out.event(this, 'money', { keys: [s.key] }); });
      else if (s.stack === 0) busted.push(s);
    }
    if (result) { this.history.unshift(result.history); if (this.history.length > 10) this.history.length = 10; }
    best('emit', () => {
      this.out.event(this, 'hand_end', { hand: h, result, bySeat });
      for (const s of busted) this.out.event(this, 'bust', { key: s.key, seat: s.seat }, s.key);
      this.out.event(this, 'money', { keys: Object.values(bySeat).map(s => s.key) });
      this.out.state(this);
    });
    best('rearm', () => {
      this.clearDeadline('phase');
      if (this.phase === 'between') this.setDeadline('phase', 'nexthand', this.nextHandDelay(), { hand: true });
    });
    best('pause', () => this.applyPendingPause());           // K3-4: a pause asked for during the hand starts now that it has settled
  },

  buildResult(h, r, bySeat, names) {
    const nm = no => names[no] || (this.seats.get(no) ? this.displayOf(this.seats.get(no).key) : String(no));
    const winners = [], net = {}, returned = {}, nets = {};
    let pot = 0;
    for (const [no, amount] of Object.entries(r.payouts)) {
      const seatNo = Number(no); if (!(amount > 0)) continue;
      pot += amount;
      winners.push({ name: nm(seatNo), handName: h.uncontested ? 'Everyone folded' : ((r.handNames && r.handNames[seatNo]) || ''), cards: h.uncontested ? [] : (h.seats[seatNo].hole || []), amount, net: r.net[seatNo] });
    }
    for (const no of Object.keys(bySeat)) { net[nm(Number(no))] = r.net[no] || 0; if (r.returned[no] > 0) returned[nm(Number(no))] = r.returned[no]; }
    Object.assign(nets, net);
    const result = { handNo: h.handNo, winners, pot, net, returned, nextMs: this.nextHandDelay() };
    if (!h.uncontested) result.reveals = (r.reveals || []).map(no => ({ name: nm(Number(no)), handName: (r.handNames && r.handNames[no]) || '', cards: h.seats[no].hole || [] }));
    result.history = { handNum: h.handNo - this.nightHand0, winners: winners.map(w => w.name), handName: winners[0] ? winners[0].handName : '', pot, nets, returned };
    return result;
  },

  afterBetween() {
    if (this.phase === 'ended') return;
    if (this.endNightPending) { this.finishNight(this.endNightPending); return; }
    if (this.paused) return;
    if (this.eligible().length >= 2) this.startHand();
    else { this.setPhase('waiting'); this.out.state(this); this.checkAutostart(); }
  },

  // ---- void: a hand that never committed never happened -------------------------------------------------------
  void(reason, err) {
    if (!this.hand || this.committed) return false;
    const live = new Set();
    this.hand = null;
    this.clearHandDeadlines();
    for (const s of [...this.players()]) {
      if (s.kickPending) { try { this.finishKick(s); } catch (e) { console.error('[v2] void kick failed', s.key, e && e.message); } continue; }
      if (s.leaving) { try { this.money.sweep(this, s.key); } catch (e) { console.error('[v2] void sweep failed', s.key, e && e.message); } this.removeSeat(s); continue; }
      if (s.dealt && this.handStartStacks && this.handStartStacks[s.seat] != null) s.stack = this.handStartStacks[s.seat];
      s.dealt = false; s.folded = false; s.pre = null; s.lastAction = null; live.add(s.seat);
      if (this.missedSnap && this.missedSnap.has(s)) s.missedBlind = this.missedSnap.get(s);
    }
    this.setPhase('between'); this.committed = false;
    const now = this.now();
    this.voids = (this.voids || []).filter(t => now - t < 60000); this.voids.push(now);
    console.error(`[v2] VOID table=${this.id} hand=${this.handNo} reason=${reason}${err ? ' ' + (err.code || err.name) + ': ' + err.message : ''}`);
    this.out.event(this, 'void', { reason });
    this.out.state(this);
    if (this.voids.length >= 3) { this.pause(true); return true; }
    this.setDeadline('phase', 'nexthand', 2000, { hand: true });
    this.applyPendingPause();
    return true;
  },

  // ---- end of night -------------------------------------------------------------------------------------------
  endNight(reason) {
    if (this.permanent) throw new TableError('permanent');
    if (this.phase === 'ended') return false;
    if (this.handLive()) { this.endNightPending = reason || 'host'; return 'pending'; }
    this.finishNight(reason || 'host');
    return true;
  },

  finishNight(reason) {
    if (this.phase === 'ended') return;
    const keys = [];
    for (const s of this.players()) {
      this.money.cashOut(this, s.key, this.money.seatBalance(this, s.key), 'night');
      keys.push(s.key); this.removeSeat(s);
    }
    this.endNightPending = null; this.hand = null;
    this.deadlines.clear(); this.arm();
    this.phase = 'ended'; this.state = 'ended'; this.paused = false; this.pausePending = false; this.endedAt = this.now();
    this.out.event(this, 'night_end', { reason, keys });
    this.out.event(this, 'money', { keys });
    this.out.state(this);
  },
};

module.exports = { proto, LOG_MAX };
