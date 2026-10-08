'use strict';
// Actor: CAMPAIGN TRAIL (games/campaign.js, money through ctx.money). Both currencies, every bet level: a run to a cash-out, a run ridden to a scandal, a withdrawal at 0 steps, a run left to the (short) idle timer,
// a socket dropped with a run open, an unaffordable start, a second start while one is open, a double step / cash, hostile payloads, and now and then the whole LANDSLIDE route. Outcomes are forced through the QA hook
// (CAMPAIGN_TEST=1, g:campaign:step { force }) so scandals and long runs both happen; the money path is the normal one.
// Actor interface (all actors): { name, weight, init(W)?, afterRestart(W)?, step(W) -> record | null }. This one also exports attach / listen / adoptUnheard / reconcile / inflightList / ops, used by soak.js and chaos.js.
//
// What the harness believes (model.js CampBook): only what the client was told (g:campaign:run / step / end), plus, where a kill or a dropped socket kept the client from hearing, ONE close line per run that was open.
// The rules for such a close (README "Campaign"): with no step in flight, a run that was at 0 steps closes by a refund of the stake and a run at >= 1 step settles at stake x the multiplier the client last saw. With ONE step in
// flight and unanswered, exactly three closes are accepted: win 0 (the step was a scandal), the last seen multiplier (the step was never flushed), or the multiplier of that one option (it survived and was flushed).
// The ledger side (stake, win, escrow, shape) is judged in invariants.js checkCampaign. The math of every option the server shows is re-derived here from the engine (pure math, not money code).
const { sleep } = require('../lib/bot');
const { opId } = require('../lib/opid');
const E = require('../../../games/campaign-engine.js');

const WITNESS = 'ME NH VT MA RI CT NY NJ DE MD PA WV OH MI IN IL WI MN ND MT SD IA NE KS CO WY UT ID WA AK HI CA OR NV AZ NM OK TX LA AR MO KY VA NC SC GA FL AL MS TN'.split(' ');
const REASONS = ['scandal', 'cashout', 'withdrawn', 'timeout', 'deadend', 'landslide'];
const acct = (key, cur) => (cur === 'chips' ? 'bank:' : 'play:') + key;
const units = (bet, mx) => (bet / 100) * mx;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function attach(W) {
  W.camp = { betLevels: E.BET_LEVELS.slice(), homes: Object.keys(E.MAP.states), inflight: [], epoch: 0, lastAt: new Map(), landslideTries: 0, c: { runs: 0, steps: 0, scandal: 0, cashout: 0, withdrawn: 0, timeout: 0, deadend: 0, landslide: 0, errors: 0, funds: 0, rate: 0, runOpen: 0, drops: 0, doubles: 0, hostile: 0, unacked: 0, boot: 0, resyncs: 0 } };
}
const violate = (W, msg, accounts, expected, got) => W.violate('I7', msg, accounts, expected, got);

// the options the server must show for a run, re-derived from the engine: [{ to, tier, g100, nextMx, pFail (4 decimals), deadEnd, landslide }]
function expectOptions(trail) {
  let r = E.newRun(trail[0]);
  for (let i = 1; i < trail.length; i++) r = E.step(r, trail[i], () => 0.999999).run;
  return E.options(r).map((o) => ({ to: o.to, tier: o.tier, g100: o.g100, nextMx: o.nextMx, pFail: Math.round(o.pFail * 10000) / 10000, deadEnd: !!o.deadEnd, landslide: !!o.landslide }));
}
// a runView the client received, against the engine and the stake. -> an error message or null
function judgeView(v, bet) {
  const trail = v.trail;
  if (!Array.isArray(trail) || !trail.length || v.at !== trail[trail.length - 1] || v.steps !== trail.length - 1) return `the trail ${JSON.stringify(trail)} does not match at ${v.at} / steps ${v.steps}`;
  let want;
  try { want = expectOptions(trail); } catch (e) { return 'the trail is not a legal route: ' + (e && e.message); }
  const got = (v.options || []).map((o) => ({ to: o.to, tier: o.tier, g100: o.g100, nextMx: o.nextMx, pFail: o.pFail, deadEnd: !!o.deadEnd, landslide: !!o.landslide }));
  if (!same(got, want)) return `options differ from the engine's: got ${JSON.stringify(got).slice(0, 160)} want ${JSON.stringify(want).slice(0, 160)}`;
  for (const o of v.options) if (o.nextCashout !== units(bet, o.nextMx)) return `nextCashout ${o.nextCashout} for nextMx ${o.nextMx} at stake ${bet}`;
  if (v.cashout !== units(bet, v.mx)) return `cashout ${v.cashout} at mx ${v.mx} stake ${bet}`;
  if (v.bet !== bet) return `bet ${v.bet}, expected ${bet}`;
  let mx = 100; for (let i = 1; i < trail.length; i++) { mx = Math.floor(mx * E.TIERS[E.MAP.states[trail[i]].tier].g100 / 100); }
  if (trail.length - 1 === E.MAX_STEPS) mx = E.LANDSLIDE_MX;
  if (v.mx !== mx) return `mx ${v.mx} for this trail, the engine says ${mx}`;
  return null;
}

// ---------------- what the client is told ----------------
function listen(W, bot) {
  bot.on('g:campaign:run', (d) => onRun(W, bot, d));
  bot.on('g:campaign:step', (d) => onStep(W, bot, d));
  bot.on('g:campaign:end', (d) => onEnd(W, bot, d));
}
function takeStart(W, key) { const i = W.camp.inflight.findIndex((x) => x.key === key && x.kind === 'start'); return i >= 0 ? W.camp.inflight.splice(i, 1)[0] : null; }

function onRun(W, bot, d) {
  if (W.mute.camp) return;
  const C = W.camp, B = W.model.camp, run = d && d.run;
  if (!run || typeof run.roundId !== 'string' || !W.model.hasPlayer(bot.key)) return;
  const key = bot.key, cur = run.mode, rid = run.roundId, id = `${key}:${rid}`, who = { key, roundId: rid };
  const sent = takeStart(W, key);
  if (cur !== 'play' && cur !== 'chips') return violate(W, `a Campaign run with mode ${JSON.stringify(cur)}`, who, 'play|chips', cur);
  if (!C.betLevels.includes(run.bet)) return violate(W, `a Campaign run at bet ${run.bet}, not a listed bet`, who, C.betLevels.join(','), run.bet);
  if (run.steps !== 0 || run.mx !== 100 || run.cashout !== run.bet) return violate(W, `a new run is not at 0 steps / 1.00x / cashout = stake: steps ${run.steps} mx ${run.mx} cashout ${run.cashout}`, who, '0 / 100 / stake', `${run.steps} / ${run.mx} / ${run.cashout}`);
  const bad = judgeView(run, run.bet); if (bad) return violate(W, 'run view: ' + bad, who, 'the engine', bad);
  if (sent && (sent.mode !== cur || sent.bet !== run.bet || sent.home !== run.home)) violate(W, `the run is not the one asked for: asked ${sent.mode} ${sent.bet} ${sent.home}, got ${cur} ${run.bet} ${run.home}`, who, `${sent.mode} ${sent.bet} ${sent.home}`, `${cur} ${run.bet} ${run.home}`);
  if (B.rounds.has(id) || B.open.has(id)) return;
  if (B.hasOpen(key)) violate(W, `${key} was given a second open run (one run per account)`, who, 'one open run', 'two');
  B.open.set(id, { key, cur, rid, bet: run.bet, steps: 0, mx: 100, trail: run.trail.slice(), options: run.options, gen: bot.gen, epoch: C.epoch, pend: null, since: Date.now() });
  C.c.runs++;
}

function onStep(W, bot, d) {
  if (W.mute.camp) return;
  const C = W.camp, B = W.model.camp;
  if (!d || typeof d.roundId !== 'string') return;
  const id = `${bot.key}:${d.roundId}`, o = B.open.get(id), who = { key: bot.key, roundId: d.roundId };
  if (!o) return;                                         // a late copy for a run that is closed already
  const opt = o.options.find((x) => x.to === d.to);
  if (!opt) return violate(W, `a step into ${d.to}, which was not one of the options shown`, who, o.options.map((x) => x.to).join(','), d.to);
  if (d.n !== o.steps + 1 || !d.run || d.run.steps !== o.steps + 1) return violate(W, `step answer n ${d.n} / steps ${d.run && d.run.steps}, the run was at ${o.steps}`, who, o.steps + 1, d.n);
  if (o.pend && o.pend.kind === 'step' && o.pend.to !== d.to) violate(W, `a step into ${d.to} was answered but ${o.pend.to} was asked for`, who, o.pend.to, d.to);
  if (d.tier !== opt.tier) violate(W, `step tier ${d.tier}, the option said ${opt.tier}`, who, opt.tier, d.tier);
  if (d.run.mx !== opt.nextMx || d.run.at !== d.to) return violate(W, `after the step the run is at ${d.run.at} ${d.run.mx}x, the option said ${d.to} ${opt.nextMx}`, who, `${d.to} ${opt.nextMx}`, `${d.run.at} ${d.run.mx}`);
  if (!same(d.run.trail, o.trail.concat(d.to))) return violate(W, `the trail after the step is ${JSON.stringify(d.run.trail)}`, who, JSON.stringify(o.trail.concat(d.to)), JSON.stringify(d.run.trail));
  const bad = judgeView(d.run, o.bet); if (bad) return violate(W, 'run view after a step: ' + bad, who, 'the engine', bad);
  if (d.run.options.length === 0) violate(W, 'a step that did not end the run left no options', who, 'options or an end', 'none');
  o.steps = d.run.steps; o.mx = d.run.mx; o.trail = d.run.trail.slice(); o.options = d.run.options; o.pend = null; o.gen = bot.gen;
  C.c.steps++;
}

function onEnd(W, bot, d) {
  if (W.mute.camp) return;
  const C = W.camp, B = W.model.camp, M = W.model;
  if (!d || typeof d.roundId !== 'string' || !M.hasPlayer(bot.key)) return;
  const key = bot.key, rid = d.roundId, id = `${key}:${rid}`, who = { key, roundId: rid };
  if (B.rounds.has(id)) return;                           // a late copy
  const o = B.open.get(id);
  if (!o) return violate(W, `an end for run ${id}, which the client was never told was open`, who, 'a known run', d.reason);
  if (!REASONS.includes(d.reason)) return violate(W, `an end with reason ${JSON.stringify(d.reason)}`, who, REASONS.join('|'), d.reason);
  if (d.mode !== o.cur || d.bet !== o.bet) return violate(W, `end says ${d.mode} ${d.bet}, the run was ${o.cur} ${o.bet}`, who, `${o.cur} ${o.bet}`, `${d.mode} ${d.bet}`);
  const pend = o.pend && o.pend.kind === 'step' ? o.pend : null;
  let want, msg = null, refund = false;
  switch (d.reason) {
    case 'scandal':
      want = 0;
      if (!pend) msg = 'a scandal with no step in flight';
      else if (d.failedAt !== pend.to) msg = `scandal at ${d.failedAt}, the step went to ${pend.to}`;
      else if (d.steps !== o.steps || d.mx !== o.mx || !same(d.trail, o.trail)) msg = 'a scandal changed the trail / steps / multiplier the player had';
      break;
    case 'cashout':
      want = units(o.bet, o.mx);
      if (o.steps < 1) msg = 'a cash-out at 0 steps (that is a withdrawal)';
      else if (d.steps !== o.steps || d.mx !== o.mx) msg = `cash-out at ${d.steps} steps ${d.mx}x, the player had ${o.steps} steps ${o.mx}x`;
      break;
    case 'withdrawn':
      want = o.bet; refund = true;
      if (o.steps !== 0 || d.steps !== 0) msg = 'a withdrawal after a step';
      break;
    case 'timeout':
      if (d.steps === o.steps) { want = o.steps === 0 ? o.bet : units(o.bet, o.mx); refund = o.steps === 0; if (d.mx !== o.mx) msg = `timeout at ${d.mx}x, the player had ${o.mx}x`; }
      else msg = `timeout at ${d.steps} steps, the player had ${o.steps}`;
      break;
    case 'deadend': case 'landslide': {
      want = units(o.bet, d.mx);
      const opt = pend ? o.options.find((x) => x.to === pend.to) : null;
      if (!pend || !opt) msg = `${d.reason} with no step in flight`;
      else if (d.steps !== o.steps + 1 || d.at !== pend.to || d.mx !== opt.nextMx) msg = `${d.reason} at ${d.at} ${d.mx}x after ${d.steps} steps, the option said ${pend.to} ${opt.nextMx}x after ${o.steps + 1}`;
      else if (d.reason === 'deadend' && !opt.deadEnd) msg = 'a dead end that was not marked deadEnd before the pick';
      else if (d.reason === 'landslide' && (!opt.landslide || d.mx !== E.LANDSLIDE_MX || d.steps !== E.MAX_STEPS)) msg = 'a landslide that is not the 50th state at 1000x';
      break;
    }
  }
  if (msg) return violate(W, `run ${id}: ${msg}`, who, `win ${want}`, `win ${d.win}`);
  if (!Number.isSafeInteger(d.win) || d.win !== want) return violate(W, `run ${id} ended ${d.reason} with win ${d.win}, the rules say ${want} (stake ${o.bet}, mx ${d.mx})`, who, want, d.win);
  if (d.reason === 'scandal' && d.failedAt == null) return violate(W, 'a scandal without failedAt', who, 'a state', d.failedAt);
  M.applyCamp({ key, cur: o.cur, rid, bet: o.bet, win: d.win, reason: d.reason, steps: d.steps, mx: d.mx, via: 'client', void: refund });
  C.c[d.reason]++;
}

// ---------------- a run the client could not hear the end of: one close line from the ledger ----------------
// What the ledger may hold for a run open in the model (see the header): returns [{ kind: 'void' } | { kind: 'settle', credit }]
function allowedCloses(o) {
  const out = [o.steps === 0 ? { kind: 'void' } : { kind: 'settle', credit: units(o.bet, o.mx) }];
  const p = o.pend && o.pend.kind === 'step' ? o.pend : null;
  if (p) { out.push({ kind: 'settle', credit: 0 }); out.push({ kind: 'settle', credit: units(o.bet, p.opt.nextMx) }); }
  return out;
}
function adoptClose(W, o, L, via) {
  const s = L.camp, id = `${o.key}:${o.rid}`;
  if (s.cur !== o.cur) return `run ${id} was open in ${o.cur} and closed in ${s.cur}`;
  const ok = allowedCloses(o).find((a) => (a.kind === 'void' ? s.voided === o.bet && !s.spend && !s.credit : s.spend === o.bet && s.credit === a.credit && !s.voided));
  if (!ok) return `run ${id} (stake ${o.bet}, ${o.steps} steps seen at ${o.mx}x${o.pend ? ', a step in flight' : ''}) closed with spend ${s.spend} credit ${s.credit} void ${s.voided}; allowed: ${allowedCloses(o).map((a) => (a.kind === 'void' ? `refund ${o.bet}` : `win ${a.credit}`)).join(' | ')}`;
  W.model.applyCamp({ key: o.key, cur: o.cur, rid: o.rid, bet: o.bet, win: ok.kind === 'void' ? o.bet : ok.credit, reason: via, steps: o.steps, mx: o.mx, via, void: ok.kind === 'void' });
  W.camp.c[via === 'boot' ? 'boot' : 'unacked']++;
  return null;
}
// each check pass: a run whose client has since lost its socket (or a kill came) and that the ledger closed. A run with a client that WAS listening must be told (checkCampaign flags it).
function adoptUnheard(W) {
  const C = W.checker, B = W.model.camp, now = Date.now();
  for (const [id, o] of [...B.open]) {
    const bot = W.bots.get(o.key);
    const gone = !bot || bot.gen !== o.gen || o.epoch !== W.camp.epoch || W.mute.camp;
    if (!gone) continue;
    const e = C.campRounds.get(id) || {};
    if (!e.close || now - e.close.seenAt < 1200) continue;
    const bad = adoptClose(W, o, e.close, 'unacked');
    if (bad) W.violate('I7', bad, { run: id }, 'a close that matches the run the client last saw', e.close.ref);
  }
}

// ---------------- after a kill ----------------
// sent: the starts that were in flight (no answer) when the server died. cls: checker.classifyRestart(). Returns violations.
function reconcile(W, cls, sent) {
  const B = W.model.camp, C = W.camp, bad = [];
  const v = (message, accounts, expected, got) => bad.push({ step: W.stepNo, id: 'I9', message, accounts: accounts || {}, expected, got });
  const pool = sent.slice();
  for (const L of cls.racing) {
    const s = L.camp; if (!s) continue;
    const id = `${s.key}:${s.rid}`;
    if (B.rounds.has(id)) continue;
    if (s.suffix === 'open') {
      if (B.open.has(id)) continue;
      const i = pool.findIndex((x) => x.key === s.key && x.mode === s.cur && x.bet === s.open);
      if (i < 0) { v(`ledger has an open Campaign run ${L.ref} (stake ${s.open}) that no start in flight at the kill explains`, { ref: L.ref }, 'a start sent and not answered', `stake ${s.open}`); continue; }
      pool.splice(i, 1);
      B.open.set(id, { key: s.key, cur: s.cur, rid: s.rid, bet: s.open, steps: 0, mx: 100, trail: [], options: [], gen: -1, epoch: C.epoch, pend: null, since: Date.now() });
    } else {
      const o = B.open.get(id);
      if (!o) { v(`ledger has a Campaign close ${L.ref} for a run the harness never saw open`, { ref: L.ref }, 'a run that was open', L.ref); continue; }
      const err = adoptClose(W, o, L, 'unacked');
      if (err) v(err, { ref: L.ref }, 'the close of the open run', L.ref);
    }
  }
  for (const L of cls.bootCamp) {
    const s = L.camp, id = `${s.key}:${s.rid}`;
    if (B.rounds.has(id)) { v(`boot recovery closed ${id} a second time`, { ref: L.ref }, 'one close', L.ref); continue; }
    const o = B.open.get(id);
    if (!o) { v(`boot recovery closed a run (${L.ref}) that the harness never saw open`, { ref: L.ref }, 'a run that was open at the kill', L.ref); continue; }
    const err = adoptClose(W, o, L, 'boot');
    if (err) v(err, { ref: L.ref }, 'the close of the open run', L.ref);
  }
  for (const [id, o] of [...B.open]) v(`run ${id} (stake ${o.bet}) was still open after the restart: neither the dying process nor boot recovery wrote a close line for it`, { run: id, openSince: Date.now() - o.since }, 'exactly one close line', 'none');
  return bad;
}
function afterRestart(W) { W.camp.inflight = []; W.camp.epoch++; }
function inflightList(W) { return W.camp.inflight.filter((x) => x.kind === 'start'); }

async function init(W) {
  const st = await W.admin.req('g:campaign:state', {}, 'g:campaign:state', 4000);
  if (!st.data) throw new Error('no g:campaign:state: ' + JSON.stringify(st.error || st));
  const d = st.data;
  if (!same(d.betLevels, E.BET_LEVELS)) throw new Error('the server shows other bet levels than the engine: ' + JSON.stringify(d.betLevels));
  if (Object.keys(d.map.states).length !== 50) throw new Error('the map in state has ' + Object.keys(d.map.states).length + ' states');
  if (d.idleMs > 10000) throw new Error('the soak needs CAMPAIGN_IDLE_MS (a short idle timer); the server shows idleMs ' + d.idleMs + ' (is CAMPAIGN_TEST=1 set?)');
  W.camp.idleMs = d.idleMs;
}

// ---------------- operations ----------------
const pace = async (W, bot, ev) => { const k = bot.key + '|' + ev, w = 170 - (Date.now() - (W.camp.lastAt.get(k) || 0)); if (w > 0) await sleep(w); W.camp.lastAt.set(k, Date.now()); };
const have = (W, bot, cur) => { W.checker.poll(); return W.checker.balance(cur, acct(bot.key, cur)); };
const refuse = (W, r, what) => { const code = r.error.code; W.camp.c.errors++; if (code === 'funds') W.camp.c.funds++; else if (code === 'rate') W.camp.c.rate++; else if (code === 'run_open') W.camp.c.runOpen++; else W.warn('camp_error_' + code, `${what}: ${r.error.message}`); return { kind: 'refused', code }; };

async function startRun(W, bot, { mode, bet, home }) {
  await pace(W, bot, 'start'); W.checker.poll();
  const rec = { key: bot.key, kind: 'start', mode, bet, home }; W.camp.inflight.push(rec); bot.spinsInFlight++;
  const r = await bot.req('g:campaign:start', { mode, bet, home }, 'g:campaign:run', 5000);
  bot.spinsInFlight--; const i = W.camp.inflight.indexOf(rec); if (i >= 0) W.camp.inflight.splice(i, 1);
  if (r.timeout) throw new Error(`no answer to a Campaign start from ${bot.key} within 5 s (harness problem, not a money disagreement)`);
  if (r.error) return { ...refuse(W, r, `start ${mode} ${bet} ${home}`), run: r.error.run || null };
  return { kind: 'run', run: r.data.run };
}
async function stepRun(W, bot, o, to, force) {
  await pace(W, bot, 'step');
  const opt = o.options.find((x) => x.to === to), n = o.steps + 1;
  o.pend = { kind: 'step', to, n, opt, force: force || null }; bot.spinsInFlight++;
  const r = await bot.req('g:campaign:step', { roundId: o.rid, n, to, ...(force ? { force } : {}) }, ['g:campaign:step', 'g:campaign:end'], 5000, { pred: (d) => d.roundId === o.rid });
  bot.spinsInFlight--;
  if (r.timeout) throw new Error(`no answer to a Campaign step from ${bot.key} within 5 s (harness problem)`);
  if (r.error) { if (o.pend && o.pend.n === n) o.pend = null; return refuse(W, r, `step ${to}`); }
  return { kind: r.ev === 'g:campaign:end' ? 'end' : 'step', data: r.data };
}
async function cashRun(W, bot, o) {
  await pace(W, bot, 'cash');
  o.pend = { kind: 'cash' }; bot.spinsInFlight++;
  const r = await bot.req('g:campaign:cash', { roundId: o.rid }, 'g:campaign:end', 5000, { pred: (d) => d.roundId === o.rid });
  bot.spinsInFlight--;
  if (r.timeout) throw new Error(`no answer to a Campaign cash from ${bot.key} within 5 s (harness problem)`);
  if (r.error) { if (o.pend && o.pend.kind === 'cash') o.pend = null; return refuse(W, r, 'cash'); }
  return { kind: 'end', data: r.data };
}
const modelOpen = (W, o) => W.model.camp.open.has(`${o.key}:${o.rid}`);

function pickBet(W, bot, cur) {
  const h = have(W, bot, cur), ok = W.camp.betLevels.filter((b) => b <= h);
  if (!ok.length) return null;
  return W.rng.weighted(ok.map((b) => [b >= 1000 ? 1 : 2, b]));
}
const pickTo = (W, o, avoidDead = true) => { const live = o.options.filter((x) => !x.deadEnd); return W.rng.pick(avoidDead && live.length ? live : o.options).to; };
async function begin(W, bot, mode, home) {
  const bet = pickBet(W, bot, mode); if (!bet) return null;
  const r = await startRun(W, bot, { mode, bet, home: home || W.rng.pick(W.camp.homes) });
  if (r.kind !== 'run') return { refused: r };
  return { o: W.model.camp.open.get(`${bot.key}:${r.run.roundId}`) || null, run: r.run };
}
// start a run for a chaos kill: -> the open model entry, after `steps` forced survivals (or null)
async function prepare(W, steps) {
  const bots = W.connectedBots().filter((b) => !W.model.camp.hasOpen(b.key)).sort(() => W.rng() - 0.5);
  for (const bot of bots.slice(0, 3)) {
    const mode = W.rng.chance(0.5) ? 'play' : 'chips';
    const b = await begin(W, bot, mode); if (!b || !b.o) continue;
    let o = b.o;
    for (let i = 0; i < steps && modelOpen(W, o); i++) await stepRun(W, bot, o, pickTo(W, o), 'survive');
    if (modelOpen(W, o)) return o;
  }
  return null;
}
// ledger lines of this player's Campaign refs written after the mark (a refused or hostile request must write none)
const markLines = (W) => { W.checker.poll(); return W.checker.lines.length; };
const newCampLines = (W, n0, key) => { W.checker.poll(); return W.checker.lines.slice(n0).filter((L) => L.camp && L.camp.key === key); };
const bots = (W) => W.connectedBots();
const freeBot = (W) => { const l = bots(W).filter((b) => !W.model.camp.hasOpen(b.key)); return l.length ? W.rng.pick(l) : null; };

const HOSTILE = [
  ['start', (W) => ({ mode: 'play', bet: 150, home: 'OH' }), 'bad_bet'], ['start', () => ({ mode: 'play', bet: '100', home: 'OH' }), 'bad_bet'], ['start', () => ({ mode: 'gold', bet: 100, home: 'OH' }), 'bad_mode'],
  ['start', () => ({ mode: 'chips', bet: 100, home: 'XX' }), 'bad_home'], ['start', () => ({ mode: 'chips', bet: 100, home: '__proto__' }), 'bad_home'], ['start', () => null, 'bad_mode'],
  ['start', () => ({ mode: 'play', bet: 1e300, home: 'OH' }), 'bad_bet'], ['start', () => ({ mode: 'play', bet: -100, home: 'OH' }), 'bad_bet'],
];

module.exports = {
  name: 'campaign', weight: 16,
  attach, listen, init, afterRestart, adoptUnheard, reconcile, inflightList, WITNESS,
  ops: { prepare, startRun, stepRun, cashRun, begin },
  async step(W) {
    const C = W.camp, B = W.model.camp, all = bots(W);
    if (!all.length) return null;
    const kind = W.rng.weighted([[26, 'ride'], [12, 'scandal'], [8, 'withdraw'], [10, 'idle'], [8, 'drop'], [4, 'unaffordable'], [6, 'second'], [6, 'double'], [5, 'hostile'], [W.camp.c.landslide + W.camp.landslideTries < 2 ? 1 : 0, 'landslide'], [3, 'probe']]);
    const mode = W.rng.chance(0.5) ? 'play' : 'chips';
    const rec = (what, bot, extra) => ({ actor: 'campaign', what, who: bot && bot.key, mode, ...(extra || {}) });
    if (kind === 'probe') {                                   // `state` for a player with or without a run: it must say what the client was told
      const bot = W.rng.pick(all); await pace(W, bot, 'state');
      const st = await bot.req('g:campaign:state', {}, 'g:campaign:state', 4000, { errs: false });
      if (!st.data) return null;
      const o = B.openOf(bot.key), v = st.data.run;
      if (o && o.gen === bot.gen && v) {
        if (v.roundId !== o.rid || v.steps !== o.steps || v.mx !== o.mx) violate(W, `state shows ${v.roundId} step ${v.steps} ${v.mx}x, the client was told ${o.rid} step ${o.steps} ${o.mx}x`, { key: bot.key }, `${o.rid} ${o.steps} ${o.mx}`, `${v.roundId} ${v.steps} ${v.mx}`);
      } else if (!o && v && !W.mute.camp) violate(W, `state shows an open run ${v.roundId} for ${bot.key}, the client was never told one is open`, { key: bot.key }, 'no run', v.roundId);
      return rec('state', bot, { run: v ? v.roundId : null });
    }
    if (kind === 'second' || kind === 'double' || kind === 'drop') {
      const mine = [...B.open.values()].filter((o) => all.some((b) => b.key === o.key) && W.bots.get(o.key).gen === o.gen);
      let o = mine.length && W.rng.chance(0.5) ? W.rng.pick(mine) : null, bot = o ? W.bots.get(o.key) : null;
      if (!o) { bot = freeBot(W); if (!bot) return null; const b = await begin(W, bot, mode); if (!b || !b.o) return null; o = b.o; }
      if (kind === 'second') {                                // a second start while a run is open: run_open with the run, nothing moves
        await pace(W, bot, 'start'); const n0 = markLines(W);
        const r = await bot.req('g:campaign:start', { mode: W.rng.pick(['play', 'chips']), bet: 100, home: 'TX' }, 'g:campaign:run', 4000);
        if (!r.error || r.error.code !== 'run_open') { if (r.error && (r.error.code === 'rate')) return rec('second', bot, { answer: 'rate' }); violate(W, `a second start while a run is open was answered ${JSON.stringify(r.error || r.ev)}`, { key: bot.key }, 'run_open', r.error ? r.error.code : r.ev); return rec('second', bot, { answer: 'unexpected' }); }
        C.c.runOpen++;
        if (!r.error.run || r.error.run.roundId !== o.rid) violate(W, 'run_open does not carry the open run', { key: bot.key }, o.rid, r.error.run && r.error.run.roundId);
        { const ls = newCampLines(W, n0, bot.key).filter((L) => L.camp.suffix === 'open'); if (ls.length) violate(W, 'a second start wrote a second :open line', { key: bot.key }, 'no line', ls.map((L) => L.ref).join(',')); }
        return rec('second', bot, { run: o.rid, answer: 'run_open' });
      }
      if (kind === 'double') {                                // two identical steps (or cashes) back to back: one effect
        C.c.doubles++; await pace(W, bot, 'step');
        const cash = o.steps >= 1 && W.rng.chance(0.4), to = pickTo(W, o), n = o.steps + 1, force = W.rng.chance(0.6) ? 'survive' : undefined;
        const ev = cash ? 'g:campaign:cash' : 'g:campaign:step', payload = cash ? { roundId: o.rid } : { roundId: o.rid, n, to, ...(force ? { force } : {}) };
        o.pend = cash ? { kind: 'cash' } : { kind: 'step', to, n, opt: o.options.find((x) => x.to === to), force: force || null };
        bot.spinsInFlight += 2;
        const got = await bot.collect(['g:campaign:step', 'g:campaign:end'], 2, 4000, () => { bot.emit(ev, payload); bot.emit(ev, payload); });
        bot.spinsInFlight -= 2;
        if (o.pend) o.pend = null;
        const good = got.filter((g) => g.ev), errs = got.filter((g) => g.error);
        if (good.length > 1) violate(W, `a double ${cash ? 'cash' : 'step'} was answered twice`, { key: bot.key }, 'one effect', good.length + ' answers');
        for (const g of errs) { C.c.errors++; if (g.error.code !== 'rate' && g.error.code !== 'no_run' && g.error.code !== 'bad_step') W.warn('camp_error_' + g.error.code, g.error.message); }
        return rec('double', bot, { run: o.rid, ev: cash ? 'cash' : 'step', answers: got.map((g) => (g.error ? g.error.code : g.ev)) });
      }
      // drop: the socket goes with a run open; sometimes for longer than the idle timer, so the run closes with nobody to hear it
      C.c.drops++;
      if (bot.tableId) return null;                           // a seated player: the poker actor owns that reconnect
      const long = W.rng.chance(0.3);
      bot.close(); await sleep(long ? (C.idleMs || 2500) + 1200 : W.rng.range(120, 500));
      await bot.connect(); const a = await bot.resume();
      if (!a.data) throw new Error(`${bot.key} could not resume after dropping its socket: ${JSON.stringify(a.error || a)}`);
      await pace(W, bot, 'state');
      const st = await bot.req('g:campaign:state', {}, 'g:campaign:state', 4000, { errs: false });
      const v = st.data && st.data.run;
      if (v && modelOpen(W, o)) {                             // still open: the server must show the run as the client last saw it (plus a step the client never heard of)
        C.c.resyncs++;
        if (v.roundId !== o.rid) violate(W, `after a reconnect state shows run ${v.roundId}, the client had ${o.rid}`, { key: bot.key }, o.rid, v.roundId);
        else if (!(v.steps === o.steps || (o.pend && v.steps === o.steps + 1)) || (v.steps === o.steps && v.mx !== o.mx)) violate(W, `after a reconnect state shows ${v.steps} steps ${v.mx}x, the client last saw ${o.steps} steps ${o.mx}x`, { key: bot.key }, `${o.steps} ${o.mx}`, `${v.steps} ${v.mx}`);
        else { const bad = judgeView(v, o.bet); if (bad) violate(W, 'state run view: ' + bad, { key: bot.key }, 'the engine', bad); o.steps = v.steps; o.mx = v.mx; o.trail = v.trail.slice(); o.options = v.options; o.gen = bot.gen; o.pend = null; }
        if (modelOpen(W, o) && W.rng.chance(0.5)) await cashRun(W, bot, o);
      }
      return rec('drop', bot, { run: o.rid, long, answer: v ? 'open' : 'closed' });
    }
    if (kind === 'unaffordable') {
      const bot = W.rng.pick(all); if (B.hasOpen(bot.key)) return null;
      let h = have(W, bot, mode), bet = W.camp.betLevels.slice().reverse().find((b) => b > h), restore = null;
      if (!bet && mode === 'play' && !bot.tableId && !W.model.slot.hasOpen(bot.key) && bot.spinsInFlight === 0 && W.admin.connected()) {      // nobody is poor: make one player poor in Cash through the admin (same book-keeping as the bank actor), then give it back
        const cents = W.rng.range(0, 99), r = await W.admin.req('admin_set_play', { key: bot.key, cents, opId: opId() }, 'admin_result', 4000, { pred: (d) => d.op === 'set_play' });
        if (!(r.data && r.data.ok)) { if (r.data && r.data.code === 'cash_in_play') violate(W, `admin_set_play ${cents} for ${bot.key} refused for cash in play, but the bot has no seat, no open run and no open slot round`, { key: bot.key }, 'ok', JSON.stringify(r.data)); return null; }     // K1-3: a refused set changes nothing, so the model is left alone
        W.model.applyAdmin(bot.key, 'play', cents - h); restore = h; h = cents; bet = 100;
      }
      if (!bet) return null;
      const n0 = markLines(W), r = await startRun(W, bot, { mode, bet, home: 'OH' });
      if (restore != null) { const now = have(W, bot, 'play'); const rr = await W.admin.req('admin_set_play', { key: bot.key, cents: restore, opId: opId() }, 'admin_result', 4000, { pred: (d) => d.op === 'set_play' }); if (rr.data && rr.data.ok) { if (restore !== now) W.model.applyAdmin(bot.key, 'play', restore - now); } else violate(W, `admin_set_play ${restore} (give the Cash back) for ${bot.key} was refused`, { key: bot.key }, 'ok', JSON.stringify(rr.data || rr.error)); }       // K1-3: the set is the TOTAL; this bot has no run, seat or round, so the wallet is the total and a refusal is a finding
      if (r.kind === 'run') return rec('start_big', bot, { bet, answer: 'run' });
      { const ls = newCampLines(W, n0, bot.key).filter((L) => L.camp.suffix === 'open'); if (r.code === 'funds' && ls.length) violate(W, 'a refused start (funds) wrote a ledger line', { key: bot.key }, 'nothing', ls.map((L) => L.ref).join(',')); }
      return rec('start_big', bot, { bet, answer: r.code });
    }
    if (kind === 'hostile') {
      const bot = W.rng.pick(all); C.c.hostile++;
      const [ev, mk, want] = W.rng.pick(HOSTILE);
      await pace(W, bot, ev); const n0 = markLines(W);
      const r = await bot.req('g:campaign:' + ev, mk(W), 'g:campaign:run', 2500, { errs: true });
      if (!r.error || (r.error.code !== want && !(r.error.code === 'run_open' || r.error.code === 'rate'))) violate(W, `a hostile ${ev} ${JSON.stringify(mk(W))} was answered ${JSON.stringify(r.error || r.ev || 'nothing')}`, { key: bot.key }, want, r.error ? r.error.code : r.ev || 'timeout');
      { const ls = newCampLines(W, n0, bot.key).filter((L) => L.camp.suffix === 'open'); if (ls.length && r.error) violate(W, 'a refused hostile start wrote a ledger line', { key: bot.key }, 'nothing', ls.map((L) => L.ref).join(',')); }
      return rec('hostile', bot, { ev, answer: r.error ? r.error.code : r.ev });
    }
    const bot = freeBot(W); if (!bot) return null;
    if (kind === 'landslide') {                               // the witness route, 49 forced survivals, the 50th state: 1,000x of a $1.00 / 100 chip stake. Rare: it takes about 9 s.
      W.camp.landslideTries++;
      const m = have(W, bot, 'play') >= 100 ? 'play' : 'chips'; if (have(W, bot, m) < 100) return null;
      const r = await startRun(W, bot, { mode: m, bet: 100, home: WITNESS[0] }); if (r.kind !== 'run') return null;
      const o = B.open.get(`${bot.key}:${r.run.roundId}`); if (!o) return null;
      let last = null;
      for (let i = 1, tries = 0; i < 50 && modelOpen(W, o) && tries < 400; tries++) {
        last = await stepRun(W, bot, o, WITNESS[i], 'survive');
        if (last.kind === 'refused') { if (last.code === 'rate') { await sleep(220); continue; } break; }   // a busy server can bunch two steps inside its 150 ms window: ask again, never skip a state
        i++;
      }
      if (modelOpen(W, o)) await cashRun(W, bot, o);
      return rec('landslide', bot, { mode: m, end: last && last.kind });
    }
    const b = await begin(W, bot, mode); if (!b) return null;
    if (b.refused) return rec('start', bot, { answer: b.refused.code });
    const o = b.o; if (!o) return null;
    const bet = o.bet;
    if (kind === 'withdraw') { const r = await cashRun(W, bot, o); return rec('withdraw', bot, { bet, answer: r.kind }); }
    if (kind === 'scandal') {
      const pre = W.rng.int(3);
      for (let i = 0; i < pre && modelOpen(W, o); i++) await stepRun(W, bot, o, pickTo(W, o), 'survive');
      if (modelOpen(W, o)) await stepRun(W, bot, o, pickTo(W, o, false), 'scandal');
      return rec('scandal', bot, { bet, pre });
    }
    const n = kind === 'idle' ? W.rng.int(3) : 1 + W.rng.int(5);
    for (let i = 0; i < n && modelOpen(W, o); i++) await stepRun(W, bot, o, pickTo(W, o, W.rng.chance(0.85)), W.rng.chance(0.65) ? 'survive' : undefined);
    if (kind === 'idle') return rec('idle', bot, { bet, steps: n, note: 'left to the idle timer' });
    if (modelOpen(W, o)) await cashRun(W, bot, o);
    return rec('ride', bot, { bet, steps: n });
  },
};
