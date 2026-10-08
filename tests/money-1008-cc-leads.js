'use strict';
// node tests/money-1008-cc-leads.js   (MONEY 1008 K2-5: the leads of an instant paid spin are on disk BEFORE the result goes to the client)
// The stake of an instant paid spin is in the ledger at once; the leads (and the rest of the player's state) used to wait for a 50 ms debounced write, so a crash in between kept the stake and
// dropped the leads. Write-then-answer, like the ledger: at the moment the result is emitted, the file already holds the state the result belongs to; a restart finds it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-leads-'));
const H = require('./lib-coldcall-ledger.js');
const E = require('../games/coldcall-engine.js');

let pass = 0;
const test = async (name, fn) => { try { await fn(); pass++; console.log('ok   ' + name); } catch (e) { console.error('FAIL ' + name + '\n' + (e.stack || e)); process.exitCode = 1; } };
const world = (o = {}) => H.world({ dir: fs.mkdtempSync(path.join(tmp, 'w')), potRng: () => 1, ...o });
const decideAll = (w, s, r) => { for (let k = 0; r.status === 'pending' && k < 8; k++) r = H.decide(w, s, r, r.pending.k === 'pick' ? { k: 'pick', p: r.pending.choices[0] } : { k: 'more', take: false }); return r; };
const onDisk = (w, key, mode) => { const d = w.disk(); return d && d.players && d.players[key] && d.players[key][mode] ? d.players[key][mode] : null; };

(async () => {
  for (const mode of ['play', 'chips']) {
    await test(`${mode}: after every instant paid spin the state on disk equals the state in memory AT THE MOMENT the result is emitted; a restart keeps the leads`, async () => {
      const w = world({ rng: E.rngFrom(3), roundRng: E.rngFrom(4) }); const s = w.sock('ann'); w.fund('ann', mode, 1e8);
      let seen = 0; const bad = [];
      const push = s.out.push.bind(s.out);
      s.out.push = (e) => {                                                   // the moment a result reaches the client
        if (e[0] === 'g:coldcall:result' && e[1] && e[1].status === 'done') { seen++; try { assert.deepStrictEqual(onDisk(w, 'ann', mode), w.store().player('ann', mode)); } catch { bad.push(seen); } }
        return push(e);
      };
      let staked = 0;
      for (let i = 0; i < 40; i++) { const r = decideAll(w, s, H.spin(w, s, { bet: 2500, mode })); assert.ok(!r.error, JSON.stringify(r.error)); staked += r.cost; }
      assert.ok(staked > 0 && seen >= 40); assert.deepStrictEqual(bad, [], 'spins whose state was not on disk when the result was emitted');
      const mem = w.store().player('ann', mode); assert.ok(mem.lt > 0, 'the spins earned leads: ' + mem.lt);
      w.reboot();                                                             // a crash right after the last result, no 50 ms pause
      const after = w.store().player('ann', mode);
      assert.strictEqual(after && after.lt, mem.lt, 'leadsAfterRestart equals the leads in memory'); assert.deepStrictEqual(after, mem);
      w.crash();
    });
  }

  await test('the same for a buy and for a Callback round (the other settle paths)', async () => {
    const w = world({ rng: E.rngFrom(7), roundRng: E.rngFrom(8) }); const s = w.sock('ann'); w.fund('ann', 'play', 1e8);
    let n = 0;
    for (let i = 0; i < 25; i++) {
      const r = decideAll(w, s, H.spin(w, s, { bet: 100, mode: 'play', ...(i % 5 === 4 ? { buyBonus: 'bonus1' } : {}) })); assert.ok(!r.error, JSON.stringify(r.error)); n++;
      assert.deepStrictEqual(onDisk(w, 'ann', 'play'), w.store().player('ann', 'play'), 'spin ' + i + (r.callback ? ' (Callback)' : ''));
    }
    const mem = w.store().player('ann', 'play'); w.reboot(); assert.deepStrictEqual(w.store().player('ann', 'play'), mem); w.crash();
  });

  await test('a store that cannot write (blocked after a damaged file that could not be kept) takes no bet: the spin is refused and nothing moves', async () => {
    const dir = fs.mkdtempSync(path.join(tmp, 'blk')), file = path.join(dir, 'coldcall-pull.json'); fs.writeFileSync(file, '{"v":1,"players":{"ann":');
    const r0 = fs.renameSync, c0 = fs.copyFileSync, deny = (a, b) => { if (String(b).includes('.damaged-')) throw Object.assign(new Error('EROFS'), { code: 'EROFS' }); };
    fs.renameSync = (a, b) => { deny(a, b); return r0(a, b); }; fs.copyFileSync = (a, b, f) => { deny(a, b); return c0(a, b, f); };
    let w; try { w = H.world({ dir, potRng: () => 1, rng: E.rngFrom(5), log: () => {} }); } finally { fs.renameSync = r0; fs.copyFileSync = c0; }
    const s = w.sock('ann'); w.fund('ann', 'play', 100000); const b0 = w.bal('ann', 'play');
    const r = H.spin(w, s, { bet: 100, mode: 'play' }); assert.ok(r.error, 'refused'); assert.strictEqual(w.bal('ann', 'play'), b0);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), '{"v":1,"players":{"ann":', 'the damaged file is untouched'); w.crash();
  });

  console.log(pass + ' passed' + (process.exitCode ? ', with failures' : ''));
  fs.rmSync(tmp, { recursive: true, force: true });
})();
