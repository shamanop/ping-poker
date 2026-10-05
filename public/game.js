'use strict';

// ─── State ────────────────────────────────────────────────────────
const state = {
  socket:         null,
  roomId:         null,
  myIdx:          null,
  myCards:        [],
  gameState:      null,
  selectedAvatar: '🤠',
  profilePic:     null,
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
  lobbyPlayers:   [],
  lobbyHost:      '',
  actKey:         {},
  actSeen:        {},
  connKey:        {},
  dealt:          {},
  firstState:     false,
  heroKey:        '',
  raiseKey:       '',
  raiseVal:       0,
  raiseMin:       0,
  raiseMax:       0,
  spectating:     false,
};

const TURN_MS       = 30000;
const BIG_BLIND     = 20;
let activeTray      = null;
const prevChipsMap  = {};
let balanceTimeout  = null;

const $ = id => document.getElementById(id);

// ─── Art slots (images/…); CSS draws a fallback when a file is missing ─
const AV_EMOJI = ['🤠', '🦊', '🐉', '🎩', '🦁', '🐺', '🦅', '🎲', '👑', '💀', '🎯', '⚡'];
const AV_FILES = AV_EMOJI.map((_, i) => 'a' + String(i + 1).padStart(2, '0'));
const artAvatars = new Set();

function probeArt() {
  const html  = document.documentElement;
  const slots = {
    'art-felt': 'table-felt.jpg', 'art-rail': 'table-rail.jpg', 'art-backdrop': 'backdrop.jpg',
    'art-back': 'card-back.png', 'art-puck': 'dealer-button.png', 'art-lockup': 'logo-lockup.png',
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
    renderAvatarGrid();
    renderLandingTable();
    if (state.lobbyPlayers.length) renderLobbySockets();
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
function setScale() {
  const u = Math.max(0.8, Math.min(1.35, Math.min(window.innerHeight / 900, window.innerWidth / 1440)));
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
  placeStaticSockets();
  if (state.gameState && $('game-screen').classList.contains('active')) renderGame();
}

// ─── Init ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setScale();
  state.socket = io();
  probeArt();
  document.querySelectorAll('svg.t-ping').forEach(fillPing);
  renderAvatarGrid();
  renderLandingTable();
  bindLanding();
  bindLobby();
  bindActions();
  bindSocket();
  bindRail();
  document.querySelectorAll('#sticker-grid .sticker-item').forEach(b => { b.innerHTML = art('stickers', b.dataset.emoji); });
  initSoundToggle();
  initChat();
  initBust();
  bindCopy($('room-code-btn'));
  bindCopy($('lobby-room-btn'));
  placeStaticSockets();

  $('player-seats').addEventListener('click', (e) => {
    const seat = e.target.closest('.seat[data-player-idx]');
    if (!seat) return;
    const playerIdx = parseInt(seat.dataset.playerIdx);
    if (playerIdx === state.myIdx) return;
    showThrowTray(playerIdx, seat.querySelector('.seat-pill') || seat);
  });

  window.addEventListener('resize', onResize);
  setInterval(tickTimer, 200);

  const savedName = localStorage.getItem('ppName');
  if (savedName) {
    const nameInput = $('player-name');
    nameInput.value = savedName;
    nameInput.dispatchEvent(new Event('input'));
  }
});

// ─── Screen ────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
  setScale();
  placeStaticSockets();
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

function bindCopy(btn) {
  if (!btn) return;
  btn.addEventListener('click', () => {
    const text = location.origin;
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

const SAMPLE_COMMUNITY = [
  { rank: 'A', suit: '♠' }, { rank: 'K', suit: '♥' }, { rank: 'Q', suit: '♦' },
  { rank: 'J', suit: '♣' }, { rank: '10', suit: '♠' },
];

// ─── Static tables (landing + lobby) ──────────────────────────────
function placeSockets(tb, host, seats) {
  if (!tb || !host) return;
  const W = tb.clientWidth, H = tb.clientHeight;
  if (!W || !H) return;
  const angles = anglesFor(8);
  host.querySelectorAll('.sock').forEach((el, i) => {
    const [ex, ey] = stadiumEdge(W, H, angles[i]);
    el.style.left = (W / 2 + ex) + 'px';
    el.style.top  = (H / 2 + ey) + 'px';
  });
}

function placeStaticSockets() {
  placeSockets($('landing-tb'), $('landing-sockets'));
  placeSockets($('lobby-tb'),   $('lobby-sockets'));
}

function renderAvatarGrid() {
  const grid = $('avatar-grid');
  if (!grid) return;
  grid.innerHTML = AV_EMOJI.map(e =>
    `<button type="button" class="avatar-option${e === state.selectedAvatar ? ' selected' : ''}" data-avatar="${e}" aria-label="Avatar ${e}">${avatarInner(e, null)}</button>`
  ).join('');
  grid.querySelectorAll('.avatar-option').forEach(el => {
    el.addEventListener('click', () => {
      grid.querySelectorAll('.avatar-option').forEach(a => a.classList.remove('selected'));
      el.classList.add('selected');
      state.selectedAvatar = el.dataset.avatar;
      renderLandingTable();
    });
  });
}

function renderLandingTable() {
  const host = $('landing-sockets');
  if (!host) return;
  const name = ($('player-name')?.value || '').trim();
  host.innerHTML = Array.from({ length: 8 }, (_, i) => {
    if (i === 0) {
      return `<div class="sock filled"><span class="av-wrap">${avatarInner(state.selectedAvatar, state.profilePic)}</span>${name ? `<span class="nm">${esc(name)}</span>` : ''}</div>`;
    }
    return '<div class="sock"></div>';
  }).join('');
  host.querySelectorAll('.sock.filled .av-wrap > img').forEach(im => im.classList.add('av'));
  const comm = $('landing-community');
  if (comm && !comm.children.length) {
    comm.style.setProperty('--cw', 'calc(74 * var(--px))');
    comm.innerHTML = SAMPLE_COMMUNITY.map((c, i) =>
      faceCardHtml(c, 'lg', i, `--i:${i};--n:5`)).join('');
  }
  const pot = $('landing-pot');
  if (pot && !pot.children.length) {
    pot.innerHTML = `<div class="pile">${chipStacksHtml(1280, 3, 5)}</div><div class="pot-txt"><small>Pot</small><span class="pot-num">1,280</span></div>`;
  }
  placeStaticSockets();
}

// ─── Landing ──────────────────────────────────────────────────────
function bindLanding() {
  const photoInput = $('photo-input');
  const photoArea  = $('photo-upload-area');
  photoArea.addEventListener('click', () => photoInput.click());
  photoArea.addEventListener('dragover', e => { e.preventDefault(); photoArea.classList.add('drag-over'); });
  photoArea.addEventListener('dragleave', () => photoArea.classList.remove('drag-over'));
  photoArea.addEventListener('drop', e => {
    e.preventDefault(); photoArea.classList.remove('drag-over');
    const file = e.dataTransfer?.files[0];
    if (file && file.type.startsWith('image/')) processPhotoUpload(file);
  });
  photoInput.addEventListener('change', () => { if (photoInput.files[0]) processPhotoUpload(photoInput.files[0]); });

  $('player-name').addEventListener('input', () => {
    clearTimeout(balanceTimeout);
    const name = $('player-name').value.trim();
    renderLandingTable();
    if (!name) { $('bank-display').classList.add('hidden'); return; }
    balanceTimeout = setTimeout(() => {
      state.socket.emit('check_balance', { name });
    }, 500);
  });

  $('btn-demo').addEventListener('click', () => {
    const name = getPlayerName(); if (!name) return;
    localStorage.setItem('ppName', name);
    state.socket.emit('create_demo', { name, avatar: state.selectedAvatar, profilePic: state.profilePic });
  });

  $('btn-join').addEventListener('click', () => {
    const name = getPlayerName(); if (!name) return;
    const password = $('password-input')?.value.trim() || '';
    if (!password) { showError('Enter the table password'); return; }
    localStorage.setItem('ppName', name);
    state.socket.emit('join_game', { name, avatar: state.selectedAvatar, profilePic: state.profilePic, password });
  });

  $('player-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-join').click(); });
  $('password-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-join').click(); });
}

function processPhotoUpload(file) {
  const canvas = document.createElement('canvas');
  canvas.width = 80; canvas.height = 80;
  const ctx = canvas.getContext('2d');
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const size = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - size) / 2, (img.height - size) / 2, size, size, 0, 0, 80, 80);
    URL.revokeObjectURL(url);
    state.profilePic = canvas.toDataURL('image/jpeg', 0.65);
    const preview = $('photo-preview-circle');
    preview.innerHTML = `<img src="${state.profilePic}" class="photo-preview-img" alt="Profile">`;
    preview.classList.add('has-photo');
    renderLandingTable();
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

function getPlayerName() {
  const name = $('player-name').value.trim();
  if (!name) { showError('Enter your name first'); return null; }
  return name;
}

function showError(msg) {
  const el = $('landing-error');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(showError.t);
  showError.t = setTimeout(() => { el.classList.remove('show'); }, 3000);
  if (!$('landing-screen')?.classList.contains('active')) toast(msg, '', 'warn');
}

// ─── Lobby ────────────────────────────────────────────────────────
function bindLobby() {
  $('btn-start').addEventListener('click', () => {
    const on = document.querySelector('#blind-seg .seg-btn.on');
    const blindInterval = parseInt(on?.dataset.v || '0');
    state.socket.emit('start_game', { roomId: state.roomId, blindInterval });
  });
  $('blind-seg').addEventListener('click', e => {
    const b = e.target.closest('.seg-btn'); if (!b) return;
    document.querySelectorAll('#blind-seg .seg-btn').forEach(x => x.classList.toggle('on', x === b));
  });
}

function renderLobbySockets() {
  const players = state.lobbyPlayers;
  const host = $('lobby-sockets');
  host.innerHTML = Array.from({ length: 8 }, (_, i) => {
    const p = players[i];
    if (!p) return '<div class="sock"></div>';
    const isHost = p.name === state.lobbyHost;
    return `<div class="sock filled"><span class="av-wrap">${avatarInner(p.avatar, p.profilePic)}</span><span class="nm">${esc(p.name)}</span>${isHost ? '<svg class="host"><use href="#i-crown"/></svg>' : ''}</div>`;
  }).join('');
  host.querySelectorAll('.sock.filled .av-wrap > img').forEach(im => im.classList.add('av'));
  $('lobby-count').textContent = players.length;
  placeStaticSockets();
}

function renderLobbyPlayers(players, hostName) {
  state.lobbyPlayers = players;
  state.lobbyHost    = hostName;
  renderLobbySockets();

  const isHost   = state.myIdx === 0;
  const btnStart = $('btn-start');
  const waitMsg  = $('waiting-msg');
  if (isHost) {
    btnStart.classList.remove('hidden'); waitMsg.classList.add('hidden');
    const canStart = players.length >= 2;
    btnStart.disabled    = !canStart;
    btnStart.textContent = canStart ? 'Start game' : 'Waiting for players';
  } else {
    btnStart.classList.add('hidden'); waitMsg.classList.remove('hidden');
  }
  $('blind-settings').classList.toggle('hidden', !isHost);
}

// ─── Socket ────────────────────────────────────────────────────────
function bindSocket() {
  const s = state.socket;

  s.on('balance_data', ({ balance }) => {
    state.myBalance = balance;
    $('bank-amount').textContent = balance.toLocaleString();
    $('bank-display').classList.remove('hidden');
  });

  s.on('balance_update', ({ balance }) => { state.myBalance = balance; });

  s.on('room_joined', ({ roomId, playerIdx, balance }) => {
    state.roomId = roomId;
    state.myIdx  = playerIdx;
    if (balance !== undefined) state.myBalance = balance;
    $('room-code').textContent       = roomId;
    $('lobby-room-code').textContent = roomId;
    showScreen('lobby-screen');
  });

  s.on('room_update', ({ players, hostName }) => { renderLobbyPlayers(players, hostName); });

  s.on('game_state', gs => {
    const prev = state.gameState;
    state.gameState = gs;
    if (!prev || prev.handNum !== gs.handNum) { state.dealt = {}; state.heroKey = ''; state.reveal = null; hideShowdown(); }
    noteTable(prev, gs);

    const cur = gs.currentPlayerIdx;
    if (cur == null || gs.status !== 'playing' || gs.players[cur]?.isBot) { state.turnEndAt = null; state.turnKey = ''; }
    else if (gs.turnRemainingMs != null) { state.turnEndAt = Date.now() + gs.turnRemainingMs; state.turnKey = gs.handNum + ':' + cur + ':' + gs.street + ':' + gs.currentBet; }
    else {
      const k = gs.handNum + ':' + cur + ':' + gs.street + ':' + gs.currentBet;
      if (k !== state.turnKey) { state.turnKey = k; state.turnEndAt = Date.now() + TURN_MS; }
    }
    state.blindEndAt = (gs.blindNextMs != null) ? Date.now() + gs.blindNextMs : null;

    if (gs.status === 'playing' || gs.status === 'waiting_next') {
      if (!$('game-screen').classList.contains('active')) showScreen('game-screen');
      renderGame();
    }
  });

  s.on('your_cards', ({ cards, myIdx }) => {
    state.myIdx   = myIdx;
    state.myCards = cards;
    if (state.gameState) { renderGame(); playSound('deal'); }
  });

  s.on('showdown_result', ({ winners, pot }) => {
    renderShowdown(winners, pot);
    playSound('win');
    const myName = state.gameState?.players[state.myIdx]?.name;
    if (myName && winners.some(w => w.name === myName)) {
      setTimeout(() => showWinFloat(pot), 250);
    }
  });

  s.on('sticker_dropped', ({ emoji, fromName }) => { showFloatingSticker(emoji, fromName); });
  s.on('item_thrown', ({ fromIdx, targetIdx, item }) => {
    animateProjectile(item, seatClientPos(fromIdx), seatClientPos(targetIdx));
  });

  s.on('chat_message', ({ name, text }) => { appendChatMsg(name, text); playSound('msg'); });

  s.on('blinds_up', ({ level, sb, bb }) => {
    toast(`BLINDS UP · LEVEL ${level + 1}`, `${sb} / ${bb}`, '', 4200);
    playSound('blinds_up');
  });

  s.on('bust_out', ({ balance }) => { showBust(balance); });
  s.on('leaderboard_data', ({ entries }) => { renderLeaderboard(entries); });
  s.on('error', ({ message }) => { showError(message); });

  s.on('disconnect', () => { toast('Connection lost', 'Trying to reconnect', 'warn', 5000); });
  s.on('connect',    () => { if (state.roomId) toast('Back online', '', 'ok', 2000); });
}

// Toasts for table-level events: players dropping and returning.
function noteTable(prev, gs) {
  if (!prev || prev.handNum === undefined) return;
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
    btn.querySelector('use').setAttribute('href', state.soundOn ? '#i-sound' : '#i-mute');
    btn.classList.toggle('muted', !state.soundOn);
  });
}

// ─── Rail: tabs, stickers, sit out ────────────────────────────────
function setTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.rail-tab').forEach(t => t.classList.toggle('on', t.dataset.tab === tab));
  document.querySelectorAll('.rail-panel').forEach(p => p.classList.toggle('on', p.id === 'tab-' + tab));
  if (tab === 'chat') {
    state.unread = 0;
    $('chat-unread').hidden = true;
    const el = $('chat-messages'); el.scrollTop = el.scrollHeight;
    setTimeout(() => $('chat-input').focus(), 30);
  }
  if (tab === 'rank') state.socket.emit('get_leaderboard');
  if (tab === 'log') { const el = $('log-entries'); el.scrollTop = el.scrollHeight; state.logPinned = true; }
}

function bindRail() {
  $('rail-tabs').addEventListener('click', e => {
    const t = e.target.closest('.rail-tab'); if (t) setTab(t.dataset.tab);
  });
  $('sticker-grid').addEventListener('click', e => {
    const item = e.target.closest('.sticker-item');
    if (!item || !state.roomId) return;
    state.socket.emit('drop_sticker', { roomId: state.roomId, emoji: item.dataset.emoji });
  });
  $('btn-sit-out').addEventListener('click', () => {
    if (!state.roomId) return;
    state.socket.emit('sit_out', { roomId: state.roomId });
  });
  $('log-entries').addEventListener('scroll', () => {
    const el = $('log-entries');
    state.logPinned = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  });
}

// ─── Chat ─────────────────────────────────────────────────────────
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
  el.querySelector('.empty-note')?.remove();
  const msg = document.createElement('div');
  msg.className = 'chat-msg';
  msg.innerHTML = `<span class="chat-name">${esc(name)}</span><span class="chat-text">${esc(text)}</span>`;
  el.appendChild(msg);
  el.scrollTop = el.scrollHeight;
  if (state.tab !== 'chat') {
    state.unread++;
    const u = $('chat-unread');
    u.textContent = state.unread > 9 ? '9+' : state.unread;
    u.hidden = false;
  }
}

// ─── Bust (rail side panel) ───────────────────────────────────────
function initBust() {
  $('btn-rebuy').addEventListener('click', () => {
    if (!state.roomId) return;
    state.socket.emit('rebuy', { roomId: state.roomId });
    $('bust-panel').classList.add('hidden');
  });
  $('btn-spectate').addEventListener('click', () => {
    state.spectating = true;
    $('bust-panel').classList.add('hidden');
  });
  $('btn-leave').addEventListener('click', () => { location.reload(); });
}

function showBust(balance) {
  state.spectating = false;
  $('bust-panel').classList.remove('hidden');
  $('bust-balance').textContent = `Bank ${balance.toLocaleString()}`;
  const rebuyBtn = $('btn-rebuy');
  const brokeMsg = $('bust-broke-msg');
  if (balance >= 20) {
    rebuyBtn.classList.remove('hidden');
    brokeMsg.classList.add('hidden');
    rebuyBtn.textContent = `Rebuy ${Math.min(1500, balance).toLocaleString()}`;
  } else {
    rebuyBtn.classList.add('hidden');
    brokeMsg.classList.remove('hidden');
  }
}

// ─── Leaderboard ───────────────────────────────────────────────────
function renderLeaderboard(entries) {
  const me = (state.gameState?.players[state.myIdx]?.name || '').toLowerCase();
  $('leaderboard-entries').innerHTML = entries.map((e, i) => `
    <div class="lb-row ${e.name.toLowerCase() === me ? 'lb-me' : ''}">
      <span class="lb-rank">${i + 1}</span>
      <span class="lb-name">${esc(e.name)}</span>
      <span class="lb-balance">${e.balance.toLocaleString()}</span>
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
  for (const d of DENOMS) {
    if (cols.length >= maxCols) break;
    const c = Math.floor(rem / d);
    if (c > 0) { cols.push({ d, c: Math.min(c, cap) }); rem -= c * d; }
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
  const seatW = 176 * u, seatH = 58 * u;
  const Wt = sw - seatW - 24 * u;
  const topNeed = seatH / 2 + 30 * u;
  const botNeed = seatH / 2 + 10 * u;
  const H = Math.max(200, Math.min(Wt / 1.55, sh - topNeed - botNeed));
  const W = Math.min(Wt, H * 1.75);
  const cx = sw / 2, cy = topNeed + H / 2;
  const tb = $('table-box');
  tb.style.left   = (cx - W / 2) + 'px';
  tb.style.top    = (cy - H / 2) + 'px';
  tb.style.width  = W + 'px';
  tb.style.height = H + 'px';
  state.geo = { sw, sh, u, seatW, seatH, W, H, cx, cy, seats: {} };
  return state.geo;
}

function seatCenter(angle) {
  const g = state.geo;
  const [ex, ey] = stadiumEdge(g.W, g.H, angle);
  const mx = g.seatW / 2 + 8 * g.u, my = g.seatH / 2 + 8 * g.u;
  return [
    Math.min(Math.max(g.cx + ex, mx), g.sw - mx),
    Math.min(Math.max(g.cy + ey, my), g.sh - my),
  ];
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
  renderSeats(gs);
  renderBets(gs);
  renderPot(gs);
  renderCommunity(gs);
  renderHero(gs);
  renderPlaque(gs);
  renderControls(gs);
  renderLog(gs.log);

  const me = gs.players[state.myIdx];
  const so = $('btn-sit-out');
  if (me && gs.status === 'playing') {
    so.hidden = false;
    so.textContent = me.sitOutRequest ? "I'm back" : 'Sit out next hand';
    so.classList.toggle('on', !!me.sitOutRequest);
  } else {
    so.hidden = true;
  }
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
    else if (p.lastAction === 'CALL')  text = `Call ${p.roundBet.toLocaleString()}`;
    else if (p.lastAction === 'RAISE') {
      const opening = prev && prev.handNum === gs.handNum && prev.street === gs.street && prev.currentBet === 0;
      kind = opening ? 'bet' : 'raise';
      text = `${opening ? 'Bet' : 'Raise to'} ${p.roundBet.toLocaleString()}`;
    } else return;
    bubbles[i] = { text, kind, t: Date.now() };
  });
}

// ─── Seats ────────────────────────────────────────────────────────
function seatStatus(p) {
  if (p.connected === false && !p.isBot) return ['Offline', 'offline'];
  if (p.allIn)       return ['All-in', 'allin'];
  if (p.sittingOut)  return ['Away', ''];
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
  const angles = anglesFor(n);
  const sbIdx = gs.status === 'playing' ? nextActiveSeat(gs.dealerIdx, gs.players) : -1;
  const bbIdx = gs.status === 'playing' ? nextActiveSeat(sbIdx, gs.players) : -1;
  noteActions(state.prevForBubbles, gs);
  state.prevForBubbles = gs;

  const html = gs.players.map((p, i) => {
    const off = (i - myIdx + n) % n;
    const [x, y] = seatCenter(angles[off]);
    g.seats[i] = [x, y];
    const hero = i === myIdx;
    const peekUp = y > g.cy + 10 * g.u;
    const [stText, stCls] = seatStatus(p);
    const tag = i === sbIdx ? 'SB' : i === bbIdx ? 'BB' : '';
    const dealKey = `${gs.handNum}:${i}`;
    const dealAnim = !state.dealt[dealKey] && p.cardCount > 0;
    if (dealAnim) state.dealt[dealKey] = 1;

    let peek = '';
    const rev = state.reveal && state.reveal.handNum === gs.handNum && state.reveal.cards[p.name];
    if (!hero && rev) {
      peek = `<div class="seat-peek reveal ${peekUp ? 'up' : 'down'}">${rev.map(c => faceCardHtml(c, 'md', 0, '', 'flip-in')).join('')}</div>`;
    } else if (!hero && p.cardCount > 0 && !p.folded) {
      peek = `<div class="seat-peek ${peekUp ? 'up' : 'down'}">${Array.from({ length: p.cardCount }, (_, k) =>
        `<div class="card back card-sm${dealAnim ? ' deal' : ''}" style="animation-delay:${k * 0.06}s"></div>`).join('')}</div>`;
    }

    const b = bubbles[i];
    let bubble = '';
    if (b && !hero) {
      const age = Date.now() - b.t;
      if (age < BUBBLE_MS) bubble = `<div class="seat-bubble k-${b.kind} ${peekUp ? 'below' : 'above'}" style="animation-delay:${-age}ms">${esc(b.text)}</div>`;
    }

    const cls = ['seat', hero ? 'hero' : '', p.isActive ? 'active' : '', p.folded ? 'folded' : '', p.sittingOut ? 'away' : '', state.winners?.has(p.name) ? 'winner' : ''].filter(Boolean).join(' ');
    return `<div class="${cls}" data-player-idx="${i}" style="left:${x.toFixed(1)}px;top:${y.toFixed(1)}px">
      ${peek}
      <div class="seat-pill">
        <div class="seat-av">${avatarInner(p.avatar, p.profilePic)}</div>
        <div class="seat-info">
          <div class="seat-l1"><span class="seat-name">${esc(p.name)}</span>${tag ? `<span class="seat-tag">${tag}</span>` : ''}</div>
          <div class="seat-l2"><span class="seat-chips">${p.chips.toLocaleString()}</span>${stText || stCls === 'secs' ? `<span class="seat-status ${stCls}">${stText}</span>` : ''}</div>
        </div>
        ${p.isActive ? `<div class="seat-timer"><i style="--t:${state.turnEndAt ? Math.min(1, Math.max(0, (state.turnEndAt - Date.now()) / TURN_MS)).toFixed(3) : 1}"></i></div>` : ''}
      </div>
      ${bubble}
    </div>`;
  }).join('');
  el.innerHTML = html;

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
  if (i === myIdx) return { x: g.cx, y: g.cy + g.H * 0.205, ux: 0, uy: -1 };
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

function renderBets(gs) {
  const layer = $('bet-layer'), pucks = $('puck-layer');
  const g = state.geo;
  const myIdx = state.myIdx ?? 0;
  let bh = '';
  gs.players.forEach((p, i) => {
    if (!(p.roundBet > 0) || !g.seats[i]) return;
    const s = betSpot(i, gs);
    const key = `${gs.handNum}|${gs.street}|${i}|${p.roundBet}`;
    const fresh = state.betKey?.[i] !== key;
    (state.betKey ||= {})[i] = key;
    bh += `<div class="bet${i === myIdx ? ' hero-bet' : ''}" style="left:${s.x.toFixed(1)}px;top:${s.y.toFixed(1)}px${fresh ? '' : ';animation:none'}">${chipStacksHtml(p.roundBet, 3, 6)}<span class="bet-amt">${p.roundBet.toLocaleString()}</span></div>`;
  });
  gs.players.forEach((p, i) => { if (!(p.roundBet > 0) && state.betKey) delete state.betKey[i]; });
  layer.innerHTML = bh;

  const d = gs.players[gs.dealerIdx];
  if (gs.status === 'playing' && d && g.seats[gs.dealerIdx]) {
    const s = betSpot(gs.dealerIdx, gs);
    let px = -s.uy, py = s.ux;
    if (px < -1e-3 || (Math.abs(px) <= 1e-3 && py < 0)) { px = -px; py = -py; }
    const off = (gs.dealerIdx === myIdx ? 138 : 68) * g.u;
    pucks.innerHTML = `<div class="puck" style="left:${(s.x + px * off).toFixed(1)}px;top:${(s.y + py * off).toFixed(1)}px">D</div>`;
  } else {
    pucks.innerHTML = '';
  }
}

// ─── Pot, community, hero ─────────────────────────────────────────
function renderPot(gs) {
  const row = $('pot-row');
  if (!(gs.pot > 0)) { row.innerHTML = ''; state.prevPot = 0; return; }
  const grow = gs.pot > state.prevPot;
  row.innerHTML = `<div class="pile">${chipStacksHtml(gs.pot, 3, 5)}</div><div class="pot-txt"><small>Pot</small><span class="pot-num">${gs.pot.toLocaleString()}</span></div>`;
  if (grow) {
    row.classList.remove('pot-pulse'); void row.offsetWidth; row.classList.add('pot-pulse');
    playSound('chip');
  }
  state.prevPot = gs.pot;
}

function renderCommunity(gs) {
  const el = $('community-cards');
  const cards = gs.community || [];
  const prevCount = (state.commHand === gs.handNum) ? (state.commCount || 0) : 0;
  el.innerHTML = cards.map((c, i) =>
    faceCardHtml(c, 'xl', 0, `--i:${i};--n:${cards.length};${i >= prevCount ? `animation-delay:${(i - prevCount) * 0.12}s` : ''}`, i >= prevCount ? 'deal reveal-flash' : '')
  ).join('');
  if (cards.length > prevCount) playSound('deal');
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
  wrap.style.top  = (g.H - 180 * g.u) + 'px';

  const cards = state.myCards;
  const key = `${gs.handNum}|${cards.map(c => c.rank + c.suit).join('')}`;
  if (state.heroKey !== key) {
    state.heroKey = key;
    $('hole-cards').innerHTML = cards.map((c, i) => faceCardHtml(c, 'xl', 0, `animation-delay:${i * 0.08}s`, 'flip-in')).join('');
  }

  const comm = gs.community || [];
  const label = comm.length >= 3 ? evalHandLabel(cards, comm) : evalPreflopLabel(cards);
  $('my-hand-label').innerHTML = `<span class="hl-k">Your hand</span><span class="hl-v">${esc(label)}</span>`;
}

function renderMyCards() { if (state.gameState) renderHero(state.gameState); }

// ─── Plaque (header) ──────────────────────────────────────────────
function renderPlaque(gs) {
  const sb = gs.sb || 10, bb = gs.bb || BIG_BLIND;
  $('pl-blinds').textContent = `${sb} / ${bb}`;
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
  $('pl-tocall').textContent  = inHand ? (toCall ? Math.min(toCall, me.chips).toLocaleString() : 'Check') : '—';
  $('pl-minraise').textContent = gs.status === 'playing' ? (gs.currentBet + bb).toLocaleString() : '—';
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
  const box  = $('raise-box'), slider = $('raise-slider'), input = $('raise-input');
  const bb   = gs.bb || BIG_BLIND;
  const isMyTurn = gs.currentPlayerIdx === state.myIdx;
  const canAct = !!me && isMyTurn && !me.folded && !me.allIn && gs.status === 'playing';
  const toCall = me ? Math.max(0, gs.currentBet - (me.roundBet || 0)) : 0;
  const allInCall = !!me && toCall >= me.chips;

  call.querySelector('.act-main').textContent = toCall === 0 ? 'Check' : (allInCall ? 'Call all-in' : 'Call');
  call.querySelector('.act-sub').innerHTML = toCall === 0 ? '&nbsp;' : (allInCall ? me.chips : toCall).toLocaleString();

  const minRaise = gs.currentBet + bb;
  const maxRaise = me ? me.chips + (me.roundBet || 0) : 0;
  const canRaise = canAct && me.chips > toCall && maxRaise >= minRaise;
  rbtn.querySelector('.act-main').textContent = gs.currentBet === 0 ? 'Bet' : 'Raise';

  // Status text
  if (!me) setBar('idle', 'Spectating', '');
  else if (me.chips === 0 && !me.allIn && gs.status === 'playing' && !me.cardCount) setBar('idle', state.spectating ? 'Spectating' : 'Out of chips', '');
  else if (gs.status === 'waiting_next') setBar('idle', 'Next hand starting', 'Hang tight');
  else if (me.folded) setBar('idle', 'You folded', 'Next hand soon');
  else if (me.allIn) setBar('idle', "You're all-in", 'Good luck');
  else if (canAct) {
    setBar('turn', 'Your turn', toCall ? `${(allInCall ? me.chips : toCall).toLocaleString()} to call · pot ${gs.pot.toLocaleString()}` : `Check or bet · pot ${gs.pot.toLocaleString()}`);
  } else {
    const who = gs.players[gs.currentPlayerIdx];
    if (who) setBar('wait', `Waiting for ${who.name}`, '', who.name);
    else setBar('idle', 'Waiting', '');
  }
  $('turn-ring').classList.toggle('idle', state.barMode === 'idle');
  if (state.barMode === 'idle') { $('my-turn-timer').innerHTML = '&nbsp;'; $('my-turn-ring').style.setProperty('--t', 0); }

  fold.disabled = !canAct;
  call.disabled = !canAct;
  rbtn.disabled = !canRaise;

  // Raise box
  const key = `${gs.handNum}|${gs.street}|${gs.currentBet}|${me?.chips}|${canAct}`;
  const presetDefs = [['Min', null], ['½ pot', 0.5], ['¾ pot', 0.75], ['Pot', 1], ['All-in', 'max']];
  const clampV = v => Math.max(minRaise, Math.min(maxRaise, Math.round(v)));
  const potRaise = f => gs.currentBet + f * (gs.pot + toCall);
  const presetVals = presetDefs.map(([, f]) => f === null ? minRaise : f === 'max' ? maxRaise : clampV(potRaise(f)));

  box.classList.toggle('off', !canRaise);
  slider.disabled = input.disabled = !canRaise;
  $('raise-presets').innerHTML = presetDefs.map(([label], i) =>
    `<button type="button" class="pre" data-v="${presetVals[i]}"${canRaise ? '' : ' disabled'}><span>${label}</span><b>${canRaise ? presetVals[i].toLocaleString() : '—'}</b></button>`).join('');

  if (canRaise) {
    slider.min = minRaise; slider.max = maxRaise;
    state.raiseMin = minRaise; state.raiseMax = maxRaise;
    if (state.raiseKey !== key) { state.raiseKey = key; state.raiseVal = minRaise; }
    setRaiseValue(state.raiseVal);
    $('tick-min').textContent = minRaise.toLocaleString();
    $('tick-max').textContent = maxRaise.toLocaleString();
  } else {
    state.raiseKey = '';
    slider.min = 0; slider.max = 100; slider.value = 0; slider.style.setProperty('--fill', '0%');
    input.value = '';
    $('tick-min').textContent = $('tick-max').textContent = '';
    $('raise-sub').innerHTML = '&nbsp;';
  }
}

function setRaiseValue(v) {
  const lo = state.raiseMin, hi = state.raiseMax;
  v = Math.max(lo, Math.min(hi, Math.round(v) || lo));
  state.raiseVal = v;
  const slider = $('raise-slider');
  slider.value = v;
  slider.style.setProperty('--fill', hi > lo ? ((v - lo) / (hi - lo) * 100).toFixed(1) + '%' : '100%');
  if (document.activeElement !== $('raise-input')) $('raise-input').value = v;
  $('raise-sub').textContent = v >= hi ? `to ${v.toLocaleString()} · all-in` : `to ${v.toLocaleString()}`;
  document.querySelectorAll('#raise-presets .pre').forEach(b => b.classList.toggle('on', parseInt(b.dataset.v) === v));
}

// ─── Action sends ─────────────────────────────────────────────────
function bindActions() {
  $('btn-fold').addEventListener('click', () => doFold());
  $('btn-check-call').addEventListener('click', () => doCall());
  $('btn-raise').addEventListener('click', () => doRaise());

  $('raise-slider').addEventListener('input', e => setRaiseValue(parseInt(e.target.value)));
  $('raise-input').addEventListener('input', e => {
    const v = parseInt(e.target.value);
    if (!isNaN(v)) {
      const slider = $('raise-slider');
      state.raiseVal = Math.max(state.raiseMin, Math.min(state.raiseMax, v));
      slider.value = state.raiseVal;
      const lo = state.raiseMin, hi = state.raiseMax;
      slider.style.setProperty('--fill', hi > lo ? ((state.raiseVal - lo) / (hi - lo) * 100).toFixed(1) + '%' : '100%');
      $('raise-sub').textContent = state.raiseVal >= hi ? `to ${state.raiseVal.toLocaleString()} · all-in` : `to ${state.raiseVal.toLocaleString()}`;
    }
  });
  $('raise-input').addEventListener('blur', () => setRaiseValue(state.raiseVal));
  $('raise-presets').addEventListener('click', e => {
    const b = e.target.closest('.pre');
    if (b && !b.disabled) setRaiseValue(parseInt(b.dataset.v));
  });

  document.addEventListener('keydown', e => {
    if (!$('game-screen').classList.contains('active')) return;
    if (e.ctrlKey || e.metaKey || e.altKey || state.barMode !== 'turn') return;
    const t = e.target;
    const inText = (t.tagName === 'INPUT' && t.type !== 'range' && t.id !== 'raise-input') || t.tagName === 'TEXTAREA';
    if (inText) return;
    const inRaiseInput = t.id === 'raise-input';
    const k = e.key;
    if (!inRaiseInput && (k === 'f' || k === 'F')) { e.preventDefault(); doFold(); }
    else if (!inRaiseInput && (k === 'c' || k === 'C')) { e.preventDefault(); doCall(); }
    else if (!inRaiseInput && (k === 'r' || k === 'R')) { e.preventDefault(); const i = $('raise-input'); if (!i.disabled) { i.focus(); i.select(); } }
    else if (k === 'ArrowUp' || k === 'ArrowDown') {
      if (!$('btn-raise').disabled) {
        e.preventDefault();
        const bb = state.gameState?.bb || BIG_BLIND;
        setRaiseValue(state.raiseVal + (k === 'ArrowUp' ? bb : -bb));
      }
    }
    else if (k === 'Enter' && t.tagName !== 'BUTTON') { e.preventDefault(); doRaise(); }
  });
}

function doFold() {
  if ($('btn-fold').disabled) return;
  playSound('fold'); sendAction('fold');
}

function doCall() {
  const gs = state.gameState; if (!gs || $('btn-check-call').disabled) return;
  const me = gs.players[state.myIdx];
  const toCall = gs.currentBet - (me?.roundBet || 0);
  const action = toCall === 0 ? 'check' : 'call';
  playSound(action === 'check' ? 'check' : 'chip');
  sendAction(action);
}

function doRaise() {
  if ($('btn-raise').disabled) return;
  const amount = Math.max(state.raiseMin, Math.min(state.raiseMax, parseInt($('raise-input').value) || state.raiseVal));
  playSound('raise');
  sendAction('raise', amount);
}

function sendAction(action, amount = 0) {
  state.socket.emit('player_action', { roomId: state.roomId, action, amount });
  $('btn-fold').disabled = $('btn-check-call').disabled = $('btn-raise').disabled = true;
  $('raise-slider').disabled = $('raise-input').disabled = true;
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
  if ((m = line.match(/^--- Hand #(\d+)\s*·?\s*(.*?)\s*---$/))) return `<div class="log-head">Hand ${esc(m[1])}${m[2] ? ` <span>${esc(m[2])}</span>` : ''}</div>`;
  if (/^--- Showdown ---$/.test(line)) return '<div class="log-head sub">Showdown</div>';
  if ((m = line.match(/^Dealer: (.+)$/))) return `<div class="log-line log-dim">Dealer ${nm(m[1])}</div>`;
  if ((m = line.match(/^(.+) posts (SB|BB) ([\d,]+)$/))) return `<div class="log-line log-dim">${nm(m[1])} posts ${m[2]} <b>${esc(m[3])}</b></div>`;
  if ((m = line.match(/^(.+) wins ([\d,]+)(?: with (.+))?$/))) return `<div class="log-line log-win">${nm(m[1])} wins <b>${esc(m[2])}</b>${m[3] ? ` with ${esc(m[3])}` : ''}</div>`;
  if ((m = line.match(/^(.+) raises to ([\d,]+)$/))) return `<div class="log-line">${nm(m[1])} raises to <b>${esc(m[2])}</b></div>`;
  if ((m = line.match(/^(.+) calls ([\d,]+)$/)))     return `<div class="log-line">${nm(m[1])} calls <b>${esc(m[2])}</b></div>`;
  if ((m = line.match(/^(.+) (folds|checks)$/)))     return `<div class="log-line ${m[2] === 'folds' ? 'log-dim' : ''}">${nm(m[1])} ${m[2]}</div>`;
  if ((m = line.match(/^(Flop|Turn|River): (.*)$/))) return `<div class="log-line log-board">${m[1]} <span class="cards">${redSuits(m[2])}</span></div>`;
  if (line.startsWith('★')) return `<div class="log-line log-board">${esc(line)}</div>`;
  return `<div class="log-line">${esc(line)}</div>`;
}

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
  proj.style.cssText = `position:fixed;left:${sx}px;top:${sy}px;z-index:70;font-size:${28 * state.u}px;width:${44 * state.u}px;pointer-events:none;transform:translate(-50%,-50%);`;
  document.body.appendChild(proj);

  proj.animate([
    { transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', offset: 0 },
    { transform: `translate(calc(-50% + ${dx * 0.45}px),calc(-50% + ${dy * 0.45 - arc}px)) scale(1.4) rotate(185deg)`, offset: 0.45 },
    { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(0.35) rotate(380deg)`, offset: 1 },
  ], { duration: 680, easing: 'ease-out', fill: 'forwards' }).onfinish = () => {
    proj.remove(); showSplat(item, ex, ey);
  };
}

function showSplat(item, x, y) {
  playSound('splat');
  const el  = document.createElement('div');
  el.className  = 'throw-splat';
  el.innerHTML = art('throws', item);
  el.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:71;font-size:${54 * state.u}px;width:${96 * state.u}px;pointer-events:none;transform:translate(-50%,-50%);`;
  document.body.appendChild(el);
  el.animate([
    { opacity: 1, transform: 'translate(-50%,-50%) scale(0.08)' },
    { opacity: 1, transform: 'translate(-50%,-50%) scale(2.5)', offset: 0.28 },
    { opacity: 0.8, transform: 'translate(-50%,-50%) scale(1.9)', offset: 0.62 },
    { opacity: 0, transform: 'translate(-50%,-50%) scale(1.5)', offset: 1 },
  ], { duration: 950 }).onfinish = () => el.remove();
}

function showFloatingSticker(emoji, fromName) {
  const g = state.geo, st = $('stage');
  if (!g || !st) return;
  const r = st.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'floating-sticker';
  el.innerHTML = `<div class="float-emoji">${art('stickers', emoji)}</div><div class="float-from">${esc(fromName)}</div>`;
  el.style.cssText = `position:fixed;left:${r.left + g.cx}px;top:${r.top + g.cy - g.H * 0.12}px;z-index:70;pointer-events:none;transform:translate(-50%,-50%);`;
  document.body.appendChild(el);
  el.animate([
    { opacity: 0, transform: 'translate(-50%,-50%) scale(0.2)' },
    { opacity: 1, transform: 'translate(-50%,-50%) scale(1.25)', offset: 0.18 },
    { opacity: 1, transform: 'translate(-50%,-68%) scale(1)',    offset: 0.65 },
    { opacity: 0, transform: 'translate(-50%,-98%) scale(0.8)',  offset: 1 },
  ], { duration: 2600 }).onfinish = () => el.remove();
}

function showWinFloat(amount) {
  const g = state.geo, st = $('stage');
  if (!g || !st) return;
  const r = st.getBoundingClientRect();
  const [mx, my] = seatClientPos(state.myIdx);
  const px = r.left + g.cx, py = r.top + g.cy - g.H * 0.12;
  const el = document.createElement('div');
  el.className = 'win-float';
  el.textContent = `+${amount.toLocaleString()}`;
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
    body = `<rect x="26" y="26" width="48" height="88" rx="4" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".7"/>
      <text x="50" y="86" text-anchor="middle" font-family="Libre Baskerville, Georgia, serif" font-weight="700" font-size="50" fill="currentColor">${esc(r)}</text>
      <use href="#${sym}" x="40" y="31" width="20" height="20"/>
      <use href="#${sym}" x="40" y="89" width="20" height="20" transform="rotate(180 50 99)"/>`;
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

function renderShowdown(winners, pot) {
  const gs = state.gameState;
  const ov = $('showdown-overlay');
  const g  = state.geo;
  state.reveal = { handNum: gs?.handNum, cards: {} };
  winners.forEach(w => { if (w.cards?.length) state.reveal.cards[w.name] = w.cards; });
  state.winners = new Set(winners.map(w => w.name));

  const share = Math.floor(pot / Math.max(1, winners.length));
  $('showdown-content').innerHTML = winners.map((w, i) => `
    <div class="sd-row">
      <span class="showdown-winner-name">${esc(w.name)}</span>
      <span class="showdown-hand-name">${esc(w.handName || '')}</span>
      <span class="showdown-pot"><strong>+${(share + (i === 0 ? pot - share * winners.length : 0)).toLocaleString()}</strong></span>
    </div>`).join('');

  if (g) {
    ov.style.left = (g.cx) + 'px';
    ov.style.top  = (g.cy - 200 * g.u) + 'px';
  }
  ov.classList.remove('hidden');
  ov.classList.toggle('split', winners.length > 1);
  if (state.gameState) renderSeats(state.gameState);

  const myName = gs?.players[state.myIdx]?.name;
  if (myName && winners.some(w => w.name === myName)) spawnConfetti($('stage'));

  clearInterval(sdTimer);
  let secs = 5;
  $('countdown').textContent = secs;
  $('showdown-bar').style.setProperty('--t', 1);
  const t0 = Date.now();
  sdTimer = setInterval(() => {
    const left = Math.max(0, 5000 - (Date.now() - t0));
    $('countdown').textContent = Math.ceil(left / 1000);
    $('showdown-bar').style.setProperty('--t', (left / 5000).toFixed(3));
    if (left <= 0) hideShowdown();
  }, 100);
}

function hideShowdown() {
  clearInterval(sdTimer);
  $('showdown-overlay').classList.add('hidden');
  state.winners = null;
}

function spawnConfetti(container) {
  const colors = ['#F5B942', '#ffe066', '#fff', '#b8860b', '#ffd700'];
  const g = state.geo;
  for (let i = 0; i < 28; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-particle';
    const angle = (Math.PI * 2 * i) / 28 + (Math.random() - 0.5) * 0.4;
    const dist  = 80 + Math.random() * 160;
    p.style.cssText = `background:${colors[i % colors.length]};left:${g ? g.cx : 400}px;top:${g ? g.cy : 300}px;--tx:${Math.cos(angle) * dist}px;--ty:${Math.sin(angle) * dist}px;--rot:${Math.floor(Math.random() * 720 - 360)}deg;--dur:${0.7 + Math.random() * 0.6}s;--delay:${Math.random() * 0.15}s;z-index:9;`;
    container.appendChild(p);
    setTimeout(() => p.remove(), 1700);
  }
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
  if (!pic.startsWith('data:image/')) return null;
  return pic;
}
