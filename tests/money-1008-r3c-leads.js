'use strict';
// node tests/money-1008-r3c-leads.js   (MONEY 1008 R3C-1: a change of the live Cold Call config must not change the SHARE of one Callback a player already holds)
// The leads a player holds are an absolute count of tenths of a lead; a Callback needs a full list (list x 10 tenths) of the LIVE config. A config with a shorter list made every stored lead worth more
// Callbacks than it was earned for (seam-cb.js: 401 leads = 0.89 of one Callback paid 8 Callbacks, +2,025,166 cents on 20,000 staked). RULE: leads earned under list size A count under list size B as the
// same fraction of one Callback (0.89 stays 0.89), both ways (shorter, longer, reset to shipped, a config loaded at boot); an armed Callback stays exactly one; Chips and Cash never mix.
// The test reads the share only through the game's own result (pull.state.lt - pull.filled over list x 10) and writes a stored record only by copying one the game wrote, so it does not name the stamp field,
// except in the one test that plays an old record (no stamp: `delete rec.ll`; read as the shipped list size, 450).
process.env.COLDCALL_JOURNAL = '1';
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-r3c-'));
const H = require('./lib-coldcall-ledger.js');
const E = require('../games/coldcall-engine.js');
const L = require('../games/coldcall-livecfg.js');

setTimeout(() => { console.error('FAIL watchdog: the test did not finish in 240 s'); process.exit(1); }, 240000).unref();
let n = 0, passed = 0;
const test = async (name, fn) => { try { await fn(); console.log('ok   ' + name); passed++; } catch (e) { console.error('FAIL ' + name + '\n' + (e.stack || e)); process.exitCode = 1; } };
const world = (o = {}) => H.world({ dir: fs.mkdtempSync(path.join(tmp, 'w' + ++n + '-')), potRng: () => 1, ...o });
const clone = (o) => JSON.parse(JSON.stringify(o));
const SHORT = { pull: { list: 45, fill: { dead: 0.1, win: 0.1, bonus: 0.1 }, daily: { base: 0.02, perStreak: 0.005 } } };      // the R3C-1 config: the list ten times shorter
const LONG = { pull: { list: 4500, fill: { dead: 12, win: 6, bonus: 6 }, daily: { base: 2, perStreak: 0.5 } } };                  // the list ten times longer
// an accepted config as the checked route leaves it (the measurement is stubbed: the point here is what a player holds, not the payback check): saved with its measurement, so a boot loads it
const accept = (o) => L.setLiveConfig({ overrides: o, note: 'r3c test', measured: { ok: true, hash: L.configHash(L.merge(o)), summary: { plain: { pct: 97 } }, worst: { way: 'plain', pct: 97, se: 0.5 } } });
const reset = () => L.setLiveConfig({ overrides: {}, note: 'r3c test reset' });
const BET = 2500;

function spinWait(w, s, payload, i = 0) {
  return new Promise((resolve) => {
    const push = s.out.push.bind(s.out); let k = 0; setTimeout(() => { s.out.push = push; resolve({ error: { code: 'test_timeout' } }); }, 10000).unref();
    s.out.push = (e) => {
      const r = push(e);
      if (e[0] === 'error') { s.out.push = push; resolve({ error: e[1] }); }
      else if (e[0] === 'g:coldcall:result') {
        if (e[1].status === 'pending') setImmediate(() => { w.clock.advance(5); s.send('g:coldcall:decide', { roundId: e[1].roundId, ...H.policy(i + k++, e[1].pending) }); });
        else { s.out.push = push; resolve(e[1]); }
      }
      return r;
    };
    w.clock.advance(200); s.send('g:coldcall:spin', payload);
  });
}
// one paid spin; the number of leads the player carried INTO it (tenths) and the live list in tenths, read from the result
async function spin(w, s, cur, i = 0) {
  const r = await spinWait(w, s, { bet: BET, mode: cur }, i);
  assert.ok(!r.error, 'the spin gives a result: ' + JSON.stringify(r.error));
  const st = r.pull.state, full = Math.round(st.list * 10);
  return { r, callback: !!r.callback, carried: r.callback ? null : st.lt - (r.pull.filled || 0), full, share: r.callback ? null : (st.lt - (r.pull.filled || 0)) / full, listNow: st.list };
}
// a player with `lt` tenths of a lead earned under the live (shipped) config, no Callback armed: one warm-up spin writes the record the game writes (daily gift taken, so no daily leads on the next spin), then the leads are set
async function holder(w, cur, tenths, armed) {
  const s = w.sock('ann'); w.fund('ann', cur, 1e8); w.fund('ann', cur === 'play' ? 'chips' : 'play', 1e6);
  const a = await spin(w, s, cur); assert.ok(!a.callback);
  const rec = clone(w.store().player('ann', cur)); rec.lt = tenths; rec.avg = BET; rec.cb = armed ? { bet: BET } : null; rec.warm = []; rec.warmBet = 0; rec.coldAt = null; rec.carry = 0;
  w.store().setPlayer('ann', cur, rec); w.flush();
  return { s, rec };
}
const near = (x, y, tag) => assert.ok(Math.abs(x - y) < 1e-6, tag + ': share ' + x + ', wanted ' + y);

(async () => {
  for (const cur of ['play', 'chips']) {
    const other = cur === 'play' ? 'chips' : 'play';
    await test(cur + ': a SHORTER list keeps 0.89 of a Callback as 0.89 (shipped 450 -> 45)', async () => {
      const w = world(), { s } = await holder(w, cur, 4005, false);
      const pool0 = w.pool(other), house0 = w.house(other), bal0 = w.bal('ann', other);
      accept(SHORT);
      const a = await spin(w, s, cur, 1); assert.strictEqual(a.listNow, 45);
      near(a.share, 4005 / 4500, 'after the swap to list 45');
      // the whole way: from 0.89 of one Callback no more than ONE Callback comes in the next 16 spins (the fault paid 8)
      let cbs = 0; for (let i = 0; i < 16; i++) { const b = await spin(w, s, cur, 10 + i); if (b.callback) cbs++; }
      assert.ok(cbs <= 1, cur + ': ' + cbs + ' Callbacks from 0.89 of one');
      assert.strictEqual(w.bal('ann', other), bal0, 'the other currency is untouched'); assert.strictEqual(w.pool(other), pool0); assert.strictEqual(w.house(other), house0);
      assert.strictEqual(w.conservation(cur).everything, 0); assert.strictEqual(w.conservation(other).everything, 0);
    });
    await test(cur + ': a LONGER list keeps 0.89 as 0.89 (shipped 450 -> 4500)', async () => {
      const w = world(), { s } = await holder(w, cur, 4005, false);
      accept(LONG);
      const a = await spin(w, s, cur, 1); assert.strictEqual(a.listNow, 4500);
      near(a.share, 4005 / 4500, 'after the swap to list 4500');
    });
  }
  await test('RESET to the shipped numbers keeps the share (from list 45 and from list 4500)', async () => {
    for (const [o, list, lt] of [[SHORT, 45, 400], [LONG, 4500, 40000]]) {
      const w = world(); accept(o);
      const { s } = await holder(w, 'play', lt, false);
      reset();
      const a = await spin(w, s, 'play', 1); assert.strictEqual(a.listNow, 450);
      near(a.share, lt / (list * 10), 'after the reset from list ' + list);
    }
  });
  await test('an ARMED Callback stays exactly one Callback (shorter list, longer list, reset)', async () => {
    for (const [o, cur] of [[SHORT, 'play'], [LONG, 'chips'], [null, 'play']]) {
      const w = world(); if (!o) accept(SHORT);
      const { s } = await holder(w, cur, 0, true);
      if (o) accept(o); else reset();
      const bal0 = w.bal('ann', cur);
      const a = await spin(w, s, cur, 1); assert.ok(a.callback, 'the armed Callback is played (free)');
      assert.strictEqual(a.r.cost, 0);
      const b = await spin(w, s, cur, 2); assert.ok(!b.callback, 'and it is ONE Callback: the next spin is a paid one');
      assert.ok(w.bal('ann', cur) - bal0 < 2500 * 10000, 'sane win'); assert.strictEqual(w.conservation(cur).everything, 0);
    }
  });
  await test('CRASH + BOOT: between the swap and the next spin, and after it (the config is loaded at boot)', async () => {
    const w = world(); await holder(w, 'play', 4005, false);
    accept(SHORT);
    w.reboot();                                                  // the swap is on disk, nothing was spun: boot loads list 45; the record on disk is still the one written under list 450
    assert.strictEqual(E.CFG.pull.list, 45, 'the accepted config is loaded at boot');
    let s2 = w.sock('ann');
    const a = await spin(w, s2, 'play', 1); near(a.share, 4005 / 4500, 'first spin after the boot');
    const lt1 = w.store().player('ann', 'play').lt;              // what the spin wrote
    w.reboot(); s2 = w.sock('ann');                              // a crash right after it: the journal / store as written
    assert.strictEqual(E.CFG.pull.list, 45);
    const b = await spin(w, s2, 'play', 2); near(b.share, lt1 / 450, 'second spin after a second boot (the leads the first spin left, as a share of list 45)');
    reset(); w.reboot(); s2 = w.sock('ann');                     // the way back: reset, then a boot (shipped again)
    assert.strictEqual(E.CFG.pull.list, 450);
    const lt2 = w.store().player('ann', 'play').lt;
    const c = await spin(w, s2, 'play', 3); near(c.share, lt2 / 450, 'after the reset and a boot (list 450 again)');
  });
  await test('a round OPEN across the swap settles on its own numbers and the next spin still sees the same share', async () => {
    const w = world(), { s } = await holder(w, 'play', 4005, false);
    let swapped = false, view = null;
    for (let i = 0; i < 800 && !swapped; i++) {                    // spin until a round stops at a decision, swap the config then, answer it
      view = await new Promise((resolve) => {
        const push = s.out.push.bind(s.out), t = setTimeout(() => { s.out.push = push; resolve(null); }, 10000); let k = 0;
        s.out.push = (e) => { const r = push(e);
          if (e[0] === 'g:coldcall:result') {
            if (e[1].status === 'pending') { if (!swapped) { swapped = true; accept(SHORT); } setImmediate(() => { w.clock.advance(5); s.send('g:coldcall:decide', { roundId: e[1].roundId, ...H.policy(i + k++, e[1].pending) }); }); }
            else { clearTimeout(t); s.out.push = push; resolve(e[1]); } }
          return r; };
        w.clock.advance(200); s.send('g:coldcall:spin', { bet: BET, mode: 'play' });
      });
      assert.ok(view && !view.error, 'the round ends');
      if (!swapped) { const rec = clone(w.store().player('ann', 'play')); rec.lt = 4005; rec.cb = null; w.store().setPlayer('ann', 'play', rec); w.flush(); }
    }
    assert.ok(swapped, 'a round with a decision came up'); assert.strictEqual(E.CFG.pull.list, 45);
    const st = view.pull.state, shown = st.lt / (st.list * 10);
    const stored = w.store().player('ann', 'play'); assert.ok(!stored.cb, 'no Callback armed by this round (the test needs a plain share)');
    const a = await spin(w, s, 'play', 1); assert.ok(!a.callback);
    near(a.share, shown, 'the next spin reads the share the settled round showed (shown ' + shown + ')');
  });
  await test('boot with the saved config reverted (an unmeasured file is not trusted): the share survives the change at boot', async () => {
    const w = world(), { s } = await holder(w, 'play', 4005, false);
    L.setLiveConfig({ overrides: SHORT, note: 'r3c unmeasured' });   // saved, but with no measurement: the next boot goes back to the shipped numbers
    const a = await spin(w, s, 'play', 1); near(a.share, 4005 / 4500, 'under list 45'); const lt = w.store().player('ann', 'play').lt;
    w.reboot(); const s2 = w.sock('ann'); assert.strictEqual(E.CFG.pull.list, 450, 'the unmeasured file is not trusted at boot');
    const b = await spin(w, s2, 'play', 2); near(b.share, lt / 450, 'after the boot back on list 450: the leads the spin left under list 45, as a share of 45');
  });
  await test('an OLD record with no stamp reads as the shipped list size (450): 0.89 stays 0.89 under list 45 and under list 4500', async () => {
    for (const [o, list] of [[SHORT, 45], [LONG, 4500], [null, 450]]) {
      const w = world(), { s, rec } = await holder(w, 'play', 4005, false);
      delete rec.ll; w.store().setPlayer('ann', 'play', rec); w.flush();
      if (o) accept(o);
      const a = await spin(w, s, 'play', 1); assert.strictEqual(a.listNow, list);
      near(a.share, 4005 / 4500, 'old record under list ' + list);
    }
    // and through a restart (the record comes back from disk with no stamp)
    const w = world(), { rec } = await holder(w, 'chips', 4005, false); delete rec.ll; w.store().setPlayer('ann', 'chips', rec); w.flush();
    accept(SHORT); w.reboot(); const s2 = w.sock('ann'); const a = await spin(w, s2, 'chips', 1); near(a.share, 4005 / 4500, 'old record, boot, list 45');
  });
  console.log('\n' + passed + ' passed' + (process.exitCode ? ', FAILED' : ''));
  process.exit(process.exitCode || 0);
})();
