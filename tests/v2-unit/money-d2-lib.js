'use strict';
// Shared pieces of the D2 ledger tests (window + checkpoint). Not a test file itself; run-money.js does not list it.
const fs = require('fs');
const os = require('os');
const path = require('path');

const New = require('../../money/ledger');
const Ref = require('./fixtures/ledger-pre-d2');     // the frozen pre-D2 ledger

function mulberry32(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = () => next();
  rng.int = (n) => Math.floor(next() * n);
  rng.range = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  rng.chance = (p) => next() < p;
  rng.pick = (arr) => arr[Math.floor(next() * arr.length)];
  return rng;
}

function makeRunner(name) {
  const r = { pass: 0, fail: 0 };
  r.t = (title, fn) => {
    try { fn(); r.pass++; } catch (e) { r.fail++; console.log('FAIL ' + title + ': ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)); }
  };
  r.done = () => { console.log(`${name}: ${r.pass} passed, ${r.fail} failed`); process.exit(r.fail ? 1 : 0); };
  return r;
}

const eq = (a, b, m) => { if (a !== b) throw new Error((m || 'eq') + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b)); };
const deq = (a, b, m) => { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error((m || 'deq') + ': got ' + x.slice(0, 400) + ' want ' + y.slice(0, 400)); };
const ok = (c, m) => { if (!c) throw new Error(m || 'not ok'); };

function mkdir(prefix) { return fs.mkdtempSync(path.join(process.env.MONEY_TMP || os.tmpdir(), prefix)); }

// A log collector: lines through opts.log land in .lines
function logger() { const lines = []; const f = (m) => lines.push(m); f.lines = lines; return f; }

module.exports = { New, Ref, mulberry32, makeRunner, eq, deq, ok, mkdir, logger, fs, path };
