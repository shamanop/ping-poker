'use strict';
// node tests/money-1008-admin-page.js   (well under a second; no browser, no server, no port)
// MONEY HARDENING 1008, RVP-1 (review of R2B-6): public/admin.js is the only place that decides what the Set Cash box holds and what it sends. R2B-6 was a page fault (the box held the WALLET,
// the server set the TOTAL), and no repo test read the page. This loads the real public/admin.js (with public/money.js and public/amount.js) into a vm over a hand-made DOM stub (as tests/amountfield.test.js does),
// opens the Accounts tab on a fed `admin_overview`, and drives Set Cash like the admin does. ADMIN_JS=<file> runs it against a copy of the page (how the mutants were checked).
//   M1  the box is prefilled with the wallet (`a.play`) instead of the player's TOTAL Cash: Save unchanged then sends the wallet
//   M8  the page sends `cents - playInPlay` (wallet target) while the confirm says TOTAL
const vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
const PUB = path.join(__dirname, '..', 'public');
const src = (f) => fs.readFileSync(f, 'utf8');

class Cls {
  constructor() { this.s = new Set(); }
  add(c) { this.s.add(c); } remove(c) { this.s.delete(c); } contains(c) { return this.s.has(c); }
  toggle(c, on) { (on === undefined ? !this.s.has(c) : on) ? this.s.add(c) : this.s.delete(c); }
}
const byId = new Map();
class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.ls = {}; this.dataset = {}; this.style = {}; this.hidden = false; this.value = ''; this._text = ''; this.parent = null; this.classList = new Cls(); this.isConnected = true; this._html = ''; this.sub = {}; }
  set className(v) { this.classList.s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return Array.from(this.classList.s).join(' '); }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'value') this.value = String(v); if (k === 'id') byId.set(String(v), this); }
  set id(v) { byId.set(String(v), this); this._id = v; } get id() { return this._id; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  set min(v) { this.attrs.min = String(v); } set max(v) { this.attrs.max = String(v); } get max() { return this.attrs.max; } get min() { return this.attrs.min; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  append(...n) { n.forEach(c => this.appendChild(c)); }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
  remove() { this.parent && this.parent.removeChild(this); }
  contains() { return false; }
  get firstChild() { return this.children[0] || null; }
  addEventListener(t, fn) { (this.ls[t] = this.ls[t] || []).push(fn); }
  fire(t, ev) { const e = Object.assign({ type: t, key: '', target: this, preventDefault() { this.prevented = true; }, stopPropagation() {} }, ev || {}); (this.ls[t] || []).forEach(f => f(e)); return e; }
  focus() { if (this.tag === 'input') this.fire('focus'); }
  setPointerCapture() {}
  find(cls) { const out = []; (function w(n) { if (n.classList.contains(cls)) out.push(n); n.children.forEach(w); })(this); return out; }
  // the page writes its panels with innerHTML: build just the pieces it looks up afterwards (ids, the tabs / panes, the account rows with their data-a buttons)
  set innerHTML(h) {
    this._html = String(h); this.children = []; this.sub = { tabs: [], panes: [], rows: [], btns: [] };
    for (const m of this._html.matchAll(/\sid="([\w-]+)"/g)) { const e = new El('x'); e._id = m[1]; byId.set(m[1], e); }
    for (const m of this._html.matchAll(/data-t="(\w+)"/g)) { const e = new El('button'); e.dataset.t = m[1]; this.sub.tabs.push(e); }
    for (const m of this._html.matchAll(/data-p="(\w+)"/g)) { const e = new El('div'); e.dataset.p = m[1]; this.sub.panes.push(e); }
    for (const m of this._html.matchAll(/<tr data-k="([^"]*)">([\s\S]*?)<\/tr>/g)) {
      const tr = new El('tr'); tr.dataset.k = m[1]; tr.html = m[2]; this.sub.rows.push(tr);
      for (const b of m[2].matchAll(/data-a="([\w-]+)"/g)) { const e = new El('button'); e.dataset.a = b[1]; e.closest = (sel) => (sel === 'tr' ? tr : null); this.sub.btns.push(e); }
    }
  }
  get innerHTML() { return this._html; }
  querySelectorAll(sel) { return sel === '.adm-tab' ? this.sub.tabs : sel === '.adm-pane' ? this.sub.panes : sel === '[data-a]' ? this.sub.btns : []; }
  querySelector(sel) { return sel[0] === '#' ? (byId.get(sel.slice(1)) || null) : null; }
}

function loadPage() {
  byId.clear();
  const sent = [], handlers = {}, confirms = [], dlisteners = {};
  const doc = {
    readyState: 'complete', activeElement: null,
    createElement: (t) => new El(t), querySelectorAll: () => [],
    getElementById: (id) => byId.get(id) || null,
    addEventListener: (t, fn) => { (dlisteners[t] = dlisteners[t] || []).push(fn); },
    body: new El('body'),
  };
  const ctx = {
    document: doc, console, crypto: require('crypto').webcrypto, Math, Date, JSON, Number, String, Object, Array, Set, Map,
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: () => 0, setInterval: () => 0, clearInterval() {}, clearTimeout() {}, requestAnimationFrame: () => 0,
    Lobby: { user: () => ({ isAdmin: true }) },
    PingSocket: { on: (ev, fn) => { handlers[ev] = fn; }, emit: (ev, p) => { sent.push([ev, p]); } },
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.confirm = (text) => { confirms.push(String(text)); return true; };
  vm.createContext(ctx);
  vm.runInContext(src(path.join(PUB, 'money.js')), ctx);
  vm.runInContext(src(path.join(PUB, 'amount.js')), ctx);
  vm.runInContext(src(process.env.ADMIN_JS || path.join(PUB, 'admin.js')), ctx);
  return { ctx, doc, sent, handlers, confirms };
}

// Ann: 800.00 Cash in all (600.00 in the wallet, 200.00 at a Cash table); Bob: 50.00, all in the wallet
const OVERVIEW = { table: null, accounts: [
  { key: 'ann', display: 'Ann', online: true, claimed: true, bank: 5000, balance: 5000, atTable: 0, atTablePlay: 20000, play: 60000, playWallet: 60000, playInPlay: 20000, playTotal: 80000 },
  { key: 'bob', display: 'Bob', online: false, claimed: true, bank: 0, balance: 0, atTable: 0, atTablePlay: 0, play: 5000, playWallet: 5000, playInPlay: 0, playTotal: 5000 },
] };

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('PASS ' + name); } catch (e) { fail++; console.log('FAIL ' + name + ': ' + (e && e.message)); } };

function openAccounts() {
  const P = loadPage();
  assert.ok(P.ctx.AdminConsole, 'the page did not export AdminConsole');
  P.ctx.AdminConsole.open();
  const veil = byId.get('adm-veil') || P.doc.body.children.find((c) => c.className === 'adm-veil');
  assert.ok(veil, 'the panel was not built');
  assert.ok(P.sent.some((m) => m[0] === 'admin_overview'), 'opening the panel did not ask for the overview');
  veil.sub.tabs.find((b) => b.dataset.t === 'accounts').fire('click');
  P.handlers.admin_overview(JSON.parse(JSON.stringify(OVERVIEW)));
  return P;
}
const host = () => byId.get('adm-accounts');
const click = (key, act) => { const b = host().sub.btns.find((x) => x.dataset.a === act && x.closest('tr').dataset.k === key); assert.ok(b, `no ${act} button on the ${key} row`); b.fire('click'); };
const box = () => { const slot = byId.get('adm-edit-slot'); assert.ok(slot, 'no amount box in the row'); const inp = slot.find('amt-text')[0]; assert.ok(inp, 'no text input in the amount box'); return inp; };

t('the accounts table shows the TOTAL Cash (800.00), not the wallet', () => {
  openAccounts();
  const row = host().sub.rows.find((r) => r.dataset.k === 'ann');
  assert.ok(/\$800\.00/.test(row.html), 'row: ' + row.html.slice(0, 400));
  assert.ok(/\$200\.00 of it at a table/.test(row.html), 'the part at a table is shown');
});

t('Set Cash: the box is prefilled with the TOTAL (M1: the wallet), and Save unchanged sends the total (M1, M8)', () => {
  const P = openAccounts();
  click('ann', 'play');
  const inp = box();
  assert.strictEqual(P.ctx.Money.parse(inp.value, 'usd').units, 80000, `the box holds "${inp.value}", not the 800.00 total (the wallet is 600.00)`);
  P.sent.length = 0; P.confirms.length = 0;
  click('ann', 'play-ok');
  const sent = P.sent.filter((m) => m[0] === 'admin_set_play');
  assert.strictEqual(sent.length, 1, 'admin_set_play sent ' + sent.length + ' times');
  assert.strictEqual(sent[0][1].key, 'ann');
  assert.strictEqual(sent[0][1].cents, 80000, `the page sent ${sent[0][1].cents} cents; the confirm says TOTAL 800.00 (wallet 600.00 + 200.00 at a table)`);
  assert.ok(typeof sent[0][1].opId === 'string' && sent[0][1].opId.length >= 8, 'no op id');
  assert.strictEqual(P.confirms.length, 1, 'one confirm');
  assert.ok(/TOTAL Cash to \$800\b/.test(P.confirms[0]), 'the confirm names the total: ' + P.confirms[0].replace(/\n/g, ' | '));
  assert.ok(/\$600 wallet/.test(P.confirms[0]) && /\$200 at tables/.test(P.confirms[0]), 'the confirm says where the Cash is: ' + P.confirms[0].replace(/\n/g, ' | '));
});

t('Set Cash: a typed amount is sent as that total (500.00 -> 50000), not minus what is in play (M8)', () => {
  const P = openAccounts();
  click('ann', 'play');
  const inp = box(); inp.focus(); inp.value = '500.00'; inp.fire('input'); inp.fire('blur');
  P.sent.length = 0; P.confirms.length = 0;
  click('ann', 'play-ok');
  const sent = P.sent.filter((m) => m[0] === 'admin_set_play');
  assert.strictEqual(sent.length, 1, 'admin_set_play sent ' + sent.length + ' times');
  assert.strictEqual(sent[0][1].cents, 50000, `typed 500.00, the page sent ${sent[0][1].cents} cents`);
  assert.ok(/TOTAL Cash to \$500\b/.test(P.confirms[0] || ''), 'the confirm names the typed total: ' + (P.confirms[0] || '').replace(/\n/g, ' | '));
});

t('Set Cash on an account with nothing in play: the box holds the wallet (= the total) and Save sends it', () => {
  const P = openAccounts();
  click('bob', 'play');
  assert.strictEqual(P.ctx.Money.parse(box().value, 'usd').units, 5000, 'the box holds "' + box().value + '"');
  P.sent.length = 0; click('bob', 'play-ok');
  const sent = P.sent.filter((m) => m[0] === 'admin_set_play');
  assert.ok(sent.length === 1 && sent[0][1].cents === 5000 && sent[0][1].key === 'bob', JSON.stringify(sent));
});

t('a cancelled confirm sends nothing', () => {
  const P = openAccounts();
  P.ctx.confirm = () => false;
  click('ann', 'play'); P.sent.length = 0; click('ann', 'play-ok');
  assert.strictEqual(P.sent.filter((m) => m[0] === 'admin_set_play').length, 0);
});

t('RVP-2: index.html loads admin.js under a new ?v= (a tab that was open before the deploy must not keep the old Set Cash page)', () => {
  const m = /<script src="admin\.js\?v=([^"]+)"><\/script>/.exec(src(path.join(PUB, 'index.html')));
  assert.ok(m, 'no admin.js script tag with a ?v= in public/index.html');
  assert.notStrictEqual(m[1], '7-v2', 'admin.js?v= is still the value of the page that showed the wallet');
});

console.log(`money-1008-admin-page: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
