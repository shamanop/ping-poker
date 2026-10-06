// test-only preload for f1_u17.js: the FIRST spin of the process plays with the engine rng pinned to F1_SEED (games/* untouched, the module's own `rng` hook point).
const path = require('path');
const root = path.join(__dirname, '..', '..', '..', '..');
const E = require(path.join(root, 'games', 'coldcall-engine.js'));
const G = require(path.join(root, 'games', 'coldcall.js'));
let used = false; const h = G.handlers, spin0 = h.spin;
h.spin = function (...a) { if (!used && process.env.F1_SEED) { used = true; G.rng = E.rngFrom(+process.env.F1_SEED); } return spin0.apply(this, a); };
