'use strict';
// Bank dashboard. Self-contained; reads game.js globals (state, avatarInner, esc) and listens on state.socket.
(function () {
  const COLORS = ['#F5B942', '#4FB3B0', '#7FBF6A', '#C27BB0', '#E8D9B5', '#6E9BD1', '#E2674F', '#D98C5F'];
  const BRASS = '#C99A45', CLAY = '#E2674F';
  const colorMap = new Map();
  const avCache = new Map();
  let data = null, isOpen = false, pollTimer = null, adminHost = null;
  let view = (() => { try { return localStorage.getItem('pp-bank-view') === 'play' ? 'play' : 'chips'; } catch (e) { return 'chips'; } })();
  const isPlay = () => view === 'play';
  // The view (Chips / Cash) can differ from this table's currency: then at-table figures are not zero, they do not exist (S3-4).
  const viewIsTableCurrency = () => ((state.unit === 'cents') === isPlay());
  const startRef = () => (state.gameState && state.gameState.startChips) || 0;

  const $ = id => document.getElementById(id);
  // one id per confirmed click: a resend of the same click carries the same id and the server writes nothing twice (admin_adjust / admin_set_play opId)
  const newOpId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '.' + Math.random().toString(36).slice(2, 12));
  // Mode is per view: the Cash view reads cents, the Chips view reads chips; pref decides $ vs chips for 'auto'.
  const bankMode = () => Money.modeFor(Money.pref, isPlay() ? 'cents' : 'chips');
  const fmt = n => Money.format(n, bankMode());
  const signed = n => Money.format(n, bankMode(), { signed: true }).replace('-', '−');
  const short = n => Money.format(n, bankMode(), { compact: 1000 });
  const U = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u')) || 1;
  const E = s => (typeof esc === 'function' ? esc(s) : String(s));
  const colorOf = name => {
    const k = String(name).toLowerCase();
    if (!colorMap.has(k)) colorMap.set(k, COLORS[colorMap.size % COLORS.length]);
    return colorMap.get(k);
  };
  // Only touch the DOM when the markup actually changed (no flicker, hover/tooltip and scroll survive the 4s refresh).
  const lastHtml = new WeakMap();
  function setHTML(host, html) {
    if (lastHtml.get(host) === html) return false;
    const top = host.scrollTop;
    host.innerHTML = html;
    lastHtml.set(host, html);
    if (top) host.scrollTop = top;
    return true;
  }
  const STATUS = { seated: 'At the table', 'sitting-out': 'Sitting out', away: 'Away', offline: 'Offline' };

  function build() {
    const head = document.querySelector('.g-head');
    const grid = document.querySelector('.g-grid');
    if (!head || !grid || $('bank-btn')) return;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'bank-btn'; btn.className = 'btn btn--secondary btn--sm'; btn.textContent = 'Bank';
    btn.title = 'Bank dashboard (B)';
    const slot = $('bank-slot');
    if (slot) slot.replaceWith(btn);
    else { const chip = $('room-code-btn'); head.insertBefore(btn, chip ? chip.nextSibling : head.children[1]); }
    const pb = document.createElement('div');
    pb.id = 'pause-banner'; pb.className = 'pause-banner hidden';
    pb.innerHTML = '<b>Paused</b><span>The table is on hold</span>';
    grid.appendChild(pb);

    const panel = document.createElement('section');
    panel.id = 'bank-panel'; panel.className = 'bank-panel panel panel--flush'; panel.setAttribute('aria-label', 'Bank');
    panel.innerHTML = `
      <div class="bank-head">
        <div class="bank-title">THE <em>BANK</em></div>
        <div class="bank-sub" id="bank-sub">Buy-ins, balances and chips over time</div>
        <div class="bank-view seg" id="bank-view" role="group" aria-label="Currency"><button type="button" data-v="chips">Chips</button><button type="button" data-v="play">Cash</button></div>
        <div class="bank-total" id="bank-total"></div>
        <button type="button" class="bank-close panel__close" id="bank-close" aria-label="Close bank">&#x2715;</button>
      </div>
      <div class="bank-body">
        <div class="bank-col">
          <div class="bank-card panel panel--flush" style="flex:1"><h3 class="panel__title panel__title--sm">Standings<small id="bank-pcount"></small></h3><div class="bank-players bank-scroll" id="bank-players"></div></div>
        </div>
        <div class="bank-col">
          <div class="bank-card bank-chartcard panel panel--flush"><h3 class="panel__title panel__title--sm" id="bank-chart-title">Chips at the table, hand by hand<small id="bank-hcount"></small></h3><div class="bank-card-body" id="bank-line"></div></div>
          <div class="bank-row2">
            <div class="bank-card panel panel--flush"><h3 class="panel__title panel__title--sm">Total buy-ins<span class="bank-legend"><span><i style="background:${BRASS}"></i>Buy-in</span><span><i style="background:${CLAY}"></i>Rebuys</span></span></h3><div class="bank-card-body" id="bank-bars"></div></div>
            <div class="bank-card panel panel--flush"><h3 class="panel__title panel__title--sm">Activity<small id="bank-ecount"></small></h3><div class="bank-feed bank-scroll" id="bank-feed"></div></div>
          </div>
        </div>
      </div>`;
    grid.appendChild(panel);

    panel.querySelectorAll('#bank-view button').forEach(b => b.addEventListener('click', () => setView(b.dataset.v)));
    paintView();
    btn.addEventListener('click', () => toggle());
    $('bank-close').addEventListener('click', () => toggle(false));
    document.addEventListener('keydown', e => {
      if (adminHost) return;
      if (e.key === 'Escape' && isOpen) toggle(false);
      else if ((e.key === 'b' || e.key === 'B') && !e.ctrlKey && !e.metaKey && !e.altKey && !/INPUT|TEXTAREA/.test((e.target.tagName || ''))) toggle();
    });
    window.addEventListener('resize', () => { if (isOpen) render(); });
    bindTip();
  }

  function paintView() {
    document.querySelectorAll('#bank-view button').forEach(b => b.classList.toggle('on', b.dataset.v === view));
    const t = $('bank-chart-title'); if (t) t.firstChild.nodeValue = (isPlay() ? 'Cash' : 'Chips') + ' at the table, hand by hand';
  }
  function setView(v) {
    if (v !== 'chips' && v !== 'play') return;
    if (v === view) return;
    view = v; try { localStorage.setItem('pp-bank-view', v); } catch (e) {}
    data = null; lineGeo = null;
    ['bank-players', 'bank-line', 'bank-bars', 'bank-feed'].forEach(id => { const el = $(id); if (el) lastHtml.delete(el); });
    paintView(); request(); render();
  }

  function request() {
    if (adminHost) { if (state.socket) state.socket.emit('admin_bank_summary', { view }); return; }
    if (state.socket && state.roomId) state.socket.emit('get_bank_summary', { roomId: state.roomId, view });
  }

  // Admin console hosts the same panel anywhere (no table needed); mount(null) puts it back in the game grid.
  function mount(host) {
    const panel = $('bank-panel'), grid = document.querySelector('.g-grid');
    if (!panel) return false;
    clearInterval(pollTimer);
    if (host) {
      adminHost = host; host.appendChild(panel);
      panel.classList.add('in-admin', 'open'); isOpen = true;
      lastHtml.delete($('bank-players'));
      request(); render(); pollTimer = setInterval(request, 4000);
    } else {
      adminHost = null; isOpen = false;
      panel.classList.remove('in-admin', 'open');
      if (grid) grid.appendChild(panel);
      const b = $('bank-btn'); if (b) b.classList.remove('on');
    }
    return true;
  }
  window.BankPanel = { mount, refresh: () => { if (adminHost) { request(); render(); } } };

  function toggle(force) {
    if (adminHost) return;
    isOpen = force === undefined ? !isOpen : force;
    $('bank-panel').classList.toggle('open', isOpen);
    $('bank-btn').classList.toggle('on', isOpen);
    clearInterval(pollTimer);
    if (isOpen) { request(); render(); pollTimer = setInterval(request, 4000); }
  }

  function rememberAvatars() {
    for (const p of (state.gameState && state.gameState.players) || []) if (p && p.name) avCache.set(p.name.toLowerCase(), { avatar: p.avatar, pic: p.profilePic });
  }

  function avatarFor(name) {
    const a = avCache.get(String(name).toLowerCase());
    if (a && typeof avatarInner === 'function') return avatarInner(a.avatar, a.pic);
    return E(String(name).trim().charAt(0).toUpperCase() || '?');
  }

  function render() {
    if (!data) data = { players: [], series: {}, events: [], maxHand: 0 };
    rememberAvatars();
    data.players.forEach(p => colorOf(p.name));
    renderHead(); renderPlayers(); renderLine(); renderBars(); renderFeed();
  }

  function renderHead() {
    const humans = data.players.filter(p => !p.isBot);
    const bankSum = humans.reduce((s, p) => s + (p.bank || 0), 0);
    const onTable = humans.reduce((s, p) => s + (p.status === 'offline' ? 0 : p.atTable), 0);
    const buy = humans.reduce((s, p) => s + p.totalBuyIns, 0);
    setHTML($('bank-total'),
      `<div class="pl"><label>Total money</label><b>${fmt(bankSum + onTable)}</b></div>` +
      `<div class="pl"><label>${isPlay() ? 'In wallet' : 'In bank'}</label><b>${fmt(bankSum)}</b></div>` +
      `<div class="pl"><label>On the table</label><b>${fmt(onTable)}</b></div>` +
      `<div class="pl"><label>Bought in</label><b>${fmt(buy)}</b></div>` +
      `<div class="pl"><label>Hands</label><b>${data.maxHand || 0}</b></div>`);
  }

  const totalOf = p => (p.bank || 0) + (p.status === 'offline' ? 0 : p.atTable);

  function renderPlayers() {
    const me = state.gameState && state.gameState.players[state.myIdx];
    const meName = me && me.name ? me.name.toLowerCase() : '';
    const u = window.Lobby && Lobby.user && Lobby.user();
    const canEdit = !isPlay() && (meName === 'chris' || !!(u && u.isAdmin));
    if (document.querySelector('#bank-players .bp-edit')) return;
    $('bank-pcount').textContent = data.players.length ? data.players.length + ' players' : '';
    if (!data.players.length) {
      setHTML($('bank-players'), '<div class="bank-card-body"><div class="bank-empty"><b>No players yet</b>Join the table to open a bank account.</div></div>');
      return;
    }
    const changed = setHTML($('bank-players'), data.players.map(p => {
      const off = p.status === 'offline';
      const netCls = p.isBot ? '' : p.net > 0 ? 'pos' : p.net < 0 ? 'neg' : '';
      const sub = [STATUS[p.status] || p.status, p.handsPlayed + ' hand' + (p.handsPlayed === 1 ? '' : 's')];
      const tag = p.isBot ? '<i>House</i>' : (p.name.toLowerCase() === meName ? '<i>You</i>' : '');
      return `<div class="bp panel panel--inset${p.name.toLowerCase() === meName ? ' me' : ''}${off ? ' off' : ''}" style="--pc:${colorOf(p.name)}">
        <div class="bp-avw"><div class="bp-av">${avatarFor(p.name)}</div><span class="bp-dot ${p.status}" title="${STATUS[p.status] || ''}"></span></div>
        <div class="bp-who">${E(p.name)}${tag}</div>
        <div class="bp-sub">${E(sub.join(' · '))}</div>
        <div class="bp-bal"><b>${p.isBot ? '&mdash;' : fmt(totalOf(p))}</b><span>Total</span></div>
        <div class="bp-stats">
          <div><label>${isPlay() ? 'In wallet' : 'In bank'}</label><b${canEdit && !p.isBot ? ` class="editable" data-name="${E(p.name)}" data-bank="${p.bank || 0}" title="Click to adjust this player's bank (sent as a +/- adjustment)"` : ''}>${p.isBot ? '&mdash;' : fmt(p.bank || 0)}</b></div>
          <div><label>At table</label><b>${!viewIsTableCurrency() ? '&ndash;' : fmt(p.status === 'offline' ? 0 : p.atTable)}</b></div>
          <div><label>Net P&amp;L</label><b class="${netCls}">${p.isBot ? '&mdash;' : signed(p.net)}</b></div>
          <div><label>Best win</label><b>${p.isBot ? '&mdash;' : (p.biggestWin ? fmt(p.biggestWin) : '&ndash;')}</b></div>
        </div>
      </div>`;
    }).join(''));
    if (changed) $('bank-players').querySelectorAll('.bp-stats b.editable').forEach(b => b.addEventListener('click', () => editBank(b)));
  }

  // Inline edit of a player's BANK balance (not the total: at-table chips are separate in v2). A compact AmountInput; Enter saves
  // as admin_adjust {delta = typed - shown bank}, Escape or leaving cancels.
  function editBank(b) {
    const name = b.dataset.name;
    const field = AmountInput({ units: Number(b.dataset.bank) || 0, min: 0, max: isPlay() ? 100000000000 : 100000000, unit: isPlay() ? 'cents' : 'chips',
      scale: 'ladder', compact: true, label: 'New bank balance for ' + name, rangeLabel: 'New bank' });
    field.input.classList.add('bp-edit');
    b.replaceWith(field.el); field.focus(); field.input.select();
    let done = false;
    const finish = save => {
      if (done) return;
      if (save) {
        const amount = field.value();
        if (amount === null) { field.submit(); return; } // stays open with the message; nothing is sent
        const shown = Number(b.dataset.bank) || 0, delta = amount - shown;
        if (state.socket && delta !== 0) {
          state.socket.emit('admin_adjust', { key: name, delta, cur: 'chips', reason: 'bank panel edit', opId: newOpId() });
          const row = data && data.players.find(p => p.name.toLowerCase() === name.toLowerCase());
          if (row) row.bank = amount;
        }
      }
      done = true; field.destroy(); field.el.remove(); lastHtml.delete($('bank-players')); request(); render();
    };
    field.input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') { e.stopPropagation(); finish(false); } e.stopPropagation(); });
    field.input.addEventListener('blur', () => setTimeout(() => { if (!done && document.activeElement !== field.input) finish(false); }, 150));
  }

  function niceMax(v) {
    const steps = [100, 200, 500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 8000, 10000, 15000, 20000, 30000, 50000, 100000];
    return steps.find(s => s >= v) || Math.ceil(v / 10000) * 10000;
  }

  function emptyNote(title, text) { return `<div class="bank-empty"><b>${title}</b>${text}</div>`; }

  let lineGeo = null;
  function renderLine() {
    const host = $('bank-line');
    const names = Object.keys(data.series);
    const hands = new Set();
    names.forEach(n => data.series[n].forEach(pt => hands.add(pt[0])));
    $('bank-hcount').textContent = hands.size ? (isPlay() || !startRef() ? '' : 'Dashed line = starting stack \u00b7 ') + hands.size + ' hand' + (hands.size === 1 ? '' : 's') : '';
    if (!hands.size) { lineGeo = null; setHTML(host, !viewIsTableCurrency() ? emptyNote('Not played at this table', 'This table uses ' + (state.unit === 'cents' ? 'Cash' : 'Chips') + '. Switch the view above to see its hands.') : emptyNote('Nothing to plot yet', 'Chips are recorded at the end of every hand. Play one and the lines appear.')); return; }
    const W = host.clientWidth, H = host.clientHeight; if (!W || !H) return;
    const u = U();
    const m = { l: 52 * u, r: 92 * u, t: 16 * u, b: 28 * u };
    const hs = [...hands].sort((a, b) => a - b);
    const x0 = hs[0], x1 = hs[hs.length - 1];
    const span = Math.max(1, x1 - x0);
    let ymax = startRef() || (isPlay() ? 2000 : 1500);
    names.forEach(n => data.series[n].forEach(pt => { ymax = Math.max(ymax, pt[1]); }));
    const step = [250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000, 250000].find(s => ymax * 1.03 / s <= 5) || 500000;
    const yt = Math.ceil(ymax * 1.03 / step);
    ymax = yt * step;
    const X = h => m.l + (hs.length === 1 ? (W - m.l - m.r) / 2 : (h - x0) / span * (W - m.l - m.r));
    const Y = v => m.t + (1 - v / ymax) * (H - m.t - m.b);
    lineGeo = { m, W, H, hs, X, names };

    let g = '';
    for (let i = 0; i <= yt; i++) {
      const v = step * i, y = Y(v);
      g += `<line class="${i ? 'grid' : 'ax'}" x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}"/>`;
      g += `<text x="${m.l - 8 * u}" y="${y + 4 * u}" text-anchor="end">${short(v)}</text>`;
    }
    const xstep = Math.max(1, Math.ceil(hs.length / Math.max(2, Math.floor((W - m.l - m.r) / (46 * u)))));
    hs.forEach((h, i) => {
      if (i % xstep && i !== hs.length - 1) return;
      g += `<text x="${X(h)}" y="${H - m.b + 17 * u}" text-anchor="middle">${h}</text>`;
    });
    g += `<text x="${m.l - 8 * u}" y="${H - m.b + 17 * u}" text-anchor="end" style="letter-spacing:.1em;text-transform:uppercase;font-size:calc(9 * var(--px))">Hand</text>`;
    if (!isPlay() && startRef() && startRef() < ymax) g += `<line class="ref" x1="${m.l}" x2="${W - m.r}" y1="${Y(startRef())}" y2="${Y(startRef())}"/>`;

    const ends = [];
    names.forEach(n => {
      const pts = data.series[n];
      const d = pts.map((pt, i) => (i ? 'L' : 'M') + X(pt[0]).toFixed(1) + ' ' + Y(pt[1]).toFixed(1)).join('');
      const c = colorOf(n);
      g += `<path class="ln" d="${d}" stroke="${c}"/>`;
      if (pts.length <= 40) g += pts.map(pt => `<circle cx="${X(pt[0]).toFixed(1)}" cy="${Y(pt[1]).toFixed(1)}" r="${2.6 * u}" fill="${c}" stroke="#1B120C" stroke-width="1"/>`).join('');
      const last = pts[pts.length - 1];
      ends.push({ n, c, x: X(last[0]), y: Y(last[1]), v: last[1] });
    });
    ends.sort((a, b) => a.y - b.y);
    const gap = 14 * u;
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < gap) ends[i].ly = (ends[i - 1].ly ?? ends[i - 1].y) + gap;
    ends.forEach(e => {
      const ly = e.ly ?? e.y;
      g += `<text class="lab" x="${e.x + 8 * u}" y="${ly + 4 * u}" style="fill:${e.c}">${E(e.n.length > 9 ? e.n.slice(0, 8) + '…' : e.n)} ${short(e.v)}</text>`;
    });
    g += `<line class="cross" id="bank-cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" style="display:none"/>`;
    setHTML(host, `<svg class="bank-chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${isPlay() ? 'Play dollars' : 'Chips'} over hands per player">${g}</svg><div class="bank-tip" id="bank-tip" style="display:none"></div>`);
  }

  function bindTip() {
    const host = $('bank-line');
    host.addEventListener('mousemove', e => {
      if (!lineGeo) return;
      const r = host.getBoundingClientRect(), mx = e.clientX - r.left;
      let best = null, bd = 1e9;
      lineGeo.hs.forEach(h => { const d = Math.abs(lineGeo.X(h) - mx); if (d < bd) { bd = d; best = h; } });
      const tip = $('bank-tip'), cross = $('bank-cross');
      if (best === null || !tip) return;
      const rows = lineGeo.names.map(n => { const pt = data.series[n].find(p => p[0] === best); return pt ? { n, v: pt[1] } : null; }).filter(Boolean).sort((a, b) => b.v - a.v);
      tip.innerHTML = `<b class="h">Hand ${best}</b>` + rows.map(x => `<div><i style="background:${colorOf(x.n)}"></i>${E(x.n)}<span>${fmt(x.v)}</span></div>`).join('');
      tip.style.display = 'block';
      const cx = lineGeo.X(best);
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.style.display = '';
      const tw = tip.offsetWidth;
      tip.style.left = (cx + 14 + tw > r.width ? cx - 14 - tw : cx + 14) + 'px';
      tip.style.top = (lineGeo.m.t + 6) + 'px';
    });
    host.addEventListener('mouseleave', () => {
      const tip = $('bank-tip'), cross = $('bank-cross');
      if (tip) tip.style.display = 'none'; if (cross) cross.style.display = 'none';
    });
  }

  function renderBars() {
    const host = $('bank-bars');
    const list = data.players.filter(p => !p.isBot && p.totalBuyIns > 0).sort((a, b) => b.totalBuyIns - a.totalBuyIns).slice(0, 8);
    if (!list.length) { setHTML(host, emptyNote('No buy-ins yet', 'Every buy-in and rebuy stacks up here.')); return; }
    const W = host.clientWidth, H = host.clientHeight; if (!W || !H) return;
    const u = U();
    const m = { l: 84 * u, r: 58 * u, t: 12 * u, b: 12 * u };
    const max = niceMax(Math.max(...list.map(p => p.totalBuyIns)));
    const rowH = (H - m.t - m.b) / list.length, bh = Math.min(26 * u, rowH * 0.6);
    const sx = v => v / max * (W - m.l - m.r);
    let g = '';
    list.forEach((p, i) => {
      const y = m.t + i * rowH + (rowH - bh) / 2, initial = p.totalBuyIns - p.rebuyTotal;
      const nm = p.name.length > 10 ? p.name.slice(0, 9) + '…' : p.name;
      g += `<text class="bar-name" x="${m.l - 10 * u}" y="${y + bh / 2 + 4 * u}" text-anchor="end">${E(nm)}</text>`;
      g += `<rect x="${m.l}" y="${y}" width="${Math.max(2, sx(initial))}" height="${bh}" rx="${2 * u}" fill="${BRASS}"/>`;
      if (p.rebuyTotal) g += `<rect x="${m.l + sx(initial)}" y="${y}" width="${Math.max(2, sx(p.rebuyTotal))}" height="${bh}" rx="${2 * u}" fill="${CLAY}"/>`;
      g += `<text class="bar-val" x="${m.l + sx(p.totalBuyIns) + 8 * u}" y="${y + bh / 2 + 5 * u}">${fmt(p.totalBuyIns)}</text>`;
    });
    g += `<line class="ax" x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${H - m.b}"/>`;
    setHTML(host, `<svg class="bank-chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Total buy-ins per player">${g}</svg>`);
  }

  function renderFeed() {
    const host = $('bank-feed');
    const ev = data.events || [];
    $('bank-ecount').textContent = ev.length ? ev.length + ' recent' : '';
    if (!ev.length) { setHTML(host, '<div class="bank-card-body" style="min-height:100%">' + emptyNote('Quiet so far', 'Buy-ins, rebuys and cash-outs show up here live.') + '</div>'); return; }
    const lab = { buyin: 'Buy-in', rebuy: 'Rebuy', cashout: 'Cash out', adjust: 'Adjusted' };
    setHTML(host, ev.map(e => {
      const t = new Date(e.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      const amt = e.type === 'adjust' ? (typeof e.delta === 'number' ? signed(e.delta) : '= ' + fmt(e.balanceAfter || 0)) : (e.type === 'cashout' ? '+' : '−') + fmt(e.amount);
      return `<div class="fe"><time>${E(t)}</time><span><span class="who">${E(e.name)}</span> <span class="k ${e.type}">${lab[e.type] || e.type}</span></span><span class="amt">${amt}</span></div>`;
    }).join(''));
  }

  function attach() {
    if (!state.socket) return false;
    state.socket.on('bank_summary', d => {
      if (d && d.view && d.view !== view) return;
      data = d;
      if (isOpen) render();
    });
    Money.onPrefChange(() => { if (isOpen && data) render(); });
    state.socket.on('game_state', gs => {
      const pb = $('pause-banner');
      if (pb) {
        pb.classList.toggle('hidden', !gs.paused);
        const g = state.geo;
        if (g) { pb.style.left = g.cx + 'px'; pb.style.top = (g.cy - 165 * g.u) + 'px'; }
      }
    });
    return true;
  }

  function init() {
    build();
    const t = setInterval(() => { if (attach()) clearInterval(t); }, 200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
