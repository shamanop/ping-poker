'use strict';
// THE GAME CONFORMANCE KIT (MONEY HARDENING, ADD-A-GAME.md "the kit"). A new game is pluggable = it passes this + the 4-line registration.
//   node tests/game-kit.js <gameId>        one registered game (or the example, coinflip)
//   node tests/game-kit.js --all           every game in games/index.js MODULES plus the example game (coinflip); --examples is accepted and changes nothing
// Output: one line per check per currency, `PASS|FAIL <game> <check>[/<cur>] <detail>`, a summary, exit 0 / 1.
// Everything is real except the socket layer: money/ledger.js on a temp file, money/service.js, transport/game-money.js (ctx.money), the games
// registry (games/index.js, recover() at boot as server.js does) and the game module. The kit knows nothing of any game's rules: the game ships
// games/<id>.kit.js (the adapter, see ADD-A-GAME.md "the kit"), which plays it with the game's OWN socket messages and never touches money.
//
// checks: registration, escrow, restart, replay (double submit), sockets, mix, errors, input, identity, quarantine, disconnect, carry (Chips never feed Cash), refuse (a currency the adapter leaves out), payback (a ceiling on what is paid back), ledger (replay == balances)
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');

const ROOT = path.join(__dirname, '..');
const L = require(path.join(ROOT, 'money/ledger'));
const { createService } = require(path.join(ROOT, 'money/service'));
const { createGameMoney } = require(path.join(ROOT, 'transport/game-money'));
const { createWalletAdapter } = require(path.join(ROOT, 'transport/wallet-adapter'));
const registry = require(path.join(ROOT, 'games'));

const CURS = ['chips', 'play'];
const other = (c) => (c === 'chips' ? 'play' : 'chips');
const pacct = (key, cur) => (cur === 'chips' ? 'bank:' : 'play:') + key;
const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
const jclone = (v) => { try { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); } catch { return undefined; } };

class Crash extends Error { constructor(m) { super(m || 'simulated crash'); this.name = 'Crash'; } }
// thrown by g.call when the game answers an error (or nothing): the adapter lets it fly, the kit reads it as "the game refused"
class Refused extends Error { constructor(r) { super('the game refused: ' + JSON.stringify(r && r.error)); this.name = 'Refused'; this.reply = r; } }

const GAMES = (() => { const l = L.open(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'game-kit-reg-')), 'm.jsonl'), { fsync: 'none', log: () => {} }); const g = createService(l).GAMES; l.close(); return g; })();   // the live array money/service.js checks
const BASE = fs.mkdtempSync(path.join(process.env.KIT_TMP || os.tmpdir(), 'game-kit-'));
let counter = 0, current = null;       // the game module is one per process: a new world first "crashes" the live one

// ------------------------------------------------------------------------------------------------------------------------------------ the world
// A game event sent beside an `error` is a shown result unless it is a bare state re-sync. The adapter may say which events are which (optional `resultEvents` / `stateEvents`: event names without the `g:<id>:` prefix);
// otherwise the payload or the event name decides, not one field name: a round under roundId / round / rid / id, an outcome field (win, payout, paid, prize, outcome, result ...), or an event named like one.
const ROUND_KEYS = /^(round_?id|round|round_?no|rid|id)$/i, OUTCOME_KEYS = /(^|_)(win|won|winnings|payout|paid|prize|outcome|result|settled|credited)($|_)|^(win|won|payout|paid|prize|outcome|result|settled|credited)[A-Z]/;
const OUTCOME_EVENT = /result|win|won|payout|paid|prize|outcome|settle/i;
function looksPlayed(A, ev, payload) {
  if (Array.isArray(A.resultEvents)) return A.resultEvents.includes(ev);
  if (Array.isArray(A.stateEvents) && A.stateEvents.includes(ev)) return false;
  if (OUTCOME_EVENT.test(ev)) return true;
  if (!payload || typeof payload !== 'object') return false;
  return Object.keys(payload).some((k) => (ROUND_KEYS.test(k) && payload[k] !== undefined && payload[k] !== null) || OUTCOME_KEYS.test(k));
}

function world(A, opts = {}) {
  if (current) { try { current.crash(); } catch {} current = null; }
  const dir = opts.dir || fs.mkdtempSync(path.join(BASE, 'w'));
  const mod = A.mod;
  const io = new EventEmitter(); io.sockets = { sockets: new Map() };
  let t = 1000000;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const hooks = { seq: 0, crashAt: null, calls: [] };                // crashAt = { k, phase: 'before'|'after' } counted over every ctx.money write call
  let rngIn = mulberry(opts.seed || 12345);
  const rng = () => rngIn();                                         // one function for the life of the world: w.reseed() swaps the stream under it
  const w = { A, mod, dir, io, clock, hooks, rng, reseed: (sd) => { rngIn = mulberry(sd); }, boots: 0, keys: new Set(), log: [], accepted: 0, g: null, report: null, files: { money: path.join(dir, 'money.jsonl') } };
  const openEv = A.open(CURS[0], A.bets.good[0]).ev;
  w.openEv = openEv;

  function boot() {
    w.boots++;
    if (A.prepare) A.prepare(mod, { rng, log: () => {} });
    const ledger = w.ledger = L.open(w.files.money, { fsync: 'none', log: () => {} });
    const service = w.service = createService(ledger, { signupPlay: 1000000 });
    for (const k of w.keys) service.ensureAccount(k);
    let reg = null;
    const onChange = (k) => { if (reg) reg.pushWallet(k); };
    const real = createGameMoney({ service, ledger, onChange, log: () => {} });
    const gm = {
      forGame: (game) => {
        const m = real.forGame(game), out = { ...m };
        for (const name of ['round', 'open', 'settle', 'void']) {
          out[name] = (...args) => {
            const idx = hooks.seq++, ca = hooks.crashAt;
            if (ca && ca.k === idx && ca.phase === 'before') { hooks.fired = true; throw new Crash('before call ' + idx); }
            const res = m[name](...args);
            hooks.calls.push([name, args[0], args[1], args[2]]);
            if (ca && ca.k === idx && ca.phase === 'after') { hooks.fired = true; throw new Crash('after call ' + idx); }
            return res;
          };
        }
        return out;
      },
    };
    const wallet = createWalletAdapter({ service, ledger, onChange, log: () => {} });
    io.removeAllListeners('connection');
    reg = w.reg = registry({ io, wallet, money: gm, service, modules: [mod], accounts: {}, tables: {}, rooms: {}, now: clock.now, rng, files: A.files ? A.files(dir) : {}, ledger: { log: () => {} } });
    if (RUN_OPTS.onBoot) RUN_OPTS.onBoot(w);               // the self-test's way to give a deliberately broken toy a back door; a real adapter never has one
    w.report = reg.recover();
    return w.report;
  }

  w.addKey = (k) => { k = String(k).toLowerCase().trim(); w.keys.add(k); if (w.service) w.service.ensureAccount(k); return k; };
  w.sock = (key) => {
    key = w.addKey(key);
    const s = new EventEmitter();
    s.key = key; s.data = { acct: { key } }; s.out = [];
    const emit = s.emit.bind(s);
    s.send = (ev, p) => emit(ev, p);
    s.emit = (ev, p) => { if (ev === 'error' || ev === 'wallet' || ev.startsWith('g:') || ev.startsWith('floor:')) { s.out.push([ev, p]); return true; } return emit(ev, p); };
    io.sockets.sockets.set(String(Math.random()), s);
    io.emit('connection', s);
    return s;
  };

  // reads, all from the LEDGER
  w.bal = (key, cur) => w.ledger.balance(pacct(key, cur), cur);
  w.setBal = (key, cur, v) => { key = w.addKey(key); const d = v - w.bal(key, cur); if (d) w.service.adminAdjust(key, d, cur, 'kit-fund', `kit:fund:${w.boots}:${++counter}`); return v; };
  w.rich = (key) => { for (const c of CURS) w.setBal(key, c, 1e9); };
  w.lastId = () => w.ledger.lastId;
  w.since = (id) => [...w.ledger.entries(null, id)];
  w.house = (cur) => w.ledger.balance('house:' + A.id, cur);
  w.poolSum = (cur) => w.ledger.list('pool:' + A.id + ':', cur).reduce((n, x) => n + x.balance, 0);
  w.escrows = (cur) => { const out = []; for (const c of cur ? [cur] : CURS) for (const x of w.ledger.list('escrow:' + A.id + ':', c)) if (x.balance !== 0) out.push({ ...x, cur: c }); return out; };
  w.escrowOf = (key, rid, cur) => w.ledger.balance(`escrow:${A.id}:${key}:${rid}`, cur);
  w.audit = () => (typeof mod.audit === 'function' ? mod.audit() : { openRounds: [], pools: {} });

  w.crash = () => {
    try { if (A.crash) A.crash(mod); } catch {}
    try { w.ledger.close(); } catch {}
    hooks.crashAt = null;
  };
  w.reboot = () => { w.crash(); return boot(); };

  // ---- the driver an adapter plays through
  const g = w.g = { rng, now: clock.now, dup: null, tamper: null, extra: null, same: false, world: w };
  const collect = (sock, n0) => {
    const got = sock.out.slice(n0), pre = 'g:' + A.id + ':';
    const errs = got.filter((o) => o[0] === 'error'), res = got.filter((o) => o[0].startsWith(pre));
    // With no error event, any game event is the answer (the games' step replies do not all name a round). Beside an error event a game event only counts as a result when it LOOKS like one
    // (looksPlayed below: a round named under any usual field name, an outcome field, or an outcome event name; or what the adapter says in resultEvents / stateEvents): a refusal answered with
    // `error` plus a bare state re-sync is a refusal (RVK-1), `error` plus a round / outcome event is still a lie that the client was shown a result (R2E-13).
    const named = res.filter((o) => looksPlayed(A, o[0].slice(pre.length), o[1]));
    const played = errs.length ? named : res, top = errs.length && named.length ? named[named.length - 1] : res.length ? res[res.length - 1] : null;
    return { got, error: errs.length ? errs[errs.length - 1][1] : null, ev: top ? top[0].slice(pre.length) : null, payload: top ? top[1] : null, ok: played.length > 0, errored: errs.length > 0 };
  };
  const send1 = (sock, ev, payload, advance) => {
    if (advance) clock.advance(200);
    let p = payload;
    if (g.tamper && ev !== openEv && p && typeof p === 'object') p = { ...p, ...g.tamper };
    if (g.extra && p && typeof p === 'object' && !Array.isArray(p)) p = { ...g.extra, ...p };     // every message (the opening one too); the game's own fields win
    const n0 = sock.out.length;
    w.log.push({ key: sock.key, ev, payload: jclone(p) });
    sock.send('g:' + A.id + ':' + ev, p);
    const r = collect(sock, n0);
    if (ev === openEv && r.ok) w.accepted++;
    return r;
  };
  g.try = (sock, ev, payload) => {                                     // -> { ok, error, payload, ev, got, second? }
    const r = send1(sock, ev, payload, !g.same);
    if (g.dup) r.second = send1(sock, ev, payload, g.dup === 'later');
    return r;
  };
  g.call = (sock, ev, payload) => { const r = g.try(sock, ev, payload); if (!r.ok) throw new Refused(r); return r.payload; };

  w.boot = boot;
  boot();
  current = w;
  return w;
}

// ------------------------------------------------------------------------------------------------------------------------------------ reading the ledger
const refRe = (A) => new RegExp('^' + A.id + ':([^:]+):([^:]+)(?::(open|close))?$');
const isKit = (l) => (l.from === 'admin:adjust' && /^kit:/.test(String(l.ref))) || /^signup:/.test(String(l.ref));

// lines the game wrote that break the contract: a ref outside <game>:<key>:<roundId>[:open|:close], or an account that is not the player's own / this round's escrow / house:<game> / pool:<game>:*
function lineProblems(A, lines) {
  const out = [], re = refRe(A);
  for (const l of lines) {
    if (isKit(l)) continue;
    const m = re.exec(String(l.ref || ''));
    if (!m) { out.push(`line ${l.id} ref "${l.ref}" is not ${A.id}:<key>:<roundId>[:open|:close] (${l.from} -> ${l.to})`); continue; }
    const [, key, rid, kind] = m;
    for (const a of [l.from, l.to]) {
      const okAcct = a === pacct(key, l.cur) || a === `escrow:${A.id}:${key}:${rid}` || a === 'house:' + A.id || a.startsWith('pool:' + A.id + ':');
      if (!okAcct) out.push(`line ${l.id} (${l.ref}) touches ${a}`);
    }
    if (kind === 'open' && !(l.to === `escrow:${A.id}:${key}:${rid}`)) out.push(`line ${l.id} (${l.ref}) :open does not go into the escrow`);
  }
  return out;
}
// rounds in a set of lines: rid -> { key, curs, staked (player out), returned (player in), kinds, lines }
function roundsOf(A, lines) {
  const R = new Map(), re = refRe(A);
  for (const l of lines) {
    const m = re.exec(String(l.ref || '')); if (!m) continue;
    const [, key, rid, kind] = m;
    let r = R.get(rid); if (!r) R.set(rid, r = { rid, key, curs: new Set(), staked: 0, returned: 0, kinds: new Set(), lines: [] });
    r.curs.add(l.cur); r.kinds.add(kind || 'round'); r.lines.push(l);
    const pa = pacct(key, l.cur);
    if (l.from === pa) r.staked += l.amount;
    if (l.to === pa) r.returned += l.amount;
  }
  return R;
}
// an independent replay of money.jsonl (no ledger code): per currency account -> balance, and the first moment a holder account went negative
function replayFile(file) {
  const bal = { chips: new Map(), play: new Map() }, neg = [];
  const add = (cur, a, d, id) => { const m = bal[cur]; const v = (m.get(a) || 0) + d; m.set(a, v); if (v < 0 && /^(bank|play|escrow|seat|pot|pool):/.test(a)) neg.push(`${a} ${cur} = ${v} at line ${id}`); };
  for (const ln of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!ln) continue;
    let r; try { r = JSON.parse(ln); } catch { continue; }
    for (const it of (Array.isArray(r.batch) ? r.batch : [r])) { if (!it || !it.cur || !bal[it.cur]) continue; add(it.cur, it.from, -it.amount, r.id); add(it.cur, it.to, it.amount, r.id); }
  }
  return { bal, neg };
}

// ------------------------------------------------------------------------------------------------------------------------------------ result collection
const RESULTS = [];
let RUN_OPTS = {};
function runCheck(A, name, cur, fn) {
  const t = { fails: [], notes: [], n: 0, ok(c, msg) { this.n++; if (!c) this.fails.push(msg); return !!c; }, fail(msg) { this.n++; this.fails.push(msg); }, note(m) { this.notes.push(m); } };
  try { fn(t); } catch (e) { t.fails.push('kit/adapter error: ' + String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')); }
  const ok = !t.fails.length;
  const detail = ok ? `${t.n} assertions${t.notes.length ? '; ' + t.notes.join('; ') : ''}` : `${t.fails.length} failed of ${t.n}: ${t.fails.slice(0, 3).join(' || ')}${t.fails.length > 3 ? ' ...' : ''}`;
  RESULTS.push({ game: A.id, check: name, cur, ok, detail });
  return t;
}

// ------------------------------------------------------------------------------------------------------------------------------------ shared steps
// the most a round of bet `b` can cost: the bet itself, unless the game sells bigger rounds (a bought bonus): adapter.maxCost(b)
const maxCost = (A, b) => (A.maxCost ? A.maxCost(b) : b);
const stakeLegal = (A, s) => s === 0 || (A.maxCost ? s <= A.maxCost(A.bets.max) : A.bets.good.includes(s));
const playN = (A) => Math.max(A.bets.good.length * 2, (A.playVariants || 1) * 2) + 2;
// play one whole round with bookkeeping: -> { res, id0, lines, round }
function playOne(w, sock, cur, i) {
  const A = w.A, bet = A.bets.good[i % A.bets.good.length], id0 = w.lastId(), b0 = w.bal(sock.key, cur);
  const res = A.play(w.g, sock, { cur, bet, i });
  const lines = w.since(id0);
  return { res, bet, id0, b0, lines, round: roundsOf(A, lines).get(res.roundId) };
}
function holdOne(w, sock, pt, cur, i = 0) {
  const A = w.A, bet = A.bets.good[i % A.bets.good.length], id0 = w.lastId(), b0 = w.bal(sock.key, cur), mark = w.log.length;
  const held = pt.hold(w.g, sock, { cur, bet, i });
  held.bet = bet; held.cost = held.cost == null ? bet : held.cost; held.key = sock.key; held.cur = cur; held.id0 = id0; held.b0 = b0;
  held.msgs = w.log.slice(mark).filter((m) => m.ev !== w.openEv && m.key === sock.key);
  return held;
}
// the ledger-side facts that every closed instant/held round must show
function roundFacts(t, w, who, cur, key, o) {
  const A = w.A, p = lineProblems(A, o.lines);
  for (const m of p.slice(0, 3)) t.fail(`${who}: ${m}`);
  if (!o.round) {
    if (o.res.cost === 0 && !o.res.win) return;     // a free round that won nothing writes no line (ADD-A-GAME.md section 4)
    t.fail(`${who}: no ledger line carries round ${o.res.roundId}`); return;
  }
  const r = o.round;
  t.ok(r.curs.size === 1 && r.curs.has(cur), `${who}: round lines in ${[...r.curs].join('+')}, opened in ${cur}`);
  t.ok(r.staked === o.res.cost, `${who}: ledger took ${r.staked} from the player, the game says the round cost ${o.res.cost}`);
  if (o.res.win != null) t.ok(r.returned === o.res.win, `${who}: the client was shown win ${o.res.win}, the ledger paid ${r.returned}`);
  t.ok(w.escrowOf(key, o.res.roundId, cur) === 0, `${who}: escrow of the closed round holds ${w.escrowOf(key, o.res.roundId, cur)}`);
  const win = o.res.win != null ? o.res.win : r.returned;
  t.ok(w.bal(key, cur) === o.b0 - o.res.cost + win, `${who}: player balance ${o.b0} -> ${w.bal(key, cur)}, expected ${o.b0 - o.res.cost + win}`);
  const dh = w.house(cur) - (o.h0 || 0), dp = w.poolSum(cur) - (o.p0 || 0);
  if (o.h0 != null) t.ok(dh + dp === o.res.cost - win, `${who}: house+pool moved ${dh + dp}, stake minus win is ${o.res.cost - win}`);
  const other_ = other(cur);
  t.ok(!o.lines.some((l) => !isKit(l) && l.cur === other_), `${who}: a line in ${other_} was written`);
}

const EXAMPLE_ADAPTER = path.join(ROOT, 'games', '_example-coinflip.kit.js');
const registrationByKit = (A) => !!(A.isExample || RUN_OPTS.register);      // register: the self-test's way to run a toy whose registration is not the point

// ------------------------------------------------------------------------------------------------------------------------------------ the checks
function checkRegistration(A) {
  runCheck(A, 'registration', null, (t) => {
    const mods = registry.MODULES || [];
    const skip = registrationByKit(A);                                    // only the example adapter file, or the self-test's own toys, get their registration from the kit
    t.ok(!A.example || A.isExample, '`example: true` is set on an adapter that is not games/_example-coinflip.kit.js: a copy of the example must not copy that line (the registration check would be off)');
    if (skip) t.note('example game: house account registered by the kit for the run');
    else t.ok(mods.some((m) => path.basename(m, '.js') === path.basename(A.modPath, '.js')), `games/index.js MODULES does not list ./${path.basename(A.modPath)}`);
    const m = A.mod;
    t.ok(m && m.id === A.id, `module id ${m && m.id} != adapter id ${A.id}`);
    t.ok(m && m.handlers && typeof m.handlers === 'object', 'module has no handlers');
    t.ok(typeof m.audit === 'function', 'module has no audit()');
    t.ok(typeof m.init === 'function', 'module has no init(ctx)');
    if (!skip) {
      t.ok(L.SOURCE_ACCOUNTS.has('house:' + A.id), `house:${A.id} is not in SOURCE_ACCOUNTS (money/ledger.js)`);
      t.ok(GAMES.includes(A.id), `"${A.id}" is not in GAMES (money/service.js)`);
    }
    t.ok(typeof A.maxReturn === 'number' && A.maxReturn > 0 && A.maxReturn <= 1.5, `adapter.maxReturn must be a number in (0, 1.5]: the most the game may pay back per unit staked (got ${A.maxReturn})`);
    t.ok(A.bets && Array.isArray(A.bets.good) && A.bets.good.length > 0, 'adapter has no bets.good');
    t.ok(Array.isArray(A.heldPoints), 'adapter.heldPoints must be an array (empty for an instant game)');
  });
}

// 1. escrow open / settle / void: only ctx.money, one escrow while open, zero after, house moved by stake - win
function checkEscrow(A, cur) {
  runCheck(A, 'escrow', cur, (t) => {
    const w = world(A, { seed: 1 }), s = w.sock('ann'); w.rich('ann');
    const id00 = w.lastId(), n = playN(A);
    for (let i = 0; i < n; i++) {
      const h0 = w.house(cur), p0 = w.poolSum(cur), b0 = w.bal('ann', cur), id0 = w.lastId();
      const res = A.play(w.g, s, { cur, bet: A.bets.good[i % A.bets.good.length], i });
      roundFacts(t, w, `play#${i}`, cur, 'ann', { res, lines: w.since(id0), round: roundsOf(A, w.since(id0)).get(res.roundId), b0, h0, p0 });
    }
    t.note(`${n} rounds`);
    A.heldPoints.forEach((pt) => {
      const h0 = w.house(cur), p0 = w.poolSum(cur), id0 = w.lastId(), b0 = w.bal('ann', cur);
      const held = holdOne(w, s, pt, cur);
      const open = w.escrows(cur);
      t.ok(open.length === 1 && open[0].account === `escrow:${A.id}:ann:${held.roundId}` && open[0].balance === held.cost, `${pt.name}: open round must show exactly one escrow of ${held.cost}, ledger has ${JSON.stringify(open.map((o) => [o.account, o.balance]))}`);
      t.ok(w.bal('ann', cur) === b0 - held.cost, `${pt.name}: stake not out of the player balance (${b0} -> ${w.bal('ann', cur)})`);
      const fin = pt.finish(w.g, s, held);
      roundFacts(t, w, `${pt.name}/finish`, cur, 'ann', { res: { roundId: held.roundId, cost: held.cost, win: fin && fin.win }, lines: w.since(id0), round: roundsOf(A, w.since(id0)).get(held.roundId), b0, h0, p0 });
      t.note(`point ${pt.name}`);
    });
    for (const m of lineProblems(A, w.since(id00)).slice(0, 3)) t.fail(m);
    finalAudit(t, w, cur);
  });
}

// 2. restart mid-round (D1)
function resumeSilently(t, w, held, who) {
  const s2 = w.sock(held.key), id = w.lastId(), balsBefore = CURS.map((c) => w.bal(held.key, c));
  for (const tamper of [null, { mode: other(held.cur), cur: other(held.cur), currency: other(held.cur) }]) {
    w.g.tamper = tamper;
    for (const m of held.msgs) { try { w.g.try(s2, m.ev, m.payload); } catch {} }
    w.g.tamper = null;
  }
  t.ok(w.lastId() === id, `${who}: replaying the round's messages after the restart wrote ${w.since(id).length} line(s): ${JSON.stringify(w.since(id).slice(0, 2).map((l) => l.ref))}`);
  t.ok(CURS.every((c, i) => w.bal(held.key, c) === balsBefore[i]), `${who}: balance moved when the round's messages were replayed after the restart`);
}
function auditMatchesLedger(t, w, who) {
  const mine = new Set((w.audit().openRounds || []).map((r) => `${r.key}|${r.cur}|${r.roundId}|${r.amount}`));
  const led = new Set(w.escrows().map((e) => { const p = e.account.split(':'); return `${p[2]}|${e.cur}|${p[3]}|${e.balance}`; }));
  t.ok(mine.size === led.size && [...mine].every((x) => led.has(x)), `${who}: audit().openRounds ${JSON.stringify([...mine])} != ledger escrows ${JSON.stringify([...led])}`);
}
function afterBoot(t, w, held, who) {
  const { key, cur, roundId } = held;
  const esc = w.escrowOf(key, roundId, cur);
  const kept = (w.audit().openRounds || []).some((r) => r.roundId === roundId);
  const r = roundsOf(w.A, w.since(held.id0)).get(roundId);
  if (esc !== 0) {
    t.ok(kept, `${who}: escrow ${roundId} still holds ${esc} after boot and the game does not report it in audit()`);
    t.note(`${who}: kept open and reported`);
  } else if (r) {
    const closes = new Set(r.lines.filter((l) => /:close$/.test(l.ref)).map((l) => l.ref));
    t.ok(closes.size <= 1, `${who}: ${closes.size} close refs for one round`);
    t.ok(r.staked === held.cost, `${who}: the player staked ${r.staked}, round cost ${held.cost}`);
    if (held.bootWin != null) t.ok(r.returned === held.bootWin, `${who}: boot paid ${r.returned}, the stored record says ${held.bootWin}`);
    else t.ok(r.returned >= 0, `${who}: negative pay`);
    t.ok(w.bal(key, cur) === held.b0 - r.staked + r.returned, `${who}: balance ${held.b0} -> ${w.bal(key, cur)} does not match stake ${r.staked} / pay ${r.returned}`);
  } else t.fail(`${who}: no ledger line for the round at all`);
  t.ok(!w.since(held.id0).some((l) => !isKit(l) && l.cur === other(cur)), `${who}: a ${other(cur)} line was written for a ${cur} round`);
  auditMatchesLedger(t, w, who);
  const id2 = w.lastId(); w.reboot();
  t.ok(w.lastId() === id2, `${who}: a second boot wrote ${w.since(id2).length} line(s)`);
  resumeSilently(t, w, held, who);
}
function checkRestart(A, cur) {
  runCheck(A, 'restart', cur, (t) => {
    for (const pt of A.heldPoints) {
      const w = world(A, { seed: 2 }), s = w.sock('ann'); w.rich('ann');
      const held = holdOne(w, s, pt, cur);
      w.reboot();
      afterBoot(t, w, held, `kill at ${pt.name}`);
      finalAudit(t, w, cur);
    }
    // a crash between the ledger write and the game's own state, at every ctx.money call a round makes (before and after it)
    const variants = A.playVariants || 1;
    let worlds = 0;
    for (let i = 0; i < variants; i++) {
      const rec = world(A, { seed: 3 }), rs = rec.sock('ann'); rec.rich('ann');
      rec.hooks.seq = 0; rec.hooks.calls.length = 0;
      const o = playOne(rec, rs, cur, i);
      const nCalls = rec.hooks.seq;
      void o;
      for (let k = 0; k < nCalls; k++) for (const phase of ['before', 'after']) {
        const w = world(A, { seed: 3 }), s = w.sock('ann'); w.rich('ann');
        w.hooks.seq = 0; w.hooks.fired = false; w.hooks.crashAt = { k, phase };
        const b0 = w.bal('ann', cur), id0 = w.lastId(), bet = A.bets.good[i % A.bets.good.length], mark = w.log.length;
        try { A.play(w.g, s, { cur, bet, i }); } catch { /* the crash lands as an error: fine */ }
        const who = `play#${i} crash ${phase} money call ${k}`;
        t.ok(w.hooks.fired, `${who}: the crash point was never reached (the round made fewer money calls this time)`);
        const msgs = w.log.slice(mark).filter((m) => m.ev !== w.openEv && m.key === 'ann');
        w.reboot(); worlds++;
        const esc = w.escrows(cur), kept = new Set((w.audit().openRounds || []).map((r) => r.roundId));
        t.ok(esc.every((e) => kept.has(e.account.split(':')[3])), `${who}: escrow left open after boot and not reported: ${JSON.stringify(esc.map((e) => [e.account, e.balance]))}`);
        auditMatchesLedger(t, w, who);
        const rounds = roundsOf(A, w.since(id0));
        for (const r of rounds.values()) {
          t.ok(r.curs.size <= 1 && (r.curs.size === 0 || r.curs.has(cur)), `${who}: round ${r.rid} has lines in ${[...r.curs]}`);
          t.ok(r.staked <= maxCost(A, bet), `${who}: the player staked ${r.staked} > the most a bet of ${bet} can cost (${maxCost(A, bet)})`);
          t.ok(new Set(r.lines.filter((l) => /:close$/.test(l.ref)).map((l) => l.ref)).size <= 1, `${who}: more than one close for ${r.rid}`);
        }
        t.ok(w.bal('ann', cur) >= b0 - maxCost(A, bet), `${who}: lost more than the stake (${b0} -> ${w.bal('ann', cur)})`);
        for (const m of lineProblems(A, w.since(id0)).slice(0, 2)) t.fail(`${who}: ${m}`);
        const id2 = w.lastId(); w.reboot();
        t.ok(w.lastId() === id2, `${who}: a second boot wrote lines`);
        resumeSilently(t, w, { key: 'ann', cur, msgs }, who);
        finalAudit(t, w, cur, who);
      }
    }
    t.note(`${A.heldPoints.length} held points, ${worlds} crash points`);
  });
}

// 3. double submit / replay
function checkReplay(A, cur) {
  runCheck(A, 'replay', cur, (t) => {
    for (const dup of ['imm', 'later']) {
      const w = world(A, { seed: 4 }), s = w.sock('ann'); w.rich('ann');
      w.g.dup = dup; w.accepted = 0;
      const id00 = w.lastId(), n = Math.min(playN(A), 8), done = [];
      for (let i = 0; i < n; i++) {
        const mark = w.log.length, id0 = w.lastId();
        const res = A.play(w.g, s, { cur, bet: A.bets.good[i % A.bets.good.length], i });
        const lines = w.since(id0), round = roundsOf(A, lines).get(res.roundId);
        done.push({ res, msgs: w.log.slice(mark).filter((m) => m.ev !== w.openEv) });
        if (!round) {
          if (res.cost === 0 && !res.win) continue;      // a free round that won nothing writes no line (ADD-A-GAME.md section 4): the same rule roundFacts applies
          t.fail(`${dup} play#${i}: no ledger line for round ${res.roundId}`); continue;
        }
        t.ok(round.staked === res.cost, `${dup} play#${i}: staked ${round.staked}, round cost ${res.cost}`);
        if (res.win != null) t.ok(round.returned === res.win, `${dup} play#${i}: shown win ${res.win}, ledger paid ${round.returned}`);
        // every other round the doubled messages may have made must be a whole round of its own: a stake, one escrow or settled
        for (const r of roundsOf(A, lines).values()) {
          t.ok(stakeLegal(A, r.staked), `${dup} play#${i}: round ${r.rid} staked ${r.staked}, not a legal stake`);
          t.ok(new Set(r.lines.filter((l) => /:close$/.test(l.ref)).map((l) => l.ref)).size <= 1, `${dup} play#${i}: round ${r.rid} closed twice`);
        }
      }
      A.heldPoints.forEach((pt) => {
        const mark = w.log.length, held = holdOne(w, s, pt, cur);
        const fin = pt.finish(w.g, s, held);
        const r = roundsOf(A, w.since(held.id0)).get(held.roundId);
        if (r && fin && fin.win != null) t.ok(r.returned === fin.win, `${dup} ${pt.name}: shown win ${fin.win}, ledger paid ${r.returned}`);
        done.push({ res: { roundId: held.roundId }, msgs: w.log.slice(mark).filter((m) => m.ev !== w.openEv) });
      });
      const rounds = roundsOf(A, w.since(id00));
      const open = rounds.size;
      t.ok(open <= w.accepted + A.heldPoints.length, `${dup}: ${open} rounds in the ledger for ${w.accepted} accepted opens`);
      // replay everything after the close
      w.g.dup = null;
      const id1 = w.lastId(), balsBefore = CURS.map((c) => w.bal('ann', c)), s2 = w.sock('ann');
      for (const d of done) for (const m of d.msgs) { try { w.g.try(s2, m.ev, m.payload); } catch {} }
      t.ok(w.lastId() === id1, `${dup}: replaying the messages of closed rounds wrote ${w.since(id1).length} line(s): ${JSON.stringify(w.since(id1).slice(0, 2).map((l) => l.ref))}`);
      t.ok(CURS.every((c, i) => w.bal('ann', c) === balsBefore[i]), `${dup}: a replay after the close moved a balance`);
      for (const m of lineProblems(A, w.since(id00)).slice(0, 3)) t.fail(`${dup}: ${m}`);
      finalAudit(t, w, cur, dup);
    }
  });
}

// 4. two sockets, one account
function checkSockets(A, cur) {
  runCheck(A, 'sockets', cur, (t) => {
    const bet = A.bets.good[0];
    // a balance that pays one bet and a half (the funds race), and one that pays five (the one-open-round rule)
    for (const start of [bet + Math.floor(bet / 2), bet * 5]) for (const same of [true, false]) for (const N of [2, 10]) {
      const who = `${N} sockets ${same ? 'same tick' : 'spaced'}, balance ${start}`;
      const w = world(A, { seed: 5 }); w.setBal('ann', cur, start); w.setBal('ann', other(cur), 1e9);
      const socks = Array.from({ length: N }, () => w.sock('ann'));
      w.g.same = same; w.accepted = 0;
      const id0 = w.lastId();
      const o = A.open(cur, bet);
      for (const s of socks) w.g.try(s, o.ev, o.payload);
      // different money messages in the same tick: the follow-ups of whatever was accepted, from every socket, twice
      const pt = A.heldPoints[0];
      if (pt) {
        const held = (() => { try { const x = holdOne(w, socks[0], pt, cur); return x; } catch { return null; } })();
        if (held) for (let r = 0; r < 2; r++) for (const s of socks) for (const m of held.msgs) w.g.try(s, m.ev, m.payload);
        if (held) { try { pt.finish(w.g, socks[1 % N], held); } catch { /* may be refused: fine */ } }
      }
      w.g.same = false;
      const bal = w.bal('ann', cur), lines = w.since(id0), rounds = roundsOf(A, lines);
      t.ok(bal >= 0, `${who}: negative balance ${bal}`);
      t.ok(CURS.every((c) => w.bal('ann', c) >= 0), `${who}: a negative player balance`);
      for (const r of rounds.values()) t.ok(stakeLegal(A, r.staked), `${who}: round ${r.rid} staked ${r.staked}, not a legal stake`);
      const open = w.escrows(cur);
      if (A.oneOpen) t.ok(open.length <= 1, `${who}: ${open.length} open rounds for one account, the game says one`);
      t.ok(open.every((e) => stakeLegal(A, e.balance)), `${who}: an escrow of ${JSON.stringify(open.map((e) => e.balance))} is not a bet`);
      const staked = [...rounds.values()].reduce((n, r) => n + r.staked, 0), returned = [...rounds.values()].reduce((n, r) => n + r.returned, 0);
      t.ok(staked - returned <= start, `${who}: net debit ${staked - returned} > the balance ${start}`);
      t.ok(bal === start - staked + returned, `${who}: balance ${bal} != ${start} - ${staked} + ${returned}`);
      for (const m of lineProblems(A, lines).slice(0, 2)) t.fail(`${who}: ${m}`);
      finalAudit(t, w, cur, who);
    }
  });
}

// 5. Cash and Chips never mix
function checkMix(A, cur) {
  runCheck(A, 'mix', cur, (t) => {
    const oth = other(cur), tamper = { mode: oth, cur: oth, currency: oth, wmode: oth };
    const w = world(A, { seed: 6 }), s = w.sock('ann'); w.rich('ann');
    const otherBefore = { bal: w.bal('ann', oth), house: w.house(oth), pool: w.poolSum(oth) }, id0 = w.lastId();
    w.g.tamper = tamper;                                                   // every message after the opening one claims the other currency
    for (let i = 0; i < Math.min(playN(A), 6); i++) {
      const o = playOne(w, s, cur, i);
      roundFacts(t, w, `play#${i}`, cur, 'ann', o);
    }
    for (const pt of A.heldPoints) {
      const held = holdOne(w, s, pt, cur);
      t.ok(w.escrowOf('ann', held.roundId, cur) === held.cost, `${pt.name}: the stake is not in the ${cur} escrow`);
      t.ok(w.escrowOf('ann', held.roundId, oth) === 0, `${pt.name}: an escrow appeared in ${oth}`);
      // while it is open, a second round in the OTHER currency is its own round with its own escrow, never a resume of the first
      w.g.tamper = null;
      let second = null; try { second = holdOne(w, w.sock('ann'), pt, oth, 1); } catch { /* refused: fine */ }
      w.g.tamper = tamper;
      t.ok(w.escrowOf('ann', held.roundId, cur) === held.cost, `${pt.name}: opening in ${oth} touched the ${cur} round`);
      const fin = pt.finish(w.g, s, held);
      const r = roundsOf(A, w.since(held.id0)).get(held.roundId);
      t.ok(r && r.curs.size === 1 && r.curs.has(cur), `${pt.name}: closed with lines in ${r && [...r.curs]} though opened in ${cur}`);
      if (fin && fin.win != null && r) t.ok(r.returned === fin.win, `${pt.name}: shown win ${fin.win}, ledger paid ${r.returned}`);
      if (second) { try { pt.finish(w.g, w.sock('ann'), second); } catch { /* the first socket's finish may have taken the single slot */ } }
      // a restart in the middle, then the follow-ups come back claiming the other currency
      const h2 = holdOne(w, s, pt, cur, 2); w.reboot();
      const bals = CURS.map((c) => w.bal('ann', c)), idb = w.lastId();
      const s2 = w.sock('ann'); for (const m of h2.msgs) { try { w.g.try(s2, m.ev, m.payload); } catch {} }
      t.ok(w.lastId() === idb && CURS.every((c, i) => w.bal('ann', c) === bals[i]), `${pt.name}: a held round resumed after a restart with the other currency's mode wrote lines`);
    }
    w.g.tamper = null;
    // the other currency saw only what the second rounds did: with no second rounds it must be untouched; with them, per-currency books must still balance
    const lines = w.since(id0);
    for (const m of lineProblems(A, lines).slice(0, 3)) t.fail(m);
    const rounds = roundsOf(A, lines);
    for (const r of rounds.values()) t.ok(r.curs.size <= 1, `round ${r.rid} has lines in both currencies: ${[...r.curs]}`);
    if (!A.heldPoints.length) t.ok(w.bal('ann', oth) === otherBefore.bal && w.house(oth) === otherBefore.house && w.poolSum(oth) === otherBefore.pool, `${oth} balance / house / pool moved by ${cur} play`);
    t.ok(!lines.some((l) => isKit(l) === false && (l.from.startsWith('fx:') || l.to.startsWith('fx:'))), 'an fx account was touched');
    finalAudit(t, w, cur);
  });
}

// 6. money errors are errors
function checkErrors(A, cur) {
  runCheck(A, 'errors', cur, (t) => {
    const fence = (w) => fs.appendFileSync(w.files.money, '\n');         // one foreign byte: the ledger latches `foreign_write` for the life of the process
    // instant rounds
    {
      const w = world(A, { seed: 7 }), s = w.sock('ann'); w.rich('ann');
      playOne(w, s, cur, 0);
      const b0 = w.bal('ann', cur), id0 = w.lastId();
      fence(w);
      for (let i = 0; i < 3; i++) {
        let shown = null;
        try { shown = A.play(w.g, s, { cur, bet: A.bets.good[i % A.bets.good.length], i }); } catch (e) { if (!(e instanceof Refused)) throw e; }
        if (shown) t.fail(`ledger fenced: play#${i} showed the client a result (win ${shown.win}); nothing was written`);
      }
      t.ok(w.lastId() === id0, 'ledger fenced: lines appeared');
      w.reboot();
      t.ok(w.bal('ann', cur) === b0, `after the restart the balance is ${w.bal('ann', cur)}, was ${b0}: something kept in memory was paid or lost`);
      // and nothing is carried into the next round
      const o = playOne(w, w.sock('ann'), cur, 1);
      roundFacts(t, w, 'round after the outage', cur, 'ann', o);
      finalAudit(t, w, cur, 'instant');
    }
    // a held round: the ledger dies while it is open
    for (const pt of A.heldPoints) {
      const w = world(A, { seed: 8 }), s = w.sock('ann'); w.rich('ann');
      const held = holdOne(w, s, pt, cur);
      const id0 = w.lastId();
      fence(w);
      let shown = null;
      try { shown = pt.finish(w.g, s, held); } catch (e) { if (!(e instanceof Refused)) throw e; }
      if (shown && shown.win != null && w.lastId() === id0) t.fail(`${pt.name}: ledger fenced: finish showed a result (win ${shown.win}) with no ledger line`);
      let again = null; try { again = A.play(w.g, w.sock('ann'), { cur, bet: A.bets.good[0], i: 0 }); } catch (e) { if (!(e instanceof Refused)) throw e; }
      if (again) t.fail(`${pt.name}: ledger fenced: a new round was played (win ${again.win})`);
      t.ok(w.lastId() === id0 || roundsOf(A, w.since(id0)).size === 0 || !!shown, `${pt.name}: lines written on a fenced ledger`);
      w.reboot();
      afterBoot(t, w, held, `${pt.name} fenced`);
      const o = playOne(w, w.sock('ann'), cur, 1);
      roundFacts(t, w, `${pt.name}: round after the outage`, cur, 'ann', o);
      finalAudit(t, w, cur, pt.name);
    }
  });
}

// 7. unknown-source quarantine
function checkQuarantine(A, cur) {
  runCheck(A, 'quarantine', cur, (t) => {
    const w = world(A, { seed: 9 }), s = w.sock('ann'); w.rich('ann');
    playOne(w, s, cur, 0);
    w.crash();
    const base = w.ledger.lastId, q0 = w.ledger.quarantined.length;
    const rogue = (id, from, to, ref) => JSON.stringify({ id, ts: 1, from, to, amount: 777, cur, reason: A.id + ':credit', ref });
    const lines = [
      rogue(base + 1, 'mint:' + A.id, pacct('ann', cur), `${A.id}:ann:rogue1`),                    // a source that is not in SOURCE_ACCOUNTS
      rogue(base + 2, `house:${A.id}x`, pacct('ann', cur), `${A.id}:ann:rogue2`),                  // another game's house that does not exist
      rogue(base + 3, 'house:' + A.id, pacct('ann', other(cur)), `${A.id}:ann:rogue3`),            // a currency mismatch on a player account
    ];
    fs.appendFileSync(w.files.money, lines.join('\n') + '\n');
    const b0 = [w.bal('ann', cur)];
    w.boot();
    t.ok(w.ledger.quarantined.length - q0 >= 3, `${w.ledger.quarantined.length - q0} of 3 rogue lines quarantined at boot`);
    t.ok(!w.ledger.has(`${A.id}:ann:rogue1`) && !w.ledger.has(`${A.id}:ann:rogue2`) && !w.ledger.has(`${A.id}:ann:rogue3`), 'a rogue line was applied');
    t.ok(w.bal('ann', cur) === b0[0], `balance moved by a quarantined line (${b0[0]} -> ${w.bal('ann', cur)})`);
    t.ok(fs.existsSync(w.ledger.quarantineFile), 'no .quarantine file written');
    const o = playOne(w, w.sock('ann'), cur, 1);                                                     // the game still plays
    roundFacts(t, w, 'round after the quarantine', cur, 'ann', o);
  });
}

// 8. ledger replay == balances (run at the end of every other check's world, and once on a mixed world)
function finalAudit(t, w, cur, label) {
  const who = label ? label + ': ' : '';
  try { w.ledger.sync && w.ledger.sync(); } catch {}
  const rp = replayFile(w.files.money);
  for (const c of CURS) {
    const mine = rp.bal[c], led = new Map(w.ledger.list('', c).map((x) => [x.account, x.balance]));
    let sum = 0, diff = [];
    for (const [a, v] of mine) { sum += v; if ((led.get(a) || 0) !== v) diff.push(`${a} replay ${v} vs service ${led.get(a) || 0}`); }
    for (const [a, v] of led) if (v !== 0 && !mine.has(a)) diff.push(`${a} service ${v} vs replay 0`);
    FINAL.n++;
    if (diff.length) FINAL.fails.push(`${who}${c}: replay != balances: ${diff.slice(0, 2).join('; ')}`);
    if (sum !== 0) FINAL.fails.push(`${who}${c}: the sum over all accounts is ${sum}, not 0`);
  }
  // the game's own count of its pools (audit().pools) equals the ledger's, per currency; a ledger pool the game does not list holds nothing
  try {
    const mine = (w.audit() || {}).pools || {};
    for (const c of CURS) {
      const led = new Map(w.ledger.list('pool:' + w.A.id + ':', c).map((x) => [x.account.slice(('pool:' + w.A.id + ':').length), x.balance]));
      for (const [name, v] of Object.entries(mine)) if ((v && v[c] || 0) !== (led.get(name) || 0)) FINAL.fails.push(`${who}pool ${name} ${c}: audit() says ${v && v[c]}, the ledger holds ${led.get(name) || 0}`);
      for (const [name, v] of led) if (v !== 0 && !(name in mine)) FINAL.fails.push(`${who}pool ${name} ${c}: the ledger holds ${v} and audit() does not list it`);
    }
  } catch (e) { FINAL.fails.push(`${who}audit() threw: ${e && e.message}`); }
  if (rp.neg.length) FINAL.fails.push(`${who}a holder account went negative in the replay: ${rp.neg[0]}`);
  const q = w.ledger.quarantined.length; if (q) FINAL.fails.push(`${who}${q} line(s) quarantined in a world with no rogue line`);
}
const FINAL = { n: 0, fails: [] };
function checkLedger(A) {
  // a mixed world: the adapter's currencies (one or both), rounds, a kill, doubles. A currency the adapter leaves out is not played here (the refuse check asks the game about it)
  const curs = CURS.filter((c) => !A.currencies || A.currencies.includes(c));
  for (const cur of curs) runCheck(A, 'ledger', cur, (t) => {
    const w = world(A, { seed: 10 }), s = w.sock('ann'), s2 = w.sock('bob'); w.rich('ann'); w.rich('bob');
    for (const c of curs) for (let i = 0; i < 6; i++) playOne(w, i % 2 ? s : s2, c, i);
    for (const pt of A.heldPoints) { holdOne(w, s, pt, cur); w.reboot(); }
    if (curs.includes(other(cur))) for (const pt of A.heldPoints) { const h = holdOne(w, w.sock('ann'), pt, other(cur)); try { pt.finish(w.g, w.sock('ann'), h); } catch {} }
    w.g.dup = 'imm'; for (let i = 0; i < 4; i++) { try { playOne(w, w.sock('bob'), cur, i); } catch {} } w.g.dup = null;
    finalAudit(t, w, cur, 'mixed world');
    t.n += 1;
  });
}

// 9. bad input
function checkInput(A, cur) {
  runCheck(A, 'input', cur, (t) => {
    const w = world(A, { seed: 11 }), s = w.sock('ann'), bob = w.sock('bob'); w.rich('ann'); w.rich('bob');
    const good = A.bets.good[0], max = A.bets.max, min = A.bets.min;
    const bets = [-good, 0, good + 0.5, NaN, Infinity, -Infinity, String(good), '', null, undefined, {}, [], [good], true, 2 ** 53, 1e21, max + 1, max * 1000];
    if (min > 1) bets.push(min - 1);
    const bad = (label, o) => {
      const id0 = w.lastId(), b = CURS.map((c) => w.bal('ann', c));
      let r; try { r = w.g.try(s, o.ev, o.payload); } catch (e) { t.fail(`${label}: the handler threw out to the socket: ${e.message}`); return; }
      t.ok(!r.ok, `${label}: accepted (${JSON.stringify(r.payload).slice(0, 80)})`);
      t.ok(w.lastId() === id0, `${label}: wrote ${w.since(id0).length} ledger line(s) before refusing`);
      t.ok(CURS.every((c, i) => w.bal('ann', c) === b[i]), `${label}: a balance moved`);
    };
    for (const b of bets) bad(`bet ${typeof b === 'number' ? b : JSON.stringify(b) || String(b)}`, A.open(cur, b));
    for (const c of ['gold', '', null, undefined, 'PLAY', 'Chips', 7, ['play'], { toString: () => 'play' }]) bad(`mode ${typeof c === 'string' ? JSON.stringify(c) : String(c)}`, A.open(c, good));
    for (const junk of [undefined, null, 5, 'x', []]) bad(`payload ${JSON.stringify(junk)}`, { ev: w.openEv, payload: junk });
    // another account's round id
    const pt = A.heldPoints[0];
    if (pt) {
      const held = holdOne(w, s, pt, cur);
      const id0 = w.lastId(), b = [w.bal('ann', cur), w.bal('bob', cur), w.escrowOf('ann', held.roundId, cur)];
      for (const m of held.msgs) { try { w.g.try(bob, m.ev, m.payload); } catch {} }
      t.ok(w.lastId() === id0 && w.bal('ann', cur) === b[0] && w.bal('bob', cur) === b[1] && w.escrowOf('ann', held.roundId, cur) === b[2], "another account's round id: sending the owner's messages from a second account changed money");
      try { pt.finish(w.g, s, held); } catch { /* fine */ }
    }
    finalAudit(t, w, cur);
  });
}


// 10. the account a round is played on is the SIGNED-IN socket's, never one the message names (R2E-5)
const ID_FIELDS = ['key', 'acct', 'account', 'name', 'user', 'username', 'userId', 'player', 'owner', 'email'];
function checkIdentity(A, cur) {
  runCheck(A, 'identity', cur, (t) => {
    const w = world(A, { seed: 13 }), s = w.sock('mallory'); w.sock('victim'); w.rich('mallory'); w.rich('victim');
    const extra = {}; for (const f of ID_FIELDS) extra[f] = 'victim';
    const vb = CURS.map((c) => w.bal('victim', c)), id0 = w.lastId();
    w.g.extra = extra;                                                      // every message carries the victim's key in every likely field
    let played = 0;
    const tryRound = (fn) => { try { fn(); played++; } catch (e) { if (!(e instanceof Refused)) throw e; } };
    for (let i = 0; i < Math.min(playN(A), 6); i++) tryRound(() => playOne(w, s, cur, i));
    for (const pt of A.heldPoints) tryRound(() => { const held = holdOne(w, s, pt, cur); pt.finish(w.g, s, held); });
    w.g.extra = null;
    const lines = w.since(id0).filter((l) => !isKit(l));
    const bad = lines.filter((l) => /victim/.test(`${l.from} ${l.to} ${l.ref}`));
    for (const l of bad.slice(0, 3)) t.fail(`a message from mallory naming "victim" wrote line ${l.id} ${l.ref} (${l.from} -> ${l.to}, ${l.amount})`);
    t.ok(CURS.every((c, i) => w.bal('victim', c) === vb[i]), `the victim's balance moved (${vb} -> ${CURS.map((c) => w.bal('victim', c))}) though the victim sent nothing`);
    t.ok(lines.every((l) => !l.ref || new RegExp('^' + A.id + ':mallory:').test(l.ref)), 'a ledger line of the run is not on the sender\'s own key');
    t.note(`${played} round(s) played with ${ID_FIELDS.length} identity fields set`);
    finalAudit(t, w, cur, 'identity');
  });
}

// 11. nothing is carried from Chips into Cash (R2E-3, R2E-4): a token, a pot, a streak kept in memory or in the game's own file pays Cash it did not earn in Cash
// The same seeded Cash rounds are played on (A) a fresh world, (B) a world that first played Chips rounds on both accounts, (C) a fresh world restarted after every round.
// What the Cash rounds paid, read off the LEDGER round by round, must be the same in all three.
function carryRun(A, seed, mode) {
  const w = world(A, { seed }); let a = w.sock('ann'), b = w.sock('bob'); w.rich('ann'); w.rich('bob');
  const rounds = (id0) => [...roundsOf(A, w.since(id0)).values()].filter((r) => r.curs.has('play')).map((r) => [r.staked, r.returned]);
  const n = 3 * playN(A);
  if (mode === 'chips-first') for (let i = 0; i < n; i++) { try { A.play(w.g, i % 2 ? a : b, { cur: 'chips', bet: A.bets.good[i % A.bets.good.length], i }); } catch (e) { if (!(e instanceof Refused)) throw e; } }
  w.reseed(seed + 1);
  const out = { ann: [], bob: [] };
  for (let i = 0; i < playN(A); i++) {
    for (const [who, s] of [['ann', a], ['bob', b]]) {
      const id0 = w.lastId();
      try { A.play(w.g, s, { cur: 'play', bet: A.bets.good[i % A.bets.good.length], i }); } catch (e) { if (!(e instanceof Refused)) throw e; }
      out[who].push(rounds(id0));
    }
    if (mode === 'restart') { w.reboot(); a = w.sock('ann'); b = w.sock('bob'); }
  }
  return out;
}
function checkCarry(A) {
  runCheck(A, 'carry', null, (t) => {
    const fresh = carryRun(A, 77, 'fresh'), again = carryRun(A, 77, 'fresh');
    const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
    if (!t.ok(same(fresh, again), 'two fresh worlds with the same seed paid different Cash (the game does not draw only from ctx.rng, ADD-A-GAME.md 6.6): the comparison below would mean nothing')) return;
    const diff = (x, y) => { for (const who of ['ann', 'bob']) for (let i = 0; i < x[who].length; i++) if (!same(x[who][i], y[who][i])) return `${who} Cash round #${i}: fresh world [staked, paid] ${JSON.stringify(x[who][i])}, here ${JSON.stringify(y[who][i])}`; return null; };
    const chips = carryRun(A, 77, 'chips-first'), d1 = diff(fresh, chips);
    t.ok(!d1, `Cash pays differ after Chips rounds were played (something earned in Chips was spent in Cash): ${d1}`);
    const rest = carryRun(A, 77, 'restart'), d2 = diff(fresh, rest);
    t.ok(!d2, `Cash pays differ after a restart between rounds (something kept in memory changed a later pay): ${d2}`);
    t.note(`${fresh.ann.length * 2} Cash rounds compared, 3 worlds`);
  });
}

// 12. a dropped socket strands no stake (R2E-12): open a held round, drop the socket (the page reloaded, the phone lost its signal). Then either the stake is back / settled
// (escrow 0, lines consistent) or the round is still open, audit() lists it, and signing in again lets the player finish it. An escrow nothing knows about is a failure.
function checkDisconnect(A, cur) {
  if (!A.heldPoints.length) { if (cur === CURS[0]) RESULTS.push({ game: A.id, check: 'disconnect', cur: null, ok: true, skip: true, detail: 'no held round: an instant game has nothing open when a socket drops' }); return; }
  runCheck(A, 'disconnect', cur, (t) => {
    for (const pt of A.heldPoints) {
      const w = world(A, { seed: 14 }), s = w.sock('ann'); w.rich('ann');
      const who = `drop at ${pt.name}`, held = holdOne(w, s, pt, cur);
      s.send('disconnect');                                                  // what socket.io emits on the server side when the client goes away
      const esc = w.escrowOf('ann', held.roundId, cur), knows = (w.audit().openRounds || []).some((r) => r.roundId === held.roundId);
      if (esc !== 0) {
        t.ok(knows, `${who}: escrow ${held.roundId} still holds ${esc} after the socket dropped and audit() does not list the round: nothing knows about this money`);
        let fin = null; try { fin = pt.finish(w.g, w.sock('ann'), held); } catch (e) { if (!(e instanceof Refused)) throw e; t.fail(`${who}: the round is open in the ledger (${esc}) but the player, signed in again, cannot finish it: ${JSON.stringify(e.reply && e.reply.error)}`); }
        if (fin) {
          const r = roundsOf(A, w.since(held.id0)).get(held.roundId);
          t.ok(w.escrowOf('ann', held.roundId, cur) === 0, `${who}: finishing the round after signing in again left its escrow open`);
          if (r && fin.win != null) t.ok(r.returned === fin.win, `${who}: shown win ${fin.win}, ledger paid ${r.returned}`);
        }
      } else {
        const r = roundsOf(A, w.since(held.id0)).get(held.roundId);
        t.ok(!!r && r.staked === held.cost, `${who}: escrow is 0 but the round has no ledger lines of ${held.cost} (the stake went nowhere)`);
        t.ok(!knows, `${who}: the round is closed in the ledger and audit() still lists it`);
        if (r) t.ok(w.bal('ann', cur) === held.b0 - r.staked + r.returned, `${who}: balance ${held.b0} -> ${w.bal('ann', cur)} does not match stake ${r.staked} / pay ${r.returned}`);
      }
      auditMatchesLedger(t, w, who);
      t.ok(!w.since(held.id0).some((l) => !isKit(l) && l.cur === other(cur)), `${who}: a ${other(cur)} line was written for a ${cur} round`);
      for (const m of lineProblems(A, w.since(held.id0)).slice(0, 2)) t.fail(`${who}: ${m}`);
      finalAudit(t, w, cur, who);
    }
  });
}

// 13. a currency the adapter leaves out is a currency the game must REFUSE (R2E-8): `currencies: ['chips']` switches the Cash checks off, so the kit asks the game directly
function checkRefuses(A, cur) {
  runCheck(A, 'refuse', cur, (t) => {
    const w = world(A, { seed: 15 }), s = w.sock('ann'); w.rich('ann');
    const id0 = w.lastId(), b = CURS.map((c) => w.bal('ann', c));
    for (let i = 0; i < 3; i++) {
      const bet = A.bets.good[i % A.bets.good.length], o = A.open(cur, bet);
      let r; try { r = w.g.try(s, o.ev, o.payload); } catch (e) { t.fail(`${cur} bet ${bet}: the handler threw out to the socket: ${e.message}`); continue; }
      t.ok(!r.ok, `the adapter says this game has no ${cur} mode, and the game took a ${cur} bet of ${bet} (answer ${JSON.stringify(r.payload).slice(0, 80)})`);
    }
    for (let i = 0; i < 3; i++) {
      let shown = null; try { shown = A.play(w.g, s, { cur, bet: A.bets.good[i % A.bets.good.length], i }); } catch (e) { if (!(e instanceof Refused)) throw e; }
      t.ok(!shown, `the adapter says this game has no ${cur} mode, and a whole ${cur} round was played (win ${shown && shown.win})`);
    }
    const lines = w.since(id0).filter((l) => !isKit(l));
    t.ok(!lines.some((l) => l.cur === cur), `${lines.filter((l) => l.cur === cur).length} ledger line(s) in ${cur} for a game that has no ${cur} mode`);
    t.ok(w.since(id0).length === 0 || w.bal('ann', cur) === b[CURS.indexOf(cur)], `the ${cur} balance moved (${b[CURS.indexOf(cur)]} -> ${w.bal('ann', cur)})`);
    finalAudit(t, w, cur, 'refuse');
  });
}

// 14. what a round pays against its stake (R2E-6): a coarse ceiling. Over a seeded run of PAYBACK_ROUNDS rounds at the smallest bet and at a large one, in each currency, what the
// LEDGER paid back to the player divided by what it took from the player is at most the adapter's `maxReturn`. Catches a rounding that always rounds up at a small bet, a price
// that is not charged, a pay table that pays more than it says. It is a ceiling, not an exact RTP: the seed is fixed, so the measured value is the same on every run.
const PAYBACK_ROUNDS = Number(process.env.KIT_PAYBACK_ROUNDS) || 20000;     // an adapter whose rounds are slow (a store write per decision) may declare fewer: paybackRounds
function checkPayback(A, cur) {
  runCheck(A, 'payback', cur, (t) => {
    const N = process.env.KIT_PAYBACK_ROUNDS ? PAYBACK_ROUNDS : (A.paybackRounds || PAYBACK_ROUNDS);
    if (!(typeof A.maxReturn === 'number' && A.maxReturn > 0)) { t.fail('the adapter has no maxReturn (a number: the most the game may pay back per unit staked, e.g. 0.98 for a 96% table plus the noise of the seeded run)'); return; }
    const good = [...A.bets.good].sort((x, y) => x - y), bets = [...new Set([good[0], good[good.length - 1]])];
    for (const [bi, bet] of bets.entries()) {
      const w = world(A, { seed: 16 + bi }), s = w.sock('ann'); w.rich('ann');
      w.addKey('ann'); const acct = pacct('ann', cur), id0 = w.lastId();
      let n = 0, played = 0;
      for (; n < N; n++) {
        try { A.play(w.g, s, { cur, bet, i: n }); played++; } catch (e) { if (!(e instanceof Refused)) throw e; break; }
        s.out.length = 0; w.log.length = 0; w.hooks.calls.length = 0;          // 20,000 rounds of grids would be gigabytes
      }
      let staked = 0, returned = 0;
      for (const l of w.since(id0)) { if (isKit(l)) continue; if (l.from === acct && l.cur === cur) staked += l.amount; if (l.to === acct && l.cur === cur) returned += l.amount; }
      t.ok(played === N, `bet ${bet}: only ${played} of ${N} rounds were accepted`);
      t.ok(staked > 0, `bet ${bet}: nothing was staked`);
      const ret = staked > 0 ? returned / staked : 0;
      t.ok(ret <= A.maxReturn, `bet ${bet}: the ledger paid back ${returned} of ${staked} staked = ${(100 * ret).toFixed(2)}% over ${played} rounds, above the declared maxReturn ${(100 * A.maxReturn).toFixed(2)}%`);
      t.note(`bet ${bet}: ${(100 * ret).toFixed(2)}% of ${staked} over ${played} rounds`);
      w.crash(); current = null;
    }
  });
}

// ------------------------------------------------------------------------------------------------------------------------------------ driver
function loadAdapter(id) {
  const dir = path.join(ROOT, 'games');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.kit.js'))) {
    const a = require(path.join(dir, f));
    if (a.id === id) return finishAdapter(a, path.join(dir, f));
  }
  return null;
}
function finishAdapter(a, file) {
  const modFile = a.mod ? (a.modPath || a.id + '.js') : path.join(path.dirname(file), a.module || (a.id + '.js'));   // a.mod given = the self-test's toy
  a = Object.assign({}, a, { modPath: modFile, mod: a.mod || require(modFile), oneOpen: !!a.oneOpen, file, isExample: path.resolve(file) === EXAMPLE_ADAPTER });
  if (!a.heldPoints) a.heldPoints = [];
  return a;
}
function runGame(id) {
  let A;
  try { A = loadAdapter(id); } catch (e) { RESULTS.push({ game: id, check: 'adapter', cur: null, ok: false, detail: 'adapter failed to load: ' + String(e && e.message) }); return; }
  if (!A) { RESULTS.push({ game: id, check: 'adapter', cur: null, ok: false, detail: `no games/${id}.kit.js adapter (ADD-A-GAME.md "the kit")` }); return; }
  runAdapter(A);
}
function runAdapter(A, opts) {
  RUN_OPTS = opts || {};
  const savedEnv = {}, env = Object.assign({ NODE_ENV: undefined }, A.env || {});
  for (const k of Object.keys(env)) { savedEnv[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  // an example / toy game is not in the money rules: the kit registers it for the run (a real game must already be: the registration check)
  const byKit = registrationByKit(A), addedHouse = byKit && !L.SOURCE_ACCOUNTS.has('house:' + A.id), addedGame = byKit && !GAMES.includes(A.id);
  if (addedHouse) L.SOURCE_ACCOUNTS.add('house:' + A.id);
  if (addedGame) GAMES.push(A.id);
  FINAL.n = 0; FINAL.fails = [];
  try {
    checkRegistration(A);
    for (const cur of CURS) if (!A.currencies || A.currencies.includes(cur)) {
      checkEscrow(A, cur); checkRestart(A, cur); checkReplay(A, cur); checkSockets(A, cur); checkMix(A, cur); checkErrors(A, cur); checkInput(A, cur); checkIdentity(A, cur); checkDisconnect(A, cur); checkQuarantine(A, cur); checkPayback(A, cur);
    }
    if (!A.currencies || CURS.every((c) => A.currencies.includes(c))) checkCarry(A);
    for (const cur of CURS) if (A.currencies && !A.currencies.includes(cur)) checkRefuses(A, cur);
    for (const cur of CURS) if (!A.currencies || A.currencies.includes(cur)) {
      // 8: every world above ended with an independent replay; report them together with the mixed world
      checkLedger(A);
      break;
    }
    RESULTS.push({ game: A.id, check: 'ledger-replay', cur: null, ok: !FINAL.fails.length, detail: FINAL.fails.length ? `${FINAL.fails.length} failed of ${FINAL.n} replays: ${[...new Set(FINAL.fails)].slice(0, 3).join(' || ')}` : `${FINAL.n} replays of money.jsonl == service balances, sums 0, nothing negative` });
  } finally {
    if (current) { try { current.crash(); } catch {} current = null; }
    for (const k of Object.keys(savedEnv)) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
    RUN_OPTS = {};
    if (addedHouse) L.SOURCE_ACCOUNTS.delete('house:' + A.id);
    if (addedGame) GAMES.splice(GAMES.indexOf(A.id), 1);
  }
}

function report() {
  let pass = 0, fail = 0, skip = 0;
  for (const r of RESULTS) { console.log(`${r.skip ? 'SKIP' : r.ok ? 'PASS' : 'FAIL'} ${r.game} ${r.check}${r.cur ? '/' + r.cur : ''} ${r.detail}`); if (r.skip) skip++; else if (r.ok) pass++; else fail++; }
  console.log(`kit: ${pass} PASS, ${fail} FAIL${skip ? ', ' + skip + ' SKIP' : ''} (${[...new Set(RESULTS.map((r) => r.game))].join(', ')})`);
  return fail ? 1 : 0;
}

module.exports = { runGame, runAdapter, report, RESULTS, world, loadAdapter, finishAdapter, Refused, Crash, CURS, BASE };

if (require.main === module) {
  const args = process.argv.slice(2);
  let ids = args.filter((a) => !a.startsWith('--'));
  if (args.includes('--all')) {
    ids = (registry.MODULES || []).map((m) => path.basename(m, '.js'));
    ids.push(...fs.readdirSync(path.join(ROOT, 'games')).filter((f) => /^_example-.*\.kit\.js$/.test(f)).map((f) => require(path.join(ROOT, 'games', f)).id));
  }
  if (!ids.length) { console.error('usage: node tests/game-kit.js <gameId> | --all'); process.exit(2); }
  for (const id of ids) runGame(id);
  const code = report();
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch {}
  process.exit(code);
}
