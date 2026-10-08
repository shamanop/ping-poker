'use strict';
// The harness' own book of what every player must hold. Numbers only enter from (a) what the harness itself did and
// (b) what the server told a client (spin results, showdown nets, bonus/achievement events, wallet deltas). It never reads the ledger,
// except in the two "unacked" cases after a kill (ingest of a ledger line the client could not have seen), see soak.js reconcile().
const START = { chips: 10000, play: 0 };             // signup mint per account (V2-DESIGN "money/"; bb298d2: a new account starts with 0 Cash, only the admin sets it)
const CURS = ['chips', 'play'];

class Model {
  constructor() {
    this.players = new Map();                       // key -> { key, held:{chips,play} }
    this.src = { signup: { chips: 0, play: 0 }, bonus: 0, achv: 0, topup: 0, admin: { chips: 0, play: 0 }, bender: { chips: 0, play: 0 }, coldcall: { chips: 0, play: 0 }, campaign: { chips: 0, play: 0 } };   // what each source account must be -sum of (coldcall: what the players netted; house + pool = -that)
    this.slot = new SlotBook();
    this.camp = new CampBook();
    this.spins = new Map();                         // ref -> { key, cur, cost, win, checked }
    this.hands = new Map();                         // 'table:handNo' -> { nets, cur, via }
    this.mints = new Map();                         // dedupe key -> { kind, key, amount }
    this.count = { spins: 0, hands: 0, handsUnacked: 0, handsVoided: 0, bonus: 0, achv: 0, topup: 0, adminAdjust: 0, adminRefused: 0, signups: 0, buyIns: 0, cashOuts: 0 };
  }
  hasPlayer(key) { return this.players.has(key); }
  addPlayer(key, startPlay = START.play) {
    if (this.players.has(key)) return false;
    this.players.set(key, { key, held: { chips: START.chips, play: startPlay } });
    this.src.signup.chips += START.chips; this.src.signup.play += startPlay; this.count.signups++;
    return true;
  }
  held(key, cur) { const p = this.players.get(key); return p ? p.held[cur] : 0; }
  heldTotal(key) { return this.held(key, 'chips') + this.held(key, 'play'); }
  _add(key, cur, n) { const p = this.players.get(key); if (!p) throw new Error('model: unknown player ' + key); p.held[cur] += n; }

  // A Bender result the client received: cost and totalWin are the numbers in the result event. Deduped by roundId.
  applySpin({ key, cur, cost, win, roundId }) {
    const ref = `bender:${key}:${roundId}`;
    if (this.spins.has(ref)) return false;
    this.spins.set(ref, { key, cur, cost, win, checked: false });
    this._add(key, cur, win - cost); this.src.bender[cur] += win - cost; this.count.spins++;
    return true;
  }
  // nets: { key: net } as the engine reports them (zero-sum over the hand); cur: { key: 'chips'|'play' } = fund of that seat.
  applyHand(tableId, handNo, nets, cur, via) {
    const id = `${tableId}:${handNo}`;
    const prev = this.hands.get(id);
    if (prev) {
      for (const k of new Set([...Object.keys(prev.nets), ...Object.keys(nets)])) if ((prev.nets[k] || 0) !== (nets[k] || 0)) return { conflict: true, id, was: prev.nets, now: nets };
      return { dup: true };
    }
    let sum = 0;
    for (const v of Object.values(nets)) sum += v;
    if (sum !== 0) return { notZeroSum: true, id, sum };
    this.hands.set(id, { nets, cur, via });
    for (const [k, n] of Object.entries(nets)) this._add(k, cur[k], n);
    if (via === 'unacked') this.count.handsUnacked++; else this.count.hands++;
    return { applied: true };
  }
  hasHand(tableId, handNo) { return this.hands.has(`${tableId}:${handNo}`); }
  // kind: bonus (Chips, bb298d2) | achv | topup (Cash; both 0 since bb298d2). dedupe: a string unique per mint (ledger ref shape), so a client told twice pays once.
  applyMint(kind, key, amount, dedupe) {
    if (this.mints.has(dedupe)) return false;
    this.mints.set(dedupe, { kind, key, amount });
    this._add(key, kind === 'bonus' ? 'chips' : 'play', amount); this.src[kind] += amount; this.count[kind]++;   // bb298d2: the daily bonus pays Chips; achievements are badges only (reward 0); the top-up is off
    return true;
  }
  // A Cold Call round the client was told is closed (or the ledger line that closed it where the client could not hear): the player nets win + prize - cost. A void nets 0 (the stake came back).
  applySlot(r) {
    const id = `${r.key}:${r.rid}`;
    if (this.slot.rounds.has(id)) return false;
    const net = r.void ? 0 : r.win + r.prize - r.cost;
    this.slot.rounds.set(id, { ...r, net, checked: false });
    this.slot.open.delete(id);
    this._add(r.key, r.cur, net); this.src.coldcall[r.cur] += net; this.slot.net[r.cur] += net;
    this.count[r.void ? 'slotVoids' : r.via === 'client' ? 'slotRounds' : 'slotRoundsUnacked'] = (this.count[r.void ? 'slotVoids' : r.via === 'client' ? 'slotRounds' : 'slotRoundsUnacked'] || 0) + 1;
    return true;
  }
  // A CAMPAIGN TRAIL run the client was told is over (or the ledger line that closed it where the client could not hear): the player nets win - bet. A refund (void: a withdrawal, a timeout at 0 steps, a boot refund) nets 0.
  applyCamp(r) {
    const id = `${r.key}:${r.rid}`;
    if (this.camp.rounds.has(id)) return false;
    const net = r.void ? 0 : r.win - r.bet;
    this.camp.rounds.set(id, { ...r, net, checked: false });
    this.camp.open.delete(id);
    this._add(r.key, r.cur, net); this.src.campaign[r.cur] += net; this.camp.net[r.cur] += net;
    const k = r.via === 'client' ? 'campRuns' : 'campRunsUnacked'; this.count[k] = (this.count[k] || 0) + 1;
    return true;
  }
  applyAdmin(key, cur, delta) { this._add(key, cur, delta); this.src.admin[cur] += delta; this.count.adminAdjust++; }
  // An ACCEPTED "Set Cash to X" (K1-3): the player's TOTAL Cash (wallet + seats + open rounds, which is what held['play'] is) becomes X. A refused set is never booked: it changes nothing.
  applySetCash(key, x) { const d = x - this.held(key, 'play'); if (d !== 0) this.applyAdmin(key, 'play', d); return d; }
  accounts() { return [...this.players.keys()]; }
  expectedSource(cur) {
    return {
      'mint:signup': -this.src.signup[cur], 'admin:adjust': -this.src.admin[cur], 'house:bender': -this.src.bender[cur], 'house:campaign': -this.src.campaign[cur], 'mint:migration': 0,
      'mint:bonus': cur === 'chips' ? -this.src.bonus : 0, 'mint:achv': cur === 'play' ? -this.src.achv : 0, 'mint:topup': cur === 'play' ? -this.src.topup : 0,
    };
  }
}

// what the harness knows about the slot (COLD CALL): rounds it was told about (or adopted from the ledger where a kill or a dropped socket kept the client from hearing), the rounds still open
// (a stake in escrow, or a free Callback with a decision), Callbacks known to be armed. No number is ever copied from the ledger except for those adopted rounds.
class SlotBook {
  constructor() {
    this.rounds = new Map();              // 'key:rid' -> { key, cur, rid, cost, win, prize, buy, callback, plain, via, void, net, checked }
    this.open = new Map();                // 'key:rid' -> { key, cur, rid, cost, buy, callback, plain, gen, epoch, pending }
    this.net = { chips: 0, play: 0 };     // sum over closed rounds of win + prize - cost
    this.armed = new Set();               // 'key|cur': a Callback the client was told is waiting
    this.unsure = new Set();              // 'key|cur': a kill or an unheard round may have armed / dropped one
  }
  hasOpen(key) { for (const o of this.open.values()) if (o.key === key) return true; return false; }
  openOf(key, cur) { for (const o of this.open.values()) if (o.key === key && o.cur === cur) return o; return null; }
}
// what the harness knows about CAMPAIGN TRAIL: the runs it was told about (open: a stake in escrow and the last state the client saw; rounds: closed, with the win the client was told or the ledger close line adopted).
class CampBook {
  constructor() {
    this.rounds = new Map();              // 'key:rid' -> { key, cur, rid, bet, win, reason, steps, mx, via, void, net, checked }
    this.open = new Map();                // 'key:rid' -> { key, cur, rid, bet, steps, mx, trail, options, gen, epoch, pend, since }
    this.net = { chips: 0, play: 0 };     // sum over closed runs of win - bet
  }
  hasOpen(key) { for (const o of this.open.values()) if (o.key === key) return true; return false; }
  openOf(key) { for (const o of this.open.values()) if (o.key === key) return o; return null; }
}
module.exports = { Model, SlotBook, CampBook, START, CURS };
