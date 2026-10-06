'use strict';
// AmountInput (v2): the NUMBER is the truth, the text is a view of it.
//
//   const f = AmountInput({ units, min, max, unit, presets, scale: 'ladder'|'raise', bb, onCommit, onChange,
//                           label, rangeLabel, allIn, doc })
//   f.el            root element to mount
//   f.value()       integer units, or null when the text is invalid / out of range / empty
//   f.set(units, {source})   external update. The TEXT is left alone while the box is dirty and focused
//                   (or dirty with an error); the slider, labels and units still follow.
//   f.setBounds({min, max, presets, allIn})   server-sent bounds changed (new game_state)
//   f.submit()      validate -> (all-in confirm) -> onCommit(units). Returns true when onCommit ran.
//   f.mode()        'usd' | 'chips' for this field (Money.modeFor(Money.pref, unit))
//   f.destroy()
//
// Never clamps-and-sends: an out-of-range or unparsable text gives value() === null plus a visible message.
// A mode change re-renders the text FROM units; it never re-parses the text (the 100x bug class).
(function (root) {
  const M = () => root.Money;

  // ---- slider stops: always contain min, max and every in-range preset; sorted, unique, inside [min, max].
  function buildStops(o) {
    const min = Math.round(o.min), max = Math.round(o.max);
    if (!(max >= min)) return [];
    const set = new Set([min, max]);
    (o.presets || []).forEach(p => { const u = Math.round(p.units); if (u >= min && u <= max) set.add(u); });
    if (o.scale === 'raise') {
      const bb = Math.max(1, Math.round(o.bb || 1));
      const ten = bb * 10;
      for (let v = Math.ceil(min / bb) * bb; v <= Math.min(max, ten); v += bb) if (v >= min) set.add(v);
      logStops(set, Math.max(min, Math.min(max, ten)), max, 24, min, max);
    } else {
      logStops(set, Math.max(1, min), max, 60, min, max);
    }
    return Array.from(set).filter(v => v >= min && v <= max).sort((a, b) => a - b);
  }
  function logStops(set, lo, hi, n, min, max) {
    lo = Math.max(1, lo);
    if (hi <= lo) return;
    for (let i = 1; i < n; i++) {
      const raw = lo * Math.pow(hi / lo, i / n);
      const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(raw)) - 1));
      let v = Math.round(raw / p) * p;
      if (v >= 100) v = Math.round(v / 100) * 100;
      if (v > min && v < max) set.add(v);
    }
  }

  // presets: in-range only (never clamped silently), duplicates merged by units, the one equal to max is "All-in".
  function cleanPresets(list, min, max) {
    const byUnits = new Map();
    (list || []).forEach(p => {
      const u = Math.round(Number(p.units));
      if (!Number.isFinite(u) || u < min || u > max) return;
      const label = u === max ? 'All-in' : p.label;
      const prev = byUnits.get(u);
      if (!prev) byUnits.set(u, { label, units: u });
      else if (u === max) prev.label = 'All-in';
    });
    return Array.from(byUnits.values()).sort((a, b) => a.units - b.units);
  }

  function AmountInput(opts) {
    opts = opts || {};
    const doc = opts.doc || root.document;
    const unit = opts.unit;
    const scale = opts.scale === 'raise' ? 'raise' : 'ladder';
    let min = Math.round(opts.min), max = Math.round(opts.max);
    let rawPresets = opts.presets || [];
    let presets = [];
    let stops = [];
    let allInUnits = opts.allIn === undefined ? (scale === 'raise' ? max : null) : opts.allIn;
    let units = Number.isFinite(opts.units) ? Math.round(opts.units) : null; // last valid value = the truth
    let text = '';
    let dirty = false, focused = false, destroyed = false, seenConnected = false;
    let msg = '', confirmOpen = false, fromAllInPreset = false;
    const label = opts.label || 'Amount';
    const rangeLabel = opts.rangeLabel || label;

    const mk = (tag, cls, attrs) => {
      const e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (attrs) Object.keys(attrs).forEach(k => e.setAttribute(k, attrs[k]));
      return e;
    };
    const el = mk('div', 'amt');
    const row = mk('div', 'amt-row');
    const sym = mk('span', 'amt-sym');
    const input = mk('input', 'amt-text', { type: 'text', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', 'aria-label': label, enterkeyhint: 'done' });
    const suffix = mk('span', 'amt-suffix');
    const slider = mk('input', 'amt-slider', { type: 'range', step: '1', 'aria-label': label + ' slider' });
    const ends = mk('div', 'amt-ends');
    const endMin = mk('span', 'amt-min'), endMax = mk('span', 'amt-max');
    const presetBox = mk('div', 'amt-presets');
    const msgEl = mk('div', 'amt-msg', { role: 'alert', 'aria-live': 'polite' });
    const confirmEl = mk('div', 'amt-confirm');
    const confirmTxt = mk('span', 'amt-confirm-txt');
    const confirmYes = mk('button', 'amt-confirm-yes', { type: 'button' });
    const confirmNo = mk('button', 'amt-confirm-no', { type: 'button' });
    confirmYes.textContent = 'All-in';
    confirmNo.textContent = 'Cancel';
    confirmEl.append(confirmTxt, confirmYes, confirmNo);
    confirmEl.hidden = true; confirmEl.classList.add('hidden');
    row.append(sym, input, suffix);
    ends.append(endMin, endMax);
    el.append(row, slider, ends, presetBox, msgEl, confirmEl);

    const mode = () => M().modeFor(M().pref, unit);
    const fmt = (u, o) => M().format(u, mode(), o);
    const inRange = u => Number.isFinite(u) && u >= min && u <= max;

    function rangeMsg() {
      if (min === max) return rangeLabel + ' must be ' + fmt(min) + '.';
      return rangeLabel + ' is ' + fmt(min) + ' to ' + fmt(max) + '.';
    }

    function setMsg(m) {
      msg = m || '';
      msgEl.textContent = msg;
      el.classList.toggle('amt-bad', !!msg);
      input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    }

    // text <- units. Never the other way around except from the user's own typing.
    function renderText() {
      const m = mode();
      input.setAttribute('inputmode', m === 'usd' ? 'decimal' : 'numeric');
      sym.textContent = m === 'usd' ? '$' : '';
      suffix.textContent = m === 'usd' ? '' : 'chips';
      text = units === null ? '' : M().plain(units, m);
      input.value = text;
    }
    function renderChrome() {
      stops = buildStops({ min, max, presets: rawPresets, scale, bb: opts.bb });
      presets = cleanPresets(rawPresets, min, max);
      slider.min = '0';
      slider.max = String(Math.max(0, stops.length - 1));
      slider.disabled = stops.length < 2;
      endMin.textContent = fmt(min);
      endMax.textContent = allInUnits === max ? 'All-in ' + fmt(max) : fmt(max);
      renderPresets();
      syncSlider();
    }
    function renderPresets() {
      while (presetBox.firstChild) presetBox.removeChild(presetBox.firstChild);
      presets.forEach(p => {
        const b = mk('button', 'amt-pre' + (p.units === allInUnits && p.label === 'All-in' ? ' amt-pre-allin' : ''), { type: 'button', 'data-units': String(p.units) });
        const l = mk('span', 'amt-pre-l'); l.textContent = p.label;
        const v = mk('b', 'amt-pre-v'); v.textContent = fmt(p.units);
        b.append(l, v);
        b.addEventListener('click', () => { userSet(p.units, p.label === 'All-in' && p.units === max ? 'preset-allin' : 'preset'); });
        presetBox.appendChild(b);
      });
    }
    function nearestIdx(u) {
      let bi = 0, bd = Infinity;
      stops.forEach((s, i) => { const d = Math.abs(s - u); if (d < bd) { bd = d; bi = i; } });
      return bi;
    }
    function syncSlider() {
      if (!stops.length) return;
      const u = units === null ? min : units;
      slider.value = String(nearestIdx(u));
      slider.setAttribute('aria-valuetext', fmt(inRange(u) ? u : min));
    }

    function closeConfirm() { confirmOpen = false; confirmEl.hidden = true; confirmEl.classList.add('hidden'); }
    function emitChange() { if (typeof opts.onChange === 'function') { try { opts.onChange(value(), api); } catch (e) {} } }

    function value() {
      if (dirty) {
        const r = M().parse(input.value, mode());
        return r.ok && inRange(r.units) ? r.units : null;
      }
      return units !== null && inRange(units) ? units : null;
    }

    // user-driven change of the number (slider, preset, arrows): text follows, never dirty.
    function userSet(u, source) {
      u = Math.round(u);
      fromAllInPreset = source === 'preset-allin';
      closeConfirm();
      dirty = false;
      units = u;
      setMsg(inRange(u) ? '' : rangeMsg());
      renderText(); syncSlider(); emitChange();
    }

    // ---- external update. Text untouched while focused+dirty (S1-2); slider/labels/units still follow.
    function set(u, o) {
      o = o || {};
      u = Number.isFinite(u) ? Math.round(u) : null;
      const textLocked = dirty && (focused || msg !== '');
      if (!textLocked) {
        dirty = false;
        units = u;
        if (o.source !== 'preset-allin') fromAllInPreset = false;
        setMsg(u === null || inRange(u) ? '' : rangeMsg());
        renderText();
      } else if (u !== null && inRange(u)) {
        units = u; // last good value follows; the typed text is the user's until blur/submit
      }
      syncSlider(); emitChange();
    }

    function setBounds(b) {
      b = b || {};
      if (b.min !== undefined) min = Math.round(b.min);
      if (b.max !== undefined) max = Math.round(b.max);
      if (b.presets) rawPresets = b.presets;
      if (b.allIn !== undefined) allInUnits = b.allIn; else if (scale === 'raise') allInUnits = max;
      renderChrome();
      const textLocked = dirty && (focused || msg !== '');
      if (!textLocked && units !== null && !inRange(units)) {
        // bounds moved under a value the user did not type: show the nearest legal value visibly
        units = Math.min(max, Math.max(min, units));
        renderText(); syncSlider();
      }
      if (dirty) validateText(); else syncSlider();
      emitChange();
    }

    function validateText() {
      const r = M().parse(input.value, mode());
      if (r.ok) {
        if (inRange(r.units)) { units = r.units; setMsg(''); syncSlider(); }
        else setMsg(rangeMsg());
      } else {
        setMsg(r.error === 'empty' ? '' : r.hint);
      }
    }

    input.addEventListener('focus', () => { focused = true; });
    input.addEventListener('input', () => {
      dirty = true; fromAllInPreset = false; closeConfirm();
      validateText(); emitChange();
    });
    input.addEventListener('blur', () => {
      focused = false;
      if (!dirty) return;
      const r = M().parse(input.value, mode());
      if (r.ok && inRange(r.units)) { dirty = false; units = r.units; setMsg(''); renderText(); syncSlider(); }
      else if (!r.ok && r.error === 'empty') { setMsg(rangeMsg()); }
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      else if (e.key === 'Escape' && dirty) { dirty = false; setMsg(''); renderText(); emitChange(); }
    });

    slider.addEventListener('input', () => {
      const i = Math.round(Number(slider.value));
      if (stops[i] !== undefined) userSet(stops[i], 'slider');
    });
    slider.addEventListener('keydown', e => {
      if (!stops.length) return;
      const cur = units === null ? min : units;
      const next = () => stops.find(s => s > cur);
      const prev = () => { for (let i = stops.length - 1; i >= 0; i--) if (stops[i] < cur) return stops[i]; };
      let t;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') t = next();
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') t = prev();
      else if (e.key === 'Home') t = stops[0];
      else if (e.key === 'End') t = stops[stops.length - 1];
      else return;
      e.preventDefault();
      if (t !== undefined) userSet(t, 'slider');
    });

    function needsConfirm() {
      const v = value();
      return v !== null && allInUnits !== null && v === allInUnits && !fromAllInPreset;
    }
    function askConfirm() {
      confirmTxt.textContent = 'That is your whole stack (' + fmt(allInUnits) + '). Go all-in?';
      confirmOpen = true; confirmEl.hidden = false; confirmEl.classList.remove('hidden');
    }
    confirmYes.addEventListener('click', () => { closeConfirm(); fromAllInPreset = true; submit(); });
    confirmNo.addEventListener('click', () => { closeConfirm(); });

    // submit: the only place onCommit fires. Invalid -> message + false. Whole stack not from the All-in preset -> confirm row + false.
    function submit() {
      let v = value();
      if (v === null) {
        const r = M().parse(input.value, mode());
        setMsg(r.ok ? rangeMsg() : (r.error === 'empty' ? rangeMsg() : r.hint));
        return false;
      }
      if (dirty) { dirty = false; units = v; renderText(); syncSlider(); }
      if (needsConfirm()) { askConfirm(); return false; }
      closeConfirm();
      if (typeof opts.onCommit === 'function') opts.onCommit(v, api);
      return true;
    }

    // mode (pref) change: re-render text FROM units, never re-parse.
    const off = M().onPrefChange(() => {
      if (destroyed) return;
      if (el.isConnected === true) seenConnected = true;
      else if (el.isConnected === false && seenConnected) { destroy(); return; }
      if (dirty) { // keep the last valid number; discard the half-typed text instead of re-reading it in the new unit
        const r = M().parse(input.value, lastMode);
        if (r.ok && inRange(r.units)) units = r.units;
        dirty = false;
      }
      setMsg(units === null || inRange(units) ? '' : rangeMsg());
      lastMode = mode();
      renderText(); renderChrome();
      if (confirmOpen) askConfirm();
      emitChange();
    });
    let lastMode = mode();

    function destroy() { destroyed = true; try { off(); } catch (e) {} }

    const api = {
      el, input, slider,
      value, set, setBounds, submit, destroy, mode,
      needsConfirm,
      message: () => msg,
      stops: () => stops.slice(),
      presets: () => presets.map(p => ({ label: p.label, units: p.units })),
      bounds: () => ({ min, max }),
      text: () => input.value,
      isDirty: () => dirty,
      focus: () => { try { input.focus(); } catch (e) {} },
    };

    if (units !== null && !inRange(units)) units = Math.min(max, Math.max(min, units));
    renderText(); renderChrome(); setMsg('');
    return api;
  }

  AmountInput.buildStops = buildStops;
  AmountInput.cleanPresets = cleanPresets;
  root.AmountInput = AmountInput;
})(typeof window !== 'undefined' ? window : globalThis);
