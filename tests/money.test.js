'use strict';
const vm = require('vm'), fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'money.js'), 'utf8');
function load(initial) {
  const mem = Object.assign({}, initial || {});
  const localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  const ctx = { localStorage, console };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { M: ctx.Money, mem };
}
let fail = 0;
function eq(name, got, want) {
  if (got === want) console.log('PASS ' + name);
  else { fail++; console.log('FAIL ' + name + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); }
}
const { M, mem } = load();
const C = { unit: 'cents', mode: 'usd' };
eq('125000c usd', M.fmt(125000, C), '$1,250');
eq('50c usd', M.fmt(50, C), '$0.50');
eq('1235c usd', M.fmt(1235, C), '$12.35');
eq('negative', M.fmt(-300, C), '-$3');
eq('signed', M.fmt(8500, Object.assign({ signed: true }, C)), '+$85');
eq('signed negative', M.fmt(-8500, Object.assign({ signed: true }, C)), '-$85');
eq('chips view of cents', M.fmt(12500, { unit: 'cents', mode: 'chips' }), '12,500');
eq('chips unit usd view', M.fmt(1500, { unit: 'chips', mode: 'usd' }), '$1,500');
eq('chips unit chips view', M.fmt(1500, { unit: 'chips', mode: 'chips' }), '1,500');
eq('NaN', M.fmt(NaN), '-');
eq('undefined', M.fmt(undefined), '-');
eq('compact usd', M.fmt(125000000, { unit: 'cents', mode: 'usd', compact: true }), '$1.3M');
eq('compact usd K', M.fmt(1250000, { unit: 'cents', mode: 'usd', compact: true }), '$12.5K');
eq('compact chips', M.fmt(12500, { unit: 'chips', mode: 'chips', compact: true }), '12.5K');
eq('no symbol', M.fmt(125000, Object.assign({ symbol: false }, C)), '1,250');
eq('parse $12.5', M.parse('$12.5', C), 1250);
eq('parse 1,250', M.parse('1,250', C), 125000);
eq('parse abc', M.parse('abc', C), null);
eq('parse empty', M.parse('', C), null);
eq('parse chips', M.parse('1,250', { unit: 'chips', mode: 'chips' }), 1250);

let n = 0, last = null;
const off = M.onChange(m => { n++; last = m; });
M.setMode('chips');
eq('setMode fires once', n, 1);
eq('setMode arg', last, 'chips');
eq('persisted', mem['ping.currency'], 'chips');
eq('getMode', M.getMode(), 'chips');
M.setMode('auto');
M.setUnit('cents');
eq('auto cents -> usd', M.getMode(), 'usd');
eq('getPref', M.getPref(), 'auto');
M.setUnit('chips');
eq('auto chips -> chips', M.getMode(), 'chips');
const before = n;
off();
M.setUnit('cents');
eq('unsubscribe', n, before);
eq('fmt follows ambient', M.fmt(125000), '$1,250');
let saved = null; M.onSave = v => { saved = v; };
M.setMode('usd');
eq('onSave called', saved, 'usd');
saved = null; M.setMode('chips', true);
eq('silent skips onSave', saved, null);
const r = load({ 'ping.currency': 'usd' });
eq('restores pref', r.M.getPref(), 'usd');
eq('niceStep cents', M.niceStep(100), 25);
M.setUnit('chips');
eq('niceStep chips', M.niceStep(20), 1);

if (fail) { console.log(fail + ' FAILED'); process.exit(1); }
console.log('money.test.js OK');
