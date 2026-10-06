'use strict';

// ─── State ────────────────────────────────────────────────────────
const state = {
  socket:         null,
  roomId:         null,
  myIdx:          null,
  myCards:        [],
  gameState:      null,
  myBalance:      null,
  soundOn:        true,
  prevPot:        0,
  u:              1,
  geo:            null,
  turnEndAt:      null,
  blindEndAt:     null,
  lastSecs:       null,
  barMode:        'idle',
  tab:            'log',
  unread:         0,
  logAll:         [],
  logPinned:      true,
  actKey:         {},
  actSeen:        {},
  connKey:        {},
  dealt:          {},
  dealPend:       {},
  dealTimers:     [],
  noDealHand:     null,
  firstState:     false,
  heroKey:        '',
  spectating:     false,
  unit:           'chips',
};

const TURN_MS       = 30000;
const CHIP_ART_BB  = 20;   // chip-pile artwork denominations are drawn for a 20-chip big blind (cents tables scale them); not a rule
const buyInDefault = () => state.table?.buyIn?.default ?? state.gameState?.table?.buyIn?.default ?? 1500;
const bustMin      = () => state.gameState?.bb || state.table?.bb || 20;
// Display mode is per table: the user's pref resolved against THIS table's unit (no global unit).
const normUnit     = u => (u === 'chips' ? 'chips' : 'cents');
function setTableUnit(u) {
  const n = normUnit(u);
  if (n === state.unit) return;
  state.unit = n;
  document.querySelectorAll('[data-money-toggle]').forEach(el => { el.dataset.unit = n; });
  Money.refreshToggles();
}
const tableMode    = () => Money.modeFor(Money.pref, state.unit);
const fmt          = (n, o) => Money.format(n, tableMode(), o);
const inputText    = v => Money.plain(v, tableMode());
const readInput    = txt => { const r = Money.parse(txt, tableMode()); return r.ok ? r.units : null; };
const niceStep     = () => Money.niceStep(state.gameState?.bb || CHIP_ART_BB, tableMode());
const niceRound    = v => { const st = niceStep(); return st > 1 ? Math.round(v / st) * st : Math.round(v); };
let activeTray      = null;
const prevChipsMap  = {};

const $ = id => document.getElementById(id);

// ─── Art slots (images/…); CSS draws a fallback when a file is missing ─
const AV_EMOJI = ['🤠', '🦊', '🐉', '🎩', '🦁', '🐺', '🦅', '🎲', '👑', '💀', '🎯', '⚡'];
const AV_FILES = AV_EMOJI.map((_, i) => 'a' + String(i + 1).padStart(2, '0'));
const artAvatars = new Set();

function probeArt() {
  const html  = document.documentElement;
  const slots = {
    'art-felt': 'table-felt.jpg', 'art-rail': 'table-rail.jpg', 'art-backdrop': 'backdrop.jpg',
    'art-back': 'card-back.png', 'art-puck': 'dealer-button.png', 
    'art-c1': 'chip-1.png', 'art-c5': 'chip-5.png', 'art-c25': 'chip-25.png', 'art-c100': 'chip-100.png', 'art-c500': 'chip-500.png',
  };
  Object.entries(slots).forEach(([cls, file]) => {
    const im = new Image();
    im.onload = () => {
      html.classList.add(cls);
      if (cls === 'art-lockup') document.querySelectorAll('.lockup-img').forEach(e => { e.hidden = false; });
    };
    im.src = 'images/' + file;
  });
  let pending = AV_FILES.length;
  const done = () => {
    if (--pending > 0) return;
        if (state.gameState && $('game-screen').classList.contains('active')) renderGame();
  };
  AV_FILES.forEach(f => {
    const im = new Image();
    im.onload  = () => { artAvatars.add(f); done(); };
    im.onerror = done;
    im.src = `images/avatars/${f}.png`;
  });
}

const ART_FILES = {
  stickers: { '🔥': 'flame', '💎': 'gem', '🤑': 'moneyface', '💀': 'skull', '🍀': 'clover', '👑': 'crown', '🎰': 'slot', '🎯': 'target', '🃏': 'joker', '🎲': 'dice', '🏆': 'trophy', '😤': 'angry' },
  throws:   { '💣': 'bomb', '🍅': 'tomato', '💦': 'splash', '🎉': 'popper' },
};
function art(kind, emoji) {
  const f = ART_FILES[kind][emoji];
  if (!f) return esc(emoji);
  return `<img class="art-img" src="images/${kind}/${f}.png" alt="${emoji}" onerror="this.replaceWith(document.createTextNode(this.alt))">`;
}

function avatarInner(avatar, pic) {
  const p = safePic(pic);
  if (p) return `<img src="${p}" alt="">`;
  const i = AV_EMOJI.indexOf(avatar);
  if (i >= 0 && artAvatars.has(AV_FILES[i])) return `<img src="images/avatars/${AV_FILES[i]}.png" alt="">`;
  return esc(avatar || '🙂');
}

// ─── Scale unit: every size in the CSS is N * --u ─────────────────
let stageRO = null;
function setScale() {
  const host = document.querySelector('.sh-stage');
  if (host && !stageRO && window.ResizeObserver) { stageRO = new ResizeObserver(() => onResize()); stageRO.observe(host); }
  const w = host && host.clientWidth ? host.clientWidth : window.innerWidth;
  const h = host && host.clientHeight ? host.clientHeight : window.innerHeight;
  const u = Math.max(0.8, Math.min(1.35, Math.min(h / 900, w / 1440)));
  document.documentElement.style.setProperty('--u', u.toFixed(4));
  state.u = u;
  return u;
}

let resizeRaf = 0;
function onResize() {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(relayout);
}

function relayout() {
  setScale();
  if (state.gameState && $('game-screen').classList.contains('active')) renderGame();
}

// ─── Init ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setScale();
  state.socket = io();
  window.PingSocket = state.socket;
  probeArt();
  document.querySelectorAll('svg.t-ping').forEach(fillPing);
  bindWaitPanel();
  bindActions();
  bindSocket();
  bindRail();
  document.querySelectorAll('#sticker-grid .sticker-item').forEach(b => { b.innerHTML = art('stickers', b.dataset.emoji); });
  document.querySelectorAll('#throw-grid .throw-item').forEach(b => { b.innerHTML = art('throws', b.dataset.item); });
  initSoundToggle();
  initChat();
  initEmotes();
  initPanelSide();
  initBust();
  bindCopy($('room-code-btn'));

  $('player-seats').addEventListener('click', (e) => {
    const seat = e.target.closest('.seat[data-player-idx]');
    if (!seat) return;
    const playerIdx = parseInt(seat.dataset.playerIdx);
    if (playerIdx === state.myIdx) return;
    if (state.armedThrow) {
      state.socket.emit('throw_item', { roomId: state.roomId, targetIdx: playerIdx, item: state.armedThrow });
      setArmedThrow(null);
      return;
    }
    showThrowTray(playerIdx, seat.querySelector('.seat-pill') || seat);
  });

  $('player-seats').addEventListener('keydown', (e) => {
    const seat = e.target.closest && e.target.closest('.seat[data-player-idx]');
    if (!seat || seat !== e.target) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) { e.preventDefault(); seat.click(); }
  });

  window.addEventListener('resize', onResize);
  Money.onPrefChange(() => {
    if (state.lastBust != null && !$('bust-panel').classList.contains('hidden')) showBust(state.lastBust);
    if (state.lastLb) renderLeaderboard(state.lastLb);
    if (state.gameState && $('game-screen')?.classList.contains('active')) renderGame();
  });
  setInterval(tickTimer, 200);

  const savedName = localStorage.getItem('ppName');
  const nameInput = $('player-name');
  if (savedName && nameInput) {
    nameInput.value = savedName;
    nameInput.dispatchEvent(new Event('input'));
  }
});

// ─── Screen ────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id)?.classList.add('active');
  setScale();
}

// ─── Toasts (the only fixed layer) ────────────────────────────────
function toast(title, sub = '', kind = '', ms = 3200) {
  const wrap = $('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`.trim();
  el.style.setProperty('--ms', (ms / 1000) + 's');
  el.innerHTML = `<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), ms + 600);
}

function inviteLink() {
  const id = state.roomId;
  return location.origin + (id ? '/?t=' + encodeURIComponent(id) : '');
}

function bindCopy(btn) {
  if (!btn) return;
  btn.addEventListener('click', () => {
    const text = inviteLink();
    const flash = () => { btn.classList.add('copied'); setTimeout(() => btn.classList.remove('copied'), 1200); };
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;left:-999px;top:0;';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); flash(); } catch {}
      ta.remove();
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(flash, fallback);
    else fallback();
  });
}

// ─── Gold "ping" sonar rings + VP monogram (felt centre) ──────────
function fillPing(svg) {
  svg.innerHTML = `
    <g fill="none" stroke="#F5B942" stroke-linecap="round">
      <circle r="150" stroke-width="1.2" opacity=".28" stroke-dasharray="2 9"/>
      <circle r="118" stroke-width="1.6" opacity=".40"/>
      <circle r="86"  stroke-width="1.8" opacity=".55" stroke-dasharray="48 14"/>
      <circle r="54"  stroke-width="2"   opacity=".75"/>
    </g>
    <circle r="31" fill="#1F4D36" fill-opacity=".55" stroke="#F5B942" stroke-width="2"/>
    <text y="12" text-anchor="middle" font-family="Bebas Neue, Impact, sans-serif" font-size="38" letter-spacing="2" fill="#F5B942">VP</text>`;
}

// ─── Stadium geometry (table = rounded rect, radius H/2) ──────────
// Returns the point on the stadium edge, relative to its centre, for a
// ray at theta degrees clockwise from straight up.
function stadiumEdge(W, H, theta) {
  const a  = theta * Math.PI / 180;
  const dx = Math.sin(a), dy = -Math.cos(a);
  const R  = H / 2, L = (W - H) / 2;
  let t;
  if (Math.abs(dy) > 1e-6 && Math.abs(R / Math.abs(dy) * dx) <= L) {
    t = R / Math.abs(dy);
  } else {
    const sx = dx >= 0 ? 1 : -1;
    const b  = sx * L * dx;
    t = b + Math.sqrt(Math.max(0, b * b - (L * L - R * R)));
  }
  return [dx * t, dy * t];
}

const SEAT_ANGLES = {
  2: [180, 0],
  3: [180, 300, 60],
  4: [180, 270, 0, 90],
  5: [180, 235, 310, 50, 125],
  6: [180, 240, 300, 0, 60, 120],
  7: [180, 230, 280, 330, 30, 80, 130],
  8: [180, 222, 270, 322, 0, 38, 90, 138],
};
const anglesFor = n => SEAT_ANGLES[Math.max(2, Math.min(8, n))];

function showError(msg) { toast(msg, '', 'warn'); }

// ─── Waiting panel (on the table, before the first hand) ──────────
function renderShowPanel(gs) {
  const panel = $('show-panel');
  const me = gs.players[state.myIdx];
  const rev = state.reveal && state.reveal.handNum === gs.handNum && me && state.reveal.cards[me.name];
  const on = gs.status === 'waiting_next' && !!me && me.cardCount === 2 && state.myCards.length === 2 && !(rev && rev[0] && rev[1]);
  panel.classList.toggle('hidden', !on);
  if (!on) return;
  const shown = i => !!(rev && rev[i]);
  const b = panel.querySelectorAll('button');
  b[0].disabled = shown(0); b[1].disabled = shown(0) && shown(1); b[2].disabled = shown(1);
  b[0].textContent = shown(0) ? 'Shown' : 'Show left';
  b[2].textContent = shown(1) ? 'Shown' : 'Show right';
}

function bindWaitPanel() {
  $('show-panel').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    const w = b.dataset.w;
    state.socket.emit('show_cards', { roomId: state.roomId, which: w === 'both' ? 'both' : Number(w) });
  });
  bindCopy($('wp-invite'));
  $('btn-start').addEventListener('click', () => {
    if (state.roomId) state.socket.emit('table_start', { tableId: state.roomId });
  });
}

function renderWaitPanel(gs) {
  const panel = $('wait-panel');
  const on = gs.status === 'waiting';
  panel.classList.toggle('hidden', !on);
  if (!on) return;
  const isHost = !!state.myName && gs.hostName === state.myName;
  const ready = gs.players.filter(p => p.connected && p.chips > 0).length;
  const canStart = ready >= 2;
  $('wp-text').textContent = canStart ? 'Dealing shortly' : 'Waiting for a second player';
  $('wp-sub').textContent = canStart ? 'Everyone is seated. The first hand starts in a moment.' : 'Deals automatically when a second player sits down.';
  $('wp-seats').innerHTML = Array.from({ length: 8 }, (_, i) => `<i class="${gs.players[i] ? 'on' : ''}"></i>`).join('') + `<span>${gs.players.length} of 8 seated</span>`;
  $('wp-invite-link').textContent = inviteLink().replace(/^https?:\/\//, '');
  $('wp-invite').classList.toggle('hidden', canStart);
  $('btn-start').classList.toggle('hidden', !(isHost && canStart));
}

// ─── Platform adapter (lobby/shell call these) ────────────────────
function lobbyUser() { try { return window.Lobby?.user?.() || null; } catch (e) { return null; } }
function lobbyName() { const u = lobbyUser(); return u ? (u.display || u.key || '') : ''; }

function leaveToLobby() {
  const id = state.roomId;
  if (id && state.socket) state.socket.emit('table_leave', { tableId: id });
  window.PingGame.leave();
}

window.PingFmt = fmt; // table-aware formatter for juice.js
window.PingGame = {
  enter({ tableId, playerIdx, stack, table, you } = {}) {
    resetDeal();
    state.dealt = {}; state.heroKey = ''; state.reveal = null; state.gameState = null;
    state.myCards = []; state.spectating = false;
    state.roomId = tableId;
    state.table  = table || null;
    state.myIdx  = playerIdx;
    state.hands = { room: tableId, base: null, played: {}, log: [], seen: -1 };
    state.myName = (you && (you.display || you.name)) || lobbyName() || state.myName || null;
    if (stack !== undefined) state.myBalance = stack;
    if (table) setTableUnit(table.unit);
    const rc = $('room-code'); if (rc) rc.textContent = (table && (table.code || table.name)) || tableId;
    $('bust-panel')?.classList.add('hidden');
    if (state.rebuyField) { state.rebuyField.destroy(); state.rebuyField = null; $('bust-amt')?.replaceChildren(); }
    showScreen('game-screen');
  },
  leave() {
    resetDeal();
    state.roomId = null; state.table = null; state.myIdx = null; state.gameState = null; state.myCards = [];
    state.dealt = {}; state.heroKey = ''; state.reveal = null; state.spectating = false;
    state.turnEndAt = null; state.turnKey = '';
    $('game-screen')?.classList.remove('active');
    if (window.Lobby?.show) window.Lobby.show('lobby');
  },
  isIn() { return !!state.roomId && !!$('game-screen')?.classList.contains('active'); },
};

// ─── Socket ────────────────────────────────────────────────────────
function bindSocket() {
  const s = state.socket;

  s.on('balance_update', ({ balance }) => { state.myBalance = balance; });
  s.on('money', (m) => {
    if (m && typeof m.bank === 'number') state.myBalance = m.bank;
  });

  s.on('game_state', gs => {
    const prev = state.gameState;
    state.gameState = gs;
    const gu = gs.unit || gs.table?.unit;
    if (gu) setTableUnit(gu);
    if (!state.myName && gs.players[state.myIdx]) state.myName = gs.players[state.myIdx].name;
    const idxNow = gs.players.findIndex(p => p.name === state.myName);
    if (idxNow >= 0) state.myIdx = idxNow;
    if (!prev || prev.handNum !== gs.handNum) { resetDeal(); state.dealt = {}; state.heroKey = ''; state.reveal = null; hideShowdown(); }
    if (!prev && gs.street && gs.street !== 'preflop') state.noDealHand = gs.handNum;
    noteTable(prev, gs);
    trackHands(gs);

    const cur = gs.currentPlayerIdx;
    if (cur == null || gs.status !== 'playing' || gs.players[cur]?.isBot) { state.turnEndAt = null; state.turnKey = ''; }
    else if (gs.turnRemainingMs != null) { state.turnEndAt = Date.now() + gs.turnRemainingMs; state.turnKey = gs.handNum + ':' + cur + ':' + gs.street + ':' + gs.currentBet; }
    else {
      const k = gs.handNum + ':' + cur + ':' + gs.street + ':' + gs.currentBet;
      if (k !== state.turnKey) { state.turnKey = k; state.turnEndAt = Date.now() + TURN_MS; }
    }
    state.blindEndAt = (gs.blindNextMs != null) ? Date.now() + gs.blindNextMs : null;

    if (!$('game-screen').classList.contains('active')) showScreen('game-screen');
    renderGame();
  });

  s.on('your_cards', ({ cards, myIdx, preselect }) => {
    state.myIdx   = myIdx;
    state.myCards = cards;
    state.pre     = preselect || null;
    if (state.gameState) renderGame();
  });

  s.on('cards_shown', ({ handNum, name, cards }) => {
    if (!state.reveal || state.reveal.handNum !== handNum) state.reveal = { handNum, cards: {}, names: {} };
    state.reveal.cards[name] = cards;
    if (state.gameState) { renderSeats(state.gameState); renderShowPanel(state.gameState); }
  });

  s.on('showdown_result', ({ winners, pot, reveals, nextMs, net }) => {
    state.sdMs = nextMs || 5000;
    renderShowdown(winners, pot, reveals);
    playSound('win');
    const myName = state.gameState?.players[state.myIdx]?.name;
    // my NET for the hand (never the whole pot): `net` map by name, else my winner row's net
    const mine = winners.find(w => w.name === myName);
    const myNet = net && myName in net ? net[myName] : (mine ? mine.net : 0);
    if (myNet > 0) setTimeout(() => showWinFloat(myNet), 250);
    juiceShowdown(winners, pot);
  });

  s.on('sticker_dropped', ({ emoji, fromName }) => { showFloatingSticker(emoji, fromName); juiceSticker(emoji, fromName); });
  s.on('item_thrown', ({ fromIdx, targetIdx, item }) => {
    animateProjectile(item, seatClientPos(fromIdx), seatClientPos(targetIdx));
  });

  s.on('chat_message', ({ name, text }) => { appendChatMsg(name, text); playSound('msg'); });
  s.on('emote', ({ idx, id }) => showEmote(idx, id));

  s.on('blinds_up', ({ level, sb, bb, unit }) => {
    if (unit) setTableUnit(unit);
    toast(`BLINDS UP · LEVEL ${level + 1}`, `${fmt(sb)} / ${fmt(bb)}`, '', 4200);
    playSound('blinds_up');
  });

  s.on('bust_out', ({ balance, rebuy }) => { showBust(rebuy && rebuy.balance != null ? rebuy.balance : balance, rebuy); });
  s.on('leaderboard_data', ({ entries }) => { renderLeaderboard(entries); });
  s.on('self_changed', v => { if (v && v.display) state.myName = v.display; });
  s.on('error', e => { showError(PingUI.errorText(e, tableMode())); });

  s.on('disconnect', () => { toast('Connection lost', 'Trying to reconnect', 'warn', 5000); });
  s.on('connect',    () => { if (state.roomId) toast('Back online', '', 'ok', 2000); });
}

// Toasts for table-level events: players dropping and returning.
function noteTable(prev, gs) {
  if (!prev || prev.handNum === undefined) return;
  juiceAllIn(prev, gs);
  gs.players.forEach((p, i) => {
    const was = prev.players[i];
    if (!was || was.name !== p.name || i === state.myIdx) return;
    if (was.connected !== false && p.connected === false && !p.isBot) toast(`${p.name} disconnected`, '', 'warn', 2800);
    if (was.connected === false && p.connected !== false) toast(`${p.name} is back`, '', 'ok', 2000);
  });
}

// ─── Sound Toggle ──────────────────────────────────────────────────
function initSoundToggle() {
  const btn = $('sound-toggle');
  if (window.PPSound) { state.soundOn = !PPSound.muted; btn.querySelector('use').setAttribute('href', state.soundOn ? '#i-sound' : '#i-mute'); btn.classList.toggle('muted', !state.soundOn); }
  btn.addEventListener('click', () => {
    state.soundOn = !state.soundOn;
    if (window.PPSound) PPSound.setMuted(!state.soundOn);
    if (window.PingJuice) PingJuice.setSfx(state.soundOn);
    btn.querySelector('use').setAttribute('href', state.soundOn ? '#i-sound' : '#i-mute');
    btn.classList.toggle('muted', !state.soundOn);
  });
}

// ─── Left panel: stickers, throws, pause ──────────────────────────
function bindRail() {
  $('sticker-grid').addEventListener('click', e => {
    const item = e.target.closest('.sticker-item');
    if (!item || !state.roomId) return;
    state.socket.emit('drop_sticker', { roomId: state.roomId, emoji: item.dataset.emoji });
  });
  $('throw-grid').addEventListener('click', e => {
    const item = e.target.closest('.throw-item');
    if (!item) return;
    const on = state.armedThrow === item.dataset.item;
    setArmedThrow(on ? null : item.dataset.item);
  });
  $('btn-sit-out').addEventListener('click', () => {
    if (!state.roomId) return;
    state.socket.emit('sit_out', { roomId: state.roomId });
  });
}

function setArmedThrow(item) {
  state.armedThrow = item;
  document.querySelectorAll('#throw-grid .throw-item').forEach(b => b.classList.toggle('armed', b.dataset.item === item));
  $('throw-hint').textContent = item ? 'Now click a player' : 'Pick one, then click a player';
}

// ─── Chat ─────────────────────────────────────────────────────────
function initPanelSide() {
  const scr = $('game-screen'), btn = $('btn-panel-side');
  const apply = side => {
    scr.classList.toggle('panel-right', side === 'right');
    btn.textContent = side === 'right' ? '\u2039' : '\u203A';
    btn.setAttribute('aria-label', side === 'right' ? 'Move panel to the left' : 'Move panel to the right');
  };
  let side = 'left';
  try { if (localStorage.getItem('ping.panelSide') === 'right') side = 'right'; } catch (e) {}
  apply(side);
  btn.addEventListener('click', () => {
    side = side === 'right' ? 'left' : 'right';
    try { localStorage.setItem('ping.panelSide', side); } catch (e) {}
    apply(side);
  });
}

// ─── Quick emotes ─────────────────────────────────────────────────
const EMOTE_KEYS = ['thumbs', 'laugh', 'mindblown', 'sweat', 'clap', 'tilt'];
const EMOTE_COOLDOWN_MS = 3000;
let emoteReadyAt = 0;

function sendEmote(id) {
  if (!state.roomId || state.spectating || !EMOTE_KEYS.includes(id)) return;
  const now = Date.now();
  if (now < emoteReadyAt) return;
  emoteReadyAt = now + EMOTE_COOLDOWN_MS;
  state.socket.emit('emote', { roomId: state.roomId, id });
  const strip = $('emote-strip');
  if (strip) { strip.classList.add('cool'); setTimeout(() => strip.classList.remove('cool'), EMOTE_COOLDOWN_MS); }
}

function initEmotes() {
  const strip = $('emote-strip');
  if (!strip) return;
  strip.addEventListener('click', e => {
    const b = e.target.closest('.emote-btn');
    if (b) sendEmote(b.dataset.emote);
  });
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target, tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    if (!$('game-screen')?.classList.contains('active') || PingUI.isOverlayOpen()) return;
    const i = '123456'.indexOf(e.key);
    if (e.key.length === 1 && i >= 0) sendEmote(EMOTE_KEYS[i]);
  });
}

function showEmote(idx, id) {
  if (!EMOTE_KEYS.includes(id) || !state.gameState?.players[idx]) return;
  const [x, y] = seatClientPos(idx);
  const el = document.createElement('img');
  el.className = 'emote-float'; el.alt = ''; el.src = `images/fx2/sticker-emote-${id}.png`;
  const sr = ($('stage') || document.body).getBoundingClientRect(), u = state.u, half = 44 * u;
  const topY = sr.top + half + 36 * u, wantY = y - 92 * u, crowded = wantY < topY;
  const ex = Math.min(sr.right - half, Math.max(sr.left + half, crowded ? x - 110 * u : x));
  const ey = Math.min(sr.bottom - half, crowded ? y - 20 * u : wantY);
  el.style.left = ex + 'px'; el.style.top = ey + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2100);
  if (window.PingJuice) PingJuice.sfx('sticker', { minGap: 120 });
}

// ─── Hot / cold chip ──────────────────────────────────────────────
const HOT_MIN = 3, HOT_WINDOW = 10;

function trackHands(gs) {
  const h = state.hands;
  const me = gs.players[state.myIdx];
  if (!h || !me) return;
  if (gs.status === 'playing') {
    if (me.cardCount > 0 || state.myCards?.length) h.played[gs.handNum] = true;
    return;
  }
  if (h.seen === gs.handNum) return;
  h.seen = gs.handNum;
  if (h.base != null && h.played[gs.handNum]) {
    h.log.push(me.chips - h.base);
    if (h.log.length > HOT_WINDOW) h.log.shift();
  }
  h.base = me.chips;
}

function handsNet() {
  const log = state.hands?.log || [];
  return log.length >= HOT_MIN ? { n: log.length, net: log.reduce((a, b) => a + b, 0) } : null;
}

const HC_FLAME = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2c1 3.2 4.6 5.2 4.6 10A4.6 4.6 0 0 1 12 17a4.6 4.6 0 0 1-4.6-5c0-1.6.6-2.8 1.6-3.8.2 1.2.8 2 1.6 2.4C10.2 7.4 10.6 4.6 12 2zm0 20a6.2 6.2 0 0 1-6-6.4c0-1 .3-2 .7-2.8.2 1.8 1.2 3.4 2.6 4.3 1 .7 2.2 1 3.4.9 1.8-.2 3.2-1.4 3.8-3.1.4 1.1.5 2.2.2 3.2A6.1 6.1 0 0 1 12 22z" opacity=".9"/></svg>';
const HC_FLAKE = '<svg viewBox="0 0 24 24" aria-hidden="true"><g stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"><path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7"/><path d="M9.5 3.8L12 6l2.5-2.2M9.5 20.2L12 18l2.5 2.2M4 10.2l3.2-.4-.9-3.1M20 13.8l-3.2.4.9 3.1M4 13.8l3.2.4-.9 3.1M20 10.2l-3.2-.4.9-3.1"/></g></svg>';

function hotColdHtml(r, what) {
  if (!r || r.net === 0) return '';
  const hot = r.net > 0;
  const amt = fmt(Math.abs(r.net), {});
  return `<div class="hc-chip ${hot ? 'hot' : 'cold'}" title="Last ${r.n} ${what}">${hot ? HC_FLAME : HC_FLAKE}<b>${hot ? 'HOT' : 'COLD'}</b><span>${hot ? '+' : '-'}${esc(amt)}</span></div>`;
}

function initChat() {
  const input = $('chat-input');
  const send = () => {
    const text = input.value.trim();
    if (!text || !state.roomId) return;
    state.socket.emit('chat_message', { roomId: state.roomId, text });
    input.value = '';
  };
  $('chat-send').addEventListener('click', send);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
}

function appendChatMsg(name, text) {
  const el = $('chat-messages');
  const msg = document.createElement('div');
  msg.className = 'chat-msg';
  msg.innerHTML = `<span class="chat-name" style="color:${nameColor(name)}">${esc(name)}</span><span class="chat-text">${esc(text)}</span>`;
  el.appendChild(msg);
  el.scrollTop = el.scrollHeight;
}

// ─── Bust (rail side panel) ───────────────────────────────────────
function initBust() {
  $('btn-rebuy').addEventListener('click', () => {
    if (!state.roomId) return;
    // the amount sent is the number in the AmountInput (the same number the button label promises); never a guess
    const f = state.rebuyField;
    if (f) { if (f.value() === null) { f.submit(); return; } state.socket.emit('rebuy', { roomId: state.roomId, amount: f.value() }); f.destroy(); state.rebuyField = null; $('bust-amt').replaceChildren(); }
    else state.socket.emit('rebuy', { roomId: state.roomId });
    $('bust-panel').classList.add('hidden');
  });
  $('btn-spectate').addEventListener('click', () => {
    state.spectating = true;
    $('bust-panel').classList.add('hidden');
  });
  $('btn-leave').addEventListener('click', () => {
    if (window.PingGame.isIn() && window.Lobby) leaveToLobby(); else location.reload();
  });
  $('btn-home').addEventListener('click', () => {
    if (!confirm('Leave the table and go back to the home screen?')) return;
    if (window.PingGame.isIn() && window.Lobby) leaveToLobby(); else location.href = location.pathname;
  });
}

function showBust(balance, rebuy) {
  state.lastBust = balance;
  state.spectating = false;
  $('bust-panel').classList.remove('hidden');
  $('bust-balance').textContent = `Bank ${fmt(balance)}`;
  const rebuyBtn = $('btn-rebuy');
  const brokeMsg = $('bust-broke-msg');
  const slot = $('bust-amt');
  const bi = state.table?.buyIn || {};
  const rb = rebuy || state.lastRebuy || {};
  if (rebuy) state.lastRebuy = rebuy;
  const lo = rb.min ?? bi.min ?? bustMin();
  const hi = Math.min(rb.max ?? bi.max ?? balance, balance);
  const def = Math.min(hi, Math.max(lo, rb.default ?? buyInDefault()));
  if (balance >= lo && hi >= lo) {
    rebuyBtn.classList.remove('hidden');
    brokeMsg.classList.add('hidden');
    const presets = [{ label: 'Min', units: lo }, { label: 'Default', units: def }, { label: 'Max', units: hi }];
    const label = () => { const v = state.rebuyField && state.rebuyField.value(); rebuyBtn.textContent = v === null || v === undefined ? 'Rebuy' : `Rebuy ${fmt(v)}`; rebuyBtn.disabled = v === null || v === undefined; };
    if (state.rebuyField && state.rebuyField.unitKey === state.unit) {
      state.rebuyField.setBounds({ min: lo, max: hi, presets });
    } else {
      if (state.rebuyField) state.rebuyField.destroy();
      state.rebuyField = AmountInput({ units: def, min: lo, max: hi, unit: state.unit, scale: 'ladder', presets, label: 'Rebuy amount', rangeLabel: 'Rebuy', onChange: label });
      state.rebuyField.unitKey = state.unit;
      state.rebuyField.input.id = 'rebuy-input';
      slot.replaceChildren(state.rebuyField.el);
    }
    label();
  } else {
    if (state.rebuyField) { state.rebuyField.destroy(); state.rebuyField = null; slot.replaceChildren(); }
    rebuyBtn.classList.add('hidden');
    brokeMsg.classList.remove('hidden');
  }
}

// ─── Leaderboard ───────────────────────────────────────────────────
function renderLeaderboard(entries) {
  state.lastLb = entries;
  const me = (state.gameState?.players[state.myIdx]?.name || '').toLowerCase();
  $('leaderboard-entries').innerHTML = entries.map((e, i) => `
    <div class="lb-row ${String(e.display || e.name || '').toLowerCase() === me ? 'lb-me' : ''}">
      <span class="lb-rank">${i + 1}</span>
      <span class="lb-name">${esc(e.display || e.name)}</span>
      <span class="lb-balance">${fmt(e.netCents ?? e.balance)}</span>
    </div>`).join('') || '<div class="empty-note">No standings yet</div>';
}

// ─── Timers (one 200ms tick drives rings, seat bars, countdowns) ──
function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function tickTimer() {
  const gs = state.gameState;
  if (!gs || !$('game-screen').classList.contains('active')) return;

  if (state.blindEndAt && gs.blindsEnabled) {
    const rem = state.blindEndAt - Date.now();
    $('pl-next').textContent = fmtClock(rem);
    $('pl-next-wrap').classList.toggle('warn', rem <= 30000);
  }

  if (state.turnEndAt == null) { state.lastSecs = null; return; }
  const rem  = Math.max(0, state.turnEndAt - Date.now());
  const secs = Math.ceil(rem / 1000);
  const frac = Math.min(1, rem / TURN_MS);

  const seat = document.querySelector('#player-seats .seat.active');
  if (seat) {
    seat.querySelector('.seat-timer i')?.style.setProperty('--t', frac.toFixed(3));
    const st = seat.querySelector('.seat-status.secs');
    if (st) st.textContent = secs + 's';
  }

  const ring = $('turn-ring');
  $('my-turn-ring').style.setProperty('--t', frac.toFixed(3));
  $('my-turn-timer').textContent = secs;
  ring.classList.toggle('low', secs <= 8);
  if (state.barMode === 'wait') {
    $('bar-status-main').textContent = `Waiting for ${state.waitName} (${secs}s)`;
  }

  if (secs !== state.lastSecs) {
    state.lastSecs = secs;
    if (secs <= 6 && secs > 0 && secs % 2 === 0) playSound('timer_warn');
  }
}

// ─── Chips ────────────────────────────────────────────────────────
const DENOMS = [500, 100, 25, 5, 1];

function chipStacksHtml(amount, maxCols = 3, cap = 6) {
  const cols = [];
  let rem = Math.max(0, Math.floor(amount));
  const sc = (state.unit === 'cents' && state.gameState?.bb) ? state.gameState.bb / CHIP_ART_BB : 1;
  for (const d of DENOMS) {
    if (cols.length >= maxCols) break;
    const val = d * sc;
    const c = Math.floor(rem / val);
    if (c > 0) { cols.push({ d, c: Math.min(c, cap) }); rem -= c * val; }
  }
  if (!cols.length && amount > 0) cols.push({ d: 1, c: 1 });
  return `<div class="stacks">${cols.map(col =>
    `<div class="stack">${Array.from({ length: col.c }, (_, k) => `<span class="chip c${col.d}" style="--k:${k}"></span>`).join('')}</div>`
  ).join('')}</div>`;
}

// ─── Table geometry (px, from the stage box; every size scales by --u) ─
function layoutTable() {
  const stage = $('stage');
  const u  = state.u;
  const sw = stage.clientWidth, sh = stage.clientHeight;
  const seatW = 168 * u, seatH = 56 * u;
  const AR = 1152 / 535;
  const H = Math.max(200, Math.min(sw * 0.9 / AR, (sh - 107 * u) / 0.8284));
  const W = H * AR;
  const spare = Math.max(0, (sh - 45 * u) - (62 * u + 0.8284 * H));
  const tbTop = 34 * u - 0.0256 * H + spare * 0.5;
  const tbLeft = sw / 2 - W / 2;
  const cx = sw / 2, cy = tbTop + 0.44 * H;
  const tb = $('table-box');
  tb.style.left   = tbLeft + 'px';
  tb.style.top    = tbTop + 'px';
  tb.style.width  = W + 'px';
  tb.style.height = H + 'px';
  const heroShift = 18 * u;
  const boardBot = 0.34 * H - 69 * u + 121 * u;
  const heroTop = 0.44 * H + 0.37 * 1.12 * H + heroShift - 152 * u;
  const mk = $('table-mark');
  if (mk) {
    const top = boardBot + 7 * u;
    mk.style.top = top + 'px';
    mk.style.height = Math.max(24 * u, heroTop - 7 * u - top) + 'px';
  }
  state.geo = { sw, sh, u, seatW, seatH, W, H, cx, cy, tbTop, heroShift, seats: {}, scales: {} };
  return state.geo;
}

// Seats sit on the slanted table's rim ellipse; theta is degrees clockwise from straight up.
const ELL_ANGLES = { ...SEAT_ANGLES, 5: [180, 230, 310, 50, 130], 6: [180, 225, 315, 0, 45, 135] };
function seatCenter(angle) {
  const g = state.geo;
  const a = angle * Math.PI / 180;
  const rx = g.W * 0.47 * 1.0, ry = g.H * 0.37 * 1.12;
  const x = g.cx + rx * Math.sin(a), y = g.cy - ry * Math.cos(a);
  const yTop = g.cy - g.H * 0.37, yBot = g.cy + ry;
  const sc = 0.85 + 0.15 * Math.min(1, Math.max(0, (y - yTop) / (yBot - yTop)));
  const mx = g.seatW / 2 + 6 * g.u;
  return [Math.min(Math.max(x, mx), g.sw - mx), y, sc];
}

function seatClientPos(idx) {
  const g = state.geo, st = $('stage');
  if (!g || !st) return [window.innerWidth / 2, window.innerHeight / 2];
  const r = st.getBoundingClientRect();
  const p = g.seats[idx] || [g.cx, g.cy];
  return [r.left + p[0], r.top + p[1]];
}

// ─── Game render ──────────────────────────────────────────────────
function renderGame() {
  const gs = state.gameState;
  if (!gs || !$('game-screen').classList.contains('active')) return;
  layoutTable();
  planHoleDeal(gs);
  renderSeats(gs);
  renderBets(gs);
  renderPot(gs);
  renderCommunity(gs);
  renderHero(gs);
  renderPlaque(gs);
  renderWaitPanel(gs);
  renderShowPanel(gs);
  renderControls(gs);
  renderLog(gs.log);

  const me = gs.players[state.myIdx];
  const so = $('btn-sit-out');
  const canSit = !!(me && gs.status === 'playing' && !(me.sittingOut && !me.sitOutRequest && !me.cardCount));
  so.disabled = !canSit;
  so.textContent = canSit && me.sitOutRequest ? 'Back in' : 'Sit out';
  so.title = !canSit ? 'Available while a hand is being played' : me.sitOutRequest ? 'Rejoin from the next hand' : 'Sit out from the next hand';
  so.classList.toggle('on', canSit && !!me.sitOutRequest);
}

function nextActiveSeat(fromIdx, players) {
  const n = players.length;
  for (let offset = 1; offset <= n; offset++) {
    const c = (fromIdx + offset) % n;
    if (!players[c].sittingOut && players[c].connected) return c;
  }
  return (fromIdx + 1) % n;
}

// ─── Action bubbles (short-lived, driven by lastAction changes) ───
const BUBBLE_MS = 2600;
const bubbles = {};

function noteActions(prev, gs) {
  gs.players.forEach((p, i) => {
    const key = `${gs.handNum}|${p.lastAction || ''}|${p.roundBet}|${p.chips}`;
    if (state.actKey[i] === key) return;
    state.actKey[i] = key;
    if (!p.lastAction || !prev) return;
    const was = prev?.players[i];
    if (was && was.lastAction === p.lastAction && was.roundBet === p.roundBet && prev.handNum === gs.handNum) return;
    let kind = p.lastAction.toLowerCase(), text;
    if (p.allIn && (p.lastAction === 'RAISE' || p.lastAction === 'CALL')) { kind = 'allin'; text = 'All-in'; }
    else if (p.lastAction === 'FOLD')  text = 'Fold';
    else if (p.lastAction === 'CHECK') text = 'Check';
    else if (p.lastAction === 'CALL')  text = `Call ${fmt(p.roundBet)}`;
    else if (p.lastAction === 'RAISE') {
      const opening = prev && prev.handNum === gs.handNum && prev.street === gs.street && prev.currentBet === 0;
      kind = opening ? 'bet' : 'raise';
      text = `${opening ? 'Bet' : 'Raise to'} ${fmt(p.roundBet)}`;
    } else return;
    bubbles[i] = { text, kind, t: Date.now() };
  });
}

// ─── Deal animation (deck -> seats / board) ─────────────────────
const DEAL_GAP = 90, DEAL_FLY = 380, DEAL_FLY_BOARD = 320;

function resetDeal() {
  state.dealTimers.forEach(clearTimeout);
  state.dealTimers = [];
  state.dealPend = {};
  const l = $('deal-layer');
  if (l) l.innerHTML = '';
}

function dealLand(key, flip) {
  delete state.dealPend[key];
  const el = document.querySelector(`[data-dk="${key}"]`);
  if (!el) return;
  el.classList.remove('dealwait');
  if (flip) { void el.offsetWidth; el.classList.add('flip-land'); }
}

function dealQueue(key, delay, flip, dur) {
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;
  state.dealPend[key] = 1;
  state.dealTimers.push(setTimeout(() => {
    const target = document.querySelector(`[data-dk="${key}"]`);
    const deck = document.querySelector('#puck-layer .deck');
    if (!target || !deck || !target.offsetWidth) { dealLand(key, false); return; }
    const t = target.getBoundingClientRect(), d = deck.getBoundingClientRect();
    const w = target.offsetWidth, h = target.offsetHeight;
    const cx = t.left + t.width / 2, cy = t.top + t.height / 2;
    const dx = d.left + d.width / 2 - cx, dy = d.top + d.height / 2 - cy;
    const rt = parseFloat(getComputedStyle(target).rotate) || 0;
    const r0 = rt + (Math.random() * 30 - 15);
    const s0 = d.width / w;
    let layer = $('deal-layer');
    if (!layer) { layer = document.createElement('div'); layer.id = 'deal-layer'; layer.className = 'deal-layer'; document.body.appendChild(layer); }
    const fl = document.createElement('div');
    fl.className = 'card back ' + (target.classList.contains('card-sm') ? 'card-sm' : 'card-xl');
    fl.style.cssText = `left:${(cx - w / 2).toFixed(1)}px;top:${(cy - h / 2).toFixed(1)}px;width:${w}px;height:${h}px`;
    layer.appendChild(fl);
    const tf = (x, y, s, r, sx) => `translate(${x}px,${y}px) scale(${s}) rotate(${r}deg) scaleX(${sx})`;
    const frames = [
      { transform: tf(dx, dy, s0, r0, 1), offset: 0 },
      { transform: tf(0, 0, 1, rt, 1), offset: flip ? 0.78 : 1 },
    ];
    if (flip) frames.push({ transform: tf(0, 0, 1, rt, 0.04), offset: 1 });
    const done = () => { fl.remove(); dealLand(key, flip); };
    const a = fl.animate(frames, { duration: dur, easing: 'cubic-bezier(.22,.8,.25,1)', fill: 'both' });
    a.onfinish = done;
    playSound('slide');
  }, delay));
}

function planHoleDeal(gs) {
  if (gs.status !== 'playing') return;
  const pk = `${gs.handNum}:plan`;
  if (state.dealt[pk]) return;
  const n = gs.players.length, myIdx = state.myIdx ?? 0;
  const seats = [];
  for (let j = 1; j <= n; j++) {
    const i = (gs.dealerIdx + j) % n;
    if (gs.players[i].cardCount > 0) seats.push(i);
  }
  if (!seats.length) return;
  state.dealt[pk] = 1;
  if (state.noDealHand === gs.handNum) return;
  let c = 0;
  for (let r = 0; r < 2; r++) {
    seats.forEach(i => {
      const hero = i === myIdx;
      dealQueue(hero ? `${gs.handNum}:h:${r}` : `${gs.handNum}:s${i}:${r}`, 120 + c++ * DEAL_GAP, hero, DEAL_FLY);
    });
  }
}

// ─── Seats ────────────────────────────────────────────────────────
function seatStatus(p) {
  if (p.connected === false && !p.isBot) return ['Offline', 'offline'];
  if (p.allIn)       return ['All-in', 'allin'];
  if (p.sittingOut)  return [p.sitOutRequest ? 'Away' : 'Joining', ''];
  if (p.isActive)    return ['', 'secs'];
  if (p.folded)      return ['Folded', ''];
  if (p.isBot)       return ['CPU', ''];
  return ['', ''];
}

function renderSeats(gs) {
  const g   = state.geo;
  const el  = $('player-seats');
  const n   = gs.players.length;
  const myIdx = state.myIdx ?? 0;
  const angles = ELL_ANGLES[Math.max(2, Math.min(8, n))];
  const sbIdx = gs.status === 'playing' ? nextActiveSeat(gs.dealerIdx, gs.players) : -1;
  const bbIdx = gs.status === 'playing' ? nextActiveSeat(sbIdx, gs.players) : -1;
  noteActions(state.prevForBubbles, gs);
  state.prevForBubbles = gs;

  const seatsNew = gs.players.map((p, i) => {
    const off = (i - myIdx + n) % n;
    const [x, y0, sc] = seatCenter(angles[off]);
    const hero = i === myIdx;
    const y = hero ? y0 + g.heroShift : y0;
    g.seats[i] = [x, y];
    g.scales[i] = sc;
    const peekUp = y > g.cy + 10 * g.u;
    const [stText, stCls] = seatStatus(p);
    const tag = i === sbIdx ? 'SB' : i === bbIdx ? 'BB' : '';

    let peek = '';
    const rev = state.reveal && state.reveal.handNum === gs.handNum && state.reveal.cards[p.name];
    if (!hero && rev) {
      const hn = state.reveal.names && state.reveal.names[p.name];
      peek = `<div class="seat-peek reveal ${peekUp ? 'up' : 'down'}">${rev.map(c => c ? faceCardHtml(c, 'md', 0, '', 'flip-in') : '<div class="card back card-md"></div>').join('')}${hn ? `<span class="peek-hand">${esc(hn)}</span>` : ''}</div>`;
    } else if (!hero && p.cardCount > 0 && !p.folded) {
      peek = `<div class="seat-peek ${peekUp ? 'up' : 'down'}">${Array.from({ length: p.cardCount }, (_, k) =>
        `<div class="card back card-sm${state.dealPend[`${gs.handNum}:s${i}:${k}`] ? ' dealwait' : ''}" data-dk="${gs.handNum}:s${i}:${k}"></div>`).join('')}</div>`;
    }

    const b = bubbles[i];
    let bubble = '';
    if (b && !hero) {
      const age = Date.now() - b.t;
      if (age < BUBBLE_MS) bubble = `<div class="seat-bubble k-${b.kind} ${peekUp ? 'below' : 'above'}" style="animation-delay:${-age}ms">${esc(b.text)}</div>`;
    }

    const cls = ['seat', hero ? 'hero' : '', peekUp ? '' : 'upper', p.isActive ? 'active' : '', p.folded ? 'folded' : '', p.sittingOut ? 'away' : '', state.winners?.has(p.name) ? 'winner' : ''].filter(Boolean).join(' ');
    const inner = `
      ${peek}
      <div class="seat-pill">
        <div class="seat-av">${avatarInner(p.avatar, p.profilePic)}</div>
        <div class="seat-info">
          <div class="seat-l1"><span class="seat-name" title="${esc(p.name)}">${esc(p.name)}</span>${tag ? `<span class="seat-tag ${tag.toLowerCase()}">${tag}</span>` : ''}</div>
          <div class="seat-l2"><span class="seat-chips">${fmt(p.chips)}</span>${stText || stCls === 'secs' ? `<span class="seat-status ${stCls}">${stText}</span>` : ''}</div>
        </div>
        ${p.isActive ? `<div class="seat-timer"><i style="--t:${state.turnEndAt ? Math.min(1, Math.max(0, (state.turnEndAt - Date.now()) / TURN_MS)).toFixed(3) : 1}"></i></div>` : ''}
      </div>
      ${bubble}
      ${hero ? hotColdHtml(handsNet(), 'hands') : ''}
    `;
    return { key: p.seatNo != null ? 's' + p.seatNo : 'n' + p.name, cls, idx: i, left: x.toFixed(1) + 'px', top: y.toFixed(1) + 'px', ss: sc.toFixed(3), inner, name: p.name, hero };
  });

  // Patch, do not rebuild: a seat node lives as long as its seat does, so hover, focus and an open menu survive every state.
  const live = state.seatEls || (state.seatEls = new Map());
  const keep = new Set();
  seatsNew.forEach((d, pos) => {
    keep.add(d.key);
    let node = live.get(d.key);
    if (!node) {
      node = document.createElement('div');
      node.tabIndex = 0;
      node.setAttribute('role', 'button');
      node.setAttribute('aria-haspopup', 'menu');
      node._inner = null;
      live.set(d.key, node);
    }
    if (node.className !== d.cls) node.className = d.cls;
    if (node.dataset.playerIdx !== String(d.idx)) node.dataset.playerIdx = d.idx;
    if (node.style.left !== d.left) node.style.left = d.left;
    if (node.style.top !== d.top) node.style.top = d.top;
    if (node.style.getPropertyValue('--ss') !== d.ss) node.style.setProperty('--ss', d.ss);
    const label = d.hero ? `${d.name}, you` : `${d.name}, seat ${d.idx + 1}`;
    if (node.getAttribute('aria-label') !== label) node.setAttribute('aria-label', label);
    if (node._inner !== d.inner) { node.innerHTML = d.inner; node._inner = d.inner; }
    if (el.children[pos] !== node) el.insertBefore(node, el.children[pos] || null);
  });
  for (const [k, node] of live) if (!keep.has(k)) { node.remove(); live.delete(k); }

  gs.players.forEach((p, i) => {
    if (prevChipsMap[i] !== undefined && prevChipsMap[i] !== p.chips) {
      const c = el.querySelector(`.seat[data-player-idx="${i}"] .seat-chips`);
      if (c) { c.classList.add('ticking'); setTimeout(() => c.classList.remove('ticking'), 300); }
    }
    prevChipsMap[i] = p.chips;
  });

  const act = gs.players.findIndex(p => p.isActive);
  const lamp = $('t-lamp');
  if (act >= 0 && g.seats[act]) {
    const tb = $('table-box');
    const x = (g.seats[act][0] - parseFloat(tb.style.left)) / g.W * 100;
    const yy = (g.seats[act][1] - parseFloat(tb.style.top)) / g.H * 100;
    lamp.style.setProperty('--lx', Math.min(95, Math.max(5, x)).toFixed(1) + '%');
    lamp.style.setProperty('--ly', Math.min(95, Math.max(5, yy)).toFixed(1) + '%');
  } else {
    lamp.style.setProperty('--lx', '50%');
    lamp.style.setProperty('--ly', '46%');
  }
}

// ─── Bets (chip stacks on the felt) + dealer puck ─────────────────
function betSpot(i, gs) {
  const g = state.geo;
  const n = gs.players.length;
  const myIdx = state.myIdx ?? 0;
  if (i === myIdx) return { x: g.cx, y: g.cy + g.H * 0.1, ux: 0, uy: -1 };
  const [sx, sy] = g.seats[i];
  let dx = g.cx - sx, dy = g.cy - sy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const hw = 46 * g.u, hh = 34 * g.u;
  const tex = Math.abs(ux) > 1e-6 ? (g.seatW / 2) / Math.abs(ux) : Infinity;
  const tey = Math.abs(uy) > 1e-6 ? (g.seatH / 2) / Math.abs(uy) : Infinity;
  const t = Math.min(tex, tey) + Math.abs(ux) * hw + Math.abs(uy) * hh + 6 * g.u;
  return { x: sx + ux * t, y: sy + uy * t, ux, uy };
}

// A bet stack must not sit on the pot text (ui defect 9): slide it sideways clear of the pot row.
function avoidPot(s) {
  const g = state.geo, row = $('pot-row'), st = $('stage');
  if (!row || !st || !row.firstChild) return s;
  const r = row.getBoundingClientRect(), o = st.getBoundingClientRect();
  if (!r.width) return s;
  const pad = 4 * g.u, hw = 46 * g.u, hh = 34 * g.u;
  const L = r.left - o.left - pad, R = r.right - o.left + pad, T = r.top - o.top - pad, B = r.bottom - o.top + pad;
  if (s.x + hw <= L || s.x - hw >= R || s.y + hh <= T || s.y - hh >= B) return s;
  const mid = (L + R) / 2;
  return { ...s, x: s.x < mid ? L - hw : R + hw };
}

function renderBets(gs) {
  const layer = $('bet-layer'), pucks = $('puck-layer');
  const g = state.geo;
  const myIdx = state.myIdx ?? 0;
  let bh = '';
  gs.players.forEach((p, i) => {
    if (!(p.roundBet > 0) || !g.seats[i]) return;
    const s = avoidPot(betSpot(i, gs));
    const key = `${gs.handNum}|${gs.street}|${i}|${p.roundBet}`;
    const fresh = state.betKey?.[i] !== key;
    (state.betKey ||= {})[i] = key;
    bh += `<div class="bet${i === myIdx ? ' hero-bet' : ''}" style="left:${s.x.toFixed(1)}px;top:${s.y.toFixed(1)}px${fresh ? '' : ';animation:none'}">${chipStacksHtml(p.roundBet, 3, 6)}<span class="bet-amt">${fmt(p.roundBet)}</span></div>`;
  });
  gs.players.forEach((p, i) => { if (!(p.roundBet > 0) && state.betKey) delete state.betKey[i]; });
  layer.innerHTML = bh;

  const d = gs.players[gs.dealerIdx];
  if (gs.status === 'playing' && d && g.seats[gs.dealerIdx]) {
    const [dsx, dsy] = g.seats[gs.dealerIdx];
    let pxp, pyp;
    if (gs.dealerIdx === myIdx) { pxp = g.cx + 118 * g.u; pyp = dsy - 38 * g.u; }
    else { const dir = Math.abs(g.cx - dsx) < g.seatW * 0.4 ? 1 : Math.sign(g.cx - dsx); pxp = dsx + dir * (g.seatW / 2 + 22 * g.u); pyp = dsy + 4 * g.u; }
    pucks.innerHTML = `<div class="puck" style="left:${pxp.toFixed(1)}px;top:${pyp.toFixed(1)}px">D</div>`;
  } else {
    pucks.innerHTML = '';
  }
}

// ─── Pot, community, hero ─────────────────────────────────────────
function renderPot(gs) {
  const row = $('pot-row');
  if (!(gs.pot > 0)) { row.innerHTML = ''; state.prevPot = 0; return; }
  const grow = gs.pot > state.prevPot;
  row.innerHTML = `<div class="pile">${chipStacksHtml(gs.pot, 3, 5)}</div><div class="pot-txt"><small>Pot</small><span class="pot-num">${fmt(gs.pot, { compact: true })}</span></div>`;
  if (grow) {
    row.classList.remove('pot-pulse'); void row.offsetWidth; row.classList.add('pot-pulse');
    playSound('chip');
  }
  state.prevPot = gs.pot;
}

function renderCommunity(gs) {
  const el = $('community-cards');
  const cards = gs.community || [];
  let prevCount = (state.commHand === gs.handNum) ? (state.commCount || 0) : 0;
  if (state.commHand !== gs.handNum && state.noDealHand === gs.handNum) prevCount = cards.length;
  for (let i = prevCount; i < cards.length; i++) {
    const key = `${gs.handNum}:c:${i}`;
    if (!state.dealt[key]) { state.dealt[key] = 1; dealQueue(key, 120 + (i - prevCount) * DEAL_GAP, true, DEAL_FLY_BOARD); }
  }
  el.innerHTML = cards.map((c, i) => {
    const key = `${gs.handNum}:c:${i}`;
    return faceCardHtml(c, 'xl', 0, `--i:${i};--n:${cards.length}`, state.dealPend[key] ? 'dealwait' : '').replace('<div class="card', `<div data-dk="${key}" class="card`);
  }).join('');
  state.commHand  = gs.handNum;
  state.commCount = cards.length;
}

function renderHero(gs) {
  const g = state.geo;
  const wrap = $('hero-cards-wrap');
  const me = gs.players[state.myIdx];
  const show = !!me && me.cardCount > 0 && state.myCards.length > 0;
  wrap.classList.toggle('on', show);
  wrap.classList.toggle('folded', !!me?.folded);
  if (!show) { $('hole-cards').innerHTML = ''; $('my-hand-label').innerHTML = ''; state.heroKey = ''; return; }
  wrap.style.position = 'absolute';
  wrap.style.left = (g.W / 2) + 'px';
  const hs = g.seats[state.myIdx] || [g.cx, g.cy + g.H * 0.4];
  wrap.style.top  = (hs[1] - g.tbTop - 152 * g.u) + 'px';

  const cards = state.myCards;
  const key = `${gs.handNum}|${cards.map(c => c.rank + c.suit).join('')}`;
  if (state.heroKey !== key) {
    state.heroKey = key;
    $('hole-cards').innerHTML = cards.map((c, i) => {
      const key = `${gs.handNum}:h:${i}`;
      const wait = state.dealPend[key];
      return faceCardHtml(c, 'xl', 0, wait ? '' : `animation-delay:${i * 0.08}s`, wait ? 'dealwait' : 'flip-in').replace('<div class="card', `<div data-dk="${key}" class="card`);
    }).join('');
  }

  const comm = gs.community || [];
  const label = comm.length >= 3 ? richHandLabel(evalHandLabel(cards, comm), cards, comm) : evalPreflopLabel(cards);
  $('my-hand-label').innerHTML = `<span class="hl-k">Your hand</span><span class="hl-v">${esc(label)}</span>`;
}

function renderMyCards() { if (state.gameState) renderHero(state.gameState); }

// ─── Plaque (header) ──────────────────────────────────────────────
function renderPlaque(gs) {
  const sb = gs.sb || 0, bb = gs.bb || 0;
  $('pl-blinds').textContent = `${fmt(sb)} / ${fmt(bb)}`;
  $('pl-level-wrap').classList.toggle('hidden', !gs.blindsEnabled);
  $('pl-next-wrap').classList.toggle('hidden', !gs.blindsEnabled);
  if (gs.blindsEnabled) {
    $('pl-level').textContent = (gs.blindLevel || 0) + 1;
    if (gs.blindNextMs == null) $('pl-next').textContent = '—';
  }
  $('pl-street').textContent = gs.status === 'playing' && gs.street ? gs.street.toUpperCase() : '—';
  const me = gs.players[state.myIdx];
  const inHand = gs.status === 'playing' && me && !me.folded;
  const toCall = me ? Math.max(0, gs.currentBet - (me.roundBet || 0)) : 0;
}

// ─── Action bar ───────────────────────────────────────────────────
function setBar(mode, main, sub, name) {
  if (mode === 'turn' && state.barMode !== 'turn') playSound('turn');
  state.barMode = mode;
  state.waitName = name || '';
  const m = $('bar-status-main');
  m.textContent = main;
  m.classList.toggle('me', mode === 'turn');
  $('bar-status-sub').textContent = sub || '';
  $('bar-status').dataset.mode = mode;
}

function renderControls(gs) {
  const me   = gs.players[state.myIdx];
  const fold = $('btn-fold'), call = $('btn-check-call'), rbtn = $('btn-raise');
  const la   = gs.legalActions || null;   // the server's answer: non-null only when it is my turn in a live hand
  const isMyTurn = gs.currentPlayerIdx === state.myIdx;
  const canAct = !!la && !!me && gs.status === 'playing';
  const canRaise = canAct && !!la.canRaise;
  // display arithmetic only (preselect buttons and labels off-turn); every rule comes from `la`
  const toCall = la ? la.toCall : (me ? Math.max(0, gs.currentBet - (me.roundBet || 0)) : 0);
  const callAmt = la ? la.callAmount : (me ? Math.min(toCall, me.chips) : 0);
  const allInCall = !!me && toCall > 0 && callAmt >= me.chips;

  call.querySelector('.act-main').textContent = la ? (la.canCheck ? 'Check' : (allInCall ? 'All-in' : 'Call')) : (toCall === 0 ? 'Check' : (allInCall ? 'All-in' : 'Call'));
  call.querySelector('.act-sub').innerHTML = toCall === 0 ? '&nbsp;' : fmt(callAmt);
  rbtn.querySelector('.act-main').textContent = gs.currentBet === 0 ? 'Bet' : 'Raise';

  // Pre-select applies while waiting on someone else with a live hand
  const live = !!me && gs.status === 'playing' && !me.folded && !me.allIn && !me.sittingOut && me.cardCount > 0;
  const showPre = live && !isMyTurn;
  state.preCtx = { toCall, callAmt };
  renderPreselect(showPre, toCall, callAmt);

  // Status / helper line
  state.helper = null;
  if (!me) setBar('idle', 'Spectating', '');
  else if (me.chips === 0 && !me.allIn && gs.status === 'playing' && !me.cardCount) setBar('idle', state.spectating ? 'Spectating' : 'Out of chips', '');
  else if (gs.status === 'waiting') setBar('idle', 'Waiting for players', 'Betting opens when the hand is dealt');
  else if (me.sittingOut && !me.sitOutRequest && !me.cardCount) setBar('idle', 'Watching this hand', 'Dealt in next hand');
  else if (gs.status === 'waiting_next') setBar('idle', 'Next hand starting', 'Hang tight');
  else if (me.folded) setBar('idle', 'You folded', 'Next hand soon');
  else if (me.allIn) setBar('idle', "You're all-in", 'Good luck');
  else if (canAct) {
    state.helper = { toCall, callAmt, allInCall, pot: gs.pot, chips: me.chips, roundBet: me.roundBet || 0, canRaise };
    setBar('turn', toCall ? `${allInCall ? 'All-in' : 'Call'} ${fmt(callAmt)} to win ${fmt(gs.pot + callAmt)}` : `Check, or bet to win ${fmt(gs.pot)}`, '');
    updateHelper();
  } else {
    const who = gs.players[gs.currentPlayerIdx];
    if (who) setBar('wait', `Waiting for ${who.name}`, '', who.name);
    else setBar('idle', 'Waiting', '');
  }
  $('action-bar').classList.toggle('waiting', gs.status === 'waiting');
  $('turn-ring').classList.toggle('idle', state.barMode === 'idle');
  if (state.barMode === 'idle') { $('my-turn-timer').innerHTML = '&nbsp;'; $('my-turn-ring').style.setProperty('--t', 0); }

  fold.disabled = !(canAct && la.canFold);
  call.disabled = !(canAct && (la.canCheck || la.canCall));
  rbtn.disabled = !canRaise;
  renderRaiseBox(gs, me, la, canRaise, toCall);
}

// Raise box: one AmountInput bounded by the server's [minRaiseTo, maxRaiseTo]. While the box is focused and dirty a game_state does not
// rewrite the text (S1-2): only the slider, labels and bounds follow; the text syncs on blur or submit.
function renderRaiseBox(gs, me, la, canRaise, toCall) {
  const box = $('raise-box'), mount = $('raise-mount');
  box.classList.toggle('off', !canRaise);
  let f = state.raiseField;
  if (f && (state.raiseCfg !== `${state.unit}|${gs.bb}`)) { f.destroy(); f.el.remove(); f = state.raiseField = null; }
  if (!canRaise) {
    state.raiseDecision = '';
    if (f) { f.input.disabled = f.slider.disabled = true; f.el.querySelectorAll('button').forEach(b => { b.disabled = true; }); }
    return;
  }
  const lo = la.minRaiseTo, hi = la.maxRaiseTo;
  const clampV = v => Math.max(lo, Math.min(hi, niceRound(v)));
  const preflop = gs.street === 'preflop';
  const base = gs.currentBet > gs.bb ? gs.currentBet : gs.bb;
  const potRaise = fr => gs.currentBet + fr * (gs.pot + toCall);
  const presets = (preflop
    ? [['2.5x', clampV(2.5 * base)], ['3x', clampV(3 * base)], ['4x', clampV(4 * base)]]
    : [['Min', lo], ['\u00BD Pot', clampV(potRaise(0.5))], ['Pot', clampV(potRaise(1))]]
  ).map(([label, units]) => ({ label, units })).concat([{ label: 'All-in', units: hi }]);
  state.raiseMax = hi;
  if (!f) {
    f = state.raiseField = AmountInput({
      units: lo, min: lo, max: hi, unit: state.unit, scale: 'raise', bb: gs.bb, presets, label: 'Raise to', rangeLabel: 'Raise to',
      onChange: () => { syncRaiseSub(); updateHelper(); },
      onCommit: v => { playSound('raise'); sendAction('raise', v); },
    });
    state.raiseCfg = `${state.unit}|${gs.bb}`;
    f.input.id = 'raise-input'; f.input.classList.add('raise-input');
    mount.replaceChildren(f.el);
    state.raiseDecision = `${gs.handNum}|${gs.street}|${gs.currentBet}|${me.chips}`;
  } else {
    f.input.disabled = false;
    f.el.querySelectorAll('button').forEach(b => { b.disabled = false; });
    f.setBounds({ min: lo, max: hi, presets, allIn: hi });
    const d = `${gs.handNum}|${gs.street}|${gs.currentBet}|${me.chips}`;
    if (state.raiseDecision !== d) { state.raiseDecision = d; f.set(lo, { source: 'server' }); }
  }
  syncRaiseSub();
}
function syncRaiseSub() {
  const f = state.raiseField, v = f ? f.value() : null;
  $('raise-sub').textContent = v === null ? '\u2014' : fmt(v);
}

// Helper line above the bar on the player's turn: stack left after calling / after the dialled raise
function updateHelper() {
  const h = state.helper;
  if (!h) return;
  const afterCall = fmt(h.chips - h.callAmt);
  let sub = `${afterCall} behind after ${h.toCall ? 'calling' : 'checking'}`;
  const v = state.raiseField ? state.raiseField.value() : null;
  if (h.canRaise && v) {
    const put = v - h.roundBet;
    sub += ` \u00B7 ${fmt(h.chips - put)} after ${v >= state.raiseMax ? 'all-in' : 'raising to ' + fmt(v)}`;
  }
  $('bar-status-sub').textContent = sub;
}

function renderPreselect(show, toCall, callAmt) {
  $('bar-acts').classList.toggle('hidden', show);
  $('bar-pre').classList.toggle('hidden', !show);
  $('action-bar').classList.toggle('preselect', show);
  if (!show) { state.pre = null; return; }
  let pre = state.pre;
  if (pre && pre.mode === 'call' && pre.amount !== toCall) pre = state.pre = null;
  const cf = $('pre-checkfold'), cl = $('pre-call');
  cl.disabled = toCall <= 0;
  $('pre-call-sub').innerHTML = toCall > 0 ? fmt(callAmt) : '&nbsp;';
  cf.classList.toggle('on', !!pre && pre.mode === 'checkfold');
  cl.classList.toggle('on', !!pre && pre.mode === 'call' && toCall > 0);
  cf.setAttribute('aria-pressed', cf.classList.contains('on'));
  cl.setAttribute('aria-pressed', cl.classList.contains('on'));
}

function sendPreselect(mode) {
  const ctx = state.preCtx || {};
  const cur = state.pre && state.pre.mode;
  if (cur === mode) {
    state.pre = null;
    state.socket.emit('preselect', { roomId: state.roomId, mode: null });
  } else if (mode === 'checkfold') {
    state.pre = { mode, amount: 0 };
    state.socket.emit('preselect', { roomId: state.roomId, mode });
  } else if (mode === 'call' && ctx.toCall > 0) {
    state.pre = { mode, amount: ctx.toCall };
    state.socket.emit('preselect', { roomId: state.roomId, mode, amount: ctx.toCall });
  }
  if (state.gameState) renderPreselect(true, ctx.toCall || 0, ctx.callAmt || 0);
}

// ─── Action sends ─────────────────────────────────────────────────
function bindActions() {
  $('btn-fold').addEventListener('click', () => doFold());
  $('btn-check-call').addEventListener('click', () => doCall());
  $('btn-raise').addEventListener('click', () => doRaise());

  $('pre-checkfold').addEventListener('click', () => sendPreselect('checkfold'));
  $('pre-call').addEventListener('click', () => sendPreselect('call'));

  document.addEventListener('keydown', e => {
    if (!$('game-screen').classList.contains('active')) return;
    if (e.ctrlKey || e.metaKey || e.altKey || state.barMode !== 'turn' || PingUI.isOverlayOpen()) return;
    const t = e.target;
    const inText = (t.tagName === 'INPUT' && t.type !== 'range' && t.id !== 'raise-input') || t.tagName === 'TEXTAREA';
    if (inText) return;
    const inRaiseInput = t.id === 'raise-input';
    const k = e.key, f = state.raiseField;
    if (!inRaiseInput && (k === 'f' || k === 'F')) { e.preventDefault(); doFold(); }
    else if (!inRaiseInput && (k === 'c' || k === 'C')) { e.preventDefault(); doCall(); }
    else if (!inRaiseInput && (k === 'r' || k === 'R')) { e.preventDefault(); if (f && !f.input.disabled) { f.focus(); f.input.select(); } }
    else if (k === 'ArrowUp' || k === 'ArrowDown') {
      if (f && !$('btn-raise').disabled && !inRaiseInput) {
        e.preventDefault();
        const bb = state.gameState?.bb || 1, b = f.bounds(), cur = f.value() ?? b.min;
        f.set(Math.max(b.min, Math.min(b.max, cur + (k === 'ArrowUp' ? bb : -bb))), { source: 'key' });
      }
    }
    else if (k === 'Enter' && !inRaiseInput && t.tagName !== 'BUTTON') { e.preventDefault(); doRaise(); }
  });
}

function doFold() {
  if ($('btn-fold').disabled) return;
  playSound('fold'); sendAction('fold');
}

function doCall() {
  const gs = state.gameState; if (!gs || $('btn-check-call').disabled) return;
  const la = gs.legalActions;
  const action = la && la.canCheck ? 'check' : 'call';
  playSound(action === 'check' ? 'check' : 'chip');
  sendAction(action);
}

// Raise button: the AmountInput validates (range, all-in confirm) and calls onCommit -> sendAction('raise', raise-TO units).
function doRaise() {
  if ($('btn-raise').disabled || !state.raiseField) return;
  state.raiseField.submit();
}

function sendAction(action, amount = 0) {
  state.socket.emit('player_action', { roomId: state.roomId, action, amount });
  $('btn-fold').disabled = $('btn-check-call').disabled = $('btn-raise').disabled = true;
  if (state.raiseField) { state.raiseField.input.disabled = state.raiseField.slider.disabled = true; }
  $('raise-box').classList.add('off');
  state.barMode = 'sent';
}

// ─── Hand log (street groups, coloured names, auto-scroll at bottom) ─
const NAME_COLORS = ['#E9B872', '#8FD3A8', '#F29B8B', '#8EC5D6', '#E3C86F', '#C9B38E', '#B7D68A', '#E6A37A'];
function nameColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return NAME_COLORS[h % NAME_COLORS.length];
}
const nm = name => `<span class="n" style="color:${nameColor(name)}">${esc(name)}</span>`;
const redSuits = s => esc(s).replace(/([0-9AJQK]+)([♥♦])/g, '<span class="r">$1$2</span>');

function mergeLog(entries) {
  const all = state.logAll;
  let k = Math.min(all.length, entries.length);
  for (; k > 0; k--) {
    let ok = true;
    for (let j = 0; j < k; j++) if (all[all.length - k + j] !== entries[j]) { ok = false; break; }
    if (ok) break;
  }
  for (let j = k; j < entries.length; j++) all.push(entries[j]);
  if (all.length > 300) all.splice(0, all.length - 300);
}

function logLineHtml(line) {
  let m;
  if ((m = line.match(/^--- Hand #(\d+)\s*·?\s*(.*?)\s*---$/))) return `<div class="log-head">Hand ${esc(m[1])}${m[2] ? ` <span>${esc(m[2].replace(/^([\d,]+)\/([\d,]+)$/, (_, a, b) => logAmt(a) + '/' + logAmt(b)))}</span>` : ''}</div>`;
  if (/^--- Showdown ---$/.test(line)) return '<div class="log-head sub">Showdown</div>';
  if ((m = line.match(/^Dealer: (.+)$/))) return `<div class="log-line log-dim">Dealer ${nm(m[1])}</div>`;
  if ((m = line.match(/^(.+) posts (SB|BB) ([\d,]+)$/))) return `<div class="log-line log-dim">${nm(m[1])} posts ${m[2]} <b>${esc(logAmt(m[3]))}</b></div>`;
  if ((m = line.match(/^(.+) wins ([\d,]+)(?: with (.+))?$/))) return `<div class="log-line log-win">${nm(m[1])} wins <b>${esc(logAmt(m[2]))}</b>${m[3] ? ` with ${esc(m[3])}` : ''}</div>`;
  if ((m = line.match(/^(.+) raises to ([\d,]+)$/))) return `<div class="log-line">${nm(m[1])} raises to <b>${esc(logAmt(m[2]))}</b></div>`;
  if ((m = line.match(/^(.+) calls ([\d,]+)( \(all-in\))?$/)))     return `<div class="log-line">${nm(m[1])} calls <b>${esc(logAmt(m[2]))}</b>${m[3] ? ' (all-in)' : ''}</div>`;
  if ((m = line.match(/^(.+) (folds|checks)$/)))     return `<div class="log-line ${m[2] === 'folds' ? 'log-dim' : ''}">${nm(m[1])} ${m[2]}</div>`;
  if ((m = line.match(/^(Flop|Turn|River): (.*)$/))) return `<div class="log-line log-board">${m[1]} <span class="cards">${redSuits(m[2])}</span></div>`;
  if (line.startsWith('★')) return `<div class="log-line log-board">${esc(line)}</div>`;
  return `<div class="log-line">${esc(line)}</div>`;
}

const logAmt = t => fmt(Number(String(t).replace(/,/g, '')));
function renderLog(entries) {
  mergeLog(entries || []);
  const el = $('log-entries');
  const top = el.scrollTop;
  el.innerHTML = state.logAll.map(logLineHtml).join('');
  el.scrollTop = state.logPinned ? el.scrollHeight : top;
}

// ─── Throw tray ───────────────────────────────────────────────────
function showThrowTray(playerIdx, nearEl) {
  if (activeTray) { activeTray.remove(); activeTray = null; }
  const gs = state.gameState;
  if (!gs?.players[playerIdx] || !state.roomId) return;

  const rect = nearEl.getBoundingClientRect();
  const tray = document.createElement('div');
  tray.className = 'throw-tray';
  tray.innerHTML = `
    <div class="throw-tray-label">Throw at <strong>${esc(gs.players[playerIdx].name)}</strong></div>
    <div class="throw-options">
      ${['💣', '🍅', '💦', '🎉'].map(e => `<div class="throw-option" data-item="${e}">${art('throws', e)}</div>`).join('')}
    </div>`;

  const trayW = 168 * state.u;
  const rawCx = rect.left + rect.width / 2;
  const cx    = Math.min(Math.max(rawCx, trayW / 2 + 8), window.innerWidth - trayW / 2 - 8);
  let   cy    = rect.bottom + 6;
  if (cy + 96 * state.u > window.innerHeight) cy = rect.top - 96 * state.u;

  tray.style.cssText = `position:fixed;left:${cx}px;top:${cy}px;transform:translateX(-50%);z-index:60;`;
  document.body.appendChild(tray);
  activeTray = tray;

  tray.querySelectorAll('.throw-option').forEach(opt => {
    opt.addEventListener('click', e => {
      e.stopPropagation();
      state.socket.emit('throw_item', { roomId: state.roomId, targetIdx: playerIdx, item: opt.dataset.item });
      tray.remove(); activeTray = null;
    });
  });

  const autoClose = setTimeout(() => { if (activeTray === tray) { tray.remove(); activeTray = null; } }, 4000);
  const outside = e => {
    if (!tray.contains(e.target)) {
      clearTimeout(autoClose); tray.remove(); activeTray = null;
      document.removeEventListener('click', outside);
    }
  };
  setTimeout(() => document.addEventListener('click', outside), 10);
}

// ─── Projectiles / splats (client coordinates) ────────────────────
function animateProjectile(item, fromPos, toPos) {
  const [sx, sy] = fromPos, [ex, ey] = toPos;
  const dx = ex - sx, dy = ey - sy;
  const arc = Math.min(110, Math.hypot(dx, dy) * 0.36 + 28);

  const proj = document.createElement('div');
  proj.className = 'throw-projectile';
  proj.innerHTML = art('throws', item);
  proj.style.cssText = `position:fixed;left:${sx}px;top:${sy}px;z-index:9300;font-size:${28 * state.u}px;width:${44 * state.u}px;pointer-events:none;transform:translate(-50%,-50%);`;
  document.body.appendChild(proj);

  proj.animate([
    { transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', offset: 0 },
    { transform: `translate(calc(-50% + ${dx * 0.45}px),calc(-50% + ${dy * 0.45 - arc}px)) scale(1.4) rotate(185deg)`, offset: 0.45 },
    { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(0.35) rotate(380deg)`, offset: 1 },
  ], { duration: 680, easing: 'ease-out', fill: 'forwards' }).onfinish = () => {
    proj.remove(); showSplat(item, ex, ey);
  };
}

const SPLAT_FX = { '💣': 'bomb-explosion', '🍅': 'tomato-splat', '💦': 'water-splash', '🎉': 'party-popper-burst' };

function fxImg(name, x, y, size, z) {
  const el = document.createElement('img');
  el.src = `images/fx/${name}.png`;
  el.alt = '';
  el.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:${z || 9301};width:${size * state.u}px;height:auto;pointer-events:none;transform:translate(-50%,-50%);`;
  document.body.appendChild(el);
  return el;
}

function showSplat(item, x, y) {
  playSound('splat');
  const name = SPLAT_FX[item];
  if (!name) return;
  if (item === '💣' && window.PingJuice) {
    PingJuice.burst('bomb', x, y, { size: 300 * state.u, ms: 900 });
    PingJuice.shockwave(x, y, { size: 260 * state.u });
    PingJuice.screenShake(1, 500); PingJuice.sfx('bombBoom');
    PingJuice.burst('glitter', x, y, { size: 220 * state.u, ms: 700, delay: 120 });
    return;
  }
  const el = fxImg(name, x, y, 170);
  const settle = item === '🍅' ? 1.05 : 1.0;
  el.animate([
    { opacity: 1, transform: 'translate(-50%,-50%) scale(0.1) rotate(-8deg)' },
    { opacity: 1, transform: `translate(-50%,-50%) scale(${1.15 * settle}) rotate(2deg)`, offset: 0.22 },
    { opacity: 1, transform: `translate(-50%,-50%) scale(${settle}) rotate(0deg)`, offset: 0.55 },
    { opacity: 0, transform: `translate(-50%,-44%) scale(${0.95 * settle})`, offset: 1 },
  ], { duration: item === '🍅' ? 1500 : 1100, easing: 'ease-out' }).onfinish = () => el.remove();
  if (item === '💣') {
    const sm = fxImg('smoke-puff', x, y - 20 * state.u, 80, 9302);
    sm.animate([
      { opacity: 0, transform: 'translate(-50%,-30%) scale(0.5)' },
      { opacity: 0.85, transform: 'translate(-50%,-90%) scale(1)', offset: 0.35 },
      { opacity: 0, transform: 'translate(-50%,-190%) scale(1.5)', offset: 1 },
    ], { duration: 1700, delay: 250, fill: 'backwards' }).onfinish = () => sm.remove();
  }
}

function showFloatingSticker(emoji, fromName) {
  const gs = state.gameState, idx = gs ? gs.players.findIndex(p => p.name === fromName) : -1;
  const [x, y] = idx >= 0 ? seatClientPos(idx) : seatClientPos(-1);
  const el = document.createElement('div');
  el.className = 'floating-sticker';
  el.innerHTML = `<div class="float-emoji">${art('stickers', emoji)}</div><div class="float-from">${esc(fromName)}</div>`;
  el.style.cssText = `position:fixed;left:${x}px;top:${y - 40 * state.u}px;z-index:9300;pointer-events:none;transform:translate(-50%,-50%);`;
  document.body.appendChild(el);
  const done = () => el.remove();
  el.animate([
    { opacity: 0, transform: 'translate(-50%,-50%) scale(0.2)' },
    { opacity: 1, transform: 'translate(-50%,-60%) scale(1.25)', offset: 0.2 },
    { opacity: 1, transform: 'translate(-50%,-90%) scale(1)', offset: 0.7 },
    { opacity: 0, transform: 'translate(-50%,-120%) scale(0.85)', offset: 1 },
  ], { duration: 1700, fill: 'forwards' }).onfinish = done;
  setTimeout(done, 2200);
}

function showWinFloat(amount) {
  const g = state.geo, st = $('stage');
  if (!g || !st) return;
  const r = st.getBoundingClientRect();
  const [mx, my] = seatClientPos(state.myIdx);
  const px = r.left + g.cx, py = r.top + g.cy - g.H * 0.12;
  const el = document.createElement('div');
  el.className = 'win-float';
  el.textContent = `+${fmt(amount)}`;
  el.style.cssText = `position:fixed;left:${px}px;top:${py}px;z-index:70;pointer-events:none;transform:translate(-50%,-50%);`;
  document.body.appendChild(el);
  const dx = mx - px, dy = my - py;
  el.animate([
    { opacity: 0, transform: 'translate(-50%,-50%) scale(0.4)' },
    { opacity: 1, transform: 'translate(-50%,-50%) scale(1.35)', offset: 0.1 },
    { opacity: 1, transform: `translate(calc(-50% + ${dx * 0.75}px),calc(-50% + ${dy * 0.75}px)) scale(1)`, offset: 0.78 },
    { opacity: 0, transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(0.7)`, offset: 1 },
  ], { duration: 950, easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)' }).onfinish = () => el.remove();
}

// ─── Sound FX (Web Audio) ─────────────────────────────────────────
let _audioCtx = null;
function audioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

function playSound(type) {
  if ((type === 'chip' || type === 'raise') && window.PingJuice) PingJuice.sfx('chipClink', { minGap: 70 });
  if (window.PPSound) return PPSound.play(type); // sound.js owns audio; legacy synth below is fallback
  if (!state.soundOn) return;
  try {
    const ctx  = audioCtx();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    const play = (freq, vol, dur, wave = 'sine', freqEnd) => {
      const osc = ctx.createOscillator();
      osc.type = wave;
      osc.frequency.value = freq;
      if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, ctx.currentTime + dur);
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
      osc.connect(gain);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + dur);
    };
    const arp = (notes, step, vol, dur) => notes.forEach((f, i) => {
      const g2 = ctx.createGain(), o2 = ctx.createOscillator();
      g2.connect(ctx.destination); o2.connect(g2); o2.frequency.value = f;
      const t = ctx.currentTime + i * step;
      g2.gain.setValueAtTime(vol, t);
      g2.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o2.start(t); o2.stop(t + dur);
    });
    switch (type) {
      case 'deal':  play(900, 0.06, 0.055); break;
      case 'chip':  play(1400, 0.10, 0.07, 'sine', 700); break;
      case 'fold':  play(280, 0.06, 0.12, 'sine', 190); break;
      case 'check': play(600, 0.05, 0.06); break;
      case 'raise': play(520, 0.08, 0.06); setTimeout(() => play(700, 0.08, 0.06), 70); break;
      case 'win':   arp([523, 659, 784, 1047], 0.1, 0.10, 0.22); break;
      case 'splat': play(140, 0.14, 0.18, 'sawtooth', 50); break;
      case 'timer_warn': play(880, 0.05, 0.08); break;
      case 'blinds_up':  arp([330, 415, 523, 622, 784], 0.09, 0.11, 0.35); break;
    }
  } catch {}
}

// ─── Card faces (SVG: indices on the edge, pips, face-card frames) ─
const PIPS = {
  'A':  [[50, 70, 40]],
  '2':  [[50, 34], [50, 106]],
  '3':  [[50, 34], [50, 70], [50, 106]],
  '4':  [[33, 34], [67, 34], [33, 106], [67, 106]],
  '5':  [[33, 34], [67, 34], [50, 70], [33, 106], [67, 106]],
  '6':  [[33, 34], [67, 34], [33, 70], [67, 70], [33, 106], [67, 106]],
  '7':  [[33, 34], [67, 34], [50, 52], [33, 70], [67, 70], [33, 106], [67, 106]],
  '8':  [[33, 34], [67, 34], [50, 52], [33, 70], [67, 70], [50, 88], [33, 106], [67, 106]],
  '9':  [[33, 32], [67, 32], [33, 57], [67, 57], [50, 70], [33, 83], [67, 83], [33, 108], [67, 108]],
  '10': [[33, 32], [67, 32], [50, 44], [33, 57], [67, 57], [33, 83], [67, 83], [50, 96], [33, 108], [67, 108]],
};
const SUIT_SYM = { '♠': 's-spade', '♥': 's-heart', '♦': 's-diamond', '♣': 's-club' };

function faceCardSvg(card) {
  const sym = SUIT_SYM[card.suit] || 's-spade';
  const r = String(card.rank);
  const fs = r === '10' ? 20 : 25;
  const index = `<text x="${r === '10' ? 3 : 6}" y="25" font-family="Libre Baskerville, Georgia, serif" font-weight="700" font-size="${fs}" fill="currentColor"${r === '10' ? ' letter-spacing="-2"' : ''}>${esc(r)}</text><use href="#${sym}" x="6" y="29" width="15" height="15"/>`;
  let body;
  if (PIPS[r]) {
    body = PIPS[r].map(([x, y, s]) => {
      const sz = s || 20;
      return `<use href="#${sym}" x="${x - sz / 2}" y="${y - sz / 2}" width="${sz}" height="${sz}"${y > 70 ? ` transform="rotate(180 ${x} ${y})"` : ''}/>`;
    }).join('');
  } else {
    const file = r + ({ '♠': 'S', '♥': 'H', '♦': 'D', '♣': 'C' }[card.suit] || 'S');
    body = `<rect x="24" y="30" width="52" height="80" rx="3" fill="#EBDDB8" stroke="#8A6A2B" stroke-width="1.2"/>
      <image href="/images/faces/${file}.png" x="24.5" y="33" width="51" height="76" preserveAspectRatio="xMidYMax meet"/>`;
  }
  return `<svg viewBox="0 0 100 140" aria-hidden="true">${index}<g transform="rotate(180 50 70)">${index}</g>${body}</svg>`;
}

function faceCardHtml(card, size = 'md', delay = 0, style = '', extra = '') {
  const red = card.suit === '♥' || card.suit === '♦';
  const st = `${style}${delay ? `;animation-delay:${delay * 0.07}s` : ''}`;
  return `<div class="card face card-${size} ${red ? 'red' : 'black'} ${extra}"${st ? ` style="${st}"` : ''}>${faceCardSvg(card)}</div>`;
}

// ─── Showdown (non-modal plaque on the felt + winners' cards at the seats) ─
let sdTimer = null;

// Keep a centred (translateX(-50%)) plaque inside the stage so a long hand label is never cut by the screen edge.
function clampToStage(el) {
  const st = $('stage'); if (!st) return;
  const w = el.offsetWidth, sw = st.clientWidth, m = 8;
  const c = parseFloat(el.style.left) || sw / 2;
  el.style.left = Math.max(w / 2 + m, Math.min(sw - w / 2 - m, c)) + 'px';
}

function renderShowdown(winners, pot, reveals) {
  const gs = state.gameState;
  const ov = $('showdown-overlay');
  const g  = state.geo;
  state.reveal = { handNum: gs?.handNum, cards: {}, names: {} };
  (reveals || winners).forEach(w => { if (w.cards?.length) { state.reveal.cards[w.name] = w.cards; state.reveal.names[w.name] = richHandLabel(w.handName || '', w.cards, gs?.community); } });
  state.winners = new Set(winners.map(w => w.name));

  // winners = pot winners only (a seat that just got a refund is not listed); amount = what they took, net = their gain over their own bets
  $('showdown-content').innerHTML = winners.map(w => `
    <div class="sd-row">
      <span class="showdown-winner-name">${esc(w.name)}</span>
      <span class="showdown-hand-name">${esc(richHandLabel(w.handName || '', w.cards, gs?.community))}</span>
      <span class="showdown-pot">wins <strong>${Number.isFinite(w.amount) ? fmt(w.amount) : ''}</strong>${Number.isFinite(w.net) && w.net !== w.amount ? ` <small class="sd-net ${w.net > 0 ? 'pos' : w.net < 0 ? 'neg' : ''}">net ${w.net > 0 ? '+' : ''}${fmt(w.net)}</small>` : ''}</span>
    </div>`).join('');

  ov.classList.remove('hidden');
  if (g) {
    ov.style.left = (g.cx) + 'px';
    ov.style.top  = (g.cy - 158 * g.u) + 'px';
    const cards = document.querySelectorAll('#community-cards .card');
    if (cards.length) {
      const sr = $('stage').getBoundingClientRect();
      const bottom = Math.max(...[...cards].map(c => c.getBoundingClientRect().bottom));
      ov.style.top = (bottom - sr.top + 10 * g.u) + 'px';
    }
  }
  ov.classList.toggle('split', winners.length > 1);
  clampToStage(ov);
  if (state.gameState) renderSeats(state.gameState);

  const myName = gs?.players[state.myIdx]?.name;
  if (myName && winners.some(w => w.name === myName)) spawnConfetti(state.myIdx);

  clearInterval(sdTimer);
  const sdMs = state.sdMs || 5000;
  $('countdown').textContent = Math.ceil(sdMs / 1000);
  $('showdown-bar').style.setProperty('--t', 1);
  const t0 = Date.now();
  sdTimer = setInterval(() => {
    const left = Math.max(0, sdMs - (Date.now() - t0));
    $('countdown').textContent = Math.ceil(left / 1000);
    $('showdown-bar').style.setProperty('--t', (left / sdMs).toFixed(3));
    if (left <= 0) hideShowdown();
  }, 100);
}

function hideShowdown() {
  clearInterval(sdTimer);
  $('showdown-overlay').classList.add('hidden');
  state.winners = null;
}

function spawnConfetti(winnerIdx) {
  const g = state.geo, st = $('stage');
  if (!g || !st) return;
  const r = st.getBoundingClientRect();
  const x = r.left + g.cx, y = r.top + g.cy;
  const rays = fxImg('win-burst', x, y, 340, 8);
  rays.animate([
    { opacity: 0, transform: 'translate(-50%,-50%) scale(0.3) rotate(0deg)' },
    { opacity: 0.4, transform: 'translate(-50%,-50%) scale(1) rotate(25deg)', offset: 0.25 },
    { opacity: 0, transform: 'translate(-50%,-50%) scale(1.2) rotate(70deg)', offset: 1 },
  ], { duration: 2200, easing: 'ease-out' }).onfinish = () => rays.remove();
  const [px, py] = winnerIdx >= 0 ? seatClientPos(winnerIdx) : [x, y];
  const pop = fxImg('party-popper-burst', px, py, 200, 73);
  pop.animate([
    { opacity: 0, transform: 'translate(-50%,-50%) scale(0.2)' },
    { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: 0.2 },
    { opacity: 1, transform: 'translate(-50%,-56%) scale(1.05)', offset: 0.7 },
    { opacity: 0, transform: 'translate(-50%,-66%) scale(1.1)', offset: 1 },
  ], { duration: 1800, easing: 'ease-out' }).onfinish = () => pop.remove();
}

// ─── Hand labels ──────────────────────────────────────────────────
const RNKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const HAND_NAMES = ['High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush', 'Royal Flush'];
const MADE_LEN = [0, 1, 2, 1, 1, 5, 2, 1, 1, 1];

// Best-hand evaluation over any number of cards: { cat, tb } where tb is the tiebreak vector (made ranks first, then kickers)
function handEval(cards) {
  const v = c => RNKS.indexOf(c.rank) + 2;
  const byRank = {}, bySuit = {};
  for (const c of cards) { byRank[v(c)] = (byRank[v(c)] || 0) + 1; (bySuit[c.suit] = bySuit[c.suit] || []).push(v(c)); }
  const desc = a => [...a].sort((x, y) => y - x);
  const straightHigh = list => {
    const set = new Set(list);
    for (let h = 14; h >= 5; h--) {
      let ok = true;
      for (let k = 0; k < 5; k++) if (!set.has(h - k === 1 ? 14 : h - k)) { ok = false; break; }
      if (ok) return h;
    }
    return 0;
  };
  const flushVals = Object.values(bySuit).find(a => a.length >= 5);
  if (flushVals) {
    const h = straightHigh(flushVals);
    if (h) return { cat: h === 14 ? 9 : 8, tb: [h] };
  }
  const groups = Object.entries(byRank).map(([r, n]) => ({ r: +r, n })).sort((a, b) => b.n - a.n || b.r - a.r);
  const ofN = n => groups.filter(g => g.n === n).map(g => g.r);
  const quads = ofN(4), trips = ofN(3), pairs = ofN(2);
  const singles = desc(groups.map(g => g.r));
  if (quads.length) return { cat: 7, tb: [quads[0], desc(singles.filter(x => x !== quads[0]))[0]] };
  if (trips.length && (trips.length > 1 || pairs.length)) return { cat: 6, tb: [trips[0], desc([...trips.slice(1), ...pairs])[0]] };
  if (flushVals) return { cat: 5, tb: desc(flushVals).slice(0, 5) };
  const sh = straightHigh(Object.keys(byRank).map(Number));
  if (sh) return { cat: 4, tb: [sh] };
  if (trips.length) return { cat: 3, tb: [trips[0], ...singles.filter(x => x !== trips[0]).slice(0, 2)] };
  if (pairs.length >= 2) {
    const pp = desc(pairs).slice(0, 2);
    return { cat: 2, tb: [...pp, singles.filter(x => !pp.includes(x))[0]] };
  }
  if (pairs.length === 1) return { cat: 1, tb: [pairs[0], ...singles.filter(x => x !== pairs[0]).slice(0, 3)] };
  return { cat: 0, tb: singles.slice(0, 5) };
}

const RANK_PL = { 2: 'Twos', 3: 'Threes', 4: 'Fours', 5: 'Fives', 6: 'Sixes', 7: 'Sevens', 8: 'Eights', 9: 'Nines', 10: 'Tens', 11: 'Jacks', 12: 'Queens', 13: 'Kings', 14: 'Aces' };
const RANK_SG = { 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };

// Names the ranks in a category label: "Pair of Twos", "Two Pair, Aces and Kings", "Three of a Kind, Threes"
function namedHand(cards) {
  const e = handEval(cards), t = e.tb;
  switch (e.cat) {
    case 0: return `${RANK_SG[t[0]]} High`;
    case 1: return `Pair of ${RANK_PL[t[0]]}`;
    case 2: return `Two Pair, ${RANK_PL[t[0]]} and ${RANK_PL[t[1]]}`;
    case 3: return `Three of a Kind, ${RANK_PL[t[0]]}`;
    case 4: return `${RANK_SG[t[0]]}-high Straight`;
    case 5: return `${RANK_SG[t[0]]}-high Flush`;
    case 6: return `Full House, ${RANK_PL[t[0]]} over ${RANK_PL[t[1]]}`;
    case 7: return `Four of a Kind, ${RANK_PL[t[0]]}`;
    case 8: return `${RANK_SG[t[0]]}-high Straight Flush`;
    default: return 'Royal Flush';
  }
}

// Swaps a bare category label for the rank-naming version; leaves anything else ("Board plays", server text) alone
function richHandLabel(label, hole, community) {
  if (!HAND_NAMES.includes(label) || !hole || hole.length < 2 || !community || community.length < 3) return label;
  return namedHand([...hole, ...community]);
}

function evalHandLabel(hole, community) {
  const me = handEval([...hole, ...community]);
  const bd = handEval(community);
  if (community.length >= 5 && me.cat === bd.cat && me.tb.every((x, i) => x === bd.tb[i])) return 'Board plays';
  if (me.cat > 0 && me.cat === bd.cat) {
    const n = MADE_LEN[me.cat];
    if (me.tb.slice(0, n).every((x, i) => x === bd.tb[i])) return `Board ${HAND_NAMES[me.cat].toLowerCase()}`;
  }
  return HAND_NAMES[me.cat];
}

function evalPreflopLabel(hole) {
  if (!hole || hole.length < 2) return '';
  const [a, b] = hole;
  const NAMES = { '2': 'Twos', '3': 'Threes', '4': 'Fours', '5': 'Fives', '6': 'Sixes', '7': 'Sevens', '8': 'Eights', '9': 'Nines', '10': 'Tens', 'J': 'Jacks', 'Q': 'Queens', 'K': 'Kings', 'A': 'Aces' };
  const va = RNKS.indexOf(a.rank), vb = RNKS.indexOf(b.rank);
  const suited = a.suit === b.suit;
  const gap = Math.abs(va - vb);
  if (gap === 0) return `Pocket ${NAMES[a.rank] || a.rank}`;
  const hi = RNKS[Math.max(va, vb)], lo = RNKS[Math.min(va, vb)];
  if (hi === 'A' && lo === 'K') return suited ? 'Ace-King Suited' : 'Big Slick';
  if (hi === 'A' && lo === 'Q') return suited ? 'Ace-Queen Suited' : 'Ace-Queen';
  if (hi === 'K' && lo === 'Q') return suited ? 'King-Queen Suited' : 'King-Queen';
  if (hi === 'A' && lo === 'J') return suited ? 'Ace-Jack Suited' : 'Ace-Jack';
  if (suited && gap === 1) return 'Suited Connectors';
  if (gap === 1) return 'Connectors';
  return `${hi}-${lo} ${suited ? 'Suited' : 'Offsuit'}`;
}

// ─── Utils ────────────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function safePic(pic) {
  if (typeof pic !== 'string') return null;
  if (/^\/apic\/[A-Za-z0-9._~%-]{1,40}\/[a-f0-9]{10}$/.test(pic)) return pic;
  if (!/^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+\/=]+$/.test(pic)) return null;
  return pic;
}


// ─── Juice wiring (PingJuice) ─────────────────────────────────────
const juiceSeat = idx => document.querySelector(`.seat[data-player-idx="${idx}"]`);
const juiceSeatByName = name => { const i = state.gameState?.players.findIndex(p => p.name === name); return i >= 0 ? juiceSeat(i) : null; };

function juiceShowdown(winners, pot) {
  const PJ = window.PingJuice, gs = state.gameState;
  if (!PJ || !gs) return;
  const bb = gs.bb || 0, bbs = bb > 0 ? pot / bb : 0;
  const potEl = $('t-center'), myName = gs.players[state.myIdx]?.name;
  const allInPot = gs.players.some(p => p.allIn);
  const tier = bbs >= 25 ? 'mega' : (bbs >= 5 || allInPot) ? 'big' : 'nice';
  if (bbs >= 20) PJ.screenShake(bbs >= 50 ? 1.3 : 0.8, 500);
  winners.forEach((w, wi) => {
    const idx = gs.players.findIndex(p => p.name === w.name);
    const seat = idx >= 0 ? juiceSeat(idx) : null;
    const amt = Number.isFinite(w.amount) ? w.amount : 0;
    const netAmt = Number.isFinite(w.net) ? w.net : amt;
    if (seat) PJ.chipShower(potEl, seat, Math.max(6, Math.min(18, Math.round(6 + bbs / 3))));
    if (seat && idx >= 0) setTimeout(() => {
      const chipsEl = juiceSeat(idx)?.querySelector('.seat-chips');
      const now = state.gameState?.players[idx]?.chips;
      if (chipsEl && Number.isFinite(now)) PJ.countUp(chipsEl, Math.max(0, now - amt), now, 800);
    }, 750);
    const mine = w.name === myName;
    const hn = w.handName || '';
    const callout = /^(Full House|Four of a Kind|Straight Flush|Royal Flush)/i.test(hn);
    if (callout) setTimeout(() => PJ.calloutHand(hn + '!', $('stage')), 200);
    if (mine || bbs >= 20) {
      setTimeout(() => PJ.winCelebration(tier, seat || potEl, mine ? netAmt : `${w.name} +${fmt(netAmt)}`), (callout ? 1700 : 350) + wi * 200);
    }
  });
  if (bbs >= 50) {
    const top = winners[0];
    PJ.toast(`**${top.name}** won a **${fmt(pot)}** pot`, { sticker: 'vp-chip' });
  }
}

function juiceAllIn(prev, gs) {
  const PJ = window.PingJuice;
  if (!PJ || !prev.players || prev.handNum !== gs.handNum) return;
  gs.players.forEach((p, i) => {
    const was = prev.players[i];
    if (!was || was.name !== p.name || was.allIn || !p.allIn) return;
    const [x, y] = seatClientPos(i);
    if (p.lastAction === 'CALL') { PJ.shockwave(x, y, { size: 380 * state.u }); PJ.screenShake(0.6, 400); PJ.sfx('thud'); PJ.sfx('whoosh'); }
    else { PJ.shockwave(x, y, { size: 260 * state.u }); PJ.sfx('whoosh'); }
  });
}

function juiceSticker(emoji, fromName) {
  const PJ = window.PingJuice, seat = juiceSeatByName(fromName);
  if (!PJ || !seat) return;
  const r = seat.getBoundingClientRect();
  PJ.burst('glitter', r.left + r.width / 2, r.top + r.height / 2, { size: 140 * state.u, ms: 700, rotate: false });
}
