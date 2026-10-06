// test-only preload: lengthen the decision timer of THIS server process (never edits games/coldcall-engine.js)
const E = require('/home/frank/.openclaw/workspace/projects/ping-coldcall-fb1/games/coldcall-engine.js');
E.CFG.pull.decision.timeoutMs = +process.env.CC_DECISION_MS || 20000;
