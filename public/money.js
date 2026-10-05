'use strict';
(function (root) {
  const KEY = 'ping.currency';
  const store = () => { try { return root.localStorage || null; } catch (e) { return null; } };
  let pref = 'auto';
  let unit = 'chips';
  const subs = [];
  let onSave = null;

  try { const v = store() && store().getItem(KEY); if (v === 'usd' || v === 'chips' || v === 'auto') pref = v; } catch (e) {}

  function effective() { return pref === 'auto' ? (unit === 'cents' ? 'usd' : 'chips') : pref; }

  function emit() { const m = effective(); subs.slice().forEach(fn => { try { fn(m); } catch (e) {} }); }

  function group(n) { return Math.abs(n).toLocaleString('en-US'); }

  function fmt(units, opts) {
    opts = opts || {};
    const n = Number(units);
    if (units === null || units === undefined || units === '' || !isFinite(n)) return '-';
    const u = opts.unit || unit;
    const mode = opts.mode || effective();
    const sym = opts.symbol !== false;
    const neg = n < 0;
    const sign = neg ? '-' : (opts.signed && n > 0 ? '+' : '');
    let v = u === 'cents' ? (mode === 'usd' ? n / 100 : n) : n;
    const dollars = mode === 'usd';
    const a = Math.abs(v);
    let body;
    if (opts.compact && a >= (typeof opts.compact === 'number' ? opts.compact : 10000)) {
      const k = a >= 1e6 ? a / 1e6 : a / 1e3;
      const suf = a >= 1e6 ? 'M' : 'K';
      body = (Math.round(k * 10) / 10).toString().replace(/\.0$/, '') + suf;
    } else if (dollars && u === 'cents' && Math.round(n) % 100 !== 0) {
      body = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } else {
      body = group(Math.round(v));
    }
    return sign + (dollars && sym ? '$' : '') + body;
  }

  function parse(text, opts) {
    opts = opts || {};
    if (text === null || text === undefined) return null;
    const t = String(text).trim().replace(/[$,\s]/g, '');
    if (!/^-?\d*\.?\d+$|^-?\d+\.$/.test(t)) return null;
    const v = parseFloat(t);
    if (!isFinite(v)) return null;
    const u = opts.unit || unit;
    const mode = opts.mode || effective();
    return (u === 'cents' && mode === 'usd') ? Math.round(v * 100) : Math.round(v);
  }

  function setMode(m, silent) {
    if (m !== 'usd' && m !== 'chips' && m !== 'auto') return;
    const before = effective();
    pref = m;
    try { store() && store().setItem(KEY, m); } catch (e) {}
    if (!silent && typeof onSave === 'function') { try { onSave(m); } catch (e) {} }
    if (effective() !== before || m !== 'auto') emit();
  }

  function setUnit(u) {
    if (u !== 'cents' && u !== 'chips') return;
    if (u === unit) return;
    const before = effective();
    unit = u;
    if (effective() !== before) emit();
  }

  function onChange(fn) {
    subs.push(fn);
    return function () { const i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
  }

  const toggles = [];
  function paintToggle(el) {
    const m = effective();
    el.setAttribute('aria-pressed', m === 'usd' ? 'true' : 'false');
    el.dataset.mode = m;
    el.querySelectorAll('i').forEach(i => i.classList.toggle('on', i.dataset.m === m));
  }
  function toggleEl() {
    const doc = root.document;
    const el = doc.createElement('button');
    el.type = 'button';
    el.className = 'money-toggle';
    el.title = 'Switch between dollars and chips';
    el.innerHTML = '<i data-m="usd">$</i><i data-m="chips">chips</i>';
    el.addEventListener('click', () => setMode(effective() === 'usd' ? 'chips' : 'usd'));
    paintToggle(el);
    toggles.push(el);
    return el;
  }
  onChange(() => toggles.forEach(paintToggle));

  function mountToggles() {
    const doc = root.document;
    if (!doc) return;
    doc.querySelectorAll('[data-money-toggle]').forEach(slot => { if (!slot.firstElementChild) slot.appendChild(toggleEl()); });
  }
  if (root.document) {
    const boot = () => {
      mountToggles();
      if (root.MutationObserver) new root.MutationObserver(mountToggles).observe(root.document.body, { childList: true, subtree: true });
    };
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', boot); else boot();
  }

  // nice step in units for slider/presets: 25 cents-mode (quarters), 1 in chips
  function niceStep(bb) {
    if (unit !== 'cents') return 1;
    const b = Number(bb) || 100;
    if (b >= 2000) return 100;
    if (b >= 100) return 25;
    return 5;
  }

  root.Money = {
    fmt, parse, setMode, setUnit, onChange, toggleEl, mountToggles, niceStep,
    getMode: effective,
    getPref: () => pref,
    getUnit: () => unit,
    set onSave(fn) { onSave = fn; },
    get onSave() { return onSave; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
