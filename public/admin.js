'use strict';
// Floating admin console for the owner. The button and panel only exist for an isAdmin account; the server re-checks every event.
(function () {
  const POS_KEY = 'ping.adminfab';
  const CORNERS = ['bl', 'br', 'tl', 'tr'];
  let fab = null, veil = null, tab = 'bank', overview = null, pollT = null, editing = null;
  const $ = id => document.getElementById(id);
  const sock = () => window.PingSocket || null;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isAdmin = () => { try { const u = window.Lobby && Lobby.user && Lobby.user(); return !!(u && u.isAdmin); } catch (e) { return false; } };
  const num = n => (n === null || n === undefined ? '–' : (window.Money ? Money.fmt(n) : Math.round(n).toLocaleString('en-US')));
  const money = n => (window.Money ? Money.fmt(n) : String(n));
  const ago = t => {
    if (!t) return 'never';
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 90) return 'just now';
    if (s < 5400) return Math.round(s / 60) + ' min ago';
    if (s < 129600) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  };

  function status(msg, kind) {
    const el = $('adm-status'); if (!el) return;
    el.textContent = msg || ''; el.className = 'adm-status' + (kind ? ' ' + kind : '');
  }

  // ── floating button ──
  function placeFab(c) { fab.dataset.c = CORNERS.includes(c) ? c : 'bl'; fab.style.left = fab.style.right = fab.style.top = fab.style.bottom = ''; }
  function makeFab() {
    if (fab) return;
    fab = document.createElement('button');
    fab.type = 'button'; fab.id = 'adm-fab'; fab.className = 'adm-fab'; fab.title = 'Admin console'; fab.setAttribute('aria-label', 'Admin console');
    fab.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 6h18M3 12h18M3 18h18"/><path d="M8 3.500v5M16 9.500v5M10 15.500v5" stroke-width="3.200"/></svg>';
    let saved = 'bl'; try { saved = localStorage.getItem(POS_KEY) || 'bl'; } catch (e) { /* ignore */ }
    placeFab(saved);
    let d = null;
    fab.addEventListener('pointerdown', e => { d = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId }; try { fab.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ } });
    fab.addEventListener('pointermove', e => {
      if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) { d.moved = true; fab.classList.add('drag'); }
      if (d.moved) { fab.dataset.c = ''; fab.style.right = fab.style.bottom = ''; fab.style.left = (e.clientX - 22) + 'px'; fab.style.top = (e.clientY - 22) + 'px'; }
    });
    const end = e => {
      if (!d) return;
      const was = d; d = null; fab.classList.remove('drag');
      if (was.moved) {
        const c = (e.clientY < innerHeight / 2 ? 't' : 'b') + (e.clientX < innerWidth / 2 ? 'l' : 'r');
        placeFab(c); try { localStorage.setItem(POS_KEY, c); } catch (er) { /* ignore */ }
        fab.dataset.justDragged = '1'; setTimeout(() => { delete fab.dataset.justDragged; }, 0);
      }
    };
    fab.addEventListener('pointerup', end); fab.addEventListener('pointercancel', end);
    fab.addEventListener('click', () => { if (fab.dataset.justDragged) return; veil && veil.classList.contains('on') ? closePanel() : openPanel(); });
    document.body.appendChild(fab);
  }
  function dropFab() {
    closePanel();
    if (fab) { fab.remove(); fab = null; }
    if (veil) { veil.remove(); veil = null; }
    overview = null;
  }

  // ── panel ──
  function makePanel() {
    if (veil) return;
    veil = document.createElement('div');
    veil.className = 'adm-veil'; veil.id = 'adm-veil';
    veil.innerHTML = `<section class="adm-dlg" role="dialog" aria-label="Admin console">
      <div class="adm-head">
        <div class="adm-title">THE <em>BANK</em> &middot; ADMIN</div>
        <div class="adm-tabs">
          <button type="button" class="adm-tab" data-t="bank">Bank</button>
          <button type="button" class="adm-tab" data-t="accounts">Accounts</button>
          <button type="button" class="adm-tab" data-t="table">Table</button>
        </div>
        <div class="adm-status" id="adm-status" role="status" aria-live="polite"></div>
        <button type="button" class="adm-x" id="adm-x" aria-label="Close admin console">&#x2715;</button>
      </div>
      <div class="adm-body">
        <div class="adm-pane" data-p="bank"><div class="adm-bankhost" id="adm-bankhost"></div></div>
        <div class="adm-pane" data-p="accounts"><div class="adm-scroll" id="adm-accounts"></div></div>
        <div class="adm-pane" data-p="table"><div class="adm-scroll" id="adm-table"></div></div>
      </div></section>`;
    document.body.appendChild(veil);
    veil.addEventListener('mousedown', e => { if (e.target === veil) closePanel(); });
    veil.querySelector('#adm-x').addEventListener('click', closePanel);
    veil.querySelectorAll('.adm-tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.t)));
    veil.addEventListener('keydown', e => e.stopPropagation());
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !veil.classList.contains('on')) return;
      e.stopPropagation();
      if (editing) { editing = null; renderAccounts(); } else closePanel();
    }, true);
    veil.addEventListener('keyup', e => e.stopPropagation());
    veil.addEventListener('keypress', e => e.stopPropagation());
  }
  function openPanel() {
    if (!isAdmin()) return;
    makePanel();
    veil.classList.add('on'); fab && fab.classList.add('on');
    status('');
    setTab(tab);
    refresh();
    clearInterval(pollT); pollT = setInterval(refresh, 4000);
  }
  function closePanel() {
    clearInterval(pollT); pollT = null; editing = null;
    if (window.BankPanel) BankPanel.mount(null);
    if (veil) veil.classList.remove('on');
    if (fab) fab.classList.remove('on');
  }
  function setTab(t) {
    tab = t; editing = null;
    veil.querySelectorAll('.adm-tab').forEach(b => b.classList.toggle('on', b.dataset.t === t));
    veil.querySelectorAll('.adm-pane').forEach(p => p.classList.toggle('on', p.dataset.p === t));
    if (window.BankPanel) {
      if (t === 'bank') requestAnimationFrame(() => BankPanel.mount($('adm-bankhost')));
      else BankPanel.mount(null);
    }
    renderAccounts(); renderTable();
  }
  function refresh() { const s = sock(); if (s && isAdmin()) s.emit('admin_overview', {}); }

  // ── accounts ──
  function renderAccounts() {
    const host = $('adm-accounts'); if (!host || tab !== 'accounts') return;
    if (!overview) { host.innerHTML = '<div class="adm-empty">Loading</div>'; return; }
    const rows = overview.accounts.map(a => {
      const k = esc(a.key);
      let acts;
      if (editing && editing.key === a.key && editing.kind === 'bal') {
        acts = `<input class="adm-in" id="adm-edit" type="text" inputmode="decimal" value="${esc(window.Money ? Money.fmt(editing.value, { symbol: false }).replace(/,/g, '') : editing.value)}" aria-label="New total for ${esc(a.display)}">
          <button type="button" class="adm-btn pri" data-a="bal-ok">Save</button><button type="button" class="adm-btn" data-a="cancel">Cancel</button>`;
      } else if (editing && editing.key === a.key && editing.kind === 'play') {
        acts = `<input class="adm-in" id="adm-edit" type="text" inputmode="decimal" value="${esc(String((editing.value || 0) / 100))}" aria-label="New Play dollars for ${esc(a.display)}">
          <button type="button" class="adm-btn pri" data-a="play-ok">Save</button><button type="button" class="adm-btn" data-a="cancel">Cancel</button>`;
      } else if (editing && editing.key === a.key && editing.kind === 'pin') {
        acts = `<input class="adm-in pin" id="adm-edit" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password" placeholder="New PIN" aria-label="New PIN for ${esc(a.display)}">
          <button type="button" class="adm-btn pri" data-a="pin-ok">Reset PIN</button><button type="button" class="adm-btn" data-a="cancel">Cancel</button>`;
      } else {
        acts = `<button type="button" class="adm-btn" data-a="bal">Set chips</button><button type="button" class="adm-btn" data-a="play">Set Play $</button><button type="button" class="adm-btn" data-a="pin">Reset PIN</button>`;
      }
      return `<tr data-k="${k}"><td class="nm"><span class="adm-dot${a.online ? ' on' : ''}" title="${a.online ? 'Connected now' : 'Offline'}"></span><b>${esc(a.display)}</b>${a.isAdmin ? '<i>Owner</i>' : ''}${a.claimed ? '' : '<i>Unclaimed</i>'}</td>
        <td>${a.online ? 'online now' : ago(a.lastSeen)}</td><td class="n adm-bal">${num(a.balance)}</td><td class="n adm-play">${a.play == null ? "--" : "$" + (a.play / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td class="n"><div class="adm-acts">${acts}</div></td></tr>`;
    }).join('');
    host.innerHTML = `<table class="adm-tbl" id="adm-acct-tbl"><thead><tr><th>Player</th><th>Last seen</th><th class="n">Chips (total)</th><th class="n">Play $</th><th class="n">Actions</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="adm-empty" style="padding:14px 0 0;text-align:left">Chips (total) is bank plus whatever is at the table. Play $ is the wallet used by the slot and Play tables. Players see changes instantly. Deleting accounts is not offered here: a player's money, history and table seats are tied together, so it needs a deliberate cleanup.</p>`;
    host.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => onAcct(b)));
    const inp = $('adm-edit');
    if (inp) {
      inp.focus(); inp.select && inp.select();
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') { const ok = host.querySelector('[data-a$="-ok"]'); ok && ok.click(); } });
    }
  }
  function onAcct(b) {
    const tr = b.closest('tr'), key = tr.dataset.k, a = overview.accounts.find(x => x.key === key);
    const act = b.dataset.a, s = sock();
    if (act === 'bal') { editing = { key, kind: 'bal', value: a.balance || 0 }; renderAccounts(); }
    else if (act === 'play') { editing = { key, kind: 'play', value: a.play || 0 }; renderAccounts(); }
    else if (act === 'pin') { editing = { key, kind: 'pin' }; renderAccounts(); }
    else if (act === 'cancel') { editing = null; renderAccounts(); }
    else if (act === 'bal-ok') {
      const total = window.Money ? Money.parse($('adm-edit').value) : Math.round(Number($('adm-edit').value));
      if (total === null || !Number.isFinite(total) || total < 0 || total > 100000000) { status('Enter an amount from 0 to ' + money(100000000), 'err'); return; }
      if (!window.confirm('Set ' + a.display + "'s total money to " + money(total) + '?')) return;
      editing = null; status('Saving');
      s.emit('bank_set', { name: a.display, balance: total });
      pendingBal = { key, total };
      setTimeout(refresh, 350);
    } else if (act === 'play-ok') {
      const dollars = parseFloat(String($('adm-edit').value).replace(/[$,\s]/g, ''));
      if (!Number.isFinite(dollars) || dollars < 0 || dollars > 1000000000) { status('Enter Play $ from 0 to 1,000,000,000', 'err'); return; }
      const cents = Math.round(dollars * 100);
      if (!window.confirm('Set ' + a.display + "'s Play $ to $" + (cents / 100).toLocaleString('en-US') + '?')) return;
      editing = null; status('Saving');
      s.emit('admin_set_play', { key, cents });
      setTimeout(refresh, 350);
    } else if (act === 'pin-ok') {
      const pin = $('adm-edit').value;
      if (!/^\d{4,6}$/.test(pin)) { status('PIN is 4-6 digits', 'err'); return; }
      if (!window.confirm('Reset ' + a.display + "'s PIN? Their other sessions will be signed out.")) return;
      editing = null; status('Saving');
      s.emit('admin_reset_pin', { key, newPin: pin });
    }
  }
  let pendingBal = null;

  // ── table ──
  const plainAmt = n => (window.Money ? window.Money.fmt(n, { symbol: false }).replace(/,/g, '') : String(n));
  function renderTable() {
    const host = $('adm-table'); if (!host || tab !== 'table') return;
    const t = overview && overview.table;
    if (!t) { host.innerHTML = '<div class="adm-empty">Loading</div>'; return; }
    const keepStack = $('adm-stack') ? $('adm-stack').value : null;
    const last = Number(localStorage.getItem('pp-reset-stack')) || t.startChips || 1500;
    host.innerHTML = `<div class="adm-card"><h3>Main table</h3>
        <p><span class="adm-tag ${t.paused ? 'paused' : 'live'}">${t.paused ? 'Paused' : 'Running'}</span> &nbsp; ${t.seated} seated &middot; ${t.handNum} hands &middot; ${esc(t.status || '')}</p>
        <div class="adm-row"><button type="button" class="adm-btn pri" id="adm-pause">${t.paused ? 'Resume table' : 'Pause table'}</button></div></div>
      <div class="adm-card"><h3>Reset table</h3>
        <p>Cancels the current hand, refunds bets, and sets everyone's total money to the starting stack. The table must be paused first.</p>
        <div class="adm-row"><input class="adm-in" id="adm-stack" type="number" min="200" step="1" value="${keepStack || last}" aria-label="Starting stack">
        <button type="button" class="adm-btn danger" id="adm-reset" ${t.paused ? '' : 'disabled'}>Reset table</button></div></div>
      <div class="adm-card"><h3>Blinds</h3>
        <p>Now ${esc(money(t.sb))} / ${esc(money(t.bb))}${t.nextBb ? ' &middot; next hand ' + esc(money(t.nextSb)) + ' / ' + esc(money(t.nextBb)) : ''}. Changes made mid-hand start on the next hand.</p>
        <div class="adm-row"><input class="adm-in" id="adm-sb" type="text" inputmode="decimal" value="${esc(plainAmt(t.nextSb || t.sb))}" aria-label="Small blind"> /
        <input class="adm-in" id="adm-bb" type="text" inputmode="decimal" value="${esc(plainAmt(t.nextBb || t.bb))}" aria-label="Big blind">
        <button type="button" class="adm-btn pri" id="adm-blinds">Set blinds</button></div></div>`;
    $('adm-blinds').addEventListener('click', () => {
      const M = window.Money, prevUnit = M && M.getUnit ? M.getUnit() : null; if (M && M.setUnit) M.setUnit('chips');
      const sb = M ? M.parse($('adm-sb').value) : Math.round(Number($('adm-sb').value)), bb = M ? M.parse($('adm-bb').value) : Math.round(Number($('adm-bb').value));
      if (prevUnit) M.setUnit(prevUnit);
      if (!(sb >= 1) || !(bb >= 2)) { status('Enter both blinds', 'err'); return; }
      if (sb >= bb) { status('Small blind must be less than the big blind', 'err'); return; }
      status('Working'); sock().emit('table_update', { tableId: 'POKERPING', patch: { blinds: { sb, bb } } });
      setTimeout(() => { status('Blinds set to ' + money(sb) + ' / ' + money(bb) + (t.status === 'playing' ? ', from the next hand' : ''), 'ok'); refresh(); }, 400);
    });
    $('adm-pause').addEventListener('click', () => { status('Working'); sock().emit('set_pause', { paused: !t.paused }); setTimeout(refresh, 350); });
    $('adm-reset').addEventListener('click', () => {
      const amount = Math.floor(Number($('adm-stack').value));
      if (!Number.isFinite(amount) || amount < 200) { status('Enter a whole number of chips, 200 or more', 'err'); return; }
      if (!window.confirm('Reset the table to ' + amount.toLocaleString('en-US') + ' chips each? The hand is cancelled.')) return;
      localStorage.setItem('pp-reset-stack', String(amount));
      status('Working'); sock().emit('reset_table', { amount }); setTimeout(refresh, 450);
    });
  }

  // ── socket ──
  let bound = null;
  function bind() {
    const s = sock();
    if (!s || bound === s) return;
    bound = s;
    s.on('admin_overview', o => {
      overview = o;
      if (pendingBal) {
        const a = o.accounts.find(x => x.key === pendingBal.key);
        if (a && a.balance === pendingBal.total) status('Money set for ' + a.display, 'ok');
        pendingBal = null;
      }
      if (!editing) { renderAccounts(); renderTable(); }
    });
    s.on('admin_result', r => {
      if (!r) return;
      status(r.message || (r.ok ? 'Done' : 'Failed'), r.ok ? 'ok' : 'err');
    });
    s.on('error', e => { if (veil && veil.classList.contains('on') && e && e.message) { status(e.message, 'err'); pendingBal = null; } });
    s.on('auth_out', dropFab);
  }

  function tick() {
    bind();
    if (isAdmin()) makeFab(); else if (fab || veil) dropFab();
  }
  window.AdminConsole = { open: openPanel, close: closePanel };
  function init() { tick(); setInterval(tick, 700); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
