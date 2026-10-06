'use strict';
// node tests/coldcall-livecfg.js  (self-contained: temp dir, fake io, no network except the admin API test on 127.0.0.1, ephemeral port)
// COLD CALL live config (JOB B, wave DENOMS + LIVECFG): validate, smoke-test, swap without a restart, persist, reload; an open round
// finishes on the whole config it started on; every server call site reads the live config; the admin API; stored state under a changed config.
// Mirrors tests/bender-livecfg.js (five tests) and adds the rest. Contract: cold-call/PULL-ENGINE.md section 8.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const http = require('http');
const crypto = require('crypto');
const EventEmitter = require('events');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'coldcall-livecfg-'));
const CFG_FILE = path.join(tmp, 'coldcall-config.json');
process.env.WALLET_FILE = path.join(tmp, 'wallet.json');
process.env.COLDCALL_CFG_FILE = CFG_FILE;
for (const k of ['COLDCALL_PULL_FILE', 'DATA_DIR', 'RAILWAY_VOLUME_MOUNT_PATH', 'BENDER_ADMIN_TOKEN']) delete process.env[k];
const E = require('../games/coldcall-engine.js');
let L = null; try { L = require('../games/coldcall-livecfg.js'); } catch (e) { L = null; }   // the old tree has no such file: every test then fails on its own
const SRV = require('../games/coldcall.js');
const games = require('../games');
const { createWallet } = require('../wallet.js');

const SHIPPED = structuredClone(E.CFG);          // the values the code ships with
const cfgJson = () => JSON.stringify(E.CFG);
const clone = (o) => JSON.parse(JSON.stringify(o));
const need = () => { assert.ok(L, 'games/coldcall-livecfg.js is missing'); return L; };

let pass = 0;
const test = async (name, fn) => { try { await fn(); pass++; console.log('ok   ' + name); } catch (e) { console.error('FAIL ' + name + '\n' + (e.stack || e)); process.exitCode = 1; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeSocket(io, acct) {
  const s = new EventEmitter();
  s.data = acct ? { acct: typeof acct === 'string' ? { key: acct } : acct } : {};
  s.out = [];
  const emit = s.emit.bind(s);
  s.send = (ev, p) => emit(ev, p);             // client -> server
  s.emit = (ev, p) => { if (ev in { error: 1, wallet: 1 } || ev.startsWith('g:') || ev.startsWith('floor:')) { s.out.push([ev, p]); return true; } return emit(ev, p); };
  io.sockets.sockets.set(String(Math.random()), s);
  io.emit('connection', s);
  return s;
}
const last = (s, ev) => { for (let i = s.out.length - 1; i >= 0; i--) if (s.out[i][0] === ev) return s.out[i][1]; return null; };
const all = (s, ev) => s.out.filter((o) => o[0] === ev).map((o) => o[1]);

// put the live config back to the shipped values (module state, file and Eng.CFG), as a fresh process would have it
function resetLive() {
  if (SRV.setLiveConfig) { try { SRV.setLiveConfig({ overrides: {} }); } catch {} }
  fs.rmSync(CFG_FILE, { force: true }); fs.rmSync(CFG_FILE + '.tmp', { force: true });
  for (const k of Object.keys(E.CFG)) delete E.CFG[k];
  Object.assign(E.CFG, structuredClone(SHIPPED));
}
function freshProcess() {      // Eng.CFG as a new process has it (shipped values); the config FILE stays
  for (const k of Object.keys(E.CFG)) delete E.CFG[k];
  Object.assign(E.CFG, structuredClone(SHIPPED));
}

// each setup has its own dir (wallet.json + coldcall-pull.json next to it); pass { dir, bank, t } to restart over the same files
function setup(opts = {}) {
  SRV._history.clear();
  SRV.log = opts.log || (() => {});
  SRV.potRng = opts.potRng || (() => 1);          // never hits unless a test says so
  SRV.roundRng = opts.roundRng;
  const dir = opts.dir || fs.mkdtempSync(path.join(tmp, 's'));
  const io = new EventEmitter(); io.sockets = { sockets: new Map() };
  const ledger = { log: () => {} };
  let t = opts.t || 1000000;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const hook = { push: () => {} };
  const bank = opts.bank || new Map();
  const chips = { get: (k) => (bank.has(k) ? bank.get(k) : 10000), add: (k, d) => { bank.set(k, Math.max(0, chips.get(k) + d)); hook.push(k); } };
  const wallet = createWallet({ file: path.join(dir, 'wallet.json'), ledger, chips, now: clock.now, onChange: (k) => hook.push(k) });
  const g = games({ io, ledger, now: clock.now, rng: opts.rng, accounts: {}, tables: {}, rooms: {}, wallet, chips });
  hook.push = g.pushWallet;
  const store = () => SRV._pull.store;
  const potOf = (mode) => store().pot(mode, E.CFG.pull.pot.seed);
  return { io, clock, wallet, g, dir, bank, chips, store, potOf, sock: (a) => makeSocket(io, a), open: SRV._pull.open };
}

function spin(s, sock, payload) {
  s.clock.advance(200);
  const n = all(sock, 'g:coldcall:result').length, e = all(sock, 'error').length;
  sock.send('g:coldcall:spin', payload);
  const rs = all(sock, 'g:coldcall:result');
  if (rs.length > n) return rs[rs.length - 1];
  const es = all(sock, 'error'); assert.ok(es.length > e, 'a spin gives a result or an error');
  return { error: es[es.length - 1] };
}
const policy = (i, pend) => (pend.k === 'pick' ? { k: 'pick', p: pend.choices[i % 2 ? pend.choices.length - 1 : 0] } : { k: 'more', take: i % 3 !== 0 });
function decide(s, sock, res, d) {
  const n = all(sock, 'g:coldcall:result').length;
  sock.send('g:coldcall:decide', { roundId: res.roundId, ...d });
  const rs = all(sock, 'g:coldcall:result'); assert.ok(rs.length > n, 'a decision gives a result: ' + JSON.stringify(last(sock, 'error')));
  return rs[rs.length - 1];
}
// spin, then answer every decision with the policy until the round is done
function play(s, sock, payload, i = 0) {
  let r = spin(s, sock, payload), n = 0;
  while (r.status === 'pending') r = decide(s, sock, r, policy(i + n++, r.pending));
  return r;
}
function toPending(s, sock, kind, mode = 'play', bet = 10) {
  for (let i = 0; i < 600; i++) {
    let r = spin(s, sock, { bet, mode, buyBonus: i % 3 === 2 ? 'bonus2' : 'bonus1' });
    if (r.error) throw new Error('toPending: ' + JSON.stringify(r.error));
    let n = 0;
    while (r.status === 'pending') { if (r.pending.k === kind) return r; r = decide(s, sock, r, policy(i + n++, r.pending)); }
  }
  throw new Error('no ' + kind + ' decision in 600 buys');
}
const rich = (s, key) => s.wallet.credit(key, 'play', 1e10);
const state = (s, sock) => { sock.send('g:coldcall:state'); return last(sock, 'g:coldcall:state'); };
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' });

// a swap that changes every class of knob at once (baked tables, live reads, pull knobs, pot, decision timer)
const BIG_SWAP = {
  payScale: 3, buyCost: { bonus1: 700, call: 40 }, spins: { bonus1: 5 }, retrigger: { two: 1 }, maxCascades: 20,
  pull: { list: 60, fill: { dead: 2, win: 1, bonus: 1 }, pick: { minLeads: 4, mult: { gold: 9 } }, more: { mult: 3, rtp: 0.9, minTenths: 100 },
    pot: { feedBps: 150, oneInPerDollar: 400, minBal: 5, capCents: 650 }, decision: { timeoutMs: 5000 }, feed: { minWinX: 1 } },
};

(async () => {
  // ------------------------------------------------------------------------------------------ the five Bender tests
  await test('boots on defaults with no file', async () => {
    resetLive(); const s = setup({ rng: E.rngFrom(1) });
    assert.strictEqual(cfgJson(), JSON.stringify(SHIPPED)); assert.ok(!fs.existsSync(CFG_FILE));
    const info = SRV.liveInfo(); assert.strictEqual(info.rtpLabel, SRV.RTP_LABEL); assert.deepStrictEqual(info.overrides, {});
    const a = s.sock('ann'); assert.strictEqual(state(s, a).rtp, SRV.RTP_LABEL);
  });

  const BAD = [
    ['unknown top key', { nope: 1 }], ['unknown nested key', { pull: { nope: 1 } }], ['unknown key under a block', { pull: { pot: { jackpot: 5 } } }],
    ['__proto__ key', JSON.parse('{"__proto__":{"polluted":1}}')], ['constructor key', { constructor: { x: 1 } }],
    ['text for a number', { pull: { list: '450' } }], ['NaN', { pull: { list: NaN } }], ['Infinity', { pull: { list: Infinity } }], ['-Infinity', { pull: { cold: { afterMs: -Infinity } } }],
    ['negative', { pull: { list: -1 } }], ['negative money knob', { pull: { feed: { minWinCents: -5 } } }], ['zero list', { pull: { list: 0 } }],
    ['null for a number (a JSON copy of Infinity, N3)', JSON.parse(JSON.stringify({ pull: { list: Infinity } }))], ['undefined', { pull: { list: undefined } }],
    ['pull block removed (N4)', { pull: null }], ['nested block removed (N4)', { pull: { cold: null } }], ['block replaced by a list', { pull: { pot: [] } }], ['block replaced by a number', { pull: { pot: 5 } }],
    ['pay table removed', { pay: null }], ['one symbol removed', { pay: { mug: null } }], ['weights removed', { weights: null }], ['extra block removed', { extra: { base: null } }],
    ['weights wrong length', { weights: [1, 2] }], ['pay row wrong length', { pay: { mug: [1, 2, 3] } }], ['text inside a list', { pay: { mug: [3, 10, 10, 11, 16, 50, 140, 450, '1300'] } }],
    ['NaN inside a list', { pay: { mug: [3, 10, 10, 11, 16, 50, 140, 450, NaN] } }], ['empty pair list', { bubbles: { bronze: [] } }], ['ragged pair row', { bubbles: { bronze: [[2, 30], [5]] } }],
    ['fractional bubble value', { bubbles: { bronze: [[2.5, 30]] } }], ['fractional upsell multiplier', { upsell: [[2.5, 40]] }],
    ['bool as a number', { pull: { on: 1 } }], ['text as a bool', { pull: { on: 'true' } }], ['null as a bool', { pull: { carryOver: null } }], ['bool as a number knob', { pull: { list: true } }],
    ['unknown callback kind', { pull: { callback: { kind: 'bonus3' } } }], ['callback kind not text', { pull: { callback: { kind: 5 } } }],
    ['pot.seed above 0 (W9: mints currency)', { pull: { pot: { seed: 1 } } }], ['capCents below what the pot is fed', { pull: { pot: { capCents: 100 } } }],
    ['feed raised past the cap', { pull: { pot: { feedBps: 500, capCents: 1000 } } }], ['pot never hits but is fed', { pull: { pot: { oneInPerDollar: 0 } } }],
    ['buy price 0', { buyCost: { bonus1: 0 } }], ['buy price fractional', { buyCost: { call: 2.5 } }], ['timeout too short', { pull: { decision: { timeoutMs: 100 } } }], ['timeout too long', { pull: { decision: { timeoutMs: 1e9 } } }],
    ['feed threshold negative', { pull: { feed: { minWinX: -1 } } }], ['cold step 0', { pull: { cold: { stepMs: 0 } } }], ['warm chance above 1', { pull: { warm: { chance: 1.5 } } }],
    ['fill.dead below fill.win', { pull: { fill: { dead: 0.1, win: 0.9 } } }], ['all weights 0', { weights: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }],
    ['maxSpins absurd', { maxSpins: 1e9 }], ['start spins absurd', { spins: { bonus1: 1e9 } }], ['start spins above maxSpins', { spins: { bonus1: 99 } }], ['adjacency 5', { adjacency: 5 }],
    ['maxWinTenths above the 10,000x cap', { maxWinTenths: 1e9 }], ['payScale 0', { payScale: 0 }], ['ONE MORE CALL rtp above mult', { pull: { more: { mult: 2, rtp: 5 } } }],
    ['D1: ONE MORE CALL rtp 1.5 (a gamble that pays 150%)', { pull: { more: { rtp: 1.5 } } }], ['D1: ONE MORE CALL rtp 2 with mult 2 (always wins)', { pull: { more: { rtp: 2, mult: 2 } } }],
    ['D2: three times as many pot hits, cap unchanged (chaser bar)', { pull: { pot: { oneInPerDollar: 1000 } } }], ['D2: oneInPerDollar 100, capCents 1e9 (chaser bar)', { pull: { pot: { oneInPerDollar: 100, capCents: 1e9 } } }],
    ['reveal weight text', { reveal: { base: { gold: 'x' } } }], ['overrides null', null], ['overrides a list', []], ['overrides text', 'x'], ['overrides a number', 7],
  ];
  await test('rejects every bad config (unknown key, text, NaN, Infinity, negative, wrong shape or length, removed block, relationship); nothing changes, no file is written', async () => {
    resetLive(); setup({ rng: E.rngFrom(2) });
    const before = cfgJson(), info0 = JSON.stringify(SRV.liveInfo());
    for (const [label, bad] of BAD) {
      assert.throws(() => SRV.setLiveConfig({ overrides: bad }), (e) => e instanceof Error && e.message.length > 0, 'must reject: ' + label);
      assert.strictEqual(cfgJson(), before, 'config untouched after: ' + label); assert.ok(!fs.existsSync(CFG_FILE), 'no file after: ' + label);
    }
    assert.strictEqual(JSON.stringify(SRV.liveInfo()), info0); assert.strictEqual(Object.prototype.polluted, undefined);
    assert.throws(() => SRV.setLiveConfig({ overrides: { pull: { list: -1 } } }), /pull\.list/, 'the message names the key');
    assert.throws(() => SRV.setLiveConfig({ overrides: { pull: { pot: { seed: 1 } } } }), /seed/);
    assert.throws(() => SRV.setLiveConfig({ overrides: { pull: { pot: { capCents: 100 } } } }), /capCents/);
  });

  await test('FIX D1: pull.more.rtp must be <= 1 (and still <= mult): 1.5 and {rtp 2, mult 2} are refused with a message naming the key; the shipped value, 1 and 0.9 pass', async () => {
    const mustRefuse = (o) => assert.throws(() => need().validate(o), /pull\.more\.rtp/);
    mustRefuse({ pull: { more: { rtp: 1.5 } } }); mustRefuse({ pull: { more: { rtp: 2, mult: 2 } } }); mustRefuse({ pull: { more: { rtp: 1.0001 } } }); mustRefuse({ pull: { more: { rtp: 3, mult: 5 } } });
    for (const rtp of [SHIPPED.pull.more.rtp, 1, 0.9, 0]) need().validate({ pull: { more: { rtp } } });
    need().validate({ pull: { more: { mult: 2, rtp: 1 } } }); need().validate({ pull: { more: { mult: 1, rtp: 1 } } });
  });

  await test('FIX D2: the chaser bar: capCents x 3 <= oneInPerDollar x 5 (capCents / 100 / oneInPerDollar <= 1.667 points); oneInPerDollar 1000 and {100, capCents 1e9} refused with a message naming the bar; the shipped 5000 / 3000 passes exactly, so do all three presets and a cap or hit chance moved the safe way', async () => {
    const mustRefuse = (o) => assert.throws(() => need().validate(o), /chaser bar/);
    mustRefuse({ pull: { pot: { oneInPerDollar: 1000 } } }); mustRefuse({ pull: { pot: { oneInPerDollar: 100, capCents: 1e9 } } });
    mustRefuse({ pull: { pot: { capCents: 5001 } } }); mustRefuse({ pull: { pot: { oneInPerDollar: 2999 } } });
    assert.strictEqual(SHIPPED.pull.pot.capCents * 3, SHIPPED.pull.pot.oneInPerDollar * 5, 'the shipped pot sits exactly on the bar'); need().validate({});
    need().validate({ pull: { pot: { capCents: 5000, oneInPerDollar: 3000 } } }); need().validate({ pull: { pot: { capCents: 4000 } } }); need().validate({ pull: { pot: { oneInPerDollar: 4000 } } }); need().validate({ pull: { pot: { oneInPerDollar: 0, feedBps: 0 } } });
    const dir = path.join(__dirname, '..', 'cold-call', 'presets'); const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); assert.ok(files.length >= 3);
    for (const f of files) L.validate(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).overrides);
    resetLive(); assert.throws(() => SRV.setLiveConfig({ overrides: { pull: { pot: { oneInPerDollar: 1000 } } } }), /chaser bar/); assert.strictEqual(cfgJson(), JSON.stringify(SHIPPED), 'nothing changed'); assert.ok(!fs.existsSync(CFG_FILE));
  });

  await test('accepts a good config; the smoke test plays every buy and full PULL rounds with decisions', async () => {
    const r = need().validate({ pull: { list: 100 }, buyCost: { bonus1: 800 } });
    assert.strictEqual(r.next.pull.list, 100); assert.strictEqual(r.next.buyCost.bonus1, 800); assert.strictEqual(r.next.buyCost.call, SHIPPED.buyCost.call, 'deep merge: the rest stays');
    const sm = r.smoke; assert.ok(sm.rounds >= 300, 'a few hundred rounds: ' + sm.rounds);
    for (const b of E.BUYS) assert.ok(sm.buys[b] >= 5, 'buy ' + b + ' played: ' + sm.buys[b]);
    assert.ok(sm.pull >= 100 && sm.decisions >= 5 && sm.callbacks >= 1, 'PULL rounds with decisions and a Callback: ' + JSON.stringify(sm));
    for (const ok of [{}, { pull: { list: 0.1 } }, { pull: { on: false } }, { pull: { pot: { oneInPerDollar: 0, feedBps: 0 } } }, { payScale: 0.5 }, { weights: [20, 20, 20, 20, 20, 20, 20, 20, 20, 20] }, { pull: { cold: { stepMs: 1000 }, decision: { timeoutMs: 3000 } } }])
      need().validate(ok);
  });

  await test('swap applies to the next round and buy costs, and persists', async () => {
    resetLive(); const s = setup({ rng: E.rngFrom(3) }); const a = s.sock('ann'); rich(s, 'ann');
    assert.strictEqual(state(s, a).buyPriceCents[100].bonus1, E.buyPrice(SHIPPED.buyCost.bonus1, 100));
    SRV.setLiveConfig({ overrides: { buyCost: { bonus1: 500 } }, note: 'test' });
    assert.strictEqual(E.CFG.buyCost.bonus1, 500); assert.strictEqual(E.CFG.buyCost.hunt, SHIPPED.buyCost.hunt); assert.strictEqual(E.CFG.pull.list, SHIPPED.pull.list);
    const st = state(s, a); assert.strictEqual(st.buyPriceCents[100].bonus1, 5000); assert.strictEqual(st.buyCostX.bonus1, 50);
    const r = spin(s, a, { bet: 100, mode: 'play', buyBonus: 'bonus1', auto: true });
    assert.strictEqual(r.cost, 5000, 'the next paid buy is charged the new price'); assert.strictEqual(r.status, 'done');
    const j = JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'));
    assert.deepStrictEqual(Object.keys(j).sort(), ['note', 'overrides', 'rtpLabel', 'updatedAt']); assert.deepStrictEqual(j.overrides, { buyCost: { bonus1: 500 } });
    assert.strictEqual(j.note, 'test'); assert.strictEqual(j.rtpLabel, null); assert.ok(!Number.isNaN(Date.parse(j.updatedAt))); assert.ok(!fs.existsSync(CFG_FILE + '.tmp'), 'atomic: no temp left');
  });

  await test('persisted and reloaded after a simulated restart', async () => {
    freshProcess(); assert.strictEqual(E.CFG.buyCost.bonus1, SHIPPED.buyCost.bonus1);
    const s = setup({ rng: E.rngFrom(4) });                                           // init loads the file
    assert.strictEqual(E.CFG.buyCost.bonus1, 500); assert.strictEqual(SRV.liveInfo().note, 'test');
    const a = s.sock('ann'); assert.strictEqual(state(s, a).buyPriceCents[100].bonus1, 5000);
  });

  await test('clientCfg carries the live price; reset restores defaults and the shipped label', async () => {
    assert.strictEqual(SRV.clientCfg().buyPriceCents[100].bonus1, 5000); assert.strictEqual(SRV.clientCfg().cfg.buyCost.bonus1, 500);
    SRV.setLiveConfig({ overrides: {} });
    assert.strictEqual(cfgJson(), JSON.stringify(SHIPPED)); assert.strictEqual(SRV.clientCfg().buyPriceCents[100].bonus1, E.buyPrice(SHIPPED.buyCost.bonus1, 100));
    assert.strictEqual(SRV.liveInfo().rtpLabel, SRV.RTP_LABEL);
  });

  await test('the file location: COLDCALL_CFG_FILE, else DATA_DIR, else RAILWAY_VOLUME_MOUNT_PATH, else the repo parent', async () => {
    const keep = { ...process.env };
    try {
      delete process.env.COLDCALL_CFG_FILE; delete process.env.DATA_DIR; delete process.env.RAILWAY_VOLUME_MOUNT_PATH;
      assert.strictEqual(need().file(), path.join(__dirname, '..', 'coldcall-config.json'));
      process.env.RAILWAY_VOLUME_MOUNT_PATH = '/vol'; assert.strictEqual(L.file(), path.join('/vol', 'coldcall-config.json'));
      process.env.DATA_DIR = '/data'; assert.strictEqual(L.file(), path.join('/data', 'coldcall-config.json'));
      process.env.COLDCALL_CFG_FILE = '/x/y.json'; assert.strictEqual(L.file(), '/x/y.json');
    } finally { for (const k of ['COLDCALL_CFG_FILE', 'DATA_DIR', 'RAILWAY_VOLUME_MOUNT_PATH']) { if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k]; } }
  });

  // ------------------------------------------------------------------------------------------ item 6: the RTP label
  const PRESET_DIR = path.join(__dirname, '..', 'cold-call', 'presets');
  const preset = (n) => JSON.parse(fs.readFileSync(path.join(PRESET_DIR, n + '.json'), 'utf8'));
  await test('RTP label (FIX D3): the shipped line for the shipped numbers; a label is shown only when the live merged config hashes to the measuredHash of a known preset whose label it is; anything else reads "custom settings, not measured" and the reply says so', async () => {
    resetLive(); const s = setup({ rng: E.rngFrom(5) }); const a = s.sock('ann'); const C = 'custom settings, not measured';
    assert.strictEqual(state(s, a).rtp, SRV.RTP_LABEL); assert.ok(/9[0-9]\.[0-9]+%/.test(SRV.RTP_LABEL), 'the shipped label is the measured line'); assert.strictEqual(SRV.liveInfo().warning, null);
    // own numbers with a free-text label: not shown, warned
    let info = SRV.setLiveConfig({ overrides: { buyCost: { bonus1: 800 } } }); assert.strictEqual(state(s, a).rtp, C); assert.strictEqual(SRV.clientCfg().rtp, C); assert.strictEqual(info.rtpLabel, C); assert.strictEqual(info.warning, null, 'no label sent, nothing to warn about');
    info = SRV.setLiveConfig({ overrides: { buyCost: { bonus1: 800 } }, rtpLabel: '94.2% (sim, 10M spins)' }); assert.strictEqual(state(s, a).rtp, C); assert.ok(/rtpLabel not shown/.test(info.warning), info.warning);
    info = SRV.setLiveConfig({ overrides: { buyCost: { bonus1: 800 } }, rtpLabel: 'x'.repeat(500) }); assert.ok(state(s, a).rtp.length <= 160); assert.ok(info.warning);
    // each preset file with its own label: shown, no warning (the three are what the room is allowed to read)
    for (const n of ['rtp94', 'rtp96', 'rtp98']) { const j = preset(n); info = SRV.setLiveConfig(j); assert.strictEqual(state(s, a).rtp, n === 'rtp98' ? SRV.RTP_LABEL : j.rtpLabel, n); assert.strictEqual(info.warning, null, n); assert.strictEqual(info.configHash, j.measuredHash, n + ': the live hash is the measured hash'); }
    // the critic's rows: rtp94 overrides + the rtp98 label, a hand-edited preset with the file's label, payScale 3 + a 94.0% label, no overrides + the rtp94 label
    const j94 = preset('rtp94'), j98 = preset('rtp98');
    info = SRV.setLiveConfig({ overrides: j94.overrides, rtpLabel: j98.rtpLabel }); assert.strictEqual(state(s, a).rtp, C, 'rtp94 numbers + the rtp98 label'); assert.ok(info.warning);
    info = SRV.setLiveConfig({ overrides: { ...j94.overrides, pull: { list: 400 } }, rtpLabel: j94.rtpLabel }); assert.strictEqual(state(s, a).rtp, C, 'a preset edited by hand (list 550 -> 400) with the file label'); assert.ok(info.warning);
    info = SRV.setLiveConfig({ overrides: { payScale: 3 }, rtpLabel: j94.rtpLabel }); assert.strictEqual(state(s, a).rtp, C, 'payScale 3 + the 94.0% label'); assert.ok(info.warning);
    info = SRV.setLiveConfig({ overrides: {}, rtpLabel: j94.rtpLabel }); assert.strictEqual(state(s, a).rtp, SRV.RTP_LABEL, 'the shipped numbers + the rtp94 label read the shipped line'); assert.strictEqual(info.custom, false); assert.ok(/rtpLabel not shown/.test(info.warning));
    info = SRV.setLiveConfig({ overrides: { pull: { list: 450 } } }); assert.strictEqual(state(s, a).rtp, SRV.RTP_LABEL, 'the same numbers as shipped: the shipped label');
    // reset
    SRV.setLiveConfig({ overrides: { buyCost: { bonus1: 800 } }, rtpLabel: 'y' }); resetLive(); assert.strictEqual(SRV.liveInfo().rtpLabel, SRV.RTP_LABEL); assert.strictEqual(SRV.liveInfo().warning, null);
  });

  await test('RTP label (FIX D3): a saved preset re-merged onto CHANGED shipped defaults at boot reads "custom settings, not measured" (the label belongs to the numbers it was measured on); the same file on the same defaults still shows its label', async () => {
    resetLive(); const s = setup({ rng: E.rngFrom(5) }); const a = s.sock('ann'); const j = preset('rtp96');
    SRV.setLiveConfig(j); assert.strictEqual(state(s, a).rtp, j.rtpLabel);
    // boot on the same defaults: the label is back
    assert.strictEqual(L.loadLiveConfig(() => {}), true); assert.strictEqual(SRV.liveInfo().rtpLabel, j.rtpLabel, 'same defaults, same label');
    // a deploy moves one shipped number (here the hunt bell weight's neighbour, a number no preset touches): the file is re-merged onto the new defaults
    const keep = L.DEFAULT.pull.cold.floor; L.DEFAULT.pull.cold.floor = keep + 1;
    try { assert.strictEqual(L.loadLiveConfig(() => {}), true); assert.strictEqual(E.CFG.pull.cold.floor, keep + 1); assert.strictEqual(SRV.liveInfo().rtpLabel, 'custom settings, not measured', 'the saved file keeps its old label but the numbers moved'); assert.notStrictEqual(SRV.liveInfo().configHash, j.measuredHash); assert.ok(/rtpLabel not shown/.test(SRV.liveInfo().warning)); }
    finally { L.DEFAULT.pull.cold.floor = keep; resetLive(); }
    assert.strictEqual(SRV.liveInfo().rtpLabel, SRV.RTP_LABEL);
  });

  // ------------------------------------------------------------------------------------------ item 3: an open round keeps the whole config it started on
  await test('item 3a: a swap while a decision is open (pay table, spins, buy price, pick, more, list, pot all changed): the round pays exactly what the pre-swap config shows; the NEXT spin uses the new config', async () => {
    for (const kind of ['more', 'pick']) {
      resetLive(); const s = setup({ rng: E.rngFrom(kind === 'more' ? 61 : 62), roundRng: E.rngFrom(9) }); const a = s.sock('ann'); rich(s, 'ann');
      SRV.setLiveConfig({ overrides: { payScale: 2, extra: { bonus1: { phone: 6 } }, hunt: { bellMult: 3 }, buyCost: { bonus1: 800 } } });     // the round starts on a NON-default config (A), so the baked tables matter too
      const r = toPending(s, a, kind); const rec = s.open.get(r.roundId); assert.ok(rec);
      const pre = structuredClone(E.CFG); assert.strictEqual(pre.payScale, 2);
      const rem0 = s.potOf('play').rem, fed0 = s.potOf('play').fed, bank0 = r.pending.bankCents;
      SRV.setLiveConfig({ overrides: BIG_SWAP, note: 'mid-round' });
      assert.strictEqual(E.CFG.payScale, 3); assert.strictEqual(E.CFG.pull.list, 60); assert.strictEqual(E.CFG.extra.bonus1.phone, SHIPPED.extra.bonus1.phone); assert.strictEqual(s.open.size, 1, 'the swap did not touch the open round');
      let fin = r;
      while (fin.status === 'pending') fin = decide(s, a, fin, fin.pending.k === 'pick' ? { k: 'pick', p: fin.pending.choices[0] } : { k: 'more', take: false });
      assert.strictEqual(fin.status, 'done'); assert.strictEqual(s.open.size, 0);
      const replay = (cfg) => {
        const eng = E.createEngine(structuredClone(cfg)); let i = 0, j = 0;
        const rng = () => { assert.ok(i < rec.tape.length, 'tape exhausted'); return rec.tape[i++]; }, rnd = () => { assert.ok(j < rec.rtape.length, 'rounding tape exhausted'); return rec.rtape[j++]; };
        return eng.playRound(rng, { buy: rec.buy, bet: rec.bet, state: structuredClone(rec.state), now: rec.now, day: rec.day, script: true, auto: false, rnd }, rec.decisions);
      };
      const want = replay(pre); assert.strictEqual(want.status, 'done');
      assert.strictEqual(fin.totalWin, want.pay.win, kind + ': paid what the config the round started on pays'); assert.strictEqual(fin.cost, r.cost);
      if (kind === 'more') assert.strictEqual(fin.totalWin, bank0, 'banking pays the amount that was shown (whole cents, no pot prize here)');
      let moved; try { const alt = replay(structuredClone(E.CFG)); moved = alt.status !== 'done' || alt.pay.win !== want.pay.win; } catch (e) { moved = true; }
      assert.ok(moved, 'control: the same tape under the NEW config would have paid differently (or not replayed at all)');
      assert.strictEqual(s.potOf('play').fed - fed0, 0, 'a buy feeds the pot nothing, before or after the swap (FIX M1)'); assert.strictEqual(s.potOf('play').rem, rem0);
      assert.strictEqual(rec.timeoutMs, pre.pull.decision.timeoutMs, 'the open round kept its decision timer length');
      const n = spin(s, a, { bet: 100, mode: 'play', buyBonus: 'bonus1', auto: true });
      assert.strictEqual(n.cost, E.buyPrice(700, 100), 'the next spin is charged the new price'); assert.strictEqual(n.script.bonus.startSpins, 5, 'and plays the new spin count');
      const r2 = toPending(s, a, 'more', 'play', 10); assert.strictEqual(r2.timeoutMs, 5000, 'a round started after the swap runs the new decision timer');
    }
  });

  await test('item 3a (default path): the same swap while the owner disconnects: the default settles under the pre-swap config', async () => {
    resetLive(); const s = setup({ rng: E.rngFrom(63), roundRng: E.rngFrom(9) }); const a = s.sock('ann'); rich(s, 'ann');
    const r = toPending(s, a, 'more'); const rec = s.open.get(r.roundId), bank0 = r.pending.bankCents;
    SRV.setLiveConfig({ overrides: BIG_SWAP });
    a.send('disconnect'); const fin = last(a, 'g:coldcall:result');
    assert.strictEqual(fin.status, 'done'); assert.strictEqual(fin.auto, 'disconnect'); assert.strictEqual(fin.totalWin, bank0, 'the safe default banks the amount shown under the old config'); assert.strictEqual(s.open.size, 0);
    assert.ok(rec.settled);
  });

  await test('item 3b: swap, then restart while a decision is open: refunded once, nothing paid under the new config, state untouched, the new config is in force', async () => {
    resetLive(); const logs = [];
    const s = setup({ rng: E.rngFrom(71), roundRng: E.rngFrom(9) }); const a = s.sock('ann'); rich(s, 'ann');
    const r = toPending(s, a, 'more'); const before = s.wallet.get('ann').play + r.cost;       // the balance before the pending spin
    const stored0 = JSON.stringify(s.store().player('ann', 'play')), pot0 = JSON.stringify(s.potOf('play'));
    SRV.setLiveConfig({ overrides: BIG_SWAP }); s.store().flush(); s.wallet.flush && s.wallet.flush();
    freshProcess();                                                                              // a new process: shipped values in memory, the saved file on the volume
    const s2 = setup({ dir: s.dir, bank: s.bank, rng: E.rngFrom(72), t: s.clock.now() + 5000, log: (...x) => logs.push(x.join(' ')) });
    assert.strictEqual(E.CFG.payScale, 3, 'the saved config is loaded at boot'); assert.strictEqual(E.CFG.buyCost.bonus1, 700);
    assert.strictEqual(s2.wallet.get('ann').play, before, 'refunded the cost, nothing else'); assert.strictEqual(s2.open.size, 0); assert.strictEqual(s2.store().allOpen().length, 0);
    assert.strictEqual(JSON.stringify(s2.store().player('ann', 'play')), stored0, 'player state untouched'); assert.strictEqual(JSON.stringify(s2.potOf('play')), pot0, 'pot untouched (no slice, no prize)');
    assert.ok(logs.some((l) => l.includes(r.roundId) && l.includes('restart')), 'the void is logged');
    const s3 = setup({ dir: s.dir, bank: s.bank, rng: E.rngFrom(73), t: s.clock.now() + 9000 }); await sleep(60);
    assert.strictEqual(s3.wallet.get('ann').play, before, 'a second restart refunds nothing more');
    const b = s3.sock('ann'); assert.strictEqual(spin(s3, b, { bet: 100, mode: 'play', buyBonus: 'bonus1', auto: true }).cost, E.buyPrice(700, 100), 'the next spin runs on the new config');
  });

  // ------------------------------------------------------------------------------------------ item 4: every call site reads the live config
  const BETS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2500], BUYS = [null, null, null, 'call', 'bonus1', null, 'hunt', 'bonus2', null, null, 'bonus1'];
  const CLASSES = {
    weights: { weights: [10, 10, 10, 10, 10, 10, 10, 10, 10, 60] }, extra: { extra: { base: { bell: 6, phone: 2 }, bonus1: { phone: 9 } } },
    pay: { pay: { mug: [30, 30, 30, 30, 30, 60, 140, 450, 1300], note: [20, 20, 20, 20, 20, 55, 154, 495, 1430] } }, payScale: { payScale: 3 },
    reveal: { reveal: { base: { gold: 40, silver: 30 }, bonus1: { gold: 40 } }, extra: { base: { phone: 3 } } }, bubbles: { bubbles: { bronze: [[50, 1], [100, 1]] } }, upsell: { upsell: [[10, 1]] },
    adjacency: { adjacency: 8 }, spins: { spins: { bonus1: 3, bonus2: 20 }, retrigger: { two: 3 } }, maxSpins: { maxSpins: 12, retrigger: { two: 6, three: 8, upgrade: 8 } }, maxCascades: { maxCascades: 2 }, maxRevealRounds: { maxRevealRounds: 1 },
    buyCost: { buyCost: { call: 60, bonus1: 500, bonus2: 1500, hunt: 40 } }, hunt: { hunt: { bellMult: 30 } }, maxWin: { maxWinTenths: 60 },
    list: { pull: { list: 3, fill: { dead: 2, win: 2, bonus: 2 } } }, callbackKind: { pull: { list: 3, callback: { kind: 'bonus2' }, fill: { dead: 2, win: 2, bonus: 2 } } },
    carryOver: { pull: { list: 3, carryOver: false, fill: { dead: 2, win: 2, bonus: 2 } } }, daily: { pull: { daily: { base: 20 }, list: 5 } }, pickOff: { pull: { pick: { on: false } } },
    pickMult: { pull: { pick: { mult: { bronze: 0, silver: 9, gold: 20, upsell: 0.1, close: 5 } } } },
  };
  const runRef = (cfg, seed, n) => {
    const eng = E.createEngine(structuredClone(cfg)), rng = E.rngFrom(seed), rnd = E.rngFrom(seed + 1); let st = E.newState(); const out = [];
    for (let i = 0; i < n; i++) {
      const now = 1000000 + 200 * (i + 1), bet = BETS[i % BETS.length], buy = BUYS[i % BUYS.length];
      const r = eng.playRound(rng, { buy, bet, state: st, now, day: dayFmt.format(new Date(now)), script: false, auto: true, rnd }, []);
      if (!buy) st = r.newState; out.push([r.pay.price, r.pay.win, r.callback]);
    }
    return out;
  };
  await test('item 4: every knob class reaches a real round: server rounds after a runtime swap equal a reference engine built from the merged config (and differ from the shipped one)', async () => {
    let idx = 0;
    for (const [name, over] of Object.entries(CLASSES)) {
      resetLive(); const seed = 5000 + 10 * idx++, N = 66;
      const s = setup({ rng: E.rngFrom(seed), roundRng: E.rngFrom(seed + 1) }); const a = s.sock('ann'); rich(s, 'ann');
      SRV.setLiveConfig({ overrides: over });                                       // a runtime swap, no restart
      const merged = need().validate(over).next, want = runRef(merged, seed, N), dflt = runRef(SHIPPED, seed, N);
      const got = [];
      for (let i = 0; i < N; i++) { const r = spin(s, a, { bet: BETS[i % BETS.length], mode: 'play', buyBonus: BUYS[i % BUYS.length], auto: true }); assert.ok(!r.error, name + ': ' + JSON.stringify(r.error)); got.push([r.cost, r.totalWin, r.callback]); }
      assert.deepStrictEqual(got, want, name + ': the server played the live config');
      assert.notDeepStrictEqual(want, dflt, name + ': the knob changes real rounds (control)');
    }
  });
  await test('item 4: pot, feed and decision-timer knobs are read live by settle / spin / pending (runtime swap)', async () => {
    resetLive(); const s = setup({ rng: E.rngFrom(7001), roundRng: E.rngFrom(7002), potRng: E.rngFrom(3) }); const a = s.sock('ann'); rich(s, 'ann');
    SRV.potRng = E.rngFrom(3);
    SRV.setLiveConfig({ overrides: { pull: { pot: { feedBps: 150, oneInPerDollar: 5, minBal: 1, capCents: 8 }, feed: { minWinX: 0, minWinCents: 0 }, decision: { timeoutMs: 7000 } } } });
    let sumCost = 0, wins = 0, prizes = 0;
    for (let i = 0; i < 60; i++) { const r = spin(s, a, { bet: 100, mode: 'play', auto: true }); sumCost += r.cost; if (r.totalWin > 0) wins++; if (r.pot) { prizes++; assert.ok(r.pot.amount <= 8); } }
    const p = s.potOf('play'); assert.strictEqual(p.fed * 10000 + p.rem, sumCost * 150, 'slice at the live 150 bps'); assert.strictEqual(p.fed + p.seeded, p.paid + p.bal); assert.ok(prizes >= 3, 'the live 1-in-5 per dollar pot paid: ' + prizes);
    const feedWins = all(a, 'floor:feed').filter((e) => e.kind === 'win').length; assert.ok(wins > 3 && feedWins >= wins, 'live feed threshold 0: every win is an event ' + feedWins + '/' + wins);
    assert.strictEqual(toPending(s, a, 'more').timeoutMs, 7000);
  });
  await test('item 4: no server call site reads the shipped engine (Eng.playRound / resolveRound / engine / createEngine outside games/coldcall-livecfg.js)', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'games', 'coldcall.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/\/\/.*$/gm, '');
    for (const bad of [/Eng\.playRound\b/, /Eng\.resolveRound\b/, /Eng\.engine\b/, /Eng\.createEngine\b/, /SNAP_KNOBS/, /Eng\.CFG\.pull\s*=[^=]/]) assert.ok(!bad.test(src), 'games/coldcall.js still uses ' + bad);
    assert.ok(/require\('\.\/coldcall-livecfg\.js'\)/.test(src));
  });

  // ------------------------------------------------------------------------------------------ item 5: what the client gets
  await test('item 5: state carries the live pay table, buy prices, PULL rules and the label; a swap broadcasts the same payload (clientCfg / cfgEvent)', async () => {
    resetLive(); const s = setup({ rng: E.rngFrom(8) }); const a = s.sock('ann');
    SRV.setLiveConfig({ overrides: { payScale: 2, buyCost: { call: 50 }, pull: { list: 123, pot: { capCents: 4000 } } }, rtpLabel: '96% (sim)' });
    const st = state(s, a);
    assert.strictEqual(st.rtp, 'custom settings, not measured', 'FIX D3: a free-text label is not shown for numbers no preset was measured on'); assert.strictEqual(st.pull.rules.list, 123); assert.strictEqual(st.pull.rules.pot.capCents, 4000); assert.strictEqual(st.pull.list, 123); assert.deepStrictEqual(st.betLevels, E.BET_LEVELS);
    assert.strictEqual(st.buyPriceCents[100].call, E.buyPrice(50, 100)); assert.strictEqual(st.buyCostX.call, 5);
    assert.strictEqual(st.cfg.payScale, 2); assert.deepStrictEqual(st.cfg.payTenths.mug, SHIPPED.pay.mug.map((v) => Math.max(1, Math.round(v * 2))), 'effective pay table in tenths of the bet');
    assert.ok(!('pull' in st.cfg), 'the pull rules are in pull.rules, not duplicated'); assert.deepStrictEqual(Object.keys(st.cfg.payTenths), E.SYM.slice(0, 10));
    const ev = SRV.cfgEvent(); assert.deepStrictEqual(Object.keys(ev).sort(), ['bets', 'buyPriceCents', 'cfg', 'rtp', 'rules']);
    assert.deepStrictEqual(ev.cfg, st.cfg); assert.deepStrictEqual(ev.rules, st.pull.rules); assert.deepStrictEqual(ev.buyPriceCents, st.buyPriceCents); assert.strictEqual(ev.rtp, st.rtp); assert.deepStrictEqual(ev.bets, E.BET_LEVELS);
    assert.deepStrictEqual(SRV.clientCfg(), ev, 'clientCfg is the event payload'); assert.doesNotThrow(() => JSON.stringify(ev));
    ev.rules.list = 1; assert.strictEqual(E.CFG.pull.list, 123, 'the payload is a copy: editing it moves nothing');
  });

  // ------------------------------------------------------------------------------------------ boot with a damaged file
  await test('a damaged config file at boot: logged once, boots on defaults, never crashes, the file is left for inspection', async () => {
    const logged = []; const errOrig = console.error; console.error = (...x) => logged.push(x.join(' '));
    try {
      for (const body of ['{ not json', '', '[]', 'null', '"x"', JSON.stringify({ overrides: null }), JSON.stringify({ overrides: [] }), JSON.stringify({ overrides: { nope: 1 } }), JSON.stringify({ overrides: { pull: { list: -3 } } }), JSON.stringify({ overrides: { pull: null } }), JSON.stringify({ overrides: { pull: { pot: { seed: 5 } } } }), JSON.stringify({ rtpLabel: 5, overrides: {} })]) {
        resetLive(); fs.writeFileSync(CFG_FILE, body); logged.length = 0;
        let s; assert.doesNotThrow(() => { s = setup({ rng: E.rngFrom(9) }); }, 'init must not throw: ' + body);
        assert.strictEqual(cfgJson(), JSON.stringify(SHIPPED), 'defaults: ' + body); assert.strictEqual(SRV.liveInfo().rtpLabel, SRV.RTP_LABEL);
        assert.ok(logged.filter((l) => /coldcall/.test(l)).length === 1, 'logged once: ' + body + ' -> ' + JSON.stringify(logged)); assert.strictEqual(fs.readFileSync(CFG_FILE, 'utf8'), body, 'the damaged file is kept');
        const a = s.sock('ann'); assert.strictEqual(spin(s, a, { bet: 10, mode: 'play' }).status, 'done', 'and the game plays');
      }
      resetLive(); fs.writeFileSync(CFG_FILE, JSON.stringify({ overrides: { buyCost: { bonus1: 640 } }, rtpLabel: null, note: 'ok', updatedAt: '2026-10-06T00:00:00.000Z' })); logged.length = 0; setup({ rng: E.rngFrom(10) });
      assert.strictEqual(E.CFG.buyCost.bonus1, 640); assert.strictEqual(logged.length, 0, 'a good file logs nothing');
    } finally { console.error = errOrig; }
  });
  await test('a failed write changes nothing (validate, write, then swap)', async () => {
    resetLive(); setup({ rng: E.rngFrom(11) });
    const keep = process.env.COLDCALL_CFG_FILE; process.env.COLDCALL_CFG_FILE = path.join(tmp, 'no-such-dir', 'x', 'c.json');
    try { assert.throws(() => SRV.setLiveConfig({ overrides: { buyCost: { bonus1: 640 } } })); assert.strictEqual(E.CFG.buyCost.bonus1, SHIPPED.buyCost.bonus1, 'memory untouched when the write fails'); assert.deepStrictEqual(SRV.liveInfo().overrides, {}); }
    finally { process.env.COLDCALL_CFG_FILE = keep; }
  });
  await test('a swap takes well under a second (smoke test included, measured)', async () => {
    resetLive(); setup({ rng: E.rngFrom(12) }); let worst = 0;
    for (let i = 0; i < 5; i++) { const t0 = process.hrtime.bigint(); SRV.setLiveConfig({ overrides: { buyCost: { bonus1: 900 + i } } }); worst = Math.max(worst, Number(process.hrtime.bigint() - t0) / 1e6); }
    console.log('     swap time (ms), worst of 5:', worst.toFixed(0)); assert.ok(worst < 1000, 'swap took ' + worst + ' ms');
  });

  // ------------------------------------------------------------------------------------------ item 8: stored player state under a changed config
  await test('item 8a: a smaller list than the stored leads: one Callback arms at the next paid spin, never two, no negative leads, carry intact; every round settles to the cent', async () => {
    resetLive(); const s = setup({ rng: E.rngFrom(81), roundRng: E.rngFrom(82) }); const a = s.sock('ann'); rich(s, 'ann');
    const today = () => dayFmt.format(new Date(s.clock.now())), put = (x) => s.store().setPlayer('ann', 'play', Object.assign(E.newState(), { lt: 3000, avg: 100, rounds: 5, carry: 2.5, day: today(), streak: 1 }, x));
    put({}); SRV.setLiveConfig({ overrides: { pull: { list: 200 } } });
    const v0 = state(s, a).pull.play; assert.strictEqual(v0.leads, 300); assert.strictEqual(v0.list, 200); assert.strictEqual(v0.cb, null, 'nothing arms by itself, only at a paid spin');
    let w = s.wallet.get('ann').play;
    const r1 = play(s, a, { bet: 100, mode: 'play' }); assert.strictEqual(r1.pull.armed, true); assert.ok(r1.pull.state.cb && r1.pull.state.cb.bet >= 1 && r1.pull.state.cb.bet <= 2500);
    w += -r1.cost + r1.totalWin + (r1.pot ? r1.pot.amount : 0); assert.strictEqual(r1.wallet.play, w);
    let st = s.store().player('ann', 'play'); assert.ok(st.lt >= 0 && Number.isFinite(st.lt)); assert.ok(st.lt >= 1000 && st.lt < 1300, 'one list taken off: ' + st.lt); assert.ok(st.carry >= 0 && st.carry < 10); assert.strictEqual(st.carry, 2.5, 'the carry is untouched here (avg 100 + 2.5 plays 100, keeps 2.5)');
    const r2 = play(s, a, { bet: 100, mode: 'play' }); assert.strictEqual(r2.callback, true); assert.strictEqual(r2.cost, 0); assert.strictEqual(r2.wallet.play, w + r2.totalWin + (r2.pot ? r2.pot.amount : 0)); w = r2.wallet.play;
    st = s.store().player('ann', 'play'); assert.strictEqual(st.cb, null); assert.strictEqual(st.callbacks, 1);
    const r3 = play(s, a, { bet: 100, mode: 'play' }); assert.strictEqual(r3.pull.armed, false, '1000 tenths left is under the new list of 2000'); assert.strictEqual(r3.callback, false);
    // a big stock: every list worth of leads becomes one Callback, one at a time
    put({ lt: 9000, cb: null, callbacks: 0, carry: 0 }); let cbs = 0, armed = 0; w = s.wallet.get('ann').play;
    for (let i = 0; i < 14; i++) {
      const r = play(s, a, { bet: 100, mode: 'play' }); if (r.callback) { cbs++; assert.strictEqual(r.cost, 0); } if (r.pull.armed) armed++;
      w += -r.cost + r.totalWin + (r.pot ? r.pot.amount : 0); assert.strictEqual(r.wallet.play, w, 'round ' + i + ' settles to the cent');
      const q = s.store().player('ann', 'play'); assert.ok(q.lt >= 0 && Number.isFinite(q.lt) && q.carry >= 0 && q.carry < 10, 'state sane at round ' + i);
    }
    assert.strictEqual(armed, 4, 'floor(9000 / 2000) lists'); assert.strictEqual(cbs, 4, 'each played once');
    SRV.setLiveConfig({ overrides: { pull: { list: 200, carryOver: false } } }); put({ lt: 9000, cb: null, carry: 0 });
    const r4 = play(s, a, { bet: 100, mode: 'play' }); assert.strictEqual(r4.pull.armed, true); st = s.store().player('ann', 'play'); assert.strictEqual(st.lt, 0, 'carryOver off: the surplus leads are discarded (not money), never negative'); assert.ok(st.cb);
  });

  await test('item 8b: a changed cold clock with a stored coldAt: leads never fall below the new floor, warm squares die, a floor above the stock leaks nothing, the clock restarts from the next paid spin', async () => {
    resetLive(); const s = setup({ rng: E.rngFrom(83), roundRng: E.rngFrom(84) }); const a = s.sock('ann'); rich(s, 'ann');
    const now0 = s.clock.now();
    s.store().setPlayer('ann', 'play', Object.assign(E.newState(), { lt: 5000, avg: 100, coldAt: now0 - 5000, warm: [3, 4], warmBet: 100, rounds: 2 }));
    SRV.setLiveConfig({ overrides: { pull: { cold: { afterMs: 60000, stepMs: 1000, batch: 100, floor: 20 } } } });
    const v = state(s, a).pull.play; assert.strictEqual(v.warm.length, 0, 'the view already shows the warm squares dead'); assert.ok(v.lt >= 200 && v.lt <= 5000);
    const r = play(s, a, { bet: 100, mode: 'play' }); assert.strictEqual(r.pull.warmDied, 2); assert.ok(r.pull.leaked > 0 && r.pull.leaked <= 4800, 'leaked ' + r.pull.leaked);
    let st = s.store().player('ann', 'play'); assert.ok(st.lt >= 200, 'never below the floor (20 leads = 200 tenths): ' + st.lt); assert.ok(Number.isFinite(st.lt));
    assert.ok(st.coldAt >= s.clock.now() + 59000, 'the next cold event is afterMs from this paid spin: ' + (st.coldAt - s.clock.now()));
    s.store().setPlayer('ann', 'play', Object.assign(E.newState(), { lt: 5000, avg: 100, coldAt: s.clock.now() - 5000, warm: [3], warmBet: 100 }));
    SRV.setLiveConfig({ overrides: { pull: { cold: { stepMs: 1000, batch: 100, floor: 600 } } } });
    const r2 = play(s, a, { bet: 100, mode: 'play' }); assert.strictEqual(r2.pull.leaked, 0, 'a floor of 600 leads is above the 500 held: nothing leaks'); assert.strictEqual(r2.pull.warmDied, 1);
    st = s.store().player('ann', 'play'); assert.ok(st.lt >= 5000 && Number.isFinite(st.coldAt) || st.coldAt === null);
  });

  await test('item 8c: damaged stored values (cb.bet, warmBet, lt, carry, ...): the spin plays, never throws, never locks the account, money moves only by cost and win; odd-but-legal values are played as they are', async () => {
    const DAMAGED = [{ cb: { bet: 0 } }, { cb: { bet: 2501 } }, { cb: { bet: 10.5 } }, { cb: { bet: '10' } }, { cb: { bet: -5 } }, { cb: {} }, { cb: 5 }, { warmBet: 7.5 }, { warmBet: '5' }, { warmBet: -1 }, { warm: [99] }, { warm: 'x' }, { lt: -1 }, { lt: 'x' }, { avg: NaN }, { coldAt: 'x' }, { carry: 50 }, { carry: 'x' }, { streak: 1.5 }, { day: 'yesterday' }];
    for (const bad of DAMAGED) {
      resetLive(); const s = setup({ rng: E.rngFrom(85), roundRng: E.rngFrom(86) }); const a = s.sock('ann'); rich(s, 'ann');
      s.store().setPlayer('ann', 'play', Object.assign(E.newState(), { lt: 800, avg: 100 }, bad));
      assert.doesNotThrow(() => state(s, a), JSON.stringify(bad)); const w0 = s.wallet.get('ann').play;
      const r = play(s, a, { bet: 10, mode: 'play' }); assert.ok(!r.error, JSON.stringify(bad) + ' -> ' + JSON.stringify(r.error)); assert.strictEqual(r.status, 'done');
      assert.strictEqual(r.wallet.play, w0 - r.cost + r.totalWin + (r.pot ? r.pot.amount : 0), 'settles to the cent: ' + JSON.stringify(bad));
      const q = s.store().player('ann', 'play'); assert.ok(Number.isFinite(q.lt) && q.lt >= 0 && q.carry >= 0 && q.carry < 10 && (q.cb === null || (Number.isInteger(q.cb.bet) && q.cb.bet >= 1 && q.cb.bet <= 2500)) && Number.isInteger(q.warmBet) && q.warmBet >= 0, 'state repaired: ' + JSON.stringify(bad));
      const r2 = play(s, a, { bet: 10, mode: 'play' }); assert.strictEqual(r2.status, 'done', 'the next spin too');
    }
    resetLive(); const s = setup({ rng: E.rngFrom(87), roundRng: E.rngFrom(88) }); const a = s.sock('ann'); rich(s, 'ann');
    s.store().setPlayer('ann', 'play', Object.assign(E.newState(), { lt: 800, avg: 100, cb: { bet: 15 } }));
    let w = s.wallet.get('ann').play; const r = play(s, a, { bet: 100, mode: 'play' });
    assert.strictEqual(r.callback, true); assert.strictEqual(r.betCents, 15, 'a Callback at a bet that is not a ladder level (any whole cents in [1, 2500]) is played as stored'); assert.strictEqual(r.cost, 0); assert.ok(Number.isInteger(r.totalWin)); assert.strictEqual(r.wallet.play, w + r.totalWin + (r.pot ? r.pot.amount : 0));
    s.store().setPlayer('ann', 'play', Object.assign(E.newState(), { lt: 800, avg: 100, warm: [1, 2], warmBet: 7, coldAt: s.clock.now() + 1e9 }));
    const r2 = play(s, a, { bet: 10, mode: 'play' }); assert.strictEqual(r2.pull.warmDropped, 2, 'a warmBet that is not a ladder level never matches: the squares are dropped, nothing else happens'); assert.strictEqual(r2.status, 'done');
  });

  await test('item 8d: pull.on flipped to false while players hold a Callback and leads: nothing is lost or stranded (stored state kept, plain spins meanwhile, the Callback plays after the flip back); the cold clock keeps running meanwhile', async () => {
    resetLive(); const s = setup({ rng: E.rngFrom(89), roundRng: E.rngFrom(90) }); const a = s.sock('ann'); rich(s, 'ann');
    const base = Object.assign(E.newState(), { lt: 9000, avg: 100, cb: { bet: 100 }, carry: 3, coldAt: s.clock.now() + 1e12, rounds: 4 });
    s.store().setPlayer('ann', 'play', clone(base));
    SRV.setLiveConfig({ overrides: { pull: { on: false } } });
    const st = state(s, a); assert.ok(!('pull' in st) || !st.pull, 'no pull block while it is off'); assert.strictEqual(SRV.clientCfg().rules.on, false);
    let w = s.wallet.get('ann').play;
    for (let i = 0; i < 6; i++) { const r = play(s, a, { bet: 100, mode: 'play' }); assert.ok(!r.error); assert.ok(!r.status, 'the old stateless round'); assert.strictEqual(r.wallet.play, w - r.cost + r.totalWin); w = r.wallet.play; }
    assert.deepStrictEqual(clone(s.store().player('ann', 'play')), clone(base), 'while off: the stored state is not touched');
    SRV.setLiveConfig({ overrides: {} });
    const r = play(s, a, { bet: 100, mode: 'play' }); assert.strictEqual(r.callback, true, 'the Callback is still there'); assert.strictEqual(r.cost, 0); assert.strictEqual(s.store().player('ann', 'play').cb, null);
    assert.strictEqual(s.store().player('ann', 'play').lt, 9000, 'the leads are still there');
    // the cold clock is wall time: after a long pause the leads have leaked toward the floor, the Callback has not
    s.store().setPlayer('ann', 'play', Object.assign(clone(base), { coldAt: s.clock.now() - 3 * 86400000 }));
    SRV.setLiveConfig({ overrides: { pull: { on: false } } }); SRV.setLiveConfig({ overrides: {} });
    const r2 = play(s, a, { bet: 100, mode: 'play' }); assert.strictEqual(r2.callback, true, 'an armed Callback never goes cold'); assert.ok(r2.pull.leaked > 0, 'leads kept leaking while the pull was off: ' + r2.pull.leaked);
  });

  // ------------------------------------------------------------------------------------------ the admin API (real server.js, real http, 127.0.0.1 on an ephemeral port)
  await test('admin API: GET / POST /api/admin/coldcall-config with the same token as Bender (403 without, wrong, or unset); 400 + text on a bad config and nothing changes; ok swaps, saves, broadcasts g:coldcall:cfg, logs the note only; reset restores', async () => {
    resetLive();
    const dir = fs.mkdtempSync(path.join(tmp, 'api')); fs.writeFileSync(path.join(dir, 'bank.json'), '{}'); fs.writeFileSync(path.join(dir, 'ledger.json'), '[]');
    Object.assign(process.env, { BANK_FILE: path.join(dir, 'bank.json'), LEDGER_FILE: path.join(dir, 'ledger.json'), PORT: '0', COLDCALL_PULL_FILE: path.join(dir, 'coldcall-pull.json') });
    const srv = require('../server.js');
    await new Promise((res, rej) => { srv.server.once('error', rej); srv.server.listen(0, '127.0.0.1', res); });   // an ephemeral port: 4640 / 4641 may be busy with somebody's dev server
    const PORT = srv.server.address().port;
    const emitted = []; const ioEmit = srv.io.emit; srv.io.emit = function (ev, ...rest) { emitted.push([ev, ...rest]); return ioEmit.call(this, ev, ...rest); };
    const logs = []; const logOrig = console.log; console.log = (...x) => { logs.push(x.join(' ')); };
    const TOKEN = crypto.randomBytes(18).toString('hex');
    const call = (method, p, headers, body) => new Promise((resolve, reject) => {
      const data = body === undefined ? null : JSON.stringify(body);
      const rq = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: { ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}), ...headers } }, (res) => {
        let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => { let j = null; try { j = JSON.parse(t); } catch {} resolve({ status: res.statusCode, json: j, text: t }); });
      });
      rq.on('error', reject); if (data) rq.write(data); rq.end();
    });
    const P = '/api/admin/coldcall-config', good = { 'x-admin-token': TOKEN };
    try {
      delete process.env.BENDER_ADMIN_TOKEN;
      assert.strictEqual((await call('GET', P, good)).status, 403, 'token unset: disabled even with a header'); assert.strictEqual((await call('POST', P, good, { overrides: {} })).status, 403);
      assert.strictEqual((await call('GET', P, { 'x-admin-token': '' })).status, 403, 'unset + empty header: still disabled');
      process.env.BENDER_ADMIN_TOKEN = TOKEN;
      assert.strictEqual((await call('GET', P, {})).status, 403, 'missing token'); assert.strictEqual((await call('POST', P, {}, { overrides: { buyCost: { bonus1: 640 } } })).status, 403);
      assert.strictEqual((await call('GET', P, { 'x-admin-token': TOKEN + 'x' })).status, 403, 'wrong token (length differs)'); assert.strictEqual((await call('GET', P, { 'x-admin-token': TOKEN.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')) })).status, 403, 'wrong token (same length)');
      assert.strictEqual(cfgJson(), JSON.stringify(SHIPPED), 'refused calls changed nothing'); assert.ok(!fs.existsSync(CFG_FILE));
      // FIX D5a: a header of the right LENGTH (in characters) with one byte above 0x7F used to reach timingSafeEqual with buffers of different byte lengths and throw: a 500 with a stack for an unauthenticated caller. Now 403, on both games' routes.
      for (const route of [P, '/api/admin/bender-config']) for (const m of ['GET']) { const r = await call(m, route, { 'x-admin-token': TOKEN.slice(0, -1) + '\u00e9' }); assert.strictEqual(r.status, 403, route + ' non-ASCII token of the same length: ' + r.status + ' ' + r.text.slice(0, 80)); assert.ok(!/RangeError|at /.test(r.text), 'no stack in the reply'); }
      assert.strictEqual((await call('GET', P, { 'x-admin-token': '\u00e9'.repeat(TOKEN.length) })).status, 403); assert.strictEqual((await call('GET', P, good)).status, 200, 'the real token still works');
      const g = await call('GET', P, good); assert.strictEqual(g.status, 200); assert.strictEqual(g.json.cfg.buyCost.bonus1, SHIPPED.buyCost.bonus1); assert.deepStrictEqual(g.json.overrides, {}); assert.strictEqual(g.json.rtpLabel, SRV.RTP_LABEL); assert.ok(g.json.defaults && g.json.defaults.pull.pot.seed === 0);
      assert.ok(!JSON.stringify(g.json).includes(TOKEN), 'the token is never echoed');
      const n0 = emitted.length;
      const bad = await call('POST', P, good, { overrides: { pull: { pot: { seed: 100 } } }, note: 'bad' }); assert.strictEqual(bad.status, 400); assert.strictEqual(bad.json.ok, false); assert.ok(/seed/.test(bad.json.error), bad.text);
      assert.strictEqual((await call('POST', P, good, { overrides: { nope: 1 } })).status, 400); assert.strictEqual((await call('POST', P, good, {})).status, 400, 'no overrides and no reset: refused (an empty body must not reset)'); assert.strictEqual((await call('POST', P, good, { overrides: null })).status, 400); assert.strictEqual((await call('POST', P, good, [1])).status, 400);
      assert.strictEqual(emitted.length, n0, 'no event on a bad config'); assert.strictEqual(cfgJson(), JSON.stringify(SHIPPED)); assert.ok(!fs.existsSync(CFG_FILE));
      const ok = await call('POST', P, good, { overrides: { buyCost: { bonus1: 640 }, pull: { list: 321 } }, rtpLabel: '95.5% (test)', note: 'api-note-1' });
      assert.strictEqual(ok.status, 200, ok.text); assert.strictEqual(ok.json.ok, true); assert.strictEqual(ok.json.cfg.buyCost.bonus1, 640); assert.strictEqual(ok.json.rtpLabel, 'custom settings, not measured'); assert.ok(/rtpLabel not shown/.test(ok.json.warning), 'FIX D3: the reply says the label was not honoured: ' + ok.json.warning); assert.strictEqual(ok.json.note, 'api-note-1');
      assert.strictEqual(E.CFG.buyCost.bonus1, 640); assert.strictEqual(JSON.parse(fs.readFileSync(CFG_FILE, 'utf8')).overrides.pull.list, 321);
      const ev = emitted.filter((e) => e[0] === 'g:coldcall:cfg'); assert.strictEqual(ev.length, 1, 'one broadcast'); const p = ev[0][1];
      assert.strictEqual(p.cfg.buyCost.bonus1, 640); assert.strictEqual(p.rules.list, 321); assert.strictEqual(p.rtp, 'custom settings, not measured'); assert.strictEqual(p.buyPriceCents[100].bonus1, 6400); assert.deepStrictEqual(p.bets, E.BET_LEVELS);
      assert.ok(logs.some((l) => l.includes('api-note-1') && /coldcall/.test(l)), 'a console line with the note'); assert.ok(!logs.some((l) => l.includes(TOKEN)), 'the token is never logged');
      const g2 = await call('GET', P, good); assert.strictEqual(g2.json.overrides.pull.list, 321);
      const rs = await call('POST', P, good, { reset: true }); assert.strictEqual(rs.status, 200); assert.strictEqual(cfgJson(), JSON.stringify(SHIPPED)); assert.strictEqual(rs.json.rtpLabel, SRV.RTP_LABEL);
      assert.strictEqual(emitted.filter((e) => e[0] === 'g:coldcall:cfg').length, 2, 'the reset is broadcast too'); assert.ok(emitted.filter((e) => e[0] === 'g:coldcall:cfg')[1][1].rules.list === SHIPPED.pull.list);
      assert.strictEqual((await call('GET', '/api/admin/bender-config', good)).status, 200, 'the Bender route is untouched'); assert.strictEqual((await call('GET', '/api/admin/bender-config', {})).status, 403);
      // FIX D5c: only reset === true resets; "false" / 1 / "yes" are not a reset (they used to wipe the overrides sent with them)
      const nr = await call('POST', P, good, { reset: 'false', overrides: { payScale: 2 }, note: 'not a reset' }); assert.strictEqual(nr.status, 200, nr.text); assert.strictEqual(E.CFG.payScale, 2, 'reset:"false" applied the overrides instead of resetting'); assert.strictEqual(nr.json.overrides.payScale, 2);
      assert.strictEqual((await call('POST', P, good, { reset: 1 })).status, 400, 'reset: 1 with no overrides is neither a reset nor a config'); assert.strictEqual((await call('POST', P, good, { reset: 'true' })).status, 400); assert.strictEqual(E.CFG.payScale, 2, 'nothing changed');
      const rt = await call('POST', P, good, { reset: true, overrides: { payScale: 3 } }); assert.strictEqual(rt.status, 200); assert.strictEqual(E.CFG.payScale, SHIPPED.payScale, 'reset:true resets (the overrides sent with it are dropped, as before)');
      const lab = await call('POST', P, good, preset('rtp96')); assert.strictEqual(lab.status, 200, lab.text); assert.strictEqual(lab.json.warning, null); assert.strictEqual(lab.json.rtpLabel, preset('rtp96').rtpLabel, 'a preset file POSTed as it is keeps its label'); assert.ok(typeof lab.json.configHash === 'string');
      await call('POST', P, good, { reset: true });
    } finally {
      console.log = logOrig; srv.io.emit = ioEmit; delete process.env.BENDER_ADMIN_TOKEN; await new Promise((r) => srv.server.close(r));
    }
  });

  console.log(pass + ' passed' + (process.exitCode ? ', with failures' : ''));
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(process.exitCode || 0);
})();
