// Calls every new SFX event against a stub AudioContext: no exception, each makes sound nodes. (Nobody has LISTENED to them.) node audio_stub.js
const vm = require('vm'), fs = require('fs');
let osc = 0, bufs = 0, gains = 0;
const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} });
const node = (extra = {}) => ({ connect() {}, ...extra });
class AC { constructor() { this.currentTime = 0; this.sampleRate = 8000; this.state = 'running'; this.destination = node(); }
  resume() {} createDynamicsCompressor() { return node({ threshold: param(), ratio: param() }); } createGain() { gains++; return node({ gain: param() }); }
  createBuffer(c, n) { bufs++; return { getChannelData: () => new Float32Array(n) }; } createOscillator() { osc++; return node({ type: '', frequency: param(), start() {}, stop() {} }); }
  createBufferSource() { bufs++; return node({ buffer: null, loop: false, start() {}, stop() {} }); } createBiquadFilter() { return node({ type: '', frequency: param(), Q: param() }); } }
const sandbox = { window: { AudioContext: AC }, localStorage: { getItem: () => null, setItem() {} }, setInterval: () => 1, clearInterval() {}, console, Math };
vm.createContext(sandbox); vm.runInContext(fs.readFileSync(require('path').join(__dirname, '../../../public/games/coldcall/audio.js'), 'utf8') + '\nthis.SFX = SFX;', sandbox);
const S = sandbox.SFX; S.init();
const calls = { clusterPop: [0, 3, 9], hot: [1, 5], sweep: [], fall: [], phoneRing: [], reveal: [0, 1, 2], upsellReveal: [], closeReveal: [], upsell: [2, 5, 10], upsellHit: [], closeStart: [], collect: [0, 7, 30], stamp: [], bonusIntro: [], spinsAdded: [2, 4], upgrade: [] };
let ok = 0, fails = [];
for (const [k, argsList] of Object.entries(calls)) for (const a of (argsList.length ? argsList : [undefined])) { const before = osc + bufs; try { S[k](a); if (osc + bufs === before) fails.push(k + ' made no sound nodes'); else ok++; } catch (e) { fails.push(k + ': ' + e.message); } }
console.log({ ok, fails, osc, bufs, gains });
