'use strict';
// Generates the migration fixtures from the file formats in server.js / wallet.js / accounts.js.
// No real prod data is used. Run: node tests/v2-unit/fixtures/gen-fixtures.js   (rewrites the folders next to this file)
// Formats:
//   bank.json      { "<key>": <chips int> }                                   server.js bank, keyed by account key
//   wallet.json    { "<key>": { play: <cents>, lastTopUp: <ms|null>, byGame: {} } }
//   stacks.json    { "<key>": <chips> }  (flat, what saveStacks writes)  or  { "<table>": { "<key>": <chips> } }
//   accounts.json  { version: 1, accounts: { "<key>": { id, key, display, ... } } }
const fs = require('fs');
const path = require('path');

function acct(key, display) {
  return {
    id: 'a_' + Buffer.from(key).toString('hex').slice(0, 8).padEnd(8, '0'), key, display: display || key, avatar: 'a01',
    kdf: null, salt: null, pinHash: null, claimed: true, isAdmin: key === 'chris', createdAt: 1790000000000, lastLoginAt: 1790000100000,
    prefs: { currency: 'auto', sound: true }, stats: {}, sessions: [], legacy: { bankKey: key },
  };
}
const accountsFile = (keys) => ({ version: 1, accounts: Object.fromEntries(keys.map(k => [k, acct(k, k[0].toUpperCase() + k.slice(1))])) });
const w = (play, extra) => ({ play, lastTopUp: null, byGame: {}, ...(extra || {}) });

function mulberry(seed) { return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function big() {
  const rnd = mulberry(20261006);
  const pick = (n) => Math.floor(rnd() * n);
  const keys = [], bank = {}, wallet = {}, stacks = {};
  for (let i = 0; i < 500; i++) {
    const k = 'player' + String(i).padStart(3, '0');
    keys.push(k);
    const r = rnd();
    if (r < 0.80) bank[k] = pick(50) === 0 ? 0 : pick(250000);                // normal, a few zero rows
    else if (r < 0.85) bank[k] = 10000 + pick(1000) + 0.5;                    // non-integer: rejected
    else if (r < 0.88) bank[k] = -(1 + pick(5000));                           // negative: rejected
    // else: no bank row
    const q = rnd();
    if (q < 0.85) wallet[k] = w(pick(40) === 0 ? 0 : pick(3000000), { lastTopUp: pick(5) === 0 ? 1790000000000 + pick(1e8) : null });
    else if (q < 0.88) wallet[k] = w(1000000 - 0.25);                         // non-integer wallet
    // else: no wallet row
    if (rnd() < 0.10) stacks[k] = 1 + pick(8000);                             // an open chips stack from a crash
  }
  for (let i = 0; i < 12; i++) bank['ghost ' + i] = 1 + pick(90000);          // name-keyed orphans
  wallet['ghost 3'] = w(5000);                                                // an orphan wallet row
  stacks['ghost 5'] = 2500;                                                   // an orphan open stack
  return { bank, wallet, stacks, accounts: accountsFile(keys) };
}

function all() {
  return {
    empty: { bank: {}, wallet: {}, stacks: {}, accounts: { version: 1, accounts: {} } },
    normal: {
      bank: { chris: 52000, raj: 6400, pia: 10000, sam: 0, lee: 1 },
      wallet: { chris: w(1000000), raj: w(742500, { lastTopUp: 1790000000000 }), pia: w(250), sam: w(9999999), lee: w(1000000) },
      stacks: {},
      accounts: accountsFile(['chris', 'raj', 'pia', 'sam', 'lee']),
    },
    orphans: {
      bank: { chris: 5000, 'dial-up': 9546, 'crip doe': 6454, hr: 0, Raj: 700 },   // 'Raj' (capital) does not match the account key 'raj'
      wallet: { chris: w(1000000), raj: w(1000000) },
      stacks: {},
      accounts: accountsFile(['chris', 'raj']),
    },
    stacks: {
      bank: { chris: 4000, raj: 6400 },
      wallet: { chris: w(1000000), raj: w(1000000), pia: w(1000000) },
      stacks: { chris: 2000, raj: 1500, pia: 3000, stranger: 800 },              // pia has a stack but no bank row; stranger is no account
      accounts: accountsFile(['chris', 'raj', 'pia']),
    },
    'stacks-nested': {
      bank: { chris: 4000 },
      wallet: { chris: w(1000000) },
      stacks: { POKERPING: { chris: 2000 }, T2: { chris: 300, stranger: 5 } },
      accounts: accountsFile(['chris']),
    },
    'no-bank-row': {
      bank: { chris: 100 },
      wallet: { chris: w(1000000), newbie: w(1000000) },
      stacks: {},
      accounts: accountsFile(['chris', 'newbie']),
    },
    'no-wallet': {
      bank: { chris: 100, newbie: 12345 },
      wallet: { chris: w(1000000) },
      stacks: {},
      accounts: accountsFile(['chris', 'newbie']),
    },
    'bad-rows': {
      bank: { chris: 12.5, raj: -40, pia: '100', sam: null, lee: 700, zed: 0.1, big: 2 ** 60, flo: { chips: 5 } },
      wallet: { chris: w(-1), raj: w(99.99), pia: { play: '5' }, sam: w(0), lee: 'x' },
      stacks: { lee: -5, sam: 1.5, chris: 0 },
      accounts: accountsFile(['chris', 'raj', 'pia', 'sam', 'lee']),
    },
    big: big(),
  };
}

function write(root) {
  const sets = all();
  for (const [name, files] of Object.entries(sets)) {
    const d = path.join(root, name);
    fs.mkdirSync(d, { recursive: true });
    for (const [f, v] of Object.entries(files)) fs.writeFileSync(path.join(d, f + '.json'), JSON.stringify(v, null, name === 'big' ? 0 : 1) + '\n');
  }
  return Object.keys(sets);
}

if (require.main === module) console.log('wrote', write(__dirname).join(', '));
module.exports = { all, write };
