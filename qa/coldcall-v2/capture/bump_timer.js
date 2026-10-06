// test-only preload: lengthen the decision timer of THIS server process (never edits games/coldcall-engine.js)
const E = require(require('path').join(__dirname, '..', '..', '..', 'games', 'coldcall-engine.js'));
E.CFG.pull.decision.timeoutMs = +process.env.CC_DECISION_MS || 20000;
