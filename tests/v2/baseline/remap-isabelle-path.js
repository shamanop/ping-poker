'use strict';
// The old tests (tests/*.js via qa/finaltest/D/lib.js) require socket.io-client from /home/isabelle/.cache/node_modules, which only exists on Isabelle's box.
// Preload this file (NODE_OPTIONS="--require <this file>") to point that path at the repo's own node_modules. No repo file is edited.
const M = require('module'), path = require('path');
const from = '/home/isabelle/.cache/node_modules', to = path.resolve(__dirname, '..', '..', '..', 'node_modules');
const orig = M._resolveFilename;
M._resolveFilename = function (req, ...rest) { if (typeof req === 'string' && req.startsWith(from)) req = to + req.slice(from.length); return orig.call(this, req, ...rest); };
