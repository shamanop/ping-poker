// test-only preload for the real-server coverage driver (real.js). Never edits games/*: it sets the module's own hook points from outside.
//   CC_FLAGS=<dir>         flag files, each consumed by ONE paid settle (the next potRng call):
//                            pot_hit   -> potRng returns 0 (the pot is taken on that round)
//                            void_next -> potRng throws (settle fails, the round is voided and refunded: 'settle_error')
//   CC_POT_MINBAL=<cents>  CFG.pull.pot.minBal for this process only (a low pot may then be won)
//   CC_DECISION_MS=<ms>    decision timer (default stock 20000)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '..', '..', '..');
const E = require(path.join(root, 'games', 'coldcall-engine.js'));
const G = require(path.join(root, 'games', 'coldcall.js'));
if (process.env.CC_DECISION_MS) E.CFG.pull.decision.timeoutMs = +process.env.CC_DECISION_MS;
if (process.env.CC_POT_MINBAL) E.CFG.pull.pot.minBal = +process.env.CC_POT_MINBAL;
const dir = process.env.CC_FLAGS;
const take = (n) => { if (!dir) return false; const f = path.join(dir, n); if (!fs.existsSync(f)) return false; try { fs.unlinkSync(f); } catch {} return true; };
G.potRng = () => {
  if (take('void_next')) throw new Error('real_hooks: forced settle failure');
  if (take('pot_hit')) return 0;
  return crypto.randomBytes(6).readUIntBE(0, 6) / 281474976710656;
};
