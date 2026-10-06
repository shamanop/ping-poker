'use strict';
// The harness' own book of what every player must hold. Numbers only enter from (a) what the harness itself did and
// (b) what the server told a client (spin results, showdown nets, bonus/achievement events, wallet deltas). It never reads the ledger,
// except in the two "unacked" cases after a kill (ingest of a ledger line the client could not have seen), see soak.js reconcile().
const START = { chips: 10000, play: 1000000 };       // signup mint per account (V2-DESIGN "money/")
const CURS = ['chips', 'play'];

class Model {
  constructor() {
    this.players = new Map();                       // key -> { key, held:{chips,play} }
    this.src = { signup: { chips: 0, play: 0 }, bonus: 0, achv: 0, topup: 0, admin: { chips: 0, play: 0 }, bender: { chips: 0, play: 0 } };   // what each source account must be -sum of
    this.spins = new Map();                         // ref -> { key, cur, cost, win, checked }
    this.hands = new Map();                         // 'table:handNo' -> { nets, cur, via }
    this.mints = new Map();                         // dedupe key -> { kind, key, amount }
    this.count = { spins: 0, hands: 0, handsUnacked: 0, handsVoided: 0, bonus: 0, achv: 0, topup: 0, adminAdjust: 0, adminRefused: 0, signups: 0, buyIns: 0, cashOuts: 0 };
  }
  hasPlayer(key) { return this.players.has(key); }
  addPlayer(key) {
    if (this.players.has(key)) return false;
    this.players.set(key, { key, held: { chips: START.chips, play: START.play } });
    this.src.signup.chips += START.chips; this.src.signup.play += START.play; this.count.signups++;
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
  // kind: bonus | achv | topup (all Play $). dedupe: a string unique per mint (ledger ref shape), so a client told twice pays once.
  applyMint(kind, key, amount, dedupe) {
    if (this.mints.has(dedupe)) return false;
    this.mints.set(dedupe, { kind, key, amount });
    this._add(key, 'play', amount); this.src[kind] += amount; this.count[kind]++;
    return true;
  }
  applyAdmin(key, cur, delta) { this._add(key, cur, delta); this.src.admin[cur] += delta; this.count.adminAdjust++; }
  accounts() { return [...this.players.keys()]; }
  expectedSource(cur) {
    return {
      'mint:signup': -this.src.signup[cur], 'admin:adjust': -this.src.admin[cur], 'house:bender': -this.src.bender[cur], 'house:coldcall': 0, 'mint:migration': 0,
      'mint:bonus': cur === 'play' ? -this.src.bonus : 0, 'mint:achv': cur === 'play' ? -this.src.achv : 0, 'mint:topup': cur === 'play' ? -this.src.topup : 0,
    };
  }
}
module.exports = { Model, START, CURS };
