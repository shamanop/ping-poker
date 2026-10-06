'use strict';
// Money core (v2): pure helpers plus ONE piece of mutable state, the user's display preference.
// Amounts are always integer units (1 unit = 1 chip = 1 Play cent). There is no global "table unit":
// every view works out its own mode with Money.modeFor(Money.pref, tableUnit) and passes it in.
(function (root) {
  const KEY = 'ping.currency';
  const store = () => { try { return root.localStorage || null; } catch (e) { return null; } };
  let pref = 'auto';
  const subs = [];
  let onSave = null;

  try { const v = store() && store().getItem(KEY); if (v === 'usd' || v === 'chips' || v === 'auto') pref = v; } catch (e) {}

  // 'auto' resolves per table unit ('cents' tables read in dollars, 'chips' tables in chips), never globally.
  function modeFor(p, unit) {
    if (p === 'usd' || p === 'chips') return p;
    return unit === 'cents' ? 'usd' : 'chips';
  }

  function group(n) { return Math.abs(n).toLocaleString('en-US'); }

  // format(units, mode, {compact, signed, symbol}) -> string. Display only; compact output is never parsed.
  function format(units, mode, opts) {
    opts = opts || {};
    const n0 = Number(units);
    if (units === null || units === undefined || units === '' || !isFinite(n0)) return '-';
    const n = Math.round(n0);
    const dollars = mode === 'usd';
    const sym = opts.symbol !== false;
    const neg = n < 0;
    const sign = neg ? '-' : (opts.signed && n > 0 ? '+' : '');
    const v = dollars ? n / 100 : n;
    const a = Math.abs(v);
    let body;
    if (opts.compact && a >= (typeof opts.compact === 'number' ? opts.compact : 10000)) {
      let k = a >= 1e6 ? a / 1e6 : a / 1e3;
      let suf = a >= 1e6 ? 'M' : 'K';
      let r = Math.round(k * 10) / 10;
      if (suf === 'K' && r >= 1000) { r = Math.round(a / 1e5) / 10; suf = 'M'; } // 999,950 -> 1M, not 1000K
      body = r.toString().replace(/\.0$/, '') + suf;
    } else if (dollars && n % 100 !== 0) {
      body = a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } else {
      body = group(Math.round(v));
    }
    return sign + (dollars && sym ? '$' : '') + body;
  }

  // plain(units, mode): text for an INPUT box: no symbol, no grouping, no compact. parse(plain(u, m), m).units === u.
  function plain(units, mode) {
    const n = Math.round(Number(units));
    if (!isFinite(n)) return '';
    if (mode !== 'usd') return String(n);
    if (n % 100 === 0) return String(n / 100);
    const neg = n < 0, a = Math.abs(n);
    return (neg ? '-' : '') + Math.floor(a / 100) + '.' + String(a % 100).padStart(2, '0');
  }

  const RE_USD = /^(\d{1,3}(,\d{3})+|\d+)(\.\d{0,2})?$/;
  const RE_CHIPS = /^(\d{1,3}(,\d{3})+|\d+)$/;

  // parse(text, mode) -> {ok:true, units} | {ok:false, error:'empty'|'syntax'|'precision'|'negative', hint}
  function parse(text, mode) {
    if (text === null || text === undefined) return { ok: false, error: 'empty', hint: 'Enter an amount' };
    let t = String(text).trim();
    if (t === '') return { ok: false, error: 'empty', hint: 'Enter an amount' };
    const usd = mode === 'usd';
    if (t[0] === '-' || /^\$-/.test(t)) return { ok: false, error: 'negative', hint: 'Amounts cannot be negative' };
    if (usd && t[0] === '$') t = t.slice(1);
    if (usd && /^\d+,\d{2}$/.test(t)) return { ok: false, error: 'syntax', hint: 'Use a dot for cents' };
    if (!usd && /^\d*\.\d+$|^\d+\.\d*$/.test(t)) return { ok: false, error: 'precision', hint: 'Whole chips only' };
    if (usd && /^(\d{1,3}(,\d{3})+|\d+)\.\d{3,}$/.test(t)) return { ok: false, error: 'precision', hint: 'Cents only: at most 2 decimals' };
    if (!(usd ? RE_USD : RE_CHIPS).test(t)) return { ok: false, error: 'syntax', hint: usd ? 'Enter dollars, like 25 or 25.50' : 'Enter whole chips, like 2,500' };
    const clean = t.replace(/,/g, '');
    let units;
    if (usd) {
      const [d, c = ''] = clean.split('.');
      if (d.length > 13) return { ok: false, error: 'syntax', hint: 'Too large' };
      units = Number(d) * 100 + Number((c + '00').slice(0, 2));
    } else {
      if (clean.length > 15) return { ok: false, error: 'syntax', hint: 'Too large' };
      units = Number(clean);
    }
    if (!Number.isSafeInteger(units)) return { ok: false, error: 'syntax', hint: 'Too large' };
    return { ok: true, units };
  }

  function emit() { subs.slice().forEach(fn => { try { fn(pref); } catch (e) {} }); }

  function setPref(m, silent) {
    if (m !== 'usd' && m !== 'chips' && m !== 'auto') return;
    pref = m;
    try { store() && store().setItem(KEY, m); } catch (e) {}
    if (!silent && typeof onSave === 'function') { try { onSave(m); } catch (e) {} }
    emit();
  }

  function onPrefChange(fn) {
    subs.push(fn);
    return function () { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
  }

  // $/chips toggle button. Its unit comes from the slot (`data-unit`), default 'chips'. A view that cares
  // sets `slot.dataset.unit` and calls Money.refreshToggles().
  const toggles = [];
  function paintToggle(el) {
    const m = modeFor(pref, el.dataset.unit);
    el.setAttribute('aria-pressed', m === 'usd' ? 'true' : 'false');
    el.dataset.mode = m;
    el.querySelectorAll('i').forEach(i => i.classList.toggle('on', i.dataset.m === m));
  }
  function toggleEl(unit) {
    const doc = root.document;
    const el = doc.createElement('button');
    el.type = 'button';
    el.className = 'money-toggle seg';
    el.title = 'Switch between dollars and chips';
    el.dataset.unit = unit || 'chips';
    el.innerHTML = '<i data-m="usd">$</i><i data-m="chips">chips</i>';
    el.addEventListener('click', () => setPref(modeFor(pref, el.dataset.unit) === 'usd' ? 'chips' : 'usd'));
    paintToggle(el);
    toggles.push(el);
    return el;
  }
  function refreshToggles() {
    toggles.forEach(el => {
      const slot = el.parentElement;
      if (slot && slot.dataset && slot.dataset.unit) el.dataset.unit = slot.dataset.unit;
      paintToggle(el);
    });
  }
  onPrefChange(refreshToggles);

  function mountToggles() {
    const doc = root.document;
    if (!doc) return;
    doc.querySelectorAll('[data-money-toggle]').forEach(slot => { if (!slot.firstElementChild) slot.appendChild(toggleEl(slot.dataset.unit)); });
  }
  if (root.document) {
    const boot = () => {
      mountToggles();
      if (root.MutationObserver) new root.MutationObserver(mountToggles).observe(root.document.body, { childList: true, subtree: true });
    };
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot); else boot();
  }

  // Nice step in units for presets/slider labels, by blind size and mode (display helper, no global state).
  function niceStep(bb, mode) {
    if (mode !== 'usd') return 1;
    const b = Number(bb) || 100;
    if (b >= 2000) return 100;
    if (b >= 100) return 25;
    return 5;
  }

  root.Money = {
    format, plain, parse, modeFor, setPref, onPrefChange, toggleEl, mountToggles, refreshToggles, niceStep,
    get pref() { return pref; },
    set onSave(fn) { onSave = fn; },
    get onSave() { return onSave; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
