'use strict';
// Bank dashboard. Self-contained; reads game.js globals (state, avatarInner, esc) and listens on state.socket.
(function () {
  const COLORS = ['#F5B942', '#4FB3B0', '#7FBF6A', '#C27BB0', '#E8D9B5', '#6E9BD1', '#E2674F', '#D98C5F'];
  const BRASS = '#C99A45', CLAY = '#E2674F';
  const colorMap = new Map();
  const avCache = new Map();
  let data = null, isOpen = false, pollTimer = null;

  const $ = id => document.getElementById(id);
  const fmt = n => Math.round(n).toLocaleString('en-US');
  const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
  const short = n => (Math.abs(n) >= 1000 ? (Math.round(n / 100) / 10) + 'k' : String(Math.round(n)));
  const U = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--u')) || 1;
  const E = s => (typeof esc === 'function' ? esc(s) : String(s));
  const colorOf = name => {
    if (!colorMap.has(name)) colorMap.set(name, COLORS[colorMap.size % COLORS.length]);
    return colorMap.get(name);
  };
  const STATUS = { seated: 'At the table', 'sitting-out': 'Sitting out', away: 'Away', offline: 'Offline' };

  function build() {
    const head = document.querySelector('.g-head');
    const grid = document.querySelector('.g-grid');
    if (!head || !grid || $('bank-btn')) return;
    const btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'bank-btn'; btn.className = 'bank-chip'; btn.textContent = 'Bank';
    btn.title = 'Bank dashboard (B)';
    const chip = $('room-code-btn');
    head.insertBefore(btn, chip ? chip.nextSibling : head.children[1]);

    const panel = document.createElement('section');
    panel.id = 'bank-panel'; panel.className = 'bank-panel'; panel.setAttribute('aria-label', 'Bank');
    panel.innerHTML = `
      <div class="bank-head">
        <div class="bank-title">THE <em>BANK</em></div>
        <div class="bank-sub" id="bank-sub">Buy-ins, balances and chips over time</div>
        <div class="bank-total" id="bank-total"></div>
        <button type="button" class="bank-close" id="bank-close" aria-label="Close bank">&#x2715;</button>
      </div>
      <div class="bank-body">
        <div class="bank-col">
          <div class="bank-card" style="flex:1"><h3>Standings<small id="bank-pcount"></small></h3><div class="bank-players bank-scroll" id="bank-players"></div></div>
        </div>
        <div class="bank-col">
          <div class="bank-card bank-chartcard"><h3>Chips at the table, hand by hand<small id="bank-hcount"></small></h3><div class="bank-card-body" id="bank-line"></div></div>
          <div class="bank-row2">
            <div class="bank-card"><h3>Total buy-ins<span class="bank-legend"><span><i style="background:${BRASS}"></i>Buy-in</span><span><i style="background:${CLAY}"></i>Rebuys</span></span></h3><div class="bank-card-body" id="bank-bars"></div></div>
            <div class="bank-card"><h3>Activity<small id="bank-ecount"></small></h3><div class="bank-feed bank-scroll" id="bank-feed"></div></div>
          </div>
        </div>
      </div>`;
    grid.appendChild(panel);

    btn.addEventListener('click', () => toggle());
    $('bank-close').addEventListener('click', () => toggle(false));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && isOpen) toggle(false);
      else if ((e.key === 'b' || e.key === 'B') && !e.ctrlKey && !e.metaKey && !e.altKey && !/INPUT|TEXTAREA/.test((e.target.tagName || ''))) toggle();
    });
    window.addEventListener('resize', () => { if (isOpen) render(); });
    bindTip();
  }

  function request() {
    if (state.socket && state.roomId) state.socket.emit('get_bank_summary', { roomId: state.roomId });
  }

  function toggle(force) {
    isOpen = force === undefined ? !isOpen : force;
    $('bank-panel').classList.toggle('open', isOpen);
    $('bank-btn').classList.toggle('on', isOpen);
    clearInterval(pollTimer);
    if (isOpen) { request(); render(); pollTimer = setInterval(request, 4000); }
  }

  function rememberAvatars() {
    for (const p of (state.gameState && state.gameState.players) || []) avCache.set(p.name.toLowerCase(), { avatar: p.avatar, pic: p.profilePic });
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
    const onTable = data.players.reduce((s, p) => s + (p.status === 'offline' ? 0 : p.atTable), 0);
    const buy = humans.reduce((s, p) => s + p.totalBuyIns, 0);
    $('bank-total').innerHTML =
      `<div class="pl"><label>Banked</label><b>${fmt(bankSum)}</b></div>` +
      `<div class="pl"><label>On the table</label><b>${fmt(onTable)}</b></div>` +
      `<div class="pl"><label>Bought in</label><b>${fmt(buy)}</b></div>` +
      `<div class="pl"><label>Hands</label><b>${data.maxHand || 0}</b></div>`;
  }

  function renderPlayers() {
    const me = state.gameState && state.gameState.players[state.myIdx];
    const meName = me ? me.name.toLowerCase() : '';
    const canEdit = meName === 'chris';
    if (document.querySelector('#bank-players .bp-edit')) return;
    $('bank-pcount').textContent = data.players.length ? data.players.length + ' players' : '';
    if (!data.players.length) {
      $('bank-players').innerHTML = '<div class="bank-card-body"><div class="bank-empty"><b>No players yet</b>Join the table to open a bank account.</div></div>';
      return;
    }
    $('bank-players').innerHTML = data.players.map(p => {
      const off = p.status === 'offline';
      const netCls = p.isBot ? '' : p.net > 0 ? 'pos' : p.net < 0 ? 'neg' : '';
      const sub = [STATUS[p.status] || p.status, p.handsPlayed + ' hand' + (p.handsPlayed === 1 ? '' : 's')];
      const tag = p.isBot ? '<i>House</i>' : (p.name.toLowerCase() === meName ? '<i>You</i>' : '');
      return `<div class="bp${p.name.toLowerCase() === meName ? ' me' : ''}${off ? ' off' : ''}" style="--pc:${colorOf(p.name)}">
        <div class="bp-avw"><div class="bp-av">${avatarFor(p.name)}</div><span class="bp-dot ${p.status}" title="${STATUS[p.status] || ''}"></span></div>
        <div class="bp-who">${E(p.name)}${tag}</div>
        <div class="bp-sub">${E(sub.join(' · '))}</div>
        <div class="bp-bal"><b${canEdit && !p.isBot ? ` class="editable" data-name="${E(p.name)}" data-bank="${p.bank || 0}" title="Click to edit this bank"` : ''}>${p.isBot ? '&mdash;' : fmt(p.bank || 0)}</b><span>Bank</span></div>
        <div class="bp-stats">
          <div><label>At table</label><b>${fmt(p.atTable)}</b></div>
          <div><label>Net P&amp;L</label><b class="${netCls}">${p.isBot ? '&mdash;' : signed(p.net)}</b></div>
          <div><label>Buy-ins</label><b>${p.isBot ? '&mdash;' : p.buyIns}</b></div>
          <div><label>Best win</label><b>${p.isBot ? '&mdash;' : (p.biggestWin ? fmt(p.biggestWin) : '&ndash;')}</b></div>
        </div>
      </div>`;
    }).join('');
    $('bank-players').querySelectorAll('.bp-bal b.editable').forEach(b => b.addEventListener('click', () => editBank(b)));
  }

  function editBank(b) {
    const name = b.dataset.name;
    const input = document.createElement('input');
    input.type = 'number'; input.min = '0'; input.step = '1'; input.value = b.dataset.bank; input.className = 'bp-edit';
    input.setAttribute('aria-label', 'New bank amount for ' + name);
    b.replaceWith(input); input.focus(); input.select();
    let done = false;
    const finish = save => {
      if (done) return; done = true;
      if (save && input.value !== '' && state.socket) state.socket.emit('bank_set', { name, balance: Number(input.value) });
      input.remove(); request(); render();
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') { e.stopPropagation(); finish(false); } e.stopPropagation(); });
    input.addEventListener('blur', () => finish(false));
  }

  function niceMax(v) {
    const steps = [500, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000, 8000, 10000, 15000, 20000, 30000, 50000, 100000];
    return steps.find(s => s >= v) || Math.ceil(v / 10000) * 10000;
  }

  function emptyNote(title, text) { return `<div class="bank-empty"><b>${title}</b>${text}</div>`; }

  let lineGeo = null;
  function renderLine() {
    const host = $('bank-line');
    const names = Object.keys(data.series);
    const hands = new Set();
    names.forEach(n => data.series[n].forEach(pt => hands.add(pt[0])));
    $('bank-hcount').textContent = hands.size ? 'Dashed line = 1,500 starting stack \u00b7 ' + hands.size + ' hand' + (hands.size === 1 ? '' : 's') : '';
    if (!hands.size) { lineGeo = null; host.innerHTML = emptyNote('Nothing to plot yet', 'Chips are recorded at the end of every hand. Play one and the lines appear.'); return; }
    const W = host.clientWidth, H = host.clientHeight; if (!W || !H) return;
    const u = U();
    const m = { l: 52 * u, r: 92 * u, t: 16 * u, b: 28 * u };
    const hs = [...hands].sort((a, b) => a - b);
    const x0 = hs[0], x1 = hs[hs.length - 1];
    const span = Math.max(1, x1 - x0);
    let ymax = 1500;
    names.forEach(n => data.series[n].forEach(pt => { ymax = Math.max(ymax, pt[1]); }));
    const step = [250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000].find(s => ymax * 1.03 / s <= 5) || 100000;
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
    if (1500 < ymax) g += `<line class="ref" x1="${m.l}" x2="${W - m.r}" y1="${Y(1500)}" y2="${Y(1500)}"/>`;

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
    host.innerHTML = `<svg class="bank-chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Chips over hands per player">${g}</svg><div class="bank-tip" id="bank-tip" style="display:none"></div>`;
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
    if (!list.length) { host.innerHTML = emptyNote('No buy-ins yet', 'Every buy-in and rebuy stacks up here.'); return; }
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
    host.innerHTML = `<svg class="bank-chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Total buy-ins per player">${g}</svg>`;
  }

  function renderFeed() {
    const host = $('bank-feed');
    const ev = data.events || [];
    $('bank-ecount').textContent = ev.length ? ev.length + ' recent' : '';
    if (!ev.length) { host.innerHTML = '<div class="bank-card-body" style="min-height:100%">' + emptyNote('Quiet so far', 'Buy-ins, rebuys and cash-outs show up here live.') + '</div>'; return; }
    const lab = { buyin: 'Buy-in', rebuy: 'Rebuy', cashout: 'Cash out' };
    host.innerHTML = ev.map(e => {
      const t = new Date(e.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return `<div class="fe"><time>${E(t)}</time><span><span class="who">${E(e.name)}</span> <span class="k ${e.type}">${lab[e.type] || e.type}</span></span><span class="amt">${e.type === 'cashout' ? '+' : '−'}${fmt(e.amount)}</span></div>`;
    }).join('');
  }

  function attach() {
    if (!state.socket) return false;
    state.socket.on('bank_summary', d => { data = d; if (isOpen) render(); });
    return true;
  }

  function init() {
    build();
    const t = setInterval(() => { if (attach()) clearInterval(t); }, 200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
