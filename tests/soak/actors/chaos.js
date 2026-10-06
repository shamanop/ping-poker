'use strict';
module.exports = { async step(W, kind, sig) { await W.killAndRestart(sig); return { actor: 'chaos', what: 'kill', kind, sig }; } };
