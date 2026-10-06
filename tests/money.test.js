'use strict';
// Client Money core: format, strict parse grammar, modeFor, pref state, round-trip property.
const vm = require('vm'), fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'money.js'), 'utf8');
function load(initial) {
  const mem = Object.assign({}, initial || {});
  const localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  const ctx = { localStorage, console };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { M: ctx.Money, mem, ctx };
}
let fail = 0, pass = 0;
function eq(name, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; }
  else { fail++; console.log('FAIL ' + name + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); }
}
const { M, mem } = load();
const U = 'usd', C = 'chips';

// ---- format
eq('125000 usd', M.format(125000, U), '$1,250');
eq('50 usd', M.format(50, U), '$0.50');
eq('1235 usd', M.format(1235, U), '$12.35');
eq('negative', M.format(-300, U), '-$3');
eq('signed', M.format(8500, U, { signed: true }), '+$85');
eq('signed negative', M.format(-8500, U, { signed: true }), '-$85');
eq('chips view', M.format(12500, C), '12,500');
eq('zero usd', M.format(0, U), '$0');
eq('NaN', M.format(NaN, U), '-');
eq('undefined', M.format(undefined, C), '-');
eq('null', M.format(null, C), '-');
eq('compact usd M', M.format(125000000, U, { compact: true }), '$1.3M');
eq('compact usd K', M.format(1250000, U, { compact: true }), '$12.5K');
eq('compact chips K', M.format(12500, C, { compact: true }), '12.5K');
eq('compact 99,999 chips is 100K', M.format(99999, C, { compact: 1000 }), '100K');
eq('compact 999,999 chips rolls to 1M not 1000K', M.format(999999, C, { compact: 1000 }), '1M');
eq('compact below threshold', M.format(9999, C, { compact: true }), '9,999');
eq('no symbol', M.format(125000, U, { symbol: false }), '1,250');
eq('plain usd whole', M.plain(125000, U), '1250');
eq('plain usd cents', M.plain(1235, U), '12.35');
eq('plain usd 5c', M.plain(5, U), '0.05');
eq('plain chips', M.plain(1250000, C), '1250000');

// ---- parse grammar table (S3-7)
const ok = (t, m, u) => eq(`parse ${JSON.stringify(t)} ${m}`, M.parse(t, m), { ok: true, units: u });
const bad = (t, m, e) => { const r = M.parse(t, m); eq(`parse ${JSON.stringify(t)} ${m} rejected`, r.ok === false && r.error, e); eq(`parse ${JSON.stringify(t)} has hint`, typeof r.hint, 'string'); };
ok('$12.5', U, 1250);
ok('12.50', U, 1250);
ok('$1,250', U, 125000);
ok('1,250.75', U, 125075);
ok('  25  ', U, 2500);
ok('0.05', U, 5);
ok('5.', U, 500);
ok('0', U, 0);
ok('1,250', C, 1250);
ok('2500', C, 2500);
ok('1,000,000', C, 1000000);
bad('12,50', U, 'syntax');
eq('12,50 hint', M.parse('12,50', U).hint, 'Use a dot for cents');
bad('12 50', U, 'syntax');
bad('1.000,50', U, 'syntax');
bad('1e3', U, 'syntax');
bad('1e3', C, 'syntax');
bad('-5', U, 'negative');
bad('$-5', U, 'negative');
bad('-5', C, 'negative');
bad('12.345', U, 'precision');
bad('.5', C, 'precision');
bad('2.5', C, 'precision');
bad('2.', C, 'precision');
bad('.5', U, 'syntax');
bad('abc', U, 'syntax');
bad('1,00', U, 'syntax');
bad('12,34,567', C, 'syntax');
bad('$100', C, 'syntax');
bad('', U, 'empty');
bad('   ', C, 'empty');
eq('null', M.parse(null, U).error, 'empty');
eq('undefined', M.parse(undefined, C).error, 'empty');
bad('99999999999999999999', C, 'syntax');
bad('$99999999999999999', U, 'syntax');

// ---- round trip property: parse(format(u, m)) === u, parse(plain(u, m)) === u
let rt = 0, seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const samples = [0, 1, 5, 50, 99, 100, 101, 999, 1000, 1235, 9999, 10000, 99999, 100000, 123456, 1e6, 1e7, 1e8, 123456789];
for (let i = 0; i < 3000; i++) samples.push(Math.floor(rnd() * Math.pow(10, Math.floor(rnd() * 9))));
for (const m of [U, C]) {
  for (const u of samples) {
    const a = M.parse(M.format(u, m, { symbol: true }), m);
    const b = M.parse(M.plain(u, m), m);
    if (!a.ok || a.units !== u || !b.ok || b.units !== u) { fail++; if (rt++ < 5) console.log('FAIL roundtrip', m, u, JSON.stringify(a), JSON.stringify(b)); } else pass++;
  }
}
// symbol:false (grouped, no $) also round-trips
for (const m of [U, C]) for (const u of samples.slice(0, 200)) { const r = M.parse(M.format(u, m, { symbol: false }), m); if (!r.ok || r.units !== u) { fail++; console.log('FAIL nosym roundtrip', m, u); } else pass++; }

// ---- modeFor (per table, never global)
eq('modeFor usd', M.modeFor('usd', 'chips'), 'usd');
eq('modeFor chips', M.modeFor('chips', 'cents'), 'chips');
eq('modeFor auto cents', M.modeFor('auto', 'cents'), 'usd');
eq('modeFor auto chips', M.modeFor('auto', 'chips'), 'chips');
eq('modeFor auto undefined', M.modeFor('auto'), 'chips');

// ---- pref state
eq('no global unit api', ['setUnit', 'getUnit', 'getMode', 'getPref', 'fmt', 'setMode', 'onChange'].filter(k => k in M), []);
eq('default pref', M.pref, 'auto');
let n = 0, last = null, saved = null;
const off = M.onPrefChange(p => { n++; last = p; });
M.onSave = v => { saved = v; };
M.setPref('chips');
eq('setPref fires once', n, 1);
eq('setPref arg', last, 'chips');
eq('persisted', mem['ping.currency'], 'chips');
eq('pref getter', M.pref, 'chips');
eq('onSave called', saved, 'chips');
saved = null;
M.setPref('usd', true);
eq('silent skips onSave', saved, null);
eq('silent still notifies', n, 2);
M.setPref('bogus');
eq('bogus ignored', M.pref, 'usd');
off();
M.setPref('auto');
eq('unsubscribe', n, 2);
eq('stored pref reloads', load({ 'ping.currency': 'usd' }).M.pref, 'usd');
eq('bad stored pref', load({ 'ping.currency': 'x' }).M.pref, 'auto');
eq('niceStep chips', M.niceStep(100, C), 1);
eq('niceStep usd 100', M.niceStep(100, U), 25);
eq('niceStep usd 5', M.niceStep(5, U), 5);
eq('niceStep usd 2000', M.niceStep(2000, U), 100);

console.log(`money.test.js: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
