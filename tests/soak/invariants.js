'use strict';
// The soak's checker. It has its OWN reader of money.jsonl and shares no code with money/ (the thing it checks).
// Checker.poll() ingests the file incrementally (I1, I3, and "a pot is empty after every line" of I4). The check* methods take the
// current snapshot and return violations: { id, step, message, accounts, expected, got }.  See README.md for what each id means.
const fs = require('fs');

const CURS = ['chips', 'play'];
const SOURCES = new Set(['mint:signup', 'mint:bonus', 'mint:achv', 'mint:topup', 'mint:migration', 'house:bender', 'house:coldcall', 'admin:adjust', 'fx:chips', 'fx:play']);
const SHAPE = { bank: 2, play: 2, seat: 3, pot: 3, escrow: 4, pool: 3 };      // number of ':' separated parts
const ONLY_CUR = { bank: 'chips', play: 'play', 'fx:chips': 'chips', 'fx:play': 'play' };
const isAmount = n => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;

// -> kind ('bank'|'play'|'seat'|'pot'|'escrow'|'pool'|'orphan'|'source') or null when the name has no known shape
function kindOf(a) {
  if (typeof a !== 'string') return null;
  if (SOURCES.has(a)) return 'source';
  const p = a.split(':');
  if (p[0] === 'orphan') return p.length >= 2 && a.length > 7 ? 'orphan' : null;
  if (SHAPE[p[0]] === p.length && p.every(x => x.length > 0)) return p[0];
  return null;
}
const seatParts = a => { const p = a.split(':'); return { table: p[1], key: p[2] }; };

class Checker {
  constructor(file) {
    this.file = file;
    this.buf = Buffer.alloc(0);                 // complete lines read so far
    this.tornBytes = 0;
    this.lines = [];                            // parsed lines in file order
    this.bal = { chips: new Map(), play: new Map() };
    this.refs = new Map();                      // ref -> line
    this.lastId = 0;
    this.known = { chips: new Set(), play: new Set() };
    this.buyFund = new Map();                   // seat account -> fund of the latest buyin:<fund> line into it
    this.hist = [{ idx: -1, seenAt: 0, sig: this._sig() }];
    this.pending = [];                          // violations found by poll() not yet returned
    this.opLines = new Map();                   // 'kind:table:key' -> lines (buyin|rebuy|leave|kick|sweep|grace|night)
    this.killMark = null;
    this.stat = { lines: 0, checks: 0 };
  }

  // ---------- reading ----------
  v(id, message, accounts, expected, got, extra) { const o = { id, message, accounts: accounts || {}, expected, got, ...(extra || {}) }; this.pending.push(o); return o; }
  take() { const p = this.pending; this.pending = []; return p; }

  // Reads the file, checks I1 against what was read before, ingests new complete lines. Returns { added, torn }.
  poll(now = Date.now()) {
    let raw = Buffer.alloc(0);
    try { raw = fs.readFileSync(this.file); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (fs.existsSync(this.file + '.quarantine')) this.v('I1', 'money.jsonl.quarantine exists: the ledger quarantined a line', { file: this.file + '.quarantine' });
    const nl = raw.lastIndexOf(10);
    const complete = nl < 0 ? raw.subarray(0, 0) : raw.subarray(0, nl + 1);
    this.tornBytes = raw.length - complete.length;
    const prev = this.buf;
    if (complete.length < prev.length) { this.v('I1', 'money.jsonl got shorter', { file: this.file }, prev.length, complete.length); return { added: 0, torn: this.tornBytes > 0 }; }
    if (prev.length && !complete.subarray(0, prev.length).equals(prev)) {
      let at = 0; const n = Math.min(prev.length, complete.length);
      while (at < n && prev[at] === complete[at]) at++;
      this.v('I1', 'money.jsonl is not append-only: earlier bytes changed', { file: this.file }, 'prefix kept', 'differs at byte ' + at);
      this.buf = Buffer.from(complete); return { added: 0, torn: false };
    }
    const fresh = complete.subarray(prev.length);
    this.buf = Buffer.from(complete);
    let added = 0;
    for (let pos = 0; pos < fresh.length;) {
      const e = fresh.indexOf(10, pos);
      const text = fresh.toString('utf8', pos, e);
      pos = e + 1;
      if (text.trim() === '') { this.v('I1', 'blank line in money.jsonl'); continue; }
      this._ingest(text, now); added++;
    }
    return { added, torn: this.tornBytes > 0 };
  }

  _ingest(text, now) {
    const no = this.lines.length + 1;
    let rec;
    try { rec = JSON.parse(text); } catch { this.v('I1', `line ${no} does not parse`, { line: no }, 'json', text.slice(0, 80)); return; }
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) { this.v('I1', `line ${no} is not an object`, { line: no }); return; }
    if (!Number.isSafeInteger(rec.id) || rec.id <= this.lastId) this.v('I1', `line ${no}: id ${JSON.stringify(rec.id)} does not increase (last ${this.lastId})`, { line: no }, '> ' + this.lastId, rec.id);
    if (typeof rec.ref !== 'string' || !rec.ref) this.v('I1', `line ${no}: missing ref`, { line: no });
    else if (this.refs.has(rec.ref)) this.v('I1', `line ${no}: ref ${rec.ref} is not unique (first at id ${this.refs.get(rec.ref).id})`, { ref: rec.ref });
    const items = Array.isArray(rec.batch) ? rec.batch : [rec];
    if (Array.isArray(rec.batch) && rec.batch.length === 0) this.v('I1', `line ${no}: empty batch`, { line: no });
    let bad = false;
    for (const it of items) {
      if (!it || typeof it !== 'object') { bad = true; this.v('I1', `line ${no}: bad item`, { line: no }); continue; }
      if (!CURS.includes(it.cur)) { bad = true; this.v('I1', `line ${no}: bad cur ${JSON.stringify(it.cur)}`, { line: no }); }
      if (!isAmount(it.amount)) { bad = true; this.v('I1', `line ${no}: amount ${JSON.stringify(it.amount)} is not a positive safe integer`, { line: no, ref: rec.ref }); }
      for (const a of [it.from, it.to]) if (!kindOf(a)) { bad = true; this.v('I1', `line ${no}: unknown account shape ${JSON.stringify(a)}`, { account: a, ref: rec.ref }); }
      if (it.from === it.to) { bad = true; this.v('I1', `line ${no}: from equals to`, { account: it.from }); }
      for (const a of [it.from, it.to]) { const only = ONLY_CUR[a && a.split(':')[0]] || ONLY_CUR[a]; if (only && it.cur && only !== it.cur) { bad = true; this.v('I1', `line ${no}: ${a} is ${only} only, line is ${it.cur}`, { account: a, ref: rec.ref }); } }
      if (typeof (it.reason != null ? it.reason : rec.reason) !== 'string') { bad = true; this.v('I1', `line ${no}: missing reason`, { line: no }); }
    }
    const L = { no, idx: this.lines.length, id: rec.id, ts: rec.ts, ref: rec.ref, batch: Array.isArray(rec.batch), reason: rec.reason, items: [], seenAt: now, rec };
    this.lines.push(L);
    if (Number.isSafeInteger(rec.id) && rec.id > this.lastId) this.lastId = rec.id;
    if (typeof rec.ref === 'string' && !this.refs.has(rec.ref)) this.refs.set(rec.ref, L);
    if (typeof rec.ref === 'string') { const p = rec.ref.split(':'); if (p.length >= 4 && /^(buyin|rebuy|leave|kick|sweep|grace|night)$/.test(p[0])) { const k = p.slice(0, 3).join(':'); if (!this.opLines.has(k)) this.opLines.set(k, []); this.opLines.get(k).push(L); } }
    this.stat.lines++;
    if (bad) { this.hist.push({ idx: L.idx, seenAt: now, sig: this._sig() }); return; }
    const touchedPots = new Set();
    for (const it of items) {
      const reason = it.reason != null ? it.reason : rec.reason;
      L.items.push({ from: it.from, to: it.to, amount: it.amount, cur: it.cur, reason });
      const m = this.bal[it.cur];
      const fromKind = kindOf(it.from);
      if (fromKind !== 'source') {
        const have = m.get(it.from) || 0;
        if (have < it.amount) this.v('I3', `holder ${it.from} would go negative at line ${no} (${rec.ref})`, { account: it.from, ref: rec.ref, cur: it.cur }, '>= ' + it.amount, have);
      }
      m.set(it.from, (m.get(it.from) || 0) - it.amount);
      m.set(it.to, (m.get(it.to) || 0) + it.amount);
      for (const a of [it.from, it.to]) if (m.get(a) === 0) m.delete(a);
      for (const a of [it.from, it.to]) { if (kindOf(a) === 'pot') touchedPots.add(a + '|' + it.cur); if (a.startsWith('bank:')) this.known.chips.add(a.slice(5)); else if (a.startsWith('play:')) this.known.play.add(a.slice(5)); }
      if (reason && reason.startsWith('buyin:') && kindOf(it.to) === 'seat') this.buyFund.set(it.to, reason.slice(6));
    }
    for (const pc of touchedPots) { const [a, c] = pc.split('|'); const b = this.bal[c].get(a) || 0; if (b !== 0) this.v('I4', `pot ${a} holds ${b} after line ${no} (${rec.ref}): money stranded in a pot`, { account: a, ref: rec.ref, cur: c }, 0, b); }
    // hand batches: per seat nets, in the fund of each seat (needed to apply a hand the client never saw)
    if (typeof rec.ref === 'string' && rec.ref.startsWith('hand:')) {
      const [, tableId, handNo] = rec.ref.split(':');
      const nets = {}, fund = {};
      for (const it of L.items) {
        if (kindOf(it.to) === 'seat') { const k = seatParts(it.to).key; nets[k] = (nets[k] || 0) + it.amount; fund[k] = this.fundOfSeat(it.to, it.cur); }
        if (kindOf(it.from) === 'seat') { const k = seatParts(it.from).key; nets[k] = (nets[k] || 0) - it.amount; fund[k] = this.fundOfSeat(it.from, it.cur); }
      }
      L.hand = { tableId, handNo: Number(handNo), nets, fund };
    }
    this.hist.push({ idx: L.idx, seenAt: now, sig: this._sig() });
    if (this.hist.length > 120) this.hist.splice(0, this.hist.length - 120);
  }

  // ---------- derived ----------
  balance(cur, account) { return this.bal[cur].get(account) || 0; }
  fundOfSeat(seatAcct, seatCur) { return this.buyFund.get(seatAcct) || seatCur; }
  opsOf(kind, tableId, key) { return this.opLines.get(`${kind}:${tableId}:${key}`) || []; }
  lineByRef(ref) { return this.refs.get(ref) || null; }
  // The write-only mirror as the brief defines it: bank[k] = bank:k + chips seats + orphans, wallet[k] = play:k + play seats + orphans, every known key present.
  mirrorState() {
    const bank = {}, wallet = {};
    for (const k of this.known.chips) bank[k] = 0;
    for (const k of this.known.play) wallet[k] = 0;
    const add = (o, k, n) => { o[k] = (o[k] || 0) + n; };
    for (const [a, v] of this.bal.chips) { if (a.startsWith('bank:')) add(bank, a.slice(5), v); else if (a.startsWith('seat:')) add(bank, seatParts(a).key, v); else if (a.startsWith('orphan:')) add(bank, a.slice(7), v); }
    for (const [a, v] of this.bal.play) { if (a.startsWith('play:')) add(wallet, a.slice(5), v); else if (a.startsWith('seat:')) add(wallet, seatParts(a).key, v); else if (a.startsWith('orphan:')) add(wallet, a.slice(7), v); }
    return { bank, wallet };
  }
  static canon(o) { return JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]])); }
  _sig() { const m = this.mirrorState(); return Checker.canon(m.bank) + '#' + Checker.canon(m.wallet); }
  // holdings of one player in one currency: bank or wallet, plus every seat whose FUND is that currency
  heldOf(key, cur) {
    let n = this.balance(cur, (cur === 'chips' ? 'bank:' : 'play:') + key);
    for (const sc of CURS) for (const [a, v] of this.bal[sc]) if (a.startsWith('seat:') && seatParts(a).key === key && this.fundOfSeat(a, sc) === cur) n += v;
    return n;
  }
  // The top-up rule (H7): Play $ held = wallet + every seat at a Play table (by the seat's table currency).
  playHeldRule(key) {
    let n = this.balance('play', 'play:' + key);
    for (const [a, v] of this.bal.play) if (a.startsWith('seat:') && seatParts(a).key === key) n += v;
    return n;
  }
  seats() { const out = []; for (const c of CURS) for (const [a, v] of this.bal[c]) if (a.startsWith('seat:')) out.push({ account: a, cur: c, balance: v, ...seatParts(a) }); return out; }
  keysSeen() { return new Set([...this.known.chips, ...this.known.play]); }

  // ---------- checks (each returns violations) ----------
  // I2: per-currency conservation and every source account against the model.
  checkConservation(model, audit) {
    const out = [];
    for (const cur of CURS) {
      let all = 0, holders = 0;
      for (const [a, v] of this.bal[cur]) { all += v; if (kindOf(a) !== 'source') holders += v; }
      if (all !== 0) out.push({ id: 'I2', message: `${cur}: sum over all accounts is not 0`, accounts: { cur }, expected: 0, got: all });
      const want = model.expectedSource(cur);
      for (const [acct, w] of Object.entries(want)) {
        const got = this.balance(cur, acct);
        if (got !== w) out.push({ id: 'I2', message: `${acct} (${cur}) disagrees with the model`, accounts: { account: acct, cur }, expected: w, got });
      }
      for (const [a, v] of this.bal[cur]) if (kindOf(a) === 'source' && !(a in want) && a !== 'fx:chips' && a !== 'fx:play' && v !== 0) out.push({ id: 'I2', message: `unexpected source ${a} (${cur})`, accounts: { account: a, cur }, expected: 0, got: v });
      void holders;
    }
    // 1:1 funding: what the chips side of fx took in is exactly what the play side paid out. (Each side alone moves with cross-funded seats' winnings.)
    const fxSum = this.balance('chips', 'fx:chips') + this.balance('play', 'fx:play');
    if (fxSum !== 0) out.push({ id: 'I2', message: 'fx:chips (chips) + fx:play (play) is not 0: a cross-currency buy-in or cash-out was not 1:1', accounts: { fxChips: this.balance('chips', 'fx:chips'), fxPlay: this.balance('play', 'fx:play') }, expected: 0, got: fxSum });
    if (audit && audit.ledger) {
      for (const cur of CURS) {
        const a = audit.ledger[cur];
        if (a && a.ok !== true) out.push({ id: 'I2', message: `server's own ledger.check() says ${cur} does not balance`, accounts: { cur }, expected: 'ok', got: JSON.stringify(a) });
      }
      if (audit.ledger.quarantined) out.push({ id: 'I1', message: 'server reports quarantined ledger lines', accounts: {}, expected: 0, got: audit.ledger.quarantined });
    }
    return out;
  }

  // I7: every player's holdings in the ledger equal the model.
  checkModel(model) {
    const out = [];
    for (const key of model.accounts()) for (const cur of CURS) {
      const got = this.heldOf(key, cur), want = model.held(key, cur);
      if (got !== want) out.push({ id: 'I7', message: `${key} ${cur}: ledger holdings differ from the model by ${got - want}`, accounts: { key, cur, bank_or_wallet: this.balance(cur, (cur === 'chips' ? 'bank:' : 'play:') + key) }, expected: want, got });
    }
    for (const k of this.keysSeen()) if (!model.hasPlayer(k)) out.push({ id: 'I7', message: `ledger has an account the harness never created: ${k}`, accounts: { key: k }, expected: 'none', got: 'bank/play account' });
    return out;
  }

  // I7 (acked means durable): every spin result a client received is in the ledger with the same cost and win.
  checkSpins(model) {
    const out = [];
    for (const [ref, s] of model.spins) {
      if (s.checked) continue;
      const L = this.lineByRef(ref);
      if (!L) { out.push({ id: 'I7', message: `a Bender result the client received is not in the ledger (${ref})`, accounts: { ref, key: s.key }, expected: `cost ${s.cost} win ${s.win}`, got: 'no line' }); continue; }
      let cost = 0, win = 0, bad = null;
      const store = (s.cur === 'chips' ? 'bank:' : 'play:') + s.key;
      for (const it of L.items) {
        if (it.cur !== s.cur) bad = 'wrong currency ' + it.cur;
        else if (it.from === store && it.to === 'house:bender') cost += it.amount;
        else if (it.from === 'house:bender' && it.to === store) win += it.amount;
        else bad = `foreign leg ${it.from} -> ${it.to}`;
      }
      if (bad || cost !== s.cost || win !== s.win) { out.push({ id: 'I7', message: `ledger line ${ref} does not match the result the client was told${bad ? ' (' + bad + ')' : ''}`, accounts: { ref, key: s.key }, expected: `cost ${s.cost} win ${s.win}`, got: `cost ${cost} win ${win}` }); continue; }
      s.checked = true;
    }
    return out;
  }


  // I7 (acked means durable): every poker result a client received is in the ledger with the same per-seat nets.
  checkHands(model) {
    const out = [];
    for (const [id, h] of model.hands) {
      if (h.checked || h.via !== 'client') continue;
      const L = this.lineByRef('hand:' + id);
      if (!L) { out.push({ id: 'I7', message: `a showdown_result the client received is not in the ledger (hand:${id})`, accounts: { hand: id }, expected: JSON.stringify(h.nets), got: 'no line' }); continue; }
      const got = L.hand ? L.hand.nets : {};
      const diff = [];
      for (const k of new Set([...Object.keys(h.nets), ...Object.keys(got)])) if ((h.nets[k] || 0) !== (got[k] || 0)) diff.push(`${k}: told ${h.nets[k] || 0}, ledger ${got[k] || 0}`);
      if (diff.length) { out.push({ id: 'I7', message: `ledger hand:${id} pays differently from the showdown_result the clients saw`, accounts: { hand: id }, expected: JSON.stringify(h.nets), got: diff.join('; ') }); continue; }
      h.checked = true;
    }
    return out;
  }

  // I4 against the server's own view of its seats, plus escrow/pool for wave 2. opts.afterRestart: nobody has sat yet.
  checkStranded(audit, opts = {}) {
    const out = [];
    const seen = new Map();
    for (const r of audit.rooms || []) for (const p of r.players || []) seen.set(`seat:${r.id}:${p.key}`, { chips: p.chips, handBet: p.handBet, fund: p.fund });
    for (const s of this.seats()) {
      const a = seen.get(s.account);
      if (opts.afterRestart) { out.push({ id: 'I4', message: `${s.account} holds ${s.balance} right after a restart: boot recovery left a seat unreturned`, accounts: { account: s.account }, expected: 0, got: s.balance }); continue; }
      if (!a) { out.push({ id: 'I4', message: `${s.account} holds ${s.balance} in the ledger but the server has no such seat`, accounts: { account: s.account }, expected: 0, got: s.balance }); continue; }
      const want = a.chips + (a.handBet || 0);
      if (s.balance !== want) out.push({ id: 'I4', message: `${s.account}: ledger ${s.balance} but the server's seat says stack ${a.chips} + handBet ${a.handBet}`, accounts: { account: s.account }, expected: want, got: s.balance });
      const fund = this.fundOfSeat(s.account, s.cur);
      if (a.fund && a.fund !== fund) out.push({ id: 'I4', message: `${s.account}: ledger says funded from ${fund}, server says ${a.fund}`, accounts: { account: s.account }, expected: fund, got: a.fund });
    }
    for (const [acct, a] of seen) if (a.chips + (a.handBet || 0) > 0 && !this.seats().some(s => s.account === acct)) out.push({ id: 'I4', message: `server shows ${acct} with ${a.chips + (a.handBet || 0)} but the ledger seat is empty`, accounts: { account: acct }, expected: a.chips + (a.handBet || 0), got: 0 });
    if (audit.drift && audit.drift.length) out.push({ id: 'I4', message: 'server audit drift: a seat account disagrees with its seat', accounts: {}, expected: '[]', got: JSON.stringify(audit.drift).slice(0, 300) });
    for (const c of CURS) for (const [a, v] of this.bal[c]) {
      const k = kindOf(a);
      if (k === 'pot') out.push({ id: 'I4', message: `${a} (${c}) is not empty`, accounts: { account: a }, expected: 0, got: v });
      if (k === 'escrow') { const g = a.split(':')[1]; const open = ((audit.games || {})[g] || {}).openRounds; const round = a.split(':').slice(3).join(':'); if (!Array.isArray(open) || !open.some(r => String(r.roundId != null ? r.roundId : r) === round)) out.push({ id: 'I4', message: `${a} (${c}) holds money but the game reports no such open round`, accounts: { account: a }, expected: 0, got: v }); }
      if (k === 'pool') { const g = a.split(':')[1], name = a.split(':').slice(2).join(':'); const pools = ((audit.games || {})[g] || {}).pools; if (pools && pools[name] !== undefined && pools[name] !== v) out.push({ id: 'I4', message: `${a} (${c}) differs from the game's own pool figure`, accounts: { account: a }, expected: pools[name], got: v }); }
    }
    return out;
  }

  // I8: nothing parked in the wallet adapter's memory between events.
  checkMemory(audit) {
    if (audit.walletPending !== 0) return [{ id: 'I8', message: 'the wallet adapter still holds parked stakes in memory', accounts: {}, expected: 0, got: audit.walletPending }];
    return [];
  }

  // I5: bank.json / wallet.json equal the fold of the ledger at SOME recent line, and that line is at most `lagMs` old.
  checkMirror(mirrors, now, lagMs = 1500) {
    if (!mirrors || !mirrors.bank || !mirrors.wallet) return [{ id: 'I5', message: 'bank.json or wallet.json is missing or unreadable', accounts: {}, expected: 'files', got: 'none' }];
    const sig = Checker.canon(mirrors.bank) + '#' + Checker.canon(mirrors.wallet);
    let j = -1;
    for (let i = this.hist.length - 1; i >= 0; i--) if (this.hist[i].sig === sig) { j = i; break; }
    if (j < 0) {
      const m = this.mirrorState();
      const diff = [];
      for (const k of new Set([...Object.keys(m.bank), ...Object.keys(mirrors.bank)])) if (m.bank[k] !== mirrors.bank[k]) diff.push(`bank[${k}] ledger ${m.bank[k]} file ${mirrors.bank[k]}`);
      for (const k of new Set([...Object.keys(m.wallet), ...Object.keys(mirrors.wallet)])) if (m.wallet[k] !== mirrors.wallet[k]) diff.push(`wallet[${k}] ledger ${m.wallet[k]} file ${mirrors.wallet[k]}`);
      return [{ id: 'I5', message: 'bank.json/wallet.json match no recent state of the ledger', accounts: { diff: diff.slice(0, 6) }, expected: 'fold of the ledger', got: diff.slice(0, 3).join('; ') }];
    }
    for (let i = j + 1; i < this.hist.length; i++) if (now - this.hist[i].seenAt > lagMs) return [{ id: 'I5', message: `bank.json/wallet.json are stale: they stop at ledger line ${this.hist[j].idx + 1}, newer lines are over ${lagMs} ms old`, accounts: { mirrorAtLine: this.hist[j].idx + 1, ledgerLines: this.lines.length }, expected: 'current', got: 'stale' }];
    return [];
  }

  // I6: what the server tells clients (wallet_get answer, admin overview rows) equals the ledger. views: [{ key, play, chips }]; rows: admin_overview accounts.
  checkViews(views, rows) {
    const out = [];
    for (const v of views || []) {
      const play = this.balance('play', 'play:' + v.key), chips = this.balance('chips', 'bank:' + v.key);
      if (v.play !== play) out.push({ id: 'I6', message: `${v.key}: the wallet answer says Play $ ${v.play}, the ledger says ${play}`, accounts: { key: v.key }, expected: play, got: v.play });
      if (v.chips !== chips) out.push({ id: 'I6', message: `${v.key}: the wallet answer says chips ${v.chips}, the ledger says ${chips}`, accounts: { key: v.key }, expected: chips, got: v.chips });
    }
    for (const r of rows || []) {
      const play = this.balance('play', 'play:' + r.key), bank = this.balance('chips', 'bank:' + r.key);
      let atChips = 0, atPlay = 0;
      for (const s of this.seats()) if (s.key === r.key) { if (s.cur === 'chips') atChips += s.balance; else atPlay += s.balance; }
      const want = { play, bank, atTable: atChips, atTablePlay: atPlay, balance: bank + atChips };
      for (const f of Object.keys(want)) if (r[f] !== want[f]) out.push({ id: 'I6', message: `admin overview ${r.key}.${f} is ${r[f]}, the ledger says ${want[f]}`, accounts: { key: r.key, field: f }, expected: want[f], got: r[f] });
    }
    return out;
  }

  // ---------- restart (I9) ----------
  markKill() { this.killMark = { lines: this.lines.length, lastId: this.lastId }; }
  // After a restart and its boot lines: everything new is [lines written just before the kill that we had not read] then [boot lines].
  // Returns { racing: [lines], boot: [lines], violations }.
  classifyRestart() {
    const out = { racing: [], boot: [], violations: [] };
    if (!this.killMark) return out;
    const fresh = this.lines.slice(this.killMark.lines);
    const isBoot = L => (L.ref || '').startsWith('boot:') || (L.reason || '').startsWith('boot');
    const allowed = /^(hand|bender|achv|bonus|signup|buyin|rebuy|leave|kick|sweep|grace|night):/;
    let seenBoot = false;
    for (const L of fresh) {
      if (isBoot(L)) { seenBoot = true; out.boot.push(L); continue; }
      if (seenBoot) { out.violations.push({ id: 'I9', message: `line ${L.no} (${L.ref}) was written after boot recovery and before anyone reconnected`, accounts: { ref: L.ref }, expected: 'only boot lines', got: L.reason || L.ref }); continue; }
      if (!allowed.test(L.ref || '')) { out.violations.push({ id: 'I9', message: `line ${L.no} (${L.ref}) appeared across the restart and is not a kind a cut-off operation can leave`, accounts: { ref: L.ref }, expected: 'hand|bender|achv|bonus|signup|buyin|rebuy|leave|kick|sweep|grace|night or boot', got: L.ref }); continue; }
      out.racing.push(L);
    }
    for (const L of out.boot) if (!(L.ref || '').startsWith('boot:')) out.violations.push({ id: 'I9', message: `boot line with a non boot ref: ${L.ref}`, accounts: { ref: L.ref }, expected: 'boot:<id>:<account>', got: L.ref });
    return out;
  }
  // The restarted server's own numbers equal what we recompute from the file.
  checkAuditAgainstFile(audit) {
    const out = [];
    for (const k of audit.accounts || []) {
      if (audit.bank[k] !== this.balance('chips', 'bank:' + k)) out.push({ id: 'I9', message: `after restart the server says bank[${k}] ${audit.bank[k]}, the file says ${this.balance('chips', 'bank:' + k)}`, accounts: { key: k }, expected: this.balance('chips', 'bank:' + k), got: audit.bank[k] });
      if (audit.wallet[k] !== this.balance('play', 'play:' + k)) out.push({ id: 'I9', message: `after restart the server says wallet[${k}] ${audit.wallet[k]}, the file says ${this.balance('play', 'play:' + k)}`, accounts: { key: k }, expected: this.balance('play', 'play:' + k), got: audit.wallet[k] });
    }
    return out;
  }
}

module.exports = { Checker, kindOf, SOURCES, CURS };
