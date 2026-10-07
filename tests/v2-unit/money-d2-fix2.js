'use strict';
// D2 fix round 2 (critic round 2, E8-E13): one top-up time per LEG, a leg without a reason never stops createService, nightSummary does not
// depend on when it was first asked, the rules fingerprint covers the live SOURCE_ACCOUNTS, window 1 costs no cold scan, sidecar shape
// (a line after the end line, header counts, a full balance block). Every open pins window, ckpt, ckptEvery, ckptVerify.
const L = require('./money-d2-lib');
const { New, Ref, eq, deq, ok, fs, path } = L;
const { createService } = require('../../money/service');
const run = L.makeRunner('money-d2-fix2');
const t = run.t;
const root = L.mkdir('money-d2-fix2-');
let n = 0;
let clock = 1e12;
const now = () => clock;
const file = () => path.join(root, 'f' + (++n) + '.jsonl');
const PIN = { now, fsync: 'none', window: 5, ckpt: true, ckptEvery: 0, ckptVerify: false };
const OPEN = (f, o = {}, mod = New) => { const log = L.logger(); const led = mod.open(f, { ...PIN, log, ...o }); led.logs = log.lines; return led; };
const REFOPEN = (f) => Ref.open(f, { now, fsync: 'none', log: () => {} });
const snap = (led) => JSON.stringify({ c: led.list('', 'chips'), p: led.list('', 'play'), k: led.check(), id: led.lastId, q: led.quarantined, e: [...led.entries()] });
const fullOf = (f) => { const g = file(); fs.copyFileSync(f, g); const r = REFOPEN(g); const s = snap(r); r.close(); return s; };
const ignored = (l) => l.logs.filter(m => /^checkpoint ignored/.test(m));

// ---- E8: the top-up time is kept per leg (N14) ----
t('E8 a line with `topup` legs to two players sets both cooldowns: topUp(a) inside the cooldown is refused', () => {
  clock = 1e12; const l = OPEN(file()), s = createService(l, { now });
  l.batch([{ from: 'mint:topup', to: 'play:a', amount: 5, cur: 'play' }, { from: 'mint:topup', to: 'play:b', amount: 5, cur: 'play' }], 'tb1', 'topup');
  clock += 60000;
  for (const k of ['a', 'b']) { const e = s.topUpEligible(k); eq(e.eligible, false, k); eq(e.why, 'cooldown', k); }
  try { s.topUp('a', 'tu-a'); ok(false, 'minted inside the cooldown'); } catch (e) { eq(e.code, 'cooldown'); }
  l.close();
});

fs.rmSync(root, { recursive: true, force: true });
run.done();
