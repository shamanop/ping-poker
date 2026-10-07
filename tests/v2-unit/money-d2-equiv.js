'use strict';
// D2 equivalence proof: the D2 ledger (memory window + checkpoint) against the frozen pre-D2 ledger (fixtures/ledger-pre-d2.js).
// Seeded random sequences go to BOTH; after every step and every reopen everything observable is compared, and the two
// journal files must stay byte for byte equal. Env: D2_SEEDS (default 300), D2_SEED_START (1), D2_STEPS (50).
const L = require('./money-d2-lib');
const { New, Ref, mulberry32, eq, deq, ok, fs, path } = L;
const run = L.makeRunner('money-d2-equiv');

const SEEDS = Number(process.env.D2_SEEDS) || 300;
const START = Number(process.env.D2_SEED_START) || 1;
const STEPS = Number(process.env.D2_STEPS) || 50;
const root = L.mkdir('money-d2-equiv-');

const PLAYER = { chips: ['bank:a', 'bank:b', 'bank:c', 'seat:T:a', 'seat:T:b', 'pot:T:x', 'orphan:zed', 'escrow:g:a:r1', 'pool:g:p'], play: ['play:a', 'play:b', 'seat:T:a', 'seat:T:b', 'pot:T:x', 'escrow:g:a:r1', 'pool:g:p'] };
const SOURCE = { chips: ['mint:signup', 'house:bender', 'fx:chips', 'admin:adjust'], play: ['mint:topup', 'house:bender', 'fx:play', 'mint:bonus'] };
const BAD_ACCT = ['nope:x', 'bank:', 'seat:t', 5, null];
const ALL_ACCTS = [...new Set([...PLAYER.chips, ...PLAYER.play, ...SOURCE.chips, ...SOURCE.play])];
const REASONS = ['x', 'buyin:chips', 'buyin:play', 'cashout:chips', 'bender:spend', 'hand', 'boot:recover'];
const WINDOWS = [0, 1, 2, 7, 50];
const EVERY = [0, 1, 5];

const norm = (fn) => { try { return { r: fn() }; } catch (e) { return { err: e && e.code ? e.code : String(e), d: e && e.details ? e.details : null }; } };
const jd = (x) => JSON.stringify(x);

function runSeed(seed) {
  const rng = mulberry32(seed * 7919 + 13);
  const dir = path.join(root, 's' + seed); fs.mkdirSync(dir);
  const fr = path.join(dir, 'ref.jsonl'), fn = path.join(dir, 'new.jsonl');
  const window = rng.pick(WINDOWS), every = rng.pick(EVERY), verify = rng.chance(0.3);
  const nlog = L.logger();
  const now = () => 1000;
  const optsN = { now, fsync: 'none', log: nlog, window, ckpt: true, ckptEvery: every, ckptVerify: verify };
  let R = Ref.open(fr, { now, fsync: 'none', log: () => {} }), N = New.open(fn, optsN);
  const tried = new Set();
  const history = [];                     // calls made so far (for dup / conflict re-issues)
  let refNo = 0, usedCkpt = 0;

  const pickAcct = (cur, side) => {
    if (rng.chance(0.03)) return rng.pick(BAD_ACCT);
    if (side === 'from' && rng.chance(0.4)) return rng.pick(SOURCE[cur]);
    return rng.chance(0.15) ? rng.pick(SOURCE[cur]) : rng.pick(PLAYER[cur]);
  };
  const item = () => {
    const cur = rng.chance(0.03) ? 'gold' : rng.pick(['chips', 'play']);
    const c = SOURCE[cur] ? cur : 'chips';
    const amount = rng.chance(0.04) ? rng.pick([0, -1, 1.5, '5', 2 ** 53 - 1, NaN]) : (rng.chance(0.2) ? rng.range(50, 400) : rng.range(1, 40));
    return { from: pickAcct(c, 'from'), to: pickAcct(c, 'to'), amount, cur, reason: rng.chance(0.03) ? '' : rng.pick(REASONS) };
  };
  const mkCall = () => {
    if (history.length && rng.chance(0.25)) {                         // re-issue: same args (dup) or changed args (ref_conflict)
      const h = rng.pick(history);
      if (rng.chance(0.5)) return h;
      if (h.kind === 'transfer') return { ...h, args: { ...h.args, amount: h.args.amount + 1 } };
      return { ...h, args: { ...h.args, reason: (h.args.reason || '') + 'z' } };
    }
    const ref = rng.chance(0.02) ? rng.pick(['', null, 7]) : 'r' + (refNo++);
    if (rng.chance(0.4)) {
      const items = []; for (let i = rng.range(1, 3); i > 0; i--) items.push(item());
      if (rng.chance(0.2) && items.length > 1) { items[0].to = 'pot:T:x'; items[1] = { ...items[1], from: 'pot:T:x' }; }
      return { kind: 'batch', args: { items, ref, reason: rng.chance(0.7) ? rng.pick(REASONS) : undefined } };
    }
    return { kind: 'transfer', args: { ...item(), ref } };
  };
  const exec = (led, c) => (c.kind === 'transfer'
    ? led.transfer(c.args.from, c.args.to, c.args.amount, c.args.cur, c.args.reason, c.args.ref)
    : led.batch(c.args.items, c.args.ref, c.args.reason));

  const filters = () => {
    const someRef = tried.size ? rng.pick([...tried]) : 'r0';
    return rng.pick([
      null, e => e.cur === 'chips', e => e.amount > 20, e => String(e.reason).startsWith('b'), e => String(e.from).startsWith('bank:'),
      e => e.id % 3 === 0, e => e.batchRef !== null, e => e.ref === someRef, e => e.to === 'seat:T:a' && String(e.reason).startsWith('buyin:'), e => false,
    ]);
  };

  function compare(tag) {
    const at = `seed ${seed} (window ${window}, every ${every}, verify ${verify}) ${tag}`;
    for (const a of ALL_ACCTS) for (const cur of ['chips', 'play']) eq(N.balance(a, cur), R.balance(a, cur), at + ` balance ${a} ${cur}`);
    for (const cur of ['chips', 'play']) { deq(N.list('', cur), R.list('', cur), at + ' list'); deq(N.list('seat:', cur), R.list('seat:', cur), at + ' list seat'); }
    for (const r of tried) eq(N.has(r), R.has(r), at + ` has ${r}`);
    deq(N.check(), R.check(), at + ' check');
    eq(N.lastId, R.lastId, at + ' lastId'); eq(N.size, R.size, at + ' size');
    deq(N.quarantined, R.quarantined, at + ' quarantined');
    deq([...N.entries()], [...R.entries()], at + ' entries()');
    for (let i = 0; i < 3; i++) {
      const f = filters(), after = rng.chance(0.4) ? 0 : rng.int(R.lastId + 3);
      deq([...N.entries(f, after)], [...R.entries(f, after)], at + ` entries(f, ${after})`);
    }
    const refList = [...tried, 'nope', 'r999'];
    for (let i = 0; i < 6 && refList.length; i++) {
      const r = rng.pick(refList);
      deq(N.entriesOf(r), [...R.entries(e => e.ref === r)], at + ` entriesOf ${r}`);
    }
    for (let i = 0; i < 3; i++) {
      const f = filters();
      let want = null; for (const e of R.entries(f)) want = e;
      deq(N.findLast(f), want, at + ' findLast');
    }
    ok(fs.readFileSync(fr).equals(fs.readFileSync(fn)), at + ' journals differ byte for byte');
    const q = (f) => { try { return fs.readFileSync(f + '.quarantine', 'utf8'); } catch { return null; } };
    eq(q(fn), q(fr), at + ' quarantine file');
    const st = N.stats();
    eq(st.lines, new Set([...R.entries()].map(e => e.id)).size, at + ' stats lines (applied lines of the frozen ledger)');
    const eff = window === 1 ? 2 : window;           // fix2 E12: a window of 1 is raised to 2
    ok(window === 0 || st.inMemory <= 2 * eff, at + ` inMemory ${st.inMemory} > 2x${eff}`);
    ok(window === 0 || st.inMemory >= Math.min(eff, st.lines), at + ` inMemory ${st.inMemory} < window`);
  }

  const tail = (f, n = 1) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).slice(-n).join('\n');
  const mutations = () => {
    const lid = R.lastId, any = tried.size ? rng.pick([...tried]) : 'r0';
    return [
      () => 'garbage, not json\n',
      () => tail(fr) + '\n',
      () => JSON.stringify({ id: lid + 1 + rng.int(4), ts: 1000, from: 'mint:signup', to: 'bank:a', amount: 7, cur: 'chips', reason: 'hand', ref: 'hx' + refNo++ }) + '\n',
      () => JSON.stringify({ id: lid + 1, ts: 1000, from: 'bank:b', to: 'bank:c', amount: 1e9, cur: 'chips', reason: 'hand', ref: 'hx' + refNo++ }) + '\n',
      () => JSON.stringify({ id: lid + 1, ts: 1000, from: 'mint:signup', to: 'bank:a', amount: 3, cur: 'chips', reason: 'hand', ref: any }) + '\n',
      () => '\n', () => '   \n', () => '[1,2]\n', () => '{"id":' + (lid + 1) + ',"ts":1000,"from":"mint',
      () => JSON.stringify({ id: lid + 1, ts: 1000, from: 'mint:signup', to: 'bank:a', amount: 2, cur: 'chips', reason: 'hand', ref: 'hy' + refNo++ }) + '\n{"id":',
      () => JSON.stringify({ id: lid + 2, ts: 1000, batch: [{ from: 'mint:signup', to: 'bank:a', amount: 2, cur: 'chips' }], reason: 'dflt', ref: 'hb' + refNo++ }) + '\n',
    ];
  };

  const addStats = () => { const st = N.stats(); tot.cold += st.coldScans; tot.lookups += st.coldLookups; tot.applied += st.lines; tot.quarantined += N.quarantined.length; };
  function reopen() {
    addStats();
    R.close(); N.close();
    if (rng.chance(0.55)) {
      const ms = mutations();
      for (let k = rng.range(1, 2); k > 0; k--) {
        const s = rng.pick(ms)();
        fs.appendFileSync(fr, s); fs.appendFileSync(fn, s);
        const m = s.match(/"ref":"([^"]+)"/); if (m) tried.add(m[1]);
      }
    }
    R = Ref.open(fr, { now, fsync: 'none', log: () => {} }); N = New.open(fn, optsN);
    if (N.stats().ckpt.used) usedCkpt++;
  }

  compare('start');
  const steps = STEPS + rng.int(STEPS);
  for (let s = 0; s < steps; s++) {
    const x = rng();
    if (x < 0.07) { reopen(); compare(`step ${s} reopen`); continue; }
    if (x < 0.13) { const c = N.checkpoint(); ok(c.ok, `seed ${seed} checkpoint failed ${jd(c)}`); compare(`step ${s} checkpoint`); continue; }
    const call = mkCall();
    if (call.args.ref != null) tried.add(call.args.ref);
    if (call.kind === 'transfer' || call.kind === 'batch') history.push(call);
    const a = norm(() => exec(R, call)), b = norm(() => exec(N, call));
    deq(b, a, `seed ${seed} step ${s} ${call.kind} result`);
    if (a.r && a.r.dup) tot.dups++; else if (a.err === 'ref_conflict') tot.conflicts++; else if (a.err === 'insufficient') tot.insufficient++;
    compare(`step ${s} ${call.kind}`);
  }
  reopen(); compare('final reopen');
  reopen(); compare('final reopen 2');
  const bad = nlog.lines.filter(l => /checkpoint ignored|CHECKPOINT MISMATCH/.test(l));
  deq(bad, [], `seed ${seed}: the checkpoint was ignored or mismatched in a plain run`);
  addStats();
  R.close(); N.close();
  fs.rmSync(dir, { recursive: true, force: true });
  return usedCkpt;
}

let used = 0, ran = 0;
const tot = { cold: 0, lookups: 0, applied: 0, quarantined: 0, dups: 0, conflicts: 0, insufficient: 0 };
for (let seed = START; seed < START + SEEDS; seed++) run.t('equivalence seed ' + seed, () => { used += runSeed(seed); ran++; });
run.t('the checkpoint path was really exercised (reopens that used a checkpoint)', () => ok(used >= Math.min(SEEDS, 30), 'only ' + used + ' reopens used a checkpoint'));
console.log('coverage: ' + JSON.stringify(tot));
run.t('cold paths, dups, conflicts, insufficient and quarantine were all hit', () => ok(tot.cold > 100 && tot.lookups > 100 && tot.dups > 50 && tot.conflicts > 20 && tot.insufficient > 20 && tot.quarantined > 20, JSON.stringify(tot)));
fs.rmSync(root, { recursive: true, force: true });
run.done();
