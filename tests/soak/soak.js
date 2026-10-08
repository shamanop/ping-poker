#!/usr/bin/env node
'use strict';
// THE PING money soak. One server, several tables, both currencies, the slot, bank moves, kills and restarts; after EVERY step the
// invariants in invariants.js are checked against the ledger file, the mirror files, the server's __audit and the harness' own model.
// Exit 0 = clean, 1 = a violation (printed with the last 15 steps and the kept data dir), 2 = the harness itself broke.
// Usage: node tests/soak/soak.js [--seed N] [--minutes M | --steps N] [--kills N] [--port 4740] [--server-dir D] [--data D] [--bug NAME] [--players 6]
const fs = require('fs'), path = require('path');
const { mulberry32 } = require('./lib/prng');
const { ServerCtl, sleep } = require('./lib/serverctl');
const { Bot } = require('./lib/bot');
const { Checker } = require('./invariants');
const { Model } = require('./model');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRATCH = path.resolve(ROOT, '..', '_scratch', 'p6', 'soak');
const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt; };
const has = name => argv.includes('--' + name);

const ACTORS = ['poker', 'bank', 'bender', 'coldcall', 'campaign'].map(n => require('./actors/' + n));
const slot = require('./actors/coldcall');
const bankActor = require('./actors/bank');
const GRANT_CASH = 1000000;            // what the old fixture gave every account at signup
const camp = require('./actors/campaign');
const chaos = require('./actors/chaos');

class HarnessError extends Error {}
class Violations extends Error { constructor(list) { super(list[0].message); this.list = list; } }

function chicagoDay(ms) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)); }

async function main() {
  const seed = Number(arg('seed', 1)) >>> 0;
  const minutes = arg('minutes') !== undefined ? Number(arg('minutes')) : null;
  const maxSteps = arg('steps') !== undefined ? Number(arg('steps')) : null;
  const killsN = Number(arg('kills', 0));
  const port = Number(arg('port', 4740));
  const nPlayers = Number(arg('players', 6));
  const bug = arg('bug', null);
  const forcedKinds = arg('kill-kinds') ? arg('kill-kinds').split(',') : null;          // chaos kinds in order (cycled) instead of the seeded pick: a bug that needs one kind of kill to be reachable
  const serverDir = path.resolve(arg('server-dir', ROOT));
  const dataDir = path.resolve(arg('data', path.join(SCRATCH, `run-s${seed}-${Date.now()}`)));
  if (minutes === null && maxSteps === null) throw new HarnessError('give --minutes M or --steps N');
  if (port < 4740 || port > 4759) throw new HarnessError('ports 4740-4759 only');
  fs.mkdirSync(dataDir, { recursive: true });
  const stepsFile = path.join(dataDir, 'steps.jsonl');
  fs.writeFileSync(stepsFile, '');
  const started = Date.now();

  const W = {
    seed, rng: mulberry32(seed), dataDir, serverDir, port, nPlayers, bug,
    ctl: new ServerCtl({ port, dir: dataDir, serverDir, bug, injectPath: path.join(__dirname, 'bugs', 'inject.js'), env: { COLDCALL_TEST: '1', CAMPAIGN_TEST: '1', CAMPAIGN_IDLE_MS: '2500', NODE_ENV: 'test', ADMIN_CLAIM_PASSWORD: 'test-admin-claim-1008', BENDER_ADMIN_TOKEN: slot.ADMIN_TOKEN } }),
    model: new Model(), checker: new Checker(path.join(dataDir, 'money.jsonl')),
    bots: new Map(), tables: new Map(), admin: null, auditSock: null,
    inflightSpins: [], cfg: { betLevels: [1, 2, 10, 20, 50, 100, 200, 500, 1000, 2500], buyCostX: { election: 10.91, landslide: 77.21 } },
    achvReward: new Map(), bonusSchedule: [],
    stepNo: 0, recent: [], fatal: [], lastSignupAt: 0,
    counters: { checks: 0, kills: 0, restarts: 0, sigterm: 0, buyIns: 0, cashOuts: 0, spinsRefused: 0, spinsUnacked: 0, handsVoidedByKill: 0, warnings: {} },
    killLive: new Map(), mute: { showdown: false, bender: false, achv: false, slot: false, camp: false },
    sleep, chicagoDay,
  };
  slot.attach(W);
  camp.attach(W);
  W.warn = (k, detail) => { W.counters.warnings[k] = (W.counters.warnings[k] || 0) + 1; if (detail && W.counters.warnings[k] <= 3) console.error(`[soak] warning ${k}: ${detail}`); };
  W.violate = (id, message, accounts, expected, got) => { if (W.checker.ablate.has(id)) return; W.fatal.push({ id, step: W.stepNo, message, accounts: accounts || {}, expected, got }); };
  W.now = () => Date.now();
  W.log = (rec) => {
    const r = { step: W.stepNo, t: Date.now() - started, ...rec };
    W.recent.push(r); if (W.recent.length > 40) W.recent.shift();
    fs.appendFileSync(stepsFile, JSON.stringify(r) + '\n');
  };

  // ---------------- bots ----------------
  W.addBot = (name) => {
    const b = new Bot(W.ctl, name);
    W.bots.set(b.key, b);
    wire(b);
    return b;
  };
  W.botList = () => [...W.bots.values()];
  W.connectedBots = () => W.botList().filter(b => b.connected());
  function wire(bot) {
    bot.on('g:bender:result', d => {
      if (W.mute.bender) return;                       // chaos 'spinlost': the answer is dropped on the client side, as if the connection died first
      const i = W.inflightSpins.findIndex(s => s.key === bot.key && s.mode === d.mode && s.bet === d.bet && (s.buy || null) === (d.buyBonus || null));
      if (i >= 0) W.inflightSpins.splice(i, 1);
      if (!W.model.hasPlayer(bot.key)) return;
      const want = Math.round((d.buyBonus ? W.cfg.buyCostX[d.buyBonus] : 1) * d.bet);
      if (d.cost !== want || !Number.isSafeInteger(d.totalWin) || d.totalWin < 0 || !d.roundId || (d.mode !== 'chips' && d.mode !== 'play')) {
        W.violate('I7', `spin result is not priced as asked: cost ${d.cost} (want ${want}), totalWin ${d.totalWin}, mode ${d.mode}`, { key: bot.key, roundId: d.roundId }, `cost ${want}`, `cost ${d.cost} win ${d.totalWin}`);
        return;
      }
      W.model.applySpin({ key: bot.key, cur: d.mode, cost: d.cost, win: d.totalWin, roundId: d.roundId });
    });
    bot.on('showdown_result', d => { if (!W.mute.showdown) W.onShowdown(bot, d); });
    slot.listen(W, bot);
    camp.listen(W, bot);
    bot.on('bonus:claimed', d => { if (d && d.ok) { if (!W.model.applyMint('bonus', bot.key, d.amountCents, `bonus:${bot.key}:${chicagoDay(Date.now())}`)) W.warn('bonus_ok_again', `${bot.key} was told ok for a bonus already counted today`); } });
    bot.on('achv:unlocked', d => { if (W.mute.achv) return;
      if (d && d.id) W.model.applyMint('achv', bot.key, d.rewardCents, `achv:${bot.key}:${d.id}`); });
    // achievements: the server tells a client about every unlock it earned, either live (achv:unlocked) or in the achv:state it sends at sign-in.
    // A player whose socket was down when one fired learns it there. Same dedupe key, so it counts once.
    bot.on('achv:state', d => { if (d && d.list) for (const a of d.list) { W.achvReward.set(a.id, a.rewardCents); if (a.done && W.model.hasPlayer(bot.key)) W.model.applyMint('achv', bot.key, a.rewardCents, `achv:${bot.key}:${a.id}`); } });
    bot.on('bonus:status', d => { if (d && Array.isArray(d.schedule)) W.bonusSchedule = d.schedule; });
  }
  // showdown_result carries no table id. A socket can stay in a room after its seat is gone (see PROGRESS: leaving seat re-joined and swept), so the
  // receiver's own table is not proof: the table is where the players named in the result sit (majority of their bots' tables).
  W.tableOfResult = (bot, d) => {
    const votes = new Map();
    for (const name of Object.keys(d.net || {})) { const b = W.bots.get(name.toLowerCase()); if (b && b.tableId && b !== bot) votes.set(b.tableId, (votes.get(b.tableId) || 0) + 1); }
    if (bot.tableId) votes.set(bot.tableId, (votes.get(bot.tableId) || 0) + (d.net && bot.name.toLowerCase() in Object.fromEntries(Object.keys(d.net).map(n => [n.toLowerCase(), 1])) ? 1 : 0));
    let best = null, n = 0;
    for (const [t, c] of votes) if (c > n) { best = t; n = c; }
    return best;
  };
  W.onShowdown = (bot, d) => {
    if (!d || !Number.isInteger(d.handNo) || !d.net) return;
    const tableId = W.tableOfResult(bot, d);
    if (!tableId) return;
    const nets = {}, cur = {};
    for (const [name, n] of Object.entries(d.net)) {
      const key = name.toLowerCase();
      if (!W.model.hasPlayer(key)) { W.violate('I7', `showdown_result names ${name}, a player the harness never created`, { table: tableId }, 'known player', name); return; }
      nets[key] = n; cur[key] = W.fundCur(tableId, key);
    }
    const r = W.model.applyHand(tableId, d.handNo, nets, cur, 'client');
    if (r.conflict) W.violate('I7', `two clients got different results for hand ${r.id}`, { hand: r.id }, JSON.stringify(r.was), JSON.stringify(r.now));
    else if (r.notZeroSum) W.violate('I7', `showdown_result for hand ${r.id} is not zero-sum (sum ${r.sum})`, { hand: r.id }, 0, r.sum);
  };
  // the currency a seat's money counts toward = its fund (what the harness asked for), kept per (table, key)
  W.fundAt = new Map();
  // The product's rule (money/service.js seatFund): the fund of a seat is the one of its MOST RECENT buyin:<fund> line. A rebuy can be applied after the server answered (it waits for the hand to end), so what the harness
  // asked for is not proof of what the seat is funded from: the ledger decides, what the harness asked for is the fallback.
  W.fundCur = (tableId, key) => { W.checker.poll(); return W.checker.buyFund.get(`seat:${tableId}:${key}`) || W.fundAt.get(`${tableId}:${key}`) || (W.tables.get(tableId) ? W.tables.get(tableId).cur : 'chips'); };

  // ---------------- server ----------------
  async function openAuditSock() {
    if (W.auditSock) { try { W.auditSock.close(); } catch {} }
    const s = W.ctl.connect(); W.auditSock = s;
    await new Promise((res, rej) => { const t = setTimeout(() => rej(new HarnessError('audit socket did not connect')), 5000); s.once('connect', () => { clearTimeout(t); res(); }); });
  }
  W.audit = () => new Promise((res, rej) => {
    const s = W.auditSock; const t = setTimeout(() => { s.off('__audit', h); rej(new HarnessError('__audit timed out')); }, 5000);
    const h = a => { clearTimeout(t); res(a); };
    s.once('__audit', h); s.emit('__audit', {});
  });
  async function bringUpBots(first) {
    for (const b of W.botList()) {
      await b.connect();
      if (first) continue;
      const r = await b.resume();
      if (!r.data) throw new HarnessError(`${b.key} could not resume after restart: ${JSON.stringify(r.error || r)}`);
      b.gs = null;
    }
  }

  // ---------------- snapshot + check ----------------
  // One consistent view: mirror files, then ledger, audit, wallet answers, admin rows, then the ledger again: only used when the ledger did not move in between.
  const readJson = f => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); } catch { return null; } };
  async function barrier(bot, emits, collectEv) {       // sends `emits`, then achv:state as a barrier; returns the last `collectEv` seen before it
    return new Promise(res => {
      let last = null; const t = setTimeout(() => { bot.sock && bot.sock.off(collectEv, c); bot.sock && bot.sock.off('achv:state', b); res(undefined); }, 3000);
      const c = d => { last = d; };
      const b = () => { clearTimeout(t); bot.sock.off(collectEv, c); bot.sock.off('achv:state', b); res(last); };
      bot.sock.on(collectEv, c); bot.sock.on('achv:state', b);
      for (const [ev, p] of emits) bot.sock.emit(ev, p);
      bot.sock.emit('achv:state', {});
    });
  }
  // who could have heard a hand settle: connected bots in that table's room when the line first showed up
  function noteNewLines(n) { if (!n) return; for (const L of W.checker.lines.slice(-n)) if (L.hand) L.listeners = W.botList().filter(b => b.connected() && b.tableId === L.hand.tableId).length; }
  async function pollSettled() {
    for (let i = 0; i < 4; i++) { const r = W.checker.poll(); noteNewLines(r.added); if (!r.torn) return r; await sleep(20); }
    if (W.ctl.alive()) W.violate('I1', 'money.jsonl ends in a partial line while the server is running', { file: W.checker.file }, 'whole lines', W.checker.tornBytes + ' stray bytes');
    return { torn: true };
  }
  async function snapshot(opts = {}) {
    let snap = null;
    for (let tries = 0; tries < 5; tries++) {
      const mirrors = { bank: readJson('bank.json'), wallet: readJson('wallet.json') };
      await pollSettled();
      const n0 = W.checker.lines.length;
      const audit = await W.audit();
      const views = [];
      const live = W.connectedBots().filter(b => b.spinsInFlight === 0);
      await Promise.all(live.map(async b => { const w = await barrier(b, [['wallet_get', {}]], 'wallet'); if (w) views.push({ key: b.key, play: w.play, chips: w.chips }); }));
      let rows = null;
      if (W.admin && W.admin.connected()) { const o = await barrier(W.admin, [['admin_overview', {}]], 'admin_overview'); if (o && o.accounts) rows = o.accounts; }
      await pollSettled();
      snap = { mirrors, audit, views, rows, consistent: W.checker.lines.length === n0 };
      if (snap.consistent) break;
    }
    return snap;
  }
  W.evaluate = (snap, opts = {}) => {
    const C = W.checker, M = W.model, out = [];
    out.push(...C.checkConservation(M, snap.audit));
    out.push(...C.checkModel(M));
    out.push(...C.checkSpins(M));
    out.push(...C.checkHands(M));
    out.push(...C.checkSlot(M, snap.audit, { feedBps: W.slot.feedBps, epochs: W.slot.epochEnds }));
    out.push(...C.checkCampaign(M, snap.audit));
    out.push(...C.checkMemory(snap.audit));
    if (snap.consistent) {
      out.push(...C.checkStranded(snap.audit, { afterRestart: !!opts.afterRestart }));
      out.push(...C.checkViews(snap.views, snap.rows));
      out.push(...C.checkMirror(snap.mirrors, Date.now()));
    }
    if (opts.afterRestart) out.push(...C.checkAuditAgainstFile(snap.audit));
    if (!(snap.audit.accounts || []).every(k => M.hasPlayer(k)) || (snap.audit.accounts || []).length !== M.accounts().length) out.push({ id: 'I7', message: 'the server knows a different set of accounts than the harness created', accounts: {}, expected: M.accounts().join(','), got: (snap.audit.accounts || []).join(',') });
    return out.map(v => ({ step: W.stepNo, ...v }));
  };
  // Check after a step. Ledger-only violations are final; the rest may be a message still in flight, so they get STAB_MS to clear.
  const STAB_MS = 1500;
  // A hand that settled while nobody was in its room cannot have been told to anyone (every seated player's socket was down): count it from the ledger,
  // with the same sanity checks as a hand cut off by a kill. A hand somebody WAS listening to must reach the model through a showdown_result.
  function adoptUnheardHands() {
    for (const L of W.checker.lines) {
      if (!L.hand || L.listeners !== 0 || W.model.hasHand(L.hand.tableId, L.hand.handNo) || Date.now() - L.seenAt < 1200) continue;
      const unknown = Object.keys(L.hand.nets).filter(k => !W.model.hasPlayer(k));
      if (unknown.length) { W.violate('I7', `hand ${L.ref} pays an account the harness never created: ${unknown}`, { ref: L.ref }, 'known players', unknown.join(',')); continue; }
      const r = W.model.applyHand(L.hand.tableId, L.hand.handNo, L.hand.nets, L.hand.fund, 'unacked');
      if (r.notZeroSum) W.violate('I7', `unheard hand ${L.ref} is not zero-sum`, { ref: L.ref }, 0, r.sum);
    }
  }
  W.check = async (opts = {}) => {
    W.counters.checks++;
    const t0 = Date.now();
    let last = [];
    for (;;) {
      const snap = await snapshot(opts);
      const hard = W.checker.take();
      if (hard.length) throw new Violations(hard.map(v => ({ step: W.stepNo, ...v })));
      if (W.fatal.length) throw new Violations(W.fatal.splice(0));
      adoptUnheardHands();
      slot.adoptUnheard(W);
      camp.adoptUnheard(W);
      last = W.evaluate(snap, opts);
      if (!last.length) return snap;
      if (Date.now() - t0 > STAB_MS) throw new Violations(last);
      await sleep(40);
    }
  };

  // ---------------- kill + restart + reconcile (the "unacked" rules) ----------------
  W.settlePoll = pollSettled;
  // Wait until every result the ledger already holds has reached the model (a hand somebody was listening to, a Bender spin, an achievement, a slot round): a chaos kind that MUTES a result type for the
  // moment of the kill must not mute the late arrival of a result whose line was written BEFORE the kill mark, or the line is neither acked nor "racing". Gives up after ms.
  W._drainFrom = 0;
  W.drain = async (ms = 600) => {
    const end = Date.now() + ms;
    for (;;) {
      await pollSettled();
      const C = W.checker, M = W.model;
      let i = W._drainFrom, open = null;
      for (; i < C.lines.length; i++) {
        const L = C.lines[i], ref = L.ref || '';
        if (L.hand) { if (L.listeners !== 0 && !M.hasHand(L.hand.tableId, L.hand.handNo)) { open = ref; break; } }
        else if (ref.startsWith('bender:')) { if (!M.spins.has(ref)) { open = ref; break; } }
        else if (L.slot && L.slot.suffix !== 'open') { const id = `${L.slot.key}:${L.slot.rid}`; if (!M.slot.rounds.has(id) && !M.slot.open.has(id)) { open = ref; break; } }
        else if (L.camp && L.camp.suffix !== 'open') { const id = `${L.camp.key}:${L.camp.rid}`; if (!M.camp.rounds.has(id) && !M.camp.open.has(id)) { open = ref; break; } }
      }
      W._drainFrom = i;
      if (!open || Date.now() > end) return !open;
      await sleep(10);
    }
  };
  W.noteLiveHands = () => {
    W.killLive = new Map();
    for (const b of W.connectedBots()) if (b.tableId && b.gs && b.gs.status === 'playing') W.killLive.set(b.tableId, b.gs.handNum);
  };
  // opts.marked: the caller already polled and called checker.markKill() just before it started the operation that the kill interrupts
  W.killAndRestart = async (sig, opts = {}) => {
    W.noteLiveHands();
    if (!opts.marked || !W.checker.killMark) { await pollSettled(); W.checker.markKill(); }      // a chaos kind that bailed out early never marked: mark here, or nothing across the kill is classified
    W.counters.kills++; if (sig === 'SIGTERM') W.counters.sigterm++;
    W.log({ actor: 'chaos', what: 'kill-start', sig, markedAt: W.checker.killMark.lines, ledgerLines: W.checker.lines.length, live: [...W.killLive.entries()].map(([t, n]) => `${t}:${n}`).join(',') });
    await W.ctl.kill(sig);
    await sleep(150);                                    // answers already on the wire still reach the clients (and the model)
    const sentSpins = W.inflightSpins.slice();           // spins sent whose answer never came
    const sentSlot = slot.inflightList(W);
    const sentCamp = camp.inflightList(W);
    for (const b of W.botList()) b.close();
    await pollSettled();                                 // the process is gone: whatever it wrote is in the file now
    W.checker.markDead();
    await W.ctl.start();
    W.counters.restarts++;
    await openAuditSock();
    await bringUpBots(false);
    await reconcile(sentSpins, sentSlot, sentCamp);
    W.inflightSpins = [];
    for (const b of W.botList()) { b.spinsInFlight = 0; }
    W.fundAt = new Map();
    for (const a of ACTORS) if (a.afterRestart) await a.afterRestart(W);
    await W.check({ afterRestart: true });
    W.checker.killMark = null;
  };
  async function reconcile(sentSpins, sentSlot, sentCamp) {
    const C = W.checker, M = W.model;
    await pollSettled();
    const cls = C.classifyRestart();
    // Ledger-only violations are final and must not be hidden by a restart finding: a boot-recovery line of the wrong shape is reported by I9 here AND by the invariant that owns its shape (I2 / I1 / I3).
    const bad = [...W.checker.take().map(v => ({ step: W.stepNo, ...v })), ...cls.violations.map(v => ({ step: W.stepNo, ...v }))];
    const perTableUnacked = new Map();
    const unknownSpins = sentSpins.slice();
    for (const L of cls.racing) {
      const ref = L.ref || '';
      if (L.hand) {
        const { tableId, handNo, nets, fund } = L.hand;
        if (M.hasHand(tableId, handNo)) continue;
        const n = (perTableUnacked.get(tableId) || 0) + 1; perTableUnacked.set(tableId, n);
        if (n > 1) { bad.push({ step: W.stepNo, id: 'I9', message: `two hands of table ${tableId} settled across one kill without a client seeing either`, accounts: { table: tableId }, expected: '<= 1', got: n }); continue; }
        const unknown = Object.keys(nets).filter(k => !M.hasPlayer(k));
        if (unknown.length) { bad.push({ step: W.stepNo, id: 'I7', message: `hand ${ref} pays an account the harness never created: ${unknown}`, accounts: { ref }, expected: 'known players', got: unknown.join(',') }); continue; }
        const r = M.applyHand(tableId, handNo, nets, fund, 'unacked');
        if (r.notZeroSum) bad.push({ step: W.stepNo, id: 'I7', message: `settled-unacked hand ${ref} is not zero-sum (sum ${r.sum})`, accounts: { ref }, expected: 0, got: r.sum });
      } else if (ref.startsWith('bender:')) {
        const [, key, roundId] = ref.split(':');
        if (M.spins.has(ref)) continue;
        const it = L.items, cur = it[0].cur, store = (cur === 'chips' ? 'bank:' : 'play:') + key;
        let cost = 0, win = 0;
        for (const x of it) { if (x.from === store && x.to === 'house:bender') cost += x.amount; else if (x.from === 'house:bender' && x.to === store) win += x.amount; }
        const i = unknownSpins.findIndex(s => s.key === key && s.mode === cur && Math.round((s.buy ? W.cfg.buyCostX[s.buy] : 1) * s.bet) === cost);
        if (i < 0) { bad.push({ step: W.stepNo, id: 'I7', message: `ledger has a Bender round ${ref} (cost ${cost}, win ${win}) that no spin in flight at the kill explains`, accounts: { ref, key }, expected: 'a spin sent and not answered', got: `cost ${cost} win ${win}` }); continue; }
        unknownSpins.splice(i, 1);
        if (!M.hasPlayer(key)) continue;
        M.applySpin({ key, cur, cost, win, roundId }); W.counters.spinsUnacked++;
      } else if (ref.startsWith('achv:')) {
        const [, key, id] = ref.split(':');
        const want = W.achvReward.get(id), got = L.items[0].amount;
        if (M.mints.has(ref)) continue;
        if (want === undefined || want !== got || L.items[0].from !== 'mint:achv') { bad.push({ step: W.stepNo, id: 'I2', message: `achievement mint ${ref} of ${got} is not what the reward table says (${want})`, accounts: { ref }, expected: want, got }); continue; }
        M.applyMint('achv', key, got, ref);
      } else if (ref.startsWith('bonus:')) {
        const [, key, day] = ref.split(':');
        const got = L.items[0].amount;
        if (M.mints.has(`bonus:${key}:${day}`)) continue;
        if (!W.bonusSchedule.includes(got) || L.items[0].from !== 'mint:bonus') { bad.push({ step: W.stepNo, id: 'I2', message: `bonus mint ${ref} of ${got} is not in the bonus schedule`, accounts: { ref }, expected: W.bonusSchedule.join(','), got }); continue; }
        M.applyMint('bonus', key, got, `bonus:${key}:${day}`);
      } else if (ref.startsWith('signup:')) {
        const key = ref.split(':')[2];
        if (!M.hasPlayer(key)) bad.push({ step: W.stepNo, id: 'I7', message: `signup line for ${key} that the harness did not create`, accounts: { ref }, expected: 'known player', got: key });
      }
    }
    bad.push(...slot.reconcile(W, cls, sentSlot));
    bad.push(...camp.reconcile(W, cls, sentCamp));
    for (const [t, n] of W.killLive) if (!C.lineByRef(`hand:${t}:${n}`)) W.counters.handsVoidedByKill++;
    if (bad.length) throw new Violations(bad);
  }

  // ---------------- setup ----------------
  async function setup() {
    await W.ctl.start();
    await openAuditSock();
    const a0 = await W.audit();
    if (!a0.accounts.every(k => k === 'chris') || a0.accounts.length > 1) throw new HarnessError('fresh data dir expected one account (chris), got ' + a0.accounts.join(','));
    W.model.addPlayer('chris', 0);
    const admin = W.addBot('chris'); W.admin = admin;
    await admin.connect();
    const r = await admin.claimAdmin();
    if (!r.data) throw new HarnessError('admin claim failed: ' + JSON.stringify(r.error || r));
    for (let i = 1; i < nPlayers; i++) {
      const b = W.addBot('Soak' + String.fromCharCode(64 + i)); await b.connect();
      const s = await b.signup();
      if (!s.data) throw new HarnessError(`signup ${b.name} failed: ${JSON.stringify(s.error || s)}`);
      W.model.addPlayer(b.key);
    }
    await sleep(150);
    for (const k of W.model.accounts()) await bankActor.grantCash(W, k, GRANT_CASH);       // signup gave 0 Cash; the admin sets it (the model books each grant)
    const st = await admin.req('g:bender:state', {}, 'g:bender:state');
    if (st.data) { W.cfg.betLevels = st.data.betLevels; W.cfg.buyCostX = st.data.buyCostX; }
    await admin.req('bonus:status', {}, 'bonus:status');
    await admin.req('achv:state', {}, 'achv:state');
    for (const a of ACTORS) if (a.init) await a.init(W);
  }

  // ---------------- main loop ----------------
  const killSteps = [], killTimes = [];
  for (let i = 0; i < killsN; i++) {
    const f = (i + 1) / (killsN + 1), jitter = (W.rng() - 0.5) * 0.4 / (killsN + 1);
    killSteps.push(Math.max(1, Math.round((f + jitter) * (maxSteps || 1))));
    killTimes.push((f + jitter) * (minutes || 0) * 60000);
  }
  let killsDone = 0, result = null, failure = null;
  const kinds = ['midhand', 'spin', 'showdown', 'buyins', 'settle', 'spinlost', 'slotopen', 'slotcb', 'slotlost', 'slotopen', 'settle', 'spinlost', 'slotcb', 'slotlost', 'campopen0', 'campopen1', 'campstep', 'campcash', 'campstep', 'campopen1'];
  try {
    await setup();
    await W.check();
    const end = minutes !== null ? started + minutes * 60000 : Infinity;
    let lastProgress = Date.now();
    while ((maxSteps === null || W.stepNo < maxSteps) && Date.now() < end) {
      W.stepNo++;
      const due = killsDone < killsN && (maxSteps !== null ? W.stepNo >= killSteps[killsDone] : Date.now() - started >= killTimes[killsDone]);
      let rec;
      if (due && Date.now() - W.lastSignupAt > 600) { killsDone++; const kk = forcedKinds ? forcedKinds[(killsDone - 1) % forcedKinds.length] : kinds[W.rng.int(kinds.length)]; rec = await chaos.step(W, kk, W.rng.chance(0.25) ? 'SIGTERM' : 'SIGKILL'); }
      else {
        const actor = W.rng.weighted(ACTORS.map(a => [a.weight, a]));
        rec = await actor.step(W);
      }
      if (rec) W.log(rec);
      if (!W.ctl.alive()) throw new HarnessError('server exited by itself: ' + JSON.stringify(W.ctl.exited) + ' ' + W.ctl.logTail());
      await W.check();
      if (W.checker.lines.length !== W._lastLines) { W._lastLines = W.checker.lines.length; lastProgress = Date.now(); }
      if (Date.now() - lastProgress > 90000) throw new HarnessError('nothing was written to the ledger for 90 s: the harness is stuck (see steps.jsonl)');
    }
    // final: stop acting, let the table go quiet, then check once more with the mirror held to exact equality
    await sleep(900);
    await W.check();
    await W.check();
  } catch (e) { failure = e; }

  const files = { ledgerLines: W.checker.lines.length };
  const M = W.model;
  result = {
    seed, bug, steps: W.stepNo, minutes: Math.round((Date.now() - started) / 600) / 100, players: nPlayers, kills: W.counters.kills, sigterm: W.counters.sigterm, restarts: W.counters.restarts,
    handsSettled: M.count.hands, handsSettledUnacked: M.count.handsUnacked, handsVoidedByKill: W.counters.handsVoidedByKill,
    spins: M.count.spins, spinsUnacked: W.counters.spinsUnacked, spinsRefused: W.counters.spinsRefused, buyIns: W.counters.buyIns, cashOuts: W.counters.cashOuts,
    mints: { signup: M.count.signups, bonus: M.count.bonus, achv: M.count.achv, topup: M.count.topup }, adminAdjusts: M.count.adminAdjust, adminRefused: M.count.adminRefused,
    campaign: { runs: M.count.campRuns || 0, unacked: M.count.campRunsUnacked || 0, net: M.camp.net, c: W.camp.c },
    slot: { rounds: M.count.slotRounds || 0, unacked: M.count.slotRoundsUnacked || 0, voids: M.count.slotVoids || 0, net: M.slot.net, byKind: { plain: W.slot.c.plain, buy: W.slot.c.buy, forced: W.slot.c.forced, callback: W.slot.c.callbacks, decisionsOpened: W.slot.c.pending, decisionsAnswered: W.slot.c.decided, readyLeftToTimer: W.slot.c.readyLeft, potWins: W.slot.c.potWon, refusedFunds: W.slot.c.funds, refusedRate: W.slot.c.rate, refusedBusy: W.slot.c.busy, socketDrops: W.slot.c.drops, configSwaps: W.slot.c.cfg, voidedEvents: W.slot.c.voided } },
    ledgerLines: files.ledgerLines, checks: W.counters.checks, warnings: W.counters.warnings,
    violations: failure instanceof Violations ? failure.list : [], harnessError: failure && !(failure instanceof Violations) ? String(failure && failure.stack || failure) : null, dataDir,
  };
  fs.writeFileSync(path.join(dataDir, 'result.json'), JSON.stringify(result, null, 2));
  await W.ctl.kill('SIGKILL');
  for (const b of W.botList()) b.close();
  if (W.auditSock) try { W.auditSock.close(); } catch {}

  if (!failure) { console.log(`CLEAN seed=${seed} steps=${result.steps} hands=${result.handsSettled}+${result.handsSettledUnacked}unacked spins=${result.spins} slot=${result.slot.rounds}+${result.slot.unacked}unacked(cb ${result.slot.byKind.callback}, decisions ${result.slot.byKind.decisionsOpened}, pot ${result.slot.byKind.potWins}) campaign=${result.campaign.runs}+${result.campaign.unacked}unacked(steps ${result.campaign.c.steps}, scandal ${result.campaign.c.scandal}, cash ${result.campaign.c.cashout}, withdrawn ${result.campaign.c.withdrawn}, timeout ${result.campaign.c.timeout}, deadend ${result.campaign.c.deadend}, landslide ${result.campaign.c.landslide}) kills=${result.kills} lines=${result.ledgerLines} checks=${result.checks} min=${result.minutes} data=${dataDir}`); return 0; }
  if (failure instanceof Violations) {
    const v = failure.list[0];
    console.log(`VIOLATION ${v.id} at step ${v.step}: ${v.message}`);
    console.log('  accounts: ' + JSON.stringify(v.accounts));
    console.log(`  expected: ${JSON.stringify(v.expected)}  got: ${JSON.stringify(v.got)}`);
    if (failure.list.length > 1) console.log(`  (+${failure.list.length - 1} more: ${failure.list.slice(1, 4).map(x => x.id + ' ' + x.message.slice(0, 60)).join(' | ')})`);
    console.log('  last 15 steps:');
    for (const r of W.recent.slice(-15)) console.log('    ' + JSON.stringify(r).slice(0, 220));
    console.log('  data dir kept: ' + dataDir + `  (replay: --seed ${seed}${bug ? ' --bug ' + bug : ''})`);
    return 1;
  }
  console.log(`HARNESS ERROR at step ${W.stepNo}: ${failure && failure.message}`);
  console.log('  data dir: ' + dataDir);
  return 2;
}

main().then(code => process.exit(code), e => { console.error('HARNESS ERROR', e && e.stack || e); process.exit(2); });
