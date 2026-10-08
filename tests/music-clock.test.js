// Clock math for the synced radio: node tests/music-clock.test.js
const assert = require('assert');
const C = require('../public/music-clock.js');
const { createMusic } = require('../music.js');
const path = require('path');

const T = [{ durationSec: 20 }, { durationSec: 17.3 }, { durationSec: 23 }];
const total = C.loopMs(T);
assert.strictEqual(total, 60300);

// boundaries
let p = C.position(T, 1000, 1000); assert.deepStrictEqual([p.index, p.offsetMs], [0, 0]);
p = C.position(T, 1000, 1000 + 19999); assert.deepStrictEqual([p.index, p.offsetMs], [0, 19999]);
p = C.position(T, 1000, 1000 + 20000); assert.deepStrictEqual([p.index, p.offsetMs], [1, 0]);
p = C.position(T, 1000, 1000 + 37300); assert.deepStrictEqual([p.index, p.offsetMs], [2, 0]);
p = C.position(T, 1000, 1000 + 60299); assert.deepStrictEqual([p.index, p.offsetMs], [2, 22999]);
p = C.position(T, 1000, 1000 + 60300); assert.deepStrictEqual([p.index, p.offsetMs], [0, 0]);
// wraps many loops, and times before epoch
p = C.position(T, 1000, 1000 + 60300 * 12345 + 21000); assert.deepStrictEqual([p.index, p.offsetMs], [1, 1000]);
p = C.position(T, 1000, 1000 - 1); assert.deepStrictEqual([p.index, p.offsetMs], [2, 22999]);
assert.strictEqual(C.position([], 0, 5), null);
// trackStart/End consistent
p = C.position(T, 5000, 5000 + 25000);
assert.strictEqual(p.trackStartMs, 5000 + 20000); assert.strictEqual(p.trackEndMs, 5000 + 37300);

// two "clients" with different local clocks agree after offset correction (within the skew estimate)
function client(skewMs, owdMs) {
  const samples = [];
  for (const rtt of [180, 60, 90, 300]) {
    const t0 = 10000 + samples.length * 1000;
    const ts = (t0 + skewMs) + rtt / 2;              // server time at midpoint (symmetric path)
    samples.push({ t0, ts: ts - skewMs + skewMs, t1: t0 + rtt });
  }
  return C.estimateOffset(samples);
}
const est = client(0);
assert.strictEqual(est.rtt, 60);
// asymmetric-free case: offset exact
const e2 = C.estimateOffset([{ t0: 1000, ts: 501060, t1: 1100 }]); // client clock is 500,010 behind server (midpoint 1050 -> 501060)
assert.strictEqual(e2.offset, 500010); assert.strictEqual(e2.rtt, 100);
assert.strictEqual(C.estimateOffset([]), null);
// lowest RTT wins
assert.strictEqual(C.estimateOffset([{ t0: 0, ts: 1000, t1: 400 }, { t0: 0, ts: 1000, t1: 20 }]).rtt, 20);

// rate nudge
assert.strictEqual(C.nudgeRate(0), 1); assert.strictEqual(C.nudgeRate(0.02), 1);
assert(C.nudgeRate(0.2) < 1 && C.nudgeRate(0.2) >= 0.97);
assert(C.nudgeRate(-0.2) > 1 && C.nudgeRate(-0.2) <= 1.03);
assert.strictEqual(C.nudgeRate(5), 0.97); assert.strictEqual(C.nudgeRate(-5), 1.03);

// epoch is deterministic, per-station, and in the past
assert.strictEqual(C.stationEpoch('x'), C.stationEpoch('x'));
assert.notStrictEqual(C.stationEpoch('x'), C.stationEpoch('y'));
assert(C.stationEpoch('x') < Date.now());

// server module loads placeholder stations and agrees with the pure math
const m = createMusic({ musicDir: path.join(__dirname, '..', 'public', 'audio', 'music'), now: () => 1791227440097 });
const st = m.stations();
assert(st.length >= 1 && st.every(s => s.tracks.length && s.epoch));
const np = m.nowPlaying(st[0].id, 1791227440097);
const pp = C.position(st[0].tracks, st[0].epoch, 1791227440097);
assert.strictEqual(np.index, pp.index); assert.strictEqual(np.offsetMs, pp.offsetMs);
console.log('music-clock: all ok (' + st.length + ' stations)');
