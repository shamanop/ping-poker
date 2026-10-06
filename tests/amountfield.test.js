'use strict';
// AmountInput unit test. No jsdom is installed, so this uses a tiny hand-made DOM stub (just what amount.js touches).
const vm = require('vm'), fs = require('fs'), path = require('path');
const pub = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

class Cls {
  constructor(el) { this.el = el; this.s = new Set(); }
  add(c) { this.s.add(c); this.sync(); } remove(c) { this.s.delete(c); this.sync(); }
  toggle(c, on) { (on === undefined ? !this.s.has(c) : on) ? this.s.add(c) : this.s.delete(c); this.sync(); }
  contains(c) { return this.s.has(c); }
  sync() { this.el._cls = Array.from(this.s).join(' '); }
}
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.ls = {}; this.hidden = false; this.value = ''; this._text = ''; this.parent = null; this.classList = new Cls(this); this.isConnected = true; }
  set className(v) { this.classList.s = new Set(String(v).split(/\s+/).filter(Boolean)); this._cls = String(v); }
  get className() { return Array.from(this.classList.s).join(' '); }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'value') this.value = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  set min(v) { this.attrs.min = String(v); } set max(v) { this.attrs.max = String(v); }
  get max() { return this.attrs.max; } get min() { return this.attrs.min; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  append(...n) { n.forEach(c => this.appendChild(c)); }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
  get firstChild() { return this.children[0] || null; }
  addEventListener(t, fn) { (this.ls[t] = this.ls[t] || []).push(fn); }
  fire(t, ev) { const e = Object.assign({ type: t, key: '', preventDefault() { this.prevented = true; } }, ev || {}); (this.ls[t] || []).forEach(f => f(e)); return e; }
  focus() { if (this.tag === 'input') this.fire('focus'); }
  find(cls) { const out = []; (function w(n) { if (n.classList.contains(cls)) out.push(n); n.children.forEach(w); })(this); return out; }
}
const doc = { createElement: t => new El(t), querySelectorAll: () => [], addEventListener() {}, readyState: 'complete' };

function load(initial) {
  const mem = Object.assign({}, initial || {});
  const localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  const ctx = { localStorage, console, document: doc };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(pub('money.js'), ctx);
  vm.runInContext(pub('amount.js'), ctx);
  return ctx;
}

let fail = 0, pass = 0;
function eq(name, got, want) {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.log('FAIL ' + name + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); }
}
function ok(name, c) { eq(name, !!c, true); }
function type(f, s) { f.input.focus(); f.input.value = s; f.input.fire('input'); }
function blur(f) { f.input.fire('blur'); }

// ---- stops: inside [min, max], contain min, max and every in-range preset; raise scale has BB steps then log.
{
  const ctx = load();
  const A = ctx.AmountInput;
  const pre = [{ label: 'Min', units: 2000 }, { label: 'Half', units: 25000 }, { label: 'Pot', units: 70000 }, { label: 'Max', units: 100000 }, { label: 'Out', units: 999999 }];
  for (const scale of ['ladder', 'raise']) {
    const s = A.buildStops({ min: 2000, max: 100000, presets: pre, scale, bb: 200 });
    ok(scale + ' stops contain min/max', s[0] === 2000 && s[s.length - 1] === 100000);
    ok(scale + ' stops contain presets', [2000, 25000, 70000, 100000].every(u => s.includes(u)));
    ok(scale + ' stops inside range', s.every(v => v >= 2000 && v <= 100000));
    ok(scale + ' stops sorted unique', s.every((v, i) => i === 0 || v > s[i - 1]));
    ok(scale + ' out-of-range preset dropped', !s.includes(999999));
  }
  const r = A.buildStops({ min: 400, max: 40000, presets: [], scale: 'raise', bb: 200 });
  ok('raise BB steps to 10 BB', [400, 600, 800, 1000, 1200, 1400, 1600, 1800, 2000].every(u => r.includes(u)));
  eq('degenerate min=max', A.buildStops({ min: 500, max: 500, presets: [], scale: 'ladder' }), [500]);
}

// ---- presets: duplicates merged, preset equal to max is "All-in"
{
  const ctx = load();
  const f = ctx.AmountInput({ units: 10000, min: 2000, max: 50000, unit: 'cents', scale: 'raise', bb: 200,
    presets: [{ label: 'Half', units: 25000 }, { label: 'Pot', units: 25000 }, { label: 'Max', units: 50000 }] });
  const p = f.presets();
  eq('duplicate presets merged', p.filter(x => x.units === 25000).length, 1);
  eq('max preset is All-in', p.find(x => x.units === 50000).label, 'All-in');
}

// ---- mode toggle mid-edit keeps units, never re-parses text
{
  const ctx = load({ 'ping.currency': 'usd' });
  const f = ctx.AmountInput({ units: 12500, min: 100, max: 100000, unit: 'cents', scale: 'ladder' });
  eq('usd text', f.text(), '125');
  eq('usd inputmode', f.input.getAttribute('inputmode'), 'decimal');
  eq('type=text', f.input.getAttribute('type'), 'text');
  ctx.Money.setPref('chips');
  eq('chips text after toggle', f.text(), '12500');
  eq('units unchanged by toggle', f.value(), 12500);
  eq('chips inputmode', f.input.getAttribute('inputmode'), 'numeric');
  // mid-edit: type "50" in chips (=50 units), toggle to usd: must stay 50 units ($0.50), never become $50
  type(f, '500');
  ctx.Money.setPref('usd');
  eq('mid-edit toggle keeps units (500 chips = $5)', f.value(), 500);
  eq('mid-edit toggle text re-rendered from units', f.text(), '5');
  ctx.Money.setPref('chips');
  eq('toggle back', f.text(), '500');
}

// ---- external set() while focused and dirty leaves the text alone; slider and value follow once committed
{
  const ctx = load({ 'ping.currency': 'chips' });
  const f = ctx.AmountInput({ units: 1000, min: 200, max: 50000, unit: 'chips', scale: 'raise', bb: 200 });
  f.input.focus();
  type(f, '3');
  f.set(8000, { source: 'game_state' });
  eq('dirty+focused text untouched by set()', f.text(), '3');
  ok('dirty text under min gives null + message', f.value() === null && f.message() !== '');
  type(f, '4000');
  eq('typed value', f.value(), 4000);
  blur(f);
  eq('blur keeps typed value', f.value(), 4000);
  f.set(9000, { source: 'game_state' });
  eq('not dirty: set() renders text', f.text(), '9000');
  eq('not dirty: value follows', f.value(), 9000);
}

// ---- out of range: null + visible message, never clamp-and-send
{
  const ctx = load({ 'ping.currency': 'chips' });
  const sent = [];
  const f = ctx.AmountInput({ units: 1000, min: 200, max: 5000, unit: 'chips', scale: 'ladder', onCommit: u => sent.push(u) });
  type(f, '999999');
  eq('too big -> null', f.value(), null);
  ok('too big -> message', /200/.test(f.message()) && /5,000/.test(f.message()));
  eq('submit refused', f.submit(), false);
  eq('nothing sent', sent, []);
  type(f, '5');
  eq('too small -> null', f.value(), null);
  type(f, 'abc');
  eq('garbage -> null', f.value(), null);
  ok('garbage -> message', f.message() !== '');
  type(f, '');
  eq('empty -> null', f.value(), null);
  eq('empty submit refused', f.submit(), false);
  type(f, '2500');
  eq('valid typed', f.value(), 2500);
  eq('valid submit', f.submit(), true);
  eq('committed units', sent, [2500]);
}

// ---- usd grammar: dollars typed commit as cents
{
  const ctx = load({ 'ping.currency': 'usd' });
  const sent = [];
  const f = ctx.AmountInput({ units: 1000, min: 100, max: 100000, unit: 'cents', scale: 'ladder', onCommit: u => sent.push(u) });
  type(f, '12.5');
  eq('$12.5 = 1250 cents', f.value(), 1250);
  f.submit();
  type(f, '$20');
  f.submit();
  eq('commits in units', sent, [1250, 2000]);
}

// ---- slider arrows move stop to stop
{
  const ctx = load({ 'ping.currency': 'chips' });
  const f = ctx.AmountInput({ units: 2000, min: 2000, max: 100000, unit: 'chips', scale: 'ladder', presets: [{ label: 'Half', units: 25000 }] });
  const st = f.stops();
  f.slider.fire('keydown', { key: 'ArrowRight' });
  eq('arrow right -> next stop', f.value(), st[1]);
  f.slider.fire('keydown', { key: 'ArrowRight' });
  eq('arrow right again', f.value(), st[2]);
  f.slider.fire('keydown', { key: 'ArrowLeft' });
  eq('arrow left', f.value(), st[1]);
  f.slider.fire('keydown', { key: 'End' });
  eq('End -> max', f.value(), 100000);
  f.slider.fire('keydown', { key: 'ArrowRight' });
  eq('arrow past max stays', f.value(), 100000);
  f.slider.fire('keydown', { key: 'Home' });
  eq('Home -> min', f.value(), 2000);
}

// ---- whole-stack commit that did not come from the All-in preset asks for confirmation
{
  const ctx = load({ 'ping.currency': 'chips' });
  const sent = [];
  const f = ctx.AmountInput({ units: 1000, min: 200, max: 5000, unit: 'chips', scale: 'raise', bb: 200, onCommit: u => sent.push(u),
    presets: [{ label: 'Pot', units: 3000 }, { label: 'Max', units: 5000 }] });
  type(f, '5000');
  eq('typed whole stack: submit asks', f.submit(), false);
  eq('not sent yet', sent, []);
  f.el.find('amt-confirm-yes')[0].fire('click');
  eq('confirmed -> sent', sent, [5000]);
  // via All-in preset: no confirmation
  const allin = f.el.find('amt-pre').find(b => b.getAttribute('data-units') === '5000');
  allin.fire('click');
  eq('All-in preset submits directly', f.submit(), true);
  eq('sent twice', sent, [5000, 5000]);
  // a non-max value never asks
  type(f, '3000');
  eq('normal commit', f.submit(), true);
}

// ---- setBounds: server-sent bounds change, text locked while dirty
{
  const ctx = load({ 'ping.currency': 'chips' });
  const f = ctx.AmountInput({ units: 1000, min: 200, max: 5000, unit: 'chips', scale: 'raise', bb: 200 });
  f.setBounds({ min: 400, max: 3000 });
  eq('bounds updated', f.bounds(), { min: 400, max: 3000 });
  ok('stops follow bounds', f.stops().every(v => v >= 400 && v <= 3000) && f.stops()[0] === 400);
  f.setBounds({ min: 2000, max: 3000 });
  eq('value outside new bounds is pulled in, visibly', f.value(), 2000);
}

console.log('amountfield.test.js: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
