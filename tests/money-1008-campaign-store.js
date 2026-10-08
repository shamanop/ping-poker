'use strict';
// Money 1008 K2-3c / K5-1: the Campaign file (games/campaign-store.js) is treated like a ledger. A file that cannot be used is never read as "no open runs" without a word and never overwritten:
// kept as <file>.damaged-<stamp>, one loud line, restored from <file>.bak when that is good; bytes that cannot be kept = the store is BLOCKED. Plain node, exit 0 on pass, 1 on fail.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { createStore } = require('../games/campaign-store.js');
const H = require('./lib-campaign-ledger.js');
const { E } = H;

const eq = assert.strictEqual, deq = assert.deepStrictEqual, ok = assert.ok;
let pass = 0, fail = 0;
const todo = [];
const t = (name, fn) => todo.push([name, fn]);
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'cmp-store-'));
let n = 0;
const dirOf = () => fs.mkdtempSync(path.join(tmp, 'd' + (++n) + '-'));
const rec = (key, extra) => ({ roundId: 'r' + key, key, cur: 'play', bet: 500, run: { v: 1 }, startedAt: 1, lastAt: 1, ...(extra || {}) });
const mk = (file) => { const lines = []; const s = createStore(file, { log: (...a) => lines.push(a.join(' ')), alarm: (...a) => lines.push(a.join(' ')) }); return { s, lines }; };
const damaged = (file) => fs.readdirSync(path.dirname(file)).filter((f) => f.startsWith(path.basename(file) + '.damaged-')).map((f) => path.join(path.dirname(file), f));
const writeTwo = (file) => { const { s } = mk(file); s.putOpen(rec('ann')); s.flush(); s.putOpen(rec('bob')); s.flush(); s.close(true); };
const keys = (s) => s.allOpen().map((r) => r.key).sort().join(',');

t('S1: a fresh data dir starts quietly; every write leaves main and .bak holding the same bytes', () => {
  const f = path.join(dirOf(), 'campaign.json'); const { s, lines } = mk(f); eq(lines.length, 0); eq(s.allOpen().length, 0);
  s.putOpen(rec('ann')); s.flush(); ok(fs.existsSync(f) && fs.existsSync(f + '.bak')); eq(fs.readFileSync(f, 'utf8'), fs.readFileSync(f + '.bak', 'utf8'));
  s.putOpen(rec('bob')); s.flush(); eq(fs.readFileSync(f, 'utf8'), fs.readFileSync(f + '.bak', 'utf8')); ok(fs.statSync(f).ino !== fs.statSync(f + '.bak').ino, 'the backup is its own file');
  eq(fs.readdirSync(path.dirname(f)).filter((x) => x.endsWith('.tmp')).length, 0, 'no temp file left'); s.close(true);
  const r = mk(f); eq(r.lines.length, 0, 'a good file is read quietly'); eq(keys(r.s), 'ann,bob'); r.s.close(true);
});

t('S2: a torn main with a good .bak: restored, ONE loud line, the damaged bytes kept, the next boot is quiet', () => {
  const f = path.join(dirOf(), 'campaign.json'); writeTwo(f); const good = fs.readFileSync(f, 'utf8'); const cut = good.slice(0, Math.floor(good.length / 2)); fs.writeFileSync(f, cut);
  const { s, lines } = mk(f); eq(keys(s), 'ann,bob', 'both runs are back'); eq(lines.length, 1, lines.join(' | ')); ok(/cannot be used/.test(lines[0]) && /Restored the Campaign state/.test(lines[0]) && lines[0].includes('.damaged-'));
  const d = damaged(f); eq(d.length, 1); eq(fs.readFileSync(d[0], 'utf8'), cut, 'the damaged bytes are kept as they were'); eq(fs.readFileSync(f, 'utf8'), good, 'main is the good version again'); s.close(true);
  const r = mk(f); eq(r.lines.length, 0); eq(keys(r.s), 'ann,bob'); r.s.close(true);
});

t('S3: a torn main with no .bak: loud, kept, never overwritten blindly; the line says the state is empty', () => {
  const f = path.join(dirOf(), 'campaign.json'); fs.writeFileSync(f, '{"v":1,"open":{"ann":{"roundId"');
  const { s, lines } = mk(f); eq(lines.length, 1); ok(/EMPTY Campaign state/.test(lines[0]) && /no backup/.test(lines[0]) && lines[0].includes('.damaged-')); eq(s.allOpen().length, 0); ok(s.lost());
  eq(damaged(f).length, 1); eq(fs.readFileSync(damaged(f)[0], 'utf8'), '{"v":1,"open":{"ann":{"roundId"'); ok(!fs.existsSync(f), 'the damaged file is moved away, nothing is written over it'); s.close(true);
});

t('S4: an empty file, a file cut at many points, and valid JSON that is not a state file are all damage', () => {
  const f0 = path.join(dirOf(), 'campaign.json'); writeTwo(f0); const good = fs.readFileSync(f0, 'utf8');
  const cases = ['', '   \n', 'null', '[]', '"x"', '12', '{}', '{"v":1}', '{"v":1,"open":[]}', '{"v":1,"open":"a"}', '{"open":null}'];
  for (let c = 1; c < 12; c++) cases.push(good.slice(0, Math.floor(good.length * c / 12)));
  for (const bad of cases) {
    const f = path.join(dirOf(), 'campaign.json'); fs.writeFileSync(f, bad);
    const { s, lines } = mk(f); eq(lines.length, 1, JSON.stringify(bad.slice(0, 40)) + ' -> ' + lines.join(' | ')); eq(damaged(f).length, 1, 'kept'); eq(fs.readFileSync(damaged(f)[0], 'utf8'), bad); eq(s.allOpen().length, 0); s.close(true);
  }
});

t('S5: main missing next to a good .bak: restored loudly; main missing with no .bak is a quiet fresh dir', () => {
  const f = path.join(dirOf(), 'campaign.json'); writeTwo(f); fs.rmSync(f);
  const { s, lines } = mk(f); eq(keys(s), 'ann,bob'); eq(lines.length, 1); ok(/is missing/.test(lines[0]) && /Restored/.test(lines[0])); ok(fs.existsSync(f), 'main written again'); s.close(true);
  const g = path.join(dirOf(), 'campaign.json'); const q = mk(g); eq(q.lines.length, 0); q.s.close(true);
});

t('S6: main and .bak both damaged: both are kept, ONE loud line names both, the state is empty', () => {
  const f = path.join(dirOf(), 'campaign.json'); fs.writeFileSync(f, '{"v":1,"op'); fs.writeFileSync(f + '.bak', '');
  const { s, lines } = mk(f); eq(lines.length, 1); ok(/EMPTY/.test(lines[0]) && /could not be used either/.test(lines[0])); eq(damaged(f).length, 1); eq(damaged(f + '.bak').length, 1); eq(s.allOpen().length, 0); s.close(true);
});

t('S7: the damaged bytes cannot be kept: the store is BLOCKED, loads nothing, every write throws, the file is never touched', () => {
  const f = path.join(dirOf(), 'campaign.json'); fs.writeFileSync(f, '{"v":1,"open":{"ann":{"roundId"');
  const rn = fs.renameSync, cp = fs.copyFileSync;
  fs.renameSync = (a, b) => { if (String(b).includes('.damaged-')) throw new Error('EACCES'); return rn(a, b); };
  fs.copyFileSync = (a, b, c) => { if (String(b).includes('.damaged-')) throw new Error('EACCES'); return cp(a, b, c); };
  try {
    const { s, lines } = mk(f); eq(lines.length, 1); ok(/BLOCKED/.test(lines[0])); ok(s.blocked()); eq(s.allOpen().length, 0);
    assert.throws(() => s.putOpen(rec('ann')), /blocked/); s.delOpen('ann'); assert.throws(() => s.flush(), /blocked/); s.close(true);
    eq(fs.readFileSync(f, 'utf8'), '{"v":1,"open":{"ann":{"roundId"', 'untouched'); eq(damaged(f).length, 0);
  } finally { fs.renameSync = rn; fs.copyFileSync = cp; }
});

t('S8: one run that is not an object is dropped with a line that names it; the others are kept', () => {
  const f = path.join(dirOf(), 'campaign.json'); fs.writeFileSync(f, JSON.stringify({ v: 1, open: { ann: rec('ann'), bob: 'x', cy: [1] } }));
  const { s, lines } = mk(f); eq(keys(s), 'ann'); eq(lines.length, 2); ok(lines.some((l) => l.includes('"bob"')) && lines.some((l) => l.includes('"cy"'))); eq(damaged(f).length, 0); s.close(true);
});

t('S9: a failed rename keeps the old file and the write throws (and retries later); a failed backup does not stop the main write', () => {
  const f = path.join(dirOf(), 'campaign.json'); const { s } = mk(f); s.putOpen(rec('ann')); s.flush(); const before = fs.readFileSync(f, 'utf8');
  const rn = fs.renameSync; fs.renameSync = (a, b) => { if (String(b) === f) throw new Error('EIO'); return rn(a, b); };
  try { s.putOpen(rec('bob')); assert.throws(() => s.flush(), /EIO/); eq(fs.readFileSync(f, 'utf8'), before, 'the old file is whole'); eq(fs.existsSync(f + '.tmp'), false); } finally { fs.renameSync = rn; }
  s.flush(); const r = JSON.parse(fs.readFileSync(f, 'utf8')); ok(r.open.bob, 'the retry wrote it'); s.close(true);
  const g = path.join(dirOf(), 'campaign.json'); const q = mk(g); fs.renameSync = (a, b) => { if (String(b).endsWith('.bak')) throw new Error('EIO'); return rn(a, b); };
  try { q.s.putOpen(rec('ann')); q.s.flush(); } finally { fs.renameSync = rn; } ok(JSON.parse(fs.readFileSync(g, 'utf8')).open.ann, 'main written without a backup'); q.s.close(true);
});

t('S10: kill -9 (a real child process) at each step of a write leaves a whole file: the old one or the new one', () => {
  for (const at of ['tmp-written', 'backup-kept', 'renamed']) {
    const f = path.join(dirOf(), 'campaign.json'); { const { s } = mk(f); s.putOpen(rec('ann')); s.flush(); s.close(true); }
    const code = `const {createStore}=require(${JSON.stringify(path.join(__dirname, '..', 'games', 'campaign-store.js'))});let on=false;const s=createStore(${JSON.stringify(f)},{log(){},alarm(){},step(x){if(on&&x===${JSON.stringify(at)})process.kill(process.pid,'SIGKILL');}});on=true;s.putOpen(${JSON.stringify(rec('bob'))});s.flush();`;
    const r = spawnSync(process.execPath, ['-e', code]); eq(r.signal, 'SIGKILL', at);
    const { s, lines } = mk(f); eq(lines.length, 0, at + ': ' + lines.join('|')); ok(['ann', 'ann,bob'].includes(keys(s)), at + ' -> ' + keys(s)); s.close(true);
  }
});

// ---- game level: the real ledger, the real recover()
const BIG = 3e9;
function world(opts = {}) { process.env.CAMPAIGN_TEST = '1'; const w = H.world({ rng: () => w.R(), keys: ['ann', 'bob'], ...opts }); w.R = () => 0.999999; for (const k of ['ann', 'bob']) w.fund(k, 'play', BIG); return w; }
const climb = (w, s, bet, n) => { let run = H.start(w, s, 'play', bet, 'OH').payload.run; for (let i = 0; i < n; i++) run = H.call(w, s, 'step', { roundId: run.roundId, n: run.steps + 1, to: run.options.find((o) => !o.deadEnd).to }).payload.run; return run; };
const refuseSettle = () => { throw Object.assign(new Error('ledger busy'), { code: 'internal' }); };

t('G1: a torn campaign.json: the open run is paid at its stored multiplier, a pended scandal stays lost, one loud line, the bytes are kept', () => {
  const logs = []; const w = world({ log: (...a) => logs.push(a.join(' ')) }); const sa = w.sock('ann'), sb = w.sock('bob'); const pa = w.bal('ann', 'play'), pb = w.bal('bob', 'play');
  const run = climb(w, sa, 2500, 12); const rb = climb(w, sb, 2500, 2);
  w.R = () => 0; w.hooks.before.settle = refuseSettle; H.call(w, sb, 'step', { roundId: rb.roundId, n: rb.steps + 1, to: rb.options[0].to }); ok(w.disk().open.bob.pend, 'pended');
  w.crash(); const good = fs.readFileSync(w.files.store, 'utf8'); fs.writeFileSync(w.files.store, good.slice(0, 1500)); logs.length = 0;
  w.boot(); const loud = logs.filter((l) => /campaign: store/.test(l));
  eq(w.bal('ann', 'play') - pa, 2500 * run.mx / 100 - 2500, 'ann is paid her stored multiplier'); eq(w.bal('bob', 'play') - pb, -2500, 'the lost stake stays lost'); eq(w.escrows().length, 0);
  eq(loud.length, 1, loud.join(' | ')); ok(/Restored/.test(loud[0])); eq(damaged(w.files.store).length, 1); eq(fs.readFileSync(damaged(w.files.store)[0], 'utf8'), good.slice(0, 1500));
});

t('G2: a torn campaign.json with no good copy: loud, the bytes are kept, the stake is refunded at 1.00x and the line says the multiplier is lost', () => {
  const logs = []; const w = world({ log: (...a) => logs.push(a.join(' ')) }); const sa = w.sock('ann'); const pa = w.bal('ann', 'play');
  climb(w, sa, 2500, 5); w.crash(); fs.writeFileSync(w.files.store, '{"v":1,"open":{"ann":{"roundId"'); fs.rmSync(w.files.store + '.bak'); logs.length = 0;
  w.boot(); eq(w.bal('ann', 'play'), pa, 'refunded at the stake'); eq(w.escrows().length, 0);
  ok(logs.some((l) => /EMPTY Campaign state/.test(l)), logs.join('|')); ok(logs.some((l) => /escrow with no record, refunded at the stake/.test(l) && /state file was lost/.test(l)), 'the refund is a loud line too'); eq(damaged(w.files.store).length, 1);
});

t('G3: a blocked store: recover() refunds and settles nothing, audit() throws (the registry sweeps nothing), a new run is refused and its stake returns', () => {
  const logs = []; const w = world({ log: (...a) => logs.push(a.join(' ')) }); const sa = w.sock('ann'); const pa = w.bal('ann', 'play');
  climb(w, sa, 2500, 5); w.crash(); fs.writeFileSync(w.files.store, '{"v":1,"open":{"ann":{"roundId"');
  const rn = fs.renameSync, cp = fs.copyFileSync;
  fs.renameSync = (a, b) => { if (String(b).includes('.damaged-')) throw new Error('EACCES'); return rn(a, b); };
  fs.copyFileSync = (a, b, c) => { if (String(b).includes('.damaged-')) throw new Error('EACCES'); return cp(a, b, c); };
  try {
    logs.length = 0; w.boot();
    eq(w.bal('ann', 'play'), pa - 2500, 'the stake is still in the escrow'); eq(w.escrows().length, 1, 'the registry sweep did not refund it'); assert.throws(() => w.audit(), /blocked/);
    ok(logs.some((l) => /BLOCKED/.test(l)) && logs.length <= 3, logs.join('|'));
    const sb = w.sock('bob'); const pb = w.bal('bob', 'play'); const r = H.start(w, sb, 'play', 500, 'OH'); ok(r.error && r.error.code === 'internal', 'a new run is refused'); eq(w.bal('bob', 'play'), pb, 'its stake went back'); eq(w.escrows().length, 1);
    eq(fs.readFileSync(w.files.store, 'utf8'), '{"v":1,"open":{"ann":{"roundId"', 'the file was not touched');
  } finally { fs.renameSync = rn; fs.copyFileSync = cp; }
  // a person fixes the file (restores a good copy): the next boot settles the run at its multiplier
  fs.rmSync(w.files.store); fs.writeFileSync(w.files.store, fs.readFileSync(w.files.store + '.bak', 'utf8')); w.crash(); w.boot();
  eq(w.escrows().length, 0); ok(w.bal('ann', 'play') > pa - 2500, 'paid on the restored record');
});

(async () => {
  const only = process.argv[2];
  for (const [name, fn] of todo) {
    if (only && !name.includes(only)) continue;
    try { await fn(); pass++; console.log('ok   ' + name); } catch (e) { fail++; console.log('FAIL ' + name + '\n     ' + String(e && e.stack || e).split('\n').slice(0, 6).join('\n     ')); }
  }
  delete process.env.CAMPAIGN_TEST;
  console.log(`\nmoney-1008-campaign-store: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
